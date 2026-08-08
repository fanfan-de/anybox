"use strict"

const assert = require("node:assert/strict")
const test = require("node:test")
const { buildTikTokChunkPlan, callTool, tools } = require("./server")

test("exposes the initial TikTok creator tool surface with safety hints", () => {
  assert.equal(tools.length, 10)
  assert.equal(new Set(tools.map((item) => item.name)).size, tools.length)
  assert.equal(tools.find((item) => item.name === "tiktok_publish_cancel")?.annotations.destructiveHint, true)
  assert.equal(tools.find((item) => item.name === "tiktok_video_direct_post")?.annotations.readOnlyHint, false)
  assert.equal(tools.find((item) => item.name === "tiktok_creator_info")?.annotations.readOnlyHint, true)
})

test("uses TikTok-compatible chunk planning", () => {
  assert.deepEqual(buildTikTokChunkPlan(4 * 1024 * 1024), {
    chunkSize: 4 * 1024 * 1024,
    totalChunkCount: 1
  })
  assert.deepEqual(buildTikTokChunkPlan(100 * 1024 * 1024), {
    chunkSize: 32 * 1024 * 1024,
    totalChunkCount: 3
  })
})

test("refuses uploads, posts, and cancellation without confirmation before filesystem or network access", async () => {
  await assert.rejects(
    callTool("tiktok_video_upload_draft", { file_path: "C:\\missing.mp4", confirm: false }),
    /confirm must be true/
  )
  await assert.rejects(
    callTool("tiktok_video_direct_post", {
      file_path: "C:\\missing.mp4",
      expected_creator_username: "creator",
      duration_seconds: 10,
      title: "Test",
      privacy_level: "SELF_ONLY",
      confirm: false
    }),
    /confirm must be true/
  )
  await assert.rejects(
    callTool("tiktok_publish_cancel", { publish_id: "publish-one", confirm: false }),
    /confirm must be true/
  )
})
