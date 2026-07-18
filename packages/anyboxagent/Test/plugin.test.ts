import { afterEach, describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import * as Auth from "#auth/auth.ts"
import * as ProviderAuth from "#auth/provider-auth.ts"
import * as Config from "#config/config.ts"
import * as Connector from "#connector/connector.ts"
import * as Sqlite from "#database/Sqlite.ts"
import * as Plugin from "#plugin/plugin.ts"
import { createServerApp } from "#server/server.ts"
import * as Skill from "#skill/skill.ts"

interface JsonEnvelope<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

interface SkillTreeTestNode {
  name: string
  path: string
  kind: string
  readOnly?: boolean
  scope?: string
  pluginID?: string
  children?: SkillTreeTestNode[]
}

function findSkillTreeNode(
  nodes: SkillTreeTestNode[] | undefined,
  predicate: (node: SkillTreeTestNode) => boolean,
): SkillTreeTestNode | null {
  for (const node of nodes ?? []) {
    if (predicate(node)) return node
    const nested = findSkillTreeNode(node.children, predicate)
    if (nested) return nested
  }

  return null
}

type PluginCatalogEnvelope = JsonEnvelope<
  Array<{
    id: string
    name: string
    description: string
    longDescription?: string
    iconUrl?: string
    localized?: {
      name?: {
        "en-US"?: string
        "zh-CN"?: string
        "zh-TW"?: string
        "ja-JP"?: string
        "ko-KR"?: string
        "pt-BR"?: string
      }
      description?: {
        "en-US"?: string
        "zh-CN"?: string
        "zh-TW"?: string
        "ja-JP"?: string
        "ko-KR"?: string
      }
      longDescription?: {
        "en-US"?: string
        "zh-CN"?: string
        "zh-TW"?: string
        "ja-JP"?: string
        "ko-KR"?: string
      }
    }
    thumbnailUrl?: string
    heroImageUrl?: string
    screenshots: string[]
    installable?: boolean
    source?: string
    download?: {
      type: string
      url?: string
      sha256?: string
    }
    version: string
    risk: string
    runtime?: {
      transport: string
      command?: string
      serverUrl?: string
    }
    tools: Array<{
      name: string
      description: string
    }>
    configFields: Array<{
      key: string
      label: string
      type?: string
      required?: boolean
      secret?: boolean
      placeholder?: string
      defaultValue?: string
      description?: string
    }>
    mcpServers: Array<{
      id: string
      tools: Array<{
        name: string
      }>
      runtime: {
        transport: string
      }
    }>
    skills: Array<{
      id: string
      directory: string
    }>
    apps: Array<{
      appID: string
      credential: {
        kind?: string
        key?: string
        label: string
        clientID?: string
        clientSecret?: string
        authorizationURL?: string
        tokenURL?: string
        scopes?: string[]
        tokenEndpointAuthMethod?: string
        registration?: {
          registrationURL: string
          initialAccessToken?: string
          metadata?: Record<string, unknown>
        }
      }
      runtime: {
        transport: string
        serverUrl?: string
        headers?: Record<string, string>
      }
    }>
    connectors: Array<{
      id?: string
      appID: string
      credential: {
        kind?: string
        key?: string
        label: string
      }
      runtime: {
        transport: string
        command?: string
        args?: string[]
        env?: Record<string, string>
        serverUrl?: string
        headers?: Record<string, string>
      }
    }>
    connectorRequirements: Array<{
      connector: string
      runtimeIDs?: string[]
      tools?: string[]
      permissions?: string[]
      required?: boolean
      reason?: string
    }>
  }>
>
type PluginCatalogItemEnvelope = JsonEnvelope<NonNullable<PluginCatalogEnvelope["data"]>[number]>

type InstalledPluginEnvelope = JsonEnvelope<{
  pluginID: string
  enabled: boolean
  mcpServerID: string
  mcpServerIDs: string[]
  mcpServerEnabled: Record<string, boolean>
  skillIDs: string[]
  connectorIDs: string[]
  connectorRequirementIDs: string[]
  config: Record<string, string>
  packageRoot?: string
  missingPackage?: boolean
}>

type ConnectorCatalogEnvelope = JsonEnvelope<
  Array<{
    id: string
    name: string
    category: "account_connector" | "builtin_mcp"
    credential?: {
      kind: "api_key" | "oauth"
      label: string
      key?: string
      clientID?: string
      clientIDConfigKey?: string
      clientSecretConfigKey?: string
      scopes?: string[]
      tokenEndpointAuthMethod?: string
      tokenRequestFormat?: string
    }
    configFields: Array<{
      key: string
      label: string
      type?: string
      required?: boolean
      secret?: boolean
    }>
    tools: Array<{
      name: string
    }>
    runtime?: {
      transport: "stdio" | "remote"
      command?: string
      args?: string[]
      env?: Record<string, string>
      cwd?: string
      serverUrl?: string
    }
    mcpRuntimes: Array<{
      id: string
      name?: string
      available: boolean
      transport: "stdio" | "remote"
      serverUrl?: string
    }>
  }>
>

type PlatformConnectorStatusEnvelope = JsonEnvelope<
  Array<{
    connectorID: string
    definitionID: string
    connected: boolean
    authStatus: "connected" | "not_connected" | "pending" | "expired" | "error" | "unavailable"
    credentialKind?: "api_key" | "oauth"
    configured?: boolean
    configurationLabel?: string
    mcpBindings: Array<{
      runtimeID: string
      serverID: string
      name?: string
    }>
    generatedMcpServerID?: string
  }>
>

type SinglePlatformConnectorStatusEnvelope = JsonEnvelope<{
  connectorID: string
  definitionID: string
  connected: boolean
  authStatus: "connected" | "not_connected" | "pending" | "expired" | "error" | "unavailable"
  credentialKind?: "api_key" | "oauth"
  configured?: boolean
  configurationLabel?: string
  mcpBindings: Array<{
    runtimeID: string
    serverID: string
    name?: string
  }>
  generatedMcpServerID?: string
}>

type InstalledPluginsEnvelope = JsonEnvelope<
  Array<{
    pluginID: string
    enabled: boolean
    mcpServerID: string
    mcpServerIDs: string[]
    packageRoot?: string
    missingPackage?: boolean
  }>
>

type DiagnosticEnvelope = JsonEnvelope<{
  serverID: string
  enabled: boolean
  ok: boolean
  toolCount: number
  error?: string
}>

type DeletePluginEnvelope = JsonEnvelope<{
  pluginID: string
  mcpServerID: string
  mcpServerIDs: string[]
  connectorIDs: string[]
  removed: boolean
}>

type ConnectorStatusEnvelope = JsonEnvelope<
  Array<{
    pluginID: string
    appID: string
    connectorID: string
    connected: boolean
    credentialKind: "api_key" | "oauth"
    authStatus: "connected" | "not_connected" | "pending" | "expired" | "error"
    credentialLabel?: string
    email?: string
    expiresAt?: number
    generatedMcpServerID: string
  }>
>

type SingleConnectorStatusEnvelope = JsonEnvelope<{
  pluginID: string
  appID: string
  connectorID: string
  connected: boolean
  credentialKind: "api_key" | "oauth"
  authStatus: "connected" | "not_connected" | "pending" | "expired" | "error"
  credentialLabel?: string
  email?: string
  expiresAt?: number
  generatedMcpServerID: string
}>

let activeRoot: string | null = null
let previousPluginLocalDir: string | undefined
let previousPluginInstallDir: string | undefined
let previousPluginRegistryIndexURL: string | undefined
let previousPluginRegistryCacheDir: string | undefined
let previousPluginImportedRegistryFile: string | undefined
let previousConnectorRegistryFiles: string | undefined
let previousConnectorBuildConfig: string | undefined
let previousGmailOAuthClientID: string | undefined
let previousGmailOAuthClientSecret: string | undefined
let previousLegacyGmailOAuthClientID: string | undefined
let previousLegacyGmailOAuthClientSecret: string | undefined
let previousFetch: typeof fetch | undefined
const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="

async function removeTreeWithRetry(path: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

async function useTempDatabase() {
  activeRoot = await mkdtemp(join(tmpdir(), "anybox-plugin-api-"))
  Sqlite.setDatabaseFile(join(activeRoot, "plugin.db"))
  Sqlite.closeDatabase()
  previousPluginLocalDir = process.env.ANYBOX_PLUGIN_LOCAL_DIR
  previousPluginInstallDir = process.env.ANYBOX_PLUGIN_INSTALL_DIR
  previousPluginRegistryIndexURL = process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL
  previousPluginRegistryCacheDir = process.env.ANYBOX_PLUGIN_REGISTRY_CACHE_DIR
  previousPluginImportedRegistryFile = process.env.ANYBOX_PLUGIN_IMPORTED_REGISTRY_FILE
  previousConnectorRegistryFiles = process.env.ANYBOX_CONNECTOR_REGISTRY_FILES
  previousConnectorBuildConfig = process.env.ANYBOX_CONNECTOR_BUILD_CONFIG
  previousGmailOAuthClientID = process.env.ANYBOX_GMAIL_OAUTH_CLIENT_ID
  previousGmailOAuthClientSecret = process.env.ANYBOX_GMAIL_OAUTH_CLIENT_SECRET
  previousLegacyGmailOAuthClientID = process.env.GOOGLE_OAUTH_CLIENT_ID
  previousLegacyGmailOAuthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  previousFetch = globalThis.fetch
  process.env.ANYBOX_PLUGIN_LOCAL_DIR = join(activeRoot, "local-plugins")
  process.env.ANYBOX_PLUGIN_INSTALL_DIR = join(activeRoot, "installed-plugins")
  process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "off"
  process.env.ANYBOX_PLUGIN_REGISTRY_CACHE_DIR = join(activeRoot, "registry-cache")
  process.env.ANYBOX_PLUGIN_IMPORTED_REGISTRY_FILE = join(activeRoot, "imported-plugin-registry.json")
  delete process.env.ANYBOX_CONNECTOR_REGISTRY_FILES
  delete process.env.ANYBOX_CONNECTOR_BUILD_CONFIG
  delete process.env.ANYBOX_GMAIL_OAUTH_CLIENT_ID
  delete process.env.ANYBOX_GMAIL_OAUTH_CLIENT_SECRET
  delete process.env.GOOGLE_OAUTH_CLIENT_ID
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
  await Auth.clearProvider("plugin-app:manifest-lab:docs")
  await Auth.clearProvider("plugin-connector:manifest-lab:docs")
  await Auth.clearProvider("plugin-connector:local-connector-lab:docs-local")
  await Auth.clearProvider("plugin-connector:dynamic-oauth-lab:mail")
  await Auth.clearProvider("plugin-connector:gmail:gmail")
  await Auth.clearProvider("connector:docs:default")
  await Auth.clearProvider("connector:gmail:default")
  await Auth.clearProvider("connector:feishu:default")
}

function pluginInstallRoot() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")
  return process.env.ANYBOX_PLUGIN_INSTALL_DIR ?? join(activeRoot, "installed-plugins")
}

function pluginLocalRoot() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")
  return process.env.ANYBOX_PLUGIN_LOCAL_DIR ?? join(activeRoot, "local-plugins")
}

function createZipArchive(entries: Array<{ name: string; data: string | Buffer }>) {
  const chunks: Buffer[] = []
  const centralDirectoryChunks: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8")
    const data = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : entry.data
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x0800, 6)
    localHeader.writeUInt16LE(0, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0x21, 12)
    localHeader.writeUInt32LE(crc32(data), 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)
    chunks.push(localHeader, name, data)

    const centralDirectoryHeader = Buffer.alloc(46)
    centralDirectoryHeader.writeUInt32LE(0x02014b50, 0)
    centralDirectoryHeader.writeUInt16LE(20, 4)
    centralDirectoryHeader.writeUInt16LE(20, 6)
    centralDirectoryHeader.writeUInt16LE(0x0800, 8)
    centralDirectoryHeader.writeUInt16LE(0, 10)
    centralDirectoryHeader.writeUInt16LE(0, 12)
    centralDirectoryHeader.writeUInt16LE(0x21, 14)
    centralDirectoryHeader.writeUInt32LE(crc32(data), 16)
    centralDirectoryHeader.writeUInt32LE(data.length, 20)
    centralDirectoryHeader.writeUInt32LE(data.length, 24)
    centralDirectoryHeader.writeUInt16LE(name.length, 28)
    centralDirectoryHeader.writeUInt16LE(0, 30)
    centralDirectoryHeader.writeUInt16LE(0, 32)
    centralDirectoryHeader.writeUInt16LE(0, 34)
    centralDirectoryHeader.writeUInt16LE(0, 36)
    centralDirectoryHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    centralDirectoryHeader.writeUInt32LE(offset, 42)
    centralDirectoryChunks.push(centralDirectoryHeader, name)

    offset += localHeader.length + name.length + data.length
  }

  const centralDirectoryOffset = offset
  const centralDirectory = Buffer.concat(centralDirectoryChunks)
  const endOfCentralDirectory = Buffer.alloc(22)
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0)
  endOfCentralDirectory.writeUInt16LE(0, 4)
  endOfCentralDirectory.writeUInt16LE(0, 6)
  endOfCentralDirectory.writeUInt16LE(entries.length, 8)
  endOfCentralDirectory.writeUInt16LE(entries.length, 10)
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12)
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16)
  endOfCentralDirectory.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, centralDirectory, endOfCentralDirectory])
}

const CRC32_TABLE = buildCRC32Table()

function buildCRC32Table() {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    }
    table[index] = value >>> 0
  }
  return table
}

function crc32(data: Buffer) {
  let value = 0xffffffff
  for (const byte of data) {
    value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

async function writeManifestPluginPackage(packageSourceRoot = pluginInstallRoot()) {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const packageRoot = join(packageSourceRoot, "manifest-lab")
  const versionRoot = join(packageRoot, "0.1.0")
  const manifestRoot = join(versionRoot, ".anybox-plugin")
  const skillRoot = join(versionRoot, "skills", "review")
  const skillReferencesRoot = join(skillRoot, "references")
  const skillScriptsRoot = join(skillRoot, "scripts")
  const skillAssetsRoot = join(skillRoot, "assets")
  await mkdir(manifestRoot, { recursive: true })
  await mkdir(skillRoot, { recursive: true })
  await mkdir(skillReferencesRoot, { recursive: true })
  await mkdir(skillScriptsRoot, { recursive: true })
  await mkdir(skillAssetsRoot, { recursive: true })

  await writeFile(join(skillRoot, "SKILL.md"), [
    "---",
    "name: Review Notes",
    "description: Review docs produced by the manifest lab plugin.",
    "---",
    "",
    "# Review Notes",
    "",
    "Use this skill to review generated documentation notes.",
    "",
  ].join("\n"))
  await writeFile(join(skillReferencesRoot, "checklist.md"), "# Review checklist\n\nVerify the generated notes.\n")
  await writeFile(join(skillScriptsRoot, "inspect.ts"), "export const inspect = () => 'read-only fixture'\n")
  await writeFile(join(skillAssetsRoot, "pixel.png"), Buffer.from(tinyPngBase64, "base64"))

  await writeFile(join(manifestRoot, "plugin.json"), JSON.stringify({
    name: "manifest-lab",
    version: "0.1.0",
    description: "Fixture plugin package with MCP, skills, and API-key backed app connector.",
    author: {
      name: "Anybox Tests",
    },
    interface: {
      displayName: {
        "en-US": "Manifest Lab",
        "zh-CN": "清单实验",
        "zh-TW": "資訊清單實驗室",
        "ja-JP": "マニフェストラボ",
        "ko-KR": "매니페스트 랩",
        "pt-BR": "Laboratório de Manifesto",
      },
      shortDescription: {
        "en-US": "Fixture plugin package.",
        "zh-CN": "用于测试的插件包。",
      },
      longDescription: {
        "en-US": "Fixture plugin package with MCP, skills, and API-key backed app connector.",
        "zh-CN": "包含 MCP、技能和 API key 连接器的测试插件包。",
      },
      developerName: "Anybox Tests",
      category: "Docs",
      logo: "docs",
    },
    mcpServers: [
      {
        id: "notes",
        name: "Manifest Notes",
        risk: "low",
        permissions: ["Starts a fixture stdio MCP server"],
        tools: [
          {
            name: "list_notes",
            description: "List fixture notes.",
            readOnly: true,
          },
        ],
        runtime: {
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          timeoutMs: 1000,
        },
      },
    ],
    skills: "skills",
    apps: [
      {
        appID: "docs",
        name: "Docs API",
        description: "Fixture remote MCP app connector.",
        risk: "medium",
        permissions: ["Sends requests to docs.example.test"],
        tools: [
          {
            name: "search_docs",
            description: "Search fixture docs.",
            readOnly: true,
          },
        ],
        credential: {
          key: "DOCS_API_KEY",
          label: "Docs API key",
          type: "password",
          required: true,
          secret: true,
        },
        runtime: {
          transport: "remote",
          serverUrl: "https://docs.example.test/mcp",
          headers: {
            "x-api-key": "${DOCS_API_KEY}",
          },
          allowedTools: {
            readOnly: true,
          },
          requireApproval: "always",
          timeoutMs: 1000,
        },
      },
    ],
  }, null, 2))

  return packageSourceRoot
}

async function writeOAuthPluginPackage() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const packageSourceRoot = pluginInstallRoot()
  const packageRoot = join(packageSourceRoot, "oauth-lab", "0.1.0")
  const manifestRoot = join(packageRoot, ".anybox-plugin")
  await mkdir(manifestRoot, { recursive: true })

  await writeFile(join(manifestRoot, "plugin.json"), JSON.stringify({
    name: "oauth-lab",
    version: "0.1.0",
    description: "Fixture plugin package with an OAuth app connector.",
    author: "Anybox Tests",
    interface: {
      displayName: "OAuth Lab",
      shortDescription: "OAuth connector fixture.",
      developerName: "Anybox Tests",
      category: "Docs",
    },
    apps: [
      {
        appID: "mail",
        name: "Mail OAuth",
        description: "Fixture OAuth remote MCP app connector.",
        permissions: ["Reads fixture mail metadata"],
        tools: [
          {
            name: "list_mail",
            description: "List fixture mail.",
            readOnly: true,
          },
        ],
        credential: {
          kind: "oauth",
          label: "Mail OAuth",
          clientID: "fixture-client",
          authorizationURL: "https://auth.example.test/authorize",
          tokenURL: "https://auth.example.test/token",
          scopes: ["mail.readonly"],
        },
        runtime: {
          transport: "remote",
          serverUrl: "https://mail.example.test/mcp",
          allowedTools: {
            readOnly: true,
          },
          requireApproval: "never",
        },
      },
    ],
  }, null, 2))

  return packageSourceRoot
}

async function writeDynamicOAuthPluginPackage() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const packageSourceRoot = pluginInstallRoot()
  const packageRoot = join(packageSourceRoot, "dynamic-oauth-lab", "0.1.0")
  const manifestRoot = join(packageRoot, ".anybox-plugin")
  await mkdir(manifestRoot, { recursive: true })

  await writeFile(join(manifestRoot, "plugin.json"), JSON.stringify({
    name: "dynamic-oauth-lab",
    version: "0.1.0",
    description: "Fixture plugin package with dynamic OAuth client registration.",
    author: "Anybox Tests",
    interface: {
      displayName: "Dynamic OAuth Lab",
      shortDescription: "Dynamic OAuth connector fixture.",
      developerName: "Anybox Tests",
      category: "Docs",
    },
    connectors: [
      {
        id: "mail",
        name: "Dynamic Mail OAuth",
        description: "Fixture dynamic OAuth remote MCP connector.",
        configFields: [
          {
            key: "DCR_CLIENT_NAME",
            label: "Dynamic client name",
            type: "text",
            defaultValue: "Dynamic OAuth Lab",
          },
          {
            key: "DCR_INITIAL_ACCESS_TOKEN",
            label: "Registration token",
            type: "password",
            secret: true,
            defaultValue: "registration-token",
          },
        ],
        credential: {
          kind: "oauth",
          label: "Dynamic Mail OAuth",
          authorizationURL: "https://auth.example.test/authorize",
          tokenURL: "https://auth.example.test/token",
          scopes: ["mail.readonly"],
          registration: {
            registrationURL: "https://auth.example.test/register",
            initialAccessToken: "${DCR_INITIAL_ACCESS_TOKEN}",
            metadata: {
              client_name: "${DCR_CLIENT_NAME}",
              application_type: "native",
              token_endpoint_auth_method: "client_secret_post",
            },
          },
        },
        runtime: {
          transport: "remote",
          serverUrl: "https://mail.example.test/mcp",
          allowedTools: {
            readOnly: true,
          },
          requireApproval: "never",
        },
      },
    ],
  }, null, 2))

  return packageSourceRoot
}

