import type { OptionName } from "./command-options.js"
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

export const GLOBAL_FLAGS = new Set<string>([
  "json",
  "help",
  "version",
  "profile",
  "website",
  "website-id",
  "read-only",
] satisfies readonly OptionName[])

export function assertAllowedFlags(seen: Set<string>, allowed: readonly OptionName[]): void {
  const ok = new Set<string>([...GLOBAL_FLAGS, ...allowed])
  for (const name of seen) {
    if (!ok.has(name)) {
      throw new UsageError(`unexpected flag: --${name}`)
    }
  }
}

export function positiveInteger(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(value)) {
    throw new UsageError(`--${flag} must be a positive integer`)
  }
  return value
}

export function pageNumber(raw: string | undefined): number {
  return positiveInteger(raw, "page") ?? 1
}

export function requireArg(value: string | undefined, usage: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new UsageError(`usage: ${usage}`)
  }
  return trimmed
}
