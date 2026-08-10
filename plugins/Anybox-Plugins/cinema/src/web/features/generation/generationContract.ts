import type {
  CinemaGenerationMode,
  CinemaProviderInputSpec,
  CinemaVideoProvider,
  GenerationControl,
  GenerationControlOption,
} from "@anybox/cinema-plugin/contracts"

export type GenerationInputSlot =
  | "textParameter"
  | "sourceImage"
  | "startFrame"
  | "endFrame"
  | "referenceImage"
  | "sourceVideo"
  | "mask"

export type GenerationMediaInputSlot = Exclude<GenerationInputSlot, "textParameter">
export type GenerationImageInputSlot = Extract<GenerationInputSlot, "sourceImage" | "startFrame" | "endFrame" | "referenceImage" | "mask">
export type GenerationParameterControl = "aspectRatio" | "duration" | "resolution"
export type GenerationInputFulfillment =
  | "user-text"
  | "user-media"
  | "visible-parameter"
  | "hidden-default"
  | "unsupported"

export type GenerationProviderModel = CinemaVideoProvider["manifest"]["models"][number]
export type GenerationProviderInputCombination = GenerationProviderModel["inputCombinations"][number]

export type GenerationInputControl = {
  inputKey: string
  role: string
  modality: string
  required: boolean
  minCount: number
  maxCount?: number
  note?: string
  slot: GenerationInputSlot | null
  parameterControl: GenerationParameterControl | null
  parameterKey: string
  formControl: GenerationControl | null
  fulfillment: GenerationInputFulfillment
  label: string
  emptyText: string
}

export type GenerationModeInputContract = {
  mode: CinemaGenerationMode
  label: string
  promptPlaceholder: string
  inputs: GenerationInputControl[]
  parameterControls: GenerationControl[]
  unsupportedRequiredInputs: GenerationInputControl[]
}

export const GENERATION_INPUT_SLOTS = [
  "textParameter",
  "sourceImage",
  "startFrame",
  "endFrame",
  "referenceImage",
  "sourceVideo",
  "mask",
] as const satisfies readonly GenerationInputSlot[]

export const GENERATION_IMAGE_INPUT_SLOTS = [
  "sourceImage",
  "startFrame",
  "endFrame",
  "referenceImage",
  "mask",
] as const satisfies readonly GenerationImageInputSlot[]

const PROMPT_INPUT_ROLES = new Set([
  "prompt",
  "positiveprompt",
  "userprompt",
])

const REFERENCE_IMAGE_INPUT_ROLES = new Set([
  "imagelist",
  "referenceimage",
  "referenceimagelist",
  "styleimage",
])

const SOURCE_IMAGE_INPUT_ROLES = new Set([
  "sourceimage",
  "characterimage",
  "controlimage",
  "image",
])

const START_FRAME_INPUT_ROLES = new Set([
  "firstframeimage",
  "firstframe",
  "startframeimage",
  "startframe",
])

const END_FRAME_INPUT_ROLES = new Set([
  "lastframeimage",
  "lastframe",
  "endframeimage",
  "endframe",
])

const SOURCE_VIDEO_INPUT_ROLES = new Set([
  "sourcevideo",
  "referencevideo",
  "video",
])

const MASK_INPUT_ROLES = new Set([
  "maskimage",
  "mask",
])

const TEXT_PARAMETER_EMPTY_TEXT = "Connect a text node as a parameter."
const MEDIA_INPUT_EMPTY_TEXT: Record<GenerationMediaInputSlot, string> = {
  sourceImage: "Connect an image node or generated image.",
  startFrame: "Import or connect a first-frame image.",
  endFrame: "Import or connect a last-frame image.",
  referenceImage: "Connect one or more reference images.",
  sourceVideo: "Connect a video node.",
  mask: "Connect a mask asset.",
}

