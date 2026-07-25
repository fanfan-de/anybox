import {
  createHash,
  createPublicKey,
  createSign,
  verify,
  X509Certificate,
} from "node:crypto"
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  loadEnvFile,
  purgeCdnUrls,
  readCosConfig,
  uploadFile,
  uploadObject,
} from "../../../../scripts/lib/tencent-cos.mjs"

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
export const repoRoot = path.resolve(packageRoot, "..", "..")
export const cdnBaseUrl = "https://download.anybox.com.cn"
export const otaKeyId = "anybox-mobile-2026"
export const immutableCacheControl = "public, max-age=31536000, immutable"
export const pointerCacheControl = "public, max-age=60"
const isWindows = process.platform === "win32"

export function loadMobileReleaseEnvironment() {
  loadEnvFile(path.join(repoRoot, ".env.downloads"))
  loadEnvFile(path.join(repoRoot, ".env.mobile-signing.local"))
}

export function readMobileConfig() {
  const appJson = JSON.parse(readFileSync(path.join(packageRoot, "app.json"), "utf8")).expo
  const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"))
  if (packageJson.version !== appJson.version) {
    throw new Error(`Mobile package version ${packageJson.version} does not match app version ${appJson.version}.`)
  }
  const versionCode = Number(appJson.android?.versionCode)
  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    throw new Error("app.json must contain a positive Android versionCode.")
  }
  return {
    appJson,
    packageJson,
    packageName: appJson.android.package,
    version: appJson.version,
    versionCode,
    runtimeVersion: appJson.version,
    githubRepository: appJson.extra.anyboxMobileGitHubRepository,
    githubTagPrefix: appJson.extra.anyboxMobileGitHubReleaseTagPrefix,
  }
}

export function requireOtaSigningMaterial() {
  const privateKeyPath = path.resolve(process.env.ANYBOX_OTA_PRIVATE_KEY_PATH ?? "")
  if (!process.env.ANYBOX_OTA_PRIVATE_KEY_PATH || !existsSync(privateKeyPath)) {
    throw new Error("OTA private key is missing. Run pnpm mobile:keys:init on the release computer.")
  }
  const { certificatePath, certificatePem } = requireOtaCertificate()
  const privateKeyPem = readFileSync(privateKeyPath, "utf8")
  const testBody = "anybox-mobile-key-pair-check"
  const testSignature = signBody(testBody, privateKeyPem)
  if (!verifyBody(testBody, testSignature, certificatePem)) {
    throw new Error("OTA private key does not match the embedded public certificate.")
  }
  return { certificatePath, certificatePem, privateKeyPath, privateKeyPem }
}

export function requireOtaCertificate() {
  const certificatePath = path.resolve(
    process.env.ANYBOX_OTA_CERTIFICATE_PATH ??
      path.join(packageRoot, "credentials", "ota-certificate.pem"),
  )
  if (!existsSync(certificatePath)) {
    throw new Error("OTA public certificate is missing. Run pnpm mobile:keys:init first.")
  }
  return { certificatePath, certificatePem: readFileSync(certificatePath, "utf8") }
}

export function signBody(body, privateKeyPem) {
  const signer = createSign("RSA-SHA256")
  signer.update(body, "utf8")
  signer.end()
  return signer.sign(privateKeyPem, "base64")
}

export function verifyBody(body, encodedSignature, certificatePem) {
  try {
    return verify(
      "RSA-SHA256",
      Buffer.from(body, "utf8"),
      createPublicKey(certificatePem),
      Buffer.from(encodedSignature.trim(), "base64"),
    )
  } catch {
    return false
  }
}

export function certificateFingerprint(certificatePem) {
  return new X509Certificate(certificatePem).fingerprint256.replaceAll(":", "").toLowerCase()
}

export function jsonBody(value) {
  return JSON.stringify(value)
}

export function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

export function sha256Base64Url(buffer) {
  return createHash("sha256").update(buffer).digest("base64url")
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", () => resolve(hash.digest("hex")))
  })
}

export function contentTypeForExtension(extension, isLaunchAsset = false) {
  if (isLaunchAsset) return "application/javascript"
  const normalized = extension.toLowerCase().replace(/^\./, "")
  return {
    avif: "image/avif",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    json: "application/json",
    otf: "font/otf",
    png: "image/png",
    svg: "image/svg+xml",
    ttf: "font/ttf",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
  }[normalized] ?? "application/octet-stream"
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: options.shell ?? (isWindows && /\.(?:bat|cmd)$/i.test(command)),
    stdio: options.capture ? "pipe" : "inherit",
    windowsHide: true,
  })
  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    throw new Error(`${path.basename(command)} failed. See the command output above.`)
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
}

export function readGit(args) {
  return run("git", args, { cwd: repoRoot, capture: true })
}

export function assertScopedReleaseTreeClean() {
  const status = readGit([
    "status",
    "--porcelain",
    "--",
    "packages/mobile-app",
    "packages/mobile-update-server",
    "patches",
    "scripts/lib",
    "scripts/sync-downloads-to-cos.mjs",
    "package.json",
    "pnpm-lock.yaml",
  ])
  if (status) {
    throw new Error(
      "Mobile update sources contain uncommitted changes. Commit the mobile/update-server changes before publishing.",
    )
  }
}

