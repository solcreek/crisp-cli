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

Additional scenarios cover `auth-file` (synthetic stored credentials),
`invalid-page`, `read-only-write`, and `rest-error` (HTTP 429 with Retry-After).
There are now 16 scenarios. A contract failure identifies the scenario and exit
status without echoing its payload.

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

## Comparing builds and component costs

Build both checkouts first, then use the same benchmark driver and Node executable:

```bash
node scripts/benchmark.mjs --target /path/to/baseline --json > /tmp/before.json
node scripts/benchmark.mjs --target /path/to/candidate --json > /tmp/after.json
npm run --silent bench:stages > /tmp/stages.json
node scripts/benchmark-stages.mjs --target /path/to/baseline > /tmp/stages-before.json
```

`--target` selects the built CLI and its package/Git metadata. Fixtures remain
owned by the driver, so both builds receive the same synthetic workload. Paths are
not included in reports. A build outside Git reports a null revision.

Component benchmarks use 20 samples and three warmups by default (`--samples` is
configurable). Each time is for the **whole named batch**, including validation:
100 command trees; 100 tree constructions plus argument parsing; 100 config reads;
1,000 credential snapshot lookups; a roughly 1 MiB streamed body, decode or JSON
output; 1,000 redacted events; and a 50,000-record output queue with asynchronous
write callbacks. Assertions and fixture construction contribute to these numbers.
They locate repeatable costs but are not additive phases of an end-to-end request.
Run these separately from process benchmarks and tests to avoid CPU contention.

## Baseline: 2026-10-01

CLI source: `ee9186f` (version 0.4.0), measured with the benchmark introduced in
`36303a8`. No runtime optimization is included in this baseline. Both runs used
macOS arm64 on an Apple M3, three warmups and 30 measured samples per scenario.
Measurements used a working tree containing the new benchmark; runtime source
matched the source revision above. Values below are milliseconds.

| Scenario           | Node 24.21.0 p50 |    p95 | Node 22.12.0 p50 |    p95 |
| ------------------ | ---------------: | -----: | ---------------: | -----: |
| `node-baseline`    |            32.23 |  48.63 |            49.63 |  58.52 |
| `version`          |            89.88 | 154.28 |           122.04 | 233.99 |
| `help`             |            90.72 | 209.29 |           122.28 | 192.93 |
| `nested-help`      |            90.52 | 202.28 |           125.20 | 237.29 |
| `usage-error`      |            92.11 | 171.68 |           121.95 | 218.78 |
| `event-catalog`    |            91.40 | 209.62 |           126.67 | 204.63 |
| `rest-small`       |            95.35 | 178.76 |           124.31 | 171.11 |
| `rest-large`       |           104.90 | 183.98 |           135.16 | 331.59 |
| `rest-slow-reader` |           188.10 | 256.46 |           231.14 | 373.40 |
| `rtm-first-event`  |           110.35 | 178.28 |           152.54 | 253.44 |
| `rtm-burst`        |           130.56 | 233.68 |           186.96 | 300.36 |
| `rtm-cancel`       |           110.35 | 243.35 |           151.55 | 209.56 |

For `rtm-cancel`, the table above includes startup and delivery of the first event.
The signal-to-close latency alone was:

| Runtime  | Cancellation p50 |     p95 |
| -------- | ---------------: | ------: |
| v24.21.0 |          3.75 ms | 8.53 ms |
| v22.12.0 |          3.61 ms | 6.05 ms |

Both slow-reader runs scheduled exactly 85 ms of pauses for the same 1,123,244
output bytes. Pausing per pipe chunk instead would distort comparisons because
chunk sizes vary between Node versions, so the benchmark normalizes pauses to
64 KiB of consumed data.

On Node 24, p50 peak child RSS was about 73 MiB for help, 90 MiB for the large
REST response and 94 MiB for the RTM burst. This measures process peaks, not
retained memory after a long-running stream.

