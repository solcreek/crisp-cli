import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { once } from "node:events"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:https"
import { arch, cpus, platform, tmpdir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { fileURLToPath } from "node:url"
import { Server } from "socket.io"
import { RTM_EVENTS } from "../dist/rtm-events.js"
import { measureProcess, summarize } from "./benchmark-process.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const path = (relative) => join(root, relative)
const cli = path("dist/index.js")
const resources = path("scripts/fixtures/benchmark-resources.mjs")
const api = path("scripts/fixtures/benchmark-api.mjs")
const cert = path("test/fixtures/localhost-cert.pem")
const scenarios = [
  { name: "node-baseline", args: ["-e", ""], kind: "node" },
  { name: "version", args: ["--version"], kind: "version" },
  { name: "help", args: ["--help"], kind: "help" },
  { name: "nested-help", args: ["conversations", "pages", "--help"], kind: "help" },
  { name: "usage-error", args: ["conversations", "pages", "--json"], kind: "usage" },
  { name: "event-catalog", args: ["listen", "--list-events", "--json"], kind: "catalog" },
  { name: "rest-small", kind: "rest", count: 1 },
  { name: "rest-large", kind: "rest", count: 1024 },
  { name: "rest-slow-reader", kind: "rest", count: 1024, pauseMs: 5 },
  { name: "rtm-first-event", kind: "rtm", count: 1 },
  { name: "rtm-burst", kind: "rtm", count: 1000 },
  { name: "rtm-cancel", kind: "rtm", count: 1, cancelAfterLine: true },
]

function options() {
  const { values } = parseArgs({
    options: {
      samples: { type: "string", default: "30" },
      warmup: { type: "string", default: "3" },
      scenario: { type: "string", multiple: true },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  })
  if (values.help) {
    console.log("Usage: npm run bench -- [--samples 30] [--warmup 3] [--scenario NAME] [--json]")
    console.log(`Scenarios: ${scenarios.map((scenario) => scenario.name).join(", ")}`)
    return null
  }
  for (const [key, min, max] of [
    ["samples", 1, 1000],
    ["warmup", 0, 20],
  ]) {
    if (!/^\d+$/.test(values[key]) || Number(values[key]) < min || Number(values[key]) > max)
      throw new Error(`--${key} must be an integer from ${min} to ${max}`)
  }
  const selected = values.scenario ?? scenarios.map((scenario) => scenario.name)
  for (const name of selected)
    if (!scenarios.some((scenario) => scenario.name === name))
      throw new Error(`unknown benchmark scenario: ${name}`)
  return {
    samples: Number(values.samples),
    warmup: Number(values.warmup),
    json: values.json,
    scenarios: scenarios.filter((scenario) => selected.includes(scenario.name)),
  }
}

function validate(scenario, result, version) {
  assert.equal(result.signal, null)
  assert.equal(result.code, scenario.kind === "usage" ? 2 : 0)
  if (scenario.kind === "usage") {
    assert.equal(result.stdout, "")
    assert.equal(JSON.parse(result.stderr).error, "usage")
    return
  }
  if (scenario.kind !== "rtm") assert.equal(result.stderr, "")
  switch (scenario.kind) {
    case "node":
      assert.equal(result.stdout, "")
      break
    case "version":
      assert.equal(result.stdout.trim(), version)
      break
    case "help":
      assert.match(result.stdout, /Usage:/)
      assert.match(result.stdout, /--json/)
      break
    case "catalog": {
      const events = JSON.parse(result.stdout).events
      assert.deepEqual(events, RTM_EVENTS)
      assert.ok(events.some((entry) => entry.event === "message:received"))
      break
    }
    case "rest": {
      const rows = JSON.parse(result.stdout)
      assert.equal(rows.length, scenario.count)
      for (const [index, row] of rows.entries()) {
        assert.equal(row.session_id, `benchmark-session-${index}`)
        assert.equal(row.state, "unresolved")
        assert.equal(row.content, "x".repeat(1024))
      }
      break
    }
    case "rtm": {
      const records = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      assert.equal(records.length, scenario.count)
      for (const [index, record] of records.entries()) {
        assert.equal(record.event, "message:received")
        assert.equal(record.data.website_id, "benchmark-site")
        assert.equal(record.data.session_id, "benchmark-session")
        assert.ok(Number.isFinite(Date.parse(record.received_at)))
        assert.equal(record.data.index, index)
        assert.equal(record.data.content, "x".repeat(256))
      }
      const statuses = result.stderr
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      assert.deepEqual(
        statuses.map((status) => status.status),
        ["authenticated"],
      )
      if (scenario.cancelAfterLine) assert.ok(result.metrics.cancelMs !== null)
      break
    }
  }
}

async function main() {
  const config = options()
  if (!config) return
  const pkg = JSON.parse(readFileSync(path("package.json"), "utf8"))
  const directory = mkdtempSync(join(tmpdir(), "crispctl-benchmark-"))
  // An allowlist isolates user configuration, credentials, coverage and Node hooks.
  const env = {
    HOME: directory,
    CRISPCTL_CONFIG: join(directory, "absent.json"),
    CRISPCTL_READ_ONLY: "1",
    LANG: "C",
    TZ: "UTC",
  }
  let sockets
  let endpoint
  let activeCount = 0
  const results = new Map(config.scenarios.map((scenario) => [scenario.name, []]))
  try {
    if (config.scenarios.some((scenario) => scenario.kind === "rtm")) {
      const https = createServer({
        key: readFileSync(path("test/fixtures/localhost-key.pem")),
        cert: readFileSync(cert),
      })
      sockets = new Server(https, { path: "/rtm/", transports: ["websocket"] })
      sockets.on("connection", (socket) => {
        socket.on("authentication", () => {
          socket.emit("authenticated")
          for (let index = 0; index < activeCount; index++)
            socket.emit("message:received", {
              website_id: "benchmark-site",
              session_id: "benchmark-session",
              index,
              content: "x".repeat(256),
            })
        })
      })
      https.listen(0, "127.0.0.1")
      await once(https, "listening")
      endpoint = `wss://127.0.0.1:${https.address().port}/rtm/`
    }
    async function sample(scenario) {
      activeCount = scenario.count ?? 0
      const childEnv = { ...env }
      const args = ["--import", resources]
      if (scenario.kind === "rest" || scenario.kind === "rtm") {
        args.push("--import", api)
        Object.assign(childEnv, {
          CRISPCTL_IDENTIFIER: "benchmark-identifier",
          CRISPCTL_KEY: "benchmark-key",
          CRISPCTL_TIER: "website",
          CRISPCTL_WEBSITE_ID: "benchmark-site",
        })
      }
      if (scenario.kind === "node") args.push(...scenario.args)
      else if (scenario.kind === "rest") {
        childEnv.CRISPCTL_BENCH_LARGE = scenario.count === 1024 ? "1" : "0"
        args.push(cli, "conversations", "list", "--json")
      } else if (scenario.kind === "rtm") {
        childEnv.CRISPCTL_BENCH_ENDPOINT = endpoint
        childEnv.NODE_EXTRA_CA_CERTS = cert
        args.push(cli, "listen", "--json", "--events", "message:received", "--timeout", "10")
        if (!scenario.cancelAfterLine) args.push("--count", String(scenario.count))
      } else args.push(cli, ...scenario.args)
      const result = await measureProcess(args, {
        cwd: root,
        env: childEnv,
        outputStream: scenario.kind === "usage" ? "stderr" : "stdout",
        pauseMs: scenario.pauseMs,
        cancelAfterLine: scenario.cancelAfterLine,
      })
      validate(scenario, result, pkg.version)
      return result.metrics
    }
    // Rotate scenario order to reduce bias from temperature or background work.
    for (let round = -config.warmup; round < config.samples; round++) {
      const offset = (round + config.warmup) % config.scenarios.length
      const ordered = [...config.scenarios.slice(offset), ...config.scenarios.slice(0, offset)]
      for (const scenario of ordered) {
        const metrics = await sample(scenario)
        if (round >= 0) results.get(scenario.name).push(metrics)
      }
    }
    let revision = null
    let dirty = null
    try {
      revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
      dirty = Boolean(
        execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim(),
      )
    } catch {
      /* A source archive need not contain Git metadata. */
    }
    const report = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      version: pkg.version,
      revision,
      dirty,
      runtime: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
      methodology:
        "Fresh processes, warm filesystem caches, sequential rotated scenarios; synthetic REST, loopback WSS; no live API. Instrumented child peak RSS and CPU; parent-observed latency includes pipe drain.",
      samples: config.samples,
      warmup: config.warmup,
      results: [...results].map(([name, samples]) => ({
        name,
        summary: Object.fromEntries(
          Object.keys(samples[0]).map((metric) => {
            const values = samples.map((entry) => entry[metric]).filter((value) => value !== null)
            return [metric, values.length ? summarize(values) : null]
          }),
        ),
        samples,
      })),
    }
    if (config.json) console.log(JSON.stringify(report, null, 2))
    else {
      console.log(
        `${report.runtime.node} ${report.runtime.platform}/${report.runtime.arch}; ${config.samples} samples, ${config.warmup} warmups per scenario`,
      )
      console.log("scenario                 p50 ms   p95 ms   first ms   RSS MiB   cancel ms")
      for (const result of report.results) {
        const summary = result.summary
        const value = (metric, rank = "p50") => summary[metric]?.[rank].toFixed(2) ?? "-"
        console.log(
          [
            result.name.padEnd(24),
            value("wallMs").padStart(8),
            value("wallMs", "p95").padStart(9),
            value("firstOutputMs").padStart(11),
            value("peakRssMiB").padStart(10),
            value("cancelMs").padStart(12),
          ].join(""),
        )
      }
      console.log(
        "REST is synthetic; WSS is loopback. First output, RSS and cancellation columns show p50. Use --json for raw samples and all percentiles.",
      )
    }
  } finally {
    if (sockets) await new Promise((resolve) => sockets.close(resolve))
    rmSync(directory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`benchmark failed: ${error.message}`)
  process.exitCode = 1
})
