#!/usr/bin/env node

"use strict"

const readline = require("node:readline")
const path = require("node:path")
const { open, stat } = require("node:fs/promises")

const DEFAULT_DATA_API_BASE_URL = "https://www.googleapis.com/youtube/v3"
const DEFAULT_UPLOAD_API_BASE_URL = "https://www.googleapis.com/upload/youtube/v3"
const DEFAULT_ANALYTICS_API_BASE_URL = "https://youtubeanalytics.googleapis.com/v2"
const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024
const MAX_UPLOAD_RETRIES = 5

const ACCESS_TOKEN = (process.env.YOUTUBE_ACCESS_TOKEN || process.env.OAUTH_ACCESS_TOKEN || "").trim()
const DATA_API_BASE_URL = normalizeBaseUrl(process.env.YOUTUBE_DATA_API_BASE_URL || DEFAULT_DATA_API_BASE_URL)
const UPLOAD_API_BASE_URL = normalizeBaseUrl(process.env.YOUTUBE_UPLOAD_API_BASE_URL || DEFAULT_UPLOAD_API_BASE_URL)
const ANALYTICS_API_BASE_URL = normalizeBaseUrl(process.env.YOUTUBE_ANALYTICS_API_BASE_URL || DEFAULT_ANALYTICS_API_BASE_URL)

const tools = [
  tool("youtube_test_auth", "Test YouTube Auth", "Validate the OAuth session and identify the authorized YouTube channel.", {}, [], true),
  tool("youtube_channel_get", "Get YouTube Channel", "Read the authorized channel profile, statistics, status, and uploads playlist ID.", {}, [], true),
  tool("youtube_dashboard_summary", "Summarize YouTube Dashboard", "Return channel totals, recent videos, and a bounded YouTube Analytics summary.", {
    days: integer("Number of completed days to summarize. Defaults to 28.", 1, 366),
    recent_video_count: integer("Number of recent videos to include. Defaults to 10.", 1, 25),
    include_revenue: boolean("Include estimatedRevenue when the connected channel and OAuth app can access monetary reports.")
  }, [], true),
  tool("youtube_video_categories", "List YouTube Video Categories", "List assignable YouTube video categories for a region.", {
    region_code: string("ISO 3166-1 alpha-2 region code. Defaults to US.")
  }, [], true),
  tool("youtube_video_list", "List YouTube Videos", "List recent uploads for the authorized channel, optionally including current statistics and status.", {
    max_results: integer("Maximum videos to return. Defaults to 20.", 1, 50),
    page_token: string("Optional YouTube playlist page token."),
    include_statistics: boolean("Include statistics, content details, and privacy status. Defaults to true.")
  }, [], true),
  tool("youtube_video_get", "Get YouTube Video", "Read metadata, status, statistics, and content details for one owned or visible video.", {
    video_id: string("YouTube video ID.")
  }, ["video_id"], true),
  tool("youtube_video_upload", "Upload YouTube Video", "Create a resumable upload session, upload a local video in bounded chunks, and create a YouTube video.", {
    file_path: string("Absolute path to a local video file."),
    title: string("Video title, at most 100 characters."),
    description: stringAllowEmpty("Optional video description, at most 5000 characters."),
    category_id: string("YouTube category ID returned by youtube_video_categories."),
    tags: stringArray("Optional video tags.", 0),
    privacy_status: enumeration("Initial privacy status. Defaults to private.", ["private", "unlisted", "public"]),
    publish_at: string("Optional ISO 8601 scheduled publish time; privacy_status must be private."),
    made_for_kids: boolean("Set the self-declared made-for-kids status."),
    notify_subscribers: boolean("Notify subscribers. Defaults to false."),
    confirm: boolean("Must be true after the user explicitly confirms the target channel, file, metadata, and privacy status.")
  }, ["file_path", "title", "category_id", "confirm"], false),
  tool("youtube_video_update", "Update YouTube Video", "Safely read, merge, and update mutable metadata or status for one video.", {
    video_id: string("Exact YouTube video ID."),
    title: string("Optional replacement title, at most 100 characters."),
    description: stringAllowEmpty("Optional replacement description; an empty string clears it."),
    category_id: string("Optional replacement category ID."),
    tags: stringArray("Optional replacement tags; an empty array clears all tags.", 0),
    privacy_status: enumeration("Optional replacement privacy status.", ["private", "unlisted", "public"]),
    publish_at: string("Optional ISO 8601 scheduled publish time; forces private status."),
    made_for_kids: boolean("Optional self-declared made-for-kids status."),
    confirm: boolean("Must be true after the user confirms the exact video and changes.")
  }, ["video_id", "confirm"], false),
  tool("youtube_video_delete", "Delete YouTube Video", "Permanently delete one YouTube video. This cannot be undone.", {
    video_id: string("Exact YouTube video ID."),
    confirm: boolean("Must be true after the user explicitly confirms permanent deletion of this exact video ID.")
  }, ["video_id", "confirm"], false, true),
  tool("youtube_analytics_summary", "Summarize YouTube Analytics", "Query a channel-level activity and watch-time report for a date range.", {
    start_date: string("Start date in YYYY-MM-DD format. Defaults to 28 completed days ago."),
    end_date: string("End date in YYYY-MM-DD format. Defaults to yesterday."),
    include_revenue: boolean("Include estimatedRevenue when monetary reports are available.")
  }, [], true),
  tool("youtube_traffic_sources", "Get YouTube Traffic Sources", "Break down views and watch time by YouTube traffic-source type.", {
    start_date: string("Start date in YYYY-MM-DD format."),
    end_date: string("End date in YYYY-MM-DD format."),
    max_results: integer("Maximum source types to return. Defaults to 25.", 1, 200)
  }, [], true),
  tool("youtube_audience_demographics", "Get YouTube Audience Demographics", "Return available viewer-percentage rows by age group and gender.", {
    start_date: string("Start date in YYYY-MM-DD format."),
    end_date: string("End date in YYYY-MM-DD format.")
  }, [], true)
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

function stringArray(description, minItems = 1) {
  return {
    type: "array",
    minItems,
    items: { type: "string" },
    description
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value).trim())
  if (url.protocol !== "https:") throw new Error("YouTube API base URLs must use HTTPS.")
  return url.toString().replace(/\/$/, "")
}

