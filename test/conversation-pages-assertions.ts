import assert from "node:assert/strict"

// Official model: https://github.com/crisp-im/go-crisp-api/blob/master/crisp/website_conversation.go
// ConversationPage fields are optional; this validates live responses without requiring them.
export function assertConversationPages(pages: unknown): void {
  assert.ok(Array.isArray(pages), "pages should be an array")
  for (const page of pages) {
    assert.ok(
      page !== null && typeof page === "object" && !Array.isArray(page),
      "page should be an object",
    )
    for (const field of ["page_title", "page_url", "page_referrer"] as const) {
      if (page[field] !== undefined)
        assert.equal(typeof page[field], "string", `${field} should be a string`)
    }
    if (page.timestamp !== undefined) {
      assert.equal(typeof page.timestamp, "number", "timestamp should be a number")
      assert.ok(
        Number.isInteger(page.timestamp) && page.timestamp >= 0 && page.timestamp < 2 ** 64,
        "timestamp should be a non-negative integer in the uint64 range",
      )
    }
  }
}
