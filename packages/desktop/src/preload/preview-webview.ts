import { ipcRenderer } from "electron"

type PreviewMode = "browse" | "comment"

const HIGHLIGHT_ID = "__desktop-preview-highlight__"
const INSPECTOR_TOOLTIP_ID = "__desktop-preview-inspector-tooltip__"
const FIT_STYLE_ID = "__desktop-preview-fit__"
const MARKERS_LAYER_ID = "__desktop-preview-markers__"
const MIN_SCALE = 0.04
const SCALE_EPSILON = 0.001

type PreviewMarkerAnchor = {
  offsetX?: number
  offsetY?: number
  path?: string
  selector?: string
  type?: string
}

interface PreviewMarker {
  anchor?: PreviewMarkerAnchor
  documentX?: number
  documentY?: number
  id: string
  label: string
  text?: string
  x: number
  y: number
}

let currentMode: PreviewMode = "browse"
let currentScale = 1
let fitFrame = 0
let isApplyingFit = false
let fitResizeObserver: ResizeObserver | null = null
const fitTimeoutIDs = new Set<number>()
let currentMarkers: PreviewMarker[] = []

window.addEventListener("message", (event) => {
  if (event.source !== window) return
  const payload = event.data
  if (
    !payload
    || typeof payload !== "object"
    || payload.type !== "anybox:open-cinema-provider-settings"
    || payload.providerID !== "comfyui-local"
  ) return
  ipcRenderer.sendToHost("preview:open-cinema-provider-settings", {
    providerID: "comfyui-local",
  })
})

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function escapeHTML(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function isElement(value: EventTarget | null): value is Element {
  if (!value || typeof value !== "object") return false

  const candidate = value as Partial<Element> & { nodeType?: unknown; tagName?: unknown }
  return (
    candidate.nodeType === 1 &&
    typeof candidate.tagName === "string" &&
    typeof candidate.closest === "function"
  )
}

function isNode(value: EventTarget | null): value is Node {
  return Boolean(value && typeof value === "object" && typeof (value as Partial<Node>).nodeType === "number")
}

function resolveElementTarget(target: EventTarget | null) {
  if (isElement(target)) return target
  if (isNode(target) && isElement(target.parentElement)) return target.parentElement
  return null
}

function getHighlightElement() {
  let highlightElement = document.getElementById(HIGHLIGHT_ID)
  if (highlightElement) return highlightElement

  highlightElement = document.createElement("div")
  highlightElement.id = HIGHLIGHT_ID
  highlightElement.setAttribute("aria-hidden", "true")
  Object.assign(highlightElement.style, {
    background: "rgba(10, 132, 255, 0.18)",
    border: "2px solid rgba(10, 132, 255, 0.95)",
    borderRadius: "2px",
    boxSizing: "border-box",
    boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.52)",
    display: "none",
    left: "0",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    transform: "translateZ(0)",
    zIndex: "2147483647",
  })
  document.documentElement.appendChild(highlightElement)
  return highlightElement
}

function getInspectorTooltipElement() {
  let tooltipElement = document.getElementById(INSPECTOR_TOOLTIP_ID)
  if (tooltipElement) return tooltipElement

  tooltipElement = document.createElement("div")
  tooltipElement.id = INSPECTOR_TOOLTIP_ID
  tooltipElement.setAttribute("aria-hidden", "true")
  Object.assign(tooltipElement.style, {
    background: "rgba(255, 255, 255, 0.96)",
    border: "1px solid rgba(174, 181, 190, 0.72)",
    borderRadius: "10px",
    boxShadow: "0 12px 30px rgba(15, 23, 42, 0.18)",
    color: "#17232f",
    display: "none",
    font: "12px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    left: "0",
    maxWidth: "260px",
    minWidth: "220px",
    padding: "9px 11px",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    transform: "translateZ(0)",
    zIndex: "2147483647",
  })
  document.documentElement.appendChild(tooltipElement)
  return tooltipElement
}

function getMarkersLayerElement() {
  let markersLayer = document.getElementById(MARKERS_LAYER_ID)
  if (markersLayer) return markersLayer

  markersLayer = document.createElement("div")
  markersLayer.id = MARKERS_LAYER_ID
  markersLayer.setAttribute("aria-label", "Saved preview comments")
  Object.assign(markersLayer.style, {
    display: "none",
    height: "0",
    left: "0",
    pointerEvents: "none",
    position: "absolute",
    top: "0",
    width: "0",
    zIndex: "2147483646",
  })
  const parent = document.body ?? document.documentElement
  parent.appendChild(markersLayer)
  return markersLayer
}

