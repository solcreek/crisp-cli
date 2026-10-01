/** @import { Readable } from 'node:stream' */
/** @import { ChildProcess } from 'node:child_process' */
/** @import { EventEmitter } from 'node:events' */

/**
 * Consume bounded, newline-terminated JSON objects without exposing parser input.
 * @param {Readable} stream
 * @param {(record: Record<string, unknown>) => void} accept
 * @param {() => void} fail
 * @param {number} [maxLineBytes]
 */
export function observeJsonLines(stream, accept, fail, maxLineBytes = 1024 * 1024) {
  let pending = ""
  let failed = false
  const reject = () => {
    if (failed) return
    failed = true
    fail()
  }
  /** @param {string} chunk */
  const data = (chunk) => {
    if (failed) return
    pending += chunk
    const parts = pending.split("\n")
    pending = parts.pop() ?? ""
    for (const line of parts) {
      if (Buffer.byteLength(line) > maxLineBytes) {
        reject()
        return
      }
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line)
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          reject()
          return
        }
        accept(record)
      } catch {
        reject()
        return
      }
    }
    if (Buffer.byteLength(pending) > maxLineBytes) reject()
  }
  const end = () => {
    if (pending.trim()) reject()
  }
  stream.setEncoding("utf8")
  stream.on("data", data)
  stream.on("end", end)
  stream.on("close", end)
  stream.on("error", reject)
  return () => {
    stream.removeListener("data", data)
    stream.removeListener("end", end)
    stream.removeListener("close", end)
    stream.removeListener("error", reject)
  }
}

/**
 * @param {Pick<ChildProcess, 'on' | 'removeListener' | 'kill' | 'unref'> & {stdout: Readable, stderr: Readable}} child
 * @param {{websiteId: string, mode: 'auth' | 'event', report: (value: Record<string, unknown>) => void, timeoutMs?: number, killGraceMs?: number, signals?: EventEmitter}} options
 * @returns {Promise<boolean>}
 */
export function monitorRtmSmoke(child, options) {
  const {
    websiteId,
    mode,
    report,
    timeoutMs = 65_000,
    killGraceMs = 1000,
    signals = process,
  } = options
  return new Promise((resolve) => {
    let received = 0
    let authenticated = false
    let failed = false
    let settled = false
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let killTimer
    const stop = () => {
      if (killTimer || settled) return
      killTimer = setTimeout(() => {
        child.kill("SIGKILL")
        child.stdout.destroy()
        child.stderr.destroy()
        child.unref()
        finish(null)
      }, killGraceMs)
      child.kill("SIGTERM")
    }
    const fail = () => {
      failed = true
      stop()
    }
    const watchdog = setTimeout(fail, timeoutMs)
    const detachOut = observeJsonLines(
      child.stdout,
      (event) => {
        const data = event.data
        if (
          !data ||
          typeof data !== "object" ||
          !("website_id" in data) ||
          data.website_id !== websiteId ||
          typeof event.event !== "string"
        ) {
          fail()
          return
        }
        received++
        // Report assertions only: arbitrary event names/keys may contain private data.
        report({ check: "event", website_matches: true, customer_content_printed: false })
      },
      fail,
    )
    const detachErr = observeJsonLines(
      child.stderr,
      (status) => {
        if (status.status === "authenticated") {
          authenticated = true
          report({ check: "status", status: "authenticated" })
          if (mode === "auth") stop()
        }
        if (status.error) fail()
      },
      fail,
    )
    /** @param {number | null} code */
    function finish(code) {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      clearTimeout(killTimer)
      signals.removeListener("SIGTERM", fail)
      signals.removeListener("SIGINT", fail)
      child.removeListener("error", fail)
      child.removeListener("close", finish)
      detachOut()
      detachErr()
      report({ check: "result", mode, authenticated, exit_code: code, received_events: received })
      resolve(!failed && code === 0 && authenticated && (mode === "auth" || received > 0))
    }
    signals.on("SIGTERM", fail)
    signals.on("SIGINT", fail)
    child.on("error", fail)
    // 'exit' can precede the last data; only 'close' completes verification.
    child.on("close", finish)
  })
}
