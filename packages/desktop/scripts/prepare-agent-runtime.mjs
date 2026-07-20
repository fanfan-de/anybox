import { spawnSync } from "node:child_process"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { prepareWorkspaceDependencies } from "./prepare-workspace-dependencies.mjs"
import { prepareMediaTools } from "./prepare-media-tools.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(desktopDir, "..", "..")
const agentDir = path.join(repoRoot, "packages", "anyboxagent")
const cinemaWebDistDir = path.join(repoRoot, "packages", "cinema-web", "dist")
const runtimeBuildDir = path.join(desktopDir, "build")
const runtimeDir = resolveRuntimeOutputDirectory()
const cinemaProviderCatalogSource = path.join(agentDir, "src", "cinema", "provider-manifests.json")
const cinemaProviderManifestsSourceDir = path.join(agentDir, "src", "cinema", "provider-manifests")
const gmailConnectorSourceDir = path.join(agentDir, "plugins", "builtin", "gmail", "0.1.0", "connectors", "gmail")
const feishuConnectorSourceDir = path.join(agentDir, "plugins", "builtin", "feishu", "0.1.0", "connectors", "feishu")
const nodeReplMcpSourceDir = path.join(agentDir, "mcp", "node-repl")

const bunExecutableName = process.platform === "win32" ? "bun.exe" : "bun"
const connectorBuildConfigFile = path.join(runtimeDir, "config", "connectors.json")

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

function readEnv(key) {
  const value = process.env[key]?.trim()
  if (value) return value
  return undefined
}

async function pathExists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

async function resetRuntimeDirectory() {
  await fsp.rm(runtimeDir, { recursive: true, force: true })
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: true,
    ...options,
  })

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`)
  }
}

function resolveBunBinary() {
  const explicit = readEnv("ANYBOX_BUN_BINARY")
  if (explicit && fs.existsSync(explicit)) return explicit

  const probe = spawnSync("bun", ["--print", "process.execPath"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  })
  const probedPath = probe.stdout?.trim()
  if (probe.status === 0 && probedPath && fs.existsSync(probedPath)) {
    return probedPath
  }

  const candidates = [
    process.env.APPDATA
      ? path.join(process.env.APPDATA, "npm", "node_modules", "bun", "bin", bunExecutableName)
      : undefined,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".bun", "bin", bunExecutableName) : undefined,
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error(
    "Unable to locate Bun. Set ANYBOX_BUN_BINARY or ensure `bun --print process.execPath` resolves correctly.",
  )
}

async function copyNodePtyRuntime(runtimeNodeModulesDir) {
  const packageRoot = path.join(agentDir, "node_modules", "node-pty")
  if (!(await pathExists(packageRoot))) {
    throw new Error("Missing packages/anyboxagent/node_modules/node-pty. Run `bun install` in anyboxagent first.")
  }

  const targetRoot = path.join(runtimeNodeModulesDir, "node-pty")
  await fsp.mkdir(targetRoot, { recursive: true })

  const copyTargets = ["package.json", "LICENSE", "lib", "prebuilds", path.join("build", "Release")]

  for (const relativePath of copyTargets) {
    const from = path.join(packageRoot, relativePath)
    if (!(await pathExists(from))) continue

    const to = path.join(targetRoot, relativePath)
    await fsp.cp(from, to, { recursive: true })
  }
}

async function fixNodePtySpawnHelperPermissions(runtimeNodeModulesDir) {
  if (process.platform !== "darwin") return

  const prebuildsDir = path.join(runtimeNodeModulesDir, "node-pty", "prebuilds")
  if (!(await pathExists(prebuildsDir))) return

  const entries = await fsp.readdir(prebuildsDir, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("darwin-"))
      .map(async (entry) => {
        const helperPath = path.join(prebuildsDir, entry.name, "spawn-helper")
        if (!(await pathExists(helperPath))) return
        await fsp.chmod(helperPath, 0o755)
      }),
  )
}

async function copyBundledPlatformRuntimes() {
  const gmailConnectorTargetDir = path.join(runtimeDir, "connectors", "gmail")
  const feishuConnectorTargetDir = path.join(runtimeDir, "connectors", "feishu")
  const nodeReplMcpTargetDir = path.join(runtimeDir, "mcp", "node-repl")
  if (!(await pathExists(path.join(gmailConnectorSourceDir, "server.js")))) {
    throw new Error(`Missing Gmail connector server at ${gmailConnectorSourceDir}`)
  }
  if (!(await pathExists(path.join(feishuConnectorSourceDir, "server.js")))) {
    throw new Error(`Missing Feishu connector server at ${feishuConnectorSourceDir}`)
  }
  if (!(await pathExists(path.join(nodeReplMcpSourceDir, "server.js")))) {
    throw new Error(`Missing built-in Node REPL MCP server at ${nodeReplMcpSourceDir}`)
  }

  await fsp.mkdir(gmailConnectorTargetDir, { recursive: true })
  await fsp.mkdir(feishuConnectorTargetDir, { recursive: true })
  await fsp.mkdir(nodeReplMcpTargetDir, { recursive: true })
  await fsp.copyFile(path.join(gmailConnectorSourceDir, "server.js"), path.join(gmailConnectorTargetDir, "server.js"))
  await fsp.copyFile(path.join(feishuConnectorSourceDir, "server.js"), path.join(feishuConnectorTargetDir, "server.js"))
  await fsp.copyFile(path.join(nodeReplMcpSourceDir, "server.js"), path.join(nodeReplMcpTargetDir, "server.js"))
}

async function copyCinemaWebDist() {
  const sourceIndex = path.join(cinemaWebDistDir, "index.html")
  if (!(await pathExists(sourceIndex))) {
    throw new Error(`Missing Cinema Web build at ${sourceIndex}. Run \`pnpm --filter anybox-cinema-web build\` first.`)
  }

  const targetDir = path.join(runtimeDir, "cinema-web")
  await fsp.rm(targetDir, { recursive: true, force: true })
  await fsp.cp(cinemaWebDistDir, targetDir, { recursive: true })
}

