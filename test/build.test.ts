import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))

function fixture(check: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "crispctl-build-"))
  try {
    for (const name of ["scripts", "src", "dist"]) mkdirSync(join(directory, name))
    cpSync(join(root, "scripts"), join(directory, "scripts"), { recursive: true })
    symlinkSync(join(root, "node_modules"), join(directory, "node_modules"), "junction")
    writeFileSync(
      join(directory, "package.json"),
      JSON.stringify({
        name: "crispctl-build-fixture",
        version: "1.0.0",
        type: "module",
        scripts: { build: pkg.scripts.build },
        files: ["dist"],
      }),
    )
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "Node16",
          types: [],
          rootDir: "src",
          outDir: "dist",
          declaration: true,
          sourceMap: true,
        },
        include: ["src"],
      }),
    )
    writeFileSync(
      join(directory, "src/context.d.ts"),
      "export type IO = { stdout: (value: string) => void }\n",
    )
    for (const suffix of ["js", "js.map", "d.ts"])
      writeFileSync(join(directory, `dist/deleted.${suffix}`), "stale")
    check(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function build(directory: string) {
  const result = spawnSync("npm", ["run", "build"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 30_000,
  })
  assert.ifError(result.error)
  return result
}

test("build removes deleted modules and their maps and declarations from the npm tarball", () => {
  fixture((directory) => {
    writeFileSync(join(directory, "src/index.ts"), 'export const value = "current"\n')
    const result = build(directory)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    for (const suffix of ["js", "js.map", "d.ts"]) {
      assert.equal(existsSync(join(directory, `dist/deleted.${suffix}`)), false)
      assert.equal(existsSync(join(directory, `dist/index.${suffix}`)), true)
    }
    const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 30_000,
    })
    assert.ifError(packed.error)
    assert.equal(packed.status, 0, packed.stderr)
    const paths = JSON.parse(packed.stdout)[0].files.map((file: { path: string }) => file.path)
    assert.ok(paths.includes("dist/index.js"))
    assert.ok(paths.includes("dist/context.d.ts"))
    assert.equal(
      readFileSync(join(directory, "dist/context.d.ts"), "utf8"),
      readFileSync(join(directory, "src/context.d.ts"), "utf8"),
    )
    assert.equal(existsSync(join(directory, "dist/context.js")), false)
    assert.ok(paths.every((path: string) => !path.includes("deleted")))
  })
})

test("failed compilation leaves neither old artifacts nor newly emitted broken JavaScript", () => {
  fixture((directory) => {
    writeFileSync(join(directory, "src/index.ts"), 'export const value: number = "invalid"\n')
    const result = build(directory)
    assert.notEqual(result.status, 0)
    assert.match(result.stdout, /TS2322/)
    assert.equal(existsSync(join(directory, "dist/deleted.js")), false)
    assert.equal(existsSync(join(directory, "dist/index.js")), false)
  })
})
