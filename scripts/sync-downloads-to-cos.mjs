import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import https from "node:https"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  loadEnvFile,
  purgeCdnUrls,
  readCosConfig,
  uploadObject,
} from "./lib/tencent-cos.mjs"

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const siteArtifactsDir = path.join(scriptRoot, "packages", "site", "artifacts", "downloads")
const defaultBaseUrl = "https://download.anybox.com.cn"
const defaultManifestKey = "downloads.json"
const defaultReleasePrefix = "releases"
const defaultUpdateFeedPrefix = "updates/windows/x64"
const defaultLinuxUpdateFeedPrefix = "updates/linux/x64"
const githubReleasesUrl = "https://github.com/fanfan-de/anybox/releases/latest"

const platforms = ["windows", "mac", "linux", "mobile"]

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
    "  --linux <path>         Linux AppImage path. Auto-detected from packages/desktop/dist when omitted.",
    "                         Its sibling .deb is mirrored when present and is required for the update feed.",
    "  --mobile <path>        Android APK path. Auto-detected from packages/mobile-app/build when omitted.",
    "  --version <version>    Desktop/site version. Defaults to packages/desktop/package.json.",
    "  --mobile-version <v>   Android version. Defaults to packages/mobile-app/app.json.",
    "  --base-url <url>       CDN base URL. Defaults to ANYBOX_DOWNLOAD_BASE_URL or https://download.anybox.com.cn.",
    "  --out-dir <path>       Local output directory. Defaults to packages/site/artifacts/downloads.",
    "  --manifest-key <key>   COS object key for the manifest. Defaults to downloads.json.",
    "  --release-prefix <key> COS prefix for versioned release files. Defaults to releases.",
    "  --update-feed-prefix <key>",
    "                         COS prefix for the desktop auto-update feed. Defaults to updates/windows/x64.",
    "  --linux-update-feed-prefix <key>",
    "                         COS prefix for the Linux auto-update feed. Defaults to updates/linux/x64.",
    "  --require <list>       Comma-separated required platforms, e.g. windows,mac,linux,mobile.",
    "  --env-file <path>      Load simple KEY=VALUE environment file before running.",
    "  --upload              Upload release files and manifest to Tencent COS.",
    "  --replace-manifest    Do not preserve existing platform entries when uploading.",
    "  --skip-update-feed     Do not generate or upload latest.yml for the desktop auto-updater.",
    "  --skip-cdn-purge      Skip CDN refresh after uploading short-cache metadata.",
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
    linux: "",
    linuxUpdateFeedPrefix: process.env.ANYBOX_LINUX_UPDATE_FEED_PREFIX || defaultLinuxUpdateFeedPrefix,
    manifestKey: defaultManifestKey,
    mobile: "",
    mobileVersion: "",
    outDir: siteArtifactsDir,
    releasePrefix: defaultReleasePrefix,
    replaceManifest: false,
    skipCdnPurge: false,
    skipUpdateFeed: false,
    require: [],
    updateFeedPrefix: process.env.ANYBOX_UPDATE_FEED_PREFIX || defaultUpdateFeedPrefix,
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
    } else if (value === "--replace-manifest") {
      args.replaceManifest = true
    } else if (value === "--skip-cdn-purge") {
      args.skipCdnPurge = true
    } else if (value === "--skip-update-feed") {
      args.skipUpdateFeed = true
    } else if (value === "--windows") {
      args.windows = path.resolve(argv[index + 1] ?? "")
      index += 1
    } else if (value === "--mac") {
      args.mac = path.resolve(argv[index + 1] ?? "")
      index += 1
    } else if (value === "--linux") {
      args.linux = path.resolve(argv[index + 1] ?? "")
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
    } else if (value === "--update-feed-prefix") {
      args.updateFeedPrefix = argv[index + 1] ?? args.updateFeedPrefix
      index += 1
    } else if (value === "--linux-update-feed-prefix") {
      args.linuxUpdateFeedPrefix = argv[index + 1] ?? args.linuxUpdateFeedPrefix
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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"))
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
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

function httpsGetText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      const chunks = []

      response.on("data", (chunk) => chunks.push(chunk))
      response.on("end", () => {
        const responseText = Buffer.concat(chunks).toString("utf8")

        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve(responseText)
          return
        }

        reject(new Error(`${response.statusCode} ${response.statusMessage}\n${responseText}`))
      })
    })

    request.on("error", reject)
  })
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase()

  if (extension === ".apk") return "application/vnd.android.package-archive"
  if (extension === ".dmg") return "application/x-apple-diskimage"
  if (extension === ".appimage") return "application/vnd.appimage"
  if (extension === ".deb") return "application/vnd.debian.binary-package"
  if (extension === ".exe") return "application/vnd.microsoft.portable-executable"
  if (extension === ".json") return "application/json; charset=utf-8"
  if (extension === ".yaml" || extension === ".yml") return "text/yaml; charset=utf-8"

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
    linux:
      args.linux ||
      newestMatchingFile([desktopDist], [
        /^Anybox-[^-]+-x64\.AppImage$/i,
        /^Anybox-.*x64.*\.AppImage$/i,
        /^anybox.*x64.*\.AppImage$/i,
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
    throw new Error("No release assets found. Pass --windows, --mac, --linux, or --mobile.")
  }

  for (const platform of platforms) {
    if (assets[platform] && !existsSync(assets[platform])) {
      throw new Error(`${platform} asset not found: ${assets[platform]}`)
    }
  }
}

