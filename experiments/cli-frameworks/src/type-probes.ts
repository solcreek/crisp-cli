// Compile-only probes. This function is never invoked.
import { Crust } from '@crustjs/core'
import { Command } from 'commander'
export function typeProbes() {
  const app = new Crust('typed').command('list', command => command
    .flags({ name: 'page', type: 'number', default: 1 })
    .action(({ flags }) => {
      const value: number = flags.page
      // @ts-expect-error Crust catches misspelled flag access.
      flags.paeg
      return value
    }))
  void app.run(['list'], { flags: { page: 2 } })
  // @ts-expect-error Crust validates programmatic command paths.
  void app.run(['missing'])
  // @ts-expect-error Crust validates structured input types.
  void app.run(['list'], { flags: { page: 'two' } })
  const commander = new Command().option('--page <number>')
  // This compiles: native Commander's opts<T>() trusts the caller's type.
  const unproven: string = commander.opts<{ paeg: string }>().paeg
  return unproven
}

// Commander's companion package narrows the inference gap without changing runtime.
import { Command as TypedCommand } from '@commander-js/extra-typings'
export function commanderTypedProbe() {
  return new TypedCommand().option('--page <number>', 'Page', Number, 1).action(options => {
    const page: number = options.page
    // @ts-expect-error Companion typings catch misspelled options.
    options.paeg
    void page
  })
}
