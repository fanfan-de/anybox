import type {
  CinemaAssetEntryTarget,
  CinemaAssetFolder,
  CinemaAssetMigrationResult,
  CinemaAssetMigrationStatusResult,
  CinemaAssetMutationResult,
  CinemaAssetRecord,
  CinemaAssetScope,
} from "@anybox/cinema-plugin/contracts"
import {
  CINEMA_ASSET_MAX_AUDIO_BYTES,
  CINEMA_ASSET_MAX_FOLDER_DEPTH,
  CINEMA_ASSET_MAX_IMAGE_BYTES,
  CINEMA_ASSET_MAX_VIDEO_BYTES,
  CinemaAssetMigrationResultSchema,
  CinemaAssetMigrationStatusResultSchema,
} from "@anybox/cinema-plugin/contracts"
import {
  type AssetLibraryBreadcrumb,
  type AssetLibraryEntry,
  assetLibraryScopeKey,
  sortAssetLibraryEntries,
} from "./assetLibraryModel"
import { resolveCinemaRuntimeURL } from "../../runtimeUrl"
import { applyCinemaRuntimeXHRHeaders, cinemaRuntimeFetch } from "../../runtimeFetch"

export interface AssetLibraryState {
  scope: CinemaAssetScope
  revision: number
  status: "ready" | "recovery-required"
  readOnly: boolean
  rootFolderID: string
  counts: {
    folders: number
    assets: number
    processing: number
    failed: number
    missing: number
    trashed: number
  }
  defaultFolderIDs: Record<string, string>
  limits: {
    maxFolderDepth: number
    maxImageBytes: number
    maxVideoBytes: number
    maxAudioBytes: number
  }
  updatedAt?: string
}

export interface AssetLibraryListing {
  scope: CinemaAssetScope
  revision: number
  folderID: string
  folder?: CinemaAssetFolder
  breadcrumbs: AssetLibraryBreadcrumb[]
  query: string
  entries: AssetLibraryEntry[]
  nextCursor?: string
  total?: number
}

export type AssetLibraryEntryRef = CinemaAssetEntryTarget

export type AssetLibraryMutationResult = CinemaAssetMutationResult

export type AssetLibraryPendingDeleteResult = AssetLibraryMutationResult & {
  undoUntil: string
}

export type AssetLibraryFinalizeDeleteOptions = {
  operationID: string
  baseRevision: number
} & (
  | { entries: AssetLibraryEntryRef[]; all?: never }
  | { entries?: never; all: true }
)

export interface AssetLibraryUploadResult {
  revision: number
  asset: CinemaAssetRecord
}

export interface AssetLibraryUploadOptions {
  file: File
  folderID: string
  operationID: string
  baseRevision: number
  source?: "upload" | "crop"
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}

export class AssetLibraryApiError extends Error {
  readonly status: number
  readonly latestRevision?: number
  readonly code?: string

  constructor(message: string, status: number, latestRevision?: number, code?: string) {
    super(message)
    this.name = "AssetLibraryApiError"
    this.status = status
    this.latestRevision = latestRevision
    this.code = code
  }
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function optionalNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value))
}

function errorFromEnvelope(response: Response, body: unknown): AssetLibraryApiError {
  const envelope = isRecord(body) ? body : null
  const error = envelope && isRecord(envelope.error) ? envelope.error : null
  const errorData = error && isRecord(error.data) ? error.data : null
  const data = envelope && isRecord(envelope.data) ? envelope.data : null
  const latestRevision = finiteNumber(
    errorData?.latestRevision ?? error?.latestRevision ?? data?.revision,
    Number.NaN,
  )
  return new AssetLibraryApiError(
    stringValue(error?.message, `Request failed (${response.status})`),
    response.status,
    Number.isFinite(latestRevision) ? latestRevision : undefined,
    stringValue(error?.code) || undefined,
  )
}

