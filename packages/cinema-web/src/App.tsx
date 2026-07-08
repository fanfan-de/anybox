import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type MouseEvent as ReactMouseEvent } from "react"
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { create } from "zustand"
import {
  ArrowLeft,
  ArrowUp,
  Bot,
  Braces,
  ChevronDown,
  Code2,
  Copy,
  Download,
  File,
  FileText,
  Film,
  Folder,
  Image,
  KeyRound,
  Loader2,
  MessageSquareText,
  Music,
  PencilLine,
  Play,
  RefreshCw,
  Server,
  Scissors,
  Trash2,
  Upload,
  Video,
  WandSparkles,
  X,
} from "lucide-react"
import {
  type CinemaCommand,
  type CinemaCommandResult,
  type CinemaCustomApiAuthState,
  type CinemaCustomNodeDefinition,
  type CinemaCustomApiRunResult,
  type CinemaEventsResult,
  type CinemaCanvasDocument,
  type CinemaCanvasNode,
  type CinemaGenerationMode,
  type CinemaGenerationProgress,
  type CinemaGenerationTask,
  type CinemaGeneratedAsset,
  type CinemaImageGenerationResult,
  type CinemaImportedImageAssetResult,
  type CinemaImageModel,
  type CinemaImageModelsResult,
  type CinemaTextGenerationResult,
  type CinemaTextModel,
  type CinemaTextModelsResult,
  type CinemaNodeType,
  type CinemaProviderEndpoint,
  type CinemaProjectDirectoryEntry,
  type CinemaProjectDirectoryListing,
  type CinemaProjectSummary,
  type CinemaVideoProvider,
  type CreateCinemaGenerationTaskBody,
} from "@anybox/shared/cinema"

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error"
type CanvasPanel = "files"

type ImageGenerationRequest = {
  prompt: string
  userPrompt?: string
  model: string | null
  size?: string
  count?: number
  style?: string
  sourceNodeIDs?: string[]
  sourceTextPrompts?: string[]
  sourceImageAssetID?: string
  sourceImageAssetIDs?: string[]
  sourceImagePath?: string
  sourceImagePaths?: string[]
}
type TextGenerationRequest = {
  prompt: string
  model: string | null
  sourceImageAssetID?: string
  sourceImageAssetIDs?: string[]
  sourceImagePath?: string
  sourceImagePaths?: string[]
}
type CustomApiRunMode = "preview" | "run"
type CustomApiRunRequest = {
  inputValues?: Record<string, unknown>
  mode?: CustomApiRunMode
}
type CustomApiAuthSaveRequest = {
  apiKey: string | null
}
type CustomNodeDefinitionSaveRequest = {
  title: string
  rawData: Record<string, unknown>
}

type VideoSourceImageAsset = CinemaGeneratedAsset & {
  nodeID: string
  nodeTitle: string
  edgeID?: string
  slot?: VideoInputSlot
}

type SourceTextParameter = {
  edgeID: string
  nodeID: string
  nodeTitle: string
  text: string
}

type VideoInputSlot =
  | "textParameter"
  | "sourceImage"
  | "startFrame"
  | "endFrame"
  | "referenceImage"
  | "sourceVideo"
  | "mask"
type VideoMediaInputSlot = Exclude<VideoInputSlot, "textParameter">
type VideoImageInputSlot = Extract<VideoInputSlot, "sourceImage" | "startFrame" | "endFrame" | "referenceImage" | "mask">
type VideoImageInputAssetValue = VideoSourceImageAsset | VideoSourceImageAsset[] | null
type VideoInputAssetValue = VideoSourceImageAsset | VideoSourceImageAsset[] | null
type VideoImageInputAssets = Partial<Record<VideoImageInputSlot, VideoImageInputAssetValue>>
type VideoInputAssets = Partial<Record<VideoMediaInputSlot, VideoInputAssetValue>>
type VideoInputAssetMap = Record<string, VideoInputAssetValue>

type VideoModeInputContract = {
  mode: CinemaGenerationMode
  label: string
  promptPlaceholder: string
  inputs: VideoInputControl[]
  unsupportedRequiredInputs: VideoInputControl[]
}

type VideoInputControl = {
  inputKey: string
  role: string
  modality: string
  required: boolean
  minCount: number
  maxCount?: number
  note?: string
  slot: VideoInputSlot | null
  label: string
  emptyText: string
}

type VideoProviderModel = CinemaVideoProvider["manifest"]["models"][number]
type VideoProviderInputCombination = VideoProviderModel["inputCombinations"][number]

type CinemaFlowNodeData = {
  cinemaType: CinemaNodeType
  title: string
  rawData: Record<string, unknown>
  size?: {
    width: number
    height: number
  }
  onChangeRawData?: (nodeID: string, rawData: Record<string, unknown>) => void
  onChangeTitle?: (nodeID: string, title: string) => void
  onDeleteNode?: (nodeID: string) => void
  textModels?: CinemaTextModel[]
  effectiveTextModel?: CinemaTextModel | null
  isGeneratingText?: boolean
  textGenerationError?: string | null
  sourceImageAssets?: VideoSourceImageAsset[]
  onGenerateText?: (nodeID: string, request: TextGenerationRequest) => void
  imageModels?: CinemaImageModel[]
  effectiveImageModel?: CinemaImageModel | null
  isGeneratingImage?: boolean
  imageGenerationError?: string | null
  sourceTextParameters?: SourceTextParameter[]
  agentBaseURL?: string
  projectID?: string
  onDisconnectEdge?: (edgeID: string) => void
  onGenerateImage?: (nodeID: string, request: ImageGenerationRequest) => void
  videoProviders?: CinemaVideoProvider[]
  generationTasks?: CinemaGenerationTask[]
  sourceImageAsset?: VideoSourceImageAsset | null
  videoInputImageAssets?: VideoImageInputAssets
  videoInputAssets?: VideoInputAssets
  videoInputAssetsByInputKey?: VideoInputAssetMap
  videoInputAssetsByRole?: VideoInputAssetMap
  isCreatingVideoTask?: boolean
  videoGenerationError?: string | null
  onCreateVideoGenerationTask?: (nodeID: string, body: CreateCinemaGenerationTaskBody) => void
  isRunningCustomApi?: boolean
  customApiError?: string | null
  onRunCustomApi?: (nodeID: string, request: CustomApiRunRequest) => Promise<CinemaCustomApiRunResult | undefined>
  onSaveCustomApiKey?: (nodeID: string, request: CustomApiAuthSaveRequest) => Promise<CinemaCustomApiAuthState | undefined>
  onSaveCustomNodeDefinition?: (nodeID: string, request: CustomNodeDefinitionSaveRequest) => Promise<CinemaCustomNodeDefinition | undefined>
}

type CinemaFlowNode = Node<CinemaFlowNodeData, "cinemaNode">
type CinemaNodePatch = Extract<CinemaCommand, { type: "update-node" }>["patch"]
type ContextMenuState = {
  x: number
  y: number
  flowX: number
  flowY: number
} | null
type DisplayAsset = {
  id: string
  kind: string
  path: string
}

type UiState = {
  selectedNodeID: string | null
  setSelectedNodeID: (nodeID: string | null) => void
}

const useUiStore = create<UiState>((set) => ({
  selectedNodeID: null,
  setSelectedNodeID: (nodeID) => set({ selectedNodeID: nodeID }),
}))

const NODE_TYPES = [
  "text",
  "prompt",
  "image",
  "video",
  "audio",
  "shot",
  "agent",
  "generation-task",
  "output",
] as const satisfies readonly CinemaNodeType[]

const FALLBACK_GENERATION_MODE: CinemaGenerationMode = "text-to-video"
const DEFAULT_IMAGE_GENERATION_SIZE = "1024x1024"
const DEFAULT_IMAGE_GENERATION_COUNT = 1
const DEFAULT_VIDEO_ASPECT_RATIO = "16:9"
const DEFAULT_VIDEO_DURATION_SECONDS = 5
const DEFAULT_VIDEO_RESOLUTION = "720p"
const FALLBACK_VIDEO_INPUT_COMBINATION_MODE: CinemaGenerationMode = "text-to-video"
const LOCAL_IMAGE_FILE_ACCEPT = [
  "image/apng",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
].join(",")
const VIDEO_INPUT_SLOTS = [
  "textParameter",
  "sourceImage",
  "startFrame",
  "endFrame",
  "referenceImage",
  "sourceVideo",
  "mask",
] as const satisfies readonly VideoInputSlot[]
const VIDEO_IMAGE_INPUT_SLOTS = [
  "sourceImage",
  "startFrame",
  "endFrame",
  "referenceImage",
  "mask",
] as const satisfies readonly VideoImageInputSlot[]
const VIDEO_INPUT_SLOT_LABELS: Record<VideoInputSlot, string> = {
  textParameter: "文本参数",
  sourceImage: "参考图",
  startFrame: "首帧",
  endFrame: "尾帧",
  referenceImage: "参考图",
  sourceVideo: "源视频",
  mask: "蒙版",
}
const VIDEO_INPUT_SLOT_EMPTY_TEXT: Record<VideoInputSlot, string> = {
  textParameter: "连接文本节点作为参数",
  sourceImage: "连接图片节点或图片生成节点",
  startFrame: "导入或连接首帧图片",
  endFrame: "导入或连接尾帧图片",
  referenceImage: "连接参考图片",
  sourceVideo: "连接视频节点",
  mask: "连接蒙版素材",
}
const VIDEO_LOCAL_IMAGE_INPUT_SLOTS = [
  "startFrame",
  "endFrame",
] as const satisfies readonly VideoImageInputSlot[]

const DEFAULT_NODE_SIZE: Record<CinemaNodeType, { width: number; height: number }> = {
  text: { width: 380, height: 240 },
  prompt: { width: 380, height: 240 },
  image: { width: 420, height: 440 },
  "local-image": { width: 340, height: 320 },
  video: { width: 520, height: 560 },
  audio: { width: 320, height: 180 },
  shot: { width: 380, height: 250 },
  agent: { width: 360, height: 220 },
  "custom-api": { width: 540, height: 600 },
  "custom-node": { width: 540, height: 600 },
  "generation-task": { width: 390, height: 240 },
  output: { width: 360, height: 220 },
}

const NODE_META: Record<CinemaNodeType, {
  label: string
  accent: string
  icon: typeof FileText
  placeholder: string
}> = {
  text: {
    label: "Text",
    accent: "#67e8f9",
    icon: FileText,
    placeholder: "Story note, idea, or narration text.",
  },
  prompt: {
    label: "Prompt",
    accent: "#a7f3d0",
    icon: MessageSquareText,
    placeholder: "Prompt draft or reusable generation instruction.",
  },
  image: {
    label: "Image Gen",
    accent: "#f9a8d4",
    icon: Image,
    placeholder: "Describe the image you want to generate.",
  },
  "local-image": {
    label: "Image",
    accent: "#fde68a",
    icon: Image,
    placeholder: "Imported local image.",
  },
  video: {
    label: "Video",
    accent: "#93c5fd",
    icon: Video,
    placeholder: "Generated clip or source footage placeholder.",
  },
  audio: {
    label: "Audio",
    accent: "#c4b5fd",
    icon: Music,
    placeholder: "Voice, music, or sound design placeholder.",
  },
  shot: {
    label: "Shot",
    accent: "#fcd34d",
    icon: Film,
    placeholder: "Shot description, duration, and visual intent.",
  },
  agent: {
    label: "Agent",
    accent: "#fdba74",
    icon: Bot,
    placeholder: "AnyBox Agent task placeholder.",
  },
  "custom-api": {
    label: "Custom API",
    accent: "#5eead4",
    icon: Server,
    placeholder: "Configure a JSON POST endpoint.",
  },
  "custom-node": {
    label: "Custom Node",
    accent: "#5eead4",
    icon: Braces,
    placeholder: "Define a reusable JSON POST node.",
  },
  "generation-task": {
    label: "Generation",
    accent: "#86efac",
    icon: WandSparkles,
    placeholder: "Provider/model task placeholder. No API call in V1.",
  },
  output: {
    label: "Output",
    accent: "#fca5a5",
    icon: Scissors,
    placeholder: "Preview render, selected clip, or final export.",
  },
}

function readSearchParams() {
  const params = new URLSearchParams(window.location.search)
  return {
    projectID: params.get("projectID")?.trim() || "",
    agentBaseURL: params.get("agentBaseURL")?.trim().replace(/\/$/, "") || window.location.origin,
  }
}

async function requestJson<T>(baseURL: string, pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(pathname, baseURL), init)
  const envelope = await response.json().catch(() => null) as
    | { success: true; data: T }
    | { success: false; error?: { message?: string } }
    | null

  if (!response.ok || !envelope || envelope.success !== true) {
    const message = envelope && envelope.success === false && envelope.error?.message
      ? envelope.error.message
      : `Request failed (${response.status})`
    throw new Error(message)
  }

  return envelope.data
}

function nodeSize(node: CinemaCanvasNode) {
  if (node.type === "text") return DEFAULT_NODE_SIZE.text
  return node.size ?? DEFAULT_NODE_SIZE[node.type]
}

function flowNodeStyle(type: CinemaNodeType, size: { width: number; height: number }): CSSProperties {
  return type === "image" || type === "local-image"
    ? { width: size.width }
    : { width: size.width, height: size.height }
}

function toFlowNodes(canvas: CinemaCanvasDocument): CinemaFlowNode[] {
  return canvas.nodes.map((node) => {
    const size = nodeSize(node)
    return {
      id: node.id,
      type: "cinemaNode",
      position: node.position,
      style: flowNodeStyle(node.type, size),
      data: {
        cinemaType: node.type,
        title: node.title,
        rawData: node.data ?? {},
        size,
      },
    }
  })
}

function toCanvasNode(node: CinemaFlowNode): CinemaCanvasNode {
  const width = typeof node.style?.width === "number"
    ? node.style.width
    : node.measured?.width ?? node.data.size?.width ?? DEFAULT_NODE_SIZE[node.data.cinemaType].width
  const height = typeof node.style?.height === "number"
    ? node.style.height
    : node.measured?.height ?? node.data.size?.height ?? DEFAULT_NODE_SIZE[node.data.cinemaType].height

  return {
    id: node.id,
    type: node.data.cinemaType,
    title: node.data.title.trim() || "Untitled Node",
    position: node.position,
    size: { width, height },
    data: node.data.rawData,
  }
}

function makeNodeID(type: CinemaNodeType) {
  return `node-${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function makeCommandID(type: CinemaCommand["type"]) {
  return `cmd-${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function titleForType(type: CinemaNodeType) {
  return `${NODE_META[type].label} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
}

function readRawString(rawData: Record<string, unknown>, key: string, fallback = "") {
  const value = rawData[key]
  return typeof value === "string" ? value : fallback
}

function readRawStringArray(rawData: Record<string, unknown>, key: string) {
  const value = rawData[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function readRawNumber(rawData: Record<string, unknown>, key: string, fallback: number) {
  const value = rawData[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function readRawRecord(rawData: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = rawData[key]
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}

function parseJsonObjectDraft(value: string, fallback: Record<string, unknown>) {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : fallback
  } catch {
    return fallback
  }
}

function customApiCredentialProviderID(nodeID: string) {
  return `cinema-custom-api-${nodeID}`
}

function makeCustomNodeDefinitionID(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "custom-node"
  return `custom-node-def-${slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function normalizeCustomApiAuthType(value: unknown): "none" | "bearer" | "api-key-header" {
  return value === "bearer" || value === "api-key-header" ? value : "none"
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") result[key] = item
  }
  return result
}

function customNodeDefinitionFromRawData(input: {
  definitionID: string
  title: string
  rawData: Record<string, unknown>
  existing?: CinemaCustomNodeDefinition
}): CinemaCustomNodeDefinition {
  const now = new Date().toISOString()
  const request = readRawRecord(input.rawData, "request")
  const auth = readRawRecord(input.rawData, "auth")
  const outputMapping = readStringRecord(input.rawData.outputMapping)
  const inputSchema = readRawRecord(input.rawData, "inputSchema")
  const authType = normalizeCustomApiAuthType(auth.type)
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined
  return {
    id: input.definitionID,
    title: input.title.trim() || "Custom Node",
    runtime: "http-json-post",
    inputSchema: {
      ...inputSchema,
      type: "object",
      properties: readRawRecord(inputSchema, "properties"),
      ...(required ? { required } : {}),
    },
    inputValues: readRawRecord(input.rawData, "inputValues"),
    request: {
      method: "POST",
      url: readRawString(request, "url", "https://api.example.com/v1/chat/completions"),
      headersTemplate: readStringRecord(request.headersTemplate),
      bodyTemplate: "bodyTemplate" in request ? request.bodyTemplate : {},
      timeoutMs: readRawNumber(request, "timeoutMs", 30000),
    },
    auth: {
      type: authType,
      ...(authType === "api-key-header" ? { headerName: readRawString(auth, "headerName", "X-API-Key") } : {}),
    },
    outputMapping: {
      ...(outputMapping.text ? { text: outputMapping.text } : {}),
      ...(outputMapping.json ? { json: outputMapping.json } : {}),
      ...(outputMapping.imageUrl ? { imageUrl: outputMapping.imageUrl } : {}),
    },
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
  }
}

function customNodeRawDataFromDefinition(nodeID: string, definition: CinemaCustomNodeDefinition): Record<string, unknown> {
  return {
    status: "idle",
    definitionID: definition.id,
    definitionTitle: definition.title,
    inputSchema: definition.inputSchema,
    inputValues: definition.inputValues ?? {},
    request: {
      ...definition.request,
      method: "POST",
    },
    auth: {
      type: definition.auth.type,
      credentialProviderID: customApiCredentialProviderID(nodeID),
      headerName: definition.auth.headerName ?? "X-API-Key",
    },
    outputMapping: definition.outputMapping ?? {},
  }
}

function defaultCustomApiRawData(nodeID: string, definition?: CinemaCustomNodeDefinition): Record<string, unknown> {
  if (definition) return customNodeRawDataFromDefinition(nodeID, definition)

  return {
    status: "idle",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          title: "Prompt",
          default: "",
        },
        model: {
          type: "string",
          title: "Model",
          default: "",
        },
      },
      required: ["prompt"],
    },
    inputValues: {
      prompt: "",
      model: "",
    },
    request: {
      method: "POST",
      url: "https://api.example.com/v1/chat/completions",
      headersTemplate: {
        "Content-Type": "application/json",
      },
      bodyTemplate: {
        model: "{{inputs.model}}",
        messages: [
          {
            role: "user",
            content: "{{inputs.prompt}}",
          },
        ],
      },
      timeoutMs: 30000,
    },
    auth: {
      type: "none",
      credentialProviderID: customApiCredentialProviderID(nodeID),
      headerName: "X-API-Key",
    },
    outputMapping: {
      text: "$.choices[0].message.content",
      json: "$",
    },
  }
}

function customApiSchemaProperties(schema: Record<string, unknown>) {
  const properties = schema.properties
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? properties as Record<string, unknown>
    : {}
}

function customApiFieldLabel(key: string, spec: unknown) {
  if (spec && typeof spec === "object" && !Array.isArray(spec)) {
    const title = (spec as Record<string, unknown>).title
    if (typeof title === "string" && title.trim()) return title.trim()
  }
  return key
}

function customApiFieldType(spec: unknown) {
  if (spec && typeof spec === "object" && !Array.isArray(spec)) {
    const type = (spec as Record<string, unknown>).type
    if (type === "number" || type === "integer" || type === "boolean" || type === "string") return type
  }
  return "string"
}

function customApiFieldEnum(spec: unknown) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return []
  const value = (spec as Record<string, unknown>).enum
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

const GENERATION_PROGRESS_PHASES = [
  "queued",
  "submitted",
  "processing",
  "downloading",
  "finalizing",
  "succeeded",
  "failed",
  "canceled",
] as const

function isGenerationProgressPhase(value: string): value is CinemaGenerationProgress["phase"] {
  return (GENERATION_PROGRESS_PHASES as readonly string[]).includes(value)
}

function readGenerationProgress(value: unknown): CinemaGenerationProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const phase = typeof record.phase === "string" && isGenerationProgressPhase(record.phase) ? record.phase : null
  if (!phase) return null
  const percent = typeof record.percent === "number" && Number.isFinite(record.percent)
    ? Math.min(100, Math.max(0, record.percent))
    : undefined
  return {
    phase,
    ...(percent !== undefined ? { percent } : {}),
    ...(typeof record.message === "string" && record.message.trim() ? { message: record.message.trim() } : {}),
    ...(typeof record.updatedAt === "string" && record.updatedAt.trim() ? { updatedAt: record.updatedAt.trim() } : {}),
  }
}

function fallbackProgressForStatus(status: string, message?: string | null): CinemaGenerationProgress | null {
  const normalizedMessage = message?.trim()
  switch (status) {
    case "queued":
      return { phase: "queued", ...(normalizedMessage ? { message: normalizedMessage } : {}) }
    case "running":
      return { phase: "processing", ...(normalizedMessage ? { message: normalizedMessage } : {}) }
    case "succeeded":
      return { phase: "succeeded", percent: 100, ...(normalizedMessage ? { message: normalizedMessage } : {}) }
    case "failed":
      return { phase: "failed", ...(normalizedMessage ? { message: normalizedMessage } : {}) }
    case "canceled":
      return { phase: "canceled", ...(normalizedMessage ? { message: normalizedMessage } : {}) }
    default:
      return null
  }
}

function effectiveGenerationProgress(input: {
  task?: CinemaGenerationTask | null
  rawData: Record<string, unknown>
  status: string
  message?: string | null
  forceQueued?: boolean
}) {
  if (input.forceQueued) return fallbackProgressForStatus("queued", input.message)
  return input.task?.progress
    ?? readGenerationProgress(input.rawData.progress)
    ?? fallbackProgressForStatus(input.status, input.message)
}

function progressLabel(progress: CinemaGenerationProgress, status: string) {
  if (progress.message && (progress.phase === "failed" || progress.phase === "canceled")) return progress.message
  switch (progress.phase) {
    case "queued":
      return "Queued"
    case "submitted":
      return "Submitted"
    case "processing":
      return "Processing"
    case "downloading":
      return "Downloading"
    case "finalizing":
      return "Finalizing"
    case "succeeded":
      return "Completed"
    case "failed":
      return "Failed"
    case "canceled":
      return "Canceled"
    default:
      return status
  }
}

function isActiveProgress(progress: CinemaGenerationProgress) {
  return progress.phase === "queued"
    || progress.phase === "submitted"
    || progress.phase === "processing"
    || progress.phase === "downloading"
    || progress.phase === "finalizing"
}

function GenerationProgress({
  progress,
  status,
  className = "",
}: {
  progress: CinemaGenerationProgress | null
  status: string
  className?: string
}) {
  if (!progress) return null
  const percent = typeof progress.percent === "number" && Number.isFinite(progress.percent)
    ? Math.min(100, Math.max(0, progress.percent))
    : null
  const isActive = isActiveProgress(progress)
  const isIndeterminate = isActive && percent === null
  const label = progressLabel(progress, status)
  return (
    <div className={`cinema-generation-progress is-${progress.phase} ${isIndeterminate ? "is-indeterminate" : ""} ${className}`}>
      <div className="cinema-generation-progress-meta">
        <span>{label}</span>
        {percent !== null ? <span>{Math.round(percent)}%</span> : null}
      </div>
      <div
        className="cinema-generation-progress-track"
        role="progressbar"
        aria-label="Generation progress"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent !== null ? { "aria-valuenow": Math.round(percent) } : {})}
      >
        <span
          className="cinema-generation-progress-fill"
          style={percent !== null ? { width: `${percent}%` } : undefined}
        />
      </div>
    </div>
  )
}
function readImageResultAssets(rawData: Record<string, unknown>): CinemaGeneratedAsset[] {
  const value = rawData.resultAssets
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const path = typeof record.path === "string" ? record.path : ""
    if (!path) return []
    return [{
      id: typeof record.id === "string" ? record.id : `image-${index}`,
      kind: "image" as const,
      path,
      mimeType: typeof record.mimeType === "string" ? record.mimeType : undefined,
      sizeBytes: typeof record.sizeBytes === "number" ? record.sizeBytes : undefined,
      width: typeof record.width === "number" ? record.width : undefined,
      height: typeof record.height === "number" ? record.height : undefined,
    }]
  })
}

