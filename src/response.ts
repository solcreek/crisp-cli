import { Readable } from "node:stream"
import type { Response } from "undici"
import { CrispApiError } from "./errors.js"

export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024

// Count decoded bytes, including chunked and compressed responses. Content-Length
// describes the wire representation and cannot enforce this memory boundary.
export async function readResponseText(
  response: Response,
  signal: AbortSignal,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<string> {
  if (!response.body) return ""
  // Attach cancellation directly: fetch's internal Request/AbortController can
  // be collected after headers arrive while its body remains pending.
  const stream = Readable.fromWeb(response.body, { signal })
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of stream) {
    bytes += chunk.length
    if (bytes > maxBytes) {
      throw responseError(
        response.status,
        "response_too_large",
        "response body exceeded size limit",
        response.headers.get("retry-after") ?? undefined,
      )
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, bytes).toString("utf8")
}

type Envelope = { error?: boolean; reason?: string; data?: unknown }

export function decodeResponse(text: string, status: number, retryAfter?: string): unknown {
  let payload: Envelope | undefined
  if (text.length > 0) {
    let decoded: unknown
    try {
      decoded = JSON.parse(text)
    } catch {
      throw responseError(status, "invalid_json", "response was not JSON", retryAfter)
    }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw responseError(status, "invalid_json", "response was not a JSON object", retryAfter)
    }
    if (
      ("error" in decoded && typeof decoded.error !== "boolean") ||
      ("reason" in decoded && typeof decoded.reason !== "string")
    ) {
      throw responseError(
        status,
        "invalid_json",
        "response envelope fields were invalid",
        retryAfter,
      )
    }
    payload = decoded
  }
  if (status >= 400 || payload?.error === true) {
    const reason = payload?.reason || statusReason(status)
    const data = payload?.data
    const message =
      data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : ""
    throw new CrispApiError(status, reason, message || reason, retryAfter)
  }
  return payload?.data ?? null
}

function responseError(
  status: number,
  reason: string,
  message: string,
  retryAfter?: string,
): CrispApiError {
  return new CrispApiError(
    status,
    status >= 400 ? statusReason(status) : reason,
    status >= 400 ? `HTTP ${status}` : message,
    retryAfter,
  )
}

export function statusReason(status: number): string {
  if (status === 429) return "rate_limited"
  if (status === 401 || status === 403) return "unauthorized"
  if (status === 404) return "not_found"
  return "http_error"
}