async function requestData<T>(baseURL: string, pathname: string, init?: RequestInit): Promise<T> {
  const response = await cinemaRuntimeFetch(new URL(resolveCinemaRuntimeURL(baseURL, pathname)), init)
  const body = await response.json().catch(() => null) as unknown
  if (!response.ok) throw errorFromEnvelope(response, body)
  if (isRecord(body) && body.success === false) throw errorFromEnvelope(response, body)
  if (isRecord(body) && body.success === true && "data" in body) return body.data as T
  return body as T
}

function normalizeScope(raw: unknown, fallback: CinemaAssetScope): CinemaAssetScope {
  if (!isRecord(raw)) return fallback
  if (raw.type === "personal") return { type: "personal" }
  if (raw.type === "project" && typeof raw.projectID === "string" && raw.projectID) {
    return { type: "project", projectID: raw.projectID }
  }
  return fallback
}

function normalizeFolder(raw: unknown): CinemaAssetFolder | null {
  if (!isRecord(raw)) return null
  const id = stringValue(raw.id)
  const name = stringValue(raw.name)
  if (!id || !name) return null
  return raw as unknown as CinemaAssetFolder
}

function normalizeAsset(raw: unknown): CinemaAssetRecord | null {
  if (!isRecord(raw)) return null
  const id = stringValue(raw.id)
  const displayName = stringValue(raw.displayName)
  if (!id || !displayName || !["image", "video", "audio"].includes(stringValue(raw.kind))) return null
  return raw as unknown as CinemaAssetRecord
}

export function normalizeAssetLibraryEntry(raw: unknown): AssetLibraryEntry | null {
  if (!isRecord(raw)) return null
  if (raw.entryType === "folder") {
    const folder = normalizeFolder(raw.folder ?? Object.fromEntries(
      Object.entries(raw).filter(([key]) => key !== "entryType"),
    ))
    return folder ? { entryType: "folder", folder } : null
  }
  if (raw.entryType === "asset") {
    const asset = normalizeAsset(raw.asset ?? Object.fromEntries(
      Object.entries(raw).filter(([key]) => key !== "entryType"),
    ))
    return asset ? { entryType: "asset", asset } : null
  }
  return null
}

function normalizeBreadcrumbs(raw: unknown, folder?: CinemaAssetFolder): AssetLibraryBreadcrumb[] {
  if (!Array.isArray(raw)) {
    return folder ? [{ id: folder.id, name: folder.name }] : []
  }
  return raw.flatMap((candidate) => {
    if (!isRecord(candidate)) return []
    const id = stringValue(candidate.id ?? candidate.folderID)
    const name = stringValue(candidate.name ?? candidate.displayName)
    return id && name ? [{ id, name }] : []
  })
}

