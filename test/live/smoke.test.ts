import assert from "node:assert/strict"
import { test } from "node:test"
import { CrispClient } from "../../src/client.js"
import { assertComplete, resolveCredentials } from "../../src/config.js"

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
    assert.ok(Array.isArray(pages), "pages should be an array")
    for (const page of pages) {
      assert.equal(typeof page.page_title, "string")
      assert.equal(typeof page.page_url, "string")
      assert.equal(typeof page.timestamp, "number")
      assert.ok(Number.isFinite(page.timestamp))
      if (page.page_referrer !== undefined) assert.equal(typeof page.page_referrer, "string")
    }
  },
)

test(
  "live smoke lists operators",
  { skip: enabled ? false : "set CRISPCTL_LIVE=1 or CRISP_LIVE=1 (dedicated test website only)" },
  async () => {
    const creds = resolveCredentials(process.env, {})
    assertComplete(creds)
    const client = new CrispClient({
      identifier: creds.identifier,
      key: creds.key,
      tier: creds.tier,
      websiteId: creds.websiteId,
    })
    const operators = await client.listOperators()
    assert.ok(Array.isArray(operators), "operators list should be an array")
  },
)
