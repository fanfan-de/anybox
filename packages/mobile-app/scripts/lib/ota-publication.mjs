export async function publishOtaSequence({
  assets,
  manifest,
  pointer,
  uploadAsset,
  uploadManifest,
  verifyAsset,
  verifyManifest,
  uploadPointer,
  verifyPointer,
}) {
  for (const asset of assets) {
    await uploadAsset(asset)
  }
  await uploadManifest(manifest)
  for (const asset of assets) {
    await verifyAsset(asset)
  }
  await verifyManifest(manifest)
  await uploadPointer(pointer)
  await verifyPointer(pointer)
}
