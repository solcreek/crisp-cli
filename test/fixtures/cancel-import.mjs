// Interrupt the CLI while its first HTTP-module import is still pending.
const cancelled = new Promise((done) => process.once("SIGTERM", done))
process.kill(process.pid, "SIGTERM")
await cancelled
export function fetch() {
  process.stdout.write("unexpected fetch after cancellation\n")
  throw new Error("unexpected fetch after cancellation")
}
