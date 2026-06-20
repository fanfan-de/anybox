import { createHash, createHmac } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import https from "node:https"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const siteArtifactsDir = path.join(scriptRoot, "packages", "site", "artifacts", "downloads")
const defaultBaseUrl = "https://download.anybox.com.cn"
const defaultManifestKey = "downloads.json"
const defaultReleasePrefix = "releases"
const githubReleasesUrl = "https://github.com/fanfan-de/anybox/releases/latest"

const platforms = ["windows", "mac", "mobile"]

function usage() {
  return [
    "Anybox downloads manifest and Tencent COS sync",
    "",
    "Usage:",
    "  corepack pnpm downloads:prepare",
    "  corepack pnpm downloads:publish -- --env-file .env.downloads",
    "  node scripts/sync-downloads-to-cos.mjs --windows packages/desktop/dist/Anybox-0.1.17-x64.exe --upload",
    "",
    "Options:",
    "  --windows <path>       Windows installer path. Auto-detected from packages/desktop/dist when omitted.",
    "  --mac <path>           macOS installer path. Auto-detected from packages/desktop/dist when omitted.",
    "  --mobile <path>        Android APK path. Auto-detected from packages/mobile-app/build when omitted.",
    "  --version <version>    Desktop/site version. Defaults to packages/desktop/package.json.",
    "  --mobile-version <v>   Android version. Defaults to packages/mobile-app/app.json.",
    "  --base-url <url>       CDN base URL. Defaults to ANYBOX_DOWNLOAD_BASE_URL or https://download.anybox.com.cn.",
    "  --out-dir <path>       Local output directory. Defaults to packages/site/artifacts/downloads.",
    "  --manifest-key <key>   COS object key for the manifest. Defaults to downloads.json.",
    "  --release-prefix <key> COS prefix for versioned release files. Defaults to releases.",
    "  --require <list>       Comma-separated required platforms, e.g. windows,mac,mobile.",
    "  --env-file <path>      Load simple KEY=VALUE environment file before running.",
    "  --upload              Upload release files and manifest to Tencent COS.",
    "  --skip-cdn-purge      Skip CDN refresh after uploading downloads.json.",
    "  --help                Show this help.",
    "",
    "Upload environment variables:",
    "  TENCENT_COS_SECRET_ID",
    "  TENCENT_COS_SECRET_KEY",
    "  TENCENT_COS_BUCKET    Example: anybox-downloads-1250000000",
    "  TENCENT_COS_REGION    Example: ap-guangzhou",
    "",
    "CDN refresh uses the same Tencent credentials and requires cdn:PurgeUrlsCache and cdn:DescribePurgeTasks.",
    "Uploaded objects are set to public-read so the CDN download domain can read them.",
  ].join("\n")
}

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.ANYBOX_DOWNLOAD_BASE_URL || defaultBaseUrl,
    envFile: "",
    help: false,
    mac: "",
    manifestKey: defaultManifestKey,
    mobile: "",
    mobileVersion: "",
    outDir: siteArtifactsDir,
    releasePrefix: defaultReleasePrefix,
    skipCdnPurge: false,
    require: [],
    upload: false,
    version: "",
    windows: "",
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (value === "--help" || value === "-h") {
      args.help = true
    } else if (value === "--upload") {
      args.upload = true
    } else if (value === "--skip-cdn-purge") {
      args.skipCdnPurge = true
    } else if (value === "--windows") {
      args.windows = path.resolve(argv[index + 1] ?? "")
      index += 1
    } else if (value === "--mac") {
      args.mac = path.resolve(argv[index + 1] ?? "")
      index += 1
    } else if (value === "--mobile") {
      args.mobile = path.resolve(argv[index + 1] ?? "")
      index += 1
    } else if (value === "--version") {
      args.version = argv[index + 1] ?? ""
      index += 1
    } else if (value === "--mobile-version") {
      args.mobileVersion = argv[index + 1] ?? ""
      index += 1
    } else if (value === "--base-url") {
      args.baseUrl = argv[index + 1] ?? args.baseUrl
      index += 1
    } else if (value === "--out-dir") {
      args.outDir = path.resolve(argv[index + 1] ?? args.outDir)
      index += 1
    } else if (value === "--manifest-key") {
      args.manifestKey = argv[index + 1] ?? args.manifestKey
      index += 1
    } else if (value === "--release-prefix") {
      args.releasePrefix = argv[index + 1] ?? args.releasePrefix
      index += 1
    } else if (value === "--require") {
      args.require = (argv[index + 1] ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
      index += 1
    } else if (value === "--env-file") {
      args.envFile = path.resolve(argv[index + 1] ?? "")
      index += 1
    } else if (value === "--") {
      continue
    } else {
      throw new Error(`Unknown option: ${value}`)
    }
  }

  return args
}

