"use strict"

const assert = require("node:assert/strict")
const test = require("node:test")
const { createBilibiliHeaders, md5Hex } = require("./signer")

test("creates deterministic Bilibili HMAC headers", () => {
  const headers = createBilibiliHeaders({
    clientID: "client-id",
    clientSecret: "client-secret",
    accessToken: "access-token",
    body: '{"name":"demo.mp4","utype":"1"}',
    contentType: "application/json",
    timestamp: 1730188313,
    nonce: "1730188313961222000"
  })

  assert.equal(headers["X-Bili-Content-Md5"], md5Hex('{"name":"demo.mp4","utype":"1"}'))
  assert.equal(headers["X-Bili-Timestamp"], "1730188313")
  assert.equal(headers["Access-Token"], "access-token")
  assert.equal(headers.Authorization, "4325b082bce699c065310213ee8cd372622f822cf029f25d0a6ab6771fbfa61c")
})

test("allows multipart requests to sign the documented empty non-file body", () => {
  const headers = createBilibiliHeaders({
    clientID: "client-id",
    clientSecret: "client-secret",
    accessToken: "access-token",
    body: Buffer.from("multipart bytes"),
    bodyForMD5: "",
    timestamp: 1,
    nonce: "nonce"
  })

  assert.equal(headers["X-Bili-Content-Md5"], "d41d8cd98f00b204e9800998ecf8427e")
})
