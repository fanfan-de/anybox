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

export function isSupportedImageMime(mime: string) {
  return Boolean(IMAGE_EXTENSION_BY_MIME[mime.toLowerCase()])
}

function readUint24LE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
}

export function readImageDimensions(bytes: Uint8Array, mime: string): { width?: number; height?: number } {
  if (mime === "image/png" && bytes.length >= 24) {
    return { width: Buffer.from(bytes).readUInt32BE(16), height: Buffer.from(bytes).readUInt32BE(20) }
  }
  if (mime === "image/gif" && bytes.length >= 10) {
    return { width: Buffer.from(bytes).readUInt16LE(6), height: Buffer.from(bytes).readUInt16LE(8) }
  }
  if (mime === "image/webp" && bytes.length >= 30) {
    const chunkType = String.fromCharCode(...bytes.slice(12, 16))
    if (chunkType === "VP8X") return { width: readUint24LE(bytes, 24) + 1, height: readUint24LE(bytes, 27) + 1 }
    if (chunkType === "VP8 ") {
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
