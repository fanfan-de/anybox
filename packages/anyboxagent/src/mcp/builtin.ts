import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import z from "zod"
import * as Config from "#config/config.ts"
import { getProcessEnvValue } from "#env/compat.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "mcp.builtin" })

const BUILD_NODE_REPL_MCP_PATH = ["mcp", "node-repl"] as const
const SOURCE_NODE_REPL_MCP_PATH = ["mcp", "node-repl"] as const
const RETIRED_COMPUTER_USE_SERVER_ID = "anybox.computer-use"
const RETIRED_COMPUTER_USE_BINDING_ID = "computer-use"

export const NODE_REPL_DEFINITION_ID = "node-repl"
export const NODE_REPL_SERVER_ID = "anybox.node-repl"
export const LEGACY_NODE_REPL_SERVER_ID = "connector.node-repl.default"
export const LEGACY_NODE_REPL_CONNECTOR_ID = "connector:node-repl:default"

export const McpRequirement = z
  .object({
    mcp: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]*$/),
    tools: z.array(z.string().min(1)).optional(),
    permissions: z.array(z.string().min(1)).optional(),
    required: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .strict()
export type McpRequirement = z.infer<typeof McpRequirement>

export interface BuiltinMcpToolPreview {
  name: string
  title?: string
  description: string
  readOnly?: boolean
  destructive?: boolean
}

export interface BuiltinMcpDefinition {
  id: string
  serverID: string
  name: string
  description: string
  publisher: string
  icon?: string
  risk: "low" | "medium" | "high" | "critical"
  permissions: string[]
  tools: BuiltinMcpToolPreview[]
  installReview: string[]
  available: boolean
  runtime: Config.McpStdioServerInput
}

function moduleRoot() {
  return dirname(fileURLToPath(import.meta.url))
}

function packageRootFromAnyboxAgentRoot(...segments: string[]) {
  return resolve(moduleRoot(), "..", "..", ...segments)
}

function bundledRuntimeRoot() {
  return moduleRoot()
}

function builtinNodeReplMcpRoot() {
  const packagedRoot = resolve(bundledRuntimeRoot(), ...BUILD_NODE_REPL_MCP_PATH)
  return existsSync(packagedRoot)
    ? packagedRoot
    : packageRootFromAnyboxAgentRoot(...SOURCE_NODE_REPL_MCP_PATH)
}

function builtinNodeReplCommand() {
  return getProcessEnvValue("ANYBOX_NODE_BINARY")?.trim() || "node"
}

function builtinNodeReplEnvironment() {
  return getProcessEnvValue("ANYBOX_NODE_RUN_AS_NODE") === "1"
    ? { ELECTRON_RUN_AS_NODE: "1" }
    : undefined
}

function nodeReplDefinition(): BuiltinMcpDefinition {
  const serverPath = resolve(builtinNodeReplMcpRoot(), "server.js")
  const available = existsSync(serverPath)

  return {
    id: NODE_REPL_DEFINITION_ID,
    serverID: NODE_REPL_SERVER_ID,
    name: "Node REPL",
    description: "Run JavaScript in a persistent, general-purpose Node.js environment.",
    publisher: "Anybox",
    icon: "JS",
    risk: "high",
    permissions: [
      "Runs JavaScript requested by the agent in a persistent local process.",
      "JavaScript can load local modules and access the local filesystem and network.",
      "Imported modules run with ordinary Node.js capabilities; this runtime does not add domain-specific host services.",
    ],
    tools: [
      {
        name: "js",
        title: "Node REPL JavaScript",
        description: "Run JavaScript in a persistent general-purpose Node.js environment.",
        readOnly: false,
      },
      {
        name: "js_reset",
        title: "Reset Node REPL",
        description: "Reset the persistent Node.js environment.",
        readOnly: false,
      },
      {
        name: "js_add_node_module_dir",
        title: "Add Node Module Directory",
        description: "Add a node_modules directory to CommonJS module resolution.",
        readOnly: false,
      },
    ],
    installReview: [
      "This MCP runtime belongs to Anybox rather than to a specific plugin.",
      "Its working directory is the active project, not an installed plugin package.",
      "Plugins can expose capabilities by having the agent import their own modules at runtime.",
    ],
    available,
    runtime: {
      name: "Node REPL",
      transport: "stdio",
      command: builtinNodeReplCommand(),
      args: [serverPath],
      env: builtinNodeReplEnvironment(),
      toolPolicies: {
        js_reset: {
          policy: "auto",
        },
        js_add_node_module_dir: {
          policy: "ask",
        },
        js: {
          policy: "ask",
        },
      },
      enabled: true,
      timeoutMs: 120_000,
    },
  }
}

