#!/usr/bin/env node

"use strict"

const readline = require("node:readline")
const os = require("node:os")
const path = require("node:path")
const { randomUUID } = require("node:crypto")
const {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} = require("node:fs/promises")
const { createBilibiliHeaders } = require("./signer")

const DEFAULT_MEMBER_BASE_URL = "https://member.bilibili.com"
const DEFAULT_UPLOAD_BASE_URL = "https://openupos.bilivideo.com"
const SMALL_VIDEO_LIMIT = 100 * 1024 * 1024
const MAX_VIDEO_SIZE = 4 * 1024 * 1024 * 1024
const VIDEO_CHUNK_SIZE = 8 * 1024 * 1024
const MAX_IMAGE_SIZE = 5 * 1024 * 1024
const MAX_HISTORY_ENTRIES = 1000

const CLIENT_ID = (process.env.BILIBILI_CLIENT_ID || "").trim()
const CLIENT_SECRET = (process.env.BILIBILI_CLIENT_SECRET || "").trim()
const ACCESS_TOKEN = (process.env.BILIBILI_ACCESS_TOKEN || process.env.OAUTH_ACCESS_TOKEN || "").trim()
const API_MODE = normalizeApiMode(process.env.BILIBILI_API_MODE || "production")
const MEMBER_BASE_URL = normalizeBaseUrl(process.env.BILIBILI_MEMBER_BASE_URL || DEFAULT_MEMBER_BASE_URL)
const UPLOAD_BASE_URL = normalizeBaseUrl(process.env.BILIBILI_UPLOAD_BASE_URL || DEFAULT_UPLOAD_BASE_URL)
const DATA_DIR = path.resolve(
  process.env.BILIBILI_DATA_DIR ||
  path.join(process.env.ANYBOX_AGENT_DATA_DIR || path.join(os.homedir(), ".anybox"), "plugin-data", "bilibili-creator")
)
const HISTORY_PATH = path.join(DATA_DIR, "metrics-history.json")

