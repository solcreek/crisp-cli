import assert from "node:assert/strict"
import { test } from "node:test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { getEventListeners } from "node:events"
import { MockAgent } from "undici"
import { CrispClient } from "../src/client.js"
import { CrispApiError } from "../src/errors.js"
import { FIXTURE, okEnvelope, withCrispMock } from "./support.js"
import { BodyDispatcher } from "./body-dispatcher.js"

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
  await withCrispMock(
    {
      status: 200,
      json: { error: true, reason: "invalid_session", data: { message: "nope" } },
    },
    async (dispatcher) => {
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
    },
  )
})

test("401 without a reason string is unauthorized", async () => {
  await withCrispMock(
    {
      status: 401,
      json: { error: true, data: { message: 12 } },
    },
    async (dispatcher) => {
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
    },
  )
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

test("JSON values that are not objects are invalid_json", async () => {
  for (const body of ['"ok"', "[1]", "null", "1"]) {
    await withCrispMock({ status: 200, json: body }, async (dispatcher) => {
      await assert.rejects(
        () => client(dispatcher).listOperators(),
        (err: unknown) => {
          assert.ok(err instanceof CrispApiError)
          assert.equal(err.reason, "invalid_json")
          assert.equal(err.message, "response was not a JSON object")
          return true
        },
      )
    })
  }
})

test("people search that is not a list is invalid_json", async () => {
  await withCrispMock({ status: 200, json: okEnvelope({ people_id: "x" }) }, async (dispatcher) => {
    await assert.rejects(
      () => client(dispatcher).getPerson("ada@example.com"),
      (err: unknown) => {
        assert.ok(err instanceof CrispApiError)
        assert.equal(err.reason, "invalid_json")
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

test("204 without a response body returns null", async () => {
  await withCrispMock({ status: 204, json: "" }, async (dispatcher) => {
    assert.equal(await client(dispatcher).markRead(FIXTURE.session), null)
  })
})

test("REST removes source signal listeners after success and failure", async () => {
  for (const status of [200, 403]) {
    const controller = new AbortController()
    await withCrispMock({ status, json: okEnvelope([]) }, async (dispatcher) => {
      const pending = client(dispatcher).getConnectEndpoints(controller.signal)
      if (status === 200) await pending
      else await assert.rejects(pending, CrispApiError)
      assert.deepEqual(getEventListeners(controller.signal, "abort"), [])
    })
  }
})

for (const mode of ["timeout", "manual"]) {
  test(`REST body ${mode} cancellation survives garbage collection`, async () => {
    const result = await promisify(execFile)(
      process.execPath,
      ["--expose-gc", fileURLToPath(new URL("./fixtures/timeout-gc.mjs", import.meta.url)), mode],
      { timeout: 10_000, env: {} },
    )
    assert.equal(result.stdout, "")
    assert.equal(result.stderr, "")
  })
}

test("missing intercept surfaces a network error and does not call the origin", async () => {
  const agent = new MockAgent()
  agent.disableNetConnect()
  agent.get("https://api.crisp.chat")
  try {
    const offline = new CrispClient(
      {
        identifier: FIXTURE.identifier,
        key: FIXTURE.key,
        tier: "website",
        websiteId: FIXTURE.websiteId,
      },
      agent,
    )
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
  const calls = await withCrispMock(
    { status: 200, json: { error: false, data: { ok: true } } },
    async (dispatcher) => {
      await client(dispatcher).getConversation("a/b")
    },
  )
  assert.equal(
    calls[0]?.path,
    `/v1/website/${FIXTURE.websiteId}/conversation/${encodeURIComponent("a/b")}`,
  )
})

test("connection reset after headers is normalized as a retriable network error", async () => {
  const dispatcher = new BodyDispatcher((handler) => {
    handler.onData!(Buffer.from('{"data":'))
    setImmediate(() => handler.onError!(new Error("simulated reset")))
  })
  await assert.rejects(client(dispatcher).getConnectEndpoints(), {
    name: "CrispApiError",
    status: 0,
    reason: "network_error",
  })
})

test("cancellation and caller deadline interrupt an in-progress response body", async () => {
  for (const deadline of [false, true]) {
    const controller = new AbortController()
    const dispatcher = new BodyDispatcher((handler) => {
      handler.onData!(Buffer.from('{"data":'))
      if (!deadline) setImmediate(() => controller.abort())
    })
    // Keep the test alive while AbortSignal.timeout's unref'ed timer expires.
    const keepAlive = setTimeout(() => {}, 1000)
    try {
      await assert.rejects(
        client(dispatcher).getConnectEndpoints(
          deadline ? AbortSignal.timeout(10) : controller.signal,
        ),
        { name: "CrispApiError", status: 0, reason: "network_error" },
      )
    } finally {
      clearTimeout(keepAlive)
    }
  }
})

test("body resets preserve error status and Retry-After already received in headers", async () => {
  for (const [status, reason] of [
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [503, "http_error"],
  ] as const) {
    const dispatcher = new BodyDispatcher((handler) => {
      handler.onData!(Buffer.from('{"data":'))
      setImmediate(() => handler.onError!(new Error("body reset")))
    }, status)
    await assert.rejects(client(dispatcher).getConnectEndpoints(), {
      name: "CrispApiError",
      status,
      reason,
      retryAfter: "2",
    })
  }
})
