"use strict"

const assert = require("node:assert/strict")
const { after, before, test } = require("node:test")
const { mkdtemp, rm, writeFile } = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")

let callTool
let temporaryDirectory
let originalFetch
const requests = []

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "youtube-creator-mock-"))
  process.env.YOUTUBE_ACCESS_TOKEN = "mock-youtube-access"
  process.env.YOUTUBE_DATA_API_BASE_URL = "https://youtube.mock.test/youtube/v3"
  process.env.YOUTUBE_UPLOAD_API_BASE_URL = "https://upload.mock.test/upload/youtube/v3"
  process.env.YOUTUBE_ANALYTICS_API_BASE_URL = "https://analytics.mock.test/v2"
  originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch
  callTool = require("./server").callTool
})

after(async () => {
  globalThis.fetch = originalFetch
  await rm(temporaryDirectory, { recursive: true, force: true })
})

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) }
  })
}

function channelPayload() {
  return {
    items: [{
      id: "UCmock",
      snippet: { title: "Mock YouTube Creator" },
      statistics: { subscriberCount: "1234", viewCount: "56789", videoCount: "2" },
      contentDetails: { relatedPlaylists: { uploads: "UUuploads" } },
      status: { privacyStatus: "public" }
    }]
  }
}

function video(id, title) {
  return {
    id,
    snippet: { title, description: "Existing description", categoryId: "22", tags: ["Anybox"] },
    status: {
      privacyStatus: "private",
      embeddable: false,
      license: "creativeCommon",
      publicStatsViewable: false,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true
    },
    statistics: { viewCount: id === "video-one" ? "100" : "50" },
    contentDetails: { duration: "PT1M" }
  }
}

async function mockFetch(input, init = {}) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url)
  requests.push({ url, init })
  const method = String(init.method || "GET").toUpperCase()

  if (url.hostname === "youtube.mock.test" && url.pathname.endsWith("/channels")) return jsonResponse(channelPayload())
  if (url.hostname === "youtube.mock.test" && url.pathname.endsWith("/playlistItems")) {
    return jsonResponse({
      items: [
        { contentDetails: { videoId: "video-one" }, snippet: { title: "One" } },
        { contentDetails: { videoId: "video-two" }, snippet: { title: "Two" } }
      ],
      pageInfo: { totalResults: 2, resultsPerPage: 20 }
    })
  }
  if (url.hostname === "youtube.mock.test" && url.pathname.endsWith("/videoCategories")) {
    return jsonResponse({ items: [{ id: "22", snippet: { title: "People & Blogs", assignable: true } }] })
  }
  if (url.hostname === "youtube.mock.test" && url.pathname.endsWith("/videos") && method === "GET") {
    const ids = (url.searchParams.get("id") || "").split(",")
    return jsonResponse({ items: ids.filter(Boolean).map((id) => video(id, id === "video-one" ? "One" : "Two")) })
  }
  if (url.hostname === "youtube.mock.test" && url.pathname.endsWith("/videos") && method === "PUT") {
    return jsonResponse({ ...JSON.parse(String(init.body)), updated: true })
  }
  if (url.hostname === "youtube.mock.test" && url.pathname.endsWith("/videos") && method === "DELETE") {
    return new Response(null, { status: 204 })
  }
  if (url.hostname === "analytics.mock.test" && url.pathname.endsWith("/reports")) {
    const dimensions = (url.searchParams.get("dimensions") || "").split(",").filter(Boolean)
    const metrics = (url.searchParams.get("metrics") || "").split(",").filter(Boolean)
    const headers = [
      ...dimensions.map((name) => ({ name, columnType: "DIMENSION", dataType: "STRING" })),
      ...metrics.map((name) => ({ name, columnType: "METRIC", dataType: "INTEGER" }))
    ]
    const dimensionValues = dimensions.map((name) => name === "ageGroup" ? "age25-34" : name === "gender" ? "female" : "YT_SEARCH")
    const metricValues = metrics.map((name) => name === "estimatedRevenue" ? 12.34 : name === "viewerPercentage" ? 42.5 : 100)
    return jsonResponse({ kind: "youtubeAnalytics#resultTable", columnHeaders: headers, rows: [[...dimensionValues, ...metricValues]] })
  }
  if (url.hostname === "upload.mock.test" && url.pathname.endsWith("/videos") && method === "POST") {
    return new Response(null, {
      status: 200,
      headers: { location: "https://upload.mock.test/resumable/mock-session" }
    })
  }
  if (url.hostname === "upload.mock.test" && url.pathname === "/resumable/mock-session" && method === "PUT") {
    return jsonResponse(video("uploaded-video", "Uploaded"), { status: 201 })
  }

  throw new Error(`Unexpected mock request: ${method} ${url}`)
}

