/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { CinemaRenderJob } from "@anybox/shared/cinema-render"
import { RenderProgress } from "./RenderProgress"

afterEach(cleanup)

function job(status: CinemaRenderJob["status"], extras: Partial<CinemaRenderJob> = {}) {
  return {
    schemaVersion: 1,
    id: `job-${status}`,
    projectID: "project-1",
    timelineID: "timeline-1",
    timelineRevision: 1,
    operationID: `operation-${status}`,
    status,
    settings: {
      format: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      width: 320,
      height: 180,
      frameRate: { numerator: 25, denominator: 1 },
      quality: { mode: "balanced" },
      audioBitrateKbps: 192,
      range: { type: "full" },
      outputName: "output",
    },
    progress: { phase: status, message: "Fixture status" },
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...(status === "succeeded" || status === "failed" || status === "canceled" || status === "interrupted" ? { finishedAt: "2026-07-10T00:00:01.000Z" } : {}),
    ...extras,
  } as CinemaRenderJob
}

describe("RenderProgress", () => {
  it("does not invent a determinate percentage outside real render progress", () => {
    render(<RenderProgress job={job("snapshotting")} actionPending={false} onCancel={vi.fn()} onRetry={vi.fn()} onNewRender={vi.fn()} />)

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it("offers retry for a retryable failure", () => {
    render(<RenderProgress job={job("failed", { error: {
      code: "render-failed",
      message: "Encoder failed",
      retryable: true,
      diagnosticSummary: {
        phase: "rendering",
        runtime: {
          runtimeID: "bundled-win32-x64",
          ffmpegVersion: "7.1.1",
          platform: "win32",
          videoEncoder: "h264_mf",
          audioEncoder: "aac",
        },
      },
    } })} actionPending={false} onCancel={vi.fn()} onRetry={vi.fn()} onNewRender={vi.fn()} />)

    expect(screen.getByRole("alert")).toHaveTextContent("Encoder failed")
    expect(screen.getByRole("alert")).toHaveTextContent("Phase: rendering. Runtime: bundled-win32-x64 · win32 · h264_mf/aac · FFmpeg 7.1.1.")
    expect(screen.getByRole("button", { name: /Retry/ })).toBeVisible()
  })

  it("offers a new render after cancellation", () => {
    render(<RenderProgress job={job("canceled")} actionPending={false} onCancel={vi.fn()} onRetry={vi.fn()} onNewRender={vi.fn()} />)

    expect(screen.getByRole("button", { name: "Start a new render" })).toBeVisible()
  })

  it("offers retry and a new render after interruption", () => {
    render(<RenderProgress job={job("interrupted")} actionPending={false} onCancel={vi.fn()} onRetry={vi.fn()} onNewRender={vi.fn()} />)

    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Start a new render" })).toBeVisible()
  })

  it("separates retrying the frozen revision from rendering the current revision", () => {
    render(
      <RenderProgress
        job={job("failed", { error: { code: "render-failed", message: "Encoder failed", retryable: true } })}
        actionPending={false}
        currentTimelineRevision={2}
        latestRenderReady
        onCancel={vi.fn()}
        onRetry={vi.fn()}
        onNewRender={vi.fn()}
        onRenderLatest={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "Retry revision 1" })).toBeVisible()
    expect(screen.getByRole("button", { name: "Render revision 2" })).toBeVisible()
  })
})
