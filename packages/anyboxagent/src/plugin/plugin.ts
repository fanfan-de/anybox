import { createHash, randomUUID } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { cp, mkdir, rm, writeFile } from "node:fs/promises"
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { inflateRawSync } from "node:zlib"
import matter from "gray-matter"
import z from "zod"
import * as Auth from "#auth/auth.ts"
import * as ProviderAuth from "#auth/provider-auth.ts"
import * as Config from "#config/config.ts"
import * as Connector from "#connector/connector.ts"
import * as db from "#database/Sqlite.ts"
import * as Global from "#global/global.ts"
import { toCreateTableSQL, withPrimaryKey, zodObjectToColumnDefs } from "#database/parser.ts"
import * as Mcp from "#mcp/manager.ts"
import { getProcessEnvValue } from "#env/compat.ts"

const INSTALLED_PLUGINS_TABLE = "installed_plugins"
const PLUGIN_MANIFEST_PATH = join(".anybox-plugin", "plugin.json")
const PLUGIN_MANIFEST_URL_SUFFIX = "/.anybox-plugin/plugin.json"
const PLUGIN_APP_COMPAT_PATH = ".app.json"
const BUILTIN_PLUGIN_PACKAGE_PATH = join("plugins", "builtin")
const WORKSPACE_PLUGIN_PACKAGE_PATH = join("plugins", "Anybox-Plugins")
const PLUGIN_REGISTRY_PATH = join("plugins", "registry", "plugin-registry.json")
const PLUGIN_REGISTRY_CACHE_PATH = join("plugins", "registry-cache", "plugin-registry-cache.json")
const PLUGIN_IMPORTED_REGISTRY_PATH = join("plugins", "registry", "imported-plugin-registry.json")
const DEFAULT_SKILLS_DIRECTORY = "skills"
const API_KEY_METHOD = "api-key"
const PLUGIN_CONNECTOR_PREFIX = "plugin-connector:"
const PLUGIN_APP_CONNECTOR_PREFIX = "plugin-app:"
const PLUGIN_LOCAL_DIR_ENV = "ANYBOX_PLUGIN_LOCAL_DIR"
const PLUGIN_INSTALL_DIR_ENV = "ANYBOX_PLUGIN_INSTALL_DIR"
const PLUGIN_REGISTRY_FILES_ENV = "ANYBOX_PLUGIN_REGISTRY_FILES"
const PLUGIN_REGISTRY_INDEX_URL_ENV = "ANYBOX_PLUGIN_REGISTRY_INDEX_URL"
const PLUGIN_REGISTRY_CACHE_DIR_ENV = "ANYBOX_PLUGIN_REGISTRY_CACHE_DIR"
const PLUGIN_IMPORTED_REGISTRY_FILE_ENV = "ANYBOX_PLUGIN_IMPORTED_REGISTRY_FILE"
const DEFAULT_PLUGIN_REGISTRY_INDEX_URL = "https://raw.githubusercontent.com/fanfan-de/anybox/master/plugins/Anybox-Plugins/index.json"
const MAX_PLUGIN_PACKAGE_BYTES = 100 * 1024 * 1024
const MAX_PLUGIN_DISPLAY_ASSET_BYTES = 2 * 1024 * 1024
const MAX_PLUGIN_REGISTRY_INDEX_BYTES = 256 * 1024
const MAX_PLUGIN_META_BYTES = 1024 * 1024
const MAX_REMOTE_PLUGIN_META_COUNT = 200
const PLUGIN_REGISTRY_FETCH_TIMEOUT_MS = 8000
const PLUGIN_DISPLAY_ASSET_MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
])

type PluginManifestSource = {
  manifest: PluginManifest
  packageRoot?: string
  managedInstall?: boolean
  download?: PluginPackageDownload
  skillPreviews?: PluginSkillPreview[]
  source: "package" | "registry"
}

export type PluginErrorCode =
  | "PLUGIN_NOT_FOUND"
  | "INSTALLED_PLUGIN_NOT_FOUND"
  | "PLUGIN_ALREADY_INSTALLED"
  | "PLUGIN_CONFIG_INVALID"
  | "PLUGIN_RISK_NOT_ALLOWED"
  | "PLUGIN_CONNECTOR_NOT_FOUND"
  | "PLUGIN_CONNECTOR_NOT_CONNECTED"
  | "PLUGIN_REGISTRY_UNAVAILABLE"
  | "PLUGIN_PACKAGE_UNAVAILABLE"
  | "PLUGIN_PACKAGE_DOWNLOAD_FAILED"
  | "PLUGIN_PACKAGE_INVALID"

export class PluginError extends Error {
  readonly code: PluginErrorCode

  constructor(code: PluginErrorCode, message: string) {
    super(message)
    this.name = "PluginError"
    this.code = code
  }
}

export const PluginCategory = z.enum(["Code", "Browser", "Git", "Database", "Docs", "Automation", "Design"])
export type PluginCategory = z.infer<typeof PluginCategory>

export const PluginRisk = z.enum(["low", "medium", "high", "critical"])
export type PluginRisk = z.infer<typeof PluginRisk>

export const PluginToolPreview = z
  .object({
    name: z.string().min(1),
    title: z.string().min(1).optional(),
    description: z.string().min(1),
    readOnly: z.boolean().optional(),
    destructive: z.boolean().optional(),
  })
  .strict()
export type PluginToolPreview = z.infer<typeof PluginToolPreview>

export const PluginConfigField = z
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
export type PluginConfigField = z.infer<typeof PluginConfigField>

export const PluginOAuthTokenPlacement = z.union([
  z
    .object({
      type: z.literal("authorization_bearer"),
    })
    .strict(),
  z
    .object({
      type: z.literal("header"),
      name: z.string().min(1),
      value: z.string().min(1).optional(),
    })
    .strict(),
])
export type PluginOAuthTokenPlacement = z.infer<typeof PluginOAuthTokenPlacement>

export const PluginOAuthClientRegistration = z
  .object({
    registrationURL: z.string().min(1),
    initialAccessToken: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
export type PluginOAuthClientRegistration = z.infer<typeof PluginOAuthClientRegistration>

export const PluginApiKeyAppCredential = PluginConfigField.extend({
  kind: z.literal("api_key").optional(),
}).transform((credential) => ({
  ...credential,
  kind: "api_key" as const,
}))
export type PluginApiKeyAppCredential = z.infer<typeof PluginApiKeyAppCredential>

function validateOAuthClientSource(
  credential: { clientID?: string; registration?: PluginOAuthClientRegistration },
  ctx: z.RefinementCtx,
) {
  if (credential.clientID || credential.registration) return
  ctx.addIssue({
    code: "custom",
    message: "OAuth credential requires 'clientID' or 'registration'.",
    path: ["clientID"],
  })
}

const PluginOAuthAppCredentialBase = z
  .object({
    kind: z.literal("oauth"),
    label: z.string().min(1).default("OAuth"),
    clientID: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    authorizationURL: z.string().min(1),
    tokenURL: z.string().min(1),
    scopes: z.array(z.string().min(1)).min(1),
    revocationURL: z.string().min(1).optional(),
    tokenPlacement: PluginOAuthTokenPlacement.default({ type: "authorization_bearer" }),
    authorizationParams: z.record(z.string(), z.string()).optional(),
    tokenParams: z.record(z.string(), z.string()).optional(),
    tokenEndpointAuthMethod: z.enum(["none", "client_secret_post", "client_secret_basic"]).optional(),
    registration: PluginOAuthClientRegistration.optional(),
    description: z.string().optional(),
  })
  .strict()

export const PluginOAuthAppCredential = PluginOAuthAppCredentialBase.superRefine(validateOAuthClientSource)
export type PluginOAuthAppCredential = z.infer<typeof PluginOAuthAppCredential>

const PluginAppCompatOAuthCredential = PluginOAuthAppCredential.or(
  PluginOAuthAppCredentialBase.omit({ kind: true })
    .superRefine(validateOAuthClientSource)
    .transform((credential) => ({
      ...credential,
      kind: "oauth" as const,
    })),
)

export const PluginAppCredential = z.union([PluginOAuthAppCredential, PluginApiKeyAppCredential])
export type PluginAppCredential = z.infer<typeof PluginAppCredential>

export const PluginPackageDownload = z
  .object({
    type: z.literal("zip"),
    url: z.string().min(1).optional(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    size: z.number().int().positive().optional(),
  })
  .strict()
export type PluginPackageDownload = z.infer<typeof PluginPackageDownload>

const PluginRuntimeBase = {
  timeoutMs: z.number().int().positive().optional(),
  toolPolicies: Config.McpToolPolicies,
} as const

export const PluginStdioRuntime = z
  .object({
    ...PluginRuntimeBase,
    transport: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().min(1).optional(),
  })
  .strict()
export type PluginStdioRuntime = z.infer<typeof PluginStdioRuntime>

export const PluginRemoteRuntime = z
  .object({
    ...PluginRuntimeBase,
    transport: z.literal("remote"),
    provider: Config.McpRemoteProvider.optional(),
    serverUrl: z.string().min(1).optional(),
    connectorId: z.string().min(1).optional(),
    authorization: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    serverDescription: z.string().min(1).optional(),
    allowedTools: Config.McpAllowedTools,
    requireApproval: Config.McpRequireApproval,
  })
  .strict()
export type PluginRemoteRuntime = z.infer<typeof PluginRemoteRuntime>

export const PluginRuntimeTemplate = z.union([PluginStdioRuntime, PluginRemoteRuntime])
export type PluginRuntimeTemplate = z.infer<typeof PluginRuntimeTemplate>

export const PluginConnectorRuntimeTemplate = z.union([PluginStdioRuntime, PluginRemoteRuntime])
export type PluginConnectorRuntimeTemplate = z.infer<typeof PluginConnectorRuntimeTemplate>

export type ResolvedPluginConnectorRuntime =
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

const PluginDiagnosticTool = z
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

const PluginDiagnostic = z
  .object({
    serverID: z.string(),
    enabled: z.boolean(),
    ok: z.boolean(),
    toolCount: z.number(),
    toolNames: z.array(z.string()),
    tools: z.array(PluginDiagnosticTool),
    error: z.string().optional(),
  })
  .strict()
type PluginDiagnostic = z.infer<typeof PluginDiagnostic>

export const PluginMcpServerCatalogEntry = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    risk: PluginRisk.optional(),
    permissions: z.array(z.string()).optional(),
    tools: z.array(PluginToolPreview),
    configFields: z.array(PluginConfigField).optional(),
    runtime: PluginRuntimeTemplate,
    installReview: z.array(z.string()).optional(),
  })
  .strict()
export type PluginMcpServerCatalogEntry = z.infer<typeof PluginMcpServerCatalogEntry>

export const PluginSkillPreview = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    directory: z.string().min(1),
  })
  .strict()
export type PluginSkillPreview = z.infer<typeof PluginSkillPreview>

const PluginRegistrySkillPreview = PluginSkillPreview.omit({ id: true })
  .extend({
    id: z.string().min(1).optional(),
  })
  .strict()

export const PluginAppConnector = z
  .object({
    appID: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    connectorID: z.string().min(1).optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    icon: z.string().optional(),
    risk: PluginRisk.optional(),
    permissions: z.array(z.string()).optional(),
    tools: z.array(PluginToolPreview).optional(),
    configFields: z.array(PluginConfigField).optional(),
    credential: PluginAppCredential,
    runtime: PluginConnectorRuntimeTemplate,
    installReview: z.array(z.string()).optional(),
  })
  .strict()
  .transform((connector, ctx) => {
    const appID = connector.id ?? connector.connectorID ?? connector.appID
    if (!appID) {
      ctx.addIssue({
        code: "custom",
        message: "Plugin connector requires 'id' or legacy 'appID'.",
        path: ["id"],
      })
      return z.NEVER
    }

    return {
      ...connector,
      id: appID,
      appID,
    }
  })
export type PluginAppConnector = z.infer<typeof PluginAppConnector>

export const PluginConnectorStatus = z
  .object({
    pluginID: z.string().min(1),
    appID: z.string().min(1),
    connectorID: z.string().min(1),
    connected: z.boolean(),
    credentialKind: z.enum(["api_key", "oauth"]),
    authStatus: z.enum(["connected", "not_connected", "pending", "expired", "error"]),
    credentialLabel: z.string().optional(),
    account: ProviderAuth.ProviderAuthAccountSummary.optional(),
    email: z.string().optional(),
    expiresAt: z.number().optional(),
    activeFlow: ProviderAuth.ProviderAuthFlow.optional(),
    generatedMcpServerID: z.string().min(1),
    lastDiagnostic: PluginDiagnostic.optional(),
  })
  .strict()
export type PluginConnectorStatus = z.infer<typeof PluginConnectorStatus>

const PluginAuthor = z.union([
  z.string().min(1),
  z
    .object({
      name: z.string().min(1),
      email: z.string().optional(),
      url: z.string().optional(),
    })
    .passthrough(),
])

