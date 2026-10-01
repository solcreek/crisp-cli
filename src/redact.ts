export function redactSecrets(message: string, secrets: readonly (string | undefined)[]): string {
  const present = [
    ...new Set(
      secrets.filter((secret): secret is string => typeof secret === "string" && secret.length > 0),
    ),
  ]
  if (present.length === 0) return message
  present.sort((left, right) => right.length - left.length)
  const pattern = new RegExp(present.map(escapeRegExp).join("|"), "g")
  return message.replace(pattern, "[redacted]")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
