import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { credentialEnv, removeHome } from "./support.js"

test("run defaults write successful output to stdout and usage errors to stderr", () => {
  const env = credentialEnv({ NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE })
  try {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `
      import { run } from './src/cli.ts'
      const success = await run(['--version'])
      const failure = await run(['unknown', '--json'])
      process.exitCode = success === 0 && failure === 2 ? 0 : 1
      `,
      ],
      { env, encoding: "utf8", timeout: 5000 },
    )
    assert.ifError(child.error)
    assert.equal(child.status, 0)
    assert.match(child.stdout, /^\d+\.\d+\.\d+\n$/)
    assert.equal(JSON.parse(child.stderr).error, "usage")
  } finally {
    removeHome(env)
  }
})
