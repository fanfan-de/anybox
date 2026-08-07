import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import * as Global from "#global/global.ts"
import { Instance } from "#project/instance.ts"
import { getServerBaseURL } from "#server/base-url.ts"
import * as Filesystem from "#util/filesystem.ts"

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const SAFE_ASSET_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const MODEL_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"])

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  "image/apng": ".png",
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
}

export interface ImageAssetMetadata {
  assetID: string
  sessionID: string
  path: string
  url: string
  mime: string
  filename: string
  width?: number
  height?: number
  sizeBytes: number
  /** Optional for assets written before SHA-256 metadata was introduced. */
  sha256?: string
  sourceTool: "generate_image" | "view_image"
  prompt?: string
  originalPath?: string
  createdAt: number
}

export interface SaveImageAssetInput {
  sessionID: string
  bytes: Uint8Array
  mime: string
  filename?: string
  sourceTool: ImageAssetMetadata["sourceTool"]
  prompt?: string
  originalPath?: string
}

function getSessionAssetsDirectory(sessionID: string) {
  return path.join(Global.Path.state, "sessions", makeSafeFileSegment(sessionID), "assets", "images")
}

function makeSafeFileSegment(value: string) {
  if (SAFE_ASSET_ID_PATTERN.test(value)) return value

  const hash = createHash("sha256").update(value).digest("hex").slice(0, 16)
  const readable = value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80)
  return readable ? `${readable}_${hash}` : `session_${hash}`
}

function sanitizeFilename(filename: string | undefined, extension: string) {
  const base = path.basename(filename?.trim() || `image${extension}`)
  const withoutBadChars = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim()
  return withoutBadChars || `image${extension}`
}

function assertWithin(parent: string, child: string) {
  const resolvedParent = path.resolve(parent)
  const resolvedChild = path.resolve(child)
  const relative = path.relative(resolvedParent, resolvedChild)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return
  throw new Error(`Resolved asset path is outside expected directory: ${resolvedChild}`)
}

function assetURL(sessionID: string, assetID: string) {
  const base = getServerBaseURL()
  return new URL(
    `/api/sessions/${encodeURIComponent(sessionID)}/assets/${encodeURIComponent(assetID)}`,
    base,
  ).toString()
}

export function isSupportedImageMime(mime: string) {
  return Boolean(IMAGE_EXTENSION_BY_MIME[mime.toLowerCase()])
}

export function isModelImageMime(mime: string) {
  return MODEL_IMAGE_MIMES.has(mime.toLowerCase())
}

function sniffImageMime(bytes: Uint8Array, fallbackExtension?: string) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png"
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }

  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp"
  }

  if (
    bytes.length >= 6 &&
    (String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a" ||
      String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a")
  ) {
    return "image/gif"
  }

  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp"
  }

  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(4, 8)) === "ftyp" &&
    String.fromCharCode(...bytes.slice(8, Math.min(bytes.length, 16))).includes("avif")
  ) {
    return "image/avif"
  }

  if (fallbackExtension === ".svg") {
    const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 1024)).trimStart()
    if (prefix.startsWith("<svg") || prefix.startsWith("<?xml") && prefix.includes("<svg")) {
      return "image/svg+xml"
    }
  }

  return ""
}

function readUint24LE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

export function readImageDimensions(bytes: Uint8Array, mime: string): { width?: number; height?: number } {
  if (mime === "image/png" && bytes.length >= 24) {
    return {
      width: Buffer.from(bytes).readUInt32BE(16),
      height: Buffer.from(bytes).readUInt32BE(20),
    }
  }

  if (mime === "image/gif" && bytes.length >= 10) {
    return {
      width: Buffer.from(bytes).readUInt16LE(6),
      height: Buffer.from(bytes).readUInt16LE(8),
    }
  }

  if (mime === "image/webp" && bytes.length >= 30) {
    const chunkType = String.fromCharCode(...bytes.slice(12, 16))
    if (chunkType === "VP8X" && bytes.length >= 30) {
      return {
        width: readUint24LE(bytes, 24) + 1,
        height: readUint24LE(bytes, 27) + 1,
      }
    }
    if (chunkType === "VP8 " && bytes.length >= 30) {
      return {
        width: Buffer.from(bytes).readUInt16LE(26) & 0x3fff,
        height: Buffer.from(bytes).readUInt16LE(28) & 0x3fff,
      }
    }
  }

  if (mime === "image/jpeg") {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if ((bytes[offset] ?? 0) !== 0xff) {
        offset += 1
        continue
      }

      const marker = bytes[offset + 1] ?? 0
      const length = Buffer.from(bytes).readUInt16BE(offset + 2)
      if (length < 2) break

      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return {
          height: Buffer.from(bytes).readUInt16BE(offset + 5),
          width: Buffer.from(bytes).readUInt16BE(offset + 7),
        }
      }

      offset += 2 + length
    }
  }

  return {}
}

function resolveLocalImagePath(inputPath: string) {
  if (inputPath.startsWith("\\\\") || inputPath.startsWith("//")) {
    throw new Error(`UNC paths are not supported: ${inputPath}`)
  }

  const resolved = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(Instance.directory, inputPath)

  return Filesystem.normalizePath(resolved)
}

