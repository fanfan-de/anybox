export type CinemaAssetKind = "image" | "video" | "audio"

export type CinemaAssetLibraryEntriesView = "library" | "trash"

export type CinemaAssetStatus =
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "missing"
  | "trashed"

export type CinemaAssetScope =
  | { type: "project"; projectID: string }
  | { type: "personal" }

export type CinemaAssetSource =
  | "upload"
  | "generation"
  | "crop"
  | "render"
  | "migration"
  | "discovered"

export interface CinemaAssetTrashLocation {
  operationID: string
  originalFolderID: string
  originalRelativePath: string
  trashedRelativePath: string
  trashedAt: string
  expiresAt?: string
  previousStatus?: "ready" | "failed" | "missing"
}

export interface CinemaAssetRecord {
  id: string
  folderID: string
  relativePath: string
  displayName: string
  kind: CinemaAssetKind
  source: CinemaAssetSource
  status: CinemaAssetStatus
  mimeType: string
  sizeBytes: number
  checksum: string
  /**
   * Internal filesystem identity captured from stat(2). It is deliberately
   * optional because older catalogs do not contain it and some filesystems do
   * not expose a useful inode. API consumers must continue to use `id` as the
   * stable public identity.
   */
  fileIdentity?: string
  width?: number
  height?: number
  durationSeconds?: number
  fps?: number
  hasAudio?: boolean
  thumbnailPath?: string
  previewPath?: string
  contentRevision: number
  createdAt: string
  updatedAt: string
  failureReason?: string
  trash?: CinemaAssetTrashLocation
}

export interface CinemaAssetFolderTrashLocation {
  operationID: string
  originalParentID: string
  originalRelativePath: string
  trashedRelativePath: string
  trashedAt: string
  expiresAt?: string
}

export interface CinemaAssetFolder {
  id: string
  parentID: string | null
  name: string
  relativePath: string
  depth: number
  system: boolean
  status: "active" | "trashed" | "missing"
  createdAt: string
  updatedAt: string
  trash?: CinemaAssetFolderTrashLocation
}

export interface CinemaAssetLibraryOperation {
  operationID: string
  type: string
  revision: number
  completedAt: string
  result: unknown
}

export interface CinemaAssetCatalog {
  schemaVersion: 1
  scope: CinemaAssetScope
  revision: number
  status: "ready" | "recovery-required"
  rootFolderID: string
  folders: CinemaAssetFolder[]
  assets: CinemaAssetRecord[]
  completedOperationIDs: string[]
  operations: Record<string, CinemaAssetLibraryOperation>
  createdAt: string
  updatedAt: string
}

export type CinemaAssetLibraryEntryRef = {
  entryType: "folder"
  folderID: string
} | {
  entryType: "asset"
  assetID: string
}

export type CinemaAssetLibraryEntry =
  | { entryType: "folder"; folder: CinemaAssetFolder }
  | { entryType: "asset"; asset: CinemaAssetRecord }

export interface CinemaAssetLibraryPaths {
  scope: CinemaAssetScope
  scopeKey: string
  managedRoot: string
  filesRoot: string
  catalogPath: string
  operationsRoot: string
}

export interface CinemaAssetLibraryMutationInput {
  operationID: string
  baseRevision: number
}

export const CINEMA_ASSET_LIBRARY_ROOT_FOLDER_ID = "root"
export const CINEMA_ASSET_LIBRARY_SCHEMA_VERSION = 1 as const
export const CINEMA_ASSET_LIBRARY_MAX_FOLDER_DEPTH = 8
export const CINEMA_ASSET_LIBRARY_DEFAULT_PAGE_SIZE = 50
export const CINEMA_ASSET_LIBRARY_MAX_PAGE_SIZE = 100

export const CINEMA_ASSET_LIBRARY_LIMITS = {
  image: 25 * 1024 * 1024,
  video: 2 * 1024 * 1024 * 1024,
  audio: 512 * 1024 * 1024,
} as const