function loadEnvFile(filePath) {
  if (!filePath) return
  if (!existsSync(filePath)) throw new Error(`Env file not found: ${filePath}`)

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const equalsIndex = trimmed.indexOf("=")
    if (equalsIndex === -1) continue

    const key = trimmed.slice(0, equalsIndex).trim()
    const value = trimmed
      .slice(equalsIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "")

    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"))
}

function normalizeVersion(version) {
  const normalized = String(version ?? "").trim()
  if (!normalized) return ""
  return normalized.startsWith("v") ? normalized : `v${normalized}`
}

function trimSlashes(value) {
  return String(value ?? "").replace(/^\/+|\/+$/g, "")
}

function joinUrl(baseUrl, objectKey) {
  return `${String(baseUrl).replace(/\/+$/g, "")}/${trimSlashes(objectKey)}`
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase()

  if (extension === ".apk") return "application/vnd.android.package-archive"
  if (extension === ".dmg") return "application/x-apple-diskimage"
  if (extension === ".exe") return "application/vnd.microsoft.portable-executable"
  if (extension === ".json") return "application/json; charset=utf-8"

  return "application/octet-stream"
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

function walkFiles(directory) {
  if (!existsSync(directory)) return []

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath]
  })
}

function newestMatchingFile(directories, matchers) {
  const matches = directories
    .flatMap((directory) => walkFiles(directory))
    .filter((filePath) => matchers.some((matcher) => matcher.test(path.basename(filePath))))
    .map((filePath) => ({
      filePath,
      mtimeMs: statSync(filePath).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)

  return matches[0]?.filePath ?? ""
}

function detectAssets(args) {
  const desktopDist = path.join(scriptRoot, "packages", "desktop", "dist")
  const mobileBuild = path.join(scriptRoot, "packages", "mobile-app", "build")
  const mobileGitHubRelease = path.join(mobileBuild, "github-release")

  return {
    windows:
      args.windows ||
      newestMatchingFile([desktopDist], [
        /^Anybox-[^-]+-x64\.exe$/i,
        /^Anybox-.*x64.*\.exe$/i,
        /^anybox.*x64.*\.exe$/i,
      ]),
    mac:
      args.mac ||
      newestMatchingFile([desktopDist], [
        /^Anybox-[^-]+-arm64\.dmg$/i,
        /^Anybox-.*arm64.*\.dmg$/i,
        /^anybox.*arm64.*\.dmg$/i,
      ]),
    mobile:
      args.mobile ||
      newestMatchingFile([mobileGitHubRelease, mobileBuild], [
        /^anybox-mobile\.apk$/i,
      ]),
  }
}

function ensureRequiredAssets(assets, requiredPlatforms) {
  const required = requiredPlatforms.length > 0 ? requiredPlatforms : []

  for (const platform of required) {
    if (!platforms.includes(platform)) {
      throw new Error(`Unknown required platform: ${platform}`)
    }
    if (!assets[platform]) {
      throw new Error(`Missing required ${platform} asset.`)
    }
  }

  if (!platforms.some((platform) => assets[platform])) {
    throw new Error("No release assets found. Pass --windows, --mac, or --mobile.")
  }

  for (const platform of platforms) {
    if (assets[platform] && !existsSync(assets[platform])) {
      throw new Error(`${platform} asset not found: ${assets[platform]}`)
    }
  }
}

function platformVersion(platform, args, desktopVersion, mobileVersion) {
  if (platform === "mobile") return normalizeVersion(args.mobileVersion || mobileVersion)
  return normalizeVersion(args.version || desktopVersion)
}

function buildManifest(args, assets) {
  const desktopPackage = readJson(path.join(scriptRoot, "packages", "desktop", "package.json"))
  const mobileConfig = readJson(path.join(scriptRoot, "packages", "mobile-app", "app.json")).expo
  const desktopVersion = normalizeVersion(args.version || desktopPackage.version)
  const mobileVersion = normalizeVersion(args.mobileVersion || mobileConfig.version)
  const manifestPlatforms = {}
  const uploads = []

  for (const platform of platforms) {
    const assetPath = assets[platform]
    if (!assetPath) continue

    const version = platformVersion(platform, args, desktopVersion, mobileVersion)
    const fileName = path.basename(assetPath)
    const objectKey = `${trimSlashes(args.releasePrefix)}/${version}/${fileName}`
    const stats = statSync(assetPath)

    manifestPlatforms[platform] = {
      fallbackUrl: githubReleasesUrl,
      fileName,
      sha256: sha256File(assetPath),
      sizeBytes: stats.size,
      url: joinUrl(args.baseUrl, objectKey),
      version,
    }

    uploads.push({
      cacheControl: "public, max-age=31536000, immutable",
      contentType: contentTypeFor(assetPath),
      filePath: assetPath,
      key: objectKey,
    })
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    version: desktopVersion,
    platforms: manifestPlatforms,
  }

  return { manifest, uploads }
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
  const urlParamList = ""
  const canonicalHeaders = `${headers.map(([key, value]) => `${key}=${value}`).join("&")}\n`
  const canonicalRequest = [
    method.toLowerCase(),
    requestPath,
    "",
    canonicalHeaders,
  ].join("\n")
  const stringToSign = ["sha1", signTime, sha1Hex(canonicalRequest), ""].join("\n")
  const signKey = hmacSha1Hex(secretKey, signTime)
  const signature = hmacSha1Hex(signKey, stringToSign)

  return [
    "q-sign-algorithm=sha1",
    `q-ak=${secretId}`,
    `q-sign-time=${signTime}`,
    `q-key-time=${signTime}`,
    `q-header-list=${headerList}`,
    `q-url-param-list=${urlParamList}`,
    `q-signature=${signature}`,
  ].join("&")
}

function uploadObject({ acl = "public-read", body, bucket, cacheControl, contentType, key, region, secretId, secretKey }) {
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
    "Content-Length": body.length,
    "Content-Type": contentType,
    Host: host,
  }
  if (acl) headers["x-cos-acl"] = acl

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        headers,
        hostname: host,
        method: "PUT",
        path: requestPath,
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () => {
          const responseText = Buffer.concat(chunks).toString("utf8")

          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            resolve()
            return
          }

          reject(
            new Error(
              `COS upload failed for ${key}: ${response.statusCode} ${response.statusMessage}\n${responseText}`,
            ),
          )
        })
      },
    )

    request.on("error", reject)
    request.end(body)
  })
}

