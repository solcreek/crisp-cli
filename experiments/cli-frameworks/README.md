# CLI framework POC

For `crispctl` today, use Commander as the command interface and retain the
existing operation, output and RTM lifecycle layers. If Node 20 remains supported,
use Commander 14.0.3; evaluate its matching `@commander-js/extra-typings` 14.x
companion for inferred options. Ink is a useful optional human-facing `watch`
interface. Crust deserves another evaluation if Node 24 and its tooling peer
requirements become acceptable, especially if generated skills/MCP are needed.

Runtime policy is a separate decision: as of 2026-10-01, [Node 20 is EOL and
Node 24 is LTS](https://nodejs.org/en/about/previous-releases). The Node 20 rows
measure compatibility with our existing promise; they are not a recommendation
to keep that baseline indefinitely. For a new Node 24 baseline, Commander 15 and
Ink 7 are the corresponding choices. Raising the baseline removes Crust's Node
blocker, but its command/lifecycle integration costs and TypeScript peer range
still need deliberate treatment. Commander remains the smaller migration for
our existing RTM/output runtime; Crust becomes more compelling if one command
model must drive CLI, skills and MCP.

This experiment runs actual framework packages with deterministic local fixtures.
It implements `conversations list`, `reply` and `listen` through the same operation
layer. `reply` only echoes fixture data. There is no Crisp network access,
credential lookup or live RTM verification. Dependencies and build output are
isolated from the published CLI.

Run it from this directory with Node 24+ and Python 3 (PTY tests use Unix APIs):

```sh
npm ci
npm test
node dist/main.js commander conversations list --page 2 --json
node dist/main.js crust conversations list --page 2 --json
node dist/main.js commander reply session_fixture --text hello --read-only --json
node dist/main.js crust listen --json --count 3
node dist/main.js ink listen
node dist/main.js ink listen --json --count 3
npm run benchmark
```

In a terminal, the Ink listener renders a live dashboard. Press `p` to toggle event
details and `q` to exit. With redirected output or `--json`, it uses the shared
plain/NDJSON path and does not import Ink. Ink uses Commander for parsing; it is a
React terminal renderer, not an alternative command parser.

The published versions below were checked on 2026-10-01. Exact dependencies and
integrity hashes are in `package-lock.json`.

| Candidate | POC versions | Declared Node requirement | Role |
| --- | --- | --- | --- |
| Commander | 15.0.0, plus 14.0.3 alias | 15: >=22.12; 14: >=20 | Parsing, command routing, help |
| Crust | core/extensions 0.5.2 | >=24 | Typed command model, Contexts, Extensions, invocation lifecycle |
| Ink | 7.1.1 + React 19.2.0, plus Ink 6.8.0 alias | 7: >=22; 6: >=20 | Interactive terminal rendering |

The `commander-node20` and `ink-node20` adapters use Commander 14.0.3; the latter
loads Ink 6.8.0 in a TTY. An import smoke succeeding on an unsupported Node version
is not evidence of package support.

Hands-on findings:

- **Commander:** its builder maps directly to our command hierarchy. We used
  `optsWithGlobals()`, `configureHelp({showGlobalOptions: true})`, `exitOverride()`
  and `configureOutput()` to preserve global options and centralize diagnostics.
  Usage failures are mapped to exit 2 by our adapter. Native `opts<T>()` trusts
  manually supplied types, but the companion `extra-typings` package caught a
  misspelled option in a compile-only probe. The POC tests companion version 15;
  a production Node 20 migration should use and validate companion version 14.
- **Crust:** action flags and typed programmatic command paths/results have strong
  inference. `app.run()` captures IO and returns an explicit outcome, which is
  convenient for finite commands and tests. Shared flags live in a provided
  Context, and an error Extension suppresses default diagnostics. `execute()`
  writes `process.exitCode` and normally maps errors to 1; the adapter restores
  that process state and maps usage errors to our contract. In this nested POC,
  attaching help before declaring the tree produced a compile-time alias
  collision; attaching Extensions after the tree compiled successfully.
- **Ink:** React state, layout and keyboard hooks made the live view straightforward
  to author. Actual PTY tests verified redraws, `p` and `q`, rather than only
  asserting text snapshots. Rendering needs a terminal and its own cleanup/input
  lifecycle. The TUI renders current state; the separate NDJSON path preserves
  every event. `patchConsole: false` and `exitOnCtrlC: false` keep process policy in
  the shared boundary. It adds clear value to a human dashboard; API reads and
  automation do not benefit from initializing the renderer.

Three concrete Crust integration costs were reproduced:

1. Core 0.5.2 fails to import on Node 20.20.2 with `SyntaxError` at `await using`.
   This is a runtime blocker, not merely an `engines` warning. See
   [the Node 20 probe](results/node20-probe.json).
2. Core/extensions declare an optional TypeScript `^7.0.0` peer. A clean npm
   resolution with TypeScript 5.8.3 rejected the dependency tree with `ERESOLVE`.
   The POC typechecks with both 7.0.2 and a separate 5.8.3 compiler probe, but that
   does not remove the package-manager conflict or change the supported peer
   range. See [validation](results/validation.json).
3. `app.run()` retains the entire stdout/stderr transcript, including when output
   callbacks are injected. A native test proves that behavior. An unbounded RTM
   listener must use an appropriate execution boundary instead of adopting this
   capture API. This finding applies to `run()`, not to every Crust command or
   `execute()`.

Parser compatibility also needs explicit review. Both adapters reject unknown
options, excess arguments, boolean `=true`/`=false`, invalid counts and negated
read-only flags; repeated scalar options use the last value. Crust required
`noNegate: true` for the read-only boolean. For
`reply --json --text hello -- -session`, Commander fills the session positional;
Crust keeps post-separator values in `rawArgs` and reports the required session as
missing. The existing `crispctl` parser puts those values into positionals. The
POC deliberately characterizes this difference instead of hiding it with a
compatibility shim. Full argument/error transcripts are in
[benchmark.json](results/benchmark.json).

Measurements on Apple M3 / macOS arm64 / Node 24.21.0:

| Adapter | JSON list process median | Runtime dependency closure | Installed package files |
| --- | ---: | ---: | ---: |
| Commander 15 | 53 ms | 1 package | 0.20 MiB |
| Crust core + extensions | 72 ms | 6 packages | 2.85 MiB |
| Commander 15 + lazy Ink 7 | 51 ms | 39 packages when UI is loaded | 7.85 MiB |

These are 15 interleaved fresh-process samples after warming the filesystem
cache; startup includes Node and local fixture output, not HTTP/RTM latency.
Ink's JSON path deliberately does not load the renderer, so its small difference
from Commander is noise rather than an Ink performance advantage. Separate
import-only probes measured approximately 11 / 38 / 164 ms and total process RSS
of 51 / 56 / 87 MiB for Commander / Crust / Commander+React+Ink. RSS is not
incremental memory, installed size is not bundle size, and neither is a load test.
The actual Ink 7 PTY probe produced its first frame in 334 ms in one recorded run;
see [the transcript](results/ink-pty.json). Raw samples and methodology are retained
so these numbers can be remeasured rather than treated as portable guarantees.

Validation completed locally:

- Node 24.21.0: 55 tests passed, including nested/global flags, JSON diagnostics,
  read-only enforcement at the operation layer, NDJSON order/Unicode/newlines,
  deadlines, SIGINT, SIGTERM, EPIPE, native Crust invocation and real PTYs.
- Node 20.20.2: 22 tests passed for Commander 14 / Ink 6; the two native Crust tests
  are intentionally skipped. The incompatible latest Crust import was checked
  separately and failed as described above.
- TypeScript 7.0.2 and 5.8.3: compile probes passed, including expected errors for
  misspelled Crust/typed-Commander flags and invalid Crust structured input.
- The final global-help change passed five focused checks. The PTY probe also
  passed after adding runtime metadata. The dedicated GitHub workflow repeats
  the complete supported runtime matrix on Linux.

Reproduce the Node 20 runtime checks after building under Node 24:

```sh
POC_NODE20=1 npm exec --yes --package=node@20 -- node --test test/*.test.mjs
npm exec --yes --package=typescript@5.8.3 -- tsc -p tsconfig.json --noEmit
npm exec --yes --package=node@24 -- node benchmark.mjs
```

The experiment covers framework boundaries, not the complete production command
surface or production RTM transport. It does not implement the existing 8 MiB
output cap and bounded shutdown drain, credential redaction, credential profiles,
Crisp authentication, reconnection, or replay/reconciliation. Those remain
responsibilities of our existing runtime and operations during any migration.
The successful tests include documented compatibility differences; they do not
mean a drop-in framework replacement is ready.

A migration should first extract command handlers with typed inputs while keeping
`run()`'s injectable IO/transport contract. Then introduce Commander behind the
existing CLI contract tests and explicitly preserve option placement, separators,
error JSON, exit codes and read-only enforcement. Add an optional Ink `watch`
command only when a human workflow needs it. Revisit Crust after deciding on the
Node/toolchain baseline and a concrete benefit from its command model, generated
skills or MCP modules; those optional modules were reviewed in documentation but
not executed by this POC.

References: [Commander](https://github.com/tj/commander.js),
[extra-typings](https://github.com/commander-js/extra-typings),
[Crust](https://github.com/chenxin-yan/crust),
[Crust current documentation](https://crustjs.com/docs/),
[Crust package requirements](https://github.com/chenxin-yan/crust/blob/main/packages/core/package.json),
[Ink](https://github.com/vadimdemedes/ink),
[Ink 7.1.1 package](https://github.com/vadimdemedes/ink/blob/v7.1.1/package.json).
An initially retrieved search snapshot of Crust documentation was outdated;
directly fetching the current site showed the new API, so documentation staleness
was excluded from the assessment.
