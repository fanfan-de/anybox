import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => ({
  exposedDesktopApi: null as null | Record<string, (...args: never[]) => Promise<unknown>>,
  exposeInMainWorld: vi.fn((key: string, value: unknown) => {
    if (key === "desktop") {
      electronMock.exposedDesktopApi = value as { detectLocalPreviewServices: () => Promise<unknown> }
    }
  }),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: electronMock.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMock.invoke,
    on: electronMock.on,
    removeListener: electronMock.removeListener,
  },
}))

await import("./index")

describe("desktop preload bridge", () => {
  beforeEach(() => {
    electronMock.invoke.mockReset()
  })

  it("exposes local preview service detection", async () => {
    const services = [{ port: 5173, statusCode: 200, url: "http://localhost:5173/" }]
    electronMock.invoke.mockResolvedValueOnce(services)

    await expect(electronMock.exposedDesktopApi?.detectLocalPreviewServices()).resolves.toEqual(services)
    expect(electronMock.invoke).toHaveBeenCalledWith("desktop:detect-local-preview-services")
  })

  it("exposes storage usage snapshots", async () => {
    const snapshot = {
      generatedAt: 1,
      database: {
        path: "C:\\Users\\tester\\AppData\\Roaming\\Anybox\\agent_local_data.db",
        totalBytes: 4096,
        mainBytes: 4096,
        walBytes: 0,
        shmBytes: 0,
        pageSize: 4096,
        pageCount: 1,
        freelistBytes: 0,
      },
      categories: [],
      archivedSessions: [],
      tables: [],
    }
    electronMock.invoke.mockResolvedValueOnce(snapshot)

    await expect(electronMock.exposedDesktopApi?.getStorageUsage()).resolves.toEqual(snapshot)
    expect(electronMock.invoke).toHaveBeenCalledWith("desktop:get-storage-usage")
  })

  it("exposes image saving to a selected folder", async () => {
    const result = { canceled: false, path: "C:\\Pictures\\image.png" }
    const input = {
      dataUrl: "data:image/png;base64,aW1hZ2U=",
      mimeType: "image/png",
      name: "image.png",
    }
    const saveImageToFolder = electronMock.exposedDesktopApi?.saveImageToFolder as
      | ((value: typeof input) => Promise<unknown>)
      | undefined
    electronMock.invoke.mockResolvedValueOnce(result)

    expect(saveImageToFolder).toBeDefined()
    await expect(saveImageToFolder?.(input)).resolves.toEqual(result)
    expect(electronMock.invoke).toHaveBeenCalledWith("desktop:save-image-to-folder", input)
  })
})
