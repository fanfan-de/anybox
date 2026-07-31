import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import { memo, useEffect, useEffectEvent, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from "react-dom"
import type { AppearanceCodeFontFamily } from "../../../../shared/appearance"
import { resolveCodeFontFamilyStack } from "../code-font"
import { CopyIcon } from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { writeTextToClipboard } from "../shared-ui"
import type { BrandTheme, ColorMode } from "../types"
import type { TerminalSessionRecord, TerminalStreamEvent } from "./types"

const TERMINAL_CONTEXT_MENU_WIDTH = 184
const TERMINAL_CONTEXT_MENU_HEIGHT = 44
const TERMINAL_CONTEXT_MENU_MARGIN = 8

interface TerminalContextMenuState {
  hasSelection: boolean
  x: number
  y: number
}

function isMacPlatform() {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform)
}

function isTerminalCopyShortcut(event: KeyboardEvent) {
  if (event.key.toLowerCase() !== "c" || event.altKey) return false

  const usesTerminalShortcut = event.ctrlKey && event.shiftKey && !event.metaKey
  const usesMacShortcut = isMacPlatform() && event.metaKey && !event.ctrlKey && !event.shiftKey
  return usesTerminalShortcut || usesMacShortcut
}

function clampTerminalContextMenuPosition(x: number, y: number) {
  if (typeof window === "undefined") return { x, y }

  return {
    x: Math.max(
      TERMINAL_CONTEXT_MENU_MARGIN,
      Math.min(x, window.innerWidth - TERMINAL_CONTEXT_MENU_WIDTH - TERMINAL_CONTEXT_MENU_MARGIN),
    ),
    y: Math.max(
      TERMINAL_CONTEXT_MENU_MARGIN,
      Math.min(y, window.innerHeight - TERMINAL_CONTEXT_MENU_HEIGHT - TERMINAL_CONTEXT_MENU_MARGIN),
    ),
  }
}

async function copyTerminalSelection(terminal: Terminal) {
  const selection = terminal.getSelection()
  if (!selection) return false

  await writeTextToClipboard(selection)
  return true
}

function shouldAutoFocusTerminal(container: HTMLElement) {
  const activeElement = document.activeElement
  if (!(activeElement instanceof HTMLElement)) return true
  if (activeElement === document.body) return true
  if (container.contains(activeElement)) return true
  if (activeElement.closest(".terminal-panel, .canvas-terminal-toggle-anchor")) return true

  const isEditableControl =
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement.isContentEditable ||
    activeElement.getAttribute("role") === "textbox"

  return !isEditableControl
}

interface TerminalViewProps {
  ariaLabel?: string
  brandTheme: BrandTheme
  codeFontFamily?: AppearanceCodeFontFamily
  colorMode: ColorMode
  panelHeight: number
  session: TerminalSessionRecord
  onInput: (ptyID: string, data: string) => void | Promise<void>
  onResize: (ptyID: string, rows: number, cols: number) => void
  onSnapshotChange: (ptyID: string, input: { scrollTop?: number }) => void
  subscribeToTerminalStream: (ptyID: string, listener: (event: TerminalStreamEvent) => void) => () => void
}

function readCssVariable(styles: CSSStyleDeclaration, name: string, fallback: string) {
  const value = styles.getPropertyValue(name).trim()
  return value || fallback
}

function readThemeVariable(styles: CSSStyleDeclaration, name: string) {
  return styles.getPropertyValue(name).trim()
}

