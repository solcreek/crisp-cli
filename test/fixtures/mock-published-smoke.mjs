import assert from "node:assert/strict"
import childProcess from "node:child_process"
import { existsSync } from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import { join } from "node:path"

const mode = process.env.PACKAGE_FIXTURE_MODE ?? "install-failure"
const version = process.env.PACKAGE_FIXTURE_VERSION ?? "0.4.0"
const events = [{ event: "message:send", tiers: ["website"], scopes: ["read"] }]
let directory
process.once("exit", () => {
  if (directory)
    assert.equal(existsSync(directory), false, "smoke must remove its temporary install")
})
globalThis.fetch = async () => new Response(JSON.stringify({ name: "crispctl", version }))
childProcess.execFileSync = (command, args, options) => {
  if (command === "npm") {
    assert.equal(args[0], "install")
    directory = args[args.indexOf("--prefix") + 1]
    assert.ok(args.includes("--ignore-scripts"))
    assert.ok(args.includes("--registry=https://registry.npmjs.org"))
    assert.ok(
      Object.keys(options.env)
        .filter((key) => /^CRISP(?:CTL)?_/.test(key))
        .every((key) => key === "CRISPCTL_CONFIG"),
    )
    assert.equal(options.env.CRISPCTL_CONFIG, join(directory, "no-credentials.json"))
    if (mode === "install-failure") throw new Error("private npm output")
    return ""
  }
  if (command === process.execPath) {
    assert.equal(args[0], join(directory, "node_modules/crispctl/examples/stdio-client.mjs"))
    return JSON.stringify({
      protocol: 1,
      read_only: true,
      responses: 2,
      closed: mode !== "bad-example",
    })
  }
  assert.equal(command, join(directory, "node_modules/.bin/crispctl"))
  if (mode === "bin-failure") throw new Error("private executable output")
  if (args[0] === "--version") return mode === "wrong-version" ? "9.9.9\n" : `${version}\n`
  if (args[0] === "--help") return "listen\n"
  if (args[0] === "serve")
    return (
      JSON.stringify({
        protocol: mode === "wrong-worker-protocol" ? 2 : 1,
        type: "ready",
        capabilities: { read_only: true },
      }) + '\n{"protocol":1,"type":"bye"}\n'
    )
  if (args[0] === "reply")
    return mode === "missing-option" ? "--text\n" : "--text --note --json --read-only\n"
  if (args[0] === "conversations")
    return mode === "missing-pages-option" ? "<session>" : "<session> --page --json --read-only"
  if (mode === "invalid-json") return "{bad JSON"
  const catalog =
    mode === "missing-event"
      ? []
      : mode === "duplicate-event"
        ? [...events, ...events]
        : mode === "invalid-fields"
          ? [{ ...events[0], scopes: "read" }]
          : mode === "invalid-field-items"
            ? [{ ...events[0], tiers: [1] }]
            : mode === "inconsistent-catalog" && args[0] === "--list-events"
              ? []
              : events
  return JSON.stringify({ events: catalog })
}
childProcess.spawnSync = (command, args) => {
  assert.equal(command, join(directory, "node_modules/.bin/crispctl"))
  return {
    status:
      mode === "wrong-exit" || (mode === "pages-accepts-invalid" && args[0] === "conversations")
        ? 0
        : 2,
    stdout: mode === "unexpected-stdout" ? "private executable output" : "",
    stderr: JSON.stringify({ error: mode === "wrong-error" ? "config" : "usage" }),
    error: mode === "spawn-failure" ? new Error("private spawn output") : undefined,
  }
}
syncBuiltinESMExports()
