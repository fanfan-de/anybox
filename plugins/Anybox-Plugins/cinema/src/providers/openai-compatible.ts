import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { ApiError } from "#server/error.ts"
import { readProviderApiKey } from "#auth/provider-auth.ts"
import { getSettings } from "#config/config.ts"

export type PublicModel = {
  id: string
  providerID: string
  providerName?: string
  name: string
  available: boolean
  capabilities: {
    input: { text: boolean; image: boolean; audio: boolean; video: boolean; pdf: boolean }
    output: { text: boolean; image: boolean; audio: boolean; video: boolean; pdf: boolean }
  }
}

class ModelNotFoundError extends Error {}

function publicModel(id: string, label: string | undefined, image: boolean, available: boolean): PublicModel {
  return {
    id,
    providerID: "openai-compatible",
    providerName: "OpenAI Compatible",
    name: label || id,
    available,
    capabilities: {
      input: { text: true, image, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
    },
  }
}

export async function listProjectModelsWithFallback(_projectID: string) {
  const settings = await getSettings()
  const connected = Boolean(await readProviderApiKey("openai-compatible"))
  return settings.openAICompatible.models.map((model) => publicModel(model.id, model.label, Boolean(model.supportsImageInput), connected))
}

export async function resolveProjectModelSelectionWithGlobalFallback(_projectID: string, models: PublicModel[]) {
  const configured = (await getSettings()).openAICompatible.defaultModel
  const selected = configured && models.some((model) => model.id === configured) ? configured : null
  return { model: selected ? `openai-compatible/${selected}` : null }
}

export async function resolveEffectiveModelWithFallback(_projectID: string, models: PublicModel[], selected: string | null) {
  const modelID = selected?.split("/").slice(1).join("/")
  return models.find((model) => model.id === modelID && model.available) ?? models.find((model) => model.available) ?? null
}

export async function getAISDKModel(providerID: string, modelID: string, _projectID?: string) {
  if (providerID !== "openai-compatible") throw new ModelNotFoundError(`Unknown provider '${providerID}'.`)
  const model = (await listProjectModelsWithFallback("")).find((item) => item.id === modelID)
  if (!model) throw new ModelNotFoundError(`Unknown model '${modelID}'.`)
  return model
}

export async function getLanguage(model: PublicModel, _projectID?: string) {
  const settings = await getSettings()
  const credential = await readProviderApiKey("openai-compatible")
  if (!credential) throw new ApiError(400, "CINEMA_PROVIDER_NOT_CONNECTED", "OpenAI Compatible API key is not configured.")
  const provider = createOpenAICompatible({
    name: "cinema-openai-compatible",
    baseURL: settings.openAICompatible.baseURL,
    apiKey: credential.value,
  })
  return provider.languageModel(model.id)
}

export function isModelNotFoundError(error: unknown) {
  return error instanceof ModelNotFoundError
}
