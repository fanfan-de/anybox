import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PtyEvent, PtySessionInfo } from "./types"
import {
  TerminalWorkspaceProvider,
  useTerminalWorkspaceContext,
} from "./TerminalWorkspaceProvider"

const SESSION_ID = "session-preview"

const ptyInfo: PtySessionInfo = {
  id: "pty-preview",
  sessionID: SESSION_ID,
  terminalKey: "interactive",
  purpose: "interactive",
  title: "Terminal preview",
  cwd: "C:\\Projects\\Anybox",
  shell: "powershell.exe",
  rows: 24,
  cols: 80,
  status: "running",
  exitCode: null,
  createdAt: 1,
  updatedAt: 1,
  cursor: 42,
}

function WorkspaceState() {
  const workspace = useTerminalWorkspaceContext()
  return <span data-testid="active-pty">{workspace.activeSession?.ptyID ?? "none"}</span>
}

function TestProvider({ sessionID = SESSION_ID }: { sessionID?: string }) {
  return (
    <TerminalWorkspaceProvider
      connectionEnabled
      currentSessionID={sessionID}
    >
      <WorkspaceState />
    </TerminalWorkspaceProvider>
  )
}

describe("TerminalWorkspaceProvider", () => {
  const originalDesktop = window.desktop
  let ptyListener: ((event: PtyEvent) => void) | undefined

  beforeEach(() => {
    ptyListener = undefined
    window.localStorage.clear()
    window.desktop = {
      platform: "win32",
      versions: {} as NodeJS.ProcessVersions,
      getInfo: vi.fn(),
      createPtySession: vi.fn(),
      getSessionPty: vi.fn(),
      getPtySession: vi.fn(),
      updatePtySession: vi.fn(),
      deletePtySession: vi.fn(),
      attachPtySession: vi.fn().mockResolvedValue(ptyInfo),
      detachPtySession: vi.fn().mockResolvedValue(true),
      writePtyInput: vi.fn(),
      onPtyEvent: vi.fn((listener: (event: PtyEvent) => void) => {
        ptyListener = listener
        return () => {
          if (ptyListener === listener) ptyListener = undefined
        }
      }),
    } as typeof window.desktop
  })

  afterEach(() => {
    vi.useRealTimers()
    window.desktop = originalDesktop
  })

  it("adopts the owning interactive PTY and replays it from cursor zero", async () => {
    vi.mocked(window.desktop!.getSessionPty!).mockResolvedValue(ptyInfo)

    render(<TestProvider />)

    await waitFor(() => {
      expect(screen.getByTestId("active-pty")).toHaveTextContent("pty-preview")
      expect(window.desktop?.attachPtySession).toHaveBeenCalledWith({
        id: "pty-preview",
        cursor: 0,
      })
    })
    expect(window.desktop?.createPtySession).not.toHaveBeenCalled()

    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    await waitFor(() => {
      expect(window.desktop?.getSessionPty).toHaveBeenCalledTimes(2)
    })
    expect(window.desktop?.attachPtySession).toHaveBeenCalledTimes(1)
  })

  it("detaches the old PTY and adopts only the newly selected task session", async () => {
    const nextInfo: PtySessionInfo = {
      ...ptyInfo,
      id: "pty-next",
      sessionID: "session-next",
      title: "Next terminal",
    }
    vi.mocked(window.desktop!.getSessionPty!).mockImplementation(async ({ sessionID }) => (
      sessionID === nextInfo.sessionID ? nextInfo : ptyInfo
    ))
    vi.mocked(window.desktop!.attachPtySession!).mockImplementation(async ({ id }) => (
      id === nextInfo.id ? nextInfo : ptyInfo
    ))

    const { rerender } = render(<TestProvider />)
    await waitFor(() => {
      expect(screen.getByTestId("active-pty")).toHaveTextContent("pty-preview")
    })

    rerender(<TestProvider sessionID="session-next" />)

    await waitFor(() => {
      expect(screen.getByTestId("active-pty")).toHaveTextContent("pty-next")
      expect(window.desktop?.detachPtySession).toHaveBeenCalledWith({ id: "pty-preview" })
      expect(window.desktop?.attachPtySession).toHaveBeenCalledWith({
        id: "pty-next",
        cursor: 0,
      })
    })
  })

  it("drops a disconnected stale preview when the owning session no longer has a PTY", async () => {
    vi.mocked(window.desktop!.getSessionPty!).mockResolvedValue(ptyInfo)
    render(<TestProvider />)

    await waitFor(() => {
      expect(screen.getByTestId("active-pty")).toHaveTextContent("pty-preview")
    })
    act(() => {
      ptyListener?.({
        ptyID: ptyInfo.id,
        type: "transport",
        state: "disconnected",
        userInitiated: true,
      })
    })

    vi.mocked(window.desktop!.getSessionPty!).mockResolvedValue(null)
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })

    await waitFor(() => {
      expect(screen.getByTestId("active-pty")).toHaveTextContent("none")
    }, { timeout: 2_000 })
  })
})
