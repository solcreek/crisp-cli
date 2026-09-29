export class UsageError extends Error {
  readonly exitCode = 2

  constructor(message: string) {
    super(message)
    this.name = "UsageError"
  }
}

export class ConfigError extends Error {
  readonly exitCode = 2

  constructor(message: string) {
    super(message)
    this.name = "ConfigError"
  }
}

export class CrispApiError extends Error {
  readonly exitCode = 1
  readonly status: number
  readonly reason: string
  readonly retryAfter?: string

  constructor(status: number, reason: string, message: string, retryAfter?: string) {
    super(message)
    this.name = "CrispApiError"
    this.status = status
    this.reason = reason
    if (retryAfter !== undefined) {
      this.retryAfter = retryAfter
    }
  }
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof UsageError || err instanceof ConfigError || err instanceof CrispApiError) {
    return err.exitCode
  }
  return 1
}
