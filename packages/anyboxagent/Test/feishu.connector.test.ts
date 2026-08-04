import { describe, expect, test } from "bun:test"
import { once } from "node:events"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { dirname, join } from "node:path"
import { McpClient } from "#mcp/client.ts"

function structuredContentRecord(result: Awaited<ReturnType<McpClient["callTool"]>>) {
  const content = result.structuredContent
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("Expected object structured content from the Feishu MCP server.")
  }
  return content
}

const FEISHU_CONNECTOR_TOOLS = [
  "feishu_profile",
  "feishu_search_files",
  "feishu_get_file_metadata",
  "feishu_read_docx_raw",
  "feishu_list_docx_blocks",
  "feishu_list_wiki_spaces",
  "feishu_get_wiki_node",
  "feishu_list_wiki_nodes",
  "feishu_read_sheet_values",
  "feishu_list_bitable_records",
]

const FULL_FEISHU_SCOPES = [
  "auth:user.id:read",
  "drive:drive.search:readonly",
  "drive:drive.metadata:readonly",
  "drive:drive:readonly",
  "drive:file:readonly",
  "docx:document:readonly",
  "wiki:wiki:readonly",
  "sheets:spreadsheet:readonly",
  "bitable:app:readonly",
].join(" ")

interface SeenFeishuRequest {
  method: string
  pathname: string
  searchParams: Record<string, string>
  body?: unknown
  authorization?: string
}

async function readJSONBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString("utf8").trim()
  return text ? JSON.parse(text) : undefined
}

function writeJSON(res: ServerResponse, payload: unknown) {
  res.writeHead(200, { "content-type": "application/json" })
  res.end(JSON.stringify(payload))
}

