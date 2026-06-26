import { BrowserWindow, type BrowserWindowConstructorOptions, type WebContents } from "electron"
import type {
  WorkbenchDetachSessionPanelInput,
  WorkbenchDetachSessionPanelResult,
  WorkbenchDockSessionPanelInput,
  WorkbenchFocusSessionPanelInput,
  WorkbenchFocusSessionPanelResult,
  WorkbenchMoveSessionPanelInput,
  WorkbenchMoveSessionPanelResult,
  WorkbenchPanelMountedInput,
  WorkbenchPanelDragInput,
  WorkbenchPanelDragState,
  WorkbenchPanelOwnership,
  WorkbenchPaneRenderSnapshot,
  WorkbenchSharedState,
  WorkbenchSurfaceKind,
  WorkbenchSurfaceSummary,
  WorkbenchStateEvent,
  WorkbenchWindowContext,
  WorkbenchWindowKind,
  WorkbenchWindowReadyInput,
  WorkbenchWindowSummary,
} from "../shared/desktop-ipc-contract"
import { DESKTOP_WORKBENCH_STATE_EVENT_CHANNEL } from "../shared/desktop-ipc-contract"
import { safeWarn } from "./safe-console"
import { getWebContentsForWindowSafely, sendWebContentsSafely } from "./safe-web-contents-send"
import { recordShutdownDiagnostic } from "./shutdown-diagnostics"

const MAIN_WORKBENCH_WINDOW_ID = "main"
const MAIN_WORKBENCH_SURFACE_ID = "main"
const DETACH_MOUNT_TIMEOUT_MS = 20_000

interface WorkbenchWindowRecord {
  browserWindow: BrowserWindow
  id: string
  kind: WorkbenchWindowKind
  panelID?: string
  surfaceID: string
}

interface WorkbenchSurfaceRecord {
  id: string
  kind: WorkbenchSurfaceKind
  layout?: unknown
  panelIDs: Set<string>
  windowID: string
}

interface PendingDetachTransaction {
  panelID: string
  reject: (error: Error) => void
  resolve: (result: WorkbenchDetachSessionPanelResult) => void
  timer: ReturnType<typeof setTimeout>
  windowID: string
}

export interface WorkbenchWindowManagerOptions {
  configureWindow?: (browserWindow: BrowserWindow) => void
  createPopoutWindowOptions: () => BrowserWindowConstructorOptions
  rendererEntryUrl: string
}

function createPopoutWindowID(panelID: string) {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return `session-popout:${panelID}:${suffix}`
}

function createPopoutSurfaceID(windowID: string) {
  return `popout:${windowID}`
}

function resolveRendererUrlForWorkbenchWindow(rendererEntryUrl: string, windowID: string) {
  const nextUrl = new URL(rendererEntryUrl)
  nextUrl.searchParams.set("workbenchWindowID", windowID)
  return nextUrl.toString()
}

function getWindowOwnedPanelIDs(windowID: string, ownership: Iterable<WorkbenchPanelOwnership>) {
  return Array.from(ownership)
    .filter((item) => item.ownerWindowID === windowID)
    .map((item) => item.panelID)
}

function getOwnershipSurfaceID(ownership: WorkbenchPanelOwnership) {
  return ownership.ownerSurfaceID ?? ownership.ownerWindowID
}

function getSharedStateContentSignature(state: WorkbenchSharedState) {
  const { version: _version, ...content } = state
  return JSON.stringify(content)
}

export class WorkbenchWindowManager {
  private readonly configureWindow?: (browserWindow: BrowserWindow) => void
  private readonly createPopoutWindowOptions: () => BrowserWindowConstructorOptions
  private readonly rendererEntryUrl: string
  private readonly windows = new Map<string, WorkbenchWindowRecord>()
  private readonly webContentsToWindowID = new Map<number, string>()
  private readonly surfaces = new Map<string, WorkbenchSurfaceRecord>()
  private readonly ownership = new Map<string, WorkbenchPanelOwnership>()
  private readonly panelSnapshots = new Map<string, WorkbenchPaneRenderSnapshot>()
  private readonly pendingDetachTransactions = new Map<string, PendingDetachTransaction>()
  private readonly panelDrags = new Map<string, WorkbenchPanelDragState>()
  private readonly windowsClosingForDock = new Set<string>()
  private stateVersion = 0

