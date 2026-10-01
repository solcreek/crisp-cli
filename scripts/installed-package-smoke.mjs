import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

/** @param {string} directory @returns {NodeJS.ProcessEnv} */
export function smokeEnvironment(directory) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^CRISP(?:CTL)?_/.test(key)),
  )
  env.CRISPCTL_CONFIG = join(directory, "no-credentials.json")
  return env
}

/**
 * @param {string} spec
 * @param {string} version
 * @param {ReadonlyArray<{event: string, tiers: readonly string[], scopes: readonly string[]}>} [expectedEvents]
 */
export function installedPackageSmoke(spec, version, expectedEvents) {
  const directory = mkdtempSync(join(tmpdir(), "crispctl-installed-"))
  const env = smokeEnvironment(directory)
  try {
    execFileSync(
      "npm",
      [
        "install",
        "--prefix",
        directory,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--registry=https://registry.npmjs.org",
        "--prefer-online",
        spec,
      ],
      { env, stdio: "pipe", timeout: 120_000 },
    )
    const bin = resolve(directory, "node_modules/.bin/crispctl")
    /** @param {string[]} args */
    const run = (args) =>
      execFileSync(bin, args, { cwd: directory, env, encoding: "utf8", timeout: 10_000 })
    assert.equal(run(["--version"]).trim(), version)
    assert.match(run(["--help"]), /listen/)
    const replyHelp = run(["reply", "--help"])
    for (const flag of ["--text", "--note", "--json", "--read-only"])
      assert.ok(replyHelp.includes(flag), flag)
    const events = JSON.parse(run(["listen", "--list-events", "--json"])).events
    assert.ok(Array.isArray(events) && events.some((entry) => entry.event === "message:send"))
    assert.ok(
      events.every(
        (entry) =>
          typeof entry.event === "string" &&
          isStringArray(entry.tiers) &&
          isStringArray(entry.scopes),
      ),
    )
    assert.equal(new Set(events.map((entry) => entry.event)).size, events.length)
    if (expectedEvents) assert.deepEqual(events, expectedEvents)
    assert.deepEqual(JSON.parse(run(["--list-events", "--json", "listen"])).events, events)
    const invalid = spawnSync(bin, ["unknown", "--json"], {
      cwd: directory,
      env,
      encoding: "utf8",
      timeout: 10_000,
    })
    assert.ifError(invalid.error)
    assert.equal(invalid.status, 2)
    assert.equal(invalid.stdout, "")
    assert.equal(JSON.parse(invalid.stderr).error, "usage")
    return { check: "installed-package", version, events: events.length, passed: true }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** @param {unknown} value */
function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}
