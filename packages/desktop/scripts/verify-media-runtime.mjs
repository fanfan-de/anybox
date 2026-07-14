import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const defaultRuntimeDir = path.join(desktopDir, "build", "agent-runtime")
const defaultLockPath = path.join(desktopDir, "media-runtime.lock.json")
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const LOCKED_PLATFORMS = ["win32", "darwin", "linux"]
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function isFileName(value) {
  return typeof value === "string" && value.length > 0 && !/[\\/]/.test(value) && value !== "." && value !== ".."
}

function isEvidenceReference(value) {
  return typeof value === "string"
    && value.trim() === value
    && value.length > 0
    && value.length <= 2_048
    && !/[\u0000-\u001f\u007f]/.test(value)
}

function isISODateTime(value) {
  return typeof value === "string"
    && ISO_DATETIME_PATTERN.test(value)
    && Number.isFinite(Date.parse(value))
}

function assertSmokeEvidenceFile(value, expectedFileName, prefix) {
  invariant(value?.fileName === expectedFileName, `${prefix} has an invalid filename`)
  invariant(Number.isSafeInteger(value.sizeBytes) && value.sizeBytes > 0, `${prefix} has an invalid size`)
  invariant(SHA256_PATTERN.test(value.sha256), `${prefix} has an invalid SHA-256`)
}

function assertCandidateSmokeEvidence(target, lockedFontSha256, platform, arch) {
  const prefix = `${platform}/${arch} candidate smoke evidence`
  const render = target.buildEvidence?.candidateSmoke?.render
  invariant(render?.videoCodec === "h264" && render.audioCodec === "aac", `${prefix} has invalid render codecs`)
  invariant(Number.isFinite(render.durationSeconds) && Math.abs(render.durationSeconds - 1) <= 0.25, `${prefix} has invalid render duration`)
  assertSmokeEvidenceFile(render.output, "evidence/smoke.mp4", `${prefix} render output`)
  assertSmokeEvidenceFile(render.probe, "evidence/smoke.ffprobe.json", `${prefix} render probe`)

  const subtitle = target.buildEvidence?.candidateSmoke?.subtitle
  invariant(
    subtitle?.renderer === "libass"
      && subtitle.videoCodec === "h264"
      && subtitle.audioCodec === undefined
      && subtitle.fontSha256 === lockedFontSha256,
    `${prefix} has invalid subtitle runtime facts`,
  )
  invariant(Number.isFinite(subtitle.durationSeconds) && Math.abs(subtitle.durationSeconds - 1) <= 0.25, `${prefix} has invalid subtitle duration`)
  assertSmokeEvidenceFile(subtitle.output, "evidence/subtitle-smoke.mp4", `${prefix} subtitle output`)
  assertSmokeEvidenceFile(subtitle.probe, "evidence/subtitle-smoke.ffprobe.json", `${prefix} subtitle probe`)
  assertSmokeEvidenceFile(subtitle.script, "evidence/subtitle-smoke.ass", `${prefix} subtitle script`)
  assertSmokeEvidenceFile(subtitle.frame, "evidence/subtitle-smoke.png", `${prefix} subtitle frame`)
}

