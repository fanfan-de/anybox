import { describe, expect, it } from "vitest"
import { DESKTOP_WINDOW_STATE_EVENT_CHANNEL } from "../shared/desktop-ipc-contract"
import { isWindowMaximized, sendWindowState } from "./window-state"

class FakeBrowserWindow {
  maximized = false
  sentWindowStates: Array<{ channel: string; state: unknown }> = []

  webContents = {
    isDestroyed: () => false,
    send: (channel: string, state: unknown) => {
      this.sentWindowStates.push({ channel, state })
    },
  }

  isDestroyed() {
    return false
  }

  isMaximized() {
    return this.maximized
  }
}

describe("window state", () => {
  it("uses the native Electron maximized state", () => {
    const win = new FakeBrowserWindow()

    expect(isWindowMaximized(win as never)).toBe(false)

    win.maximized = true

    expect(isWindowMaximized(win as never)).toBe(true)
  })

  it("sends the current native maximized state to the renderer", () => {
    const win = new FakeBrowserWindow()
    win.maximized = true

    expect(sendWindowState(win as never)).toBe(true)
    expect(win.sentWindowStates).toEqual([
      {
        channel: DESKTOP_WINDOW_STATE_EVENT_CHANNEL,
        state: { isMaximized: true },
      },
    ])
  })
})
