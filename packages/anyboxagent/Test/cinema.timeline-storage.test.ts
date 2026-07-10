import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"
import {
  deleteCinemaTimelineStorage,
  getCinemaTimelineStoragePaths,
  listCinemaTimelineDocuments,
  readCinemaTimelineDocument,
  writeCinemaTimelineDocument,
} from "../src/cinema/timeline-storage"

const roots: string[] = []
const now = "2026-07-10T00:00:00.000Z"

async function temporaryCinemaRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "anybox-cinema-timeline-"))
  roots.push(root)
  return root
}

function timeline(id: string, updatedAt = now): CinemaTimelineDocument {
  return {
    schemaVersion: 1,
    id,
    projectID: "project-1",
    title: `Timeline ${id}`,
    revision: 0,
    createdAt: now,
    updatedAt,
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
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Cinema timeline storage", () => {
  test("builds the documented paths and rejects traversal ids", async () => {
    const root = await temporaryCinemaRoot()
    const paths = getCinemaTimelineStoragePaths(root, "rough-cut_1")

    expect(paths.documentPath).toBe(path.join(root, "timelines", "timeline_rough-cut_1.json"))
    expect(paths.eventsPath).toBe(path.join(root, "timeline-events", "timeline_rough-cut_1.jsonl"))
    expect(paths.timelineCacheDirectory).toBe(path.join(root, "cache", "timelines", "timeline_rough-cut_1"))
    expect(() => getCinemaTimelineStoragePaths(root, "../outside")).toThrow("Timeline id")
    expect(() => getCinemaTimelineStoragePaths(root, "bad/id")).toThrow("Timeline id")
  })

  test("returns undefined for a missing timeline", async () => {
    const root = await temporaryCinemaRoot()
    expect(await readCinemaTimelineDocument(root, "missing")).toBeUndefined()
  })

  test("atomically writes and validates timeline documents", async () => {
    const root = await temporaryCinemaRoot()
    await writeCinemaTimelineDocument(root, timeline("timeline-1"))

    expect(await readCinemaTimelineDocument(root, "timeline-1")).toEqual(timeline("timeline-1"))
    const entries = await readdir(path.join(root, "timelines"))
    expect(entries).toEqual(["timeline_timeline-1.json"])
  })

  test("rejects corrupt or invalid persisted documents", async () => {
    const root = await temporaryCinemaRoot()
    const paths = getCinemaTimelineStoragePaths(root, "broken")
    await mkdir(paths.timelinesDirectory, { recursive: true })
    await writeFile(paths.documentPath, JSON.stringify({ schemaVersion: 1 }), "utf8")

    expect(readCinemaTimelineDocument(root, "broken")).rejects.toThrow()
  })

  test("lists newest timelines first and ignores unrelated files", async () => {
    const root = await temporaryCinemaRoot()
    await writeCinemaTimelineDocument(root, timeline("older", "2026-07-09T00:00:00.000Z"))
    await writeCinemaTimelineDocument(root, timeline("newer", "2026-07-10T00:00:00.000Z"))
    await writeFile(path.join(root, "timelines", "notes.txt"), "ignore", "utf8")

    expect((await listCinemaTimelineDocuments(root)).map((item) => item.id)).toEqual(["newer", "older"])
  })

  test("deletes document, event log, and derived cache together", async () => {
    const root = await temporaryCinemaRoot()
    const paths = getCinemaTimelineStoragePaths(root, "delete-me")
    await writeCinemaTimelineDocument(root, timeline("delete-me"))
    await mkdir(paths.timelineCacheDirectory, { recursive: true })
    await mkdir(paths.eventsDirectory, { recursive: true })
    await writeFile(paths.eventsPath, "{}\n", "utf8")
    await writeFile(path.join(paths.timelineCacheDirectory, "waveform.json"), "{}", "utf8")

    await deleteCinemaTimelineStorage(root, "delete-me")

    expect(await readCinemaTimelineDocument(root, "delete-me")).toBeUndefined()
    expect(await readdir(paths.eventsDirectory)).toEqual([])
    expect(await readdir(paths.cacheDirectory)).toEqual([])
  })
})
