import { mkdir, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { inflateRawSync } from "node:zlib"

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP64_SENTINEL = 0xffffffff

export interface RegistryArchiveLimits {
  maxFiles: number
  maxDepth: number
  maxFileBytes: number
  maxTotalBytes: number
}

export const DEFAULT_REGISTRY_ARCHIVE_LIMITS: RegistryArchiveLimits = {
  maxFiles: 2_000,
  maxDepth: 20,
  maxFileBytes: 20 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
}

type ZipEntry = {
  rawName: string
  normalizedName: string | null
  flags: number
  method: number
  crc32: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  externalAttributes: number
}

export class RegistryArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RegistryArchiveError"
  }
}

function archiveError(message: string): never {
  throw new RegistryArchiveError(message)
}

function findEndOfCentralDirectory(archive: Buffer) {
  const minimumLength = 22
  const maximumCommentLength = 0xffff
  if (archive.length < minimumLength) archiveError("Registry skill archive is missing its central directory.")

  const start = Math.max(0, archive.length - minimumLength - maximumCommentLength)
  for (let offset = archive.length - minimumLength; offset >= start; offset -= 1) {
    if (archive.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset
  }
  return archiveError("Registry skill archive is missing its central directory.")
}

function decodeEntryName(bytes: Buffer, flags: number) {
  if ((flags & 0x800) !== 0) return bytes.toString("utf8")
  try {
    return new TextDecoder("ibm437" as ConstructorParameters<typeof TextDecoder>[0], { fatal: true }).decode(bytes)
  } catch {
    return bytes.toString("utf8")
  }
}

function normalizeEntryPath(rawName: string) {
  const slashName = rawName.replace(/\\/g, "/")
  if (slashName.includes("\0")) archiveError("Registry skill archive contains an invalid path.")

  const trimmed = slashName.replace(/\/+$/g, "")
  if (!trimmed) return null
  if (trimmed.startsWith("/") || /^[A-Za-z]:($|\/)/.test(trimmed)) {
    archiveError("Registry skill archive contains an absolute path.")
  }

  const segments = trimmed.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    archiveError("Registry skill archive contains an unsafe path.")
  }
  for (const segment of segments) {
    if (/[:*?"<>|\u0000-\u001f]/.test(segment)) {
      archiveError("Registry skill archive paths contain Windows-unsafe characters or alternate-data-stream segments.")
    }
    if (/[. ]$/.test(segment)) {
      archiveError("Registry skill archive paths must not end in a dot or space.")
    }
    const deviceName = segment.split(".", 1)[0]!.toUpperCase()
    if (/^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/u.test(deviceName)) {
      archiveError("Registry skill archive contains a reserved Windows device path.")
    }
  }
  return segments.join("/")
}

function zipEntryMode(entry: ZipEntry) {
  return (entry.externalAttributes >>> 16) & 0xffff
}

function isDirectory(entry: ZipEntry) {
  const mode = zipEntryMode(entry)
  return entry.rawName.endsWith("/") || entry.rawName.endsWith("\\") || (mode & 0o170000) === 0o040000
}

function validateEntryType(entry: ZipEntry) {
  const mode = zipEntryMode(entry)
  const type = mode & 0o170000
  if (type === 0 || type === 0o100000 || type === 0o040000) return
  if (type === 0o120000) archiveError("Registry skill archives must not contain symbolic links.")
  archiveError("Registry skill archives must not contain device files or other special files.")
}

function readEntries(archive: Buffer, limits: RegistryArchiveLimits): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(archive)
  const diskNumber = archive.readUInt16LE(eocdOffset + 4)
  const centralDirectoryDisk = archive.readUInt16LE(eocdOffset + 6)
  const entriesOnDisk = archive.readUInt16LE(eocdOffset + 8)
  const totalEntries = archive.readUInt16LE(eocdOffset + 10)
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16)

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== totalEntries) {
    archiveError("Split registry skill archives are not supported.")
  }
  if (totalEntries === 0xffff || centralDirectorySize === ZIP64_SENTINEL || centralDirectoryOffset === ZIP64_SENTINEL) {
    archiveError("ZIP64 registry skill archives are not supported.")
  }
  if (totalEntries > limits.maxFiles + 2_000) {
    archiveError("Registry skill archive contains too many entries.")
  }
  if (centralDirectoryOffset + centralDirectorySize > eocdOffset) {
    archiveError("Registry skill archive central directory is invalid.")
  }

  const entries: ZipEntry[] = []
  let offset = centralDirectoryOffset
  let totalBytes = 0
  let fileCount = 0
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      archiveError("Registry skill archive central directory is invalid.")
    }

    const flags = archive.readUInt16LE(offset + 8)
    const method = archive.readUInt16LE(offset + 10)
    const crc32 = archive.readUInt32LE(offset + 16)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const externalAttributes = archive.readUInt32LE(offset + 38)
    const localHeaderOffset = archive.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const nextOffset = nameStart + nameLength + extraLength + commentLength

    if (compressedSize === ZIP64_SENTINEL || uncompressedSize === ZIP64_SENTINEL || localHeaderOffset === ZIP64_SENTINEL) {
      archiveError("ZIP64 registry skill archives are not supported.")
    }
    if (nextOffset > archive.length) archiveError("Registry skill archive central directory is invalid.")

    const entry: ZipEntry = {
      rawName: decodeEntryName(archive.subarray(nameStart, nameStart + nameLength), flags),
      normalizedName: null,
      flags,
      method,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      externalAttributes,
    }
    entry.normalizedName = normalizeEntryPath(entry.rawName)
    validateEntryType(entry)

    if (entry.normalizedName && entry.normalizedName.split("/").length > limits.maxDepth) {
      archiveError("Registry skill archive is nested too deeply.")
    }
    if (!isDirectory(entry)) {
      fileCount += 1
      totalBytes += entry.uncompressedSize
      if (fileCount > limits.maxFiles) archiveError("Registry skill archive contains too many files.")
      if (entry.uncompressedSize > limits.maxFileBytes) archiveError("Registry skill archive contains a file that is too large.")
      if (totalBytes > limits.maxTotalBytes) archiveError("Registry skill archive expands beyond the allowed size.")
    }

    entries.push(entry)
    offset = nextOffset
  }
  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    archiveError("Registry skill archive central directory size is invalid.")
  }

  validateEntryCollisions(entries)
  return entries
}

