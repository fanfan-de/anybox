import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { createPortal } from "react-dom"
import type {
  SemanticTokenInspection,
  SemanticTokenInspectorBreadcrumb,
  SemanticTokenInspectorPropertyResult,
  SemanticTokenInspectorResolvedColorMode,
  SemanticTokenInspectorSeverity,
} from "../../../../shared/semantic-token-inspector"
import type {
  SemanticTokenAuthoringCapability,
  SemanticTokenAuthoringDraft,
  SemanticTokenBindingEdit,
} from "../../../../shared/semantic-token-authoring"
import type { AppearanceTheme } from "../../../../shared/appearance-themes"
import { CloseIcon, CopyIcon, PlayIcon, SearchIcon } from "../icons"
import { writeTextToClipboard } from "../shared-ui"
import { useToast } from "../toast"
import {
  SemanticTokenAuthoringSessionBar,
  SemanticTokenStyleEditor,
} from "./SemanticTokenStyleEditor"
import { useSemanticTokenAuthoring } from "./use-semantic-token-authoring"

interface SemanticTokenInspectorOverlayProps {
  enabled: boolean
  resolvedColorMode: SemanticTokenInspectorResolvedColorMode
  onEnabledChange: (enabled: boolean) => void
  appearanceThemes?: readonly AppearanceTheme[]
  activeAppearanceThemeID?: string
  onAuthoringCommitted?: (draft: SemanticTokenAuthoringDraft) => void
}

interface InspectorPoint {
  x: number
  y: number
}

interface InspectorBreadcrumbEntry extends SemanticTokenInspectorBreadcrumb {
  depth: number
}

interface PendingSample extends InspectorPoint {
  ancestorDepth: number
}

type InspectorStatus = "off" | "starting" | "active" | "blocked"

const INSPECTOR_SELECTOR = "[data-semantic-token-inspector]"
const SAMPLE_INTERVAL_MS = 80
const TOOLTIP_OFFSET = 14
const VIEWPORT_MARGIN = 8
const HOVER_CARD_WIDTH = 370
const HOVER_CARD_ENTRY_RADIUS = TOOLTIP_OFFSET + 10
const PINNED_CARD_WIDTH = 760
const ALT_CLICK_ARM_MS = 30_000
const NATIVE_ALT_CLICK_GRACE_MS = 1_500
const INSPECTOR_SESSION_BEHAVIOR_VERSION = 2
const INSPECTOR_INPUT_BEHAVIOR_VERSION = 4

const severityOrder: Record<SemanticTokenInspectorSeverity, number> = {
  error: 0,
  warning: 1,
  pass: 2,
  info: 3,
  unknown: 4,
}

function isInspectorTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(INSPECTOR_SELECTOR))
}

function isAltKeyEvent(event: KeyboardEvent) {
  return event.key === "Alt" || event.code === "AltLeft" || event.code === "AltRight"
}

function buildBreadcrumbs(element: Element) {
  const entries: InspectorBreadcrumbEntry[] = []
  let current: Element | null = element
  let depth = 0
  while (current && depth <= 8) {
    entries.push({
      depth,
      tagName: current.tagName.toUpperCase(),
      id: current.id || undefined,
      classes: Array.from(current.classList).slice(0, 4),
    })
    current = current.parentElement
    depth += 1
  }
  return entries
}

function breadcrumbLabel(entry: SemanticTokenInspectorBreadcrumb) {
  const id = entry.id ? `#${entry.id}` : ""
  const classes = entry.classes.length > 0 ? `.${entry.classes.join(".")}` : ""
  return `${entry.tagName.toLowerCase()}${id}${classes}`
}

function targetLabel(inspection: SemanticTokenInspection) {
  return breadcrumbLabel(inspection.target)
}

function inspectionColorChannels(inspection: SemanticTokenInspection) {
  return Array.isArray(inspection.channels) ? inspection.channels : []
}

function cardPosition(
  point: InspectorPoint,
  pinned: boolean,
): CSSProperties {
  const width = pinned
    ? Math.min(PINNED_CARD_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
    : HOVER_CARD_WIDTH
  const estimatedHeight = pinned ? Math.min(window.innerHeight * 0.88, 760) : 250
  let left = point.x + TOOLTIP_OFFSET
  let top = point.y + TOOLTIP_OFFSET
  if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
    left = Math.max(VIEWPORT_MARGIN, point.x - width - TOOLTIP_OFFSET)
  }
  if (top + estimatedHeight > window.innerHeight - VIEWPORT_MARGIN) {
    top = Math.max(VIEWPORT_MARGIN, point.y - estimatedHeight - TOOLTIP_OFFSET)
  }
  return { left, top, width }
}

