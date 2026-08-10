import { afterEach, describe, expect, test } from "bun:test"
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { CinemaRenderJob } from "@anybox/cinema-plugin/contracts/render"
import {
  appendCinemaRenderJobEvent,
  getCinemaRenderJobStoragePaths,
  listCinemaRenderJobs,
  readCinemaRenderJob,
  readCinemaRenderJobEvents,
  writeCinemaRenderJob,
} from "../src/domain/render-storage"

const roots: string[] = []
const now = "2026-07-10T12:00:00.000Z"

async function temporaryCinemaRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "anybox-cinema-render-storage-"))
  roots.push(root)
  return root
}

function renderJob(id: string, createdAt = now): CinemaRenderJob {
  return {
    schemaVersion: 1,
    id,
    projectID: "project-1",
    timelineID: "timeline-1",
    timelineRevision: 3,
    operationID: `operation-${id}`,
    status: "queued",
    settings: {
      format: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      width: 1920,
      height: 1080,
      frameRate: { numerator: 24, denominator: 1 },
      quality: { mode: "balanced" },
      audioBitrateKbps: 192,
      range: { type: "full" },
      outputName: `Output ${id}`,
    },
    progress: { phase: "queued" },
    createdAt,
    updatedAt: createdAt,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Cinema render storage", () => {
  test("builds sandboxed job paths and rejects traversal ids", async () => {
    const root = await temporaryCinemaRoot()
    const paths = getCinemaRenderJobStoragePaths(root, "job-1")

    expect(paths.jobDirectory).toBe(path.join(root, "render-jobs", "job_job-1"))
    expect(paths.jobPath).toBe(path.join(paths.jobDirectory, "job.json"))
    expect(paths.timelineSnapshotPath).toBe(path.join(paths.jobDirectory, "timeline.json"))
    expect(paths.eventsPath).toBe(path.join(paths.jobDirectory, "events.jsonl"))
    expect(paths.inputsDirectory).toBe(path.join(paths.jobDirectory, "inputs"))
    expect(paths.temporaryOutputPath).toBe(path.join(paths.jobDirectory, "output.tmp.mp4"))
    expect(() => getCinemaRenderJobStoragePaths(root, "../outside")).toThrow("Render id")
    expect(() => getCinemaRenderJobStoragePaths(root, "bad/id")).toThrow("Render id")
  })

  test("atomically writes, reads, and lists newest jobs first", async () => {
    const root = await temporaryCinemaRoot()
    await writeCinemaRenderJob(root, renderJob("older", "2026-07-10T10:00:00.000Z"))
    await writeCinemaRenderJob(root, renderJob("newer", "2026-07-10T11:00:00.000Z"))
    await writeFile(path.join(root, "render-jobs", "notes.txt"), "ignore", "utf8")

    expect(await readCinemaRenderJob(root, "older")).toEqual(renderJob("older", "2026-07-10T10:00:00.000Z"))
    expect((await listCinemaRenderJobs(root)).map((job) => job.id)).toEqual(["newer", "older"])
    expect(await readdir(getCinemaRenderJobStoragePaths(root, "older").jobDirectory)).toEqual(["job.json"])
  })

  test("returns empty results for missing jobs and event logs", async () => {
    const root = await temporaryCinemaRoot()
    expect(await readCinemaRenderJob(root, "missing")).toBeUndefined()
    expect(await readCinemaRenderJobEvents(root, "missing")).toEqual([])
  })

  test("appends and validates JSONL events", async () => {
    const root = await temporaryCinemaRoot()
    await writeCinemaRenderJob(root, renderJob("eventful"))
    await appendCinemaRenderJobEvent(root, {
      schemaVersion: 1,
      id: "event-1",
      jobID: "eventful",
      type: "job-created",
      createdAt: now,
    })
    await appendCinemaRenderJobEvent(root, {
      schemaVersion: 1,
      id: "event-2",
      jobID: "eventful",
      type: "snapshot-started",
      createdAt: now,
    })

    expect((await readCinemaRenderJobEvents(root, "eventful")).map((event) => event.type))
      .toEqual(["job-created", "snapshot-started"])
  })

  test("rejects corrupt persisted jobs and events", async () => {
    const root = await temporaryCinemaRoot()
    const paths = getCinemaRenderJobStoragePaths(root, "broken")
    await mkdir(paths.jobDirectory, { recursive: true })
    await writeFile(paths.jobPath, JSON.stringify({ schemaVersion: 1 }), "utf8")
    await writeFile(paths.eventsPath, "{}\n", "utf8")

    expect(readCinemaRenderJob(root, "broken")).rejects.toThrow()
    expect(readCinemaRenderJobEvents(root, "broken")).rejects.toThrow()
  })

  test("rejects a render job directory redirected through a symlink", async () => {
    const root = await temporaryCinemaRoot()
    const outside = await mkdtemp(path.join(tmpdir(), "anybox-cinema-render-outside-"))
    roots.push(outside)
    const paths = getCinemaRenderJobStoragePaths(root, "linked")
    await mkdir(paths.renderJobsDirectory, { recursive: true })
    await symlink(outside, paths.jobDirectory, process.platform === "win32" ? "junction" : "dir")

    expect(writeCinemaRenderJob(root, renderJob("linked"))).rejects.toThrow("physical directory")
    expect(readCinemaRenderJob(root, "linked")).rejects.toThrow("physical directory")
  })

  test("strict schemas prevent private paths from being persisted", async () => {
    const root = await temporaryCinemaRoot()
    expect(writeCinemaRenderJob(root, {
      ...renderJob("private-path"),
      inputTimelinePath: "C:\\private\\timeline.json",
    } as CinemaRenderJob)).rejects.toThrow()
  })
})
