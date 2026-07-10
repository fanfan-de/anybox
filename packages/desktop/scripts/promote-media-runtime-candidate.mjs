import fsp from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const defaultLockPath = path.resolve(scriptDir, "..", "media-runtime.lock.json")

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

function buildPolicy(platform, arch) {
  if (platform === "win32" && arch === "x64") {
    return {
      requiredFlags: [
        "--arch=x86_64", "--target-os=mingw32", "--enable-version3", "--enable-mediafoundation",
        "--disable-libopenh264", "--disable-libx264", "--disable-libx265", "--disable-libfdk-aac",
        "--disable-gpl", "--disable-nonfree",
      ],
      forbiddenFlags: [
        "--enable-gpl", "--enable-nonfree", "--enable-libopenh264", "--enable-libx264",
        "--enable-libx265", "--enable-libfdk-aac",
      ],
      requiredEncoders: ["h264_mf", "aac"],
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
        "--disable-libopenh264", "--disable-libx264", "--disable-libx265", "--disable-libfdk-aac",
        "--disable-gpl", "--disable-nonfree",
      ],
      forbiddenFlags: [
        "--enable-gpl", "--enable-nonfree", "--enable-libopenh264", "--enable-libx264",
        "--enable-libx265", "--enable-libfdk-aac",
      ],
      requiredEncoders: ["h264_videotoolbox", "aac"],
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
const candidate = JSON.parse(await fsp.readFile(path.resolve(args.candidate), "utf8"))
if (candidate.classification !== "unapproved-candidate") throw new Error("Candidate classification is invalid")
const policy = buildPolicy(candidate.platform, candidate.arch)
const lock = JSON.parse(await fsp.readFile(lockPath, "utf8"))
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
  smokeTest: policy.smokeTest,
}

await fsp.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
console.log(`[desktop][media] promoted ${candidate.platform}/${candidate.arch} candidate into the blocked release lock`)