const tools = [
  tool("bilibili_test_auth", "Test Bilibili Auth", "Validate OAuth access and return the granted Open Platform scopes.", {}, [], true),
  tool("bilibili_account_get", "Get Bilibili Account", "Read the authorized account profile, granted scopes, follower count, following count, and approved video count.", {}, [], true),
  tool("bilibili_dashboard_summary", "Summarize Bilibili Dashboard", "Aggregate account metrics and playback totals across a bounded number of video pages.", {
    page_size: integer("Videos per page. Defaults to 20.", 1, 50),
    max_pages: integer("Maximum video pages to scan. Defaults to 5.", 1, 50),
    include_items: boolean("Include per-video statistics in the result. Defaults to false.")
  }, [], true),
  tool("bilibili_metrics_snapshot", "Save Bilibili Metrics Snapshot", "Read current account and 30-day increment metrics and append a local snapshot for change tracking.", {}, [], false),
  tool("bilibili_metrics_history", "Read Bilibili Metrics History", "Read locally saved metric snapshots, newest first.", {
    limit: integer("Maximum snapshots to return. Defaults to 30.", 1, 1000)
  }, [], true),
  tool("bilibili_metrics_clear", "Clear Bilibili Metrics History", "Permanently delete this plugin's local metric snapshot file.", {
    confirm: boolean("Must be true to delete the local history file.")
  }, ["confirm"], false, true),
  tool("bilibili_video_categories", "List Bilibili Video Categories", "List video submission categories and their IDs.", {}, [], true),
  tool("bilibili_video_list", "List Bilibili Videos", "List video submissions visible to the authorized account.", {
    page: integer("Page number. Defaults to 1.", 1, 100000),
    page_size: integer("Page size. Defaults to 20.", 1, 50),
    status: enumeration("Submission status. Defaults to all.", ["all", "is_pubing", "pubed", "not_pubed"])
  }, [], true),
  tool("bilibili_video_get", "Get Bilibili Video", "Read one video submission by resource ID.", {
    resource_id: string("Bilibili Open Platform video resource ID.")
  }, ["resource_id"], true),
  tool("bilibili_video_stats", "Get Bilibili Video Stats", "Read playback, like, favorite, coin, share, reply, and danmaku metrics for one video.", {
    resource_id: string("Bilibili Open Platform video resource ID.")
  }, ["resource_id"], true),
  tool("bilibili_video_publish", "Publish Bilibili Video", "Upload a local video and optional cover, then submit the video for review.", {
    file_path: string("Absolute path to an MP4, FLV, MOV, or supported video file."),
    title: string("Video title, at most 80 characters."),
    category_id: integer("Video category ID returned by bilibili_video_categories.", 1, 1000000),
    tags: stringArray("One or more tags; they are joined with commas."),
    description: string("Optional video description, at most 250 characters."),
    cover_path: string("Optional absolute path to a JPEG or PNG cover, at most 5 MB."),
    copyright: enumeration("1 for original, 2 for repost. Defaults to 1.", [1, 2], "integer"),
    source: string("Required source URL or attribution when copyright is 2."),
    no_reprint: boolean("Disallow reposting when true."),
    topic_id: integer("Optional Bilibili topic ID.", 1, 2147483647),
    mission_id: integer("Optional Bilibili activity/mission ID.", 1, 2147483647)
  }, ["file_path", "title", "category_id", "tags"], false),
  tool("bilibili_video_delete", "Delete Bilibili Video", "Permanently delete one video submission. This cannot be undone.", {
    resource_id: string("Exact Bilibili Open Platform video resource ID."),
    confirm: boolean("Must be true after the user explicitly confirms permanent deletion.")
  }, ["resource_id", "confirm"], false, true),
  tool("bilibili_article_categories", "List Bilibili Article Categories", "List article categories and child category IDs.", {}, [], true),
  tool("bilibili_article_list", "List Bilibili Articles", "List article submissions visible to the authorized account.", {
    page: integer("Page number. Defaults to 1.", 1, 100000),
    page_size: integer("Page size. Defaults to 10.", 1, 50),
    sort: integer("Sort: 1 newest, 2 likes, 3 replies, 4 views, 5 favorites, 6 coins.", 1, 6),
    group: integer("State group: 0 all, 1 processing, 2 approved, 3 rejected.", 0, 3),
    category_id: integer("Optional article category ID.", 1, 1000000)
  }, [], true),
  tool("bilibili_article_get", "Get Bilibili Article", "Read one article submission by numeric article ID.", {
    article_id: integer("Bilibili article ID.", 1, Number.MAX_SAFE_INTEGER)
  }, ["article_id"], true),
  tool("bilibili_article_stats", "Get Bilibili Article Stats", "Read view, like, favorite, coin, share, and reply metrics for up to 30 article IDs.", {
    article_ids: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: { anyOf: [{ type: "integer", minimum: 1 }, { type: "string", minLength: 1 }] },
      description: "Article IDs to query."
    }
  }, ["article_ids"], true),
  tool("bilibili_article_upload_image", "Upload Bilibili Article Image", "Upload a local JPEG, PNG, or GIF for use in Bilibili-compatible article HTML.", {
    file_path: string("Absolute image path, at most 5 MB."),
    watermark: boolean("Apply the account watermark when supported. Defaults to false.")
  }, ["file_path"], false),
  tool("bilibili_article_publish", "Publish Bilibili Article", "Submit Bilibili-compatible HTML as an article for review.", {
    title: string("Article title, at most 40 characters."),
    category_id: integer("Child category ID returned by bilibili_article_categories.", 1, 1000000),
    summary: string("Article summary."),
    content_html: string("Bilibili-compatible HTML content."),
    content_path: string("Absolute path to a UTF-8 file containing Bilibili-compatible HTML."),
    template_id: enumeration("3 for three covers, 4 for one cover/banner/video, 5 for generated default cover. Defaults to 5.", [3, 4, 5], "integer"),
    image_urls: stringArray("Image URLs returned by bilibili_article_upload_image."),
    tags: stringArray("Optional article tags."),
    banner_url: string("Optional uploaded banner URL."),
    top_video_bvid: string("Optional BVID for the article header; mutually exclusive with banner_url."),
    original: boolean("Mark the article as original."),
    list_id: integer("Optional article collection ID.", 1, Number.MAX_SAFE_INTEGER),
    close_replies: boolean("Close replies when true.")
  }, ["title", "category_id", "summary"], false),
  tool("bilibili_article_delete", "Delete Bilibili Article", "Permanently delete one article. This cannot be undone.", {
    article_id: integer("Exact numeric Bilibili article ID.", 1, Number.MAX_SAFE_INTEGER),
    confirm: boolean("Must be true after the user explicitly confirms permanent deletion.")
  }, ["article_id", "confirm"], false, true)
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

