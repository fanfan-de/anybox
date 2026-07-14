import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { validateDeliverReleaseApproval } from "./verify-deliver-release-approval.mjs"
import { verifyDesktopReleaseCandidate } from "./verify-desktop-release-candidate.mjs"
import { normalizeLinuxUpdateMetadata } from "./normalize-linux-update-metadata.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function sha512Base64(value) {
  return createHash("sha512").update(value).digest("base64")
}

function approvedRelease() {
  const approval = (references) => ({
    status: "approved",
    approver: "release-board",
    approvedAt: "2026-07-11T00:00:00.000Z",
    references,
  })
  return {
    schemaVersion: 1,
    templateOnly: false,
    result: "approved",
    desktopVersion: "1.2.3",
    commitSHA: "abcdef0123456789",
    targets: {
      win32X64: { runtimeID: "runtime-win" },
      darwinArm64: { runtimeID: "runtime-mac" },
      linuxX64: { runtimeID: "runtime-linux" },
    },
    license: {
      ...approval(["evidence/license/approved"]),
      scopes: [
        "ffmpeg-redistribution", "h264-use", "windows-media-foundation", "macos-videotoolbox",
        "linux-libx264-gpl", "linux-gpl-corresponding-source",
        "source-and-notice-offer", "supported-os-scope",
      ],
    },
    product: {
      ...approval(["evidence/product/approved"]),
      retentionPolicyReference: "evidence/product/retention",
      cleanupAuthorizationReference: "evidence/product/cleanup",
      confirmationWord: "CLEAN",
      noAutomaticScheduling: true,
      telemetryReference: "evidence/product/telemetry",
    },
    security: {
      ...approval(["evidence/security/approved"]),
      retentionAndCleanupReference: "evidence/security/retention-cleanup",
      telemetryReference: "evidence/security/telemetry",
      monitoringReference: "evidence/security/monitoring",
    },
    rollback: {
      strategy: "disable-deliver",
      capability: "timelineDelivery",
      reference: "evidence/release/rollback",
    },
  }
}

test("release approval requires separate license, product, and security decisions", () => {
  const record = approvedRelease()
  assert.doesNotThrow(() => validateDeliverReleaseApproval(record))
  const missingScope = structuredClone(record)
  missingScope.license.scopes = missingScope.license.scopes.filter((scope) => scope !== "h264-use")
  assert.throws(() => validateDeliverReleaseApproval(missingScope), /h264-use/)
  const scheduled = structuredClone(record)
  scheduled.product.noAutomaticScheduling = false
  assert.throws(() => validateDeliverReleaseApproval(scheduled), /forbid automatic/)
})

