import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const directory = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(directory, "..")
const { PLUGIN_VERSION } = require("../scripts/lib/build-info")
const manifest = JSON.parse(
  fs.readFileSync(path.join(pluginRoot, ".anybox-plugin", "plugin.json"), "utf8"),
)

test("manifest exposes only generic Node REPL while the runtime stays in the plugin package", () => {
  assert.equal(manifest.version, PLUGIN_VERSION)
  assert.equal(manifest.mcpServers, undefined)
  assert.equal(manifest.mcpRequirements.length, 1)
  const nodeRepl = manifest.mcpRequirements[0]
  assert.equal(nodeRepl.mcp, "node-repl")
  assert.equal(nodeRepl.required, true)
  assert.deepEqual(nodeRepl.tools, ["js", "js_reset"])
  assert.equal(manifest.keywords.includes("mcp"), false)
  assert.equal(fs.existsSync(path.join(pluginRoot, "scripts", "runtime.cjs")), true)
  assert.equal(fs.existsSync(path.join(pluginRoot, "scripts", "lib", "helper-client.js")), true)
  assert.equal(fs.existsSync(path.join(
    pluginRoot,
    "helper",
    "win32-x64",
    "computer-use-helper.exe",
  )), true)
})
