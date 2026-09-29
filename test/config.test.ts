import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  assertComplete,
  configFilePath,
  loadConfig,
  publicProfileView,
  resolveCredentials,
  saveConfig,
} from "../src/config.js"
import { ConfigError } from "../src/errors.js"
import { redactSecrets } from "../src/redact.js"

function homeEnv(): { env: NodeJS.ProcessEnv; cleanup: () => void } {
  const home = mkdtempSync(join(tmpdir(), "crispctl-cfg-"))
  return {
    env: { HOME: home },
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  }
}

test("config path honors CRISPCTL_CONFIG, XDG_CONFIG_HOME, then HOME", () => {
  assert.equal(configFilePath({ CRISPCTL_CONFIG: "/tmp/explicit.json", HOME: "/home/ignored" }), "/tmp/explicit.json")
  assert.equal(
    configFilePath({ XDG_CONFIG_HOME: "/tmp/xdg", HOME: "/home/ignored" }),
    "/tmp/xdg/crispctl/config.json",
  )
  assert.equal(configFilePath({ HOME: "/home/ada" }), "/home/ada/.config/crispctl/config.json")
})

test("saveConfig writes mode 0600 and a 0700 directory", () => {
  const { env, cleanup } = homeEnv()
  try {
    saveConfig(env, {
      current: "sandbox",
      profiles: {
        sandbox: {
          identifier: "id-sandbox",
          key: "sandbox-token-key",
          tier: "website",
          website_id: "website-sandbox",
        },
      },
    })
    const path = configFilePath(env)
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.equal(statSync(join(env.HOME ?? "", ".config", "crispctl")).mode & 0o777, 0o700)
    const stored = JSON.parse(readFileSync(path, "utf8")) as { current: string; profiles: { sandbox: { key: string } } }
    assert.equal(stored.current, "sandbox")
    assert.equal(stored.profiles.sandbox.key, "sandbox-token-key")
  } finally {
    cleanup()
  }
})

test("loadConfig rejects invalid documents", () => {
  const { env, cleanup } = homeEnv()
  try {
    const path = join(env.HOME ?? "", "broken.json")
    env.CRISPCTL_CONFIG = path
    mkdirSync(env.HOME ?? "", { recursive: true })
    writeFileSync(path, "{", { mode: 0o600 })
    assert.throws(() => loadConfig(env), (err: unknown) => err instanceof ConfigError && /valid JSON/.test(err.message))

    writeFileSync(path, "[]", { mode: 0o600 })
    assert.throws(() => loadConfig(env), /JSON object/)

    writeFileSync(path, JSON.stringify({ profiles: [] }), { mode: 0o600 })
    assert.throws(() => loadConfig(env), /profiles must be an object/)

    writeFileSync(path, JSON.stringify({ profiles: { "../x": {} } }), { mode: 0o600 })
    assert.throws(() => loadConfig(env), /invalid profile name/)

    writeFileSync(path, JSON.stringify({
      profiles: { sandbox: { identifier: "a", key: "b", tier: "user", website_id: "c" } },
    }), { mode: 0o600 })
    assert.throws(() => loadConfig(env), /tier must be website or plugin/)

    writeFileSync(path, JSON.stringify({
      profiles: { sandbox: { identifier: "a", key: "", tier: "plugin", website_id: "c" } },
    }), { mode: 0o600 })
    assert.throws(() => loadConfig(env), /missing key/)

    writeFileSync(path, JSON.stringify({ current: "" }), { mode: 0o600 })
    assert.throws(() => loadConfig(env), /current profile/)

    writeFileSync(path, JSON.stringify({ profiles: { sandbox: "nope" } }), { mode: 0o600 })
    assert.throws(() => loadConfig(env), /must be an object/)

    writeFileSync(path, "   ", { mode: 0o600 })
    assert.deepEqual(loadConfig(env), { profiles: {} })
  } finally {
    cleanup()
  }
})

