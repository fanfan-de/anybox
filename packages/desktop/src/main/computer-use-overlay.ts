import { BrowserWindow, globalShortcut, screen, type WebContents } from "electron"
import { safeError, safeWarn } from "./safe-console"

const COMPUTER_USE_TOOL_PREFIX = "mcp_plugin_computer_use_windows_windows_"
const COMPUTER_USE_TITLE_PREFIX = "Computer Use Windows/"
const COMPUTER_USE_PRESS_KEY_TOOL = `${COMPUTER_USE_TOOL_PREFIX}press_key`
const COMPUTER_USE_SHORTCUTS = ["Esc", "Escape"] as const
const DEFAULT_MIN_VISIBLE_MS = 700
const DEFAULT_IDLE_HIDE_MS = 250

export interface ComputerUseOverlayContext {
  appDisplayName?: string
  backendSessionID: string
  callID?: string
  clientTurnID?: string
  leaseID?: string
  title?: string
  tool?: string
  turnID?: string
  webContentsID: number
}

export type ComputerUseRuntimeEvent =
  | {
      type: "tool-started"
      callKey: string
      callID: string
      suppressCancelShortcut?: boolean
      title?: string
      tool: string
      turnID?: string
    }
  | {
      type: "tool-settled"
      callKey: string
      callID: string
      title?: string
      tool: string
      turnID?: string
    }
  | {
      type: "turn-settled"
      turnID?: string
    }
  | {
      type: "app-changed"
      callKey: string
      appDisplayName: string
      leaseID: string
      turnID?: string
    }

interface ComputerUseOverlayManagerOptions {
  appName?: string
  idleHideMs?: number
  minVisibleMs?: number
  onCancel?: (context: ComputerUseOverlayContext) => Promise<void> | void
}

