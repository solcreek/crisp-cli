// Read-only live verification. Credentials stay in memory and the child environment.
import { execFileSync, spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { monitorRtmSmoke } from "./rtm-smoke-monitor.mjs"

const expectedName = process.argv[2]
const mode = process.argv[3] ?? "event"
if (!expectedName || !["auth", "event"].includes(mode))
  throw new Error("Usage: node scripts/rtm-smoke.mjs <expected-website-name> [auth|event]")
const itemName = process.env.CRISPCTL_LIVE_OP_ITEM || "Crisp API Credentials"
const vault = process.env.CRISPCTL_LIVE_OP_VAULT
let item
try {
  item = JSON.parse(
    execFileSync(
      "op",
      ["item", "get", itemName, "--format", "json", ...(vault ? ["--vault", vault] : [])],
      {
        encoding: "utf8",
        timeout: 60_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  )
} catch {
  // execFileSync errors can contain partial credential stdout/stderr.
  throw new Error("1Password credential lookup failed or timed out")
}
const field = (label) =>
  Array.isArray(item?.fields)
    ? item.fields.find((entry) => entry && entry.label === label && typeof entry.value === "string")
        ?.value
    : undefined
const identifier = field("API Identifier") || field("token_identifier")
const key = field("API Key") || field("token_key")
const websiteId = field("website_id")
if (!identifier || !key || !websiteId) throw new Error("1Password item is missing required fields")
const response = await fetch(`https://api.crisp.chat/v1/website/${encodeURIComponent(websiteId)}`, {
  headers: {
    Authorization: `Basic ${Buffer.from(`${identifier}:${key}`).toString("base64")}`,
    "X-Crisp-Tier": "website",
  },
  signal: AbortSignal.timeout(20_000),
})
const website = await response.json()
if (!response.ok || website.error || website.data?.name !== expectedName)
  throw new Error("Website identity verification failed")
console.log(
  JSON.stringify({ check: "website", website_matches: true, tier: "website", read_only: true }),
)
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL("../dist/index.js", import.meta.url)),
    "listen",
    "--json",
    "--read-only",
    "--events",
    "message:send,message:received,session:set_state,session:update_availability,website:update_visitors_count,website:update_operators_availability",
    "--count",
    "1",
    "--timeout",
    "60",
  ],
  {
    env: {
      ...process.env,
      CRISPCTL_IDENTIFIER: identifier,
      CRISPCTL_KEY: key,
      CRISPCTL_WEBSITE_ID: websiteId,
      CRISPCTL_TIER: "website",
      CRISPCTL_READ_ONLY: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
)
process.exitCode = (await monitorRtmSmoke(child, {
  websiteId,
  mode,
  report: (value) => console.log(JSON.stringify(value)),
}))
  ? 0
  : 1
