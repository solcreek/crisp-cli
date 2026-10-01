import { CrispApiError, ConfigError, UsageError } from "./errors.js"
import { redactSecrets } from "./redact.js"

export type ErrorPayload = {
  ok: false
  error: string
  message: string
  status?: number
  reason?: string
  retry_after?: string
}

export function writeOut(stdout: (chunk: string) => void, json: boolean, value: unknown): void {
  if (!json && typeof value === "string") {
    stdout(value.endsWith("\n") ? value : `${value}\n`)
    return
  }
  stdout(`${json ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`)
}

export function errorPayload(err: unknown, secrets: readonly (string | undefined)[]): ErrorPayload {
  if (err instanceof CrispApiError) {
    const reason = redactSecrets(err.reason, secrets)
    const payload: ErrorPayload = {
      ok: false,
      error: reason,
      status: err.status,
      reason,
      message: redactSecrets(err.message, secrets),
    }
    if (err.retryAfter) {
      payload.retry_after = redactSecrets(err.retryAfter, secrets)
    }
    return payload
  }
  if (err instanceof UsageError) {
    return { ok: false, error: "usage", message: redactSecrets(err.message, secrets) }
  }
  if (err instanceof ConfigError) {
    return { ok: false, error: "config", message: redactSecrets(err.message, secrets) }
  }
  const message = err instanceof Error ? err.message : "unknown error"
  return { ok: false, error: "error", message: redactSecrets(message, secrets) }
}

export function writeErr(
  stderr: (chunk: string) => void,
  json: boolean,
  err: unknown,
  secrets: readonly (string | undefined)[],
): void {
  const payload = errorPayload(err, secrets)
  if (json) {
    stderr(`${JSON.stringify(payload)}\n`)
    return
  }
  if ((payload.error === "usage" || payload.error === "config") && payload.status === undefined) {
    stderr(`error: ${payload.message}\n`)
    return
  }
  const head = [payload.status, payload.reason || payload.error]
    .filter((part) => part !== undefined && part !== "")
    .join(" ")
  if (payload.message && payload.message !== payload.reason && payload.message !== payload.error) {
    stderr(`error: ${head}: ${payload.message}\n`)
    return
  }
  stderr(`error: ${head}\n`)
}
