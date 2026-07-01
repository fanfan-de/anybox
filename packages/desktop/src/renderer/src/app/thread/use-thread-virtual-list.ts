import { useCallback, useMemo, type RefObject } from "react"
import {
  measureElement as measureVirtualElement,
  useVirtualizer,
  type ReactVirtualizer,
  type Rect,
  type VirtualItem,
  type Virtualizer,
} from "@tanstack/react-virtual"
import type { ThreadDisplayRow } from "./thread-display-rows"

const THREAD_VIRTUAL_OVERSCAN_ROWS = 8
const THREAD_VIRTUAL_ROW_GAP_PX = 7
const THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX = 12
const THREAD_VIRTUAL_ROW_FALLBACK_HEIGHT_PX = 96
const THREAD_VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX = 640

export type ThreadRowVirtualizer = ReactVirtualizer<HTMLDivElement, HTMLDivElement>

interface UseThreadVirtualListInput {
  displayRows: ThreadDisplayRow[]
  getInitialOffset?: () => number
  threadColumnRef: RefObject<HTMLDivElement | null>
  virtualListKey: string
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

function normalizeThreadVirtualOffset(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0
}

function estimateThreadRowSize(row: ThreadDisplayRow | undefined) {
  const estimatedHeight = row?.estimatedHeight ?? THREAD_VIRTUAL_ROW_FALLBACK_HEIGHT_PX
  return Math.max(THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX, estimatedHeight)
}

function measureThreadVirtualElement(
  element: HTMLDivElement,
  entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
) {
  if (entry) {
    const observedSize = measureVirtualElement(element, entry, instance)
    if (observedSize > 0) {
      return Math.max(THREAD_VIRTUAL_ROW_MIN_HEIGHT_PX, observedSize)
    }
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

function observeThreadVirtualElementRect(
  instance: Virtualizer<HTMLDivElement, HTMLDivElement>,
  callback: (rect: Rect) => void,
) {
  const element = instance.scrollElement
  if (!element) return

  const emitRect = () => {
    callback(readThreadVirtualScrollRect(element))
  }

  emitRect()

  if (typeof ResizeObserver === "undefined") return

  const resizeObserver = new ResizeObserver(emitRect)
  resizeObserver.observe(element)
  return () => {
    resizeObserver.disconnect()
  }
}

export function useThreadVirtualList({
  displayRows,
  getInitialOffset,
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
    scrollToFn,
  })

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

  return {
    getThreadVirtualScrollMaxTop,
    rowVirtualizer,
    scrollToThreadVirtualOffset,
    threadVirtualItems: threadVirtualItems as VirtualItem[],
    threadVirtualRenderedRangeKey,
    threadVirtualTotalSize,
  }
}
