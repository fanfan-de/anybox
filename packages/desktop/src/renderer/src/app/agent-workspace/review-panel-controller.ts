import { useRef, type MutableRefObject } from "react"
import {
  appendComposerTagToDraftState,
  createComposerCommentTagData,
  createEmptyComposerDraftState,
} from "../composer/draft-state"
import {
  buildWorkspaceFileCommentDraft,
  buildWorkspaceFileCommentReferenceLabel,
  formatWorkspaceFileLineRangeLabel,
  normalizeWorkspaceFileLineRange,
} from "../files/utils"
import {
  formatPreviewInteractionReferenceLabel,
  formatPreviewInteractionReferenceTitle,
  getPreviewInteractionPlugins,
  getPreviewInteractionPageUrl,
} from "../preview/interactions/registry"
import {
  normalizePreviewUrlInput,
} from "../preview/utils"
import type {
  ComposerCommentReference,
  ComposerDraftState,
  PreviewInteractionCommitInput,
  PreviewInteractionPluginID,
  PreviewInteractionRecord,
  RightSidebarOpenTabInput,
  RightSidebarTab,
  RightSidebarTabUpdate,
  SessionDiffFile,
  WorkspaceFileComment,
  WorkspaceDirectoryEntry,
  WorkspaceFileLineRange,
  WorkspaceFileReviewState,
  WorkspaceGroup,
  WorkspacePreviewState,
} from "../types"
import { createID } from "../utils"
import { useWorkspaceFileReviewScopeEffects } from "./review-diff-runtime-hooks"
import {
  DEFAULT_WORKSPACE_PREVIEW_STATE,
  getWorkspaceFileCommentKey,
} from "./review-preview-state"
import { normalizeWorkspacePath } from "./workspace-loading-hooks"
import type { WorkspaceStateUpdater } from "./workspace-store"

type StateSetter<T> = (update: WorkspaceStateUpdater<T>) => void

function formatReverseApplyFailureMessage(result: {
  restored: Array<{ file: string }>
  failed: Array<{ file: string; message: string }>
}) {
  const failedDetails = result.failed
    .map((failure) => `${failure.file}: ${failure.message}`)
    .join("；")
  return `已撤销 ${result.restored.length} 个文件；${result.failed.length} 个文件无法自动反向应用变更：${failedDetails}`
}

interface WorkspaceFileSelectOptions {
  linkedLineRange?: WorkspaceFileLineRange | null
  scopeDirectory?: string | null
  scopeName?: string | null
  tabID?: string | null
}

interface UseReviewPanelControllerOptions {
  activeSessionDirectory: string | null
  activeSessionID: string | null
  activeTabKey: string | null
  activeRightSidebarTab: RightSidebarTab | null
  activeWorkspaceFileScopeDirectory: string | null
  activeWorkspaceFileScopeName: string | null
  loadSessionDiffForSession: (sessionID: string) => Promise<void>
  loadSessionRuntimeDebugForSession: (sessionID: string) => Promise<void>
  openOrFocusRightSidebarTab: (input: RightSidebarOpenTabInput) => string
  platform: string
  resolveSessionDirectory: (sessionID: string | null | undefined) => string | null
  rightSidebarTabs: RightSidebarTab[]
  selectedWorkspace: WorkspaceGroup | null
  setComposerDraftStateByTabKey: StateSetter<Record<string, ComposerDraftState>>
  setRightSidebarFileState: (tabID: string, update: WorkspaceStateUpdater<WorkspaceFileReviewState>) => void
  setRightSidebarPreviewState: (tabID: string, update: WorkspaceStateUpdater<WorkspacePreviewState>) => void
  setSelectedDiffFileBySession: StateSetter<Record<string, string | null>>
  setWorkspaceFileCommentsByTarget: StateSetter<Record<string, WorkspaceFileComment[]>>
  updateRightSidebarTab: (tabID: string, update: RightSidebarTabUpdate) => void
  workspaceFileCommentsByTarget: Record<string, WorkspaceFileComment[]>
  workspaceFileReadRequestRef: MutableRefObject<number>
  workspaceFileSearchRequestRef: MutableRefObject<number>
}

