import { execFileSync } from "node:child_process"
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  MAX_PLUGIN_PACKAGE_BYTES,
  buildPluginRelease,
  verifyPluginRelease,
} from "../../scripts/plugin-release-lib.mjs"

const testRoot = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(testRoot, "..")
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "anybox-blender-package-"))
const repositoryRoot = path.join(temporaryRoot, "repository")
const pluginsRoot = path.join(repositoryRoot, "plugins", "Anybox-Plugins")
const copiedPluginRoot = path.join(pluginsRoot, "blender")
const outputDirectory = path.join(pluginsRoot, ".catalog")
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: "Anybox Package Smoke",
  GIT_AUTHOR_EMAIL: "package-smoke@anybox.invalid",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_NAME: "Anybox Package Smoke",
  GIT_COMMITTER_EMAIL: "package-smoke@anybox.invalid",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    env: gitEnvironment,
    windowsHide: true,
  }).toString("utf8").trim()
}

try {
  await mkdir(pluginsRoot, { recursive: true })
  await cp(pluginRoot, copiedPluginRoot, { recursive: true, force: false })
  await writeFile(
    path.join(pluginsRoot, "index.json"),
    `${JSON.stringify([
      "https://raw.githubusercontent.com/fanfan-de/anybox/master/plugins/Anybox-Plugins/blender/.anybox-plugin/plugin.json",
    ], null, 2)}\n`,
  )

  git("init", "-q")
  git("add", "--", "plugins/Anybox-Plugins")
  git("commit", "-q", "-m", "Package Blender plugin fixture")
  const sourceCommit = git("rev-parse", "HEAD")

  const build = await buildPluginRelease({
    repoRoot: repositoryRoot,
    pluginsRoot,
    outputDirectory,
    sourceCommit,
    expectedPluginCount: 1,
  })
  await verifyPluginRelease({
    outputDirectory,
    sourceCommit,
    expectedPluginCount: 1,
  })

  const [asset] = build.releaseManifest.assets
  if (!asset || asset.pluginID !== "blender") throw new Error("Packager did not emit the Blender plugin asset.")
  if (asset.size > MAX_PLUGIN_PACKAGE_BYTES) {
    throw new Error(`Blender package exceeds the ${MAX_PLUGIN_PACKAGE_BYTES}-byte release limit.`)
  }

  process.stdout.write(`${JSON.stringify({
    pluginID: asset.pluginID,
    pluginVersion: asset.pluginVersion,
    assetName: asset.name,
    packageBytes: asset.size,
    packageSha256: asset.sha256,
    verified: true,
  }, null, 2)}\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