const PluginLocalizedText = z
  .object({
    "en-US": z.string().min(1).optional(),
    "zh-CN": z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => Boolean(value["en-US"] || value["zh-CN"]), {
    message: "Localized text requires at least one supported locale.",
  })
export type PluginLocalizedText = z.infer<typeof PluginLocalizedText>

const PluginLocalizableText = z.union([z.string().min(1), PluginLocalizedText])
type PluginLocalizableText = z.infer<typeof PluginLocalizableText>

const PluginCatalogLocalization = z
  .object({
    name: PluginLocalizedText.optional(),
    description: PluginLocalizedText.optional(),
    longDescription: PluginLocalizedText.optional(),
  })
  .strict()
export type PluginCatalogLocalization = z.infer<typeof PluginCatalogLocalization>

const PluginInterface = z
  .object({
    displayName: PluginLocalizableText.optional(),
    shortDescription: PluginLocalizableText.optional(),
    longDescription: PluginLocalizableText.optional(),
    developerName: z.string().optional(),
    category: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    websiteURL: z.string().optional(),
    privacyPolicyURL: z.string().optional(),
    termsOfServiceURL: z.string().optional(),
    defaultPrompt: z.union([z.string(), z.array(z.string())]).optional(),
    composerIcon: z.string().optional(),
    logo: z.string().optional(),
    iconUrl: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    heroImageUrl: z.string().optional(),
    screenshots: z.array(z.string()).optional(),
    brandColor: z.string().optional(),
  })
  .passthrough()
export type PluginInterface = z.infer<typeof PluginInterface>

const PluginManifestMcpServer = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    risk: PluginRisk.optional(),
    permissions: z.array(z.string()).optional(),
    tools: z.array(PluginToolPreview).optional(),
    configFields: z.array(PluginConfigField).optional(),
    runtime: PluginRuntimeTemplate,
    installReview: z.array(z.string()).optional(),
  })
  .strict()
type PluginManifestMcpServer = z.infer<typeof PluginManifestMcpServer>

export const PluginManifest = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().min(1),
    author: PluginAuthor.optional(),
    homepage: z.string().optional(),
    repository: z.string().optional(),
    license: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    interface: PluginInterface.optional(),
    mcpServers: z.array(PluginManifestMcpServer).optional(),
    skills: z.union([z.string(), z.array(z.string())]).optional(),
    connectorRequirements: z.array(Connector.ConnectorRequirement).optional(),
    connectors: z.array(PluginAppConnector).optional(),
    apps: z.array(PluginAppConnector).optional(),
    commands: z.union([z.string(), z.array(z.string())]).optional(),
    agents: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .strict()
export type PluginManifest = z.infer<typeof PluginManifest>

const PluginManifestDocument = PluginManifest.extend({
  id: z.string().min(1).optional(),
  package: PluginPackageDownload.optional(),
  skillPreviews: z.array(PluginRegistrySkillPreview).optional(),
}).strict()

const PluginAppCompatEntry = z
  .object({
    appID: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    icon: z.string().optional(),
    risk: PluginRisk.optional(),
    permissions: z.array(z.string()).optional(),
    tools: z.array(PluginToolPreview).optional(),
    credential: PluginAppCredential.optional(),
    oauth: PluginAppCompatOAuthCredential.optional(),
    runtime: PluginRemoteRuntime.optional(),
    installReview: z.array(z.string()).optional(),
  })
  .passthrough()

const PluginAppCompatFile = z
  .object({
    apps: z.record(z.string(), PluginAppCompatEntry),
  })
  .passthrough()

const PluginRegistryItem = PluginManifest.extend({
  id: z.string().min(1).optional(),
  package: PluginPackageDownload.optional(),
  skillPreviews: z.array(PluginRegistrySkillPreview).optional(),
}).strict()

const PluginRegistry = z
  .object({
    schemaVersion: z.literal(1),
    plugins: z.array(PluginRegistryItem),
  })
  .strict()

const PluginRegistryIndex = z.array(z.string().min(1))

export const PluginCatalogItem = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    longDescription: z.string().optional(),
    localized: PluginCatalogLocalization.optional(),
    version: z.string().min(1),
    publisher: z.string().min(1),
    category: PluginCategory,
    icon: z.string().optional(),
    iconUrl: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    heroImageUrl: z.string().optional(),
    screenshots: z.array(z.string()),
    tags: z.array(z.string()),
    brandColor: z.string().optional(),
    homepage: z.string().optional(),
    documentationUrl: z.string().optional(),
    risk: PluginRisk,
    permissions: z.array(z.string()),
    tools: z.array(PluginToolPreview),
    configFields: z.array(PluginConfigField),
    runtime: PluginRuntimeTemplate.optional(),
    mcpServers: z.array(PluginMcpServerCatalogEntry),
    skills: z.array(PluginSkillPreview),
    connectorRequirements: z.array(Connector.ConnectorRequirement),
    connectors: z.array(PluginAppConnector),
    apps: z.array(PluginAppConnector),
    installReview: z.array(z.string()).optional(),
    source: z.enum(["package", "registry"]).optional(),
    download: PluginPackageDownload.optional(),
    installable: z.boolean().optional(),
  })
  .strict()
export type PluginCatalogItem = z.infer<typeof PluginCatalogItem>

export const InstalledPlugin = z
  .object({
    pluginID: z.string().min(1),
    version: z.string().min(1),
    enabled: z.boolean(),
    mcpServerID: z.string().min(1).optional(),
    mcpServerIDs: z.array(z.string()).optional(),
    skillIDs: z.array(z.string()).optional(),
    connectorIDs: z.array(z.string()).optional(),
    connectorRequirementIDs: z.array(z.string()).optional(),
    config: z.record(z.string(), z.string()),
    installedAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
    lastDiagnostic: PluginDiagnostic.optional(),
    lastConnectorDiagnostics: z.record(z.string(), PluginDiagnostic).optional(),
    packageRoot: z.string().min(1).optional(),
    missingPackage: z.boolean().optional(),
  })
  .strict()
export type InstalledPlugin = Omit<
  z.infer<typeof InstalledPlugin>,
  "mcpServerIDs" | "skillIDs" | "connectorIDs" | "connectorRequirementIDs" | "lastConnectorDiagnostics"
> & {
  mcpServerIDs: string[]
  skillIDs: string[]
  connectorIDs: string[]
  connectorRequirementIDs: string[]
  lastConnectorDiagnostics?: Record<string, PluginDiagnostic>
}

export const InstallPluginInput = z
  .object({
    enabled: z.boolean().optional(),
    config: z.record(z.string(), z.string()).optional(),
  })
  .strict()
export type InstallPluginInput = z.infer<typeof InstallPluginInput>

export const UpdateInstalledPluginInput = z
  .object({
    enabled: z.boolean().optional(),
    config: z.record(z.string(), z.string()).optional(),
  })
  .strict()
export type UpdateInstalledPluginInput = z.infer<typeof UpdateInstalledPluginInput>

export const ImportPluginURLInput = z
  .object({
    url: z.string().min(1),
  })
  .strict()
export type ImportPluginURLInput = z.infer<typeof ImportPluginURLInput>

export const SavePluginConnectorApiKeyInput = z
  .object({
    apiKey: z.string().nullable().optional(),
  })
  .strict()
export type SavePluginConnectorApiKeyInput = z.infer<typeof SavePluginConnectorApiKeyInput>

let installedPluginsTableGeneration = -1

function ensureInstalledPluginsTable() {
  const generation = db.getDatabaseGeneration()
  if (installedPluginsTableGeneration === generation && generation > 0) return

  if (db.tableExists(INSTALLED_PLUGINS_TABLE)) {
    db.syncTableColumnsWithZodObject(INSTALLED_PLUGINS_TABLE, InstalledPlugin)
    installedPluginsTableGeneration = db.getDatabaseGeneration()
    return
  }

  const columns = zodObjectToColumnDefs(InstalledPlugin)
  columns.pluginID = withPrimaryKey(columns.pluginID)
  db.db.run(toCreateTableSQL(INSTALLED_PLUGINS_TABLE, columns))
  installedPluginsTableGeneration = db.getDatabaseGeneration()
}

function normalizePluginID(pluginID: string) {
  return normalizeManifestID(pluginID)
}

function normalizeManifestID(id: string) {
  return id.trim().toLowerCase()
}

function normalizeServerTemplateID(serverID: string | undefined) {
  const trimmed = serverID?.trim()
  return trimmed || "default"
}

function now() {
  return Date.now()
}

function uniqueStrings(items: Array<string | undefined>) {
  return [...new Set(items.map((item) => item?.trim()).filter((item): item is string => Boolean(item)))]
}

function displayAssetDataURL(packageRoot: string | undefined, value: string) {
  if (!packageRoot) return undefined
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) || isAbsolute(value)) return undefined

  const filePath = resolvePackageRelativePath(packageRoot, value)
  if (!filePath) return undefined

  const mimeType = PLUGIN_DISPLAY_ASSET_MIME_TYPES.get(extname(filePath).toLowerCase())
  if (!mimeType) return undefined

  try {
    const fileStat = lstatSync(filePath)
    if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > MAX_PLUGIN_DISPLAY_ASSET_BYTES) return undefined

    return `data:${mimeType};base64,${readFileSync(filePath).toString("base64")}`
  } catch {
    return undefined
  }
}

function displayAssetURL(value: string | undefined, packageRoot?: string) {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) return trimmed
  return displayAssetDataURL(packageRoot, trimmed)
}

function pluginRegistryCachePath() {
  const configured = getProcessEnvValue(PLUGIN_REGISTRY_CACHE_DIR_ENV)?.trim()
  return resolve(configured || join(Global.Path.data, dirname(PLUGIN_REGISTRY_CACHE_PATH)), "plugin-registry-cache.json")
}

function importedPluginRegistryPath() {
  const configured = getProcessEnvValue(PLUGIN_IMPORTED_REGISTRY_FILE_ENV)?.trim()
  return resolve(configured || join(Global.Path.data, PLUGIN_IMPORTED_REGISTRY_PATH))
}

function pluginRegistryIndexURL() {
  const configured = getProcessEnvValue(PLUGIN_REGISTRY_INDEX_URL_ENV)?.trim()
  if (configured && /^(off|none|disabled)$/i.test(configured)) return undefined
  return configured || DEFAULT_PLUGIN_REGISTRY_INDEX_URL
}

function assertHTTPSURL(rawUrl: string, label: string) {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new PluginError("PLUGIN_REGISTRY_UNAVAILABLE", `${label} is invalid.`)
  }

  if (url.protocol !== "https:") {
    throw new PluginError("PLUGIN_REGISTRY_UNAVAILABLE", `${label} must use https.`)
  }
  if (url.username || url.password) {
    throw new PluginError("PLUGIN_REGISTRY_UNAVAILABLE", `${label} must not contain credentials.`)
  }

  return url
}

function normalizeGitHubBlobURL(rawUrl: string) {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return rawUrl
  }

  if (url.hostname !== "github.com") return rawUrl
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments.length < 5 || segments[2] !== "blob") return rawUrl

  const [owner, repo, _blob, branch, ...pathSegments] = segments
  if (!owner || !repo || !branch || pathSegments.length === 0) return rawUrl

  return new URL(`${owner}/${repo}/${branch}/${pathSegments.join("/")}`, "https://raw.githubusercontent.com/").toString()
}

function normalizePluginRegistryEntryURL(rawUrl: string) {
  const url = assertHTTPSURL(normalizeGitHubBlobURL(rawUrl.trim()), "Plugin registry entry URL")
  if (url.search || url.hash) {
    throw new PluginError("PLUGIN_REGISTRY_UNAVAILABLE", "Plugin registry entry URL must not contain query parameters or fragments.")
  }
  if (!url.pathname.toLowerCase().endsWith(PLUGIN_MANIFEST_URL_SUFFIX)) {
    throw new PluginError("PLUGIN_REGISTRY_UNAVAILABLE", "Plugin registry entry URL must point to .anybox-plugin/plugin.json.")
  }
  return url.toString()
}

function riskWeight(risk: PluginRisk) {
  return ["low", "medium", "high", "critical"].indexOf(risk)
}

function highestRisk(items: Array<PluginRisk | undefined>) {
  return items.reduce<PluginRisk>((result, item) => {
    if (!item) return result
    return riskWeight(item) > riskWeight(result) ? item : result
  }, "low")
}

function normalizeCategory(category: string | undefined): PluginCategory {
  const value = category?.trim()
  if (value && PluginCategory.safeParse(value).success) return value as PluginCategory

  const normalized = value?.toLowerCase()
  if (normalized === "engineering" || normalized === "coding") return "Code"
  if (normalized === "productivity" || normalized === "documentation") return "Docs"

  return "Code"
}

function authorName(author: PluginManifest["author"]) {
  if (!author) return "Unknown"
  return typeof author === "string" ? author : author.name
}

function compareVersionIdentifier(left: string, right: string) {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined
  const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined

  if (leftNumber !== undefined && rightNumber !== undefined) {
    return leftNumber - rightNumber
  }

  if (leftNumber !== undefined) return -1
  if (rightNumber !== undefined) return 1
  return left.localeCompare(right)
}

