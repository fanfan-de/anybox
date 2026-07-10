import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const defaultRuntimeDir = path.join(desktopDir, "build", "agent-runtime")
const defaultLockPath = path.join(desktopDir, "media-runtime.lock.json")
const cacheDir = path.join(desktopDir, "build", "media-tools-cache")

function readEnv(key) {
  const value = process.env[key]?.trim()
  return value || undefined
}

async function exists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

async function sha256(target) {
  const hash = createHash("sha256")
  const stream = fs.createReadStream(target)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest("hex")
}

async function assertDigest(target, expected) {
  const actual = await sha256(target)
  if (actual !== expected) {
    throw new Error(`Media tools checksum mismatch for ${target}: got ${actual}, expected ${expected}`)
  }
}

async function downloadPinnedArchive(target, distribution) {
  if (await exists(target)) {
    try {
      await assertDigest(target, distribution.sha256)
      return
    } catch {
      await fsp.rm(target, { force: true })
    }
  }

  await fsp.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.download`
  await fsp.rm(temporary, { force: true })

  console.log(`[desktop][media] downloading locked LGPL FFmpeg ${distribution.ffmpegRevision}`)
  const response = await fetch(distribution.url, { redirect: "follow" })
  if (!response.ok || !response.body) {
    throw new Error(`Could not download media tools (${response.status} ${response.statusText})`)
  }

  const handle = await fsp.open(temporary, "wx")
  try {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      await handle.write(value)
    }
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    const stat = await fsp.stat(temporary)
    if (stat.size !== distribution.sizeBytes) {
      throw new Error(`Media tools archive size mismatch: got ${stat.size}, expected ${distribution.sizeBytes}`)
    }
    await assertDigest(temporary, distribution.sha256)
    await fsp.rename(temporary, target)
  } catch (error) {
    await fsp.rm(temporary, { force: true })
    throw error
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`)
  }
}

async function findFile(root, fileName) {
  const entries = await fsp.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const candidate = path.join(root, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return candidate
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, fileName)
      if (nested) return nested
    }
  }
  return undefined
}

async function extractPinnedTools(archive, extractionDir, executableNames, licensePolicy) {
  await fsp.rm(extractionDir, { recursive: true, force: true })
  await fsp.mkdir(extractionDir, { recursive: true })
  run("tar", ["-xf", archive, "-C", extractionDir])

  const ffmpeg = await findFile(extractionDir, executableNames.ffmpeg)
  const ffprobe = await findFile(extractionDir, executableNames.ffprobe)
  const license = await findFile(extractionDir, licensePolicy.licenseFile)
  const notices = await findFile(extractionDir, licensePolicy.noticesFile)
  const configure = await findFile(extractionDir, "configure.txt")
  if (!ffmpeg || !ffprobe || !license) {
    throw new Error(
      `Pinned FFmpeg archive does not contain ${executableNames.ffmpeg}, ${executableNames.ffprobe}, and LICENSE.txt`,
    )
  }
  return { ffmpeg, ffprobe, license, notices, configure }
}

async function verifyExecutable(binary, expectedName) {
  const result = spawnSync(binary, ["-version"], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  })
  const output = `${result.stdout || ""}\n${result.stderr || ""}`
  if (result.status !== 0 || !output.toLowerCase().includes(expectedName)) {
    throw new Error(`${expectedName} runtime verification failed for ${binary}`)
  }
  return output.split(/\r?\n/, 1)[0]?.trim() || expectedName
}

async function copyExternalTools(ffmpeg, ffprobe, targetDir, executableNames) {
  if (!(await exists(ffmpeg)) || !(await exists(ffprobe))) {
    throw new Error("ANYBOX_FFMPEG_BINARY and ANYBOX_FFPROBE_BINARY must point to existing files")
  }
  await fsp.copyFile(ffmpeg, path.join(targetDir, executableNames.ffmpeg))
  await fsp.copyFile(ffprobe, path.join(targetDir, executableNames.ffprobe))
  await fsp.writeFile(
    path.join(targetDir, "LICENSE.txt"),
    "Externally supplied FFmpeg build. The release pipeline must provide its matching license and notices.\n",
  )
}

