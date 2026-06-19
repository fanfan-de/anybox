import { z } from "zod"

export const ReasoningEffortValues = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export const ReasoningEffortSchema = z.enum(ReasoningEffortValues)
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>

const OPENAI_PROVIDER_ID = "openai"
const DEEPSEEK_PROVIDER_ID = "deepseek"
const GOOGLE_PROVIDER_ID = "google"
const DEFAULT_OPENAI_REASONING_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"]
const DEEPSEEK_REASONING_EFFORTS: ReasoningEffort[] = ["high", "max"]
const DEFAULT_GOOGLE_REASONING_EFFORTS: ReasoningEffort[] = ["low", "medium", "high"]

export type ReasoningModelProfile = {
  providerID: string
  modelID: string
  reasoning: boolean
}

export function isReasoningEffortProvider(providerID: string) {
  return providerID === OPENAI_PROVIDER_ID || providerID === DEEPSEEK_PROVIDER_ID || providerID === GOOGLE_PROVIDER_ID
}

export function supportsReasoningEffort(input: ReasoningModelProfile) {
  return input.reasoning && isReasoningEffortProvider(input.providerID)
}

function getSupportedOpenAIReasoningEfforts(modelID: string): ReasoningEffort[] {
  const normalized = modelID.trim().toLowerCase()
  if (!normalized) return DEFAULT_OPENAI_REASONING_EFFORTS

  if (normalized.startsWith("gpt-5-pro")) {
    return ["high"]
  }

  if (normalized.startsWith("gpt-5.4-pro") || normalized.startsWith("gpt-5.2-pro")) {
    return ["medium", "high", "xhigh"]
  }

  if (normalized.startsWith("gpt-5.4") || normalized.startsWith("gpt-5.2")) {
    return ["none", "low", "medium", "high", "xhigh"]
  }

  if (normalized.startsWith("gpt-5.3-codex")) {
    return ["low", "medium", "high", "xhigh"]
  }

  if (normalized.startsWith("gpt-5.1-codex-max")) {
    return ["none", "medium", "high", "xhigh"]
  }

  if (normalized.startsWith("gpt-5.1")) {
    return ["none", "low", "medium", "high"]
  }

  if (normalized.startsWith("gpt-5")) {
    return ["minimal", "low", "medium", "high"]
  }

  return DEFAULT_OPENAI_REASONING_EFFORTS
}

export function getSupportedReasoningEfforts(input: ReasoningModelProfile): ReasoningEffort[] {
  if (!supportsReasoningEffort(input)) return []
  if (input.providerID === OPENAI_PROVIDER_ID) return getSupportedOpenAIReasoningEfforts(input.modelID)
  if (input.providerID === DEEPSEEK_PROVIDER_ID) return DEEPSEEK_REASONING_EFFORTS
  if (input.providerID === GOOGLE_PROVIDER_ID) return getSupportedGoogleReasoningEfforts(input.modelID)
  return []
}

function getSupportedGoogleReasoningEfforts(modelID: string): ReasoningEffort[] {
  const normalized = modelID.trim().toLowerCase()
  if (!normalized) return DEFAULT_GOOGLE_REASONING_EFFORTS

  if (normalized.startsWith("gemini-3.1-pro")) {
    return ["low", "medium", "high"]
  }

  if (normalized.startsWith("gemini-3-pro")) {
    return ["low", "high"]
  }

  if (
    normalized.startsWith("gemini-3.1-flash") ||
    normalized.startsWith("gemini-3-flash") ||
    normalized.startsWith("gemini-3.5-flash")
  ) {
    return ["minimal", "low", "medium", "high"]
  }

  if (normalized.startsWith("gemini-3")) {
    return DEFAULT_GOOGLE_REASONING_EFFORTS
  }

  if (normalized.startsWith("gemini-2.5-pro")) {
    return DEFAULT_GOOGLE_REASONING_EFFORTS
  }

  if (normalized.startsWith("gemini-2.5-flash")) {
    return ["none", "low", "medium", "high"]
  }

  return DEFAULT_GOOGLE_REASONING_EFFORTS
}

export function getDefaultReasoningEffort(input: ReasoningModelProfile): ReasoningEffort | undefined {
  const supported = new Set(getSupportedReasoningEfforts(input))
  if (supported.size === 0) return undefined

  const normalized = input.modelID.trim().toLowerCase()

  if (input.providerID === DEEPSEEK_PROVIDER_ID) {
    if (supported.has("high")) return "high"
    if (supported.has("max")) return "max"
  }

  if (input.providerID === GOOGLE_PROVIDER_ID) {
    if (supported.has("high")) return "high"
    if (supported.has("medium")) return "medium"
  }

  if (normalized.startsWith("gpt-5-pro") && supported.has("high")) {
    return "high"
  }

  if (normalized.startsWith("gpt-5.1") && supported.has("none")) {
    return "none"
  }

  if (normalized.startsWith("gpt-5.2") && supported.has("none")) {
    return "none"
  }

  if (normalized.startsWith("gpt-5.3-codex-spark") && supported.has("high")) {
    return "high"
  }

  if (supported.has("medium")) {
    return "medium"
  }

  return getSupportedReasoningEfforts(input)[0]
}

export function normalizeReasoningEffort(input: ReasoningModelProfile & {
  reasoningEffort?: ReasoningEffort
}): ReasoningEffort | undefined {
  if (!input.reasoningEffort || !supportsReasoningEffort(input)) return undefined

  if (input.providerID === DEEPSEEK_PROVIDER_ID) {
    if (input.reasoningEffort === "high" || input.reasoningEffort === "max") return input.reasoningEffort
    if (input.reasoningEffort === "low" || input.reasoningEffort === "medium") return "high"
    if (input.reasoningEffort === "xhigh") return "max"
    return undefined
  }

  if (input.providerID === GOOGLE_PROVIDER_ID) {
    if (input.reasoningEffort === "max" || input.reasoningEffort === "xhigh") return "high"
  }

  return getSupportedReasoningEfforts(input).includes(input.reasoningEffort)
    ? input.reasoningEffort
    : undefined
}