function sourceLabel(property: SemanticTokenInspectorPropertyResult) {
  const source = property.source
  if (!source) return "Computed style only"
  const location = source.sourceURL
    ? `${source.sourceURL}${source.line ? `:${source.line}${source.column ? `:${source.column}` : ""}` : ""}`
    : source.line
      ? `inline:${source.line}${source.column ? `:${source.column}` : ""}`
      : "inline style"
  return `${source.selector} · ${location}`
}

function propertyCopyText(property: SemanticTokenInspectorPropertyResult) {
  const declaration = property.authoredProperty && property.authoredValue
    ? `${property.authoredProperty}: ${property.authoredValue}${property.source?.important ? " !important" : ""};`
    : `${property.property}: ${property.computedValue};`
  return [
    declaration,
    `computed: ${property.computedValue}`,
    `source: ${sourceLabel(property)}`,
    ...property.tokens.map((token) => `${"  ".repeat(token.depth)}${token.name}${token.value ? ` = ${token.value}` : ""}`),
  ].join("\n")
}

function canPreviewColor(property: SemanticTokenInspectorPropertyResult) {
  return (
    property.property.includes("color") ||
    property.property === "fill" ||
    property.property === "stroke"
  ) && Boolean(property.computedValue)
}

function sortedProperties(inspection: SemanticTokenInspection) {
  return [...inspection.properties].sort((left, right) => {
    const severityDifference = severityOrder[left.severity] - severityOrder[right.severity]
    if (severityDifference !== 0) return severityDifference
    return left.property.localeCompare(right.property)
  })
}

function SeverityBadge({ severity }: { severity: SemanticTokenInspectorSeverity }) {
  const label = severity === "pass"
    ? "合规"
    : severity === "warning"
      ? "警告"
      : severity === "error"
        ? "错误"
        : severity === "info"
          ? "信息"
          : "待确认"
  return <span className={`semantic-token-inspector-severity is-${severity}`}>{label}</span>
}

function PropertySummary({
  property,
  onSelect,
}: {
  property: SemanticTokenInspectorPropertyResult
  onSelect: (property: SemanticTokenInspectorPropertyResult) => void
}) {
  return (
    <button
      className="semantic-token-inspector-property-summary"
      type="button"
      onClick={() => onSelect(property)}
    >
      <span
        className="semantic-token-inspector-swatch"
        style={canPreviewColor(property) ? { backgroundColor: property.computedValue } : undefined}
        aria-hidden="true"
      />
      <span className="semantic-token-inspector-property-name">{property.property}</span>
      <code>{property.tokens[0]?.name ?? property.authoredValue ?? property.computedValue}</code>
      <SeverityBadge severity={property.severity} />
    </button>
  )
}

function PropertyDetail({
  property,
  onCopy,
}: {
  property: SemanticTokenInspectorPropertyResult
  onCopy: (text: string, label: string) => void
}) {
  const source = sourceLabel(property)
  return (
    <section className={`semantic-token-inspector-property is-${property.severity}`}>
      <header>
        <span
          className="semantic-token-inspector-swatch"
          style={canPreviewColor(property) ? { backgroundColor: property.computedValue } : undefined}
          aria-hidden="true"
        />
        <strong>{property.property}</strong>
        <SeverityBadge severity={property.severity} />
        <button
          className="semantic-token-inspector-icon-button"
          type="button"
          aria-label={`Copy ${property.property} inspection`}
          title="Copy property inspection"
          onClick={() => onCopy(propertyCopyText(property), property.property)}
        >
          <CopyIcon />
        </button>
      </header>
      <p className="semantic-token-inspector-summary">{property.summary}</p>
      <dl>
        <div>
          <dt>声明</dt>
          <dd>
            <code>
              {property.authoredProperty && property.authoredValue
                ? `${property.authoredProperty}: ${property.authoredValue}${property.source?.important ? " !important" : ""}`
                : "—"}
            </code>
          </dd>
        </div>
        <div>
          <dt>计算值</dt>
          <dd><code>{property.computedValue || "—"}</code></dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd>
            <button
              className="semantic-token-inspector-copy-field"
              type="button"
              onClick={() => onCopy(source, "source")}
              title="Copy selector and source"
            >
              {source}
            </button>
          </dd>
        </div>
        <div>
          <dt>可信度</dt>
          <dd>{property.confidence}{property.scope !== "direct" ? ` · ${property.scope}` : ""}</dd>
        </div>
      </dl>
      {property.tokens.length > 0 ? (
        <div className="semantic-token-inspector-token-chain">
          <span className="label">Token chain</span>
          {property.tokens.map((token, index) => (
            <button
              key={`${token.name}-${token.depth}-${index}`}
              className={`semantic-token-inspector-token is-${token.kind}`}
              style={{ "--semantic-token-depth": token.depth } as CSSProperties}
              type="button"
              onClick={() => onCopy(token.name, "token")}
              title={`Copy ${token.name}`}
            >
              <code>{token.name}</code>
              {token.value ? <span>{token.value}</span> : null}
              {token.cycle ? <em>cycle</em> : token.unresolved ? <em>unresolved</em> : null}
            </button>
          ))}
        </div>
      ) : null}
      {property.candidates && property.candidates.length > 1 ? (
        <details className="semantic-token-inspector-candidates">
          <summary>Matched candidates</summary>
          {property.candidates.map((candidate, index) => (
            <code key={`${candidate.selector}-${index}`}>
              {candidate.selector}
              {candidate.sourceURL ? ` · ${candidate.sourceURL}:${candidate.line ?? 1}` : ""}
            </code>
          ))}
        </details>
      ) : null}
    </section>
  )
}

