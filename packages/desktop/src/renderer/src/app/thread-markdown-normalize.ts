import type { WorkspaceFileLineRange } from "./types"

const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/
const WINDOWS_UNC_PATH_PATTERN = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/
const HASH_LINE_RANGE_PATTERN = /#L(\d+)(?:-L?(\d+))?$/i
const COLON_LINE_RANGE_PATTERN = /:(\d+)(?:-(\d+))?$/
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i
const FILE_LIKE_EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,16}$/

interface LooseLocalFileMarkdownLink {
  destination: string
  endIndex: number
}

export interface NormalizedMarkdownLocalFileLinkTarget {
  lineRange?: WorkspaceFileLineRange | null
  path: string
}

function normalizeLineRange(startLineNumber: number, endLineNumber = startLineNumber): WorkspaceFileLineRange | null {
  if (!Number.isSafeInteger(startLineNumber) || !Number.isSafeInteger(endLineNumber)) return null
  if (startLineNumber < 1 || endLineNumber < 1) return null
  return startLineNumber <= endLineNumber
    ? { startLineNumber, endLineNumber }
    : { startLineNumber: endLineNumber, endLineNumber: startLineNumber }
}

function splitLineRangeSuffix(value: string) {
  const trimmed = value.trim()
  const hashMatch = trimmed.match(HASH_LINE_RANGE_PATTERN)
  if (hashMatch?.index !== undefined) {
    const lineRange = normalizeLineRange(Number(hashMatch[1]), Number(hashMatch[2] ?? hashMatch[1]))
    if (lineRange) {
      return { lineRange, path: trimmed.slice(0, hashMatch.index) }
    }
  }

  const colonMatch = trimmed.match(COLON_LINE_RANGE_PATTERN)
  if (colonMatch?.index !== undefined) {
    const path = trimmed.slice(0, colonMatch.index)
    if (!/^[A-Za-z]:$/.test(path)) {
      const lineRange = normalizeLineRange(Number(colonMatch[1]), Number(colonMatch[2] ?? colonMatch[1]))
      if (lineRange) return { lineRange, path }
    }
  }

  return { lineRange: null, path: trimmed }
}

export function decodeUrlPathname(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeFileUrlPath(value: string) {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "file:") return null

    const decodedPath = decodeUrlPathname(parsed.pathname)
    const localPath = parsed.host
      ? `//${parsed.host}${decodedPath}`
      : decodedPath.replace(/^\/([A-Za-z]:\/)/, "$1")
    return localPath || null
  } catch {
    return null
  }
}

function isLocalAbsolutePath(value: string) {
  return WINDOWS_DRIVE_PATH_PATTERN.test(value) || WINDOWS_UNC_PATH_PATTERN.test(value) || value.startsWith("/")
}

function isRelativeLocalFilePath(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("?")) return false
  if (URI_SCHEME_PATTERN.test(trimmed) && !WINDOWS_DRIVE_PATH_PATTERN.test(trimmed)) return false
  if (/[\r\n<>]/.test(trimmed)) return false

  const pathWithoutDecoration = trimmed.split(/[?#]/, 1)[0] ?? trimmed
  const lastSegment = pathWithoutDecoration.split(/[\\/]/).filter(Boolean).pop() ?? pathWithoutDecoration
  return trimmed.startsWith(".") || /[\\/]/.test(trimmed) || FILE_LIKE_EXTENSION_PATTERN.test(lastSegment)
}

function isLocalFilePath(value: string) {
  return isLocalAbsolutePath(value) || isRelativeLocalFilePath(value)
}

function startsWithLooseLocalFileDestination(value: string) {
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^(?:\\\\|\/\/)[^\\/]/.test(value) ||
    value.startsWith("/") ||
    value.toLowerCase().startsWith("file://")
  )
}

export function normalizeLocalFileLinkTarget(value: string): NormalizedMarkdownLocalFileLinkTarget | null {
  const decodedValue = decodeUrlPathname(value)
  const { lineRange, path } = splitLineRangeSuffix(decodedValue)
  const fileUrlPath = normalizeFileUrlPath(path)
  const localPath = fileUrlPath ?? path

  if (!isLocalFilePath(localPath)) return null
  return { lineRange, path: localPath }
}

function findMarkdownLabelEnd(value: string, startIndex: number) {
  let depth = 0
  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index]
    if (char === "\\") {
      index += 1
      continue
    }
    if (char === "[") {
      depth += 1
      continue
    }
    if (char === "]") {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function findBacktickRunEnd(value: string, startIndex: number) {
  let runLength = 1
  while (value[startIndex + runLength] === "`") runLength += 1

  const marker = "`".repeat(runLength)
  const endIndex = value.indexOf(marker, startIndex + runLength)
  return endIndex === -1 ? value.length : endIndex + runLength
}

function findLooseLocalFileMarkdownLink(value: string, destinationStartIndex: number): LooseLocalFileMarkdownLink | null {
  const remaining = value.slice(destinationStartIndex)
  if (!startsWithLooseLocalFileDestination(remaining)) return null

  let parenthesisDepth = 0
  for (let index = destinationStartIndex; index < value.length; index += 1) {
    const char = value[index]
    if (char === "\n" || char === "\r" || char === "<" || char === ">") return null
    if (char === "(") {
      parenthesisDepth += 1
      continue
    }
    if (char !== ")") continue
    if (parenthesisDepth > 0) {
      parenthesisDepth -= 1
      continue
    }

    const destination = value.slice(destinationStartIndex, index).trim()
    if (!normalizeLocalFileLinkTarget(destination)) return null
    return { destination, endIndex: index }
  }

  return null
}

function escapeAngleLinkDestination(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/</g, "%3C").replace(/>/g, "%3E")
}

export function normalizeLooseLocalFileMarkdownLinks(value: string) {
  let normalized = ""
  let index = 0

  while (index < value.length) {
    const char = value[index]
    if (char === "`") {
      const endIndex = findBacktickRunEnd(value, index)
      normalized += value.slice(index, endIndex)
      index = endIndex
      continue
    }
    if (char === "\\") {
      normalized += value.slice(index, index + 2)
      index += 2
      continue
    }
    if (char === "[") {
      const labelEndIndex = findMarkdownLabelEnd(value, index)
      const destinationStartIndex = labelEndIndex + 2
      if (labelEndIndex !== -1 && value[labelEndIndex + 1] === "(" && value[destinationStartIndex] !== "<") {
        const link = findLooseLocalFileMarkdownLink(value, destinationStartIndex)
        if (link) {
          normalized += `${value.slice(index, destinationStartIndex)}<${escapeAngleLinkDestination(link.destination)}>)`
          index = link.endIndex + 1
          continue
        }
      }
    }

    normalized += char
    index += 1
  }

  return normalized
}
