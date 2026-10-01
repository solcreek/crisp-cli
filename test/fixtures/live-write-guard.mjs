// Run the opt-in harness entirely offline, including its failure cleanup path.
import assert from "node:assert/strict"
import { MockAgent, setGlobalDispatcher } from "undici"

const mismatch = process.env.LIVE_GUARD_MODE === "mismatch"
const agent = new MockAgent()
agent.disableNetConnect()
setGlobalDispatcher(agent)
const pool = agent.get("https://api.crisp.chat")
const website = "fixture-website"
const session = "fixture-created-session"
const calls = []
function reply(method, path, status, data) {
  pool.intercept({ method, path }).reply(() => {
    calls.push(`${method} ${path}`)
    return { statusCode: status, data: JSON.stringify(data) }
  })
}
reply("GET", `/v1/website/${website}`, 200, {
  error: false,
  data: { name: mismatch ? "Other fixture" : "Fixture sandbox" },
})
if (!mismatch) {
  reply("POST", `/v1/website/${website}/conversation`, 201, {
    error: false,
    data: { session_id: session },
  })
  reply("GET", `/v1/website/${website}/connect/endpoints`, 401, {
    error: true,
    reason: "invalid_session",
  })
  reply("DELETE", `/v1/website/${website}/conversation/${session}`, 200, {
    error: false,
    reason: "deleted",
    data: {},
  })
}
process.once("exit", () => {
  assert.deepEqual(
    calls,
    mismatch
      ? [`GET /v1/website/${website}`]
      : [
          `GET /v1/website/${website}`,
          `POST /v1/website/${website}/conversation`,
          `GET /v1/website/${website}/connect/endpoints`,
          `DELETE /v1/website/${website}/conversation/${session}`,
        ],
  )
  agent.assertNoPendingInterceptors()
  console.log("live-guard-contract-passed")
})
