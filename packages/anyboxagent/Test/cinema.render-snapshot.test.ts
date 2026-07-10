import { afterEach, describe, expect, test } from "bun:test"
import {
  access,
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { CinemaAssetRecord, CinemaAssetRef } from "@anybox/shared/cinema"
import type { CinemaRenderJob } from "@anybox/shared/cinema-render"
import type { CinemaTimelineDocument } from "@anybox/shared/cinema-timeline"

import {
  readCinemaRenderTimelineSnapshot,
  setCinemaRenderSnapshotHooksForTesting,
  snapshotCinemaRenderInputs,
  writeCinemaRenderTimelineSnapshot,
} from "../src/cinema/render-snapshot"
import {
  getCinemaRenderJobStoragePaths,
  writeCinemaRenderJob,
} from "../src/cinema/render-storage"

const roots: string[] = []
const now = "2026-07-10T12:00:00.000Z"

async function temporaryRoot(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function assetRef(
  scope: CinemaAssetRef["scope"],
  assetID: string,
  kind: "video" | "audio" = "video",
  contentRevision = 2,
): CinemaAssetRef {
  return {
    scope,
    assetID,
    contentRevision,
    snapshot: {
      kind,
      displayName: `${assetID}.${kind === "video" ? "mp4" : "wav"}`,
      mimeType: kind === "video" ? "video/mp4" : "audio/wav",
      durationSeconds: 4,
    },
  }
}

function assetRecord(ref: CinemaAssetRef, relativePath: string, sizeBytes: number): CinemaAssetRecord {
  return {
    id: ref.assetID,
    folderID: "source",
    relativePath,
    displayName: ref.snapshot.displayName,
    kind: ref.snapshot.kind,
    source: "upload",
    status: "ready",
    mimeType: ref.snapshot.mimeType,
    sizeBytes,
    checksum: `checksum-${ref.assetID}`,
    durationSeconds: ref.snapshot.durationSeconds,
    contentRevision: ref.contentRevision,
    createdAt: now,
    updatedAt: now,
  }
}

function job(id = "snapshot-job"): CinemaRenderJob {
  return {
    schemaVersion: 1,
    id,
    projectID: "project-1",
    timelineID: "timeline-1",
    timelineRevision: 7,
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
      outputName: "Snapshot output",
    },
    progress: { phase: "queued" },
    createdAt: now,
    updatedAt: now,
  }
}

function timeline(projectVideo: CinemaAssetRef, personalAudio?: CinemaAssetRef): CinemaTimelineDocument {
  return {
    schemaVersion: 1,
    id: "timeline-1",
    projectID: "project-1",
    title: "Snapshot timeline",
    revision: 7,
    createdAt: now,
    updatedAt: now,
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
    clips: [
      {
        id: "clip-v1",
        trackID: "track-v1",
        kind: "video",
        title: "Video",
        timelineStartUs: 0,
        durationUs: 4_000_000,
        playbackRate: 1,
        volume: 1,
        opacity: 1,
        assetRef: projectVideo,
        sourceInUs: 0,
        sourceDurationUs: 4_000_000,
        createdAt: now,
        updatedAt: now,
      },
      ...(personalAudio ? [{
        id: "clip-a1",
        trackID: "track-a1",
        kind: "audio" as const,
        title: "Audio",
        timelineStartUs: 0,
        durationUs: 4_000_000,
        playbackRate: 1,
        volume: 1,
        opacity: 1,
        assetRef: personalAudio,
        sourceInUs: 0,
        sourceDurationUs: 4_000_000,
        createdAt: now,
        updatedAt: now,
      }] : []),
    ],
    markers: [],
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Cinema render snapshot", () => {
  test("injects an EACCES-like immutable Timeline write failure without a partial snapshot", async () => {
    const cinemaRoot = await temporaryRoot("anybox-render-snapshot-")
    const currentJob = job("timeline-write-denied")
    const videoRef = assetRef({ type: "project", projectID: "project-1" }, "asset-video")
    await writeCinemaRenderJob(cinemaRoot, currentJob)
    const restore = setCinemaRenderSnapshotHooksForTesting({
      beforeWriteTimelineSnapshot: async () => {
        throw Object.assign(new Error("Synthetic snapshot write denied"), { code: "EACCES" })
      },
    })
    try {
      const error = await writeCinemaRenderTimelineSnapshot(
        cinemaRoot,
        currentJob.id,
        timeline(videoRef),
      ).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ code: "EACCES" })
      const paths = getCinemaRenderJobStoragePaths(cinemaRoot, currentJob.id)
      expect(access(paths.timelineSnapshotPath)).rejects.toThrow()
      expect((await readdir(paths.jobDirectory)).some((name) => name.endsWith(".tmp"))).toBe(false)
    } finally {
      restore()
    }
  })

  test("injects an EACCES-like input snapshot failure before staging is created", async () => {
    const cinemaRoot = await temporaryRoot("anybox-render-snapshot-")
    const currentJob = job("input-write-denied")
    const videoRef = assetRef({ type: "project", projectID: "project-1" }, "asset-video")
    await writeCinemaRenderJob(cinemaRoot, currentJob)
    await writeCinemaRenderTimelineSnapshot(cinemaRoot, currentJob.id, timeline(videoRef))
    const restore = setCinemaRenderSnapshotHooksForTesting({
      beforeSnapshotInputs: async () => {
        throw Object.assign(new Error("Synthetic input snapshot write denied"), { code: "EACCES" })
      },
    })
    try {
      const error = await snapshotCinemaRenderInputs(cinemaRoot, currentJob.id).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ code: "EACCES" })
      const paths = getCinemaRenderJobStoragePaths(cinemaRoot, currentJob.id)
      expect(access(paths.inputsDirectory)).rejects.toThrow()
      expect((await readdir(paths.jobDirectory)).some((name) => name.startsWith(".inputs."))).toBe(false)
    } finally {
      restore()
    }
  })

  test("freezes the exact Timeline revision and refuses replacement", async () => {
    const cinemaRoot = await temporaryRoot("anybox-render-snapshot-")
    const currentJob = job()
    const videoRef = assetRef({ type: "project", projectID: "project-1" }, "asset-video")
    const sourceTimeline = timeline(videoRef)
    await writeCinemaRenderJob(cinemaRoot, currentJob)
    await writeCinemaRenderTimelineSnapshot(cinemaRoot, currentJob.id, sourceTimeline)

    sourceTimeline.title = "Changed later"
    sourceTimeline.revision = 8
    expect(await readCinemaRenderTimelineSnapshot(cinemaRoot, currentJob.id)).toMatchObject({
      title: "Snapshot timeline",
      revision: 7,
    })
    expect(writeCinemaRenderTimelineSnapshot(cinemaRoot, currentJob.id, timeline(videoRef)))
      .rejects.toThrow("already exists")
  })

  test("rejects a Timeline from another id, revision, or project", async () => {
    const cinemaRoot = await temporaryRoot("anybox-render-snapshot-")
    const currentJob = job()
    const videoRef = assetRef({ type: "project", projectID: "project-1" }, "asset-video")
    const sourceTimeline = timeline(videoRef)
    await writeCinemaRenderJob(cinemaRoot, currentJob)

    expect(writeCinemaRenderTimelineSnapshot(cinemaRoot, currentJob.id, { ...sourceTimeline, revision: 8 }))
      .rejects.toThrow("revision")
    expect(writeCinemaRenderTimelineSnapshot(cinemaRoot, currentJob.id, { ...sourceTimeline, id: "other" }))
      .rejects.toThrow("id")
    expect(writeCinemaRenderTimelineSnapshot(cinemaRoot, currentJob.id, { ...sourceTimeline, projectID: "other" }))
      .rejects.toThrow("project")
  })

  test("hardlinks project inputs, copies personal inputs, and survives source moves", async () => {
    const cinemaRoot = await temporaryRoot("anybox-render-snapshot-")
    const sourceRoot = await temporaryRoot("anybox-render-sources-")
    const currentJob = job()
    const videoRef = assetRef({ type: "project", projectID: "project-1" }, "asset-video")
    const audioRef = assetRef({ type: "personal" }, "asset-audio", "audio", 3)
    const videoPath = path.join(sourceRoot, "project video.mp4")
    const audioPath = path.join(sourceRoot, "personal audio.wav")
    await writeFile(videoPath, "project-video", "utf8")
    await writeFile(audioPath, "personal-audio", "utf8")
    await writeCinemaRenderJob(cinemaRoot, currentJob)
    await writeCinemaRenderTimelineSnapshot(cinemaRoot, currentJob.id, timeline(videoRef, audioRef))

    const records = new Map([
      [videoRef.assetID, { asset: assetRecord(videoRef, "project video.mp4", 13), filePath: videoPath }],
      [audioRef.assetID, { asset: assetRecord(audioRef, "personal audio.wav", 14), filePath: audioPath }],
    ])
    const snapshots = await snapshotCinemaRenderInputs(cinemaRoot, currentJob.id, {
      getCinemaAssetFilePath: async (_scope, assetID) => records.get(assetID)!,
      createHardLink: link,
      copyFile,
    })

    expect(snapshots.map(({ fileName, method }) => [fileName, method])).toEqual([
      ["asset-video_2.mp4", "hardlink"],
      ["asset-audio_3.wav", "copy"],
    ])
    const paths = getCinemaRenderJobStoragePaths(cinemaRoot, currentJob.id)
    await rename(videoPath, path.join(sourceRoot, "moved.mp4"))
    await rm(audioPath)
    expect(await readFile(path.join(paths.inputsDirectory, "asset-video_2.mp4"), "utf8")).toBe("project-video")
    expect(await readFile(path.join(paths.inputsDirectory, "asset-audio_3.wav"), "utf8")).toBe("personal-audio")
  })

  test("falls back to copy when a project hardlink cannot be created", async () => {
    const cinemaRoot = await temporaryRoot("anybox-render-snapshot-")
    const sourceRoot = await temporaryRoot("anybox-render-sources-")
    const currentJob = job("copy-fallback")
    const videoRef = assetRef({ type: "project", projectID: "project-1" }, "asset-video")
    const videoPath = path.join(sourceRoot, "source.mp4")
    await writeFile(videoPath, "video", "utf8")
    await writeCinemaRenderJob(cinemaRoot, currentJob)
    await writeCinemaRenderTimelineSnapshot(cinemaRoot, currentJob.id, timeline(videoRef))

    const snapshots = await snapshotCinemaRenderInputs(cinemaRoot, currentJob.id, {
      getCinemaAssetFilePath: async () => ({
        asset: assetRecord(videoRef, "source.mp4", 5),
        filePath: videoPath,
      }),
      createHardLink: async () => { throw Object.assign(new Error("cross-device"), { code: "EXDEV" }) },
      copyFile,
    })
    expect(snapshots[0]?.method).toBe("copy")
  })

  test("rejects stale revisions and removes the entire staging snapshot", async () => {
    const cinemaRoot = await temporaryRoot("anybox-render-snapshot-")
    const sourceRoot = await temporaryRoot("anybox-render-sources-")
    const currentJob = job("stale")
    const videoRef = assetRef({ type: "project", projectID: "project-1" }, "asset-video")
    const videoPath = path.join(sourceRoot, "source.mp4")
    await writeFile(videoPath, "video", "utf8")
    await writeCinemaRenderJob(cinemaRoot, currentJob)
    await writeCinemaRenderTimelineSnapshot(cinemaRoot, currentJob.id, timeline(videoRef))

    await expect(snapshotCinemaRenderInputs(cinemaRoot, currentJob.id, {
      getCinemaAssetFilePath: async () => ({
        asset: { ...assetRecord(videoRef, "source.mp4", 5), contentRevision: 99 },
        filePath: videoPath,
      }),
      createHardLink: link,
      copyFile,
    })).rejects.toThrow("stale")
    const paths = getCinemaRenderJobStoragePaths(cinemaRoot, currentJob.id)
    expect(access(paths.inputsDirectory)).rejects.toThrow()
    expect((await readdir(paths.jobDirectory)).some((name) => name.startsWith(".inputs."))).toBe(false)
  })

  test("rejects symlink input sources", async () => {
    if (process.platform === "win32") {
      // Windows file symlinks require Developer Mode or elevated privileges.
      // Intermediate junction rejection is covered by the Asset Library and
      // render-storage tests that run on Windows without that privilege.
      return
    }
    const cinemaRoot = await temporaryRoot("anybox-render-snapshot-")
    const sourceRoot = await temporaryRoot("anybox-render-sources-")
    const currentJob = job("symlink-source")
    const videoRef = assetRef({ type: "project", projectID: "project-1" }, "asset-video")
    const actualPath = path.join(sourceRoot, "actual.mp4")
    const linkedPath = path.join(sourceRoot, "linked.mp4")
    await writeFile(actualPath, "video", "utf8")
    await symlink(actualPath, linkedPath, "file")
    await writeCinemaRenderJob(cinemaRoot, currentJob)
    await writeCinemaRenderTimelineSnapshot(cinemaRoot, currentJob.id, timeline(videoRef))

    expect(snapshotCinemaRenderInputs(cinemaRoot, currentJob.id, {
      getCinemaAssetFilePath: async () => ({
        asset: assetRecord(videoRef, "linked.mp4", 5),
        filePath: linkedPath,
      }),
      createHardLink: link,
      copyFile,
    })).rejects.toThrow("physical file")
  })
})
