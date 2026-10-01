import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"
import { gzipSync } from "node:zlib"
import { Agent, Dispatcher, Response } from "undici"
import { CrispClient } from "../src/client.js"
import { decodeResponse, MAX_RESPONSE_BYTES, readResponseText } from "../src/response.js"
import { FIXTURE, withCrispMock } from "./support.js"

for (const body of [
  null,
  [],
  true,
  1,
  "ok",
  { error: "true" },
  { error: 0 },
  { error: null },
  { reason: false },
  { reason: null },
]) {
  for (const status of [200, 401, 403, 404, 429, 503]) {
    test(`invalid envelope ${JSON.stringify(body)} at HTTP ${status}`, async () => {
      await withCrispMock(
        { status, json: JSON.stringify(body), headers: { "retry-after": "7" } },
        async (dispatcher) => {
          const client = new CrispClient({ ...FIXTURE, tier: "website" }, dispatcher, true)
          await assert.rejects(client.listOperators(), {
            status,
            reason:
              status === 200
                ? "invalid_json"
                : status === 429
                  ? "rate_limited"
                  : status === 404
                    ? "not_found"
                    : status === 503
                      ? "http_error"
                      : "unauthorized",
            retryAfter: "7",
          })
        },
      )
    })
  }
}

test("envelope decoder preserves optional fields, arbitrary data and unknown fields", () => {
  for (const data of [null, false, 0, "", "value", [1], { future: true }]) {
    assert.deepEqual(decodeResponse(JSON.stringify({ data, future: "accepted" }), 200), data)
  }
  assert.equal(decodeResponse("{}", 200), null)
  assert.equal(decodeResponse("", 204), null)
  assert.throws(
    () => decodeResponse('{"error":true,"reason":"denied","data":{"message":"fixture"}}', 200),
    { reason: "denied", message: "fixture" },
  )
  assert.throws(() => decodeResponse('{"error":true,"reason":"","data":null}', 200), {
    reason: "http_error",
  })
  assert.throws(() => decodeResponse("", 429, "2"), { reason: "rate_limited", retryAfter: "2" })
})

test("reader counts bytes and preserves UTF-8 split across chunks at the exact limit", async () => {
  const bytes = Buffer.from("一二")
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 1))
      controller.enqueue(bytes.subarray(1, 4))
      controller.enqueue(bytes.subarray(4))
      controller.close()
    },
  })
  assert.equal(await readResponseText(new Response(body), new AbortController().signal, 6), "一二")
})

for (const status of [200, 429]) {
  test(`reader cancels oversized body and preserves HTTP ${status}`, async () => {
    let cancelled = false
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("一二三"))
      },
      cancel() {
        cancelled = true
      },
    })
    await assert.rejects(
      readResponseText(
        new Response(body, { status, headers: { "retry-after": "3" } }),
        new AbortController().signal,
        8,
      ),
      {
        status,
        reason: status === 200 ? "response_too_large" : "rate_limited",
        retryAfter: "3",
      },
    )
    assert.equal(cancelled, true)
  })
}

for (const compressed of [false, true]) {
  test(`client bounds ${compressed ? "decompressed" : "chunked"} HTTP bodies and closes transport`, async () => {
    let closed!: Promise<unknown[]>
    const server = createServer((_req, response) => {
      closed = once(response, "close")
      response.writeHead(200, {
        "content-type": "application/json",
        ...(compressed ? { "content-encoding": "gzip" } : {}),
      })
      const body = Buffer.from(JSON.stringify({ data: "x".repeat(MAX_RESPONSE_BYTES) }))
      response.write(compressed ? gzipSync(body) : body)
      // Leave the transport open; exceeding the cap must cancel it.
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const address = server.address()
    assert.ok(address && typeof address === "object")
    const origin = `http://127.0.0.1:${address.port}`
    const agent = new Agent()
    class LoopbackDispatcher extends Dispatcher {
      override dispatch(
        options: Dispatcher.DispatchOptions,
        handler: Dispatcher.DispatchHandlers,
      ): boolean {
        return agent.dispatch({ ...options, origin }, handler)
      }
    }
    const watchdog = setTimeout(() => server.closeAllConnections(), 5000)
    try {
      const client = new CrispClient(
        { ...FIXTURE, tier: "website" },
        new LoopbackDispatcher(),
        true,
      )
      await assert.rejects(client.listOperators(), { status: 200, reason: "response_too_large" })
      await closed!
    } finally {
      clearTimeout(watchdog)
      server.closeAllConnections()
      server.close()
      await agent.close()
    }
  })
}
