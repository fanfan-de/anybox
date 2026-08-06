import { createPortal } from "react-dom"
import { useEffect, useRef } from "react"
import { CheckIcon } from "./icons"
import { useI18n } from "./i18n/I18nProvider"
import type { ShellLayoutMode } from "./shell-layout"

interface ShellLayoutSwitcherProps {
  isOpen: boolean
  mode: ShellLayoutMode
  onClose: () => void
  onModeChange: (mode: ShellLayoutMode) => void
}

const SHELL_LAYOUT_OPTIONS: ShellLayoutMode[] = ["workbench-primary", "tools-primary"]

export function ShellLayoutSwitcher({
  isOpen,
  mode,
  onClose,
  onModeChange,
}: ShellLayoutSwitcherProps) {
  const { t } = useI18n()
  const optionRefs = useRef<Partial<Record<ShellLayoutMode, HTMLButtonElement | null>>>({})
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const focusFrame = window.requestAnimationFrame(() => {
      optionRefs.current[mode]?.focus()
    })

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key === "Tab") {
        event.preventDefault()
        const focusedOption = SHELL_LAYOUT_OPTIONS.find(
          (option) => optionRefs.current[option] === document.activeElement,
        )
        optionRefs.current[focusedOption ?? mode]?.focus()
        return
      }

      const activeIndex = SHELL_LAYOUT_OPTIONS.findIndex(
        (option) => optionRefs.current[option] === document.activeElement,
      )
      let nextIndex: number | null = null
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % SHELL_LAYOUT_OPTIONS.length
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        nextIndex = activeIndex < 0
          ? SHELL_LAYOUT_OPTIONS.length - 1
          : (activeIndex - 1 + SHELL_LAYOUT_OPTIONS.length) % SHELL_LAYOUT_OPTIONS.length
      } else if (event.key === "Home") {
        nextIndex = 0
      } else if (event.key === "End") {
        nextIndex = SHELL_LAYOUT_OPTIONS.length - 1
      }

      if (nextIndex === null) return
      event.preventDefault()
      optionRefs.current[SHELL_LAYOUT_OPTIONS[nextIndex]]?.focus()
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener("keydown", handleKeyDown, true)
      previousFocusRef.current?.focus()
      previousFocusRef.current = null
    }
  }, [isOpen, mode, onClose])

  if (!isOpen || typeof document === "undefined") return null

  return createPortal(
    <div
      className="shell-layout-switcher-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="shell-layout-switcher"
        aria-label={t("shellLayout.switcherTitle")}
        aria-modal="true"
        role="dialog"
      >
        <header className="shell-layout-switcher-header">
          <span>{t("shellLayout.switcherTitle")}</span>
          <kbd>{t("shellLayout.shortcut")}</kbd>
        </header>
        <div
          className="shell-layout-switcher-options"
          aria-label={t("shellLayout.switcherTitle")}
          role="radiogroup"
        >
          {SHELL_LAYOUT_OPTIONS.map((option) => {
            const isSelected = mode === option
            const label = option === "workbench-primary"
              ? t("shellLayout.workbenchPrimary")
              : t("shellLayout.toolsPrimary")

            return (
              <button
                key={option}
                ref={(node) => {
                  optionRefs.current[option] = node
                }}
                type="button"
                className={[
                  "shell-layout-switcher-option",
                  isSelected ? "is-selected" : "",
                ].filter(Boolean).join(" ")}
                aria-checked={isSelected}
                role="radio"
                tabIndex={isSelected ? 0 : -1}
                onClick={() => onModeChange(option)}
              >
                <span
                  className={`shell-layout-switcher-glyph is-${option}`}
                  aria-hidden="true"
                >
                  <span className="shell-layout-switcher-glyph-surface is-workbench" />
                  <span className="shell-layout-switcher-glyph-surface is-tools" />
                </span>
                <span className="shell-layout-switcher-option-label">{label}</span>
                <span className="shell-layout-switcher-option-status" aria-hidden="true">
                  {isSelected ? <CheckIcon /> : null}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </div>,
    document.body,
  )
}
