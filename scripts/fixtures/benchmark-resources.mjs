// A separate pipe keeps instrumentation out of the CLI's stdout/stderr contract.
import { writeSync } from "node:fs"
process.once("exit", () => writeSync(3, JSON.stringify(process.resourceUsage())))
