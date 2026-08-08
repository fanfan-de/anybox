#!/usr/bin/env node

"use strict"

const readline = require("node:readline")
const path = require("node:path")
const { open, stat } = require("node:fs/promises")

const DEFAULT_API_BASE_URL = "https://open.tiktokapis.com/v2"
const DEFAULT_UPLOAD_HOST = "open-upload.tiktokapis.com"
const MAX_VIDEO_SIZE = 4 * 1024 * 1024 * 1024
const TARGET_CHUNK_SIZE = 32 * 1024 * 1024
const MAX_CHUNK_SIZE = 64 * 1024 * 1024

const ACCESS_TOKEN = (process.env.TIKTOK_ACCESS_TOKEN || process.env.OAUTH_ACCESS_TOKEN || "").trim()
const API_BASE_URL = normalizeBaseUrl(process.env.TIKTOK_API_BASE_URL || DEFAULT_API_BASE_URL)
const ALLOWED_UPLOAD_HOST = (process.env.TIKTOK_ALLOWED_UPLOAD_HOST || DEFAULT_UPLOAD_HOST).trim().toLowerCase()

const PROFILE_FIELDS = [
  "open_id",
  "union_id",
  "avatar_url",
  "display_name",
  "bio_description",
  "profile_deep_link",
  "is_verified",
  "follower_count",
  "following_count",
  "likes_count",
  "video_count"
]

const VIDEO_FIELDS = [
  "id",
  "create_time",
  "cover_image_url",
  "share_url",
  "video_description",
  "duration",
  "height",
  "width",
  "title",
  "embed_html",
  "embed_link",
  "like_count",
  "comment_count",
  "share_count",
  "view_count"
]

const PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY"
]

const tools = [
  tool("tiktok_test_auth", "Test TikTok Auth", "Validate OAuth access and identify the connected TikTok account.", {}, [], true),
  tool("tiktok_profile_get", "Get TikTok Profile", "Read the connected account's profile and available engagement statistics.", {}, [], true),
  tool("tiktok_dashboard_summary", "Summarize TikTok Dashboard", "Combine profile statistics with bounded totals for recently listed public videos.", {
    page_size: integer("Videos per page. Defaults to 20.", 1, 20),
    max_pages: integer("Maximum pages to scan. Defaults to 3.", 1, 10),
    include_items: boolean("Include scanned video records. Defaults to false.")
  }, [], true),
  tool("tiktok_video_list", "List TikTok Videos", "List public videos for the connected account with Display API metadata and counts.", {
    max_count: integer("Maximum videos to return. Defaults to 20.", 1, 20),
    cursor: integer("Optional pagination cursor returned by a previous call.", 0, Number.MAX_SAFE_INTEGER)
  }, [], true),
  tool("tiktok_video_query", "Query TikTok Videos", "Read Display API metadata and public counts for up to 20 exact video IDs.", {
    video_ids: stringArray("One to twenty TikTok video IDs.", 1, 20)
  }, ["video_ids"], true),
  tool("tiktok_creator_info", "Get TikTok Posting Identity", "Fetch the latest creator identity, allowed privacy levels, disabled interactions, and maximum video duration required before Direct Post.", {}, [], true),
  tool("tiktok_video_upload_draft", "Upload TikTok Draft", "Upload a local video to the connected account's TikTok inbox for the creator to edit and post in TikTok.", {
    file_path: string("Absolute path to an MP4, MOV, or WebM video."),
    confirm: boolean("Must be true after the user explicitly confirms sending this file to the connected TikTok account.")
  }, ["file_path", "confirm"], false),
  tool("tiktok_video_direct_post", "Post TikTok Video", "Fetch current creator constraints, initialize Direct Post, and upload a confirmed local video.", {
    file_path: string("Absolute path to an MP4, MOV, or WebM video."),
    expected_creator_username: string("Exact creator_username returned by the latest tiktok_creator_info call."),
    duration_seconds: integer("Measured video duration in seconds, used to enforce the current creator limit.", 1, 600),
    title: stringAllowEmpty("Editable caption with optional hashtags and mentions, at most 2200 UTF-16 code units."),
    privacy_level: enumeration("Privacy level selected from the latest creator_info response.", PRIVACY_LEVELS),
    disable_comment: boolean("Disable comments for this post."),
    disable_duet: boolean("Disable Duet for this post."),
    disable_stitch: boolean("Disable Stitch for this post."),
    video_cover_timestamp_ms: integer("Optional cover-frame timestamp in milliseconds.", 0, 600000),
    brand_content_toggle: boolean("Declare that this post promotes a third-party brand, product, or service."),
    brand_organic_toggle: boolean("Declare that this post promotes the creator or creator's own business."),
    confirm: boolean("Must be true after the creator identity, editable caption, privacy, interaction, and commercial-content settings are shown and confirmed.")
  }, ["file_path", "expected_creator_username", "duration_seconds", "title", "privacy_level", "confirm"], false),
  tool("tiktok_publish_status", "Get TikTok Publish Status", "Fetch processing, inbox-delivery, publication, or failure status for one publish ID.", {
    publish_id: string("Publish ID returned by a TikTok upload or Direct Post call.")
  }, ["publish_id"], true),
  tool("tiktok_publish_cancel", "Cancel TikTok Publish Task", "Request cancellation of one in-flight TikTok Content Posting task when it is still cancellable.", {
    publish_id: string("Exact in-flight publish ID."),
    confirm: boolean("Must be true after the user explicitly confirms cancellation of this exact publish ID.")
  }, ["publish_id", "confirm"], false, true)
]

