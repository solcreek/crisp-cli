import assert from "node:assert/strict"
import { test } from "node:test"
import { run } from "../src/cli.js"
import { buffers, credentialEnv, FIXTURE, okEnvelope, removeHome, withCrispMock } from "./support.js"

for (const argv of [
  ["--json", "--page", "2", "conversations", "list"],
  ["conversations", "--json", "--page=2", "list"],
  ["conversations", "list", "--page", "1", "--page", "2", "--json"],
]) test(`option placement: ${argv.join(" ")}`, async () => {
  const env = credentialEnv(), io = buffers()
  try {
    const calls = await withCrispMock({ status: 200, json: okEnvelope([]) }, async dispatcher => {
      assert.equal(await run(argv, { ...io, env, dispatcher }), 0)
    })
    assert.equal(calls.length, 1)
    assert.match(calls[0]!.path, /\/conversations\/2$/)
    assert.deepEqual(JSON.parse(io.out()), [])
    assert.equal(io.err(), "")
  } finally { removeHome(env) }
})

for (const [argv, session, content] of [
  [["reply", FIXTURE.session, "--text=--help", "--json"], FIXTURE.session, "--help"],
  [["--text", "hello\n世界", "--json", "reply", "--", "-session"], "-session", "hello\n世界"],
] as const) test(`literal values: ${argv.join(" ")}`, async () => {
  const env = credentialEnv(), io = buffers()
  try {
    const calls = await withCrispMock({ status: 200, json: okEnvelope({ sent: true }) }, async dispatcher => {
      assert.equal(await run([...argv], { ...io, env, dispatcher }), 0)
    })
    assert.equal(calls.length, 1)
    assert.match(calls[0]!.path, new RegExp(`/conversation/${session}/message$`))
    assert.equal((calls[0]!.body as { content: string }).content, content)
  } finally { removeHome(env) }
})

for (const argv of [
  ["reply", FIXTURE.session, "--text", "--json"],
  ["listen", "--count", "--json"],
  ["--help", "--unknown", "--json"],
  ["--website", "a", "--website-id", "b", "--help", "--json"],
]) test(`invalid input fails before IO: ${argv.join(" ")}`, async () => {
  const env = credentialEnv(), io = buffers()
  try {
    const calls = await withCrispMock({ status: 200, json: okEnvelope({}) }, async dispatcher => {
      assert.equal(await run(argv, { ...io, env, dispatcher }), 2)
    })
    assert.equal(calls.length, 0)
    assert.equal(io.out(), "")
    assert.equal(JSON.parse(io.err()).error, "usage")
  } finally { removeHome(env) }
})

test("help topics, help priority and JSON version remain available without credentials", async () => {
  for (const argv of [["reply", "--help", "--read-only"], ["help", "auth", "set"], ["--help", "unknown"]]) {
    const io = buffers()
    assert.equal(await run(argv, { ...io, env: {} }), 0)
    assert.match(io.out(), /crispctl/)
    assert.equal(io.err(), "")
  }
  const io = buffers()
  assert.equal(await run(["--version", "--json"], { ...io, env: {} }), 0)
  assert.equal(typeof JSON.parse(io.out()).version, "string")
})

test("independent concurrent invocations retain injected IO and process exit status", async () => {
  const original = process.exitCode
  const first = buffers(), second = buffers()
  assert.deepEqual(await Promise.all([
    run(["--version", "--json"], { ...first, env: {} }),
    run(["unknown", "--json"], { ...second, env: {} }),
  ]), [0, 2])
  assert.equal(typeof JSON.parse(first.out()).version, "string")
  assert.equal(first.err(), "")
  assert.equal(second.out(), "")
  assert.equal(JSON.parse(second.err()).error, "usage")
  assert.equal(process.exitCode, original)
})
