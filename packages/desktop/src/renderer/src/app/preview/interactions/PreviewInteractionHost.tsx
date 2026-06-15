import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { CommentAddIcon } from "../../icons"
import { useI18n } from "../../i18n/I18nProvider"
import type {
  PreviewInteractionCommitInput,
  PreviewInteractionPluginID,
  PreviewInteractionRecord,
  ResolvedPreviewTarget,
  WebCommentInteractionPayload,
} from "../../types"
import { clamp } from "../../utils"
import { getPreviewInteractionPlugins } from "./registry"
import type {
  PreviewInteractionHostProps,
  PreviewInteractionHoverTarget,
  PreviewInteractionOverlayMouseEvent,
  PreviewInteractionPlugin,
} from "./types"

type WebviewIpcMessageEvent = Event & {
  args: unknown[]
  channel: string
}

interface PreviewGuestMarker {
  anchor?: WebCommentInteractionPayload["anchor"]
  documentX?: number
  documentY?: number
  id: string
  label: string
  text: string
  x: number
  y: number
}

function getPendingComposerPlacement(x: number) {
  if (x < 38) return "is-right"
  if (x > 62) return "is-left"
  return "is-center"
}

function getInteractionSnapshot(target: ResolvedPreviewTarget): PreviewInteractionCommitInput["snapshot"] {
  return {
    mime: target.mime,
    path: target.path ?? target.entry,
    title: target.title,
    url: target.kind === "url" ? target.safePreviewUrl ?? target.normalizedInput : target.normalizedInput,
  }
}

function getHoverTargetStyle(target: PreviewInteractionHoverTarget | null) {
  if (!target) return undefined
  return {
    "--preview-hover-height": target.height,
    "--preview-hover-left": target.left,
    "--preview-hover-tooltip-left": target.tooltipLeft,
    "--preview-hover-tooltip-top": target.tooltipTop,
    "--preview-hover-top": target.top,
    "--preview-hover-width": target.width,
  } as CSSProperties
}

function getPendingCommentStyle(target: PreviewInteractionHoverTarget | null) {
  if (!target) return undefined
  return {
    "--preview-comment-x": `${target.x}%`,
    "--preview-comment-y": `${target.y}%`,
  } as CSSProperties
}

function isWebCommentPayload(payload: PreviewInteractionRecord["payload"]): payload is WebCommentInteractionPayload {
  return payload.kind === "web-comment" && typeof payload.x === "number" && typeof payload.y === "number"
}

function getVisibleCommentMarkerRecords(
  interactions: PreviewInteractionRecord[],
  plugins: PreviewInteractionPlugin[],
  target: ResolvedPreviewTarget,
) {
  return interactions.filter((record) => {
    if (!isWebCommentPayload(record.payload)) return false
    const plugin = plugins.find((candidate) => candidate.id === record.pluginID)
    return Boolean(plugin && record.targetKey === plugin.resolveTargetKey(target))
  })
}

function getCommentMarkerStyle(payload: WebCommentInteractionPayload) {
  return {
    left: `${clamp(payload.x, 0, 100)}%`,
    top: `${clamp(payload.y, 0, 100)}%`,
  } as CSSProperties
}

function toPreviewGuestMarkers(records: PreviewInteractionRecord[]): PreviewGuestMarker[] {
  return records
    .filter((record): record is PreviewInteractionRecord & { payload: WebCommentInteractionPayload } =>
      isWebCommentPayload(record.payload),
    )
    .map((record, index) => ({
      anchor: record.payload.anchor,
      documentX: record.payload.documentX,
      documentY: record.payload.documentY,
      id: record.id,
      label: String(index + 1),
      text: record.payload.text,
      x: record.payload.x,
      y: record.payload.y,
    }))
}

