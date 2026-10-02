# Persistent REST transport (protocol 1)

Run `crispctl serve --stdio --read-only` as a child process with stdin/stdout pipes.
This amortizes Node/module startup and HTTPS connection setup over repeated reads.
Use `listen --json` separately for RTM subscriptions. Do not import internal modules
as a compatibility contract.

## Negotiation and fallback

The worker first writes one JSON `ready` frame followed by a newline:

```json
{
  "protocol": 1,
  "type": "ready",
  "version": "0.5.0",
  "capabilities": {
    "commands": ["conversations list", "conversations get", "messages list"],
    "cancellation": true,
    "read_only": true,
    "retries": false
  },
  "limits": {
    "concurrency": 4,
    "queue": 32,
    "requestBytes": 65536,
    "responseBytes": 1048576,
    "defaultTimeoutMs": 20000,
    "maxTimeoutMs": 120000
  }
}
```

The example command list is abbreviated. Inspect the actual advertised commands;
`version` is the installed package version and is independent of `protocol`.
Clients must validate the protocol, required capabilities and limits **before sending
operations**. Bound the handshake wait. If an older or custom `CRISPCTL_BIN` exits,
prints non-protocol output or lacks a required capability, terminate and reap it,
then use one-shot commands. Never probe support with a write operation.

## Requests and results

Each UTF-8 frame is one JSON object terminated by LF (CRLF is accepted):

```json
{"protocol":1,"type":"request","id":"refresh_1","argv":["conversations","list","--page","1"],"timeout_ms":10000}
{"protocol":1,"type":"request","id":"refresh_2","argv":["conversations","get","example-session"]}
```

IDs contain 1–64 ASCII letters, digits, underscores or hyphens and are echoed
verbatim. Use a fresh opaque counter for each request, never secrets or customer
identifiers. Concurrent responses can complete in any order. Each accepted request
has one terminal response while the output connection is usable:

```json
{"protocol":1,"type":"response","id":"refresh_1","ok":true,"code":0,"result":[]}
{"protocol":1,"type":"response","id":"refresh_2","ok":false,"code":1,"error":{"ok":false,"error":"not_found","reason":"not_found","status":404,"message":"not_found"}}
```

The worker forces JSON output and reuses the normal CLI parser, credential
resolution, REST operations and error payloads. `result` is the one-shot JSON
value. Command failures retain their CLI exit code in `code`; they do not exit
the worker. Credential keys are redacted from structured successes and errors.
stdout contains only protocol frames. stderr is reserved for process-level
failures; clients should treat a broken transport as a worker failure.

Finite REST commands and `auth show` are supported. `listen`, nested `serve`,
`auth set`, help and version invocations return `unsupported_command` (code 2).
Use capabilities/the handshake instead of these commands. Unknown command-line
flags and invalid arguments use existing CLI validation.

## Credentials and read-only policy

The child inherits credentials/configuration from its launch environment. Startup
`--profile` and `--website` set defaults; request flags can select another profile
or website using the usual CLI rules. Each invocation takes its own credential
snapshot when it resolves credentials. Configuration is not cached across requests.

`--read-only` at startup or `CRISPCTL_READ_ONLY=1` locks read-only for the process
lifetime. No request can override it, supply an environment object or mutate local
credentials. REST writes are available only when the worker starts without that
policy. One-shot `auth set` remains the way to update credentials.

## Cancellation, deadlines and shutdown

```json
{"protocol":1,"type":"cancel","id":"refresh_2"}
{"protocol":1,"type":"shutdown"}
```

Cancel messages have no separate acknowledgement. A pending target receives
`cancelled`; unknown or already completed IDs are ignored. Cancellation races with
completion, so clients must also accept a completed result. It does not roll back
an operation that the remote API already received.

`timeout_ms` starts at acceptance, including queue time, network and response-body
consumption. It defaults to 20 seconds and is limited to 120 seconds. The existing
20-second per-HTTP-request timeout still applies. Worker deadlines return
`deadline_exceeded`. Timers end when a terminal response is prepared; physical
output draining has a separate 5-second bound.

`shutdown`, stdin EOF/close, SIGINT and SIGTERM stop accepting input and abort queued
and active work. The worker drains available terminal responses, destroys its owned
connection pool and exits. Explicit shutdown/EOF normally end with `bye`; signal
cancellation or output failure may prevent delivery. Closing stdin is shutdown,
**not** a request to finish all outstanding reads successfully. Keep stdin open
until desired responses arrive. The parent must reap the process and impose a
bounded kill fallback if it does not exit.

No automatic restart or request replay occurs. On unexpected exit, pending writes
have **unknown outcome**; never replay them automatically. Read retries are the
caller's decision and must respect deadlines/rate limits. IDs provide correlation,
not server-side idempotency or deduplication across restarts.

## Bounds and errors

- Four concurrent operations; up to 32 additional pending requests. Capacity is
  retained through output drain. Excess requests receive `busy` without execution.
- Input frames: 64 KiB before LF; at most 128 string arguments; no NUL characters.
- Each encoded response is limited to 1 MiB. Oversized output returns
  `response_too_large` for that request; other requests remain usable.
- The process output queue is capped at 8 MiB. Writes wait for stream callbacks;
  a stalled reader times out after five seconds. An overflowing/broken output
  channel terminates the worker and cancels work; delivery is then not guaranteed.
- Invalid JSON/UTF-8, unknown fields, incompatible protocol versions, duplicate
  pending IDs, overlong input or truncated EOF produce a generic `error` frame
  and terminate the worker. Input content is not echoed in those diagnostics.

This is a local transport for a trusted parent process, not a network server or
multi-tenant authorization boundary. Never put credentials or customer payloads in
application logs. Maintain a continuously draining stdout reader.

## Verification and measurement

The offline suite covers concurrent results/errors, process-level read-only,
queue limits, cancellations during bodies and queue waits, shutdown, malformed
frames, redaction, output limits, real TLS connection reuse, forced worker death
and restart without replay. Installed-package smoke checks the public handshake.

`npm run bench:worker` compares three parallel one-shot processes with three
parallel requests to one worker. Fixtures use loopback HTTPS with certificate
verification enabled. Each response is parsed and validated; pairs alternate
measurement order. Worker startup and its first refresh are reported separately
from warm p50/p95. No speed threshold is imposed on shared CI.

To compare an already built baseline:

```sh
node scripts/benchmark-worker.mjs --baseline /path/to/built-checkout --samples 30
```

The live benchmark is off by default. In an explicitly authorized dedicated
sandbox, provide credentials through the environment or local config, set
`CRISPCTL_LIVE_WORKER=1` and `CRISPCTL_SANDBOX_WEBSITE_ID` to the independently
verified sandbox website ID, then run with `--live --samples 10`. Optionally set
`CRISPCTL_LIVE_SESSION`; otherwise it selects a session from the first inbox page
in memory. Both variants force read-only and pace refreshes by 500 ms outside the measured
interval. Failures stop the run without automatically retrying. Output contains timing/connection counts
only, never credentials, session IDs or response payloads. Live reports do not
instrument TLS counts (`newConnections` is null). Do not generalize loopback
latency savings to WAN performance or TUI startup.
