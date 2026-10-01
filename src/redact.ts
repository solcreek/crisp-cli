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

// JSON.stringify invokes toJSON before the replacer, preserving dates and binary
// payloads. Redact strings and property names, never serialized JSON syntax.
export function jsonRedactor(secrets: readonly (string | undefined)[]) {
  const copies = new WeakMap<object, object>()
  return (_key: string, value: unknown): unknown => {
    if (typeof value === "string") return redactSecrets(value, secrets)
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value
    const existing = copies.get(value)
    if (existing) return existing
    const copy = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [redactSecrets(key, secrets), entry]),
    )
    // Reusing copies preserves JSON.stringify's circular-reference detection.
    copies.set(value, copy)
    return copy
  }
}
