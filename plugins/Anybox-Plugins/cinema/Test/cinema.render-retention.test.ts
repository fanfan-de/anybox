import { afterEach, describe, expect, test } from "bun:test"
import {
  access,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { CinemaRenderJob } from "@anybox/cinema-plugin/contracts/render"
import { cleanupCinemaRenderJobRetention } from "../src/domain/render-retention"
import {
  appendCinemaRenderJobEvent,
  getCinemaRenderJobStoragePaths,
  readCinemaRenderJob,
  readCinemaRenderJobEvents,
  writeCinemaRenderJob,
} from "../src/domain/render-storage"

const roots: string[] = []
const now = "2026-07-10T12:00:00.000Z"
const oldFinishedAt = "2026-07-08T12:00:00.000Z"
const recentFinishedAt = "2026-07-10T00:01:00.000Z"
const oneDayMs = 24 * 60 * 60 * 1_000

async function temporaryCinemaRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "anybox-render-retention-"))
  roots.push(root)
  return root
}

function renderJob(
  id: string,
  status: "queued" | "canceled" = "canceled",
  finishedAt = oldFinishedAt,
): CinemaRenderJob {
  return {
    schemaVersion: 1,
    id,
    projectID: "project-1",
    timelineID: "timeline-1",
    timelineRevision: 3,
    operationID: `operation-${id}`,
    status,
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
    progress: { phase: status },
    createdAt: oldFinishedAt,
    ...(status === "canceled" ? { finishedAt } : {}),
    updatedAt: status === "canceled" ? finishedAt : oldFinishedAt,
  }
}

