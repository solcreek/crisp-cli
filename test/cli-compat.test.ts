import assert from "node:assert/strict"
import { test } from "node:test"
import { run } from "../src/cli.js"
import { saveConfig } from "../src/config.js"
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

test("generated help exposes local and global options without unrelated command flags", async () => {
  for (const topic of [["reply"], ["auth", "set"], ["listen"], ["conversations"]]) {
    const io = buffers()
    assert.equal(await run([...topic, "--help"], { ...io, env: {} }), 0)
    assert.match(io.out(), new RegExp(`Usage: crispctl ${topic.join(" ")}`))
    for (const flag of ["--json", "--profile", "--read-only", "--website-id"]) assert.ok(io.out().includes(flag), flag)
    if (topic[0] === "reply") {
      assert.match(io.out(), /--text <message>/)
      assert.match(io.out(), /--note <note>/)
      assert.doesNotMatch(io.out(), /--key|--events|--page/)
    }
    assert.equal(io.err(), "")
  }
})

test("Commander routing and arity errors remain one JSON usage error before IO", async () => {
  const env = credentialEnv()
  try {
    for (const argv of [
      ["auth"], ["conversations"], ["messages"], ["people"], ["operators"],
      ["auth", "unknown"], ["conversations", "get"], ["reply"],
      ["operators", "list", "extra"], ["reply", FIXTURE.session, "extra", "--text", "hi"],
      ["auth", "show", "--key", "unused"], ["listen", "--list-events", "--count", "1"],
      ["reply", FIXTURE.session, "--text"],
    ]) {
      const io = buffers()
      const calls = await withCrispMock({ status: 200, json: okEnvelope({}) }, async dispatcher => {
        assert.equal(await run([...argv, "--json"], { ...io, env, dispatcher }), 2, argv.join(" "))
      })
      assert.equal(calls.length, 0)
      assert.equal(io.out(), "")
      assert.equal(JSON.parse(io.err()).error, "usage")
      assert.equal(io.err().trim().split("\n").length, 1)
    }
  } finally { removeHome(env) }
})

test("parser failures redact all supplied keys and selected profile credentials", async () => {
  const env = credentialEnv({ CRISP_KEY: undefined })
  const first = "first-sensitive-key", second = "second-sensitive-key", saved = "saved-sensitive-key"
  try {
    saveConfig(env, { current: "default", profiles: {
      sandbox: { identifier: FIXTURE.identifier, key: saved, tier: "website", website_id: FIXTURE.websiteId },
    } })
    const cases = [
      [`--${first}`, "--key", first, "--key", second],
      [`--${second}`, `--key=${first}`, `--key=${second}`],
      [first, "--key", first],
      ["operators", "list", first, "--key", first],
      [`--${saved}`, "--profile=sandbox"],
      [saved, "--profile", "sandbox"],
      ["operators", "list", saved, "--profile", "sandbox"],
    ]
    for (const argv of cases) {
      for (const json of [false, true]) {
        const io = buffers()
        assert.equal(await run([...argv, ...(json ? ["--json"] : [])], { ...io, env }), 2)
        assert.equal(io.out(), "")
        for (const key of [first, second, saved]) assert.ok(!io.err().includes(key), key)
        assert.match(io.err(), /\[redacted\]/)
        if (json) assert.equal(JSON.parse(io.err()).error, "usage")
      }
    }
  } finally { removeHome(env) }
})
