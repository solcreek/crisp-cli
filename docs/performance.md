# CLI performance measurements

Run `npm run bench` to build once and measure the actual `dist/index.js` executable
in fresh Node processes. The benchmark is offline: REST uses Undici MockAgent with
network access disabled, and RTM uses a real Socket.IO server over TLS on loopback.
Only synthetic records and credentials are used. Each child gets an isolated
configuration path and an environment allowlist; user credentials, `NODE_OPTIONS`
and V8 coverage settings are not inherited. The existing test certificate is
trusted explicitly without disabling TLS verification.

## Run and compare

```bash
npm run bench
npm run --silent bench -- --json > /tmp/crispctl-benchmark.json
npm run bench -- --scenario help --scenario rtm-first-event --samples 50 --warmup 5
```

The default is 30 measured samples and three discarded warmups **per scenario**.
Samples run sequentially with rotating scenario order. Do not run tests, builds
or another benchmark concurrently. Keep the same machine, Node version, power
mode, dependency lockfile and workloads for an A/B comparison. Alternate repeated
A/B runs if a difference is small; one p95 from 30 samples is not a regression
verdict. Different Node versions should be compared as separate baselines.

Use `node scripts/benchmark.mjs ...` to measure an existing build without rebuilding.
The npm command builds first, outside the timed interval. `--scenario` is repeatable;
`--help` lists all scenarios. `--samples` accepts 1–1000 and `--warmup` accepts 0–20.
Use `npm run --silent` when redirecting JSON so npm banners do not contaminate it.
Run on macOS or Linux with loopback listening permitted.

## What is measured

| Scenario                         | Contract checked                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `node-baseline`                  | Empty Node process using the same resource instrumentation                            |
| `version`, `help`, `nested-help` | Successful output without credentials                                                 |
| `usage-error`                    | Exit 2, JSON diagnostic on stderr, empty stdout                                       |
| `event-catalog`                  | Exact event catalog                                                                   |
| `rest-small`                     | One synthetic conversation                                                            |
| `rest-large`                     | 1,024 conversations, each with 1 KiB of content; roughly 1.07 MiB JSON output         |
| `rest-slow-reader`               | Same large response, pausing stdout consumption for 5 ms per 64 KiB consumed          |
| `rtm-first-event`                | Authenticated WSS and one complete event                                              |
| `rtm-burst`                      | 1,000 ordered events, each with 256 bytes of content; no dropped or truncated records |
| `rtm-cancel`                     | SIGTERM after the first complete event, clean exit and drained output                 |

- `wallMs`: parent time immediately before spawn until the child's `close` event,
  including module loading, command execution, shutdown and pipe drain.
- `firstOutputMs`: first stdout bytes observed by the parent; for `usage-error`,
  first stderr bytes. RTM authentication on stderr does not count as an event.
  The empty Node baseline has no first output. This is not terminal rendering time
  or necessarily the time a full large JSON document becomes parseable.
- `cancelMs`: time from sending SIGTERM to process close and completed pipe drain.
- `peakRssMiB` and `cpuMs`: child's `process.resourceUsage()` peak resident memory
  and summed user/system CPU time, captured on exit through a separate pipe.
  They include the tiny resource hook and, for REST/RTM, the mock REST fixture.
  Parent/server CPU and memory are excluded. CPU time can exceed wall time because
  Node can use multiple threads.
- `stdoutBytes`: actual UTF-8 output size, not an estimated payload size.
- `readerPauseMs`: total requested slow-reader delay, normalized by bytes rather
  than OS-dependent pipe chunk count. Actual timer delays can be longer.

The table shows p50/p95 wall time and p50 for other metrics. JSON retains all raw
samples and min/p50/p95/max for each metric, plus runtime, CPU model, Git revision,
working-tree dirty status, package version and methodology. Percentiles use
nearest rank; warmups are excluded. No hostname, username, filesystem paths,
credentials or conversation payloads are written to reports.

Every sample must pass the scenario's exit-code and output assertions. Each child
has a 15-second watchdog and a combined 4 MiB output cap. Failing or stalled samples
fail the run instead of contributing an artificially fast result. Temporary
configuration and the local server are cleaned up at the end.

## Interpretation and regression policy

These are fresh-process measurements with warm filesystem caches, not a cold disk
or first installation benchmark. REST does not measure DNS, TLS, rate limiting or
Crisp service latency. RTM measures local TLS and the real transport but not WAN
latency, reconnect recovery or long-running memory growth. The slow-reader workload
uses a fixed pause budget per byte volume, but OS pipe buffering still affects
delivery. It is not a fixed-bandwidth network simulation. Peak RSS is not evidence
of a memory leak.

`npm test` runs a one-sample, all-scenario contract check and tests percentile
calculation, environment isolation, cancellation, output caps and watchdogs.
It does not assert performance thresholds. Timing inside coverage tests is not a
usable performance baseline. CI's existing Node matrix verifies benchmark behavior;
full local runs produce the performance report separately.

Start with trends on a stable machine rather than absolute CI gates. Investigate
a repeatable increase in p50/p95 alongside raw outliers, CPU and RSS, and always
retain command correctness, redaction and cancellation tests when optimizing.
For CLI scripting DX, usage-error latency, deterministic JSON, complete output and
prompt cancellation are as relevant as help startup. Build and test-suite duration
are separate developer workflows and are not included in these CLI timings.
