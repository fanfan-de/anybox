import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parsePluginReleaseRegistry } from "../src/plugin/plugin.ts"

const filePath = process.argv[2]
if (!filePath) {
  throw new Error("Usage: bun run scripts/validate-plugin-release.ts <anybox-plugin-registry.json>")
}

const resolvedPath = resolve(filePath)
const registry = parsePluginReleaseRegistry(JSON.parse(readFileSync(resolvedPath, "utf8")))
process.stdout.write(`${JSON.stringify({
  catalogID: registry.schemaVersion === 3 ? registry.catalogID : undefined,
  desktopVersion: registry.schemaVersion === 2 ? registry.desktopVersion : undefined,
  pluginCount: registry.pluginCount,
  releaseTag: registry.schemaVersion === 2 ? registry.releaseTag : "anybox-plugin-catalog",
  sourceCommit: registry.sourceCommit,
})}\n`)
