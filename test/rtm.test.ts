import { positiveInteger } from "../src/args.js"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import type { Socket } from "socket.io-client"
import { CrispClient, type ClientCredentials } from "../src/client.js"
import { run } from "../src/cli.js"
import { RTM_EVENTS } from "../src/rtm-events.js"
import { eventPayload, reference } from "./rtm-reference.js"
import { CrispApiError } from "../src/errors.js"
import {
  listen,
  parseEvents,
  socketEndpoint,
  type ListenOptions,
  type SocketFactory,
} from "../src/rtm.js"
import {
  buffers,
  credentialEnv,
  FIXTURE,
  okEnvelope,
  removeHome,
  withCrispMock,
} from "./support.js"
import { BodyDispatcher } from "./body-dispatcher.js"

const creds: ClientCredentials = { ...FIXTURE, tier: "website" }
const endpoint = { socket: { app: "wss://relay.crisp.chat/socket.io/?region=test" } }
class TestSocket extends EventEmitter {
  closed = false
  constructor(readonly authenticate: (payload: any, socket: TestSocket) => void) {
    super()
  }
  override emit(event: string, ...args: any[]): boolean {
    assert.equal(event, "authentication")
    this.authenticate(args[0], this)
    return true
  }
  receive(event: string, payload?: unknown): void {
    super.emit(event, payload)
  }
  connect(): this {
    queueMicrotask(() => {
      if (!this.closed) this.receive("connect")
    })
    return this
  }
  disconnect(): this {
    this.closed = true
    return this
  }
}
function harness(authenticate: (payload: any, socket: TestSocket) => void) {
  const sockets: TestSocket[] = []
  const factory: SocketFactory = (url, opts) => {
    assert.equal(url, "wss://relay.crisp.chat")
    assert.equal(opts?.path, "/socket.io/")
    assert.deepEqual(opts?.transports, ["websocket"])
    assert.equal(opts?.reconnection, false)
    const socket = new TestSocket(authenticate)
    sockets.push(socket)
    return socket as unknown as Socket
  }
  return { sockets, factory }
}
function options(factory: SocketFactory, extra: Partial<ListenOptions> = {}): ListenOptions {
  return {
    events: ["message:send"],
    signal: new AbortController().signal,
    onEvent: () => {},
    onStatus: () => {},
    socketFactory: factory,
    reconnectDelayMs: 1,
    ...extra,
  }
}

test("endpoint discovery uses correct website and plugin routes and HTTP auth", async () => {
  for (const tier of ["website", "plugin"] as const) {
    const calls = await withCrispMock(
      { status: 200, json: okEnvelope(endpoint) },
      async (dispatcher) => {
        assert.deepEqual(
          await new CrispClient({ ...creds, tier }, dispatcher, true).getConnectEndpoints(),
          endpoint,
        )
      },
    )
    assert.equal(
      calls[0]?.path,
      tier === "website"
        ? `/v1/website/${creds.websiteId}/connect/endpoints`
        : "/v1/plugin/connect/endpoints",
    )
    assert.equal(calls[0]?.headers["x-crisp-tier"], tier)
    assert.equal(
      calls[0]?.headers.authorization,
      `Basic ${Buffer.from(`${creds.identifier}:${creds.key}`).toString("base64")}`,
    )
  }
})

test("website authentication, site/session filters, NDJSON, count and cleanup", async () => {
  const h = harness((payload, socket) => {
    assert.deepEqual(payload, {
      tier: "website",
      username: creds.identifier,
      password: creds.key,
      events: ["message:send"],
      rooms: [creds.websiteId],
    })
    socket.receive("message:send", { website_id: creds.websiteId }) // Ignore before authentication.
    socket.receive("authenticated")
    socket.receive("message:send", null)
    socket.receive("message:send", { website_id: "other" })
    socket.receive("message:send", { website_id: creds.websiteId, session_id: "other" })
    socket.receive("message:send", {
      website_id: creds.websiteId,
      session_id: FIXTURE.session,
      content: creds.key,
    })
  })
  const env = credentialEnv({ CRISP_TIER: "website" })
  const io = buffers()
  const signalsBefore = process.listenerCount("SIGINT")
  try {
    await withCrispMock({ status: 200, json: okEnvelope(endpoint) }, async (dispatcher) => {
      assert.equal(
        await run(
          [
            "listen",
            "--json",
            "--read-only",
            "--events",
            "message:send",
            "--session",
            FIXTURE.session,
            "--count",
            "1",
          ],
          { ...io, env, dispatcher, socketFactory: h.factory },
        ),
        0,
      )
    })
    const lines = io.out().trim().split("\n")
    assert.equal(lines.length, 1)
    const event = JSON.parse(lines[0]!)
    assert.equal(event.event, "message:send")
    assert.equal(event.data.content, "[redacted]")
    assert.ok(Number.isFinite(Date.parse(event.received_at)))
    assert.equal(JSON.parse(io.err()).status, "authenticated")
    assert.ok(h.sockets.every((s) => s.closed && s.eventNames().length === 0))
    assert.equal(process.listenerCount("SIGINT"), signalsBefore)
  } finally {
    removeHome(env)
  }
})

