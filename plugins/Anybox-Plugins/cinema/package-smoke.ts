import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { unzipSync } from "fflate"

const pluginRoot = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(pluginRoot, "..", "..", "..")
const sourceManifest = JSON.parse(await readFile(path.join(pluginRoot, ".anybox-plugin", "plugin.json"), "utf8"))
const expectedVersion = String(sourceManifest.version)

async function runAnyboxChild(extractedRoot: string, stateRoot: string) {
  process.env.ANYBOX_AGENT_DATA_DIR = path.join(stateRoot, "agent-data")
  process.env.ANYBOX_TEST_HOME = path.join(stateRoot, "home")
  process.env.ANYBOX_PLUGIN_LOCAL_DIR = path.dirname(extractedRoot)
  process.env.ANYBOX_PLUGIN_INSTALL_DIR = path.join(stateRoot, "managed-plugins")
  process.env.ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "off"
  process.env.ANYBOX_PLUGIN_INCLUDE_SOURCE_PACKAGES = "0"
  const Plugin = await import(pathToFileURL(path.join(repositoryRoot, "packages", "anyboxagent", "src", "plugin", "plugin.ts")).href)
  const AppRuntime = await import(pathToFileURL(path.join(repositoryRoot, "packages", "anyboxagent", "src", "plugin", "app-runtime.ts")).href)
  let installed = false
  try {
    const catalog = await Plugin.listCatalog()
    const cinema = catalog.find((item) => item.id === "cinema")
    if (!cinema || cinema.version !== expectedVersion || !cinema.installable) {
      throw new Error(`Generic Anybox catalog did not load packaged Cinema ${expectedVersion}.`)
    }
    const record = await Plugin.install("cinema", { enabled: true })
    installed = true
    if (record.platformArtifactReceipts.length !== 1) throw new Error("Generic Anybox install did not install the Cinema platform helper.")
    if (record.views.length !== 1 || record.views[0]?.viewID !== "main") throw new Error("Generic Anybox install did not register the packaged Cinema View.")
    const definition = Plugin.getInstalledAppRuntimeDefinition("cinema")
    if (!definition?.artifacts["cinema-platform-helper"]?.path) throw new Error("Runtime helper was not exposed through the generic artifact map.")

    const webEntry = await readFile(path.join(extractedRoot, "web", "index.html"), "utf8")
    if (!webEntry.includes("<div id=\"root\"></div>")) throw new Error("Installed ZIP Web entry is missing or invalid.")
    const gatewayStatus = await AppRuntime.proxyRequest(
      "cinema",
      "/api/cinema/runtime/status",
      new Request("http://anybox.local/api/cinema/runtime/status"),
    )
    const gatewayPayload = await gatewayStatus.json() as any
    if (!gatewayStatus.ok || gatewayPayload.data?.mode !== "anybox") throw new Error("Installed ZIP API did not load through the Runtime Gateway.")

    const removed = await Plugin.remove("cinema")
    installed = false
    if (!removed.removed || !removed.platformArtifactCleanup.removed.includes("cinema-platform-helper")) {
      throw new Error("Generic Anybox uninstall did not clean up the Cinema helper ownership receipt.")
    }
    console.log(JSON.stringify({ anyboxInstall: true, runtimeGateway: true, helperCleanup: true }))
  } finally {
    await AppRuntime.stopAll("package-smoke-complete")
    if (installed) await Plugin.remove("cinema").catch(() => undefined)
  }
}

if (process.argv[2] === "--anybox-child") {
  const extractedRoot = process.argv[3]
  const stateRoot = process.argv[4]
  if (!extractedRoot || !stateRoot) throw new Error("Packaged Anybox child smoke paths are required.")
  await runAnyboxChild(extractedRoot, stateRoot)
  process.exit(0)
}

const archivePath = path.resolve(pluginRoot, process.argv[2] ?? `dist/cinema-${expectedVersion}.anybox-plugin.zip`)
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cinema-package-smoke-"))
let standalone: ReturnType<typeof Bun.spawn> | undefined

function lineReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  return async (prefix: string) => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const newline = buffer.indexOf("\n")
      if (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line.startsWith(prefix)) return line
        continue
      }
      const remaining = Math.max(1, deadline - Date.now())
      const next = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out reading packaged Cinema Runtime output.")), remaining)),
      ])
      if (next.done) throw new Error("Packaged Cinema Runtime exited before becoming ready.")
      buffer += next.value
    }
    throw new Error("Timed out waiting for the packaged Cinema Runtime.")
  }
}

try {
  const archive = unzipSync(new Uint8Array(await readFile(archivePath)))
  const names = Object.keys(archive)
  if (!names.length || names.some((name) => !name.startsWith("cinema/") || name.includes("..") || name.includes("\\"))) {
    throw new Error("Cinema package must contain one safe top-level 'cinema' directory.")
  }
  if (names.some((name) => /(^|\/)(?:ffmpeg|ffprobe)(?:\.exe)?$/i.test(name))) {
    throw new Error("Cinema package unexpectedly contains FFmpeg.")
  }
  for (const [name, bytes] of Object.entries(archive)) {
    if (name.endsWith("/")) continue
    const destination = path.join(temporaryRoot, ...name.split("/"))
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, bytes)
  }

  const extractedRoot = path.join(temporaryRoot, "cinema")
  const runtimePath = path.join(extractedRoot, "runtime", "server.js")
  const standaloneData = path.join(temporaryRoot, "standalone", "data")
  standalone = Bun.spawn([
    process.execPath,
    runtimePath,
    "--standalone",
    "--port=0",
    `--data-dir=${standaloneData}`,
    `--cache-dir=${path.join(temporaryRoot, "standalone", "cache")}`,
    `--log-dir=${path.join(temporaryRoot, "standalone", "log")}`,
  ], { cwd: extractedRoot, stdout: "pipe", stderr: "inherit", env: { ...process.env } })
  const bootstrapLine = await lineReader(standalone.stdout)("[cinema-runtime] open ")
  const bootstrapURL = bootstrapLine.slice("[cinema-runtime] open ".length)
  const bootstrap = await fetch(bootstrapURL, { redirect: "manual" })
  if (bootstrap.status !== 302) throw new Error(`Packaged standalone bootstrap returned ${bootstrap.status}.`)
  const cookies = typeof bootstrap.headers.getSetCookie === "function"
    ? bootstrap.headers.getSetCookie().join(",")
    : bootstrap.headers.get("set-cookie") ?? ""
  const session = /cinema_session=([^;,]+)/.exec(cookies)?.[1]
  const csrf = /cinema_csrf=([^;,]+)/.exec(cookies)?.[1]
  if (!session || !csrf) throw new Error("Packaged standalone bootstrap did not create a secure session.")
  const standaloneStatus = await fetch(`${new URL(bootstrapURL).origin}/api/cinema/runtime/status`, {
    headers: { cookie: `cinema_session=${session}; cinema_csrf=${csrf}` },
  })
  if (!standaloneStatus.ok || (await standaloneStatus.json() as any).data?.mode !== "standalone") {
    throw new Error("Packaged standalone Runtime status failed.")
  }
  standalone.kill()
  await standalone.exited
  standalone = undefined

  const anyboxChild = Bun.spawn([
    process.execPath,
    fileURLToPath(import.meta.url),
    "--anybox-child",
    extractedRoot,
    path.join(temporaryRoot, "anybox-state"),
  ], { cwd: pluginRoot, stdout: "inherit", stderr: "inherit", env: { ...process.env } })
  const anyboxExitCode = await anyboxChild.exited
  if (anyboxExitCode !== 0) throw new Error(`Packaged Anybox install smoke exited with code ${anyboxExitCode}.`)
  console.log(JSON.stringify({
    status: "ok",
    archivePath,
    files: names.length,
    standalone: true,
    anyboxInstall: true,
    runtimeGateway: true,
    helperCleanup: true,
  }))
} finally {
  if (standalone) {
    standalone.kill()
    await standalone.exited.catch(() => undefined)
  }
  await rm(temporaryRoot, { recursive: true, force: true })
}
