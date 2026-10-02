import assert from "node:assert/strict"
import { createServer } from "node:https"
import { readFileSync } from "node:fs"
import { once } from "node:events"
import { setTimeout as delay } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { startWorker } from "../scripts/worker-client.mjs"

const fixture = fileURLToPath(new URL("./fixtures/stdio-loopback-cli.mjs", import.meta.url))
const source = fileURLToPath(new URL("../src/process-cli.ts", import.meta.url))
const cert = readFileSync(new URL("./fixtures/localhost-cert.pem", import.meta.url))
const key = readFileSync(new URL("./fixtures/localhost-key.pem", import.meta.url))

test(
  "worker subprocess reuses real TLS connections, isolates concurrent errors, and never replays on restart",
  { timeout: 15000 },
  async () => {
    let connections = 0
    let writes = 0
    const server = createServer({ cert, key }, (req, res) => {
      if (req.method !== "GET") writes++
      res.setHeader("content-type", "application/json")
      if (req.url.includes("slow")) {
        res.write('{"data":')
        return
      }
      if (req.url.includes("denied")) {
        res.writeHead(403)
        res.end(JSON.stringify({ error: true, reason: "denied" }))
        return
      }
      res.end(JSON.stringify({ error: false, data: { path: req.url } }))
    })
    server.on("secureConnection", () => connections++)
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const env = {
      CRISPCTL_CONFIG: "/nonexistent-fixture-config",
      CRISPCTL_IDENTIFIER: "fixture-id",
      CRISPCTL_KEY: "fixture-key",
      CRISPCTL_TIER: "website",
      CRISPCTL_WEBSITE_ID: "fixture-site",
      CRISPCTL_TEST_ENDPOINT: `https://127.0.0.1:${server.address().port}`,
      CRISPCTL_TEST_MODULE: source,
      ...(process.env.NODE_V8_COVERAGE ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE } : {}),
    }
    const args = ["--import", "tsx", fixture, "serve", "--stdio"]
    let w
    try {
      w = await startWorker(args, env)
      const commands = [
        ["conversations", "list"],
        ["conversations", "get", "session"],
        ["messages", "list", "session"],
      ]
      for (const reply of await Promise.all(commands.map((argv) => w.request(argv))))
        assert.equal(reply.ok, true)
      const initial = connections
      assert.ok(initial >= 1 && initial <= 4)
      for (let i = 0; i < 5; i++)
        for (const reply of await Promise.all(commands.map((argv) => w.request(argv))))
          assert.equal(reply.ok, true)
      assert.equal(connections, initial)
      const [failure, success] = await Promise.all([
        w.request(["conversations", "get", "denied"]),
        w.request(commands[0]),
      ])
      assert.equal(failure.error.status, 403)
      assert.equal(success.ok, true)
      assert.equal(
        (await w.request(["messages", "list", "slow"], 30)).error.error,
        "deadline_exceeded",
      )
      assert.equal((await w.request(["reply", "session", "--text", "synthetic"])).ok, true)
      assert.equal(writes, 1)
      // The server accepts this write but withholds the response. Killing the worker
      // leaves an unknown outcome; restarting must not send the operation again.
      const pending = w.request(["reply", "slow", "--text", "synthetic"])
      const rejected = assert.rejects(pending, /worker closed/)
      for (let attempt = 0; writes < 2 && attempt < 100; attempt++) await delay(5)
      assert.equal(writes, 2)
      w.child.kill("SIGKILL")
      await rejected
      await w.closed
      w = await startWorker([...args, "--read-only"], env)
      assert.equal((await w.request(commands[0])).ok, true)
      assert.equal(writes, 2)
      assert.equal((await w.stop()).code, 0)
    } finally {
      if (w) {
        w.child.kill("SIGKILL")
        await w.closed
      }
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  },
)

for (const ending of ["eof", "SIGTERM", "SIGINT"])
  test(`public executable negotiates and shuts down via ${ending}`, async () => {
    const bin = fileURLToPath(new URL("../dist/index.js", import.meta.url))
    const w = await startWorker([bin, "serve", "--stdio", "--read-only"], {
      CRISPCTL_CONFIG: "/nonexistent-fixture-config",
    })
    assert.equal(w.capabilities.capabilities.read_only, true)
    const result = await w.request(["auth", "show"])
    assert.equal(result.ok, true)
    if (ending === "eof") w.child.stdin.end()
    else w.child.kill(ending)
    assert.deepEqual(await w.closed, { code: 0, signal: null })
  })
