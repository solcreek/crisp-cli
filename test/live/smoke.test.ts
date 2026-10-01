import assert from "node:assert/strict"
import { test } from "node:test"
import { CrispClient } from "../../src/client.js"
import { assertComplete, resolveCredentials } from "../../src/config.js"
import { assertConversationPages } from "../conversation-pages-assertions.js"

const enabled = process.env.CRISPCTL_LIVE === "1" || process.env.CRISP_LIVE === "1"
const pagesSession = process.env.CRISPCTL_LIVE_PAGES_SESSION

test(
  "live smoke lists conversation pages",
  {
    skip:
      enabled && pagesSession ? false : "requires REST live opt-in and CRISPCTL_LIVE_PAGES_SESSION",
  },
  async () => {
    const creds = resolveCredentials(process.env, {})
    assertComplete(creds)
    const client = new CrispClient(creds, undefined, true)
    const pages = await client.listConversationPages(pagesSession!)
    assertConversationPages(pages)
  },
)

test(
  "live smoke lists operators",
  { skip: enabled ? false : "set CRISPCTL_LIVE=1 or CRISP_LIVE=1 (dedicated test website only)" },
  async () => {
    const creds = resolveCredentials(process.env, {})
    assertComplete(creds)
    const client = new CrispClient(creds, undefined, true)
    const operators = await client.listOperators()
    assert.ok(Array.isArray(operators), "operators list should be an array")
  },
)
