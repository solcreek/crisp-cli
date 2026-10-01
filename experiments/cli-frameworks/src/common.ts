import { setTimeout as delay } from 'node:timers/promises'

export class Failure extends Error {
  constructor(message: string, readonly code = 2, readonly kind = 'usage') { super(message) }
}
export type Options = { json?: boolean; readOnly?: boolean; page?: number; text?: string; note?: string; count?: number; timeout?: number }
export type Request = { command: 'list' | 'reply' | 'listen'; session?: string; options: Options }
export type Event = { event: string; data: { session_id: string; content: string }; sequence: number }
export type Dispatch = (request: Request) => Promise<void>
export const rows = [{ session_id: 'session_fixture', state: 'unresolved', subject: 'POC fixture — no Crisp network access' }]
export function positive(value: string): number {
  const number = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) throw new Failure('expected a positive integer')
  return number
}
export function formatError(error: unknown, json: boolean): string {
  const failure = error instanceof Error ? error : new Error(String(error))
  const kind = error instanceof Failure ? error.kind : 'usage'
  return json ? JSON.stringify({ ok: false, error: kind, message: failure.message }) : `error: ${failure.message}`
}
export async function line(stream: NodeJS.WriteStream, value: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason
  await new Promise<void>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal?.reason) }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
    stream.write(`${value}\n`, error => { cleanup(); error ? reject(error) : resolve() })
  })
}
// Deterministic local event source, deliberately shared by all adapters.
export async function events(options: Options, signal: AbortSignal, emit: (event: Event) => Promise<void>): Promise<void> {
  let sequence = 0
  const deadline = options.timeout ? AbortSignal.timeout(options.timeout * 1000) : undefined
  const combined = deadline ? AbortSignal.any([signal, deadline]) : signal
  try {
    while (!combined.aborted && (!options.count || sequence < options.count)) {
      await delay(25, undefined, { signal: combined })
      await emit({ event: 'message:send', data: { session_id: 'session_fixture', content: 'hello\n世界' }, sequence: ++sequence })
    }
  } catch (error) {
    if (!combined.aborted) throw error
  }
  if (deadline?.aborted) throw new Failure('RTM listen deadline reached', 1, 'timeout')
}
export function createDispatch(signal: AbortSignal, humanListen?: (options: Options) => Promise<void>): Dispatch {
  return async ({ command, session, options }) => {
    // Operation-layer guard also applies to direct invocation, beyond the parser.
    if (command === 'reply' && (options.readOnly || process.env.CRISPCTL_READ_ONLY === '1')) {
      throw new Failure('read-only mode: write operations are disabled')
    }
    if (command === 'reply' && Number(options.text !== undefined) + Number(options.note !== undefined) !== 1) {
      throw new Failure('provide exactly one of --text or --note')
    }
    if (command === 'listen') {
      if (!options.json && humanListen) return humanListen(options)
      await line(process.stderr, options.json ? JSON.stringify({ status: 'authenticated', source: 'fixture' }) : 'RTM authenticated (fixture)')
      return events(options, signal, event => line(process.stdout, options.json ? JSON.stringify(event) : `${event.sequence} ${event.event} ${event.data.session_id}`, signal))
    }
    const value = command === 'list' ? { page: options.page ?? 1, conversations: rows }
      : { fixture: true, session_id: session, text: options.text, note: options.note }
    await line(process.stdout, options.json ? JSON.stringify(value) : JSON.stringify(value, null, 2), signal)
  }
}