function getTerminalTheme() {
  const styles = getComputedStyle(document.documentElement)
  const background = readCssVariable(styles, "--semantic-terminal-surface", "#ffffff")
  const surface = readCssVariable(styles, "--surface-code", "#27272a")
  const foreground = readThemeVariable(styles, "--semantic-terminal-text")
  const accent = readCssVariable(styles, "--brand-accent-active", "#fca5a5")
  const brand = readCssVariable(styles, "--brand-primary-active", "#d46b63")
  // 终端里的 ANSI 颜色需要更高对比度，所以优先读取强调态语义色。
  const success = readCssVariable(styles, "--semantic-success-strong", "#65a30d")
  const warning = readCssVariable(styles, "--semantic-warning-strong", "#b45309")
  const error = readCssVariable(styles, "--semantic-error-strong", "#9f1239")
  const info = readCssVariable(styles, "--semantic-info-strong", "#6366f1")
  const tertiary = readCssVariable(styles, "--text-tertiary", "#a8a29e")

  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    black: surface,
    red: error,
    green: success,
    yellow: warning,
    blue: info,
    magenta: brand,
    cyan: accent,
    white: foreground,
    brightBlack: tertiary,
    brightRed: brand,
    brightGreen: success,
    brightYellow: warning,
    brightBlue: info,
    brightMagenta: accent,
    brightCyan: accent,
    brightWhite: foreground,
  }
}

export function createTerminalOptions(codeFontFamily: AppearanceCodeFontFamily = "default") {
  return {
    allowProposedApi: false,
    cursorBlink: true,
    cursorInactiveStyle: "outline",
    fontFamily: resolveCodeFontFamilyStack(codeFontFamily),
    fontSize: 13,
    lineHeight: 1.25,
    scrollback: 5_000,
    theme: getTerminalTheme(),
  } satisfies ConstructorParameters<typeof Terminal>[0]
}

