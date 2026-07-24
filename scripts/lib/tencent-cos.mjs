import { createHash, createHmac } from "node:crypto"
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs"
import https from "node:https"

function trimSlashes(value) {
  return String(value ?? "").replace(/^\/+|\/+$/g, "")
}

function sha1Hex(value) {
  return createHash("sha1").update(value).digest("hex")
}

function hmacSha1Hex(key, value) {
  return createHmac("sha1", key).update(value).digest("hex")
}

function hmacSha256(key, value, encoding) {
  return createHmac("sha256", key).update(value).digest(encoding)
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex")
}

function encodeCosKey(key) {
  return `/${trimSlashes(key)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`
}

function cosAuthorization({ host, method, requestPath, secretId, secretKey, signedHeaders = { host } }) {
  const now = Math.floor(Date.now() / 1000)
  const signTime = `${now};${now + 600}`
  const headers = Object.entries(signedHeaders)
    .map(([key, value]) => [key.toLowerCase(), String(value).trim()])
    .sort(([left], [right]) => left.localeCompare(right))
  const headerList = headers.map(([key]) => key).join(";")
  const canonicalHeaders = `${headers.map(([key, value]) => `${key}=${value}`).join("&")}\n`
  const canonicalRequest = [method.toLowerCase(), requestPath, "", canonicalHeaders].join("\n")
  const stringToSign = ["sha1", signTime, sha1Hex(canonicalRequest), ""].join("\n")
  const signKey = hmacSha1Hex(secretKey, signTime)
  const signature = hmacSha1Hex(signKey, stringToSign)

  return [
    "q-sign-algorithm=sha1",
    `q-ak=${secretId}`,
    `q-sign-time=${signTime}`,
    `q-key-time=${signTime}`,
    `q-header-list=${headerList}`,
    "q-url-param-list=",
    `q-signature=${signature}`,
  ].join("&")
}

function createCosRequest({
  acl = "public-read",
  bucket,
  cacheControl,
  contentLength,
  contentType,
  key,
  region,
  secretId,
  secretKey,
}) {
  const host = `${bucket}.cos.${region}.myqcloud.com`
  const requestPath = encodeCosKey(key)
  const signedHeaders = acl ? { host, "x-cos-acl": acl } : { host }
  const authorization = cosAuthorization({
    host,
    method: "PUT",
    requestPath,
    secretId,
    secretKey,
    signedHeaders,
  })
  const headers = {
    Authorization: authorization,
    "Cache-Control": cacheControl,
    "Content-Length": contentLength,
    "Content-Type": contentType,
    Host: host,
  }
  if (acl) headers["x-cos-acl"] = acl

  return https.request({
    headers,
    hostname: host,
    method: "PUT",
    path: requestPath,
  })
}

function consumeCosResponse(request, key, resolve, reject) {
  request.on("response", (response) => {
    const chunks = []
    response.on("data", (chunk) => chunks.push(chunk))
    response.on("end", () => {
      const responseText = Buffer.concat(chunks).toString("utf8")
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
        resolve()
        return
      }
      reject(new Error(`COS upload failed for ${key}: ${response.statusCode} ${response.statusMessage}\n${responseText}`))
    })
  })
  request.on("error", reject)
}

export function uploadObject({
  acl = "public-read",
  body,
  bucket,
  cacheControl,
  contentType,
  key,
  region,
  secretId,
  secretKey,
}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body)
  return new Promise((resolve, reject) => {
    const request = createCosRequest({
      acl,
      bucket,
      cacheControl,
      contentLength: buffer.length,
      contentType,
      key,
      region,
      secretId,
      secretKey,
    })
    consumeCosResponse(request, key, resolve, reject)
    request.end(buffer)
  })
}