The same machine completed one full `npm run verify` on Node 24 in 28.20 seconds:
formatting, lint, type checking, build, 592 tests, three coverage gates and installed
package smoke. This single developer-loop observation includes coverage and npm
installation/cache effects; it is not a p95 or an offline CLI sample.

The first optimization candidate is startup dependency loading. Source inspection
shows that the command tree eagerly imports operations, which in turn load Undici
and Socket.IO even for help/version. Help and small synthetic REST calls have
similar elapsed times, consistent with startup being a substantial shared cost.
An isolated lazy-loading change should be compared with this baseline before
claiming a speedup; do not infer exact import costs by subtracting medians.

Tail latency varied noticeably between runs on this development machine. Treat
these numbers as an initial reference, not a cross-machine SLA or evidence that
one Node version is always faster. No live Crisp performance was measured.

## Optimization study against v0.5.0

Baseline runtime: `d7365ae` (`v0.5.0`). Candidate runtime: `c3b3460`. The driver
used identical synthetic fixtures for both built checkouts on the same Apple M3
macOS arm64 machine. Each full run used three warmups and 30 measured samples
per scenario, sequentially, without concurrent test suites. Node versions were
24.21.0 and 22.12.0. Values below are milliseconds for complete process lifetime.

| Scenario           | Node 24 before p50 | After p50 | Node 22 before p50 | After p50 |
| ------------------ | -----------------: | --------: | -----------------: | --------: |
| `node-baseline`    |              30.24 |     31.81 |              51.39 |     49.02 |
| `version`          |              83.85 |     42.09 |             130.83 |     60.48 |
| `help`             |              84.76 |     45.29 |             129.53 |     61.48 |
| `nested-help`      |              85.40 |     44.18 |             136.56 |     62.48 |
| `usage-error`      |              84.74 |     44.22 |             131.54 |     61.49 |
| `invalid-page`     |              85.22 |     46.23 |             136.51 |     62.81 |
| `read-only-write`  |              85.53 |     47.13 |             133.04 |     64.50 |
| `auth-file`        |              86.20 |     46.16 |             137.83 |     64.32 |
| `event-catalog`    |              84.78 |     45.96 |             134.77 |     64.93 |
| `rest-small`       |              91.64 |     78.84 |             139.65 |     97.79 |
| `rest-error`       |              91.22 |     78.98 |             141.37 |     97.77 |
| `rest-large`       |              99.95 |     91.41 |             150.07 |    112.40 |
| `rest-slow-reader` |             183.23 |    175.47 |             236.68 |    196.15 |
| `rtm-first-event`  |             102.88 |    114.94 |             159.44 |    152.98 |
| `rtm-burst`        |             122.54 |    126.24 |             202.50 |    172.12 |
| `rtm-cancel`       |             102.34 |    110.54 |             158.50 |    150.24 |

### Follow-up checks for variability

The sequential Node 24 run showed worse RTM wall times, unlike the exploratory
run. To check order/background-load effects, an additional **A → B → B → A** run
measured an empty Node control, RTM first event, 1,000-event burst and cancellation.
Each block used two warmups and 15 samples, yielding 30 samples per variant.
All four blocks are retained in the raw study reports. Combined results:

| Node 24 scenario  | Before p50 | After p50 | Before p95 | After p95 |
| ----------------- | ---------: | --------: | ---------: | --------: |
| `node-baseline`   |      31.91 |     29.87 |      38.78 |     33.42 |
| `rtm-first-event` |     107.56 |    101.96 |     142.75 |    132.83 |
| `rtm-burst`       |     132.15 |    118.87 |     255.56 |    144.34 |
| `rtm-cancel`      |     106.70 |    104.72 |     145.84 |    154.45 |

Signal-to-close alone was 3.61 → 3.37 ms p50 and
7.10 → 5.87 ms p95. First-event differences are small enough that
background load remains a plausible contributor; a consistent RTM startup
speedup is not established. The burst improvement is supported by the component
results below, but is not a WAN throughput measurement.

