import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const testPath = fileURLToPath(import.meta.url)
const testRoot = path.dirname(testPath)
const pluginRoot = path.resolve(testRoot, "..")
const sourceRoot = path.dirname(pluginRoot)
const repositoryRoot = path.resolve(pluginRoot, "..", "..", "..")
const agentRoot = path.join(repositoryRoot, "packages", "anyboxagent")

async function inspectCatalog() {
  const pluginModuleURL = pathToFileURL(path.join(agentRoot, "src", "plugin", "plugin.ts")).href
  const Plugin = await import(pluginModuleURL)
  const blender = (await Plugin.listCatalog()).find((item) => item.id === "blender")

  if (!blender) throw new Error("Blender plugin is missing from the Anybox catalog.")
  if (blender.version !== "0.1.0") throw new Error(`Unexpected Blender plugin version: ${blender.version}`)
  if (!blender.installable) throw new Error("Blender plugin is not installable from its local source package.")
  if (blender.risk !== "high") throw new Error(`Unexpected Blender plugin risk: ${blender.risk}`)
  if (blender.mcpServers.length !== 1) throw new Error("Expected exactly one Blender MCP server.")
  if (blender.tools.length !== 26) throw new Error(`Expected 26 Blender tool previews, received ${blender.tools.length}.`)
  if (blender.skills.length !== 1) throw new Error("Expected exactly one Blender workflow skill.")

  let installed = false
  try {
    const record = await Plugin.install("blender", { enabled: true })
    installed = true
    if (record.mcpServerIDs.length !== 1) throw new Error("Blender install did not register exactly one MCP server.")
    if (record.skillIDs.length !== 1) throw new Error("Blender install did not register exactly one skill.")
    if (record.config.BLENDER_UV_PATH !== "uv") throw new Error("Blender install did not apply the default uv path.")
    if (record.config.BLENDER_MCP_PORT !== "9876") throw new Error("Blender install did not apply the default MCP port.")

    const diagnostic = await Plugin.diagnose("blender")
    if (!diagnostic.ok) throw new Error(`Anybox Blender MCP diagnostic failed: ${diagnostic.error}`)
    if (diagnostic.toolCount !== 26) {
      throw new Error(`Anybox diagnostic expected 26 Blender tools, received ${diagnostic.toolCount}.`)
    }

    process.stdout.write(`${JSON.stringify({
      id: blender.id,
      version: blender.version,
      category: blender.category,
      risk: blender.risk,
      installable: blender.installable,
      mcpServers: blender.mcpServers.length,
      tools: blender.tools.length,
      skills: blender.skills.length,
      installed: true,
      diagnosticOK: diagnostic.ok,
      diagnosticToolCount: diagnostic.toolCount,
    }, null, 2)}\n`)
  } finally {
    if (installed) await Plugin.remove("blender")
  }
}

if (process.argv[2] === "--catalog-child") {
  await inspectCatalog()
  process.exit(0)
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "anybox-blender-catalog-"))
try {
  const child = Bun.spawn(
    [process.execPath, testPath, "--catalog-child"],
    {
      cwd: agentRoot,
      env: {
        ...process.env,
        ANYBOX_AGENT_DATA_DIR: path.join(temporaryRoot, "agent-data"),
        ANYBOX_TEST_HOME: path.join(temporaryRoot, "home"),
        ANYBOX_PLUGIN_LOCAL_DIR: sourceRoot,
        ANYBOX_PLUGIN_INSTALL_DIR: path.join(temporaryRoot, "managed-plugins"),
        ANYBOX_PLUGIN_REGISTRY_INDEX_URL: "off",
        ANYBOX_PLUGIN_INCLUDE_SOURCE_PACKAGES: "0",
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`Anybox catalog smoke exited with code ${exitCode}.`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
