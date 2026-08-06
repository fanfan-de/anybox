import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
import {
  COMPANION_MIN_PRIMARY_RATIO,
  DEFAULT_COMPANION_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_TOOL_COMPANION_WIDTH,
  MIN_WORKBENCH_COMPANION_WIDTH,
  SIDEBAR_KEYBOARD_STEP,
  SIDEBAR_RESIZER_WIDTH,
} from "./constants"
import {
  DEFAULT_ASSISTANT_TRACE_VISIBILITY,
  type AssistantTraceVisibility,
  type AssistantTraceVisibilityKey,
  type WindowAction,
} from "./types"
import { clamp, resolveRightSidebarWidthBounds, resolveSidebarWidthBounds } from "./utils"
import { SIDEBAR_RESIZE_END_EVENT, SIDEBAR_RESIZE_START_EVENT } from "./sidebar-resize-events"
import { useAppearanceState } from "./use-appearance-state"
import {
  beginRendererInteractiveLayout,
  endRendererInteractiveLayout,
  flushRendererFrameNow,
  queueRendererLayoutWrite,
  type RendererFrameTaskCancel,
} from "./renderer-frame-coordinator"
import { useDesktopRuntimeCapabilities } from "./runtime-capabilities"
import {
  DEFAULT_SHELL_LAYOUT_MODE,
  SHELL_LAYOUT_MODE_STORAGE_KEY,
  readShellLayoutMode,
  type ShellLayoutMode,
} from "./shell-layout"

const ACTIVITY_RAIL_VISIBILITY_STORAGE_KEY = "desktop.activityRailVisible"
const DEBUG_UI_REGIONS_STORAGE_KEY = "desktop.debugUiRegions"
const DEBUG_LINE_COLORS_STORAGE_KEY = "desktop.debugLineColors"
const SEMANTIC_TOKEN_INSPECTOR_STORAGE_KEY = "desktop.semanticTokenInspector"
const MOBILE_CONNECTION_ADVANCED_INFO_STORAGE_KEY = "desktop.mobileConnectionAdvancedInfo"
const AGENT_DEBUG_TRACE_STORAGE_KEY = "desktop.agentDebugTrace"
const ASSISTANT_TRACE_VISIBILITY_STORAGE_KEY = "desktop.assistantTraceVisibility.v1"
const WINDOW_CONTROLS_CLEARANCE_FALLBACK = 124
const WINDOW_CONTROLS_CLEARANCE_PADDING = 24

type SidebarResizerSide = "left" | "right"

interface ActivePointerCapture {
  element: HTMLDivElement
  pointerId: number
}

interface ActiveSidebarResize {
  appShell: HTMLElement
  bounds: {
    max: number
    min: number
  }
  containerLeft: number
  containerRight: number
  didCommit: boolean
  latestWidth: number
  leftRailDisplayWidth: number
  originalWidth: number
  pointerOffsetX: number
  previewCancel: RendererFrameTaskCancel | null
  side: SidebarResizerSide
}

function readBooleanPreference(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback

  try {
    const storedValue = window.localStorage.getItem(key)
    if (storedValue === null) return fallback
    return storedValue !== "false"
  } catch {
    return fallback
  }
}

function readActivityRailVisibilityPreference() {
  return readBooleanPreference(ACTIVITY_RAIL_VISIBILITY_STORAGE_KEY, true)
}

function readDebugUiRegionsPreference() {
  return readBooleanPreference(DEBUG_UI_REGIONS_STORAGE_KEY, false)
}

function readDebugLineColorsPreference() {
  return readBooleanPreference(DEBUG_LINE_COLORS_STORAGE_KEY, false)
}

function readSemanticTokenInspectorPreference() {
  return readBooleanPreference(SEMANTIC_TOKEN_INSPECTOR_STORAGE_KEY, false)
}

function readMobileConnectionAdvancedInfoPreference() {
  return readBooleanPreference(MOBILE_CONNECTION_ADVANCED_INFO_STORAGE_KEY, false)
}

function readAgentDebugTracePreference() {
  return readBooleanPreference(AGENT_DEBUG_TRACE_STORAGE_KEY, false)
}

function readStoredShellLayoutMode() {
  if (typeof window === "undefined") return DEFAULT_SHELL_LAYOUT_MODE

  try {
    return readShellLayoutMode(window.localStorage)
  } catch {
    return DEFAULT_SHELL_LAYOUT_MODE
  }
}

