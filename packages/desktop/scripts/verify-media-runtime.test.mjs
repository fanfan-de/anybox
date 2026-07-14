import assert from "node:assert/strict"
import { createHash } from "node:crypto"
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
import { copyExternalTools, prepareMediaTools, resolveMediaToolsPreparation } from "./prepare-media-tools.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const lock = JSON.parse(fs.readFileSync(path.resolve(scriptDir, "..", "media-runtime.lock.json"), "utf8"))

function completedTarget(target, platform, arch) {
  const result = structuredClone(target)
  delete result.artifactStatus
  delete result.approvalEvidence
  result.runtimeID = `ffmpeg-anybox-${platform}-${arch}-lgpl-test`
  result.releaseReadiness = {
    status: "blocked",
    releaseKind: "initial",
    reasons: ["Test target remains blocked until the test supplies approval evidence."],
  }
  result.licensePolicy.reviewStatus = "pending"
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
  const evidenceFile = (fileName) => ({ fileName, sizeBytes: 1_024, sha256: "6".repeat(64) })
  result.buildEvidence = {
    candidateSmoke: {
      render: {
        durationSeconds: 1,
        videoCodec: "h264",
        audioCodec: "aac",
        output: evidenceFile("evidence/smoke.mp4"),
        probe: evidenceFile("evidence/smoke.ffprobe.json"),
      },
      subtitle: {
        durationSeconds: 1,
        videoCodec: "h264",
        renderer: "libass",
        fontSha256: lock.subtitleRuntimeSources.font.sha256,
        output: evidenceFile("evidence/subtitle-smoke.mp4"),
        probe: evidenceFile("evidence/subtitle-smoke.ffprobe.json"),
        script: evidenceFile("evidence/subtitle-smoke.ass"),
        frame: evidenceFile("evidence/subtitle-smoke.png"),
      },
    },
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
  assert.equal(windows.status, "ready")
  assert.equal(windows.preparerID, "locked-archive-win32-x64")
  assert.equal(windows.target, lock.platforms.win32.targets.x64)

  const darwin = resolveMediaToolsPreparation(lock, "darwin", "arm64")
  assert.equal(darwin.status, "ready")
  assert.equal(darwin.preparerID, "locked-archive-darwin-arm64")
  assert.equal(darwin.target, lock.platforms.darwin.targets.arm64)

  const windowsBeta = resolveMediaToolsPreparation(lock, "win32", "x64", { externalTools: true })
  assert.equal(windowsBeta.status, "ready")
  assert.equal(windowsBeta.preparerID, "external-beta-win32-x64")

  const darwinBeta = resolveMediaToolsPreparation(lock, "darwin", "arm64", { externalTools: true })
  assert.equal(darwinBeta.status, "ready")
  assert.equal(darwinBeta.preparerID, "external-beta-darwin-arm64")

  const linux = resolveMediaToolsPreparation(lock, "linux", "x64")
  assert.equal(linux.status, "ready")
  assert.equal(linux.preparerID, "locked-archive-linux-x64")
  assert.equal(linux.target, lock.platforms.linux.targets.x64)

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-media-pending-test-"))
  const runtimeDir = path.join(root, "runtime")
  const pendingLockPath = path.join(root, "media-runtime.lock.json")
  const pendingLock = structuredClone(lock)
  const pendingTarget = pendingLock.platforms.win32.targets.x64
  pendingTarget.artifactStatus = "pending"
  delete pendingTarget.distribution
  delete pendingTarget.binaries
  delete pendingTarget.buildEvidence
  fs.writeFileSync(pendingLockPath, `${JSON.stringify(pendingLock, null, 2)}\n`)
  const staleDir = path.join(runtimeDir, "media-tools")
  fs.mkdirSync(staleDir, { recursive: true })
  fs.writeFileSync(path.join(staleDir, "manifest.json"), "{}")
  try {
    await prepareMediaTools({
      runtimeDir,
      lockPath: pendingLockPath,
      platform: "win32",
      arch: "x64",
    })
    assert.equal(fs.existsSync(staleDir), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("beta media materials copy the reviewed subtitle font and OFL license", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-media-beta-materials-test-"))
  const inputs = path.join(root, "inputs")
  const materials = path.join(root, "materials")
  const target = path.join(root, "target")
  fs.mkdirSync(path.join(materials, "fonts"), { recursive: true })
  fs.mkdirSync(inputs, { recursive: true })
  fs.writeFileSync(path.join(inputs, "ffmpeg.exe"), "ffmpeg")
  fs.writeFileSync(path.join(inputs, "ffprobe.exe"), "ffprobe")
  for (const name of ["LICENSE.txt", "THIRD-PARTY-NOTICES.txt", "configure.txt", "SOURCE.txt", "BUILD-RECIPE.sh"]) {
    fs.writeFileSync(path.join(materials, name), name)
  }
  const font = Buffer.from("reviewed font fixture")
  const fontSha256 = createHash("sha256").update(font).digest("hex")
  fs.writeFileSync(path.join(materials, "fonts", "NotoSansCJKsc-Regular.otf"), font)
  fs.writeFileSync(path.join(materials, "fonts", "OFL-1.1.txt"), "SIL OPEN FONT LICENSE")
  try {
    await copyExternalTools(
      path.join(inputs, "ffmpeg.exe"),
      path.join(inputs, "ffprobe.exe"),
      target,
      { ffmpeg: "ffmpeg.exe", ffprobe: "ffprobe.exe" },
      materials,
      [{ fileName: "fonts/NotoSansCJKsc-Regular.otf", sha256: fontSha256 }],
    )
    assert.deepEqual(fs.readFileSync(path.join(target, "fonts", "NotoSansCJKsc-Regular.otf")), font)
    assert.match(fs.readFileSync(path.join(target, "fonts", "OFL-1.1.txt"), "utf8"), /OPEN FONT LICENSE/)

    fs.rmSync(path.join(materials, "fonts", "OFL-1.1.txt"))
    await assert.rejects(
      () => copyExternalTools(
        path.join(inputs, "ffmpeg.exe"),
        path.join(inputs, "ffprobe.exe"),
        path.join(root, "missing-license-target"),
        { ffmpeg: "ffmpeg.exe", ffprobe: "ffprobe.exe" },
        materials,
        [{ fileName: "fonts/NotoSansCJKsc-Regular.otf", sha256: fontSha256 }],
      ),
      /fonts\/OFL-1\.1\.txt/,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("media runtime lock represents approved Windows, macOS, and Linux targets", () => {
  validateMediaRuntimeLock(lock)
  const target = resolveMediaRuntimeTarget(lock, "win32", "x64")
  assert.equal(target.origin, "anybox-controlled-lgpl")
  assert.equal(target.artifactStatus, undefined)
  assert.equal(target.distribution.releaseTag, "media-runtime-ffmpeg-8ad6288553-win32-x64-r2")
  assert.equal(target.distribution.ffmpegRevision, "8ad6288553")
  assert.equal(target.distribution.sha256, "b073f24a43f03ef2c180b64f7d223cf0b581be7122bc741669f959ceea431038")
  assert.equal(target.releaseReadiness.status, "approved")
  assert.equal(target.releaseReadiness.releaseKind, "initial")
  assert.equal(target.licensePolicy.reviewStatus, "approved")
  assert.equal(target.approvalEvidence.approver, "Anybox project owner (GitHub: fanfan-de)")
  assert.doesNotThrow(() => assertMediaRuntimeReleaseApproved(target, "win32", "x64"))
  const executableNames = resolveMediaExecutableNames(target, "win32", "x64")
  assert.deepEqual(executableNames, { ffmpeg: "ffmpeg.exe", ffprobe: "ffprobe.exe" })
  assert.deepEqual(target.requiredEncoders, ["h264_mf", "aac"])
  const darwin = resolveMediaRuntimeTarget(lock, "darwin", "arm64")
  assert.equal(darwin.artifactStatus, undefined)
  assert.equal(darwin.distribution.releaseTag, "media-runtime-ffmpeg-8ad6288553-darwin-arm64-r1")
  assert.equal(darwin.distribution.ffmpegRevision, "8ad6288553")
  assert.equal(darwin.distribution.sha256, "6270ee2960a0ad720377dd403525cd2e62b3a159cada3a7f9366550f830a3524")
  assert.equal(darwin.releaseReadiness.status, "approved")
  assert.equal(darwin.releaseReadiness.releaseKind, "initial")
  assert.equal(darwin.licensePolicy.reviewStatus, "approved")
  assert.equal(darwin.approvalEvidence.approver, "Anybox project owner (GitHub: fanfan-de)")
  assert.deepEqual(darwin.requiredEncoders, ["h264_videotoolbox", "aac"])
  assert.doesNotThrow(() => assertMediaRuntimeReleaseApproved(darwin, "darwin", "arm64"))
  const linux = resolveMediaRuntimeTarget(lock, "linux", "x64")
  assert.equal(linux.origin, "anybox-controlled-gpl")
  assert.equal(linux.artifactStatus, undefined)
  assert.equal(linux.distribution.releaseTag, "media-runtime-ffmpeg-8ad6288553-linux-x64-r1")
  assert.equal(linux.distribution.ffmpegRevision, "8ad6288553")
  assert.equal(linux.distribution.sha256, "3a9d46852a6caa2a03d1607d96542e78f9ca6cac5cba7728d7f18c90a01a2111")
  assert.equal(linux.releaseReadiness.status, "approved")
  assert.equal(linux.releaseReadiness.releaseKind, "initial")
  assert.equal(linux.licensePolicy.reviewStatus, "approved")
  assert.equal(linux.approvalEvidence.approver, "Anybox project owner (GitHub: fanfan-de)")
  assert.deepEqual(linux.requiredEncoders, ["libx264", "aac"])
  assert.doesNotThrow(() => assertMediaRuntimeReleaseApproved(linux, "linux", "x64"))
})

test("completed runtime targets require archive-bound render and subtitle smoke evidence", () => {
  const completedLock = structuredClone(lock)
  const target = completedTarget(completedLock.platforms.win32.targets.x64, "win32", "x64")
  completedLock.platforms.win32.targets.x64 = target
  assert.doesNotThrow(() => validateMediaRuntimeLock(completedLock))

  delete target.buildEvidence.candidateSmoke.subtitle.frame
  assert.throws(() => validateMediaRuntimeLock(completedLock), /subtitle frame has an invalid filename/)
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
  assert.match(packageJson.scripts.dist, /dist-release\.mjs/)

  assert.ok(packageJson.author?.email, "Linux deb packaging requires a maintainer email")
  assert.match(packageJson.homepage, /^https:\/\//)
  const builderConfig = fs.readFileSync(path.resolve(scriptDir, "..", "electron-builder.yml"), "utf8")
  assert.match(builderConfig, /linux:[\s\S]*artifactName: Anybox-\$\{version\}-x64\.\$\{ext\}/)
  const previewScript = fs.readFileSync(path.resolve(scriptDir, "dist-deliver-preview.mjs"), "utf8")
  assert.match(previewScript, /config\.linux\.artifactName=Anybox-Deliver-/)
  assert.match(previewScript, /rmSync\(path\.join\(desktopDir, "dist", outputDirectoryName\)/)
  assert.match(previewScript, /normalize-linux-update-metadata/)
  const releaseScript = fs.readFileSync(path.resolve(scriptDir, "dist-release.mjs"), "utf8")
  assert.match(releaseScript, /electronBuilderCLI, \.\.\.builderArgs, "--publish", "never"/)
  assert.match(releaseScript, /normalize-linux-update-metadata/)
})
