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
  displayRows.forEach((row, rowIndex) => {
    if (row.kind === "user-message") {
      userRowIndexByMessageID.set(row.message.id, rowIndex)
    }
  })

  const seenUserMessageIDs = new Set<string>()
  const items: ThreadTurnNavigationItem[] = []
  for (const turn of turns) {
    const userMessage = getThreadTurnUserMessage(turn)
    if (!userMessage || seenUserMessageIDs.has(userMessage.id)) continue

    const rowIndex = userRowIndexByMessageID.get(userMessage.id)
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

interface UseThreadTurnNavigationInput {
  items: ThreadTurnNavigationItem[]
  measurementKey: string
  resetKey: string
  threadColumnRef: RefObject<HTMLDivElement | null>
  virtualizer: ThreadRowVirtualizer
}

export function useThreadTurnNavigation({
  items,
  measurementKey,
  resetKey,
  threadColumnRef,
  virtualizer,
}: UseThreadTurnNavigationInput) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const currentIndexRef = useRef(0)
  const pendingFrameRef = useRef<number | null>(null)

  const updateCurrentIndex = useCallback(() => {
    pendingFrameRef.current = null
    const threadColumn = threadColumnRef.current
    if (!threadColumn || items.length === 0) return

    const readingLine = threadColumn.scrollTop + THREAD_TURN_READING_LINE_OFFSET_PX
    let nextIndex = 0
    for (let index = 0; index < items.length; index += 1) {
      const offset = virtualizer.getOffsetForIndex(items[index]!.rowIndex, "start")?.[0]
      if (offset === undefined || offset > readingLine) break
      nextIndex = index
    }

    if (nextIndex === currentIndexRef.current) return
    currentIndexRef.current = nextIndex
    setCurrentIndex(nextIndex)
  }, [items, threadColumnRef, virtualizer])

  const scheduleCurrentIndexUpdate = useCallback(() => {
    if (pendingFrameRef.current !== null) return
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      updateCurrentIndex()
      return
    }

    pendingFrameRef.current = window.requestAnimationFrame(updateCurrentIndex)
  }, [updateCurrentIndex])

  useEffect(() => {
    if (currentIndexRef.current !== 0) {
      currentIndexRef.current = 0
      setCurrentIndex(0)
    }
  }, [resetKey])

  useEffect(() => {
    scheduleCurrentIndexUpdate()
  }, [items, measurementKey, scheduleCurrentIndexUpdate])

  useEffect(() => {
    const threadColumn = threadColumnRef.current
    if (!threadColumn) return

    threadColumn.addEventListener("scroll", scheduleCurrentIndexUpdate, { passive: true })
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleCurrentIndexUpdate)
    resizeObserver?.observe(threadColumn)

    return () => {
      threadColumn.removeEventListener("scroll", scheduleCurrentIndexUpdate)
      resizeObserver?.disconnect()
    }
  }, [scheduleCurrentIndexUpdate, threadColumnRef])

  useEffect(() => () => {
    if (pendingFrameRef.current !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(pendingFrameRef.current)
    }
  }, [])

  return currentIndex
}
