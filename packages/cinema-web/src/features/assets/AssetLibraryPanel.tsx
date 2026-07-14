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
import { createPortal } from "react-dom"
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
  CinemaAssetLocator,
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
import { clampContextMenuPosition } from "../canvas/contextMenuPosition"
import { useAssetUploadQueue, type AssetUploadQueueItem } from "./useAssetUploadQueue"
import "./asset-library.css"

const PANEL_ID = "cinema-asset-library"
const ROOT_FOLDER_ID = "root"

export interface AssetLibraryAddRequest {
  scope: CinemaAssetScope
  asset: CinemaAssetRecord
}

export interface AssetLibraryRevealRequest {
  requestID: string
  assetRef: CinemaAssetLocator
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
  revealRequest?: AssetLibraryRevealRequest | null
  onRevealRequestHandled?(requestID: string): void
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

interface PendingAssetReveal {
  requestID: string
  scopeType: AssetLibraryScopeType
  assetID: string
  displayName: string
}

interface AssetGridRevealRequest {
  requestID: string
  assetID: string
}

interface PendingDeleteConfirmation {
  targets: AssetLibraryEntryRef[]
  entries: AssetLibraryEntry[]
}

interface PendingDeleteToast {
  operationID: string
  finalizeOperationID: string
  undoOperationID: string
  scope: CinemaAssetScope
  scopeKey: string
  baseRevision: number
  targets: AssetLibraryEntryRef[]
  count: number
  undoUntil: string
}

interface PendingUploadDestination {
  files: File[] | null
  initialFolderID: string
}

interface AssetLibraryContextMenuState {
  x: number
  y: number
  entries: AssetLibraryEntry[]
  targets: AssetLibraryEntryRef[]
  returnFocus: HTMLElement | null
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

function assetLibraryErrorMessage(error: unknown, fallback = "操作失败"): string {
  if (error instanceof AssetLibraryApiError && error.code === "CINEMA_LIBRARY_ASSET_REFERENCED") {
    return "仍被画布、时间线或任务引用，无法删除"
  }
  return errorMessage(error, fallback)
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
  revealRequest,
  onRevealRequestHandled,
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
  const [createFolderParentID, setCreateFolderParentID] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<AssetLibraryEntry | null>(null)
  const [moveEntries, setMoveEntries] = useState<AssetLibraryEntryRef[] | null>(null)
  const [pendingDeleteConfirmation, setPendingDeleteConfirmation] = useState<PendingDeleteConfirmation | null>(null)
  const [pendingDeletes, setPendingDeletes] = useState<PendingDeleteToast[]>([])
  const [pendingDeleteActionIDs, setPendingDeleteActionIDs] = useState<Set<string>>(() => new Set())
  const pendingDeleteActionIDsRef = useRef(new Set<string>())
  const [pendingUploadDestination, setPendingUploadDestination] = useState<PendingUploadDestination | null>(null)
  const uploadTargetFolderIDRef = useRef<string | null>(null)
  const [contextMenu, setContextMenu] = useState<AssetLibraryContextMenuState | null>(null)
  const [addingAssetID, setAddingAssetID] = useState<string | null>(null)
  const [pendingAssetReveal, setPendingAssetReveal] = useState<PendingAssetReveal | null>(null)
  const [gridRevealRequest, setGridRevealRequest] = useState<AssetGridRevealRequest | null>(null)
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
  const isSearching = Boolean(currentSession.search.trim())
  const libraryQueryPrefix = useMemo(
    () => ["cinema-asset-library", agentBaseURL, scopeKey] as const,
    [agentBaseURL, scopeKey],
  )
  const scrollPositionKey = useMemo(() => assetLibraryScrollPositionKey({
    folderID: currentSession.folderID,
    query: debouncedSearch,
  }), [currentSession.folderID, debouncedSearch])

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
    setActionError(null)
    setAnnouncement("")
    setCreateFolderParentID(null)
    setRenameTarget(null)
    setMoveEntries(null)
    setPendingDeleteConfirmation(null)
    setPendingDeletes([])
    setPendingUploadDestination(null)
    setContextMenu(null)
    setAddingAssetID(null)
    setPendingAssetReveal(null)
    setGridRevealRequest(null)
  }, [initialScope, projectID])

