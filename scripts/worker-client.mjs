// Bounded benchmark/test client for the public protocol; never retries requests.
import { spawn } from "node:child_process"
import { performance } from "node:perf_hooks"

export async function startWorker(args, env, { timeoutMs = 30000 } = {}) {
  const start = performance.now()
  const child = spawn(process.execPath, args, { env, stdio: ["pipe", "pipe", "pipe"] })
  child.stdout.setEncoding("utf8")
  const pending = new Map()
  let buffer = ""
  let seq = 0
  let readyResolve, readyReject
  let closedResolve
  let failed
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const closed = new Promise((resolve) => {
    closedResolve = resolve
  })
  const timer = setTimeout(() => fail(new Error("worker client deadline")), timeoutMs)
  function fail(error) {
    failed = error
    readyReject(error)
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
    child.kill("SIGKILL")
  }
  child.on("error", () => fail(new Error("worker could not start")))
  child.stdin.on("error", () => fail(new Error("worker input closed")))
  child.stderr.on("data", () => fail(new Error("unexpected worker diagnostic")))
  child.on("close", (code, signal) => {
    clearTimeout(timer)
    if (pending.size || code !== 0 || signal || seq === 0) fail(new Error("worker closed"))
    closedResolve({ code, signal })
  })
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8")
    if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) {
      fail(new Error("worker output limit"))
      return
    }
    let newline
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      let frame
      try {
        frame = JSON.parse(line)
      } catch {
        fail(new Error("invalid worker JSON"))
        return
      }
      if (frame.protocol !== 1) {
        fail(new Error("unsupported worker protocol"))
        return
      }
      if (frame.type === "ready") {
        seq = 1
        readyResolve(frame)
      } else if (frame.type === "response") {
        const waiter = pending.get(frame.id)
        if (!waiter) {
          fail(new Error("unexpected worker response"))
          return
        }
        pending.delete(frame.id)
        waiter.resolve(frame)
      } else if (frame.type !== "bye") {
        fail(new Error("worker protocol failure"))
        return
      }
    }
  })
  const capabilities = await ready
  return {
    startupMs: performance.now() - start,
    capabilities,
    child,
    closed,
    request(argv, timeout_ms) {
      if (failed) return Promise.reject(failed)
      const id = `r${seq++}`
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
      child.stdin.write(
        JSON.stringify({ protocol: 1, type: "request", id, argv, timeout_ms }) + "\n",
      )
      return result
    },
    async stop() {
      if (!child.killed) child.stdin.end(JSON.stringify({ protocol: 1, type: "shutdown" }) + "\n")
      return closed
    },
  }
}
