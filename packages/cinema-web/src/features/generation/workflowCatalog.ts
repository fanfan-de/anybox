import type {
  CinemaProviderInputSpec,
  CinemaProviderWorkflow,
  CinemaProviderWorkflowCatalog,
  CinemaVideoProvider,
  GenerationControl,
  GenerationFormSpec,
} from "@anybox/shared/cinema"

type ProviderModel = CinemaVideoProvider["manifest"]["models"][number]

function hasDefault(control: GenerationControl) {
  return "defaultValue" in control && control.defaultValue !== undefined
}

function controlDefault(control: GenerationControl) {
  return "defaultValue" in control ? control.defaultValue : undefined
}

function inputBase(control: GenerationControl): CinemaProviderInputSpec {
  return {
    role: control.key,
    modality: "parameter",
    required: control.required,
    minCount: control.required ? 1 : 0,
    maxCount: 1,
    apiField: control.key,
    connectionKey: control.key,
    label: control.label,
    ...(control.description ? { note: control.description } : {}),
    ...(control.visibleWhen ? { visibleWhen: control.visibleWhen } : {}),
    ...(control.disabledWhen ? { disabledWhen: control.disabledWhen } : {}),
    ...(hasDefault(control) ? { default: controlDefault(control) } : {}),
  }
}

function workflowControlInput(
  control: GenerationControl,
  primaryTextControlKey: string | undefined,
): CinemaProviderInputSpec {
  const base = inputBase(control)
  switch (control.type) {
    case "text":
    case "prompt":
      return {
        ...base,
        role: control.key === primaryTextControlKey ? "prompt" : control.key,
        modality: control.key === primaryTextControlKey ? "text" : "parameter",
        uiControl: control.multiline || control.type === "prompt" ? "textarea" : "text",
        ...(control.maxLength ? { maxLength: control.maxLength } : {}),
        ...(control.multiline !== undefined ? { multiline: control.multiline } : {}),
        ...(control.placeholder ? { placeholder: control.placeholder } : {}),
      }
    case "media":
      return {
        ...base,
        role: control.mediaKind === "video"
          ? "sourceVideo"
          : control.mediaKind === "image"
            ? control.multiple || (control.maxCount ?? 1) > 1
              ? "referenceImage"
              : "sourceImage"
            : control.key,
        modality: control.mediaKind,
        uiControl: "media",
        minCount: control.minCount ?? (control.required ? 1 : 0),
        ...(control.maxCount !== undefined ? { maxCount: control.maxCount } : {}),
        ...(control.supportedMimeTypes ? { supportedFormats: control.supportedMimeTypes } : {}),
        ...(control.maxFileSizeMB ? { maxFileSizeMB: control.maxFileSizeMB } : {}),
      }
    case "image-list":
      return {
        ...base,
        role: "referenceImage",
        modality: "image",
        uiControl: "image-list",
        minCount: control.minCount ?? (control.required ? 1 : 0),
        ...(control.maxCount !== undefined ? { maxCount: control.maxCount } : {}),
        ...(control.supportedFormats ? { supportedFormats: control.supportedFormats } : {}),
        ...(control.maxFileSizeMB ? { maxFileSizeMB: control.maxFileSizeMB } : {}),
      }
    case "select":
      return {
        ...base,
        uiControl: "select",
        options: control.options,
        ...(control.labels ? { labels: control.labels } : {}),
      }
    case "number":
      return {
        ...base,
        modality: control.integer ? "integer" : "number",
        uiControl: "number",
        ...(control.min !== undefined ? { min: control.min } : {}),
        ...(control.max !== undefined ? { max: control.max } : {}),
        ...(control.step !== undefined ? { step: control.step } : {}),
        ...(control.integer !== undefined ? { integer: control.integer } : {}),
      }
    case "boolean":
      return {
        ...base,
        modality: "boolean",
        uiControl: "switch",
      }
    case "json":
      return {
        ...base,
        modality: "object",
        uiControl: "json",
      }
  }
}