async function startMockFeishuAPI() {
  const requests: SeenFeishuRequest[] = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1")
    const pathname = decodeURIComponent(url.pathname)
    const body = req.method === "GET" ? undefined : await readJSONBody(req)
    requests.push({
      method: req.method || "GET",
      pathname,
      searchParams: Object.fromEntries(url.searchParams.entries()),
      body,
      authorization: req.headers.authorization,
    })

    if (pathname === "/open-apis/drive/v1/metas/batch_query") {
      const metadataBody = body && typeof body === "object"
        ? body as { request_docs?: Array<{ doc_token?: string; doc_type?: string }> }
        : undefined
      writeJSON(res, {
        code: 0,
        data: {
          metas: [
            {
              doc_token: metadataBody?.request_docs?.[0]?.doc_token,
              doc_type: metadataBody?.request_docs?.[0]?.doc_type,
              title: "Planning Doc",
            },
          ],
        },
      })
      return
    }

    if (pathname === "/open-apis/docx/v1/documents/doxcn123/blocks") {
      writeJSON(res, {
        code: 0,
        data: {
          items: [{ block_id: "blk1", block_type: 2 }],
          has_more: false,
        },
      })
      return
    }

    if (pathname === "/open-apis/wiki/v2/spaces") {
      writeJSON(res, {
        code: 0,
        data: {
          items: [{ space_id: "spc1", name: "Team Wiki" }],
          has_more: false,
        },
      })
      return
    }

    if (pathname === "/open-apis/wiki/v2/spaces/get_node") {
      writeJSON(res, {
        code: 0,
        data: {
          node: {
            node_token: url.searchParams.get("token"),
            title: "Roadmap",
            obj_token: "doxcn123",
            obj_type: "docx",
          },
        },
      })
      return
    }

    if (pathname === "/open-apis/wiki/v2/spaces/spc1/nodes") {
      writeJSON(res, {
        code: 0,
        data: {
          items: [{ node_token: "wikcn1", title: "Overview" }],
          has_more: false,
        },
      })
      return
    }

    if (pathname === "/open-apis/sheets/v2/spreadsheets/shtcn123/values/Sheet1!A1:B2") {
      writeJSON(res, {
        code: 0,
        data: {
          valueRange: {
            range: "Sheet1!A1:B2",
            values: [["Name", "Status"], ["Launch", "Green"]],
          },
        },
      })
      return
    }

    if (pathname === "/open-apis/bitable/v1/apps/bascn123/tables/tbl123/records") {
      writeJSON(res, {
        code: 0,
        data: {
          items: [{ record_id: "rec1", fields: { Name: "Launch" } }],
          has_more: false,
        },
      })
      return
    }

    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ code: 404, msg: `Unhandled path: ${pathname}` }))
  })

  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind mock Feishu API.")
  }

  return {
    baseURL: `http://127.0.0.1:${address.port}/open-apis`,
    requests,
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

function createFeishuClient(input: { baseURL?: string; scopes?: string }) {
  const serverPath = join(import.meta.dir, "..", "plugins", "builtin", "feishu", "0.1.0", "connectors", "feishu", "server.js")
  const cwd = dirname(serverPath)
  return new McpClient({
    cwd,
    worktree: cwd,
    requestTimeoutMs: 2000,
    server: {
      id: "connector.feishu.default",
      name: "Feishu",
      transport: "stdio",
      command: process.execPath,
      args: [serverPath],
      env: {
        FEISHU_API_BASE: input.baseURL || "http://127.0.0.1/unused",
        FEISHU_ACCESS_TOKEN: "test-access-token",
        FEISHU_TOKEN_TYPE: "Bearer",
        FEISHU_GRANTED_SCOPES: input.scopes ?? FULL_FEISHU_SCOPES,
      },
      enabled: true,
    },
  })
}

describe("Feishu connector MCP server", () => {
  test("lists the registry-backed Feishu tools", async () => {
    const client = createFeishuClient({})

    try {
      const tools = await client.listTools()
      expect(tools.map((tool) => tool.name)).toEqual(FEISHU_CONNECTOR_TOOLS)
      expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true)
    } finally {
      await client.dispose()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })

  test("filters tools when granted OAuth scopes are known", async () => {
    const client = createFeishuClient({ scopes: "docx:document:readonly" })

    try {
      const tools = await client.listTools()
      expect(tools.map((tool) => tool.name)).toEqual([
        "feishu_read_docx_raw",
        "feishu_list_docx_blocks",
      ])
    } finally {
      await client.dispose()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })

  test("calls representative Feishu read tools through the registry", async () => {
    const api = await startMockFeishuAPI()
    const client = createFeishuClient({ baseURL: api.baseURL })

    try {
      const metadata = await client.callTool("feishu_get_file_metadata", {
        file_token: "https://example.feishu.cn/docx/doxcn123",
        file_type: "docx",
      })
      expect(structuredContentRecord(metadata).metas).toEqual([
        { doc_token: "doxcn123", doc_type: "docx", title: "Planning Doc" },
      ])

      const blocks = await client.callTool("feishu_list_docx_blocks", {
        document_id: "doxcn123",
        page_size: 10,
      })
      expect(structuredContentRecord(blocks).blocks).toEqual([{ block_id: "blk1", block_type: 2 }])

      const spaces = await client.callTool("feishu_list_wiki_spaces", {})
      expect(structuredContentRecord(spaces).spaces).toEqual([{ space_id: "spc1", name: "Team Wiki" }])

      const node = await client.callTool("feishu_get_wiki_node", {
        node_token: "https://example.feishu.cn/wiki/wikcn1",
      })
      expect(structuredContentRecord(node).node).toMatchObject({ node_token: "wikcn1", title: "Roadmap" })

      const nodes = await client.callTool("feishu_list_wiki_nodes", {
        space_id: "spc1",
        parent_node_token: "wikcn1",
      })
      expect(structuredContentRecord(nodes).nodes).toEqual([{ node_token: "wikcn1", title: "Overview" }])

      const sheet = await client.callTool("feishu_read_sheet_values", {
        spreadsheet_token: "https://example.feishu.cn/sheets/shtcn123",
        range: "Sheet1!A1:B2",
      })
      expect(structuredContentRecord(sheet).valueRange).toMatchObject({
        range: "Sheet1!A1:B2",
        values: [["Name", "Status"], ["Launch", "Green"]],
      })

      const records = await client.callTool("feishu_list_bitable_records", {
        app_token: "https://example.feishu.cn/base/bascn123",
        table_id: "tbl123",
        page_size: 5,
      })
      expect(structuredContentRecord(records).records).toEqual([{ record_id: "rec1", fields: { Name: "Launch" } }])

      expect(api.requests.every((request) => request.authorization === "Bearer test-access-token")).toBe(true)
      expect(api.requests.map((request) => request.pathname)).toEqual([
        "/open-apis/drive/v1/metas/batch_query",
        "/open-apis/docx/v1/documents/doxcn123/blocks",
        "/open-apis/wiki/v2/spaces",
        "/open-apis/wiki/v2/spaces/get_node",
        "/open-apis/wiki/v2/spaces/spc1/nodes",
        "/open-apis/sheets/v2/spreadsheets/shtcn123/values/Sheet1!A1:B2",
        "/open-apis/bitable/v1/apps/bascn123/tables/tbl123/records",
      ])
      expect(api.requests[0]?.body).toEqual({
        request_docs: [{ doc_token: "doxcn123", doc_type: "docx" }],
        with_url: true,
      })
      expect(api.requests.at(-1)?.searchParams).toMatchObject({ page_size: "5" })
    } finally {
      await client.dispose()
      await api.close()
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  })
})
