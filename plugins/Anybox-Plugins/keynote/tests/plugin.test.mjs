import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const testRoot = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(testRoot, "..")

async function read(relativePath) {
  return readFile(path.join(pluginRoot, relativePath), "utf8")
}

async function manifest() {
  return JSON.parse(await read(path.join(".anybox-plugin", "plugin.json")))
}

test("declares the canonical Anybox package and a pinned local MCP runtime", async () => {
  const plugin = await manifest()
  assert.equal(plugin.name, "keynote")
  assert.equal(plugin.version, "0.1.0")
  assert.equal(plugin.skills, "skills")
  assert.equal(plugin.mcpServers.length, 1)

  const [server] = plugin.mcpServers
  assert.equal(server.id, "control")
  assert.equal(server.risk, "high")
  assert.equal(server.runtime.transport, "stdio")
  assert.equal(server.runtime.command, "/bin/sh")
  assert.deepEqual(server.runtime.args, ["${PLUGIN_ROOT}/scripts/launch-keynote-mcp.sh"])
  assert.equal(server.runtime.cwd, "${PLUGIN_ROOT}")
  assert.equal(server.runtime.env.UNSPLASH_KEY, "${UNSPLASH_KEY}")
  assert.equal(server.runtime.env.KEYNOTE_UV_PATH, "${KEYNOTE_UV_PATH}")
})

test("keeps optional credentials out of source and asks before mutations", async () => {
  const plugin = await manifest()
  const [server] = plugin.mcpServers
  const unsplash = server.configFields.find((field) => field.key === "UNSPLASH_KEY")

  assert.ok(unsplash)
  assert.equal(unsplash.required, false)
  assert.equal(unsplash.secret, true)
  assert.equal("defaultValue" in unsplash, false)

  for (const tool of [
    "create_presentation",
    "add_slide",
    "add_text_box",
    "delete_slide",
    "clear_slide",
    "screenshot_slide",
    "export_pdf",
    "search_unsplash_images",
  ]) {
    assert.equal(server.runtime.toolPolicies[tool], undefined)
  }

  for (const tool of [
    "list_presentations",
    "get_available_themes",
    "get_slide_content",
    "get_speaker_notes",
  ]) {
    assert.equal(server.runtime.toolPolicies[tool].policy, "auto")
  }
})

test("contains every referenced runtime, asset, and skill file", async () => {
  const requiredPaths = [
    ".anybox-plugin/plugin.json",
    ".gitattributes",
    "assets/keynote.svg",
    "scripts/launch-keynote-mcp.sh",
    "runtime/keynote-mcp/pyproject.toml",
    "runtime/keynote-mcp/uv.lock",
    "runtime/keynote-mcp/LICENSE",
    "runtime/keynote-mcp/src/keynote_mcp/server.py",
    "skills/keynote-presentation/SKILL.md",
    "tests/mcp-smoke.mjs",
  ]

  for (const relativePath of requiredPaths) {
    assert.equal(existsSync(path.join(pluginRoot, relativePath)), true, relativePath)
  }

  const skill = await read("skills/keynote-presentation/SKILL.md")
  const references = [...skill.matchAll(/`(references\/[^`]+\.md)`/g)].map((match) => match[1])
  assert.ok(references.length >= 7)
  for (const relativePath of new Set(references)) {
    assert.equal(
      existsSync(path.join(pluginRoot, "skills", "keynote-presentation", relativePath)),
      true,
      relativePath,
    )
  }
})

test("records the exact upstream revision and launches a frozen environment", async () => {
  const notice = await read("THIRD_PARTY_NOTICES.md")
  const pyproject = await read("runtime/keynote-mcp/pyproject.toml")
  const launcher = await read("scripts/launch-keynote-mcp.sh")
  const server = await read("runtime/keynote-mcp/src/keynote_mcp/server.py")

  assert.match(notice, /aca972f8739c024f821ae8d99b293f55b9479ba7/)
  assert.match(pyproject, /version = "1\.0\.1"/)
  assert.match(pyproject, /"mcp>=1\.0\.0,<2\.0\.0"/)
  assert.match(launcher, /platform_name.*Darwin/s)
  assert.match(launcher, /--frozen/)
  assert.match(launcher, /--no-editable/)
  assert.match(launcher, /--python 3\.12/)
  assert.doesNotMatch(launcher, /curl|pip install|git clone/)
  assert.match(server, /print\(f"Unsplash tools disabled: \{e\}", file=sys\.stderr\)/)
  assert.doesNotMatch(server, /print\(f"⚠️/)
})
