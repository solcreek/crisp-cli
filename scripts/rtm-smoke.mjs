// Read-only live verification. Credentials stay in memory and the child environment.
import { execFileSync, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const expectedName = process.argv[2]
if (!expectedName) throw new Error("Usage: node scripts/rtm-smoke.mjs <expected-website-name>")
const item = JSON.parse(execFileSync("op", ["item", "get", "Crisp API Credentials", "--format", "json"], { encoding: "utf8" }))
const field = label => item.fields.find(field => field.label === label)?.value
const identifier = field("API Identifier")
const key = field("API Key")
const websiteId = field("website_id")
if (!identifier || !key || !websiteId) throw new Error("1Password item is missing required fields")
const response = await fetch(`https://api.crisp.chat/v1/website/${encodeURIComponent(websiteId)}`, {
  headers: { Authorization: `Basic ${Buffer.from(`${identifier}:${key}`).toString("base64")}`, "X-Crisp-Tier": "website" },
  signal: AbortSignal.timeout(20_000),
})
const website = await response.json()
if (!response.ok || website.error || website.data?.name !== expectedName) throw new Error("Website identity verification failed")
console.log(JSON.stringify({ check: "website", name: expectedName, tier: "website", read_only: true }))
const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/index.js", import.meta.url)), "listen", "--json", "--read-only", "--events", "message:send,message:received,session:set_state,session:update_availability,website:update_visitors_count,website:update_operators_availability", "--count", "1", "--timeout", "60"], {
  env: { ...process.env, CRISPCTL_IDENTIFIER: identifier, CRISPCTL_KEY: key, CRISPCTL_WEBSITE_ID: websiteId, CRISPCTL_TIER: "website", CRISPCTL_READ_ONLY: "1" },
  stdio: ["ignore", "pipe", "pipe"],
})
let received = 0
function lines(stream, handle) {
  let pending = ""
  stream.setEncoding("utf8")
  stream.on("data", chunk => {
    pending += chunk
    const parts = pending.split("\n")
    pending = parts.pop()
    for (const line of parts) if (line.trim()) handle(JSON.parse(line))
  })
}
lines(child.stdout, event => {
  if (event.data?.website_id !== websiteId) throw new Error("Event website mismatch")
  received++
  console.log(JSON.stringify({ check: "event", event: event.event, received_at: event.received_at, website_matches: true, payload_keys: Object.keys(event.data), customer_content_printed: false }))
})
lines(child.stderr, status => {
  console.log(JSON.stringify({ check: "status", status: status.status, error: status.error }))
})
child.on("error", () => { console.error("Could not start CLI"); process.exitCode = 1 })
// Wait for stdout/stderr to drain before counting the final event.
child.on("close", code => {
  console.log(JSON.stringify({ check: "result", exit_code: code, received_events: received }))
  process.exitCode = code === 0 && received > 0 ? 0 : 1
})
