export const LOCAL_IMAGE_PROTOCOL = "anybox-local-image"
export const LOCAL_IMAGE_PROTOCOL_HOST = "image"
export const LOCAL_VIDEO_PROTOCOL = "anybox-local-video"
export const LOCAL_VIDEO_PROTOCOL_HOST = "video"

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:[\\/]/i
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\/]+[\\/][^\\/]+[\\/]/
const POSIX_ABSOLUTE_PATH_PATTERN = /^\//

function isLocalImageSourceValue(value: string) {
  const source = value.trim()
  if (!source) return false

  if (source.toLowerCase().startsWith("file://")) return true
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(source)) return true
  if (WINDOWS_UNC_PATH_PATTERN.test(source)) return true
  return POSIX_ABSOLUTE_PATH_PATTERN.test(source)
}

export function normalizeLocalImageSource(value: string) {
  const source = value.trim()
  if (!source) return null
  if (source.toLowerCase().startsWith("file://")) return source

  try {
    const decodedSource = decodeURIComponent(source)
    if (isLocalImageSourceValue(decodedSource)) return decodedSource
  } catch {
    // Keep checking the literal source so valid paths containing a bare percent sign still work.
  }

  return isLocalImageSourceValue(source) ? source : null
}

export function isLocalImageSource(value: string) {
  return normalizeLocalImageSource(value) !== null
}

export function toLocalImageProtocolUrl(source: string) {
  const normalizedSource = normalizeLocalImageSource(source)
  if (!normalizedSource) return null

  return `${LOCAL_IMAGE_PROTOCOL}://${LOCAL_IMAGE_PROTOCOL_HOST}?source=${encodeURIComponent(normalizedSource)}`
}

export function toLocalVideoProtocolUrl(source: string) {
  const normalizedSource = normalizeLocalImageSource(source)
  if (!normalizedSource) return null

  return `${LOCAL_VIDEO_PROTOCOL}://${LOCAL_VIDEO_PROTOCOL_HOST}?source=${encodeURIComponent(normalizedSource)}`
}

function readLocalProtocolSource(url: string, protocol: string, host: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${protocol}:`) return null
    if (parsed.hostname !== host) return null

    const source = parsed.searchParams.get("source")?.trim()
    return source || null
  } catch {
    return null
  }
}

export function readLocalImageProtocolSource(url: string) {
  return readLocalProtocolSource(url, LOCAL_IMAGE_PROTOCOL, LOCAL_IMAGE_PROTOCOL_HOST)
}

export function readLocalVideoProtocolSource(url: string) {
  return readLocalProtocolSource(url, LOCAL_VIDEO_PROTOCOL, LOCAL_VIDEO_PROTOCOL_HOST)
}
