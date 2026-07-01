import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react"

export interface ThreadScrollSnapshot {
  scrollTop: number
  pinnedToBottom: boolean
  updatedAt: number
}

export interface ThreadFollowScrollTarget {
  scrollTop: number
  visualScrollTop: number
}

type ThreadScrollMode = "follow" | "detached"

interface ThreadSmoothFollowScroll {
  duration: number
  frameID: number | null
  fromScrollTop: number
  key: string
  startedAt: number
  targetScrollTop: number
}

interface UseThreadScrollControllerInput {
  getLatestThreadContentScrollTarget: (
    threadColumn: HTMLDivElement,
    options?: { skipStreamingResponseMeasurement?: boolean },
  ) => ThreadFollowScrollTarget
  isSidebarResizeInProgress: () => boolean
  readScrollSnapshot?: (key: string) => ThreadScrollSnapshot | null
  saveScrollSnapshot?: (key: string, snapshot: ThreadScrollSnapshot) => void
  scrollToThreadOffset?: (scrollTop: number) => void
  scrollStateKey: string
  threadColumnRef: RefObject<HTMLDivElement | null>
}

const THREAD_BOTTOM_LOCK_THRESHOLD_PX = 32
const THREAD_USER_SCROLL_INTENT_WINDOW_MS = 800
const THREAD_COMPLETION_SCROLL_SYNC_SUPPRESS_MS = 600
const THREAD_TOP_RESET_THRESHOLD_PX = 2
const THREAD_FOLLOW_SMOOTH_SCROLL_MIN_DELTA_PX = 6
const THREAD_FOLLOW_SMOOTH_SCROLL_MAX_DELTA_PX = 420
const THREAD_FOLLOW_SMOOTH_SCROLL_MIN_DURATION_MS = 90
const THREAD_FOLLOW_SMOOTH_SCROLL_MAX_DURATION_MS = 220
const THREAD_FOLLOW_SMOOTH_SCROLL_PX_PER_MS = 2.4

const threadScrollSnapshots = new Map<string, ThreadScrollSnapshot>()

function isThreadColumnPinnedToBottom(threadColumn: HTMLDivElement) {
  return threadColumn.scrollHeight - threadColumn.scrollTop - threadColumn.clientHeight <= THREAD_BOTTOM_LOCK_THRESHOLD_PX
}

function getThreadScrollMaxTop(threadColumn: HTMLDivElement) {
  return Math.max(0, threadColumn.scrollHeight - threadColumn.clientHeight)
}

function easeThreadFollowScroll(progress: number) {
  return 1 - Math.pow(1 - progress, 3)
}

function getThreadSmoothFollowScrollDuration(delta: number) {
  return Math.min(
    THREAD_FOLLOW_SMOOTH_SCROLL_MAX_DURATION_MS,
    Math.max(THREAD_FOLLOW_SMOOTH_SCROLL_MIN_DURATION_MS, delta / THREAD_FOLLOW_SMOOTH_SCROLL_PX_PER_MS),
  )
}

function prefersReducedThreadMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

function clampThreadScrollTop(threadColumn: HTMLDivElement, scrollTop: number) {
  return Math.min(Math.max(0, scrollTop), getThreadScrollMaxTop(threadColumn))
}

function canRepresentThreadScrollTop(threadColumn: HTMLDivElement, scrollTop: number) {
  return getThreadScrollMaxTop(threadColumn) >= scrollTop - THREAD_TOP_RESET_THRESHOLD_PX
}

function readThreadScrollSnapshot(threadColumn: HTMLDivElement): ThreadScrollSnapshot {
  return {
    scrollTop: threadColumn.scrollTop,
    pinnedToBottom: isThreadColumnPinnedToBottom(threadColumn),
    updatedAt: Date.now(),
  }
}

function getRestorableThreadScrollSnapshot(snapshot: ThreadScrollSnapshot | null) {
  if (!snapshot) return null
  if (snapshot.pinnedToBottom || snapshot.scrollTop <= THREAD_TOP_RESET_THRESHOLD_PX) return null
  return snapshot
}