async function capturePreviewScreenshotPath(target: ResolvedPreviewTarget, overlayElement: HTMLElement | null) {
  const capturePreviewScreenshot = window.desktop?.capturePreviewScreenshot
  const bounds = overlayElement?.getBoundingClientRect()
  if (!capturePreviewScreenshot || !bounds || bounds.width <= 0 || bounds.height <= 0) return null

  try {
    const result = await capturePreviewScreenshot({
      bounds: {
        height: Math.round(bounds.height),
        width: Math.round(bounds.width),
        x: Math.round(bounds.left),
        y: Math.round(bounds.top),
      },
      url: target.safePreviewUrl ?? target.normalizedInput,
    })

    return result.path.trim() || null
  } catch (error) {
    console.error("[preview] failed to capture interaction screenshot:", error)
    return null
  }
}

function useActivePlugin(plugins: PreviewInteractionPlugin[], activeInteractionID: PreviewInteractionPluginID | null) {
  return useMemo(
    () => plugins.find((plugin) => plugin.id === activeInteractionID) ?? null,
    [activeInteractionID, plugins],
  )
}

export function PreviewInteractionToolbar({
  activeInteractionID,
  target,
  onActiveInteractionChange,
}: {
  activeInteractionID: PreviewInteractionPluginID | null
  target: ResolvedPreviewTarget | null
  onActiveInteractionChange: (pluginID: PreviewInteractionPluginID | null) => void
}) {
  const plugins = useMemo(() => getPreviewInteractionPlugins(target), [target])
  if (plugins.length === 0) return null

  return (
    <div className="preview-mode-toggle" aria-label="Preview interactions">
      {plugins.map((plugin) => {
        const isActive = activeInteractionID === plugin.id
        return (
          <button
            key={plugin.id}
            type="button"
            className={isActive ? "preview-comment-mode-button is-active" : "preview-comment-mode-button"}
            aria-label={plugin.label}
            aria-pressed={isActive}
            title={isActive ? `Turn off ${plugin.label.toLowerCase()}` : `Turn on ${plugin.label.toLowerCase()}`}
            onClick={() => onActiveInteractionChange(isActive ? null : plugin.id)}
          >
            <CommentAddIcon size={15} />
          </button>
        )
      })}
    </div>
  )
}

