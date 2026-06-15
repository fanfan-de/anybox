#!/usr/bin/env node

const crypto = require("node:crypto")
const readline = require("node:readline")

const DEFAULT_BASE_URL = "https://api-singapore.klingai.com"
const DEFAULT_FETCH_TIMEOUT_MS = 60_000
const VIDEO_ENDPOINTS = new Set(["text2video", "image2video", "multi-image2video"])
const TERMINAL_STATUSES = new Set(["succeed", "failed"])

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function textResult(text, structuredContent = {}) {
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

function objectSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  }
}

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8")
  return buffer
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}

function env(name) {
  return String(process.env[name] || "").trim()
}

function requiredEnv(name) {
  const value = env(name)
  if (!value) throw new Error(`${name} is required. Connect the Kling plugin and provide credentials first.`)
  return value
}

function apiBaseUrl() {
  const raw = env("KLING_API_BASE_URL") || DEFAULT_BASE_URL
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`KLING_API_BASE_URL is invalid: ${raw}`)
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("KLING_API_BASE_URL must be an HTTP(S) URL.")
  }
  return parsed.toString().replace(/\/+$/, "")
}

function makeToken() {
  const accessKey = requiredEnv("KLING_ACCESS_KEY")
  const secretKey = requiredEnv("KLING_SECRET_KEY")
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: "HS256", typ: "JWT" }
  const payload = {
    iss: accessKey,
    exp: now + 1800,
    nbf: now - 5,
  }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = crypto.createHmac("sha256", secretKey).update(signingInput).digest()
  return `${signingInput}.${base64url(signature)}`
}

function isSuccessCode(code) {
  if (code === undefined || code === null) return true
  return code === 0 || code === "0" || code === "000000"
}

function parseJSON(raw, url) {
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`Kling returned non-JSON response from ${url}: ${raw.slice(0, 300)}`)
  }
}

async function klingRequest(path, options = {}) {
  const url = `${apiBaseUrl()}${path}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${makeToken()}`,
        "Content-Type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
    const raw = await response.text()
    const payload = parseJSON(raw, url)
    if (!response.ok) {
      const message = payload.message || payload.msg || raw.slice(0, 300) || response.statusText
      throw new Error(`Kling HTTP ${response.status}: ${message}`)
    }
    if (!isSuccessCode(payload.code)) {
      const message = payload.message || payload.msg || "Kling API returned an error."
      throw new Error(`Kling API error ${payload.code}: ${message}`)
    }
    return payload
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`Kling request timed out after ${options.timeoutMs || DEFAULT_FETCH_TIMEOUT_MS}ms: ${url}`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function dataFromResponse(payload) {
  return payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "data")
    ? payload.data
    : payload
}

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  )
}

function stringArg(args, name, options = {}) {
  const value = args?.[name]
  if (typeof value === "string" && value.trim()) return value.trim()
  if (options.required) throw new Error(`${name} is required.`)
  return options.defaultValue
}

function enumArg(args, name, allowed, options = {}) {
  const value = stringArg(args, name, options)
  if (value === undefined) return undefined
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`)
  }
  return value
}

function numberArg(args, name, options = {}) {
  const raw = args?.[name]
  if (raw === undefined || raw === null || raw === "") return options.defaultValue
  const value = typeof raw === "number" ? raw : Number(raw)
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`)
  if (options.min !== undefined && value < options.min) throw new Error(`${name} must be >= ${options.min}.`)
  if (options.max !== undefined && value > options.max) throw new Error(`${name} must be <= ${options.max}.`)
  return value
}

function integerArg(args, name, options = {}) {
  const value = numberArg(args, name, options)
  if (value === undefined) return undefined
  const integer = Math.trunc(value)
  if (integer !== value) throw new Error(`${name} must be an integer.`)
  return integer
}

