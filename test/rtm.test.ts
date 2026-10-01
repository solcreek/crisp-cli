import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import type { Socket } from "socket.io-client"
import { CrispClient, type ClientCredentials } from "../src/client.js"
import { run } from "../src/cli.js"
import { CrispApiError } from "../src/errors.js"
import { listen, parseEvents, positiveInteger, socketEndpoint, type ListenOptions, type SocketFactory } from "../src/rtm.js"
import { buffers, credentialEnv, FIXTURE, okEnvelope, removeHome, withCrispMock } from "./support.js"

const creds: ClientCredentials = { ...FIXTURE, tier: "website" }
const endpoint = { socket: { app: "wss://relay.crisp.chat/socket.io/?region=test" } }
class TestSocket extends EventEmitter {
  closed = false
  constructor(readonly authenticate: (payload: any, socket: TestSocket) => void) { super() }
  override emit(event: string, ...args: any[]): boolean {
    assert.equal(event, "authentication")
    this.authenticate(args[0], this)
    return true
  }
  receive(event: string, payload?: unknown): void { super.emit(event, payload) }
  connect(): this { queueMicrotask(() => { if (!this.closed) this.receive("connect") }); return this }
  disconnect(): this { this.closed = true; return this }
}
function harness(authenticate: (payload: any, socket: TestSocket) => void) {
  const sockets: TestSocket[] = []
  const factory: SocketFactory = (url, opts) => {
    assert.equal(url, "wss://relay.crisp.chat")
    assert.equal(opts?.path, "/socket.io/")
    assert.deepEqual(opts?.transports, ["websocket"])
    assert.equal(opts?.reconnection, false)
    const socket = new TestSocket(authenticate)
    sockets.push(socket)
    return socket as unknown as Socket
  }
  return { sockets, factory }
}
function options(factory: SocketFactory, extra: Partial<ListenOptions> = {}): ListenOptions {
  return { events: ["message:send"], signal: new AbortController().signal, onEvent: () => {}, onStatus: () => {}, socketFactory: factory, reconnectDelayMs: 1, ...extra }
}

test("endpoint discovery uses correct website and plugin routes and HTTP auth", async () => {
  for (const tier of ["website", "plugin"] as const) {
    const calls = await withCrispMock({ status: 200, json: okEnvelope(endpoint) }, async dispatcher => {
      assert.deepEqual(await new CrispClient({ ...creds, tier }, dispatcher, true).getConnectEndpoints(), endpoint)
    })
    assert.equal(calls[0]?.path, tier === "website" ? `/v1/website/${creds.websiteId}/connect/endpoints` : "/v1/plugin/connect/endpoints")
    assert.equal(calls[0]?.headers["x-crisp-tier"], tier)
    assert.equal(calls[0]?.headers.authorization, `Basic ${Buffer.from(`${creds.identifier}:${creds.key}`).toString("base64")}`)
  }
})

test("website authentication, site/session filters, NDJSON, count and cleanup", async () => {
  const h = harness((payload, socket) => {
    assert.deepEqual(payload, { tier: "website", username: creds.identifier, password: creds.key, events: ["message:send"], rooms: [creds.websiteId] })
    socket.receive("message:send", { website_id: creds.websiteId }) // Ignore before authentication.
    socket.receive("authenticated")
    socket.receive("message:send", null)
    socket.receive("message:send", { website_id: "other" })
    socket.receive("message:send", { website_id: creds.websiteId, session_id: "other" })
    socket.receive("message:send", { website_id: creds.websiteId, session_id: FIXTURE.session, content: creds.key })
  })
  const env = credentialEnv({ CRISP_TIER: "website" })
  const io = buffers()
  const signalsBefore = process.listenerCount("SIGINT")
  try {
    await withCrispMock({ status: 200, json: okEnvelope(endpoint) }, async dispatcher => {
      assert.equal(await run(["listen", "--json", "--read-only", "--events", "message:send", "--session", FIXTURE.session, "--count", "1"], { ...io, env, dispatcher, socketFactory: h.factory }), 0)
    })
    const lines = io.out().trim().split("\n")
    assert.equal(lines.length, 1)
    const event = JSON.parse(lines[0]!)
    assert.equal(event.event, "message:send")
    assert.equal(event.data.content, "[redacted]")
    assert.ok(Number.isFinite(Date.parse(event.received_at)))
    assert.equal(JSON.parse(io.err()).status, "authenticated")
    assert.ok(h.sockets.every(s => s.closed && s.eventNames().length === 0))
    assert.equal(process.listenerCount("SIGINT"), signalsBefore)
  } finally { removeHome(env) }
})