test("disconnect rediscovers endpoints, reauthenticates and preserves event count", async () => {
  let discoveries = 0
  const statuses: string[] = []
  const h = harness((_payload, socket) => {
    socket.receive("authenticated")
    socket.receive("message:send", { website_id: creds.websiteId })
    if (discoveries === 1) socket.receive("disconnect", "transport close")
  })
  await listen(
    {
      getConnectEndpoints: async () => {
        discoveries++
        return endpoint
      },
    },
    creds,
    options(h.factory, { count: 2, onStatus: (value) => statuses.push(value.status) }),
  )
  assert.equal(discoveries, 2)
  assert.deepEqual(statuses, ["authenticated", "reconnecting", "authenticated"])
  assert.ok(h.sockets.every((s) => s.closed))
})

test("transient discovery and connection failures retry; authorization failures stop", async () => {
  let discoveries = 0
  const h = harness((_payload, socket) => {
    if (discoveries === 2) socket.receive("connect_error", new Error(creds.key))
    else socket.receive("unauthorized", { secret: creds.key })
  })
  await assert.rejects(
    listen(
      {
        getConnectEndpoints: async () => {
          if (++discoveries === 1) throw new CrispApiError(503, "unavailable", "unavailable")
          return endpoint
        },
      },
      creds,
      options(h.factory),
    ),
    /RTM authentication rejected/,
  )
  assert.equal(discoveries, 3)
  assert.ok(h.sockets.every((s) => s.closed))
  await assert.rejects(
    listen(
      {
        getConnectEndpoints: async () => {
          throw new CrispApiError(403, "forbidden", "forbidden")
        },
      },
      creds,
      options(h.factory),
    ),
    /forbidden/,
  )
})

test("authentication timeout retries; abort during retry stops without another connection", async () => {
  const controller = new AbortController()
  const h = harness(() => {})
  await listen(
    { getConnectEndpoints: async () => endpoint },
    creds,
    options(h.factory, {
      signal: controller.signal,
      connectionTimeoutMs: 5,
      onStatus: () => {
        setTimeout(() => controller.abort(), 5)
      },
      reconnectDelayMs: 1000,
    }),
  )
  assert.equal(h.sockets.length, 1)
  assert.ok(h.sockets[0]?.closed)
})

test("abort closes active socket; pre-abort skips discovery", async () => {
  const controller = new AbortController()
  const h = harness((_payload, socket) => {
    socket.receive("authenticated")
    controller.abort()
  })
  await listen(
    { getConnectEndpoints: async () => endpoint },
    creds,
    options(h.factory, { signal: controller.signal }),
  )
  assert.ok(h.sockets[0]?.closed)
  await listen(
    {
      getConnectEndpoints: async () => {
        throw new Error("must not discover")
      },
    },
    creds,
    options(h.factory, { signal: controller.signal }),
  )
})

test("output failure propagates and cleans up sockets", async () => {
  for (const callback of ["onEvent", "onStatus"] as const) {
    const h = harness((_payload, socket) => {
      socket.receive("authenticated")
      socket.receive("message:send", { website_id: creds.websiteId })
    })
    await assert.rejects(
      listen(
        { getConnectEndpoints: async () => endpoint },
        creds,
        options(h.factory, {
          [callback]: () => {
            throw new Error("output failed")
          },
        }),
      ),
      /output failed/,
    )
    assert.ok(h.sockets[0]?.closed)
  }
})

