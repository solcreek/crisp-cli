import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { credentialEnv, removeHome } from "./support.js"

for (const mode of ["mismatch", "auth-failure"]) {
  test(`live write harness ${mode} preserves website guard and cleans up only its own session`, () => {
    const env = credentialEnv({
      LIVE_GUARD_MODE: mode,
      CRISPCTL_LIVE: "1",
      CRISPCTL_LIVE_WRITE: "1",
      CRISPCTL_LIVE_WEBSITE_NAME: "Fixture sandbox",
      CRISPCTL_IDENTIFIER: "fixture-identifier",
      CRISPCTL_KEY: "fixture-key",
      CRISPCTL_TIER: "website",
      CRISPCTL_WEBSITE_ID: "fixture-website",
    })
    try {
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--import",
          fileURLToPath(new URL("./fixtures/live-write-guard.mjs", import.meta.url)),
          fileURLToPath(new URL("./live/sandbox-write.test.ts", import.meta.url)),
        ],
        { env, encoding: "utf8", timeout: 10_000 },
      )
      assert.ifError(child.error)
      assert.equal(child.signal, null)
      assert.equal(child.status, 1)
      assert.match(child.stdout, /live-guard-contract-passed/)
      assert.match(
        child.stdout,
        mode === "mismatch" ? /sandbox identity must match/ : /invalid_session/,
      )
      assert.doesNotMatch(child.stdout + child.stderr, /fixture-key/)
    } finally {
      removeHome(env)
    }
  })
}
