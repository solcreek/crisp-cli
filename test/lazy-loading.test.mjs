import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url))
test("cancellation during a cold HTTP import prevents dispatch", async () => {
  const home = mkdtempSync(join(tmpdir(), "crispctl-lazy-cancel-"))
  try {
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [
          "--import",
          path("./fixtures/deny-transports.mjs"),
          path("../dist/index.js"),
          "conversations",
          "list",
          "--json",
        ],
        {
          env: {
            HOME: home,
            CRISPCTL_TEST_FORBID_TRANSPORTS: "socket.io-client",
            CRISPCTL_TEST_CANCEL_IMPORT: "1",
            CRISPCTL_IDENTIFIER: "synthetic-identifier",
            CRISPCTL_KEY: "synthetic-key",
            CRISPCTL_TIER: "website",
            CRISPCTL_WEBSITE_ID: "benchmark-site",
          },
          timeout: 5000,
        },
      ),
      (error) => {
        assert.equal(error.code, 1)
        assert.equal(error.stdout, "")
        assert.equal(JSON.parse(error.stderr).error, "network_error")
        assert.doesNotMatch(error.stderr, /unexpected fetch/)
        return true
      },
    )
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("cold CLI help, config, catalog, validation and read-only rejection never import transports", async () => {
  const home = mkdtempSync(join(tmpdir(), "crispctl-lazy-"))
  const cases = [
    [["--help"], 0],
    [["--version"], 0],
    [["conversations", "pages", "--help"], 0],
    [["auth", "show", "--json"], 0],
    [["listen", "--list-events", "--json"], 0],
    [["conversations", "pages", "fixture-session", "--page", "0", "--json"], 2],
    [["listen", "--events", "invalid", "--json"], 2],
    [["reply", "fixture-session", "--text", "synthetic", "--read-only", "--json"], 2],
    [["unknown", "--json"], 2],
  ]
  try {
    for (const [args, code] of cases) {
      const result = await promisify(execFile)(
        process.execPath,
        ["--import", path("./fixtures/deny-transports.mjs"), path("../dist/index.js"), ...args],
        {
          env: { HOME: home, CRISPCTL_TEST_FORBID_TRANSPORTS: "undici,socket.io-client" },
          timeout: 5000,
        },
      ).then(
        (value) => ({ ...value, code: 0 }),
        (error) => error,
      )
      assert.equal(result.code, code, `${args.join(" ")}: ${result.stderr}`)
      if (code === 2) assert.equal(JSON.parse(result.stderr).error, "usage")
      else assert.equal(result.stderr, "")
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("a cold REST request loads HTTP without Socket.IO", async () => {
  const home = mkdtempSync(join(tmpdir(), "crispctl-lazy-rest-"))
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        path("./fixtures/deny-transports.mjs"),
        "--import",
        path("../scripts/fixtures/benchmark-api.mjs"),
        path("../dist/index.js"),
        "conversations",
        "list",
        "--json",
      ],
      {
        env: {
          HOME: home,
          CRISPCTL_TEST_FORBID_TRANSPORTS: "socket.io-client",
          CRISPCTL_IDENTIFIER: "synthetic-identifier",
          CRISPCTL_KEY: "synthetic-key",
          CRISPCTL_TIER: "website",
          CRISPCTL_WEBSITE_ID: "benchmark-site",
        },
        timeout: 5000,
      },
    )
    assert.equal(stderr, "")
    assert.equal(JSON.parse(stdout)[0].session_id, "benchmark-session-0")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