function queryMarkerAnchor(anchor: PreviewMarkerAnchor | undefined) {
  if (anchor?.type !== "element") return null

  for (const selector of [anchor.selector, anchor.path]) {
    if (!selector) continue
    try {
      const element = document.querySelector(selector)
      if (element) return element
    } catch {
      // Generated selectors can contain user-authored class names that are not valid CSS selectors.
    }
  }

  return null
}

function resolveMarkerDocumentPoint(marker: PreviewMarker) {
  const anchorElement = queryMarkerAnchor(marker.anchor)
  if (anchorElement) {
    const rect = anchorElement.getBoundingClientRect()
    const offsetX = typeof marker.anchor?.offsetX === "number" ? clamp(marker.anchor.offsetX, 0, 1) : 0.5
    const offsetY = typeof marker.anchor?.offsetY === "number" ? clamp(marker.anchor.offsetY, 0, 1) : 0.5
    return {
      x: window.scrollX + rect.left + rect.width * offsetX,
      y: window.scrollY + rect.top + rect.height * offsetY,
    }
  }

  if (typeof marker.documentX === "number" && typeof marker.documentY === "number") {
    return {
      x: marker.documentX,
      y: marker.documentY,
    }
  }

  return {
    x: window.scrollX + clamp(marker.x, 0, 100) / 100 * Math.max(window.innerWidth, 1),
    y: window.scrollY + clamp(marker.y, 0, 100) / 100 * Math.max(window.innerHeight, 1),
  }
}

function createMarkerElement(marker: PreviewMarker) {
  const markerElement = document.createElement("span")
  const point = resolveMarkerDocumentPoint(marker)
  markerElement.textContent = marker.label
  markerElement.title = marker.text ?? ""
  markerElement.setAttribute("aria-label", `Comment ${marker.label}${marker.text ? `: ${marker.text}` : ""}`)
  Object.assign(markerElement.style, {
    alignItems: "center",
    background: "#0a84ff",
    border: "2px solid #ffffff",
    borderRadius: "999px",
    boxShadow: "0 8px 20px rgba(10, 132, 255, 0.32)",
    boxSizing: "border-box",
    color: "#ffffff",
    display: "inline-flex",
    font: "600 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    height: "23px",
    justifyContent: "center",
    left: `${point.x}px`,
    minWidth: "23px",
    padding: "0 6px",
    position: "absolute",
    top: `${point.y}px`,
    transform: "translate(-50%, -50%)",
    userSelect: "none",
  })
  return markerElement
}

function renderPreviewMarkers() {
  if (!document.documentElement) return

  const markersLayer = getMarkersLayerElement()
  markersLayer.replaceChildren(...currentMarkers.map(createMarkerElement))
  markersLayer.style.display = currentMarkers.length > 0 ? "block" : "none"
}

function hideHighlight() {
  const highlightElement = document.getElementById(HIGHLIGHT_ID)
  if (highlightElement) {
    highlightElement.style.display = "none"
  }

  const tooltipElement = document.getElementById(INSPECTOR_TOOLTIP_ID)
  if (tooltipElement) {
    tooltipElement.style.display = "none"
  }
}

function ensureFitStyle() {
  let fitStyle = document.getElementById(FIT_STYLE_ID) as HTMLStyleElement | null
  if (fitStyle) return fitStyle

  fitStyle = document.createElement("style")
  fitStyle.id = FIT_STYLE_ID
  fitStyle.textContent = `
    html {
      overflow: hidden !important;
      scrollbar-width: none !important;
      zoom: var(--desktop-preview-scale, 1) !important;
    }

    html::-webkit-scrollbar,
    body::-webkit-scrollbar {
      display: none !important;
      width: 0 !important;
      height: 0 !important;
    }

    body {
      overflow: hidden !important;
    }
  `
  document.head.appendChild(fitStyle)
  return fitStyle
}