test("desktop release manifest locks every published file and binds installed evidence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-release-candidate-test-"))
  const directory = path.join(root, "candidate")
  fs.mkdirSync(directory)
  try {
    const installerBody = Buffer.from("signed-installer-test")
    const blockmapBody = Buffer.from("blockmap-test")
    const metadataBody = `version: 1.2.3\npath: Anybox-1.2.3-x64.exe\nsha512: ${sha512Base64(installerBody)}\nsize: ${installerBody.length}\n`
    fs.writeFileSync(path.join(directory, "Anybox-1.2.3-x64.exe"), installerBody)
    fs.writeFileSync(path.join(directory, "Anybox-1.2.3-x64.exe.blockmap"), blockmapBody)
    fs.writeFileSync(path.join(directory, "latest.yml"), metadataBody)
    const manifest = {
      schemaVersion: 1,
      classification: "signed-release-candidate",
      platform: "win32",
      arch: "x64",
      desktopVersion: "1.2.3",
      commitSHA: "abcdef0123456789",
      primaryInstaller: "Anybox-1.2.3-x64.exe",
      files: [
        { fileName: "Anybox-1.2.3-x64.exe", sizeBytes: installerBody.length, sha256: sha256(installerBody) },
        { fileName: "Anybox-1.2.3-x64.exe.blockmap", sizeBytes: blockmapBody.length, sha256: sha256(blockmapBody) },
        { fileName: "latest.yml", sizeBytes: Buffer.byteLength(metadataBody), sha256: sha256(metadataBody) },
      ],
    }
    const evidence = {
      build: {
        artifactFileName: manifest.primaryInstaller,
        artifactSHA256: manifest.files[0].sha256,
        desktopVersion: manifest.desktopVersion,
        commitSHA: manifest.commitSHA,
      },
      host: { platform: "win32", architecture: "x64" },
    }
    const manifestPath = path.join(directory, "candidate-manifest.json")
    const evidencePath = path.join(root, "evidence.json")
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    fs.writeFileSync(evidencePath, JSON.stringify(evidence))
    await assert.doesNotReject(() => verifyDesktopReleaseCandidate({ manifestPath, directory, evidencePath }))
    fs.writeFileSync(path.join(directory, "unlocked.txt"), "unexpected")
    await assert.rejects(() => verifyDesktopReleaseCandidate({ manifestPath, directory, evidencePath }), /missing or extra files/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("Linux release manifest requires an AppImage with embedded updater blockmap metadata and a deb installer", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-linux-release-candidate-test-"))
  const directory = path.join(root, "candidate")
  fs.mkdirSync(directory)
  try {
    const appImageName = "Anybox-1.2.3-x64.AppImage"
    const debName = "Anybox-1.2.3-x64.deb"
    const appImageBody = Buffer.from("linux-appimage-test")
    const debBody = Buffer.from("linux-deb-test")
    const metadataBody = [
      "version: 1.2.3",
      "files:",
      `  - url: ${appImageName}`,
      `    sha512: ${sha512Base64(appImageBody)}`,
      `    size: ${appImageBody.length}`,
      "    blockMapSize: 123",
      `  - url: ${debName}`,
      `    sha512: ${sha512Base64(debBody)}`,
      `    size: ${debBody.length}`,
      `path: ${appImageName}`,
      `sha512: ${sha512Base64(appImageBody)}`,
      "",
    ].join("\n")
    const files = new Map([
      [appImageName, appImageBody],
      [debName, debBody],
      ["latest-linux.yml", Buffer.from(metadataBody)],
    ])
    for (const [fileName, body] of files) fs.writeFileSync(path.join(directory, fileName), body)
    const manifest = {
      schemaVersion: 1,
      classification: "signed-release-candidate",
      platform: "linux",
      arch: "x64",
      desktopVersion: "1.2.3",
      commitSHA: "abcdef0123456789",
      primaryInstaller: appImageName,
      files: Array.from(files, ([fileName, body]) => ({
        fileName,
        sizeBytes: body.length,
        sha256: sha256(body),
      })),
    }
    const evidence = {
      build: {
        artifactFileName: appImageName,
        artifactSHA256: sha256(appImageBody),
        desktopVersion: manifest.desktopVersion,
        commitSHA: manifest.commitSHA,
      },
      host: { platform: "linux", architecture: "x64" },
    }
    const manifestPath = path.join(directory, "candidate-manifest.json")
    const evidencePath = path.join(root, "evidence.json")
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    fs.writeFileSync(evidencePath, JSON.stringify(evidence))
    await assert.doesNotReject(() => verifyDesktopReleaseCandidate({ manifestPath, directory, evidencePath }))

    fs.rmSync(path.join(directory, debName))
    await assert.rejects(
      () => verifyDesktopReleaseCandidate({ manifestPath, directory, evidencePath }),
      /missing or extra files/,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("Linux updater metadata normalization removes only byte-identical duplicate file entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-linux-update-normalize-test-"))
  const metadataPath = path.join(root, "latest-linux.yml")
  const appImageEntry = [
    "  - url: Anybox-1.2.3-x64.AppImage",
    "    sha512: appimage-sha",
    "    size: 100",
    "    blockMapSize: 10",
  ]
  const debEntry = [
    "  - url: Anybox-1.2.3-x64.deb",
    "    sha512: deb-sha",
    "    size: 50",
  ]
  try {
    fs.writeFileSync(metadataPath, [
      "version: 1.2.3",
      "files:",
      ...appImageEntry,
      ...debEntry,
      ...debEntry,
      "path: Anybox-1.2.3-x64.AppImage",
      "sha512: appimage-sha",
      "",
    ].join("\n"))
    const result = normalizeLinuxUpdateMetadata(metadataPath)
    assert.equal(result.changed, true)
    assert.deepEqual(result.urls, ["Anybox-1.2.3-x64.AppImage", "Anybox-1.2.3-x64.deb"])
    assert.equal((fs.readFileSync(metadataPath, "utf8").match(/Anybox-1\.2\.3-x64\.deb/g) || []).length, 1)

    fs.writeFileSync(metadataPath, [
      "version: 1.2.3",
      "files:",
      ...appImageEntry,
      ...debEntry,
      ...debEntry.slice(0, -1),
      "    size: 51",
      "path: Anybox-1.2.3-x64.AppImage",
      "sha512: appimage-sha",
      "",
    ].join("\n"))
    assert.throws(() => normalizeLinuxUpdateMetadata(metadataPath), /conflicting update metadata/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("stapled DMG refresh rebuilds its blockmap and updates the matching sha512 and size", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-update-metadata-test-"))
  try {
    const payload = path.join(root, "Anybox-1.2.3-arm64.dmg")
    const blockmap = `${payload}.blockmap`
    const metadata = path.join(root, "latest-mac.yml")
    fs.writeFileSync(payload, "stapled-dmg")
    fs.writeFileSync(blockmap, "stale-blockmap")
    fs.writeFileSync(metadata, [
      "version: 1.2.3",
      "files:",
      "  - url: Anybox-1.2.3-arm64.dmg",
      "    sha512: stale",
      "    size: 1",
      "path: Anybox-1.2.3-arm64.zip",
      "sha512: unchanged",
      "",
    ].join("\n"))
    const result = spawnSync(process.execPath, [
      path.join(scriptDir, "refresh-electron-update-metadata.mjs"), metadata, payload,
    ], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.notEqual(fs.readFileSync(blockmap, "utf8"), "stale-blockmap")
    assert.ok(fs.statSync(blockmap).size > 0)
    const refreshed = fs.readFileSync(metadata, "utf8")
    assert.match(refreshed, new RegExp(sha512Base64("stapled-dmg")))
    assert.match(refreshed, /size: 11/)
    assert.match(refreshed, /sha512: unchanged/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
