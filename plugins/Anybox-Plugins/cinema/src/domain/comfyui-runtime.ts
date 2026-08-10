import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream, openAsBlob } from "node:fs"
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type {
  CinemaGeneratedAsset,
  CinemaGenerationTask,
  CinemaProviderModelMode,
  CinemaVideoProviderManifest,
  GenerationControl,
} from "@anybox/cinema-plugin/contracts"
import { ApiError } from "#server/error.ts"
import * as Lock from "#util/lock.ts"
import { sameOriginFetch } from "../providers/network-policy.ts"
import {
  COMFYUI_PROVIDER_ID,
  assertComfyUIEndpointResolvesToLoopback,
  clearComfyUIWorkflowCatalogForTest,
  configuredComfyUIConnection,
  fetchComfyUI,
  getComfyUIWorkflowCatalog,
  getInternalComfyUIWorkflow,
  isComfyUINetworkError,
  refreshComfyUIWorkflowCatalog,
  requestComfyUIJSON,
  urlForComfyUI,
  validateComfyUIBaseURL,
  type ComfyUIApiPrompt,
  type InternalComfyUIWorkflow,
} from "./comfyui-workflows.ts"

export { COMFYUI_PROVIDER_ID, validateComfyUIBaseURL }

const COMFYUI_SUBMIT_TIMEOUT_MS = 30_000
const COMFYUI_DOWNLOAD_TIMEOUT_MS = 120_000
const COMFYUI_TASK_MISSING_LIMIT = 3
const COMFYUI_IMAGE_MAX_BYTES = 64 * 1024 * 1024
const COMFYUI_VIDEO_MAX_BYTES = 256 * 1024 * 1024
const COMFYUI_AUDIO_MAX_BYTES = 128 * 1024 * 1024
const SNAPSHOT_SCHEMA_VERSION = 2
const CLIENT_ID = "anybox-cinema"

const MIME_BY_EXTENSION: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".flac": "audio/flac",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
}
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/flac": ".flac",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
}

type AdapterInput = {
  root: string
  cinemaRoot: string
  task: CinemaGenerationTask
  canvas: unknown
  persistTask?: (task: CinemaGenerationTask) => Promise<void>
}

type SnapshotBinding = {
  nodeID: string
  inputName: string
  dynamicComboTemplates?: Array<{
    option: string | number | boolean
    promptInputs: Record<string, unknown>
  }>
}

type WorkflowSnapshot = {
  schemaVersion: number
  taskID: string
  workflowID: string
  revision: string
  outputKind: "image" | "video"
  outputNodeIDs: string[]
  uiWorkflow: Record<string, unknown>
  apiPrompt: ComfyUIApiPrompt
  bindings: Record<string, SnapshotBinding[]>
  controls: GenerationControl[]
  values: Record<string, unknown>
  digest: string
}

type RemoteState = {
  history?: Record<string, unknown>
  runningPromptIDs: string[]
  pendingPromptIDs: string[]
}

type OutputDescriptor = {
  nodeID: string
  collection: string
  filename: string
  subfolder: string
  type: "output"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function comfyUIValidationErrorSummary(value: unknown) {
  if (!isRecord(value)) return ""
  const summaries: string[] = []
  for (const [nodeID, rawNodeError] of Object.entries(value)) {
    if (!isRecord(rawNodeError)) continue
    const nodeType = stringValue(rawNodeError.class_type) ?? "Node"
    const errors = Array.isArray(rawNodeError.errors) ? rawNodeError.errors : []
    if (errors.length === 0) {
      summaries.push(`${nodeType} ${nodeID}`)
      continue
    }
    for (const rawError of errors) {
      if (!isRecord(rawError)) continue
      const extraInfo = isRecord(rawError.extra_info) ? rawError.extra_info : {}
      const inputName = stringValue(extraInfo.input_name)
        ?? stringValue(rawError.input_name)
        ?? stringValue(rawError.details)
      const message = stringValue(rawError.message)
        ?? stringValue(rawError.type)
        ?? "Validation failed"
      const details = stringValue(rawError.details)
      const suffix = details && details !== inputName && details !== message
        ? ` (${details})`
        : ""
      summaries.push(`${nodeType} ${nodeID}${inputName ? `.${inputName}` : ""}: ${message}${suffix}`)
    }
  }
  return summaries.slice(0, 5).join("; ").slice(0, 800)
}

function comfyUISubmissionErrorSummary(value: unknown) {
  if (!isRecord(value)) return ""
  const error = value.error
  const topLevel = typeof error === "string"
    ? stringValue(error)
    : isRecord(error)
      ? stringValue(error.message) ?? stringValue(error.type)
      : undefined
  const validation = comfyUIValidationErrorSummary(value.node_errors)
  return [topLevel, validation].filter(Boolean).join("; ").slice(0, 800)
}

function taskReference(task: CinemaGenerationTask) {
  return isRecord(task.providerTaskRef) ? task.providerTaskRef : {}
}

function taskUpdated(task: CinemaGenerationTask, patch: Partial<CinemaGenerationTask>): CinemaGenerationTask {
  return {
    ...task,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
}

function progress(
  phase: NonNullable<CinemaGenerationTask["progress"]>["phase"],
  message: string,
  percent?: number,
) {
  return {
    phase,
    message,
    ...(percent !== undefined ? { percent } : {}),
    updatedAt: new Date().toISOString(),
  }
}

function failed(task: CinemaGenerationTask, errorCode: string, message: string) {
  return taskUpdated(task, {
    status: "failed",
    errorCode,
    error: message,
    progress: progress("failed", message),
  })
}

function safeErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback
  return message
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "[local path]")
    .replace(/\/(?:home|Users|tmp)\/[^\s"'<>]+/g, "[local path]")
    .slice(0, 1_000)
}

function clonePrompt(prompt: ComfyUIApiPrompt): ComfyUIApiPrompt {
  return structuredClone(prompt)
}

function snapshotPath(cinemaRoot: string, taskID: string, submitted = false) {
  const suffix = submitted ? ".submitted.json" : ".json"
  return path.join(cinemaRoot, "state", "comfyui-workflows", `${taskID}${suffix}`)
}

function snapshotDigest(snapshot: Omit<WorkflowSnapshot, "digest">) {
  return `sha256:${createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")}`
}

async function writeImmutableSnapshot(
  cinemaRoot: string,
  taskID: string,
  snapshot: Omit<WorkflowSnapshot, "digest">,
  submitted = false,
) {
  const filepath = snapshotPath(cinemaRoot, taskID, submitted)
  const complete: WorkflowSnapshot = { ...snapshot, digest: snapshotDigest(snapshot) }
  await mkdir(path.dirname(filepath), { recursive: true })
  try {
    await writeFile(filepath, JSON.stringify(complete), { encoding: "utf8", flag: "wx" })
  } catch (error) {
    if (!isRecord(error) || error.code !== "EEXIST") throw error
    const existing = await readWorkflowSnapshot(cinemaRoot, taskID, submitted)
    if (existing.digest !== complete.digest) {
      throw new ApiError(
        409,
        "COMFYUI_WORKFLOW_SNAPSHOT_CONFLICT",
        "The immutable ComfyUI workflow snapshot does not match this task.",
      )
    }
    return existing
  }
  return complete
}

async function readWorkflowSnapshot(cinemaRoot: string, taskID: string, submitted = false) {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(snapshotPath(cinemaRoot, taskID, submitted), "utf8"))
  } catch {
    throw new ApiError(500, "COMFYUI_WORKFLOW_SNAPSHOT_INVALID", "The task workflow snapshot is missing or invalid.")
  }
  if (
    !isRecord(parsed)
    || parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION
    || parsed.taskID !== taskID
    || !stringValue(parsed.workflowID)
    || !stringValue(parsed.revision)
    || (parsed.outputKind !== "image" && parsed.outputKind !== "video")
    || !Array.isArray(parsed.outputNodeIDs)
    || !isRecord(parsed.uiWorkflow)
    || !isRecord(parsed.apiPrompt)
    || !isRecord(parsed.bindings)
    || !Array.isArray(parsed.controls)
    || !isRecord(parsed.values)
    || !stringValue(parsed.digest)
  ) {
    throw new ApiError(500, "COMFYUI_WORKFLOW_SNAPSHOT_INVALID", "The task workflow snapshot is invalid.")
  }
  const { digest, ...withoutDigest } = parsed as unknown as WorkflowSnapshot
  if (snapshotDigest(withoutDigest) !== digest) {
    throw new ApiError(500, "COMFYUI_WORKFLOW_SNAPSHOT_INVALID", "The task workflow snapshot digest is invalid.")
  }
  return parsed as unknown as WorkflowSnapshot
}

