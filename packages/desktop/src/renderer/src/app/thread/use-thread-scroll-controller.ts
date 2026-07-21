import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react"

export interface ThreadScrollAnchor {
  rowID: string
  viewportOffset: number
  turnID?: string
  affinity?: "before" | "after"
}

export interface ThreadScrollSnapshot {
  scrollTop: number
  pinnedToBottom: boolean
  updatedAt: number
  anchor?: ThreadScrollAnchor
}

export interface ThreadProjectionLayoutTransactionOptions {
  /** Row that must survive the projection change and will be used for correction afterwards. */
  anchorRowID: string
  /** Row whose current viewport position should be transferred to `anchorRowID`. */
  sourceRowID?: string
  /** Explicitly supplied when the source row is not mounted by the virtualizer. */
  viewportOffset?: number
  turnID?: string
  affinity?: ThreadScrollAnchor["affinity"]
  key?: string
}

export interface ThreadProjectionLayoutTransaction {
  readonly id: number
  readonly key: string
  readonly anchor: ThreadScrollAnchor
}

export interface ThreadFollowScrollTarget {
  scrollTop: number
  visualScrollTop: number
}

type ThreadScrollMode = "follow" | "detached"
type ThreadScrollIntentDirection = "up" | "down" | null

interface ThreadSmoothFollowScroll {
  duration: number
  frameID: number | null
  fromScrollTop: number
  key: string
  startedAt: number
  targetScrollTop: number
}

interface ActiveThreadProjectionLayoutTransaction extends ThreadProjectionLayoutTransaction {
  fallbackScrollTop: number
  frameID: number | null
  hasResolvedAnchor: boolean
  mode: ThreadScrollMode
  remainingCorrectionFrames: number
}

