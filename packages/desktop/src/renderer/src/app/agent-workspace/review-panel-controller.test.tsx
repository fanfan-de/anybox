import { act, renderHook, waitFor } from "@testing-library/react"
import { useRef, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import type {
  ComposerDraftState,
  RightSidebarOpenTabInput,
  RightSidebarTab,
  RightSidebarTabUpdate,
  WorkspaceFileComment,
  WorkspaceFileReviewState,
  WorkspaceGroup,
  WorkspacePreviewState,
} from "../types"
import { useReviewPanelController } from "./review-panel-controller"
import { DEFAULT_WORKSPACE_FILE_REVIEW_STATE, DEFAULT_WORKSPACE_PREVIEW_STATE } from "./review-preview-state"
import type { WorkspaceStateUpdater } from "./workspace-store"

function createWorkspace(): WorkspaceGroup {
  return {
    id: "workspace-1",
    name: "Workspace",
    directory: "C:/work/workspace-1",
    created: 1,
    updated: 1,
    project: {
      id: "project-1",
      name: "Project",
      worktree: "C:/work/workspace-1",
    },
    sessions: [],
  }
}

function applyUpdate<T>(current: T, update: WorkspaceStateUpdater<T>) {
  return typeof update === "function" ? (update as (value: T) => T)(current) : update
}

function normalizeTargetSegment(value: string | null | undefined) {
  return value?.trim().replace(/\\/g, "/").toLowerCase() || "__none__"
}

function getTabTargetKey(input: RightSidebarOpenTabInput) {
  if (input.targetKey?.trim()) return input.targetKey.trim()

  switch (input.kind) {
    case "files":
      return ["files", normalizeTargetSegment(input.scopeDirectory), normalizeTargetSegment(input.filePath)].join(":")
    case "browser":
      return ["browser", normalizeTargetSegment(input.workspaceID), normalizeTargetSegment(input.target)].join(":")
    case "review":
      return ["review", normalizeTargetSegment(input.sessionID)].join(":")
    case "terminal":
      return ["terminal", normalizeTargetSegment(input.sessionID)].join(":")
    case "side-chat":
      return [
        "side-chat",
        normalizeTargetSegment(input.parentSessionID),
        normalizeTargetSegment(input.anchorMessageID),
      ].join(":")
    case "message-tree":
      return ["message-tree", normalizeTargetSegment(input.sessionID)].join(":")
    case "message-inspector":
      return "message-inspector"
  }
}

function createRightSidebarTab(input: RightSidebarOpenTabInput, index: number): RightSidebarTab {
  const base = {
    id: `right-tab-${String(index)}`,
    kind: input.kind,
    title: input.title ?? input.kind,
    targetKey: getTabTargetKey(input),
    createdAt: index,
  }

  switch (input.kind) {
    case "files":
      return {
        ...base,
        kind: "files",
        scopeDirectory: input.scopeDirectory,
        scopeName: input.scopeName,
        state: {
          ...DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
          comments: [],
          results: [],
          scopeDirectory: input.scopeDirectory,
        },
      }
    case "browser":
      return {
        ...base,
        kind: "browser",
        workspaceID: input.workspaceID,
        workspaceRoot: input.workspaceRoot,
        state: {
          ...DEFAULT_WORKSPACE_PREVIEW_STATE,
          interactions: [],
          navigationHistory: [],
        },
      }
    case "review":
      return {
        ...base,
        kind: "review",
        sessionID: input.sessionID,
      }
    case "terminal":
      return {
        ...base,
        kind: "terminal",
        sessionID: input.sessionID,
      }
    case "side-chat":
      return {
        ...base,
        kind: "side-chat",
        anchorMessageID: input.anchorMessageID,
        parentSessionID: input.parentSessionID,
        sessionID: input.sessionID,
      }
    case "message-tree":
      return {
        ...base,
        kind: "message-tree",
        sessionID: input.sessionID,
      }
    case "message-inspector":
      return {
        ...base,
        kind: "message-inspector",
        messageID: input.messageID,
        sessionID: input.sessionID,
      }
  }
}

function createBrowserTab(state: WorkspacePreviewState): RightSidebarTab {
  return {
    id: "browser-tab",
    kind: "browser",
    title: "localhost:5173",
    targetKey: "browser:workspace-1:http://localhost:5173",
    createdAt: 1,
    workspaceID: "workspace-1",
    workspaceRoot: "C:/work/workspace-1",
    state,
  }
}

function createFilesTab(state: WorkspaceFileReviewState, workspace: WorkspaceGroup): RightSidebarTab {
  return {
    id: "files-tab",
    kind: "files",
    title: "linked.ts",
    targetKey: "files:c:/work/workspace-1:src/linked.ts",
    createdAt: 1,
    scopeDirectory: workspace.directory,
    scopeName: workspace.name,
    state,
  }
}

function applyTabUpdate(tab: RightSidebarTab, update: RightSidebarTabUpdate): RightSidebarTab {
  const title = update.title ?? tab.title
  const targetKey = update.targetKey ?? tab.targetKey

  switch (tab.kind) {
    case "files":
      return {
        ...tab,
        title,
        targetKey,
        scopeDirectory: update.scopeDirectory ?? tab.scopeDirectory,
        scopeName: update.scopeName ?? tab.scopeName,
      }
    case "browser":
      return {
        ...tab,
        title,
        targetKey,
        workspaceID: update.workspaceID ?? tab.workspaceID,
        workspaceRoot: update.workspaceRoot ?? tab.workspaceRoot,
      }
    case "review":
      return {
        ...tab,
        title,
        targetKey,
        sessionID: update.sessionID ?? tab.sessionID,
      }
    case "terminal":
      return {
        ...tab,
        title,
        targetKey,
        sessionID: update.sessionID ?? tab.sessionID,
      }
    case "side-chat":
      return {
        ...tab,
        title,
        targetKey,
        anchorMessageID: update.anchorMessageID ?? tab.anchorMessageID,
        parentSessionID: update.parentSessionID ?? tab.parentSessionID,
        sessionID: update.sessionID ?? tab.sessionID,
      }
    case "message-tree":
      return {
        ...tab,
        title,
        targetKey,
        sessionID: update.sessionID ?? tab.sessionID,
      }
    case "message-inspector":
      return {
        ...tab,
        title,
        targetKey,
        messageID: update.messageID ?? tab.messageID,
        sessionID: update.sessionID ?? tab.sessionID,
      }
  }
}

interface TestHarnessOptions {
  activeTabID?: string | null
  initialTabs?: RightSidebarTab[]
  loadSessionDiffForSession?: (sessionID: string) => Promise<void>
  setSelectedDiffFileBySession?: (update: WorkspaceStateUpdater<Record<string, string | null>>) => void
  workspace: WorkspaceGroup
}

function useControllerHarness({
  activeTabID: initialActiveTabID = null,
  initialTabs = [],
  loadSessionDiffForSession = vi.fn(async () => undefined),
  setSelectedDiffFileBySession = vi.fn(),
  workspace,
}: TestHarnessOptions) {
  const [rightSidebarTabs, setRightSidebarTabs] = useState<RightSidebarTab[]>(initialTabs)
  const [activeTabID, setActiveTabID] = useState<string | null>(initialActiveTabID)
  const [workspaceFileCommentsByTarget, setWorkspaceFileCommentsByTarget] = useState<Record<string, WorkspaceFileComment[]>>({})
  const [composerDraftStateByTabKey, setComposerDraftStateByTabKey] = useState<Record<string, ComposerDraftState>>({})
  const tabsRef = useRef(rightSidebarTabs)
  const activeTabIDRef = useRef(activeTabID)
  const workspaceFileReadRequestRef = useRef(0)
  const workspaceFileSearchRequestRef = useRef(0)

  tabsRef.current = rightSidebarTabs
  activeTabIDRef.current = activeTabID

  function commitTabs(nextTabs: RightSidebarTab[]) {
    tabsRef.current = nextTabs
    setRightSidebarTabs(nextTabs)
  }

  function openOrFocusRightSidebarTab(input: RightSidebarOpenTabInput) {
    const targetKey = getTabTargetKey(input)
    const existingTab = tabsRef.current.find((tab) => tab.kind === input.kind && tab.targetKey === targetKey)
    if (existingTab) {
      activeTabIDRef.current = existingTab.id
      setActiveTabID(existingTab.id)
      return existingTab.id
    }

    const nextTab = createRightSidebarTab(input, tabsRef.current.length + 1)
    commitTabs([...tabsRef.current, nextTab])
    activeTabIDRef.current = nextTab.id
    setActiveTabID(nextTab.id)
    return nextTab.id
  }

  function setRightSidebarFileState(tabID: string, update: WorkspaceStateUpdater<WorkspaceFileReviewState>) {
    commitTabs(tabsRef.current.map((tab) =>
      tab.id === tabID && tab.kind === "files"
        ? {
            ...tab,
            state: applyUpdate(tab.state, update),
          }
        : tab,
    ))
  }

  function setRightSidebarPreviewState(tabID: string, update: WorkspaceStateUpdater<WorkspacePreviewState>) {
    commitTabs(tabsRef.current.map((tab) =>
      tab.id === tabID && tab.kind === "browser"
        ? {
            ...tab,
            state: applyUpdate(tab.state, update),
          }
        : tab,
    ))
  }

  function updateRightSidebarTab(tabID: string, update: RightSidebarTabUpdate) {
    commitTabs(tabsRef.current.map((tab) => tab.id === tabID ? applyTabUpdate(tab, update) : tab))
  }

  const activeRightSidebarTab = rightSidebarTabs.find((tab) => tab.id === activeTabID) ?? null
  const controller = useReviewPanelController({
    activeSessionDirectory: workspace.directory,
    activeSessionID: "session-1",
    activeTabKey: "session:session-1",
    activeRightSidebarTab,
    activeWorkspaceFileScopeDirectory: workspace.directory,
    activeWorkspaceFileScopeName: workspace.name,
    loadSessionDiffForSession,
    loadSessionRuntimeDebugForSession: vi.fn(async () => undefined),
    openOrFocusRightSidebarTab,
    platform: "win32",
    resolveSessionDirectory: () => workspace.directory,
    rightSidebarTabs,
    selectedWorkspace: workspace,
    setComposerDraftStateByTabKey,
    setRightSidebarFileState,
    setRightSidebarPreviewState,
    setSelectedDiffFileBySession,
    setWorkspaceFileCommentsByTarget,
    updateRightSidebarTab,
    workspaceFileCommentsByTarget,
    workspaceFileReadRequestRef,
    workspaceFileSearchRequestRef,
  })

  return {
    composerDraftStateByTabKey,
    controller,
    rightSidebarTabs,
  }
}

describe("review panel controller", () => {
  it("inserts committed preview comments into the active composer draft", () => {
    const workspace = createWorkspace()
    const previewState: WorkspacePreviewState = {
      ...DEFAULT_WORKSPACE_PREVIEW_STATE,
      draftUrl: "http://localhost:5173",
      draftTarget: "http://localhost:5173",
      committedUrl: "http://localhost:5173",
      activeInteractionID: "web.comment",
      reloadToken: 0,
      errorKind: null,
      errorMessage: null,
      navigationHistory: ["http://localhost:5173"],
      navigationIndex: 0,
      resolvedTarget: {
        externalOpenTarget: {
          kind: "url",
          value: "http://localhost:5173",
        },
        input: "http://localhost:5173",
        kind: "url",
        mime: "text/html",
        normalizedInput: "http://localhost:5173",
        renderer: "url-webview",
        safePreviewUrl: "http://localhost:5173",
        textReadable: false,
        title: "localhost:5173",
      },
      interactions: [
        {
          createdAt: 1,
          id: "interaction-1",
          pluginID: "web.comment",
          renderer: "url-webview",
          targetKey: "http://localhost:5173",
          payload: {
            kind: "web-comment",
            pageUrl: "http://localhost:5173",
            x: 0.2,
            y: 0.4,
            text: "Button is misaligned",
          },
        },
      ],
    }

    const { result } = renderHook(() => useControllerHarness({
      activeTabID: "browser-tab",
      initialTabs: [createBrowserTab(previewState)],
      workspace,
    }))

    act(() => {
      result.current.controller.handlePreviewInsertInteractionsIntoDraft()
    })

    const draftState = result.current.composerDraftStateByTabKey["session:session-1"]
    expect(draftState?.plainText).toContain("@preview:localhost:5173#1")
    expect(draftState?.plainText).not.toContain("Button is misaligned")
  })

  it("resolves unified preview targets into preview state", async () => {
    const workspace = createWorkspace()
    const previousDesktop = window.desktop
    const resolvePreviewTarget = vi.fn().mockResolvedValue({
      externalOpenTarget: {
        kind: "url",
        value: "http://localhost:3000/",
      },
      input: "localhost:3000",
      kind: "url",
      mime: "text/html",
      normalizedInput: "http://localhost:3000/",
      renderer: "url-webview",
      safePreviewUrl: "http://localhost:3000/",
      textReadable: false,
      title: "localhost:3000",
    })
    window.desktop = {
      ...(previousDesktop ?? {}),
      resolvePreviewTarget,
    } as Window["desktop"]

    const { result } = renderHook(() => useControllerHarness({ workspace }))

    try {
      await act(async () => {
        await result.current.controller.handlePreviewOpenTarget("localhost:3000", workspace.id, workspace.directory)
      })

      const browserTab = result.current.rightSidebarTabs.find((tab) => tab.kind === "browser")
      expect(resolvePreviewTarget).toHaveBeenCalledWith({
        value: "localhost:3000",
        workspaceRoot: workspace.directory,
      })
      expect(browserTab?.kind === "browser" ? browserTab.state : null).toMatchObject({
        activeTargetInput: "localhost:3000",
        committedUrl: "http://localhost:3000/",
        draftTarget: "http://localhost:3000/",
        navigationHistory: ["http://localhost:3000/"],
        navigationIndex: 0,
        resolvedTarget: {
          renderer: "url-webview",
          title: "localhost:3000",
        },
        status: "ready",
      })
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("navigates preview history backward and resolves the selected target", async () => {
    const workspace = createWorkspace()
    const previousDesktop = window.desktop
    const resolvePreviewTarget = vi.fn(async ({ value }: { value: string }) => ({
      externalOpenTarget: {
        kind: "url" as const,
        value,
      },
      input: value,
      kind: "url" as const,
      mime: "text/html",
      normalizedInput: value,
      renderer: "url-webview" as const,
      safePreviewUrl: value,
      textReadable: false,
      title: new URL(value).host,
    }))
    window.desktop = {
      ...(previousDesktop ?? {}),
      resolvePreviewTarget,
    } as Window["desktop"]

    const previewState: WorkspacePreviewState = {
      ...DEFAULT_WORKSPACE_PREVIEW_STATE,
      activeTargetInput: "http://localhost:5173/",
      committedUrl: "http://localhost:5173/",
      draftTarget: "http://localhost:5173/",
      draftUrl: "http://localhost:5173/",
      navigationHistory: ["http://localhost:3000/", "http://localhost:5173/"],
      navigationIndex: 1,
      resolvedTarget: {
        externalOpenTarget: {
          kind: "url",
          value: "http://localhost:5173/",
        },
        input: "http://localhost:5173/",
        kind: "url",
        mime: "text/html",
        normalizedInput: "http://localhost:5173/",
        renderer: "url-webview",
        safePreviewUrl: "http://localhost:5173/",
        textReadable: false,
        title: "localhost:5173",
      },
      status: "ready",
    }

    const { result } = renderHook(() => useControllerHarness({
      activeTabID: "browser-tab",
      initialTabs: [createBrowserTab(previewState)],
      workspace,
    }))

    try {
      act(() => {
        result.current.controller.handlePreviewBack()
      })

      await waitFor(() => {
        const browserTab = result.current.rightSidebarTabs.find((tab) => tab.kind === "browser")
        expect(browserTab?.kind === "browser" ? browserTab.state.navigationIndex : null).toBe(0)
        expect(browserTab?.kind === "browser" ? browserTab.state.resolvedTarget?.title : null).toBe("localhost:3000")
      })

      expect(resolvePreviewTarget).toHaveBeenCalledWith({
        value: "http://localhost:3000/",
        workspaceRoot: workspace.directory,
      })
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("clears linked file highlights when starting a file comment", () => {
    const workspace = createWorkspace()
    const fileState: WorkspaceFileReviewState = {
      ...DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
      linkedLineRange: {
        startLineNumber: 2,
        endLineNumber: 3,
      },
      scopeDirectory: workspace.directory,
      selectedFileContent: "const a = 1\nconst b = 2",
      selectedFileExtension: "ts",
      selectedFileKind: "text",
      selectedFilePath: "src/linked.ts",
      status: "ready",
    }

    const { result } = renderHook(() => useControllerHarness({
      activeTabID: "files-tab",
      initialTabs: [createFilesTab(fileState, workspace)],
      workspace,
    }))

    act(() => {
      result.current.controller.handleWorkspaceFileCommentStart(2, 3)
    })

    const filesTab = result.current.rightSidebarTabs.find((tab) => tab.id === "files-tab")
    const nextState = filesTab?.kind === "files" ? filesTab.state : null
    expect(nextState?.linkedLineRange).toBeNull()
    expect(nextState?.pendingComment).toMatchObject({
      startLineNumber: 2,
      endLineNumber: 3,
    })
  })

  it("keeps the current file visible until the next workspace file finishes loading", async () => {
    const workspace = createWorkspace()
    const previousDesktop = window.desktop
    let resolveReadFile: (value: {
      path: string
      name: string
      extension: string
      kind: "text"
      content: string
    }) => void = () => undefined
    const readWorkspaceFile = vi.fn(() =>
      new Promise<{
        path: string
        name: string
        extension: string
        kind: "text"
        content: string
      }>((resolve) => {
        resolveReadFile = resolve
      }),
    )
    window.desktop = {
      ...(previousDesktop ?? {}),
      readWorkspaceFile,
    } as Window["desktop"]

    const fileState: WorkspaceFileReviewState = {
      ...DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
      scopeDirectory: workspace.directory,
      selectedFileContent: "export const oldValue = 1",
      selectedFileExtension: "ts",
      selectedFileKind: "text",
      selectedFilePath: "src/old.ts",
      status: "ready",
      treeExpandedDirectoryPaths: ["src"],
    }

    const { result } = renderHook(() => useControllerHarness({
      activeTabID: "files-tab",
      initialTabs: [createFilesTab(fileState, workspace)],
      workspace,
    }))

    try {
      let selectPromise: Promise<void> | null = null
      await act(async () => {
        selectPromise = result.current.controller.handleWorkspaceFileSelect("src/next.ts")
      })

      expect(readWorkspaceFile).toHaveBeenCalledWith({
        directory: workspace.directory,
        path: "src/next.ts",
      })
      let filesTab = result.current.rightSidebarTabs.find((tab) => tab.id === "files-tab")
      let nextState = filesTab?.kind === "files" ? filesTab.state : null
      expect(nextState?.selectedFilePath).toBe("src/old.ts")
      expect(nextState?.selectedFileContent).toBe("export const oldValue = 1")
      expect(nextState?.status).toBe("reading")

      if (!selectPromise) throw new Error("Expected file selection promise")
      await act(async () => {
        resolveReadFile({
          path: "src/next.ts",
          name: "next.ts",
          extension: "ts",
          kind: "text",
          content: "export const nextValue = 2",
        })
        await selectPromise
      })

      filesTab = result.current.rightSidebarTabs.find((tab) => tab.id === "files-tab")
      nextState = filesTab?.kind === "files" ? filesTab.state : null
      expect(nextState?.selectedFilePath).toBe("src/next.ts")
      expect(nextState?.selectedFileContent).toBe("export const nextValue = 2")
      expect(nextState?.status).toBe("ready")
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("keeps the root file tree cache when a nested workspace file changes", () => {
    const workspace = createWorkspace()
    const fileState: WorkspaceFileReviewState = {
      ...DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
      scopeDirectory: workspace.directory,
      treeEntriesByDirectoryPath: {
        "": [
          {
            path: "src",
            name: "src",
            kind: "directory",
            extension: null,
            hasChildren: true,
          },
          {
            path: "README.md",
            name: "README.md",
            kind: "file",
            extension: "md",
            hasChildren: false,
          },
        ],
        src: [
          {
            path: "src/App.tsx",
            name: "App.tsx",
            kind: "file",
            extension: "tsx",
            hasChildren: false,
          },
        ],
      },
      treeExpandedDirectoryPaths: ["src"],
    }

    const { result } = renderHook(() => useControllerHarness({
      activeTabID: "files-tab",
      initialTabs: [createFilesTab(fileState, workspace)],
      workspace,
    }))

    act(() => {
      result.current.controller.handleWorkspaceFileTreeInvalidate([
        "C:\\work\\workspace-1\\src\\App.tsx",
      ])
    })

    const filesTab = result.current.rightSidebarTabs.find((tab) => tab.id === "files-tab")
    const nextState = filesTab?.kind === "files" ? filesTab.state : null
    expect(nextState?.treeEntriesByDirectoryPath[""]).toEqual(fileState.treeEntriesByDirectoryPath[""])
    expect(nextState?.treeEntriesByDirectoryPath.src).toBeUndefined()
  })

  it("keeps visible file tree caches when git internal files change at any depth", () => {
    const workspace = createWorkspace()
    const fileState: WorkspaceFileReviewState = {
      ...DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
      scopeDirectory: workspace.directory,
      treeEntriesByDirectoryPath: {
        "": [
          {
            path: "repo",
            name: "repo",
            kind: "directory",
            extension: null,
            hasChildren: true,
          },
        ],
        repo: [
          {
            path: "repo/README.md",
            name: "README.md",
            kind: "file",
            extension: "md",
            hasChildren: false,
          },
        ],
      },
      treeExpandedDirectoryPaths: ["repo"],
    }

    const { result } = renderHook(() => useControllerHarness({
      activeTabID: "files-tab",
      initialTabs: [createFilesTab(fileState, workspace)],
      workspace,
    }))

    act(() => {
      result.current.controller.handleWorkspaceFileTreeInvalidate([
        "C:\\work\\workspace-1\\.git",
        "C:\\work\\workspace-1\\.git\\index.lock",
        "C:\\work\\workspace-1\\repo\\.git",
        "C:\\work\\workspace-1\\repo\\.git\\index.lock",
      ])
    })

    const filesTab = result.current.rightSidebarTabs.find((tab) => tab.id === "files-tab")
    const nextState = filesTab?.kind === "files" ? filesTab.state : null
    expect(nextState?.treeEntriesByDirectoryPath).toEqual(fileState.treeEntriesByDirectoryPath)
  })

  it("invalidates the root file tree cache when a top-level workspace entry changes", () => {
    const workspace = createWorkspace()
    const fileState: WorkspaceFileReviewState = {
      ...DEFAULT_WORKSPACE_FILE_REVIEW_STATE,
      scopeDirectory: workspace.directory,
      treeEntriesByDirectoryPath: {
        "": [
          {
            path: "README.md",
            name: "README.md",
            kind: "file",
            extension: "md",
            hasChildren: false,
          },
        ],
      },
    }

    const { result } = renderHook(() => useControllerHarness({
      activeTabID: "files-tab",
      initialTabs: [createFilesTab(fileState, workspace)],
      workspace,
    }))

    act(() => {
      result.current.controller.handleWorkspaceFileTreeInvalidate([
        "C:\\work\\workspace-1\\README.md",
      ])
    })

    const filesTab = result.current.rightSidebarTabs.find((tab) => tab.id === "files-tab")
    const nextState = filesTab?.kind === "files" ? filesTab.state : null
    expect(nextState?.treeEntriesByDirectoryPath[""]).toBeUndefined()
  })

  it("restores multiple active session diff files and refreshes once", async () => {
    const workspace = createWorkspace()
    const previousDesktop = window.desktop
    const restoreWorkspaceDiffFile = vi.fn().mockResolvedValue({
      directory: workspace.directory,
      file: "src/App.tsx",
    })
    const loadSessionDiffForSession = vi.fn(async () => undefined)
    const setSelectedDiffFileBySession = vi.fn()
    window.desktop = {
      ...(previousDesktop ?? {}),
      restoreWorkspaceDiffFile,
    } as Window["desktop"]

    const { result } = renderHook(() => useControllerHarness({
      loadSessionDiffForSession,
      setSelectedDiffFileBySession,
      workspace,
    }))

    try {
      await act(async () => {
        await result.current.controller.handleActiveSessionDiffFilesRestore([
          "src/App.tsx",
          "src/App.tsx",
          "src/styles.css",
        ])
      })

      expect(restoreWorkspaceDiffFile).toHaveBeenCalledTimes(2)
      expect(restoreWorkspaceDiffFile).toHaveBeenNthCalledWith(1, {
        directory: workspace.directory,
        file: "src/App.tsx",
      })
      expect(restoreWorkspaceDiffFile).toHaveBeenNthCalledWith(2, {
        directory: workspace.directory,
        file: "src/styles.css",
      })
      expect(setSelectedDiffFileBySession).toHaveBeenCalled()
      expect(loadSessionDiffForSession).toHaveBeenCalledTimes(1)
      expect(loadSessionDiffForSession).toHaveBeenCalledWith("session-1")
    } finally {
      window.desktop = previousDesktop
    }
  })

  it("reverse-applies active session diff patches and reports partial failures", async () => {
    const workspace = createWorkspace()
    const previousDesktop = window.desktop
    const reverseApplyWorkspaceDiffPatches = vi.fn().mockResolvedValue({
      directory: workspace.directory,
      restored: [{ file: "src/App.tsx" }],
      failed: [{ file: "src/styles.css", message: "patch does not apply" }],
    })
    const loadSessionDiffForSession = vi.fn(async () => undefined)
    const setSelectedDiffFileBySession = vi.fn()
    window.desktop = {
      ...(previousDesktop ?? {}),
      reverseApplyWorkspaceDiffPatches,
    } as Window["desktop"]

    const { result } = renderHook(() => useControllerHarness({
      loadSessionDiffForSession,
      setSelectedDiffFileBySession,
      workspace,
    }))

    try {
      await expect(
        act(async () => {
          await result.current.controller.handleActiveSessionDiffPatchesReverseApply([
            {
              file: "src/App.tsx",
              additions: 1,
              deletions: 1,
              patch: "@@ -1 +1 @@\n-old\n+new",
            },
            {
              file: "src/styles.css",
              additions: 1,
              deletions: 0,
              patch: "@@ -1,0 +1 @@\n+.toolbar {}",
            },
          ])
        }),
      ).rejects.toThrow("已撤销 1 个文件；1 个文件无法自动反向应用变更：src/styles.css: patch does not apply")

      expect(reverseApplyWorkspaceDiffPatches).toHaveBeenCalledWith({
        directory: workspace.directory,
        diffs: [
          {
            file: "src/App.tsx",
            patch: "@@ -1 +1 @@\n-old\n+new",
          },
          {
            file: "src/styles.css",
            patch: "@@ -1,0 +1 @@\n+.toolbar {}",
          },
        ],
      })
      expect(setSelectedDiffFileBySession).toHaveBeenCalled()
      expect(loadSessionDiffForSession).toHaveBeenCalledTimes(1)
      expect(loadSessionDiffForSession).toHaveBeenCalledWith("session-1")
    } finally {
      window.desktop = previousDesktop
    }
  })
})