function defaultValue(control: GenerationControl) {
  return "defaultValue" in control ? control.defaultValue : undefined
}

function mediaPaths(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return values.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) return [entry]
    if (!isRecord(entry)) return []
    const candidate = stringValue(entry.path)
      ?? stringValue(entry.file)
      ?? stringValue(entry.image)
      ?? stringValue(entry.video)
      ?? stringValue(entry.audio)
    return candidate ? [candidate] : []
  })
}

function validateControlValue(control: GenerationControl, raw: unknown) {
  const value = raw === undefined ? defaultValue(control) : raw
  if (value === undefined || value === null || value === "") {
    if (control.required) {
      throw new ApiError(
        400,
        "COMFYUI_WORKFLOW_INPUT_REQUIRED",
        `APP mode input '${control.label}' is required.`,
        { controlKey: control.key },
      )
    }
    return undefined
  }
  switch (control.type) {
    case "text":
    case "prompt": {
      if (typeof value !== "string") {
        throw new ApiError(400, "COMFYUI_WORKFLOW_INPUT_INVALID", `'${control.label}' must be text.`)
      }
      if (control.maxLength && value.length > control.maxLength) {
        throw new ApiError(400, "COMFYUI_WORKFLOW_INPUT_INVALID", `'${control.label}' is too long.`)
      }
      return value
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ApiError(400, "COMFYUI_WORKFLOW_INPUT_INVALID", `'${control.label}' must be a number.`)
      }
      if (control.integer && !Number.isInteger(value)) {
        throw new ApiError(400, "COMFYUI_WORKFLOW_INPUT_INVALID", `'${control.label}' must be an integer.`)
      }
      if (control.min !== undefined && value < control.min) {
        throw new ApiError(400, "COMFYUI_WORKFLOW_INPUT_INVALID", `'${control.label}' is below its minimum.`)
      }
      if (control.max !== undefined && value > control.max) {
        throw new ApiError(400, "COMFYUI_WORKFLOW_INPUT_INVALID", `'${control.label}' exceeds its maximum.`)
      }
      return value
    }
    case "boolean":
      if (typeof value !== "boolean") {
        throw new ApiError(400, "COMFYUI_WORKFLOW_INPUT_INVALID", `'${control.label}' must be true or false.`)
      }
      return value
    case "select":
      if (!control.options.some((option) => option === value)) {
        throw new ApiError(400, "COMFYUI_WORKFLOW_INPUT_INVALID", `'${control.label}' has an unavailable value.`)
      }
      return value
    case "json":
      if (control.serializedObjectOnly !== false && !isRecord(value)) {
        throw new ApiError(400, "COMFYUI_WORKFLOW_INPUT_INVALID", `'${control.label}' must be a JSON object.`)
      }
      JSON.stringify(value)
      return value
    case "image-list":
    case "media": {
      const paths = mediaPaths(value)
      const minCount = control.minCount ?? (control.required ? 1 : 0)
      const maxCount = control.maxCount ?? ("multiple" in control && control.multiple ? Number.MAX_SAFE_INTEGER : 1)
      if (paths.length < minCount || paths.length > maxCount) {
        throw new ApiError(
          400,
          "COMFYUI_WORKFLOW_MEDIA_COUNT_INVALID",
          `'${control.label}' requires ${minCount}${Number.isFinite(maxCount) ? `–${maxCount}` : "+"} file(s).`,
        )
      }
      return paths
    }
  }
}

function validatedValues(
  workflow: InternalComfyUIWorkflow,
  task: CinemaGenerationTask,
) {
  const controls = workflow.publicWorkflow.formSpec?.controls ?? []
  const allowed = new Set(controls.map((control) => control.key))
  const unknown = Object.keys(task.input.parameters).filter((key) => !allowed.has(key))
  if (unknown.length > 0) {
    throw new ApiError(
      400,
      "COMFYUI_WORKFLOW_INPUT_NOT_EXPOSED",
      `Task attempted to set inputs that APP mode does not expose: ${unknown.join(", ")}.`,
      { controlKeys: unknown },
    )
  }
  const textControls = controls.filter((control) => control.type === "prompt" || control.type === "text")
  const legacyPromptControlKey = textControls.length === 1 ? textControls[0]?.key : undefined
  const effectiveValues: Record<string, unknown> = Object.fromEntries(controls.flatMap((control) => (
    "defaultValue" in control && control.defaultValue !== undefined
      ? [[control.key, control.defaultValue]]
      : []
  )))
  Object.assign(effectiveValues, task.input.parameters)
  if (legacyPromptControlKey && task.input.prompt.trim() && effectiveValues[legacyPromptControlKey] === undefined) {
    effectiveValues[legacyPromptControlKey] = task.input.prompt
  }
  const values: Record<string, unknown> = {}
  for (const control of controls) {
    if (
      control.visibleWhen
      && !Object.entries(control.visibleWhen).every(([key, value]) => effectiveValues[key] === value)
    ) {
      continue
    }
    const raw = effectiveValues[control.key]
    const value = validateControlValue(control, raw)
    if (value !== undefined) values[control.key] = value
  }
  return values
}

