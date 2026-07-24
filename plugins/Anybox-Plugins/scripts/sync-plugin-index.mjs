import { readFile, writeFile } from "node:fs/promises"
import { existsSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const pluginsRoot = resolve(scriptDir, "..")
const indexPath = join(pluginsRoot, "index.json")
const manifestSuffix = ".anybox-plugin/plugin.json"
const urls = readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((entry) =>
    entry.isDirectory()
    && !entry.name.startsWith(".")
    && existsSync(join(pluginsRoot, entry.name, manifestSuffix)))
  .map((entry) =>
    `https://raw.githubusercontent.com/fanfan-de/anybox/master/plugins/Anybox-Plugins/${entry.name}/${manifestSuffix}`)
  .sort()
const expected = `${JSON.stringify(urls, null, 2)}\n`

if (process.argv.includes("--check")) {
  const actual = await readFile(indexPath, "utf8")
  if (actual !== expected) {
    throw new Error("plugins/Anybox-Plugins/index.json is stale. Run `pnpm plugins:index`.")
  }
  console.log(`[plugin-index] verified ${urls.length} canonical plugin entries`)
} else {
  await writeFile(indexPath, expected)
  console.log(`[plugin-index] generated ${urls.length} canonical plugin entries`)
}
