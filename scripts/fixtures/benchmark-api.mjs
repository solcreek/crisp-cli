// Synthetic, read-only REST responses. Unmatched requests cannot reach the network.
import { MockAgent, setGlobalDispatcher } from "undici"

const agent = new MockAgent()
agent.disableNetConnect()
setGlobalDispatcher(agent)
const pool = agent.get("https://api.crisp.chat")
const endpoint = process.env.CRISPCTL_BENCH_ENDPOINT
if (endpoint) {
  const url = new URL(endpoint)
  if (url.protocol !== "wss:" || url.hostname !== "127.0.0.1")
    throw new Error("benchmark requires a loopback WSS endpoint")
  pool
    .intercept({ method: "GET", path: "/v1/website/benchmark-site/connect/endpoints" })
    .reply(200, { error: false, data: { socket: { app: endpoint } } })
} else {
  const count = process.env.CRISPCTL_BENCH_LARGE === "1" ? 1024 : 1
  pool.intercept({ method: "GET", path: "/v1/website/benchmark-site/conversations/1" }).reply(200, {
    error: false,
    data: Array.from({ length: count }, (_, index) => ({
      session_id: `benchmark-session-${index}`,
      state: "unresolved",
      content: "x".repeat(1024),
    })),
  })
}
