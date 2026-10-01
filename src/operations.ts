import { assertAllowedFlags, pageNumber, requireArg, websiteOverride, type Flags } from "./args.js"
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
} from "./config.js"
import { UsageError } from "./errors.js"
import { usage } from "./help.js"
import { writeOut } from "./output.js"
import { listen, parseEvents, positiveInteger } from "./rtm.js"
import { RTM_EVENTS, RTM_REFERENCE_CHECKED, RTM_REFERENCE_URL } from "./rtm-events.js"
import { redactSecrets } from "./redact.js"
import { RunLifecycle } from "./lifecycle.js"

import type { IO } from "./context.js"

export { authCommand, conversationsCommand, messagesCommand, replyCommand, stateCommand, assignCommand, segmentsCommand, readCommand, peopleCommand, operatorsCommand, listenCommand }

function authCommand(sub: string | undefined, rest: string[], seen: Set<string>, io: IO): number {
  if (sub === "set") {
    assertWritable(io)
    assertAllowedFlags(seen, ["identifier", "key", "tier", "website-id"])
    if (rest.length > 0) throw new UsageError(`usage: ${usage.authSet}`)
    writeOut(io.stdout, io.flags.json, saveProfile(io.env, io.flags))
    return 0
  }
  if (sub === "show") {
    assertAllowedFlags(seen, [])
    if (rest.length > 0) throw new UsageError(`usage: ${usage.authShow}`)
    const creds = resolveCredentials(io.env, { profile: io.flags.profile, website: websiteOverride(io.flags) })
    writeOut(io.stdout, io.flags.json, publicProfileView(creds))
    return 0
  }
  throw new UsageError("usage: crispctl auth <set|show>")
}

