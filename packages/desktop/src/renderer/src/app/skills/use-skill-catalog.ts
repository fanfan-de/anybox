import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  DownloadedRegistrySkill,
  RegistryFile,
  RegistryFileContent,
  RegistryProviderDescriptor,
  RegistryProviderError,
  RegistrySearchSort,
  RegistrySecuritySnapshot,
  RegistrySkillDetail,
  RegistrySkillSummary,
  RegistryVersion,
  RegistryVersionRef,
} from "@anybox/shared"
import type {
  DesktopRegistrySkillDeleteResult,
  DesktopRegistrySkillForkResult,
  DesktopRegistrySkillMutationResult,
} from "../../../../shared/desktop-ipc-contract"

const SEARCH_DEBOUNCE_MS = 350

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sameSkill(left: RegistrySkillSummary | null, right: RegistrySkillSummary) {
  return left?.provider === right.provider && left.remoteId === right.remoteId
}

export interface SkillCatalogState {
  catalogError: string | null
  detail: RegistrySkillDetail | null
  downloadsError: string | null
  downloadedSkills: DownloadedRegistrySkill[]
  errors: RegistryProviderError[]
  fileContent: RegistryFileContent | null
  files: RegistryFile[]
  isDownloading: boolean
  isLoadingDownloads: boolean
  isLoadingDetail: boolean
  isLoadingProviders: boolean
  isLoadingMore: boolean
  isSearching: boolean
  providerFilter: string
  providers: RegistryProviderDescriptor[]
  query: string
  results: RegistrySkillSummary[]
  security: RegistrySecuritySnapshot | null
  selectedVersion: string | null
  selectedFilePath: string | null
  selectedSkill: RegistrySkillSummary | null
  sort: RegistrySearchSort
  versions: RegistryVersion[]
  downloadSelected: () => Promise<DownloadedRegistrySkill | null>
  deleteDownloaded: (id: string) => Promise<DesktopRegistrySkillDeleteResult | null>
  forkDownloaded: (id: string, name?: string) => Promise<DesktopRegistrySkillForkResult | null>
  listDownloadedFiles: (id: string, version?: string) => Promise<RegistryFile[]>
  loadMore: () => Promise<void>
  hasMore: boolean
  previewDownloadedUpdate: (id: string) => ReturnType<NonNullable<NonNullable<typeof window.desktop>["previewDownloadedRegistrySkillUpdate"]>> | null
  readDownloadedFile: (id: string, path?: string, version?: string) => Promise<RegistryFileContent | null>
  refreshDownloads: () => Promise<void>
  rollbackDownloaded: (id: string, version?: string) => Promise<DesktopRegistrySkillMutationResult | null>
  setDownloadedEnabled: (id: string, enabled: boolean) => Promise<DesktopRegistrySkillMutationResult | null>
  updateDownloaded: (id: string, version?: string) => Promise<DownloadedRegistrySkill | null>
  readFile: (path: string) => Promise<void>
  refresh: () => void
  selectSkill: (skill: RegistrySkillSummary | null) => void
  selectVersion: (version: string) => Promise<void>
  setProviderFilter: (provider: string) => void
  setQuery: (query: string) => void
  setSort: (sort: RegistrySearchSort) => void
}

