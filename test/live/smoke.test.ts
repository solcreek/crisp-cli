import assert from "node:assert/strict"
import { test } from "node:test"
import { CrispClient } from "../../src/client.js"
import { assertComplete, resolveCredentials } from "../../src/config.js"

const enabled = process.env.CRISPCTL_LIVE === "1" || process.env.CRISP_LIVE === "1"

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
