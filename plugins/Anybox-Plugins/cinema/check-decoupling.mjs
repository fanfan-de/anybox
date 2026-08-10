import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pluginRoot = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(pluginRoot, "..", "..", "..")
const coreRoots = [
  "packages/anyboxagent/src",
  "packages/shared/src",
  "packages/desktop/src",
  "packages/desktop/scripts",
]
const pluginRoots = [
  "plugins/Anybox-Plugins/cinema/src",
  "plugins/Anybox-Plugins/cinema/runtime",
  "plugins/Anybox-Plugins/cinema/mcp",
  "plugins/Anybox-Plugins/cinema/web",
]
const coreForbidden = [/cinema/i, /anybox[_-]cinema/i]
const pluginForbidden = [
  /packages[\\/]anyboxagent/i,
  /packages[\\/]cinema-web/i,
  /@anybox[\\/]shared[\\/]cinema/i,
  /ANYBOX_AGENT_/,
  /ANYBOX_CINEMA_/,
  /ANYBOX_FFMPEG_/,
  /ANYBOX_FFPROBE_/,
  /ANYBOX_MEDIA_RUNTIME_/,
]
const buildPath = /(?:[A-Za-z]:[\\/](?:Projects|Users)[\\/]|\/(?:home|Users)\/[^/]+\/)/
const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ts", ".tsx"])

async function files(root) {
  const absoluteRoot = path.join(repositoryRoot, root)
  const result = []
  for (const entry of await fs.readdir(absoluteRoot, { withFileTypes: true }).catch(() => [])) {
    const relative = path.join(root, entry.name)
    if (entry.isDirectory()) result.push(...await files(relative))
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) result.push(relative)
  }
  return result
}

async function assertClean(roots, patterns, options = {}) {
  const failures = []
  for (const file of (await Promise.all(roots.map(files))).flat()) {
    const text = await fs.readFile(path.join(repositoryRoot, file), "utf8")
    for (const pattern of patterns) {
      if (pattern.test(text)) failures.push(`${file}: ${pattern}`)
      pattern.lastIndex = 0
    }
    if (options.absolutePaths && buildPath.test(text)) failures.push(`${file}: build-machine absolute path`)
  }
  if (failures.length) throw new Error(`Cinema decoupling guard failed:\n${failures.join("\n")}`)
}

await assertClean(coreRoots, coreForbidden)
await assertClean(pluginRoots, pluginForbidden, { absolutePaths: true })
console.log(JSON.stringify({
  status: "ok",
  coreRoots,
  pluginRoots,
  guarantees: ["core-has-no-cinema", "plugin-has-no-agent-or-shared-cinema-dependency", "artifacts-have-no-build-paths"],
}))
