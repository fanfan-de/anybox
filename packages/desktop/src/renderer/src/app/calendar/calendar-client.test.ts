import { afterEach, describe, expect, it, vi } from "vitest"
import { listCalendarTodos } from "./calendar-client"

describe("calendar client", () => {
  const originalDesktop = window.desktop

  afterEach(() => {
    window.desktop = originalDesktop
    vi.unstubAllGlobals()
  })

  it("uses the desktop-managed agent base URL when available", async () => {
    const getAgentConfig = vi.fn(async () => ({
      baseURL: "http://127.0.0.1:4810",
      defaultDirectory: "C:\\Projects\\Anybox",
    }))
    window.desktop = { getAgentConfig } as unknown as NonNullable<Window["desktop"]>
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      success: true,
      data: [],
    })))
    vi.stubGlobal("fetch", fetchMock)

    await expect(listCalendarTodos()).resolves.toEqual([])

    expect(getAgentConfig).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("http://127.0.0.1:4810/api/calendar/todos")
    expect(init).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })
})
