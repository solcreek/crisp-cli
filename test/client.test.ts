import assert from "node:assert/strict"
import { test } from "node:test"
import { MockAgent } from "undici"
import { CrispClient } from "../src/client.js"
import { CrispApiError } from "../src/errors.js"
import { FIXTURE, withCrispMock } from "./support.js"

function client(dispatcher?: ConstructorParameters<typeof CrispClient>[1]): CrispClient {
  return new CrispClient(
    {
      identifier: FIXTURE.identifier,
      key: FIXTURE.key,
      tier: "plugin",
      websiteId: FIXTURE.websiteId,
    },
    dispatcher,
  )
}

test("HTTP 200 with error:true is an API error", async () => {
  await withCrispMock({
    status: 200,
    json: { error: true, reason: "invalid_session", data: { message: "nope" } },
  }, async (dispatcher) => {
    await assert.rejects(
      () => client(dispatcher).listOperators(),
      (err: unknown) => {
        assert.ok(err instanceof CrispApiError)
        assert.equal(err.status, 200)
        assert.equal(err.reason, "invalid_session")
        assert.equal(err.message, "nope")
        return true
      },
    )
  })
})

test("401 without a reason string is unauthorized", async () => {
  await withCrispMock({
    status: 401,
    json: { error: true, data: { message: 12 } },
  }, async (dispatcher) => {
    await assert.rejects(
      () => client(dispatcher).listOperators(),
      (err: unknown) => {
        assert.ok(err instanceof CrispApiError)
        assert.equal(err.status, 401)
        assert.equal(err.reason, "unauthorized")
        assert.equal(err.message, "unauthorized")
        return true
      },
    )
  })
})

test("non-JSON error body keeps the status", async () => {
  await withCrispMock({ status: 502, json: "<html>bad gateway</html>" }, async (dispatcher) => {
    await assert.rejects(
      () => client(dispatcher).listOperators(),
      (err: unknown) => {
        assert.ok(err instanceof CrispApiError)
        assert.equal(err.status, 502)
        assert.equal(err.reason, "http_error")
        assert.equal(err.message, "HTTP 502")
        return true
      },
    )
  })
})

test("non-JSON success body is invalid_json", async () => {
  await withCrispMock({ status: 200, json: "not-json" }, async (dispatcher) => {
    await assert.rejects(
      () => client(dispatcher).listOperators(),
      (err: unknown) => {
        assert.ok(err instanceof CrispApiError)
        assert.equal(err.reason, "invalid_json")
        return true
      },
    )
  })
})

test("empty success body returns null", async () => {
  await withCrispMock({ status: 202, json: "" }, async (dispatcher) => {
    const value = await client(dispatcher).markRead(FIXTURE.session)
    assert.equal(value, null)
  })
})

test("missing intercept surfaces a network error and does not call the origin", async () => {
  const agent = new MockAgent()
  agent.disableNetConnect()
  agent.get("https://api.crisp.chat")
  try {
    const offline = new CrispClient({
      identifier: FIXTURE.identifier,
      key: FIXTURE.key,
      tier: "website",
      websiteId: FIXTURE.websiteId,
    }, agent)
    await assert.rejects(
      () => offline.listOperators(),
      (err: unknown) => {
        assert.ok(err instanceof CrispApiError)
        assert.equal(err.status, 0)
        assert.equal(err.reason, "network_error")
        assert.equal(err.message.includes(FIXTURE.key), false)
        return true
      },
    )
  } finally {
    await agent.close()
  }
})

test("session ids are encoded as a single path segment", async () => {
  const calls = await withCrispMock({ status: 200, json: { error: false, data: { ok: true } } }, async (dispatcher) => {
    await client(dispatcher).getConversation("a/b")
  })
  assert.equal(calls[0]?.path, `/v1/website/${FIXTURE.websiteId}/conversation/${encodeURIComponent("a/b")}`)
})