function tool(name, title, description, properties, required, readOnly, destructive = false) {
  return {
    name,
    title,
    description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: destructive,
      idempotentHint: readOnly,
      openWorldHint: true
    }
  }
}

function string(description) {
  return { type: "string", minLength: 1, description }
}

function stringAllowEmpty(description) {
  return { type: "string", description }
}

function boolean(description) {
  return { type: "boolean", description }
}

function integer(description, minimum, maximum) {
  return { type: "integer", minimum, maximum, description }
}

function enumeration(description, values) {
  return { type: "string", enum: values, description }
}

function stringArray(description, minItems, maxItems) {
  return {
    type: "array",
    minItems,
    maxItems,
    items: { type: "string", minLength: 1 },
    description
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value).trim())
  if (url.protocol !== "https:") throw new Error("TikTok API base URLs must use HTTPS.")
  return url.toString().replace(/\/$/, "")
}

function requireAccessToken() {
  if (!ACCESS_TOKEN) throw new Error("TikTok OAuth access token is missing. Connect the plugin before calling this tool.")
  return ACCESS_TOKEN
}

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value
}

function requireString(args, key, allowEmpty = false) {
  const value = args?.[key]
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`${key} is required.`)
  return allowEmpty ? value : value.trim()
}

function optionalInteger(args, key, fallback, minimum, maximum) {
  const value = args?.[key]
  if (value === undefined || value === null || value === "") return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${key} must be an integer from ${minimum} to ${maximum}.`)
  }
  return number
}

function requireInteger(args, key, minimum, maximum) {
  if (args?.[key] === undefined || args?.[key] === null || args?.[key] === "") throw new Error(`${key} is required.`)
  return optionalInteger(args, key, undefined, minimum, maximum)
}

function optionalBoolean(args, key, fallback = false) {
  const value = args?.[key]
  if (value === undefined) return fallback
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean.`)
  return value
}

function requireStringArray(args, key, minimum, maximum) {
  const value = args?.[key]
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${key} must contain between ${minimum} and ${maximum} values.`)
  }
  return value.map((item) => {
    if (typeof item !== "string" || !item.trim()) throw new Error(`${key} must contain only non-empty strings.`)
    return item.trim()
  })
}

function apiErrorMessage(payload, fallback) {
  if (payload?.error && typeof payload.error === "object") {
    const code = payload.error.code
    const message = payload.error.message
    if (code && code !== "ok" && message) return `${message} (${code})`
    if (code && code !== "ok") return String(code)
  }
  if (typeof payload?.error === "string") {
    return payload.error_description ? `${payload.error_description} (${payload.error})` : payload.error
  }
  return fallback
}

async function parseResponse(response) {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function assertTikTokSuccess(response, payload, context) {
  if (!response.ok) throw new Error(apiErrorMessage(payload, `${context} failed with HTTP ${response.status}.`))
  const code = payload?.error?.code
  if (code && code !== "ok") throw new Error(apiErrorMessage(payload, `${context} failed with TikTok error ${code}.`))
}

function addQuery(url, query = {}) {
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value))
  }
}

async function tiktokRequest(method, route, options = {}) {
  const url = new URL(`${API_BASE_URL}${route}`)
  addQuery(url, options.query)
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${requireAccessToken()}`
  }
  if (options.body !== undefined) headers["Content-Type"] = "application/json; charset=UTF-8"
  const response = await fetch(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  const payload = await parseResponse(response)
  assertTikTokSuccess(response, payload, options.context || "TikTok API request")
  return payload
}

