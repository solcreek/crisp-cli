import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { test } from "node:test"
import { monitorRtmSmoke, observeJsonLines } from "../scripts/rtm-smoke-monitor.mjs"

function fixture() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kills = []
  child.kill = (signal) => {
    child.kills.push(signal)
    return true
  }
  child.unref = () => {
    child.unreferenced = true
  }
  return child
}
const auth = JSON.stringify({ status: "authenticated" }) + "\n"
const event =
  JSON.stringify({
    event: "fixture",
    data: { website_id: "fixture-site", content: "private fixture" },
  }) + "\n"

async function close(child, code = 0) {
  child.stdout.end()
  child.stderr.end()
  await new Promise((resolve) => setImmediate(resolve))
  child.emit("close", code)
}

function monitor(child, overrides = {}) {
  const signals = new EventEmitter()
  const reports = []
  const result = monitorRtmSmoke(child, {
    websiteId: "fixture-site",
    mode: "event",
    report: (value) => reports.push(value),
    signals,
    timeoutMs: 2000,
    killGraceMs: 10,
    ...overrides,
  })
  return { result, signals, reports }
}

test("NDJSON handles split UTF-8, blank lines and multiple records", async () => {
  const stream = new PassThrough()
  const records = []
  const detach = observeJsonLines(
    stream,
    (value) => records.push(value),
    () => assert.fail("valid stream"),
  )
  const bytes = Buffer.from('\n{"value":"一"}\n  \n{}\n')
  const offset = bytes.indexOf(Buffer.from("一")) + 1
  stream.write(bytes.subarray(0, offset))
  stream.end(bytes.subarray(offset))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(records, [{ value: "一" }, {}])
  detach()
  assert.equal(stream.listenerCount("data"), 0)
})

for (const input of [
  '{"secret":',
  "{bad}\n",
  "null\n",
  "[]\n",
  "1\n",
  '"private"\n',
  '{"value":"too-long"}\n',
  "123456789",
]) {
  test(`NDJSON safely rejects invalid or oversized input ${JSON.stringify(input)}`, async () => {
    const stream = new PassThrough()
    let failures = 0
    const detach = observeJsonLines(
      stream,
      () => assert.fail("must reject"),
      () => failures++,
      8,
    )
    stream.write(input)
    stream.write("ignored after failure")
    stream.end()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(failures, 1)
    detach()
  })
}

test("NDJSON reports stream and consumer errors only once", () => {
  for (const source of ["stream", "consumer"]) {
    const stream = new PassThrough()
    let failures = 0
    const detach = observeJsonLines(
      stream,
      () => {
        throw new Error("private")
      },
      () => failures++,
    )
    if (source === "stream") stream.emit("error", new Error("private"))
    else stream.write("{}\n")
    stream.emit("error", new Error("private again"))
    assert.equal(failures, 1)
    detach()
  }
})

test("monitor waits for close, validates website and emits only assertion metadata", async () => {
  const child = fixture()
  const { result, reports, signals } = monitor(child)
  child.emit("exit", 0)
  child.stdout.write(event)
  child.stderr.write(auth)
  await close(child)
  assert.equal(await result, true)
  assert.equal(child.kills.length, 0)
  assert.doesNotMatch(JSON.stringify(reports), /private|fixture-site|"content"|website_id/)
  assert.equal(reports.at(-1).received_events, 1)
  for (const source of [child, child.stdout, child.stderr, signals])
    for (const name of ["data", "end", "error", "close", "SIGTERM", "SIGINT"])
      assert.equal(source.listenerCount(name), 0, name)
})

test("auth mode stops once without claiming event delivery", async () => {
  const child = fixture()
  const { result, reports } = monitor(child, { mode: "auth" })
  child.stderr.write(auth + auth)
  assert.deepEqual(child.kills, ["SIGTERM"])
  await close(child)
  assert.equal(await result, true)
  assert.equal(reports.at(-1).received_events, 0)
})

for (const mode of [
  "missing-auth",
  "missing-event",
  "exit-error",
  "spawn-error",
  "parser-error",
  "truncated",
  "status-error",
  "wrong-website",
  "missing-data",
  "invalid-data",
  "missing-website",
  "missing-event-name",
  "SIGINT",
  "SIGTERM",
]) {
  test(`monitor fails safely for ${mode} and removes listeners`, async () => {
    const child = fixture()
    const { result, reports, signals } = monitor(child)
    if (mode !== "missing-auth") child.stderr.write(auth)
    if (mode !== "missing-event") child.stdout.write(event)
    if (mode === "spawn-error") child.emit("error", new Error("private credential"))
    if (mode === "parser-error") child.stdout.write("private not JSON\n")
    if (mode === "truncated") child.stdout.write('{"unfinished":true}')
    if (mode === "status-error") child.stderr.write('{"error":"private"}\n')
    if (mode === "wrong-website")
      child.stdout.write('{"event":"test","data":{"website_id":"other"}}\n')
    if (mode === "missing-data") child.stdout.write("{}\n")
    if (mode === "invalid-data") child.stdout.write('{"data":1}\n')
    if (mode === "missing-website") child.stdout.write('{"data":{}}\n')
    if (mode === "missing-event-name")
      child.stdout.write('{"data":{"website_id":"fixture-site"}}\n')
    if (mode === "SIGINT" || mode === "SIGTERM") signals.emit(mode)
    await close(child, mode === "exit-error" ? 1 : 0)
    assert.equal(await result, false)
    assert.doesNotMatch(JSON.stringify(reports), /private/)
    assert.equal(signals.eventNames().length, 0)
    assert.equal(child.listenerCount("close"), 0)
  })
}

test("watchdog escalates an unresponsive child and bounds verification", async () => {
  const child = fixture()
  const { result, reports, signals } = monitor(child, { timeoutMs: 5, killGraceMs: 5 })
  child.stderr.write('{"status":"connecting"}\n')
  assert.equal(await result, false)
  assert.deepEqual(child.kills, ["SIGTERM", "SIGKILL"])
  assert.equal(child.stdout.destroyed, true)
  assert.equal(child.stderr.destroyed, true)
  assert.equal(child.unreferenced, true)
  assert.equal(reports.at(-1).exit_code, null)
  assert.equal(signals.eventNames().length, 0)
})

test("default monitor options work and close cancels the watchdog", async () => {
  const child = fixture()
  const before = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")]
  const result = monitorRtmSmoke(child, { websiteId: "fixture-site", mode: "event", report() {} })
  child.stderr.write(auth)
  child.stdout.write(event)
  await close(child)
  assert.equal(await result, true)
  assert.deepEqual([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")], before)
})

test("a stream closed without end cannot hide a truncated record", async () => {
  const child = fixture()
  const { result } = monitor(child)
  child.stderr.write(auth)
  child.stdout.write(event + '{"unfinished":')
  child.stdout.destroy()
  await close(child)
  assert.equal(await result, false)
})
