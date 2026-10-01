import { CrispApiError } from "./errors.js"

// Owned by the process until output drains, or by run() for callback-only callers.
export class RunLifecycle {
  private controller = new AbortController()
  private timer?: ReturnType<typeof setTimeout>
  private handlingSignals = false
  readonly signal = this.controller.signal
  timedOut = false

  constructor(private external?: AbortSignal) {
    external?.addEventListener("abort", this.cancel, { once: true })
    if (external?.aborted) this.cancel()
  }

  cancel = (): void => {
    this.controller.abort()
  }

  handleSignals(): void {
    if (this.handlingSignals) return
    this.handlingSignals = true
    process.on("SIGINT", this.cancel)
    process.on("SIGTERM", this.cancel)
  }

  setDeadline(seconds?: number): void {
    if (seconds === undefined) return
    this.timer = setTimeout(() => {
      this.timedOut = true
      this.cancel()
    }, seconds * 1000)
  }

  timeoutError(): CrispApiError {
    return new CrispApiError(0, "timeout", "RTM listen deadline reached")
  }

  clearDeadline(): void {
    clearTimeout(this.timer)
  }

  dispose(): void {
    this.clearDeadline()
    process.removeListener("SIGINT", this.cancel)
    process.removeListener("SIGTERM", this.cancel)
    this.external?.removeEventListener("abort", this.cancel)
  }
}
