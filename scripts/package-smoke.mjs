import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { RTM_EVENTS } from "../dist/rtm-events.js"

const root = fileURLToPath(new URL("../", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const temp = mkdtempSync(join(tmpdir(), "crispctl-package-"))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^CRISP(?:CTL)?_/.test(key)))
env.CRISPCTL_CONFIG = join(temp, "no-credentials.json")
try {
  const [packed] = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], { cwd: root, env, encoding: "utf8" }))
  assert.equal(packed.version, pkg.version)
  for (const required of ["dist/index.js", "dist/rtm-events.js", "docs/rtm-coverage.md", "CHANGELOG.md", "LICENSE"]) {
    assert.ok(packed.files.some(file => file.path === required), `missing packaged file: ${required}`)
  }
  assert.ok(packed.files.every(file => !/^(src|test|scripts|\.github)\//.test(file.path)), "package contains development files")
  execFileSync("npm", ["install", "--prefix", temp, "--ignore-scripts", "--no-audit", "--no-fund", join(temp, packed.filename)], { env, stdio: "pipe", timeout: 120_000 })
  const bin = resolve(temp, "node_modules/.bin/crispctl")
  const run = args => execFileSync(bin, args, { cwd: temp, env, encoding: "utf8", timeout: 10_000 })
  assert.equal(run(["--version"]).trim(), pkg.version)
  assert.match(run(["--help"]), /listen/)
  assert.deepEqual(JSON.parse(run(["listen", "--list-events", "--json"])).events, RTM_EVENTS)
  const invalid = spawnSync(bin, ["unknown", "--json"], { cwd: temp, env, encoding: "utf8", timeout: 10_000 })
  assert.equal(invalid.status, 2)
  assert.equal(invalid.stdout, "")
  assert.equal(JSON.parse(invalid.stderr).error, "usage")
  console.log(JSON.stringify({ check: "installed-package", version: pkg.version, events: RTM_EVENTS.length, passed: true }))
} finally {
  rmSync(temp, { recursive: true, force: true })
}
