import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import "./sqlite.cleanup.ts"
import * as Config from "#config/config.ts"
import * as Sqlite from "#database/Sqlite.ts"
import { ensureLegacySessionCleanup } from "#database/legacy-session-cleanup.ts"

async function removeWithRetry(target: string, attempts = 10) {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      Bun.gc(true)
      await rm(target, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      await Bun.sleep(50 * (attempt + 1))
    }
  }
  throw lastError
}

test("removes retired Cinema fields before strict config reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-legacy-config-cleanup-"))
  const databaseFile = join(root, "legacy.db")
  const projectID = "legacy-cinema-config"

  try {
    Sqlite.setDatabaseFile(databaseFile)
    Sqlite.db.run(`
      CREATE TABLE "project_configs" (
        "projectID" TEXT PRIMARY KEY,
        "config" TEXT
      )
    `)
    Sqlite.db.prepare(`
      INSERT INTO "project_configs" ("projectID", "config")
      VALUES (?, ?)
    `).run(projectID, JSON.stringify({
      username: "kept-user",
      permission_mode: "full_access",
      selected_plugins: ["kept-plugin"],
      cinema_video_providers: {
        "legacy-provider": { apiKey: "retired-secret" },
      },
      selected_cinema_text_generation_prompt_preset: "legacy-preset",
    }))

    const cleanupOptions = {
      artifactSessionsRoot: join(root, "artifacts"),
      promptRoot: join(root, "prompts"),
    }
    ensureLegacySessionCleanup(cleanupOptions)

    expect(await Config.get(projectID)).toEqual({
      username: "kept-user",
      permission_mode: "full_access",
      selected_plugins: ["kept-plugin"],
    })

    const readStoredConfig = () => {
      const row = Sqlite.db
        .prepare(`SELECT "config" FROM "project_configs" WHERE "projectID" = ?`)
        .get(projectID) as { config: string }
      return JSON.parse(row.config) as Record<string, unknown>
    }

    const cleaned = readStoredConfig()
    expect(cleaned).toEqual({
      username: "kept-user",
      permission_mode: "full_access",
      selected_plugins: ["kept-plugin"],
    })

    ensureLegacySessionCleanup(cleanupOptions)
    expect(readStoredConfig()).toEqual(cleaned)
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})
