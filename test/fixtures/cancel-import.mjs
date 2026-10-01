// Interrupt the CLI while its first HTTP-module import is still pending.
const cancelled = new Promise((done) => process.once("SIGTERM", done))
// Keep the event loop alive until the OS-delivered signal reaches Node.
const keepAlive = setTimeout(() => {}, 2000)
try {
  process.kill(process.pid, "SIGTERM")
  await cancelled
} finally {
  clearTimeout(keepAlive)
}
export function fetch() {
  process.stdout.write("unexpected fetch after cancellation\n")
  throw new Error("unexpected fetch after cancellation")
}