function compareManifestVersions(left: string, right: string) {
  const [leftCore = "", leftPrerelease] = left.split("-", 2)
  const [rightCore = "", rightPrerelease] = right.split("-", 2)
  const leftParts = leftCore.split(".").map((part) => Number(part) || 0)
  const rightParts = rightCore.split(".").map((part) => Number(part) || 0)
  const partCount = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < partCount; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }

  if (!leftPrerelease && rightPrerelease) return 1
  if (leftPrerelease && !rightPrerelease) return -1
  if (!leftPrerelease && !rightPrerelease) return 0

  const leftIdentifiers = leftPrerelease!.split(".")
  const rightIdentifiers = rightPrerelease!.split(".")
  const identifierCount = Math.max(leftIdentifiers.length, rightIdentifiers.length)
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = leftIdentifiers[index]
    const rightIdentifier = rightIdentifiers[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    const difference = compareVersionIdentifier(leftIdentifier, rightIdentifier)
    if (difference !== 0) return difference
  }

  return 0
}

function safeReadPluginAppCompat(packageRoot: string): PluginAppConnector[] {
  const appPath = join(packageRoot, PLUGIN_APP_COMPAT_PATH)
  if (!existsSync(appPath)) return []

  try {
    const raw = readFileSync(appPath, "utf8")
    const parsed = PluginAppCompatFile.parse(JSON.parse(raw))
    return Object.entries(parsed.apps).flatMap(([appID, entry]) => {
      const credential = entry.credential ?? entry.oauth
      if (!credential || !entry.runtime) return []

      const app = PluginAppConnector.safeParse({
        appID: entry.appID ?? appID,
        name: entry.name ?? appID,
        description: entry.description,
        icon: entry.icon,
        risk: entry.risk,
        permissions: entry.permissions,
        tools: entry.tools,
        credential,
        runtime: entry.runtime,
        installReview: entry.installReview,
      })
      return app.success ? [app.data] : []
    })
  } catch {
    return []
  }
}

function normalizePluginConnectors(manifest: PluginManifest): PluginAppConnector[] {
  const connectors = manifest.connectors ?? []
  const legacyApps = manifest.apps ?? []
  if (connectors.length === 0) return legacyApps

  const connectorIDs = new Set(connectors.map((connector) => connector.appID))
  return [
    ...connectors,
    ...legacyApps.filter((app) => !connectorIDs.has(app.appID)),
  ]
}

function parsePluginManifestDocument(input: unknown) {
  const parsed = PluginManifestDocument.parse(input)
  const pluginID = normalizeManifestID(parsed.id ?? parsed.name)
  const { id: _id, package: download, skillPreviews, ...manifestInput } = parsed
  const manifest = PluginManifest.parse({
    ...manifestInput,
    name: pluginID,
  })

  return {
    manifest,
    download,
    skillPreviews: normalizeRegistrySkillPreviews(pluginID, skillPreviews),
  }
}

const REMOTE_DISPLAY_ASSET_FIELDS = [
  "composerIcon",
  "logo",
  "iconUrl",
  "thumbnailUrl",
  "heroImageUrl",
] as const

function isResolvableRemoteAssetReference(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false
  if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("/")) return true
  if (trimmed.includes("/") || trimmed.includes("\\")) return true

  return PLUGIN_DISPLAY_ASSET_MIME_TYPES.has(extname(trimmed).toLowerCase())
}

function resolveRemoteAssetReference(value: string | undefined, manifestURL: string) {
  const trimmed = value?.trim()
  if (!trimmed || !isResolvableRemoteAssetReference(trimmed)) return value

  try {
    const packageRootURL = new URL("../", manifestURL)
    return new URL(trimmed, packageRootURL).toString()
  } catch {
    return value
  }
}

function resolveRemoteManifestAssets(manifest: PluginManifest, manifestURL: string) {
  const interfaceMetadata = manifest.interface
  if (!interfaceMetadata) return manifest

  const resolvedInterface: PluginInterface = { ...interfaceMetadata }
  let changed = false
  for (const field of REMOTE_DISPLAY_ASSET_FIELDS) {
    const current = resolvedInterface[field]
    if (typeof current !== "string") continue
    const resolved = resolveRemoteAssetReference(current, manifestURL)
    if (resolved && resolved !== current) {
      resolvedInterface[field] = resolved
      changed = true
    }
  }

  if (Array.isArray(resolvedInterface.screenshots)) {
    const screenshots = resolvedInterface.screenshots.map((screenshot) =>
      resolveRemoteAssetReference(screenshot, manifestURL) ?? screenshot
    )
    if (screenshots.some((screenshot, index) => screenshot !== resolvedInterface.screenshots?.[index])) {
      resolvedInterface.screenshots = screenshots
      changed = true
    }
  }

  return changed
    ? PluginManifest.parse({
      ...manifest,
      interface: resolvedInterface,
    })
    : manifest
}

function safeReadPluginManifest(packageRoot: string) {
  const manifestPath = join(packageRoot, PLUGIN_MANIFEST_PATH)
  if (!existsSync(manifestPath)) return undefined

  try {
    const raw = readFileSync(manifestPath, "utf8")
    const { manifest } = parsePluginManifestDocument(JSON.parse(raw))
    const manifestConnectors = normalizePluginConnectors(manifest)
    const compatApps = safeReadPluginAppCompat(packageRoot)
    if (compatApps.length === 0) {
      return {
        ...manifest,
        connectors: manifestConnectors,
        apps: manifestConnectors,
      }
    }

    const appIDs = new Set(manifestConnectors.map((app) => app.appID))
    const connectors = [
      ...manifestConnectors,
      ...compatApps.filter((app) => !appIDs.has(app.appID)),
    ]
    return {
      ...manifest,
      connectors,
      apps: connectors,
    }
  } catch {
    return undefined
  }
}

function moduleRoot() {
  return dirname(fileURLToPath(import.meta.url))
}

function installedPluginPackagesRoot() {
  const configured = getProcessEnvValue(PLUGIN_INSTALL_DIR_ENV)?.trim()
  return resolve(configured || join(Global.Path.data, "plugins", "installed"))
}

function localPluginPackagesRoot() {
  const configured = getProcessEnvValue(PLUGIN_LOCAL_DIR_ENV)?.trim()
  return resolve(configured || join(Global.Path.data, "plugins", "local"))
}

function packageSearchRoots() {
  const root = moduleRoot()
  const roots: Array<{ root: string; managedInstall: boolean }> = [
    {
      root: resolve(root, "..", "..", BUILTIN_PLUGIN_PACKAGE_PATH),
      managedInstall: false,
    },
    {
      root: resolve(root, "..", "..", "..", "..", WORKSPACE_PLUGIN_PACKAGE_PATH),
      managedInstall: false,
    },
    {
      root: localPluginPackagesRoot(),
      managedInstall: false,
    },
    {
      root: installedPluginPackagesRoot(),
      managedInstall: true,
    },
  ]

  const seen = new Set<string>()
  return roots.flatMap((entry) => {
    const root = resolve(entry.root)
    if (seen.has(root)) return []
    seen.add(root)
    return [{ root, managedInstall: entry.managedInstall }]
  })
}

function readPackageManifestsFromRoot(root: string, managedInstall: boolean) {
  if (!existsSync(root)) return []

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const packageRoot = join(root, entry.name)
      const sources: PluginManifestSource[] = []
      const manifest = safeReadPluginManifest(packageRoot)
      if (manifest) {
        sources.push({ manifest, packageRoot, managedInstall, source: "package" })
      }

      const versionedSources = readdirSync(packageRoot, { withFileTypes: true })
        .filter((child) => child.isDirectory() && !child.name.startsWith("."))
        .flatMap((child) => {
          const versionRoot = join(packageRoot, child.name)
          const versionManifest = safeReadPluginManifest(versionRoot)
          return versionManifest ? [{ manifest: versionManifest, packageRoot: versionRoot, managedInstall, source: "package" as const }] : []
        })

      sources.push(...versionedSources)
      return sources
    })
}

function registryFilePaths() {
  const root = moduleRoot()
  const files = [
    join(root, PLUGIN_REGISTRY_PATH),
    resolve(root, "..", "..", PLUGIN_REGISTRY_PATH),
  ]

  const configured = getProcessEnvValue(PLUGIN_REGISTRY_FILES_ENV)?.trim()
  if (configured) {
    files.push(...configured.split(delimiter).map((entry) => entry.trim()).filter(Boolean))
  }

  return uniqueStrings(files.map((filePath) => resolve(filePath))).filter((filePath) => existsSync(filePath))
}

function safeReadPluginRegistry(filePath: string) {
  try {
    const raw = readFileSync(filePath, "utf8")
    return PluginRegistry.parse(JSON.parse(raw))
  } catch {
    return undefined
  }
}

async function fetchJSONWithSchema<T>(
  url: string,
  schema: z.ZodType<T>,
  maxBytes: number,
  label: string,
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PLUGIN_REGISTRY_FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Anybox-Plugin-Registry",
      },
      signal: controller.signal,
    }).catch((error) => {
      throw new PluginError(
        "PLUGIN_REGISTRY_UNAVAILABLE",
        error instanceof Error ? `${label} could not be loaded: ${error.message}` : `${label} could not be loaded.`,
      )
    })

    if (!response.ok) {
      throw new PluginError("PLUGIN_REGISTRY_UNAVAILABLE", `${label} returned HTTP ${response.status}.`)
    }

    const declaredLength = Number(response.headers.get("content-length") ?? "0")
    if (declaredLength > maxBytes) {
      throw new PluginError("PLUGIN_REGISTRY_UNAVAILABLE", `${label} is larger than the allowed size.`)
    }

    const text = await response.text()
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new PluginError("PLUGIN_REGISTRY_UNAVAILABLE", `${label} is larger than the allowed size.`)
    }

    return schema.parse(JSON.parse(text))
  } catch (error) {
    if (error instanceof PluginError) throw error
    throw new PluginError(
      "PLUGIN_REGISTRY_UNAVAILABLE",
      error instanceof Error ? `${label} is invalid: ${error.message}` : `${label} is invalid.`,
    )
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeRegistrySkillPreviews(pluginID: string, previews: z.infer<typeof PluginRegistrySkillPreview>[] | undefined) {
  return (previews ?? []).map((preview) =>
    PluginSkillPreview.parse({
      id: preview.id ?? skillIDForPlugin(pluginID, preview.directory),
      name: preview.name,
      description: preview.description,
      directory: preview.directory,
    }),
  )
}

function registryItemToManifestSource(item: z.infer<typeof PluginRegistryItem>, manifestURL?: string): PluginManifestSource {
  const parsed = parsePluginManifestDocument(item)
  const manifest = manifestURL
    ? resolveRemoteManifestAssets(parsed.manifest, manifestURL)
    : parsed.manifest

  return {
    manifest,
    download: parsed.download,
    skillPreviews: parsed.skillPreviews,
    source: "registry",
  }
}

function sourceToRegistryItem(source: PluginManifestSource) {
  return PluginRegistryItem.parse({
    id: normalizeManifestID(source.manifest.name),
    ...source.manifest,
    package: source.download,
    skillPreviews: source.skillPreviews,
  })
}

async function fetchRegistryIndex() {
  const indexURL = pluginRegistryIndexURL()
  if (!indexURL) return []

  const url = assertHTTPSURL(indexURL, "Plugin registry index URL").toString()
  const entries = await fetchJSONWithSchema(url, PluginRegistryIndex, MAX_PLUGIN_REGISTRY_INDEX_BYTES, "Plugin registry index")
  if (entries.length > MAX_REMOTE_PLUGIN_META_COUNT) {
    throw new PluginError("PLUGIN_REGISTRY_UNAVAILABLE", "Plugin registry index contains too many plugin URLs.")
  }

  return uniqueStrings(entries.map(normalizePluginRegistryEntryURL))
}

async function fetchPluginMeta(manifestURL: string) {
  const item = await fetchJSONWithSchema(
    manifestURL,
    PluginRegistryItem,
    MAX_PLUGIN_META_BYTES,
    "Plugin metadata",
  )
  return registryItemToManifestSource(item, manifestURL)
}

function listCachedRemoteRegistryManifestSources() {
  const registry = safeReadPluginRegistry(pluginRegistryCachePath())
  if (!registry) return []
  return registry.plugins.map(registryItemToManifestSource)
}

async function writeRemoteRegistryCache(sources: PluginManifestSource[]) {
  const filePath = pluginRegistryCachePath()
  const registry = PluginRegistry.parse({
    schemaVersion: 1,
    plugins: sources.map(sourceToRegistryItem),
  })
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(registry, null, 2)}\n`)
}

async function listRemoteRegistryManifestSources() {
  const indexURL = pluginRegistryIndexURL()
  if (!indexURL) return listCachedRemoteRegistryManifestSources()

  try {
    const baseURLs = await fetchRegistryIndex()
    const settled = await Promise.allSettled(baseURLs.map((baseURL) => fetchPluginMeta(baseURL)))
    const sources = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
    if (baseURLs.length > 0 && sources.length === 0) {
      throw new PluginError("PLUGIN_REGISTRY_UNAVAILABLE", "Plugin registry did not return any valid plugin metadata.")
    }
    await writeRemoteRegistryCache(sources)
    return sources
  } catch (error) {
    const cached = listCachedRemoteRegistryManifestSources()
    if (cached.length > 0) return cached
    if (error instanceof PluginError) throw error
    throw new PluginError(
      "PLUGIN_REGISTRY_UNAVAILABLE",
      error instanceof Error ? error.message : "Plugin registry could not be loaded.",
    )
  }
}

function listRegistryManifestSources() {
  const byID = new Map<string, PluginManifestSource>()

  for (const filePath of registryFilePaths()) {
    const registry = safeReadPluginRegistry(filePath)
    if (!registry) continue

    for (const item of registry.plugins) {
      const source = registryItemToManifestSource(item)
      byID.set(normalizeManifestID(source.manifest.name), source)
    }
  }

  return [...byID.values()]
}

function listImportedRegistryManifestSources() {
  const registry = safeReadPluginRegistry(importedPluginRegistryPath())
  return registry ? registry.plugins.map(registryItemToManifestSource) : []
}

async function writeImportedRegistryManifestSources(sources: PluginManifestSource[]) {
  const filePath = importedPluginRegistryPath()
  const registry = PluginRegistry.parse({
    schemaVersion: 1,
    plugins: sources.map(sourceToRegistryItem),
  })
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(registry, null, 2)}\n`)
}

