import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as BuiltinMcp from "../src/mcp/builtin"
import { McpClient } from "../src/mcp/client"

const temporaryRoots: string[] = []
const originalNodeBinary = process.env.ANYBOX_NODE_BINARY
const originalNodeRunAsNode = process.env.ANYBOX_NODE_RUN_AS_NODE

function nodeReplServer() {
  const definition = BuiltinMcp.getDefinition(BuiltinMcp.NODE_REPL_DEFINITION_ID)
  if (!definition) throw new Error("Expected the built-in Node REPL MCP definition.")
  return {
    id: definition.serverID,
    ...definition.runtime,
    transport: "stdio" as const,
    enabled: definition.runtime.enabled ?? true,
    owner: {
      kind: "anybox" as const,
      bindingID: definition.id,
    },
  }
}

async function createClient(options: {
  onElicitation?: ConstructorParameters<typeof McpClient>[0]["onElicitation"]
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "anybox-node-repl-"))
  temporaryRoots.push(root)
  return new McpClient({
    cwd: root,
    worktree: root,
    requestTimeoutMs: 10_000,
    server: nodeReplServer(),
    onElicitation: options.onElicitation,
  })
}

afterEach(async () => {
  if (originalNodeBinary === undefined) delete process.env.ANYBOX_NODE_BINARY
  else process.env.ANYBOX_NODE_BINARY = originalNodeBinary
  if (originalNodeRunAsNode === undefined) delete process.env.ANYBOX_NODE_RUN_AS_NODE
  else process.env.ANYBOX_NODE_RUN_AS_NODE = originalNodeRunAsNode
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true })
    ),
  )
})

