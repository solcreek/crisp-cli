import type { Readable, Writable } from "node:stream"
import { setImmediate } from "node:timers/promises"
import { run, type RunOptions } from "./cli.js"
import { OutputError, OutputSink } from "./output-sink.js"
import { writeErr } from "./output.js"
import { RunLifecycle } from "./lifecycle.js"

// Process-owned streams are handled here; run() retains callback injection for tests.
export async function runProcess(
  argv: string[],
  stdout: Writable,
  stderr: Writable,
  options: Omit<RunOptions, "stdout" | "stderr" | "lifecycle" | "serve"> & {
    drainTimeoutMs?: number
    stdin?: Readable
  } = {},
): Promise<number> {
  const lifecycle = new RunLifecycle(options.signal)
  const out = new OutputSink(stdout, lifecycle.cancel, "stdout")
  const err = new OutputSink(stderr, lifecycle.cancel, "stderr")
  try {
    lifecycle.handleSignals()
    let code = await run(argv, {
      ...options,
      stdout: out.write,
      stderr: err.write,
      lifecycle,
      signal: lifecycle.signal,
      serve: async (flags) => {
        const { serve } = await import("./stdio.js")
        stdout.once("close", lifecycle.cancel)
        try {
          return await serve({
            input: options.stdin ?? process.stdin,
            write: out.write,
            flush: () => out.flush(lifecycle.signal, options.drainTimeoutMs),
            signal: lifecycle.signal,
            env: options.env ?? process.env,
            flags,
            dispatcher: options.dispatcher,
          })
        } finally {
          stdout.removeListener("close", lifecycle.cancel)
        }
      },
    })
    const deadlineReported = lifecycle.timedOut
    try {
      await out.flush(lifecycle.signal, options.drainTimeoutMs)
    } catch (error) {
      const cause = error as NodeJS.ErrnoException
      if (cause.code !== "EPIPE") {
        const alreadyFailed = code !== 0
        code ||= 1
        if (lifecycle.timedOut) {
          if (!deadlineReported)
            writeErr(err.write, argv.includes("--json"), lifecycle.timeoutError(), [])
        } else if (cause.code !== "OUTPUT_CANCELLED" || !alreadyFailed) {
          // Only our own diagnostic text is safe to include, never OS/stream data.
          writeErr(
            err.write,
            argv.includes("--json"),
            new Error(cause instanceof OutputError ? cause.message : "stdout write failed"),
            [],
          )
        }
      }
    }
    lifecycle.clearDeadline()
    // Give diagnostics a separate bounded drain even after command cancellation.
    try {
      await err.flush(undefined, options.drainTimeoutMs)
    } catch {
      code ||= 1
    }
    return code
  } finally {
    lifecycle.dispose()
    // Writable emits 'error' after invoking the failed write callback.
    await setImmediate()
    out.dispose()
    err.dispose()
  }
}
