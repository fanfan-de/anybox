/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { EditWorkbench } from "./EditWorkbench"

const timeline: CinemaTimelineDocument = {
  schemaVersion: 1,
  id: "timeline-1",
  projectID: "project-1",
  title: "Timeline 1",
  revision: 0,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
  settings: {
    width: 1920,
    height: 1080,
    frameRate: { numerator: 24, denominator: 1 },
    sampleRate: 48_000,
    backgroundColor: "#000000",
  },
  tracks: [
    { id: "track-v1", kind: "video", title: "V1", order: 0, locked: false, muted: false, hidden: false },
    { id: "track-a1", kind: "audio", title: "A1", order: 1, locked: false, muted: false, hidden: false },
  ],
  clips: [],
  markers: [],
}

function renderWorkbench() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <EditWorkbench agentBaseURL="http://localhost" projectID="project-1" />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("EditWorkbench", () => {
  it("creates the first empty Timeline without adding assets", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify({
      success: true,
      data: init?.method === "POST" ? timeline : { timelines: [] },
    }), { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    renderWorkbench()

    expect(await screen.findByRole("heading", { name: "No timelines yet" })).toBeVisible()
    fireEvent.click(screen.getAllByRole("button", { name: "New Timeline" })[1]!)

    expect(await screen.findByText("V1")).toBeVisible()
    expect(screen.getByText("A1")).toBeVisible()
    expect(screen.getByRole("heading", { name: "Add media to start editing" })).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "Browse Project Assets" }))
    expect(screen.getByRole("tab", { name: "Project Assets" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("separator", { name: "Resize preview and Timeline" })).toHaveAttribute("aria-valuenow", "42")
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: "POST" }))
  })

  it("supports keyboard preview resizing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { timelines: [timeline] },
    }), { status: 200, headers: { "content-type": "application/json" } })))
    renderWorkbench()

    const splitter = await screen.findByRole("separator", { name: "Resize preview and Timeline" })
    fireEvent.keyDown(splitter, { key: "ArrowDown" })
    await waitFor(() => expect(splitter).toHaveAttribute("aria-valuenow", "44"))
  })
})
