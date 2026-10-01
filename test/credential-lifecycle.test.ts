import assert from "node:assert/strict"
import test from "node:test"
import { writeFileSync } from "node:fs"
import { run } from "../src/cli.js"
import { configFilePath, saveConfig } from "../src/config.js"
import { BodyDispatcher } from "./body-dispatcher.js"
import { buffers, credentialEnv, FIXTURE, removeHome } from "./support.js"

for (const source of ["file", "env"] as const) {
  for (const json of [false, true]) {
    test(`${source} credential rotation keeps the actual request key redacted (${json ? "JSON" : "text"})`, async () => {
      const oldKey = 'fixture-old-"sensitive"-key'
      const env = credentialEnv({ CRISP_KEY: source === "env" ? oldKey : undefined })
      const io = buffers()
      const save = (key: string) =>
        saveConfig(env, {
          profiles: {
            default: {
              identifier: FIXTURE.identifier,
              key,
              tier: "website",
              website_id: FIXTURE.websiteId,
            },
          },
        })
      if (source === "file") save(oldKey)
      const dispatcher = new BodyDispatcher((handler) => {
        if (source === "file") save("fixture-new-key")
        else env.CRISP_KEY = "fixture-new-key"
        handler.onData!(
          Buffer.from(JSON.stringify({ error: true, reason: oldKey, data: { message: oldKey } })),
        )
        handler.onComplete!([])
      }, 401)
      try {
        assert.equal(
          await run(["operators", "list", ...(json ? ["--json"] : [])], { ...io, env, dispatcher }),
          1,
        )
        assert.equal(dispatcher.attempts, 1)
        const diagnostic = json ? JSON.stringify(JSON.parse(io.err())) : io.err()
        assert.ok(!diagnostic.includes(oldKey))
        assert.ok(!diagnostic.includes(JSON.stringify(oldKey).slice(1, -1)))
        assert.match(diagnostic, /\[redacted\]/)
        assert.equal(io.out(), "")
      } finally {
        removeHome(env)
      }
    })
  }
}

for (const source of ["file", "env", "flag"] as const) {
  test(`unknown help topics redact ${source} credentials`, async () => {
    const env = credentialEnv({ CRISP_KEY: source === "env" ? FIXTURE.key : undefined })
    if (source === "file")
      saveConfig(env, {
        profiles: {
          default: {
            identifier: FIXTURE.identifier,
            key: FIXTURE.key,
            tier: "website",
            website_id: FIXTURE.websiteId,
          },
        },
      })
    try {
      for (const topic of [
        ["--help", FIXTURE.key],
        ["help", FIXTURE.key],
      ]) {
        const io = buffers()
        assert.equal(
          await run([...topic, ...(source === "flag" ? ["--key", FIXTURE.key] : [])], {
            ...io,
            env,
          }),
          0,
        )
        assert.ok(!io.out().includes(FIXTURE.key))
        assert.match(io.out(), /Unknown command: \[redacted\]/)
        assert.equal(io.err(), "")
      }
    } finally {
      removeHome(env)
    }
  })
}

test("invalid config does not block credential-free commands or diagnostic redaction", async () => {
  const env = credentialEnv()
  saveConfig(env, { profiles: {} })
  writeFileSync(configFilePath(env), "{invalid JSON")
  try {
    for (const argv of [["--help"], ["--version"], ["listen", "--list-events", "--json"]]) {
      const io = buffers()
      assert.equal(await run(argv, { ...io, env }), 0)
      assert.ok(io.out().length > 0)
      assert.equal(io.err(), "")
    }
    const help = buffers()
    assert.equal(await run(["help", FIXTURE.key], { ...help, env }), 0)
    assert.match(help.out(), /Unknown command: \[redacted\]/)
    assert.ok(!help.out().includes(FIXTURE.key))
    const failure = buffers()
    assert.equal(await run([`--${FIXTURE.key}`, "--json"], { ...failure, env }), 2)
    assert.ok(!failure.err().includes(FIXTURE.key))
    assert.match(JSON.parse(failure.err()).message, /\[redacted\]/)
  } finally {
    removeHome(env)
  }
})