export function normalizedProviderInputRole(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function providerInputHasDefaultValue(input: CinemaProviderInputSpec) {
  return Object.prototype.hasOwnProperty.call(input as Record<string, unknown>, "default")
}

export function providerInputDefaultValue(input: CinemaProviderInputSpec) {
  return (input as Record<string, unknown>).default
}

export function providerInputParameterKey(input: CinemaProviderInputSpec) {
  const apiField = (input as Record<string, unknown>).apiField
  return typeof apiField === "string" && apiField.trim() ? apiField.trim() : input.role.trim()
}

export function providerInputOptionValues(input: CinemaProviderInputSpec) {
  const record = input as Record<string, unknown>
  const options = Array.isArray(record.options)
    ? record.options
    : Array.isArray(record.values)
      ? record.values
      : []
  return options
}

export function providerInputMatchesRole(
  input: CinemaProviderInputSpec,
  roles: string[],
) {
  const normalizedRole = normalizedProviderInputRole(input.role)
  return roles.some((role) => normalizedRole === normalizedProviderInputRole(role))
}

export function providerInputForRoles(
  combination: GenerationProviderInputCombination | null,
  roles: string[],
) {
  return combination?.inputs.find((input) => providerInputMatchesRole(input, roles)) ?? null
}

export function stringParameterOptionLabelsForCombination(
  combination: GenerationProviderInputCombination | null,
  roles: string[],
) {
  const input = providerInputForRoles(combination, roles)
  const labels = input ? (input as Record<string, unknown>).labels : undefined
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return {}
  return Object.fromEntries(
    Object.entries(labels).flatMap(([value, label]) =>
      typeof label === "string" && label.trim() ? [[value, label.trim()]] : []
    ),
  )
}

export function stringParameterOptionsForCombination(
  combination: GenerationProviderInputCombination | null,
  roles: string[],
) {
  const values = combination?.inputs.flatMap((input) =>
    providerInputMatchesRole(input, roles)
      ? providerInputOptionValues(input).flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : [])
      : []
  ) ?? []
  return [...new Set(values)]
}

export function numberParameterOptionsForCombination(
  combination: GenerationProviderInputCombination | null,
  roles: string[],
) {
  const values = combination?.inputs.flatMap((input) =>
    providerInputMatchesRole(input, roles)
      ? providerInputOptionValues(input).flatMap((value) => {
        const numericValue = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN
        return Number.isFinite(numericValue) && numericValue > 0 ? [numericValue] : []
      })
      : []
  ) ?? []
  return [...new Set(values)]
}

export function slotForInputRole(role: string, modality: string): GenerationInputSlot | null {
  const normalizedRole = normalizedProviderInputRole(role)
  const normalizedModality = modality.trim().toLowerCase()

  if (PROMPT_INPUT_ROLES.has(normalizedRole)) return "textParameter"
  if (START_FRAME_INPUT_ROLES.has(normalizedRole)) return "startFrame"
  if (END_FRAME_INPUT_ROLES.has(normalizedRole)) return "endFrame"
  if (REFERENCE_IMAGE_INPUT_ROLES.has(normalizedRole)) return "referenceImage"
  if (SOURCE_VIDEO_INPUT_ROLES.has(normalizedRole)) return "sourceVideo"
  if (MASK_INPUT_ROLES.has(normalizedRole)) return "mask"
  if (SOURCE_IMAGE_INPUT_ROLES.has(normalizedRole)) return "sourceImage"
  if (normalizedModality === "image") return "sourceImage"
  if (normalizedModality === "video") return "sourceVideo"
  return null
}

export function parameterControlForInputRole(role: string): GenerationParameterControl | null {
  switch (normalizedProviderInputRole(role)) {
    case "aspectratio":
      return "aspectRatio"
    case "duration":
      return "duration"
    case "qualitymode":
    case "quality":
    case "mode":
    case "resolution":
      return "resolution"
    default:
      return null
  }
}

export function canSatisfyRequiredGenerationInput(input: GenerationInputControl) {
  return input.fulfillment !== "unsupported"
}

export function isGenerationImageInputSlot(slot: GenerationInputSlot): slot is GenerationImageInputSlot {
  return (GENERATION_IMAGE_INPUT_SLOTS as readonly GenerationInputSlot[]).includes(slot)
}

export function isGenerationMediaInputSlot(slot: GenerationInputSlot): slot is GenerationMediaInputSlot {
  return slot !== "textParameter"
}

export function isGenerationMediaInputControl(input: GenerationInputControl): input is GenerationInputControl & { slot: GenerationMediaInputSlot } {
  return Boolean(input.slot && isGenerationMediaInputSlot(input.slot))
}

