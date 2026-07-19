import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
export const defaultProjectRoot = path.resolve(scriptDir, "..")
export const defaultRepoRoot = path.resolve(defaultProjectRoot, "..", "..")
export const defaultPluginRoot = path.join(
  defaultRepoRoot,
  "plugins",
  "Anybox-Plugins",
  "chrome",
)

const MAX_GITHUB_TREE_PACKAGE_BYTES = 5 * 1024 * 1024

export function nativeHostBuildTarget(
  platform = process.platform,
  architecture = process.arch,
) {
  const platformDirectory = {
    darwin: "macos",
    linux: "linux",
    win32: "windows",
  }[platform]
  const architectureDirectory = {
    arm64: "arm64",
    x64: "x64",
  }[architecture]
  if (!platformDirectory || !architectureDirectory) {
    throw new Error(`Unsupported Native Messaging Host target: ${platform}/${architecture}`)
  }
  const executableName = platform === "win32" ? "extension-host.exe" : "extension-host"
  return {
    architectureDirectory,
    executableName,
    packagePath: path.join(
      "extension-host",
      platformDirectory,
      architectureDirectory,
      executableName,
    ),
    platformDirectory,
  }
}

const currentNativeHostTarget = nativeHostBuildTarget()

const requiredPackageFiles = [
  path.join(".anybox-plugin", "plugin.json"),
  path.join("assets", "chrome.svg"),
  "LICENSE",
  path.join("browser-extension", "manifest.json"),
  path.join("browser-extension", "background.js"),
  path.join("browser-extension", "content.js"),
  path.join("browser-extension", "popup.html"),
  path.join("browser-extension", "popup.js"),
  currentNativeHostTarget.packagePath,
  path.join("scripts", "browser-client.mjs"),
  path.join("scripts", "browser-gateway-worker.js"),
  path.join("scripts", "browser-ipc-client.cjs"),
  path.join("scripts", "extension-id.json"),
  path.join("scripts", "installManifest.mjs"),
  path.join("scripts", "native-host-bootstrap.js"),
  path.join("scripts", "node-repl-server.js"),
  path.join("skills", "chrome", "SKILL.md"),
]

const allowedTopLevelEntries = new Set([
  ".anybox-plugin",
  "assets",
  "browser-extension",
  "extension-host",
  "LICENSE",
  "scripts",
  "skills",
])

const forbiddenDirectoryNames = new Set([
  ".cache",
  ".git",
  ".turbo",
  ".vite-temp",
  "browser-native-host",
  "docs",
  "node_modules",
  "runtime",
  "src",
  "test",
  "tests",
  "tools",
])

const forbiddenFileNames = new Set([
  ".gitignore",
  "package.json",
  "pnpm-lock.yaml",
  "readme.md",
  "readme.zh-cn.md",
  "tsconfig.json",
  "vite.config.ts",
])

