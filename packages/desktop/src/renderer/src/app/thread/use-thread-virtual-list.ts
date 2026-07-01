import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { ThreadDisplayRow } from "./thread-display-rows"

const THREAD_VIRTUALIZATION_MIN_ROWS = 180
const THREAD_VIRTUAL_OVERSCAN_PX = 160
const THREAD_VIRTUAL_OVERSCAN_ROWS = 2
const THREAD_VIRTUAL_ROW_GAP_PX = 7
const THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX = 12
const THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX = 1

export interface ThreadVirtualLayoutItem {
  height: number
  index: number
  row: ThreadDisplayRow
  top: number
}

export interface ThreadVirtualLayout {
  items: ThreadVirtualLayoutItem[]
  totalHeight: number
}

export interface ThreadVirtualRange {
  endIndex: number
  items: ThreadVirtualLayoutItem[]
  startIndex: number
}

interface ThreadVirtualViewport {
  height: number
  paddingTop: number
  scrollTop: number
}

interface ThreadVirtualViewportSyncOptions {
  forceCommit?: boolean
}

interface ThreadVirtualMeasurementOptions {
  syncScroll?: boolean
}

interface UseThreadVirtualListInput {
  displayRows: ThreadDisplayRow[]
  onScrollSyncRequested: (key: string) => void
  scrollStateKey: string
  threadColumnRef: RefObject<HTMLDivElement | null>
}

function readThreadColumnPaddingTop(threadColumn: HTMLDivElement) {
  if (typeof window === "undefined") return 0

  const value = Number.parseFloat(window.getComputedStyle(threadColumn).paddingTop)
  return Number.isFinite(value) ? value : 0
}

function readThreadColumnPaddingBottom(threadColumn: HTMLDivElement) {
  if (typeof window === "undefined") return 0

  const value = Number.parseFloat(window.getComputedStyle(threadColumn).paddingBottom)
  return Number.isFinite(value) ? value : 0
}

function getThreadScrollMaxTop(threadColumn: HTMLDivElement) {
  return Math.max(0, threadColumn.scrollHeight - threadColumn.clientHeight)
}

function cancelThreadAnimationFrame(frameID: number | null) {
  if (
    frameID !== null &&
    typeof window !== "undefined" &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(frameID)
  }
}

function readResizeEntryBlockSize(entry: ResizeObserverEntry) {
  const borderBoxSize = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize
  const height = borderBoxSize?.blockSize ?? entry.contentRect?.height
  return Number.isFinite(height) ? height : null
}

function readResizeEntryInlineSize(entry: ResizeObserverEntry) {
  const borderBoxSize = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize
  const width = borderBoxSize?.inlineSize ?? entry.contentRect?.width
  return Number.isFinite(width) ? width : null
}

function buildThreadVirtualLayout(rows: ThreadDisplayRow[], measuredHeights: Map<string, number>): ThreadVirtualLayout {
  const items: ThreadVirtualLayoutItem[] = []
  let top = 0

  rows.forEach((row, index) => {
    const measuredHeight = measuredHeights.get(row.rowID)
    const height = Math.max(THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX, measuredHeight ?? row.estimatedHeight)
    items.push({
      height,
      index,
      row,
      top,
    })
    top += height
    if (index < rows.length - 1) {
      top += THREAD_VIRTUAL_ROW_GAP_PX
    }
  })

  return {
    items,
    totalHeight: top,
  }
}

function findThreadVirtualRange(layout: ThreadVirtualLayout, viewport: ThreadVirtualViewport): ThreadVirtualRange {
  if (layout.items.length === 0) {
    return {
      endIndex: 0,
      items: [],
      startIndex: 0,
    }
  }

  const viewportTop = Math.max(0, viewport.scrollTop - viewport.paddingTop)
  const startOffset = Math.max(0, viewportTop - THREAD_VIRTUAL_OVERSCAN_PX)
  const endOffset = viewportTop + Math.max(0, viewport.height) + THREAD_VIRTUAL_OVERSCAN_PX

  let startIndex = layout.items.findIndex((item) => item.top + item.height >= startOffset)
  if (startIndex === -1) startIndex = layout.items.length - 1

  let endIndex = startIndex
  while (endIndex < layout.items.length && layout.items[endIndex]!.top <= endOffset) {
    endIndex += 1
  }

  startIndex = Math.max(0, startIndex - THREAD_VIRTUAL_OVERSCAN_ROWS)
  endIndex = Math.min(layout.items.length, endIndex + THREAD_VIRTUAL_OVERSCAN_ROWS)

  return {
    endIndex,
    items: layout.items.slice(startIndex, endIndex),
    startIndex,
  }
}

