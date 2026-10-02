import type { Dispatcher } from "undici"
import { type Flags } from "./args.js"
import { createCommandTree, commandError } from "./command-tree.js"
import { InvocationCredentials } from "./invocation-credentials.js"
import { redactSecrets } from "./redact.js"
import { exitCodeFor } from "./errors.js"
import { writeErr, writeOut } from "./output.js"
import type { SocketFactory } from "./rtm.js"
import { version } from "./version.js"
import type { RunLifecycle } from "./lifecycle.js"

export type RunOptions = {
  credentials?: InvocationCredentials
  serve?: (flags: Flags) => Promise<number>
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
  const credentials = options.credentials ?? new InvocationCredentials(env, argv)
  let flags: Flags | undefined
  try {
    const parsed = tree.prepare(argv)
    flags = parsed.flags
    const { positionals } = parsed
    if (flags.help) {
      stdout(redactSecrets(tree.help(positionals), credentials.diagnosticSecrets(flags)))
      return 0
    }
    if (flags.version && positionals.length === 0) {
      writeOut(stdout, flags.json, flags.json ? { version } : version)
      return 0
    }
    if (positionals.length === 0 || positionals[0] === "help") {
      stdout(redactSecrets(tree.help(positionals.slice(1)), credentials.diagnosticSecrets(flags)))
      return 0
    }
    return await tree.execute(argv, { ...options, stdout, stderr, env, flags, credentials })
  } catch (error) {
    const err = commandError(error)
    writeErr(
      stderr,
      flags?.json ?? argv.includes("--json"),
      err,
      credentials.diagnosticSecrets(flags ?? tree.flags()),
    )
    return exitCodeFor(err)
  }
}
