import type { Dispatcher } from "undici"
import type { Flags } from "./args.js"
import type { RunLifecycle } from "./lifecycle.js"
import type { SocketFactory } from "./rtm.js"

export type IO = {
  lifecycle?: RunLifecycle
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
  env: NodeJS.ProcessEnv
  dispatcher?: Dispatcher
  signal?: AbortSignal
  socketFactory?: SocketFactory
  flags: Flags
}

