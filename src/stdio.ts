import type { Readable } from "node:stream"
import type { Dispatcher } from "undici"
import type { Flags } from "./args.js"
import { websiteOverride } from "./args.js"
import { run } from "./cli.js"
import { createCommandTree } from "./command-tree.js"
import { InvocationCredentials } from "./invocation-credentials.js"
import { jsonRedactor } from "./redact.js"
import { version } from "./version.js"
import { parseMessage, PROTOCOL_VERSION, WORKER_COMMANDS, WORKER_LIMITS } from "./stdio-protocol.js"

type Options = {
  input: Readable
  write: (text: string) => void
  flush: () => Promise<void>
  env: NodeJS.ProcessEnv
  flags: Flags
  signal: AbortSignal
  dispatcher?: Dispatcher
}
type Job = {
  id: string
  argv: string[]
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  reason?: "cancelled" | "deadline_exceeded"
  started: boolean
}

// The process owns signals/stdio; requests own only their output and cancellation.
export async function serve(options: Options): Promise<number> {
  const { input, signal } = options
  const readOnly = options.flags.readOnly || options.env.CRISPCTL_READ_ONLY === "1"
  const env = { ...options.env }
  if (readOnly) env.CRISPCTL_READ_ONLY = "1"
  if (options.flags.profile !== undefined) env.CRISPCTL_PROFILE = options.flags.profile
  const website = websiteOverride(options.flags)
  if (website) env.CRISPCTL_WEBSITE_ID = website
  // A worker owns its pool. Never destroy an injected dispatcher owned by a caller.
  const owned = options.dispatcher
    ? undefined
    : new (await import("undici")).Agent({ connections: WORKER_LIMITS.concurrency })
  const dispatcher = options.dispatcher ?? owned
  const jobs = new Map<string, Job>()
  const queue: Job[] = []
  let active = 0
  let accepting = true
  let failed = false
  let pending = Buffer.alloc(0)
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const emit = (frame: object) =>
    options.write(`${JSON.stringify({ protocol: PROTOCOL_VERSION, ...frame })}\n`)
  const error = (id: string, name: string, code = 1) => ({
    type: "response",
    id,
    ok: false,
    code,
    error: { ok: false, error: name, message: name },
  })
  const settle = () => {
    if (!accepting && jobs.size === 0) resolveDone()
  }

  function stop(): void {
    accepting = false
    input.pause()
    pending = Buffer.alloc(0)
    for (const job of jobs.values()) cancel(job, "cancelled")
    settle()
  }
  function fatal(name: string): void {
    if (!accepting) return
    failed = true
    emit({ type: "error", error: name })
    stop()
  }
  async function respond(job: Job, frame: object): Promise<void> {
    clearTimeout(job.timer)
    try {
      emit(frame)
      // Retain the slot and ID until bytes drain: a slow consumer bounds execution.
      await options.flush()
    } catch {
      failed = true
      stop()
    } finally {
      jobs.delete(job.id)
      settle()
    }
  }
  function cancel(job: Job, reason: Job["reason"]): void {
    if (job.reason) return
    job.reason = reason
    job.controller.abort()
    if (!job.started) {
      queue.splice(queue.indexOf(job), 1)
      job.started = true
      void respond(job, error(job.id, reason!))
    }
  }
  async function execute(job: Job): Promise<void> {
    let out = ""
    let err = ""
    let bytes = 0
    let overflow = false
    const argv = ["--json", ...job.argv]
    const credentials = new InvocationCredentials(env, argv)
    const tree = createCommandTree()
    const capture = (chunk: string, stderr: boolean) => {
      bytes += Buffer.byteLength(chunk)
      if (bytes > WORKER_LIMITS.responseBytes) {
        overflow = true
        job.controller.abort()
        throw new Error("response_too_large")
      }
      if (stderr) err += chunk
      else out += chunk
    }
    let frame: object
    try {
      // The same parser identifies supported finite commands; run() handles errors.
      let supported = true
      try {
        const parsed = tree.prepare(argv)
        supported =
          !parsed.flags.help &&
          !parsed.flags.version &&
          WORKER_COMMANDS.some(
            (command) =>
              command === parsed.positionals.slice(0, command.split(" ").length).join(" "),
          )
      } catch {
        /* run() emits the normal redacted parser diagnostic. */
      }
      if (!supported) {
        frame = error(job.id, "unsupported_command", 2)
      } else {
        const code = await run(argv, {
          env,
          credentials,
          dispatcher,
          signal: job.controller.signal,
          stdout: (chunk) => capture(chunk, false),
          stderr: (chunk) => capture(chunk, true),
        })
        const secrets = credentials.diagnosticSecrets(tree.flags())
        const payload = JSON.parse(
          JSON.stringify(JSON.parse(code === 0 ? out : err), jsonRedactor(secrets)),
        )
        frame =
          code === 0
            ? { type: "response", id: job.id, ok: true, code, result: payload }
            : { type: "response", id: job.id, ok: false, code, error: payload }
        // Structured redaction also protects success payloads echoed by a remote API.
        if (
          Buffer.byteLength(JSON.stringify({ protocol: PROTOCOL_VERSION, ...frame })) + 1 >
          WORKER_LIMITS.responseBytes
        )
          overflow = true
      }
    } catch {
      frame = error(job.id, "request_failed")
    }
    if (overflow) frame = error(job.id, "response_too_large")
    else if (job.reason) frame = error(job.id, job.reason)
    await respond(job, frame)
  }
  function pump(): void {
    while (accepting && active < WORKER_LIMITS.concurrency && queue.length) {
      const job = queue.shift()!
      job.started = true
      active++
      void execute(job).finally(() => {
        active--
        pump()
      })
    }
  }
  function receive(line: Buffer): void {
    let message
    try {
      message = parseMessage(line)
    } catch {
      fatal("invalid_frame")
      return
    }
    if (message.type === "shutdown") {
      stop()
      return
    }
    if (message.type === "cancel") {
      const job = jobs.get(message.id)
      if (job) cancel(job, "cancelled")
      return
    }
    if (jobs.has(message.id)) {
      fatal("duplicate_id")
      return
    }
    if (jobs.size >= WORKER_LIMITS.concurrency + WORKER_LIMITS.queue) {
      emit(error(message.id, "busy"))
      return
    }
    const job: Job = {
      id: message.id,
      argv: message.argv,
      controller: new AbortController(),
      started: false,
      timer: setTimeout(
        () => cancel(job, "deadline_exceeded"),
        message.timeout_ms ?? WORKER_LIMITS.defaultTimeoutMs,
      ),
    }
    jobs.set(job.id, job)
    queue.push(job)
    pump()
  }
  function data(chunk: Buffer | string): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    let start = 0
    while (accepting && start < buffer.length) {
      const newline = buffer.indexOf(10, start)
      const end = newline < 0 ? buffer.length : newline
      if (pending.length + end - start > WORKER_LIMITS.requestBytes) {
        fatal("request_too_large")
        return
      }
      pending = Buffer.concat([pending, buffer.subarray(start, end)])
      if (newline < 0) return
      const line = pending
      pending = Buffer.alloc(0)
      receive(line)
      start = newline + 1
    }
  }
  const end = () => {
    if (pending.length) fatal("truncated_frame")
    else stop()
  }
  const inputError = () => fatal("input_error")
  const closed = () => {
    if (accepting) stop()
  }
  try {
    signal.addEventListener("abort", stop, { once: true })
    if (signal.aborted || input.destroyed || input.readableEnded) stop()
    if (accepting) {
      emit({
        type: "ready",
        version,
        capabilities: {
          commands: WORKER_COMMANDS,
          cancellation: true,
          read_only: readOnly,
          retries: false,
        },
        limits: WORKER_LIMITS,
      })
      await options.flush()
      if (accepting) {
        input.on("data", data).once("end", end).once("error", inputError).once("close", closed)
        input.resume()
      }
    }
    await done
    if (!signal.aborted && !failed) emit({ type: "bye" })
    await options.flush()
  } catch {
    failed = true
    stop()
    await done
  } finally {
    input.pause()
    input
      .removeListener("data", data)
      .removeListener("end", end)
      .removeListener("error", inputError)
      .removeListener("close", closed)
    signal.removeEventListener("abort", stop)
    await owned?.destroy()
  }
  return failed ? 1 : 0
}