function referenceForTask(task: CinemaGenerationTask) {
  const reference = taskReference(task)
  const endpoint = stringValue(reference.endpoint)
  const userID = stringValue(reference.userID) ?? null
  const promptID = stringValue(reference.promptID)
  if (!endpoint || !promptID) {
    throw new ApiError(500, "COMFYUI_TASK_REF_INVALID", "ComfyUI task reference is incomplete.")
  }
  return { reference, endpoint, userID, promptID }
}

function preparedReferenceForTask(task: CinemaGenerationTask) {
  const reference = taskReference(task)
  const endpoint = stringValue(reference.endpoint)
  const userID = stringValue(reference.userID) ?? null
  const requestID = stringValue(reference.requestID) ?? task.id
  if (!endpoint) {
    throw new ApiError(500, "COMFYUI_TASK_REF_INVALID", "ComfyUI task reference is incomplete.")
  }
  return { reference, endpoint, userID, requestID }
}

async function prepareComfyUITask(input: AdapterInput) {
  if (input.task.target.kind !== "workflow") {
    throw new ApiError(
      410,
      "COMFYUI_LEGACY_WORKFLOW_REMOVED",
      "The built-in ComfyUI workflow was removed; select a discovered APP mode workflow.",
    )
  }
  const { workflow, endpoint, userID } = await getInternalComfyUIWorkflow(
    input.task.target.workflowID,
    input.task.target.revision,
  )
  if (!userID) {
    throw new ApiError(409, "COMFYUI_USER_SELECTION_REQUIRED", "Select a ComfyUI user before submitting.")
  }
  const formSpec = workflow.publicWorkflow.formSpec
  const output = workflow.publicWorkflow.output
  if (!formSpec || !output || (output.kind !== "image" && output.kind !== "video")) {
    throw new ApiError(409, "COMFYUI_WORKFLOW_NOT_READY", "The selected workflow is not runnable.")
  }
  const values = validatedValues(workflow, input.task)
  const snapshot = await writeImmutableSnapshot(input.cinemaRoot, input.task.id, {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    taskID: input.task.id,
    workflowID: workflow.publicWorkflow.workflowID,
    revision: workflow.publicWorkflow.revision,
    outputKind: output.kind,
    outputNodeIDs: workflow.outputNodeIDs,
    uiWorkflow: workflow.uiWorkflow,
    apiPrompt: workflow.apiPrompt,
    bindings: workflow.bindings,
    controls: formSpec.controls,
    values,
  })
  const previous = taskReference(input.task)
  return taskUpdated(input.task, {
    status: "queued",
    error: null,
    errorCode: undefined,
    providerTaskRef: {
      ...previous,
      providerID: COMFYUI_PROVIDER_ID,
      endpoint,
      userID,
      requestID: stringValue(previous.requestID) ?? randomUUID(),
      ...(stringValue(previous.promptID) ? { promptID: stringValue(previous.promptID) } : {}),
      clientID: CLIENT_ID,
      workflowID: workflow.publicWorkflow.workflowID,
      revision: workflow.publicWorkflow.revision,
      snapshotDigest: snapshot.digest,
      outputKind: output.kind,
      outputNodeIDs: workflow.outputNodeIDs,
      submissionState: stringValue(previous.submissionState) ?? "prepared",
      missingPollCount: 0,
    },
    progress: progress("preparing", "Prepared an immutable ComfyUI APP workflow snapshot."),
  })
}

function safeProjectFile(root: string, relativePath: string) {
  if (!relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new ApiError(400, "COMFYUI_WORKFLOW_MEDIA_INVALID", "Workflow media must be a project-relative file.")
  }
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relativePath)
  const relative = path.relative(resolvedRoot, resolved)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError(400, "COMFYUI_WORKFLOW_MEDIA_INVALID", "Workflow media must stay inside the project.")
  }
  return { resolvedRoot, resolved }
}

function sniffMime(header: Uint8Array) {
  const ascii = Buffer.from(header).toString("ascii")
  if (header[0] === 0x89 && ascii.slice(1, 4) === "PNG") return "image/png"
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg"
  if (ascii.slice(0, 4) === "RIFF" && ascii.slice(8, 12) === "WEBP") return "image/webp"
  if (ascii.slice(0, 6) === "GIF87a" || ascii.slice(0, 6) === "GIF89a") return "image/gif"
  if (ascii.slice(4, 8) === "ftyp") {
    const brand = ascii.slice(8, 12)
    return brand === "qt  " ? "video/quicktime" : "video/mp4"
  }
  if (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) return "video/webm"
  if (ascii.slice(0, 4) === "fLaC") return "audio/flac"
  if (ascii.slice(0, 4) === "OggS") return "audio/ogg"
  if (ascii.slice(0, 4) === "RIFF" && ascii.slice(8, 12) === "WAVE") return "audio/wav"
  if (ascii.slice(0, 3) === "ID3" || (header[0] === 0xff && (header[1] ?? 0) >= 0xe0)) return "audio/mpeg"
  return undefined
}

type MediaControl = Extract<GenerationControl, { type: "media" | "image-list" }>

async function inspectProjectMedia(root: string, relativePath: string, control: MediaControl) {
  const { resolvedRoot, resolved } = safeProjectFile(root, relativePath)
  const info = await lstat(resolved).catch(() => undefined)
  if (!info?.isFile()) {
    throw new ApiError(400, "COMFYUI_WORKFLOW_MEDIA_INVALID", `'${control.label}' is not a project file.`)
  }
  const [realRoot, realFile] = await Promise.all([realpath(resolvedRoot), realpath(resolved)])
  const realRelative = path.relative(realRoot, realFile)
  if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new ApiError(400, "COMFYUI_WORKFLOW_MEDIA_INVALID", "Workflow media resolves outside the project.")
  }
  const maxBytes = Math.floor((control.maxFileSizeMB ?? 256) * 1024 * 1024)
  if (info.size <= 0 || info.size > maxBytes) {
    throw new ApiError(413, "COMFYUI_WORKFLOW_MEDIA_TOO_LARGE", `'${control.label}' exceeds its file-size limit.`)
  }
  const handle = await open(realFile, "r")
  const header = Buffer.alloc(16)
  try {
    await handle.read(header, 0, header.length, 0)
  } finally {
    await handle.close()
  }
  const mimeType = sniffMime(header)
  const expectedKind = control.type === "image-list" ? "image" : control.mediaKind
  if (!mimeType || !mimeType.startsWith(`${expectedKind}/`)) {
    throw new ApiError(415, "COMFYUI_WORKFLOW_MEDIA_UNSUPPORTED", `'${control.label}' has unsupported file content.`)
  }
  const supported = control.type === "image-list"
    ? control.supportedFormats
    : control.supportedMimeTypes
  if (supported?.length && !supported.some((value) => {
    const normalized = value.toLowerCase()
    return normalized === mimeType || normalized.replace(/^\./, "") === path.extname(realFile).slice(1).toLowerCase()
  })) {
    throw new ApiError(415, "COMFYUI_WORKFLOW_MEDIA_UNSUPPORTED", `'${control.label}' has an unsupported media type.`)
  }
  return { filepath: realFile, mimeType }
}

