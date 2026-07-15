import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { OpenExternalIcon, PreviewIcon } from "./icons"

interface ThreadLinkRoutingContextValue {
  openInAnybox: (href: string) => void
}

interface ThreadLinkRoutingProviderProps extends ThreadLinkRoutingContextValue {
  children: ReactNode
}

interface ThreadExternalLinkProps {
  children: ReactNode
  className?: string
  href: string
  title?: string
}

interface LinkContextMenuState {
  href: string
  x: number
  y: number
}

const ThreadLinkRoutingContext = createContext<ThreadLinkRoutingContextValue | null>(null)
const LINK_CONTEXT_MENU_MARGIN = 8

export function ThreadLinkRoutingProvider({ children, openInAnybox }: ThreadLinkRoutingProviderProps) {
  const value = useMemo(() => ({ openInAnybox }), [openInAnybox])
  return (
    <ThreadLinkRoutingContext.Provider value={value}>
      {children}
    </ThreadLinkRoutingContext.Provider>
  )
}

export function useThreadLinkRouting() {
  return useContext(ThreadLinkRoutingContext)
}

export function openExternalThreadLink(href: string) {
  const openExternalUrl = window.desktop?.openExternalUrl
  if (openExternalUrl) {
    void openExternalUrl({ url: href }).catch((error) => {
      console.error("[desktop] Failed to open external URL.", error)
      window.open(href, "_blank", "noopener,noreferrer")
    })
    return
  }

  window.open(href, "_blank", "noopener,noreferrer")
}

function clampLinkContextMenuPosition(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(LINK_CONTEXT_MENU_MARGIN, Math.min(x, window.innerWidth - width - LINK_CONTEXT_MENU_MARGIN)),
    y: Math.max(LINK_CONTEXT_MENU_MARGIN, Math.min(y, window.innerHeight - height - LINK_CONTEXT_MENU_MARGIN)),
  }
}

function ThreadLinkContextMenu({
  menu,
  onClose,
  onOpenInAnybox,
}: {
  menu: LinkContextMenuState
  onClose: () => void
  onOpenInAnybox: (href: string) => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ x: menu.x, y: menu.y })

  useLayoutEffect(() => {
    const element = menuRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    setPosition(clampLinkContextMenuPosition(menu.x, menu.y, rect.width, rect.height))
    element.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [menu.x, menu.y])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      onClose()
    }

    function handleDismiss() {
      onClose()
    }

    document.addEventListener("pointerdown", handlePointerDown, { capture: true })
    document.addEventListener("scroll", handleDismiss, { capture: true, passive: true })
    window.addEventListener("blur", handleDismiss)
    window.addEventListener("resize", handleDismiss)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, { capture: true })
      document.removeEventListener("scroll", handleDismiss, { capture: true })
      window.removeEventListener("blur", handleDismiss)
      window.removeEventListener("resize", handleDismiss)
    }
  }, [onClose])

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return

    event.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
    if (items.length === 0) return
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const delta = event.key === "ArrowDown" ? 1 : -1
    items[(currentIndex + delta + items.length) % items.length]?.focus()
  }

  return createPortal(
    <div
      ref={menuRef}
      className="ui-context-menu thread-link-context-menu"
      role="menu"
      aria-label="链接打开方式"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleMenuKeyDown}
    >
      <button
        className="ui-context-menu__item"
        role="menuitem"
        type="button"
        onClick={() => {
          onOpenInAnybox(menu.href)
          onClose()
        }}
      >
        <span className="ui-context-menu__icon" aria-hidden="true"><PreviewIcon /></span>
        <span className="ui-context-menu__label">在 Anybox 内置浏览器中打开</span>
      </button>
      <button
        className="ui-context-menu__item"
        role="menuitem"
        type="button"
        onClick={() => {
          openExternalThreadLink(menu.href)
          onClose()
        }}
      >
        <span className="ui-context-menu__icon" aria-hidden="true"><OpenExternalIcon /></span>
        <span className="ui-context-menu__label">在系统浏览器中打开</span>
      </button>
    </div>,
    document.body,
  )
}

export function ThreadExternalLink({ children, className, href, title }: ThreadExternalLinkProps) {
  const routing = useThreadLinkRouting()
  const [contextMenu, setContextMenu] = useState<LinkContextMenuState | null>(null)

  function openInAnybox() {
    if (routing) {
      routing.openInAnybox(href)
      return
    }
    openExternalThreadLink(href)
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented) return
    event.preventDefault()
    openInAnybox()
  }

  function handleContextMenu(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ href, x: event.clientX, y: event.clientY })
  }

  return (
    <>
      <a
        className={className}
        href={href}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        title={title}
      >
        {children}
      </a>
      {contextMenu ? (
        <ThreadLinkContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpenInAnybox={openInAnybox}
        />
      ) : null}
    </>
  )
}

export function ThreadFrameLinkContextMenu({
  menu,
  onClose,
}: {
  menu: LinkContextMenuState | null
  onClose: () => void
}) {
  const routing = useThreadLinkRouting()
  if (!menu) return null

  return (
    <ThreadLinkContextMenu
      menu={menu}
      onClose={onClose}
      onOpenInAnybox={(href) => {
        if (routing) routing.openInAnybox(href)
        else openExternalThreadLink(href)
      }}
    />
  )
}

export type { LinkContextMenuState }
