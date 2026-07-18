import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createServer, type RequestListener, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const chromePluginProjectRoot = join(repoRoot, "packages", "chrome-plugin")
const chromePluginRoot = join(
  repoRoot,
  "plugins",
  "Anybox-Plugins",
  "chrome",
)
const chromePluginScriptsRoot = join(chromePluginRoot, "scripts")
const chromeMcpServerPath = join(chromePluginScriptsRoot, "browser-server.js")
const nodeReplServerPath = join(chromePluginScriptsRoot, "node-repl-server.js")
const children: ChildProcessWithoutNullStreams[] = []
const agentServers: Server[] = []

function startMcpServer(serverPath: string, env: NodeJS.ProcessEnv = {}) {
  const child = spawn("node", [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      ...env,
    },
  })
  children.push(child)

  const lines: unknown[] = []
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) lines.push(JSON.parse(line))
    }
  })

  let nextID = 1
  async function request(method: string, params?: unknown) {
    const id = nextID
    nextID += 1
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    const started = Date.now()
    while (Date.now() - started < 5000) {
      const index = lines.findIndex((line) => (line as { id?: unknown }).id === id)
      if (index >= 0) return lines.splice(index, 1)[0] as { result?: unknown; error?: unknown }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`Timed out waiting for ${method}`)
  }

  return { child, request }
}

async function startAgentServer(handler: RequestListener) {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once("error", onError)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError)
      resolve()
    })
  })
  agentServers.push(server)
  return (server.address() as AddressInfo).port
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill()
  }
  await Promise.all(agentServers.splice(0).map((server) =>
    new Promise<void>((resolve) => server.close(() => resolve()))
  ))
})

