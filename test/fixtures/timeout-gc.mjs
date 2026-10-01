// Use real loopback HTTP and start collection only after body delivery.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { Agent, Dispatcher, fetch } from "undici"
import { CrispClient } from "../../dist/client.js"
import { readResponseText } from "../../dist/response.js"

let requests = 0
let closed
const server = createServer((_request, response) => {
  requests++
  closed = once(response, "close")
  response.writeHead(200, { "content-type": "application/json" })
  response.write('{"data":')
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
const origin = `http://127.0.0.1:${server.address().port}`
const agent = new Agent()
const controller = new AbortController()
const mode = process.argv[2]
assert.ok(["timeout", "manual", "client-timeout"].includes(mode))
let abortTimer
let gcTimer
let collections = 0
let bodyStarted = false
function startCollection() {
  assert.equal(bodyStarted, false)
  bodyStarted = true
  gcTimer = setInterval(() => {
    global.gc()
    collections++
  }, 10)
}
class LoopbackDispatcher extends Dispatcher {
  dispatch(options, handler) {
    const onData = handler.onData.bind(handler)
    handler.onData = (chunk) => {
      const result = onData(chunk)
      startCollection()
      if (mode === "manual") abortTimer = setTimeout(() => controller.abort(), 200)
      return result
    }
    return agent.dispatch({ ...options, origin }, handler)
  }
}
let watchdogFired = false
const watchdog = setTimeout(() => {
  watchdogFired = true
  server.closeAllConnections()
}, 5000)
try {
  if (mode === "manual" || mode === "client-timeout") {
    const client = new CrispClient(
      { identifier: "fixture-id", key: "fixture-key", tier: "website", websiteId: "fixture-site" },
      new LoopbackDispatcher(),
      true,
    )
    // Exercise the client's combined signal and source-timeout retention too.
    // Allow connection setup before the native deadline; GC still starts only
    // after observed body progress, and the watchdog independently bounds hangs.
    await assert.rejects(
      client.getConnectEndpoints(mode === "manual" ? controller.signal : AbortSignal.timeout(2000)),
      { name: "CrispApiError", reason: "network_error" },
    )
  } else {
    // Establish body progress before creating the native timeout. This isolates
    // the GC regression from DNS, connection and runner scheduling delays.
    const response = await fetch(origin, { dispatcher: agent })
    const reader = response.body.getReader()
    const first = await reader.read()
    assert.equal(first.done, false)
    reader.releaseLock()
    startCollection()
    await assert.rejects(readResponseText(response, AbortSignal.timeout(200)), {
      name: "AbortError",
    })
  }
  await closed
  assert.ok(collections > 0, "garbage collection must run while waiting for the body")
  assert.equal(bodyStarted, true)
  assert.equal(requests, 1)
  assert.equal(watchdogFired, false, "cancellation must close transport without the watchdog")
} finally {
  clearTimeout(watchdog)
  clearTimeout(abortTimer)
  clearInterval(gcTimer)
  server.closeAllConnections()
  server.close()
  await agent.close()
}
