const ROOT_ID = "anybox-agent-overlay-root"
const ACTIVE_MS = 2_500

type OverlayRuntime = {
  show(action?: string): void
  dispose(): void
}

const overlayGlobal = globalThis as typeof globalThis & {
  __anyboxBrowserOverlay__?: OverlayRuntime
}

if (!overlayGlobal.__anyboxBrowserOverlay__) {
  let hideTimer: number | undefined

  const ensureRoot = () => {
    const existing = document.getElementById(ROOT_ID)
    if (existing) return existing

    const root = document.createElement("div")
    root.id = ROOT_ID
    root.setAttribute("aria-hidden", "true")
    root.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "padding:8px 10px",
      "border:1px solid rgba(0,0,0,.12)",
      "border-radius:8px",
      "background:rgba(18,18,18,.88)",
      "color:#fff",
      "font:12px/1.3 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "box-shadow:0 8px 24px rgba(0,0,0,.18)",
      "pointer-events:none",
      "opacity:0",
      "transform:translateY(6px)",
      "transition:opacity .16s ease,transform .16s ease",
    ].join(";")
    root.textContent = "Anybox is controlling Chrome"
    document.documentElement.appendChild(root)
    return root
  }

  const runtime: OverlayRuntime = {
    show(action?: string) {
      const root = ensureRoot()
      root.textContent = action ? `Anybox: ${action}` : "Anybox is controlling Chrome"
      root.style.opacity = "1"
      root.style.transform = "translateY(0)"
      if (hideTimer !== undefined) clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => {
        root.style.opacity = "0"
        root.style.transform = "translateY(6px)"
      }, ACTIVE_MS)
    },
    dispose() {
      if (hideTimer !== undefined) {
        clearTimeout(hideTimer)
        hideTimer = undefined
      }
      document.getElementById(ROOT_ID)?.remove()
      chrome.runtime.onMessage.removeListener(onMessage)
      delete overlayGlobal.__anyboxBrowserOverlay__
    },
  }
  const onMessage = (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: unknown) => void,
  ) => {
    if (!message || typeof message !== "object") return false
    const type = (message as { type?: string }).type
    if (type === "ANYBOX_BROWSER_BRIDGE_REMOVE") {
      runtime.dispose()
      sendResponse({ ok: true })
      return true
    }
    if (type !== "ANYBOX_BROWSER_BRIDGE_ACTIVE") return false
    runtime.show((message as { action?: string }).action)
    sendResponse({ ok: true })
    return true
  }
  overlayGlobal.__anyboxBrowserOverlay__ = runtime
  chrome.runtime.onMessage.addListener(onMessage)
}
