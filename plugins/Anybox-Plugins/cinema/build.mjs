import { spawnSync } from "node:child_process"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pluginRoot = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(pluginRoot, "..", "..", "..")
const agentRoot = path.join(repositoryRoot, "packages", "anyboxagent")
const runtimeRoot = path.join(pluginRoot, "runtime")
const runtimeEntry = path.join(pluginRoot, "runtime-src", "server.ts")
const providerCatalog = path.join(agentRoot, "src", "cinema", "provider-manifests.json")
const providerManifests = path.join(agentRoot, "src", "cinema", "provider-manifests")

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
    windowsHide: true,
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`, { cause: result.error })
  }
}

await fsp.rm(runtimeRoot, { recursive: true, force: true })
await fsp.mkdir(runtimeRoot, { recursive: true })

const packageManagerEntry = process.env.npm_execpath?.trim()
if (packageManagerEntry && fs.existsSync(packageManagerEntry)) {
  run(process.execPath, [packageManagerEntry, "--filter", "anybox-cinema-web", "build:plugin"])
} else {
  run("corepack", ["pnpm", "--filter", "anybox-cinema-web", "build:plugin"], {
    shell: process.platform === "win32",
  })
}

const npmBunBinary = process.env.APPDATA
  ? path.join(process.env.APPDATA, "npm", "node_modules", "bun", "bin", process.platform === "win32" ? "bun.exe" : "bun")
  : undefined
const bun = process.env.ANYBOX_BUN_BINARY?.trim()
  || (npmBunBinary && fs.existsSync(npmBunBinary) ? npmBunBinary : "bun")
run(bun, [
  "build",
  runtimeEntry,
  "--target=bun",
  "--outdir",
  runtimeRoot,
  "--entry-naming",
  "server.js",
], { cwd: agentRoot })

await fsp.copyFile(providerCatalog, path.join(runtimeRoot, "provider-manifests.json"))
await fsp.cp(providerManifests, path.join(runtimeRoot, "provider-manifests"), { recursive: true })

console.log(`[cinema-plugin] built Web and Runtime into ${pluginRoot}`)
