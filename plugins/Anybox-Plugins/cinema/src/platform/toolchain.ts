import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { access, chmod, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createGunzip } from "node:zlib"
import * as Global from "#global/global.ts"
import { ApiError } from "#server/error.ts"
import * as Lock from "#util/lock.ts"

type ToolchainTarget = {
  runtimeID: string
  distribution: { fileName: string; sha256: string; sizeBytes: number; url: string }
  executables: { ffmpeg: string; ffprobe: string }
  binaries: Record<string, { sha256: string }>
  requiredFonts?: Array<{ fileName: string; sha256: string }>
}

type ToolchainLock = {
  schemaVersion: 1
  platforms: Record<string, { status: string; targets: Record<string, ToolchainTarget> }>
}

let installController: AbortController | undefined
let lockPathOverride: string | undefined
const MAX_ARCHIVE_ENTRIES = 20_000
const MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024
const MAX_ENTRY_BYTES = 1024 * 1024 * 1024

function lockPath() {
  if (lockPathOverride) return lockPathOverride
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  return path.basename(moduleDirectory) === "runtime"
    ? path.join(moduleDirectory, "toolchain.lock.json")
    : path.resolve(moduleDirectory, "..", "..", "toolchain.lock.json")
}

type ArchiveLimits = { entries: number; unpackedBytes: number }

export function assertSafeToolchainArchiveEntry(
  entryPath: string,
  type: string | undefined,
  size: number,
  limits: ArchiveLimits,
) {
  if (path.isAbsolute(entryPath) || entryPath.split(/[\\/]/).includes("..")) {
    throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive contains an unsafe path.")
  }
  if (type !== "File" && type !== "Directory") {
    throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive contains a link or unsupported entry type.")
  }
  limits.entries += 1
  if (type === "File") limits.unpackedBytes += size
  if (
    limits.entries > MAX_ARCHIVE_ENTRIES
    || size > MAX_ENTRY_BYTES
    || limits.unpackedBytes > MAX_UNPACKED_BYTES
  ) {
    throw new ApiError(413, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive exceeds the reviewed extraction limits.")
  }
}

function tarText(header: Buffer, offset: number, length: number) {
  const end = header.indexOf(0, offset)
  return header.subarray(offset, end >= offset && end < offset + length ? end : offset + length).toString("utf8").trim()
}

function tarOctal(header: Buffer, offset: number, length: number) {
  const value = tarText(header, offset, length).replace(/^0+/, "") || "0"
  if (!/^[0-7]+$/.test(value)) throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive contains an invalid numeric header.")
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive contains an invalid entry size.")
  return parsed
}

function verifyTarHeader(header: Buffer) {
  const expected = tarOctal(header, 148, 8)
  let actual = 0
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index]
  }
  if (actual !== expected) throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive header checksum is invalid.")
}

function safeArchivePath(header: Buffer) {
  const name = tarText(header, 0, 100)
  const prefix = tarText(header, 345, 155)
  const value = prefix ? `${prefix}/${name}` : name
  if (
    !value
    || value.includes("\\")
    || value.includes(":")
    || value.includes("\0")
    || path.posix.isAbsolute(value)
    || value.split("/").some((segment) => !segment || segment === "." || segment === ".." || /[. ]$/.test(segment))
  ) throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive contains an unsafe path.")
  return value
}

async function extractReviewedTarGzip(archive: string, destination: string) {
  const stream = createReadStream(archive).pipe(createGunzip())
  const iterator = stream[Symbol.asyncIterator]()
  let pending = Buffer.alloc(0)
  const limits: ArchiveLimits = { entries: 0, unpackedBytes: 0 }
  const destinations = new Set<string>()

  async function fill() {
    const next = await iterator.next()
    if (next.done) return false
    const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value)
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk
    return true
  }

  async function exact(length: number) {
    while (pending.length < length && await fill()) { /* keep reading */ }
    if (pending.length < length) throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive ended unexpectedly.")
    const value = pending.subarray(0, length)
    pending = pending.subarray(length)
    return value
  }

  async function discard(length: number) {
    let remaining = length
    while (remaining > 0) {
      if (pending.length === 0 && !await fill()) {
        throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive ended unexpectedly.")
      }
      const consumed = Math.min(remaining, pending.length)
      pending = pending.subarray(consumed)
      remaining -= consumed
    }
  }

  async function writeEntry(file: string, length: number) {
    const handle = await open(file, "wx", 0o600)
    try {
      let remaining = length
      while (remaining > 0) {
        if (pending.length === 0 && !await fill()) {
          throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive ended unexpectedly.")
        }
        const consumed = Math.min(remaining, pending.length)
        await handle.write(pending.subarray(0, consumed))
        pending = pending.subarray(consumed)
        remaining -= consumed
      }
    } finally {
      await handle.close()
    }
  }

  let zeroBlocks = 0
  try {
    while (zeroBlocks < 2) {
      const header = await exact(512)
      if (header.every((byte) => byte === 0)) {
        zeroBlocks += 1
        continue
      }
      zeroBlocks = 0
      verifyTarHeader(header)
      const entryPath = safeArchivePath(header)
      const typeFlag = String.fromCharCode(header[156] || 0)
      const type = typeFlag === "\0" || typeFlag === "0"
        ? "File"
        : typeFlag === "5"
          ? "Directory"
          : typeFlag
      const size = tarOctal(header, 124, 12)
      assertSafeToolchainArchiveEntry(entryPath, type, size, limits)
      const candidate = path.resolve(destination, ...entryPath.split("/"))
      const relative = path.relative(path.resolve(destination), candidate)
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive escapes its staging directory.")
      }
      const collisionKey = process.platform === "win32" ? candidate.toLowerCase() : candidate
      if (destinations.has(collisionKey)) throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive contains duplicate paths.")
      destinations.add(collisionKey)
      if (type === "Directory") {
        if (size !== 0) throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive contains an invalid directory entry.")
        await mkdir(candidate, { recursive: true })
      } else {
        await mkdir(path.dirname(candidate), { recursive: true })
        await writeEntry(candidate, size)
      }
      await discard((512 - (size % 512)) % 512)
    }
  } catch (error) {
    stream.destroy()
    if (error instanceof ApiError) throw error
    throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive could not be safely extracted.", error)
  } finally {
    stream.destroy()
  }
}

