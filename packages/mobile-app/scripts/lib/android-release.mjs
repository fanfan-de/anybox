import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  jsonBody,
  packageRoot,
  publicUrlForKey,
  sha256File,
  signBody,
} from "./mobile-update-tools.mjs"

export async function createAndroidReleaseManifest({
  mobile,
  apkPath,
  notes,
  force,
  minimumVersionCode,
  publishedAt = new Date().toISOString(),
}) {
  const apkAssetName = mobile.appJson.extra.anyboxMobileGitHubApkAssetName
  const tag = `${mobile.githubTagPrefix}${mobile.version}`
  const immutableApkKey = `mobile/android/releases/${mobile.version}/${apkAssetName}`
  const sha256 = await sha256File(apkPath)
  const sizeBytes = statSync(apkPath).size
  if (sizeBytes <= 0 || sizeBytes > 500 * 1024 * 1024) {
    throw new Error("APK size must be between 1 byte and 500 MB.")
  }
  if (
    !Array.isArray(notes) ||
    notes.length === 0 ||
    notes.length > 100 ||
    notes.some((note) => typeof note !== "string" || !note.trim() || note.length > 2_000)
  ) {
    throw new Error("Release notes must contain between 1 and 100 non-empty entries of at most 2,000 characters.")
  }
  if (!Number.isInteger(minimumVersionCode) || minimumVersionCode <= 0 || minimumVersionCode > mobile.versionCode) {
    throw new Error("minimumVersionCode must be positive and cannot exceed the published versionCode.")
  }
  return {
    schemaVersion: 1,
    platform: "android",
    version: mobile.version,
    versionCode: mobile.versionCode,
    minimumVersionCode,
    apkUrl: publicUrlForKey(immutableApkKey),
    fallbackApkUrl:
      `https://github.com/${mobile.githubRepository}/releases/download/${tag}/${apkAssetName}`,
    sha256,
    sizeBytes,
    publishedAt,
    notes,
    force,
  }
}

export async function prepareAndroidReleaseAssets({
  mobile,
  apkPath,
  notes,
  force,
  minimumVersionCode,
  privateKeyPem,
  outDirectory = path.join(packageRoot, "build", "github-release"),
  publishedAt,
}) {
  const manifest = await createAndroidReleaseManifest({
    mobile,
    apkPath,
    notes,
    force,
    minimumVersionCode,
    ...(publishedAt ? { publishedAt } : {}),
  })
  const rawManifest = jsonBody(manifest)
  const signature = signBody(rawManifest, privateKeyPem)
  mkdirSync(outDirectory, { recursive: true })
  const apkOutputPath = path.join(outDirectory, mobile.appJson.extra.anyboxMobileGitHubApkAssetName)
  const manifestOutputPath = path.join(
    outDirectory,
    mobile.appJson.extra.anyboxMobileGitHubManifestAssetName,
  )
  const signatureOutputPath = path.join(
    outDirectory,
    mobile.appJson.extra.anyboxMobileGitHubManifestSignatureAssetName,
  )
  copyFileSync(apkPath, apkOutputPath)
  writeFileSync(manifestOutputPath, rawManifest)
  writeFileSync(signatureOutputPath, `${signature}\n`)
  return {
    tag: `${mobile.githubTagPrefix}${mobile.version}`,
    manifest,
    rawManifest,
    signature,
    apkOutputPath,
    manifestOutputPath,
    signatureOutputPath,
    outDirectory,
  }
}
