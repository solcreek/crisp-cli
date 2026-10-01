import assert from "node:assert/strict"
import { Writable } from "node:stream"
import { setImmediate } from "node:timers/promises"
import { test } from "node:test"
import { EventEmitter } from "node:events"
import type { Socket } from "socket.io-client"
import { OutputSink } from "../src/output-sink.js"
import { runProcess } from "../src/process-cli.js"
import { credentialEnv, FIXTURE, okEnvelope, removeHome, withCrispMock } from "./support.js"

function capture() {
  let text = ""
  return { stream: new Writable({ write(chunk, _encoding, callback) { text += chunk; callback() } }), text: () => text }
}

test("sink waits for each write, preserves UTF-8 order and flushes all waiters", async () => {
  const chunks: string[] = []
  const callbacks: (() => void)[] = []
  const stream = new Writable({ highWaterMark: 1, write(chunk, _encoding, callback) { chunks.push(chunk.toString()); callbacks.push(callback) } })
  const sink = new OutputSink(stream, () => assert.fail("must not stop"), "stdout")
  sink.write("一\n")
  sink.write("two\n")
  sink.write("三\n")
  assert.equal(stream.writableLength, Buffer.byteLength("一\n"))
  const flushed = Promise.all([sink.flush(), sink.flush()])
  assert.deepEqual(chunks, ["一\n"])
  callbacks.shift()!()
  callbacks.shift()!()
  callbacks.shift()!()
  await flushed
  assert.deepEqual(chunks, ["一\n", "two\n", "三\n"])
  await sink.flush()
  sink.dispose()
  assert.equal(stream.listenerCount("error"), 0)
})

test("sink bounds queued plus in-flight bytes and stops once on overflow", async () => {
  let stopped = 0
  const stream = new Writable({ write(_chunk, _encoding, _callback) {} })
  const sink = new OutputSink(stream, () => stopped++, "stdout", 6)
  sink.write("一")
  sink.write("二")
  const flushed = sink.flush()
  sink.write("x")
  sink.write("ignored")
  await assert.rejects(flushed, /buffer exceeded 6 bytes/)
  await assert.rejects(sink.flush(), { code: "OUTPUT_OVERFLOW" })
  assert.equal(stopped, 1)
  assert.equal(stream.destroyed, true)
  sink.dispose()
})

test("sink catches asynchronous stream failures without forwarding later chunks", async () => {
  let stopped = 0
  let calls = 0
  const stream = new Writable({ write(_chunk, _encoding, callback) { calls++; queueMicrotask(() => callback(Object.assign(new Error("disk full"), { code: "ENOSPC" }))) } })
  const sink = new OutputSink(stream, () => stopped++, "stdout")
  sink.write("first")
  sink.write("second")
  await assert.rejects(sink.flush(), { code: "ENOSPC" })
  await setImmediate()
  assert.equal(calls, 1)
  assert.equal(stopped, 1)
  sink.dispose()
})

test("process output drains and disposes its listeners", async () => {
  const out = capture(), err = capture()
  const controller = new AbortController()
  assert.equal(await runProcess(["--version"], out.stream, err.stream, { signal: controller.signal }), 0)
  assert.match(out.text(), /^\d+\.\d+\.\d+\n$/)
  assert.equal(err.text(), "")
  assert.equal(out.stream.listenerCount("error"), 0)
  assert.equal(err.stream.listenerCount("error"), 0)
})

for (const code of ["EPIPE", "ENOSPC"]) {
  test(`process handles stdout ${code} without disclosing stream error content`, async () => {
    const out = new Writable({ write(_chunk, _encoding, callback) { callback(Object.assign(new Error("secret payload"), { code })) } })
    const err = capture()
    assert.equal(await runProcess(["--version", "--json"], out, err.stream), code === "EPIPE" ? 0 : 1)
    assert.doesNotMatch(err.text(), /secret payload/)
    if (code === "ENOSPC") assert.equal(JSON.parse(err.text()).message, "stdout write failed")
    else assert.equal(err.text(), "")
  })
}

test("process preserves usage failure when stderr is unavailable", async () => {
  const out = capture()
  const err = new Writable({ write(_chunk, _encoding, callback) { callback(new Error("stderr failed")) } })
  assert.equal(await runProcess(["unknown", "--json"], out.stream, err), 2)
})

test("a delayed EPIPE preserves an earlier fatal RTM error", async () => {
  const env = credentialEnv()
  const err = capture()
  let failWrite!: (error: Error) => void
  const out = new Writable({ write(_chunk, _encoding, callback) { failWrite = callback } })
  try {
    await withCrispMock({ status: 200, json: okEnvelope({ socket: { app: "wss://fixture.invalid/rtm/" } }) }, async dispatcher => {
      const socket = new EventEmitter() as EventEmitter & { connect(): unknown; disconnect(): unknown }
      socket.connect = () => { queueMicrotask(() => socket.emit("connect")); return socket }
      socket.disconnect = () => socket
      socket.on("authentication", () => {
        socket.emit("authenticated")
        socket.emit("message:send", { website_id: FIXTURE.websiteId, content: "fixture" })
        socket.emit("unauthorized")
        setImmediate().then(() => failWrite(Object.assign(new Error("pipe closed"), { code: "EPIPE" })))
      })
      assert.equal(await runProcess(["listen", "--json"], out, err.stream, {
        env, dispatcher, socketFactory: () => socket as unknown as Socket,
      }), 1)
    })
    assert.match(err.text(), /unauthorized/)
  } finally { removeHome(env) }
})
