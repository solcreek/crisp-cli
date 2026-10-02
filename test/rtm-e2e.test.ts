import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { readFileSync } from "node:fs"
import { createServer } from "node:https"
import type { AddressInfo } from "node:net"
import { test, type TestContext } from "node:test"
import { fileURLToPath } from "node:url"
import { Server, type Socket } from "socket.io"
import { eventPayload, reference } from "./rtm-reference.js"
import type { Tier } from "../src/config.js"
import { credentialEnv, FIXTURE, removeHome } from "./support.js"

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
async function server(
  t: TestContext,
  authenticate: (socket: Socket, payload: any) => void,
): Promise<string> {
  const https = createServer({
    key: readFileSync(path("./fixtures/localhost-key.pem")),
    cert: readFileSync(path("./fixtures/localhost-cert.pem")),
  })
  const sockets = new Server(https, { path: "/rtm/", transports: ["websocket"] })
  sockets.on("connection", (socket) =>
    socket.on("authentication", (payload) => authenticate(socket, payload)),
  )
  https.listen(0, "127.0.0.1")
  await once(https, "listening")
  t.after(() => new Promise<void>((resolve) => sockets.close(() => resolve())))
  return `wss://127.0.0.1:${(https.address() as AddressInfo).port}/rtm/`
}
function cli(t: TestContext, endpoint: string, args: string[], tier: Tier = "website") {
  const env = credentialEnv({ CRISP_TIER: "website" })
  const child = spawn(
    process.execPath,
    ["--import", path("./fixtures/mock-crisp.mjs"), path("../dist/index.js"), ...args],
    {
      env: {
        ...process.env,
        ...env,
        CRISPCTL_IDENTIFIER: FIXTURE.identifier,
        CRISPCTL_KEY: FIXTURE.key,
        CRISPCTL_WEBSITE_ID: FIXTURE.websiteId,
        CRISPCTL_TIER: tier,
        CRISPCTL_READ_ONLY: "1",
        CRISPCTL_CONFIG: `${env.HOME}/config.json`,
        NODE_EXTRA_CA_CERTS: path("./fixtures/localhost-cert.pem"),
        CRISPCTL_TEST_ENDPOINT: endpoint,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  )
  let stdout = ""
  let stderr = ""
  let discoveries = 0
  child.stdout!.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr!.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk
  })
  child.on("message", (message) => {
    if ((message as { type: string }).type === "discovery") discoveries++
  })
  const completed = once(child, "close").then(([code, signal]) => ({
    code,
    signal,
    stdout,
    stderr,
    discoveries,
  }))
  // Keep failed assertions from leaving a child or a live socket behind.
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    child.stdout!.resume()
    child.stderr!.resume()
    await completed
    removeHome(env)
  })
  return { child, completed }
}

for (const mode of [
  "listen deadline",
  "count deadline",
  "count signal",
  "count drain limit",
] as const) {
  test(
    `E2E ${mode} stops a stalled stdout reader below the buffer limit`,
    { timeout: 12_000 },
    async (t) => {
      const endpoint = await server(t, (socket) => {
        socket.emit("authenticated")
        socket.emit("message:send", {
          website_id: FIXTURE.websiteId,
          content: "x".repeat(512 * 1024),
        })
      })
      const args = ["listen", "--json"]
      if (mode.startsWith("count")) args.push("--count", "1")
      if (mode.endsWith("deadline")) args.push("--timeout", "1")
      const { child, completed } = cli(t, endpoint, args)
      child.stdout!.pause()
      // Observe process exit without draining its pipe; 'close' may await reader EOF.
      const exit = once(child, "exit")
      // Removing the last 'readable' listener can resume an existing 'data' listener.
      const keepPaused = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        if (mode === "count signal") {
          child.stdout!.on("readable", keepPaused)
          await once(child.stdout!, "readable")
          child.kill("SIGTERM")
        }
        const result = await Promise.race([
          exit,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), mode === "count drain limit" ? 8000 : 3500)
          }),
        ])
        assert.ok(result, "process must exit even while the stdout reader remains stalled")
        assert.equal(result[0], 1)
        child.stdout!.removeListener("readable", keepPaused)
        child.stdout!.resume()
        assert.match(
          (await completed).stderr,
          mode.endsWith("deadline")
            ? /deadline reached/
            : mode === "count signal"
              ? /output drain cancelled/
              : /output drain timed out/,
        )
      } finally {
        clearTimeout(timer)
        child.stdout!.removeListener("readable", keepPaused)
      }
    },
  )
}

