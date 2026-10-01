import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"
import { Writable } from "node:stream"

assert.equal(typeof global.gc, "function", "run with --expose-gc")
const root = resolve(process.argv[2] ?? ".")
const { OutputSink } = await import(pathToFileURL(join(root, "dist/output-sink.js")))
const { writeOut } = await import(pathToFileURL(join(root, "dist/output.js")))
let sent = 0,
  received = 0
const stream = new Writable({
  write(chunk, _encoding, callback) {
    const event = JSON.parse(chunk.toString())
    assert.equal(event.data.index, received++)
    assert.equal(event.data.content, "[redacted]")
    queueMicrotask(callback)
  },
})
const sink = new OutputSink(stream, () => assert.fail("unexpected output failure"), "stdout")
async function batch() {
  for (let index = 0; index < 1000; index++)
    writeOut(
      sink.write,
      true,
      {
        event: "message:received",
        received_at: "2026-01-01T00:00:00.000Z",
        data: { website_id: "synthetic-site", index: sent++, content: "synthetic-key" },
      },
      ["synthetic-key"],
    )
  await sink.flush()
  assert.equal(sent, received)
}
function snapshot() {
  global.gc()
  return {
    received,
    heapUsedMiB: process.memoryUsage().heapUsed / 1048576,
    rssMiB: process.memoryUsage().rss / 1048576,
  }
}
try {
  for (let round = 0; round < 5; round++) await batch()
  const snapshots = [snapshot()]
  const started = performance.now()
  for (let round = 0; round < 100; round++) {
    await batch()
    if ((round + 1) % 20 === 0) snapshots.push(snapshot())
  }
  console.log(
    JSON.stringify(
      {
        node: process.version,
        measuredRecords: 100000,
        warmupRecords: 5000,
        durationMs: performance.now() - started,
        snapshots,
        methodology:
          "Output pipeline only; batches of 1000, one reused sink, validation and periodic forced GC included; no network or timing gate.",
      },
      null,
      2,
    ),
  )
} finally {
  sink.dispose()
  stream.destroy()
}
