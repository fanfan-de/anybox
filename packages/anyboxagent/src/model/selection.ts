import * as Config from "#config/config.ts"
import * as ModelRegistry from "#model/registry.ts"
import type { Model, ModelReference, PublicModel } from "#model/types.ts"

export function parseModelReference(value: string | null | undefined): ModelReference | null {
  const [providerID, ...rest] = value?.split("/") ?? []
  const modelID = rest.join("/")
  if (!providerID || !modelID) return null
  return { providerID, modelID }
}

export function formatModelReference(reference: ModelReference) {
  return `${reference.providerID}/${reference.modelID}`
}

export async function resolveSelectableModel(
  value: string,
  configID = Config.GLOBAL_CONFIG_ID,
): Promise<Model> {
  const reference = parseModelReference(value)
  if (!reference) {
    throw new Error(`Model '${value}' must use the format provider/model`)
  }
  return ModelRegistry.getAISDKModel(reference.providerID, reference.modelID, configID)
}

export async function resolveImageSelectableModel(
  value: string,
  configID = Config.GLOBAL_CONFIG_ID,
): Promise<Model> {
  const model = await resolveSelectableModel(value, configID)
  if (!model.capabilities.output.image) {
    throw new Error(`Model '${value}' does not support image output`)
  }
  return model
}

export function findModelByReference(items: PublicModel[], value: string | undefined) {
  const reference = parseModelReference(value)
  if (!reference) return null
  return items.find((model) => model.providerID === reference.providerID && model.id === reference.modelID) ?? null
}

