# Changelog

Notable changes to `crispctl` are recorded here.

Entries follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and releases use [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Verify published npm versions with bounded registry polling and an installed
  executable smoke test; allow verification-only reruns without republishing.

### Changed

- Enforce Oxfmt formatting and Oxlint correctness checks in local verification,
  CI and the release gate, with pinned development dependencies and a separate
  formatting baseline recorded for Git blame.

### Fixed

- Reject release verification inputs with leading zeroes in numeric prerelease
  identifiers before contacting npm, avoiding unnecessary registry polling.
- Clean build output before compiling and suppress output on type errors, so npm
  packages cannot retain deleted modules or artifacts from failed builds.
- Reject page numbers outside JavaScript’s safe integer range instead of rounding
  or sending `Infinity`; share numeric validation with RTM count and timeout flags.
- Keep the credentials used by each invocation available for redaction even if
  config or environment credentials rotate, and redact secrets in help topics.
- Propagate cancellation through REST requests and response bodies, prevent
  cancelled writes and follow-up requests, and handle process signals while REST
  commands are running.

## [0.4.0] - 2026-10-01

### Changed

- Use Commander for argument parsing, command routing and generated help while
  retaining JSON output, exit codes and flexible option placement.
- Separate command operations from CLI routing and enforce read-only mode directly
  in every write operation, including local credential changes.
- Require Node.js 22.12 or newer for Commander 15; verify Node 22 and 24 before
  publishing.

### Fixed

- Redact credentials from API error reasons and Retry-After values as well as
  messages, in both JSON and text diagnostics.
- Keep the listen deadline and cancellation active while stdout drains; bound
  each stream's final drain to 5 seconds so a stalled consumer cannot prevent
  exit, and report incomplete output as a failure.
- Preserve an earlier command failure when stdout later reports EPIPE or another
  output error, instead of turning the command's result into success.

## [0.3.1] - 2026-10-01

### Added

- Optional `CRISPCTL_LIVE_RTM_MODE=auth` smoke verification for quiet websites;
  event-delivery verification remains the default and reports its mode explicitly.

### Changed

- Extend WSS E2E coverage with independent representative payload fixtures and
  malformed routing fields, alongside the full event namespace matrix.
- Require shared Node 20/24 verification before publishing, including typecheck,
  both coverage gates and a smoke test of the installed npm tarball.

### Fixed

- Reject malformed `Retry-After` dates, including incomplete timestamps, invalid
  calendar values and weekday mismatches, instead of scheduling excessive waits.
- Hide captured credential output when the live smoke's 1Password lookup fails.
- Honor discovery `Retry-After` headers, add jitter to reconnect delays, and keep
  long retry waits cancellable without overflowing Node timers.
- Normalize network failures while reading HTTP response bodies so RTM endpoint
  discovery reconnects after a partial-response disconnect, preserving known HTTP
  error statuses and retry hints when headers have already arrived.
- Handle closed stdout pipes without an uncaught EPIPE, drain queued output before
  exit, and stop RTM with an explicit error when a slow consumer exceeds the 8 MiB
  output buffer limit.

## [0.3.0] - 2026-10-01

### Added

- `listen --list-events` to inspect all documented RTM event names, token tiers,
  and scopes without connecting, with early rejection of known tier mismatches.
- RTM contract coverage for every website/plugin-eligible event, WSS E2E checks
  for both token tiers, and a dedicated RTM coverage gate in CI.

### Fixed

- Forward bucket URL events whose website is identified by `resource.id`, while
  rejecting other resource types, websites, and conflicting routing identifiers.
- Match `email:track:view` session events by `identifier` when using `--session`.
- Prevent false RTM live smoke failures by waiting for child output streams to close
  before counting received events and reporting the result.

## [0.2.0] - 2026-10-01

### Added

- RTM event streaming with `listen --json`, website and plugin token authentication,
  event and session filters, automatic reconnection, event limits, and deadlines.
- Read-only mode through `--read-only` or `CRISPCTL_READ_ONLY=1`, rejecting API writes
  and local credential updates before execution.
- Opt-in, read-only RTM live smoke testing using credentials from the 1Password CLI.

### Changed

- Test coverage now includes built-CLI E2E tests over local WSS, with CI on Node.js
  20 and 24 and higher aggregate coverage requirements.

## [0.1.0] - 2026-09-29

### Added

- Crisp REST CLI for listing and searching conversations, reading messages,
  replying, adding notes, resolving and reopening conversations, assigning
  operators, setting segments, and marking messages read.
- People profile lookup by ID or email and website operator listing.
- Named authentication profiles, environment overrides, JSON output, and
  credential redaction in errors.

[Unreleased]: https://github.com/solcreek/crisp-cli/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/solcreek/crisp-cli/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/solcreek/crisp-cli/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/solcreek/crisp-cli/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/solcreek/crisp-cli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/solcreek/crisp-cli/releases/tag/v0.1.0
