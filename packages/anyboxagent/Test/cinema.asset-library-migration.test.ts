import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CinemaAssetMigrationResultSchema,
  CinemaAssetMigrationStatusResultSchema,
} from "@anybox/shared/cinema"
import {
  getCinemaAssetMigrationStatus,
} from "#cinema/asset-library-migration.ts"
import { registerCinemaGeneratedAsset } from "#cinema/asset-library.ts"
import { createServerApp } from "#server/server.ts"

type Envelope<T> = {
  success: boolean
  data?: T
  error?: { code?: string; message?: string }
}

const cleanup: string[] = []

afterEach(async () => {
  while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true })
})

function pngBytes() {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ])
}

async function createLegacyCinemaProject() {
  const app = createServerApp()
  const root = await realpath(await mkdtemp(join(tmpdir(), "anybox-cinema-migration-")))
  cleanup.push(root)
  const response = await app.request("http://localhost/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ directory: root }),
  })
  const envelope = await response.json() as Envelope<{ id: string }>
  expect(response.status).toBe(201)
  const projectID = envelope.data!.id
  const cinemaRoot = join(root, ".anybox-cinema")
  await mkdir(join(cinemaRoot, "tasks"), { recursive: true })
  await mkdir(join(root, "assets", "imported"), { recursive: true })
  await mkdir(join(root, "generated"), { recursive: true })
  await mkdir(join(root, "renders", ".hidden"), { recursive: true })
  await writeFile(join(cinemaRoot, "project.json"), JSON.stringify({ schemaVersion: 1, name: "Legacy" }), "utf8")
  return { app, root, cinemaRoot, projectID }
}

async function responseData<T>(response: Response) {
  const envelope = await response.json() as Envelope<T>
  expect(envelope.success).toBe(true)
  return envelope.data!
}

function migrationJournalPath(cinemaRoot: string, operationID: string) {
  const digest = createHash("sha256").update(operationID).digest("hex").slice(0, 32)
  return join(cinemaRoot, "asset-ops", `migration-${digest}.json`)
}

function candidateOperationID(operationID: string, candidateID: string) {
  const digest = createHash("sha256").update(operationID).digest("hex").slice(0, 20)
  return `migration:${digest}:${candidateID.slice(-32)}`
}