async function targetForCurrentPlatform() {
  const lock = JSON.parse(await readFile(lockPath(), "utf8")) as ToolchainLock
  const target = lock.platforms[process.platform]?.targets?.[process.arch]
  if (!target) throw new ApiError(501, "TOOLCHAIN_PLATFORM_UNSUPPORTED", `Cinema media tools are unavailable on ${process.platform}/${process.arch}.`)
  return target
}

function runtimeRoot(target: ToolchainTarget) {
  return path.join(Global.Path.data, "toolchains", target.runtimeID)
}

async function sha256(file: string) {
  const bytes = await readFile(file)
  return createHash("sha256").update(bytes).digest("hex")
}

async function findFiles(root: string, name: string) {
  const matches: string[] = []
  const glob = new Bun.Glob(`**/${name.replace(/\\/g, "/")}`)
  for await (const match of glob.scan({ cwd: root, absolute: true, onlyFiles: true })) matches.push(match)
  return matches
}

async function validateInstalled(target: ToolchainTarget, root: string) {
  const [ffmpegFiles, ffprobeFiles] = await Promise.all([
    findFiles(root, target.executables.ffmpeg),
    findFiles(root, target.executables.ffprobe),
  ])
  if (ffmpegFiles.length !== 1 || ffprobeFiles.length !== 1) return undefined
  const [ffmpeg] = ffmpegFiles
  const [ffprobe] = ffprobeFiles
  const expectedFFmpeg = target.binaries[target.executables.ffmpeg]?.sha256
  const expectedFFprobe = target.binaries[target.executables.ffprobe]?.sha256
  if (!expectedFFmpeg || !expectedFFprobe) return undefined
  if (await sha256(ffmpeg) !== expectedFFmpeg || await sha256(ffprobe) !== expectedFFprobe) return undefined
  const resolvedRoot = await realpath(root)
  const resolvedFFmpeg = await realpath(ffmpeg)
  const resolvedFFprobe = await realpath(ffprobe)
  if (
    !resolvedFFmpeg.startsWith(`${resolvedRoot}${path.sep}`)
    || !resolvedFFprobe.startsWith(`${resolvedRoot}${path.sep}`)
  ) return undefined
  let fontsDirectory = path.join(path.dirname(resolvedFFmpeg), "fonts")
  for (const font of target.requiredFonts ?? []) {
    const matches = await findFiles(root, font.fileName)
    if (matches.length !== 1 || await sha256(matches[0]) !== font.sha256) return undefined
    fontsDirectory = path.dirname(await realpath(matches[0]))
  }
  return {
    runtimeID: target.runtimeID,
    ffmpeg: resolvedFFmpeg,
    ffprobe: resolvedFFprobe,
    fontsDirectory,
  }
}

export async function getToolchainStatus() {
  const target = await targetForCurrentPlatform()
  const installed = await validateInstalled(target, runtimeRoot(target)).catch(() => undefined)
  return {
    platform: process.platform,
    architecture: process.arch,
    runtimeID: target.runtimeID,
    status: installed ? "ready" as const : "not_installed" as const,
    download: { sizeBytes: target.distribution.sizeBytes },
    ...(installed ? { tools: installed } : {}),
  }
}

