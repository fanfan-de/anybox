#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildPluginRelease,
  CURRENT_PLUGIN_COUNT,
  PLUGIN_RELEASE_REGISTRY_FILENAME,
} from "./plugin-release-lib.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDirectory, "..", "..", "..")

function fail(message) {
  console.error(`[plugin-release] ${message}`)
  process.exit(1)
}

function parseArguments(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--allow-dirty") {
      result.allowDirty = true
      continue
    }
    if (!argument.startsWith("--")) fail(`Unknown argument '${argument}'.`)
    const key = argument.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) fail(`Argument '${argument}' requires a value.`)
    result[key] = value
    index += 1
  }
  return result
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
  if (probe.status === 0 && probe.stdout.trim() && existsSync(probe.stdout.trim())) {
    return probe.stdout.trim()
  }
  fail("Bun is required to validate the generated registry.")
}

function validateWithRuntime(registryPath) {
  const bun = resolveBunBinary()
  const validator = join(repoRoot, "packages", "anyboxagent", "scripts", "validate-plugin-release.ts")
  const result = spawnSync(bun, ["run", validator, registryPath], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) fail("The generated registry failed Anybox runtime validation.")
}

const args = parseArguments(process.argv.slice(2))
const desktopVersion = args["desktop-version"]?.trim()
const sourceCommit = args.commit?.trim()
const outputDirectory = args.out?.trim()
if (!desktopVersion || !sourceCommit || !outputDirectory) {
  fail("Usage: node build-plugin-release.mjs --desktop-version <semver> --commit <40-char-sha> --out <directory> [--allow-dirty]")
}

const expectedPluginCount = args["expected-count"]
  ? Number.parseInt(args["expected-count"], 10)
  : CURRENT_PLUGIN_COUNT

const result = await buildPluginRelease({
  repoRoot,
  outputDirectory,
  desktopVersion,
  sourceCommit,
  expectedPluginCount,
  allowDirty: args.allowDirty === true,
})
const registryPath = join(result.outputDirectory, PLUGIN_RELEASE_REGISTRY_FILENAME)
validateWithRuntime(registryPath)
const registry = JSON.parse(readFileSync(registryPath, "utf8"))
console.log(
  `[plugin-release] built ${registry.pluginCount} deterministic plugin packages for ${registry.releaseTag} in ${result.outputDirectory}`,
)
