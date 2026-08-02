import fs from "node:fs"
import { spawn, spawnSync } from "node:child_process"
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
const runtimeBuildDir = path.join(desktopDir, "build")
const runtimeDir = resolveRuntimeOutputDirectory()
const releaseStrict = process.argv.includes("--release-strict")
const dependenciesDir = path.join(runtimeDir, "dependencies")
const bunExecutableName = process.platform === "win32" ? "bun.exe" : "bun"

function resolveRuntimeOutputDirectory() {
  const configured = process.env.ANYBOX_AGENT_RUNTIME_OUTPUT_DIR?.trim()
  if (!configured) return path.join(runtimeBuildDir, "agent-runtime")
  const resolved = path.resolve(configured)
  const relative = path.relative(runtimeBuildDir, resolved)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      `ANYBOX_AGENT_RUNTIME_OUTPUT_DIR must be a child of ${runtimeBuildDir}`,
    )
  }
  return resolved
}
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

function listFilesRecursively(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listFilesRecursively(entryPath)
    return entry.isFile() ? [entryPath] : []
  })
}

const cinemaProviderManifestsSourceDir = path.join(agentDir, "src", "cinema", "provider-manifests")
const cinemaProviderManifestSourceFiles = listFilesRecursively(cinemaProviderManifestsSourceDir)
const bundledCinemaProviderManifests = [
  path.join(runtimeDir, "provider-manifests.json"),
  ...cinemaProviderManifestSourceFiles.map((sourcePath) =>
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
  path.join(runtimeDir, "node-pty-worker.mjs"),
  ...bundledCinemaProviderManifests,
  path.join(runtimeDir, "cinema-web", "index.html"),
  path.join(runtimeDir, "connectors", "gmail", "server.js"),
  path.join(runtimeDir, "connectors", "feishu", "server.js"),
  path.join(runtimeDir, "mcp", "node-repl", "server.js"),
  path.join(runtimeDir, "mcp", "node-repl", "package.json"),
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

async function verifyPackagedPtyWorker() {
  const workerPath = path.join(runtimeDir, "node-pty-worker.mjs")
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath], {
      cwd: runtimeDir,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdoutBuffer = ""
    let stderr = ""
    let ready = false
    let terminalOutput = ""
    let terminalExitCode
    let settled = false

    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        if (!child.killed) child.kill()
        reject(error)
      }
      else resolve()
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(new Error("Packaged node-pty worker smoke test timed out"))
    }, 10_000)
    timer.unref?.()

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.trim()) continue
        let event
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        if (event.type === "ready") ready = true
        if (event.type === "data") terminalOutput += event.data
        if (event.type === "exit") terminalExitCode = event.exitCode
        if (event.type === "error") {
          finish(new Error(`Packaged node-pty worker error: ${event.message}`))
        }
      }
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.once("error", (error) => finish(error))
    child.once("close", () => {
      if (!ready || !terminalOutput.includes("packaged-pty-ok") || terminalExitCode !== 7) {
        finish(new Error(
          `Packaged node-pty worker smoke failed (ready=${ready}, exit=${terminalExitCode ?? "missing"}): ${stderr || terminalOutput || "no output"}`,
        ))
        return
      }
      finish()
    })

    child.stdin.write(`${JSON.stringify({
      type: "start",
      executable: process.execPath,
      args: ["-e", "process.stdout.write('packaged-pty-ok');process.exit(7)"],
      cwd: runtimeDir,
      rows: 32,
      cols: 120,
      env: process.env,
    })}\n`)
  })
}

const cinemaCatalogSource = path.join(agentDir, "src", "cinema", "provider-manifests.json")
const packagedCinemaFiles = [
  [cinemaCatalogSource, path.join(runtimeDir, "provider-manifests.json")],
  ...cinemaProviderManifestSourceFiles.map((sourcePath) => [
    sourcePath,
    path.join(runtimeDir, "provider-manifests", path.relative(cinemaProviderManifestsSourceDir, sourcePath)),
  ]),
]
for (const [sourcePath, bundledPath] of packagedCinemaFiles) {
  if (await sha256(sourcePath) !== await sha256(bundledPath)) {
    throw new Error(`Bundled Cinema provider file differs from its source: ${path.relative(agentDir, sourcePath)}`)
  }
}

const comfyUIProviderRoot = path.join(runtimeDir, "provider-manifests", "comfyui-local")
const comfyUIProvider = JSON.parse(fs.readFileSync(path.join(comfyUIProviderRoot, "provider.json"), "utf8"))
if (
  comfyUIProvider.id !== "comfyui-local"
  || comfyUIProvider.authType !== "none"
  || comfyUIProvider.requiresCredential !== false
  || comfyUIProvider.baseURL !== "http://127.0.0.1:8188"
  || !Array.isArray(comfyUIProvider.models)
  || comfyUIProvider.models.length !== 0
  || comfyUIProvider.capabilities?.workflowDiscovery !== true
  || comfyUIProvider.capabilities?.appMode !== true
) {
  throw new Error("Bundled Local ComfyUI provider manifest is invalid")
}
const staticComfyUIArtifacts = listFilesRecursively(comfyUIProviderRoot)
  .filter((filePath) => !["provider.json", "SOURCE.md"].includes(path.basename(filePath)))
if (staticComfyUIArtifacts.length > 0) {
  throw new Error(
    `Bundled Local ComfyUI must not contain static model or workflow artifacts: ${staticComfyUIArtifacts.join(", ")}`,
  )
}

const pluginOwnedRuntimeFiles = [
  path.join(runtimeDir, "ipc-listener-sidecar.mjs"),
  path.join(runtimeDir, "connectors", "browser", "server.js"),
  path.join(runtimeDir, "connectors", "browser-runtime", "client.mjs"),
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

const pluginsRuntimeRoot = path.join(runtimeDir, "plugins")
const unexpectedPluginRuntimeFiles = fs.existsSync(pluginsRuntimeRoot)
  ? listFilesRecursively(pluginsRuntimeRoot)
  : []
if (unexpectedPluginRuntimeFiles.length > 0) {
  console.error("[desktop][build] agent runtime must not bundle plugin registries, packages, or ZIP assets:")
  for (const filePath of unexpectedPluginRuntimeFiles) {
    console.error(`- ${filePath}`)
  }
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

await verifyPackagedPtyWorker()

try {
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