  constructor(options: WorkbenchWindowManagerOptions) {
    this.configureWindow = options.configureWindow
    this.createPopoutWindowOptions = options.createPopoutWindowOptions
    this.rendererEntryUrl = options.rendererEntryUrl
  }

  registerMainWindow(browserWindow: BrowserWindow) {
    this.ensureSurface({
      id: MAIN_WORKBENCH_SURFACE_ID,
      kind: "main",
      windowID: MAIN_WORKBENCH_WINDOW_ID,
    })
    this.registerWindow({
      browserWindow,
      id: MAIN_WORKBENCH_WINDOW_ID,
      kind: "main",
      surfaceID: MAIN_WORKBENCH_SURFACE_ID,
    })
  }

  getWindowContext(sender: WebContents): WorkbenchWindowContext {
    const windowID = this.webContentsToWindowID.get(sender.id) ?? MAIN_WORKBENCH_WINDOW_ID
    const windowRecord = this.windows.get(windowID)
    const surfaceID = windowRecord?.surfaceID ?? MAIN_WORKBENCH_SURFACE_ID
    const surface = this.surfaces.get(surfaceID)
    const ownedPanelIDs = surface
      ? Array.from(surface.panelIDs)
      : getWindowOwnedPanelIDs(windowID, this.ownership.values())
    const panelID = windowRecord?.panelID ?? ownedPanelIDs[0]
    const pendingOwnership = panelID ? this.ownership.get(panelID) ?? null : null

    return {
      windowID,
      kind: windowRecord?.kind ?? "main",
      surfaceID,
      ownedPanelIDs,
      panelID,
      reference: pendingOwnership?.reference ?? null,
      state: this.getSharedState(),
    }
  }

  publishStateSnapshot(snapshot: WorkbenchSharedState) {
    const previousSignature = getSharedStateContentSignature(this.getSharedState())

    for (const [panelID, panelSnapshot] of Object.entries(snapshot.panels)) {
      this.panelSnapshots.set(panelID, panelSnapshot)
    }
    for (const surfaceSnapshot of snapshot.surfaces ?? []) {
      const surface = this.surfaces.get(surfaceSnapshot.surfaceID)
      if (!surface) continue
      surface.layout = surfaceSnapshot.layout
      const nextPanelIDs = new Set<string>()
      for (const panelID of surfaceSnapshot.ownedPanelIDs) {
        const ownership = this.ownership.get(panelID)
        if (ownership && getOwnershipSurfaceID(ownership) !== surface.id) continue
        if (!ownership && panelID.startsWith("session:")) {
          const sessionID = panelID.slice("session:".length)
          if (sessionID) {
            this.ownership.set(panelID, {
              panelID,
              ownerSurfaceID: surface.id,
              ownerWindowID: surface.windowID,
              reference: {
                kind: "session",
                sessionID,
              },
              title: snapshot.panels[panelID]?.title,
            })
          }
        }
        nextPanelIDs.add(panelID)
      }
      for (const ownership of this.ownership.values()) {
        if (getOwnershipSurfaceID(ownership) === surface.id) {
          nextPanelIDs.add(ownership.panelID)
        }
      }
      surface.panelIDs = nextPanelIDs
    }

    const nextStateSignature = getSharedStateContentSignature(this.getSharedState())
    if (nextStateSignature === previousSignature) {
      return this.getSharedState()
    }

    this.stateVersion += 1
    const nextState = this.getSharedState()
    this.broadcast({ reason: "snapshot", state: nextState })
    return nextState
  }

