import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDirectInvocation } from "../src/index.js"
import { run } from "../src/cli.js"
import { buffers, credentialEnv, FIXTURE, okEnvelope, removeHome, withCrispMock } from "./support.js"

const COMMANDS = [
  "auth set",
  "auth show",
  "conversations list",
  "conversations get",
  "conversations search",
  "messages list",
  "reply",
  "resolve",
  "reopen",
  "assign",
  "segments",
  "read",
  "people get",
  "operators list",
  "listen",
]

test("root help lists every MVP command", async () => {
  const io = buffers()
  const code = await run(["--help"], { ...io, env: { HOME: tmpdir() } })
  assert.equal(code, 0)
  for (const command of COMMANDS) {
    assert.equal(io.out().includes(command), true, command)
  }
  assert.match(io.out(), /Cos Crisp sandbox/)
  assert.match(io.out(), /Teachify/)
})

test("subcommand help exits 0", async () => {
  for (const command of ["auth", "conversations", "messages", "reply", "resolve", "reopen", "assign", "segments", "read", "people", "operators", "listen"]) {
    const io = buffers()
    const code = await run([command, "--help"], { ...io, env: { HOME: tmpdir() } })
    assert.equal(code, 0, command)
    assert.match(io.out(), new RegExp(command))
  }
})

test("version, unknown command, and usage errors", async () => {
  const versionIo = buffers()
  assert.equal(await run(["--version"], { ...versionIo, env: { HOME: tmpdir() } }), 0)
  assert.match(versionIo.out(), /^\d+\.\d+\.\d+\n$/)

  const jsonVersion = buffers()
  assert.equal(await run(["--json", "--version"], { ...jsonVersion, env: { HOME: tmpdir() } }), 0)
  assert.equal(JSON.parse(jsonVersion.out()).version, versionIo.out().trim())

  const bare = buffers()
  assert.equal(await run([], { ...bare, env: { HOME: tmpdir() } }), 0)
  assert.match(bare.out(), /conversations list/)
  const topic = buffers()
  assert.equal(await run(["help", "reply"], { ...topic, env: { HOME: tmpdir() } }), 0)
  assert.match(topic.out(), /--note/)
  const unknownHelp = buffers()
  assert.equal(await run(["--help", "nope"], { ...unknownHelp, env: { HOME: tmpdir() } }), 0)
  assert.match(unknownHelp.out(), /Unknown command: nope/)

  const unknown = buffers()
  assert.equal(await run(["nope"], { ...unknown, env: { HOME: tmpdir() } }), 2)
  assert.match(unknown.err(), /unknown command: nope/)

  const reply = buffers()
  assert.equal(await run(["--json", "reply", FIXTURE.session, "--text", "hi", "--note", "x"], {
    ...reply,
    env: credentialEnv(),
  }), 2)
  assert.equal(JSON.parse(reply.err()).error, "usage")

  const assign = buffers()
  const env = credentialEnv()
  try {
    assert.equal(await run(["assign", FIXTURE.session], { ...assign, env }), 2)
    assert.match(assign.err(), /assign/)
    const both = buffers()
    assert.equal(await run(["assign", FIXTURE.session, "--user", "u", "--unassign"], { ...both, env }), 2)
    const page = buffers()
    assert.equal(await run(["conversations", "list", "--page", "0"], { ...page, env }), 2)
    const search = buffers()
    assert.equal(await run(["conversations", "search", "q", "--search-type", "filter"], { ...search, env }), 2)
    const flag = buffers()
    assert.equal(await run(["resolve", FIXTURE.session, "--text", "nope"], { ...flag, env }), 2)
    assert.match(flag.err(), /unexpected flag/)
    const disagree = buffers()
    assert.equal(await run(["--website", "a", "--website-id", "b", "operators", "list"], { ...disagree, env }), 2)
    assert.match(disagree.err(), /disagree/)
    const short = buffers()
    assert.equal(await run(["-x"], { ...short, env }), 2)
    const boolFlag = buffers()
    assert.equal(await run(["--json=true"], { ...boolFlag, env }), 2)
    const missingValue = buffers()
    assert.equal(await run(["--profile"], { ...missingValue, env }), 2)
    const extra = buffers()
    assert.equal(await run(["auth", "set", "extra"], { ...extra, env }), 2)
  } finally {
    removeHome(env)
  }
})