function safeComfyLeaf(value: string) {
  return Boolean(value)
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("\0")
}

function safeComfySubfolder(value: string) {
  if (!value) return true
  return !value.includes("\\")
    && !value.startsWith("/")
    && value.split("/").every((segment) => safeComfyLeaf(segment))
}

async function uploadMedia(
  input: AdapterInput,
  endpoint: string,
  userID: string | null,
  promptID: string,
  control: MediaControl,
  relativePath: string,
  index: number,
) {
  const media = await inspectProjectMedia(input.root, relativePath, control)
  const extension = EXTENSION_BY_MIME[media.mimeType]
  if (!extension) throw new ApiError(415, "COMFYUI_WORKFLOW_MEDIA_UNSUPPORTED", "Unsupported workflow media type.")
  const filename = `anybox_${promptID.replace(/[^A-Za-z0-9_-]/g, "_")}_${control.key.replace(/[^A-Za-z0-9_-]/g, "_")}_${index}${extension}`
  const form = new FormData()
  form.set("image", await openAsBlob(media.filepath, { type: media.mimeType }), filename)
  form.set("type", "input")
  form.set("overwrite", "true")
  const response = await fetchComfyUI(endpoint, "/upload/image", userID, {
    method: "POST",
    body: form,
  }, COMFYUI_SUBMIT_TIMEOUT_MS)
  if (!response.ok) {
    throw new ApiError(502, "COMFYUI_UPLOAD_FAILED", `ComfyUI media upload returned HTTP ${response.status}.`)
  }
  const value = await response.json().catch(() => undefined)
  if (!isRecord(value)) throw new ApiError(502, "COMFYUI_UPLOAD_INVALID", "ComfyUI returned an invalid upload response.")
  const uploadedName = stringValue(value.name)
  const subfolder = stringValue(value.subfolder) ?? ""
  const type = stringValue(value.type) ?? "input"
  if (!uploadedName || !safeComfyLeaf(uploadedName) || !safeComfySubfolder(subfolder) || type !== "input") {
    throw new ApiError(502, "COMFYUI_UPLOAD_INVALID", "ComfyUI returned an unsafe upload location.")
  }
  return subfolder ? `${subfolder}/${uploadedName}` : uploadedName
}

async function buildSubmittedPrompt(input: AdapterInput) {
  const snapshot = await readWorkflowSnapshot(input.cinemaRoot, input.task.id)
  const { endpoint, userID, requestID } = preparedReferenceForTask(input.task)
  const prompt = clonePrompt(snapshot.apiPrompt)
  for (const control of snapshot.controls) {
    const bindings = snapshot.bindings[control.key]
    if (!Array.isArray(bindings) || bindings.length === 0) {
      throw new ApiError(500, "COMFYUI_WORKFLOW_SNAPSHOT_INVALID", `Snapshot binding '${control.key}' is missing.`)
    }
    for (const binding of bindings) {
      const node = prompt[binding.nodeID]
      if (!node || !(binding.inputName in node.inputs)) {
        throw new ApiError(500, "COMFYUI_WORKFLOW_SNAPSHOT_INVALID", `Snapshot binding '${control.key}' is invalid.`)
      }
    }
  }
  for (const control of snapshot.controls) {
    const bindings = snapshot.bindings[control.key]!
    const value = snapshot.values[control.key]
    if (control.type === "media" || control.type === "image-list") {
      const paths = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
      const uploaded = await Promise.all(paths.map((mediaPath, index) =>
        uploadMedia(input, endpoint, userID, requestID, control, mediaPath, index)
      ))
      if (uploaded.length > 0) {
        for (const binding of bindings) {
          prompt[binding.nodeID]!.inputs[binding.inputName] =
            control.type === "media" && control.multiple ? uploaded : uploaded[0]
        }
      } else {
        for (const binding of bindings) delete prompt[binding.nodeID]!.inputs[binding.inputName]
      }
    } else if (value !== undefined) {
      for (const binding of bindings) {
        const transformed = binding.dynamicComboTemplates?.find((template) => template.option === value)
        const nodeInputs = prompt[binding.nodeID]!.inputs
        if (transformed) {
          for (const inputName of Object.keys(nodeInputs)) {
            if (inputName.startsWith(`${binding.inputName}.`)) delete nodeInputs[inputName]
          }
          Object.assign(nodeInputs, structuredClone(transformed.promptInputs))
        } else {
          nodeInputs[binding.inputName] = value
        }
      }
    }
  }
  const { digest: _baseDigest, ...snapshotWithoutDigest } = snapshot
  const submitted = await writeImmutableSnapshot(input.cinemaRoot, input.task.id, {
    ...snapshotWithoutDigest,
    apiPrompt: prompt,
  }, true)
  return { prompt, snapshot, submitted }
}

export async function buildComfyUIWorkflowForTest(input: AdapterInput) {
  const prepared = stringValue(taskReference(input.task).snapshotDigest)
    ? input.task
    : await prepareComfyUITask(input)
  return (await buildSubmittedPrompt({ ...input, task: prepared })).prompt
}

function queuePromptIDs(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (Array.isArray(entry)) return stringValue(entry[1]) ? [String(entry[1])] : []
    if (isRecord(entry)) {
      const id = stringValue(entry.prompt_id) ?? stringValue(entry.promptID)
      return id ? [id] : []
    }
    return []
  })
}

function anyboxTaskIDFromExtraData(value: unknown) {
  if (!isRecord(value) || !isRecord(value.anybox)) return undefined
  return stringValue(value.anybox.taskID)
}

function promptTupleIdentity(value: unknown) {
  if (Array.isArray(value)) {
    return {
      promptID: stringValue(value[1]),
      taskID: anyboxTaskIDFromExtraData(value[3]),
    }
  }
  if (isRecord(value)) {
    return {
      promptID: stringValue(value.prompt_id) ?? stringValue(value.promptID),
      taskID: anyboxTaskIDFromExtraData(value.extra_data ?? value.extraData),
    }
  }
  return {}
}

function remotePromptIDForTask(queueValue: unknown, historyValue: unknown, taskID: string) {
  const queue = isRecord(queueValue) ? queueValue : {}
  for (const collection of [queue.queue_running, queue.queue_pending]) {
    if (!Array.isArray(collection)) continue
    for (const entry of collection) {
      const identity = promptTupleIdentity(entry)
      if (identity.taskID === taskID && identity.promptID) return identity.promptID
    }
  }
  if (!isRecord(historyValue)) return undefined
  for (const [historyPromptID, rawHistory] of Object.entries(historyValue)) {
    if (!isRecord(rawHistory)) continue
    const identity = promptTupleIdentity(rawHistory.prompt)
    const directTaskID = anyboxTaskIDFromExtraData(rawHistory.extra_data ?? rawHistory.extraData)
    if (identity.taskID === taskID || directTaskID === taskID) {
      return identity.promptID ?? stringValue(historyPromptID)
    }
  }
  return undefined
}