function listPackageManifestSources() {
  const byID = new Map<string, PluginManifestSource>()
  for (const entry of packageSearchRoots()) {
    const byRootID = new Map<string, PluginManifestSource>()
    for (const source of readPackageManifestsFromRoot(entry.root, entry.managedInstall)) {
      const pluginID = normalizeManifestID(source.manifest.name)
      const existing = byRootID.get(pluginID)
      if (!existing || compareManifestVersions(source.manifest.version, existing.manifest.version) > 0) {
        byRootID.set(pluginID, source)
      }
    }

    for (const [pluginID, source] of byRootID) {
      byID.set(pluginID, source)
    }
  }

  return [...byID.values()]
}

function mergeLocalizableText(
  value: PluginLocalizableText | undefined,
  fallback: PluginLocalizableText | undefined,
): PluginLocalizableText | undefined {
  if (!fallback || typeof fallback === "string") return value
  if (!value) return fallback
  if (typeof value === "string") {
    return fallback["zh-CN"] ? {
      "en-US": value,
      "zh-CN": fallback["zh-CN"],
    } : value
  }

  return {
    "en-US": value["en-US"] ?? fallback["en-US"],
    "zh-CN": value["zh-CN"] ?? fallback["zh-CN"],
  }
}

function mergeManifestSourceLocalization(source: PluginManifestSource, fallback: PluginManifestSource | undefined) {
  if (!fallback?.manifest.interface) return source

  const interfaceMetadata = source.manifest.interface
  const fallbackInterface = fallback.manifest.interface
  const mergedInterface = {
    ...fallbackInterface,
    ...interfaceMetadata,
    displayName: mergeLocalizableText(interfaceMetadata?.displayName, fallbackInterface.displayName),
    shortDescription: mergeLocalizableText(interfaceMetadata?.shortDescription, fallbackInterface.shortDescription),
    longDescription: mergeLocalizableText(interfaceMetadata?.longDescription, fallbackInterface.longDescription),
  }

  return {
    ...source,
    manifest: PluginManifest.parse({
      ...source.manifest,
      interface: mergedInterface,
    }),
  }
}

function mergeManifestSources(...groups: PluginManifestSource[][]) {
  const byID = new Map<string, PluginManifestSource>()
  for (const group of groups) {
    for (const source of group) {
      const pluginID = normalizeManifestID(source.manifest.name)
      byID.set(pluginID, mergeManifestSourceLocalization(source, byID.get(pluginID)))
    }
  }
  return [...byID.values()]
}

function listManifestSources() {
  return mergeManifestSources(
    listRegistryManifestSources(),
    listCachedRemoteRegistryManifestSources(),
    listImportedRegistryManifestSources(),
    listPackageManifestSources(),
  )
}

async function listManifestSourcesFresh() {
  const localRegistrySources = listRegistryManifestSources()
  const importedRegistrySources = listImportedRegistryManifestSources()
  const packageSources = listPackageManifestSources()
  let remoteRegistrySources: PluginManifestSource[] = []
  try {
    remoteRegistrySources = await listRemoteRegistryManifestSources()
  } catch (error) {
    if (localRegistrySources.length === 0 && importedRegistrySources.length === 0 && packageSources.length === 0) {
      throw error
    }
  }

  return mergeManifestSources(
    localRegistrySources,
    remoteRegistrySources,
    importedRegistrySources,
    packageSources,
  )
}

function getPackageManifestSource(pluginID: string, options: { managedInstallOnly?: boolean } = {}) {
  const normalizedPluginID = normalizePluginID(pluginID)
  return listPackageManifestSources()
    .filter((entry) => !options.managedInstallOnly || entry.managedInstall)
    .find((entry) => normalizeManifestID(entry.manifest.name) === normalizedPluginID)
}

async function getRegistryManifestSource(pluginID: string) {
  const normalizedPluginID = normalizePluginID(pluginID)
  const localRegistrySources = listRegistryManifestSources()
  const importedRegistrySources = listImportedRegistryManifestSources()
  let remoteRegistrySources: PluginManifestSource[] = []
  try {
    remoteRegistrySources = await listRemoteRegistryManifestSources()
  } catch (error) {
    if (localRegistrySources.length === 0 && importedRegistrySources.length === 0) throw error
  }
  const sources = mergeManifestSources(localRegistrySources, remoteRegistrySources, importedRegistrySources)
  return sources.find((entry) => normalizeManifestID(entry.manifest.name) === normalizedPluginID)
}

function skillIDForPlugin(pluginID: string, directoryName: string) {
  return `plugin:${pluginID}:${directoryName}`
}

function skillDirectoryDeclarations(manifest: PluginManifest) {
  const declaration = manifest.skills ?? DEFAULT_SKILLS_DIRECTORY
  return Array.isArray(declaration) ? declaration : [declaration]
}

function resolvePackageRelativePath(packageRoot: string, relativePath: string) {
  const resolved = resolve(packageRoot, relativePath)
  const normalizedRoot = resolve(packageRoot)
  const relativePathFromRoot = relative(normalizedRoot, resolved)
  if (relativePathFromRoot.startsWith("..") || isAbsolute(relativePathFromRoot)) {
    return undefined
  }

  return resolved
}

function firstParagraph(markdown: string) {
  for (const section of markdown.split(/\r?\n\s*\r?\n/)) {
    const collapsed = section
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/^#+\s*/, "")
      .trim()
    if (collapsed) return collapsed
  }

  return ""
}

function discoverSkillPreviews(pluginID: string, manifest: PluginManifest, packageRoot?: string): PluginSkillPreview[] {
  if (!packageRoot) return []

  return skillDirectoryDeclarations(manifest).flatMap((directory) => {
    const root = resolvePackageRelativePath(packageRoot, directory)
    if (!root || !existsSync(root)) return []

    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const skillPath = join(root, entry.name, "SKILL.md")
        if (!existsSync(skillPath)) return []

        const raw = readFileSync(skillPath, "utf8")
        const parsed = matter(raw)
        const frontmatter = parsed.data as { name?: unknown; description?: unknown }
        const name = typeof frontmatter.name === "string" && frontmatter.name.trim()
          ? frontmatter.name.trim()
          : entry.name
        const description = typeof frontmatter.description === "string" && frontmatter.description.trim()
          ? frontmatter.description.trim()
          : firstParagraph(parsed.content) || name

        return [{
          id: skillIDForPlugin(pluginID, entry.name),
          name,
          description,
          directory: entry.name,
        }]
      })
  })
}

function normalizeMcpServers(manifest: PluginManifest): PluginMcpServerCatalogEntry[] {
  return (manifest.mcpServers ?? []).map((server) => {
    const serverID = normalizeServerTemplateID(server.id)
    return PluginMcpServerCatalogEntry.parse({
      id: serverID,
      name: server.name ?? defaultLocalizableText(manifest.interface?.displayName, manifest.name),
      description: server.description ?? manifest.description,
      risk: server.risk ?? "medium",
      permissions: server.permissions ?? [],
      tools: server.tools ?? [],
      configFields: server.configFields ?? [],
      runtime: server.runtime,
      installReview: server.installReview ?? [],
    })
  })
}

function defaultLocalizableText(value: PluginLocalizableText | undefined, fallback: string) {
  if (!value) return fallback
  if (typeof value === "string") return value
  return value["en-US"] ?? fallback ?? value["zh-CN"]
}

function localizableTextMap(value: PluginLocalizableText | undefined) {
  if (!value || typeof value === "string") return undefined

  const localized: Partial<Record<keyof PluginLocalizedText, string>> = {}
  if (value["en-US"]) localized["en-US"] = value["en-US"]
  if (value["zh-CN"]) localized["zh-CN"] = value["zh-CN"]

  return Object.keys(localized).length > 0 ? localized : undefined
}

function catalogLocalization(manifest: PluginManifest) {
  const localized: PluginCatalogLocalization = {}
  const name = localizableTextMap(manifest.interface?.displayName)
  const description = localizableTextMap(manifest.interface?.shortDescription)
  const longDescription = localizableTextMap(manifest.interface?.longDescription)

  if (name) localized.name = name
  if (description) localized.description = description
  if (longDescription) localized.longDescription = longDescription

  return Object.keys(localized).length > 0 ? localized : undefined
}

function normalizeCatalogItem(source: PluginManifestSource): PluginCatalogItem {
  const { manifest, packageRoot } = source
  const pluginID = normalizeManifestID(manifest.name)
  const mcpServers = normalizeMcpServers(manifest)
  const connectors = normalizePluginConnectors(manifest)
  const connectorRequirements = manifest.connectorRequirements ?? []
  const skills = packageRoot
    ? discoverSkillPreviews(pluginID, manifest, packageRoot)
    : source.skillPreviews ?? []
  const icon = manifest.interface?.logo ?? manifest.interface?.composerIcon
  const iconUrl = displayAssetURL(manifest.interface?.iconUrl, packageRoot) ??
    displayAssetURL(manifest.interface?.logo, packageRoot) ??
    displayAssetURL(manifest.interface?.composerIcon, packageRoot)
  const thumbnailUrl = displayAssetURL(manifest.interface?.thumbnailUrl, packageRoot) ??
    displayAssetURL(manifest.interface?.heroImageUrl, packageRoot)
  const heroImageUrl = displayAssetURL(manifest.interface?.heroImageUrl, packageRoot) ?? thumbnailUrl
  const screenshots = uniqueStrings((manifest.interface?.screenshots ?? []).map((screenshot) =>
    displayAssetURL(screenshot, packageRoot)
  ))
  const risk = highestRisk([
    ...mcpServers.map((server) => server.risk),
    ...connectors.map((app) => app.risk ?? "medium"),
    connectorRequirements.length > 0 ? "medium" : undefined,
    skills.length > 0 ? "low" : undefined,
  ])

  return PluginCatalogItem.parse({
    id: pluginID,
    name: defaultLocalizableText(manifest.interface?.displayName, manifest.name),
    description: defaultLocalizableText(manifest.interface?.shortDescription, manifest.description),
    longDescription: defaultLocalizableText(manifest.interface?.longDescription, manifest.description),
    localized: catalogLocalization(manifest),
    version: manifest.version,
    publisher: manifest.interface?.developerName ?? authorName(manifest.author),
    category: normalizeCategory(manifest.interface?.category),
    icon,
    iconUrl,
    thumbnailUrl,
    heroImageUrl,
    screenshots,
    tags: uniqueStrings([...(manifest.keywords ?? []), ...(manifest.interface?.capabilities ?? [])]),
    brandColor: manifest.interface?.brandColor,
    homepage: manifest.homepage ?? manifest.interface?.websiteURL,
    documentationUrl: manifest.repository ?? manifest.homepage ?? manifest.interface?.websiteURL,
    risk,
    permissions: uniqueStrings([
      ...mcpServers.flatMap((server) => server.permissions ?? []),
      ...connectorRequirements.flatMap((requirement) => requirement.permissions ?? []),
      ...connectors.flatMap((app) => app.permissions ?? []),
    ]),
    tools: [
      ...mcpServers.flatMap((server) => server.tools),
      ...connectors.flatMap((app) => app.tools ?? []),
    ],
    configFields: dedupeConfigFields([
      ...mcpServers.flatMap((server) => server.configFields ?? []),
      ...connectors.flatMap((app) => app.configFields ?? []),
    ]),
    runtime: mcpServers[0]?.runtime,
    mcpServers,
    skills,
    connectorRequirements,
    connectors,
    apps: connectors,
    installReview: uniqueStrings([
      ...mcpServers.flatMap((server) => server.installReview ?? []),
      ...connectors.flatMap((app) => app.installReview ?? []),
    ]),
    source: source.source,
    download: source.download,
    installable: Boolean(packageRoot || (source.download?.url && source.download.sha256)),
  })
}

function dedupeConfigFields(fields: PluginConfigField[]) {
  const byKey = new Map<string, PluginConfigField>()
  for (const field of fields) {
    if (!byKey.has(field.key)) byKey.set(field.key, field)
  }
  return [...byKey.values()]
}

function listCatalogInternal(sources = listManifestSources()) {
  return sources.map(normalizeCatalogItem)
}

