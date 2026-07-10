import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ErrorInfo,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  AlertCircle,
  ArrowLeft,
  Check,
  File,
  Folder,
  FolderPlus,
  Image,
  Loader2,
  Move,
  Music,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react"
import type {
  CinemaAssetMigrationStatusResult,
  CinemaAssetKind,
  CinemaAssetRecord,
  CinemaAssetScope,
} from "@anybox/shared"
import {
  AssetLibraryApiError,
  createAssetLibraryApi,
  type AssetLibraryApi,
  type AssetLibraryEntryRef,
} from "./assetLibraryApi"
import {
  CINEMA_ASSET_LIBRARY_DRAG_TYPE,
  CINEMA_ASSET_LIBRARY_ENTRY_DRAG_TYPE,
  CINEMA_ASSET_LIBRARY_GRID_COLUMNS,
  applyAssetLibrarySelection,
  assetRenameParts,
  assetLibraryGridRowCount,
  assetLibraryEntryKey,
  assetLibraryEntryName,
  assetLibraryEntryPath,
  assetLibraryEntryRef,
  assetLibraryScrollPositionKey,
  assetLibraryScope,
  assetLibraryScopeKey,
  formatAssetLibraryDuration,
  formatAssetLibrarySize,
  formatAssetLibraryTimestamp,
  isEditableTarget,
  parseAssetLibraryDragPayload,
  parseAssetLibraryEntryDragPayload,
  serializeAssetLibraryDragPayload,
  serializeAssetLibraryEntryDragPayload,
  shouldVirtualizeAssetLibraryGrid,
  sortAssetLibraryEntries,
  summarizeAssetLibrarySelection,
  type AssetLibraryEntry,
  type AssetLibraryScopeType,
} from "./assetLibraryModel"
import { useAssetUploadQueue, type AssetUploadQueueItem } from "./useAssetUploadQueue"
import "./asset-library.css"

const PANEL_ID = "cinema-asset-library"
const ROOT_FOLDER_ID = "root"

export interface AssetLibraryAddRequest {
  scope: CinemaAssetScope
  asset: CinemaAssetRecord
}

export type AssetLibraryPanelMode = "add" | "relink"

export interface AssetLibraryPanelProps {
  agentBaseURL: string
  projectID: string
  onClose(): void
  onAddToCanvas(request: AssetLibraryAddRequest): void | Promise<void>
  initialScope?: AssetLibraryScopeType
  mode?: AssetLibraryPanelMode
  acceptKind?: CinemaAssetKind
}

interface ScopeSession {
  folderID: string
  search: string
  selectedKeys: string[]
  anchorKey: string | null
}

interface PanelSession {
  scopeType: AssetLibraryScopeType
  scopes: Record<AssetLibraryScopeType, ScopeSession>
  scrollTop: Record<AssetLibraryScopeType, Record<string, number>>
}

interface PendingPermanentDelete {
  targets?: AssetLibraryEntryRef[]
  entries: AssetLibraryEntry[]
  all: boolean
  totalCount?: number
}

const panelSessions = new Map<string, PanelSession>()

function defaultScopeSession(): ScopeSession {
  return { folderID: ROOT_FOLDER_ID, search: "", selectedKeys: [], anchorKey: null }
}

function loadPanelSession(projectID: string, initialScope: AssetLibraryScopeType): PanelSession {
  const saved = panelSessions.get(projectID)
  if (saved) {
    return {
      scopeType: saved.scopeType,
      scopes: {
        project: { ...saved.scopes.project, selectedKeys: [...saved.scopes.project.selectedKeys] },
        personal: { ...saved.scopes.personal, selectedKeys: [...saved.scopes.personal.selectedKeys] },
      },
      scrollTop: {
        project: { ...saved.scrollTop.project },
        personal: { ...saved.scrollTop.personal },
      },
    }
  }
  return {
    scopeType: initialScope,
    scopes: { project: defaultScopeSession(), personal: defaultScopeSession() },
    scrollTop: { project: {}, personal: {} },
  }
}

