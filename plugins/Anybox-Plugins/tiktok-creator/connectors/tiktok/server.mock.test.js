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
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "tiktok-creator-mock-"))
  process.env.TIKTOK_ACCESS_TOKEN = "mock-tiktok-access"
  process.env.TIKTOK_API_BASE_URL = "https://tiktok.mock.test/v2"
  process.env.TIKTOK_ALLOWED_UPLOAD_HOST = "upload.mock.test"
  originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch
  callTool = require("./server").callTool
})

after(async () => {
  globalThis.fetch = originalFetch
  await rm(temporaryDirectory, { recursive: true, force: true })
})

function tiktokResponse(data) {
  return new Response(JSON.stringify({
    data,
    error: { code: "ok", message: "", log_id: "mock-log" }
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  })
}

function mockVideos() {
  return [
    { id: "video-one", title: "One", view_count: 100, like_count: 10, comment_count: 3, share_count: 2 },
    { id: "video-two", title: "Two", view_count: 50, like_count: 5, comment_count: 1, share_count: 1 }
  ]
}

async function mockFetch(input, init = {}) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url)
  requests.push({ url, init })
  const method = String(init.method || "GET").toUpperCase()

  if (url.hostname === "tiktok.mock.test" && url.pathname.endsWith("/user/info/")) {
    return tiktokResponse({
      user: {
        open_id: "mock-open-id",
        display_name: "Mock TikTok Creator",
        follower_count: 500,
        following_count: 12,
        likes_count: 1000,
        video_count: 2
      }
    })
  }
  if (url.hostname === "tiktok.mock.test" && url.pathname.endsWith("/video/list/")) {
    return tiktokResponse({ videos: mockVideos(), cursor: 1234, has_more: false })
  }
  if (url.hostname === "tiktok.mock.test" && url.pathname.endsWith("/video/query/")) {
    return tiktokResponse({ videos: [mockVideos()[0]] })
  }
  if (url.hostname === "tiktok.mock.test" && url.pathname.endsWith("/creator_info/query/")) {
    return tiktokResponse({
      creator_username: "mockcreator",
      creator_nickname: "Mock TikTok Creator",
      privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
      comment_disabled: false,
      duet_disabled: false,
      stitch_disabled: true,
      max_video_post_duration_sec: 300
    })
  }
  if (url.hostname === "tiktok.mock.test" && url.pathname.endsWith("/inbox/video/init/")) {
    return tiktokResponse({ publish_id: "draft-publish", upload_url: "https://upload.mock.test/draft" })
  }
  if (url.hostname === "tiktok.mock.test" && url.pathname.endsWith("/publish/video/init/")) {
    return tiktokResponse({ publish_id: "direct-publish", upload_url: "https://upload.mock.test/direct" })
  }
  if (url.hostname === "tiktok.mock.test" && url.pathname.endsWith("/status/fetch/")) {
    return tiktokResponse({ status: "PUBLISH_COMPLETE", publicly_available_post_id: [987654321] })
  }
  if (url.hostname === "tiktok.mock.test" && url.pathname.endsWith("/publish/cancel/")) {
    return tiktokResponse({})
  }
  if (url.hostname === "upload.mock.test" && method === "PUT") {
    return new Response(null, { status: 201 })
  }

  throw new Error(`Unexpected mock request: ${method} ${url}`)
}

test("reads profile, bounded dashboard totals, and exact videos", async () => {
  requests.length = 0
  const auth = await callTool("tiktok_test_auth", {})
  assert.equal(auth.structuredContent.open_id, "mock-open-id")

  const dashboard = await callTool("tiktok_dashboard_summary", { max_pages: 2, include_items: true })
  assert.equal(dashboard.structuredContent.scanned_video_count, 2)
  assert.equal(dashboard.structuredContent.scanned_video_totals.views, 150)
  assert.equal(dashboard.structuredContent.truncated, false)

  const queried = await callTool("tiktok_video_query", { video_ids: ["video-one"] })
  assert.equal(queried.structuredContent.videos[0].id, "video-one")

  const apiRequests = requests.filter((request) => request.url.hostname === "tiktok.mock.test")
  for (const request of apiRequests) {
    assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer mock-tiktok-access")
  }
})

test("uploads a draft without forwarding OAuth to the media host", async () => {
  requests.length = 0
  const filePath = path.join(temporaryDirectory, "draft.mp4")
  await writeFile(filePath, Buffer.from("draft video"))
  const result = await callTool("tiktok_video_upload_draft", { file_path: filePath, confirm: true })
  assert.equal(result.structuredContent.publish_id, "draft-publish")
  assert.equal(result.structuredContent.publish_type, "INBOX_SHARE")
  assert.match(result.structuredContent.next_step, /inbox/i)

  const initRequest = requests.find((request) => request.url.pathname.endsWith("/inbox/video/init/"))
  assert.equal(JSON.parse(String(initRequest.init.body)).source_info.source, "FILE_UPLOAD")
  const uploadRequest = requests.find((request) => request.url.hostname === "upload.mock.test")
  assert.equal(new Headers(uploadRequest.init.headers).get("authorization"), null)
  assert.equal(new Headers(uploadRequest.init.headers).get("content-range"), "bytes 0-10/11")
})

test("rechecks creator constraints before Direct Post and exposes status", async () => {
  requests.length = 0
  const filePath = path.join(temporaryDirectory, "direct.mp4")
  await writeFile(filePath, Buffer.from("direct video"))
  const result = await callTool("tiktok_video_direct_post", {
    file_path: filePath,
    expected_creator_username: "mockcreator",
    duration_seconds: 60,
    title: "Editable caption #anybox",
    privacy_level: "PUBLIC_TO_EVERYONE",
    disable_comment: false,
    disable_duet: false,
    disable_stitch: false,
    confirm: true
  })
  assert.equal(result.structuredContent.publish_id, "direct-publish")
  assert.equal(result.structuredContent.creator.creator_username, "mockcreator")
  assert.equal(result.structuredContent.post_info.disable_stitch, true)

  const initRequest = requests.find((request) => request.url.pathname.endsWith("/publish/video/init/"))
  const body = JSON.parse(String(initRequest.init.body))
  assert.equal(body.post_info.title, "Editable caption #anybox")
  assert.equal(body.post_info.privacy_level, "PUBLIC_TO_EVERYONE")
  assert.equal(body.post_info.disable_stitch, true)

  const status = await callTool("tiktok_publish_status", { publish_id: "direct-publish" })
  assert.equal(status.structuredContent.status, "PUBLISH_COMPLETE")
  assert.deepEqual(status.structuredContent.publicly_available_post_id, [987654321])

  const cancelled = await callTool("tiktok_publish_cancel", { publish_id: "pending-publish", confirm: true })
  assert.equal(cancelled.structuredContent.cancelled, true)
})

test("stops Direct Post when the connected creator changed after confirmation", async () => {
  const filePath = path.join(temporaryDirectory, "mismatch.mp4")
  await writeFile(filePath, Buffer.from("mismatch"))
  await assert.rejects(
    callTool("tiktok_video_direct_post", {
      file_path: filePath,
      expected_creator_username: "someone-else",
      duration_seconds: 30,
      title: "Caption",
      privacy_level: "SELF_ONLY",
      confirm: true
    }),
    /Connected TikTok creator changed/
  )
})
