import { readFileSync } from "node:fs"
import type { RtmEventDefinition } from "../src/rtm-events.js"
import { FIXTURE } from "./support.js"

export type ReferenceEvent = RtmEventDefinition & {
  fields: string[]
  website_path: string[]
  session_path: string[]
}
export const reference = JSON.parse(
  readFileSync(new URL("./fixtures/rtm-reference.json", import.meta.url), "utf8"),
) as {
  source: string
  checked_at: string
  events: ReferenceEvent[]
}

// Synthetic data, with routing fields placed where the official examples put them.
// Nested data deliberately includes values that must survive opaque JSON forwarding.
export function eventPayload(
  definition: ReferenceEvent,
  websiteId = FIXTURE.websiteId,
): Record<string, unknown> {
  const payload: Record<string, unknown> = Object.fromEntries(
    definition.fields.map((field) => [field, null]),
  )
  if (definition.website_path[0] === "resource") {
    payload.resource = { type: "website", id: websiteId }
    payload.identifier = websiteId
    payload.url = {
      resource: "https://example.invalid/file",
      signed: "https://example.invalid/file?fixture=1",
    }
  } else if (definition.website_path.length) payload.website_id = websiteId
  if (definition.session_path[0] === "identifier") {
    payload.type = "session"
    payload.identifier = FIXTURE.session
  } else if (definition.session_path.length) payload.session_id = FIXTURE.session
  payload.fixture_extra = {
    nested: [{ text: "保留\nUnicode", number: 0, enabled: false, value: null }],
    list: [],
  }
  return payload
}
