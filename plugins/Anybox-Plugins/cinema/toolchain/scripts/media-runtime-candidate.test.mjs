import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = path.resolve(scriptDir, "..", "..")
const buildScript = path.join(scriptDir, "build-media-runtime.sh")
const describeScript = path.join(scriptDir, "describe-media-runtime-candidate.mjs")
const promoteScript = path.join(scriptDir, "promote-media-runtime-candidate.mjs")
const runtimeLock = JSON.parse(fs.readFileSync(path.join(pluginDir, "toolchain.lock.json"), "utf8"))

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", windowsHide: true })
}

function write(root, relativePath, value = relativePath) {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, value)
  return filePath
}

function describedCandidateFile(root, fileName, value = fileName) {
  const filePath = write(root, fileName, value)
  const body = fs.readFileSync(filePath)
  return { fileName, sizeBytes: body.length, sha256: createHash("sha256").update(body).digest("hex") }
}

function promotionCandidate(root, platform = "win32") {
  const sources = runtimeLock.subtitleRuntimeSources
  const stage = path.join(root, "stage")
  const linux = platform === "linux"
  const x264Revision = "b35605ace3ddf7c1a5d67a2eb553f034aef41d55"
  return {
    schemaVersion: 1,
    classification: "unapproved-candidate",
    platform,
    arch: "x64",
    ffmpegRevision: "8ad6288553",
    archive: describedCandidateFile(root, "runtime.tar.gz", "candidate archive"),
    executables: linux ? { ffmpeg: "ffmpeg", ffprobe: "ffprobe" } : { ffmpeg: "ffmpeg.exe", ffprobe: "ffprobe.exe" },
    binaries: linux
      ? { ffmpeg: { sha256: "2".repeat(64) }, ffprobe: { sha256: "3".repeat(64) } }
      : { "ffmpeg.exe": { sha256: "2".repeat(64) }, "ffprobe.exe": { sha256: "3".repeat(64) } },
    materials: {
      license: { fileName: "LICENSE.txt", sha256: "4".repeat(64) },
      notices: { fileName: "THIRD-PARTY-NOTICES.txt", sha256: "4".repeat(64) },
      source: { fileName: "ffmpeg-source.tar.gz", sizeBytes: 2_048, sha256: "4".repeat(64) },
      buildRecipe: { fileName: "build-media-runtime.sh", sizeBytes: 4_096, sha256: "5".repeat(64) },
      subtitleFont: { fileName: "fonts/NotoSansCJKsc-Regular.otf", sha256: sources.font.sha256 },
      ...(linux ? {
        componentSources: {
          x264: {
            revision: x264Revision,
            ...describedCandidateFile(root, `x264-source-${x264Revision}.tar.gz`),
          },
          zlib: {
            version: runtimeLock.mediaRuntimeSources.zlib.version,
            ...describedCandidateFile(root, `zlib-source-${runtimeLock.mediaRuntimeSources.zlib.version}.tar.gz`),
          },
        },
        componentLicenses: {
          x264: describedCandidateFile(stage, "X264-LICENSE.txt"),
          zlib: describedCandidateFile(stage, "ZLIB-LICENSE.txt"),
        },
      } : {}),
    },
    subtitleRuntime: {
      renderer: "libass",
      requiredFilter: "ass",
      dependencies: {
        libass: { version: sources.libass.version, sha256: sources.libass.sha256 },
        freetype: { version: sources.freetype.version, sha256: sources.freetype.sha256 },
        fribidi: { version: sources.fribidi.version, sha256: sources.fribidi.sha256 },
        harfbuzz: { version: sources.harfbuzz.version, sha256: sources.harfbuzz.sha256 },
        notoSansCjkSc: { version: sources.font.version, sha256: sources.font.sha256, license: "OFL-1.1" },
      },
    },
    smokeEvidence: {
      render: {
        durationSeconds: 1,
        videoCodec: "h264",
        audioCodec: "aac",
        output: describedCandidateFile(stage, "evidence/smoke.mp4"),
        probe: describedCandidateFile(stage, "evidence/smoke.ffprobe.json"),
      },
      subtitle: {
        durationSeconds: 1,
        videoCodec: "h264",
        renderer: "libass",
        fontSha256: sources.font.sha256,
        output: describedCandidateFile(stage, "evidence/subtitle-smoke.mp4"),
        probe: describedCandidateFile(stage, "evidence/subtitle-smoke.ffprobe.json"),
        script: describedCandidateFile(stage, "evidence/subtitle-smoke.ass"),
        frame: describedCandidateFile(stage, "evidence/subtitle-smoke.png"),
      },
    },
  }
}