describe("built-in Node REPL MCP", () => {
  test("is a platform-owned general-purpose runtime with no Chrome implementation", async () => {
    const definition = BuiltinMcp.getDefinition("node-repl")
    expect(definition).toMatchObject({
      id: "node-repl",
      serverID: "anybox.node-repl",
      risk: "high",
      available: true,
    })
    const configuredRuntime = definition?.runtime
    expect(configuredRuntime).toMatchObject({
      transport: "stdio",
      command: "node",
    })
    expect(configuredRuntime?.cwd).toBeUndefined()

    const source = await readFile(configuredRuntime?.args?.[0] ?? "", "utf8")
    expect(source).toContain("anybox-node-repl")
    expect(source).not.toMatch(
      /Chrome|browser|native-host|requestHost|getCapability/,
    )
  })

  test("uses Electron's Node mode in the managed desktop runtime", () => {
    process.env.ANYBOX_NODE_BINARY = "C:\\Anybox\\Anybox.exe"
    process.env.ANYBOX_NODE_RUN_AS_NODE = "1"
    const runtime = BuiltinMcp.getDefinition("node-repl")?.runtime
    expect(runtime).toMatchObject({
      transport: "stdio",
      command: "C:\\Anybox\\Anybox.exe",
      env: {
        ELECTRON_RUN_AS_NODE: "1",
      },
    })
  })

  test("keeps JavaScript state and exposes only generic Node helpers", async () => {
    const client = await createClient()
    try {
      expect((await client.listTools()).map((tool) => tool.name)).toEqual([
        "js",
        "js_reset",
        "js_add_node_module_dir",
      ])

      await client.callTool("js", { code: "globalThis.counter = 40" })
      const result = await client.callTool("js", {
        code: `return {
          counter: globalThis.counter + 2,
          cwd: nodeRepl.cwd,
          processType: typeof process,
          agentType: typeof agent,
          capabilityType: typeof nodeRepl.getCapability,
          requestHostType: typeof nodeRepl.requestHost
        }`,
      })
      expect(result.structuredContent?.result).toMatchObject({
        counter: 42,
        processType: "undefined",
        agentType: "undefined",
        capabilityType: "undefined",
        requestHostType: "undefined",
      })

      await client.callTool("js_reset", {})
      const reset = await client.callTool("js", {
        code: "return typeof globalThis.counter",
      })
      expect(reset.structuredContent?.result).toBe("undefined")
    } finally {
      await client.dispose()
    }
  })

  test("gives the built-in Node REPL only the browser receipt public key", async () => {
    const client = await createClient()
    try {
      const result = await client.callTool("js", {
        code: `const nodeProcess = await import("node:process")
          return {
            publicKey: nodeProcess.env.ANYBOX_BROWSER_AUTH_PUBLIC_KEY,
            privateKey: nodeProcess.env.ANYBOX_BROWSER_AUTH_PRIVATE_KEY
          }`,
      })
      const environment = result.structuredContent?.result as {
        publicKey?: unknown
        privateKey?: unknown
      }
      expect(typeof environment.publicKey).toBe("string")
      expect(environment.publicKey).toMatch(/^[A-Za-z0-9_-]+$/u)
      expect(environment.privateKey).toBeUndefined()
    } finally {
      await client.dispose()
    }
  })

  test("exposes generic per-call metadata without a business host-service bridge", async () => {
    const client = await createClient()
    try {
      const result = await client.callTool(
        "js",
        {
          code: `const pathModule = await import("node:path")
            return {
              requestMeta: nodeRepl.requestMeta,
              requestHostType: typeof nodeRepl.requestHost,
              importedModule: typeof pathModule.resolve
            }`,
        },
        undefined,
        {
          sessionID: "session-node-repl",
          turnID: "turn-node-repl",
          messageID: "message-node-repl",
          toolCallID: "tool-node-repl",
        },
      )

      expect(result.isError).toBe(false)
      expect(result.structuredContent?.result).toMatchObject({
        requestMeta: {
          sessionID: "session-node-repl",
          turnID: "turn-node-repl",
          messageID: "message-node-repl",
          toolCallID: "tool-node-repl",
        },
        requestHostType: "undefined",
        importedModule: "function",
      })

      const nextCall = await client.callTool("js", {
        code: "return nodeRepl.requestMeta",
      })
      expect(nextCall.structuredContent?.result).toBeNull()
    } finally {
      await client.dispose()
    }
  })

  test("continues the same JavaScript promise after an in-process permission decision", async () => {
    let receivedMeta: Record<string, unknown> | undefined
    const client = await createClient({
      onElicitation: async (request) => {
        receivedMeta = request.params._meta?.["anybox/permission"] as Record<string, unknown>
        return {
          action: "accept",
          content: {
            decision: "allow-session",
            grantID: "grant-test",
            authorization: "receipt-test",
          },
        }
      },
    })
    try {
      const result = await client.callTool(
        "js",
        {
          code: `globalThis.permissionContinuation = ["before"]
            const permission = await nodeRepl.requestPermission({
              message: "Allow click?",
              method: "page.click",
              scope: {
                kind: "browser-origin",
                sessionID: "spoofed-session",
                extensionInstanceID: "extension-test",
                origin: "https://example.com"
              }
            })
            globalThis.permissionContinuation.push("after")
            return { permission, continuation: globalThis.permissionContinuation }`,
        },
        undefined,
        {
          sessionID: "session-node-repl",
          turnID: "turn-node-repl",
          messageID: "message-node-repl",
          toolCallID: "tool-node-repl",
        },
      )

      expect(result.isError).toBe(false)
      expect(result.structuredContent?.result).toEqual({
        permission: {
          allowed: true,
          decision: "allow-session",
          action: "accept",
          grantID: "grant-test",
          authorization: "receipt-test",
        },
        continuation: ["before", "after"],
      })
      expect(receivedMeta?.continuation).toBe("in-process")
      expect(receivedMeta?.timeoutMs).toBe(120_000)
      expect(receivedMeta?.context).toEqual({
        sessionID: "session-node-repl",
        turnID: "turn-node-repl",
        messageID: "message-node-repl",
        toolCallID: "tool-node-repl",
      })
    } finally {
      await client.dispose()
    }
  })

  test("does not charge user decision time against the JavaScript timeout", async () => {
    const client = await createClient({
      onElicitation: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80))
        return {
          action: "accept",
          content: {
            decision: "allow-once",
            grantID: "grant-delayed",
          },
        }
      },
    })
    try {
      const result = await client.callTool(
        "js",
        {
          code: `const decision = await nodeRepl.requestPermission({
              message: "Allow action?",
              timeoutMs: 1000
            })
            return decision.decision`,
          timeoutMs: 25,
        },
        undefined,
        {
          sessionID: "session-node-repl",
          turnID: "turn-node-repl",
          messageID: "message-node-repl",
          toolCallID: "tool-node-repl",
        },
      )
      expect(result.isError).toBe(false)
      expect(result.structuredContent?.result).toBe("allow-once")
    } finally {
      await client.dispose()
    }
  })
})
