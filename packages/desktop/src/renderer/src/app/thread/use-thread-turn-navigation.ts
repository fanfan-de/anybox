import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import type { ThreadTurn, UserThreadMessage } from "../types"
import type { ThreadDisplayRow } from "./thread-display-rows"
import type { ThreadRowVirtualizer } from "./use-thread-virtual-list"

const THREAD_TURN_TITLE_MAX_CHARACTERS = 180
const THREAD_TURN_READING_LINE_OFFSET_PX = 24

export interface ThreadTurnNavigationItem {
  accessibleTitle: string
  isRunning: boolean
  rowIndex: number
  title: string
  turnID: string
  userMessageID: string
}

function normalizeThreadTurnTitle(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function truncateThreadTurnTitle(value: string) {
  const characters = Array.from(value)
  if (characters.length <= THREAD_TURN_TITLE_MAX_CHARACTERS) return value
  return `${characters.slice(0, THREAD_TURN_TITLE_MAX_CHARACTERS - 1).join("")}…`
}

function getThreadTurnUserMessage(turn: ThreadTurn) {
  if (!turn.userMessageID) return null

  return turn.messages.find(
    (message): message is UserThreadMessage => message.kind === "user" && message.id === turn.userMessageID,
  ) ?? null
}

function getThreadTurnUserMessageTitle(message: UserThreadMessage) {
  const preferredText = normalizeThreadTurnTitle(message.displayText ?? "")
  if (preferredText) return preferredText

  const rawText = normalizeThreadTurnTitle(message.text)
  if (rawText) return rawText

  const referenceText = normalizeThreadTurnTitle(
    (message.references ?? [])
      .map((reference) => reference.title || reference.label)
      .filter(Boolean)
      .join(" · "),
  )
  return referenceText || "用户请求"
}

export function buildThreadTurnNavigationItems(
  turns: ThreadTurn[],
  displayRows: ThreadDisplayRow[],
) {
  const userRowIndexByMessageID = new Map<string, number>()
  const executionSummaryRowIndexByTurnID = new Map<string, number>()
  displayRows.forEach((row, rowIndex) => {
    if (row.kind === "user-message") {
      userRowIndexByMessageID.set(row.message.id, rowIndex)
    } else if (row.kind === "assistant-execution-summary") {
      executionSummaryRowIndexByTurnID.set(row.turnID, rowIndex)
    }
  })

  const seenUserMessageIDs = new Set<string>()
  const items: ThreadTurnNavigationItem[] = []
  for (const turn of turns) {
    const userMessage = getThreadTurnUserMessage(turn)
    if (!userMessage || seenUserMessageIDs.has(userMessage.id)) continue

    const rowIndex = executionSummaryRowIndexByTurnID.get(turn.turnID) ?? userRowIndexByMessageID.get(userMessage.id)
    if (rowIndex === undefined) continue

    const accessibleTitle = getThreadTurnUserMessageTitle(userMessage)
    seenUserMessageIDs.add(userMessage.id)
    items.push({
      accessibleTitle,
      isRunning: turn.status === "running",
      rowIndex,
      title: truncateThreadTurnTitle(accessibleTitle),
      turnID: turn.turnID,
      userMessageID: userMessage.id,
    })
  }

  return items
}

export function findThreadMessageNavigationRowIndex(
  displayRows: readonly ThreadDisplayRow[],
  messageID: string,
) {
  const actionsRowIndex = displayRows.findIndex(
    (row) =>
      row.kind === "assistant-actions" &&
      row.threadMessageID === messageID,
  )
  if (actionsRowIndex < 0) return -1

  const actionsRow = displayRows[actionsRowIndex]
  if (actionsRow?.kind !== "assistant-actions") return actionsRowIndex

  let responseRowIndex = -1
  for (let index = 0; index < actionsRowIndex; index += 1) {
    const row = displayRows[index]
    if (
      (row?.kind === "assistant-response-row" || row?.kind === "assistant-question-row") &&
      row.ownerMessageID === actionsRow.ownerMessageID
    ) {
      responseRowIndex = index
      break
    }
  }

  const responseStartRowIndex = responseRowIndex >= 0 ? responseRowIndex : actionsRowIndex
  for (let index = responseStartRowIndex - 1; index >= 0; index -= 1) {
    const row = displayRows[index]
    if (
      row?.kind === "user-message" &&
      row.messageIndex < actionsRow.ownerMessageIndex
    ) {
      return index
    }
  }

  return responseStartRowIndex
}

interface UseThreadTurnNavigationInput {
  items: ThreadTurnNavigationItem[]
  measurementKey: string
  resetKey: string
  threadColumnRef: RefObject<HTMLDivElement | null>
  virtualizer: ThreadRowVirtualizer
}

function getThreadTurnReadingRowIndex(virtualizer: ThreadRowVirtualizer, readingLine: number) {
  let readingRowIndex: number | null = null
  for (const virtualItem of virtualizer.getVirtualItems()) {
    if (virtualItem.start > readingLine) break
    readingRowIndex = virtualItem.index
  }
  return readingRowIndex
}

function areIndexListsEqual(left: readonly number[], right: readonly number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function useThreadTurnNavigation({
  items,
  measurementKey,
  resetKey,
  threadColumnRef,
  virtualizer,
}: UseThreadTurnNavigationInput) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [visibleIndexes, setVisibleIndexes] = useState<number[]>([0])
  const currentIndexRef = useRef(0)
  const visibleIndexesRef = useRef<number[]>([0])
  const pendingFrameRef = useRef<number | null>(null)

  const updateCurrentIndex = useCallback(() => {
    const threadColumn = threadColumnRef.current
    if (!threadColumn || items.length === 0) return

    const readingLine = threadColumn.scrollTop + THREAD_TURN_READING_LINE_OFFSET_PX
    let nextIndex = 0
    const readingRowIndex = getThreadTurnReadingRowIndex(virtualizer, readingLine)
    if (readingRowIndex !== null) {
      for (let index = 0; index < items.length; index += 1) {
        if (items[index]!.rowIndex > readingRowIndex) break
        nextIndex = index
      }
    } else {
      for (let index = 0; index < items.length; index += 1) {
        const offset = virtualizer.getOffsetForIndex(items[index]!.rowIndex, "start")?.[0]
        if (offset === undefined || offset > readingLine) break
        nextIndex = index
      }
    }

    const viewportTop = threadColumn.scrollTop
    const viewportBottom = viewportTop + threadColumn.clientHeight
    const turnOffsets = items.map(
      (item) => virtualizer.getOffsetForIndex(item.rowIndex, "start")?.[0],
    )
    const nextVisibleIndexes: number[] = []
    for (let index = 0; index < items.length; index += 1) {
      const turnStart = turnOffsets[index]
      if (turnStart === undefined) continue

      const nextTurnStart = turnOffsets[index + 1] ?? Number.POSITIVE_INFINITY
      if (turnStart < viewportBottom && nextTurnStart > viewportTop) {
        nextVisibleIndexes.push(index)
      }
    }
    if (nextVisibleIndexes.length === 0) nextVisibleIndexes.push(nextIndex)

    if (nextIndex !== currentIndexRef.current) {
      currentIndexRef.current = nextIndex
      setCurrentIndex(nextIndex)
    }
    if (!areIndexListsEqual(nextVisibleIndexes, visibleIndexesRef.current)) {
      visibleIndexesRef.current = nextVisibleIndexes
      setVisibleIndexes(nextVisibleIndexes)
    }
  }, [items, threadColumnRef, virtualizer])

  const runScheduledCurrentIndexUpdate = useCallback(() => {
    pendingFrameRef.current = null
    updateCurrentIndex()
  }, [updateCurrentIndex])

  const scheduleCurrentIndexUpdate = useCallback(() => {
    if (pendingFrameRef.current !== null) return
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      updateCurrentIndex()
      return
    }

    pendingFrameRef.current = window.requestAnimationFrame(runScheduledCurrentIndexUpdate)
  }, [runScheduledCurrentIndexUpdate, updateCurrentIndex])

  useEffect(() => {
    if (currentIndexRef.current !== 0) {
      currentIndexRef.current = 0
      setCurrentIndex(0)
    }
    if (!areIndexListsEqual(visibleIndexesRef.current, [0])) {
      visibleIndexesRef.current = [0]
      setVisibleIndexes([0])
    }
  }, [resetKey])

  useEffect(() => {
    scheduleCurrentIndexUpdate()
  }, [items, measurementKey, scheduleCurrentIndexUpdate])

  useEffect(() => () => {
    if (pendingFrameRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(pendingFrameRef.current)
    }
  }, [])

  return {
    currentIndex,
    scheduleCurrentIndexUpdate,
    updateCurrentIndex,
    visibleIndexes,
  }
}
