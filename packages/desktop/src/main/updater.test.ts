import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  isPackaged: false,
  userDataPath: "",
  version: "1.2.3",
  windows: [] as Array<{ isDestroyed: () => boolean; webContents: unknown }>,
  getPath: vi.fn(() => electronMock.userDataPath),
  showMessageBox: vi.fn(),
}))

const electronUpdaterMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    forceDevUpdateConfig: false,
    checkForUpdates: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      handlers.set(event, listener)
    }),
    quitAndInstall: vi.fn(),
  }

  return {
    autoUpdater,
    handlers,
  }
})

const agentClientMock = vi.hoisted(() => ({
  requestAgentJSON: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return electronMock.isPackaged
    },
    getPath: electronMock.getPath,
    getVersion: () => electronMock.version,
  },
  BrowserWindow: {
    getAllWindows: () => electronMock.windows,
    getFocusedWindow: () => null,
  },
  dialog: {
    showMessageBox: electronMock.showMessageBox,
  },
}))

vi.mock("electron-updater", () => ({
  autoUpdater: electronUpdaterMock.autoUpdater,
  default: {
    autoUpdater: electronUpdaterMock.autoUpdater,
  },
}))

vi.mock("./agent-client", () => ({
  requestAgentJSON: agentClientMock.requestAgentJSON,
}))

const updater = await import("./updater")

let tempDir: string | null = null

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "anybox-updater-test-"))
  electronMock.userDataPath = tempDir
  electronMock.isPackaged = false
  electronMock.windows = []
  electronMock.getPath.mockClear()
  electronMock.showMessageBox.mockReset()
  electronMock.showMessageBox.mockResolvedValue({ response: 0 })
  electronUpdaterMock.handlers.clear()
  electronUpdaterMock.autoUpdater.autoDownload = false
  electronUpdaterMock.autoUpdater.autoInstallOnAppQuit = false
  electronUpdaterMock.autoUpdater.forceDevUpdateConfig = false
  electronUpdaterMock.autoUpdater.checkForUpdates.mockReset()
  electronUpdaterMock.autoUpdater.on.mockClear()
  electronUpdaterMock.autoUpdater.quitAndInstall.mockReset()
  agentClientMock.requestAgentJSON.mockReset()
  agentClientMock.requestAgentJSON.mockResolvedValue({
    data: {
      runningSessions: {
        count: 0,
        items: [],
      },
    },
  })
  updater.internal.resetAppUpdateRuntimeStateForTests()
})

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe("app updater state", () => {
  it("persists automatic update settings and includes them in state", async () => {
    await expect(updater.setAutomaticAppUpdatesEnabled(false)).resolves.toMatchObject({
      automaticUpdates: false,
      version: "1.2.3",
    })

    await expect(updater.getAppUpdateStateSnapshot()).resolves.toMatchObject({
      automaticUpdates: false,
      phase: "idle",
      version: "1.2.3",
    })
  })

  it("marks unpackaged update checks as unsupported without showing renderer-backed dialogs", async () => {
    electronMock.windows = [{ isDestroyed: () => false, webContents: {} }]

    const result = await updater.checkForAppUpdates({ manual: true })

    expect(result).toMatchObject({
      ok: true,
      skipped: true,
      reason: "not-packaged",
      state: {
        phase: "unsupported",
        error: "Update checks run in packaged builds.",
      },
    })
    expect(electronMock.showMessageBox).not.toHaveBeenCalled()
  })

  it("maps electron-updater events into a readable update state", async () => {
    electronMock.isPackaged = true
    electronMock.windows = [{ isDestroyed: () => false, webContents: {} }]
    updater.initializeAutoUpdater()

    electronUpdaterMock.handlers.get("checking-for-update")?.()
    expect(await updater.getAppUpdateStateSnapshot()).toMatchObject({
      phase: "checking",
      downloadPercent: null,
      error: null,
    })

    electronUpdaterMock.handlers.get("update-available")?.({
      version: "1.2.4",
      releaseNotes: "Improved update center.",
    })
    expect(await updater.getAppUpdateStateSnapshot()).toMatchObject({
      phase: "available",
      latestVersion: "1.2.4",
      releaseNotes: "Improved update center.",
    })

    electronUpdaterMock.handlers.get("download-progress")?.({ percent: 42 })
    expect(await updater.getAppUpdateStateSnapshot()).toMatchObject({
      phase: "downloading",
      downloadPercent: 42,
      downloadTransferredBytes: null,
      downloadTotalBytes: null,
      downloadBytesPerSecond: null,
    })

    electronUpdaterMock.handlers.get("download-progress")?.({
      bytesPerSecond: 1_250_000,
      percent: 45,
      total: 100_000_000,
      transferred: 45_000_000,
    })
    expect(await updater.getAppUpdateStateSnapshot()).toMatchObject({
      phase: "downloading",
      downloadPercent: 45,
      downloadTransferredBytes: 45_000_000,
      downloadTotalBytes: 100_000_000,
      downloadBytesPerSecond: 1_250_000,
    })

    electronUpdaterMock.handlers.get("update-downloaded")?.({ version: "1.2.4" })
    expect(await updater.getAppUpdateStateSnapshot()).toMatchObject({
      phase: "downloaded",
      latestVersion: "1.2.4",
      downloadPercent: 100,
      downloadTransferredBytes: 100_000_000,
      downloadTotalBytes: 100_000_000,
      downloadBytesPerSecond: null,
    })
  })

  it("reports already-checking and installs only after an update is downloaded", async () => {
    electronMock.isPackaged = true
    electronUpdaterMock.autoUpdater.checkForUpdates.mockResolvedValue(undefined)

    await updater.checkForAppUpdates({ manual: true })
    const duplicate = await updater.checkForAppUpdates({ manual: true })
    expect(duplicate).toMatchObject({
      ok: true,
      skipped: true,
      reason: "already-checking",
      state: {
        phase: "checking",
      },
    })

    await expect(updater.installDownloadedAppUpdate()).resolves.toEqual({
      ok: false,
      reason: "update-not-downloaded",
    })

    electronMock.windows = [{ isDestroyed: () => false, webContents: {} }]
    electronUpdaterMock.handlers.get("update-downloaded")?.({ version: "1.2.4" })
    await expect(updater.installDownloadedAppUpdate()).resolves.toEqual({ ok: true })
    expect(electronUpdaterMock.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it("blocks installing a downloaded update while an agent session is running", async () => {
    electronMock.isPackaged = true
    electronMock.windows = [{ isDestroyed: () => false, webContents: {} }]
    agentClientMock.requestAgentJSON.mockResolvedValue({
      data: {
        runningSessions: {
          count: 1,
          items: [{ sessionID: "session-running" }],
        },
      },
    })
    updater.initializeAutoUpdater()

    electronUpdaterMock.handlers.get("update-downloaded")?.({ version: "1.2.4" })

    await expect(updater.installDownloadedAppUpdate()).resolves.toEqual({
      ok: false,
      reason: "session-running",
    })
    expect(electronUpdaterMock.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it("notifies listeners when update state changes", async () => {
    const listener = vi.fn()
    updater.onAppUpdateStateChanged(listener)

    electronMock.isPackaged = true
    updater.initializeAutoUpdater()
    electronUpdaterMock.handlers.get("update-not-available")?.({ version: "1.2.3" })
    await flushMicrotasks()

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      phase: "up-to-date",
      latestVersion: "1.2.3",
    }))
  })
})
