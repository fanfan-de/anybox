import { cinemaRuntimeFetch } from "../../runtimeFetch"
import { resolveCinemaRuntimeURL } from "../../runtimeUrl"

export const CINEMA_PROVIDER_IDS = [
  "comfyui-local",
  "google-ai-sdk",
  "klingai-cn",
  "openai-compatible",
] as const

export type CinemaProviderID = typeof CINEMA_PROVIDER_IDS[number]
export type CinemaCredentialPersistence = "system-keychain" | "session" | "none"

export type CinemaProviderModelSettings = {
  id: string
  label?: string
  supportsImageInput?: boolean
}

export type CinemaProviderSettings = {
  baseURL?: string
  baseURLSource?: "settings" | "environment" | "default"
  userID?: string
  defaultModel?: string
  models: CinemaProviderModelSettings[]
  textGenerationPrompt?: string
}

export type CinemaProviderSettingsInput = {
  baseURL?: string | null
  userID?: string | null
  defaultModel?: string | null
  models?: CinemaProviderModelSettings[]
  textGenerationPrompt?: string | null
}

export type CinemaProviderCredential = {
  configured: boolean
  persistence: CinemaCredentialPersistence
}

export type CinemaProviderConnectionTest = {
  ok: boolean
  status?: string
  message?: string
  models: CinemaProviderModelSettings[]
  persisted?: boolean
  effectiveBaseURL?: string
  userID?: string
  connectionID?: string
  workflows?: number
  readyWorkflows?: number
}

export class CinemaProviderSettingsApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "CinemaProviderSettingsApiError"
    this.status = status
    this.code = code
  }
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function nonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

function normalizeModels(value: unknown): CinemaProviderModelSettings[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return []
    const id = stringValue(candidate.id)
    if (!id || seen.has(id)) return []
    seen.add(id)
    const label = stringValue(candidate.label)
    return [{
      id,
      ...(label ? { label } : {}),
      ...(candidate.supportsImageInput === true ? { supportsImageInput: true } : {}),
    }]
  })
}

function apiError(response: Response, body: unknown) {
  const envelope = isRecord(body) ? body : null
  const error = envelope && isRecord(envelope.error) ? envelope.error : null
  return new CinemaProviderSettingsApiError(
    stringValue(error?.message) ?? `Request failed (${response.status})`,
    response.status,
    stringValue(error?.code),
  )
}

async function requestData<T>(baseURL: string, pathname: string, init?: RequestInit): Promise<T> {
  const response = await cinemaRuntimeFetch(new URL(resolveCinemaRuntimeURL(baseURL, pathname)), init)
  const body = await response.json().catch(() => null) as unknown
  if (!response.ok || (isRecord(body) && body.success === false)) throw apiError(response, body)
  if (isRecord(body) && body.success === true && "data" in body) return body.data as T
  return body as T
}

