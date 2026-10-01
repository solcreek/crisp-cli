import { pageNumber, requireArg, websiteOverride, type Flags } from "./args.js"
import { CrispClient } from "./client.js"
import {
  assertComplete,
  loadConfig,
  parseTier,
  publicProfileView,
  resolveCredentials,
  saveConfig,
  selectedProfileName,
  type ConfigFile,
  type Tier,
  type ResolvedCredentials,
} from "./config.js"
import { UsageError } from "./errors.js"
import { usage } from "./help.js"
import { writeOut } from "./output.js"
import { listen, parseEvents, positiveInteger } from "./rtm.js"
import { RTM_EVENTS, RTM_REFERENCE_CHECKED, RTM_REFERENCE_URL } from "./rtm-events.js"
import { redactSecrets } from "./redact.js"
import { RunLifecycle } from "./lifecycle.js"

import type { IO } from "./context.js"

export function authSet(io: IO): number {
  assertWritable(io)
  writeOut(io.stdout, io.flags.json, saveProfile(io.env, io.flags))
  return 0
}

export function authShow(io: IO): number {
  const creds = credentialsFrom(io)
  writeOut(io.stdout, io.flags.json, publicProfileView(creds))
  return 0
}

export async function conversationsList(io: IO): Promise<number> {
  writeOut(
    io.stdout,
    io.flags.json,
    await clientFrom(io).listConversations(pageNumber(io.flags.page)),
  )
  return 0
}

export async function conversationsGet(io: IO, sessionRaw?: string): Promise<number> {
  const session = requireArg(sessionRaw, usage.conversationsGet)
  writeOut(io.stdout, io.flags.json, await clientFrom(io).getConversation(session))
  return 0
}

export async function conversationsSearch(io: IO, queryRaw?: string): Promise<number> {
  const query = requireArg(queryRaw, usage.conversationsSearch)
  const searchType = io.flags.searchType ?? "text"
  if (searchType !== "text" && searchType !== "segment")
    throw new UsageError("--search-type must be text or segment")
  writeOut(
    io.stdout,
    io.flags.json,
    await clientFrom(io).searchConversations(query, pageNumber(io.flags.page), searchType),
  )
  return 0
}

export async function messagesList(io: IO, sessionRaw?: string): Promise<number> {
  const session = requireArg(sessionRaw, usage.messagesList)
  writeOut(io.stdout, io.flags.json, await clientFrom(io).listMessages(session))
  return 0
}

export async function replyCommand(io: IO, sessionRaw?: string): Promise<number> {
  assertWritable(io)
  const session = requireArg(sessionRaw, usage.reply)
  const hasText = io.flags.text !== undefined
  const hasNote = io.flags.note !== undefined
  if (hasText === hasNote) throw new UsageError(`usage: ${usage.reply}`)
  const content = hasText ? io.flags.text! : io.flags.note!
  if (!content.trim()) throw new UsageError(`usage: ${usage.reply}`)
  writeOut(
    io.stdout,
    io.flags.json,
    await clientFrom(io).sendOperatorMessage(session, hasText ? "text" : "note", content),
  )
  return 0
}

export function resolveCommand(io: IO, sessionRaw?: string): Promise<number> {
  return stateCommand(io, "resolved", sessionRaw)
}

export function reopenCommand(io: IO, sessionRaw?: string): Promise<number> {
  return stateCommand(io, "unresolved", sessionRaw)
}

async function stateCommand(
  io: IO,
  state: "resolved" | "unresolved",
  sessionRaw?: string,
): Promise<number> {
  assertWritable(io)
  const session = requireArg(sessionRaw, state === "resolved" ? usage.resolve : usage.reopen)
  writeOut(io.stdout, io.flags.json, await clientFrom(io).setState(session, state))
  return 0
}

export async function assignCommand(io: IO, sessionRaw?: string): Promise<number> {
  assertWritable(io)
  const session = requireArg(sessionRaw, usage.assign)
  const hasUser = io.flags.user !== undefined
  if (hasUser === io.flags.unassign) throw new UsageError(`usage: ${usage.assign}`)
  const userId = hasUser ? requireArg(io.flags.user, usage.assign) : null
  writeOut(io.stdout, io.flags.json, await clientFrom(io).assign(session, userId))
  return 0
}

export async function segmentsCommand(io: IO, sessionRaw?: string): Promise<number> {
  assertWritable(io)
  const session = requireArg(sessionRaw, usage.segments)
  if (io.flags.set === undefined) throw new UsageError(`usage: ${usage.segments}`)
  const segments = io.flags.set
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  writeOut(io.stdout, io.flags.json, await clientFrom(io).setSegments(session, segments))
  return 0
}

