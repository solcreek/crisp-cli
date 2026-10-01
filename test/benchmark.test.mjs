import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { measureProcess, summarize } from "../scripts/benchmark-process.mjs"

const resourceHook = fileURLToPath(
  new URL("../scripts/fixtures/benchmark-resources.mjs", import.meta.url),
)
const runner = fileURLToPath(new URL("../scripts/benchmark.mjs", import.meta.url))
const child = (code, options = {}) =>
  measureProcess(["--import", resourceHook, "-e", code], { env: {}, ...options })

test("benchmark uses nearest-rank tail percentiles without mutating samples", () => {
  const values = [100, ...Array.from({ length: 19 }, (_, index) => index + 1)]
  assert.deepEqual(summarize(values), { min: 1, p50: 10, p95: 19, max: 100 })
  assert.equal(values[0], 100)
  assert.deepEqual(summarize([4]), { min: 4, p50: 4, p95: 4, max: 4 })
  for (const invalid of [[], [-1], [NaN], [Infinity]]) assert.throws(() => summarize(invalid))
})

test("benchmark measures stderr feedback and retains unsuccessful exits for validation", async () => {
  const result = await child('console.error("synthetic error"); process.exitCode = 2', {
    outputStream: "stderr",
  })
  assert.equal(result.code, 2)
  assert.equal(result.stdout, "")
  assert.equal(result.stderr, "synthetic error\n")
  assert.ok(result.metrics.firstOutputMs > 0)
  assert.ok(result.metrics.wallMs >= result.metrics.firstOutputMs)
  assert.ok(result.metrics.peakRssMiB > 0)
  assert.equal(result.metrics.cancelMs, null)
})

test("benchmark waits for output drain and measures graceful signal cancellation", async () => {
  const result = await child(
    'process.on("SIGTERM", () => process.exit(0)); console.log("ready"); setInterval(() => {}, 1000)',
    { cancelAfterLine: true },
  )
  assert.equal(result.code, 0)
  assert.equal(result.signal, null)
  assert.equal(result.stdout, "ready\n")
  assert.ok(result.metrics.cancelMs > 0)
})

test("benchmark bounds stalled and excessively chatty children", async () => {
  await assert.rejects(child("setInterval(() => {}, 1000)", { timeoutMs: 100 }), /deadline/)
  await assert.rejects(
    child('console.log("x".repeat(4096))', { maxOutputBytes: 1024 }),
    /output limit/,
  )
  await assert.rejects(measureProcess(["-e", ""], { env: {} }), /resource metrics/)
  await assert.rejects(child("", { cwd: "/nonexistent-benchmark-directory" }), /could not start/)
})

test(
  "benchmark runs all offline CLI scenarios, validates output and reports metrics only",
  { timeout: 30_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "crispctl-bench-test-"))
    try {
      const poisoned = join(directory, "config.json")
      writeFileSync(poisoned, "invalid user configuration must not be loaded")
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        [runner, "--samples", "1", "--warmup", "0", "--json"],
        {
          env: {
            PATH: process.env.PATH,
            CRISPCTL_CONFIG: poisoned,
            CRISPCTL_KEY: "private-test-key",
          },
          timeout: 25_000,
          maxBuffer: 1024 * 1024,
        },
      )
      assert.equal(stderr, "")
      const report = JSON.parse(stdout)
      assert.equal(report.schemaVersion, 1)
      assert.equal(report.results.length, 12)
      assert.equal(report.samples, 1)
      const slow = report.results.find((result) => result.name === "rest-slow-reader").samples[0]
      assert.equal(slow.readerPauseMs, Math.floor(slow.stdoutBytes / (64 * 1024)) * 5)
      assert.doesNotMatch(
        stdout,
        /private-test-key|benchmark-key|benchmark-session|content|invalid user/,
      )
      for (const result of report.results) {
        assert.equal(result.samples.length, 1)
        assert.ok(result.summary.wallMs.p50 > 0)
        assert.ok(result.summary.peakRssMiB.p50 > 0)
        assert.equal(result.summary.firstOutputMs === null, result.name === "node-baseline")
        assert.equal(result.summary.cancelMs !== null, result.name === "rtm-cancel")
      }
      assert.ok(
        report.results.find((result) => result.name === "rest-large").summary.stdoutBytes.p50 >
          1024 * 1024,
      )
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  },
)

test("benchmark rejects invalid sample sizes and unknown scenarios before running", async () => {
  for (const args of [
    ["--samples", "0"],
    ["--warmup", "21"],
    ["--scenario", "missing"],
  ]) {
    await assert.rejects(
      promisify(execFile)(process.execPath, [runner, ...args], { env: {}, timeout: 5000 }),
      (error) => {
        assert.equal(error.code, 1)
        assert.match(error.stderr, /benchmark failed:/)
        assert.equal(error.stdout, "")
        return true
      },
    )
  }
})

test("benchmark filters scenarios and excludes warmups from raw samples", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      runner,
      "--scenario",
      "version",
      "--scenario",
      "usage-error",
      "--samples",
      "2",
      "--warmup",
      "1",
      "--json",
    ],
    { env: {}, timeout: 10_000 },
  )
  const report = JSON.parse(stdout)
  assert.equal(report.warmup, 1)
  assert.deepEqual(
    report.results.map((result) => result.name),
    ["version", "usage-error"],
  )
  for (const result of report.results) {
    assert.equal(result.samples.length, 2)
    assert.deepEqual(
      result.summary.wallMs,
      summarize(result.samples.map((sample) => sample.wallMs)),
    )
  }
})
