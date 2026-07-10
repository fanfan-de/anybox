import { useCallback, useEffect, useMemo, type RefObject } from "react"
import {
  defaultRangeExtractor,
  measureElement as measureVirtualElement,
  useVirtualizer,
  type Range,
  type ReactVirtualizer,
  type Rect,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual"
import type { ThreadDisplayRow } from "./thread-display-rows"
import { SIDEBAR_RESIZE_END_EVENT, SIDEBAR_RESIZE_START_EVENT } from "../sidebar-resize-events"

const THREAD_VIRTUAL_OVERSCAN_ROWS = 8
const THREAD_VIRTUAL_ROW_GAP_PX = 7
const THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX = 12
const THREAD_VIRTUAL_ROW_FALLBACK_HEIGHT_PX = 96
const THREAD_VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX = 640

export type ThreadRowVirtualizer = ReactVirtualizer<HTMLDivElement, HTMLDivElement>

interface UseThreadVirtualListInput {
  displayRows: ThreadDisplayRow[]
  getInitialOffset?: () => number
  pinnedRowIDs?: readonly string[]
  threadColumnRef: RefObject<HTMLDivElement | null>
  virtualListKey: string
}

const NEVER_ADJUST_THREAD_SCROLL_POSITION = () => false

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

function normalizeThreadVirtualOffset(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0
}

function estimateThreadRowSize(row: ThreadDisplayRow | undefined) {
  const estimatedHeight = row?.estimatedHeight ?? THREAD_VIRTUAL_ROW_FALLBACK_HEIGHT_PX
  return Math.max(THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX, estimatedHeight)
}

function isSidebarResizeInProgress() {
  return typeof document !== "undefined" && document.body.classList.contains("is-resizing-sidebar")
}

export function measureThreadVirtualElement(
  element: HTMLDivElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
) {
  const sidebarResizeInProgress = isSidebarResizeInProgress()

  if (entry) {
    const observedSize = measureVirtualElement(element, entry, instance)
    if (observedSize > 0) {
      return Math.max(THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX, observedSize)
    }
  }

  if (sidebarResizeInProgress) {
    return readCachedOrEstimatedThreadVirtualRowSize(element, instance)
  }

  const measuredSize = measureThreadVirtualRowElement(element)
  if (measuredSize !== null) {
    return measuredSize
  }

  return readCachedOrEstimatedThreadVirtualRowSize(element, instance)
}

export function measureThreadVirtualRowElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const width = element.clientWidth || rect.width
  if (!element.isConnected || width <= 0 || rect.height <= 0) return null

  return Math.max(THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX, rect.height)
}

function readCachedOrEstimatedThreadVirtualRowSize(
  element: HTMLDivElement,
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
) {
  const index = instance.indexFromElement(element)
  if (index < 0 || index >= instance.options.count) return THREAD_VIRTUAL_ROW_FALLBACK_HEIGHT_PX

  const key = instance.options.getItemKey(index)
  return instance.itemSizeCache.get(key) ?? instance.options.estimateSize(index)
}

function readThreadVirtualScrollRect(element: HTMLDivElement): Rect {
  const rect = element.getBoundingClientRect()
  const width = element.clientWidth || rect.width || 0
  const height = element.clientHeight || rect.height || THREAD_VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX

  return { width, height }
}

export function readThreadVirtualResizeObserverRect(
  element: HTMLDivElement,
  entry: ResizeObserverEntry | undefined,
): Rect {
  if (!entry) return readThreadVirtualScrollRect(element)

  const borderBoxSize = Array.isArray(entry.borderBoxSize)
    ? entry.borderBoxSize[0]
    : entry.borderBoxSize
  const width = borderBoxSize?.inlineSize ?? entry.contentRect.width
  const height = borderBoxSize?.blockSize ?? entry.contentRect.height

  if (width > 0 && height > 0) {
    return { width, height }
  }

  return readThreadVirtualScrollRect(element)
}

function observeThreadVirtualElementRect(
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
  callback: (rect: Rect) => void,
) {
  const element = instance.scrollElement
  if (!element) return

  const emitRect = (entry?: ResizeObserverEntry) => {
    callback(readThreadVirtualResizeObserverRect(element, entry))
  }

  emitRect()

  if (typeof ResizeObserver === "undefined") return

  const resizeObserver = new ResizeObserver((entries) => emitRect(entries[0]))
  resizeObserver.observe(element)
  return () => {
    resizeObserver.disconnect()
  }
}