function validateEntryCollisions(entries: ZipEntry[]) {
  const files = new Set<string>()
  const directories = new Set<string>()

  for (const entry of entries) {
    if (!entry.normalizedName) continue
    const key = entry.normalizedName.normalize("NFC").toLocaleLowerCase("en-US")
    const segments = key.split("/")
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join("/")
      if (files.has(parent)) archiveError("Registry skill archive contains conflicting file paths.")
      directories.add(parent)
    }

    if (isDirectory(entry)) {
      if (files.has(key)) archiveError("Registry skill archive contains conflicting file paths.")
      directories.add(key)
    } else {
      if (files.has(key) || directories.has(key)) archiveError("Registry skill archive contains duplicate or conflicting file paths.")
      files.add(key)
    }
  }
}

let crcTable: Uint32Array | undefined

function crc32(bytes: Buffer) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let value = 0; value < 256; value += 1) {
      let current = value
      for (let bit = 0; bit < 8; bit += 1) {
        current = (current & 1) !== 0 ? 0xedb88320 ^ (current >>> 1) : current >>> 1
      }
      crcTable[value] = current >>> 0
    }
  }

  let result = 0xffffffff
  for (const byte of bytes) {
    result = crcTable[(result ^ byte) & 0xff]! ^ (result >>> 8)
  }
  return (result ^ 0xffffffff) >>> 0
}

function readEntryData(archive: Buffer, entry: ZipEntry, limits: RegistryArchiveLimits) {
  if ((entry.flags & 0x1) !== 0) archiveError("Encrypted registry skill archives are not supported.")
  if (entry.localHeaderOffset + 30 > archive.length) archiveError("Registry skill archive local header is invalid.")
  if (archive.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    archiveError("Registry skill archive local header is invalid.")
  }

  const localFlags = archive.readUInt16LE(entry.localHeaderOffset + 6)
  const localMethod = archive.readUInt16LE(entry.localHeaderOffset + 8)
  const nameLength = archive.readUInt16LE(entry.localHeaderOffset + 26)
  const extraLength = archive.readUInt16LE(entry.localHeaderOffset + 28)
  const nameStart = entry.localHeaderOffset + 30
  const dataStart = nameStart + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > archive.length) archiveError("Registry skill archive file data is invalid.")

  const localName = decodeEntryName(archive.subarray(nameStart, nameStart + nameLength), localFlags)
  if (normalizeEntryPath(localName) !== entry.normalizedName || localMethod !== entry.method) {
    archiveError("Registry skill archive local and central headers do not match.")
  }

  const compressed = archive.subarray(dataStart, dataEnd)
  let data: Buffer
  if (entry.method === 0) {
    data = Buffer.from(compressed)
  } else if (entry.method === 8) {
    try {
      data = inflateRawSync(compressed, { maxOutputLength: Math.min(limits.maxFileBytes, entry.uncompressedSize) + 1 })
    } catch {
      return archiveError("Registry skill archive file data is invalid.")
    }
  } else {
    return archiveError(`Registry skill archive uses unsupported compression method ${entry.method}.`)
  }

  if (data.length !== entry.uncompressedSize || data.length > limits.maxFileBytes) {
    archiveError("Registry skill archive file size does not match its metadata.")
  }
  if (crc32(data) !== entry.crc32) archiveError("Registry skill archive file checksum is invalid.")
  return data
}

function ensureInside(root: string, candidate: string) {
  const relativePath = relative(root, candidate)
  if (relativePath && (relativePath.startsWith("..") || isAbsolute(relativePath))) {
    archiveError("Registry skill archive contains a path outside the extraction directory.")
  }
}

export async function extractRegistryZipArchive(
  archive: Buffer,
  destination: string,
  limits: RegistryArchiveLimits = DEFAULT_REGISTRY_ARCHIVE_LIMITS,
) {
  const destinationRoot = resolve(destination)
  const entries = readEntries(archive, limits)
  await mkdir(destinationRoot, { recursive: true })

  for (const entry of entries) {
    if (!entry.normalizedName) continue
    const target = resolve(destinationRoot, entry.normalizedName)
    ensureInside(destinationRoot, target)
    if (isDirectory(entry)) {
      await mkdir(target, { recursive: true })
      continue
    }

    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, readEntryData(archive, entry, limits), { flag: "wx" })
  }

  return {
    files: entries.filter((entry) => entry.normalizedName && !isDirectory(entry)).length,
    unpackedBytes: entries.reduce((total, entry) => total + (isDirectory(entry) ? 0 : entry.uncompressedSize), 0),
  }
}
