"use strict"

const assert = require("node:assert/strict")
const test = require("node:test")
const { callTool, tools } = require("./server")

test("exposes the initial YouTube creator tool surface with safety hints", () => {
  assert.equal(tools.length, 12)
  assert.equal(new Set(tools.map((item) => item.name)).size, tools.length)
  assert.equal(tools.find((item) => item.name === "youtube_video_delete")?.annotations.destructiveHint, true)
  assert.equal(tools.find((item) => item.name === "youtube_video_upload")?.annotations.readOnlyHint, false)
  assert.equal(tools.find((item) => item.name === "youtube_analytics_summary")?.annotations.readOnlyHint, true)
})

test("refuses external writes without exact confirmation before filesystem or network access", async () => {
  await assert.rejects(
    callTool("youtube_video_upload", { file_path: "C:\\missing.mp4", title: "Test", category_id: "22", confirm: false }),
    /confirm must be true/
  )
  await assert.rejects(
    callTool("youtube_video_update", { video_id: "video-one", title: "Changed", confirm: false }),
    /confirm must be true/
  )
  await assert.rejects(
    callTool("youtube_video_delete", { video_id: "video-one", confirm: false }),
    /confirm must be true/
  )
})
