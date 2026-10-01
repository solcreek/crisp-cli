import { io, type Socket } from "socket.io-client"
import type { CrispClient, ClientCredentials } from "./client.js"
import { CrispApiError, UsageError } from "./errors.js"
import { assertEventTiers } from "./rtm-events.js"
import { retryDelay, waitForRetry, type RetryRuntime } from "./rtm-retry.js"

export const DEFAULT_EVENTS = ["message:send", "message:received", "session:set_state"]

export type RtmEvent = { event: string; data: unknown; received_at: string }
export type RtmStatus = { status: "authenticated" | "reconnecting"; website_id: string }
export type SocketFactory = (url: string, options: Parameters<typeof io>[1]) => Socket
export type ListenOptions = {
  events: string[]
  session?: string
  count?: number
  signal: AbortSignal
  onEvent: (event: RtmEvent) => void
  onStatus: (status: RtmStatus) => void
  socketFactory?: SocketFactory
  reconnectDelayMs?: number
  connectionTimeoutMs?: number
  retry?: Partial<RetryRuntime>
}

export function parseEvents(raw?: string): string[] {
  if (raw === undefined) return [...DEFAULT_EVENTS]
  const events = [...new Set(raw.split(",").map((value) => value.trim()))]
  if (events.some((event) => !/^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)+$/.test(event))) {
    throw new UsageError(
      "--events must contain comma-separated RTM event names (for example message:send)",
    )
  }
  return events
}

export function socketEndpoint(data: unknown): URL {
  const app = (data as { socket?: { app?: unknown } } | null)?.socket?.app
  let endpoint: URL
  try {
    if (typeof app !== "string") throw new Error()
    endpoint = new URL(app)
    if (endpoint.protocol !== "wss:" || endpoint.username || endpoint.password || endpoint.hash)
      throw new Error()
  } catch {
    throw new CrispApiError(
      200,
      "invalid_endpoint",
      "Crisp did not return a valid secure RTM socket.app endpoint",
    )
  }
  return endpoint
}

// A new discovery request precedes every connection attempt, including reconnects.
// Socket.IO's internal reconnect is disabled so it cannot reuse a stale endpoint.
export async function listen(
  client: Pick<CrispClient, "getConnectEndpoints">,
  creds: ClientCredentials,
  options: ListenOptions,
): Promise<void> {
  assertEventTiers(options.events, creds.tier)
  let received = 0
  let failures = 0
  while (!options.signal.aborted) {
    let retryAfter: string | undefined
    try {
      const endpoint = socketEndpoint(await client.getConnectEndpoints(options.signal))
      if (options.signal.aborted) break
      const result = await connection(endpoint, creds, options, (event) => {
        options.onEvent(event)
        received++
        return options.count !== undefined && received >= options.count
      })
      if (result === "done") return
      if (result === "connected") failures = 0
    } catch (error) {
      if (options.signal.aborted) break
      if (!(error instanceof CrispApiError) || ![0, 429, 500, 502, 503, 504].includes(error.status))
        throw error
      retryAfter = error.retryAfter
    }
    if (options.signal.aborted) break
    options.onStatus({ status: "reconnecting", website_id: creds.websiteId })
    const backoff = retryDelay(
      failures++,
      options.reconnectDelayMs ?? 1000,
      (options.retry?.random ?? Math.random)(),
      (options.retry?.now ?? Date.now)(),
      retryAfter,
    )
    try {
      await (options.retry?.sleep ?? waitForRetry)(backoff, options.signal)
    } catch (error) {
      if (!options.signal.aborted) throw error
    }
  }
}

function connection(
  endpoint: URL,
  creds: ClientCredentials,
  options: ListenOptions,
  onEvent: (event: RtmEvent) => boolean,
): Promise<"done" | "connected" | "retry"> {
  return new Promise((resolve, reject) => {
    const socket = (options.socketFactory ?? io)(endpoint.origin, {
      path: endpoint.pathname,
      query: Object.fromEntries(endpoint.searchParams),
      transports: ["websocket"],
      autoConnect: false,
      reconnection: false,
      forceNew: true,
      timeout: options.connectionTimeoutMs ?? 15_000,
    })
    let authenticated = false
    let settled = false
    const timer = setTimeout(() => finish("retry"), options.connectionTimeoutMs ?? 15_000)
    const abort = () => finish("done")
    function finish(result: "done" | "connected" | "retry", error?: Error): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal.removeEventListener("abort", abort)
      socket.removeAllListeners()
      socket.disconnect()
      if (error) reject(error)
      else resolve(result)
    }
    options.signal.addEventListener("abort", abort, { once: true })
    socket.on("connect", () => {
      socket.emit("authentication", {
        tier: creds.tier,
        username: creds.identifier,
        password: creds.key,
        events: options.events,
        rooms: [creds.websiteId],
      })
    })
    socket.on("authenticated", () => {
      authenticated = true
      clearTimeout(timer)
      try {
        options.onStatus({ status: "authenticated", website_id: creds.websiteId })
      } catch (error) {
        finish("done", error as Error)
      }
    })
    socket.on("unauthorized", () =>
      finish(
        "done",
        new CrispApiError(
          401,
          "unauthorized",
          "RTM authentication rejected; check token tier, scopes and website access",
        ),
      ),
    )
    socket.on("connect_error", () => finish("retry"))
    socket.on("disconnect", () => finish(authenticated ? "connected" : "retry"))
    for (const event of options.events) {
      socket.on(event, (data: unknown) => {
        if (!authenticated || !matchesScope(event, data, creds.websiteId, options.session)) return
        try {
          if (onEvent({ event, data, received_at: new Date().toISOString() })) finish("done")
        } catch (error) {
          finish("done", error as Error)
        }
      })
    }
    if (options.signal.aborted) abort()
    else socket.connect()
  })
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function matchesScope(event: string, data: unknown, websiteId: string, session?: string): boolean {
  const payload = record(data)
  if (!payload) return false
  // Bucket responses identify the website through resource, not website_id.
  // Never infer a website from the ambiguous top-level identifier field.
  if (event.startsWith("bucket:url:")) {
    const resource = record(payload.resource)
    if (resource?.type !== "website" || resource.id !== websiteId) return false
    if (payload.website_id !== undefined && payload.website_id !== websiteId) return false
  } else if (payload.website_id !== websiteId) return false
  if (!session) return true
  const sessionId =
    event === "email:track:view" && payload.type === "session"
      ? payload.identifier
      : payload.session_id
  return sessionId === session
}
