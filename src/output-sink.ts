import type { Writable } from "node:stream"

export const OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024
export const OUTPUT_DRAIN_TIMEOUT_MS = 5000

export class OutputError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

// One in-flight write: wait for its callback before submitting another chunk.
// Socket.IO cannot pause the remote publisher, so excess queued output is fatal.
export class OutputSink {
  private queue: string[] = []
  private bytes = 0
  private active = false
  private failure?: Error
  private waiters: (() => void)[] = []

  constructor(
    private stream: Writable,
    private stop: () => void,
    private label: string,
    private limit = OUTPUT_LIMIT_BYTES,
  ) {
    stream.on("error", this.fail)
    stream.on("close", this.closed)
  }

  private closed = (): void => {
    if (this.active || this.queue.length) this.fail(this.outputError("OUTPUT_CLOSED", "closed before output drained"))
  }

  private outputError(code: string, message: string): Error {
    return new OutputError(code, `${this.label} ${message}`)
  }

  private fail = (error: Error): void => {
    if (this.failure) return
    this.failure = error
    this.queue = []
    this.bytes = 0
    this.stream.destroy()
    this.stop()
    this.wake()
  }

  write = (chunk: string): void => {
    if (this.failure) return
    const bytes = Buffer.byteLength(chunk)
    if (this.bytes + bytes > this.limit) {
      this.fail(this.outputError("OUTPUT_OVERFLOW", `buffer exceeded ${this.limit} bytes; consumer is too slow`))
      return
    }
    this.bytes += bytes
    this.queue.push(chunk)
    this.pump()
  }

  private pump(): void {
    if (this.active || this.failure) return
    const chunk = this.queue.shift()
    if (chunk === undefined) { this.wake(); return }
    this.active = true
    this.stream.write(chunk, error => {
      this.active = false
      if (error) this.fail(error)
      if (this.failure) return
      this.bytes -= Buffer.byteLength(chunk)
      this.pump()
    })
  }

  private wake(): void {
    for (const resolve of this.waiters.splice(0)) resolve()
  }

  async flush(signal?: AbortSignal, timeoutMs = OUTPUT_DRAIN_TIMEOUT_MS): Promise<void> {
    if (!this.failure && (this.active || this.queue.length)) {
      const abort = () => this.fail(this.outputError("OUTPUT_CANCELLED", "output drain cancelled"))
      const timer = setTimeout(() => this.fail(this.outputError("OUTPUT_TIMEOUT", "output drain timed out")), timeoutMs)
      signal?.addEventListener("abort", abort, { once: true })
      try {
        if (signal?.aborted) abort()
        if (!this.failure) await new Promise<void>(resolve => this.waiters.push(resolve))
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
      }
    }
    if (this.failure) throw this.failure
  }

  dispose(): void {
    this.stream.removeListener("error", this.fail)
    this.stream.removeListener("close", this.closed)
  }
}
