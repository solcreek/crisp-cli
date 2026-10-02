// Only this test entry redirects REST to a TLS-verified loopback server.
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { Agent, Pool } from "undici"

const endpoint = new URL(process.env.CRISPCTL_TEST_ENDPOINT)
if (endpoint.protocol !== "https:" || endpoint.hostname !== "127.0.0.1")
  throw new Error("test transport requires loopback HTTPS")
const dispatcher = new Agent({
  factory: (_origin, options) =>
    new Pool(endpoint.origin, {
      ...options,
      connections: 4,
      connect: { ca: readFileSync(new URL("localhost-cert.pem", import.meta.url)) },
    }),
})
const moduleUrl = process.env.CRISPCTL_TEST_MODULE
  ? pathToFileURL(process.env.CRISPCTL_TEST_MODULE)
  : new URL("../../dist/process-cli.js", import.meta.url)
const { runProcess } = await import(moduleUrl.href)
let code
try {
  code = await runProcess(process.argv.slice(2), process.stdout, process.stderr, { dispatcher })
} finally {
  await dispatcher.destroy()
}
process.exit(code)