async function writeLocalConnectorPluginPackage() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const packageSourceRoot = pluginInstallRoot()
  const packageRoot = join(packageSourceRoot, "local-connector-lab", "0.1.0")
  const manifestRoot = join(packageRoot, ".anybox-plugin")
  const connectorRoot = join(packageRoot, "connectors", "docs-local")
  await mkdir(manifestRoot, { recursive: true })
  await mkdir(connectorRoot, { recursive: true })
  await writeFile(join(connectorRoot, "server.js"), "console.error('fixture local connector server')\n")

  await writeFile(join(manifestRoot, "plugin.json"), JSON.stringify({
    name: "local-connector-lab",
    version: "0.1.0",
    description: "Fixture plugin package with a local stdio connector.",
    author: "Anybox Tests",
    interface: {
      displayName: "Local Connector Lab",
      shortDescription: "Local connector fixture.",
      developerName: "Anybox Tests",
      category: "Docs",
    },
    connectors: [
      {
        id: "docs-local",
        name: "Docs Local",
        description: "Fixture local MCP connector.",
        permissions: ["Starts a local fixture MCP wrapper"],
        tools: [
          {
            name: "search_local_docs",
            description: "Search local docs.",
            readOnly: true,
          },
        ],
        credential: {
          kind: "api_key",
          key: "DOCS_API_KEY",
          label: "Docs local key",
          type: "password",
          required: true,
          secret: true,
        },
        runtime: {
          transport: "stdio",
          command: "node",
          args: ["${PLUGIN_ROOT}/connectors/docs-local/server.js"],
          cwd: "${PLUGIN_ROOT}",
          env: {
            DOCS_API_KEY: "${DOCS_API_KEY}",
          },
          timeoutMs: 1000,
        },
      },
    ],
  }, null, 2))

  return packageSourceRoot
}

async function writeConnectorRegistryFile() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const registryPath = join(activeRoot, "connectors.json")
  await writeFile(registryPath, JSON.stringify({
    schemaVersion: 1,
    connectors: [
      {
        id: "docs",
        name: "Docs",
        description: "Platform-owned docs connector.",
        publisher: "Anybox",
        risk: "medium",
        permissions: ["Sends requests to docs.example.test"],
        tools: [
          {
            name: "search_docs",
            description: "Search fixture docs.",
            readOnly: true,
          },
        ],
        credential: {
          kind: "api_key",
          key: "DOCS_API_KEY",
          label: "Docs API key",
          type: "password",
          required: true,
          secret: true,
        },
        runtime: {
          transport: "remote",
          serverUrl: "https://docs.example.test/mcp",
          headers: {
            "x-api-key": "${DOCS_API_KEY}",
          },
          allowedTools: {
            readOnly: true,
          },
          requireApproval: "always",
        },
      },
    ],
  }, null, 2))
  process.env.ANYBOX_CONNECTOR_REGISTRY_FILES = registryPath
  return registryPath
}

async function writeMultiRuntimeConnectorRegistryFile(includeSearchRuntime = true) {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const registryPath = join(activeRoot, "connectors-v2.json")
  const mcpRuntimes = [
    {
      id: "default",
      name: "Multi Docs",
      transport: "remote",
      serverUrl: "https://docs.example.test/mcp",
      headers: {
        "x-api-key": "${DOCS_API_KEY}",
      },
    },
    ...(includeSearchRuntime
      ? [
          {
            id: "search",
            name: "Multi Docs Search",
            transport: "remote",
            serverUrl: "https://search.docs.example.test/mcp",
            headers: {
              "x-api-key": "${DOCS_API_KEY}",
            },
          },
        ]
      : []),
  ]

  await writeFile(registryPath, JSON.stringify({
    schemaVersion: 2,
    connectors: [
      {
        id: "multi-docs",
        category: "account_connector",
        name: "Multi Docs",
        description: "Connector with multiple MCP runtimes.",
        publisher: "Anybox",
        risk: "medium",
        permissions: ["Sends requests to docs.example.test"],
        tools: [
          {
            name: "search_docs",
            description: "Search fixture docs.",
            readOnly: true,
          },
        ],
        credential: {
          kind: "api_key",
          key: "DOCS_API_KEY",
          label: "Docs API key",
          type: "password",
          required: true,
          secret: true,
        },
        mcpRuntimes,
      },
    ],
  }, null, 2))
  process.env.ANYBOX_CONNECTOR_REGISTRY_FILES = registryPath
  return registryPath
}

async function writePlatformConnectorRequirementPluginPackage() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const packageSourceRoot = pluginInstallRoot()
  const packageRoot = join(packageSourceRoot, "connector-requirement-lab", "0.1.0")
  const manifestRoot = join(packageRoot, ".anybox-plugin")
  await mkdir(manifestRoot, { recursive: true })

  await writeFile(join(manifestRoot, "plugin.json"), JSON.stringify({
    name: "connector-requirement-lab",
    version: "0.1.0",
    description: "Fixture plugin package that depends on a platform connector.",
    author: "Anybox Tests",
    interface: {
      displayName: "Connector Requirement Lab",
      shortDescription: "Platform connector requirement fixture.",
      developerName: "Anybox Tests",
      category: "Docs",
    },
    connectorRequirements: [
      {
        connector: "docs",
        runtimeIDs: ["default"],
        tools: ["search_docs"],
        permissions: ["Sends requests to docs.example.test"],
        required: true,
        reason: "Search official docs through the platform connector.",
      },
    ],
  }, null, 2))

  return packageSourceRoot
}

async function writeConfigRequiredPluginPackage() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const packageSourceRoot = pluginInstallRoot()
  const packageRoot = join(packageSourceRoot, "config-lab", "0.1.0")
  const manifestRoot = join(packageRoot, ".anybox-plugin")
  await mkdir(manifestRoot, { recursive: true })

  await writeFile(join(manifestRoot, "plugin.json"), JSON.stringify({
    name: "config-lab",
    version: "0.1.0",
    description: "Fixture plugin package with a required MCP configuration field.",
    author: "Anybox Tests",
    interface: {
      displayName: "Config Lab",
      shortDescription: "Configuration fixture package.",
      developerName: "Anybox Tests",
      category: "Docs",
    },
    mcpServers: [
      {
        id: "docs",
        name: "Config Docs",
        risk: "low",
        configFields: [
          {
            key: "DOCS_TOKEN",
            label: "Docs token",
            type: "password",
            required: true,
            secret: true,
          },
        ],
        tools: [
          {
            name: "search_docs",
            description: "Search docs.",
            readOnly: true,
          },
        ],
        runtime: {
          transport: "remote",
          serverUrl: "https://docs.example.test/mcp",
          headers: {
            authorization: "Bearer ${DOCS_TOKEN}",
          },
          allowedTools: {
            readOnly: true,
          },
          requireApproval: "never",
        },
      },
    ],
  }, null, 2))

  return packageSourceRoot
}

async function writeLocalSourcePluginPackage() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const packageSourceRoot = pluginLocalRoot()
  const packageRoot = join(packageSourceRoot, "local-source-lab")
  const manifestRoot = join(packageRoot, ".anybox-plugin")
  const skillRoot = join(packageRoot, "skills", "local-review")
  const ignoredDependencyRoot = join(packageRoot, "node_modules", "ignored-dependency")
  await mkdir(manifestRoot, { recursive: true })
  await mkdir(skillRoot, { recursive: true })
  await mkdir(ignoredDependencyRoot, { recursive: true })

  await writeFile(join(skillRoot, "SKILL.md"), [
    "---",
    "name: Local Review",
    "description: Review docs produced by the local source plugin.",
    "---",
    "",
    "# Local Review",
    "",
    "Use this skill to review local plugin output.",
    "",
  ].join("\n"))

  await writeFile(join(manifestRoot, "plugin.json"), JSON.stringify({
    name: "local-source-lab",
    version: "0.1.0",
    description: "Fixture plugin package from the local plugin source root.",
    author: "Anybox Tests",
    interface: {
      displayName: "Local Source Lab",
      shortDescription: "Local plugin source fixture.",
      developerName: "Anybox Tests",
      category: "Docs",
      logo: "LS",
    },
    skills: "skills",
  }, null, 2))
  await writeFile(join(ignoredDependencyRoot, "index.js"), "export default 'development-only'\n")

  return packageRoot
}

async function writeRelativeAssetPluginPackage() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const packageSourceRoot = pluginInstallRoot()
  const packageRoot = join(packageSourceRoot, "asset-lab", "0.1.0")
  const manifestRoot = join(packageRoot, ".anybox-plugin")
  const assetsRoot = join(packageRoot, "assets")
  await mkdir(manifestRoot, { recursive: true })
  await mkdir(assetsRoot, { recursive: true })

  const tinyPng = Buffer.from(tinyPngBase64, "base64")
  await writeFile(join(assetsRoot, "icon.png"), tinyPng)
  await writeFile(join(assetsRoot, "logo.png"), tinyPng)

  await writeFile(join(manifestRoot, "plugin.json"), JSON.stringify({
    name: "asset-lab",
    version: "0.1.0",
    description: "Fixture plugin package with package-relative visual assets.",
    author: "Anybox Tests",
    interface: {
      displayName: "Asset Lab",
      shortDescription: "Local visual asset fixture.",
      developerName: "Anybox Tests",
      category: "Design",
      composerIcon: "./assets/icon.png",
      logo: "./assets/logo.png",
      thumbnailUrl: "./assets/logo.png",
      heroImageUrl: "./assets/logo.png",
      screenshots: [
        "./assets/icon.png",
        "../outside.png",
        "./assets/missing.png",
      ],
    },
  }, null, 2))

  return packageRoot
}

async function writeChromePluginPackage() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const packageSourceRoot = pluginInstallRoot()
  const packageRoot = join(packageSourceRoot, "chrome", "0.4.0")
  const chromePluginRoot = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "plugins",
    "Anybox-Plugins",
    "chrome",
  )
  await cp(chromePluginRoot, packageRoot, { recursive: true })

  return packageSourceRoot
}

async function writeLegacyChromePluginPackage() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const packageSourceRoot = pluginInstallRoot()
  const packageRoot = join(packageSourceRoot, "chrome", "0.1.0")
  const manifestRoot = join(packageRoot, ".anybox-plugin")
  await mkdir(manifestRoot, { recursive: true })
  await writeFile(join(manifestRoot, "plugin.json"), JSON.stringify({
    name: "chrome",
    version: "0.1.0",
    description: "Legacy Chrome plugin backed by platform connectors.",
    connectorRequirements: [
      {
        connector: "browser",
        required: true,
        reason: "Legacy Browser connector requirement.",
      },
      {
        connector: "node-repl",
        required: true,
        reason: "Legacy Node REPL connector requirement.",
      },
    ],
  }, null, 2))

  return packageRoot
}

async function writeCriticalPluginPackage() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const packageSourceRoot = pluginInstallRoot()
  const packageRoot = join(packageSourceRoot, "critical-lab")
  const manifestRoot = join(packageRoot, ".anybox-plugin")
  await mkdir(manifestRoot, { recursive: true })

  await writeFile(join(manifestRoot, "plugin.json"), JSON.stringify({
    name: "critical-lab",
    version: "0.1.0",
    description: "Fixture plugin package with a critical-risk MCP binding.",
    author: "Anybox Tests",
    interface: {
      displayName: "Critical Lab",
      shortDescription: "Critical fixture package.",
      developerName: "Anybox Tests",
      category: "Code",
    },
    mcpServers: [
      {
        id: "danger",
        name: "Critical Danger",
        risk: "critical",
        permissions: ["Fixture critical-risk capability"],
        tools: [
          {
            name: "dangerous_write",
            description: "Fixture destructive write.",
            readOnly: false,
            destructive: true,
          },
        ],
        runtime: {
          transport: "stdio",
          command: "node",
          args: ["danger.js"],
        },
      },
    ],
  }, null, 2))

  return packageSourceRoot
}

async function writeVersionedPluginPackage() {
  if (!activeRoot) throw new Error("Temp root has not been initialized.")

  const packageSourceRoot = pluginInstallRoot()
  const packageRoot = join(packageSourceRoot, "version-lab")
  const versions = [
    ["0.1.0", "Version Lab Old"],
    ["0.2.0", "Version Lab New"],
  ] as const

  for (const [version, displayName] of versions) {
    const manifestRoot = join(packageRoot, version, ".anybox-plugin")
    await mkdir(manifestRoot, { recursive: true })
    await writeFile(join(manifestRoot, "plugin.json"), JSON.stringify({
      name: "version-lab",
      version,
      description: `${displayName} fixture plugin.`,
      author: "Anybox Tests",
      interface: {
        displayName,
        shortDescription: `${displayName} fixture.`,
        developerName: "Anybox Tests",
        category: "Docs",
      },
      mcpServers: [
        {
          id: "notes",
          name: displayName,
          risk: "low",
          tools: [
            {
              name: "list_notes",
              description: "List fixture notes.",
              readOnly: true,
            },
          ],
          runtime: {
            transport: "stdio",
            command: "node",
            args: [`server-${version}.js`],
          },
        },
      ],
    }, null, 2))
  }

  return packageSourceRoot
}

afterEach(async () => {
  await Auth.clearProvider("plugin-app:manifest-lab:docs")
  await Auth.clearProvider("plugin-app:oauth-lab:mail")
  await Auth.clearProvider("plugin-connector:manifest-lab:docs")
  await Auth.clearProvider("plugin-connector:oauth-lab:mail")
  await Auth.clearProvider("plugin-connector:local-connector-lab:docs-local")
  await Auth.clearProvider("plugin-connector:dynamic-oauth-lab:mail")
  await Auth.clearProvider("plugin-connector:gmail:gmail")
  await Auth.clearProvider("connector:docs:default")
  if (previousPluginLocalDir === undefined) {
    delete process.env.ANYBOX_PLUGIN_LOCAL_DIR
  } else {
    process.env.ANYBOX_PLUGIN_LOCAL_DIR = previousPluginLocalDir
  }
  if (previousPluginInstallDir === undefined) {
    delete process.env.ANYBOX_PLUGIN_INSTALL_DIR
  } else {
    process.env.ANYBOX_PLUGIN_INSTALL_DIR = previousPluginInstallDir
  }
  if (previousPluginRegistryIndexURL === undefined) {
    delete process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL
  } else {
    process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL = previousPluginRegistryIndexURL
  }
  if (previousPluginRegistryCacheDir === undefined) {
    delete process.env.ANYBOX_PLUGIN_REGISTRY_CACHE_DIR
  } else {
    process.env.ANYBOX_PLUGIN_REGISTRY_CACHE_DIR = previousPluginRegistryCacheDir
  }
  if (previousPluginImportedRegistryFile === undefined) {
    delete process.env.ANYBOX_PLUGIN_IMPORTED_REGISTRY_FILE
  } else {
    process.env.ANYBOX_PLUGIN_IMPORTED_REGISTRY_FILE = previousPluginImportedRegistryFile
  }
  if (previousConnectorRegistryFiles === undefined) {
    delete process.env.ANYBOX_CONNECTOR_REGISTRY_FILES
  } else {
    process.env.ANYBOX_CONNECTOR_REGISTRY_FILES = previousConnectorRegistryFiles
  }
  if (previousConnectorBuildConfig === undefined) {
    delete process.env.ANYBOX_CONNECTOR_BUILD_CONFIG
  } else {
    process.env.ANYBOX_CONNECTOR_BUILD_CONFIG = previousConnectorBuildConfig
  }
  if (previousGmailOAuthClientID === undefined) {
    delete process.env.ANYBOX_GMAIL_OAUTH_CLIENT_ID
  } else {
    process.env.ANYBOX_GMAIL_OAUTH_CLIENT_ID = previousGmailOAuthClientID
  }
  if (previousGmailOAuthClientSecret === undefined) {
    delete process.env.ANYBOX_GMAIL_OAUTH_CLIENT_SECRET
  } else {
    process.env.ANYBOX_GMAIL_OAUTH_CLIENT_SECRET = previousGmailOAuthClientSecret
  }
  if (previousLegacyGmailOAuthClientID === undefined) {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID
  } else {
    process.env.GOOGLE_OAUTH_CLIENT_ID = previousLegacyGmailOAuthClientID
  }
  if (previousLegacyGmailOAuthClientSecret === undefined) {
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
  } else {
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = previousLegacyGmailOAuthClientSecret
  }
  if (previousFetch) {
    globalThis.fetch = previousFetch
  }
  previousPluginLocalDir = undefined
  previousPluginInstallDir = undefined
  previousPluginRegistryIndexURL = undefined
  previousPluginRegistryCacheDir = undefined
  previousPluginImportedRegistryFile = undefined
  previousConnectorRegistryFiles = undefined
  previousConnectorBuildConfig = undefined
  previousGmailOAuthClientID = undefined
  previousGmailOAuthClientSecret = undefined
  previousLegacyGmailOAuthClientID = undefined
  previousLegacyGmailOAuthClientSecret = undefined
  previousFetch = undefined
  Sqlite.closeDatabase()
  Sqlite.setDatabaseFile()
  Sqlite.closeDatabase()
  if (activeRoot) {
    await removeTreeWithRetry(activeRoot).catch(() => undefined)
    activeRoot = null
  }
})

