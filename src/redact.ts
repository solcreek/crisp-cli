export function redactSecrets(message: string, secrets: readonly (string | undefined)[]): string {
  const pattern = secretPattern(secrets)
  return pattern ? message.replace(pattern, "[redacted]") : message
}

function secretPattern(secrets: readonly (string | undefined)[]): RegExp | undefined {
  const present = [
    ...new Set(
      secrets.filter((secret): secret is string => typeof secret === "string" && secret.length > 0),
    ),
  ]
  if (present.length === 0) return undefined
  present.sort((left, right) => right.length - left.length)
  return new RegExp(present.map(escapeRegExp).join("|"), "g")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// JSON.stringify invokes toJSON before the replacer, preserving dates and binary
// payloads. Redact strings and property names, never serialized JSON syntax.
export function jsonRedactor(secrets: readonly (string | undefined)[]) {
  // One pattern per serialization, not per string/property. Keep it local so
  // separate invocations and credential changes cannot reuse another key.
  const pattern = secretPattern(secrets)
  const redact = (value: string) => (pattern ? value.replace(pattern, "[redacted]") : value)
  const copies = new WeakMap<object, object>()
  return (_key: string, value: unknown): unknown => {
    if (typeof value === "string") return redact(value)
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value
    const existing = copies.get(value)
    if (existing) return existing
    const copy = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [redact(key), entry]),
    )
    // Reusing copies preserves JSON.stringify's circular-reference detection.
    copies.set(value, copy)
    return copy
  }
}
