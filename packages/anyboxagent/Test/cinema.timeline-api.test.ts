import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type {
  CinemaTimelineCommandResult,
  CinemaTimelineDocument,
  CinemaTimelineEventsResult,
  CinemaTimelineListResult,
} from "@anybox/shared/cinema-timeline"
import { createServerApp } from "#server/server.ts"
import { initializeCinemaAssetLibrary } from "#cinema/asset-library.ts"

interface JsonEnvelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string }
}

interface ProjectResponse {
  id: string
}

async function readJson<T>(response: Response) {
  return await response.json() as JsonEnvelope<T>
}

async function createProject(app: ReturnType<typeof createServerApp>, root: string) {
  const response = await app.request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory: root }),
  })
  expect(response.status).toBe(201)
  const body = await readJson<ProjectResponse>(response)
  return body.data!
}

async function initializeCinema(root: string) {
  const cinemaRoot = path.join(root, ".anybox-cinema")
  await mkdir(cinemaRoot, { recursive: true })
  await writeFile(path.join(cinemaRoot, "project.json"), JSON.stringify({
    schemaVersion: 1,
    name: "Timeline API Fixture",
    createdAt: "2026-07-10T00:00:00.000Z",
  }), "utf8")
}

async function seedReadyVideoAsset(root: string, projectID: string) {
  await initializeCinemaAssetLibrary({ type: "project", projectID })
  const catalogPath = path.join(root, ".anybox-cinema", "asset-library.json")
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as { assets: Array<Record<string, unknown>> }
  catalog.assets.push({
    id: "asset-video-1",
    folderID: "generated-videos",
    relativePath: "生成素材/视频/fixture.mp4",
    displayName: "Fixture video",
    kind: "video",
    source: "generation",
    status: "ready",
    mimeType: "video/mp4",
    sizeBytes: 1,
    checksum: "fixture",
    durationSeconds: 4,
    contentRevision: 0,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  })
  catalog.assets.push({
    id: "asset-video-trashed",
    folderID: "generated-videos",
    relativePath: "生成素材/视频/trashed.mp4",
    displayName: "Trashed video",
    kind: "video",
    source: "generation",
    status: "trashed",
    mimeType: "video/mp4",
    sizeBytes: 1,
    checksum: "fixture-trashed",
    durationSeconds: 4,
    contentRevision: 0,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  })
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8")
}