function requireAccessToken() {
  if (!ACCESS_TOKEN) throw new Error("YouTube OAuth access token is missing. Connect the plugin before calling this tool.")
  return ACCESS_TOKEN
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

function optionalStringAllowEmpty(args, key) {
  const value = args?.[key]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`${key} must be a string.`)
  return value
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

function optionalStringArray(args, key) {
  const value = args?.[key]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${key} must be an array of non-empty strings.`)
  }
  return value.map((item) => item.trim())
}

function utf16Length(value) {
  return String(value).length
}

function assertMaxLength(value, key, maximum) {
  if (value !== undefined && utf16Length(value) > maximum) {
    throw new Error(`${key} must not exceed ${maximum} UTF-16 code units.`)
  }
}

function addQuery(url, query = {}) {
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value))
  }
}

function apiErrorMessage(payload, fallback) {
  const error = payload?.error
  if (typeof error === "string" && error.trim()) return error.trim()
  if (error && typeof error === "object") {
    const reason = error.errors?.[0]?.reason
    const message = error.message
    if (message && reason) return `${message} (${reason})`
    if (message) return String(message)
  }
  if (payload?.error_description) return String(payload.error_description)
  return fallback
}

async function parseResponse(response) {
  if (response.status === 204) return undefined
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

async function youtubeRequest(method, route, options = {}) {
  const url = new URL(`${DATA_API_BASE_URL}${route}`)
  addQuery(url, options.query)
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${requireAccessToken()}`,
    ...options.headers
  }
  if (options.body !== undefined) headers["Content-Type"] = "application/json; charset=UTF-8"
  const response = await fetch(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  })
  const payload = await parseResponse(response)
  if (!response.ok) throw new Error(apiErrorMessage(payload, `YouTube API request failed with HTTP ${response.status}.`))
  return payload
}

