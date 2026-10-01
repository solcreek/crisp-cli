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
    : /^[A-Za-z]{3}, /.test(value) ? Date.parse(value) - now : NaN
  return Number.isFinite(requested) ? Math.max(backoff, requested) : backoff
}

// Node timers overflow above this value. Long server delays must not retry early.
export async function waitForRetry(
  ms: number, signal: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void> = (ms, signal) => delay(ms, undefined, { signal }),
): Promise<void> {
  while (ms > 0) {
    signal.throwIfAborted()
    const chunk = Math.min(ms, 2_147_483_647)
    await sleep(chunk, signal)
    ms -= chunk
  }
}