async function findRemotePromptIDForTask(
  endpoint: string,
  userID: string | null,
  taskID: string,
) {
  const [queueValue, historyValue] = await Promise.all([
    requestComfyUIJSON(endpoint, "/queue", userID),
    requestComfyUIJSON(endpoint, "/history?max_items=200", userID),
  ])
  return remotePromptIDForTask(queueValue, historyValue, taskID)
}

function historyForPrompt(value: unknown, promptID: string) {
  if (!isRecord(value)) return undefined
  if (isRecord(value[promptID])) return value[promptID] as Record<string, unknown>
  if (stringValue(value.prompt_id) === promptID) return value
  return undefined
}

async function readRemoteState(endpoint: string, userID: string | null, promptID: string): Promise<RemoteState> {
  const [historyValue, queueValue] = await Promise.all([
    requestComfyUIJSON(endpoint, `/history/${encodeURIComponent(promptID)}`, userID),
    requestComfyUIJSON(endpoint, "/queue", userID),
  ])
  const queue = isRecord(queueValue) ? queueValue : {}
  return {
    history: historyForPrompt(historyValue, promptID),
    runningPromptIDs: queuePromptIDs(queue.queue_running),
    pendingPromptIDs: queuePromptIDs(queue.queue_pending),
  }
}

function historyMessages(history: Record<string, unknown>) {
  const status = isRecord(history.status) ? history.status : {}
  return Array.isArray(status.messages) ? status.messages : []
}

function historyHasMessage(history: Record<string, unknown>, names: string[]) {
  return historyMessages(history).some((message) => (
    Array.isArray(message) && typeof message[0] === "string" && names.includes(message[0])
  ))
}

function historyOutcome(history: Record<string, unknown>) {
  const status = isRecord(history.status) ? history.status : {}
  const statusText = stringValue(status.status_str)?.toLowerCase()
  if (historyHasMessage(history, ["execution_interrupted", "execution_cached_interrupted"])) return "interrupted" as const
  if (statusText === "error" || historyHasMessage(history, ["execution_error"])) return "failed" as const
  if ((statusText === "success" || isRecord(history.outputs)) && isRecord(history.outputs)) return "succeeded" as const
  return undefined
}

function outputDescriptors(history: Record<string, unknown>, nodeIDs: string[], outputKind: "image" | "video") {
  const outputs = isRecord(history.outputs) ? history.outputs : {}
  const collections = outputKind === "image" ? ["images"] : ["videos", "gifs", "images"]
  const descriptors: OutputDescriptor[] = []
  const seen = new Set<string>()
  for (const nodeID of nodeIDs) {
    const node = isRecord(outputs[nodeID]) ? outputs[nodeID] : undefined
    if (!node) continue
    for (const collection of collections) {
      const entries = Array.isArray(node[collection]) ? node[collection] : []
      for (const entry of entries) {
        if (!isRecord(entry)) continue
        const filename = stringValue(entry.filename)
        const subfolder = stringValue(entry.subfolder) ?? ""
        const type = stringValue(entry.type) ?? "output"
        if (!filename || !safeComfyLeaf(filename) || !safeComfySubfolder(subfolder) || type !== "output") continue
        const key = `${type}\0${subfolder}\0${filename}`
        if (seen.has(key)) continue
        seen.add(key)
        descriptors.push({ nodeID, collection, filename, subfolder, type: "output" })
      }
    }
  }
  return descriptors
}

function safeFileSegment(value: string) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "output"
}

async function ensureOutputDirectory(root: string, kind: "image" | "video", nodeID: string) {
  const rootInfo = await stat(root)
  if (!rootInfo.isDirectory()) throw new ApiError(500, "COMFYUI_OUTPUT_PATH_INVALID", "Project root is invalid.")
  const directory = path.join(root, "generated", `${kind}s`, safeFileSegment(nodeID))
  await mkdir(directory, { recursive: true })
  const [realRoot, realDirectory] = await Promise.all([realpath(root), realpath(directory)])
  const relative = path.relative(realRoot, realDirectory)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError(500, "COMFYUI_OUTPUT_PATH_INVALID", "Output directory must stay inside the project.")
  }
  return directory
}

function projectRelativePath(root: string, filepath: string) {
  return path.relative(root, filepath).split(path.sep).join("/")
}

function allowedBytes(kind: "image" | "video") {
  return kind === "image" ? COMFYUI_IMAGE_MAX_BYTES : COMFYUI_VIDEO_MAX_BYTES
}

async function existingOutputAsset(
  root: string,
  filepath: string,
  kind: "image" | "video",
  mimeType: string,
  id: string,
) {
  const info = await lstat(filepath).catch(() => undefined)
  if (!info) return undefined
  if (!info.isFile() || info.size <= 0 || info.size > allowedBytes(kind)) {
    throw new ApiError(500, "COMFYUI_OUTPUT_PATH_INVALID", "Existing ComfyUI output is invalid.")
  }
  return {
    id,
    kind,
    path: projectRelativePath(root, filepath),
    mimeType,
    sizeBytes: info.size,
  } satisfies CinemaGeneratedAsset
}

