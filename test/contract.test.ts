import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { run } from "../src/cli.js"
import { version } from "../src/version.js"
import {
  assertUrl,
  basicAuth,
  buffers,
  credentialEnv,
  FIXTURE,
  okEnvelope,
  removeHome,
  withCrispMock,
} from "./support.js"

const site = `/v1/website/${FIXTURE.websiteId}`
const session = FIXTURE.session

type Verb = {
  name: string
  argv: string[]
  method: string
  path: string
  body: unknown
}

const verbs: Verb[] = [
  {
    name: "conversations list",
    argv: ["conversations", "list", "--page", "2"],
    method: "GET",
    path: `${site}/conversations/2`,
    body: null,
  },
  {
    name: "conversations get",
    argv: ["conversations", "get", session],
    method: "GET",
    path: `${site}/conversation/${session}`,
    body: null,
  },
  {
    name: "conversations search",
    argv: ["conversations", "search", "refund", "--search-type", "text"],
    method: "GET",
    path: `${site}/conversations/1?search_query=refund&search_type=text`,
    body: null,
  },
  {
    name: "messages list",
    argv: ["messages", "list", session],
    method: "GET",
    path: `${site}/conversation/${session}/messages`,
    body: null,
  },
  {
    name: "reply text",
    argv: ["reply", session, "--text", "Hello from crispctl"],
    method: "POST",
    path: `${site}/conversation/${session}/message`,
    body: {
      type: "text",
      from: "operator",
      origin: "chat",
      content: "Hello from crispctl",
    },
  },
  {
    name: "reply note",
    argv: ["reply", session, "--note", "internal only"],
    method: "POST",
    path: `${site}/conversation/${session}/message`,
    body: {
      type: "note",
      from: "operator",
      origin: "chat",
      content: "internal only",
    },
  },
  {
    name: "resolve",
    argv: ["resolve", session],
    method: "PATCH",
    path: `${site}/conversation/${session}/state`,
    body: { state: "resolved" },
  },
  {
    name: "reopen",
    argv: ["reopen", session],
    method: "PATCH",
    path: `${site}/conversation/${session}/state`,
    body: { state: "unresolved" },
  },
  {
    name: "assign",
    argv: ["assign", session, "--user", FIXTURE.userId],
    method: "PATCH",
    path: `${site}/conversation/${session}/routing`,
    body: { assigned: { user_id: FIXTURE.userId } },
  },
  {
    name: "unassign",
    argv: ["assign", session, "--unassign"],
    method: "PATCH",
    path: `${site}/conversation/${session}/routing`,
    body: { assigned: null },
  },
  {
    name: "segments",
    argv: ["segments", session, "--set", "a, b"],
    method: "PATCH",
    path: `${site}/conversation/${session}/meta`,
    body: { segments: ["a", "b"] },
  },
  {
    name: "read",
    argv: ["read", session],
    method: "PATCH",
    path: `${site}/conversation/${session}/read`,
    body: { from: "operator", origin: "chat" },
  },
  {
    name: "people get",
    argv: ["people", "get", "people_1"],
    method: "GET",
    path: `${site}/people/profile/people_1`,
    body: null,
  },
  {
    name: "operators list",
    argv: ["operators", "list"],
    method: "GET",
    path: `${site}/operators/list`,
    body: null,
  },
]

for (const verb of verbs) {
  test(`${verb.name} happy path`, async () => {
    const env = credentialEnv()
    const io = buffers()
    const payload = verb.name === "operators list" ? [{ user_id: "op-1" }] : { session_id: session }
    try {
      const calls = await withCrispMock(
        { status: 200, json: okEnvelope(payload) },
        async (dispatcher) => {
          const code = await run(["--json", ...verb.argv], { ...io, env, dispatcher })
          assert.equal(code, 0)
          assert.equal(io.err(), "")
          assert.deepEqual(JSON.parse(io.out()), payload)
        },
      )
      assert.equal(calls.length, 1)
      const call = calls[0]
      assert.ok(call)
      assert.equal(call.method.toUpperCase(), verb.method)
      assertUrl(call.path, verb.path)
      assert.deepEqual(call.body, verb.body)
      assert.equal(call.headers.authorization, basicAuth())
      assert.equal(call.headers["x-crisp-tier"], "plugin")
      assert.equal(call.headers["user-agent"], `crispctl/${version}`)
      assert.equal(call.headers.accept, "application/json")
      if (verb.body === null) {
        assert.equal(call.headers["content-type"], undefined)
      } else {
        assert.equal(call.headers["content-type"], "application/json")
      }
      assert.equal(io.out().includes(FIXTURE.key), false)
    } finally {
      removeHome(env)
    }
  })

  for (const status of [400, 429]) {
    test(`${verb.name} HTTP ${status}`, async () => {
      const env = credentialEnv()
      const io = buffers()
      const reason = status === 429 ? "rate_limited" : "invalid_data"
      const message = status === 429 ? `slow down ${FIXTURE.key}` : "bad session"
      try {
        await withCrispMock(
          {
            status,
            json: { error: true, reason, data: { message } },
            headers: status === 429 ? { "retry-after": "3" } : {},
          },
          async (dispatcher) => {
            const code = await run(["--json", ...verb.argv], { ...io, env, dispatcher })
            assert.equal(code, 1)
            assert.equal(io.out(), "")
            const body = JSON.parse(io.err()) as {
              ok: false
              status: number
              reason: string
              message: string
              retry_after?: string
            }
            assert.equal(body.ok, false)
            assert.equal(body.status, status)
            assert.equal(body.reason, reason)
            assert.equal(body.message.includes(FIXTURE.key), false)
            assert.match(body.message, status === 429 ? /\[redacted\]/ : /bad session/)
            if (status === 429) {
              assert.equal(body.retry_after, "3")
            }
          },
        )
      } finally {
        removeHome(env)
      }
    })
  }
}

