import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { $ } from "bun"
import { once } from "node:events"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { toNodeHandler } from "@modelcontextprotocol/node"
import { createMcpHandler, fromJsonSchema, McpServer } from "@modelcontextprotocol/server"
import z from "zod"
import * as Config from "#config/config.ts"
import { McpClient } from "#mcp/client.ts"
import * as Mcp from "#mcp/manager.ts"
import * as Agent from "#agent/agent.ts"
import { Instance } from "#project/instance.ts"
import * as Project from "#project/project.ts"
import * as ResolveTools from "#session/core/resolve-tools.ts"
import * as db from "#database/Sqlite.ts"
import * as Tool from "#tool/tool.ts"
import * as ToolRegistry from "#tool/registry.ts"

async function createGitRepo(root: string, seed: string) {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, "README.md"), `# ${seed}\n`)
  await $`git init`.cwd(root).quiet()
  await $`git config user.email test@example.com`.cwd(root).quiet()
  await $`git config user.name anybox-test`.cwd(root).quiet()
  await $`git add README.md`.cwd(root).quiet()
  await $`git commit -m init`.cwd(root).quiet()
}

async function writeLegacyMockMcpServer(root: string) {
  const script = join(root, "mock-mcp-server.js")
  await writeFile(
    script,
    [
      "const readline = require('node:readline')",
      "const { appendFileSync, existsSync, writeFileSync } = require('node:fs')",
      "const rl = readline.createInterface({ input: process.stdin })",
      "function send(payload) { process.stdout.write(JSON.stringify(payload) + '\\n') }",
      "function trace(method) {",
      "  if (process.env.ANYBOX_MCP_TEST_TRACE) {",
      "    appendFileSync(process.env.ANYBOX_MCP_TEST_TRACE, `${method}\\n`)",
      "  }",
      "}",
      "const tools = [{",
      "  name: 'echo',",
      "  title: 'Echo',",
      "  description: 'Echo back the provided value',",
      "  inputSchema: {",
      "    type: 'object',",
      "    properties: { value: { type: 'string' } },",
      "    required: ['value'],",
      "    additionalProperties: false,",
      "  },",
      "  annotations: { readOnlyHint: true },",
      "}]",
      "const resources = [",
      "  {",
      "    uri: 'mock://notes/alpha',",
      "    name: 'alpha-note',",
      "    title: 'Alpha Note',",
      "    description: 'A static alpha note resource',",
      "    mimeType: 'text/plain',",
      "    size: 19,",
      "  },",
      "  {",
      "    uri: 'mock://binary/logo',",
      "    name: 'logo',",
      "    title: 'Logo Blob',",
      "    description: 'A small binary resource',",
      "    mimeType: 'application/octet-stream',",
      "    size: 5,",
      "  },",
      "]",
      "const resourceTemplates = [{",
      "  uriTemplate: 'mock://notes/{name}',",
      "  name: 'note-template',",
      "  title: 'Note Template',",
      "  description: 'Parameterized note resources',",
      "  mimeType: 'text/plain',",
      "}]",
      "rl.on('line', (line) => {",
      "  if (!line.trim()) return",
      "  const message = JSON.parse(line)",
      "  trace(String(message.method || 'response'))",
      "  if (message.method === 'initialize') {",
      "    send({",
      "      jsonrpc: '2.0',",
      "      id: message.id,",
      "      result: {",
      "        protocolVersion: '2025-06-18',",
      "        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },",
      "        serverInfo: { name: 'mock-stdio', version: '1.0.0' },",
      "      },",
      "    })",
      "    return",
      "  }",
      "  if (message.method === 'tools/list') {",
      "    if (process.env.ANYBOX_MCP_TEST_HANG_TOOLS_LIST === '1') return",
      "    send({ jsonrpc: '2.0', id: message.id, result: { tools } })",
      "    return",
      "  }",
      "  if (message.method === 'resources/list') {",
      "    send({ jsonrpc: '2.0', id: message.id, result: { resources } })",
      "    return",
      "  }",
      "  if (message.method === 'resources/templates/list') {",
      "    send({ jsonrpc: '2.0', id: message.id, result: { resourceTemplates } })",
      "    return",
      "  }",
      "  if (message.method === 'resources/read') {",
      "    const uri = message.params?.uri ?? ''",
      "    if (uri === 'mock://binary/logo') {",
      "      send({",
      "        jsonrpc: '2.0',",
      "        id: message.id,",
      "        result: {",
      "          contents: [{ uri, mimeType: 'application/octet-stream', blob: 'aGVsbG8=' }],",
      "        },",
      "      })",
      "      return",
      "    }",
      "    send({",
      "      jsonrpc: '2.0',",
      "      id: message.id,",
      "      result: {",
      "        contents: [{ uri, mimeType: 'text/plain', text: `resource:${uri}` }],",
      "      },",
      "    })",
      "    return",
      "  }",
      "  if (message.method === 'tools/call') {",
      "    const crashMarker = process.env.ANYBOX_MCP_TEST_CRASH_ONCE_MARKER",
      "    if (crashMarker && !existsSync(crashMarker)) {",
      "      writeFileSync(crashMarker, 'crashed')",
      "      process.exit(23)",
      "    }",
      "    const value = message.params?.arguments?.value ?? ''",
      "    send({",
      "      jsonrpc: '2.0',",
      "      id: message.id,",
      "      result: {",
      "        content: [{ type: 'text', text: `echo:${value}` }],",
      "        structuredContent: {",
      "          echoed: value,",
      "        },",
      "        isError: false,",
      "      },",
      "    })",
      "    return",
      "  }",
      "  if (message.method === 'ping') {",
      "    send({ jsonrpc: '2.0', id: message.id, result: {} })",
      "    return",
      "  }",
      "  if (message.method === 'roots/list') {",
      "    send({ jsonrpc: '2.0', id: message.id, result: { roots: [] } })",
      "    return",
      "  }",
      "  if (String(message.method || '').startsWith('notifications/')) {",
      "    return",
      "  }",
      "  send({",
      "    jsonrpc: '2.0',",
      "    id: message.id ?? null,",
      "    error: { code: -32601, message: `Unknown method: ${message.method}` },",
      "  })",
      "})",
      "rl.on('close', () => process.exit(0))",
    ].join("\n"),
  )
  return script
}

