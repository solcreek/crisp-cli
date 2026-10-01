import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { CrispClient } from "../src/client.js"
import { run } from "../src/cli.js"
import {
  buffers,
  credentialEnv,
  FIXTURE,
  okEnvelope,
  removeHome,
  withCrispMock,
} from "./support.js"

const pages = [
  {
    page_title: "說明中心",
    page_url: "https://example.test/help?q=account&lang=zh#contact",
    page_referrer: "https://example.test/",
    timestamp: 1790812800000,
  },
  { page_title: "", page_url: "https://example.test/", timestamp: 1790812700000 },
]

for (const mode of ["flag", "env"] as const) {
  test(`pages preserves the history payload in read-only ${mode} mode`, async () => {
    const env = credentialEnv(mode === "env" ? { CRISPCTL_READ_ONLY: "1" } : {})
    const io = buffers()
    try {
      const calls = await withCrispMock(
        { status: 200, json: okEnvelope(pages) },
        async (dispatcher) => {
          assert.equal(
            await run(
              [
                "conversations",
                "pages",
                FIXTURE.session,
                "--json",
                ...(mode === "flag" ? ["--read-only"] : []),
              ],
              { ...io, env, dispatcher },
            ),
            0,
          )
        },
      )
      assert.equal(calls.length, 1)
      assert.equal(calls[0]?.method, "GET")
      assert.equal(calls[0]?.body, null)
      assert.equal(
        calls[0]?.path,
        `/v1/website/${FIXTURE.websiteId}/conversation/${FIXTURE.session}/pages/1`,
      )
      assert.deepEqual(JSON.parse(io.out()), pages)
      assert.equal(io.out().trim().split("\n").length, 1)
      assert.equal(io.err(), "")
    } finally {
      removeHome(env)
    }
  })
}

test("pages requests only the selected page and preserves empty results", async () => {
  const env = credentialEnv()
  try {
    const calls = await withCrispMock(
      [
        { status: 200, json: okEnvelope(pages) },
        { status: 200, json: okEnvelope([]) },
      ],
      async (dispatcher) => {
        for (const page of [2, 3]) {
          const io = buffers()
          assert.equal(
            await run(
              ["--page", String(page), "conversations", "pages", FIXTURE.session, "--json"],
              { ...io, env, dispatcher },
            ),
            0,
          )
          assert.deepEqual(JSON.parse(io.out()), page === 2 ? pages : [])
          assert.equal(io.err(), "")
        }
      },
    )
    assert.deepEqual(
      calls.map((call) => call.path),
      [2, 3].map(
        (page) => `/v1/website/${FIXTURE.websiteId}/conversation/${FIXTURE.session}/pages/${page}`,
      ),
    )
  } finally {
    removeHome(env)
  }
})

test("pages client defaults to page 1 and encodes the session as one path segment", async () => {
  const session = "session/a?b#c"
  const calls = await withCrispMock(
    { status: 200, json: okEnvelope(pages) },
    async (dispatcher) => {
      const client = new CrispClient({ ...FIXTURE, tier: "website" }, dispatcher, true)
      assert.deepEqual(await client.listConversationPages(session), pages)
    },
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.method, "GET")
  assert.equal(
    calls[0]?.path,
    `/v1/website/${FIXTURE.websiteId}/conversation/${encodeURIComponent(session)}/pages/1`,
  )
})

for (const args of [
  ["conversations", "pages"],
  ["conversations", "pages", " "],
  ["conversations", "pages", FIXTURE.session, "extra"],
  ["conversations", "pages", FIXTURE.session, "--search-type", "text"],
]) {
  test(`pages rejects invalid arguments before access: ${JSON.stringify(args)}`, async () => {
    const io = buffers()
    const calls = await withCrispMock({ status: 200, json: okEnvelope([]) }, async (dispatcher) => {
      assert.equal(await run([...args, "--json"], { ...io, env: {}, dispatcher }), 2)
    })
    assert.equal(calls.length, 0)
    assert.equal(io.out(), "")
    assert.equal(JSON.parse(io.err()).error, "usage")
  })
}

for (const [status, reason] of [
  [403, "not_allowed"],
  [404, "not_found"],
  [429, "rate_limited"],
] as const) {
  test(`pages exposes HTTP ${status} as a JSON error without history output`, async () => {
    const env = credentialEnv()
    const io = buffers()
    try {
      const calls = await withCrispMock(
        {
          status,
          json: { error: true, reason, data: {} },
          headers: { "retry-after": "3" },
        },
        async (dispatcher) => {
          assert.equal(
            await run(["conversations", "pages", FIXTURE.session, "--json"], {
              ...io,
              env,
              dispatcher,
            }),
            1,
          )
        },
      )
      assert.equal(calls.length, 1)
      assert.equal(io.out(), "")
      const error = JSON.parse(io.err())
      assert.equal(error.status, status)
      assert.equal(error.reason, reason)
      assert.equal(error.retry_after, "3")
    } finally {
      removeHome(env)
    }
  })
}

test("built CLI reads a history page with fixture credentials and real network disabled", async () => {
  const env = credentialEnv({ CRISPCTL_READ_ONLY: "1" })
  try {
    const result = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        fileURLToPath(new URL("./fixtures/mock-pages.mjs", import.meta.url)),
        fileURLToPath(new URL("../dist/index.js", import.meta.url)),
        "conversations",
        "pages",
        FIXTURE.session,
        "--page",
        "2",
        "--json",
      ],
      { env, timeout: 10_000 },
    )
    assert.deepEqual(JSON.parse(result.stdout), [
      {
        page_title: "Help",
        page_url: "https://example.test/help",
        timestamp: 1790812800000,
      },
    ])
    assert.equal(result.stderr, "")
  } finally {
    removeHome(env)
  }
})