function preparerKey(platform, arch) {
  return `${platform}/${arch}`
}

const MEDIA_TOOL_PREPARERS = new Map([
  [preparerKey("win32", "x64"), {
    id: "locked-archive-win32-x64",
    prepare: prepareLockedArchiveMediaTools,
  }],
  [preparerKey("darwin", "arm64"), {
    id: "locked-archive-darwin-arm64",
    prepare: prepareLockedArchiveMediaTools,
  }],
])

export function resolveMediaToolsPreparation(lock, platform, arch) {
  const platformEntry = lock?.platforms?.[platform]
  if (!platformEntry) {
    return {
      status: "skipped",
      reason: "unsupported-platform",
      message: `[desktop][media] skipping bundled media tools for unsupported target ${platform}/${arch}: media-runtime.lock.json does not represent ${platform}`,
    }
  }
  if (platformEntry.status === "blocked") {
    return {
      status: "skipped",
      reason: "blocked-platform",
      message: `[desktop][media] skipping bundled media tools for blocked target ${platform}/${arch}: ${platformEntry.reason}`,
    }
  }

  const lockedTarget = platformEntry.targets?.[arch]
  if (!lockedTarget) {
    return {
      status: "skipped",
      reason: "unconfigured-target",
      message: `[desktop][media] skipping bundled media tools for unconfigured target ${platform}/${arch}: the supported platform has no matching lock target`,
    }
  }
  if (!lockedTarget.distribution) {
    return {
      status: "skipped",
      reason: "artifact-pending",
      target: lockedTarget,
      message: `[desktop][media] skipping bundled media tools for artifact-pending target ${platform}/${arch}: ${lockedTarget.runtimeID ?? "unknown"}`,
    }
  }

  const preparer = MEDIA_TOOL_PREPARERS.get(preparerKey(platform, arch))
  if (!preparer) {
    return {
      status: "skipped",
      reason: "unimplemented-preparer",
      target: lockedTarget,
      message: `[desktop][media] skipping bundled media tools for supported but unimplemented target ${platform}/${arch}: locked runtime ${lockedTarget.runtimeID ?? "unknown"} has no registered preparer`,
    }
  }

  return {
    status: "ready",
    preparerID: preparer.id,
    prepare: preparer.prepare,
    target: lockedTarget,
  }
}