interface UseThreadScrollControllerInput {
  getLatestThreadContentScrollTarget: (
    threadColumn: HTMLDivElement,
    options?: { skipStreamingResponseMeasurement?: boolean },
  ) => ThreadFollowScrollTarget
  isSidebarResizeInProgress: () => boolean
  projectScrollSnapshot?: (snapshot: ThreadScrollSnapshot) => ThreadScrollSnapshot
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
const THREAD_PROJECTION_LAYOUT_CORRECTION_FRAMES = 2
const THREAD_PROJECTION_LAYOUT_EPSILON_PX = 0.5

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

function isThreadVirtualRowOwnedByColumn(row: HTMLElement, threadColumn: HTMLDivElement) {
  const owningThreadColumn = row.closest<HTMLElement>(".thread-column")
  return owningThreadColumn ? owningThreadColumn === threadColumn : threadColumn.contains(row)
}

function findThreadVirtualRow(threadColumn: HTMLDivElement, rowID: string) {
  const rows = threadColumn.querySelectorAll<HTMLElement>("[data-thread-virtual-row-id]")
  for (const row of Array.from(rows)) {
    if (!isThreadVirtualRowOwnedByColumn(row, threadColumn)) continue
    if (row.getAttribute("data-thread-virtual-row-id") === rowID) return row
  }
  return null
}

function readThreadRowViewportOffset(threadColumn: HTMLDivElement, rowID: string) {
  const row = findThreadVirtualRow(threadColumn, rowID)
  if (!row) return null

  const viewportOffset = row.getBoundingClientRect().top - threadColumn.getBoundingClientRect().top
  return Number.isFinite(viewportOffset) ? viewportOffset : null
}

function readTopmostVisibleThreadScrollAnchor(threadColumn: HTMLDivElement): ThreadScrollAnchor | undefined {
  const columnRect = threadColumn.getBoundingClientRect()
  const rows = threadColumn.querySelectorAll<HTMLElement>("[data-thread-virtual-row-id]")
  let bestRow: HTMLElement | null = null
  let bestRowTop = Number.POSITIVE_INFINITY

  for (const row of Array.from(rows)) {
    if (!isThreadVirtualRowOwnedByColumn(row, threadColumn)) continue
    const rowID = row.getAttribute("data-thread-virtual-row-id")
    if (!rowID) continue

    const rowRect = row.getBoundingClientRect()
    if (rowRect.bottom < columnRect.top || rowRect.top > columnRect.bottom) continue
    if (rowRect.top >= bestRowTop) continue
    bestRow = row
    bestRowTop = rowRect.top
  }

  const rowID = bestRow?.getAttribute("data-thread-virtual-row-id")
  if (!bestRow || !rowID) return undefined

  const viewportOffset = bestRow.getBoundingClientRect().top - columnRect.top
  if (!Number.isFinite(viewportOffset)) return undefined
  return { rowID, viewportOffset }
}

function readThreadScrollSnapshot(threadColumn: HTMLDivElement): ThreadScrollSnapshot {
  const anchor = readTopmostVisibleThreadScrollAnchor(threadColumn)
  return {
    scrollTop: threadColumn.scrollTop,
    pinnedToBottom: isThreadColumnPinnedToBottom(threadColumn),
    updatedAt: Date.now(),
    ...(anchor ? { anchor } : {}),
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
  projectScrollSnapshot,
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
  const lastUserScrollIntentDirectionRef = useRef<ThreadScrollIntentDirection>(null)
  const followScrollSyncSuppressedUntilRef = useRef(0)
  const userScrollIntentConsumedRef = useRef(false)
  const lastKnownScrollTopRef = useRef(0)
  const currentScrollStateKeyRef = useRef<string | null>(null)
  const activeProjectionLayoutTransactionRef = useRef<ActiveThreadProjectionLayoutTransaction | null>(null)
  const nextProjectionLayoutTransactionIDRef = useRef(1)

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
    const snapshot = latestScrollSnapshotKeyRef.current === key ? latestScrollSnapshotRef.current : null
    return snapshot && projectScrollSnapshot ? projectScrollSnapshot(snapshot) : snapshot
  }

  function readStoredThreadScrollSnapshot(key = scrollStateKey) {
    const snapshot = readScrollSnapshot?.(key) ?? threadScrollSnapshots.get(key) ?? null
    return snapshot && projectScrollSnapshot ? projectScrollSnapshot(snapshot) : snapshot
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

  function persistThreadScrollSnapshotWithAnchor(
    threadColumn: HTMLDivElement,
    key: string,
    mode: ThreadScrollMode,
    anchor: ThreadScrollAnchor,
  ) {
    const snapshot: ThreadScrollSnapshot = {
      ...readThreadScrollSnapshot(threadColumn),
      anchor,
      pinnedToBottom: mode === "follow",
    }
    rememberThreadScrollSnapshot(key, snapshot)
    saveThreadScrollSnapshotValue(key, snapshot)
  }

  function correctThreadScrollToAnchor(
    threadColumn: HTMLDivElement,
    anchor: ThreadScrollAnchor,
  ) {
    const currentViewportOffset = readThreadRowViewportOffset(threadColumn, anchor.rowID)
    if (currentViewportOffset === null) return false

    const delta = currentViewportOffset - anchor.viewportOffset
    if (Math.abs(delta) > THREAD_PROJECTION_LAYOUT_EPSILON_PX) {
      setThreadScrollTop(threadColumn, threadColumn.scrollTop + delta)
    }
    return true
  }

  function cancelActiveThreadProjectionLayoutTransaction(options: { persist?: boolean } = {}) {
    const transaction = activeProjectionLayoutTransactionRef.current
    if (!transaction) return false

    activeProjectionLayoutTransactionRef.current = null
    if (
      transaction.frameID !== null &&
      typeof window !== "undefined" &&
      typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(transaction.frameID)
    }

    if (options.persist !== false) {
      const threadColumn = threadColumnRef.current
      if (threadColumn && currentScrollStateKeyRef.current === transaction.key) {
        persistThreadScrollSnapshot(transaction.key, scrollModeRef.current)
      }
    }
    return true
  }

  function beginThreadProjectionLayoutTransaction({
    anchorRowID,
    sourceRowID = anchorRowID,
    viewportOffset: explicitViewportOffset,
    turnID,
    affinity,
    key = scrollStateKey,
  }: ThreadProjectionLayoutTransactionOptions): ThreadProjectionLayoutTransaction | null {
    const threadColumn = threadColumnRef.current
    if (
      !threadColumn ||
      !key ||
      !anchorRowID ||
      currentScrollStateKeyRef.current !== key
    ) {
      return null
    }

    const viewportOffset = explicitViewportOffset ?? readThreadRowViewportOffset(threadColumn, sourceRowID)
    if (viewportOffset === null || !Number.isFinite(viewportOffset)) return null

    cancelActiveThreadProjectionLayoutTransaction({ persist: false })
    cancelSmoothFollowScroll()

    const anchor: ThreadScrollAnchor = {
      rowID: anchorRowID,
      viewportOffset,
      ...(turnID ? { turnID } : {}),
      ...(affinity ? { affinity } : {}),
    }
    const transaction: ActiveThreadProjectionLayoutTransaction = {
      id: nextProjectionLayoutTransactionIDRef.current,
      key,
      anchor,
      fallbackScrollTop: threadColumn.scrollTop,
      frameID: null,
      hasResolvedAnchor: false,
      mode: scrollModeRef.current,
      remainingCorrectionFrames: THREAD_PROJECTION_LAYOUT_CORRECTION_FRAMES,
    }
    nextProjectionLayoutTransactionIDRef.current += 1
    activeProjectionLayoutTransactionRef.current = transaction
    persistThreadScrollSnapshotWithAnchor(threadColumn, key, transaction.mode, anchor)
    return transaction
  }

  function completeThreadProjectionLayoutTransaction(transaction: ThreadProjectionLayoutTransaction) {
    const activeTransaction = activeProjectionLayoutTransactionRef.current
    if (!activeTransaction || activeTransaction.id !== transaction.id) return false
    if (activeTransaction.frameID !== null) return true

    const runCorrectionFrame = (): void => {
      if (activeProjectionLayoutTransactionRef.current !== activeTransaction) return

      activeTransaction.frameID = null
      const threadColumn = threadColumnRef.current
      if (!threadColumn || currentScrollStateKeyRef.current !== activeTransaction.key) {
        cancelActiveThreadProjectionLayoutTransaction({ persist: false })
        return
      }

      const foundAnchor = correctThreadScrollToAnchor(threadColumn, activeTransaction.anchor)
      activeTransaction.hasResolvedAnchor ||= foundAnchor
      activeTransaction.remainingCorrectionFrames -= 1
      if (activeTransaction.remainingCorrectionFrames > 0) {
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
          activeTransaction.frameID = window.requestAnimationFrame(runCorrectionFrame)
          return
        }
        runCorrectionFrame()
        return
      }

      if (!activeTransaction.hasResolvedAnchor && canRepresentThreadScrollTop(threadColumn, activeTransaction.fallbackScrollTop)) {
        setThreadScrollTop(threadColumn, activeTransaction.fallbackScrollTop)
      }
      scrollModeRef.current = activeTransaction.mode
      persistThreadScrollSnapshotWithAnchor(
        threadColumn,
        activeTransaction.key,
        activeTransaction.mode,
        activeTransaction.anchor,
      )
      activeProjectionLayoutTransactionRef.current = null
    }

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      activeTransaction.frameID = window.requestAnimationFrame(runCorrectionFrame)
    } else {
      runCorrectionFrame()
    }
    return true
  }

