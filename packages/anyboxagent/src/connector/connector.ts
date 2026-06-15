import { existsSync, readFileSync } from "node:fs"
import { delimiter, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import z from "zod"
import * as Auth from "#auth/auth.ts"
import { getBrowserTrustedCommandToken } from "#browser-extension/runtime-token.ts"
import * as ProviderAuth from "#auth/provider-auth.ts"
import * as Config from "#config/config.ts"
import * as Mcp from "#mcp/manager.ts"
import { getProcessEnvValue } from "#env/compat.ts"

const API_KEY_METHOD = "api-key"
const CONNECTOR_PREFIX = "connector:"
const PLUGIN_CONNECTOR_PREFIX = "plugin-connector:"
const LEGACY_PLUGIN_APP_CONNECTOR_PREFIX = "plugin-app:"
const CONNECTOR_REGISTRY_FILES_ENV = "ANYBOX_CONNECTOR_REGISTRY_FILES"
const CONNECTOR_BUILD_CONFIG_ENV = "ANYBOX_CONNECTOR_BUILD_CONFIG"
const GMAIL_OAUTH_CLIENT_ID_ENV = "ANYBOX_GMAIL_OAUTH_CLIENT_ID"
const GMAIL_OAUTH_CLIENT_SECRET_ENV = "ANYBOX_GMAIL_OAUTH_CLIENT_SECRET"
const LEGACY_GMAIL_OAUTH_CLIENT_ID_ENV = "GOOGLE_OAUTH_CLIENT_ID"
const LEGACY_GMAIL_OAUTH_CLIENT_SECRET_ENV = "GOOGLE_OAUTH_CLIENT_SECRET"
const BUILTIN_GMAIL_PACKAGE_PATH = ["plugins", "builtin", "gmail", "0.1.0"] as const
const BUILTIN_FEISHU_PACKAGE_PATH = ["plugins", "builtin", "feishu", "0.1.0"] as const
const BUILD_CONNECTOR_CONFIG_PATH = ["config", "connectors.json"] as const
const BUILD_BROWSER_CONNECTOR_PATH = ["connectors", "browser"] as const
const SOURCE_BROWSER_CONNECTOR_PATH = ["connectors", "browser"] as const
const BUILD_NODE_REPL_CONNECTOR_PATH = ["connectors", "node-repl"] as const
const SOURCE_NODE_REPL_CONNECTOR_PATH = ["connectors", "node-repl"] as const
const BUILD_GMAIL_CONNECTOR_PATH = ["connectors", "gmail"] as const
const BUILD_FEISHU_CONNECTOR_PATH = ["connectors", "feishu"] as const
const CONNECTOR_CUSTOM_OAUTH_CLIENT_KEY = "custom-oauth-client"

export type ResolvedConnectorRuntime =
  | {
      transport: "stdio"
      command: string
      args?: string[]
      cwd?: string
      env?: Record<string, string>
    }
  | {
      transport: "remote"
      serverUrl: string
      authorization?: string
      headers?: Record<string, string>
    }

export const ConnectorToolPreview = z
  .object({
    name: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string(),
    readOnly: z.boolean().optional(),
    destructive: z.boolean().optional(),
  })
  .strict()
export type ConnectorToolPreview = z.infer<typeof ConnectorToolPreview>

export const ConnectorApiKeyCredential = z
  .object({
    kind: z.literal("api_key"),
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(["text", "password"]).optional(),
    required: z.boolean().optional(),
    secret: z.boolean().optional(),
    placeholder: z.string().optional(),
    description: z.string().optional(),
  })
  .strict()
export type ConnectorApiKeyCredential = z.infer<typeof ConnectorApiKeyCredential>

export type ConnectorOAuthTokenPlacement =
  | {
      type: "authorization_bearer"
    }
  | {
      type: "header"
      name: string
      value?: string
    }

export const ConnectorOAuthTokenPlacement = z.union([
  z.object({ type: z.literal("authorization_bearer") }).strict(),
  z
    .object({
      type: z.literal("header"),
      name: z.string().min(1),
      value: z.string().min(1).optional(),
    })
    .strict(),
])

export const ConnectorOAuthCredential = z
  .object({
    kind: z.literal("oauth"),
    label: z.string().min(1),
    clientID: z.string().min(1).optional(),
    clientIDConfigKey: z.string().min(1).optional(),
    clientSecretConfigKey: z.string().min(1).optional(),
    authorizationURL: z.string().min(1),
    tokenURL: z.string().min(1),
    scopes: z.array(z.string().min(1)),
    revocationURL: z.string().min(1).optional(),
    tokenPlacement: ConnectorOAuthTokenPlacement.optional(),
    authorizationParams: z.record(z.string(), z.string()).optional(),
    tokenParams: z.record(z.string(), z.string()).optional(),
    tokenEndpointAuthMethod: z.enum(["none", "client_secret_post", "client_secret_basic"]).optional(),
    tokenRequestFormat: z.enum(["form", "json"]).optional(),
    description: z.string().optional(),
  })
  .strict()
export type ConnectorOAuthCredential = z.infer<typeof ConnectorOAuthCredential>

export const ConnectorCredential = z.union([ConnectorApiKeyCredential, ConnectorOAuthCredential])
export type ConnectorCredential = z.infer<typeof ConnectorCredential>

export const ConnectorConfigField = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(["text", "password", "url", "path"]).optional(),
    required: z.boolean().optional(),
    secret: z.boolean().optional(),
    placeholder: z.string().optional(),
    defaultValue: z.string().optional(),
    description: z.string().optional(),
  })
  .strict()
export type ConnectorConfigField = z.infer<typeof ConnectorConfigField>

const ConnectorRuntimeBase = {
  serverDescription: z.string().min(1).optional(),
  allowedTools: Config.McpAllowedTools,
  toolPolicies: Config.McpToolPolicies,
  requireApproval: Config.McpRequireApproval,
  timeoutMs: z.number().int().positive().optional(),
} as const

export const ConnectorStdioRuntime = z
  .object({
    ...ConnectorRuntimeBase,
    transport: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().min(1).optional(),
  })
  .strict()
