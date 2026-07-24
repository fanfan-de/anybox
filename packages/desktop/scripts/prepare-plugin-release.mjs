import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildPluginRelease,
  CURRENT_PLUGIN_COUNT,
  PLUGIN_RELEASE_MANIFEST_FILENAME,
  verifyPluginRelease,
} from "../../../plugins/Anybox-Plugins/scripts/plugin-release-lib.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const repoRoot = path.resolve(desktopDir, "..", "..")
const packageJSON = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"))
const outputDirectory = path.resolve(
  process.env.ANYBOX_PLUGIN_RELEASE_OUTPUT_DIR?.trim()
  ?? path.join(desktopDir, "build", "plugin-release"),
)
const sourceCommit = (
  process.env.ANYBOX_PLUGIN_RELEASE_COMMIT?.trim()
  ?? execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim()
).toLowerCase()
const verificationInput = {
  outputDirectory,
  desktopVersion: packageJSON.version,
  sourceCommit,
  expectedPluginCount: CURRENT_PLUGIN_COUNT,
}
const manifestPath = path.join(outputDirectory, PLUGIN_RELEASE_MANIFEST_FILENAME)
const requirePrebuilt = process.env.ANYBOX_REQUIRE_PREBUILT_PLUGIN_RELEASE === "1"

if (fs.existsSync(manifestPath)) {
  try {
    const result = await verifyPluginRelease(verificationInput)
    console.log(
      `[desktop][plugin-release] reusing ${result.releaseManifest.pluginCount} verified assets from ${outputDirectory}`,
    )
    process.exit(0)
  } catch (error) {
    if (requirePrebuilt) throw error
    console.warn(`[desktop][plugin-release] rebuilding invalid local output: ${error instanceof Error ? error.message : error}`)
  }
} else if (requirePrebuilt) {
  throw new Error(`Required prebuilt plugin release is missing: ${manifestPath}`)
}

await buildPluginRelease({
  repoRoot,
  outputDirectory,
  desktopVersion: packageJSON.version,
  sourceCommit,
  expectedPluginCount: CURRENT_PLUGIN_COUNT,
  allowDirty: process.env.CI !== "true",
})
const result = await verifyPluginRelease(verificationInput)
console.log(
  `[desktop][plugin-release] prepared ${result.releaseManifest.pluginCount} assets for ${result.releaseManifest.releaseTag}`,
)
