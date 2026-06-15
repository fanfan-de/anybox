import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { DesktopLocalPreviewService } from "../../../../shared/desktop-ipc-contract"
import { CodeBlockPreview, inferCodeLanguage } from "../code-highlight"
import type { CodeHighlightTheme } from "../code-theme"
import { BackIcon, ForwardIcon, OpenExternalIcon, PreviewIcon, ResetIcon, ScreenshotIcon } from "../icons"
import { useToast } from "../toast"
import type { PreviewInteractionCommitInput, PreviewInteractionPluginID, ResolvedPreviewTarget, WorkspacePreviewState } from "../types"
import { getPreviewFailure } from "./failures"
import { PreviewInteractionHost, PreviewInteractionToolbar } from "./interactions/PreviewInteractionHost"
import { getPreviewInteractionPlugins } from "./interactions/registry"

const PREVIEW_QUICK_TARGETS = ["http://localhost:3000", "http://localhost:5173", "http://localhost:8080"] as const
const TEXT_RENDERERS = new Set(["markdown-preview", "json-viewer", "table-preview", "code-viewer"])

interface UnifiedPreviewPanelProps {
  codeTheme: CodeHighlightTheme
  state: WorkspacePreviewState
  workspaceRoot?: string | null
  onDraftUrlChange: (value: string) => void
  onBack: () => void
  onForward: () => void
  onOpen: () => void
  onOpenExternal: () => void | Promise<void>
  onOpenUrl: (url: string) => void
  onReload: () => void
  onActiveInteractionChange: (pluginID: PreviewInteractionPluginID | null) => void
  onCommitInteraction: (input: PreviewInteractionCommitInput) => void
}

interface WebviewElement extends HTMLElement {
  reload?: () => void
  send?: (channel: string, payload?: unknown) => void
}

type WebviewFailLoadEvent = Event & {
  errorCode?: number
  errorDescription?: string
  isMainFrame?: boolean
}

type FrameLoadError = ReturnType<typeof getPreviewFailure>

type TextPreviewState =
  | { status: "idle"; content: ""; error: null; path: null }
  | { status: "loading"; content: ""; error: null; path: string }
  | { status: "ready"; content: string; error: null; path: string }
  | { status: "error"; content: ""; error: string; path: string }

function getTargetPath(target: ResolvedPreviewTarget | null) {
  return target?.entry ?? target?.path ?? null
}

function parseCsvLine(line: string) {
  const cells: string[] = []
  let current = ""
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === "\"") {
      if (quoted && line[index + 1] === "\"") {
        current += "\""
        index += 1
        continue
      }
      quoted = !quoted
      continue
    }
    if (character === "," && !quoted) {
      cells.push(current)
      current = ""
      continue
    }
    current += character
  }

  cells.push(current)
  return cells
}

function parseCsvRows(content: string) {
  return content
    .split(/\r?\n/)
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
    .slice(0, 201)
    .map(parseCsvLine)
}

function renderTextError(error: string) {
  return (
    <div className="preview-canvas-state preview-error-state unified-preview-message" role="alert">
      <div className="preview-error-icon">!</div>
      <h3>Preview text could not be read</h3>
      <p>{error}</p>
    </div>
  )
}

function JsonPreview({ codeTheme, content }: { codeTheme: CodeHighlightTheme; content: string }) {
  let formatted = content
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2)
  } catch {
    // Invalid JSON still renders as read-only source.
  }

  return <CodeBlockPreview className="unified-preview-code" content={formatted} language="json" theme={codeTheme} />
}

