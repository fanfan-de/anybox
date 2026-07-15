import DOMPurify, { type Config } from "dompurify"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import {
  normalizeMarkdownLinkTarget,
  type MarkdownArtifactLinkTarget,
  type MarkdownLocalFileLinkTarget,
} from "./thread-markdown"
import {
  openExternalThreadLink,
  ThreadFrameLinkContextMenu,
  useThreadLinkRouting,
  type LinkContextMenuState,
} from "./thread-link-routing"
import { SIDEBAR_RESIZE_END_EVENT } from "./sidebar-resize-events"

interface ThreadHtmlProps {
  className?: string
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  text: string
}

const MIN_FRAME_HEIGHT = 320
const MAX_FRAME_HEIGHT = 720

function isSidebarResizeInProgress() {
  return typeof document !== "undefined" && document.body.classList.contains("is-resizing-sidebar")
}

const sanitizeConfig = {
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  ALLOWED_ATTR: ["alt", "class", "colspan", "href", "rowspan", "src", "title"],
  ALLOWED_TAGS: [
    "a",
    "article",
    "aside",
    "blockquote",
    "body",
    "br",
    "code",
    "div",
    "em",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "img",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "span",
    "strong",
    "style",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?):|agent:\/\/artifact\/|file:\/\/|[A-Za-z]:[\\/]|\/|\\\\|\/\/|\.{1,2}[\\/]|[^:/?#\s<>]+[\\/]|[^:/?#\s<>]+\.[A-Za-z0-9]{1,16}(?:[?#]|$))/i,
  FORBID_ATTR: ["style"],
  FORBID_TAGS: ["iframe", "script"],
  WHOLE_DOCUMENT: true,
} satisfies Config

let linkSanitizerHookRegistered = false

function ensureThreadHtmlSanitizerHooks() {
  if (linkSanitizerHookRegistered) return
  linkSanitizerHookRegistered = true

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName.toLowerCase() !== "a") return

    const element = node as Element
    const href = element.getAttribute("href")
    if (!href) return

    const linkTarget = normalizeMarkdownLinkTarget(href)
    if (!linkTarget) {
      element.removeAttribute("href")
      return
    }

    element.setAttribute("href", linkTarget.href)
  })
}

function sanitizeStyleBlocks(html: string) {
  return html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_match, attributes: string, css: string) => {
    const safeCss = css
      .replace(/@import\b[^;]*(?:;|$)/gi, "")
      .replace(/url\s*\([^)]*\)/gi, "none")
    return `<style${attributes}>${safeCss}</style>`
  })
}

function injectFrameDefaults(html: string) {
  const defaultHead = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<style>",
    "html{box-sizing:border-box;background:#fff;color:#111827;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}",
    "*,*::before,*::after{box-sizing:inherit;}",
    "body{margin:0;min-width:0;}",
    "a{color:#2563eb;}",
    "img{max-width:100%;height:auto;}",
    "pre{overflow:auto;}",
    "</style>",
  ].join("")

  if (/<head(?:\s|>)/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${defaultHead}`)
  }

  if (/<html(?:\s|>)/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${defaultHead}</head>`)
  }

  return `<!doctype html><html><head>${defaultHead}</head><body>${html}</body></html>`
}

function sanitizeThreadHtml(text: string) {
  ensureThreadHtmlSanitizerHooks()
  const sanitized = DOMPurify.sanitize(text, sanitizeConfig)
  return injectFrameDefaults(sanitizeStyleBlocks(typeof sanitized === "string" ? sanitized : ""))
}

