import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  ANYBOX_CHROME_EXTENSION_ID,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
} from "@anybox/shared/browser-extension"
import {
  BROWSER_CONTRACT_COMMAND_METHODS,
  BROWSER_CONTRACT_VERSION,
} from "@anybox/shared/browser-contract"
import { browserExtensionBridge } from "#browser-extension/bridge.ts"
import { McpClient } from "#mcp/client.ts"

const repoRoot = join(import.meta.dir, "..", "..", "..")
const chromePluginProjectRoot = join(repoRoot, "packages", "chrome-plugin")
const chromePluginRoot = join(repoRoot, "plugins", "Anybox-Plugins", "chrome")
const chromePluginScriptsRoot = join(chromePluginRoot, "scripts")
const browserClientPath = join(chromePluginScriptsRoot, "browser-client.mjs")
const nodeReplServerPath = join(
  repoRoot,
  "packages",
  "anyboxagent",
  "connectors",
  "node-repl",
  "server.js",
)
const activeConnections: string[] = []
const clients: McpClient[] = []
const originalNativeInstall = process.env.ANYBOX_BROWSER_NATIVE_INSTALL

type ExtensionCommand = {
  type: "command"
  commandID: string
  contractVersion: number
  method: string
  params?: Record<string, unknown>
  context?: {
    sessionID?: string
    messageID?: string
    toolCallID?: string
  }
}

function createNodeReplClient() {
  const client = new McpClient({
    cwd: repoRoot,
    worktree: repoRoot,
    requestTimeoutMs: 10_000,
    server: {
      id: "connector.node-repl.default",
      name: "Node REPL",
      transport: "connector",
      connectorId: "connector:node-repl:default",
      connectorRuntimeId: "default",
      enabled: true,
      owner: {
        kind: "anybox",
        bindingID: "connector.node-repl.default",
      },
    },
  })
  clients.push(client)
  return client
}

function registerExtension(
  handler: (command: ExtensionCommand) => unknown,
) {
  const commands: ExtensionCommand[] = []
  let connectionID = ""
  const socket = {
    send(data: string) {
      const message = JSON.parse(data) as ExtensionCommand
      if (message.type !== "command") return
      commands.push(message)
      queueMicrotask(() => {
        try {
          browserExtensionBridge.handleRawMessage(connectionID, {
            type: "result",
            commandID: message.commandID,
            ok: true,
            data: handler(message),
          })
        } catch (error) {
          browserExtensionBridge.handleRawMessage(connectionID, {
            type: "result",
            commandID: message.commandID,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            code: "COMMAND_FAILED",
            retryable: false,
          })
        }
      })
    },
    close() {},
  }
  connectionID = browserExtensionBridge.register(socket, {
    transport: "native",
  })
  activeConnections.push(connectionID)
  browserExtensionBridge.handleRawMessage(connectionID, {
    type: "hello",
    protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
    extensionInstanceID: `chrome-plugin-runtime-${connectionID}`,
    extensionID: ANYBOX_CHROME_EXTENSION_ID,
    version: "0.2.0",
    capabilities: {
      contractVersion: BROWSER_CONTRACT_VERSION,
      commands: BROWSER_CONTRACT_COMMAND_METHODS,
    },
  })
  return commands
}

function browserBootstrap(...lines: string[]) {
  return [
    "if (globalThis.agent?.browsers == null) {",
    "  const { pathToFileURL } = require('node:url')",
    `  const { setupBrowserRuntime } = await import(pathToFileURL(${JSON.stringify(browserClientPath)}).href)`,
    "  await setupBrowserRuntime({ globals: globalThis })",
    "}",
    ...lines,
  ].join("\n")
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.dispose()))
  for (const connectionID of activeConnections.splice(0)) {
    browserExtensionBridge.unregister(connectionID)
  }
  if (originalNativeInstall === undefined) {
    delete process.env.ANYBOX_BROWSER_NATIVE_INSTALL
  } else {
    process.env.ANYBOX_BROWSER_NATIVE_INSTALL = originalNativeInstall
  }
})

