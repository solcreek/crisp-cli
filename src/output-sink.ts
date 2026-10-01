import type { Writable } from "node:stream"

export const OUTPUT_LIMIT_BYTES = 8 * 1024 * 1024

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
      this.fail(Object.assign(new Error(`${this.label} buffer exceeded ${this.limit} bytes; consumer is too slow`), { code: "OUTPUT_OVERFLOW" }))
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

  async flush(): Promise<void> {
    if (!this.failure && (this.active || this.queue.length)) {
      await new Promise<void>(resolve => this.waiters.push(resolve))
    }
    if (this.failure) throw this.failure
  }

  dispose(): void {
    this.stream.removeListener("error", this.fail)
  }
}