function measureNaturalDocumentSize() {
  const html = document.documentElement
  const body = document.body
  const previousScale = html.style.getPropertyValue("--desktop-preview-scale")
  html.style.setProperty("--desktop-preview-scale", "1")

  const width = Math.max(
    window.innerWidth,
    html.clientWidth,
    html.scrollWidth,
    html.offsetWidth,
    body?.clientWidth ?? 0,
    body?.scrollWidth ?? 0,
    body?.offsetWidth ?? 0,
  )
  const height = Math.max(
    window.innerHeight,
    html.clientHeight,
    html.scrollHeight,
    html.offsetHeight,
    body?.clientHeight ?? 0,
    body?.scrollHeight ?? 0,
    body?.offsetHeight ?? 0,
  )

  if (previousScale) {
    html.style.setProperty("--desktop-preview-scale", previousScale)
  } else {
    html.style.removeProperty("--desktop-preview-scale")
  }

  return { height, width }
}

function applyAutoFit() {
  if (isApplyingFit || !document.body) return

  isApplyingFit = true
  try {
    ensureFitStyle()
    const { height, width } = measureNaturalDocumentSize()
    const nextScale = clamp(
      Math.min(window.innerWidth / Math.max(width, 1), window.innerHeight / Math.max(height, 1), 1),
      MIN_SCALE,
      1,
    )

    if (Math.abs(nextScale - currentScale) > SCALE_EPSILON) {
      currentScale = nextScale
      document.documentElement.style.setProperty("--desktop-preview-scale", nextScale.toString())
    }

    sendPageMeta()
  } catch (error) {
    reportPreviewError(error)
  } finally {
    isApplyingFit = false
  }
}

function scheduleAutoFit() {
  if (fitFrame) {
    window.cancelAnimationFrame(fitFrame)
  }

  fitFrame = window.requestAnimationFrame(() => {
    fitFrame = 0
    applyAutoFit()
  })
}

function scheduleDelayedAutoFit(delay: number) {
  const timeoutID = window.setTimeout(() => {
    fitTimeoutIDs.delete(timeoutID)
    scheduleAutoFit()
  }, delay)
  fitTimeoutIDs.add(timeoutID)
}

function cleanupPreviewGuest() {
  if (fitFrame) {
    window.cancelAnimationFrame(fitFrame)
    fitFrame = 0
  }
  for (const timeoutID of fitTimeoutIDs) {
    window.clearTimeout(timeoutID)
  }
  fitTimeoutIDs.clear()
  fitResizeObserver?.disconnect()
  fitResizeObserver = null
  document.removeEventListener("click", handleDocumentClick, true)
  document.removeEventListener("submit", handleDocumentSubmit, true)
  document.removeEventListener("keydown", handleDocumentKeyDown, true)
  document.removeEventListener("mousemove", handleDocumentMouseMove, true)
}

function isInteractiveElement(element: Element) {
  if (element.closest("a[href]")) return true
  if (element.closest("button")) return true
  if (element.closest("summary")) return true
  if (element.closest("label")) return true
  if (element.closest("[role='button']")) return true
  return Boolean(element.closest("input, select, textarea"))
}

function resolveInspectableElement(target: EventTarget | null) {
  const targetElement = resolveElementTarget(target)
  if (!targetElement) return null

  const highlightElement = document.getElementById(HIGHLIGHT_ID)
  if (highlightElement?.contains(targetElement)) return null

  return targetElement.closest(
    "a, button, summary, label, input, select, textarea, [role='button'], section, article, nav, header, footer, main, h1, h2, h3, h4, h5, h6, p, img, video, svg, div, span",
  )
}

function getElementText(element: Element) {
  const rawText = [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    "alt" in element ? element.getAttribute("alt") : null,
    "value" in element ? String((element as HTMLInputElement).value || "") : null,
    element.textContent,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

  return rawText.slice(0, 96) || undefined
}

function formatCssColor(value: string) {
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (!match) return value || "transparent"

  const [, red, green, blue] = match
  return [red, green, blue]
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .replace(/^/, "#")
}

function formatFontFamily(value: string) {
  const firstFamily = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)[0]
  return firstFamily || "inherit"
}

function getElementClassTokens(element: Element) {
  const className = element.className

  if (typeof className === "string") {
    return className.split(/\s+/).filter(Boolean)
  }

  if (typeof (className as { baseVal?: unknown })?.baseVal === "string") {
    return (className as { baseVal: string }).baseVal.split(/\s+/).filter(Boolean)
  }

  return []
}