test("validation rejects malformed events, limits and insecure endpoints", () => {
  assert.deepEqual(parseEvents(), ["message:send", "message:received", "session:set_state"])
  assert.deepEqual(parseEvents("message:send, message:send"), ["message:send"])
  for (const value of ["", "connect", "message:send,", "*", "authentication"])
    assert.throws(() => parseEvents(value))
  assert.equal(positiveInteger(undefined, "count"), undefined)
  assert.equal(positiveInteger("2", "count"), 2)
  for (const value of ["0", "-1", "1.5", "abc", "99999999999999999999"])
    assert.throws(() => positiveInteger(value, "count"))
  for (const value of [
    null,
    {},
    { socket: { app: "bad" } },
    { socket: { app: "ws://host/" } },
    { socket: { app: "wss://user:pass@host/" } },
  ])
    assert.throws(() => socketEndpoint(value), /secure RTM/)
})

test("CLI validates listen flags and deadline, aborts and reports timeout on stderr", async () => {
  const env = credentialEnv()
  try {
    for (const args of [
      ["extra"],
      ["--events", "connect"],
      ["--timeout", "2147484"],
      ["--count", "0"],
      ["--session", ""],
    ]) {
      const io = buffers()
      assert.equal(await run(["listen", ...args], { ...io, env }), 2)
    }
    const h = harness((_payload, socket) => socket.receive("authenticated"))
    const io = buffers()
    await withCrispMock({ status: 200, json: okEnvelope(endpoint) }, async (dispatcher) => {
      assert.equal(
        await run(["listen", "--json", "--timeout", "1"], {
          ...io,
          env,
          dispatcher,
          socketFactory: h.factory,
        }),
        1,
      )
    })
    assert.equal(io.out(), "")
    assert.equal(JSON.parse(io.err().trim().split("\n").at(-1)!).error, "timeout")
    assert.ok(h.sockets[0]?.closed)
    const controller = new AbortController()
    controller.abort()
    assert.equal(await run(["listen"], { ...buffers(), env, signal: controller.signal }), 0)
  } finally {
    removeHome(env)
  }
})

test("catalog covers every referenced event and can be listed without credentials or network", async () => {
  assert.equal(reference.events.length, 82)
  assert.equal(new Set(reference.events.map((item) => item.event)).size, 82)
  assert.deepEqual(
    RTM_EVENTS,
    reference.events.map(({ event, tiers, scopes }) => ({ event, tiers, scopes })),
  )
  for (const [tier, count] of [
    ["website", 71],
    ["plugin", 72],
  ] as const) {
    assert.equal(reference.events.filter((item) => item.tiers.includes(tier)).length, count)
  }
  const env = credentialEnv({ CRISP_KEY: undefined })
  try {
    const io = buffers()
    assert.equal(await run(["listen", "--list-events", "--json", "--read-only"], { ...io, env }), 0)
    assert.deepEqual(JSON.parse(io.out()), {
      source: reference.source,
      checked_at: reference.checked_at,
      events: RTM_EVENTS,
    })
    assert.equal(io.err(), "")
    assert.equal(
      await run(["listen", "--list-events", "--events", "message:send"], { ...buffers(), env }),
      2,
    )
    assert.equal(await run(["operators", "list", "--list-events"], { ...buffers(), env }), 2)
  } finally {
    removeHome(env)
  }
})

for (const definition of reference.events) {
  for (const tier of ["website", "plugin"] as const) {
    test(`reference contract ${tier}: ${definition.event}`, async () => {
      const selected = { ...creds, tier }
      if (!definition.tiers.includes(tier)) {
        await assert.rejects(
          listen(
            {
              getConnectEndpoints: async () => {
                throw new Error("must not contact Crisp")
              },
            },
            selected,
            options(
              () => {
                throw new Error("must not connect")
              },
              { events: [definition.event] },
            ),
          ),
          /requires token tier/,
        )
        return
      }
      const payload = eventPayload(definition)
      const events: unknown[] = []
      const h = harness((auth, socket) => {
        assert.equal(auth.tier, tier)
        assert.deepEqual(auth.events, [definition.event])
        assert.deepEqual(auth.rooms, [creds.websiteId])
        socket.receive("authenticated")
        socket.receive(definition.event, eventPayload(definition, "another-website"))
        socket.receive(definition.event, payload)
      })
      await listen(
        { getConnectEndpoints: async () => endpoint },
        selected,
        options(h.factory, {
          events: parseEvents(definition.event),
          count: 1,
          onEvent: (event) => events.push(event.data),
        }),
      )
      assert.deepEqual(events, [payload])
      assert.ok(h.sockets.every((socket) => socket.closed))
    })
  }
}

