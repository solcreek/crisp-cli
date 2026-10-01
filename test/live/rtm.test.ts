import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const enabled = process.env.CRISPCTL_LIVE_RTM === "1"
const mode = process.env.CRISPCTL_LIVE_RTM_MODE ?? "event"

test(
  `live RTM ${mode} smoke using 1Password credentials`,
  {
    skip: enabled ? false : "set CRISPCTL_LIVE_RTM=1 and CRISPCTL_LIVE_WEBSITE_NAME to opt in",
    timeout: 160_000,
  },
  async () => {
    const name = process.env.CRISPCTL_LIVE_WEBSITE_NAME
    assert.ok(name, "CRISPCTL_LIVE_WEBSITE_NAME must name the explicitly authorized website")
    assert.ok(["auth", "event"].includes(mode), "CRISPCTL_LIVE_RTM_MODE must be auth or event")
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("../../scripts/rtm-smoke.mjs", import.meta.url)), name, mode],
      { timeout: 150_000, maxBuffer: 64 * 1024 },
    )
    const checks = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert.ok(
      checks.some(
        (value) => value.check === "website" && value.name === name && value.read_only === true,
      ),
    )
    assert.ok(checks.some((value) => value.check === "status" && value.status === "authenticated"))
    if (mode === "event")
      assert.ok(
        checks.some(
          (value) =>
            value.check === "event" &&
            value.website_matches === true &&
            value.customer_content_printed === false,
        ),
      )
    assert.ok(
      checks.some(
        (value) =>
          value.check === "result" &&
          value.mode === mode &&
          value.authenticated === true &&
          value.exit_code === 0 &&
          (mode === "auth" || value.received_events > 0),
      ),
    )
    // The helper emits only metadata, never message content or credentials.
    process.stdout.write(stdout)
  },
)
