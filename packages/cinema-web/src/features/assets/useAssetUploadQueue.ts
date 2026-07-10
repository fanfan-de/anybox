import { useCallback, useEffect, useRef, useState } from "react"
import type { CinemaAssetRecord } from "@anybox/shared"
import {
  AssetLibraryApiError,
  type AssetLibraryApi,
} from "./assetLibraryApi"

export type AssetUploadQueueStatus = "queued" | "uploading" | "succeeded" | "failed" | "canceled"

export interface AssetUploadQueueItem {
  id: string
  operationID: string
  file: File
  folderID: string
  status: AssetUploadQueueStatus
  progress: number
  attempts: number
  error?: string
  asset?: CinemaAssetRecord
}

export interface AssetUploadQueueController {
  items: AssetUploadQueueItem[]
  enqueue(files: Iterable<File>, folderID: string): void
  cancel(itemID: string): void
  retry(itemID: string): void
  clearSettled(): void
}

export interface UseAssetUploadQueueOptions {
  api: AssetLibraryApi
  revision: number
  concurrency?: number
  onRevision(revision: number): void
  onUploaded?(asset: CinemaAssetRecord): void
}

function createID(prefix: string): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${suffix}`
}

function uploadErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "上传已取消"
  return error instanceof Error ? error.message : "上传失败"
}

export function useAssetUploadQueue({
  api,
  revision,
  concurrency = 3,
  onRevision,
  onUploaded,
}: UseAssetUploadQueueOptions): AssetUploadQueueController {
  const [items, setItems] = useState<AssetUploadQueueItem[]>([])
  const itemsRef = useRef(items)
  const latestRevisionRef = useRef(revision)
  const activeRef = useRef(new Map<string, AbortController>())
  const onRevisionRef = useRef(onRevision)
  const onUploadedRef = useRef(onUploaded)

  itemsRef.current = items
  latestRevisionRef.current = Math.max(latestRevisionRef.current, revision)
  onRevisionRef.current = onRevision
  onUploadedRef.current = onUploaded

  useEffect(() => {
    const active = activeRef.current
    latestRevisionRef.current = revision
    setItems([])
    return () => {
      for (const controller of active.values()) controller.abort()
      active.clear()
    }
  }, [api.scopeKey])

  useEffect(() => {
    const maxConcurrency = Math.min(3, Math.max(1, concurrency))
    const available = maxConcurrency - activeRef.current.size
    if (available <= 0) return
    const pending = items.filter((item) => item.status === "queued").slice(0, available)
    for (const item of pending) {
      const controller = new AbortController()
      activeRef.current.set(item.id, controller)
      setItems((current) => current.map((candidate) => candidate.id === item.id
        ? { ...candidate, status: "uploading", progress: 0, error: undefined }
        : candidate))

      void api.upload({
        file: item.file,
        folderID: item.folderID,
        operationID: item.operationID,
        baseRevision: latestRevisionRef.current,
        signal: controller.signal,
        onProgress: (progress) => setItems((current) => current.map((candidate) => candidate.id === item.id
          ? { ...candidate, progress }
          : candidate)),
      }).then((result) => {
        latestRevisionRef.current = Math.max(latestRevisionRef.current, result.revision)
        onRevisionRef.current(result.revision)
        onUploadedRef.current?.(result.asset)
        setItems((current) => current.map((candidate) => candidate.id === item.id
          ? { ...candidate, status: "succeeded", progress: 1, asset: result.asset, error: undefined }
          : candidate))
      }).catch(async (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          setItems((current) => current.map((candidate) => candidate.id === item.id
            ? { ...candidate, status: "canceled", error: undefined }
            : candidate))
          return
        }

        const latestItem = itemsRef.current.find((candidate) => candidate.id === item.id)
        const attempts = (latestItem?.attempts ?? item.attempts) + 1
        if (error instanceof AssetLibraryApiError && error.status === 409 && attempts <= 5) {
          try {
            const state = await api.getState(controller.signal)
            latestRevisionRef.current = Math.max(latestRevisionRef.current, state.revision)
            onRevisionRef.current(state.revision)
            setItems((current) => current.map((candidate) => candidate.id === item.id
              ? { ...candidate, status: "queued", attempts, progress: 0, error: undefined }
              : candidate))
            return
          } catch (stateError) {
            if (stateError instanceof DOMException && stateError.name === "AbortError") return
          }
        }

        setItems((current) => current.map((candidate) => candidate.id === item.id
          ? { ...candidate, status: "failed", attempts, error: uploadErrorMessage(error) }
          : candidate))
      }).finally(() => {
        activeRef.current.delete(item.id)
        setItems((current) => [...current])
      })
    }
  }, [api, concurrency, items])

  const enqueue = useCallback((files: Iterable<File>, folderID: string) => {
    const nextItems = Array.from(files, (file): AssetUploadQueueItem => ({
      id: createID("upload"),
      operationID: createID("asset-upload"),
      file,
      folderID,
      status: "queued",
      progress: 0,
      attempts: 0,
    }))
    if (nextItems.length > 0) setItems((current) => [...current, ...nextItems])
  }, [])

  const cancel = useCallback((itemID: string) => {
    const controller = activeRef.current.get(itemID)
    if (controller) controller.abort()
    else setItems((current) => current.map((item) => item.id === itemID && item.status === "queued"
      ? { ...item, status: "canceled" }
      : item))
  }, [])

  const retry = useCallback((itemID: string) => {
    setItems((current) => current.map((item) => item.id === itemID && ["failed", "canceled"].includes(item.status)
      ? {
          ...item,
          operationID: createID("asset-upload"),
          status: "queued",
          progress: 0,
          attempts: 0,
          error: undefined,
        }
      : item))
  }, [])

  const clearSettled = useCallback(() => {
    setItems((current) => current.filter((item) => !["succeeded", "canceled"].includes(item.status)))
  }, [])

  return { items, enqueue, cancel, retry, clearSettled }
}
