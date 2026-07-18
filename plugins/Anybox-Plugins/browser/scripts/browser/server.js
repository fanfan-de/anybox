#!/usr/bin/env node

const readline = require("node:readline")

const DEFAULT_AGENT_BASE_URL = defaultAgentBaseURL()
const AGENT_BASE_URL = normalizeBaseURL(
  process.env.ANYBOX_AGENT_BASE_URL || DEFAULT_AGENT_BASE_URL,
)

const tabId = {
  type: "number",
  description: "Chrome tab id. Defaults to the active tab, or to the current session owned tab when Anybox provides context.",
}

const tools = [
  {
    name: "browser_status",
    title: "Browser Status",
    description: "Check whether the Anybox browser extension is connected.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_get_tabs",
    title: "Get Browser Tabs",
    description: "List Chrome tabs visible to the Anybox browser extension.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "browser_open_tab",
    title: "Open Browser Tab",
    description: "Open a URL in Chrome.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to open in Chrome.",
        },
        active: {
          type: "boolean",
          description: "Whether to activate the new tab. Defaults to true.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "browser_activate_tab",
    title: "Activate Browser Tab",
    description: "Activate an existing Chrome tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Chrome tab id to activate.",
        },
      },
      required: ["tabId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "browser_snapshot",
    title: "Browser Snapshot",
    description: "Read page title, URL, visible text, links, buttons, and inputs.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        maxTextChars: {
          type: "number",
          description: "Maximum visible text characters to return.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "browser_interactive_snapshot",
    title: "Browser Interactive Snapshot",
    description: "List visible clickable and fillable page elements with stable element IDs.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        maxElements: {
          type: "number",
          description: "Maximum interactive elements to return.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "browser_dom_tree",
    title: "Browser DOM Tree",
    description: "Read a compact DOM tree for a Chrome page, including node types, names, attributes, text nodes, shadow roots, and content documents when available.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        maxDepth: {
          type: "number",
          description: "Maximum DOM depth to request. Defaults to 6.",
        },
        maxNodes: {
          type: "number",
          description: "Maximum DOM nodes to return. Defaults to 1000.",
        },
        pierce: {
          type: "boolean",
          description: "Whether to include shadow DOM and iframe content documents when Chrome exposes them. Defaults to true.",
        },
        includeText: {
          type: "boolean",
          description: "Whether to include text nodes. Defaults to true.",
        },
        includeAttributes: {
          type: "boolean",
          description: "Whether to include element attributes with sensitive values redacted. Defaults to true.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "browser_accessibility_tree",
    title: "Browser Accessibility Tree",
    description: "Read Chrome's accessibility tree for a page, including roles, names, values, properties, parent ids, and child ids.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        maxDepth: {
          type: "number",
          description: "Maximum accessibility tree depth to request. Defaults to 8.",
        },
        maxNodes: {
          type: "number",
          description: "Maximum accessibility nodes to return. Defaults to 1000.",
        },
        includeIgnored: {
          type: "boolean",
          description: "Whether to include Chrome accessibility nodes marked ignored. Defaults to false.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "browser_screenshot",
    title: "Browser Screenshot",
    description: "Capture a PNG screenshot of a Chrome tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        fullPage: {
          type: "boolean",
          description: "Capture beyond the current viewport when Chrome supports it.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "browser_click",
    title: "Browser Click",
    description: "Click viewport coordinates in a Chrome tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        x: {
          type: "number",
          description: "Viewport x coordinate.",
        },
        y: {
          type: "number",
          description: "Viewport y coordinate.",
        },
        button: {
          type: "string",
          enum: ["left", "right", "middle"],
          description: "Mouse button. Defaults to left.",
        },
      },
      required: ["x", "y"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "browser_click_element",
    title: "Browser Click Element",
    description: "Click an element returned by browser_interactive_snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        elementId: {
          type: "string",
          description: "Element id returned by browser_interactive_snapshot.",
        },
        elementName: {
          type: "string",
          description: "Optional human-readable element name from browser_interactive_snapshot.",
        },
        role: {
          type: "string",
          description: "Optional element role from browser_interactive_snapshot.",
        },
        button: {
          type: "string",
          enum: ["left", "right", "middle"],
          description: "Mouse button. Defaults to left.",
        },
      },
      required: ["elementId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "browser_fill",
    title: "Browser Fill",
    description: "Fill an input-like element returned by browser_interactive_snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        elementId: {
          type: "string",
          description: "Element id returned by browser_interactive_snapshot.",
        },
        text: {
          type: "string",
          description: "Text to place into the field. Empty string clears the field.",
        },
        elementName: {
          type: "string",
          description: "Optional human-readable element name from browser_interactive_snapshot.",
        },
        sensitive: {
          type: "boolean",
          description: "Whether the target field is sensitive, from browser_interactive_snapshot.",
        },
      },
      required: ["elementId", "text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "browser_type",
    title: "Browser Type",
    description: "Insert text into the focused element in a Chrome tab.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        text: {
          type: "string",
          description: "Text to insert into the focused element.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "browser_scroll",
    title: "Browser Scroll",
    description: "Scroll a Chrome tab by a viewport delta.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        scrollX: {
          type: "number",
          description: "Horizontal scroll delta in CSS pixels.",
        },
        scrollY: {
          type: "number",
          description: "Vertical scroll delta in CSS pixels.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "browser_wait_for",
    title: "Browser Wait For",
    description: "Wait until a Chrome page reaches a URL, text, selector, or element condition.",
    inputSchema: {
      type: "object",
      properties: {
        tabId,
        text: {
          type: "string",
          description: "Visible text to wait for.",
        },
        urlIncludes: {
          type: "string",
          description: "URL substring to wait for.",
        },
        selector: {
          type: "string",
          description: "CSS selector to wait for.",
        },
        elementId: {
          type: "string",
          description: "Element id returned by browser_interactive_snapshot to wait for.",
        },
        timeoutMs: {
          type: "number",
          description: "Maximum wait time in milliseconds.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "browser_release_tab",
    title: "Browser Release Tab",
    description: "Release a Chrome tab from session ownership without closing it.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Owned Chrome tab id to release.",
        },
      },
      required: ["tabId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
]

const commandByToolName = {
  browser_get_tabs: "tabs.list",
  browser_open_tab: "tabs.open",
  browser_activate_tab: "tabs.activate",
  browser_snapshot: "page.snapshot",
  browser_interactive_snapshot: "page.interactiveSnapshot",
  browser_dom_tree: "page.domTree",
  browser_accessibility_tree: "page.accessibilityTree",
  browser_screenshot: "page.screenshot",
  browser_click: "page.click",
  browser_click_element: "page.clickElement",
  browser_fill: "page.fill",
  browser_type: "page.type",
  browser_scroll: "page.scroll",
  browser_wait_for: "page.waitFor",
  browser_release_tab: "tabs.release",
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function defaultAgentBaseURL() {
  const host = String(process.env.ANYBOX_SERVER_HOST || "127.0.0.1").trim() || "127.0.0.1"
  const port = String(process.env.ANYBOX_SERVER_PORT || "4096").trim() || "4096"
  return `http://${host}:${port}`
}

function normalizeBaseURL(value) {
  const normalized = String(value || DEFAULT_AGENT_BASE_URL).trim().replace(/\/+$/, "")
  return normalized || DEFAULT_AGENT_BASE_URL
}

function jsonText(value) {
  return JSON.stringify(value, null, 2)
}

function textResult(text, structuredContent) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError: false,
  }
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
    isError: true,
  }
}