function normalizeState(raw: unknown, fallbackScope: CinemaAssetScope): AssetLibraryState {
  if (!isRecord(raw)) throw new AssetLibraryApiError("素材库状态响应无效", 500)
  const statusValue = raw.status ?? raw.health
  const status = statusValue === "recovery-required" ? "recovery-required" : "ready"
  const rawCounts = isRecord(raw.counts) ? raw.counts : {}
  const rawDefaults = isRecord(raw.defaultFolderIDs) ? raw.defaultFolderIDs : {}
  const rawLimits = isRecord(raw.limits) ? raw.limits : {}
  return {
    scope: normalizeScope(raw.scope, fallbackScope),
    revision: finiteNumber(raw.revision),
    status,
    readOnly: raw.readOnly === true || status !== "ready",
    rootFolderID: stringValue(raw.rootFolderID, "root"),
    counts: {
      folders: finiteNumber(rawCounts.folders),
      assets: finiteNumber(rawCounts.assets),
      processing: finiteNumber(rawCounts.processing),
      failed: finiteNumber(rawCounts.failed),
      missing: finiteNumber(rawCounts.missing),
      trashed: finiteNumber(rawCounts.trashed),
    },
    defaultFolderIDs: Object.fromEntries(
      Object.entries(rawDefaults).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    limits: {
      maxFolderDepth: optionalNumber(rawLimits.maxFolderDepth) ?? CINEMA_ASSET_MAX_FOLDER_DEPTH,
      maxImageBytes: optionalNumber(rawLimits.maxImageBytes, rawLimits.image) ?? CINEMA_ASSET_MAX_IMAGE_BYTES,
      maxVideoBytes: optionalNumber(rawLimits.maxVideoBytes, rawLimits.video) ?? CINEMA_ASSET_MAX_VIDEO_BYTES,
      maxAudioBytes: optionalNumber(rawLimits.maxAudioBytes, rawLimits.audio) ?? CINEMA_ASSET_MAX_AUDIO_BYTES,
    },
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  }
}

function normalizeListing(
  raw: unknown,
  scope: CinemaAssetScope,
  requestedFolderID: string,
  query: string,
): AssetLibraryListing {
  if (!isRecord(raw)) throw new AssetLibraryApiError("素材库列表响应无效", 500)
  const folder = normalizeFolder(raw.folder) ?? undefined
  const entries = Array.isArray(raw.entries)
    ? sortAssetLibraryEntries(raw.entries.flatMap((entry) => {
      const normalized = normalizeAssetLibraryEntry(entry)
      return normalized ? [normalized] : []
    }))
    : []
  return {
    scope: normalizeScope(raw.scope, scope),
    revision: finiteNumber(raw.revision),
    folderID: stringValue(raw.folderID, folder?.id ?? requestedFolderID),
    folder,
    breadcrumbs: normalizeBreadcrumbs(raw.breadcrumbs, folder),
    query: stringValue(raw.query, query),
    entries,
    nextCursor: typeof raw.nextCursor === "string" && raw.nextCursor ? raw.nextCursor : undefined,
    total: typeof raw.total === "number" ? raw.total : undefined,
  }
}

function normalizeMutation(raw: unknown, fallbackScope: CinemaAssetScope): AssetLibraryMutationResult {
  if (!isRecord(raw)) throw new AssetLibraryApiError("素材库操作响应无效", 500)
  const affected: CinemaAssetEntryTarget[] = []
  if (Array.isArray(raw.affected)) {
    for (const target of raw.affected) {
      if (!isRecord(target)) continue
      if (target.entryType === "folder" && typeof target.folderID === "string") {
        affected.push({ entryType: "folder", folderID: target.folderID })
      } else if (target.entryType === "asset" && typeof target.assetID === "string") {
        affected.push({ entryType: "asset", assetID: target.assetID })
      }
    }
  }
  return {
    scope: normalizeScope(raw.scope, fallbackScope),
    operationID: stringValue(raw.operationID, "unknown-operation"),
    revision: finiteNumber(raw.revision),
    affected,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings.filter((warning): warning is string => typeof warning === "string")
      : [],
  }
}

function normalizePendingDelete(raw: unknown, fallbackScope: CinemaAssetScope): AssetLibraryPendingDeleteResult {
  const mutation = normalizeMutation(raw, fallbackScope)
  const undoUntil = isRecord(raw) ? stringValue(raw.undoUntil) : ""
  if (!undoUntil || Number.isNaN(Date.parse(undoUntil))) {
    throw new AssetLibraryApiError("删除响应缺少有效的撤销截止时间", 500)
  }
  return { ...mutation, undoUntil }
}

function normalizeMigrationStatus(raw: unknown): CinemaAssetMigrationStatusResult {
  const parsed = CinemaAssetMigrationStatusResultSchema.safeParse(raw)
  if (!parsed.success) throw new AssetLibraryApiError("素材迁移状态响应无效", 500)
  return parsed.data
}

function normalizeMigrationResult(raw: unknown): CinemaAssetMigrationResult {
  const parsed = CinemaAssetMigrationResultSchema.safeParse(raw)
  if (!parsed.success) throw new AssetLibraryApiError("素材迁移响应无效", 500)
  return parsed.data
}

function mutationBody(baseRevision: number, operationID: string, body: JsonRecord = {}): string {
  return JSON.stringify({ ...body, operationID, baseRevision })
}

function jsonRequest(method: string, body: string): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body,
  }
}

