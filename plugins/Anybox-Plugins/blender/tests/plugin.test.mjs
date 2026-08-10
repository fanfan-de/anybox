import assert from "node:assert/strict"
import { existsSync, readdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const testRoot = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(testRoot, "..")
const runtimeRoot = path.join(pluginRoot, "runtime", "blender-mcp")

const expectedTools = [
  "execute_blender_code",
  "execute_blender_code_for_cli",
  "get_blendfile_summary_datablocks",
  "get_blendfile_summary_datablocks_for_cli",
  "get_blendfile_summary_missing_files",
  "get_blendfile_summary_missing_files_for_cli",
  "get_blendfile_summary_of_linked_libraries",
  "get_blendfile_summary_of_linked_libraries_for_cli",
  "get_blendfile_summary_path_info",
  "get_blendfile_summary_path_info_for_cli",
  "get_blendfile_summary_usage_guess",
  "get_blendfile_summary_usage_guess_for_cli",
  "get_object_detail_summary",
  "get_objects_summary",
  "get_python_api_docs",
  "get_screenshot_of_area_as_image",
  "get_screenshot_of_window_as_image",
  "get_screenshot_of_window_as_json",
  "jump_to_tab_by_name",
  "jump_to_tab_by_space_type",
  "jump_to_view3d_object_by_name",
  "jump_to_view3d_object_data_by_name",
  "render_thumbnail_to_path",
  "render_viewport_to_path",
  "search_api_docs",
  "search_manual_docs",
]
const expectedToolModules = expectedTools.filter((name) => !name.endsWith("_for_cli"))

const autoTools = [
  "get_blendfile_summary_datablocks",
  "get_blendfile_summary_missing_files",
  "get_blendfile_summary_of_linked_libraries",
  "get_blendfile_summary_path_info",
  "get_blendfile_summary_usage_guess",
  "get_object_detail_summary",
  "get_objects_summary",
  "get_python_api_docs",
  "search_api_docs",
  "search_manual_docs",
]

async function read(relativePath) {
  return readFile(path.join(pluginRoot, relativePath), "utf8")
}

async function manifest() {
  return JSON.parse(await read(path.join(".anybox-plugin", "plugin.json")))
}

test("declares a canonical high-risk stdio MCP plugin without an App Runtime or Connector", async () => {
  const plugin = await manifest()
  assert.equal(plugin.name, "blender")
  assert.equal(plugin.version, "0.1.0")
  assert.equal(plugin.license, "GPL-3.0-or-later")
  assert.equal(plugin.skills, "skills")
  assert.equal(plugin.appRuntime, undefined)
  assert.equal(plugin.connectors, undefined)
  assert.equal(plugin.platformArtifacts, undefined)
  assert.equal(plugin.mcpServers.length, 1)

  const [server] = plugin.mcpServers
  assert.equal(server.id, "official")
  assert.equal(server.risk, "high")
  assert.equal(server.runtime.transport, "stdio")
  assert.equal(server.runtime.command, "${BLENDER_UV_PATH}")
  assert.deepEqual(server.runtime.args, [
    "run",
    "--no-project",
    "--python",
    "3.11",
    "${PLUGIN_ROOT}/scripts/launch_blender_mcp.py",
  ])
  assert.equal(server.runtime.cwd, "${PLUGIN_ROOT}")
  assert.equal(server.runtime.env.BLENDER_MCP_HOST, "localhost")
  assert.equal(server.runtime.env.BLENDER_MCP_PORT, "${BLENDER_MCP_PORT}")
  assert.equal(server.runtime.env.BLENDER_MCP_PROJECT, "${PLUGIN_ROOT}/runtime/blender-mcp")
  assert.equal(server.runtime.env.BLENDER_UV_PATH, "${BLENDER_UV_PATH}")
  assert.match(server.runtime.env.UV_PROJECT_ENVIRONMENT, /PLUGIN_APP_CACHE_DIR/)
})

test("pins safe defaults and asks before arbitrary code or unlisted tools", async () => {
  const plugin = await manifest()
  const [server] = plugin.mcpServers
  const uvPath = server.configFields.find((field) => field.key === "BLENDER_UV_PATH")
  const port = server.configFields.find((field) => field.key === "BLENDER_MCP_PORT")
  const blenderPath = server.configFields.find((field) => field.key === "BLENDER_PATH")

  assert.equal(uvPath.defaultValue, "uv")
  assert.equal(uvPath.required, true)
  assert.equal(port.defaultValue, "9876")
  assert.equal(port.required, true)
  assert.equal(blenderPath.required, false)
  assert.equal("defaultValue" in blenderPath, false)
  assert.equal(server.runtime.env.BLENDER_PATH, "${BLENDER_PATH}")
  assert.equal(server.runtime.toolPolicies.execute_blender_code.policy, "ask")
  assert.equal(server.runtime.toolPolicies.execute_blender_code_for_cli.policy, "ask")

  for (const tool of autoTools) {
    assert.equal(server.runtime.toolPolicies[tool].policy, "auto", tool)
  }
  for (const tool of expectedTools.filter((name) =>
    !autoTools.includes(name)
    && name !== "execute_blender_code"
    && name !== "execute_blender_code_for_cli")) {
    assert.equal(server.runtime.toolPolicies[tool], undefined, tool)
  }

  const previewNames = server.tools.map((tool) => tool.name).sort()
  assert.deepEqual(previewNames, [...expectedTools].sort())
  assert.equal(server.tools.find((tool) => tool.name === "execute_blender_code").destructive, true)
  assert.equal(server.tools.find((tool) => tool.name === "render_viewport_to_path").destructive, true)
})

test("contains the pinned official MCP Bundle and every referenced package component", async () => {
  const requiredPaths = [
    ".anybox-plugin/plugin.json",
    ".gitattributes",
    "README.md",
    "THIRD_PARTY_NOTICES.md",
    "runtime/blender-mcp/.anybox-upstream.json",
    "runtime/blender-mcp/manifest.json",
    "runtime/blender-mcp/pyproject.toml",
    "runtime/blender-mcp/uv.lock",
    "runtime/blender-mcp/blender_icon.png",
    "runtime/blender-mcp/blmcp/__init__.py",
    "skills/blender-workflow/SKILL.md",
    "scripts/sync-official.mjs",
    "scripts/launch_blender_mcp.py",
    "tests/catalog-smoke.mjs",
    "tests/mcp-smoke.mjs",
    "tests/package-smoke.mjs",
  ]

  for (const relativePath of requiredPaths) {
    assert.equal(existsSync(path.join(pluginRoot, relativePath)), true, relativePath)
  }

  const upstream = JSON.parse(await read("runtime/blender-mcp/.anybox-upstream.json"))
  const upstreamManifest = JSON.parse(await read("runtime/blender-mcp/manifest.json"))
  assert.equal(upstream.upstreamVersion, "1.0.0")
  assert.equal(upstream.bundleSha256, "93b070b1df82f57b1e7678b88b6bae28d06f105cd23ff6a4e0cc5f538bee2450")
  assert.equal(upstream.entryCount, 4445)
  assert.equal(upstream.uncompressedSize, 15797990)
  assert.equal(upstreamManifest.manifest_version, "0.4")
  assert.equal(upstreamManifest.version, "1.0.0")
  assert.equal(upstreamManifest.server.type, "uv")
  assert.deepEqual(upstreamManifest.server.mcp_config, {
    command: "uv",
    args: ["run", "blender-mcp"],
  })
})

test("keeps the reviewed v1.0.0 tool module inventory exact", () => {
  const toolsDirectory = path.join(runtimeRoot, "blmcp", "tools")
  const actualTools = readdirSync(toolsDirectory)
    .filter((name) => name.endsWith(".py"))
    .filter((name) => name !== "__init__.py")
    .filter((name) => !name.startsWith("_template_"))
    .filter((name) => !name.endsWith("_toolcode.py"))
    .map((name) => path.basename(name, ".py"))
    .sort()

  assert.deepEqual(actualTools, [...expectedToolModules].sort())
  assert.equal(actualTools.length, 20)
})

test("records provenance and never fetches floating runtime code at launch", async () => {
  const notice = await read("THIRD_PARTY_NOTICES.md")
  const syncScript = await read("scripts/sync-official.mjs")
  const launchScript = await read("scripts/launch_blender_mcp.py")
  const manifestText = await read(".anybox-plugin/plugin.json")

  assert.match(notice, /v1\.0\.0/)
  assert.match(notice, /93b070b1df82f57b1e7678b88b6bae28d06f105cd23ff6a4e0cc5f538bee2450/)
  assert.match(syncScript, /EXPECTED_BUNDLE_SHA256/)
  assert.match(syncScript, /assertSafeEntryPath/)
  assert.match(launchScript, /--no-install-project/)
  assert.match(launchScript, /--no-sync/)
  assert.match(launchScript, /PYTHONPATH/)
  assert.doesNotMatch(manifestText, /@latest|git\+|git clone|pip install/)
})
