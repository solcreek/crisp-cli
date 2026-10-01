// Isolated preload for smoke-helper regression tests; never contacts op or Crisp.
import assert from "node:assert/strict"
import childProcess from "node:child_process"
import { EventEmitter, once } from "node:events"
import { syncBuiltinESMExports } from "node:module"
import { PassThrough } from "node:stream"

const websiteId = "smoke-fixture-website"
childProcess.execFileSync = (command, args) => {
  if (process.env.SMOKE_FIXTURE_OP_FAILURE === "1") {
    throw Object.assign(new Error("fixture-secret in error"), {
      stdout: "fixture-secret in partial stdout",
      stderr: "fixture-secret in stderr",
    })
  }
  assert.equal(command, "op")
  assert.deepEqual(
    args,
    process.env.SMOKE_FIXTURE_CUSTOM_ITEM === "1"
      ? ["item", "get", "Synthetic API Token", "--format", "json", "--vault", "Fixture Vault"]
      : ["item", "get", "Crisp API Credentials", "--format", "json"],
  )
  return JSON.stringify({
    fields: [
      {
        label:
          process.env.SMOKE_FIXTURE_CUSTOM_ITEM === "1" ? "token_identifier" : "API Identifier",
        value: "fixture-id",
      },
      {
        label: process.env.SMOKE_FIXTURE_CUSTOM_ITEM === "1" ? "token_key" : "API Key",
        value: "fixture-secret",
      },
      { label: "website_id", value: websiteId },
    ],
  })
}
globalThis.fetch = async (url) => {
  assert.equal(url, `https://api.crisp.chat/v1/website/${websiteId}`)
  return { ok: true, json: async () => ({ data: { name: "Smoke fixture" } }) }
}
childProcess.spawn = (_command, args, options) => {
  assert.ok(args.includes("--read-only"))
  assert.equal(options.env.CRISPCTL_READ_ONLY, "1")
  const child = new EventEmitter()
  child.kill = (signal) => {
    assert.equal(signal, "SIGTERM")
    return true
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  setImmediate(() => {
    // The process exits while its final stdout/stderr data is still pending.
    child.emit("exit", 0)
    setImmediate(async () => {
      const drained = Promise.all([once(child.stdout, "end"), once(child.stderr, "end")])
      if (process.env.SMOKE_FIXTURE_EVENT === "1") {
        const line = JSON.stringify({
          event: "session:update_availability",
          received_at: "2026-10-01T12:00:00.000Z",
          data: {
            website_id: websiteId,
            availability: "online",
            content: "private fixture content",
          },
        })
        child.stdout.write(line.slice(0, 20))
        child.stdout.write(`${line.slice(20)}\n`)
      }
      child.stderr.end(
        `${JSON.stringify(process.env.SMOKE_FIXTURE_AUTH === "0" ? { error: "unauthorized" } : { status: "authenticated" })}\n`,
      )
      child.stdout.end()
      await drained
      child.emit("close", 0)
    })
  })
  return child
}
syncBuiltinESMExports()
