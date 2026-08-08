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
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "bilibili-creator-mock-"))
  process.env.BILIBILI_CLIENT_ID = "mock-client"
  process.env.BILIBILI_CLIENT_SECRET = "mock-secret"
  process.env.BILIBILI_ACCESS_TOKEN = "mock-access"
  process.env.BILIBILI_API_MODE = "sandbox"
  process.env.BILIBILI_MEMBER_BASE_URL = "https://member.mock.test"
  process.env.BILIBILI_UPLOAD_BASE_URL = "https://upload.mock.test"
  process.env.BILIBILI_DATA_DIR = temporaryDirectory
  originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch
  callTool = require("./server").callTool
})

after(async () => {
  globalThis.fetch = originalFetch
  await rm(temporaryDirectory, { recursive: true, force: true })
})

function response(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  })
}

async function mockFetch(input, init = {}) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url)
  requests.push({ url, init })
  const pathname = url.pathname

  if (url.hostname === "upload.mock.test") return response({ code: 0, message: "0" })
  if (pathname === "/mock/arcopen/fn/user/account/scopes") {
    return response({ code: 0, data: { scopes: ["USER_INFO", "USER_DATA", "ARC_BASE", "ARC_DATA", "ATC_BASE", "ATC_DATA"] } })
  }
  if (pathname === "/mock/arcopen/fn/data/user/account/info") {
    return response({ code: 0, data: { open_id: "mock-open-id", nickname: "Mock Creator" } })
  }
  if (pathname === "/mock/arcopen/fn/data/user/stat") {
    return response({ code: 0, data: { following: 12, follower: 345, arc_passed_total: 7 } })
  }
  if (pathname === "/mock/arcopen/fn/data/arc/inc-stats") {
    return response({ code: 0, data: { inc_click: 99, inc_like: 8, inc_fav: 7, inc_coin: 6, inc_share: 5, inc_reply: 4, inc_dm: 3 } })
  }
  if (pathname === "/mock/arcopen/fn/data/art/inc-stats") {
    return response({ code: 0, data: { inc_read: 44, inc_likes: 5, inc_fav: 4, inc_coin: 3, inc_share: 2, inc_reply: 1 } })
  }
  if (pathname === "/mock/arcopen/fn/archive/viewlist") {
    return response({ code: 0, data: { list: [{ resource_id: "video-one", title: "One" }], page: { pn: 1, ps: 2, total: 1 } } })
  }
  if (pathname === "/mock/arcopen/fn/data/arc/stat") {
    return response({ code: 0, data: { view: 30, like: 4, favorite: 3, coin: 2, share: 1, reply: 6, danmaku: 5 } })
  }
  if (pathname === "/mock/arcopen/fn/archive/video/init") {
    return response({ code: 0, data: { upload_token: "mock-upload-token" } })
  }
  if (pathname === "/mock/arcopen/fn/archive/add-by-utoken") {
    return response({ code: 0, data: { resource_id: "published-video" } })
  }
  if (pathname === "/mock/arcopen/fn/article/add") {
    return response({ code: 0, data: { id: 24680 } })
  }
  throw new Error(`Unexpected mock URL: ${url}`)
}

test("uses signed sandbox endpoints for dashboard aggregation", async () => {
  requests.length = 0
  const result = await callTool("bilibili_dashboard_summary", {
    page_size: 2,
    max_pages: 1,
    include_items: true
  })
  assert.equal(result.isError, false)
  assert.equal(result.structuredContent.lifetime_totals_for_scanned_videos.plays, 30)
  assert.equal(result.structuredContent.account.statistics.follower, 345)
  assert.equal(result.structuredContent.video_30d.inc_click, 99)
  assert.equal(result.structuredContent.truncated, false)

  const signedRequests = requests.filter((request) => request.url.hostname === "member.mock.test")
  assert.ok(signedRequests.length >= 7)
  for (const request of signedRequests) {
    const headers = new Headers(request.init.headers)
    assert.equal(headers.get("access-token"), "mock-access")
    assert.match(headers.get("authorization"), /^[a-f0-9]{64}$/)
    assert.equal(headers.get("x-bili-accesskeyid"), "mock-client")
    assert.match(request.url.pathname, /^\/mock\/arcopen\//)
  }
})

test("stores only minimal numeric snapshots and can clear them", async () => {
  const snapshot = await callTool("bilibili_metrics_snapshot", {})
  assert.equal(snapshot.structuredContent.snapshot.follower, 345)
  assert.equal(snapshot.structuredContent.snapshot.video_30d.plays, 99)
  assert.equal(JSON.stringify(snapshot.structuredContent.snapshot).includes("Mock Creator"), false)

  const history = await callTool("bilibili_metrics_history", { limit: 10 })
  assert.equal(history.structuredContent.total, 1)
  assert.equal(history.structuredContent.entries[0].article_30d.reads, 44)

  const cleared = await callTool("bilibili_metrics_clear", { confirm: true })
  assert.equal(cleared.structuredContent.deleted, true)
})

test("simulates small video and article publishing without external network access", async () => {
  requests.length = 0
  const videoPath = path.join(temporaryDirectory, "demo.mp4")
  await writeFile(videoPath, Buffer.from("mock video bytes"))
  const video = await callTool("bilibili_video_publish", {
    file_path: videoPath,
    title: "Mock video",
    category_id: 21,
    tags: ["测试", "Anybox"],
    copyright: 1
  })
  assert.equal(video.structuredContent.resource_id, "published-video")
  assert.equal(video.structuredContent.upload_mode, "single")
  const initRequest = requests.find((request) => request.url.pathname.endsWith("/archive/video/init"))
  assert.deepEqual(JSON.parse(String(initRequest.init.body)), { name: "demo.mp4", utype: "1" })
  assert.ok(requests.some((request) => request.url.hostname === "upload.mock.test" && request.url.pathname === "/video/v2/upload"))

  requests.length = 0
  const article = await callTool("bilibili_article_publish", {
    title: "Mock article",
    category_id: 1,
    summary: "Mock summary",
    content_html: `<p>${"正文".repeat(100)}</p>`,
    template_id: 5,
    original: true
  })
  assert.equal(article.structuredContent.article_id, 24680)
  const articleRequest = requests.find((request) => request.url.pathname.endsWith("/article/add"))
  const articleHeaders = new Headers(articleRequest.init.headers)
  assert.equal(articleHeaders.get("x-bili-content-md5"), "d41d8cd98f00b204e9800998ecf8427e")
  assert.match(articleRequest.init.body.toString("utf8"), /name="content"/)
})