interface SessionStreamEventInput {
  backendSessionID: string
  clientTurnID?: string
  data: unknown
  event: string
  target: WebContents
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readToolPart(data: unknown) {
  if (!isRecord(data)) return null
  const payload = data.payload
  if (!isRecord(payload)) return null
  const part = payload.part
  return isRecord(part) ? part : null
}

function readToolTitle(part: Record<string, unknown>) {
  const state = readToolState(part)
  if (isRecord(state)) {
    return readString(state.title)
  }
  return undefined
}

function readToolState(part: Record<string, unknown>) {
  return isRecord(part.state) ? part.state : null
}

function readToolInput(part: Record<string, unknown>) {
  const state = readToolState(part)
  if (!state) return null

  if (isRecord(state.input)) {
    if (Object.keys(state.input).length > 0) {
      return state.input
    }
  }

  const raw = readString(state.raw)
  if (!raw) return isRecord(state.input) ? state.input : null

  try {
    const parsed = JSON.parse(raw) as unknown
    return isRecord(parsed) ? parsed : null
  } catch {
    return isRecord(state.input) ? state.input : null
  }
}

function isEscapeKey(value: unknown) {
  if (typeof value !== "string") return false
  const key = value.trim().toLowerCase()
  return key === "esc" || key === "escape"
}

function shouldSuppressCancelShortcut(part: Record<string, unknown>, tool: string) {
  if (tool !== COMPUTER_USE_PRESS_KEY_TOOL) return false
  const input = readToolInput(part)
  return Array.isArray(input?.keys) && input.keys.some(isEscapeKey)
}

function isComputerUseToolPart(part: Record<string, unknown>) {
  const tool = readString(part.tool)
  const title = readToolTitle(part)
  return Boolean(
    tool?.startsWith(COMPUTER_USE_TOOL_PREFIX) ||
      title?.startsWith(COMPUTER_USE_TITLE_PREFIX),
  )
}

function buildCallKey(data: unknown, callID: string) {
  const runtimeEvent = isRecord(data) ? data : {}
  return [
    readString(runtimeEvent.sessionID) ?? "session",
    readString(runtimeEvent.turnID) ?? "turn",
    callID,
  ].join(":")
}

export function readComputerUseRuntimeEvent(input: {
  data: unknown
  event: string
}): ComputerUseRuntimeEvent | null {
  if (input.event !== "runtime" || !isRecord(input.data)) return null

  const runtimeType = readString(input.data.type)
  const runtimePayload = isRecord(input.data.payload) ? input.data.payload : {}
  const leaseID = readString(runtimePayload.leaseID)
  if (runtimeType === "computer.use.started" && leaseID) {
    const appDisplayName = readString(runtimePayload.appDisplayName)
    return {
      type: "tool-started",
      callKey: buildCallKey(input.data, leaseID),
      callID: leaseID,
      title: appDisplayName
        ? `Computer Use · ${appDisplayName}`
        : "Computer Use",
      tool: "mcp_anybox_computer_use",
      turnID: readString(input.data.turnID),
    }
  }
  if (runtimeType === "computer.use.app_changed" && leaseID) {
    return {
      type: "app-changed",
      callKey: buildCallKey(input.data, leaseID),
      appDisplayName:
        readString(runtimePayload.appDisplayName) ?? "Windows application",
      leaseID,
      turnID: readString(input.data.turnID),
    }
  }
  if (
    (
      runtimeType === "computer.use.interrupted"
      || runtimeType === "computer.use.stopped"
    )
    && leaseID
  ) {
    return {
      type: "tool-settled",
      callKey: buildCallKey(input.data, leaseID),
      callID: leaseID,
      title: "Computer Use",
      tool: "mcp_anybox_computer_use",
      turnID: readString(input.data.turnID),
    }
  }
  if (runtimeType === "turn.completed" || runtimeType === "turn.failed" || runtimeType === "turn.cancelled") {
    return {
      type: "turn-settled",
      turnID: readString(input.data.turnID),
    }
  }

  const part = readToolPart(input.data)
  if (!part || !isComputerUseToolPart(part)) return null

  const callID = readString(part.callID)
  const tool = readString(part.tool)
  if (!callID || !tool) return null

  const shouldSuppress = shouldSuppressCancelShortcut(part, tool)
  if (
    runtimeType === "tool.call.started" ||
    runtimeType === "tool.call.waiting_approval" ||
    (runtimeType === "tool.call.pending" && shouldSuppress)
  ) {
    return {
      type: "tool-started",
      callKey: buildCallKey(input.data, callID),
      callID,
      ...(shouldSuppress
        ? {
            suppressCancelShortcut: true,
          }
        : {}),
      title: readToolTitle(part),
      tool,
      turnID: readString(input.data.turnID),
    }
  }

  if (
    runtimeType === "tool.call.completed" ||
    runtimeType === "tool.call.failed" ||
    runtimeType === "tool.call.denied" ||
    runtimeType === "tool.call.cancelled"
  ) {
    return {
      type: "tool-settled",
      callKey: buildCallKey(input.data, callID),
      callID,
      title: readToolTitle(part),
      tool,
      turnID: readString(input.data.turnID),
    }
  }

  return null
}

export class ComputerUseOverlayManager {
  private readonly activeCalls = new Map<string, ComputerUseOverlayContext>()
  private readonly activeTurns = new Map<string, ComputerUseOverlayContext>()
  private readonly appName: string
  private readonly cancelShortcutSuppressedCallKeys = new Set<string>()
  private readonly idleHideMs: number
  private latestContext: ComputerUseOverlayContext | null = null
  private readonly minVisibleMs: number
  private readonly onCancel?: (context: ComputerUseOverlayContext) => Promise<void> | void
  private registeredShortcut: string | null = null
  private resizeTimer: ReturnType<typeof setTimeout> | null = null
  private visibleSince = 0
  private windows: BrowserWindow[] = []
  private hideTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: ComputerUseOverlayManagerOptions = {}) {
    this.appName = options.appName?.trim() || "Anybox"
    this.idleHideMs = options.idleHideMs ?? DEFAULT_IDLE_HIDE_MS
    this.minVisibleMs = options.minVisibleMs ?? DEFAULT_MIN_VISIBLE_MS
    this.onCancel = options.onCancel
  }

