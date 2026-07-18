import fs from "node:fs"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  resolveMediaExecutableNames,
  validateMediaRuntimeLock,
  verifyMediaRuntime,
} from "./verify-media-runtime.mjs"
import { LINUX_PYTHON_DISTRIBUTION } from "./prepare-workspace-dependencies.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const agentDir = path.resolve(desktopDir, "..", "anyboxagent")
const runtimeDir = path.join(desktopDir, "build", "agent-runtime")
const dependenciesDir = path.join(runtimeDir, "dependencies")
const bunExecutableName = process.platform === "win32" ? "bun.exe" : "bun"
const nativeHostExecutableName = process.platform === "win32"
  ? "anybox-chrome-native-host.exe"
  : "anybox-chrome-native-host"
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

function listJsonFilesRecursively(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listJsonFilesRecursively(entryPath)
    return entry.isFile() && path.extname(entry.name).toLowerCase() === ".json" ? [entryPath] : []
  })
}

const cinemaProviderManifestsSourceDir = path.join(agentDir, "src", "cinema", "provider-manifests")
const bundledCinemaProviderManifests = [
  path.join(runtimeDir, "provider-manifests.json"),
  ...listJsonFilesRecursively(cinemaProviderManifestsSourceDir).map((sourcePath) =>
    path.join(runtimeDir, "provider-manifests", path.relative(cinemaProviderManifestsSourceDir, sourcePath)),
  ),
]

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
  for (const [component, descriptor] of Object.entries(mediaTarget.licensePolicy.componentLicenseFiles ?? {})) {
    const licensePath = path.join(mediaToolsDir, descriptor.fileName)
    if (!fs.existsSync(licensePath)) throw new Error(`Deliver Beta media runtime is missing ${component} license ${descriptor.fileName}`)
    if (await sha256(licensePath) !== descriptor.sha256) {
      throw new Error(`Deliver Beta media runtime ${component} license digest mismatch`)
    }
  }
}

const requiredFiles = [
  path.join(runtimeDir, "agent-server.js"),
  ...bundledCinemaProviderManifests,
  path.join(runtimeDir, "cinema-web", "index.html"),
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

const pluginOwnedRuntimeFiles = [
  path.join(runtimeDir, "connectors", "browser", "server.js"),
  path.join(runtimeDir, "connectors", "browser-runtime", "client.mjs"),
  path.join(runtimeDir, "connectors", "node-repl", "server.js"),
]
const bundledPluginRuntimeFiles = pluginOwnedRuntimeFiles.filter((filePath) => fs.existsSync(filePath))
if (bundledPluginRuntimeFiles.length > 0) {
  console.error("[desktop][build] Chrome plugin runtimes must not be bundled into the Anybox Agent runtime:")
  for (const filePath of bundledPluginRuntimeFiles) {
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

if (manifest.pythonVersion !== LINUX_PYTHON_DISTRIBUTION.version) {
  console.error(
    `[desktop][build] dependency manifest Python version mismatch: got ${manifest.pythonVersion ?? "missing"}, expected ${LINUX_PYTHON_DISTRIBUTION.version}`,
  )
  process.exit(1)
}

if (process.platform === "linux") {
  const distribution = manifest.pythonDistribution
  for (const [key, expected] of Object.entries(LINUX_PYTHON_DISTRIBUTION)) {
    if (distribution?.[key] !== expected) {
      console.error(
        `[desktop][build] Linux Python distribution ${key} mismatch: got ${distribution?.[key] ?? "missing"}, expected ${expected}`,
      )
      process.exit(1)
    }
  }
}

const pythonSmoke = spawnSync(
  pythonExecutable,
  [
    "-c",
    [
      "import sys",
      `assert sys.version_info[:3] == (${LINUX_PYTHON_DISTRIBUTION.version.split(".").join(", ")})`,
      "import docx, openpyxl, pandas, PIL, pypdf, reportlab, lxml, numpy, pydantic, dateutil, pdf2image",
    ].join("; "),
  ],
  { encoding: "utf8", windowsHide: true },
)
if (pythonSmoke.status !== 0) {
  console.error("[desktop][build] bundled workspace Python failed its import smoke test:")
  console.error((pythonSmoke.stderr || pythonSmoke.stdout || "unknown Python error").trim())
  process.exit(1)
}

const workspaceNodeDir = path.join(dependenciesDir, "node")
const nodeSmoke = spawnSync(
  path.join(runtimeDir, bunExecutableName),
  [
    "-e",
    [
      "for (const name of ['docx','pptxgenjs','pdf-lib','sharp','image-size','pngjs','jpeg-js','pixelmatch','tesseract.js','jszip','marked']) await import(name)",
      "const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')",
      "if (typeof pdfjs.getDocument !== 'function') throw new Error('pdfjs-dist did not expose getDocument')",
      "const sharp = (await import('sharp')).default",
      "const png = await sharp({create:{width:2,height:2,channels:4,background:'#ff0000'}}).png().toBuffer()",
      "if (png.length === 0) throw new Error('sharp image smoke produced no output')",
    ].join("; "),
  ],
  { cwd: workspaceNodeDir, encoding: "utf8", windowsHide: true },
)
if (nodeSmoke.status !== 0) {
  console.error("[desktop][build] bundled workspace Node dependencies failed their import smoke test:")
  console.error((nodeSmoke.stderr || nodeSmoke.stdout || "unknown Bun error").trim())
  process.exit(1)
}

try {
  const releaseStrict = process.argv.includes("--release-strict")
  const mediaToolsDir = path.join(runtimeDir, "media-tools")
  const deliverBetaBuild = process.env.ANYBOX_DELIVER_BETA_BUILD === "1"
  if (deliverBetaBuild && fs.existsSync(mediaToolsDir)) {
    await verifyBetaMediaRuntime(mediaToolsDir)
    console.log(`[desktop][media] verified build-supplied Deliver Beta runtime for ${process.platform}/${process.arch}`)
  } else if (mediaTargetReady) {
    await verifyMediaRuntime({ runtimeDir, releaseStrict })
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
