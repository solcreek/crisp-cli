import childProcess from "node:child_process"
import { syncBuiltinESMExports } from "node:module"

globalThis.fetch = async () => new Response(JSON.stringify({ name: "crispctl", version: "0.4.0" }))
childProcess.execFileSync = () => {
  throw new Error("private npm output")
}
syncBuiltinESMExports()