export function assertMediaRuntimeApprovalEvidence(target, platform, arch) {
  const prefix = `${platform}/${arch} approved media runtime`
  const evidence = target.approvalEvidence
  invariant(evidence && typeof evidence === "object", `${prefix} has no approval evidence`)
  invariant(
    typeof evidence.approver === "string"
      && evidence.approver.trim() === evidence.approver
      && evidence.approver.length > 0
      && evidence.approver.length <= 256
      && !/[\u0000-\u001f\u007f]/.test(evidence.approver),
    `${prefix} has no valid approver`,
  )
  invariant(isISODateTime(evidence.approvedAt), `${prefix} has no valid approvedAt timestamp`)
  invariant(
    Array.isArray(evidence.references)
      && evidence.references.length > 0
      && evidence.references.every(isEvidenceReference)
      && new Set(evidence.references).size === evidence.references.length,
    `${prefix} has no valid evidence references`,
  )
  invariant(
    isEvidenceReference(evidence.immutableMirror?.reference),
    `${prefix} has no immutable mirror reference`,
  )
  invariant(
    SHA256_PATTERN.test(evidence.immutableMirror?.sha256)
      && evidence.immutableMirror.sha256 === target.distribution?.sha256,
    `${prefix} immutable mirror digest does not match the locked distribution`,
  )
  const rollbackPlan = evidence.rollbackPlan
  if (target.releaseReadiness?.releaseKind === "initial") {
    invariant(
      rollbackPlan?.strategy === "disable-deliver"
        && rollbackPlan.capability === "timelineDelivery",
      `${prefix} has no valid initial-release disable-Deliver rollback plan`,
    )
    invariant(
      isEvidenceReference(rollbackPlan.reference),
      `${prefix} has no initial-release rollback reference`,
    )
  } else {
    invariant(
      rollbackPlan?.strategy === "previous-approved-runtime"
        && typeof rollbackPlan.runtimeID === "string"
        && rollbackPlan.runtimeID.length > 0
        && rollbackPlan.runtimeID !== target.runtimeID
        && rollbackPlan.runtimeID === target.releaseReadiness?.previousRuntimeID,
      `${prefix} has no valid previous approved rollback runtime ID`,
    )
    invariant(
      isEvidenceReference(rollbackPlan.reference),
      `${prefix} has no previous-runtime rollback reference`,
    )
  }
  return evidence
}

export function resolveMediaExecutableNames(target, platform = "target", arch = "unknown") {
  const ffmpeg = target?.executables?.ffmpeg
  const ffprobe = target?.executables?.ffprobe
  invariant(isFileName(ffmpeg), `${platform}/${arch} has no valid FFmpeg executable name`)
  invariant(isFileName(ffprobe), `${platform}/${arch} has no valid FFprobe executable name`)
  invariant(ffmpeg !== ffprobe, `${platform}/${arch} uses the same name for FFmpeg and FFprobe`)
  return { ffmpeg, ffprobe }
}

export function assertMediaRuntimeReleaseApproved(target, platform, arch) {
  invariant(
    target.releaseReadiness?.status === "approved",
    `${platform}/${arch} media runtime is not approved for release (releaseReadiness=${target.releaseReadiness?.status ?? "missing"})`,
  )
  invariant(
    target.licensePolicy?.reviewStatus === "approved",
    `${platform}/${arch} media runtime is not approved for release (licenseReview=${target.licensePolicy?.reviewStatus ?? "missing"})`,
  )
  assertMediaRuntimeApprovalEvidence(target, platform, arch)
}