export async function readLocalImage(inputPath: string) {
  const resolved = resolveLocalImagePath(inputPath)
  const info = await stat(resolved)
  if (!info.isFile()) {
    throw new Error(`Path is not a file: ${inputPath}`)
  }
  if (info.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image is too large (${info.size} bytes). Maximum supported size is ${MAX_IMAGE_BYTES} bytes.`)
  }

  const bytes = await readFile(resolved)
  const extension = path.extname(resolved).toLowerCase()
  const mime = sniffImageMime(bytes, extension)
  if (!isSupportedImageMime(mime)) {
    throw new Error(`Unsupported image file type: ${inputPath}`)
  }

  return {
    path: resolved,
    bytes,
    mime,
    filename: path.basename(resolved),
    ...readImageDimensions(bytes, mime),
  }
}

export async function saveImageAsset(input: SaveImageAssetInput): Promise<ImageAssetMetadata> {
  const mime = input.mime.toLowerCase()
  if (!isSupportedImageMime(mime)) {
    throw new Error(`Unsupported generated image media type: ${input.mime}`)
  }

  const extension = IMAGE_EXTENSION_BY_MIME[mime] ?? ".img"
  const filename = sanitizeFilename(input.filename, extension)
  const dir = getSessionAssetsDirectory(input.sessionID)
  await mkdir(dir, { recursive: true })

  const assetID = `${Date.now()}-${randomUUID()}${extension}`
  const filepath = path.join(dir, assetID)
  const metadataPath = path.join(dir, `${assetID}.json`)
  assertWithin(dir, filepath)
  assertWithin(dir, metadataPath)

  await writeFile(filepath, input.bytes)
  const dimensions = readImageDimensions(input.bytes, mime)
  const metadata: ImageAssetMetadata = {
    assetID,
    sessionID: input.sessionID,
    path: filepath,
    url: assetURL(input.sessionID, assetID),
    mime,
    filename,
    ...dimensions,
    sizeBytes: input.bytes.byteLength,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    sourceTool: input.sourceTool,
    prompt: input.prompt,
    originalPath: input.originalPath,
    createdAt: Date.now(),
  }
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8")
  return metadata
}

export async function readImageAsset(sessionID: string, assetID: string) {
  if (!SAFE_ASSET_ID_PATTERN.test(assetID)) {
    throw new Error("Invalid asset id.")
  }

  const dir = getSessionAssetsDirectory(sessionID)
  const filepath = path.join(dir, assetID)
  const metadataPath = path.join(dir, `${assetID}.json`)
  assertWithin(dir, filepath)
  assertWithin(dir, metadataPath)

  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as ImageAssetMetadata
  if (metadata.sessionID !== sessionID || metadata.assetID !== assetID) {
    throw new Error("Image asset metadata does not match the requested asset reference.")
  }
  await stat(filepath)
  return {
    metadata,
    file: Bun.file(filepath),
  }
}

export interface ImageAssetRef {
  sessionID: string
  assetID: string
}

/**
 * Recovers the stable asset identity from an Anybox attachment URL. The host
 * and port are intentionally ignored because persisted sessions can outlive a
 * desktop server instance.
 */
export function parseImageAssetURL(value: string): ImageAssetRef | undefined {
  let pathname: string
  try {
    pathname = new URL(value, "http://anybox.local").pathname
  } catch {
    return undefined
  }

  const match = /^\/api\/sessions\/([^/]+)\/assets\/([^/]+)\/?$/.exec(pathname)
  if (!match) return undefined

  try {
    const sessionID = decodeURIComponent(match[1] ?? "")
    const assetID = decodeURIComponent(match[2] ?? "")
    if (!sessionID || !SAFE_ASSET_ID_PATTERN.test(assetID)) return undefined
    return { sessionID, assetID }
  } catch {
    return undefined
  }
}

/** Reads an image asset for one model request without persisting its bytes. */
export async function readImageAssetBytes(ref: ImageAssetRef) {
  const asset = await readImageAsset(ref.sessionID, ref.assetID)
  const bytes = new Uint8Array(await asset.file.arrayBuffer())
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image is too large (${bytes.byteLength} bytes). Maximum supported size is ${MAX_IMAGE_BYTES} bytes.`,
    )
  }

  const mime = asset.metadata.mime.toLowerCase()
  if (!isModelImageMime(mime)) {
    throw new Error(
      `Image format ${asset.metadata.mime} cannot be sent to the model. Convert it to PNG, JPEG, or WebP first.`,
    )
  }

  const sniffedMime = sniffImageMime(bytes, path.extname(asset.metadata.path).toLowerCase())
  if (sniffedMime !== mime) {
    throw new Error(
      `Image bytes do not match the stored media type (${asset.metadata.mime}). Reopen the source image with view_image.`,
    )
  }

  return {
    metadata: asset.metadata,
    bytes,
    sha256: asset.metadata.sha256 ?? createHash("sha256").update(bytes).digest("hex"),
  }
}
