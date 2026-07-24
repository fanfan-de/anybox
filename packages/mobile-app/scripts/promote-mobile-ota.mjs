import {
  assertNativeFingerprint,
  assertPublicBytes,
  assertScopedReleaseTreeClean,
  fetchPublicBody,
  jsonBody,
  loadMobileReleaseEnvironment,
  otaKeyId,
  publicUrlForKey,
  readMobileConfig,
  requireOtaCertificate,
  requireOption,
  uploadPointerBody,
  verifyBody,
} from "./lib/mobile-update-tools.mjs"

function assertPreviewPointer(pointer, updateId, runtimeVersion) {
  if (
    !pointer ||
    pointer.schemaVersion !== 1 ||
    pointer.type !== "update" ||
    pointer.channel !== "preview" ||
    pointer.platform !== "android" ||
    pointer.runtimeVersion !== runtimeVersion ||
    pointer.updateId !== updateId ||
    pointer.keyId !== otaKeyId
  ) {
    throw new Error("Preview channel does not point to the requested compatible updateId.")
  }
  const manifestUrl = new URL(pointer.manifestUrl)
  if (
    manifestUrl.protocol !== "https:" ||
    manifestUrl.host !== "download.anybox.com.cn" ||
    !manifestUrl.pathname.endsWith(`/${updateId}/manifest.json`)
  ) {
    throw new Error("Preview manifest URL is outside the Anybox immutable OTA directory.")
  }
}

async function main() {
  const args = process.argv.slice(2)
  const requestedUpdateId = requireOption(args, "--update-id").toLowerCase()
  loadMobileReleaseEnvironment()
  assertScopedReleaseTreeClean()
  const mobile = readMobileConfig()
  const certificate = requireOtaCertificate()
  const nativeFingerprint = await assertNativeFingerprint(mobile.runtimeVersion)
  const pointerUrl = publicUrlForKey(
    `mobile/ota/channels/preview/android/${mobile.runtimeVersion}.json`,
  )
  const previewPointerRaw = (await fetchPublicBody(pointerUrl)).toString("utf8")
  const previewPointer = JSON.parse(previewPointerRaw)
  assertPreviewPointer(previewPointer, requestedUpdateId, mobile.runtimeVersion)
  if (previewPointer.nativeFingerprint !== nativeFingerprint) {
    throw new Error("Preview update native fingerprint no longer matches the production APK baseline.")
  }

  const manifestRaw = (await fetchPublicBody(previewPointer.manifestUrl)).toString("utf8")
  if (!verifyBody(manifestRaw, previewPointer.signature, certificate.certificatePem)) {
    throw new Error("Preview manifest signature verification failed; production was not changed.")
  }
  const manifest = JSON.parse(manifestRaw)
  if (
    manifest.id !== requestedUpdateId ||
    manifest.runtimeVersion !== mobile.runtimeVersion ||
    manifest.extra?.anybox?.nativeFingerprint !== previewPointer.nativeFingerprint ||
    manifest.extra?.anybox?.sourceCommit !== previewPointer.sourceCommit ||
    manifest.extra?.anybox?.message !== previewPointer.message
  ) {
    throw new Error("Preview manifest metadata does not match its channel pointer.")
  }

  const productionPointer = {
    ...previewPointer,
    channel: "production",
  }
  const productionBody = jsonBody(productionPointer)
  const productionKey = `mobile/ota/channels/production/android/${mobile.runtimeVersion}.json`
  const productionUrl = publicUrlForKey(productionKey)
  await uploadPointerBody(productionBody, productionKey)
  await assertPublicBytes(productionUrl, productionBody)

  const manifestAfterPromotion = await fetchPublicBody(previewPointer.manifestUrl)
  if (manifestAfterPromotion.toString("utf8") !== manifestRaw) {
    throw new Error("Immutable manifest bytes changed during promotion.")
  }
  console.log(`Promoted OTA update ${requestedUpdateId} to production.`)
  console.log(`Runtime: ${mobile.runtimeVersion}`)
  console.log(`Manifest bytes and signature were reused without modification.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