async function expectMissing(filePath: string) {
  await expect(access(filePath)).rejects.toThrow()
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Cinema render retention", () => {
  test("requires an explicit positive retention duration", async () => {
    const root = await temporaryCinemaRoot()
    await expect(cleanupCinemaRenderJobRetention(root, {
      retentionDurationMs: 0,
      now,
    })).rejects.toThrow("explicit positive integer")
    await expect(cleanupCinemaRenderJobRetention(root, {
      retentionDurationMs: Number.NaN,
      now,
    })).rejects.toThrow("explicit positive integer")
  })

  test("removes only allowlisted rebuildable files from old terminal jobs", async () => {
    const root = await temporaryCinemaRoot()
    const currentJob = renderJob("old-terminal")
    await writeCinemaRenderJob(root, currentJob)
    await appendCinemaRenderJobEvent(root, {
      schemaVersion: 1,
      id: "event-old-terminal",
      jobID: currentJob.id,
      type: "render-canceled",
      createdAt: oldFinishedAt,
    })
    const paths = getCinemaRenderJobStoragePaths(root, currentJob.id)
    await writeFile(paths.timelineSnapshotPath, "timeline-metadata", "utf8")
    await mkdir(path.join(paths.inputsDirectory, "nested"), { recursive: true })
    await writeFile(path.join(paths.inputsDirectory, "media.bin"), "media", "utf8")
    await writeFile(path.join(paths.inputsDirectory, "nested", "audio.bin"), "audio", "utf8")
    const staging = path.join(paths.jobDirectory, ".inputs.stage-1.tmp")
    await mkdir(staging)
    await writeFile(path.join(staging, "partial.bin"), "partial", "utf8")
    await writeFile(paths.temporaryOutputPath, "output", "utf8")
    const preservedUnknown = path.join(paths.jobDirectory, "output.final.mp4")
    const preservedMetadataTemporary = path.join(paths.jobDirectory, ".job.json.writer.tmp")
    await writeFile(preservedUnknown, "registered-output-placeholder", "utf8")
    await writeFile(preservedMetadataTemporary, "metadata-atomic", "utf8")

    const first = await cleanupCinemaRenderJobRetention(root, {
      retentionDurationMs: oneDayMs,
      now,
    })

    expect(first).toMatchObject({
      discoveredJobCount: 1,
      terminalJobCount: 1,
      eligibleJobCount: 1,
      reclaimedBytes: 23,
      errors: [],
      skipped: [],
    })
    expect(first.cleanedJobs).toEqual([{
      jobID: currentJob.id,
      targets: ["inputs", "temporary-output", "input-staging"],
      reclaimedBytes: 23,
      removedFileCount: 4,
      removedDirectoryCount: 3,
    }])
    await expectMissing(paths.inputsDirectory)
    await expectMissing(staging)
    await expectMissing(paths.temporaryOutputPath)
    expect(await readCinemaRenderJob(root, currentJob.id)).toEqual(currentJob)
    expect(await readCinemaRenderJobEvents(root, currentJob.id)).toHaveLength(1)
    expect(await readFile(paths.timelineSnapshotPath, "utf8")).toBe("timeline-metadata")
    expect(await readFile(preservedUnknown, "utf8")).toBe("registered-output-placeholder")
    expect(await readFile(preservedMetadataTemporary, "utf8")).toBe("metadata-atomic")

    const replay = await cleanupCinemaRenderJobRetention(root, {
      retentionDurationMs: oneDayMs,
      now,
    })
    expect(replay).toMatchObject({
      discoveredJobCount: 1,
      terminalJobCount: 1,
      eligibleJobCount: 1,
      reclaimedBytes: 0,
      cleanedJobs: [],
      errors: [],
      skipped: [],
    })
  })

  test("skips active and recent jobs before inspecting their rebuildable files", async () => {
    const root = await temporaryCinemaRoot()
    const active = renderJob("active", "queued")
    const recent = renderJob("recent", "canceled", recentFinishedAt)
    const old = renderJob("old")
    for (const job of [active, recent, old]) {
      await writeCinemaRenderJob(root, job)
      const paths = getCinemaRenderJobStoragePaths(root, job.id)
      await mkdir(paths.inputsDirectory)
      await writeFile(path.join(paths.inputsDirectory, "keep-or-clean.bin"), job.id, "utf8")
    }

    const result = await cleanupCinemaRenderJobRetention(root, {
      retentionDurationMs: oneDayMs,
      now,
    })

    expect(result).toMatchObject({
      discoveredJobCount: 3,
      terminalJobCount: 2,
      eligibleJobCount: 1,
    })
    expect(result.skipped).toEqual(expect.arrayContaining([
      { jobID: active.id, reason: "active-job" },
      { jobID: recent.id, reason: "within-retention" },
    ]))
    expect(access(getCinemaRenderJobStoragePaths(root, active.id).inputsDirectory)).resolves.toBeNull()
    expect(access(getCinemaRenderJobStoragePaths(root, recent.id).inputsDirectory)).resolves.toBeNull()
    await expectMissing(getCinemaRenderJobStoragePaths(root, old.id).inputsDirectory)
  })

  test("does not traverse linked candidates or delete candidates with the wrong type", async () => {
    const root = await temporaryCinemaRoot()
    const outside = await mkdtemp(path.join(tmpdir(), "anybox-retention-outside-"))
    roots.push(outside)
    const outsideFile = path.join(outside, "outside.bin")
    await writeFile(outsideFile, "must-survive", "utf8")

    const redirected = renderJob("redirected-inputs")
    await writeCinemaRenderJob(root, redirected)
    const redirectedPaths = getCinemaRenderJobStoragePaths(root, redirected.id)
    await symlink(
      outside,
      redirectedPaths.inputsDirectory,
      process.platform === "win32" ? "junction" : "dir",
    )
    await writeFile(redirectedPaths.temporaryOutputPath, "safe-to-remove", "utf8")

    const nestedLink = renderJob("nested-link")
    await writeCinemaRenderJob(root, nestedLink)
    const nestedPaths = getCinemaRenderJobStoragePaths(root, nestedLink.id)
    await mkdir(nestedPaths.inputsDirectory)
    await writeFile(path.join(nestedPaths.inputsDirectory, "physical.bin"), "keep-as-unit", "utf8")
    await symlink(
      outside,
      path.join(nestedPaths.inputsDirectory, "redirect"),
      process.platform === "win32" ? "junction" : "dir",
    )

    const malformed = renderJob("malformed-candidates")
    await writeCinemaRenderJob(root, malformed)
    const malformedPaths = getCinemaRenderJobStoragePaths(root, malformed.id)
    await writeFile(malformedPaths.inputsDirectory, "not-an-input-directory", "utf8")
    await mkdir(malformedPaths.temporaryOutputPath)
    await writeFile(path.join(malformedPaths.temporaryOutputPath, "not-output.bin"), "preserve", "utf8")

    const result = await cleanupCinemaRenderJobRetention(root, {
      retentionDurationMs: oneDayMs,
      now,
    })

    expect(result.skipped).toEqual(expect.arrayContaining([
      { jobID: redirected.id, reason: "unsafe-candidate", target: "inputs" },
      { jobID: nestedLink.id, reason: "unsafe-candidate", target: "inputs" },
      { jobID: malformed.id, reason: "unsafe-candidate", target: "inputs" },
      { jobID: malformed.id, reason: "unsafe-candidate", target: "temporary-output" },
    ]))
    expect(await readFile(outsideFile, "utf8")).toBe("must-survive")
    expect(await readFile(path.join(nestedPaths.inputsDirectory, "physical.bin"), "utf8"))
      .toBe("keep-as-unit")
    expect(await readFile(malformedPaths.inputsDirectory, "utf8")).toBe("not-an-input-directory")
    expect(await readFile(path.join(malformedPaths.temporaryOutputPath, "not-output.bin"), "utf8"))
      .toBe("preserve")
    await expectMissing(redirectedPaths.temporaryOutputPath)
  })

  test("reports unsafe job directories and invalid metadata while continuing other jobs", async () => {
    const root = await temporaryCinemaRoot()
    const valid = renderJob("valid")
    await writeCinemaRenderJob(root, valid)
    const validPaths = getCinemaRenderJobStoragePaths(root, valid.id)
    await mkdir(validPaths.inputsDirectory)
    await writeFile(path.join(validPaths.inputsDirectory, "media.bin"), "clean", "utf8")

    const brokenPaths = getCinemaRenderJobStoragePaths(root, "broken")
    await mkdir(brokenPaths.jobDirectory)
    await writeFile(brokenPaths.jobPath, "{}", "utf8")

    const outside = await mkdtemp(path.join(tmpdir(), "anybox-retention-job-link-"))
    roots.push(outside)
    const linkedPaths = getCinemaRenderJobStoragePaths(root, "linked")
    await symlink(
      outside,
      linkedPaths.jobDirectory,
      process.platform === "win32" ? "junction" : "dir",
    )

    const result = await cleanupCinemaRenderJobRetention(root, {
      retentionDurationMs: oneDayMs,
      now,
    })

    expect(result.discoveredJobCount).toBe(3)
    expect(result.skipped).toContainEqual({ jobID: "linked", reason: "unsafe-job-directory" })
    expect(result.errors).toContainEqual({
      jobID: "broken",
      code: "job-metadata-invalid",
      target: "job-metadata",
      message: "Render job metadata could not be read or validated.",
    })
    await expectMissing(validPaths.inputsDirectory)
  })

  test("removes hard-linked snapshots without claiming bytes still owned by another link", async () => {
    const root = await temporaryCinemaRoot()
    const currentJob = renderJob("hardlink")
    await writeCinemaRenderJob(root, currentJob)
    const paths = getCinemaRenderJobStoragePaths(root, currentJob.id)
    await mkdir(paths.inputsDirectory)
    const original = path.join(root, "source.bin")
    const snapshot = path.join(paths.inputsDirectory, "source_0.bin")
    await writeFile(original, "shared-contents", "utf8")
    await link(original, snapshot)

    const result = await cleanupCinemaRenderJobRetention(root, {
      retentionDurationMs: oneDayMs,
      now,
    })

    expect(result.reclaimedBytes).toBe(0)
    expect(result.cleanedJobs[0]).toMatchObject({
      jobID: currentJob.id,
      reclaimedBytes: 0,
      removedFileCount: 1,
      removedDirectoryCount: 1,
    })
    expect(await readFile(original, "utf8")).toBe("shared-contents")
    await expectMissing(snapshot)
  })
})