export interface AssetLibraryApi {
  readonly scope: CinemaAssetScope
  readonly scopeKey: string
  readonly requestKey: string
  getState(signal?: AbortSignal): Promise<AssetLibraryState>
  getMigration(signal?: AbortSignal): Promise<CinemaAssetMigrationStatusResult | null>
  startMigration(options: {
    candidateIDs: string[]
    operationID: string
    baseRevision: number
  }): Promise<CinemaAssetMigrationResult>
  listEntries(options: {
    folderID: string
    query?: string
    cursor?: string
    limit?: number
    signal?: AbortSignal
  }): Promise<AssetLibraryListing>
  getAsset(assetID: string, signal?: AbortSignal): Promise<{ revision: number; asset: CinemaAssetRecord }>
  createFolder(options: { name: string; parentFolderID: string; operationID: string; baseRevision: number }): Promise<{ revision: number; folder: CinemaAssetFolder }>
  renameFolder(options: { folderID: string; name: string; operationID: string; baseRevision: number }): Promise<{ revision: number; folder: CinemaAssetFolder }>
  renameAsset(options: { assetID: string; baseName: string; operationID: string; baseRevision: number }): Promise<{ revision: number; asset: CinemaAssetRecord }>
  move(options: { entries: AssetLibraryEntryRef[]; destinationFolderID: string; operationID: string; baseRevision: number }): Promise<AssetLibraryMutationResult>
  beginDelete(options: { entries: AssetLibraryEntryRef[]; operationID: string; baseRevision: number }): Promise<AssetLibraryPendingDeleteResult>
  undoDelete(options: { entries: AssetLibraryEntryRef[]; operationID: string; baseRevision: number }): Promise<AssetLibraryMutationResult>
  finalizeDelete(options: AssetLibraryFinalizeDeleteOptions): Promise<AssetLibraryMutationResult>
  retryProcessing(options: { assetID: string; operationID: string; baseRevision: number }): Promise<{ revision: number; asset: CinemaAssetRecord }>
  reconcile(options: { full: boolean; operationID: string; baseRevision: number }): Promise<AssetLibraryMutationResult>
  upload(options: AssetLibraryUploadOptions): Promise<AssetLibraryUploadResult>
  assetContentURL(assetID: string, contentRevision: number): string
  assetThumbnailURL(assetID: string, contentRevision: number): string
  assetPreviewURL(assetID: string, contentRevision: number): string
}

