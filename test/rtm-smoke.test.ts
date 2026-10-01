import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

function smoke(withEvent: boolean) {
  const child = spawnSync(process.execPath, [
    "--import", fileURLToPath(new URL("./fixtures/mock-smoke-child.mjs", import.meta.url)),
    fileURLToPath(new URL("../scripts/rtm-smoke.mjs", import.meta.url)),
    "Smoke fixture",
  ], { encoding: "utf8", timeout: 5000, env: { ...process.env, SMOKE_FIXTURE_EVENT: withEvent ? "1" : "0" } })
  assert.ifError(child.error)
  assert.equal(child.signal, null)
  assert.equal(child.stderr, "")
  assert.ok(!child.stdout.includes("fixture-secret"))
  assert.ok(!child.stdout.includes("private fixture content"))
  return { code: child.status, checks: child.stdout.trim().split("\n").map(line => JSON.parse(line)) }
}

test("smoke waits for stdout after process exit before reporting success", () => {
  const { code, checks } = smoke(true)
  assert.equal(code, 0)
  assert.deepEqual(checks.map(check => check.check), ["website", "event", "status", "result"])
  assert.deepEqual(checks.at(-1), { check: "result", exit_code: 0, received_events: 1 })
})

test("smoke still fails when streams close without a website event", () => {
  const { code, checks } = smoke(false)
  assert.equal(code, 1)
  assert.deepEqual(checks.map(check => check.check), ["website", "status", "result"])
  assert.deepEqual(checks.at(-1), { check: "result", exit_code: 0, received_events: 0 })
})
