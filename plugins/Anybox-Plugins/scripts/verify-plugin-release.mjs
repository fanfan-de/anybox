#!/usr/bin/env node

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  CURRENT_PLUGIN_COUNT,
  PLUGIN_CATALOG_MANIFEST_FILENAME,
  verifyPluginRelease,
} from "./plugin-release-lib.mjs"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDirectory, "..", "..", "..")

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const outputDirectory = path.resolve(argument("--dir") ?? path.join(repoRoot, "build", "plugin-catalog"))
const manifestPath = path.join(outputDirectory, PLUGIN_CATALOG_MANIFEST_FILENAME)
const sourceCommit = argument("--commit")
  ?? process.env.ANYBOX_PLUGIN_CATALOG_COMMIT?.trim()
  ?? JSON.parse(readFileSync(manifestPath, "utf8")).sourceCommit
if (!sourceCommit) {
  throw new Error("Plugin catalog verification requires a sourceCommit in its manifest or --commit <40-char-sha>.")
}

const expectedPluginCount = Number(argument("--expected-count") ?? CURRENT_PLUGIN_COUNT)
const result = await verifyPluginRelease({
  outputDirectory,
  sourceCommit,
  expectedPluginCount,
  allowHistoricalPackages: process.argv.includes("--allow-historical-packages"),
})

console.log(
  `[plugin-catalog] verified ${result.releaseManifest.pluginCount} current assets for repository ref ${result.releaseManifest.repositoryRef} from ${path.relative(repoRoot, outputDirectory) || "."}`,
)
