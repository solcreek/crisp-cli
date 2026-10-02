import assert from "node:assert/strict"
import { PassThrough, Writable } from "node:stream"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"
import { MockAgent, type Dispatcher } from "undici"
import { run } from "../src/cli.js"
import { runProcess } from "../src/process-cli.js"
import { parseMessage, WORKER_LIMITS } from "../src/stdio-protocol.js"
import { BodyDispatcher } from "./body-dispatcher.js"
import {
  buffers,
  credentialEnv,
  FIXTURE,
  removeHome,
  withCrispMock,
  okEnvelope,
} from "./support.js"

// The harness exercises the same process lifecycle with bounded real streams.
async function worker(dispatcher?: Dispatcher, args: string[] = ["--read-only"], extra = {}) {
  const env = credentialEnv(extra)
  const input = new PassThrough()
  const frames: any[] = []
  let stderr = ""
  const output = new Writable({
    write(chunk, _encoding, done) {
      frames.push(JSON.parse(String(chunk)))
      done()
    },
  })
  const diagnostic = new Writable({
    write(chunk, _encoding, done) {
      stderr += String(chunk)
      done()
    },
  })
  const controller = new AbortController()
  const result = runProcess(["serve", "--stdio", ...args], output, diagnostic, {
    env,
    stdin: input,
    dispatcher,
    signal: controller.signal,
    drainTimeoutMs: 100,
  })
  async function until(predicate: () => boolean) {
    for (let i = 0; i < 500; i++) {
      if (predicate()) return
      await delay(2)
    }
    assert.fail("worker response deadline")
  }
  await until(() => frames.length > 0)
  const send = (frame: object) => input.write(JSON.stringify({ protocol: 1, ...frame }) + "\n")
  const request = (id: string, argv = ["operators", "list"], timeout_ms?: number) =>
    send({ type: "request", id, argv, timeout_ms })
  const response = async (id: string) => {
    await until(() => frames.some((f) => f.type === "response" && f.id === id))
    return frames.find((f) => f.type === "response" && f.id === id)
  }
  return {
    env,
    input,
    output,
    frames,
    result,
    controller,
    until,
    send,
    request,
    response,
    async close() {
      input.end()
      const code = await result
      removeHome(env)
      assert.equal(stderr, "")
      return code
    },
  }
}

test("serve validates process ownership and explicit stdio selection", async () => {
  for (const argv of [["serve"], ["serve", "--stdio"]]) {
    const io = buffers()
    assert.equal(
      await run([...argv, "--json"], {
        ...io,
        env: { CRISPCTL_CONFIG: "/nonexistent-test-config" },
      }),
      2,
    )
    assert.equal(JSON.parse(io.err()).error, "usage")
  }
})

test("worker isolates parallel successes/errors, preserves IDs, and redacts structured success data", async () => {
  const key = 'key-"quoted"'
  const dispatcher = new MockAgent()
  dispatcher.disableNetConnect()
  const pool = dispatcher.get("https://api.crisp.chat")
  pool
    .intercept({ method: "GET", path: `/v1/website/${FIXTURE.websiteId}/conversation/a` })
    .reply(200, okEnvelope({ [key]: key, n: 3 }))
    .delay(20)
  pool
    .intercept({ method: "GET", path: `/v1/website/${FIXTURE.websiteId}/conversation/b` })
    .reply(429, { error: true, reason: key }, { headers: { "retry-after": "3" } })
  pool
    .intercept({ method: "GET", path: `/v1/website/${FIXTURE.websiteId}/conversation/c` })
    .reply(200, okEnvelope(["third"]))
  const w = await worker(dispatcher, ["--read-only"], { CRISP_KEY: key })
  try {
    assert.equal(w.frames[0].capabilities.read_only, true)
    assert.equal(w.frames[0].limits.concurrency, 4)
    for (const id of ["a", "b", "c"]) w.request(id, ["conversations", "get", id])
    assert.deepEqual((await w.response("a")).result, { "[redacted]": "[redacted]", n: 3 })
    const b = await w.response("b")
    assert.equal(b.ok, false)
    assert.equal(b.error.status, 429)
    assert.equal(b.error.retry_after, "3")
    assert.equal(b.error.reason, "[redacted]")
    assert.deepEqual((await w.response("c")).result, ["third"])
    assert.equal(w.frames.filter((f) => f.type === "response").length, 3)
  } finally {
    assert.equal(await w.close(), 0)
    await dispatcher.close()
  }
})

