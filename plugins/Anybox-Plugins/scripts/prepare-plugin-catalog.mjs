#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  CURRENT_PLUGIN_COUNT,
  PLUGIN_CATALOG_RAW_BASE_URL,
  PLUGIN_CATALOG_REGISTRY_FILENAME,
  preparePluginCatalogRepository,
} from "./plugin-release-lib.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDirectory, "..", "..", "..")

function fail(message) {
  throw new Error(`[plugin-catalog] ${message}`)
}

function resolveBunBinary() {
  const configured = process.env.ANYBOX_BUN_BINARY?.trim()
  if (configured) {
    if (!existsSync(configured)) fail(`ANYBOX_BUN_BINARY does not exist: ${configured}`)
    return configured
  }
  const probe = spawnSync("bun", ["--print", "process.execPath"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  })
  if (probe.status === 0 && probe.stdout.trim() && existsSync(probe.stdout.trim())) return probe.stdout.trim()
  fail("Bun is required to validate the generated registry with the Anybox runtime schema.")
}

function runBunScript(bun, script, args, label, env = process.env) {
  const result = spawnSync(bun, ["run", script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) fail(label)
}

const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
  windowsHide: true,
}).trim()
const result = await preparePluginCatalogRepository({
  repoRoot,
  sourceCommit,
  expectedPluginCount: CURRENT_PLUGIN_COUNT,
})
const registryPath = join(result.outputDirectory, PLUGIN_CATALOG_REGISTRY_FILENAME)
const bun = resolveBunBinary()
runBunScript(
  bun,
  join(repoRoot, "packages", "anyboxagent", "scripts", "validate-plugin-release.ts"),
  [registryPath],
  "The prepared registry failed Anybox runtime validation.",
)
const smokeDataRoot = await mkdtemp(join(tmpdir(), "anybox-plugin-catalog-install-"))
try {
  runBunScript(
    bun,
    join(repoRoot, "packages", "anyboxagent", "scripts", "smoke-plugin-release-install.ts"),
    [registryPath, "context7"],
    "The prepared catalog failed the local plugin installation smoke test.",
    { ...process.env, ANYBOX_PLUGIN_SMOKE_DATA_DIR: smokeDataRoot },
  )
} finally {
  await rm(smokeDataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

console.log(`[plugin-catalog] prepared ${result.releaseManifest.pluginCount} current packages in ${relative(repoRoot, result.outputDirectory)}.`)
console.log(`[plugin-catalog] ${result.newAssets.length} new package files; ${result.reusedAssets.length} byte-identical package files reused.`)
console.log(`[plugin-catalog] no GitHub API, Action, Release, commit, or push was invoked.`)
console.log(`[plugin-catalog] review, commit, and push the catalog files; clients will read ${PLUGIN_CATALOG_RAW_BASE_URL}/${PLUGIN_CATALOG_REGISTRY_FILENAME}`)
