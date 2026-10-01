import type { Dispatcher } from "undici"
import type { Flags } from "./args.js"
import type { RunLifecycle } from "./lifecycle.js"
import type { SocketFactory } from "./rtm.js"

import type { InvocationCredentials } from "./invocation-credentials.js"

export type IO = {
  credentials?: InvocationCredentials
  lifecycle?: RunLifecycle
  stdout: (chunk: string) => void
  stderr: (chunk: string) => void
  env: NodeJS.ProcessEnv
  dispatcher?: Dispatcher
  signal?: AbortSignal
  socketFactory?: SocketFactory
  flags: Flags
}