for (const mode of ["flag", "env"])
  test(`worker locks read-only via ${mode} and rejects local mutation/nesting/streaming`, async () => {
    const calls = await withCrispMock({ status: 200, json: okEnvelope({}) }, async (dispatcher) => {
      const w = await worker(
        dispatcher,
        mode === "flag" ? ["--read-only"] : [],
        mode === "env" ? { CRISPCTL_READ_ONLY: "1" } : {},
      )
      try {
        const commands = [
          ["reply", "session", "--text", "hello"],
          ["resolve", "session"],
          ["reopen", "session"],
          ["assign", "session", "--unassign"],
          ["segments", "session", "--set", ""],
          ["read", "session"],
          ["auth", "set"],
          ["serve", "--stdio"],
          ["listen"],
          ["--version"],
          ["--help"],
          ["resolve", "session", "--read-only=false"],
          ["resolve", "session", "--no-read-only"],
        ]
        for (const [index, argv] of commands.entries()) {
          w.request(String(index), argv)
          assert.equal((await w.response(String(index))).code, 2)
        }
        w.request("valid", ["auth", "show"])
        assert.equal((await w.response("valid")).ok, true)
      } finally {
        await w.close()
      }
    })
    assert.equal(calls.length, 0)
  })

test("write-capable worker performs a write once and rejects auth set", async () => {
  const calls = await withCrispMock(
    { status: 200, json: okEnvelope({ saved: true }) },
    async (dispatcher) => {
      const w = await worker(dispatcher, [])
      try {
        assert.equal(w.frames[0].capabilities.read_only, false)
        w.request("write", ["reply", "session", "--text", "synthetic"])
        assert.equal((await w.response("write")).ok, true)
        w.request("local", ["auth", "set"])
        assert.equal((await w.response("local")).error.error, "unsupported_command")
      } finally {
        await w.close()
      }
    },
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.method, "POST")
})

test("worker snapshots startup profile/website and permits per-request website overrides", async () => {
  const calls = await withCrispMock({ status: 200, json: okEnvelope({}) }, async (dispatcher) => {
    const w = await worker(dispatcher, ["--profile", "test", "--website", "startup-site"])
    try {
      w.env.CRISP_KEY = "changed-after-start"
      w.request("first")
      await w.response("first")
      w.request("second", ["operators", "list", "--website", "request-site"])
      await w.response("second")
    } finally {
      await w.close()
    }
  })
  assert.match(calls[0]!.path, /startup-site/)
  assert.match(calls[1]!.path, /request-site/)
  assert.equal(
    calls[0]!.headers.authorization,
    `Basic ${Buffer.from(`${FIXTURE.identifier}:${FIXTURE.key}`).toString("base64")}`,
  )
})

test("concurrency/queue limits, queued cancellation/deadline, active body cancellation and recovery", async () => {
  const handlers: Dispatcher.DispatchHandlers[] = []
  const dispatcher = new BodyDispatcher((handler) => {
    handlers.push(handler)
    handler.onData!(Buffer.from('{"data":'))
  })
  const w = await worker(dispatcher)
  try {
    for (let i = 0; i < 36; i++) w.request(`r${i}`)
    w.request("overflow")
    await w.until(() => dispatcher.attempts === 4)
    assert.equal((await w.response("overflow")).error.error, "busy")
    w.send({ type: "cancel", id: "r4" })
    assert.equal((await w.response("r4")).error.error, "cancelled")
    await delay(0) // Allow the output callback to release its reserved queue slot.
    w.request("queued-timeout", ["operators", "list"], 5)
    assert.equal((await w.response("queued-timeout")).error.error, "deadline_exceeded")
    assert.equal(dispatcher.attempts, 4)
    w.send({ type: "cancel", id: "r0" })
    assert.equal((await w.response("r0")).error.error, "cancelled")
    await w.until(() => dispatcher.attempts === 5)
    w.send({ type: "cancel", id: "missing" })
    w.send({ type: "shutdown" })
    assert.equal(await w.result, 0)
    assert.equal(w.frames.filter((f) => f.type === "response").length, 38)
    assert.equal(w.frames.at(-1).type, "bye")
  } finally {
    await w.close()
  }
})