async function analyticsRequest(query) {
  const url = new URL(`${ANALYTICS_API_BASE_URL}/reports`)
  addQuery(url, query)
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${requireAccessToken()}`
    }
  })
  const payload = await parseResponse(response)
  if (!response.ok) throw new Error(apiErrorMessage(payload, `YouTube Analytics request failed with HTTP ${response.status}.`))
  return normalizeAnalyticsReport(payload)
}

function normalizeAnalyticsReport(payload) {
  const headers = Array.isArray(payload?.columnHeaders) ? payload.columnHeaders : []
  const rows = Array.isArray(payload?.rows) ? payload.rows : []
  return {
    kind: payload?.kind,
    column_headers: headers,
    rows,
    records: rows.map((row) => Object.fromEntries(headers.map((header, index) => [header.name, row[index]])))
  }
}

async function getAuthorizedChannel() {
  const payload = await youtubeRequest("GET", "/channels", {
    query: {
      part: "snippet,statistics,contentDetails,status",
      mine: "true"
    }
  })
  const channel = payload?.items?.[0]
  if (!channel) throw new Error("The connected Google account does not expose an authorized YouTube channel.")
  return channel
}

async function getVideo(videoID) {
  const payload = await youtubeRequest("GET", "/videos", {
    query: {
      part: "snippet,status,statistics,contentDetails",
      id: videoID
    }
  })
  const video = payload?.items?.[0]
  if (!video) throw new Error(`YouTube video '${videoID}' was not found or is not visible to the connected account.`)
  return video
}

async function listVideos(args, channel) {
  const currentChannel = channel || await getAuthorizedChannel()
  const uploadsPlaylistID = currentChannel?.contentDetails?.relatedPlaylists?.uploads
  if (!uploadsPlaylistID) throw new Error("The authorized channel did not return an uploads playlist ID.")
  const maxResults = optionalInteger(args, "max_results", 20, 1, 50)
  const includeStatistics = optionalBoolean(args, "include_statistics", true)
  const playlist = await youtubeRequest("GET", "/playlistItems", {
    query: {
      part: "snippet,contentDetails,status",
      playlistId: uploadsPlaylistID,
      maxResults,
      pageToken: optionalString(args, "page_token")
    }
  })
  const playlistItems = Array.isArray(playlist?.items) ? playlist.items : []
  if (!includeStatistics || playlistItems.length === 0) {
    return {
      channel_id: currentChannel.id,
      uploads_playlist_id: uploadsPlaylistID,
      next_page_token: playlist?.nextPageToken,
      prev_page_token: playlist?.prevPageToken,
      page_info: playlist?.pageInfo,
      items: playlistItems
    }
  }
  const videoIDs = playlistItems.map((item) => item?.contentDetails?.videoId).filter(Boolean)
  const details = await youtubeRequest("GET", "/videos", {
    query: {
      part: "snippet,status,statistics,contentDetails",
      id: videoIDs.join(",")
    }
  })
  const byID = new Map((details?.items || []).map((item) => [item.id, item]))
  return {
    channel_id: currentChannel.id,
    uploads_playlist_id: uploadsPlaylistID,
    next_page_token: playlist?.nextPageToken,
    prev_page_token: playlist?.prevPageToken,
    page_info: playlist?.pageInfo,
    items: videoIDs.map((id) => byID.get(id)).filter(Boolean)
  }
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

function parseDate(value, key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${key} must use YYYY-MM-DD format.`)
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || isoDate(date) !== value) throw new Error(`${key} is not a valid date.`)
  return date
}

function resolveDateRange(args, fallbackDays = 28) {
  const endValue = optionalString(args, "end_date")
  const startValue = optionalString(args, "start_date")
  const end = endValue ? parseDate(endValue, "end_date") : new Date(Date.now() - 24 * 60 * 60 * 1000)
  end.setUTCHours(0, 0, 0, 0)
  const start = startValue ? parseDate(startValue, "start_date") : new Date(end.getTime() - (fallbackDays - 1) * 24 * 60 * 60 * 1000)
  if (start > end) throw new Error("start_date must be on or before end_date.")
  const span = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
  if (span > 366) throw new Error("Analytics date ranges must not exceed 366 days in this plugin version.")
  return { startDate: isoDate(start), endDate: isoDate(end), days: span }
}