export function generationControlDefaultParameters(controls: GenerationControl[]) {
  const parameters: Record<string, unknown> = {}
  for (const control of controls) {
    if (!("defaultValue" in control) || control.defaultValue === undefined) continue
    parameters[control.key] = control.defaultValue
  }
  return parameters
}

export function hiddenDefaultParametersForCombination(combination: GenerationProviderInputCombination | null) {
  const parameters: Record<string, unknown> = {}
  for (const input of combination?.inputs ?? []) {
    const role = input.role.trim()
    const modality = input.modality.trim()
    const slot = slotForInputRole(role, modality)
    const parameterControl = parameterControlForInputRole(role)
    const formControl = generationFormControlForProviderInput(input, slot, parameterControl)
    if (slot || parameterControl || formControl || !providerInputHasDefaultValue(input)) continue
    parameters[providerInputParameterKey(input)] = providerInputDefaultValue(input)
  }
  return parameters
}

export function videoInputKey(role: string, index: number, connectionKey?: string) {
  const safeRole = role.trim().replace(/[^a-z0-9_-]+/gi, "-") || "input"
  const safeConnectionKey = connectionKey?.trim().replace(/[^a-z0-9_-]+/gi, "-")
  return `input:${safeConnectionKey ? `key-${safeConnectionKey}` : index}:${safeRole}`
}

export function formatInputCombinationLabel(mode: string) {
  return mode
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
}

export function labelForInputRole(role: string, modality: string) {
  const normalizedRole = normalizedProviderInputRole(role)
  switch (normalizedRole) {
    case "prompt":
      return "Prompt"
    case "firstframeimage":
    case "firstframe":
    case "startframeimage":
    case "startframe":
      return "First frame"
    case "lastframeimage":
    case "lastframe":
    case "endframeimage":
    case "endframe":
      return "Last frame"
    case "imagelist":
    case "referenceimage":
    case "referenceimagelist":
      return "Reference image"
    case "styleimage":
      return "Style image"
    case "sourcevideo":
    case "referencevideo":
    case "video":
      return "Source video"
    case "maskimage":
    case "mask":
      return "Mask"
    case "sourceimage":
    case "characterimage":
    case "controlimage":
    case "image":
      return "Source image"
    default:
      return role ? formatInputCombinationLabel(role) : formatInputCombinationLabel(modality)
  }
}

export function emptyTextForInputRole(role: string, modality: string, slot: GenerationInputSlot | null) {
  if (slot === "textParameter") return TEXT_PARAMETER_EMPTY_TEXT
  if (slot) return MEDIA_INPUT_EMPTY_TEXT[slot]
  return `Unsupported ${role || modality} input`
}

export function generationInputControlForSpec(input: CinemaProviderInputSpec, index: number): GenerationInputControl {
  const role = input.role.trim()
  const modality = input.modality.trim()
  const slot = slotForInputRole(role, modality)
  const parameterControl = parameterControlForInputRole(role)
  const formControl = generationFormControlForProviderInput(input, slot, parameterControl)
  return {
    inputKey: videoInputKey(role, index, input.connectionKey),
    role,
    modality,
    required: input.required,
    minCount: input.minCount,
    maxCount: input.maxCount,
    note: typeof input.note === "string" ? input.note : undefined,
    slot,
    parameterControl,
    parameterKey: providerInputParameterKey(input),
    formControl,
    fulfillment: generationInputFulfillmentForSpec(input, slot, parameterControl, formControl),
    label: input.label?.trim() || labelForInputRole(role, modality),
    emptyText: emptyTextForInputRole(role, modality, slot),
  }
}

export function generationModeInputContractForCombination(
  combination: GenerationProviderInputCombination | null,
  fallbackMode: CinemaGenerationMode,
): GenerationModeInputContract {
  const inputs = combination?.inputs.map(generationInputControlForSpec) ?? []
  const promptInput = inputs.find((input) => input.slot === "textParameter")
  const parameterControls = inputs.flatMap((input) => input.formControl ? [input.formControl] : [])
  const unsupportedRequiredInputs = inputs.filter((input) => input.required && !canSatisfyRequiredGenerationInput(input))
  return {
    mode: combination?.mode ?? fallbackMode,
    label: combination?.label ?? formatInputCombinationLabel(combination?.mode ?? fallbackMode),
    promptPlaceholder: promptInput?.note ?? "Describe content, motion, camera, and visual changes...",
    inputs,
    parameterControls,
    unsupportedRequiredInputs,
  }
}