function validateEndpoint(value) {
  if (!VIDEO_ENDPOINTS.has(value)) {
    throw new Error(`endpoint must be one of: ${[...VIDEO_ENDPOINTS].join(", ")}`)
  }
  return value
}

function validateImageValue(value, name) {
  if (!value) return value
  if (/^data:image\/[^;]+;base64,/i.test(value)) {
    throw new Error(`${name} must be a public URL or bare base64. Remove the data:image/...;base64, prefix.`)
  }
  return value
}

function summarizeTask(data) {
  const videos = Array.isArray(data?.task_result?.videos) ? data.task_result.videos : []
  const urls = videos.map((video) => video && video.url).filter(Boolean)
  return {
    task_id: data?.task_id,
    task_status: data?.task_status,
    task_status_msg: data?.task_status_msg,
    external_task_id: data?.external_task_id,
    urls,
    raw: data,
  }
}

function taskText(prefix, summary) {
  const id = summary.task_id || "unknown"
  const status = summary.task_status || "unknown"
  const lines = [`${prefix} ${id}: ${status}`]
  if (summary.task_status_msg) lines.push(summary.task_status_msg)
  if (summary.urls.length > 0) {
    lines.push("")
    lines.push(...summary.urls.map((url) => `- ${url}`))
  }
  return lines.join("\n")
}

function videoTaskPath(endpoint, taskID) {
  return `/v1/videos/${validateEndpoint(endpoint)}/${encodeURIComponent(taskID)}`
}

async function getVideoTask(endpoint, taskID) {
  const payload = await klingRequest(videoTaskPath(endpoint, taskID))
  return summarizeTask(dataFromResponse(payload))
}

async function createTextToVideo(args) {
  const body = compactObject({
    model_name: stringArg(args, "model_name", { defaultValue: "kling-v3" }),
    prompt: stringArg(args, "prompt", { required: true }),
    negative_prompt: stringArg(args, "negative_prompt"),
    mode: enumArg(args, "mode", ["std", "pro", "4k"], { defaultValue: "pro" }),
    duration: enumArg(args, "duration", ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], { defaultValue: "5" }),
    aspect_ratio: enumArg(args, "aspect_ratio", ["16:9", "9:16", "1:1"], { defaultValue: "16:9" }),
    cfg_scale: numberArg(args, "cfg_scale", { min: 0, max: 1 }),
    sound: enumArg(args, "sound", ["on", "off"]),
    callback_url: stringArg(args, "callback_url"),
    external_task_id: stringArg(args, "external_task_id"),
  })
  const payload = await klingRequest("/v1/videos/text2video", { method: "POST", body })
  const data = dataFromResponse(payload)
  const summary = summarizeTask(data)
  return textResult(taskText("Created Kling text-to-video task", summary), {
    endpoint: "text2video",
    request: body,
    task: summary,
    response: payload,
  })
}

async function createImageToVideo(args) {
  const image = validateImageValue(stringArg(args, "image", { required: true }), "image")
  const imageTail = validateImageValue(stringArg(args, "image_tail"), "image_tail")
  const body = compactObject({
    model_name: stringArg(args, "model_name", { defaultValue: "kling-v3" }),
    image,
    image_tail: imageTail,
    prompt: stringArg(args, "prompt"),
    negative_prompt: stringArg(args, "negative_prompt"),
    mode: enumArg(args, "mode", ["std", "pro", "4k"], { defaultValue: "pro" }),
    duration: enumArg(args, "duration", ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], { defaultValue: "5" }),
    aspect_ratio: enumArg(args, "aspect_ratio", ["16:9", "9:16", "1:1"], { defaultValue: "16:9" }),
    cfg_scale: numberArg(args, "cfg_scale", { min: 0, max: 1 }),
    sound: enumArg(args, "sound", ["on", "off"]),
    callback_url: stringArg(args, "callback_url"),
    external_task_id: stringArg(args, "external_task_id"),
  })
  const payload = await klingRequest("/v1/videos/image2video", { method: "POST", body })
  const data = dataFromResponse(payload)
  const summary = summarizeTask(data)
  return textResult(taskText("Created Kling image-to-video task", summary), {
    endpoint: "image2video",
    request: { ...body, image: "[provided]", image_tail: imageTail ? "[provided]" : undefined },
    task: summary,
    response: payload,
  })
}

