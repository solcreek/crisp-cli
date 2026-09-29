import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { ConfigError } from "./errors.js"

export type Tier = "website" | "plugin"

export type Profile = {
  identifier: string
  key: string
  tier: Tier
  website_id: string
}

export type ConfigFile = {
  current?: string
  profiles: Record<string, Profile>
}

export type CredentialSources = {
  identifier: "env" | "file" | "missing"
  key: "env" | "file" | "missing"
  tier: "env" | "file" | "missing"
  websiteId: "flag" | "env" | "file" | "missing"
}

export type ResolvedCredentials = {
  profile: string
  identifier: string
  key: string
  tier: Tier
  websiteId: string
  sources: CredentialSources
}

const TIERS = new Set<Tier>(["website", "plugin"])

export function configFilePath(env: NodeJS.ProcessEnv): string {
  const explicit = env.CRISPCTL_CONFIG?.trim()
  if (explicit) {
    return explicit
  }
  const xdg = env.XDG_CONFIG_HOME?.trim()
  const base = xdg || join(env.HOME?.trim() || homedir(), ".config")
  return join(base, "crispctl", "config.json")
}

export function emptyConfig(): ConfigFile {
  return { profiles: {} }
}

export function loadConfig(env: NodeJS.ProcessEnv): ConfigFile {
  const path = configFilePath(env)
  if (!existsSync(path)) {
    return emptyConfig()
  }
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    throw new ConfigError("could not read config file")
  }
  if (!raw.trim()) {
    return emptyConfig()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ConfigError("config file is not valid JSON")
  }
  return normalizeConfig(parsed)
}

export function saveConfig(env: NodeJS.ProcessEnv, config: ConfigFile): void {
  const path = configFilePath(env)
  const dir = dirname(path)
  const tmp = `${path}.${process.pid}.tmp`
  const data = `${JSON.stringify(config, null, 2)}\n`
  try {
    ensureCreatedDirectories(dir)
    writeFileSync(tmp, data, { mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, path)
    chmodSync(path, 0o600)
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // The original write error is the one to report.
    }
    if (err instanceof ConfigError) {
      throw err
    }
    throw new ConfigError("could not write config file")
  }
}

function ensureCreatedDirectories(dir: string): void {
  const missing: string[] = []
  let cursor = dir
  while (!existsSync(cursor)) {
    missing.push(cursor)
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  for (const path of missing.reverse()) {
    try {
      mkdirSync(path, { mode: 0o700 })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === "EEXIST") continue
      throw err
    }
    chmodSync(path, 0o700)
  }
}

export function assertProfileName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw new ConfigError(`invalid profile name: ${name}`)
  }
}

export function selectedProfileName(
  env: NodeJS.ProcessEnv,
  profileFlag: string | undefined,
  file: ConfigFile,
): string {
  const fromFlag = profileFlag?.trim()
  const fromEnv = firstEnv(env, ["CRISPCTL_PROFILE"])
  const name = fromFlag || fromEnv || file.current || "default"
  assertProfileName(name)
  return name
}

export function resolveCredentials(
  env: NodeJS.ProcessEnv,
  opts: { profile?: string; website?: string },
  file?: ConfigFile,
): ResolvedCredentials {
  const loaded = file ?? loadConfig(env)
  const profile = selectedProfileName(env, opts.profile, loaded)
  const stored = loaded.profiles[profile]

  const identifierEnv = firstEnv(env, ["CRISPCTL_IDENTIFIER", "CRISP_IDENTIFIER"])
  const keyEnv = firstEnv(env, ["CRISPCTL_KEY", "CRISP_KEY"])
  const tierEnv = firstEnv(env, ["CRISPCTL_TIER", "CRISP_TIER"])
  const websiteEnv = firstEnv(env, ["CRISPCTL_WEBSITE_ID", "CRISP_WEBSITE_ID"])
  const websiteFlag = opts.website?.trim() || undefined

  let tier: Tier | undefined
  let tierSource: CredentialSources["tier"] = "missing"
  if (tierEnv) {
    tier = parseTier(tierEnv)
    tierSource = "env"
  } else if (stored) {
    tier = stored.tier
    tierSource = "file"
  }

  return {
    profile,
    identifier: identifierEnv ?? stored?.identifier ?? "",
    key: keyEnv ?? stored?.key ?? "",
    tier: tier ?? "plugin",
    websiteId: websiteFlag ?? websiteEnv ?? stored?.website_id ?? "",
    sources: {
      identifier: identifierEnv ? "env" : stored?.identifier ? "file" : "missing",
      key: keyEnv ? "env" : stored?.key ? "file" : "missing",
      tier: tierSource,
      websiteId: websiteFlag ? "flag" : websiteEnv ? "env" : stored?.website_id ? "file" : "missing",
    },
  }
}

export function assertComplete(creds: ResolvedCredentials): void {
  const missing: string[] = []
  if (!creds.identifier) missing.push("identifier")
  if (!creds.key) missing.push("key")
  if (creds.sources.tier === "missing") missing.push("tier")
  if (!creds.websiteId) missing.push("website_id")
  if (missing.length > 0) {
    throw new ConfigError(`missing credentials: ${missing.join(", ")}`)
  }
}

export function publicProfileView(creds: ResolvedCredentials): {
  profile: string
  identifier: string | null
  tier: Tier | null
  website_id: string | null
  key: "set" | "missing"
  sources: CredentialSources
} {
  return {
    profile: creds.profile,
    identifier: creds.identifier || null,
    tier: creds.sources.tier === "missing" ? null : creds.tier,
    website_id: creds.websiteId || null,
    key: creds.key ? "set" : "missing",
    sources: creds.sources,
  }
}

export function parseTier(value: string): Tier {
  if (TIERS.has(value as Tier)) {
    return value as Tier
  }
  throw new ConfigError("tier must be website or plugin")
}

function firstEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) {
      return value
    }
  }
  return undefined
}

function normalizeConfig(parsed: unknown): ConfigFile {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError("config file must be a JSON object")
  }
  const obj = parsed as Record<string, unknown>
  const profiles: Record<string, Profile> = {}
  if (obj.profiles !== undefined) {
    if (!obj.profiles || typeof obj.profiles !== "object" || Array.isArray(obj.profiles)) {
      throw new ConfigError("config profiles must be an object")
    }
    for (const [name, value] of Object.entries(obj.profiles)) {
      assertProfileName(name)
      profiles[name] = normalizeProfile(name, value)
    }
  }
  let current: string | undefined
  if (obj.current !== undefined) {
    if (typeof obj.current !== "string" || !obj.current.trim()) {
      throw new ConfigError("config current profile must be a name")
    }
    current = obj.current.trim()
    assertProfileName(current)
  }
  return { current, profiles }
}

function normalizeProfile(name: string, value: unknown): Profile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`profile ${name} must be an object`)
  }
  const profile = value as Record<string, unknown>
  if (profile.tier !== "website" && profile.tier !== "plugin") {
    throw new ConfigError(`profile ${name} tier must be website or plugin`)
  }
  for (const field of ["identifier", "key", "website_id"] as const) {
    if (typeof profile[field] !== "string" || profile[field].length === 0) {
      throw new ConfigError(`profile ${name} is missing ${field}`)
    }
  }
  return {
    identifier: profile.identifier as string,
    key: profile.key as string,
    tier: profile.tier,
    website_id: profile.website_id as string,
  }
}