function TablePreview({ codeTheme, content }: { codeTheme: CodeHighlightTheme; content: string }) {
  const rows = parseCsvRows(content)
  const [header, ...bodyRows] = rows
  if (!header) return <CodeBlockPreview className="unified-preview-code" content={content} language="csv" theme={codeTheme} />

  return (
    <div className="unified-preview-table-scroll" role="region" aria-label="CSV preview">
      <table className="unified-preview-table">
        <thead>
          <tr>
            {header.map((cell, index) => <th key={`head-${index}`}>{cell || "\u00a0"}</th>)}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {header.map((_, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`}>{row[cellIndex] || "\u00a0"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 200 ? <p className="preview-helper-copy">Showing the first 200 rows.</p> : null}
    </div>
  )
}

function TextPreviewContent({
  codeTheme,
  content,
  target,
}: {
  codeTheme: CodeHighlightTheme
  content: string
  target: ResolvedPreviewTarget
}) {
  const renderer = target.renderer
  if (renderer === "markdown-preview") {
    return (
      <div className="unified-preview-markdown thread-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
          {content}
        </ReactMarkdown>
      </div>
    )
  }
  if (renderer === "json-viewer") return <JsonPreview codeTheme={codeTheme} content={content} />
  if (renderer === "table-preview") return <TablePreview codeTheme={codeTheme} content={content} />
  return (
    <CodeBlockPreview
      className="unified-preview-code"
      content={content}
      language={inferCodeLanguage({
        mime: target.mime,
        path: getTargetPath(target) ?? target.title,
        renderer: target.renderer,
      })}
      theme={codeTheme}
    />
  )
}

function shouldRenderTargetInWebview(target: ResolvedPreviewTarget | null) {
  return target?.renderer === "url-webview" || target?.renderer === "html-preview"
}

function EmptyPreviewState({
  localPreviewServices,
  localServiceStatus,
  onOpenUrl,
  onScanLocalServices,
}: {
  localPreviewServices: DesktopLocalPreviewService[]
  localServiceStatus: "idle" | "scanning" | "ready" | "error"
  onOpenUrl: (url: string) => void
  onScanLocalServices: () => void
}) {
  return (
    <div className="preview-canvas-state preview-empty-state unified-preview-empty">
      <PreviewIcon />
      <h3>Open a preview target</h3>
      <p>Enter a URL, <code>agent://artifact/id</code>, or a file path in the current workspace.</p>
      <div className="unified-preview-quick-list" aria-label="Quick preview targets">
        {PREVIEW_QUICK_TARGETS.map((url) => (
          <button key={url} type="button" className="secondary-button" onClick={() => onOpenUrl(url)}>
            {url}
          </button>
        ))}
      </div>
      <div className="unified-preview-services">
        <button type="button" className="secondary-button" onClick={onScanLocalServices}>
          {localServiceStatus === "scanning" ? "Scanning..." : "Detect local servers"}
        </button>
        {localPreviewServices.length > 0 ? (
          <div className="unified-preview-service-list">
            {localPreviewServices.map((service) => (
              <button
                key={service.url}
                type="button"
                className="unified-preview-service-row"
                onClick={() => onOpenUrl(service.url)}
              >
                <span>{service.url}</span>
                <span>{service.statusCode}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function UnifiedPreviewPanel({
  codeTheme,
  state,
  workspaceRoot,
  onBack,
  onDraftUrlChange,
  onForward,
  onOpen,
  onOpenExternal,
  onOpenUrl,
  onReload,
  onActiveInteractionChange,
  onCommitInteraction,
}: UnifiedPreviewPanelProps) {
  const toast = useToast()
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const webviewRef = useRef<WebviewElement | null>(null)
  const previewStackRef = useRef<HTMLDivElement | null>(null)
  const textRequestIDRef = useRef(0)
  const localServiceRequestIDRef = useRef(0)
  const localServiceAutoScanRef = useRef(false)
  const previewGuestPreloadPath = window.desktop?.previewGuestPreloadPath
  const canUseWebview = useMemo(
    () =>
      /Electron/i.test(globalThis.navigator?.userAgent ?? "") &&
      typeof previewGuestPreloadPath === "string" &&
      previewGuestPreloadPath.startsWith("file:"),
    [previewGuestPreloadPath],
  )
  const [forceIframeFallback, setForceIframeFallback] = useState(false)
  const [frameIsLoading, setFrameIsLoading] = useState(false)
  const [frameLoadError, setFrameLoadError] = useState<FrameLoadError | null>(null)
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false)
  const [webviewReady, setWebviewReady] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [textPreview, setTextPreview] = useState<TextPreviewState>({
    status: "idle",
    content: "",
    error: null,
    path: null,
  })
  const [localPreviewServices, setLocalPreviewServices] = useState<DesktopLocalPreviewService[]>([])
  const [localServiceStatus, setLocalServiceStatus] = useState<"idle" | "scanning" | "ready" | "error">("idle")
  const target = state.resolvedTarget
  const draftValue = state.draftTarget || state.draftUrl
  const targetPath = getTargetPath(target)
  const shouldRenderText = Boolean(target && TEXT_RENDERERS.has(target.renderer) && target.textReadable && targetPath)
  const shouldUseWebview = shouldRenderTargetInWebview(target) && canUseWebview && !forceIframeFallback
  const canOpenExternal = Boolean(target?.externalOpenTarget || state.committedUrl || draftValue.trim())
  const interactionPlugins = useMemo(() => getPreviewInteractionPlugins(target), [target])
  const navigationHistory = Array.isArray(state.navigationHistory) ? state.navigationHistory : []
  const navigationIndex = Number.isInteger(state.navigationIndex) ? state.navigationIndex : -1
  const canNavigateBack = navigationIndex > 0 && navigationHistory.length > 1
  const canNavigateForward = navigationIndex >= 0 && navigationIndex < navigationHistory.length - 1
  const canCaptureScreenshot = Boolean(window.desktop?.capturePreviewScreenshot && target)

  async function scanLocalPreviewServices() {
    const detectLocalPreviewServices = window.desktop?.detectLocalPreviewServices
    const requestID = localServiceRequestIDRef.current + 1
    localServiceRequestIDRef.current = requestID

    if (!detectLocalPreviewServices) {
      setLocalPreviewServices([])
      setLocalServiceStatus("error")
      return
    }

    setLocalServiceStatus("scanning")
    try {
      const services = await detectLocalPreviewServices()
      if (localServiceRequestIDRef.current !== requestID) return
      setLocalPreviewServices(services)
      setLocalServiceStatus("ready")
    } catch (error) {
      if (localServiceRequestIDRef.current !== requestID) return
      console.error("[preview] failed to detect local preview services:", error)
      setLocalPreviewServices([])
      setLocalServiceStatus("error")
    }
  }

  async function handleCaptureScreenshot() {
    const capturePreviewScreenshot = window.desktop?.capturePreviewScreenshot
    const bounds = previewStackRef.current?.getBoundingClientRect()
    if (!capturePreviewScreenshot || !bounds || bounds.width <= 0 || bounds.height <= 0) {
      toast.error("Preview screenshot is unavailable.")
      return
    }

    setIsCapturingScreenshot(true)
    try {
      const result = await capturePreviewScreenshot({
        bounds: {
          height: Math.round(bounds.height),
          width: Math.round(bounds.width),
          x: Math.round(bounds.left),
          y: Math.round(bounds.top),
        },
        copyToClipboard: true,
        url: target?.safePreviewUrl ?? target?.normalizedInput ?? state.committedUrl ?? draftValue,
      })
      toast.success(result.copiedToClipboard ? "Screenshot saved and copied to clipboard." : "Screenshot saved.")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`Screenshot failed: ${message}`)
    } finally {
      setIsCapturingScreenshot(false)
    }
  }

  useEffect(() => {
    return () => {
      textRequestIDRef.current += 1
      localServiceRequestIDRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (target || localServiceAutoScanRef.current) return
    localServiceAutoScanRef.current = true
    void scanLocalPreviewServices()
  }, [target])

  useEffect(() => {
    setFrameLoadError(null)
    setStatusMessage(null)
    setForceIframeFallback(false)
    setWebviewReady(false)
    setFrameIsLoading(Boolean(target?.safePreviewUrl && (target.renderer === "url-webview" || target.renderer === "html-preview" || target.renderer === "svg-preview")))
  }, [state.reloadToken, target?.safePreviewUrl, target?.renderer])

  useEffect(() => {
    if (!shouldUseWebview || !target?.safePreviewUrl) return

    const activeWebview = webviewRef.current
    if (!activeWebview) return
    const readyWebview: WebviewElement = activeWebview

    function handleDomReady() {
      setWebviewReady(true)
      setFrameIsLoading(false)
      setFrameLoadError(null)
      setStatusMessage(null)
    }

    function handleDidStartLoading() {
      setFrameIsLoading(true)
      setFrameLoadError(null)
    }

    function handleDidStopLoading() {
      setFrameIsLoading(false)
    }

    function handleWillNavigate(rawEvent: Event) {
      rawEvent.preventDefault?.()
      setStatusMessage("Links are disabled inside preview.")
    }

    function handleDidFailLoad(rawEvent: Event) {
      const event = rawEvent as WebviewFailLoadEvent
      if (event.isMainFrame === false || event.errorCode === -3) return
      setFrameIsLoading(false)
      setFrameLoadError(getPreviewFailure(event.errorDescription, event.errorCode))
      setWebviewReady(false)
    }

    readyWebview.addEventListener("dom-ready", handleDomReady as EventListener)
    readyWebview.addEventListener("did-start-loading", handleDidStartLoading as EventListener)
    readyWebview.addEventListener("did-stop-loading", handleDidStopLoading as EventListener)
    readyWebview.addEventListener("did-fail-load", handleDidFailLoad as EventListener)
    readyWebview.addEventListener("will-navigate", handleWillNavigate as EventListener)
    readyWebview.addEventListener("new-window", handleWillNavigate as EventListener)

    return () => {
      readyWebview.removeEventListener("dom-ready", handleDomReady as EventListener)
      readyWebview.removeEventListener("did-start-loading", handleDidStartLoading as EventListener)
      readyWebview.removeEventListener("did-stop-loading", handleDidStopLoading as EventListener)
      readyWebview.removeEventListener("did-fail-load", handleDidFailLoad as EventListener)
      readyWebview.removeEventListener("will-navigate", handleWillNavigate as EventListener)
      readyWebview.removeEventListener("new-window", handleWillNavigate as EventListener)
    }
  }, [shouldUseWebview, state.reloadToken, target?.safePreviewUrl])

  useEffect(() => {
    if (!shouldUseWebview || !target?.safePreviewUrl || !frameIsLoading) return

    const timer = globalThis.setTimeout(() => {
      setForceIframeFallback(true)
      setFrameIsLoading(false)
      setStatusMessage("The embedded webview did not initialize. Falling back to iframe mode.")
    }, 2500)

    return () => {
      globalThis.clearTimeout(timer)
    }
  }, [frameIsLoading, shouldUseWebview, state.reloadToken, target?.safePreviewUrl])

  useEffect(() => {
    const readPreviewText = window.desktop?.readPreviewText
    const readPath = getTargetPath(target)
    const readWorkspaceRoot = target?.workspaceRoot ?? workspaceRoot ?? null

    if (!target || !readPath || !target.textReadable || !TEXT_RENDERERS.has(target.renderer)) {
      textRequestIDRef.current += 1
      setTextPreview({
        status: "idle",
        content: "",
        error: null,
        path: null,
      })
      return
    }

    const requestID = textRequestIDRef.current + 1
    textRequestIDRef.current = requestID
    setTextPreview({
      status: "loading",
      content: "",
      error: null,
      path: readPath,
    })

    if (!readPreviewText) {
      setTextPreview({
        status: "error",
        content: "",
        error: "Preview text reader is unavailable in this runtime.",
        path: readPath,
      })
      return
    }

    void readPreviewText({
      path: readPath,
      workspaceRoot: readWorkspaceRoot,
    }).then((result) => {
      if (textRequestIDRef.current !== requestID) return
      setTextPreview({
        status: "ready",
        content: result.content,
        error: null,
        path: result.path,
      })
    }).catch((error) => {
      if (textRequestIDRef.current !== requestID) return
      setTextPreview({
        status: "error",
        content: "",
        error: error instanceof Error ? error.message : String(error),
        path: readPath,
      })
    })
  }, [state.reloadToken, target, targetPath, workspaceRoot])

  function renderErrorState(message: string, suggestions?: string[]) {
    return (
      <div className="preview-canvas-state preview-error-state unified-preview-message" role="alert">
        <div className="preview-error-icon">!</div>
        <h3>Preview unavailable</h3>
        <p>{message}</p>
        {suggestions?.length ? (
          <ul className="unified-preview-suggestion-list">
            {suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
          </ul>
        ) : null}
      </div>
    )
  }

  function renderFrame(target: ResolvedPreviewTarget) {
    if (!target.safePreviewUrl) {
      return renderErrorState("This preview target does not have a safe preview URL.")
    }
    if (frameLoadError) {
      return renderErrorState(frameLoadError.message, frameLoadError.suggestions)
    }

    const frameTitle = `Preview of ${target.title}`
    return (
      <div className="preview-canvas unified-preview-frame-canvas">
        {shouldUseWebview ? (
          <webview
            key={`${target.safePreviewUrl}:${state.reloadToken}:webview`}
            ref={(node) => {
              webviewRef.current = node as WebviewElement | null
            }}
            className="preview-frame preview-webview"
            partition="persist:preview"
            preload={previewGuestPreloadPath}
            src={target.safePreviewUrl}
          />
        ) : (
          <iframe
            key={`${target.safePreviewUrl}:${state.reloadToken}:iframe`}
            ref={iframeRef}
            title={frameTitle}
            className="preview-frame"
            sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
            src={target.safePreviewUrl}
            onError={() => {
              setFrameIsLoading(false)
              setFrameLoadError(getPreviewFailure())
            }}
            onLoad={() => {
              setFrameIsLoading(false)
              setFrameLoadError(null)
            }}
          />
        )}
        {interactionPlugins.length > 0 ? (
          <PreviewInteractionHost
            activeInteractionID={state.activeInteractionID}
            frameKind={shouldUseWebview ? "webview" : "iframe"}
            frameRefs={{ iframeRef, webviewRef }}
            interactions={state.interactions}
            plugins={interactionPlugins}
            target={target}
            webviewReady={webviewReady}
            onActiveInteractionChange={onActiveInteractionChange}
            onCommitInteraction={onCommitInteraction}
          />
        ) : null}
        {frameIsLoading ? (
          <div className="preview-loading-scrim" aria-live="polite">
            Loading preview...
          </div>
        ) : null}
      </div>
    )
  }

  function renderImage(target: ResolvedPreviewTarget) {
    if (!target.safePreviewUrl) {
      return renderErrorState("This image does not have a safe preview URL.")
    }
    return (
      <div className="unified-preview-image-stage">
        <img className="unified-preview-image" src={target.safePreviewUrl} alt={target.title} />
      </div>
    )
  }

  function renderText(target: ResolvedPreviewTarget) {
    if (!shouldRenderText) {
      return renderErrorState("This preview target is not readable as text.")
    }
    if (textPreview.status === "loading") {
      return (
        <div className="preview-canvas-state unified-preview-message" aria-live="polite">
          <h3>Reading preview</h3>
          <p>Loading file content.</p>
        </div>
      )
    }
    if (textPreview.status === "error") return renderTextError(textPreview.error)
    if (textPreview.status !== "ready") return null

    return (
      <div className="unified-preview-text-stage">
        <TextPreviewContent codeTheme={codeTheme} content={textPreview.content} target={target} />
      </div>
    )
  }

  function renderSystemOpen(target: ResolvedPreviewTarget) {
    return (
      <div className="preview-canvas-state preview-empty-state unified-preview-message">
        <h3>No inline renderer</h3>
        <p>This file type can be opened with the system default application.</p>
        <button type="button" className="primary-button" onClick={() => void onOpenExternal()}>
          Open externally
        </button>
      </div>
    )
  }

  function renderTargetBody(): ReactNode {
    if (state.status === "resolving") {
      return (
        <div className="preview-canvas-state unified-preview-message" aria-live="polite">
          <h3>Resolving preview</h3>
          <p>Checking the target and selecting a renderer.</p>
        </div>
      )
    }
    if (state.status === "error" && state.errorMessage) {
      return renderErrorState(state.errorMessage)
    }
    if (!target) {
      return (
        <EmptyPreviewState
          localPreviewServices={localPreviewServices}
          localServiceStatus={localServiceStatus}
          onOpenUrl={onOpenUrl}
          onScanLocalServices={() => void scanLocalPreviewServices()}
        />
      )
    }

    switch (target.renderer) {
      case "url-webview":
      case "html-preview":
      case "svg-preview":
        return renderFrame(target)
      case "image-preview":
        return renderImage(target)
      case "markdown-preview":
      case "json-viewer":
      case "table-preview":
      case "code-viewer":
        return renderText(target)
      case "system-open":
        return renderSystemOpen(target)
    }
  }

  return (
    <section className="right-sidebar-section preview-panel-section unified-preview-panel">
      <div className="preview-panel-main">
        <div className="preview-panel-controls">
          <form
            className="preview-toolbar unified-preview-toolbar"
            onSubmit={(event) => {
              event.preventDefault()
              onOpen()
            }}
          >
            <div className="preview-toolbar-navigation" aria-label="Preview navigation">
              <button
                type="button"
                className="preview-toolbar-icon-button"
                aria-label="Back"
                title="Back"
                disabled={!canNavigateBack}
                onClick={() => onBack()}
              >
                <BackIcon />
              </button>
              <button
                type="button"
                className="preview-toolbar-icon-button"
                aria-label="Forward"
                title="Forward"
                disabled={!canNavigateForward}
                onClick={() => onForward()}
              >
                <ForwardIcon />
              </button>
              <button
                type="button"
                className="preview-toolbar-icon-button"
                aria-label="Reload preview"
                title="Reload preview"
                onClick={() => onReload()}
              >
                <ResetIcon />
              </button>
            </div>
            <div className="preview-toolbar-address">
              <input
                className="preview-toolbar-input"
                value={draftValue}
                onChange={(event) => onDraftUrlChange(event.currentTarget.value)}
                placeholder="URL, agent://artifact/id, or workspace file"
                spellCheck={false}
                aria-label="Preview target"
              />
              <button
                type="button"
                className="preview-toolbar-icon-button preview-toolbar-open-external"
                aria-label="Open externally"
                title="Open externally"
                disabled={!canOpenExternal}
                onClick={() => void onOpenExternal()}
              >
                <OpenExternalIcon />
              </button>
            </div>
            <button
              type="button"
              className="preview-toolbar-icon-button"
              aria-label="Capture screenshot"
              title="Capture screenshot"
              disabled={!canCaptureScreenshot || isCapturingScreenshot}
              onClick={() => void handleCaptureScreenshot()}
            >
              <ScreenshotIcon />
            </button>
            <PreviewInteractionToolbar
              activeInteractionID={state.activeInteractionID}
              target={target}
              onActiveInteractionChange={onActiveInteractionChange}
            />
          </form>
          {statusMessage ? <p className="preview-helper-copy unified-preview-status-message">{statusMessage}</p> : null}
        </div>

        <div ref={previewStackRef} className="preview-panel-preview-stack unified-preview-stack">
          {renderTargetBody()}
        </div>
      </div>
    </section>
  )
}
