import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { createServer } from "node:https"
import { once } from "node:events"
import { performance } from "node:perf_hooks"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { promisify, parseArgs } from "node:util"
import { startWorker } from "./worker-client.mjs"
import { summarize } from "./benchmark-process.mjs"

let phase = "setup"
async function main() {
  const { values } = parseArgs({
    options: {
      samples: { type: "string", default: "20" },
      baseline: { type: "string" },
      live: { type: "boolean", default: false },
    },
  })
  const samples = Number(values.samples)
  assert.ok(Number.isSafeInteger(samples) && samples >= 1 && samples <= 100, "invalid sample count")
  const root = fileURLToPath(new URL("../", import.meta.url))
  const baseline = resolve(values.baseline ?? root)
  const bin = resolve(root, "dist/index.js")
  const fixture = resolve(root, "test/fixtures/stdio-loopback-cli.mjs")
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => ["PATH", "SystemRoot", "WINDIR"].includes(key)),
  )
  let server,
    worker,
    connections = 0
  let session = "fixture-session"
  if (values.live) {
    assert.equal(
      process.env.CRISPCTL_LIVE_WORKER,
      "1",
      "live worker benchmark requires explicit opt-in",
    )
    const { resolveCredentials, assertComplete } = await import("../dist/config.js")
    const credentials = resolveCredentials(process.env, {})
    assertComplete(credentials)
    assert.ok(process.env.CRISPCTL_SANDBOX_WEBSITE_ID, "sandbox identity is required")
    assert.equal(
      credentials.websiteId,
      process.env.CRISPCTL_SANDBOX_WEBSITE_ID,
      "sandbox identity mismatch",
    )
    Object.assign(env, {
      CRISPCTL_IDENTIFIER: credentials.identifier,
      CRISPCTL_KEY: credentials.key,
      CRISPCTL_WEBSITE_ID: credentials.websiteId,
      CRISPCTL_TIER: credentials.tier,
    })
    session = process.env.CRISPCTL_LIVE_SESSION ?? ""
  } else {
    Object.assign(env, {
      CRISPCTL_IDENTIFIER: "fixture-id",
      CRISPCTL_KEY: "fixture-key",
      CRISPCTL_WEBSITE_ID: "fixture-site",
      CRISPCTL_TIER: "website",
    })
    server = createServer(
      {
        cert: readFileSync(new URL("../test/fixtures/localhost-cert.pem", import.meta.url)),
        key: readFileSync(new URL("../test/fixtures/localhost-key.pem", import.meta.url)),
      },
      (req, res) => {
        assert.equal(req.method, "GET")
        const conversation = !req.url.includes("/conversations/") && !req.url.endsWith("/messages")
        const body = conversation
          ? { session_id: session, state: "unresolved" }
          : [{ session_id: session }]
        res.setHeader("content-type", "application/json")
        setTimeout(() => res.end(JSON.stringify({ error: false, data: body })), 5)
      },
    )
    server.on("secureConnection", () => connections++)
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    env.CRISPCTL_TEST_ENDPOINT = `https://127.0.0.1:${server.address().port}`
  }
  const scratch = mkdtempSync(resolve(tmpdir(), "crispctl-worker-bench-"))
  env.CRISPCTL_CONFIG = resolve(scratch, "no-config.json")
  env.CRISPCTL_READ_ONLY = "1"
  // No user NODE_OPTIONS, coverage hooks, config paths or unrelated secrets reach children.
  const oneShotEnv = { ...env, CRISPCTL_TEST_MODULE: resolve(baseline, "dist/process-cli.js") }
  const entry = values.live ? resolve(baseline, "dist/index.js") : fixture
  async function invoke(argv) {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [entry, "--read-only", "--json", ...argv],
      {
        env: oneShotEnv,
        timeout: 25000,
        maxBuffer: 8 * 1024 * 1024,
      },
    )
    assert.equal(stderr, "")
    return JSON.parse(stdout)
  }
  try {
    if (!session) {
      phase = "session-discovery"
      const listed = await invoke(["conversations", "list", "--page", "1"])
      assert.ok(Array.isArray(listed), "invalid conversation list")
      session = listed.find((item) => typeof item?.session_id === "string")?.session_id
      assert.ok(session, "sandbox needs a conversation or CRISPCTL_LIVE_SESSION")
    }
    const commands = [
      ["conversations", "list", "--page", "1"],
      ["conversations", "get", session],
      ["messages", "list", session],
    ]
    const validate = (results) => {
      assert.ok(Array.isArray(results[0]), "invalid inbox shape")
      assert.ok(
        results[1] && typeof results[1] === "object" && !Array.isArray(results[1]),
        "invalid conversation shape",
      )
      assert.ok(Array.isArray(results[2]), "invalid messages shape")
    }
    phase = "worker-startup"
    worker = await startWorker(
      [values.live ? bin : fixture, "serve", "--stdio", "--read-only"],
      env,
      { timeoutMs: 600000 },
    )
    async function measure(mode) {
      phase = `${mode}-refresh`
      if (values.live) await delay(500)
      const before = connections
      const start = performance.now()
      const results =
        mode === "oneShot"
          ? await Promise.all(commands.map(invoke))
          : await Promise.all(
              commands.map(async (argv) => {
                const frame = await worker.request(argv)
                assert.equal(frame.ok, true, "worker request failed")
                return frame.result
              }),
            )
      validate(results)
      return {
        ms: performance.now() - start,
        newConnections: values.live ? null : connections - before,
      }
    }
    const first = await measure("worker")
    const pairs = []
    for (let index = 0; index < samples; index++) {
      const order = index % 2 ? ["worker", "oneShot"] : ["oneShot", "worker"]
      const pair = {}
      for (const mode of order) pair[mode] = await measure(mode)
      pairs.push(pair)
    }
    phase = "worker-shutdown"
    const closed = await worker.stop()
    assert.equal(closed.code, 0)
    const report = {
      schemaVersion: 1,
      mode: values.live ? "live-read-only" : "loopback-https",
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      samples,
      requestsPerRefresh: 3,
      betweenRefreshDelayMs: values.live ? 500 : 0,
      oneShotVersion: JSON.parse(readFileSync(resolve(baseline, "package.json"))).version,
      workerVersion: worker.capabilities.version,
      startupMs: worker.startupMs,
      firstRefresh: first,
      oneShotMs: summarize(pairs.map((p) => p.oneShot.ms)),
      warmWorkerMs: summarize(pairs.map((p) => p.worker.ms)),
      pairs,
    }
    process.stdout.write(JSON.stringify(report, null, 2) + "\n")
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    if (worker) {
      worker.child.kill("SIGKILL")
      await worker.closed
    }
    if (server) {
      server.closeAllConnections()
      await new Promise((done) => server.close(done))
    }
  }
}
// exec errors may contain customer output/arguments; never print their diagnostics.
main().catch(() => {
  process.stderr.write(`worker benchmark failed during ${phase}; no payloads recorded\n`)
  process.exitCode = 1
})
