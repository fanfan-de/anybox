import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  assertBuildConfigurationPolicy,
  assertManifestMatchesTarget,
  assertMediaRuntimeApprovalEvidence,
  assertMediaRuntimeReleaseApproved,
  resolveMediaExecutableNames,
  resolveMediaRuntimeTarget,
  validateMediaRuntimeLock,
} from "./verify-media-runtime.mjs"
import { prepareMediaTools, resolveMediaToolsPreparation } from "./prepare-media-tools.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const lock = JSON.parse(fs.readFileSync(path.resolve(scriptDir, "..", "media-runtime.lock.json"), "utf8"))

function completedTarget(target, platform, arch) {
  const result = structuredClone(target)
  delete result.artifactStatus
  result.runtimeID = `ffmpeg-anybox-${platform}-${arch}-lgpl-test`
  result.distribution = {
    releaseTag: "test-candidate",
    ffmpegRevision: "8ad6288553",
    fileName: `ffmpeg-anybox-${platform}-${arch}-lgpl.tar.gz`,
    sha256: "1".repeat(64),
    sizeBytes: 1_024,
    url: `https://artifacts.example.invalid/immutable/${platform}/${arch}/runtime.tar.gz`,
    sourceURL: "https://github.com/FFmpeg/FFmpeg/commit/8ad6288553",
    buildSourceURL: "https://evidence.example.invalid/build-recipe/test",
    source: {
      fileName: "ffmpeg-source-8ad6288553.tar.gz",
      sizeBytes: 2_048,
      sha256: "4".repeat(64),
    },
    buildSource: {
      fileName: "build-media-runtime.sh",
      sizeBytes: 4_096,
      sha256: "5".repeat(64),
    },
  }
  result.binaries = {
    [result.executables.ffmpeg]: { sha256: "2".repeat(64) },
    [result.executables.ffprobe]: { sha256: "3".repeat(64) },
  }
  return result
}

function approvalEvidenceFor(target) {
  return {
    approver: "anybox-release-board-test",
    approvedAt: "2026-07-11T00:00:00.000Z",
    references: [
      "https://evidence.example.invalid/media-runtime/license-review/test-record",
      "https://evidence.example.invalid/media-runtime/release-review/test-record",
    ],
    immutableMirror: {
      reference: "https://artifacts.example.invalid/immutable/media-runtime/test-manifest.json",
      sha256: target.distribution.sha256,
    },
    rollbackPlan: target.releaseReadiness.releaseKind === "initial"
      ? {
          strategy: "disable-deliver",
          capability: "timelineDelivery",
          reference: "https://evidence.example.invalid/media-runtime/rollback/disable-deliver-test-record",
        }
      : {
          strategy: "previous-approved-runtime",
          runtimeID: target.releaseReadiness.previousRuntimeID,
          reference: "https://evidence.example.invalid/media-runtime/rollback/previous-runtime-test-record",
        },
  }
}

test("media preparation resolves locked targets through explicit preparers", () => {
  const windows = resolveMediaToolsPreparation(lock, "win32", "x64")
  assert.equal(windows.status, "skipped")
  assert.equal(windows.reason, "artifact-pending")
  assert.equal(windows.target, lock.platforms.win32.targets.x64)

  const darwin = resolveMediaToolsPreparation(lock, "darwin", "arm64")
  assert.equal(darwin.status, "skipped")
  assert.equal(darwin.reason, "artifact-pending")
  assert.equal(darwin.target, lock.platforms.darwin.targets.arm64)

  const windowsBeta = resolveMediaToolsPreparation(lock, "win32", "x64", { externalTools: true })
  assert.equal(windowsBeta.status, "ready")
  assert.equal(windowsBeta.preparerID, "external-beta-win32-x64")

  const darwinBeta = resolveMediaToolsPreparation(lock, "darwin", "arm64", { externalTools: true })
  assert.equal(darwinBeta.status, "ready")
  assert.equal(darwinBeta.preparerID, "external-beta-darwin-arm64")

  const linux = resolveMediaToolsPreparation(lock, "linux", "x64")
  assert.deepEqual(linux, {
    status: "skipped",
    reason: "blocked-platform",
    message: `[desktop][media] skipping bundled media tools for blocked target linux/x64: ${lock.platforms.linux.reason}`,
  })

  const futureLock = structuredClone(lock)
  futureLock.platforms.darwin.targets.arm64 = completedTarget(
    futureLock.platforms.darwin.targets.arm64,
    "darwin",
    "arm64",
  )
  const implemented = resolveMediaToolsPreparation(futureLock, "darwin", "arm64")
  assert.equal(implemented.status, "ready")
  assert.equal(implemented.preparerID, "locked-archive-darwin-arm64")
})

