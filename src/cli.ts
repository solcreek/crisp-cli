import type { Dispatcher } from "undici"
import { parseArgv, websiteOverride, type Flags, type ParsedArgv } from "./args.js"
import { resolveCredentials } from "./config.js"
import { exitCodeFor, UsageError } from "./errors.js"
import { renderHelp, ROOT_HELP } from "./help.js"
import { writeErr, writeOut } from "./output.js"
import type { SocketFactory } from "./rtm.js"
import { version } from "./version.js"
import type { RunLifecycle } from "./lifecycle.js"
import type { IO } from "./context.js"
import { authCommand, conversationsCommand, messagesCommand, replyCommand, stateCommand, assignCommand, segmentsCommand, readCommand, peopleCommand, operatorsCommand, listenCommand } from "./operations.js"

export type RunOptions = {
  lifecycle?: RunLifecycle
  stdout?: (chunk: string) => void
  stderr?: (chunk: string) => void
  env?: NodeJS.ProcessEnv
  dispatcher?: Dispatcher
  signal?: AbortSignal
  socketFactory?: SocketFactory
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
    const io: IO = { stdout, stderr, env, dispatcher: options.dispatcher, signal: options.signal, socketFactory: options.socketFactory, flags, lifecycle: options.lifecycle }
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