export function useThreadVirtualList({
  displayRows,
  onScrollSyncRequested,
  scrollStateKey,
  threadColumnRef,
}: UseThreadVirtualListInput) {
  const threadVirtualHeightCachesRef = useRef<Record<string, Map<string, number>>>({})
  const pendingThreadVirtualMeasurementsRef = useRef<Record<string, Map<string, number>>>({})
  const pendingThreadVirtualMeasurementFrameRef = useRef<number | null>(null)
  const pendingThreadVirtualMeasurementScrollSyncKeyRef = useRef<string | null>(null)
  const pendingThreadVirtualViewportFrameRef = useRef<number | null>(null)
  const threadVirtualMeasuredWidthByKeyRef = useRef<Record<string, number>>({})
  const [threadVirtualMeasurementVersion, setThreadVirtualMeasurementVersion] = useState(0)
  const [threadVirtualViewport, setThreadVirtualViewport] = useState<ThreadVirtualViewport>({
    height: 0,
    paddingTop: 0,
    scrollTop: 0,
  })
  const threadVirtualViewportRef = useRef(threadVirtualViewport)
  const shouldVirtualizeThreadRows = displayRows.length >= THREAD_VIRTUALIZATION_MIN_ROWS

  function getThreadVirtualHeightCache(key = scrollStateKey) {
    const existingCache = threadVirtualHeightCachesRef.current[key]
    if (existingCache) return existingCache

    const nextCache = new Map<string, number>()
    threadVirtualHeightCachesRef.current[key] = nextCache
    return nextCache
  }

  const threadVirtualHeightCache = getThreadVirtualHeightCache(scrollStateKey)
  const threadVirtualLayout = useMemo(
    () => buildThreadVirtualLayout(displayRows, threadVirtualHeightCache),
    [scrollStateKey, displayRows, threadVirtualHeightCache, threadVirtualMeasurementVersion],
  )
  const threadVirtualRange = useMemo(
    () => shouldVirtualizeThreadRows
      ? findThreadVirtualRange(threadVirtualLayout, threadVirtualViewport)
      : {
          endIndex: displayRows.length,
          items: threadVirtualLayout.items,
          startIndex: 0,
        },
    [shouldVirtualizeThreadRows, displayRows.length, threadVirtualLayout, threadVirtualViewport],
  )
  const threadVirtualRenderedRangeKey = `${threadVirtualRange.startIndex}:${threadVirtualRange.endIndex}:${threadVirtualLayout.totalHeight}`

  function threadVirtualRangeWouldChange(nextViewport: ThreadVirtualViewport) {
    if (!shouldVirtualizeThreadRows) return false

    const nextRange = findThreadVirtualRange(threadVirtualLayout, nextViewport)
    return (
      nextRange.startIndex !== threadVirtualRange.startIndex ||
      nextRange.endIndex !== threadVirtualRange.endIndex
    )
  }

  function commitThreadVirtualViewport(
    nextViewport: ThreadVirtualViewport,
    options: ThreadVirtualViewportSyncOptions = {},
  ) {
    const previousViewport = threadVirtualViewportRef.current
    if (
      Math.abs(previousViewport.height - nextViewport.height) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX &&
      Math.abs(previousViewport.paddingTop - nextViewport.paddingTop) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX &&
      Math.abs(previousViewport.scrollTop - nextViewport.scrollTop) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX
    ) {
      return
    }

    threadVirtualViewportRef.current = nextViewport
    if (!options.forceCommit && !threadVirtualRangeWouldChange(nextViewport)) return

    setThreadVirtualViewport(nextViewport)
  }

  function readThreadVirtualViewport(threadColumn: HTMLDivElement): ThreadVirtualViewport {
    return {
      height: threadColumn.clientHeight,
      paddingTop: readThreadColumnPaddingTop(threadColumn),
      scrollTop: threadColumn.scrollTop,
    }
  }

  function syncThreadVirtualViewport(
    threadColumn: HTMLDivElement,
    options: ThreadVirtualViewportSyncOptions = {},
  ) {
    if (!shouldVirtualizeThreadRows) return

    commitThreadVirtualViewport(readThreadVirtualViewport(threadColumn), options)
  }

  function scheduleThreadVirtualViewportSync(threadColumn: HTMLDivElement) {
    if (!shouldVirtualizeThreadRows) return
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      syncThreadVirtualViewport(threadColumn)
      return
    }
    if (pendingThreadVirtualViewportFrameRef.current !== null) return

    pendingThreadVirtualViewportFrameRef.current = window.requestAnimationFrame(() => {
      pendingThreadVirtualViewportFrameRef.current = null
      const currentThreadColumn = threadColumnRef.current
      if (!currentThreadColumn) return
      syncThreadVirtualViewport(currentThreadColumn)
    })
  }

  function commitThreadVirtualRowHeight(rowID: string, height: number, key = scrollStateKey) {
    if (!Number.isFinite(height) || height < THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX) return false

    const normalizedHeight = Math.max(THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX, height)
    const heightCache = getThreadVirtualHeightCache(key)
    const previousHeight = heightCache.get(rowID)
    if (
      previousHeight !== undefined &&
      Math.abs(previousHeight - normalizedHeight) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX
    ) {
      return false
    }

    heightCache.set(rowID, normalizedHeight)
    return true
  }

  function flushQueuedThreadVirtualMeasurements() {
    cancelThreadAnimationFrame(pendingThreadVirtualMeasurementFrameRef.current)

    let didMeasure = false

    for (const [key, measurements] of Object.entries(pendingThreadVirtualMeasurementsRef.current)) {
      for (const [rowID, height] of measurements) {
        didMeasure = commitThreadVirtualRowHeight(rowID, height, key) || didMeasure
      }
    }

    pendingThreadVirtualMeasurementsRef.current = {}
    pendingThreadVirtualMeasurementFrameRef.current = null

    if (didMeasure) {
      setThreadVirtualMeasurementVersion((version) => version + 1)
    }

    const scrollSyncKey = pendingThreadVirtualMeasurementScrollSyncKeyRef.current
    pendingThreadVirtualMeasurementScrollSyncKeyRef.current = null
    if (didMeasure && scrollSyncKey) {
      onScrollSyncRequested(scrollSyncKey)
    }

    return didMeasure
  }

  function scheduleQueuedThreadVirtualMeasurementsFlush() {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      flushQueuedThreadVirtualMeasurements()
      return
    }
    if (pendingThreadVirtualMeasurementFrameRef.current !== null) return

    pendingThreadVirtualMeasurementFrameRef.current = window.requestAnimationFrame(() => {
      flushQueuedThreadVirtualMeasurements()
    })
  }

  function queueThreadVirtualRowHeight(
    rowID: string,
    height: number,
    key = scrollStateKey,
    options: ThreadVirtualMeasurementOptions = {},
  ) {
    if (!Number.isFinite(height) || height < THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX) return false

    const normalizedHeight = Math.max(THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX, height)
    const existingMeasurements = pendingThreadVirtualMeasurementsRef.current[key]
    const pendingHeight = existingMeasurements?.get(rowID)
    if (
      pendingHeight !== undefined &&
      Math.abs(pendingHeight - normalizedHeight) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX
    ) {
      return false
    }

    const cachedHeight = getThreadVirtualHeightCache(key).get(rowID)
    if (
      pendingHeight === undefined &&
      cachedHeight !== undefined &&
      Math.abs(cachedHeight - normalizedHeight) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX
    ) {
      return false
    }

    const measurements = existingMeasurements ?? new Map<string, number>()
    if (!existingMeasurements) pendingThreadVirtualMeasurementsRef.current[key] = measurements
    measurements.set(rowID, normalizedHeight)

    if (options.syncScroll) {
      pendingThreadVirtualMeasurementScrollSyncKeyRef.current = key
    }
    scheduleQueuedThreadVirtualMeasurementsFlush()
    return true
  }

  function getThreadVirtualScrollMaxTop(threadColumn: HTMLDivElement) {
    const virtualScrollHeight =
      threadVirtualLayout.totalHeight +
      readThreadColumnPaddingTop(threadColumn) +
      readThreadColumnPaddingBottom(threadColumn)
    return Math.max(getThreadScrollMaxTop(threadColumn), virtualScrollHeight - threadColumn.clientHeight)
  }

  function rememberThreadVirtualMeasuredWidth(width: number, key = scrollStateKey) {
    if (!Number.isFinite(width) || width <= 0) return false

    const previousWidth = threadVirtualMeasuredWidthByKeyRef.current[key]
    if (
      previousWidth !== undefined &&
      Math.abs(previousWidth - width) < THREAD_VIRTUAL_ROW_MEASURE_EPSILON_PX
    ) {
      return false
    }

    threadVirtualMeasuredWidthByKeyRef.current[key] = width
    return true
  }

  function entryMayAffectThreadVirtualRowWidth(entry: ResizeObserverEntry, threadColumn: HTMLDivElement) {
    if (!(entry.target instanceof HTMLElement)) return false
    if (entry.target === threadColumn) return true
    if (entry.target.closest(".thread-column") !== threadColumn) return false
    return entry.target.classList.contains("thread-virtual-spacer")
  }

  function measureRenderedThreadVirtualRows(options: ThreadVirtualMeasurementOptions = {}) {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || !shouldVirtualizeThreadRows) return false

    let didMeasure = false
    for (const element of Array.from(threadColumn.querySelectorAll<HTMLElement>("[data-thread-virtual-row-id]"))) {
      if (element.closest(".thread-column") !== threadColumn) continue
      const rowID = element.dataset.threadVirtualRowId
      if (!rowID) continue

      const height = Math.max(element.offsetHeight, element.getBoundingClientRect().height)
      didMeasure = queueThreadVirtualRowHeight(rowID, height, scrollStateKey, options) || didMeasure
    }

    return didMeasure
  }

  function measureThreadVirtualRowsFromResizeEntries(
    entries: ResizeObserverEntry[],
    options: ThreadVirtualMeasurementOptions = {},
  ) {
    if (!shouldVirtualizeThreadRows) return false
    const threadColumn = threadColumnRef.current
    if (!threadColumn) return false

    let didMeasure = false
    let shouldMeasureRenderedRows = false
    for (const entry of entries) {
      if (!(entry.target instanceof HTMLElement)) continue
      if (entry.target.closest(".thread-column") !== threadColumn) continue

      if (entryMayAffectThreadVirtualRowWidth(entry, threadColumn)) {
        const width = readResizeEntryInlineSize(entry)
        shouldMeasureRenderedRows = rememberThreadVirtualMeasuredWidth(width ?? entry.target.clientWidth) || shouldMeasureRenderedRows
      }

      const rowID = entry.target.dataset.threadVirtualRowId
      if (!rowID) continue

      const height = readResizeEntryBlockSize(entry)
      if (height === null) continue
      didMeasure = queueThreadVirtualRowHeight(rowID, height, scrollStateKey, options) || didMeasure
    }

    if (shouldMeasureRenderedRows) {
      didMeasure = measureRenderedThreadVirtualRows(options) || didMeasure
    }

    return didMeasure
  }

  useEffect(() => {
    return () => {
      cancelThreadAnimationFrame(pendingThreadVirtualMeasurementFrameRef.current)
      pendingThreadVirtualMeasurementFrameRef.current = null
      cancelThreadAnimationFrame(pendingThreadVirtualViewportFrameRef.current)
      pendingThreadVirtualViewportFrameRef.current = null
    }
  }, [])

  return {
    flushQueuedThreadVirtualMeasurements,
    getThreadVirtualScrollMaxTop,
    measureRenderedThreadVirtualRows,
    measureThreadVirtualRowsFromResizeEntries,
    scheduleThreadVirtualViewportSync,
    shouldVirtualizeThreadRows,
    syncThreadVirtualViewport,
    threadVirtualLayout,
    threadVirtualRange,
    threadVirtualRenderedRangeKey,
  }
}