async function getProfile() {
  const payload = await tiktokRequest("GET", "/user/info/", {
    query: { fields: PROFILE_FIELDS.join(",") },
    context: "TikTok profile request"
  })
  const user = payload?.data?.user
  if (!user) throw new Error("TikTok did not return a user profile for the connected account.")
  return user
}

async function listVideoPage(args = {}) {
  const maxCount = optionalInteger(args, "max_count", 20, 1, 20)
  const cursor = optionalInteger(args, "cursor", undefined, 0, Number.MAX_SAFE_INTEGER)
  const payload = await tiktokRequest("POST", "/video/list/", {
    query: { fields: VIDEO_FIELDS.join(",") },
    body: {
      max_count: maxCount,
      ...(cursor === undefined ? {} : { cursor })
    },
    context: "TikTok video list request"
  })
  return payload?.data || { videos: [], has_more: false }
}

function numeric(record, key) {
  const value = Number(record?.[key])
  return Number.isFinite(value) ? value : 0
}

async function dashboardSummary(args) {
  const pageSize = optionalInteger(args, "page_size", 20, 1, 20)
  const maxPages = optionalInteger(args, "max_pages", 3, 1, 10)
  const includeItems = optionalBoolean(args, "include_items", false)
  const profile = await getProfile()
  const items = []
  let cursor
  let hasMore = false
  for (let page = 0; page < maxPages; page += 1) {
    const data = await listVideoPage({ max_count: pageSize, ...(cursor === undefined ? {} : { cursor }) })
    items.push(...(Array.isArray(data.videos) ? data.videos : []))
    hasMore = data.has_more === true
    if (!hasMore || data.cursor === undefined || data.cursor === cursor) {
      cursor = data.cursor
      break
    }
    cursor = data.cursor
  }
  const totals = items.reduce((result, item) => ({
    views: result.views + numeric(item, "view_count"),
    likes: result.likes + numeric(item, "like_count"),
    comments: result.comments + numeric(item, "comment_count"),
    shares: result.shares + numeric(item, "share_count")
  }), { views: 0, likes: 0, comments: 0, shares: 0 })
  return {
    profile,
    scanned_video_count: items.length,
    scanned_video_totals: totals,
    truncated: hasMore,
    next_cursor: hasMore ? cursor : undefined,
    ...(includeItems ? { items } : {})
  }
}

async function getCreatorInfo() {
  const payload = await tiktokRequest("POST", "/post/publish/creator_info/query/", {
    body: {},
    context: "TikTok creator info request"
  })
  if (!payload?.data?.creator_username) throw new Error("TikTok did not return posting identity information.")
  return payload.data
}

function contentTypeForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  const contentType = ({
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm"
  })[extension]
  if (!contentType) throw new Error("TikTok uploads in this plugin version accept only MP4, MOV, or WebM files.")
  return contentType
}

async function inspectVideoFile(filePath) {
  if (!path.isAbsolute(filePath)) throw new Error("file_path must be an absolute path.")
  const metadata = await stat(filePath)
  if (!metadata.isFile()) throw new Error("file_path must point to a regular file.")
  if (metadata.size <= 0) throw new Error("file_path must not be empty.")
  if (metadata.size > MAX_VIDEO_SIZE) throw new Error("TikTok Content Posting API accepts video files up to 4 GiB.")
  return {
    path: filePath,
    size: metadata.size,
    contentType: contentTypeForFile(filePath)
  }
}

function buildTikTokChunkPlan(videoSize) {
  if (!Number.isSafeInteger(videoSize) || videoSize <= 0 || videoSize > MAX_VIDEO_SIZE) {
    throw new Error("videoSize must be a positive safe integer no greater than 4 GiB.")
  }
  if (videoSize <= MAX_CHUNK_SIZE) {
    return { chunkSize: videoSize, totalChunkCount: 1 }
  }
  return {
    chunkSize: TARGET_CHUNK_SIZE,
    totalChunkCount: Math.floor(videoSize / TARGET_CHUNK_SIZE)
  }
}

function assertUploadURL(value) {
  const url = new URL(value)
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== ALLOWED_UPLOAD_HOST) {
    throw new Error("TikTok returned an unexpected upload URL; refusing to send the local video.")
  }
  return url.toString()
}