export type ConnectorStdioRuntime = z.infer<typeof ConnectorStdioRuntime>

export const ConnectorRemoteRuntime = z
  .object({
    ...ConnectorRuntimeBase,
    transport: z.literal("remote"),
    provider: Config.McpRemoteProvider.optional(),
    serverUrl: z.string().min(1).optional(),
    authorization: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict()
export type ConnectorRemoteRuntime = z.infer<typeof ConnectorRemoteRuntime>

export const ConnectorRuntime = z.union([ConnectorStdioRuntime, ConnectorRemoteRuntime])
export type ConnectorRuntime = z.infer<typeof ConnectorRuntime>

export const ConnectorDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    publisher: z.string().min(1).default("Anybox"),
    icon: z.string().optional(),
    risk: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    permissions: z.array(z.string()).default([]),
    tools: z.array(ConnectorToolPreview).default([]),
    configFields: z.array(ConnectorConfigField).default([]),
    oauthCallbackURL: z.string().min(1).optional(),
    credential: ConnectorCredential.optional(),
    runtime: ConnectorRuntime.optional(),
    installReview: z.array(z.string()).default([]),
    source: z.enum(["platform", "registry"]).default("platform"),
    available: z.boolean().default(true),
  })
  .strict()
export type ConnectorDefinition = z.infer<typeof ConnectorDefinition>

export const ConnectorRequirement = z
  .object({
    connector: z.string().min(1),
    tools: z.array(z.string().min(1)).optional(),
    permissions: z.array(z.string().min(1)).optional(),
    required: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .strict()
export type ConnectorRequirement = z.infer<typeof ConnectorRequirement>

const ConnectorRegistryFile = z
  .object({
    schemaVersion: z.literal(1).optional(),
    connectors: z.array(ConnectorDefinition),
  })
  .strict()

const ConnectorBuildConfig = z
  .object({
    schemaVersion: z.literal(1).optional(),
    gmailOAuthClientID: z.string().min(1).optional(),
    gmailOAuthClientSecret: z.string().min(1).optional(),
  })
  .strict()
type ConnectorBuildConfig = z.infer<typeof ConnectorBuildConfig>

const ConnectorDiagnosticTool = z
  .object({
    name: z.string().min(1),
    title: z.string().min(1).optional(),
    displayName: z.string().min(1),
    description: z.string().optional(),
    inputSchema: z.unknown().optional(),
    annotations: z.record(z.string(), z.unknown()).optional(),
    riskHint: z.enum(["read-only", "destructive", "open-world", "unknown"]),
    recommendedPolicy: Config.McpToolPolicyValue,
    configuredPolicy: Config.McpToolPolicyValue.optional(),
  })
  .strict()

const ConnectorDiagnostic = z
  .object({
    serverID: z.string(),
    enabled: z.boolean(),
    ok: z.boolean(),
    toolCount: z.number(),
    toolNames: z.array(z.string()),
    tools: z.array(ConnectorDiagnosticTool),
    error: z.string().optional(),
  })
  .strict()
type ConnectorDiagnostic = z.infer<typeof ConnectorDiagnostic>

export const ConnectorStatus = z
  .object({
    connectorID: z.string().min(1),
    definitionID: z.string().min(1),
    name: z.string().min(1),
    connected: z.boolean(),
    available: z.boolean(),
    configured: z.boolean().optional(),
    configurationLabel: z.string().optional(),
    authStatus: z.enum(["connected", "not_connected", "pending", "expired", "error", "unavailable"]),
    credentialKind: z.enum(["api_key", "oauth"]).optional(),
    credentialLabel: z.string().optional(),
    account: ProviderAuth.ProviderAuthAccountSummary.optional(),
    email: z.string().optional(),
    expiresAt: z.number().optional(),
    activeFlow: ProviderAuth.ProviderAuthFlow.optional(),
    generatedMcpServerID: z.string().min(1).optional(),
    lastDiagnostic: ConnectorDiagnostic.optional(),
  })
  .strict()
export type ConnectorStatus = z.infer<typeof ConnectorStatus>

export const SaveConnectorApiKeyInput = z
  .object({
    apiKey: z.string().nullable().optional(),
  })
  .strict()
export type SaveConnectorApiKeyInput = z.infer<typeof SaveConnectorApiKeyInput>

export const SaveConnectorConfigInput = z
  .object({
    config: z.record(z.string(), z.string().nullable().optional()).default({}),
  })
  .strict()
export type SaveConnectorConfigInput = z.infer<typeof SaveConnectorConfigInput>

export class ConnectorError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "ConnectorError"
  }
}

function normalizeConnectorDefinitionID(id: string) {
  return id.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
}

export function connectorIDForDefinition(definitionID: string, instanceID = "default") {
  const normalizedDefinitionID = normalizeConnectorDefinitionID(definitionID)
  const normalizedInstanceID = instanceID.trim() || "default"
  return `${CONNECTOR_PREFIX}${normalizedDefinitionID}:${normalizedInstanceID}`
}

export function mcpServerIDForConnector(definitionID: string, instanceID = "default") {
  return `connector.${normalizeConnectorDefinitionID(definitionID)}.${instanceID.trim() || "default"}`
}

function parseConnectorID(connectorID: string) {
  if (!connectorID.startsWith(CONNECTOR_PREFIX)) return undefined
  const rest = connectorID.slice(CONNECTOR_PREFIX.length)
  const separator = rest.indexOf(":")
  if (separator <= 0 || separator === rest.length - 1) return undefined

  return {
    definitionID: rest.slice(0, separator),
    instanceID: rest.slice(separator + 1),
  }
}

export function mcpServerIDForConnectorID(connectorID: string) {
  const parsed = parseConnectorID(connectorID)
  return parsed ? mcpServerIDForConnector(parsed.definitionID, parsed.instanceID) : undefined
}

