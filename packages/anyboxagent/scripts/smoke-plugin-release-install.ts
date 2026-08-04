import { existsSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: {
    code?: string
    message?: string
  }
}

interface RegistryPlugin {
  id: string
  version: string
  package: {
    type: "zip"
    url: string
  }
}

const EXPECTED_PLUGIN_COUNT = 61

const registryFile = process.argv[2] ? resolve(process.argv[2]) : ""
const pluginID = process.argv[3]?.trim() || "context7"
if (!registryFile || !existsSync(registryFile)) {
  throw new Error(
    "Usage: bun run scripts/smoke-plugin-release-install.ts <anybox-plugin-registry.json> [plugin-id]",
  )
}

const registry = JSON.parse(readFileSync(registryFile, "utf8")) as {
  pluginCount?: number
  plugins?: RegistryPlugin[]
}
const registryPlugin = registry.plugins?.find((plugin) => plugin.id === pluginID)
if (
  registry.pluginCount !== EXPECTED_PLUGIN_COUNT
  || registry.plugins?.length !== EXPECTED_PLUGIN_COUNT
  || !registryPlugin
) {
  throw new Error(
    `Plugin catalog must contain ${EXPECTED_PLUGIN_COUNT} plugins including '${pluginID}'.`,
  )
}
const localPackageRoot = join(dirname(registryFile), "packages")
const useLocalPackages = existsSync(localPackageRoot)

const configuredDataRoot = process.env.ANYBOX_PLUGIN_SMOKE_DATA_DIR?.trim()
const dataRoot = configuredDataRoot
  ? resolve(configuredDataRoot)
  : await mkdtemp(join(tmpdir(), "anybox-plugin-release-smoke-"))
if (configuredDataRoot) await mkdir(dataRoot, { recursive: true })
const databaseFile = join(dataRoot, "agent.db")
const installRoot = join(dataRoot, "installed-plugins")
const originalFetch = globalThis.fetch
const requestedURLs: string[] = []

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string"
    ? input
    : input instanceof URL ? input.toString() : input.url
  requestedURLs.push(url)
  if (new URL(url).hostname.toLowerCase() === "api.github.com") {
    throw new Error(`Plugin installation must not call api.github.com: ${url}`)
  }
  if (useLocalPackages) {
    if (url !== registryPlugin.package.url) {
      throw new Error(`Local plugin catalog smoke attempted an unexpected network request: ${url}`)
    }
    const packagePath = join(localPackageRoot, basename(new URL(url).pathname))
    if (!existsSync(packagePath)) {
      throw new Error(`Local plugin catalog package does not exist: ${packagePath}`)
    }
    const bytes = readFileSync(packagePath)
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-type": "application/zip",
      },
    })
  }
  return originalFetch(input, init)
}) as typeof fetch

Object.assign(process.env, {
  NODE_ENV: "production",
  ANYBOX_AGENT_DATA_DIR: dataRoot,
  ANYBOX_TEST_HOME: dataRoot,
  ANYBOX_DATABASE_FILE: databaseFile,
  ANYBOX_PROMPTS_ROOT: join(dataRoot, "prompts"),
  ANYBOX_LOG_FILE: "0",
  ANYBOX_LOG_PRINT: "0",
  ANYBOX_PLUGIN_LOCAL_DIR: join(dataRoot, "local-plugins"),
  ANYBOX_PLUGIN_INSTALL_DIR: installRoot,
  ANYBOX_PLUGIN_REGISTRY_FILES: registryFile,
  ANYBOX_PLUGIN_REGISTRY_INDEX_URL: "off",
  ANYBOX_PLUGIN_INCLUDE_SOURCE_PACKAGES: "0",
  ANYBOX_PLUGIN_REGISTRY_CACHE_DIR: join(dataRoot, "registry-cache"),
  ANYBOX_PLUGIN_IMPORTED_REGISTRY_FILE: join(dataRoot, "imported-plugin-registry.json"),
})

let closeDatabase: (() => void) | undefined
try {
  const Sqlite = await import("../src/database/Sqlite.ts")
  closeDatabase = Sqlite.closeDatabase
  Sqlite.setDatabaseFile(databaseFile)
  const { createServerApp } = await import("../src/server/server.ts")
  const app = createServerApp()

  const catalogResponse = await app.request("/api/plugins/catalog?freshness=cached")
  const catalogBody = await catalogResponse.json() as ApiEnvelope<RegistryPlugin[]>
  if (
    !catalogResponse.ok
    || !catalogBody.success
    || catalogBody.data?.length !== EXPECTED_PLUGIN_COUNT
    || !catalogBody.data.some((plugin) => plugin.id === pluginID)
  ) {
    throw new Error(`Plugin catalog smoke failed: ${JSON.stringify(catalogBody)}`)
  }

  const installResponse = await app.request(
    `/api/plugins/installed/${encodeURIComponent(pluginID)}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    },
  )
  const installBody = await installResponse.json() as ApiEnvelope<{ pluginID?: string }>
  if (!installResponse.ok || !installBody.success || installBody.data?.pluginID !== pluginID) {
    throw new Error(`Plugin catalog install smoke failed: ${JSON.stringify(installBody)}`)
  }

  const installedManifest = join(
    installRoot,
    pluginID,
    registryPlugin.version,
    ".anybox-plugin",
    "plugin.json",
  )
  if (!existsSync(installedManifest)) {
    throw new Error(`Plugin catalog install did not create the expected manifest: ${installedManifest}`)
  }
  if (
    requestedURLs.length !== 1
    || !requestedURLs[0]?.includes("/plugins/Anybox-Plugins/.catalog/packages/")
    || !requestedURLs[0]?.endsWith(".zip")
  ) {
    throw new Error(`Plugin catalog install made unexpected network requests: ${requestedURLs.join(", ")}`)
  }

  console.log(
    `[plugin-catalog] installed ${pluginID}@${registryPlugin.version} from one ${useLocalPackages ? "local" : "repository"} ZIP; catalog=${EXPECTED_PLUGIN_COUNT}; api.github.com=0`,
  )
} finally {
  globalThis.fetch = originalFetch
  closeDatabase?.()
  if (!configuredDataRoot) {
    await rm(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch((error) => {
      console.warn(
        `[plugin-catalog] temporary smoke directory will be recoverable after process exit: ${dataRoot} (${error instanceof Error ? error.message : String(error)})`,
      )
    })
  }
}