export function SemanticTokenInspectorOverlay({
  enabled,
  resolvedColorMode,
  onEnabledChange,
  appearanceThemes,
  activeAppearanceThemeID,
  onAuthoringCommitted,
}: SemanticTokenInspectorOverlayProps) {
  const toast = useToast()
  const [status, setStatus] = useState<InspectorStatus>("off")
  const [inspection, setInspection] = useState<SemanticTokenInspection | null>(null)
  const [point, setPoint] = useState<InspectorPoint>({ x: 24, y: 24 })
  const [breadcrumbs, setBreadcrumbs] = useState<InspectorBreadcrumbEntry[]>([])
  const [ancestorDepth, setAncestorDepth] = useState(0)
  const [pinned, setPinned] = useState(false)
  const [altClickArmed, setAltClickArmed] = useState(false)
  const [authoringCapability, setAuthoringCapability] =
    useState<SemanticTokenAuthoringCapability | null>(null)
  const [activeTab, setActiveTab] = useState<"style" | "inspect">("style")
  const [selectedChannelID, setSelectedChannelID] = useState<string | null>(null)
  const [targetElement, setTargetElement] = useState<Element | null>(null)
  const authoring = useSemanticTokenAuthoring({
    capability: authoringCapability,
    resolvedColorMode,
  })

  const onEnabledChangeRef = useRef(onEnabledChange)
  const resolvedColorModeRef = useRef(resolvedColorMode)
  const toastRef = useRef(toast)
  const pointRef = useRef(point)
  const breadcrumbsRef = useRef(breadcrumbs)
  const pinnedRef = useRef(pinned)
  const ancestorDepthRef = useRef(ancestorDepth)
  const inspectionRef = useRef(inspection)
  const targetElementRef = useRef<Element | null>(targetElement)
  const baseTargetElementRef = useRef<Element | null>(targetElement)
  const requestExitRef = useRef<() => void>(() => onEnabledChange(false))
  const pendingVerificationRef = useRef<{
    bindings: readonly SemanticTokenBindingEdit[]
    attempts: number
    armed: boolean
  } | null>(null)
  const queueSampleRef = useRef<((sample: PendingSample) => void) | null>(null)
  const altPressedRef = useRef(false)
  const altClickArmedUntilRef = useRef(0)

  onEnabledChangeRef.current = onEnabledChange
  resolvedColorModeRef.current = resolvedColorMode
  toastRef.current = toast
  pointRef.current = point
  breadcrumbsRef.current = breadcrumbs
  pinnedRef.current = pinned
  ancestorDepthRef.current = ancestorDepth
  inspectionRef.current = inspection
  targetElementRef.current = targetElement
  requestExitRef.current = () => {
    if (
      authoring.changeCount > 0 &&
      !window.confirm("存在未保存的 Semantic Token 设计修改。确定放弃并退出 Inspector 吗？")
    ) {
      return
    }
    authoring.discard()
    onEnabledChangeRef.current(false)
  }

  const sessionBehaviorKey = `${enabled}:${INSPECTOR_SESSION_BEHAVIOR_VERSION}`

  useEffect(() => {
    if (!enabled) {
      setStatus("off")
      setInspection(null)
      setPinned(false)
      setAuthoringCapability(null)
      setTargetElement(null)
      baseTargetElementRef.current = null
      setSelectedChannelID(null)
      setActiveTab("style")
      authoring.discard()
      altPressedRef.current = false
      altClickArmedUntilRef.current = 0
      setAltClickArmed(false)
      return
    }

    const start = window.desktop?.startSemanticTokenInspector
    const stop = window.desktop?.stopSemanticTokenInspector
    if (!start || !stop) {
      setStatus("blocked")
      toastRef.current.error("Semantic Token Inspector is unavailable because the desktop preload bridge is missing.")
      onEnabledChangeRef.current(false)
      return
    }

    let disposed = false
    let active = false
    let startTimerID: number | null = null
    setStatus("starting")
    const unsubscribe = window.desktop?.onSemanticTokenInspectorEvent?.((event) => {
      if (disposed) return
      if (event.type === "pin-current") {
        if (pinnedRef.current || !inspectionRef.current) return
        altClickArmedUntilRef.current = performance.now() + NATIVE_ALT_CLICK_GRACE_MS
        setAltClickArmed(false)
        pinnedRef.current = true
        setPinned(true)
        setActiveTab("style")
        setSelectedChannelID(inspectionColorChannels(inspectionRef.current)[0]?.id ?? null)
        queueSampleRef.current?.({ ...pointRef.current, ancestorDepth: ancestorDepthRef.current })
        return
      }
      active = false
      setStatus("blocked")
      setInspection(null)
      setPinned(false)
      setAuthoringCapability(null)
      authoring.discard()
      toastRef.current.error(event.message)
      onEnabledChangeRef.current(false)
    })

    startTimerID = window.setTimeout(() => {
      startTimerID = null
      void start()
        .then((result) => {
          if (disposed) {
            if (result.status === "active") void stop()
            return
          }
          if (result.status === "active") {
            active = true
            setStatus("active")
            setAuthoringCapability(result.authoring ?? {
              status: "read-only",
              reason: "source-root-unavailable",
              message: "当前 Inspector 会话只读。",
            })
            return
          }
          setStatus("blocked")
          toastRef.current.error(result.message)
          onEnabledChangeRef.current(false)
        })
        .catch((error: unknown) => {
          if (disposed) return
          setStatus("blocked")
          toastRef.current.error(`Unable to start Semantic Token Inspector: ${error instanceof Error ? error.message : String(error)}`)
          onEnabledChangeRef.current(false)
        })
    }, 0)

    return () => {
      disposed = true
      if (startTimerID !== null) window.clearTimeout(startTimerID)
      unsubscribe?.()
      queueSampleRef.current = null
      if (active) void stop().catch(() => undefined)
    }
  }, [sessionBehaviorKey])

  const inputBehaviorKey = `${status}:${INSPECTOR_INPUT_BEHAVIOR_VERSION}`

  useEffect(() => {
    if (status !== "active") return
    const inspect = window.desktop?.inspectSemanticTokenAtPoint
    if (!inspect) return

    let disposed = false
    let inFlight = false
    let pending: PendingSample | null = null
    let timerID: number | null = null
    let animationFrameID: number | null = null
    let requestID = 0
    let lastRequestTime = 0
    let lastAppliedRequestID = 0

    const requestNext = () => {
      if (disposed || inFlight || !pending) return
      const elapsed = performance.now() - lastRequestTime
      if (elapsed < SAMPLE_INTERVAL_MS) {
        if (timerID === null) {
          timerID = window.setTimeout(() => {
            timerID = null
            requestNext()
          }, SAMPLE_INTERVAL_MS - elapsed)
        }
        return
      }

      const sample = pending
      pending = null
      inFlight = true
      requestID += 1
      const nextRequestID = requestID
      lastRequestTime = performance.now()

      void inspect({
        x: sample.x,
        y: sample.y,
        ancestorDepth: sample.ancestorDepth,
        requestID: nextRequestID,
        resolvedColorMode: resolvedColorModeRef.current,
      })
        .then((result) => {
          if (disposed || result.requestID < lastAppliedRequestID) return
          lastAppliedRequestID = result.requestID
          if (result.status === "ok") {
            setInspection(result.inspection)
            return
          }
          if (result.reason === "target-not-found") {
            setInspection(null)
          }
        })
        .catch(() => {
          if (!disposed) setInspection(null)
        })
        .finally(() => {
          inFlight = false
          requestNext()
        })
    }

    const queueSample = (sample: PendingSample) => {
      pending = sample
      if (animationFrameID !== null) return
      animationFrameID = window.requestAnimationFrame(() => {
        animationFrameID = null
        requestNext()
      })
    }
    queueSampleRef.current = queueSample

    const handlePointerMove = (event: PointerEvent) => {
      if (pinnedRef.current || isInspectorTarget(event.target)) return
      if (
        inspectionRef.current &&
        Math.hypot(event.clientX - pointRef.current.x, event.clientY - pointRef.current.y) <= HOVER_CARD_ENTRY_RADIUS
      ) {
        return
      }
      const target = document.elementFromPoint(event.clientX, event.clientY)
      if (!target || isInspectorTarget(target)) return
      const nextPoint = { x: event.clientX, y: event.clientY }
      const nextBreadcrumbs = buildBreadcrumbs(target)
      baseTargetElementRef.current = target
      targetElementRef.current = target
      setTargetElement(target)
      pointRef.current = nextPoint
      breadcrumbsRef.current = nextBreadcrumbs
      ancestorDepthRef.current = 0
      setPoint(nextPoint)
      setBreadcrumbs(nextBreadcrumbs)
      setAncestorDepth(0)
      queueSample({ ...nextPoint, ancestorDepth: 0 })
    }

    let suppressPinClick = false
    let suppressPinClickTimerID: number | null = null
    let altClickArmTimerID: number | null = null

    const clearPinClickTimer = () => {
      if (suppressPinClickTimerID === null) return
      window.clearTimeout(suppressPinClickTimerID)
      suppressPinClickTimerID = null
    }

    const disarmAltClick = () => {
      altClickArmedUntilRef.current = 0
      setAltClickArmed(false)
      if (altClickArmTimerID !== null) {
        window.clearTimeout(altClickArmTimerID)
        altClickArmTimerID = null
      }
    }

    const armAltClick = () => {
      altClickArmedUntilRef.current = performance.now() + ALT_CLICK_ARM_MS
      setAltClickArmed(true)
      if (altClickArmTimerID !== null) window.clearTimeout(altClickArmTimerID)
      altClickArmTimerID = window.setTimeout(() => {
        altClickArmedUntilRef.current = 0
        setAltClickArmed(false)
        altClickArmTimerID = null
      }, ALT_CLICK_ARM_MS)
    }

    const pinAtPoint = (event: MouseEvent | PointerEvent) => {
      const target = event.target instanceof Element
        ? event.target
        : document.elementFromPoint(event.clientX, event.clientY)
      if (!target || isInspectorTarget(target)) return false

      const nextPoint = { x: event.clientX, y: event.clientY }
      const nextBreadcrumbs = buildBreadcrumbs(target)
      baseTargetElementRef.current = target
      targetElementRef.current = target
      setTargetElement(target)
      pointRef.current = nextPoint
      breadcrumbsRef.current = nextBreadcrumbs
      ancestorDepthRef.current = 0
      pinnedRef.current = true
      setPoint(nextPoint)
      setBreadcrumbs(nextBreadcrumbs)
      setAncestorDepth(0)
      setPinned(true)
      setActiveTab("style")
      setSelectedChannelID(null)
      queueSample({ ...nextPoint, ancestorDepth: 0 })
      return true
    }

    const handlePointerDown = (event: PointerEvent) => {
      const altIsPressed = event.altKey ||
        event.getModifierState("Alt") ||
        altPressedRef.current ||
        performance.now() <= altClickArmedUntilRef.current
      if (!altIsPressed || event.button !== 0 || isInspectorTarget(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      clearPinClickTimer()
      suppressPinClick = pinAtPoint(event)
      disarmAltClick()
    }

    const handlePointerUp = () => {
      if (!suppressPinClick) return
      clearPinClickTimer()
      suppressPinClickTimerID = window.setTimeout(() => {
        suppressPinClick = false
        suppressPinClickTimerID = null
      }, 0)
    }

    const handleClick = (event: MouseEvent) => {
      const altIsPressed = event.altKey ||
        event.getModifierState("Alt") ||
        altPressedRef.current ||
        performance.now() <= altClickArmedUntilRef.current
      const shouldPin = altIsPressed && event.button === 0 && !isInspectorTarget(event.target)
      if (!suppressPinClick && !shouldPin) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      clearPinClickTimer()
      if (suppressPinClick) {
        suppressPinClick = false
        return
      }
      pinAtPoint(event)
      disarmAltClick()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isAltKeyEvent(event)) {
        altPressedRef.current = true
        if (pinnedRef.current) return
        armAltClick()
        if (inspectionRef.current) {
          pinnedRef.current = true
          setPinned(true)
          queueSample({ ...pointRef.current, ancestorDepth: ancestorDepthRef.current })
          disarmAltClick()
        }
        return
      }
      if (event.key !== "Escape") return
      if (
        document.querySelector(".semantic-token-authoring-modal-backdrop") ||
        document.querySelector(".settings-theme-color-popover") ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      requestExitRef.current()
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isAltKeyEvent(event)) altPressedRef.current = false
    }

    const handleWindowBlur = () => {
      altPressedRef.current = false
      disarmAltClick()
      suppressPinClick = false
      clearPinClickTimer()
    }

    const reInspectCurrentTarget = () => {
      if (!inspectionRef.current) return
      queueSample({ ...pointRef.current, ancestorDepth: ancestorDepthRef.current })
    }

    document.addEventListener("pointermove", handlePointerMove, true)
    document.addEventListener("pointerdown", handlePointerDown, true)
    document.addEventListener("pointerup", handlePointerUp, true)
    document.addEventListener("pointercancel", handlePointerUp, true)
    document.addEventListener("click", handleClick, true)
    window.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener("keyup", handleKeyUp, true)
    window.addEventListener("blur", handleWindowBlur)
    window.addEventListener("scroll", reInspectCurrentTarget, true)
    window.addEventListener("resize", reInspectCurrentTarget)

    return () => {
      disposed = true
      queueSampleRef.current = null
      document.removeEventListener("pointermove", handlePointerMove, true)
      document.removeEventListener("pointerdown", handlePointerDown, true)
      document.removeEventListener("pointerup", handlePointerUp, true)
      document.removeEventListener("pointercancel", handlePointerUp, true)
      document.removeEventListener("click", handleClick, true)
      window.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener("keyup", handleKeyUp, true)
      window.removeEventListener("blur", handleWindowBlur)
      window.removeEventListener("scroll", reInspectCurrentTarget, true)
      window.removeEventListener("resize", reInspectCurrentTarget)
      clearPinClickTimer()
      if (altClickArmTimerID !== null) window.clearTimeout(altClickArmTimerID)
      altPressedRef.current = false
      altClickArmedUntilRef.current = 0
      setAltClickArmed(false)
      if (timerID !== null) window.clearTimeout(timerID)
      if (animationFrameID !== null) window.cancelAnimationFrame(animationFrameID)
    }
  }, [inputBehaviorKey])

  useEffect(() => {
    if (status !== "active" || !inspectionRef.current) return
    queueSampleRef.current?.({ ...pointRef.current, ancestorDepth: ancestorDepthRef.current })
  }, [resolvedColorMode, status])

  const handleCopy = useCallback((text: string, label: string) => {
    void writeTextToClipboard(text)
      .then(() => toastRef.current.success(`Copied ${label}.`))
      .catch((error: unknown) => {
        toastRef.current.error(`Unable to copy ${label}: ${error instanceof Error ? error.message : String(error)}`)
      })
  }, [])

  const syncTargetAtCurrentPoint = useCallback(() => {
    const currentPoint = pointRef.current
    const nextTarget = document.elementFromPoint(currentPoint.x, currentPoint.y)
    if (!nextTarget || isInspectorTarget(nextTarget)) return
    const nextBreadcrumbs = buildBreadcrumbs(nextTarget)
    baseTargetElementRef.current = nextTarget
    targetElementRef.current = nextTarget
    breadcrumbsRef.current = nextBreadcrumbs
    setTargetElement(nextTarget)
    setBreadcrumbs(nextBreadcrumbs)
  }, [])

  const handleBreadcrumbSelect = useCallback((depth: number) => {
    ancestorDepthRef.current = depth
    setAncestorDepth(depth)
    let nextTarget = baseTargetElementRef.current
    for (let index = 0; index < depth && nextTarget; index += 1) {
      nextTarget = nextTarget.parentElement
    }
    targetElementRef.current = nextTarget
    setTargetElement(nextTarget)
    queueSampleRef.current?.({ ...pointRef.current, ancestorDepth: depth })
  }, [])

  const handleResume = useCallback(() => {
    pinnedRef.current = false
    ancestorDepthRef.current = 0
    setPinned(false)
    setAncestorDepth(0)
  }, [])

  const handlePinCurrent = useCallback(() => {
    if (!inspectionRef.current) return
    syncTargetAtCurrentPoint()
    altClickArmedUntilRef.current = 0
    setAltClickArmed(false)
    pinnedRef.current = true
    setPinned(true)
    setActiveTab("style")
    setSelectedChannelID(inspectionColorChannels(inspectionRef.current)[0]?.id ?? null)
    queueSampleRef.current?.({ ...pointRef.current, ancestorDepth: ancestorDepthRef.current })
  }, [syncTargetAtCurrentPoint])

  const handlePropertySelect = useCallback((property: SemanticTokenInspectorPropertyResult) => {
    if (!inspectionRef.current) return
    syncTargetAtCurrentPoint()
    pinnedRef.current = true
    setPinned(true)
    setActiveTab("style")
    const channels = inspectionColorChannels(inspectionRef.current)
    const channel = channels.find((candidate) =>
      candidate.cssProperty === property.property,
    )
    setSelectedChannelID(channel?.id ?? channels[0]?.id ?? null)
    queueSampleRef.current?.({ ...pointRef.current, ancestorDepth: ancestorDepthRef.current })
  }, [syncTargetAtCurrentPoint])

  useEffect(() => {
    if (!pinned || !inspection) return
    const channels = inspectionColorChannels(inspection)
    if (channels.length === 0) return
    if (!channels.some((channel) => channel.id === selectedChannelID)) {
      setSelectedChannelID(channels[0].id)
    }
  }, [inspection, pinned, selectedChannelID])

  const handleAuthoringCommitted = useCallback((draft: SemanticTokenAuthoringDraft) => {
    const bindings = draft.operations.filter(
      (operation): operation is SemanticTokenBindingEdit => operation.kind === "binding-edit",
    )
    onAuthoringCommitted?.(draft)
    pendingVerificationRef.current = { bindings, attempts: 0, armed: false }
    toastRef.current.success("Semantic Token 修改已写回源码，正在等待 Vite HMR。")
    window.setTimeout(() => {
      const pending = pendingVerificationRef.current
      if (!pending) return
      pending.armed = true
      pending.attempts += 1
      queueSampleRef.current?.({ ...pointRef.current, ancestorDepth: ancestorDepthRef.current })
    }, 700)
  }, [onAuthoringCommitted])

  useEffect(() => {
    const pending = pendingVerificationRef.current
    if (!inspection || !pending?.armed || pending.bindings.length === 0) return
    const verified = pending.bindings.every((binding) => {
      const property = inspection.properties.find((candidate) =>
        candidate.property === binding.cssProperty,
      )
      return property?.tokens.some((token) =>
        token.kind === "semantic-runtime" &&
        token.name.replace(/^--/, "") === binding.runtimeToken,
      )
    })
    if (verified) {
      pendingVerificationRef.current = null
      toastRef.current.success("HMR 后已重新确认目标 selector 使用所选 Semantic Token。")
      return
    }
    if (pending.attempts >= 3) {
      pendingVerificationRef.current = null
      toastRef.current.info("源码已写回，但 HMR 验证超时；请手动 reload 后重新检查。")
      return
    }
    pending.armed = false
    window.setTimeout(() => {
      const current = pendingVerificationRef.current
      if (!current) return
      current.armed = true
      current.attempts += 1
      queueSampleRef.current?.({ ...pointRef.current, ancestorDepth: ancestorDepthRef.current })
    }, 900)
  }, [inspection])

  const visibleProperties = useMemo(
    () => inspection ? sortedProperties(inspection) : [],
    [inspection],
  )

  if (!enabled || status === "off" || typeof document === "undefined") return null

  const selectedBreadcrumb = breadcrumbs.find((entry) => entry.depth === ancestorDepth)
  const position = cardPosition(point, pinned)
  const quad = inspection?.target.borderQuad
  const polygonPoints = quad && quad.length >= 8
    ? `${quad[0]},${quad[1]} ${quad[2]},${quad[3]} ${quad[4]},${quad[5]} ${quad[6]},${quad[7]}`
    : null

  return createPortal(
    <div
      className={`semantic-token-inspector-overlay is-${status}${pinned ? " is-pinned" : ""}`}
      data-semantic-token-inspector
    >
      <div className="semantic-token-inspector-live" aria-live="polite" aria-atomic="true">
        {inspection ? `${targetLabel(inspection)} inspected` : status === "starting" ? "Starting Semantic Token Inspector" : ""}
      </div>
      <button
        className="semantic-token-inspector-status"
        type="button"
        onClick={() => requestExitRef.current()}
        title="Exit Semantic Token Inspector"
      >
        <SearchIcon />
        <span>Token Inspector</span>
        <kbd className={altClickArmed ? "is-armed" : undefined}>
          {altClickArmed ? "点击界面固定" : "Alt 固定当前"}
        </kbd>
        <kbd>Esc 退出</kbd>
      </button>
      {polygonPoints ? (
        <svg className="semantic-token-inspector-highlight" aria-hidden="true">
          <polygon points={polygonPoints} />
        </svg>
      ) : null}
      {inspection ? (
        <aside
          className={pinned ? "semantic-token-inspector-card is-pinned" : "semantic-token-inspector-card"}
          style={position}
          role={pinned ? "dialog" : "region"}
          aria-label={pinned ? "Semantic token inspection details" : "Semantic token inspection"}
        >
          <header className="semantic-token-inspector-card-header">
            <div>
              <span className="label">{pinned ? "Semantic Token Editor" : "Hover inspection"}</span>
              <strong>{targetLabel(inspection)}</strong>
            </div>
            {pinned ? (
              <div className="semantic-token-inspector-card-actions">
                <button
                  className="semantic-token-inspector-icon-button"
                  type="button"
                  onClick={handleResume}
                  title="Resume hover inspection"
                  aria-label="Resume hover inspection"
                >
                  <PlayIcon />
                </button>
                <button
                  className="semantic-token-inspector-icon-button"
                  type="button"
                  onClick={() => requestExitRef.current()}
                  title="Exit inspector"
                  aria-label="Exit Semantic Token Inspector"
                >
                  <CloseIcon />
                </button>
              </div>
            ) : null}
          </header>
          {selectedBreadcrumb && pinned ? (
            <details className="semantic-token-inspector-target-context">
              <summary>
                <span>当前元素</span>
                <code title={breadcrumbLabel(selectedBreadcrumb)}>
                  {breadcrumbLabel(selectedBreadcrumb)}
                </code>
                <small>
                  {ancestorDepth > 0 ? `父级 ${ancestorDepth}` : `${breadcrumbs.length} 层路径`}
                </small>
              </summary>
              <nav className="semantic-token-inspector-breadcrumbs" aria-label="DOM ancestors">
                {[...breadcrumbs].reverse().map((entry) => (
                  <button
                    key={`${entry.depth}-${breadcrumbLabel(entry)}`}
                    className={entry.depth === ancestorDepth ? "is-current" : ""}
                    type="button"
                    onClick={() => handleBreadcrumbSelect(entry.depth)}
                    title={breadcrumbLabel(entry)}
                  >
                    {breadcrumbLabel(entry)}
                  </button>
                ))}
              </nav>
            </details>
          ) : null}
          {pinned ? (
            <>
              <div className="semantic-token-inspector-tabs" role="tablist" aria-label="Inspector view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "style"}
                  className={activeTab === "style" ? "is-active" : ""}
                  onClick={() => setActiveTab("style")}
                >
                  样式
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "inspect"}
                  className={activeTab === "inspect" ? "is-active" : ""}
                  onClick={() => setActiveTab("inspect")}
                >
                  检查
                </button>
              </div>
              <SemanticTokenAuthoringSessionBar controller={authoring} />
              {activeTab === "style" ? (
                <SemanticTokenStyleEditor
                  capability={authoringCapability}
                  inspection={inspection}
                  targetElement={targetElement}
                  selectedChannelID={selectedChannelID}
                  onSelectedChannelChange={setSelectedChannelID}
                  controller={authoring}
                  appearanceThemes={appearanceThemes}
                  activeAppearanceThemeID={activeAppearanceThemeID}
                  onCommitted={handleAuthoringCommitted}
                />
              ) : (
                <div className="semantic-token-inspector-property-list">
                  {visibleProperties.length > 0 ? visibleProperties.map((property) => (
                    <PropertyDetail
                      key={property.property}
                      property={property}
                      onCopy={handleCopy}
                    />
                  )) : (
                    <p className="semantic-token-inspector-empty">No relevant color declarations were found on this element.</p>
                  )}
                  {inspection.warnings.length > 0 ? (
                    <ul className="semantic-token-inspector-warnings">
                      {inspection.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="semantic-token-inspector-hover-list">
                {visibleProperties.slice(0, 4).map((property) => (
                  <PropertySummary
                    key={property.property}
                    property={property}
                    onSelect={handlePropertySelect}
                  />
                ))}
              </div>
              {visibleProperties.length > 4 ? (
                <span className="semantic-token-inspector-more">+{visibleProperties.length - 4} more</span>
              ) : null}
              <div className="semantic-token-inspector-hover-footer">
                <p className="semantic-token-inspector-hint">
                  普通点击可操作界面 · Alt 固定当前悬停项
                </p>
                <button
                  className="semantic-token-inspector-pin-button"
                  type="button"
                  onClick={handlePinCurrent}
                >
                  固定详情
                </button>
              </div>
            </>
          )}
        </aside>
      ) : status === "active" ? (
        <div className="semantic-token-inspector-empty-card" style={position} role="status">
          Move the pointer over an interface element.
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