function saveProfile(env: NodeJS.ProcessEnv, flags: Flags): {
  saved: true
  profile: string
  identifier: string
  tier: Tier
  website_id: string
} {
  const file = loadConfig(env)
  const name = selectedProfileName(env, flags.profile, file)
  const existing = file.profiles[name]
  const identifier = flags.identifier?.trim()
    || firstSet(env, ["CRISPCTL_IDENTIFIER", "CRISP_IDENTIFIER"])
    || existing?.identifier
  const key = flags.key?.trim()
    || firstSet(env, ["CRISPCTL_KEY", "CRISP_KEY"])
    || existing?.key
  const tierRaw = flags.tier?.trim()
    || firstSet(env, ["CRISPCTL_TIER", "CRISP_TIER"])
    || existing?.tier
  const website = websiteOverride(flags)
    || firstSet(env, ["CRISPCTL_WEBSITE_ID", "CRISP_WEBSITE_ID"])
    || existing?.website_id
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

async function conversationsCommand(sub: string | undefined, rest: string[], seen: Set<string>, io: IO): Promise<number> {
  if (sub === "list") {
    assertAllowedFlags(seen, ["page"])
    if (rest.length > 0) throw new UsageError(`usage: ${usage.conversationsList}`)
    writeOut(io.stdout, io.flags.json, await clientFrom(io).listConversations(pageNumber(io.flags.page)))
    return 0
  }
  if (sub === "get") {
    assertAllowedFlags(seen, [])
    const session = requireArg(rest[0], usage.conversationsGet)
    if (rest.length > 1) throw new UsageError(`usage: ${usage.conversationsGet}`)
    writeOut(io.stdout, io.flags.json, await clientFrom(io).getConversation(session))
    return 0
  }
  if (sub === "search") {
    assertAllowedFlags(seen, ["page", "search-type"])
    const query = requireArg(rest[0], usage.conversationsSearch)
    if (rest.length > 1) throw new UsageError(`usage: ${usage.conversationsSearch}`)
    const searchType = io.flags.searchType ?? "text"
    if (searchType !== "text" && searchType !== "segment") {
      throw new UsageError("--search-type must be text or segment")
    }
    writeOut(
      io.stdout,
      io.flags.json,
      await clientFrom(io).searchConversations(query, pageNumber(io.flags.page), searchType),
    )
    return 0
  }
  throw new UsageError("usage: crispctl conversations <list|get|search>")
}

async function messagesCommand(sub: string | undefined, rest: string[], seen: Set<string>, io: IO): Promise<number> {
  if (sub !== "list") throw new UsageError(`usage: ${usage.messagesList}`)
  assertAllowedFlags(seen, [])
  const session = requireArg(rest[0], usage.messagesList)
  if (rest.length > 1) throw new UsageError(`usage: ${usage.messagesList}`)
  writeOut(io.stdout, io.flags.json, await clientFrom(io).listMessages(session))
  return 0
}

async function replyCommand(
  sessionRaw: string | undefined,
  rest: string[],
  seen: Set<string>,
  io: IO,
): Promise<number> {
  assertWritable(io)
  assertAllowedFlags(seen, ["text", "note"])
  if (rest.length > 0) throw new UsageError(`usage: ${usage.reply}`)
  const session = requireArg(sessionRaw, usage.reply)
  const hasText = seen.has("text")
  const hasNote = seen.has("note")
  if (hasText === hasNote) throw new UsageError(`usage: ${usage.reply}`)
  const content = hasText ? io.flags.text ?? "" : io.flags.note ?? ""
  if (!content.trim()) throw new UsageError(`usage: ${usage.reply}`)
  const kind = hasText ? "text" : "note"
  writeOut(io.stdout, io.flags.json, await clientFrom(io).sendOperatorMessage(session, kind, content))
  return 0
}

async function stateCommand(
  state: "resolved" | "unresolved",
  sessionRaw: string | undefined,
  rest: string[],
  seen: Set<string>,
  io: IO,
): Promise<number> {
  assertWritable(io)
  const line = state === "resolved" ? usage.resolve : usage.reopen
  assertAllowedFlags(seen, [])
  if (rest.length > 0) throw new UsageError(`usage: ${line}`)
  const session = requireArg(sessionRaw, line)
  writeOut(io.stdout, io.flags.json, await clientFrom(io).setState(session, state))
  return 0
}

async function assignCommand(
  sessionRaw: string | undefined,
  rest: string[],
  seen: Set<string>,
  io: IO,
): Promise<number> {
  assertWritable(io)
  assertAllowedFlags(seen, ["user", "unassign"])
  if (rest.length > 0) throw new UsageError(`usage: ${usage.assign}`)
  const session = requireArg(sessionRaw, usage.assign)
  const hasUser = seen.has("user")
  if (hasUser === io.flags.unassign) throw new UsageError(`usage: ${usage.assign}`)
  const userId = hasUser ? requireArg(io.flags.user, usage.assign) : null
  writeOut(io.stdout, io.flags.json, await clientFrom(io).assign(session, userId))
  return 0
}

async function segmentsCommand(
  sessionRaw: string | undefined,
  rest: string[],
  seen: Set<string>,
  io: IO,
): Promise<number> {
  assertWritable(io)
  assertAllowedFlags(seen, ["set"])
  if (rest.length > 0) throw new UsageError(`usage: ${usage.segments}`)
  const session = requireArg(sessionRaw, usage.segments)
  if (!seen.has("set")) throw new UsageError(`usage: ${usage.segments}`)
  const segments = (io.flags.set ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  writeOut(io.stdout, io.flags.json, await clientFrom(io).setSegments(session, segments))
  return 0
}

async function readCommand(
  sessionRaw: string | undefined,
  rest: string[],
  seen: Set<string>,
  io: IO,
): Promise<number> {
  assertWritable(io)
  assertAllowedFlags(seen, [])
  if (rest.length > 0) throw new UsageError(`usage: ${usage.read}`)
  const session = requireArg(sessionRaw, usage.read)
  writeOut(io.stdout, io.flags.json, await clientFrom(io).markRead(session))
  return 0
}

async function peopleCommand(sub: string | undefined, rest: string[], seen: Set<string>, io: IO): Promise<number> {
  if (sub !== "get") throw new UsageError(`usage: ${usage.peopleGet}`)
  assertAllowedFlags(seen, [])
  const idOrEmail = requireArg(rest[0], usage.peopleGet)
  if (rest.length > 1) throw new UsageError(`usage: ${usage.peopleGet}`)
  writeOut(io.stdout, io.flags.json, await clientFrom(io).getPerson(idOrEmail))
  return 0
}

async function operatorsCommand(sub: string | undefined, rest: string[], seen: Set<string>, io: IO): Promise<number> {
  if (sub !== "list") throw new UsageError(`usage: ${usage.operatorsList}`)
  assertAllowedFlags(seen, [])
  if (rest.length > 0) throw new UsageError(`usage: ${usage.operatorsList}`)
  writeOut(io.stdout, io.flags.json, await clientFrom(io).listOperators())
  return 0
}

async function listenCommand(extra: string | undefined, seen: Set<string>, io: IO): Promise<number> {
  assertAllowedFlags(seen, ["events", "session", "timeout", "count", "list-events"])
  if (extra !== undefined) throw new UsageError(`usage: ${usage.listen}`)
  if (io.flags.listEvents) {
    assertAllowedFlags(seen, ["list-events"])
    writeOut(io.stdout, io.flags.json, { source: RTM_REFERENCE_URL, checked_at: RTM_REFERENCE_CHECKED, events: RTM_EVENTS })
    return 0
  }
  const events = parseEvents(io.flags.events)
  const count = positiveInteger(io.flags.count, "count")
  const timeout = positiveInteger(io.flags.timeout, "timeout")
  if (timeout !== undefined && timeout > 2_147_483) throw new UsageError("--timeout is too large")
  const session = io.flags.session === undefined ? undefined : requireArg(io.flags.session, usage.listen)
  const creds = resolveCredentials(io.env, { profile: io.flags.profile, website: websiteOverride(io.flags) })
  assertComplete(creds)
  const lifecycle = io.lifecycle ?? new RunLifecycle(io.signal)
  lifecycle.handleSignals()
  lifecycle.setDeadline(timeout)
  try {
    await listen(new CrispClient(creds, io.dispatcher, true), creds, {
      events, session, count, signal: lifecycle.signal, socketFactory: io.socketFactory,
      onEvent: event => writeOut(chunk => io.stdout(redactSecrets(chunk, [creds.key])), io.flags.json, event),
      onStatus: status => writeOut(io.stderr, io.flags.json, io.flags.json ? status : `RTM ${status.status}`),
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
  const creds = resolveCredentials(io.env, {
    profile: io.flags.profile,
    website: websiteOverride(io.flags),
  })
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
}