describe("Cinema timeline API", () => {
  test("lists, creates, and reads an empty V1/A1 timeline", async () => {
    const app = createServerApp()
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "anybox-timeline-api-")))
    try {
      const project = await createProject(app, root)
      await initializeCinema(root)
      await seedReadyVideoAsset(root, project.id)
      const baseURL = `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/timelines`

      const emptyResponse = await app.request(baseURL)
      expect(emptyResponse.status).toBe(200)
      expect((await readJson<CinemaTimelineListResult>(emptyResponse)).data?.timelines).toEqual([])

      const createResponse = await app.request(baseURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Assembly" }),
      })
      expect(createResponse.status).toBe(200)
      const created = (await readJson<CinemaTimelineDocument>(createResponse)).data!
      expect(created.title).toBe("Assembly")
      expect(created.revision).toBe(0)
      expect(created.tracks.map((track) => [track.kind, track.title])).toEqual([
        ["video", "V1"],
        ["audio", "A1"],
      ])
      expect(created.clips).toEqual([])

      const getResponse = await app.request(`${baseURL}/${encodeURIComponent(created.id)}`)
      expect(getResponse.status).toBe(200)
      expect((await readJson<CinemaTimelineDocument>(getResponse)).data).toEqual(created)

      const listResponse = await app.request(baseURL)
      expect((await readJson<CinemaTimelineListResult>(listResponse)).data?.timelines.map((item) => item.id))
        .toEqual([created.id])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects invalid ids and does not initialize missing Cinema projects", async () => {
    const app = createServerApp()
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "anybox-timeline-api-")))
    try {
      const project = await createProject(app, root)
      const baseURL = `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/timelines`

      const uninitialized = await app.request(baseURL)
      expect(uninitialized.status).toBe(404)
      expect((await readJson<unknown>(uninitialized)).error?.code).toBe("CINEMA_PROJECT_NOT_INITIALIZED")

      await initializeCinema(root)
      const invalid = await app.request(`${baseURL}/bad%2Fid`)
      expect(invalid.status).toBe(400)
      expect((await readJson<unknown>(invalid)).error?.code).toBe("CINEMA_TIMELINE_ID_INVALID")

      const missing = await app.request(`${baseURL}/missing`)
      expect(missing.status).toBe(404)
      expect((await readJson<unknown>(missing)).error?.code).toBe("CINEMA_TIMELINE_NOT_FOUND")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("serializes commands, rejects stale revisions, and deduplicates command ids", async () => {
    const app = createServerApp()
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "anybox-timeline-api-")))
    try {
      const project = await createProject(app, root)
      await initializeCinema(root)
      await seedReadyVideoAsset(root, project.id)
      const baseURL = `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/timelines`
      const created = (await readJson<CinemaTimelineDocument>(await app.request(baseURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Commands" }),
      }))).data!
      const commandURL = `${baseURL}/${created.id}/commands`
      const videoTrackID = created.tracks.find((track) => track.kind === "video")!.id
      const addCommand = {
        id: "command-add-1",
        timelineID: created.id,
        baseRevision: 0,
        actor: "test",
        type: "add-clip",
        clip: {
          id: "clip-1",
          trackID: videoTrackID,
          kind: "video",
          title: "Shot 1",
          timelineStartUs: 0,
          durationUs: 2_000_000,
          playbackRate: 1,
          volume: 1,
          opacity: 1,
          createdAt: "2026-07-10T00:00:00.000Z",
          updatedAt: "2026-07-10T00:00:00.000Z",
          assetRef: {
            scope: { type: "project", projectID: project.id },
            assetID: "asset-video-1",
            contentRevision: 0,
            snapshot: {
              kind: "video",
              displayName: "shot.mp4",
              mimeType: "video/mp4",
              durationSeconds: 4,
            },
          },
          sourceInUs: 0,
          sourceDurationUs: 2_000_000,
        },
      }

      for (const invalid of [
        { id: "command-missing-asset", assetID: "asset-video-missing", projectID: project.id, status: 404, code: "CINEMA_LIBRARY_ASSET_NOT_FOUND" },
        { id: "command-trashed-asset", assetID: "asset-video-trashed", projectID: project.id, status: 409, code: "CINEMA_ASSET_NOT_READY" },
        { id: "command-foreign-asset", assetID: "asset-video-1", projectID: "another-project", status: 400, code: "CINEMA_ASSET_SCOPE_INVALID" },
      ]) {
        const response = await app.request(commandURL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...addCommand,
            id: invalid.id,
            clip: {
              ...addCommand.clip,
              id: `${invalid.id}-clip`,
              assetRef: {
                ...addCommand.clip.assetRef,
                scope: { type: "project", projectID: invalid.projectID },
                assetID: invalid.assetID,
              },
            },
          }),
        })
        expect(response.status).toBe(invalid.status)
        expect((await readJson<unknown>(response)).error?.code).toBe(invalid.code)
      }

      const firstResponse = await app.request(commandURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(addCommand),
      })
      expect(firstResponse.status).toBe(200)
      const first = (await readJson<CinemaTimelineCommandResult>(firstResponse)).data!
      expect(first.timeline.revision).toBe(1)
      expect(first.timeline.clips).toHaveLength(1)

      const duplicateResponse = await app.request(commandURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(addCommand),
      })
      expect(duplicateResponse.status).toBe(200)
      const duplicate = (await readJson<CinemaTimelineCommandResult>(duplicateResponse)).data!
      expect(duplicate.timeline.revision).toBe(1)
      expect(duplicate.timeline.clips).toHaveLength(1)
      expect(duplicate.event.commandID).toBe("command-add-1")

      const markerCommands = ["a", "b"].map((suffix) => ({
        id: `command-marker-${suffix}`,
        timelineID: created.id,
        baseRevision: 1,
        actor: "test",
        type: "add-marker",
        marker: { id: `marker-${suffix}`, timeUs: 0, title: suffix, color: "default" },
      }))
      const concurrent = await Promise.all(markerCommands.map((payload) => app.request(commandURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })))
      expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409])
      const conflict = concurrent.find((response) => response.status === 409)!
      expect((await readJson<unknown>(conflict)).error?.code).toBe("CINEMA_TIMELINE_REVISION_CONFLICT")

      const eventsResponse = await app.request(`${baseURL}/${created.id}/events`)
      const events = (await readJson<CinemaTimelineEventsResult>(eventsResponse)).data!
      expect(events.events).toHaveLength(2)
      expect(events.events[0]?.commandID).toBe("command-add-1")
      expect(JSON.stringify(events)).not.toContain(root)

      const otherTimeline = (await readJson<CinemaTimelineDocument>(await app.request(baseURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Independent Timeline" }),
      }))).data!
      const independent = await Promise.all([
        app.request(commandURL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "command-independent-a",
            timelineID: created.id,
            baseRevision: 2,
            actor: "test",
            type: "add-marker",
            marker: { id: "marker-independent-a", timeUs: 0, title: "A", color: "default" },
          }),
        }),
        app.request(`${baseURL}/${otherTimeline.id}/commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "command-independent-b",
            timelineID: otherTimeline.id,
            baseRevision: 0,
            actor: "test",
            type: "add-marker",
            marker: { id: "marker-independent-b", timeUs: 0, title: "B", color: "default" },
          }),
        }),
      ])
      expect(independent.map((response) => response.status)).toEqual([200, 200])

      const deleteResponse = await app.request(`${baseURL}/${created.id}`, { method: "DELETE" })
      expect(deleteResponse.status).toBe(200)
      const missingResponse = await app.request(`${baseURL}/${created.id}`)
      expect(missingResponse.status).toBe(404)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
