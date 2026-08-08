import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PtyEvent } from "./types"
import { TERMINAL_LIVE_BUFFER_MAX_CHARS, useTerminalWorkspace } from "./use-terminal-workspace"

const TEST_SESSION_ID = "session-1"

function Harness() {
  const terminal = useTerminalWorkspace({
    currentSessionID: TEST_SESSION_ID,
  })

  return (
    <div>
      <button onClick={() => void terminal.handleTogglePanel()} type="button">
        Toggle
      </button>
      <button onClick={() => void terminal.handleCreateTerminal()} type="button">
        Create
      </button>
      <button onClick={() => void terminal.handleCreateTerminalForShellProfile("zsh")} type="button">
        Create zsh
      </button>
      <button
        disabled={terminal.pendingCreateRequestID === null}
        onClick={() =>
          terminal.pendingCreateRequestID !== null &&
          void terminal.handleTerminalInitialDimensions(terminal.pendingCreateRequestID, {
            rows: 30,
            cols: 100,
          })
        }
        type="button"
      >
        Measure terminal
      </button>
      <button
        onClick={() =>
          void terminal.handleTerminalInitialDimensions(1, {
            rows: 31,
            cols: 101,
          })
        }
        type="button"
      >
        Measure request 1
      </button>
      <button
        disabled={terminal.pendingCreateRequestID === null}
        onClick={() =>
          terminal.pendingCreateRequestID !== null &&
          terminal.handleTerminalInitialDimensionsError(terminal.pendingCreateRequestID, "Unable to measure terminal size")
        }
        type="button"
      >
        Fail measure
      </button>
      <button
        disabled={!terminal.activeSession}
        onClick={() => terminal.activeSession && void terminal.handleCloseTerminal(terminal.activeSession.ptyID)}
        type="button"
      >
        Close active
      </button>
      <button
        disabled={!terminal.activeSession}
        onClick={() =>
          terminal.activeSession &&
          void terminal.handleRestartTerminal(terminal.activeSession.ptyID, "zsh")
        }
        type="button"
      >
        Restart zsh
      </button>
      <button
        disabled={!terminal.activeSession}
        onClick={() =>
          terminal.activeSession &&
          terminal.handleTerminalSnapshotChange(terminal.activeSession.ptyID, {
            scrollTop: 42,
          })
        }
        type="button"
      >
        Snapshot
      </button>
      <button
        disabled={!terminal.activeSession}
        onClick={() => terminal.activeSession && void terminal.handleTerminalInput(terminal.activeSession.ptyID, "echo queued\r")}
        type="button"
      >
        Type echo
      </button>
      <div data-testid="is-open">{terminal.isOpen ? "open" : "closed"}</div>
      <div data-testid="active-id">{terminal.activeSession?.ptyID ?? "none"}</div>
      <div data-testid="creation-error">{terminal.creationError ?? "none"}</div>
      <div data-testid="is-creating">{terminal.isCreatingTerminal ? "creating" : "idle"}</div>
      <div data-testid="pending-create-id">{terminal.pendingCreateRequestID ?? "none"}</div>
      <div data-testid="session-count">{String(terminal.sessions.length)}</div>
      <div data-testid="session-buffers">
        {terminal.sessions.map((session) => `${session.ptyID}:${session.buffer}`).join("|")}
      </div>
      {terminal.sessions.map((session) => (
        <button key={session.ptyID} onClick={() => terminal.handleSelectTerminal(session.ptyID)} type="button">
          {session.title}
        </button>
      ))}
    </div>
  )
}

async function finishInitialTerminalMeasurement() {
  await waitFor(() => {
    expect(screen.getByTestId("pending-create-id")).not.toHaveTextContent("none")
  })

  fireEvent.click(screen.getByRole("button", { name: "Measure terminal" }))
}