test("disconnect rediscovers endpoints, reauthenticates and preserves event count", async () => {
  let discoveries = 0
  const statuses: string[] = []
  const h = harness((_payload, socket) => {
    socket.receive("authenticated")
    socket.receive("message:send", { website_id: creds.websiteId })
    if (discoveries === 1) socket.receive("disconnect", "transport close")
  })
  await listen({ getConnectEndpoints: async () => { discoveries++; return endpoint } }, creds,
    options(h.factory, { count: 2, onStatus: value => statuses.push(value.status) }))
  assert.equal(discoveries, 2)
  assert.deepEqual(statuses, ["authenticated", "reconnecting", "authenticated"])
  assert.ok(h.sockets.every(s => s.closed))
})

test("transient discovery and connection failures retry; authorization failures stop", async () => {
  let discoveries = 0
  const h = harness((_payload, socket) => {
    if (discoveries === 2) socket.receive("connect_error", new Error(creds.key))
    else socket.receive("unauthorized", { secret: creds.key })
  })
  await assert.rejects(listen({ getConnectEndpoints: async () => {
    if (++discoveries === 1) throw new CrispApiError(503, "unavailable", "unavailable")
    return endpoint
  } }, creds, options(h.factory)), /RTM authentication rejected/)
  assert.equal(discoveries, 3)
  assert.ok(h.sockets.every(s => s.closed))
  await assert.rejects(listen({ getConnectEndpoints: async () => { throw new CrispApiError(403, "forbidden", "forbidden") } }, creds, options(h.factory)), /forbidden/)
})

test("authentication timeout retries; abort during retry stops without another connection", async () => {
  const controller = new AbortController()
  const h = harness(() => {})
  await listen({ getConnectEndpoints: async () => endpoint }, creds, options(h.factory, {
    signal: controller.signal, connectionTimeoutMs: 5,
    onStatus: () => { setTimeout(() => controller.abort(), 5) }, reconnectDelayMs: 1000,
  }))
  assert.equal(h.sockets.length, 1)
  assert.ok(h.sockets[0]?.closed)
})

test("abort closes active socket; pre-abort skips discovery", async () => {
  const controller = new AbortController()
  const h = harness((_payload, socket) => { socket.receive("authenticated"); controller.abort() })
  await listen({ getConnectEndpoints: async () => endpoint }, creds, options(h.factory, { signal: controller.signal }))
  assert.ok(h.sockets[0]?.closed)
  await listen({ getConnectEndpoints: async () => { throw new Error("must not discover") } }, creds, options(h.factory, { signal: controller.signal }))
})

test("output failure propagates and cleans up sockets", async () => {
  for (const callback of ["onEvent", "onStatus"] as const) {
    const h = harness((_payload, socket) => { socket.receive("authenticated"); socket.receive("message:send", { website_id: creds.websiteId }) })
    await assert.rejects(listen({ getConnectEndpoints: async () => endpoint }, creds,
      options(h.factory, { [callback]: () => { throw new Error("output failed") } })), /output failed/)
    assert.ok(h.sockets[0]?.closed)
  }
})

test("validation rejects malformed events, limits and insecure endpoints", () => {
  assert.deepEqual(parseEvents(), ["message:send", "message:received", "session:set_state"])
  assert.deepEqual(parseEvents("message:send, message:send"), ["message:send"])
  for (const value of ["", "connect", "message:send,", "*", "authentication"]) assert.throws(() => parseEvents(value))
  assert.equal(positiveInteger(undefined, "count"), undefined)
  assert.equal(positiveInteger("2", "count"), 2)
  for (const value of ["0", "-1", "1.5", "abc", "99999999999999999999"]) assert.throws(() => positiveInteger(value, "count"))
  for (const value of [null, {}, { socket: { app: "bad" } }, { socket: { app: "ws://host/" } }, { socket: { app: "wss://user:pass@host/" } }]) assert.throws(() => socketEndpoint(value), /secure RTM/)
})

test("CLI validates listen flags and deadline, aborts and reports timeout on stderr", async () => {
  const env = credentialEnv()
  try {
    for (const args of [["extra"], ["--events", "connect"], ["--timeout", "2147484"], ["--count", "0"], ["--session", ""]]) {
      const io = buffers()
      assert.equal(await run(["listen", ...args], { ...io, env }), 2)
    }
    const h = harness((_payload, socket) => socket.receive("authenticated"))
    const io = buffers()
    await withCrispMock({ status: 200, json: okEnvelope(endpoint) }, async dispatcher => {
      assert.equal(await run(["listen", "--json", "--timeout", "1"], { ...io, env, dispatcher, socketFactory: h.factory }), 1)
    })
    assert.equal(io.out(), "")
    assert.equal(JSON.parse(io.err().trim().split("\n").at(-1)!).error, "timeout")
    assert.ok(h.sockets[0]?.closed)
    const controller = new AbortController()
    controller.abort()
    assert.equal(await run(["listen"], { ...buffers(), env, signal: controller.signal }), 0)
  } finally { removeHome(env) }
})
