import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createHmac, randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { join } from "node:path"
import { Worker } from "node:worker_threads"
import {
  BROWSER_IPC_PROTOCOL_VERSION,
  BrowserIpcFrameDecoder,
  browserIpcProofTranscript,
  encodeBrowserIpcFrame,
} from "@anybox/shared/browser-ipc"
import {
  BROWSER_CONTRACT_COMMAND_METHODS,
  BROWSER_CONTRACT_VERSION,
  createBrowserBackendInfo,
  createBrowserGetInfoResult,
} from "@anybox/shared/browser-contract"

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
  chromePluginScriptsRoot,
  "browser-gateway-worker.js",
)
const children: ChildProcessWithoutNullStreams[] = []
const ipcServers: Array<{ server: Server; sockets: Set<Socket> }> = []

type BrowserRequest = {
  type: "runtime.request"
  requestID: string
  operation: "status" | "getInfo" | "command"
  contractVersion?: number
  method?: string
  params?: unknown
  timeoutMs?: number
  context?: {
    sessionID?: string
    messageID?: string
    toolCallID?: string
  }
}

function startMcpServer(serverPath: string, env: NodeJS.ProcessEnv) {
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
  const stderr: string[] = []
  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) lines.push(JSON.parse(line))
    }
  })
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => stderr.push(chunk))

  let nextID = 1
  async function request(method: string, params?: unknown) {
    const id = nextID
    nextID += 1
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    const started = Date.now()
    while (Date.now() - started < 5_000) {
      const index = lines.findIndex((line) => (line as { id?: unknown }).id === id)
      if (index >= 0) return lines.splice(index, 1)[0] as {
        result?: unknown
        error?: { message?: string }
      }
      if (child.exitCode !== null) {
        throw new Error(
          `Chrome MCP exited with ${child.exitCode}: ${stderr.join("")}`,
        )
      }
      await Bun.sleep(20)
    }
    throw new Error(
      `Timed out waiting for ${method}: ${stderr.join("")}`,
    )
  }

  return { child, request }
}

function runtimeProof(
  secret: string,
  input: {
    brokerInstanceID: string
    nonce: string
    clientInstanceID: string
    clientVersion: string
  },
) {
  return createHmac("sha256", secret)
    .update(browserIpcProofTranscript({ role: "runtime", ...input }))
    .digest("base64url")
}

