import fs from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  resolveMediaExecutableNames,
  validateMediaRuntimeLock,
  verifyMediaRuntime,
} from "./verify-media-runtime.mjs"

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
const mediaLock = validateMediaRuntimeLock(JSON.parse(
  fs.readFileSync(path.join(desktopDir, "media-runtime.lock.json"), "utf8"),
))
const mediaPlatform = mediaLock.platforms[process.platform]
const mediaTarget = mediaPlatform?.status === "supported"
  ? mediaPlatform.targets?.[process.arch]
  : undefined
const mediaTargetReady = mediaTarget?.artifactStatus !== "pending" && Boolean(mediaTarget?.distribution)
const mediaExecutableNames = mediaTargetReady
  ? resolveMediaExecutableNames(mediaTarget, process.platform, process.arch)
  : undefined
const bundledMediaTools = mediaTarget && mediaExecutableNames
  ? [
      path.join(runtimeDir, "media-tools", mediaExecutableNames.ffmpeg),
      path.join(runtimeDir, "media-tools", mediaExecutableNames.ffprobe),
      path.join(runtimeDir, "media-tools", mediaTarget.licensePolicy.licenseFile),
      path.join(runtimeDir, "media-tools", mediaTarget.licensePolicy.noticesFile),
      path.join(runtimeDir, "media-tools", "manifest.json"),
    ]
  : []

async function sha256(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

async function verifyBetaMediaRuntime(mediaToolsDir) {
  if (!mediaTarget) throw new Error(`Deliver Beta has no runtime target for ${process.platform}/${process.arch}`)
  const manifestPath = path.join(mediaToolsDir, "manifest.json")
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error(`Deliver Beta media target mismatch: ${manifest.platform}/${manifest.arch}`)
  }
  if (manifest.origin !== "environment-override") {
    throw new Error(`Deliver Beta requires a build-supplied media runtime, got ${manifest.origin ?? "unknown"}`)
  }
  if (manifest.releaseReadiness?.status !== "blocked") {
    throw new Error("Deliver Beta must not masquerade as a release-approved runtime")
  }
  for (const name of [mediaTarget.executables.ffmpeg, mediaTarget.executables.ffprobe]) {
    const binaryPath = path.join(mediaToolsDir, name)
    if (!fs.existsSync(binaryPath)) throw new Error(`Deliver Beta media runtime is missing ${name}`)
    const digest = await sha256(binaryPath)
    if (manifest.binaries?.[name]?.sha256 !== digest) {
      throw new Error(`Deliver Beta media runtime digest mismatch for ${name}`)
    }
  }
  for (const name of [mediaTarget.licensePolicy.licenseFile, mediaTarget.licensePolicy.noticesFile]) {
    if (!fs.existsSync(path.join(mediaToolsDir, name))) {
      throw new Error(`Deliver Beta media runtime is missing ${name}`)
    }
  }
}

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

try {
  const releaseStrict = process.argv.includes("--release-strict")
  const mediaToolsDir = path.join(runtimeDir, "media-tools")
  const deliverBetaBuild = process.env.ANYBOX_DELIVER_BETA_BUILD === "1"
  if (mediaTargetReady) {
    await verifyMediaRuntime({ runtimeDir, releaseStrict })
  } else if (deliverBetaBuild && fs.existsSync(mediaToolsDir)) {
    await verifyBetaMediaRuntime(mediaToolsDir)
    console.log(`[desktop][media] verified build-supplied Deliver Beta runtime for ${process.platform}/${process.arch}`)
  } else if (fs.existsSync(mediaToolsDir)) {
    throw new Error(
      `Media runtime files exist without a locked target for ${process.platform}/${process.arch}`,
    )
  } else if (releaseStrict || deliverBetaBuild || process.env.ANYBOX_REQUIRE_MEDIA_RUNTIME === "1") {
    throw new Error(
      `Media runtime is required but blocked for ${process.platform}/${process.arch}: ${mediaTarget?.releaseReadiness?.reasons?.join(" ") ?? mediaPlatform?.reason ?? "target is not locked"}`,
    )
  } else {
    console.warn(
      `[desktop][media] runtime remains blocked for ${process.platform}/${process.arch}; Deliver stays unavailable`,
    )
  }
} catch (error) {
  console.error(`[desktop][build] ${error instanceof Error ? error.message : error}`)
  process.exit(1)
}

console.log(`[desktop][build] verified managed agent runtime at ${runtimeDir}`)
