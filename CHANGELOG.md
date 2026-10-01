# Changelog

Notable changes to `crispctl` are recorded here.

Entries follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and releases use [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Honor discovery `Retry-After` headers, add jitter to reconnect delays, and keep
  long retry waits cancellable without overflowing Node timers.
- Normalize network failures while reading HTTP response bodies so RTM endpoint
  discovery reconnects after a partial-response disconnect.
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

[Unreleased]: https://github.com/solcreek/crisp-cli/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/solcreek/crisp-cli/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/solcreek/crisp-cli/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/solcreek/crisp-cli/releases/tag/v0.1.0
