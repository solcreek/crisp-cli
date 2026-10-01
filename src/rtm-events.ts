import type { Tier } from "./config.js"
import { UsageError } from "./errors.js"

export const RTM_REFERENCE_URL = "https://docs.crisp.chat/references/rtm-api/v1/"
export const RTM_REFERENCE_CHECKED = "2026-10-01"
export type RtmEventDefinition = {
  event: string
  tiers: readonly (Tier | "user")[]
  scopes: readonly string[]
}

// Event names, tiers and scope requirements from the official RTM v1 reference.
// Empty scopes mean the reference does not specify a scope, not unrestricted access.
export const RTM_EVENTS: readonly RtmEventDefinition[] = [
  {"event": "session:update_availability", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:update_verify", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:request:initiated", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:initiate", "write"]},
  {"event": "session:set_email", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:set_phone", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:set_address", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:set_subject", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:set_avatar", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:set_nickname", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:set_origin", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:set_data", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:set_segments", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:set_block", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:actions", "read"]},
  {"event": "session:set_opened", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:actions", "read"]},
  {"event": "session:set_closed", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:actions", "read"]},
  {"event": "session:set_participants", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:participants", "read"]},
  {"event": "session:set_mentions", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:set_routing", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:routing", "read"]},
  {"event": "session:set_inbox", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:set_state", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:states", "read"]},
  {"event": "session:sync:capabilities", "tiers": ["user", "website", "plugin"], "scopes": []},
  {"event": "session:sync:geolocation", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:sync:system", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:sync:network", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:sync:timezone", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:sync:locales", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:sync:pages", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:pages", "read"]},
  {"event": "session:sync:events", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:events", "read"]},
  {"event": "session:sync:rating", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:sync:topic", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:removed", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "session:error", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:sessions", "read"]},
  {"event": "message:updated", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "message:send", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "message:received", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "message:removed", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "message:compose:send", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "message:compose:receive", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "message:acknowledge:read:send", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "message:acknowledge:read:received", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "message:acknowledge:unread:send", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "message:acknowledge:delivered", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "message:acknowledge:ignored", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "message:notify:unread:send", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "message:notify:unread:received", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:messages", "read"]},
  {"event": "spam:message", "tiers": ["user"], "scopes": []},
  {"event": "spam:decision", "tiers": ["user"], "scopes": []},
  {"event": "people:profile:created", "tiers": ["user", "website", "plugin"], "scopes": ["website:people:profiles", "read"]},
  {"event": "people:profile:updated", "tiers": ["user", "website", "plugin"], "scopes": ["website:people:profiles", "read"]},
  {"event": "people:profile:removed", "tiers": ["user", "website", "plugin"], "scopes": ["website:people:profiles", "read"]},
  {"event": "people:bind:session", "tiers": ["user", "website", "plugin"], "scopes": ["website:people:profiles", "read"]},
  {"event": "people:sync:profile", "tiers": ["user", "website", "plugin"], "scopes": ["website:people:profiles", "read"]},
  {"event": "people:import:progress", "tiers": ["user"], "scopes": []},
  {"event": "people:import:done", "tiers": ["user"], "scopes": []},
  {"event": "campaign:progress", "tiers": ["user"], "scopes": []},
  {"event": "campaign:dispatched", "tiers": ["user"], "scopes": []},
  {"event": "campaign:running", "tiers": ["user"], "scopes": []},
  {"event": "browsing:request:initiated", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:browsing", "write"]},
  {"event": "browsing:request:rejected", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:browsing", "write"]},
  {"event": "call:request:initiated", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:calls", "write"]},
  {"event": "call:request:rejected", "tiers": ["user", "website", "plugin"], "scopes": ["website:conversation:calls", "write"]},
  {"event": "identity:verify:request", "tiers": ["plugin"], "scopes": []},
  {"event": "widget:action:processed", "tiers": ["user"], "scopes": []},
  {"event": "status:health:changed", "tiers": ["user"], "scopes": []},
  {"event": "website:update_visitors_count", "tiers": ["user", "website", "plugin"], "scopes": ["website:visitors", "read"]},
  {"event": "website:update_operators_availability", "tiers": ["user", "website", "plugin"], "scopes": ["website:operators", "read"]},
  {"event": "website:users:available", "tiers": ["user", "website", "plugin"], "scopes": ["website:availability", "read"]},
  {"event": "bucket:url:upload:generated", "tiers": ["user", "website", "plugin"], "scopes": ["bucket:url", "write"]},
  {"event": "bucket:url:avatar:generated", "tiers": ["user", "website", "plugin"], "scopes": ["bucket:url", "write"]},
  {"event": "bucket:url:website:generated", "tiers": ["user", "website", "plugin"], "scopes": ["bucket:url", "write"]},
  {"event": "bucket:url:campaign:generated", "tiers": ["user", "website", "plugin"], "scopes": ["bucket:url", "write"]},
  {"event": "bucket:url:helpdesk:generated", "tiers": ["user", "website", "plugin"], "scopes": ["bucket:url", "write"]},
  {"event": "bucket:url:status:generated", "tiers": ["user", "website", "plugin"], "scopes": ["bucket:url", "write"]},
  {"event": "bucket:url:processing:generated", "tiers": ["user", "website", "plugin"], "scopes": ["bucket:url", "write"]},
  {"event": "media:animation:listed", "tiers": ["user"], "scopes": []},
  {"event": "email:subscribe", "tiers": ["user", "website", "plugin"], "scopes": ["website:people:subscriptions", "read"]},
  {"event": "email:track:view", "tiers": ["user", "website", "plugin"], "scopes": ["website:people:subscriptions", "read"]},
  {"event": "plugin:channel", "tiers": ["user", "website", "plugin"], "scopes": []},
  {"event": "plugin:event", "tiers": ["user", "website", "plugin"], "scopes": []},
  {"event": "plugin:subscription:updated", "tiers": ["user", "website", "plugin"], "scopes": []},
  {"event": "plugin:settings:saved", "tiers": ["user", "website", "plugin"], "scopes": []},
  {"event": "plan:subscription:updated", "tiers": ["user", "website", "plugin"], "scopes": ["plan:subscription", "read"]},
]

export function assertEventTiers(events: readonly string[], tier: Tier): void {
  for (const event of events) {
    const definition = RTM_EVENTS.find(item => item.event === event)
    if (definition && !definition.tiers.includes(tier)) {
      throw new UsageError(`RTM event ${event} requires token tier ${definition.tiers.join(" or ")}; current tier is ${tier}`)
    }
  }
}
