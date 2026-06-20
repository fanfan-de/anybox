#!/usr/bin/env node

"use strict"

const readline = require("node:readline")

const DEFAULT_BASE_URL = "https://open.feishu.cn"
const APP_ID = (process.env.FEISHU_APP_ID || "").trim()
const APP_SECRET = (process.env.FEISHU_APP_SECRET || "").trim()
const BASE_URL = normalizeBaseUrl(process.env.FEISHU_BASE_URL || DEFAULT_BASE_URL)

let cachedTenantToken = null

const tools = [
  {
    name: "feishu_test_auth",
    title: "Test Feishu Auth",
    description: "Validate Feishu app credentials by fetching a tenant access token.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "feishu_lookup_user_ids",
    title: "Lookup Feishu Users",
    description: "Resolve Feishu user IDs from email addresses or mobile numbers.",
    inputSchema: {
      type: "object",
      properties: {
        emails: {
          type: "array",
          items: { type: "string" },
          description: "Email addresses to resolve."
        },
        mobiles: {
          type: "array",
          items: { type: "string" },
          description: "Mobile numbers to resolve."
        },
        user_id_type: {
          type: "string",
          enum: ["open_id", "user_id", "union_id"],
          description: "User ID type to return. Defaults to open_id."
        },
        include_resigned: {
          type: "boolean",
          description: "Whether to include resigned users."
        }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "feishu_list_chats",
    title: "List Feishu Chats",
    description: "List chats visible to the Feishu app.",
    inputSchema: {
      type: "object",
      properties: {
        page_size: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Number of chats to return. Defaults to 20."
        },
        page_token: {
          type: "string",
          description: "Pagination token returned by a previous call."
        },
        user_id_type: {
          type: "string",
          enum: ["open_id", "user_id", "union_id"],
          description: "User ID type in chat member fields. Defaults to open_id."
        }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "feishu_get_chat",
    title: "Get Feishu Chat",
    description: "Read details for one Feishu chat.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: {
          type: "string",
          description: "Feishu chat ID."
        },
        user_id_type: {
          type: "string",
          enum: ["open_id", "user_id", "union_id"],
          description: "User ID type in chat member fields. Defaults to open_id."
        }
      },
      required: ["chat_id"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "feishu_list_messages",
    title: "List Feishu Messages",
    description: "Read recent messages from a Feishu chat.",
    inputSchema: {
      type: "object",
      properties: {
        container_id: {
          type: "string",
          description: "Container ID, usually a chat_id."
        },
        container_id_type: {
          type: "string",
          enum: ["chat", "thread"],
          description: "Container type. Defaults to chat."
        },
        page_size: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Number of messages to return. Defaults to 20."
        },
        page_token: {
          type: "string",
          description: "Pagination token returned by a previous call."
        },
        start_time: {
          type: "string",
          description: "Optional Unix timestamp in seconds."
        },
        end_time: {
          type: "string",
          description: "Optional Unix timestamp in seconds."
        },
        sort_type: {
          type: "string",
          enum: ["ByCreateTimeAsc", "ByCreateTimeDesc"],
          description: "Message sort order."
        }
      },
      required: ["container_id"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "feishu_send_text",
    title: "Send Feishu Text",
    description: "Send a text message through the Feishu bot.",
    inputSchema: {
      type: "object",
      properties: {
        receive_id: {
          type: "string",
          description: "Target ID such as open_id, user_id, union_id, email, or chat_id."
        },
        receive_id_type: {
          type: "string",
          enum: ["open_id", "user_id", "union_id", "email", "chat_id"],
          description: "Type of receive_id. Defaults to open_id."
        },
        text: {
          type: "string",
          description: "Plain text to send."
        },
        uuid: {
          type: "string",
          description: "Optional idempotency UUID."
        }
      },
      required: ["receive_id", "text"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    }
  },
  {
    name: "feishu_send_message",
    title: "Send Feishu Message",
    description: "Send a Feishu bot message with a supported message type and content object.",
    inputSchema: {
      type: "object",
      properties: {
        receive_id: {
          type: "string",
          description: "Target ID such as open_id, user_id, union_id, email, or chat_id."
        },
        receive_id_type: {
          type: "string",
          enum: ["open_id", "user_id", "union_id", "email", "chat_id"],
          description: "Type of receive_id. Defaults to open_id."
        },
        msg_type: {
          type: "string",
          enum: ["text", "post", "image", "interactive", "share_chat"],
          description: "Feishu message type."
        },
        content: {
          description: "Message content object, or a JSON string accepted by Feishu."
        },
        uuid: {
          type: "string",
          description: "Optional idempotency UUID."
        }
      },
      required: ["receive_id", "msg_type", "content"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    }
  }
]

function normalizeBaseUrl(value) {
  const trimmed = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "")
  return trimmed || DEFAULT_BASE_URL
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function textResult(text, structuredContent) {
  return {
    content: [{ type: "text", text }],
    structuredContent: structuredContent ?? { text },
    isError: false
  }
}

function jsonResult(value) {
  return textResult(JSON.stringify(value, null, 2), value)
}

function errorResult(error) {
  const text = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: "text", text }],
    structuredContent: { error: text },
    isError: true
  }
}

function requireEnv() {
  if (!APP_ID) throw new Error("FEISHU_APP_ID is not configured.")
  if (!APP_SECRET) throw new Error("FEISHU_APP_SECRET is not configured.")
}

async function parseResponse(response) {
  const text = await response.text()
  if (!text) return {}

  try {
    return JSON.parse(text)
  } catch {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text}`)
    }
    return { raw: text }
  }
}

function assertFeishuSuccess(payload, context) {
  if (payload && typeof payload.code === "number" && payload.code !== 0) {
    const message = payload.msg || payload.message || "Feishu API returned an error."
    throw new Error(`${context} failed: ${message} (code ${payload.code})`)
  }
}

async function getTenantAccessToken() {
  requireEnv()

  const now = Date.now()
  if (cachedTenantToken && cachedTenantToken.expiresAt > now + 60000) {
    return cachedTenantToken.token
  }

  const response = await fetch(`${BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: APP_ID,
      app_secret: APP_SECRET
    })
  })
  const payload = await parseResponse(response)
  if (!response.ok) throw new Error(`Fetch tenant_access_token failed: HTTP ${response.status}`)
  assertFeishuSuccess(payload, "Fetch tenant_access_token")

  const token = payload.tenant_access_token || payload.data?.tenant_access_token
  if (!token) throw new Error("Feishu did not return tenant_access_token.")

  const expireSeconds = Number(payload.expire || payload.data?.expire || 7200)
  cachedTenantToken = {
    token,
    expiresAt: now + Math.max(60, expireSeconds - 60) * 1000
  }
  return token
}