test("artifact-pending targets remove stale bundled media tools", async () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-media-pending-test-"))
  const staleDir = path.join(runtimeDir, "media-tools")
  fs.mkdirSync(staleDir, { recursive: true })
  fs.writeFileSync(path.join(staleDir, "manifest.json"), "{}")
  try {
    await prepareMediaTools({
      runtimeDir,
      lockPath: path.resolve(scriptDir, "..", "media-runtime.lock.json"),
      platform: "win32",
      arch: "x64",
    })
    assert.equal(fs.existsSync(staleDir), false)
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true })
  }
})

test("media runtime lock represents both Anybox candidates as pending and blocks Linux", () => {
  validateMediaRuntimeLock(lock)
  const target = resolveMediaRuntimeTarget(lock, "win32", "x64")
  assert.equal(target.origin, "anybox-controlled-lgpl")
  assert.equal(target.artifactStatus, "pending")
  assert.equal(target.releaseReadiness.status, "blocked")
  assert.equal(target.releaseReadiness.releaseKind, "initial")
  assert.equal(target.licensePolicy.reviewStatus, "pending")
  assert.equal(target.approvalEvidence, undefined)
  const executableNames = resolveMediaExecutableNames(target, "win32", "x64")
  assert.deepEqual(executableNames, { ffmpeg: "ffmpeg.exe", ffprobe: "ffprobe.exe" })
  assert.deepEqual(target.requiredEncoders, ["h264_mf", "aac"])
  const darwin = resolveMediaRuntimeTarget(lock, "darwin", "arm64")
  assert.equal(darwin.artifactStatus, "pending")
  assert.deepEqual(darwin.requiredEncoders, ["h264_videotoolbox", "aac"])
  assert.throws(() => assertMediaRuntimeReleaseApproved(darwin, "darwin", "arm64"), /not approved/)
  assert.throws(() => resolveMediaRuntimeTarget(lock, "linux", "x64"), /packaging is blocked/)
})

test("executable names come from each locked target", () => {
  const portableLock = structuredClone(lock)
  const portableTarget = completedTarget(resolveMediaRuntimeTarget(lock, "win32", "x64"), "darwin", "arm64")
  portableTarget.runtimeID = "ffmpeg-darwin-arm64-preview"
  portableTarget.executables = { ffmpeg: "ffmpeg", ffprobe: "ffprobe" }
  portableTarget.binaries = { ffmpeg: { sha256: "2".repeat(64) }, ffprobe: { sha256: "3".repeat(64) } }
  portableLock.platforms.darwin = {
    status: "supported",
    targets: { arm64: portableTarget },
  }

  assert.doesNotThrow(() => validateMediaRuntimeLock(portableLock))
  assert.deepEqual(resolveMediaExecutableNames(portableTarget, "darwin", "arm64"), {
    ffmpeg: "ffmpeg",
    ffprobe: "ffprobe",
  })

  portableTarget.executables.ffmpeg = "bin/ffmpeg"
  assert.throws(() => validateMediaRuntimeLock(portableLock), /valid FFmpeg executable name/)
})

test("release-strict approval is separate from technical preview validation", () => {
  const target = completedTarget(resolveMediaRuntimeTarget(lock, "win32", "x64"), "win32", "x64")
  assert.doesNotThrow(() => validateMediaRuntimeLock(lock))
  assert.throws(
    () => assertMediaRuntimeReleaseApproved(target, "win32", "x64"),
    /releaseReadiness=blocked/,
  )

  const approvedTarget = structuredClone(target)
  approvedTarget.releaseReadiness = { status: "approved", releaseKind: "initial" }
  assert.throws(
    () => assertMediaRuntimeReleaseApproved(approvedTarget, "win32", "x64"),
    /licenseReview=pending/,
  )
  approvedTarget.licensePolicy.reviewStatus = "approved"
  assert.throws(
    () => assertMediaRuntimeReleaseApproved(approvedTarget, "win32", "x64"),
    /has no approval evidence/,
  )
  approvedTarget.approvalEvidence = approvalEvidenceFor(approvedTarget)
  assert.doesNotThrow(() => assertMediaRuntimeApprovalEvidence(approvedTarget, "win32", "x64"))
  assert.doesNotThrow(() => assertMediaRuntimeReleaseApproved(approvedTarget, "win32", "x64"))
})

