#!/usr/bin/env node
import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { runProcess } from "./process-cli.js"

export function isDirectInvocation(entry = process.argv[1], moduleUrl = import.meta.url): boolean {
  if (!entry) return false
  try {
    return moduleUrl === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}

if (isDirectInvocation()) {
  // runProcess drains both streams before returning. After a cancelled drain,
  // Node's special stdio handles can retain pending writes despite destroy().
  process.exit(await runProcess(process.argv.slice(2), process.stdout, process.stderr))
}