  function cancelThreadProjectionLayoutTransaction(transaction?: ThreadProjectionLayoutTransaction) {
    const activeTransaction = activeProjectionLayoutTransactionRef.current
    if (!activeTransaction || (transaction && transaction.id !== activeTransaction.id)) return false
    return cancelActiveThreadProjectionLayoutTransaction()
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
    const hasMountedAnchor = snapshot.anchor
      ? readThreadRowViewportOffset(threadColumn, snapshot.anchor.rowID) !== null
      : false
    const canRestoreFallbackScrollTop = canRepresentThreadScrollTop(threadColumn, snapshot.scrollTop)
    if (!canRestoreFallbackScrollTop && !hasMountedAnchor) {
      rememberThreadScrollSnapshot(key, snapshot)
      return false
    }

    if (canRestoreFallbackScrollTop) {
      setThreadScrollTop(threadColumn, snapshot.scrollTop)
    }
    if (snapshot.anchor) {
      correctThreadScrollToAnchor(threadColumn, snapshot.anchor)
      persistThreadScrollSnapshotWithAnchor(threadColumn, key, "detached", snapshot.anchor)
    } else {
      persistThreadScrollSnapshot(key, "detached")
    }
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
    if (activeProjectionLayoutTransactionRef.current?.key === key) return

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

  function navigateThreadToOffset(scrollTop: number, key = scrollStateKey) {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || currentScrollStateKeyRef.current !== key) return false

    cancelSmoothFollowScroll()
    scrollModeRef.current = "detached"
    setThreadScrollTop(threadColumn, scrollTop, { clampToDomScrollRange: false })
    const snapshot: ThreadScrollSnapshot = {
      scrollTop: threadColumn.scrollTop,
      pinnedToBottom: false,
      updatedAt: Date.now(),
    }
    rememberThreadScrollSnapshot(key, snapshot)
    saveThreadScrollSnapshotValue(key, snapshot)
    return true
  }