test("candidate notices remain fail-closed without permanently forbidding an approved archive", () => {
  const script = fs.readFileSync(buildScript, "utf8")
  assert.match(script, /configure_prefix="\/opt\/anybox\/media-runtime\/\$\{platform\}-\$\{arch\}"/)
  assert.doesNotMatch(script, /--prefix=\$\{prefix_dir\}/)
  assert.match(script, /Release authorization is recorded outside this archive/)
  assert.match(script, /releaseReadiness\.status/)
  assert.match(script, /licensePolicy\.reviewStatus/)
  assert.doesNotMatch(script, /This is an unapproved candidate\. It must not be published/)
  assert.match(script, /Cinema 字幕 smoke/)
})

test("candidate descriptor binds render and subtitle smoke files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-media-describe-test-"))
  try {
    const stage = path.join(root, "stage")
    for (const relativePath of [
      "ffmpeg.exe", "ffprobe.exe", "LICENSE.txt", "THIRD-PARTY-NOTICES.txt", "configure.txt", "SOURCE.txt",
      "fonts/NotoSansCJKsc-Regular.otf", "fonts/OFL-1.1.txt", "evidence/smoke.mp4",
      "evidence/subtitle-smoke.mp4", "evidence/subtitle-smoke.ass", "evidence/subtitle-smoke.png",
    ]) write(stage, relativePath)
    const renderProbe = { streams: [{ codec_type: "video", codec_name: "h264" }, { codec_type: "audio", codec_name: "aac" }], format: { duration: "1.000000" } }
    const subtitleProbe = { streams: [{ codec_type: "video", codec_name: "h264" }], format: { duration: "1.000000" } }
    write(stage, "evidence/smoke.ffprobe.json", JSON.stringify(renderProbe))
    write(stage, "evidence/subtitle-smoke.ffprobe.json", JSON.stringify(subtitleProbe))
    const archive = write(root, "runtime.tar.gz")
    const source = write(root, "source.tar.gz")
    const recipe = write(root, "build-media-runtime.sh")
    const output = path.join(root, "candidate.json")
    const result = run(describeScript, [
      "--platform", "win32", "--arch", "x64", "--stage", stage, "--archive", archive,
      "--source", source, "--recipe", recipe, "--output", output, "--revision", "8ad6288553",
    ])
    assert.equal(result.status, 0, result.stderr)
    const candidate = JSON.parse(fs.readFileSync(output, "utf8"))
    assert.equal(candidate.smokeEvidence.render.audioCodec, "aac")
    assert.equal(candidate.smokeEvidence.subtitle.renderer, "libass")
    assert.equal(candidate.smokeEvidence.subtitle.frame.fileName, "evidence/subtitle-smoke.png")

    fs.rmSync(path.join(stage, "evidence", "subtitle-smoke.png"))
    const missingFrame = run(describeScript, [
      "--platform", "win32", "--arch", "x64", "--stage", stage, "--archive", archive,
      "--source", source, "--recipe", recipe, "--output", output, "--revision", "8ad6288553",
    ])
    assert.notEqual(missingFrame.status, 0)
    assert.match(missingFrame.stderr, /subtitleSmokeFrame/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("Linux candidate descriptor binds pinned x264 and zlib source/license materials", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-media-linux-describe-test-"))
  try {
    const stage = path.join(root, "stage")
    for (const relativePath of [
      "ffmpeg", "ffprobe", "LICENSE.txt", "X264-LICENSE.txt", "ZLIB-LICENSE.txt", "THIRD-PARTY-NOTICES.txt", "configure.txt", "SOURCE.txt",
      "fonts/NotoSansCJKsc-Regular.otf", "fonts/OFL-1.1.txt", "evidence/smoke.mp4",
      "evidence/subtitle-smoke.mp4", "evidence/subtitle-smoke.ass", "evidence/subtitle-smoke.png",
    ]) write(stage, relativePath)
    write(stage, "evidence/smoke.ffprobe.json", JSON.stringify({
      streams: [{ codec_type: "video", codec_name: "h264" }, { codec_type: "audio", codec_name: "aac" }],
      format: { duration: "1.000000" },
    }))
    write(stage, "evidence/subtitle-smoke.ffprobe.json", JSON.stringify({
      streams: [{ codec_type: "video", codec_name: "h264" }],
      format: { duration: "1.000000" },
    }))
    const archive = write(root, "runtime.tar.gz")
    const source = write(root, "ffmpeg-source.tar.gz")
    const x264Revision = "b35605ace3ddf7c1a5d67a2eb553f034aef41d55"
    const x264Source = write(root, `x264-source-${x264Revision}.tar.gz`)
    const zlibVersion = "1.3.1"
    const zlibSource = write(root, `zlib-source-${zlibVersion}.tar.gz`)
    const recipe = write(root, "build-media-runtime.sh")
    const output = path.join(root, "candidate.json")
    const result = run(describeScript, [
      "--platform", "linux", "--arch", "x64", "--stage", stage, "--archive", archive,
      "--source", source, "--x264-source", x264Source, "--x264-revision", x264Revision,
      "--zlib-source", zlibSource, "--zlib-version", zlibVersion,
      "--recipe", recipe, "--output", output, "--revision", "8ad6288553",
    ])
    assert.equal(result.status, 0, result.stderr)
    const candidate = JSON.parse(fs.readFileSync(output, "utf8"))
    assert.equal(candidate.materials.componentSources.x264.revision, x264Revision)
    assert.equal(candidate.materials.componentSources.x264.fileName, path.basename(x264Source))
    assert.equal(candidate.materials.componentLicenses.x264.fileName, "X264-LICENSE.txt")
    assert.equal(candidate.materials.componentSources.zlib.version, zlibVersion)
    assert.equal(candidate.materials.componentSources.zlib.fileName, path.basename(zlibSource))
    assert.equal(candidate.materials.componentLicenses.zlib.fileName, "ZLIB-LICENSE.txt")

    const missingX264 = run(describeScript, [
      "--platform", "linux", "--arch", "x64", "--stage", stage, "--archive", archive,
      "--source", source, "--recipe", recipe, "--output", output, "--revision", "8ad6288553",
    ])
    assert.notEqual(missingX264.status, 0)
    assert.match(missingX264.stderr, /require pinned x264 and zlib source arguments/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("candidate promotion rejects missing smoke evidence and preserves valid evidence in the lock", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-media-promote-test-"))
  try {
    const lockPath = write(root, "media-runtime.lock.json", `${JSON.stringify(runtimeLock, null, 2)}\n`)
    const candidate = promotionCandidate(root)
    const candidatePath = write(root, "candidate.json", `${JSON.stringify(candidate, null, 2)}\n`)
    const args = [
      "--candidate", candidatePath, "--runtime-id", "ffmpeg-anybox-win32-x64-test",
      "--release-tag", "test-runtime", "--url", "https://example.invalid/runtime.tar.gz",
      "--source-url", "https://example.invalid/source.tar.gz", "--build-source-url", "https://example.invalid/build.sh",
      "--lock", lockPath,
    ]
    const promoted = run(promoteScript, args)
    assert.equal(promoted.status, 0, promoted.stderr)
    const promotedLock = JSON.parse(fs.readFileSync(lockPath, "utf8"))
    assert.equal(
      promotedLock.platforms.win32.targets.x64.buildEvidence.candidateSmoke.subtitle.frame.sha256,
      candidate.smokeEvidence.subtitle.frame.sha256,
    )

    fs.writeFileSync(lockPath, `${JSON.stringify(runtimeLock, null, 2)}\n`)
    delete candidate.smokeEvidence.subtitle.frame
    fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`)
    const rejected = run(promoteScript, args)
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /subtitle smoke frame filename is invalid/i)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("Linux candidate promotion records GPL policy and immutable x264/zlib sources", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anybox-media-linux-promote-test-"))
  try {
    const candidate = promotionCandidate(root, "linux")
    const testLock = structuredClone(runtimeLock)
    testLock.mediaRuntimeSources.zlib.sha256 = candidate.materials.componentSources.zlib.sha256
    const lockPath = write(root, "media-runtime.lock.json", `${JSON.stringify(testLock, null, 2)}\n`)
    const candidatePath = write(root, "candidate.json", `${JSON.stringify(candidate, null, 2)}\n`)
    const promoted = run(promoteScript, [
      "--candidate", candidatePath, "--runtime-id", "ffmpeg-anybox-linux-x64-gpl-test",
      "--release-tag", "test-linux-runtime", "--url", "https://example.invalid/runtime.tar.gz",
      "--source-url", "https://example.invalid/ffmpeg-source.tar.gz",
      "--x264-source-url", "https://example.invalid/x264-source.tar.gz",
      "--zlib-source-url", "https://example.invalid/zlib-source.tar.gz",
      "--build-source-url", "https://example.invalid/build.sh", "--lock", lockPath,
    ])
    assert.equal(promoted.status, 0, promoted.stderr)
    const target = JSON.parse(fs.readFileSync(lockPath, "utf8")).platforms.linux.targets.x64
    assert.equal(target.origin, "anybox-controlled-gpl")
    assert.equal(target.licensePolicy.spdxExpression, "GPL-3.0-or-later")
    assert.equal(target.licensePolicy.componentLicenseFiles.x264.fileName, "X264-LICENSE.txt")
    assert.equal(target.licensePolicy.componentLicenseFiles.zlib.fileName, "ZLIB-LICENSE.txt")
    assert.equal(target.distribution.componentSources.x264.revision, candidate.materials.componentSources.x264.revision)
    assert.equal(target.distribution.componentSources.x264.url, "https://example.invalid/x264-source.tar.gz")
    assert.equal(target.distribution.componentSources.zlib.version, candidate.materials.componentSources.zlib.version)
    assert.equal(target.distribution.componentSources.zlib.url, "https://example.invalid/zlib-source.tar.gz")
    assert.deepEqual(target.requiredEncoders, ["libx264", "aac"])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
