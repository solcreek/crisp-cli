import { fetch as undiciFetch, type Dispatcher } from "undici"
import { CrispApiError, UsageError } from "./errors.js"
import type { Tier } from "./config.js"
import { version } from "./version.js"

export const CRISP_ORIGIN = "https://api.crisp.chat"

export type ClientCredentials = {
  identifier: string
  key: string
  tier: Tier
  websiteId: string
}

type Query = Record<string, string | undefined>

type Envelope = {
  error?: boolean
  reason?: string
  data?: unknown
}

export class CrispClient {
  constructor(
    private readonly creds: ClientCredentials,
    private readonly dispatcher?: Dispatcher,
    private readonly readOnly = false,
    private readonly signal?: AbortSignal,
  ) {}

  getConnectEndpoints(signal?: AbortSignal): Promise<unknown> {
    const path =
      this.creds.tier === "website" ? this.site("/connect/endpoints") : "/plugin/connect/endpoints"
    return this.request("GET", path, { signal })
  }

  listConversations(page = 1): Promise<unknown> {
    return this.request("GET", this.site(`/conversations/${page}`))
  }

  getConversation(sessionId: string): Promise<unknown> {
    return this.request("GET", this.site(`/conversation/${encodeURIComponent(sessionId)}`))
  }

  searchConversations(searchQuery: string, page = 1, searchType = "text"): Promise<unknown> {
    return this.request("GET", this.site(`/conversations/${page}`), {
      query: {
        search_query: searchQuery,
        search_type: searchType,
      },
    })
  }

  listMessages(sessionId: string): Promise<unknown> {
    return this.request("GET", this.site(`/conversation/${encodeURIComponent(sessionId)}/messages`))
  }

  sendOperatorMessage(sessionId: string, kind: "text" | "note", content: string): Promise<unknown> {
    return this.request(
      "POST",
      this.site(`/conversation/${encodeURIComponent(sessionId)}/message`),
      {
        body: {
          type: kind,
          from: "operator",
          origin: "chat",
          content,
        },
      },
    )
  }

  setState(sessionId: string, state: "resolved" | "unresolved"): Promise<unknown> {
    return this.request(
      "PATCH",
      this.site(`/conversation/${encodeURIComponent(sessionId)}/state`),
      {
        body: { state },
      },
    )
  }

  assign(sessionId: string, userId: string | null): Promise<unknown> {
    return this.request(
      "PATCH",
      this.site(`/conversation/${encodeURIComponent(sessionId)}/routing`),
      {
        body: {
          assigned: userId === null ? null : { user_id: userId },
        },
      },
    )
  }

  setSegments(sessionId: string, segments: string[]): Promise<unknown> {
    return this.request("PATCH", this.site(`/conversation/${encodeURIComponent(sessionId)}/meta`), {
      body: { segments },
    })
  }

  markRead(sessionId: string): Promise<unknown> {
    return this.request("PATCH", this.site(`/conversation/${encodeURIComponent(sessionId)}/read`), {
      body: {
        from: "operator",
        origin: "chat",
      },
    })
  }

  async getPerson(idOrEmail: string): Promise<unknown> {
    const peopleId = isEmail(idOrEmail) ? await this.peopleIdForEmail(idOrEmail) : idOrEmail
    return this.request("GET", this.site(`/people/profile/${encodeURIComponent(peopleId)}`))
  }

  private async peopleIdForEmail(email: string): Promise<string> {
    const listed = await this.request("GET", this.site("/people/profiles/1"), {
      query: { search_text: email },
    })
    if (!Array.isArray(listed)) {
      throw new CrispApiError(200, "invalid_json", "people search did not return a list")
    }
    const needle = email.toLowerCase()
    for (const item of listed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue
      const profile = item as { email?: unknown; people_id?: unknown }
      if (typeof profile.email !== "string" || profile.email.toLowerCase() !== needle) continue
      if (typeof profile.people_id !== "string" || profile.people_id.length === 0) continue
      return profile.people_id
    }
    throw new CrispApiError(404, "not_found", "people profile not found")
  }

  listOperators(): Promise<unknown> {
    return this.request("GET", this.site("/operators/list"))
  }

  private site(suffix: string): string {
    return `/website/${encodeURIComponent(this.creds.websiteId)}${suffix}`
  }

  private async request(
    method: string,
    path: string,
    opts?: { query?: Query; body?: unknown; signal?: AbortSignal },
  ): Promise<unknown> {
    if (this.readOnly && method !== "GET" && method !== "HEAD") {
      throw new UsageError("read-only mode: write operations are disabled")
    }
    const url = new URL(`/v1${path}`, CRISP_ORIGIN)
    for (const [key, value] of Object.entries(opts?.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.append(key, value)
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${this.creds.identifier}:${this.creds.key}`).toString("base64")}`,
      "X-Crisp-Tier": this.creds.tier,
      "User-Agent": `crispctl/${version}`,
    }
    let body: string | undefined
    if (opts?.body !== undefined) {
      headers["Content-Type"] = "application/json"
      body = JSON.stringify(opts.body)
    }

    let response: Awaited<ReturnType<typeof undiciFetch>> | undefined
    let text: string
    try {
      const signals = [this.signal, opts?.signal, AbortSignal.timeout(20_000)].filter(
        (signal): signal is AbortSignal => signal !== undefined,
      )
      const signal = AbortSignal.any(signals)
      signal.throwIfAborted()
      response = await undiciFetch(url, {
        method,
        headers,
        body,
        redirect: "error",
        dispatcher: this.dispatcher,
        signal,
      })
      text = await response.text()
    } catch (err) {
      if (response && response.status >= 400) {
        throw new CrispApiError(
          response.status,
          statusReason(response.status),
          `HTTP ${response.status}`,
          response.headers.get("retry-after") ?? undefined,
        )
      }
      const message = err instanceof Error ? err.message : "request failed"
      throw new CrispApiError(0, "network_error", message)
    }

    const retryAfter = response.headers.get("retry-after") ?? undefined
    let payload: Envelope | null = null
    if (text.length > 0) {
      let decoded: unknown
      try {
        decoded = JSON.parse(text)
      } catch {
        if (response.status >= 400) {
          throw new CrispApiError(
            response.status,
            statusReason(response.status),
            `HTTP ${response.status}`,
            retryAfter,
          )
        }
        throw new CrispApiError(
          response.status,
          "invalid_json",
          "response was not JSON",
          retryAfter,
        )
      }
      if (!isEnvelope(decoded)) {
        throw new CrispApiError(
          response.status,
          "invalid_json",
          "response was not a JSON object",
          retryAfter,
        )
      }
      payload = decoded
    }

    if (response.status >= 400 || payload?.error === true) {
      const reason =
        typeof payload?.reason === "string" && payload.reason
          ? payload.reason
          : statusReason(response.status)
      const dataMessage = readDataMessage(payload?.data)
      throw new CrispApiError(response.status, reason, dataMessage || reason, retryAfter)
    }

    if (payload && "data" in payload) {
      return payload.data ?? null
    }
    return null
  }
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+$/.test(value)
}

function statusReason(status: number): string {
  if (status === 429) return "rate_limited"
  if (status === 401 || status === 403) return "unauthorized"
  if (status === 404) return "not_found"
  return "http_error"
}

function readDataMessage(data: unknown): string {
  if (!data || typeof data !== "object" || !("message" in data)) {
    return ""
  }
  const message = (data as { message?: unknown }).message
  return typeof message === "string" ? message : ""
}