function buildElementSelector(element: Element) {
  const segments: string[] = []
  let current: Element | null = element

  while (current && segments.length < 5) {
    const tagName = current.tagName.toLowerCase()
    if (current.id) {
      segments.unshift(`${tagName}#${current.id}`)
      break
    }

    const className = getElementClassTokens(current)
      .slice(0, 2)
      .join(".")
    const siblingIndex = current.parentElement
      ? Array.from(current.parentElement.children)
          .filter((child) => child.tagName === current?.tagName)
          .indexOf(current) + 1
      : 0
    const suffix = className ? `.${className}` : siblingIndex > 0 ? `:nth-of-type(${siblingIndex})` : ""
    segments.unshift(`${tagName}${suffix}`)
    current = current.parentElement
  }

  return segments.join(" > ")
}

function buildElementPath(element: Element) {
  const segments: string[] = []
  let current: Element | null = element

  while (current && segments.length < 8) {
    const tagName = current.tagName.toLowerCase()
    const siblingIndex = current.parentElement
      ? Array.from(current.parentElement.children).indexOf(current) + 1
      : 1
    segments.unshift(`${tagName}:nth-child(${siblingIndex})`)
    current = current.parentElement
  }

  return segments.join(" > ")
}

function reportPreviewError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  ipcRenderer.sendToHost("preview:error", { message })
}

function formatElementLabel(element: Element) {
  const tagName = element.tagName.toLowerCase()
  const text = getElementText(element)
  const role = element.getAttribute("role")

  if (text) {
    if (tagName === "a") return `Link "${text}"`
    if (tagName === "button" || role === "button") return `Button "${text}"`
    if (/^h[1-6]$/.test(tagName)) return `Heading "${text}"`
    return `${tagName} "${text}"`
  }

  if (role) return `${role} element`
  return `<${tagName}>`
}