describe("cinema asset library migration", () => {
  test("scans stable legacy candidates while excluding hidden and unsupported files", async () => {
    const { root, projectID } = await createLegacyCinemaProject()
    await writeFile(join(root, "assets", "imported", "reference.png"), pngBytes())
    await writeFile(join(root, "generated", "shot.png"), pngBytes())
    await writeFile(join(root, "generated", "notes.txt"), "not media", "utf8")
    await writeFile(join(root, "renders", ".hidden", "ignored.png"), pngBytes())

    const first = await getCinemaAssetMigrationStatus(projectID)
    const second = await getCinemaAssetMigrationStatus(projectID)

    expect(first).toMatchObject({
      projectID,
      phase: "required",
      readOnly: true,
      candidateCount: 2,
      unrecognizedCount: 1,
    })
    expect(first.candidates.map((candidate) => candidate.sourcePath)).toEqual([
      "assets/imported/reference.png",
      "generated/shot.png",
    ])
    expect(first.candidates.map((candidate) => candidate.id)).toEqual(
      second.candidates.map((candidate) => candidate.id),
    )
    expect(first.candidates[0]!.destinationFolderID).toBe("inbox")
    expect(first.candidates[1]!.destinationFolderID).toBe("generated-images")
  }, 20_000)

  test("explicitly migrates selected files, rewrites canvas and task refs, and replays idempotently", async () => {
    const { app, root, cinemaRoot, projectID } = await createLegacyCinemaProject()
    const importedPath = "assets/imported/reference.png"
    const generatedPath = "generated/shot.png"
    await writeFile(join(root, ...importedPath.split("/")), pngBytes())
    await writeFile(join(root, ...generatedPath.split("/")), pngBytes())
    await writeFile(join(cinemaRoot, "canvas.json"), JSON.stringify({
      schemaVersion: 1,
      revision: 0,
      canvasType: "node-canvas",
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [{
        id: "image-node",
        type: "image",
        title: "Reference",
        position: { x: 10, y: 20 },
        data: {
          rawData: {
            asset: {
              id: "legacy-import-id",
              kind: "image",
              path: importedPath,
              mimeType: "image/png",
            },
            selectedCandidateAssetID: "legacy-import-id",
          },
        },
      }],
      edges: [],
      nodeTypes: [],
    }), "utf8")
    await writeFile(join(cinemaRoot, "tasks", "task-1.json"), JSON.stringify({
      id: "task-1",
      status: "succeeded",
      outputAssets: [{
        id: "legacy-output-id",
        kind: "image",
        path: generatedPath,
        mimeType: "image/png",
      }],
    }), "utf8")

    const migrationURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/library/migration`
    const statusResponse = await app.request(migrationURL)
    expect(statusResponse.status).toBe(200)
    const status = CinemaAssetMigrationStatusResultSchema.parse(await responseData(statusResponse))
    const input = {
      operationID: "migrate-v1",
      baseRevision: 0,
      candidateIDs: status.candidates.map((candidate) => candidate.id),
    }
    const invalidResponse = await app.request(migrationURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseRevision: 0 }),
    })
    expect(invalidResponse.status).toBe(400)
    const migrate = () => app.request(migrationURL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    const firstResponse = await migrate()
    expect(firstResponse.status).toBe(200)
    const first = CinemaAssetMigrationResultSchema.parse(await responseData(firstResponse))
    const replayResponse = await migrate()
    expect(replayResponse.status).toBe(200)
    const replay = CinemaAssetMigrationResultSchema.parse(await responseData(replayResponse))

    expect(first).toMatchObject({
      projectID,
      operationID: "migrate-v1",
      phase: "completed",
      revision: 2,
    })
    expect(first.migratedAssetIDs).toHaveLength(2)
    expect(replay).toEqual(first)

    const canvas = JSON.parse(await readFile(join(cinemaRoot, "canvas.json"), "utf8"))
    const canvasAsset = canvas.nodes[0].data.rawData.asset
    expect(canvasAsset.id).toStartWith("asset_")
    expect(canvasAsset.path).toStartWith("assets/library/")
    expect(canvasAsset.assetRef).toMatchObject({
      scope: { type: "project", projectID },
      assetID: canvasAsset.id,
      snapshot: { kind: "image" },
    })
    expect(canvas.nodes[0].data.rawData.selectedCandidateAssetID).toBe(canvasAsset.id)

    const task = JSON.parse(await readFile(join(cinemaRoot, "tasks", "task-1.json"), "utf8"))
    const taskAsset = task.outputAssets[0]
    expect(taskAsset.id).toStartWith("asset_")
    expect(taskAsset.path).toStartWith("assets/library/")
    expect(taskAsset.assetRef.assetID).toBe(taskAsset.id)

    const metadata = JSON.parse(await readFile(join(cinemaRoot, "project.json"), "utf8"))
    expect(metadata.assetLibrarySchemaVersion).toBe(1)
    expect(await getCinemaAssetMigrationStatus(projectID)).toMatchObject({
      phase: "completed",
      readOnly: false,
      candidateCount: 0,
    })
  }, 20_000)

  test("resumes the original running journal when a restarted client posts a new operationID", async () => {
    const { app, root, cinemaRoot, projectID } = await createLegacyCinemaProject()
    await writeFile(join(root, "assets", "imported", "first.png"), pngBytes())
    await writeFile(join(root, "generated", "second.png"), pngBytes())
    const status = await getCinemaAssetMigrationStatus(projectID)
    expect(status.candidates).toHaveLength(2)

    const originalOperationID = "interrupted-migration"
    const firstCandidate = status.candidates[0]!
    const firstRegistration = await registerCinemaGeneratedAsset(projectID, {
      operationID: candidateOperationID(originalOperationID, firstCandidate.id),
      baseRevision: 0,
      sourcePath: firstCandidate.sourcePath,
      kind: firstCandidate.kind,
      displayName: "first",
      source: "migration",
      destinationFolderID: firstCandidate.destinationFolderID,
    })
    const firstAsset = firstRegistration.asset
    const timestamp = new Date().toISOString()
    const journal = {
      schemaVersion: 1,
      projectID,
      operationID: originalOperationID,
      baseRevision: 0,
      phase: "running",
      candidates: status.candidates,
      migrated: [{
        candidateID: firstCandidate.id,
        sourcePath: firstCandidate.sourcePath,
        path: `assets/library/${firstAsset.relativePath.replace(/\\/g, "/")}`,
        asset: firstAsset,
        assetRef: {
          scope: { type: "project", projectID },
          assetID: firstAsset.id,
          contentRevision: firstAsset.contentRevision,
          snapshot: {
            kind: firstAsset.kind,
            displayName: firstAsset.displayName,
            mimeType: firstAsset.mimeType,
            ...(firstAsset.width ? { width: firstAsset.width } : {}),
            ...(firstAsset.height ? { height: firstAsset.height } : {}),
            ...(firstAsset.durationSeconds !== undefined ? { durationSeconds: firstAsset.durationSeconds } : {}),
          },
        },
      }],
      backupFiles: [],
      commitBackupReady: false,
      startedAt: timestamp,
      updatedAt: timestamp,
    }
    const originalJournalPath = migrationJournalPath(cinemaRoot, originalOperationID)
    await mkdir(join(cinemaRoot, "asset-ops"), { recursive: true })
    await writeFile(originalJournalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8")

    const libraryURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/library`
    const resumedStatus = CinemaAssetMigrationStatusResultSchema.parse(
      await responseData(await app.request(`${libraryURL}/migration`)),
    )
    expect(resumedStatus).toMatchObject({ phase: "running", readOnly: true, candidateCount: 2 })
    const state = await responseData<{ revision: number }>(await app.request(`${libraryURL}/state`))
    expect(state.revision).toBe(1)

    const newOperationID = "new-client-operation"
    const resumeResponse = await app.request(`${libraryURL}/migration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: newOperationID,
        baseRevision: state.revision,
        candidateIDs: resumedStatus.candidates.map((candidate) => candidate.id),
      }),
    })
    expect(resumeResponse.status).toBe(200)
    const result = CinemaAssetMigrationResultSchema.parse(await responseData(resumeResponse))
    expect(result).toMatchObject({
      operationID: originalOperationID,
      phase: "completed",
      revision: 2,
    })
    expect(result.migratedAssetIDs).toHaveLength(2)
    expect(result.migratedAssetIDs.filter((assetID) => assetID === firstAsset.id)).toHaveLength(1)

    const catalog = JSON.parse(await readFile(join(cinemaRoot, "asset-library.json"), "utf8"))
    expect(catalog.assets).toHaveLength(2)
    expect(new Set(catalog.assets.map((asset: { id: string }) => asset.id)).size).toBe(2)
    const completedJournal = JSON.parse(await readFile(originalJournalPath, "utf8"))
    expect(completedJournal).toMatchObject({
      operationID: originalOperationID,
      phase: "completed",
      result: { operationID: originalOperationID },
    })
    const newJournalExists = await readFile(migrationJournalPath(cinemaRoot, newOperationID), "utf8")
      .then(() => true)
      .catch(() => false)
    expect(newJournalExists).toBe(false)
  }, 20_000)

  test("finishes a committed running journal and blocks rolling-back or recovery-required journals", async () => {
    const { app, root, cinemaRoot, projectID } = await createLegacyCinemaProject()
    await writeFile(join(root, "assets", "imported", "committed.png"), pngBytes())
    const libraryURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/library`
    const status = CinemaAssetMigrationStatusResultSchema.parse(
      await responseData(await app.request(`${libraryURL}/migration`)),
    )
    const originalOperationID = "committed-before-journal"
    const migrateResponse = await app.request(`${libraryURL}/migration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: originalOperationID,
        baseRevision: 0,
        candidateIDs: status.candidates.map((candidate) => candidate.id),
      }),
    })
    const migrated = CinemaAssetMigrationResultSchema.parse(await responseData(migrateResponse))
    const journalFile = migrationJournalPath(cinemaRoot, originalOperationID)
    const interruptedJournal = JSON.parse(await readFile(journalFile, "utf8"))
    interruptedJournal.phase = "running"
    delete interruptedJournal.result
    interruptedJournal.updatedAt = new Date(Date.now() + 1_000).toISOString()
    await writeFile(journalFile, `${JSON.stringify(interruptedJournal, null, 2)}\n`, "utf8")

    const interruptedStatus = CinemaAssetMigrationStatusResultSchema.parse(
      await responseData(await app.request(`${libraryURL}/migration`)),
    )
    expect(interruptedStatus).toMatchObject({
      phase: "running",
      readOnly: true,
      candidateCount: 1,
    })
    const stateWhileInterrupted = await responseData<{ readOnly: boolean }>(await app.request(`${libraryURL}/state`))
    expect(stateWhileInterrupted.readOnly).toBe(true)

    const finishResponse = await app.request(`${libraryURL}/migration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "new-operation-after-commit",
        baseRevision: migrated.revision,
        candidateIDs: interruptedStatus.candidates.map((candidate) => candidate.id),
      }),
    })
    expect(finishResponse.status).toBe(200)
    const finished = CinemaAssetMigrationResultSchema.parse(await responseData(finishResponse))
    expect(finished).toEqual(migrated)
    expect(JSON.parse(await readFile(journalFile, "utf8"))).toMatchObject({
      phase: "completed",
      result: migrated,
    })

    for (const phase of ["rolling-back", "recovery-required"] as const) {
      const blockedJournal = JSON.parse(await readFile(journalFile, "utf8"))
      blockedJournal.phase = phase
      blockedJournal.error = `${phase} requires recovery`
      delete blockedJournal.result
      blockedJournal.updatedAt = new Date(Date.now() + 2_000).toISOString()
      await writeFile(journalFile, `${JSON.stringify(blockedJournal, null, 2)}\n`, "utf8")

      const blockedResponse = await app.request(`${libraryURL}/migration`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operationID: `new-operation-${phase}`,
          baseRevision: migrated.revision,
          candidateIDs: [],
        }),
      })
      expect(blockedResponse.status).toBe(500)
      const blocked = await blockedResponse.json() as Envelope<never>
      expect(blocked.error?.code).toBe("CINEMA_LIBRARY_MIGRATION_RECOVERY_REQUIRED")
      expect(blocked.error?.message).toContain("requires recovery")
    }
  }, 20_000)

  test("keeps project library writes read-only until the required migration completes", async () => {
    const { app, root, projectID } = await createLegacyCinemaProject()
    await writeFile(join(root, "assets", "imported", "legacy.png"), pngBytes())
    const libraryURL = `http://localhost/api/cinema/projects/${encodeURIComponent(projectID)}/library`

    const stateBefore = await responseData<{ revision: number; readOnly: boolean }>(
      await app.request(`${libraryURL}/state`),
    )
    expect(stateBefore).toMatchObject({ revision: 0, readOnly: true })

    const folderRequest = {
      operationID: "create-after-required-migration",
      baseRevision: stateBefore.revision,
      parentFolderID: "root",
      name: "迁移后文件夹",
    }
    const blockedResponse = await app.request(`${libraryURL}/folders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(folderRequest),
    })
    expect(blockedResponse.status).toBe(409)
    const blocked = await blockedResponse.json() as Envelope<never>
    expect(blocked.success).toBe(false)
    expect(blocked.error?.code).toBe("CINEMA_LIBRARY_MIGRATION_REQUIRED")

    const migrationStatus = CinemaAssetMigrationStatusResultSchema.parse(
      await responseData(await app.request(`${libraryURL}/migration`)),
    )
    const migrationResponse = await app.request(`${libraryURL}/migration`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationID: "complete-required-migration",
        baseRevision: stateBefore.revision,
        candidateIDs: migrationStatus.candidates.map((candidate) => candidate.id),
      }),
    })
    expect(migrationResponse.status).toBe(200)
    const migration = CinemaAssetMigrationResultSchema.parse(await responseData(migrationResponse))

    const stateAfter = await responseData<{ revision: number; readOnly: boolean }>(
      await app.request(`${libraryURL}/state`),
    )
    expect(stateAfter).toMatchObject({ revision: migration.revision, readOnly: false })

    const allowedResponse = await app.request(`${libraryURL}/folders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...folderRequest, baseRevision: migration.revision }),
    })
    expect(allowedResponse.status).toBe(201)
    const allowed = await responseData<{ revision: number; folder: { name: string } }>(allowedResponse)
    expect(allowed).toMatchObject({
      revision: migration.revision + 1,
      folder: { name: "迁移后文件夹" },
    })
  }, 20_000)
})
