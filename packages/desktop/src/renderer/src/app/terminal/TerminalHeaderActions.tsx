import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { createPortal } from "react-dom"
import { CheckIcon, MoreIcon, ResetIcon, StopIcon, TerminalIcon } from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import type { TerminalSessionRecord, TerminalShellProfile } from "./types"

interface TerminalHeaderActionsProps {
  isBusy: boolean
  session: TerminalSessionRecord
  shellProfiles: TerminalShellProfile[]
  onCloseTerminal: (ptyID: string) => void | Promise<void>
  onRestartTerminal: (ptyID: string, profileID?: string) => void | Promise<void>
}

interface MenuPosition {
  left: number
  top: number
}

const MENU_WIDTH = 224
const MENU_MARGIN = 8
const MENU_GAP = 6

function normalizeShellCommand(value: string) {
  return value.trim().replaceAll("\\", "/").toLowerCase()
}

function findActiveShellProfileID(session: TerminalSessionRecord, profiles: TerminalShellProfile[]) {
  const activeShell = normalizeShellCommand(session.shell)
  if (!activeShell) return null

  return profiles.find((profile) => {
    if (!profile.shell) return false
    const profileShell = normalizeShellCommand(profile.shell)
    return activeShell === profileShell || activeShell.endsWith(`/${profileShell}`)
  })?.id ?? null
}

function positionMenu(trigger: HTMLButtonElement): MenuPosition {
  const rect = trigger.getBoundingClientRect()
  return {
    left: Math.max(
      MENU_MARGIN,
      Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - MENU_MARGIN),
    ),
    top: rect.bottom + MENU_GAP,
  }
}

export const TerminalHeaderActions = memo(function TerminalHeaderActions({
  isBusy,
  session,
  shellProfiles,
  onCloseTerminal,
  onRestartTerminal,
}: TerminalHeaderActionsProps) {
  const { t } = useI18n()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const activeProfileID = findActiveShellProfileID(session, shellProfiles)
  const actionsLabel = `${t("terminal.title")} · ${t("app.reset")} / ${t("app.close")}`

  function closeMenu({ restoreFocus = false } = {}) {
    setMenuPosition(null)
    if (restoreFocus) triggerRef.current?.focus()
  }

  function runAction(action: () => void | Promise<void>) {
    closeMenu()
    void action()
  }

  useEffect(() => {
    if (!menuPosition) return

    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>(".ui-context-menu__item:not(:disabled)")
        ?.focus()
    })

    function handleDocumentPointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu()
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      closeMenu({ restoreFocus: true })
    }

    function handleViewportChange() {
      closeMenu()
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown)
    document.addEventListener("keydown", handleDocumentKeyDown)
    window.addEventListener("resize", handleViewportChange)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener("pointerdown", handleDocumentPointerDown)
      document.removeEventListener("keydown", handleDocumentKeyDown)
      window.removeEventListener("resize", handleViewportChange)
    }
  }, [menuPosition])

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      if (event.key === "Tab") closeMenu()
      return
    }

    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(".ui-context-menu__item:not(:disabled)") ?? [],
    )
    if (items.length === 0) return

    event.preventDefault()
    const currentIndex = items.findIndex((item) => item === document.activeElement)
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1 + items.length) % items.length
          : (currentIndex - 1 + items.length) % items.length
    items[nextIndex]?.focus()
  }

  return (
    <div className="terminal-header-actions">
      <button
        ref={triggerRef}
        aria-expanded={Boolean(menuPosition)}
        aria-haspopup="menu"
        aria-label={actionsLabel}
        className={menuPosition ? "terminal-header-actions-trigger is-active" : "terminal-header-actions-trigger"}
        disabled={isBusy}
        title={`${actionsLabel} · ${session.shell} · ${session.cwd}`}
        type="button"
        onClick={() => {
          if (menuPosition) {
            closeMenu()
            return
          }
          if (triggerRef.current) setMenuPosition(positionMenu(triggerRef.current))
        }}
      >
        <MoreIcon />
      </button>

      {menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              aria-label={actionsLabel}
              className="ui-context-menu terminal-header-actions-menu"
              role="menu"
              style={menuPosition}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={handleMenuKeyDown}
            >
              <button
                className="ui-context-menu__item"
                disabled={isBusy}
                role="menuitem"
                type="button"
                onClick={() => runAction(() => onRestartTerminal(session.ptyID))}
              >
                <span className="ui-context-menu__icon" aria-hidden="true"><ResetIcon /></span>
                <span className="ui-context-menu__label">{t("terminal.title")} · {t("app.reset")}</span>
              </button>

              <div className="ui-context-menu__divider" role="separator" />
              <div className="terminal-header-actions-section-label">
                {t("tools.shell")} · {t("app.reset")}
              </div>

              {shellProfiles.map((profile) => {
                const isActive = profile.id === activeProfileID
                return (
                  <button
                    key={profile.id}
                    aria-checked={isActive}
                    aria-label={`${t("tools.shell")} · ${profile.label}`}
                    className="ui-context-menu__item"
                    disabled={isBusy}
                    role="menuitemradio"
                    type="button"
                    onClick={() => runAction(() => onRestartTerminal(session.ptyID, profile.id))}
                  >
                    <span className="ui-context-menu__icon" aria-hidden="true">
                      {isActive ? <CheckIcon /> : <TerminalIcon />}
                    </span>
                    <span className="ui-context-menu__label">{profile.label}</span>
                  </button>
                )
              })}

              <div className="ui-context-menu__divider" role="separator" />
              <button
                className="ui-context-menu__item"
                data-variant="danger"
                disabled={isBusy}
                role="menuitem"
                type="button"
                onClick={() => runAction(() => onCloseTerminal(session.ptyID))}
              >
                <span className="ui-context-menu__icon terminal-header-stop-icon" aria-hidden="true"><StopIcon /></span>
                <span className="ui-context-menu__label">{t("terminal.closeTerminal")}</span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
})
