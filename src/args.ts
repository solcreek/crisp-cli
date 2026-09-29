import { UsageError } from "./errors.js"

export type Flags = {
  json: boolean
  help: boolean
  version: boolean
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
}

export type ParsedArgv = {
  flags: Flags
  seen: Set<string>
  positionals: string[]
}

const BOOLEAN_FLAGS = new Set(["json", "help", "version", "unassign"])

const STRING_FLAGS = new Set([
  "profile",
  "website",
  "website-id",
  "identifier",
  "key",
  "tier",
  "page",
  "text",
  "note",
  "user",
  "set",
  "search-type",
])

export function parseArgv(argv: string[]): ParsedArgv {
  const flags: Flags = {
    json: false,
    help: false,
    version: false,
    unassign: false,
  }
  const seen = new Set<string>()
  const positionals: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ""
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg === "-h") {
      flags.help = true
      seen.add("help")
      continue
    }
    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg)
      continue
    }
    if (!arg.startsWith("--")) {
      throw new UsageError(`unknown flag: ${arg}`)
    }

    const eq = arg.indexOf("=")
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    const inline = eq === -1 ? undefined : arg.slice(eq + 1)
    if (!name) {
      throw new UsageError(`unknown flag: ${arg}`)
    }

    if (BOOLEAN_FLAGS.has(name)) {
      if (inline !== undefined) {
        throw new UsageError(`--${name} does not take a value`)
      }
      seen.add(name)
      if (name === "json") flags.json = true
      if (name === "help") flags.help = true
      if (name === "version") flags.version = true
      if (name === "unassign") flags.unassign = true
      continue
    }

    if (!STRING_FLAGS.has(name)) {
      throw new UsageError(`unknown flag: --${name}`)
    }

    let value = inline
    if (value === undefined) {
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError(`--${name} requires a value`)
      }
      value = next
      i++
    }
    seen.add(name)
    assignString(flags, name, value)
  }

  if (flags.website !== undefined && flags.websiteId !== undefined && flags.website !== flags.websiteId) {
    throw new UsageError("--website and --website-id disagree")
  }

  return { flags, seen, positionals }
}

function assignString(flags: Flags, name: string, value: string): void {
  switch (name) {
    case "profile":
      flags.profile = value
      return
    case "website":
      flags.website = value
      return
    case "website-id":
      flags.websiteId = value
      return
    case "identifier":
      flags.identifier = value
      return
    case "key":
      flags.key = value
      return
    case "tier":
      flags.tier = value
      return
    case "page":
      flags.page = value
      return
    case "text":
      flags.text = value
      return
    case "note":
      flags.note = value
      return
    case "user":
      flags.user = value
      return
    case "set":
      flags.set = value
      return
    case "search-type":
      flags.searchType = value
      return
    default:
      throw new UsageError(`unknown flag: --${name}`)
  }
}

export function websiteOverride(flags: Flags): string | undefined {
  const value = (flags.website ?? flags.websiteId)?.trim()
  return value ? value : undefined
}

const GLOBAL_FLAGS = new Set(["json", "help", "version", "profile", "website", "website-id"])

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