export function uploadFile({
  acl = "public-read",
  bucket,
  cacheControl,
  contentType,
  filePath,
  key,
  region,
  secretId,
  secretKey,
}) {
  const size = statSync(filePath).size
  return new Promise((resolve, reject) => {
    const request = createCosRequest({
      acl,
      bucket,
      cacheControl,
      contentLength: size,
      contentType,
      key,
      region,
      secretId,
      secretKey,
    })
    consumeCosResponse(request, key, resolve, reject)
    const stream = createReadStream(filePath)
    stream.on("error", (error) => {
      request.destroy(error)
      reject(error)
    })
    stream.pipe(request)
  })
}

export function loadEnvFile(filePath) {
  if (!filePath) return
  if (!existsSync(filePath)) throw new Error(`Env file not found: ${filePath}`)
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const equalsIndex = trimmed.indexOf("=")
    if (equalsIndex <= 0) continue
    const key = trimmed.slice(0, equalsIndex).trim()
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/g, "")
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

export function readCosConfig() {
  const secretId = process.env.TENCENT_COS_SECRET_ID || process.env.COS_SECRET_ID || ""
  const secretKey = process.env.TENCENT_COS_SECRET_KEY || process.env.COS_SECRET_KEY || ""
  const bucket = process.env.TENCENT_COS_BUCKET || process.env.COS_BUCKET || ""
  const region = process.env.TENCENT_COS_REGION || process.env.COS_REGION || ""
  if (!secretId || !secretKey || !bucket || !region) {
    throw new Error(
      "Missing COS config. Set TENCENT_COS_SECRET_ID, TENCENT_COS_SECRET_KEY, TENCENT_COS_BUCKET, and TENCENT_COS_REGION.",
    )
  }
  return { bucket, region, secretId, secretKey }
}

function tencentCloudApiRequest({ action, payload, secretId, secretKey }) {
  const service = "cdn"
  const host = "cdn.tencentcloudapi.com"
  const version = "2018-06-06"
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const body = JSON.stringify(payload)
  const canonicalRequest = [
    "POST",
    "/",
    "",
    `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`,
    "content-type;host;x-tc-action",
    sha256Hex(body),
  ].join("\n")
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), credentialScope, sha256Hex(canonicalRequest)].join("\n")
  const secretDate = hmacSha256(`TC3${secretKey}`, date)
  const secretService = hmacSha256(secretDate, service)
  const secretSigning = hmacSha256(secretService, "tc3_request")
  const signature = hmacSha256(secretSigning, stringToSign, "hex")
  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json; charset=utf-8",
          Host: host,
          "X-TC-Action": action,
          "X-TC-Timestamp": String(timestamp),
          "X-TC-Version": version,
        },
        hostname: host,
        method: "POST",
        path: "/",
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () => {
          const responseText = Buffer.concat(chunks).toString("utf8")
          let parsed
          try {
            parsed = JSON.parse(responseText)
          } catch {
            reject(new Error(`Tencent Cloud API ${action} returned invalid JSON.`))
            return
          }
          const apiResponse = parsed.Response ?? parsed
          if (apiResponse.Error) {
            reject(new Error(`${action} failed: ${apiResponse.Error.Code} ${apiResponse.Error.Message}`))
            return
          }
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`${action} failed with HTTP ${response.statusCode}.`))
            return
          }
          resolve(apiResponse)
        })
      },
    )
    request.on("error", reject)
    request.end(body)
  })
}

export async function purgeCdnUrls({ secretId, secretKey, urls }) {
  if (urls.length === 0) return
  const purgeResponse = await tencentCloudApiRequest({
    action: "PurgeUrlsCache",
    payload: { Urls: urls },
    secretId,
    secretKey,
  })
  const taskId = purgeResponse.TaskId
  if (!taskId) return { requestId: purgeResponse.RequestId }
  const taskResponse = await tencentCloudApiRequest({
    action: "DescribePurgeTasks",
    payload: { TaskId: taskId },
    secretId,
    secretKey,
  })
  const task = Array.isArray(taskResponse.PurgeLogs) ? taskResponse.PurgeLogs[0] : undefined
  return { taskId, status: task?.Status }
}
