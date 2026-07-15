import { beforeEach, describe, expect, it, vi } from "vitest"

const shutdownDiagnosticsMock = vi.hoisted(() => ({
  recordShutdownDiagnostic: vi.fn(),
}))

const electronMock = vi.hoisted(() => {
  const { EventEmitter } = require("node:events") as typeof import("node:events")
  const createdWindows: any[] = []

  class FakeWebContents extends EventEmitter {
    readonly id: number
    readonly sent: Array<{ channel: string; payload: unknown }> = []
    private destroyed = false

    constructor(id: number) {
      super()
      this.id = id
    }

    isDestroyed() {
      return this.destroyed
    }

    send(channel: string, payload: unknown) {
      this.sent.push({ channel, payload })
    }
  }

  class FakeBrowserWindow extends EventEmitter {
    focused = false
    loadedUrl: string | null = null
    shown = false
    visible = true
    private readonly webContentsRef: FakeWebContents
    private destroyed = false
    private minimized = false

    constructor() {
      super()
      this.webContentsRef = new FakeWebContents(createdWindows.length + 1)
      createdWindows.push(this)
    }

    get webContents() {
      if (this.destroyed) throw new Error("Object has been destroyed")
      return this.webContentsRef
    }

    isDestroyed() {
      return this.destroyed
    }

    loadURL(url: string) {
      this.loadedUrl = url
      return Promise.resolve()
    }

    show() {
      this.shown = true
      this.visible = true
    }

    focus() {
      this.focused = true
    }

    isMinimized() {
      return this.minimized
    }

    isVisible() {
      return this.visible
    }

    restore() {
      this.minimized = false
    }

    close() {
      this.destroyed = true
      this.emit("closed")
    }
  }

  return {
    BrowserWindow: FakeBrowserWindow,
    createdWindows,
  }
})

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
}))

vi.mock("./shutdown-diagnostics", () => shutdownDiagnosticsMock)

import type { DesktopRendererMemoryDiagnosticsRecord } from "../shared/desktop-ipc-contract"
import {
  resetRendererMemoryDiagnosticsStoreForTest,
  setRendererMemoryDiagnosticsRecord,
} from "./renderer-memory-diagnostics-store"
import { WorkbenchWindowManager } from "./workbench-window-manager"

beforeEach(() => {
  shutdownDiagnosticsMock.recordShutdownDiagnostic.mockReset()
  resetRendererMemoryDiagnosticsStoreForTest()
})

function createRendererMemoryDiagnosticsRecord(
  webContentsID: number,
): DesktopRendererMemoryDiagnosticsRecord {
  return {
    currentSession: {
      assistantMessageCount: 1,
      currentSessionID: "session-1",
      diffChars: 2,
      draftPatchChars: 3,
      maxTraceItemChars: 4,
      messageCount: 5,
      messageTreeContentChars: 6,
      messageTreeNodeCount: 7,
      streamingAssistantMessageCount: 1,
      toolInputChars: 8,
      toolOutputChars: 9,
      traceItemCount: 10,
      traceTextChars: 11,
      updatedAt: 100,
    },
    heap: {
      jsHeapSizeLimit: 4_000,
      totalJSHeapSize: 2_000,
      usedJSHeapSize: 1_000,
    },
    performanceEntries: {
      mark: 12,
      measure: 13,
      navigation: 1,
      paint: 2,
      resource: 14,
      total: 42,
    },
    senderURL: "http://127.0.0.1:5173/index.html",
    source: "renderer",
    timestamp: 100,
    webContentsID,
  }
}

