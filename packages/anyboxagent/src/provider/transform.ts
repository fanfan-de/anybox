import type { Model } from "#provider/provider.ts"
import * as Log from "#util/log.ts"
import {
  getSupportedReasoningEfforts,
  normalizeReasoningEffort as normalizeSharedReasoningEffort,
  supportsReasoningEffort,
  type ReasoningEffort,
} from "@anybox/shared"

const log = Log.create({ service: "provider.transform" })

const OPENAI_PROVIDER_ID = "openai"
const DEEPSEEK_PROVIDER_ID = "deepseek"
const GOOGLE_PROVIDER_ID = "google"
const OPENAI_CODEX_API_SEGMENT = "/backend-api/codex"

export function isOpenAICodexModel(model: Model) {
  return model.providerID === OPENAI_PROVIDER_ID && model.api.url.includes(OPENAI_CODEX_API_SEGMENT)
}

export function isOpenAIReasoningModel(model: Model) {
  return model.providerID === OPENAI_PROVIDER_ID && model.capabilities.reasoning
}

export function isDeepSeekReasoningModel(model: Model) {
  return model.providerID === DEEPSEEK_PROVIDER_ID && model.capabilities.reasoning
}

export function isGoogleGeminiThinkingModel(model: Model) {
  if (model.providerID !== GOOGLE_PROVIDER_ID) return false

  return readGoogleModelIDs(model).some((modelID) => {
    const normalized = modelID.trim().toLowerCase()
    return normalized.startsWith("gemini-3") || normalized.startsWith("gemini-2.5")
  })
}

export function isProviderReasoningModel(model: Model) {
  return supportsReasoningEffort(toReasoningProfile(model))
}

function toReasoningProfile(model: Model) {
  return {
    providerID: model.providerID,
    modelID: model.id,
    reasoning: model.capabilities.reasoning,
  }
}

function normalizeReasoningEffort(model: Model, reasoningEffort?: ReasoningEffort) {
  if (!reasoningEffort || !isProviderReasoningModel(model)) return undefined

  const profile = toReasoningProfile(model)
  const normalized = normalizeSharedReasoningEffort({ ...profile, reasoningEffort })
  if (normalized) return normalized

  log.warn("ignoring unsupported provider reasoning effort", {
    modelID: model.id,
    providerID: model.providerID,
    reasoningEffort,
    supported: getSupportedReasoningEfforts(profile),
  })
  return undefined
}

function buildOpenAIProviderOptions(input: {
  model: Model
  systemPrompt: string
  reasoningEffort?: ReasoningEffort
}) {
  if (input.model.providerID !== OPENAI_PROVIDER_ID) return undefined

  const reasoningEffort = normalizeReasoningEffort(input.model, input.reasoningEffort)
  const isOpenAICodex = isOpenAICodexModel(input.model)
  const isOpenAIReasoning = isOpenAIReasoningModel(input.model)
  const options = {
    ...(isOpenAICodex
      ? {
          store: false,
          ...(input.systemPrompt
            ? {
                instructions: input.systemPrompt,
              }
            : {}),
        }
      : {}),
    ...(reasoningEffort
      ? {
          reasoningEffort,
        }
      : {}),
    ...(isOpenAIReasoning && reasoningEffort && reasoningEffort !== "none"
      ? {
          reasoningSummary: "auto",
        }
      : {}),
  }

  return Object.keys(options).length > 0 ? options : undefined
}

function buildDeepSeekProviderOptions(input: {
  model: Model
  reasoningEffort?: ReasoningEffort
}) {
  if (input.model.providerID !== DEEPSEEK_PROVIDER_ID) return undefined

  const reasoningEffort = normalizeReasoningEffort(input.model, input.reasoningEffort)
  if (!reasoningEffort) return undefined

  return {
    thinking: {
      type: "enabled",
    },
    reasoningEffort,
  }
}

function supportsGoogleMinimalThinkingLevel(modelID: string) {
  const normalized = modelID.trim().toLowerCase()
  return (
    normalized.startsWith("gemini-3.1-flash") ||
    normalized.startsWith("gemini-3-flash") ||
    normalized.startsWith("gemini-3.5-flash")
  )
}

function readGoogleModelIDs(model: Model) {
  return [model.api.id, model.id].filter((value, index, values) => value && values.indexOf(value) === index)
}

function isGoogleGeminiImageGenerationModel(model: Model) {
  if (model.providerID !== GOOGLE_PROVIDER_ID) return false
  if (model.capabilities.output?.image) return true

  return readGoogleModelIDs(model).some((modelID) => modelID.trim().toLowerCase().includes("-image"))
}

function resolveGoogleThinkingModelID(model: Model) {
  return readGoogleModelIDs(model).find((modelID) => {
    const normalized = modelID.trim().toLowerCase()
    return normalized.startsWith("gemini-3") || normalized.startsWith("gemini-2.5")
  }) ?? model.id
}

function supportsGoogleMediumThinkingLevel(modelID: string) {
  const normalized = modelID.trim().toLowerCase()
  return !normalized.startsWith("gemini-3-pro")
}

function normalizeGoogleThinkingLevel(modelID: string, reasoningEffort?: ReasoningEffort) {
  if (reasoningEffort === "none" || reasoningEffort === "minimal") {
    return supportsGoogleMinimalThinkingLevel(modelID) ? "minimal" : "low"
  }

  if (reasoningEffort === "low") return "low"
  if (reasoningEffort === "medium") {
    return supportsGoogleMediumThinkingLevel(modelID) ? "medium" : "high"
  }

  return "high"
}

function normalizeGoogleThinkingBudget(modelID: string, reasoningEffort?: ReasoningEffort) {
  const normalized = modelID.trim().toLowerCase()
  const canDisableThinking = !normalized.startsWith("gemini-2.5-pro")

  if ((reasoningEffort === "none" || reasoningEffort === "minimal") && canDisableThinking) {
    return 0
  }

  if (reasoningEffort === "low") return 1024
  if (reasoningEffort === "medium") return 8192
  if (reasoningEffort === "high" || reasoningEffort === "max" || reasoningEffort === "xhigh") return 24576

  return -1
}

function buildGoogleProviderOptions(input: {
  model: Model
  reasoningEffort?: ReasoningEffort
}) {
  if (!isGoogleGeminiThinkingModel(input.model)) return undefined
  if (isGoogleGeminiImageGenerationModel(input.model)) return undefined

  const thinkingModelID = resolveGoogleThinkingModelID(input.model)
  const normalized = thinkingModelID.trim().toLowerCase()
  if (normalized.startsWith("gemini-3")) {
    return {
      thinkingConfig: {
        thinkingLevel: normalizeGoogleThinkingLevel(thinkingModelID, input.reasoningEffort),
        includeThoughts: true,
      },
    }
  }

  if (normalized.startsWith("gemini-2.5")) {
    return {
      thinkingConfig: {
        thinkingBudget: normalizeGoogleThinkingBudget(thinkingModelID, input.reasoningEffort),
        includeThoughts: true,
      },
    }
  }

  return undefined
}

export function buildProviderOptions(input: {
  model: Model
  systemPrompt: string
  reasoningEffort?: ReasoningEffort
}) {
  const openai = buildOpenAIProviderOptions(input)
  const deepseek = buildDeepSeekProviderOptions(input)
  const google = buildGoogleProviderOptions(input)
  const options = {
    ...(openai ? { openai } : {}),
    ...(deepseek ? { deepseek } : {}),
    ...(google ? { google } : {}),
  }

  return Object.keys(options).length > 0 ? options : undefined
}