async function waitForVideo(args) {
  const endpoint = validateEndpoint(stringArg(args, "endpoint", { required: true }))
  const taskID = stringArg(args, "task_id", { required: true })
  const pollIntervalMs = integerArg(args, "poll_interval_ms", { defaultValue: 5000, min: 3000, max: 60000 })
  const timeoutMs = integerArg(args, "timeout_ms", { defaultValue: 600000, min: 3000, max: 1800000 })
  const deadline = Date.now() + timeoutMs
  let lastSummary

  while (true) {
    lastSummary = await getVideoTask(endpoint, taskID)
    if (TERMINAL_STATUSES.has(String(lastSummary.task_status || "").toLowerCase())) {
      return textResult(taskText("Kling video task finished", lastSummary), {
        endpoint,
        task: lastSummary,
        timed_out: false,
      })
    }

    if (Date.now() + pollIntervalMs > deadline) {
      return textResult(taskText("Kling video task did not finish before timeout", lastSummary), {
        endpoint,
        task: lastSummary,
        timed_out: true,
      })
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
}

const tools = [
  {
    name: "kling_health_check",
    title: "Kling Health Check",
    description: "Check whether Kling connector credentials and base URL are configured.",
    inputSchema: objectSchema({}),
    annotations: { readOnlyHint: true },
    async handler() {
      const configured = {
        accessKeyPresent: Boolean(env("KLING_ACCESS_KEY")),
        secretKeyPresent: Boolean(env("KLING_SECRET_KEY")),
        apiBaseUrl: apiBaseUrl(),
      }
      const ok = configured.accessKeyPresent && configured.secretKeyPresent
      return textResult(ok ? "Kling connector credentials are configured." : "Kling connector credentials are incomplete.", {
        ok,
        ...configured,
      })
    },
  },
  {
    name: "kling_create_text_to_video",
    title: "Create Kling Text-to-Video",
    description: "Create an asynchronous Kling text-to-video generation task.",
    inputSchema: objectSchema({
      prompt: { type: "string", description: "Video prompt." },
      model_name: { type: "string", description: "Kling model name. Defaults to kling-v3." },
      negative_prompt: { type: "string", description: "Optional negative prompt." },
      mode: { type: "string", enum: ["std", "pro", "4k"], description: "Generation mode. Defaults to pro." },
      duration: { type: "string", enum: ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], description: "Video duration in seconds. Defaults to 5." },
      aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"], description: "Output aspect ratio. Defaults to 16:9." },
      cfg_scale: { type: "number", minimum: 0, maximum: 1, description: "Prompt adherence control. Not supported by all Kling models." },
      sound: { type: "string", enum: ["on", "off"], description: "Optional sound setting when supported by the selected model." },
      callback_url: { type: "string", description: "Optional callback URL." },
      external_task_id: { type: "string", description: "Optional caller-provided unique task ID." },
    }, ["prompt"]),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: createTextToVideo,
  },
  {
    name: "kling_create_image_to_video",
    title: "Create Kling Image-to-Video",
    description: "Create an asynchronous Kling image-to-video generation task.",
    inputSchema: objectSchema({
      image: { type: "string", description: "Public image URL or bare base64 image content. Do not include a data URI prefix." },
      image_tail: { type: "string", description: "Optional ending frame as a public URL or bare base64 image content." },
      prompt: { type: "string", description: "Optional video prompt." },
      model_name: { type: "string", description: "Kling model name. Defaults to kling-v3." },
      negative_prompt: { type: "string", description: "Optional negative prompt." },
      mode: { type: "string", enum: ["std", "pro", "4k"], description: "Generation mode. Defaults to pro." },
      duration: { type: "string", enum: ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"], description: "Video duration in seconds. Defaults to 5." },
      aspect_ratio: { type: "string", enum: ["16:9", "9:16", "1:1"], description: "Output aspect ratio. Defaults to 16:9." },
      cfg_scale: { type: "number", minimum: 0, maximum: 1, description: "Prompt adherence control. Not supported by all Kling models." },
      sound: { type: "string", enum: ["on", "off"], description: "Optional sound setting when supported by the selected model." },
      callback_url: { type: "string", description: "Optional callback URL." },
      external_task_id: { type: "string", description: "Optional caller-provided unique task ID." },
    }, ["image"]),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: createImageToVideo,
  },
  {
    name: "kling_get_video_task",
    title: "Get Kling Video Task",
    description: "Fetch a Kling video task status by endpoint and task ID.",
    inputSchema: objectSchema({
      endpoint: { type: "string", enum: [...VIDEO_ENDPOINTS], description: "Video endpoint used to create the task." },
      task_id: { type: "string", description: "Kling task_id." },
    }, ["endpoint", "task_id"]),
    annotations: { readOnlyHint: true },
    async handler(args) {
      const summary = await getVideoTask(
        stringArg(args, "endpoint", { required: true }),
        stringArg(args, "task_id", { required: true }),
      )
      return textResult(taskText("Kling video task", summary), {
        endpoint: args.endpoint,
        task: summary,
      })
    },
  },
  {
    name: "kling_wait_for_video",
    title: "Wait For Kling Video",
    description: "Poll a Kling video task until it succeeds, fails, or times out.",
    inputSchema: objectSchema({
      endpoint: { type: "string", enum: [...VIDEO_ENDPOINTS], description: "Video endpoint used to create the task." },
      task_id: { type: "string", description: "Kling task_id." },
      poll_interval_ms: { type: "number", minimum: 3000, maximum: 60000, description: "Polling interval. Defaults to 5000." },
      timeout_ms: { type: "number", minimum: 3000, maximum: 1800000, description: "Overall wait timeout. Defaults to 600000." },
    }, ["endpoint", "task_id"]),
    annotations: { readOnlyHint: true },
    handler: waitForVideo,
  },
  {
    name: "kling_list_video_tasks",
    title: "List Kling Video Tasks",
    description: "List recent Kling video tasks for a supported endpoint.",
    inputSchema: objectSchema({
      endpoint: { type: "string", enum: [...VIDEO_ENDPOINTS], description: "Video endpoint to list." },
      pageNum: { type: "number", minimum: 1, description: "Page number. Defaults to 1." },
      pageSize: { type: "number", minimum: 1, maximum: 500, description: "Page size. Defaults to 30." },
    }, ["endpoint"]),
    annotations: { readOnlyHint: true },
    async handler(args) {
      const endpoint = validateEndpoint(stringArg(args, "endpoint", { required: true }))
      const pageNum = integerArg(args, "pageNum", { defaultValue: 1, min: 1 })
      const pageSize = integerArg(args, "pageSize", { defaultValue: 30, min: 1, max: 500 })
      const payload = await klingRequest(`/v1/videos/${endpoint}?pageNum=${pageNum}&pageSize=${pageSize}`)
      return textResult(`Fetched Kling ${endpoint} task page ${pageNum}.`, {
        endpoint,
        pageNum,
        pageSize,
        response: payload,
      })
    },
  },
]

const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))

function toolDefinition(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }
}

async function callTool(name, args) {
  const tool = toolsByName.get(name)
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  return await tool.handler(args || {})
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
          serverInfo: { name: "kling", version: "0.1.0" },
        },
      })
      return
    }

    if (String(message.method || "").startsWith("notifications/")) return

    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools: tools.map(toolDefinition) } })
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