export function createAssetLibraryApi(
  agentBaseURL: string,
  projectID: string,
  scope: CinemaAssetScope,
): AssetLibraryApi {
  const scopedProjectID = scope.type === "project" ? scope.projectID : projectID
  const prefix = scope.type === "personal"
    ? "/api/cinema/personal-library"
    : `/api/cinema/projects/${encodeURIComponent(scopedProjectID)}/library`
  const url = (pathname: string) => resolveCinemaRuntimeURL(agentBaseURL, `${prefix}${pathname}`)
  const data = <T>(pathname: string, init?: RequestInit) => requestData<T>(agentBaseURL, `${prefix}${pathname}`, init)
  const versionedURL = (pathname: string, contentRevision: number) => {
    const target = new URL(url(pathname))
    target.searchParams.set("v", String(contentRevision))
    return target.toString()
  }

  return {
    scope,
    scopeKey: assetLibraryScopeKey(scope),
    requestKey: url(""),
    getState: async (signal) => normalizeState(await data<unknown>("/state", { signal }), scope),
    getMigration: async (signal) => scope.type === "project"
      ? normalizeMigrationStatus(await data<unknown>("/migration", { signal }))
      : null,
    startMigration: async ({ candidateIDs, operationID, baseRevision }) => {
      if (scope.type !== "project") {
        throw new AssetLibraryApiError("个人素材库不需要项目迁移", 400)
      }
      return normalizeMigrationResult(await data<unknown>(
        "/migration",
        jsonRequest("POST", mutationBody(baseRevision, operationID, { candidateIDs })),
      ))
    },
    listEntries: async ({ folderID, query = "", cursor, limit = 50, signal }) => {
      const params = new URLSearchParams({ folderID, limit: String(Math.min(100, Math.max(1, limit))) })
      if (query) params.set("q", query)
      if (cursor) params.set("cursor", cursor)
      return normalizeListing(await data<unknown>(`/entries?${params}`, { signal }), scope, folderID, query)
    },
    getAsset: async (assetID, signal) => {
      const raw = await data<unknown>(`/assets/${encodeURIComponent(assetID)}`, { signal })
      if (!isRecord(raw)) throw new AssetLibraryApiError("素材详情响应无效", 500)
      const asset = normalizeAsset(raw.asset ?? raw)
      if (!asset) throw new AssetLibraryApiError("素材详情响应缺少素材", 500)
      return { revision: finiteNumber(raw.revision), asset }
    },
    createFolder: async ({ name, parentFolderID, operationID, baseRevision }) => {
      const raw = await data<unknown>("/folders", jsonRequest("POST", mutationBody(baseRevision, operationID, { name, parentFolderID })))
      if (!isRecord(raw)) throw new AssetLibraryApiError("新建文件夹响应无效", 500)
      const folder = normalizeFolder(raw.folder)
      if (!folder) throw new AssetLibraryApiError("新建文件夹响应缺少文件夹", 500)
      return { revision: finiteNumber(raw.revision), folder }
    },
    renameFolder: async ({ folderID, name, operationID, baseRevision }) => {
      const raw = await data<unknown>(`/folders/${encodeURIComponent(folderID)}`, jsonRequest("PATCH", mutationBody(baseRevision, operationID, { name })))
      if (!isRecord(raw)) throw new AssetLibraryApiError("重命名响应无效", 500)
      const folder = normalizeFolder(raw.folder)
      if (!folder) throw new AssetLibraryApiError("重命名响应缺少文件夹", 500)
      return { revision: finiteNumber(raw.revision), folder }
    },
    renameAsset: async ({ assetID, baseName, operationID, baseRevision }) => {
      const raw = await data<unknown>(`/assets/${encodeURIComponent(assetID)}`, jsonRequest("PATCH", mutationBody(baseRevision, operationID, { baseName })))
      if (!isRecord(raw)) throw new AssetLibraryApiError("重命名响应无效", 500)
      const asset = normalizeAsset(raw.asset ?? raw)
      if (!asset) throw new AssetLibraryApiError("重命名响应缺少素材", 500)
      return { revision: finiteNumber(raw.revision), asset }
    },
    move: async ({ entries, destinationFolderID, operationID, baseRevision }) => normalizeMutation(await data<unknown>(
      "/moves",
      jsonRequest("POST", mutationBody(baseRevision, operationID, { entries, destinationFolderID })),
    ), scope),
    beginDelete: async ({ entries, operationID, baseRevision }) => normalizePendingDelete(await data<unknown>(
      "/trash",
      jsonRequest("POST", mutationBody(baseRevision, operationID, { entries })),
    ), scope),
    undoDelete: async ({ entries, operationID, baseRevision }) => normalizeMutation(await data<unknown>(
      "/restore",
      jsonRequest("POST", mutationBody(baseRevision, operationID, { entries })),
    ), scope),
    finalizeDelete: async (options) => normalizeMutation(await data<unknown>(
      "/permanent-delete",
      jsonRequest(
        "POST",
        mutationBody(
          options.baseRevision,
          options.operationID,
          options.all === true ? { all: true } : { entries: options.entries },
        ),
      ),
    ), scope),
    retryProcessing: async ({ assetID, operationID, baseRevision }) => {
      const raw = await data<unknown>(
        `/assets/${encodeURIComponent(assetID)}/retry-processing`,
        jsonRequest("POST", mutationBody(baseRevision, operationID)),
      )
      if (!isRecord(raw)) throw new AssetLibraryApiError("重试响应无效", 500)
      const asset = normalizeAsset(raw.asset ?? raw)
      if (!asset) throw new AssetLibraryApiError("重试响应缺少素材", 500)
      return { revision: finiteNumber(raw.revision), asset }
    },
    reconcile: async ({ full, operationID, baseRevision }) => normalizeMutation(await data<unknown>(
      "/reconcile",
      jsonRequest("POST", mutationBody(baseRevision, operationID, { full })),
    ), scope),
    upload: (options) => uploadAsset(url("/uploads"), options),
    assetContentURL: (assetID, contentRevision) => versionedURL(`/assets/${encodeURIComponent(assetID)}/content`, contentRevision),
    assetThumbnailURL: (assetID, contentRevision) => versionedURL(`/assets/${encodeURIComponent(assetID)}/thumbnail`, contentRevision),
    assetPreviewURL: (assetID, contentRevision) => versionedURL(`/assets/${encodeURIComponent(assetID)}/preview`, contentRevision),
  }
}

