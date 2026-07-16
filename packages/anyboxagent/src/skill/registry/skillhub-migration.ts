import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import * as Auth from "#auth/auth.ts"
import * as Global from "#global/global.ts"

const LEGACY_AUTH_PROVIDER_ID = "skill-registry:skillhub"

type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function removeSkillHubEntry(value: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    const next = value.filter((entry) => {
      if (!isJsonObject(entry)) return true
      return ![entry.id, entry.provider, entry.providerID].some((field) => field === "skillhub")
    })
    return { value: next, changed: next.length !== value.length }
  }
  if (!isJsonObject(value)) return { value, changed: false }

  let changed = false
  const next: JsonObject = { ...value }
  if (Object.hasOwn(next, "skillhub")) {
    delete next.skillhub
    changed = true
  }
  if (Object.hasOwn(next, "providers")) {
    const nested = removeSkillHubEntry(next.providers)
    if (nested.changed) {
      next.providers = nested.value
      changed = true
    }
  }
  return { value: next, changed }
}

async function clearLegacyPreferenceFile(dataRoot: string) {
  const file = join(dataRoot, "skill-registry", "providers.json")
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file, "utf8"))
  } catch {
    return
  }
  const migrated = removeSkillHubEntry(parsed)
  if (!migrated.changed) return

  const temporary = `${file}.${randomUUID()}.tmp`
  await mkdir(dirname(file), { recursive: true })
  try {
    await writeFile(temporary, `${JSON.stringify(migrated.value, null, 2)}\n`, "utf8")
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

export interface ClearLegacySkillHubStateOptions {
  dataRoot?: string
  cacheRoot?: string
  clearAuthProvider?: (providerID: string) => Promise<unknown>
}

/**
 * Removes state created by the retired skillhub.club integration. This is
 * deliberately best-effort: stale state must never prevent the official
 * Tencent provider from being available.
 */
export async function clearLegacySkillHubState(options: ClearLegacySkillHubStateOptions = {}) {
  const dataRoot = options.dataRoot ?? Global.Path.data
  const cacheRoot = options.cacheRoot ?? Global.Path.cache
  const clearAuthProvider = options.clearAuthProvider ?? Auth.clearProvider
  await Promise.allSettled([
    clearAuthProvider(LEGACY_AUTH_PROVIDER_ID),
    clearLegacyPreferenceFile(dataRoot),
    rm(join(cacheRoot, "skill-registry", "skillhub-summaries"), { recursive: true, force: true }),
  ])
}

let defaultCleanup: Promise<void> | undefined

export function clearLegacySkillHubStateOnce() {
  defaultCleanup ??= clearLegacySkillHubState()
  return defaultCleanup
}