  function isSmoothFollowScrollActiveForKey(key: string) {
    return smoothFollowScrollRef.current?.key === key
  }

  function isThreadScrollFollowing(key = scrollStateKey) {
    return currentScrollStateKeyRef.current === key && scrollModeRef.current === "follow"
  }

  function handleThreadScrollIntent(
    event?: { currentTarget: HTMLDivElement },
    direction: ThreadScrollIntentDirection = null,
  ) {
    cancelSmoothFollowScroll()
    cancelActiveThreadProjectionLayoutTransaction()
    lastUserScrollIntentAtRef.current = Date.now()
    lastUserScrollIntentDirectionRef.current = direction
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
    if (event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home") {
      handleThreadScrollIntent(event, "up")
      detachThreadScrollFromFollow(event.currentTarget)
    } else if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === "End") {
      handleThreadScrollIntent(event, "down")
    } else {
      handleThreadScrollIntent(event)
    }
  }

  function handleThreadWheelIntent(event: ReactWheelEvent<HTMLDivElement>) {
    if (event.deltaY < 0) {
      handleThreadScrollIntent(event, "up")
      detachThreadScrollFromFollow(event.currentTarget)
    } else if (event.deltaY > 0) {
      handleThreadScrollIntent(event, "down")
    } else {
      handleThreadScrollIntent(event)
    }

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

    if (hasRecentUpwardThreadScrollIntent()) {
      userScrollIntentConsumedRef.current = true
      if (threadColumn.scrollTop <= THREAD_TOP_RESET_THRESHOLD_PX) {
        rememberThreadTopScrollSnapshot(threadColumn, scrollStateKey)
        return
      }

      const snapshot = {
        ...readThreadScrollSnapshot(threadColumn),
        pinnedToBottom: false,
      }
      scrollModeRef.current = "detached"
      lastKnownScrollTopRef.current = snapshot.scrollTop
      rememberThreadScrollSnapshot(scrollStateKey, snapshot)
      saveThreadScrollSnapshotValue(scrollStateKey, snapshot)
      return
    }

    if (!hasRecentThreadScrollIntent()) {
      if (threadColumn.scrollTop <= THREAD_TOP_RESET_THRESHOLD_PX) {
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
      cancelActiveThreadProjectionLayoutTransaction({ persist: false })
      persistLatestThreadScrollSnapshot(previousScrollStateKey)
    }

    currentScrollStateKeyRef.current = scrollStateKey
    restoreSavedThreadPosition(threadColumn, readStoredThreadScrollSnapshot(scrollStateKey), scrollStateKey)
  }, [scrollStateKey, readScrollSnapshot, threadColumnRef])

  useEffect(() => {
    return () => {
      cancelSmoothFollowScroll()
      cancelActiveThreadProjectionLayoutTransaction({ persist: false })
      const latestSnapshotKey = latestScrollSnapshotKeyRef.current
      if (latestSnapshotKey) {
        persistLatestThreadScrollSnapshot(latestSnapshotKey)
      }
    }
  }, [])

  return {
    beginThreadProjectionLayoutTransaction,
    cancelSmoothFollowScroll,
    cancelThreadProjectionLayoutTransaction,
    completeThreadProjectionLayoutTransaction,
    handleThreadKeyDownIntent,
    handleThreadPointerMoveIntent,
    handleThreadScroll,
    handleThreadScrollIntent,
    handleThreadWheelIntent,
    isSmoothFollowScrollActiveForKey,
    isThreadScrollFollowing,
    navigateThreadToOffset,
    restoreDetachedThreadPositionIfNeeded,
    suppressFollowScrollSync,
    syncThreadScrollAfterContentChange,
  }
}