Node 22 slow-reader p95 also varied substantially, so it received its own A → B →
B → A check. Both variants scheduled exactly 85 ms of pauses. Wall p50 was
215.82 → 206.62 ms; p95 was 256.49 → 275.66 ms. This does not establish a
tail-latency improvement; keep recording tails instead of setting a hard gate
from this workstation sample.

### Component batches

Twenty samples and three warmups per batch, on the same machine. Each number
includes the assertions described above. Unchanged components are controls,
not claimed optimizations. Times are milliseconds for the entire batch.

| Batch                      | Node 24 before p50 | After p50 | Node 22 before p50 | After p50 |
| -------------------------- | -----------------: | --------: | -----------------: | --------: |
| `command-tree-100`         |             16.286 |     4.681 |             14.459 |     3.788 |
| `tree-and-parse-100`       |             16.080 |     4.951 |             15.151 |     4.044 |
| `config-file-100`          |              1.791 |     2.018 |              1.964 |     1.891 |
| `credential-snapshot-1000` |              0.037 |     0.043 |              0.036 |     0.033 |
| `body-read-1mib`           |              0.891 |     0.899 |              0.682 |     0.605 |
| `decode-1mib`              |              0.516 |     0.564 |              0.493 |     0.481 |
| `json-output-1mib`         |              1.329 |     1.555 |              1.328 |     1.313 |
| `redact-1000-events`       |              7.783 |     3.361 |              8.170 |     3.615 |
| `output-queue-50000`       |            232.297 |    14.192 |            918.017 |    14.420 |

### Changes supported by the measurements

- **Startup:** defer operation modules and load Undici/Socket.IO at their actual
  use boundaries. Cold-process tests reject any unexpected transport imports for
  help, config, catalog, invalid arguments and read-only writes. Cancellation
  during HTTP-module loading is checked before dispatch.
- **Command construction:** allocate only each command’s declared local options;
  keep a fresh Commander tree per invocation.
- **Redaction:** compile the escaped, longest-first secret pattern once per JSON
  serialization. Patterns and object copies remain local to that serialization.
- **Output queue:** clear consumed slots immediately and compact the remaining
  array periodically, avoiding a shift of the whole backlog for every write.
  Byte limits, single in-flight writes, error handling and cancellation remain
  exercised by behavior tests.

Help peak RSS on Node 24 fell from 73.34 to 52.16 MiB (p50).
Configuration, credential snapshots, body reading and JSON decoding already
account for small measured batches; their small differences are not attributed
to these changes. The bounded/cancellable response reader retains its existing
implementation.

Remaining limits: these measurements do not characterize live Crisp/DNS/WAN
latency, sustained RTM heap growth, reconnect recovery distributions or terminal
rendering. Existing transport, retry, backpressure and cancellation tests cover
behavior; the numbers here support the specific local optimizations above, not
a claim that every path or tail percentile is optimal.

### Reused output pipeline

`npm run bench:soak` builds the CLI and runs the output-only probe with
`--expose-gc`. To compare an existing build, run
`node --expose-gc scripts/benchmark-output-soak.mjs /path/to/built-checkout`.
It warms up 5,000 records, then processes 100,000 records in batches of 1,000
through one reused sink, checking ordering and secret redaction. Memory snapshots
follow forced GC after warmup and every 20,000 measured records.

| Runtime  | Before duration | After duration | Before heap range | After heap range |
| -------- | --------------: | -------------: | ----------------: | ---------------: |
| v24.21.0 |       477.73 ms |      255.61 ms |     4.21–4.27 MiB |    4.21–4.28 MiB |
| v22.12.0 |       527.20 ms |      292.60 ms |     4.04–4.10 MiB |    4.03–4.12 MiB |

These are single observed durations including validation and GC, not p50/p95.
The retained heap stayed within roughly 0.1 MiB during this probe. That supports
repeated output-queue reuse in this workload; it is not proof against all memory
leaks and does not exercise a long-lived Socket.IO connection.