for (const trigger of ["deadline", "signal", "eof", "close"])
  test(`worker aborts a pending response body on ${trigger}`, async () => {
    const dispatcher = new BodyDispatcher((handler) => handler.onData!(Buffer.from('{"data":')))
    const w = await worker(dispatcher)
    try {
      w.request("pending", ["operators", "list"], trigger === "deadline" ? 30 : undefined)
      await w.until(() => dispatcher.attempts === 1)
      if (trigger === "signal") w.controller.abort()
      if (trigger === "eof") w.input.end()
      if (trigger === "close") w.input.destroy()
      const frame = await w.response("pending")
      assert.equal(frame.error.error, trigger === "deadline" ? "deadline_exceeded" : "cancelled")
    } finally {
      await w.close()
    }
  })

for (const size of [WORKER_LIMITS.responseBytes + 1, WORKER_LIMITS.responseBytes - 20])
  test(`oversized response (${size}) fails only its request`, async () => {
    await withCrispMock(
      [
        { status: 200, json: okEnvelope("x".repeat(size)) },
        { status: 200, json: okEnvelope("ok") },
      ],
      async (dispatcher) => {
        const w = await worker(dispatcher)
        try {
          w.request("large")
          assert.equal((await w.response("large")).error.error, "response_too_large")
          w.request("small")
          assert.equal((await w.response("small")).result, "ok")
        } finally {
          await w.close()
        }
      },
    )
  })

test("worker parser errors use existing credential redaction and do not poison the next request", async () => {
  const w = await worker()
  try {
    w.request("bad", [`--${FIXTURE.key}`])
    const bad = await w.response("bad")
    assert.equal(bad.code, 2)
    assert.doesNotMatch(JSON.stringify(bad), new RegExp(FIXTURE.key))
    w.request("next", ["auth", "show"])
    assert.equal((await w.response("next")).ok, true)
  } finally {
    await w.close()
  }
})

for (const [name, bytes] of [
  ["invalid_frame", Buffer.from('{"secret":"fixture"}\n')],
  ["invalid_frame", Buffer.from([0xff, 10])],
  ["request_too_large", Buffer.alloc(WORKER_LIMITS.requestBytes + 1, 32)],
  ["truncated_frame", Buffer.from('{"protocol":1')],
] as const)
  test(`worker bounds malformed input: ${name} (${bytes.length} bytes)`, async () => {
    const w = await worker()
    w.input.end(bytes)
    try {
      assert.equal(await w.result, 1)
      assert.equal(w.frames[1].error, name)
    } finally {
      await w.close()
    }
  })

test("duplicate active IDs terminate the protocol without ambiguous responses", async () => {
  const dispatcher = new BodyDispatcher(() => {})
  const w = await worker(dispatcher)
  try {
    w.request("same")
    w.request("same")
    assert.equal(await w.result, 1)
    assert.ok(w.frames.some((f) => f.error === "duplicate_id"))
    assert.equal(w.frames.filter((f) => f.id === "same").length, 1)
  } finally {
    await w.close()
  }
})

test("input errors are generic and partial UTF-8 frames are assembled correctly", async () => {
  const w = await worker()
  try {
    const line = Buffer.from(
      JSON.stringify({
        protocol: 1,
        type: "request",
        id: "utf8",
        argv: ["conversations", "search", "測試", "--page", "0"],
      }) + "\r\n",
    )
    for (const byte of line) w.input.write(Buffer.from([byte]))
    assert.equal((await w.response("utf8")).code, 2)
    w.input.emit("error", new Error("private input diagnostic"))
    assert.equal(await w.result, 1)
    assert.equal(w.frames.at(-1).error, "input_error")
  } finally {
    await w.close()
  }
})