async function analyticsSummary(args = {}) {
  const range = resolveDateRange(args)
  const metrics = [
    "views",
    "estimatedMinutesWatched",
    "averageViewDuration",
    "likes",
    "comments",
    "shares",
    "subscribersGained",
    "subscribersLost"
  ]
  if (optionalBoolean(args, "include_revenue", false)) metrics.push("estimatedRevenue")
  return {
    start_date: range.startDate,
    end_date: range.endDate,
    days: range.days,
    report: await analyticsRequest({
      ids: "channel==MINE",
      startDate: range.startDate,
      endDate: range.endDate,
      metrics: metrics.join(",")
    })
  }
}

async function dashboardSummary(args) {
  const days = optionalInteger(args, "days", 28, 1, 366)
  const recentVideoCount = optionalInteger(args, "recent_video_count", 10, 1, 25)
  const channel = await getAuthorizedChannel()
  const end = new Date(Date.now() - 24 * 60 * 60 * 1000)
  end.setUTCHours(0, 0, 0, 0)
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000)
  const [videos, analytics] = await Promise.all([
    listVideos({ max_results: recentVideoCount, include_statistics: true }, channel),
    analyticsSummary({
      start_date: isoDate(start),
      end_date: isoDate(end),
      include_revenue: optionalBoolean(args, "include_revenue", false)
    })
  ])
  return {
    channel,
    recent_videos: videos,
    analytics
  }
}

function contentTypeForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return ({
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg"
  })[extension] || "application/octet-stream"
}

async function inspectUploadFile(filePath) {
  if (!path.isAbsolute(filePath)) throw new Error("file_path must be an absolute path.")
  const metadata = await stat(filePath)
  if (!metadata.isFile()) throw new Error("file_path must point to a regular file.")
  if (metadata.size <= 0) throw new Error("file_path must not be empty.")
  if (!Number.isSafeInteger(metadata.size)) throw new Error("Video file size exceeds the safe range supported by this runtime.")
  return {
    path: filePath,
    size: metadata.size,
    contentType: contentTypeForFile(filePath)
  }
}

function assertAllowedUploadURL(value) {
  const url = new URL(value)
  const configuredHost = new URL(UPLOAD_API_BASE_URL).hostname
  const allowed = url.protocol === "https:" && (url.hostname === configuredHost || url.hostname.endsWith(".googleapis.com"))
  if (!allowed) throw new Error("YouTube returned an unexpected resumable upload URL; refusing to send the OAuth token or file.")
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

function nextOffsetFromRange(range, fallback) {
  const match = /bytes=0-(\d+)/i.exec(range || "")
  return match ? Number(match[1]) + 1 : fallback
}

async function uploadStatus(uploadURL, totalSize) {
  const response = await fetch(uploadURL, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${requireAccessToken()}`,
      "Content-Length": "0",
      "Content-Range": `bytes */${totalSize}`
    }
  })
  if (response.status === 308) return { complete: false, offset: nextOffsetFromRange(response.headers.get("range"), 0) }
  const payload = await parseResponse(response)
  if (response.ok) return { complete: true, payload }
  throw new Error(apiErrorMessage(payload, `YouTube upload status check failed with HTTP ${response.status}.`))
}

async function uploadChunks(uploadURL, file) {
  const handle = await open(file.path, "r")
  let offset = 0
  try {
    while (offset < file.size) {
      const length = Math.min(UPLOAD_CHUNK_SIZE, file.size - offset)
      const chunk = await readChunk(handle, offset, length)
      let attempt = 0
      while (true) {
        try {
          const last = offset + length - 1
          const response = await fetch(uploadURL, {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${requireAccessToken()}`,
              "Content-Type": file.contentType,
              "Content-Length": String(length),
              "Content-Range": `bytes ${offset}-${last}/${file.size}`
            },
            body: chunk
          })
          if (response.status === 308) {
            offset = nextOffsetFromRange(response.headers.get("range"), offset + length)
            break
          }
          const payload = await parseResponse(response)
          if (response.ok) return payload
          if (![500, 502, 503, 504].includes(response.status)) {
            const error = new Error(apiErrorMessage(payload, `YouTube video upload failed with HTTP ${response.status}.`))
            error.youtubeUploadPermanent = true
            throw error
          }
          throw new Error(`Retriable YouTube upload response: HTTP ${response.status}.`)
        } catch (error) {
          if (error?.youtubeUploadPermanent === true) throw error
          attempt += 1
          if (attempt > MAX_UPLOAD_RETRIES) throw error
          const status = await uploadStatus(uploadURL, file.size)
          if (status.complete) return status.payload
          if (status.offset !== offset) {
            offset = status.offset
            break
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(250 * 2 ** attempt, 4000)))
        }
      }
    }
  } finally {
    await handle.close()
  }
  throw new Error("YouTube upload ended without a completed video response.")
}