test("people get email searches then fetches the matching people_id", async () => {
  const env = credentialEnv()
  const io = buffers()
  const profile = { people_id: "people_1", email: "ada@example.com" }
  try {
    const calls = await withCrispMock(
      [
        {
          status: 200,
          json: okEnvelope([{ people_id: "other", email: "ada@example.com.extra" }, profile]),
        },
        { status: 200, json: okEnvelope(profile) },
      ],
      async (dispatcher) => {
        const code = await run(["--json", "people", "get", "Ada@Example.com"], {
          ...io,
          env,
          dispatcher,
        })
        assert.equal(code, 0)
        assert.deepEqual(JSON.parse(io.out()), profile)
      },
    )
    assert.equal(calls.length, 2)
    assertUrl(calls[0]?.path ?? "", `${site}/people/profiles/1?search_text=Ada@Example.com`)
    assertUrl(calls[1]?.path ?? "", `${site}/people/profile/people_1`)
    assert.equal(calls[1]?.path.includes("Ada"), false)
    assert.equal(calls[1]?.path.includes("%40"), false)
  } finally {
    removeHome(env)
  }
})

for (const status of [400, 429]) {
  test(`people get email HTTP ${status} stays on the search route`, async () => {
    const env = credentialEnv()
    const io = buffers()
    const reason = status === 429 ? "rate_limited" : "invalid_data"
    try {
      const calls = await withCrispMock(
        {
          status,
          json: { error: true, reason, data: { message: "search failed" } },
          headers: status === 429 ? { "retry-after": "3" } : {},
        },
        async (dispatcher) => {
          const code = await run(["--json", "people", "get", "ada@example.com"], {
            ...io,
            env,
            dispatcher,
          })
          assert.equal(code, 1)
          const body = JSON.parse(io.err()) as { status: number; reason: string }
          assert.equal(body.status, status)
          assert.equal(body.reason, reason)
        },
      )
      assert.equal(calls.length, 1)
      assertUrl(calls[0]?.path ?? "", `${site}/people/profiles/1?search_text=ada@example.com`)
    } finally {
      removeHome(env)
    }
  })
}

test("people get email with no exact match does not fetch a profile", async () => {
  const env = credentialEnv()
  const io = buffers()
  try {
    const calls = await withCrispMock(
      {
        status: 200,
        json: okEnvelope([{ people_id: "other", email: "someone@example.com" }]),
      },
      async (dispatcher) => {
        const code = await run(["--json", "people", "get", "ada@example.com"], {
          ...io,
          env,
          dispatcher,
        })
        assert.equal(code, 1)
        const body = JSON.parse(io.err()) as { status: number; reason: string }
        assert.equal(body.status, 404)
        assert.equal(body.reason, "not_found")
      },
    )
    assert.equal(calls.length, 1)
    assertUrl(calls[0]?.path ?? "", `${site}/people/profiles/1?search_text=ada@example.com`)
  } finally {
    removeHome(env)
  }
})

test("search segment query and people id are encoded on the path", async () => {
  const env = credentialEnv()
  const io = buffers()
  try {
    const calls = await withCrispMock({ status: 200, json: okEnvelope([]) }, async (dispatcher) => {
      const code = await run(
        ["conversations", "search", "need help", "--search-type", "segment", "--json"],
        { ...io, env, dispatcher },
      )
      assert.equal(code, 0)
    })
    assertUrl(
      calls[0]?.path ?? "",
      `${site}/conversations/1?search_query=need+help&search_type=segment`,
    )
  } finally {
    removeHome(env)
  }

  const env2 = credentialEnv()
  const io2 = buffers()
  try {
    const calls = await withCrispMock(
      { status: 200, json: okEnvelope({ people_id: "p1" }) },
      async (dispatcher) => {
        const code = await run(["people", "get", "people_1", "--json"], {
          ...io2,
          env: env2,
          dispatcher,
        })
        assert.equal(code, 0)
      },
    )
    assertUrl(calls[0]?.path ?? "", `${site}/people/profile/people_1`)
  } finally {
    removeHome(env2)
  }
})

test("--website overrides the env website id on the path", async () => {
  const override = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  const env = credentialEnv()
  const io = buffers()
  try {
    const calls = await withCrispMock({ status: 200, json: okEnvelope([]) }, async (dispatcher) => {
      const code = await run(["--website", override, "--json", "operators", "list"], {
        ...io,
        env,
        dispatcher,
      })
      assert.equal(code, 0)
    })
    assertUrl(calls[0]?.path ?? "", `/v1/website/${override}/operators/list`)
    assert.equal(calls[0]?.path.includes(FIXTURE.websiteId), false)
  } finally {
    removeHome(env)
  }
})

test("website tier is sent on X-Crisp-Tier", async () => {
  const env = credentialEnv({ CRISP_TIER: "website" })
  const io = buffers()
  try {
    const calls = await withCrispMock({ status: 200, json: okEnvelope([]) }, async (dispatcher) => {
      const code = await run(["operators", "list", "--json"], { ...io, env, dispatcher })
      assert.equal(code, 0)
    })
    assert.equal(calls[0]?.headers["x-crisp-tier"], "website")
  } finally {
    removeHome(env)
  }
})

test("package version matches the user agent source", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string
  }
  assert.equal(version, pkg.version)
})