async function agentFetch(path, options) {
  if (typeof fetch !== "function") {
    throw new Error("The Browser connector requires a Node.js runtime with fetch support.")
  }

  const response = await fetch(`${AGENT_BASE_URL}${path}`, {
    headers: {
      accept: "application/json",
      ...(options && options.headers ? options.headers : {}),
    },
    ...options,
  })
  const bodyText = await response.text()
  let body
  try {
    body = bodyText ? JSON.parse(bodyText) : undefined
  } catch {
    body = undefined
  }

  if (!response.ok) {
    const apiMessage = body && body.error && typeof body.error.message === "string" ? body.error.message : undefined
    throw new Error(apiMessage || bodyText.trim() || `Anybox agent request failed with HTTP ${response.status}.`)
  }

  if (!body || body.success !== true) {
    throw new Error("Anybox agent returned an invalid API envelope.")
  }

  return body.data
}

async function agentCommand(method, params, timeoutMs) {
  const body = {
    method,
    params: params || {},
    ...(timeoutMs ? { timeoutMs } : {}),
  }
  return agentFetch("/api/browser-extension/command", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function requireWaitCondition(args) {
  if (args && (args.text || args.urlIncludes || args.selector || args.elementId)) return
  throw new Error("browser_wait_for requires text, urlIncludes, selector, or elementId.")
}

function screenshotResult(result) {
  const mimeType = result && result.mime ? String(result.mime) : "image/png"
  const tabID = result && Number.isInteger(result.tabId) ? result.tabId : "unknown"
  return {
    content: [
      { type: "text", text: `Captured screenshot for Chrome tab ${tabID}.` },
      { type: "image", data: result.data, mimeType },
    ],
    structuredContent: {
      tabId: result.tabId,
      mime: mimeType,
    },
    isError: false,
  }
}

async function callTool(name, args) {
  if (name === "browser_status") {
    const status = await agentFetch("/api/browser-extension/status")
    return textResult(status.connected ? "Chrome extension connected." : "Chrome extension disconnected.", status)
  }

  const method = commandByToolName[name]
  if (!method) throw new Error(`Unknown tool: ${name}`)

  const timeoutMs = name === "browser_wait_for" ? Math.min(Math.max(Number(args && args.timeoutMs) || 10_000, 1), 60_000) + 5_000 : undefined
  if (name === "browser_wait_for") requireWaitCondition(args)

  const result = await agentCommand(method, args || {}, timeoutMs)
  if (name === "browser_screenshot") return screenshotResult(result)

  return textResult(jsonText(result), result && typeof result === "object" && !Array.isArray(result) ? result : { result })
}

const rl = readline.createInterface({ input: process.stdin })

rl.on("line", (line) => {
  void (async () => {
    if (!line.trim()) return
    const message = JSON.parse(line)

    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "anybox-browser", version: "0.1.0" },
        },
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
        const result = await callTool(message.params && message.params.name, message.params && message.params.arguments)
        send({ jsonrpc: "2.0", id: message.id, result })
      } catch (error) {
        send({ jsonrpc: "2.0", id: message.id, result: errorResult(error) })
      }
      return
    }

    if (message.method === "ping") {
      send({ jsonrpc: "2.0", id: message.id, result: {} })
      return
    }

    if (message.method === "roots/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { roots: [] } })
      return
    }

    if (message.id !== undefined) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Unknown method: ${message.method}` },
      })
    }
  })().catch((error) => {
    send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    })
  })
})

rl.on("close", () => process.exit(0))
