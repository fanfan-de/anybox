import path from "node:path"
import * as Global from "#global/global.ts"
import { atomicWriteJson, readJsonFile } from "./atomic.ts"

export const GLOBAL_CONFIG_ID = "cinema"

export type ProviderSettings = {
  baseURL?: string
  userID?: string
}

export type OpenAICompatibleModelSettings = {
  id: string
  label?: string
  supportsImageInput?: boolean
}

export type CinemaSettings = {
  schemaVersion: 1
  providers: Record<string, ProviderSettings>
  openAICompatible: {
    baseURL: string
    defaultModel?: string
    models: OpenAICompatibleModelSettings[]
  }
  prompts: {
    textGeneration?: string
  }
}

const DEFAULT_SETTINGS: CinemaSettings = {
  schemaVersion: 1,
  providers: {},
  openAICompatible: {
    baseURL: "https://api.openai.com/v1",
    models: [],
  },
  prompts: {},
}

let cached: CinemaSettings | undefined

function settingsPath() {
  return path.join(Global.Path.data, "settings.json")
}

function normalizeSettings(value: Partial<CinemaSettings> | undefined): CinemaSettings {
  return {
    schemaVersion: 1,
    providers: value?.providers && typeof value.providers === "object" ? value.providers : {},
    openAICompatible: {
      baseURL: value?.openAICompatible?.baseURL?.trim() || DEFAULT_SETTINGS.openAICompatible.baseURL,
      ...(value?.openAICompatible?.defaultModel?.trim()
        ? { defaultModel: value.openAICompatible.defaultModel.trim() }
        : {}),
      models: Array.isArray(value?.openAICompatible?.models)
        ? value.openAICompatible.models.filter((item) => item && typeof item.id === "string" && item.id.trim()).map((item) => ({
            id: item.id.trim(),
            ...(item.label?.trim() ? { label: item.label.trim() } : {}),
            ...(item.supportsImageInput ? { supportsImageInput: true } : {}),
          }))
        : [],
    },
    prompts: {
      ...(value?.prompts?.textGeneration?.trim()
        ? { textGeneration: value.prompts.textGeneration.trim() }
        : {}),
    },
  }
}

export async function getSettings() {
  if (cached) return cached
  cached = await readJsonFile<Partial<CinemaSettings>>(settingsPath())
    .then(normalizeSettings)
    .catch(() => structuredClone(DEFAULT_SETTINGS))
  return cached
}

export async function saveSettings(next: CinemaSettings) {
  const normalized = normalizeSettings(next)
  await atomicWriteJson(settingsPath(), normalized)
  cached = normalized
  return normalized
}

export async function updateSettings(update: (current: CinemaSettings) => CinemaSettings | Promise<CinemaSettings>) {
  return await saveSettings(await update(structuredClone(await getSettings())))
}

export async function getCinemaVideoProviderSettings(providerID: string): Promise<ProviderSettings> {
  return (await getSettings()).providers[providerID] ?? {}
}

export async function setCinemaVideoProviderSettings(
  _configID: string,
  providerID: string,
  settings: ProviderSettings,
) {
  await updateSettings((current) => ({
    ...current,
    providers: { ...current.providers, [providerID]: settings },
  }))
}

export async function getImageGenerationSettings(_projectID: string) {
  return { default_count: 1, default_size: "1024x1024" }
}

export function clearSettingsCacheForTest() {
  cached = undefined
}