function uploadAsset(url: string, options: AssetLibraryUploadOptions): Promise<AssetLibraryUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append("file", options.file, options.file.name)
    formData.append("fileName", options.file.name)
    formData.append("folderID", options.folderID)
    formData.append("operationID", options.operationID)
    formData.append("baseRevision", String(options.baseRevision))
    if (options.source && options.source !== "upload") formData.append("source", options.source)

    const abort = () => xhr.abort()
    options.signal?.addEventListener("abort", abort, { once: true })
    xhr.open("POST", url)
    applyCinemaRuntimeXHRHeaders(xhr, "POST")
    xhr.responseType = "json"
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) options.onProgress?.(Math.min(1, event.loaded / event.total))
    })
    xhr.addEventListener("load", () => {
      options.signal?.removeEventListener("abort", abort)
      const body = xhr.response as unknown
      const envelope = isRecord(body) ? body : null
      if (xhr.status < 200 || xhr.status >= 300 || envelope?.success === false) {
        const error = envelope && isRecord(envelope.error) ? envelope.error : null
        const errorData = error && isRecord(error.data) ? error.data : null
        const revision = finiteNumber(errorData?.latestRevision ?? error?.latestRevision, Number.NaN)
        reject(new AssetLibraryApiError(
          stringValue(error?.message, `Upload failed (${xhr.status})`),
          xhr.status,
          Number.isFinite(revision) ? revision : undefined,
          stringValue(error?.code) || undefined,
        ))
        return
      }
      const raw = envelope?.success === true ? envelope.data : body
      if (!isRecord(raw)) {
        reject(new AssetLibraryApiError("上传响应无效", xhr.status))
        return
      }
      const uploadItems = Array.isArray(raw.items) ? raw.items : []
      const firstItem = uploadItems.find((item) => isRecord(item) && item.fileName === options.file.name)
        ?? uploadItems[0]
      if (isRecord(firstItem) && firstItem.success === false) {
        const uploadError = isRecord(firstItem.error) ? firstItem.error : null
        reject(new AssetLibraryApiError(
          stringValue(uploadError?.message, "上传失败"),
          xhr.status,
          undefined,
          stringValue(uploadError?.code) || undefined,
        ))
        return
      }
      const asset = normalizeAsset(isRecord(firstItem) ? firstItem.asset : raw.asset ?? raw)
      if (!asset) {
        reject(new AssetLibraryApiError("上传响应缺少素材", xhr.status))
        return
      }
      resolve({ revision: finiteNumber(raw.revision), asset })
    })
    xhr.addEventListener("error", () => {
      options.signal?.removeEventListener("abort", abort)
      reject(new AssetLibraryApiError("无法连接素材库服务", 0))
    })
    xhr.addEventListener("abort", () => {
      options.signal?.removeEventListener("abort", abort)
      reject(new DOMException("Upload canceled", "AbortError"))
    })
    xhr.send(formData)
  })
}