function imagePreviewAspectRatio(asset: CinemaGeneratedAsset | null, fallbackSize: string) {
  if (asset?.width && asset.height) return `${asset.width} / ${asset.height}`
  const match = /^(\d+)x(\d+)$/.exec(fallbackSize.trim())
  if (!match) return null
  return `${Number(match[1])} / ${Number(match[2])}`
}

function projectAssetPreviewURL(agentBaseURL: string, projectID: string, assetPath: string) {
  const encodedPath = assetPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return new URL(`/api/cinema/projects/${encodeURIComponent(projectID)}/assets/${encodedPath}`, agentBaseURL).toString()
}

function projectFilesPath(projectID: string, directoryPath: string) {
  const query = directoryPath ? `?path=${encodeURIComponent(directoryPath)}` : ""
  return `/api/cinema/projects/${encodeURIComponent(projectID)}/files${query}`
}

function formatFileSize(sizeBytes: number | undefined) {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes)) return ""
  if (sizeBytes < 1024) return `${sizeBytes} B`
  const units = ["KB", "MB", "GB"]
  let value = sizeBytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`
}

function formatFileTimestamp(value: string | undefined) {
  if (!value) return ""
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return ""
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(time)
}

function filePathSegments(directoryPath: string) {
  return directoryPath.split("/").filter(Boolean)
}

function providerModelSelectionID(model: VideoProviderModel) {
  return model.offeringID ?? model.catalogID ?? model.id
}

function providerModelMatchesID(model: VideoProviderModel, modelID: string) {
  return [
    model.offeringID,
    model.catalogID,
    model.providerModelID,
    model.id,
  ].some((candidate) => candidate === modelID)
}

function providerAdapterAvailable(provider: CinemaVideoProvider) {
  return provider.runtime?.adapterAvailable === true
}

function providerRuntimeSupportsCombination(provider: CinemaVideoProvider, combinationMode: string) {
  const supportedModes = provider.runtime?.supportedModes ?? []
  if (supportedModes.length === 0) return providerAdapterAvailable(provider)
  return supportedModes.includes(combinationMode)
}

function modelInputCombinationsForProvider(provider: CinemaVideoProvider | null, model: VideoProviderModel | null) {
  if (!provider || !model) return []
  return (model.inputCombinations ?? []).filter((combination) =>
    providerRuntimeSupportsCombination(provider, combination.mode)
  )
}

function modelHasAvailableInputCombinations(provider: CinemaVideoProvider, model: VideoProviderModel) {
  return modelInputCombinationsForProvider(provider, model).length > 0
}

function availableVideoProviders(providers: CinemaVideoProvider[]) {
  return providers.filter((provider) =>
    providerAdapterAvailable(provider) &&
    provider.manifest.models.some((model) => modelHasAvailableInputCombinations(provider, model))
  )
}

function providerForSelection(providers: CinemaVideoProvider[], providerID: string) {
  const availableProviders = availableVideoProviders(providers)
  return availableProviders.find((provider) => provider.manifest.id === providerID) ?? availableProviders[0] ?? null
}

function availableModelsForProvider(provider: CinemaVideoProvider | null) {
  return provider?.manifest.models.filter((model) => modelHasAvailableInputCombinations(provider, model)) ?? []
}

function modelForSelection(provider: CinemaVideoProvider | null, modelID: string) {
  const availableModels = availableModelsForProvider(provider)
  return availableModels.find((model) => providerModelMatchesID(model, modelID)) ?? availableModels[0] ?? null
}

function inputCombinationsForModel(provider: CinemaVideoProvider | null, model: VideoProviderModel | null) {
  return modelInputCombinationsForProvider(provider, model)
}

function inputCombinationForSelection(
  provider: CinemaVideoProvider | null,
  model: VideoProviderModel | null,
  mode: CinemaGenerationMode,
) {
  const inputCombinations = inputCombinationsForModel(provider, model)
  return inputCombinations.find((combination) => combination.mode === mode) ?? inputCombinations[0] ?? null
}

function slotForInputRole(role: string, modality: string): VideoInputSlot | null {
  switch (role) {
    case "prompt":
      return "textParameter"
    case "first_frame_image":
      return "startFrame"
    case "last_frame_image":
      return "endFrame"
    case "reference_image":
    case "style_image":
      return "referenceImage"
    case "source_video":
    case "reference_video":
      return "sourceVideo"
    case "mask_image":
      return "mask"
    case "source_image":
    case "character_image":
    case "control_image":
    case "image":
      return "sourceImage"
    default:
      if (modality === "text") return "textParameter"
      if (modality === "image") return "sourceImage"
      if (modality === "video") return "sourceVideo"
      return null
  }
}

function videoInputKey(role: string, index: number) {
  const safeRole = role.trim().replace(/[^a-z0-9_-]+/gi, "-") || "input"
  return `input:${index}:${safeRole}`
}

function formatInputCombinationLabel(mode: string) {
  return mode
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
}

function labelForInputRole(role: string, modality: string) {
  switch (role) {
    case "prompt":
      return "提示词"
    case "first_frame_image":
      return "首帧"
    case "last_frame_image":
      return "尾帧"
    case "reference_image":
      return "参考图"
    case "style_image":
      return "风格图"
    case "source_video":
    case "reference_video":
      return "源视频"
    case "mask_image":
      return "蒙版"
    case "source_image":
    case "character_image":
    case "control_image":
    case "image":
      return "参考图"
    default:
      return role ? formatInputCombinationLabel(role) : formatInputCombinationLabel(modality)
  }
}

function emptyTextForInputRole(role: string, modality: string, slot: VideoInputSlot | null) {
  if (slot) return VIDEO_INPUT_SLOT_EMPTY_TEXT[slot]
  return `暂不支持 ${role || modality} 输入`
}

function videoInputControlForSpec(input: VideoProviderInputCombination["inputs"][number], index: number): VideoInputControl {
  const role = input.role.trim()
  const modality = input.modality.trim()
  const slot = slotForInputRole(role, modality)
  return {
    inputKey: videoInputKey(role, index),
    role,
    modality,
    required: input.required,
    minCount: input.minCount,
    maxCount: input.maxCount,
    note: typeof input.note === "string" ? input.note : undefined,
    slot,
    label: labelForInputRole(role, modality),
    emptyText: emptyTextForInputRole(role, modality, slot),
  }
}

function videoModeInputContractForCombination(combination: VideoProviderInputCombination | null): VideoModeInputContract {
  const inputs = combination?.inputs.map(videoInputControlForSpec) ?? []
  const promptInput = inputs.find((input) => input.slot === "textParameter")
  const unsupportedRequiredInputs = inputs.filter((input) => input.required && !input.slot)
  return {
    mode: combination?.mode ?? FALLBACK_VIDEO_INPUT_COMBINATION_MODE,
    label: combination?.label ?? formatInputCombinationLabel(combination?.mode ?? FALLBACK_VIDEO_INPUT_COMBINATION_MODE),
    promptPlaceholder: promptInput?.note ?? "描述视频内容、镜头运动和画面变化...",
    inputs,
    unsupportedRequiredInputs,
  }
}

function isVideoImageInputSlot(slot: VideoInputSlot): slot is VideoImageInputSlot {
  return (VIDEO_IMAGE_INPUT_SLOTS as readonly VideoInputSlot[]).includes(slot)
}

function isVideoMediaInputSlot(slot: VideoInputSlot): slot is VideoMediaInputSlot {
  return slot !== "textParameter"
}

function canImportVideoInputLocalImage(slot: VideoInputSlot | null): slot is VideoImageInputSlot {
  return Boolean(slot && (VIDEO_LOCAL_IMAGE_INPUT_SLOTS as readonly VideoInputSlot[]).includes(slot))
}

function isVideoMediaInputControl(input: VideoInputControl): input is VideoInputControl & { slot: VideoMediaInputSlot } {
  return Boolean(input.slot && isVideoMediaInputSlot(input.slot))
}

function videoInputAssetList(value: VideoInputAssetValue | undefined) {
  if (Array.isArray(value)) return value
  return value ? [value] : []
}

function readVideoMode(rawData: Record<string, unknown>) {
  return readRawString(rawData, "mode", FALLBACK_VIDEO_INPUT_COMBINATION_MODE)
}

function defaultModelAspectRatio(model: VideoProviderModel | null) {
  return model?.aspectRatios[0] ?? DEFAULT_VIDEO_ASPECT_RATIO
}

function defaultModelDuration(model: VideoProviderModel | null) {
  return model?.durations[0] ?? DEFAULT_VIDEO_DURATION_SECONDS
}

function defaultModelResolution(model: VideoProviderModel | null) {
  return model?.resolutions[0] ?? DEFAULT_VIDEO_RESOLUTION
}

function generationTaskUserPrompt(task: CinemaGenerationTask | null) {
  const value = task?.input.parameters.userPrompt
  return typeof value === "string" ? value : null
}

function readDisplayAssets(rawData: Record<string, unknown>): DisplayAsset[] {
  const value = rawData.outputAssets
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const path = typeof record.path === "string" ? record.path : ""
    if (!path) return []
    return [{
      id: typeof record.id === "string" ? record.id : `asset-${index}`,
      kind: typeof record.kind === "string" ? record.kind : "file",
      path,
    }]
  })
}

function readImageAsset(value: unknown): CinemaGeneratedAsset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const path = typeof record.path === "string" ? record.path : ""
  if (!path) return null
  return {
    id: typeof record.id === "string" ? record.id : `image-${path}`,
    kind: "image",
    path,
    mimeType: typeof record.mimeType === "string" ? record.mimeType : undefined,
    sizeBytes: typeof record.sizeBytes === "number" ? record.sizeBytes : undefined,
    width: typeof record.width === "number" ? record.width : undefined,
    height: typeof record.height === "number" ? record.height : undefined,
  }
}

function readImageAssets(value: unknown): CinemaGeneratedAsset[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const asset = readImageAsset(item)
    return asset ? [asset] : []
  })
}

function mergeImageAssets(assets: CinemaGeneratedAsset[]) {
  const result: CinemaGeneratedAsset[] = []
  const seen = new Set<string>()
  for (const asset of assets) {
    const key = asset.path
    if (seen.has(key)) continue
    seen.add(key)
    result.push(asset)
  }
  return result
}

function mergeSourceImageAssets(assets: VideoSourceImageAsset[]) {
  const result: VideoSourceImageAsset[] = []
  const seen = new Set<string>()
  for (const asset of assets) {
    const key = sourceImageAssetKey(asset)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(asset)
  }
  return result
}

function readEmbeddedSourceImageAssets(rawData: Record<string, unknown>, nodeID: string, nodeTitle: string): VideoSourceImageAsset[] {
  const storedAssets = readImageAssets(rawData.sourceImageAssets)
  const legacyAsset = readImageAsset(rawData.sourceImageAsset)
  return mergeImageAssets([
    ...storedAssets,
    ...(legacyAsset ? [legacyAsset] : []),
  ]).map((asset) => ({
    ...asset,
    nodeID,
    nodeTitle,
  }))
}

function readTextSourceImageAssets(rawData: Record<string, unknown>, nodeID: string): VideoSourceImageAsset[] {
  return readEmbeddedSourceImageAssets(rawData, nodeID, "Text reference")
}

function readImageGenerationSourceImageAssets(rawData: Record<string, unknown>, nodeID: string): VideoSourceImageAsset[] {
  return readEmbeddedSourceImageAssets(rawData, nodeID, "Image reference")
}

function readVideoLocalInputAssets(rawData: Record<string, unknown>, nodeID: string): VideoInputAssets {
  const value = rawData.videoLocalInputAssets
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const assets: VideoInputAssets = {}
  for (const slot of VIDEO_LOCAL_IMAGE_INPUT_SLOTS) {
    const asset = readImageAsset(record[slot])
    if (!asset) continue
    assets[slot] = {
      ...asset,
      nodeID,
      nodeTitle: `本地${VIDEO_INPUT_SLOT_LABELS[slot]}`,
      slot,
    }
  }
  return assets
}

function readLocalImageAsset(rawData: Record<string, unknown>) {
  return readImageAsset(rawData.asset)
}

function selectedImageAssetForNode(node: CinemaFlowNode): VideoSourceImageAsset | null {
  const assets = readImageResultAssets(node.data.rawData)
  const selectedAssetID = readRawString(node.data.rawData, "selectedAssetID")
  const asset = assets.find((item) => item.id === selectedAssetID) ?? assets[0] ?? null
  if (!asset) return null
  return {
    ...asset,
    nodeID: node.id,
    nodeTitle: node.data.title,
  }
}

function selectedLocalImageAssetForNode(node: CinemaFlowNode): VideoSourceImageAsset | null {
  const asset = readLocalImageAsset(node.data.rawData)
  if (!asset) return null
  return {
    ...asset,
    nodeID: node.id,
    nodeTitle: node.data.title,
  }
}

function selectedSourceImageAssetForNode(node: CinemaFlowNode): VideoSourceImageAsset | null {
  if (node.data.cinemaType === "image") return selectedImageAssetForNode(node)
  if (node.data.cinemaType === "local-image") return selectedLocalImageAssetForNode(node)
  return null
}

function selectedVideoAssetForNode(node: CinemaFlowNode): VideoSourceImageAsset | null {
  const assets = readDisplayAssets(node.data.rawData)
    .filter((asset): asset is CinemaGeneratedAsset & { kind: "video" } => asset.kind === "video")
  const selectedAssetID = readRawString(node.data.rawData, "selectedAssetID")
  const asset = assets.find((item) => item.id === selectedAssetID) ?? assets[0] ?? null
  if (!asset) return null
  return {
    ...asset,
    nodeID: node.id,
    nodeTitle: node.data.title,
  }
}

function selectedSourceAssetForVideoSlot(node: CinemaFlowNode, slot: VideoMediaInputSlot): VideoSourceImageAsset | null {
  if (isVideoImageInputSlot(slot)) return selectedSourceImageAssetForNode(node)
  if (slot === "sourceVideo") return selectedVideoAssetForNode(node)
  return null
}

function isVideoInputSlot(value: unknown): value is VideoInputSlot {
  return typeof value === "string" && (VIDEO_INPUT_SLOTS as readonly string[]).includes(value)
}

type VideoEdgeTargetInput = {
  inputKey?: string
  role?: string
  slot: VideoInputSlot | null
}

function videoInputHandleMetadata(handle: string | null | undefined): VideoEdgeTargetInput | null {
  if (!handle) return null
  if (isVideoInputSlot(handle)) return { slot: handle }
  const match = /^input:(\d+):(.+)$/.exec(handle)
  if (!match) return null
  const role = match[2] ?? ""
  return {
    inputKey: handle,
    role,
    slot: slotForInputRole(role, ""),
  }
}

function edgeTargetVideoInput(edge: Edge): VideoEdgeTargetInput | null {
  const data = edge.data
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>
    const inputKey = typeof record.targetInputKey === "string" ? record.targetInputKey : undefined
    const role = typeof record.targetRole === "string" ? record.targetRole : undefined
    const slot = isVideoInputSlot(record.targetSlot)
      ? record.targetSlot
      : role
        ? slotForInputRole(role, "")
        : null
    if (inputKey || role || slot) return { inputKey, role, slot }
  }
  return videoInputHandleMetadata(edge.targetHandle)
}

function edgeTargetVideoSlot(edge: Edge): VideoInputSlot | null {
  return edgeTargetVideoInput(edge)?.slot ?? null
}

function edgeMatchesVideoSlot(edge: Edge, slot: VideoInputSlot, legacySlot: VideoInputSlot | null = null) {
  const edgeSlot = edgeTargetVideoSlot(edge)
  if (edgeSlot) return edgeSlot === slot
  return legacySlot === slot
}

function edgeMatchesVideoInput(edge: Edge, input: VideoInputControl & { slot: VideoMediaInputSlot }, legacySlot: VideoInputSlot | null = null) {
  const targetInput = edgeTargetVideoInput(edge)
  if (targetInput?.inputKey) return targetInput.inputKey === input.inputKey
  if (targetInput?.role) return targetInput.role === input.role
  if (targetInput?.slot) return targetInput.slot === input.slot
  return legacySlot === input.slot
}

function sourceAssetsForVideoSlot(
  nodeID: string,
  nodes: CinemaFlowNode[],
  edges: Edge[],
  slot: VideoMediaInputSlot,
) {
  const assets: VideoSourceImageAsset[] = []
  const seen = new Set<string>()
  const legacySlot = slot === "sourceImage" ? "sourceImage" : null
  for (const edge of edges) {
    if (edge.target !== nodeID || !edgeMatchesVideoSlot(edge, slot, legacySlot)) continue
    const sourceNode = nodes.find((node) => node.id === edge.source)
    if (!sourceNode) continue
    const asset = selectedSourceAssetForVideoSlot(sourceNode, slot)
    if (!asset) continue
    const nextAsset = {
      ...asset,
      edgeID: edge.id,
      slot,
    }
    const key = sourceImageAssetKey(nextAsset)
    if (seen.has(key)) continue
    seen.add(key)
    assets.push(nextAsset)
    if (slot !== "referenceImage") break
  }
  return assets
}

function sourceImageAssetsForVideoSlot(
  nodeID: string,
  nodes: CinemaFlowNode[],
  edges: Edge[],
  slot: VideoImageInputSlot,
) {
  return sourceAssetsForVideoSlot(nodeID, nodes, edges, slot)
}

function sourceImageAssetForVideoSlot(
  nodeID: string,
  nodes: CinemaFlowNode[],
  edges: Edge[],
  slot: VideoImageInputSlot,
) {
  return sourceImageAssetsForVideoSlot(nodeID, nodes, edges, slot)[0] ?? null
}

function sourceImageAssetsForVideoNode(nodeID: string, nodes: CinemaFlowNode[], edges: Edge[]) {
  const assets: VideoImageInputAssets = {}
  for (const slot of VIDEO_IMAGE_INPUT_SLOTS) {
    const slotAssets = sourceImageAssetsForVideoSlot(nodeID, nodes, edges, slot)
    assets[slot] = slot === "referenceImage" ? slotAssets : slotAssets[0] ?? null
  }
  return assets
}

function sourceInputAssetsForVideoNode(nodeID: string, nodes: CinemaFlowNode[], edges: Edge[]) {
  const assets: VideoInputAssets = {}
  for (const slot of VIDEO_INPUT_SLOTS) {
    if (!isVideoMediaInputSlot(slot)) continue
    const slotAssets = sourceAssetsForVideoSlot(nodeID, nodes, edges, slot)
    assets[slot] = slot === "referenceImage" ? slotAssets : slotAssets[0] ?? null
  }
  return assets
}

function sourceInputAssetMapsForVideoNode(nodeID: string, nodes: CinemaFlowNode[], edges: Edge[]) {
  const byInputKey: VideoInputAssetMap = {}
  const byRole: VideoInputAssetMap = {}
  const appendAsset = (map: VideoInputAssetMap, key: string, asset: VideoSourceImageAsset, allowMultiple: boolean) => {
    const current = videoInputAssetList(map[key])
    const next = allowMultiple ? [...current, asset] : [asset]
    map[key] = allowMultiple ? mergeSourceImageAssets(next) : next[0] ?? null
  }

  for (const edge of edges) {
    if (edge.target !== nodeID) continue
    const targetInput = edgeTargetVideoInput(edge)
    if (!targetInput?.slot || !isVideoMediaInputSlot(targetInput.slot)) continue
    const sourceNode = nodes.find((node) => node.id === edge.source)
    if (!sourceNode) continue
    const asset = selectedSourceAssetForVideoSlot(sourceNode, targetInput.slot)
    if (!asset) continue
    const nextAsset = {
      ...asset,
      edgeID: edge.id,
      slot: targetInput.slot,
    }
    const allowMultiple = targetInput.slot === "referenceImage"
    if (targetInput.inputKey) appendAsset(byInputKey, targetInput.inputKey, nextAsset, allowMultiple)
    if (targetInput.role) appendAsset(byRole, targetInput.role, nextAsset, allowMultiple)
  }

  return { byInputKey, byRole }
}

function sourceImageAssetForVideoNode(nodeID: string, nodes: CinemaFlowNode[], edges: Edge[]) {
  return sourceImageAssetForVideoSlot(nodeID, nodes, edges, "sourceImage")
}

function sourceImageAssetsForNode(nodeID: string, nodes: CinemaFlowNode[], edges: Edge[]) {
  const assets: VideoSourceImageAsset[] = []
  const seen = new Set<string>()
  for (const edge of edges) {
    if (edge.target !== nodeID) continue
    const sourceNode = nodes.find((node) => node.id === edge.source)
    if (!sourceNode) continue
    const asset = selectedSourceImageAssetForNode(sourceNode)
    if (!asset) continue
    const key = `${asset.nodeID}:${asset.id}:${asset.path}`
    if (seen.has(key)) continue
    seen.add(key)
    assets.push(asset)
  }
  return assets
}

function sourceImageAssetKey(asset: Pick<VideoSourceImageAsset, "nodeID" | "id" | "path">) {
  return `${asset.nodeID}:${asset.id}:${asset.path}`
}

function sourceImageSelectionPatch(assets: VideoSourceImageAsset[]) {
  const selectedAssets = mergeSourceImageAssets(assets)
  const firstAsset = selectedAssets[0]
  return {
    sourceImageSelectionMode: "manual",
    sourceImageAssetID: firstAsset?.id ?? "",
    sourceImageAssetIDs: selectedAssets.map((asset) => asset.id),
    sourceImageAssetKey: firstAsset ? sourceImageAssetKey(firstAsset) : "",
    sourceImageAssetKeys: selectedAssets.map((asset) => sourceImageAssetKey(asset)),
    sourceImagePath: firstAsset?.path ?? "",
    sourceImagePaths: selectedAssets.map((asset) => asset.path),
  }
}

function sourceTextParametersForNode(nodeID: string, nodes: CinemaFlowNode[], edges: Edge[]) {
  const parameters: SourceTextParameter[] = []
  const seenNodeIDs = new Set<string>()
  for (const edge of edges) {
    if (edge.target !== nodeID) continue
    const targetInput = edgeTargetVideoInput(edge)
    if (targetInput && targetInput.slot !== "textParameter") continue
    if (seenNodeIDs.has(edge.source)) continue
    const sourceNode = nodes.find((node) => node.id === edge.source)
    if (
      !sourceNode ||
      (sourceNode.data.cinemaType !== "text" &&
        sourceNode.data.cinemaType !== "custom-api" &&
        sourceNode.data.cinemaType !== "custom-node")
    ) continue
    const text = sourceNode.data.cinemaType === "custom-api"
      ? readRawString(sourceNode.data.rawData, "outputText")
      : sourceNode.data.cinemaType === "custom-node"
        ? readRawString(sourceNode.data.rawData, "outputText")
      : readRawString(sourceNode.data.rawData, "text")
    seenNodeIDs.add(edge.source)
    parameters.push({
      edgeID: edge.id,
      nodeID: sourceNode.id,
      nodeTitle: sourceNode.data.title,
      text,
    })
  }
  return parameters
}

function imagePromptWithSourceText(userPrompt: string, parameters: SourceTextParameter[]) {
  return [
    ...parameters.map((parameter) => parameter.text.trim()).filter(Boolean),
    userPrompt.trim(),
  ].filter(Boolean).join("\n\n")
}

function uniqueSourceNodeIDs(...groups: string[][]) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const value of group) {
      const item = value.trim()
      if (!item || seen.has(item)) continue
      seen.add(item)
      result.push(item)
    }
  }
  return result
}

function isFinalGenerationTaskStatus(status: string) {
  return status === "succeeded" || status === "failed" || status === "canceled"
}

function formatTaskTimestamp(value: string | undefined) {
  if (!value) return ""
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return ""
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(time)
}

function fileToDataBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image file"))
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      const commaIndex = result.indexOf(",")
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

function createNode(type: CinemaNodeType, position: { x: number; y: number }): CinemaFlowNode {
  const id = makeNodeID(type)
  const size = DEFAULT_NODE_SIZE[type]
  const rawData = type === "image"
    ? {
      prompt: "",
      size: DEFAULT_IMAGE_GENERATION_SIZE,
      count: DEFAULT_IMAGE_GENERATION_COUNT,
      status: "idle",
      placeholder: NODE_META[type].placeholder,
    }
    : type === "video"
      ? {
        text: "",
        mode: FALLBACK_GENERATION_MODE,
        aspectRatio: DEFAULT_VIDEO_ASPECT_RATIO,
        duration: DEFAULT_VIDEO_DURATION_SECONDS,
        resolution: DEFAULT_VIDEO_RESOLUTION,
        status: "draft",
        parameters: {},
        placeholder: "Describe the clip to generate.",
      }
    : type === "local-image"
      ? {
        status: "missing",
        placeholder: NODE_META[type].placeholder,
      }
    : type === "custom-api" || type === "custom-node"
      ? defaultCustomApiRawData(id)
    : {
      text: "",
      placeholder: NODE_META[type].placeholder,
    }

  return {
    id,
    type: "cinemaNode",
    position,
    style: flowNodeStyle(type, size),
    data: {
      cinemaType: type,
      title: titleForType(type),
      rawData,
      size,
    },
  }
}

function createLocalImageNode(
  asset: CinemaGeneratedAsset,
  fileName: string,
  position: { x: number; y: number },
): CinemaFlowNode {
  const type = "local-image" satisfies CinemaNodeType
  const size = DEFAULT_NODE_SIZE[type]
  return {
    id: makeNodeID(type),
    type: "cinemaNode",
    position,
    style: flowNodeStyle(type, size),
    data: {
      cinemaType: type,
      title: fileName.trim() || titleForType(type),
      rawData: {
        asset,
        sourceFileName: fileName,
        status: "ready",
        importedAt: new Date().toISOString(),
      },
      size,
    },
  }
}

function isMutationChange(changes: NodeChange[] | EdgeChange[]) {
  return changes.some((change) => change.type !== "select" && change.type !== "dimensions")
}

function safeDownloadName(value: string) {
  const cleaned = value.trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48)
  return cleaned || "text-node"
}

function downloadTextFile(title: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${safeDownloadName(title)}.txt`
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function NodeTitleInput({
  nodeID,
  title,
  onChangeTitle,
}: {
  nodeID: string
  title: string
  onChangeTitle?: (nodeID: string, title: string) => void
}) {
  const [draft, setDraft] = useState(title)

  useEffect(() => {
    setDraft(title)
  }, [title])

  const commitTitle = useCallback(() => {
    const nextTitle = draft.trim() || "Untitled Node"
    setDraft(nextTitle)
    if (nextTitle !== title) onChangeTitle?.(nodeID, nextTitle)
  }, [draft, nodeID, onChangeTitle, title])

  return (
    <input
      className="cinema-node-title-input nodrag nowheel"
      aria-label="Node title"
      value={draft}
      spellCheck={false}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Enter") {
          event.preventDefault()
          event.currentTarget.blur()
        }
        if (event.key === "Escape") {
          setDraft(title)
          event.currentTarget.blur()
        }
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commitTitle}
    />
  )
}