describe("Chrome plugin runtimes", () => {
  test("uses the canonical Anybox plugin package layout", () => {
    const sourceManifest = JSON.parse(
      readFileSync(
        join(chromePluginProjectRoot, "runtime", ".anybox-plugin", "plugin.json"),
        "utf8",
      ),
    )
    const pluginManifest = JSON.parse(
      readFileSync(join(chromePluginRoot, ".anybox-plugin", "plugin.json"), "utf8"),
    )
    const extensionManifest = JSON.parse(
      readFileSync(join(chromePluginRoot, "browser-extension", "manifest.json"), "utf8"),
    )

    expect(existsSync(join(chromePluginProjectRoot, "browser-extension", "src"))).toBe(true)
    expect(existsSync(join(chromePluginProjectRoot, "browser-native-host", "src"))).toBe(true)
    expect(existsSync(join(chromePluginProjectRoot, "tools", "package-chrome-plugin.mjs"))).toBe(true)
    expect(existsSync(join(chromePluginProjectRoot, "runtime", "assets", "chrome.svg"))).toBe(true)
    expect(existsSync(join(chromePluginRoot, ".anybox-plugin", "plugin.json"))).toBe(true)
    expect(existsSync(join(chromePluginRoot, "plugin.json"))).toBe(false)
    expect(existsSync(join(chromePluginRoot, "assets", "chrome.svg"))).toBe(true)
    expect(existsSync(join(chromePluginRoot, "browser-extension", "manifest.json"))).toBe(true)
    expect(existsSync(join(chromePluginRoot, "browser-extension", "src"))).toBe(false)
    expect(existsSync(join(chromePluginRoot, "browser-native-host"))).toBe(false)
    expect(existsSync(join(chromePluginRoot, "browser-extension", "package.json"))).toBe(false)
    expect(existsSync(join(chromePluginRoot, "runtime-package"))).toBe(false)
    expect(sourceManifest.package).toBeUndefined()
    expect(pluginManifest).toEqual(sourceManifest)
    expect(pluginManifest.name).toBe("chrome")
    expect(pluginManifest.interface?.displayName).toEqual({
      "en-US": "Chrome",
      "zh-CN": "Chrome",
    })
    expect(pluginManifest.interface?.logo).toBe("./assets/chrome.svg")
    expect(pluginManifest.interface?.iconUrl).toBe("./assets/chrome.svg")
    expect(pluginManifest.interface?.brandColor).toBe("#4285F4")
    expect(pluginManifest.mcpServers?.map((server: { id: string }) => server.id)).toEqual(["chrome", "node-repl"])
    expect(pluginManifest.skillPreviews).toHaveLength(1)
    expect(pluginManifest.skillPreviews[0]).toMatchObject({ name: "Chrome", directory: "chrome" })
    expect(extensionManifest.icons).toEqual({
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    })
    for (const size of [16, 48, 128]) {
      expect(
        readFileSync(join(chromePluginRoot, "browser-extension", "icons", `icon${size}.png`)),
      ).toEqual(
        readFileSync(join(chromePluginProjectRoot, "browser-extension", "public", "icons", `icon${size}.png`)),
      )
    }
    expect(existsSync(join(chromePluginScriptsRoot, "browser-client.mjs"))).toBe(true)
    expect(existsSync(chromeMcpServerPath)).toBe(true)
    expect(existsSync(nodeReplServerPath)).toBe(true)
  })

  test("lists tools and preserves globalThis state", async () => {
    const server = startMcpServer(nodeReplServerPath)
    await server.request("initialize")

    const list = await server.request("tools/list") as { result?: { tools?: Array<{ name: string }> } }
    expect(list.result?.tools?.map((tool) => tool.name)).toEqual([
      "node_repl_js",
      "node_repl_reset",
      "node_repl_add_node_module_dir",
    ])

    const first = await server.request("tools/call", {
      name: "node_repl_js",
      arguments: {
        code: "globalThis.answer = (globalThis.answer || 0) + 1\nreturn globalThis.answer",
      },
    }) as { result?: { structuredContent?: { result?: unknown } } }
    const second = await server.request("tools/call", {
      name: "node_repl_js",
      arguments: {
        code: "globalThis.answer = (globalThis.answer || 0) + 1\nreturn globalThis.answer",
      },
    }) as { result?: { structuredContent?: { result?: unknown } } }

    expect(first.result?.structuredContent?.result).toBe(1)
    expect(second.result?.structuredContent?.result).toBe(2)
  })

  test("preloads setupBrowserRuntime", async () => {
    const server = startMcpServer(nodeReplServerPath)
    await server.request("initialize")

    const response = await server.request("tools/call", {
      name: "node_repl_js",
      arguments: {
        code: [
          "await setupBrowserRuntime({ globals: globalThis })",
          "const runtime = await agent.browsers.get('extension')",
          "return typeof runtime.tabs.open",
        ].join("\n"),
      },
    }) as { result?: { structuredContent?: { result?: unknown } } }

    expect(response.result?.structuredContent?.result).toBe("function")
  })

  test("derives the Anybox Agent URL from the host environment", async () => {
    const agentPort = await startAgentServer((request, response) => {
      request.resume()
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        success: true,
        data: {
          connected: true,
          extension: "test",
        },
      }))
    })
    const server = startMcpServer(chromeMcpServerPath, {
      ANYBOX_AGENT_BASE_URL: "",
      ANYBOX_SERVER_HOST: "127.0.0.1",
      ANYBOX_SERVER_PORT: String(agentPort),
    })
    await server.request("initialize")

    const response = await server.request("tools/call", {
      name: "browser_status",
      arguments: {},
    }) as { result?: { structuredContent?: { connected?: boolean } } }

    expect(response.result?.structuredContent?.connected).toBe(true)
  })

  test("loads the plugin Chrome runtime and forwards its trusted token", async () => {
    let receivedToken: string | undefined
    const agentPort = await startAgentServer((request, response) => {
      request.resume()
      receivedToken = typeof request.headers["x-anybox-browser-trusted-token"] === "string"
        ? request.headers["x-anybox-browser-trusted-token"]
        : undefined
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        success: true,
        data: {
          value: 2,
        },
      }))
    })
    const server = startMcpServer(nodeReplServerPath, {
      ANYBOX_AGENT_BASE_URL: "",
      ANYBOX_SERVER_HOST: "127.0.0.1",
      ANYBOX_SERVER_PORT: String(agentPort),
      ANYBOX_BROWSER_TRUSTED_TOKEN: "browser-runtime-test-token",
    })
    await server.request("initialize")

    const response = await server.request("tools/call", {
      name: "node_repl_js",
      arguments: {
        code: [
          "const runtime = await agent.browsers.get('extension')",
          "const tab = await runtime.tabs.get(7)",
          "return await tab.evaluate('1 + 1')",
        ].join("\n"),
      },
    }) as { result?: { structuredContent?: { result?: unknown } } }

    expect(response.result?.structuredContent?.result).toBe(2)
    expect(receivedToken).toBe("browser-runtime-test-token")
  })
})
