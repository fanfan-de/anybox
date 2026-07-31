import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TerminalView } from "./TerminalView"
import type { TerminalSessionRecord, TerminalStreamEvent } from "./types"

const baseSession: TerminalSessionRecord = {
  ptyID: "pty-1",
  sessionID: "session-1",
  terminalKey: "interactive",
  purpose: "interactive",
  title: "Terminal 1",
  cwd: "C:\\Projects\\anybox",
  shell: "powershell.exe",
  rows: 24,
  cols: 80,
  status: "running",
  exitCode: null,
  createdAt: 1,
  updatedAt: 1,
  cursor: 0,
  buffer: "",
  scrollTop: 0,
  transportState: "connected",
}

function renderTerminalView(input?: {
  onInput?: (ptyID: string, data: string) => void | Promise<void>
  onResize?: (ptyID: string, rows: number, cols: number) => void
  onSnapshotChange?: (ptyID: string, input: { scrollTop?: number }) => void
  session?: TerminalSessionRecord
  subscribeToTerminalStream?: (ptyID: string, listener: (event: TerminalStreamEvent) => void) => () => void
}) {
  return (
    <TerminalView
      brandTheme="terra"
      colorMode="light"
      panelHeight={280}
      session={input?.session ?? baseSession}
      onInput={input?.onInput ?? vi.fn()}
      onResize={input?.onResize ?? vi.fn()}
      onSnapshotChange={input?.onSnapshotChange ?? vi.fn()}
      subscribeToTerminalStream={input?.subscribeToTerminalStream ?? (() => () => {})}
    />
  )
}

async function flushTimer() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
}

async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => window.requestAnimationFrame(resolve))
  })
}

