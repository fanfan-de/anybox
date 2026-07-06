import * as Config from "#config/config.ts"
import * as ModelRegistry from "#model/registry.ts"
import type { PublicModel } from "#model/types.ts"
import * as Provider from "#provider/provider.ts"
import { getProcessEnvValue } from "#env/compat.ts"

const MODEL_LIST_CACHE_TTL_MS = 30_000
const DEFAULT_MODEL_LIST_TIMEOUT_MS = 2_500

interface ModelListCacheEntry {
  items: PublicModel[]
  pending?: Promise<PublicModel[]>
  updatedAt: number
}

const modelListCache = new Map<string, ModelListCacheEntry>()
const modelListCacheGeneration = new Map<string, number>()

function getCacheGeneration(projectID: string) {
  return modelListCacheGeneration.get(projectID) ?? 0
}

function bumpCacheGeneration(projectID: string) {
  modelListCacheGeneration.set(projectID, getCacheGeneration(projectID) + 1)
}

function getModelListTimeoutMS() {
  const parsed = Number(getProcessEnvValue("ANYBOX_MODEL_LIST_TIMEOUT_MS"))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MODEL_LIST_TIMEOUT_MS
}

function withTimeout<T>(promise: Promise<T>, timeoutMS: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Model list request exceeded ${timeoutMS}ms`)), timeoutMS)
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout)
  })
}

function startModelListLoad(projectID: string) {
  const existing = modelListCache.get(projectID)
  const generation = getCacheGeneration(projectID)
  const pending = ModelRegistry.listAISDKModels(projectID)
    .then((items) => {
      if (getCacheGeneration(projectID) === generation) {
        modelListCache.set(projectID, {
          items,
          updatedAt: Date.now(),
        })
      }
      return items
    })
    .catch((error) => {
      if (getCacheGeneration(projectID) === generation) {
        if (existing && existing.updatedAt > 0) {
          modelListCache.set(projectID, {
            items: existing.items,
            updatedAt: existing.updatedAt,
          })
        } else {
          modelListCache.delete(projectID)
        }
      }
      throw error
    })

  modelListCache.set(projectID, {
    items: existing?.items ?? [],
    pending,
    updatedAt: existing?.updatedAt ?? 0,
  })

  return pending
}

export function clearProjectModelListCache(projectID?: string) {
  if (projectID) {
    bumpCacheGeneration(projectID)
    modelListCache.delete(projectID)
    return
  }

  for (const cacheProjectID of modelListCache.keys()) {
    bumpCacheGeneration(cacheProjectID)
  }
  modelListCache.clear()
}

export async function listProjectModelsWithFallback(projectID: string) {
  const existing = modelListCache.get(projectID)
  const now = Date.now()

  if (existing && existing.updatedAt > 0 && now - existing.updatedAt < MODEL_LIST_CACHE_TTL_MS) {
    return existing.items
  }

  const pending = existing?.pending ?? startModelListLoad(projectID)

  try {
    return await withTimeout(pending, getModelListTimeoutMS())
  } catch {
    if (existing && existing.updatedAt > 0) {
      return existing.items
    }

    return []
  }
}

export function findModelByReference(items: PublicModel[], value: string | undefined) {
  const [providerID, ...rest] = value?.split("/") ?? []
  const modelID = rest.join("/")
  if (!providerID || !modelID) return null

  return items.find((model) => model.providerID === providerID && model.id === modelID) ?? null
}

function resolveInheritedModelReference(
  items: PublicModel[],
  projectValue: string | undefined,
  globalValue: string | undefined,
) {
  return projectValue ?? (findModelByReference(items, globalValue) ? globalValue : undefined)
}

export async function resolveProjectModelSelectionWithGlobalFallback(
  projectID: string,
  items: PublicModel[],
) {
  const projectSelection = await Provider.getSelection(projectID)
  const globalSelection =
    projectID === Config.GLOBAL_CONFIG_ID
      ? undefined
      : await Provider.getSelection(Config.GLOBAL_CONFIG_ID).catch(() => undefined)

  return {
    model: resolveInheritedModelReference(items, projectSelection.model, globalSelection?.model),
    small_model: resolveInheritedModelReference(items, projectSelection.small_model, globalSelection?.small_model),
    image_model: resolveInheritedModelReference(items, projectSelection.image_model, globalSelection?.image_model),
    reasoning_effort: projectSelection.reasoning_effort ?? globalSelection?.reasoning_effort,
  }
}

export async function resolveEffectiveModelWithFallback(
  projectID: string,
  items: PublicModel[],
  preferredModel?: string,
) {
  const preferred = findModelByReference(items, preferredModel)
  if (preferred) return preferred

  const projectSelection = await Provider.getSelection(projectID).catch(() => undefined)
  const configuredDefault = findModelByReference(items, projectSelection?.model)
    ?? findModelByReference(items, projectSelection?.image_model)
  if (configuredDefault) return configuredDefault

  if (projectID !== Config.GLOBAL_CONFIG_ID) {
    const globalSelection = await Provider.getSelection(Config.GLOBAL_CONFIG_ID).catch(() => undefined)
    const globalDefault = findModelByReference(items, globalSelection?.model)
      ?? findModelByReference(items, globalSelection?.image_model)
    if (globalDefault) return globalDefault
  }

  return items.find((model) => model.available) ?? null
}