async function downloadOutput(
  input: AdapterInput,
  descriptor: OutputDescriptor,
  outputKind: "image" | "video",
  index: number,
) {
  const { endpoint, userID, promptID } = referenceForTask(input.task)
  const declaredMime = MIME_BY_EXTENSION[path.extname(descriptor.filename).toLowerCase()]
  if (!declaredMime || !declaredMime.startsWith(`${outputKind}/`)) {
    throw new ApiError(
      415,
      "COMFYUI_OUTPUT_INVALID",
      `ComfyUI returned a file that is not a supported ${outputKind}.`,
    )
  }
  const directory = await ensureOutputDirectory(input.root, outputKind, input.task.taskNodeID || input.task.id)
  const extension = EXTENSION_BY_MIME[declaredMime]!
  const assetID = `comfyui-${safeFileSegment(promptID)}-${index + 1}`
  const finalPath = path.join(directory, `${safeFileSegment(promptID)}-${index + 1}${extension}`)
  const existing = await existingOutputAsset(input.root, finalPath, outputKind, declaredMime, assetID)
  if (existing) return existing

  const url = urlForComfyUI(endpoint, "/view")
  url.searchParams.set("filename", descriptor.filename)
  if (descriptor.subfolder) url.searchParams.set("subfolder", descriptor.subfolder)
  url.searchParams.set("type", descriptor.type)
  let response: Response
  try {
    await assertComfyUIEndpointResolvesToLoopback(endpoint)
    response = await sameOriginFetch(url, {
      headers: userID ? { "Comfy-User": userID } : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(COMFYUI_DOWNLOAD_TIMEOUT_MS),
    })
  } catch (error) {
    if (isComfyUINetworkError(error)) throw new ApiError(503, "COMFYUI_OFFLINE", "Local ComfyUI is unavailable.")
    throw error
  }
  if (!response.ok) {
    throw new ApiError(502, "COMFYUI_OUTPUT_DOWNLOAD_FAILED", `ComfyUI output download returned HTTP ${response.status}.`)
  }
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
  if (!contentType || !contentType.startsWith(`${outputKind}/`) || EXTENSION_BY_MIME[contentType] !== extension) {
    throw new ApiError(415, "COMFYUI_OUTPUT_INVALID", "ComfyUI output MIME type does not match its filename.")
  }
  const maxBytes = allowedBytes(outputKind)
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(413, "COMFYUI_OUTPUT_TOO_LARGE", `ComfyUI ${outputKind} output exceeds its project limit.`)
  }
  if (!response.body) throw new ApiError(502, "COMFYUI_OUTPUT_EMPTY", "ComfyUI returned an empty output.")

  const temporaryPath = path.join(directory, `.${safeFileSegment(promptID)}-${index + 1}.part`)
  await rm(temporaryPath, { force: true }).catch(() => undefined)
  let sizeBytes = 0
  const header: Buffer[] = []
  let headerBytes = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.byteLength
      if (headerBytes < 16) {
        const needed = 16 - headerBytes
        header.push(chunk.subarray(0, needed))
        headerBytes += Math.min(needed, chunk.byteLength)
      }
      if (sizeBytes > maxBytes) {
        callback(new ApiError(413, "COMFYUI_OUTPUT_TOO_LARGE", `ComfyUI ${outputKind} output exceeds its project limit.`))
        return
      }
      callback(null, chunk)
    },
  })
  try {
    await pipeline(
      Readable.fromWeb(response.body as never),
      limiter,
      createWriteStream(temporaryPath, { flags: "wx" }),
    )
    if (sizeBytes <= 0) throw new ApiError(502, "COMFYUI_OUTPUT_EMPTY", "ComfyUI returned an empty output.")
    const sniffed = sniffMime(Buffer.concat(header))
    if (sniffed !== contentType) {
      throw new ApiError(415, "COMFYUI_OUTPUT_INVALID", "ComfyUI output content does not match its MIME type.")
    }
    if (Number.isFinite(declaredLength) && declaredLength >= 0 && declaredLength !== sizeBytes) {
      throw new ApiError(502, "COMFYUI_OUTPUT_INVALID", "ComfyUI output size did not match its response.")
    }
    const handle = await open(temporaryPath, "r+")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, finalPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
  return {
    id: assetID,
    kind: outputKind,
    path: projectRelativePath(input.root, finalPath),
    mimeType: contentType,
    sizeBytes,
  } satisfies CinemaGeneratedAsset
}

async function applyRemoteState(input: AdapterInput, state: RemoteState) {
  const { reference, promptID } = referenceForTask(input.task)
  const outcome = state.history ? historyOutcome(state.history) : undefined
  if (outcome === "interrupted") {
    const canceled = reference.cancelRequested === true
    return taskUpdated(input.task, {
      status: canceled ? "canceled" : "failed",
      errorCode: canceled ? undefined : "COMFYUI_EXECUTION_INTERRUPTED",
      error: canceled ? null : "Local ComfyUI interrupted the workflow.",
      providerTaskRef: { ...reference, submissionState: "terminal", missingPollCount: 0 },
      progress: progress(canceled ? "canceled" : "failed", canceled ? "ComfyUI task canceled." : "ComfyUI interrupted the workflow."),
    })
  }
  if (outcome === "failed") {
    return taskUpdated(failed(input.task, "COMFYUI_EXECUTION_FAILED", "Local ComfyUI failed to execute the workflow."), {
      providerTaskRef: { ...reference, submissionState: "terminal", missingPollCount: 0 },
    })
  }
  if (outcome === "succeeded" && state.history) {
    if (input.task.outputAssets.length > 0) {
      return taskUpdated(input.task, {
        status: "succeeded",
        error: null,
        errorCode: undefined,
        providerTaskRef: { ...reference, submissionState: "terminal", missingPollCount: 0 },
        progress: progress("succeeded", "Local ComfyUI generation completed.", 100),
      })
    }
    const snapshot = await readWorkflowSnapshot(input.cinemaRoot, input.task.id)
    const descriptors = outputDescriptors(state.history, snapshot.outputNodeIDs, snapshot.outputKind)
    if (descriptors.length === 0) {
      return taskUpdated(
        failed(input.task, "COMFYUI_OUTPUT_INVALID", "ComfyUI completed without a supported selected APP mode output."),
        { providerTaskRef: { ...reference, submissionState: "terminal", missingPollCount: 0 } },
      )
    }
    const finalizing = taskUpdated(input.task, {
      status: "running",
      error: null,
      errorCode: undefined,
      progress: progress("finalizing", `Finalizing ${descriptors.length} ComfyUI output(s).`),
    })
    await input.persistTask?.(finalizing)
    try {
      const assets: CinemaGeneratedAsset[] = []
      for (const [index, descriptor] of descriptors.entries()) {
        assets.push(await downloadOutput({ ...input, task: finalizing }, descriptor, snapshot.outputKind, index))
      }
      return taskUpdated(finalizing, {
        status: "succeeded",
        outputAssets: assets,
        error: null,
        errorCode: undefined,
        providerTaskRef: { ...reference, submissionState: "terminal", missingPollCount: 0 },
        progress: progress("succeeded", `Downloaded ${assets.length} ComfyUI output(s).`, 100),
      })
    } catch (error) {
      if (error instanceof ApiError && error.code === "COMFYUI_OFFLINE") {
        return taskUpdated(finalizing, {
          progress: progress("finalizing", "Waiting for Local ComfyUI to resume output finalization."),
        })
      }
      return taskUpdated(
        failed(
          finalizing,
          error instanceof ApiError ? error.code : "COMFYUI_OUTPUT_DOWNLOAD_FAILED",
          safeErrorMessage(error, "Failed to download the ComfyUI output."),
        ),
        { providerTaskRef: { ...reference, submissionState: "terminal", missingPollCount: 0 } },
      )
    }
  }
  if (state.runningPromptIDs.includes(promptID)) {
    return taskUpdated(input.task, {
      status: "running",
      error: null,
      errorCode: undefined,
      providerTaskRef: { ...reference, submissionState: "submitted", missingPollCount: 0 },
      progress: progress("processing", "Local ComfyUI is processing the workflow."),
    })
  }
  if (state.pendingPromptIDs.includes(promptID)) {
    return taskUpdated(input.task, {
      status: "queued",
      error: null,
      errorCode: undefined,
      providerTaskRef: { ...reference, submissionState: "submitted", missingPollCount: 0 },
      progress: progress("queued", "Queued in Local ComfyUI."),
    })
  }
  return undefined
}