export function mcpServerIDForPlugin(pluginID: string, serverID?: string) {
  const normalizedPluginID = normalizePluginID(pluginID)
  const normalizedServerID = normalizeServerTemplateID(serverID)
  return normalizedServerID === "default"
    ? `plugin.${normalizedPluginID}`
    : `plugin.${normalizedPluginID}.${normalizedServerID}`
}

export function connectorIDForPluginApp(pluginID: string, appID: string) {
  return connectorIDForPluginConnector(pluginID, appID)
}

export function connectorIDForPluginConnector(pluginID: string, connectorID: string) {
  return `${PLUGIN_CONNECTOR_PREFIX}${normalizePluginID(pluginID)}:${connectorID.trim()}`
}

function legacyConnectorIDForPluginApp(pluginID: string, appID: string) {
  return `${PLUGIN_APP_CONNECTOR_PREFIX}${normalizePluginID(pluginID)}:${appID.trim()}`
}

export function mcpServerIDForPluginApp(pluginID: string, appID: string) {
  return mcpServerIDForPluginConnector(pluginID, appID)
}

export function mcpServerIDForPluginConnector(pluginID: string, connectorID: string) {
  return `plugin.${normalizePluginID(pluginID)}.connector.${connectorID.trim()}`
}

function legacyMcpServerIDForPluginApp(pluginID: string, appID: string) {
  return `plugin.${normalizePluginID(pluginID)}.app.${appID.trim()}`
}

function parsePluginConnectorID(connectorID: string) {
  const legacy = connectorID.startsWith(PLUGIN_APP_CONNECTOR_PREFIX)
  const current = connectorID.startsWith(PLUGIN_CONNECTOR_PREFIX)
  if (!legacy && !current) return undefined
  const rest = connectorID.slice((legacy ? PLUGIN_APP_CONNECTOR_PREFIX : PLUGIN_CONNECTOR_PREFIX).length)
  const separator = rest.indexOf(":")
  if (separator <= 0 || separator === rest.length - 1) return undefined

  return {
    legacy,
    pluginID: rest.slice(0, separator),
    appID: rest.slice(separator + 1),
  }
}

function pluginConnectorCredentialIDs(pluginID: string, appID: string) {
  return {
    primary: connectorIDForPluginConnector(pluginID, appID),
    legacy: legacyConnectorIDForPluginApp(pluginID, appID),
  }
}

function assertCatalogPlugin(pluginID: string) {
  const normalizedPluginID = normalizePluginID(pluginID)
  const item = listCatalogInternal().find((entry) => entry.id === normalizedPluginID)
  if (!item) {
    throw new PluginError("PLUGIN_NOT_FOUND", `Plugin '${pluginID}' was not found in the curated catalog.`)
  }

  if (item.risk === "critical") {
    throw new PluginError("PLUGIN_RISK_NOT_ALLOWED", `Plugin '${pluginID}' has a risk level that is not allowed.`)
  }

  return item
}

function assertPackagePlugin(pluginID: string) {
  const normalizedPluginID = normalizePluginID(pluginID)
  const source = getPackageManifestSource(normalizedPluginID)
  if (!source) {
    throw new PluginError(
      "PLUGIN_PACKAGE_UNAVAILABLE",
      `Plugin '${pluginID}' is not downloaded locally. Install it from the plugin catalog first.`,
    )
  }

  const item = normalizeCatalogItem(source)
  if (item.risk === "critical") {
    throw new PluginError("PLUGIN_RISK_NOT_ALLOWED", `Plugin '${pluginID}' has a risk level that is not allowed.`)
  }

  return item
}

function assertPluginApp(plugin: PluginCatalogItem, appID: string) {
  const app = plugin.apps.find((item) => item.appID === appID.trim())
  if (!app) {
    throw new PluginError("PLUGIN_CONNECTOR_NOT_FOUND", `Plugin '${plugin.id}' does not declare app '${appID}'.`)
  }

  return app
}

function assertApiKeyAppCredential(app: PluginAppConnector): PluginApiKeyAppCredential {
  if (app.credential.kind !== "api_key") {
    throw new PluginError("PLUGIN_CONNECTOR_NOT_FOUND", `${app.name} does not use API key authentication.`)
  }
  return app.credential
}

function assertOAuthAppCredential(app: PluginAppConnector): PluginOAuthAppCredential {
  if (app.credential.kind !== "oauth") {
    throw new PluginError("PLUGIN_CONNECTOR_NOT_FOUND", `${app.name} does not use OAuth authentication.`)
  }
  return app.credential
}

function replaceStringArrayPlaceholders(values: string[], config: Record<string, string>) {
  return values.map((value) => replacePlaceholders(value, config).trim()).filter(Boolean)
}

function oauthConfigForCredential(
  credential: PluginOAuthAppCredential,
  config: Record<string, string> = {},
): ProviderAuth.GenericOAuthProviderConfig {
  return {
    label: replacePlaceholders(credential.label, config),
    clientID: replaceOptionalPlaceholders(credential.clientID, config),
    clientSecret: replaceOptionalPlaceholders(credential.clientSecret, config),
    authorizationURL: replacePlaceholders(credential.authorizationURL, config),
    tokenURL: replacePlaceholders(credential.tokenURL, config),
    scopes: replaceStringArrayPlaceholders(credential.scopes, config),
    revocationURL: replaceOptionalPlaceholders(credential.revocationURL, config),
    authorizationParams: replaceRecordPlaceholders(credential.authorizationParams, config),
    tokenParams: replaceRecordPlaceholders(credential.tokenParams, config),
    tokenEndpointAuthMethod: credential.tokenEndpointAuthMethod,
    registration: credential.registration
      ? {
          registrationURL: replacePlaceholders(credential.registration.registrationURL, config),
          initialAccessToken: replaceOptionalPlaceholders(credential.registration.initialAccessToken, config),
          metadata: replaceUnknownRecordPlaceholders(credential.registration.metadata, config),
        }
      : undefined,
  }
}

function oauthMethodForApp(_app: PluginAppConnector) {
  return "oauth"
}

async function getActivePluginConnectorCredential(pluginID: string, appID: string) {
  const ids = pluginConnectorCredentialIDs(pluginID, appID)
  const primary = await Auth.getActiveProviderCredential(ids.primary)
  if (primary) return { connectorID: ids.primary, ...primary }

  const legacy = await Auth.getActiveProviderCredential(ids.legacy)
  return legacy ? { connectorID: ids.legacy, ...legacy } : undefined
}

async function getPluginConnectorRecord(pluginID: string, appID: string) {
  const ids = pluginConnectorCredentialIDs(pluginID, appID)
  return await Auth.getProviderRecord(ids.primary) ?? await Auth.getProviderRecord(ids.legacy)
}

function normalizeInstalledRecord(record: z.infer<typeof InstalledPlugin> | null | undefined): InstalledPlugin | null {
  if (!record) return null
  const packageSource = getPackageManifestSource(record.pluginID, { managedInstallOnly: true })
  const mcpServerIDs = uniqueStrings([...(record.mcpServerIDs ?? []), record.mcpServerID])
  const skillIDs = uniqueStrings(record.skillIDs ?? [])
  const connectorIDs = uniqueStrings(record.connectorIDs ?? [])
  const connectorRequirementIDs = uniqueStrings(record.connectorRequirementIDs ?? [])

  return {
    ...record,
    mcpServerID: record.mcpServerID ?? mcpServerIDs[0],
    mcpServerIDs,
    skillIDs,
    connectorIDs,
    connectorRequirementIDs,
    lastConnectorDiagnostics: record.lastConnectorDiagnostics ?? {},
    packageRoot: packageSource?.packageRoot,
    missingPackage: !packageSource,
  }
}

function readInstalled(pluginID: string) {
  ensureInstalledPluginsTable()
  return normalizeInstalledRecord(
    db.findById(INSTALLED_PLUGINS_TABLE, InstalledPlugin, normalizePluginID(pluginID), "pluginID"),
  )
}

function requiredConfigValue(plugin: PluginCatalogItem, config: Record<string, string>, field: PluginConfigField) {
  const explicitValue = config[field.key]?.trim()
  if (explicitValue) return explicitValue

  const defaultValue = field.defaultValue?.trim()
  if (defaultValue) return defaultValue

  if (field.required) {
    throw new PluginError("PLUGIN_CONFIG_INVALID", `${plugin.name} requires '${field.label}'.`)
  }

  return ""
}

function normalizeConfig(plugin: PluginCatalogItem, config: Record<string, string> | undefined) {
  const raw = config ?? {}
  const normalized: Record<string, string> = {}
  for (const field of plugin.configFields) {
    const value = requiredConfigValue(plugin, raw, field)
    if (value) {
      normalized[field.key] = value
    }
  }

  for (const [key, value] of Object.entries(raw)) {
    if (!key.trim()) continue
    if (normalized[key] !== undefined) continue
    normalized[key] = value
  }

  return normalized
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

function replaceUnknownPlaceholders(value: unknown, config: Record<string, string>): unknown {
  if (typeof value === "string") return replacePlaceholders(value, config)
  if (Array.isArray(value)) return value.map((item) => replaceUnknownPlaceholders(item, config))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, replaceUnknownPlaceholders(item, config)]),
    )
  }

  return value
}

function replaceUnknownRecordPlaceholders(record: Record<string, unknown> | undefined, config: Record<string, string>) {
  if (!record) return undefined

  const replaced = replaceUnknownPlaceholders(record, config)
  return replaced && typeof replaced === "object" && !Array.isArray(replaced)
    ? replaced as Record<string, unknown>
    : undefined
}

function runtimeConfigForPlugin(plugin: PluginCatalogItem, installed: InstalledPlugin) {
  return {
    ...normalizeConfig(plugin, installed.config),
    PLUGIN_ROOT: installed.packageRoot ?? "",
  }
}

function runtimeBindingForMcpServer(
  plugin: PluginCatalogItem,
  server: PluginMcpServerCatalogEntry,
  installed: InstalledPlugin,
): Config.McpServerInput {
  const serverName = server.name || plugin.name
  const enabled = installed.enabled
  const runtimeConfig = runtimeConfigForPlugin(plugin, installed)

  if (server.runtime.transport === "stdio") {
    return {
      name: serverName,
      transport: "stdio",
      command: replacePlaceholders(server.runtime.command, runtimeConfig),
      args: server.runtime.args?.map((arg) => replacePlaceholders(arg, runtimeConfig)),
      env: replaceRecordPlaceholders(server.runtime.env, runtimeConfig),
      cwd: replaceOptionalPlaceholders(server.runtime.cwd, runtimeConfig),
      toolPolicies: server.runtime.toolPolicies,
      enabled,
      timeoutMs: server.runtime.timeoutMs,
    }
  }

  return {
    name: serverName,
    transport: "remote",
    provider: server.runtime.provider,
    serverUrl: replaceOptionalPlaceholders(server.runtime.serverUrl, runtimeConfig),
    connectorId: replaceOptionalPlaceholders(server.runtime.connectorId, runtimeConfig),
    authorization: replaceOptionalPlaceholders(server.runtime.authorization, runtimeConfig),
    headers: replaceRecordPlaceholders(server.runtime.headers, runtimeConfig),
    serverDescription: server.runtime.serverDescription,
    allowedTools: server.runtime.allowedTools,
    toolPolicies: server.runtime.toolPolicies,
    requireApproval: server.runtime.requireApproval,
    enabled,
    timeoutMs: server.runtime.timeoutMs,
  }
}

function runtimeBindingForAppConnector(
  plugin: PluginCatalogItem,
  app: PluginAppConnector,
  installed: InstalledPlugin,
): Config.McpServerInput {
  const remoteRuntime = app.runtime.transport === "remote" ? app.runtime : undefined
  return {
    name: `${plugin.name}: ${app.name}`,
    transport: "connector",
    provider: remoteRuntime?.provider,
    connectorId: connectorIDForPluginApp(plugin.id, app.appID),
    serverDescription: remoteRuntime?.serverDescription,
    allowedTools: remoteRuntime?.allowedTools,
    toolPolicies: app.runtime.toolPolicies,
    requireApproval: remoteRuntime?.requireApproval,
    enabled: installed.enabled,
    timeoutMs: app.runtime.timeoutMs,
  }
}

function generatedMcpServerIDs(plugin: PluginCatalogItem) {
  return [
    ...plugin.mcpServers.map((server) => mcpServerIDForPlugin(plugin.id, server.id)),
    ...plugin.apps.map((app) => mcpServerIDForPluginApp(plugin.id, app.appID)),
  ]
}

function generatedSkillIDs(plugin: PluginCatalogItem) {
  return plugin.skills.map((skill) => skill.id)
}

function generatedConnectorIDs(plugin: PluginCatalogItem) {
  return plugin.apps.map((app) => connectorIDForPluginApp(plugin.id, app.appID))
}

function generatedConnectorRequirementIDs(plugin: PluginCatalogItem) {
  return plugin.connectorRequirements.map((requirement) => Connector.connectorIDForDefinition(requirement.connector))
}

