#!/usr/bin/env node

import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  CURRENT_PLUGIN_COUNT,
  verifyPluginRelease,
} from "./plugin-release-lib.mjs"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDirectory, "..", "..", "..")

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const outputDirectory = path.resolve(argument("--dir") ?? path.join(repoRoot, "build", "plugin-catalog"))
const sourceCommit = argument("--commit") ?? process.env.ANYBOX_PLUGIN_RELEASE_COMMIT?.trim()
if (!sourceCommit) {
  throw new Error("Plugin catalog verification requires --commit <40-char-sha> or ANYBOX_PLUGIN_RELEASE_COMMIT.")
}

const expectedPluginCount = Number(argument("--expected-count") ?? CURRENT_PLUGIN_COUNT)
const result = await verifyPluginRelease({
  outputDirectory,
  sourceCommit,
  expectedPluginCount,
})

console.log(
  `[plugin-catalog] verified ${result.releaseManifest.pluginCount} assets for ${result.releaseManifest.releaseTag} from ${path.relative(repoRoot, outputDirectory) || "."}`,
)
