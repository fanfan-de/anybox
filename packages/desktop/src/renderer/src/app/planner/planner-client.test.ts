import { afterEach, describe, expect, it, vi } from "vitest"
import { listPlanProposals, listPlannerTodos } from "./planner-client"

describe("planner client", () => {
  const originalDesktop = window.desktop

  afterEach(() => {
    window.desktop = originalDesktop
    vi.unstubAllGlobals()
  })

  it("uses the managed agent URL and serializes Planner view filters", async () => {
    window.desktop = {
      getAgentConfig: vi.fn(async () => ({
        baseURL: "http://127.0.0.1:4810",
        defaultDirectory: "C:\\Projects\\Anybox",
      })),
    } as unknown as NonNullable<Window["desktop"]>
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({ success: true, data: [] }))
    ))
    vi.stubGlobal("fetch", fetchMock)

    await expect(listPlannerTodos({ view: "project", projectId: "prj_anybox", query: " release " })).resolves.toEqual([])
    await expect(listPlanProposals("pending")).resolves.toEqual([])

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4810/api/planner/todos?view=project&query=release&projectId=prj_anybox",
    )
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://127.0.0.1:4810/api/planner/proposals?status=pending",
    )
  })
})
