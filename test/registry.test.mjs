import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { once } from "node:events"
import test from "node:test"
import { assertReleaseVersion, waitForPublishedVersion } from "../scripts/registry.mjs"

const version = "0.4.0"
const metadata = { name: "crispctl", version }

function simulated(replies, extra = {}) {
  let elapsed = 0
  const requests = []
  const reports = []
  const waits = []
  return {
    requests,
    reports,
    waits,
    run: () =>
      waitForPublishedVersion(version, {
        timeoutMs: 50,
        intervalMs: 20,
        now: () => elapsed,
        sleep: async (ms) => {
          waits.push(ms)
          elapsed += ms
        },
        report: (event) => reports.push(event),
        fetchMetadata: async (url, options) => {
          assert.equal(url, "https://registry.npmjs.org/crispctl/0.4.0")
          assert.equal(options.redirect, "error")
          assert.ok(options.signal instanceof AbortSignal)
          const value = replies[Math.min(requests.length, replies.length - 1)]
          requests.push(url)
          if (value instanceof Error) throw value
          return new Response(
            typeof value.body === "string" ? value.body : JSON.stringify(value.body),
            { status: value.status },
          )
        },
        ...extra,
      }),
  }
}

test("release verification only accepts exact versions before any registry access", async () => {
  for (const value of [
    "0.4.0",
    "1.0.0-rc.1",
    "1.0.0-0",
    "1.0.0-0.3.7",
    "1.0.0-10",
    "1.0.0-01alpha",
    "1.0.0-alpha01",
    "1.0.0-01-alpha",
    "1.0.0-x-y-z.--",
  ])
    assert.doesNotThrow(() => assertReleaseVersion(value))
  for (const value of [
    "latest",
    "v0.4.0",
    "^0.4.0",
    "0.4",
    "01.2.3",
    "--help",
    "https://example.test",
    "0.4.0;false",
    "1.0.0-01",
    "1.0.0-00",
    "1.0.0-rc.01",
    "1.0.0-01.rc",
    "1.0.0-alpha.1.00",
    "1.0.0-",
    "1.0.0-rc..1",
    "1.0.0\n",
    "1.0.0-rc.1\n",
  ]) {
    assert.throws(() => assertReleaseVersion(value), /exact release version/, value)
    let requests = 0
    await assert.rejects(
      waitForPublishedVersion(value, {
        timeoutMs: 10,
        intervalMs: 1,
        fetchMetadata: async () => {
          requests++
          return new Response(null, { status: 404 })
        },
      }),
      /exact release version/,
    )
    assert.equal(requests, 0, value)
  }
})

test("registry 404 retries until the exact version is visible", async () => {
  const check = simulated([{ status: 404 }, { status: 200, body: metadata }])
  assert.deepEqual(await check.run(), metadata)
  assert.deepEqual(check.waits, [20])
  assert.deepEqual(
    check.reports.map((event) => event.check),
    ["registry-pending", "registry-available"],
  )
  assert.equal(check.reports.at(-1).attempts, 2)
})

for (const initial of [
  { status: 429 },
  { status: 503 },
  new Error("private transport detail"),
  { status: 200, body: "partial JSON" },
  { status: 200, body: null },
]) {
  test(`transient registry failure is retried: ${initial.status ?? "network"} ${typeof initial.body}`, async () => {
    const check = simulated([initial, { status: 200, body: metadata }])
    assert.deepEqual(await check.run(), metadata)
    assert.equal(check.requests.length, 2)
    assert.ok(!JSON.stringify(check.reports).includes("private transport detail"))
  })
}

test("persistent registry delay has a bounded deadline and never asks for republishing", async () => {
  const check = simulated([{ status: 404 }])
  await assert.rejects(check.run(), /rerun verification without republishing/)
  assert.equal(check.requests.length, 3)
  assert.deepEqual(check.waits, [20, 20, 10])
})

for (const status of [400, 401, 403]) {
  test(`HTTP ${status} fails immediately without retrying`, async () => {
    const check = simulated([{ status, body: "private registry error" }])
    await assert.rejects(check.run(), new RegExp(`HTTP ${status}$`))
    assert.equal(check.requests.length, 1)
    assert.deepEqual(check.waits, [])
  })
}

for (const body of [
  { name: "wrong", version },
  { name: "crispctl", version: "9.9.9" },
]) {
  test(`unexpected metadata fails before installation: ${JSON.stringify(body)}`, async () => {
    const check = simulated([{ status: 200, body }])
    await assert.rejects(check.run(), /unexpected package metadata/)
    assert.equal(check.requests.length, 1)
  })
}

test("registry deadline aborts a stalled real HTTP response body", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" })
    response.write('{"name":')
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address()
  try {
    await assert.rejects(
      waitForPublishedVersion(version, {
        timeoutMs: 100,
        intervalMs: 1,
        requestTimeoutMs: 30,
        fetchMetadata: (_url, options) => fetch(`http://127.0.0.1:${port}`, options),
      }),
      /registry wait deadline/,
    )
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

test("published smoke rejects invalid versions as structured errors", () => {
  for (const value of ["latest", "1.0.0-01", "1.0.0-rc.01"]) {
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "./test/fixtures/mock-published-smoke.mjs",
        "scripts/published-smoke.mjs",
        value,
      ],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    )
    assert.ifError(child.error)
    assert.equal(child.status, 1)
    assert.equal(child.stdout, "")
    const failure = JSON.parse(child.stderr)
    assert.equal(failure.version, value)
    assert.equal(failure.passed, false)
    assert.match(failure.message, /exact release version/)
  }
})

test("published smoke hides npm subprocess output when installation fails", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "./test/fixtures/mock-published-smoke.mjs",
      "scripts/published-smoke.mjs",
      version,
    ],
    { encoding: "utf8", timeout: 5000 },
  )
  assert.ifError(child.error)
  assert.equal(child.status, 1)
  assert.equal(JSON.parse(child.stdout).check, "registry-available")
  assert.equal(JSON.parse(child.stderr).passed, false)
  assert.match(JSON.parse(child.stderr).message, /installation or executable smoke failed/)
  assert.ok(!(child.stdout + child.stderr).includes("private npm output"))
})