test("bucket routing rejects ambiguous resources and conflicting website IDs", async () => {
  const definition = reference.events.find((item) => item.event === "bucket:url:upload:generated")!
  const valid = eventPayload(definition)
  const invalid = [
    null,
    [],
    1,
    "event",
    {},
    { identifier: creds.websiteId },
    { resource: null },
    { resource: [] },
    { resource: { type: "user", id: creds.websiteId } },
    { resource: { type: "website", id: "other" } },
    { ...valid, website_id: "other" },
  ]
  const received: unknown[] = []
  const h = harness((_auth, socket) => {
    socket.receive("authenticated")
    for (const payload of invalid) socket.receive(definition.event, payload)
    socket.receive(definition.event, { ...valid, website_id: creds.websiteId })
  })
  await listen(
    { getConnectEndpoints: async () => endpoint },
    creds,
    options(h.factory, {
      events: [definition.event],
      count: 1,
      onEvent: (event) => received.push(event.data),
    }),
  )
  assert.deepEqual(received, [{ ...valid, website_id: creds.websiteId }])
})

test("session filter supports email tracking identifiers and excludes unscoped events", async () => {
  const events = [
    "email:track:view",
    "people:profile:created",
    "plugin:event",
    "bucket:url:upload:generated",
    "message:send",
  ]
  const received: string[] = []
  const h = harness((_auth, socket) => {
    socket.receive("authenticated")
    socket.receive("email:track:view", {
      website_id: creds.websiteId,
      type: "session",
      identifier: "other",
    })
    socket.receive("email:track:view", {
      website_id: creds.websiteId,
      type: "campaign",
      identifier: FIXTURE.session,
    })
    socket.receive("people:profile:created", { website_id: creds.websiteId })
    socket.receive("plugin:event", {
      website_id: creds.websiteId,
      data: { session_id: FIXTURE.session },
    })
    socket.receive("bucket:url:upload:generated", {
      resource: { type: "website", id: creds.websiteId },
    })
    socket.receive("email:track:view", {
      website_id: creds.websiteId,
      type: "session",
      identifier: FIXTURE.session,
    })
    socket.receive("message:send", { website_id: creds.websiteId, session_id: FIXTURE.session })
  })
  await listen(
    { getConnectEndpoints: async () => endpoint },
    creds,
    options(h.factory, {
      events,
      session: FIXTURE.session,
      count: 2,
      onEvent: (event) => received.push(event.event),
    }),
  )
  assert.deepEqual(received, ["email:track:view", "message:send"])
})

test("future event names pass through without weakening website isolation", async () => {
  const event = "future:new:event"
  const received: unknown[] = []
  const h = harness((_auth, socket) => {
    socket.receive("authenticated")
    socket.receive(event, { resource: { type: "website", id: creds.websiteId } })
    socket.receive(event, { website_id: creds.websiteId })
  })
  await listen(
    { getConnectEndpoints: async () => endpoint },
    creds,
    options(h.factory, {
      events: parseEvents(event),
      count: 1,
      onEvent: (receivedEvent) => received.push(receivedEvent.data),
    }),
  )
  assert.deepEqual(received, [{ website_id: creds.websiteId }])
})

test("cancellation during discovery never opens a socket or schedules a retry", async () => {
  for (const reject of [false, true]) {
    const controller = new AbortController()
    const discovery = {
      getConnectEndpoints: async (signal?: AbortSignal) => {
        assert.equal(signal, controller.signal)
        controller.abort()
        if (reject) throw new CrispApiError(0, "network_error", "aborted")
        return endpoint
      },
    }
    await listen(
      discovery,
      creds,
      options(
        () => {
          throw new Error("must not open socket")
        },
        {
          signal: controller.signal,
          onStatus: () => {
            throw new Error("must not retry")
          },
        },
      ),
    )
  }
})

test("cancellation during socket creation disposes an unconnected socket", async () => {
  const controller = new AbortController()
  const socket = new TestSocket(() => {
    throw new Error("must not authenticate")
  })
  await listen(
    { getConnectEndpoints: async () => endpoint },
    creds,
    options(
      () => {
        controller.abort()
        return socket as unknown as Socket
      },
      { signal: controller.signal },
    ),
  )
  assert.equal(socket.closed, true)
  assert.deepEqual(socket.eventNames(), [])
})