async function feishuRequest(method, path, options = {}) {
  const token = await getTenantAccessToken()
  const url = new URL(`${BASE_URL}${path}`)

  for (const [key, value] of Object.entries(options.query || {})) {
    if (value === undefined || value === null || value === "") continue
    url.searchParams.set(key, String(value))
  }

  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json; charset=utf-8"
  }
  const response = await fetch(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  const payload = await parseResponse(response)
  if (!response.ok) throw new Error(`${method} ${path} failed: HTTP ${response.status}`)
  assertFeishuSuccess(payload, `${method} ${path}`)
  return payload
}

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

function requireString(args, key) {
  const value = args?.[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} is required.`)
  }
  return value.trim()
}

function optionalString(args, key) {
  const value = args?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function optionalBoolean(args, key) {
  const value = args?.[key]
  return typeof value === "boolean" ? value : undefined
}

function optionalInteger(args, key, fallback, min, max) {
  const value = args?.[key]
  if (value === undefined || value === null || value === "") return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${key} must be an integer from ${min} to ${max}.`)
  }
  return number
}

function optionalStringArray(args, key) {
  const value = args?.[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${key} must be an array of non-empty strings.`)
  }
  return value.map((item) => item.trim())
}

function enumValue(args, key, allowed, fallback) {
  const value = optionalString(args, key) || fallback
  if (!allowed.includes(value)) {
    throw new Error(`${key} must be one of: ${allowed.join(", ")}.`)
  }
  return value
}

function messageContentFor(args) {
  const content = args?.content
  if (typeof content === "string") {
    const trimmed = content.trim()
    if (!trimmed) throw new Error("content is required.")
    return trimmed
  }
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return JSON.stringify(content)
  }
  throw new Error("content must be an object or JSON string.")
}

async function callTool(name, rawArgs) {
  const args = asObject(rawArgs || {}, "arguments")

  if (name === "feishu_test_auth") {
    const token = await getTenantAccessToken()
    return jsonResult({
      ok: true,
      base_url: BASE_URL,
      app_id: APP_ID,
      token_expires_at: cachedTenantToken?.expiresAt,
      token_preview: `${token.slice(0, 8)}...`
    })
  }

  if (name === "feishu_lookup_user_ids") {
    const emails = optionalStringArray(args, "emails")
    const mobiles = optionalStringArray(args, "mobiles")
    if ((!emails || emails.length === 0) && (!mobiles || mobiles.length === 0)) {
      throw new Error("Provide at least one email or mobile number.")
    }

    const payload = await feishuRequest("POST", "/open-apis/contact/v3/users/batch_get_id", {
      query: {
        user_id_type: enumValue(args, "user_id_type", ["open_id", "user_id", "union_id"], "open_id")
      },
      body: {
        emails,
        mobiles,
        include_resigned: optionalBoolean(args, "include_resigned")
      }
    })
    return jsonResult(payload)
  }

  if (name === "feishu_list_chats") {
    const payload = await feishuRequest("GET", "/open-apis/im/v1/chats", {
      query: {
        page_size: optionalInteger(args, "page_size", 20, 1, 100),
        page_token: optionalString(args, "page_token"),
        user_id_type: enumValue(args, "user_id_type", ["open_id", "user_id", "union_id"], "open_id")
      }
    })
    return jsonResult(payload)
  }

  if (name === "feishu_get_chat") {
    const chatID = encodeURIComponent(requireString(args, "chat_id"))
    const payload = await feishuRequest("GET", `/open-apis/im/v1/chats/${chatID}`, {
      query: {
        user_id_type: enumValue(args, "user_id_type", ["open_id", "user_id", "union_id"], "open_id")
      }
    })
    return jsonResult(payload)
  }

  if (name === "feishu_list_messages") {
    const payload = await feishuRequest("GET", "/open-apis/im/v1/messages", {
      query: {
        container_id_type: enumValue(args, "container_id_type", ["chat", "thread"], "chat"),
        container_id: requireString(args, "container_id"),
        page_size: optionalInteger(args, "page_size", 20, 1, 50),
        page_token: optionalString(args, "page_token"),
        start_time: optionalString(args, "start_time"),
        end_time: optionalString(args, "end_time"),
        sort_type: enumValue(args, "sort_type", ["ByCreateTimeAsc", "ByCreateTimeDesc"], "ByCreateTimeDesc")
      }
    })
    return jsonResult(payload)
  }

  if (name === "feishu_send_text") {
    const receiveIDType = enumValue(args, "receive_id_type", ["open_id", "user_id", "union_id", "email", "chat_id"], "open_id")
    const body = {
      receive_id: requireString(args, "receive_id"),
      msg_type: "text",
      content: JSON.stringify({ text: requireString(args, "text") })
    }
    const uuid = optionalString(args, "uuid")
    if (uuid) body.uuid = uuid

    const payload = await feishuRequest("POST", "/open-apis/im/v1/messages", {
      query: { receive_id_type: receiveIDType },
      body
    })
    return jsonResult(payload)
  }

  if (name === "feishu_send_message") {
    const receiveIDType = enumValue(args, "receive_id_type", ["open_id", "user_id", "union_id", "email", "chat_id"], "open_id")
    const msgType = enumValue(args, "msg_type", ["text", "post", "image", "interactive", "share_chat"])
    const body = {
      receive_id: requireString(args, "receive_id"),
      msg_type: msgType,
      content: messageContentFor(args)
    }
    const uuid = optionalString(args, "uuid")
    if (uuid) body.uuid = uuid

    const payload = await feishuRequest("POST", "/open-apis/im/v1/messages", {
      query: { receive_id_type: receiveIDType },
      body
    })
    return jsonResult(payload)
  }

  throw new Error(`Unknown tool: ${name}`)
}

const rl = readline.createInterface({ input: process.stdin })

rl.on("line", (line) => {
  void (async () => {
    const normalizedLine = line.replace(/^\uFEFF/, "")
    if (!normalizedLine.trim()) return
    const message = JSON.parse(normalizedLine)

    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "feishu", version: "0.1.0" }
        }
      })
      return
    }

    if (String(message.method || "").startsWith("notifications/")) return

    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools } })
      return
    }

    if (message.method === "tools/call") {
      try {
        const result = await callTool(message.params?.name, message.params?.arguments)
        send({ jsonrpc: "2.0", id: message.id, result })
      } catch (error) {
        send({ jsonrpc: "2.0", id: message.id, result: errorResult(error) })
      }
      return
    }

    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Unknown method: ${message.method}` }
    })
  })().catch((error) => {
    send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error)
      }
    })
  })
})