export function useSkillCatalog({
  catalogEnabled = true,
  downloadsEnabled = true,
}: {
  catalogEnabled?: boolean
  downloadsEnabled?: boolean
} = {}): SkillCatalogState {
  const [providers, setProviders] = useState<RegistryProviderDescriptor[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = useState(false)
  const [query, setQuery] = useState("")
  const [providerFilter, setProviderFilter] = useState("all")
  const [sort, setSort] = useState<RegistrySearchSort>("relevance")
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [results, setResults] = useState<RegistrySkillSummary[]>([])
  const [nextCursor, setNextCursor] = useState<Record<string, string> | undefined>()
  const [errors, setErrors] = useState<RegistryProviderError[]>([])
  const [selectedSkill, setSelectedSkill] = useState<RegistrySkillSummary | null>(null)
  const [detail, setDetail] = useState<RegistrySkillDetail | null>(null)
  const [versions, setVersions] = useState<RegistryVersion[]>([])
  const [files, setFiles] = useState<RegistryFile[]>([])
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<RegistryFileContent | null>(null)
  const [security, setSecurity] = useState<RegistrySecuritySnapshot | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isLoadingDownloads, setIsLoadingDownloads] = useState(false)
  const [downloadedSkills, setDownloadedSkills] = useState<DownloadedRegistrySkill[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [downloadsError, setDownloadsError] = useState<string | null>(null)
  const searchRevisionRef = useRef(0)
  const detailRevisionRef = useRef(0)
  const fileRevisionRef = useRef(0)
  const downloadsRevisionRef = useRef(0)

  const providerIDs = useMemo(
    () => providerFilter === "all" ? undefined : [providerFilter],
    [providerFilter],
  )

  useEffect(() => {
    if (catalogEnabled) return
    searchRevisionRef.current += 1
    detailRevisionRef.current += 1
    fileRevisionRef.current += 1
    setIsLoadingProviders(false)
    setIsSearching(false)
    setIsLoadingMore(false)
    setIsLoadingDetail(false)
    setCatalogError(null)
  }, [catalogEnabled])

  useEffect(() => {
    if (!catalogEnabled) return
    const getProviders = window.desktop?.getSkillRegistryProviders
    if (!getProviders) {
      setCatalogError("Skill registries are unavailable in this desktop build.")
      return
    }

    let mounted = true
    setIsLoadingProviders(true)
    void getProviders()
      .then((items) => {
        if (!mounted) return
        setProviders(items)
        setCatalogError(null)
      })
      .catch((error) => {
        if (mounted) setCatalogError(errorMessage(error))
      })
      .finally(() => {
        if (mounted) setIsLoadingProviders(false)
      })

    return () => {
      mounted = false
    }
  }, [catalogEnabled])

  const refreshDownloads = useCallback(async () => {
    if (!downloadsEnabled) return
    const listDownloads = window.desktop?.listDownloadedRegistrySkills
    if (!listDownloads) return
    const requestRevision = ++downloadsRevisionRef.current
    setIsLoadingDownloads(true)
    try {
      const items = await listDownloads()
      if (downloadsRevisionRef.current === requestRevision) {
        setDownloadedSkills(items)
        setDownloadsError(null)
      }
    } catch (error) {
      if (downloadsRevisionRef.current === requestRevision) setDownloadsError(errorMessage(error))
    } finally {
      if (downloadsRevisionRef.current === requestRevision) setIsLoadingDownloads(false)
    }
  }, [downloadsEnabled])

  useEffect(() => {
    if (!downloadsEnabled) {
      downloadsRevisionRef.current += 1
      setIsLoadingDownloads(false)
      return
    }
    void refreshDownloads()
  }, [downloadsEnabled, refreshDownloads])

  useEffect(() => {
    if (!catalogEnabled) return
    const search = window.desktop?.searchSkillRegistry
    if (!search) return

    const requestRevision = ++searchRevisionRef.current
    setNextCursor(undefined)
    const timeoutID = window.setTimeout(() => {
      setIsSearching(true)
      setCatalogError(null)
      void search({
        query,
        providers: providerIDs,
        limit: 40,
        sort,
        safeOnly: false,
      })
        .then((page) => {
          if (searchRevisionRef.current !== requestRevision) return
          setResults(page.items)
          setNextCursor(page.nextCursor)
          setErrors(page.errors)
          setSelectedSkill((current) => {
            if (current && page.items.some((item) => sameSkill(current, item))) return current
            return page.items[0] ?? null
          })
        })
        .catch((error) => {
          if (searchRevisionRef.current !== requestRevision) return
          setResults([])
          setNextCursor(undefined)
          setErrors([])
          setSelectedSkill(null)
          setCatalogError(errorMessage(error))
        })
        .finally(() => {
          if (searchRevisionRef.current === requestRevision) setIsSearching(false)
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeoutID)
      if (searchRevisionRef.current === requestRevision) setIsSearching(false)
    }
  }, [catalogEnabled, providerIDs, query, refreshRevision, sort])

  const loadMore = useCallback(async () => {
    const search = window.desktop?.searchSkillRegistry
    if (!catalogEnabled || !search || !nextCursor || isLoadingMore) return
    const requestRevision = searchRevisionRef.current
    setIsLoadingMore(true)
    try {
      const page = await search({
        query,
        providers: providerIDs,
        limit: 40,
        cursor: nextCursor,
        sort,
        safeOnly: false,
      })
      if (searchRevisionRef.current !== requestRevision) return
      setResults((current) => {
        const seen = new Set(current.map((item) => `${item.provider}:${item.remoteId}`))
        return [...current, ...page.items.filter((item) => !seen.has(`${item.provider}:${item.remoteId}`))]
      })
      setErrors(page.errors)
      setNextCursor(page.nextCursor)
      setCatalogError(null)
    } catch (error) {
      if (searchRevisionRef.current === requestRevision) setCatalogError(errorMessage(error))
    } finally {
      if (searchRevisionRef.current === requestRevision) setIsLoadingMore(false)
    }
  }, [catalogEnabled, isLoadingMore, nextCursor, providerIDs, query, sort])

  const readFile = useCallback(async (path: string) => {
    if (!catalogEnabled || !selectedSkill) return
    const read = window.desktop?.readSkillRegistryFile
    if (!read) return

    const requestRevision = ++fileRevisionRef.current
    setSelectedFilePath(path)
    try {
      const content = await read({
        provider: selectedSkill.provider,
        remoteId: selectedSkill.remoteId,
        version: selectedVersion ?? detail?.latestVersion?.version ?? detail?.version ?? selectedSkill.version,
        path,
      })
      if (fileRevisionRef.current === requestRevision) setFileContent(content)
    } catch (error) {
      if (fileRevisionRef.current === requestRevision) setCatalogError(errorMessage(error))
    }
  }, [catalogEnabled, detail, selectedSkill, selectedVersion])

  useEffect(() => {
    if (!catalogEnabled || !selectedSkill) {
      setDetail(null)
      setVersions([])
      setFiles([])
      setSelectedFilePath(null)
      setFileContent(null)
      setSecurity(null)
      setSelectedVersion(null)
      return
    }

    const getDetail = window.desktop?.getSkillRegistryDetail
    if (!getDetail) return
    const requestRevision = ++detailRevisionRef.current
    const ref: RegistryVersionRef = {
      provider: selectedSkill.provider,
      remoteId: selectedSkill.remoteId,
      version: selectedSkill.version,
    }

    setIsLoadingDetail(true)
    setDetail(null)
    setVersions([])
    setFiles([])
    setSelectedFilePath(null)
    setFileContent(null)
    setSecurity(selectedSkill.security ?? null)
    setSelectedVersion(selectedSkill.version ?? null)

    void Promise.allSettled([
      getDetail(ref),
      window.desktop?.getSkillRegistryVersions?.(ref) ?? Promise.resolve([]),
      window.desktop?.getSkillRegistryFiles?.(ref) ?? Promise.resolve([]),
      window.desktop?.getSkillRegistrySecurity?.(ref) ?? Promise.resolve(selectedSkill.security ?? null),
    ]).then(async ([detailResult, versionsResult, filesResult, securityResult]) => {
      if (detailRevisionRef.current !== requestRevision) return

      if (detailResult.status === "rejected") {
        setCatalogError(errorMessage(detailResult.reason))
        setIsLoadingDetail(false)
        return
      }

      const nextDetail = detailResult.value
      const nextVersions = versionsResult.status === "fulfilled" ? versionsResult.value : []
      const nextFiles = filesResult.status === "fulfilled" ? filesResult.value : []
      const nextSecurity = securityResult.status === "fulfilled" ? securityResult.value : selectedSkill.security ?? null
      setDetail(nextDetail)
      setVersions(nextVersions)
      setFiles(nextFiles)
      setSecurity(nextSecurity)
      const resolvedVersion = ref.version ?? nextDetail.latestVersion?.version ?? nextDetail.version ?? null
      setSelectedVersion(resolvedVersion)
      setCatalogError(null)
      setIsLoadingDetail(false)

      const skillFile = nextFiles.find((file) => file.path.toLowerCase() === "skill.md")
        ?? nextFiles.find((file) => file.name.toLowerCase() === "skill.md")
      if (!skillFile || !window.desktop?.readSkillRegistryFile) return

      try {
        const content = await window.desktop.readSkillRegistryFile({
          provider: selectedSkill.provider,
          remoteId: selectedSkill.remoteId,
          version: resolvedVersion ?? undefined,
          path: skillFile.path,
        })
        if (detailRevisionRef.current !== requestRevision) return
        setSelectedFilePath(skillFile.path)
        setFileContent(content)
      } catch {
        // The summary and metadata remain useful when an upstream does not expose file content.
      }
    })
  }, [catalogEnabled, selectedSkill])

  const selectVersion = useCallback(async (version: string) => {
    if (!catalogEnabled || !selectedSkill || version === selectedVersion) return
    const requestRevision = ++detailRevisionRef.current
    const ref: RegistryVersionRef = {
      provider: selectedSkill.provider,
      remoteId: selectedSkill.remoteId,
      version,
    }
    setSelectedVersion(version)
    setFiles([])
    setSelectedFilePath(null)
    setFileContent(null)
    setIsLoadingDetail(true)
    try {
      const [filesResult, securityResult] = await Promise.allSettled([
        window.desktop?.getSkillRegistryFiles?.(ref) ?? Promise.resolve([]),
        window.desktop?.getSkillRegistrySecurity?.(ref) ?? Promise.resolve(null),
      ])
      if (detailRevisionRef.current !== requestRevision) return
      const nextFiles = filesResult.status === "fulfilled" ? filesResult.value : []
      setFiles(nextFiles)
      if (securityResult.status === "fulfilled") setSecurity(securityResult.value)
      const skillFile = nextFiles.find((file) => file.path.toLowerCase() === "skill.md")
        ?? nextFiles.find((file) => file.name.toLowerCase() === "skill.md")
      if (!skillFile || !window.desktop?.readSkillRegistryFile) return
      const content = await window.desktop.readSkillRegistryFile({ ...ref, path: skillFile.path })
      if (detailRevisionRef.current !== requestRevision) return
      setSelectedFilePath(skillFile.path)
      setFileContent(content)
      setCatalogError(null)
    } catch (error) {
      if (detailRevisionRef.current === requestRevision) setCatalogError(errorMessage(error))
    } finally {
      if (detailRevisionRef.current === requestRevision) setIsLoadingDetail(false)
    }
  }, [catalogEnabled, selectedSkill, selectedVersion])

  const downloadSelected = useCallback(async () => {
    if (!selectedSkill) return null
    const download = window.desktop?.downloadSkillRegistrySkill
    if (!download) {
      setCatalogError("Managed skill downloads are unavailable in this desktop build.")
      return null
    }

    setIsDownloading(true)
    setCatalogError(null)
    try {
      const downloaded = await download({
        provider: selectedSkill.provider,
        remoteId: selectedSkill.remoteId,
        version: selectedVersion ?? detail?.latestVersion?.version ?? detail?.version ?? selectedSkill.version,
      })
      setDownloadedSkills((current) => [
        downloaded,
        ...current.filter((item) => item.id !== downloaded.id),
      ])
      return downloaded
    } catch (error) {
      setCatalogError(errorMessage(error))
      return null
    } finally {
      setIsDownloading(false)
    }
  }, [detail, selectedSkill, selectedVersion])

  const setDownloadedEnabled = useCallback(async (id: string, enabled: boolean) => {
    const update = window.desktop?.setDownloadedRegistrySkillEnabled
    if (!update) return null
    try {
      const next = await update({ id, enabled })
      setDownloadedSkills((current) => current.map((item) => item.id === id ? next : item))
      setDownloadsError(null)
      return next
    } catch (error) {
      setDownloadsError(errorMessage(error))
      return null
    }
  }, [])

  const deleteDownloaded = useCallback(async (id: string) => {
    const remove = window.desktop?.deleteDownloadedRegistrySkill
    if (!remove) return null
    try {
      const result = await remove({ id })
      setDownloadedSkills((current) => current.filter((item) => item.id !== id))
      setDownloadsError(null)
      return result
    } catch (error) {
      setDownloadsError(errorMessage(error))
      return null
    }
  }, [])

  const readDownloadedFile = useCallback(async (id: string, path = "SKILL.md", version?: string) => {
    const read = window.desktop?.readDownloadedRegistrySkillFile
    if (!read) return null
    try {
      const result = await read({ id, path, version })
      setDownloadsError(null)
      return result
    } catch (error) {
      setDownloadsError(errorMessage(error))
      return null
    }
  }, [])

  const listDownloadedFiles = useCallback(async (id: string, version?: string) => {
    const list = window.desktop?.listDownloadedRegistrySkillFiles
    if (!list) return []
    try {
      const result = await list({ id, version })
      setDownloadsError(null)
      return result
    } catch (error) {
      setDownloadsError(errorMessage(error))
      return []
    }
  }, [])

  const forkDownloaded = useCallback(async (id: string, name?: string) => {
    const fork = window.desktop?.forkDownloadedRegistrySkill
    if (!fork) return null
    try {
      const result = await fork({ id, name })
      setDownloadsError(null)
      return result
    } catch (error) {
      setDownloadsError(errorMessage(error))
      return null
    }
  }, [])

  const previewDownloadedUpdate = useCallback((id: string) => {
    const preview = window.desktop?.previewDownloadedRegistrySkillUpdate
    return preview ? preview({ id }) : null
  }, [])

  const updateDownloaded = useCallback(async (id: string, version?: string) => {
    const update = window.desktop?.updateDownloadedRegistrySkill
    if (!update) return null
    try {
      const next = await update({ id, version })
      setDownloadedSkills((current) => current.map((item) => item.id === id ? next : item))
      setDownloadsError(null)
      return next
    } catch (error) {
      setDownloadsError(errorMessage(error))
      return null
    }
  }, [])

  const rollbackDownloaded = useCallback(async (id: string, version?: string) => {
    const rollback = window.desktop?.rollbackDownloadedRegistrySkill
    if (!rollback) return null
    try {
      const next = await rollback({ id, version })
      setDownloadedSkills((current) => current.map((item) => item.id === id ? next : item))
      setDownloadsError(null)
      return next
    } catch (error) {
      setDownloadsError(errorMessage(error))
      return null
    }
  }, [])

  return {
    catalogError,
    detail,
    downloadsError,
    downloadedSkills,
    errors,
    fileContent,
    files,
    isDownloading,
    isLoadingDownloads,
    isLoadingDetail,
    isLoadingMore,
    isLoadingProviders,
    isSearching,
    providerFilter,
    providers,
    query,
    results,
    security,
    selectedVersion,
    selectedFilePath,
    selectedSkill,
    sort,
    versions,
    downloadSelected,
    deleteDownloaded,
    forkDownloaded,
    listDownloadedFiles,
    loadMore,
    hasMore: Boolean(nextCursor),
    previewDownloadedUpdate,
    readDownloadedFile,
    refreshDownloads,
    rollbackDownloaded,
    readFile,
    refresh: () => setRefreshRevision((value) => value + 1),
    selectSkill: setSelectedSkill,
    selectVersion,
    setDownloadedEnabled,
    setProviderFilter,
    setQuery,
    setSort,
    updateDownloaded,
  }
}