async function readChunk(handle, offset, length) {
  const buffer = Buffer.allocUnsafe(length)
  let filled = 0
  while (filled < length) {
    const result = await handle.read(buffer, filled, length - filled, offset + filled)
    if (result.bytesRead === 0) break
    filled += result.bytesRead
  }
  if (filled !== length) throw new Error(`Could not read the requested video chunk at byte ${offset}.`)
  return buffer
}

async function uploadTikTokChunks(uploadURL, file, plan) {
  const handle = await open(file.path, "r")
  let offset = 0
  try {
    for (let index = 0; index < plan.totalChunkCount; index += 1) {
      const isLast = index === plan.totalChunkCount - 1
      const length = isLast ? file.size - offset : plan.chunkSize
      const chunk = await readChunk(handle, offset, length)
      const lastByte = offset + length - 1
      const response = await fetch(uploadURL, {
        method: "PUT",
        headers: {
          "Content-Type": file.contentType,
          "Content-Length": String(length),
          "Content-Range": `bytes ${offset}-${lastByte}/${file.size}`
        },
        body: chunk
      })
      const payload = await parseResponse(response)
      if (!response.ok) throw new Error(apiErrorMessage(payload, `TikTok media upload failed with HTTP ${response.status}.`))
      if (!isLast && response.status !== 206) {
        throw new Error(`TikTok returned HTTP ${response.status} for a non-final media chunk; expected 206.`)
      }
      if (isLast && response.status !== 201 && response.status !== 200) {
        throw new Error(`TikTok returned HTTP ${response.status} for the final media chunk; expected 200 or 201.`)
      }
      offset += length
    }
  } finally {
    await handle.close()
  }
  return { uploaded_bytes: offset, total_chunks: plan.totalChunkCount }
}

async function initializeAndUpload(route, file, body, context) {
  const payload = await tiktokRequest("POST", route, { body, context })
  const publishID = payload?.data?.publish_id
  const uploadURL = payload?.data?.upload_url
  if (!publishID || !uploadURL) throw new Error("TikTok did not return publish_id and upload_url for the upload.")
  const plan = buildTikTokChunkPlan(file.size)
  const transfer = await uploadTikTokChunks(assertUploadURL(uploadURL), file, plan)
  return {
    publish_id: publishID,
    file_name: path.basename(file.path),
    file_size: file.size,
    chunk_size: plan.chunkSize,
    total_chunk_count: plan.totalChunkCount,
    transfer
  }
}

async function uploadDraft(args) {
  if (args.confirm !== true) throw new Error("confirm must be true before uploading a TikTok draft.")
  const file = await inspectVideoFile(requireString(args, "file_path"))
  const plan = buildTikTokChunkPlan(file.size)
  const result = await initializeAndUpload(
    "/post/publish/inbox/video/init/",
    file,
    {
      source_info: {
        source: "FILE_UPLOAD",
        video_size: file.size,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.totalChunkCount
      }
    },
    "TikTok draft upload initialization"
  )
  return {
    ...result,
    publish_type: "INBOX_SHARE",
    next_step: "Open the TikTok inbox notification to review, edit, and publish the draft."
  }
}