async function submitComfyUITask(input: AdapterInput) {
  const { endpoint, userID } = preparedReferenceForTask(input.task)
  using _lock = await Lock.write(`cinema-comfyui-endpoint:${endpoint}`)
  let working = input.task
  let reference = taskReference(working)
  let promptID = stringValue(reference.promptID)
  if (!promptID) {
    promptID = await findRemotePromptIDForTask(endpoint, userID, input.task.id)
    if (promptID) {
      working = taskUpdated(working, {
        providerTaskRef: {
          ...reference,
          promptID,
          submissionState: "submitted",
          missingPollCount: 0,
        },
        progress: progress("queued", "Recovered the submitted ComfyUI prompt."),
      })
      reference = taskReference(working)
      await input.persistTask?.(working)
    }
  }
  if (promptID) {
    const existing = await readRemoteState(endpoint, userID, promptID)
    const reconciled = await applyRemoteState({ ...input, task: working }, existing)
    if (reconciled) return reconciled
    return taskUpdated(working, {
      providerTaskRef: {
        ...reference,
        submissionState: "submitted",
        missingPollCount: Math.max(0, Number(reference.missingPollCount) || 0),
      },
      progress: progress("queued", "Waiting for Local ComfyUI to report the submitted prompt."),
    })
  }

  const uploading = taskUpdated(working, {
    status: "queued",
    progress: progress("preparing", "Uploading APP mode media and binding exposed inputs."),
  })
  await input.persistTask?.(uploading)
  const { prompt, snapshot, submitted } = await buildSubmittedPrompt({ ...input, task: uploading })
  const submitting = taskUpdated(uploading, {
    providerTaskRef: {
      ...taskReference(uploading),
      submittedSnapshotDigest: submitted.digest,
      submissionState: "submitting",
    },
    progress: progress("submitted", "Submitting the APP workflow to Local ComfyUI."),
  })
  await input.persistTask?.(submitting)
  try {
    const submission = await requestComfyUIJSON(endpoint, "/prompt", userID, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        client_id: CLIENT_ID,
        extra_data: {
          extra_pnginfo: {
            workflow: snapshot.uiWorkflow,
          },
          anybox: {
            taskID: input.task.id,
            projectID: input.task.projectID,
            workflowID: snapshot.workflowID,
            revision: snapshot.revision,
          },
        },
      }),
    }, COMFYUI_SUBMIT_TIMEOUT_MS)
    const submittedPromptID = isRecord(submission) ? stringValue(submission.prompt_id) : undefined
    const nodeErrors = isRecord(submission) && isRecord(submission.node_errors)
      ? Object.keys(submission.node_errors)
      : []
    if (!submittedPromptID || nodeErrors.length > 0) {
      const rejection = comfyUISubmissionErrorSummary(submission)
      throw new ApiError(
        502,
        "COMFYUI_WORKFLOW_INCOMPATIBLE",
        rejection
          ? `Local ComfyUI rejected the saved APP workflow: ${rejection}`
          : "Local ComfyUI rejected the saved APP workflow.",
        { nodeErrors, ...(rejection ? { validation: rejection } : {}) },
      )
    }
    const accepted = taskUpdated(submitting, {
      status: "queued",
      error: null,
      errorCode: undefined,
      providerTaskRef: {
        ...taskReference(submitting),
        promptID: submittedPromptID,
        submissionState: "submitted",
        missingPollCount: 0,
      },
      progress: progress("queued", "Queued in Local ComfyUI."),
    })
    await input.persistTask?.(accepted)
    return accepted
  } catch (error) {
    if (error instanceof ApiError && error.code === "COMFYUI_OFFLINE") {
      return taskUpdated(submitting, {
        status: "queued",
        progress: progress("queued", "Waiting for Local ComfyUI to become available."),
      })
    }
    return failed(
      submitting,
      error instanceof ApiError ? error.code : "COMFYUI_SUBMIT_FAILED",
      safeErrorMessage(error, "Local ComfyUI rejected the workflow."),
    )
  }
}

async function createComfyUITask(input: AdapterInput) {
  if (input.task.target.kind !== "workflow") {
    return failed(
      input.task,
      "COMFYUI_LEGACY_WORKFLOW_REMOVED",
      "The built-in ComfyUI workflow was removed; select a discovered APP mode workflow.",
    )
  }
  const prepared = stringValue(taskReference(input.task).snapshotDigest)
    ? input.task
    : await prepareComfyUITask(input)
  try {
    return await submitComfyUITask({ ...input, task: prepared })
  } catch (error) {
    if (error instanceof ApiError && error.code === "COMFYUI_OFFLINE") {
      return taskUpdated(prepared, {
        status: "queued",
        progress: progress("queued", "Waiting for Local ComfyUI to become available."),
      })
    }
    return failed(
      prepared,
      error instanceof ApiError ? error.code : "COMFYUI_SUBMIT_FAILED",
      safeErrorMessage(error, "Failed to submit the Local ComfyUI task."),
    )
  }
}

async function refreshComfyUITask(input: AdapterInput) {
  if (["succeeded", "failed", "canceled"].includes(input.task.status)) return input.task
  if (input.task.target.kind !== "workflow") {
    return failed(
      input.task,
      "COMFYUI_LEGACY_WORKFLOW_REMOVED",
      "The built-in ComfyUI workflow was removed; select a discovered APP mode workflow.",
    )
  }
  const prepared = stringValue(taskReference(input.task).snapshotDigest)
    ? input.task
    : await prepareComfyUITask(input)
  if (!stringValue(taskReference(prepared).promptID)) {
    return await createComfyUITask({ ...input, task: prepared })
  }
  const { endpoint, userID, promptID, reference } = referenceForTask(prepared)
  try {
    const state = await readRemoteState(endpoint, userID, promptID)
    const reconciled = await applyRemoteState({ ...input, task: prepared }, state)
    if (reconciled) return reconciled
    const missingPollCount = Math.max(0, Number(reference.missingPollCount) || 0) + 1
    if (missingPollCount >= COMFYUI_TASK_MISSING_LIMIT) {
      return taskUpdated(
        failed(prepared, "COMFYUI_TASK_LOST", "Local ComfyUI no longer reports this generation task."),
        { providerTaskRef: { ...reference, submissionState: "terminal", missingPollCount } },
      )
    }
    return taskUpdated(prepared, {
      providerTaskRef: { ...reference, missingPollCount },
      progress: progress("queued", "Waiting for Local ComfyUI to report the task."),
    })
  } catch (error) {
    if (error instanceof ApiError && error.code === "COMFYUI_OFFLINE") {
      return taskUpdated(prepared, {
        error: null,
        errorCode: undefined,
        progress: progress(
          prepared.status === "running" ? "processing" : "queued",
          "Waiting for Local ComfyUI to reconnect.",
        ),
      })
    }
    return failed(
      prepared,
      error instanceof ApiError ? error.code : "COMFYUI_REFRESH_FAILED",
      safeErrorMessage(error, "Failed to refresh the Local ComfyUI task."),
    )
  }
}

function canceledTask(task: CinemaGenerationTask) {
  return taskUpdated(task, {
    status: "canceled",
    error: null,
    errorCode: undefined,
    providerTaskRef: {
      ...taskReference(task),
      cancelRequested: true,
      submissionState: "terminal",
    },
    progress: progress("canceled", "Local ComfyUI task canceled."),
  })
}

