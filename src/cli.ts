import type { Dispatcher } from "undici"
import { assertAllowedFlags, pageNumber, parseArgv, requireArg, websiteOverride, type Flags, type ParsedArgv } from "./args.js"
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
import { CrispApiError, exitCodeFor, UsageError } from "./errors.js"
import { renderHelp, ROOT_HELP, usage } from "./help.js"
import { writeErr, writeOut } from "./output.js"
import { listen, parseEvents, positiveInteger, type SocketFactory } from "./rtm.js"
import { redactSecrets } from "./redact.js"
import { version } from "./version.js"

export type RunOptions = {
  stdout?: (chunk: string) => void
  stderr?: (chunk: string) => void
  env?: NodeJS.ProcessEnv
  dispatcher?: Dispatcher
  signal?: AbortSignal
  socketFactory?: SocketFactory
}

type IO = {
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
  env: NodeJS.ProcessEnv
  dispatcher?: Dispatcher
  signal?: AbortSignal
  socketFactory?: SocketFactory
  flags: Flags
}

export async function run(argv: string[], options: RunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((chunk: string) => process.stdout.write(chunk))
  const stderr = options.stderr ?? ((chunk: string) => process.stderr.write(chunk))
  const env = options.env ?? process.env
  const wantsJson = argv.includes("--json")
  let flags: Flags | undefined
  try {
    const parsed = parseArgv(argv)
    flags = parsed.flags
    const io: IO = { stdout, stderr, env, dispatcher: options.dispatcher, signal: options.signal, socketFactory: options.socketFactory, flags }
    return await execute(parsed, io)
  } catch (err) {
    writeErr(stderr, flags?.json ?? wantsJson, err, collectSecrets(env, flags))
    return exitCodeFor(err)
  }
}

async function execute(parsed: ParsedArgv, io: IO): Promise<number> {
  const { flags, seen, positionals } = parsed
  if (flags.help) {
    io.stdout(ensureNewline(renderHelp(positionals)))
    return 0
  }
  if (flags.version && positionals.length === 0) {
    writeOut(io.stdout, flags.json, flags.json ? { version } : version)
    return 0
  }
  if (positionals.length === 0 || positionals[0] === "help") {
    const topic = positionals[0] === "help" ? positionals.slice(1) : []
    io.stdout(ensureNewline(topic.length === 0 ? ROOT_HELP : renderHelp(topic)))
    return 0
  }

  const [command, sub, ...rest] = positionals
  if (isReadOnly(io) && (command === "auth" && sub === "set" ||
      ["reply", "resolve", "reopen", "assign", "segments", "read"].includes(command))) {
    throw new UsageError("read-only mode: write operations are disabled")
  }
  switch (command) {
    case "auth":
      return authCommand(sub, rest, seen, io)
    case "conversations":
      return conversationsCommand(sub, rest, seen, io)
    case "messages":
      return messagesCommand(sub, rest, seen, io)
    case "reply":
      return replyCommand(sub, rest, seen, io)
    case "resolve":
      return stateCommand("resolved", sub, rest, seen, io)
    case "reopen":
      return stateCommand("unresolved", sub, rest, seen, io)
    case "assign":
      return assignCommand(sub, rest, seen, io)
    case "segments":
      return segmentsCommand(sub, rest, seen, io)
    case "read":
      return readCommand(sub, rest, seen, io)
    case "people":
      return peopleCommand(sub, rest, seen, io)
    case "operators":
      return operatorsCommand(sub, rest, seen, io)
    case "listen":
      return listenCommand(sub, seen, io)
    default:
      throw new UsageError(`unknown command: ${command ?? ""}`)
  }
}

function authCommand(sub: string | undefined, rest: string[], seen: Set<string>, io: IO): number {
  if (sub === "set") {
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
  assertAllowedFlags(seen, ["events", "session", "timeout", "count"])
  if (extra !== undefined) throw new UsageError(`usage: ${usage.listen}`)
  const events = parseEvents(io.flags.events)
  const count = positiveInteger(io.flags.count, "count")
  const timeout = positiveInteger(io.flags.timeout, "timeout")
  if (timeout !== undefined && timeout > 2_147_483) throw new UsageError("--timeout is too large")
  const session = io.flags.session === undefined ? undefined : requireArg(io.flags.session, usage.listen)
  const creds = resolveCredentials(io.env, { profile: io.flags.profile, website: websiteOverride(io.flags) })
  assertComplete(creds)
  const controller = new AbortController()
  let timedOut = false
  const stop = () => controller.abort()
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
  io.signal?.addEventListener("abort", stop, { once: true })
  if (io.signal?.aborted) stop()
  const timer = timeout === undefined ? undefined : setTimeout(() => {
    timedOut = true
    stop()
  }, timeout * 1000)
  try {
    await listen(new CrispClient(creds, io.dispatcher, true), creds, {
      events, session, count, signal: controller.signal, socketFactory: io.socketFactory,
      onEvent: event => writeOut(chunk => io.stdout(redactSecrets(chunk, [creds.key])), io.flags.json, event),
      onStatus: status => writeOut(io.stderr, io.flags.json, io.flags.json ? status : `RTM ${status.status}`),
    })
    if (timedOut) throw new CrispApiError(0, "timeout", "RTM listen deadline reached")
    return 0
  } finally {
    clearTimeout(timer)
    process.removeListener("SIGINT", stop)
    process.removeListener("SIGTERM", stop)
    io.signal?.removeEventListener("abort", stop)
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

function collectSecrets(env: NodeJS.ProcessEnv, flags: Flags | undefined): string[] {
  const secrets = [flags?.key, env.CRISPCTL_KEY, env.CRISP_KEY]
  try {
    const creds = resolveCredentials(env, {
      profile: flags?.profile,
      website: flags ? websiteOverride(flags) : undefined,
    })
    secrets.push(creds.key)
  } catch {
    // Config may be unreadable. Env and flag secrets are still redacted.
  }
  return secrets.filter((secret): secret is string => typeof secret === "string")
}

function ensureNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`
}
