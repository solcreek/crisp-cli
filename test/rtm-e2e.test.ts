import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { readFileSync } from "node:fs"
import { createServer } from "node:https"
import type { AddressInfo } from "node:net"
import { test, type TestContext } from "node:test"
import { fileURLToPath } from "node:url"
import { Server, type Socket } from "socket.io"
import { credentialEnv, FIXTURE, removeHome } from "./support.js"

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
async function server(t: TestContext, authenticate: (socket: Socket, payload: any) => void): Promise<string> {
  const https = createServer({ key: readFileSync(path("./fixtures/localhost-key.pem")), cert: readFileSync(path("./fixtures/localhost-cert.pem")) })
  const sockets = new Server(https, { path: "/rtm/", transports: ["websocket"] })
  sockets.on("connection", socket => socket.on("authentication", payload => authenticate(socket, payload)))
  https.listen(0, "127.0.0.1")
  await once(https, "listening")
  t.after(() => new Promise<void>(resolve => sockets.close(() => resolve())))
  return `wss://127.0.0.1:${(https.address() as AddressInfo).port}/rtm/`
}
function cli(t: TestContext, endpoint: string, args: string[]) {
  const env = credentialEnv({ CRISP_TIER: "website" })
  const child = spawn(process.execPath, ["--import", path("./fixtures/mock-crisp.mjs"), path("../dist/index.js"), ...args], {
    env: {
      ...process.env, ...env,
      CRISPCTL_IDENTIFIER: FIXTURE.identifier, CRISPCTL_KEY: FIXTURE.key,
      CRISPCTL_WEBSITE_ID: FIXTURE.websiteId, CRISPCTL_TIER: "website", CRISPCTL_READ_ONLY: "1",
      CRISPCTL_CONFIG: `${env.HOME}/config.json`, NODE_EXTRA_CA_CERTS: path("./fixtures/localhost-cert.pem"),
      CRISPCTL_TEST_ENDPOINT: endpoint,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  })
  let stdout = ""
  let stderr = ""
  let discoveries = 0
  child.stdout!.setEncoding("utf8").on("data", chunk => { stdout += chunk })
  child.stderr!.setEncoding("utf8").on("data", chunk => { stderr += chunk })
  child.on("message", message => { if ((message as { type: string }).type === "discovery") discoveries++ })
  const completed = once(child, "close").then(([code, signal]) => ({ code, signal, stdout, stderr, discoveries }))
  // Keep failed assertions from leaving a child or a live socket behind.
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    await completed
    removeHome(env)
  })
  return { child, completed }
}

test("E2E built listen uses WSS, filters events, reconnects and emits clean NDJSON", { timeout: 15_000 }, async t => {
  let connections = 0
  const authentications: unknown[] = []
  const endpoint = await server(t, (socket, payload) => {
    authentications.push(payload)
    connections++
    socket.emit("authenticated")
    socket.emit("message:send", { website_id: "another-site", content: "do not output" })
    socket.emit("message:send", { website_id: FIXTURE.websiteId, session_id: "another-session" })
    socket.emit("message:send", { website_id: FIXTURE.websiteId, session_id: FIXTURE.session, content: `event ${connections}\nsecond line` })
    if (connections === 1) setTimeout(() => socket.disconnect(true), 25)
  })
  const { completed } = cli(t, endpoint, ["listen", "--json", "--read-only", "--events", "message:send", "--session", FIXTURE.session, "--count", "2", "--timeout", "10"])
  const result = await completed
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.discoveries, 2)
  assert.equal(connections, 2)
  for (const auth of authentications) assert.deepEqual(auth, { tier: "website", username: FIXTURE.identifier, password: FIXTURE.key, events: ["message:send"], rooms: [FIXTURE.websiteId] })
  const events = result.stdout.trim().split("\n").map(line => JSON.parse(line))
  assert.equal(events.length, 2)
  assert.deepEqual(events.map(event => event.data.content), ["event 1\nsecond line", "event 2\nsecond line"])
  assert.ok(events.every(event => event.event === "message:send" && Number.isFinite(Date.parse(event.received_at))))
  assert.deepEqual(result.stderr.trim().split("\n").map(line => JSON.parse(line).status), ["authenticated", "reconnecting", "authenticated"])
  assert.ok(!`${result.stdout}${result.stderr}`.includes(FIXTURE.key))
})

test("E2E unauthorized is fatal, redacted and does not reconnect", { timeout: 10_000 }, async t => {
  const endpoint = await server(t, socket => socket.emit("unauthorized", { message: FIXTURE.key }))
  const result = await cli(t, endpoint, ["listen", "--json", "--timeout", "5"]).completed
  assert.equal(result.code, 1)
  assert.equal(result.discoveries, 1)
  assert.equal(result.stdout, "")
  assert.equal(JSON.parse(result.stderr).error, "unauthorized")
  assert.ok(!result.stderr.includes(FIXTURE.key))
})

test("E2E SIGTERM closes a live socket and exits cleanly", { timeout: 10_000 }, async t => {
  let disconnected!: () => void
  const closed = new Promise<void>(resolve => { disconnected = resolve })
  const endpoint = await server(t, socket => {
    socket.on("disconnect", disconnected)
    socket.emit("authenticated")
  })
  const { child, completed } = cli(t, endpoint, ["listen", "--json", "--timeout", "5"])
  let status = ""
  child.stderr!.on("data", chunk => {
    status += chunk
    if (status.includes('"authenticated"')) child.kill("SIGTERM")
  })
  const result = await completed
  await closed
  assert.equal(result.code, 0)
  assert.equal(result.signal, null)
  assert.equal(result.stdout, "")
})

test("E2E read-only rejects a write with exit 2 before HTTP or socket access", { timeout: 10_000 }, async t => {
  const result = await cli(t, "wss://127.0.0.1:1/rtm/", ["reply", FIXTURE.session, "--note", "must never send", "--json"]).completed
  assert.equal(result.code, 2)
  assert.equal(result.discoveries, 0)
  assert.equal(result.stdout, "")
  assert.match(JSON.parse(result.stderr).message, /read-only mode/)
})
