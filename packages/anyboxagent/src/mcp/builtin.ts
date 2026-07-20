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
const COMPUTER_USE_TOOL_NAMES = [
  "computer_health_check",
  "list_apps",
  "list_windows",
  "get_window",
  "get_window_state",
  "launch_app",
  "activate_window",
  "click",
  "scroll",
  "press_key",
  "type_text",
  "set_value",
  "perform_secondary_action",
  "drag",
] as const

export const NODE_REPL_DEFINITION_ID = "node-repl"
export const NODE_REPL_SERVER_ID = "anybox.node-repl"
export const COMPUTER_USE_DEFINITION_ID = "computer-use"
export const COMPUTER_USE_SERVER_ID = "anybox.computer-use"
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
  modelExposure?: "tools" | "plugin-capability"
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

function computerUseRuntimePaths() {
  const packagedFacade = resolve(bundledRuntimeRoot(), "mcp", "computer-use", "server.js")
  const packagedHelper = resolve(
    bundledRuntimeRoot(),
    "computer-use",
    "win32-x64",
    "computer-use-helper.exe",
  )
  const sourceRoot = packageRootFromAnyboxAgentRoot(
    "..",
    "..",
    "plugins",
    "Anybox-Plugins",
    "computer-use-windows",
  )
  return {
    facade: existsSync(packagedFacade)
      ? packagedFacade
      : resolve(sourceRoot, "scripts", "server.js"),
    helper: existsSync(packagedHelper)
      ? packagedHelper
      : resolve(sourceRoot, "helper", "win32-x64", "computer-use-helper.exe"),
  }
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

function computerUseDefinition(): BuiltinMcpDefinition {
  const paths = computerUseRuntimePaths()
  const readOnly = new Set([
    "computer_health_check",
    "list_apps",
    "list_windows",
    "get_window",
    "get_window_state",
  ])
  const titles: Record<string, string> = {
    computer_health_check: "Computer Use Health Check",
    list_apps: "List Apps",
    list_windows: "List Windows",
    get_window: "Get Window",
    get_window_state: "Get Window State",
    launch_app: "Launch App",
    activate_window: "Activate Window",
    click: "Click",
    scroll: "Scroll",
    press_key: "Press Key",
    type_text: "Type Text",
    drag: "Drag",
    set_value: "Set Value",
    perform_secondary_action: "Perform Secondary Action",
  }
  return {
    id: COMPUTER_USE_DEFINITION_ID,
    serverID: COMPUTER_USE_SERVER_ID,
    name: "Computer Use",
    description: "Observe and control approved Windows application windows through the Anybox host broker.",
    publisher: "Anybox",
    icon: "CU",
    risk: "high",
    permissions: [
      "Lists visible Windows applications and windows.",
      "Captures selected window screenshots and bounded accessibility content.",
      "Sends mouse and keyboard input only through the host-owned Windows helper.",
      "Requires a per-application once, session, or persistent approval before control.",
    ],
    tools: COMPUTER_USE_TOOL_NAMES.map((name) => ({
      name,
      title: titles[name],
      description: titles[name] ?? name,
      readOnly: readOnly.has(name),
      destructive: false,
    })),
    modelExposure: "plugin-capability",
    installReview: [
      "The broker and native helper belong to Anybox, not to the requesting plugin.",
      "Only one active agent turn can hold the global desktop-control lease.",
      "Physical Escape interrupts the active Computer Use lease.",
    ],
    available:
      process.platform === "win32"
      && existsSync(paths.facade)
      && existsSync(paths.helper),
    runtime: {
      name: "Computer Use",
      transport: "stdio",
      command: "__anybox_in_process__",
      args: [],
      toolPolicies: Object.fromEntries(
        COMPUTER_USE_TOOL_NAMES.map((name) => [
          name,
          { policy: readOnly.has(name) ? "auto" : "ask" },
        ]),
      ),
      enabled: true,
      timeoutMs: 120_000,
    },
  }
}

export function listDefinitions(): BuiltinMcpDefinition[] {
  return [nodeReplDefinition(), computerUseDefinition()]
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

export function isComputerUseServer(server: Config.McpServerSummary) {
  return (
    server.id === COMPUTER_USE_SERVER_ID
    && server.owner?.kind === "anybox"
    && server.owner.bindingID === COMPUTER_USE_DEFINITION_ID
  )
}

export function isModelToolServer(server: Config.McpServerSummary) {
  if (server.owner?.kind !== "anybox") return true
  const definition = getDefinition(server.owner.bindingID)
  if (!definition || definition.serverID !== server.id) return true
  return definition.modelExposure !== "plugin-capability"
}

export function getPluginCapabilityDefinition(capabilityID: string) {
  const definition = getDefinition(capabilityID)
  return definition?.modelExposure === "plugin-capability" ? definition : undefined
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

  const computerUse = computerUseDefinition()
  const existingComputerUse = await Config.getMcpServer(
    Config.GLOBAL_CONFIG_ID,
    computerUse.serverID,
  )
  if (
    existingComputerUse?.owner
    && !(
      existingComputerUse.owner.kind === "anybox"
      && existingComputerUse.owner.bindingID === COMPUTER_USE_DEFINITION_ID
    )
  ) {
    log.warn("built-in Computer Use MCP binding id is owned by another source", {
      serverID: computerUse.serverID,
      owner: existingComputerUse.owner,
    })
    return
  }
  await Config.setManagedMcpServer(
    Config.GLOBAL_CONFIG_ID,
    computerUse.serverID,
    {
      ...computerUse.runtime,
      enabled: existingComputerUse?.enabled ?? computerUse.runtime.enabled,
      toolPolicies:
        existingComputerUse?.toolPolicies ?? computerUse.runtime.toolPolicies,
    },
    {
      kind: "anybox",
      bindingID: computerUse.id,
    },
  )
}