describe("useTerminalWorkspace", () => {
  let ptyListener: ((event: PtyEvent) => void) | undefined

  beforeEach(() => {
    vi.useRealTimers()
    window.localStorage.clear()
    ptyListener = undefined

    window.desktop = {
      platform: "win32",
      versions: {} as NodeJS.ProcessVersions,
      getInfo: vi.fn(),
      createPtySession: vi
        .fn()
        .mockResolvedValueOnce({
          id: "pty-1",
          sessionID: TEST_SESSION_ID,
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
        })
        .mockResolvedValueOnce({
          id: "pty-2",
          sessionID: TEST_SESSION_ID,
          title: "Terminal 2",
          cwd: "C:\\Projects\\anybox",
          shell: "powershell.exe",
          rows: 24,
          cols: 80,
          status: "running",
          exitCode: null,
          createdAt: 2,
          updatedAt: 2,
          cursor: 0,
        }),
      getSessionPty: vi.fn().mockResolvedValue(null),
      getPtySession: vi.fn(),
      updatePtySession: vi.fn().mockResolvedValue(undefined),
      deletePtySession: vi.fn().mockResolvedValue(undefined),
      attachPtySession: vi.fn().mockImplementation(async ({ id }: { id: string }) => ({
        id,
        sessionID: TEST_SESSION_ID,
        title: id === "pty-1" ? "Terminal 1" : "Terminal 2",
        cwd: "C:\\Projects\\anybox",
        shell: "powershell.exe",
        rows: 24,
        cols: 80,
        status: "running",
        exitCode: null,
        createdAt: 1,
        updatedAt: 1,
        cursor: 0,
      })),
      detachPtySession: vi.fn().mockResolvedValue(true),
      writePtyInput: vi.fn().mockResolvedValue(undefined),
      onPtyEvent: vi.fn((listener: (event: PtyEvent) => void) => {
        ptyListener = listener
        return vi.fn(() => {
          ptyListener = undefined
        })
      }),
    }
  })

  it("opens the panel and auto-creates the first terminal session", async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))

    await waitFor(() => {
      expect(window.desktop?.createPtySession).not.toHaveBeenCalled()
      expect(screen.getByTestId("pending-create-id")).not.toHaveTextContent("none")
    })

    await finishInitialTerminalMeasurement()

    await waitFor(() => {
      expect(window.desktop?.createPtySession).toHaveBeenCalledTimes(1)
      expect(window.desktop?.createPtySession).toHaveBeenCalledWith({
        sessionID: TEST_SESSION_ID,
        rows: 30,
        cols: 100,
      })
      expect(window.desktop?.attachPtySession).toHaveBeenCalledWith({
        id: "pty-1",
        cursor: 0,
      })
    })

    expect(screen.getByTestId("is-open")).toHaveTextContent("open")
    expect(screen.getByTestId("active-id")).toHaveTextContent("pty-1")
    expect(screen.getByTestId("session-count")).toHaveTextContent("1")
  })

  it("passes the selected shell profile with the measured initial dimensions", async () => {
    window.desktop!.platform = "darwin"

    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Create zsh" }))
    await finishInitialTerminalMeasurement()

    await waitFor(() => {
      expect(window.desktop?.createPtySession).toHaveBeenCalledWith({
        sessionID: TEST_SESSION_ID,
        rows: 30,
        cols: 100,
        shell: "zsh",
      })
    })
  })

  it("restarts the active terminal with another shell profile", async () => {
    window.desktop!.platform = "darwin"

    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))
    await finishInitialTerminalMeasurement()
    await waitFor(() => {
      expect(screen.getByTestId("active-id")).toHaveTextContent("pty-1")
    })

    fireEvent.click(screen.getByRole("button", { name: "Restart zsh" }))

    await waitFor(() => {
      expect(window.desktop?.deletePtySession).toHaveBeenCalledWith({ id: "pty-1" })
      expect(screen.getByTestId("pending-create-id")).not.toHaveTextContent("none")
    })

    await finishInitialTerminalMeasurement()

    await waitFor(() => {
      expect(window.desktop?.createPtySession).toHaveBeenCalledTimes(2)
      expect(window.desktop?.createPtySession).toHaveBeenLastCalledWith({
        sessionID: TEST_SESSION_ID,
        rows: 30,
        cols: 100,
        shell: "zsh",
      })
      expect(screen.getByTestId("active-id")).toHaveTextContent("pty-2")
    })
  })

  it("ignores stale initial dimensions after the panel closes before measuring", async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))

    await waitFor(() => {
      expect(screen.getByTestId("pending-create-id")).toHaveTextContent("1")
    })

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))
    fireEvent.click(screen.getByRole("button", { name: "Measure request 1" }))

    await waitFor(() => {
      expect(screen.getByTestId("is-open")).toHaveTextContent("closed")
      expect(screen.getByTestId("is-creating")).toHaveTextContent("idle")
      expect(screen.getByTestId("pending-create-id")).toHaveTextContent("none")
      expect(window.desktop?.createPtySession).not.toHaveBeenCalled()
    })
  })

  it("reports measurement errors without creating a PTY session", async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))

    await waitFor(() => {
      expect(screen.getByTestId("pending-create-id")).not.toHaveTextContent("none")
    })

    fireEvent.click(screen.getByRole("button", { name: "Fail measure" }))

    await waitFor(() => {
      expect(screen.getByTestId("creation-error")).toHaveTextContent("Unable to measure terminal size")
      expect(screen.getByTestId("is-creating")).toHaveTextContent("idle")
      expect(window.desktop?.createPtySession).not.toHaveBeenCalled()
    })
  })

  it("keeps the panel open with a creation error and retries successfully", async () => {
    window.desktop!.createPtySession = vi
      .fn()
      .mockRejectedValueOnce(new Error("node-pty spawn helper is not executable"))
      .mockResolvedValueOnce({
        id: "pty-1",
        sessionID: TEST_SESSION_ID,
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
      })

    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))
    await finishInitialTerminalMeasurement()

    await waitFor(() => {
      expect(screen.getByTestId("is-open")).toHaveTextContent("open")
      expect(screen.getByTestId("active-id")).toHaveTextContent("none")
      expect(screen.getByTestId("creation-error")).toHaveTextContent("node-pty spawn helper is not executable")
    })

    fireEvent.click(screen.getByRole("button", { name: "Create" }))
    await finishInitialTerminalMeasurement()

    await waitFor(() => {
      expect(window.desktop?.createPtySession).toHaveBeenCalledTimes(2)
      expect(screen.getByTestId("active-id")).toHaveTextContent("pty-1")
      expect(screen.getByTestId("creation-error")).toHaveTextContent("none")
    })
  })

  it("reconnects the active terminal with the latest cursor after an unexpected disconnect", async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))
    await finishInitialTerminalMeasurement()

    await waitFor(() => {
      expect(window.desktop?.attachPtySession).toHaveBeenCalledWith({
        id: "pty-1",
        cursor: 0,
      })
    })

    act(() => {
      ptyListener?.({
        ptyID: "pty-1",
        type: "ready",
        session: {
          id: "pty-1",
          sessionID: TEST_SESSION_ID,
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
          cursor: 5,
        },
        replay: {
          mode: "reset",
          buffer: "hello",
          cursor: 5,
          startCursor: 0,
        },
      })
    })

    act(() => {
      ptyListener?.({
        ptyID: "pty-1",
        type: "transport",
        state: "disconnected",
        userInitiated: false,
      })
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
    })

    await waitFor(() => {
      expect(window.desktop?.attachPtySession).toHaveBeenLastCalledWith({
        id: "pty-1",
        cursor: 5,
      })
    })
  })

  it("replays terminal input when the bridge rejects early input before PTY ready", async () => {
    window.desktop!.writePtyInput = vi
      .fn()
      .mockRejectedValueOnce(new Error("PTY session 'pty-1' is not attached"))
      .mockResolvedValue(undefined)

    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))
    await finishInitialTerminalMeasurement()

    await waitFor(() => {
      expect(screen.getByTestId("active-id")).toHaveTextContent("pty-1")
      expect(window.desktop?.attachPtySession).toHaveBeenCalledWith({
        id: "pty-1",
        cursor: 0,
      })
    })

    fireEvent.click(screen.getByRole("button", { name: "Type echo" }))

    await waitFor(() => {
      expect(window.desktop?.writePtyInput).toHaveBeenCalledTimes(1)
      expect(window.desktop?.writePtyInput).toHaveBeenCalledWith({
        id: "pty-1",
        data: "echo queued\r",
      })
    })

    act(() => {
      ptyListener?.({
        ptyID: "pty-1",
        type: "ready",
        session: {
          id: "pty-1",
          sessionID: TEST_SESSION_ID,
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
        },
        replay: {
          mode: "reset",
          buffer: "",
          cursor: 0,
          startCursor: 0,
        },
      })
    })

    await waitFor(() => {
      expect(window.desktop?.writePtyInput).toHaveBeenCalledTimes(2)
      expect(window.desktop?.writePtyInput).toHaveBeenLastCalledWith({
        id: "pty-1",
        data: "echo queued\r",
      })
    })
  })

  it("ignores old global terminal storage instead of restoring orphan PTYs", async () => {
    window.localStorage.setItem(
      "desktop.terminal.workspace.v1",
      JSON.stringify({
        version: 1,
        isOpen: true,
        activePtyID: "pty-stale",
        order: ["pty-stale"],
        panelHeight: 320,
        sessions: [
          {
            ptyID: "pty-stale",
            title: "Stale terminal",
            cwd: "C:\\Projects\\anybox",
            shell: "powershell.exe",
            rows: 24,
            cols: 80,
            status: "running",
            exitCode: null,
            createdAt: 1,
            updatedAt: 1,
            cursor: 7,
            buffer: "stale",
            scrollTop: 0,
          },
        ],
      }),
    )

    window.desktop!.attachPtySession = vi.fn().mockImplementation(async ({ id }: { id: string }) => {
      if (id === "pty-stale") {
        throw new Error("PTY session 'pty-stale' not found")
      }

      return {
        id,
        sessionID: TEST_SESSION_ID,
        title: "Terminal 1",
        cwd: "C:\\Projects\\anybox",
        shell: "powershell.exe",
        rows: 24,
        cols: 80,
        status: "running",
        exitCode: null,
        createdAt: 2,
        updatedAt: 2,
        cursor: 0,
      }
    })

    render(<Harness />)

    expect(screen.getByTestId("is-open")).toHaveTextContent("closed")
    expect(screen.getByTestId("active-id")).toHaveTextContent("none")
    expect(window.desktop?.attachPtySession).not.toHaveBeenCalled()
    expect(window.desktop?.createPtySession).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))
    await finishInitialTerminalMeasurement()

    await waitFor(() => {
      expect(window.desktop?.createPtySession).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(window.desktop?.attachPtySession).toHaveBeenLastCalledWith({
        id: "pty-1",
        cursor: 0,
      })
    })

    expect(screen.getByTestId("is-open")).toHaveTextContent("open")
    expect(screen.getByTestId("active-id")).toHaveTextContent("pty-1")
    expect(screen.getByTestId("session-count")).toHaveTextContent("1")
  })

  it("keeps live output out of storage while reconnecting with the latest cursor", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem")

    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))
    await finishInitialTerminalMeasurement()

    await waitFor(() => {
      expect(window.desktop?.attachPtySession).toHaveBeenCalledWith({
        id: "pty-1",
        cursor: 0,
      })
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    })
    setItemSpy.mockClear()

    act(() => {
      ptyListener?.({
        ptyID: "pty-1",
        type: "output",
        id: "out-1",
        data: "echo test",
        cursor: 9,
      })
    })

    act(() => {
      ptyListener?.({
        ptyID: "pty-1",
        type: "transport",
        state: "disconnected",
        userInitiated: false,
      })
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
    })

    await waitFor(() => {
      expect(window.desktop?.attachPtySession).toHaveBeenLastCalledWith({
        id: "pty-1",
        cursor: 9,
      })
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    })

    expect(setItemSpy).not.toHaveBeenCalled()
    setItemSpy.mockRestore()
  })

  it("caps live terminal output while preserving the latest cursor", async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))
    await finishInitialTerminalMeasurement()

    await waitFor(() => {
      expect(window.desktop?.attachPtySession).toHaveBeenCalledWith({
        id: "pty-1",
        cursor: 0,
      })
    })

    const output = "x".repeat(TERMINAL_LIVE_BUFFER_MAX_CHARS + 25)
    act(() => {
      ptyListener?.({
        ptyID: "pty-1",
        type: "output",
        id: "out-large",
        data: output,
        cursor: output.length,
      })
      ptyListener?.({
        ptyID: "pty-1",
        type: "state",
        session: {
          id: "pty-1",
          sessionID: TEST_SESSION_ID,
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
          updatedAt: 2,
          cursor: output.length,
        },
      })
    })

    await waitFor(() => {
      const renderedBuffer = screen.getByTestId("session-buffers").textContent?.replace(/^pty-1:/, "") ?? ""
      expect(renderedBuffer).toHaveLength(TERMINAL_LIVE_BUFFER_MAX_CHARS)
      expect(renderedBuffer).toBe(output.slice(-TERMINAL_LIVE_BUFFER_MAX_CHARS))
    })

    act(() => {
      ptyListener?.({
        ptyID: "pty-1",
        type: "transport",
        state: "disconnected",
        userInitiated: false,
      })
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
    })

    await waitFor(() => {
      expect(window.desktop?.attachPtySession).toHaveBeenLastCalledWith({
        id: "pty-1",
        cursor: output.length,
      })
    })
  })

  it("persists terminal scroll position from the live snapshot path", async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Toggle" }))
    await finishInitialTerminalMeasurement()

    await waitFor(() => {
      expect(window.desktop?.attachPtySession).toHaveBeenCalledWith({
        id: "pty-1",
        cursor: 0,
      })
    })
    await waitFor(() => {
      expect(screen.getByTestId("active-id")).toHaveTextContent("pty-1")
    })

    fireEvent.click(screen.getByRole("button", { name: "Snapshot" }))

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    })

    const persisted = window.localStorage.getItem("desktop.terminal.workspace.v1")
    expect(persisted).not.toBeNull()

    const payload = JSON.parse(persisted!)
    expect(payload.version).toBe(2)
    expect(payload.sessions).toHaveLength(0)
    expect(payload.scrollTopBySessionID?.[TEST_SESSION_ID]).toBe(42)
  })
})
