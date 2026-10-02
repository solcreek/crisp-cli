// Reference example, not a supported JavaScript SDK. The wire protocol is public.
import { spawn } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export async function connectWorker({
  command = process.env.CRISPCTL_BIN || "node",
  args = process.env.CRISPCTL_BIN
    ? []
    : [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
  env = process.env,
  signal,
  handshakeMs = 5000,
  shutdownMs = 6000,
  responseGraceMs = 1000,
} = {}) {
  const child = spawn(command, [...args, "serve", "--stdio", "--read-only"], {
    env: { ...env, CRISPCTL_READ_ONLY: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const pending = new Map()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let buffer = "",
    sequence = 0,
    capabilities,
    limits,
    failure,
    closing = false,
    bye = false
  let resolveReady, rejectReady, resolveClosed
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const closed = new Promise((resolve) => {
    resolveClosed = resolve
  })
  const handshakeTimer = setTimeout(() => fail("worker handshake timed out"), handshakeMs)
  let shutdownTimer
  const interrupted = () => fail("client interrupted")
  function release(waiter) {
    clearTimeout(waiter.timer)
    waiter.signal?.removeEventListener("abort", waiter.cancel)
  }
  function fail(message) {
    if (failure) return
    failure = new Error(message)
    clearTimeout(handshakeTimer)
    rejectReady(failure)
    for (const waiter of pending.values()) {
      release(waiter)
      waiter.reject(failure)
    }
    pending.clear()
    child.kill("SIGKILL")
  }
  const send = (frame) => child.stdin.write(JSON.stringify({ protocol: 1, ...frame }) + "\n")
  const validLimit = (value) => Number.isSafeInteger(value) && value > 0
  function receive(frame) {
    if (!frame || frame.protocol !== 1 || typeof frame.type !== "string") throw new Error()
    if (!capabilities) {
      const c = frame.capabilities,
        l = frame.limits
      if (
        frame.type !== "ready" ||
        c?.read_only !== true ||
        c.cancellation !== true ||
        c.retries !== false ||
        !Array.isArray(c.commands) ||
        !c.commands.every((x) => typeof x === "string") ||
        !c.commands.includes("auth show") ||
        !l ||
        ![l.concurrency, l.requestBytes, l.responseBytes, l.maxTimeoutMs].every(validLimit)
      )
        throw new Error()
      capabilities = c
      limits = l
      clearTimeout(handshakeTimer)
      resolveReady()
    } else if (frame.type === "response") {
      const waiter = pending.get(frame.id)
      if (
        !waiter ||
        !Number.isInteger(frame.code) ||
        !(
          (frame.ok === true && frame.code === 0 && "result" in frame) ||
          (frame.ok === false && frame.code > 0 && typeof frame.error?.error === "string")
        )
      )
        throw new Error()
      pending.delete(frame.id)
      release(waiter)
      waiter.resolve(frame)
    } else if (frame.type === "bye" && closing && pending.size === 0 && !bye) {
      bye = true
    } else throw new Error()
  }
  child.stdout.on("data", (chunk) => {
    if (failure) return
    try {
      buffer += decoder.decode(chunk, { stream: true })
      let newline
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (Buffer.byteLength(line) + 1 > Math.min(limits?.responseBytes ?? 1048576, 1048576))
          throw new Error()
        receive(JSON.parse(line))
      }
      if (Buffer.byteLength(buffer) > Math.min(limits?.responseBytes ?? 1048576, 1048576))
        throw new Error()
    } catch {
      fail("invalid worker protocol output")
    }
  })
  // Discard raw diagnostics: they may come from an arbitrary custom executable.
  child.stderr.on("data", () => fail("worker reported a process failure"))
  child.on("error", () => fail("worker could not start"))
  child.stdin.on("error", () => fail("worker input closed"))
  child.on("close", (code, exitSignal) => {
    clearTimeout(handshakeTimer)
    clearTimeout(shutdownTimer)
    signal?.removeEventListener("abort", interrupted)
    try {
      buffer += decoder.decode()
    } catch {
      fail("invalid worker protocol output")
    }
    if (!closing || !bye || pending.size || buffer || code !== 0 || exitSignal)
      fail("worker closed unexpectedly")
    resolveClosed()
  })
  signal?.addEventListener("abort", interrupted, { once: true })
  if (signal?.aborted) interrupted()
  try {
    await ready
    if (failure) throw failure
  } catch (error) {
    await closed
    throw error
  } // Reap before any caller fallback.
  return {
    capabilities,
    request(argv, { signal: requestSignal, timeoutMs = 5000 } = {}) {
      if (failure || closing) return Promise.reject(failure ?? new Error("worker is closing"))
      if (requestSignal?.aborted) return Promise.reject(new Error("request already cancelled"))
      if (
        !Array.isArray(argv) ||
        argv.length > 128 ||
        !argv.every((x) => typeof x === "string" && !x.includes("\0")) ||
        !validLimit(timeoutMs) ||
        timeoutMs > Math.min(limits.maxTimeoutMs, 120000)
      )
        return Promise.reject(new Error("invalid request"))
      if (pending.size >= Math.min(limits.concurrency, 4))
        return Promise.reject(new Error("client concurrency limit reached"))
      const id = `r${++sequence}`
      const frame = { type: "request", id, argv, timeout_ms: timeoutMs }
      if (
        Buffer.byteLength(JSON.stringify({ protocol: 1, ...frame })) >
        Math.min(limits.requestBytes, 65536)
      )
        return Promise.reject(new Error("request too large"))
      return new Promise((resolve, reject) => {
        const cancel = () => send({ type: "cancel", id })
        const timer = setTimeout(
          () => fail("worker response deadline exceeded"),
          timeoutMs + responseGraceMs,
        )
        pending.set(id, { resolve, reject, timer, signal: requestSignal, cancel })
        requestSignal?.addEventListener("abort", cancel, { once: true })
        send(frame)
      })
    },
    async close() {
      if (!closing) {
        closing = true
        if (!failure) {
          shutdownTimer = setTimeout(() => fail("worker shutdown timed out"), shutdownMs)
          // Keep stdin open until callers have consumed the results they need.
          child.stdin.end('{"protocol":1,"type":"shutdown"}\n')
        }
      }
      await closed
      if (failure) throw failure
    },
  }
}

export async function demo() {
  const directory = mkdtempSync(join(tmpdir(), "crispctl-example-"))
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["PATH", "SYSTEMROOT", "WINDIR"].includes(key.toUpperCase()),
    ),
  )
  env.CRISPCTL_CONFIG = join(directory, "empty-config.json")
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.on("SIGINT", interrupt)
  process.on("SIGTERM", interrupt)
  let worker
  try {
    worker = await connectWorker({ env, signal: controller.signal })
    const responses = await Promise.all([
      worker.request(["auth", "show"]),
      worker.request(["auth", "show"]),
    ])
    if (responses.some((frame) => !frame.ok)) throw new Error("example request failed")
    await worker.close()
    // Log only the demonstration result, never profile values or raw diagnostics.
    process.stdout.write(
      JSON.stringify({ protocol: 1, read_only: true, responses: responses.length, closed: true }) +
        "\n",
    )
  } finally {
    try {
      await worker?.close()
    } finally {
      process.removeListener("SIGINT", interrupt)
      process.removeListener("SIGTERM", interrupt)
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  demo().catch(() => {
    process.stderr.write("stdio client example failed\n")
    process.exitCode = 1
  })
}
