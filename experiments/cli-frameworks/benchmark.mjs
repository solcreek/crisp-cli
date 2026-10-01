import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { platform, arch, cpus } from 'node:os'
import { performance } from 'node:perf_hooks'

const adapters = ['commander', 'crust', 'ink', 'commander-node20', 'ink-node20']
const invoke = (adapter, args) => spawnSync(process.execPath, ['dist/main.js', adapter, ...args], { encoding: 'utf8', timeout: 5000 })
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const samples = Object.fromEntries(adapters.map(adapter => [adapter, []]))
// Warm module files once, then interleave fresh-process samples across adapters.
for (const adapter of adapters) assert.equal(invoke(adapter, ['conversations', 'list', '--json']).status, 0)
for (let n = 0; n < 15; n++) for (const adapter of [...adapters.slice(n % 5), ...adapters.slice(0, n % 5)]) {
  const start = performance.now()
  assert.equal(invoke(adapter, ['conversations', 'list', '--json']).status, 0)
  samples[adapter].push(+(performance.now() - start).toFixed(2))
}
const imports = {}
for (const [name, modules] of Object.entries({ commander: ['commander'], crust: ['@crustjs/core', '@crustjs/extensions'], ink: ['commander', 'react', 'ink'] })) {
  const runs = []
  for (let n = 0; n < 5; n++) {
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `const start=performance.now(); for(const module of ${JSON.stringify(modules)}) await import(module); console.log(JSON.stringify({ms:performance.now()-start,rss:process.memoryUsage().rss}));`], { encoding: 'utf8' })
    assert.equal(probe.status, 0, probe.stderr); runs.push(JSON.parse(probe.stdout))
  }
  imports[name] = { import_ms_median: +median(runs.map(run => run.ms)).toFixed(2), process_rss_mib_median: +(median(runs.map(run => run.rss)) / 1024 / 1024).toFixed(2) }
}
const cases = {
  booleanEquals: ['conversations', 'list', '--json=true'],
  booleanFalse: ['conversations', 'list', '--json=false'],
  duplicateOption: ['conversations', 'list', '--page', '1', '--page', '2', '--json'],
  extraPositional: ['conversations', 'list', 'extra', '--json'],
  separatorArgument: ['reply', '--json', '--text', 'hello', '--', '-session'],
  negatedReadonly: ['reply', 's', '--text', 'hello', '--no-read-only', '--json'],
}
const compatibility = {}
for (const adapter of ['commander', 'crust']) compatibility[adapter] = Object.fromEntries(Object.entries(cases).map(([name, args]) => {
  const result = invoke(adapter, args)
  return [name, { argv: args, code: result.status, stdout: result.stdout, stderr: result.stderr }]
}))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages
function closure(seeds) {
  const found = new Set()
  function visit(path) {
    if (found.has(path) || !lock[path]) return
    found.add(path)
    const pkg = lock[path]
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).filter(name => !name.startsWith('@types/'))) {
      let base = path
      while (base && !lock[`${base}/node_modules/${name}`]) {
        const index = base.lastIndexOf('/node_modules/')
        base = index < 0 ? '' : base.slice(0, index)
      }
      visit(base ? `${base}/node_modules/${name}` : `node_modules/${name}`)
    }
  }
  for (const seed of seeds) visit(`node_modules/${seed}`)
  function size(path) { return readdirSync(path, { withFileTypes: true }).reduce((sum, entry) => {
    if (entry.name === 'node_modules') return sum
    const file = `${path}/${entry.name}`
    return sum + (entry.isDirectory() ? size(file) : entry.isFile() ? statSync(file).size : 0)
  }, 0) }
  return { packages: [...found].sort(), count: found.size, installed_files_mib: +([...found].reduce((sum, path) => sum + size(path), 0) / 1024 / 1024).toFixed(2) }
}
const result = {
  environment: { measured_at: new Date().toISOString(), node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0].model },
  methodology: { fresh_process_samples: 15, file_cache: 'warm', wall_clock: 'spawn to exit; includes Node startup; not API latency', ink_json: 'Ink is intentionally lazy-loaded only for a TTY human listener', memory: '5 fresh import-only processes, total RSS, not incremental memory or bundle size', dependency_footprint: 'installed dependency and runtime-peer closure; excludes type-only peers and dev dependencies; includes package docs/types' },
  startup: Object.fromEntries(adapters.map(adapter => [adapter, { median_ms: median(samples[adapter]), samples_ms: samples[adapter] }])),
  imports, compatibility,
  footprint: { commander: closure(['commander']), crust: closure(['@crustjs/core', '@crustjs/extensions']), ink: closure(['commander', 'ink', 'react']) },
}
writeFileSync('results/benchmark.json', JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ startup: result.startup, imports, footprint: Object.fromEntries(Object.entries(result.footprint).map(([name, data]) => [name, { count: data.count, mib: data.installed_files_mib }])) }, null, 2))