function readCosConfig() {
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
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n")
  const secretDate = hmacSha256(`TC3${secretKey}`, date)
  const secretService = hmacSha256(secretDate, service)
  const secretSigning = hmacSha256(secretService, "tc3_request")
  const signature = hmacSha256(secretSigning, stringToSign, "hex")
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`

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
            reject(new Error(`Tencent Cloud API ${action} returned invalid JSON: ${responseText}`))
            return
          }

          const apiResponse = parsed.Response ?? parsed
          if (apiResponse.Error) {
            reject(new Error(`${action} failed: ${apiResponse.Error.Code} ${apiResponse.Error.Message}`))
            return
          }
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`${action} failed: ${response.statusCode} ${response.statusMessage}\n${responseText}`))
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

async function purgeCdnManifest({ baseUrl, manifestKey, secretId, secretKey }) {
  const url = joinUrl(baseUrl, manifestKey)
  console.log(`Purging CDN: ${url}`)

  const purgeResponse = await tencentCloudApiRequest({
    action: "PurgeUrlsCache",
    payload: { Urls: [url] },
    secretId,
    secretKey,
  })
  const taskId = purgeResponse.TaskId

  if (!taskId) {
    console.log(`CDN purge submitted: ${purgeResponse.RequestId}`)
    return
  }

  console.log(`CDN purge task: ${taskId}`)

  const taskResponse = await tencentCloudApiRequest({
    action: "DescribePurgeTasks",
    payload: { TaskId: taskId },
    secretId,
    secretKey,
  })
  const task = Array.isArray(taskResponse.PurgeLogs) ? taskResponse.PurgeLogs[0] : undefined

  if (task?.Status) {
    console.log(`CDN purge status: ${task.Status}`)
  }
}

async function uploadAll(args, uploads, manifestPath) {
  const cosConfig = readCosConfig()

  for (const upload of uploads) {
    console.log(`Uploading ${upload.key}`)
    await uploadObject({
      ...cosConfig,
      body: readFileSync(upload.filePath),
      cacheControl: upload.cacheControl,
      contentType: upload.contentType,
      key: upload.key,
    })
  }

  console.log(`Uploading ${args.manifestKey}`)
  await uploadObject({
    ...cosConfig,
    body: readFileSync(manifestPath),
    cacheControl: "public, max-age=60",
    contentType: "application/json; charset=utf-8",
    key: args.manifestKey,
  })

  if (!args.skipCdnPurge) {
    await purgeCdnManifest({
      baseUrl: args.baseUrl,
      manifestKey: args.manifestKey,
      secretId: cosConfig.secretId,
      secretKey: cosConfig.secretKey,
    })
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  loadEnvFile(args.envFile)

  const assets = detectAssets(args)
  ensureRequiredAssets(assets, args.require)

  mkdirSync(args.outDir, { recursive: true })

  const { manifest, uploads } = buildManifest(args, assets)
  const manifestPath = path.join(args.outDir, "downloads.json")
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

  console.log(`Generated manifest: ${manifestPath}`)
  for (const platform of platforms) {
    const entry = manifest.platforms[platform]
    if (entry) {
      console.log(`${platform}: ${entry.url}`)
    } else {
      console.warn(`${platform}: no asset found; site will fall back to GitHub`)
    }
  }

  if (args.upload) {
    await uploadAll(args, uploads, manifestPath)
    console.log(`Published manifest: ${joinUrl(args.baseUrl, args.manifestKey)}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
