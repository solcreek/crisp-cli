// Test-only preload for the built executable; unexpected requests cannot reach Crisp.
import { MockAgent, setGlobalDispatcher } from "undici"

const agent = new MockAgent()
agent.disableNetConnect()
agent
  .get("https://api.crisp.chat")
  .intercept({
    method: "GET",
    path: "/v1/website/8c842203-7ed8-4e29-a608-7cf78a7d2fcc/conversation/session_700c65e1-85e2-465a-b9ac-ecb5ec2c9881/pages/2",
    headers: {
      "x-crisp-tier": "plugin",
      authorization: `Basic ${Buffer.from("11111111-1111-1111-1111-111111111111:fixture-token-key-do-not-log").toString("base64")}`,
    },
  })
  .reply(200, {
    error: false,
    reason: "resolved",
    data: [{ page_title: "Help", page_url: "https://example.test/help", timestamp: 1790812800000 }],
  })
setGlobalDispatcher(agent)