test("reads the authorized channel and recent videos", async () => {
  requests.length = 0
  const auth = await callTool("youtube_test_auth", {})
  assert.equal(auth.structuredContent.channel_id, "UCmock")

  const listed = await callTool("youtube_video_list", { max_results: 20, include_statistics: true })
  assert.equal(listed.structuredContent.items.length, 2)
  assert.equal(listed.structuredContent.items[0].statistics.viewCount, "100")
  const authorized = requests.filter((request) => request.url.hostname === "youtube.mock.test")
  assert.ok(authorized.length >= 4)
  for (const request of authorized) {
    assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer mock-youtube-access")
  }
})

test("normalizes analytics rows for summaries, traffic sources, and demographics", async () => {
  const summary = await callTool("youtube_analytics_summary", {
    start_date: "2026-07-01",
    end_date: "2026-07-28",
    include_revenue: true
  })
  assert.equal(summary.structuredContent.report.records[0].estimatedRevenue, 12.34)

  const traffic = await callTool("youtube_traffic_sources", {
    start_date: "2026-07-01",
    end_date: "2026-07-28"
  })
  assert.equal(traffic.structuredContent.report.records[0].insightTrafficSourceType, "YT_SEARCH")

  const demographics = await callTool("youtube_audience_demographics", {
    start_date: "2026-07-01",
    end_date: "2026-07-28"
  })
  assert.equal(demographics.structuredContent.report.records[0].ageGroup, "age25-34")
  assert.equal(demographics.structuredContent.report.records[0].viewerPercentage, 42.5)
})

test("uploads in a resumable session, safely merges updates, and deletes only after confirmation", async () => {
  requests.length = 0
  const filePath = path.join(temporaryDirectory, "demo.mp4")
  await writeFile(filePath, Buffer.from("mock video bytes"))
  const uploaded = await callTool("youtube_video_upload", {
    file_path: filePath,
    title: "Uploaded",
    description: "Initial description",
    category_id: "22",
    tags: ["Anybox", "YouTube"],
    privacy_status: "private",
    notify_subscribers: false,
    confirm: true
  })
  assert.equal(uploaded.structuredContent.video.id, "uploaded-video")
  const initRequest = requests.find((request) => request.url.hostname === "upload.mock.test" && request.url.pathname.endsWith("/videos"))
  assert.equal(JSON.parse(String(initRequest.init.body)).snippet.title, "Uploaded")
  const chunkRequest = requests.find((request) => request.url.pathname === "/resumable/mock-session")
  assert.equal(new Headers(chunkRequest.init.headers).get("content-range"), "bytes 0-15/16")

  const updated = await callTool("youtube_video_update", {
    video_id: "video-one",
    title: "Updated title",
    description: "",
    privacy_status: "unlisted",
    confirm: true
  })
  assert.equal(updated.structuredContent.snippet.title, "Updated title")
  assert.equal(updated.structuredContent.snippet.categoryId, "22")
  assert.equal(updated.structuredContent.snippet.description, "")
  assert.equal(updated.structuredContent.status.privacyStatus, "unlisted")
  assert.equal(updated.structuredContent.status.embeddable, false)
  assert.equal(updated.structuredContent.status.license, "creativeCommon")
  assert.equal(updated.structuredContent.status.publicStatsViewable, false)
  assert.equal(updated.structuredContent.status.selfDeclaredMadeForKids, false)
  assert.equal(updated.structuredContent.status.containsSyntheticMedia, true)

  const deleted = await callTool("youtube_video_delete", { video_id: "video-one", confirm: true })
  assert.equal(deleted.structuredContent.deleted, true)
})

test("does not retry a permanent resumable upload failure", async () => {
  const filePath = path.join(temporaryDirectory, "permanent-failure.mp4")
  await writeFile(filePath, Buffer.from("permanent failure"))
  let uploadRequests = 0
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url)
    const method = String(init.method || "GET").toUpperCase()
    if (url.hostname === "upload.mock.test" && url.pathname.endsWith("/videos") && method === "POST") {
      return new Response(null, {
        status: 200,
        headers: { location: "https://upload.mock.test/resumable/permanent-failure" }
      })
    }
    if (url.hostname === "upload.mock.test" && url.pathname === "/resumable/permanent-failure" && method === "PUT") {
      uploadRequests += 1
      return jsonResponse({ error: { message: "The upload is forbidden.", errors: [{ reason: "forbidden" }] } }, { status: 403 })
    }
    return mockFetch(input, init)
  }
  try {
    await assert.rejects(
      callTool("youtube_video_upload", {
        file_path: filePath,
        title: "Permanent failure",
        category_id: "22",
        confirm: true
      }),
      /forbidden/i
    )
    assert.equal(uploadRequests, 1)
  } finally {
    globalThis.fetch = mockFetch
  }
})
