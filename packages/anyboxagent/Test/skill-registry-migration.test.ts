import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearLegacySkillHubState } from "#skill/registry/skillhub-migration.ts"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Tencent SkillHub legacy state migration", () => {
  test("removes only retired skillhub.club state", async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-skillhub-migration-"))
    roots.push(root)
    const dataRoot = join(root, "data")
    const cacheRoot = join(root, "cache")
    const preferencesFile = join(dataRoot, "skill-registry", "providers.json")
    const summaryCache = join(cacheRoot, "skill-registry", "skillhub-summaries")
    await mkdir(summaryCache, { recursive: true })
    await mkdir(join(dataRoot, "skill-registry"), { recursive: true })
    await writeFile(preferencesFile, JSON.stringify({
      version: 1,
      providers: {
        clawhub: { enabled: true },
        skillhub: { enabled: true, configured: true },
      },
    }))
    await writeFile(join(summaryCache, "stale.json"), "{}")

    const cleared: string[] = []
    await clearLegacySkillHubState({
      dataRoot,
      cacheRoot,
      clearAuthProvider: async (providerID) => cleared.push(providerID),
    })

    expect(cleared).toEqual(["skill-registry:skillhub"])
    expect(JSON.parse(await readFile(preferencesFile, "utf8"))).toEqual({
      version: 1,
      providers: { clawhub: { enabled: true } },
    })
    expect(await stat(summaryCache).catch(() => undefined)).toBeUndefined()
  })
})
