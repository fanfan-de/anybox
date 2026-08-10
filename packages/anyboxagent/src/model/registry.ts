import * as Config from "#config/config.ts"
import * as Provider from "#provider/provider.ts"
import type {
  Model,
  ModelCatalogItem,
  ModelCatalogRuntimeKind,
  ModelModalities,
  PublicModel,
} from "#model/types.ts"

export type ModelCapabilityFilter = {
  runtimeKind?: ModelCatalogRuntimeKind
  selectable?: boolean
  input?: keyof ModelModalities
  output?: keyof ModelModalities
  taskMode?: string
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

export async function listModelCatalog(
  configID = Config.GLOBAL_CONFIG_ID,
  filter: ModelCapabilityFilter = {},
) {
  const aiModels = await listAISDKModelCatalog(configID)
  return sortCatalogItems(filterModelCatalogItems(aiModels, filter))
}

export async function getModelCatalogItem(
  registryID: string,
  configID = Config.GLOBAL_CONFIG_ID,
) {
  return (await listModelCatalog(configID)).find((item) => item.registryID === registryID) ?? null
}