test("env overrides file and CRISPCTL_* wins over CRISP_*", () => {
  const { env, cleanup } = homeEnv()
  try {
    saveConfig(env, {
      current: "default",
      profiles: {
        default: {
          identifier: "file-id",
          key: "file-token-key",
          tier: "plugin",
          website_id: "file-website",
        },
        sandbox: {
          identifier: "sandbox-id",
          key: "sandbox-token-key",
          tier: "website",
          website_id: "sandbox-website",
        },
      },
    })
    const fromFile = resolveCredentials(env, {})
    assert.equal(fromFile.profile, "default")
    assert.equal(fromFile.identifier, "file-id")
    assert.equal(fromFile.sources.identifier, "file")
    assert.equal(fromFile.sources.key, "file")

    env.CRISP_IDENTIFIER = "crisp-id"
    env.CRISP_KEY = "crisp-token-key"
    env.CRISP_WEBSITE_ID = "crisp-website"
    env.CRISP_TIER = "website"
    const fromCrisp = resolveCredentials(env, {})
    assert.equal(fromCrisp.identifier, "crisp-id")
    assert.equal(fromCrisp.key, "crisp-token-key")
    assert.equal(fromCrisp.websiteId, "crisp-website")
    assert.equal(fromCrisp.tier, "website")
    assert.equal(fromCrisp.sources.tier, "env")

    env.CRISPCTL_IDENTIFIER = "ctl-id"
    env.CRISPCTL_KEY = "ctl-token-key"
    env.CRISPCTL_WEBSITE_ID = "ctl-website"
    env.CRISPCTL_TIER = "plugin"
    env.CRISPCTL_PROFILE = "sandbox"
    const fromCtl = resolveCredentials(env, { website: "flag-website" })
    assert.equal(fromCtl.profile, "sandbox")
    assert.equal(fromCtl.identifier, "ctl-id")
    assert.equal(fromCtl.key, "ctl-token-key")
    assert.equal(fromCtl.tier, "plugin")
    assert.equal(fromCtl.websiteId, "flag-website")
    assert.equal(fromCtl.sources.websiteId, "flag")
    assert.equal(fromCtl.sources.identifier, "env")

    const view = publicProfileView(fromCtl)
    assert.equal(view.key, "set")
    assert.equal(JSON.stringify(view).includes("ctl-token-key"), false)
    assertComplete(fromCtl)
  } finally {
    cleanup()
  }
})

test("missing credentials and invalid tier are config errors", () => {
  const creds = resolveCredentials({ HOME: "/does/not/matter" }, {}, { profiles: {} })
  assert.throws(() => assertComplete(creds), /missing credentials: identifier, key, tier, website_id/)
  assert.throws(() => resolveCredentials({ CRISP_TIER: "user" }, {}, { profiles: {} }), /tier must be website or plugin/)
  assert.equal(publicProfileView(creds).key, "missing")
  assert.equal(publicProfileView(creds).tier, null)
})

test("unreadable config directory surfaces a config error without the key", () => {
  const root = mkdtempSync(join(tmpdir(), "crispctl-ro-"))
  try {
    const blocked = join(root, "blocked")
    mkdirSync(blocked)
    chmodSync(blocked, 0o500)
    const env = {
      CRISPCTL_CONFIG: join(blocked, "nested", "config.json"),
    }
    assert.throws(() => saveConfig(env, { profiles: {} }), (err: unknown) => {
      assert.ok(err instanceof ConfigError)
      assert.match(err.message, /could not write config file/)
      return true
    })
  } finally {
    chmodSync(join(root, "blocked"), 0o700)
    rmSync(root, { recursive: true, force: true })
  }
})

test("redactSecrets replaces every non-empty secret", () => {
  assert.equal(redactSecrets("token fixture-token-key-do-not-log end", ["fixture-token-key-do-not-log"]), "token [redacted] end")
  assert.equal(redactSecrets("abc abc", ["abc"]), "[redacted] [redacted]")
  assert.equal(redactSecrets("ab", ["a", "ab"]), "[redacted]")
  assert.equal(redactSecrets("a.b aXb", ["a.b"]), "[redacted] aXb")
  assert.equal(redactSecrets("plain", [undefined, ""]), "plain")
})

test("saveConfig does not chmod an existing parent of CRISPCTL_CONFIG", () => {
  const root = mkdtempSync(join(tmpdir(), "crispctl-parent-"))
  try {
    const parent = join(root, "parent")
    mkdirSync(parent)
    chmodSync(parent, 0o755)
    saveConfig({ CRISPCTL_CONFIG: join(parent, "explicit.json") }, { profiles: {} })
    assert.equal(statSync(parent).mode & 0o777, 0o755)
    assert.equal(statSync(join(parent, "explicit.json")).mode & 0o777, 0o600)

    const kept = join(root, "kept")
    mkdirSync(kept)
    chmodSync(kept, 0o755)
    saveConfig({ CRISPCTL_CONFIG: join(kept, "a", "b", "config.json") }, { profiles: {} })
    assert.equal(statSync(kept).mode & 0o777, 0o755)
    assert.equal(statSync(join(kept, "a")).mode & 0o777, 0o700)
    assert.equal(statSync(join(kept, "a", "b")).mode & 0o777, 0o700)
    assert.equal(statSync(join(kept, "a", "b", "config.json")).mode & 0o777, 0o600)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