test("disconnect before authentication retries without forwarding early events", async () => {
  let attempt = 0
  const statuses: string[] = []
  const events: unknown[] = []
  const h = harness((_auth, socket) => {
    if (++attempt === 1) {
      socket.receive("message:send", { website_id: creds.websiteId })
      socket.receive("disconnect")
    } else {
      socket.receive("authenticated")
      socket.receive("message:send", { website_id: creds.websiteId })
    }
  })
  await listen(
    { getConnectEndpoints: async () => endpoint },
    creds,
    options(h.factory, {
      count: 1,
      onStatus: (value) => statuses.push(value.status),
      onEvent: (value) => events.push(value),
    }),
  )
  assert.equal(events.length, 1)
  assert.deepEqual(statuses, ["reconnecting", "authenticated"])
  assert.ok(h.sockets.every((socket) => socket.closed))
})

for (const status of [0, 429, 500, 502, 503, 504]) {
  test(`discovery HTTP ${status} retries and recovers`, async () => {
    let attempts = 0
    const h = harness((_auth, socket) => {
      socket.receive("authenticated")
      socket.receive("message:send", { website_id: creds.websiteId })
    })
    await listen(
      {
        getConnectEndpoints: async () => {
          if (++attempts === 1) throw new CrispApiError(status, "temporary", "temporary")
          return endpoint
        },
      },
      creds,
      options(h.factory, { count: 1 }),
    )
    assert.equal(attempts, 2)
  })
}

for (const status of [400, 401, 403, 404]) {
  test(`discovery HTTP ${status} fails without retrying`, async () => {
    let attempts = 0
    const h = harness(() => {})
    await assert.rejects(
      listen(
        {
          getConnectEndpoints: async () => {
            attempts++
            throw new CrispApiError(status, "rejected", "rejected")
          },
        },
        creds,
        options(h.factory),
      ),
      /rejected/,
    )
    assert.equal(attempts, 1)
    assert.equal(h.sockets.length, 0)
  })
}

test("unexpected discovery errors propagate without retrying", async () => {
  await assert.rejects(
    listen(
      {
        getConnectEndpoints: async () => {
          throw new Error("unexpected failure")
        },
      },
      creds,
      options(() => {
        throw new Error("must not connect")
      }),
    ),
    /unexpected failure/,
  )
})

test("reconnection uses a changed endpoint origin, path and query", async () => {
  const endpoints = [
    "wss://first.example.invalid/rtm/?region=a",
    "wss://second.example.invalid/new-rtm/?region=b&token=fixture",
  ]
  const opened: { url: string; path: unknown; query: unknown }[] = []
  let discoveries = 0
  await listen(
    { getConnectEndpoints: async () => ({ socket: { app: endpoints[discoveries++] } }) },
    creds,
    options(
      (url, opts) => {
        opened.push({ url, path: opts?.path, query: opts?.query })
        const socket = new TestSocket((_auth, active) => {
          active.receive("authenticated")
          if (discoveries === 1) active.receive("disconnect")
          else active.receive("message:send", { website_id: creds.websiteId })
        })
        return socket as unknown as Socket
      },
      { count: 1 },
    ),
  )
  assert.deepEqual(opened, [
    { url: "wss://first.example.invalid", path: "/rtm/", query: { region: "a" } },
    {
      url: "wss://second.example.invalid",
      path: "/new-rtm/",
      query: { region: "b", token: "fixture" },
    },
  ])
})

test("discovery retries a real response-body reset and then authenticates", async () => {
  const dispatcher = new BodyDispatcher((handler, attempt) => {
    if (attempt === 1) {
      handler.onData!(Buffer.from('{"data":'))
      setImmediate(() => handler.onError!(new Error("body reset")))
    } else {
      handler.onData!(Buffer.from(JSON.stringify(okEnvelope(endpoint))))
      handler.onComplete!([])
    }
  })
  const h = harness((_payload, socket) => {
    socket.receive("authenticated")
    socket.receive("message:send", { website_id: creds.websiteId })
  })
  const statuses: string[] = []
  await listen(
    new CrispClient(creds, dispatcher, true),
    creds,
    options(h.factory, {
      count: 1,
      onStatus: (status) => statuses.push(status.status),
    }),
  )
  assert.equal(dispatcher.attempts, 2)
  assert.deepEqual(statuses, ["reconnecting", "authenticated"])
  assert.ok(h.sockets.every((socket) => socket.closed))
})

test("abort during response-body consumption stops without retry or socket creation", async () => {
  const controller = new AbortController()
  const dispatcher = new BodyDispatcher((handler) => {
    handler.onData!(Buffer.from('{"data":'))
    setImmediate(() => controller.abort())
  })
  await listen(
    new CrispClient(creds, dispatcher, true),
    creds,
    options(
      () => {
        throw new Error("must not connect")
      },
      {
        signal: controller.signal,
        onStatus: () => assert.fail("must not retry"),
      },
    ),
  )
  assert.equal(dispatcher.attempts, 1)
})

