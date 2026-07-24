import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parsePluginReleaseRegistry } from "../src/plugin/plugin.ts"

const filePath = process.argv[2]
if (!filePath) {
  throw new Error("Usage: bun run scripts/validate-plugin-release.ts <anybox-plugin-registry-v2.json>")
}

const resolvedPath = resolve(filePath)
const registry = parsePluginReleaseRegistry(JSON.parse(readFileSync(resolvedPath, "utf8")))
process.stdout.write(`${JSON.stringify({
  desktopVersion: registry.desktopVersion,
  pluginCount: registry.pluginCount,
  releaseTag: registry.releaseTag,
  sourceCommit: registry.sourceCommit,
})}\n`)
