import * as CinemaProviderRuntime from "#cinema/provider-runtime.ts"
import * as Config from "#config/config.ts"
import * as Provider from "#provider/provider.ts"
import * as Log from "#util/log.ts"
import type {
  Model,
  ModelCatalogItem,
  ModelCatalogRuntimeKind,
  ModelModalities,
  PublicModel,
} from "#model/types.ts"

const log = Log.create({ service: "model-registry" })

export type ModelCapabilityFilter = {
  runtimeKind?: ModelCatalogRuntimeKind
  selectable?: boolean
  input?: keyof ModelModalities
  output?: keyof ModelModalities
  taskMode?: string
}

const EMPTY_MODALITIES: ModelModalities = {
  text: false,
  audio: false,
  image: false,
  video: false,
  pdf: false,
}

function referenceValue(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

function sortCatalogItems(items: ModelCatalogItem[]) {
  return items.toSorted(
    (left, right) =>
      left.providerName.localeCompare(right.providerName) ||
      left.name.localeCompare(right.name) ||
      left.registryID.localeCompare(right.registryID),
  )
}

function hasCapability(item: ModelCatalogItem, filter: ModelCapabilityFilter) {
  if (filter.runtimeKind && item.runtimeKind !== filter.runtimeKind) return false
  if (filter.selectable !== undefined && item.selectable !== filter.selectable) return false
  if (filter.input && !item.capabilities.input[filter.input]) return false
  if (filter.output && !item.capabilities.output[filter.output]) return false
  if (filter.taskMode && !item.capabilities.taskModes.includes(filter.taskMode)) return false
  return true
}

export function filterModelCatalogItems(items: ModelCatalogItem[], filter: ModelCapabilityFilter = {}) {
  return items.filter((item) => hasCapability(item, filter))
}

export async function listAISDKModels(configID = Config.GLOBAL_CONFIG_ID): Promise<PublicModel[]> {
  return Provider.listProviderSourceModels(configID)
}

export async function getAISDKModel(
  providerID: string,
  modelID: string,
  configID = Config.GLOBAL_CONFIG_ID,
): Promise<Model> {
  return Provider.getProviderSourceModel(providerID, modelID, configID)
}

export function isModelNotFoundError(error: unknown) {
  return Provider.ModelNotFoundError.isInstance(error)
}

function aiSDKCatalogItem(model: PublicModel): ModelCatalogItem {
  return {
    registryID: referenceValue(model.providerID, model.id),
    providerID: model.providerID,
    modelID: model.id,
    name: model.name,
    providerName: model.providerName?.trim() || model.providerID,
    ...(model.family ? { family: model.family } : {}),
    runtimeKind: "ai-sdk",
    selectable: model.available,
    available: model.available,
    capabilities: {
      temperature: model.capabilities.temperature,
      reasoning: model.capabilities.reasoning,
      attachment: model.capabilities.attachment,
      toolcall: model.capabilities.toolcall,
      input: model.capabilities.input,
      output: model.capabilities.output,
      taskModes: [],
    },
    status: model.status,
    source: "provider",
  }
}

export async function listAISDKModelCatalog(
  configID = Config.GLOBAL_CONFIG_ID,
  filter: ModelCapabilityFilter = {},
) {
  return filterModelCatalogItems((await Provider.listProviderCatalogSourceModels(configID)).map(aiSDKCatalogItem), filter)
}

function modalityListToFlags(values: string[] | undefined): ModelModalities {
  const result = { ...EMPTY_MODALITIES }
  for (const value of values ?? []) {
    if (value === "text" || value === "audio" || value === "image" || value === "video" || value === "pdf") {
      result[value] = true
    }
  }
  return result
}

function inferTaskInputModalities(modes: string[]) {
  const result = { ...EMPTY_MODALITIES }
  if (modes.some((mode) => mode.startsWith("text-to-"))) result.text = true
  if (modes.some((mode) => mode.startsWith("image-to-") || mode === "reference-to-video" || mode === "frames-to-video")) {
    result.image = true
  }
  if (modes.some((mode) => mode.startsWith("video-to-") || mode === "edit" || mode === "extend" || mode === "motion-control")) {
    result.video = true
  }
  return result
}

function inferTaskOutputModalities(modes: string[], supportsAudio: boolean | undefined) {
  const result = { ...EMPTY_MODALITIES }
  if (modes.some((mode) => mode.endsWith("-image") || mode === "image-edit")) result.image = true
  if (modes.some((mode) => mode.endsWith("-video") || mode === "edit" || mode === "extend" || mode === "motion-control")) {
    result.video = true
  }
  if (supportsAudio) result.audio = true
  return result
}

export async function listCinemaTaskModelCatalog(filter: ModelCapabilityFilter = {}) {
  let providers: Awaited<ReturnType<typeof CinemaProviderRuntime.listCinemaVideoProviders>>
  try {
    providers = await CinemaProviderRuntime.listCinemaVideoProviders()
  } catch (error) {
    log.warn("cinema-task-model-source-failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }

  const items = providers.flatMap<ModelCatalogItem>((provider) => {
    const providerAvailable = provider.auth.connected && provider.runtime?.adapterAvailable === true
    return provider.manifest.models.map((model) => {
      const modes = [...model.modes]
      const input = model.modalities?.input?.length
        ? modalityListToFlags(model.modalities.input)
        : inferTaskInputModalities(modes)
      const output = model.modalities?.output?.length
        ? modalityListToFlags(model.modalities.output)
        : inferTaskOutputModalities(modes, model.supportsAudio)

      return {
        registryID: `cinema-task:${referenceValue(provider.manifest.id, model.id)}`,
        providerID: provider.manifest.id,
        modelID: model.id,
        name: model.label,
        providerName: provider.manifest.name,
        ...(model.family ? { family: model.family } : {}),
        runtimeKind: "cinema-task",
        selectable: false,
        available: providerAvailable,
        capabilities: {
          input,
          output,
          taskModes: modes,
        },
        status: "active",
        source: "cinema",
        metadata: {
          modes,
          ...(model.durations.length > 0 ? { durations: model.durations } : {}),
          ...(model.aspectRatios.length > 0 ? { aspectRatios: model.aspectRatios } : {}),
          ...(model.resolutions.length > 0 ? { resolutions: model.resolutions } : {}),
          ...(model.maxDurationSeconds ? { maxDurationSeconds: model.maxDurationSeconds } : {}),
          ...(model.endpointType ? { endpointType: model.endpointType } : {}),
          ...(provider.runtime?.adapterAvailable !== undefined
            ? { adapterAvailable: provider.runtime.adapterAvailable }
            : {}),
          requiresCredential: provider.auth.requiresCredential,
          connected: provider.auth.connected,
        },
      }
    })
  })

  return filterModelCatalogItems(items, filter)
}

export async function listModelCatalog(
  configID = Config.GLOBAL_CONFIG_ID,
  filter: ModelCapabilityFilter = {},
) {
  const [aiModels, taskModels] = await Promise.all([
    listAISDKModelCatalog(configID),
    listCinemaTaskModelCatalog(),
  ])
  return sortCatalogItems(filterModelCatalogItems([...aiModels, ...taskModels], filter))
}

export async function getModelCatalogItem(
  registryID: string,
  configID = Config.GLOBAL_CONFIG_ID,
) {
  return (await listModelCatalog(configID)).find((item) => item.registryID === registryID) ?? null
}
