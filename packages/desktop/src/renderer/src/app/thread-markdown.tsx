import { memo, useMemo, type ReactNode } from "react"
import ReactMarkdown, { type Components, type UrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import { toLocalImageProtocolUrl } from "../../../shared/local-image-protocol"
import {
  decodeUrlPathname,
  normalizeLocalFileLinkTarget,
  normalizeLooseLocalFileMarkdownLinks,
} from "./thread-markdown-normalize"
import { ThreadExternalLink } from "./thread-link-routing"
import type { WorkspaceFileLineRange } from "./types"

export { normalizeLooseLocalFileMarkdownLinks } from "./thread-markdown-normalize"
export { openExternalThreadLink } from "./thread-link-routing"

export interface ThreadMarkdownProps {
  className?: string
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  resolveImageSrc?: (src: string) => string | null
  resolveLinkTarget?: (href: string) => MarkdownLinkTarget | null
  text: string
}

export type ThreadMarkdownRenderContext = Pick<
  ThreadMarkdownProps,
  "onArtifactLinkOpen" | "onLocalFileLinkOpen" | "resolveImageSrc" | "resolveLinkTarget"
>

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

export function resolveWorkspaceMarkdownImageSrc(value: string, workspaceDirectory?: string | null) {
  const normalizedSource = normalizeMarkdownImageSrc(value)
  if (normalizedSource || !workspaceDirectory?.trim()) return normalizedSource

  const source = value.trim()
  if (!source || /^[a-z][a-z0-9+.-]*:/i.test(source)) return null

  let decodedSource: string
  try {
    decodedSource = decodeURIComponent(source)
  } catch {
    return null
  }

  const relativeSegments: string[] = []
  for (const segment of decodedSource.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (relativeSegments.length === 0) return null
      relativeSegments.pop()
      continue
    }
    relativeSegments.push(segment)
  }
  if (relativeSegments.length === 0) return null

  const workspaceRoot = workspaceDirectory.trim().replace(/[\\/]+$/, "")
  const separator = workspaceRoot.includes("\\") ? "\\" : "/"
  return toLocalImageProtocolUrl(`${workspaceRoot}${separator}${relativeSegments.join(separator)}`)
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
    <ThreadExternalLink className="thread-inline-link" href={linkTarget.href}>
      {children}
    </ThreadExternalLink>
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

export function createThreadMarkdownComponents({
  imageSourcesAreResolved = false,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  resolveImageSrc,
  resolveLinkTarget,
}: ThreadMarkdownRenderContext & {
  imageSourcesAreResolved?: boolean
}): Components {
  return {
    a: (props) => (
      <MarkdownLink
        {...props}
        onArtifactLinkOpen={onArtifactLinkOpen}
        onLocalFileLinkOpen={onLocalFileLinkOpen}
        resolveLinkTarget={resolveLinkTarget}
      />
    ),
    code: MarkdownCode,
    img: ({ alt, node: _node, src }) => {
      const source = typeof src === "string" ? src : undefined
      const resolvedSource = source
        ? imageSourcesAreResolved
          ? source
          : resolveImageSrc?.(source) ?? normalizeMarkdownImageSrc(source)
        : undefined

      return <MarkdownImage alt={alt} src={resolvedSource ?? undefined} />
    },
    table: MarkdownTable,
  }
}

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
  const components = useMemo<Components>(() => createThreadMarkdownComponents({
    imageSourcesAreResolved: true,
    onArtifactLinkOpen,
    onLocalFileLinkOpen,
    resolveImageSrc,
    resolveLinkTarget,
  }), [onArtifactLinkOpen, onLocalFileLinkOpen, resolveImageSrc, resolveLinkTarget])

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
