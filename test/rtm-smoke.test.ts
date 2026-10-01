import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

function smoke(withEvent: boolean, mode = "event", authenticated = true) {
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      fileURLToPath(new URL("./fixtures/mock-smoke-child.mjs", import.meta.url)),
      fileURLToPath(new URL("../scripts/rtm-smoke.mjs", import.meta.url)),
      "Smoke fixture",
      mode,
    ],
    {
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        SMOKE_FIXTURE_EVENT: withEvent ? "1" : "0",
        SMOKE_FIXTURE_AUTH: authenticated ? "1" : "0",
      },
    },
  )
  assert.ifError(child.error)
  assert.equal(child.signal, null)
  assert.equal(child.stderr, "")
  assert.ok(!child.stdout.includes("fixture-secret"))
  assert.ok(!child.stdout.includes("private fixture content"))
  return {
    code: child.status,
    checks: child.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  }
}

test("smoke waits for stdout after process exit before reporting success", () => {
  const { code, checks } = smoke(true)
  assert.equal(code, 0)
  assert.deepEqual(
    checks.map((check) => check.check),
    ["website", "event", "status", "result"],
  )
  assert.deepEqual(checks.at(-1), {
    check: "result",
    mode: "event",
    authenticated: true,
    exit_code: 0,
    received_events: 1,
  })
})

test("smoke still fails when streams close without a website event", () => {
  const { code, checks } = smoke(false)
  assert.equal(code, 1)
  assert.deepEqual(
    checks.map((check) => check.check),
    ["website", "status", "result"],
  )
  assert.deepEqual(checks.at(-1), {
    check: "result",
    mode: "event",
    authenticated: true,
    exit_code: 0,
    received_events: 0,
  })
})

test("auth-only smoke succeeds on a quiet website without claiming event delivery", () => {
  const { code, checks } = smoke(false, "auth")
  assert.equal(code, 0)
  assert.deepEqual(checks.at(-1), {
    check: "result",
    mode: "auth",
    authenticated: true,
    exit_code: 0,
    received_events: 0,
  })
})

test("neither smoke mode accepts an unauthenticated connection", () => {
  for (const mode of ["auth", "event"]) {
    const { code, checks } = smoke(true, mode, false)
    assert.equal(code, 1)
    assert.equal(checks.at(-1).authenticated, false)
  }
})

test("credential lookup failures never print captured credential output", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      fileURLToPath(new URL("./fixtures/mock-smoke-child.mjs", import.meta.url)),
      fileURLToPath(new URL("../scripts/rtm-smoke.mjs", import.meta.url)),
      "Smoke fixture",
    ],
    { encoding: "utf8", timeout: 5000, env: { ...process.env, SMOKE_FIXTURE_OP_FAILURE: "1" } },
  )
  assert.equal(child.status, 1)
  assert.match(child.stderr, /1Password credential lookup failed or timed out/)
  assert.doesNotMatch(`${child.stdout}${child.stderr}`, /fixture-secret/)
})