  async detachSessionPanel(input: WorkbenchDetachSessionPanelInput): Promise<WorkbenchDetachSessionPanelResult> {
    const existingOwnership = this.ownership.get(input.panelID) ?? this.createMainOwnershipForPanel(input.panelID)
    const existingSurfaceID = existingOwnership ? getOwnershipSurfaceID(existingOwnership) : null
    const sourceSurfaceID = input.sourceSurfaceID ?? existingSurfaceID ?? MAIN_WORKBENCH_SURFACE_ID
    if (input.sourceSurfaceID && existingSurfaceID && existingSurfaceID !== input.sourceSurfaceID) {
      return {
        ok: false,
        panelID: input.panelID,
        reason: "panel-moved",
        windowID: existingOwnership?.ownerWindowID ?? MAIN_WORKBENCH_WINDOW_ID,
        state: this.getSharedState(),
      }
    }
    if (
      !input.sourceSurfaceID &&
      existingOwnership?.ownerWindowID &&
      existingOwnership.ownerWindowID !== MAIN_WORKBENCH_WINDOW_ID
    ) {
      return {
        ok: true,
        panelID: input.panelID,
        windowID: existingOwnership.ownerWindowID,
        state: this.getSharedState(),
      }
    }

    const sourceSurface = this.surfaces.get(sourceSurfaceID)
    const windowID = createPopoutWindowID(input.panelID)
    const surfaceID = createPopoutSurfaceID(windowID)
    const browserWindow = new BrowserWindow({
      ...this.createPopoutWindowOptions(),
      ...(input.bounds?.x !== undefined ? { x: input.bounds.x } : {}),
      ...(input.bounds?.y !== undefined ? { y: input.bounds.y } : {}),
      ...(input.bounds?.width ? { width: input.bounds.width } : {}),
      ...(input.bounds?.height ? { height: input.bounds.height } : {}),
      show: false,
    })
    this.configureWindow?.(browserWindow)
    this.ensureSurface({
      id: surfaceID,
      kind: "session-popout",
      windowID,
    })
    this.addPanelToSurface(surfaceID, input.panelID)
    if (sourceSurface) {
      sourceSurface.panelIDs.delete(input.panelID)
    }

    this.ownership.set(input.panelID, {
      panelID: input.panelID,
      ownerSurfaceID: surfaceID,
      ownerWindowID: sourceSurface?.windowID ?? MAIN_WORKBENCH_WINDOW_ID,
      reference: {
        kind: "session",
        sessionID: input.sessionID,
      },
      lastMainGroupID: input.lastMainGroupID ?? null,
      title: input.title,
    })
    this.registerWindow({
      browserWindow,
      id: windowID,
      kind: "session-popout",
      panelID: input.panelID,
      surfaceID,
    })

    const detachResult = new Promise<WorkbenchDetachSessionPanelResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingDetachTransactions.delete(input.panelID)
        this.restorePanelToMain(input.panelID, "restored")
        this.closeWindowForFailedDetach(windowID)
        reject(new Error("Session popout did not mount before the detach timeout."))
      }, DETACH_MOUNT_TIMEOUT_MS)

      this.pendingDetachTransactions.set(input.panelID, {
        panelID: input.panelID,
        reject,
        resolve,
        timer,
        windowID,
      })
    })

    void browserWindow.loadURL(resolveRendererUrlForWorkbenchWindow(this.rendererEntryUrl, windowID))
    return detachResult
  }

  markWindowReady(_input: WorkbenchWindowReadyInput) {
    // The renderer's first successful IPC round trip is enough for v1 readiness.
  }

  markPanelMounted(input: WorkbenchPanelMountedInput) {
    const windowRecord = this.windows.get(input.windowID)
    if (!windowRecord || windowRecord.kind !== "session-popout") {
      throw new Error("The session popout window does not own the mounted panel.")
    }
    const surface = this.surfaces.get(windowRecord.surfaceID)
    if (!surface?.panelIDs.has(input.panelID)) {
      throw new Error("The session popout surface does not own the mounted panel.")
    }

    const ownership = this.ownership.get(input.panelID)
    if (!ownership) {
      throw new Error("The mounted panel is not registered.")
    }

    const nextOwnership = {
      ...ownership,
      ownerSurfaceID: windowRecord.surfaceID,
      ownerWindowID: input.windowID,
    }
    this.ownership.set(input.panelID, nextOwnership)
    this.stateVersion += 1

    const transaction = this.pendingDetachTransactions.get(input.panelID)
    if (transaction) {
      clearTimeout(transaction.timer)
      this.pendingDetachTransactions.delete(input.panelID)
      const result = {
        ok: true,
        panelID: input.panelID,
        windowID: input.windowID,
        state: this.getSharedState(),
      } satisfies WorkbenchDetachSessionPanelResult
      transaction.resolve(result)
    }

    if (!windowRecord.browserWindow.isDestroyed()) {
      windowRecord.browserWindow.show()
      windowRecord.browserWindow.focus()
    }

    this.broadcast({
      reason: "detached",
      panelID: input.panelID,
      state: this.getSharedState(),
    })
    return this.getSharedState()
  }

  dockSessionPanel(input: WorkbenchDockSessionPanelInput) {
    return this.moveSessionPanel({
      panelID: input.panelID,
      placement: "within",
      sourceSurfaceID: input.windowID ? this.windows.get(input.windowID)?.surfaceID ?? null : null,
      targetGroupID: input.targetGroupID,
      targetSurfaceID: MAIN_WORKBENCH_SURFACE_ID,
    }).state
  }

  moveSessionPanel(input: WorkbenchMoveSessionPanelInput): WorkbenchMoveSessionPanelResult {
    const ownership = this.ownership.get(input.panelID) ?? this.createMainOwnershipForPanel(input.panelID)
    if (!ownership) {
      return {
        ok: false,
        reason: "missing-panel",
        state: this.getSharedState(),
      }
    }

    const sourceSurfaceID = input.sourceSurfaceID ?? getOwnershipSurfaceID(ownership)
    const targetSurfaceID = input.targetSurfaceID
    const sourceSurface = this.surfaces.get(sourceSurfaceID)
    const targetSurface = this.surfaces.get(targetSurfaceID)
    if (!sourceSurface || !targetSurface) {
      return {
        ok: false,
        reason: "missing-surface",
        state: this.getSharedState(),
      }
    }
    if (!sourceSurface.panelIDs.has(input.panelID)) {
      return {
        ok: false,
        reason: "source-panel-mismatch",
        state: this.getSharedState(),
      }
    }
    if (sourceSurfaceID === targetSurfaceID) {
      return {
        ok: false,
        reason: "same-surface",
        state: this.getSharedState(),
      }
    }

    const placement = input.placement ?? "within"
    sourceSurface.panelIDs.delete(input.panelID)
    targetSurface.panelIDs.add(input.panelID)
    const nextOwnership: WorkbenchPanelOwnership = {
      ...ownership,
      ownerSurfaceID: targetSurfaceID,
      ownerWindowID: targetSurface.windowID,
      lastMainGroupID: targetSurfaceID === MAIN_WORKBENCH_SURFACE_ID
        ? input.targetGroupID ?? ownership.lastMainGroupID ?? null
        : ownership.lastMainGroupID ?? null,
    }
    this.ownership.set(input.panelID, nextOwnership)
    this.stateVersion += 1

    const move = {
      panelID: input.panelID,
      placement,
      reference: ownership.reference,
      sourceSurfaceID,
      targetGroupID: input.targetGroupID ?? null,
      targetSurfaceID,
      title: ownership.title,
    }
    const state = this.getSharedState()
    this.broadcast({
      reason: "move",
      panelID: input.panelID,
      move,
      state,
    })
    this.closeEmptyPopoutSurface(sourceSurfaceID)

    return {
      ok: true,
      state: this.getSharedState(),
    }
  }

  focusSessionPanel(input: WorkbenchFocusSessionPanelInput): WorkbenchFocusSessionPanelResult {
    const state = this.getSharedState()
    const ownership = this.ownership.get(input.panelID)
    if (!ownership) {
      return {
        ok: false,
        panelID: input.panelID,
        reason: "missing-panel",
        state,
      }
    }

    const windowRecord = this.windows.get(ownership.ownerWindowID)
    if (!windowRecord || windowRecord.browserWindow.isDestroyed()) {
      return {
        ok: false,
        panelID: input.panelID,
        reason: "missing-window",
        state,
        windowID: ownership.ownerWindowID,
      }
    }

    if (windowRecord.browserWindow.isMinimized()) {
      windowRecord.browserWindow.restore()
    }
    if (!windowRecord.browserWindow.isVisible()) {
      windowRecord.browserWindow.show()
    }
    windowRecord.browserWindow.focus()

    const nextState = this.getSharedState()
    this.broadcast({
      reason: "focus",
      panelID: input.panelID,
      state: nextState,
    })

    return {
      ok: true,
      panelID: input.panelID,
      state: nextState,
      windowID: windowRecord.id,
    }
  }

  beginPanelDrag(input: WorkbenchPanelDragInput): WorkbenchPanelDragState {
    const dragState = {
      ...input,
      startedAt: Date.now(),
    }
    this.panelDrags.set(input.dragID, dragState)
    return dragState
  }

  endPanelDrag(input: { dragID: string }) {
    this.panelDrags.delete(input.dragID)
  }

  getPanelDrag(input: { dragID?: string }) {
    if (input.dragID) return this.panelDrags.get(input.dragID) ?? null
    return Array.from(this.panelDrags.values()).at(-1) ?? null
  }

  private registerWindow(record: WorkbenchWindowRecord) {
    this.windows.set(record.id, record)
    const webContentsID = record.browserWindow.webContents.id
    this.webContentsToWindowID.set(webContentsID, record.id)

    record.browserWindow.once("closed", () => {
      this.windows.delete(record.id)
      this.webContentsToWindowID.delete(webContentsID)
      const transaction = record.panelID ? this.pendingDetachTransactions.get(record.panelID) : null
      if (transaction) {
        clearTimeout(transaction.timer)
        this.pendingDetachTransactions.delete(record.panelID!)
        transaction.reject(new Error("Session popout closed before mounting."))
      }

      if (record.kind === "session-popout" && !this.windowsClosingForDock.has(record.id)) {
        this.restoreSurfacePanelsToMain(record.surfaceID, "restored")
      }
      this.windowsClosingForDock.delete(record.id)
    })

    record.browserWindow.webContents.once("render-process-gone", (_event, details) => {
      if (record.kind !== "session-popout") return
      recordShutdownDiagnostic("render-process-gone", {
        ...details,
        kind: record.kind,
        panelID: record.panelID,
        surfaceID: record.surfaceID,
        webContentsID,
        windowID: record.id,
      })
      safeWarn("[desktop] session popout renderer exited; restoring panel to main window.", details)
      this.restoreSurfacePanelsToMain(record.surfaceID, "restored")
      this.closeWindowForFailedDetach(record.id)
    })
  }

  private closeWindowForFailedDetach(windowID: string) {
    const windowRecord = this.windows.get(windowID)
    if (!windowRecord || windowRecord.browserWindow.isDestroyed()) return
    this.windowsClosingForDock.add(windowID)
    windowRecord.browserWindow.close()
  }

  private ensureSurface(input: { id: string; kind: WorkbenchSurfaceKind; windowID: string }) {
    const existing = this.surfaces.get(input.id)
    if (existing) {
      existing.kind = input.kind
      existing.windowID = input.windowID
      return existing
    }

    const surface: WorkbenchSurfaceRecord = {
      id: input.id,
      kind: input.kind,
      panelIDs: new Set(),
      windowID: input.windowID,
    }
    this.surfaces.set(input.id, surface)
    return surface
  }

  private addPanelToSurface(surfaceID: string, panelID: string) {
    const surface = this.surfaces.get(surfaceID)
    if (!surface) return
    surface.panelIDs.add(panelID)
  }

  private createMainOwnershipForPanel(panelID: string) {
    if (!panelID.startsWith("session:")) return null
    const sessionID = panelID.slice("session:".length)
    if (!sessionID) return null
    const panelSnapshot = this.panelSnapshots.get(panelID)
    const ownership: WorkbenchPanelOwnership = {
      panelID,
      ownerSurfaceID: MAIN_WORKBENCH_SURFACE_ID,
      ownerWindowID: MAIN_WORKBENCH_WINDOW_ID,
      reference: {
        kind: "session",
        sessionID,
      },
      title: panelSnapshot?.title,
    }
    this.ownership.set(panelID, ownership)
    this.addPanelToSurface(MAIN_WORKBENCH_SURFACE_ID, panelID)
    return ownership
  }

  private closeEmptyPopoutSurface(surfaceID: string) {
    if (surfaceID === MAIN_WORKBENCH_SURFACE_ID) return
    const surface = this.surfaces.get(surfaceID)
    if (!surface || surface.panelIDs.size > 0) return
    const windowRecord = this.windows.get(surface.windowID)
    if (!windowRecord || windowRecord.browserWindow.isDestroyed()) return
    this.windowsClosingForDock.add(surface.windowID)
    windowRecord.browserWindow.close()
    this.surfaces.delete(surfaceID)
  }

  private restoreSurfacePanelsToMain(surfaceID: string, reason: WorkbenchStateEvent["reason"]) {
    const surface = this.surfaces.get(surfaceID)
    if (!surface || surfaceID === MAIN_WORKBENCH_SURFACE_ID) return
    const panelIDs = Array.from(surface.panelIDs)
    for (const panelID of panelIDs) {
      this.restorePanelToMain(panelID, reason)
    }
    this.surfaces.delete(surfaceID)
  }

  private restorePanelToMain(panelID: string, reason: WorkbenchStateEvent["reason"]) {
    const ownership = this.ownership.get(panelID)
    if (!ownership || getOwnershipSurfaceID(ownership) === MAIN_WORKBENCH_SURFACE_ID) return

    const previousSurfaceID = getOwnershipSurfaceID(ownership)
    this.surfaces.get(previousSurfaceID)?.panelIDs.delete(panelID)
    this.addPanelToSurface(MAIN_WORKBENCH_SURFACE_ID, panelID)
    this.ownership.set(panelID, {
      ...ownership,
      ownerSurfaceID: MAIN_WORKBENCH_SURFACE_ID,
      ownerWindowID: MAIN_WORKBENCH_WINDOW_ID,
    })
    this.stateVersion += 1
    this.broadcast({
      reason,
      panelID,
      move: {
        panelID,
        placement: "within",
        reference: ownership.reference,
        sourceSurfaceID: previousSurfaceID,
        targetGroupID: ownership.lastMainGroupID ?? null,
        targetSurfaceID: MAIN_WORKBENCH_SURFACE_ID,
        title: ownership.title,
      },
      state: this.getSharedState(),
    })
  }

  private getSharedState(): WorkbenchSharedState {
    const ownership = Array.from(this.ownership.values())
    const surfaces: WorkbenchSurfaceSummary[] = Array.from(this.surfaces.values()).map((surface) => ({
      surfaceID: surface.id,
      kind: surface.kind,
      windowID: surface.windowID,
      ownedPanelIDs: Array.from(surface.panelIDs),
      layout: surface.layout,
    }))
    const windows: WorkbenchWindowSummary[] = Array.from(this.windows.values()).map((windowRecord) => ({
      id: windowRecord.id,
      kind: windowRecord.kind,
      ownedPanelIDs: this.surfaces.get(windowRecord.surfaceID)
        ? Array.from(this.surfaces.get(windowRecord.surfaceID)!.panelIDs)
        : getWindowOwnedPanelIDs(windowRecord.id, ownership),
      surfaceID: windowRecord.surfaceID,
    }))

    return {
      version: this.stateVersion,
      windows,
      surfaces,
      ownership,
      panels: Object.fromEntries(this.panelSnapshots.entries()),
    }
  }

  private broadcast(event: WorkbenchStateEvent) {
    for (const windowRecord of this.windows.values()) {
      const webContents = getWebContentsForWindowSafely(windowRecord.browserWindow)
      if (!webContents) continue
      sendWebContentsSafely(webContents, DESKTOP_WORKBENCH_STATE_EVENT_CHANNEL, event)
    }
  }
}
