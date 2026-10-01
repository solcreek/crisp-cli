import { spawnSync } from "node:child_process"
import { copyFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true })
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url)),
    "-p",
    "tsconfig.json",
    "--noEmitOnError",
  ],
  { cwd: root, stdio: "inherit" },
)
if (result.error) throw result.error
if (result.status === 0)
  copyFileSync(
    new URL("../src/context.d.ts", import.meta.url),
    new URL("../dist/context.d.ts", import.meta.url),
  )
process.exitCode = result.status ?? 1
