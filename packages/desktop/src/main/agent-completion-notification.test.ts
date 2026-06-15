import { beforeEach, describe, expect, it, vi } from "vitest"

const electronMock = vi.hoisted(() => {
  type EventHandler = (...args: unknown[]) => void
  type NotificationInstance = {
    handlers: Map<string, EventHandler>
    options: unknown
    show: ReturnType<typeof vi.fn>
  }

  const instances: NotificationInstance[] = []
  const targetWindow = {
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
  }

  class NotificationMock {
    static isSupported = vi.fn(() => true)

    handlers = new Map<string, EventHandler>()
    options: unknown
    show = vi.fn()

    constructor(options: unknown) {
      this.options = options
      instances.push(this)
    }

    on(event: string, handler: EventHandler) {
      this.handlers.set(event, handler)
      return this
    }
  }

  return {
    BrowserWindow: {
      fromWebContents: vi.fn(() => targetWindow),
      getFocusedWindow: vi.fn<() => unknown>(() => null),
    },
    Notification: NotificationMock,
    instances,
    targetWindow,
  }
})

const safeConsoleMock = vi.hoisted(() => ({
  safeError: vi.fn(),
}))

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
  Notification: electronMock.Notification,
}))

vi.mock("./safe-console", () => safeConsoleMock)

import { AgentCompletionNotificationManager, internal } from "./agent-completion-notification"

function createTarget(destroyed = false) {
  return {
    isDestroyed: vi.fn(() => destroyed),
  } as unknown as Electron.WebContents
}

function createRuntimeEvent(type: string, payload: Record<string, unknown> = {}) {
  return {
    eventID: "event_1",
    payload,
    sessionID: "session_1",
    turnID: "turn_1",
    type,
  }
}

beforeEach(() => {
  electronMock.instances.splice(0)
  electronMock.BrowserWindow.fromWebContents.mockClear()
  electronMock.BrowserWindow.getFocusedWindow.mockReset()
  electronMock.BrowserWindow.getFocusedWindow.mockReturnValue(null)
  electronMock.Notification.isSupported.mockReset()
  electronMock.Notification.isSupported.mockReturnValue(true)
  electronMock.targetWindow.focus.mockClear()
  electronMock.targetWindow.isDestroyed.mockReset()
  electronMock.targetWindow.isDestroyed.mockReturnValue(false)
  electronMock.targetWindow.isMinimized.mockReset()
  electronMock.targetWindow.isMinimized.mockReturnValue(false)
  electronMock.targetWindow.restore.mockClear()
  electronMock.targetWindow.show.mockClear()
  safeConsoleMock.safeError.mockClear()
})

describe("agent completion notification parsing", () => {
  it("reads completed turn runtime events", () => {
    expect(internal.readCompletionEventKey({
      event: "runtime",
      data: createRuntimeEvent("turn.completed", { status: "completed" }),
    })).toBe("event_1")
  })

  it.each([
    ["turn.failed", {}],
    ["turn.cancelled", {}],
    ["turn.completed", { status: "blocked" }],
    ["turn.completed", { status: "stopped" }],
    ["turn.completed", { status: "continued_by_user" }],
  ])("ignores %s completion state", (type, payload) => {
    expect(internal.readCompletionEventKey({
      event: "runtime",
      data: createRuntimeEvent(type, payload),
    })).toBeNull()
  })

  it("ignores malformed runtime payloads", () => {
    expect(internal.readCompletionEventKey({ event: "runtime", data: null })).toBeNull()
    expect(internal.readCompletionEventKey({ event: "runtime", data: { type: "turn.completed" } })).toBeNull()
    expect(internal.readCompletionEventKey({ event: "done", data: createRuntimeEvent("turn.completed") })).toBeNull()
  })

  it("reads session ids from runtime events", () => {
    expect(internal.readNotificationSessionID({
      event: "runtime",
      data: createRuntimeEvent("turn.completed", { status: "completed" }),
    })).toBe("session_1")
    expect(internal.readNotificationSessionID({
      event: "done",
      data: { sessionID: "legacy_session" },
    })).toBeUndefined()
  })

  it("reads and truncates response previews from text parts", () => {
    expect(internal.readNotificationResponsePreview({
      event: "runtime",
      data: createRuntimeEvent("turn.completed", {
        parts: [
          { type: "tool-call", text: "ignored" },
          { type: "text", text: "Created the file.\n\nOpen it in the browser to view the shader." },
        ],
        status: "completed",
      }),
    }, 43)).toBe("Created the file. Open it in the browser...")
  })

  it("returns undefined response previews when no text parts are present", () => {
    expect(internal.readNotificationResponsePreview({
      event: "runtime",
      data: createRuntimeEvent("turn.completed", {
        parts: [{ type: "tool-call", text: "ignored" }],
        status: "completed",
      }),
    })).toBeUndefined()
  })
})

