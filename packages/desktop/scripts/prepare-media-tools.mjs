import { createHash } from "node:crypto"
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const desktopDir = path.resolve(scriptDir, "..")
const defaultRuntimeDir = path.join(desktopDir, "build", "agent-runtime")
const cacheDir = path.join(desktopDir, "build", "media-tools-cache")

// BtbN's win64 LGPL build intentionally excludes GPL-only codecs. Keep the
// release tag, filename, and digest together so `latest` can never silently
// change the media runtime shipped by Anybox.
export const WINDOWS_X64_MEDIA_TOOLS = Object.freeze({
  releaseTag: "autobuild-2026-07-09-14-21",
  ffmpegRevision: "N-125509-g8ad6288553",
  fileName: "ffmpeg-N-125509-g8ad6288553-win64-lgpl.zip",
  sha256: "fb8cfcaf01d765877317909ca734e9480ad01c2f0afa9c609ff7bd20426cceaf",
  sizeBytes: 146_553_051,
  url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-09-14-21/ffmpeg-N-125509-g8ad6288553-win64-lgpl.zip",
  sourceURL: "https://github.com/FFmpeg/FFmpeg/commit/8ad6288553",
  buildSourceURL: "https://github.com/BtbN/FFmpeg-Builds/tree/autobuild-2026-07-09-14-21",
})

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

async function downloadPinnedArchive(target) {
  if (await exists(target)) {
    try {
      await assertDigest(target, WINDOWS_X64_MEDIA_TOOLS.sha256)
      return
    } catch {
      await fsp.rm(target, { force: true })
    }
  }

  await fsp.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.download`
  await fsp.rm(temporary, { force: true })

  console.log(`[desktop][media] downloading pinned LGPL FFmpeg ${WINDOWS_X64_MEDIA_TOOLS.ffmpegRevision}`)
  const response = await fetch(WINDOWS_X64_MEDIA_TOOLS.url, { redirect: "follow" })
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
    if (stat.size !== WINDOWS_X64_MEDIA_TOOLS.sizeBytes) {
      throw new Error(`Media tools archive size mismatch: got ${stat.size}, expected ${WINDOWS_X64_MEDIA_TOOLS.sizeBytes}`)
    }
    await assertDigest(temporary, WINDOWS_X64_MEDIA_TOOLS.sha256)
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

async function extractPinnedTools(archive, extractionDir) {
  await fsp.rm(extractionDir, { recursive: true, force: true })
  await fsp.mkdir(extractionDir, { recursive: true })
  run("tar", ["-xf", archive, "-C", extractionDir])

  const ffmpeg = await findFile(extractionDir, "ffmpeg.exe")
  const ffprobe = await findFile(extractionDir, "ffprobe.exe")
  const license = await findFile(extractionDir, "LICENSE.txt")
  if (!ffmpeg || !ffprobe || !license) {
    throw new Error("Pinned FFmpeg archive does not contain ffmpeg.exe, ffprobe.exe, and LICENSE.txt")
  }
  return { ffmpeg, ffprobe, license }
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

async function copyExternalTools(ffmpeg, ffprobe, targetDir) {
  if (!(await exists(ffmpeg)) || !(await exists(ffprobe))) {
    throw new Error("ANYBOX_FFMPEG_BINARY and ANYBOX_FFPROBE_BINARY must point to existing files")
  }
  await fsp.copyFile(ffmpeg, path.join(targetDir, "ffmpeg.exe"))
  await fsp.copyFile(ffprobe, path.join(targetDir, "ffprobe.exe"))
  await fsp.writeFile(
    path.join(targetDir, "LICENSE.txt"),
    "Externally supplied FFmpeg build. The release pipeline must provide its matching license and notices.\n",
  )
}

export async function prepareMediaTools({ runtimeDir = defaultRuntimeDir } = {}) {
  if (process.platform !== "win32" || process.arch !== "x64") {
    console.log(`[desktop][media] skipping bundled media tools for unsupported target ${process.platform}/${process.arch}`)
    return
  }

  const targetDir = path.join(runtimeDir, "media-tools")
  await fsp.rm(targetDir, { recursive: true, force: true })
  await fsp.mkdir(targetDir, { recursive: true })

  const externalFFmpeg = readEnv("ANYBOX_FFMPEG_BINARY")
  const externalFFprobe = readEnv("ANYBOX_FFPROBE_BINARY")
  if (Boolean(externalFFmpeg) !== Boolean(externalFFprobe)) {
    throw new Error("Set both ANYBOX_FFMPEG_BINARY and ANYBOX_FFPROBE_BINARY, or neither")
  }

  let origin = "pinned-btbn-lgpl"
  if (externalFFmpeg && externalFFprobe) {
    origin = "environment-override"
    await copyExternalTools(externalFFmpeg, externalFFprobe, targetDir)
  } else {
    const archive = path.join(cacheDir, WINDOWS_X64_MEDIA_TOOLS.fileName)
    const extractionDir = path.join(cacheDir, WINDOWS_X64_MEDIA_TOOLS.sha256)
    await downloadPinnedArchive(archive)
    const tools = await extractPinnedTools(archive, extractionDir)
    await fsp.copyFile(tools.ffmpeg, path.join(targetDir, "ffmpeg.exe"))
    await fsp.copyFile(tools.ffprobe, path.join(targetDir, "ffprobe.exe"))
    await fsp.copyFile(tools.license, path.join(targetDir, "LICENSE.txt"))
  }

  const ffmpegVersion = await verifyExecutable(path.join(targetDir, "ffmpeg.exe"), "ffmpeg")
  const ffprobeVersion = await verifyExecutable(path.join(targetDir, "ffprobe.exe"), "ffprobe")
  await fsp.writeFile(
    path.join(targetDir, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      origin,
      ffmpegVersion,
      ffprobeVersion,
      distribution: WINDOWS_X64_MEDIA_TOOLS,
    }, null, 2)}\n`,
  )
  await fsp.writeFile(
    path.join(targetDir, "THIRD-PARTY-NOTICES.txt"),
    [
      "FFmpeg media tools",
      "",
      `Build: ${WINDOWS_X64_MEDIA_TOOLS.ffmpegRevision}`,
      `Binary distribution: ${WINDOWS_X64_MEDIA_TOOLS.url}`,
      `Build scripts: ${WINDOWS_X64_MEDIA_TOOLS.buildSourceURL}`,
      `Corresponding FFmpeg source revision: ${WINDOWS_X64_MEDIA_TOOLS.sourceURL}`,
      "License: GNU Lesser General Public License; see LICENSE.txt in this directory.",
      "Anybox invokes these executables as separate processes and does not load FFmpeg libraries into the application.",
      "",
    ].join("\n"),
  )

  console.log(`[desktop][media] prepared and verified media tools at ${targetDir}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareMediaTools()
}
