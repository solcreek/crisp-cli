const MIN_SECRET_LENGTH = 8

export function redactSecrets(message: string, secrets: readonly (string | undefined)[]): string {
  let out = message
  for (const secret of secrets) {
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      continue
    }
    out = out.split(secret).join("[redacted]")
  }
  return out
}
