import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { test } from "node:test"
import { CrispClient } from "../src/client.js"
import { run } from "../src/cli.js"
import { configFilePath } from "../src/config.js"
import {
  buffers,
  credentialEnv,
  FIXTURE,
  okEnvelope,
  removeHome,
  withCrispMock,
} from "./support.js"

test("read-only CLI rejects every write command, including local auth writes, before access", async () => {
  for (const mode of ["flag", "env"]) {
    const env = credentialEnv(mode === "env" ? { CRISPCTL_READ_ONLY: "1" } : {})
    try {
      const calls = await withCrispMock(
        { status: 200, json: okEnvelope({}) },
        async (dispatcher) => {
          for (const args of [
            ["auth", "set"],
            ["reply", FIXTURE.session, "--text", "hello"],
            ["reply", FIXTURE.session, "--note", "note"],
            ["resolve", FIXTURE.session],
            ["reopen", FIXTURE.session],
            ["assign", FIXTURE.session, "--unassign"],
            ["segments", FIXTURE.session, "--set", "test"],
            ["read", FIXTURE.session],
          ]) {
            const io = buffers()
            assert.equal(
              await run([...args, "--json", ...(mode === "flag" ? ["--read-only"] : [])], {
                ...io,
                env,
                dispatcher,
              }),
              2,
            )
            assert.match(JSON.parse(io.err()).message, /read-only/)
            assert.equal(io.out(), "")
          }
        },
      )
      assert.equal(calls.length, 0)
      assert.equal(existsSync(configFilePath(env)), false)
    } finally {
      removeHome(env)
    }
  }
})

test("request layer blocks writes even when bypassing CLI, but permits GET", async () => {
  const calls = await withCrispMock({ status: 200, json: okEnvelope([]) }, async (dispatcher) => {
    const client = new CrispClient({ ...FIXTURE, tier: "website" }, dispatcher, true)
    for (const write of [
      () => client.sendOperatorMessage(FIXTURE.session, "text", "test"),
      () => client.sendOperatorMessage(FIXTURE.session, "note", "note"),
      () => client.setState(FIXTURE.session, "resolved"),
      () => client.assign(FIXTURE.session, null),
      () => client.setSegments(FIXTURE.session, []),
      () => client.markRead(FIXTURE.session),
    ]) {
      await assert.rejects(write(), /read-only mode/)
    }
    assert.deepEqual(await client.listConversations(), [])
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.method, "GET")
})

test("read-only CLI permits reads and help", async () => {
  const env = credentialEnv({ CRISPCTL_READ_ONLY: "1" })
  try {
    await withCrispMock({ status: 200, json: okEnvelope([]) }, async (dispatcher) => {
      assert.equal(
        await run(["conversations", "list", "--read-only"], { ...buffers(), env, dispatcher }),
        0,
      )
      assert.equal(await run(["auth", "show"], { ...buffers(), env, dispatcher }), 0)
      assert.equal(await run(["reply", "--help"], { ...buffers(), env, dispatcher }), 0)
    })
  } finally {
    removeHome(env)
  }
})

test("operation layer rejects writes even when bypassing command routing", async () => {
  const ops = await import("../src/operations.js")
  for (const mode of ["flag", "env"]) {
    const flags = {
      json: false,
      help: false,
      version: false,
      listEvents: false,
      unassign: false,
      readOnly: mode === "flag",
    }
    const io = { ...buffers(), flags, env: mode === "env" ? { CRISPCTL_READ_ONLY: "1" } : {} }
    for (const invoke of [
      () => ops.authSet(io),
      () => ops.replyCommand(io),
      () => ops.resolveCommand(io),
      () => ops.reopenCommand(io),
      () => ops.assignCommand(io),
      () => ops.segmentsCommand(io),
      () => ops.readCommand(io),
    ])
      await assert.rejects(async () => invoke(), /read-only mode/)
    assert.equal(io.out(), "")
    assert.equal(io.err(), "")
  }
})

test("operation layer permits read-only requests without a CLI invocation context", async () => {
  const { operatorsList } = await import("../src/operations.js")
  const env = credentialEnv()
  const io = buffers()
  try {
    const calls = await withCrispMock({ status: 200, json: okEnvelope([]) }, async (dispatcher) => {
      assert.equal(
        await operatorsList({
          ...io,
          env,
          dispatcher,
          flags: {
            json: true,
            help: false,
            version: false,
            listEvents: false,
            unassign: false,
            readOnly: true,
          },
        }),
        0,
      )
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.method, "GET")
    assert.deepEqual(JSON.parse(io.out()), [])
    assert.equal(io.err(), "")
  } finally {
    removeHome(env)
  }
})
