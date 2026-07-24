import assert from "node:assert/strict"
import test from "node:test"
import { publishOtaSequence } from "./ota-publication.mjs"

test("publishes and verifies immutable OTA bytes before changing the channel pointer", async () => {
  const calls = []
  const assets = [{ key: "asset-a" }, { key: "asset-b" }]
  await publishOtaSequence({
    assets,
    manifest: { key: "manifest" },
    pointer: { key: "pointer" },
    uploadAsset: async (asset) => calls.push(`upload:${asset.key}`),
    uploadManifest: async (manifest) => calls.push(`upload:${manifest.key}`),
    verifyAsset: async (asset) => calls.push(`verify:${asset.key}`),
    verifyManifest: async (manifest) => calls.push(`verify:${manifest.key}`),
    uploadPointer: async (pointer) => calls.push(`upload:${pointer.key}`),
    verifyPointer: async (pointer) => calls.push(`verify:${pointer.key}`),
  })
  assert.deepEqual(calls, [
    "upload:asset-a",
    "upload:asset-b",
    "upload:manifest",
    "verify:asset-a",
    "verify:asset-b",
    "verify:manifest",
    "upload:pointer",
    "verify:pointer",
  ])
})

test("never updates the pointer when immutable verification fails", async () => {
  const calls = []
  await assert.rejects(
    publishOtaSequence({
      assets: [{ key: "asset" }],
      manifest: { key: "manifest" },
      pointer: { key: "pointer" },
      uploadAsset: async () => calls.push("upload:asset"),
      uploadManifest: async () => calls.push("upload:manifest"),
      verifyAsset: async () => {
        calls.push("verify:asset")
        throw new Error("mismatch")
      },
      verifyManifest: async () => calls.push("verify:manifest"),
      uploadPointer: async () => calls.push("upload:pointer"),
      verifyPointer: async () => calls.push("verify:pointer"),
    }),
    /mismatch/,
  )
  assert.deepEqual(calls, ["upload:asset", "upload:manifest", "verify:asset"])
})
