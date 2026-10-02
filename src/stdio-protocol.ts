import type { CommandPath } from "./help.js"

export const PROTOCOL_VERSION = 1
export const WORKER_LIMITS = {
  concurrency: 4,
  queue: 32,
  requestBytes: 64 * 1024,
  responseBytes: 1024 * 1024,
  defaultTimeoutMs: 20_000,
  maxTimeoutMs: 120_000,
} as const

// New CLI commands require an explicit review before entering this protocol.
export const WORKER_COMMANDS = [
  "auth show",
  "conversations list",
  "conversations get",
  "conversations pages",
  "conversations search",
  "messages list",
  "reply",
  "resolve",
  "reopen",
  "assign",
  "segments",
  "read",
  "people get",
  "operators list",
] as const satisfies readonly CommandPath[]

type Request = { type: "request"; id: string; argv: string[]; timeout_ms?: number }
type Cancel = { type: "cancel"; id: string }
type Shutdown = { type: "shutdown" }
export type WorkerMessage = Request | Cancel | Shutdown

// Invalid frames are fatal. Never include caller input in protocol diagnostics.
export function parseMessage(line: Buffer): WorkerMessage {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line))
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid frame")
  const record = value as Record<string, unknown>
  if (record.protocol !== PROTOCOL_VERSION) throw new Error("unsupported protocol")
  const fields = ["protocol", "type"]
  if (record.type === "request" || record.type === "cancel") {
    fields.push("id")
    if (typeof record.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(record.id))
      throw new Error("invalid id")
  }
  if (record.type === "request") {
    fields.push("argv", "timeout_ms")
    if (
      !Array.isArray(record.argv) ||
      record.argv.length > 128 ||
      !record.argv.every((arg) => typeof arg === "string" && !arg.includes("\0"))
    )
      throw new Error("invalid argv")
    if (
      record.timeout_ms !== undefined &&
      (!Number.isSafeInteger(record.timeout_ms) ||
        (record.timeout_ms as number) < 1 ||
        (record.timeout_ms as number) > WORKER_LIMITS.maxTimeoutMs)
    )
      throw new Error("invalid deadline")
  } else if (record.type !== "cancel" && record.type !== "shutdown") {
    throw new Error("invalid message type")
  }
  if (Object.keys(record).some((key) => !fields.includes(key))) throw new Error("unknown field")
  return record as WorkerMessage
}
