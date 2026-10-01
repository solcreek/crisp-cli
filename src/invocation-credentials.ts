import { websiteOverride, type Flags } from "./args.js"
import { resolveCredentials, type ResolvedCredentials } from "./config.js"

// Credentials and diagnostic secrets belong to one invocation. A later config or
// environment change must not replace the key used for an in-flight request.
export class InvocationCredentials {
  private snapshot?: ResolvedCredentials
  private readonly secrets: string[]
  private readonly env: NodeJS.ProcessEnv

  constructor(
    env: NodeJS.ProcessEnv,
    private readonly argv: readonly string[],
  ) {
    this.env = { ...env }
    this.secrets = [...rawValues(argv, "key"), env.CRISPCTL_KEY, env.CRISP_KEY].filter(
      (secret): secret is string => typeof secret === "string",
    )
  }

  resolve(flags: Flags): ResolvedCredentials {
    if (!this.snapshot) {
      this.snapshot = resolveCredentials(this.env, {
        profile: flags.profile ?? rawValues(this.argv, "profile").at(-1),
        website: websiteOverride(flags),
      })
      this.secrets.push(this.snapshot.key)
    }
    return this.snapshot
  }

  diagnosticSecrets(flags: Flags): readonly string[] {
    try {
      this.resolve(flags)
    } catch {
      // Help and parser diagnostics still work with missing or unreadable config.
      // Supplied keys remain protected even when credential resolution fails.
    }
    return this.secrets
  }
}

// Conservative redaction scan, including repeated keys before parsing succeeds.
// Commander remains the only argument parser.
function rawValues(argv: readonly string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < argv.length && argv[index] !== "--"; index++) {
    const token = argv[index]!
    if (token.startsWith(`--${name}=`)) values.push(token.slice(name.length + 3))
    else if (token === `--${name}` && argv[index + 1] !== undefined) values.push(argv[index + 1]!)
  }
  return values
}