async function syncPluginRuntimeBindings(plugin: PluginCatalogItem, installed: InstalledPlugin) {
  for (const server of plugin.mcpServers) {
    await Config.setMcpServer(
      Config.GLOBAL_CONFIG_ID,
      mcpServerIDForPlugin(plugin.id, server.id),
      runtimeBindingForMcpServer(plugin, server, installed),
    )
  }

  for (const app of plugin.apps) {
    await Config.setMcpServer(
      Config.GLOBAL_CONFIG_ID,
      mcpServerIDForPluginApp(plugin.id, app.appID),
      runtimeBindingForAppConnector(plugin, app, installed),
    )
  }

  if (plugin.connectorRequirements.length > 0) {
    await Connector.syncConnectorRuntimeBindings()
  }
}

async function writeInstalled(record: InstalledPlugin) {
  ensureInstalledPluginsTable()
  const previous = readInstalled(record.pluginID)
  const plugin = assertPackagePlugin(record.pluginID)
  const parsed = normalizeInstalledRecord(InstalledPlugin.parse(record))
  if (!parsed) throw new PluginError("INSTALLED_PLUGIN_NOT_FOUND", `Plugin '${record.pluginID}' is not installed.`)

  db.upsert(INSTALLED_PLUGINS_TABLE, parsed, ["pluginID"])
  await syncPluginRuntimeBindings(plugin, parsed)
  const staleServerIDs = (previous?.mcpServerIDs ?? []).filter((serverID) => !parsed.mcpServerIDs.includes(serverID))
  await Promise.all(staleServerIDs.map((serverID) => Config.removeMcpServer(Config.GLOBAL_CONFIG_ID, serverID)))
  return parsed
}

function sortCatalog(items: PluginCatalogItem[]) {
  return items.toSorted((left, right) => {
    const category = left.category.localeCompare(right.category)
    return category === 0 ? left.name.localeCompare(right.name) : category
  })
}

export async function listCatalog() {
  return sortCatalog(listCatalogInternal(await listManifestSourcesFresh()))
}

export function listCachedCatalog() {
  return sortCatalog(listCatalogInternal(listManifestSources()))
}

export async function importFromURL(input: ImportPluginURLInput) {
  const manifestURL = normalizePluginRegistryEntryURL(input.url)
  const source = await fetchPluginMeta(manifestURL)
  if (source.download?.url) {
    assertSupportedPackageURL(source.download.url)
  }

  const plugin = normalizeCatalogItem(source)
  if (plugin.risk === "critical") {
    throw new PluginError("PLUGIN_RISK_NOT_ALLOWED", `Plugin '${plugin.id}' has a risk level that is not allowed.`)
  }

  const sourcesByID = new Map(
    listImportedRegistryManifestSources()
      .map((entry) => [normalizeManifestID(entry.manifest.name), entry] as const),
  )
  sourcesByID.set(plugin.id, source)
  await writeImportedRegistryManifestSources([...sourcesByID.values()])
  return normalizeCatalogItem(source)
}

export function getCatalogItem(pluginID: string) {
  return listCatalogInternal().find((entry) => entry.id === normalizePluginID(pluginID))
}

export function listInstalled() {
  ensureInstalledPluginsTable()
  return db.findManyWithSchema(INSTALLED_PLUGINS_TABLE, InstalledPlugin)
    .map((record) => normalizeInstalledRecord(record))
    .filter((record): record is InstalledPlugin => Boolean(record))
    .toSorted((left, right) => left.pluginID.localeCompare(right.pluginID))
}

export function listEnabledInstalled() {
  return listInstalled().filter((plugin) => plugin.enabled && !plugin.missingPackage)
}

export function resolveEnabledInstalledPluginIDs(pluginIDs: string[]) {
  const enabledInstalledIDs = new Set(listEnabledInstalled().map((plugin) => plugin.pluginID))
  const seen = new Set<string>()
  const result: string[] = []

  for (const pluginID of pluginIDs) {
    const normalizedPluginID = normalizePluginID(pluginID)
    if (!normalizedPluginID || seen.has(normalizedPluginID) || !enabledInstalledIDs.has(normalizedPluginID)) continue
    seen.add(normalizedPluginID)
    result.push(normalizedPluginID)
  }

  return result
}

export function resolveEnabledInstalledPluginConnectorRequirementServerIDs(pluginIDs: string[]) {
  const selectedPluginIDs = new Set(resolveEnabledInstalledPluginIDs(pluginIDs))
  if (selectedPluginIDs.size === 0) return []

  return uniqueStrings(
    listEnabledInstalled()
      .filter((plugin) => selectedPluginIDs.has(plugin.pluginID))
      .flatMap((plugin) => plugin.connectorRequirementIDs)
      .flatMap((connectorID) => {
        const serverID = Connector.mcpServerIDForConnectorID(connectorID)
        return serverID ? [serverID] : []
      }),
  )
}

export function getInstalled(pluginID: string) {
  return readInstalled(pluginID)
}

function assertPluginPathSegment(value: string) {
  if (/^[a-z0-9][a-z0-9._-]*$/i.test(value)) return value
  throw new PluginError("PLUGIN_PACKAGE_INVALID", `Plugin package path segment is invalid: ${value}`)
}

function assertSupportedPackageURL(rawUrl: string) {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new PluginError("PLUGIN_PACKAGE_INVALID", "Plugin package URL is invalid.")
  }

  if (url.protocol !== "https:") {
    throw new PluginError("PLUGIN_PACKAGE_INVALID", "Plugin packages must be downloaded over https.")
  }
  if (url.username || url.password) {
    throw new PluginError("PLUGIN_PACKAGE_INVALID", "Plugin package URLs must not contain credentials.")
  }

  return url
}

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function assertPathInside(root: string, candidate: string) {
  const relativePath = relative(root, candidate)
  if (relativePath && (relativePath.startsWith("..") || isAbsolute(relativePath))) {
    throw new PluginError("PLUGIN_PACKAGE_INVALID", "Plugin archive contains a path outside the extraction directory.")
  }
}

function validateExtractedTree(root: string) {
  const realRoot = realpathSync(root)
  const visit = (current: string) => {
    const stat = lstatSync(current)
    if (stat.isSymbolicLink()) {
      throw new PluginError("PLUGIN_PACKAGE_INVALID", "Plugin archives must not contain symbolic links.")
    }

    assertPathInside(realRoot, realpathSync(current))
    if (!stat.isDirectory()) return

    for (const entry of readdirSync(current)) {
      visit(join(current, entry))
    }
  }

  visit(root)
}

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP64_SENTINEL = 0xffffffff

type ZipEntry = {
  rawName: string
  normalizedName: string | null
  flags: number
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  externalAttributes: number
}

function zipPackageError(message: string) {
  return new PluginError("PLUGIN_PACKAGE_INVALID", message)
}

function findEndOfCentralDirectory(archive: Buffer) {
  const minimumEOCDLength = 22
  const maximumCommentLength = 0xffff
  if (archive.length < minimumEOCDLength) {
    throw zipPackageError("Plugin archive is missing its central directory.")
  }

  const start = Math.max(0, archive.length - minimumEOCDLength - maximumCommentLength)

  for (let offset = archive.length - minimumEOCDLength; offset >= start; offset -= 1) {
    if (archive.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset
  }

  throw zipPackageError("Plugin archive is missing its central directory.")
}

function decodeZipEntryName(bytes: Buffer, flags: number) {
  if ((flags & 0x800) !== 0) return bytes.toString("utf8")

  try {
    return new TextDecoder("ibm437" as ConstructorParameters<typeof TextDecoder>[0]).decode(bytes)
  } catch {
    return bytes.toString("utf8")
  }
}

function normalizeZipEntryPath(rawName: string) {
  const slashName = rawName.replace(/\\/g, "/")
  if (slashName.includes("\0")) {
    throw zipPackageError("Plugin archive contains an invalid path.")
  }

  const trimmedName = slashName.replace(/\/+$/g, "")
  if (!trimmedName) return null
  if (trimmedName.startsWith("/") || /^[A-Za-z]:($|\/)/.test(trimmedName)) {
    throw zipPackageError("Plugin archive contains an absolute path.")
  }

  const segments = trimmedName.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw zipPackageError("Plugin archive contains an unsafe path.")
  }

  return segments.join("/")
}

function readZipEntries(archive: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(archive)
  const diskNumber = archive.readUInt16LE(eocdOffset + 4)
  const centralDirectoryDisk = archive.readUInt16LE(eocdOffset + 6)
  const totalEntries = archive.readUInt16LE(eocdOffset + 10)
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16)

  if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
    throw zipPackageError("Split plugin archives are not supported.")
  }
  if (
    totalEntries === 0xffff ||
    centralDirectorySize === ZIP64_SENTINEL ||
    centralDirectoryOffset === ZIP64_SENTINEL
  ) {
    throw zipPackageError("ZIP64 plugin archives are not supported.")
  }
  if (centralDirectoryOffset + centralDirectorySize > archive.length) {
    throw zipPackageError("Plugin archive central directory is invalid.")
  }

  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw zipPackageError("Plugin archive central directory is invalid.")
    }

    const flags = archive.readUInt16LE(offset + 8)
    const method = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const externalAttributes = archive.readUInt32LE(offset + 38)
    const localHeaderOffset = archive.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const nextOffset = nameStart + nameLength + extraLength + commentLength

    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL ||
      localHeaderOffset === ZIP64_SENTINEL
    ) {
      throw zipPackageError("ZIP64 plugin archives are not supported.")
    }
    if (nextOffset > archive.length) {
      throw zipPackageError("Plugin archive central directory is invalid.")
    }

    const rawName = decodeZipEntryName(archive.subarray(nameStart, nameStart + nameLength), flags)
    entries.push({
      rawName,
      normalizedName: normalizeZipEntryPath(rawName),
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      externalAttributes,
    })
    offset = nextOffset
  }

  return entries
}

function zipEntryMode(entry: ZipEntry) {
  return (entry.externalAttributes >>> 16) & 0xffff
}

function isZipEntryDirectory(entry: ZipEntry) {
  const mode = zipEntryMode(entry)
  return entry.rawName.endsWith("/") || entry.rawName.endsWith("\\") || (mode & 0o170000) === 0o040000
}

function isZipEntrySymlink(entry: ZipEntry) {
  return (zipEntryMode(entry) & 0o170000) === 0o120000
}

function readZipEntryData(archive: Buffer, entry: ZipEntry) {
  if ((entry.flags & 0x1) !== 0) {
    throw zipPackageError("Encrypted plugin archives are not supported.")
  }
  if (entry.localHeaderOffset + 30 > archive.length) {
    throw zipPackageError("Plugin archive local file header is invalid.")
  }
  if (archive.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw zipPackageError("Plugin archive local file header is invalid.")
  }

  const nameLength = archive.readUInt16LE(entry.localHeaderOffset + 26)
  const extraLength = archive.readUInt16LE(entry.localHeaderOffset + 28)
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > archive.length) {
    throw zipPackageError("Plugin archive file data is invalid.")
  }

  const compressed = archive.subarray(dataStart, dataEnd)
  let data: Buffer | null = null
  if (entry.method === 0) {
    data = Buffer.from(compressed)
  } else if (entry.method === 8) {
    try {
      data = inflateRawSync(compressed)
    } catch {
      throw zipPackageError("Plugin archive file data is invalid.")
    }
  }

  if (!data) {
    throw zipPackageError(`Plugin archive uses unsupported compression method ${entry.method}.`)
  }
  if (data.byteLength !== entry.uncompressedSize) {
    throw zipPackageError("Plugin archive file data size does not match its metadata.")
  }

  return data
}

function extractZipArchive(zipPath: string, destination: string) {
  const archive = readFileSync(zipPath)
  const destinationRoot = resolve(destination)

  for (const entry of readZipEntries(archive)) {
    if (!entry.normalizedName) continue
    if (isZipEntrySymlink(entry)) {
      throw zipPackageError("Plugin archives must not contain symbolic links.")
    }

    const targetPath = resolve(destinationRoot, entry.normalizedName)
    assertPathInside(destinationRoot, targetPath)

    if (isZipEntryDirectory(entry)) {
      mkdirSync(targetPath, { recursive: true })
      continue
    }

    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, readZipEntryData(archive, entry))
  }

  validateExtractedTree(destination)
}

function findPackageRootsWithManifest(root: string, depth = 0): string[] {
  const manifest = safeReadPluginManifest(root)
  const matches = manifest ? [root] : []
  if (depth >= 4) return matches

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue
    matches.push(...findPackageRootsWithManifest(join(root, entry.name), depth + 1))
  }

  return matches
}

function matchingPackageRootForRegistry(stagingRoot: string, registrySource: PluginManifestSource) {
  const expectedID = normalizeManifestID(registrySource.manifest.name)
  const expectedVersion = registrySource.manifest.version
  const matches = findPackageRootsWithManifest(stagingRoot).filter((packageRoot) => {
    const manifest = safeReadPluginManifest(packageRoot)
    return Boolean(
      manifest &&
        normalizeManifestID(manifest.name) === expectedID &&
        manifest.version === expectedVersion,
    )
  })

  if (matches.length !== 1) {
    throw new PluginError(
      "PLUGIN_PACKAGE_INVALID",
      `Plugin package must contain exactly one manifest matching ${expectedID}@${expectedVersion}.`,
    )
  }

  return matches[0]!
}

