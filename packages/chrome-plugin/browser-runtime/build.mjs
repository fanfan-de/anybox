import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const outputRoot = path.join(projectRoot, "dist")
const outputPath = path.join(outputRoot, "browser-client.mjs")

await fsp.rm(outputRoot, { recursive: true, force: true })
await fsp.mkdir(outputRoot, { recursive: true })

await build({
  entryPoints: [path.join(projectRoot, "src", "browser-client.ts")],
  outfile: outputPath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  treeShaking: true,
  charset: "utf8",
  banner: {
    js: "// Generated from browser-runtime/src/browser-client.ts by esbuild. Do not edit.",
  },
})

const bundledSource = await fsp.readFile(outputPath, "utf8")
const normalizedSource = bundledSource.replace(/[ \t]+$/gm, "")
if (normalizedSource !== bundledSource) {
  await fsp.writeFile(outputPath, normalizedSource)
}