test(
  "E2E built listen uses WSS, filters events, reconnects and emits clean NDJSON",
  { timeout: 15_000 },
  async (t) => {
    let connections = 0
    const authentications: unknown[] = []
    const endpoint = await server(t, (socket, payload) => {
      authentications.push(payload)
      connections++
      socket.emit("authenticated")
      socket.emit("message:send", { website_id: "another-site", content: "do not output" })
      socket.emit("message:send", { website_id: FIXTURE.websiteId, session_id: "another-session" })
      socket.emit("message:send", {
        website_id: FIXTURE.websiteId,
        session_id: FIXTURE.session,
        content: `event ${connections}\nsecond line`,
      })
      if (connections === 1) setTimeout(() => socket.disconnect(true), 25)
    })
    const { completed } = cli(t, endpoint, [
      "listen",
      "--json",
      "--read-only",
      "--events",
      "message:send",
      "--session",
      FIXTURE.session,
      "--count",
      "2",
      "--timeout",
      "10",
    ])
    const result = await completed
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.discoveries, 2)
    assert.equal(connections, 2)
    for (const auth of authentications)
      assert.deepEqual(auth, {
        tier: "website",
        username: FIXTURE.identifier,
        password: FIXTURE.key,
        events: ["message:send"],
        rooms: [FIXTURE.websiteId],
      })
    const events = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert.equal(events.length, 2)
    assert.deepEqual(
      events.map((event) => event.data.content),
      ["event 1\nsecond line", "event 2\nsecond line"],
    )
    assert.ok(
      events.every(
        (event) => event.event === "message:send" && Number.isFinite(Date.parse(event.received_at)),
      ),
    )
    assert.deepEqual(
      result.stderr
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).status),
      ["authenticated", "reconnecting", "authenticated"],
    )
    assert.ok(!`${result.stdout}${result.stderr}`.includes(FIXTURE.key))
  },
)

test(
  "E2E unauthorized is fatal, redacted and does not reconnect",
  { timeout: 10_000 },
  async (t) => {
    const endpoint = await server(t, (socket) =>
      socket.emit("unauthorized", { message: FIXTURE.key }),
    )
    const result = await cli(t, endpoint, ["listen", "--json", "--timeout", "5"]).completed
    assert.equal(result.code, 1)
    assert.equal(result.discoveries, 1)
    assert.equal(result.stdout, "")
    assert.equal(JSON.parse(result.stderr).error, "unauthorized")
    assert.ok(!result.stderr.includes(FIXTURE.key))
  },
)

test("E2E SIGTERM closes a live socket and exits cleanly", { timeout: 10_000 }, async (t) => {
  let disconnected!: () => void
  const closed = new Promise<void>((resolve) => {
    disconnected = resolve
  })
  const endpoint = await server(t, (socket) => {
    socket.on("disconnect", disconnected)
    socket.emit("authenticated")
  })
  const { child, completed } = cli(t, endpoint, ["listen", "--json", "--timeout", "5"])
  let status = ""
  child.stderr!.on("data", (chunk) => {
    status += chunk
    if (status.includes('"authenticated"')) child.kill("SIGTERM")
  })
  const result = await completed
  await closed
  assert.equal(result.code, 0)
  assert.equal(result.signal, null)
  assert.equal(result.stdout, "")
})

test(
  "E2E read-only rejects a write with exit 2 before HTTP or socket access",
  { timeout: 10_000 },
  async (t) => {
    const result = await cli(t, "wss://127.0.0.1:1/rtm/", [
      "reply",
      FIXTURE.session,
      "--note",
      "must never send",
      "--json",
    ]).completed
    assert.equal(result.code, 2)
    assert.equal(result.discoveries, 0)
    assert.equal(result.stdout, "")
    assert.match(JSON.parse(result.stderr).message, /read-only mode/)
  },
)

for (const tier of ["website", "plugin"] as const) {
  test(
    `E2E ${tier} token forwards every documented eligible event over WSS`,
    { timeout: 15_000 },
    async (t) => {
      const definitions = reference.events.filter((item) => item.tiers.includes(tier))
      let authentication: unknown
      const endpoint = await server(t, (socket, payload) => {
        authentication = payload
        socket.emit("authenticated")
        for (const definition of definitions) {
          socket.emit(definition.event, eventPayload(definition, "another-website"))
          socket.emit(definition.event, eventPayload(definition))
        }
      })
      const result = await cli(
        t,
        endpoint,
        [
          "listen",
          "--json",
          "--events",
          definitions.map((item) => item.event).join(","),
          "--count",
          String(definitions.length),
          "--timeout",
          "10",
        ],
        tier,
      ).completed
      assert.equal(result.code, 0, result.stderr)
      assert.deepEqual(authentication, {
        tier,
        username: FIXTURE.identifier,
        password: FIXTURE.key,
        events: definitions.map((item) => item.event),
        rooms: [FIXTURE.websiteId],
      })
      const events = result.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      assert.deepEqual(
        events.map(({ event, data }) => ({ event, data })),
        definitions.map((definition) => ({
          event: definition.event,
          data: eventPayload(definition),
        })),
      )
      assert.equal(result.discoveries, 1)
    },
  )
}

