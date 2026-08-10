import { expect, test } from "@playwright/test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import http, { type Server } from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import readline from "node:readline"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { unzipSync } from "fflate"

const pluginRoot = path.dirname(fileURLToPath(import.meta.url))
const archivePath = path.resolve(pluginRoot, process.env.CINEMA_PACKAGE_PATH ?? "dist/cinema-1.0.0.anybox-plugin.zip")
const bunBinary = [
  process.env.ANYBOX_BUN_BINARY?.trim(),
  process.env.BUN_INSTALL ? path.join(process.env.BUN_INSTALL, "bin", process.platform === "win32" ? "bun.exe" : "bun") : undefined,
  process.platform === "win32" && process.env.APPDATA
    ? path.join(process.env.APPDATA, "npm", "node_modules", "bun", "bin", "bun.exe")
    : undefined,
  process.platform === "win32" && process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, ".bun", "bin", "bun.exe")
    : undefined,
].find((candidate) => candidate && existsSync(candidate)) ?? "bun"
let temporaryRoot = ""
let extractedRoot = ""
const children: ChildProcessWithoutNullStreams[] = []
const servers: Server[] = []

function runtimeProcess(args: string[], env = process.env) {
  const child = spawn(bunBinary, args, {
    cwd: extractedRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  child.stderr.pipe(process.stderr)
  children.push(child)
  return child
}

async function waitForLine(child: ChildProcessWithoutNullStreams, prefix: string) {
  const lines = readline.createInterface({ input: child.stdout })
  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for '${prefix}'.`)), 15_000)
    const finish = (value: string | Error) => {
      clearTimeout(timer)
      lines.close()
      child.off("error", onError)
      child.off("exit", onExit)
      value instanceof Error ? reject(value) : resolve(value)
    }
    const onError = (error: Error) => finish(error)
    const onExit = () => finish(new Error("Packaged Runtime exited before becoming ready."))
    child.once("error", onError)
    child.once("exit", onExit)
    lines.on("line", (line) => {
      if (line.trim().startsWith(prefix)) finish(line.trim())
    })
  })
}

async function stopChild(child: ChildProcessWithoutNullStreams) {
  const index = children.indexOf(child)
  if (index >= 0) children.splice(index, 1)
  if (child.exitCode === null) {
    child.kill()
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))])
  }
}

async function availablePort() {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve))
  const address = server.address()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (!address || typeof address === "string") throw new Error("Could not allocate a Runtime port.")
  return address.port
}

async function closeServer(server: Server) {
  const index = servers.indexOf(server)
  if (index >= 0) servers.splice(index, 1)
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

test.beforeAll(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cinema-package-playwright-"))
  const files = unzipSync(new Uint8Array(await readFile(archivePath)))
  const names = Object.keys(files)
  if (!names.length || names.some((name) => !name.startsWith("cinema/") || name.includes("..") || name.includes("\\"))) {
    throw new Error("Packaged Playwright smoke requires one safe top-level Cinema directory.")
  }
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith("/")) continue
    const destination = path.join(temporaryRoot, ...name.split("/"))
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, bytes)
  }
  extractedRoot = path.join(temporaryRoot, "cinema")
})

test.afterAll(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode === null) child.kill()
    if (child.exitCode === null) await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))])
  }))
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
})

test("runs the installed ZIP as a secure Standalone Web application", async ({ page }) => {
  const runtimePath = path.join(extractedRoot, "runtime", "server.js")
  const standalone = runtimeProcess([
    runtimePath,
    "--standalone",
    "--port=0",
    `--data-dir=${path.join(temporaryRoot, "standalone-data")}`,
    `--cache-dir=${path.join(temporaryRoot, "standalone-cache")}`,
    `--log-dir=${path.join(temporaryRoot, "standalone-log")}`,
  ])
  const bootstrapLine = await waitForLine(standalone, "[cinema-runtime] open ")
  const bootstrapURL = bootstrapLine.slice("[cinema-runtime] open ".length)

  await page.goto(bootstrapURL, { waitUntil: "domcontentloaded" })
  await expect(page).toHaveURL(`${new URL(bootstrapURL).origin}/`)
  await expect(page.getByRole("heading", { name: "Cinema projects", level: 1 })).toBeVisible()
  await expect(page.getByText("No recent Cinema projects.")).toBeVisible()
  expect(page.url()).not.toContain("token=")
  const mode = await page.evaluate(async () => {
    const response = await fetch("/api/cinema/runtime/status")
    return (await response.json()).data?.mode
  })
  expect(mode).toBe("standalone")
  await stopChild(standalone)
})

test("runs the installed ZIP behind an Anybox-style Runtime Gateway", async ({ page }) => {
  const runtimePath = path.join(extractedRoot, "runtime", "server.js")
  const runtimePort = await availablePort()
  const runtimeToken = crypto.randomUUID()
  const anyboxRuntime = runtimeProcess([runtimePath], {
    ...process.env,
    ANYBOX_APP_ID: "cinema",
    ANYBOX_APP_VERSION: "1.0.0",
    ANYBOX_APP_PORT: String(runtimePort),
    ANYBOX_APP_TOKEN: runtimeToken,
    ANYBOX_APP_DATA_DIR: path.join(temporaryRoot, "anybox-data"),
    ANYBOX_APP_CACHE_DIR: path.join(temporaryRoot, "anybox-cache"),
    ANYBOX_APP_LOG_DIR: path.join(temporaryRoot, "anybox-log"),
  })
  await waitForLine(anyboxRuntime, "[cinema-runtime] ready ")

  const webRoot = path.join(extractedRoot, "web")
  const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  }
  const gateway = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")
      if (url.pathname.startsWith("/__anybox_runtime__/")) {
        const targetPath = url.pathname.slice("/__anybox_runtime__".length) + url.search
        const upstream = await fetch(`http://127.0.0.1:${runtimePort}${targetPath}`, {
          headers: { "x-anybox-app-runtime-token": runtimeToken },
          redirect: "manual",
        })
        response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()))
        response.end(Buffer.from(await upstream.arrayBuffer()))
        return
      }
      const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.replace(/^\/+/, ""))
      if (relative.split(/[\\/]/).includes("..")) {
        response.writeHead(404).end("Not found")
        return
      }
      let file = path.resolve(webRoot, relative)
      const rootPrefix = `${path.resolve(webRoot)}${path.sep}`
      if (!file.startsWith(rootPrefix) && file !== path.join(path.resolve(webRoot), "index.html")) {
        response.writeHead(404).end("Not found")
        return
      }
      if (!(await stat(file).catch(() => undefined))?.isFile()) file = path.join(webRoot, "index.html")
      response.writeHead(200, {
        "content-type": contentTypes[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "cache-control": path.basename(file) === "index.html" ? "no-store" : "public, max-age=31536000, immutable",
      })
      response.end(await readFile(file))
    })().catch((error) => {
      response.writeHead(500).end(error instanceof Error ? error.message : String(error))
    })
  })
  await new Promise<void>((resolve, reject) => gateway.once("error", reject).listen(0, "127.0.0.1", resolve))
  servers.push(gateway)
  const address = gateway.address()
  if (!address || typeof address === "string") throw new Error("Anybox-style Gateway did not bind a TCP port.")
  const gatewayOrigin = `http://127.0.0.1:${address.port}`
  await page.goto(`${gatewayOrigin}/?agentBaseURL=${encodeURIComponent(`${gatewayOrigin}/__anybox_runtime__/`)}`, {
    waitUntil: "domcontentloaded",
  })
  await expect(page.getByRole("heading", { name: "Cinema projects", level: 1 })).toBeVisible()
  await expect(page.getByText("No recent Cinema projects.")).toBeVisible()
  const mode = await page.evaluate(async () => {
    const response = await fetch("/__anybox_runtime__/api/cinema/runtime/status")
    return (await response.json()).data?.mode
  })
  expect(mode).toBe("anybox")

  await closeServer(gateway)
  await stopChild(anyboxRuntime)
})
