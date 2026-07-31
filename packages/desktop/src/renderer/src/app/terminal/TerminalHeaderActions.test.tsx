import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TerminalHeaderActions } from "./TerminalHeaderActions"
import type { TerminalSessionRecord } from "./types"

const session: TerminalSessionRecord = {
  ptyID: "pty-1",
  sessionID: "session-1",
  terminalKey: "interactive",
  purpose: "interactive",
  title: "test",
  cwd: "C:\\Projects\\test",
  shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
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

describe("TerminalHeaderActions", () => {
  it("restarts with a chosen shell and can terminate the active process", () => {
    const onCloseTerminal = vi.fn()
    const onRestartTerminal = vi.fn()

    render(
      <TerminalHeaderActions
        isBusy={false}
        session={session}
        shellProfiles={[
          { id: "default", label: "Default", shell: null },
          { id: "pwsh", label: "PowerShell 7", shell: "pwsh.exe" },
        ]}
        onCloseTerminal={onCloseTerminal}
        onRestartTerminal={onRestartTerminal}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Terminal · Reset / Close" }))
    expect(screen.getByRole("menuitemradio", { name: "Shell · PowerShell 7" }))
      .toHaveAttribute("aria-checked", "true")

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Shell · Default" }))
    expect(onRestartTerminal).toHaveBeenCalledWith("pty-1", "default")

    fireEvent.click(screen.getByRole("button", { name: "Terminal · Reset / Close" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Close terminal" }))
    expect(onCloseTerminal).toHaveBeenCalledWith("pty-1")
  })
})