async function downloadPluginPackage(registrySource: PluginManifestSource) {
  const pluginID = normalizePluginID(registrySource.manifest.name)
  const download = registrySource.download
  if (!download?.url || !download.sha256) {
    throw new PluginError(
      "PLUGIN_PACKAGE_UNAVAILABLE",
      `Plugin '${pluginID}' does not provide a downloadable package yet.`,
    )
  }

  const url = assertSupportedPackageURL(download.url)
  const response = await fetch(url, {
    headers: {
      accept: "application/zip,application/octet-stream,*/*",
      "user-agent": "Anybox-Plugin-Installer",
    },
  }).catch((error) => {
    throw new PluginError(
      "PLUGIN_PACKAGE_DOWNLOAD_FAILED",
      error instanceof Error ? error.message : "Could not download plugin package.",
    )
  })

  if (!response.ok) {
    throw new PluginError(
      "PLUGIN_PACKAGE_DOWNLOAD_FAILED",
      `Could not download plugin package (${response.status}).`,
    )
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0")
  const sizeLimit = Math.min(download.size ? Math.max(download.size * 2, download.size + 1024 * 1024) : MAX_PLUGIN_PACKAGE_BYTES, MAX_PLUGIN_PACKAGE_BYTES)
  if (declaredLength > sizeLimit) {
    throw new PluginError("PLUGIN_PACKAGE_INVALID", "Plugin package is larger than the allowed download size.")
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > sizeLimit) {
    throw new PluginError("PLUGIN_PACKAGE_INVALID", "Plugin package is empty or too large.")
  }
  if (download.size && bytes.byteLength !== download.size) {
    throw new PluginError("PLUGIN_PACKAGE_INVALID", "Plugin package size does not match the registry metadata.")
  }

  const actualHash = sha256Hex(bytes)
  if (actualHash.toLowerCase() !== download.sha256.toLowerCase()) {
    throw new PluginError("PLUGIN_PACKAGE_INVALID", "Plugin package checksum does not match the registry metadata.")
  }

  const safeID = assertPluginPathSegment(pluginID)
  const safeVersion = assertPluginPathSegment(registrySource.manifest.version)
  const tempRoot = join(Global.Path.cache, "plugin-installs", `${safeID}-${safeVersion}-${randomUUID()}`)
  const zipPath = join(tempRoot, "package.zip")
  const stagingRoot = join(tempRoot, "extract")
  const finalRoot = join(installedPluginPackagesRoot(), safeID, safeVersion)

  await mkdir(stagingRoot, { recursive: true })
  await writeFile(zipPath, bytes)

  try {
    extractZipArchive(zipPath, stagingRoot)
    const packageRoot = matchingPackageRootForRegistry(stagingRoot, registrySource)
    await rm(finalRoot, { recursive: true, force: true })
    await mkdir(dirname(finalRoot), { recursive: true })
    await cp(packageRoot, finalRoot, { recursive: true })
  } finally {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  }

  const installedManifest = safeReadPluginManifest(finalRoot)
  if (!installedManifest) {
    throw new PluginError("PLUGIN_PACKAGE_INVALID", "Installed plugin package is missing its manifest.")
  }

  return finalRoot
}

async function copyPluginPackageToInstalled(source: PluginManifestSource) {
  const pluginID = normalizePluginID(source.manifest.name)
  if (!source.packageRoot) {
    throw new PluginError("PLUGIN_PACKAGE_UNAVAILABLE", `Plugin '${pluginID}' does not provide a local package.`)
  }

  const safeID = assertPluginPathSegment(pluginID)
  const safeVersion = assertPluginPathSegment(source.manifest.version)
  const sourceRoot = resolve(source.packageRoot)
  const finalRoot = resolve(installedPluginPackagesRoot(), safeID, safeVersion)

  if (source.managedInstall && sourceRoot === finalRoot) return finalRoot

  await rm(finalRoot, { recursive: true, force: true })
  await mkdir(dirname(finalRoot), { recursive: true })
  await cp(sourceRoot, finalRoot, { recursive: true })

  const installedManifest = safeReadPluginManifest(finalRoot)
  if (!installedManifest) {
    throw new PluginError("PLUGIN_PACKAGE_INVALID", "Installed plugin package is missing its manifest.")
  }
  if (
    normalizeManifestID(installedManifest.name) !== pluginID ||
    installedManifest.version !== source.manifest.version
  ) {
    throw new PluginError(
      "PLUGIN_PACKAGE_INVALID",
      `Installed plugin package does not match ${pluginID}@${source.manifest.version}.`,
    )
  }

  return finalRoot
}

async function ensurePluginPackageAvailable(pluginID: string) {
  const existing = getPackageManifestSource(pluginID)
  if (existing) {
    if (existing.managedInstall) return existing

    await copyPluginPackageToInstalled(existing)
    const installedSource = getPackageManifestSource(pluginID, { managedInstallOnly: true })
    if (!installedSource?.managedInstall) {
      throw new PluginError(
        "PLUGIN_PACKAGE_INVALID",
        `Plugin '${pluginID}' was installed but could not be loaded from the managed install root.`,
      )
    }
    return installedSource
  }

  const registrySource = await getRegistryManifestSource(pluginID)
  if (!registrySource) {
    throw new PluginError("PLUGIN_NOT_FOUND", `Plugin '${pluginID}' was not found in the curated catalog.`)
  }

  const registryItem = normalizeCatalogItem(registrySource)
  if (registryItem.risk === "critical") {
    throw new PluginError("PLUGIN_RISK_NOT_ALLOWED", `Plugin '${pluginID}' has a risk level that is not allowed.`)
  }

  await downloadPluginPackage(registrySource)
  const installedSource = getPackageManifestSource(pluginID, { managedInstallOnly: true })
  if (!installedSource) {
    throw new PluginError("PLUGIN_PACKAGE_INVALID", `Plugin '${pluginID}' was downloaded but could not be loaded.`)
  }
  return installedSource
}

export async function install(pluginID: string, input: InstallPluginInput) {
  await ensurePluginPackageAvailable(pluginID)
  const plugin = assertPackagePlugin(pluginID)
  const existing = readInstalled(plugin.id)
  const timestamp = now()
  const record: InstalledPlugin = {
    pluginID: plugin.id,
    version: plugin.version,
    enabled: input.enabled ?? existing?.enabled ?? true,
    mcpServerID: existing?.mcpServerID ?? generatedMcpServerIDs(plugin)[0],
    mcpServerIDs: generatedMcpServerIDs(plugin),
    skillIDs: generatedSkillIDs(plugin),
    connectorIDs: generatedConnectorIDs(plugin),
    connectorRequirementIDs: generatedConnectorRequirementIDs(plugin),
    config: normalizeConfig(plugin, input.config ?? existing?.config),
    installedAt: existing?.installedAt ?? timestamp,
    updatedAt: timestamp,
    lastDiagnostic: existing?.lastDiagnostic,
    lastConnectorDiagnostics: existing?.lastConnectorDiagnostics,
  }

  return writeInstalled(record)
}

export async function update(pluginID: string, input: UpdateInstalledPluginInput) {
  const plugin = assertPackagePlugin(pluginID)
  const existing = readInstalled(plugin.id)
  if (!existing) {
    throw new PluginError("INSTALLED_PLUGIN_NOT_FOUND", `Plugin '${pluginID}' is not installed.`)
  }

  const record: InstalledPlugin = {
    ...existing,
    version: plugin.version,
    enabled: input.enabled ?? existing.enabled,
    mcpServerID: existing.mcpServerID ?? generatedMcpServerIDs(plugin)[0],
    mcpServerIDs: generatedMcpServerIDs(plugin),
    skillIDs: generatedSkillIDs(plugin),
    connectorIDs: generatedConnectorIDs(plugin),
    connectorRequirementIDs: generatedConnectorRequirementIDs(plugin),
    config: normalizeConfig(plugin, input.config ?? existing.config),
    updatedAt: now(),
  }

  return writeInstalled(record)
}

export async function remove(pluginID: string) {
  const normalizedPluginID = normalizePluginID(pluginID)
  const existing = readInstalled(normalizedPluginID)
  const source = getPackageManifestSource(normalizedPluginID)
  const plugin = source ? normalizeCatalogItem(source) : getCatalogItem(normalizedPluginID)
  const mcpServerIDs = existing?.mcpServerIDs ?? (plugin ? generatedMcpServerIDs(plugin) : [mcpServerIDForPlugin(normalizedPluginID)])
  const connectorIDs = existing?.connectorIDs ?? (plugin ? generatedConnectorIDs(plugin) : [])
  const legacyMcpServerIDs = plugin ? plugin.apps.map((app) => legacyMcpServerIDForPluginApp(plugin.id, app.appID)) : []
  const legacyConnectorIDs = plugin ? plugin.apps.map((app) => legacyConnectorIDForPluginApp(plugin.id, app.appID)) : []

  ensureInstalledPluginsTable()
  const removedCount = existing ? db.deleteById(INSTALLED_PLUGINS_TABLE, normalizedPluginID, "pluginID") : 0
  await Promise.all(uniqueStrings([...mcpServerIDs, ...legacyMcpServerIDs]).map((serverID) => Config.removeMcpServer(Config.GLOBAL_CONFIG_ID, serverID)))
  await Promise.all(uniqueStrings([...connectorIDs, ...legacyConnectorIDs]).map((connectorID) => Auth.clearProvider(connectorID)))
  if (source?.managedInstall && source.packageRoot) {
    await rm(source.packageRoot, { recursive: true, force: true }).catch(() => {})
  }

  return {
    pluginID: normalizedPluginID,
    mcpServerID: mcpServerIDs[0],
    mcpServerIDs,
    connectorIDs,
    removed: removedCount > 0,
  }
}

export async function diagnose(pluginID: string) {
  const normalizedPluginID = normalizePluginID(pluginID)
  const plugin = assertPackagePlugin(normalizedPluginID)
  const installed = readInstalled(normalizedPluginID)
  if (!installed) {
    throw new PluginError("INSTALLED_PLUGIN_NOT_FOUND", `Plugin '${pluginID}' is not installed.`)
  }

  const serverID = installed.mcpServerIDs[0] ?? generatedMcpServerIDs(plugin)[0]
  if (!serverID) {
    throw new PluginError(
      "INSTALLED_PLUGIN_NOT_FOUND",
      `Plugin '${pluginID}' does not have a generated MCP server binding.`,
    )
  }

  const server = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, serverID)
  if (!server) {
    throw new PluginError(
      "INSTALLED_PLUGIN_NOT_FOUND",
      `Plugin '${pluginID}' does not have a generated MCP server binding.`,
    )
  }

  const diagnostic = await Mcp.diagnoseServer(server)
  const record: InstalledPlugin = {
    ...installed,
    updatedAt: now(),
    lastDiagnostic: diagnostic,
  }
  ensureInstalledPluginsTable()
  db.upsert(INSTALLED_PLUGINS_TABLE, record, ["pluginID"])
  return diagnostic
}

export async function listConnectorStatuses(pluginID: string): Promise<PluginConnectorStatus[]> {
  const plugin = assertPackagePlugin(pluginID)
  const installed = readInstalled(plugin.id)
  if (!installed) {
    throw new PluginError("INSTALLED_PLUGIN_NOT_FOUND", `Plugin '${pluginID}' is not installed.`)
  }

  return Promise.all(plugin.apps.map(async (app) => connectorStatusFor(plugin, installed, app)))
}

