import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  CURRENT_PLUGIN_COUNT,
  verifyPluginRelease,
} from "../../../plugins/Anybox-Plugins/scripts/plugin-release-lib.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(desktopDir, "..", "..")

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const outputDirectory = path.resolve(argument("--dir") ?? path.join(desktopDir, "build", "plugin-release"))
const desktopVersion = argument("--desktop-version")
  ?? JSON.parse(await import("node:fs/promises").then(({ readFile }) =>
    readFile(path.join(desktopDir, "package.json"), "utf8"))).version
const sourceCommit = argument("--commit")
  ?? process.env.ANYBOX_PLUGIN_RELEASE_COMMIT?.trim()

if (!sourceCommit) {
  throw new Error("Plugin release verification requires --commit <40-char-sha> or ANYBOX_PLUGIN_RELEASE_COMMIT.")
}

const expectedPluginCount = Number(argument("--expected-count") ?? CURRENT_PLUGIN_COUNT)
const result = await verifyPluginRelease({
  outputDirectory,
  desktopVersion,
  sourceCommit,
  expectedPluginCount,
})

console.log(
  `[desktop][plugin-release] verified ${result.releaseManifest.pluginCount} assets for ${result.releaseManifest.releaseTag} from ${path.relative(repoRoot, outputDirectory) || "."}`,
)
