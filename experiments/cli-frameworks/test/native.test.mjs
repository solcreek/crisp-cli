import assert from 'node:assert/strict'
import { test } from 'node:test'

test('Crust native structured invocation captures IO and returns a typed action result', { skip: Boolean(process.env.POC_NODE20) }, async () => {
  const { Crust } = await import('@crustjs/core')
  const app = new Crust('native').command('list', command => command
    .flags({ name: 'page', type: 'number', default: 1 })
    .action(({ flags, stdout }) => { stdout(JSON.stringify({ page: flags.page })); return flags.page }))
  const outcome = await app.run(['list'], { flags: { page: 2 } })
  assert.equal(outcome.status, 'completed')
  assert.equal(outcome.result, 2)
  assert.equal(JSON.parse(outcome.stdout).page, 2)
  assert.equal(outcome.stderr, '')
})

test('Crust run retains a full transcript even when an output callback is injected', { skip: Boolean(process.env.POC_NODE20) }, async () => {
  const { Crust } = await import('@crustjs/core')
  const seen = []
  const app = new Crust('stream').action(({ stdout }) => {
    for (let sequence = 0; sequence < 50; sequence++) stdout(JSON.stringify({ sequence }))
  })
  const result = await app.run([], {}, { stdout: line => seen.push(line) })
  assert.equal(result.status, 'completed')
  assert.equal(seen.length, 50)
  assert.deepEqual(result.stdout.split('\n'), seen)
})