test("stalled output is bounded, cancels work and cleans listeners", async () => {
  const env = credentialEnv()
  const input = new PassThrough()
  const out = new Writable({ write() {} })
  const err = new Writable({
    write(_chunk, _encoding, done) {
      done()
    },
  })
  try {
    assert.equal(
      await runProcess(["serve", "--stdio"], out, err, { env, stdin: input, drainTimeoutMs: 10 }),
      1,
    )
    assert.equal(input.listenerCount("data"), 0)
  } finally {
    removeHome(env)
  }
})

for (const value of [
  null,
  [],
  1,
  {},
  { protocol: 2, type: "shutdown" },
  { protocol: 1, type: "request", id: "", argv: [] },
  { protocol: 1, type: "cancel", id: 1 },
  { protocol: 1, type: "request", id: "a", argv: [1] },
  { protocol: 1, type: "request", id: "a", argv: ["\0"] },
  { protocol: 1, type: "request", id: "a", argv: Array(129).fill("x") },
  ...[0, 1.5, "1", 120001].map((timeout_ms) => ({
    protocol: 1,
    type: "request",
    id: "a",
    argv: [],
    timeout_ms,
  })),
  { protocol: 1, type: "other" },
  { protocol: 1, type: "shutdown", env: {} },
])
  test(`protocol rejects invalid schema ${JSON.stringify(value).slice(0, 90)}`, () => {
    assert.throws(() => parseMessage(Buffer.from(JSON.stringify(value))))
  })

test("closed stdout stops an idle worker without waiting for stdin EOF", async () => {
  const w = await worker()
  try {
    w.output.destroy()
    assert.equal(await w.result, 0)
    assert.equal(w.input.listenerCount("data"), 0)
  } finally {
    await w.close()
  }
})

test("pre-cancelled and pre-closed workers do not attach input listeners", async () => {
  for (const cancelled of [true, false]) {
    const input = new PassThrough()
    if (!cancelled) input.destroy()
    const output = new Writable({
      write(_chunk, _encoding, done) {
        done()
      },
    })
    const error = new Writable({
      write(_chunk, _encoding, done) {
        done()
      },
    })
    const env = credentialEnv()
    try {
      assert.equal(
        await runProcess(["serve", "--stdio"], output, error, {
          env,
          stdin: input,
          signal: cancelled ? AbortSignal.abort() : undefined,
        }),
        0,
      )
      assert.equal(input.listenerCount("data"), 0)
    } finally {
      removeHome(env)
    }
  }
})

test("string-mode input and repeated cancellation preserve one terminal response", async () => {
  const w = await worker(new BodyDispatcher(() => {}))
  try {
    w.input.setEncoding("utf8")
    w.request("cancel")
    w.send({ type: "cancel", id: "cancel" })
    w.send({ type: "cancel", id: "cancel" })
    await w.response("cancel")
    assert.equal(w.frames.filter((f) => f.id === "cancel").length, 1)
  } finally {
    await w.close()
  }
})

test("concurrent profiles keep credential snapshots and redaction isolated", async () => {
  const { saveConfig } = await import("../src/config.js")
  const dispatcher = new MockAgent()
  dispatcher.disableNetConnect()
  const pool = dispatcher.get("https://api.crisp.chat")
  for (const name of ["a", "b"])
    pool
      .intercept({ method: "GET", path: `/v1/website/site-${name}/operators/list` })
      .reply(403, { error: true, reason: `key-${name}`, data: { message: `key-${name}` } })
  const w = await worker(dispatcher, ["--read-only"], {
    CRISP_KEY: undefined,
    CRISP_WEBSITE_ID: undefined,
  })
  try {
    saveConfig(w.env, {
      profiles: Object.fromEntries(
        ["a", "b"].map((name) => [
          name,
          {
            identifier: FIXTURE.identifier,
            key: `key-${name}`,
            tier: "plugin",
            website_id: `site-${name}`,
          },
        ]),
      ),
    })
    for (const name of ["a", "b"]) w.request(name, ["operators", "list", "--profile", name])
    for (const name of ["a", "b"]) {
      const frame = await w.response(name)
      assert.equal(frame.error.reason, "[redacted]")
      assert.equal(frame.error.message, "[redacted]")
    }
    dispatcher.assertNoPendingInterceptors()
  } finally {
    await w.close()
    await dispatcher.close()
  }
})
