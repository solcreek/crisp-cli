import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { performance } from "node:perf_hooks"
import { Writable } from "node:stream"
import { pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import { summarize } from "./benchmark-process.mjs"

// Component costs are measured after import/JIT warmup, separately from process
// benchmarks. Never add these timings together to estimate end-to-end latency.
const { values } = parseArgs({
  options: {
    target: { type: "string", default: "." },
    samples: { type: "string", default: "20" },
  },
})
const count = Number(values.samples)
if (!/^\d+$/.test(values.samples) || count < 1 || count > 1000)
  throw new Error("--samples must be an integer from 1 to 1000")
const target = resolve(values.target)
const load = (file) => import(pathToFileURL(join(target, "dist", `${file}.js`)).href)
const { createCommandTree } = await load("command-tree")
const { resolveCredentials } = await load("config")
const { InvocationCredentials } = await load("invocation-credentials")
const { readResponseText, decodeResponse } = await load("response")
const { writeOut } = await load("output")
const { OutputSink } = await load("output-sink")
const directory = mkdtempSync(join(tmpdir(), "crispctl-stage-benchmark-"))
const key = 'synthetic-key"\\.*'
const profile = {
  identifier: "synthetic-identifier",
  key,
  tier: "website",
  website_id: "synthetic-site",
}
const env = { CRISPCTL_CONFIG: join(directory, "config.json") }
writeFileSync(
  env.CRISPCTL_CONFIG,
  JSON.stringify({ current: "default", profiles: { default: profile } }),
)
const events = Array.from({ length: 1000 }, (_, index) => ({
  event: "message:received",
  received_at: "2026-01-01T00:00:00.000Z",
  data: {
    website_id: "synthetic-site",
    session_id: `synthetic-${index}`,
    content: "x".repeat(256),
    [key]: key,
  },
}))
const payload = {
  rows: Array.from({ length: 1024 }, (_, index) => ({ index, content: "x".repeat(1024) })),
}
const text = JSON.stringify({ error: false, data: payload })
const bytes = Buffer.from(text)
const flags = {
  json: false,
  help: false,
  version: false,
  readOnly: false,
  listEvents: false,
  unassign: false,
}
const scenarios = [
  {
    name: "command-tree-100",
    operations: 100,
    run() {
      for (let i = 0; i < 100; i++) assert.ok(createCommandTree())
    },
  },
  {
    name: "tree-and-parse-100",
    operations: 100,
    run() {
      for (let i = 0; i < 100; i++) {
        const tree = createCommandTree()
        assert.equal(
          tree.prepare(["conversations", "list", "--json", "--page", "2"]).flags.page,
          "2",
        )
      }
    },
  },
  {
    name: "config-file-100",
    operations: 100,
    run() {
      for (let i = 0; i < 100; i++) assert.equal(resolveCredentials(env, {}).key, key)
    },
  },
  {
    name: "credential-snapshot-1000",
    operations: 1000,
    run() {
      const credentials = new InvocationCredentials(env, [])
      const first = credentials.resolve(flags)
      for (let i = 0; i < 1000; i++) assert.equal(credentials.resolve(flags), first)
    },
  },
  {
    name: "body-read-1mib",
    operations: 1,
    async run() {
      let offset = 0
      const body = new ReadableStream({
        pull(controller) {
          if (offset === bytes.length) {
            controller.close()
            return
          }
          const end = Math.min(offset + 16384, bytes.length)
          controller.enqueue(bytes.subarray(offset, end))
          offset = end
        },
      })
      assert.equal(
        await readResponseText(
          { body, status: 200, headers: new Headers() },
          new AbortController().signal,
        ),
        text,
      )
    },
  },
  {
    name: "decode-1mib",
    operations: 1,
    run() {
      assert.equal(decodeResponse(text, 200).rows.length, 1024)
    },
  },
  {
    name: "json-output-1mib",
    operations: 1,
    run() {
      let output = ""
      writeOut((chunk) => (output += chunk), true, payload)
      assert.equal(JSON.parse(output).rows.length, 1024)
    },
  },
  {
    name: "redact-1000-events",
    operations: 1000,
    run() {
      let written = 0
      for (const event of events)
        writeOut(
          (chunk) => {
            const data = JSON.parse(chunk).data
            assert.equal(data["[redacted]"], "[redacted]")
            written++
          },
          true,
          event,
          [key],
        )
      assert.equal(written, 1000)
    },
  },
  {
    name: "output-queue-50000",
    operations: 50000,
    async run() {
      let written = 0
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          assert.equal(Number(chunk.toString()), written++)
          queueMicrotask(callback)
        },
      })
      const sink = new OutputSink(stream, () => assert.fail("output should not overflow"), "stdout")
      try {
        for (let i = 0; i < 50000; i++) sink.write(`${i}\n`)
        await sink.flush(undefined, 15000)
        assert.equal(written, 50000)
      } finally {
        sink.dispose()
        stream.destroy()
      }
    },
  },
]
try {
  const results = scenarios.map(({ name, operations }) => ({ name, operations, samplesMs: [] }))
  for (let round = -3; round < count; round++) {
    for (let offset = 0; offset < scenarios.length; offset++) {
      const index = (round + 3 + offset) % scenarios.length
      const started = performance.now()
      await scenarios[index].run()
      if (round >= 0) results[index].samplesMs.push(performance.now() - started)
    }
  }
  console.log(
    JSON.stringify(
      {
        schemaVersion: 1,
        node: process.version,
        samples: count,
        warmup: 3,
        methodology:
          "Warm component batches, synthetic data, assertions included; each row is a whole batch, not one operation. Run separately from process benchmarks.",
        results: results.map((result) => ({ ...result, summaryMs: summarize(result.samplesMs) })),
      },
      null,
      2,
    ),
  )
} finally {
  rmSync(directory, { recursive: true, force: true })
}