test("rate-limited discovery honors Retry-After before connecting again", async () => {
  let attempts = 0
  const delays: number[] = []
  const h = harness((_payload, socket) => {
    socket.receive("authenticated")
    socket.receive("message:send", { website_id: creds.websiteId })
  })
  await listen(
    {
      getConnectEndpoints: async () => {
        if (++attempts === 1) throw new CrispApiError(429, "rate_limited", "wait", "1")
        return endpoint
      },
    },
    creds,
    options(h.factory, {
      count: 1,
      retry: {
        sleep: async (ms) => {
          delays.push(ms)
        },
      },
    }),
  )
  assert.deepEqual(delays, [1000])
})

test("retry backoff resets after authenticated disconnect and injected sleep errors propagate", async () => {
  let attempts = 0
  const delays: number[] = []
  const h = harness((_payload, socket) => {
    socket.receive("authenticated")
    if (attempts === 3) socket.receive("disconnect")
    else socket.receive("message:send", { website_id: creds.websiteId })
  })
  await listen(
    {
      getConnectEndpoints: async () => {
        attempts++
        if ([1, 2, 4].includes(attempts)) throw new CrispApiError(503, "temporary", "temporary")
        return endpoint
      },
    },
    creds,
    options(h.factory, {
      count: 1,
      reconnectDelayMs: 1000,
      retry: {
        random: () => 1,
        now: () => 0,
        sleep: async (ms) => {
          delays.push(ms)
        },
      },
    }),
  )
  assert.deepEqual(delays, [1000, 2000, 1000, 2000])
  await assert.rejects(
    listen(
      {
        getConnectEndpoints: async () => {
          throw new CrispApiError(503, "temporary", "temporary")
        },
      },
      creds,
      options(h.factory, {
        retry: {
          sleep: async () => {
            throw new Error("clock failure")
          },
        },
      }),
    ),
    /clock failure/,
  )
})

test("100 reconnects leave no socket listeners or abort listeners behind", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const controller = new AbortController()
  let connections = 0
  let discoveries = 0
  const h = harness((_payload, socket) => {
    socket.receive("authenticated")
    if (++connections <= 100) socket.receive("disconnect")
    else socket.receive("message:send", { website_id: creds.websiteId })
  })
  await listen(
    {
      getConnectEndpoints: async () => {
        discoveries++
        return endpoint
      },
    },
    creds,
    options(h.factory, { count: 1, signal: controller.signal, retry: { sleep: async () => {} } }),
  )
  assert.equal(discoveries, 101)
  assert.ok(h.sockets.every((socket) => socket.closed && socket.eventNames().length === 0))
  assert.equal(EventEmitter.getEventListeners(controller.signal, "abort").length, 0)
  t.mock.timers.tick(60_000)
  assert.equal(discoveries, 101)
})

for (const key of ['fixture-"quoted"-key', "fixture-\\-key", "fixture-\n-key", "123"]) {
  for (const json of [true, false]) {
    test(`RTM redacts structured strings while preserving JSON types (${JSON.stringify(key)}, json=${json})`, async () => {
      const env = credentialEnv({ CRISP_KEY: key, CRISP_TIER: "website" })
      const io = buffers()
      const payload = {
        website_id: FIXTURE.websiteId,
        content: key,
        nested: [{ [key]: `prefix ${key} suffix`, number: 123456, flag: true, empty: null }],
      }
      const h = harness((_auth, socket) => {
        socket.receive("authenticated")
        socket.receive("message:send", payload)
      })
      try {
        await withCrispMock({ status: 200, json: okEnvelope(endpoint) }, async (dispatcher) => {
          assert.equal(
            await run(["listen", "--count", "1", ...(json ? ["--json"] : [])], {
              ...io,
              env,
              dispatcher,
              socketFactory: h.factory,
            }),
            0,
          )
        })
        const event = JSON.parse(io.out())
        assert.equal(event.data.content, "[redacted]")
        assert.deepEqual(event.data.nested, [
          { "[redacted]": "prefix [redacted] suffix", number: 123456, flag: true, empty: null },
        ])
        assert.equal(payload.content, key)
        if (json) assert.equal(io.out().trim().split("\n").length, 1)
      } finally {
        removeHome(env)
      }
    })
  }
}
