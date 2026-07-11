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

async function assertArchivedFile(extractionDir, descriptor, label) {
  const candidate = path.resolve(extractionDir, ...descriptor.fileName.split("/"))
  const root = `${path.resolve(extractionDir)}${path.sep}`
  if (!candidate.startsWith(root)) throw new Error(`${label} path escapes the media runtime archive`)
  const stat = await fsp.stat(candidate).catch(() => undefined)
  if (!stat?.isFile()) throw new Error(`Pinned FFmpeg archive is missing ${label}`)
  if (descriptor.sizeBytes !== undefined && stat.size !== descriptor.sizeBytes) throw new Error(`${label} size does not match the runtime lock`)
  await assertDigest(candidate, descriptor.sha256)
  return candidate
}

async function extractPinnedTools(archive, extractionDir, executableNames, lockedTarget) {
  await fsp.rm(extractionDir, { recursive: true, force: true })
  await fsp.mkdir(extractionDir, { recursive: true })
  run("tar", ["-xf", archive, "-C", extractionDir])

  const ffmpeg = await findFile(extractionDir, executableNames.ffmpeg)
  const ffprobe = await findFile(extractionDir, executableNames.ffprobe)
  const license = await findFile(extractionDir, lockedTarget.licensePolicy.licenseFile)
  const notices = await findFile(extractionDir, lockedTarget.licensePolicy.noticesFile)
  const configure = await findFile(extractionDir, "configure.txt")
  const sourceMetadata = await findFile(extractionDir, "SOURCE.txt")
  const buildRecipe = await findFile(extractionDir, "BUILD-RECIPE.sh")
  if (!ffmpeg || !ffprobe || !license) {
    throw new Error(
      `Pinned FFmpeg archive does not contain ${executableNames.ffmpeg}, ${executableNames.ffprobe}, and LICENSE.txt`,
    )
  }
  const subtitleFonts = []
  for (const font of lockedTarget.requiredFonts) {
    subtitleFonts.push({ source: await assertArchivedFile(extractionDir, font, `subtitle font ${font.fileName}`), fileName: font.fileName })
  }
  const subtitleFontLicense = path.join(extractionDir, "fonts", "OFL-1.1.txt")
  if (!(await exists(subtitleFontLicense))) throw new Error("Pinned FFmpeg archive is missing the subtitle font OFL-1.1 license")
  const smoke = lockedTarget.buildEvidence.candidateSmoke
  for (const [label, descriptor] of [
    ["render smoke output", smoke.render.output],
    ["render smoke probe", smoke.render.probe],
    ["subtitle smoke output", smoke.subtitle.output],
    ["subtitle smoke probe", smoke.subtitle.probe],
    ["subtitle smoke script", smoke.subtitle.script],
    ["subtitle smoke frame", smoke.subtitle.frame],
  ]) await assertArchivedFile(extractionDir, descriptor, label)
  return { ffmpeg, ffprobe, license, notices, configure, sourceMetadata, buildRecipe, subtitleFonts, subtitleFontLicense }
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

export async function copyExternalTools(ffmpeg, ffprobe, targetDir, executableNames, materialsDir, requiredFonts) {
  if (!(await exists(ffmpeg)) || !(await exists(ffprobe))) {
    throw new Error("ANYBOX_FFMPEG_BINARY and ANYBOX_FFPROBE_BINARY must point to existing files")
  }
  await fsp.mkdir(targetDir, { recursive: true })
  await fsp.copyFile(ffmpeg, path.join(targetDir, executableNames.ffmpeg))
  await fsp.copyFile(ffprobe, path.join(targetDir, executableNames.ffprobe))
  if (materialsDir) {
    for (const name of ["LICENSE.txt", "THIRD-PARTY-NOTICES.txt", "configure.txt", "SOURCE.txt", "BUILD-RECIPE.sh"]) {
      const source = path.join(materialsDir, name)
      if (!(await exists(source))) throw new Error(`Deliver Beta media materials are missing ${name}`)
      await fsp.copyFile(source, path.join(targetDir, name))
    }
    for (const font of requiredFonts) {
      const source = path.join(materialsDir, ...font.fileName.split("/"))
      if (!(await exists(source))) throw new Error(`Deliver Beta media materials are missing ${font.fileName}`)
      await assertDigest(source, font.sha256)
      const destination = path.join(targetDir, ...font.fileName.split("/"))
      await fsp.mkdir(path.dirname(destination), { recursive: true })
      await fsp.copyFile(source, destination)
    }
    const fontLicenseSource = path.join(materialsDir, "fonts", "OFL-1.1.txt")
    if (!(await exists(fontLicenseSource))) throw new Error("Deliver Beta media materials are missing fonts/OFL-1.1.txt")
    await fsp.copyFile(fontLicenseSource, path.join(targetDir, "fonts", "OFL-1.1.txt"))
    return
  }
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

export function resolveMediaToolsPreparation(lock, platform, arch, { externalTools = false } = {}) {
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
  if (!lockedTarget.distribution && !externalTools) {
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
    preparerID: externalTools ? `external-beta-${platform}-${arch}` : preparer.id,
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
  const externalMaterialsDir = readEnv("ANYBOX_MEDIA_RUNTIME_MATERIALS_DIR")
  if (Boolean(externalFFmpeg) !== Boolean(externalFFprobe)) {
    throw new Error("Set both ANYBOX_FFMPEG_BINARY and ANYBOX_FFPROBE_BINARY, or neither")
  }

  let origin = lockedTarget.origin
  let materials = { license: "archive", notices: "archive", configure: "archive", sourceMetadata: "archive", buildRecipe: "archive", subtitleFont: "archive", subtitleFontLicense: "archive" }
  if (externalFFmpeg && externalFFprobe) {
    origin = "environment-override"
    materials = externalMaterialsDir
      ? {
          license: "build-supplied-beta",
          notices: "build-supplied-beta",
          configure: "build-supplied-beta",
          sourceMetadata: "build-supplied-beta",
          buildRecipe: "build-supplied-beta",
          subtitleFont: "build-supplied-beta",
          subtitleFontLicense: "build-supplied-beta",
        }
      : {
          license: "generated-technical-preview",
          notices: "generated-technical-preview",
          configure: "runtime",
          sourceMetadata: "missing-technical-preview",
          buildRecipe: "missing-technical-preview",
          subtitleFont: "missing-technical-preview",
          subtitleFontLicense: "missing-technical-preview",
        }
    await copyExternalTools(externalFFmpeg, externalFFprobe, targetDir, executableNames, externalMaterialsDir, lockedTarget.requiredFonts)
  } else {
    const archive = path.join(cacheDir, lockedTarget.distribution.fileName)
    const extractionDir = path.join(cacheDir, lockedTarget.distribution.sha256)
    await downloadPinnedArchive(archive, lockedTarget.distribution)
    const tools = await extractPinnedTools(archive, extractionDir, executableNames, lockedTarget)
    await fsp.copyFile(tools.ffmpeg, path.join(targetDir, executableNames.ffmpeg))
    await fsp.copyFile(tools.ffprobe, path.join(targetDir, executableNames.ffprobe))
    await fsp.copyFile(tools.license, path.join(targetDir, lockedTarget.licensePolicy.licenseFile))
    if (tools.notices) await fsp.copyFile(tools.notices, path.join(targetDir, lockedTarget.licensePolicy.noticesFile))
    else materials.notices = "generated-technical-preview"
    if (tools.configure) await fsp.copyFile(tools.configure, path.join(targetDir, "configure.txt"))
    else materials.configure = "runtime"
    if (tools.sourceMetadata) await fsp.copyFile(tools.sourceMetadata, path.join(targetDir, "SOURCE.txt"))
    else materials.sourceMetadata = "missing-technical-preview"
    if (tools.buildRecipe) await fsp.copyFile(tools.buildRecipe, path.join(targetDir, "BUILD-RECIPE.sh"))
    else materials.buildRecipe = "missing-technical-preview"
    for (const font of tools.subtitleFonts) {
      const destination = path.join(targetDir, ...font.fileName.split("/"))
      await fsp.mkdir(path.dirname(destination), { recursive: true })
      await fsp.copyFile(font.source, destination)
    }
    const subtitleFontLicense = path.join(targetDir, "fonts", "OFL-1.1.txt")
    await fsp.mkdir(path.dirname(subtitleFontLicense), { recursive: true })
    await fsp.copyFile(tools.subtitleFontLicense, subtitleFontLicense)
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
  const runtimeID = externalFFmpeg
    ? `${lockedTarget.runtimeID.replace(/-candidate-pending$/, "")}-beta-${binaries[executableNames.ffmpeg].sha256.slice(0, 12)}`
    : lockedTarget.runtimeID
  await fsp.writeFile(
    path.join(targetDir, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      platform,
      arch,
      runtimeID,
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
    const sourceRevision = lockedTarget.distribution?.ffmpegRevision ?? ffmpegVersion
    const distributionReference = lockedTarget.distribution?.url ?? "Build-supplied FFmpeg/ffprobe pair"
    const buildSourceReference = lockedTarget.distribution?.buildSourceURL ?? "packages/desktop/scripts/build-media-runtime.sh"
    const sourceReference = lockedTarget.distribution?.sourceURL ?? "See the matching Beta build artifact source archive"
    await fsp.writeFile(
      noticesPath,
      [
        "FFmpeg media tools — technical preview notice",
        "",
        `Runtime ID: ${runtimeID}`,
        `Build: ${sourceRevision}`,
        `Binary distribution: ${distributionReference}`,
        `Build scripts: ${buildSourceReference}`,
        `Corresponding FFmpeg source revision: ${sourceReference}`,
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
  const externalFFmpeg = readEnv("ANYBOX_FFMPEG_BINARY")
  const externalFFprobe = readEnv("ANYBOX_FFPROBE_BINARY")
  if (Boolean(externalFFmpeg) !== Boolean(externalFFprobe)) {
    throw new Error("Set both ANYBOX_FFMPEG_BINARY and ANYBOX_FFPROBE_BINARY, or neither")
  }
  const resolution = resolveMediaToolsPreparation(runtimeLock, platform, arch, {
    externalTools: Boolean(externalFFmpeg && externalFFprobe),
  })
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
