import { build as viteBuild } from "vite"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pluginRoot = path.dirname(fileURLToPath(import.meta.url))
const runtimeRoot = path.join(pluginRoot, "runtime")
const webRoot = path.join(pluginRoot, "web")
const mcpRoot = path.join(pluginRoot, "mcp")

await Promise.all([
  fs.rm(webRoot, { recursive: true, force: true }),
  fs.rm(runtimeRoot, { recursive: true, force: true }),
  fs.rm(mcpRoot, { recursive: true, force: true }),
])
await Promise.all([
  fs.mkdir(runtimeRoot, { recursive: true }),
  fs.mkdir(mcpRoot, { recursive: true }),
])

await viteBuild({
  configFile: path.join(pluginRoot, "vite.config.ts"),
  root: pluginRoot,
})

for (const target of [
  { entrypoint: path.join(pluginRoot, "src", "server.ts"), outdir: runtimeRoot, label: "Runtime" },
  { entrypoint: path.join(pluginRoot, "src", "mcp", "server.ts"), outdir: mcpRoot, label: "MCP" },
]) {
  const result = await Bun.build({
    entrypoints: [target.entrypoint],
    outdir: target.outdir,
    target: "bun",
    naming: "server.js",
    minify: false,
    sourcemap: "none",
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    throw new Error(`Cinema ${target.label} build failed.`)
  }
}

await Promise.all([
  fs.copyFile(
    path.join(pluginRoot, "src", "domain", "provider-manifests.json"),
    path.join(runtimeRoot, "provider-manifests.json"),
  ),
  fs.cp(
    path.join(pluginRoot, "src", "domain", "provider-manifests"),
    path.join(runtimeRoot, "provider-manifests"),
    { recursive: true },
  ),
  fs.copyFile(path.join(pluginRoot, "toolchain.lock.json"), path.join(runtimeRoot, "toolchain.lock.json")),
])

const bundles = await Promise.all([
  fs.readFile(path.join(runtimeRoot, "server.js"), "utf8"),
  fs.readFile(path.join(mcpRoot, "server.js"), "utf8"),
])
const forbidden = [
  "packages/anyboxagent",
  "packages\\\\anyboxagent",
  "@anybox/shared/cinema",
  "ANYBOX_AGENT_DATA_DIR",
  "ANYBOX_FFMPEG_BINARY",
  "ANYBOX_FFPROBE_BINARY",
  "ANYBOX_CINEMA_",
]
for (const value of forbidden) {
  if (bundles.some((bundle) => bundle.includes(value))) {
    throw new Error(`Cinema build contains forbidden dependency marker: ${value}`)
  }
}

console.log(`[cinema-plugin] built self-contained Web, Runtime, and MCP into ${pluginRoot}`)
