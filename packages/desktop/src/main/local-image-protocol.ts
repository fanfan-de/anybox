import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { fileURLToPath } from "node:url"
import {
  LOCAL_IMAGE_PROTOCOL,
  LOCAL_VIDEO_PROTOCOL,
  readLocalImageProtocolSource,
  readLocalVideoProtocolSource,
} from "../shared/local-image-protocol"

export const LOCAL_IMAGE_MAX_BYTES = 25 * 1024 * 1024
export const LOCAL_VIDEO_MAX_BYTES = 1024 * 1024 * 1024

const rasterImageMimeTypes = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
])

const videoMimeTypes = new Map([
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".mp4", "video/mp4"],
  [".ogg", "video/ogg"],
  [".ogv", "video/ogg"],
  [".webm", "video/webm"],
])

export type LocalImageProtocolResult =
  | {
      ok: true
      filePath: string
      mimeType: string
      size: number
    }
  | {
      ok: false
      status: number
      error: string
    }

export type LocalVideoProtocolResult = LocalImageProtocolResult

interface LocalImageProtocolOptions {
  maxBytes?: number
}

interface LocalImageProtocolRegistrar {
  registerSchemesAsPrivileged(schemes: Array<{
    scheme: string
    privileges: {
      standard: boolean
      secure: boolean
      supportFetchAPI: boolean
    }
  }>): void
  handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void
}

function localImageError(status: number, error: string): LocalImageProtocolResult {
  return { ok: false, status, error }
}

function resolveLocalImagePath(source: string) {
  const trimmedSource = source.trim()
  if (!trimmedSource) return null

  if (trimmedSource.toLowerCase().startsWith("file://")) {
    try {
      return path.resolve(fileURLToPath(trimmedSource))
    } catch {
      return null
    }
  }

  if (!path.isAbsolute(trimmedSource)) return null
  return path.resolve(trimmedSource)
}

export function getLocalImageMimeType(filePath: string) {
  return rasterImageMimeTypes.get(path.extname(filePath).toLowerCase()) ?? null
}

export function getLocalVideoMimeType(filePath: string) {
  return videoMimeTypes.get(path.extname(filePath).toLowerCase()) ?? null
}

async function resolveLocalFileProtocolRequest(input: {
  label: "image" | "video"
  maxBytes: number
  mimeTypeForPath: (filePath: string) => string | null
  requestUrl: string
  sourceForUrl: (url: string) => string | null
  unsupportedMessage: string
}): Promise<LocalImageProtocolResult> {
  const source = input.sourceForUrl(input.requestUrl)
  if (!source) {
    return localImageError(400, `Missing or invalid local ${input.label} source.`)
  }

  const filePath = resolveLocalImagePath(source)
  if (!filePath) {
    return localImageError(400, `Local ${input.label} source must be an absolute file path or file URL.`)
  }

  const mimeType = input.mimeTypeForPath(filePath)
  if (!mimeType) {
    return localImageError(415, input.unsupportedMessage)
  }

  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    return localImageError(404, `Local ${input.label} file was not found.`)
  }

  if (!fileStat.isFile()) {
    return localImageError(400, `Local ${input.label} source must be a file.`)
  }

  if (fileStat.size > input.maxBytes) {
    return localImageError(413, `Local ${input.label} file is too large.`)
  }

  return {
    ok: true,
    filePath,
    mimeType,
    size: fileStat.size,
  }
}

export async function resolveLocalImageProtocolRequest(
  requestUrl: string,
  options: LocalImageProtocolOptions = {},
): Promise<LocalImageProtocolResult> {
  return resolveLocalFileProtocolRequest({
    label: "image",
    maxBytes: options.maxBytes ?? LOCAL_IMAGE_MAX_BYTES,
    mimeTypeForPath: getLocalImageMimeType,
    requestUrl,
    sourceForUrl: readLocalImageProtocolSource,
    unsupportedMessage: "Local image type is not supported.",
  })
}

export async function resolveLocalVideoProtocolRequest(
  requestUrl: string,
  options: LocalImageProtocolOptions = {},
): Promise<LocalVideoProtocolResult> {
  return resolveLocalFileProtocolRequest({
    label: "video",
    maxBytes: options.maxBytes ?? LOCAL_VIDEO_MAX_BYTES,
    mimeTypeForPath: getLocalVideoMimeType,
    requestUrl,
    sourceForUrl: readLocalVideoProtocolSource,
    unsupportedMessage: "Local video type is not supported.",
  })
}

function createStreamBody(filePath: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(filePath, { start, end })) as BodyInit
}

function parseByteRange(rangeHeader: string | null, size: number) {
  if (!rangeHeader) return null

  const rangeMatch = rangeHeader.match(/^bytes=(\d*)-(\d*)$/)
  if (!rangeMatch) return "invalid" as const

  const [, rawStart, rawEnd] = rangeMatch
  if (!rawStart && !rawEnd) return "invalid" as const

  if (!rawStart) {
    const suffixLength = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "invalid" as const
    const start = Math.max(0, size - suffixLength)
    return { start, end: size - 1 }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return "invalid" as const
  if (start < 0 || end < start || start >= size) return "invalid" as const
  return { start, end: Math.min(end, size - 1) }
}

export async function handleLocalImageProtocolRequest(request: Request) {
  const result = await resolveLocalImageProtocolRequest(request.url)
  if (!result.ok) {
    return new Response(result.error, {
      status: result.status,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }

  const image = await readFile(result.filePath)
  return new Response(image, {
    headers: {
      "cache-control": "no-store",
      "content-length": String(result.size),
      "content-type": result.mimeType,
    },
  })
}

export async function handleLocalVideoProtocolRequest(request: Request) {
  const result = await resolveLocalVideoProtocolRequest(request.url)
  if (!result.ok) {
    return new Response(result.error, {
      status: result.status,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }

  const range = parseByteRange(request.headers.get("range"), result.size)
  if (range === "invalid") {
    return new Response("Requested range is not satisfiable.", {
      status: 416,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes */${String(result.size)}`,
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }

  const commonHeaders = {
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-type": result.mimeType,
  }

  if (range) {
    const contentLength = range.end - range.start + 1
    return new Response(createStreamBody(result.filePath, range.start, range.end), {
      status: 206,
      headers: {
        ...commonHeaders,
        "content-length": String(contentLength),
        "content-range": `bytes ${String(range.start)}-${String(range.end)}/${String(result.size)}`,
      },
    })
  }

  return new Response(createStreamBody(result.filePath), {
    headers: {
      ...commonHeaders,
      "content-length": String(result.size),
    },
  })
}

export function registerLocalImageProtocolScheme(protocolRegistrar: Pick<LocalImageProtocolRegistrar, "registerSchemesAsPrivileged">) {
  protocolRegistrar.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_IMAGE_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
    {
      scheme: LOCAL_VIDEO_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ])
}

export function registerLocalImageProtocolHandler(protocolRegistrar: Pick<LocalImageProtocolRegistrar, "handle">) {
  protocolRegistrar.handle(LOCAL_IMAGE_PROTOCOL, handleLocalImageProtocolRequest)
  protocolRegistrar.handle(LOCAL_VIDEO_PROTOCOL, handleLocalVideoProtocolRequest)
}