export function validateMediaRuntimeLock(lock) {
  invariant(lock && typeof lock === "object", "Media runtime lock must be a JSON object")
  invariant(lock.schemaVersion === 1, `Unsupported media runtime lock schema ${lock.schemaVersion}`)
  invariant(lock.platforms && typeof lock.platforms === "object", "Media runtime lock is missing platforms")
  for (const dependency of ["libass", "freetype", "fribidi", "harfbuzz", "font"]) {
    const source = lock.subtitleRuntimeSources?.[dependency]
    invariant(source && typeof source.version === "string" && source.version, `Subtitle runtime is missing ${dependency} version`)
    invariant(SHA256_PATTERN.test(source.sha256), `Subtitle runtime has invalid ${dependency} SHA-256`)
  }
  const lockedZlib = lock.mediaRuntimeSources?.zlib
  invariant(lockedZlib?.version === "1.3.1", "Media runtime has no pinned zlib version")
  invariant(
    typeof lockedZlib.url === "string" && lockedZlib.url.startsWith("https://"),
    "Media runtime has no pinned zlib source URL",
  )
  invariant(SHA256_PATTERN.test(lockedZlib.sha256), "Media runtime has invalid zlib SHA-256")

  for (const platform of LOCKED_PLATFORMS) {
    const entry = lock.platforms[platform]
    invariant(entry && typeof entry === "object", `Media runtime lock is missing ${platform}`)
    invariant(
      entry.status === "supported" || entry.status === "blocked",
      `Media runtime lock has invalid ${platform} status`,
    )
    if (entry.status === "blocked") {
      invariant(typeof entry.reason === "string" && entry.reason.trim(), `${platform} block must include a reason`)
      invariant(!entry.targets, `${platform} is blocked but still declares targets`)
      continue
    }

    invariant(entry.targets && typeof entry.targets === "object", `${platform} is supported without targets`)
    for (const [arch, target] of Object.entries(entry.targets)) {
      invariant(arch.length > 0 && target && typeof target === "object", `${platform} has an invalid target`)
      invariant(Number.isInteger(target.manifestSchemaVersion), `${platform}/${arch} has no manifest schema version`)
      invariant(typeof target.runtimeID === "string" && target.runtimeID, `${platform}/${arch} has no runtime ID`)
      invariant(typeof target.origin === "string" && target.origin, `${platform}/${arch} has no origin`)
      invariant(
        target.releaseReadiness?.status === "approved" || target.releaseReadiness?.status === "blocked",
        `${platform}/${arch} has no release-readiness status`,
      )
      invariant(
        target.releaseReadiness?.releaseKind === "initial" || target.releaseReadiness?.releaseKind === "successor",
        `${platform}/${arch} has no valid release kind`,
      )
      if (target.releaseReadiness.releaseKind === "successor") {
        invariant(
          typeof target.releaseReadiness.previousRuntimeID === "string"
            && target.releaseReadiness.previousRuntimeID.length > 0
            && target.releaseReadiness.previousRuntimeID !== target.runtimeID,
          `${platform}/${arch} successor has no valid previous runtime ID`,
        )
      } else {
        invariant(
          target.releaseReadiness.previousRuntimeID === undefined,
          `${platform}/${arch} initial release must not declare a previous runtime ID`,
        )
      }
      if (target.releaseReadiness.status === "blocked") {
        invariant(
          Array.isArray(target.releaseReadiness.reasons) && target.releaseReadiness.reasons.length > 0,
          `${platform}/${arch} release block has no reasons`,
        )
      }
      if (target.releaseReadiness.status === "approved") {
        invariant(
          target.releaseReadiness.reasons === undefined,
          `${platform}/${arch} approved release must not retain block reasons`,
        )
      }
      invariant(
        typeof target.licensePolicy?.spdxExpression === "string" && target.licensePolicy.spdxExpression,
        `${platform}/${arch} has no license expression`,
      )
      invariant(
        typeof target.licensePolicy?.licenseFile === "string" && target.licensePolicy.licenseFile,
        `${platform}/${arch} has no license material path`,
      )
      invariant(
        typeof target.licensePolicy?.noticesFile === "string" && target.licensePolicy.noticesFile,
        `${platform}/${arch} has no notice material path`,
      )
      invariant(
        target.licensePolicy?.reviewStatus === "approved" || target.licensePolicy?.reviewStatus === "pending",
        `${platform}/${arch} has no license review status`,
      )
      if (target.origin === "anybox-controlled-gpl") {
        invariant(
          target.licensePolicy.spdxExpression === "GPL-3.0-or-later",
          `${platform}/${arch} GPL runtime has an invalid license expression`,
        )
        const x264License = target.licensePolicy.componentLicenseFiles?.x264
        const zlibLicense = target.licensePolicy.componentLicenseFiles?.zlib
        invariant(
          x264License?.fileName === "X264-LICENSE.txt" && SHA256_PATTERN.test(x264License.sha256),
          `${platform}/${arch} GPL runtime has no locked x264 license`,
        )
        invariant(
          zlibLicense?.fileName === "ZLIB-LICENSE.txt" && SHA256_PATTERN.test(zlibLicense.sha256),
          `${platform}/${arch} GPL runtime has no locked zlib license`,
        )
      }
      const executableNames = resolveMediaExecutableNames(target, platform, arch)
      const artifactPending = target.artifactStatus === "pending"
      invariant(target.artifactStatus === undefined || artifactPending, `${platform}/${arch} has invalid artifact status`)
      if (artifactPending) {
        invariant(target.releaseReadiness.status === "blocked", `${platform}/${arch} pending artifact is not release-blocked`)
        invariant(target.distribution === undefined, `${platform}/${arch} pending artifact must not declare a distribution`)
        invariant(target.binaries === undefined, `${platform}/${arch} pending artifact must not declare binary digests`)
        invariant(target.approvalEvidence === undefined, `${platform}/${arch} pending artifact must not declare approval evidence`)
      } else {
        invariant(target.distribution && typeof target.distribution === "object", `${platform}/${arch} has no distribution`)
        invariant(SHA256_PATTERN.test(target.distribution.sha256), `${platform}/${arch} has an invalid archive digest`)
        invariant(Number.isSafeInteger(target.distribution.sizeBytes), `${platform}/${arch} has an invalid archive size`)
        for (const key of ["releaseTag", "ffmpegRevision", "fileName", "url", "sourceURL", "buildSourceURL"]) {
          invariant(typeof target.distribution[key] === "string" && target.distribution[key], `${platform}/${arch} has no ${key}`)
        }
        for (const materialName of ["source", "buildSource"]) {
          const material = target.distribution[materialName]
          invariant(material && typeof material === "object", `${platform}/${arch} has no ${materialName} material lock`)
          invariant(typeof material.fileName === "string" && material.fileName, `${platform}/${arch} has no ${materialName} filename`)
          invariant(SHA256_PATTERN.test(material.sha256), `${platform}/${arch} has an invalid ${materialName} digest`)
          invariant(Number.isSafeInteger(material.sizeBytes) && material.sizeBytes > 0, `${platform}/${arch} has an invalid ${materialName} size`)
        }
        if (target.origin === "anybox-controlled-gpl") {
          const x264Source = target.distribution.componentSources?.x264
          invariant(x264Source && typeof x264Source === "object", `${platform}/${arch} has no x264 source material`)
          invariant(/^[a-f0-9]{40}$/.test(x264Source.revision), `${platform}/${arch} has an invalid x264 revision`)
          invariant(
            x264Source.fileName === `x264-source-${x264Source.revision}.tar.gz`,
            `${platform}/${arch} has an invalid x264 source filename`,
          )
          invariant(SHA256_PATTERN.test(x264Source.sha256), `${platform}/${arch} has an invalid x264 source digest`)
          invariant(Number.isSafeInteger(x264Source.sizeBytes) && x264Source.sizeBytes > 0, `${platform}/${arch} has an invalid x264 source size`)
          invariant(typeof x264Source.url === "string" && x264Source.url.startsWith("https://"), `${platform}/${arch} has no x264 source URL`)
          const zlibSource = target.distribution.componentSources?.zlib
          invariant(zlibSource && typeof zlibSource === "object", `${platform}/${arch} has no zlib source material`)
          invariant(zlibSource.version === lockedZlib.version, `${platform}/${arch} has an invalid zlib version`)
          invariant(
            zlibSource.fileName === `zlib-source-${zlibSource.version}.tar.gz`,
            `${platform}/${arch} has an invalid zlib source filename`,
          )
          invariant(zlibSource.sha256 === lockedZlib.sha256, `${platform}/${arch} has an invalid zlib source digest`)
          invariant(Number.isSafeInteger(zlibSource.sizeBytes) && zlibSource.sizeBytes > 0, `${platform}/${arch} has an invalid zlib source size`)
          invariant(typeof zlibSource.url === "string" && zlibSource.url.startsWith("https://"), `${platform}/${arch} has no zlib source URL`)
        }
        invariant(target.binaries && typeof target.binaries === "object", `${platform}/${arch} has no binary locks`)
        for (const binaryName of Object.values(executableNames)) {
          invariant(
            SHA256_PATTERN.test(target.binaries[binaryName]?.sha256),
            `${platform}/${arch} has no valid ${binaryName} digest`,
          )
        }
        assertCandidateSmokeEvidence(target, lock.subtitleRuntimeSources.font.sha256, platform, arch)
      }
      invariant(
        Array.isArray(target.buildConfigurationPolicy?.requiredFlags),
        `${platform}/${arch} has no required build flags`,
      )
      invariant(
        Array.isArray(target.buildConfigurationPolicy?.forbiddenFlags),
        `${platform}/${arch} has no forbidden build flags`,
      )
      invariant(Array.isArray(target.requiredEncoders), `${platform}/${arch} has no encoder policy`)
      invariant(target.buildConfigurationPolicy.requiredFlags.includes("--enable-libass"), `${platform}/${arch} does not enable libass`)
      invariant(Array.isArray(target.requiredFilters) && target.requiredFilters.includes("ass"), `${platform}/${arch} has no ASS filter policy`)
      invariant(Array.isArray(target.requiredFonts) && target.requiredFonts.some((font) => font.fileName === "fonts/NotoSansCJKsc-Regular.otf" && SHA256_PATTERN.test(font.sha256)), `${platform}/${arch} has no locked subtitle font`)
      invariant(target.smokeTest && typeof target.smokeTest === "object", `${platform}/${arch} has no smoke policy`)
      if (target.releaseReadiness.status === "approved") {
        invariant(
          target.licensePolicy.reviewStatus === "approved",
          `${platform}/${arch} release is approved without an approved license review`,
        )
        assertMediaRuntimeApprovalEvidence(target, platform, arch)
      } else if (target.approvalEvidence !== undefined) {
        assertMediaRuntimeApprovalEvidence(target, platform, arch)
      }
    }
  }
  return lock
}