export function useThreadVirtualList({
  displayRows,
  getInitialOffset,
  pinnedRowIDs = [],
  threadColumnRef,
  virtualListKey,
}: UseThreadVirtualListInput) {
  const estimateSize = useCallback(
    (index: number) => estimateThreadRowSize(displayRows[index]),
    [displayRows],
  )
  const getItemKey = useCallback(
    (index: number) => `${virtualListKey}\u0000${displayRows[index]?.rowID ?? `thread-row:${index}`}`,
    [displayRows, virtualListKey],
  )
  const initialOffset = useCallback(
    () => normalizeThreadVirtualOffset(getInitialOffset?.()),
    [getInitialOffset],
  )
  const pinnedRowIndexes = useMemo(() => {
    if (pinnedRowIDs.length === 0) return []

    const pinnedRowIDSet = new Set(pinnedRowIDs)
    const indexes: number[] = []
    for (let index = 0; index < displayRows.length; index += 1) {
      if (pinnedRowIDSet.has(displayRows[index]?.rowID ?? "")) {
        indexes.push(index)
      }
    }
    return indexes
  }, [displayRows, pinnedRowIDs])
  const rangeExtractor = useCallback((range: Range) => {
    if (pinnedRowIndexes.length === 0) return defaultRangeExtractor(range)

    const indexes = new Set(defaultRangeExtractor(range))
    for (const index of pinnedRowIndexes) {
      indexes.add(index)
    }
    return Array.from(indexes).sort((left, right) => left - right)
  }, [pinnedRowIndexes])
  const scrollToFn = useCallback((
    offset: number,
    options: { adjustments?: number; behavior?: "auto" | "smooth" | "instant" },
    instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
  ) => {
    const scrollElement = instance.scrollElement
    if (!scrollElement) return

    const nextScrollTop = offset + (options.adjustments ?? 0)
    scrollElement.scrollTop = nextScrollTop
    if (typeof Event !== "undefined") {
      scrollElement.dispatchEvent(new Event("scroll"))
    }
  }, [])

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: displayRows.length,
    estimateSize,
    gap: THREAD_VIRTUAL_ROW_GAP_PX,
    getItemKey,
    getScrollElement: () => threadColumnRef.current,
    initialRect: {
      height: THREAD_VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX,
      width: 0,
    },
    initialOffset,
    measureElement: measureThreadVirtualElement,
    observeElementRect: observeThreadVirtualElementRect,
    overscan: THREAD_VIRTUAL_OVERSCAN_ROWS,
    rangeExtractor,
    scrollToFn,
    useAnimationFrameWithResizeObserver: true,
  })
  useEffect(() => {
    function suppressScrollAdjustment() {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = NEVER_ADJUST_THREAD_SCROLL_POSITION
    }

    function restoreScrollAdjustment() {
      if (rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange === NEVER_ADJUST_THREAD_SCROLL_POSITION) {
        rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined
      }
    }

    if (isSidebarResizeInProgress()) suppressScrollAdjustment()
    window.addEventListener(SIDEBAR_RESIZE_START_EVENT, suppressScrollAdjustment)
    window.addEventListener(SIDEBAR_RESIZE_END_EVENT, restoreScrollAdjustment)
    return () => {
      window.removeEventListener(SIDEBAR_RESIZE_START_EVENT, suppressScrollAdjustment)
      window.removeEventListener(SIDEBAR_RESIZE_END_EVENT, restoreScrollAdjustment)
      restoreScrollAdjustment()
    }
  }, [rowVirtualizer])

  const threadVirtualItems = rowVirtualizer.getVirtualItems()
  const threadVirtualTotalSize = rowVirtualizer.getTotalSize()
  const threadVirtualRenderedRangeKey = useMemo(() => {
    const firstItem = threadVirtualItems[0]
    const lastItem = threadVirtualItems[threadVirtualItems.length - 1]
    return `${firstItem?.index ?? 0}:${lastItem?.index ?? 0}:${threadVirtualTotalSize}`
  }, [threadVirtualItems, threadVirtualTotalSize])

  function getThreadVirtualScrollMaxTop(threadColumn: HTMLDivElement) {
    const virtualScrollHeight =
      threadVirtualTotalSize +
      readThreadColumnPaddingTop(threadColumn) +
      readThreadColumnPaddingBottom(threadColumn)

    return Math.max(
      getThreadScrollMaxTop(threadColumn),
      virtualScrollHeight - threadColumn.clientHeight,
    )
  }

  function scrollToThreadVirtualOffset(offset: number) {
    const nextOffset = normalizeThreadVirtualOffset(offset)
    rowVirtualizer.scrollToOffset(nextOffset, { align: "start" })

    const threadColumn = threadColumnRef.current
    if (threadColumn) {
      threadColumn.scrollTop = nextOffset
    }
  }

  function getThreadVirtualOffsetForRowIndex(rowIndex: number, topInset = 0) {
    if (displayRows.length === 0 || !Number.isFinite(rowIndex)) return null

    const boundedRowIndex = Math.min(displayRows.length - 1, Math.max(0, Math.trunc(rowIndex)))
    const offset = rowVirtualizer.getOffsetForIndex(boundedRowIndex, "start")?.[0]
    if (offset === undefined) return null
    return Math.max(0, offset - Math.max(0, topInset))
  }

  return {
    getThreadVirtualOffsetForRowIndex,
    getThreadVirtualScrollMaxTop,
    rowVirtualizer,
    scrollToThreadVirtualOffset,
    threadVirtualItems: threadVirtualItems as VirtualItem[],
    threadVirtualRenderedRangeKey,
    threadVirtualTotalSize,
  }
}
