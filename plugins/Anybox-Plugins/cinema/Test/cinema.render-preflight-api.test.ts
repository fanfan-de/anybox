import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { CinemaRenderPreflightResult } from "@anybox/cinema-plugin/contracts/render"
import type { CinemaTimelineDocument } from "@anybox/cinema-plugin/contracts/timeline"
import { createServerApp } from "#server/server.ts"
import { initializeCinemaProject } from "#project/project.ts"

interface JsonEnvelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string }
}

async function readJson<T>(response: Response) {
  return await response.json() as JsonEnvelope<T>
}

describe("Cinema render preflight API", () => {
  test("returns structured preflight results and rejects invalid settings", async () => {
    const app = createServerApp()
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "anybox-render-preflight-api-")))
    try {
      const project = await initializeCinemaProject(root)
      const cinemaRoot = path.join(root, ".anybox-cinema")
      await mkdir(cinemaRoot, { recursive: true })
      await writeFile(path.join(cinemaRoot, "project.json"), JSON.stringify({
        schemaVersion: 1,
        name: "Preflight fixture",
        createdAt: "2026-07-10T00:00:00.000Z",
      }), "utf8")

      const timelinesURL = `http://localhost/api/cinema/projects/${encodeURIComponent(project.id)}/timelines`
      const createResponse = await app.request(timelinesURL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Preflight timeline" }),
      })
      const timeline = (await readJson<CinemaTimelineDocument>(createResponse)).data!
      const preflightURL = `${timelinesURL}/${encodeURIComponent(timeline.id)}/delivery-preflight`

      const response = await app.request(preflightURL)
      expect(response.status).toBe(200)
      const result = (await readJson<CinemaRenderPreflightResult>(response)).data!
      expect(result).toMatchObject({
        timelineID: timeline.id,
        timelineRevision: 0,
        ready: false,
        durationUs: 0,
        support: { videoClips: 0, audioClips: 0, imageClips: 0, textClips: 0 },
      })
      expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
        "timeline-empty",
        "main-video-missing",
      ]))
      expect(JSON.stringify(result)).not.toContain(root)

      const invalidJson = await app.request(`${preflightURL}?settings=%7Bbad`)
      expect(invalidJson.status).toBe(400)
      expect((await readJson<unknown>(invalidJson)).error?.code).toBe("CINEMA_RENDER_SETTINGS_INVALID")

      const invalidSettings = await app.request(`${preflightURL}?settings=${encodeURIComponent(JSON.stringify({
        width: 1919,
      }))}`)
      expect(invalidSettings.status).toBe(400)
      expect((await readJson<unknown>(invalidSettings)).error?.code).toBe("CINEMA_RENDER_SETTINGS_INVALID")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
