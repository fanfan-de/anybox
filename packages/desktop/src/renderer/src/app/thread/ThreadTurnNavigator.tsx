import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react"
import type { ThreadTurnNavigationItem } from "./use-thread-turn-navigation"

interface ThreadTurnNavigatorProps {
  currentIndex: number
  items: ThreadTurnNavigationItem[]
  onNavigate: (item: ThreadTurnNavigationItem) => void
  visibleIndexes: readonly number[]
}

function getTurnButtonLabel(item: ThreadTurnNavigationItem, index: number, total: number) {
  return `跳转到第 ${index + 1} / ${total} 轮：${item.accessibleTitle}`
}

export function ThreadTurnNavigator({
  currentIndex,
  items,
  onNavigate,
  visibleIndexes,
}: ThreadTurnNavigatorProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [isLabelDismissed, setIsLabelDismissed] = useState(false)
  const [isCompactOpen, setIsCompactOpen] = useState(false)
  const [labelTop, setLabelTop] = useState(0)
  const rootRef = useRef<HTMLElement | null>(null)
  const markerListRef = useRef<HTMLDivElement | null>(null)
  const markerButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const compactButtonRefs = useRef<Array<HTMLButtonElement | null>>([])
  const labelIndex = isLabelDismissed ? null : (focusedIndex ?? hoveredIndex)
  const currentItem = items[currentIndex] ?? items[0]
  const visibleIndexSet = useMemo(() => new Set(visibleIndexes), [visibleIndexes])

  const labelText = useMemo(() => {
    if (labelIndex === null) return ""
    const item = items[labelIndex]
    if (!item) return ""
    return `第 ${labelIndex + 1} / ${items.length} 轮 · ${item.title}`
  }, [items, labelIndex])

  function updateLabelPosition(index: number) {
    const root = rootRef.current
    const button = markerButtonRefs.current[index]
    if (!root || !button) return

    const rootRect = root.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    setLabelTop(buttonRect.top - rootRect.top + buttonRect.height / 2)
  }

  useLayoutEffect(() => {
    if (labelIndex !== null) updateLabelPosition(labelIndex)
  }, [labelIndex])

  useLayoutEffect(() => {
    const list = markerListRef.current
    const button = markerButtonRefs.current[currentIndex]
    if (!list || !button) return

    const buttonTop = button.offsetTop
    const buttonBottom = buttonTop + button.offsetHeight
    if (buttonTop < list.scrollTop) {
      list.scrollTop = buttonTop
    } else if (buttonBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = buttonBottom - list.clientHeight
    }
  }, [currentIndex])

  if (items.length === 0 || !currentItem) return null

  function focusTurnButton(index: number, compact: boolean) {
    const nextIndex = Math.min(items.length - 1, Math.max(0, index))
    const refs = compact ? compactButtonRefs : markerButtonRefs
    refs.current[nextIndex]?.focus()
  }

  function handleTurnButtonKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    compact: boolean,
  ) {
    let focusIndex: number | null = null
    if (event.key === "ArrowUp") focusIndex = index - 1
    if (event.key === "ArrowDown") focusIndex = index + 1
    if (event.key === "Home") focusIndex = 0
    if (event.key === "End") focusIndex = items.length - 1

    if (focusIndex !== null) {
      event.preventDefault()
      setIsLabelDismissed(false)
      focusTurnButton(focusIndex, compact)
      return
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onNavigate(items[index]!)
      if (compact) setIsCompactOpen(false)
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      setIsLabelDismissed(true)
      setIsCompactOpen(false)
    }
  }

  return (
    <nav ref={rootRef} className="thread-turn-navigator" aria-label="对话轮次导航">
      <div
        ref={markerListRef}
        className="thread-turn-navigator-markers"
        onScroll={() => {
          if (labelIndex !== null) updateLabelPosition(labelIndex)
        }}
      >
        {items.map((item, index) => (
          <button
            key={`${item.turnID}:${item.userMessageID}`}
            ref={(node) => {
              markerButtonRefs.current[index] = node
            }}
            className="thread-turn-navigator-marker"
            type="button"
            aria-current={index === currentIndex ? "step" : undefined}
            aria-label={getTurnButtonLabel(item, index, items.length)}
            data-visible={visibleIndexSet.has(index) ? "true" : undefined}
            data-running={item.isRunning ? "true" : undefined}
            onBlur={() => setFocusedIndex((current) => (current === index ? null : current))}
            onClick={() => onNavigate(item)}
            onFocus={() => {
              setFocusedIndex(index)
              setIsLabelDismissed(false)
            }}
            onKeyDown={(event) => handleTurnButtonKeyDown(event, index, false)}
            onMouseEnter={() => {
              setHoveredIndex(index)
              setIsLabelDismissed(false)
            }}
            onMouseLeave={() => setHoveredIndex((current) => (current === index ? null : current))}
          >
            <span className="thread-turn-navigator-marker-line" aria-hidden="true" />
          </button>
        ))}
      </div>

      {labelIndex !== null && labelText ? (
        <div
          className="thread-turn-navigator-label"
          role="tooltip"
          style={{ "--thread-turn-label-top": `${labelTop}px` } as CSSProperties}
        >
          {labelText}
        </div>
      ) : null}

      <div className="thread-turn-navigator-compact">
        <button
          className="thread-turn-navigator-compact-trigger"
          type="button"
          aria-expanded={isCompactOpen}
          aria-haspopup="dialog"
          aria-label={`当前第 ${currentIndex + 1} / ${items.length} 轮，打开对话轮次导航`}
          onClick={() => setIsCompactOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              setIsCompactOpen(false)
            }
          }}
        >
          第 {currentIndex + 1}/{items.length} 轮
        </button>
        {isCompactOpen ? (
          <div className="thread-turn-navigator-compact-popover" role="dialog" aria-label="选择对话轮次">
            {items.map((item, index) => (
              <button
                key={`compact:${item.turnID}:${item.userMessageID}`}
                ref={(node) => {
                  compactButtonRefs.current[index] = node
                }}
                className="thread-turn-navigator-compact-item"
                type="button"
                aria-current={index === currentIndex ? "step" : undefined}
                aria-label={getTurnButtonLabel(item, index, items.length)}
                data-current={index === currentIndex ? "true" : undefined}
                onClick={() => {
                  onNavigate(item)
                  setIsCompactOpen(false)
                }}
                onKeyDown={(event) => handleTurnButtonKeyDown(event, index, true)}
              >
                <span className="thread-turn-navigator-compact-index">{index + 1}</span>
                <span className="thread-turn-navigator-compact-title">{item.title}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </nav>
  )
}