describe("TerminalView", () => {
  it("keeps terminal spacing outside xterm's native viewport", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "src/renderer/src/styles/terminal.css"),
      "utf8",
    )

    expect(styles).toMatch(
      /\.terminal-panel \.terminal-surface\s*\{[^}]*padding:\s*10px 12px 12px;[^}]*border-radius:\s*0;/s,
    )
    expect(styles).not.toMatch(/\.terminal-xterm \.xterm\s*\{[^}]*padding:/s)
  })

  it("refits when the terminal container changes size without a window resize", async () => {
    const originalResizeObserver = globalThis.ResizeObserver
    const originalFitDimensions = (
      globalThis as { __mockXtermFitDimensions?: { rows: number; cols: number } | null }
    ).__mockXtermFitDimensions
    let resizeCallback: ResizeObserverCallback | null = null
    let resizeObserver: ResizeObserver | null = null

    class ManualResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
        resizeObserver = this
      }

      observe() {}

      unobserve() {}

      disconnect() {}
    }

    globalThis.ResizeObserver = ManualResizeObserver
    ;(
      globalThis as { __mockXtermFitDimensions?: { rows: number; cols: number } | null }
    ).__mockXtermFitDimensions = {
      rows: 24,
      cols: 80,
    }

    try {
      const onResize = vi.fn()
      render(renderTerminalView({ onResize }))
      await flushTimer()

      expect(onResize).not.toHaveBeenCalled()

      ;(
        globalThis as { __mockXtermFitDimensions?: { rows: number; cols: number } | null }
      ).__mockXtermFitDimensions = {
        rows: 32,
        cols: 132,
      }

      act(() => {
        resizeCallback?.([], resizeObserver!)
      })
      await flushFrame()

      expect(onResize).toHaveBeenCalledWith("pty-1", 32, 132)
    } finally {
      globalThis.ResizeObserver = originalResizeObserver
      ;(
        globalThis as { __mockXtermFitDimensions?: { rows: number; cols: number } | null }
      ).__mockXtermFitDimensions = originalFitDimensions
    }
  })

  it("does not steal focus from an active composer textarea while mounting", async () => {
    const { rerender } = render(<textarea aria-label="Task draft" />)

    const composer = screen.getByRole("textbox", { name: "Task draft" })
    act(() => {
      composer.focus()
    })
    expect(document.activeElement).toBe(composer)

    rerender(
      <>
        <textarea aria-label="Task draft" />
        <div className="terminal-panel">{renderTerminalView()}</div>
      </>,
    )

    await flushTimer()

    expect(screen.getByRole("textbox", { name: "Task draft" })).toHaveFocus()
  })

  it("autofocuses the terminal when it opens from a terminal control", async () => {
    const { container, rerender } = render(
      <div className="canvas-terminal-toggle-anchor">
        <button type="button">Toggle terminal panel</button>
      </div>,
    )

    const toggle = screen.getByRole("button", { name: "Toggle terminal panel" })
    act(() => {
      toggle.focus()
    })
    expect(toggle).toHaveFocus()

    rerender(
      <>
        <div className="canvas-terminal-toggle-anchor">
          <button type="button">Toggle terminal panel</button>
        </div>
        <div className="terminal-panel">{renderTerminalView()}</div>
      </>,
    )

    await flushTimer()

    expect(container.querySelector(".terminal-xterm")).toHaveFocus()
  })

  it("keeps streamed output mounted across parent rerenders", async () => {
    let streamListener: ((event: TerminalStreamEvent) => void) | null = null
    const subscribeToTerminalStream = vi.fn(
      (_ptyID: string, listener: (event: TerminalStreamEvent) => void) => {
        streamListener = listener
        return () => {
          if (streamListener === listener) {
            streamListener = null
          }
        }
      },
    )
    const session = {
      ...baseSession,
      buffer: "boot",
    }

    const { container, rerender } = render(renderTerminalView({
      session,
      subscribeToTerminalStream,
    }))

    await flushTimer()

    act(() => {
      streamListener?.({
        type: "append",
        data: " live",
        cursor: 9,
      })
    })
    await flushFrame()
    expect(container.querySelector(".terminal-xterm")).toHaveTextContent("boot live")

    rerender(renderTerminalView({
      onInput: vi.fn(),
      session,
      subscribeToTerminalStream,
    }))
    await flushTimer()

    expect(container.querySelector(".terminal-xterm")).toHaveTextContent("boot live")
    expect(subscribeToTerminalStream).toHaveBeenCalledTimes(1)
  })

  it("routes keyboard input to the mounted terminal session", async () => {
    const onInput = vi.fn()
    const { container } = render(renderTerminalView({
      onInput,
      session: {
        ...baseSession,
        ptyID: "pty-focused",
      },
    }))

    await flushTimer()

    const terminal = container.querySelector(".terminal-xterm")
    expect(terminal).not.toBeNull()

    act(() => {
      terminal?.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "a",
      }))
    })

    expect(onInput).toHaveBeenCalledWith("pty-focused", "a")
  })

  it("copies a selection with the terminal shortcut while preserving Ctrl+C as interrupt", async () => {
    const previousClipboard = navigator.clipboard
    const previousSelection = (
      globalThis as { __mockXtermSelection?: string }
    ).__mockXtermSelection
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    ;(
      globalThis as { __mockXtermSelection?: string }
    ).__mockXtermSelection = "selected terminal output"

    try {
      const onInput = vi.fn()
      const { container } = render(renderTerminalView({ onInput }))
      await flushTimer()

      const terminal = container.querySelector(".terminal-xterm")
      expect(terminal).not.toBeNull()

      fireEvent.keyDown(terminal!, {
        key: "c",
        code: "KeyC",
        ctrlKey: true,
      })

      expect(onInput).toHaveBeenCalledWith("pty-1", "\x03")
      expect(writeText).not.toHaveBeenCalled()

      fireEvent.keyDown(terminal!, {
        key: "c",
        code: "KeyC",
        ctrlKey: true,
        shiftKey: true,
      })

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("selected terminal output")
      })
      expect(onInput).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: previousClipboard,
      })
      ;(
        globalThis as { __mockXtermSelection?: string }
      ).__mockXtermSelection = previousSelection
    }
  })

  it("copies the current selection from a clamped terminal context menu", async () => {
    const previousClipboard = navigator.clipboard
    const previousSelection = (
      globalThis as { __mockXtermSelection?: string }
    ).__mockXtermSelection
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })
    ;(
      globalThis as { __mockXtermSelection?: string }
    ).__mockXtermSelection = "context menu selection"

    try {
      const { container } = render(renderTerminalView())
      await flushTimer()

      const surface = container.querySelector(".terminal-surface")
      expect(surface).not.toBeNull()

      fireEvent.contextMenu(surface!, {
        clientX: window.innerWidth - 1,
        clientY: window.innerHeight - 1,
      })

      const menu = screen.getByRole("menu", { name: "Terminal Copy" })
      expect(menu).toHaveStyle({
        left: `${window.innerWidth - 184 - 8}px`,
        top: `${window.innerHeight - 44 - 8}px`,
      })

      fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }))

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("context menu selection")
        expect(screen.queryByRole("menu", { name: "Terminal Copy" })).toBeNull()
      })
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: previousClipboard,
      })
      ;(
        globalThis as { __mockXtermSelection?: string }
      ).__mockXtermSelection = previousSelection
    }
  })
})