function createOperationID(prefix: string): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${suffix}`
}

function errorMessage(error: unknown, fallback = "操作失败"): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [delay, value])
  return debounced
}

interface AssetLibraryErrorBoundaryProps {
  onClose(): void
  children: ReactNode
}

interface AssetLibraryErrorBoundaryState {
  error: Error | null
}

class AssetLibraryErrorBoundary extends Component<AssetLibraryErrorBoundaryProps, AssetLibraryErrorBoundaryState> {
  state: AssetLibraryErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): AssetLibraryErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Asset library render failed", error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <aside id={PANEL_ID} className="cinema-asset-library is-fallback" aria-label="素材库">
        <div className="cinema-asset-library-fallback" role="alert">
          <AlertCircle size={20} aria-hidden="true" />
          <strong>素材库暂时无法显示</strong>
          <span>{this.state.error.message}</span>
          <div className="cinema-asset-library-fallback-actions">
            <button type="button" className="cinema-library-secondary-button" onClick={() => this.setState({ error: null })}>
              重试
            </button>
            <button type="button" className="cinema-library-secondary-button" onClick={this.props.onClose}>
              关闭
            </button>
          </div>
        </div>
      </aside>
    )
  }
}

export function AssetLibraryPanel(props: AssetLibraryPanelProps) {
  return (
    <AssetLibraryErrorBoundary onClose={props.onClose}>
      <AssetLibraryPanelContent {...props} />
    </AssetLibraryErrorBoundary>
  )
}

function AssetLibraryPanelContent({
  agentBaseURL,
  projectID,
  onClose,
  onAddToCanvas,
  initialScope = "project",
  mode = "add",
  acceptKind,
}: AssetLibraryPanelProps) {
  const queryClient = useQueryClient()
  const initialSession = useMemo(() => loadPanelSession(projectID, initialScope), [initialScope, projectID])
  const [scopeType, setScopeType] = useState(initialSession.scopeType)
  const [scopeSessions, setScopeSessions] = useState(initialSession.scopes)
  const scrollTopRef = useRef(initialSession.scrollTop)
  const sessionRef = useRef({ scopeType, scopeSessions })
  const [revision, setRevision] = useState(0)
  const revisionRef = useRef(revision)
  const [actionError, setActionError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<AssetLibraryEntry | null>(null)
  const [moveEntries, setMoveEntries] = useState<AssetLibraryEntryRef[] | null>(null)
  const [undoEntries, setUndoEntries] = useState<AssetLibraryEntryRef[] | null>(null)
  const [isTrashView, setIsTrashView] = useState(false)
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState<PendingPermanentDelete | null>(null)
  const [addingAssetID, setAddingAssetID] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const lastStateRevisionRef = useRef<number | null>(null)
  const currentProjectIDRef = useRef(projectID)
  const skipSessionSaveRef = useRef(false)
  const isProjectTransition = currentProjectIDRef.current !== projectID

  const currentSession = scopeSessions[scopeType]
  const scope = useMemo(() => assetLibraryScope(scopeType, projectID), [projectID, scopeType])
  const scopeKey = useMemo(() => assetLibraryScopeKey(scope), [scope])
  const api = useMemo(
    () => createAssetLibraryApi(agentBaseURL, projectID, scope),
    [agentBaseURL, projectID, scope],
  )
  const debouncedSearch = useDebouncedValue(currentSession.search.trim(), 250)
  const libraryQueryPrefix = useMemo(
    () => ["cinema-asset-library", agentBaseURL, scopeKey] as const,
    [agentBaseURL, scopeKey],
  )
  const scrollPositionKey = useMemo(() => assetLibraryScrollPositionKey({
    folderID: currentSession.folderID,
    query: debouncedSearch,
    trash: isTrashView,
  }), [currentSession.folderID, debouncedSearch, isTrashView])

  const updateCurrentSession = useCallback((patch: Partial<ScopeSession>) => {
    setScopeSessions((current) => ({
      ...current,
      [scopeType]: { ...current[scopeType], ...patch },
    }))
  }, [scopeType])

  sessionRef.current = { scopeType, scopeSessions }
  revisionRef.current = Math.max(revisionRef.current, revision)

  useLayoutEffect(() => {
    if (currentProjectIDRef.current === projectID) return
    panelSessions.set(currentProjectIDRef.current, {
      scopeType: sessionRef.current.scopeType,
      scopes: sessionRef.current.scopeSessions,
      scrollTop: scrollTopRef.current,
    })
    currentProjectIDRef.current = projectID
    // A project switch starts a fresh browsing session by product contract.
    // Closing and reopening the panel inside the same project still uses the
    // saved session loaded during the component's initial mount.
    panelSessions.delete(projectID)
    const nextSession = loadPanelSession(projectID, initialScope)
    skipSessionSaveRef.current = true
    scrollTopRef.current = nextSession.scrollTop
    setScopeType(nextSession.scopeType)
    setScopeSessions(nextSession.scopes)
    setRevision(0)
    revisionRef.current = 0
    lastStateRevisionRef.current = null
    setIsTrashView(false)
    setActionError(null)
    setAnnouncement("")
    setIsCreateFolderOpen(false)
    setRenameTarget(null)
    setMoveEntries(null)
    setUndoEntries(null)
    setPendingPermanentDelete(null)
    setAddingAssetID(null)
  }, [initialScope, projectID])

  useEffect(() => {
    if (skipSessionSaveRef.current) {
      skipSessionSaveRef.current = false
      return
    }
    panelSessions.set(projectID, {
      scopeType,
      scopes: scopeSessions,
      scrollTop: scrollTopRef.current,
    })
  }, [projectID, scopeSessions, scopeType])

  useEffect(() => () => {
    panelSessions.set(currentProjectIDRef.current, {
      scopeType: sessionRef.current.scopeType,
      scopes: sessionRef.current.scopeSessions,
      scrollTop: scrollTopRef.current,
    })
  }, [])

  const stateQuery = useQuery({
    queryKey: [...libraryQueryPrefix, "state"],
    queryFn: ({ signal }) => api.getState(signal),
    enabled: !isProjectTransition,
    refetchInterval: (query) => (query.state.data?.counts.processing ?? 0) > 0 ? 1_000 : false,
  })

  const migrationQuery = useQuery({
    queryKey: [...libraryQueryPrefix, "migration"],
    queryFn: ({ signal }) => api.getMigration(signal),
    enabled: !isProjectTransition && scopeType === "project",
    retry: false,
  })
  const migrationStatus = scopeType === "project" ? migrationQuery.data : null
  const migrationAllowsLibrary = scopeType !== "project"
    || migrationStatus?.phase === "completed"
    || migrationStatus?.phase === "not-required"
  const migrationBlocksLibrary = !migrationAllowsLibrary
  const isReadOnly = stateQuery.data?.readOnly === true || migrationBlocksLibrary

  const listingQuery = useInfiniteQuery({
    queryKey: [
      ...libraryQueryPrefix,
      "entries",
      isTrashView ? "trash" : "library",
      isTrashView ? ROOT_FOLDER_ID : currentSession.folderID,
      isTrashView ? "" : debouncedSearch,
    ],
    queryFn: ({ pageParam, signal }) => api.listEntries({
      folderID: isTrashView ? ROOT_FOLDER_ID : currentSession.folderID,
      query: isTrashView ? "" : debouncedSearch,
      cursor: typeof pageParam === "string" ? pageParam : undefined,
      limit: 50,
      view: isTrashView ? "trash" : "library",
      signal,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !isProjectTransition && stateQuery.isSuccess && migrationAllowsLibrary,
  })

  const listing = listingQuery.data?.pages[0]
  const entries = useMemo(() => {
    const byKey = new Map<string, AssetLibraryEntry>()
    for (const page of listingQuery.data?.pages ?? []) {
      for (const entry of page.entries) byKey.set(assetLibraryEntryKey(entry), entry)
    }
    return sortAssetLibraryEntries([...byKey.values()])
  }, [listingQuery.data])
  const folders = useMemo(() => entries.filter((entry) => entry.entryType === "folder"), [entries])
  const assets = useMemo(
    () => entries.flatMap((entry) => entry.entryType === "asset" ? [entry.asset] : []),
    [entries],
  )
  const orderedKeys = useMemo(() => entries.map(assetLibraryEntryKey), [entries])
  const selectedKeySet = useMemo(() => new Set(currentSession.selectedKeys), [currentSession.selectedKeys])
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedKeySet.has(assetLibraryEntryKey(entry))),
    [entries, selectedKeySet],
  )
  const selectedAsset = selectedEntries.length === 1 && selectedEntries[0]?.entryType === "asset"
    ? selectedEntries[0].asset
    : null
  const selectedFolder = selectedEntries.length === 1 && selectedEntries[0]?.entryType === "folder"
    ? selectedEntries[0].folder
    : null

  const commitRevision = useCallback((nextRevision: number) => {
    if (!Number.isFinite(nextRevision)) return
    revisionRef.current = Math.max(revisionRef.current, nextRevision)
    setRevision((current) => Math.max(current, nextRevision))
  }, [])

  useEffect(() => {
    if (stateQuery.data) commitRevision(stateQuery.data.revision)
  }, [commitRevision, stateQuery.data])

  useEffect(() => {
    const nextRevision = stateQuery.data?.revision
    if (nextRevision === undefined) return
    const previousRevision = lastStateRevisionRef.current
    lastStateRevisionRef.current = nextRevision
    if (previousRevision !== null && previousRevision !== nextRevision) {
      void queryClient.invalidateQueries({ queryKey: [...libraryQueryPrefix, "entries"] })
    }
  }, [libraryQueryPrefix, queryClient, stateQuery.data?.revision])

  useEffect(() => {
    if (listing) commitRevision(listing.revision)
  }, [commitRevision, listing])

  useEffect(() => {
    const element = contentRef.current
    if (!element) return
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = scrollTopRef.current[scopeType][scrollPositionKey] ?? 0
    })
    return () => window.cancelAnimationFrame(frame)
  }, [scopeType, scrollPositionKey])

  useEffect(() => {
    if (!undoEntries) return
    const timer = window.setTimeout(() => setUndoEntries(null), 10_000)
    return () => window.clearTimeout(timer)
  }, [undoEntries])

  const refreshLibrary = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: libraryQueryPrefix }),
      queryClient.invalidateQueries({ queryKey: ["cinema-canvas-asset-state"] }),
    ])
  }, [libraryQueryPrefix, queryClient])

  const uploadFolderID = useMemo(() => {
    const rootFolderID = stateQuery.data?.rootFolderID ?? ROOT_FOLDER_ID
    const inboxFolderID = stateQuery.data?.defaultFolderIDs.inbox
      ?? stateQuery.data?.defaultFolderIDs["收件箱"]
      ?? rootFolderID
    return debouncedSearch || currentSession.folderID === rootFolderID ? inboxFolderID : currentSession.folderID
  }, [currentSession.folderID, debouncedSearch, stateQuery.data])

  const uploadQueue = useAssetUploadQueue({
    api,
    revision,
    onRevision: commitRevision,
    onUploaded: (asset) => {
      setAnnouncement(`${asset.displayName} 已上传`)
      void refreshLibrary()
    },
  })

  const handleActionError = useCallback((error: unknown) => {
    if (error instanceof AssetLibraryApiError && error.latestRevision !== undefined) {
      commitRevision(error.latestRevision)
    }
    setActionError(errorMessage(error))
    if (error instanceof AssetLibraryApiError && error.status === 409) void refreshLibrary()
  }, [commitRevision, refreshLibrary])

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => api.createFolder({
      name,
      parentFolderID: currentSession.folderID,
      operationID: createOperationID("create-folder"),
      baseRevision: revisionRef.current,
    }),
    onSuccess: (result) => {
      commitRevision(result.revision)
      setIsCreateFolderOpen(false)
      setAnnouncement(`已创建文件夹 ${result.folder.name}`)
      void refreshLibrary()
    },
  })

  const renameFolderMutation = useMutation({
    mutationFn: ({ folderID, name }: { folderID: string; name: string }) => api.renameFolder({
      folderID,
      name,
      operationID: createOperationID("rename-folder"),
      baseRevision: revisionRef.current,
    }),
    onSuccess: (result) => {
      commitRevision(result.revision)
      setRenameTarget(null)
      setAnnouncement(`已重命名为 ${result.folder.name}`)
      void refreshLibrary()
    },
  })

  const renameAssetMutation = useMutation({
    mutationFn: ({ assetID, baseName }: { assetID: string; baseName: string }) => api.renameAsset({
      assetID,
      baseName,
      operationID: createOperationID("rename-asset"),
      baseRevision: revisionRef.current,
    }),
    onSuccess: (result) => {
      commitRevision(result.revision)
      setRenameTarget(null)
      setAnnouncement(`已重命名为 ${result.asset.displayName}`)
      void refreshLibrary()
    },
  })

  const moveMutation = useMutation({
    mutationFn: ({ entries: targets, destinationFolderID }: { entries: AssetLibraryEntryRef[]; destinationFolderID: string }) => api.move({
      entries: targets,
      destinationFolderID,
      operationID: createOperationID("move-assets"),
      baseRevision: revisionRef.current,
    }),
    onSuccess: (result) => {
      commitRevision(result.revision)
      updateCurrentSession({ selectedKeys: [], anchorKey: null })
      setMoveEntries(null)
      setAnnouncement("素材已移动")
      void refreshLibrary()
    },
  })

  const trashMutation = useMutation({
    mutationFn: (targets: AssetLibraryEntryRef[]) => api.trash({
      entries: targets,
      operationID: createOperationID("trash-assets"),
      baseRevision: revisionRef.current,
    }),
    onSuccess: (result, targets) => {
      commitRevision(result.revision)
      updateCurrentSession({ selectedKeys: [], anchorKey: null })
      setUndoEntries(targets)
      setAnnouncement("已移入回收站，可在 10 秒内撤销")
      void refreshLibrary()
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (targets: AssetLibraryEntryRef[]) => api.restore({
      entries: targets,
      operationID: createOperationID("restore-assets"),
      baseRevision: revisionRef.current,
    }),
    onSuccess: (result) => {
      commitRevision(result.revision)
      setUndoEntries(null)
      updateCurrentSession({ selectedKeys: [], anchorKey: null })
      setAnnouncement("已恢复素材")
      void refreshLibrary()
    },
  })

  const permanentDeleteMutation = useMutation({
    mutationFn: ({ targets, all }: { targets?: AssetLibraryEntryRef[]; all: boolean }) => {
      const operationID = createOperationID("permanent-delete-assets")
      const baseRevision = revisionRef.current
      return all
        ? api.permanentlyDelete({ all: true, operationID, baseRevision })
        : api.permanentlyDelete({ entries: targets ?? [], operationID, baseRevision })
    },
    onSuccess: (result, request) => {
      commitRevision(result.revision)
      updateCurrentSession({ selectedKeys: [], anchorKey: null })
      setPendingPermanentDelete(null)
      setAnnouncement(request.all ? "已清空回收站" : `已永久删除 ${request.targets?.length ?? 0} 项`)
      void refreshLibrary()
    },
  })

  const retryMutation = useMutation({
    mutationFn: (assetID: string) => api.retryProcessing({
      assetID,
      operationID: createOperationID("retry-asset"),
      baseRevision: revisionRef.current,
    }),
    onSuccess: (result) => {
      commitRevision(result.revision)
      setAnnouncement(`${result.asset.displayName} 正在重新处理`)
      void refreshLibrary()
    },
  })

  const reconcileMutation = useMutation({
    mutationFn: () => api.reconcile({
      full: true,
      operationID: createOperationID("reconcile-assets"),
      baseRevision: revisionRef.current,
    }),
    onSuccess: (result) => {
      commitRevision(result.revision)
      setAnnouncement("素材库已重新扫描")
      void refreshLibrary()
    },
  })

  const migrationMutation = useMutation({
    mutationFn: (status: CinemaAssetMigrationStatusResult) => api.startMigration({
      candidateIDs: status.candidates
        .filter((candidate) => candidate.selected && !candidate.issue)
        .map((candidate) => candidate.id),
      operationID: createOperationID("migrate-assets"),
      baseRevision: revisionRef.current,
    }),
    onSuccess: (result) => {
      commitRevision(result.revision)
      setAnnouncement(`已迁移 ${result.migratedAssetIDs.length} 个旧素材`)
      void refreshLibrary()
    },
  })

  const openFolder = useCallback((folderID: string) => {
    updateCurrentSession({ folderID, search: "", selectedKeys: [], anchorKey: null })
    setActionError(null)
  }, [updateCurrentSession])

  const goUp = useCallback(() => {
    const rootFolderID = stateQuery.data?.rootFolderID ?? ROOT_FOLDER_ID
    if (currentSession.folderID === rootFolderID) return
    openFolder(listing?.folder?.parentID ?? rootFolderID)
  }, [currentSession.folderID, listing?.folder?.parentID, openFolder, stateQuery.data?.rootFolderID])

  const toggleTrashView = useCallback(() => {
    setIsTrashView((current) => !current)
    updateCurrentSession({ selectedKeys: [], anchorKey: null })
    setActionError(null)
    setMoveEntries(null)
    setRenameTarget(null)
    setIsCreateFolderOpen(false)
    setPendingPermanentDelete(null)
  }, [updateCurrentSession])

  const switchScope = useCallback((nextScope: AssetLibraryScopeType) => {
    if (nextScope === scopeType) return
    setScopeSessions((current) => ({
      ...current,
      [scopeType]: { ...current[scopeType], selectedKeys: [], anchorKey: null },
      [nextScope]: { ...current[nextScope], selectedKeys: [], anchorKey: null },
    }))
    revisionRef.current = 0
    setRevision(0)
    setScopeType(nextScope)
    setActionError(null)
    setMoveEntries(null)
    setRenameTarget(null)
    setIsCreateFolderOpen(false)
    setPendingPermanentDelete(null)
  }, [scopeType])

  const selectEntry = useCallback((
    entry: AssetLibraryEntry,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    const key = assetLibraryEntryKey(entry)
    if (!isTrashView && entry.entryType === "folder" && (entry.folder.system || (!event.metaKey && !event.ctrlKey && !event.shiftKey))) {
      openFolder(entry.folder.id)
      return
    }
    const selection = applyAssetLibrarySelection(
      selectedKeySet,
      orderedKeys,
      key,
      currentSession.anchorKey,
      { toggle: event.metaKey || event.ctrlKey, range: event.shiftKey },
    )
    updateCurrentSession({ selectedKeys: [...selection.selectedKeys], anchorKey: selection.anchorKey })
  }, [currentSession.anchorKey, isTrashView, openFolder, orderedKeys, selectedKeySet, updateCurrentSession])

  const addAssetToCanvas = useCallback(async (asset: CinemaAssetRecord) => {
    if (asset.status !== "ready" || addingAssetID || (acceptKind && asset.kind !== acceptKind)) return
    setAddingAssetID(asset.id)
    setActionError(null)
    try {
      await onAddToCanvas({ scope, asset })
      setAnnouncement(mode === "relink"
        ? `已重新关联到 ${asset.displayName}`
        : `${asset.displayName} 已添加到画布`)
    } catch (error) {
      handleActionError(error)
    } finally {
      setAddingAssetID(null)
    }
  }, [acceptKind, addingAssetID, handleActionError, mode, onAddToCanvas, scope])

  const selectedTargets = useMemo(
    () => selectedEntries
      .filter((entry) => entry.entryType === "asset" || !entry.folder.system)
      .map(assetLibraryEntryRef),
    [selectedEntries],
  )

  const requestTrash = useCallback((targets: AssetLibraryEntryRef[], sourceEntries = selectedEntries) => {
    if (targets.length === 0 || isReadOnly) return
    const requiresConfirmation = targets.length > 1 || sourceEntries.some((entry) => entry.entryType === "folder")
    if (requiresConfirmation && !window.confirm(`将 ${targets.length} 项移入回收站？`)) return
    setActionError(null)
    void trashMutation.mutateAsync(targets).catch(handleActionError)
  }, [handleActionError, isReadOnly, selectedEntries, trashMutation])

  const requestRestore = useCallback((targets: AssetLibraryEntryRef[]) => {
    if (targets.length === 0 || isReadOnly) return
    setActionError(null)
    void restoreMutation.mutateAsync(targets).catch(handleActionError)
  }, [handleActionError, isReadOnly, restoreMutation])

  const requestPermanentDelete = useCallback((
    targets: AssetLibraryEntryRef[],
    sourceEntries = selectedEntries,
  ) => {
    if (targets.length === 0 || isReadOnly) return
    setActionError(null)
    setPendingPermanentDelete({ targets, entries: sourceEntries, all: false })
  }, [isReadOnly, selectedEntries])

  const requestEmptyTrash = useCallback(() => {
    const trashedCount = stateQuery.data?.counts.trashed ?? 0
    if (trashedCount === 0 || isReadOnly) return
    setActionError(null)
    setPendingPermanentDelete({ entries: [], all: true, totalCount: trashedCount })
  }, [isReadOnly, stateQuery.data?.counts.trashed])

  const handleFiles = useCallback((files: Iterable<File>) => {
    if (isReadOnly) return
    const list = Array.from(files)
    if (list.length === 0) return
    uploadQueue.enqueue(list, uploadFolderID)
    setAnnouncement(`已加入 ${list.length} 个上传任务`)
  }, [isReadOnly, uploadFolderID, uploadQueue])

  const handlePanelDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    event.stopPropagation()
    if (isTrashView) {
      setActionError("请先返回素材库再上传文件")
      return
    }
    const hasDirectory = Array.from(event.dataTransfer.items).some((item) => {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }).webkitGetAsEntry?.()
      return entry?.isDirectory === true
    })
    if (hasDirectory) {
      setActionError("暂不支持导入整个文件夹，请选择文件")
      return
    }
    handleFiles(event.dataTransfer.files)
  }, [handleFiles, isTrashView])

  const moveEntriesToFolder = useCallback((targets: AssetLibraryEntryRef[], destinationFolderID: string) => {
    if (isReadOnly || targets.length === 0) return
    setActionError(null)
    void moveMutation.mutateAsync({ entries: targets, destinationFolderID }).catch(handleActionError)
  }, [handleActionError, isReadOnly, moveMutation])

  const handlePanelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      if (moveEntries || renameTarget || isCreateFolderOpen || pendingPermanentDelete) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (isEditableTarget(event.target)) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault()
      const selectableKeys = entries
        .filter((entry) => entry.entryType === "asset" || !entry.folder.system)
        .map(assetLibraryEntryKey)
      updateCurrentSession({ selectedKeys: selectableKeys, anchorKey: selectableKeys.at(-1) ?? null })
      return
    }
    if (isTrashView && (event.key === "Backspace" || (event.altKey && event.key === "ArrowLeft"))) {
      event.preventDefault()
      setIsTrashView(false)
      updateCurrentSession({ selectedKeys: [], anchorKey: null })
      return
    }
    if (event.key === "Backspace" || (event.altKey && event.key === "ArrowLeft")) {
      event.preventDefault()
      goUp()
    }
  }, [entries, goUp, isCreateFolderOpen, isTrashView, moveEntries, onClose, pendingPermanentDelete, renameTarget, updateCurrentSession])

  const queryError = stateQuery.error ?? migrationQuery.error ?? listingQuery.error
  const rootFolderID = stateQuery.data?.rootFolderID ?? ROOT_FOLDER_ID

  return (
    <aside
      id={PANEL_ID}
      className="cinema-asset-library"
      aria-label="素材库"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handlePanelKeyDown}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault()
      }}
      onDrop={handlePanelDrop}
    >
      <header className="cinema-asset-library-header">
        <div className="cinema-asset-library-title">
          <span>{scopeType === "project" ? "当前项目" : "本机"}</span>
          <strong>{isTrashView ? "回收站" : "素材库"}</strong>
        </div>
        <div className="cinema-asset-library-header-actions">
          <input
            ref={uploadInputRef}
            className="cinema-asset-library-file-input"
            type="file"
            hidden
            accept="image/*,video/*,audio/*,.mkv,.flac,.m4v,.m4a"
            multiple
            tabIndex={-1}
            onChange={(event) => {
              if (event.target.files) handleFiles(event.target.files)
              event.target.value = ""
            }}
          />
          {!isTrashView ? (
            <>
              <LibraryIconButton
                label="上传素材"
                disabled={isReadOnly || stateQuery.isLoading}
                onClick={() => uploadInputRef.current?.click()}
              >
                <Upload size={15} aria-hidden="true" />
              </LibraryIconButton>
              <LibraryIconButton
                label="新建文件夹"
                disabled={isReadOnly || stateQuery.isLoading || Boolean(debouncedSearch)}
                onClick={() => setIsCreateFolderOpen(true)}
              >
                <FolderPlus size={15} aria-hidden="true" />
              </LibraryIconButton>
            </>
          ) : null}
          <LibraryIconButton
            label={isTrashView
              ? "返回素材库"
              : `打开回收站，${stateQuery.data?.counts.trashed ?? 0} 项`}
            pressed={isTrashView}
            badge={stateQuery.data?.counts.trashed ?? 0}
            disabled={stateQuery.isLoading || migrationBlocksLibrary}
            onClick={toggleTrashView}
          >
            {isTrashView
              ? <ArrowLeft size={15} aria-hidden="true" />
              : <Trash2 size={15} aria-hidden="true" />}
          </LibraryIconButton>
          <LibraryIconButton
            label={isTrashView ? "刷新回收站" : "刷新素材库"}
            disabled={stateQuery.isLoading || migrationBlocksLibrary || reconcileMutation.isPending}
            onClick={() => {
              setActionError(null)
              if (isTrashView) void refreshLibrary().catch(handleActionError)
              else void reconcileMutation.mutateAsync().catch(handleActionError)
            }}
          >
            {reconcileMutation.isPending
              ? <Loader2 size={15} aria-hidden="true" className="is-spinning" />
              : <RefreshCw size={15} aria-hidden="true" />}
          </LibraryIconButton>
          <LibraryIconButton label="关闭素材库" onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </LibraryIconButton>
        </div>
      </header>

      <div className="cinema-asset-library-tabs" role="tablist" aria-label="素材库范围">
        {(["project", "personal"] as const).map((tabScope) => (
          <button
            key={tabScope}
            id={`cinema-asset-library-tab-${tabScope}`}
            type="button"
            role="tab"
            aria-selected={scopeType === tabScope}
            aria-controls="cinema-asset-library-panel"
            tabIndex={scopeType === tabScope ? 0 : -1}
            className={scopeType === tabScope ? "is-active" : ""}
            onClick={() => switchScope(tabScope)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
              event.preventDefault()
              const nextScope = tabScope === "project" ? "personal" : "project"
              switchScope(nextScope)
              window.requestAnimationFrame(() => {
                document.getElementById(`cinema-asset-library-tab-${nextScope}`)?.focus()
              })
            }}
          >
            {tabScope === "project" ? "项目" : "个人"}
          </button>
        ))}
      </div>

      {!isTrashView ? <label className="cinema-asset-library-search">
        <Search size={14} aria-hidden="true" />
        <span className="cinema-library-visually-hidden">搜索当前素材库</span>
        <input
          type="search"
          value={currentSession.search}
          disabled={migrationBlocksLibrary}
          placeholder="搜索素材和文件夹"
          onChange={(event) => updateCurrentSession({ search: event.target.value, selectedKeys: [], anchorKey: null })}
        />
        {currentSession.search ? (
          <button
            type="button"
            aria-label="清空搜索"
            title="清空搜索"
            disabled={migrationBlocksLibrary}
            onClick={() => updateCurrentSession({ search: "", selectedKeys: [], anchorKey: null })}
          >
            <X size={13} aria-hidden="true" />
          </button>
        ) : null}
      </label> : null}

      {isTrashView ? (
        <div className="cinema-asset-library-trash-toolbar">
          <span>仅显示每次回收操作的最上层项目</span>
          <button
            type="button"
            className="cinema-library-danger-button cinema-asset-library-trash-empty-button"
            disabled={isReadOnly || permanentDeleteMutation.isPending || (stateQuery.data?.counts.trashed ?? 0) === 0}
            onClick={requestEmptyTrash}
          >
            清空回收站
          </button>
        </div>
      ) : <nav className="cinema-asset-library-breadcrumbs" aria-label="素材文件夹路径">
        <button
          type="button"
          title="素材库根目录"
          disabled={migrationBlocksLibrary}
          aria-current={currentSession.folderID === rootFolderID ? "location" : undefined}
          onClick={() => openFolder(rootFolderID)}
        >
          素材库
        </button>
        {(listing?.breadcrumbs ?? [])
          .filter((breadcrumb) => breadcrumb.id !== rootFolderID)
          .map((breadcrumb) => (
            <button
              key={breadcrumb.id}
              type="button"
              title={breadcrumb.name}
              disabled={migrationBlocksLibrary}
              aria-current={breadcrumb.id === currentSession.folderID ? "location" : undefined}
              onClick={() => openFolder(breadcrumb.id)}
            >
              {breadcrumb.name}
            </button>
          ))}
      </nav>}

      {stateQuery.data?.status === "recovery-required" ? (
        <div className="cinema-asset-library-banner is-error" role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          <span>素材库需要恢复，当前仅可浏览。</span>
        </div>
      ) : null}

      {scopeType === "personal" ? (
        <div className="cinema-asset-library-banner">
          <AlertCircle size={14} aria-hidden="true" />
          <span>个人素材不会随项目迁移到其他设备。</span>
        </div>
      ) : null}

      {!isTrashView && uploadQueue.items.length > 0 ? (
        <AssetUploadQueue
          items={uploadQueue.items}
          onCancel={uploadQueue.cancel}
          onRetry={uploadQueue.retry}
          onClear={uploadQueue.clearSettled}
        />
      ) : null}

      <div
        id="cinema-asset-library-panel"
        ref={contentRef}
        className={`cinema-asset-library-content ${isTrashView ? "is-trash" : ""}`}
        role="tabpanel"
        aria-labelledby={`cinema-asset-library-tab-${scopeType}`}
        aria-busy={stateQuery.isLoading || migrationQuery.isLoading || listingQuery.isLoading || migrationMutation.isPending}
        onScroll={(event) => {
          scrollTopRef.current[scopeType][scrollPositionKey] = event.currentTarget.scrollTop
        }}
      >
        {stateQuery.isLoading || (scopeType === "project" && migrationQuery.isLoading) || listingQuery.isLoading ? (
          <LibraryState
            icon={<Loader2 size={18} aria-hidden="true" className="is-spinning" />}
            label={scopeType === "project" && migrationQuery.isLoading
              ? "正在检查旧项目素材"
              : isTrashView ? "正在加载回收站" : "正在加载素材库"}
          />
        ) : queryError ? (
          <LibraryState
            error
            icon={<AlertCircle size={18} aria-hidden="true" />}
            label={errorMessage(queryError, "无法加载素材库")}
            action={<button type="button" className="cinema-library-secondary-button" onClick={() => void refreshLibrary()}>重试</button>}
          />
        ) : migrationBlocksLibrary && migrationStatus ? (
          <AssetMigrationGuide
            status={migrationStatus}
            pending={migrationMutation.isPending}
            onRefresh={() => void refreshLibrary()}
            onStart={() => {
              setActionError(null)
              void migrationMutation.mutateAsync(migrationStatus).catch(handleActionError)
            }}
          />
        ) : entries.length === 0 ? (
          <LibraryState
            icon={isTrashView
              ? <Trash2 size={18} aria-hidden="true" />
              : debouncedSearch ? <Search size={18} aria-hidden="true" /> : <Folder size={18} aria-hidden="true" />}
            label={isTrashView ? "回收站为空" : debouncedSearch ? "没有匹配的素材" : "此文件夹为空"}
            detail={isTrashView
              ? "移入回收站的素材和文件夹会显示在这里"
              : debouncedSearch ? "尝试其他关键词" : "上传图片、视频或音频开始使用"}
            action={!isTrashView && !debouncedSearch && !isReadOnly
              ? <button type="button" className="cinema-library-secondary-button" onClick={() => uploadInputRef.current?.click()}>上传素材</button>
              : undefined}
          />
        ) : (
          <>
            {folders.length > 0 ? (
              <section className="cinema-asset-library-folders" aria-label="文件夹">
                {folders.map((entry) => {
                  if (entry.entryType !== "folder") return null
                  const key = assetLibraryEntryKey(entry)
                  return (
                    <button
                      key={entry.folder.id}
                      type="button"
                      className={`cinema-asset-library-folder-row ${selectedKeySet.has(key) ? "is-selected" : ""}`}
                      title={assetLibraryEntryPath(entry) || entry.folder.name}
                      draggable={!isTrashView && !entry.folder.system && !isReadOnly}
                      onClick={(event) => selectEntry(entry, event)}
                      onDragStart={(event) => {
                        if (isTrashView || entry.folder.system || isReadOnly) {
                          event.preventDefault()
                          return
                        }
                        const targets = selectedKeySet.has(key) && selectedTargets.length > 0
                          ? selectedTargets
                          : [{ entryType: "folder" as const, folderID: entry.folder.id }]
                        event.dataTransfer.effectAllowed = "move"
                        event.dataTransfer.setData(CINEMA_ASSET_LIBRARY_ENTRY_DRAG_TYPE, serializeAssetLibraryEntryDragPayload({
                          version: 1,
                          scope,
                          entries: targets,
                        }))
                      }}
                      onDragOver={(event) => {
                        if (isTrashView) return
                        if (
                          event.dataTransfer.types.includes(CINEMA_ASSET_LIBRARY_ENTRY_DRAG_TYPE)
                          || event.dataTransfer.types.includes(CINEMA_ASSET_LIBRARY_DRAG_TYPE)
                        ) event.preventDefault()
                      }}
                      onDrop={(event) => {
                        if (isTrashView) return
                        const internalPayload = parseAssetLibraryEntryDragPayload(
                          event.dataTransfer.getData(CINEMA_ASSET_LIBRARY_ENTRY_DRAG_TYPE),
                        )
                        if (internalPayload) {
                          event.preventDefault()
                          event.stopPropagation()
                          if (assetLibraryScopeKey(internalPayload.scope) !== api.scopeKey) {
                            setActionError("不能跨项目与个人素材库移动")
                            return
                          }
                          moveEntriesToFolder(internalPayload.entries, entry.folder.id)
                          return
                        }
                        const raw = event.dataTransfer.getData(CINEMA_ASSET_LIBRARY_DRAG_TYPE)
                        if (!raw) return
                        event.preventDefault()
                        event.stopPropagation()
                        const payload = parseAssetLibraryDragPayload(raw)
                        if (!payload) {
                          setActionError("无法识别拖入的素材")
                          return
                        }
                        if (assetLibraryScopeKey(payload.scope) !== api.scopeKey) {
                          setActionError("不能跨项目与个人素材库移动")
                          return
                        }
                        moveEntriesToFolder([{ entryType: "asset", assetID: payload.assetID }], entry.folder.id)
                      }}
                    >
                      <Folder size={15} aria-hidden="true" />
                      <span>{entry.folder.name}</span>
                      {isTrashView
                        ? <small title={assetLibraryEntryPath(entry)}>{assetLibraryEntryPath(entry)}</small>
                        : debouncedSearch
                          ? <small title={entry.folder.relativePath}>{entry.folder.relativePath}</small>
                        : entry.folder.system ? <small>系统</small> : null}
                      {selectedKeySet.has(key) ? <Check size={14} aria-label="已选择" /> : null}
                    </button>
                  )
                })}
              </section>
            ) : null}

            {assets.length > 0 ? (
              <AssetLibraryGrid
                api={api}
                assets={assets}
                scope={scope}
                acceptKind={acceptKind}
                selectedKeys={selectedKeySet}
                dragEntries={selectedTargets}
                searching={isTrashView || Boolean(debouncedSearch)}
                allowDragAndAdd={!isTrashView}
                scrollElementRef={contentRef}
                layoutVersion={`${isTrashView}:${folders.length}:${debouncedSearch}`}
                onSelect={selectEntry}
                onAdd={addAssetToCanvas}
              />
            ) : null}

            {listingQuery.hasNextPage ? (
              <button
                type="button"
                className="cinema-asset-library-load-more cinema-library-secondary-button"
                disabled={listingQuery.isFetchingNextPage}
                onClick={() => void listingQuery.fetchNextPage()}
              >
                {listingQuery.isFetchingNextPage ? "正在加载…" : "加载更多"}
              </button>
            ) : null}
          </>
        )}
      </div>

      {migrationBlocksLibrary ? null : isTrashView ? (
        selectedEntries.length > 1 ? (
          <div className="cinema-asset-library-batch-bar" aria-label="回收站批量操作">
            <strong>已选择 {selectedEntries.length} 项</strong>
            <div>
              <button
                type="button"
                className="cinema-library-secondary-button"
                disabled={isReadOnly || restoreMutation.isPending}
                onClick={() => requestRestore(selectedTargets)}
              >
                <RotateCcw size={14} aria-hidden="true" />
                恢复
              </button>
              <button
                type="button"
                className="cinema-library-danger-button"
                disabled={isReadOnly || permanentDeleteMutation.isPending}
                onClick={() => requestPermanentDelete(selectedTargets)}
              >
                <Trash2 size={14} aria-hidden="true" />
                永久删除
              </button>
            </div>
          </div>
        ) : (
          <TrashEntryDetail
            api={api}
            entry={selectedEntries[0] ?? null}
            isReadOnly={isReadOnly}
            restorePending={restoreMutation.isPending}
            deletePending={permanentDeleteMutation.isPending}
            onRestore={(entry) => requestRestore([assetLibraryEntryRef(entry)])}
            onPermanentDelete={(entry) => requestPermanentDelete([assetLibraryEntryRef(entry)], [entry])}
          />
        )
      ) : selectedEntries.length > 1 ? (
        <div className="cinema-asset-library-batch-bar" aria-label="批量操作">
          <strong>已选择 {selectedEntries.length} 项</strong>
          <div>
            <button
              type="button"
              className="cinema-library-secondary-button"
              disabled={isReadOnly || moveMutation.isPending}
              onClick={() => setMoveEntries(selectedTargets)}
            >
              <Move size={14} aria-hidden="true" />
              移动到
            </button>
            <button
              type="button"
              className="cinema-library-danger-button"
              disabled={isReadOnly || trashMutation.isPending}
              onClick={() => requestTrash(selectedTargets)}
            >
              <Trash2 size={14} aria-hidden="true" />
              移入回收站
            </button>
          </div>
        </div>
      ) : selectedFolder ? (
        <FolderDetail
          folder={selectedFolder}
          isReadOnly={isReadOnly}
          onRename={(folder) => setRenameTarget({ entryType: "folder", folder })}
          onMove={(folder) => setMoveEntries([{ entryType: "folder", folderID: folder.id }])}
          onTrash={(folder) => requestTrash(
            [{ entryType: "folder", folderID: folder.id }],
            [{ entryType: "folder", folder }],
          )}
        />
      ) : (
        <AssetDetail
          api={api}
          asset={selectedAsset}
          scopeType={scopeType}
          mode={mode}
          acceptKind={acceptKind}
          isAdding={selectedAsset?.id === addingAssetID}
          isReadOnly={isReadOnly}
          onAdd={addAssetToCanvas}
          onRetry={(assetID) => void retryMutation.mutateAsync(assetID).catch(handleActionError)}
          onRename={(asset) => setRenameTarget({ entryType: "asset", asset })}
          onMove={(asset) => setMoveEntries([{ entryType: "asset", assetID: asset.id }])}
          onTrash={(asset) => requestTrash([{ entryType: "asset", assetID: asset.id }], [{ entryType: "asset", asset }])}
        />
      )}

      {actionError ? (
        <div className="cinema-asset-library-action-error" role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          <span>{actionError}</span>
          <button type="button" aria-label="关闭错误提示" title="关闭" onClick={() => setActionError(null)}>
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {undoEntries ? (
        <div className="cinema-asset-library-toast" role="status">
          <span>已移入回收站</span>
          <button
            type="button"
            disabled={restoreMutation.isPending}
            onClick={() => void restoreMutation.mutateAsync(undoEntries).catch(handleActionError)}
          >
            <RotateCcw size={13} aria-hidden="true" />
            撤销
          </button>
        </div>
      ) : null}

      {isCreateFolderOpen ? (
        <NameDialog
          title="新建文件夹"
          confirmLabel="创建"
          pending={createFolderMutation.isPending}
          maxLength={80}
          onClose={() => setIsCreateFolderOpen(false)}
          onSubmit={async (name) => {
            setActionError(null)
            try {
              await createFolderMutation.mutateAsync(name)
            } catch (error) {
              handleActionError(error)
              throw error
            }
          }}
        />
      ) : null}

      {renameTarget ? (
        <NameDialog
          key={assetLibraryEntryKey(renameTarget)}
          title={renameTarget.entryType === "folder" ? "重命名文件夹" : "重命名素材"}
          confirmLabel="保存"
          initialName={renameTarget.entryType === "folder"
            ? renameTarget.folder.name
            : assetRenameParts(renameTarget.asset).baseName}
          suffix={renameTarget.entryType === "asset"
            ? assetRenameParts(renameTarget.asset).extension
            : undefined}
          maxLength={renameTarget.entryType === "folder" ? 80 : 160}
          pending={renameFolderMutation.isPending || renameAssetMutation.isPending}
          onClose={() => setRenameTarget(null)}
          onSubmit={async (name) => {
            setActionError(null)
            try {
              if (renameTarget.entryType === "folder") {
                await renameFolderMutation.mutateAsync({ folderID: renameTarget.folder.id, name })
              } else {
                await renameAssetMutation.mutateAsync({ assetID: renameTarget.asset.id, baseName: name })
              }
            } catch (error) {
              handleActionError(error)
              throw error
            }
          }}
        />
      ) : null}

      {moveEntries ? (
        <FolderPickerDialog
          api={api}
          rootFolderID={rootFolderID}
          pending={moveMutation.isPending}
          onClose={() => setMoveEntries(null)}
          onChoose={(destinationFolderID) => {
            setActionError(null)
            void moveMutation.mutateAsync({ entries: moveEntries, destinationFolderID }).catch(handleActionError)
          }}
        />
      ) : null}

      {pendingPermanentDelete ? (
        <PermanentDeleteDialog
          entries={pendingPermanentDelete.entries}
          all={pendingPermanentDelete.all}
          totalCount={pendingPermanentDelete.totalCount}
          pending={permanentDeleteMutation.isPending}
          onClose={() => {
            if (!permanentDeleteMutation.isPending) setPendingPermanentDelete(null)
          }}
          onConfirm={async () => {
            try {
              await permanentDeleteMutation.mutateAsync({
                targets: pendingPermanentDelete.targets,
                all: pendingPermanentDelete.all,
              })
            } catch (error) {
              handleActionError(error)
              throw error
            }
          }}
        />
      ) : null}

      <span className="cinema-library-visually-hidden" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </aside>
  )
}

function AssetMigrationGuide({
  status,
  pending,
  onStart,
  onRefresh,
}: {
  status: CinemaAssetMigrationStatusResult
  pending: boolean
  onStart(): void
  onRefresh(): void
}) {
  const canContinue = status.phase === "running" && !pending
  const isRollingBack = status.phase === "rolling-back"
  const isRunning = pending || status.phase === "running" || isRollingBack
  const canStart = status.phase === "required" || status.phase === "ready"
  const needsRecovery = status.phase === "failed" || status.phase === "recovery-required"
  const title = needsRecovery
    ? "旧素材迁移需要处理"
    : isRollingBack
      ? "正在回滚旧素材迁移"
    : isRunning
      ? "正在迁移旧项目素材"
      : "需要整理旧项目素材"
  const detail = needsRecovery
    ? status.error ?? "迁移没有安全完成，请刷新状态后再继续。"
    : isRunning
      ? "素材正在登记并更新项目引用。Canvas 可以继续使用，请勿关闭应用。"
      : "开始后会先备份项目元数据，再把已识别素材纳入项目素材库。"

  return (
    <section
      className={`cinema-asset-library-migration ${needsRecovery ? "is-error" : ""}`}
      aria-labelledby="cinema-asset-library-migration-title"
      role={needsRecovery ? "alert" : undefined}
    >
      <div className="cinema-asset-library-migration-heading">
        {isRunning
          ? <Loader2 size={18} aria-hidden="true" className="is-spinning" />
          : <RotateCcw size={18} aria-hidden="true" />}
        <div>
          <strong id="cinema-asset-library-migration-title">{title}</strong>
          <span>{detail}</span>
        </div>
      </div>

      <dl className="cinema-asset-library-migration-stats" aria-label="待迁移素材统计">
        <div>
          <dt>已识别</dt>
          <dd>{status.candidateCount} 项</dd>
        </div>
        <div>
          <dt>总大小</dt>
          <dd>{formatAssetLibrarySize(status.totalBytes)}</dd>
        </div>
        <div>
          <dt>未识别</dt>
          <dd>{status.unrecognizedCount} 项</dd>
        </div>
      </dl>

      {!needsRecovery ? (
        <p>未识别或未选中的文件会保留在原位置，不会被删除。</p>
      ) : null}

      <div className="cinema-asset-library-migration-actions">
        {canStart || canContinue ? (
          <button
            type="button"
            className="cinema-library-primary-button"
            disabled={pending}
            onClick={onStart}
          >
            {pending ? <Loader2 size={14} aria-hidden="true" className="is-spinning" /> : null}
            {pending ? "正在迁移" : canContinue ? "继续迁移" : "开始迁移"}
          </button>
        ) : null}
        {isRunning || needsRecovery ? (
          <button
            type="button"
            className="cinema-library-secondary-button"
            disabled={pending}
            onClick={onRefresh}
          >
            刷新状态
          </button>
        ) : null}
      </div>
    </section>
  )
}

function AssetLibraryGrid({
  api,
  assets,
  scope,
  acceptKind,
  selectedKeys,
  dragEntries,
  searching,
  allowDragAndAdd,
  scrollElementRef,
  layoutVersion,
  onSelect,
  onAdd,
}: {
  api: AssetLibraryApi
  assets: CinemaAssetRecord[]
  scope: CinemaAssetScope
  acceptKind?: CinemaAssetKind
  selectedKeys: ReadonlySet<string>
  dragEntries: AssetLibraryEntryRef[]
  searching: boolean
  allowDragAndAdd: boolean
  scrollElementRef: RefObject<HTMLDivElement | null>
  layoutVersion: string
  onSelect(entry: AssetLibraryEntry, event: ReactMouseEvent<HTMLButtonElement>): void
  onAdd(asset: CinemaAssetRecord): void | Promise<void>
}) {
  const gridRef = useRef<HTMLElement>(null)
  const assetButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const pendingFocusIndexRef = useRef<number | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const shouldVirtualize = shouldVirtualizeAssetLibraryGrid(assets.length)
  const rowCount = assetLibraryGridRowCount(assets.length)
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? rowCount : 0,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => searching ? 162 : 146,
    overscan: 4,
    scrollMargin,
    getItemKey: (rowIndex) => assets[rowIndex * CINEMA_ASSET_LIBRARY_GRID_COLUMNS]?.id ?? rowIndex,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()

  useLayoutEffect(() => {
    const nextScrollMargin = gridRef.current?.offsetTop ?? 0
    setScrollMargin((current) => current === nextScrollMargin ? current : nextScrollMargin)
    if (shouldVirtualize) rowVirtualizer.measure()
  }, [assets.length, layoutVersion, searching, shouldVirtualize])

  useEffect(() => {
    const pendingIndex = pendingFocusIndexRef.current
    if (pendingIndex === null) return
    const element = assetButtonRefs.current[pendingIndex]
    if (!element) return
    pendingFocusIndexRef.current = null
    element.focus({ preventScroll: true })
  }, [virtualRows])

  const focusAssetAtIndex = useCallback((targetIndex: number) => {
    const nextIndex = Math.max(0, Math.min(assets.length - 1, targetIndex))
    if (!shouldVirtualize) {
      assetButtonRefs.current[nextIndex]?.focus({ preventScroll: false })
      return
    }
    pendingFocusIndexRef.current = nextIndex
    rowVirtualizer.scrollToIndex(
      Math.floor(nextIndex / CINEMA_ASSET_LIBRARY_GRID_COLUMNS),
      { align: "auto" },
    )
    window.requestAnimationFrame(() => {
      const element = assetButtonRefs.current[nextIndex]
      if (!element) return
      pendingFocusIndexRef.current = null
      element.focus({ preventScroll: true })
    })
  }, [assets.length, rowVirtualizer, shouldVirtualize])

  const renderAssetCard = (asset: CinemaAssetRecord, index: number) => {
    const entry: AssetLibraryEntry = { entryType: "asset", asset }
    const key = assetLibraryEntryKey(entry)
    const selected = selectedKeys.has(key)
    const kindAccepted = !acceptKind || asset.kind === acceptKind
    return (
      <button
        key={asset.id}
        ref={(element) => { assetButtonRefs.current[index] = element }}
        type="button"
        role="gridcell"
        className={`cinema-asset-library-card ${selected ? "is-selected" : ""} ${kindAccepted ? "" : "is-kind-mismatch"}`}
        aria-colindex={(index % CINEMA_ASSET_LIBRARY_GRID_COLUMNS) + 1}
        aria-rowindex={Math.floor(index / CINEMA_ASSET_LIBRARY_GRID_COLUMNS) + 1}
        aria-selected={selected}
        aria-disabled={!kindAccepted || undefined}
        title={`${asset.displayName}\n${assetLibraryEntryPath(entry)}${kindAccepted ? "" : "\n类型不匹配"}`}
        draggable={allowDragAndAdd}
        onClick={(event) => onSelect(entry, event)}
        onDoubleClick={() => {
          if (allowDragAndAdd) void onAdd(asset)
        }}
        onDragStart={(event) => {
          if (!allowDragAndAdd) {
            event.preventDefault()
            return
          }
          event.dataTransfer.effectAllowed = "copyMove"
          event.dataTransfer.setData(CINEMA_ASSET_LIBRARY_DRAG_TYPE, serializeAssetLibraryDragPayload({
            version: 1,
            scope,
            assetID: asset.id,
          }))
          event.dataTransfer.setData(CINEMA_ASSET_LIBRARY_ENTRY_DRAG_TYPE, serializeAssetLibraryEntryDragPayload({
            version: 1,
            scope,
            entries: selected && dragEntries.length > 0
              ? dragEntries
              : [{ entryType: "asset", assetID: asset.id }],
          }))
          event.dataTransfer.setData("text/plain", asset.displayName)
        }}
        onKeyDown={(event) => {
          const offsets: Record<string, number> = {
            ArrowLeft: -1,
            ArrowRight: 1,
            ArrowUp: -CINEMA_ASSET_LIBRARY_GRID_COLUMNS,
            ArrowDown: CINEMA_ASSET_LIBRARY_GRID_COLUMNS,
            Home: -index,
            End: assets.length - index - 1,
          }
          const offset = offsets[event.key]
          if (offset === undefined) return
          event.preventDefault()
          focusAssetAtIndex(index + offset)
        }}
      >
        <span className="cinema-asset-library-card-preview">
          {asset.kind === "image" ? (
            <img src={api.assetThumbnailURL(asset.id)} alt="" loading="lazy" draggable={false} />
          ) : asset.kind === "video" ? (
            <>
              <img src={api.assetThumbnailURL(asset.id)} alt="" loading="lazy" draggable={false} />
              <Video size={16} aria-hidden="true" className="cinema-asset-library-kind-icon" />
            </>
          ) : (
            <Music size={22} aria-hidden="true" />
          )}
          {asset.status !== "ready" ? (
            <span className={`cinema-asset-library-status is-${asset.status}`}>
              {assetStatusLabel(asset.status)}
            </span>
          ) : null}
          {selected ? <span className="cinema-asset-library-card-check"><Check size={12} aria-hidden="true" /></span> : null}
        </span>
        <span className="cinema-asset-library-card-name">{asset.displayName}</span>
        <small>{assetSummary(asset)}</small>
        {searching ? <small className="cinema-asset-library-card-path">{assetLibraryEntryPath(entry)}</small> : null}
      </button>
    )
  }

  if (!shouldVirtualize) {
    return (
      <section
        ref={gridRef}
        className="cinema-asset-library-assets"
        aria-label="素材"
        role="grid"
        aria-colcount={CINEMA_ASSET_LIBRARY_GRID_COLUMNS}
        aria-rowcount={rowCount}
      >
        {assets.map(renderAssetCard)}
      </section>
    )
  }

  return (
    <section
      ref={gridRef}
      className="cinema-asset-library-assets is-virtualized"
      aria-label="素材"
      role="grid"
      aria-colcount={CINEMA_ASSET_LIBRARY_GRID_COLUMNS}
      aria-rowcount={rowCount}
      style={{ height: rowVirtualizer.getTotalSize() }}
    >
      {virtualRows.map((virtualRow) => {
        const firstAssetIndex = virtualRow.index * CINEMA_ASSET_LIBRARY_GRID_COLUMNS
        return (
          <div
            key={virtualRow.key}
            ref={rowVirtualizer.measureElement}
            className="cinema-asset-library-virtual-row"
            role="row"
            data-index={virtualRow.index}
            style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
          >
            {assets
              .slice(firstAssetIndex, firstAssetIndex + CINEMA_ASSET_LIBRARY_GRID_COLUMNS)
              .map((asset, columnIndex) => renderAssetCard(asset, firstAssetIndex + columnIndex))}
          </div>
        )
      })}
    </section>
  )
}

function LibraryIconButton({
  label,
  disabled,
  pressed,
  badge,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  pressed?: boolean
  badge?: number
  onClick(): void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="cinema-asset-library-icon-button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      {badge !== undefined ? (
        <span className="cinema-asset-library-icon-badge" aria-hidden="true">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  )
}

function LibraryState({
  icon,
  label,
  detail,
  error = false,
  action,
}: {
  icon: ReactNode
  label: string
  detail?: string
  error?: boolean
  action?: ReactNode
}) {
  return (
    <div className={`cinema-asset-library-state ${error ? "is-error" : ""}`} role={error ? "alert" : "status"}>
      {icon}
      <strong>{label}</strong>
      {detail ? <span>{detail}</span> : null}
      {action}
    </div>
  )
}

function assetStatusLabel(status: CinemaAssetRecord["status"]): string {
  switch (status) {
    case "uploading": return "上传中"
    case "processing": return "处理中"
    case "failed": return "处理失败"
    case "missing": return "文件缺失"
    case "trashed": return "回收站"
    default: return "可用"
  }
}

function assetSummary(asset: CinemaAssetRecord): string {
  const dimensions = asset.width && asset.height ? `${asset.width}×${asset.height}` : ""
  const duration = formatAssetLibraryDuration(asset.durationSeconds)
  return [dimensions || duration, formatAssetLibrarySize(asset.sizeBytes)].filter(Boolean).join(" · ")
}

function AssetUploadQueue({
  items,
  onCancel,
  onRetry,
  onClear,
}: {
  items: AssetUploadQueueItem[]
  onCancel(itemID: string): void
  onRetry(itemID: string): void
  onClear(): void
}) {
  const hasSettled = items.some((item) => item.status === "succeeded" || item.status === "canceled")
  return (
    <section className="cinema-asset-upload-queue" aria-label="上传队列">
      <header>
        <strong>上传队列</strong>
        <span>{items.filter((item) => item.status === "uploading" || item.status === "queued").length} 项进行中</span>
        {hasSettled ? <button type="button" onClick={onClear}>清理已完成</button> : null}
      </header>
      <div>
        {items.map((item) => (
          <div key={item.id} className={`cinema-asset-upload-item is-${item.status}`}>
            <File size={14} aria-hidden="true" />
            <span title={item.file.name}>{item.file.name}</span>
            <small>{uploadStatusLabel(item)}</small>
            {item.status === "uploading" ? (
              <button type="button" aria-label={`取消上传 ${item.file.name}`} title="取消上传" onClick={() => onCancel(item.id)}>
                <X size={13} aria-hidden="true" />
              </button>
            ) : item.status === "failed" || item.status === "canceled" ? (
              <button type="button" aria-label={`重试上传 ${item.file.name}`} title="重试上传" onClick={() => onRetry(item.id)}>
                <RotateCcw size={13} aria-hidden="true" />
              </button>
            ) : <span aria-hidden="true" />}
            <progress value={item.progress} max={1} aria-label={`${item.file.name} 上传进度`} />
          </div>
        ))}
      </div>
    </section>
  )
}

function uploadStatusLabel(item: AssetUploadQueueItem): string {
  switch (item.status) {
    case "queued": return "等待中"
    case "uploading": return `${Math.round(item.progress * 100)}%`
    case "succeeded": return item.asset?.status === "processing" ? "处理中" : "已上传"
    case "canceled": return "已取消"
    case "failed": return item.error ?? "失败"
  }
}

function AssetDetail({
  api,
  asset,
  scopeType,
  mode,
  acceptKind,
  isAdding,
  isReadOnly,
  onAdd,
  onRetry,
  onRename,
  onMove,
  onTrash,
}: {
  api: AssetLibraryApi
  asset: CinemaAssetRecord | null
  scopeType: AssetLibraryScopeType
  mode: AssetLibraryPanelMode
  acceptKind?: CinemaAssetKind
  isAdding: boolean
  isReadOnly: boolean
  onAdd(asset: CinemaAssetRecord): void | Promise<void>
  onRetry(assetID: string): void
  onRename(asset: CinemaAssetRecord): void
  onMove(asset: CinemaAssetRecord): void
  onTrash(asset: CinemaAssetRecord): void
}) {
  if (!asset) {
    return (
      <section className="cinema-asset-library-detail is-empty" aria-label="素材详情">
        <Image size={18} aria-hidden="true" />
        <span>{mode === "relink" ? "选择素材以重新关联" : "选择素材以预览"}</span>
      </section>
    )
  }

  const metadata = [
    ["路径", asset.relativePath],
    ["来源", scopeType === "personal" ? "个人素材" : "项目素材"],
    ["类型", asset.kind === "image" ? "图片" : asset.kind === "video" ? "视频" : "音频"],
    ["尺寸", asset.width && asset.height ? `${asset.width} × ${asset.height}` : ""],
    ["时长", formatAssetLibraryDuration(asset.durationSeconds)],
    ["大小", formatAssetLibrarySize(asset.sizeBytes)],
    ["创建时间", formatAssetLibraryTimestamp(asset.createdAt)],
  ].filter((row): row is [string, string] => Boolean(row[1]))
  const kindAccepted = !acceptKind || asset.kind === acceptKind

  return (
    <section className="cinema-asset-library-detail" aria-label="素材详情">
      <div className="cinema-asset-library-detail-preview">
        {asset.status === "missing" ? (
          <div className="cinema-asset-library-detail-placeholder">
            <AlertCircle size={18} aria-hidden="true" />
            <span>引用文件不可用</span>
          </div>
        ) : asset.kind === "image" ? (
          <img src={api.assetPreviewURL(asset.id)} alt={asset.displayName} draggable={false} />
        ) : asset.kind === "video" ? (
          <video src={api.assetPreviewURL(asset.id)} controls preload="metadata" aria-label={asset.displayName} />
        ) : (
          <div className="cinema-asset-library-audio-preview">
            <Music size={20} aria-hidden="true" />
            <audio src={api.assetPreviewURL(asset.id)} controls preload="metadata" aria-label={asset.displayName} />
          </div>
        )}
      </div>
      <div className="cinema-asset-library-detail-heading">
        <strong title={asset.displayName}>{asset.displayName}</strong>
        <span>{kindAccepted ? assetStatusLabel(asset.status) : "类型不匹配"}</span>
      </div>
      <dl>
        {metadata.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd title={value}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="cinema-asset-library-detail-actions">
        {asset.status === "failed" ? (
          <button type="button" className="cinema-library-secondary-button is-main" disabled={isReadOnly} onClick={() => onRetry(asset.id)}>
            <RotateCcw size={14} aria-hidden="true" />
            重新处理
          </button>
        ) : (
          <button
            type="button"
            className="cinema-library-primary-button is-main"
            disabled={asset.status !== "ready" || isAdding || !kindAccepted}
            onClick={() => void onAdd(asset)}
          >
            {isAdding ? <Loader2 size={14} aria-hidden="true" className="is-spinning" /> : <Plus size={14} aria-hidden="true" />}
            {isAdding ? "正在处理" : mode === "relink" ? "重新关联" : "添加到画布"}
          </button>
        )}
        <DetailActionButton label={`重命名 ${asset.displayName}`} disabled={isReadOnly} onClick={() => onRename(asset)}>
          <PencilLine size={14} aria-hidden="true" />
        </DetailActionButton>
        <DetailActionButton label={`移动 ${asset.displayName}`} disabled={isReadOnly} onClick={() => onMove(asset)}>
          <Move size={14} aria-hidden="true" />
        </DetailActionButton>
        <DetailActionButton danger label={`将 ${asset.displayName} 移入回收站`} disabled={isReadOnly} onClick={() => onTrash(asset)}>
          <Trash2 size={14} aria-hidden="true" />
        </DetailActionButton>
      </div>
    </section>
  )
}

function TrashEntryDetail({
  api,
  entry,
  isReadOnly,
  restorePending,
  deletePending,
  onRestore,
  onPermanentDelete,
}: {
  api: AssetLibraryApi
  entry: AssetLibraryEntry | null
  isReadOnly: boolean
  restorePending: boolean
  deletePending: boolean
  onRestore(entry: AssetLibraryEntry): void
  onPermanentDelete(entry: AssetLibraryEntry): void
}) {
  if (!entry) {
    return (
      <section className="cinema-asset-library-detail is-empty" aria-label="回收站详情">
        <Trash2 size={18} aria-hidden="true" />
        <span>选择项目以恢复或永久删除</span>
      </section>
    )
  }

  const isFolder = entry.entryType === "folder"
  const name = assetLibraryEntryName(entry)
  const originalPath = assetLibraryEntryPath(entry)
  const trashedAt = isFolder ? entry.folder.trash?.trashedAt : entry.asset.trash?.trashedAt
  const metadata = [
    ["原路径", originalPath],
    ["类型", isFolder
      ? "文件夹"
      : entry.asset.kind === "image" ? "图片" : entry.asset.kind === "video" ? "视频" : "音频"],
    ["大小", isFolder ? "" : formatAssetLibrarySize(entry.asset.sizeBytes)],
    ["移入时间", formatAssetLibraryTimestamp(trashedAt)],
  ].filter((row): row is [string, string] => Boolean(row[1]))

  return (
    <section className={`cinema-asset-library-detail is-trash ${isFolder ? "is-folder" : ""}`} aria-label="回收站详情">
      <div className="cinema-asset-library-detail-preview">
        {isFolder ? (
          <Folder size={28} aria-hidden="true" />
        ) : entry.asset.kind === "image" ? (
          <img src={api.assetPreviewURL(entry.asset.id)} alt={entry.asset.displayName} draggable={false} />
        ) : entry.asset.kind === "video" ? (
          <video src={api.assetPreviewURL(entry.asset.id)} controls preload="metadata" aria-label={entry.asset.displayName} />
        ) : (
          <div className="cinema-asset-library-audio-preview">
            <Music size={20} aria-hidden="true" />
            <audio src={api.assetPreviewURL(entry.asset.id)} controls preload="metadata" aria-label={entry.asset.displayName} />
          </div>
        )}
      </div>
      <div className="cinema-asset-library-detail-heading">
        <strong title={name}>{name}</strong>
        <span>回收站</span>
      </div>
      <dl>
        {metadata.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd title={value}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="cinema-asset-library-detail-actions">
        <button
          type="button"
          className="cinema-library-secondary-button is-main"
          disabled={isReadOnly || restorePending || deletePending}
          onClick={() => onRestore(entry)}
        >
          {restorePending
            ? <Loader2 size={14} aria-hidden="true" className="is-spinning" />
            : <RotateCcw size={14} aria-hidden="true" />}
          {restorePending ? "正在恢复" : "恢复"}
        </button>
        <DetailActionButton
          danger
          label={`永久删除 ${name}`}
          disabled={isReadOnly || restorePending || deletePending}
          onClick={() => onPermanentDelete(entry)}
        >
          <Trash2 size={14} aria-hidden="true" />
        </DetailActionButton>
      </div>
    </section>
  )
}

function FolderDetail({
  folder,
  isReadOnly,
  onRename,
  onMove,
  onTrash,
}: {
  folder: Extract<AssetLibraryEntry, { entryType: "folder" }>["folder"]
  isReadOnly: boolean
  onRename(folder: Extract<AssetLibraryEntry, { entryType: "folder" }>["folder"]): void
  onMove(folder: Extract<AssetLibraryEntry, { entryType: "folder" }>["folder"]): void
  onTrash(folder: Extract<AssetLibraryEntry, { entryType: "folder" }>["folder"]): void
}) {
  const actionsDisabled = isReadOnly || folder.system
  return (
    <section className="cinema-asset-library-detail is-folder" aria-label="文件夹详情">
      <div className="cinema-asset-library-detail-preview">
        <Folder size={28} aria-hidden="true" />
      </div>
      <div className="cinema-asset-library-detail-heading">
        <strong title={folder.name}>{folder.name}</strong>
        <span>{folder.system ? "系统目录" : "文件夹"}</span>
      </div>
      <dl>
        <div>
          <dt>路径</dt>
          <dd title={folder.relativePath}>{folder.relativePath || "素材库"}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{formatAssetLibraryTimestamp(folder.createdAt)}</dd>
        </div>
      </dl>
      <div className="cinema-asset-library-detail-actions">
        <button type="button" className="cinema-library-secondary-button is-main" disabled={actionsDisabled} onClick={() => onRename(folder)}>
          <PencilLine size={14} aria-hidden="true" />
          重命名
        </button>
        <DetailActionButton label={`移动文件夹 ${folder.name}`} disabled={actionsDisabled} onClick={() => onMove(folder)}>
          <Move size={14} aria-hidden="true" />
        </DetailActionButton>
        <DetailActionButton danger label={`将文件夹 ${folder.name} 移入回收站`} disabled={actionsDisabled} onClick={() => onTrash(folder)}>
          <Trash2 size={14} aria-hidden="true" />
        </DetailActionButton>
      </div>
    </section>
  )
}

function DetailActionButton({
  label,
  disabled,
  danger = false,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  danger?: boolean
  onClick(): void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`cinema-asset-library-detail-action ${danger ? "is-danger" : ""}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function PermanentDeleteDialog({
  entries,
  all,
  totalCount,
  pending,
  onClose,
  onConfirm,
}: {
  entries: AssetLibraryEntry[]
  all: boolean
  totalCount?: number
  pending: boolean
  onClose(): void
  onConfirm(): Promise<void>
}) {
  const [stage, setStage] = useState<1 | 2>(1)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const summary = useMemo(() => summarizeAssetLibrarySelection(entries), [entries])
  const affectedCount = all ? totalCount ?? 0 : summary.count

  useEffect(() => dialogRef.current?.focus(), [stage])

  const submit = async () => {
    if (stage === 1) {
      setStage(2)
      setError(null)
      return
    }
    setError(null)
    try {
      await onConfirm()
    } catch (confirmError) {
      setError(errorMessage(confirmError, "永久删除失败"))
    }
  }

  return (
    <div className="cinema-asset-library-dialog-backdrop" onMouseDown={(event) => {
      if (!pending && event.target === event.currentTarget) onClose()
    }}>
      <section
        ref={dialogRef}
        className="cinema-asset-library-dialog cinema-asset-library-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cinema-asset-library-delete-dialog-title"
        aria-describedby="cinema-asset-library-delete-dialog-description"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending) {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <header>
          <strong id="cinema-asset-library-delete-dialog-title">
            {stage === 1
              ? all ? "清空回收站" : "永久删除"
              : all ? "再次确认清空回收站" : "再次确认永久删除"}
          </strong>
          <LibraryIconButton label="关闭" disabled={pending} onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </LibraryIconButton>
        </header>
        <div id="cinema-asset-library-delete-dialog-description" className="cinema-asset-library-delete-dialog-copy">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>
              {all
                ? `清空回收站中的全部 ${affectedCount} 项`
                : `${summary.count} 项（${summary.folderCount} 个文件夹，${summary.assetCount} 个素材）`}
            </strong>
            <span>
              {!all && summary.knownSizeBytes > 0 ? `已知素材大小 ${formatAssetLibrarySize(summary.knownSizeBytes)}。` : ""}
              {stage === 1
                ? "永久删除后无法恢复。"
                : all
                  ? "这是最后一次确认。系统会检查整个回收站；任一素材仍被引用时，本次清空不会删除任何内容。"
                  : "这是最后一次确认。被 Canvas 或生成任务引用的素材会由服务端拒绝删除。"}
            </span>
          </div>
        </div>
        {error ? (
          <p className="cinema-asset-library-delete-dialog-error" role="alert">
            <AlertCircle size={14} aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
        <footer>
          <button type="button" className="cinema-library-secondary-button" disabled={pending} onClick={onClose}>
            取消
          </button>
          <button type="button" className="cinema-library-danger-button" disabled={pending} onClick={() => void submit()}>
            {pending ? <Loader2 size={14} aria-hidden="true" className="is-spinning" /> : <Trash2 size={14} aria-hidden="true" />}
            {pending ? "正在删除" : stage === 1 ? "继续" : all ? "确认清空回收站" : "确认永久删除"}
          </button>
        </footer>
      </section>
    </div>
  )
}

function NameDialog({
  title,
  confirmLabel,
  initialName = "",
  suffix,
  maxLength,
  pending,
  onClose,
  onSubmit,
}: {
  title: string
  confirmLabel: string
  initialName?: string
  suffix?: string
  maxLength: number
  pending: boolean
  onClose(): void
  onSubmit(name: string): Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalized = name.normalize("NFC").trim()
    if (!normalized) {
      setError("请输入名称")
      return
    }
    setError(null)
    try {
      await onSubmit(normalized)
    } catch (submitError) {
      setError(errorMessage(submitError))
    }
  }

  return (
    <div className="cinema-asset-library-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <form
        className="cinema-asset-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cinema-asset-library-name-dialog-title"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <header>
          <strong id="cinema-asset-library-name-dialog-title">{title}</strong>
          <LibraryIconButton label="关闭" onClick={onClose}><X size={14} aria-hidden="true" /></LibraryIconButton>
        </header>
        <label>
          <span>名称</span>
          <span className="cinema-asset-library-name-input">
            <input ref={inputRef} value={name} maxLength={maxLength} onChange={(event) => setName(event.target.value)} />
            {suffix ? <span aria-label={`扩展名 ${suffix}`}>{suffix}</span> : null}
          </span>
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <footer>
          <button type="button" className="cinema-library-secondary-button" onClick={onClose}>取消</button>
          <button type="submit" className="cinema-library-primary-button" disabled={pending || !name.trim()}>
            {pending ? `${confirmLabel}中…` : confirmLabel}
          </button>
        </footer>
      </form>
    </div>
  )
}

function FolderPickerDialog({
  api,
  rootFolderID,
  pending,
  onClose,
  onChoose,
}: {
  api: AssetLibraryApi
  rootFolderID: string
  pending: boolean
  onClose(): void
  onChoose(folderID: string): void
}) {
  const [folderID, setFolderID] = useState(rootFolderID)
  const dialogRef = useRef<HTMLElement>(null)
  const folderQuery = useQuery({
    queryKey: ["cinema-asset-library-folder-picker", api.scopeKey, folderID],
    queryFn: ({ signal }) => api.listEntries({ folderID, limit: 100, signal }),
  })
  const folders = folderQuery.data?.entries.filter((entry) => entry.entryType === "folder") ?? []

  useEffect(() => dialogRef.current?.focus(), [])

  return (
    <div className="cinema-asset-library-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        ref={dialogRef}
        className="cinema-asset-library-dialog cinema-asset-library-folder-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cinema-asset-library-folder-picker-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <header>
          <strong id="cinema-asset-library-folder-picker-title">移动到文件夹</strong>
          <LibraryIconButton label="关闭" onClick={onClose}><X size={14} aria-hidden="true" /></LibraryIconButton>
        </header>
        <nav className="cinema-asset-library-breadcrumbs" aria-label="目标文件夹路径">
          <button type="button" onClick={() => setFolderID(rootFolderID)}>素材库</button>
          {folderQuery.data?.breadcrumbs.filter((folder) => folder.id !== rootFolderID).map((folder) => (
            <button key={folder.id} type="button" onClick={() => setFolderID(folder.id)}>{folder.name}</button>
          ))}
        </nav>
        <div className="cinema-asset-library-folder-picker-list" aria-busy={folderQuery.isLoading}>
          {folderQuery.isLoading ? (
            <LibraryState icon={<Loader2 size={16} aria-hidden="true" className="is-spinning" />} label="正在加载文件夹" />
          ) : folderQuery.error ? (
            <LibraryState error icon={<AlertCircle size={16} aria-hidden="true" />} label={errorMessage(folderQuery.error)} />
          ) : folders.length === 0 ? (
            <LibraryState icon={<Folder size={16} aria-hidden="true" />} label="没有子文件夹" />
          ) : folders.map((entry) => entry.entryType === "folder" ? (
            <button key={entry.folder.id} type="button" onClick={() => setFolderID(entry.folder.id)}>
              <Folder size={14} aria-hidden="true" />
              <span>{entry.folder.name}</span>
            </button>
          ) : null)}
        </div>
        <footer>
          <button type="button" className="cinema-library-secondary-button" onClick={onClose}>取消</button>
          <button type="button" className="cinema-library-primary-button" disabled={pending} onClick={() => onChoose(folderID)}>
            {pending ? "正在移动" : "移动到这里"}
          </button>
        </footer>
      </section>
    </div>
  )
}