function mergeAssistantTraceVisibilityPreference(value: unknown): AssistantTraceVisibility {
  const merged = { ...DEFAULT_ASSISTANT_TRACE_VISIBILITY }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return merged
  }

  for (const key of Object.keys(DEFAULT_ASSISTANT_TRACE_VISIBILITY) as AssistantTraceVisibilityKey[]) {
    if (typeof (value as Record<string, unknown>)[key] === "boolean") {
      merged[key] = (value as Record<string, boolean>)[key]
    }
  }

  return merged
}

function readAssistantTraceVisibilityPreference() {
  if (typeof window === "undefined") {
    return { ...DEFAULT_ASSISTANT_TRACE_VISIBILITY }
  }

  try {
    const storedValue = window.localStorage.getItem(ASSISTANT_TRACE_VISIBILITY_STORAGE_KEY)
    if (storedValue) {
      return mergeAssistantTraceVisibilityPreference(JSON.parse(storedValue))
    }
  } catch {
    // Ignore and fall back to defaults.
  }

  return {
    ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
    debugMetadata: readAgentDebugTracePreference(),
  }
}

export function useDesktopShell() {
  const {
    appearanceAuthoringEnabled,
    developmentFeaturesEnabled,
    runtimeCapabilitiesReady,
  } = useDesktopRuntimeCapabilities()
  const appShellRef = useRef<HTMLElement | null>(null)
  const [windowControlsElement, setWindowControlsElement] = useState<HTMLDivElement | null>(null)
  const windowControlsRef = useCallback((node: HTMLDivElement | null) => {
    setWindowControlsElement((current) => (current === node ? current : node))
  }, [])
  const [platform, setPlatform] = useState(() => (typeof window === "undefined" ? "Desktop" : window.desktop?.platform ?? "Desktop"))
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
  const [windowControlsClearance, setWindowControlsClearance] = useState(WINDOW_CONTROLS_CLEARANCE_FALLBACK)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_COMPANION_WIDTH)
  const [shellLayoutMode, setShellLayoutMode] = useState<ShellLayoutMode>(readStoredShellLayoutMode)
  const [isActivityRailVisible, setIsActivityRailVisible] = useState(readActivityRailVisibilityPreference)
  const appearanceState = useAppearanceState({
    appearanceAuthoringEnabled,
    runtimeCapabilitiesReady,
  })
  const {
    appearanceConfigError,
    appearanceConfigPath,
    appearanceConfigPreview,
    appearanceContrastWarnings,
    appearanceOverrides,
    appearanceThemeError,
    appearanceThemeNotice,
    appearanceThemes,
    activeAppearanceThemeID,
    appearanceTokenValues,
    brandTheme,
    codeThemePreference,
    colorMode,
    fontFamily,
    codeFontFamily,
    handleAppearancePaletteReset,
    handleAppearanceThemeApply,
    handleAppearanceThemeDelete,
    handleAppearanceThemeDuplicate,
    handleAppearanceThemeExportDtcg,
    handleAppearanceThemeImportDtcg,
    handleAppearanceThemeRename,
    handleAppearanceThemeSaveCurrent,
    handleAppearanceTokenChange,
    handleAppearanceTokenReset,
    handleSemanticTokenAuthoringCommitted,
    handleBrandThemeChange,
    handleCodeThemeChange,
    handleColorModeChange,
    handleFontFamilyChange,
    handleCodeFontFamilyChange,
    resolvedColorMode,
    resolvedCodeTheme,
  } = appearanceState
  const [isDebugUiRegionsEnabled, setIsDebugUiRegionsEnabled] = useState(false)
  const [isDebugLineColorsEnabled, setIsDebugLineColorsEnabled] = useState(false)
  const [isSemanticTokenInspectorEnabled, setIsSemanticTokenInspectorEnabled] =
    useState(false)
  const [isMobileConnectionAdvancedInfoEnabled, setIsMobileConnectionAdvancedInfoEnabled] = useState(false)
  const [assistantTraceVisibility, setAssistantTraceVisibility] = useState<AssistantTraceVisibility>({
    ...DEFAULT_ASSISTANT_TRACE_VISIBILITY,
  })
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false)
  const [agentDefaultDirectory, setAgentDefaultDirectory] = useState("")
  const [agentConnected, setAgentConnected] = useState(false)
  const lastExpandedSidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH)
  const lastExpandedRightSidebarWidthRef = useRef(DEFAULT_COMPANION_WIDTH)
  const activeSidebarResizerPointerRef = useRef<ActivePointerCapture | null>(null)
  const activeSidebarResizeRef = useRef<ActiveSidebarResize | null>(null)
  const activeSidebarResizeCleanupRef = useRef<(() => void) | null>(null)
  const isSidebarResizing = false
  const isRightSidebarResizing = false
  const isAgentDebugTraceEnabled = assistantTraceVisibility.debugMetadata

  function getLeftRailDisplayWidth() {
    return isActivityRailVisible ? 54 : 0
  }

  function resolveLeftSidebarBounds(containerWidth?: number) {
    if (!containerWidth || containerWidth <= 0) {
      return resolveSidebarWidthBounds(containerWidth)
    }

    const fixedWidth =
      getLeftRailDisplayWidth() +
      SIDEBAR_RESIZER_WIDTH +
      (isRightSidebarCollapsed ? 0 : rightSidebarWidth + SIDEBAR_RESIZER_WIDTH)

    return resolveSidebarWidthBounds(containerWidth - fixedWidth)
  }

  function resolveRightSidebarBounds(
    containerWidth?: number,
    layoutMode: ShellLayoutMode = shellLayoutMode,
  ) {
    const minWidth = layoutMode === "tools-primary"
      ? MIN_WORKBENCH_COMPANION_WIDTH
      : MIN_TOOL_COMPANION_WIDTH

    return resolveRightSidebarWidthBounds(containerWidth, COMPANION_MIN_PRIMARY_RATIO, minWidth)
  }

  function releaseActiveSidebarResizerPointerCapture() {
    const activePointer = activeSidebarResizerPointerRef.current
    activeSidebarResizerPointerRef.current = null
    if (!activePointer) return

    try {
      if (activePointer.element.hasPointerCapture?.(activePointer.pointerId)) {
        activePointer.element.releasePointerCapture(activePointer.pointerId)
      }
    } catch {
      // Pointer capture is best-effort; losing it should not keep resize active.
    }
  }

  function captureSidebarResizerPointer(event: PointerEvent<HTMLDivElement>) {
    releaseActiveSidebarResizerPointerCapture()

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
      activeSidebarResizerPointerRef.current = {
        element: event.currentTarget,
        pointerId: event.pointerId,
      }
    } catch {
      activeSidebarResizerPointerRef.current = null
    }
  }

  function updateSidebarResizerAriaValue(width: number) {
    activeSidebarResizerPointerRef.current?.element.setAttribute("aria-valuenow", String(Math.round(width)))
  }

  function applySidebarResizePreview(resizeState: ActiveSidebarResize, width: number) {
    const widthValue = `${width}px`
    if (resizeState.side === "left") {
      resizeState.appShell.style.setProperty("--sidebar-display-width", widthValue)
      resizeState.appShell.style.setProperty("--sidebar-width", widthValue)
    } else {
      resizeState.appShell.style.setProperty("--right-sidebar-display-width", widthValue)
      resizeState.appShell.style.setProperty("--right-sidebar-width", widthValue)
      resizeState.appShell.style.setProperty("--companion-region-display-width", widthValue)
      resizeState.appShell.style.setProperty("--companion-region-width", widthValue)
    }
    updateSidebarResizerAriaValue(width)
  }

  function restoreSidebarResizePreview(resizeState: ActiveSidebarResize) {
    applySidebarResizePreview(resizeState, resizeState.originalWidth)
  }

  function clearSidebarResizePreview(resizeState: ActiveSidebarResize) {
    resizeState.previewCancel?.()
    resizeState.previewCancel = null
  }

  function queueSidebarResizePreview(resizeState: ActiveSidebarResize, width: number) {
    if (
      resizeState.previewCancel === null &&
      Math.abs(resizeState.latestWidth - width) < 0.5
    ) {
      return
    }

    resizeState.latestWidth = width
    if (resizeState.previewCancel !== null) return

    resizeState.previewCancel = queueRendererLayoutWrite(`sidebar-resize:${resizeState.side}`, () => {
      resizeState.previewCancel = null
      applySidebarResizePreview(resizeState, resizeState.latestWidth)
    })
  }

  function resolveSidebarResizeLineX(resizeState: ActiveSidebarResize) {
    return resizeState.side === "left"
      ? resizeState.containerLeft + resizeState.leftRailDisplayWidth + resizeState.originalWidth + SIDEBAR_RESIZER_WIDTH
      : resizeState.containerRight - resizeState.originalWidth
  }

  function resolveSidebarResizeWidth(resizeState: ActiveSidebarResize, clientX: number) {
    const lineClientX = clientX - resizeState.pointerOffsetX
    const rawWidth = resizeState.side === "left"
      ? lineClientX - resizeState.containerLeft - resizeState.leftRailDisplayWidth - SIDEBAR_RESIZER_WIDTH
      : resizeState.containerRight - lineClientX

    return clamp(rawWidth, resizeState.bounds.min, resizeState.bounds.max)
  }

  useEffect(() => {
    let mounted = true

    window.desktop
      ?.getInfo()
      .then((info) => {
        if (mounted) setPlatform(info.platform)
      })
      .catch(() => {
        if (mounted && window.desktop?.platform) setPlatform(window.desktop.platform)
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!runtimeCapabilitiesReady) return

    if (!developmentFeaturesEnabled) {
      setIsDebugUiRegionsEnabled(false)
      setIsDebugLineColorsEnabled(false)
      setIsSemanticTokenInspectorEnabled(false)
      setIsMobileConnectionAdvancedInfoEnabled(false)
      setAssistantTraceVisibility({ ...DEFAULT_ASSISTANT_TRACE_VISIBILITY })
      return
    }

    setIsDebugUiRegionsEnabled(readDebugUiRegionsPreference())
    setIsDebugLineColorsEnabled(readDebugLineColorsPreference())
    setIsSemanticTokenInspectorEnabled(readSemanticTokenInspectorPreference())
    setIsMobileConnectionAdvancedInfoEnabled(readMobileConnectionAdvancedInfoPreference())
    setAssistantTraceVisibility(readAssistantTraceVisibilityPreference())
  }, [developmentFeaturesEnabled, runtimeCapabilitiesReady])

  useEffect(() => {
    const controls = windowControlsElement
    if (!controls) return

    const syncWindowControlsClearance = () => {
      const rect = controls.getBoundingClientRect()
      if (rect.width <= 0) return

      const nextClearance = Math.ceil(rect.width) + WINDOW_CONTROLS_CLEARANCE_PADDING
      setWindowControlsClearance((current) => (current === nextClearance ? current : nextClearance))
    }

    syncWindowControlsClearance()

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => {
        syncWindowControlsClearance()
      })
      observer.observe(controls)

      return () => {
        observer.disconnect()
      }
    }

    window.addEventListener("resize", syncWindowControlsClearance)
    return () => {
      window.removeEventListener("resize", syncWindowControlsClearance)
    }
  }, [windowControlsElement])

  useEffect(() => {
    let mounted = true

    window.desktop
      ?.getWindowState?.()
      .then((state) => {
        if (mounted) setIsWindowMaximized(state.isMaximized)
      })
      .catch(() => undefined)

    const unsubscribe = window.desktop?.onWindowStateChange?.((state) => {
      if (mounted) setIsWindowMaximized(state.isMaximized)
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const configPromise = window.desktop?.getAgentConfig
      ? window.desktop.getAgentConfig().catch(() => undefined)
      : Promise.resolve(undefined)
    const healthPromise = window.desktop?.getAgentHealth
      ? window.desktop.getAgentHealth().catch(() => undefined)
      : Promise.resolve(undefined)

    Promise.all([configPromise, healthPromise])
      .then(([config, health]) => {
        if (!mounted) return
        if (config?.defaultDirectory) setAgentDefaultDirectory(config.defaultDirectory)
        if (health) setAgentConnected(health.ok)
      })
      .catch(() => {
        if (mounted) setAgentConnected(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVITY_RAIL_VISIBILITY_STORAGE_KEY, String(isActivityRailVisible))
    } catch {
      return
    }
  }, [isActivityRailVisible])

  useEffect(() => {
    if (!developmentFeaturesEnabled) return
    try {
      window.localStorage.setItem(DEBUG_UI_REGIONS_STORAGE_KEY, String(isDebugUiRegionsEnabled))
    } catch {
      return
    }
  }, [developmentFeaturesEnabled, isDebugUiRegionsEnabled])

  useEffect(() => {
    if (!developmentFeaturesEnabled) return
    try {
      window.localStorage.setItem(DEBUG_LINE_COLORS_STORAGE_KEY, String(isDebugLineColorsEnabled))
    } catch {
      return
    }
  }, [developmentFeaturesEnabled, isDebugLineColorsEnabled])

  useEffect(() => {
    if (!developmentFeaturesEnabled) return
    try {
      window.localStorage.setItem(
        SEMANTIC_TOKEN_INSPECTOR_STORAGE_KEY,
        String(isSemanticTokenInspectorEnabled),
      )
    } catch {
      return
    }
  }, [developmentFeaturesEnabled, isSemanticTokenInspectorEnabled])

  useEffect(() => {
    if (!developmentFeaturesEnabled) return
    try {
      window.localStorage.setItem(MOBILE_CONNECTION_ADVANCED_INFO_STORAGE_KEY, String(isMobileConnectionAdvancedInfoEnabled))
    } catch {
      return
    }
  }, [developmentFeaturesEnabled, isMobileConnectionAdvancedInfoEnabled])

  useEffect(() => {
    if (!developmentFeaturesEnabled) return
    try {
      window.localStorage.setItem(
        ASSISTANT_TRACE_VISIBILITY_STORAGE_KEY,
        JSON.stringify(assistantTraceVisibility),
      )
      window.localStorage.setItem(AGENT_DEBUG_TRACE_STORAGE_KEY, String(assistantTraceVisibility.debugMetadata))
    } catch {
      return
    }
  }, [assistantTraceVisibility, developmentFeaturesEnabled])

  useEffect(() => {
    try {
      window.localStorage.setItem(SHELL_LAYOUT_MODE_STORAGE_KEY, shellLayoutMode)
    } catch {
      return
    }
  }, [shellLayoutMode])

  useEffect(() => {
    function syncSidebarWidthToViewport() {
      const rect = appShellRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0) return

      const leftBounds = resolveLeftSidebarBounds(rect.width)
      const rightBounds = resolveRightSidebarBounds(rect.width)

      setSidebarWidth((current) => {
        const nextWidth = clamp(current, leftBounds.min, leftBounds.max)
        lastExpandedSidebarWidthRef.current = clamp(lastExpandedSidebarWidthRef.current, leftBounds.min, leftBounds.max)
        return nextWidth
      })
      setRightSidebarWidth((current) => {
        const nextWidth = clamp(current, rightBounds.min, rightBounds.max)
        lastExpandedRightSidebarWidthRef.current = clamp(lastExpandedRightSidebarWidthRef.current, rightBounds.min, rightBounds.max)
        return nextWidth
      })
    }

    syncSidebarWidthToViewport()
    window.addEventListener("resize", syncSidebarWidthToViewport)
    return () => {
      window.removeEventListener("resize", syncSidebarWidthToViewport)
    }
  }, [isActivityRailVisible, isRightSidebarCollapsed, isSidebarCollapsed, rightSidebarWidth, shellLayoutMode, sidebarWidth])

  useEffect(() => {
    return () => {
      activeSidebarResizeCleanupRef.current?.()
    }
  }, [])

  function startSidebarResize(resizeState: ActiveSidebarResize) {
    let isStopped = false
    function handlePointerMove(event: globalThis.PointerEvent) {
      if (event.pointerType === "mouse" && event.buttons === 0) {
        stopSidebarResize({ commit: true })
        return
      }

      queueSidebarResizePreview(resizeState, resolveSidebarResizeWidth(resizeState, event.clientX))
    }

    function handlePointerUp() {
      stopSidebarResize({ commit: true })
    }

    function handlePointerCancel() {
      stopSidebarResize({ commit: false })
    }

    function handleWindowBlur() {
      stopSidebarResize({ commit: true })
    }

    function stopSidebarResize({ commit }: { commit: boolean }) {
      if (isStopped) return
      isStopped = true
      if (commit) {
        flushRendererFrameNow("sidebar-resize:commit")
        applySidebarResizePreview(resizeState, resizeState.latestWidth)
        resizeState.didCommit = true
        if (resizeState.side === "left") {
          lastExpandedSidebarWidthRef.current = resizeState.latestWidth
          setSidebarWidth(resizeState.latestWidth)
        } else {
          lastExpandedRightSidebarWidthRef.current = resizeState.latestWidth
          setRightSidebarWidth(resizeState.latestWidth)
        }
      } else {
        clearSidebarResizePreview(resizeState)
        restoreSidebarResizePreview(resizeState)
      }
      if (activeSidebarResizeRef.current === resizeState) {
        activeSidebarResizeRef.current = null
      }
      activeSidebarResizerPointerRef.current?.element.classList.remove("is-active")
      releaseActiveSidebarResizerPointerCapture()
      document.body.classList.remove("is-resizing-sidebar")
      endRendererInteractiveLayout("sidebar-resize")
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerCancel)
      window.removeEventListener("blur", handleWindowBlur)
      window.dispatchEvent(new Event(SIDEBAR_RESIZE_END_EVENT))
      if (activeSidebarResizeCleanupRef.current === cleanupSidebarResize) {
        activeSidebarResizeCleanupRef.current = null
      }
    }

    function cleanupSidebarResize() {
      stopSidebarResize({ commit: false })
    }

    activeSidebarResizeRef.current = resizeState
    activeSidebarResizeCleanupRef.current = cleanupSidebarResize
    activeSidebarResizerPointerRef.current?.element.classList.add("is-active")
    beginRendererInteractiveLayout("sidebar-resize")
    document.body.classList.add("is-resizing-sidebar")
    window.dispatchEvent(new Event(SIDEBAR_RESIZE_START_EVENT))
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("pointercancel", handlePointerCancel)
    window.addEventListener("blur", handleWindowBlur)
  }

  function adjustSidebarWidth(delta: number) {
    const rect = appShellRef.current?.getBoundingClientRect()
    const bounds = resolveLeftSidebarBounds(rect?.width)
    setSidebarWidth((current) => {
      const nextWidth = clamp(current + delta, bounds.min, bounds.max)
      lastExpandedSidebarWidthRef.current = nextWidth
      return nextWidth
    })
  }

  function adjustRightSidebarWidth(delta: number) {
    const rect = appShellRef.current?.getBoundingClientRect()
    const bounds = resolveRightSidebarBounds(rect?.width)
    setRightSidebarWidth((current) => {
      const nextWidth = clamp(current + delta, bounds.min, bounds.max)
      lastExpandedRightSidebarWidthRef.current = nextWidth
      return nextWidth
    })
  }

  function restoreSidebar() {
    const rect = appShellRef.current?.getBoundingClientRect()
    const bounds = resolveLeftSidebarBounds(rect?.width)
    const nextWidth = clamp(lastExpandedSidebarWidthRef.current, bounds.min, bounds.max)
    setSidebarWidth(nextWidth)
    setIsSidebarCollapsed(false)
  }

  function restoreRightSidebar() {
    const rect = appShellRef.current?.getBoundingClientRect()
    const bounds = resolveRightSidebarBounds(rect?.width)
    const nextWidth = clamp(lastExpandedRightSidebarWidthRef.current, bounds.min, bounds.max)
    setRightSidebarWidth(nextWidth)
    setIsRightSidebarCollapsed(false)
  }

  function handleSidebarResizerPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return

    const rect = appShellRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return

    activeSidebarResizeCleanupRef.current?.()
    captureSidebarResizerPointer(event)
    const bounds = resolveLeftSidebarBounds(rect.width)
    const resizeState: ActiveSidebarResize = {
      appShell: appShellRef.current!,
      bounds,
      containerLeft: rect.left,
      containerRight: rect.right,
      didCommit: false,
      latestWidth: sidebarWidth,
      leftRailDisplayWidth: getLeftRailDisplayWidth(),
      originalWidth: sidebarWidth,
      pointerOffsetX: 0,
      previewCancel: null,
      side: "left",
    }
    resizeState.pointerOffsetX = event.clientX - resolveSidebarResizeLineX(resizeState)
    queueSidebarResizePreview(resizeState, resolveSidebarResizeWidth(resizeState, event.clientX))

    event.preventDefault()
    startSidebarResize(resizeState)
  }

  function handleRightSidebarResizerPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return

    const rect = appShellRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return

    activeSidebarResizeCleanupRef.current?.()
    captureSidebarResizerPointer(event)
    const bounds = resolveRightSidebarBounds(rect.width)
    const resizeState: ActiveSidebarResize = {
      appShell: appShellRef.current!,
      bounds,
      containerLeft: rect.left,
      containerRight: rect.right,
      didCommit: false,
      latestWidth: rightSidebarWidth,
      leftRailDisplayWidth: getLeftRailDisplayWidth(),
      originalWidth: rightSidebarWidth,
      pointerOffsetX: 0,
      previewCancel: null,
      side: "right",
    }
    resizeState.pointerOffsetX = event.clientX - resolveSidebarResizeLineX(resizeState)
    queueSidebarResizePreview(resizeState, resolveSidebarResizeWidth(resizeState, event.clientX))

    event.preventDefault()
    startSidebarResize(resizeState)
  }

  function handleSidebarResizerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      adjustSidebarWidth(-SIDEBAR_KEYBOARD_STEP)
      return
    }

    if (event.key === "ArrowRight") {
      event.preventDefault()
      adjustSidebarWidth(SIDEBAR_KEYBOARD_STEP)
      return
    }

    const rect = appShellRef.current?.getBoundingClientRect()
    const bounds = resolveLeftSidebarBounds(rect?.width)

    if (event.key === "Home") {
      event.preventDefault()
      lastExpandedSidebarWidthRef.current = bounds.min
      setSidebarWidth(bounds.min)
      return
    }

    if (event.key === "End") {
      event.preventDefault()
      lastExpandedSidebarWidthRef.current = bounds.max
      setSidebarWidth(bounds.max)
    }
  }

  function handleRightSidebarResizerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      adjustRightSidebarWidth(SIDEBAR_KEYBOARD_STEP)
      return
    }

    if (event.key === "ArrowRight") {
      event.preventDefault()
      adjustRightSidebarWidth(-SIDEBAR_KEYBOARD_STEP)
      return
    }

    const rect = appShellRef.current?.getBoundingClientRect()
    const bounds = resolveRightSidebarBounds(rect?.width)

    if (event.key === "Home") {
      event.preventDefault()
      lastExpandedRightSidebarWidthRef.current = bounds.min
      setRightSidebarWidth(bounds.min)
      return
    }

    if (event.key === "End") {
      event.preventDefault()
      lastExpandedRightSidebarWidthRef.current = bounds.max
      setRightSidebarWidth(bounds.max)
    }
  }

  function handleSidebarToggle() {
    if (isSidebarCollapsed) {
      restoreSidebar()
      return
    }

    lastExpandedSidebarWidthRef.current = sidebarWidth
    activeSidebarResizeCleanupRef.current?.()
    setIsSidebarCollapsed(true)
  }

  function handleRightSidebarToggle() {
    if (isRightSidebarCollapsed) {
      restoreRightSidebar()
      return
    }

    lastExpandedRightSidebarWidthRef.current = rightSidebarWidth
    activeSidebarResizeCleanupRef.current?.()
    setIsRightSidebarCollapsed(true)
  }

  function handleShellLayoutModeChange(nextMode: ShellLayoutMode) {
    if (nextMode === shellLayoutMode) return

    activeSidebarResizeCleanupRef.current?.()
    const rect = appShellRef.current?.getBoundingClientRect()
    const bounds = resolveRightSidebarBounds(rect?.width, nextMode)
    const nextWidth = clamp(rightSidebarWidth, bounds.min, bounds.max)
    lastExpandedRightSidebarWidthRef.current = nextWidth
    setRightSidebarWidth(nextWidth)
    setIsRightSidebarCollapsed(false)
    setShellLayoutMode(nextMode)
  }

  function handleActivityRailVisibilityChange(nextVisible: boolean) {
    if (!nextVisible) {
      activeSidebarResizeCleanupRef.current?.()
    }

    setIsActivityRailVisible(nextVisible)
  }

  function handleDebugUiRegionsChange(nextEnabled: boolean) {
    if (!developmentFeaturesEnabled) return
    setIsDebugUiRegionsEnabled(nextEnabled)
  }

  function handleDebugLineColorsChange(nextEnabled: boolean) {
    if (!developmentFeaturesEnabled) return
    setIsDebugLineColorsEnabled(nextEnabled)
  }

  function handleSemanticTokenInspectorChange(nextEnabled: boolean) {
    if (!developmentFeaturesEnabled) return
    setIsSemanticTokenInspectorEnabled(nextEnabled)
  }

  function handleMobileConnectionAdvancedInfoChange(nextEnabled: boolean) {
    if (!developmentFeaturesEnabled) return
    setIsMobileConnectionAdvancedInfoEnabled(nextEnabled)
  }

  function handleAssistantTraceVisibilityChange(key: AssistantTraceVisibilityKey, nextEnabled: boolean) {
    if (!developmentFeaturesEnabled) return
    setAssistantTraceVisibility((current) => {
      if (current[key] === nextEnabled) return current
      return {
        ...current,
        [key]: nextEnabled,
      }
    })
  }

  function handleAgentDebugTraceChange(nextEnabled: boolean) {
    handleAssistantTraceVisibilityChange("debugMetadata", nextEnabled)
  }

  const handleWindowAction = useCallback((action: WindowAction) => {
    if (!window.desktop?.windowAction) {
      console.warn("[desktop] windowAction is unavailable. preload may not be loaded.")
      return
    }

    void window.desktop.windowAction(action).catch((error) => {
      console.error("[desktop] windowAction failed:", error)
    })
  }, [])

  const appShellStyle = {
    "--window-controls-clearance": `${windowControlsClearance}px`,
    "--window-controls-canvas-clearance": "0px",
    "--window-controls-right-sidebar-clearance": "0px",
    "--activity-rail-display-width": isActivityRailVisible ? "54px" : "0px",
    "--sidebar-display-width": isSidebarCollapsed ? "0px" : `${sidebarWidth}px`,
    "--sidebar-resizer-width": isSidebarCollapsed ? "0px" : `${SIDEBAR_RESIZER_WIDTH}px`,
    "--sidebar-width": `${sidebarWidth}px`,
    "--right-sidebar-display-width": isRightSidebarCollapsed ? "0px" : `${rightSidebarWidth}px`,
    "--right-sidebar-resizer-width": isRightSidebarCollapsed ? "0px" : `${SIDEBAR_RESIZER_WIDTH}px`,
    "--right-sidebar-width": `${rightSidebarWidth}px`,
    "--companion-region-display-width": isRightSidebarCollapsed ? "0px" : `${rightSidebarWidth}px`,
    "--companion-region-resizer-width": isRightSidebarCollapsed ? "0px" : `${SIDEBAR_RESIZER_WIDTH}px`,
    "--companion-region-width": `${rightSidebarWidth}px`,
  } as CSSProperties

  const currentAppShellWidth = appShellRef.current?.getBoundingClientRect().width
  const sidebarWidthBounds = resolveLeftSidebarBounds(currentAppShellWidth)
  const rightSidebarWidthBounds = resolveRightSidebarBounds(currentAppShellWidth)

  return {
    agentConnected,
    agentDefaultDirectory,
    appearanceAuthoringEnabled,
    appearanceConfigError,
    appearanceConfigPath,
    appearanceConfigPreview,
    appearanceContrastWarnings,
    appearanceOverrides,
    appearanceThemeError,
    appearanceThemeNotice,
    appearanceThemes,
    activeAppearanceThemeID,
    appearanceTokenValues,
    assistantTraceVisibility,
    appShellRef,
    appShellStyle,
    brandTheme,
    codeThemePreference,
    colorMode,
    developmentFeaturesEnabled,
    fontFamily,
    codeFontFamily,
    handleBrandThemeChange,
    handleCodeThemeChange,
    handleColorModeChange,
    handleFontFamilyChange,
    handleCodeFontFamilyChange,
    handleActivityRailVisibilityChange,
    handleAppearancePaletteReset,
    handleAppearanceThemeApply,
    handleAppearanceThemeDelete,
    handleAppearanceThemeDuplicate,
    handleAppearanceThemeExportDtcg,
    handleAppearanceThemeImportDtcg,
    handleAppearanceThemeRename,
    handleAppearanceThemeSaveCurrent,
    handleAppearanceTokenChange,
    handleAppearanceTokenReset,
    handleSemanticTokenAuthoringCommitted,
    handleAssistantTraceVisibilityChange,
    handleAgentDebugTraceChange,
    handleDebugLineColorsChange,
    handleDebugUiRegionsChange,
    handleSemanticTokenInspectorChange,
    handleMobileConnectionAdvancedInfoChange,
    handleSidebarResizerKeyDown,
    handleSidebarResizerPointerDown,
    handleSidebarToggle,
    handleRightSidebarResizerKeyDown,
    handleRightSidebarResizerPointerDown,
    handleRightSidebarToggle,
    handleShellLayoutModeChange,
    handleWindowAction,
    isActivityRailVisible,
    isAgentDebugTraceEnabled,
    isDebugLineColorsEnabled,
    isDebugUiRegionsEnabled,
    isSemanticTokenInspectorEnabled,
    isMobileConnectionAdvancedInfoEnabled,
    isSidebarCollapsed,
    isSidebarResizing,
    isRightSidebarCollapsed,
    isRightSidebarResizing,
    isCompanionCollapsed: isRightSidebarCollapsed,
    isCompanionResizing: isRightSidebarResizing,
    isWindowMaximized,
    platform,
    rightSidebarWidthBounds,
    rightSidebarWidth,
    companionWidthBounds: rightSidebarWidthBounds,
    companionWidth: rightSidebarWidth,
    resolvedCodeTheme,
    resolvedColorMode,
    runtimeCapabilitiesReady,
    sidebarWidthBounds,
    sidebarWidth,
    shellLayoutMode,
    windowControlsRef,
    handleCompanionResizerKeyDown: handleRightSidebarResizerKeyDown,
    handleCompanionResizerPointerDown: handleRightSidebarResizerPointerDown,
    handleCompanionToggle: handleRightSidebarToggle,
  }
}
