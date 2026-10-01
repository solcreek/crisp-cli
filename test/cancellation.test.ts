import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { Writable } from "node:stream"
import test from "node:test"
import { run } from "../src/cli.js"
import { configFilePath } from "../src/config.js"
import { runProcess } from "../src/process-cli.js"
import { BodyDispatcher } from "./body-dispatcher.js"
import {
  buffers,
  credentialEnv,
  FIXTURE,
  okEnvelope,
  removeHome,
  withCrispMock,
} from "./support.js"

const commands = [
  ["conversations", "list"],
  ["conversations", "get", FIXTURE.session],
  ["conversations", "pages", FIXTURE.session],
  ["conversations", "search", "hello"],
  ["messages", "list", FIXTURE.session],
  ["reply", FIXTURE.session, "--text", "hello"],
  ["resolve", FIXTURE.session],
  ["reopen", FIXTURE.session],
  ["assign", FIXTURE.session, "--unassign"],
  ["segments", FIXTURE.session, "--set", "test"],
  ["read", FIXTURE.session],
  ["people", "get", "person@example.test"],
  ["operators", "list"],
]

for (const argv of commands) {
  test(`cancelled ${argv.slice(0, 2).join(" ")} never dispatches a request`, async () => {
    const env = credentialEnv()
    const io = buffers()
    try {
      const calls = await withCrispMock(
        { status: 200, json: okEnvelope({}) },
        async (dispatcher) => {
          assert.equal(
            await run([...argv, "--json"], {
              ...io,
              env,
              dispatcher,
              signal: AbortSignal.abort(),
            }),
            1,
          )
        },
      )
      assert.equal(calls.length, 0)
      assert.equal(io.out(), "")
      assert.ok(JSON.parse(io.err()).message)
    } finally {
      removeHome(env)
    }
  })
}

test("cancelled auth set does not write credentials", async () => {
  const env = credentialEnv()
  const io = buffers()
  try {
    assert.equal(
      await run(["auth", "set", "--json"], { ...io, env, signal: AbortSignal.abort() }),
      1,
    )
    assert.equal(existsSync(configFilePath(env)), false)
    assert.equal(io.out(), "")
  } finally {
    removeHome(env)
  }
})

for (const argv of commands) {
  test(`cancellation interrupts the response body for ${argv.slice(0, 2).join(" ")}`, async () => {
    const env = credentialEnv()
    const io = buffers()
    const controller = new AbortController()
    const dispatcher = new BodyDispatcher((handler) => {
      handler.onData!(Buffer.from('{"data":'))
      setImmediate(() => controller.abort())
    })
    try {
      assert.equal(
        await run([...argv, "--json"], { ...io, env, dispatcher, signal: controller.signal }),
        1,
      )
      assert.equal(dispatcher.attempts, 1)
      assert.equal(io.out(), "")
      assert.equal(JSON.parse(io.err()).reason, "network_error")
    } finally {
      removeHome(env)
    }
  })
}

test("people lookup cancellation prevents the subsequent profile request", async () => {
  const env = credentialEnv()
  const io = buffers()
  const controller = new AbortController()
  const dispatcher = new BodyDispatcher((handler) => {
    handler.onData!(
      Buffer.from(
        JSON.stringify(okEnvelope([{ email: "person@example.test", people_id: "fixture-person" }])),
      ),
    )
    handler.onComplete!([])
    queueMicrotask(() => controller.abort())
  })
  try {
    assert.equal(
      await run(["people", "get", "person@example.test", "--json"], {
        ...io,
        env,
        dispatcher,
        signal: controller.signal,
      }),
      1,
    )
    assert.equal(dispatcher.attempts, 1)
    assert.equal(io.out(), "")
  } finally {
    removeHome(env)
  }
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`${signal} cancels REST while the process waits for a response`, async () => {
    const env = credentialEnv()
    const before = process.listenerCount(signal)
    const io = buffers()
    const out = new Writable({
      write(chunk, _encoding, done) {
        io.stdout(String(chunk))
        done()
      },
    })
    const err = new Writable({
      write(chunk, _encoding, done) {
        io.stderr(String(chunk))
        done()
      },
    })
    const dispatcher = new BodyDispatcher((handler) => {
      handler.onData!(Buffer.from('{"data":'))
      setImmediate(() => process.emit(signal))
    })
    try {
      assert.equal(
        await runProcess(["operators", "list", "--json"], out, err, { env, dispatcher }),
        1,
      )
      assert.equal(dispatcher.attempts, 1)
      assert.equal(io.out(), "")
      assert.equal(JSON.parse(io.err()).reason, "network_error")
      assert.equal(process.listenerCount(signal), before)
    } finally {
      removeHome(env)
    }
  })
}
