import assert from "node:assert/strict"
import { test } from "node:test"
import { run } from "../src/cli.js"
import { CrispApiError } from "../src/errors.js"
import { errorPayload, writeErr } from "../src/output.js"
import { buffers, credentialEnv, FIXTURE, removeHome, withCrispMock } from "./support.js"

test("API error payload redacts every remote string before JSON serialization", () => {
  const secret = 'token"\\\n.*$'
  const payload = errorPayload(new CrispApiError(429, `reason ${secret}`, `message ${secret}`, `retry ${secret}`), [secret, "token", undefined, ""])
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    ok: false, status: 429, error: "reason [redacted]", reason: "reason [redacted]",
    message: "message [redacted]", retry_after: "retry [redacted]",
  })
})

test("API error payload preserves safe metadata and does not mutate the original error", () => {
  const error = new CrispApiError(429, "rate_limited", `message ${FIXTURE.key}`, "3")
  assert.deepEqual(errorPayload(error, [FIXTURE.key]), {
    ok: false, status: 429, error: "rate_limited", reason: "rate_limited",
    message: "message [redacted]", retry_after: "3",
  })
  assert.equal(error.message, `message ${FIXTURE.key}`)
})

test("text errors do not expose credentials through the reason header", () => {
  const io = buffers()
  writeErr(io.stderr, false, new CrispApiError(403, `denied ${FIXTURE.key}`, "request rejected"), [FIXTURE.key])
  assert.equal(io.err(), "error: 403 denied [redacted]: request rejected\n")
})

for (const json of [false, true]) {
  test(`CLI redacts credentials echoed in HTTP error fields (json=${json})`, async () => {
    const env = credentialEnv(), io = buffers()
    try {
      await withCrispMock({ status: 429,
        json: { error: true, reason: `reason ${FIXTURE.key}`, data: { message: `message ${FIXTURE.key}` } },
        headers: { "retry-after": `retry ${FIXTURE.key}` },
      }, async dispatcher => {
        const code = await run(["conversations", "list", ...(json ? ["--json"] : [])], { ...io, env, dispatcher })
        assert.equal(code, 1)
      })
      assert.equal(io.out(), "")
      assert.ok(!io.err().includes(FIXTURE.key))
      if (json) assert.deepEqual(JSON.parse(io.err()), {
        ok: false, status: 429, error: "reason [redacted]", reason: "reason [redacted]",
        message: "message [redacted]", retry_after: "retry [redacted]",
      })
      else assert.equal(io.err(), "error: 429 reason [redacted]: message [redacted]\n")
    } finally { removeHome(env) }
  })
}
