import { Dispatcher } from "undici"

// Real undici response consumption with a transport that can fail after headers.
export class BodyDispatcher extends Dispatcher {
  attempts = 0
  constructor(private body: (handler: Dispatcher.DispatchHandlers, attempt: number) => void) { super() }
  override dispatch(_opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers): boolean {
    handler.onConnect!(error => handler.onError!(error ?? new Error("aborted")))
    handler.onHeaders!(200, [Buffer.from("content-type"), Buffer.from("application/json")], () => {}, "OK")
    this.body(handler, ++this.attempts)
    return true
  }
}
