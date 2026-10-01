import assert from "node:assert/strict"
import { test } from "node:test"
import { run } from "../src/cli.js"
import { CrispApiError } from "../src/errors.js"
import { jsonRedactor } from "../src/redact.js"
import { errorPayload, writeErr, writeOut } from "../src/output.js"
import { buffers, credentialEnv, FIXTURE, removeHome, withCrispMock } from "./support.js"

test("structured redaction keeps patterns isolated across invocations and repeated strings", () => {
  const first = jsonRedactor(["a.b", "a", "a.b", undefined, ""])
  const second = jsonRedactor(["other-key"])
  const payload = { "a.b": ["a.b a", "a.b", "other-key"], other: "aXb" }
  assert.deepEqual(JSON.parse(JSON.stringify(payload, first)), {
    "[redacted]": ["[redacted] [redacted]", "[redacted]", "other-key"],
    other: "[redacted]Xb",
  })
  assert.deepEqual(JSON.parse(JSON.stringify(payload, second)), {
    "a.b": ["a.b a", "a.b", "[redacted]"],
    other: "aXb",
  })
  assert.equal(JSON.stringify(payload, jsonRedactor([undefined, ""])), JSON.stringify(payload))
})

test("API error payload redacts every remote string before JSON serialization", () => {
  const secret = 'token"\\\n.*$'
  const payload = errorPayload(
    new CrispApiError(429, `reason ${secret}`, `message ${secret}`, `retry ${secret}`),
    [secret, "token", undefined, ""],
  )
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    ok: false,
    status: 429,
    error: "reason [redacted]",
    reason: "reason [redacted]",
    message: "message [redacted]",
    retry_after: "retry [redacted]",
  })
})

test("API error payload preserves safe metadata and does not mutate the original error", () => {
  const error = new CrispApiError(429, "rate_limited", `message ${FIXTURE.key}`, "3")
  assert.deepEqual(errorPayload(error, [FIXTURE.key]), {
    ok: false,
    status: 429,
    error: "rate_limited",
    reason: "rate_limited",
    message: "message [redacted]",
    retry_after: "3",
  })
  assert.equal(error.message, `message ${FIXTURE.key}`)
})

test("text errors do not expose credentials through the reason header", () => {
  const io = buffers()
  writeErr(io.stderr, false, new CrispApiError(403, `denied ${FIXTURE.key}`, "request rejected"), [
    FIXTURE.key,
  ])
  assert.equal(io.err(), "error: 403 denied [redacted]: request rejected\n")
})

for (const json of [false, true]) {
  test(`CLI redacts credentials echoed in HTTP error fields (json=${json})`, async () => {
    const env = credentialEnv(),
      io = buffers()
    try {
      await withCrispMock(
        {
          status: 429,
          json: {
            error: true,
            reason: `reason ${FIXTURE.key}`,
            data: { message: `message ${FIXTURE.key}` },
          },
          headers: { "retry-after": `retry ${FIXTURE.key}` },
        },
        async (dispatcher) => {
          const code = await run(["conversations", "list", ...(json ? ["--json"] : [])], {
            ...io,
            env,
            dispatcher,
          })
          assert.equal(code, 1)
        },
      )
      assert.equal(io.out(), "")
      assert.ok(!io.err().includes(FIXTURE.key))
      if (json)
        assert.deepEqual(JSON.parse(io.err()), {
          ok: false,
          status: 429,
          error: "reason [redacted]",
          reason: "reason [redacted]",
          message: "message [redacted]",
          retry_after: "retry [redacted]",
        })
      else assert.equal(io.err(), "error: 429 reason [redacted]: message [redacted]\n")
    } finally {
      removeHome(env)
    }
  })
}

test("structured redaction preserves shared objects, dates, buffers and the input", () => {
  const shared = { text: "fixture-secret", __proto__: null }
  const value = {
    first: shared,
    second: shared,
    date: new Date("2026-01-01T00:00:00Z"),
    binary: Buffer.from([1, 2, 3]),
  }
  const io = buffers()
  writeOut(io.stdout, true, value, ["fixture-secret"])
  assert.deepEqual(JSON.parse(io.out()), {
    first: { text: "[redacted]" },
    second: { text: "[redacted]" },
    date: "2026-01-01T00:00:00.000Z",
    binary: { type: "Buffer", data: [1, 2, 3] },
  })
  assert.equal(shared.text, "fixture-secret")
})

test("structured redaction still rejects circular objects without writing partial JSON", () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  const io = buffers()
  assert.throws(() => writeOut(io.stdout, true, circular, ["fixture-secret"]), /circular/i)
  assert.equal(io.out(), "")
})

test("plain text redaction preserves the trailing newline contract", () => {
  const io = buffers()
  writeOut(io.stdout, false, "fixture-secret", ["fixture-secret"])
  writeOut(io.stdout, false, "fixture-secret\n", ["fixture-secret"])
  assert.equal(io.out(), "[redacted]\n[redacted]\n")
})