function toPosixPath(value) {
  return value.split(path.sep).join("/")
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function chromeExtensionIDFromManifestKey(key) {
  if (typeof key !== "string" || !key.trim()) {
    throw new Error("Chrome extension manifest must contain a stable public key.")
  }
  let publicKey
  try {
    publicKey = Buffer.from(key, "base64")
  } catch {
    throw new Error("Chrome extension manifest public key must be base64 encoded.")
  }
  if (publicKey.length === 0) {
    throw new Error("Chrome extension manifest public key must not be empty.")
  }

  return [...createHash("sha256").update(publicKey).digest().subarray(0, 16)]
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((nibble) => String.fromCharCode("a".charCodeAt(0) + nibble))
    .join("")
}

async function pathExists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

async function listFiles(root) {
  const files = []

  async function visit(current, relativeRoot = "") {
    const entries = await fsp.readdir(current, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"))

    for (const entry of entries) {
      const relativePath = path.join(relativeRoot, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(`Chrome plugin packages must not contain symbolic links: ${relativePath}`)
      }

      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(`Chrome plugin package contains an unsupported entry: ${relativePath}`)
      }
      files.push(relativePath)
    }
  }

  await visit(root)
  return files
}

async function copyFile(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  await fsp.copyFile(source, destination)
}

async function copyDirectoryContents(sourceRoot, destinationRoot) {
  for (const relativePath of await listFiles(sourceRoot)) {
    await copyFile(
      path.join(sourceRoot, relativePath),
      path.join(destinationRoot, relativePath),
    )
  }
}

async function copyChromeExtensionBuild(projectRoot, packageRoot) {
  const extensionDistRoot = path.join(projectRoot, "browser-extension", "dist")
  if (!(await pathExists(path.join(extensionDistRoot, "manifest.json")))) {
    throw new Error(
      `Chrome extension build output is missing at ${extensionDistRoot}. Run the extension build first.`,
    )
  }

  for (const relativePath of await listFiles(extensionDistRoot)) {
    const normalized = toPosixPath(relativePath)
    if (normalized.endsWith(".map") || path.posix.basename(normalized) === ".DS_Store") continue
    await copyFile(
      path.join(extensionDistRoot, relativePath),
      path.join(packageRoot, "browser-extension", relativePath),
    )
  }
}

async function copyBrowserRuntimeBuild(projectRoot, packageRoot) {
  const browserClientPath = path.join(
    projectRoot,
    "browser-runtime",
    "dist",
    "browser-client.mjs",
  )
  if (!(await pathExists(browserClientPath))) {
    throw new Error(
      `Chrome browser runtime build output is missing at ${browserClientPath}. Run the browser runtime build first.`,
    )
  }

  await copyFile(
    browserClientPath,
    path.join(packageRoot, "scripts", "browser-client.mjs"),
  )
}

async function copyNativeHostBuild(projectRoot, packageRoot) {
  const source = path.join(
    projectRoot,
    "browser-native-host",
    "dist",
    currentNativeHostTarget.platformDirectory,
    currentNativeHostTarget.architectureDirectory,
    currentNativeHostTarget.executableName,
  )
  if (!(await pathExists(source))) {
    throw new Error(
      `Chrome Native Messaging Host build output is missing at ${source}. Run the native host build first.`,
    )
  }

  await copyFile(
    source,
    path.join(packageRoot, currentNativeHostTarget.packagePath),
  )
  if (process.platform !== "win32") {
    await fsp.chmod(path.join(packageRoot, currentNativeHostTarget.packagePath), 0o755)
  }
}

export async function validateChromePluginPackage(packageRoot) {
  if (!(await pathExists(packageRoot))) {
    throw new Error(`Chrome plugin package does not exist: ${packageRoot}`)
  }

  const files = await listFiles(packageRoot)
  const normalizedFiles = files.map(toPosixPath)
  const normalizedSet = new Set(normalizedFiles)
  const packageBytes = (
    await Promise.all(files.map(async (relativePath) =>
      (await fsp.stat(path.join(packageRoot, relativePath))).size
    ))
  ).reduce((total, size) => total + size, 0)
  if (packageBytes > MAX_GITHUB_TREE_PACKAGE_BYTES) {
    throw new Error(
      `Chrome plugin package is ${packageBytes} bytes; GitHub Tree installs are limited to ${MAX_GITHUB_TREE_PACKAGE_BYTES} bytes.`,
    )
  }

  for (const requiredPath of requiredPackageFiles.map(toPosixPath)) {
    if (!normalizedSet.has(requiredPath)) {
      throw new Error(`Chrome plugin package is missing required file: ${requiredPath}`)
    }
  }

  for (const relativePath of normalizedFiles) {
    const segments = relativePath.split("/")
    const topLevel = segments[0]
    const lowerSegments = segments.map((segment) => segment.toLowerCase())
    const fileName = lowerSegments.at(-1)

    if (!topLevel || !allowedTopLevelEntries.has(topLevel)) {
      throw new Error(`Chrome plugin package contains an unexpected top-level path: ${relativePath}`)
    }
    if (lowerSegments.some((segment) => forbiddenDirectoryNames.has(segment))) {
      throw new Error(`Chrome plugin package contains an engineering directory: ${relativePath}`)
    }
    if (fileName && forbiddenFileNames.has(fileName)) {
      throw new Error(`Chrome plugin package contains an engineering file: ${relativePath}`)
    }
    if (relativePath.endsWith(".map")) {
      throw new Error(`Chrome plugin package contains a source map: ${relativePath}`)
    }
  }

  const manifests = normalizedFiles.filter(
    (entry) => entry === ".anybox-plugin/plugin.json" || entry.endsWith("/plugin.json"),
  )
  if (manifests.length !== 1 || manifests[0] !== ".anybox-plugin/plugin.json") {
    throw new Error("Chrome plugin package must contain exactly one canonical plugin manifest.")
  }

  const manifest = JSON.parse(
    await fsp.readFile(path.join(packageRoot, ".anybox-plugin", "plugin.json"), "utf8"),
  )
  if (manifest.name !== "chrome" || typeof manifest.version !== "string" || !manifest.version) {
    throw new Error("Chrome plugin package manifest must describe a versioned 'chrome' plugin.")
  }
  if ("package" in manifest) {
    throw new Error(
      "Chrome plugin manifest must rely on its Registry GitHub Tree location instead of a separate package.",
    )
  }
  if ("id" in manifest) {
    throw new Error("Chrome plugin manifest must derive its ID from the canonical name.")
  }

  const nodeRepl = manifest.mcpServers?.find?.((server) => server?.id === "node-repl")
  if (nodeRepl) {
    const capabilityClaims = [
      ...(Array.isArray(nodeRepl.permissions) ? nodeRepl.permissions : []),
      ...(Array.isArray(nodeRepl.installReview) ? nodeRepl.installReview : []),
    ].filter((claim) => typeof claim === "string")
    const advancedClaims = capabilityClaims.filter((claim) =>
      /\b(?:raw page|raw script|DevTools Protocol|CDP)\b/i.test(claim)
    )
    if (
      advancedClaims.length === 0
      || advancedClaims.some((claim) =>
        !/\b(?:disabled|unavailable|not exposed|does not allow)\b/i.test(claim)
      )
    ) {
      throw new Error(
        "Chrome plugin capability claims must state that raw page JavaScript and CDP are disabled.",
      )
    }

    const skill = await fsp.readFile(
      path.join(packageRoot, "skills", "chrome", "SKILL.md"),
      "utf8",
    )
    const browserRuntime = await fsp.readFile(
      path.join(packageRoot, "scripts", "browser-client.mjs"),
      "utf8",
    )
    if (
      !/Raw selector adapters, page JavaScript, and CDP are disabled/i.test(skill)
      || !/disabled until Anybox can enforce command-level capability/i.test(browserRuntime)
    ) {
      throw new Error(
        "Chrome manifest, Skill, and browser runtime capability boundaries are inconsistent.",
      )
    }
  }

  const extensionManifest = JSON.parse(
    await fsp.readFile(path.join(packageRoot, "browser-extension", "manifest.json"), "utf8"),
  )
  const extensionConfig = JSON.parse(
    await fsp.readFile(path.join(packageRoot, "scripts", "extension-id.json"), "utf8"),
  )
  const derivedExtensionID = chromeExtensionIDFromManifestKey(extensionManifest.key)
  if (extensionConfig.extensionId !== derivedExtensionID) {
    throw new Error(
      `Chrome Native Messaging extension ID mismatch: expected ${derivedExtensionID}, got ${extensionConfig.extensionId ?? "missing"}.`,
    )
  }
  if (extensionConfig.extensionHostName !== "com.anybox.browser") {
    throw new Error("Chrome Native Messaging host name must be 'com.anybox.browser'.")
  }

  return {
    files,
    manifest,
  }
}

export async function stageChromePluginPackage({ projectRoot, packageRoot }) {
  const runtimeSourceRoot = path.join(projectRoot, "runtime")
  const manifestPath = path.join(runtimeSourceRoot, ".anybox-plugin", "plugin.json")
  const browserRuntimeProjectPath = path.join(projectRoot, "browser-runtime", "package.json")
  const extensionProjectPath = path.join(projectRoot, "browser-extension", "package.json")
  const nativeHostProjectPath = path.join(projectRoot, "browser-native-host", "package.json")
  const licensePath = path.join(projectRoot, "LICENSE")

  for (const requiredSource of [
    manifestPath,
    browserRuntimeProjectPath,
    extensionProjectPath,
    nativeHostProjectPath,
    licensePath,
  ]) {
    if (!(await pathExists(requiredSource))) {
      throw new Error(`Chrome plugin source project is incomplete: ${requiredSource}`)
    }
  }

  const sourceManifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
  if (
    sourceManifest.name !== "chrome"
    || typeof sourceManifest.version !== "string"
    || !sourceManifest.version
  ) {
    throw new Error("Chrome source manifest must describe a versioned 'chrome' plugin.")
  }
  if ("package" in sourceManifest) {
    throw new Error("Chrome source manifest must not point to a second distribution directory.")
  }

  await fsp.rm(packageRoot, { recursive: true, force: true })
  await fsp.mkdir(packageRoot, { recursive: true })
  await copyDirectoryContents(runtimeSourceRoot, packageRoot)
  await copyBrowserRuntimeBuild(projectRoot, packageRoot)
  await copyNativeHostBuild(projectRoot, packageRoot)
  await copyFile(licensePath, path.join(packageRoot, "LICENSE"))
  await copyChromeExtensionBuild(projectRoot, packageRoot)

  const validation = await validateChromePluginPackage(packageRoot)
  return {
    ...validation,
    sourceManifest,
    version: sourceManifest.version,
  }
}

async function packageSnapshot(packageRoot) {
  if (!(await pathExists(packageRoot))) return undefined

  const snapshot = new Map()
  for (const relativePath of await listFiles(packageRoot)) {
    snapshot.set(
      toPosixPath(relativePath),
      sha256(await fsp.readFile(path.join(packageRoot, relativePath))),
    )
  }
  return snapshot
}

export async function compareChromePluginPackages(expectedRoot, actualRoot) {
  const expected = await packageSnapshot(expectedRoot)
  const actual = await packageSnapshot(actualRoot)
  if (!expected) throw new Error(`Expected Chrome plugin package does not exist: ${expectedRoot}`)
  if (!actual) return [`missing package directory: ${actualRoot}`]

  const differences = []
  for (const [relativePath, hash] of expected) {
    if (!actual.has(relativePath)) {
      differences.push(`missing: ${relativePath}`)
    } else if (actual.get(relativePath) !== hash) {
      differences.push(`changed: ${relativePath}`)
    }
  }
  for (const relativePath of actual.keys()) {
    if (!expected.has(relativePath)) differences.push(`unexpected: ${relativePath}`)
  }
  return differences
}

function isSameOrInside(parent, candidate) {
  const relativePath = path.relative(path.resolve(parent), path.resolve(candidate))
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
}

export async function packageChromePlugin({
  projectRoot = defaultProjectRoot,
  pluginRoot = defaultPluginRoot,
  check = false,
} = {}) {
  if (isSameOrInside(projectRoot, pluginRoot) || isSameOrInside(pluginRoot, projectRoot)) {
    throw new Error("Chrome source project and generated plugin directory must remain separate.")
  }

  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "anybox-chrome-plugin-"))
  const stagedPackageRoot = path.join(temporaryRoot, "chrome")

  try {
    const staged = await stageChromePluginPackage({
      projectRoot,
      packageRoot: stagedPackageRoot,
    })

    if (check) {
      const differences = await compareChromePluginPackages(stagedPackageRoot, pluginRoot)
      if (differences.length > 0) {
        throw new Error([
          "The tracked Chrome plugin directory is stale.",
          ...differences.map((difference) => `- ${difference}`),
          "Run `pnpm chrome-plugin:package` and commit the generated directory.",
        ].join("\n"))
      }
    } else {
      await fsp.rm(pluginRoot, { recursive: true, force: true })
      await fsp.mkdir(path.dirname(pluginRoot), { recursive: true })
      await fsp.cp(stagedPackageRoot, pluginRoot, { recursive: true })
      await validateChromePluginPackage(pluginRoot)
    }

    return {
      check,
      files: staged.files,
      manifest: staged.manifest,
      pluginRoot,
      version: staged.version,
    }
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true })
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: defaultRepoRoot,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`)
  }
}

function runPnpm(args, options = {}) {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath && /\.(?:c|m)?js$/i.test(npmExecPath)) {
    const executableName = path.basename(npmExecPath).toLowerCase()
    const cliArgs = executableName.startsWith("corepack")
      ? [npmExecPath, "pnpm", ...args]
      : [npmExecPath, ...args]
    run(process.execPath, cliArgs, {
      shell: false,
      ...options,
    })
    return
  }

  run("corepack", ["pnpm", ...args], options)
}

export function buildChromeExtension() {
  runPnpm(["--filter", "anybox-chrome-extension", "build"], {
    env: {
      ...process.env,
      ANYBOX_BROWSER_EXTENSION_SOURCEMAP: "false",
    },
  })
}

export function buildBrowserRuntime() {
  runPnpm(["--filter", "anybox-chrome-browser-runtime", "build"])
}

export function buildNativeHost() {
  runPnpm(["--filter", "anybox-chrome-native-host", "build"])
}

function parseArgs(argv) {
  const options = {
    build: true,
    check: false,
  }

  for (const value of argv) {
    if (value === "--skip-build") {
      options.build = false
    } else if (value === "--check") {
      options.check = true
    } else if (value === "--help" || value === "-h") {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${value}`)
    }
  }

  return options
}

function printHelp() {
  process.stdout.write([
    "Build the browser runtime, Chrome extension, and Rust Native Messaging Host, then synchronize the tracked Anybox Chrome plugin directory.",
    "",
    "Usage:",
    "  node tools/package-chrome-plugin.mjs [options]",
    "",
    "Options:",
    "  --skip-build  Reuse the current browser-runtime, browser-extension, and native-host outputs.",
    "  --check       Verify the tracked plugin directory without modifying it.",
    "  -h, --help    Show this help.",
    "",
  ].join("\n"))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  if (options.build) {
    buildBrowserRuntime()
    buildChromeExtension()
    buildNativeHost()
  }
  const result = await packageChromePlugin({ check: options.check })
  process.stdout.write(`${JSON.stringify({
    check: result.check,
    pluginRoot: result.pluginRoot,
    version: result.version,
    files: result.files.length,
  }, null, 2)}\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
