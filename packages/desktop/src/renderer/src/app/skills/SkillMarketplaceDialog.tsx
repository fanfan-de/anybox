import {
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { CloseIcon } from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { useBoundedOverlayDrag } from "./use-bounded-overlay-drag"

export interface SkillMarketplaceDialogProps {
  children: ReactNode
  onClose: () => void
  open: boolean
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

const SEARCH_INPUT_SELECTOR = [
  "input[type='search']:not([disabled])",
  "input[role='searchbox']:not([disabled])",
  "[role='searchbox'][tabindex]:not([tabindex='-1'])",
].join(",")

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) =>
    element.tabIndex >= 0 &&
    !element.hidden &&
    element.getAttribute("aria-hidden") !== "true" &&
    !element.closest("[hidden], [inert]"),
  )
}

function focusWithoutScrolling(element: HTMLElement) {
  element.focus({ preventScroll: true })
}

export function SkillMarketplaceDialog({
  children,
  onClose,
  open,
}: SkillMarketplaceDialogProps) {
  const { t } = useI18n()
  const titleID = useId()
  const descriptionID = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const {
    isDragging,
    offset,
    onDragHandlePointerDown,
    overlayRef,
    positionerRef,
  } = useBoundedOverlayDrag({ open })

  useLayoutEffect(() => {
    if (!open || typeof document === "undefined") return

    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    const focusDialog = () => {
      const dialogElement = dialogRef.current
      if (!dialogElement) return

      const searchInput = dialogElement.querySelector<HTMLElement>(SEARCH_INPUT_SELECTOR)
      focusWithoutScrolling(searchInput ?? getFocusableElements(dialogElement)[0] ?? dialogElement)
    }

    let animationFrame: number | null = null
    if (typeof window.requestAnimationFrame === "function") {
      animationFrame = window.requestAnimationFrame(focusDialog)
    } else {
      focusDialog()
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        return
      }
      if (event.key !== "Tab") return

      const dialogElement = dialogRef.current
      if (!dialogElement) return

      const focusableElements = getFocusableElements(dialogElement)
      if (focusableElements.length === 0) {
        event.preventDefault()
        focusWithoutScrolling(dialogElement)
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
      const focusIsInsideDialog = Boolean(activeElement && dialogElement.contains(activeElement))

      if (event.shiftKey) {
        if (!focusIsInsideDialog || activeElement === firstElement) {
          event.preventDefault()
          focusWithoutScrolling(lastElement)
        }
        return
      }

      if (!focusIsInsideDialog || activeElement === lastElement) {
        event.preventDefault()
        focusWithoutScrolling(firstElement)
      }
    }

    window.addEventListener("keydown", handleWindowKeyDown, true)
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown, true)
      if (animationFrame !== null && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(animationFrame)
      }

      const returnFocusElement = returnFocusRef.current
      returnFocusRef.current = null
      if (returnFocusElement?.isConnected) focusWithoutScrolling(returnFocusElement)
    }
  }, [open])

  if (!open || typeof document === "undefined") return null

  const portalTarget = document.querySelector<HTMLElement>(".app-shell") ?? document.body

  return createPortal(
    <div
      ref={overlayRef}
      className={isDragging
        ? "skill-marketplace-overlay is-dragging"
        : "skill-marketplace-overlay"}
      role="presentation"
    >
      <div
        ref={positionerRef}
        className="skill-marketplace-dialog-positioner"
        style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
      >
        <section
          ref={dialogRef}
          className={isDragging
            ? "skill-marketplace-dialog is-dragging"
            : "skill-marketplace-dialog"}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleID}
          aria-describedby={descriptionID}
          tabIndex={-1}
        >
          <header
            className="skill-marketplace-dialog-header"
            onPointerDown={onDragHandlePointerDown}
          >
            <div className="skill-marketplace-dialog-heading">
              <h2 id={titleID}>{t("skillLibrary.marketplace.title")}</h2>
              <p id={descriptionID}>{t("skillLibrary.marketplace.description")}</p>
            </div>
            <button
              className="skill-marketplace-dialog-close-button"
              type="button"
              aria-label={t("skillLibrary.marketplace.close")}
              title={t("skillLibrary.marketplace.close")}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </header>
          <div className="skill-marketplace-dialog-content">
            {children}
          </div>
        </section>
      </div>
    </div>,
    portalTarget,
  )
}