async function uploadVideo(args) {
  if (args.confirm !== true) throw new Error("confirm must be true before uploading a YouTube video.")
  const filePath = requireString(args, "file_path")
  const title = requireString(args, "title")
  const description = optionalStringAllowEmpty(args, "description") || ""
  const categoryID = requireString(args, "category_id")
  const privacyStatus = optionalEnum(args, "privacy_status", ["private", "unlisted", "public"], "private")
  const publishAt = optionalString(args, "publish_at")
  assertMaxLength(title, "title", 100)
  assertMaxLength(description, "description", 5000)
  if (!/^\d+$/.test(categoryID)) throw new Error("category_id must be numeric.")
  if (publishAt) {
    const publishTime = new Date(publishAt)
    if (Number.isNaN(publishTime.getTime())) throw new Error("publish_at must be a valid ISO 8601 timestamp.")
    if (privacyStatus !== "private") throw new Error("Scheduled publishing requires privacy_status=private.")
  }
  const tags = optionalStringArray(args, "tags")
  const file = await inspectUploadFile(filePath)
  const body = {
    snippet: {
      title,
      description,
      categoryId: categoryID,
      ...(tags ? { tags } : {})
    },
    status: {
      privacyStatus,
      ...(publishAt ? { publishAt } : {}),
      ...(args.made_for_kids === undefined ? {} : { selfDeclaredMadeForKids: optionalBoolean(args, "made_for_kids") })
    }
  }
  const url = new URL(`${UPLOAD_API_BASE_URL}/videos`)
  addQuery(url, {
    uploadType: "resumable",
    part: "snippet,status",
    notifySubscribers: optionalBoolean(args, "notify_subscribers", false)
  })
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${requireAccessToken()}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(file.size),
      "X-Upload-Content-Type": file.contentType
    },
    body: JSON.stringify(body)
  })
  const errorPayload = response.ok ? undefined : await parseResponse(response)
  if (!response.ok) throw new Error(apiErrorMessage(errorPayload, `Could not start YouTube upload: HTTP ${response.status}.`))
  const location = response.headers.get("location")
  if (!location) throw new Error("YouTube did not return a resumable upload Location header.")
  const video = await uploadChunks(assertAllowedUploadURL(location), file)
  return {
    uploaded: true,
    file_name: path.basename(file.path),
    file_size: file.size,
    video
  }
}

