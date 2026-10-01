import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import { createDispatch } from '../dist/common.js'

const adapters = process.env.POC_NODE20 ? ['commander-node20', 'ink-node20'] : ['commander', 'crust', 'ink', 'commander-node20', 'ink-node20']
const invoke = (adapter, args, env = {}) => spawnSync(process.execPath, ['dist/main.js', adapter, ...args], {
  encoding: 'utf8', timeout: 5000, env: { ...process.env, CRISPCTL_READ_ONLY: '', ...env },
})
function success(result) { assert.equal(result.status, 0, result.stderr); assert.equal(result.error, undefined) }
function failure(result) { assert.equal(result.status, 2, result.stderr); assert.equal(result.stdout, ''); assert.equal(JSON.parse(result.stderr).error, 'usage') }
for (const adapter of adapters) {
  test(`${adapter}: generated root and nested help`, () => {
    for (const args of [['--help'], ['conversations', 'list', '--help']]) {
      const result = invoke(adapter, args); success(result)
      assert.match(result.stdout, /(?:conversations|page)/)
      assert.match(result.stdout, /--json/)
    }
  })
  test(`${adapter}: inherited JSON flag before and after subcommand`, () => {
    for (const args of [['--json', 'conversations', 'list', '--page', '2'], ['conversations', 'list', '--page=2', '--json']]) {
      const result = invoke(adapter, args); success(result)
      assert.equal(JSON.parse(result.stdout).page, 2); assert.equal(result.stderr, '')
    }
  })
  test(`${adapter}: errors remain single JSON objects with exit 2`, () => {
    for (const args of [ ['unknown'], ['conversations', 'list', '--wrong'], ['conversations', 'list', '--page', '0'],
      ['reply'], ['reply', 's', '--text', 'a', '--note', 'b'], ['listen', '--count', 'NaN'] ]) {
      failure(invoke(adapter, [...args, '--json']))
    }
  })
  test(`${adapter}: read-only blocks fixture writes through flag or env`, () => {
    failure(invoke(adapter, ['--read-only', 'reply', 's', '--text', 'hello', '--json']))
    failure(invoke(adapter, ['reply', 's', '--text', 'hello', '--json'], { CRISPCTL_READ_ONLY: '1' }))
  })
  test(`${adapter}: literal dash values and separator arguments`, () => {
    const dash = invoke(adapter, ['reply', 's', '--text=--help', '--json']); success(dash)
    assert.equal(JSON.parse(dash.stdout).text, '--help')
    const separator = invoke(adapter, ['reply', '--json', '--text', 'hi', '--', '-session'])
    // Known migration gap: Crust exposes post-separator tokens as rawArgs.
    if (adapter === 'crust') { failure(separator); assert.match(JSON.parse(separator.stderr).message, /Missing required argument/) }
    else { success(separator); assert.equal(JSON.parse(separator.stdout).session_id, '-session') }
  })
  test(`${adapter}: NDJSON preserves event order, unicode and embedded newlines`, () => {
    const result = invoke(adapter, ['listen', '--json', '--count', '3']); success(result)
    const events = result.stdout.trim().split('\n').map(JSON.parse)
    assert.deepEqual(events.map(event => event.sequence), [1, 2, 3])
    assert.equal(events[0].data.content, 'hello\n世界')
    assert.equal(JSON.parse(result.stderr).status, 'authenticated')
    assert.ok(!result.stdout.includes('\x1b'))
  })
  test(`${adapter}: deadline is exit 1 with a timeout diagnostic`, () => {
    const result = invoke(adapter, ['listen', '--json', '--timeout', '1'])
    assert.equal(result.status, 1, result.stderr)
    assert.equal(JSON.parse(result.stderr.trim().split('\n').at(-1)).error, 'timeout')
  })
  for (const signal of ['SIGINT', 'SIGTERM']) test(`${adapter}: ${signal} stops streaming`, { timeout: 5000 }, async t => {
    const child = spawn(process.execPath, ['dist/main.js', adapter, 'listen', '--json'])
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
    let errors = ''; child.stderr.on('data', chunk => { errors += chunk })
    const done = once(child, 'close')
    await once(child.stdout, 'data')
    child.kill(signal)
    assert.deepEqual(await done, [0, null], errors)
  })
  test(`${adapter}: a closed consumer does not throw an unhandled EPIPE`, { timeout: 5000 }, async t => {
    const child = spawn(process.execPath, ['dist/main.js', adapter, 'listen', '--json'])
    t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
    let errors = ''; child.stderr.on('data', chunk => { errors += chunk })
    const done = once(child, 'close')
    await once(child.stdout, 'data'); child.stdout.destroy()
    assert.deepEqual(await done, [0, null], errors)
    assert.ok(!errors.includes('EPIPE'))
  })
}
test('operation guard refuses writes when invoked without any CLI framework', async () => {
  await assert.rejects(createDispatch(new AbortController().signal)({ command: 'reply', session: 's', options: { readOnly: true, text: 'hi' } }), /read-only/)
})