async function directPost(args) {
  if (args.confirm !== true) throw new Error("confirm must be true before posting a TikTok video.")
  const expectedUsername = requireString(args, "expected_creator_username")
  const title = requireString(args, "title", true)
  if (title.length > 2200) throw new Error("title must not exceed 2200 UTF-16 code units.")
  const privacyLevel = requireString(args, "privacy_level")
  if (!PRIVACY_LEVELS.includes(privacyLevel)) throw new Error(`privacy_level must be one of: ${PRIVACY_LEVELS.join(", ")}.`)
  const durationSeconds = requireInteger(args, "duration_seconds", 1, 600)
  const file = await inspectVideoFile(requireString(args, "file_path"))
  const creator = await getCreatorInfo()
  if (creator.creator_username !== expectedUsername) {
    throw new Error(`Connected TikTok creator changed from '${expectedUsername}' to '${creator.creator_username}'. Review creator info and confirm again.`)
  }
  if (!Array.isArray(creator.privacy_level_options) || !creator.privacy_level_options.includes(privacyLevel)) {
    throw new Error(`privacy_level '${privacyLevel}' is not allowed by the latest TikTok creator info response.`)
  }
  const maximumDuration = Number(creator.max_video_post_duration_sec)
  if (Number.isFinite(maximumDuration) && durationSeconds > maximumDuration) {
    throw new Error(`duration_seconds exceeds this creator's current ${maximumDuration}-second Direct Post limit.`)
  }
  const coverTimestamp = optionalInteger(args, "video_cover_timestamp_ms", undefined, 0, durationSeconds * 1000)
  const plan = buildTikTokChunkPlan(file.size)
  const postInfo = {
    title,
    privacy_level: privacyLevel,
    disable_comment: creator.comment_disabled === true || optionalBoolean(args, "disable_comment", false),
    disable_duet: creator.duet_disabled === true || optionalBoolean(args, "disable_duet", false),
    disable_stitch: creator.stitch_disabled === true || optionalBoolean(args, "disable_stitch", false),
    ...(coverTimestamp === undefined ? {} : { video_cover_timestamp_ms: coverTimestamp }),
    ...(args.brand_content_toggle === undefined ? {} : { brand_content_toggle: optionalBoolean(args, "brand_content_toggle") }),
    ...(args.brand_organic_toggle === undefined ? {} : { brand_organic_toggle: optionalBoolean(args, "brand_organic_toggle") })
  }
  const result = await initializeAndUpload(
    "/post/publish/video/init/",
    file,
    {
      post_info: postInfo,
      source_info: {
        source: "FILE_UPLOAD",
        video_size: file.size,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.totalChunkCount
      }
    },
    "TikTok Direct Post initialization"
  )
  return {
    ...result,
    publish_type: "DIRECT_POST",
    creator: {
      creator_username: creator.creator_username,
      creator_nickname: creator.creator_nickname
    },
    post_info: postInfo,
    next_step: "Poll tiktok_publish_status until the post completes or fails."
  }
}

function jsonResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value && typeof value === "object" && !Array.isArray(value) ? value : { data: value },
    isError: false
  }
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
    isError: true
  }
}

async function callTool(name, rawArgs) {
  const args = asObject(rawArgs || {}, "arguments")

  if (name === "tiktok_test_auth") {
    const profile = await getProfile()
    return jsonResult({ ok: true, open_id: profile.open_id, display_name: profile.display_name })
  }
  if (name === "tiktok_profile_get") return jsonResult(await getProfile())
  if (name === "tiktok_dashboard_summary") return jsonResult(await dashboardSummary(args))
  if (name === "tiktok_video_list") return jsonResult(await listVideoPage(args))
  if (name === "tiktok_video_query") {
    const videoIDs = requireStringArray(args, "video_ids", 1, 20)
    const payload = await tiktokRequest("POST", "/video/query/", {
      query: { fields: VIDEO_FIELDS.join(",") },
      body: { filters: { video_ids: videoIDs } },
      context: "TikTok video query"
    })
    return jsonResult(payload?.data || { videos: [] })
  }
  if (name === "tiktok_creator_info") return jsonResult(await getCreatorInfo())
  if (name === "tiktok_video_upload_draft") return jsonResult(await uploadDraft(args))
  if (name === "tiktok_video_direct_post") return jsonResult(await directPost(args))
  if (name === "tiktok_publish_status") {
    const publishID = requireString(args, "publish_id")
    const payload = await tiktokRequest("POST", "/post/publish/status/fetch/", {
      body: { publish_id: publishID },
      context: "TikTok publish status request"
    })
    return jsonResult({ publish_id: publishID, ...payload.data })
  }
  if (name === "tiktok_publish_cancel") {
    if (args.confirm !== true) throw new Error("confirm must be true to cancel a TikTok publishing task.")
    const publishID = requireString(args, "publish_id")
    await tiktokRequest("POST", "/post/publish/cancel/", {
      body: { publish_id: publishID },
      context: "TikTok publish cancellation"
    })
    return jsonResult({ cancelled: true, publish_id: publishID })
  }

  throw new Error(`Unknown tool: ${name}`)
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function startServer() {
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
            serverInfo: { name: "tiktok-creator", version: "0.1.0" }
          }
        })
        return
      }
      if (message.method === "ping") {
        send({ jsonrpc: "2.0", id: message.id, result: {} })
        return
      }
      if (String(message.method || "").startsWith("notifications/")) return
      if (message.method === "tools/list") {
        send({ jsonrpc: "2.0", id: message.id, result: { tools } })
        return
      }
      if (message.method === "tools/call") {
        try {
          send({ jsonrpc: "2.0", id: message.id, result: await callTool(message.params?.name, message.params?.arguments) })
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
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) }
      })
    })
  })
}

if (require.main === module) startServer()

module.exports = {
  buildTikTokChunkPlan,
  callTool,
  tools
}
