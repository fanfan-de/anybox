import { act, render, screen } from "@testing-library/react"
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
})