function NodeDeleteButton({
  nodeID,
  onDeleteNode,
  className = "cinema-node-delete-button",
}: {
  nodeID: string
  onDeleteNode?: (nodeID: string) => void
  className?: string
}) {
  if (!onDeleteNode) return null
  return (
    <button
      type="button"
      className={`${className} nodrag nowheel`}
      title="Delete node"
      aria-label="Delete node"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onDeleteNode(nodeID)
      }}
    >
      <Trash2 size={13} aria-hidden="true" />
    </button>
  )
}

function TextCanvasNode({
  id,
  data,
  selected,
  accentStyle,
}: {
  id: string
  data: CinemaFlowNodeData
  selected?: boolean
  accentStyle: CSSProperties
}) {
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const generatorPromptRef = useRef<HTMLTextAreaElement>(null)
  const sourceImageInputRef = useRef<HTMLInputElement>(null)
  const modelControlRef = useRef<HTMLDivElement>(null)
  const [isTextEditorOpen, setIsTextEditorOpen] = useState(false)
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(() =>
    Boolean(readRawString(data.rawData, "generationPrompt") || data.textGenerationError)
  )
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [sourceImageImportError, setSourceImageImportError] = useState<string | null>(null)
  const text = readRawString(data.rawData, "text")
  const generatorPrompt = readRawString(data.rawData, "generationPrompt")
  const placeholder = readRawString(data.rawData, "placeholder", "双击编辑文本...")
  const [textDraft, setTextDraftState] = useState(text)
  const [generatorPromptDraft, setGeneratorPromptDraftState] = useState(generatorPrompt)
  const textDraftRef = useRef(text)
  const generatorPromptDraftRef = useRef(generatorPrompt)
  const rawDataRef = useRef(data.rawData)
  const onChangeRawDataRef = useRef(data.onChangeRawData)
  const textCommitTimerRef = useRef<number | null>(null)
  const generatorPromptCommitTimerRef = useRef<number | null>(null)
  const isTextComposingRef = useRef(false)
  const isGeneratorPromptComposingRef = useRef(false)
  const textModels = data.textModels ?? []
  const selectedTextModelValue = readRawString(data.rawData, "textModel")
  const selectedTextModel =
    textModels.find((model) => model.value === selectedTextModelValue) ??
    data.effectiveTextModel ??
    textModels[0] ??
    null
  const supportsSourceImage = Boolean(selectedTextModel?.supportsImageInput)
  const connectedSourceImageAssets = data.sourceImageAssets ?? []
  const connectedSourceImageAssetPaths = new Set(connectedSourceImageAssets.map((asset) => asset.path))
  const textSourceImageAssets = readTextSourceImageAssets(data.rawData, id)
    .filter((asset) => !connectedSourceImageAssetPaths.has(asset.path))
  const hiddenSourceImageAssetKeys = readRawStringArray(data.rawData, "hiddenSourceImageAssetKeys")
  const sourceImageAssets = mergeSourceImageAssets([...connectedSourceImageAssets, ...textSourceImageAssets])
    .filter((asset) => !hiddenSourceImageAssetKeys.includes(sourceImageAssetKey(asset)))
  const isManualSourceImageSelection = readRawString(data.rawData, "sourceImageSelectionMode") === "manual"
  const selectedSourceImageAssetKeys = readRawStringArray(data.rawData, "sourceImageAssetKeys")
  const selectedSourceImageAssetKey = readRawString(data.rawData, "sourceImageAssetKey")
  const selectedSourceImageAssetIDs = readRawStringArray(data.rawData, "sourceImageAssetIDs")
  const selectedSourceImageAssetID = readRawString(data.rawData, "sourceImageAssetID")
  const selectedSourceImagePaths = readRawStringArray(data.rawData, "sourceImagePaths")
  const selectedSourceImagePath = readRawString(data.rawData, "sourceImagePath")
  const hasSavedSourceImageSelection = isManualSourceImageSelection
    || selectedSourceImageAssetKeys.length > 0
    || Boolean(selectedSourceImageAssetKey)
    || selectedSourceImageAssetIDs.length > 0
    || Boolean(selectedSourceImageAssetID)
    || selectedSourceImagePaths.length > 0
    || Boolean(selectedSourceImagePath)
  const selectedSourceImageAssets = hasSavedSourceImageSelection
    ? sourceImageAssets.filter((asset) => {
      const key = sourceImageAssetKey(asset)
      return selectedSourceImageAssetKeys.includes(key)
        || key === selectedSourceImageAssetKey
        || selectedSourceImageAssetIDs.includes(asset.id)
        || asset.id === selectedSourceImageAssetID
        || selectedSourceImagePaths.includes(asset.path)
        || asset.path === selectedSourceImagePath
    })
    : sourceImageAssets
  const promptReady = generatorPromptDraft.trim().length > 0
  const canGenerate = promptReady && Boolean(selectedTextModel) && !data.isGeneratingText

  rawDataRef.current = data.rawData
  onChangeRawDataRef.current = data.onChangeRawData

  const setTextDraft = useCallback((value: string) => {
    textDraftRef.current = value
    setTextDraftState(value)
  }, [])

  const setGeneratorPromptDraft = useCallback((value: string) => {
    generatorPromptDraftRef.current = value
    setGeneratorPromptDraftState(value)
  }, [])

  const clearTextCommitTimer = useCallback(() => {
    if (textCommitTimerRef.current === null) return
    window.clearTimeout(textCommitTimerRef.current)
    textCommitTimerRef.current = null
  }, [])

  const clearGeneratorPromptCommitTimer = useCallback(() => {
    if (generatorPromptCommitTimerRef.current === null) return
    window.clearTimeout(generatorPromptCommitTimerRef.current)
    generatorPromptCommitTimerRef.current = null
  }, [])

  const commitRawDataPatch = useCallback((patch: Record<string, unknown> = {}) => {
    const previous = rawDataRef.current
    const nextRawData: Record<string, unknown> = {
      ...previous,
      text: textDraftRef.current,
      generationPrompt: generatorPromptDraftRef.current,
      ...patch,
    }
    const hasChange = Object.keys(nextRawData).some((key) => nextRawData[key] !== previous[key])
      || Object.keys(previous).some((key) => !(key in nextRawData))
    if (!hasChange) return

    rawDataRef.current = nextRawData
    onChangeRawDataRef.current?.(id, {
      ...nextRawData,
    })
  }, [id])

  const importTextSourceImageMutation = useMutation({
    mutationFn: async (files: File[]) => {
      if (!data.agentBaseURL || !data.projectID) throw new Error("Project context is not ready")
      const assets: CinemaGeneratedAsset[] = []
      for (const file of files) {
        const dataBase64 = await fileToDataBase64(file)
        const result = await requestJson<CinemaImportedImageAssetResult>(
          data.agentBaseURL,
          `/api/cinema/projects/${encodeURIComponent(data.projectID)}/assets/imports`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.type || undefined,
              dataBase64,
            }),
          },
        )
        assets.push(result.asset)
      }
      return assets
    },
    onMutate: () => {
      setSourceImageImportError(null)
    },
    onSuccess: (assets) => {
      const existingTextAssets = readTextSourceImageAssets(rawDataRef.current, id)
        .map(({ nodeID: _nodeID, nodeTitle: _nodeTitle, ...asset }) => asset)
      const nextTextAssets = mergeImageAssets([...existingTextAssets, ...assets])
      const nextTextSourceAssets = assets.map((asset) => ({
        ...asset,
        nodeID: id,
        nodeTitle: "Text reference",
      }))
      commitRawDataPatch({
        sourceImageAsset: nextTextAssets[0] ?? null,
        sourceImageAssets: nextTextAssets,
        ...sourceImageSelectionPatch([...selectedSourceImageAssets, ...nextTextSourceAssets]),
      })
    },
    onError: (error) => {
      setSourceImageImportError(error instanceof Error ? error.message : "Image import failed")
    },
  })

  const scheduleTextCommit = useCallback((value: string) => {
    clearTextCommitTimer()
    textCommitTimerRef.current = window.setTimeout(() => {
      textCommitTimerRef.current = null
      commitRawDataPatch({ text: value })
    }, 320)
  }, [clearTextCommitTimer, commitRawDataPatch])

  const scheduleGeneratorPromptCommit = useCallback((value: string) => {
    clearGeneratorPromptCommitTimer()
    generatorPromptCommitTimerRef.current = window.setTimeout(() => {
      generatorPromptCommitTimerRef.current = null
      commitRawDataPatch({ generationPrompt: value })
    }, 320)
  }, [clearGeneratorPromptCommitTimer, commitRawDataPatch])

  useEffect(() => {
    if (isTextComposingRef.current || textCommitTimerRef.current !== null) return
    textDraftRef.current = text
    setTextDraftState(text)
  }, [text])

  useEffect(() => {
    if (isGeneratorPromptComposingRef.current || generatorPromptCommitTimerRef.current !== null) return
    generatorPromptDraftRef.current = generatorPrompt
    setGeneratorPromptDraftState(generatorPrompt)
  }, [generatorPrompt])

  useEffect(() => () => {
    clearTextCommitTimer()
    clearGeneratorPromptCommitTimer()
  }, [clearGeneratorPromptCommitTimer, clearTextCommitTimer])

  useEffect(() => {
    if (!isModelMenuOpen) return

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof globalThis.Node)) return
      if (!modelControlRef.current?.contains(target)) setIsModelMenuOpen(false)
    }

    window.addEventListener("pointerdown", closeOnOutsidePointerDown)
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointerDown)
  }, [isModelMenuOpen])

  useEffect(() => {
    if (generatorPrompt || data.textGenerationError) setIsGeneratorOpen(true)
  }, [data.textGenerationError, generatorPrompt])

  const focusEditor = () => {
    setIsTextEditorOpen(true)
    window.requestAnimationFrame(() => editorRef.current?.focus())
  }
  const copyText = () => {
    const value = textDraft || placeholder
    void navigator.clipboard?.writeText(value)
  }
  const openSourceImagePicker = () => {
    setSourceImageImportError(null)
    sourceImageInputRef.current?.click()
  }
  const handleSourceImageFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (files.length === 0) return
    importTextSourceImageMutation.mutate(files)
  }
  const removeSourceImageAsset = (asset: VideoSourceImageAsset) => {
    const removedKey = sourceImageAssetKey(asset)
    const nextSelectedSourceImageAssets = selectedSourceImageAssets.filter((selectedAsset) =>
      sourceImageAssetKey(selectedAsset) !== removedKey
    )
    const patch: Record<string, unknown> = sourceImageSelectionPatch(nextSelectedSourceImageAssets)

    if (asset.nodeID === id) {
      const nextTextAssets = readTextSourceImageAssets(rawDataRef.current, id)
        .filter((textAsset) => sourceImageAssetKey(textAsset) !== removedKey)
        .map(({ nodeID: _nodeID, nodeTitle: _nodeTitle, ...textAsset }) => textAsset)
      patch.sourceImageAsset = nextTextAssets[0] ?? null
      patch.sourceImageAssets = nextTextAssets
    } else {
      const currentHiddenKeys = readRawStringArray(rawDataRef.current, "hiddenSourceImageAssetKeys")
      patch.hiddenSourceImageAssetKeys = currentHiddenKeys.includes(removedKey)
        ? currentHiddenKeys
        : [...currentHiddenKeys, removedKey]
    }

    commitRawDataPatch(patch)
  }
  const generateText = () => {
    const prompt = generatorPromptDraft.trim()
    if (!prompt) {
      setIsGeneratorOpen(true)
      window.requestAnimationFrame(() => generatorPromptRef.current?.focus())
      return
    }
    if (!selectedTextModel || data.isGeneratingText) return
    clearTextCommitTimer()
    clearGeneratorPromptCommitTimer()
    commitRawDataPatch({
      text: textDraftRef.current,
      generationPrompt: generatorPromptDraftRef.current,
      ...(supportsSourceImage ? sourceImageSelectionPatch(selectedSourceImageAssets) : {}),
    })
    setIsModelMenuOpen(false)
    data.onGenerateText?.(id, {
      prompt,
      model: selectedTextModel.value,
      ...(supportsSourceImage && selectedSourceImageAssets.length > 0
        ? {
          sourceImageAssetID: selectedSourceImageAssets[0]?.id,
          sourceImageAssetIDs: selectedSourceImageAssets.map((asset) => asset.id),
          sourceImagePath: selectedSourceImageAssets[0]?.path,
          sourceImagePaths: selectedSourceImageAssets.map((asset) => asset.path),
        }
        : {}),
    })
  }

  return (
    <>
      <Handle
        id="input"
        type="target"
        position={Position.Left}
        className="cinema-node-handle cinema-node-handle-input"
        style={accentStyle}
      />
      <article
        className={`cinema-node cinema-text-card-node ${selected ? "is-selected" : ""}`}
        style={accentStyle}
      >
        <header className="cinema-node-header">
          <span className="cinema-node-type">
            <FileText size={14} aria-hidden="true" />
            Text
          </span>
          <div className="cinema-node-header-actions nodrag nowheel" role="toolbar" aria-label="Text node actions">
            <button
              type="button"
              className={`cinema-node-action-button ${isTextEditorOpen ? "is-active" : ""}`}
              title="编辑文本"
              aria-label="编辑文本"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                focusEditor()
              }}
            >
              <PencilLine size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`cinema-node-action-button ${isGeneratorOpen ? "is-active" : ""}`}
              title="生成文本"
              aria-label="生成文本"
              aria-expanded={isGeneratorOpen}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                setIsGeneratorOpen((current) => !current)
              }}
            >
              {data.isGeneratingText
                ? <Loader2 size={13} aria-hidden="true" className="is-spinning" />
                : <WandSparkles size={13} aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="cinema-node-action-button"
              title="复制文本"
              aria-label="复制文本"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                copyText()
              }}
            >
              <Copy size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="cinema-node-action-button"
              title="下载文本"
              aria-label="下载文本"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                downloadTextFile(data.title, textDraft)
              }}
            >
              <Download size={13} aria-hidden="true" />
            </button>
            <NodeDeleteButton nodeID={id} onDeleteNode={data.onDeleteNode} />
          </div>
        </header>

        <div className={`cinema-node-preview cinema-text-card-preview ${isTextEditorOpen ? "is-editing" : ""}`}>
          {isTextEditorOpen ? (
            <textarea
              ref={editorRef}
              className="cinema-text-card-editor nodrag nowheel"
              value={textDraft}
              placeholder={placeholder}
              spellCheck={false}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const value = event.target.value
                setTextDraft(value)
                if (!isTextComposingRef.current) scheduleTextCommit(value)
              }}
              onCompositionStart={() => {
                isTextComposingRef.current = true
                clearTextCommitTimer()
              }}
              onCompositionEnd={(event) => {
                isTextComposingRef.current = false
                const value = event.currentTarget.value
                setTextDraft(value)
                commitRawDataPatch({ text: value })
              }}
              onBlur={() => {
                if (isTextComposingRef.current) return
                clearTextCommitTimer()
                commitRawDataPatch({ text: textDraftRef.current })
              }}
            />
          ) : (
            <>
              <FileText size={28} aria-hidden="true" />
              <span className="cinema-text-card-preview-text">{textDraft || placeholder}</span>
            </>
          )}
        </div>

        <footer className="cinema-node-footer">
          <NodeTitleInput nodeID={id} title={data.title} onChangeTitle={data.onChangeTitle} />
          <span>{textDraft || placeholder}</span>
        </footer>
      </article>

      {isGeneratorOpen ? (
        <section className="cinema-text-card-generator nodrag nowheel" aria-label="Text generation draft" style={accentStyle}>
          <header className="cinema-text-card-generator-header">
            <span>
              <WandSparkles size={13} aria-hidden="true" />
              文本生成
            </span>
            <button
              type="button"
              className="cinema-node-action-button"
              title="关闭生成面板"
              aria-label="关闭生成面板"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setIsGeneratorOpen(false)}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </header>
          {supportsSourceImage ? (
            <section className={`cinema-text-source-image ${selectedSourceImageAssets.length > 0 ? "is-ready" : "is-empty"}`} aria-label="Text generation source image">
              {sourceImageAssets.length > 0 ? (
                <>
                  <div className="cinema-text-source-image-main">
                    <Image size={13} aria-hidden="true" />
                    <span>{selectedSourceImageAssets.length > 0 ? `参考图：${selectedSourceImageAssets.length} 张` : "选择参考图"}</span>
                  </div>
                  <div className="cinema-text-source-image-list" aria-label="可用参考图">
                    {sourceImageAssets.map((asset) => {
                      const src = data.agentBaseURL && data.projectID
                        ? projectAssetPreviewURL(data.agentBaseURL, data.projectID, asset.path)
                        : ""
                      const isSelected = selectedSourceImageAssets.some((selectedAsset) =>
                        sourceImageAssetKey(selectedAsset) === sourceImageAssetKey(asset)
                      )
                      return (
                        <div
                          key={`${asset.nodeID}-${asset.id}-${asset.path}`}
                          className="cinema-text-source-image-item"
                        >
                          <button
                            type="button"
                            className={`cinema-text-source-image-thumb ${isSelected ? "is-selected" : ""}`}
                            title={`${asset.nodeTitle} · ${asset.path}`}
                            aria-label={`选择参考图 ${asset.nodeTitle}`}
                            aria-pressed={isSelected}
                            onClick={() => {
                              const nextSelectedSourceImageAssets = isSelected
                                ? selectedSourceImageAssets.filter((selectedAsset) =>
                                  sourceImageAssetKey(selectedAsset) !== sourceImageAssetKey(asset)
                                )
                                : [...selectedSourceImageAssets, asset]
                              commitRawDataPatch(sourceImageSelectionPatch(nextSelectedSourceImageAssets))
                            }}
                          >
                            {src ? <img src={src} alt="" draggable={false} /> : <Image size={14} aria-hidden="true" />}
                          </button>
                          <button
                            type="button"
                            className="cinema-text-source-image-remove"
                            title={`移除参考图 ${asset.nodeTitle}`}
                            aria-label={`移除参考图 ${asset.nodeTitle}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              removeSourceImageAsset(asset)
                            }}
                          >
                            <X size={11} aria-hidden="true" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="cinema-text-source-image-empty">
                  <Image size={15} aria-hidden="true" />
                  <span>连接图片节点，或在这里选择一张或多张图片</span>
                </div>
              )}
              <div className="cinema-text-source-image-actions">
                <button
                  type="button"
                  className="cinema-text-source-image-add"
                  title="从本地选择参考图"
                  aria-label="从本地选择参考图"
                  disabled={importTextSourceImageMutation.isPending}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    openSourceImagePicker()
                  }}
                >
                  {importTextSourceImageMutation.isPending
                    ? <Loader2 size={13} aria-hidden="true" className="is-spinning" />
                    : <Upload size={13} aria-hidden="true" />}
                  <span>添加 Text 参考图</span>
                </button>
              </div>
              {sourceImageImportError ? (
                <p className="cinema-text-generator-error" role="alert" title={sourceImageImportError}>
                  {sourceImageImportError}
                </p>
              ) : null}
              <input
                ref={sourceImageInputRef}
                className="cinema-local-image-input"
                type="file"
                accept={LOCAL_IMAGE_FILE_ACCEPT}
                multiple
                onChange={handleSourceImageFileInputChange}
              />
            </section>
          ) : null}
          <textarea
            ref={generatorPromptRef}
            className="cinema-text-card-generator-input"
            value={generatorPromptDraft}
            placeholder="描述你想生成的文本内容..."
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const value = event.target.value
              setGeneratorPromptDraft(value)
              if (!isGeneratorPromptComposingRef.current) scheduleGeneratorPromptCommit(value)
            }}
            onCompositionStart={() => {
              isGeneratorPromptComposingRef.current = true
              clearGeneratorPromptCommitTimer()
            }}
            onCompositionEnd={(event) => {
              isGeneratorPromptComposingRef.current = false
              const value = event.currentTarget.value
              setGeneratorPromptDraft(value)
              commitRawDataPatch({ generationPrompt: value })
            }}
            onBlur={() => {
              if (isGeneratorPromptComposingRef.current) return
              clearGeneratorPromptCommitTimer()
              commitRawDataPatch({ generationPrompt: generatorPromptDraftRef.current })
            }}
          />
          <div className="cinema-text-card-generator-lower">
            {data.textGenerationError ? (
              <p className="cinema-text-generator-error" role="alert" title={data.textGenerationError}>
                {data.textGenerationError}
              </p>
            ) : null}
            <footer className="cinema-text-card-generator-footer">
              <div className="cinema-text-model-control" ref={modelControlRef}>
                <button
                  type="button"
                  className="cinema-text-card-model-button"
                  title="模型"
                  aria-haspopup="listbox"
                  aria-expanded={isModelMenuOpen}
                  disabled={textModels.length === 0 || data.isGeneratingText}
                  onClick={() => setIsModelMenuOpen((current) => !current)}
                >
                  <span>{selectedTextModel?.label ?? "No model"}</span>
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
                {isModelMenuOpen ? (
                  <div className="cinema-text-model-menu" role="listbox" aria-label="选择文本模型">
                    {textModels.length > 0 ? textModels.map((model) => (
                      <button
                        key={model.value}
                        type="button"
                        role="option"
                        aria-selected={model.value === selectedTextModel?.value}
                        className={`cinema-text-model-option ${model.value === selectedTextModel?.value ? "is-selected" : ""}`}
                        onClick={() => {
                          commitRawDataPatch({ textModel: model.value })
                          setIsModelMenuOpen(false)
                        }}
                      >
                        <span>{model.label}</span>
                        <small>{model.providerLabel}</small>
                      </button>
                    )) : (
                      <span className="cinema-text-model-empty">暂无可用文本模型</span>
                    )}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="cinema-text-card-submit"
                title={selectedTextModel ? "生成文本" : "没有可用文本模型"}
                aria-label="生成文本"
                disabled={!canGenerate}
                onClick={generateText}
              >
                {data.isGeneratingText
                  ? <Loader2 size={18} aria-hidden="true" className="is-spinning" />
                  : <ArrowUp size={18} aria-hidden="true" />}
              </button>
            </footer>
          </div>
        </section>
      ) : null}

      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className="cinema-node-handle cinema-node-handle-output"
        style={accentStyle}
      />
    </>
  )
}

function ImageGenerationCanvasNode({
  id,
  data,
  selected,
  accentStyle,
}: {
  id: string
  data: CinemaFlowNodeData
  selected?: boolean
  accentStyle: CSSProperties
}) {
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const sourceImageInputRef = useRef<HTMLInputElement>(null)
  const [sourceImageImportError, setSourceImageImportError] = useState<string | null>(null)
  const prompt = readRawString(data.rawData, "prompt")
  const style = readRawString(data.rawData, "style")
  const size = readRawString(data.rawData, "size", DEFAULT_IMAGE_GENERATION_SIZE)
  const count = String(readRawNumber(data.rawData, "count", DEFAULT_IMAGE_GENERATION_COUNT))
  const [promptDraft, setPromptDraftState] = useState(prompt)
  const [styleDraft, setStyleDraftState] = useState(style)
  const [sizeDraft, setSizeDraftState] = useState(size)
  const [countDraft, setCountDraftState] = useState(count)
  const promptDraftRef = useRef(prompt)
  const styleDraftRef = useRef(style)
  const sizeDraftRef = useRef(size)
  const countDraftRef = useRef(count)
  const rawDataRef = useRef(data.rawData)
  const onChangeRawDataRef = useRef(data.onChangeRawData)
  const promptCommitTimerRef = useRef<number | null>(null)
  const isPromptComposingRef = useRef(false)
  const imageModels = data.imageModels ?? []
  const sourceTextParameters = data.sourceTextParameters ?? []
  const tasks = data.generationTasks ?? []
  const taskID = readRawString(data.rawData, "taskID")
  const task = tasks.find((item) => item.id === taskID) ?? null
  const selectedImageModelValue = readRawString(data.rawData, "model")
  const selectedImageModel =
    imageModels.find((model) => model.value === selectedImageModelValue) ??
    data.effectiveImageModel ??
    imageModels[0] ??
    null
  const supportsSourceImage = Boolean(selectedImageModel?.supportsImageInput)
  const connectedSourceImageAssets = data.sourceImageAssets ?? []
  const connectedSourceImageAssetPaths = new Set(connectedSourceImageAssets.map((asset) => asset.path))
  const imageSourceImageAssets = readImageGenerationSourceImageAssets(data.rawData, id)
    .filter((asset) => !connectedSourceImageAssetPaths.has(asset.path))
  const hiddenSourceImageAssetKeys = readRawStringArray(data.rawData, "hiddenSourceImageAssetKeys")
  const sourceImageAssets = mergeSourceImageAssets([...connectedSourceImageAssets, ...imageSourceImageAssets])
    .filter((asset) => !hiddenSourceImageAssetKeys.includes(sourceImageAssetKey(asset)))
  const isManualSourceImageSelection = readRawString(data.rawData, "sourceImageSelectionMode") === "manual"
  const selectedSourceImageAssetKeys = readRawStringArray(data.rawData, "sourceImageAssetKeys")
  const selectedSourceImageAssetKey = readRawString(data.rawData, "sourceImageAssetKey")
  const selectedSourceImageAssetIDs = readRawStringArray(data.rawData, "sourceImageAssetIDs")
  const selectedSourceImageAssetID = readRawString(data.rawData, "sourceImageAssetID")
  const selectedSourceImagePaths = readRawStringArray(data.rawData, "sourceImagePaths")
  const selectedSourceImagePath = readRawString(data.rawData, "sourceImagePath")
  const hasSavedSourceImageSelection = isManualSourceImageSelection
    || selectedSourceImageAssetKeys.length > 0
    || Boolean(selectedSourceImageAssetKey)
    || selectedSourceImageAssetIDs.length > 0
    || Boolean(selectedSourceImageAssetID)
    || selectedSourceImagePaths.length > 0
    || Boolean(selectedSourceImagePath)
  const selectedSourceImageAssets = hasSavedSourceImageSelection
    ? sourceImageAssets.filter((asset) => {
      const key = sourceImageAssetKey(asset)
      return selectedSourceImageAssetKeys.includes(key)
        || key === selectedSourceImageAssetKey
        || selectedSourceImageAssetIDs.includes(asset.id)
        || asset.id === selectedSourceImageAssetID
        || selectedSourceImagePaths.includes(asset.path)
        || asset.path === selectedSourceImagePath
    })
    : sourceImageAssets
  const taskImageAssets = task?.outputAssets.filter((asset): asset is CinemaGeneratedAsset & { kind: "image" } => asset.kind === "image") ?? []
  const assets = taskImageAssets.length > 0 ? taskImageAssets : readImageResultAssets(data.rawData)
  const selectedAssetID = readRawString(data.rawData, "selectedAssetID")
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetID) ?? assets[0] ?? null
  const status = data.isGeneratingImage ? "queued" : task?.status ?? readRawString(data.rawData, "status", "idle")
  const nodeError = data.imageGenerationError ?? task?.error ?? readRawString(data.rawData, "error")
  const generatedAt = readRawString(data.rawData, "generatedAt") || task?.updatedAt || ""
  const generatedLabel = formatTaskTimestamp(generatedAt)
  const progress = effectiveGenerationProgress({
    task,
    rawData: data.rawData,
    status,
    message: nodeError,
    forceQueued: Boolean(data.isGeneratingImage),
  })
  const previewSrc = selectedAsset && data.agentBaseURL && data.projectID
    ? projectAssetPreviewURL(data.agentBaseURL, data.projectID, selectedAsset.path)
    : ""
  const previewAspectRatio = selectedAsset ? imagePreviewAspectRatio(selectedAsset, sizeDraft) : null
  const previewStyle = previewAspectRatio
    ? { "--cinema-image-preview-aspect-ratio": previewAspectRatio } as CSSProperties
    : undefined
  const effectivePromptDraft = imagePromptWithSourceText(promptDraft, sourceTextParameters)
  const promptReady = effectivePromptDraft.trim().length > 0
  const isImageTaskActive = status === "queued" || status === "running"
  const isImageBusy = Boolean(data.isGeneratingImage) || isImageTaskActive
  const canGenerate = promptReady && Boolean(selectedImageModel) && !isImageBusy

  rawDataRef.current = data.rawData
  onChangeRawDataRef.current = data.onChangeRawData

  const normalizeCountDraft = useCallback(() => {
    const parsed = Number.parseInt(countDraftRef.current, 10)
    if (!Number.isFinite(parsed)) return DEFAULT_IMAGE_GENERATION_COUNT
    return Math.min(4, Math.max(1, parsed))
  }, [])

  const setPromptDraft = useCallback((value: string) => {
    promptDraftRef.current = value
    setPromptDraftState(value)
  }, [])

  const setStyleDraft = useCallback((value: string) => {
    styleDraftRef.current = value
    setStyleDraftState(value)
  }, [])

  const setSizeDraft = useCallback((value: string) => {
    sizeDraftRef.current = value
    setSizeDraftState(value)
  }, [])

  const setCountDraft = useCallback((value: string) => {
    countDraftRef.current = value
    setCountDraftState(value)
  }, [])

  const clearPromptCommitTimer = useCallback(() => {
    if (promptCommitTimerRef.current === null) return
    window.clearTimeout(promptCommitTimerRef.current)
    promptCommitTimerRef.current = null
  }, [])

  const commitRawDataPatch = useCallback((patch: Record<string, unknown> = {}) => {
    const previous = rawDataRef.current
    const nextRawData: Record<string, unknown> = {
      ...previous,
      prompt: promptDraftRef.current,
      style: styleDraftRef.current,
      size: sizeDraftRef.current.trim() || DEFAULT_IMAGE_GENERATION_SIZE,
      count: normalizeCountDraft(),
      ...patch,
    }
    const hasChange = Object.keys(nextRawData).some((key) => nextRawData[key] !== previous[key])
      || Object.keys(previous).some((key) => !(key in nextRawData))
    if (!hasChange) return

    rawDataRef.current = nextRawData
    onChangeRawDataRef.current?.(id, {
      ...nextRawData,
    })
  }, [id, normalizeCountDraft])

  const importImageSourceImageMutation = useMutation({
    mutationFn: async (files: File[]) => {
      if (!data.agentBaseURL || !data.projectID) throw new Error("Project context is not ready")
      const assets: CinemaGeneratedAsset[] = []
      for (const file of files) {
        const dataBase64 = await fileToDataBase64(file)
        const result = await requestJson<CinemaImportedImageAssetResult>(
          data.agentBaseURL,
          `/api/cinema/projects/${encodeURIComponent(data.projectID)}/assets/imports`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fileName: file.name,
              mimeType: file.type || undefined,
              dataBase64,
            }),
          },
        )
        assets.push(result.asset)
      }
      return assets
    },
    onMutate: () => {
      setSourceImageImportError(null)
    },
    onSuccess: (assets) => {
      const existingImageAssets = readImageGenerationSourceImageAssets(rawDataRef.current, id)
        .map(({ nodeID: _nodeID, nodeTitle: _nodeTitle, ...asset }) => asset)
      const nextImageAssets = mergeImageAssets([...existingImageAssets, ...assets])
      const nextImageSourceAssets = assets.map((asset) => ({
        ...asset,
        nodeID: id,
        nodeTitle: "Image reference",
      }))
      commitRawDataPatch({
        sourceImageAsset: nextImageAssets[0] ?? null,
        sourceImageAssets: nextImageAssets,
        ...sourceImageSelectionPatch([...selectedSourceImageAssets, ...nextImageSourceAssets]),
      })
    },
    onError: (error) => {
      setSourceImageImportError(error instanceof Error ? error.message : "Image import failed")
    },
  })

  const schedulePromptCommit = useCallback((value: string) => {
    clearPromptCommitTimer()
    promptCommitTimerRef.current = window.setTimeout(() => {
      promptCommitTimerRef.current = null
      commitRawDataPatch({ prompt: value })
    }, 320)
  }, [clearPromptCommitTimer, commitRawDataPatch])

  useEffect(() => {
    if (isPromptComposingRef.current || promptCommitTimerRef.current !== null) return
    promptDraftRef.current = prompt
    setPromptDraftState(prompt)
  }, [prompt])

  useEffect(() => {
    styleDraftRef.current = style
    setStyleDraftState(style)
  }, [style])

  useEffect(() => {
    sizeDraftRef.current = size
    setSizeDraftState(size)
  }, [size])

  useEffect(() => {
    countDraftRef.current = count
    setCountDraftState(count)
  }, [count])

  useEffect(() => () => clearPromptCommitTimer(), [clearPromptCommitTimer])

  const openSourceImagePicker = () => {
    setSourceImageImportError(null)
    sourceImageInputRef.current?.click()
  }

  const handleSourceImageFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (files.length === 0) return
    importImageSourceImageMutation.mutate(files)
  }

  const removeSourceImageAsset = (asset: VideoSourceImageAsset) => {
    const removedKey = sourceImageAssetKey(asset)
    const nextSelectedSourceImageAssets = selectedSourceImageAssets.filter((selectedAsset) =>
      sourceImageAssetKey(selectedAsset) !== removedKey
    )
    const patch: Record<string, unknown> = sourceImageSelectionPatch(nextSelectedSourceImageAssets)

    if (asset.nodeID === id) {
      const nextImageAssets = readImageGenerationSourceImageAssets(rawDataRef.current, id)
        .filter((imageAsset) => sourceImageAssetKey(imageAsset) !== removedKey)
        .map(({ nodeID: _nodeID, nodeTitle: _nodeTitle, ...imageAsset }) => imageAsset)
      patch.sourceImageAsset = nextImageAssets[0] ?? null
      patch.sourceImageAssets = nextImageAssets
    } else {
      const currentHiddenKeys = readRawStringArray(rawDataRef.current, "hiddenSourceImageAssetKeys")
      patch.hiddenSourceImageAssetKeys = currentHiddenKeys.includes(removedKey)
        ? currentHiddenKeys
        : [...currentHiddenKeys, removedKey]
    }

    commitRawDataPatch(patch)
  }

  const generateImage = () => {
    const nextPrompt = promptDraftRef.current.trim()
    const nextSourceTextPrompts = sourceTextParameters.map((parameter) => parameter.text.trim()).filter(Boolean)
    const nextEffectivePrompt = imagePromptWithSourceText(nextPrompt, sourceTextParameters)
    if (!nextEffectivePrompt) {
      promptRef.current?.focus()
      return
    }
    if (!selectedImageModel || isImageBusy) return
    clearPromptCommitTimer()
    const nextSize = sizeDraftRef.current.trim() || DEFAULT_IMAGE_GENERATION_SIZE
    const nextCount = normalizeCountDraft()
    commitRawDataPatch({
      prompt: nextPrompt,
      model: selectedImageModel.value,
      size: nextSize,
      count: nextCount,
      style: styleDraftRef.current,
      sourceNodeIDs: uniqueSourceNodeIDs(
        sourceTextParameters.map((parameter) => parameter.nodeID),
        supportsSourceImage ? selectedSourceImageAssets.filter((asset) => asset.nodeID !== id).map((asset) => asset.nodeID) : [],
      ),
      sourceTextPrompts: nextSourceTextPrompts,
      ...(supportsSourceImage ? sourceImageSelectionPatch(selectedSourceImageAssets) : {}),
    })
    data.onGenerateImage?.(id, {
      prompt: nextEffectivePrompt,
      userPrompt: nextPrompt,
      model: selectedImageModel.value,
      size: nextSize,
      count: nextCount,
      style: styleDraftRef.current.trim() || undefined,
      sourceNodeIDs: uniqueSourceNodeIDs(
        sourceTextParameters.map((parameter) => parameter.nodeID),
        supportsSourceImage ? selectedSourceImageAssets.filter((asset) => asset.nodeID !== id).map((asset) => asset.nodeID) : [],
      ),
      sourceTextPrompts: nextSourceTextPrompts.length > 0 ? nextSourceTextPrompts : undefined,
      ...(supportsSourceImage && selectedSourceImageAssets.length > 0
        ? {
          sourceImageAssetID: selectedSourceImageAssets[0]?.id,
          sourceImageAssetIDs: selectedSourceImageAssets.map((asset) => asset.id),
          sourceImagePath: selectedSourceImageAssets[0]?.path,
          sourceImagePaths: selectedSourceImageAssets.map((asset) => asset.path),
        }
        : {}),
    })
  }

  return (
    <>
      <Handle
        id="input"
        type="target"
        position={Position.Left}
        className="cinema-node-handle cinema-node-handle-input"
        style={accentStyle}
      />
      <article
        className={`cinema-image-gen-node ${selected ? "is-selected" : ""}`}
        style={accentStyle}
      >
        <header className="cinema-image-gen-header">
          <span className="cinema-node-type">
            <Image size={14} aria-hidden="true" />
            <NodeTitleInput nodeID={id} title={data.title} onChangeTitle={data.onChangeTitle} />
          </span>
          <div className="cinema-node-header-actions">
            <span className={`cinema-image-gen-status is-${isImageBusy ? "running" : status}`}>
              {data.isGeneratingImage ? "submitting" : isImageTaskActive ? "generating" : status}
            </span>
            <NodeDeleteButton nodeID={id} onDeleteNode={data.onDeleteNode} />
          </div>
        </header>

        <section className="cinema-image-gen-preview" aria-label="Generated image preview" style={previewStyle}>
          {previewSrc ? (
            <img src={previewSrc} alt={promptDraft || data.title} draggable={false} />
          ) : (
            <div className="cinema-image-gen-empty">
              <Image size={28} aria-hidden="true" />
              <span>No image yet</span>
            </div>
          )}
          {isImageBusy ? (
            <div className="cinema-image-gen-overlay" aria-live="polite">
              <Loader2 size={18} aria-hidden="true" className="is-spinning" />
              <span>{data.isGeneratingImage ? "Submitting" : "Generating"}</span>
            </div>
          ) : null}
        </section>

        <GenerationProgress progress={progress} status={status} />

        {selectedAsset || generatedLabel ? (
          <div className="cinema-image-gen-meta">
            {selectedAsset ? <span title={selectedAsset.path}>{selectedAsset.path}</span> : null}
            {generatedLabel ? <time dateTime={generatedAt}>{generatedLabel}</time> : null}
          </div>
        ) : null}

        {assets.length > 1 ? (
          <div className="cinema-image-gen-thumbnails nodrag nowheel" aria-label="Generated image choices">
            {assets.map((asset) => {
              const src = data.agentBaseURL && data.projectID
                ? projectAssetPreviewURL(data.agentBaseURL, data.projectID, asset.path)
                : ""
              return (
                <button
                  key={asset.id}
                  type="button"
                  className={`cinema-image-gen-thumb ${asset.id === selectedAsset?.id ? "is-selected" : ""}`}
                  title={asset.path}
                  onClick={() => commitRawDataPatch({ selectedAssetID: asset.id })}
                >
                  {src ? <img src={src} alt="" draggable={false} /> : <Image size={14} aria-hidden="true" />}
                </button>
              )
            })}
          </div>
        ) : null}

        <section className="cinema-image-gen-composer nodrag nowheel" aria-label="Image generation controls">
          {sourceTextParameters.length > 0 ? (
            <div className="cinema-image-gen-param-tags" aria-label="Connected text parameters">
              {sourceTextParameters.map((parameter) => (
                <span
                  key={parameter.edgeID}
                  className={`cinema-image-gen-param-tag ${parameter.text.trim() ? "" : "is-empty"}`}
                  title={parameter.text.trim() ? `${parameter.nodeTitle}: ${parameter.text.trim()}` : `${parameter.nodeTitle}: 空文本`}
                >
                  <FileText size={12} aria-hidden="true" />
                  <span>{parameter.nodeTitle}</span>
                  <button
                    type="button"
                    title={`移除文本参数 ${parameter.nodeTitle}`}
                    aria-label={`移除文本参数 ${parameter.nodeTitle}`}
                    disabled={isImageBusy}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      data.onDisconnectEdge?.(parameter.edgeID)
                    }}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            ref={promptRef}
            value={promptDraft}
            placeholder="描述画面、主体、光线和镜头..."
            spellCheck={false}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const value = event.target.value
              setPromptDraft(value)
              if (!isPromptComposingRef.current) schedulePromptCommit(value)
            }}
            onCompositionStart={() => {
              isPromptComposingRef.current = true
              clearPromptCommitTimer()
            }}
            onCompositionEnd={(event) => {
              isPromptComposingRef.current = false
              const value = event.currentTarget.value
              setPromptDraft(value)
              commitRawDataPatch({ prompt: value })
            }}
            onBlur={() => {
              if (isPromptComposingRef.current) return
              clearPromptCommitTimer()
              commitRawDataPatch({ prompt: promptDraftRef.current })
            }}
          />
          <input
            className="cinema-image-gen-style"
            value={styleDraft}
            placeholder="风格提示（可选）"
            spellCheck={false}
            disabled={isImageBusy}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => setStyleDraft(event.target.value)}
            onBlur={() => commitRawDataPatch({ style: styleDraftRef.current })}
          />
          {supportsSourceImage ? (
            <section className={`cinema-text-source-image ${selectedSourceImageAssets.length > 0 ? "is-ready" : "is-empty"}`} aria-label="Image generation source image">
              {sourceImageAssets.length > 0 ? (
                <>
                  <div className="cinema-text-source-image-main">
                    <Image size={13} aria-hidden="true" />
                    <span>{selectedSourceImageAssets.length > 0 ? `参考图：${selectedSourceImageAssets.length} 张` : "选择参考图"}</span>
                  </div>
                  <div className="cinema-text-source-image-list" aria-label="可用参考图">
                    {sourceImageAssets.map((asset) => {
                      const src = data.agentBaseURL && data.projectID
                        ? projectAssetPreviewURL(data.agentBaseURL, data.projectID, asset.path)
                        : ""
                      const isSelected = selectedSourceImageAssets.some((selectedAsset) =>
                        sourceImageAssetKey(selectedAsset) === sourceImageAssetKey(asset)
                      )
                      return (
                        <div
                          key={`${asset.nodeID}-${asset.id}-${asset.path}`}
                          className="cinema-text-source-image-item"
                        >
                          <button
                            type="button"
                            className={`cinema-text-source-image-thumb ${isSelected ? "is-selected" : ""}`}
                            title={`${asset.nodeTitle} · ${asset.path}`}
                            aria-label={`选择参考图 ${asset.nodeTitle}`}
                            aria-pressed={isSelected}
                            disabled={isImageBusy}
                            onClick={() => {
                              const nextSelectedSourceImageAssets = isSelected
                                ? selectedSourceImageAssets.filter((selectedAsset) =>
                                  sourceImageAssetKey(selectedAsset) !== sourceImageAssetKey(asset)
                                )
                                : [...selectedSourceImageAssets, asset]
                              commitRawDataPatch(sourceImageSelectionPatch(nextSelectedSourceImageAssets))
                            }}
                          >
                            {src ? <img src={src} alt="" draggable={false} /> : <Image size={14} aria-hidden="true" />}
                          </button>
                          <button
                            type="button"
                            className="cinema-text-source-image-remove"
                            title={`移除参考图 ${asset.nodeTitle}`}
                            aria-label={`移除参考图 ${asset.nodeTitle}`}
                            disabled={isImageBusy}
                            onClick={(event) => {
                              event.stopPropagation()
                              removeSourceImageAsset(asset)
                            }}
                          >
                            <X size={11} aria-hidden="true" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="cinema-text-source-image-empty">
                  <Image size={15} aria-hidden="true" />
                  <span>连接图片节点，或在这里选择一张或多张图片</span>
                </div>
              )}
              <div className="cinema-text-source-image-actions">
                <button
                  type="button"
                  className="cinema-text-source-image-add"
                  title="从本地选择参考图"
                  aria-label="从本地选择参考图"
                  disabled={isImageBusy || importImageSourceImageMutation.isPending}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    openSourceImagePicker()
                  }}
                >
                  {importImageSourceImageMutation.isPending
                    ? <Loader2 size={13} aria-hidden="true" className="is-spinning" />
                    : <Upload size={13} aria-hidden="true" />}
                  <span>添加参考图</span>
                </button>
              </div>
              {sourceImageImportError ? (
                <p className="cinema-image-gen-error" role="alert" title={sourceImageImportError}>
                  {sourceImageImportError}
                </p>
              ) : null}
              <input
                ref={sourceImageInputRef}
                className="cinema-local-image-input"
                type="file"
                accept={LOCAL_IMAGE_FILE_ACCEPT}
                multiple
                onChange={handleSourceImageFileInputChange}
              />
            </section>
          ) : null}
          <div className="cinema-image-gen-controls">
            <select
              aria-label="Image model"
              value={selectedImageModel?.value ?? ""}
              disabled={imageModels.length === 0 || isImageBusy}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => commitRawDataPatch({ model: event.target.value || undefined })}
            >
              {imageModels.length > 0 ? imageModels.map((model) => (
                <option key={model.value} value={model.value}>{model.providerLabel} · {model.label}</option>
              )) : (
                <option value="">No generation image model</option>
              )}
            </select>
            <input
              aria-label="Image size"
              value={sizeDraft}
              disabled={isImageBusy}
              inputMode="numeric"
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => setSizeDraft(event.target.value)}
              onBlur={() => commitRawDataPatch({ size: sizeDraftRef.current.trim() || DEFAULT_IMAGE_GENERATION_SIZE })}
            />
            <input
              aria-label="Image count"
              type="number"
              min={1}
              max={4}
              value={countDraft}
              disabled={isImageBusy}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => setCountDraft(event.target.value)}
              onBlur={() => {
                const normalized = normalizeCountDraft()
                setCountDraft(String(normalized))
                commitRawDataPatch({ count: normalized })
              }}
            />
            <button
              type="button"
              className="cinema-image-gen-submit"
              title={selectedImageModel ? "Generate image with provider" : "No available generation image model"}
              aria-label="Generate image"
              disabled={!canGenerate}
              onClick={generateImage}
            >
              {isImageBusy
                ? <Loader2 size={18} aria-hidden="true" className="is-spinning" />
                : <ArrowUp size={18} aria-hidden="true" />}
            </button>
          </div>
          {nodeError ? (
            <p className="cinema-image-gen-error" role="alert" title={nodeError}>
              {nodeError}
            </p>
          ) : null}
        </section>
      </article>
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className="cinema-node-handle cinema-node-handle-output"
        style={accentStyle}
      />
    </>
  )
}

function VideoGenerationCanvasNode({
  id,
  data,
  selected,
  accentStyle,
}: {
  id: string
  data: CinemaFlowNodeData
  selected?: boolean
  accentStyle: CSSProperties
}) {
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const videoInputImageInputRef = useRef<HTMLInputElement>(null)
  const pendingVideoInputImageSlotRef = useRef<VideoImageInputSlot | null>(null)
  const rawDataRef = useRef(data.rawData)
  const onChangeRawDataRef = useRef(data.onChangeRawData)
  const promptCommitTimerRef = useRef<number | null>(null)
  const isPromptComposingRef = useRef(false)
  const providers = data.videoProviders ?? []
  const tasks = data.generationTasks ?? []
  const taskID = readRawString(data.rawData, "taskID")
  const task = tasks.find((item) => item.id === taskID) ?? null
  const taskUserPrompt = generationTaskUserPrompt(task)
  const initialMode = readVideoMode(data.rawData)
  const [mode, setModeState] = useState<CinemaGenerationMode>(initialMode)
  const [providerID, setProviderIDState] = useState(() => readRawString(data.rawData, "providerID"))
  const [modelID, setModelIDState] = useState(() => readRawString(data.rawData, "modelID"))
  const [promptDraft, setPromptDraftState] = useState(() => {
    const rawPrompt = readRawString(data.rawData, "text")
    return taskUserPrompt ?? (rawPrompt || task?.input.prompt || "")
  })
  const [aspectRatioDraft, setAspectRatioDraftState] = useState(() => readRawString(data.rawData, "aspectRatio", DEFAULT_VIDEO_ASPECT_RATIO))
  const [durationDraft, setDurationDraftState] = useState(() => String(readRawNumber(data.rawData, "duration", DEFAULT_VIDEO_DURATION_SECONDS)))
  const [resolutionDraft, setResolutionDraftState] = useState(() => readRawString(data.rawData, "resolution", DEFAULT_VIDEO_RESOLUTION))
  const [videoInputImageImportError, setVideoInputImageImportError] = useState<string | null>(null)
  const [importingVideoInputImageSlot, setImportingVideoInputImageSlot] = useState<VideoImageInputSlot | null>(null)
  const promptDraftRef = useRef(promptDraft)
  const modeRef = useRef(mode)
  const providerIDRef = useRef(providerID)
  const modelIDRef = useRef(modelID)
  const aspectRatioDraftRef = useRef(aspectRatioDraft)
  const durationDraftRef = useRef(durationDraft)
  const resolutionDraftRef = useRef(resolutionDraft)

  rawDataRef.current = data.rawData
  onChangeRawDataRef.current = data.onChangeRawData

  const selectedProvider = providerForSelection(providers, providerID)
  const selectedModel = modelForSelection(selectedProvider, modelID)
  const selectedModelSelectionID = selectedModel ? providerModelSelectionID(selectedModel) : ""
  const selectedInputCombination = inputCombinationForSelection(selectedProvider, selectedModel, mode)
  const selectedEndpoint: CinemaProviderEndpoint | undefined = selectedInputCombination?.endpoint
  const availableProviders = availableVideoProviders(providers)
  const availableModels = availableModelsForProvider(selectedProvider)
  const availableInputCombinations = inputCombinationsForModel(selectedProvider, selectedModel)
  const visibleModeContracts = availableInputCombinations.map(videoModeInputContractForCombination)
  const modeContract = videoModeInputContractForCombination(selectedInputCombination)
  const outputAssets = task?.outputAssets ?? readDisplayAssets(data.rawData)
  const outputAsset = outputAssets.find((asset) => asset.kind === "video") ?? outputAssets[0] ?? null
  const previewSrc = outputAsset && data.agentBaseURL && data.projectID
    ? projectAssetPreviewURL(data.agentBaseURL, data.projectID, outputAsset.path)
    : ""
  const currentStatus = data.isCreatingVideoTask
    ? "queued"
    : task?.status ?? readRawString(data.rawData, "status", "draft")
  const isWaiting = currentStatus === "queued" || currentStatus === "running"
  const isBusy = data.isCreatingVideoTask || isWaiting
  const providerNeedsCredential = Boolean(selectedProvider?.auth.requiresCredential)
  const providerConnected = selectedProvider?.auth.connected !== false
  const providerAdapterUnavailable = Boolean(selectedProvider) && selectedProvider?.runtime?.adapterAvailable !== true
  const videoMediaInputs = modeContract.inputs.filter(isVideoMediaInputControl)
  const inputHandleStyle = videoMediaInputs.length > 0 ? { ...accentStyle, top: "36%" } : accentStyle
  const inputAssets: VideoInputAssets = data.videoInputAssets ?? data.videoInputImageAssets ?? {}
  const videoLocalInputAssets = readVideoLocalInputAssets(data.rawData, id)
  const sourceImageAsset = videoInputAssetList(inputAssets.sourceImage)[0] ?? data.sourceImageAsset ?? null
  const inputAssetsForControl = (input: VideoInputControl & { slot: VideoMediaInputSlot }) => {
    const localAssets = canImportVideoInputLocalImage(input.slot)
      ? videoInputAssetList(videoLocalInputAssets[input.slot])
      : []
    const keyedAssets = videoInputAssetList(data.videoInputAssetsByInputKey?.[input.inputKey])
    const roleAssets = videoInputAssetList(data.videoInputAssetsByRole?.[input.role])
    const slotAssets = input.slot === "sourceImage"
      ? (sourceImageAsset ? [sourceImageAsset] : [])
      : videoInputAssetList(inputAssets[input.slot])
    const assets = localAssets.length > 0 ? localAssets : keyedAssets.length > 0 ? keyedAssets : roleAssets.length > 0 ? roleAssets : slotAssets
    return input.slot === "referenceImage"
      ? assets.slice(0, input.maxCount ?? assets.length)
      : assets.slice(0, 1)
  }
  const activeInputAssets = videoMediaInputs.flatMap((input) =>
    inputAssetsForControl(input).map((asset) => ({ input, asset }))
  )
  const inputAssetsForLegacySlot = (slot: VideoMediaInputSlot) =>
    videoMediaInputs
      .filter((input) => input.slot === slot)
      .flatMap((input) => inputAssetsForControl(input))
  const missingRequiredInput = videoMediaInputs.find((input) =>
    input.required && inputAssetsForControl(input).length < Math.max(input.minCount, 1)
  )
  const missingRequiredInputLabel = missingRequiredInput?.label ?? ""
  const sourceTextParameters = data.sourceTextParameters ?? []
  const effectivePromptDraft = imagePromptWithSourceText(promptDraft, sourceTextParameters)
  const promptRequired = modeContract.inputs.some((input) => input.slot === "textParameter" && input.required)
  const unsupportedRequiredInput = modeContract.unsupportedRequiredInputs[0] ?? null
  const requiredInputMissing = Boolean(missingRequiredInput)
  const hasSourceImageInput = videoMediaInputs.some((input) => input.slot === "sourceImage")
  const missingRequiredInputSlotLabel = missingRequiredInputLabel
  const nodeError = data.videoGenerationError ?? task?.error ?? readRawString(data.rawData, "error")
  const progress = effectiveGenerationProgress({
    task,
    rawData: data.rawData,
    status: currentStatus,
    message: nodeError,
    forceQueued: Boolean(data.isCreatingVideoTask),
  })
  const submitDisabledReason = !selectedProvider
    ? "No available video provider."
    : !selectedModel
      ? "No available video model."
      : !selectedInputCombination
        ? "The selected model has no available input combination."
        : promptRequired && effectivePromptDraft.trim().length === 0
          ? "Enter a video prompt or connect a text parameter node."
          : isBusy
            ? "The current task is still running."
            : providerNeedsCredential && !providerConnected
              ? `${selectedProvider.manifest.name} is not connected.`
              : providerAdapterUnavailable
                ? `${selectedProvider.manifest.name} does not have a generation runtime adapter yet.`
                : unsupportedRequiredInput
                  ? `Required input ${unsupportedRequiredInput.label} is not supported by this UI yet.`
                  : requiredInputMissing
                    ? canImportVideoInputLocalImage(missingRequiredInput?.slot ?? null)
                      ? `${missingRequiredInputLabel} needs an imported or connected image.`
                      : `${missingRequiredInputLabel} needs a connected input node.`
                    : null
  const canGenerate =
    submitDisabledReason === null

  const setPromptDraft = useCallback((value: string) => {
    promptDraftRef.current = value
    setPromptDraftState(value)
  }, [])

  const setMode = useCallback((value: CinemaGenerationMode) => {
    modeRef.current = value
    setModeState(value)
  }, [])

  const setProviderID = useCallback((value: string) => {
    providerIDRef.current = value
    setProviderIDState(value)
  }, [])

  const setModelID = useCallback((value: string) => {
    modelIDRef.current = value
    setModelIDState(value)
  }, [])

  const setAspectRatioDraft = useCallback((value: string) => {
    aspectRatioDraftRef.current = value
    setAspectRatioDraftState(value)
  }, [])

  const setDurationDraft = useCallback((value: string) => {
    durationDraftRef.current = value
    setDurationDraftState(value)
  }, [])

  const setResolutionDraft = useCallback((value: string) => {
    resolutionDraftRef.current = value
    setResolutionDraftState(value)
  }, [])

  const normalizedDuration = useCallback(() => {
    const parsed = Number.parseFloat(durationDraftRef.current)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_VIDEO_DURATION_SECONDS
    return parsed
  }, [])

  const clearPromptCommitTimer = useCallback(() => {
    if (promptCommitTimerRef.current === null) return
    window.clearTimeout(promptCommitTimerRef.current)
    promptCommitTimerRef.current = null
  }, [])

  const commitRawDataPatch = useCallback((patch: Record<string, unknown> = {}) => {
    const previous = rawDataRef.current
    const nextRawData: Record<string, unknown> = {
      ...previous,
      text: promptDraftRef.current,
      mode: modeRef.current,
      providerID: providerIDRef.current || undefined,
      modelID: modelIDRef.current || undefined,
      aspectRatio: aspectRatioDraftRef.current.trim() || DEFAULT_VIDEO_ASPECT_RATIO,
      duration: normalizedDuration(),
      resolution: resolutionDraftRef.current.trim() || DEFAULT_VIDEO_RESOLUTION,
      ...patch,
    }
    const hasChange = Object.keys(nextRawData).some((key) => nextRawData[key] !== previous[key])
      || Object.keys(previous).some((key) => !(key in nextRawData))
    if (!hasChange) return

    rawDataRef.current = nextRawData
    onChangeRawDataRef.current?.(id, nextRawData)
  }, [id, normalizedDuration])

  const writeVideoLocalInputAsset = useCallback((slot: VideoImageInputSlot, asset: CinemaGeneratedAsset | null) => {
    const previousValue = rawDataRef.current.videoLocalInputAssets
    const nextLocalInputAssets = previousValue && typeof previousValue === "object" && !Array.isArray(previousValue)
      ? { ...(previousValue as Record<string, unknown>) }
      : {}
    if (asset) {
      nextLocalInputAssets[slot] = asset
    } else {
      delete nextLocalInputAssets[slot]
    }
    commitRawDataPatch({
      videoLocalInputAssets: nextLocalInputAssets,
    })
  }, [commitRawDataPatch])

  const importVideoInputImageMutation = useMutation({
    mutationFn: async ({ slot, file }: { slot: VideoImageInputSlot; file: File }) => {
      if (!data.agentBaseURL || !data.projectID) throw new Error("Project context is not ready")
      const dataBase64 = await fileToDataBase64(file)
      const result = await requestJson<CinemaImportedImageAssetResult>(
        data.agentBaseURL,
        `/api/cinema/projects/${encodeURIComponent(data.projectID)}/assets/imports`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || undefined,
            dataBase64,
          }),
        },
      )
      return { slot, asset: result.asset }
    },
    onMutate: ({ slot }) => {
      setVideoInputImageImportError(null)
      setImportingVideoInputImageSlot(slot)
    },
    onSuccess: ({ slot, asset }) => {
      writeVideoLocalInputAsset(slot, asset)
    },
    onError: (error) => {
      setVideoInputImageImportError(error instanceof Error ? error.message : "Image import failed")
    },
    onSettled: () => {
      setImportingVideoInputImageSlot(null)
    },
  })

  const schedulePromptCommit = useCallback((value: string) => {
    clearPromptCommitTimer()
    promptCommitTimerRef.current = window.setTimeout(() => {
      promptCommitTimerRef.current = null
      commitRawDataPatch({ text: value })
    }, 320)
  }, [clearPromptCommitTimer, commitRawDataPatch])

  useEffect(() => {
    const storedMode = readVideoMode(data.rawData)
    const nextProvider = providerForSelection(providers, readRawString(data.rawData, "providerID"))
    const nextModel = modelForSelection(nextProvider, readRawString(data.rawData, "modelID"))
    const nextCombination = inputCombinationForSelection(nextProvider, nextModel, storedMode)
    const nextMode = nextCombination?.mode ?? FALLBACK_VIDEO_INPUT_COMBINATION_MODE
    setMode(nextMode)
    setProviderID(nextProvider?.manifest.id ?? "")
    setModelID(nextModel ? providerModelSelectionID(nextModel) : "")
    setAspectRatioDraft(readRawString(data.rawData, "aspectRatio", defaultModelAspectRatio(nextModel)))
    setDurationDraft(String(readRawNumber(data.rawData, "duration", defaultModelDuration(nextModel))))
    setResolutionDraft(readRawString(data.rawData, "resolution", defaultModelResolution(nextModel)))
  }, [data.rawData, providers, setAspectRatioDraft, setDurationDraft, setMode, setModelID, setProviderID, setResolutionDraft])

  useEffect(() => {
    if (isPromptComposingRef.current || promptCommitTimerRef.current !== null) return
    const rawPrompt = readRawString(data.rawData, "text")
    const nextPrompt = taskUserPrompt ?? (rawPrompt || task?.input.prompt || "")
    promptDraftRef.current = nextPrompt
    setPromptDraftState(nextPrompt)
  }, [data.rawData, task?.input.prompt, taskUserPrompt])

  useEffect(() => () => clearPromptCommitTimer(), [clearPromptCommitTimer])

  const openVideoInputImagePicker = (slot: VideoImageInputSlot) => {
    if (!canImportVideoInputLocalImage(slot) || isBusy || importVideoInputImageMutation.isPending) return
    pendingVideoInputImageSlotRef.current = slot
    setVideoInputImageImportError(null)
    videoInputImageInputRef.current?.click()
  }

  const handleVideoInputImageFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null
    event.currentTarget.value = ""
    const slot = pendingVideoInputImageSlotRef.current
    pendingVideoInputImageSlotRef.current = null
    if (!file || !slot) return
    importVideoInputImageMutation.mutate({ slot, file })
  }

  const clearVideoInputLocalImage = (slot: VideoImageInputSlot) => {
    if (!canImportVideoInputLocalImage(slot) || isBusy || importVideoInputImageMutation.isPending) return
    setVideoInputImageImportError(null)
    writeVideoLocalInputAsset(slot, null)
  }

  const chooseMode = (nextMode: CinemaGenerationMode) => {
    setMode(nextMode)
    commitRawDataPatch({
      mode: nextMode,
    })
  }

  const chooseProvider = (nextProviderID: string) => {
    const nextProvider = providerForSelection(providers, nextProviderID)
    const nextModel = modelForSelection(nextProvider, "")
    const nextCombination = inputCombinationForSelection(nextProvider, nextModel, modeRef.current)
    const nextMode = nextCombination?.mode ?? FALLBACK_VIDEO_INPUT_COMBINATION_MODE
    const nextAspectRatio = defaultModelAspectRatio(nextModel)
    const nextDuration = defaultModelDuration(nextModel)
    const nextResolution = defaultModelResolution(nextModel)
    setMode(nextMode)
    setProviderID(nextProvider?.manifest.id ?? "")
    setModelID(nextModel ? providerModelSelectionID(nextModel) : "")
    setAspectRatioDraft(nextAspectRatio)
    setDurationDraft(String(nextDuration))
    setResolutionDraft(nextResolution)
    commitRawDataPatch({
      mode: nextMode,
      providerID: nextProvider?.manifest.id,
      modelID: nextModel ? providerModelSelectionID(nextModel) : undefined,
      aspectRatio: nextAspectRatio,
      duration: nextDuration,
      resolution: nextResolution,
    })
  }

  const chooseModel = (nextModelID: string) => {
    const nextModel = modelForSelection(selectedProvider, nextModelID)
    const nextCombination = inputCombinationForSelection(selectedProvider, nextModel, modeRef.current)
    const nextMode = nextCombination?.mode ?? FALLBACK_VIDEO_INPUT_COMBINATION_MODE
    const nextAspectRatio = defaultModelAspectRatio(nextModel)
    const nextDuration = defaultModelDuration(nextModel)
    const nextResolution = defaultModelResolution(nextModel)
    setMode(nextMode)
    setModelID(nextModel ? providerModelSelectionID(nextModel) : "")
    setAspectRatioDraft(nextAspectRatio)
    setDurationDraft(String(nextDuration))
    setResolutionDraft(nextResolution)
    commitRawDataPatch({
      mode: nextMode,
      modelID: nextModel ? providerModelSelectionID(nextModel) : undefined,
      aspectRatio: nextAspectRatio,
      duration: nextDuration,
      resolution: nextResolution,
    })
  }

  const createTask = () => {
    const userPrompt = promptDraftRef.current.trim()
    const sourceTextPrompts = sourceTextParameters.map((parameter) => parameter.text.trim()).filter(Boolean)
    const prompt = imagePromptWithSourceText(userPrompt, sourceTextParameters)
    if (promptRequired && !prompt) {
      promptRef.current?.focus()
      return
    }
    if (!selectedProvider || !selectedModel || !selectedInputCombination || isBusy || requiredInputMissing || unsupportedRequiredInput) return
    clearPromptCommitTimer()
    const duration = normalizedDuration()
    const aspectRatio = aspectRatioDraftRef.current.trim() || defaultModelAspectRatio(selectedModel)
    const resolution = resolutionDraftRef.current.trim() || defaultModelResolution(selectedModel)
    const sourceNodeIDs = uniqueSourceNodeIDs(
      sourceTextParameters.map((parameter) => parameter.nodeID),
      activeInputAssets.filter(({ asset }) => asset.nodeID !== id).map(({ asset }) => asset.nodeID),
    )
    const inputSlots = [
      ...sourceTextParameters.map((parameter) => ({
        slot: "textParameter",
        role: "prompt",
        modality: "text",
        inputKey: "textParameter",
        nodeID: parameter.nodeID,
        edgeID: parameter.edgeID,
      })),
      ...activeInputAssets.map(({ input, asset }) => ({
        slot: input.slot,
        role: input.role,
        modality: input.modality,
        inputKey: input.inputKey,
        nodeID: asset.nodeID,
        edgeID: asset.edgeID,
        assetID: asset.id,
        path: asset.path,
      })),
    ]
    const sourceImageAssetForPayload = inputAssetsForLegacySlot("sourceImage")[0] ?? null
    const referenceImageAssets = inputAssetsForLegacySlot("referenceImage")
    const referenceImageAssetIDs = referenceImageAssets.map((asset) => asset.id)
    const referenceImagePaths = referenceImageAssets.map((asset) => asset.path)
    const startFrameAsset = inputAssetsForLegacySlot("startFrame")[0] ?? null
    const endFrameAsset = inputAssetsForLegacySlot("endFrame")[0] ?? null
    const sourceVideoAsset = inputAssetsForLegacySlot("sourceVideo")[0] ?? null
    const maskAsset = inputAssetsForLegacySlot("mask")[0] ?? null
    const inputCombinationMode = selectedInputCombination.mode
    const parameters = {
      ...(rawDataRef.current.parameters && typeof rawDataRef.current.parameters === "object" && !Array.isArray(rawDataRef.current.parameters)
        ? rawDataRef.current.parameters as Record<string, unknown>
        : {}),
      aspectRatio,
      duration,
      resolution,
      inputCombinationMode,
      selectedInputCombination: selectedInputCombination.mode,
      modelSelectionID: selectedModelSelectionID,
      ...(selectedEndpoint ? { endpoint: selectedEndpoint } : {}),
      ...(selectedModel.offeringID ? { offeringID: selectedModel.offeringID } : {}),
      ...(selectedModel.providerModelID ? { providerModelID: selectedModel.providerModelID } : {}),
      userPrompt,
      sourceTextPrompts,
      inputSlots,
      ...(hasSourceImageInput && sourceImageAssetForPayload
        ? {
            sourceImageAssetID: sourceImageAssetForPayload.id,
            sourceImagePath: sourceImageAssetForPayload.path,
          }
        : {}),
      ...(startFrameAsset
        ? {
            startFrameAssetID: startFrameAsset.id,
            startFramePath: startFrameAsset.path,
          }
        : {}),
      ...(endFrameAsset
        ? {
            endFrameAssetID: endFrameAsset.id,
            endFramePath: endFrameAsset.path,
          }
        : {}),
      ...(referenceImageAssets.length > 0
        ? {
            referenceImageAssetID: referenceImageAssets[0]!.id,
            referenceImageAssetIDs,
            referenceImagePath: referenceImageAssets[0]!.path,
            referenceImagePaths,
          }
        : {}),
      ...(sourceVideoAsset
        ? {
            sourceVideoAssetID: sourceVideoAsset.id,
            sourceVideoPath: sourceVideoAsset.path,
          }
        : {}),
      ...(maskAsset
        ? {
            maskAssetID: maskAsset.id,
            maskPath: maskAsset.path,
          }
        : {}),
    }

    commitRawDataPatch({
      text: userPrompt,
      mode: inputCombinationMode,
      providerID: selectedProvider.manifest.id,
      modelID: selectedModelSelectionID,
      inputCombinationMode,
      endpoint: selectedEndpoint ?? null,
      aspectRatio,
      duration,
      resolution,
      parameters,
      sourceNodeIDs,
      sourceTextPrompts,
      status: "queued",
      error: null,
    })
    data.onCreateVideoGenerationTask?.(id, {
      taskNodeID: id,
      providerID: selectedProvider.manifest.id,
      modelID: selectedModelSelectionID,
      mode: inputCombinationMode,
      title: data.title,
      prompt,
      sourceNodeIDs,
      parameters,
    })
  }

  return (
    <>
      <input
        ref={videoInputImageInputRef}
        className="cinema-local-image-input"
        type="file"
        accept={LOCAL_IMAGE_FILE_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleVideoInputImageFileChange}
      />
      <Handle
        id="input"
        type="target"
        position={Position.Left}
        className="cinema-node-handle cinema-node-handle-input"
        style={inputHandleStyle}
      />
      {videoMediaInputs.map((input, index) => (
        <Handle
          key={input.inputKey}
          id={input.inputKey}
          type="target"
          position={Position.Left}
          className="cinema-node-handle cinema-node-handle-input cinema-node-handle-slot"
          style={{ ...accentStyle, top: `${58 + index * 14}%` }}
        />
      ))}
      <article className={`cinema-video-gen-node ${selected ? "is-selected" : ""}`} style={accentStyle}>
        <header className="cinema-video-gen-header">
          <span className="cinema-node-type">
            <Video size={14} aria-hidden="true" />
            <NodeTitleInput nodeID={id} title={data.title} onChangeTitle={data.onChangeTitle} />
          </span>
          <div className="cinema-node-header-actions">
            <span className={`cinema-video-gen-status is-${currentStatus}`}>
              {isBusy ? <Loader2 size={11} aria-hidden="true" className="is-spinning" /> : null}
              {currentStatus}
            </span>
            <NodeDeleteButton nodeID={id} onDeleteNode={data.onDeleteNode} />
          </div>
        </header>

        <section className="cinema-video-gen-preview" aria-label="Generated video preview">
          {previewSrc ? (
            <video src={previewSrc} controls preload="metadata" />
          ) : (
            <div className="cinema-video-gen-empty">
              <Play size={26} aria-hidden="true" />
              <span>{isWaiting ? "Waiting for output" : "No video yet"}</span>
            </div>
          )}
          {data.isCreatingVideoTask ? (
            <div className="cinema-image-gen-overlay" aria-live="polite">
              <Loader2 size={18} aria-hidden="true" className="is-spinning" />
              <span>Submitting</span>
            </div>
          ) : null}
        </section>

        <GenerationProgress progress={progress} status={currentStatus} />

        <section className="cinema-video-gen-composer nodrag nowheel" aria-label="Video generation controls">
          <div className="cinema-video-mode-tabs" role="tablist" aria-label="Video generation mode">
            {visibleModeContracts.map((contract) => (
              <button
                key={contract.mode}
                type="button"
                role="tab"
                aria-selected={mode === contract.mode}
                className={mode === contract.mode ? "is-active" : ""}
                disabled={isBusy}
                onClick={() => chooseMode(contract.mode)}
              >
                {contract.label}
              </button>
            ))}
          </div>
          {sourceTextParameters.length > 0 ? (
            <div className="cinema-video-gen-param-tags" aria-label="Connected text parameters">
              {sourceTextParameters.map((parameter) => (
                <span
                  key={parameter.edgeID}
                  className={`cinema-video-gen-param-tag ${parameter.text.trim() ? "" : "is-empty"}`}
                  title={parameter.text.trim() ? `${parameter.nodeTitle}: ${parameter.text.trim()}` : `${parameter.nodeTitle}: 空文本`}
                >
                  <FileText size={12} aria-hidden="true" />
                  <span>{parameter.nodeTitle}</span>
                  <button
                    type="button"
                    title={`移除文本参数 ${parameter.nodeTitle}`}
                    aria-label={`移除文本参数 ${parameter.nodeTitle}`}
                    disabled={isBusy}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      data.onDisconnectEdge?.(parameter.edgeID)
                    }}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            ref={promptRef}
            value={promptDraft}
            placeholder={modeContract.promptPlaceholder}
            spellCheck={false}
            disabled={isBusy}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const value = event.target.value
              setPromptDraft(value)
              if (!isPromptComposingRef.current) schedulePromptCommit(value)
            }}
            onCompositionStart={() => {
              isPromptComposingRef.current = true
              clearPromptCommitTimer()
            }}
            onCompositionEnd={(event) => {
              isPromptComposingRef.current = false
              const value = event.currentTarget.value
              setPromptDraft(value)
              commitRawDataPatch({ text: value })
            }}
            onBlur={() => {
              if (isPromptComposingRef.current) return
              clearPromptCommitTimer()
              commitRawDataPatch({ text: promptDraftRef.current })
            }}
          />
          {videoMediaInputs.length > 0 ? (
            <section className="cinema-video-input-slots" aria-label="Video input slots">
              {videoMediaInputs.flatMap((input) => {
                const slotAssets = inputAssetsForControl(input)
                const slotItems = input.slot === "referenceImage" && slotAssets.length > 0
                  ? slotAssets
                  : [slotAssets[0] ?? null]
                return slotItems.map((asset, assetIndex) => {
                  const preview = asset && data.agentBaseURL && data.projectID
                    ? projectAssetPreviewURL(data.agentBaseURL, data.projectID, asset.path)
                    : ""
                  const isVideoAsset = asset?.kind === "video" || input.slot === "sourceVideo"
                  const edgeID = asset?.edgeID ?? ""
                  const isRequired = input.required
                  const importSlot = canImportVideoInputLocalImage(input.slot) ? input.slot : null
                  const canImportLocalImage = importSlot !== null
                  const isImportingThisSlot = importSlot !== null && importingVideoInputImageSlot === importSlot
                  const isLocalImportedAsset = Boolean(asset && !edgeID && importSlot !== null && asset.nodeID === id)
                  const slotLabel = input.slot === "referenceImage" && asset
                    ? `${input.label} ${assetIndex + 1}/${input.maxCount ?? slotAssets.length}`
                    : input.slot === "referenceImage" && input.maxCount
                      ? `${input.label}（最多 ${input.maxCount} 张）`
                      : input.label
                  const slotValueTitle = asset ? `${asset.nodeTitle} · ${asset.path}` : input.emptyText
                  const slotActionLabel = asset ? `替换本地${input.label}图片` : `导入本地${input.label}图片`
                  const slotMainContent = (
                    <>
                      <div className="cinema-video-input-slot-thumb" aria-hidden="true">
                        {isImportingThisSlot ? (
                          <Loader2 size={14} aria-hidden="true" className="is-spinning" />
                        ) : preview && !isVideoAsset ? (
                          <img src={preview} alt="" draggable={false} />
                        ) : isVideoAsset ? (
                          <Video size={14} aria-hidden="true" />
                        ) : (
                          <Image size={14} aria-hidden="true" />
                        )}
                      </div>
                      <div className="cinema-video-input-slot-copy">
                        <span className="cinema-video-input-slot-label">
                          {slotLabel}
                        </span>
                        <span
                          className="cinema-video-input-slot-value"
                          title={slotValueTitle}
                        >
                          {asset ? slotValueTitle : input.emptyText}
                        </span>
                      </div>
                    </>
                  )
                  return (
                  <div
                    key={asset ? `${input.inputKey}-${asset.edgeID ?? sourceImageAssetKey(asset)}` : input.inputKey}
                    className={`cinema-video-input-slot ${asset ? "is-ready" : "is-missing"}`}
                  >
                    {canImportLocalImage ? (
                      <button
                        type="button"
                        className="cinema-video-input-slot-main cinema-video-input-slot-import"
                        title={slotActionLabel}
                        aria-label={slotActionLabel}
                        disabled={isBusy || importVideoInputImageMutation.isPending}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (!importSlot) return
                          openVideoInputImagePicker(importSlot)
                        }}
                      >
                        {slotMainContent}
                      </button>
                    ) : (
                      <div className="cinema-video-input-slot-main">
                        {slotMainContent}
                      </div>
                    )}
                    {edgeID || isLocalImportedAsset ? (
                      <button
                        type="button"
                        className="cinema-video-input-slot-remove"
                        title={edgeID ? `移除${input.label}` : `清除本地${input.label}图片`}
                        aria-label={edgeID ? `移除${input.label}` : `清除本地${input.label}图片`}
                        disabled={isBusy || importVideoInputImageMutation.isPending}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          if (edgeID) {
                            data.onDisconnectEdge?.(edgeID)
                            return
                          }
                          if (!importSlot) return
                          clearVideoInputLocalImage(importSlot)
                        }}
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    ) : isRequired ? (
                      <span className="cinema-video-input-slot-required">必填</span>
                    ) : null}
                  </div>
                )
                })
              })}
            </section>
          ) : null}
          <div className="cinema-video-gen-controls">
            <select
              aria-label="Video provider"
              value={selectedProvider?.manifest.id ?? ""}
              disabled={isBusy || availableProviders.length === 0}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => chooseProvider(event.target.value)}
            >
              {availableProviders.length > 0 ? availableProviders.map((provider) => (
                <option key={provider.manifest.id} value={provider.manifest.id}>{provider.manifest.name}</option>
              )) : (
                <option value="">No provider</option>
              )}
            </select>
            <select
              aria-label="Video model"
              value={selectedModelSelectionID}
              disabled={isBusy || !selectedProvider}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => chooseModel(event.target.value)}
            >
              {availableModels.length > 0 ? availableModels.map((model) => (
                <option key={providerModelSelectionID(model)} value={providerModelSelectionID(model)}>{model.label}</option>
              )) : (
                <option value="">No model</option>
              )}
            </select>
            <select
              aria-label="Aspect ratio"
              value={aspectRatioDraft}
              disabled={isBusy}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                setAspectRatioDraft(event.target.value)
                commitRawDataPatch({ aspectRatio: event.target.value })
              }}
            >
              {[...new Set([...(selectedModel?.aspectRatios ?? []), aspectRatioDraft, DEFAULT_VIDEO_ASPECT_RATIO].filter(Boolean))].map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <select
              aria-label="Duration"
              value={durationDraft}
              disabled={isBusy}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                setDurationDraft(event.target.value)
                commitRawDataPatch({ duration: Number.parseFloat(event.target.value) || DEFAULT_VIDEO_DURATION_SECONDS })
              }}
            >
              {[...new Set([...(selectedModel?.durations ?? []), Number.parseFloat(durationDraft) || DEFAULT_VIDEO_DURATION_SECONDS])]
                .filter((value) => Number.isFinite(value) && value > 0)
                .map((value) => (
                  <option key={value} value={String(value)}>{value}s</option>
                ))}
            </select>
            <select
              aria-label="Resolution"
              value={resolutionDraft}
              disabled={isBusy}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                setResolutionDraft(event.target.value)
                commitRawDataPatch({ resolution: event.target.value })
              }}
            >
              {[...new Set([...(selectedModel?.resolutions ?? []), resolutionDraft, DEFAULT_VIDEO_RESOLUTION].filter(Boolean))].map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <button
              type="button"
              className="cinema-video-gen-submit"
              title={submitDisabledReason ?? "Generate video"}
              aria-label="Generate video"
              disabled={!canGenerate}
              onClick={createTask}
            >
              {data.isCreatingVideoTask
                ? <Loader2 size={18} aria-hidden="true" className="is-spinning" />
                : <ArrowUp size={18} aria-hidden="true" />}
            </button>
          </div>
          {videoInputImageImportError || nodeError || unsupportedRequiredInput || requiredInputMissing || providerNeedsCredential && !providerConnected || providerAdapterUnavailable ? (
            <p className="cinema-video-gen-error" role="alert" title={videoInputImageImportError ?? nodeError ?? undefined}>
              {videoInputImageImportError ?? nodeError ?? (
                unsupportedRequiredInput
                  ? `Required input ${unsupportedRequiredInput.label} is not supported by this UI yet.`
                  : requiredInputMissing
                    ? canImportVideoInputLocalImage(missingRequiredInput?.slot ?? null)
                      ? `${missingRequiredInputLabel} needs an imported or connected image.`
                      : `${missingRequiredInputLabel} needs a connected input node.`
                    : providerAdapterUnavailable
                      ? `${selectedProvider?.manifest.name ?? "Provider"} does not have a generation runtime adapter yet.`
                      : `${selectedProvider?.manifest.name ?? "Provider"} is not connected.`
              )}
            </p>
          ) : null}
        </section>
      </article>
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className="cinema-node-handle cinema-node-handle-output"
        style={accentStyle}
      />
    </>
  )
}

function LocalImageCanvasNode({
  id,
  data,
  selected,
  accentStyle,
}: {
  id: string
  data: CinemaFlowNodeData
  selected?: boolean
  accentStyle: CSSProperties
}) {
  const asset = readLocalImageAsset(data.rawData)
  const [hasPreviewError, setHasPreviewError] = useState(false)
  const previewSrc = asset && data.agentBaseURL && data.projectID
    ? projectAssetPreviewURL(data.agentBaseURL, data.projectID, asset.path)
    : ""
  const previewAspectRatio = asset?.width && asset.height ? `${asset.width} / ${asset.height}` : null
  const previewStyle = previewAspectRatio
    ? { "--cinema-local-image-aspect-ratio": previewAspectRatio } as CSSProperties
    : undefined
  const fileName = readRawString(data.rawData, "sourceFileName", data.title)
  const meta = asset
    ? [
      asset.width && asset.height ? `${asset.width}x${asset.height}` : "",
      formatFileSize(asset.sizeBytes),
    ].filter(Boolean).join(" · ")
    : ""

  useEffect(() => {
    setHasPreviewError(false)
  }, [previewSrc])

  return (
    <>
      <Handle
        id="input"
        type="target"
        position={Position.Left}
        className="cinema-node-handle cinema-node-handle-input"
        style={accentStyle}
      />
      <article
        className={`cinema-local-image-node ${selected ? "is-selected" : ""}`}
        style={accentStyle}
      >
        <header className="cinema-local-image-header">
          <span className="cinema-node-type">
            <Image size={14} aria-hidden="true" />
            <NodeTitleInput nodeID={id} title={data.title} onChangeTitle={data.onChangeTitle} />
          </span>
          <NodeDeleteButton nodeID={id} onDeleteNode={data.onDeleteNode} />
        </header>

        <section className="cinema-local-image-frame" aria-label="Image preview" style={previewStyle}>
          {previewSrc && !hasPreviewError ? (
            <img
              src={previewSrc}
              alt={fileName}
              draggable={false}
              onError={() => setHasPreviewError(true)}
            />
          ) : (
            <div className={`cinema-local-image-empty ${hasPreviewError ? "is-error" : ""}`}>
              <Image size={28} aria-hidden="true" />
              <span>{hasPreviewError ? "Image unavailable" : "No image selected"}</span>
            </div>
          )}
        </section>

        {asset ? (
          <footer className="cinema-local-image-meta">
            <span title={asset.path}>{asset.path}</span>
            {meta ? <small>{meta}</small> : null}
          </footer>
        ) : null}
      </article>
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className="cinema-node-handle cinema-node-handle-output"
        style={accentStyle}
      />
    </>
  )
}

function createCustomNodeFromDefinition(
  definition: CinemaCustomNodeDefinition,
  position: { x: number; y: number },
): CinemaFlowNode {
  const type = "custom-node" satisfies CinemaNodeType
  const id = makeNodeID(type)
  const size = DEFAULT_NODE_SIZE[type]
  return {
    id,
    type: "cinemaNode",
    position,
    style: flowNodeStyle(type, size),
    data: {
      cinemaType: type,
      title: definition.title,
      rawData: defaultCustomApiRawData(id, definition),
      size,
    },
  }
}

function CustomApiCanvasNode({
  id,
  data,
  selected,
  accentStyle,
}: {
  id: string
  data: CinemaFlowNodeData
  selected: boolean
  accentStyle: CSSProperties
}) {
  const rawDataRef = useRef(data.rawData)
  const [inputValues, setInputValues] = useState<Record<string, unknown>>(() => readRawRecord(data.rawData, "inputValues"))
  const [schemaDraft, setSchemaDraft] = useState(() => stringifyJson(readRawRecord(data.rawData, "inputSchema")))
  const [urlDraft, setUrlDraft] = useState(() => readRawString(readRawRecord(data.rawData, "request"), "url"))
  const [timeoutDraft, setTimeoutDraft] = useState(() => String(readRawNumber(readRawRecord(data.rawData, "request"), "timeoutMs", 30000)))
  const [headersDraft, setHeadersDraft] = useState(() => stringifyJson(readRawRecord(readRawRecord(data.rawData, "request"), "headersTemplate")))
  const [bodyDraft, setBodyDraft] = useState(() => stringifyJson(readRawRecord(data.rawData, "request").bodyTemplate ?? {}))
  const [mappingDraft, setMappingDraft] = useState(() => stringifyJson(readRawRecord(data.rawData, "outputMapping")))
  const [authType, setAuthType] = useState(() => readRawString(readRawRecord(data.rawData, "auth"), "type", "none"))
  const [authHeaderName, setAuthHeaderName] = useState(() => readRawString(readRawRecord(data.rawData, "auth"), "headerName", "X-API-Key"))
  const [apiKeyDraft, setApiKeyDraft] = useState("")
  const [credentialState, setCredentialState] = useState<CinemaCustomApiAuthState | null>(null)
  const [preview, setPreview] = useState<CinemaCustomApiRunResult | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const isCustomNode = data.cinemaType === "custom-node"
  const RuntimeIcon = isCustomNode ? Braces : Server
  const runtimeLabel = isCustomNode ? "Custom Node" : "Custom API"
  const status = readRawString(data.rawData, "status", "idle")
  const outputText = readRawString(data.rawData, "outputText")
  const outputImageUrl = readRawString(data.rawData, "outputImageUrl")
  const outputJson = data.rawData.outputJson
  const definitionID = readRawString(data.rawData, "definitionID")
  const nodeError = data.customApiError ?? localError ?? readRawString(data.rawData, "error")
  const isBusy = Boolean(data.isRunningCustomApi)

  useEffect(() => {
    rawDataRef.current = data.rawData
    setInputValues(readRawRecord(data.rawData, "inputValues"))
    setSchemaDraft(stringifyJson(readRawRecord(data.rawData, "inputSchema")))
    setUrlDraft(readRawString(readRawRecord(data.rawData, "request"), "url"))
    setTimeoutDraft(String(readRawNumber(readRawRecord(data.rawData, "request"), "timeoutMs", 30000)))
    setHeadersDraft(stringifyJson(readRawRecord(readRawRecord(data.rawData, "request"), "headersTemplate")))
    setBodyDraft(stringifyJson(readRawRecord(data.rawData, "request").bodyTemplate ?? {}))
    setMappingDraft(stringifyJson(readRawRecord(data.rawData, "outputMapping")))
    setAuthType(readRawString(readRawRecord(data.rawData, "auth"), "type", "none"))
    setAuthHeaderName(readRawString(readRawRecord(data.rawData, "auth"), "headerName", "X-API-Key"))
  }, [data.rawData])

  const commitRawDataPatch = useCallback((patch: Record<string, unknown>) => {
    const next = {
      ...rawDataRef.current,
      ...patch,
    }
    rawDataRef.current = next
    data.onChangeRawData?.(id, next)
  }, [data, id])

  const parseDraft = useCallback((label: string, draft: string) => {
    try {
      return JSON.parse(draft)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON"
      setLocalError(`${label} JSON is invalid: ${message}`)
      return undefined
    }
  }, [])

  const commitConfigDrafts = useCallback(() => {
    const inputSchema = parseDraft("Input schema", schemaDraft)
    const headersTemplate = parseDraft("Headers", headersDraft)
    const bodyTemplate = parseDraft("Body template", bodyDraft)
    const outputMapping = parseDraft("Output mapping", mappingDraft)
    if (
      inputSchema === undefined ||
      headersTemplate === undefined ||
      bodyTemplate === undefined ||
      outputMapping === undefined
    ) {
      return false
    }
    if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
      setLocalError("Input schema must be a JSON object.")
      return false
    }
    if (!headersTemplate || typeof headersTemplate !== "object" || Array.isArray(headersTemplate)) {
      setLocalError("Headers must be a JSON object.")
      return false
    }
    if (!outputMapping || typeof outputMapping !== "object" || Array.isArray(outputMapping)) {
      setLocalError("Output mapping must be a JSON object.")
      return false
    }

    const currentRequest = readRawRecord(rawDataRef.current, "request")
    const currentAuth = readRawRecord(rawDataRef.current, "auth")
    const timeoutMs = Number(timeoutDraft)
    commitRawDataPatch({
      inputSchema,
      request: {
        ...currentRequest,
        method: "POST",
        url: urlDraft.trim(),
        headersTemplate,
        bodyTemplate,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 30000,
      },
      auth: {
        ...currentAuth,
        type: authType,
        credentialProviderID: readRawString(currentAuth, "credentialProviderID", customApiCredentialProviderID(id)),
        headerName: authHeaderName.trim() || "X-API-Key",
      },
      outputMapping,
    })
    setLocalError(null)
    return true
  }, [authHeaderName, authType, bodyDraft, commitRawDataPatch, headersDraft, id, mappingDraft, parseDraft, schemaDraft, timeoutDraft, urlDraft])

  const updateInputValue = (key: string, value: unknown) => {
    const next = {
      ...inputValues,
      [key]: value,
    }
    setInputValues(next)
    commitRawDataPatch({ inputValues: next })
  }

  const inputSchema = parseJsonObjectDraft(schemaDraft, readRawRecord(data.rawData, "inputSchema"))
  const schemaProperties = customApiSchemaProperties(inputSchema)
  const fieldEntries = Object.entries(schemaProperties)

  const run = async (mode: CustomApiRunMode) => {
    if (!commitConfigDrafts()) return
    const result = await data.onRunCustomApi?.(id, {
      mode,
      inputValues,
    })
    if (result) setPreview(result)
  }

  const saveApiKey = async () => {
    if (!commitConfigDrafts()) return
    const result = await data.onSaveCustomApiKey?.(id, {
      apiKey: apiKeyDraft.trim() || null,
    })
    if (result) {
      setCredentialState(result)
      setApiKeyDraft("")
      setLocalError(null)
    }
  }

  const saveDefinition = async () => {
    if (!commitConfigDrafts()) return
    const result = await data.onSaveCustomNodeDefinition?.(id, {
      title: data.title,
      rawData: rawDataRef.current,
    })
    if (result) {
      setLocalError(null)
    }
  }

  return (
    <>
      <Handle
        id="input"
        type="target"
        position={Position.Left}
        className="cinema-node-handle cinema-node-handle-input"
        style={accentStyle}
      />
      <article
        className={`cinema-custom-api-node ${selected ? "is-selected" : ""}`}
        style={accentStyle}
      >
        <header className="cinema-node-header">
          <span className="cinema-node-type">
            <RuntimeIcon size={14} aria-hidden="true" />
            <NodeTitleInput nodeID={id} title={data.title} onChangeTitle={data.onChangeTitle} />
          </span>
          <div className="cinema-node-header-actions">
            {definitionID ? <span className="cinema-node-status">defined</span> : null}
            <span className={`cinema-node-status is-${isBusy ? "running" : status}`}>
              {isBusy ? "running" : status}
            </span>
            <NodeDeleteButton nodeID={id} onDeleteNode={data.onDeleteNode} />
          </div>
        </header>

        <section className="cinema-custom-api-inputs nodrag nowheel" aria-label={`${runtimeLabel} inputs`}>
          <div className="cinema-custom-api-section-title">
            <Braces size={13} aria-hidden="true" />
            <span>Inputs</span>
          </div>
          {fieldEntries.length > 0 ? fieldEntries.map(([key, spec]) => {
            const label = customApiFieldLabel(key, spec)
            const fieldType = customApiFieldType(spec)
            const enumValues = customApiFieldEnum(spec)
            const value = inputValues[key]
            if (enumValues.length > 0) {
              return (
                <label key={key} className="cinema-custom-api-field">
                  <span>{label}</span>
                  <select
                    value={typeof value === "string" ? value : ""}
                    disabled={isBusy}
                    onChange={(event) => updateInputValue(key, event.target.value)}
                  >
                    <option value="">Select</option>
                    {enumValues.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              )
            }
            if (fieldType === "boolean") {
              return (
                <label key={key} className="cinema-custom-api-check-field">
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    disabled={isBusy}
                    onChange={(event) => updateInputValue(key, event.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              )
            }
            return (
              <label key={key} className="cinema-custom-api-field">
                <span>{label}</span>
                <input
                  type={fieldType === "number" || fieldType === "integer" ? "number" : "text"}
                  value={value === undefined || value === null ? "" : String(value)}
                  disabled={isBusy}
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => {
                    const nextValue = fieldType === "number" || fieldType === "integer"
                      ? Number(event.target.value)
                      : event.target.value
                    updateInputValue(key, nextValue)
                  }}
                />
              </label>
            )
          }) : (
            <p className="cinema-custom-api-empty">No input fields.</p>
          )}
        </section>

        <section className="cinema-custom-api-config nodrag nowheel" aria-label={`${runtimeLabel} request configuration`}>
          <label className="cinema-custom-api-field">
            <span>URL</span>
            <input
              value={urlDraft}
              disabled={isBusy}
              spellCheck={false}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(event) => setUrlDraft(event.target.value)}
              onBlur={commitConfigDrafts}
            />
          </label>
          <div className="cinema-custom-api-grid">
            <label className="cinema-custom-api-field">
              <span>Auth</span>
              <select
                value={authType}
                disabled={isBusy}
                onChange={(event) => setAuthType(event.target.value)}
                onBlur={commitConfigDrafts}
              >
                <option value="none">None</option>
                <option value="bearer">Bearer</option>
                <option value="api-key-header">API key header</option>
              </select>
            </label>
            <label className="cinema-custom-api-field">
              <span>Header</span>
              <input
                value={authHeaderName}
                disabled={isBusy || authType !== "api-key-header"}
                spellCheck={false}
                onKeyDown={(event) => event.stopPropagation()}
                onChange={(event) => setAuthHeaderName(event.target.value)}
                onBlur={commitConfigDrafts}
              />
            </label>
            <label className="cinema-custom-api-field">
              <span>Timeout</span>
              <input
                value={timeoutDraft}
                disabled={isBusy}
                inputMode="numeric"
                onKeyDown={(event) => event.stopPropagation()}
                onChange={(event) => setTimeoutDraft(event.target.value)}
                onBlur={commitConfigDrafts}
              />
            </label>
          </div>
          {authType !== "none" ? (
            <div className="cinema-custom-api-key-row">
              <KeyRound size={13} aria-hidden="true" />
              <input
                type="password"
                value={apiKeyDraft}
                disabled={isBusy}
                placeholder={credentialState?.connected ? "API key saved" : "API key"}
                onKeyDown={(event) => event.stopPropagation()}
                onChange={(event) => setApiKeyDraft(event.target.value)}
              />
              <button type="button" disabled={isBusy} onClick={() => void saveApiKey()}>
                Save
              </button>
            </div>
          ) : null}
          <div className="cinema-custom-api-json-grid">
            <label>
              <span>Input schema</span>
              <textarea value={schemaDraft} disabled={isBusy} spellCheck={false} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => setSchemaDraft(event.target.value)} onBlur={commitConfigDrafts} />
            </label>
            <label>
              <span>Headers</span>
              <textarea value={headersDraft} disabled={isBusy} spellCheck={false} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => setHeadersDraft(event.target.value)} onBlur={commitConfigDrafts} />
            </label>
            <label>
              <span>Body template</span>
              <textarea value={bodyDraft} disabled={isBusy} spellCheck={false} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => setBodyDraft(event.target.value)} onBlur={commitConfigDrafts} />
            </label>
            <label>
              <span>Output mapping</span>
              <textarea value={mappingDraft} disabled={isBusy} spellCheck={false} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => setMappingDraft(event.target.value)} onBlur={commitConfigDrafts} />
            </label>
          </div>
        </section>

        <footer className="cinema-custom-api-footer nodrag nowheel">
          <button type="button" disabled={isBusy} onClick={() => void saveDefinition()}>
            <Braces size={14} aria-hidden="true" />
            <span>Save Definition</span>
          </button>
          <button type="button" disabled={isBusy} onClick={() => void run("preview")}>
            <Code2 size={14} aria-hidden="true" />
            <span>Preview</span>
          </button>
          <button type="button" className="is-primary" disabled={isBusy || !urlDraft.trim()} onClick={() => void run("run")}>
            {isBusy ? <Loader2 size={14} aria-hidden="true" className="is-spinning" /> : <Play size={14} aria-hidden="true" />}
            <span>Run</span>
          </button>
        </footer>

        {nodeError ? (
          <p className="cinema-custom-api-error nodrag nowheel" role="alert" title={nodeError}>
            {nodeError}
          </p>
        ) : null}

        {preview || outputText || outputImageUrl || outputJson !== undefined ? (
          <section className="cinema-custom-api-output nodrag nowheel" aria-label={`${runtimeLabel} output`}>
            {preview ? (
              <details>
                <summary>Request preview</summary>
                <pre>{stringifyJson(preview.requestPreview)}</pre>
              </details>
            ) : null}
            {outputText ? <p>{outputText}</p> : null}
            {outputImageUrl ? <span title={outputImageUrl}>{outputImageUrl}</span> : null}
            {outputJson !== undefined ? (
              <details>
                <summary>JSON output</summary>
                <pre>{stringifyJson(outputJson)}</pre>
              </details>
            ) : null}
          </section>
        ) : null}
      </article>
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className="cinema-node-handle cinema-node-handle-output"
        style={accentStyle}
      />
    </>
  )
}

function CinemaNodeCard({ id, data, selected }: NodeProps<CinemaFlowNode>) {
  const meta = NODE_META[data.cinemaType]
  const Icon = meta.icon
  const text = typeof data.rawData.text === "string" && data.rawData.text.trim()
    ? data.rawData.text.trim()
    : typeof data.rawData.placeholder === "string"
      ? data.rawData.placeholder
      : meta.placeholder
  const status = typeof data.rawData.status === "string" ? data.rawData.status : null
  const accentStyle = { "--node-accent": meta.accent } as CSSProperties

  if (data.cinemaType === "text") {
    return <TextCanvasNode id={id} data={data} selected={selected} accentStyle={accentStyle} />
  }

  if (data.cinemaType === "image") {
    return <ImageGenerationCanvasNode id={id} data={data} selected={selected} accentStyle={accentStyle} />
  }

  if (data.cinemaType === "local-image") {
    return <LocalImageCanvasNode id={id} data={data} selected={selected} accentStyle={accentStyle} />
  }

  if (data.cinemaType === "video") {
    return <VideoGenerationCanvasNode id={id} data={data} selected={selected} accentStyle={accentStyle} />
  }

  if (data.cinemaType === "custom-api" || data.cinemaType === "custom-node") {
    return <CustomApiCanvasNode id={id} data={data} selected={selected} accentStyle={accentStyle} />
  }

  return (
    <>
      <Handle
        id="input"
        type="target"
        position={Position.Left}
        className="cinema-node-handle cinema-node-handle-input"
        style={accentStyle}
      />
      <article
        className={`cinema-node ${selected ? "is-selected" : ""}`}
        style={accentStyle}
      >
        <header className="cinema-node-header">
          <span className="cinema-node-type">
            <Icon size={14} aria-hidden="true" />
            {meta.label}
          </span>
          <div className="cinema-node-header-actions">
            {status ? <span className="cinema-node-status">{status}</span> : null}
            <NodeDeleteButton nodeID={id} onDeleteNode={data.onDeleteNode} />
          </div>
        </header>
        <div className="cinema-node-preview">
          <Icon size={28} aria-hidden="true" />
        </div>
        <footer className="cinema-node-footer">
          <NodeTitleInput nodeID={id} title={data.title} onChangeTitle={data.onChangeTitle} />
          <span>{text}</span>
        </footer>
      </article>
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className="cinema-node-handle cinema-node-handle-output"
        style={accentStyle}
      />
    </>
  )
}

const nodeTypes = {
  cinemaNode: CinemaNodeCard,
}

function ProjectFileBrowser({
  projectID,
  agentBaseURL,
  onClose,
}: {
  projectID: string
  agentBaseURL: string
  onClose: () => void
}) {
  const [currentPath, setCurrentPath] = useState("")
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const listingQuery = useQuery({
    queryKey: ["cinema-project-files", agentBaseURL, projectID, currentPath],
    enabled: Boolean(projectID),
    queryFn: () => requestJson<CinemaProjectDirectoryListing>(agentBaseURL, projectFilesPath(projectID, currentPath)),
  })
  const listing = listingQuery.data
  const selectedEntry = listing?.entries.find((entry) => entry.path === selectedPath) ?? null
  const segments = filePathSegments(listing?.path ?? currentPath)
  const canGoUp = Boolean(listing?.parentPath !== null && listing?.parentPath !== undefined)
  const isPreviewImage = selectedEntry?.previewable && selectedEntry.mimeType?.startsWith("image/")
  const isPreviewVideo = selectedEntry?.previewable && selectedEntry.mimeType?.startsWith("video/")
  const selectedPreviewSrc = selectedEntry?.previewable
    ? projectAssetPreviewURL(agentBaseURL, projectID, selectedEntry.path)
    : ""

  useEffect(() => {
    setSelectedPath(null)
  }, [currentPath])

  const openEntry = (entry: CinemaProjectDirectoryEntry) => {
    if (entry.kind === "directory") {
      setCurrentPath(entry.path)
      return
    }
    setSelectedPath(entry.path)
  }

  const openBreadcrumb = (index: number) => {
    if (index < 0) {
      setCurrentPath("")
      return
    }
    setCurrentPath(segments.slice(0, index + 1).join("/"))
  }

  return (
    <aside
      id="cinema-file-browser"
      className="cinema-file-browser"
      aria-label="项目文件"
      onClick={(event) => event.stopPropagation()}
    >
      <header className="cinema-file-browser-header">
        <div>
          <span>本项目</span>
          <strong>项目文件</strong>
        </div>
        <div className="cinema-file-browser-actions">
          <button
            type="button"
            className="cinema-file-icon-button"
            title="Back"
            aria-label="Back"
            disabled={!canGoUp}
            onClick={() => listing?.parentPath !== undefined && setCurrentPath(listing.parentPath ?? "")}
          >
            <ArrowLeft size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="cinema-file-icon-button"
            title="Refresh"
            aria-label="Refresh"
            disabled={listingQuery.isFetching}
            onClick={() => void listingQuery.refetch()}
          >
            {listingQuery.isFetching
              ? <Loader2 size={15} aria-hidden="true" className="is-spinning" />
              : <RefreshCw size={15} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="cinema-file-icon-button"
            title="Close"
            aria-label="Close file browser"
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav className="cinema-file-breadcrumbs" aria-label="Folder path">
        <button type="button" onClick={() => openBreadcrumb(-1)}>root</button>
        {segments.map((segment, index) => (
          <button key={`${segment}-${index}`} type="button" onClick={() => openBreadcrumb(index)}>
            {segment}
          </button>
        ))}
      </nav>

      <div className="cinema-file-list" aria-busy={listingQuery.isFetching}>
        {listingQuery.isLoading ? (
          <div className="cinema-file-browser-state">
            <Loader2 size={16} aria-hidden="true" className="is-spinning" />
            <span>Loading files</span>
          </div>
        ) : listingQuery.error ? (
          <div className="cinema-file-browser-state is-error" role="alert">
            <span>{listingQuery.error instanceof Error ? listingQuery.error.message : "Could not load files"}</span>
          </div>
        ) : listing && listing.entries.length === 0 ? (
          <div className="cinema-file-browser-state">
            <Folder size={16} aria-hidden="true" />
            <span>Empty folder</span>
          </div>
        ) : (
          <>
            {listing?.entries.map((entry) => {
              const Icon = entry.kind === "directory"
                ? Folder
                : entry.mimeType?.startsWith("image/")
                  ? Image
                  : entry.mimeType?.startsWith("video/")
                    ? Video
                    : File
              return (
                <button
                  key={entry.path}
                  type="button"
                  className={`cinema-file-row ${entry.path === selectedPath ? "is-selected" : ""}`}
                  title={entry.path}
                  onClick={() => openEntry(entry)}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{entry.name}</span>
                  <small>{entry.kind === "directory" ? "Folder" : formatFileSize(entry.sizeBytes)}</small>
                </button>
              )
            })}
            {listing?.truncated ? (
              <p className="cinema-file-browser-note">Showing first 250 items.</p>
            ) : null}
          </>
        )}
      </div>

      <section className="cinema-file-preview" aria-label="Selected file">
        {selectedEntry ? (
          <>
            <div className="cinema-file-preview-meta">
              <strong title={selectedEntry.path}>{selectedEntry.name}</strong>
              <span>{[formatFileSize(selectedEntry.sizeBytes), formatFileTimestamp(selectedEntry.modifiedAt)].filter(Boolean).join(" · ")}</span>
            </div>
            {isPreviewImage ? (
              <img src={selectedPreviewSrc} alt={selectedEntry.name} draggable={false} />
            ) : isPreviewVideo ? (
              <video src={selectedPreviewSrc} controls preload="metadata" />
            ) : (
              <div className="cinema-file-preview-empty">
                <File size={18} aria-hidden="true" />
                <span>{selectedEntry.path}</span>
              </div>
            )}
          </>
        ) : (
          <div className="cinema-file-preview-empty">
            <File size={18} aria-hidden="true" />
            <span>No file selected</span>
          </div>
        )}
      </section>
    </aside>
  )
}

function ContextMenu({
  menu,
  customNodeDefinitions,
  onAddNode,
  onAddCustomNodeFromDefinition,
  onImportLocalImageNode,
  onClose,
  isImportingLocalImage,
}: {
  menu: ContextMenuState
  customNodeDefinitions: CinemaCustomNodeDefinition[]
  onAddNode: (type: CinemaNodeType, position: { x: number; y: number }) => void
  onAddCustomNodeFromDefinition: (definition: CinemaCustomNodeDefinition, position: { x: number; y: number }) => void
  onImportLocalImageNode: (position: { x: number; y: number }) => void
  onClose: () => void
  isImportingLocalImage: boolean
}) {
  if (!menu) return null

  return (
    <div className="cinema-context-menu" style={{ left: menu.x, top: menu.y }} role="menu">
      <button
        type="button"
        role="menuitem"
        disabled={isImportingLocalImage}
        onClick={() => {
          onImportLocalImageNode({ x: menu.flowX, y: menu.flowY })
          onClose()
        }}
      >
        {isImportingLocalImage
          ? <Loader2 size={15} aria-hidden="true" className="is-spinning" />
          : <Upload size={15} aria-hidden="true" />}
        <span>Add Image</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onAddNode("custom-node", { x: menu.flowX, y: menu.flowY })
          onClose()
        }}
      >
        <Braces size={15} aria-hidden="true" />
        <span>Define Custom Node</span>
      </button>
      {customNodeDefinitions.length > 0 ? (
        <>
          <div className="cinema-context-menu-separator" role="separator" />
          {customNodeDefinitions.map((definition) => (
            <button
              key={definition.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onAddCustomNodeFromDefinition(definition, { x: menu.flowX, y: menu.flowY })
                onClose()
              }}
            >
              <Braces size={15} aria-hidden="true" />
              <span>Add {definition.title}</span>
            </button>
          ))}
          <div className="cinema-context-menu-separator" role="separator" />
        </>
      ) : null}
      {NODE_TYPES.map((type) => {
        const meta = NODE_META[type]
        const Icon = meta.icon
        return (
          <button
            key={type}
            type="button"
            role="menuitem"
            onClick={() => {
              onAddNode(type, { x: menu.flowX, y: menu.flowY })
              onClose()
            }}
          >
            <Icon size={15} aria-hidden="true" />
            <span>Add {meta.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function CanvasPanelNavigation({
  activePanel,
  onTogglePanel,
}: {
  activePanel: CanvasPanel | null
  onTogglePanel: (panel: CanvasPanel) => void
}) {
  const isFilesOpen = activePanel === "files"

  return (
    <nav
      className="cinema-canvas-nav"
      aria-label="Canvas panels"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`cinema-canvas-nav-button ${isFilesOpen ? "is-active" : ""}`}
        title={isFilesOpen ? "关闭项目文件" : "打开项目文件"}
        aria-label={isFilesOpen ? "关闭项目文件" : "打开项目文件"}
        aria-controls="cinema-file-browser"
        aria-expanded={isFilesOpen}
        aria-pressed={isFilesOpen}
        onClick={() => onTogglePanel("files")}
      >
        <Folder size={18} aria-hidden="true" />
      </button>
    </nav>
  )
}

export function App() {
  const { projectID, agentBaseURL } = useMemo(readSearchParams, [])
  const selectedNodeID = useUiStore((state) => state.selectedNodeID)
  const setSelectedNodeID = useUiStore((state) => state.setSelectedNodeID)
  const reactFlow = useReactFlow<CinemaFlowNode, Edge>()
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<CinemaFlowNode, Edge> | null>(null)
  const [nodes, setNodes] = useState<CinemaFlowNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [customNodeDefinitions, setCustomNodeDefinitions] = useState<CinemaCustomNodeDefinition[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [activeCanvasPanel, setActiveCanvasPanel] = useState<CanvasPanel | null>("files")
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [, setSaveError] = useState<string | null>(null)
  const [autoRefreshingTaskIDs, setAutoRefreshingTaskIDs] = useState<string[]>([])
  const [textGenerationNodeID, setTextGenerationNodeID] = useState<string | null>(null)
  const [textGenerationError, setTextGenerationError] = useState<{ nodeID: string; message: string } | null>(null)
  const [imageGenerationNodeID, setImageGenerationNodeID] = useState<string | null>(null)
  const [imageGenerationError, setImageGenerationError] = useState<{ nodeID: string; message: string } | null>(null)
  const [videoGenerationNodeID, setVideoGenerationNodeID] = useState<string | null>(null)
  const [videoGenerationError, setVideoGenerationError] = useState<{ nodeID: string; message: string } | null>(null)
  const [customApiNodeID, setCustomApiNodeID] = useState<string | null>(null)
  const [customApiError, setCustomApiError] = useState<{ nodeID: string; message: string } | null>(null)
  const saveStateRef = useRef<SaveState>("idle")
  const autoRefreshInFlightRef = useRef(false)
  const nodePatchTimersRef = useRef(new Map<string, number>())
  const nodePatchQueueRef = useRef(new Map<string, CinemaNodePatch>())
  const eventCursorRef = useRef<number | null>(null)
  const localImageInputRef = useRef<HTMLInputElement | null>(null)
  const pendingLocalImagePositionRef = useRef<{ x: number; y: number } | null>(null)

  const applyCanvas = useCallback((canvas: CinemaCanvasDocument) => {
    setNodes(toFlowNodes(canvas))
    setEdges(canvas.edges)
    setCustomNodeDefinitions(canvas.customNodeDefinitions ?? [])
    saveStateRef.current = "saved"
    setSaveState("saved")
    setSaveError(null)
  }, [])

  const projectQuery = useQuery({
    queryKey: ["cinema-project", agentBaseURL, projectID],
    enabled: Boolean(projectID),
    queryFn: () => requestJson<CinemaProjectSummary>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}`),
  })

  const canvasQuery = useQuery({
    queryKey: ["cinema-canvas", agentBaseURL, projectID],
    enabled: Boolean(projectID) && projectQuery.data?.initialized === true,
    queryFn: () => requestJson<CinemaCanvasDocument>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}/canvas`),
  })
  const refetchCanvas = canvasQuery.refetch

  const providersQuery = useQuery({
    queryKey: ["cinema-video-providers", agentBaseURL, projectID],
    enabled: Boolean(projectID) && projectQuery.data?.initialized === true,
    queryFn: () => requestJson<CinemaVideoProvider[]>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}/video-providers`),
  })
  const refetchProviders = providersQuery.refetch

  const textModelsQuery = useQuery({
    queryKey: ["cinema-text-models", agentBaseURL, projectID],
    enabled: Boolean(projectID) && projectQuery.data?.initialized === true,
    queryFn: () => requestJson<CinemaTextModelsResult>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}/text-models`),
  })
  const refetchTextModels = textModelsQuery.refetch

  const imageModelsQuery = useQuery({
    queryKey: ["cinema-image-models", agentBaseURL, projectID],
    enabled: Boolean(projectID) && projectQuery.data?.initialized === true,
    queryFn: () => requestJson<CinemaImageModelsResult>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}/image-models`),
  })
  const refetchImageModels = imageModelsQuery.refetch

  const tasksQuery = useQuery({
    queryKey: ["cinema-generation-tasks", agentBaseURL, projectID],
    enabled: Boolean(projectID) && projectQuery.data?.initialized === true,
    queryFn: () => requestJson<CinemaGenerationTask[]>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}/generation-tasks`),
  })
  const refetchTasks = tasksQuery.refetch

  const commandMutation = useMutation({
    mutationFn: (command: CinemaCommand) =>
      requestJson<CinemaCommandResult>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}/commands`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
    }),
    onMutate: () => {
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: (result) => {
      if (saveStateRef.current === "dirty" || nodePatchQueueRef.current.size > 0 || nodePatchTimersRef.current.size > 0) {
        saveStateRef.current = "dirty"
        setSaveState("dirty")
        return
      }
      applyCanvas(result.canvas)
    },
    onError: (error) => {
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(error instanceof Error ? error.message : "Command failed")
    },
  })

  const refetchRuntimeState = useCallback(async () => {
    await Promise.all([
      refetchCanvas(),
      refetchTasks(),
      refetchProviders(),
      refetchTextModels(),
      refetchImageModels(),
    ])
  }, [refetchCanvas, refetchImageModels, refetchProviders, refetchTasks, refetchTextModels])

  const createGenerationTaskMutation = useMutation({
    mutationFn: async ({ body, draftNodeID }: { body: CreateCinemaGenerationTaskBody; draftNodeID: string }) => {
      await flushNodePatch(draftNodeID)
      return await requestJson<CinemaGenerationTask>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}/generation-tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
    },
    onMutate: ({ draftNodeID }) => {
      setVideoGenerationNodeID(draftNodeID)
      setVideoGenerationError(null)
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: async (task, variables) => {
      if (variables.draftNodeID !== task.taskNodeID) {
        commandMutation.mutate({
          id: makeCommandID("delete-node"),
          type: "delete-node",
          actor: "cinema-web",
          nodeID: variables.draftNodeID,
        })
      }
      if (task.taskNodeID) setSelectedNodeID(task.taskNodeID)
      await refetchRuntimeState()
      saveStateRef.current = "saved"
      setSaveState("saved")
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : "Task creation failed"
      const failedNode = nodes.find((node) => node.id === variables.draftNodeID)
      if (failedNode) {
        const failedRawData = {
          ...failedNode.data.rawData,
          status: "failed",
          error: message,
        }
        setNodes((current) =>
          current.map((node) =>
            node.id === variables.draftNodeID
              ? {
                ...node,
                data: {
                  ...node.data,
                  rawData: {
                    ...node.data.rawData,
                    status: "failed",
                    error: message,
                  },
                },
              }
              : node
          )
        )
        queueNodePatch(variables.draftNodeID, { data: failedRawData })
      }
      setVideoGenerationError({ nodeID: variables.draftNodeID, message })
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(message)
    },
    onSettled: () => {
      setVideoGenerationNodeID(null)
    },
  })

  const refreshGenerationTaskMutation = useMutation({
    mutationFn: (taskID: string) =>
      requestJson<CinemaGenerationTask>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}/generation-tasks/${encodeURIComponent(taskID)}/refresh`, {
        method: "POST",
      }),
    onMutate: () => {
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: async (task) => {
      if (task.taskNodeID) setSelectedNodeID(task.taskNodeID)
      await refetchRuntimeState()
      saveStateRef.current = "saved"
      setSaveState("saved")
    },
    onError: (error) => {
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(error instanceof Error ? error.message : "Task refresh failed")
    },
  })

  const cancelGenerationTaskMutation = useMutation({
    mutationFn: (taskID: string) =>
      requestJson<CinemaGenerationTask>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}/generation-tasks/${encodeURIComponent(taskID)}/cancel`, {
        method: "POST",
      }),
    onMutate: () => {
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: async (task) => {
      if (task.taskNodeID) setSelectedNodeID(task.taskNodeID)
      await refetchRuntimeState()
      saveStateRef.current = "saved"
      setSaveState("saved")
    },
    onError: (error) => {
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(error instanceof Error ? error.message : "Task cancel failed")
    },
  })

  const activeGenerationTaskIDs = useMemo(
    () => (tasksQuery.data ?? [])
      .filter((task) => !isFinalGenerationTaskStatus(task.status))
      .map((task) => task.id),
    [tasksQuery.data],
  )
  const activeGenerationTaskIDsKey = activeGenerationTaskIDs.join("|")

  useEffect(() => {
    saveStateRef.current = saveState
  }, [saveState])

  useEffect(() => {
    eventCursorRef.current = null
  }, [agentBaseURL, projectID])

  useEffect(() => {
    if (!canvasQuery.data) return
    applyCanvas(canvasQuery.data)
  }, [applyCanvas, canvasQuery.data])

  useEffect(() => () => {
    for (const timer of nodePatchTimersRef.current.values()) window.clearTimeout(timer)
    nodePatchTimersRef.current.clear()
    nodePatchQueueRef.current.clear()
  }, [])

  const queueNodePatch = useCallback((nodeID: string, patch: CinemaNodePatch) => {
    const current = nodePatchQueueRef.current.get(nodeID)
    nodePatchQueueRef.current.set(nodeID, {
      ...current,
      ...patch,
      ...(current?.data || patch.data ? { data: patch.data ?? current?.data } : {}),
    })

    const existingTimer = nodePatchTimersRef.current.get(nodeID)
    if (existingTimer) window.clearTimeout(existingTimer)
    saveStateRef.current = "dirty"
    setSaveState("dirty")

    const timer = window.setTimeout(() => {
      const nextPatch = nodePatchQueueRef.current.get(nodeID)
      nodePatchQueueRef.current.delete(nodeID)
      nodePatchTimersRef.current.delete(nodeID)
      if (!nextPatch) return

      commandMutation.mutate({
        id: makeCommandID("update-node"),
        type: "update-node",
        actor: "cinema-web",
        nodeID,
        patch: nextPatch,
      })
    }, 650)
    nodePatchTimersRef.current.set(nodeID, timer)
  }, [commandMutation])

  const flushNodePatch = useCallback(async (nodeID: string) => {
    const existingTimer = nodePatchTimersRef.current.get(nodeID)
    if (existingTimer) {
      window.clearTimeout(existingTimer)
      nodePatchTimersRef.current.delete(nodeID)
    }

    const patch = nodePatchQueueRef.current.get(nodeID)
    nodePatchQueueRef.current.delete(nodeID)
    if (!patch) return

    saveStateRef.current = "saving"
    setSaveState("saving")
    setSaveError(null)

    try {
      await requestJson<CinemaCommandResult>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}/commands`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: makeCommandID("update-node"),
          type: "update-node",
          actor: "cinema-web",
          nodeID,
          patch,
        }),
      })
    } catch (error) {
      nodePatchQueueRef.current.set(nodeID, patch)
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(error instanceof Error ? error.message : "Command failed")
      throw error
    }
  }, [agentBaseURL, projectID])

  const createTextGenerationMutation = useMutation({
    mutationFn: async ({ nodeID, request }: {
      nodeID: string
      request: TextGenerationRequest
    }) => {
      await flushNodePatch(nodeID)
      return await requestJson<CinemaTextGenerationResult>(
        agentBaseURL,
        `/api/cinema/projects/${encodeURIComponent(projectID)}/text-generations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nodeID,
            ...request,
            writeMode: "append",
          }),
        },
      )
    },
    onMutate: ({ nodeID }) => {
      setTextGenerationNodeID(nodeID)
      setTextGenerationError(null)
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: async (result) => {
      applyCanvas(result.canvas)
      setSelectedNodeID(result.nodeID)
      await refetchRuntimeState()
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : "Text generation failed"
      setTextGenerationError({ nodeID: variables.nodeID, message })
      if (saveStateRef.current !== "error") {
        saveStateRef.current = nodePatchQueueRef.current.size > 0 || nodePatchTimersRef.current.size > 0 ? "dirty" : "saved"
        setSaveState(saveStateRef.current)
      }
    },
    onSettled: () => {
      setTextGenerationNodeID(null)
    },
  })

  const createImageGenerationMutation = useMutation({
    mutationFn: async ({ nodeID, request }: { nodeID: string; request: ImageGenerationRequest }) => {
      await flushNodePatch(nodeID)
      return await requestJson<CinemaImageGenerationResult>(
        agentBaseURL,
        `/api/cinema/projects/${encodeURIComponent(projectID)}/image-generations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nodeID,
            ...request,
          }),
        },
      )
    },
    onMutate: ({ nodeID }) => {
      setImageGenerationNodeID(nodeID)
      setImageGenerationError(null)
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: (result) => {
      applyCanvas(result.canvas)
      setSelectedNodeID(result.nodeID)
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : "Image generation failed"
      setImageGenerationError({ nodeID: variables.nodeID, message })
      void refetchCanvas()
      if (saveStateRef.current !== "error") {
        saveStateRef.current = nodePatchQueueRef.current.size > 0 || nodePatchTimersRef.current.size > 0 ? "dirty" : "saved"
        setSaveState(saveStateRef.current)
      }
    },
    onSettled: () => {
      setImageGenerationNodeID(null)
    },
  })

  const runCustomApiMutation = useMutation({
    mutationFn: async ({ nodeID, request }: { nodeID: string; request: CustomApiRunRequest }) => {
      await flushNodePatch(nodeID)
      return await requestJson<CinemaCustomApiRunResult>(
        agentBaseURL,
        `/api/cinema/projects/${encodeURIComponent(projectID)}/custom-api-runs`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nodeID,
            ...request,
          }),
        },
      )
    },
    onMutate: ({ nodeID }) => {
      setCustomApiNodeID(nodeID)
      setCustomApiError(null)
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: (result) => {
      if (result.canvas) applyCanvas(result.canvas)
      else {
        saveStateRef.current = "saved"
        setSaveState("saved")
      }
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : "Custom API run failed"
      setCustomApiError({ nodeID: variables.nodeID, message })
      void refetchCanvas()
      if (saveStateRef.current !== "error") {
        saveStateRef.current = nodePatchQueueRef.current.size > 0 || nodePatchTimersRef.current.size > 0 ? "dirty" : "saved"
        setSaveState(saveStateRef.current)
      }
    },
    onSettled: () => {
      setCustomApiNodeID(null)
    },
  })

  const saveCustomApiKeyMutation = useMutation({
    mutationFn: async ({ nodeID, request }: { nodeID: string; request: CustomApiAuthSaveRequest }) => {
      await flushNodePatch(nodeID)
      return await requestJson<CinemaCustomApiAuthState>(
        agentBaseURL,
        `/api/cinema/projects/${encodeURIComponent(projectID)}/custom-api-nodes/${encodeURIComponent(nodeID)}/auth/api-key`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        },
      )
    },
    onMutate: ({ nodeID }) => {
      setCustomApiNodeID(nodeID)
      setCustomApiError(null)
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: () => {
      saveStateRef.current = "saved"
      setSaveState("saved")
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : "Custom API key save failed"
      setCustomApiError({ nodeID: variables.nodeID, message })
      if (saveStateRef.current !== "error") {
        saveStateRef.current = nodePatchQueueRef.current.size > 0 || nodePatchTimersRef.current.size > 0 ? "dirty" : "saved"
        setSaveState(saveStateRef.current)
      }
    },
    onSettled: () => {
      setCustomApiNodeID(null)
    },
  })

  const importLocalImageMutation = useMutation({
    mutationFn: async ({ file, position }: { file: File; position: { x: number; y: number } }) => {
      const dataBase64 = await fileToDataBase64(file)
      const result = await requestJson<CinemaImportedImageAssetResult>(
        agentBaseURL,
        `/api/cinema/projects/${encodeURIComponent(projectID)}/assets/imports`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || undefined,
            dataBase64,
          }),
        },
      )
      return { result, file, position }
    },
    onMutate: () => {
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: ({ result, file, position }) => {
      const next = createLocalImageNode(result.asset, file.name, position)
      commandMutation.mutate({
        id: makeCommandID("create-node"),
        type: "create-node",
        actor: "cinema-web",
        node: toCanvasNode(next),
      }, {
        onSuccess: () => setSelectedNodeID(next.id),
      })
    },
    onError: (error) => {
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(error instanceof Error ? error.message : "Image import failed")
    },
  })

  useEffect(() => {
    if (!projectID || !canvasQuery.data || projectQuery.data?.initialized !== true) return
    let cancelled = false
    let intervalID: number | null = null

    async function pollEvents() {
      if (cancelled || saveStateRef.current === "dirty" || saveStateRef.current === "saving") return

      try {
        if (eventCursorRef.current === null) {
          const initial = await requestJson<CinemaEventsResult>(
            agentBaseURL,
            `/api/cinema/projects/${encodeURIComponent(projectID)}/events?limit=1`,
          )
          if (!cancelled) eventCursorRef.current = initial.nextCursor
          return
        }

        const result = await requestJson<CinemaEventsResult>(
          agentBaseURL,
          `/api/cinema/projects/${encodeURIComponent(projectID)}/events?after=${eventCursorRef.current}&limit=50`,
        )
        if (cancelled) return
        eventCursorRef.current = result.nextCursor
        if (result.events.length > 0) {
          await Promise.all([refetchCanvas(), refetchTasks()])
        }
      } catch {
        // Keep the canvas usable if the lightweight sync poll misses once.
      }
    }

    void pollEvents()
    intervalID = window.setInterval(() => void pollEvents(), 2400)

    return () => {
      cancelled = true
      if (intervalID !== null) window.clearInterval(intervalID)
    }
  }, [agentBaseURL, canvasQuery.data, projectID, projectQuery.data?.initialized, refetchCanvas, refetchTasks])

  useEffect(() => {
    if (!projectID || projectQuery.data?.initialized !== true || activeGenerationTaskIDs.length === 0) {
      setAutoRefreshingTaskIDs([])
      return
    }

    let cancelled = false
    let initialTimerID: number | null = null
    let intervalID: number | null = null

    async function refreshActiveTasks() {
      if (
        cancelled ||
        autoRefreshInFlightRef.current ||
        saveStateRef.current === "dirty" ||
        saveStateRef.current === "saving"
      ) {
        return
      }

      autoRefreshInFlightRef.current = true
      setAutoRefreshingTaskIDs(activeGenerationTaskIDs)

      try {
        for (const taskID of activeGenerationTaskIDs) {
          if (cancelled) break
          await requestJson<CinemaGenerationTask>(
            agentBaseURL,
            `/api/cinema/projects/${encodeURIComponent(projectID)}/generation-tasks/${encodeURIComponent(taskID)}/refresh`,
            { method: "POST" },
          )
        }
        if (!cancelled) await refetchRuntimeState()
      } catch {
        // Ignore transient background refresh errors; the next poll will retry.
      } finally {
        if (!cancelled) setAutoRefreshingTaskIDs([])
        autoRefreshInFlightRef.current = false
      }
    }

    initialTimerID = window.setTimeout(() => void refreshActiveTasks(), 2600)
    intervalID = window.setInterval(() => void refreshActiveTasks(), 9000)

    return () => {
      cancelled = true
      if (initialTimerID !== null) window.clearTimeout(initialTimerID)
      if (intervalID !== null) window.clearInterval(intervalID)
    }
  }, [activeGenerationTaskIDs, activeGenerationTaskIDsKey, agentBaseURL, projectID, projectQuery.data?.initialized, refetchRuntimeState])

  const onNodesChange = useCallback((changes: NodeChange<CinemaFlowNode>[]) => {
    const removedNodeIDs = changes
      .filter((change): change is Extract<NodeChange<CinemaFlowNode>, { type: "remove" }> => change.type === "remove")
      .map((change) => change.id)
    if (isMutationChange(changes)) {
      saveStateRef.current = "dirty"
      setSaveState("dirty")
    }
    setNodes((current) => applyNodeChanges(changes, current))
    for (const nodeID of removedNodeIDs) {
      commandMutation.mutate({
        id: makeCommandID("delete-node"),
        type: "delete-node",
        actor: "cinema-web",
        nodeID,
      }, {
        onSuccess: () => {
          if (selectedNodeID === nodeID) setSelectedNodeID(null)
        },
      })
    }
  }, [commandMutation, selectedNodeID, setSelectedNodeID])

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    const removedEdgeIDs = changes
      .filter((change): change is Extract<EdgeChange<Edge>, { type: "remove" }> => change.type === "remove")
      .map((change) => change.id)
    if (isMutationChange(changes)) {
      saveStateRef.current = "dirty"
      setSaveState("dirty")
    }
    setEdges((current) => applyEdgeChanges(changes, current))
    for (const edgeID of removedEdgeIDs) {
      commandMutation.mutate({
        id: makeCommandID("disconnect-edge"),
        type: "disconnect-edge",
        actor: "cinema-web",
        edgeID,
      })
    }
  }, [commandMutation])

  const disconnectEdge = useCallback((edgeID: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeID))
    saveStateRef.current = "dirty"
    setSaveState("dirty")
    commandMutation.mutate({
      id: makeCommandID("disconnect-edge"),
      type: "disconnect-edge",
      actor: "cinema-web",
      edgeID,
    })
  }, [commandMutation])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    const targetInput = videoInputHandleMetadata(connection.targetHandle)
    const edge = {
      id: `edge-${connection.source}-${connection.target}-${Date.now().toString(36)}`,
      source: connection.source,
      target: connection.target,
      ...(connection.sourceHandle ? { sourceHandle: connection.sourceHandle } : {}),
      ...(connection.targetHandle ? { targetHandle: connection.targetHandle } : {}),
      ...(targetInput
        ? {
            data: {
              ...(targetInput.slot ? { targetSlot: targetInput.slot } : {}),
              ...(targetInput.role ? { targetRole: targetInput.role } : {}),
              ...(targetInput.inputKey ? { targetInputKey: targetInput.inputKey } : {}),
            },
          }
        : {}),
    }
    commandMutation.mutate({
      id: makeCommandID("connect-nodes"),
      type: "connect-nodes",
      actor: "cinema-web",
      edge,
    })
  }, [commandMutation])

  const addNode = useCallback((type: CinemaNodeType, position: { x: number; y: number }) => {
    const next = createNode(type, position)
    commandMutation.mutate({
      id: makeCommandID("create-node"),
      type: "create-node",
      actor: "cinema-web",
      node: toCanvasNode(next),
    }, {
      onSuccess: () => setSelectedNodeID(next.id),
    })
  }, [commandMutation, setSelectedNodeID])

  const addCustomNodeFromDefinition = useCallback((definition: CinemaCustomNodeDefinition, position: { x: number; y: number }) => {
    const next = createCustomNodeFromDefinition(definition, position)
    commandMutation.mutate({
      id: makeCommandID("create-node"),
      type: "create-node",
      actor: "cinema-web",
      node: toCanvasNode(next),
    }, {
      onSuccess: () => setSelectedNodeID(next.id),
    })
  }, [commandMutation, setSelectedNodeID])

  const requestLocalImageImport = useCallback((position: { x: number; y: number }) => {
    pendingLocalImagePositionRef.current = position
    localImageInputRef.current?.click()
  }, [])

  const handleLocalImageFileChange = useCallback((file: File | null) => {
    const position = pendingLocalImagePositionRef.current
    pendingLocalImagePositionRef.current = null
    if (!file || !position) return
    importLocalImageMutation.mutate({ file, position })
  }, [importLocalImageMutation])

  const toggleCanvasPanel = useCallback((panel: CanvasPanel) => {
    setActiveCanvasPanel((current) => current === panel ? null : panel)
  }, [])

  const onPaneContextMenu = useCallback((event: globalThis.MouseEvent | ReactMouseEvent<Element>) => {
    event.preventDefault()
    const projected = (flowInstance ?? reactFlow).screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    })
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      flowX: projected.x,
      flowY: projected.y,
    })
  }, [flowInstance, reactFlow])

  const changeNode = useCallback((nodeID: string, update: Partial<CinemaFlowNodeData>) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeID
          ? {
            ...node,
            data: {
              ...node.data,
              ...update,
            },
          }
          : node
      )
    )
    const patch: CinemaNodePatch = {}
    if (typeof update.title === "string") patch.title = update.title.trim() || "Untitled Node"
    if (update.rawData) patch.data = update.rawData
    if (Object.keys(patch).length > 0) queueNodePatch(nodeID, patch)
  }, [queueNodePatch])

  const deleteNode = useCallback((nodeID: string) => {
    commandMutation.mutate({
      id: makeCommandID("delete-node"),
      type: "delete-node",
      actor: "cinema-web",
      nodeID,
    }, {
      onSuccess: () => setSelectedNodeID(null),
    })
  }, [commandMutation, setSelectedNodeID])

  const saveCustomNodeDefinition = useCallback(async (
    nodeID: string,
    request: CustomNodeDefinitionSaveRequest,
  ): Promise<CinemaCustomNodeDefinition | undefined> => {
    const currentDefinitionID = readRawString(request.rawData, "definitionID")
    const existing = currentDefinitionID
      ? customNodeDefinitions.find((definition) => definition.id === currentDefinitionID)
      : undefined
    const definitionID = currentDefinitionID || makeCustomNodeDefinitionID(request.title)
    const definition = customNodeDefinitionFromRawData({
      definitionID,
      title: request.title,
      rawData: request.rawData,
      existing,
    })
    const nextRawData = {
      ...request.rawData,
      definitionID: definition.id,
      definitionTitle: definition.title,
    }

    setCustomApiNodeID(nodeID)
    setCustomApiError(null)
    try {
      await flushNodePatch(nodeID)
      await commandMutation.mutateAsync({
        id: makeCommandID("update-node"),
        type: "update-node",
        actor: "cinema-web",
        nodeID,
        patch: {
          data: nextRawData,
        },
      })

      if (existing) {
        const { id: _id, ...patch } = definition
        await commandMutation.mutateAsync({
          id: makeCommandID("update-custom-node-definition"),
          type: "update-custom-node-definition",
          actor: "cinema-web",
          definitionID: definition.id,
          patch,
        })
      } else {
        await commandMutation.mutateAsync({
          id: makeCommandID("create-custom-node-definition"),
          type: "create-custom-node-definition",
          actor: "cinema-web",
          definition,
        })
      }
      setSelectedNodeID(nodeID)
      return definition
    } catch (error) {
      setCustomApiError({
        nodeID,
        message: error instanceof Error ? error.message : "Custom node definition save failed",
      })
      return undefined
    } finally {
      setCustomApiNodeID(null)
    }
  }, [commandMutation, customNodeDefinitions, flushNodePatch, setSelectedNodeID])

  const textModels = textModelsQuery.data?.items ?? []
  const effectiveTextModel = textModelsQuery.data?.effectiveModel ?? null
  const imageModels = imageModelsQuery.data?.items ?? []
  const effectiveImageModel = imageModelsQuery.data?.effectiveModel ?? null
  const renderedNodes = useMemo(
    () => nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        onChangeRawData: (nodeID: string, rawData: Record<string, unknown>) => changeNode(nodeID, { rawData }),
        onChangeTitle: (nodeID: string, title: string) => changeNode(nodeID, { title }),
        onDeleteNode: deleteNode,
        textModels,
        effectiveTextModel,
        isGeneratingText: createTextGenerationMutation.isPending && textGenerationNodeID === node.id,
        textGenerationError: textGenerationError?.nodeID === node.id ? textGenerationError.message : null,
        sourceImageAssets: node.data.cinemaType === "text" || node.data.cinemaType === "image"
          ? sourceImageAssetsForNode(node.id, nodes, edges)
          : [],
        onGenerateText: (nodeID: string, request: TextGenerationRequest) =>
          createTextGenerationMutation.mutate({ nodeID, request }),
        imageModels,
        effectiveImageModel,
        isGeneratingImage: createImageGenerationMutation.isPending && imageGenerationNodeID === node.id,
        imageGenerationError: imageGenerationError?.nodeID === node.id ? imageGenerationError.message : null,
        sourceTextParameters: node.data.cinemaType === "image" || node.data.cinemaType === "video"
          ? sourceTextParametersForNode(node.id, nodes, edges)
          : [],
        agentBaseURL,
        projectID,
        onDisconnectEdge: disconnectEdge,
        onGenerateImage: (nodeID: string, request: ImageGenerationRequest) =>
          createImageGenerationMutation.mutate({ nodeID, request }),
        videoProviders: providersQuery.data ?? [],
        generationTasks: tasksQuery.data ?? [],
        sourceImageAsset: node.data.cinemaType === "video" ? sourceImageAssetForVideoNode(node.id, nodes, edges) : null,
        videoInputImageAssets: node.data.cinemaType === "video" ? sourceImageAssetsForVideoNode(node.id, nodes, edges) : {},
        videoInputAssets: node.data.cinemaType === "video" ? sourceInputAssetsForVideoNode(node.id, nodes, edges) : {},
        videoInputAssetsByInputKey: node.data.cinemaType === "video" ? sourceInputAssetMapsForVideoNode(node.id, nodes, edges).byInputKey : {},
        videoInputAssetsByRole: node.data.cinemaType === "video" ? sourceInputAssetMapsForVideoNode(node.id, nodes, edges).byRole : {},
        isCreatingVideoTask: createGenerationTaskMutation.isPending && videoGenerationNodeID === node.id,
        videoGenerationError: videoGenerationError?.nodeID === node.id ? videoGenerationError.message : null,
        onCreateVideoGenerationTask: (nodeID: string, body: CreateCinemaGenerationTaskBody) =>
          createGenerationTaskMutation.mutate({ body, draftNodeID: nodeID }),
        isRunningCustomApi: runCustomApiMutation.isPending && customApiNodeID === node.id,
        customApiError: customApiError?.nodeID === node.id ? customApiError.message : null,
        onRunCustomApi: (nodeID: string, request: CustomApiRunRequest) =>
          runCustomApiMutation.mutateAsync({ nodeID, request }),
        onSaveCustomApiKey: (nodeID: string, request: CustomApiAuthSaveRequest) =>
          saveCustomApiKeyMutation.mutateAsync({ nodeID, request }),
        onSaveCustomNodeDefinition: saveCustomNodeDefinition,
      },
    })),
    [
      agentBaseURL,
      changeNode,
      createGenerationTaskMutation,
      createImageGenerationMutation,
      createTextGenerationMutation,
      customApiError,
      customApiNodeID,
      deleteNode,
      disconnectEdge,
      edges,
      effectiveImageModel,
      effectiveTextModel,
      imageGenerationError,
      imageGenerationNodeID,
      imageModels,
      nodes,
      projectID,
      providersQuery.data,
      runCustomApiMutation,
      saveCustomApiKeyMutation,
      saveCustomNodeDefinition,
      tasksQuery.data,
      textGenerationError,
      textGenerationNodeID,
      textModels,
      videoGenerationError,
      videoGenerationNodeID,
    ],
  )

  if (!projectID) {
    return (
      <main className="cinema-shell">
        <div className="cinema-empty-state">
          <h1>Missing project</h1>
          <p>Open Cinema from an AnyBox project so the URL includes a projectID.</p>
        </div>
      </main>
    )
  }

  if (projectQuery.isLoading || (projectQuery.data?.initialized && canvasQuery.isLoading)) {
    return (
      <main className="cinema-shell">
        <div className="cinema-empty-state">
          <Loader2 className="is-spinning" aria-hidden="true" />
          <h1>Opening cinema project</h1>
          <p>Reading local project metadata through AnyBox.</p>
        </div>
      </main>
    )
  }

  if (projectQuery.error || canvasQuery.error || providersQuery.error || textModelsQuery.error || imageModelsQuery.error || tasksQuery.error) {
    const error = projectQuery.error ?? canvasQuery.error ?? providersQuery.error ?? textModelsQuery.error ?? imageModelsQuery.error ?? tasksQuery.error
    return (
      <main className="cinema-shell">
        <div className="cinema-empty-state is-error">
          <h1>Could not open Cinema</h1>
          <p>{error instanceof Error ? error.message : "Unknown error"}</p>
        </div>
      </main>
    )
  }

  if (projectQuery.data && !projectQuery.data.initialized) {
    return (
      <main className="cinema-shell">
        <div className="cinema-empty-state">
          <Film aria-hidden="true" />
          <h1>Initialize this project first</h1>
          <p>Run the Initialize Cinema Project skill in AnyBox, then open this canvas again.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="cinema-shell" onClick={() => setContextMenu(null)}>
      <input
        ref={localImageInputRef}
        className="cinema-local-image-input"
        type="file"
        accept={LOCAL_IMAGE_FILE_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0] ?? null
          event.currentTarget.value = ""
          handleLocalImageFileChange(file)
        }}
      />
      <section className="cinema-workspace">
        <div className="cinema-canvas">
          <ReactFlow<CinemaFlowNode, Edge>
            nodes={renderedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={setFlowInstance}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={(_, node) => {
              queueNodePatch(node.id, { position: node.position })
            }}
            onNodeClick={(_, node) => setSelectedNodeID(node.id)}
            onPaneClick={() => setSelectedNodeID(null)}
            onPaneContextMenu={onPaneContextMenu}
            fitView
            fitViewOptions={{ padding: 0.38 }}
            minZoom={0.2}
            maxZoom={2}
          >
            <Background gap={32} size={1.2} color="rgba(255,255,255,0.16)" />
            <Controls position="bottom-center" orientation="horizontal" />
            <MiniMap
              position="bottom-left"
              nodeColor={(node) => NODE_META[(node as CinemaFlowNode).data.cinemaType].accent}
              maskColor="rgba(0,0,0,0.55)"
              pannable
              zoomable
            />
          </ReactFlow>
          <ContextMenu
            menu={contextMenu}
            customNodeDefinitions={customNodeDefinitions}
            onAddNode={addNode}
            onAddCustomNodeFromDefinition={addCustomNodeFromDefinition}
            onImportLocalImageNode={requestLocalImageImport}
            onClose={() => setContextMenu(null)}
            isImportingLocalImage={importLocalImageMutation.isPending}
          />
          {activeCanvasPanel === "files" ? (
            <ProjectFileBrowser
              projectID={projectID}
              agentBaseURL={agentBaseURL}
              onClose={() => setActiveCanvasPanel(null)}
            />
          ) : null}
          <CanvasPanelNavigation
            activePanel={activeCanvasPanel}
            onTogglePanel={toggleCanvasPanel}
          />
        </div>
      </section>
    </main>
  )
}
