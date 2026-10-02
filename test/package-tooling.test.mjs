import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import test from "node:test"

const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version
const fixture = "./test/fixtures/mock-published-smoke.mjs"
function smoke(mode, args = []) {
  const child = spawnSync(
    process.execPath,
    ["--import", fixture, "scripts/published-smoke.mjs", ...args],
    {
      encoding: "utf8",
      timeout: 5000,
      env: {
        ...process.env,
        PACKAGE_FIXTURE_MODE: mode,
        PACKAGE_FIXTURE_VERSION: version,
        CRISP_KEY: "fixture-secret",
        CRISPCTL_KEY: "fixture-secret",
      },
    },
  )
  assert.ifError(child.error)
  assert.equal(child.signal, null)
  assert.ok(!(child.stdout + child.stderr).includes("private"))
  assert.ok(!(child.stdout + child.stderr).includes("fixture-secret"))
  return child
}

test("published smoke validates successful installation with the default release version", () => {
  const child = smoke("valid")
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stderr, "")
  assert.deepEqual(child.stdout.trim().split("\n").map(JSON.parse), [
    { check: "registry-available", version, attempts: 1 },
    { check: "installed-package", version, events: 1, passed: true },
  ])
})

for (const mode of [
  "install-failure",
  "bin-failure",
  "wrong-version",
  "wrong-worker-protocol",
  "missing-option",
  "missing-pages-option",
  "pages-accepts-invalid",
  "invalid-json",
  "missing-event",
  "duplicate-event",
  "invalid-fields",
  "invalid-field-items",
  "inconsistent-catalog",
  "wrong-exit",
  "unexpected-stdout",
  "wrong-error",
  "spawn-failure",
]) {
  test(`published smoke fails safely for ${mode}`, () => {
    const child = smoke(mode, [version])
    assert.equal(child.status, 1)
    assert.equal(JSON.parse(child.stdout).check, "registry-available")
    const failure = JSON.parse(child.stderr)
    assert.equal(failure.passed, false)
    assert.match(failure.message, /installation or executable smoke failed/)
  })
}

test("published smoke rejects excess arguments before registry access", () => {
  const child = smoke("valid", [version, "extra"])
  assert.equal(child.status, 1)
  assert.equal(child.stdout, "")
  assert.match(JSON.parse(child.stderr).message, /usage:/)
})

for (const matches of [true, false]) {
  test(`local package smoke checks the full expected catalog (matches=${matches})`, () => {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        fixture,
        "--input-type=module",
        "-e",
        `
      import { installedPackageSmoke } from './scripts/installed-package-smoke.mjs'
      const expected = [{ event: ${JSON.stringify(matches ? "message:send" : "message:received")}, tiers: ['website'], scopes: ['read'] }]
      try { console.log(JSON.stringify(installedPackageSmoke('fixture.tgz', '0.4.0', expected))) }
      catch { process.exitCode = 1 }
    `,
      ],
      {
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, PACKAGE_FIXTURE_MODE: "valid", PACKAGE_FIXTURE_VERSION: "0.4.0" },
      },
    )
    assert.ifError(child.error)
    assert.equal(child.status, matches ? 0 : 1, child.stderr)
    assert.equal(child.stderr, "")
    if (matches) assert.equal(JSON.parse(child.stdout).passed, true)
    else assert.equal(child.stdout, "")
  })
}
