import { Dispatcher } from "undici"

// Real undici response consumption with a transport that can fail after headers.
export class BodyDispatcher extends Dispatcher {
  attempts = 0
  constructor(
    private body: (handler: Dispatcher.DispatchHandlers, attempt: number) => void,
    private status = 200,
  ) {
    super()
  }
  override dispatch(
    _opts: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandlers,
  ): boolean {
    handler.onConnect!((error) => handler.onError!(error ?? new Error("aborted")))
    handler.onHeaders!(
      this.status,
      [
        Buffer.from("content-type"),
        Buffer.from("application/json"),
        Buffer.from("retry-after"),
        Buffer.from("2"),
      ],
      () => {},
      "Fixture",
    )
    this.body(handler, ++this.attempts)
    return true
  }
}
