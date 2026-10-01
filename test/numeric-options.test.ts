import assert from "node:assert/strict"
import test from "node:test"
import { pageNumber } from "../src/args.js"
import { run } from "../src/cli.js"
import { buffers, credentialEnv, okEnvelope, removeHome, withCrispMock } from "./support.js"

const invalid = [
  "0",
  "-1",
  "1.5",
  "1e3",
  "+1",
  "01",
  " 1",
  "1 ",
  "",
  "NaN",
  "Infinity",
  "9007199254740992",
  "9007199254740993",
  "9".repeat(400),
]

test("pages accept only positive safe integers without rounding or overflow", () => {
  assert.equal(pageNumber(undefined), 1)
  assert.equal(pageNumber("1"), 1)
  assert.equal(pageNumber(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER)
  for (const value of invalid)
    assert.throws(() => pageNumber(value), /--page must be a positive integer/, value)
})

for (const [argv, flag] of [
  [["conversations", "list"], "page"],
  [["conversations", "search", "hello"], "page"],
  [["listen"], "count"],
  [["listen"], "timeout"],
] as const) {
  test(`${argv.join(" ")} rejects invalid --${flag} before network access`, async () => {
    const env = credentialEnv()
    try {
      for (const value of invalid) {
        const io = buffers()
        const calls = await withCrispMock(
          { status: 200, json: okEnvelope([]) },
          async (dispatcher) => {
            assert.equal(
              await run([...argv, `--${flag}=${value}`, "--json"], { ...io, env, dispatcher }),
              2,
              value,
            )
          },
        )
        assert.equal(calls.length, 0)
        assert.equal(io.out(), "")
        assert.equal(JSON.parse(io.err()).error, "usage")
      }
    } finally {
      removeHome(env)
    }
  })
}

test("safe maximum page is sent without loss of precision", async () => {
  const env = credentialEnv()
  const io = buffers()
  try {
    const calls = await withCrispMock({ status: 200, json: okEnvelope([]) }, async (dispatcher) => {
      assert.equal(
        await run(["conversations", "list", "--page", String(Number.MAX_SAFE_INTEGER), "--json"], {
          ...io,
          env,
          dispatcher,
        }),
        0,
      )
    })
    assert.ok(calls[0]?.path.endsWith("/conversations/9007199254740991"))
  } finally {
    removeHome(env)
  }
})