async function startIpcGateway(
  handler: (request: BrowserRequest) => unknown | Promise<unknown>,
) {
  const suffix = `${process.pid}-${randomUUID()}`
  const endpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\anybox-chrome-runtime-test-${suffix}`
    : join(process.cwd(), `.anybox-chrome-runtime-test-${suffix}.sock`)
  const brokerInstanceID = `broker-${suffix}`
  const proof = `proof-${suffix}`
  const requests: BrowserRequest[] = []
  const sockets = new Set<Socket>()
  let connectionCount = 0
  let disconnectCount = 0

  const server = createServer((socket) => {
    sockets.add(socket)
    connectionCount += 1
    socket.on("close", () => {
      sockets.delete(socket)
      disconnectCount += 1
    })
    const decoder = new BrowserIpcFrameDecoder()
    const nonce = `challenge-${randomUUID()}`
    let authenticated = false
    socket.write(encodeBrowserIpcFrame({
      type: "challenge",
      protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
      role: "runtime",
      brokerInstanceID,
      nonce,
      expiresAt: Date.now() + 5_000,
    }))
    socket.on("data", (chunk) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk
      for (const value of decoder.push(bytes)) {
        void (async () => {
          const message = value as Record<string, unknown>
          if (!authenticated) {
            const proofInput = {
              brokerInstanceID,
              nonce,
              clientInstanceID: String(message.clientInstanceID),
              clientVersion: String(message.clientVersion),
            }
            if (
              message.type !== "hello"
              || message.protocolVersion !== BROWSER_IPC_PROTOCOL_VERSION
              || message.role !== "runtime"
              || message.brokerInstanceID !== brokerInstanceID
              || message.nonce !== nonce
              || message.proof !== runtimeProof(proof, proofInput)
            ) {
              socket.end(encodeBrowserIpcFrame({
                type: "error",
                code: "AUTH_FAILED",
                message: "Test Browser IPC authentication failed.",
              }))
              return
            }
            authenticated = true
            socket.write(encodeBrowserIpcFrame({
              type: "ready",
              protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
              role: "runtime",
              brokerInstanceID,
              applicationCapabilities: {
                runtimeOperations: ["status", "getInfo", "command"],
                browserContractVersions: [BROWSER_CONTRACT_VERSION],
              },
            }))
            return
          }

          const request = message as unknown as BrowserRequest
          requests.push(request)
          try {
            socket.write(encodeBrowserIpcFrame({
              type: "runtime.response",
              requestID: request.requestID,
              ok: true,
              data: await handler(request),
            }))
          } catch (error) {
            const errorCode =
              error
              && typeof error === "object"
              && "code" in error
              && typeof error.code === "string"
                ? error.code
                : "COMMAND_FAILED"
            socket.write(encodeBrowserIpcFrame({
              type: "runtime.response",
              requestID: request.requestID,
              ok: false,
              error: {
                code: errorCode,
                message: error instanceof Error ? error.message : String(error),
                retryable: false,
              },
            }))
          }
        })()
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(endpoint, () => {
      server.off("error", reject)
      resolve()
    })
  })
  ipcServers.push({ server, sockets })

  return {
    env: {
      ANYBOX_BROWSER_IPC_PROTOCOL_VERSION: String(BROWSER_IPC_PROTOCOL_VERSION),
      ANYBOX_BROWSER_IPC_TRANSPORT: process.platform === "win32"
        ? "windows-named-pipe"
        : "unix-domain-socket",
      ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT: endpoint,
      ANYBOX_BROWSER_IPC_NATIVE_ENDPOINT: process.platform === "win32"
        ? `${endpoint}-native`
        : `${endpoint}.native`,
      ANYBOX_BROWSER_IPC_BOOTSTRAP_PATH: join(
        process.cwd(),
        `.anybox-native-bootstrap-${suffix}.json`,
      ),
      ANYBOX_BROWSER_IPC_BROKER_INSTANCE_ID: brokerInstanceID,
      ANYBOX_BROWSER_IPC_RUNTIME_PROOF: proof,
    },
    requests,
    get connectionCount() {
      return connectionCount
    },
    get disconnectCount() {
      return disconnectCount
    },
  }
}

async function runtimeFixture(
  handler: (request: BrowserRequest) => unknown | Promise<unknown> = (
    request,
  ) => request.operation === "status" ? { connected: true } : {},
) {
  const gateway = await startIpcGateway((request) =>
    request.operation === "getInfo"
      ? createBrowserGetInfoResult(
          createBrowserBackendInfo({
            connected: true,
            commands: BROWSER_CONTRACT_COMMAND_METHODS,
          }),
        )
      : handler(request)
  )
  return {
    gateway,
    mcp: startMcpServer(nodeReplServerPath, gateway.env),
  }
}

afterEach(async () => {
  for (const child of children.splice(0)) child.kill()
  await Promise.all(ipcServers.splice(0).map(({ server, sockets }) => {
    for (const socket of sockets) socket.destroy()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  }))
})

describe("Chrome plugin runtimes", () => {
  test("uses the canonical generated plugin package layout and capability boundary", () => {
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
    expect(existsSync(join(chromePluginRoot, ".anybox-plugin", "plugin.json"))).toBe(true)
    expect(existsSync(join(chromePluginRoot, "plugin.json"))).toBe(false)
    expect(existsSync(join(chromePluginRoot, "browser-extension", "src"))).toBe(false)
    expect(existsSync(join(chromePluginRoot, "browser-native-host"))).toBe(false)
    expect(
      existsSync(join(chromePluginRoot, "extension-host", "windows", "x64", "extension-host.exe")),
    ).toBe(true)
    expect(existsSync(join(chromePluginRoot, "browser-extension", "package.json"))).toBe(false)
    expect(pluginManifest).toEqual(sourceManifest)
    expect(pluginManifest.name).toBe("chrome")
    expect(pluginManifest.version).toBe("0.6.0")
    expect(pluginManifest.mcpServers?.map((server: { id: string }) => server.id))
      .toEqual(["node-repl"])
    expect(JSON.stringify(pluginManifest)).not.toContain(
      "Allows raw page JavaScript",
    )
    expect(JSON.stringify(pluginManifest)).toContain(
      "Chrome DevTools Protocol commands are disabled",
    )
    expect(extensionManifest.icons).toEqual({
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    })
    expect(existsSync(join(chromePluginScriptsRoot, "browser-client.mjs"))).toBe(true)
    expect(existsSync(join(chromePluginScriptsRoot, "browser-gateway-worker.js"))).toBe(true)
    expect(existsSync(join(chromePluginScriptsRoot, "browser-ipc-client.cjs"))).toBe(true)
    expect(existsSync(join(chromePluginScriptsRoot, "browser-server.js"))).toBe(false)
    expect(existsSync(nodeReplServerPath)).toBe(true)
    expect(existsSync(join(chromePluginScriptsRoot, "installManifest.mjs"))).toBe(true)
    expect(existsSync(join(chromePluginScriptsRoot, "native-host-bootstrap.js"))).toBe(true)
  })

  test("passes MCP initialize, tools/list, and a safe tools/call while preserving state", async () => {
    const { mcp } = await runtimeFixture()
    const initialized = await mcp.request("initialize") as {
      result?: { serverInfo?: { version?: string } }
    }
    expect(initialized.result?.serverInfo?.version).toBe("0.4.0")

    const list = await mcp.request("tools/list") as {
      result?: { tools?: Array<{ name: string }> }
    }
    expect(list.result?.tools?.map((tool) => tool.name)).toEqual([
      "js",
      "js_reset",
      "js_add_node_module_dir",
    ])

    const first = await mcp.request("tools/call", {
      name: "js",
      arguments: {
        code: "globalThis.answer = (globalThis.answer || 0) + 1\nreturn globalThis.answer",
      },
    }) as { result?: { structuredContent?: { result?: unknown } } }
    const second = await mcp.request("tools/call", {
      name: "js",
      arguments: {
        code: "globalThis.answer = (globalThis.answer || 0) + 1\nreturn globalThis.answer",
      },
    }) as { result?: { structuredContent?: { result?: unknown } } }

    expect(first.result?.structuredContent?.result).toBe(1)
    expect(second.result?.structuredContent?.result).toBe(2)
  })

  test("keeps legacy and IPC credentials outside the model-visible environment", async () => {
    const gateway = await startIpcGateway(() => ({ connected: true }))
    const mcp = startMcpServer(nodeReplServerPath, {
      ...gateway.env,
      ANYBOX_BROWSER_TRUSTED_TOKEN: "legacy-trusted-secret",
      ANYBOX_BROWSER_TRANSPORT_TOKEN: "legacy-transport-secret",
    })
    await mcp.request("initialize")

    const response = await mcp.request("tools/call", {
      name: "js",
      arguments: {
        code: [
          "const env = require('node:process').env",
          "return Object.fromEntries([",
          "  'ANYBOX_BROWSER_TRUSTED_TOKEN',",
          "  'ANYBOX_BROWSER_TRANSPORT_TOKEN',",
          "  'ANYBOX_BROWSER_IPC_PROTOCOL_VERSION',",
          "  'ANYBOX_BROWSER_IPC_TRANSPORT',",
          "  'ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT',",
          "  'ANYBOX_BROWSER_IPC_NATIVE_ENDPOINT',",
          "  'ANYBOX_BROWSER_IPC_BOOTSTRAP_PATH',",
          "  'ANYBOX_BROWSER_IPC_BROKER_INSTANCE_ID',",
          "  'ANYBOX_BROWSER_IPC_RUNTIME_PROOF',",
          "].filter((key) => env[key] !== undefined).map((key) => [key, env[key]]))",
        ].join("\n"),
      },
    }) as { result?: { structuredContent?: { result?: unknown } } }

    expect(response.result?.structuredContent?.result).toEqual({})
  })

  test("uses IPC without exposing traffic to model fetch or diagnostics hooks", async () => {
    const { gateway, mcp } = await runtimeFixture(() => ({
      connected: true,
      extension: "test",
    }))
    await mcp.request("initialize")

    const response = await mcp.request("tools/call", {
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
    }) as { result?: { structuredContent?: { result?: unknown } } }

    expect(response.result?.structuredContent?.result).toEqual({
      connected: true,
      interceptedFetch: false,
      observedRequests: 0,
    })
    expect(gateway.requests).toHaveLength(2)
    expect(gateway.requests[0]).toMatchObject({ operation: "getInfo" })
    expect(gateway.requests[1]).toMatchObject({ operation: "status" })
  })

  test("fails closed when the runtime IPC protocol is incompatible", async () => {
    const gateway = await startIpcGateway(() => ({ connected: true }))
    const mcp = startMcpServer(nodeReplServerPath, {
      ...gateway.env,
      ANYBOX_BROWSER_IPC_PROTOCOL_VERSION: "99",
    })

    const response = await mcp.request("initialize")
    expect(response.error?.message).toContain(
      "Chrome browser gateway IPC protocol version is incompatible",
    )
  })

  test("keeps raw page evaluation disabled before any command request", async () => {
    const { gateway, mcp } = await runtimeFixture(() => ({ value: 2 }))
    await mcp.request("initialize")

    const response = await mcp.request("tools/call", {
      name: "js",
      arguments: {
        code: [
          "const runtime = await agent.browsers.get('extension')",
          "const tab = await runtime.tabs.get(7)",
          "return await tab.evaluate('1 + 1')",
        ].join("\n"),
      },
    }) as { result?: { structuredContent?: { error?: string } } }

    expect(response.result?.structuredContent?.error).toContain(
      "disabled until Anybox can enforce command-level capability",
    )
    expect(gateway.requests).toHaveLength(1)
    expect(gateway.requests[0]).toMatchObject({ operation: "getInfo" })
  })

  test("keeps the worker transport-only and leaves raw-method rejection to the Agent", async () => {
    const gateway = await startIpcGateway((request) => {
      if (request.method === "page.executeScript") {
        throw Object.assign(
          new Error("Browser command 'page.executeScript' is not supported."),
          { code: "COMMAND_NOT_SUPPORTED" },
        )
      }
      return {}
    })
    const worker = new Worker(browserGatewayWorkerPath, {
      workerData: {
        protocolVersion: gateway.env.ANYBOX_BROWSER_IPC_PROTOCOL_VERSION,
        runtimeEndpoint: gateway.env.ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT,
        brokerInstanceID: gateway.env.ANYBOX_BROWSER_IPC_BROKER_INSTANCE_ID,
        runtimeProof: gateway.env.ANYBOX_BROWSER_IPC_RUNTIME_PROOF,
        clientVersion: "test-worker",
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
      })
      const raw = await request(2, {
        type: "command",
        method: "page.executeScript",
      })
      const oversizedMethod = await request(3, {
        type: "command",
        method: "x".repeat(129),
      })
      const invalidTimeout = await request(4, {
        type: "command",
        method: "tabs.list",
        timeoutMs: 0,
      })
      const invalidContext = await request(5, {
        type: "command",
        method: "tabs.list",
        context: { sessionID: "   " },
      })

      expect(trusted.ok).toBe(false)
      expect(trusted.error).toContain("request type is invalid")
      expect(raw.ok).toBe(false)
      expect(raw.error).toContain("page.executeScript")
      expect(oversizedMethod.ok).toBe(false)
      expect(oversizedMethod.error).toContain("method is invalid")
      expect(invalidTimeout.ok).toBe(false)
      expect(invalidTimeout.error).toContain("timeout is invalid")
      expect(invalidContext.ok).toBe(false)
      expect(invalidContext.error).toContain("context is invalid")
      expect(gateway.requests).toHaveLength(1)
      expect(gateway.requests[0]).toMatchObject({
        operation: "command",
        method: "page.executeScript",
      })
    } finally {
      await worker.terminate()
    }
  })

  test("forwards MCP request context and emits screenshots as image content", async () => {
    const imageData = Buffer.from("fixture-png").toString("base64")
    const { gateway, mcp } = await runtimeFixture((request) => {
      expect(request).toMatchObject({
        operation: "command",
        contractVersion: BROWSER_CONTRACT_VERSION,
        method: "page.screenshot",
        context: {
          sessionID: "session-1",
          messageID: "message-1",
          toolCallID: "tool-1",
        },
      })
      return {
        tabId: 7,
        mime: "image/png",
        data: imageData,
      }
    })
    await mcp.request("initialize")

    const response = await mcp.request("tools/call", {
      name: "js",
      arguments: {
        code: [
          "const runtime = await agent.browsers.get('extension')",
          "const tab = await runtime.tabs.get(7)",
          "await nodeRepl.emitImage(await tab.screenshot())",
        ].join("\n"),
      },
      _meta: {
        sessionID: "session-1",
        messageID: "message-1",
        toolCallID: "tool-1",
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
    expect(gateway.requests).toHaveLength(2)
    expect(gateway.requests[0]).toMatchObject({ operation: "getInfo" })
    expect(gateway.requests[1]).toMatchObject({
      operation: "command",
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "page.screenshot",
    })
  })

  test("binds host context and Worker transport before model prototype mutation", async () => {
    const { gateway, mcp } = await runtimeFixture((request) => {
      expect(request).toMatchObject({
        operation: "command",
        contractVersion: BROWSER_CONTRACT_VERSION,
        method: "tabs.list",
        context: {
          sessionID: "host-session",
          messageID: "host-message",
          toolCallID: "host-tool",
        },
      })
      return { tabs: [] }
    })
    await mcp.request("initialize")

    const response = await mcp.request("tools/call", {
      name: "js",
      arguments: {
        code: [
          "const { Worker } = require('node:worker_threads')",
          "const { AsyncLocalStorage } = require('node:async_hooks')",
          "Worker.prototype.postMessage = () => {",
          "  throw new Error('mutated Worker.prototype.postMessage')",
          "}",
          "AsyncLocalStorage.prototype.getStore = () => ({",
          "  sessionID: 'forged-session',",
          "  messageID: 'forged-message',",
          "  toolCallID: 'forged-tool',",
          "})",
          "return (await (await agent.browsers.get('extension')).tabs.list()).length",
        ].join("\n"),
      },
      _meta: {
        sessionID: "host-session",
        messageID: "host-message",
        toolCallID: "host-tool",
      },
    }) as { result?: { structuredContent?: { result?: unknown } } }

    expect(response.result?.structuredContent?.result).toBe(0)
    expect(gateway.requests).toHaveLength(2)
  })

  test("reset closes the IPC socket and reconnects on the next browser call", async () => {
    const { gateway, mcp } = await runtimeFixture(() => ({ connected: true }))
    await mcp.request("initialize")
    await mcp.request("tools/call", {
      name: "js",
      arguments: {
        code: "return await (await agent.browsers.get('extension')).status()",
      },
    })
    expect(gateway.connectionCount).toBe(1)

    await mcp.request("tools/call", {
      name: "js_reset",
      arguments: {},
    })
    const started = Date.now()
    while (gateway.disconnectCount < 1 && Date.now() - started < 2_000) {
      await Bun.sleep(10)
    }
    expect(gateway.disconnectCount).toBeGreaterThanOrEqual(1)

    await mcp.request("tools/call", {
      name: "js",
      arguments: {
        code: "return await (await agent.browsers.get('extension')).status()",
      },
    })
    expect(gateway.connectionCount).toBe(2)
  })
})