function jsonRequest(method: "PUT" | "POST", body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

function normalizeSettings(value: unknown): CinemaProviderSettings {
  const settings = isRecord(value) ? value : {}
  return {
    ...(stringValue(settings.baseURL) ? { baseURL: stringValue(settings.baseURL) } : {}),
    ...(settings.baseURLSource === "settings"
      || settings.baseURLSource === "environment"
      || settings.baseURLSource === "default"
      ? { baseURLSource: settings.baseURLSource }
      : {}),
    ...(stringValue(settings.userID) ? { userID: stringValue(settings.userID) } : {}),
    ...(stringValue(settings.defaultModel) ? { defaultModel: stringValue(settings.defaultModel) } : {}),
    models: normalizeModels(settings.models),
    ...(stringValue(settings.textGenerationPrompt)
      ? { textGenerationPrompt: stringValue(settings.textGenerationPrompt) }
      : {}),
  }
}

function normalizeCredential(value: unknown): CinemaProviderCredential {
  const credential = isRecord(value) ? value : {}
  const persistence = credential.persistence === "system-keychain" || credential.persistence === "session"
    ? credential.persistence
    : "none"
  return { configured: credential.configured === true, persistence }
}

function normalizeConnectionTest(value: unknown): CinemaProviderConnectionTest {
  const result = isRecord(value) ? value : {}
  return {
    ok: result.ok === true,
    status: stringValue(result.status),
    message: stringValue(result.message),
    models: normalizeModels(result.models),
    ...(typeof result.persisted === "boolean" ? { persisted: result.persisted } : {}),
    ...(stringValue(result.effectiveBaseURL) ? { effectiveBaseURL: stringValue(result.effectiveBaseURL) } : {}),
    ...(stringValue(result.userID) ? { userID: stringValue(result.userID) } : {}),
    ...(stringValue(result.connectionID) ? { connectionID: stringValue(result.connectionID) } : {}),
    ...(nonnegativeInteger(result.workflows) !== undefined ? { workflows: nonnegativeInteger(result.workflows) } : {}),
    ...(nonnegativeInteger(result.readyWorkflows) !== undefined
      ? { readyWorkflows: nonnegativeInteger(result.readyWorkflows) }
      : {}),
  }
}

export function isCinemaProviderID(value: unknown): value is CinemaProviderID {
  return typeof value === "string" && CINEMA_PROVIDER_IDS.includes(value as CinemaProviderID)
}

export type CinemaProviderSettingsApi = {
  getSettings(providerID: CinemaProviderID, signal?: AbortSignal): Promise<CinemaProviderSettings>
  saveSettings(providerID: CinemaProviderID, input: CinemaProviderSettingsInput): Promise<void>
  getCredential(providerID: CinemaProviderID, signal?: AbortSignal): Promise<CinemaProviderCredential>
  saveCredential(
    providerID: CinemaProviderID,
    apiKey: string,
    persistence: Exclude<CinemaCredentialPersistence, "none">,
  ): Promise<CinemaProviderCredential>
  removeCredential(providerID: CinemaProviderID): Promise<void>
  testConnection(providerID: CinemaProviderID): Promise<CinemaProviderConnectionTest>
  connectProvider(
    providerID: CinemaProviderID,
    input: Pick<CinemaProviderSettingsInput, "baseURL" | "userID">,
  ): Promise<CinemaProviderConnectionTest>
  discoverOpenAIModels(): Promise<CinemaProviderModelSettings[]>
}

export function createCinemaProviderSettingsApi(baseURL: string): CinemaProviderSettingsApi {
  const providerPath = (providerID: CinemaProviderID, suffix: string) => (
    `/api/cinema/providers/${encodeURIComponent(providerID)}/${suffix}`
  )

  return {
    getSettings: async (providerID, signal) => normalizeSettings(await requestData<unknown>(
      baseURL,
      providerPath(providerID, "settings"),
      { signal },
    )),
    saveSettings: async (providerID, input) => {
      await requestData(
        baseURL,
        providerPath(providerID, "settings"),
        jsonRequest("PUT", input),
      )
    },
    getCredential: async (providerID, signal) => normalizeCredential(await requestData<unknown>(
      baseURL,
      providerPath(providerID, "credential"),
      { signal },
    )),
    saveCredential: async (providerID, apiKey, persistence) => normalizeCredential(await requestData<unknown>(
      baseURL,
      providerPath(providerID, "credential"),
      jsonRequest("PUT", { apiKey, persistence }),
    )),
    removeCredential: async (providerID) => {
      await requestData(baseURL, providerPath(providerID, "credential"), { method: "DELETE" })
    },
    testConnection: async (providerID) => normalizeConnectionTest(await requestData<unknown>(
      baseURL,
      providerPath(providerID, "test"),
      jsonRequest("POST"),
    )),
    connectProvider: async (providerID, input) => normalizeConnectionTest(await requestData<unknown>(
      baseURL,
      providerPath(providerID, "connect"),
      jsonRequest("POST", input),
    )),
    discoverOpenAIModels: async () => {
      const result = await requestData<unknown>(
        baseURL,
        "/api/cinema/providers/openai-compatible/models/discover",
        jsonRequest("POST"),
      )
      return normalizeModels(isRecord(result) ? result.items : undefined)
    },
  }
}