export async function computeAndroidNativeFingerprint() {
  const { createProjectHashAsync } = await import("@expo/fingerprint")
  const previousChannel = process.env.ANYBOX_MOBILE_UPDATE_CHANNEL
  process.env.ANYBOX_MOBILE_UPDATE_CHANNEL = "production"
  try {
    return await createProjectHashAsync(packageRoot, {
      // The root android directory is generated by Expo prebuild. Ignoring its
      // generated files keeps the managed-project fingerprint identical before
      // and after an APK build while native modules and config plugins remain
      // part of the fingerprint.
      ignorePaths: ["android/**/*"],
      platforms: ["android"],
      silent: true,
    })
  } finally {
    if (previousChannel === undefined) delete process.env.ANYBOX_MOBILE_UPDATE_CHANNEL
    else process.env.ANYBOX_MOBILE_UPDATE_CHANNEL = previousChannel
  }
}

export function readNativeBaseline(runtimeVersion) {
  const baselinePath = path.join(packageRoot, "update-baselines", `${runtimeVersion}.json`)
  if (!existsSync(baselinePath)) {
    throw new Error(`Native fingerprint baseline is missing: ${baselinePath}`)
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"))
  if (
    baseline.schemaVersion !== 1 ||
    baseline.platform !== "android" ||
    baseline.fingerprintProfile !== "production-channel-normalized" ||
    baseline.runtimeVersion !== runtimeVersion ||
    typeof baseline.nativeFingerprint !== "string"
  ) {
    throw new Error(`Native fingerprint baseline is invalid: ${baselinePath}`)
  }
  return baseline
}

export async function assertNativeFingerprint(runtimeVersion) {
  const baseline = readNativeBaseline(runtimeVersion)
  const current = await computeAndroidNativeFingerprint()
  if (current !== baseline.nativeFingerprint) {
    throw new Error(
      `Native fingerprint changed for runtime ${runtimeVersion}. Publish a new APK version before sending an OTA update.`,
    )
  }
  return current
}

export function assertNoExpoHosting(value, label) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value)
  if (
    /\b(?:expo\.io|exp\.host|exp\.direct|expo\.test|u\.expo\.dev)\b|\bexpo\.dev\/(?:accounts|@)|(?:["']projectId["']|projectId\s*:)|"eas"\s*:/i.test(
      serialized,
    )
  ) {
    throw new Error(`${label} contains Expo/EAS hosted-service configuration.`)
  }
}

export function publicUrlForKey(key) {
  return new URL(key.replace(/^\/+/, ""), `${cdnBaseUrl}/`).toString()
}

export async function uploadImmutableFile(filePath, key, contentType, cosConfig = readCosConfig()) {
  await uploadFile({
    ...cosConfig,
    cacheControl: immutableCacheControl,
    contentType,
    filePath,
    key,
  })
}

export async function uploadImmutableBody(body, key, contentType, cosConfig = readCosConfig()) {
  await uploadObject({
    ...cosConfig,
    body,
    cacheControl: immutableCacheControl,
    contentType,
    key,
  })
}

export async function uploadPointerBody(
  body,
  key,
  cosConfig = readCosConfig(),
  contentType = "application/json; charset=utf-8",
) {
  await uploadObject({
    ...cosConfig,
    body,
    cacheControl: pointerCacheControl,
    contentType,
    key,
  })
  await purgeCdnUrls({
    secretId: cosConfig.secretId,
    secretKey: cosConfig.secretKey,
    urls: [publicUrlForKey(key)],
  })
}

export async function fetchPublicBody(url, attempts = 8) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}verify=${Date.now()}`, {
        cache: "no-store",
        headers: { accept: "application/json, application/octet-stream" },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** (attempt - 1), 4_000)))
      }
    }
  }
  throw new Error(`Unable to verify public CDN object ${url}: ${lastError instanceof Error ? lastError.message : lastError}`)
}

export async function assertPublicBytes(url, expectedBytes) {
  const actual = await fetchPublicBody(url)
  const expected = Buffer.isBuffer(expectedBytes) ? expectedBytes : Buffer.from(expectedBytes)
  if (actual.length !== expected.length || sha256Buffer(actual) !== sha256Buffer(expected)) {
    throw new Error(`Public CDN bytes do not match the uploaded object: ${url}`)
  }
}

export async function assertPublicFile(url, filePath) {
  const expectedSize = statSync(filePath).size
  const expectedSha = await sha256File(filePath)
  const actual = await fetchPublicBody(url)
  if (actual.length !== expectedSize || sha256Buffer(actual) !== expectedSha) {
    throw new Error(`Public CDN file does not match the uploaded object: ${url}`)
  }
}

export function parseOption(args, option, fallback = "") {
  const index = args.indexOf(option)
  return index >= 0 ? (args[index + 1] ?? "") : fallback
}

export function requireOption(args, option) {
  const value = parseOption(args, option)
  if (!value.trim()) throw new Error(`${option} is required.`)
  return value.trim()
}

export function parseNotes(args) {
  const notes = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--notes" && args[index + 1]) {
      notes.push(args[index + 1].trim())
      index += 1
    }
  }
  return notes.filter(Boolean)
}