async function startMockHttpMcpServer() {
  const seenRequests: Array<{
    authorization?: string
    mcpMethod?: string
    mcpName?: string
    protocolVersion?: string
    sessionID?: string
    xApiKey?: string
  }> = []
  const seenEras: Array<"legacy" | "modern"> = []

  const handler = createMcpHandler(({ era }) => {
    seenEras.push(era)

    const mcp = new McpServer(
      {
        name: "mock-http",
        version: "1.0.0",
      },
      {
        cacheHints: {
          "tools/list": {
            ttlMs: 60_000,
            cacheScope: "private",
          },
        },
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
      },
    )
    mcp.registerTool(
      "echo",
      {
        title: "Echo",
        description: "Echo back the provided value",
        inputSchema: z.object({
          value: z.string(),
        }),
        annotations: {
          readOnlyHint: true,
        },
      },
      async ({ value }) => ({
        content: [{ type: "text", text: `echo:${value}` }],
        structuredContent: { echoed: value },
        isError: false,
      }),
    )
    mcp.registerTool(
      "write",
      {
        title: "Write",
        description: "Pretend to mutate data",
        inputSchema: z.object({
          value: z.string(),
        }),
      },
      async ({ value }) => ({
        content: [{ type: "text", text: `write:${value}` }],
        structuredContent: { written: value },
        isError: false,
      }),
    )
    mcp.registerTool(
      "array_result",
      {
        title: "Array Result",
        description: "Return a top-level JSON array",
        inputSchema: z.object({}),
        outputSchema: z.array(z.string()),
        annotations: {
          readOnlyHint: true,
        },
      },
      async () => ({
        content: [{ type: "text", text: '["alpha","beta"]' }],
        structuredContent: ["alpha", "beta"],
        isError: false,
      }),
    )
    mcp.registerTool(
      "boolean_result",
      {
        title: "Boolean Result",
        description: "Return a top-level JSON scalar",
        inputSchema: z.object({}),
        outputSchema: z.boolean(),
        annotations: {
          readOnlyHint: true,
        },
      },
      async () => ({
        content: [{ type: "text", text: "false" }],
        structuredContent: false,
        isError: false,
      }),
    )
    mcp.registerTool(
      "reference_echo",
      {
        title: "Reference Echo",
        description: "Exercise a nested JSON Schema reference",
        inputSchema: fromJsonSchema<{ value: string }>({
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          $defs: {
            stringValue: {
              type: "string",
            },
          },
          properties: {
            value: {
              $ref: "#/$defs/stringValue",
            },
          },
          required: ["value"],
          additionalProperties: false,
        }),
        annotations: {
          readOnlyHint: true,
        },
      },
      async ({ value }) => ({
        content: [{ type: "text", text: `reference:${value}` }],
        structuredContent: { echoed: value },
        isError: false,
      }),
    )

    return mcp
  }, {
    legacy: "reject",
  })
  const nodeHandler = toNodeHandler(handler)

  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/mcp") {
      res.writeHead(405).end()
      return
    }

    seenRequests.push({
      authorization: req.headers.authorization,
      mcpMethod: req.headers["mcp-method"] as string | undefined,
      mcpName: req.headers["mcp-name"] as string | undefined,
      protocolVersion: req.headers["mcp-protocol-version"] as string | undefined,
      sessionID: req.headers["mcp-session-id"] as string | undefined,
      xApiKey: req.headers["x-api-key"] as string | undefined,
    })

    try {
      await nodeHandler(req, res)
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500).end()
        return
      }
      res.destroy(error instanceof Error ? error : undefined)
    }
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind mock HTTP MCP server.")
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    seenEras,
    seenRequests,
    async close() {
      await handler.close()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

describe("mcp integration", () => {
  test("McpClient should list and call stdio tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-client-"))

    try {
      const script = await writeLegacyMockMcpServer(root)
      const tracePath = join(root, "protocol-trace.log")
      const client = new McpClient({
        cwd: root,
        worktree: root,
        requestTimeoutMs: 1000,
        server: {
          id: "mock",
          name: "Mock",
          transport: "stdio",
          command: process.execPath,
          args: [script],
          env: {
            ANYBOX_MCP_TEST_TRACE: tracePath,
          },
          enabled: true,
        },
      })

      try {
        const tools = await client.listTools()
        expect(client.getProtocolEra()).toBe("legacy")
        expect(await client.listTools()).toEqual(tools)
        expect(tools).toHaveLength(1)
        expect(tools[0]).toMatchObject({
          name: "echo",
          title: "Echo",
        })

        const result = await client.callTool("echo", { value: "hello" })
        expect(result).toMatchObject({
          structuredContent: {
            echoed: "hello",
          },
          isError: false,
        })
        expect(result.content).toEqual([{ type: "text", text: "echo:hello" }])
      } finally {
        await client.dispose()
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      const tracedMethods = (await readFile(tracePath, "utf8"))
        .split(/\r?\n/u)
        .filter(Boolean)
      expect(tracedMethods).toContain("server/discover")
      expect(tracedMethods).toContain("initialize")
      expect(tracedMethods.filter((method) => method === "tools/list")).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("McpClient should not connect after disposal during transport creation", async () => {
    let closeCount = 0
    let releaseTransport!: (transport: { close(): Promise<void> }) => void
    const transportPromise = new Promise<{ close(): Promise<void> }>((resolve) => {
      releaseTransport = resolve
    })
    const client = new McpClient({
      cwd: process.cwd(),
      worktree: process.cwd(),
      requestTimeoutMs: 1000,
      server: {
        id: "delayed",
        name: "Delayed",
        transport: "stdio",
        command: process.execPath,
        enabled: true,
      },
    })
    const transportOwner = client as unknown as {
      createTransport(): Promise<{ close(): Promise<void> }>
    }
    transportOwner.createTransport = () => transportPromise

    const listPromise = client.listTools()
    await client.dispose()
    releaseTransport({
      close: async () => {
        closeCount += 1
      },
    })

    await expect(listPromise).rejects.toThrow("is closed")
    expect(closeCount).toBe(1)
    expect(client.getProtocolEra()).toBeUndefined()
  })

  test("McpClient should bound an unresponsive HTTP session termination", async () => {
    let abortObserved = false
    const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1/mcp"), {
      sessionId: "stuck-session",
      fetch: async (_url, init) => await new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          abortObserved = true
          reject(new Error("aborted"))
        }
        if (init?.signal?.aborted) {
          onAbort()
          return
        }
        init?.signal?.addEventListener("abort", onAbort, { once: true })
      }),
    })
    await transport.start()
    const client = new McpClient({
      cwd: process.cwd(),
      worktree: process.cwd(),
      requestTimeoutMs: 1,
      server: {
        id: "stuck-http",
        name: "Stuck HTTP",
        transport: "remote",
        serverUrl: "http://127.0.0.1/mcp",
        enabled: true,
      },
    })
    const transportOwner = client as unknown as {
      transport?: StreamableHTTPClientTransport
    }
    transportOwner.transport = transport

    const startedAt = Date.now()
    await client.dispose()

    expect(Date.now() - startedAt).toBeLessThan(1_500)
    expect(abortObserved).toBe(true)
  })

  test("McpClient should refresh honored lists after a subscription restart", async () => {
    const refreshCalls: string[] = []
    let toolsChanged = 0
    let resourcesChanged = 0
    const neverClosed = new Promise<"remote">(() => undefined)
    const sdkClient = {
      close: async () => undefined,
      listen: async () => ({
        honoredFilter: {
          toolsListChanged: true,
          resourcesListChanged: true,
        },
        closed: neverClosed,
        close: async () => undefined,
      }),
      listTools: async (_params: unknown, options: { cacheMode?: string }) => {
        refreshCalls.push(`tools:${options.cacheMode}`)
        return { tools: [] }
      },
      listResources: async (_params: unknown, options: { cacheMode?: string }) => {
        refreshCalls.push(`resources:${options.cacheMode}`)
        return { resources: [] }
      },
      listResourceTemplates: async (_params: unknown, options: { cacheMode?: string }) => {
        refreshCalls.push(`templates:${options.cacheMode}`)
        return { resourceTemplates: [] }
      },
    }
    const client = new McpClient({
      cwd: process.cwd(),
      worktree: process.cwd(),
      requestTimeoutMs: 1000,
      onToolsChanged: () => {
        toolsChanged += 1
      },
      onResourcesChanged: () => {
        resourcesChanged += 1
      },
      server: {
        id: "subscription-restart",
        name: "Subscription Restart",
        transport: "remote",
        serverUrl: "http://127.0.0.1/mcp",
        enabled: true,
      },
    })
    const owner = client as unknown as {
      client?: typeof sdkClient
      scheduleSubscriptionRestart(
        client: typeof sdkClient,
        filter: { toolsListChanged?: boolean; resourcesListChanged?: boolean },
        attempt: number,
      ): void
    }
    owner.client = sdkClient

    try {
      owner.scheduleSubscriptionRestart(sdkClient, {
        toolsListChanged: true,
        resourcesListChanged: true,
      }, 0)
      const deadline = Date.now() + 2_000
      while (refreshCalls.length < 3 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }

      expect(refreshCalls.sort()).toEqual([
        "resources:refresh",
        "templates:refresh",
        "tools:refresh",
      ])
      expect(toolsChanged).toBe(1)
      expect(resourcesChanged).toBe(1)
    } finally {
      await client.dispose()
    }
  })

  test("McpClient should list resource metadata and read resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-client-resources-"))

    try {
      const script = await writeLegacyMockMcpServer(root)
      const client = new McpClient({
        cwd: root,
        worktree: root,
        requestTimeoutMs: 1000,
        server: {
          id: "mock",
          name: "Mock",
          transport: "stdio",
          command: process.execPath,
          args: [script],
          enabled: true,
        },
      })

      try {
        const resources = await client.listResources()
        expect(resources.map((resource) => resource.uri)).toEqual([
          "mock://notes/alpha",
          "mock://binary/logo",
        ])
        expect(resources[0]).toMatchObject({
          name: "alpha-note",
          title: "Alpha Note",
          mimeType: "text/plain",
        })

        const resourceTemplates = await client.listResourceTemplates()
        expect(resourceTemplates).toEqual([
          expect.objectContaining({
            name: "note-template",
            title: "Note Template",
            uriTemplate: "mock://notes/{name}",
          }),
        ])

        const textResource = await client.readResource("mock://notes/alpha")
        expect(textResource.contents).toEqual([
          {
            uri: "mock://notes/alpha",
            mimeType: "text/plain",
            text: "resource:mock://notes/alpha",
          },
        ])

        const blobResource = await client.readResource("mock://binary/logo")
        expect(blobResource.contents).toEqual([
          {
            uri: "mock://binary/logo",
            mimeType: "application/octet-stream",
            blob: "aGVsbG8=",
          },
        ])
      } finally {
        await client.dispose()
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("McpClient should negotiate modern HTTP and preserve modern tool results", async () => {
    const remote = await startMockHttpMcpServer()

    try {
      const client = new McpClient({
        cwd: process.cwd(),
        worktree: process.cwd(),
        requestTimeoutMs: 1000,
        server: {
          id: "remote",
          name: "Remote",
          transport: "remote",
          serverUrl: remote.url,
          authorization: "remote-token",
          headers: {
            "x-api-key": "secret",
          },
          enabled: true,
        },
      })

      try {
        const tools = await client.listTools()
        expect(client.getProtocolEra()).toBe("modern")
        expect(tools.map((tool) => tool.name)).toEqual([
          "echo",
          "write",
          "array_result",
          "boolean_result",
          "reference_echo",
        ])
        expect(tools.find((tool) => tool.name === "array_result")?.outputSchema).toMatchObject({
          type: "array",
          items: {
            type: "string",
          },
        })
        expect(tools.find((tool) => tool.name === "reference_echo")?.inputSchema).toMatchObject({
          $defs: {
            stringValue: {
              type: "string",
            },
          },
          properties: {
            value: {
              $ref: "#/$defs/stringValue",
            },
          },
        })
        expect(await client.listTools()).toEqual(tools)

        const result = await client.callTool("echo", { value: "hello" })
        expect(result).toMatchObject({
          structuredContent: {
            echoed: "hello",
          },
          isError: false,
        })

        const arrayResult = await client.callTool("array_result", {})
        expect(arrayResult.structuredContent).toEqual(["alpha", "beta"])
        expect(arrayResult.content).toEqual([
          {
            type: "text",
            text: '["alpha","beta"]',
          },
        ])

        const booleanResult = await client.callTool("boolean_result", {})
        expect(booleanResult.structuredContent).toBe(false)

        const referenceResult = await client.callTool("reference_echo", {
          value: "schema-value",
        })
        expect(referenceResult.structuredContent).toEqual({
          echoed: "schema-value",
        })
      } finally {
        await client.dispose()
      }

      expect(remote.seenEras).not.toHaveLength(0)
      expect(remote.seenEras.every((era) => era === "modern")).toBe(true)
      expect(remote.seenRequests.map((request) => request.mcpMethod)).toContain("server/discover")
      expect(remote.seenRequests.map((request) => request.mcpMethod)).toContain("tools/list")
      expect(remote.seenRequests.filter((request) => request.mcpMethod === "tools/list")).toHaveLength(1)
      expect(remote.seenRequests).toEqual(expect.arrayContaining([
        expect.objectContaining({
          mcpMethod: "tools/call",
          mcpName: "echo",
        }),
        expect.objectContaining({
          mcpMethod: "tools/call",
          mcpName: "array_result",
        }),
        expect.objectContaining({
          mcpMethod: "tools/call",
          mcpName: "boolean_result",
        }),
        expect.objectContaining({
          mcpMethod: "tools/call",
          mcpName: "reference_echo",
        }),
      ]))
      for (const request of remote.seenRequests) {
        expect(request.protocolVersion).toBe("2026-07-28")
        expect(request.sessionID).toBeUndefined()
        expect(request.authorization).toBe("Bearer remote-token")
        expect(request.xApiKey).toBe("secret")
      }
    } finally {
      await remote.close()
    }
  })

  test("Mcp manager should expose MCP tools through the registry shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-manager-"))
    let projectID: string | undefined

    try {
      await createGitRepo(root, "mcp-manager")
      const script = await writeLegacyMockMcpServer(root)
      const { project } = await Project.fromDirectory(root)
      projectID = project.id

      await Config.setMcpServer(project.id, "mock", {
        name: "Mock",
        command: process.execPath,
        args: [script],
        enabled: true,
      })

      await Instance.provide({
        directory: root,
        fn: async () => {
          const tools = await Mcp.tools()
          const info = tools.find((item) => item.id === "mcp__mock__echo")

          expect(info).toBeDefined()
          expect(info?.title).toBe("Mock/Echo")

          const runtime = await info!.init()
          const output = Tool.normalizeToolOutput(await runtime.execute(
            { value: "hello" },
            {
              sessionID: "session_test",
              messageID: "message_test",
            },
          ))

          expect(output.text).toBe("echo:hello")
          expect(output.metadata).toMatchObject({
            serverID: "mock",
            toolName: "echo",
            mcpIsError: false,
            mcpStructuredContent: {
              echoed: "hello",
            },
          })

          const modelOutput = await runtime.toModelOutput?.(output)
          expect(modelOutput).toEqual({
            type: "json",
            value: {
              echoed: "hello",
            },
          })

          const agent = await Agent.get("default")
          if (!agent) throw new Error("Expected default agent")
          const toolPlan = await ResolveTools.resolveToolPlan({
            agent,
            sessionID: "session_test",
            messageID: "message_tool_plan",
            abort: new AbortController().signal,
            toolSearchEnabled: true,
          })
          expect(toolPlan.activeToolNames).toContain("mcp_mock_echo")
          expect(toolPlan.entries.find((entry) => entry.modelName === "mcp_mock_echo")).toMatchObject({
            exposure: "direct",
            discovered: false,
            item: {
              source: {
                id: "mock",
                kind: "mcp",
                name: "Mock",
              },
            },
          })
        },
      })
    } finally {
      await Instance.disposeAll()
      if (projectID) {
        db.deleteMany("project_configs", [{ column: "projectID", value: projectID }])
        db.deleteMany("projects", [{ column: "id", value: projectID }])
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  test("Mcp manager should cache tool schemas and use them while a failed transport is circuit-broken", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-cache-recovery-"))
    const trace = join(root, "mcp-trace.txt")
    const crashMarker = join(root, "crashed-once.txt")
    let projectID: string | undefined

    try {
      await createGitRepo(root, "mcp-cache-recovery")
      const script = await writeLegacyMockMcpServer(root)
      const { project } = await Project.fromDirectory(root)
      projectID = project.id
      await Config.setMcpServer(project.id, "mock", {
        name: "Mock",
        command: process.execPath,
        args: [script],
        env: {
          ANYBOX_MCP_TEST_TRACE: trace,
          ANYBOX_MCP_TEST_CRASH_ONCE_MARKER: crashMarker,
        },
        timeoutMs: 1_000,
        enabled: true,
      })

      await Instance.provide({
        directory: root,
        fn: async () => {
          const first = await Mcp.tools()
          const second = await Mcp.tools()
          expect(first.some((tool) => tool.id === "mcp__mock__echo")).toBe(true)
          expect(second.some((tool) => tool.id === "mcp__mock__echo")).toBe(true)
          expect((await readFile(trace, "utf8")).split(/\r?\n/).filter((line) => line === "tools/list"))
            .toHaveLength(1)

          const runtime = await first.find((tool) => tool.id === "mcp__mock__echo")!.init()
          await expect(runtime.execute({ value: "crash" }, {
            sessionID: "session-cache",
            messageID: "message-cache",
          })).rejects.toThrow()

          const started = Date.now()
          const cachedAfterFailure = await Mcp.tools()
          expect(Date.now() - started).toBeLessThan(500)
          expect(cachedAfterFailure.some((tool) => tool.id === "mcp__mock__echo")).toBe(true)
          expect((await readFile(trace, "utf8")).split(/\r?\n/).filter((line) => line === "tools/list"))
            .toHaveLength(1)

          await Bun.sleep(2_100)
          const recovered = Tool.normalizeToolOutput(await runtime.execute({ value: "recovered" }, {
            sessionID: "session-cache",
            messageID: "message-cache-recovered",
          }))
          expect(recovered.text).toBe("echo:recovered")
        },
      })
    } finally {
      await Instance.disposeAll()
      if (projectID) {
        db.deleteMany("project_configs", [{ column: "projectID", value: projectID }])
        db.deleteMany("projects", [{ column: "id", value: projectID }])
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  test("a cold unresponsive MCP server does not block tools from healthy servers", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-partial-discovery-"))
    const hangingTrace = join(root, "hanging-trace.txt")
    let projectID: string | undefined

    try {
      await createGitRepo(root, "mcp-partial-discovery")
      const script = await writeLegacyMockMcpServer(root)
      const { project } = await Project.fromDirectory(root)
      projectID = project.id
      await Config.setMcpServer(project.id, "fast", {
        name: "Fast",
        command: process.execPath,
        args: [script],
        timeoutMs: 120_000,
        enabled: true,
      })
      await Config.setMcpServer(project.id, "hanging", {
        name: "Hanging",
        command: process.execPath,
        args: [script],
        env: {
          ANYBOX_MCP_TEST_HANG_TOOLS_LIST: "1",
          ANYBOX_MCP_TEST_TRACE: hangingTrace,
        },
        timeoutMs: 120_000,
        enabled: true,
      })

      await Instance.provide({
        directory: root,
        fn: async () => {
          const started = Date.now()
          const discovered = await Mcp.tools()
          expect(Date.now() - started).toBeLessThan(3_500)
          expect(discovered.some((tool) => tool.id === "mcp__fast__echo")).toBe(true)
          expect(discovered.some((tool) => tool.id === "mcp__hanging__echo")).toBe(false)

          const repeatedStarted = Date.now()
          const repeated = await Mcp.tools()
          expect(Date.now() - repeatedStarted).toBeLessThan(500)
          expect(repeated.some((tool) => tool.id === "mcp__fast__echo")).toBe(true)
          expect((await readFile(hangingTrace, "utf8")).split(/\r?\n/)
            .filter((line) => line === "tools/list"))
            .toHaveLength(1)
        },
      })
    } finally {
      await Instance.disposeAll()
      if (projectID) {
        db.deleteMany("project_configs", [{ column: "projectID", value: projectID }])
        db.deleteMany("projects", [{ column: "id", value: projectID }])
      }
      await rm(root, { recursive: true, force: true })
    }
  }, 10_000)

  test("turn cancellation aborts MCP tool discovery without waiting for the request timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-discovery-cancel-"))
    let projectID: string | undefined

    try {
      await createGitRepo(root, "mcp-discovery-cancel")
      const script = await writeLegacyMockMcpServer(root)
      const { project } = await Project.fromDirectory(root)
      projectID = project.id
      await Config.setMcpServer(project.id, "hanging", {
        name: "Hanging",
        command: process.execPath,
        args: [script],
        env: {
          ANYBOX_MCP_TEST_HANG_TOOLS_LIST: "1",
        },
        timeoutMs: 120_000,
        enabled: true,
      })

      await Instance.provide({
        directory: root,
        fn: async () => {
          const agent = await Agent.get("default")
          if (!agent) throw new Error("Expected default agent")
          const controller = new AbortController()
          const started = Date.now()
          const pending = ResolveTools.resolveToolPlan({
            agent,
            sessionID: "session-discovery-cancel",
            messageID: "message-discovery-cancel",
            abort: controller.signal,
          })
          setTimeout(() => controller.abort(new Error("turn cancelled")), 100)

          await expect(pending).rejects.toThrow("turn cancelled")
          expect(Date.now() - started).toBeLessThan(3_500)
        },
      })
    } finally {
      await Instance.disposeAll()
      if (projectID) {
        db.deleteMany("project_configs", [{ column: "projectID", value: projectID }])
        db.deleteMany("projects", [{ column: "id", value: projectID }])
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  test("Mcp manager should expose project-scoped resources and read selected resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-manager-resources-"))
    let projectID: string | undefined

    try {
      await createGitRepo(root, "mcp-manager-resources")
      const script = await writeLegacyMockMcpServer(root)
      const { project } = await Project.fromDirectory(root)
      projectID = project.id

      await Config.setMcpServer(project.id, "mock", {
        name: "Mock",
        command: process.execPath,
        args: [script],
        enabled: true,
      })

      await Instance.provide({
        directory: root,
        fn: async () => {
          const resources = await Mcp.listResources()
          expect(resources.errors).toEqual([])
          expect(resources.items).toEqual([
            expect.objectContaining({
              serverID: "mock",
              serverName: "Mock",
              resource: expect.objectContaining({
                uri: "mock://notes/alpha",
                name: "alpha-note",
              }),
            }),
            expect.objectContaining({
              serverID: "mock",
              resource: expect.objectContaining({
                uri: "mock://binary/logo",
              }),
            }),
          ])

          const scopedResources = await Mcp.listResources("mock")
          expect(scopedResources.items).toHaveLength(2)

          const templates = await Mcp.listResourceTemplates("mock")
          expect(templates.errors).toEqual([])
          expect(templates.items).toEqual([
            expect.objectContaining({
              serverID: "mock",
              resourceTemplate: expect.objectContaining({
                uriTemplate: "mock://notes/{name}",
              }),
            }),
          ])

          const resource = await Mcp.readResource("mock", "mock://notes/alpha")
          expect(resource).toMatchObject({
            serverID: "mock",
            serverName: "Mock",
            uri: "mock://notes/alpha",
            contents: [
              {
                uri: "mock://notes/alpha",
                mimeType: "text/plain",
                text: "resource:mock://notes/alpha",
              },
            ],
          })

          await expect(Mcp.listResources("missing")).rejects.toThrow("is not available for project")
        },
      })
    } finally {
      await Instance.disposeAll()
      if (projectID) {
        db.deleteMany("project_configs", [{ column: "projectID", value: projectID }])
        db.deleteMany("projects", [{ column: "id", value: projectID }])
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  test("MCP resource tools should be built-in, read-only, and visible to read-only agents", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-resource-tools-"))
    let projectID: string | undefined

    try {
      await createGitRepo(root, "mcp-resource-tools")
      const script = await writeLegacyMockMcpServer(root)
      const { project } = await Project.fromDirectory(root)
      projectID = project.id

      await Config.setMcpServer(project.id, "mock", {
        name: "Mock",
        command: process.execPath,
        args: [script],
        enabled: true,
      })

      await Instance.provide({
        directory: root,
        fn: async () => {
          const builtinTools = await ToolRegistry.builtinTools()
          const ids = [
            "list_mcp_resources",
            "list_mcp_resource_templates",
            "read_mcp_resource",
          ]

          for (const id of ids) {
            const info = builtinTools.find((tool) => tool.id === id)
            expect(info).toBeDefined()
            expect(info?.capabilities).toMatchObject({
              kind: "read",
              readOnly: true,
              destructive: false,
              concurrency: "safe",
            })
          }

          const ctx = {
            sessionID: "session_mcp_resource_tools",
            messageID: "message_mcp_resource_tools",
          }
          const listRuntime = await builtinTools.find((tool) => tool.id === "list_mcp_resources")!.init()
          const listOutput = Tool.normalizeToolOutput(await listRuntime.execute({}, ctx))
          expect(listOutput.text).toContain("MCP resources: 2")
          expect(listOutput.text).toContain("mock://notes/alpha")
          expect(await listRuntime.toModelOutput?.(listOutput)).toMatchObject({
            type: "json",
            value: {
              kind: "mcp-resources",
              resources: expect.any(Array),
              errors: [],
            },
          })

          const templateRuntime = await builtinTools.find((tool) => tool.id === "list_mcp_resource_templates")!.init()
          const templateOutput = Tool.normalizeToolOutput(await templateRuntime.execute({ server_id: "mock" }, ctx))
          expect(templateOutput.text).toContain("mock://notes/{name}")

          const readRuntime = await builtinTools.find((tool) => tool.id === "read_mcp_resource")!.init()
          const textOutput = Tool.normalizeToolOutput(await readRuntime.execute(
            {
              server_id: "mock",
              uri: "mock://notes/alpha",
            },
            ctx,
          ))
          expect(textOutput.text).toContain("resource:mock://notes/alpha")

          const blobOutput = Tool.normalizeToolOutput(await readRuntime.execute(
            {
              server_id: "mock",
              uri: "mock://binary/logo",
            },
            ctx,
          ))
          expect(blobOutput.text).toContain("Blob: 5 bytes")
          expect(blobOutput.text).not.toContain("aGVsbG8=")
          expect(blobOutput.attachments).toEqual([
            {
              url: "data:application/octet-stream;base64,aGVsbG8=",
              mime: "application/octet-stream",
              filename: "logo",
            },
          ])
          expect((blobOutput.metadata?.contents as any[])[0]).toMatchObject({
            type: "blob",
            blobBytes: 5,
            blobOmitted: true,
          })

          const plan = await Agent.get("plan")
          if (!plan) {
            throw new Error("Expected built-in agents to exist.")
          }

          const planTools = await ResolveTools.resolveTools({
            agent: plan,
            sessionID: "session_mcp_resource_tools_plan",
            messageID: "message_mcp_resource_tools_plan",
            abort: new AbortController().signal,
          })
          expect(planTools["list_mcp_resources"]).toBeDefined()
          expect(planTools["list_mcp_resource_templates"]).toBeDefined()
          expect(planTools["read_mcp_resource"]).toBeDefined()

        },
      })
    } finally {
      await Instance.disposeAll()
      if (projectID) {
        db.deleteMany("project_configs", [{ column: "projectID", value: projectID }])
        db.deleteMany("projects", [{ column: "id", value: projectID }])
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  test("Mcp manager should diagnose MCP tool discovery failures and successes", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-diagnose-"))
    let projectID: string | undefined

    try {
      await createGitRepo(root, "mcp-diagnose")
      const script = await writeLegacyMockMcpServer(root)
      const { project } = await Project.fromDirectory(root)
      projectID = project.id

      await Config.setMcpServer(project.id, "mock", {
        name: "Mock",
        command: process.execPath,
        args: [script],
        enabled: true,
      })

      await Instance.provide({
        directory: root,
        fn: async () => {
          const diagnostic = await Mcp.diagnose("mock")

          expect(diagnostic).toMatchObject({
            serverID: "mock",
            enabled: true,
            ok: true,
            toolCount: 1,
            toolNames: ["echo"],
          })
          expect(diagnostic.tools).toEqual([
            expect.objectContaining({
              name: "echo",
              title: "Echo",
              displayName: "Mock/Echo",
              description: "Echo back the provided value",
              annotations: {
                readOnlyHint: true,
              },
              riskHint: "read-only",
              recommendedPolicy: "auto",
            }),
          ])
          expect(diagnostic.tools[0]?.inputSchema).toMatchObject({
            type: "object",
          })
        },
      })
    } finally {
      await Instance.disposeAll()
      if (projectID) {
        db.deleteMany("project_configs", [{ column: "projectID", value: projectID }])
        db.deleteMany("projects", [{ column: "id", value: projectID }])
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  test("Mcp diagnoseServer should diagnose global stdio servers without a project context", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-global-diagnose-"))

    try {
      const script = await writeLegacyMockMcpServer(root)
      const diagnostic = await Mcp.diagnoseServer({
        id: "mock-global",
        name: "Mock Global",
        transport: "stdio",
        command: process.execPath,
        args: [script],
        cwd: root,
        enabled: true,
      })

      expect(diagnostic).toMatchObject({
        serverID: "mock-global",
        enabled: true,
        ok: true,
        toolCount: 1,
        toolNames: ["echo"],
      })
      expect(diagnostic.tools).toEqual([
        expect.objectContaining({
          name: "echo",
          title: "Echo",
          displayName: "Mock Global/Echo",
          riskHint: "read-only",
          recommendedPolicy: "auto",
        }),
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("Mcp manager should expose modern JSON results and referenced schemas", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-remote-manager-"))
    const remote = await startMockHttpMcpServer()
    let projectID: string | undefined

    try {
      await createGitRepo(root, "mcp-remote-manager")
      const { project } = await Project.fromDirectory(root)
      projectID = project.id

      await Config.setMcpServer(project.id, "remote", {
        name: "Remote",
        transport: "remote",
        serverUrl: remote.url,
        authorization: "remote-token",
        headers: {
          "x-api-key": "secret",
        },
        allowedTools: {
          readOnly: true,
        },
        toolPolicies: {
          echo: {
            policy: "auto",
          },
          write: {
            policy: "auto",
          },
        },
        enabled: true,
      })

      await Instance.provide({
        directory: root,
        fn: async () => {
          const tools = await Mcp.tools()
          const arrayResult = tools.find((item) => item.id === "mcp__remote__array_result")
          const booleanResult = tools.find((item) => item.id === "mcp__remote__boolean_result")
          const referenceEcho = tools.find((item) => item.id === "mcp__remote__reference_echo")

          expect(tools.find((item) => item.id === "mcp__remote__echo")).toBeDefined()
          expect(tools.find((item) => item.id === "mcp__remote__write")).toBeUndefined()
          expect(arrayResult).toBeDefined()
          expect(booleanResult).toBeDefined()
          expect(referenceEcho).toBeDefined()

          const context = {
            sessionID: "session_modern_mcp",
            messageID: "message_modern_mcp",
          }
          const arrayRuntime = await arrayResult!.init()
          const arrayOutput = Tool.normalizeToolOutput(await arrayRuntime.execute({}, context))
          expect(arrayOutput.metadata).toMatchObject({
            serverID: "remote",
            toolName: "array_result",
            mcpIsError: false,
            mcpStructuredContent: ["alpha", "beta"],
          })
          expect(await arrayRuntime.toModelOutput?.(arrayOutput)).toEqual({
            type: "json",
            value: ["alpha", "beta"],
          })

          const booleanRuntime = await booleanResult!.init()
          const booleanOutput = Tool.normalizeToolOutput(await booleanRuntime.execute({}, context))
          expect(booleanOutput.metadata).toMatchObject({
            serverID: "remote",
            toolName: "boolean_result",
            mcpIsError: false,
            mcpStructuredContent: false,
          })
          expect(await booleanRuntime.toModelOutput?.(booleanOutput)).toEqual({
            type: "json",
            value: false,
          })

          const referenceRuntime = await referenceEcho!.init()
          expect(referenceRuntime.parameters.safeParse({ value: "schema-value" }).success).toBe(true)
          expect(referenceRuntime.parameters.safeParse({ value: 42 }).success).toBe(false)
        },
      })
    } finally {
      await Instance.disposeAll()
      await remote.close()
      if (projectID) {
        db.deleteMany("project_configs", [{ column: "projectID", value: projectID }])
        db.deleteMany("projects", [{ column: "id", value: projectID }])
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  test("Mcp manager should filter disabled stdio tools with tool policies", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-stdio-policy-"))
    let projectID: string | undefined

    try {
      await createGitRepo(root, "mcp-stdio-policy")
      const script = await writeLegacyMockMcpServer(root)
      const { project } = await Project.fromDirectory(root)
      projectID = project.id

      await Config.setMcpServer(project.id, "mock", {
        name: "Mock",
        command: process.execPath,
        args: [script],
        toolPolicies: {
          echo: {
            policy: "disabled",
          },
        },
        enabled: true,
      })

      await Instance.provide({
        directory: root,
        fn: async () => {
          const diagnostic = await Mcp.diagnose("mock")
          expect(diagnostic.toolNames).toEqual([])
          expect(diagnostic.tools.map((tool) => tool.name)).toEqual(["echo"])
          expect(diagnostic.tools[0]?.configuredPolicy).toBe("disabled")

          const tools = await Mcp.tools()
          expect(tools.find((item) => item.id === "mcp__mock__echo")).toBeUndefined()
        },
      })
    } finally {
      await Instance.disposeAll()
      if (projectID) {
        db.deleteMany("project_configs", [{ column: "projectID", value: projectID }])
        db.deleteMany("projects", [{ column: "id", value: projectID }])
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  test("Mcp manager should use tool policies for MCP permission intents", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-policy-permission-"))
    const remote = await startMockHttpMcpServer()
    let projectID: string | undefined

    try {
      await createGitRepo(root, "mcp-policy-permission")
      const { project } = await Project.fromDirectory(root)
      projectID = project.id

      await Config.setMcpServer(project.id, "remote", {
        name: "Remote",
        transport: "remote",
        serverUrl: remote.url,
        toolPolicies: {
          echo: {
            policy: "ask",
          },
          write: {
            policy: "auto",
          },
        },
        enabled: true,
      })

      await Instance.provide({
        directory: root,
        fn: async () => {
          const tools = await Mcp.tools()
          const echo = tools.find((item) => item.id === "mcp__remote__echo")
          const write = tools.find((item) => item.id === "mcp__remote__write")

          expect(echo).toBeDefined()
          expect(write).toBeDefined()

          const context = {
            sessionID: "session_test",
            messageID: "message_test",
          }
          const echoRuntime = await echo!.init()
          const writeRuntime = await write!.init()

          expect(echoRuntime.assessPermission).toBeDefined()
          expect(writeRuntime.assessPermission).toBeDefined()
          await expect(echoRuntime.assessPermission!({ value: "hello" }, context)).resolves.toMatchObject({
            action: "ask",
            forceAsk: true,
            risk: "low",
          })
          await expect(writeRuntime.assessPermission!({ value: "hello" }, context)).resolves.toMatchObject({
            action: "allow",
            risk: "medium",
          })
        },
      })
    } finally {
      await Instance.disposeAll()
      await remote.close()
      if (projectID) {
        db.deleteMany("project_configs", [{ column: "projectID", value: projectID }])
        db.deleteMany("projects", [{ column: "id", value: projectID }])
      }
      await rm(root, { recursive: true, force: true })
    }
  })
})
