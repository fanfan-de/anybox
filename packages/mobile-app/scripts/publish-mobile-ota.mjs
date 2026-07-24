import { randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { publishOtaSequence } from "./lib/ota-publication.mjs"
import {
  assertNativeFingerprint,
  assertNoExpoHosting,
  assertPublicBytes,
  assertPublicFile,
  assertScopedReleaseTreeClean,
  cdnBaseUrl,
  contentTypeForExtension,
  immutableCacheControl,
  jsonBody,
  loadMobileReleaseEnvironment,
  otaKeyId,
  packageRoot,
  parseOption,
  publicUrlForKey,
  readGit,
  readMobileConfig,
  requireOtaSigningMaterial,
  requireOption,
  run,
  sha256Base64Url,
  sha256Buffer,
  signBody,
  uploadImmutableBody,
  uploadImmutableFile,
  uploadPointerBody,
} from "./lib/mobile-update-tools.mjs"

const isWindows = process.platform === "win32"

function readExportMetadata(exportDirectory) {
  const metadataPath = path.join(exportDirectory, "metadata.json")
  if (!existsSync(metadataPath)) {
    throw new Error(`Expo export did not create metadata.json in ${exportDirectory}.`)
  }
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"))
  const platform = metadata.fileMetadata?.android
  if (!platform || typeof platform.bundle !== "string" || !Array.isArray(platform.assets)) {
    throw new Error("Expo export metadata does not contain an Android bundle and asset list.")
  }
  return platform
}

function resolveExportFile(exportDirectory, relativePath) {
  const resolved = path.resolve(exportDirectory, relativePath)
  const relative = path.relative(exportDirectory, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(resolved)) {
    throw new Error(`Expo export referenced a missing or unsafe path: ${relativePath}`)
  }
  return resolved
}

async function buildAssetRecord(exportDirectory, relativePath, extension, isLaunchAsset) {
  const filePath = resolveExportFile(exportDirectory, relativePath)
  const bytes = readFileSync(filePath)
  if (isLaunchAsset) {
    assertNoExpoHosting(bytes.toString("utf8"), "Exported Android OTA bundle")
  }
  const sha256 = sha256Buffer(bytes)
  const normalizedExtension = (extension || path.extname(relativePath).slice(1) || "bin")
    .replace(/^\./, "")
    .toLowerCase()
  if (!/^[a-z0-9]{1,12}$/.test(normalizedExtension)) {
    throw new Error(`Expo export contains an unsafe asset extension: ${normalizedExtension}`)
  }
  return {
    filePath,
    sha256,
    hash: sha256Base64Url(bytes),
    extension: isLaunchAsset ? "bundle" : normalizedExtension,
    contentType: contentTypeForExtension(normalizedExtension, isLaunchAsset),
    isLaunchAsset,
  }
}

async function main() {
  const args = process.argv.slice(2)
  const channel = args[0]
  if (channel !== "preview") {
    throw new Error("Direct OTA publishing is restricted to preview. Promote an existing updateId to production.")
  }
  const message = requireOption(args, "--message")
  if (message.length > 500) {
    throw new Error("--message must contain at most 500 characters.")
  }
  loadMobileReleaseEnvironment()
  assertScopedReleaseTreeClean()
  const mobile = readMobileConfig()
  const signing = requireOtaSigningMaterial()
  const nativeFingerprint = await assertNativeFingerprint(mobile.runtimeVersion)
  const sourceCommit = readGit(["rev-parse", "HEAD"]).toLowerCase()

  const exportDirectory = mkdtempSync(path.join(os.tmpdir(), "anybox-mobile-ota-"))
  try {
    const expo = path.join(packageRoot, "node_modules", ".bin", `expo${isWindows ? ".CMD" : ""}`)
    const exportEnvironment = {
      ...process.env,
      ANYBOX_MOBILE_UPDATE_CHANNEL: "preview",
      NODE_ENV: "production",
    }
    run(
      expo,
      [
        "export",
        "--platform",
        "android",
        "--output-dir",
        exportDirectory,
        "--dump-assetmap",
        "--clear",
      ],
      { env: exportEnvironment, shell: isWindows },
    )
    const expoConfigRaw = run(expo, ["config", "--type", "public", "--json"], {
      capture: true,
      env: exportEnvironment,
      shell: isWindows,
    })
    const expoConfig = JSON.parse(expoConfigRaw)
    assertNoExpoHosting(expoConfig, "Exported Expo config")
    if (expoConfig.updates?.requestHeaders) delete expoConfig.updates.requestHeaders
    if (expoConfig.extra?.anyboxMobileUpdateChannel) {
      delete expoConfig.extra.anyboxMobileUpdateChannel
    }

    const metadata = readExportMetadata(exportDirectory)
    const launchAsset = await buildAssetRecord(exportDirectory, metadata.bundle, "bundle", true)
    const regularAssets = await Promise.all(
      metadata.assets.map((asset) => {
        if (!asset || typeof asset.path !== "string") throw new Error("Expo export contains an invalid asset entry.")
        return buildAssetRecord(exportDirectory, asset.path, asset.ext, false)
      }),
    )
    const deduplicated = new Map()
    for (const asset of [launchAsset, ...regularAssets]) {
      const key = `${asset.sha256}.${asset.extension}`
      if (!deduplicated.has(key)) deduplicated.set(key, asset)
    }

    const updateId = randomUUID()
    const createdAt = new Date().toISOString()
    const releasePrefix = `mobile/ota/releases/${mobile.runtimeVersion}/${updateId}`
    const uploadedAssets = [...deduplicated.entries()].map(([fileName, asset]) => ({
      ...asset,
      key: `${releasePrefix}/assets/${fileName}`,
      url: publicUrlForKey(`${releasePrefix}/assets/${fileName}`),
    }))
    const uploadBySha = new Map(uploadedAssets.map((asset) => [asset.sha256, asset]))
    const manifestAsset = (asset) => {
      const uploaded = uploadBySha.get(asset.sha256)
      if (!uploaded) throw new Error("Internal OTA asset mapping failed.")
      return {
        hash: asset.hash,
        key: asset.sha256,
        contentType: asset.contentType,
        ...(asset.isLaunchAsset ? {} : { fileExtension: `.${asset.extension}` }),
        url: uploaded.url,
      }
    }
    const manifest = {
      id: updateId,
      createdAt,
      runtimeVersion: mobile.runtimeVersion,
      launchAsset: manifestAsset(launchAsset),
      assets: regularAssets.map(manifestAsset),
      metadata: {},
      extra: {
        expoClient: expoConfig,
        anybox: {
          message,
          nativeFingerprint,
          sourceCommit,
        },
      },
    }
    const rawManifest = jsonBody(manifest)
    assertNoExpoHosting(rawManifest, "OTA manifest")
    const signature = signBody(rawManifest, signing.privateKeyPem)
    const manifestKey = `${releasePrefix}/manifest.json`
    const manifestUrl = publicUrlForKey(manifestKey)
    const pointer = {
      schemaVersion: 1,
      type: "update",
      channel: "preview",
      platform: "android",
      runtimeVersion: mobile.runtimeVersion,
      updateId,
      createdAt,
      manifestUrl,
      signature,
      keyId: otaKeyId,
      sourceCommit,
      message,
      nativeFingerprint,
    }
    const rawPointer = jsonBody(pointer)
    const pointerKey = `mobile/ota/channels/preview/android/${mobile.runtimeVersion}.json`

    await publishOtaSequence({
      assets: uploadedAssets,
      manifest: { key: manifestKey, body: rawManifest, url: manifestUrl },
      pointer: { key: pointerKey, body: rawPointer, url: publicUrlForKey(pointerKey) },
      uploadAsset: (asset) => uploadImmutableFile(asset.filePath, asset.key, asset.contentType),
      uploadManifest: (item) => uploadImmutableBody(item.body, item.key, "application/json; charset=utf-8"),
      verifyAsset: (asset) => assertPublicFile(asset.url, asset.filePath),
      verifyManifest: (item) => assertPublicBytes(item.url, item.body),
      uploadPointer: (item) => uploadPointerBody(item.body, item.key),
      verifyPointer: (item) => assertPublicBytes(item.url, item.body),
    })

    const outputDirectory = path.join(packageRoot, "build", "ota", updateId)
    mkdirSync(outputDirectory, { recursive: true })
    writeFileSync(path.join(outputDirectory, "manifest.json"), rawManifest)
    writeFileSync(path.join(outputDirectory, "manifest.sig"), `${signature}\n`)
    writeFileSync(path.join(outputDirectory, "pointer.preview.json"), `${JSON.stringify(pointer, null, 2)}\n`)
    writeFileSync(
      path.join(outputDirectory, "publication.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          updateId,
          channel: "preview",
          runtimeVersion: mobile.runtimeVersion,
          sourceCommit,
          nativeFingerprint,
          manifestUrl,
          assetCount: uploadedAssets.length,
          cacheControl: immutableCacheControl,
          cdnBaseUrl,
        },
        null,
        2,
      )}\n`,
    )

    console.log(`Preview OTA update: ${updateId}`)
    console.log(`Runtime: ${mobile.runtimeVersion}`)
    console.log(`Manifest: ${manifestUrl}`)
    console.log(`Native fingerprint: ${nativeFingerprint}`)
    console.log("Production was not changed. Promote this exact updateId after preview validation.")
  } finally {
    const safePrefix = path.resolve(os.tmpdir(), "anybox-mobile-ota-")
    if (!path.resolve(exportDirectory).startsWith(safePrefix)) {
      throw new Error(`Refusing to remove unexpected temporary path: ${exportDirectory}`)
    }
    rmSync(exportDirectory, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