async function installArchive(archive: string, target: ToolchainTarget) {
  const info = await stat(archive)
  if (!info.isFile() || info.size !== target.distribution.sizeBytes) throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive size does not match the reviewed lock.")
  if (await sha256(archive) !== target.distribution.sha256) throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive digest does not match the reviewed lock.")
  const root = runtimeRoot(target)
  const staging = `${root}.staging-${crypto.randomUUID()}`
  await mkdir(staging, { recursive: true })
  try {
    await extractReviewedTarGzip(archive, staging)
    const installed = await validateInstalled(target, staging)
    if (!installed) throw new ApiError(400, "TOOLCHAIN_ARCHIVE_INVALID", "Media tool archive contents failed verification.")
    await mkdir(path.dirname(root), { recursive: true })
    const previous = `${root}.previous-${crypto.randomUUID()}`
    const hasPrevious = await stat(root).then((item) => item.isDirectory()).catch(() => false)
    if (hasPrevious) await rename(root, previous)
    try {
      await rename(staging, root)
    } catch (error) {
      if (hasPrevious) await rename(previous, root).catch(() => undefined)
      throw error
    }
    try {
      const activated = await validateInstalled(target, root)
      if (!activated) throw new ApiError(500, "TOOLCHAIN_INSTALL_FAILED", "Activated media tools failed verification.")
      if (process.platform !== "win32") {
        await Promise.all([
          chmod(activated.ffmpeg, 0o755),
          chmod(activated.ffprobe, 0o755),
        ])
      }
    } catch (error) {
      await rm(root, { recursive: true, force: true })
      if (hasPrevious) await rename(previous, root).catch(() => undefined)
      throw error
    }
    if (hasPrevious) await rm(previous, { recursive: true, force: true })
    return await getToolchainStatus()
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

export async function importToolchainArchive(archive: string) {
  using _lock = await Lock.write("cinema-toolchain-install")
  return await installArchive(await realpath(archive), await targetForCurrentPlatform())
}

export async function installToolchain() {
  if (installController) throw new ApiError(409, "TOOLCHAIN_INSTALL_IN_PROGRESS", "Media tool installation is already running.")
  const target = await targetForCurrentPlatform()
  installController = new AbortController()
  const partialRoot = path.join(Global.Path.cache, "toolchain-downloads")
  const partial = path.join(partialRoot, `${target.distribution.fileName}.partial`)
  await mkdir(partialRoot, { recursive: true })
  try {
    let existing = await stat(partial).then((item) => item.size).catch(() => 0)
    if (existing > target.distribution.sizeBytes) {
      await rm(partial, { force: true })
      existing = 0
    }
    const activateDownloaded = async () => {
      using _lock = await Lock.write("cinema-toolchain-install")
      try {
        const installed = await installArchive(partial, target)
        await rm(partial, { force: true })
        return installed
      } catch (error) {
        if (error instanceof ApiError && error.code === "TOOLCHAIN_ARCHIVE_INVALID") {
          await rm(partial, { force: true })
        }
        throw error
      }
    }
    if (existing === target.distribution.sizeBytes) return await activateDownloaded()
    const headers = existing > 0 ? { Range: `bytes=${existing}-` } : undefined
    const response = await fetch(target.distribution.url, { headers, signal: installController.signal, redirect: "follow" })
    if (!response.ok || (existing > 0 && response.status !== 200 && response.status !== 206)) {
      throw new ApiError(502, "TOOLCHAIN_DOWNLOAD_FAILED", `Media tool download failed with HTTP ${response.status}.`)
    }
    if (response.status === 206) {
      const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get("content-range") ?? "")
      if (!match || Number(match[1]) !== existing || Number(match[3]) !== target.distribution.sizeBytes) {
        throw new ApiError(502, "TOOLCHAIN_DOWNLOAD_FAILED", "Media tool download returned an invalid resume range.")
      }
    }
    const writer = await open(partial, existing > 0 && response.status === 206 ? "a" : "w")
    let downloaded = existing > 0 && response.status === 206 ? existing : 0
    const reader = response.body?.getReader()
    if (!reader) throw new ApiError(502, "TOOLCHAIN_DOWNLOAD_FAILED", "Media tool download returned no body.")
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        downloaded += value.byteLength
        if (downloaded > target.distribution.sizeBytes) {
          await reader.cancel()
          throw new ApiError(502, "TOOLCHAIN_DOWNLOAD_FAILED", "Media tool download exceeded the reviewed archive size.")
        }
        await writer.write(value)
      }
    } finally {
      await writer.close()
    }
    if (downloaded !== target.distribution.sizeBytes) {
      throw new ApiError(502, "TOOLCHAIN_DOWNLOAD_FAILED", "Media tool download ended before the reviewed archive size was reached.")
    }
    return await activateDownloaded()
  } finally {
    installController = undefined
  }
}

export function cancelToolchainInstall() {
  const canceled = Boolean(installController)
  installController?.abort()
  return { canceled }
}

export async function resolveInstalledToolchain() {
  const target = await targetForCurrentPlatform()
  const installed = await validateInstalled(target, runtimeRoot(target)).catch(() => undefined)
  if (!installed) throw new ApiError(409, "TOOLCHAIN_REQUIRED", "Install the reviewed Cinema media toolchain before using Deliver.")
  await Promise.all([access(installed.ffmpeg), access(installed.ffprobe)])
  return installed
}

export function setToolchainLockPathForTest(value: string | undefined) {
  const previous = lockPathOverride
  lockPathOverride = value
  return () => { lockPathOverride = previous }
}