describe("AgentCompletionNotificationManager", () => {
  it("shows a native system notification with the session title and response preview", async () => {
    const resolveSessionTitle = vi.fn(async () => "Shader session")
    const manager = new AgentCompletionNotificationManager({
      resolveSessionTitle,
      responsePreviewLength: 43,
    })

    const shown = await manager.handleSessionStreamEvent({
      data: createRuntimeEvent("turn.completed", {
        parts: [{ type: "text", text: "Created the file.\n\nOpen it in the browser to view the shader." }],
        status: "completed",
      }),
      event: "runtime",
      target: createTarget(),
    })

    expect(shown).toBe(true)
    expect(resolveSessionTitle).toHaveBeenCalledWith("session_1")
    expect(electronMock.instances).toHaveLength(1)
    expect(electronMock.instances[0].options).toEqual({
      body: "Created the file. Open it in the browser...",
      title: "Shader session",
    })
    expect(electronMock.instances[0].show).toHaveBeenCalledTimes(1)
  })

  it("falls back to the default body when no response text is present", async () => {
    const manager = new AgentCompletionNotificationManager({
      resolveSessionTitle: () => "Shader session",
    })

    const shown = await manager.handleSessionStreamEvent({
      data: createRuntimeEvent("turn.completed", {
        parts: [],
        status: "completed",
      }),
      event: "runtime",
      target: createTarget(),
    })

    expect(shown).toBe(true)
    expect(electronMock.instances[0].options).toEqual({
      body: "Agent \u5df2\u5b8c\u6210\u5f53\u524d\u4efb\u52a1\u3002",
      title: "Shader session",
    })
  })

  it("falls back to the default title when resolving the session title fails", async () => {
    const manager = new AgentCompletionNotificationManager({
      resolveSessionTitle: async () => {
        throw new Error("lookup failed")
      },
    })

    const shown = await manager.handleSessionStreamEvent({
      data: createRuntimeEvent("turn.completed", {
        parts: [{ type: "text", text: "Done." }],
        status: "completed",
      }),
      event: "runtime",
      target: createTarget(),
    })

    expect(shown).toBe(true)
    expect(electronMock.instances[0].options).toEqual({
      body: "Done.",
      title: "\u4efb\u52a1\u5df2\u5b8c\u6210",
    })
    expect(safeConsoleMock.safeError).toHaveBeenCalledTimes(1)
  })

  it("shows a native system notification while an Anybox window is focused by default", async () => {
    electronMock.BrowserWindow.getFocusedWindow.mockReturnValue({})
    const manager = new AgentCompletionNotificationManager()

    const shown = await manager.handleSessionStreamEvent({
      data: createRuntimeEvent("turn.completed", { status: "completed" }),
      event: "runtime",
      target: createTarget(),
    })

    expect(shown).toBe(true)
    expect(electronMock.instances).toHaveLength(1)
  })

  it("can skip notifications while an Anybox window is focused", async () => {
    electronMock.BrowserWindow.getFocusedWindow.mockReturnValue({})
    const manager = new AgentCompletionNotificationManager({
      notifyWhenFocused: false,
    })

    const shown = await manager.handleSessionStreamEvent({
      data: createRuntimeEvent("turn.completed", { status: "completed" }),
      event: "runtime",
      target: createTarget(),
    })

    expect(shown).toBe(false)
    expect(electronMock.instances).toHaveLength(0)
  })

  it("deduplicates repeated completion events", async () => {
    const resolveSessionTitle = vi.fn(() => "Shader session")
    const manager = new AgentCompletionNotificationManager({
      resolveSessionTitle,
    })
    const event = {
      data: createRuntimeEvent("turn.completed", { status: "completed" }),
      event: "runtime",
      target: createTarget(),
    }

    await expect(manager.handleSessionStreamEvent(event)).resolves.toBe(true)
    await expect(manager.handleSessionStreamEvent(event)).resolves.toBe(false)

    expect(electronMock.instances).toHaveLength(1)
    expect(resolveSessionTitle).toHaveBeenCalledTimes(1)
  })

  it("does not show a notification when Electron notifications are unavailable", async () => {
    electronMock.Notification.isSupported.mockReturnValue(false)
    const manager = new AgentCompletionNotificationManager()

    const shown = await manager.handleSessionStreamEvent({
      data: createRuntimeEvent("turn.completed", { status: "completed" }),
      event: "runtime",
      target: createTarget(),
    })

    expect(shown).toBe(false)
    expect(electronMock.instances).toHaveLength(0)
  })

  it("ignores stream done events", async () => {
    const manager = new AgentCompletionNotificationManager()

    const shown = await manager.handleSessionStreamEvent({
      data: { sessionID: "session_1", parts: [{ type: "text", text: "Legacy done response." }] },
      dedupKey: "client_turn_1",
      event: "done",
      target: createTarget(),
    })

    expect(shown).toBe(false)
    expect(electronMock.instances).toHaveLength(0)
  })

  it("focuses the source window when the notification is clicked", async () => {
    electronMock.targetWindow.isMinimized.mockReturnValue(true)
    const manager = new AgentCompletionNotificationManager()

    await manager.handleSessionStreamEvent({
      data: createRuntimeEvent("turn.completed", { status: "completed" }),
      event: "runtime",
      target: createTarget(),
    })

    electronMock.instances[0].handlers.get("click")?.()

    expect(electronMock.targetWindow.restore).toHaveBeenCalledTimes(1)
    expect(electronMock.targetWindow.show).toHaveBeenCalledTimes(1)
    expect(electronMock.targetWindow.focus).toHaveBeenCalledTimes(1)
  })

  it("does not focus a destroyed source target when the notification is clicked", async () => {
    const manager = new AgentCompletionNotificationManager()
    const target = createTarget(true)

    await manager.handleSessionStreamEvent({
      data: createRuntimeEvent("turn.completed", { status: "completed" }),
      event: "runtime",
      target,
    })

    electronMock.instances[0].handlers.get("click")?.()

    expect(electronMock.BrowserWindow.fromWebContents).not.toHaveBeenCalled()
  })
})
