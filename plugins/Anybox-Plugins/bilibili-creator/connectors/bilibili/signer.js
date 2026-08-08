"use strict"

const { createHash, createHmac, randomUUID } = require("node:crypto")

function md5Hex(value) {
  return createHash("md5").update(value ?? "").digest("hex")
}

function createBilibiliHeaders(input) {
  const clientID = String(input.clientID || "").trim()
  const clientSecret = String(input.clientSecret || "").trim()
  const accessToken = String(input.accessToken || "").trim()
  if (!clientID) throw new Error("BILIBILI_CLIENT_ID is not configured.")
  if (!clientSecret) throw new Error("BILIBILI_CLIENT_SECRET is not configured.")
  if (!accessToken) throw new Error("BILIBILI_ACCESS_TOKEN is not configured.")

  const timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000))
  const nonce = String(input.nonce ?? randomUUID().replace(/-/g, ""))
  const signatureHeaders = {
    "x-bili-accesskeyid": clientID,
    "x-bili-content-md5": md5Hex(input.bodyForMD5 ?? input.body ?? ""),
    "x-bili-signature-method": "HMAC-SHA256",
    "x-bili-signature-nonce": nonce,
    "x-bili-signature-version": "2.0",
    "x-bili-timestamp": timestamp
  }
  const canonical = Object.keys(signatureHeaders)
    .sort()
    .map((key) => `${key}:${signatureHeaders[key]}`)
    .join("\n")
  const authorization = createHmac("sha256", clientSecret).update(canonical).digest("hex")

  return {
    Accept: "application/json",
    "Access-Token": accessToken,
    Authorization: authorization,
    "X-Bili-Accesskeyid": signatureHeaders["x-bili-accesskeyid"],
    "X-Bili-Content-Md5": signatureHeaders["x-bili-content-md5"],
    "X-Bili-Signature-Method": signatureHeaders["x-bili-signature-method"],
    "X-Bili-Signature-Nonce": signatureHeaders["x-bili-signature-nonce"],
    "X-Bili-Signature-Version": signatureHeaders["x-bili-signature-version"],
    "X-Bili-Timestamp": signatureHeaders["x-bili-timestamp"],
    ...(input.contentType ? { "Content-Type": input.contentType } : {})
  }
}

module.exports = {
  createBilibiliHeaders,
  md5Hex
}
