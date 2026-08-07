import { beforeEach, describe, expect, it } from "vitest"
import {
  clearTerminalWorkspaceState,
  createEmptyTerminalWorkspaceState,
  loadTerminalWorkspaceState,
  saveTerminalWorkspaceState,
} from "./storage"

describe("terminal storage", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("restores panel state and per-session scroll positions without restoring PTYs", () => {
    saveTerminalWorkspaceState({
      isOpen: true,
      activePtyID: "pty-1",
      order: ["pty-1"],
      panelHeight: 320,
      preferredShellProfileID: "powershell",
      scrollTopBySessionID: {
        "session-1": 4,
      },
      sessions: {
        "pty-1": {
          ptyID: "pty-1",
          sessionID: "session-1",
          terminalKey: "interactive",
          purpose: "interactive",
          title: "Workspace shell",
          cwd: "C:\\Projects\\anybox",
          shell: "powershell.exe",
          rows: 40,
          cols: 120,
          status: "running",
          exitCode: null,
          createdAt: 10,
          updatedAt: 20,
          cursor: 11,
          buffer: "hello world",
          scrollTop: 4,
          transportState: "connected",
        },
      },
    })

    const restored = loadTerminalWorkspaceState()

    expect(restored.isOpen).toBe(true)
    expect(restored.activePtyID).toBeNull()
    expect(restored.panelHeight).toBe(320)
    expect(restored.order).toEqual([])
    expect(restored.sessions).toEqual({})
    expect(restored.scrollTopBySessionID).toEqual({
      "session-1": 4,
    })
    expect(restored.preferredShellProfileID).toBe("pwsh")
    expect(JSON.parse(window.localStorage.getItem("desktop.terminal.workspace.v1") ?? "{}")).toMatchObject({
      version: 2,
      preferredShellProfileID: "pwsh",
    })
  })

  it("falls back to the empty workspace shape for invalid payloads", () => {
    window.localStorage.setItem("desktop.terminal.workspace.v1", JSON.stringify({ version: 999 }))

    expect(loadTerminalWorkspaceState()).toEqual(createEmptyTerminalWorkspaceState())
  })

  it("clears the saved workspace snapshot", () => {
    saveTerminalWorkspaceState({
      ...createEmptyTerminalWorkspaceState(),
      isOpen: true,
    })

    clearTerminalWorkspaceState()

    expect(loadTerminalWorkspaceState()).toEqual(createEmptyTerminalWorkspaceState())
  })
})
