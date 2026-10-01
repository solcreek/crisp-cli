import assert from "node:assert/strict"
import test from "node:test"
import { run } from "../src/cli.js"
import { COMMAND_NOTES } from "../src/help.js"
import { buffers, credentialEnv, removeHome } from "./support.js"

for (const [path, notes] of Object.entries(COMMAND_NOTES)) {
  test(`documented command has complete generated help: ${path}`, async () => {
    const env = credentialEnv()
    try {
      for (const args of [
        [...path.split(" "), "--help"],
        ["help", ...path.split(" ")],
      ]) {
        const io = buffers()
        assert.equal(await run(args, { ...io, env }), 0)
        assert.ok(io.out().includes(`Usage: crispctl ${path}`))
        assert.ok(io.out().includes(notes.trim()))
        for (const option of ["--json", "--profile", "--read-only", "--website", "--help"])
          assert.ok(io.out().includes(option), option)
        assert.doesNotMatch(io.out(), /undefined|Unknown command/)
        assert.equal(io.err(), "")
      }
    } finally {
      removeHome(env)
    }
  })
}