export const TerminalView = memo(function TerminalView({
  ariaLabel,
  brandTheme,
  codeFontFamily = "default",
  colorMode,
  panelHeight,
  session,
  onInput,
  onResize,
  onSnapshotChange,
  subscribeToTerminalStream,
}: TerminalViewProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const fitFrameRef = useRef<number | null>(null)
  const flushFrameRef = useRef<number | null>(null)
  const scrollFrameRef = useRef<number | null>(null)
  const lastReportedScrollTopRef = useRef(0)
  const lastMeasuredDimensionsRef = useRef<{ rows: number; cols: number } | null>(null)
  const writeQueueRef = useRef<string[]>([])
  const isFlushingRef = useRef(false)
  const [contextMenu, setContextMenu] = useState<TerminalContextMenuState | null>(null)
  const themeSignature = `${brandTheme}:${colorMode}`
  const handleInput = useEffectEvent(onInput)
  const handleResize = useEffectEvent(onResize)
  const handleSnapshotChange = useEffectEvent(onSnapshotChange)
  const applyTerminalTheme = useEffectEvent(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    if (!("options" in terminal) || !terminal.options) return
    terminal.options.theme = getTerminalTheme()
  })
  const fitTerminal = useEffectEvent(() => {
    const fitAddon = fitAddonRef.current
    if (!fitAddon) return

    let dimensions: { rows: number; cols: number } | undefined
    try {
      fitAddon.fit()
      dimensions = fitAddon.proposeDimensions()
    } catch {
      return
    }
    if (!dimensions) return

    const lastMeasured = lastMeasuredDimensionsRef.current
    if (lastMeasured && lastMeasured.rows === dimensions.rows && lastMeasured.cols === dimensions.cols) {
      return
    }

    lastMeasuredDimensionsRef.current = dimensions
    if (dimensions.rows !== session.rows || dimensions.cols !== session.cols) {
      handleResize(session.ptyID, dimensions.rows, dimensions.cols)
    }
  })
  const handleTerminalStream = useEffectEvent((event: TerminalStreamEvent) => {
    const terminal = terminalRef.current
    if (!terminal) return

    if (event.type === "replace") {
      if (flushFrameRef.current !== null) {
        window.cancelAnimationFrame(flushFrameRef.current)
        flushFrameRef.current = null
      }

      writeQueueRef.current = []
      isFlushingRef.current = false
      lastReportedScrollTopRef.current = event.scrollTop
      terminal.reset()

      if (!event.buffer) {
        terminal.scrollToLine(event.scrollTop)
        return
      }

      terminal.write(event.buffer, () => {
        terminal.scrollToLine(event.scrollTop)
      })
      return
    }

    if (!event.data) return

    writeQueueRef.current.push(event.data)
    if (isFlushingRef.current) return

    const flushWrites = () => {
      flushFrameRef.current = null

      const currentTerminal = terminalRef.current
      if (!currentTerminal) {
        isFlushingRef.current = false
        return
      }

      const nextChunk = writeQueueRef.current.join("")
      writeQueueRef.current = []
      if (!nextChunk) {
        isFlushingRef.current = false
        return
      }

      currentTerminal.write(nextChunk, () => {
        if (writeQueueRef.current.length > 0) {
          flushFrameRef.current = window.requestAnimationFrame(flushWrites)
          return
        }

        isFlushingRef.current = false
      })
    }

    isFlushingRef.current = true
    flushFrameRef.current = window.requestAnimationFrame(flushWrites)
  })
  const focusTerminal = useEffectEvent(() => {
    terminalRef.current?.focus()
  })
  const closeContextMenu = useEffectEvent((options?: { restoreTerminalFocus?: boolean }) => {
    setContextMenu(null)
    if (options?.restoreTerminalFocus) {
      window.requestAnimationFrame(() => {
        terminalRef.current?.focus()
      })
    }
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      ...createTerminalOptions(codeFontFamily),
      rows: session.rows,
      cols: session.cols,
    })
    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    terminalRef.current = terminal
    lastMeasuredDimensionsRef.current = {
      rows: session.rows,
      cols: session.cols,
    }

    // Match the visible container before replaying PTY history. Replaying at
    // xterm's default 80 columns can permanently scramble cursor-addressed
    // output from shells that were already running at a different width.
    fitTerminal()
    terminal.write(session.buffer)
    lastReportedScrollTopRef.current = session.scrollTop
    terminal.scrollToLine(session.scrollTop)
    if (shouldAutoFocusTerminal(container)) {
      terminal.focus()
    }

    terminal.attachCustomKeyEventHandler((event) => {
      if (!isTerminalCopyShortcut(event) || !terminal.hasSelection()) return true

      event.preventDefault()
      event.stopPropagation()
      void copyTerminalSelection(terminal).catch((error) => {
        console.error("[desktop] Failed to copy terminal selection:", error)
      })
      return false
    })

    const disposeInput = terminal.onData((data) => {
      void handleInput(session.ptyID, data)
    })
    const disposeScroll = terminal.onScroll(() => {
      const nextScrollTop = terminal.buffer.active.viewportY
      if (nextScrollTop === lastReportedScrollTopRef.current) return

      lastReportedScrollTopRef.current = nextScrollTop
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null
        handleSnapshotChange(session.ptyID, {
          scrollTop: nextScrollTop,
        })
      })
    })

    const scheduleFit = () => {
      if (fitFrameRef.current !== null) return
      fitFrameRef.current = window.requestAnimationFrame(() => {
        fitFrameRef.current = null
        fitTerminal()
      })
    }
    const fitTimer = window.setTimeout(scheduleFit, 0)
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleFit)
    resizeObserver?.observe(container)
    window.addEventListener("resize", scheduleFit)

    return () => {
      window.clearTimeout(fitTimer)
      window.removeEventListener("resize", scheduleFit)
      resizeObserver?.disconnect()
      if (fitFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameRef.current)
      }
      if (flushFrameRef.current !== null) {
        window.cancelAnimationFrame(flushFrameRef.current)
      }
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current)
      }
      disposeInput.dispose()
      disposeScroll.dispose()
      fitAddon.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      lastMeasuredDimensionsRef.current = null
      writeQueueRef.current = []
      isFlushingRef.current = false
      fitFrameRef.current = null
      flushFrameRef.current = null
      setContextMenu(null)
    }
  }, [session.ptyID])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal || !("options" in terminal) || !terminal.options) return

    terminal.options.fontFamily = resolveCodeFontFamilyStack(codeFontFamily)
    const timer = window.setTimeout(() => {
      fitTerminal()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [codeFontFamily])

  useEffect(() => {
    if (!contextMenu) return

    const focusFrame = window.requestAnimationFrame(() => {
      contextMenuRef.current
        ?.querySelector<HTMLButtonElement>(".ui-context-menu__item:not(:disabled)")
        ?.focus()
    })

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && contextMenuRef.current?.contains(target)) return
      setContextMenu(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      closeContextMenu({ restoreTerminalFocus: true })
    }
    const handleViewportChange = () => {
      setContextMenu(null)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("scroll", handleViewportChange, true)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("scroll", handleViewportChange, true)
    }
  }, [contextMenu])

  useEffect(() => {
    applyTerminalTheme()
    const cleanupCallbacks: Array<() => void> = []
    const handleChange = () => applyTerminalTheme()

    if (typeof MutationObserver !== "undefined") {
      const rootObserver = new MutationObserver(() => {
        applyTerminalTheme()
      })
      rootObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "data-brand-theme", "style"],
      })
      cleanupCallbacks.push(() => rootObserver.disconnect())
    }

    if (colorMode === "system" && typeof window.matchMedia === "function") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
      if (typeof mediaQuery.addEventListener === "function") {
        mediaQuery.addEventListener("change", handleChange)
        cleanupCallbacks.push(() => mediaQuery.removeEventListener("change", handleChange))
      } else {
        mediaQuery.addListener(handleChange)
        cleanupCallbacks.push(() => mediaQuery.removeListener(handleChange))
      }
    }

    return () => {
      for (const cleanup of cleanupCallbacks) {
        cleanup()
      }
    }
  }, [colorMode, themeSignature])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fitTerminal()
    }, 0)

    return () => {
      window.clearTimeout(timer)
    }
  }, [panelHeight, session.ptyID])

  useEffect(() => {
    lastMeasuredDimensionsRef.current = {
      rows: session.rows,
      cols: session.cols,
    }
  }, [session.cols, session.rows])

  useEffect(() => {
    return subscribeToTerminalStream(session.ptyID, handleTerminalStream)
  }, [session.ptyID, subscribeToTerminalStream])

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const position = clampTerminalContextMenuPosition(event.clientX, event.clientY)
    setContextMenu({
      hasSelection: terminalRef.current?.hasSelection() ?? false,
      x: position.x,
      y: position.y,
    })
  }

  const handleCopySelection = async () => {
    const terminal = terminalRef.current
    if (!terminal) {
      setContextMenu(null)
      return
    }

    try {
      await copyTerminalSelection(terminal)
      closeContextMenu({ restoreTerminalFocus: true })
    } catch (error) {
      console.error("[desktop] Failed to copy terminal selection:", error)
    }
  }

  return (
    <div className="terminal-view-shell">
      {session.lastError ? <p className="terminal-view-error">{session.lastError}</p> : null}

      <div
        id={`terminal-panel-${session.ptyID}`}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : `terminal-tab-${session.ptyID}`}
        className="terminal-surface"
        onContextMenu={handleContextMenu}
        onMouseDown={() => focusTerminal()}
        role="tabpanel"
      >
        <div ref={containerRef} className="terminal-xterm" />
      </div>

      {contextMenu
        ? createPortal(
            <div
              ref={contextMenuRef}
              className="ui-context-menu terminal-context-menu"
              role="menu"
              aria-label={`${t("terminal.title")} ${t("app.copy")}`}
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <button
                className="ui-context-menu__item"
                role="menuitem"
                type="button"
                disabled={!contextMenu.hasSelection}
                onClick={() => void handleCopySelection()}
              >
                <span className="ui-context-menu__icon" aria-hidden="true"><CopyIcon /></span>
                <span className="ui-context-menu__label">{t("app.copy")}</span>
                <span className="terminal-context-menu-shortcut" aria-hidden="true">
                  {isMacPlatform() ? "⌘C" : "Ctrl+Shift+C"}
                </span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
})