describe("WorkbenchWindowManager", () => {
  it("does not rebroadcast identical renderer snapshots", () => {
    electronMock.createdWindows.length = 0
    const mainWindow = new electronMock.BrowserWindow()
    const manager = new WorkbenchWindowManager({
      rendererEntryUrl: "http://127.0.0.1:5173/index.html",
      createPopoutWindowOptions: () => ({
        width: 1000,
        height: 700,
      }),
    })
    manager.registerMainWindow(mainWindow as any)

    const snapshot = {
      version: 0,
      windows: [],
      surfaces: [
        {
          surfaceID: "main",
          kind: "main" as const,
          windowID: "main",
          ownedPanelIDs: ["session:session-1"],
        },
      ],
      ownership: [],
      panels: {
        "session:session-1": {
          panelID: "session:session-1",
          reference: { kind: "session" as const, sessionID: "session-1" },
          title: "Session 1",
        },
      },
    }

    manager.publishStateSnapshot(snapshot)
    manager.publishStateSnapshot(snapshot)

    expect(mainWindow.webContents.sent).toHaveLength(1)
  })

  it("commits ownership only after the popout panel mounts and docks it back on request", async () => {
    electronMock.createdWindows.length = 0
    const mainWindow = new electronMock.BrowserWindow()
    const manager = new WorkbenchWindowManager({
      rendererEntryUrl: "http://127.0.0.1:5173/index.html",
      createPopoutWindowOptions: () => ({
        width: 1000,
        height: 700,
      }),
    })
    manager.registerMainWindow(mainWindow as any)

    const pendingDetach = manager.detachSessionPanel({
      panelID: "session:session-1",
      sessionID: "session-1",
      title: "Session 1",
      lastMainGroupID: "group-1",
    })
    const popoutWindow = electronMock.createdWindows[1]
    const popoutContext = manager.getWindowContext(popoutWindow.webContents as any)

    expect(popoutContext.kind).toBe("session-popout")
    expect(popoutContext.reference).toEqual({ kind: "session", sessionID: "session-1" })
    expect(popoutWindow.loadedUrl).toContain("workbenchWindowID=")

    manager.markPanelMounted({
      panelID: "session:session-1",
      windowID: popoutContext.windowID,
    })
    const detachResult = await pendingDetach

    expect(detachResult.windowID).toBe(popoutContext.windowID)
    expect(popoutWindow.shown).toBe(true)
    expect(detachResult.state.ownership[0]).toEqual(expect.objectContaining({
      ownerWindowID: popoutContext.windowID,
      ownerSurfaceID: popoutContext.surfaceID,
      panelID: "session:session-1",
    }))

    const dockedState = manager.dockSessionPanel({
      panelID: "session:session-1",
      windowID: popoutContext.windowID,
      reason: "button",
    })

    expect(dockedState.ownership[0]).toEqual(expect.objectContaining({
      ownerWindowID: "main",
      ownerSurfaceID: "main",
      panelID: "session:session-1",
    }))
    expect(popoutWindow.isDestroyed()).toBe(true)
  })

  it("moves a panel from a popout surface back to the main surface", async () => {
    electronMock.createdWindows.length = 0
    const mainWindow = new electronMock.BrowserWindow()
    const manager = new WorkbenchWindowManager({
      rendererEntryUrl: "http://127.0.0.1:5173/index.html",
      createPopoutWindowOptions: () => ({
        width: 1000,
        height: 700,
      }),
    })
    manager.registerMainWindow(mainWindow as any)

    manager.publishStateSnapshot({
      version: 0,
      windows: [],
      surfaces: [
        {
          surfaceID: "main",
          kind: "main",
          windowID: "main",
          ownedPanelIDs: ["session:session-1"],
        },
      ],
      ownership: [],
      panels: {
        "session:session-1": {
          panelID: "session:session-1",
          reference: { kind: "session", sessionID: "session-1" },
          title: "Session 1",
        },
      },
    })

    const pendingDetach = manager.detachSessionPanel({
      panelID: "session:session-1",
      sessionID: "session-1",
      title: "Session 1",
      lastMainGroupID: "group-1",
    })
    const popoutWindow = electronMock.createdWindows[1]
    const popoutContext = manager.getWindowContext(popoutWindow.webContents as any)
    manager.markPanelMounted({
      panelID: "session:session-1",
      windowID: popoutContext.windowID,
    })
    await pendingDetach

    const moveResult = manager.moveSessionPanel({
      panelID: "session:session-1",
      sourceSurfaceID: popoutContext.surfaceID,
      targetGroupID: "group-1",
      targetSurfaceID: "main",
    })

    expect(moveResult.ok).toBe(true)
    expect(moveResult.state.ownership[0]).toEqual(expect.objectContaining({
      ownerSurfaceID: "main",
      ownerWindowID: "main",
    }))
    expect(moveResult.state.surfaces?.find((surface) => surface.surfaceID === "main")?.ownedPanelIDs).toContain("session:session-1")
    expect(popoutWindow.isDestroyed()).toBe(true)
  })

  it("focuses an existing popout panel without moving ownership", async () => {
    electronMock.createdWindows.length = 0
    const mainWindow = new electronMock.BrowserWindow()
    const manager = new WorkbenchWindowManager({
      rendererEntryUrl: "http://127.0.0.1:5173/index.html",
      createPopoutWindowOptions: () => ({
        width: 1000,
        height: 700,
      }),
    })
    manager.registerMainWindow(mainWindow as any)

    manager.publishStateSnapshot({
      version: 0,
      windows: [],
      surfaces: [
        {
          surfaceID: "main",
          kind: "main",
          windowID: "main",
          ownedPanelIDs: ["session:session-1"],
        },
      ],
      ownership: [],
      panels: {
        "session:session-1": {
          panelID: "session:session-1",
          reference: { kind: "session", sessionID: "session-1" },
          title: "Session 1",
        },
      },
    })

    const pendingDetach = manager.detachSessionPanel({
      panelID: "session:session-1",
      sessionID: "session-1",
      title: "Session 1",
      lastMainGroupID: "group-1",
    })
    const popoutWindow = electronMock.createdWindows[1]
    const popoutContext = manager.getWindowContext(popoutWindow.webContents as any)
    manager.markPanelMounted({
      panelID: "session:session-1",
      windowID: popoutContext.windowID,
    })
    await pendingDetach

    mainWindow.webContents.sent.length = 0
    popoutWindow.webContents.sent.length = 0
    popoutWindow.focused = false

    const result = manager.focusSessionPanel({
      panelID: "session:session-1",
    })

    expect(result.ok).toBe(true)
    expect(result.windowID).toBe(popoutContext.windowID)
    expect(popoutWindow.focused).toBe(true)
    expect(result.state.ownership[0]).toEqual(expect.objectContaining({
      ownerSurfaceID: popoutContext.surfaceID,
      ownerWindowID: popoutContext.windowID,
    }))
    expect(popoutWindow.webContents.sent.at(-1)?.payload).toEqual(expect.objectContaining({
      panelID: "session:session-1",
      reason: "focus",
    }))
  })

  it("logs the last renderer memory snapshot when a session popout renderer exits", async () => {
    electronMock.createdWindows.length = 0
    const mainWindow = new electronMock.BrowserWindow()
    const manager = new WorkbenchWindowManager({
      rendererEntryUrl: "http://127.0.0.1:5173/index.html",
      createPopoutWindowOptions: () => ({
        width: 1000,
        height: 700,
      }),
    })
    manager.registerMainWindow(mainWindow as any)

    const pendingDetach = manager.detachSessionPanel({
      panelID: "session:session-1",
      sessionID: "session-1",
      title: "Session 1",
      lastMainGroupID: "group-1",
    })
    const popoutWindow = electronMock.createdWindows[1]
    const popoutContext = manager.getWindowContext(popoutWindow.webContents as any)
    manager.markPanelMounted({
      panelID: "session:session-1",
      windowID: popoutContext.windowID,
    })
    await pendingDetach

    const webContentsID = popoutWindow.webContents.id
    const snapshot = createRendererMemoryDiagnosticsRecord(webContentsID)
    setRendererMemoryDiagnosticsRecord(snapshot)
    popoutWindow.webContents.emit("render-process-gone", {}, { exitCode: -1, reason: "oom" })

    expect(shutdownDiagnosticsMock.recordShutdownDiagnostic).toHaveBeenCalledWith(
      "render-process-gone",
      expect.objectContaining({
        lastRendererMemoryDiagnostics: snapshot,
        reason: "oom",
        webContentsID,
      }),
    )
    expect(popoutWindow.isDestroyed()).toBe(true)
  })

  it("keeps a popout window alive when moving one of multiple panels out", async () => {
    electronMock.createdWindows.length = 0
    const mainWindow = new electronMock.BrowserWindow()
    const manager = new WorkbenchWindowManager({
      rendererEntryUrl: "http://127.0.0.1:5173/index.html",
      createPopoutWindowOptions: () => ({
        width: 1000,
        height: 700,
      }),
    })
    manager.registerMainWindow(mainWindow as any)
    manager.publishStateSnapshot({
      version: 0,
      windows: [],
      surfaces: [
        {
          surfaceID: "main",
          kind: "main",
          windowID: "main",
          ownedPanelIDs: ["session:session-1", "session:session-2"],
        },
      ],
      ownership: [],
      panels: {
        "session:session-1": {
          panelID: "session:session-1",
          reference: { kind: "session", sessionID: "session-1" },
          title: "Session 1",
        },
        "session:session-2": {
          panelID: "session:session-2",
          reference: { kind: "session", sessionID: "session-2" },
          title: "Session 2",
        },
      },
    })

    const pendingDetach = manager.detachSessionPanel({
      panelID: "session:session-1",
      sessionID: "session-1",
      title: "Session 1",
      lastMainGroupID: "group-1",
    })
    const popoutWindow = electronMock.createdWindows[1]
    const popoutContext = manager.getWindowContext(popoutWindow.webContents as any)
    manager.markPanelMounted({
      panelID: "session:session-1",
      windowID: popoutContext.windowID,
    })
    await pendingDetach

    const mergeResult = manager.moveSessionPanel({
      panelID: "session:session-2",
      sourceSurfaceID: "main",
      targetSurfaceID: popoutContext.surfaceID!,
    })
    expect(mergeResult.ok).toBe(true)
    expect(popoutWindow.isDestroyed()).toBe(false)

    const moveBackResult = manager.moveSessionPanel({
      panelID: "session:session-2",
      sourceSurfaceID: popoutContext.surfaceID,
      targetSurfaceID: "main",
    })

    expect(moveBackResult.ok).toBe(true)
    expect(popoutWindow.isDestroyed()).toBe(false)
    expect(moveBackResult.state.surfaces?.find((surface) => surface.surfaceID === popoutContext.surfaceID)?.ownedPanelIDs).toEqual([
      "session:session-1",
    ])
  })

  it("rejects moves that do not match the source surface", () => {
    electronMock.createdWindows.length = 0
    const mainWindow = new electronMock.BrowserWindow()
    const manager = new WorkbenchWindowManager({
      rendererEntryUrl: "http://127.0.0.1:5173/index.html",
      createPopoutWindowOptions: () => ({
        width: 1000,
        height: 700,
      }),
    })
    manager.registerMainWindow(mainWindow as any)

    const result = manager.moveSessionPanel({
      panelID: "session:missing",
      sourceSurfaceID: "popout:missing",
      targetSurfaceID: "main",
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("missing-surface")
  })
})
