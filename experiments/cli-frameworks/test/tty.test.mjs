import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
for (const adapter of process.env.POC_NODE20 ? ['ink-node20'] : ['ink', 'ink-node20']) {
  test(`${adapter}: actual PTY renders, responds to p, and exits on q`, () => {
    const result = spawnSync('python3', ['test/pty_probe.py', process.execPath, 'dist/main.js', adapter], { encoding: 'utf8', timeout: 12000 })
    assert.equal(result.status, 0, result.stderr)
    const value = JSON.parse(result.stdout)
    assert.equal(value.toggle, true); assert.equal(value.quit, true)
    assert.match(value.transcript, /LOCAL FIXTURE/)
  })
}
