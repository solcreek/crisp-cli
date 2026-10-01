import { readFileSync } from "node:fs"
import { installedPackageSmoke } from "./installed-package-smoke.mjs"
import { waitForPublishedVersion } from "./registry.mjs"

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const version = process.argv[2] ?? pkg.version
let installing = false
try {
  if (process.argv.length > 3) throw new Error("usage: npm run test:published -- [version]")
  await waitForPublishedVersion(version, { report: (check) => console.log(JSON.stringify(check)) })
  installing = true
  console.log(JSON.stringify(installedPackageSmoke(`crispctl@${version}`, version)))
} catch (error) {
  // execFileSync errors include captured subprocess output; keep that private.
  const message = installing
    ? "Published package installation or executable smoke failed; rerun verification without republishing."
    : error.message
  console.error(JSON.stringify({ check: "published-package", version, passed: false, message }))
  process.exitCode = 1
}
