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

  it("exposes skill registry discovery and managed download channels", async () => {
    const api = electronMock.exposedDesktopApi as Record<string, (...args: unknown[]) => Promise<unknown>>
    electronMock.invoke.mockResolvedValue(undefined)

    await api.getSkillRegistryProviders()
    await api.searchSkillRegistry({ query: "docs", limit: 20, sort: "relevance", safeOnly: true })
    await api.getSkillRegistryDetail({ provider: "clawhub", remoteId: "demo/docs" })
    await api.getSkillRegistryFiles({ provider: "clawhub", remoteId: "demo/docs", version: "1.0.0" })
    await api.readSkillRegistryFile({ provider: "clawhub", remoteId: "demo/docs", version: "1.0.0", path: "SKILL.md" })
    await api.downloadSkillRegistrySkill({ provider: "clawhub", remoteId: "demo/docs", version: "1.0.0" })
    await api.listDownloadedRegistrySkills()
    await api.setDownloadedRegistrySkillEnabled({ id: "registry:clawhub:demo/docs", enabled: true })
    await api.readDownloadedRegistrySkillFile({ id: "registry:clawhub:demo/docs", path: "SKILL.md" })
    await api.listDownloadedRegistrySkillFiles({ id: "registry:clawhub:demo/docs", version: "1.0.0" })
    await api.forkDownloadedRegistrySkill({ id: "registry:clawhub:demo/docs" })
    await api.deleteDownloadedRegistrySkill({ id: "registry:clawhub:demo/docs" })
    await api.getSkillRegistryVersions({ provider: "clawhub", remoteId: "demo/docs" })
    await api.getSkillRegistrySecurity({ provider: "clawhub", remoteId: "demo/docs", version: "1.0.0" })
    await api.previewDownloadedRegistrySkillUpdate({ id: "registry:clawhub:demo/docs" })
    await api.updateDownloadedRegistrySkill({ id: "registry:clawhub:demo/docs", version: "2.0.0" })
    await api.rollbackDownloadedRegistrySkill({ id: "registry:clawhub:demo/docs", version: "1.0.0" })

    expect(electronMock.invoke).toHaveBeenNthCalledWith(1, "desktop:get-skill-registry-providers")
    expect(electronMock.invoke).toHaveBeenNthCalledWith(2, "desktop:search-skill-registry", { query: "docs", limit: 20, sort: "relevance", safeOnly: true })
    expect(electronMock.invoke).toHaveBeenNthCalledWith(6, "desktop:download-skill-registry-skill", { provider: "clawhub", remoteId: "demo/docs", version: "1.0.0" })
    expect(electronMock.invoke).toHaveBeenNthCalledWith(7, "desktop:list-downloaded-registry-skills")
    expect(electronMock.invoke).toHaveBeenNthCalledWith(10, "desktop:list-downloaded-registry-skill-files", { id: "registry:clawhub:demo/docs", version: "1.0.0" })
    expect(electronMock.invoke).toHaveBeenNthCalledWith(11, "desktop:fork-downloaded-registry-skill", { id: "registry:clawhub:demo/docs" })
    expect(electronMock.invoke).toHaveBeenNthCalledWith(12, "desktop:delete-downloaded-registry-skill", { id: "registry:clawhub:demo/docs" })
    expect(electronMock.invoke).toHaveBeenCalledWith("desktop:get-skill-registry-versions", { provider: "clawhub", remoteId: "demo/docs" })
    expect(electronMock.invoke).toHaveBeenCalledWith("desktop:get-skill-registry-security", { provider: "clawhub", remoteId: "demo/docs", version: "1.0.0" })
    expect(electronMock.invoke).toHaveBeenCalledWith("desktop:preview-downloaded-registry-skill-update", { id: "registry:clawhub:demo/docs" })
    expect(electronMock.invoke).toHaveBeenCalledWith("desktop:update-downloaded-registry-skill", { id: "registry:clawhub:demo/docs", version: "2.0.0" })
    expect(electronMock.invoke).toHaveBeenCalledWith("desktop:rollback-downloaded-registry-skill", { id: "registry:clawhub:demo/docs", version: "1.0.0" })
  })

  it("exposes read-only installed plugin Skill browsing channels", async () => {
    const api = electronMock.exposedDesktopApi as Record<string, (...args: unknown[]) => Promise<unknown>>
    const directoryInput = {
      pluginID: "docs",
      skillID: "plugin:docs:review",
      path: "references",
    }
    const fileInput = {
      pluginID: "docs",
      skillID: "plugin:docs:review",
      path: "references/checklist.md",
    }
    const directory = {
      pluginID: "docs",
      skillID: "plugin:docs:review",
      skillName: "Review Docs",
      path: "references",
      entries: [],
      readOnly: true,
    }
    const file = {
      pluginID: "docs",
      skillID: "plugin:docs:review",
      skillName: "Review Docs",
      path: "references/checklist.md",
      name: "checklist.md",
      kind: "text",
      mimeType: "text/markdown",
      size: 12,
      content: "# Checklist",
      tooLarge: false,
      readOnly: true,
    }
    electronMock.invoke
      .mockResolvedValueOnce(directory)
      .mockResolvedValueOnce(file)

    await expect(api.listInstalledPluginSkillEntries(directoryInput)).resolves.toEqual(directory)
    await expect(api.readInstalledPluginSkillFile(fileInput)).resolves.toEqual(file)

    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      1,
      "desktop:list-installed-plugin-skill-entries",
      directoryInput,
    )
    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      2,
      "desktop:read-installed-plugin-skill-file",
      fileInput,
    )
  })
})