function workflowModel(workflow: CinemaProviderWorkflow): ProviderModel | null {
  const formSpec = workflow.formSpec
  if (!formSpec || workflow.output?.kind !== "video") return null
  const primaryTextControl = formSpec.controls.find((control) =>
    control.type === "prompt" || control.type === "text"
  )
  const inputs = formSpec.controls.map((control) =>
    workflowControlInput(control, primaryTextControl?.key)
  )
  return {
    id: workflow.workflowID,
    label: workflow.name,
    family: "comfyui-workflow",
    modalities: {
      input: [...new Set(inputs.map((input) => input.modality))],
      output: ["video"],
    },
    modes: [formSpec.mode],
    durations: [],
    aspectRatios: [],
    resolutions: [],
    inputCombinations: [{
      mode: formSpec.mode,
      label: workflow.name,
      requiredModalities: [...new Set(inputs.filter((input) => input.required).map((input) => input.modality))],
      optionalModalities: [...new Set(inputs.filter((input) => !input.required).map((input) => input.modality))],
      inputs,
      requirements: [],
      note: workflow.description,
    }],
    pricing: [],
    formSpecs: [formSpec],
    parameterSchema: {},
  }
}

export function providersWithDiscoveredWorkflows(
  providers: CinemaVideoProvider[],
  catalogs: CinemaProviderWorkflowCatalog[],
) {
  const byProviderID = new Map(catalogs.map((catalog) => [catalog.providerID, catalog]))
  return providers.map((provider): CinemaVideoProvider => {
    const catalog = byProviderID.get(provider.manifest.id)
    if (!provider.manifest.capabilities?.workflowDiscovery || !catalog) return provider
    const discoveredModels = catalog.status === "ready"
      ? catalog.workflows.flatMap((workflow) => {
        if (workflow.status !== "ready") return []
        const model = workflowModel(workflow)
        return model ? [model] : []
      })
      : []
    return {
      ...provider,
      manifest: {
        ...provider.manifest,
        models: discoveredModels,
      },
    }
  })
}

export function workflowForTarget(
  catalogs: CinemaProviderWorkflowCatalog[],
  providerID: string,
  workflowID: string,
) {
  return catalogs
    .find((catalog) => catalog.providerID === providerID)
    ?.workflows.find((workflow) => workflow.workflowID === workflowID) ?? null
}

export function workflowIssueSummary(workflow: CinemaProviderWorkflow) {
  return workflow.issues.map((issue) => issue.message).join(" · ")
    || "This workflow is not ready."
}

function mediaValueIsCompatible(value: unknown) {
  if (typeof value === "string") return value.trim().length > 0
  if (!value || typeof value !== "object") return false
  if (Array.isArray(value)) return value.every(mediaValueIsCompatible)
  const record = value as Record<string, unknown>
  return ["path", "file", "image", "video", "audio"].some((key) =>
    typeof record[key] === "string" && String(record[key]).trim().length > 0
  )
}

export function generationControlValueIsCompatible(control: GenerationControl, value: unknown) {
  if (value === undefined) return false
  switch (control.type) {
    case "text":
    case "prompt":
      return typeof value === "string" && (!control.maxLength || value.length <= control.maxLength)
    case "number":
      return typeof value === "number"
        && Number.isFinite(value)
        && (!control.integer || Number.isInteger(value))
        && (control.min === undefined || value >= control.min)
        && (control.max === undefined || value <= control.max)
    case "boolean":
      return typeof value === "boolean"
    case "select":
      return control.options.some((option) => option === value)
    case "json":
      return value !== null
        && typeof value === "object"
        && (!control.serializedObjectOnly || !Array.isArray(value))
    case "image-list":
    case "media": {
      const values = Array.isArray(value) ? value : [value]
      const minimum = control.minCount ?? (control.required ? 1 : 0)
      const maximum = control.maxCount
        ?? (control.type === "media" && control.multiple ? Number.MAX_SAFE_INTEGER : 1)
      return values.length >= minimum
        && values.length <= maximum
        && values.every(mediaValueIsCompatible)
    }
  }
}

export function reconcileGenerationParameters(
  previous: Record<string, unknown>,
  formSpec: GenerationFormSpec | null | undefined,
) {
  const next: Record<string, unknown> = {}
  for (const control of formSpec?.controls ?? []) {
    if (generationControlValueIsCompatible(control, previous[control.key])) {
      next[control.key] = previous[control.key]
      continue
    }
    if (hasDefault(control)) next[control.key] = controlDefault(control)
  }
  return next
}
