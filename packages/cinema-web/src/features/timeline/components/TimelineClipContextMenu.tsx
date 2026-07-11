import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

export type TimelineClipContextMenuState = {
  x: number
  y: number
  label: string
  returnFocus: HTMLElement
}

export type TimelineClipContextMenuAction = {
  id: string
  label: string
  icon: ReactNode
  shortcut?: string
  disabled?: boolean
  variant?: "default" | "danger"
  onSelect: () => void
}

function clampedMenuPosition(x: number, y: number, width: number, height: number) {
  const margin = 8
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
  }
}

export function TimelineClipContextMenu({
  menu,
  actions,
  onClose,
}: {
  menu: TimelineClipContextMenuState | null
  actions: readonly TimelineClipContextMenuAction[]
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef(true)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [position, setPosition] = useState({ x: menu?.x ?? 0, y: menu?.y ?? 0 })

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    setPosition(clampedMenuPosition(menu.x, menu.y, rect.width, rect.height))
  }, [actions.length, menu])

  useEffect(() => {
    if (!menu) return
    restoreFocusRef.current = true
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
    })
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      onCloseRef.current()
    }
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }
    const close = () => onCloseRef.current()
    document.addEventListener("pointerdown", closeOnPointerDown)
    document.addEventListener("keydown", closeOnKeyDown, true)
    window.addEventListener("resize", close)
    window.addEventListener("scroll", close, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener("pointerdown", closeOnPointerDown)
      document.removeEventListener("keydown", closeOnKeyDown, true)
      window.removeEventListener("resize", close)
      window.removeEventListener("scroll", close, true)
      if (restoreFocusRef.current) menu.returnFocus.focus()
    }
  }, [menu])

  if (!menu) return null

  return createPortal(
    <div
      ref={menuRef}
      className="cinema-context-menu"
      role="menu"
      aria-label={menu.label}
      style={{ left: position.x, top: position.y }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return
        event.preventDefault()
        event.stopPropagation()
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")]
        if (items.length === 0) return
        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
        const nextIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : event.key === "ArrowDown"
              ? (currentIndex + 1 + items.length) % items.length
              : (currentIndex - 1 + items.length) % items.length
        items[nextIndex]?.focus()
      }}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          className="cinema-context-menu-item"
          data-variant={action.variant ?? "default"}
          disabled={action.disabled}
          onClick={() => {
            if (action.disabled) return
            restoreFocusRef.current = false
            onClose()
            action.onSelect()
          }}
        >
          <span className="cinema-context-menu-icon" aria-hidden="true">{action.icon}</span>
          <span className="cinema-context-menu-label">{action.label}</span>
          {action.shortcut ? <span className="cinema-context-menu-shortcut">{action.shortcut}</span> : null}
        </button>
      ))}
    </div>,
    document.body,
  )
}
