import { afterEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => {
  const shortcutCallbacks = new Map<string, () => void>()
  return {
    shortcutCallbacks,
    BrowserWindow: vi.fn(),
    globalShortcut: {
      register: vi.fn((shortcut: string, callback: () => void) => {
        shortcutCallbacks.set(shortcut, callback)
        return true
      }),
      unregister: vi.fn((shortcut: string) => {
        shortcutCallbacks.delete(shortcut)
      }),
    },
    screen: {
      getAllDisplays: vi.fn(() => []),
      off: vi.fn(),
      on: vi.fn(),
    },
  }
})

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
  globalShortcut: electronMock.globalShortcut,
  screen: electronMock.screen,
}))

import { globalShortcut } from "electron"
import { ComputerUseOverlayManager, readComputerUseRuntimeEvent } from "./computer-use-overlay"

const globalShortcutMock = vi.mocked(globalShortcut)

afterEach(() => {
  vi.useRealTimers()
  electronMock.shortcutCallbacks.clear()
  vi.clearAllMocks()
})

describe("computer use overlay runtime event detection", () => {
  it("uses explicit Computer Use lease events without tool-name coupling", () => {
    const started = readComputerUseRuntimeEvent({
      event: "runtime",
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "computer.use.started",
        payload: {
          leaseID: "cu_lease_1",
          appDisplayName: "Notepad",
        },
      },
    })
    const stopped = readComputerUseRuntimeEvent({
      event: "runtime",
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "computer.use.stopped",
        payload: {
          leaseID: "cu_lease_1",
          reason: "turn-terminal",
        },
      },
    })

    expect(started).toEqual({
      type: "tool-started",
      callKey: "ses_1:trn_1:cu_lease_1",
      callID: "cu_lease_1",
      title: "Computer Use · Notepad",
      tool: "mcp_anybox_computer_use",
      turnID: "trn_1",
    })
    expect(stopped).toMatchObject({
      type: "tool-settled",
      callKey: "ses_1:trn_1:cu_lease_1",
    })
  })

  it("reads explicit app changes", () => {
    expect(readComputerUseRuntimeEvent({
      event: "runtime",
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "computer.use.app_changed",
        payload: {
          leaseID: "cu_lease_1",
          appID: "app_1",
          appDisplayName: "Calculator",
        },
      },
    })).toEqual({
      type: "app-changed",
      callKey: "ses_1:trn_1:cu_lease_1",
      appDisplayName: "Calculator",
      leaseID: "cu_lease_1",
      turnID: "trn_1",
    })
  })

  it("detects Computer Use Windows tool starts", () => {
    const event = readComputerUseRuntimeEvent({
      event: "runtime",
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "tool.call.started",
        payload: {
          part: {
            callID: "call_1",
            tool: "mcp_plugin_computer_use_windows_windows_click",
            state: {
              title: "Computer Use Windows/Click",
            },
          },
        },
      },
    })

    expect(event).toEqual({
      type: "tool-started",
      callKey: "ses_1:trn_1:call_1",
      callID: "call_1",
      title: "Computer Use Windows/Click",
      tool: "mcp_plugin_computer_use_windows_windows_click",
      turnID: "trn_1",
    })
  })

  it("detects Computer Use Windows tool completion", () => {
    const event = readComputerUseRuntimeEvent({
      event: "runtime",
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "tool.call.completed",
        payload: {
          part: {
            callID: "call_1",
            tool: "mcp_plugin_computer_use_windows_windows_type_text",
            state: {
              title: "Computer Use Windows/Type Text",
            },
          },
        },
      },
    })

    expect(event).toMatchObject({
      type: "tool-settled",
      callKey: "ses_1:trn_1:call_1",
      callID: "call_1",
      tool: "mcp_plugin_computer_use_windows_windows_type_text",
      turnID: "trn_1",
    })
  })

  it("ignores unrelated MCP tools", () => {
    const event = readComputerUseRuntimeEvent({
      event: "runtime",
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "tool.call.started",
        payload: {
          part: {
            callID: "call_1",
            tool: "mcp_connector_browser_default_browser_click",
            state: {
              title: "Browser/Click",
            },
          },
        },
      },
    })

    expect(event).toBeNull()
  })

  it("detects terminal turn events", () => {
    const event = readComputerUseRuntimeEvent({
      event: "runtime",
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "turn.cancelled",
        payload: {},
      },
    })

    expect(event).toEqual({
      type: "turn-settled",
      turnID: "trn_1",
    })
  })

  it("marks Computer Use Esc key presses as cancel-shortcut suppressed", () => {
    const event = readComputerUseRuntimeEvent({
      event: "runtime",
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "tool.call.started",
        payload: {
          part: {
            callID: "call_1",
            tool: "mcp_plugin_computer_use_windows_windows_press_key",
            state: {
              input: {
                keys: ["escape"],
              },
              title: "Computer Use Windows/Press Key",
            },
          },
        },
      },
    })

    expect(event).toMatchObject({
      type: "tool-started",
      callID: "call_1",
      suppressCancelShortcut: true,
      tool: "mcp_plugin_computer_use_windows_windows_press_key",
    })
  })

  it("marks pending Computer Use Esc raw input as cancel-shortcut suppressed", () => {
    const event = readComputerUseRuntimeEvent({
      event: "runtime",
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "tool.call.pending",
        payload: {
          part: {
            callID: "call_1",
            tool: "mcp_plugin_computer_use_windows_windows_press_key",
            state: {
              input: {},
              raw: JSON.stringify({
                keys: ["Escape"],
                windowRef: "win_1",
              }),
            },
          },
        },
      },
    })

    expect(event).toMatchObject({
      type: "tool-started",
      callID: "call_1",
      suppressCancelShortcut: true,
      tool: "mcp_plugin_computer_use_windows_windows_press_key",
    })
  })

  it("suppresses Esc cancellation only while Computer Use sends Esc", () => {
    const onCancel = vi.fn()
    const manager = new ComputerUseOverlayManager({
      idleHideMs: 10,
      minVisibleMs: 0,
      onCancel,
    })
    const target = { id: 42 } as Electron.WebContents

    manager.handleSessionStreamEvent({
      backendSessionID: "ses_1",
      clientTurnID: "client_turn_1",
      event: "runtime",
      target,
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "tool.call.started",
        payload: {
          part: {
            callID: "call_1",
            tool: "mcp_plugin_computer_use_windows_windows_click",
            state: {
              title: "Computer Use Windows/Click",
            },
          },
        },
      },
    })

    const staleEscCallback = electronMock.shortcutCallbacks.get("Esc")
    expect(staleEscCallback).toBeTypeOf("function")

    manager.handleSessionStreamEvent({
      backendSessionID: "ses_1",
      clientTurnID: "client_turn_1",
      event: "runtime",
      target,
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "tool.call.started",
        payload: {
          part: {
            callID: "call_2",
            tool: "mcp_plugin_computer_use_windows_windows_press_key",
            state: {
              input: {
                keys: ["escape"],
              },
              title: "Computer Use Windows/Press Key",
            },
          },
        },
      },
    })

    expect(globalShortcutMock.unregister).toHaveBeenCalledWith("Esc")
    staleEscCallback?.()
    expect(onCancel).not.toHaveBeenCalled()

    manager.handleSessionStreamEvent({
      backendSessionID: "ses_1",
      clientTurnID: "client_turn_1",
      event: "runtime",
      target,
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "tool.call.completed",
        payload: {
          part: {
            callID: "call_2",
            tool: "mcp_plugin_computer_use_windows_windows_press_key",
            state: {
              title: "Computer Use Windows/Press Key",
            },
          },
        },
      },
    })

    const restoredEscCallback = electronMock.shortcutCallbacks.get("Esc")
    expect(restoredEscCallback).toBeTypeOf("function")
    restoredEscCallback?.()
    expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({
      backendSessionID: "ses_1",
      callID: "call_2",
      tool: "mcp_plugin_computer_use_windows_windows_press_key",
    }))
  })

  it("keeps the overlay active between Computer Use tools until the turn settles", () => {
    vi.useFakeTimers()
    const manager = new ComputerUseOverlayManager({
      idleHideMs: 10,
      minVisibleMs: 0,
    })
    const target = { id: 42 } as Electron.WebContents

    manager.handleSessionStreamEvent({
      backendSessionID: "ses_1",
      clientTurnID: "client_turn_1",
      event: "runtime",
      target,
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "tool.call.started",
        payload: {
          part: {
            callID: "call_1",
            tool: "mcp_plugin_computer_use_windows_windows_click",
            state: {
              title: "Computer Use Windows/Click",
            },
          },
        },
      },
    })

    manager.handleSessionStreamEvent({
      backendSessionID: "ses_1",
      clientTurnID: "client_turn_1",
      event: "runtime",
      target,
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "tool.call.completed",
        payload: {
          part: {
            callID: "call_1",
            tool: "mcp_plugin_computer_use_windows_windows_click",
            state: {
              title: "Computer Use Windows/Click",
            },
          },
        },
      },
    })

    vi.advanceTimersByTime(100)

    expect(globalShortcutMock.unregister).not.toHaveBeenCalled()

    manager.handleSessionStreamEvent({
      backendSessionID: "ses_1",
      clientTurnID: "client_turn_1",
      event: "runtime",
      target,
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "turn.completed",
        payload: {},
      },
    })
    vi.advanceTimersByTime(10)

    expect(globalShortcutMock.unregister).toHaveBeenCalledWith("Esc")
  })

  it("clears the overlay on turn settlement when the tool event omitted turnID", () => {
    vi.useFakeTimers()
    const manager = new ComputerUseOverlayManager({
      idleHideMs: 10,
      minVisibleMs: 0,
    })
    const target = { id: 42 } as Electron.WebContents

    manager.handleSessionStreamEvent({
      backendSessionID: "ses_1",
      clientTurnID: "client_turn_1",
      event: "runtime",
      target,
      data: {
        sessionID: "ses_1",
        type: "tool.call.started",
        payload: {
          part: {
            callID: "call_1",
            tool: "mcp_plugin_computer_use_windows_windows_click",
            state: {
              title: "Computer Use Windows/Click",
            },
          },
        },
      },
    })

    manager.handleSessionStreamEvent({
      backendSessionID: "ses_1",
      clientTurnID: "client_turn_1",
      event: "runtime",
      target,
      data: {
        sessionID: "ses_1",
        turnID: "trn_1",
        type: "turn.completed",
        payload: {},
      },
    })
    vi.advanceTimersByTime(10)

    expect(globalShortcutMock.unregister).toHaveBeenCalledWith("Esc")
  })
})
