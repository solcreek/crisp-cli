# crispctl

[![npm version](https://img.shields.io/npm/v/crispctl)](https://www.npmjs.com/package/crispctl)
[![CI](https://github.com/solcreek/crisp-cli/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/solcreek/crisp-cli/actions/workflows/ci.yml)
[![Node.js version](https://img.shields.io/node/v/crispctl)](https://github.com/solcreek/crisp-cli/blob/main/package.json)
[![MIT license](https://img.shields.io/github/license/solcreek/crisp-cli)](LICENSE)

Agent-friendly CLI over the [Crisp REST API](https://docs.crisp.chat/references/rest-api/v1/) and [RTM API](https://docs.crisp.chat/references/rtm-api/v1/) for support operations: reply, note, resolve, reopen, assign, segments, mark read, search, people, and operators.

`crispctl` speaks HTTP to `https://api.crisp.chat/v1/` with Node's undici `fetch`. Routes match the official [`crisp-api`](https://github.com/crisp-im/node-crisp-api) resource paths. Tests mock that wire with undici `MockAgent`. The CLI does not wrap the SDK, so a test can assert the path and body without stubbing the SDK surface.

## Terminal inbox with crisp-tui

[**crisp-tui**](https://github.com/solcreek/crisp-tui) brings crispctl into an interactive terminal inbox. Browse and search conversations, send replies and internal notes, and resolve threads, with refreshes driven by RTM events. Agents can prepare drafts in the running inbox for human review.

With [Bun](https://bun.sh/) and Node.js installed, try the demo without credentials:

```bash
npm install -g crisp-tui
crisp-tui --demo
```

See the [crisp-tui README](https://github.com/solcreek/crisp-tui#readme) for installation requirements, keyboard shortcuts, read-only sessions and agent controls.

## Live access

Use a dedicated test website for development and write tests. Access to production websites requires explicit authorization and must use `--read-only` or `CRISPCTL_READ_ONLY=1`. This repository and CI contain no Crisp credentials. Live checks stay off unless you opt in locally.

## Install

Requires Node.js 22.12 or newer.

```bash
npm install -g crispctl
crispctl --help
```

From a checkout:

```bash
npm ci
npm run build
node dist/index.js --help
```

## Auth

A profile stores `identifier`, `key`, `tier` (`website` or `plugin`), and `website_id`. Profiles are named. `default` and `sandbox` are the usual ones. `auth set` writes the profile you name and makes it current.

Config file: `$XDG_CONFIG_HOME/crispctl/config.json`, or `~/.config/crispctl/config.json`. Override the path with `CRISPCTL_CONFIG`. The file is written mode `0600` and its directory mode `0700`.

```bash
crispctl auth set \
  --profile sandbox \
  --identifier "$CRISP_IDENTIFIER" \
  --key "$CRISP_KEY" \
  --tier website \
  --website "$CRISP_WEBSITE_ID"

crispctl auth show --profile sandbox
```

`--key` lands in shell history. Prefer environment variables. `auth set` with no credential flags copies the current env into the selected profile. `auth show` prints the identifier, tier, website id, and `key: "set"` or `"missing"`. It never prints the key.

Resolution order, highest first:

| Field        | Order                                                                             |
| ------------ | --------------------------------------------------------------------------------- |
| Profile name | `--profile`, `CRISPCTL_PROFILE`, `current` in the file, then `default`            |
| Identifier   | `CRISPCTL_IDENTIFIER`, `CRISP_IDENTIFIER`, profile                                |
| Key          | `CRISPCTL_KEY`, `CRISP_KEY`, profile                                              |
| Website      | `--website` or `--website-id`, `CRISPCTL_WEBSITE_ID`, `CRISP_WEBSITE_ID`, profile |
| Tier         | `CRISPCTL_TIER`, `CRISP_TIER`, profile                                            |

Global flags (any position): `--json`, `--read-only`, `--profile`, `--website`.

`--json` prints one JSON line on stdout (one line per event for `listen`). Failures print a JSON object on stderr and exit non-zero. The key is redacted if it would otherwise appear in an error string.

## Commands

```text
crispctl auth set|show
crispctl conversations list|get|search
crispctl conversations pages <session> [--page n]
crispctl messages list <session>
crispctl reply <session> --text "..." | --note "..."
crispctl resolve|reopen <session>
crispctl assign <session> --user <id> | --unassign
crispctl segments <session> --set a,b
crispctl read <session>
crispctl people get <id|email>
crispctl operators list
crispctl listen
```

| Command                                    | HTTP                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `conversations list [--page n]`            | `GET /v1/website/{website_id}/conversations/{page}`                                                                  |
| `conversations get <session>`              | `GET /v1/website/{website_id}/conversation/{session}`                                                                |
| `conversations pages <session> [--page n]` | `GET /v1/website/{website_id}/conversation/{session}/pages/{page}`                                                   |
| `conversations search <query>`             | `GET /v1/website/{website_id}/conversations/{page}?search_query&search_type` (`text` or `segment`)                   |
| `messages list <session>`                  | `GET /v1/website/{website_id}/conversation/{session}/messages`                                                       |
| `reply <session> --text`                   | `POST .../message` `{"type":"text","from":"operator","origin":"chat","content":"..."}`                               |
| `reply <session> --note`                   | `POST .../message` `{"type":"note","from":"operator","origin":"chat","content":"..."}`                               |
| `resolve <session>`                        | `PATCH .../state` `{"state":"resolved"}`                                                                             |
| `reopen <session>`                         | `PATCH .../state` `{"state":"unresolved"}`                                                                           |
| `assign <session> --user <id>`             | `PATCH .../routing` `{"assigned":{"user_id":"<id>"}}`                                                                |
| `assign <session> --unassign`              | `PATCH .../routing` `{"assigned":null}`                                                                              |
| `segments <session> --set a,b`             | `PATCH .../meta` `{"segments":["a","b"]}`                                                                            |
| `read <session>`                           | `PATCH .../read` `{"from":"operator","origin":"chat"}`                                                               |
| `people get <id>`                          | `GET /v1/website/{website_id}/people/profile/{people_id}`                                                            |
| `people get <email>`                       | `GET .../people/profiles/1?search_text=<email>`, then `GET .../people/profile/{people_id}` for the exact email match |
| `operators list`                           | `GET /v1/website/{website_id}/operators/list`                                                                        |

Requests send HTTP Basic auth (`identifier:key`) and `X-Crisp-Tier`. Stdout is the Crisp `data` payload.

### Browsing history

```bash
crispctl conversations pages session_... --json --read-only
crispctl conversations pages session_... --page 2 --json --read-only
crispctl listen --events session:sync:pages --session session_... --json --read-only
```

`conversations pages` returns one page of browsing history recorded by Crisp for
the selected conversation/session. `--page` defaults to 1 and accepts positive
safe integers. JSON output is the returned array; records may contain `page_title`,
`page_url`, `page_referrer`, and `timestamp`. These fields can be omitted; an empty page is `[]`.
No additional pages are fetched automatically. This is session history, not the
visitor's complete browser history or history across all their conversations.
See [List Conversation Pages](https://docs.crisp.chat/references/rest-api/v1/#list-conversation-pages).

For ongoing visits, explicitly select
[`session:sync:pages`](https://docs.crisp.chat/references/rtm-api/v1/#session-sync-pages)
with `listen`; it is not in the default event set. Both APIs require
`website:conversation:pages` read access. REST supplies recorded history and RTM
supplies new events; the commands do not merge or deduplicate them. RTM does not
replay events missed while disconnected, so refresh history through REST when needed.

### Read-only mode

```bash
crispctl --read-only conversations list --json
CRISPCTL_READ_ONLY=1 crispctl listen --json
```

`--read-only` or `CRISPCTL_READ_ONLY=1` rejects every write operation before it runs, including `reply` (text and notes), `resolve`, `reopen`, `assign`, `segments`, `read` (which marks messages read), and local `auth set`. The HTTP request layer also rejects all methods except GET and HEAD, so bypassing command dispatch cannot send a write through a read-only client. Existing commands retain their normal behavior when read-only mode is absent.

### `listen`

```bash
crispctl listen --json --read-only
crispctl listen --list-events --json
crispctl listen --json --events message:send,session:set_state --session session_...
crispctl listen --json --events message:send --count 1 --timeout 60
```

`listen` is always read-only. It discovers the current `socket.app` endpoint via REST, connects over secure Socket.IO, authenticates with the selected website or plugin token, and subscribes only to the selected website. Website tokens use `GET /v1/website/{website_id}/connect/endpoints`; plugin tokens use `GET /v1/plugin/connect/endpoints`.

The event catalog was checked against all 82 namespaces in the official RTM v1 reference on 2026-10-01. Website tokens are eligible for 71 events and plugin tokens for 72, subject to Crisp permissions. `listen --list-events --json` lists names, tiers and documented scopes without credentials or a connection. Known tier mismatches fail before connecting; valid unknown names remain accepted for future Crisp additions. The 10 user-only namespaces require an unsupported token tier. See the [RTM coverage matrix](docs/rtm-coverage.md) for every event and the limits of this verification.

The default events are `message:send`, `message:received`, and `session:set_state`. `--events` selects comma-separated event names; token scopes must allow them. `--session` filters received events locally by `session_id`, or by `identifier` for `email:track:view` when `type` is `session`. Events with no recognized session identifier are excluded by this filter; arbitrary plugin payload fields are not interpreted as routing metadata. Bucket URL events use `resource.type === "website"` and `resource.id` to match the website, instead of a top-level `website_id`. `--json` writes newline-delimited JSON to stdout:

```json
{
  "event": "session:set_state",
  "data": { "website_id": "...", "session_id": "session_...", "state": "resolved" },
  "received_at": "2026-10-01T12:00:00.000Z"
}
```

Connection status (`authenticated`, `reconnecting`) and errors go to stderr, also as JSON when `--json` is set. Transient connection/discovery failures retry with exponential backoff and equal jitter, capped at 30 seconds. A valid HTTP `Retry-After` (seconds or a canonical IMF-fixdate timestamp) is honored as a minimum and may exceed that cap; all waits remain cancellable. Incomplete dates, invalid calendar values and weekday mismatches fall back to the jittered backoff. Each retry discovers the endpoint again and reauthenticates. Authentication rejection and non-transient HTTP errors stop with exit 1. Events missed while disconnected are not replayed; consumers should reconcile via REST when needed.

Ctrl-C / SIGTERM closes the connection and exits cleanly. `--count N` exits successfully after N matching events; `--timeout S` sets a total deadline in seconds and exits 1 if reached. Without these flags, the listener runs until stopped.

Output is written in order and drained before normal exit. Closing the stdout pipe
(for example, a downstream reader stopping early) cancels listening cleanly.
REST response bodies are limited to 8 MiB after decompression, including chunked
responses. Oversized successful responses fail with `response_too_large`; HTTP
errors retain their status classification and `Retry-After`. Malformed envelope
fields fail validation, while unknown fields and arbitrary `data` remain accepted.

Pending output is limited to 8 MiB per stream; exceeding this limit stops the
listener with exit 1 and an explicit error. Overflow can truncate pending output;
it does not silently drop events and continue.

After listening ends, each stream has up to 5 seconds to finish pending writes.
The `--timeout` deadline also covers stdout draining, including after `--count`
is reached. Ctrl-C / SIGTERM cancels a pending stdout drain. If output cannot be
fully written because of cancellation, a deadline, or a stalled consumer, the
CLI exits 1 and pending output may be truncated. Stderr has a separate bounded
drain so it can report the failure. An earlier command failure retains its exit
code even if a pipe closes afterward.

### Verify RTM with 1Password

From a checkout with `op` connected to 1Password:

```bash
npm run build
node scripts/rtm-smoke.mjs "<expected website name>"
```

Set `CRISPCTL_LIVE_OP_ITEM` and optionally `CRISPCTL_LIVE_OP_VAULT` to select a different 1Password API-token item. By default, the script reads `Crisp API Credentials` (`API Identifier` / `token_identifier`, `API Key` / `token_key`, and `website_id`) using the real `op` CLI, verifies the website name via a GET request, and runs the built CLI with a website token and `--read-only --json --count 1 --timeout 60`. It only receives events; it never creates a test message or changes a conversation. It reports only assertion results and counts, without website names, event payloads, customer content or credentials. A parent watchdog terminates stalled children; malformed, oversized or truncated NDJSON fails the check. Credentials remain in memory and the child environment. A successful check requires an actual website event, not just authentication; a quiet website can time out.

## Testing

Unit and HTTP contract tests use undici [`MockAgent`](https://undici.nodejs.org/#/docs/api/MockAgent) against `https://api.crisp.chat`. Each MVP verb has a happy path plus HTTP 400 and 429. The mock is the client's dispatcher, so the test sees the real path, query, and body. Nothing in `npm test` contacts Crisp.

```bash
npm run fmt
npm run lint
npm test
npm run typecheck
npm run verify
```

Formatting uses [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html), and
[Oxlint](https://oxc.rs/docs/guide/usage/linter.html) checks correctness, variable
shadowing and strict equality across source, tests and scripts. Both tools run
from pinned dev dependencies; no Rust installation is needed. `npm run fmt:check`
checks formatting without changing files, and `npm run lint:fix` applies safe lint
fixes. Warnings fail the lint gate. Generated build/coverage files and npm's
lockfile are excluded from formatting, as is the captured RTM reference snapshot.
TypeScript remains responsible for type checking and building the CLI. Each build
cleans `dist/` first and emits nothing if compilation fails.

The mechanical formatting commit is recorded in `.git-blame-ignore-revs`. Use
`git blame --ignore-revs-file .git-blame-ignore-revs <file>` to see the preceding
history when reviewing code ownership.

`npm test` builds the CLI and runs all offline tests with coverage. CI tests the Node.js 22.12.0 minimum, current Node 22, and Node 24. No Crisp credentials or external services are needed.

Commander defines the command tree and generates help in `src/command-tree.ts`.
Option names derive from `src/command-options.ts`; the command map must cover
every help-notes entry. Compile-time checks reject unknown names, and runtime
tests exercise both help forms for every command.
`src/cli.ts` adapts parsing and errors to the CLI's JSON and exit-code contract;
`src/operations.ts` performs command operations through injected IO and enforces
read-only mode before writes. REST, RTM, output and lifecycle code remain separate
from the command framework. CLI compatibility tests cover option placement,
literal values, help, concurrent invocations and credential redaction on errors.
Each invocation lazily snapshots its credentials so rotating configuration cannot
expose a previously used key in diagnostics. REST requests and response bodies
honor cancellation, including SIGINT/SIGTERM in the executable. Cancellation
prevents subsequent requests; a write already sent to Crisp may have taken effect.

`npm run verify` runs formatting, lint and typecheck, then builds once and runs
the complete offline suite once. It reuses that run’s V8 coverage data for
`coverage:rtm` and `coverage:tooling`, then smoke-tests the same built package.
`test:rtm`, `test:tooling` and `test:package` remain standalone commands.
The package smoke installs an actual tarball into a temporary directory and checks its executable, version, help, event catalog and error exit.
It may download dependencies from npm; it never accesses Crisp or 1Password.

| Layer                     | What it verifies                                                                                                                                                                        | Included in CI   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Unit                      | Argument parsing, config, redaction, RTM filtering/retry/cancellation, write rejection                                                                                                  | Yes              |
| HTTP integration          | Real undici requests against MockAgent: methods, paths, headers, bodies, HTTP errors                                                                                                    | Yes              |
| CLI E2E / RTM integration | Built CLI child process + real local WSS Socket.IO server: authentication, NDJSON, site/session filtering, reconnect/discovery, unauthorized exit, SIGTERM cleanup, read-only rejection | Yes              |
| Release smoke             | Wait for the exact npm version, install it from the public registry and execute its bin                                                                                                 | After publishing |
| Live smoke                | Real Crisp REST or RTM, explicitly enabled locally                                                                                                                                      | No               |
| Package smoke             | Install the packed artifact and execute its installed bin                                                                                                                               | Yes              |

E2E endpoint discovery is intercepted in the child process; RTM uses actual Socket.IO over TLS on loopback. The test-only certificate is trusted by that child via `NODE_EXTRA_CA_CERTS`; TLS verification stays enabled. Test fixtures contain no real credentials.

Aggregate coverage is enforced across all runtime `src/` files, including unimported files (type-only `.d.ts` declarations are not executable): **95% lines/statements/functions and 85% branches**. A separate `npm run test:rtm` gate requires 100% lines/statements/functions and at least 95% branches across `src/rtm*.ts`, and is checked on every CI Node version. `npm run check:rtm-reference` optionally checks catalog drift against the live official reference; it is not part of offline CI. Coverage thresholds complement behavior assertions; E2E and live checks verify transport behavior that a high unit coverage number alone cannot establish.

The registry, installed-package, published-package and RTM stream-monitor helpers also
use TypeScript `checkJs` with JSDoc contracts. `npm run test:tooling` exercises them
with offline subprocess fixtures and enforces **95% lines/statements, 100%
functions and 90% branches** independently of `src/` coverage. Cases include
installation failure, wrong executable versions, malformed or inconsistent event
catalogs, invalid exit codes, installed conversation-page argument validation,
credential isolation and temporary-directory cleanup. RTM monitor tests cover
UTF-8 boundaries, malformed/truncated/oversized NDJSON, spawn and stream errors,
signal cleanup and watchdog escalation. Live checks remain separately opt-in.

### Performance measurements

`npm run bench` builds the CLI and measures fresh processes for help, version,
usage errors, the event catalog, synthetic REST output, local TLS RTM events and
graceful cancellation. It validates complete output before accepting each sample.
No Crisp credentials or external API calls are used.

```bash
npm run bench
npm run --silent bench -- --json > /tmp/crispctl-benchmark.json
npm run bench -- --scenario help --scenario rtm-cancel --samples 50
npm run bench:stages
```

Reports include raw samples, p50/p95 latency, first output, peak RSS, CPU time,
output bytes and cancellation latency. CI runs a one-sample correctness check;
timing thresholds are not imposed on shared runners. See
[measurement methodology and baseline](docs/performance.md) before comparing runs.

`node scripts/benchmark.mjs --target /path/to/built-checkout --json` measures another
build with the same fixtures. `bench:stages` isolates warm command-tree construction,
configuration, body decoding, redaction and output-queue costs in validated batches.

### Live smoke

`npm run test:live` builds the CLI and runs the opt-in live suite. All checks **skip** by default (exit 0):

- REST operator listing requires `CRISPCTL_LIVE=1` or `CRISP_LIVE=1` and configured credentials for a dedicated test website.
- Browsing history additionally requires `CRISPCTL_LIVE_PAGES_SESSION` set to a session on that test website. It reads page 1 with a read-only client and validates the returned fields; an empty history passes but does not establish that page visits were recorded.
- RTM requires `CRISPCTL_LIVE_RTM=1`, an expected website name, and an authenticated `op` CLI. It reads `Crisp API Credentials` and requires receipt of an actual event within 60 seconds, not merely a successful handshake. It never sends messages or writes data.

RTM defaults to `CRISPCTL_LIVE_RTM_MODE=event`. For a quiet website, set
`CRISPCTL_LIVE_RTM_MODE=auth` to verify authentication and then disconnect without
waiting for traffic. The result identifies the mode and event count; an auth-only
pass does not establish event delivery. In event mode, no events within the
deadline still fails. The outer watchdog allows time for 1Password authorization,
website identity verification and the full event deadline.

```bash
CRISPCTL_LIVE_RTM=1 CRISPCTL_LIVE_WEBSITE_NAME="<expected website name>" npm run test:live
```

To run the separate REST smoke check:

```bash
export CRISPCTL_PROFILE=sandbox
export CRISP_IDENTIFIER=...
export CRISP_KEY=...
export CRISP_WEBSITE_ID=...
export CRISP_TIER=website
export CRISPCTL_LIVE=1
npm run test:live
```

A separate synthetic write check requires **both** the REST opt-in and
`CRISPCTL_LIVE_WRITE=1`, plus `CRISPCTL_LIVE_WEBSITE_NAME` matching the dedicated
sandbox. It creates its own conversation, verifies note delivery over RTM, reads
back state changes, checks API validation errors and deletes that conversation in
`finally`. It never edits existing conversations or generates API credentials.
This write check is for a dedicated sandbox only; it remains disabled in CI.

The REST opt-in above is for a dedicated test website only. For explicitly authorized production RTM verification, use the read-only 1Password flow. Do not commit tokens or add them as CI secrets. CI runs `npm test` without live flags.

## Release

Notable changes are recorded in [CHANGELOG.md](CHANGELOG.md), following [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Add user-facing changes to `Unreleased` as part of each feature or fix.

Publishing uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC). There is no npm token in the repo or in GitHub Actions secrets.

1. Set the release version in `package.json` and update `package-lock.json` to match.
2. Move the `Unreleased` entries into a new version section dated `YYYY-MM-DD`. Keep an empty `Unreleased` section above it and update the version and comparison links at the bottom of `CHANGELOG.md`.
3. Commit the release preparation and tag it `vX.Y.Z`, matching the package version, then push the tag.
4. `.github/workflows/publish.yml` runs on tags `v*`. Publishing waits for the shared verification workflow to pass on Node 22.12.0, current Node 22, and Node 24, including formatting, lint, typecheck, all three coverage gates and installed-package smoke. The publish job uses Node 24, `id-token: write` and `package-manager-cache: false`. Before build or publish it requires `GITHUB_REF_NAME` to equal `v` plus the package version, then runs `npm ci`, `npm run build` and `npm publish`.
5. The separate `verify-published` job polls public npm metadata for up to 45 minutes,
   then installs the exact published version and checks its executable, help, event
   catalog and JSON error exit. No Crisp credentials or OIDC write permissions are
   needed for this job.

An accepted publication can take time to become downloadable. If registry or
installation verification fails, inspect its result and rerun **Verify Published
Package** with the exact version, or run `npm run test:published -- X.Y.Z` locally.
This verification never republishes or changes dist-tags. It is separate from the
offline test suite; polling failures and deadlines are tested with local fixtures.

Pull requests and main pushes run `.github/workflows/ci.yml`, which calls the same
`.github/workflows/verify.yml` as releases. No live Crisp calls are included.

## License

MIT