function generationInputFulfillmentForSpec(
  input: CinemaProviderInputSpec,
  slot: GenerationInputSlot | null,
  parameterControl: GenerationParameterControl | null,
  formControl: GenerationControl | null,
): GenerationInputFulfillment {
  if (slot === "textParameter") return "user-text"
  if (slot) return "user-media"
  if (parameterControl || formControl) return "visible-parameter"
  if (providerInputHasDefaultValue(input)) return "hidden-default"
  return "unsupported"
}

function generationFormControlForProviderInput(
  input: CinemaProviderInputSpec,
  slot: GenerationInputSlot | null,
  parameterControl: GenerationParameterControl | null,
): GenerationControl | null {
  if (slot || parameterControl) return null

  const base = generationControlBase(input)
  const uiControl = input.uiControl
  const modality = input.modality.trim().toLowerCase()
  const options = input.options?.filter(isGenerationControlOption)

  if (uiControl === "text" || uiControl === "textarea" || modality === "text") {
    return {
      ...base,
      type: uiControl === "text" && input.multiline !== true ? "text" : "prompt",
      ...(input.multiline !== undefined ? { multiline: input.multiline } : {}),
      ...(input.maxLength ? { maxLength: input.maxLength } : {}),
      ...(input.placeholder ? { placeholder: input.placeholder } : {}),
      ...(typeof input.default === "string" ? { defaultValue: input.default } : {}),
    }
  }

  if ((uiControl === "select" || uiControl === "segmented" || options) && options && options.length > 0) {
    return {
      ...base,
      type: "select",
      options,
      ...(input.labels ? { labels: input.labels } : {}),
      ...(providerInputHasDefaultValue(input) ? { defaultValue: providerInputDefaultValue(input) } : {}),
    }
  }

  if (uiControl === "number" || input.min !== undefined || input.max !== undefined || modality === "number" || modality === "integer") {
    return {
      ...base,
      type: "number",
      ...(input.min !== undefined ? { min: input.min } : {}),
      ...(input.max !== undefined ? { max: input.max } : {}),
      ...(input.step !== undefined ? { step: input.step } : {}),
      ...(input.integer !== undefined ? { integer: input.integer } : {}),
      ...(typeof input.default === "number" ? { defaultValue: input.default } : {}),
    }
  }

  if (uiControl === "switch" || modality === "boolean" || typeof input.default === "boolean") {
    return {
      ...base,
      type: "boolean",
      ...(typeof input.default === "boolean" ? { defaultValue: input.default } : {}),
    }
  }

  if (uiControl === "media" && (modality === "image" || modality === "video" || modality === "audio")) {
    return {
      ...base,
      type: "media",
      mediaKind: modality,
      multiple: (input.maxCount ?? 1) > 1,
      minCount: input.minCount,
      ...(input.maxCount !== undefined ? { maxCount: input.maxCount } : {}),
      ...(input.supportedFormats ? { supportedMimeTypes: input.supportedFormats } : {}),
      ...(input.maxFileSizeMB ? { maxFileSizeMB: input.maxFileSizeMB } : {}),
      acceptsConnection: true,
    }
  }

  if (uiControl === "json" || modality === "object" || modality === "parameter" || !input.required) {
    return {
      ...base,
      type: "json",
      ...(providerInputHasDefaultValue(input) ? { defaultValue: providerInputDefaultValue(input) } : {}),
    }
  }

  return null
}

function generationControlBase(input: CinemaProviderInputSpec) {
  return {
    key: providerInputParameterKey(input),
    label: input.label?.trim() || labelForInputRole(input.role, input.modality),
    required: input.required,
    ...(input.note ? { description: input.note } : {}),
    ...(input.visibleWhen ? { visibleWhen: input.visibleWhen } : {}),
    ...(input.disabledWhen ? { disabledWhen: input.disabledWhen } : {}),
  }
}

function isGenerationControlOption(value: unknown): value is GenerationControlOption {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
}
