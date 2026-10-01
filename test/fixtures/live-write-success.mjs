// The live harness runs against mocked REST and a real loopback RTM transport.
import assert from "node:assert/strict"
import { once } from "node:events"
import { readFileSync } from "node:fs"
import { createServer } from "node:https"
import { Server } from "socket.io"
import { MockAgent, setGlobalDispatcher } from "undici"

const website = "fixture-website"
const session = "fixture-created-session"
const site = `/v1/website/${website}`
const conversation = `${site}/conversation/${session}`
let content,
  state,
  deleted = false,
  authenticated = false
const calls = []
const https = createServer({
  key: readFileSync(new URL("./localhost-key.pem", import.meta.url)),
  cert: readFileSync(new URL("./localhost-cert.pem", import.meta.url)),
})
const sockets = new Server(https, { path: "/rtm/", transports: ["websocket"] })
sockets.on("connection", (socket) =>
  socket.on("authentication", (payload) => {
    assert.deepEqual(payload.events, ["message:received"], "operator notes use message:received")
    assert.deepEqual(payload.rooms, [website])
    authenticated = true
    socket.emit("authenticated")
  }),
)
https.listen(0, "127.0.0.1")
await once(https, "listening")
const endpoint = `wss://127.0.0.1:${https.address().port}/rtm/`
const watchdog = setTimeout(() => {
  sockets.close()
  assert.fail("offline live-harness fixture timed out")
}, 8000)
const agent = new MockAgent()
agent.disableNetConnect()
setGlobalDispatcher(agent)
agent
  .get("https://api.crisp.chat")
  .intercept({ method: /^(GET|POST|PATCH|DELETE)$/, path: /.*/ })
  .reply((options) => {
    const route = `${options.method} ${options.path}`
    calls.push(route)
    const body = options.body ? JSON.parse(options.body) : undefined
    const ok = (data, statusCode = 200) => ({
      statusCode,
      data: JSON.stringify({ error: false, data }),
    })
    const error = (statusCode, reason) => ({
      statusCode,
      data: JSON.stringify({ error: true, reason }),
    })
    switch (route) {
      case `GET ${site}`:
        return ok({ name: "Fixture sandbox" })
      case `POST ${site}/conversation`:
        return ok({ session_id: session }, 201)
      case `GET ${site}/connect/endpoints`:
        return ok({ socket: { app: endpoint } })
      case `POST ${conversation}/message`:
        assert.equal(authenticated, true)
        assert.equal(body.type, "note")
        assert.equal(body.from, "operator")
        content = body.content
        sockets.emit("message:received", { website_id: website, session_id: session, content })
        return ok({}, 202)
      case `GET ${conversation}/messages`:
        return ok([{ content }])
      case `PATCH ${conversation}/state`:
        if (body.state === "invalid-fixture-state") return error(400, "invalid_data")
        state = body.state
        return ok({})
      case `GET ${conversation}/state`:
        return ok({ state })
      case `PATCH ${conversation}/meta`:
        assert.deepEqual(body, { segments: ["crispctl-synthetic-test"] })
        return ok({})
      case `PATCH ${conversation}/routing`:
        assert.deepEqual(body, { assigned: null })
        return ok({})
      case `PATCH ${conversation}/read`:
        return ok({}, 202)
      case `GET ${conversation}/pages/1`:
        return ok([])
      case `DELETE ${conversation}`:
        deleted = true
        return ok({})
      case `GET ${conversation}`:
        assert.equal(deleted, true)
        clearTimeout(watchdog)
        setImmediate(() => sockets.close())
        return error(404, "conversation_not_found")
      default:
        assert.match(route, new RegExp(`^GET ${site}/conversation/session_[a-f0-9-]+$`))
        return error(404, "conversation_not_found")
    }
  })
  .persist()
process.once("exit", () => {
  assert.equal(deleted, true)
  assert.equal(
    calls.filter((call) => call === `POST ${conversation}/message`).length,
    1,
    "read-only rejection must not send another message",
  )
  assert.equal(calls.at(-2), `DELETE ${conversation}`)
  assert.equal(calls.at(-1), `GET ${conversation}`)
  console.log("live-success-contract-passed")
})
