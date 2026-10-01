import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { RTM_EVENTS } from "../dist/rtm-events.js"

import { installedPackageSmoke, smokeEnvironment } from "./installed-package-smoke.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
const temp = mkdtempSync(join(tmpdir(), "crispctl-package-"))
const env = smokeEnvironment(temp)
try {
  const [packed] = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], {
      cwd: root,
      env,
      encoding: "utf8",
    }),
  )
  assert.equal(packed.version, pkg.version)
  for (const required of [
    "dist/index.js",
    "dist/rtm-events.js",
    "docs/rtm-coverage.md",
    "CHANGELOG.md",
    "LICENSE",
  ]) {
    assert.ok(
      packed.files.some((file) => file.path === required),
      `missing packaged file: ${required}`,
    )
  }
  assert.ok(
    packed.files.every((file) => !/^(src|test|scripts|\.github)\//.test(file.path)),
    "package contains development files",
  )
  console.log(
    JSON.stringify(installedPackageSmoke(join(temp, packed.filename), pkg.version, RTM_EVENTS)),
  )
} finally {
  rmSync(temp, { recursive: true, force: true })
}
