#!/usr/bin/env node
import { realpathSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { run } from "./cli.js"

export function isDirectInvocation(entry = process.argv[1], moduleUrl = import.meta.url): boolean {
  if (!entry) return false
  try {
    return moduleUrl === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}

if (isDirectInvocation()) {
  process.exitCode = await run(process.argv.slice(2))
}