function boolean(description) {
  return { type: "boolean", description }
}

function integer(description, minimum, maximum) {
  return { type: "integer", minimum, maximum, description }
}

function enumeration(description, values, type = "string") {
  return { type, enum: values, description }
}

function stringArray(description) {
  return {
    type: "array",
    minItems: 1,
    items: { type: "string", minLength: 1 },
    description
  }
}

function normalizeApiMode(value) {
  const mode = String(value || "production").trim().toLowerCase()
  if (!new Set(["production", "sandbox"]).has(mode)) {
    throw new Error("BILIBILI_API_MODE must be production or sandbox.")
  }
  return mode
}

function normalizeBaseUrl(value) {
  const normalized = String(value || "").trim().replace(/\/+$/, "")
  if (!normalized) throw new Error("Bilibili base URL is empty.")
  const url = new URL(normalized)
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("Bilibili base URL must use HTTP or HTTPS.")
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"])
  if (url.protocol !== "https:" && !localHosts.has(url.hostname)) {
    throw new Error("Bilibili base URL must use HTTPS unless it points to localhost.")
  }
  return normalized
}

function requireEnv() {
  if (!CLIENT_ID) throw new Error("BILIBILI_CLIENT_ID is not configured.")
  if (!CLIENT_SECRET) throw new Error("BILIBILI_CLIENT_SECRET is not configured.")
  if (!ACCESS_TOKEN) throw new Error("BILIBILI_ACCESS_TOKEN is not configured. Connect the OAuth account first.")
}

function memberPath(productionPath, sandboxPath) {
  if (API_MODE !== "sandbox") return productionPath
  return sandboxPath || `/mock${productionPath}`
}

function addQuery(url, query) {
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === "") continue
    url.searchParams.set(key, String(value))
  }
}

