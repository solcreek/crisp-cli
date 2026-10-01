import { useEffect, useState } from 'react'
import { events, type Event, type Options } from './common.js'

export async function watch(options: Options, signal: AbortSignal, compatible = false): Promise<void> {
  const { render, Box, Text, useInput, useApp } = compatible ? await import('ink-node20') : await import('ink')
  let failure: unknown
  function Dashboard() {
    const [event, setEvent] = useState<Event>()
    const [paused, setPaused] = useState(false)
    const [controller] = useState(() => new AbortController())
    const { exit } = useApp()
    useInput(input => {
      if (input === 'q') controller.abort()
      if (input === 'p') setPaused(value => !value)
    })
    useEffect(() => {
      const combined = AbortSignal.any([signal, controller.signal])
      events(options, combined, async event => { setEvent(event) })
        .catch(error => { failure = error })
        .finally(() => exit())
      return () => controller.abort()
    }, [controller, exit])
    return <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold color="cyan">Crisp RTM · LOCAL FIXTURE</Text>
      <Text>Received: {event?.sequence ?? 0} | {paused ? 'details hidden' : 'live'}</Text>
      <Text>{paused ? 'Press p to show details' : `${event?.event ?? 'connecting'} · ${event?.data.session_id ?? ''}`}</Text>
      <Text dimColor>q quit · p toggle details</Text>
    </Box>
  }
  const app = render(<Dashboard />, { exitOnCtrlC: false, patchConsole: false })
  await app.waitUntilExit()
  if (failure) throw failure
}
