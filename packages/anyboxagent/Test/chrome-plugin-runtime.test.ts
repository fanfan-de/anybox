import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createServer, type RequestListener, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { Worker } from "node:worker_threads"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const chromePluginProjectRoot = join(repoRoot, "packages", "chrome-plugin")
const chromePluginRoot = join(
  repoRoot,
  "plugins",
  "Anybox-Plugins",
  "chrome",
)
const chromePluginScriptsRoot = join(chromePluginRoot, "scripts")
const nodeReplServerPath = join(chromePluginScriptsRoot, "node-repl-server.js")
const browserGatewayWorkerPath = join(
  chromePluginProjectRoot,
  "runtime",
  "scripts",
  "browser-gateway-worker.js",
)
const children: ChildProcessWithoutNullStreams[] = []
const agentServers: Server[] = []

function startMcpServer(serverPath: string, env: NodeJS.ProcessEnv = {}) {
  const child = spawn("node", [serverPath], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      ANYBOX_BROWSER_NATIVE_INSTALL: "off",
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
    expect(
      existsSync(join(chromePluginRoot, "extension-host", "windows", "x64", "extension-host.exe")),
    ).toBe(true)
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
    expect(pluginManifest.version).toBe("0.4.1")
    expect(pluginManifest.mcpServers?.map((server: { id: string }) => server.id)).toEqual(["node-repl"])
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
    expect(existsSync(join(chromePluginScriptsRoot, "browser-gateway-worker.js"))).toBe(true)
    expect(existsSync(join(chromePluginScriptsRoot, "browser-server.js"))).toBe(false)
    expect(existsSync(nodeReplServerPath)).toBe(true)
    expect(existsSync(join(chromePluginScriptsRoot, "extension-id.json"))).toBe(true)
    expect(existsSync(join(chromePluginScriptsRoot, "installManifest.mjs"))).toBe(true)
    expect(existsSync(join(chromePluginScriptsRoot, "native-host-bootstrap.js"))).toBe(true)
  })

  test("lists tools and preserves globalThis state", async () => {
    const server = startMcpServer(nodeReplServerPath)
    await server.request("initialize")

    const list = await server.request("tools/list") as { result?: { tools?: Array<{ name: string }> } }
    expect(list.result?.tools?.map((tool) => tool.name)).toEqual([
      "js",
      "js_reset",
      "js_add_node_module_dir",
    ])

    const first = await server.request("tools/call", {
      name: "js",
      arguments: {
        code: "globalThis.answer = (globalThis.answer || 0) + 1\nreturn globalThis.answer",
      },
    }) as { result?: { structuredContent?: { result?: unknown } } }
    const second = await server.request("tools/call", {
      name: "js",
      arguments: {
        code: "globalThis.answer = (globalThis.answer || 0) + 1\nreturn globalThis.answer",
      },
    }) as { result?: { structuredContent?: { result?: unknown } } }

    expect(first.result?.structuredContent?.result).toBe(1)
    expect(second.result?.structuredContent?.result).toBe(2)
  })

  test("keeps browser credentials outside the model-visible Node environment", async () => {
    const server = startMcpServer(nodeReplServerPath, {
      ANYBOX_BROWSER_TRUSTED_TOKEN: "trusted-model-secret",
      ANYBOX_BROWSER_TRANSPORT_TOKEN: "transport-model-secret",
    })
    await server.request("initialize")

    const response = await server.request("tools/call", {
      name: "js",
      arguments: {
        code: [
          "const env = require('process').env",
          "return {",
          "  trusted: env.ANYBOX_BROWSER_TRUSTED_TOKEN,",
          "  transport: env.ANYBOX_BROWSER_TRANSPORT_TOKEN,",
          "}",
        ].join("\n"),
      },
    }) as {
      result?: {
        structuredContent?: {
          result?: {
            trusted?: unknown
            transport?: unknown
          }
        }
      }
    }

    expect(response.result?.structuredContent?.result).toEqual({})
  })

  test("keeps trusted HTTP credentials outside model-visible fetch and diagnostics hooks", async () => {
    let receivedToken: string | undefined
    const agentPort = await startAgentServer((request, response) => {
      request.resume()
      receivedToken = typeof request.headers["x-anybox-browser-trusted-token"] === "string"
        ? request.headers["x-anybox-browser-trusted-token"]
        : undefined
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        success: true,
        data: { connected: true },
      }))
    })
    const server = startMcpServer(nodeReplServerPath, {
      ANYBOX_AGENT_BASE_URL: `http://127.0.0.1:${agentPort}`,
      ANYBOX_BROWSER_TRUSTED_TOKEN: "worker-isolated-token",
    })
    await server.request("initialize")

    const response = await server.request("tools/call", {
      name: "js",
      arguments: {
        code: [
          "const realGlobal = require('node:vm').runInThisContext('globalThis')",
          "const channel = require('node:diagnostics_channel').channel('undici:request:create')",
          "const originalFetch = realGlobal.fetch",
          "let interceptedFetch = false",
          "let observedRequests = 0",
          "const observe = () => { observedRequests += 1 }",
          "channel.subscribe(observe)",
          "realGlobal.fetch = async () => {",
          "  interceptedFetch = true",
          "  throw new Error('model fetch hook must not receive browser gateway traffic')",
          "}",
          "try {",
          "  const status = await (await agent.browsers.get('extension')).status()",
          "  return { connected: status.connected, interceptedFetch, observedRequests }",
          "} finally {",
          "  realGlobal.fetch = originalFetch",
          "  channel.unsubscribe(observe)",
          "}",
        ].join("\n"),
      },
    }) as {
      result?: {
        structuredContent?: {
          result?: {
            connected?: boolean
            interceptedFetch?: boolean
            observedRequests?: number
          }
        }
      }
    }

    expect(response.result?.structuredContent?.result).toEqual({
      connected: true,
      interceptedFetch: false,
      observedRequests: 0,
    })
    expect(receivedToken).toBe("worker-isolated-token")
  })

  test("rejects a non-loopback browser gateway before initializing the model runtime", async () => {
    const server = startMcpServer(nodeReplServerPath, {
      ANYBOX_AGENT_BASE_URL: "http://browser-gateway.example:4096",
      ANYBOX_BROWSER_TRUSTED_TOKEN: "remote-gateway-token",
    })
    const response = await server.request("initialize") as {
      error?: { message?: string }
    }

    expect(response.error?.message).toContain("requires a loopback Anybox Agent host")
  })

  test("preloads setupBrowserRuntime", async () => {
    const server = startMcpServer(nodeReplServerPath)
    await server.request("initialize")

    const response = await server.request("tools/call", {
      name: "js",
      arguments: {
        code: [
          "await setupBrowserRuntime({ globals: globalThis })",
          "const runtime = await agent.browsers.get('extension')",
          "return {",
          "  open: typeof runtime.tabs.open,",
          "  documented: (await runtime.documentation()).includes('Anybox Chrome browser runtime'),",
          "}",
        ].join("\n"),
      },
    }) as { result?: { structuredContent?: { result?: { open?: unknown; documented?: unknown } } } }

    expect(response.result?.structuredContent?.result).toEqual({
      open: "function",
      documented: true,
    })
  })

  test("reads Chrome connection status through the Node REPL browser runtime", async () => {
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
          connected: true,
          extension: "test",
        },
      }))
    })
    const server = startMcpServer(nodeReplServerPath, {
      ANYBOX_AGENT_BASE_URL: "",
      ANYBOX_SERVER_HOST: "127.0.0.1",
      ANYBOX_SERVER_PORT: String(agentPort),
      ANYBOX_BROWSER_TRUSTED_TOKEN: "browser-runtime-status-token",
    })
    await server.request("initialize")

    const response = await server.request("tools/call", {
      name: "js",
      arguments: {
        code: "return await (await agent.browsers.get('extension')).status()",
      },
    }) as { result?: { structuredContent?: { result?: unknown } } }

    expect(
      (response.result?.structuredContent?.result as { connected?: boolean } | undefined)?.connected,
    ).toBe(true)
    expect(receivedToken).toBe("browser-runtime-status-token")
  })

  test("keeps raw page evaluation disabled at the model command boundary", async () => {
    let requestCount = 0
    const agentPort = await startAgentServer((request, response) => {
      request.resume()
      requestCount += 1
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
      name: "js",
      arguments: {
        code: [
          "const runtime = await agent.browsers.get('extension')",
          "const tab = await runtime.tabs.get(7)",
          "return await tab.evaluate('1 + 1')",
        ].join("\n"),
      },
    }) as { result?: { structuredContent?: { result?: unknown } } }

    expect(
      (response.result?.structuredContent as { error?: string } | undefined)?.error,
    ).toContain("disabled until Anybox can enforce command-level capability")
    expect(requestCount).toBe(0)
  })

  test("rejects raw browser requests inside the isolated gateway worker", async () => {
    let requestCount = 0
    const agentPort = await startAgentServer((request, response) => {
      request.resume()
      requestCount += 1
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ success: true, data: {} }))
    })
    const worker = new Worker(browserGatewayWorkerPath, {
      workerData: {
        agentBaseURL: `http://127.0.0.1:${agentPort}`,
        trustedToken: "worker-policy-token",
      },
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const onMessage = (message: unknown) => {
          if ((message as { type?: string })?.type !== "ready") return
          worker.off("error", reject)
          resolve()
        }
        worker.on("message", onMessage)
        worker.once("error", reject)
      })
      const request = (id: number, payload: unknown) => new Promise<{
        id: number
        ok: boolean
        error?: string
      }>((resolve) => {
        const onMessage = (message: {
          id?: number
          ok?: boolean
          error?: string
        }) => {
          if (message.id !== id) return
          worker.off("message", onMessage)
          resolve(message as { id: number; ok: boolean; error?: string })
        }
        worker.on("message", onMessage)
        worker.postMessage({ id, request: payload })
      })

      const trusted = await request(1, {
        type: "trusted-command",
        method: "page.executeScript",
        params: { script: "document.body.innerText" },
      })
      const disguised = await request(2, {
        type: "command",
        method: "page.executeScript",
        params: { script: "document.body.innerText" },
      })

      expect(trusted.ok).toBe(false)
      expect(trusted.error).toContain("request type is invalid")
      expect(disguised.ok).toBe(false)
      expect(disguised.error).toContain("command method is invalid")
      expect(requestCount).toBe(0)
    } finally {
      await worker.terminate()
    }
  })

  test("emits Chrome screenshots from the Node REPL as image content", async () => {
    const imageData = Buffer.from("fixture-png").toString("base64")
    const agentPort = await startAgentServer((request, response) => {
      request.resume()
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        success: true,
        data: {
          tabId: 7,
          mime: "image/png",
          data: imageData,
        },
      }))
    })
    const server = startMcpServer(nodeReplServerPath, {
      ANYBOX_AGENT_BASE_URL: "",
      ANYBOX_SERVER_HOST: "127.0.0.1",
      ANYBOX_SERVER_PORT: String(agentPort),
      ANYBOX_BROWSER_TRUSTED_TOKEN: "browser-runtime-screenshot-token",
    })
    await server.request("initialize")

    const response = await server.request("tools/call", {
      name: "js",
      arguments: {
        code: [
          "const runtime = await agent.browsers.get('extension')",
          "const tab = await runtime.tabs.get(7)",
          "await nodeRepl.emitImage(await tab.screenshot())",
        ].join("\n"),
      },
    }) as {
      result?: {
        content?: Array<{ type?: string; mimeType?: string; data?: string }>
        structuredContent?: { imageCount?: number }
      }
    }

    expect(response.result?.structuredContent?.imageCount).toBe(1)
    expect(response.result?.content).toContainEqual({
      type: "image",
      mimeType: "image/png",
      data: imageData,
    })
  })
})
