import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const runtimeDir = path.join(desktopDir, "build", "agent-runtime")
const dependenciesDir = path.join(runtimeDir, "dependencies")
const bunExecutableName = process.platform === "win32" ? "bun.exe" : "bun"
const nativeHostExecutableName = process.platform === "win32"
  ? "anybox-browser-native-host.exe"
  : "anybox-browser-native-host"
const pythonExecutable = process.platform === "win32"
  ? path.join(dependenciesDir, "python", "python.exe")
  : path.join(dependenciesDir, "python", "bin", "python3")
const bundledMediaTools = process.platform === "win32" && process.arch === "x64"
  ? [
      path.join(runtimeDir, "media-tools", "ffmpeg.exe"),
      path.join(runtimeDir, "media-tools", "ffprobe.exe"),
      path.join(runtimeDir, "media-tools", "LICENSE.txt"),
      path.join(runtimeDir, "media-tools", "THIRD-PARTY-NOTICES.txt"),
      path.join(runtimeDir, "media-tools", "manifest.json"),
    ]
  : []

const requiredFiles = [
  path.join(runtimeDir, "agent-server.js"),
  path.join(runtimeDir, "cinema-web", "index.html"),
  path.join(runtimeDir, "connectors", "browser", "server.js"),
  path.join(runtimeDir, "connectors", "node-repl", "server.js"),
  path.join(runtimeDir, "connectors", "node-repl", "browser-client.mjs"),
  path.join(runtimeDir, "connectors", "gmail", "server.js"),
  path.join(runtimeDir, "connectors", "feishu", "server.js"),
  path.join(runtimeDir, "native-host", nativeHostExecutableName),
  path.join(runtimeDir, bunExecutableName),
  path.join(runtimeDir, "node_modules", "node-pty", "package.json"),
  path.join(dependenciesDir, "manifest.json"),
  pythonExecutable,
  ...bundledMediaTools,
]

const missing = requiredFiles.filter((filePath) => !fs.existsSync(filePath))
if (missing.length > 0) {
  console.error("[desktop][build] agent runtime is incomplete:")
  for (const filePath of missing) {
    console.error(`- ${filePath}`)
  }
  process.exit(1)
}

const builtinPluginsRoot = path.join(runtimeDir, "plugins", "builtin")
if (fs.existsSync(builtinPluginsRoot)) {
  console.error("[desktop][build] agent runtime must not include bundled plugin packages:")
  console.error(`- ${builtinPluginsRoot}`)
  process.exit(1)
}

const pluginRegistryPath = path.join(runtimeDir, "plugins", "registry", "plugin-registry.json")
if (fs.existsSync(pluginRegistryPath)) {
  console.error("[desktop][build] agent runtime must not include a bundled plugin registry:")
  console.error(`- ${pluginRegistryPath}`)
  process.exit(1)
}

if (process.platform === "darwin") {
  const prebuildsDir = path.join(runtimeDir, "node_modules", "node-pty", "prebuilds")
  const darwinPrebuilds = fs
    .readdirSync(prebuildsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("darwin-"))

  const invalidHelpers = darwinPrebuilds
    .map((entry) => path.join(prebuildsDir, entry.name, "spawn-helper"))
    .filter((helperPath) => !fs.existsSync(helperPath) || (fs.statSync(helperPath).mode & 0o111) === 0)

  if (darwinPrebuilds.length === 0 || invalidHelpers.length > 0) {
    console.error("[desktop][build] macOS node-pty spawn-helper is not executable:")
    if (darwinPrebuilds.length === 0) {
      console.error(`- ${prebuildsDir}/darwin-*/spawn-helper`)
    }
    for (const helperPath of invalidHelpers) {
      console.error(`- ${helperPath}`)
    }
    process.exit(1)
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(dependenciesDir, "manifest.json"), "utf8"))
if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
  console.error(
    `[desktop][build] dependency manifest platform mismatch: got ${manifest.platform}/${manifest.arch}, expected ${process.platform}/${process.arch}`,
  )
  process.exit(1)
}

console.log(`[desktop][build] verified managed agent runtime at ${runtimeDir}`)