export function resolveMediaRuntimeTarget(lock, platform, arch) {
  validateMediaRuntimeLock(lock)
  const platformEntry = lock.platforms[platform]
  invariant(platformEntry, `Media runtime platform ${platform} is not represented in the lock`)
  if (platformEntry.status === "blocked") {
    throw new Error(`Media runtime packaging is blocked for ${platform}/${arch}: ${platformEntry.reason}`)
  }
  const target = platformEntry.targets[arch]
  invariant(target, `Media runtime packaging is not configured for ${platform}/${arch}`)
  return target
}

export function assertManifestMatchesTarget(manifest, target, platform, arch) {
  invariant(manifest?.schemaVersion === target.manifestSchemaVersion, "Media runtime manifest schema does not match the lock")
  invariant(
    manifest.platform === platform && manifest.arch === arch,
    `Media runtime manifest target mismatch: got ${manifest.platform}/${manifest.arch}, expected ${platform}/${arch}`,
  )
  invariant(manifest.runtimeID === target.runtimeID, `Media runtime ID ${manifest.runtimeID} does not match ${target.runtimeID}`)
  invariant(manifest.origin === target.origin, `Media runtime origin ${manifest.origin} does not match ${target.origin}`)
  assert.deepStrictEqual(
    manifest.releaseReadiness,
    target.releaseReadiness,
    "Media runtime release readiness does not match the lock",
  )
  assert.deepStrictEqual(manifest.licensePolicy, target.licensePolicy, "Media runtime license policy does not match the lock")
  assert.deepStrictEqual(manifest.distribution, target.distribution, "Media runtime distribution does not match the lock")
  assert.deepStrictEqual(
    manifest.approvalEvidence,
    target.approvalEvidence,
    "Media runtime approval evidence does not match the lock",
  )
  assert.deepStrictEqual(manifest.executables, target.executables, "Media runtime executable names do not match the lock")
  for (const [binaryName, binaryLock] of Object.entries(target.binaries)) {
    invariant(
      manifest.binaries?.[binaryName]?.sha256 === binaryLock.sha256,
      `Media runtime manifest digest for ${binaryName} does not match the lock`,
    )
  }
}