test("auth set stores a 0600 profile and auth show redacts the key", async () => {
  const home = mkdtempSync(join(tmpdir(), "crispctl-auth-"))
  const env: NodeJS.ProcessEnv = { HOME: home }
  const key = "sandbox-profile-token-key"
  try {
    const setIo = buffers()
    const code = await run([
      "--profile", "sandbox",
      "--json",
      "auth", "set",
      "--identifier", "id-sandbox",
      "--key", key,
      "--tier", "website",
      "--website", "website-sandbox",
    ], { ...setIo, env })
    assert.equal(code, 0)
    const saved = JSON.parse(setIo.out()) as { profile: string; website_id: string }
    assert.equal(saved.profile, "sandbox")
    assert.equal(saved.website_id, "website-sandbox")
    assert.equal(setIo.out().includes(key), false)

    const path = join(home, ".config", "crispctl", "config.json")
    assert.equal(statSync(path).mode & 0o777, 0o600)
    const file = JSON.parse(readFileSync(path, "utf8")) as { current: string; profiles: { sandbox: { key: string } } }
    assert.equal(file.current, "sandbox")
    assert.equal(file.profiles.sandbox.key, key)

    const showIo = buffers()
    assert.equal(await run(["auth", "show", "--json"], { ...showIo, env }), 0)
    const view = JSON.parse(showIo.out()) as { key: string; profile: string; tier: string; identifier: string }
    assert.equal(view.key, "set")
    assert.equal(view.profile, "sandbox")
    assert.equal(view.tier, "website")
    assert.equal(view.identifier, "id-sandbox")
    assert.equal(showIo.out().includes(key), false)
    assert.equal(showIo.err().includes(key), false)

    const partial = buffers()
    assert.equal(await run(["--profile", "sandbox", "auth", "set", "--tier", "plugin"], { ...partial, env }), 0)
    assert.equal(partial.out().includes(key), false)
    const updated = JSON.parse(readFileSync(path, "utf8")) as { profiles: { sandbox: { key: string; tier: string } } }
    assert.equal(updated.profiles.sandbox.key, key)
    assert.equal(updated.profiles.sandbox.tier, "plugin")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("auth set can persist env credentials and refuses an incomplete profile", async () => {
  const home = mkdtempSync(join(tmpdir(), "crispctl-env-auth-"))
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    CRISPCTL_IDENTIFIER: "env-id",
    CRISPCTL_KEY: "env-token-key-value",
    CRISPCTL_TIER: "plugin",
    CRISPCTL_WEBSITE_ID: "env-website",
  }
  try {
    const io = buffers()
    assert.equal(await run(["--profile", "default", "auth", "set", "--json"], { ...io, env }), 0)
    assert.equal(io.out().includes("env-token-key-value"), false)
    const missing = buffers()
    const bare: NodeJS.ProcessEnv = { HOME: mkdtempSync(join(tmpdir(), "crispctl-bare-")) }
    assert.equal(await run(["auth", "set"], { ...missing, env: bare }), 2)
    rmSync(bare.HOME ?? "", { recursive: true, force: true })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("missing credentials fail before a request and do not print a key", async () => {
  const env = credentialEnv({ CRISP_KEY: undefined, CRISPCTL_KEY: undefined })
  const io = buffers()
  try {
    const calls = await withCrispMock({ status: 200, json: okEnvelope([]) }, async (dispatcher) => {
      const code = await run(["operators", "list", "--json"], { ...io, env, dispatcher })
      assert.equal(code, 2)
    })
    assert.equal(calls.length, 0)
    assert.match(io.err(), /missing credentials: key/)
    assert.equal(io.out(), "")
  } finally {
    removeHome(env)
  }
})

test("listen requires credentials", async () => {
  const io = buffers()
  const code = await run(["listen", "--json"], { ...io, env: { HOME: tmpdir() } })
  assert.equal(code, 2)
  assert.equal(io.out(), "")
  assert.equal(JSON.parse(io.err()).error, "config")
})

test("human errors stay on stderr", async () => {
  const env = credentialEnv()
  const io = buffers()
  try {
    await withCrispMock({
      status: 404,
      json: { error: true, reason: "not_found", data: { message: "missing" } },
    }, async (dispatcher) => {
      const code = await run(["conversations", "get", FIXTURE.session], { ...io, env, dispatcher })
      assert.equal(code, 1)
      assert.equal(io.out(), "")
      assert.match(io.err(), /404 not_found: missing/)
    })
  } finally {
    removeHome(env)
  }
})

test("bin --help runs as the CLI entry", () => {
  const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url))
  assert.equal(isDirectInvocation(entry, pathToFileURL(entry).href), true)
  assert.equal(isDirectInvocation(undefined, pathToFileURL(entry).href), false)
  assert.equal(isDirectInvocation(join(tmpdir(), "missing-entry"), pathToFileURL(entry).href), false)

  const home = mkdtempSync(join(tmpdir(), "crispctl-bin-"))
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home }
  for (const key of Object.keys(env)) {
    if (key.startsWith("CRISP")) delete env[key]
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", entry, "--help"], {
    encoding: "utf8",
    env,
  })
  rmSync(home, { recursive: true, force: true })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /crispctl/)
  for (const command of COMMANDS) {
    assert.equal(result.stdout.includes(command), true, command)
  }
})

test("package.json is publishable as crispctl", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    name: string
    license: string
    type: string
    bin: { crispctl: string }
    engines: { node: string }
  }
  assert.equal(pkg.name, "crispctl")
  assert.equal(pkg.bin.crispctl, "./dist/index.js")
  assert.equal(pkg.license, "MIT")
  assert.equal(pkg.type, "module")
  assert.equal(pkg.engines.node, ">=22.12.0")
})
