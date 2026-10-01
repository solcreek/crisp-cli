# Changelog

Notable changes to `crispctl` are recorded here.

Entries follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and releases use [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/solcreek/crisp-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/solcreek/crisp-cli/releases/tag/v0.1.0