export async function readCommand(io: IO, sessionRaw?: string): Promise<number> {
  assertWritable(io)
  const session = requireArg(sessionRaw, usage.read)
  writeOut(io.stdout, io.flags.json, await clientFrom(io).markRead(session))
  return 0
}

export async function peopleGet(io: IO, idRaw?: string): Promise<number> {
  const idOrEmail = requireArg(idRaw, usage.peopleGet)
  writeOut(io.stdout, io.flags.json, await clientFrom(io).getPerson(idOrEmail))
  return 0
}

export async function operatorsList(io: IO): Promise<number> {
  writeOut(io.stdout, io.flags.json, await clientFrom(io).listOperators())
  return 0
}

function saveProfile(
  env: NodeJS.ProcessEnv,
  flags: Flags,
): {
  saved: true
  profile: string
  identifier: string
  tier: Tier
  website_id: string
} {
  const file = loadConfig(env)
  const name = selectedProfileName(env, flags.profile, file)
  const existing = file.profiles[name]
  const identifier =
    flags.identifier?.trim() ||
    firstSet(env, ["CRISPCTL_IDENTIFIER", "CRISP_IDENTIFIER"]) ||
    existing?.identifier
  const key = flags.key?.trim() || firstSet(env, ["CRISPCTL_KEY", "CRISP_KEY"]) || existing?.key
  const tierRaw =
    flags.tier?.trim() || firstSet(env, ["CRISPCTL_TIER", "CRISP_TIER"]) || existing?.tier
  const website =
    websiteOverride(flags) ||
    firstSet(env, ["CRISPCTL_WEBSITE_ID", "CRISP_WEBSITE_ID"]) ||
    existing?.website_id
  if (!identifier || !key || !tierRaw || !website) {
    throw new UsageError(`usage: ${usage.authSet}`)
  }
  const tier = parseTier(tierRaw)
  const next: ConfigFile = {
    current: name,
    profiles: {
      ...file.profiles,
      [name]: { identifier, key, tier, website_id: website },
    },
  }
  saveConfig(env, next)
  return { saved: true, profile: name, identifier, tier, website_id: website }
}

export async function listenCommand(io: IO): Promise<number> {
  if (io.flags.listEvents) {
    for (const name of ["events", "session", "count", "timeout"] as const) {
      if (io.flags[name] !== undefined) throw new UsageError(`unexpected flag: --${name}`)
    }
    writeOut(io.stdout, io.flags.json, {
      source: RTM_REFERENCE_URL,
      checked_at: RTM_REFERENCE_CHECKED,
      events: RTM_EVENTS,
    })
    return 0
  }
  const events = parseEvents(io.flags.events)
  const count = positiveInteger(io.flags.count, "count")
  const timeout = positiveInteger(io.flags.timeout, "timeout")
  if (timeout !== undefined && timeout > 2_147_483) throw new UsageError("--timeout is too large")
  const session =
    io.flags.session === undefined ? undefined : requireArg(io.flags.session, usage.listen)
  const creds = credentialsFrom(io)
  assertComplete(creds)
  const lifecycle = io.lifecycle ?? new RunLifecycle(io.signal)
  lifecycle.handleSignals()
  lifecycle.setDeadline(timeout)
  try {
    await listen(new CrispClient(creds, io.dispatcher, true), creds, {
      events,
      session,
      count,
      signal: lifecycle.signal,
      socketFactory: io.socketFactory,
      onEvent: (event) =>
        writeOut((chunk) => io.stdout(redactSecrets(chunk, [creds.key])), io.flags.json, event),
      onStatus: (status) =>
        writeOut(io.stderr, io.flags.json, io.flags.json ? status : `RTM ${status.status}`),
    })
    if (lifecycle.timedOut) throw lifecycle.timeoutError()
    return 0
  } finally {
    if (!io.lifecycle) lifecycle.dispose()
  }
}

function isReadOnly(io: IO): boolean {
  return io.flags.readOnly || io.env.CRISPCTL_READ_ONLY === "1"
}

function clientFrom(io: IO): CrispClient {
  const creds = credentialsFrom(io)
  assertComplete(creds)
  return new CrispClient(
    {
      identifier: creds.identifier,
      key: creds.key,
      tier: creds.tier,
      websiteId: creds.websiteId,
    },
    io.dispatcher,
    isReadOnly(io),
    io.signal,
  )
}

function firstSet(env: NodeJS.ProcessEnv, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim()
    if (value) return value
  }
  return undefined
}

function assertWritable(io: IO): void {
  if (isReadOnly(io)) throw new UsageError("read-only mode: write operations are disabled")
  io.signal?.throwIfAborted()
}

function credentialsFrom(io: IO): ResolvedCredentials {
  return (
    io.credentials?.resolve(io.flags) ??
    resolveCredentials(io.env, {
      profile: io.flags.profile,
      website: websiteOverride(io.flags),
    })
  )
}