  handleSessionStreamEvent(input: SessionStreamEventInput) {
    const event = readComputerUseRuntimeEvent(input)
    if (!event) return

    if (event.type === "turn-settled") {
      this.clearForTurn({
        backendSessionID: input.backendSessionID,
        clientTurnID: input.clientTurnID,
        turnID: event.turnID,
        webContentsID: input.target.id,
      })
      return
    }

    if (event.type === "app-changed") {
      const current = this.activeCalls.get(event.callKey)
      if (!current) return
      const context = {
        ...current,
        appDisplayName: event.appDisplayName,
        leaseID: event.leaseID,
        title: `Computer Use · ${event.appDisplayName}`,
      }
      this.activeCalls.set(event.callKey, context)
      this.activeTurns.set(this.contextTurnKey(context), context)
      this.latestContext = context
      this.show()
      return
    }

    if (event.type === "tool-started") {
      const context: ComputerUseOverlayContext = {
        appDisplayName: event.title?.startsWith("Computer Use · ")
          ? event.title.slice("Computer Use · ".length)
          : undefined,
        backendSessionID: input.backendSessionID,
        callID: event.callID,
        clientTurnID: input.clientTurnID,
        leaseID: event.callID.startsWith("cu_lease_") ? event.callID : undefined,
        title: event.title,
        tool: event.tool,
        turnID: event.turnID,
        webContentsID: input.target.id,
      }
      if (event.suppressCancelShortcut) {
        this.cancelShortcutSuppressedCallKeys.add(event.callKey)
      }
      this.activeCalls.set(event.callKey, context)
      this.activeTurns.set(this.contextTurnKey(context), context)
      this.latestContext = context
      this.show()
      return
    }

    this.activeCalls.delete(event.callKey)
    this.cancelShortcutSuppressedCallKeys.delete(event.callKey)
    this.latestContext = this.lastActiveContext()
    if (this.activeCalls.size === 0 && this.activeTurns.size === 0) {
      this.syncCancelShortcut()
      this.scheduleHide()
      return
    }
    this.syncCancelShortcut()
  }

  clearForRequest(input: { backendSessionID: string; clientTurnID?: string; webContentsID: number }) {
    for (const [key, context] of this.activeCalls.entries()) {
      if (context.webContentsID !== input.webContentsID) continue
      if (context.backendSessionID !== input.backendSessionID) continue
      if (input.clientTurnID && context.clientTurnID && context.clientTurnID !== input.clientTurnID) continue
      this.activeCalls.delete(key)
      this.cancelShortcutSuppressedCallKeys.delete(key)
    }
    for (const [key, context] of this.activeTurns.entries()) {
      if (context.webContentsID !== input.webContentsID) continue
      if (context.backendSessionID !== input.backendSessionID) continue
      if (input.clientTurnID && context.clientTurnID && context.clientTurnID !== input.clientTurnID) continue
      this.activeTurns.delete(key)
    }

    this.latestContext = this.lastActiveContext()
    if (this.activeCalls.size === 0 && this.activeTurns.size === 0) {
      this.syncCancelShortcut()
      this.scheduleHide()
      return
    }
    this.syncCancelShortcut()
  }

  clearForWebContents(webContentsID: number) {
    for (const [key, context] of this.activeCalls.entries()) {
      if (context.webContentsID === webContentsID) {
        this.activeCalls.delete(key)
        this.cancelShortcutSuppressedCallKeys.delete(key)
      }
    }
    for (const [key, context] of this.activeTurns.entries()) {
      if (context.webContentsID === webContentsID) {
        this.activeTurns.delete(key)
      }
    }

    this.latestContext = this.lastActiveContext()
    if (this.activeCalls.size === 0 && this.activeTurns.size === 0) {
      this.syncCancelShortcut()
      this.scheduleHide()
      return
    }
    this.syncCancelShortcut()
  }

  destroy() {
    this.activeCalls.clear()
    this.activeTurns.clear()
    this.cancelShortcutSuppressedCallKeys.clear()
    this.latestContext = null
    this.hideNow()
  }

