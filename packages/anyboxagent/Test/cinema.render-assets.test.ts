import { afterEach, describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { CinemaRenderJob } from "@anybox/shared/cinema-render"
import {
  getCinemaAsset,
  initializeCinemaAssetLibrary,
  setCinemaAssetLibraryCatalogWriteFailureForTest,
} from "../src/cinema/asset-library"
import {
  findRegisteredCinemaRenderOutput,
  registerCinemaRenderOutput,
} from "../src/cinema/render-assets"
import { resolveMediaToolPaths, runMediaTool } from "../src/cinema/media-runtime"
import { recoverCinemaRenderJobs } from "../src/cinema/render-recovery"
import {
  readCinemaRenderJob,
  readCinemaRenderJobEvents,
  writeCinemaRenderJob,
} from "../src/cinema/render-storage"
import { createServerApp } from "../src/server/server"

const roots: string[] = []
const now = "2026-07-10T12:00:00.000Z"

async function createProject() {
  const app = createServerApp()
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "anybox-render-assets-")))
  roots.push(root)
  const response = await app.request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory: root }),
  })
  const body = await response.json() as { data: { id: string } }
  const projectID = body.data.id
  const cinemaRoot = path.join(root, ".anybox-cinema")
  await mkdir(cinemaRoot, { recursive: true })
  await writeFile(path.join(cinemaRoot, "project.json"), JSON.stringify({
    schemaVersion: 1,
    name: "Render assets",
    createdAt: now,
  }), "utf8")
  await initializeCinemaAssetLibrary({ type: "project", projectID })
  return { root, cinemaRoot, projectID }
}

function job(projectID: string, id = "render-assets-job"): CinemaRenderJob {
  return {
    schemaVersion: 1,
    id,
    projectID,
    timelineID: "timeline-1",
    timelineRevision: 1,
    operationID: `operation-${id}`,
    status: "registering",
    settings: {
      format: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      width: 160,
      height: 90,
      frameRate: { numerator: 24, denominator: 1 },
      quality: { mode: "balanced" },
      audioBitrateKbps: 128,
      range: { type: "full" },
      outputName: "Final export",
    },
    progress: { phase: "registering" },
    createdAt: now,
    startedAt: now,
    updatedAt: now,
  }
}

async function createOutput(outputPath: string) {
  const tools = await resolveMediaToolPaths()
  await runMediaTool(tools.ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=24:d=0.5",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=0.5",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", outputPath,
  ])
}

afterEach(async () => {
  setCinemaAssetLibraryCatalogWriteFailureForTest(false)
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Cinema render output assets", () => {
  test("registers into the exports system folder and recovers the same operation after the source moved", async () => {
    const { root, cinemaRoot, projectID } = await createProject()
    const currentJob = job(projectID)
    const outputPath = path.join(cinemaRoot, "render-jobs", "job_render-assets-job", "output.tmp.mp4")
    await mkdir(path.dirname(outputPath), { recursive: true })
    await createOutput(outputPath)

    const first = await registerCinemaRenderOutput(currentJob, outputPath)
    expect(first.scope).toEqual({ type: "project", projectID })
    expect(first.snapshot).toMatchObject({ kind: "video", mimeType: "video/mp4", width: 160, height: 90 })
    const stored = (await getCinemaAsset({ type: "project", projectID }, first.assetID)).asset
    expect(stored).toMatchObject({
      source: "render",
      folderID: "exports",
      relativePath: "导出/Final export.mp4",
      status: "ready",
    })
    expect(access(path.join(root, "assets", "library", "导出", "Final export.mp4"))).resolves.toBeNull()
    expect(access(outputPath)).rejects.toThrow()

    const replay = await registerCinemaRenderOutput(currentJob, outputPath)
    expect(replay).toEqual(first)
    expect(await findRegisteredCinemaRenderOutput(currentJob)).toEqual(first)

    await writeCinemaRenderJob(cinemaRoot, currentJob)
    await recoverCinemaRenderJobs(cinemaRoot, "2026-07-10T13:00:00.000Z")
    expect(await readCinemaRenderJob(cinemaRoot, currentJob.id)).toMatchObject({
      status: "succeeded",
      outputAssetRef: first,
      finishedAt: "2026-07-10T13:00:00.000Z",
    })
    expect((await readCinemaRenderJobEvents(cinemaRoot, currentJob.id)).map((event) => event.type))
      .toEqual(["render-succeeded"])
  })

  test("adds the exports folder to an existing catalog without changing its mutation revision", async () => {
    const { root, cinemaRoot, projectID } = await createProject()
    const catalogPath = path.join(cinemaRoot, "asset-library.json")
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
      revision: number
      folders: Array<{ id: string }>
    }
    const revision = catalog.revision
    catalog.folders = catalog.folders.filter((folder) => folder.id !== "exports")
    await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8")
    await rm(path.join(root, "assets", "library", "导出"), { recursive: true, force: true })

    const initialized = await initializeCinemaAssetLibrary({ type: "project", projectID })
    expect(initialized.catalog.revision).toBe(revision)
    expect(initialized.catalog.folders.find((folder) => folder.id === "exports")).toMatchObject({
      relativePath: "导出",
      system: true,
    })
    expect(access(path.join(root, "assets", "library", "导出"))).resolves.toBeNull()
  })

  test("rolls the output file back and exposes no registered render asset when catalog commit fails", async () => {
    const { cinemaRoot, projectID } = await createProject()
    const currentJob = job(projectID, "render-assets-failure")
    const outputPath = path.join(cinemaRoot, "render-jobs", "job_render-assets-failure", "output.tmp.mp4")
    await mkdir(path.dirname(outputPath), { recursive: true })
    await createOutput(outputPath)
    setCinemaAssetLibraryCatalogWriteFailureForTest(true)

    await expect(registerCinemaRenderOutput(currentJob, outputPath)).rejects.toThrow("Synthetic catalog write failure")
    expect(access(outputPath)).resolves.toBeNull()
    expect(await findRegisteredCinemaRenderOutput(currentJob)).toBeUndefined()
  })
})
