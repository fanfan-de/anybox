import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const nativeRoot = path.dirname(fileURLToPath(import.meta.url))
const crateRoot = path.join(nativeRoot, "cinema-platform-helper")
const targets = {
  "win32-x64": { fileName: "cinema-platform-helper.exe" },
  "darwin-arm64": { fileName: "cinema-platform-helper" },
  "linux-x64": { fileName: "cinema-platform-helper" },
}

const targetKey = `${process.platform}-${process.arch}`
const target = targets[targetKey]
if (!target) throw new Error(`Cinema helper release does not support ${targetKey}.`)

const result = spawnSync("cargo", ["build", "--release", "--locked"], {
  cwd: crateRoot,
  encoding: "utf8",
  stdio: "inherit",
  windowsHide: true,
})
if (result.status !== 0) throw new Error(`Cinema helper build failed with exit code ${result.status ?? "unknown"}.`)

const source = path.join(crateRoot, "target", "release", target.fileName)
const destinationDirectory = path.join(nativeRoot, "artifacts", targetKey)
const destination = path.join(destinationDirectory, target.fileName)
await fsp.mkdir(destinationDirectory, { recursive: true })
await fsp.rm(path.join(destinationDirectory, "signature-verification.json"), { force: true })
await fsp.copyFile(source, destination)
if (process.platform !== "win32") await fsp.chmod(destination, 0o755)

const hash = createHash("sha256")
for await (const chunk of fs.createReadStream(destination)) hash.update(chunk)
const sha256 = hash.digest("hex")
console.log(JSON.stringify({ target: targetKey, path: path.relative(nativeRoot, destination).replaceAll("\\", "/"), sha256 }))
