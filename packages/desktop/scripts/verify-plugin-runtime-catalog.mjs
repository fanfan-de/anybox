import { spawn } from "node:child_process"
import { createServer as createHTTPServer } from "node:http"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer as createTCPServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

const runtimeDir = path.resolve(
  process.env.ANYBOX_AGENT_RUNTIME_OUTPUT_DIR?.trim()
  ?? path.join(import.meta.dirname, "..", "build", "agent-runtime"),
)
const catalogDir = path.resolve(
  process.env.ANYBOX_PLUGIN_CATALOG_DIR?.trim()
  ?? process.env.ANYBOX_PLUGIN_RELEASE_DIR?.trim()
  ?? path.join(import.meta.dirname, "..", "..", "..", "build", "plugin-catalog"),
)
const bunName = process.platform === "win32" ? "bun.exe" : "bun"
const dataDir = await mkdtemp(path.join(tmpdir(), "anybox-plugin-runtime-catalog-"))
const cacheDir = path.join(dataDir, "registry-cache")
const EXPECTED_PLUGIN_COUNT = 61

async function unusedLoopbackPort() {
  const server = createTCPServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    server.close()
    throw new Error("Unable to reserve a loopback port for the packaged Agent smoke test.")
  }
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
  return address.port
}

async function request(port, route, timeoutMs = 10_000) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await response.json()
  if (!response.ok) {
    throw new Error(`${route} returned HTTP ${response.status}: ${JSON.stringify(body)}`)
  }
  return body
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Unable to start the local plugin catalog registry simulator.")
  }
  return address.port
}

async function close(server) {
  server.closeAllConnections?.()
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

const registryText = await readFile(
  path.join(catalogDir, "anybox-plugin-registry.json"),
  "utf8",
)
const registry = JSON.parse(registryText)
let registryRequestCount = 0
const registryServer = createHTTPServer((incoming, outgoing) => {
  if (incoming.method === "GET" && incoming.url === "/anybox-plugin-registry.json") {
    registryRequestCount += 1
    outgoing.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(registryText),
    })
    outgoing.end(registryText)
    return
  }
  outgoing.writeHead(404)
  outgoing.end("not found")
})
const registryPort = await listen(registryServer)
const registryURL = `http://127.0.0.1:${registryPort}/anybox-plugin-registry.json`

await mkdir(cacheDir, { recursive: true })
await writeFile(
  path.join(cacheDir, "plugin-registry-cache-v2.json"),
  `${JSON.stringify({
    schemaVersion: 2,
    protocol: "manifest-index-v1",
    registryURL,
    plugins: registry.plugins.slice(0, 57),
  }, null, 2)}\n`,
)
await writeFile(
  path.join(cacheDir, "plugin-registry-cache.json"),
  `${JSON.stringify({
    schemaVersion: 1,
    plugins: registry.plugins.slice(0, 57),
  }, null, 2)}\n`,
)

const port = await unusedLoopbackPort()
const childEnv = {
  ...process.env,
  NODE_ENV: "production",
  ANYBOX_AGENT_DATA_DIR: dataDir,
  ANYBOX_TEST_HOME: dataDir,
  ANYBOX_DATABASE_FILE: path.join(dataDir, "agent.db"),
  ANYBOX_LOG_FILE: "0",
  ANYBOX_LOG_PRINT: "0",
  ANYBOX_SERVER_PORT: String(port),
  ANYBOX_PLUGIN_LOCAL_DIR: path.join(dataDir, "local-plugins"),
  ANYBOX_PLUGIN_INSTALL_DIR: path.join(dataDir, "installed-plugins"),
  ANYBOX_PLUGIN_REGISTRY_INDEX_URL: registryURL,
  ANYBOX_PLUGIN_REGISTRY_ALLOW_INSECURE_HTTP: "1",
  ANYBOX_PLUGIN_INCLUDE_SOURCE_PACKAGES: "0",
  ANYBOX_PLUGIN_REGISTRY_CACHE_DIR: cacheDir,
  ANYBOX_PLUGIN_IMPORTED_REGISTRY_FILE: path.join(dataDir, "imported-plugin-registry.json"),
}
delete childEnv.ANYBOX_PLUGIN_REGISTRY_FILES

const child = spawn(
  path.join(runtimeDir, bunName),
  [path.join(runtimeDir, "agent-server.js")],
  {
    cwd: runtimeDir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
)
let stdout = ""
let stderr = ""
child.stdout.on("data", (chunk) => {
  stdout += String(chunk)
})
child.stderr.on("data", (chunk) => {
  stderr += String(chunk)
})

try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `Packaged Agent exited before readiness (${child.exitCode}).\n${stderr || stdout}`,
      )
    }
    try {
      await request(port, "/healthz", 500)
      ready = true
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  if (!ready) throw new Error(`Packaged Agent did not become ready.\n${stderr || stdout}`)

  const beforeFetch = await request(port, "/api/plugins/catalog?freshness=cached")
  if (!beforeFetch.success || !Array.isArray(beforeFetch.data) || beforeFetch.data.length !== 0) {
    throw new Error(`A mismatched 57-entry cache affected the initial catalog: ${JSON.stringify(beforeFetch)}`)
  }

  const catalog = await request(port, "/api/plugins/catalog?freshness=fresh")
  if (!catalog.success || !Array.isArray(catalog.data)) {
    throw new Error(`Packaged Agent returned an invalid plugin catalog: ${JSON.stringify(catalog)}`)
  }
  const ids = catalog.data.map((plugin) => plugin.id)
  const uniqueIDs = new Set(ids)
  if (
    ids.length !== EXPECTED_PLUGIN_COUNT
    || uniqueIDs.size !== EXPECTED_PLUGIN_COUNT
    || !["chrome", "computer-use-windows", "cinema"].every((id) => uniqueIDs.has(id))
  ) {
    throw new Error(
      `Remote repository catalog must contain exactly ${EXPECTED_PLUGIN_COUNT} plugins, got ${ids.length}: ${ids.join(", ")}`,
    )
  }
  if (registryRequestCount !== 1) {
    throw new Error(`Catalog discovery must use one registry request, got ${registryRequestCount}.`)
  }

  const cache = JSON.parse(
    await readFile(path.join(cacheDir, "plugin-registry-cache-v2.json"), "utf8"),
  )
  if (
    cache.protocol !== "catalog-registry-v3"
    || cache.registryURL !== registryURL
    || cache.registry?.pluginCount !== EXPECTED_PLUGIN_COUNT
  ) {
    throw new Error(`The validated remote registry was not cached atomically: ${JSON.stringify(cache)}`)
  }

  await close(registryServer)
  const offlineCatalog = await request(port, "/api/plugins/catalog?freshness=fresh")
  if (!offlineCatalog.success || offlineCatalog.data?.length !== EXPECTED_PLUGIN_COUNT) {
    throw new Error(`Validated registry cache was unavailable offline: ${JSON.stringify(offlineCatalog)}`)
  }

  const installed = await request(port, "/api/plugins/installed")
  if (!installed.success || !Array.isArray(installed.data) || installed.data.length !== 0) {
    throw new Error(`Packaged Agent did not start with an empty install state: ${JSON.stringify(installed)}`)
  }

  console.log(
    `[desktop][build] verified remote plugin discovery: one registry request, ${ids.length} plugins, validated offline cache`,
  )
} finally {
  if (registryServer.listening) await close(registryServer)
  child.kill()
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ])
  await rm(dataDir, { recursive: true, force: true })
}
