import { randomUUID } from "node:crypto"
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises"
import path from "node:path"

import {
  CinemaTimelineDocumentSchema,
  CinemaTimelineEventSchema,
  CinemaTimelineIDSchema,
  type CinemaTimelineDocument,
  type CinemaTimelineEvent,
} from "@anybox/shared/cinema-timeline"

export type CinemaTimelineStoragePaths = {
  timelinesDirectory: string
  eventsDirectory: string
  cacheDirectory: string
  documentPath: string
  eventsPath: string
  timelineCacheDirectory: string
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function assertPathInside(parent: string, candidate: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Timeline path resolves outside the Cinema project directory")
  }
}

export function assertCinemaTimelineID(timelineID: string) {
  return CinemaTimelineIDSchema.parse(timelineID)
}

export function getCinemaTimelineStoragePaths(
  cinemaRoot: string,
  timelineID: string,
): CinemaTimelineStoragePaths {
  assertCinemaTimelineID(timelineID)

  const timelinesDirectory = path.join(cinemaRoot, "timelines")
  const eventsDirectory = path.join(cinemaRoot, "timeline-events")
  const cacheDirectory = path.join(cinemaRoot, "cache", "timelines")
  const documentPath = path.join(timelinesDirectory, `timeline_${timelineID}.json`)
  const eventsPath = path.join(eventsDirectory, `timeline_${timelineID}.jsonl`)
  const timelineCacheDirectory = path.join(cacheDirectory, `timeline_${timelineID}`)

  assertPathInside(cinemaRoot, documentPath)
  assertPathInside(cinemaRoot, eventsPath)
  assertPathInside(cinemaRoot, timelineCacheDirectory)

  return {
    timelinesDirectory,
    eventsDirectory,
    cacheDirectory,
    documentPath,
    eventsPath,
    timelineCacheDirectory,
  }
}

export async function readCinemaTimelineDocument(
  cinemaRoot: string,
  timelineID: string,
): Promise<CinemaTimelineDocument | undefined> {
  const { documentPath } = getCinemaTimelineStoragePaths(cinemaRoot, timelineID)
  const raw = await readFile(documentPath, "utf8").catch((error: unknown) => {
    if (isMissingFileError(error)) return undefined
    throw error
  })
  if (raw === undefined) return undefined
  return CinemaTimelineDocumentSchema.parse(JSON.parse(raw))
}

export async function writeCinemaTimelineDocument(
  cinemaRoot: string,
  timeline: CinemaTimelineDocument,
) {
  const parsed = CinemaTimelineDocumentSchema.parse(timeline)
  const { timelinesDirectory, documentPath } = getCinemaTimelineStoragePaths(cinemaRoot, parsed.id)
  await mkdir(timelinesDirectory, { recursive: true })

  const temporaryPath = path.join(
    timelinesDirectory,
    `.${path.basename(documentPath)}.${randomUUID()}.tmp`,
  )
  assertPathInside(timelinesDirectory, temporaryPath)

  const handle = await open(temporaryPath, "wx")
  try {
    await handle.writeFile(`${JSON.stringify(parsed, null, 2)}\n`, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }

  try {
    await rename(temporaryPath, documentPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function listCinemaTimelineDocuments(cinemaRoot: string) {
  const timelinesDirectory = path.join(cinemaRoot, "timelines")
  const entries = await readdir(timelinesDirectory, { withFileTypes: true }).catch((error: unknown) => {
    if (isMissingFileError(error)) return []
    throw error
  })

  const timelines: CinemaTimelineDocument[] = []
  for (const entry of entries) {
    const match = entry.isFile() ? /^timeline_([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.json$/.exec(entry.name) : null
    if (!match?.[1]) continue
    const timeline = await readCinemaTimelineDocument(cinemaRoot, match[1])
    if (timeline) timelines.push(timeline)
  }

  return timelines.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function deleteCinemaTimelineStorage(cinemaRoot: string, timelineID: string) {
  const paths = getCinemaTimelineStoragePaths(cinemaRoot, timelineID)
  await Promise.all([
    rm(paths.documentPath, { force: true }),
    rm(paths.eventsPath, { force: true }),
    rm(paths.timelineCacheDirectory, { recursive: true, force: true }),
  ])
}

export async function appendCinemaTimelineEvent(cinemaRoot: string, event: CinemaTimelineEvent) {
  const parsed = CinemaTimelineEventSchema.parse(event)
  const { eventsDirectory, eventsPath } = getCinemaTimelineStoragePaths(cinemaRoot, parsed.timelineID)
  await mkdir(eventsDirectory, { recursive: true })
  const handle = await open(eventsPath, "a")
  try {
    await handle.writeFile(`${JSON.stringify(parsed)}\n`, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function readCinemaTimelineEvents(
  cinemaRoot: string,
  timelineID: string,
): Promise<CinemaTimelineEvent[]> {
  const { eventsPath } = getCinemaTimelineStoragePaths(cinemaRoot, timelineID)
  const raw = await readFile(eventsPath, "utf8").catch((error: unknown) => {
    if (isMissingFileError(error)) return ""
    throw error
  })
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => CinemaTimelineEventSchema.parse(JSON.parse(line)))
}
