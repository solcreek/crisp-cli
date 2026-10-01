import { spawn } from "node:child_process"
import { performance } from "node:perf_hooks"

// Nearest-rank percentiles retain tail samples instead of interpolating them away.
export function summarize(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error("expected nonempty, finite, nonnegative measurements")
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1]
  return { min: sorted[0], p50: rank(0.5), p95: rank(0.95), max: sorted.at(-1) }
}

// Measure from before spawn through close, including startup and output drain.
// Return output only for contract validation; reports must contain metrics only.
export function measureProcess(args, options) {
  const {
    env,
    cwd,
    timeoutMs = 15_000,
    maxOutputBytes = 4 * 1024 * 1024,
    outputStream = "stdout",
    pauseMs = 0,
    cancelAfterLine = false,
  } = options
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let telemetry = ""
    let bytes = 0
    let firstOutputMs = null
    let cancelledAt
    let resumeTimer
    let bytesSincePause = 0
    let readerPauseMs = 0
    let failure
    const fail = (message) => {
      failure ??= new Error(message)
      child.kill("SIGKILL")
    }
    const watchdog = setTimeout(() => fail("benchmark child exceeded its deadline"), timeoutMs)
    child.on("error", () => fail("benchmark child could not start"))
    for (const [name, stream] of [
      ["stdout", child.stdout],
      ["stderr", child.stderr],
      ["telemetry", child.stdio[3]],
    ]) {
      stream.setEncoding("utf8")
      stream.on("error", () => fail("benchmark child stream failed"))
      stream.on("data", (chunk) => {
        if (failure) return
        bytes += Buffer.byteLength(chunk)
        if (bytes > maxOutputBytes) return fail("benchmark child exceeded its output limit")
        if (name === outputStream && firstOutputMs === null)
          firstOutputMs = performance.now() - started
        if (name === "stdout") {
          stdout += chunk
          if (cancelAfterLine && cancelledAt === undefined && stdout.includes("\n")) {
            cancelledAt = performance.now()
            child.kill("SIGTERM")
          }
          if (pauseMs) {
            bytesSincePause += Buffer.byteLength(chunk)
            const quanta = Math.floor(bytesSincePause / (64 * 1024))
            if (quanta > 0) {
              bytesSincePause -= quanta * 64 * 1024
              const delay = quanta * pauseMs
              readerPauseMs += delay
              stream.pause()
              resumeTimer = setTimeout(() => stream.resume(), delay)
            }
          }
        } else if (name === "stderr") stderr += chunk
        else telemetry += chunk
      })
    }
    child.once("close", (code, signal) => {
      const ended = performance.now()
      clearTimeout(watchdog)
      clearTimeout(resumeTimer)
      if (failure) return reject(failure)
      try {
        const usage = JSON.parse(telemetry)
        for (const key of ["maxRSS", "userCPUTime", "systemCPUTime"])
          if (!Number.isFinite(usage[key]) || usage[key] < 0)
            throw new Error("invalid child resource metrics")
        resolve({
          code,
          signal,
          stdout,
          stderr,
          metrics: {
            wallMs: ended - started,
            firstOutputMs,
            cancelMs: cancelledAt === undefined ? null : ended - cancelledAt,
            peakRssMiB: usage.maxRSS / 1024,
            cpuMs: (usage.userCPUTime + usage.systemCPUTime) / 1000,
            stdoutBytes: Buffer.byteLength(stdout),
            readerPauseMs,
          },
        })
      } catch {
        reject(new Error("benchmark child did not provide valid resource metrics"))
      }
    })
  })
}
