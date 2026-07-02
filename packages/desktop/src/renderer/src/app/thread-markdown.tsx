import { memo, useMemo, type MouseEvent, type ReactNode } from "react"
import ReactMarkdown, { type Components, type UrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { toLocalImageProtocolUrl } from "../../../shared/local-image-protocol"
import type { WorkspaceFileLineRange } from "./types"

interface ThreadMarkdownProps {
  className?: string
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  resolveImageSrc?: (src: string) => string | null
  resolveLinkTarget?: (href: string) => MarkdownLinkTarget | null
  text: string
}

export interface MarkdownArtifactLinkTarget {
  href: string
  id: string
}

export interface MarkdownLocalFileLinkTarget {
  lineRange?: WorkspaceFileLineRange | null
  path: string
}

export type MarkdownLinkTarget =
  | {
      href: string
      kind: "external"
    }
  | {
      href: string
      kind: "artifact"
      target: MarkdownArtifactLinkTarget
    }
  | {
      href: string
      kind: "local-file"
      target: MarkdownLocalFileLinkTarget
    }

const remarkPlugins = [remarkGfm]
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
      return {
        lineRange,
        path: trimmed.slice(0, hashMatch.index),
      }
    }
  }

  const colonMatch = trimmed.match(COLON_LINE_RANGE_PATTERN)
  if (colonMatch?.index !== undefined) {
    const path = trimmed.slice(0, colonMatch.index)
    if (!/^[A-Za-z]:$/.test(path)) {
      const lineRange = normalizeLineRange(Number(colonMatch[1]), Number(colonMatch[2] ?? colonMatch[1]))
      if (lineRange) {
        return {
          lineRange,
          path,
        }
      }
    }
  }

  return {
    lineRange: null,
    path: trimmed,
  }
}

function decodeUrlPathname(value: string) {
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
  return (
    WINDOWS_DRIVE_PATH_PATTERN.test(value) ||
    WINDOWS_UNC_PATH_PATTERN.test(value) ||
    value.startsWith("/")
  )
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

function normalizeExternalUrl(value: string) {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null
    }

    return parsed.toString()
  } catch {
    return null
  }
}

function normalizeLocalFileLinkTarget(value: string): MarkdownLocalFileLinkTarget | null {
  const decodedValue = decodeUrlPathname(value)
  const { lineRange, path } = splitLineRangeSuffix(decodedValue)
  const fileUrlPath = normalizeFileUrlPath(path)
  const localPath = fileUrlPath ?? path

  if (!isLocalFilePath(localPath)) return null

  return {
    lineRange,
    path: localPath,
  }
}

function normalizeArtifactLinkTarget(value: string): MarkdownArtifactLinkTarget | null {
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== "agent:" || parsed.hostname !== "artifact") return null

    const id = decodeUrlPathname(parsed.pathname.replace(/^\/+/, "")).trim()
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return null

    return {
      href: `agent://artifact/${encodeURIComponent(id)}`,
      id,
    }
  } catch {
    return null
  }
}

export function normalizeMarkdownLinkTarget(value: string): MarkdownLinkTarget | null {
  const artifactTarget = normalizeArtifactLinkTarget(value)
  if (artifactTarget) {
    return {
      href: artifactTarget.href,
      kind: "artifact",
      target: artifactTarget,
    }
  }

  const externalUrl = normalizeExternalUrl(value)
  if (externalUrl) {
    return {
      href: externalUrl,
      kind: "external",
    }
  }

  const localFileTarget = normalizeLocalFileLinkTarget(value)
  if (localFileTarget) {
    return {
      href: value.trim(),
      kind: "local-file",
      target: localFileTarget,
    }
  }

  return null
}

function normalizeMarkdownImageSrc(value: string) {
  const externalUrl = normalizeExternalUrl(value)
  if (externalUrl) return externalUrl

  return toLocalImageProtocolUrl(value)
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
    return {
      destination,
      endIndex: index,
    }
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

export function openExternalThreadLink(href: string) {
  const openExternalUrl = window.desktop?.openExternalUrl
  if (openExternalUrl) {
    void openExternalUrl({ url: href }).catch((error) => {
      console.error("[desktop] Failed to open external URL.", error)
      window.open(href, "_blank", "noopener,noreferrer")
    })
    return
  }

  window.open(href, "_blank", "noopener,noreferrer")
}

function handleExternalLinkClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (event.defaultPrevented) return
  event.preventDefault()
  openExternalThreadLink(href)
}