export function PreviewInteractionHost({
  activeInteractionID,
  frameKind,
  frameRefs,
  interactions,
  plugins,
  target,
  webviewReady,
  onActiveInteractionChange,
  onCommitInteraction,
}: PreviewInteractionHostProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const { t } = useI18n()
  const hoverRequestIDRef = useRef(0)
  const activePlugin = useActivePlugin(plugins, activeInteractionID)
  const [hoverTarget, setHoverTarget] = useState<PreviewInteractionHoverTarget | null>(null)
  const [pendingTarget, setPendingTarget] = useState<PreviewInteractionHoverTarget | null>(null)
  const [pendingText, setPendingText] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const currentRecords = activePlugin
    ? interactions.filter((record) => record.pluginID === activePlugin.id && record.targetKey === activePlugin.resolveTargetKey(target))
    : []
  const visibleCommentMarkerRecords = getVisibleCommentMarkerRecords(interactions, plugins, target)
  const hoverTargetStyle = getHoverTargetStyle(hoverTarget)
  const pendingCommentStyle = getPendingCommentStyle(pendingTarget)

  useEffect(() => {
    if (activeInteractionID && !plugins.some((plugin) => plugin.id === activeInteractionID)) {
      onActiveInteractionChange(null)
    }
  }, [activeInteractionID, onActiveInteractionChange, plugins])

  useEffect(() => {
    setHoverTarget(null)
    setPendingTarget(null)
    setPendingText("")
  }, [activeInteractionID, target.normalizedInput, target.safePreviewUrl])

  useEffect(() => {
    const webview = frameRefs.webviewRef.current
    if (frameKind !== "webview" || !webview?.send || !webviewReady) return

    try {
      webview.send("preview:set-mode", { mode: activePlugin?.id === "web.comment" ? "comment" : "browse" })
    } catch (error) {
      console.error("[preview] failed to sync interaction mode", error)
    }
  }, [activePlugin?.id, frameKind, frameRefs.webviewRef, webviewReady])

  useEffect(() => {
    const webview = frameRefs.webviewRef.current
    if (frameKind !== "webview" || !webview) return

    function handleIpcMessage(rawEvent: Event) {
      if (activePlugin?.id !== "web.comment") return
      const event = rawEvent as WebviewIpcMessageEvent
      if (event.channel !== "preview:comment-target") return
      const payload = event.args[0] as Record<string, unknown> | undefined
      setPendingTarget({
        anchor: payload?.anchor as PreviewInteractionHoverTarget["anchor"] | undefined,
        className: "is-coordinate",
        dimensions: "coordinate",
        documentX: typeof payload?.documentX === "number" ? payload.documentX : undefined,
        documentY: typeof payload?.documentY === "number" ? payload.documentY : undefined,
        height: "20px",
        label: "Preview target",
        left: `${typeof payload?.x === "number" ? payload.x : 50}%`,
        top: `${typeof payload?.y === "number" ? payload.y : 50}%`,
        tooltipLeft: "50%",
        tooltipPlacement: "is-right",
        tooltipTop: "50%",
        width: "20px",
        x: typeof payload?.x === "number" ? payload.x : 50,
        y: typeof payload?.y === "number" ? payload.y : 50,
      })
      setPendingText("")
    }

    webview.addEventListener("ipc-message", handleIpcMessage as EventListener)
    return () => {
      webview.removeEventListener("ipc-message", handleIpcMessage as EventListener)
    }
  }, [activePlugin?.id, frameKind, frameRefs.webviewRef])

  useEffect(() => {
    const webview = frameRefs.webviewRef.current
    if (frameKind !== "webview" || !webview?.send || !webviewReady) return

    try {
      webview.send("preview:set-markers", {
        markers: toPreviewGuestMarkers(visibleCommentMarkerRecords),
      })
    } catch (error) {
      console.error("[preview] failed to sync comment markers", error)
    }
  }, [frameKind, frameRefs.webviewRef, visibleCommentMarkerRecords, webviewReady])

  async function resolveTargetFromEvent(event: PreviewInteractionOverlayMouseEvent) {
    if (!activePlugin) return null
    const bounds = event.currentTarget.getBoundingClientRect()
    return activePlugin.resolvePointerTarget({
      clientX: event.clientX,
      clientY: event.clientY,
      frameKind,
      frameRefs,
      overlayBounds: bounds,
    })
  }

  function handleOverlayClick(event: PreviewInteractionOverlayMouseEvent) {
    if (!activePlugin) return
    event.preventDefault()
    event.stopPropagation()
    void resolveTargetFromEvent(event).then((nextTarget) => {
      if (!nextTarget) return
      setPendingTarget(nextTarget)
      setPendingText("")
    })
  }

  function handleOverlayMouseMove(event: PreviewInteractionOverlayMouseEvent) {
    if (!activePlugin) return
    const requestID = hoverRequestIDRef.current + 1
    hoverRequestIDRef.current = requestID
    void resolveTargetFromEvent(event).then((nextTarget) => {
      if (hoverRequestIDRef.current === requestID) {
        setHoverTarget(nextTarget)
      }
    })
  }

  function handleOverlayMouseLeave() {
    hoverRequestIDRef.current += 1
    setHoverTarget(null)
  }

  async function handlePendingSave() {
    if (!activePlugin || !pendingTarget || isSaving) return
    const text = pendingText.trim()
    if (!text) return
    setIsSaving(true)

    try {
      const screenshotPath = await capturePreviewScreenshotPath(target, overlayRef.current)
      const draft = activePlugin.buildCommitDraft({
        frameKind,
        pendingTarget,
        screenshotPath,
        target,
        text,
      })
      onCommitInteraction({
        pluginID: activePlugin.id,
        renderer: target.renderer,
        snapshot: getInteractionSnapshot(target),
        ...draft,
      })
      setPendingTarget(null)
      setPendingText("")
    } finally {
      setIsSaving(false)
    }
  }

  function handlePendingCancel() {
    setPendingTarget(null)
    setPendingText("")
  }

  return (
    <>
      <div
        ref={overlayRef}
        className={activePlugin ? "preview-comment-overlay is-active" : "preview-comment-overlay"}
        data-testid="preview-interaction-overlay"
        onClick={handleOverlayClick}
        onMouseLeave={handleOverlayMouseLeave}
        onMouseMove={handleOverlayMouseMove}
      />

      {activePlugin && hoverTarget ? (
        <>
          <div
            className={`preview-hover-highlight ${hoverTarget.className}`}
            style={hoverTargetStyle}
          />
          <div
            className={`preview-hover-tooltip ${hoverTarget.tooltipPlacement}`}
            style={hoverTargetStyle}
          >
            <div className="preview-hover-tooltip-row">
              <strong>{hoverTarget.anchor?.type === "element" ? hoverTarget.anchor.tagName ?? "target" : "point"}</strong>
              <strong>{hoverTarget.className === "is-element" ? hoverTarget.dimensions : hoverTarget.label}</strong>
            </div>
            {hoverTarget.color ? (
              <div className="preview-hover-tooltip-row">
                <span>color</span>
                <strong>{hoverTarget.color}</strong>
              </div>
            ) : null}
            {hoverTarget.fontSize || hoverTarget.fontFamily ? (
              <div className="preview-hover-tooltip-row">
                <span>font</span>
                <strong>{[hoverTarget.fontSize, hoverTarget.fontFamily].filter(Boolean).join(" ")}</strong>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {activePlugin && pendingTarget ? (
        <div
          className={`preview-floating-comment-composer ${getPendingComposerPlacement(pendingTarget.x)}`}
          style={pendingCommentStyle}
        >
          <span className="preview-floating-comment-pin">{currentRecords.length + 1}</span>
          <div className="preview-floating-comment-bubble">
            <div className="preview-comment-selection">
              <strong>{pendingTarget.anchor?.type === "element" ? pendingTarget.anchor.label ?? pendingTarget.label : pendingTarget.label}</strong>
              {pendingTarget.anchor?.type === "element" && pendingTarget.anchor.selector ? <span>{pendingTarget.anchor.selector}</span> : null}
            </div>
            <label className="preview-comment-label">
              <textarea
                aria-label={t("preview.commentText", { label: activePlugin.label })}
                placeholder={t("preview.commentPlaceholder")}
                rows={2}
                value={pendingText}
                onChange={(event) => setPendingText(event.target.value)}
              />
            </label>
            <div className="right-sidebar-toolbar preview-floating-comment-actions">
              <button type="button" className="secondary-button" disabled={!pendingText.trim() || isSaving} onClick={() => void handlePendingSave()}>
                {isSaving ? t("app.saving") : t("app.save")}
              </button>
              <button type="button" className="secondary-button" onClick={handlePendingCancel}>
                {t("app.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {frameKind !== "webview" && visibleCommentMarkerRecords.length > 0 ? (
        <div className="preview-markers-layer" aria-label={t("preview.savedComments")}>
          {visibleCommentMarkerRecords.map((record, index) => {
            const payload = record.payload as WebCommentInteractionPayload
            const markerNumber = index + 1
            return (
              <span
                key={record.id}
                className="preview-comment-marker"
                style={getCommentMarkerStyle(payload)}
                aria-label={t("preview.commentMarker", { number: markerNumber, text: payload.text })}
                title={payload.text}
              >
                {markerNumber}
              </span>
            )
          })}
        </div>
      ) : null}
    </>
  )
}
