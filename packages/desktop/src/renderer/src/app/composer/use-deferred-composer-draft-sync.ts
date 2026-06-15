import { useCallback, useEffect, useRef } from "react"
import type { ComposerDraftState } from "../types"

export const COMPOSER_DRAFT_SYNC_DEBOUNCE_MS = 180

interface DeferredComposerDraftSyncOptions {
  debounceMs?: number
  draftKey?: string | null
  onSync: (draftKey: string, draftState: ComposerDraftState) => void
}

export function useDeferredComposerDraftSync({
  debounceMs = COMPOSER_DRAFT_SYNC_DEBOUNCE_MS,
  draftKey,
  onSync,
}: DeferredComposerDraftSyncOptions) {
  const latestOnSyncRef = useRef(onSync)
  const pendingDraftRef = useRef<{
    draftKey: string
    draftState: ComposerDraftState
  } | null>(null)
  const timerRef = useRef<number | null>(null)

  latestOnSyncRef.current = onSync

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const flushDraftSync = useCallback(() => {
    clearTimer()

    const pendingDraft = pendingDraftRef.current
    if (!pendingDraft) return null

    pendingDraftRef.current = null
    latestOnSyncRef.current(pendingDraft.draftKey, pendingDraft.draftState)
    return pendingDraft
  }, [clearTimer])

  const scheduleDraftSync = useCallback((draftState: ComposerDraftState) => {
    if (!draftKey) return

    pendingDraftRef.current = {
      draftKey,
      draftState,
    }

    clearTimer()
    if (debounceMs <= 0) {
      flushDraftSync()
      return
    }

    timerRef.current = window.setTimeout(flushDraftSync, debounceMs)
  }, [clearTimer, debounceMs, draftKey, flushDraftSync])

  useEffect(() => {
    return () => {
      flushDraftSync()
    }
  }, [draftKey, flushDraftSync])

  useEffect(() => {
    window.addEventListener("pointerdown", flushDraftSync, true)
    window.addEventListener("blur", flushDraftSync)

    return () => {
      window.removeEventListener("pointerdown", flushDraftSync, true)
      window.removeEventListener("blur", flushDraftSync)
    }
  }, [flushDraftSync])

  return {
    flushDraftSync,
    scheduleDraftSync,
  }
}
