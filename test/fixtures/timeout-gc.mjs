// Use real loopback HTTP transport so in-flight requests retain their handlers.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import { Agent, Dispatcher } from "undici"
import { CrispClient } from "../../dist/client.js"

let requests = 0
const server = createServer((_request, response) => {
  requests++
  response.writeHead(200, { "content-type": "application/json" })
  response.write('{"data":')
})
server.listen(0, "127.0.0.1")
await once(server, "listening")
const origin = `http://127.0.0.1:${server.address().port}`
const agent = new Agent()
const controller = new AbortController()
const manual = process.argv[2] === "manual"
const abortTimer = manual ? setTimeout(() => controller.abort(), 200) : undefined
class LoopbackDispatcher extends Dispatcher {
  dispatch(options, handler) {
    return agent.dispatch({ ...options, origin }, handler)
  }
}
let watchdogFired = false
let collections = 0
const watchdog = setTimeout(() => {
  watchdogFired = true
  server.closeAllConnections()
}, 2000)
const gcTimer = setInterval(() => {
  global.gc()
  collections++
}, 10)
try {
  const client = new CrispClient(
    { identifier: "fixture-id", key: "fixture-key", tier: "website", websiteId: "fixture-site" },
    new LoopbackDispatcher(),
    true,
  )
  await assert.rejects(
    client.getConnectEndpoints(manual ? controller.signal : AbortSignal.timeout(200)),
    {
      name: "CrispApiError",
      reason: "network_error",
    },
  )
  assert.ok(collections > 0, "garbage collection must run while waiting for the body")
  assert.equal(requests, 1, "request must reach the loopback server before cancellation")
  assert.equal(watchdogFired, false, "caller deadline must survive garbage collection")
} finally {
  clearTimeout(watchdog)
  clearTimeout(abortTimer)
  clearInterval(gcTimer)
  server.closeAllConnections()
  server.close()
  await agent.close()
}