  private clearForTurn(input: { backendSessionID: string; clientTurnID?: string; turnID?: string; webContentsID: number }) {
    for (const [key, context] of this.activeCalls.entries()) {
      if (context.webContentsID !== input.webContentsID) continue
      if (context.backendSessionID !== input.backendSessionID) continue
      if (input.turnID && context.turnID && context.turnID !== input.turnID) continue
      if (input.clientTurnID && context.clientTurnID && context.clientTurnID !== input.clientTurnID) continue
      this.activeCalls.delete(key)
      this.cancelShortcutSuppressedCallKeys.delete(key)
    }
    for (const [key, context] of this.activeTurns.entries()) {
      if (context.webContentsID !== input.webContentsID) continue
      if (context.backendSessionID !== input.backendSessionID) continue
      if (input.turnID && context.turnID && context.turnID !== input.turnID) continue
      if (input.clientTurnID && context.clientTurnID && context.clientTurnID !== input.clientTurnID) continue
      this.activeTurns.delete(key)
    }

    this.latestContext = this.lastActiveContext()
    if (this.activeCalls.size === 0 && this.activeTurns.size === 0) {
      this.syncCancelShortcut()
      this.scheduleHide()
      return
    }
    this.syncCancelShortcut()
  }

  private lastActiveContext() {
    const contexts = [...this.activeCalls.values(), ...this.activeTurns.values()]
    return contexts.length ? contexts[contexts.length - 1] : null
  }

  private contextTurnKey(context: ComputerUseOverlayContext) {
    return [
      context.webContentsID,
      context.backendSessionID,
      context.turnID ?? context.clientTurnID ?? "unknown-turn",
    ].join(":")
  }

  private show() {
    this.clearHideTimer()
    this.visibleSince = this.visibleSince || Date.now()

    if (this.windows.length === 0) {
      this.createWindows()
      this.registerDisplayListeners()
    }

    this.syncCancelShortcut()
  }

  private createWindows() {
    const displays = screen.getAllDisplays()
    this.windows = displays.map((display) => {
      const win = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        focusable: false,
        hasShadow: false,
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })

      win.setIgnoreMouseEvents(true, { forward: true })
      this.applyAlwaysOnTop(win)
      win.loadURL(createOverlayDataURL(this.appName)).catch((error) => {
        safeError("[desktop][computer-use-overlay] failed to load overlay", error)
      })
      win.once("ready-to-show", () => {
        if (win.isDestroyed()) return
        this.applyAlwaysOnTop(win)
        win.showInactive()
      })
      win.on("closed", () => {
        this.windows = this.windows.filter((item) => item !== win)
      })
      return win
    })
  }

  private applyAlwaysOnTop(win: BrowserWindow) {
    try {
      win.setAlwaysOnTop(true, "screen-saver")
    } catch {
      win.setAlwaysOnTop(true)
    }
  }

  private registerDisplayListeners() {
    screen.on("display-added", this.scheduleRecreateWindows)
    screen.on("display-removed", this.scheduleRecreateWindows)
    screen.on("display-metrics-changed", this.scheduleRecreateWindows)
  }

  private unregisterDisplayListeners() {
    screen.off("display-added", this.scheduleRecreateWindows)
    screen.off("display-removed", this.scheduleRecreateWindows)
    screen.off("display-metrics-changed", this.scheduleRecreateWindows)
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer)
      this.resizeTimer = null
    }
  }

  private readonly scheduleRecreateWindows = () => {
    if (this.resizeTimer) clearTimeout(this.resizeTimer)
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null
      if (this.windows.length === 0) return
      this.destroyWindows()
      this.createWindows()
    }, 120)
  }

  private registerCancelShortcut() {
    if (this.registeredShortcut) return

    for (const shortcut of COMPUTER_USE_SHORTCUTS) {
      const registered = globalShortcut.register(shortcut, () => {
        void this.cancelFromShortcut()
      })
      if (registered) {
        this.registeredShortcut = shortcut
        return
      }
    }

    safeWarn("[desktop][computer-use-overlay] failed to register Esc cancel shortcut")
  }

  private unregisterCancelShortcut() {
    if (!this.registeredShortcut) return
    globalShortcut.unregister(this.registeredShortcut)
    this.registeredShortcut = null
  }

  private syncCancelShortcut() {
    const hasActiveContext = this.activeCalls.size > 0 || this.activeTurns.size > 0
    if (!hasActiveContext || this.cancelShortcutSuppressedCallKeys.size > 0) {
      this.unregisterCancelShortcut()
      return
    }

    this.registerCancelShortcut()
  }

  private async cancelFromShortcut() {
    if (this.cancelShortcutSuppressedCallKeys.size > 0) return

    const context = this.latestContext
    this.activeCalls.clear()
    this.activeTurns.clear()
    this.cancelShortcutSuppressedCallKeys.clear()
    this.latestContext = null
    this.hideNow()

    if (!context || !this.onCancel) return

    try {
      await this.onCancel(context)
    } catch (error) {
      safeError("[desktop][computer-use-overlay] failed to cancel computer use turn", error)
    }
  }

  private scheduleHide() {
    this.clearHideTimer()
    const visibleFor = Date.now() - this.visibleSince
    const minVisibleDelay = Math.max(0, this.minVisibleMs - visibleFor)
    this.hideTimer = setTimeout(() => {
      this.hideNow()
    }, Math.max(this.idleHideMs, minVisibleDelay))
  }

  private clearHideTimer() {
    if (!this.hideTimer) return
    clearTimeout(this.hideTimer)
    this.hideTimer = null
  }

  private hideNow() {
    this.clearHideTimer()
    this.visibleSince = 0
    this.unregisterCancelShortcut()
    this.unregisterDisplayListeners()
    this.destroyWindows()
  }

  private destroyWindows() {
    const windows = this.windows
    this.windows = []
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    }
  }
}

