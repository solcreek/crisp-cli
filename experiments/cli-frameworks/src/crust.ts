import { Crust, CrustError, defineContext, defineExtension, defineExtensionId } from '@crustjs/core'
import { help } from '@crustjs/extensions'
import { Failure, positive, type Dispatch, type Options } from './common.js'

export function createCrust(dispatch: Dispatch) {
  const global = defineContext('global').flags(
    { name: 'json', type: 'boolean', description: 'Machine-readable output', noNegate: true },
    { name: 'read-only', type: 'boolean', description: 'Refuse writes', noNegate: true },
  ).setup(({ flags }) => flags)
  let failure: unknown
  const errors = defineExtension(defineExtensionId('poc/errors')).onError(error => {
    failure = error
    return true // The common boundary renders exactly one diagnostic.
  })
  const base = (flags: { json?: boolean; 'read-only'?: boolean }): Options => ({ json: flags.json, readOnly: flags['read-only'] })
  const app = new Crust('crisp-poc', { description: 'Crisp framework POC — local fixtures' })
    .provide(global())
    .command('conversations', command => command
      .command('list', list => list.flags({ name: 'page', type: 'string', parse: positive, default: '1' })
        .action(async ({ flags, ctx }) => dispatch({ command: 'list', options: { ...base(await ctx.global), page: flags.page } }))))
    .command('reply', command => command
      .args({ name: 'session', type: 'string', required: true })
      .flags({ name: 'text', type: 'string' }, { name: 'note', type: 'string' })
      .action(async ({ args, flags, ctx }) => dispatch({ command: 'reply', session: args.session,
        options: { ...base(await ctx.global), text: flags.text, note: flags.note } })))
    .command('listen', command => command
      .flags({ name: 'count', type: 'string', parse: positive }, { name: 'timeout', type: 'string', parse: positive })
      .action(async ({ flags, ctx }) => dispatch({ command: 'listen', options: { ...base(await ctx.global), count: flags.count, timeout: flags.timeout } })))
  const extended = app.extend(help(), errors)
  return { app: extended, failure: () => failure }
}
export async function runCrust(argv: string[], dispatch: Dispatch, signal: AbortSignal): Promise<void> {
  const { app, failure } = createCrust(dispatch)
  const saved = process.exitCode
  // execute() owns process.exitCode; adapt that boundary to our exit-code contract.
  try { await app.execute({ argv, signal }) } finally { process.exitCode = saved }
  const error = failure()
  if (error instanceof CrustError) throw new Failure(error.message)
  if (error) throw error
}