test("E2E closed stdout cancels RTM without an unhandled EPIPE", { timeout: 10_000 }, async (t) => {
  let disconnected!: () => void
  const closed = new Promise<void>((resolve) => {
    disconnected = resolve
  })
  const endpoint = await server(t, (socket) => {
    socket.on("disconnect", disconnected)
    socket.emit("authenticated")
    socket.emit("message:send", { website_id: FIXTURE.websiteId, content: "pipe closed" })
  })
  const { child, completed } = cli(t, endpoint, ["listen", "--json", "--timeout", "5"])
  child.stdout!.destroy()
  const result = await completed
  await closed
  assert.equal(result.code, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /Unhandled|EPIPE|node:events/)
})

test(
  "E2E slow stdout drains every ordered event before count exit",
  { timeout: 15_000 },
  async (t) => {
    const count = 150
    const content = "保留".repeat(2048)
    const endpoint = await server(t, (socket) => {
      socket.emit("authenticated")
      for (let sequence = 0; sequence < count; sequence++) {
        socket.emit("message:send", { website_id: FIXTURE.websiteId, sequence, content })
      }
    })
    const { child, completed } = cli(t, endpoint, [
      "listen",
      "--json",
      "--count",
      String(count),
      "--timeout",
      "10",
    ])
    child.stdout!.pause()
    const timer = setTimeout(() => child.stdout!.resume(), 300)
    t.after(() => clearTimeout(timer))
    const result = await completed
    assert.equal(result.code, 0, result.stderr)
    const events = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    assert.deepEqual(
      events.map((event) => event.data.sequence),
      Array.from({ length: count }, (_, i) => i),
    )
    assert.ok(events.every((event) => event.data.content === content))
  },
)

test(
  "E2E a stalled reader causes bounded-output failure and closes RTM",
  { timeout: 15_000 },
  async (t) => {
    let disconnected!: () => void
    const closed = new Promise<void>((resolve) => {
      disconnected = resolve
    })
    const endpoint = await server(t, (socket) => {
      socket.on("disconnect", disconnected)
      socket.emit("authenticated")
      for (let i = 0; i < 80; i++)
        socket.emit("message:send", {
          website_id: FIXTURE.websiteId,
          content: "x".repeat(256 * 1024),
        })
    })
    const { child, completed } = cli(t, endpoint, ["listen", "--json", "--timeout", "10"])
    child.stdout!.pause()
    let stderr = ""
    child.stderr!.on("data", (chunk) => {
      stderr += chunk
      if (stderr.includes("buffer exceeded")) child.stdout!.resume()
    })
    const result = await completed
    await closed
    assert.equal(result.code, 1, stderr)
    assert.match(stderr, /stdout buffer exceeded 8388608 bytes/)
    assert.doesNotMatch(stderr, /Unhandled|node:events/)
  },
)

for (const sessionFilter of [false, true]) {
  test(
    `E2E independent payload fixtures preserve content with session filter ${sessionFilter}`,
    { timeout: 15_000 },
    async (t) => {
      const fixtures = JSON.parse(readFileSync(path("./fixtures/rtm-payloads.json"), "utf8")) as {
        event: string
        data: Record<string, unknown>
      }[]
      const expected = sessionFilter
        ? fixtures.filter((item) =>
            ["message:send", "message:received", "email:track:view"].includes(item.event),
          )
        : fixtures
      const endpoint = await server(t, (socket) => {
        socket.emit("authenticated")
        for (const fixture of fixtures) {
          for (const malformed of [
            null,
            [],
            "string",
            42,
            {},
            { website_id: 123 },
            { website_id: { id: FIXTURE.websiteId } },
          ]) {
            socket.emit(fixture.event, malformed)
          }
          socket.emit(fixture.event, { ...fixture.data, website_id: "other-website" })
        }
        // Invalid nested routing fields and session types must not pass the filter.
        for (const resource of [
          null,
          [],
          {},
          { type: "website", id: 123 },
          { type: "user", id: FIXTURE.websiteId },
        ]) {
          socket.emit("bucket:url:upload:generated", { resource, identifier: FIXTURE.websiteId })
        }
        if (sessionFilter) {
          for (const session_id of [null, [], {}, 123, "other-session"]) {
            socket.emit("message:send", { website_id: FIXTURE.websiteId, session_id })
          }
          socket.emit("email:track:view", {
            website_id: FIXTURE.websiteId,
            type: "campaign",
            identifier: FIXTURE.session,
          })
        }
        if (sessionFilter)
          socket.emit("plugin:event", fixtures.find((item) => item.event === "plugin:event")!.data)
        for (const fixture of fixtures) socket.emit(fixture.event, fixture.data)
      })
      const result = await cli(t, endpoint, [
        "listen",
        "--json",
        "--events",
        fixtures.map((item) => item.event).join(","),
        "--count",
        String(expected.length),
        "--timeout",
        "10",
        ...(sessionFilter ? ["--session", FIXTURE.session] : []),
      ]).completed
      assert.equal(result.code, 0, result.stderr)
      assert.deepEqual(
        result.stdout
          .trim()
          .split("\n")
          .map((line) => {
            const { event, data } = JSON.parse(line)
            return { event, data }
          }),
        expected,
      )
    },
  )
}
