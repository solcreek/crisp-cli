// Loaded only by E2E child processes. All REST traffic is intercepted in memory.
import { MockAgent, setGlobalDispatcher } from "undici"
const agent = new MockAgent()
agent.disableNetConnect()
agent.get("https://api.crisp.chat").intercept({
  method: "GET",
  path: `/v1/website/${process.env.CRISPCTL_WEBSITE_ID}/connect/endpoints`,
  headers: {
    "x-crisp-tier": "website",
    authorization: `Basic ${Buffer.from(`${process.env.CRISPCTL_IDENTIFIER}:${process.env.CRISPCTL_KEY}`).toString("base64")}`,
  },
}).reply(() => {
  process.send?.({ type: "discovery" })
  return { statusCode: 200, data: { error: false, reason: "resolved", data: { socket: { app: process.env.CRISPCTL_TEST_ENDPOINT } } } }
}).persist()
setGlobalDispatcher(agent)
// Allow the child to exit naturally while still reporting discovery to the parent.
process.channel?.unref()
