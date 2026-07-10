import type { Root } from "hast"

export const THREAD_MARKDOWN_PIPELINE_VERSION = "1"
export const THREAD_COMPLETED_MARKDOWN_SYNC_CHARACTER_LIMIT = 16_000
export const THREAD_COMPLETED_MARKDOWN_AUTO_CHARACTER_LIMIT = 256_000
export const THREAD_MARKDOWN_BLOCK_TARGET_CHARACTER_COUNT = 8_000
export const THREAD_MARKDOWN_OVERSIZED_BLOCK_NODE_COUNT = 8_000
export const THREAD_MARKDOWN_OVERSIZED_BLOCK_CHARACTER_COUNT = 256_000

export type MarkdownHastRoot = Root
export type MarkdownPipelineVersion = string

export interface MarkdownBlockManifest {
  atomic: boolean
  characterCount: number
  id: string
  index: number
  nodeCount: number
  oversized: boolean
  previewText: string
}

export interface MarkdownDocumentManifest {
  blocks: MarkdownBlockManifest[]
  characterCount: number
  documentID: string
  nodeCount: number
  parseMilliseconds?: number
  pipelineVersion: MarkdownPipelineVersion
}

export interface MarkdownWorkerParseRequest {
  documentID: string
  requestID: string
  text: string
  type: "parse"
}

export interface MarkdownWorkerLoadBlockRequest {
  blockIndex: number
  documentID: string
  requestID: string
  type: "load-block"
}

export interface MarkdownWorkerDisposeRequest {
  documentID: string
  type: "dispose"
}

export type MarkdownWorkerRequest =
  | MarkdownWorkerParseRequest
  | MarkdownWorkerLoadBlockRequest
  | MarkdownWorkerDisposeRequest

export type ThreadMarkdownWorkerRequest = MarkdownWorkerRequest

export interface MarkdownWorkerDocumentReadyResponse {
  documentID: string
  manifest: MarkdownDocumentManifest
  requestID: string
  type: "document-ready"
}

export interface MarkdownWorkerBlockReadyResponse {
  block: MarkdownHastRoot
  blockIndex: number
  documentID: string
  requestID: string
  type: "block-ready"
}

export interface MarkdownWorkerErrorResponse {
  blockIndex?: number
  documentID?: string
  message: string
  operation: "parse" | "load-block" | "worker"
  requestID?: string
  type: "error"
}

export type MarkdownWorkerResponse =
  | MarkdownWorkerDocumentReadyResponse
  | MarkdownWorkerBlockReadyResponse
  | MarkdownWorkerErrorResponse

export type ThreadMarkdownWorkerResponse = MarkdownWorkerResponse

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

function isBlockIndex(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function isMarkdownBlockManifest(value: unknown): value is MarkdownBlockManifest {
  if (!isRecord(value)) return false

  return (
    typeof value.atomic === "boolean" &&
    typeof value.characterCount === "number" &&
    isNonEmptyString(value.id) &&
    isBlockIndex(value.index) &&
    typeof value.nodeCount === "number" &&
    typeof value.oversized === "boolean" &&
    typeof value.previewText === "string"
  )
}

function isMarkdownDocumentManifest(value: unknown): value is MarkdownDocumentManifest {
  if (!isRecord(value) || !Array.isArray(value.blocks)) return false

  return (
    value.blocks.every(isMarkdownBlockManifest) &&
    typeof value.characterCount === "number" &&
    isNonEmptyString(value.documentID) &&
    typeof value.nodeCount === "number" &&
    isNonEmptyString(value.pipelineVersion)
  )
}

function isMarkdownHastRoot(value: unknown): value is MarkdownHastRoot {
  return isRecord(value) && value.type === "root" && Array.isArray(value.children)
}

export function isMarkdownWorkerRequest(value: unknown): value is MarkdownWorkerRequest {
  if (!isRecord(value) || typeof value.type !== "string") return false

  if (value.type === "parse") {
    return (
      isNonEmptyString(value.documentID) &&
      isNonEmptyString(value.requestID) &&
      typeof value.text === "string"
    )
  }

  if (value.type === "load-block") {
    return (
      isBlockIndex(value.blockIndex) &&
      isNonEmptyString(value.documentID) &&
      isNonEmptyString(value.requestID)
    )
  }

  if (value.type === "dispose") {
    return isNonEmptyString(value.documentID)
  }

  return false
}

export function isMarkdownWorkerResponse(value: unknown): value is MarkdownWorkerResponse {
  if (!isRecord(value) || typeof value.type !== "string") return false

  if (value.type === "document-ready") {
    return (
      isNonEmptyString(value.documentID) &&
      isMarkdownDocumentManifest(value.manifest) &&
      isNonEmptyString(value.requestID)
    )
  }

  if (value.type === "block-ready") {
    return (
      isMarkdownHastRoot(value.block) &&
      isBlockIndex(value.blockIndex) &&
      isNonEmptyString(value.documentID) &&
      isNonEmptyString(value.requestID)
    )
  }

  if (value.type === "error") {
    return (
      (value.blockIndex === undefined || isBlockIndex(value.blockIndex)) &&
      (value.documentID === undefined || isNonEmptyString(value.documentID)) &&
      typeof value.message === "string" &&
      (value.operation === "parse" || value.operation === "load-block" || value.operation === "worker") &&
      (value.requestID === undefined || isNonEmptyString(value.requestID))
    )
  }

  return false
}
