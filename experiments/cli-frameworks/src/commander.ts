import type { Command as CommandType } from 'commander'
import { Failure, positive, type Dispatch, type Options } from './common.js'

export async function runCommander(argv: string[], dispatch: Dispatch, compatible = false): Promise<void> {
  const { Command, CommanderError } = compatible ? await import('commander-node20') : await import('commander')
  const root = new Command('crisp-poc')
    .description('Crisp framework POC — local fixtures')
    .option('--json', 'Machine-readable output')
    .option('--read-only', 'Refuse writes')
    .configureHelp({ showGlobalOptions: true })
    .exitOverride()
    .configureOutput({ writeOut: text => process.stdout.write(text), writeErr: () => {} })
  const options = (cmd: CommandType) => cmd.optsWithGlobals<Options>()
  root.command('conversations').description('Conversation operations')
    .command('list').description('List fixture conversations')
    .option('--page <number>', 'Page', positive, 1)
    .action((_opts, cmd) => dispatch({ command: 'list', options: options(cmd) }))
  root.command('reply').argument('<session>').description('Fixture reply only')
    .option('--text <text>', 'Reply text').option('--note <text>', 'Private note')
    .action((session: string, _opts, cmd) => dispatch({ command: 'reply', session, options: options(cmd) }))
  root.command('listen').description('Listen to local fixture events')
    .option('--count <number>', 'Stop after N events', positive)
    .option('--timeout <seconds>', 'Total deadline', positive)
    .action((_opts, cmd) => dispatch({ command: 'listen', options: options(cmd) }))
  try { await root.parseAsync(argv, { from: 'user' }) }
  catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) return
      throw new Failure(error.message.replace(/^error: /, ''))
    }
    throw error
  }
}
