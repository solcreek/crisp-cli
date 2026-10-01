// Fault injection is isolated in a subprocess to avoid changing other tests' fs.
import assert from "node:assert/strict"
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig, saveConfig } from "../../dist/config.js"

const directory = fs.mkdtempSync(join(tmpdir(), "crispctl-config-fault-"))
const path = join(directory, "config.json")
const env = { CRISPCTL_CONFIG: path }
const original = { profiles: {} }
const mode = process.argv[2]
const read = fs.readFileSync
const rename = fs.renameSync
const unlink = fs.unlinkSync
let cleanupAttempted = false
try {
  saveConfig(env, original)
  if (mode === "read") {
    fs.readFileSync = () => {
      throw new Error("fixture-secret read error")
    }
    syncBuiltinESMExports()
    assert.throws(() => loadConfig(env), {
      name: "ConfigError",
      message: "could not read config file",
    })
  } else {
    fs.renameSync = () => {
      throw new Error("fixture-secret rename error")
    }
    fs.unlinkSync = (target) => {
      cleanupAttempted = true
      if (mode === "cleanup") throw new Error("fixture-secret cleanup error")
      return unlink(target)
    }
    syncBuiltinESMExports()
    assert.throws(() => saveConfig(env, { profiles: {}, current: "changed" }), {
      name: "ConfigError",
      message: "could not write config file",
    })
    assert.equal(cleanupAttempted, true)
    assert.deepEqual(JSON.parse(read(path, "utf8")), original)
    assert.equal(fs.existsSync(`${path}.${process.pid}.tmp`), mode === "cleanup")
    assert.equal(fs.statSync(path).mode & 0o777, 0o600)
  }
} finally {
  Object.assign(fs, { readFileSync: read, renameSync: rename, unlinkSync: unlink })
  syncBuiltinESMExports()
  fs.rmSync(directory, { recursive: true, force: true })
}