async function connectorStatusFor(
  plugin: PluginCatalogItem,
  installed: InstalledPlugin,
  app: PluginAppConnector,
): Promise<PluginConnectorStatus> {
  const connectorID = connectorIDForPluginApp(plugin.id, app.appID)
  const legacyConnectorID = legacyConnectorIDForPluginApp(plugin.id, app.appID)
  const activeCredential = await getActivePluginConnectorCredential(plugin.id, app.appID)
  const credential = activeCredential?.credential
  const record = await getPluginConnectorRecord(plugin.id, app.appID)
  const activeFlow =
    ProviderAuth.getLatestProviderAuthFlow(connectorID) ??
    ProviderAuth.getLatestProviderAuthFlow(legacyConnectorID)
  const isPendingFlow = activeFlow && ["pending", "waiting_user", "authorizing"].includes(activeFlow.status)
  const connected =
    app.credential.kind === "api_key"
      ? credential?.kind === "api_key"
      : credential?.kind === "oauth_session" && credential.expiresAt > now()
  const authStatus: PluginConnectorStatus["authStatus"] =
    isPendingFlow
      ? "pending"
      : connected
        ? "connected"
        : credential?.kind === "oauth_session" && credential.expiresAt <= now()
          ? "expired"
          : record?.lastError
            ? "error"
            : "not_connected"
  const account = credential?.kind === "oauth_session"
    ? {
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
    : undefined

  return {
    pluginID: plugin.id,
    appID: app.appID,
    connectorID,
    connected,
    credentialKind: app.credential.kind,
    authStatus,
    credentialLabel: credential?.kind === "api_key"
      ? credential.label ?? "API key"
      : credential?.kind === "oauth_session"
        ? credential.email ?? app.credential.label
        : undefined,
    account,
    email: credential?.kind === "oauth_session" ? credential.email : undefined,
    expiresAt: credential?.kind === "oauth_session" ? credential.expiresAt : undefined,
    activeFlow,
    generatedMcpServerID: mcpServerIDForPluginApp(plugin.id, app.appID),
    lastDiagnostic: installed.lastConnectorDiagnostics?.[app.appID],
  }
}

export async function saveConnectorApiKey(pluginID: string, appID: string, input: SavePluginConnectorApiKeyInput) {
  const plugin = assertPackagePlugin(pluginID)
  const installed = readInstalled(plugin.id)
  if (!installed) {
    throw new PluginError("INSTALLED_PLUGIN_NOT_FOUND", `Plugin '${pluginID}' is not installed.`)
  }

  const app = assertPluginApp(plugin, appID)
  const credential = assertApiKeyAppCredential(app)
  const connectorID = connectorIDForPluginApp(plugin.id, app.appID)
  const legacyConnectorID = legacyConnectorIDForPluginApp(plugin.id, app.appID)
  const apiKey = input.apiKey?.trim()

  if (!apiKey) {
    await Promise.all([
      Auth.clearProvider(connectorID),
      Auth.clearProvider(legacyConnectorID),
    ])
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
    await Auth.clearProvider(legacyConnectorID)
  }

  const record: InstalledPlugin = {
    ...installed,
    updatedAt: now(),
  }
  ensureInstalledPluginsTable()
  db.upsert(INSTALLED_PLUGINS_TABLE, record, ["pluginID"])
  return connectorStatusFor(plugin, record, app)
}

export async function removeConnectorApiKey(pluginID: string, appID: string) {
  return saveConnectorApiKey(pluginID, appID, { apiKey: null })
}

export async function startConnectorOAuthFlow(
  pluginID: string,
  appID: string,
  input: { serverBaseURL: string },
) {
  const plugin = assertPackagePlugin(pluginID)
  const installed = readInstalled(plugin.id)
  if (!installed || !installed.enabled) {
    throw new PluginError("PLUGIN_CONNECTOR_NOT_CONNECTED", `Plugin '${pluginID}' is not installed or enabled.`)
  }

  const app = assertPluginApp(plugin, appID)
  const credential = assertOAuthAppCredential(app)
  const runtimeConfig = runtimeConfigForPlugin(plugin, installed)
  return ProviderAuth.startGenericOAuthFlow({
    providerID: connectorIDForPluginApp(plugin.id, app.appID),
    method: oauthMethodForApp(app),
    serverBaseURL: input.serverBaseURL,
    oauth: oauthConfigForCredential(credential, runtimeConfig),
  })
}

export async function getConnectorOAuthFlow(pluginID: string, appID: string, flowID: string) {
  const plugin = assertPackagePlugin(pluginID)
  const app = assertPluginApp(plugin, appID)
  assertOAuthAppCredential(app)
  return await ProviderAuth.getProviderFlow(connectorIDForPluginApp(plugin.id, app.appID), flowID) ??
    await ProviderAuth.getProviderFlow(legacyConnectorIDForPluginApp(plugin.id, app.appID), flowID)
}

export async function cancelConnectorOAuthFlow(pluginID: string, appID: string, flowID: string) {
  const plugin = assertPackagePlugin(pluginID)
  const app = assertPluginApp(plugin, appID)
  assertOAuthAppCredential(app)
  return await ProviderAuth.cancelProviderAuthFlow(connectorIDForPluginApp(plugin.id, app.appID), flowID) ??
    await ProviderAuth.cancelProviderAuthFlow(legacyConnectorIDForPluginApp(plugin.id, app.appID), flowID)
}

export async function deleteConnectorOAuthSession(pluginID: string, appID: string) {
  const plugin = assertPackagePlugin(pluginID)
  const installed = readInstalled(plugin.id)
  if (!installed) {
    throw new PluginError("INSTALLED_PLUGIN_NOT_FOUND", `Plugin '${pluginID}' is not installed.`)
  }

  const app = assertPluginApp(plugin, appID)
  const credential = assertOAuthAppCredential(app)
  const runtimeConfig = runtimeConfigForPlugin(plugin, installed)
  await ProviderAuth.deleteGenericOAuthSession(
    connectorIDForPluginApp(plugin.id, app.appID),
    oauthMethodForApp(app),
    oauthConfigForCredential(credential, runtimeConfig),
  )
  await ProviderAuth.deleteGenericOAuthSession(
    legacyConnectorIDForPluginApp(plugin.id, app.appID),
    oauthMethodForApp(app),
    oauthConfigForCredential(credential, runtimeConfig),
  ).catch(() => undefined)

  const record: InstalledPlugin = {
    ...installed,
    updatedAt: now(),
  }
  ensureInstalledPluginsTable()
  db.upsert(INSTALLED_PLUGINS_TABLE, record, ["pluginID"])
  return connectorStatusFor(plugin, record, app)
}

export async function diagnoseConnector(pluginID: string, appID: string) {
  const plugin = assertPackagePlugin(pluginID)
  const installed = readInstalled(plugin.id)
  if (!installed) {
    throw new PluginError("INSTALLED_PLUGIN_NOT_FOUND", `Plugin '${pluginID}' is not installed.`)
  }

  const app = assertPluginApp(plugin, appID)
  const serverID = mcpServerIDForPluginApp(plugin.id, app.appID)
  const server = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, serverID)
  if (!server) {
    throw new PluginError(
      "INSTALLED_PLUGIN_NOT_FOUND",
      `Plugin '${pluginID}' app '${appID}' does not have a generated MCP server binding.`,
    )
  }

  const diagnostic = await Mcp.diagnoseServer(server)
  const record: InstalledPlugin = {
    ...installed,
    updatedAt: now(),
    lastConnectorDiagnostics: {
      ...(installed.lastConnectorDiagnostics ?? {}),
      [app.appID]: diagnostic,
    },
  }
  ensureInstalledPluginsTable()
  db.upsert(INSTALLED_PLUGINS_TABLE, record, ["pluginID"])
  return diagnostic
}

function commandLooksLikePath(command: string) {
  return isAbsolute(command) || command.startsWith(".") || command.includes("/") || command.includes("\\")
}

function resolvePluginRuntimePath(packageRoot: string, value: string, field: string) {
  const resolvedPath = isAbsolute(value) ? resolve(value) : resolve(packageRoot, value)
  const normalizedRoot = resolve(packageRoot)
  const relativePathFromRoot = relative(normalizedRoot, resolvedPath)
  if (relativePathFromRoot.startsWith("..") || isAbsolute(relativePathFromRoot)) {
    throw new PluginError("PLUGIN_PACKAGE_INVALID", `${field} must stay inside the plugin package.`)
  }

  return resolvedPath
}

function assertAbsoluteRuntimeArgInsidePackage(packageRoot: string, value: string) {
  if (!isAbsolute(value)) return
  resolvePluginRuntimePath(packageRoot, value, "Connector runtime argument")
}

async function resolvePluginConnectorAuthConfig(
  connectorID: string,
  app: PluginAppConnector,
  runtimeConfig: Record<string, string>,
): Promise<Record<string, string>> {
  const config: Record<string, string> = {}

  if (app.credential.kind === "api_key") {
    const credential = assertApiKeyAppCredential(app)
    const parsed = parsePluginConnectorID(connectorID)
    const activeCredential = parsed
      ? await getActivePluginConnectorCredential(parsed.pluginID, parsed.appID)
      : await Auth.getActiveProviderCredential(connectorID)
    if (activeCredential?.credential.kind !== "api_key") {
      throw new PluginError("PLUGIN_CONNECTOR_NOT_CONNECTED", `${app.name} is not connected.`)
    }
    config[credential.key] = activeCredential.credential.apiKey
  } else {
    const credential = assertOAuthAppCredential(app)
    const parsed = parsePluginConnectorID(connectorID)
    const ids = parsed ? pluginConnectorCredentialIDs(parsed.pluginID, parsed.appID) : { primary: connectorID, legacy: connectorID }
    const session =
      await ProviderAuth.resolveGenericOAuthCredential(
        ids.primary,
        oauthMethodForApp(app),
        oauthConfigForCredential(credential, runtimeConfig),
      ) ??
      await ProviderAuth.resolveGenericOAuthCredential(
        ids.legacy,
        oauthMethodForApp(app),
        oauthConfigForCredential(credential, runtimeConfig),
      )
    if (!session) {
      throw new PluginError("PLUGIN_CONNECTOR_NOT_CONNECTED", `${app.name} is not connected.`)
    }
    config.OAUTH_ACCESS_TOKEN = session.accessToken
    config.OAUTH_TOKEN_TYPE = session.tokenType ?? "Bearer"
  }

  return config
}

export async function resolveConnectorRuntime(connectorID: string): Promise<ResolvedPluginConnectorRuntime> {
  const parsed = parsePluginConnectorID(connectorID)
  if (!parsed) {
    throw new PluginError("PLUGIN_CONNECTOR_NOT_FOUND", `Connector '${connectorID}' is not a plugin connector.`)
  }

  const plugin = assertPackagePlugin(parsed.pluginID)
  const installed = readInstalled(plugin.id)
  if (!installed || !installed.enabled) {
    throw new PluginError("PLUGIN_CONNECTOR_NOT_CONNECTED", `Plugin '${plugin.id}' is not installed or enabled.`)
  }

  const app = assertPluginApp(plugin, parsed.appID)
  const runtimeConfig = runtimeConfigForPlugin(plugin, installed)
  const config: Record<string, string> = {
    ...runtimeConfig,
    ...(await resolvePluginConnectorAuthConfig(connectorID, app, runtimeConfig)),
  }

  if (app.runtime.transport === "stdio") {
    const packageRoot = installed.packageRoot
    if (!packageRoot) {
      throw new PluginError("PLUGIN_PACKAGE_UNAVAILABLE", `Plugin '${plugin.id}' package is unavailable.`)
    }

    const command = replacePlaceholders(app.runtime.command, config)
    const cwd = replaceOptionalPlaceholders(app.runtime.cwd, config)
    const resolvedCwd = cwd ? resolvePluginRuntimePath(packageRoot, cwd, "Connector runtime cwd") : packageRoot
    const resolvedCommand = commandLooksLikePath(command)
      ? resolvePluginRuntimePath(packageRoot, command, "Connector runtime command")
      : command
    const args = app.runtime.args?.map((arg) => replacePlaceholders(arg, config))
    args?.forEach((arg) => assertAbsoluteRuntimeArgInsidePackage(packageRoot, arg))

    return {
      transport: "stdio",
      command: resolvedCommand,
      args,
      cwd: resolvedCwd,
      env: replaceRecordPlaceholders(app.runtime.env, config),
    }
  }

  const serverUrl = replaceOptionalPlaceholders(app.runtime.serverUrl, config)
  if (!serverUrl) {
    throw new PluginError("PLUGIN_CONNECTOR_NOT_FOUND", `${app.name} does not declare a remote MCP server URL.`)
  }

  const result: {
    transport: "remote"
    serverUrl: string
    authorization?: string
    headers?: Record<string, string>
  } = {
    transport: "remote",
    serverUrl,
    authorization: replaceOptionalPlaceholders(app.runtime.authorization, config),
    headers: replaceRecordPlaceholders(app.runtime.headers, config),
  }

  if (app.credential.kind === "oauth" && !result.authorization) {
    const placement = app.credential.tokenPlacement
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

export async function resolveConnectorRemoteServer(connectorID: string): Promise<{
  serverUrl: string
  authorization?: string
  headers?: Record<string, string>
}> {
  const runtime = await resolveConnectorRuntime(connectorID)
  if (runtime.transport !== "remote") {
    throw new PluginError("PLUGIN_CONNECTOR_NOT_FOUND", `Connector '${connectorID}' does not resolve to a remote MCP server.`)
  }

  return {
    serverUrl: runtime.serverUrl,
    authorization: runtime.authorization,
    headers: runtime.headers,
  }
}

export interface InstalledPluginSkillRoot {
  pluginID: string
  pluginName: string
  root: string
  enabled: boolean
}

export function listInstalledPluginSkillRoots(
  pluginIDs?: string[] | null,
  options: { includeDisabled?: boolean } = {},
): InstalledPluginSkillRoot[] {
  const selectedPluginIDs = pluginIDs ? new Set(pluginIDs.map((pluginID) => normalizePluginID(pluginID))) : null
  const installedPlugins = options.includeDisabled
    ? listInstalled().filter((plugin) => !plugin.missingPackage)
    : listEnabledInstalled()
  const installedByID = new Map(
    installedPlugins
      .filter((plugin) => !selectedPluginIDs || selectedPluginIDs.has(plugin.pluginID))
      .map((plugin) => [plugin.pluginID, plugin]),
  )

  return [...installedByID.values()].flatMap((installed) => {
    if (!installed.packageRoot) return []
    const manifest = safeReadPluginManifest(installed.packageRoot)
    if (!manifest) return []
    const pluginID = normalizeManifestID(manifest.name)
    const pluginName = defaultLocalizableText(manifest.interface?.displayName, manifest.name)

    return skillDirectoryDeclarations(manifest)
      .map((directory) => resolvePackageRelativePath(installed.packageRoot!, directory))
      .filter((root): root is string => Boolean(root && existsSync(root)))
      .map((root) => ({
        pluginID,
        pluginName,
        root,
        enabled: installed.enabled,
      }))
  })
}
