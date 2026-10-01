import { setTimeout as delay } from "node:timers/promises"

export type RetryRuntime = {
  now: () => number
  random: () => number
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
}

export function retryDelay(failures: number, baseMs: number, random: number, now: number, retryAfter?: string): number {
  const cap = Math.min(baseMs * 2 ** Math.min(failures, 30), 30_000)
  // Equal jitter avoids synchronized reconnects without zero-delay retry loops.
  const backoff = Math.ceil(cap * (0.5 + random * 0.5))
  if (retryAfter === undefined) return backoff
  const value = retryAfter.trim()
  const requested = /^\d+$/.test(value) ? Number(value) * 1000
    : canonicalHttpDate(value) - now
  return Number.isFinite(requested) ? Math.max(backoff, requested) : backoff
}

function canonicalHttpDate(value: string): number {
  // Date.parse also accepts incomplete dates and normalizes impossible days.
  // Require IMF-fixdate syntax, then round-trip to validate the calendar/weekday.
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return NaN
  const timestamp = Date.parse(value)
  return new Date(timestamp).toUTCString() === value ? timestamp : NaN
}

// Node timers overflow above this value. Long server delays must not retry early.
export async function waitForRetry(
  ms: number, signal: AbortSignal,
  sleep: (duration: number, cancellation: AbortSignal) => Promise<void> = (duration, cancellation) => delay(duration, undefined, { signal: cancellation }),
): Promise<void> {
  while (ms > 0) {
    signal.throwIfAborted()
    const chunk = Math.min(ms, 2_147_483_647)
    await sleep(chunk, signal)
    ms -= chunk
  }
}
