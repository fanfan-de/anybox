import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as Connector from "../src/connector/connector"
import { McpClient } from "../src/mcp/client"

const temporaryRoots: string[] = []
const originalNodeBinary = process.env.ANYBOX_NODE_BINARY
const originalNodeRunAsNode = process.env.ANYBOX_NODE_RUN_AS_NODE

function nodeReplServer() {
  return {
    id: "connector.node-repl.default",
    name: "Node REPL",
    transport: "connector" as const,
    connectorId: "connector:node-repl:default",
    connectorRuntimeId: "default",
    enabled: true,
    owner: {
      kind: "anybox" as const,
      bindingID: "connector.node-repl.default",
    },
  }
}

async function createClient() {
  const root = await mkdtemp(join(tmpdir(), "anybox-node-repl-"))
  temporaryRoots.push(root)
  return new McpClient({
    cwd: root,
    worktree: root,
    requestTimeoutMs: 10_000,
    server: nodeReplServer(),
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

describe("built-in Node REPL connector", () => {
  test("is a platform-owned general-purpose runtime with no Chrome implementation", async () => {
    const definition = Connector.getDefinition("node-repl")
    expect(definition).toMatchObject({
      id: "node-repl",
      category: "builtin_mcp",
      risk: "high",
      available: true,
    })
    const configuredRuntime = definition?.mcpRuntimes[0]
    expect(configuredRuntime).toMatchObject({
      id: "default",
      transport: "stdio",
      command: "node",
    })
    expect(
      configuredRuntime?.transport === "stdio"
        ? configuredRuntime.cwd
        : "unexpected-remote-runtime",
    ).toBeUndefined()

    const runtime = await Connector.resolveRuntime(
      "connector:node-repl:default",
      "default",
    )
    expect(runtime.transport).toBe("stdio")
    if (runtime.transport !== "stdio") throw new Error("Expected stdio runtime.")
    const source = await readFile(runtime.args?.[0] ?? "", "utf8")
    expect(source).toContain("anybox-node-repl")
    expect(source).not.toMatch(
      /Chrome|browser|native-host|requestHost|getCapability/,
    )
  })

  test("uses Electron's Node mode in the managed desktop runtime", () => {
    process.env.ANYBOX_NODE_BINARY = "C:\\Anybox\\Anybox.exe"
    process.env.ANYBOX_NODE_RUN_AS_NODE = "1"
    const runtime = Connector.getDefinition("node-repl")?.mcpRuntimes[0]
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
          messageID: "message-node-repl",
          toolCallID: "tool-node-repl",
        },
      )

      expect(result.isError).toBe(false)
      expect(result.structuredContent?.result).toMatchObject({
        requestMeta: {
          sessionID: "session-node-repl",
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
})