function registryFilePaths() {
  return (getProcessEnvValue(CONNECTOR_REGISTRY_FILES_ENV) ?? "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function readConnectorRegistryFile(path: string): ConnectorDefinition[] {
  if (!existsSync(path)) return []

  try {
    const raw = readFileSync(path, "utf8")
    const parsedJSON = JSON.parse(raw) as unknown
    const parsed = Array.isArray(parsedJSON)
      ? z.array(ConnectorDefinition).parse(parsedJSON)
      : ConnectorRegistryFile.parse(parsedJSON).connectors

    return parsed.map((definition) => ConnectorDefinition.parse({
      ...definition,
      id: normalizeConnectorDefinitionID(definition.id),
      source: definition.source === "platform" ? "registry" : definition.source,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ConnectorError("CONNECTOR_REGISTRY_INVALID", `Connector registry '${path}' is invalid: ${message}`)
  }
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

function buildConnectorConfigPath() {
  const configured = getProcessEnvValue(CONNECTOR_BUILD_CONFIG_ENV)?.trim()
  return configured || resolve(bundledRuntimeRoot(), ...BUILD_CONNECTOR_CONFIG_PATH)
}

function readConnectorBuildConfig(): ConnectorBuildConfig {
  const configPath = buildConnectorConfigPath()
  if (!existsSync(configPath)) return {}

  try {
    const raw = readFileSync(configPath, "utf8")
    return ConnectorBuildConfig.parse(JSON.parse(raw))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ConnectorError("CONNECTOR_REGISTRY_INVALID", `Connector build config '${configPath}' is invalid: ${message}`)
  }
}

function builtinGmailPackageRoot() {
  return packageRootFromAnyboxAgentRoot(...BUILTIN_GMAIL_PACKAGE_PATH)
}

function builtinFeishuPackageRoot() {
  return packageRootFromAnyboxAgentRoot(...BUILTIN_FEISHU_PACKAGE_PATH)
}

function builtinBrowserConnectorRoot() {
  const packagedRoot = resolve(bundledRuntimeRoot(), ...BUILD_BROWSER_CONNECTOR_PATH)
  return existsSync(packagedRoot) ? packagedRoot : packageRootFromAnyboxAgentRoot(...SOURCE_BROWSER_CONNECTOR_PATH)
}

function builtinNodeReplConnectorRoot() {
  const packagedRoot = resolve(bundledRuntimeRoot(), ...BUILD_NODE_REPL_CONNECTOR_PATH)
  return existsSync(packagedRoot) ? packagedRoot : packageRootFromAnyboxAgentRoot(...SOURCE_NODE_REPL_CONNECTOR_PATH)
}

function builtinGmailConnectorRoot() {
  const packagedRoot = resolve(bundledRuntimeRoot(), ...BUILD_GMAIL_CONNECTOR_PATH)
  return existsSync(packagedRoot) ? packagedRoot : resolve(builtinGmailPackageRoot(), "connectors", "gmail")
}

function builtinFeishuConnectorRoot() {
  const packagedRoot = resolve(bundledRuntimeRoot(), ...BUILD_FEISHU_CONNECTOR_PATH)
  return existsSync(packagedRoot) ? packagedRoot : resolve(builtinFeishuPackageRoot(), "connectors", "feishu")
}

function builtinGmailOAuthClientID() {
  const buildConfig = readConnectorBuildConfig()
  return getProcessEnvValue(GMAIL_OAUTH_CLIENT_ID_ENV)?.trim() ||
    getProcessEnvValue(LEGACY_GMAIL_OAUTH_CLIENT_ID_ENV)?.trim() ||
    buildConfig.gmailOAuthClientID?.trim() ||
    "anybox-gmail-oauth-client-id-unconfigured"
}

function builtinGmailOAuthClientSecret() {
  const buildConfig = readConnectorBuildConfig()
  return getProcessEnvValue(GMAIL_OAUTH_CLIENT_SECRET_ENV)?.trim() ||
    getProcessEnvValue(LEGACY_GMAIL_OAUTH_CLIENT_SECRET_ENV)?.trim() ||
    buildConfig.gmailOAuthClientSecret?.trim()
}

function localAgentBaseURL() {
  const host = getProcessEnvValue("ANYBOX_SERVER_HOST")?.trim() || "127.0.0.1"
  const port = getProcessEnvValue("ANYBOX_SERVER_PORT")?.trim() || "4096"
  return `http://${host}:${port}`
}

function builtinDefinitions(): ConnectorDefinition[] {
  const browserConnectorRoot = builtinBrowserConnectorRoot()
  const browserServerPath = resolve(browserConnectorRoot, "server.js")
  const browserRuntimeAvailable = existsSync(browserServerPath)
  const nodeReplConnectorRoot = builtinNodeReplConnectorRoot()
  const nodeReplServerPath = resolve(nodeReplConnectorRoot, "server.js")
  const nodeReplRuntimeAvailable = existsSync(nodeReplServerPath)
  const gmailConnectorRoot = builtinGmailConnectorRoot()
  const gmailServerPath = resolve(gmailConnectorRoot, "server.js")
  const gmailClientID = builtinGmailOAuthClientID()
  const gmailClientSecret = builtinGmailOAuthClientSecret()
  const gmailConfigured = gmailClientID !== "anybox-gmail-oauth-client-id-unconfigured"
  const gmailRuntimeAvailable = existsSync(gmailServerPath)
  const feishuConnectorRoot = builtinFeishuConnectorRoot()
  const feishuServerPath = resolve(feishuConnectorRoot, "server.js")
  const feishuRuntimeAvailable = existsSync(feishuServerPath)

  return [
    ConnectorDefinition.parse({
      id: "browser",
      name: "Browser",
      description: "Control Chrome through the Anybox browser extension.",
      publisher: "Anybox",
      icon: "BR",
      risk: "high",
      permissions: [
        "Reads Chrome tab titles, URLs, visible page text, DOM trees, accessibility trees, interactive elements, and screenshots.",
        "Opens, activates, clicks, scrolls, types into, and fills Chrome tabs through the Anybox browser extension.",
        "Requires the Anybox browser extension to be installed, enabled, and connected.",
      ],
      tools: [
        {
          name: "browser_status",
          title: "Browser Status",
          description: "Check whether the Anybox browser extension is connected.",
          readOnly: true,
        },
        {
          name: "browser_get_tabs",
          title: "Get Browser Tabs",
          description: "List Chrome tabs visible to the Anybox browser extension.",
          readOnly: true,
        },
        {
          name: "browser_open_tab",
          title: "Open Browser Tab",
          description: "Open a URL in Chrome.",
          readOnly: false,
        },
        {
          name: "browser_activate_tab",
          title: "Activate Browser Tab",
          description: "Activate an existing Chrome tab.",
          readOnly: false,
        },
        {
          name: "browser_snapshot",
          title: "Browser Snapshot",
          description: "Read page title, URL, visible text, links, buttons, and inputs.",
          readOnly: true,
        },
        {
          name: "browser_interactive_snapshot",
          title: "Browser Interactive Snapshot",
          description: "List visible clickable and fillable page elements with stable element IDs.",
          readOnly: true,
        },
        {
          name: "browser_dom_tree",
          title: "Browser DOM Tree",
          description: "Read a compact DOM tree for a Chrome page.",
          readOnly: true,
        },
        {
          name: "browser_accessibility_tree",
          title: "Browser Accessibility Tree",
          description: "Read Chrome's accessibility tree for a page.",
          readOnly: true,
        },
        {
          name: "browser_screenshot",
          title: "Browser Screenshot",
          description: "Capture a PNG screenshot of a Chrome tab.",
          readOnly: true,
        },
        {
          name: "browser_click",
          title: "Browser Click",
          description: "Click viewport coordinates in a Chrome tab.",
          readOnly: false,
        },
        {
          name: "browser_click_element",
          title: "Browser Click Element",
          description: "Click an element returned by browser_interactive_snapshot.",
          readOnly: false,
        },
        {
          name: "browser_fill",
          title: "Browser Fill",
          description: "Fill an input-like element returned by browser_interactive_snapshot.",
          readOnly: false,
        },
        {
          name: "browser_type",
          title: "Browser Type",
          description: "Insert text into the focused element in a Chrome tab.",
          readOnly: false,
        },
        {
          name: "browser_scroll",
          title: "Browser Scroll",
          description: "Scroll a Chrome tab by a viewport delta.",
          readOnly: false,
        },
        {
          name: "browser_wait_for",
          title: "Browser Wait For",
          description: "Wait until a Chrome page reaches a URL, text, selector, or element condition.",
          readOnly: true,
        },
        {
          name: "browser_release_tab",
          title: "Browser Release Tab",
          description: "Release a Chrome tab from session ownership without closing it.",
          readOnly: false,
        },
      ],
      runtime: {
        transport: "stdio",
        command: "node",
        args: [browserServerPath],
        cwd: browserConnectorRoot,
        env: {
          ANYBOX_AGENT_BASE_URL: localAgentBaseURL(),
        },
        timeoutMs: 30_000,
        toolPolicies: {
          browser_status: { policy: "auto" },
          browser_get_tabs: { policy: "auto" },
          browser_snapshot: { policy: "auto" },
          browser_interactive_snapshot: { policy: "auto" },
          browser_dom_tree: { policy: "auto" },
          browser_accessibility_tree: { policy: "auto" },
          browser_screenshot: { policy: "auto" },
          browser_wait_for: { policy: "auto" },
          browser_open_tab: { policy: "ask" },
          browser_activate_tab: { policy: "ask" },
          browser_click: { policy: "ask" },
          browser_click_element: { policy: "ask" },
          browser_fill: { policy: "ask" },
          browser_type: { policy: "ask" },
          browser_scroll: { policy: "ask" },
          browser_release_tab: { policy: "ask" },
        },
      },
      installReview: [
        "Runs a local Node.js MCP wrapper bundled with Anybox.",
        "Requires the Anybox browser extension to be connected before browser commands can run.",
        "Interactive page actions are configured to ask before execution.",
      ],
      source: "platform",
      available: browserRuntimeAvailable,
    }),
    ConnectorDefinition.parse({
      id: "node-repl",
      name: "Node REPL",
      description: "Run JavaScript in a persistent local Node.js REPL with optional Browser runtime helpers.",
      publisher: "Anybox",
      icon: "JS",
      risk: "high",
      permissions: [
        "Starts a local Node.js MCP wrapper bundled with Anybox.",
        "Runs JavaScript code requested by the agent in a persistent process.",
        "When used with the Browser plugin, can execute raw JavaScript and CDP commands in Chrome tabs.",
      ],
      tools: [
        {
          name: "node_repl_js",
          title: "Node REPL JavaScript",
          description: "Run JavaScript in a persistent Node.js REPL.",
          readOnly: false,
        },
        {
          name: "node_repl_reset",
          title: "Reset Node REPL",
          description: "Reset the persistent Node.js REPL state.",
          readOnly: false,
        },
        {
          name: "node_repl_add_node_module_dir",
          title: "Add Node Module Directory",
          description: "Add a node_modules directory to CommonJS module resolution.",
          readOnly: false,
        },
      ],
      runtime: {
        transport: "stdio",
        command: "node",
        args: [nodeReplServerPath],
        cwd: nodeReplConnectorRoot,
        env: {
          ANYBOX_AGENT_BASE_URL: localAgentBaseURL(),
          ANYBOX_BROWSER_TRUSTED_TOKEN: getBrowserTrustedCommandToken(),
        },
        timeoutMs: 120_000,
        toolPolicies: {
          node_repl_reset: { policy: "auto" },
          node_repl_add_node_module_dir: { policy: "ask" },
          node_repl_js: { policy: "ask" },
        },
      },
      installReview: [
        "Runs a persistent local JavaScript process.",
        "Browser raw page script and CDP access require this connector and the Browser plugin to be selected.",
      ],
      source: "platform",
      available: nodeReplRuntimeAvailable,
    }),
    ConnectorDefinition.parse({
      id: "gmail",
      name: "Gmail",
      description: "Connect Gmail with Google OAuth and expose read-only mail tools.",
      publisher: "Anybox",
      icon: "GM",
      risk: "medium",
      permissions: [
        "Starts a bundled local Gmail MCP wrapper.",
        "Requests read-only Gmail access from Google.",
        "Sends Gmail API requests to gmail.googleapis.com.",
      ],
      tools: [
        {
          name: "gmail_profile",
          title: "Gmail Profile",
          description: "Read the connected Gmail profile summary.",
          readOnly: true,
        },
        {
          name: "gmail_search_messages",
          title: "Search Gmail",
          description: "Search Gmail messages with Gmail search syntax.",
          readOnly: true,
        },
        {
          name: "gmail_read_message",
          title: "Read Gmail Message",
          description: "Read headers and snippet for a Gmail message.",
          readOnly: true,
        },
      ],
      credential: {
        kind: "oauth",
        label: "Google Gmail",
        clientID: gmailClientID,
        authorizationURL: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenURL: "https://oauth2.googleapis.com/token",
        revocationURL: "https://oauth2.googleapis.com/revoke",
        scopes: [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/gmail.readonly",
        ],
        authorizationParams: {
          access_type: "offline",
          prompt: "consent",
        },
        tokenEndpointAuthMethod: gmailClientSecret ? "client_secret_post" : "none",
        tokenPlacement: {
          type: "authorization_bearer",
        },
      },
      runtime: {
        transport: "stdio",
        command: "node",
        args: [gmailServerPath],
        cwd: gmailConnectorRoot,
        env: {
          GMAIL_ACCESS_TOKEN: "${OAUTH_ACCESS_TOKEN}",
          GMAIL_TOKEN_TYPE: "${OAUTH_TOKEN_TYPE}",
        },
        timeoutMs: 10000,
      },
      installReview: [
        "OAuth client metadata is managed by Anybox.",
        "Uses the read-only Gmail API scope.",
        "Runs a local stdio MCP wrapper bundled with Anybox.",
      ],
      source: "platform",
      available: gmailConfigured && gmailRuntimeAvailable,
    }),
    ConnectorDefinition.parse({
      id: "feishu",
      name: "Feishu",
      description: "Connect a Feishu custom app and expose user-authorized document tools.",
      publisher: "Anybox",
      icon: "FS",
      risk: "medium",
      permissions: [
        "Stores Feishu custom app metadata locally on this device.",
        "Requests user-authorized Feishu access with the scopes enabled on the custom app.",
        "Sends Feishu OpenAPI requests to open.feishu.cn.",
      ],
      tools: [
        {
          name: "feishu_profile",
          title: "Feishu Profile",
          description: "Read the connected Feishu user profile.",
          readOnly: true,
        },
        {
          name: "feishu_search_files",
          title: "Search Feishu Files",
          description: "Search Feishu Drive files visible to the connected account.",
          readOnly: true,
        },
        {
          name: "feishu_get_file_metadata",
          title: "Get Feishu File Metadata",
          description: "Fetch metadata for Feishu Drive documents by token and document type.",
          readOnly: true,
        },
        {
          name: "feishu_read_docx_raw",
          title: "Read Feishu Doc",
          description: "Read plain text content from a Feishu Docx document.",
          readOnly: true,
        },
        {
          name: "feishu_list_docx_blocks",
          title: "List Feishu Doc Blocks",
          description: "List structured blocks from a Feishu Docx document.",
          readOnly: true,
        },
        {
          name: "feishu_list_wiki_spaces",
          title: "List Feishu Wiki Spaces",
          description: "List Feishu Wiki spaces visible to the connected account.",
          readOnly: true,
        },
        {
          name: "feishu_get_wiki_node",
          title: "Get Feishu Wiki Node",
          description: "Resolve and read metadata for a Feishu Wiki node.",
          readOnly: true,
        },
        {
          name: "feishu_list_wiki_nodes",
          title: "List Feishu Wiki Nodes",
          description: "List child nodes in a Feishu Wiki space.",
          readOnly: true,
        },
        {
          name: "feishu_read_sheet_values",
          title: "Read Feishu Sheet Values",
          description: "Read cell values from a Feishu spreadsheet range.",
          readOnly: true,
        },
        {
          name: "feishu_list_bitable_records",
          title: "List Feishu Bitable Records",
          description: "List records from a Feishu Bitable table.",
          readOnly: true,
        },
      ],
      configFields: [
        {
          key: "FEISHU_APP_ID",
          label: "Feishu App ID",
          type: "text",
          required: true,
          placeholder: "cli_xxxxxxxxxxxxxxxx",
          description: "App ID from the Feishu Open Platform custom app.",
        },
        {
          key: "FEISHU_APP_SECRET",
          label: "Feishu App Secret",
          type: "password",
          required: true,
          secret: true,
          placeholder: "Enter app secret",
          description: "App Secret from the same Feishu custom app. It is stored only on this device.",
        },
      ],
      oauthCallbackURL: ProviderAuth.getLocalBrowserCallbackURL(),
      credential: {
        kind: "oauth",
        label: "Feishu Custom App",
        clientIDConfigKey: "FEISHU_APP_ID",
        clientSecretConfigKey: "FEISHU_APP_SECRET",
        authorizationURL: "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
        tokenURL: "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
        scopes: [
          "offline_access",
          "auth:user.id:read",
          "drive:drive.search:readonly",
          "drive:drive.metadata:readonly",
          "drive:drive:readonly",
          "drive:file:readonly",
          "docx:document:readonly",
          "wiki:wiki:readonly",
          "sheets:spreadsheet:readonly",
          "bitable:app:readonly",
        ],
        tokenEndpointAuthMethod: "client_secret_post",
        tokenRequestFormat: "json",
        tokenPlacement: {
          type: "authorization_bearer",
        },
      },
      runtime: {
        transport: "stdio",
        command: "node",
        args: [feishuServerPath],
        cwd: feishuConnectorRoot,
        env: {
          FEISHU_ACCESS_TOKEN: "${OAUTH_ACCESS_TOKEN}",
          FEISHU_TOKEN_TYPE: "${OAUTH_TOKEN_TYPE}",
          FEISHU_GRANTED_SCOPES: "${OAUTH_SCOPES}",
        },
        timeoutMs: 10000,
      },
      installReview: [
        "Create a Feishu Open Platform custom app and copy its App ID and App Secret here.",
        "Add the local callback URL shown by Anybox to the app security settings when connecting.",
        "Enable the required Drive and Docx scopes on the Feishu app before authorizing.",
      ],
      source: "platform",
      available: feishuRuntimeAvailable,
    }),
  ]
}

export function listDefinitions(): ConnectorDefinition[] {
  const byID = new Map<string, ConnectorDefinition>()
  for (const definition of builtinDefinitions()) {
    byID.set(definition.id, definition)
  }

  for (const path of registryFilePaths()) {
    for (const definition of readConnectorRegistryFile(path)) {
      byID.set(definition.id, definition)
    }
  }

  return [...byID.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function getDefinition(definitionID: string) {
  const normalizedDefinitionID = normalizeConnectorDefinitionID(definitionID)
  return listDefinitions().find((definition) => definition.id === normalizedDefinitionID)
}

function assertDefinition(definitionID: string) {
  const definition = getDefinition(definitionID)
  if (!definition) {
    throw new ConnectorError("CONNECTOR_NOT_FOUND", `Connector '${definitionID}' was not found.`)
  }
  return definition
}

function assertDefinitionForConnectorID(connectorID: string) {
  const parsed = parseConnectorID(connectorID)
  if (!parsed) {
    throw new ConnectorError("CONNECTOR_NOT_FOUND", `Connector '${connectorID}' is not a platform connector.`)
  }
  return {
    parsed,
    definition: assertDefinition(parsed.definitionID),
  }
}

function assertApiKeyCredential(definition: ConnectorDefinition): ConnectorApiKeyCredential {
  if (definition.credential?.kind !== "api_key") {
    throw new ConnectorError("CONNECTOR_CREDENTIAL_UNSUPPORTED", `${definition.name} does not use API key authentication.`)
  }
  return definition.credential
}

function assertOAuthCredential(definition: ConnectorDefinition): ConnectorOAuthCredential {
  if (definition.credential?.kind !== "oauth") {
    throw new ConnectorError("CONNECTOR_CREDENTIAL_UNSUPPORTED", `${definition.name} does not use OAuth authentication.`)
  }
  return definition.credential
}

function maskedClientID(clientID: string) {
  if (clientID.length <= 12) return clientID
  return `${clientID.slice(0, 8)}...${clientID.slice(-4)}`
}

async function customOAuthClientRegistration(connectorID: string) {
  return await Auth.getOAuthClientRegistration(connectorID, CONNECTOR_CUSTOM_OAUTH_CLIENT_KEY)
}

async function oauthConfigForCredential(
  credential: ConnectorOAuthCredential,
  connectorID: string,
  definition?: ConnectorDefinition,
): Promise<ProviderAuth.GenericOAuthProviderConfig> {
  const managedClientSecret = definition?.id === "gmail" ? builtinGmailOAuthClientSecret() : undefined
  const customClient = credential.clientIDConfigKey ? await customOAuthClientRegistration(connectorID) : undefined
  const clientID = customClient?.clientID ?? credential.clientID
  const clientSecret = customClient?.clientSecret ?? managedClientSecret

  return {
    label: credential.label,
    clientID,
    clientSecret,
    authorizationURL: credential.authorizationURL,
    tokenURL: credential.tokenURL,
    scopes: credential.scopes,
    revocationURL: credential.revocationURL,
    authorizationParams: credential.authorizationParams,
    tokenParams: credential.tokenParams,
    tokenEndpointAuthMethod: clientSecret ? credential.tokenEndpointAuthMethod ?? "client_secret_post" : credential.tokenEndpointAuthMethod,
    tokenRequestFormat: credential.tokenRequestFormat,
  }
}

function oauthMethodForDefinition(_definition: ConnectorDefinition) {
  return "oauth"
}

function now() {
  return Date.now()
}

function accountSummary(credential: Auth.CredentialRecord | undefined) {
  if (credential?.kind !== "oauth_session") return undefined
  return {
    accountID: credential.accountID,
    userID: credential.userID,
    email: credential.email,
    planType: credential.planType,
    planLabel: credential.planLabel,
    subscription: credential.subscription,
    entitlements: credential.entitlements,
    workspaceID: credential.workspaceID,
    workspaceName: credential.workspaceName,
    balanceMicrocents: credential.balanceMicrocents,
    currency: credential.currency,
    rechargeUrl: credential.rechargeUrl,
    label: credential.email ?? credential.workspaceName ?? credential.planType,
  }
}

async function statusForDefinition(definition: ConnectorDefinition): Promise<ConnectorStatus> {
  const connectorID = connectorIDForDefinition(definition.id)
  const activeCredential = await Auth.getActiveProviderCredential(connectorID)
  const credential = activeCredential?.credential
  const record = await Auth.getProviderRecord(connectorID)
  const customClient = definition.credential?.kind === "oauth" && definition.credential.clientIDConfigKey
    ? await customOAuthClientRegistration(connectorID)
    : undefined
  const configured = definition.configFields.length === 0 || Boolean(customClient)
  const configurationLabel = customClient ? `App ID ${maskedClientID(customClient.clientID)}` : undefined
  const activeFlow = ProviderAuth.getLatestProviderAuthFlow(connectorID)
  const isPendingFlow = activeFlow && ["pending", "waiting_user", "authorizing"].includes(activeFlow.status)
  const connected = !definition.credential
    ? Boolean(definition.runtime && definition.available)
    : definition.credential.kind === "api_key"
      ? credential?.kind === "api_key"
      : credential?.kind === "oauth_session" && credential.expiresAt > now()

  const authStatus: ConnectorStatus["authStatus"] = !definition.available
    ? "unavailable"
    : isPendingFlow
      ? "pending"
      : connected
        ? "connected"
        : credential?.kind === "oauth_session" && credential.expiresAt <= now()
          ? "expired"
          : record?.lastError
            ? "error"
            : "not_connected"

  return {
    connectorID,
    definitionID: definition.id,
    name: definition.name,
    connected,
    available: definition.available,
    configured,
    configurationLabel,
    authStatus,
    credentialKind: definition.credential?.kind,
    credentialLabel: credential?.kind === "api_key"
      ? credential.label ?? definition.credential?.label
      : credential?.kind === "oauth_session"
        ? credential.email ?? definition.credential?.label
        : configurationLabel ?? undefined,
    account: accountSummary(credential),
    email: credential?.kind === "oauth_session" ? credential.email : undefined,
    expiresAt: credential?.kind === "oauth_session" ? credential.expiresAt : undefined,
    activeFlow,
    generatedMcpServerID: definition.runtime ? mcpServerIDForConnector(definition.id) : undefined,
  }
}

export async function listStatuses(): Promise<ConnectorStatus[]> {
  return Promise.all(listDefinitions().map((definition) => statusForDefinition(definition)))
}

export async function getStatus(connectorID: string): Promise<ConnectorStatus> {
  const { definition } = assertDefinitionForConnectorID(connectorID)
  return statusForDefinition(definition)
}

export async function saveConnectorApiKey(connectorID: string, input: SaveConnectorApiKeyInput) {
  const { definition } = assertDefinitionForConnectorID(connectorID)
  const credential = assertApiKeyCredential(definition)
  const apiKey = input.apiKey?.trim()

  if (!apiKey) {
    await Auth.clearProvider(connectorID)
  } else {
    await Auth.setProviderCredential(
      connectorID,
      API_KEY_METHOD,
      {
        kind: "api_key",
        apiKey,
        label: credential.label,
      },
      { activate: true, lastError: null },
    )
  }

  await syncConnectorRuntimeBinding(definition)
  return statusForDefinition(definition)
}

export async function removeConnectorApiKey(connectorID: string) {
  return saveConnectorApiKey(connectorID, { apiKey: null })
}

function readRequiredConfig(input: SaveConnectorConfigInput, key: string, label: string) {
  const value = input.config[key]
  const normalized = typeof value === "string" ? value.trim() : ""
  if (!normalized) {
    throw new ConnectorError("CONNECTOR_CONFIG_REQUIRED", `${label} is required.`)
  }
  return normalized
}

export async function saveConnectorConfig(connectorID: string, input: SaveConnectorConfigInput) {
  const { definition } = assertDefinitionForConnectorID(connectorID)
  const credential = definition.credential?.kind === "oauth" ? definition.credential : undefined
  if (!credential?.clientIDConfigKey || !credential.clientSecretConfigKey) {
    throw new ConnectorError("CONNECTOR_CONFIG_UNSUPPORTED", `${definition.name} does not use custom OAuth app configuration.`)
  }

  const clientIDField = definition.configFields.find((field) => field.key === credential.clientIDConfigKey)
  const clientSecretField = definition.configFields.find((field) => field.key === credential.clientSecretConfigKey)
  const clientID = readRequiredConfig(input, credential.clientIDConfigKey, clientIDField?.label ?? "OAuth client ID")
  const clientSecret = readRequiredConfig(input, credential.clientSecretConfigKey, clientSecretField?.label ?? "OAuth client secret")

  await Auth.setOAuthClientRegistration(connectorID, CONNECTOR_CUSTOM_OAUTH_CLIENT_KEY, {
    clientID,
    clientSecret,
    tokenEndpointAuthMethod: credential.tokenEndpointAuthMethod,
    redirectURIs: [],
    scope: credential.scopes.join(" "),
  })
  await Auth.setProviderLastError(connectorID, null)
  await syncConnectorRuntimeBinding(definition)
  return statusForDefinition(definition)
}

export async function removeConnectorConfig(connectorID: string) {
  const { definition } = assertDefinitionForConnectorID(connectorID)
  await Auth.removeProviderCredentials(connectorID, ({ credential }) => credential.kind === "oauth_session")
  await Auth.removeOAuthClientRegistration(connectorID, CONNECTOR_CUSTOM_OAUTH_CLIENT_KEY)
  await Auth.setProviderLastError(connectorID, null)
  await syncConnectorRuntimeBinding(definition)
  return statusForDefinition(definition)
}

export async function startConnectorOAuthFlow(connectorID: string, input: { serverBaseURL: string }) {
  const { definition } = assertDefinitionForConnectorID(connectorID)
  if (!definition.available) {
    throw new ConnectorError("CONNECTOR_UNAVAILABLE", `${definition.name} is not available.`)
  }

  const credential = assertOAuthCredential(definition)
  if (credential.clientIDConfigKey && !(await customOAuthClientRegistration(connectorID))) {
    throw new ConnectorError("CONNECTOR_CONFIG_REQUIRED", `${definition.name} requires App ID and App Secret before sign-in.`)
  }
  await syncConnectorRuntimeBinding(definition)
  return ProviderAuth.startGenericOAuthFlow({
    providerID: connectorID,
    method: oauthMethodForDefinition(definition),
    serverBaseURL: input.serverBaseURL,
    oauth: await oauthConfigForCredential(credential, connectorID, definition),
  })
}

export async function getConnectorOAuthFlow(connectorID: string, flowID: string) {
  const { definition } = assertDefinitionForConnectorID(connectorID)
  assertOAuthCredential(definition)
  return ProviderAuth.getProviderFlow(connectorID, flowID)
}

export async function cancelConnectorOAuthFlow(connectorID: string, flowID: string) {
  const { definition } = assertDefinitionForConnectorID(connectorID)
  assertOAuthCredential(definition)
  return ProviderAuth.cancelProviderAuthFlow(connectorID, flowID)
}

export async function deleteConnectorOAuthSession(connectorID: string) {
  const { definition } = assertDefinitionForConnectorID(connectorID)
  const credential = assertOAuthCredential(definition)
  await ProviderAuth.deleteGenericOAuthSession(
    connectorID,
    oauthMethodForDefinition(definition),
    await oauthConfigForCredential(credential, connectorID, definition),
  )
  await syncConnectorRuntimeBinding(definition)
  return statusForDefinition(definition)
}

function replacePlaceholders(value: string, config: Record<string, string>) {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, key: string) => config[key] ?? "")
}

function replaceOptionalPlaceholders(value: string | undefined, config: Record<string, string>) {
  if (!value) return undefined
  const replaced = replacePlaceholders(value, config).trim()
  return replaced ? replaced : undefined
}

function replaceRecordPlaceholders(record: Record<string, string> | undefined, config: Record<string, string>) {
  if (!record) return undefined

  const entries = Object.entries(record)
    .map(([key, value]) => [key, replacePlaceholders(value, config)] as const)
    .filter(([key, value]) => key.trim() && value.trim())

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

async function resolvePlatformRuntime(connectorID: string): Promise<ResolvedConnectorRuntime> {
  const { definition } = assertDefinitionForConnectorID(connectorID)
  if (!definition.available) {
    throw new ConnectorError("CONNECTOR_UNAVAILABLE", `${definition.name} is not available.`)
  }
  if (!definition.runtime) {
    throw new ConnectorError("CONNECTOR_RUNTIME_MISSING", `${definition.name} does not define a runtime.`)
  }

  const config: Record<string, string> = {}

  if (definition.credential?.kind === "api_key") {
    const credential = assertApiKeyCredential(definition)
    const activeCredential = await Auth.getActiveProviderCredential(connectorID)
    if (activeCredential?.credential.kind !== "api_key") {
      throw new ConnectorError("CONNECTOR_NOT_CONNECTED", `${definition.name} is not connected.`)
    }
    config[credential.key] = activeCredential.credential.apiKey
  } else if (definition.credential?.kind === "oauth") {
    const credential = assertOAuthCredential(definition)
    const session = await ProviderAuth.resolveGenericOAuthCredential(
      connectorID,
      oauthMethodForDefinition(definition),
      await oauthConfigForCredential(credential, connectorID, definition),
    )
    if (!session) {
      throw new ConnectorError("CONNECTOR_NOT_CONNECTED", `${definition.name} is not connected.`)
    }
    config.OAUTH_ACCESS_TOKEN = session.accessToken
    config.OAUTH_TOKEN_TYPE = session.tokenType ?? "Bearer"
    config.OAUTH_SCOPES = session.scope ?? ""
  }

  if (definition.runtime.transport === "stdio") {
    return {
      transport: "stdio",
      command: replacePlaceholders(definition.runtime.command, config),
      args: definition.runtime.args?.map((arg) => replacePlaceholders(arg, config)),
      cwd: replaceOptionalPlaceholders(definition.runtime.cwd, config),
      env: replaceRecordPlaceholders(definition.runtime.env, config),
    }
  }

  const serverUrl = replaceOptionalPlaceholders(definition.runtime.serverUrl, config)
  if (!serverUrl) {
    throw new ConnectorError("CONNECTOR_RUNTIME_MISSING", `${definition.name} does not declare a remote MCP server URL.`)
  }

  const result: ResolvedConnectorRuntime = {
    transport: "remote",
    serverUrl,
    authorization: replaceOptionalPlaceholders(definition.runtime.authorization, config),
    headers: replaceRecordPlaceholders(definition.runtime.headers, config),
  }

  if (definition.credential?.kind === "oauth" && !result.authorization) {
    const placement = definition.credential.tokenPlacement ?? { type: "authorization_bearer" as const }
    if (placement.type === "authorization_bearer") {
      result.authorization = `Bearer ${config.OAUTH_ACCESS_TOKEN}`
    } else {
      result.headers = {
        ...(result.headers ?? {}),
        [placement.name]: replacePlaceholders(placement.value ?? "Bearer ${OAUTH_ACCESS_TOKEN}", config),
      }
    }
  }

  return result
}

export async function resolveRuntime(connectorID: string): Promise<ResolvedConnectorRuntime> {
  if (connectorID.startsWith(PLUGIN_CONNECTOR_PREFIX) || connectorID.startsWith(LEGACY_PLUGIN_APP_CONNECTOR_PREFIX)) {
    const pluginModule = await import("#plugin/plugin.ts")
    return pluginModule.resolveConnectorRuntime(connectorID)
  }

  return resolvePlatformRuntime(connectorID)
}

export async function resolveRemoteServer(connectorID: string): Promise<{
  serverUrl: string
  authorization?: string
  headers?: Record<string, string>
}> {
  const runtime = await resolveRuntime(connectorID)
  if (runtime.transport !== "remote") {
    throw new ConnectorError("CONNECTOR_RUNTIME_MISSING", `Connector '${connectorID}' does not resolve to a remote MCP server.`)
  }

  return {
    serverUrl: runtime.serverUrl,
    authorization: runtime.authorization,
    headers: runtime.headers,
  }
}

function runtimeBindingForConnector(definition: ConnectorDefinition): Config.McpServerInput | undefined {
  if (!definition.runtime) return undefined
  return {
    name: definition.name,
    transport: "connector",
    provider: definition.runtime.transport === "remote" ? definition.runtime.provider : undefined,
    connectorId: connectorIDForDefinition(definition.id),
    serverDescription: definition.runtime.serverDescription,
    allowedTools: definition.runtime.allowedTools,
    toolPolicies: definition.runtime.toolPolicies,
    requireApproval: definition.runtime.requireApproval,
    enabled: definition.available,
    timeoutMs: definition.runtime.timeoutMs,
  }
}

async function syncConnectorRuntimeBinding(definition: ConnectorDefinition) {
  const runtimeBinding = runtimeBindingForConnector(definition)
  if (!runtimeBinding) return
  await Config.setMcpServer(Config.GLOBAL_CONFIG_ID, mcpServerIDForConnector(definition.id), runtimeBinding)
}

export async function syncConnectorRuntimeBindings() {
  for (const definition of listDefinitions()) {
    await syncConnectorRuntimeBinding(definition)
  }
}

export async function diagnoseConnector(connectorID: string) {
  const { definition } = assertDefinitionForConnectorID(connectorID)
  const runtimeBinding = runtimeBindingForConnector(definition)
  if (!runtimeBinding) {
    return {
      serverID: mcpServerIDForConnector(definition.id),
      enabled: false,
      ok: false,
      toolCount: 0,
      toolNames: [],
      tools: [],
      error: `${definition.name} does not define a runtime.`,
    }
  }

  const server = Config.McpServerSummary.parse({
    id: mcpServerIDForConnector(definition.id),
    ...runtimeBinding,
    enabled: runtimeBinding.enabled ?? true,
  })
  return Mcp.diagnoseServer(server)
}
