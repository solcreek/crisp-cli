import { fetch as undiciFetch, type Dispatcher } from "undici"
import { CrispApiError } from "./errors.js"
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
  ) {}

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
    return this.request("POST", this.site(`/conversation/${encodeURIComponent(sessionId)}/message`), {
      body: {
        type: kind,
        from: "operator",
        origin: "chat",
        content,
      },
    })
  }

  setState(sessionId: string, state: "resolved" | "unresolved"): Promise<unknown> {
    return this.request("PATCH", this.site(`/conversation/${encodeURIComponent(sessionId)}/state`), {
      body: { state },
    })
  }

  assign(sessionId: string, userId: string | null): Promise<unknown> {
    return this.request("PATCH", this.site(`/conversation/${encodeURIComponent(sessionId)}/routing`), {
      body: {
        assigned: userId === null ? null : { user_id: userId },
      },
    })
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

  getPerson(idOrEmail: string): Promise<unknown> {
    return this.request("GET", this.site(`/people/profile/${encodeURIComponent(idOrEmail)}`))
  }

  listOperators(): Promise<unknown> {
    return this.request("GET", this.site("/operators/list"))
  }

  private site(suffix: string): string {
    return `/website/${encodeURIComponent(this.creds.websiteId)}${suffix}`
  }

  private async request(method: string, path: string, opts?: { query?: Query; body?: unknown }): Promise<unknown> {
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

    let response: Awaited<ReturnType<typeof undiciFetch>>
    try {
      response = await undiciFetch(url, {
        method,
        headers,
        body,
        redirect: "error",
        dispatcher: this.dispatcher,
        signal: AbortSignal.timeout(20_000),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "request failed"
      throw new CrispApiError(0, "network_error", message)
    }

    const text = await response.text()
    const retryAfter = response.headers.get("retry-after") ?? undefined
    let payload: Envelope | null = null
    if (text.length > 0) {
      try {
        payload = JSON.parse(text) as Envelope
      } catch {
        if (response.status >= 400) {
          throw new CrispApiError(response.status, statusReason(response.status), `HTTP ${response.status}`, retryAfter)
        }
        throw new CrispApiError(response.status, "invalid_json", "response was not JSON", retryAfter)
      }
    }

    if (response.status >= 400 || payload?.error === true) {
      const reason = typeof payload?.reason === "string" && payload.reason
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
