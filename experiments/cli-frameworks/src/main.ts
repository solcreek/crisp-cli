import { createDispatch, Failure, formatError, line } from './common.js'

const [adapter, ...argv] = process.argv.slice(2)
const controller = new AbortController()
const stop = () => controller.abort()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
let code = 0
const pipeError = (error: NodeJS.ErrnoException) => { if (error.code === 'EPIPE') stop() }
process.stdout.on('error', pipeError)
try {
  const compatible = adapter?.endsWith('-node20') ?? false
  const ink = adapter?.startsWith('ink') && process.stdout.isTTY && !argv.includes('--json')
  const dispatch = createDispatch(controller.signal, ink
    ? options => import('./ink.js').then(module => module.watch(options, controller.signal, compatible)) : undefined)
  if (adapter === 'crust') {
    const { runCrust } = await import('./crust.js')
    await runCrust(argv, dispatch, controller.signal)
  } else if (['commander', 'commander-node20', 'ink', 'ink-node20'].includes(adapter ?? '')) {
    const { runCommander } = await import('./commander.js')
    await runCommander(argv, dispatch, compatible)
  } else throw new Failure('adapter must be commander, crust, ink, commander-node20, or ink-node20')
} catch (error) {
  if (!controller.signal.aborted) {
    code = error instanceof Failure ? error.code : 1
    await line(process.stderr, formatError(error, argv.includes('--json')))
  }
} finally {
  process.removeListener('SIGINT', stop)
  process.removeListener('SIGTERM', stop)
}
process.exit(code)
