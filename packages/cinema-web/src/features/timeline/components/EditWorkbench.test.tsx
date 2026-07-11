/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CinemaTimelineCommand, CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import { EditWorkbench } from "./EditWorkbench"
import { I18nProvider } from "../../../i18n"
import { projectTimelineCommand } from "../model/timelineProjection"

const timeline: CinemaTimelineDocument = {
  schemaVersion: 2,
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

const timelineWithTextClip: CinemaTimelineDocument = {
  ...timeline,
  tracks: [
    ...timeline.tracks,
    { id: "track-o1", kind: "overlay", title: "O1", order: 2, locked: false, muted: false, hidden: false },
  ],
  clips: [{
    id: "clip-title",
    trackID: "track-o1",
    kind: "text",
    title: "Title card",
    timelineStartUs: 0,
    durationUs: 2_000_000,
    playbackRate: 1,
    volume: 1,
    opacity: 1,
    text: { value: "Opening title", stylePresetID: "title-default" },
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  }],
}

function createTimelineFetchMock(initialTimeline: CinemaTimelineDocument) {
  let current = initialTimeline
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/commands") && init?.method === "POST") {
      const command = JSON.parse(String(init.body)) as CinemaTimelineCommand
      current = {
        ...projectTimelineCommand(current, command),
        revision: command.baseRevision + 1,
      }
      return new Response(JSON.stringify({
        success: true,
        data: {
          timeline: current,
          event: {
            time: "2026-07-10T00:00:00.000Z",
            timelineID: current.id,
            type: `timeline.${command.type}`,
            actor: "test",
            commandID: command.id,
            baseRevision: command.baseRevision,
            revision: current.revision,
            message: "updated",
            command,
          },
        },
      }), { status: 200, headers: { "content-type": "application/json" } })
    }
    return new Response(JSON.stringify({
      success: true,
      data: { timelines: [current] },
    }), { status: 200, headers: { "content-type": "application/json" } })
  })
}

function renderWorkbench() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en-US">
        <EditWorkbench agentBaseURL="http://localhost" projectID="project-1" />
      </I18nProvider>
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

  it("shows only the subtitle track inspector after creating a track from a selected clip", async () => {
    vi.stubGlobal("fetch", createTimelineFetchMock(timelineWithTextClip))
    renderWorkbench()

    fireEvent.keyDown(await screen.findByRole("button", { name: "Title card, Text" }), { key: "Enter" })
    expect(screen.getByRole("complementary", { name: "Timeline inspector" })).toBeVisible()

    fireEvent.click(screen.getByRole("tab", { name: "Subtitles" }))
    fireEvent.click(screen.getByRole("button", { name: "Add subtitle track" }))

    expect(await screen.findByRole("complementary", { name: "Subtitle track" })).toBeVisible()
    expect(screen.queryByRole("complementary", { name: "Timeline inspector" })).not.toBeInTheDocument()
  })

  it("keeps the media bin and inspector mutually exclusive in compact layouts", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(max-width: 1099px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })))
    vi.stubGlobal("fetch", createTimelineFetchMock(timelineWithTextClip))
    renderWorkbench()

    expect(await screen.findByRole("complementary", { name: "Media bin" })).toBeVisible()
    fireEvent.keyDown(await screen.findByRole("button", { name: "Title card, Text" }), { key: "Enter" })

    expect(await screen.findByRole("complementary", { name: "Timeline inspector" })).toBeVisible()
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Media bin" })).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole("button", { name: "Toggle media bin" }))
    expect(await screen.findByRole("complementary", { name: "Media bin" })).toBeVisible()
    expect(screen.queryByRole("complementary", { name: "Timeline inspector" })).not.toBeInTheDocument()
  })
})