export function useThreadScrollController({
  getLatestThreadContentScrollTarget,
  isSidebarResizeInProgress,
  readScrollSnapshot,
  saveScrollSnapshot,
  scrollToThreadOffset,
  scrollStateKey,
  threadColumnRef,
}: UseThreadScrollControllerInput) {
  const scrollModeRef = useRef<ThreadScrollMode>("follow")
  const latestScrollSnapshotRef = useRef<ThreadScrollSnapshot | null>(null)
  const latestScrollSnapshotKeyRef = useRef<string | null>(null)
  const smoothFollowScrollRef = useRef<ThreadSmoothFollowScroll | null>(null)
  const lastUserScrollIntentAtRef = useRef(0)
  const lastUserScrollIntentDirectionRef = useRef<"up" | "down" | null>(null)
  const followScrollSyncSuppressedUntilRef = useRef(0)
  const userScrollIntentConsumedRef = useRef(false)
  const lastKnownScrollTopRef = useRef(0)
  const currentScrollStateKeyRef = useRef<string | null>(null)

  function captureThreadScrollSnapshot(
    threadColumn: HTMLDivElement,
    key = scrollStateKey,
    mode: ThreadScrollMode = scrollModeRef.current,
  ) {
    const snapshot = {
      ...readThreadScrollSnapshot(threadColumn),
      pinnedToBottom: mode === "follow",
    }
    latestScrollSnapshotRef.current = snapshot
    latestScrollSnapshotKeyRef.current = key
    threadScrollSnapshots.set(key, snapshot)
    return snapshot
  }

  function rememberThreadScrollSnapshot(key: string, snapshot: ThreadScrollSnapshot) {
    latestScrollSnapshotRef.current = snapshot
    latestScrollSnapshotKeyRef.current = key
    threadScrollSnapshots.set(key, snapshot)
  }

  function readLatestThreadScrollSnapshotForKey(key = scrollStateKey) {
    return latestScrollSnapshotKeyRef.current === key ? latestScrollSnapshotRef.current : null
  }

  function readStoredThreadScrollSnapshot(key = scrollStateKey) {
    return readScrollSnapshot?.(key) ?? threadScrollSnapshots.get(key) ?? null
  }

  function persistThreadScrollSnapshot(
    key = scrollStateKey,
    mode: ThreadScrollMode = scrollModeRef.current,
  ) {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || !key) return

    const snapshot = captureThreadScrollSnapshot(threadColumn, key, mode)
    saveScrollSnapshot?.(key, snapshot)
  }

  function persistLatestThreadScrollSnapshot(key = scrollStateKey) {
    const snapshot = readLatestThreadScrollSnapshotForKey(key)
    if (!key || !snapshot) return false

    threadScrollSnapshots.set(key, snapshot)
    saveScrollSnapshot?.(key, snapshot)
    return true
  }

  function saveThreadScrollSnapshotValue(key: string, snapshot: ThreadScrollSnapshot) {
    if (!key) return

    threadScrollSnapshots.set(key, snapshot)
    saveScrollSnapshot?.(key, snapshot)
  }

  function cancelSmoothFollowScroll() {
    const frameID = smoothFollowScrollRef.current?.frameID ?? null
    smoothFollowScrollRef.current = null
    if (
      frameID !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(frameID)
    }
  }

  function rememberThreadTopScrollSnapshot(threadColumn: HTMLDivElement, key = scrollStateKey) {
    if (!key) return
    if (getThreadScrollMaxTop(threadColumn) <= THREAD_TOP_RESET_THRESHOLD_PX) return

    cancelSmoothFollowScroll()
    const snapshot: ThreadScrollSnapshot = {
      scrollTop: 0,
      pinnedToBottom: false,
      updatedAt: Date.now(),
    }
    scrollModeRef.current = "detached"
    lastKnownScrollTopRef.current = 0
    rememberThreadScrollSnapshot(key, snapshot)
    saveThreadScrollSnapshotValue(key, snapshot)
  }

  function detachThreadScrollFromFollow(threadColumn: HTMLDivElement, key = scrollStateKey) {
    if (!key) return false
    if (getThreadScrollMaxTop(threadColumn) <= THREAD_TOP_RESET_THRESHOLD_PX) return false

    cancelSmoothFollowScroll()
    const snapshot: ThreadScrollSnapshot = {
      ...readThreadScrollSnapshot(threadColumn),
      pinnedToBottom: false,
    }
    scrollModeRef.current = "detached"
    lastKnownScrollTopRef.current = threadColumn.scrollTop
    rememberThreadScrollSnapshot(key, snapshot)
    saveThreadScrollSnapshotValue(key, snapshot)
    return true
  }

  function setThreadScrollTop(
    threadColumn: HTMLDivElement,
    scrollTop: number,
    options: { clampToDomScrollRange?: boolean } = {},
  ) {
    const nextScrollTop = options.clampToDomScrollRange === false
      ? Math.max(0, scrollTop)
      : clampThreadScrollTop(threadColumn, scrollTop)
    if (scrollToThreadOffset) {
      scrollToThreadOffset(nextScrollTop)
    } else {
      threadColumn.scrollTop = nextScrollTop
    }
    lastKnownScrollTopRef.current = threadColumn.scrollTop
  }

  function scrollThreadColumnToLatestThreadContent(
    threadColumn: HTMLDivElement,
    options: { skipStreamingResponseMeasurement?: boolean } = {},
  ) {
    const target = getLatestThreadContentScrollTarget(threadColumn, options)
    setThreadScrollTop(threadColumn, target.scrollTop, { clampToDomScrollRange: false })
  }

  function scheduleSmoothFollowLatestThreadContent(threadColumn: HTMLDivElement, key = scrollStateKey) {
    if (isSidebarResizeInProgress()) return false

    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function" ||
      prefersReducedThreadMotion()
    ) {
      return false
    }

    const target = getLatestThreadContentScrollTarget(threadColumn)
    const delta = Math.abs(target.visualScrollTop - threadColumn.scrollTop)
    if (
      delta < THREAD_FOLLOW_SMOOTH_SCROLL_MIN_DELTA_PX ||
      delta > THREAD_FOLLOW_SMOOTH_SCROLL_MAX_DELTA_PX
    ) {
      return false
    }

    cancelSmoothFollowScroll()
    const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now()
    const animation: ThreadSmoothFollowScroll = {
      duration: getThreadSmoothFollowScrollDuration(delta),
      frameID: null,
      fromScrollTop: threadColumn.scrollTop,
      key,
      startedAt,
      targetScrollTop: target.visualScrollTop,
    }

    const pinnedSnapshot: ThreadScrollSnapshot = {
      scrollTop: target.visualScrollTop,
      pinnedToBottom: true,
      updatedAt: Date.now(),
    }
    scrollModeRef.current = "follow"
    rememberThreadScrollSnapshot(key, pinnedSnapshot)
    saveThreadScrollSnapshotValue(key, pinnedSnapshot)

    const step = (timestamp: number) => {
      if (smoothFollowScrollRef.current !== animation) return

      const currentThreadColumn = threadColumnRef.current
      if (
        !currentThreadColumn ||
        currentThreadColumn !== threadColumn ||
        currentScrollStateKeyRef.current !== key ||
        scrollModeRef.current !== "follow"
      ) {
        smoothFollowScrollRef.current = null
        return
      }

      const effectiveTimestamp = timestamp < animation.startedAt
        ? animation.startedAt + animation.duration
        : timestamp
      const progress = Math.min(1, Math.max(0, (effectiveTimestamp - animation.startedAt) / animation.duration))
      const easedProgress = easeThreadFollowScroll(progress)
      const nextScrollTop =
        animation.fromScrollTop +
        (animation.targetScrollTop - animation.fromScrollTop) * easedProgress
      setThreadScrollTop(currentThreadColumn, nextScrollTop)

      if (progress >= 1) {
        smoothFollowScrollRef.current = null
        persistThreadScrollSnapshot(key, "follow")
        return
      }

      animation.frameID = window.requestAnimationFrame(step)
    }

    smoothFollowScrollRef.current = animation
    animation.frameID = window.requestAnimationFrame(step)
    return true
  }

  function followLatestThreadContent(
    threadColumn: HTMLDivElement,
    key = scrollStateKey,
    options: { smooth?: boolean } = {},
  ) {
    scrollModeRef.current = "follow"
    const isResizingSidebar = isSidebarResizeInProgress()
    if (isResizingSidebar) {
      cancelSmoothFollowScroll()
      scrollThreadColumnToLatestThreadContent(threadColumn, { skipStreamingResponseMeasurement: true })
      lastKnownScrollTopRef.current = threadColumn.scrollTop
      persistThreadScrollSnapshot(key, "follow")
      return
    }

    if (options.smooth && scheduleSmoothFollowLatestThreadContent(threadColumn, key)) return

    cancelSmoothFollowScroll()
    scrollThreadColumnToLatestThreadContent(threadColumn)
    lastKnownScrollTopRef.current = threadColumn.scrollTop
    persistThreadScrollSnapshot(key, "follow")
  }

  function preserveCurrentFollowThreadPosition(threadColumn: HTMLDivElement, key = scrollStateKey) {
    cancelSmoothFollowScroll()
    scrollModeRef.current = "follow"
    lastKnownScrollTopRef.current = threadColumn.scrollTop
    persistThreadScrollSnapshot(key, "follow")
  }

  function restoreDetachedThreadPosition(
    threadColumn: HTMLDivElement,
    snapshot: ThreadScrollSnapshot,
    key = scrollStateKey,
  ) {
    cancelSmoothFollowScroll()
    scrollModeRef.current = "detached"
    if (!canRepresentThreadScrollTop(threadColumn, snapshot.scrollTop)) {
      rememberThreadScrollSnapshot(key, snapshot)
      return false
    }

    setThreadScrollTop(threadColumn, snapshot.scrollTop)
    persistThreadScrollSnapshot(key, "detached")
    return true
  }

  function restoreSavedThreadPosition(
    threadColumn: HTMLDivElement,
    snapshot: ThreadScrollSnapshot | null,
    key = scrollStateKey,
  ) {
    if (!snapshot || snapshot.pinnedToBottom) {
      followLatestThreadContent(threadColumn, key)
      return
    }

    restoreDetachedThreadPosition(threadColumn, snapshot, key)
  }

  function restoreDetachedThreadPositionIfNeeded(key = scrollStateKey) {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || currentScrollStateKeyRef.current !== key) return false
    if (scrollModeRef.current !== "detached") return false
    if (threadColumn.scrollTop > THREAD_TOP_RESET_THRESHOLD_PX) return false

    const snapshot =
      getRestorableThreadScrollSnapshot(readLatestThreadScrollSnapshotForKey(key)) ??
      getRestorableThreadScrollSnapshot(readStoredThreadScrollSnapshot(key))
    if (!snapshot) return false

    return restoreDetachedThreadPosition(threadColumn, snapshot, key)
  }

  function syncThreadScrollAfterContentChange(
    key = scrollStateKey,
    options: { preserveFollowPosition?: boolean; smoothFollow?: boolean } = {},
  ) {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || currentScrollStateKeyRef.current !== key) return

    if (scrollModeRef.current === "follow") {
      if (options.preserveFollowPosition || Date.now() <= followScrollSyncSuppressedUntilRef.current) {
        preserveCurrentFollowThreadPosition(threadColumn, key)
        return
      }

      followLatestThreadContent(threadColumn, key, { smooth: options.smoothFollow })
      return
    }

    restoreDetachedThreadPositionIfNeeded(key)
  }

  function suppressFollowScrollSync() {
    followScrollSyncSuppressedUntilRef.current = Date.now() + THREAD_COMPLETION_SCROLL_SYNC_SUPPRESS_MS
  }

  function isSmoothFollowScrollActiveForKey(key: string) {
    return smoothFollowScrollRef.current?.key === key
  }

  function handleThreadScrollIntent(event?: { currentTarget: HTMLDivElement }) {
    cancelSmoothFollowScroll()
    lastUserScrollIntentAtRef.current = Date.now()
    userScrollIntentConsumedRef.current = false
    if (event?.currentTarget) {
      lastKnownScrollTopRef.current = event.currentTarget.scrollTop
    }
  }

  function handleThreadPointerMoveIntent(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.buttons === 0) return
    handleThreadScrollIntent()
  }

  function handleThreadKeyDownIntent(event: KeyboardEvent<HTMLDivElement>) {
    handleThreadScrollIntent(event)

    if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
      lastUserScrollIntentDirectionRef.current = "up"
      detachThreadScrollFromFollow(event.currentTarget)
    } else if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End") {
      lastUserScrollIntentDirectionRef.current = "down"
    }
  }

  function handleThreadWheelIntent(event: ReactWheelEvent<HTMLDivElement>) {
    if (event.deltaY < 0) {
      lastUserScrollIntentDirectionRef.current = "up"
      detachThreadScrollFromFollow(event.currentTarget)
    } else if (event.deltaY > 0) {
      lastUserScrollIntentDirectionRef.current = "down"
    }

    handleThreadScrollIntent(event)

    if (event.deltaY < 0 && event.currentTarget.scrollTop <= THREAD_TOP_RESET_THRESHOLD_PX) {
      rememberThreadTopScrollSnapshot(event.currentTarget)
    }
  }

  function hasRecentThreadScrollIntent() {
    return (
      !userScrollIntentConsumedRef.current &&
      Date.now() - lastUserScrollIntentAtRef.current <= THREAD_USER_SCROLL_INTENT_WINDOW_MS
    )
  }

  function hasRecentUpwardThreadScrollIntent() {
    return (
      lastUserScrollIntentDirectionRef.current === "up" &&
      Date.now() - lastUserScrollIntentAtRef.current <= THREAD_USER_SCROLL_INTENT_WINDOW_MS
    )
  }

  function handleThreadScroll() {
    const threadColumn = threadColumnRef.current
    if (!threadColumn) return

    if (!hasRecentThreadScrollIntent()) {
      if (threadColumn.scrollTop <= THREAD_TOP_RESET_THRESHOLD_PX) {
        if (hasRecentUpwardThreadScrollIntent()) {
          rememberThreadTopScrollSnapshot(threadColumn, scrollStateKey)
          return
        }
        if (restoreDetachedThreadPositionIfNeeded(scrollStateKey)) {
          return
        }
      }
      lastKnownScrollTopRef.current = threadColumn.scrollTop
      return
    }
    userScrollIntentConsumedRef.current = true

    const previousScrollTop = lastKnownScrollTopRef.current
    const rawSnapshot = readThreadScrollSnapshot(threadColumn)
    const movedUp = rawSnapshot.scrollTop < previousScrollTop - 1
    const nextMode: ThreadScrollMode = rawSnapshot.pinnedToBottom && !movedUp ? "follow" : "detached"
    const snapshot = {
      ...rawSnapshot,
      pinnedToBottom: nextMode === "follow",
    }

    scrollModeRef.current = nextMode
    lastKnownScrollTopRef.current = rawSnapshot.scrollTop
    rememberThreadScrollSnapshot(scrollStateKey, snapshot)
    saveThreadScrollSnapshotValue(scrollStateKey, snapshot)
  }

  useLayoutEffect(() => {
    const threadColumn = threadColumnRef.current
    if (!threadColumn) return

    const previousScrollStateKey = currentScrollStateKeyRef.current
    if (previousScrollStateKey && previousScrollStateKey !== scrollStateKey) {
      persistLatestThreadScrollSnapshot(previousScrollStateKey)
    }

    currentScrollStateKeyRef.current = scrollStateKey
    restoreSavedThreadPosition(threadColumn, readStoredThreadScrollSnapshot(scrollStateKey), scrollStateKey)
  }, [scrollStateKey, readScrollSnapshot, threadColumnRef])

  useEffect(() => {
    return () => {
      cancelSmoothFollowScroll()
      const latestSnapshotKey = latestScrollSnapshotKeyRef.current
      if (latestSnapshotKey) {
        persistLatestThreadScrollSnapshot(latestSnapshotKey)
      }
    }
  }, [])

  return {
    cancelSmoothFollowScroll,
    handleThreadKeyDownIntent,
    handleThreadPointerMoveIntent,
    handleThreadScroll,
    handleThreadScrollIntent,
    handleThreadWheelIntent,
    isSmoothFollowScrollActiveForKey,
    restoreDetachedThreadPositionIfNeeded,
    suppressFollowScrollSync,
    syncThreadScrollAfterContentChange,
  }
}