async function fetchExistingManifest(args) {
  const manifestUrl = joinUrl(args.baseUrl, args.manifestKey)

  try {
    const parsed = JSON.parse(await httpsGetText(manifestUrl))
    if (isRecord(parsed)) return parsed
  } catch (error) {
    console.warn(
      `Could not read existing manifest for preservation: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  return undefined
}

function getExistingManifestPlatform(existingManifest, platform) {
  if (!isRecord(existingManifest)) return undefined

  const manifestPlatforms = isRecord(existingManifest.platforms)
    ? existingManifest.platforms
    : undefined
  const platformEntry = manifestPlatforms?.[platform] ?? existingManifest[platform]

  if (!isRecord(platformEntry)) return undefined

  const url = isNonEmptyString(platformEntry.url) ? platformEntry.url.trim() : ""
  const version = normalizeVersion(platformEntry.version)

  if (!url || !version) return undefined

  return {
    ...platformEntry,
    fallbackUrl: isNonEmptyString(platformEntry.fallbackUrl)
      ? platformEntry.fallbackUrl.trim()
      : githubReleasesUrl,
    url,
    version,
  }
}

function platformVersion(platform, args, desktopVersion, mobileVersion) {
  if (platform === "mobile") return normalizeVersion(args.mobileVersion || mobileVersion)
  return normalizeVersion(args.version || desktopVersion)
}

function buildWindowsUpdateFeedUploads(args, assets) {
  if (args.skipUpdateFeed || !assets.windows) return []

  const windowsInstaller = assets.windows
  const windowsInstallerName = path.basename(windowsInstaller)
  const windowsDistDir = path.dirname(windowsInstaller)
  const latestYml = path.join(windowsDistDir, "latest.yml")
  const blockmap = `${windowsInstaller}.blockmap`
  const updatePrefix = trimSlashes(args.updateFeedPrefix)

  if (!updatePrefix) {
    throw new Error("Update feed prefix cannot be empty. Pass --skip-update-feed to publish only downloads.json.")
  }
  if (!existsSync(latestYml)) {
    throw new Error(`Missing desktop updater metadata: ${latestYml}. Rebuild the desktop installer or pass --skip-update-feed.`)
  }

  const latestYmlText = readFileSync(latestYml, "utf8")
  if (!latestYmlText.includes(windowsInstallerName)) {
    throw new Error(
      `desktop latest.yml does not reference ${windowsInstallerName}. Rebuild the desktop installer or pass --skip-update-feed.`,
    )
  }

  const uploads = [
    {
      cacheControl: "public, max-age=31536000, immutable",
      contentType: contentTypeFor(windowsInstaller),
      filePath: windowsInstaller,
      key: `${updatePrefix}/${windowsInstallerName}`,
    },
    {
      cacheControl: "public, max-age=60",
      contentType: contentTypeFor(latestYml),
      filePath: latestYml,
      key: `${updatePrefix}/latest.yml`,
      purge: true,
    },
  ]

  if (existsSync(blockmap)) {
    uploads.push({
      cacheControl: "public, max-age=31536000, immutable",
      contentType: contentTypeFor(blockmap),
      filePath: blockmap,
      key: `${updatePrefix}/${path.basename(blockmap)}`,
    })
  } else {
    console.warn(`windows blockmap not found; updater will fall back to full downloads: ${blockmap}`)
  }

  return uploads
}

function linuxDebianPath(installer) {
  return installer.toLowerCase().endsWith(".appimage")
    ? `${installer.slice(0, -9)}.deb`
    : ""
}

export function buildLinuxUpdateFeedUploads(args, assets) {
  if (args.skipUpdateFeed || !assets.linux) return []

  const installer = assets.linux
  const installerName = path.basename(installer)
  const debianPackage = linuxDebianPath(installer)
  const debianPackageName = path.basename(debianPackage)
  const distDir = path.dirname(installer)
  const latestYml = path.join(distDir, "latest-linux.yml")
  const updatePrefix = trimSlashes(args.linuxUpdateFeedPrefix)

  if (!updatePrefix) {
    throw new Error("Linux update feed prefix cannot be empty. Pass --skip-update-feed to publish only downloads.json.")
  }
  if (!existsSync(latestYml)) {
    throw new Error(`Missing Linux updater metadata: ${latestYml}. Rebuild the AppImage or pass --skip-update-feed.`)
  }
  if (!debianPackage || !existsSync(debianPackage)) {
    throw new Error(`Missing Linux Debian package: ${debianPackage || "unknown"}. Rebuild the Linux release or pass --skip-update-feed.`)
  }

  const latestYmlText = readFileSync(latestYml, "utf8")
  const updateUrls = Array.from(
    latestYmlText.matchAll(/^\s*-\s+url:\s*['"]?([^'"\r\n]+)['"]?\s*$/gm),
    (match) => match[1],
  )
  if (updateUrls.filter((url) => url === installerName).length !== 1) {
    throw new Error(`latest-linux.yml does not reference ${installerName}. Rebuild the AppImage or pass --skip-update-feed.`)
  }
  if (updateUrls.filter((url) => url === debianPackageName).length !== 1) {
    throw new Error(`latest-linux.yml does not reference ${debianPackageName}. Rebuild the Linux release or pass --skip-update-feed.`)
  }
  if (updateUrls.length !== new Set(updateUrls).size) {
    throw new Error("latest-linux.yml contains duplicate file URLs. Rebuild the Linux release before publishing.")
  }
  if (!/^\s*blockMapSize:\s*[1-9]\d*\s*$/m.test(latestYmlText)) {
    throw new Error(`latest-linux.yml does not declare an embedded AppImage blockmap. Rebuild the AppImage or pass --skip-update-feed.`)
  }

  const uploads = [
    {
      cacheControl: "public, max-age=31536000, immutable",
      contentType: contentTypeFor(installer),
      filePath: installer,
      key: `${updatePrefix}/${installerName}`,
    },
    {
      cacheControl: "public, max-age=31536000, immutable",
      contentType: contentTypeFor(debianPackage),
      filePath: debianPackage,
      key: `${updatePrefix}/${debianPackageName}`,
    },
    {
      cacheControl: "public, max-age=60",
      contentType: contentTypeFor(latestYml),
      filePath: latestYml,
      key: `${updatePrefix}/latest-linux.yml`,
      purge: true,
    },
  ]

  return uploads
}

export function buildManifest(args, assets, existingManifest) {
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

  if (assets.linux) {
    const debianPackage = linuxDebianPath(assets.linux)
    if (debianPackage && existsSync(debianPackage)) {
      const linuxVersion = platformVersion("linux", args, desktopVersion, mobileVersion)
      uploads.push({
        cacheControl: "public, max-age=31536000, immutable",
        contentType: contentTypeFor(debianPackage),
        filePath: debianPackage,
        key: `${trimSlashes(args.releasePrefix)}/${linuxVersion}/${path.basename(debianPackage)}`,
      })
    }
  }

  for (const platform of platforms) {
    if (manifestPlatforms[platform]) continue

    const existingEntry = getExistingManifestPlatform(existingManifest, platform)
    if (!existingEntry) continue

    manifestPlatforms[platform] = existingEntry
  }

  uploads.push(...buildWindowsUpdateFeedUploads(args, assets))
  uploads.push(...buildLinuxUpdateFeedUploads(args, assets))

  const manifest = {
    generatedAt: new Date().toISOString(),
    version: desktopVersion,
    platforms: manifestPlatforms,
  }

  return { manifest, uploads }
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
    const purgeUrls = [
      joinUrl(args.baseUrl, args.manifestKey),
      ...uploads.filter((upload) => upload.purge).map((upload) => joinUrl(args.baseUrl, upload.key)),
    ]
    await purgeCdnUrls({
      urls: purgeUrls,
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

  const existingManifest = args.upload && !args.replaceManifest
    ? await fetchExistingManifest(args)
    : undefined
  const { manifest, uploads } = buildManifest(args, assets, existingManifest)
  const manifestPath = path.join(args.outDir, "downloads.json")
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")

  console.log(`Generated manifest: ${manifestPath}`)
  for (const platform of platforms) {
    const entry = manifest.platforms[platform]
    if (entry) {
      const status = assets[platform] ? "updated" : "preserved"
      console.log(`${platform}: ${entry.url} (${status})`)
    } else {
      console.warn(`${platform}: no asset found; site will fall back to GitHub`)
    }
  }
  if (!args.skipUpdateFeed && assets.windows) {
    console.log(`Windows updater: ${joinUrl(args.baseUrl, `${trimSlashes(args.updateFeedPrefix)}/latest.yml`)}`)
  }
  if (!args.skipUpdateFeed && assets.linux) {
    console.log(`Linux updater: ${joinUrl(args.baseUrl, `${trimSlashes(args.linuxUpdateFeedPrefix)}/latest-linux.yml`)}`)
  }

  if (args.upload) {
    await uploadAll(args, uploads, manifestPath)
    console.log(`Published manifest: ${joinUrl(args.baseUrl, args.manifestKey)}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