async function prepareLockedArchiveMediaTools({ runtimeDir, lockedTarget, platform, arch }) {
  const targetDir = path.join(runtimeDir, "media-tools")
  const executableNames = lockedTarget.executables
  if (!executableNames?.ffmpeg || !executableNames?.ffprobe) {
    throw new Error(`media-runtime.lock.json is missing ${platform}/${arch} executable names`)
  }
  await fsp.rm(targetDir, { recursive: true, force: true })
  await fsp.mkdir(targetDir, { recursive: true })

  const externalFFmpeg = readEnv("ANYBOX_FFMPEG_BINARY")
  const externalFFprobe = readEnv("ANYBOX_FFPROBE_BINARY")
  if (Boolean(externalFFmpeg) !== Boolean(externalFFprobe)) {
    throw new Error("Set both ANYBOX_FFMPEG_BINARY and ANYBOX_FFPROBE_BINARY, or neither")
  }

  let origin = lockedTarget.origin
  let materials = { license: "archive", notices: "archive", configure: "archive" }
  if (externalFFmpeg && externalFFprobe) {
    origin = "environment-override"
    materials = { license: "generated-technical-preview", notices: "generated-technical-preview", configure: "runtime" }
    await copyExternalTools(externalFFmpeg, externalFFprobe, targetDir, executableNames)
  } else {
    const archive = path.join(cacheDir, lockedTarget.distribution.fileName)
    const extractionDir = path.join(cacheDir, lockedTarget.distribution.sha256)
    await downloadPinnedArchive(archive, lockedTarget.distribution)
    const tools = await extractPinnedTools(archive, extractionDir, executableNames, lockedTarget.licensePolicy)
    await fsp.copyFile(tools.ffmpeg, path.join(targetDir, executableNames.ffmpeg))
    await fsp.copyFile(tools.ffprobe, path.join(targetDir, executableNames.ffprobe))
    await fsp.copyFile(tools.license, path.join(targetDir, lockedTarget.licensePolicy.licenseFile))
    if (tools.notices) await fsp.copyFile(tools.notices, path.join(targetDir, lockedTarget.licensePolicy.noticesFile))
    else materials.notices = "generated-technical-preview"
    if (tools.configure) await fsp.copyFile(tools.configure, path.join(targetDir, "configure.txt"))
    else materials.configure = "runtime"
  }

  const ffmpegPath = path.join(targetDir, executableNames.ffmpeg)
  const ffprobePath = path.join(targetDir, executableNames.ffprobe)
  const ffmpegVersion = await verifyExecutable(ffmpegPath, "ffmpeg")
  const ffprobeVersion = await verifyExecutable(ffprobePath, "ffprobe")
  if (platform !== "win32") {
    await Promise.all([fsp.chmod(ffmpegPath, 0o755), fsp.chmod(ffprobePath, 0o755)])
  }
  const binaries = {
    [executableNames.ffmpeg]: { sha256: await sha256(ffmpegPath) },
    [executableNames.ffprobe]: { sha256: await sha256(ffprobePath) },
  }
  await fsp.writeFile(
    path.join(targetDir, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      platform,
      arch,
      runtimeID: lockedTarget.runtimeID,
      origin,
      releaseReadiness: lockedTarget.releaseReadiness,
      licensePolicy: lockedTarget.licensePolicy,
      approvalEvidence: lockedTarget.approvalEvidence,
      ffmpegVersion,
      ffprobeVersion,
      distribution: lockedTarget.distribution,
      executables: executableNames,
      binaries,
      materials,
    }, null, 2)}\n`,
  )
  const noticesPath = path.join(targetDir, lockedTarget.licensePolicy.noticesFile)
  if (!(await exists(noticesPath))) {
    await fsp.writeFile(
      noticesPath,
      [
        "FFmpeg media tools — technical preview notice",
        "",
        `Runtime ID: ${lockedTarget.runtimeID}`,
        `Build: ${lockedTarget.distribution.ffmpegRevision}`,
        `Binary distribution: ${lockedTarget.distribution.url}`,
        `Build scripts: ${lockedTarget.distribution.buildSourceURL}`,
        `Corresponding FFmpeg source revision: ${lockedTarget.distribution.sourceURL}`,
        `License: ${lockedTarget.licensePolicy.spdxExpression}; see ${lockedTarget.licensePolicy.licenseFile} in this directory.`,
        "This generated notice is acceptable only for technical preview. Release-strict requires archive-supplied reviewed notices.",
        "",
      ].join("\n"),
    )
  }
  const configurePath = path.join(targetDir, "configure.txt")
  if (!(await exists(configurePath))) {
    const buildconf = spawnSync(ffmpegPath, ["-buildconf"], { encoding: "utf8", windowsHide: true })
    await fsp.writeFile(configurePath, `${buildconf.stdout || buildconf.stderr || ""}`)
  }

  console.log(`[desktop][media] prepared and verified media tools at ${targetDir}`)
}

export async function prepareMediaTools({
  runtimeDir = defaultRuntimeDir,
  lockPath = defaultLockPath,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const runtimeLock = JSON.parse(await fsp.readFile(lockPath, "utf8"))
  const resolution = resolveMediaToolsPreparation(runtimeLock, platform, arch)
  if (resolution.status !== "ready") {
    await fsp.rm(path.join(runtimeDir, "media-tools"), { recursive: true, force: true })
    console.log(resolution.message)
    return
  }
  await resolution.prepare({
    runtimeDir,
    lockedTarget: resolution.target,
    platform,
    arch,
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareMediaTools()
}
