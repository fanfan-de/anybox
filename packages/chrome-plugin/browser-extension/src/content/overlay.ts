const ROOT_ID = "anybox-agent-overlay-root"
const ACTIVE_MS = 2_500

let hideTimer: number | undefined

function ensureRoot() {
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

function showOverlay(action?: string) {
  const root = ensureRoot()
  root.textContent = action ? `Anybox: ${action}` : "Anybox is controlling Chrome"
  root.style.opacity = "1"
  root.style.transform = "translateY(0)"
  if (hideTimer !== undefined) clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => {
    root.style.opacity = "0"
    root.style.transform = "translateY(6px)"
  }, ACTIVE_MS)
}

chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
  if (!message || typeof message !== "object") return false
  if ((message as { type?: string }).type !== "ANYBOX_BROWSER_BRIDGE_ACTIVE") return false
  showOverlay((message as { action?: string }).action)
  sendResponse({ ok: true })
  return true
})