  useEffect(() => {
    const request = revealRequest
    if (!request) return
    setPendingAssetReveal(null)
    setGridRevealRequest(null)
    setActionError(null)
    setAnnouncement("正在定位素材")

    if (request.assetRef.scope.type === "project" && request.assetRef.scope.projectID !== projectID) {
      setActionError("无法定位不属于当前项目的素材")
      setAnnouncement("")
      onRevealRequestHandled?.(request.requestID)
      return
    }

    const controller = new AbortController()
    let active = true
    const targetApi = createAssetLibraryApi(agentBaseURL, projectID, request.assetRef.scope)
    void targetApi.getAsset(request.assetRef.assetID, controller.signal).then(({ asset }) => {
      if (!active) return
      const targetScopeType = request.assetRef.scope.type
      if (asset.status === "trashed") {
        setActionError("素材正在删除，当前无法在素材库中定位")
        setAnnouncement("")
        onRevealRequestHandled?.(request.requestID)
        return
      }
      const folderID = asset.folderID
      const selectedKey = `asset:${asset.id}`
      const targetScrollKey = assetLibraryScrollPositionKey({ folderID, query: "" })
      scrollTopRef.current[targetScopeType][targetScrollKey] = 0
      setScopeSessions((current) => ({
        ...current,
        [targetScopeType]: {
          ...current[targetScopeType],
          folderID,
          search: "",
          selectedKeys: [selectedKey],
          anchorKey: selectedKey,
        },
      }))
      setScopeType(targetScopeType)
      setPendingAssetReveal({
        requestID: request.requestID,
        scopeType: targetScopeType,
        assetID: asset.id,
        displayName: asset.displayName,
      })
      setAnnouncement(`正在定位 ${asset.displayName}`)
      void queryClient.invalidateQueries({
        queryKey: ["cinema-asset-library", agentBaseURL, assetLibraryScopeKey(request.assetRef.scope), "entries"],
      })
      onRevealRequestHandled?.(request.requestID)
    }).catch((error) => {
      if (!active) return
      setActionError(errorMessage(error, "无法定位素材"))
      setAnnouncement("")
      onRevealRequestHandled?.(request.requestID)
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [agentBaseURL, onRevealRequestHandled, projectID, queryClient, revealRequest?.requestID])

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
      currentSession.folderID,
      debouncedSearch,
    ],
    queryFn: ({ pageParam, signal }) => api.listEntries({
      folderID: currentSession.folderID,
      query: debouncedSearch,
      cursor: typeof pageParam === "string" ? pageParam : undefined,
      limit: 50,
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

  useEffect(() => {
    const target = pendingAssetReveal
    if (!target || target.scopeType !== scopeType) return
    if (assets.some((asset) => asset.id === target.assetID)) {
      setGridRevealRequest({ requestID: target.requestID, assetID: target.assetID })
      setPendingAssetReveal(null)
      setAnnouncement(`${target.displayName} 已在素材库中选中`)
      return
    }
    if (!listingQuery.isSuccess || listingQuery.isLoading || listingQuery.isFetchingNextPage) return
    if (listingQuery.hasNextPage) {
      void listingQuery.fetchNextPage().catch((error) => {
        setPendingAssetReveal(null)
        setActionError(errorMessage(error, "无法加载素材所在位置"))
        setAnnouncement("")
      })
      return
    }
    setPendingAssetReveal(null)
    setActionError("已打开素材所在文件夹，但未找到该素材")
    setAnnouncement("")
  }, [assets, listingQuery, pendingAssetReveal, scopeType])

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

  const refreshLibrary = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: libraryQueryPrefix }),
      queryClient.invalidateQueries({ queryKey: ["cinema-canvas-asset-state"] }),
    ])
  }, [libraryQueryPrefix, queryClient])

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
    setActionError(assetLibraryErrorMessage(error))
    if (error instanceof AssetLibraryApiError && error.status === 409) void refreshLibrary()
  }, [commitRevision, refreshLibrary])

  const createFolderMutation = useMutation({
    mutationFn: ({ name, parentFolderID }: { name: string; parentFolderID: string }) => api.createFolder({
      name,
      parentFolderID,
      operationID: createOperationID("create-folder"),
      baseRevision: revisionRef.current,
    }),
    onSuccess: (result) => {
      commitRevision(result.revision)
      setCreateFolderParentID(null)
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

  const beginDeleteMutation = useMutation({
    mutationFn: ({
      targets,
      deleteApi,
      baseRevision,
    }: {
      targets: AssetLibraryEntryRef[]
      entries: AssetLibraryEntry[]
      deleteApi: AssetLibraryApi
      deleteScope: CinemaAssetScope
      deleteScopeKey: string
      baseRevision: number
    }) => deleteApi.beginDelete({
      entries: targets,
      operationID: createOperationID("delete-assets"),
      baseRevision,
    }),
    onSuccess: (result, request) => {
      if (request.deleteScopeKey === api.scopeKey) commitRevision(result.revision)
      setScopeSessions((current) => ({
        ...current,
        [request.deleteScope.type]: {
          ...current[request.deleteScope.type],
          selectedKeys: [],
          anchorKey: null,
        },
      }))
      setPendingDeleteConfirmation(null)
      setPendingDeletes((current) => [...current, {
        operationID: result.operationID,
        finalizeOperationID: createOperationID("finalize-delete"),
        undoOperationID: createOperationID("undo-delete"),
        scope: request.deleteScope,
        scopeKey: request.deleteScopeKey,
        baseRevision: result.revision,
        targets: request.targets,
        count: request.entries.length,
        undoUntil: result.undoUntil,
      }])
      setAnnouncement(`已删除 ${request.entries.length} 项，可在 10 秒内撤销`)
      void queryClient.invalidateQueries({
        queryKey: ["cinema-asset-library", agentBaseURL, request.deleteScopeKey],
      })
    },
  })

  const runWithRevisionRetry = useCallback(async <T,>(
    baseRevision: number,
    request: (revision: number) => Promise<T>,
  ) => {
    try {
      return await request(baseRevision)
    } catch (error) {
      if (!(error instanceof AssetLibraryApiError) || error.latestRevision === undefined) throw error
      return await request(error.latestRevision)
    }
  }, [])

  const setPendingDeleteAction = useCallback((operationID: string, pending: boolean) => {
    if (pending) pendingDeleteActionIDsRef.current.add(operationID)
    else pendingDeleteActionIDsRef.current.delete(operationID)
    setPendingDeleteActionIDs(new Set(pendingDeleteActionIDsRef.current))
  }, [])

  const finalizePendingDelete = useCallback(async (pendingDelete: PendingDeleteToast) => {
    if (pendingDeleteActionIDsRef.current.has(pendingDelete.operationID)) return
    setPendingDeleteAction(pendingDelete.operationID, true)
    try {
      const pendingApi = createAssetLibraryApi(agentBaseURL, projectID, pendingDelete.scope)
      const result = await runWithRevisionRetry(pendingDelete.baseRevision, (baseRevision) => pendingApi.finalizeDelete({
        entries: pendingDelete.targets,
        operationID: pendingDelete.finalizeOperationID,
        baseRevision,
      }))
      if (pendingDelete.scopeKey === api.scopeKey) commitRevision(result.revision)
      setPendingDeletes((current) => current.filter((item) => item.operationID !== pendingDelete.operationID))
      if (result.warnings.length > 0) setActionError(result.warnings.join(" "))
      await queryClient.invalidateQueries({
        queryKey: ["cinema-asset-library", agentBaseURL, pendingDelete.scopeKey],
      })
    } catch (error) {
      if (error instanceof AssetLibraryApiError && error.code === "CINEMA_LIBRARY_DELETE_UNDO_ACTIVE") {
        setPendingDeletes((current) => current.map((item) => item.operationID === pendingDelete.operationID
          ? { ...item, undoUntil: new Date(Date.now() + 500).toISOString() }
          : item))
        return
      }
      setPendingDeletes((current) => current.filter((item) => item.operationID !== pendingDelete.operationID))
      handleActionError(error)
    } finally {
      setPendingDeleteAction(pendingDelete.operationID, false)
    }
  }, [agentBaseURL, api.scopeKey, commitRevision, handleActionError, projectID, queryClient, runWithRevisionRetry, setPendingDeleteAction])

  const undoPendingDelete = useCallback(async (pendingDelete: PendingDeleteToast) => {
    if (pendingDeleteActionIDsRef.current.has(pendingDelete.operationID)) return
    setPendingDeleteAction(pendingDelete.operationID, true)
    try {
      const pendingApi = createAssetLibraryApi(agentBaseURL, projectID, pendingDelete.scope)
      const result = await runWithRevisionRetry(pendingDelete.baseRevision, (baseRevision) => pendingApi.undoDelete({
        entries: pendingDelete.targets,
        operationID: pendingDelete.undoOperationID,
        baseRevision,
      }))
      if (pendingDelete.scopeKey === api.scopeKey) commitRevision(result.revision)
      setPendingDeletes((current) => current.filter((item) => item.operationID !== pendingDelete.operationID))
      setAnnouncement(`已撤销删除 ${pendingDelete.count} 项`)
      await queryClient.invalidateQueries({
        queryKey: ["cinema-asset-library", agentBaseURL, pendingDelete.scopeKey],
      })
    } catch (error) {
      handleActionError(error)
    } finally {
      setPendingDeleteAction(pendingDelete.operationID, false)
    }
  }, [agentBaseURL, api.scopeKey, commitRevision, handleActionError, projectID, queryClient, runWithRevisionRetry, setPendingDeleteAction])

  useEffect(() => {
    const timers = pendingDeletes.map((pendingDelete) => window.setTimeout(
      () => void finalizePendingDelete(pendingDelete),
      Math.max(0, Date.parse(pendingDelete.undoUntil) - Date.now()),
    ))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [finalizePendingDelete, pendingDeletes])

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

  const rootFolderID = stateQuery.data?.rootFolderID ?? ROOT_FOLDER_ID

  const goUp = useCallback(() => {
    const rootFolderID = stateQuery.data?.rootFolderID ?? ROOT_FOLDER_ID
    if (currentSession.folderID === rootFolderID) return
    openFolder(listing?.folder?.parentID ?? rootFolderID)
  }, [currentSession.folderID, listing?.folder?.parentID, openFolder, stateQuery.data?.rootFolderID])

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
    setCreateFolderParentID(null)
    setPendingDeleteConfirmation(null)
    setPendingUploadDestination(null)
    setContextMenu(null)
  }, [scopeType])

  const selectEntry = useCallback((
    entry: AssetLibraryEntry,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    const key = assetLibraryEntryKey(entry)
    if (entry.entryType === "folder" && (entry.folder.system || (!event.metaKey && !event.ctrlKey && !event.shiftKey))) {
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
  }, [currentSession.anchorKey, openFolder, orderedKeys, selectedKeySet, updateCurrentSession])

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

  const requestDelete = useCallback((targets: AssetLibraryEntryRef[], sourceEntries = selectedEntries) => {
    if (targets.length === 0 || isReadOnly) return
    const requiresConfirmation = targets.length > 1 || sourceEntries.some((entry) => entry.entryType === "folder")
    setActionError(null)
    if (requiresConfirmation) {
      setPendingDeleteConfirmation({ targets, entries: sourceEntries })
      return
    }
    void beginDeleteMutation.mutateAsync({
      targets,
      entries: sourceEntries,
      deleteApi: api,
      deleteScope: scope,
      deleteScopeKey: scopeKey,
      baseRevision: revisionRef.current,
    }).catch(handleActionError)
  }, [api, beginDeleteMutation, handleActionError, isReadOnly, scope, scopeKey, selectedEntries])

  const handleFiles = useCallback((files: Iterable<File>, folderID: string) => {
    if (isReadOnly) return
    const list = Array.from(files)
    if (list.length === 0) return
    uploadQueue.enqueue(list, folderID)
    setAnnouncement(`已加入 ${list.length} 个上传任务`)
  }, [isReadOnly, uploadQueue])

  const requestUpload = useCallback((folderID?: string) => {
    if (isReadOnly) return
    if (folderID) {
      uploadTargetFolderIDRef.current = folderID
      uploadInputRef.current?.click()
      return
    }
    if (!isSearching && currentSession.folderID !== rootFolderID) {
      uploadTargetFolderIDRef.current = currentSession.folderID
      uploadInputRef.current?.click()
      return
    }
    setPendingUploadDestination({ files: null, initialFolderID: currentSession.folderID })
  }, [currentSession.folderID, isReadOnly, isSearching, rootFolderID])

  const handlePanelDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    event.stopPropagation()
    const hasDirectory = Array.from(event.dataTransfer.items).some((item) => {
      const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }).webkitGetAsEntry?.()
      return entry?.isDirectory === true
    })
    if (hasDirectory) {
      setActionError("暂不支持导入整个文件夹，请选择文件")
      return
    }
    const files = Array.from(event.dataTransfer.files)
    if (!isSearching && currentSession.folderID !== rootFolderID) {
      handleFiles(files, currentSession.folderID)
    } else {
      setPendingUploadDestination({ files, initialFolderID: currentSession.folderID })
    }
  }, [currentSession.folderID, handleFiles, isSearching, rootFolderID])

  const moveEntriesToFolder = useCallback((targets: AssetLibraryEntryRef[], destinationFolderID: string) => {
    if (isReadOnly || targets.length === 0) return
    setActionError(null)
    void moveMutation.mutateAsync({ entries: targets, destinationFolderID }).catch(handleActionError)
  }, [handleActionError, isReadOnly, moveMutation])

  const closeContextMenu = useCallback((restoreFocus = true) => {
    setContextMenu((current) => {
      if (restoreFocus) window.requestAnimationFrame(() => current?.returnFocus?.focus({ preventScroll: true }))
      return null
    })
  }, [])

  const openEntryContextMenuAt = useCallback((
    entry: AssetLibraryEntry,
    x: number,
    y: number,
    returnFocus: HTMLElement | null,
  ) => {
    const key = assetLibraryEntryKey(entry)
    const preserveSelection = selectedKeySet.has(key) && selectedEntries.length > 0
    const menuEntries = preserveSelection ? selectedEntries : [entry]
    const menuTargets = menuEntries
      .filter((candidate) => candidate.entryType === "asset" || !candidate.folder.system)
      .map(assetLibraryEntryRef)
    if (!preserveSelection) updateCurrentSession({ selectedKeys: [key], anchorKey: key })
    setContextMenu({
      x,
      y,
      entries: menuEntries,
      targets: menuTargets,
      returnFocus,
    })
  }, [selectedEntries, selectedKeySet, updateCurrentSession])

  const openEntryContextMenu = useCallback((entry: AssetLibraryEntry, event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    openEntryContextMenuAt(entry, event.clientX, event.clientY, event.currentTarget)
  }, [openEntryContextMenuAt])

  const openBackgroundContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest(".cinema-asset-library-folder-row, .cinema-asset-library-card, input, textarea, [contenteditable='true']")) return
    event.preventDefault()
    event.stopPropagation()
    updateCurrentSession({ selectedKeys: [], anchorKey: null })
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      entries: [],
      targets: [],
      returnFocus: event.currentTarget,
    })
  }, [updateCurrentSession])

  const handlePanelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      if (moveEntries || renameTarget || createFolderParentID || pendingDeleteConfirmation || pendingUploadDestination || contextMenu) return
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
    if (event.key === "Backspace" || (event.altKey && event.key === "ArrowLeft")) {
      event.preventDefault()
      goUp()
    }
  }, [contextMenu, createFolderParentID, entries, goUp, moveEntries, onClose, pendingDeleteConfirmation, pendingUploadDestination, renameTarget, updateCurrentSession])

  const queryError = stateQuery.error ?? migrationQuery.error ?? listingQuery.error
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
          <strong>素材库</strong>
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
              const folderID = uploadTargetFolderIDRef.current
              if (event.target.files && folderID) handleFiles(event.target.files, folderID)
              uploadTargetFolderIDRef.current = null
              event.target.value = ""
            }}
          />
          <LibraryIconButton
            label="上传素材"
            disabled={isReadOnly || stateQuery.isLoading}
            onClick={() => requestUpload()}
          >
            <Upload size={15} aria-hidden="true" />
          </LibraryIconButton>
          <LibraryIconButton
            label="刷新素材库"
            disabled={stateQuery.isLoading || migrationBlocksLibrary || reconcileMutation.isPending}
            onClick={() => {
              setActionError(null)
              void reconcileMutation.mutateAsync().catch(handleActionError)
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

      <label className="cinema-asset-library-search">
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
      </label>

      <nav className="cinema-asset-library-breadcrumbs" aria-label="素材文件夹路径">
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
      </nav>

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

      {uploadQueue.items.length > 0 ? (
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
        className="cinema-asset-library-content"
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`cinema-asset-library-tab-${scopeType}`}
        aria-busy={stateQuery.isLoading || migrationQuery.isLoading || listingQuery.isLoading || migrationMutation.isPending}
        onScroll={(event) => {
          scrollTopRef.current[scopeType][scrollPositionKey] = event.currentTarget.scrollTop
          if (contextMenu) closeContextMenu(false)
        }}
        onContextMenu={openBackgroundContextMenu}
        onKeyDown={(event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
          if (event.target !== event.currentTarget) return
          event.preventDefault()
          event.stopPropagation()
          const bounds = event.currentTarget.getBoundingClientRect()
          updateCurrentSession({ selectedKeys: [], anchorKey: null })
          setContextMenu({ x: bounds.left + 16, y: bounds.top + 16, entries: [], targets: [], returnFocus: event.currentTarget })
        }}
      >
        {stateQuery.isLoading || (scopeType === "project" && migrationQuery.isLoading) || listingQuery.isLoading ? (
          <LibraryState
            icon={<Loader2 size={18} aria-hidden="true" className="is-spinning" />}
            label={scopeType === "project" && migrationQuery.isLoading
              ? "正在检查旧项目素材"
              : "正在加载素材库"}
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
            icon={debouncedSearch ? <Search size={18} aria-hidden="true" /> : <Folder size={18} aria-hidden="true" />}
            label={debouncedSearch ? "没有匹配的素材" : "此文件夹为空"}
            detail={debouncedSearch ? "尝试其他关键词" : "上传图片、视频或音频开始使用"}
            action={!debouncedSearch && !isReadOnly
              ? <button type="button" className="cinema-library-secondary-button" onClick={() => requestUpload()}>上传素材</button>
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
                      draggable={!entry.folder.system && !isReadOnly}
                      onClick={(event) => selectEntry(entry, event)}
                      onContextMenu={(event) => openEntryContextMenu(entry, event)}
                      onKeyDown={(event) => {
                        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
                        event.preventDefault()
                        event.stopPropagation()
                        const bounds = event.currentTarget.getBoundingClientRect()
                        openEntryContextMenuAt(entry, bounds.left + 16, bounds.top + 16, event.currentTarget)
                      }}
                      onDragStart={(event) => {
                        if (entry.folder.system || isReadOnly) {
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
                        if (
                          event.dataTransfer.types.includes("Files")
                          ||
                          event.dataTransfer.types.includes(CINEMA_ASSET_LIBRARY_ENTRY_DRAG_TYPE)
                          || event.dataTransfer.types.includes(CINEMA_ASSET_LIBRARY_DRAG_TYPE)
                        ) event.preventDefault()
                      }}
                      onDrop={(event) => {
                        if (event.dataTransfer.types.includes("Files")) {
                          event.preventDefault()
                          event.stopPropagation()
                          const hasDirectory = Array.from(event.dataTransfer.items).some((item) => {
                            const droppedEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }).webkitGetAsEntry?.()
                            return droppedEntry?.isDirectory === true
                          })
                          if (hasDirectory) {
                            setActionError("暂不支持导入整个文件夹，请选择文件")
                            return
                          }
                          handleFiles(event.dataTransfer.files, entry.folder.id)
                          return
                        }
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
                      {debouncedSearch
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
                searching={Boolean(debouncedSearch)}
                allowDragAndAdd
                scrollElementRef={contentRef}
                layoutVersion={`${folders.length}:${debouncedSearch}`}
                revealRequest={gridRevealRequest}
                onSelect={selectEntry}
                onContextMenu={openEntryContextMenu}
                onOpenContextMenuAt={openEntryContextMenuAt}
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

      {migrationBlocksLibrary ? null : selectedEntries.length > 1 ? (
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
              disabled={isReadOnly || beginDeleteMutation.isPending}
              onClick={() => requestDelete(selectedTargets)}
            >
              <Trash2 size={14} aria-hidden="true" />
              删除
            </button>
          </div>
        </div>
      ) : selectedFolder ? (
        <FolderDetail
          folder={selectedFolder}
          isReadOnly={isReadOnly}
          onRename={(folder) => setRenameTarget({ entryType: "folder", folder })}
          onMove={(folder) => setMoveEntries([{ entryType: "folder", folderID: folder.id }])}
          onDelete={(folder) => requestDelete(
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
          onDelete={(asset) => requestDelete([{ entryType: "asset", assetID: asset.id }], [{ entryType: "asset", asset }])}
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

      {pendingDeletes.length > 0 ? (
        <div className={`cinema-asset-library-toast-stack ${actionError ? "has-action-error" : ""}`} aria-label="待完成的删除">
          {pendingDeletes.map((pendingDelete) => (
            <div key={pendingDelete.operationID} className="cinema-asset-library-toast" role="status">
              <span>已删除 {pendingDelete.count} 项</span>
              <button
                type="button"
                disabled={pendingDeleteActionIDs.has(pendingDelete.operationID)}
                onClick={() => void undoPendingDelete(pendingDelete)}
              >
                {pendingDeleteActionIDs.has(pendingDelete.operationID)
                  ? <Loader2 size={13} aria-hidden="true" className="is-spinning" />
                  : <RotateCcw size={13} aria-hidden="true" />}
                撤销
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {createFolderParentID ? (
        <NameDialog
          title="新建文件夹"
          confirmLabel="创建"
          pending={createFolderMutation.isPending}
          maxLength={80}
          onClose={() => setCreateFolderParentID(null)}
          onSubmit={async (name) => {
            setActionError(null)
            try {
              await createFolderMutation.mutateAsync({ name, parentFolderID: createFolderParentID })
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
          initialFolderID={rootFolderID}
          title="移动到文件夹"
          confirmLabel="移动到这里"
          pending={moveMutation.isPending}
          onClose={() => setMoveEntries(null)}
          onChoose={(destinationFolderID) => {
            setActionError(null)
            void moveMutation.mutateAsync({ entries: moveEntries, destinationFolderID }).catch(handleActionError)
          }}
        />
      ) : null}

      {pendingUploadDestination ? (
        <FolderPickerDialog
          key={`upload:${scopeKey}:${pendingUploadDestination.initialFolderID}`}
          api={api}
          rootFolderID={rootFolderID}
          initialFolderID={pendingUploadDestination.initialFolderID}
          title="选择上传位置"
          confirmLabel="上传到这里"
          pending={false}
          onClose={() => setPendingUploadDestination(null)}
          onChoose={(destinationFolderID) => {
            const request = pendingUploadDestination
            setPendingUploadDestination(null)
            if (request.files) {
              handleFiles(request.files, destinationFolderID)
              return
            }
            uploadTargetFolderIDRef.current = destinationFolderID
            uploadInputRef.current?.click()
          }}
        />
      ) : null}

      {pendingDeleteConfirmation ? (
        <DeleteConfirmationDialog
          entries={pendingDeleteConfirmation.entries}
          pending={beginDeleteMutation.isPending}
          onClose={() => {
            if (!beginDeleteMutation.isPending) setPendingDeleteConfirmation(null)
          }}
          onConfirm={async () => {
            try {
              await beginDeleteMutation.mutateAsync({
                targets: pendingDeleteConfirmation.targets,
                entries: pendingDeleteConfirmation.entries,
                deleteApi: api,
                deleteScope: scope,
                deleteScopeKey: scopeKey,
                baseRevision: revisionRef.current,
              })
            } catch (error) {
              handleActionError(error)
              throw error
            }
          }}
        />
      ) : null}

      {contextMenu ? (
        <AssetLibraryContextMenu
          menu={contextMenu}
          searching={isSearching}
          currentFolderID={currentSession.folderID}
          isReadOnly={isReadOnly}
          onClose={closeContextMenu}
          onOpenFolder={openFolder}
          onUpload={requestUpload}
          onCreateFolder={setCreateFolderParentID}
          onRename={setRenameTarget}
          onMove={setMoveEntries}
          onDelete={requestDelete}
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
  revealRequest,
  onSelect,
  onContextMenu,
  onOpenContextMenuAt,
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
  revealRequest?: AssetGridRevealRequest | null
  onSelect(entry: AssetLibraryEntry, event: ReactMouseEvent<HTMLButtonElement>): void
  onContextMenu(entry: AssetLibraryEntry, event: ReactMouseEvent<HTMLElement>): void
  onOpenContextMenuAt(entry: AssetLibraryEntry, x: number, y: number, returnFocus: HTMLElement | null): void
  onAdd(asset: CinemaAssetRecord): void | Promise<void>
}) {
  const gridRef = useRef<HTMLElement>(null)
  const assetButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const pendingFocusIndexRef = useRef<number | null>(null)
  const lastFocusedRevealRequestIDRef = useRef<string | null>(null)
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

  useEffect(() => {
    if (!revealRequest || lastFocusedRevealRequestIDRef.current === revealRequest.requestID) return
    const targetIndex = assets.findIndex((asset) => asset.id === revealRequest.assetID)
    if (targetIndex < 0) return
    lastFocusedRevealRequestIDRef.current = revealRequest.requestID
    focusAssetAtIndex(targetIndex)
  }, [assets, focusAssetAtIndex, revealRequest])

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
        onContextMenu={(event) => onContextMenu(entry, event)}
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
          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            event.preventDefault()
            event.stopPropagation()
            const bounds = event.currentTarget.getBoundingClientRect()
            onOpenContextMenuAt(entry, bounds.left + 16, bounds.top + 16, event.currentTarget)
            return
          }
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
    case "trashed": return "正在删除"
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
  onDelete,
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
  onDelete(asset: CinemaAssetRecord): void
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
        <DetailActionButton danger label={`删除 ${asset.displayName}`} disabled={isReadOnly} onClick={() => onDelete(asset)}>
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
  onDelete,
}: {
  folder: Extract<AssetLibraryEntry, { entryType: "folder" }>["folder"]
  isReadOnly: boolean
  onRename(folder: Extract<AssetLibraryEntry, { entryType: "folder" }>["folder"]): void
  onMove(folder: Extract<AssetLibraryEntry, { entryType: "folder" }>["folder"]): void
  onDelete(folder: Extract<AssetLibraryEntry, { entryType: "folder" }>["folder"]): void
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
        <DetailActionButton danger label={`删除文件夹 ${folder.name}`} disabled={actionsDisabled} onClick={() => onDelete(folder)}>
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

interface AssetLibraryContextMenuItem {
  id: string
  label: string
  icon: ReactNode
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  action(): void
}

function AssetLibraryContextMenu({
  menu,
  searching,
  currentFolderID,
  isReadOnly,
  onClose,
  onOpenFolder,
  onUpload,
  onCreateFolder,
  onRename,
  onMove,
  onDelete,
}: {
  menu: AssetLibraryContextMenuState
  searching: boolean
  currentFolderID: string
  isReadOnly: boolean
  onClose(restoreFocus?: boolean): void
  onOpenFolder(folderID: string): void
  onUpload(folderID?: string): void
  onCreateFolder(parentFolderID: string): void
  onRename(entry: AssetLibraryEntry): void
  onMove(entries: AssetLibraryEntryRef[]): void
  onDelete(entries: AssetLibraryEntryRef[], sourceEntries: AssetLibraryEntry[]): void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x: menu.x, y: menu.y })
  const items = useMemo<AssetLibraryContextMenuItem[]>(() => {
    const mutate = (item: Omit<AssetLibraryContextMenuItem, "disabled">): AssetLibraryContextMenuItem => ({
      ...item,
      disabled: isReadOnly,
    })

    if (menu.entries.length === 0) {
      const backgroundItems: AssetLibraryContextMenuItem[] = [mutate({
        id: "upload",
        label: "上传到这里",
        icon: <Upload size={14} aria-hidden="true" />,
        action: () => onUpload(),
      })]
      if (!searching) {
        backgroundItems.push(mutate({
          id: "create-folder",
          label: "新建文件夹",
          icon: <FolderPlus size={14} aria-hidden="true" />,
          action: () => onCreateFolder(currentFolderID),
        }))
      }
      return backgroundItems
    }

    if (menu.entries.length > 1) {
      return [
        {
          ...mutate({
            id: "move",
            label: "移动",
            icon: <Move size={14} aria-hidden="true" />,
            action: () => onMove(menu.targets),
          }),
          disabled: isReadOnly || menu.targets.length === 0,
        },
        {
          ...mutate({
            id: "delete",
            label: "删除",
            icon: <Trash2 size={14} aria-hidden="true" />,
            danger: true,
            action: () => onDelete(menu.targets, menu.entries),
          }),
          disabled: isReadOnly || menu.targets.length === 0,
        },
      ]
    }

    const entry = menu.entries[0]
    if (entry.entryType === "folder") {
      const folderItems: AssetLibraryContextMenuItem[] = [
        {
          id: "open",
          label: "打开",
          icon: <Folder size={14} aria-hidden="true" />,
          action: () => onOpenFolder(entry.folder.id),
        },
        mutate({
          id: "upload",
          label: "上传到这里",
          icon: <Upload size={14} aria-hidden="true" />,
          action: () => onUpload(entry.folder.id),
        }),
        mutate({
          id: "create-subfolder",
          label: "新建子文件夹",
          icon: <FolderPlus size={14} aria-hidden="true" />,
          action: () => onCreateFolder(entry.folder.id),
        }),
      ]
      if (!entry.folder.system) {
        folderItems.push(
          mutate({
            id: "rename",
            label: "重命名",
            icon: <PencilLine size={14} aria-hidden="true" />,
            separatorBefore: true,
            action: () => onRename(entry),
          }),
          mutate({
            id: "move",
            label: "移动",
            icon: <Move size={14} aria-hidden="true" />,
            action: () => onMove(menu.targets),
          }),
          mutate({
            id: "delete",
            label: "删除",
            icon: <Trash2 size={14} aria-hidden="true" />,
            danger: true,
            action: () => onDelete(menu.targets, menu.entries),
          }),
        )
      }
      return folderItems
    }

    return [
      mutate({
        id: "rename",
        label: "重命名",
        icon: <PencilLine size={14} aria-hidden="true" />,
        action: () => onRename(entry),
      }),
      mutate({
        id: "move",
        label: "移动",
        icon: <Move size={14} aria-hidden="true" />,
        action: () => onMove(menu.targets),
      }),
      mutate({
        id: "delete",
        label: "删除",
        icon: <Trash2 size={14} aria-hidden="true" />,
        danger: true,
        action: () => onDelete(menu.targets, menu.entries),
      }),
    ]
  }, [currentFolderID, isReadOnly, menu.entries, menu.targets, onCreateFolder, onDelete, onMove, onOpenFolder, onRename, onUpload, searching])

  useLayoutEffect(() => {
    const element = menuRef.current
    if (!element) return
    const bounds = element.getBoundingClientRect()
    const next = clampContextMenuPosition(
      menu.x,
      menu.y,
      bounds.width,
      bounds.height,
      window.innerWidth,
      window.innerHeight,
    )
    setPosition((current) => current.x === next.x && current.y === next.y ? current : next)
    const firstItem = element.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")
    firstItem?.focus({ preventScroll: true })
  }, [items, menu.x, menu.y])

  useEffect(() => {
    const closeForExternalPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose(false)
    }
    const closeForViewportChange = () => onClose(false)
    document.addEventListener("pointerdown", closeForExternalPointer, true)
    window.addEventListener("resize", closeForViewportChange)
    window.addEventListener("scroll", closeForViewportChange, true)
    return () => {
      document.removeEventListener("pointerdown", closeForExternalPointer, true)
      window.removeEventListener("resize", closeForViewportChange)
      window.removeEventListener("scroll", closeForViewportChange, true)
    }
  }, [onClose])

  const moveFocus = (direction: 1 | -1) => {
    const enabledItems = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [])
    if (enabledItems.length === 0) return
    const currentIndex = enabledItems.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : enabledItems.length - 1
      : (currentIndex + direction + enabledItems.length) % enabledItems.length
    enabledItems[nextIndex]?.focus({ preventScroll: true })
  }

  const portalTarget = typeof document === "undefined" ? null : document.body
  if (!portalTarget) return null
  return createPortal(
    <div
      ref={menuRef}
      className="cinema-asset-library-context-menu"
      role="menu"
      aria-label="素材库操作"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault()
          onClose(true)
          return
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault()
          moveFocus(event.key === "ArrowDown" ? 1 : -1)
          return
        }
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault()
          const enabledItems = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? [])
          enabledItems[event.key === "Home" ? 0 : enabledItems.length - 1]?.focus({ preventScroll: true })
        }
      }}
    >
      {items.map((item) => (
        <div key={item.id} className="cinema-asset-library-context-menu-row">
          {item.separatorBefore ? <div className="cinema-asset-library-context-menu-separator" role="separator" /> : null}
          <button
            type="button"
            role="menuitem"
            className={item.danger ? "is-danger" : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose(false)
              item.action()
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        </div>
      ))}
    </div>,
    portalTarget,
  )
}

function DeleteConfirmationDialog({
  entries,
  pending,
  onClose,
  onConfirm,
}: {
  entries: AssetLibraryEntry[]
  pending: boolean
  onClose(): void
  onConfirm(): Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const summary = useMemo(() => summarizeAssetLibrarySelection(entries), [entries])

  useEffect(() => dialogRef.current?.focus(), [])

  const submit = async () => {
    setError(null)
    try {
      await onConfirm()
    } catch (confirmError) {
      setError(assetLibraryErrorMessage(confirmError, "删除失败"))
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
            删除所选内容
          </strong>
          <LibraryIconButton label="关闭" disabled={pending} onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </LibraryIconButton>
        </header>
        <div id="cinema-asset-library-delete-dialog-description" className="cinema-asset-library-delete-dialog-copy">
          <AlertCircle size={18} aria-hidden="true" />
          <div>
            <strong>
              {`${summary.count} 项（${summary.folderCount} 个文件夹，${summary.assetCount} 个素材）`}
            </strong>
            <span>
              {summary.knownSizeBytes > 0 ? `已知素材大小 ${formatAssetLibrarySize(summary.knownSizeBytes)}。` : ""}
              删除后可在 10 秒内撤销。仍被画布、时间线或任务引用的素材不会被删除。
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
            {pending ? "正在删除" : "删除"}
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
  initialFolderID,
  title,
  confirmLabel,
  pending,
  onClose,
  onChoose,
}: {
  api: AssetLibraryApi
  rootFolderID: string
  initialFolderID: string
  title: string
  confirmLabel: string
  pending: boolean
  onClose(): void
  onChoose(folderID: string): void
}) {
  const [folderID, setFolderID] = useState(initialFolderID)
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
          <strong id="cinema-asset-library-folder-picker-title">{title}</strong>
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
            {pending ? "正在处理" : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  )
}
