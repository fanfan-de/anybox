"use strict"

const assert = require("node:assert/strict")
const test = require("node:test")
const { buildMultipartBody, callTool, tools } = require("./server")

test("exposes the V1 creator tool surface with destructive hints", () => {
  assert.equal(tools.length, 19)
  assert.equal(new Set(tools.map((item) => item.name)).size, tools.length)
  assert.equal(tools.find((item) => item.name === "bilibili_video_delete")?.annotations.destructiveHint, true)
  assert.equal(tools.find((item) => item.name === "bilibili_article_delete")?.annotations.destructiveHint, true)
  assert.equal(tools.find((item) => item.name === "bilibili_metrics_clear")?.annotations.destructiveHint, true)
  assert.equal(tools.find((item) => item.name === "bilibili_dashboard_summary")?.annotations.readOnlyHint, true)
})

test("refuses destructive calls without exact confirmation before network access", async () => {
  await assert.rejects(
    callTool("bilibili_video_delete", { resource_id: "video-resource", confirm: false }),
    /confirm must be true/
  )
  await assert.rejects(
    callTool("bilibili_article_delete", { article_id: 123, confirm: false }),
    /confirm must be true/
  )
})

test("builds deterministic-shape multipart bodies without leaking file paths", async () => {
  const multipart = await buildMultipartBody(
    { title: "测试标题", category: 1 },
    { field: "file", name: "cover.png", contentType: "image/png", data: Buffer.from("png") }
  )
  const body = multipart.body.toString("utf8")
  assert.match(multipart.contentType, /^multipart\/form-data; boundary=/)
  assert.match(body, /name="title"/)
  assert.match(body, /测试标题/)
  assert.match(body, /filename="cover.png"/)
  assert.doesNotMatch(body, /C:\\|\/home\//)
})