export function listDefinitions(): BuiltinMcpDefinition[] {
  return [nodeReplDefinition()]
}

export function getDefinition(definitionID: string) {
  const normalizedDefinitionID = definitionID.trim().toLowerCase()
  return listDefinitions().find((definition) => definition.id === normalizedDefinitionID)
}

export function serverIDForDefinition(definitionID: string) {
  return getDefinition(definitionID)?.serverID
}

function isCanonicalNodeReplOwner(owner: Config.McpServerOwner | undefined) {
  return owner?.kind === "anybox" && owner.bindingID === NODE_REPL_DEFINITION_ID
}

function isLegacyNodeReplServer(server: Config.McpServerSummary | undefined) {
  if (!server || server.id !== LEGACY_NODE_REPL_SERVER_ID) return false
  if (
    server.owner?.kind === "anybox"
    && (
      server.owner.bindingID === LEGACY_NODE_REPL_SERVER_ID
      || server.owner.bindingID === NODE_REPL_DEFINITION_ID
    )
  ) {
    return true
  }
  return server.transport === "connector" && server.connectorId === LEGACY_NODE_REPL_CONNECTOR_ID
}

export function isNodeReplServer(server: Config.McpServerSummary) {
  return (
    server.id === NODE_REPL_SERVER_ID
    && server.transport === "stdio"
    && isCanonicalNodeReplOwner(server.owner)
  )
}

export async function syncBuiltinMcpRuntimeBindings() {
  const definition = nodeReplDefinition()
  const existing = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, definition.serverID)
  const legacy = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, LEGACY_NODE_REPL_SERVER_ID)

  const canManageNodeRepl =
    !existing?.owner || isCanonicalNodeReplOwner(existing.owner)
  if (!canManageNodeRepl) {
    log.warn("built-in MCP binding id is owned by another source", {
      serverID: definition.serverID,
      owner: existing.owner,
    })
  } else {
    const previousControls =
      existing ?? (isLegacyNodeReplServer(legacy) ? legacy : undefined)
    await Config.setManagedMcpServer(
      Config.GLOBAL_CONFIG_ID,
      definition.serverID,
      {
        ...definition.runtime,
        enabled: previousControls?.enabled ?? definition.runtime.enabled,
        toolPolicies:
          previousControls?.toolPolicies ?? definition.runtime.toolPolicies,
      },
      {
        kind: "anybox",
        bindingID: definition.id,
      },
    )

    if (isLegacyNodeReplServer(legacy)) {
      await Config.replaceSelectedMcpServerIDInAllProjects(
        LEGACY_NODE_REPL_SERVER_ID,
        definition.serverID,
      )
      await Config.removeMcpServer(
        Config.GLOBAL_CONFIG_ID,
        LEGACY_NODE_REPL_SERVER_ID,
      )
    }
  }

  const retiredComputerUse = await Config.getMcpServer(
    Config.GLOBAL_CONFIG_ID,
    RETIRED_COMPUTER_USE_SERVER_ID,
  )
  if (
    retiredComputerUse?.owner?.kind === "anybox"
    && retiredComputerUse.owner.bindingID === RETIRED_COMPUTER_USE_BINDING_ID
  ) {
    await Config.removeSelectedMcpServerIDFromAllProjects(RETIRED_COMPUTER_USE_SERVER_ID)
    await Config.removeMcpServer(Config.GLOBAL_CONFIG_ID, RETIRED_COMPUTER_USE_SERVER_ID)
    log.info("removed retired built-in MCP binding", {
      serverID: RETIRED_COMPUTER_USE_SERVER_ID,
    })
  }
}