export const ThreadHtml = memo(function ThreadHtml({
  className,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  text,
}: ThreadHtmlProps) {
  const threadLinkRouting = useThreadLinkRouting()
  const threadLinkRoutingRef = useRef(threadLinkRouting)
  threadLinkRoutingRef.current = threadLinkRouting
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const cleanupFrameRef = useRef<(() => void) | null>(null)
  const pendingResizeHeightUpdateRef = useRef(false)
  const [frameHeight, setFrameHeight] = useState(MIN_FRAME_HEIGHT)
  const [linkContextMenu, setLinkContextMenu] = useState<LinkContextMenuState | null>(null)
  const html = useMemo(() => sanitizeThreadHtml(text), [text])

  useEffect(() => {
    return () => {
      cleanupFrameRef.current?.()
      cleanupFrameRef.current = null
    }
  }, [])

  function handleFrameLoad() {
    cleanupFrameRef.current?.()
    cleanupFrameRef.current = null

    const frame = frameRef.current
    const frameDocument = frame?.contentDocument
    if (!frame || !frameDocument) return
    const loadedFrame = frame
    const loadedDocument: Document = frameDocument

    function updateHeight() {
      if (isSidebarResizeInProgress()) {
        pendingResizeHeightUpdateRef.current = true
        return
      }

      pendingResizeHeightUpdateRef.current = false
      const contentHeight = Math.max(
        loadedDocument.documentElement?.scrollHeight ?? 0,
        loadedDocument.body?.scrollHeight ?? 0,
        MIN_FRAME_HEIGHT,
      )
      const nextFrameHeight = Math.min(Math.max(contentHeight, MIN_FRAME_HEIGHT), MAX_FRAME_HEIGHT)
      setFrameHeight((currentHeight) => (currentHeight === nextFrameHeight ? currentHeight : nextFrameHeight))
    }

    function handleSidebarResizeEnd() {
      if (!pendingResizeHeightUpdateRef.current) return
      updateHeight()
    }

    function handleClick(event: globalThis.MouseEvent) {
      const target = event.target as { closest?: (selector: string) => Element | null } | null
      const anchor = target?.closest?.("a[href]")
      if (!anchor) return

      event.preventDefault()

      const linkTarget = normalizeMarkdownLinkTarget(anchor.getAttribute("href") ?? "")
      if (!linkTarget) return

      if (linkTarget.kind === "artifact") {
        onArtifactLinkOpen?.(linkTarget.target)
        return
      }

      if (linkTarget.kind === "local-file") {
        onLocalFileLinkOpen?.(linkTarget.target)
        return
      }

      if (threadLinkRoutingRef.current) threadLinkRoutingRef.current.openInAnybox(linkTarget.href)
      else openExternalThreadLink(linkTarget.href)
    }

    function handleContextMenu(event: globalThis.MouseEvent) {
      const target = event.target as { closest?: (selector: string) => Element | null } | null
      const anchor = target?.closest?.("a[href]")
      if (!anchor) return

      const linkTarget = normalizeMarkdownLinkTarget(anchor.getAttribute("href") ?? "")
      if (!linkTarget || linkTarget.kind !== "external") return

      event.preventDefault()
      const frameRect = loadedFrame.getBoundingClientRect()
      setLinkContextMenu({
        href: linkTarget.href,
        x: frameRect.left + event.clientX,
        y: frameRect.top + event.clientY,
      })
    }

    loadedDocument.addEventListener("click", handleClick)
    loadedDocument.addEventListener("contextmenu", handleContextMenu)
    window.addEventListener(SIDEBAR_RESIZE_END_EVENT, handleSidebarResizeEnd)
    const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(updateHeight) : null
    if (resizeObserver) {
      resizeObserver.observe(loadedDocument.documentElement)
      if (loadedDocument.body) resizeObserver.observe(loadedDocument.body)
    }
    updateHeight()

    cleanupFrameRef.current = () => {
      loadedDocument.removeEventListener("click", handleClick)
      loadedDocument.removeEventListener("contextmenu", handleContextMenu)
      window.removeEventListener(SIDEBAR_RESIZE_END_EVENT, handleSidebarResizeEnd)
      resizeObserver?.disconnect()
    }
  }

  return (
    <>
      <div className={className}>
        <iframe
          ref={frameRef}
          className="thread-html-frame"
          sandbox="allow-same-origin"
          srcDoc={html}
          style={{ height: frameHeight }}
          title="Assistant HTML response"
          onLoad={handleFrameLoad}
        />
      </div>
      <ThreadFrameLinkContextMenu menu={linkContextMenu} onClose={() => setLinkContextMenu(null)} />
    </>
  )
})
