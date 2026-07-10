import { createHash } from "node:crypto"
import { open } from "node:fs/promises"
import { ApiError } from "#server/error.ts"

const HEADER_LIMIT = 16 * 1024
const FIELD_LIMIT = 64 * 1024
const PREAMBLE_LIMIT = 1024
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024
const HEAD_CAPTURE_BYTES = 64 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: false })
type MultipartBytes = Uint8Array<ArrayBufferLike>
type MultipartStreamReader = {
  read(): Promise<{ done: false; value: MultipartBytes } | { done: true; value?: MultipartBytes }>
  cancel(reason?: unknown): Promise<void>
}

function concatBytes(left: MultipartBytes, right: MultipartBytes): MultipartBytes {
  if (left.byteLength === 0) return right
  if (right.byteLength === 0) return left
  const combined = new Uint8Array(left.byteLength + right.byteLength)
  combined.set(left, 0)
  combined.set(right, left.byteLength)
  return combined
}

function indexOfBytes(input: MultipartBytes, needle: MultipartBytes) {
  if (needle.byteLength === 0) return 0
  const max = input.byteLength - needle.byteLength
  for (let index = 0; index <= max; index += 1) {
    let matches = true
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (input[index + offset] !== needle[offset]) {
        matches = false
        break
      }
    }
    if (matches) return index
  }
  return -1
}

class StreamingMultipartReader {
  private buffer: MultipartBytes = new Uint8Array(0)
  private ended = false

  constructor(private readonly reader: MultipartStreamReader) {}

  private async fill() {
    if (this.ended) return false
    const result = await this.reader.read()
    if (result.done) {
      this.ended = true
      return false
    }
    this.buffer = concatBytes(this.buffer, result.value)
    return true
  }

  async ensure(length: number) {
    while (this.buffer.byteLength < length) {
      if (!(await this.fill())) {
        throw new ApiError(400, "CINEMA_LIBRARY_MULTIPART_INVALID", "Multipart body ended unexpectedly.")
      }
    }
  }

  take(length: number) {
    const result = this.buffer.slice(0, length)
    this.buffer = this.buffer.slice(length)
    return result
  }

  async readUntil(
    delimiter: MultipartBytes,
    maxBytes: number,
    onChunk?: (chunk: MultipartBytes) => Promise<void>,
  ) {
    const collected: MultipartBytes[] = []
    let collectedBytes = 0

    while (true) {
      const delimiterIndex = indexOfBytes(this.buffer, delimiter)
      if (delimiterIndex >= 0) {
        const value = this.take(delimiterIndex)
        this.take(delimiter.byteLength)
        if (value.byteLength > 0) {
          if (onChunk) await onChunk(value)
          else {
            collectedBytes += value.byteLength
            if (collectedBytes > maxBytes) {
              throw new ApiError(400, "CINEMA_LIBRARY_MULTIPART_INVALID", "Multipart field is too large.")
            }
            collected.push(value)
          }
        }
        return onChunk
          ? new Uint8Array(0)
          : collected.reduce((result, chunk) => concatBytes(result, chunk), new Uint8Array(0))
      }

      const safeBytes = Math.max(0, this.buffer.byteLength - delimiter.byteLength + 1)
      if (safeBytes > 0) {
        const value = this.take(safeBytes)
        if (onChunk) await onChunk(value)
        else {
          collectedBytes += value.byteLength
          if (collectedBytes > maxBytes) {
            throw new ApiError(400, "CINEMA_LIBRARY_MULTIPART_INVALID", "Multipart field is too large.")
          }
          collected.push(value)
        }
      }

      if (!(await this.fill())) {
        throw new ApiError(400, "CINEMA_LIBRARY_MULTIPART_INVALID", "Multipart boundary is missing.")
      }
    }
  }

  async cancel() {
    await this.reader.cancel().catch(() => undefined)
  }
}

function multipartBoundary(contentType: string | null) {
  const match = contentType?.match(/^multipart\/form-data\s*;[\s\S]*?boundary=(?:"([^"]+)"|([^;\s]+))/i)
  const value = (match?.[1] ?? match?.[2])?.trim()
  if (!value || value.length > 200 || /[\r\n]/.test(value)) {
    throw new ApiError(
      415,
      "CINEMA_LIBRARY_MULTIPART_REQUIRED",
      "Upload must use multipart/form-data with a valid boundary.",
    )
  }
  return value
}

function parsePartHeaders(input: MultipartBytes) {
  const headers = new Map<string, string>()
  for (const line of decoder.decode(input).split("\r\n")) {
    const separator = line.indexOf(":")
    if (separator <= 0) continue
    headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim())
  }
  return headers
}

