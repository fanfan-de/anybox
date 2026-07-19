import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { $ } from "bun"
import { once } from "node:events"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import z from "zod"
import * as Config from "#config/config.ts"
import { McpClient, type McpToolRequestContext } from "#mcp/client.ts"
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

async function writeMockMcpServer(root: string) {
  const script = join(root, "mock-mcp-server.js")
  await writeFile(
    script,
    [
      "const readline = require('node:readline')",
      "const rl = readline.createInterface({ input: process.stdin })",
      "function send(payload) { process.stdout.write(JSON.stringify(payload) + '\\n') }",
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
      "    const value = message.params?.arguments?.value ?? ''",
      "    const envKeys = new Set(Object.keys(process.env).map((key) => key.toUpperCase()))",
      "    const envProbe = value === '__browser_env__' ? {",
      "      browserTrustedToken: envKeys.has('ANYBOX_BROWSER_TRUSTED_TOKEN') ? 'present' : 'absent',",
      "      browserTransportToken: envKeys.has('ANYBOX_BROWSER_TRANSPORT_TOKEN') ? 'present' : 'absent',",
      "      browserIpcEndpoint: envKeys.has('ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT') ? 'present' : 'absent',",
      "      browserIpcProof: envKeys.has('ANYBOX_BROWSER_IPC_RUNTIME_PROOF') ? 'present' : 'absent',",
      "      requestMeta: message.params?._meta,",
      "    } : {}",
      "    send({",
      "      jsonrpc: '2.0',",
      "      id: message.id,",
      "      result: {",
      "        content: [{ type: 'text', text: `echo:${value}` }],",
      "        structuredContent: {",
      "          echoed: value,",
      "          ...envProbe,",
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
  const seenHeaders: Array<Record<string, string | string[] | undefined>> = []
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/mcp") {
      res.writeHead(405).end()
      return
    }

    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    const bodyText = Buffer.concat(chunks).toString("utf8")
    const body = bodyText ? JSON.parse(bodyText) : undefined

    seenHeaders.push({
      authorization: req.headers.authorization,
      "x-api-key": req.headers["x-api-key"],
    })

    const mcp = new McpServer({
      name: "mock-http",
      version: "1.0.0",
    })
    mcp.registerTool(
      "echo",
      {
        title: "Echo",
        description: "Echo back the provided value",
        inputSchema: {
          value: z.string(),
        },
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
        inputSchema: {
          value: z.string(),
        },
      },
      async ({ value }) => ({
        content: [{ type: "text", text: `write:${value}` }],
        structuredContent: { written: value },
        isError: false,
      }),
    )

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })

    try {
      await mcp.connect(transport)
      await transport.handleRequest(req, res, body)
    } finally {
      res.on("close", () => {
        void transport.close()
        void mcp.close()
      })
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
    seenHeaders,
    async close() {
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
      const script = await writeMockMcpServer(root)
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
        const tools = await client.listTools()
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
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("strips Browser IPC secrets from every MCP process", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-browser-env-"))
    const originalTrustedToken = process.env.ANYBOX_BROWSER_TRUSTED_TOKEN
    const originalTransportToken = process.env.ANYBOX_BROWSER_TRANSPORT_TOKEN
    process.env.ANYBOX_BROWSER_TRUSTED_TOKEN = "must-not-leak-to-generic-mcp"
    process.env.ANYBOX_BROWSER_TRANSPORT_TOKEN = "must-not-leak-to-generic-mcp"

    try {
      const script = await writeMockMcpServer(root)
      const createClient = (owner?: Config.McpServerOwner) => new McpClient({
        cwd: root,
        worktree: root,
        requestTimeoutMs: 1000,
        server: {
          id: owner ? "plugin.chrome.node-repl" : "generic",
          name: owner ? "Chrome" : "Generic",
          transport: "stdio",
          command: process.execPath,
          args: [script],
          env: owner
            ? undefined
            : {
                anybox_browser_trusted_token: "generic-override-must-be-removed",
                AnYbOx_BrOwSeR_TrAnSpOrT_ToKeN: "generic-override-must-be-removed",
              },
          enabled: true,
          owner,
        },
      })

      const generic = createClient()
      try {
        const result = await generic.callTool("echo", { value: "__browser_env__" })
        expect(result.structuredContent).toMatchObject({
          browserTrustedToken: "absent",
          browserTransportToken: "absent",
          browserIpcEndpoint: "absent",
          browserIpcProof: "absent",
        })
      } finally {
        await generic.dispose()
      }

      const formerChromeRuntime = createClient({
        kind: "plugin",
        pluginID: "chrome",
        bindingID: "mcp:node-repl",
      })
      try {
        const result = await formerChromeRuntime.callTool(
          "echo",
          { value: "__browser_env__" },
          undefined,
          {
            sessionID: "session-browser",
            messageID: "message-browser",
            toolCallID: "tool-browser",
            unexpected: "must-not-forward",
          } as McpToolRequestContext & { unexpected: string },
        )
        expect(result.structuredContent).toMatchObject({
          browserTrustedToken: "absent",
          browserTransportToken: "absent",
          browserIpcEndpoint: "absent",
          browserIpcProof: "absent",
        })
        expect(result.structuredContent?.requestMeta).toBeUndefined()
      } finally {
        await formerChromeRuntime.dispose()
      }
    } finally {
      if (originalTrustedToken === undefined) delete process.env.ANYBOX_BROWSER_TRUSTED_TOKEN
      else process.env.ANYBOX_BROWSER_TRUSTED_TOKEN = originalTrustedToken
      if (originalTransportToken === undefined) delete process.env.ANYBOX_BROWSER_TRANSPORT_TOKEN
      else process.env.ANYBOX_BROWSER_TRANSPORT_TOKEN = originalTransportToken
      await rm(root, { recursive: true, force: true })
    }
  })

  test("McpClient should list resource metadata and read resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-client-resources-"))

    try {
      const script = await writeMockMcpServer(root)
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

  test("McpClient should list and call remote HTTP tools", async () => {
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
        expect(tools.map((tool) => tool.name)).toEqual(["echo", "write"])

        const result = await client.callTool("echo", { value: "hello" })
        expect(result).toMatchObject({
          structuredContent: {
            echoed: "hello",
          },
          isError: false,
        })
      } finally {
        await client.dispose()
      }

      expect(remote.seenHeaders).not.toHaveLength(0)
      expect(remote.seenHeaders[0]?.authorization).toBe("Bearer remote-token")
      expect(remote.seenHeaders[0]?.["x-api-key"]).toBe("secret")
    } finally {
      await remote.close()
    }
  })

  test("Mcp manager should expose MCP tools through the registry shape", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-manager-"))
    let projectID: string | undefined

    try {
      await createGitRepo(root, "mcp-manager")
      const script = await writeMockMcpServer(root)
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

  test("Mcp manager should expose project-scoped resources and read selected resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-mcp-manager-resources-"))
    let projectID: string | undefined

    try {
      await createGitRepo(root, "mcp-manager-resources")
      const script = await writeMockMcpServer(root)
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
      const script = await writeMockMcpServer(root)
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
          const sidechat = await Agent.get("sidechat")
          if (!plan || !sidechat) {
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

          const sidechatTools = await ResolveTools.resolveTools({
            agent: sidechat,
            sessionID: "session_mcp_resource_tools_sidechat",
            messageID: "message_mcp_resource_tools_sidechat",
            abort: new AbortController().signal,
          })
          expect(sidechatTools["list_mcp_resources"]).toBeDefined()
          expect(sidechatTools["list_mcp_resource_templates"]).toBeDefined()
          expect(sidechatTools["read_mcp_resource"]).toBeDefined()
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
      const script = await writeMockMcpServer(root)
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
      const script = await writeMockMcpServer(root)
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

  test("Mcp manager should expose filtered remote HTTP tools through the registry shape", async () => {
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

          expect(tools.find((item) => item.id === "mcp__remote__echo")).toBeDefined()
          expect(tools.find((item) => item.id === "mcp__remote__write")).toBeUndefined()
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
      const script = await writeMockMcpServer(root)
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
