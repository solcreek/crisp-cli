import { Command, CommanderError, Help, Option } from "commander"
import { assertAllowedFlags, GLOBAL_FLAGS, type Flags } from "./args.js"
import type { IO } from "./context.js"
import { UsageError } from "./errors.js"
import { COMMAND_NOTES, ROOT_NOTES } from "./help.js"
import * as operations from "./operations.js"

const OPTIONS = [
  ["--json", "Write machine-readable JSON"],
  ["-h, --help", "Show help"],
  ["--version", "Show version"],
  ["--read-only", "Refuse all write operations"],
  ["--profile <name>", "Select a credential profile"],
  ["--website <id>", "Override website ID"],
  ["--website-id <id>", "Alias for --website"],
  ["--identifier <id>", "API identifier"],
  ["--key <key>", "API token key"],
  ["--tier <tier>", "Token tier: website or plugin"],
  ["--page <n>", "Page number (default: 1)"],
  ["--search-type <type>", "Search type: text or segment"],
  ["--text <message>", "Send an operator message"],
  ["--note <note>", "Send a private note"],
  ["--user <id>", "Operator ID"],
  ["--unassign", "Remove the assigned operator"],
  ["--set <a,b>", "Replace segments (empty value clears them)"],
  ["--events <a,b>", "RTM event names"],
  ["--session <id>", "Filter RTM events by session"],
  ["--count <n>", "Stop after N matching events"],
  ["--timeout <seconds>", "Listen deadline including stdout drain"],
  ["--list-events", "List RTM events without connecting"],
] as const

type Definition = {
  path: string
  description: string
  argument?: string
  options?: readonly string[]
  run: (io: IO, argument?: string) => number | Promise<number>
}
const DEFINITIONS: readonly Definition[] = [
  { path: "auth set", description: "Save a credential profile", options: ["identifier", "key", "tier"], run: operations.authSet },
  { path: "auth show", description: "Show the profile with the key redacted", run: operations.authShow },
  { path: "conversations list", description: "List conversations", options: ["page"], run: operations.conversationsList },
  { path: "conversations get", description: "Get one conversation", argument: "<session>", run: operations.conversationsGet },
  { path: "conversations search", description: "Search conversations", argument: "<query>", options: ["page", "search-type"], run: operations.conversationsSearch },
  { path: "messages list", description: "List messages in a session", argument: "<session>", run: operations.messagesList },
  { path: "reply", description: "Send an operator message or private note", argument: "<session>", options: ["text", "note"], run: operations.replyCommand },
  { path: "resolve", description: "Set conversation state to resolved", argument: "<session>", run: operations.resolveCommand },
  { path: "reopen", description: "Set conversation state to unresolved", argument: "<session>", run: operations.reopenCommand },
  { path: "assign", description: "Assign or unassign an operator", argument: "<session>", options: ["user", "unassign"], run: operations.assignCommand },
  { path: "segments", description: "Replace conversation segments", argument: "<session>", options: ["set"], run: operations.segmentsCommand },
  { path: "read", description: "Mark the conversation read", argument: "<session>", run: operations.readCommand },
  { path: "people get", description: "Get a people profile by ID or email", argument: "<id|email>", run: operations.peopleGet },
  { path: "operators list", description: "List website operators", run: operations.operatorsList },
  { path: "listen", description: "Stream RTM events with automatic reconnection", options: ["events", "session", "count", "timeout", "list-events"], run: operations.listenCommand },
]

