import { existsSync, readFileSync } from "node:fs"
import { delimiter, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import z from "zod"
import * as Auth from "#auth/auth.ts"
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
const BUILD_GMAIL_CONNECTOR_PATH = ["connectors", "gmail"] as const
const BUILD_FEISHU_CONNECTOR_PATH = ["connectors", "feishu"] as const
const BUILD_NODE_REPL_CONNECTOR_PATH = ["connectors", "node-repl"] as const
const SOURCE_NODE_REPL_CONNECTOR_PATH = ["connectors", "node-repl"] as const
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

const ConnectorMcpRuntimeFields = {
  id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string().min(1).optional(),
  available: z.boolean().default(true),
} as const

export const ConnectorMcpStdioRuntime = ConnectorStdioRuntime.extend(ConnectorMcpRuntimeFields)
export type ConnectorMcpStdioRuntime = z.infer<typeof ConnectorMcpStdioRuntime>

export const ConnectorMcpRemoteRuntime = ConnectorRemoteRuntime.extend(ConnectorMcpRuntimeFields)
export type ConnectorMcpRemoteRuntime = z.infer<typeof ConnectorMcpRemoteRuntime>

export const ConnectorMcpRuntime = z.union([ConnectorMcpStdioRuntime, ConnectorMcpRemoteRuntime])
export type ConnectorMcpRuntime = z.infer<typeof ConnectorMcpRuntime>

export const ConnectorCategory = z.enum(["account_connector", "builtin_mcp"])
export type ConnectorCategory = z.infer<typeof ConnectorCategory>

const ConnectorDefinitionFields = {
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
  installReview: z.array(z.string()).default([]),
  source: z.enum(["platform", "registry"]).default("platform"),
  available: z.boolean().default(true),
} as const

const CanonicalConnectorDefinitionInput = z
  .object({
    ...ConnectorDefinitionFields,
    category: ConnectorCategory,
    mcpRuntimes: z.array(ConnectorMcpRuntime).default([]),
  })
  .strict()

const LegacyConnectorDefinitionInput = z
  .object({
    ...ConnectorDefinitionFields,
    runtime: ConnectorRuntime.optional(),
  })
  .strict()

function legacyRuntimeAlias(runtime: ConnectorMcpRuntime | undefined): ConnectorRuntime | undefined {
  if (!runtime) return undefined
  const {
    id: _id,
    name: _name,
    available: _available,
    ...legacyRuntime
  } = runtime
  return ConnectorRuntime.parse(legacyRuntime)
}

function validateConnectorDefinition(
  definition: {
    category: ConnectorCategory
    credential?: ConnectorCredential
    mcpRuntimes: ConnectorMcpRuntime[]
  },
  ctx: z.RefinementCtx,
) {
  if (definition.category === "builtin_mcp" && definition.credential) {
    ctx.addIssue({
      code: "custom",
      message: "Built-in MCP definitions cannot declare connector credentials.",
      path: ["credential"],
    })
  }

  const seenRuntimeIDs = new Set<string>()
  definition.mcpRuntimes.forEach((runtime, index) => {
    if (seenRuntimeIDs.has(runtime.id)) {
      ctx.addIssue({
        code: "custom",
        message: `Duplicate MCP runtime id '${runtime.id}'.`,
        path: ["mcpRuntimes", index, "id"],
      })
    }
    seenRuntimeIDs.add(runtime.id)
  })
}

const CanonicalConnectorDefinition = CanonicalConnectorDefinitionInput
  .superRefine(validateConnectorDefinition)
  .transform((definition) => ({
    ...definition,
    /** @deprecated Use mcpRuntimes. */
    runtime: legacyRuntimeAlias(
      definition.mcpRuntimes.find((runtime) => runtime.id === "default") ?? definition.mcpRuntimes[0],
    ),
  }))

const LegacyConnectorDefinition = LegacyConnectorDefinitionInput
  .transform((definition) => ({
    ...definition,
    category: "account_connector" as const,
    mcpRuntimes: definition.runtime
      ? [ConnectorMcpRuntime.parse({ id: "default", ...definition.runtime })]
      : [],
  }))
  .superRefine(validateConnectorDefinition)

export const ConnectorDefinition = z.union([
  CanonicalConnectorDefinition,
  LegacyConnectorDefinition,
])
export type ConnectorDefinition = z.infer<typeof ConnectorDefinition>

export const ConnectorRequirement = z
  .object({
    connector: z.string().min(1),
    runtimeIDs: z.array(z.string().min(1)).optional(),
    tools: z.array(z.string().min(1)).optional(),
    permissions: z.array(z.string().min(1)).optional(),
    required: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .strict()
export type ConnectorRequirement = z.infer<typeof ConnectorRequirement>

const LegacyConnectorRegistryFile = z
  .object({
    schemaVersion: z.literal(1).optional(),
    connectors: z.array(LegacyConnectorDefinition),
  })
  .strict()

const ConnectorRegistryFile = z
  .object({
    schemaVersion: z.literal(2),
    connectors: z.array(CanonicalConnectorDefinition),
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

export const ConnectorMcpBinding = z
  .object({
    runtimeID: z.string().min(1),
    serverID: z.string().min(1),
    name: z.string().min(1).optional(),
  })
  .strict()
export type ConnectorMcpBinding = z.infer<typeof ConnectorMcpBinding>

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
    mcpBindings: z.array(ConnectorMcpBinding).default([]),
    /** @deprecated Use mcpBindings. */
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

export function mcpServerIDForConnector(
  definitionID: string,
  instanceID = "default",
  runtimeID = "default",
) {
  const baseID = `connector.${normalizeConnectorDefinitionID(definitionID)}.${instanceID.trim() || "default"}`
  const normalizedRuntimeID = runtimeID.trim() || "default"
  return normalizedRuntimeID === "default"
    ? baseID
    : `${baseID}.${normalizeConnectorDefinitionID(normalizedRuntimeID)}`
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

export function mcpServerIDForConnectorID(connectorID: string, runtimeID = "default") {
  const parsed = parseConnectorID(connectorID)
  return parsed ? mcpServerIDForConnector(parsed.definitionID, parsed.instanceID, runtimeID) : undefined
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
      : z.union([LegacyConnectorRegistryFile, ConnectorRegistryFile]).parse(parsedJSON).connectors

    return parsed.map((definition) => {
      const {
        runtime: _legacyRuntime,
        ...canonicalDefinition
      } = definition
      return CanonicalConnectorDefinition.parse({
        ...canonicalDefinition,
        id: normalizeConnectorDefinitionID(definition.id),
        source: "registry",
      })
    })
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

function builtinGmailConnectorRoot() {
  const packagedRoot = resolve(bundledRuntimeRoot(), ...BUILD_GMAIL_CONNECTOR_PATH)
  return existsSync(packagedRoot) ? packagedRoot : resolve(builtinGmailPackageRoot(), "connectors", "gmail")
}

function builtinFeishuConnectorRoot() {
  const packagedRoot = resolve(bundledRuntimeRoot(), ...BUILD_FEISHU_CONNECTOR_PATH)
  return existsSync(packagedRoot) ? packagedRoot : resolve(builtinFeishuPackageRoot(), "connectors", "feishu")
}

function builtinNodeReplConnectorRoot() {
  const packagedRoot = resolve(bundledRuntimeRoot(), ...BUILD_NODE_REPL_CONNECTOR_PATH)
  return existsSync(packagedRoot)
    ? packagedRoot
    : packageRootFromAnyboxAgentRoot(...SOURCE_NODE_REPL_CONNECTOR_PATH)
}

function builtinNodeReplCommand() {
  return getProcessEnvValue("ANYBOX_NODE_BINARY")?.trim() || "node"
}

function builtinNodeReplEnvironment() {
  return getProcessEnvValue("ANYBOX_NODE_RUN_AS_NODE") === "1"
    ? { ELECTRON_RUN_AS_NODE: "1" }
    : undefined
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

function builtinDefinitions(): ConnectorDefinition[] {
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
      id: "node-repl",
      category: "builtin_mcp",
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
      mcpRuntimes: [
        {
          id: "default",
          name: "Node REPL",
          available: nodeReplRuntimeAvailable,
          transport: "stdio",
          command: builtinNodeReplCommand(),
          args: [nodeReplServerPath],
          env: builtinNodeReplEnvironment(),
          serverDescription: "Persistent general-purpose Node.js environment managed by Anybox.",
          timeoutMs: 120_000,
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
        },
      ],
      installReview: [
        "This runtime belongs to Anybox rather than to a specific plugin.",
        "Its working directory is the active project, not an installed plugin package.",
        "Plugins can expose capabilities by having the agent import their own modules at runtime.",
      ],
      source: "platform",
      available: nodeReplRuntimeAvailable,
    }),
    ConnectorDefinition.parse({
      id: "gmail",
      category: "account_connector",
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
      mcpRuntimes: [
        {
          id: "default",
          name: "Gmail",
          available: gmailRuntimeAvailable,
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
      ],
      installReview: [
        "OAuth client metadata is managed by Anybox.",
        "Uses the read-only Gmail API scope.",
        "Runs a local stdio MCP wrapper bundled with Anybox.",
      ],
      source: "platform",
      available: gmailConfigured,
    }),
    ConnectorDefinition.parse({
      id: "feishu",
      category: "account_connector",
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
      mcpRuntimes: [
        {
          id: "default",
          name: "Feishu",
          available: feishuRuntimeAvailable,
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
      ],
      installReview: [
        "Create a Feishu Open Platform custom app and copy its App ID and App Secret here.",
        "Add the local callback URL shown by Anybox to the app security settings when connecting.",
        "Enable the required Drive and Docx scopes on the Feishu app before authorizing.",
      ],
      source: "platform",
      available: true,
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

export function listAccountDefinitions(): ConnectorDefinition[] {
  return listDefinitions().filter((definition) => definition.category === "account_connector")
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

async function statusForDefinition(
  definition: ConnectorDefinition,
  instanceID = "default",
): Promise<ConnectorStatus> {
  const connectorID = connectorIDForDefinition(definition.id, instanceID)
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
    ? definition.category === "account_connector"
      ? definition.available
      : Boolean(definition.mcpRuntimes.some((runtime) => runtime.available) && definition.available)
    : definition.credential.kind === "api_key"
      ? credential?.kind === "api_key"
      : credential?.kind === "oauth_session" && credential.expiresAt > now()
  const mcpBindings = definition.mcpRuntimes.map((runtime) => ({
    runtimeID: runtime.id,
    serverID: mcpServerIDForConnector(definition.id, instanceID, runtime.id),
    name: runtime.name,
  }))

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
    mcpBindings,
    generatedMcpServerID: mcpBindings.find((binding) => binding.runtimeID === "default")?.serverID
      ?? mcpBindings[0]?.serverID,
  }
}

export async function listStatuses(): Promise<ConnectorStatus[]> {
  return Promise.all(listAccountDefinitions().map((definition) => statusForDefinition(definition)))
}

export async function getStatus(connectorID: string): Promise<ConnectorStatus> {
  const { definition, parsed } = assertDefinitionForConnectorID(connectorID)
  return statusForDefinition(definition, parsed.instanceID)
}

export async function saveConnectorApiKey(connectorID: string, input: SaveConnectorApiKeyInput) {
  const { definition, parsed } = assertDefinitionForConnectorID(connectorID)
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

  await syncConnectorDefinitionRuntimeBindings(definition, parsed.instanceID)
  return statusForDefinition(definition, parsed.instanceID)
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
  const { definition, parsed } = assertDefinitionForConnectorID(connectorID)
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
  await syncConnectorDefinitionRuntimeBindings(definition, parsed.instanceID)
  return statusForDefinition(definition, parsed.instanceID)
}

export async function removeConnectorConfig(connectorID: string) {
  const { definition, parsed } = assertDefinitionForConnectorID(connectorID)
  await Auth.removeProviderCredentials(connectorID, ({ credential }) => credential.kind === "oauth_session")
  await Auth.removeOAuthClientRegistration(connectorID, CONNECTOR_CUSTOM_OAUTH_CLIENT_KEY)
  await Auth.setProviderLastError(connectorID, null)
  await syncConnectorDefinitionRuntimeBindings(definition, parsed.instanceID)
  return statusForDefinition(definition, parsed.instanceID)
}

export async function startConnectorOAuthFlow(connectorID: string, input: { serverBaseURL: string }) {
  const { definition, parsed } = assertDefinitionForConnectorID(connectorID)
  if (!definition.available) {
    throw new ConnectorError("CONNECTOR_UNAVAILABLE", `${definition.name} is not available.`)
  }

  const credential = assertOAuthCredential(definition)
  if (credential.clientIDConfigKey && !(await customOAuthClientRegistration(connectorID))) {
    throw new ConnectorError("CONNECTOR_CONFIG_REQUIRED", `${definition.name} requires App ID and App Secret before sign-in.`)
  }
  await syncConnectorDefinitionRuntimeBindings(definition, parsed.instanceID)
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
  const { definition, parsed } = assertDefinitionForConnectorID(connectorID)
  const credential = assertOAuthCredential(definition)
  await ProviderAuth.deleteGenericOAuthSession(
    connectorID,
    oauthMethodForDefinition(definition),
    await oauthConfigForCredential(credential, connectorID, definition),
  )
  await syncConnectorDefinitionRuntimeBindings(definition, parsed.instanceID)
  return statusForDefinition(definition, parsed.instanceID)
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

function runtimeForDefinition(definition: ConnectorDefinition, runtimeID: string) {
  const normalizedRuntimeID = runtimeID.trim() || "default"
  const runtime = definition.mcpRuntimes.find((candidate) => candidate.id === normalizedRuntimeID)
  if (!runtime) {
    throw new ConnectorError(
      "CONNECTOR_RUNTIME_NOT_FOUND",
      `${definition.name} does not define MCP runtime '${normalizedRuntimeID}'.`,
    )
  }
  return runtime
}

async function resolvePlatformRuntime(
  connectorID: string,
  runtimeID = "default",
): Promise<ResolvedConnectorRuntime> {
  const { definition } = assertDefinitionForConnectorID(connectorID)
  if (!definition.available) {
    throw new ConnectorError("CONNECTOR_UNAVAILABLE", `${definition.name} is not available.`)
  }
  const runtime = runtimeForDefinition(definition, runtimeID)
  if (!runtime.available) {
    throw new ConnectorError(
      "CONNECTOR_RUNTIME_UNAVAILABLE",
      `${definition.name} MCP runtime '${runtime.id}' is not available.`,
    )
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

  if (runtime.transport === "stdio") {
    return {
      transport: "stdio",
      command: replacePlaceholders(runtime.command, config),
      args: runtime.args?.map((arg) => replacePlaceholders(arg, config)),
      cwd: replaceOptionalPlaceholders(runtime.cwd, config),
      env: replaceRecordPlaceholders(runtime.env, config),
    }
  }

  const serverUrl = replaceOptionalPlaceholders(runtime.serverUrl, config)
  if (!serverUrl) {
    throw new ConnectorError(
      "CONNECTOR_RUNTIME_MISSING",
      `${definition.name} MCP runtime '${runtime.id}' does not declare a remote MCP server URL.`,
    )
  }

  const result: ResolvedConnectorRuntime = {
    transport: "remote",
    serverUrl,
    authorization: replaceOptionalPlaceholders(runtime.authorization, config),
    headers: replaceRecordPlaceholders(runtime.headers, config),
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

export async function resolveRuntime(
  connectorID: string,
  runtimeID = "default",
): Promise<ResolvedConnectorRuntime> {
  if (connectorID.startsWith(PLUGIN_CONNECTOR_PREFIX) || connectorID.startsWith(LEGACY_PLUGIN_APP_CONNECTOR_PREFIX)) {
    if (runtimeID !== "default") {
      throw new ConnectorError(
        "CONNECTOR_RUNTIME_NOT_FOUND",
        `Plugin connector '${connectorID}' does not define MCP runtime '${runtimeID}'.`,
      )
    }
    const pluginModule = await import("#plugin/plugin.ts")
    return pluginModule.resolveConnectorRuntime(connectorID)
  }

  return resolvePlatformRuntime(connectorID, runtimeID)
}

export async function resolveRemoteServer(connectorID: string, runtimeID = "default"): Promise<{
  serverUrl: string
  authorization?: string
  headers?: Record<string, string>
}> {
  const runtime = await resolveRuntime(connectorID, runtimeID)
  if (runtime.transport !== "remote") {
    throw new ConnectorError("CONNECTOR_RUNTIME_MISSING", `Connector '${connectorID}' does not resolve to a remote MCP server.`)
  }

  return {
    serverUrl: runtime.serverUrl,
    authorization: runtime.authorization,
    headers: runtime.headers,
  }
}

function runtimeBindingForConnector(
  definition: ConnectorDefinition,
  runtime: ConnectorMcpRuntime,
  instanceID = "default",
): Config.McpConnectorServerInput {
  const connectorId = connectorIDForDefinition(definition.id, instanceID)
  return {
    name: runtime.name ?? definition.name,
    transport: "connector",
    provider: runtime.transport === "remote" ? runtime.provider : undefined,
    connectorId,
    connectorRuntimeId: runtime.id,
    serverDescription: runtime.serverDescription,
    allowedTools: runtime.allowedTools,
    toolPolicies: runtime.toolPolicies,
    requireApproval: runtime.requireApproval,
    // Enabled records user intent. Definition/runtime availability is checked
    // independently during resolution so a temporary outage cannot persist as
    // a user-disabled MCP server after the runtime recovers.
    enabled: true,
    timeoutMs: runtime.timeoutMs,
  }
}

function ownerForConnectorRuntime(
  definition: ConnectorDefinition,
  connectorId: string,
  runtimeID: string,
  serverID: string,
): Config.McpServerOwner {
  return definition.category === "account_connector"
    ? {
        kind: "connector",
        connectorId,
        runtimeID,
      }
    : {
        kind: "anybox",
        bindingID: serverID,
      }
}

async function syncConnectorRuntimeBinding(
  definition: ConnectorDefinition,
  runtime: ConnectorMcpRuntime,
  instanceID = "default",
) {
  const runtimeBinding = runtimeBindingForConnector(definition, runtime, instanceID)
  const serverID = mcpServerIDForConnector(definition.id, instanceID, runtime.id)
  const existing = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, serverID)
  // Runtime metadata is regenerated from the connector definition, while the
  // MCP controls exposed to users must survive connector/plugin resyncs.
  const preservesUserControls =
    runtimeBinding.transport === "connector"
    && existing?.transport === "connector"
    && existing.connectorId === runtimeBinding.connectorId
    && (existing.connectorRuntimeId ?? "default") === runtime.id
  const synchronizedBinding = preservesUserControls
    ? {
        ...runtimeBinding,
        enabled: existing.enabled,
        toolPolicies: existing.toolPolicies ?? runtimeBinding.toolPolicies,
      }
    : runtimeBinding

  await Config.setManagedMcpServer(
    Config.GLOBAL_CONFIG_ID,
    serverID,
    synchronizedBinding,
    ownerForConnectorRuntime(
      definition,
      runtimeBinding.connectorId,
      runtime.id,
      serverID,
    ),
  )
  return serverID
}

async function syncConnectorDefinitionRuntimeBindings(
  definition: ConnectorDefinition,
  instanceID = "default",
) {
  const serverIDs: string[] = []
  for (const runtime of definition.mcpRuntimes) {
    serverIDs.push(await syncConnectorRuntimeBinding(definition, runtime, instanceID))
  }
  return serverIDs
}

function isConnectorRuntimeOwner(owner: Config.McpServerOwner | undefined) {
  return owner?.kind === "connector" && Boolean(parseConnectorID(owner.connectorId))
}

function isAnyboxConnectorRuntimeOwner(owner: Config.McpServerOwner | undefined) {
  return owner?.kind === "anybox" && owner.bindingID.startsWith("connector.")
}

export async function syncConnectorRuntimeBindings() {
  const definitions = listDefinitions()
  const definitionsByID = new Map(definitions.map((definition) => [definition.id, definition]))
  const existingServers = await Config.listMcpServers(Config.GLOBAL_CONFIG_ID)
  const instancesByDefinitionID = new Map<string, Set<string>>(
    definitions.map((definition) => [definition.id, new Set(["default"])]),
  )

  for (const server of existingServers) {
    if (server.owner?.kind !== "connector") continue
    const parsed = parseConnectorID(server.owner.connectorId)
    if (!parsed || !definitionsByID.has(parsed.definitionID)) continue
    instancesByDefinitionID.get(parsed.definitionID)?.add(parsed.instanceID)
  }

  const desiredServerIDs = new Set<string>()
  for (const definition of definitions) {
    for (const instanceID of instancesByDefinitionID.get(definition.id) ?? ["default"]) {
      for (const serverID of await syncConnectorDefinitionRuntimeBindings(definition, instanceID)) {
        desiredServerIDs.add(serverID)
      }
    }
  }

  for (const server of existingServers) {
    if (desiredServerIDs.has(server.id)) continue
    if (!isConnectorRuntimeOwner(server.owner) && !isAnyboxConnectorRuntimeOwner(server.owner)) continue
    await Config.removeMcpServer(Config.GLOBAL_CONFIG_ID, server.id)
    await Config.removeSelectedMcpServerIDFromAllProjects(server.id)
  }
}

export async function diagnoseConnector(connectorID: string, runtimeID = "default") {
  const { definition, parsed } = assertDefinitionForConnectorID(connectorID)
  const normalizedRuntimeID = runtimeID.trim() || "default"
  const runtime = definition.mcpRuntimes.find((candidate) => candidate.id === normalizedRuntimeID)
  const serverID = mcpServerIDForConnector(definition.id, parsed.instanceID, normalizedRuntimeID)
  if (!runtime) {
    return {
      serverID,
      enabled: false,
      ok: false,
      toolCount: 0,
      toolNames: [],
      tools: [],
      error: `${definition.name} does not define MCP runtime '${normalizedRuntimeID}'.`,
    }
  }

  const existing = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, serverID)
  const runtimeBinding = runtimeBindingForConnector(definition, runtime, parsed.instanceID)
  const server = existing ?? Config.McpServerSummary.parse({
    id: serverID,
    ...runtimeBinding,
    owner: ownerForConnectorRuntime(
      definition,
      runtimeBinding.connectorId,
      runtime.id,
      serverID,
    ),
    enabled: runtimeBinding.enabled ?? true,
  })
  return Mcp.diagnoseServer(server)
}
