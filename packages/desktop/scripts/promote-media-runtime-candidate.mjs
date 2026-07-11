import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultLockPath = path.resolve(scriptDir, "..", "media-runtime.lock.json")
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith("--") || !value) throw new Error("Arguments must use --key value pairs")
    values.set(key.slice(2), value)
  }
  for (const key of ["candidate", "runtime-id", "release-tag", "url", "source-url", "build-source-url"]) {
    if (!values.get(key)) throw new Error(`Missing --${key}`)
  }
  return Object.fromEntries(values)
}

function assertHttpsURL(value, label) {
  const url = new URL(value)
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`)
  return value
}

function assertDescribedFile(value, expectedFileName, label) {
  if (value?.fileName !== expectedFileName) throw new Error(`${label} filename is invalid`)
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0) throw new Error(`${label} size is invalid`)
  if (!SHA256_PATTERN.test(value.sha256)) throw new Error(`${label} SHA-256 is invalid`)
}

async function sha256(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk)
  return hash.digest("hex")
}

async function assertLocalFile(root, descriptor, label) {
  const filePath = path.resolve(root, ...descriptor.fileName.split("/"))
  const safeRoot = `${path.resolve(root)}${path.sep}`
  if (!filePath.startsWith(safeRoot)) throw new Error(`${label} path escapes the candidate directory`)
  const stat = await fsp.stat(filePath).catch(() => undefined)
  if (!stat?.isFile()) throw new Error(`${label} is missing from the candidate directory`)
  if (stat.size !== descriptor.sizeBytes) throw new Error(`${label} size does not match candidate metadata`)
  if (await sha256(filePath) !== descriptor.sha256) throw new Error(`${label} digest does not match candidate metadata`)
}

async function assertCandidateFiles(candidatePath, candidate) {
  const root = path.dirname(candidatePath)
  await assertLocalFile(root, candidate.archive, "Candidate archive")
  const stage = path.join(root, "stage")
  const smoke = candidate.smokeEvidence
  for (const [label, descriptor] of [
    ["Candidate render smoke output", smoke.render.output],
    ["Candidate render smoke probe", smoke.render.probe],
    ["Candidate subtitle smoke output", smoke.subtitle.output],
    ["Candidate subtitle smoke probe", smoke.subtitle.probe],
    ["Candidate subtitle smoke script", smoke.subtitle.script],
    ["Candidate subtitle smoke frame", smoke.subtitle.frame],
  ]) await assertLocalFile(stage, descriptor, label)
}

function assertCandidateEvidence(candidate, lock) {
  if (candidate.schemaVersion !== 1) throw new Error("Candidate schema version is invalid")
  if (!SHA256_PATTERN.test(candidate.archive?.sha256) || !Number.isSafeInteger(candidate.archive?.sizeBytes) || candidate.archive.sizeBytes <= 0) {
    throw new Error("Candidate archive identity is invalid")
  }
  const expectedSubtitleSources = lock.subtitleRuntimeSources
  if (candidate.subtitleRuntime?.renderer !== "libass" || candidate.subtitleRuntime?.requiredFilter !== "ass") {
    throw new Error("Candidate subtitle renderer evidence is invalid")
  }
  const dependencies = candidate.subtitleRuntime.dependencies
  for (const [candidateName, lockName] of [["libass", "libass"], ["freetype", "freetype"], ["fribidi", "fribidi"], ["harfbuzz", "harfbuzz"]]) {
    const actual = dependencies?.[candidateName]
    const expected = expectedSubtitleSources?.[lockName]
    if (actual?.version !== expected?.version || actual?.sha256 !== expected?.sha256) {
      throw new Error(`Candidate ${candidateName} evidence does not match the runtime lock`)
    }
  }
  const lockedFont = expectedSubtitleSources?.font
  if (
    dependencies?.notoSansCjkSc?.version !== lockedFont?.version
    || dependencies?.notoSansCjkSc?.sha256 !== lockedFont?.sha256
    || candidate.materials?.subtitleFont?.sha256 !== lockedFont?.sha256
  ) throw new Error("Candidate subtitle font evidence does not match the runtime lock")

  const render = candidate.smokeEvidence?.render
  if (render?.videoCodec !== "h264" || render?.audioCodec !== "aac" || !Number.isFinite(render?.durationSeconds) || Math.abs(render.durationSeconds - 1) > 0.25) {
    throw new Error("Candidate H.264/AAC smoke evidence is invalid")
  }
  assertDescribedFile(render.output, "evidence/smoke.mp4", "Candidate render smoke output")
  assertDescribedFile(render.probe, "evidence/smoke.ffprobe.json", "Candidate render smoke probe")

  const subtitle = candidate.smokeEvidence?.subtitle
  if (
    subtitle?.renderer !== "libass"
    || subtitle?.fontSha256 !== lockedFont?.sha256
    || subtitle?.videoCodec !== "h264"
    || subtitle?.audioCodec !== undefined
    || !Number.isFinite(subtitle?.durationSeconds)
    || Math.abs(subtitle.durationSeconds - 1) > 0.25
  ) throw new Error("Candidate subtitle smoke evidence is invalid")
  assertDescribedFile(subtitle.output, "evidence/subtitle-smoke.mp4", "Candidate subtitle smoke output")
  assertDescribedFile(subtitle.probe, "evidence/subtitle-smoke.ffprobe.json", "Candidate subtitle smoke probe")
  assertDescribedFile(subtitle.script, "evidence/subtitle-smoke.ass", "Candidate subtitle smoke script")
  assertDescribedFile(subtitle.frame, "evidence/subtitle-smoke.png", "Candidate subtitle smoke frame")
}

function buildPolicy(platform, arch) {
  if (platform === "win32" && arch === "x64") {
    return {
      requiredFlags: [
        "--arch=x86_64", "--target-os=mingw32", "--enable-version3", "--enable-mediafoundation",
        "--enable-libass",
        "--disable-libopenh264", "--disable-libx264", "--disable-libx265", "--disable-libfdk-aac",
        "--disable-gpl", "--disable-nonfree",
      ],
      forbiddenFlags: [
        "--enable-gpl", "--enable-nonfree", "--enable-libopenh264", "--enable-libx264",
        "--enable-libx265", "--enable-libfdk-aac",
      ],
      requiredEncoders: ["h264_mf", "aac"],
      requiredFilters: ["ass"],
      smokeTest: {
        durationSeconds: 1,
        videoEncoder: "h264_mf",
        audioEncoder: "aac",
        expectedVideoCodec: "h264",
        expectedAudioCodec: "aac",
      },
    }
  }
  if (platform === "darwin" && arch === "arm64") {
    return {
      requiredFlags: [
        "--arch=arm64", "--target-os=darwin", "--enable-version3", "--enable-videotoolbox",
        "--enable-libass",
        "--disable-libopenh264", "--disable-libx264", "--disable-libx265", "--disable-libfdk-aac",
        "--disable-gpl", "--disable-nonfree",
      ],
      forbiddenFlags: [
        "--enable-gpl", "--enable-nonfree", "--enable-libopenh264", "--enable-libx264",
        "--enable-libx265", "--enable-libfdk-aac",
      ],
      requiredEncoders: ["h264_videotoolbox", "aac"],
      requiredFilters: ["ass"],
      smokeTest: {
        durationSeconds: 1,
        videoEncoder: "h264_videotoolbox",
        audioEncoder: "aac",
        expectedVideoCodec: "h264",
        expectedAudioCodec: "aac",
      },
    }
  }
  throw new Error(`Unsupported release target ${platform}/${arch}`)
}

const args = parseArguments(process.argv.slice(2))
const lockPath = path.resolve(args.lock ?? defaultLockPath)
const candidatePath = path.resolve(args.candidate)
const candidate = JSON.parse(await fsp.readFile(candidatePath, "utf8"))
if (candidate.classification !== "unapproved-candidate") throw new Error("Candidate classification is invalid")
const policy = buildPolicy(candidate.platform, candidate.arch)
const lock = JSON.parse(await fsp.readFile(lockPath, "utf8"))
assertCandidateEvidence(candidate, lock)
await assertCandidateFiles(candidatePath, candidate)
const platformEntry = lock.platforms?.[candidate.platform]
if (!platformEntry || platformEntry.status !== "supported") throw new Error(`Lock does not support ${candidate.platform}`)

platformEntry.targets ??= {}
platformEntry.targets[candidate.arch] = {
  runtimeID: args["runtime-id"],
  manifestSchemaVersion: 1,
  origin: "anybox-controlled-lgpl",
  releaseReadiness: {
    status: "blocked",
    releaseKind: "initial",
    reasons: [
      "The candidate still requires recorded license and release approval.",
      "The immutable mirror and source/build evidence still require approval binding.",
      "The signed installed-app kill/restart smoke has not been accepted for both release targets.",
    ],
  },
  licensePolicy: {
    spdxExpression: "LGPL-3.0-or-later",
    licenseFile: candidate.materials.license.fileName,
    noticesFile: candidate.materials.notices.fileName,
    reviewStatus: "pending",
  },
  distribution: {
    releaseTag: args["release-tag"],
    ffmpegRevision: candidate.ffmpegRevision,
    fileName: candidate.archive.fileName,
    sha256: candidate.archive.sha256,
    sizeBytes: candidate.archive.sizeBytes,
    url: assertHttpsURL(args.url, "url"),
    sourceURL: assertHttpsURL(args["source-url"], "source-url"),
    buildSourceURL: assertHttpsURL(args["build-source-url"], "build-source-url"),
    source: candidate.materials.source,
    buildSource: candidate.materials.buildRecipe,
  },
  executables: candidate.executables,
  binaries: candidate.binaries,
  buildConfigurationPolicy: {
    requiredFlags: policy.requiredFlags,
    forbiddenFlags: policy.forbiddenFlags,
  },
  requiredEncoders: policy.requiredEncoders,
  requiredFilters: policy.requiredFilters,
  requiredFonts: [{
    fileName: candidate.materials.subtitleFont.fileName,
    sha256: candidate.materials.subtitleFont.sha256,
  }],
  smokeTest: policy.smokeTest,
  buildEvidence: { candidateSmoke: candidate.smokeEvidence },
}

await fsp.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
console.log(`[desktop][media] promoted ${candidate.platform}/${candidate.arch} candidate into the blocked release lock`)
