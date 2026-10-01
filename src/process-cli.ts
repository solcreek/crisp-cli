import type { Writable } from "node:stream"
import { setImmediate } from "node:timers/promises"
import { run, type RunOptions } from "./cli.js"
import { OutputSink } from "./output-sink.js"
import { writeErr } from "./output.js"

// Process-owned streams are handled here; run() retains callback injection for tests.
export async function runProcess(
  argv: string[], stdout: Writable, stderr: Writable,
  options: Omit<RunOptions, "stdout" | "stderr"> = {},
): Promise<number> {
  const controller = new AbortController()
  const stop = () => controller.abort()
  const out = new OutputSink(stdout, stop, "stdout")
  const err = new OutputSink(stderr, stop, "stderr")
  let code = await run(argv, { ...options, stdout: out.write, stderr: err.write,
    signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal })
  try {
    await out.flush()
  } catch (error) {
    const cause = error as NodeJS.ErrnoException
    if (cause.code === "EPIPE") code = 0
    else {
      code = 1
      // Do not include arbitrary OS/stream error messages that could contain data.
      writeErr(err.write, argv.includes("--json"), new Error(cause.code === "OUTPUT_OVERFLOW"
        ? cause.message : "stdout write failed"), [])
    }
  }
  try { await err.flush() } catch { code = 1 }
  // Writable emits 'error' after invoking the failed write callback.
  await setImmediate()
  out.dispose()
  err.dispose()
  return code
}
