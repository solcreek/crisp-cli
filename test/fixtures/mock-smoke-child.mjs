// Isolated preload for smoke-helper regression tests; never contacts op or Crisp.
import assert from "node:assert/strict"
import childProcess from "node:child_process"
import { EventEmitter, once } from "node:events"
import { syncBuiltinESMExports } from "node:module"
import { PassThrough } from "node:stream"

const websiteId = "smoke-fixture-website"
childProcess.execFileSync = (command, args) => {
  assert.equal(command, "op")
  assert.deepEqual(args, ["item", "get", "Crisp API Credentials", "--format", "json"])
  return JSON.stringify({ fields: [
    { label: "API Identifier", value: "fixture-id" },
    { label: "API Key", value: "fixture-secret" },
    { label: "website_id", value: websiteId },
  ] })
}
globalThis.fetch = async url => {
  assert.equal(url, `https://api.crisp.chat/v1/website/${websiteId}`)
  return { ok: true, json: async () => ({ data: { name: "Smoke fixture" } }) }
}
childProcess.spawn = (_command, args, options) => {
  assert.ok(args.includes("--read-only"))
  assert.equal(options.env.CRISPCTL_READ_ONLY, "1")
  const child = new EventEmitter()
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
          data: { website_id: websiteId, availability: "online", content: "private fixture content" },
        })
        child.stdout.write(line.slice(0, 20))
        child.stdout.write(`${line.slice(20)}\n`)
      }
      child.stderr.end(`${JSON.stringify({ status: "authenticated" })}\n`)
      child.stdout.end()
      await drained
      child.emit("close", 0)
    })
  })
  return child
}
syncBuiltinESMExports()