test("approved targets require complete machine-readable approval evidence", () => {
  const approvedLock = structuredClone(lock)
  const target = completedTarget(approvedLock.platforms.win32.targets.x64, "win32", "x64")
  approvedLock.platforms.win32.targets.x64 = target
  target.releaseReadiness = { status: "approved", releaseKind: "initial" }
  target.licensePolicy.reviewStatus = "approved"

  assert.throws(() => validateMediaRuntimeLock(approvedLock), /has no approval evidence/)
  target.approvalEvidence = approvalEvidenceFor(target)
  assert.doesNotThrow(() => validateMediaRuntimeLock(approvedLock))

  const invalidCases = [
    ["approver", (evidence) => { evidence.approver = "" }, /valid approver/],
    ["approvedAt", (evidence) => { evidence.approvedAt = "not-a-date" }, /approvedAt timestamp/],
    ["references", (evidence) => { evidence.references = [] }, /evidence references/],
    ["immutable mirror", (evidence) => { delete evidence.immutableMirror.reference }, /immutable mirror reference/],
    ["mirror digest", (evidence) => { evidence.immutableMirror.sha256 = "0".repeat(64) }, /mirror digest/],
    ["rollback strategy", (evidence) => { evidence.rollbackPlan.strategy = "previous-approved-runtime" }, /disable-Deliver rollback plan/],
    ["rollback capability", (evidence) => { evidence.rollbackPlan.capability = "timelineEditing" }, /disable-Deliver rollback plan/],
    ["rollback reference", (evidence) => { delete evidence.rollbackPlan.reference }, /initial-release rollback reference/],
  ]
  for (const [label, mutate, expected] of invalidCases) {
    const candidate = structuredClone(approvedLock)
    mutate(candidate.platforms.win32.targets.x64.approvalEvidence)
    assert.throws(() => validateMediaRuntimeLock(candidate), expected, label)
  }
})

test("successor approvals bind rollback evidence to the previous approved runtime", () => {
  const successorLock = structuredClone(lock)
  const target = completedTarget(successorLock.platforms.win32.targets.x64, "win32", "x64")
  successorLock.platforms.win32.targets.x64 = target
  const previousRuntimeID = target.runtimeID
  target.runtimeID = `${target.runtimeID}-successor-test`
  target.releaseReadiness = {
    status: "approved",
    releaseKind: "successor",
    previousRuntimeID,
  }
  target.licensePolicy.reviewStatus = "approved"
  target.approvalEvidence = approvalEvidenceFor(target)

  assert.doesNotThrow(() => validateMediaRuntimeLock(successorLock))

  target.approvalEvidence.rollbackPlan.runtimeID = "ffmpeg-unrelated-approved-runtime"
  assert.throws(() => validateMediaRuntimeLock(successorLock), /previous approved rollback runtime ID/)
})

test("build configuration policy rejects forbidden flags and missing required flags", () => {
  const policy = {
    requiredFlags: ["--enable-libopenh264", "--disable-libx264"],
    forbiddenFlags: ["--enable-gpl", "--enable-libx264"],
  }
  assert.doesNotThrow(() => assertBuildConfigurationPolicy(new Set(policy.requiredFlags), policy))
  assert.throws(
    () => assertBuildConfigurationPolicy(new Set(["--enable-libopenh264"]), policy),
    /missing required flag --disable-libx264/,
  )
  assert.throws(
    () => assertBuildConfigurationPolicy(new Set([...policy.requiredFlags, "--enable-gpl"]), policy),
    /contains forbidden flag --enable-gpl/,
  )
})

test("manifest must carry the locked distribution and binary digests", () => {
  const target = completedTarget(resolveMediaRuntimeTarget(lock, "win32", "x64"), "win32", "x64")
  const manifest = {
    schemaVersion: target.manifestSchemaVersion,
    platform: "win32",
    arch: "x64",
    runtimeID: target.runtimeID,
    origin: target.origin,
    releaseReadiness: structuredClone(target.releaseReadiness),
    licensePolicy: structuredClone(target.licensePolicy),
    distribution: structuredClone(target.distribution),
    ...(target.approvalEvidence ? { approvalEvidence: structuredClone(target.approvalEvidence) } : {}),
    executables: structuredClone(target.executables),
    binaries: structuredClone(target.binaries),
  }
  assert.doesNotThrow(() => assertManifestMatchesTarget(manifest, target, "win32", "x64"))

  manifest.binaries["ffmpeg.exe"].sha256 = "0".repeat(64)
  assert.throws(
    () => assertManifestMatchesTarget(manifest, target, "win32", "x64"),
    /digest for ffmpeg\.exe does not match/,
  )
})

test("package commands keep preview verification separate and gate packaged releases", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(scriptDir, "..", "package.json"), "utf8"))
  assert.equal(packageJson.scripts["verify:agent-runtime"], "node ./scripts/verify-agent-runtime.mjs")
  assert.match(packageJson.scripts["verify:agent-runtime:release"], /--release-strict/)
  assert.match(packageJson.scripts["dist:deliver-beta"], /--beta/)
  for (const command of ["dist", "dist:publish", "dist:dir"]) {
    assert.match(packageJson.scripts[command], /verify:agent-runtime:release/)
  }
})
