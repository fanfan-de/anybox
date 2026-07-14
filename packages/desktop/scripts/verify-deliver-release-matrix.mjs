import fs from "node:fs"
import fsPromises from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { validateDeliverRestartEvidence } from "./verify-deliver-restart-evidence.mjs"
import { validateDeliverReleaseApproval } from "./verify-deliver-release-approval.mjs"
import {
  assertMediaRuntimeReleaseApproved,
  resolveMediaRuntimeTarget,
  validateMediaRuntimeLock,
} from "./verify-media-runtime.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, "..", "..", "..")

function parseArguments(argv) {
  const values = {
    lock: path.resolve(scriptDir, "..", "media-runtime.lock.json"),
    windows: path.resolve(workspaceRoot, "packages", "cinema-web", "cinema-deliver-installed-restart-evidence.win32-x64.json"),
    macos: path.resolve(workspaceRoot, "packages", "cinema-web", "cinema-deliver-installed-restart-evidence.darwin-arm64.json"),
    linux: path.resolve(workspaceRoot, "packages", "cinema-web", "cinema-deliver-installed-restart-evidence.linux-x64.json"),
    windowsArtifact: undefined,
    macosArtifact: undefined,
    linuxArtifact: undefined,
    approval: undefined,
  }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.slice(2)
    const value = argv[index + 1]
    if (!key || !(key in values) || !value) {
      throw new Error("Usage: verify-deliver-release-matrix [--lock file] [--windows file] [--macos file] [--linux file] --windowsArtifact file --macosArtifact file --linuxArtifact file --approval file")
    }
    values[key] = path.resolve(value)
  }
  if (!values.windowsArtifact || !values.macosArtifact || !values.linuxArtifact || !values.approval) {
    throw new Error("--windowsArtifact, --macosArtifact, --linuxArtifact, and --approval are required")
  }
  return values
}

async function readJson(filePath) {
  return JSON.parse(await fsPromises.readFile(filePath, "utf8"))
}

async function sha256(filePath) {
  const hash = createHash("sha256")
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", resolve)
  })
  return hash.digest("hex")
}

const args = parseArguments(process.argv.slice(2))
const lock = validateMediaRuntimeLock(await readJson(args.lock))
const expectations = [
  { key: "windows", platform: "win32", arch: "x64" },
  { key: "macos", platform: "darwin", arch: "arm64" },
  { key: "linux", platform: "linux", arch: "x64" },
]
const accepted = []
for (const expectation of expectations) {
  const target = resolveMediaRuntimeTarget(lock, expectation.platform, expectation.arch)
  assertMediaRuntimeReleaseApproved(target, expectation.platform, expectation.arch)
  const evidence = await readJson(args[expectation.key])
  validateDeliverRestartEvidence(evidence, { releaseStrict: true })
  if (evidence.host.platform !== expectation.platform || evidence.host.architecture !== expectation.arch) {
    throw new Error(`${expectation.key} evidence target ${evidence.host.platform}/${evidence.host.architecture} does not match ${expectation.platform}/${expectation.arch}`)
  }
  if (evidence.runtime.runtimeID !== target.runtimeID) {
    throw new Error(`${expectation.key} evidence runtime ${evidence.runtime.runtimeID} does not match locked ${target.runtimeID}`)
  }
  if (
    evidence.runtime.videoEncoder !== target.smokeTest.videoEncoder
    || evidence.runtime.audioEncoder !== target.smokeTest.audioEncoder
  ) {
    throw new Error(`${expectation.key} evidence encoder policy does not match the locked runtime`)
  }
  if (!evidence.runtime.ffmpegVersion.includes(target.distribution.ffmpegRevision)) {
    throw new Error(`${expectation.key} evidence FFmpeg version does not contain the locked revision`)
  }
  const artifactPath = args[`${expectation.key}Artifact`]
  if (artifactPath) {
    const artifactName = path.basename(artifactPath)
    if (artifactName !== evidence.build.artifactFileName) {
      throw new Error(`${expectation.key} artifact ${artifactName} does not match evidence ${evidence.build.artifactFileName}`)
    }
    const artifactSHA256 = await sha256(artifactPath)
    if (artifactSHA256 !== evidence.build.artifactSHA256) {
      throw new Error(`${expectation.key} artifact SHA-256 does not match installed evidence`)
    }
  }
  accepted.push({ expectation, evidence })
}

const [windows, macos, linux] = accepted
const approval = validateDeliverReleaseApproval(await readJson(args.approval))
for (const candidate of [macos, linux]) {
  if (windows.evidence.build.desktopVersion !== candidate.evidence.build.desktopVersion) {
    throw new Error("Windows, macOS, and Linux evidence use different desktop versions")
  }
  if (windows.evidence.build.commitSHA !== candidate.evidence.build.commitSHA) {
    throw new Error("Windows, macOS, and Linux evidence use different commits")
  }
}
const windowsTarget = resolveMediaRuntimeTarget(lock, "win32", "x64")
const macosTarget = resolveMediaRuntimeTarget(lock, "darwin", "arm64")
const linuxTarget = resolveMediaRuntimeTarget(lock, "linux", "x64")
if ([windowsTarget, macosTarget, linuxTarget].some((target) => target.releaseReadiness.releaseKind !== "initial")) {
  throw new Error("The first synchronized Deliver release requires releaseKind=initial for all runtimes")
}
if (new Set([windowsTarget, macosTarget, linuxTarget].map((target) => target.distribution.ffmpegRevision)).size !== 1) {
  throw new Error("Windows, macOS, and Linux runtimes must use the same FFmpeg revision")
}
if (approval.desktopVersion !== windows.evidence.build.desktopVersion) {
  throw new Error("Release approval uses a different desktop version")
}
if (approval.commitSHA !== windows.evidence.build.commitSHA) {
  throw new Error("Release approval uses a different commit")
}
if (
  approval.targets.win32X64.runtimeID !== windowsTarget.runtimeID
  || approval.targets.darwinArm64.runtimeID !== macosTarget.runtimeID
  || approval.targets.linuxX64.runtimeID !== linuxTarget.runtimeID
) {
  throw new Error("Release approval runtime bindings do not match the approved lock")
}
console.log(
  `[desktop][deliver-release] accepted synchronized ${windows.evidence.build.desktopVersion} release evidence for win32/x64, darwin/arm64, and linux/x64`,
)