describe("Chrome plugin runtimes", () => {
  test("ships Browser Client and Native Host assets but no Chrome-owned Node server", () => {
    const sourceManifest = JSON.parse(
      readFileSync(
        join(chromePluginProjectRoot, "runtime", ".anybox-plugin", "plugin.json"),
        "utf8",
      ),
    )
    const pluginManifest = JSON.parse(
      readFileSync(join(chromePluginRoot, ".anybox-plugin", "plugin.json"), "utf8"),
    )
    const nodeReplSource = readFileSync(nodeReplServerPath, "utf8")
    const browserClientSource = readFileSync(browserClientPath, "utf8")

    expect(pluginManifest).toEqual(sourceManifest)
    expect(pluginManifest.name).toBe("chrome")
    expect(pluginManifest.version).toBe("0.8.0")
    expect(pluginManifest.mcpServers ?? []).toEqual([])
    expect(pluginManifest.connectorRequirements).toEqual([
      expect.objectContaining({
        connector: "node-repl",
        runtimeIDs: ["default"],
        tools: ["js", "js_reset", "js_add_node_module_dir"],
        required: true,
      }),
    ])
    expect(existsSync(browserClientPath)).toBe(true)
    expect(existsSync(join(chromePluginScriptsRoot, "installManifest.mjs"))).toBe(true)
    expect(existsSync(join(chromePluginScriptsRoot, "native-host-bootstrap.js"))).toBe(true)
    expect(existsSync(join(chromePluginScriptsRoot, "node-repl-server.js"))).toBe(false)
    expect(existsSync(join(chromePluginScriptsRoot, "browser-gateway-worker.js"))).toBe(false)
    expect(existsSync(join(chromePluginScriptsRoot, "browser-ipc-client.cjs"))).toBe(false)
    expect(nodeReplSource).toContain("anybox-node-repl")
    expect(nodeReplSource).not.toMatch(
      /Chrome|browser-gateway|native-host|anybox\.browser-runtime|getCapability/,
    )
    expect(browserClientSource).toContain("requestHost")
    expect(browserClientSource).toContain("native-host-bootstrap.js")
    expect(browserClientSource).not.toContain("anybox.browser-runtime")
  })

  test("lets the agent import Browser Client into the generic Node REPL", async () => {
    process.env.ANYBOX_BROWSER_NATIVE_INSTALL = "off"
    const commands = registerExtension((command) => {
      if (command.method === "tabs.list") {
        return {
          tabs: [{
            id: 7,
            title: "Anybox",
            url: "https://example.com/",
            active: true,
          }],
        }
      }
      throw new Error(`Unexpected command: ${command.method}`)
    })
    const client = createNodeReplClient()

    const beforeImport = await client.callTool("js", {
      code: `return {
        hasAgent: Object.hasOwn(globalThis, "agent"),
        hasSetup: Object.hasOwn(globalThis, "setupBrowserRuntime"),
        capabilityType: typeof nodeRepl.getCapability,
        requestHostType: typeof nodeRepl.requestHost
      }`,
    })
    expect(beforeImport.structuredContent?.result).toEqual({
      hasAgent: false,
      hasSetup: false,
      capabilityType: "undefined",
      requestHostType: "function",
    })

    const result = await client.callTool(
      "js",
      {
        code: browserBootstrap(
          "globalThis.chrome = await agent.browsers.getDefault()",
          "const status = await chrome.status()",
          "const tabs = await chrome.tabs.list()",
          "return {",
          "  connected: status.connected,",
          "  browserId: chrome.browserId,",
          "  tabs: tabs.map(({ id, title, url, active }) => ({ id, title, url, active }))",
          "}",
        ),
      },
      undefined,
      {
        sessionID: "session-chrome",
        messageID: "message-chrome",
        toolCallID: "tool-chrome",
      },
    )

    expect(result.isError).toBe(false)
    expect(result.structuredContent?.result).toEqual({
      connected: true,
      browserId: "extension",
      tabs: [{
        id: 7,
        title: "Anybox",
        url: "https://example.com/",
        active: true,
      }],
    })
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      context: {
        sessionID: "session-chrome",
        messageID: "message-chrome",
        toolCallID: "tool-chrome",
      },
    })
  })

  test("preserves image output and denies raw page execution locally", async () => {
    process.env.ANYBOX_BROWSER_NATIVE_INSTALL = "off"
    const imageData = Buffer.from("fixture-png").toString("base64")
    const commands = registerExtension((command) => {
      if (command.method === "page.screenshot") {
        return {
          tabId: command.params?.tabId,
          mime: "image/png",
          data: imageData,
        }
      }
      throw new Error(`Unexpected command: ${command.method}`)
    })
    const client = createNodeReplClient()

    const screenshot = await client.callTool("js", {
      code: browserBootstrap(
        "globalThis.chrome = await agent.browsers.getDefault()",
        "const tab = await chrome.tabs.get(7)",
        "await nodeRepl.emitImage(await tab.screenshot())",
      ),
    })
    expect(screenshot.structuredContent?.imageCount).toBe(1)
    expect(screenshot.content).toContainEqual({
      type: "image",
      mimeType: "image/png",
      data: imageData,
    })
    expect(commands.map((command) => command.method)).toEqual(["page.screenshot"])

    const denied = await client.callTool("js", {
      code: "return await (await chrome.tabs.get(7)).evaluate('1 + 1')",
    })
    expect(denied.isError).toBe(true)
    expect(denied.structuredContent?.error).toContain(
      "disabled until Anybox can enforce command-level capability",
    )
    expect(commands.map((command) => command.method)).toEqual(["page.screenshot"])
  })
})