describe("plugin marketplace API", () => {
  test("returns installed plugin package catalog entries without critical risk entries", async () => {
    await useTempDatabase()
    await writeManifestPluginPackage()
    const app = createServerApp()

    const response = await app.request("/api/plugins/catalog")
    const body = (await response.json()) as PluginCatalogEnvelope

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data?.length).toBeGreaterThan(0)
    expect(body.data?.some((plugin) => plugin.id === "manifest-lab")).toBe(true)
    expect(body.data?.every((plugin) => plugin.risk !== "critical")).toBe(true)
    expect(body.data?.every((plugin) =>
      plugin.mcpServers.length + plugin.skills.length + plugin.connectorRequirements.length + plugin.apps.length > 0
    )).toBe(true)

    const manifestPlugin = body.data?.find((plugin) => plugin.id === "manifest-lab")
    expect(manifestPlugin?.source).toBe("package")
    expect(manifestPlugin?.installable).toBe(true)
    expect(manifestPlugin?.skills.map((skill) => skill.directory)).toEqual(["review"])
  })

  test("loads local plugin manifests with external apps, mcpServers, and hooks files", async () => {
    await useTempDatabase()
    const packageRoot = join(pluginLocalRoot(), "external-component-lab", "0.1.0")
    await mkdir(packageRoot, { recursive: true })
    await writeFile(join(packageRoot, "plugin.json"), JSON.stringify({
      name: "external-component-lab",
      version: "0.1.0",
      description: "Fixture plugin package with external manifest components.",
      mcpServers: "./.mcp.json",
      apps: "./.app.json",
      hooks: "./.hooks.json",
      skills: [],
    }, null, 2))
    await writeFile(join(packageRoot, ".mcp.json"), JSON.stringify({
      mcpServers: [
        {
          id: "notes",
          name: "External Notes",
          risk: "low",
          tools: [
            {
              name: "list_notes",
              description: "List fixture notes.",
              readOnly: true,
            },
          ],
          runtime: {
            transport: "stdio",
            command: "node",
            args: ["server.js"],
            timeoutMs: 1000,
          },
        },
      ],
    }, null, 2))
    await writeFile(join(packageRoot, ".app.json"), JSON.stringify({
      apps: {
        docs: {
          name: "Docs API",
          description: "Fixture external app connector.",
          credential: {
            key: "DOCS_API_KEY",
            label: "Docs API key",
            type: "password",
            required: true,
            secret: true,
          },
          runtime: {
            transport: "remote",
            serverUrl: "https://docs.example.test/mcp",
            headers: {
              "x-api-key": "${DOCS_API_KEY}",
            },
            allowedTools: {
              readOnly: true,
            },
            requireApproval: "never",
          },
        },
      },
    }, null, 2))
    await writeFile(join(packageRoot, ".hooks.json"), JSON.stringify({
      hooks: [
        {
          event: "install",
          command: "node scripts/hook.js",
        },
      ],
    }, null, 2))

    const app = createServerApp()
    const catalogResponse = await app.request("/api/plugins/catalog")
    const catalogBody = (await catalogResponse.json()) as PluginCatalogEnvelope
    const plugin = catalogBody.data?.find((item) => item.id === "external-component-lab")

    expect(catalogResponse.status).toBe(200)
    expect(plugin?.mcpServers.map((server) => server.id)).toEqual(["notes"])
    expect(plugin?.apps.map((entry) => entry.appID)).toEqual(["docs"])
    expect(plugin?.connectors.map((entry) => entry.appID)).toEqual(["docs"])

    const installResponse = await app.request("/api/plugins/installed/external-component-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope

    expect(installResponse.status).toBe(200)
    expect(installBody.data?.mcpServerIDs).toEqual([
      "plugin.external-component-lab.notes",
      "plugin.external-component-lab.connector.docs",
    ])
    expect(installBody.data?.connectorIDs).toEqual(["plugin-connector:external-component-lab:docs"])
  })

  test("preserves registry localization when package metadata wins catalog merge", async () => {
    await useTempDatabase()
    const packageSourceRoot = await writeManifestPluginPackage()
    await writeFile(join(packageSourceRoot, "manifest-lab", "0.1.0", ".anybox-plugin", "plugin.json"), JSON.stringify({
      name: "manifest-lab",
      version: "0.1.0",
      description: "Legacy package description.",
      author: "Anybox Tests",
      interface: {
        displayName: "Legacy Manifest Lab",
        shortDescription: "Legacy package short description.",
        longDescription: "Legacy package long description.",
        developerName: "Anybox Tests",
        category: "Docs",
        logo: "docs",
      },
      skills: "skills",
    }, null, 2))

    const registryPath = join(activeRoot!, "plugin-registry.json")
    await writeFile(registryPath, JSON.stringify({
      schemaVersion: 1,
      plugins: [
        {
          id: "manifest-lab",
          name: "manifest-lab",
          version: "0.1.0",
          description: "Registry package description.",
          author: "Registry Tests",
          interface: {
            displayName: {
              "en-US": "Registry Manifest Lab",
              "zh-CN": "注册表清单实验",
            },
            shortDescription: {
              "en-US": "Registry short description.",
              "zh-CN": "注册表短描述。",
            },
            longDescription: {
              "en-US": "Registry long description.",
              "zh-CN": "注册表长描述。",
            },
            developerName: "Registry Tests",
            category: "Docs",
          },
        },
      ],
    }, null, 2))
    process.env.ANYBOX_PLUGIN_REGISTRY_FILES = registryPath

    const app = createServerApp()
    const response = await app.request("/api/plugins/catalog")
    const body = (await response.json()) as PluginCatalogEnvelope
    const manifestPlugin = body.data?.find((plugin) => plugin.id === "manifest-lab")

    expect(response.status).toBe(200)
    expect(manifestPlugin?.source).toBe("package")
    expect(manifestPlugin?.name).toBe("Legacy Manifest Lab")
    expect(manifestPlugin?.description).toBe("Legacy package short description.")
    expect(manifestPlugin?.localized?.name?.["zh-CN"]).toBe("注册表清单实验")
    expect(manifestPlugin?.localized?.description?.["zh-CN"]).toBe("注册表短描述。")
    expect(manifestPlugin?.localized?.longDescription?.["zh-CN"]).toBe("注册表长描述。")
  })

  test("resolves package-relative visual assets to displayable data URLs", async () => {
    await useTempDatabase()
    await writeRelativeAssetPluginPackage()
    const app = createServerApp()

    const response = await app.request("/api/plugins/catalog")
    const body = (await response.json()) as PluginCatalogEnvelope
    const assetPlugin = body.data?.find((plugin) => plugin.id === "asset-lab")
    const expectedDataUrl = `data:image/png;base64,${tinyPngBase64}`

    expect(response.status).toBe(200)
    expect(assetPlugin?.source).toBe("package")
    expect(assetPlugin?.iconUrl).toBe(expectedDataUrl)
    expect(assetPlugin?.thumbnailUrl).toBe(expectedDataUrl)
    expect(assetPlugin?.heroImageUrl).toBe(expectedDataUrl)
    expect(assetPlugin?.screenshots).toEqual([expectedDataUrl])
  })

  test("installs packages from the fixed local plugin repository without deleting the source on uninstall", async () => {
    await useTempDatabase()
    const localPackageRoot = await writeLocalSourcePluginPackage()
    const installedPackageRoot = join(pluginInstallRoot(), "local-source-lab", "0.1.0")
    const app = createServerApp()

    const catalogResponse = await app.request("/api/plugins/catalog")
    const catalogBody = (await catalogResponse.json()) as PluginCatalogEnvelope
    const localPlugin = catalogBody.data?.find((plugin) => plugin.id === "local-source-lab")

    expect(catalogResponse.status).toBe(200)
    expect(localPlugin?.source).toBe("package")
    expect(localPlugin?.installable).toBe(true)
    expect(localPlugin?.skills.map((skill) => skill.directory)).toEqual(["local-review"])

    const installResponse = await app.request("/api/plugins/installed/local-source-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope

    expect(installResponse.status).toBe(200)
    expect(installBody.data?.skillIDs).toEqual(["plugin:local-source-lab:local-review"])
    expect(existsSync(installedPackageRoot)).toBe(true)
    expect(existsSync(join(installedPackageRoot, "plugin.json"))).toBe(false)
    expect(existsSync(join(installedPackageRoot, ".anybox-plugin", "plugin.json"))).toBe(true)
    expect(existsSync(join(localPackageRoot, "node_modules", "ignored-dependency", "index.js"))).toBe(true)
    expect(existsSync(join(installedPackageRoot, "node_modules"))).toBe(false)

    const deleteResponse = await app.request("/api/plugins/installed/local-source-lab", {
      method: "DELETE",
    })
    const deleteBody = (await deleteResponse.json()) as DeletePluginEnvelope

    expect(deleteResponse.status).toBe(200)
    expect(deleteBody.data?.removed).toBe(true)
    expect(existsSync(localPackageRoot)).toBe(true)
    expect(existsSync(installedPackageRoot)).toBe(false)
  })

  test("loads remote plugin metadata from an index URL and falls back to cached metadata", async () => {
    await useTempDatabase()
    const app = createServerApp()
    process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "https://registry.example.test/index.json"

    const remotePluginMeta = {
      name: "remote-lab",
      version: "1.2.3",
      description: "Remote fixture plugin.",
      author: "Remote Tests",
      keywords: ["remote"],
      interface: {
        displayName: "Remote Lab",
        shortDescription: "Remote fixture.",
        longDescription: "Remote fixture marketplace details.",
        developerName: "Remote Tests",
        category: "Docs",
        iconUrl: "https://cdn.example.test/remote-icon.png",
        thumbnailUrl: "./relative-thumbnail.png",
        screenshots: [
          "./relative-screenshot.png",
          "https://cdn.example.test/remote-lab.png",
        ],
      },
      package: {
        type: "zip",
        url: "https://cdn.example.test/remote-lab.zip",
        sha256: "a".repeat(64),
      },
      mcpServers: [
        {
          id: "docs",
          name: "Remote Docs",
          risk: "low",
          tools: [
            {
              name: "search_remote_docs",
              description: "Search remote docs.",
              readOnly: true,
            },
          ],
          runtime: {
            transport: "remote",
            serverUrl: "https://docs.example.test/mcp",
            allowedTools: {
              readOnly: true,
            },
            requireApproval: "never",
          },
        },
      ],
    }

    let failNetwork = false
    let fetchCount = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
      fetchCount += 1
      if (failNetwork) throw new Error("offline")

      const url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : input.url
      if (url === "https://registry.example.test/index.json") {
        return new Response(JSON.stringify(["https://plugins.example.test/remote-lab/.anybox-plugin/plugin.json"]), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      }
      if (url === "https://plugins.example.test/remote-lab/.anybox-plugin/plugin.json") {
        return new Response(JSON.stringify(remotePluginMeta), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      }

      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const firstResponse = await app.request("/api/plugins/catalog")
    const firstBody = (await firstResponse.json()) as PluginCatalogEnvelope
    const firstRemotePlugin = firstBody.data?.find((plugin) => plugin.id === "remote-lab")

    expect(firstResponse.status).toBe(200)
    expect(firstRemotePlugin?.name).toBe("Remote Lab")
    expect(firstRemotePlugin?.source).toBe("registry")
    expect(firstRemotePlugin?.installable).toBe(true)
    expect(firstRemotePlugin?.download?.url).toBe("https://cdn.example.test/remote-lab.zip")
    expect(firstRemotePlugin?.iconUrl).toBe("https://cdn.example.test/remote-icon.png")
    expect(firstRemotePlugin?.thumbnailUrl).toBe("https://plugins.example.test/remote-lab/relative-thumbnail.png")
    expect(firstRemotePlugin?.heroImageUrl).toBe("https://plugins.example.test/remote-lab/relative-thumbnail.png")
    expect(firstRemotePlugin?.screenshots).toEqual([
      "https://plugins.example.test/remote-lab/relative-screenshot.png",
      "https://cdn.example.test/remote-lab.png",
    ])

    const fetchCountBeforeCachedMode = fetchCount
    const cachedModeResponse = await app.request("/api/plugins/catalog?freshness=cached")
    const cachedModeBody = (await cachedModeResponse.json()) as PluginCatalogEnvelope
    const cachedModeRemotePlugin = cachedModeBody.data?.find((plugin) => plugin.id === "remote-lab")

    expect(cachedModeResponse.status).toBe(200)
    expect(cachedModeRemotePlugin?.name).toBe("Remote Lab")
    expect(fetchCount).toBe(fetchCountBeforeCachedMode)

    failNetwork = true
    const cachedResponse = await app.request("/api/plugins/catalog")
    const cachedBody = (await cachedResponse.json()) as PluginCatalogEnvelope
    const cachedRemotePlugin = cachedBody.data?.find((plugin) => plugin.id === "remote-lab")

    expect(cachedResponse.status).toBe(200)
    expect(cachedRemotePlugin?.name).toBe("Remote Lab")
  })

  test("loads multiple cached and imported registry plugins without treating indexes as manifest URLs", async () => {
    await useTempDatabase()
    if (!activeRoot) throw new Error("Temp root has not been initialized.")
    const app = createServerApp()

    const registryFor = (items: Array<{ id: string; name: string }>) => ({
      schemaVersion: 1,
      plugins: items.map((item) => ({
        id: item.id,
        name: item.id,
        version: "1.0.0",
        description: `${item.name} registry plugin.`,
        interface: {
          displayName: item.name,
          shortDescription: `${item.name} catalog entry.`,
          category: "Docs",
          logo: "./assets/icon.png",
        },
        mcpServers: [],
        skills: [],
      })),
    })

    const cacheDir = process.env.ANYBOX_PLUGIN_REGISTRY_CACHE_DIR
    const importedRegistryFile = process.env.ANYBOX_PLUGIN_IMPORTED_REGISTRY_FILE
    if (!cacheDir || !importedRegistryFile) throw new Error("Plugin registry paths were not configured.")

    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, "plugin-registry-cache.json"), JSON.stringify(registryFor([
      { id: "cached-one", name: "Cached One" },
      { id: "cached-two", name: "Cached Two" },
    ])))
    await writeFile(importedRegistryFile, JSON.stringify(registryFor([
      { id: "imported-one", name: "Imported One" },
      { id: "imported-two", name: "Imported Two" },
    ])))

    const response = await app.request("/api/plugins/catalog?freshness=cached")
    const body = (await response.json()) as PluginCatalogEnvelope
    const namesByID = new Map((body.data ?? []).map((plugin) => [plugin.id, plugin.name]))

    expect(response.status).toBe(200)
    expect(namesByID.get("cached-one")).toBe("Cached One")
    expect(namesByID.get("cached-two")).toBe("Cached Two")
    expect(namesByID.get("imported-one")).toBe("Imported One")
    expect(namesByID.get("imported-two")).toBe("Imported Two")
  })

  test("loads cached remote registry metadata with multiple entries", async () => {
    await useTempDatabase()
    const cachePath = join(process.env.ANYBOX_PLUGIN_REGISTRY_CACHE_DIR!, "plugin-registry-cache.json")
    await mkdir(process.env.ANYBOX_PLUGIN_REGISTRY_CACHE_DIR!, { recursive: true })
    await writeFile(cachePath, JSON.stringify({
      schemaVersion: 1,
      plugins: [
        {
          name: "cached-alpha",
          version: "1.0.0",
          description: "First cached plugin.",
          interface: {
            displayName: "Cached Alpha",
            shortDescription: "First cached plugin.",
            category: "Docs",
          },
          mcpServers: [],
          skills: [],
        },
        {
          name: "cached-beta",
          version: "1.0.0",
          description: "Second cached plugin.",
          interface: {
            displayName: "Cached Beta",
            shortDescription: "Second cached plugin.",
            category: "Automation",
          },
          mcpServers: [],
          skills: [],
        },
      ],
    }, null, 2))

    const app = createServerApp()
    const response = await app.request("/api/plugins/catalog?freshness=cached")
    const body = (await response.json()) as PluginCatalogEnvelope

    expect(response.status).toBe(200)
    expect(body.data?.find((plugin) => plugin.id === "cached-alpha")?.name).toBe("Cached Alpha")
    expect(body.data?.find((plugin) => plugin.id === "cached-beta")?.name).toBe("Cached Beta")
  })

  test("shows remote metadata without a package as catalog-only", async () => {
    await useTempDatabase()
    const app = createServerApp()
    process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "https://registry.example.test/index.json"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : input.url
      if (url === "https://registry.example.test/index.json") {
        return new Response(JSON.stringify(["https://plugins.example.test/meta-only/.anybox-plugin/plugin.json"]), { status: 200 })
      }
      if (url === "https://plugins.example.test/meta-only/.anybox-plugin/plugin.json") {
        return new Response(JSON.stringify({
          name: "meta-only",
          version: "1.0.0",
          description: "Remote plugin without a package.",
          interface: {
            displayName: "Meta Only",
            shortDescription: "Catalog only.",
            category: "Docs",
          },
          mcpServers: [],
          skills: [],
        }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const response = await app.request("/api/plugins/catalog")
    const body = (await response.json()) as PluginCatalogEnvelope
    const plugin = body.data?.find((item) => item.id === "meta-only")

    expect(response.status).toBe(200)
    expect(plugin?.name).toBe("Meta Only")
    expect(plugin?.installable).toBe(false)
  })

  test("does not resolve legacy remote registry directory URLs", async () => {
    await useTempDatabase()
    const app = createServerApp()
    process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "https://registry.example.test/index.json"
    let manifestRequestCount = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : input.url
      if (url === "https://registry.example.test/index.json") {
        return new Response(JSON.stringify(["https://plugins.example.test/root-manifest"]), { status: 200 })
      }
      if (url.startsWith("https://plugins.example.test/root-manifest/")) {
        manifestRequestCount += 1
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const response = await app.request("/api/plugins/catalog")
    const body = (await response.json()) as PluginCatalogEnvelope
    const plugin = body.data?.find((item) => item.id === "root-manifest")

    expect(response.status).toBe(200)
    expect(plugin).toBeUndefined()
    expect(manifestRequestCount).toBe(0)
  })

  test("loads remote metadata from root plugin.json URLs in the registry index", async () => {
    await useTempDatabase()
    const app = createServerApp()
    process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "https://registry.example.test/index.json"
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : input.url
      if (url === "https://registry.example.test/index.json") {
        return new Response(JSON.stringify(["https://plugins.example.test/root-lab/plugin.json"]), { status: 200 })
      }
      if (url === "https://plugins.example.test/root-lab/plugin.json") {
        return new Response(JSON.stringify({
          name: "root-lab",
          version: "1.0.0",
          description: "Remote plugin described by a root plugin.json URL.",
          interface: {
            displayName: "Root Lab",
            shortDescription: "Root manifest catalog entry.",
            category: "Docs",
            logo: "./assets/icon.png",
          },
          mcpServers: [],
          skills: [],
        }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const response = await app.request("/api/plugins/catalog")
    const body = (await response.json()) as PluginCatalogEnvelope
    const plugin = body.data?.find((item) => item.id === "root-lab")

    expect(response.status).toBe(200)
    expect(plugin?.name).toBe("Root Lab")
    expect(plugin?.iconUrl).toBe("https://plugins.example.test/root-lab/assets/icon.png")
  })

  test("loads remote metadata from direct .anybox-plugin/plugin.json URLs in the registry index", async () => {
    await useTempDatabase()
    const app = createServerApp()
    process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "https://registry.example.test/index.json"
    let requestedRawGitHubURL = false

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : input.url
      if (url === "https://registry.example.test/index.json") {
        return new Response(JSON.stringify([
          "https://plugins.example.test/direct-lab/.anybox-plugin/plugin.json",
          "https://github.com/fanfan-de/anybox/blob/master/plugins/Anybox-Plugins/blob-lab/.anybox-plugin/plugin.json",
        ]), { status: 200 })
      }
      if (url === "https://plugins.example.test/direct-lab/.anybox-plugin/plugin.json") {
        return new Response(JSON.stringify({
          name: "direct-lab",
          version: "1.0.0",
          description: "Remote plugin described by a direct plugin.json URL.",
          interface: {
            displayName: "Direct Lab",
            shortDescription: "Direct manifest catalog entry.",
            category: "Docs",
            logo: "./assets/icon.png",
            screenshots: ["./assets/screenshot.png"],
          },
          mcpServers: [],
          skills: [],
        }), { status: 200 })
      }
      if (url === "https://raw.githubusercontent.com/fanfan-de/anybox/master/plugins/Anybox-Plugins/blob-lab/.anybox-plugin/plugin.json") {
        requestedRawGitHubURL = true
        return new Response(JSON.stringify({
          name: "blob-lab",
          version: "1.0.0",
          description: "Remote plugin described by a GitHub blob URL.",
          interface: {
            displayName: "Blob Lab",
            shortDescription: "GitHub blob URL catalog entry.",
            category: "Docs",
          },
          mcpServers: [],
          skills: [],
        }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const response = await app.request("/api/plugins/catalog")
    const body = (await response.json()) as PluginCatalogEnvelope
    const directPlugin = body.data?.find((item) => item.id === "direct-lab")
    const blobPlugin = body.data?.find((item) => item.id === "blob-lab")

    expect(response.status).toBe(200)
    expect(directPlugin?.name).toBe("Direct Lab")
    expect(directPlugin?.iconUrl).toBe("https://plugins.example.test/direct-lab/assets/icon.png")
    expect(directPlugin?.screenshots).toEqual(["https://plugins.example.test/direct-lab/assets/screenshot.png"])
    expect(blobPlugin?.name).toBe("Blob Lab")
    expect(requestedRawGitHubURL).toBe(true)
  })

  test("imports OpenAI Codex plugin metadata with external asdk apps without connector bindings", async () => {
    await useTempDatabase()
    const app = createServerApp()
    let requestedRawGitHubURL = false
    let appManifestRequestCount = 0

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : input.url
      if (url === "https://raw.githubusercontent.com/openai/plugins/main/plugins/actively/.codex-plugin/plugin.json") {
        requestedRawGitHubURL = true
        return new Response(JSON.stringify({
          name: "actively",
          version: "1.0.3",
          description: "OpenAI Codex plugin metadata fixture.",
          interface: {
            displayName: "Actively",
            shortDescription: "Catalog-only OpenAI App SDK plugin.",
            category: "Automation",
            logo: "./assets/logo.png",
          },
          apps: "./.app.json",
        }), { status: 200 })
      }
      if (url === "https://raw.githubusercontent.com/openai/plugins/main/plugins/actively/.app.json") {
        appManifestRequestCount += 1
        return new Response(JSON.stringify({
          apps: {
            actively: {
              id: "asdk_app_6a15fca0d57c8191a204ffdd12fbbef2",
            },
          },
        }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const importResponse = await app.request("/api/plugins/import-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://github.com/openai/plugins/blob/main/plugins/actively/.codex-plugin/plugin.json",
      }),
    })
    const importBody = (await importResponse.json()) as PluginCatalogItemEnvelope

    expect(importResponse.status).toBe(200)
    expect(requestedRawGitHubURL).toBe(true)
    expect(appManifestRequestCount).toBe(1)
    expect(importBody.data?.id).toBe("actively")
    expect(importBody.data?.apps).toEqual([])
    expect(importBody.data?.connectors).toEqual([])
    expect(importBody.data?.installable).toBe(true)
    expect(importBody.data?.download?.type).toBe("github-tree")
    expect(importBody.data?.iconUrl).toBe("https://raw.githubusercontent.com/openai/plugins/main/plugins/actively/assets/logo.png")

    const cachedCatalogResponse = await app.request("/api/plugins/catalog?freshness=cached")
    const cachedCatalogBody = (await cachedCatalogResponse.json()) as PluginCatalogEnvelope
    const importedPlugin = cachedCatalogBody.data?.find((plugin) => plugin.id === "actively")

    expect(cachedCatalogResponse.status).toBe(200)
    expect(importedPlugin?.name).toBe("Actively")
    expect(appManifestRequestCount).toBe(1)
  })

  test("rejects remote external manifest components outside the plugin root", async () => {
    await useTempDatabase()
    const app = createServerApp()
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : input.url
      if (url === "https://plugins.example.test/root-lab/plugin.json") {
        return new Response(JSON.stringify({
          name: "root-lab",
          version: "1.0.0",
          description: "Remote plugin with an unsafe component path.",
          apps: "../shared/.app.json",
        }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const importResponse = await app.request("/api/plugins/import-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://plugins.example.test/root-lab/plugin.json",
      }),
    })
    const importBody = (await importResponse.json()) as JsonEnvelope<unknown>

    expect(importResponse.status).toBe(502)
    expect(importBody.error?.code).toBe("PLUGIN_REGISTRY_UNAVAILABLE")
    expect(importBody.error?.message).toContain("apps")
    expect(importBody.error?.message).toContain("plugin root URL")
  })

  test("rejects missing remote external manifest component files with a clear error", async () => {
    await useTempDatabase()
    const app = createServerApp()
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : input.url
      if (url === "https://plugins.example.test/missing-app/plugin.json") {
        return new Response(JSON.stringify({
          name: "missing-app",
          version: "1.0.0",
          description: "Remote plugin with a missing component file.",
          apps: "./.app.json",
        }), { status: 200 })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const importResponse = await app.request("/api/plugins/import-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://plugins.example.test/missing-app/plugin.json",
      }),
    })
    const importBody = (await importResponse.json()) as JsonEnvelope<unknown>

    expect(importResponse.status).toBe(502)
    expect(importBody.error?.code).toBe("PLUGIN_REGISTRY_UNAVAILABLE")
    expect(importBody.error?.message).toContain("Plugin component 'apps'")
    expect(importBody.error?.message).toContain("HTTP 404")
  })

  test("imports plugin metadata from a direct plugin URL into the user registry", async () => {
    await useTempDatabase()
    const app = createServerApp()

    const packageManifest = {
      name: "url-lab",
      version: "0.2.0",
      description: "Fixture plugin imported from a URL.",
      skills: "skills",
    }
    const zipBytes = createZipArchive([
      {
        name: "url-lab/.anybox-plugin/plugin.json",
        data: `${JSON.stringify(packageManifest, null, 2)}\n`,
      },
      {
        name: "url-lab/skills/review/SKILL.md",
        data: [
          "---",
          "name: review",
          "description: Review URL imported fixture packages.",
          "---",
          "",
          "Use when testing plugin URL imports.",
          "",
        ].join("\n"),
      },
    ])
    const remotePluginMeta = {
      ...packageManifest,
      interface: {
        displayName: "URL Lab",
        shortDescription: "Imported by URL.",
        category: "Docs",
        logo: "./assets/icon.png",
      },
      package: {
        type: "zip",
        url: "https://cdn.example.test/url-lab.zip",
        sha256: createHash("sha256").update(zipBytes).digest("hex"),
        size: zipBytes.byteLength,
      },
      skillPreviews: [
        {
          name: "review",
          description: "Review URL imported fixture packages.",
          directory: "review",
        },
      ],
    }
    let requestedRawGitHubURL = false
    let packageDownloadCount = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : input.url
      if (url === "https://raw.githubusercontent.com/example/anybox-plugins/main/url-lab/.anybox-plugin/plugin.json") {
        requestedRawGitHubURL = true
        return new Response(JSON.stringify(remotePluginMeta), { status: 200 })
      }
      if (url === "https://cdn.example.test/url-lab.zip") {
        packageDownloadCount += 1
        return new Response(zipBytes, {
          status: 200,
          headers: {
            "content-length": String(zipBytes.byteLength),
          },
        })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const importResponse = await app.request("/api/plugins/import-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://github.com/example/anybox-plugins/blob/main/url-lab/.anybox-plugin/plugin.json",
      }),
    })
    const importBody = (await importResponse.json()) as PluginCatalogItemEnvelope

    expect(importResponse.status).toBe(200)
    expect(requestedRawGitHubURL).toBe(true)
    expect(importBody.data?.id).toBe("url-lab")
    expect(importBody.data?.installable).toBe(true)
    expect(importBody.data?.iconUrl).toBe("https://raw.githubusercontent.com/example/anybox-plugins/main/url-lab/assets/icon.png")

    const cachedCatalogResponse = await app.request("/api/plugins/catalog?freshness=cached")
    const cachedCatalogBody = (await cachedCatalogResponse.json()) as PluginCatalogEnvelope
    const importedPlugin = cachedCatalogBody.data?.find((plugin) => plugin.id === "url-lab")

    expect(cachedCatalogResponse.status).toBe(200)
    expect(importedPlugin?.name).toBe("URL Lab")
    expect(importedPlugin?.source).toBe("registry")
    expect(importedPlugin?.installable).toBe(true)

    process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "https://registry.example.test/offline-index.json"
    const freshCatalogResponse = await app.request("/api/plugins/catalog?freshness=fresh")
    const freshCatalogBody = (await freshCatalogResponse.json()) as PluginCatalogEnvelope
    const freshImportedPlugin = freshCatalogBody.data?.find((plugin) => plugin.id === "url-lab")

    expect(freshCatalogResponse.status).toBe(200)
    expect(freshImportedPlugin?.name).toBe("URL Lab")

    const installResponse = await app.request("/api/plugins/installed/url-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope

    expect(installResponse.status).toBe(200)
    expect(packageDownloadCount).toBe(1)
    expect(installBody.data?.skillIDs).toEqual(["plugin:url-lab:review"])
    expect(existsSync(join(pluginInstallRoot(), "url-lab", "0.2.0", ".anybox-plugin", "plugin.json"))).toBe(true)
  })

  test("installs GitHub directory packages inferred from remote plugin metadata URLs", async () => {
    await useTempDatabase()
    const app = createServerApp()

    const commitSha = "a".repeat(40)
    const packageManifest = {
      name: "tree-lab",
      version: "0.3.0",
      description: "Fixture plugin installed from a GitHub directory.",
      skills: "skills",
    }
    const manifestText = `${JSON.stringify(packageManifest, null, 2)}\n`
    const skillText = [
      "---",
      "name: review",
      "description: Review GitHub directory fixture packages.",
      "---",
      "",
      "Use when testing GitHub directory plugin installation.",
      "",
    ].join("\n")
    const readmeText = "# Tree Lab\n"
    const rawFileURLs = new Map([
      [`https://raw.githubusercontent.com/example/anybox-plugins/${commitSha}/tree-lab/.anybox-plugin/plugin.json`, manifestText],
      [`https://raw.githubusercontent.com/example/anybox-plugins/${commitSha}/tree-lab/skills/review/SKILL.md`, skillText],
      [`https://raw.githubusercontent.com/example/anybox-plugins/${commitSha}/tree-lab/README.md`, readmeText],
    ])
    const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    })
    const textResponse = (value: string) => new Response(value, {
      status: 200,
      headers: {
        "content-length": String(Buffer.byteLength(value)),
      },
    })

    let requestedRawGitHubURL = false
    let fileDownloadCount = 0
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : input.url
      if (url === "https://raw.githubusercontent.com/example/anybox-plugins/main/tree-lab/.anybox-plugin/plugin.json") {
        requestedRawGitHubURL = true
        return jsonResponse({
          ...packageManifest,
          interface: {
            displayName: "Tree Lab",
            shortDescription: "Installed from GitHub directory.",
            category: "Docs",
          },
          skillPreviews: [
            {
              name: "review",
              description: "Review GitHub directory fixture packages.",
              directory: "review",
            },
          ],
        })
      }
      if (url === "https://api.github.com/repos/example/anybox-plugins/commits/main") {
        return jsonResponse({
          sha: commitSha,
        })
      }
      if (url === `https://api.github.com/repos/example/anybox-plugins/contents/tree-lab?ref=${commitSha}`) {
        return jsonResponse([
          { type: "dir", path: "tree-lab/.anybox-plugin" },
          { type: "dir", path: "tree-lab/skills" },
          {
            type: "file",
            path: "tree-lab/README.md",
            size: Buffer.byteLength(readmeText),
            download_url: `https://raw.githubusercontent.com/example/anybox-plugins/${commitSha}/tree-lab/README.md`,
          },
        ])
      }
      if (url === `https://api.github.com/repos/example/anybox-plugins/contents/tree-lab/.anybox-plugin?ref=${commitSha}`) {
        return jsonResponse([
          {
            type: "file",
            path: "tree-lab/.anybox-plugin/plugin.json",
            size: Buffer.byteLength(manifestText),
            download_url: `https://raw.githubusercontent.com/example/anybox-plugins/${commitSha}/tree-lab/.anybox-plugin/plugin.json`,
          },
        ])
      }
      if (url === `https://api.github.com/repos/example/anybox-plugins/contents/tree-lab/skills?ref=${commitSha}`) {
        return jsonResponse([
          { type: "dir", path: "tree-lab/skills/review" },
        ])
      }
      if (url === `https://api.github.com/repos/example/anybox-plugins/contents/tree-lab/skills/review?ref=${commitSha}`) {
        return jsonResponse([
          {
            type: "file",
            path: "tree-lab/skills/review/SKILL.md",
            size: Buffer.byteLength(skillText),
            download_url: `https://raw.githubusercontent.com/example/anybox-plugins/${commitSha}/tree-lab/skills/review/SKILL.md`,
          },
        ])
      }

      const rawFile = rawFileURLs.get(url)
      if (rawFile !== undefined) {
        fileDownloadCount += 1
        return textResponse(rawFile)
      }

      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const importResponse = await app.request("/api/plugins/import-url", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: "https://github.com/example/anybox-plugins/tree/main/tree-lab",
      }),
    })
    const importBody = (await importResponse.json()) as PluginCatalogItemEnvelope

    expect(importResponse.status).toBe(200)
    expect(requestedRawGitHubURL).toBe(true)
    expect(importBody.data?.id).toBe("tree-lab")
    expect(importBody.data?.installable).toBe(true)
    expect(importBody.data?.download?.type).toBe("github-tree")
    expect(importBody.data?.download?.url).toBe("https://raw.githubusercontent.com/example/anybox-plugins/main/tree-lab/")

    const installResponse = await app.request("/api/plugins/installed/tree-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope

    expect(installResponse.status).toBe(200)
    expect(fileDownloadCount).toBe(3)
    expect(installBody.data?.skillIDs).toEqual(["plugin:tree-lab:review"])
    expect(existsSync(join(pluginInstallRoot(), "tree-lab", "0.3.0", ".anybox-plugin", "plugin.json"))).toBe(true)
    expect(existsSync(join(pluginInstallRoot(), "tree-lab", "0.3.0", "skills", "review", "SKILL.md"))).toBe(true)
    expect(existsSync(join(pluginInstallRoot(), "tree-lab", "0.3.0", "README.md"))).toBe(true)
  })

  test("installs registry zip packages that use Windows path separators", async () => {
    await useTempDatabase()
    const app = createServerApp()
    process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "https://registry.example.test/index.json"

    const packageManifest = {
      name: "remote-lab",
      version: "1.2.3",
      description: "Remote fixture plugin.",
      skills: "./skills/",
    }
    const zipBytes = createZipArchive([
      {
        name: "remote-lab-1.2.3\\.anybox-plugin\\plugin.json",
        data: `${JSON.stringify(packageManifest, null, 2)}\n`,
      },
      {
        name: "remote-lab-1.2.3\\skills\\review\\SKILL.md",
        data: [
          "---",
          "name: review",
          "description: Review remote fixture plugin packages.",
          "---",
          "",
          "Use when testing remote plugin installation.",
          "",
        ].join("\n"),
      },
    ])
    const remotePluginMeta = {
      ...packageManifest,
      interface: {
        displayName: "Remote Lab",
        shortDescription: "Remote fixture.",
        category: "Docs",
      },
      package: {
        type: "zip",
        url: "https://cdn.example.test/remote-lab.zip",
        sha256: createHash("sha256").update(zipBytes).digest("hex"),
        size: zipBytes.byteLength,
      },
      skillPreviews: [
        {
          name: "review",
          description: "Review remote fixture plugin packages.",
          directory: "review",
        },
      ],
    }

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : input.url
      if (url === "https://registry.example.test/index.json") {
        return new Response(JSON.stringify(["https://plugins.example.test/remote-lab/.anybox-plugin/plugin.json"]), { status: 200 })
      }
      if (url === "https://plugins.example.test/remote-lab/.anybox-plugin/plugin.json") {
        return new Response(JSON.stringify(remotePluginMeta), { status: 200 })
      }
      if (url === "https://cdn.example.test/remote-lab.zip") {
        return new Response(zipBytes, {
          status: 200,
          headers: {
            "content-length": String(zipBytes.byteLength),
          },
        })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const installResponse = await app.request("/api/plugins/installed/remote-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope

    expect(installResponse.status).toBe(200)
    expect(installBody.data?.skillIDs).toEqual(["plugin:remote-lab:review"])
    expect(existsSync(join(pluginInstallRoot(), "remote-lab", "1.2.3", ".anybox-plugin", "plugin.json"))).toBe(true)
    expect(existsSync(join(pluginInstallRoot(), "remote-lab", "1.2.3", "skills", "review", "SKILL.md"))).toBe(true)
  })

  test("rejects registry zip packages with unsafe Windows-style paths", async () => {
    await useTempDatabase()
    const app = createServerApp()
    process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "https://registry.example.test/index.json"

    const packageManifest = {
      name: "remote-lab",
      version: "1.2.3",
      description: "Remote fixture plugin.",
      skills: "./skills/",
    }
    const zipBytes = createZipArchive([
      {
        name: "remote-lab-1.2.3\\..\\escape.txt",
        data: "outside",
      },
      {
        name: "remote-lab-1.2.3\\.anybox-plugin\\plugin.json",
        data: `${JSON.stringify(packageManifest, null, 2)}\n`,
      },
    ])
    const remotePluginMeta = {
      ...packageManifest,
      package: {
        type: "zip",
        url: "https://cdn.example.test/remote-lab.zip",
        sha256: createHash("sha256").update(zipBytes).digest("hex"),
        size: zipBytes.byteLength,
      },
    }

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : input.url
      if (url === "https://registry.example.test/index.json") {
        return new Response(JSON.stringify(["https://plugins.example.test/remote-lab/.anybox-plugin/plugin.json"]), { status: 200 })
      }
      if (url === "https://plugins.example.test/remote-lab/.anybox-plugin/plugin.json") {
        return new Response(JSON.stringify(remotePluginMeta), { status: 200 })
      }
      if (url === "https://cdn.example.test/remote-lab.zip") {
        return new Response(zipBytes, {
          status: 200,
          headers: {
            "content-length": String(zipBytes.byteLength),
          },
        })
      }
      return new Response("not found", { status: 404 })
    }) as typeof fetch

    const installResponse = await app.request("/api/plugins/installed/remote-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope

    expect(installResponse.status).toBe(400)
    expect(installBody.error?.code).toBe("PLUGIN_PACKAGE_INVALID")
    expect(existsSync(join(activeRoot!, "escape.txt"))).toBe(false)
  })

  test("installs, disables, diagnoses, and removes a plugin-backed MCP server", async () => {
    await useTempDatabase()
    const packageSourceRoot = await writeManifestPluginPackage()
    const expectedPackageRoot = join(packageSourceRoot, "manifest-lab", "0.1.0")
    const app = createServerApp()

    const installResponse = await app.request("/api/plugins/installed/manifest-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope

    expect(installResponse.status).toBe(200)
    expect(installBody.success).toBe(true)
    expect(installBody.data?.pluginID).toBe("manifest-lab")
    expect(installBody.data?.packageRoot).toBe(expectedPackageRoot)
    expect(installBody.data?.mcpServerID).toBe("plugin.manifest-lab.notes")
    expect(installBody.data?.mcpServerIDs).toEqual([
      "plugin.manifest-lab.notes",
      "plugin.manifest-lab.connector.docs",
    ])
    expect(installBody.data?.mcpServerEnabled).toEqual({
      "plugin.manifest-lab.notes": true,
      "plugin.manifest-lab.connector.docs": true,
    })

    const server = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.manifest-lab.notes")
    expect(server?.transport).toBe("stdio")
    expect(server?.enabled).toBe(true)
    expect(server?.name).toBe("Manifest Notes")
    expect(server?.transport === "stdio" ? server.args : undefined).toEqual(["server.js"])
    expect(server?.owner).toEqual({
      kind: "plugin",
      pluginID: "manifest-lab",
      bindingID: "mcp:notes",
    })
    const connectorBackedServer = await Config.getMcpServer(
      Config.GLOBAL_CONFIG_ID,
      "plugin.manifest-lab.connector.docs",
    )
    expect(connectorBackedServer?.owner).toEqual({
      kind: "plugin",
      pluginID: "manifest-lab",
      bindingID: "app:docs",
    })

    const disableConnectorBackedChildResponse = await app.request(
      "/api/plugins/installed/manifest-lab/mcp/plugin.manifest-lab.connector.docs",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: false,
        }),
      },
    )
    expect(disableConnectorBackedChildResponse.status).toBe(200)
    expect(
      Plugin.getInstalled("manifest-lab")?.mcpServerEnabled["plugin.manifest-lab.connector.docs"],
    ).toBe(false)

    const disableChildResponse = await app.request(
      "/api/plugins/installed/manifest-lab/mcp/plugin.manifest-lab.notes",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: false,
          toolPolicies: {
            read_notes: {
              policy: "ask",
            },
          },
        }),
      },
    )
    const disableChildBody = (await disableChildResponse.json()) as JsonEnvelope<{
      plugin: NonNullable<InstalledPluginEnvelope["data"]>
      server: {
        enabled: boolean
        toolPolicies?: Record<string, { policy: string }>
      }
    }>
    expect(disableChildResponse.status).toBe(200)
    expect(disableChildBody.data?.plugin.mcpServerEnabled["plugin.manifest-lab.notes"]).toBe(false)
    expect(disableChildBody.data?.server.enabled).toBe(false)
    expect(disableChildBody.data?.server.toolPolicies?.read_notes?.policy).toBe("ask")
    await Plugin.reconcileInstalledRuntimeBindings()
    expect(Plugin.getInstalled("manifest-lab")?.mcpServerEnabled["plugin.manifest-lab.notes"]).toBe(false)
    const reconciledChildServer = await Config.getMcpServer(
      Config.GLOBAL_CONFIG_ID,
      "plugin.manifest-lab.notes",
    )
    expect(reconciledChildServer?.enabled).toBe(false)
    expect(reconciledChildServer?.toolPolicies?.read_notes?.policy).toBe("ask")

    const ownershipResponse = await app.request(
      "/api/plugins/installed/manifest-lab/mcp/plugin.looks-like-a-plugin",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: false,
        }),
      },
    )
    const ownershipBody = (await ownershipResponse.json()) as JsonEnvelope<unknown>
    expect(ownershipResponse.status).toBe(404)
    expect(ownershipBody.error?.code).toBe("PLUGIN_MCP_NOT_FOUND")

    const disableResponse = await app.request("/api/plugins/installed/manifest-lab", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: false,
      }),
    })
    const disableBody = (await disableResponse.json()) as InstalledPluginEnvelope
    const disabledServer = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.manifest-lab.notes")

    expect(disableResponse.status).toBe(200)
    expect(disableBody.data?.enabled).toBe(false)
    expect(disableBody.data?.mcpServerEnabled["plugin.manifest-lab.notes"]).toBe(false)
    expect(disableBody.data?.mcpServerEnabled["plugin.manifest-lab.connector.docs"]).toBe(false)
    expect(disabledServer?.enabled).toBe(false)

    const reenableResponse = await app.request("/api/plugins/installed/manifest-lab", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const reenableBody = (await reenableResponse.json()) as InstalledPluginEnvelope
    const stillDisabledServer = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.manifest-lab.notes")
    expect(reenableResponse.status).toBe(200)
    expect(reenableBody.data?.mcpServerEnabled["plugin.manifest-lab.notes"]).toBe(false)
    expect(reenableBody.data?.mcpServerEnabled["plugin.manifest-lab.connector.docs"]).toBe(false)
    expect(stillDisabledServer?.enabled).toBe(false)
    expect(stillDisabledServer?.toolPolicies?.read_notes?.policy).toBe("ask")

    const reenableChildResponse = await app.request(
      "/api/plugins/installed/manifest-lab/mcp/plugin.manifest-lab.notes",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: true,
        }),
      },
    )
    expect(reenableChildResponse.status).toBe(200)
    const reenabledChildServer = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.manifest-lab.notes")
    expect(reenabledChildServer?.enabled).toBe(true)
    expect(reenabledChildServer?.toolPolicies?.read_notes?.policy).toBe("ask")

    await app.request("/api/plugins/installed/manifest-lab", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: false,
      }),
    })

    const diagnosticResponse = await app.request("/api/plugins/installed/manifest-lab/diagnostic")
    const diagnosticBody = (await diagnosticResponse.json()) as DiagnosticEnvelope

    expect(diagnosticResponse.status).toBe(200)
    expect(diagnosticBody.success).toBe(true)
    expect(diagnosticBody.data?.serverID).toBe("plugin.manifest-lab.notes")
    expect(diagnosticBody.data?.enabled).toBe(false)
    expect(diagnosticBody.data?.ok).toBe(false)
    expect(diagnosticBody.data?.error).toBe("Server is disabled.")

    const listResponse = await app.request("/api/plugins/installed")
    const listBody = (await listResponse.json()) as InstalledPluginsEnvelope
    expect(listBody.data?.some((plugin) => plugin.pluginID === "manifest-lab")).toBe(true)
    expect(listBody.data?.find((plugin) => plugin.pluginID === "manifest-lab")?.packageRoot).toBe(expectedPackageRoot)

    const deleteResponse = await app.request("/api/plugins/installed/manifest-lab", {
      method: "DELETE",
    })
    const deleteBody = (await deleteResponse.json()) as DeletePluginEnvelope

    expect(deleteResponse.status).toBe(200)
    expect(deleteBody.data?.removed).toBe(true)
    expect(deleteBody.data?.mcpServerIDs).toEqual([
      "plugin.manifest-lab.notes",
      "plugin.manifest-lab.connector.docs",
    ])
    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.manifest-lab.notes")).toBeUndefined()
  })

  test("does not report local source packages as installed package roots", async () => {
    await useTempDatabase()
    await writeManifestPluginPackage(pluginLocalRoot())
    const expectedPackageRoot = join(pluginInstallRoot(), "manifest-lab", "0.1.0")
    const app = createServerApp()

    const installResponse = await app.request("/api/plugins/installed/manifest-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope

    expect(installResponse.status).toBe(200)
    expect(installBody.data?.packageRoot).toBe(expectedPackageRoot)
    expect(existsSync(expectedPackageRoot)).toBe(true)

    await rm(expectedPackageRoot, { recursive: true, force: true })

    const listResponse = await app.request("/api/plugins/installed")
    const listBody = (await listResponse.json()) as InstalledPluginsEnvelope
    const installed = listBody.data?.find((plugin) => plugin.pluginID === "manifest-lab")

    expect(installed?.missingPackage).toBe(true)
    expect(installed?.packageRoot).toBeUndefined()
    expect(Plugin.listInstalledPluginSkillRoots(["manifest-lab"])).toEqual([])
  })

  test("backfills legacy plugin MCP preferences without claiming user-owned plugin-like ids", async () => {
    await useTempDatabase()
    await writeManifestPluginPackage()
    const app = createServerApp()

    const installResponse = await app.request("/api/plugins/installed/manifest-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    expect(installResponse.status).toBe(200)

    const globalConfig = await Config.get(Config.GLOBAL_CONFIG_ID)
    const notesServer = globalConfig.mcp?.servers?.["plugin.manifest-lab.notes"]
    expect(notesServer).toBeDefined()
    if (!notesServer) throw new Error("Expected the plugin notes MCP binding.")
    const {
      owner: _notesOwner,
      ...legacyNotesServer
    } = notesServer
    await Config.set(
      Config.GLOBAL_CONFIG_ID,
      {
        ...globalConfig,
        mcp: {
          ...globalConfig.mcp,
          servers: {
            ...globalConfig.mcp?.servers,
            "plugin.manifest-lab.notes": {
              ...legacyNotesServer,
              enabled: false,
            },
          },
        },
      },
    )
    await Config.setMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.looks-user-owned", {
      name: "User prefix fixture",
      transport: "stdio",
      command: "node",
      enabled: true,
    })
    Sqlite.db.prepare(
      "UPDATE installed_plugins SET mcpServerEnabled = NULL WHERE pluginID = ?",
    ).run("manifest-lab")

    await Plugin.reconcileInstalledRuntimeBindings()

    expect(Plugin.getInstalled("manifest-lab")?.mcpServerEnabled).toEqual({
      "plugin.manifest-lab.notes": false,
      "plugin.manifest-lab.connector.docs": true,
    })
    expect(
      (await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.manifest-lab.notes"))?.enabled,
    ).toBe(false)
    expect(
      (await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.manifest-lab.notes"))?.owner,
    ).toEqual({
      kind: "plugin",
      pluginID: "manifest-lab",
      bindingID: "mcp:notes",
    })
    expect(
      (await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.looks-user-owned"))?.owner,
    ).toEqual({
      kind: "user",
    })
  })

  test("does not reclaim an exact plugin server id with an explicit user owner", async () => {
    await useTempDatabase()
    await writeManifestPluginPackage()
    const app = createServerApp()

    expect((await app.request("/api/plugins/installed/manifest-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })).status).toBe(200)

    const server = await Config.getMcpServer(
      Config.GLOBAL_CONFIG_ID,
      "plugin.manifest-lab.notes",
    )
    expect(server).toBeDefined()
    if (!server) throw new Error("Expected the plugin notes MCP binding.")
    const {
      id: _serverID,
      owner: _owner,
      ...serverInput
    } = server
    await Config.setManagedMcpServer(
      Config.GLOBAL_CONFIG_ID,
      server.id,
      serverInput,
      {
        kind: "user",
      },
    )
    await Plugin.reconcileInstalledRuntimeBindings()

    const updateResponse = await app.request(
      "/api/plugins/installed/manifest-lab/mcp/plugin.manifest-lab.notes",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: false,
        }),
      },
    )

    expect(updateResponse.status).toBe(404)
    expect(
      (await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, server.id))?.owner,
    ).toEqual({
      kind: "user",
    })
    expect(
      Plugin.getInstalled("manifest-lab")?.mcpServerEnabled[server.id],
    ).toBe(true)
  })

  test("preserves MCP child preferences across plugin manifest upgrades", async () => {
    await useTempDatabase()
    await writeManifestPluginPackage()
    const app = createServerApp()

    expect((await app.request("/api/plugins/installed/manifest-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })).status).toBe(200)
    expect((await app.request(
      "/api/plugins/installed/manifest-lab/mcp/plugin.manifest-lab.notes",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: false,
        }),
      },
    )).status).toBe(200)

    const manifestPath = join(
      pluginInstallRoot(),
      "manifest-lab",
      "0.1.0",
      ".anybox-plugin",
      "plugin.json",
    )
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, any>
    manifest.version = "0.2.0"
    manifest.mcpServers = [
      ...(manifest.mcpServers as unknown[]),
      {
        id: "search",
        name: "Manifest Search",
        risk: "low",
        tools: [],
        runtime: {
          transport: "stdio",
          command: "node",
          args: ["search-server.js"],
        },
      },
    ]
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    const addServerResponse = await app.request("/api/plugins/installed/manifest-lab", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    })
    const addServerBody = (await addServerResponse.json()) as InstalledPluginEnvelope
    expect(addServerResponse.status).toBe(200)
    expect(addServerBody.data?.mcpServerEnabled).toEqual({
      "plugin.manifest-lab.notes": false,
      "plugin.manifest-lab.search": true,
      "plugin.manifest-lab.connector.docs": true,
    })
    expect(
      (await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.manifest-lab.notes"))?.enabled,
    ).toBe(false)
    expect(
      (await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.manifest-lab.search"))?.enabled,
    ).toBe(true)

    manifest.version = "0.3.0"
    manifest.mcpServers = (manifest.mcpServers as Array<{ id?: string }>)
      .filter((server) => server.id !== "notes")
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    const removeServerResponse = await app.request("/api/plugins/installed/manifest-lab", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    })
    const removeServerBody = (await removeServerResponse.json()) as InstalledPluginEnvelope
    expect(removeServerResponse.status).toBe(200)
    expect(removeServerBody.data?.mcpServerIDs).toEqual([
      "plugin.manifest-lab.search",
      "plugin.manifest-lab.connector.docs",
    ])
    expect(removeServerBody.data?.mcpServerEnabled).toEqual({
      "plugin.manifest-lab.search": true,
      "plugin.manifest-lab.connector.docs": true,
    })
    expect(
      await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.manifest-lab.notes"),
    ).toBeUndefined()
  })

  test("lists installed plugins with cached connector diagnostics that include configured policies", async () => {
    await useTempDatabase()
    await writeManifestPluginPackage()
    const app = createServerApp()

    const installResponse = await app.request("/api/plugins/installed/manifest-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    expect(installResponse.status).toBe(200)

    const cachedConnectorDiagnostics = {
      docs: {
        serverID: "plugin.manifest-lab.connector.docs",
        enabled: true,
        ok: true,
        toolCount: 1,
        toolNames: ["docs_search"],
        tools: [
          {
            name: "docs_search",
            displayName: "Search docs",
            riskHint: "read-only",
            recommendedPolicy: "auto",
            configuredPolicy: "ask",
          },
        ],
      },
    }
    Sqlite.db.prepare(
      "UPDATE installed_plugins SET lastConnectorDiagnostics = ? WHERE pluginID = ?",
    ).run(JSON.stringify(cachedConnectorDiagnostics), "manifest-lab")

    const listResponse = await app.request("/api/plugins/installed")
    const listBody = (await listResponse.json()) as InstalledPluginsEnvelope

    expect(listResponse.status).toBe(200)
    expect(listBody.success).toBe(true)
    expect(listBody.data?.some((plugin) => plugin.pluginID === "manifest-lab")).toBe(true)
  })

  test("rejects installs that omit required plugin configuration", async () => {
    await useTempDatabase()
    await writeConfigRequiredPluginPackage()
    const app = createServerApp()

    const response = await app.request("/api/plugins/installed/config-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        config: {},
      }),
    })
    const body = (await response.json()) as JsonEnvelope<unknown>

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("PLUGIN_CONFIG_INVALID")
  })

  test("rejects critical-risk plugin installation", async () => {
    await useTempDatabase()
    await writeCriticalPluginPackage()
    const app = createServerApp()

    const catalogResponse = await app.request("/api/plugins/catalog")
    const catalogBody = (await catalogResponse.json()) as PluginCatalogEnvelope
    expect(catalogBody.data?.some((plugin) => plugin.id === "critical-lab" && plugin.risk === "critical")).toBe(true)

    const response = await app.request("/api/plugins/installed/critical-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const body = (await response.json()) as JsonEnvelope<unknown>

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("PLUGIN_RISK_NOT_ALLOWED")
    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.critical-lab.danger")).toBeUndefined()
  })

  test("manages platform connectors outside plugin manifests", async () => {
    await useTempDatabase()
    await writeConnectorRegistryFile()
    const app = createServerApp()

    const catalogResponse = await app.request("/api/connectors/catalog")
    const catalogBody = (await catalogResponse.json()) as ConnectorCatalogEnvelope
    expect(catalogResponse.status).toBe(200)
    const docsConnector = catalogBody.data?.find((connector) => connector.id === "docs")
    expect(docsConnector?.category).toBe("account_connector")
    expect(docsConnector?.credential?.kind).toBe("api_key")
    expect(docsConnector?.mcpRuntimes.map((runtime) => runtime.id)).toEqual(["default"])
    expect(docsConnector?.runtime?.transport).toBe("remote")

    const disconnectedResponse = await app.request("/api/connectors")
    const disconnectedBody = (await disconnectedResponse.json()) as PlatformConnectorStatusEnvelope
    const docsStatus = disconnectedBody.data?.find((connector) => connector.connectorID === "connector:docs:default")
    expect(disconnectedResponse.status).toBe(200)
    expect(docsStatus?.connected).toBe(false)
    expect(docsStatus?.mcpBindings).toEqual([
      {
        runtimeID: "default",
        serverID: "connector.docs.default",
      },
    ])

    const connectResponse = await app.request("/api/connectors/connector%3Adocs%3Adefault/api-key", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        apiKey: "platform-secret",
      }),
    })
    const connectBody = (await connectResponse.json()) as SinglePlatformConnectorStatusEnvelope
    expect(connectResponse.status).toBe(200)
    expect(connectBody.data?.connected).toBe(true)

    const server = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "connector.docs.default")
    expect(server?.transport).toBe("connector")
    expect(server?.transport === "connector" ? server.connectorId : undefined).toBe("connector:docs:default")
    expect(server?.transport === "connector" ? server.connectorRuntimeId : undefined).toBe("default")
    expect(server?.owner).toEqual({
      kind: "connector",
      connectorId: "connector:docs:default",
      runtimeID: "default",
    })
    expect(JSON.stringify(server)).not.toContain("platform-secret")

    const runtime = await Connector.resolveRemoteServer("connector:docs:default")
    expect(runtime.serverUrl).toBe("https://docs.example.test/mcp")
    expect(runtime.headers?.["x-api-key"]).toBe("platform-secret")
  })

  test("keeps credentialless and zero-runtime account connectors in the connector control plane", async () => {
    await useTempDatabase()
    if (!activeRoot) throw new Error("Temp root has not been initialized.")

    const legacy = Connector.ConnectorDefinition.parse({
      id: "legacy-public",
      name: "Legacy Public",
      description: "Legacy credentialless connector.",
      runtime: {
        transport: "remote",
        serverUrl: "https://public.example.test/mcp",
      },
    })
    expect(legacy.category).toBe("account_connector")
    expect(legacy.mcpRuntimes.map((runtime) => runtime.id)).toEqual(["default"])

    const registryPath = join(activeRoot, "connectors-zero-runtime.json")
    await writeFile(registryPath, JSON.stringify({
      schemaVersion: 2,
      connectors: [
        {
          id: "account-only",
          category: "account_connector",
          name: "Account Only",
          description: "Account connector without authentication or MCP runtime.",
          mcpRuntimes: [],
        },
      ],
    }))
    process.env.ANYBOX_CONNECTOR_REGISTRY_FILES = registryPath

    const app = createServerApp()
    const catalogResponse = await app.request("/api/connectors/catalog")
    const catalogBody = (await catalogResponse.json()) as ConnectorCatalogEnvelope
    expect(catalogBody.data?.find((definition) => definition.id === "account-only")?.mcpRuntimes).toEqual([])

    const statusResponse = await app.request("/api/connectors")
    const statusBody = (await statusResponse.json()) as PlatformConnectorStatusEnvelope
    const status = statusBody.data?.find((candidate) => candidate.definitionID === "account-only")
    expect(status?.connected).toBe(true)
    expect(status?.authStatus).toBe("connected")
    expect(status?.mcpBindings).toEqual([])
    expect(status?.generatedMcpServerID).toBeUndefined()
  })

  test("reconciles multiple connector MCP runtimes with stable ids and managed ownership", async () => {
    await useTempDatabase()
    await writeMultiRuntimeConnectorRegistryFile()
    const app = createServerApp()

    const catalogResponse = await app.request("/api/connectors/catalog")
    const catalogBody = (await catalogResponse.json()) as ConnectorCatalogEnvelope
    const definition = catalogBody.data?.find((connector) => connector.id === "multi-docs")
    expect(catalogResponse.status).toBe(200)
    expect(definition?.category).toBe("account_connector")
    expect(definition?.mcpRuntimes.map((runtime) => runtime.id)).toEqual(["default", "search"])

    const statusResponse = await app.request("/api/connectors")
    const statusBody = (await statusResponse.json()) as PlatformConnectorStatusEnvelope
    expect(statusBody.data?.find((status) => status.definitionID === "multi-docs")?.mcpBindings).toEqual([
      {
        runtimeID: "default",
        serverID: "connector.multi-docs.default",
        name: "Multi Docs",
      },
      {
        runtimeID: "search",
        serverID: "connector.multi-docs.default.search",
        name: "Multi Docs Search",
      },
    ])

    const connectResponse = await app.request("/api/connectors/connector%3Amulti-docs%3Adefault/api-key", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        apiKey: "multi-runtime-secret",
      }),
    })
    expect(connectResponse.status).toBe(200)

    const defaultServer = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "connector.multi-docs.default")
    const searchServer = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "connector.multi-docs.default.search")
    expect(defaultServer?.transport === "connector" ? defaultServer.connectorRuntimeId : undefined).toBe("default")
    expect(searchServer?.transport === "connector" ? searchServer.connectorRuntimeId : undefined).toBe("search")
    expect(searchServer?.owner).toEqual({
      kind: "connector",
      connectorId: "connector:multi-docs:default",
      runtimeID: "search",
    })
    expect(Connector.mcpServerIDForConnector("multi-docs")).toBe("connector.multi-docs.default")
    expect(Connector.mcpServerIDForConnector("multi-docs", "default", "search")).toBe(
      "connector.multi-docs.default.search",
    )

    const searchRuntime = await Connector.resolveRemoteServer("connector:multi-docs:default", "search")
    expect(searchRuntime.serverUrl).toBe("https://search.docs.example.test/mcp")
    expect(searchRuntime.headers?.["x-api-key"]).toBe("multi-runtime-secret")

    await Connector.saveConnectorApiKey("connector:multi-docs:work", {
      apiKey: "work-runtime-secret",
    })
    expect(
      await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "connector.multi-docs.work"),
    ).toBeDefined()
    expect(
      await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "connector.multi-docs.work.search"),
    ).toBeDefined()

    const missingDiagnosticResponse = await app.request(
      "/api/connectors/connector%3Amulti-docs%3Adefault/diagnostic?runtimeID=missing",
    )
    const missingDiagnosticBody = (await missingDiagnosticResponse.json()) as DiagnosticEnvelope
    expect(missingDiagnosticResponse.status).toBe(200)
    expect(missingDiagnosticBody.data?.serverID).toBe("connector.multi-docs.default.missing")
    expect(missingDiagnosticBody.data?.ok).toBe(false)
    await expect(
      Connector.resolveRuntime("connector:multi-docs:default", "missing"),
    ).rejects.toMatchObject({
      code: "CONNECTOR_RUNTIME_NOT_FOUND",
    })

    await Config.setSelectedMcpServerIDs("multi-runtime-project", [
      "connector.multi-docs.default.search",
      "connector.multi-docs.work.search",
    ])
    await writeMultiRuntimeConnectorRegistryFile(false)
    await Connector.syncConnectorRuntimeBindings()

    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "connector.multi-docs.default")).toBeDefined()
    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "connector.multi-docs.default.search")).toBeUndefined()
    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "connector.multi-docs.work")).toBeDefined()
    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "connector.multi-docs.work.search")).toBeUndefined()
    expect(await Config.getSelectedMcpServerIDs("multi-runtime-project")).toEqual([])
  })

  test("reads the Gmail OAuth client ID from connector build config", async () => {
    await useTempDatabase()
    if (!activeRoot) throw new Error("Temp root has not been initialized.")

    const googleClientID = "1234567890-buildconfig.apps.googleusercontent.com"
    const configPath = join(activeRoot, "connectors.json")
    await writeFile(configPath, JSON.stringify({ schemaVersion: 1, gmailOAuthClientID: googleClientID }))
    process.env.ANYBOX_CONNECTOR_BUILD_CONFIG = configPath

    const app = createServerApp()
    const flowResponse = await app.request("/api/connectors/connector%3Agmail%3Adefault/auth/flows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        serverBaseURL: "http://127.0.0.1:1455",
      }),
    })
    const flowBody = (await flowResponse.json()) as JsonEnvelope<{ id: string; authorizationURL: string }>

    expect(flowResponse.status).toBe(200)
    expect(new URL(flowBody.data?.authorizationURL ?? "").searchParams.get("client_id")).toBe(googleClientID)

    await app.request(`/api/connectors/connector%3Agmail%3Adefault/auth/flows/${flowBody.data?.id}`, {
      method: "DELETE",
    })
  })

  test("uses the managed Gmail OAuth client secret only for token exchange", async () => {
    await useTempDatabase()
    if (!activeRoot) throw new Error("Temp root has not been initialized.")

    const googleClientID = "1234567890-buildconfig.apps.googleusercontent.com"
    const googleClientSecret = "GOCSPX-buildconfig-secret"
    const configPath = join(activeRoot, "connectors.json")
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        gmailOAuthClientID: googleClientID,
        gmailOAuthClientSecret: googleClientSecret,
      }),
    )
    process.env.ANYBOX_CONNECTOR_BUILD_CONFIG = configPath

    const app = createServerApp()
    const catalogResponse = await app.request("/api/connectors/catalog")
    const catalogBody = await catalogResponse.text()
    expect(catalogResponse.status).toBe(200)
    expect(catalogBody).toContain(googleClientID)
    expect(catalogBody).not.toContain(googleClientSecret)

    let tokenRequests = 0
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url === "https://oauth2.googleapis.com/token") {
        tokenRequests += 1
        const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body))
        expect(body.get("grant_type")).toBe("authorization_code")
        expect(body.get("client_id")).toBe(googleClientID)
        expect(body.get("client_secret")).toBe(googleClientSecret)
        expect(body.get("code")).toBe("gmail-code")
        expect(body.get("code_verifier")).toBeTruthy()
        expect(body.get("redirect_uri")).toContain("/auth/callback")
        return new Response(JSON.stringify({
          access_token: "gmail-access",
          refresh_token: "gmail-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    const flowResponse = await app.request("/api/connectors/connector%3Agmail%3Adefault/auth/flows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        serverBaseURL: "http://127.0.0.1:1455",
      }),
    })
    const flowBody = (await flowResponse.json()) as JsonEnvelope<{ id: string; authorizationURL: string }>
    expect(flowResponse.status).toBe(200)

    const authorizationURL = new URL(flowBody.data?.authorizationURL ?? "")
    expect(authorizationURL.searchParams.get("client_id")).toBe(googleClientID)
    expect(authorizationURL.searchParams.has("client_secret")).toBe(false)
    const state = authorizationURL.searchParams.get("state") ?? ""

    const callbackResult = await ProviderAuth.completeProviderBrowserCallback({
      providerID: "connector:gmail:default",
      url: new URL(`http://localhost/auth/callback?code=gmail-code&state=${encodeURIComponent(state)}`),
    })

    expect(callbackResult.ok).toBe(true)
    expect(tokenRequests).toBe(1)
    const storedCredential = await Auth.getProviderCredential("connector:gmail:default", "oauth")
    expect(storedCredential?.kind === "oauth_session" ? storedCredential.accessToken : undefined).toBe("gmail-access")
  })

  test("saves Feishu custom app metadata and uses JSON OAuth token exchange", async () => {
    await useTempDatabase()
    const app = createServerApp()

    const catalogResponse = await app.request("/api/connectors/catalog")
    const catalogBody = (await catalogResponse.json()) as ConnectorCatalogEnvelope
    const feishuConnector = catalogBody.data?.find((item) => item.id === "feishu")
    expect(catalogResponse.status).toBe(200)
    expect(feishuConnector?.credential?.kind).toBe("oauth")
    expect(feishuConnector?.credential?.clientID).toBeUndefined()
    expect(feishuConnector?.credential?.clientIDConfigKey).toBe("FEISHU_APP_ID")
    expect(feishuConnector?.credential?.clientSecretConfigKey).toBe("FEISHU_APP_SECRET")
    expect(feishuConnector?.credential?.tokenRequestFormat).toBe("json")
    expect(feishuConnector?.configFields.map((field) => field.key)).toEqual(["FEISHU_APP_ID", "FEISHU_APP_SECRET"])

    const missingConfigResponse = await app.request("/api/connectors/connector%3Afeishu%3Adefault/auth/flows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    })
    expect(missingConfigResponse.status).toBe(400)

    const saveConfigResponse = await app.request("/api/connectors/connector%3Afeishu%3Adefault/config", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        config: {
          FEISHU_APP_ID: "cli_feishu_test",
          FEISHU_APP_SECRET: "feishu-secret",
        },
      }),
    })
    const saveConfigBody = (await saveConfigResponse.json()) as SinglePlatformConnectorStatusEnvelope
    expect(saveConfigResponse.status).toBe(200)
    expect(saveConfigBody.data?.configured).toBe(true)
    expect(saveConfigBody.data?.configurationLabel).toContain("cli_feis")
    expect(JSON.stringify(saveConfigBody)).not.toContain("feishu-secret")

    let tokenRequests = 0
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url === "https://open.feishu.cn/open-apis/authen/v2/oauth/token") {
        tokenRequests += 1
        expect(init?.headers).toMatchObject({
          "content-type": "application/json",
        })
        const body = JSON.parse(String(init?.body)) as Record<string, string>
        expect(body.grant_type).toBe("authorization_code")
        expect(body.client_id).toBe("cli_feishu_test")
        expect(body.client_secret).toBe("feishu-secret")
        expect(body.code).toBe("feishu-code")
        expect(body.code_verifier).toBeTruthy()
        expect(body.redirect_uri).toContain("/auth/callback")
        return new Response(JSON.stringify({
          code: 0,
          data: {
            access_token: "feishu-access",
            refresh_token: "feishu-refresh",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "offline_access auth:user.id:read drive:drive.search:readonly drive:drive.metadata:readonly drive:drive:readonly drive:file:readonly docx:document:readonly wiki:wiki:readonly sheets:spreadsheet:readonly bitable:app:readonly",
            user_id: "ou_feishu_user",
          },
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    const flowResponse = await app.request("/api/connectors/connector%3Afeishu%3Adefault/auth/flows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    })
    const flowBody = (await flowResponse.json()) as JsonEnvelope<{ id: string; authorizationURL: string; status: string }>
    expect(flowResponse.status).toBe(200)
    expect(flowBody.data?.status).toBe("waiting_user")

    const authorizationURL = new URL(flowBody.data?.authorizationURL ?? "")
    expect(authorizationURL.origin + authorizationURL.pathname).toBe("https://accounts.feishu.cn/open-apis/authen/v1/authorize")
    expect(authorizationURL.searchParams.get("client_id")).toBe("cli_feishu_test")
    expect(authorizationURL.searchParams.has("client_secret")).toBe(false)
    expect(authorizationURL.searchParams.get("scope")).toContain("docx:document:readonly")
    expect(authorizationURL.searchParams.get("code_challenge_method")).toBe("S256")
    const state = authorizationURL.searchParams.get("state") ?? ""

    const callbackResult = await ProviderAuth.completeProviderBrowserCallback({
      providerID: "connector:feishu:default",
      url: new URL(`http://localhost/auth/callback?code=feishu-code&state=${encodeURIComponent(state)}`),
    })

    expect(callbackResult.ok).toBe(true)
    expect(tokenRequests).toBe(1)
    const storedCredential = await Auth.getProviderCredential("connector:feishu:default", "oauth")
    expect(storedCredential?.kind === "oauth_session" ? storedCredential.accessToken : undefined).toBe("feishu-access")

    const runtime = await Connector.resolveRuntime("connector:feishu:default")
    expect(runtime.transport).toBe("stdio")
    expect(runtime.transport === "stdio" ? runtime.env?.FEISHU_ACCESS_TOKEN : undefined).toBe("feishu-access")
    expect(runtime.transport === "stdio" ? runtime.env?.FEISHU_TOKEN_TYPE : undefined).toBe("Bearer")
  })

  test("parses platform connector requirements without creating plugin-owned connectors", async () => {
    await useTempDatabase()
    await writeConnectorRegistryFile()
    await writePlatformConnectorRequirementPluginPackage()
    const app = createServerApp()

    const catalogResponse = await app.request("/api/plugins/catalog")
    const catalogBody = (await catalogResponse.json()) as PluginCatalogEnvelope
    const plugin = catalogBody.data?.find((item) => item.id === "connector-requirement-lab")

    expect(catalogResponse.status).toBe(200)
    expect(plugin?.apps).toEqual([])
    expect(plugin?.connectorRequirements).toEqual([
      {
        connector: "docs",
        runtimeIDs: ["default"],
        tools: ["search_docs"],
        permissions: ["Sends requests to docs.example.test"],
        required: true,
        reason: "Search official docs through the platform connector.",
      },
    ])

    const installResponse = await app.request("/api/plugins/installed/connector-requirement-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope
    expect(installResponse.status).toBe(200)
    expect(installBody.data?.connectorIDs).toEqual([])
    expect(installBody.data?.connectorRequirementIDs).toEqual(["connector:docs:default"])
    expect(Plugin.resolveEnabledInstalledPluginConnectorRequirementServerIDs(["connector-requirement-lab"])).toEqual([
      "connector.docs.default",
    ])

    await Config.setSelectedPluginIDs("connector-requirement-project", ["connector-requirement-lab"])
    expect(
      (await Config.resolveProjectMcpServers("connector-requirement-project")).map((server) => server.id),
    ).toContain("connector.docs.default")

    await Plugin.update("connector-requirement-lab", { enabled: false })
    expect(
      (await Config.resolveProjectMcpServers("connector-requirement-project")).map((server) => server.id),
    ).not.toContain("connector.docs.default")
  })

  test("migrates a legacy Chrome package to the newer local plugin-owned runtime", async () => {
    await useTempDatabase()
    const legacyPackageRoot = await writeLegacyChromePluginPackage()

    const legacyInstalled = await Plugin.install("chrome", { enabled: true })
    expect(legacyInstalled.version).toBe("0.1.0")
    expect(legacyInstalled.packageRoot).toBe(legacyPackageRoot)
    expect(legacyInstalled.mcpServerIDs).toEqual([])
    expect(legacyInstalled.connectorRequirementIDs).toEqual([
      "connector:browser:default",
      "connector:node-repl:default",
    ])

    await Plugin.reconcileInstalledRuntimeBindings()

    const migrated = Plugin.getInstalled("chrome")
    expect(migrated?.version).toBe("0.4.0")
    expect(migrated?.packageRoot).toBe(join(pluginInstallRoot(), "chrome", "0.4.0"))
    expect(migrated?.mcpServerIDs).toEqual(["plugin.chrome.node-repl"])
    expect(migrated?.connectorRequirementIDs).toEqual([])
    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.chrome.chrome")).toBeUndefined()
    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.chrome.node-repl")).toMatchObject({
      transport: "stdio",
      owner: {
        kind: "plugin",
        pluginID: "chrome",
        bindingID: "mcp:node-repl",
      },
    })
  })

  test("loads the Chrome Node REPL from the Chrome plugin package", async () => {
    await useTempDatabase()
    const legacyBrowserServerID = "connector.browser.default"
    const legacyNodeReplServerID = "connector.node-repl.default"
    const legacyServerIDs = [legacyBrowserServerID, legacyNodeReplServerID]
    for (const serverID of legacyServerIDs) {
      await Config.setManagedMcpServer(
        Config.GLOBAL_CONFIG_ID,
        serverID,
        {
          name: serverID === "connector.browser.default" ? "Browser" : "Node REPL",
          transport: "connector",
          connectorId: serverID === "connector.browser.default"
            ? "connector:browser:default"
            : "connector:node-repl:default",
          enabled: true,
        },
        {
          kind: "anybox",
          bindingID: serverID,
        },
      )
    }
    await Config.setSelectedMcpServerIDs("legacy-browser-project", legacyServerIDs)
    await Connector.syncConnectorRuntimeBindings()
    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, legacyBrowserServerID)).toBeUndefined()
    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, legacyNodeReplServerID)).toBeUndefined()
    expect(await Config.getSelectedMcpServerIDs("legacy-browser-project")).toEqual([])

    const packageSourceRoot = await writeChromePluginPackage()
    const packageRoot = join(packageSourceRoot, "chrome", "0.4.0")
    const app = createServerApp()

    const catalogResponse = await app.request("/api/plugins/catalog")
    const catalogBody = (await catalogResponse.json()) as PluginCatalogEnvelope
    const plugin = catalogBody.data?.find((item) => item.id === "chrome")

    expect(catalogResponse.status).toBe(200)
    expect(plugin?.connectors).toEqual([])
    expect(plugin?.apps).toEqual([])
    expect(plugin?.connectorRequirements).toEqual([])
    expect(plugin?.icon).toBe("./assets/chrome.svg")
    expect(plugin?.iconUrl).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(plugin?.brandColor).toBe("#4285F4")
    expect(plugin?.mcpServers.map((server) => server.id)).toEqual(["node-repl"])
    expect(plugin?.mcpServers.find((server) => server.id === "node-repl")?.tools).toHaveLength(3)

    const connectorCatalogResponse = await app.request("/api/connectors/catalog")
    const connectorCatalogBody = (await connectorCatalogResponse.json()) as ConnectorCatalogEnvelope
    const definitions = Connector.listDefinitions()
    expect(connectorCatalogResponse.status).toBe(200)
    expect(connectorCatalogBody.data?.some((item) => item.id === "browser")).toBe(false)
    expect(connectorCatalogBody.data?.some((item) => item.id === "node-repl")).toBe(false)
    expect(definitions.some((item) => item.id === "browser")).toBe(false)
    expect(definitions.some((item) => item.id === "node-repl")).toBe(false)

    const installResponse = await app.request("/api/plugins/installed/chrome", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope

    expect(installResponse.status).toBe(200)
    expect(installBody.data?.mcpServerIDs).toEqual(["plugin.chrome.node-repl"])
    expect(installBody.data?.connectorIDs).toEqual([])
    expect(installBody.data?.connectorRequirementIDs).toEqual([])

    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.chrome.chrome")).toBeUndefined()
    const nodeReplServer = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.chrome.node-repl")
    expect(nodeReplServer?.transport).toBe("stdio")
    expect(nodeReplServer?.transport === "stdio" ? nodeReplServer.command : undefined).toBe("node")
    expect(nodeReplServer?.transport === "stdio" ? nodeReplServer.cwd : undefined).toBe(packageRoot)
    expect(
      (nodeReplServer?.transport === "stdio" ? nodeReplServer.args?.[0] : undefined)?.replaceAll("\\", "/"),
    ).toBe(`${packageRoot.replaceAll("\\", "/")}/scripts/node-repl-server.js`)
    expect(nodeReplServer?.owner).toEqual({
      kind: "plugin",
      pluginID: "chrome",
      bindingID: "mcp:node-repl",
    })

    await Config.setSelectedPluginIDs("chrome-project", ["chrome"])
    expect(
      (await Config.resolveProjectMcpServers("chrome-project")).map((entry) => entry.id),
    ).toEqual(expect.arrayContaining(["plugin.chrome.node-repl"]))

    const nodeReplDiagnosticResponse = await app.request("/api/mcp/servers/plugin.chrome.node-repl/diagnostic")
    const nodeReplDiagnosticBody = (await nodeReplDiagnosticResponse.json()) as DiagnosticEnvelope
    expect(nodeReplDiagnosticResponse.status).toBe(200)
    expect(nodeReplDiagnosticBody.data?.ok).toBe(true)
    expect(nodeReplDiagnosticBody.data?.toolCount).toBe(3)

    const disableChildResponse = await app.request(
      "/api/plugins/installed/chrome/mcp/plugin.chrome.node-repl",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: false,
          toolPolicies: {
            js: {
              policy: "disabled",
            },
          },
        }),
      },
    )
    expect(disableChildResponse.status).toBe(200)
    await Plugin.reconcileInstalledRuntimeBindings()

    const resyncedNodeReplServer = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.chrome.node-repl")
    expect(resyncedNodeReplServer?.enabled).toBe(false)
    expect(resyncedNodeReplServer?.toolPolicies?.js?.policy).toBe("disabled")

    const deleteResponse = await app.request("/api/plugins/installed/chrome", {
      method: "DELETE",
    })
    expect(deleteResponse.status).toBe(200)
    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.chrome.chrome")).toBeUndefined()
    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.chrome.node-repl")).toBeUndefined()
  })

  test("loads plugin package manifests and exposes MCP, skills, and app connector metadata", async () => {
    await useTempDatabase()
    await writeManifestPluginPackage()
    const app = createServerApp()

    const catalogResponse = await app.request("/api/plugins/catalog")
    const catalogBody = (await catalogResponse.json()) as PluginCatalogEnvelope
    const manifestPlugin = catalogBody.data?.find((plugin) => plugin.id === "manifest-lab")

    expect(catalogResponse.status).toBe(200)
    expect(manifestPlugin?.name).toBe("Manifest Lab")
    expect(manifestPlugin?.description).toBe("Fixture plugin package.")
    expect(manifestPlugin?.longDescription).toBe("Fixture plugin package with MCP, skills, and API-key backed app connector.")
    expect(manifestPlugin?.localized?.name?.["zh-CN"]).toBe("清单实验")
    expect(manifestPlugin?.localized?.name?.["zh-TW"]).toBe("資訊清單實驗室")
    expect(manifestPlugin?.localized?.name?.["ja-JP"]).toBe("マニフェストラボ")
    expect(manifestPlugin?.localized?.name?.["ko-KR"]).toBe("매니페스트 랩")
    expect(manifestPlugin?.localized?.name?.["pt-BR"]).toBe("Laboratório de Manifesto")
    expect(manifestPlugin?.localized?.description?.["zh-CN"]).toBe("用于测试的插件包。")
    expect(manifestPlugin?.localized?.longDescription?.["zh-CN"]).toBe("包含 MCP、技能和 API key 连接器的测试插件包。")
    expect(manifestPlugin?.mcpServers.map((server) => server.id)).toEqual(["notes"])
    expect(manifestPlugin?.skills.map((skill) => skill.id)).toEqual(["plugin:manifest-lab:review"])
    expect(manifestPlugin?.apps.map((connector) => connector.appID)).toEqual(["docs"])
    expect(manifestPlugin?.apps[0]?.credential.key).toBe("DOCS_API_KEY")
    expect(manifestPlugin?.apps[0]?.runtime.headers?.["x-api-key"]).toBe("${DOCS_API_KEY}")

    const installResponse = await app.request("/api/plugins/installed/manifest-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope

    expect(installResponse.status).toBe(200)
    expect(installBody.data?.mcpServerIDs).toEqual([
      "plugin.manifest-lab.notes",
      "plugin.manifest-lab.connector.docs",
    ])
    expect(installBody.data?.skillIDs).toEqual(["plugin:manifest-lab:review"])
    expect(installBody.data?.connectorIDs).toEqual(["plugin-connector:manifest-lab:docs"])

    const appServer = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.manifest-lab.connector.docs")
    expect(appServer?.transport).toBe("connector")
    expect(appServer?.transport === "connector" ? appServer.connectorId : undefined).toBe("plugin-connector:manifest-lab:docs")

    const projectRoot = activeRoot ?? "."
    const skills = await Skill.list(projectRoot)
    expect(skills.some((skill) => skill.id === "plugin:manifest-lab:review" && skill.scope === "plugin")).toBe(true)

    const treeResponse = await app.request("/api/skills/tree")
    const treeBody = (await treeResponse.json()) as JsonEnvelope<{ root: string; items: SkillTreeTestNode[] }>
    expect(treeResponse.status).toBe(200)

    const pluginGroup = findSkillTreeNode(treeBody.data?.items, (node) => node.name === "Plugin skills")
    expect(pluginGroup).toBeNull()
    expect(JSON.stringify(treeBody.data?.items ?? [])).not.toContain("plugin-skills://")
    expect(JSON.stringify(treeBody.data?.items ?? [])).not.toContain("plugin:manifest-lab:review")

    const legacyPluginFileResponse = await app.request(
      "/api/skills/file?path=plugin-skills%3A%2F%2Finstalled%2Fmanifest-lab%2F0%2Freview%2FSKILL.md",
    )
    expect(legacyPluginFileResponse.status).toBe(400)
  })

  test("browses installed plugin Skill folders through ownership-scoped read-only routes", async () => {
    await useTempDatabase()
    await writeManifestPluginPackage()
    const app = createServerApp()
    const skillID = "plugin:manifest-lab:review"
    const encodedSkillID = encodeURIComponent(skillID)

    await app.request("/api/plugins/installed/manifest-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })

    const rootResponse = await app.request(
      `/api/plugins/installed/manifest-lab/skills/${encodedSkillID}/entries`,
    )
    const rootBody = (await rootResponse.json()) as JsonEnvelope<Plugin.PluginSkillDirectory>
    expect(rootResponse.status).toBe(200)
    expect(rootBody.data).toMatchObject({
      pluginID: "manifest-lab",
      skillID,
      path: "",
      readOnly: true,
    })
    expect(rootBody.data?.entries.map((entry) => [entry.kind, entry.name])).toEqual([
      ["directory", "assets"],
      ["directory", "references"],
      ["directory", "scripts"],
      ["file", "SKILL.md"],
    ])

    const nestedResponse = await app.request(
      `/api/plugins/installed/manifest-lab/skills/${encodedSkillID}/entries?path=references`,
    )
    const nestedBody = (await nestedResponse.json()) as JsonEnvelope<Plugin.PluginSkillDirectory>
    expect(nestedResponse.status).toBe(200)
    expect(nestedBody.data?.entries).toEqual([
      expect.objectContaining({
        kind: "file",
        name: "checklist.md",
        path: "references/checklist.md",
        mimeType: "text/markdown",
      }),
    ])

    const markdownResponse = await app.request(
      `/api/plugins/installed/manifest-lab/skills/${encodedSkillID}/file?path=SKILL.md`,
    )
    const markdownBody = (await markdownResponse.json()) as JsonEnvelope<Plugin.PluginSkillFile>
    expect(markdownResponse.status).toBe(200)
    expect(markdownBody.data).toMatchObject({
      kind: "text",
      mimeType: "text/markdown",
      path: "SKILL.md",
      readOnly: true,
      tooLarge: false,
    })
    expect(markdownBody.data?.content).toContain("# Review Notes")

    const imageResponse = await app.request(
      `/api/plugins/installed/manifest-lab/skills/${encodedSkillID}/file?path=assets%2Fpixel.png`,
    )
    const imageBody = (await imageResponse.json()) as JsonEnvelope<Plugin.PluginSkillFile>
    expect(imageResponse.status).toBe(200)
    expect(imageBody.data).toMatchObject({
      kind: "image",
      mimeType: "image/png",
      previewUrl: `data:image/png;base64,${tinyPngBase64}`,
      tooLarge: false,
    })

    await app.request("/api/plugins/installed/manifest-lab", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: false,
      }),
    })
    const disabledPluginResponse = await app.request(
      `/api/plugins/installed/manifest-lab/skills/${encodedSkillID}/file?path=references%2Fchecklist.md`,
    )
    expect(disabledPluginResponse.status).toBe(200)

    const wrongOwnerResponse = await app.request(
      `/api/plugins/installed/manifest-lab/skills/${encodeURIComponent("plugin:another-plugin:review")}/entries`,
    )
    const wrongOwnerBody = (await wrongOwnerResponse.json()) as JsonEnvelope<unknown>
    expect(wrongOwnerResponse.status).toBe(404)
    expect(wrongOwnerBody.error?.code).toBe("PLUGIN_SKILL_NOT_FOUND")

    const traversalResponse = await app.request(
      `/api/plugins/installed/manifest-lab/skills/${encodedSkillID}/file?path=${encodeURIComponent("../plugin.json")}`,
    )
    const traversalBody = (await traversalResponse.json()) as JsonEnvelope<unknown>
    expect(traversalResponse.status).toBe(400)
    expect(traversalBody.error?.code).toBe("PLUGIN_SKILL_PATH_INVALID")
  })

  test("loads the newest manifest from a versioned plugin package", async () => {
    await useTempDatabase()
    await writeVersionedPluginPackage()
    const app = createServerApp()

    const catalogResponse = await app.request("/api/plugins/catalog")
    const catalogBody = (await catalogResponse.json()) as PluginCatalogEnvelope
    const versionedPlugin = catalogBody.data?.find((plugin) => plugin.id === "version-lab")

    expect(catalogResponse.status).toBe(200)
    expect(versionedPlugin?.version).toBe("0.2.0")
    expect(versionedPlugin?.name).toBe("Version Lab New")
    expect(versionedPlugin?.mcpServers[0]?.runtime.transport).toBe("stdio")
  })

  test("stores app connector API keys outside MCP config and resolves headers at runtime", async () => {
    await useTempDatabase()
    await writeManifestPluginPackage()
    const app = createServerApp()

    await app.request("/api/plugins/installed/manifest-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })

    const disconnectedResponse = await app.request("/api/plugins/installed/manifest-lab/connectors")
    const disconnectedBody = (await disconnectedResponse.json()) as ConnectorStatusEnvelope
    expect(disconnectedResponse.status).toBe(200)
    expect(disconnectedBody.data?.[0]?.connected).toBe(false)

    const disconnectedDiagnosticResponse = await app.request(
      "/api/plugins/installed/manifest-lab/connectors/docs/diagnostic",
    )
    const disconnectedDiagnosticBody = (await disconnectedDiagnosticResponse.json()) as DiagnosticEnvelope
    expect(disconnectedDiagnosticResponse.status).toBe(200)
    expect(disconnectedDiagnosticBody.data?.ok).toBe(false)
    expect(disconnectedDiagnosticBody.data?.error).toContain("not connected")

    const connectResponse = await app.request("/api/plugins/installed/manifest-lab/connectors/docs/api-key", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        apiKey: "secret-test-key",
      }),
    })
    const connectBody = (await connectResponse.json()) as SingleConnectorStatusEnvelope

    expect(connectResponse.status).toBe(200)
    expect(connectBody.data?.connected).toBe(true)
    expect(connectBody.data?.credentialLabel).toBe("Docs API key")

    const appServer = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.manifest-lab.connector.docs")
    expect(appServer?.transport).toBe("connector")
    expect(appServer?.transport === "connector" ? appServer.connectorId : undefined).toBe("plugin-connector:manifest-lab:docs")
    expect(JSON.stringify(appServer)).not.toContain("secret-test-key")

    const runtime = await Plugin.resolveConnectorRemoteServer("plugin-connector:manifest-lab:docs")
    expect(runtime.serverUrl).toBe("https://docs.example.test/mcp")
    expect(runtime.headers?.["x-api-key"]).toBe("secret-test-key")

    const disconnectResponse = await app.request("/api/plugins/installed/manifest-lab/connectors/docs/api-key", {
      method: "DELETE",
    })
    const disconnectBody = (await disconnectResponse.json()) as SingleConnectorStatusEnvelope

    expect(disconnectResponse.status).toBe(200)
    expect(disconnectBody.data?.connected).toBe(false)

    await expect(Plugin.resolveConnectorRemoteServer("plugin-connector:manifest-lab:docs")).rejects.toThrow("not connected")
  })

  test("loads connector manifests and resolves local stdio connector runtimes with secrets in memory", async () => {
    await useTempDatabase()
    await writeLocalConnectorPluginPackage()
    const app = createServerApp()

    const catalogResponse = await app.request("/api/plugins/catalog")
    const catalogBody = (await catalogResponse.json()) as PluginCatalogEnvelope
    const plugin = catalogBody.data?.find((item) => item.id === "local-connector-lab")

    expect(catalogResponse.status).toBe(200)
    expect(plugin?.connectors.map((connector) => connector.appID)).toEqual(["docs-local"])
    expect(plugin?.apps.map((connector) => connector.appID)).toEqual(["docs-local"])
    expect(plugin?.connectors[0]?.runtime.transport).toBe("stdio")

    const installResponse = await app.request("/api/plugins/installed/local-connector-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope

    expect(installResponse.status).toBe(200)
    expect(installBody.data?.mcpServerIDs).toEqual(["plugin.local-connector-lab.connector.docs-local"])
    expect(installBody.data?.connectorIDs).toEqual(["plugin-connector:local-connector-lab:docs-local"])

    const server = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "plugin.local-connector-lab.connector.docs-local")
    expect(server?.transport).toBe("connector")
    expect(server?.transport === "connector" ? server.connectorId : undefined)
      .toBe("plugin-connector:local-connector-lab:docs-local")
    expect(JSON.stringify(server)).not.toContain("local-secret")

    const disconnectedResponse = await app.request(
      "/api/plugins/installed/local-connector-lab/connectors/docs-local/diagnostic",
    )
    const disconnectedBody = (await disconnectedResponse.json()) as DiagnosticEnvelope
    expect(disconnectedResponse.status).toBe(200)
    expect(disconnectedBody.data?.ok).toBe(false)
    expect(disconnectedBody.data?.error).toContain("not connected")

    const connectResponse = await app.request(
      "/api/plugins/installed/local-connector-lab/connectors/docs-local/api-key",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          apiKey: "local-secret",
        }),
      },
    )
    const connectBody = (await connectResponse.json()) as SingleConnectorStatusEnvelope
    expect(connectResponse.status).toBe(200)
    expect(connectBody.data?.connected).toBe(true)

    const runtime = await Plugin.resolveConnectorRuntime("plugin-connector:local-connector-lab:docs-local")
    expect(runtime.transport).toBe("stdio")
    expect(runtime.transport === "stdio" ? runtime.command : undefined).toBe("node")
    expect(runtime.transport === "stdio" ? runtime.args?.[0] : undefined).toContain("connectors")
    expect(runtime.transport === "stdio" ? runtime.env?.DOCS_API_KEY : undefined).toBe("local-secret")
    await expect(Plugin.resolveConnectorRemoteServer("plugin-connector:local-connector-lab:docs-local"))
      .rejects.toThrow("does not resolve to a remote")
  })

  test("loads built-in Gmail plugin and starts the Anybox-managed Gmail connector OAuth flow", async () => {
    await useTempDatabase()
    const googleClientID = "1234567890-gmailtest.apps.googleusercontent.com"
    process.env.ANYBOX_GMAIL_OAUTH_CLIENT_ID = googleClientID
    const app = createServerApp()

    const catalogResponse = await app.request("/api/plugins/catalog")
    const catalogBody = (await catalogResponse.json()) as PluginCatalogEnvelope
    const plugin = catalogBody.data?.find((item) => item.id === "gmail")

    expect(catalogResponse.status).toBe(200)
    expect(plugin?.connectors).toEqual([])
    expect(plugin?.apps).toEqual([])
    expect(plugin?.connectorRequirements).toEqual([
      {
        connector: "gmail",
        tools: ["gmail_profile", "gmail_search_messages", "gmail_read_message"],
        permissions: [
          "Read the connected Gmail profile summary.",
          "Search Gmail messages with Gmail search syntax.",
          "Read Gmail message headers and snippets.",
        ],
        required: true,
        reason: "Read-only Gmail access through the Anybox Gmail connector.",
      },
    ])
    expect(plugin?.configFields.some((field) => field.key === "GOOGLE_OAUTH_CLIENT_ID")).toBe(false)
    expect(plugin?.configFields.some((field) => field.key === "GOOGLE_OAUTH_CLIENT_SECRET")).toBe(false)

    const connectorCatalogResponse = await app.request("/api/connectors/catalog")
    const connectorCatalogBody = (await connectorCatalogResponse.json()) as ConnectorCatalogEnvelope
    const gmailConnector = connectorCatalogBody.data?.find((item) => item.id === "gmail")
    expect(connectorCatalogResponse.status).toBe(200)
    expect(gmailConnector?.credential?.kind).toBe("oauth")
    expect(gmailConnector?.runtime?.transport).toBe("stdio")

    const installResponse = await app.request("/api/plugins/installed/gmail", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope

    expect(installResponse.status).toBe(200)
    expect(installBody.data?.mcpServerIDs).toEqual([])
    expect(installBody.data?.connectorIDs).toEqual([])
    expect(installBody.data?.connectorRequirementIDs).toEqual(["connector:gmail:default"])

    const server = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "connector.gmail.default")
    expect(server?.transport).toBe("connector")
    expect(server?.transport === "connector" ? server.connectorId : undefined).toBe("connector:gmail:default")
    expect(JSON.stringify(server)).not.toContain(googleClientID)

    const flowResponse = await app.request("/api/connectors/connector%3Agmail%3Adefault/auth/flows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    })
    const flowBody = (await flowResponse.json()) as JsonEnvelope<{
      id: string
      authorizationURL: string
      status: string
    }>
    expect(flowResponse.status).toBe(200)
    expect(flowBody.data?.status).toBe("waiting_user")

    const authorizationURL = new URL(flowBody.data?.authorizationURL ?? "")
    expect(authorizationURL.origin + authorizationURL.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(authorizationURL.searchParams.get("client_id")).toBe(googleClientID)
    expect(authorizationURL.searchParams.has("client_secret")).toBe(false)
    expect(authorizationURL.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/gmail.readonly")
    expect(authorizationURL.searchParams.get("code_challenge_method")).toBe("S256")
    expect(authorizationURL.searchParams.get("access_type")).toBe("offline")
    expect(authorizationURL.searchParams.get("prompt")).toBe("consent")
    expect(authorizationURL.searchParams.get("redirect_uri")).toContain("/auth/callback")

    const cancelResponse = await app.request(
      `/api/connectors/connector%3Agmail%3Adefault/auth/flows/${flowBody.data?.id}`,
      {
        method: "DELETE",
      },
    )
    expect(cancelResponse.status).toBe(200)

    await Auth.setProviderCredential(
      "connector:gmail:default",
      "oauth",
      {
        kind: "oauth_session",
        accessToken: "gmail-access-token",
        refreshToken: "gmail-refresh-token",
        expiresAt: Date.now() + 60 * 60 * 1000,
        tokenType: "Bearer",
        email: "user@example.test",
      },
      { activate: true, lastError: null },
    )

    const runtime = await Connector.resolveRuntime("connector:gmail:default")
    expect(runtime.transport).toBe("stdio")
    expect(runtime.transport === "stdio" ? runtime.command : undefined).toBe("node")
    expect(runtime.transport === "stdio" ? runtime.args?.[0] : undefined).toContain("connectors")
    expect(runtime.transport === "stdio" ? runtime.env?.GMAIL_ACCESS_TOKEN : undefined).toBe("gmail-access-token")
    expect(runtime.transport === "stdio" ? runtime.env?.GMAIL_TOKEN_TYPE : undefined).toBe("Bearer")

    const diagnosticResponse = await app.request("/api/connectors/connector%3Agmail%3Adefault/diagnostic")
    const diagnosticBody = (await diagnosticResponse.json()) as DiagnosticEnvelope
    expect(diagnosticResponse.status).toBe(200)
    expect(diagnosticBody.data?.ok).toBe(true)
    expect(diagnosticBody.data?.toolCount).toBe(3)
  })

  test("parses OAuth app connectors and starts cancellable PKCE auth flows", async () => {
    await useTempDatabase()
    await writeOAuthPluginPackage()
    const app = createServerApp()

    const catalogResponse = await app.request("/api/plugins/catalog")
    const catalogBody = (await catalogResponse.json()) as PluginCatalogEnvelope
    const plugin = catalogBody.data?.find((item) => item.id === "oauth-lab")

    expect(catalogResponse.status).toBe(200)
    expect(plugin?.apps.map((connector) => connector.appID)).toEqual(["mail"])
    expect(plugin?.apps[0]?.credential.kind).toBe("oauth")
    expect(plugin?.apps[0]?.credential.clientID).toBe("fixture-client")

    const installResponse = await app.request("/api/plugins/installed/oauth-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })
    const installBody = (await installResponse.json()) as InstalledPluginEnvelope
    expect(installResponse.status).toBe(200)
    expect(installBody.data?.mcpServerIDs).toEqual(["plugin.oauth-lab.connector.mail"])
    expect(installBody.data?.connectorIDs).toEqual(["plugin-connector:oauth-lab:mail"])

    const disconnectedResponse = await app.request("/api/plugins/installed/oauth-lab/connectors")
    const disconnectedBody = (await disconnectedResponse.json()) as ConnectorStatusEnvelope
    expect(disconnectedBody.data?.[0]?.credentialKind).toBe("oauth")
    expect(disconnectedBody.data?.[0]?.authStatus).toBe("not_connected")

    const flowResponse = await app.request("/api/plugins/installed/oauth-lab/connectors/mail/auth/flows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    })
    const flowBody = (await flowResponse.json()) as JsonEnvelope<{
      id: string
      authorizationURL: string
      status: string
    }>
    expect(flowResponse.status).toBe(200)
    expect(flowBody.data?.status).toBe("waiting_user")
    const authorizationURL = new URL(flowBody.data?.authorizationURL ?? "")
    expect(authorizationURL.origin + authorizationURL.pathname).toBe("https://auth.example.test/authorize")
    expect(authorizationURL.searchParams.get("client_id")).toBe("fixture-client")
    expect(authorizationURL.searchParams.get("scope")).toBe("mail.readonly")
    expect(authorizationURL.searchParams.get("code_challenge_method")).toBe("S256")

    const pendingResponse = await app.request("/api/plugins/installed/oauth-lab/connectors")
    const pendingBody = (await pendingResponse.json()) as ConnectorStatusEnvelope
    expect(pendingBody.data?.[0]?.authStatus).toBe("pending")

    const cancelResponse = await app.request(
      `/api/plugins/installed/oauth-lab/connectors/mail/auth/flows/${flowBody.data?.id}`,
      {
        method: "DELETE",
      },
    )
    const cancelBody = (await cancelResponse.json()) as JsonEnvelope<{ status: string }>
    expect(cancelResponse.status).toBe(200)
    expect(cancelBody.data?.status).toBe("cancelled")
  })

  test("registers dynamic OAuth app connector clients before PKCE auth", async () => {
    await useTempDatabase()
    await writeDynamicOAuthPluginPackage()
    const app = createServerApp()

    const catalogResponse = await app.request("/api/plugins/catalog")
    const catalogBody = (await catalogResponse.json()) as PluginCatalogEnvelope
    const plugin = catalogBody.data?.find((item) => item.id === "dynamic-oauth-lab")

    expect(catalogResponse.status).toBe(200)
    expect(plugin?.apps[0]?.credential.kind).toBe("oauth")
    expect(plugin?.apps[0]?.credential.clientID).toBeUndefined()
    expect(plugin?.apps[0]?.credential.registration?.registrationURL).toBe("https://auth.example.test/register")

    const installResponse = await app.request("/api/plugins/installed/dynamic-oauth-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        config: {
          DCR_CLIENT_NAME: "Dynamic Mail Test",
          DCR_INITIAL_ACCESS_TOKEN: "initial-registration-token",
        },
      }),
    })
    expect(installResponse.status).toBe(200)

    let registrationRequests = 0
    let tokenRequests = 0
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const headers = init?.headers as Record<string, string> | undefined
      if (url === "https://auth.example.test/register") {
        registrationRequests += 1
        expect(init?.method).toBe("POST")
        expect(headers?.authorization).toBe("Bearer initial-registration-token")
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(body.client_name).toBe("Dynamic Mail Test")
        expect(body.application_type).toBe("native")
        expect(body.token_endpoint_auth_method).toBe("client_secret_post")
        expect(body.scope).toBe("mail.readonly")
        expect(body.grant_types).toEqual(["authorization_code", "refresh_token"])
        expect(body.response_types).toEqual(["code"])
        expect((body.redirect_uris as string[])[0]).toContain("/auth/callback")
        return new Response(JSON.stringify({
          client_id: "dynamic-client",
          client_secret: "dynamic-secret",
          client_secret_expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_endpoint_auth_method: "client_secret_post",
        }), {
          status: 201,
          headers: {
            "content-type": "application/json",
          },
        })
      }

      if (url === "https://auth.example.test/token") {
        tokenRequests += 1
        const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body))
        expect(body.get("grant_type")).toBe("authorization_code")
        expect(body.get("client_id")).toBe("dynamic-client")
        expect(body.get("client_secret")).toBe("dynamic-secret")
        expect(body.get("code")).toBe("dynamic-code")
        expect(body.get("code_verifier")).toBeTruthy()
        return new Response(JSON.stringify({
          access_token: "dynamic-access",
          refresh_token: "dynamic-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "mail.readonly",
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as typeof fetch

    const flowResponse = await app.request("/api/plugins/installed/dynamic-oauth-lab/connectors/mail/auth/flows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    })
    const flowBody = (await flowResponse.json()) as JsonEnvelope<{
      id: string
      authorizationURL: string
      status: string
    }>
    expect(flowResponse.status).toBe(200)
    expect(registrationRequests).toBe(1)

    const authorizationURL = new URL(flowBody.data?.authorizationURL ?? "")
    expect(authorizationURL.searchParams.get("client_id")).toBe("dynamic-client")
    expect(authorizationURL.searchParams.get("scope")).toBe("mail.readonly")
    expect(authorizationURL.searchParams.get("code_challenge_method")).toBe("S256")
    const state = authorizationURL.searchParams.get("state") ?? ""

    const callbackResult = await ProviderAuth.completeProviderBrowserCallback({
      providerID: "plugin-connector:dynamic-oauth-lab:mail",
      url: new URL(`http://localhost/auth/callback?code=dynamic-code&state=${encodeURIComponent(state)}`),
    })

    expect(callbackResult.ok).toBe(true)
    expect(tokenRequests).toBe(1)
    const storedCredential = await Auth.getProviderCredential("plugin-connector:dynamic-oauth-lab:mail", "oauth")
    expect(storedCredential?.kind === "oauth_session" ? storedCredential.accessToken : undefined).toBe("dynamic-access")

    await Auth.setProviderCredential(
      "plugin-connector:dynamic-oauth-lab:mail",
      "oauth",
      {
        kind: "oauth_session",
        accessToken: "expired-dynamic-access",
        refreshToken: "dynamic-refresh",
        expiresAt: Date.now() - 1000,
        tokenType: "Bearer",
      },
      { activate: true, lastError: null },
    )

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url === "https://auth.example.test/register") {
        throw new Error("Expected cached dynamic OAuth registration to be reused.")
      }
      expect(url).toBe("https://auth.example.test/token")
      const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body))
      expect(body.get("grant_type")).toBe("refresh_token")
      expect(body.get("client_id")).toBe("dynamic-client")
      expect(body.get("client_secret")).toBe("dynamic-secret")
      expect(body.get("refresh_token")).toBe("dynamic-refresh")
      return new Response(JSON.stringify({
        access_token: "dynamic-access-two",
        refresh_token: "dynamic-refresh-two",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "mail.readonly",
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    }) as typeof fetch

    const runtime = await Plugin.resolveConnectorRemoteServer("plugin-connector:dynamic-oauth-lab:mail")
    expect(runtime.authorization).toBe("Bearer dynamic-access-two")
  })

  test("rejects OAuth app connector callbacks when required scopes are missing", async () => {
    await useTempDatabase()
    await writeOAuthPluginPackage()
    const app = createServerApp()

    await app.request("/api/plugins/installed/oauth-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })

    const flowResponse = await app.request("/api/plugins/installed/oauth-lab/connectors/mail/auth/flows", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    })
    const flowBody = (await flowResponse.json()) as JsonEnvelope<{
      id: string
      authorizationURL: string
      status: string
    }>
    const authorizationURL = new URL(flowBody.data?.authorizationURL ?? "")
    const state = authorizationURL.searchParams.get("state") ?? ""

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body)
      expect(url).toBe("https://auth.example.test/token")
      expect(body).toContain("grant_type=authorization_code")
      return new Response(JSON.stringify({
        access_token: "access-without-mail",
        refresh_token: "refresh-without-mail",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "openid email profile",
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    }) as typeof fetch

    const callbackResult = await ProviderAuth.completeProviderBrowserCallback({
      providerID: "plugin-connector:oauth-lab:mail",
      url: new URL(`http://localhost/auth/callback?code=test-code&state=${encodeURIComponent(state)}`),
    })

    expect(callbackResult.ok).toBe(false)
    expect(callbackResult.status).toBe(500)
    expect(callbackResult.message).toContain("OAuth token is missing required scope: mail.readonly")
    const storedCredential = await Auth.getProviderCredential("plugin-connector:oauth-lab:mail", "oauth")
    expect(storedCredential).toBeUndefined()
    const errorFlowResponse = await app.request(
      `/api/plugins/installed/oauth-lab/connectors/mail/auth/flows/${flowBody.data?.id}`,
    )
    const errorFlowBody = (await errorFlowResponse.json()) as JsonEnvelope<{
      status: string
      errorMessage?: string
    }>
    expect(errorFlowBody.data?.status).toBe("error")
    expect(errorFlowBody.data?.errorMessage).toContain("mail.readonly")
  })

  test("resolves OAuth app connector bearer tokens and refreshes expired sessions", async () => {
    await useTempDatabase()
    await writeOAuthPluginPackage()
    const app = createServerApp()

    await app.request("/api/plugins/installed/oauth-lab", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
      }),
    })

    await Auth.setProviderCredential(
      "plugin-connector:oauth-lab:mail",
      "oauth",
      {
        kind: "oauth_session",
        accessToken: "access-one",
        refreshToken: "refresh-one",
        expiresAt: Date.now() + 60 * 60 * 1000,
        tokenType: "Bearer",
        email: "user@example.test",
      },
      { activate: true, lastError: null },
    )

    const connectedResponse = await app.request("/api/plugins/installed/oauth-lab/connectors")
    const connectedBody = (await connectedResponse.json()) as ConnectorStatusEnvelope
    expect(connectedBody.data?.[0]?.connected).toBe(true)
    expect(connectedBody.data?.[0]?.credentialKind).toBe("oauth")
    expect(connectedBody.data?.[0]?.email).toBe("user@example.test")

    const runtime = await Plugin.resolveConnectorRemoteServer("plugin-connector:oauth-lab:mail")
    expect(runtime.serverUrl).toBe("https://mail.example.test/mcp")
    expect(runtime.authorization).toBe("Bearer access-one")

    await Auth.setProviderCredential(
      "plugin-connector:oauth-lab:mail",
      "oauth",
      {
        kind: "oauth_session",
        accessToken: "expired-access",
        refreshToken: "refresh-one",
        expiresAt: Date.now() - 1000,
        tokenType: "Bearer",
      },
      { activate: true, lastError: null },
    )

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      const body = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body)
      expect(url).toBe("https://auth.example.test/token")
      expect(body).toContain("grant_type=refresh_token")
      expect(body).toContain("refresh_token=refresh-one")
      return new Response(JSON.stringify({
        access_token: "access-two",
        refresh_token: "refresh-two",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "mail.readonly",
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    }) as typeof fetch

    const refreshedRuntime = await Plugin.resolveConnectorRemoteServer("plugin-connector:oauth-lab:mail")
    expect(refreshedRuntime.authorization).toBe("Bearer access-two")
    const refreshedCredential = await Auth.getProviderCredential("plugin-connector:oauth-lab:mail", "oauth")
    expect(refreshedCredential?.kind === "oauth_session" ? refreshedCredential.accessToken : undefined).toBe("access-two")
    expect(refreshedCredential?.kind === "oauth_session" ? refreshedCredential.refreshToken : undefined).toBe("refresh-two")
  })
})