async function copyCinemaProviderManifests() {
  if (!(await pathExists(cinemaProviderCatalogSource))) {
    throw new Error(`Missing Cinema provider catalog at ${cinemaProviderCatalogSource}`)
  }
  if (!(await pathExists(cinemaProviderManifestsSourceDir))) {
    throw new Error(`Missing Cinema provider manifests at ${cinemaProviderManifestsSourceDir}`)
  }

  const targetCatalog = path.join(runtimeDir, "provider-manifests.json")
  const targetManifestsDir = path.join(runtimeDir, "provider-manifests")
  await fsp.copyFile(cinemaProviderCatalogSource, targetCatalog)
  await fsp.rm(targetManifestsDir, { recursive: true, force: true })
  await fsp.cp(cinemaProviderManifestsSourceDir, targetManifestsDir, { recursive: true })
}

async function writeConnectorBuildConfig() {
  const gmailOAuthClientID = readEnv("ANYBOX_GMAIL_OAUTH_CLIENT_ID")
  const gmailOAuthClientSecret = readEnv("ANYBOX_GMAIL_OAUTH_CLIENT_SECRET")
  if (!gmailOAuthClientID && !gmailOAuthClientSecret) return

  await fsp.mkdir(path.dirname(connectorBuildConfigFile), { recursive: true })
  await fsp.writeFile(
    connectorBuildConfigFile,
    `${JSON.stringify({
      schemaVersion: 1,
      ...(gmailOAuthClientID ? { gmailOAuthClientID } : {}),
      ...(gmailOAuthClientSecret ? { gmailOAuthClientSecret } : {}),
    }, null, 2)}\n`,
  )
}

async function main() {
  const bunBinary = resolveBunBinary()
  const runtimeNodeModulesDir = path.join(runtimeDir, "node_modules")

  await resetRuntimeDirectory()
  await fsp.mkdir(runtimeNodeModulesDir, { recursive: true })

  console.log(`[desktop][build] bundling agent server with ${bunBinary}`)
  run(
    bunBinary,
    [
      "build",
      path.join(agentDir, "src", "server", "start.ts"),
      "--target=bun",
      "--outdir",
      runtimeDir,
      "--entry-naming",
      "agent-server.js",
    ],
    { cwd: repoRoot },
  )

  await fsp.copyFile(bunBinary, path.join(runtimeDir, bunExecutableName))
  await fsp.chmod(path.join(runtimeDir, bunExecutableName), 0o755).catch(() => {})
  await fsp.copyFile(path.join(agentDir, "src", "pty", "node-pty-worker.mjs"), path.join(runtimeDir, "node-pty-worker.mjs"))
  await copyNodePtyRuntime(runtimeNodeModulesDir)
  await fixNodePtySpawnHelperPermissions(runtimeNodeModulesDir)
  await copyCinemaProviderManifests()
  await copyCinemaWebDist()
  await copyBundledPlatformRuntimes()
  await writeConnectorBuildConfig()
  await prepareWorkspaceDependencies({
    bunBinary,
    dependenciesDir: path.join(runtimeDir, "dependencies"),
  })
  await prepareMediaTools({ runtimeDir })

  console.log(`[desktop][build] prepared managed agent runtime at ${runtimeDir}`)
}

await main()
