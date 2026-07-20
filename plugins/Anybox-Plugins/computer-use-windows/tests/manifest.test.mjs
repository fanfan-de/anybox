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
const { TOOL_DEFINITIONS } = require("../scripts/lib/tool-definitions")
const manifest = JSON.parse(
  fs.readFileSync(path.join(pluginRoot, ".anybox-plugin", "plugin.json"), "utf8"),
)

test("manifest, MCP definitions, and tool policies stay synchronized", () => {
  assert.equal(manifest.version, PLUGIN_VERSION)
  assert.equal(manifest.mcpServers, undefined)
  const nodeRepl = manifest.mcpRequirements.find((item) => item.mcp === "node-repl")
  assert.equal(nodeRepl.required, true)
  assert.deepEqual(nodeRepl.tools, ["js", "js_reset"])
  const requirement = manifest.mcpRequirements.find((item) => item.mcp === "computer-use")
  assert.equal(requirement.required, true)
  assert.deepEqual(
    requirement.tools,
    TOOL_DEFINITIONS.map((tool) => tool.name),
  )
})