function escapeHTML(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function createOverlayDataURL(appName: string) {
  const safeAppName = escapeHTML(appName)
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <style>
      :root {
        color-scheme: light dark;
        --accent: #1683e9;
        --accent-strong: #0f74d4;
        --accent-glow: rgba(37, 99, 235, 0.48);
        --accent-glow-soft: rgba(37, 99, 235, 0.20);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: transparent;
        pointer-events: none;
        user-select: none;
      }

      .computer-use-overlay {
        position: fixed;
        inset: 0;
        pointer-events: none;
      }

      .computer-use-overlay::before {
        content: "";
        position: absolute;
        inset: 0;
        border: 2px solid rgba(59, 130, 246, 0.78);
        box-shadow:
          inset 0 0 20px var(--accent-glow),
          inset 0 0 72px var(--accent-glow-soft),
          inset 0 0 140px rgba(37, 99, 235, 0.08);
      }

      .computer-use-overlay::after {
        content: "";
        position: absolute;
        inset: 0;
        border: 1px solid rgba(147, 197, 253, 0.58);
      }

      .computer-use-banner {
        position: fixed;
        top: 42px;
        left: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 42px;
        max-width: min(520px, calc(100vw - 48px));
        transform: translateX(-50%);
        padding: 0 16px;
        border: 1px solid rgba(191, 219, 254, 0.65);
        border-radius: 10px;
        background: linear-gradient(180deg, var(--accent), var(--accent-strong));
        box-shadow:
          0 10px 30px rgba(15, 23, 42, 0.22),
          0 0 0 4px rgba(59, 130, 246, 0.18),
          0 0 28px rgba(37, 99, 235, 0.42);
        color: #fff;
        font: 600 14px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0;
        white-space: nowrap;
      }

      .computer-use-banner span {
        opacity: 0.88;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main class="computer-use-overlay" aria-hidden="true">
      <div class="computer-use-banner">${safeAppName} is using your computer&nbsp;&nbsp;<span>- Esc to cancel</span></div>
    </main>
  </body>
</html>`

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