function updateInspectorTooltip(element: Element, rect: DOMRect, pointer: { clientX: number; clientY: number }) {
  const tooltipElement = getInspectorTooltipElement()
  const computedStyle = window.getComputedStyle(element)
  const tagName = element.tagName.toLowerCase()
  const dimension = `${Math.round(rect.width)}x${Math.round(rect.height)}`
  const color = formatCssColor(computedStyle.color)
  const fontSize = computedStyle.fontSize || "inherit"
  const fontFamily = formatFontFamily(computedStyle.fontFamily)

  tooltipElement.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 14px;align-items:baseline;">
      <strong style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(tagName)}</strong>
      <strong style="font-family:'IBM Plex Mono','JetBrains Mono',Consolas,monospace;font-weight:600;">${escapeHTML(dimension)}</strong>
      <span style="color:#6b7280;">color</span>
      <strong style="font-family:'IBM Plex Mono','JetBrains Mono',Consolas,monospace;font-weight:600;">${escapeHTML(color)}</strong>
      <span style="color:#6b7280;">font</span>
      <strong style="font-family:'IBM Plex Mono','JetBrains Mono',Consolas,monospace;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(`${fontSize} ${fontFamily}`)}</strong>
    </div>
  `

  const tooltipWidth = 260
  const tooltipHeight = 88
  const cursorOffset = 12
  const viewportPadding = 8
  const maxLeft = Math.max(viewportPadding, window.innerWidth - tooltipWidth - viewportPadding)
  const preferredLeft = pointer.clientX + cursorOffset
  const preferredTop = pointer.clientY + cursorOffset
  const left = preferredLeft + tooltipWidth > window.innerWidth - viewportPadding
    ? clamp(pointer.clientX - tooltipWidth - cursorOffset, viewportPadding, maxLeft)
    : clamp(preferredLeft, viewportPadding, maxLeft)
  const top = preferredTop + tooltipHeight > window.innerHeight - viewportPadding
    ? Math.max(viewportPadding, pointer.clientY - tooltipHeight - cursorOffset)
    : preferredTop

  Object.assign(tooltipElement.style, {
    display: "block",
    left: `${left}px`,
    top: `${top}px`,
  })
}

function highlightElement(element: Element | null, pointer?: { clientX: number; clientY: number }) {
  if (currentMode !== "comment" || !element) {
    hideHighlight()
    return
  }

  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    hideHighlight()
    return
  }

  const highlightElement = getHighlightElement()
  Object.assign(highlightElement.style, {
    display: "block",
    height: `${rect.height}px`,
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
  })
  updateInspectorTooltip(element, rect, pointer ?? { clientX: rect.left, clientY: rect.bottom })
}

function sendPageMeta() {
  ipcRenderer.sendToHost("preview:page-meta", {
    title: document.title || location.href,
    url: location.href,
  })
}

function sendCoordinateCommentTarget(clientX: number, clientY: number) {
  const x = clamp((clientX / Math.max(window.innerWidth, 1)) * 100, 0, 100)
  const y = clamp((clientY / Math.max(window.innerHeight, 1)) * 100, 0, 100)

  ipcRenderer.sendToHost("preview:comment-target", {
    anchor: {
      type: "coordinate",
    },
    documentX: window.scrollX + clientX,
    documentY: window.scrollY + clientY,
    x,
    y,
  })
}

function handleDocumentClick(event: MouseEvent) {
  try {
    const element = resolveInspectableElement(event.target)

    if (currentMode !== "comment") {
      if (!element || !isInteractiveElement(element)) return
      event.preventDefault()
      event.stopPropagation()
      const href = element?.closest("a[href]")?.getAttribute("href")
      if (href) {
        ipcRenderer.sendToHost("preview:navigation-blocked", {
          href,
        })
      }
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (!element) {
      sendCoordinateCommentTarget(event.clientX, event.clientY)
      return
    }

    const x = clamp((event.clientX / Math.max(window.innerWidth, 1)) * 100, 0, 100)
    const y = clamp((event.clientY / Math.max(window.innerHeight, 1)) * 100, 0, 100)

    const rect = element.getBoundingClientRect()

    ipcRenderer.sendToHost("preview:comment-target", {
      anchor: {
        type: "element",
        label: formatElementLabel(element),
        offsetX: rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0.5,
        offsetY: rect.height > 0 ? clamp((event.clientY - rect.top) / rect.height, 0, 1) : 0.5,
        path: buildElementPath(element),
        rect: {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
        },
        selector: buildElementSelector(element),
        tagName: element.tagName.toLowerCase(),
        text: getElementText(element),
      },
      documentX: window.scrollX + event.clientX,
      documentY: window.scrollY + event.clientY,
      x,
      y,
    })
  } catch (error) {
    reportPreviewError(error)
  }
}

function handleDocumentSubmit(event: Event) {
  event.preventDefault()
  event.stopPropagation()
}

function handleDocumentKeyDown(event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== " ") return

  const element = resolveInspectableElement(event.target)
  if (!element || !isInteractiveElement(element)) return

  event.preventDefault()
  event.stopPropagation()
}

function handleDocumentMouseMove(event: MouseEvent) {
  try {
    highlightElement(resolveInspectableElement(event.target), {
      clientX: event.clientX,
      clientY: event.clientY,
    })
  } catch (error) {
    reportPreviewError(error)
  }
}

window.addEventListener("DOMContentLoaded", () => {
  cleanupPreviewGuest()
  getHighlightElement()
  ensureFitStyle()
  document.addEventListener("click", handleDocumentClick, true)
  document.addEventListener("submit", handleDocumentSubmit, true)
  document.addEventListener("keydown", handleDocumentKeyDown, true)
  document.addEventListener("mousemove", handleDocumentMouseMove, true)
  fitResizeObserver?.disconnect()
  fitResizeObserver = new ResizeObserver(() => {
    scheduleAutoFit()
  })
  fitResizeObserver.observe(document.documentElement)
  if (document.body) {
    fitResizeObserver.observe(document.body)
  }
  scheduleAutoFit()
  scheduleDelayedAutoFit(120)
  scheduleDelayedAutoFit(360)
  renderPreviewMarkers()
  sendPageMeta()
  ipcRenderer.sendToHost("preview:ready")
})

window.addEventListener("load", () => {
  scheduleAutoFit()
  renderPreviewMarkers()
  sendPageMeta()
})

window.addEventListener("resize", () => {
  scheduleAutoFit()
  renderPreviewMarkers()
})
window.addEventListener("pagehide", cleanupPreviewGuest)
document.addEventListener("scroll", renderPreviewMarkers, true)

ipcRenderer.on("preview:set-mode", (_event, payload: { mode?: PreviewMode } | undefined) => {
  currentMode = payload?.mode === "comment" ? "comment" : "browse"
  if (currentMode !== "comment") {
    hideHighlight()
  }
})

ipcRenderer.on("preview:set-markers", (_event, payload: { markers?: PreviewMarker[] } | undefined) => {
  currentMarkers = Array.isArray(payload?.markers) ? payload.markers : []
  renderPreviewMarkers()
})