function MarkdownLink({
  children,
  href,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  resolveLinkTarget,
}: {
  children?: ReactNode
  href?: string
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  resolveLinkTarget?: (href: string) => MarkdownLinkTarget | null
}) {
  const linkTarget = href ? resolveLinkTarget?.(href) ?? normalizeMarkdownLinkTarget(href) : null
  if (!linkTarget) return <>{children}</>

  if (linkTarget.kind === "artifact") {
    if (!onArtifactLinkOpen) return <>{children}</>

    return (
      <a
        className="thread-inline-link"
        href={linkTarget.href}
        onClick={(event) => {
          event.preventDefault()
          onArtifactLinkOpen(linkTarget.target)
        }}
        title={linkTarget.href}
      >
        {children}
      </a>
    )
  }

  if (linkTarget.kind === "local-file") {
    if (!onLocalFileLinkOpen) return <>{children}</>

    return (
      <a
        className="thread-inline-link"
        href={linkTarget.href}
        onClick={(event) => {
          event.preventDefault()
          onLocalFileLinkOpen(linkTarget.target)
        }}
        title={linkTarget.target.path}
      >
        {children}
      </a>
    )
  }

  return (
    <a
      className="thread-inline-link"
      href={linkTarget.href}
      onClick={(event) => handleExternalLinkClick(event, linkTarget.href)}
      rel="noreferrer noopener"
      target="_blank"
    >
      {children}
    </a>
  )
}

function MarkdownImage({ alt, src }: { alt?: string; src?: string }) {
  if (!src) {
    return alt ? <span className="thread-markdown-image-alt">{alt}</span> : null
  }

  return <img className="thread-markdown-image" src={src} alt={alt ?? ""} loading="lazy" decoding="async" />
}

function normalizeMarkdownCodeLanguage(className?: string) {
  if (!className) return null

  const languageClass = className.split(/\s+/).find((value) => value.startsWith("language-"))
  const language = languageClass?.slice("language-".length).trim()
  return language || null
}

const MarkdownCode: NonNullable<Components["code"]> = ({ children, className, node: _node, ...props }) => {
  const language = normalizeMarkdownCodeLanguage(className)

  return (
    <code {...props} className={className} data-language={language ?? undefined}>
      {children}
    </code>
  )
}

const MarkdownTable: NonNullable<Components["table"]> = ({ children, node: _node, ...props }) => (
  <div className="thread-markdown-table-scroll">
    <table {...props}>{children}</table>
  </div>
)

function createMarkdownUrlTransform({
  resolveImageSrc,
  resolveLinkTarget,
}: Pick<ThreadMarkdownProps, "resolveImageSrc" | "resolveLinkTarget">): UrlTransform {
  return (url, key) => {
    if (key === "href") return (resolveLinkTarget?.(url) ?? normalizeMarkdownLinkTarget(url))?.href ?? ""
    if (key === "src") return resolveImageSrc?.(url) ?? normalizeMarkdownImageSrc(url) ?? ""
    return ""
  }
}

export const ThreadMarkdown = memo(function ThreadMarkdown({
  className,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  resolveImageSrc,
  resolveLinkTarget,
  text,
}: ThreadMarkdownProps) {
  const markdownText = useMemo(
    () => normalizeLooseLocalFileMarkdownLinks(text),
    [text],
  )
  const transformMarkdownUrl = useMemo(
    () => createMarkdownUrlTransform({ resolveImageSrc, resolveLinkTarget }),
    [resolveImageSrc, resolveLinkTarget],
  )
  const components = useMemo<Components>(() => ({
    a: (props) => (
      <MarkdownLink
        {...props}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
        resolveLinkTarget={resolveLinkTarget}
      />
    ),
    code: MarkdownCode,
    img: MarkdownImage,
    table: MarkdownTable,
  }), [onArtifactLinkOpen, onLocalFileLinkOpen, resolveLinkTarget])

  return (
    <div className={className}>
      <ReactMarkdown
        components={components}
        remarkPlugins={remarkPlugins}
        skipHtml
        urlTransform={transformMarkdownUrl}
      >
        {markdownText}
      </ReactMarkdown>
    </div>
  )
})
