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
    electronMock.on.mockClear()
    electronMock.removeListener.mockClear()
  })

  it("exposes local preview service detection", async () => {
    const services = [{ port: 5173, statusCode: 200, url: "http://localhost:5173/" }]
    electronMock.invoke.mockResolvedValueOnce(services)

    await expect(electronMock.exposedDesktopApi?.detectLocalPreviewServices()).resolves.toEqual(services)
    expect(electronMock.invoke).toHaveBeenCalledWith("desktop:detect-local-preview-services")
  })

  it("forwards the application-menu layout switcher event", () => {
    const api = electronMock.exposedDesktopApi as Record<string, (...args: unknown[]) => unknown>
    const listener = vi.fn()
    const unsubscribe = api.onOpenShellLayoutSwitcher(listener) as () => void
    const [, wrappedListener] = electronMock.on.mock.calls.at(-1) ?? []

    expect(electronMock.on).toHaveBeenLastCalledWith(
      "desktop:open-shell-layout-switcher",
      expect.any(Function),
    )
    ;(wrappedListener as (...args: unknown[]) => void)({}, { source: "application-menu" })
    expect(listener).toHaveBeenCalledWith({ source: "application-menu" })

    unsubscribe()
    expect(electronMock.removeListener).toHaveBeenCalledWith(
      "desktop:open-shell-layout-switcher",
      wrappedListener,
    )
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

  it("exposes session background process controls", async () => {
    const api = electronMock.exposedDesktopApi as Record<string, (...args: unknown[]) => Promise<unknown>>
    const listInput = { sessionID: "session-1" }
    const terminateInput = { sessionID: "session-1", processID: "process-1" }
    const list = { sessionID: "session-1", generatedAt: 1, items: [] }
    const terminated = { sessionID: "session-1", processID: "process-1", terminated: true }
    const terminatedAll = { sessionID: "session-1", terminatedProcessIDs: ["process-2"] }
    electronMock.invoke
      .mockResolvedValueOnce(list)
      .mockResolvedValueOnce(terminated)
      .mockResolvedValueOnce(terminatedAll)

    await expect(api.getSessionBackgroundProcesses(listInput)).resolves.toEqual(list)
    await expect(api.terminateSessionBackgroundProcess(terminateInput)).resolves.toEqual(terminated)
    await expect(api.terminateAllSessionBackgroundProcesses(listInput)).resolves.toEqual(terminatedAll)

    expect(electronMock.invoke).toHaveBeenNthCalledWith(1, "desktop:get-session-background-processes", listInput)
    expect(electronMock.invoke).toHaveBeenNthCalledWith(2, "desktop:terminate-session-background-process", terminateInput)
    expect(electronMock.invoke).toHaveBeenNthCalledWith(3, "desktop:terminate-all-session-background-processes", listInput)
  })

  it("exposes the bounded semantic token inspector bridge and detach events", async () => {
    const api = electronMock.exposedDesktopApi as Record<string, (...args: unknown[]) => unknown>
    const input = {
      x: 20,
      y: 30,
      ancestorDepth: 0,
      requestID: 4,
      resolvedColorMode: "light",
    }
    electronMock.invoke
      .mockResolvedValueOnce({ status: "active" })
      .mockResolvedValueOnce({ status: "ok", requestID: 4, inspection: { target: {}, properties: [], warnings: [] } })
      .mockResolvedValueOnce({ status: "inactive" })

    await expect(api.startSemanticTokenInspector()).resolves.toEqual({ status: "active" })
    await expect(api.inspectSemanticTokenAtPoint(input)).resolves.toMatchObject({ status: "ok", requestID: 4 })
    await expect(api.stopSemanticTokenInspector()).resolves.toEqual({ status: "inactive" })

    expect(electronMock.invoke).toHaveBeenNthCalledWith(1, "desktop:start-semantic-token-inspector")
    expect(electronMock.invoke).toHaveBeenNthCalledWith(2, "desktop:inspect-semantic-token-at-point", input)
    expect(electronMock.invoke).toHaveBeenNthCalledWith(3, "desktop:stop-semantic-token-inspector")

    const prepareInput = {
      sessionID: "authoring-session",
      draft: {
        version: 1,
        sourceThemeID: "built-in:classic",
        operations: [],
      },
    }
    const transactionInput = { transactionID: "transaction-1" }
    electronMock.invoke
      .mockResolvedValueOnce({ status: "prepared", transactionID: "transaction-1" })
      .mockResolvedValueOnce({ status: "committed", files: [] })
      .mockResolvedValueOnce({ status: "discarded" })

    await api.prepareSemanticTokenAuthoringCommit(prepareInput)
    await api.commitSemanticTokenAuthoringCommit(transactionInput)
    await api.discardSemanticTokenAuthoringCommit(transactionInput)

    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      4,
      "desktop:prepare-semantic-token-authoring-commit",
      prepareInput,
    )
    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      5,
      "desktop:commit-semantic-token-authoring-commit",
      transactionInput,
    )
    expect(electronMock.invoke).toHaveBeenNthCalledWith(
      6,
      "desktop:discard-semantic-token-authoring-commit",
      transactionInput,
    )

    const listener = vi.fn()
    const unsubscribe = api.onSemanticTokenInspectorEvent(listener) as () => void
    const [, wrappedListener] = electronMock.on.mock.calls.at(-1) ?? []
    expect(electronMock.on).toHaveBeenLastCalledWith(
      "desktop:semantic-token-inspector-event",
      expect.any(Function),
    )
    ;(wrappedListener as (...args: unknown[]) => void)({}, {
      type: "detached",
      reason: "devtools-opened",
      message: "DevTools opened.",
    })
    expect(listener).toHaveBeenCalledWith({
      type: "detached",
      reason: "devtools-opened",
      message: "DevTools opened.",
    })

    unsubscribe()
    expect(electronMock.removeListener).toHaveBeenCalledWith(
      "desktop:semantic-token-inspector-event",
      wrappedListener,
    )
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