export function assertBuildConfigurationPolicy(flags, policy) {
  const flagSet = flags instanceof Set ? flags : new Set(flags)
  for (const requiredFlag of policy.requiredFlags) {
    invariant(flagSet.has(requiredFlag), `FFmpeg build is missing required flag ${requiredFlag}`)
  }
  for (const forbiddenFlag of policy.forbiddenFlags) {
    invariant(!flagSet.has(forbiddenFlag), `FFmpeg build contains forbidden flag ${forbiddenFlag}`)
  }
}

async function readJson(target) {
  return JSON.parse(await fsp.readFile(target, "utf8"))
}

async function sha256(target) {
  const hash = createHash("sha256")
  const stream = fs.createReadStream(target)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest("hex")
}

function runBinary(binary, args, label, options = {}) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
    ...options,
  })
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = `${result.stderr || result.stdout || `exit ${result.status}`}`.trim()
    throw new Error(`${label} failed: ${detail}`)
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`
}

function parseBuildFlags(output) {
  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("--")),
  )
}

function parseEncoderNames(output) {
  const encoders = new Set()
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*[VAS]\S{5}\s+(\S+)/)
    if (match) encoders.add(match[1])
  }
  return encoders
}

async function verifyBinaryDigests(mediaToolsDir, target, manifest) {
  for (const [binaryName, binaryLock] of Object.entries(target.binaries)) {
    const binaryPath = path.join(mediaToolsDir, binaryName)
    invariant(fs.existsSync(binaryPath), `Media runtime is missing ${binaryPath}`)
    const actual = await sha256(binaryPath)
    invariant(actual === binaryLock.sha256, `Media runtime digest mismatch for ${binaryName}`)
    invariant(actual === manifest.binaries[binaryName].sha256, `Media runtime manifest has stale digest for ${binaryName}`)
  }
}

async function verifyLicenseMaterials(mediaToolsDir, target) {
  const licensePath = path.join(mediaToolsDir, target.licensePolicy.licenseFile)
  const noticesPath = path.join(mediaToolsDir, target.licensePolicy.noticesFile)
  invariant(fs.existsSync(licensePath), `Media runtime is missing ${licensePath}`)
  invariant(fs.existsSync(noticesPath), `Media runtime is missing ${noticesPath}`)
  const [license, notices] = await Promise.all([
    fsp.readFile(licensePath, "utf8"),
    fsp.readFile(noticesPath, "utf8"),
  ])
  invariant(license.trim().length > 100, "Media runtime license material is empty or a placeholder")
  invariant(
    notices.includes(target.distribution.ffmpegRevision)
      && notices.includes("packages/desktop/scripts/build-media-runtime.sh"),
    "Media runtime notices do not identify the locked source revision and build recipe",
  )
  for (const [component, descriptor] of Object.entries(target.licensePolicy.componentLicenseFiles ?? {})) {
    const componentLicensePath = path.join(mediaToolsDir, descriptor.fileName)
    invariant(fs.existsSync(componentLicensePath), `Media runtime is missing ${component} license material`)
    invariant(await sha256(componentLicensePath) === descriptor.sha256, `Media runtime ${component} license digest mismatch`)
    const componentLicense = await fsp.readFile(componentLicensePath, "utf8")
    invariant(componentLicense.trim().length > 100, `Media runtime ${component} license material is empty or a placeholder`)
  }
}

async function verifySubtitleMaterials(mediaToolsDir, target) {
  for (const font of target.requiredFonts) {
    const fontPath = path.join(mediaToolsDir, ...font.fileName.split("/"))
    invariant(fs.existsSync(fontPath), `Media runtime is missing ${font.fileName}`)
    invariant(await sha256(fontPath) === font.sha256, `Media runtime subtitle font digest mismatch for ${font.fileName}`)
  }
  const fontLicensePath = path.join(mediaToolsDir, "fonts", "OFL-1.1.txt")
  invariant(fs.existsSync(fontLicensePath), "Media runtime is missing fonts/OFL-1.1.txt")
  const fontLicense = await fsp.readFile(fontLicensePath, "utf8")
  invariant(/SIL OPEN FONT LICENSE/i.test(fontLicense), "Media runtime subtitle font license is invalid")
}

function verifyBuildAndEncoderPolicy(ffmpegPath, target) {
  const buildOutput = runBinary(ffmpegPath, ["-hide_banner", "-buildconf"], "FFmpeg build policy check")
  assertBuildConfigurationPolicy(parseBuildFlags(buildOutput), target.buildConfigurationPolicy)

  const encoderOutput = runBinary(ffmpegPath, ["-hide_banner", "-encoders"], "FFmpeg encoder policy check")
  const encoderNames = parseEncoderNames(encoderOutput)
  for (const requiredEncoder of target.requiredEncoders) {
    invariant(encoderNames.has(requiredEncoder), `FFmpeg is missing required encoder ${requiredEncoder}`)
  }
  const filterOutput = runBinary(ffmpegPath, ["-hide_banner", "-filters"], "FFmpeg filter policy check")
  invariant(/^\s*[TSC.]{2,3}\s+ass\s+.*\blibass\b/im.test(filterOutput), "FFmpeg is missing the required libass subtitle renderer")
}

async function subtitleSmokeEncode(mediaToolsDir, target) {
  const smokeDir = await fsp.mkdtemp(path.join(os.tmpdir(), "Anybox subtitle runtime smoke "))
  const executableNames = resolveMediaExecutableNames(target)
  const executableDir = path.join(smokeDir, "installed tools with spaces")
  const workingDirectory = path.join(smokeDir, "subtitle output with spaces")
  const ffmpegPath = path.join(executableDir, executableNames.ffmpeg)
  const ffprobePath = path.join(executableDir, executableNames.ffprobe)
  try {
    await fsp.mkdir(executableDir, { recursive: true })
    await fsp.mkdir(path.join(workingDirectory, "fonts"), { recursive: true })
    await Promise.all([
      fsp.copyFile(path.join(mediaToolsDir, executableNames.ffmpeg), ffmpegPath),
      fsp.copyFile(path.join(mediaToolsDir, executableNames.ffprobe), ffprobePath),
      fsp.copyFile(path.join(mediaToolsDir, ...target.requiredFonts[0].fileName.split("/")), path.join(workingDirectory, "fonts", "NotoSansCJKsc-Regular.otf")),
    ])
    await fsp.writeFile(path.join(workingDirectory, "subtitle.ass"), [
      "[Script Info]",
      "ScriptType: v4.00+",
      "PlayResX: 320",
      "PlayResY: 180",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      "Style: Default,Noto Sans CJK SC,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,20,1",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Cinema 字幕 smoke",
      "",
    ].join("\n"), "utf8")
    runBinary(ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=c=black:s=320x180:r=24:d=1",
      "-vf", "ass=subtitle.ass:fontsdir=fonts",
      "-c:v", target.smokeTest.videoEncoder, "-an", "subtitle-smoke.mp4",
    ], "FFmpeg subtitle smoke encode", { cwd: workingDirectory })
    const probe = JSON.parse(runBinary(
      ffprobePath,
      ["-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type", "-of", "json", "subtitle-smoke.mp4"],
      "FFprobe subtitle smoke validation",
      { cwd: workingDirectory },
    ))
    invariant(
      probe.streams?.some((stream) => stream.codec_type === "video" && stream.codec_name === target.smokeTest.expectedVideoCodec),
      `Subtitle smoke output has no ${target.smokeTest.expectedVideoCodec} video stream`,
    )
    invariant(!probe.streams?.some((stream) => stream.codec_type === "audio"), "Subtitle smoke output unexpectedly contains audio")
    const duration = Number(probe.format?.duration)
    invariant(Number.isFinite(duration) && Math.abs(duration - 1) <= 0.25, `Subtitle smoke output duration ${probe.format?.duration} does not match 1s`)
  } finally {
    await fsp.rm(smokeDir, { recursive: true, force: true })
  }
}

async function smokeEncode(mediaToolsDir, target) {
  const smokeDir = await fsp.mkdtemp(path.join(os.tmpdir(), "Anybox media runtime smoke "))
  const executableDir = path.join(smokeDir, "installed tools with spaces")
  const executableNames = resolveMediaExecutableNames(target)
  const ffmpegPath = path.join(executableDir, executableNames.ffmpeg)
  const ffprobePath = path.join(executableDir, executableNames.ffprobe)
  const outputPath = path.join(smokeDir, "output with spaces", "one second H264 AAC.mp4")
  invariant(
    ffmpegPath.includes(" ") && ffprobePath.includes(" ") && outputPath.includes(" "),
    "Media smoke executable and output paths must exercise spaces",
  )

  try {
    await fsp.mkdir(path.dirname(outputPath), { recursive: true })
    await fsp.mkdir(executableDir, { recursive: true })
    await Promise.all([
      fsp.copyFile(path.join(mediaToolsDir, executableNames.ffmpeg), ffmpegPath),
      fsp.copyFile(path.join(mediaToolsDir, executableNames.ffprobe), ffprobePath),
    ])
    const smoke = target.smokeTest
    runBinary(
      ffmpegPath,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=320x180:r=25:d=${smoke.durationSeconds}`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=1000:sample_rate=48000:duration=${smoke.durationSeconds}`,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        smoke.videoEncoder,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        smoke.audioEncoder,
        "-b:a",
        "96k",
        "-shortest",
        outputPath,
      ],
      "FFmpeg H.264/AAC smoke encode",
    )

    const outputStat = await fsp.stat(outputPath)
    invariant(outputStat.size > 0, "FFmpeg smoke encode produced an empty file")
    const probeOutput = runBinary(
      ffprobePath,
      ["-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type", "-of", "json", outputPath],
      "FFprobe smoke validation",
    )
    const probe = JSON.parse(probeOutput)
    invariant(
      probe.streams?.some((stream) => stream.codec_type === "video" && stream.codec_name === smoke.expectedVideoCodec),
      `Smoke output has no ${smoke.expectedVideoCodec} video stream`,
    )
    invariant(
      probe.streams?.some((stream) => stream.codec_type === "audio" && stream.codec_name === smoke.expectedAudioCodec),
      `Smoke output has no ${smoke.expectedAudioCodec} audio stream`,
    )
    const duration = Number(probe.format?.duration)
    invariant(
      Number.isFinite(duration) && Math.abs(duration - smoke.durationSeconds) <= 0.25,
      `Smoke output duration ${probe.format?.duration} does not match ${smoke.durationSeconds}s`,
    )
  } finally {
    await fsp.rm(smokeDir, { recursive: true, force: true })
  }
}

export async function verifyMediaRuntime({
  runtimeDir = defaultRuntimeDir,
  lockPath = defaultLockPath,
  platform = process.platform,
  arch = process.arch,
  runSmoke = true,
  releaseStrict = false,
} = {}) {
  const lock = validateMediaRuntimeLock(await readJson(lockPath))
  const target = resolveMediaRuntimeTarget(lock, platform, arch)
  if (releaseStrict) assertMediaRuntimeReleaseApproved(target, platform, arch)
  const executableNames = resolveMediaExecutableNames(target, platform, arch)
  const mediaToolsDir = path.join(runtimeDir, "media-tools")
  const manifestPath = path.join(mediaToolsDir, "manifest.json")
  invariant(fs.existsSync(manifestPath), `Media runtime is missing ${manifestPath}`)
  const manifest = await readJson(manifestPath)

  assertManifestMatchesTarget(manifest, target, platform, arch)
  const subtitleMaterialsReady = manifest.materials?.subtitleFont === "archive"
    || manifest.materials?.subtitleFont === "build-supplied-beta"
  if (releaseStrict) {
    invariant(manifest.materials?.license === "archive", "Release runtime license must come from the locked archive")
    invariant(manifest.materials?.notices === "archive", "Release runtime notices must come from the locked archive")
    invariant(manifest.materials?.configure === "archive", "Release runtime configure evidence must come from the locked archive")
    invariant(manifest.materials?.sourceMetadata === "archive", "Release runtime source metadata must come from the locked archive")
    invariant(manifest.materials?.buildRecipe === "archive", "Release runtime build recipe must come from the locked archive")
    invariant(manifest.materials?.subtitleFont === "archive", "Release runtime subtitle font must come from the locked archive")
    invariant(manifest.materials?.subtitleFontLicense === "archive", "Release runtime subtitle font license must come from the locked archive")
  }
  await verifyBinaryDigests(mediaToolsDir, target, manifest)
  await verifyLicenseMaterials(mediaToolsDir, target)
  if (subtitleMaterialsReady) await verifySubtitleMaterials(mediaToolsDir, target)
  verifyBuildAndEncoderPolicy(path.join(mediaToolsDir, executableNames.ffmpeg), target)
  if (runSmoke) {
    await smokeEncode(mediaToolsDir, target)
    if (subtitleMaterialsReady) await subtitleSmokeEncode(mediaToolsDir, target)
  }

  console.log(
    `[desktop][media] verified locked runtime and H.264/AAC smoke for ${platform}/${arch}; mode=${releaseStrict ? "release-strict" : "technical-preview"}; release=${target.releaseReadiness.status}`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await verifyMediaRuntime({ releaseStrict: process.argv.includes("--release-strict") })
  } catch (error) {
    console.error(`[desktop][media] ${error instanceof Error ? error.message : error}`)
    process.exitCode = 1
  }
}