export function useReviewPanelController({
  activeSessionDirectory,
  activeSessionID,
  activeTabKey,
  activeRightSidebarTab,
  activeWorkspaceFileScopeDirectory,
  activeWorkspaceFileScopeName,
  loadSessionDiffForSession,
  loadSessionRuntimeDebugForSession,
  openOrFocusRightSidebarTab,
  platform,
  resolveSessionDirectory,
  rightSidebarTabs,
  selectedWorkspace,
  setComposerDraftStateByTabKey,
  setRightSidebarFileState,
  setRightSidebarPreviewState,
  setSelectedDiffFileBySession,
  setWorkspaceFileCommentsByTarget,
  updateRightSidebarTab,
  workspaceFileCommentsByTarget,
  workspaceFileReadRequestRef,
  workspaceFileSearchRequestRef,
}: UseReviewPanelControllerOptions) {
  const activeFileTab = activeRightSidebarTab?.kind === "files" ? activeRightSidebarTab : null
  const activeBrowserTab = activeRightSidebarTab?.kind === "browser" ? activeRightSidebarTab : null
  const previewResolveRequestRef = useRef(0)
  const workspaceFileReadRequestByTabRef = useRef<Record<string, number>>({})
  const workspaceDirectoryLoadRequestByTabRef = useRef<Record<string, Record<string, number>>>({})

  function normalizeTargetSegment(value: string | null | undefined) {
    return value?.trim().replace(/\\/g, "/").toLowerCase() || "__none__"
  }

  function getPathName(path: string | null | undefined) {
    const normalized = path?.trim().replace(/\\/g, "/") ?? ""
    return normalized.split("/").filter(Boolean).pop() || null
  }

  function normalizeWorkspaceFileTreePath(path: string | null | undefined) {
    const normalized = path?.trim().replace(/\\/g, "/").replace(/\/+/g, "/") ?? ""
    if (!normalized || normalized === "." || normalized === "/") return ""
    return normalized.replace(/^\/+/, "").replace(/\/+$/, "")
  }

  function getWorkspaceFileDirectoryPath(filePath: string | null | undefined) {
    const normalized = normalizeWorkspaceFileTreePath(filePath)
    const segments = normalized.split("/").filter(Boolean)
    segments.pop()
    return segments.join("/")
  }

  function getWorkspaceFileAncestorDirectoryPaths(filePath: string | null | undefined) {
    const directoryPath = getWorkspaceFileDirectoryPath(filePath)
    if (!directoryPath) return []
    const ancestors: string[] = []
    const segments = directoryPath.split("/").filter(Boolean)
    for (let index = 0; index < segments.length; index += 1) {
      ancestors.push(segments.slice(0, index + 1).join("/"))
    }
    return ancestors
  }

  function resolveFileReviewStatusForTreeFilter(
    state: Pick<
      WorkspaceFileReviewState,
      "errorMessage" | "selectedFileContent" | "selectedFileKind" | "selectedFilePath" | "selectedFilePreviewUrl"
    >,
  ): WorkspaceFileReviewState["status"] {
    if (state.errorMessage) return "error"
    if (state.selectedFileKind === "unsupported") return "unsupported"
    if (state.selectedFilePath && state.selectedFileKind === "text" && state.selectedFileContent !== null) return "ready"
    if (state.selectedFilePath && state.selectedFileKind === "image" && state.selectedFilePreviewUrl) return "ready"
    if (state.selectedFilePath && state.selectedFileKind === "video" && state.selectedFilePreviewUrl) return "ready"
    return "idle"
  }

  function hasRenderableWorkspaceFile(state: WorkspaceFileReviewState | null | undefined) {
    if (!state?.selectedFilePath) return false
    if (state.selectedFileKind === "text") return state.selectedFileContent !== null
    if (state.selectedFileKind === "image") return Boolean(state.selectedFilePreviewUrl)
    if (state.selectedFileKind === "video") return Boolean(state.selectedFilePreviewUrl)
    return false
  }

  function resolveRelativeWorkspaceEventPath(scopeDirectory: string, changedPath: string) {
    const normalizedScope = normalizeWorkspacePath(scopeDirectory, platform)
    const normalizedChangedPath = normalizeWorkspacePath(changedPath, platform)
    if (normalizedChangedPath === normalizedScope) return ""
    if (!normalizedChangedPath.startsWith(`${normalizedScope}/`)) return null
    return normalizeWorkspaceFileTreePath(changedPath.replace(/\\/g, "/").slice(scopeDirectory.replace(/\\/g, "/").length + 1))
  }

  function collectDirectoryCacheKeysForChangedPaths(scopeDirectory: string, changedPaths: string[]) {
    const keys = new Set<string>()
    for (const changedPath of changedPaths) {
      const relativePath = resolveRelativeWorkspaceEventPath(scopeDirectory, changedPath)
      if (relativePath === null) continue
      if (!relativePath) {
        keys.add("")
        continue
      }

      const segments = relativePath.split("/").filter(Boolean)
      if (segments.length === 0) continue

      const parentDirectory = segments.slice(0, -1).join("/")
      keys.add(parentDirectory)
      keys.add(relativePath)
    }
    return keys
  }

  function getBrowserTabTargetKey(workspaceID: string | null | undefined, target: string | null | undefined) {
    return ["browser", normalizeTargetSegment(workspaceID), normalizeTargetSegment(target)].join(":")
  }

  function getFilesTabTargetKey(scopeDirectory: string | null | undefined, path: string | null | undefined) {
    return ["files", normalizeTargetSegment(scopeDirectory), normalizeTargetSegment(path)].join(":")
  }

  function getBrowserTabTitle(value: string | null | undefined) {
    const trimmed = value?.trim() ?? ""
    if (!trimmed) return "Browser"
    try {
      const parsed = new URL(trimmed)
      return parsed.host || trimmed
    } catch {
      return getPathName(trimmed) ?? trimmed
    }
  }

  function getTabByID(tabID: string | null | undefined) {
    if (!tabID) return null
    return rightSidebarTabs.find((tab) => tab.id === tabID) ?? null
  }

  function getBrowserState(tabID: string | null | undefined) {
    const tab = getTabByID(tabID)
    return tab?.kind === "browser" ? tab.state : DEFAULT_WORKSPACE_PREVIEW_STATE
  }

  function openFilesTab(input: {
    path?: string | null
    scopeDirectory?: string | null
    scopeName?: string | null
    title?: string
  }) {
    const scopeDirectory = input.scopeDirectory ?? activeWorkspaceFileScopeDirectory
    return openOrFocusRightSidebarTab({
      kind: "files",
      filePath: input.path ?? null,
      scopeDirectory,
      scopeName: input.scopeName ?? activeWorkspaceFileScopeName,
      targetKey: getFilesTabTargetKey(scopeDirectory, input.path ?? null),
      title: input.title ?? getPathName(input.path) ?? "Files",
    })
  }

  function openBrowserTab(input: {
    target?: string | null
    title?: string
    workspaceID?: string | null
    workspaceRoot?: string | null
  }) {
    const workspaceID = input.workspaceID ?? selectedWorkspace?.id ?? null
    const target = input.target ?? null
    return openOrFocusRightSidebarTab({
      kind: "browser",
      target,
      targetKey: getBrowserTabTargetKey(workspaceID, target),
      title: input.title ?? getBrowserTabTitle(target),
      workspaceID,
      workspaceRoot: input.workspaceRoot ?? selectedWorkspace?.directory ?? activeSessionDirectory ?? null,
    })
  }

  function openReviewTab(sessionID = activeSessionID) {
    return openOrFocusRightSidebarTab({
      kind: "review",
      sessionID,
      title: "Review",
    })
  }

  function getPreviewNavigationState(current: WorkspacePreviewState) {
    const history = Array.isArray(current.navigationHistory)
      ? current.navigationHistory
      : current.committedUrl
        ? [current.committedUrl]
        : []
    const index = Number.isInteger(current.navigationIndex)
      ? Math.min(Math.max(current.navigationIndex, -1), history.length - 1)
      : history.length - 1

    return { history, index }
  }

  function getNextPreviewNavigationState(current: WorkspacePreviewState, nextTarget: string) {
    const normalizedTarget = nextTarget.trim()
    const { history, index } = getPreviewNavigationState(current)

    if (!normalizedTarget) return { history, index }
    if (index >= 0 && history[index] === normalizedTarget) return { history, index }

    const retainedHistory = index >= 0 ? history.slice(0, index + 1) : []
    const nextHistory = [...retainedHistory, normalizedTarget]
    return {
      history: nextHistory,
      index: nextHistory.length - 1,
    }
  }

  function updatePreviewState(
    tabID: string,
    updater: (current: WorkspacePreviewState) => WorkspacePreviewState,
  ) {
    setRightSidebarPreviewState(tabID, updater)
  }

  function handlePreviewDraftUrlChange(value: string) {
    const tabID = activeBrowserTab?.id ?? openBrowserTab({ target: null })
    updatePreviewState(
      tabID,
      (current) => ({
        ...current,
        draftUrl: value,
        draftTarget: value,
        errorKind: null,
        errorMessage: null,
      }),
    )
  }

  async function resolvePreviewTargetInTab(
    tabID: string,
    value: string,
    workspaceID = selectedWorkspace?.id ?? null,
    workspaceRootOverride?: string | null,
  ) {
    const trimmedValue = value.trim()
    const workspaceRoot = workspaceRootOverride ?? selectedWorkspace?.directory ?? activeSessionDirectory ?? null
    const resolvePreviewTarget = window.desktop?.resolvePreviewTarget
    const requestID = previewResolveRequestRef.current + 1
    previewResolveRequestRef.current = requestID

    if (!trimmedValue) {
      updatePreviewState(
        tabID,
        (current) => ({
          ...current,
          activeInteractionID: null,
          activeTargetInput: null,
          draftTarget: value,
          draftUrl: value,
          errorKind: "empty-url",
          errorMessage: "Enter a URL, Artifact link, or workspace file path to preview.",
          resolvedTarget: null,
          status: "error",
        }),
      )
      return
    }

    if (!resolvePreviewTarget) {
      updatePreviewState(
        tabID,
        (current) => ({
          ...current,
          activeInteractionID: null,
          activeTargetInput: trimmedValue,
          draftTarget: trimmedValue,
          draftUrl: trimmedValue,
          errorKind: "unknown",
          errorMessage: "Preview resolver is unavailable in this runtime.",
          resolvedTarget: null,
          status: "error",
        }),
      )
      return
    }

    updatePreviewState(
      tabID,
      (current) => ({
        ...current,
        activeInteractionID: null,
        activeTargetInput: trimmedValue,
        draftTarget: trimmedValue,
        draftUrl: trimmedValue,
        errorKind: null,
        errorMessage: null,
        status: "resolving",
      }),
    )

    try {
      const resolvedTarget = await resolvePreviewTarget({
        value: trimmedValue,
        workspaceRoot,
      })
      if (previewResolveRequestRef.current !== requestID) return

      updatePreviewState(
        tabID,
        (current) => {
          const normalizedTarget = resolvedTarget.normalizedInput || trimmedValue
          const navigation = getNextPreviewNavigationState(current, normalizedTarget)
          return {
            ...current,
            activeInteractionID: null,
            activeTargetInput: trimmedValue,
            committedUrl: resolvedTarget.kind === "url" ? resolvedTarget.safePreviewUrl ?? resolvedTarget.normalizedInput : null,
            draftTarget: normalizedTarget,
            draftUrl: normalizedTarget,
            errorKind: null,
            errorMessage: null,
            navigationHistory: navigation.history,
            navigationIndex: navigation.index,
            reloadToken: current.reloadToken + 1,
            resolvedTarget,
            status: "ready",
          }
        },
      )
      updateRightSidebarTab(tabID, {
        targetKey: getBrowserTabTargetKey(workspaceID, resolvedTarget.normalizedInput || trimmedValue),
        title: getBrowserTabTitle(resolvedTarget.normalizedInput || trimmedValue),
        workspaceID,
        workspaceRoot,
      })
    } catch (error) {
      if (previewResolveRequestRef.current !== requestID) return
      const message = error instanceof Error ? error.message : String(error)
      updatePreviewState(
        tabID,
        (current) => ({
          ...current,
          activeInteractionID: null,
          committedUrl: null,
          errorKind: "unknown",
          errorMessage: message,
          resolvedTarget: null,
          status: "error",
        }),
      )
    }
  }

  async function handlePreviewOpenTarget(
    value: string,
    workspaceID = selectedWorkspace?.id ?? null,
    workspaceRootOverride?: string | null,
  ) {
    const tabID = openBrowserTab({
      target: value,
      workspaceID,
      workspaceRoot: workspaceRootOverride ?? selectedWorkspace?.directory ?? activeSessionDirectory ?? null,
    })
    await resolvePreviewTargetInTab(tabID, value, workspaceID, workspaceRootOverride)
  }

  function handlePreviewOpenUrl(url: string, workspaceID = selectedWorkspace?.id ?? null) {
    const tabID = activeBrowserTab?.id ?? openBrowserTab({ target: url, workspaceID })
    void resolvePreviewTargetInTab(tabID, url, workspaceID)
  }

  function handlePreviewOpen(workspaceID = selectedWorkspace?.id ?? null) {
    const tabID = activeBrowserTab?.id ?? openBrowserTab({ target: null, workspaceID })
    const previewState = activeBrowserTab?.id === tabID ? activeBrowserTab.state : getBrowserState(tabID)
    void resolvePreviewTargetInTab(tabID, previewState.draftTarget || previewState.draftUrl || previewState.committedUrl || "", workspaceID)
  }

  function handlePreviewReload(workspaceID = selectedWorkspace?.id ?? null) {
    if (!activeBrowserTab) return
    const previewState = activeBrowserTab.state
    const target = previewState.activeTargetInput ?? previewState.resolvedTarget?.normalizedInput ?? previewState.draftTarget
    if (target) {
      void resolvePreviewTargetInTab(activeBrowserTab.id, target, workspaceID, previewState.resolvedTarget?.workspaceRoot ?? undefined)
    }
  }

  function handlePreviewBack() {
    if (!activeBrowserTab) return
    const { history, index } = getPreviewNavigationState(activeBrowserTab.state)
    if (index <= 0) return
    const nextTarget = history[index - 1]
    if (!nextTarget) return
    const workspaceID = activeBrowserTab.workspaceID ?? selectedWorkspace?.id ?? null
    const workspaceRoot = activeBrowserTab.workspaceRoot ?? selectedWorkspace?.directory ?? activeSessionDirectory ?? null

    updatePreviewState(activeBrowserTab.id, (current) => {
      const navigation = getPreviewNavigationState(current)
      if (navigation.index <= 0) return current

      return {
        ...current,
        activeInteractionID: null,
        activeTargetInput: nextTarget,
        draftTarget: nextTarget,
        draftUrl: nextTarget,
        committedUrl: nextTarget,
        errorKind: null,
        errorMessage: null,
        navigationHistory: navigation.history,
        navigationIndex: navigation.index - 1,
      }
    })
    void resolvePreviewTargetInTab(activeBrowserTab.id, nextTarget, workspaceID, workspaceRoot)
  }

  function handlePreviewForward() {
    if (!activeBrowserTab) return
    const { history, index } = getPreviewNavigationState(activeBrowserTab.state)
    if (index < 0 || index >= history.length - 1) return
    const nextTarget = history[index + 1]
    if (!nextTarget) return
    const workspaceID = activeBrowserTab.workspaceID ?? selectedWorkspace?.id ?? null
    const workspaceRoot = activeBrowserTab.workspaceRoot ?? selectedWorkspace?.directory ?? activeSessionDirectory ?? null

    updatePreviewState(activeBrowserTab.id, (current) => {
      const navigation = getPreviewNavigationState(current)
      if (navigation.index < 0 || navigation.index >= navigation.history.length - 1) return current

      return {
        ...current,
        activeInteractionID: null,
        activeTargetInput: nextTarget,
        draftTarget: nextTarget,
        draftUrl: nextTarget,
        committedUrl: nextTarget,
        errorKind: null,
        errorMessage: null,
        navigationHistory: navigation.history,
        navigationIndex: navigation.index + 1,
      }
    })
    void resolvePreviewTargetInTab(activeBrowserTab.id, nextTarget, workspaceID, workspaceRoot)
  }

  function handlePreviewActiveInteractionChange(pluginID: PreviewInteractionPluginID | null) {
    if (!activeBrowserTab) return
    updatePreviewState(
      activeBrowserTab.id,
      (current) => ({
        ...current,
        activeInteractionID: pluginID,
      }),
    )
  }

  function createPreviewInteractionReference(
    interaction: PreviewInteractionRecord,
    interactionIndex: number,
  ): ComposerCommentReference {
    const pageUrl = getPreviewInteractionPageUrl(interaction)
    return {
      source: "preview",
      id: createID("composer-preview-interaction-reference"),
      label: formatPreviewInteractionReferenceLabel(interaction, interactionIndex),
      title: formatPreviewInteractionReferenceTitle(interaction),
      prompt: `Preview feedback for ${pageUrl}`,
      interaction,
      pageUrl,
    }
  }

  function handlePreviewCommitInteraction(
    input: PreviewInteractionCommitInput,
  ) {
    if (!activeBrowserTab) return
    const previewState = activeBrowserTab.state

    if (!previewState.resolvedTarget) return

    const nextInteraction: PreviewInteractionRecord = {
      createdAt: Date.now(),
      id: createID("preview-interaction"),
      ...input,
    }
    const interactionIndex = previewState.interactions.filter((interaction) =>
      interaction.pluginID === nextInteraction.pluginID && interaction.targetKey === nextInteraction.targetKey
    ).length + 1

    updatePreviewState(activeBrowserTab.id, (current) => {
      if (current.resolvedTarget?.normalizedInput !== previewState.resolvedTarget?.normalizedInput) return current

      return {
        ...current,
        errorKind: null,
        interactions: [...current.interactions, nextInteraction],
        errorMessage: null,
      }
    })

    if (activeTabKey) {
      const nextReference = createPreviewInteractionReference(nextInteraction, interactionIndex)

      setComposerDraftStateByTabKey((current) => ({
        ...current,
        [activeTabKey]: appendComposerTagToDraftState(
          current[activeTabKey] ?? createEmptyComposerDraftState(),
          createComposerCommentTagData(nextReference),
        ),
      }))
    }
  }

  function handlePreviewDeleteInteraction(interactionID: string) {
    if (!activeBrowserTab) return
    updatePreviewState(
      activeBrowserTab.id,
      (current) => ({
        ...current,
        interactions: current.interactions.filter((interaction) => interaction.id !== interactionID),
      }),
    )
  }

  function handlePreviewInsertInteractionsIntoDraft() {
    if (!activeTabKey || !activeBrowserTab) return

    const previewState = activeBrowserTab.state
    const target = previewState.resolvedTarget
    if (!target) return

    const targetKeys = new Set(getPreviewInteractionPlugins(target).map((plugin) => plugin.resolveTargetKey(target)))
    const relevantInteractions = previewState.interactions.filter((interaction) => targetKeys.has(interaction.targetKey))
    if (relevantInteractions.length === 0) return

    setComposerDraftStateByTabKey((current) => {
      let nextDraftState = current[activeTabKey] ?? createEmptyComposerDraftState()
      relevantInteractions.forEach((interaction, index) => {
        const nextReference = createPreviewInteractionReference(interaction, index + 1)
        nextDraftState = appendComposerTagToDraftState(nextDraftState, createComposerCommentTagData(nextReference))
      })

      return {
        ...current,
        [activeTabKey]: nextDraftState,
      }
    })
  }

  async function handlePreviewOpenExternal() {
    if (!activeBrowserTab) return
    const openExternalUrl = window.desktop?.openExternalUrl
    const openPath = window.desktop?.openPath

    const previewState = activeBrowserTab.state
    const externalTarget = previewState.resolvedTarget?.externalOpenTarget

    if (externalTarget?.kind === "path" && openPath) {
      try {
        await openPath({ targetPath: externalTarget.value })
        updatePreviewState(
          activeBrowserTab.id,
          (current) => ({
            ...current,
            errorKind: null,
            errorMessage: null,
          }),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        updatePreviewState(
          activeBrowserTab.id,
          (current) => ({
            ...current,
            errorKind: "unknown",
            errorMessage: message,
          }),
        )
      }
      return
    }

    if (!openExternalUrl) return

    if (externalTarget?.kind === "url") {
      try {
        await openExternalUrl({ url: externalTarget.value })
        updatePreviewState(
          activeBrowserTab.id,
          (current) => ({
            ...current,
            errorKind: null,
            errorMessage: null,
          }),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        updatePreviewState(
          activeBrowserTab.id,
          (current) => ({
            ...current,
            errorKind: "unknown",
            errorMessage: message,
          }),
        )
      }
      return
    }

    const { errorKind, errorMessage, normalizedUrl } = normalizePreviewUrlInput(previewState.committedUrl ?? previewState.draftUrl)

    if (!normalizedUrl) {
      updatePreviewState(
        activeBrowserTab.id,
        (current) => ({
          ...current,
          errorKind,
          errorMessage,
        }),
      )
      return
    }

    try {
      await openExternalUrl({ url: normalizedUrl })
      updatePreviewState(
        activeBrowserTab.id,
        (current) => ({
          ...current,
          draftUrl: normalizedUrl,
          errorKind: null,
          errorMessage: null,
        }),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      updatePreviewState(
        activeBrowserTab.id,
        (current) => ({
          ...current,
          errorKind: "unknown",
          errorMessage: message,
        }),
      )
    }
  }

  function handleWorkspaceFileQueryChange(value: string) {
    const tabID = activeFileTab?.id ?? openFilesTab({})
    setRightSidebarFileState(tabID, (current) => {
      const nextErrorMessage = current.selectedFileKind === "unsupported" ? current.errorMessage : null
      const nextState = {
        ...current,
        query: value,
        results: [],
        errorMessage: nextErrorMessage,
        linkedLineRange: null,
        pendingComment: null,
      }

      return {
        ...nextState,
        status: resolveFileReviewStatusForTreeFilter(nextState),
      }
    })
  }

  function handleWorkspaceDirectoryLoad(path: string) {
    const listWorkspaceDirectory = window.desktop?.listWorkspaceDirectory
    const tabID = activeFileTab?.id
    const scopeDirectory = activeFileTab?.scopeDirectory ?? activeWorkspaceFileScopeDirectory
    const normalizedPath = normalizeWorkspaceFileTreePath(path)
    if (!listWorkspaceDirectory || !tabID || !scopeDirectory) return

    const currentState = activeFileTab.state
    if (
      currentState.treeEntriesByDirectoryPath[normalizedPath] ||
      currentState.treeLoadingDirectoryPaths.includes(normalizedPath)
    ) {
      return
    }

    const tabRequests = workspaceDirectoryLoadRequestByTabRef.current[tabID] ?? {}
    const requestID = (tabRequests[normalizedPath] ?? 0) + 1
    workspaceDirectoryLoadRequestByTabRef.current[tabID] = {
      ...tabRequests,
      [normalizedPath]: requestID,
    }

    setRightSidebarFileState(tabID, (current) => ({
      ...current,
      treeErrorByDirectoryPath: Object.fromEntries(
        Object.entries(current.treeErrorByDirectoryPath).filter(([key]) => key !== normalizedPath),
      ),
      treeLoadingDirectoryPaths: Array.from(new Set([...current.treeLoadingDirectoryPaths, normalizedPath])),
    }))

    listWorkspaceDirectory({
      directory: scopeDirectory,
      path: normalizedPath,
    })
      .then((entries: WorkspaceDirectoryEntry[]) => {
        if (workspaceDirectoryLoadRequestByTabRef.current[tabID]?.[normalizedPath] !== requestID) return

        setRightSidebarFileState(tabID, (current) => ({
          ...current,
          treeEntriesByDirectoryPath: {
            ...current.treeEntriesByDirectoryPath,
            [normalizedPath]: entries,
          },
          treeErrorByDirectoryPath: Object.fromEntries(
            Object.entries(current.treeErrorByDirectoryPath).filter(([key]) => key !== normalizedPath),
          ),
          treeLoadingDirectoryPaths: current.treeLoadingDirectoryPaths.filter((item) => item !== normalizedPath),
        }))
      })
      .catch((error) => {
        if (workspaceDirectoryLoadRequestByTabRef.current[tabID]?.[normalizedPath] !== requestID) return
        const message = error instanceof Error ? error.message : String(error)

        setRightSidebarFileState(tabID, (current) => ({
          ...current,
          treeErrorByDirectoryPath: {
            ...current.treeErrorByDirectoryPath,
            [normalizedPath]: message,
          },
          treeLoadingDirectoryPaths: current.treeLoadingDirectoryPaths.filter((item) => item !== normalizedPath),
        }))
        console.error("[desktop] listWorkspaceDirectory failed:", error)
      })
  }

  function handleWorkspaceDirectoryToggle(path: string) {
    const tabID = activeFileTab?.id
    if (!tabID) return
    const normalizedPath = normalizeWorkspaceFileTreePath(path)
    const isExpanded = activeFileTab.state.treeExpandedDirectoryPaths.includes(normalizedPath)

    setRightSidebarFileState(tabID, (current) => ({
      ...current,
      treeExpandedDirectoryPaths: isExpanded
        ? current.treeExpandedDirectoryPaths.filter((item) => item !== normalizedPath)
        : [...current.treeExpandedDirectoryPaths, normalizedPath],
    }))

    if (!isExpanded) {
      handleWorkspaceDirectoryLoad(normalizedPath)
    }
  }

  function handleWorkspaceFileTreeInvalidate(paths: string[]) {
    const tabID = activeFileTab?.id
    const scopeDirectory = activeFileTab?.scopeDirectory ?? activeWorkspaceFileScopeDirectory
    if (!tabID || !scopeDirectory) return

    const invalidatedKeys = collectDirectoryCacheKeysForChangedPaths(scopeDirectory, paths)
    if (invalidatedKeys.size === 0) return

    setRightSidebarFileState(tabID, (current) => {
      const hasInvalidatedTreeState =
        Object.keys(current.treeEntriesByDirectoryPath).some((key) => invalidatedKeys.has(key)) ||
        Object.keys(current.treeErrorByDirectoryPath).some((key) => invalidatedKeys.has(key)) ||
        current.treeLoadingDirectoryPaths.some((item) => invalidatedKeys.has(item))
      if (!hasInvalidatedTreeState) return current

      return {
        ...current,
        treeEntriesByDirectoryPath: Object.fromEntries(
          Object.entries(current.treeEntriesByDirectoryPath).filter(([key]) => !invalidatedKeys.has(key)),
        ),
        treeErrorByDirectoryPath: Object.fromEntries(
          Object.entries(current.treeErrorByDirectoryPath).filter(([key]) => !invalidatedKeys.has(key)),
        ),
        treeLoadingDirectoryPaths: current.treeLoadingDirectoryPaths.filter((item) => !invalidatedKeys.has(item)),
      }
    })
  }

  async function handleWorkspaceFileSelect(path: string, options: WorkspaceFileSelectOptions = {}) {
    const readWorkspaceFile = window.desktop?.readWorkspaceFile
    const scopeDirectory = options.scopeDirectory ?? activeFileTab?.scopeDirectory ?? activeWorkspaceFileScopeDirectory
    const trimmedPath = path.trim()
    if (!readWorkspaceFile || !scopeDirectory || !trimmedPath) return

    const shouldOpenTargetTab = Boolean(options.scopeDirectory || options.tabID)
    const tabID = options.tabID ?? (
      shouldOpenTargetTab
        ? openFilesTab({
            path: trimmedPath,
            scopeDirectory,
            scopeName: options.scopeName,
          })
        : activeFileTab?.id ?? openFilesTab({
            path: trimmedPath,
            scopeDirectory,
            scopeName: options.scopeName,
          })
    )
    const linkedLineRange = options.linkedLineRange ?? null
    const expandedAncestorDirectories = getWorkspaceFileAncestorDirectoryPaths(trimmedPath)
    const requestID = (workspaceFileReadRequestByTabRef.current[tabID] ?? 0) + 1
    workspaceFileReadRequestByTabRef.current[tabID] = requestID
    const currentFileTab = getTabByID(tabID)
    const currentFileState = currentFileTab?.kind === "files" ? currentFileTab.state : activeFileTab?.state
    const shouldKeepCurrentReaderVisible = hasRenderableWorkspaceFile(currentFileState)
    const nextScopeName = options.scopeName ?? activeFileTab?.scopeName ?? activeWorkspaceFileScopeName

    setRightSidebarFileState(tabID, (current) => {
      const treeExpandedDirectoryPaths = Array.from(
        new Set([...current.treeExpandedDirectoryPaths, ...expandedAncestorDirectories]),
      )

      if (hasRenderableWorkspaceFile(current)) {
        return {
          ...current,
          scopeDirectory,
          errorMessage: null,
          status: "reading",
          treeExpandedDirectoryPaths,
        }
      }

      return {
        ...current,
        scopeDirectory,
        selectedFilePath: trimmedPath,
        selectedFileContent: null,
        selectedFileKind: null,
        selectedFileExtension: null,
        selectedFileMimeType: null,
        selectedFilePreviewUrl: null,
        selectedFileSize: null,
        comments: [],
        linkedLineRange,
        pendingComment: null,
        errorMessage: null,
        status: "reading",
        treeExpandedDirectoryPaths,
      }
    })

    if (!shouldKeepCurrentReaderVisible) {
      updateRightSidebarTab(tabID, {
        scopeDirectory,
        scopeName: nextScopeName,
        targetKey: getFilesTabTargetKey(scopeDirectory, trimmedPath),
        title: getPathName(trimmedPath) ?? "Files",
      })
    }

    try {
      const nextFile = await readWorkspaceFile({
        directory: scopeDirectory,
        path: trimmedPath,
      })
      if (workspaceFileReadRequestByTabRef.current[tabID] !== requestID) return

      const commentKey = getWorkspaceFileCommentKey(scopeDirectory, nextFile.path, platform)
      const nextComments = commentKey ? workspaceFileCommentsByTarget[commentKey] ?? [] : []
      const nextErrorMessage = nextFile.kind === "unsupported" ? nextFile.unsupportedReason ?? null : null

      setRightSidebarFileState(tabID, (current) => ({
        ...current,
        selectedFilePath: nextFile.path,
        selectedFileContent: nextFile.kind === "text" ? nextFile.content ?? "" : null,
        selectedFileKind: nextFile.kind,
        selectedFileExtension: nextFile.extension,
        selectedFileMimeType: nextFile.mimeType ?? null,
        selectedFilePreviewUrl: nextFile.previewUrl ?? null,
        selectedFileSize: nextFile.size ?? null,
        comments: nextComments,
        linkedLineRange: nextFile.kind === "text" ? linkedLineRange : null,
        pendingComment: null,
        errorMessage: nextErrorMessage,
        status: nextFile.kind === "text" || nextFile.kind === "image" || nextFile.kind === "video" ? "ready" : "unsupported",
      }))
      updateRightSidebarTab(tabID, {
        scopeDirectory,
        scopeName: nextScopeName,
        targetKey: getFilesTabTargetKey(scopeDirectory, nextFile.path),
        title: getPathName(nextFile.path) ?? "Files",
      })
    } catch (error) {
      if (workspaceFileReadRequestByTabRef.current[tabID] !== requestID) return
      const message = error instanceof Error ? error.message : String(error)

      setRightSidebarFileState(tabID, (current) => ({
        ...current,
        selectedFilePath: trimmedPath,
        selectedFileContent: null,
        selectedFileKind: null,
        selectedFileExtension: null,
        selectedFileMimeType: null,
        selectedFilePreviewUrl: null,
        selectedFileSize: null,
        comments: [],
        linkedLineRange,
        pendingComment: null,
        errorMessage: message,
        status: "error",
      }))
      updateRightSidebarTab(tabID, {
        scopeDirectory,
        scopeName: nextScopeName,
        targetKey: getFilesTabTargetKey(scopeDirectory, trimmedPath),
        title: getPathName(trimmedPath) ?? "Files",
      })
      console.error("[desktop] readWorkspaceFile failed:", error)
    }
  }

  function handleWorkspaceFileCommentStart(startLineNumber: number, endLineNumber = startLineNumber) {
    if (!activeFileTab?.state.selectedFilePath) return
    const nextRange = normalizeWorkspaceFileLineRange(startLineNumber, endLineNumber)
    setRightSidebarFileState(activeFileTab.id, (current) => ({
      ...current,
      linkedLineRange: null,
      pendingComment: {
        ...nextRange,
        text:
          current.pendingComment &&
          current.pendingComment.startLineNumber === nextRange.startLineNumber &&
          current.pendingComment.endLineNumber === nextRange.endLineNumber
            ? current.pendingComment.text
            : "",
      },
    }))
  }

  function handleWorkspaceFileCommentChange(text: string) {
    if (!activeFileTab) return
    setRightSidebarFileState(activeFileTab.id, (current) =>
      current.pendingComment
        ? {
            ...current,
            pendingComment: {
              ...current.pendingComment,
              text,
            },
          }
        : current,
    )
  }

  function handleWorkspaceFileCommentCancel() {
    if (!activeFileTab) return
    setRightSidebarFileState(activeFileTab.id, (current) => ({
      ...current,
      pendingComment: null,
    }))
  }

  function commitWorkspaceFileComment(insertIntoComposer: boolean) {
    if (!activeFileTab) return
    const scopeDirectory = activeFileTab.scopeDirectory
    const selectedFilePath = activeFileTab.state.selectedFilePath
    const selectedFileContent = activeFileTab.state.selectedFileContent
    const selectedFileExtension = activeFileTab.state.selectedFileExtension
    const pendingComment = activeFileTab.state.pendingComment
    if (!scopeDirectory || !selectedFilePath || !pendingComment) return

    const trimmedText = pendingComment.text.trim()
    const commentKey = getWorkspaceFileCommentKey(scopeDirectory, selectedFilePath, platform)
    if (!trimmedText || !commentKey) return

    const nextComment: WorkspaceFileComment = {
      id: createID("file-comment"),
      filePath: selectedFilePath,
      startLineNumber: pendingComment.startLineNumber,
      endLineNumber: pendingComment.endLineNumber,
      text: trimmedText,
      createdAt: Date.now(),
    }

    setWorkspaceFileCommentsByTarget((current) => ({
      ...current,
      [commentKey]: [...(current[commentKey] ?? []), nextComment],
    }))
    setRightSidebarFileState(activeFileTab.id, (current) => ({
      ...current,
      comments: [...current.comments, nextComment],
      pendingComment: null,
      errorMessage: current.selectedFileKind === "unsupported" ? current.errorMessage : null,
      status: current.selectedFileKind === "unsupported" ? "unsupported" : "ready",
    }))

    if (insertIntoComposer && activeTabKey && selectedFileContent !== null) {
      const prompt = buildWorkspaceFileCommentDraft({
        content: selectedFileContent,
        extension: selectedFileExtension,
        filePath: selectedFilePath,
        comment: nextComment,
      })

      if (!prompt) return

      const label = buildWorkspaceFileCommentReferenceLabel(
        selectedFilePath,
        nextComment.startLineNumber,
        nextComment.endLineNumber,
      )

      const nextReference: ComposerCommentReference = {
        source: "file",
        id: createID("composer-comment-reference"),
        filePath: selectedFilePath,
        startLineNumber: nextComment.startLineNumber,
        endLineNumber: nextComment.endLineNumber,
        label,
        title: `${selectedFilePath} (${formatWorkspaceFileLineRangeLabel(nextComment.startLineNumber, nextComment.endLineNumber)})`,
        prompt,
      }

      setComposerDraftStateByTabKey((current) => ({
        ...current,
        [activeTabKey]: appendComposerTagToDraftState(
          current[activeTabKey] ?? createEmptyComposerDraftState(),
          createComposerCommentTagData(nextReference),
        ),
      }))
    }
  }

  function handleWorkspaceFileCommentConfirm() {
    commitWorkspaceFileComment(true)
  }

  function handleActiveSessionDiffFileSelect(file: string | null, sessionID = activeSessionID) {
    if (!sessionID) return

    openReviewTab(sessionID)
    setSelectedDiffFileBySession((prev) => ({
      ...prev,
      [sessionID]: file,
    }))
  }

  async function handleActiveSessionDiffRefresh(sessionID = activeSessionID) {
    if (!sessionID) return
    await loadSessionDiffForSession(sessionID)
  }

  async function handleActiveSessionDiffFilesRestore(files: string[], sessionID = activeSessionID) {
    const uniqueFiles = [...new Set(files.map((file) => file.trim()).filter(Boolean))]
    if (uniqueFiles.length === 0) return

    const restoreWorkspaceDiffFile = window.desktop?.restoreWorkspaceDiffFile
    if (!restoreWorkspaceDiffFile) {
      throw new Error("Workspace diff restore bridge is unavailable.")
    }
    const sessionDirectory = resolveSessionDirectory(sessionID) ?? activeSessionDirectory
    if (!sessionID || !sessionDirectory) {
      throw new Error("Select a session before restoring a file.")
    }

    for (const file of uniqueFiles) {
      await restoreWorkspaceDiffFile({
        directory: sessionDirectory,
        file,
      })
    }
    setSelectedDiffFileBySession((prev) => ({
      ...prev,
      [sessionID]: null,
    }))
    await loadSessionDiffForSession(sessionID)
  }

  async function handleActiveSessionDiffFileRestore(file: string, sessionID = activeSessionID) {
    await handleActiveSessionDiffFilesRestore([file], sessionID)
  }

  async function handleActiveSessionDiffPatchesReverseApply(diffs: SessionDiffFile[], sessionID = activeSessionID) {
    const patchDiffs = diffs
      .map((diff) => ({
        file: diff.file.trim(),
        ...(diff.patch?.trim() ? { patch: diff.patch } : {}),
      }))
      .filter((diff) => diff.file)
    if (patchDiffs.length === 0) return

    const reverseApplyWorkspaceDiffPatches = window.desktop?.reverseApplyWorkspaceDiffPatches
    if (!reverseApplyWorkspaceDiffPatches) {
      throw new Error("Workspace diff reverse-apply bridge is unavailable.")
    }
    const sessionDirectory = resolveSessionDirectory(sessionID) ?? activeSessionDirectory
    if (!sessionID || !sessionDirectory) {
      throw new Error("Select a session before restoring a file.")
    }

    let result: Awaited<ReturnType<typeof reverseApplyWorkspaceDiffPatches>> | null = null
    try {
      result = await reverseApplyWorkspaceDiffPatches({
        directory: sessionDirectory,
        diffs: patchDiffs,
      })
    } finally {
      setSelectedDiffFileBySession((prev) => ({
        ...prev,
        [sessionID]: null,
      }))
      await loadSessionDiffForSession(sessionID)
    }

    if (result.failed.length > 0) {
      throw new Error(formatReverseApplyFailureMessage(result))
    }
  }

  async function handleActiveSessionRuntimeDebugRefresh(sessionID = activeSessionID) {
    if (!sessionID) return
    await loadSessionRuntimeDebugForSession(sessionID)
  }

  useWorkspaceFileReviewScopeEffects({
    activeWorkspaceFileScopeDirectory: activeFileTab?.scopeDirectory ?? null,
    platform,
    setWorkspaceFileReviewState: (update) => {
      if (!activeFileTab) return
      setRightSidebarFileState(activeFileTab.id, update)
    },
    workspaceFileReadRequestRef,
    workspaceFileSearchRequestRef,
  })

  return {
    handleActiveSessionDiffFileSelect,
    handleActiveSessionDiffFileRestore,
    handleActiveSessionDiffFilesRestore,
    handleActiveSessionDiffPatchesReverseApply,
    handleActiveSessionDiffRefresh,
    handleActiveSessionRuntimeDebugRefresh,
    handlePreviewActiveInteractionChange,
    handlePreviewBack,
    handlePreviewCommitInteraction,
    handlePreviewDeleteInteraction,
    handlePreviewDraftUrlChange,
    handlePreviewForward,
    handlePreviewInsertInteractionsIntoDraft,
    handlePreviewOpen,
    handlePreviewOpenExternal,
    handlePreviewOpenTarget,
    handlePreviewOpenUrl,
    handlePreviewReload,
    handleWorkspaceFileCommentCancel,
    handleWorkspaceFileCommentChange,
    handleWorkspaceFileCommentConfirm,
    handleWorkspaceFileCommentStart,
    handleWorkspaceDirectoryLoad,
    handleWorkspaceDirectoryToggle,
    handleWorkspaceFileTreeInvalidate,
    handleWorkspaceFileQueryChange,
    handleWorkspaceFileSelect,
  }
}
