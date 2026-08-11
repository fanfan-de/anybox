import { afterEach, describe, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ApiError } from "#server/error.ts"
import * as Global from "#global/global.ts"
import { CinemaProjectEventSchema } from "../src/contracts/cinema.ts"
import {
  initializeCinemaProject,
  listRecentProjects,
  openProjectRoot,
  removeRecentProject,
  resetProjectsForTest,
  runProjectMigration,
} from "#project/project.ts"
import { setProjectMigrationWriteFailureForTest } from "../src/migrations/project-v1.ts"

const roots: string[] = []
const restores: Array<() => void> = []

async function temporaryDirectory(prefix: string) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), prefix)))
  roots.push(root)
  return root
}

async function isolatedRuntime() {
  resetProjectsForTest()
  const data = await temporaryDirectory("cinema-runtime-data-")
  Global.configureRuntimePaths({ data, cache: path.join(data, "cache"), log: path.join(data, "log") })
  return data
}

async function json(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>
}

function apiError(error: unknown) {
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

afterEach(async () => {
  while (restores.length) restores.pop()?.()
  resetProjectsForTest()
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true })
})

describe("Cinema Runtime project ownership", () => {
  test("initializes a self-identifying project and removing it from recents never deletes files", async () => {
    const data = await isolatedRuntime()
    const root = await temporaryDirectory("cinema-project-")
    const project = await initializeCinemaProject(root)

    expect(project.id).toMatch(/^cin_[0-9a-f-]{36}$/)
    expect((await json(path.join(root, ".anybox-cinema", "project.json"))).id).toBe(project.id)
    expect(await stat(path.join(root, ".anybox-cinema", "tasks"))).toMatchObject({})
    expect((await listRecentProjects()).map((item) => item.id)).toEqual([project.id])
    expect((await json(path.join(data, "state", "projects.json"))).projects).toBeArray()

    expect(await removeRecentProject(project.id)).toEqual({ projectID: project.id, removed: true })
    expect(await stat(path.join(root, ".anybox-cinema", "project.json"))).toBeDefined()
    expect(await listRecentProjects()).toEqual([])
  })

  test("recognizes a moved directory when the old location no longer exists", async () => {
    await isolatedRuntime()
    const parent = await temporaryDirectory("cinema-move-")
    const original = path.join(parent, "original")
    const moved = path.join(parent, "moved")
    await mkdir(original)
    const first = await initializeCinemaProject(original)
    await rename(original, moved)

    const reopened = await openProjectRoot(moved)
    expect(reopened.id).toBe(first.id)
    expect(reopened.worktree).toBe(await realpath(moved))
    expect((await listRecentProjects())[0]?.worktree).toBe(await realpath(moved))
  })

  test("blocks duplicate project ids and clones the selected directory through the explicit migration", async () => {
    await isolatedRuntime()
    const firstRoot = await temporaryDirectory("cinema-conflict-a-")
    const secondRoot = await temporaryDirectory("cinema-conflict-b-")
    const first = await initializeCinemaProject(firstRoot)
    await cp(path.join(firstRoot, ".anybox-cinema"), path.join(secondRoot, ".anybox-cinema"), { recursive: true })

    let conflict: ApiError | undefined
    try {
      await openProjectRoot(secondRoot)
    } catch (error) {
      conflict = apiError(error)
    }
    expect(conflict?.code).toBe("PROJECT_ID_CONFLICT")
    const cloneProjectID = (conflict?.data as { cloneProjectID: string }).cloneProjectID
    expect(cloneProjectID).toMatch(/^cin_/)

    const cloned = await runProjectMigration(cloneProjectID)
    expect(cloned.project.id).toBe(cloneProjectID)
    expect((await json(path.join(secondRoot, ".anybox-cinema", "project.json"))).id).toBe(cloneProjectID)
    expect((await json(path.join(firstRoot, ".anybox-cinema", "project.json"))).id).toBe(first.id)
    expect(cloned.migration.state).toBe("completed")
  })

  test("backs up and atomically rewrites old project ids while preserving JSONL history and marking personal assets", async () => {
    await isolatedRuntime()
    const root = await temporaryDirectory("cinema-migrate-")
    const cinema = path.join(root, ".anybox-cinema")
    await mkdir(path.join(cinema, "tasks"), { recursive: true })
    await mkdir(path.join(cinema, "timelines"), { recursive: true })
    await mkdir(path.join(root, "assets"), { recursive: true })
    await writeFile(path.join(cinema, "project.json"), JSON.stringify({
      schemaVersion: 1,
      runtimeVersion: 0,
      projectType: "anybox-for-cinema",
      id: "legacy-project",
      name: "Legacy",
    }))
    await writeFile(path.join(cinema, "canvas.json"), JSON.stringify({
      schemaVersion: 1,
      projectID: "agent-project-id",
      nodes: [{ id: "image", data: { assetRef: { scope: { type: "personal" }, assetID: "old-global-image" } } }],
    }))
    await writeFile(path.join(cinema, "timelines", "main.json"), JSON.stringify({ projectID: "agent-project-id" }))
    await writeFile(path.join(cinema, "tasks", "task.json"), JSON.stringify({ projectId: "agent-project-id" }))
    await writeFile(path.join(root, "assets", "record.json"), JSON.stringify({ projectID: "agent-project-id" }))
    const historical = `${JSON.stringify({
      time: "2026-07-10T00:00:00.000Z",
      type: "legacy.event",
      actor: "legacy-runtime",
      message: "Preserved legacy project event.",
      data: { projectID: "agent-project-id" },
    })}\n`
    await writeFile(path.join(cinema, "events.jsonl"), historical)

    let required: ApiError | undefined
    try {
      await openProjectRoot(root)
    } catch (error) {
      required = apiError(error)
    }
    expect(required?.code).toBe("PROJECT_MIGRATION_REQUIRED")
    const migrated = await runProjectMigration("legacy-project")
    expect(migrated.migration.state).toBe("completed")
    expect(migrated.migration.unresolvedAssetReferences).toContainEqual(expect.objectContaining({
      assetID: "old-global-image",
      legacyScope: "personal",
      status: "relink-required",
    }))
    for (const file of [
      path.join(cinema, "canvas.json"),
      path.join(cinema, "timelines", "main.json"),
      path.join(cinema, "tasks", "task.json"),
      path.join(root, "assets", "record.json"),
    ]) expect(await readFile(file, "utf8")).toContain("legacy-project")
    const events = await readFile(path.join(cinema, "events.jsonl"), "utf8")
    expect(events.startsWith(historical)).toBe(true)
    expect(events.match(/project\.runtime-migrated/g)).toHaveLength(1)
    const migrationEvent = JSON.parse(events.trim().split(/\r?\n/).at(-1)!)
    expect(CinemaProjectEventSchema.parse(migrationEvent)).toEqual(migrationEvent)
    expect(migrationEvent.message).toContain("Migrated Cinema project metadata")
    expect(migrationEvent.data).toMatchObject({
      projectID: "legacy-project",
      fromProjectIDs: expect.arrayContaining(["agent-project-id"]),
    })
    const marker = await json(path.join(cinema, "migrations", "runtime-v1.json"))
    const backup = String(marker.backupDirectory)
    expect((await json(path.join(backup, ".anybox-cinema", "canvas.json"))).projectID).toBe("agent-project-id")

    const legacyMappingEvent = {
      time: migrationEvent.time,
      type: migrationEvent.type,
      actor: migrationEvent.actor,
      ...migrationEvent.data,
    }
    await writeFile(path.join(cinema, "events.jsonl"), `${historical}${JSON.stringify(legacyMappingEvent)}\n`)
    const replay = await runProjectMigration("legacy-project")
    expect(replay.migration.state).toBe("completed")
    const repairedEvents = await readFile(path.join(cinema, "events.jsonl"), "utf8")
    expect(repairedEvents.match(/project\.runtime-migrated/g)).toHaveLength(1)
    for (const line of repairedEvents.trim().split(/\r?\n/)) {
      expect(CinemaProjectEventSchema.safeParse(JSON.parse(line)).success).toBe(true)
    }
  })

  test("rolls every changed file back when a migration write fails", async () => {
    await isolatedRuntime()
    const root = await temporaryDirectory("cinema-rollback-")
    const cinema = path.join(root, ".anybox-cinema")
    await mkdir(cinema, { recursive: true })
    const projectBefore = JSON.stringify({ schemaVersion: 1, runtimeVersion: 0, id: "rollback-project", name: "Rollback" })
    const canvasBefore = JSON.stringify({ schemaVersion: 1, projectID: "old-project", nodes: [] })
    await writeFile(path.join(cinema, "project.json"), projectBefore)
    await writeFile(path.join(cinema, "canvas.json"), canvasBefore)
    await writeFile(path.join(cinema, "events.jsonl"), "")
    try { await openProjectRoot(root) } catch { /* expected preflight */ }
    restores.push(setProjectMigrationWriteFailureForTest(1))

    await expect(runProjectMigration("rollback-project")).rejects.toMatchObject({ code: "PROJECT_MIGRATION_FAILED" })
    expect(await readFile(path.join(cinema, "project.json"), "utf8")).toBe(projectBefore)
    expect(await readFile(path.join(cinema, "canvas.json"), "utf8")).toBe(canvasBefore)
    expect((await json(path.join(cinema, "migrations", "runtime-v1.json"))).status).toBe("rolled_back")
  })

  test("blocks corrupt JSON without modifying the project", async () => {
    await isolatedRuntime()
    const root = await temporaryDirectory("cinema-corrupt-")
    const cinema = path.join(root, ".anybox-cinema")
    await mkdir(cinema, { recursive: true })
    await writeFile(path.join(cinema, "project.json"), JSON.stringify({ schemaVersion: 1, runtimeVersion: 0, id: "corrupt-project" }))
    await writeFile(path.join(cinema, "canvas.json"), "{broken")

    let error: ApiError | undefined
    try { await openProjectRoot(root) } catch (caught) { error = apiError(caught) }
    expect(error?.code).toBe("PROJECT_MIGRATION_REQUIRED")
    await expect(runProjectMigration("corrupt-project")).rejects.toMatchObject({ code: "PROJECT_MIGRATION_REQUIRED" })
    expect(await readFile(path.join(cinema, "canvas.json"), "utf8")).toBe("{broken")
    expect(await readdir(path.join(cinema, "backups")).catch(() => [])).toEqual([])
  })
})
