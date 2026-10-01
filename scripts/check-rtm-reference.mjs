// Optional documentation drift check. Normal tests use the checked-in snapshot.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { RTM_EVENTS, RTM_REFERENCE_URL } from "../dist/rtm-events.js"

const localFile = process.argv[2]
let html
if (localFile) html = await readFile(localFile, "utf8")
else {
  const response = await fetch(RTM_REFERENCE_URL, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`RTM reference request failed: HTTP ${response.status}`)
  html = await response.text()
}
const codes = (source) => [...source.matchAll(/<code>(.*?)<\/code>/g)].map((match) => match[1])
const actual = []
for (const section of html.split(/<h3\b/).slice(1)) {
  const event = section.match(/<strong>Event:<\/strong>\s*<code>(.*?)<\/code>/)?.[1]
  if (!event) continue
  const tierSection = section.match(/<strong>Tiers:<\/strong>(.*?)<\/li>/s)?.[1]
  assert.ok(tierSection, `No tiers found for ${event}`)
  const tiers = codes(tierSection).flatMap((tier) => {
    // Known markup typo in the official 2026-02-12 reference.
    return event === "website:update_visitors_count" && tier === "user``website"
      ? ["user", "website"]
      : [tier]
  })
  const scopeSection = section.match(/<strong>Scopes:<\/strong>(.*?)<\/li>/s)?.[1]
  actual.push({ event, tiers, scopes: scopeSection ? codes(scopeSection) : [] })
}
assert.ok(actual.length > 0, "Could not parse RTM reference event sections")
assert.deepEqual(
  actual,
  RTM_EVENTS,
  "Official RTM events/tiers/scopes have changed; review the catalog, fixtures and coverage matrix",
)
console.log(
  JSON.stringify({ source: RTM_REFERENCE_URL, events: actual.length, catalog_matches: true }),
)
