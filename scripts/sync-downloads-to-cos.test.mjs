import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import { buildLinuxUpdateFeedUploads, buildManifest } from "./sync-downloads-to-cos.mjs"

function makeLinuxCandidate({ includeDebian = true } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "anybox-cos-linux-test-"))
  const appImage = path.join(directory, "Anybox-0.1.33-x64.AppImage")
  const debianPackage = path.join(directory, "Anybox-0.1.33-x64.deb")

  writeFileSync(appImage, "appimage")
  if (includeDebian) writeFileSync(debianPackage, "debian")
  writeFileSync(
    path.join(directory, "latest-linux.yml"),
    [
      "version: 0.1.33",
      "files:",
      "  - url: Anybox-0.1.33-x64.AppImage",
      "    size: 8",
      "    blockMapSize: 123",
      "  - url: Anybox-0.1.33-x64.deb",
      "    size: 6",
      "path: Anybox-0.1.33-x64.AppImage",
      "",
    ].join("\n"),
  )

  return { appImage, directory }
}

const baseArgs = {
  baseUrl: "https://download.anybox.com.cn",
  linuxUpdateFeedPrefix: "updates/linux/x64",
  mobileVersion: "",
  releasePrefix: "releases",
  skipUpdateFeed: false,
  updateFeedPrefix: "updates/windows/x64",
  version: "0.1.33",
}

test("Linux COS plan includes AppImage, Debian package, metadata, and versioned Debian package", () => {
  const candidate = makeLinuxCandidate()

  try {
    const assets = { linux: candidate.appImage, mac: "", mobile: "", windows: "" }
    const updateUploads = buildLinuxUpdateFeedUploads(baseArgs, assets)
    assert.deepEqual(
      updateUploads.map((upload) => upload.key),
      [
        "updates/linux/x64/Anybox-0.1.33-x64.AppImage",
        "updates/linux/x64/Anybox-0.1.33-x64.deb",
        "updates/linux/x64/latest-linux.yml",
      ],
    )

    const { uploads } = buildManifest(baseArgs, assets)
    assert.deepEqual(
      uploads.map((upload) => upload.key),
      [
        "releases/v0.1.33/Anybox-0.1.33-x64.AppImage",
        "releases/v0.1.33/Anybox-0.1.33-x64.deb",
        "updates/linux/x64/Anybox-0.1.33-x64.AppImage",
        "updates/linux/x64/Anybox-0.1.33-x64.deb",
        "updates/linux/x64/latest-linux.yml",
      ],
    )
  } finally {
    rmSync(candidate.directory, { force: true, recursive: true })
  }
})

test("Linux update feed rejects a missing Debian package", () => {
  const candidate = makeLinuxCandidate({ includeDebian: false })

  try {
    assert.throws(
      () => buildLinuxUpdateFeedUploads(baseArgs, { linux: candidate.appImage }),
      /Missing Linux Debian package/,
    )
  } finally {
    rmSync(candidate.directory, { force: true, recursive: true })
  }
})
