import { useEffect, useMemo, useRef, useState } from "react"
import { toPluginViewPartition } from "../../../../shared/local-preview-protocol"
import type { InstalledPluginView } from "../types"

interface PluginSidebarViewProps {
  activeProjectID?: string | null
  view: InstalledPluginView
}

interface PluginWebviewElement extends HTMLElement {}

type WebviewFailLoadEvent = Event & {
  errorCode?: number
  errorDescription?: string
  isMainFrame?: boolean
}

export function PluginSidebarView({ activeProjectID, view }: PluginSidebarViewProps) {
  const webviewRef = useRef<PluginWebviewElement | null>(null)
  const safePreviewUrl = useMemo(() => {
    const rawURL = view.safePreviewUrl?.trim() ?? ""
    if (!rawURL || !view.workspaceAccess || !activeProjectID?.trim()) return rawURL
    try {
      const url = new URL(rawURL)
      url.searchParams.set("anyboxProjectID", activeProjectID.trim())
      url.searchParams.set("anyboxAppMode", "plugin")
      return url.toString()
    } catch {
      return ""
    }
  }, [activeProjectID, view.safePreviewUrl, view.workspaceAccess])
  const [isLoading, setIsLoading] = useState(Boolean(safePreviewUrl))
  const [error, setError] = useState<string | null>(
    safePreviewUrl ? null : "This plugin view does not have a valid local entry URL.",
  )
  const partition = useMemo(() => toPluginViewPartition(view.pluginID), [view.pluginID])

  useEffect(() => {
    setIsLoading(Boolean(safePreviewUrl))
    setError(safePreviewUrl ? null : "This plugin view does not have a valid local entry URL.")
  }, [safePreviewUrl])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !safePreviewUrl) return

    function handleDomReady() {
      setIsLoading(false)
      setError(null)
    }

    function handleDidStartLoading() {
      setIsLoading(true)
      setError(null)
    }

    function handleDidStopLoading() {
      setIsLoading(false)
    }

    function handleDidFailLoad(rawEvent: Event) {
      const event = rawEvent as WebviewFailLoadEvent
      if (event.isMainFrame === false || event.errorCode === -3) return
      setIsLoading(false)
      setError(event.errorDescription?.trim() || "The plugin view could not be loaded.")
    }

    function handleBlockedNavigation(event: Event) {
      event.preventDefault()
      setIsLoading(false)
      setError("This plugin tried to navigate away from its registered local view.")
    }

    webview.addEventListener("dom-ready", handleDomReady)
    webview.addEventListener("did-start-loading", handleDidStartLoading)
    webview.addEventListener("did-stop-loading", handleDidStopLoading)
    webview.addEventListener("did-fail-load", handleDidFailLoad)
    webview.addEventListener("will-navigate", handleBlockedNavigation)
    webview.addEventListener("will-frame-navigate", handleBlockedNavigation)
    webview.addEventListener("new-window", handleBlockedNavigation)

    return () => {
      webview.removeEventListener("dom-ready", handleDomReady)
      webview.removeEventListener("did-start-loading", handleDidStartLoading)
      webview.removeEventListener("did-stop-loading", handleDidStopLoading)
      webview.removeEventListener("did-fail-load", handleDidFailLoad)
      webview.removeEventListener("will-navigate", handleBlockedNavigation)
      webview.removeEventListener("will-frame-navigate", handleBlockedNavigation)
      webview.removeEventListener("new-window", handleBlockedNavigation)
    }
  }, [safePreviewUrl])

  if (!safePreviewUrl) {
    return (
      <div className="plugin-sidebar-view-state is-error" role="alert">
        <strong>Plugin view unavailable</strong>
        <span>{error}</span>
      </div>
    )
  }

  return (
    <div className="plugin-sidebar-view" data-plugin-id={view.pluginID} data-view-id={view.viewID}>
      <webview
        key={safePreviewUrl}
        ref={(node) => {
          webviewRef.current = node as PluginWebviewElement | null
        }}
        className="plugin-sidebar-view-frame"
        partition={partition}
        src={safePreviewUrl}
        webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes,webSecurity=yes"
      />
      {isLoading ? (
        <div className="plugin-sidebar-view-state is-loading" role="status">
          <span>Loading {view.title}…</span>
        </div>
      ) : null}
      {error ? (
        <div className="plugin-sidebar-view-state is-error" role="alert">
          <strong>Plugin view unavailable</strong>
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  )
}