function unquoteDispositionValue(value: string) {
  return value.replace(/\\(["\\])/g, "$1")
}

function dispositionParameter(disposition: string, name: string) {
  const quoted = disposition.match(new RegExp(`(?:^|;)\\s*${name}="((?:\\\\.|[^"])*)"`, "i"))
  if (quoted?.[1] !== undefined) return unquoteDispositionValue(quoted[1])
  const plain = disposition.match(new RegExp(`(?:^|;)\\s*${name}=([^;]*)`, "i"))
  return plain?.[1]?.trim()
}

function safeUploadFilename(input: string) {
  const normalized = input.replace(/\\/g, "/")
  return normalized.slice(normalized.lastIndexOf("/") + 1).normalize("NFC")
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  chunk: MultipartBytes,
  position: number,
) {
  let offset = 0
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset, position + offset)
    if (result.bytesWritten <= 0) throw new Error("Could not write uploaded file.")
    offset += result.bytesWritten
  }
}

export interface ParsedCinemaAssetUpload {
  filename: string
  claimedMimeType: string
  sizeBytes: number
  checksum: string
  headBytes: MultipartBytes
  fields: Record<string, string>
}

export async function streamCinemaAssetMultipartUpload(
  request: Request,
  stagingPath: string,
): Promise<ParsedCinemaAssetUpload> {
  const boundary = multipartBoundary(request.headers.get("content-type"))
  if (!request.body) {
    throw new ApiError(400, "CINEMA_LIBRARY_UPLOAD_EMPTY", "Upload body is empty.")
  }

  const multipart = new StreamingMultipartReader(request.body.getReader())
  const firstBoundary = encoder.encode(`--${boundary}\r\n`)
  const partBoundary = encoder.encode(`\r\n--${boundary}`)
  const headerDelimiter = encoder.encode("\r\n\r\n")
  const preamble = await multipart.readUntil(firstBoundary, PREAMBLE_LIMIT)
  if (preamble.byteLength > 0 && decoder.decode(preamble).trim()) {
    await multipart.cancel()
    throw new ApiError(400, "CINEMA_LIBRARY_MULTIPART_INVALID", "Multipart preamble is not supported.")
  }

  const fields: Record<string, string> = {}
  let parsedFile: Omit<ParsedCinemaAssetUpload, "fields"> | undefined
  let fileHandle: Awaited<ReturnType<typeof open>> | undefined

  try {
    while (true) {
      const headerBytes = await multipart.readUntil(headerDelimiter, HEADER_LIMIT)
      const headers = parsePartHeaders(headerBytes)
      const disposition = headers.get("content-disposition") ?? ""
      if (!/^form-data(?:;|$)/i.test(disposition)) {
        throw new ApiError(400, "CINEMA_LIBRARY_MULTIPART_INVALID", "Multipart part is missing form-data disposition.")
      }

      const fieldName = dispositionParameter(disposition, "name")
      const rawFilename = dispositionParameter(disposition, "filename")
      if (!fieldName) {
        throw new ApiError(400, "CINEMA_LIBRARY_MULTIPART_INVALID", "Multipart part is missing a field name.")
      }

      if (rawFilename !== undefined) {
        if (fieldName !== "file" || parsedFile || fileHandle) {
          throw new ApiError(400, "CINEMA_LIBRARY_UPLOAD_FILE_INVALID", "Each request must contain exactly one 'file' part.")
        }

        const filename = safeUploadFilename(rawFilename)
        if (!filename) {
          throw new ApiError(400, "CINEMA_LIBRARY_UPLOAD_FILE_INVALID", "Uploaded file must have a filename.")
        }

        const hash = createHash("sha256")
        const headChunks: Uint8Array[] = []
        let headSize = 0
        let sizeBytes = 0
        fileHandle = await open(stagingPath, "wx")
        await multipart.readUntil(partBoundary, Number.MAX_SAFE_INTEGER, async (chunk) => {
          sizeBytes += chunk.byteLength
          if (sizeBytes > MAX_UPLOAD_BYTES) {
            throw new ApiError(413, "CINEMA_LIBRARY_UPLOAD_TOO_LARGE", "Uploaded file exceeds the 2 GB maximum.")
          }
          hash.update(chunk)
          if (headSize < HEAD_CAPTURE_BYTES) {
            const captured = chunk.slice(0, HEAD_CAPTURE_BYTES - headSize)
            headChunks.push(captured)
            headSize += captured.byteLength
          }
          await writeAll(fileHandle!, chunk, sizeBytes - chunk.byteLength)
        })
        await fileHandle.sync()
        await fileHandle.close()
        fileHandle = undefined

        if (sizeBytes === 0) {
          throw new ApiError(400, "CINEMA_LIBRARY_UPLOAD_EMPTY", "Uploaded file is empty.")
        }

        parsedFile = {
          filename,
          claimedMimeType: (headers.get("content-type") ?? "application/octet-stream").toLowerCase(),
          sizeBytes,
          checksum: hash.digest("hex"),
          headBytes: headChunks.reduce((result, chunk) => concatBytes(result, chunk), new Uint8Array(0)),
        }
      } else {
        const value = await multipart.readUntil(partBoundary, FIELD_LIMIT)
        fields[fieldName] = decoder.decode(value)
      }

      await multipart.ensure(2)
      const suffix = decoder.decode(multipart.take(2))
      if (suffix === "--") break
      if (suffix !== "\r\n") {
        throw new ApiError(400, "CINEMA_LIBRARY_MULTIPART_INVALID", "Multipart boundary has an invalid suffix.")
      }
    }
  } finally {
    if (fileHandle) await fileHandle.close().catch(() => undefined)
  }

  if (!parsedFile) {
    throw new ApiError(400, "CINEMA_LIBRARY_UPLOAD_FILE_REQUIRED", "Multipart body must include one 'file' part.")
  }

  return { ...parsedFile, fields }
}
