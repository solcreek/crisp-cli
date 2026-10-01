import { UsageError } from "./errors.js"

export type Flags = {
  json: boolean
  help: boolean
  version: boolean
  listEvents: boolean
  readOnly: boolean
  unassign: boolean
  profile?: string
  website?: string
  websiteId?: string
  identifier?: string
  key?: string
  tier?: string
  page?: string
  text?: string
  note?: string
  user?: string
  set?: string
  searchType?: string
  events?: string
  session?: string
  timeout?: string
  count?: string
}

export function websiteOverride(flags: Flags): string | undefined {
  const value = (flags.website ?? flags.websiteId)?.trim()
  return value ? value : undefined
}

export const GLOBAL_FLAGS = new Set([
  "json",
  "help",
  "version",
  "profile",
  "website",
  "website-id",
  "read-only",
])

export function assertAllowedFlags(seen: Set<string>, allowed: readonly string[]): void {
  const ok = new Set<string>([...GLOBAL_FLAGS, ...allowed])
  for (const name of seen) {
    if (!ok.has(name)) {
      throw new UsageError(`unexpected flag: --${name}`)
    }
  }
}

export function pageNumber(raw: string | undefined): number {
  if (raw === undefined) {
    return 1
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new UsageError("--page must be a positive integer")
  }
  return Number(raw)
}

export function requireArg(value: string | undefined, usage: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new UsageError(`usage: ${usage}`)
  }
  return trimmed
}
