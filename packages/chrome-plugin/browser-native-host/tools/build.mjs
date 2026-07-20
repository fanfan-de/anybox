import { spawnSync } from "node:child_process"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const platformDirectory = {
  darwin: "macos",
  linux: "linux",
  win32: "windows",
}[process.platform]
const architectureDirectory = {
  arm64: "arm64",
  x64: "x64",
}[process.arch]

if (!platformDirectory || !architectureDirectory) {
  throw new Error(`Unsupported Native Messaging Host target: ${process.platform}/${process.arch}`)
}

const executableName = process.platform === "win32" ? "extension-host.exe" : "extension-host"
const result = spawnSync(
  "cargo",
  [
    "build",
    "--release",
    "--locked",
    "--manifest-path",
    path.join(projectRoot, "Cargo.toml"),
  ],
  {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  },
)
if (result.status !== 0) {
  throw new Error("Failed to build the Rust Native Messaging Host.")
}

const source = path.join(projectRoot, "target", "release", executableName)
const distRoot = path.join(projectRoot, "dist")
const destination = path.join(
  distRoot,
  platformDirectory,
  architectureDirectory,
  executableName,
)
await fsp.rm(destination, { force: true })
await fsp.mkdir(path.dirname(destination), { recursive: true })
await fsp.copyFile(source, destination)
if (process.platform !== "win32") await fsp.chmod(destination, 0o755)

const stat = await fsp.stat(destination)
process.stdout.write(`${JSON.stringify({
  architecture: architectureDirectory,
  bytes: stat.size,
  output: destination,
  platform: platformDirectory,
}, null, 2)}\n`)