async function cancelComfyUITask(input: AdapterInput) {
  if (["succeeded", "failed", "canceled"].includes(input.task.status)) return input.task
  if (input.task.target.kind !== "workflow") return canceledTask(input.task)
  let prepared = stringValue(taskReference(input.task).snapshotDigest)
    ? input.task
    : await prepareComfyUITask(input)
  const baseReference = preparedReferenceForTask(prepared)
  const { endpoint, userID } = baseReference
  using _lock = await Lock.write(`cinema-comfyui-endpoint:${endpoint}`)
  if (!stringValue(taskReference(prepared).promptID)) {
    const recoveredPromptID = await findRemotePromptIDForTask(endpoint, userID, prepared.id)
    if (!recoveredPromptID) return canceledTask(prepared)
    prepared = taskUpdated(prepared, {
      providerTaskRef: {
        ...taskReference(prepared),
        promptID: recoveredPromptID,
        submissionState: "submitted",
        missingPollCount: 0,
      },
    })
    await input.persistTask?.(prepared)
  }
  const { promptID, reference } = referenceForTask(prepared)
  let state: RemoteState
  try {
    state = await readRemoteState(endpoint, userID, promptID)
  } catch (error) {
    if (error instanceof ApiError && error.code === "COMFYUI_OFFLINE") {
      throw new ApiError(503, "COMFYUI_OFFLINE", "Local ComfyUI is offline; the task was not canceled.")
    }
    throw error
  }
  const reconciled = await applyRemoteState({ ...input, task: prepared }, state)
  if (state.history && reconciled && ["succeeded", "failed", "canceled"].includes(reconciled.status)) {
    return reconciled
  }
  if (state.pendingPromptIDs.includes(promptID)) {
    await requestComfyUIJSON(endpoint, "/queue", userID, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ delete: [promptID] }),
    })
    const confirmed = await readRemoteState(endpoint, userID, promptID)
    if (confirmed.pendingPromptIDs.includes(promptID) || confirmed.runningPromptIDs.includes(promptID)) {
      throw new ApiError(409, "COMFYUI_CANCEL_CONFLICT", "Local ComfyUI did not confirm queue removal.")
    }
    return canceledTask(prepared)
  }
  if (state.runningPromptIDs.includes(promptID)) {
    const current = await readRemoteState(endpoint, userID, promptID)
    if (current.runningPromptIDs.length !== 1 || current.runningPromptIDs[0] !== promptID) {
      throw new ApiError(
        409,
        "COMFYUI_CANCEL_CONFLICT",
        "ComfyUI reports a different or ambiguous running prompt, so Anybox did not issue a global interrupt.",
      )
    }
    const cancelRequested = taskUpdated(prepared, {
      providerTaskRef: { ...reference, cancelRequested: true },
      progress: progress("processing", "Cancel requested from Local ComfyUI."),
    })
    await input.persistTask?.(cancelRequested)
    await requestComfyUIJSON(endpoint, "/interrupt", userID, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const confirmed = await readRemoteState(endpoint, userID, promptID)
      const terminal = await applyRemoteState({ ...input, task: cancelRequested }, confirmed)
      if (terminal && ["succeeded", "failed", "canceled"].includes(terminal.status)) return terminal
    }
    return cancelRequested
  }
  if (stringValue(reference.submissionState) === "prepared") return canceledTask(prepared)
  throw new ApiError(409, "COMFYUI_CANCEL_CONFLICT", "Local ComfyUI no longer reports this task.")
}

export type ComfyUIConnectionTestResult = {
  ok: boolean
  status: "ready" | "offline" | "incompatible"
  message: string
  errorCode?: string
  diagnostics?: Record<string, unknown>
}

export async function testComfyUIConnection(
  input: { baseURL?: string | null; userID?: string | null } = {},
): Promise<ComfyUIConnectionTestResult> {
  let baseURL: string
  try {
    baseURL = validateComfyUIBaseURL(input.baseURL)
  } catch (error) {
    return {
      ok: false,
      status: "incompatible",
      message: error instanceof Error ? error.message : "ComfyUI endpoint is invalid.",
      errorCode: error instanceof ApiError ? error.code : "COMFYUI_BASE_URL_INVALID",
    }
  }
  try {
    const catalog = await refreshComfyUIWorkflowCatalog({
      baseURL,
      userID: input.userID,
    })
    const selectionIssue = catalog.issues.find((issue) => issue.code === "COMFYUI_USER_SELECTION_REQUIRED")
    if (selectionIssue) {
      return {
        ok: false,
        status: "incompatible",
        message: selectionIssue.message,
        errorCode: selectionIssue.code,
        diagnostics: {
          service: "reachable",
          userData: "selection_required",
          nodes: "ready",
          workflowDiscovery: "ready",
          users: catalog.users,
        },
      }
    }
    if (catalog.status !== "ready") {
      return {
        ok: false,
        status: catalog.status === "offline" ? "offline" : "incompatible",
        message: catalog.issues[0]?.message ?? "ComfyUI workflow discovery failed.",
        errorCode: catalog.issues[0]?.code ?? "COMFYUI_WORKFLOW_REFRESH_FAILED",
        diagnostics: {
          service: catalog.status === "offline" ? "unreachable" : "reachable",
          workflowDiscovery: catalog.status,
        },
      }
    }
    const ready = catalog.workflows.filter((workflow) => workflow.status === "ready").length
    return {
      ok: true,
      status: "ready",
      message: `Local ComfyUI is reachable; discovered ${catalog.workflows.length} workflow(s), ${ready} ready.`,
      diagnostics: {
        service: "reachable",
        userData: "ready",
        nodes: "ready",
        workflowDiscovery: "ready",
        userID: catalog.userID,
        users: catalog.users,
        workflows: catalog.workflows.length,
        readyWorkflows: ready,
      },
    }
  } catch (error) {
    const offline = error instanceof ApiError && error.code === "COMFYUI_OFFLINE"
    return {
      ok: false,
      status: offline ? "offline" : "incompatible",
      message: safeErrorMessage(error, "ComfyUI connection test failed."),
      errorCode: error instanceof ApiError ? error.code : "COMFYUI_READINESS_CHECK_FAILED",
      diagnostics: {
        service: offline ? "unreachable" : "unknown",
        userData: "unchecked",
        nodes: "unchecked",
        workflowDiscovery: "unchecked",
      },
    }
  }
}

export function clearComfyUIProfileCacheForTest() {
  clearComfyUIWorkflowCatalogForTest()
}

export const ComfyUIProviderAdapter = {
  manifest: {} as CinemaVideoProviderManifest,
  supportedModes: ["text-to-image", "text-to-video"] as readonly CinemaProviderModelMode[],
  supportsInputCombination: () => false,
  validateBaseURL: validateComfyUIBaseURL,
  testConnection: testComfyUIConnection,
  listWorkflows: getComfyUIWorkflowCatalog,
  refreshWorkflows: refreshComfyUIWorkflowCatalog,
  prepareTask: prepareComfyUITask,
  createTask: createComfyUITask,
  refreshTask: refreshComfyUITask,
  cancelTask: cancelComfyUITask,
}