async function parseResponse(response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

function apiMessage(payload) {
  return payload?.message || payload?.msg || payload?.raw || "Bilibili API returned an error."
}

function assertBilibiliSuccess(response, payload, context) {
  if (!response.ok) {
    throw new Error(`${context} failed: HTTP ${response.status}; ${apiMessage(payload)}`)
  }
  if (payload && Object.prototype.hasOwnProperty.call(payload, "code") && Number(payload.code) !== 0) {
    throw new Error(`${context} failed: ${apiMessage(payload)} (code ${payload.code})`)
  }
}

async function bilibiliRequest(method, productionPath, options = {}) {
  requireEnv()
  const requestPath = memberPath(productionPath, options.sandboxPath)
  const url = new URL(`${MEMBER_BASE_URL}${requestPath}`)
  addQuery(url, options.query)

  let body
  let bodyForMD5 = ""
  let contentType = "application/json"
  if (options.json !== undefined) {
    body = JSON.stringify(options.json)
    bodyForMD5 = body
    contentType = "application/json"
  } else if (options.multipart) {
    const multipart = await buildMultipartBody(options.multipart.fields || {}, options.multipart.file)
    body = multipart.body
    contentType = multipart.contentType
    bodyForMD5 = ""
  }

  const headers = createBilibiliHeaders({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    accessToken: ACCESS_TOKEN,
    body,
    bodyForMD5,
    contentType
  })
  const response = await fetch(url, { method, headers, body })
  const payload = await parseResponse(response)
  assertBilibiliSuccess(response, payload, `${method} ${productionPath}`)
  return payload
}

async function buildMultipartBody(fields, file) {
  const boundary = `--------------------------${randomUUID().replace(/-/g, "")}`
  const parts = []
  for (const [key, rawValue] of Object.entries(fields)) {
    if (rawValue === undefined || rawValue === null || rawValue === "") continue
    const safeKey = String(key).replace(/["\r\n]/g, "_")
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${safeKey}"\r\n\r\n${String(rawValue)}\r\n`))
  }
  if (file) {
    const safeField = String(file.field || "file").replace(/["\r\n]/g, "_")
    const safeName = path.basename(file.name).replace(/["\r\n]/g, "_")
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${safeField}"; filename="${safeName}"\r\nContent-Type: ${file.contentType}\r\n\r\n`))
    parts.push(file.data)
    parts.push(Buffer.from("\r\n"))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  }
}

async function uploadBinary(productionPath, query, data, context) {
  const url = new URL(`${UPLOAD_BASE_URL}${productionPath}`)
  addQuery(url, query)
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/octet-stream"
    },
    body: data
  })
  const payload = await parseResponse(response)
  assertBilibiliSuccess(response, payload, context)
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
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required.`)
  return value.trim()
}

function optionalString(args, key) {
  const value = args?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
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
  if (args?.[key] === undefined || args?.[key] === null || args?.[key] === "") {
    throw new Error(`${key} is required.`)
  }
  return optionalInteger(args, key, undefined, minimum, maximum)
}

function optionalBoolean(args, key, fallback = false) {
  const value = args?.[key]
  if (value === undefined) return fallback
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean.`)
  return value
}

function optionalEnum(args, key, values, fallback) {
  const value = args?.[key] ?? fallback
  if (!values.includes(value)) throw new Error(`${key} must be one of: ${values.join(", ")}.`)
  return value
}

function requireStringArray(args, key) {
  const value = args?.[key]
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${key} must be a non-empty array of strings.`)
  }
  return value.map((item) => item.trim())
}

function optionalStringArray(args, key) {
  if (args?.[key] === undefined) return []
  return requireStringArray(args, key)
}

function codePointLength(value) {
  return [...String(value)].length
}

function assertMaxLength(value, key, maximum) {
  if (value && codePointLength(value) > maximum) throw new Error(`${key} must not exceed ${maximum} characters.`)
}

function unwrapData(payload) {
  return payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "data")
    ? payload.data
    : payload
}

function pickNumber(record, keys) {
  for (const key of keys) {
    const value = Number(record?.[key])
    if (Number.isFinite(value)) return value
  }
  return 0
}

async function inspectAbsoluteFile(filePath, kind) {
  if (!path.isAbsolute(filePath)) throw new Error(`${kind} path must be absolute.`)
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error(`${kind} path must point to a regular file.`)
  return info
}

function imageContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".png") return "image/png"
  if (extension === ".gif") return "image/gif"
  throw new Error("Image must be JPEG, PNG, or GIF.")
}

async function readUploadImage(filePath, allowGif = true) {
  const info = await inspectAbsoluteFile(filePath, "Image")
  if (info.size <= 0 || info.size > MAX_IMAGE_SIZE) throw new Error("Image must be larger than 0 bytes and no more than 5 MB.")
  const contentType = imageContentType(filePath)
  if (!allowGif && contentType === "image/gif") throw new Error("Video cover must be JPEG or PNG.")
  return {
    field: "file",
    name: path.basename(filePath),
    contentType,
    data: await readFile(filePath)
  }
}

async function fetchAccountBundle() {
  const [scopes, info, statPayload] = await Promise.all([
    bilibiliRequest("GET", "/arcopen/fn/user/account/scopes"),
    bilibiliRequest("GET", "/arcopen/fn/user/account/info", {
      sandboxPath: "/mock/arcopen/fn/data/user/account/info"
    }),
    bilibiliRequest("GET", "/arcopen/fn/data/user/stat")
  ])
  return {
    scopes: unwrapData(scopes),
    account: unwrapData(info),
    statistics: unwrapData(statPayload)
  }
}

async function collectMetricSnapshot() {
  const [account, videoIncrementPayload, articleIncrementPayload] = await Promise.all([
    fetchAccountBundle(),
    bilibiliRequest("GET", "/arcopen/fn/data/arc/inc-stats"),
    bilibiliRequest("GET", "/arcopen/fn/data/art/inc-stats")
  ])
  const user = account.statistics || {}
  const video30d = unwrapData(videoIncrementPayload) || {}
  const article30d = unwrapData(articleIncrementPayload) || {}
  return {
    captured_at: new Date().toISOString(),
    follower: pickNumber(user, ["follower", "followers"]),
    following: pickNumber(user, ["following"]),
    approved_videos: pickNumber(user, ["arc_passed_total", "archive_count"]),
    video_30d: {
      plays: pickNumber(video30d, ["inc_click", "view", "plays"]),
      likes: pickNumber(video30d, ["inc_like", "likes"]),
      favorites: pickNumber(video30d, ["inc_fav", "favorites"]),
      coins: pickNumber(video30d, ["inc_coin", "coins"]),
      shares: pickNumber(video30d, ["inc_share", "shares"]),
      replies: pickNumber(video30d, ["inc_reply", "replies"]),
      danmaku: pickNumber(video30d, ["inc_dm", "danmaku"])
    },
    article_30d: {
      reads: pickNumber(article30d, ["inc_read", "view", "reads"]),
      likes: pickNumber(article30d, ["inc_likes", "inc_like", "likes"]),
      favorites: pickNumber(article30d, ["inc_fav", "favorites"]),
      coins: pickNumber(article30d, ["inc_coin", "coins"]),
      shares: pickNumber(article30d, ["inc_share", "shares"]),
      replies: pickNumber(article30d, ["inc_reply", "replies"])
    }
  }
}

async function readHistory() {
  try {
    const parsed = JSON.parse(await readFile(HISTORY_PATH, "utf8"))
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if (error?.code === "ENOENT") return []
    throw new Error(`Could not read metrics history: ${error.message}`)
  }
}

async function appendHistory(snapshot) {
  const entries = await readHistory()
  const previous = entries[entries.length - 1]
  const nextEntries = [...entries, snapshot].slice(-MAX_HISTORY_ENTRIES)
  await mkdir(DATA_DIR, { recursive: true })
  const temporaryPath = `${HISTORY_PATH}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(nextEntries, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(temporaryPath, HISTORY_PATH)
  return {
    snapshot,
    change_since_previous: previous
      ? {
          follower: snapshot.follower - Number(previous.follower || 0),
          following: snapshot.following - Number(previous.following || 0),
          approved_videos: snapshot.approved_videos - Number(previous.approved_videos || 0)
        }
      : null,
    history_entries: nextEntries.length,
    history_path: HISTORY_PATH
  }
}

async function mapLimit(values, limit, mapper) {
  const output = new Array(values.length)
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++
      output[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  return output
}

async function collectVideoDashboard(args) {
  const pageSize = optionalInteger(args, "page_size", 20, 1, 50)
  const maxPages = optionalInteger(args, "max_pages", 5, 1, 50)
  const includeItems = optionalBoolean(args, "include_items", false)
  const videos = []
  let reportedTotal = 0
  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await bilibiliRequest("GET", "/arcopen/fn/archive/viewlist", {
      query: { pn: page, ps: pageSize, status: "all" }
    })
    const data = unwrapData(payload) || {}
    const items = Array.isArray(data.list) ? data.list : []
    reportedTotal = pickNumber(data.page || {}, ["total"]) || reportedTotal
    videos.push(...items)
    if (items.length < pageSize || (reportedTotal > 0 && videos.length >= reportedTotal)) break
  }

  const failures = []
  const itemStats = await mapLimit(videos, 4, async (video) => {
    const resourceID = String(video.resource_id || "").trim()
    if (!resourceID) return { video, statistics: null }
    try {
      const payload = await bilibiliRequest("GET", "/arcopen/fn/data/arc/stat", {
        query: { resource_id: resourceID }
      })
      return { video, statistics: unwrapData(payload) }
    } catch (error) {
      failures.push({ resource_id: resourceID, error: error.message })
      return { video, statistics: null }
    }
  })

  const totals = {
    plays: 0,
    likes: 0,
    favorites: 0,
    coins: 0,
    shares: 0,
    replies: 0,
    danmaku: 0
  }
  for (const item of itemStats) {
    const value = item.statistics || {}
    totals.plays += pickNumber(value, ["view"])
    totals.likes += pickNumber(value, ["like"])
    totals.favorites += pickNumber(value, ["favorite"])
    totals.coins += pickNumber(value, ["coin"])
    totals.shares += pickNumber(value, ["share"])
    totals.replies += pickNumber(value, ["reply"])
    totals.danmaku += pickNumber(value, ["danmaku"])
  }

  const [account, videoIncrement, articleIncrement] = await Promise.all([
    fetchAccountBundle(),
    bilibiliRequest("GET", "/arcopen/fn/data/arc/inc-stats"),
    bilibiliRequest("GET", "/arcopen/fn/data/art/inc-stats")
  ])
  return {
    generated_at: new Date().toISOString(),
    account,
    scanned_videos: videos.length,
    total_videos_reported: reportedTotal || videos.length,
    truncated: Boolean(reportedTotal && videos.length < reportedTotal),
    lifetime_totals_for_scanned_videos: totals,
    video_30d: unwrapData(videoIncrement),
    article_30d: unwrapData(articleIncrement),
    failed_video_stats: failures,
    ...(includeItems ? { videos: itemStats } : {})
  }
}

async function publishVideo(args) {
  if (API_MODE === "sandbox" && UPLOAD_BASE_URL === DEFAULT_UPLOAD_BASE_URL) {
    throw new Error("Sandbox video publishing requires BILIBILI_UPLOAD_BASE_URL to be set to the current sandbox upload endpoint.")
  }
  const filePath = requireString(args, "file_path")
  const info = await inspectAbsoluteFile(filePath, "Video")
  if (info.size <= 0 || info.size > MAX_VIDEO_SIZE) throw new Error("Video must be larger than 0 bytes and no more than 4 GB.")
  const title = requireString(args, "title")
  const description = optionalString(args, "description")
  assertMaxLength(title, "title", 80)
  assertMaxLength(description, "description", 250)
  const tags = requireStringArray(args, "tags")
  const tagText = tags.join(",")
  if (codePointLength(tagText) > 200) throw new Error("Combined tags must not exceed 200 characters.")
  const copyright = optionalEnum(args, "copyright", [1, 2], 1)
  const source = optionalString(args, "source")
  if (copyright === 2 && !source) throw new Error("source is required when copyright is 2 (repost).")

  const smallUpload = info.size <= SMALL_VIDEO_LIMIT
  const initPayload = await bilibiliRequest("POST", "/arcopen/fn/archive/video/init", {
    json: { name: path.basename(filePath), utype: smallUpload ? "1" : "0" }
  })
  const uploadToken = String(unwrapData(initPayload)?.upload_token || "").trim()
  if (!uploadToken) throw new Error("Bilibili did not return an upload_token.")

  if (smallUpload) {
    await uploadBinary("/video/v2/upload", { upload_token: uploadToken }, await readFile(filePath), "Small video upload")
  } else {
    const file = await open(filePath, "r")
    try {
      let offset = 0
      let partNumber = 1
      while (offset < info.size) {
        const partSize = Math.min(VIDEO_CHUNK_SIZE, info.size - offset)
        const buffer = Buffer.alloc(Number(partSize))
        const { bytesRead } = await file.read(buffer, 0, Number(partSize), offset)
        if (bytesRead <= 0) throw new Error(`Could not read video part ${partNumber}.`)
        await uploadBinary(
          "/video/v2/part/upload",
          { upload_token: uploadToken, part_number: partNumber },
          bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead),
          `Video part ${partNumber} upload`
        )
        offset += bytesRead
        partNumber += 1
      }
    } finally {
      await file.close()
    }
    await bilibiliRequest("POST", "/arcopen/fn/archive/video/complete", {
      query: { upload_token: uploadToken }
    })
  }

  let cover
  const coverPath = optionalString(args, "cover_path")
  if (coverPath) {
    const coverPayload = await bilibiliRequest("POST", "/arcopen/fn/archive/cover/upload", {
      multipart: { file: await readUploadImage(coverPath, false) }
    })
    cover = unwrapData(coverPayload)?.url
    if (!cover) throw new Error("Bilibili did not return a cover URL.")
  }

  const submit = {
    title,
    tid: requireInteger(args, "category_id", 1, 1000000),
    tag: tagText,
    copyright,
    no_reprint: optionalBoolean(args, "no_reprint", false) ? 1 : 0
  }
  if (description) submit.desc = description
  if (cover) submit.cover = cover
  if (source) submit.source = source
  const topicID = optionalInteger(args, "topic_id", undefined, 1, 2147483647)
  const missionID = optionalInteger(args, "mission_id", undefined, 1, 2147483647)
  if (topicID) submit.topic_id = topicID
  if (missionID) submit.mission_id = missionID

  const submitPayload = await bilibiliRequest("POST", "/arcopen/fn/archive/add-by-utoken", {
    query: { upload_token: uploadToken },
    json: submit
  })
  return {
    uploaded_bytes: info.size,
    upload_mode: smallUpload ? "single" : "multipart",
    cover_url: cover,
    resource_id: unwrapData(submitPayload)?.resource_id,
    response: submitPayload
  }
}

async function articleContent(args) {
  const inline = optionalString(args, "content_html")
  const contentPath = optionalString(args, "content_path")
  if (Boolean(inline) === Boolean(contentPath)) {
    throw new Error("Provide exactly one of content_html or content_path.")
  }
  if (inline) return inline
  await inspectAbsoluteFile(contentPath, "Article content")
  return await readFile(contentPath, "utf8")
}

async function publishArticle(args) {
  const title = requireString(args, "title")
  assertMaxLength(title, "title", 40)
  const summary = requireString(args, "summary")
  const content = await articleContent(args)
  const imageCount = (content.match(/<img\b/gi) || []).length
  if (codePointLength(content) < 200 && imageCount < 3) {
    throw new Error("Article content must contain at least 200 characters or at least three image elements.")
  }
  if (codePointLength(content) > 40000) throw new Error("Article content must not exceed 40000 characters.")

  const templateID = optionalEnum(args, "template_id", [3, 4, 5], 5)
  const imageURLs = optionalStringArray(args, "image_urls")
  const bannerURL = optionalString(args, "banner_url")
  const topVideoBVID = optionalString(args, "top_video_bvid")
  if (bannerURL && topVideoBVID) throw new Error("banner_url and top_video_bvid are mutually exclusive.")
  if (templateID === 3 && imageURLs.length < 3) throw new Error("template_id 3 requires at least three image_urls.")
  if (templateID === 4 && !bannerURL && !topVideoBVID && imageURLs.length === 0) {
    throw new Error("template_id 4 requires image_urls, banner_url, or top_video_bvid.")
  }

  const fields = {
    title,
    category: requireInteger(args, "category_id", 1, 1000000),
    template_id: templateID,
    summary,
    content,
    original: optionalBoolean(args, "original", false) ? 1 : 0,
    up_closed_reply: optionalBoolean(args, "close_replies", false) ? 1 : 0
  }
  if (imageURLs.length) fields.image_urls = imageURLs.join(",")
  const tags = optionalStringArray(args, "tags")
  if (tags.length) fields.tags = tags.join(",")
  if (bannerURL) fields.banner_url = bannerURL
  if (topVideoBVID) fields.top_video_bvid = topVideoBVID
  const listID = optionalInteger(args, "list_id", undefined, 1, Number.MAX_SAFE_INTEGER)
  if (listID) fields.list_id = listID

  const payload = await bilibiliRequest("POST", "/arcopen/fn/article/add", {
    multipart: { fields }
  })
  return {
    article_id: unwrapData(payload)?.id,
    response: payload
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

  if (name === "bilibili_test_auth") {
    const bundle = await fetchAccountBundle()
    return jsonResult({
      ok: true,
      api_mode: API_MODE,
      member_base_url: MEMBER_BASE_URL,
      account: bundle.account,
      scopes: bundle.scopes
    })
  }

  if (name === "bilibili_account_get") return jsonResult(await fetchAccountBundle())
  if (name === "bilibili_dashboard_summary") return jsonResult(await collectVideoDashboard(args))
  if (name === "bilibili_metrics_snapshot") return jsonResult(await appendHistory(await collectMetricSnapshot()))

  if (name === "bilibili_metrics_history") {
    const limit = optionalInteger(args, "limit", 30, 1, 1000)
    const entries = await readHistory()
    return jsonResult({
      history_path: HISTORY_PATH,
      total: entries.length,
      entries: entries.slice(-limit).reverse()
    })
  }

  if (name === "bilibili_metrics_clear") {
    if (args.confirm !== true) throw new Error("confirm must be true to permanently delete metrics history.")
    let deleted = true
    try {
      await unlink(HISTORY_PATH)
    } catch (error) {
      if (error?.code === "ENOENT") deleted = false
      else throw error
    }
    return jsonResult({ deleted, history_path: HISTORY_PATH })
  }

  if (name === "bilibili_video_categories") {
    return jsonResult(await bilibiliRequest("GET", "/arcopen/fn/archive/type/list"))
  }

  if (name === "bilibili_video_list") {
    return jsonResult(await bilibiliRequest("GET", "/arcopen/fn/archive/viewlist", {
      query: {
        pn: optionalInteger(args, "page", 1, 1, 100000),
        ps: optionalInteger(args, "page_size", 20, 1, 50),
        status: optionalEnum(args, "status", ["all", "is_pubing", "pubed", "not_pubed"], "all")
      }
    }))
  }

  if (name === "bilibili_video_get") {
    return jsonResult(await bilibiliRequest("GET", "/arcopen/fn/archive/view", {
      query: { resource_id: requireString(args, "resource_id") }
    }))
  }

  if (name === "bilibili_video_stats") {
    return jsonResult(await bilibiliRequest("GET", "/arcopen/fn/data/arc/stat", {
      query: { resource_id: requireString(args, "resource_id") }
    }))
  }

  if (name === "bilibili_video_publish") return jsonResult(await publishVideo(args))

  if (name === "bilibili_video_delete") {
    if (args.confirm !== true) throw new Error("confirm must be true to permanently delete a video.")
    const resourceID = requireString(args, "resource_id")
    const payload = await bilibiliRequest("POST", "/arcopen/fn/archive/delete", {
      json: { resource_id: resourceID }
    })
    return jsonResult({ deleted: true, resource_id: resourceID, response: payload })
  }

  if (name === "bilibili_article_categories") {
    return jsonResult(await bilibiliRequest("GET", "/arcopen/fn/article/categories"))
  }

  if (name === "bilibili_article_list") {
    return jsonResult(await bilibiliRequest("GET", "/arcopen/fn/article/list", {
      query: {
        pn: optionalInteger(args, "page", 1, 1, 100000),
        ps: optionalInteger(args, "page_size", 10, 1, 50),
        sort: optionalInteger(args, "sort", 1, 1, 6),
        group: optionalInteger(args, "group", 0, 0, 3),
        category: optionalInteger(args, "category_id", undefined, 1, 1000000)
      }
    }))
  }

  if (name === "bilibili_article_get") {
    return jsonResult(await bilibiliRequest("GET", "/arcopen/fn/article/detail", {
      query: { id: requireInteger(args, "article_id", 1, Number.MAX_SAFE_INTEGER) }
    }))
  }

  if (name === "bilibili_article_stats") {
    const ids = args.article_ids
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 30) {
      throw new Error("article_ids must contain between 1 and 30 IDs.")
    }
    const normalizedIDs = ids.map((id) => {
      const value = String(id).trim()
      if (!/^\d+$/.test(value) || value === "0") throw new Error(`Invalid article ID: ${value}`)
      return value
    })
    return jsonResult(await bilibiliRequest("GET", "/arcopen/fn/data/art/stat", {
      query: { ids: normalizedIDs.join(",") }
    }))
  }

  if (name === "bilibili_article_upload_image") {
    const filePath = requireString(args, "file_path")
    const payload = await bilibiliRequest("POST", "/arcopen/fn/article/upload/image", {
      multipart: {
        fields: { watermark: optionalBoolean(args, "watermark", false) ? 1 : 0 },
        file: await readUploadImage(filePath, true)
      }
    })
    return jsonResult(payload)
  }

  if (name === "bilibili_article_publish") return jsonResult(await publishArticle(args))

  if (name === "bilibili_article_delete") {
    if (args.confirm !== true) throw new Error("confirm must be true to permanently delete an article.")
    const articleID = requireInteger(args, "article_id", 1, Number.MAX_SAFE_INTEGER)
    const payload = await bilibiliRequest("POST", "/arcopen/fn/article/delete", {
      multipart: { fields: { id: articleID } }
    })
    return jsonResult({ deleted: true, article_id: articleID, response: payload })
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
            serverInfo: { name: "bilibili-creator", version: "0.1.0" }
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
  buildMultipartBody,
  callTool,
  collectMetricSnapshot,
  tools
}