async function updateVideo(args) {
  if (args.confirm !== true) throw new Error("confirm must be true before updating a YouTube video.")
  const videoID = requireString(args, "video_id")
  const snippetChanged = ["title", "description", "category_id", "tags"].some((key) => args[key] !== undefined)
  const statusChanged = ["privacy_status", "publish_at", "made_for_kids"].some((key) => args[key] !== undefined)
  if (!snippetChanged && !statusChanged) throw new Error("At least one mutable video field must be supplied.")
  const current = await getVideo(videoID)
  const body = { id: videoID }
  const parts = []

  if (snippetChanged) {
    const title = args.title === undefined ? current.snippet?.title : requireString(args, "title")
    const description = args.description === undefined ? current.snippet?.description || "" : optionalStringAllowEmpty(args, "description")
    const categoryID = args.category_id === undefined ? current.snippet?.categoryId : requireString(args, "category_id")
    const tags = args.tags === undefined ? current.snippet?.tags : optionalStringArray(args, "tags")
    assertMaxLength(title, "title", 100)
    assertMaxLength(description, "description", 5000)
    if (!/^\d+$/.test(String(categoryID || ""))) throw new Error("category_id must be numeric.")
    body.snippet = {
      title,
      description,
      categoryId: String(categoryID),
      ...(tags === undefined ? {} : { tags }),
      ...(current.snippet?.defaultLanguage ? { defaultLanguage: current.snippet.defaultLanguage } : {})
    }
    parts.push("snippet")
  }

  if (statusChanged) {
    const currentStatus = current.status || {}
    const requestedPublishAt = optionalString(args, "publish_at")
    let privacyStatus = optionalEnum(args, "privacy_status", ["private", "unlisted", "public"], currentStatus.privacyStatus || "private")
    let publishAt = args.publish_at === undefined ? currentStatus.publishAt : requestedPublishAt
    if (requestedPublishAt) {
      const publishTime = new Date(requestedPublishAt)
      if (Number.isNaN(publishTime.getTime())) throw new Error("publish_at must be a valid ISO 8601 timestamp.")
      privacyStatus = "private"
    }
    if (args.privacy_status !== undefined && privacyStatus !== "private") publishAt = undefined
    const selfDeclaredMadeForKids = args.made_for_kids === undefined
      ? currentStatus.selfDeclaredMadeForKids
      : optionalBoolean(args, "made_for_kids")
    body.status = {
      privacyStatus,
      ...(publishAt ? { publishAt } : {}),
      ...(typeof currentStatus.embeddable === "boolean" ? { embeddable: currentStatus.embeddable } : {}),
      ...(typeof currentStatus.license === "string" ? { license: currentStatus.license } : {}),
      ...(typeof currentStatus.publicStatsViewable === "boolean" ? { publicStatsViewable: currentStatus.publicStatsViewable } : {}),
      ...(typeof selfDeclaredMadeForKids === "boolean" ? { selfDeclaredMadeForKids } : {}),
      ...(typeof currentStatus.containsSyntheticMedia === "boolean" ? { containsSyntheticMedia: currentStatus.containsSyntheticMedia } : {})
    }
    parts.push("status")
  }

  return await youtubeRequest("PUT", "/videos", {
    query: { part: parts.join(",") },
    body
  })
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

  if (name === "youtube_test_auth") {
    const channel = await getAuthorizedChannel()
    return jsonResult({ ok: true, channel_id: channel.id, channel_title: channel.snippet?.title })
  }
  if (name === "youtube_channel_get") return jsonResult(await getAuthorizedChannel())
  if (name === "youtube_dashboard_summary") return jsonResult(await dashboardSummary(args))
  if (name === "youtube_video_categories") {
    const regionCode = (optionalString(args, "region_code") || "US").toUpperCase()
    if (!/^[A-Z]{2}$/.test(regionCode)) throw new Error("region_code must be a two-letter country code.")
    return jsonResult(await youtubeRequest("GET", "/videoCategories", {
      query: { part: "snippet", regionCode }
    }))
  }
  if (name === "youtube_video_list") return jsonResult(await listVideos(args))
  if (name === "youtube_video_get") return jsonResult(await getVideo(requireString(args, "video_id")))
  if (name === "youtube_video_upload") return jsonResult(await uploadVideo(args))
  if (name === "youtube_video_update") return jsonResult(await updateVideo(args))
  if (name === "youtube_video_delete") {
    if (args.confirm !== true) throw new Error("confirm must be true to permanently delete a YouTube video.")
    const videoID = requireString(args, "video_id")
    await youtubeRequest("DELETE", "/videos", { query: { id: videoID } })
    return jsonResult({ deleted: true, video_id: videoID })
  }
  if (name === "youtube_analytics_summary") return jsonResult(await analyticsSummary(args))
  if (name === "youtube_traffic_sources") {
    const range = resolveDateRange(args)
    return jsonResult({
      start_date: range.startDate,
      end_date: range.endDate,
      report: await analyticsRequest({
        ids: "channel==MINE",
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: "insightTrafficSourceType",
        metrics: "views,estimatedMinutesWatched",
        sort: "-views",
        maxResults: optionalInteger(args, "max_results", 25, 1, 200)
      })
    })
  }
  if (name === "youtube_audience_demographics") {
    const range = resolveDateRange(args)
    return jsonResult({
      start_date: range.startDate,
      end_date: range.endDate,
      report: await analyticsRequest({
        ids: "channel==MINE",
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: "ageGroup,gender",
        metrics: "viewerPercentage",
        sort: "ageGroup,gender"
      })
    })
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
            serverInfo: { name: "youtube-creator", version: "0.1.0" }
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
  callTool,
  tools
}
