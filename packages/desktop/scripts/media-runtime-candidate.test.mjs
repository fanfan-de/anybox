import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const describeScript = path.join(scriptDir, "describe-media-runtime-candidate.mjs")
const promoteScript = path.join(scriptDir, "promote-media-runtime-candidate.mjs")
const runtimeLock = JSON.parse(fs.readFileSync(path.join(desktopDir, "media-runtime.lock.json"), "utf8"))

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

function promotionCandidate(root) {
  const sources = runtimeLock.subtitleRuntimeSources
  const stage = path.join(root, "stage")
  return {
    schemaVersion: 1,
    classification: "unapproved-candidate",
    platform: "win32",
    arch: "x64",
    ffmpegRevision: "8ad6288553",
    archive: describedCandidateFile(root, "runtime.tar.gz", "candidate archive"),
    executables: { ffmpeg: "ffmpeg.exe", ffprobe: "ffprobe.exe" },
    binaries: { "ffmpeg.exe": { sha256: "2".repeat(64) }, "ffprobe.exe": { sha256: "3".repeat(64) } },
    materials: {
      license: { fileName: "LICENSE.txt", sha256: "4".repeat(64) },
      notices: { fileName: "THIRD-PARTY-NOTICES.txt", sha256: "4".repeat(64) },
      source: { fileName: "ffmpeg-source.tar.gz", sizeBytes: 2_048, sha256: "4".repeat(64) },
      buildRecipe: { fileName: "build-media-runtime.sh", sizeBytes: 4_096, sha256: "5".repeat(64) },
      subtitleFont: { fileName: "fonts/NotoSansCJKsc-Regular.otf", sha256: sources.font.sha256 },
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