// A fresh tree per invocation: no global program, process exit, or direct diagnostics.
export function createCommandTree() {
  const create = (name: string) => new Command(name).exitOverride().helpOption(false).addHelpCommand(false)
    .allowExcessArguments(false).showSuggestionAfterError(false)
    .configureHelp({ showGlobalOptions: true })
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
  const root = create("crispctl").description("Agent-friendly Crisp REST and RTM CLI")
  const optionDefinitions = OPTIONS.map(([flags, description]) => new Option(flags, description))
  for (const option of optionDefinitions) root.addOption(option.hideHelp(!GLOBAL_FLAGS.has(option.name())))
  const leaves: Command[] = []
  let io: IO
  let result = 0
  let seen = new Set<string>()
  for (const definition of DEFINITIONS) {
    const path = definition.path.split(" ")
    let parent = root
    for (const name of path.slice(0, -1)) {
      let group = parent.commands.find(command => command.name() === name)
      if (!group) {
        group = create(name)
        group.action(() => { throw new UsageError(`usage: crispctl ${name} <${group!.commands.map(command => command.name()).join("|")}>`) })
        parent.addCommand(group)
      }
      parent = group
    }
    const command = create(path.at(-1)!).description(definition.description)
    if (definition.argument) command.argument(definition.argument)
    for (const [flags, description] of OPTIONS) {
      const option = new Option(flags, description)
      if (definition.options?.includes(option.name())) command.addOption(option)
    }
    command.addHelpText("after", `\n${COMMAND_NOTES[definition.path]!}`)
    command.action(async () => {
      assertAllowedFlags(seen, definition.options ?? [])
      result = await definition.run(io, command.args[0])
    })
    parent.addCommand(command)
    leaves.push(command)
  }
  root.addHelpText("after", `\n${ROOT_NOTES}`)
  root.configureHelp({
    showGlobalOptions: true,
    visibleCommands(command) { return command === root ? leaves : Help.prototype.visibleCommands.call(this, command) },
    subcommandTerm(command) {
      const prefix = command.parent && command.parent !== root ? `${command.parent.name()} ` : ""
      return prefix + Help.prototype.subcommandTerm.call(this, command)
    },
  })

  const flags = (): Flags => ({ json: false, help: false, version: false, readOnly: false, listEvents: false, unassign: false, ...root.opts<Partial<Flags>>() })
  return {
    flags,
    prepare(argv: string[]) {
      // Commander permits switches as required option values. Preserve the CLI's
      // safer spelling: use --text=--literal when a value begins with two dashes.
      for (let index = 0; index < argv.length; index++) {
        if (argv[index] === "--") break
        const option = optionDefinitions.find(candidate => candidate.long === argv[index])
        if (option?.required) {
          if (argv[index + 1]?.startsWith("--")) throw new UsageError(`${option.long} requires a value`)
          index++
        }
      }
      // Preflight uses Commander's own parser so help and version can short-circuit
      // validation, with all recognized options accepted before or after commands.
      const parsed = root.parseOptions(argv)
      if (parsed.unknown.length) throw new UsageError(`unknown flag: ${parsed.unknown[0]}`)
      const values = flags()
      if (values.website !== undefined && values.websiteId !== undefined && values.website !== values.websiteId) {
        throw new UsageError("--website and --website-id disagree")
      }
      seen = new Set(optionDefinitions.filter(option => root.getOptionValueSource(option.attributeName()) === "cli").map(option => option.name()))
      return { flags: values, positionals: parsed.operands }
    },
    help(path: readonly string[]): string {
      let command = root
      for (const name of path) {
        const child = command.commands.find(candidate => candidate.name() === name)
        if (!child) break
        command = child
      }
      // helpInformation excludes addHelpText, so use injected outputHelp capture.
      let text = ""
      command.configureOutput({ writeOut: chunk => { text += chunk } })
      command.outputHelp()
      if (command === root && path.length) text += `\nUnknown command: ${path[0]}\n`
      return text
    },
    async execute(argv: string[], context: IO): Promise<number> {
      io = context
      // Route the original tokens to preserve the native -- separator semantics.
      await root.parseAsync(argv, { from: "user" })
      return result
    },
  }
}

export function commandError(error: unknown): unknown {
  if (!(error instanceof CommanderError)) return error
  const message = error.message.replace(/^error: /, "").replace(/^unknown command '(.*)'$/, "unknown command: $1")
  return new UsageError(message)
}
