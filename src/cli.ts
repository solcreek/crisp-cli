import type { Dispatcher } from "undici"
import { websiteOverride, type Flags } from "./args.js"
import { createCommandTree, commandError } from "./command-tree.js"
import { resolveCredentials } from "./config.js"
import { exitCodeFor } from "./errors.js"
import { writeErr, writeOut } from "./output.js"
import type { SocketFactory } from "./rtm.js"
import { version } from "./version.js"
import type { RunLifecycle } from "./lifecycle.js"

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
  const tree = createCommandTree()
  let flags: Flags | undefined
  try {
    const parsed = tree.prepare(argv)
    flags = parsed.flags
    const { positionals } = parsed
    if (flags.help) {
      stdout(tree.help(positionals))
      return 0
    }
    if (flags.version && positionals.length === 0) {
      writeOut(stdout, flags.json, flags.json ? { version } : version)
      return 0
    }
    if (positionals.length === 0 || positionals[0] === "help") {
      stdout(tree.help(positionals.slice(1)))
      return 0
    }
    return await tree.execute(argv, { ...options, stdout, stderr, env, flags })
  } catch (error) {
    const err = commandError(error)
    writeErr(
      stderr,
      flags?.json ?? argv.includes("--json"),
      err,
      collectSecrets(env, flags ?? tree.flags(), argv),
    )
    return exitCodeFor(err)
  }
}

// Also collect supplied keys before parsing succeeds, including repeated values.
// This is only a conservative redaction scan; Commander owns argument parsing.
function rawValues(argv: readonly string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < argv.length && argv[index] !== "--"; index++) {
    const token = argv[index]!
    if (token.startsWith(`--${name}=`)) values.push(token.slice(name.length + 3))
    else if (token === `--${name}` && argv[index + 1] !== undefined) values.push(argv[index + 1]!)
  }
  return values
}

function collectSecrets(env: NodeJS.ProcessEnv, flags: Flags, argv: readonly string[]): string[] {
  const secrets = [...rawValues(argv, "key"), flags.key, env.CRISPCTL_KEY, env.CRISP_KEY]
  try {
    const creds = resolveCredentials(env, {
      profile: flags.profile ?? rawValues(argv, "profile").at(-1),
      website: websiteOverride(flags),
    })
    secrets.push(creds.key)
  } catch {
    // Config may be unreadable; explicit and environment keys remain protected.
  }
  return secrets.filter((secret): secret is string => typeof secret === "string")
}
