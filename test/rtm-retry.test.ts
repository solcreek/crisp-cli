import assert from "node:assert/strict"
import { test } from "node:test"
import { retryDelay, waitForRetry } from "../src/rtm-retry.js"

test("retry delay grows, caps and spans equal-jitter bounds", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 100].map(n => retryDelay(n, 1000, 1, 0)), [1000, 2000, 4000, 8000, 16000, 30000, 30000])
  assert.equal(retryDelay(0, 1000, 0, 0), 500)
  assert.equal(retryDelay(0, 1000, 0.5, 0), 750)
  assert.equal(retryDelay(100, 1000, 0, 0), 15000)
  assert.equal(retryDelay(20, 1, 1, 0), 30000)
})

test("Retry-After seconds and HTTP dates are a minimum, including delays beyond the backoff cap", () => {
  const now = Date.parse("Thu, 01 Oct 2026 12:00:00 GMT")
  for (const [header, expected] of [
    ["120", 120000], [" 2 ", 2000], ["0", 1000],
    ["Thu, 01 Oct 2026 12:01:00 GMT", 60000],
    ["Thu, 01 Oct 2026 11:00:00 GMT", 1000],
    ["garbage", 1000], ["-1", 1000], ["1.5", 1000], ["", 1000],
    ["Thu, broken", 1000], ["9".repeat(400), 1000],
  ] as const) assert.equal(retryDelay(0, 1000, 1, now, header), expected, header)
})

test("long waits are chunked within Node timer limits and remain abortable", async () => {
  const controller = new AbortController()
  const delays: number[] = []
  await waitForRetry(2_147_483_657, controller.signal, async ms => { delays.push(ms) })
  assert.deepEqual(delays, [2_147_483_647, 10])
  await assert.rejects(waitForRetry(2_147_483_657, controller.signal, async () => { controller.abort() }), { name: "AbortError" })
  await waitForRetry(0, controller.signal)
})

test("default retry sleep completes and abort interrupts an outstanding timer", async () => {
  await waitForRetry(1, new AbortController().signal)
  const controller = new AbortController()
  const waiting = waitForRetry(60_000, controller.signal)
  controller.abort()
  await assert.rejects(waiting, { name: "AbortError" })
})
