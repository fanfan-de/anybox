import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ChangeEvent, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useInternalNode,
  useReactFlow,
  useUpdateNodeInternals,
  useViewport,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnectEnd,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from "@xyflow/react"
import { useMutation, useQueries, useQuery } from "@tanstack/react-query"
import { create } from "zustand"
import {
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  Code2,
  Copy,
  Download,
  File,
  FileText,
  Film,
  Folder,
  Image,
  Images,
  Info,
  Loader2,
  Music,
  MoreHorizontal,
  Pause,
  PencilLine,
  Play,
  RefreshCw,
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
  type CinemaAssetKind,
  type CinemaAssetLocator,
  type CinemaAssetRecord,
  type CinemaEventsResult,
  type CinemaCanvasDocument,
  type CinemaCanvasNode,
  type CinemaGenerationMode,
  type CinemaGenerationProgress,
  type CinemaGenerationTask,
  type CinemaGeneratedAsset,
  type CinemaImageGenerationResult,
  type CinemaImportedImageAssetResult,
  type CinemaImportedMediaAssetResult,
  type CinemaImageModel,
  type CinemaImageModelsResult,
  type GenerationControl,
  type GenerationFormSpec,
  type CinemaTextGenerationResult,
  type CinemaTextModel,
  type CinemaTextModelsResult,
  type CinemaNodeType,
  type CinemaProviderEndpoint,
  type CinemaProviderWorkflowCatalog,
  type CinemaProjectDirectoryEntry,
  type CinemaProjectDirectoryListing,
  type CinemaProjectSummary,
  type CinemaVideoProvider,
  type CreateCinemaGenerationTaskBody,
} from "@anybox/cinema-plugin/contracts"
import {
  GENERATION_IMAGE_INPUT_SLOTS,
  GENERATION_INPUT_SLOTS,
  generationControlDefaultParameters,
  generationModeInputContractForCombination,
  hiddenDefaultParametersForCombination as generationHiddenDefaultParametersForCombination,
  isGenerationImageInputSlot,
  isGenerationMediaInputControl,
  isGenerationMediaInputSlot,
  type GenerationImageInputSlot,
  type GenerationInputControl,
  type GenerationInputSlot,
  type GenerationMediaInputSlot,
  type GenerationModeInputContract,
} from "./features/generation/generationContract"
import {
  buildGenerationTaskParameters,
  generationLegacyAssetsBySlot,
} from "./features/generation/generationPayload"
import {
  providersWithDiscoveredWorkflows,
  reconcileGenerationParameters,
  workflowIssueSummary,
} from "./features/generation/workflowCatalog"
import {
  edgeTargetVideoInput,
  normalizeVideoTargetEdgeHandle,
} from "./features/generation/videoInputRouting"
import {
  canonicalizeCinemaImageNodeData,
  deriveCinemaImageNodeState,
  finalizeCinemaImageCandidate,
  parseCinemaImageAsset,
  readCinemaImageCandidateAssets,
  readCinemaImageFinalAsset,
  readCinemaImageSelectedCandidate,
} from "./features/image/imageNodeData"
import {
  hasMultiSelectModifier,
  preserveNodeSelection,
  shouldDeferSingleSelection,
  toggleNodeSelection,
} from "./features/canvas/nodeSelection"
import { clampContextMenuPosition } from "./features/canvas/contextMenuPosition"
import {
  CinemaCommandQueue,
  type CinemaCommandDraft,
} from "./features/canvas/commandQueue"
import { CanvasSaveStatus, type SaveState } from "./features/canvas/CanvasSaveStatus"
import { validateCinemaConnection } from "./features/canvas/connectionRules"
import { TextNodeMarkdownPreview } from "./features/canvas/TextNodeMarkdownPreview"
import { textNodeVisibleLineCount } from "./features/canvas/textNodeLayout"
import { canRestoreGeneratedText, type TextGenerationUndoRecord } from "./features/canvas/textGenerationUndo"
import {
  translateGenerationOptionLabel,
  translateGenerationParameterLabel,
  translateGenerationProgress,
  translateGenerationStatus,
  translateVideoInputEmptyText,
  translateVideoInputLabel,
  translateVideoModeLabel,
  translateVideoPromptPlaceholder,
  useI18n,
  type TranslationKey,
} from "./i18n"
import { AssetLibraryApiError, createAssetLibraryApi } from "./features/assets/assetLibraryApi"
import type {
  AssetLibraryAddRequest,
  AssetLibraryRevealRequest,
} from "./features/assets/AssetLibraryPanel"
import {
  CINEMA_ASSET_DRAG_MIME,
  cinemaAssetLocatorFromDragPayload,
  cinemaAssetRefFromNodeData,
  cinemaAssetURL,
  isPersonalCinemaAssetRef,
} from "./features/media/assetNodeData"
import {
  createNodeOperationState,
  isNodeOperationPending,
  nodeOperationError,
  nodeOperationReducer,
} from "./features/generation/nodeOperationState"
import {
  CinemaWorkbenchShell,
  type CinemaWorkspaceID,
} from "./features/workbench/CinemaWorkbenchShell"
import { resolveCinemaRuntimeBaseURL, resolveCinemaRuntimeURL } from "./runtimeUrl"
import { cinemaRuntimeFetch } from "./runtimeFetch"
import "./features/media/mediaNodes.css"

const AssetLibraryPanel = lazy(async () => {
  const module = await import("./features/assets/AssetLibraryPanel")
  return { default: module.AssetLibraryPanel }
})

const EditWorkbench = lazy(async () => {
  const module = await import("./features/timeline/components/EditWorkbench")
  return { default: module.EditWorkbench }
})

const DeliverWorkbench = lazy(async () => {
  const module = await import("./features/deliver/components/DeliverWorkbench")
  return { default: module.DeliverWorkbench }
})

type CanvasPanel = "files" | "assets"

type ImageGenerationRequest = {
  prompt: string
  userPrompt?: string
  model: string | null
  target?: CinemaImageModel["target"]
  size?: string
  count?: number
  style?: string
  parameters?: Record<string, unknown>
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
type ImageCropRect = {
  x: number
  y: number
  width: number
  height: number
  unit: "pixel"
}

type ImageCropDraftRect = {
  x: number
  y: number
  width: number
  height: number
}

type ImageCropDragMode = "move" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"

type ImageCropDragState = {
  mode: ImageCropDragMode
  startPointer: { x: number; y: number }
  startCrop: ImageCropDraftRect
}

type VideoInputSlot = GenerationInputSlot
type VideoMediaInputSlot = GenerationMediaInputSlot
type VideoImageInputSlot = GenerationImageInputSlot
type VideoModeInputContract = GenerationModeInputContract
type VideoInputControl = GenerationInputControl

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

type VideoImageInputAssetValue = VideoSourceImageAsset | VideoSourceImageAsset[] | null
type VideoInputAssetValue = VideoSourceImageAsset | VideoSourceImageAsset[] | null
type VideoImageInputAssets = Partial<Record<VideoImageInputSlot, VideoImageInputAssetValue>>
type VideoInputAssets = Partial<Record<VideoMediaInputSlot, VideoInputAssetValue>>
type VideoInputAssetMap = Record<string, VideoInputAssetValue>

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
  isActiveNode?: boolean
  onActivateNode?: (nodeID: string, pointerID: number, multiSelect: boolean) => void
  onSelectNode?: (nodeID: string) => void
  onNodeInputEditingChange?: (nodeID: string, isEditing: boolean) => void
  onDeleteNode?: (nodeID: string) => void
  hasConnections?: boolean
  hasIncomingConnection?: boolean
  hasOutgoingConnection?: boolean
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
  isFinalizingImageCandidate?: boolean
  imageFinalizeError?: string | null
  sourceTextParameters?: SourceTextParameter[]
  agentBaseURL?: string
  projectID?: string
  onDisconnectEdge?: (edgeID: string) => void
  onGenerateImage?: (nodeID: string, request: ImageGenerationRequest) => void
  videoProviders?: CinemaVideoProvider[]
  workflowCatalogs?: CinemaProviderWorkflowCatalog[]
  isLoadingWorkflows?: boolean
  isRefreshingWorkflows?: boolean
  workflowRefreshError?: string | null
  onRefreshProviderWorkflows?: (providerID: string) => void
  generationTasks?: CinemaGenerationTask[]
  sourceImageAsset?: VideoSourceImageAsset | null
  videoInputImageAssets?: VideoImageInputAssets
  videoInputAssets?: VideoInputAssets
  videoInputAssetsByInputKey?: VideoInputAssetMap
  videoInputAssetsByRole?: VideoInputAssetMap
  isCreatingVideoTask?: boolean
  videoGenerationError?: string | null
  onCreateVideoGenerationTask?: (nodeID: string, body: CreateCinemaGenerationTaskBody) => void
  isImportingImage?: boolean
  imageImportError?: string | null
  onImportImage?: (nodeID: string, file: File) => void
  onFinalizeImageCandidate?: (nodeID: string, candidateID: string) => void
  isCroppingImage?: boolean
  imageCropError?: string | null
  onCreateCroppedImageNode?: (nodeID: string, crop: ImageCropRect) => Promise<void>
  onRelinkAsset?: (nodeID: string) => void
  hasIncomingImageEdge?: boolean
  onDismissNodeOverlay?: () => void
  nodeInputOverlayRoot?: HTMLElement | null
}

type CinemaFlowNode = Node<CinemaFlowNodeData, "cinemaNode">
type CinemaNodePatch = Extract<CinemaCommand, { type: "update-node" }>["patch"]
type ContextMenuState = {
  x: number
  y: number
  flowX: number
  flowY: number
} | null
type NodeContextMenuState =
  | {
      kind: "node"
      x: number
      y: number
      nodeID: string
    }
  | {
      kind: "selection"
      x: number
      y: number
      nodeIDs: string[]
    }
  | null
type DisplayAsset = {
  id: string
  kind: string
  path: string
  width?: number
  height?: number
}

type UiState = {
  activeNodeID: string | null
  setActiveNodeID: (nodeID: string | null) => void
}

const useUiStore = create<UiState>((set) => ({
  activeNodeID: null,
  setActiveNodeID: (nodeID) => set({ activeNodeID: nodeID }),
}))

const CREATABLE_NODE_TYPES = [
  "text",
  "image",
  "video",
  "audio",
] as const satisfies readonly CinemaNodeType[]

const FALLBACK_GENERATION_MODE: CinemaGenerationMode = "text-to-video"
const DEFAULT_IMAGE_GENERATION_SIZE = "1024x1024"
const DEFAULT_IMAGE_GENERATION_COUNT = 1
const DEFAULT_VIDEO_ASPECT_RATIO = "16:9"
const DEFAULT_VIDEO_DURATION_SECONDS = 5
const DEFAULT_VIDEO_RESOLUTION = "std"
const FALLBACK_VIDEO_INPUT_COMBINATION_MODE: CinemaGenerationMode = "text-to-video"
const MIN_IMAGE_CROP_PIXELS = 32
const IMAGE_CROP_NODE_OFFSET_X = 360
const IMAGE_CROP_MAX_OUTPUT_SIDE = 2048
const NODE_POINTER_PANE_CLICK_GUARD_MS = 96
const NODE_POINTER_PANE_CLICK_GUARD_DISTANCE_PX = 4
const IMAGE_CROP_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const satisfies readonly ImageCropDragMode[]
const IMAGE_FILE_ACCEPT = [
  "image/apng",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
].join(",")
const VIDEO_INPUT_SLOTS = GENERATION_INPUT_SLOTS
const VIDEO_IMAGE_INPUT_SLOTS = GENERATION_IMAGE_INPUT_SLOTS
const VIDEO_INPUT_SLOT_LABELS: Record<VideoInputSlot, string> = {
  textParameter: "文本参数",
  sourceImage: "参考图",
  startFrame: "首帧",
  endFrame: "尾帧",
  referenceImage: "参考图",
  sourceVideo: "源视频",
  mask: "蒙版",
}
const VIDEO_LOCAL_MEDIA_INPUT_SLOTS = [
  "sourceImage",
  "startFrame",
  "endFrame",
  "referenceImage",
  "sourceVideo",
  "mask",
] as const satisfies readonly VideoMediaInputSlot[]

const DEFAULT_NODE_SIZE: Record<CinemaNodeType, { width: number; height: number }> = {
  text: { width: 360, height: 188 },
  image: { width: 300, height: 300 },
  video: { width: 420, height: 340 },
  audio: { width: 300, height: 156 },
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
  image: {
    label: "Image",
    accent: "#f9a8d4",
    icon: Image,
    placeholder: "Describe the image you want to generate.",
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
}

function readSearchParams() {
  const params = new URLSearchParams(window.location.search)
  return {
    projectID: params.get("projectID")?.trim() || params.get("anyboxProjectID")?.trim() || "",
    agentBaseURL: resolveCinemaRuntimeBaseURL({
      explicitBaseURL: params.get("agentBaseURL"),
      location: window.location,
    }),
  }
}

async function requestJson<T>(baseURL: string, pathname: string, init?: RequestInit): Promise<T> {
  const response = await cinemaRuntimeFetch(new URL(resolveCinemaRuntimeURL(baseURL, pathname)), init)
  const envelope = await response.json().catch(() => null) as
    | { success: true; data: T }
    | { success: false; error?: { code?: string; message?: string; data?: unknown } }
    | null

  if (!response.ok || !envelope || envelope.success !== true) {
    const message = envelope && envelope.success === false && envelope.error?.message
      ? envelope.error.message
      : `Request failed (${response.status})`
    throw new CinemaRequestError(
      message,
      response.status,
      envelope?.success === false ? envelope.error?.code : undefined,
      envelope?.success === false ? envelope.error?.data : undefined,
    )
  }

  return envelope.data
}

function nodeSize(node: CinemaCanvasNode) {
  if (node.type === "text") return DEFAULT_NODE_SIZE.text
  return node.size ?? DEFAULT_NODE_SIZE[node.type]
}

function flowNodeStyle(type: CinemaNodeType, size: { width: number; height: number }): CSSProperties {
  return type === "text" || type === "image" || type === "video"
    ? { width: size.width }
    : { width: size.width, height: size.height }
}

class CinemaRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = "CinemaRequestError"
  }
}

function toFlowNodes(canvas: CinemaCanvasDocument): CinemaFlowNode[] {
  return canvas.nodes.map((node) => {
    const cinemaType = node.type
    const size = nodeSize(node)
    return {
      id: node.id,
      type: "cinemaNode",
      position: node.position,
      style: flowNodeStyle(cinemaType, size),
      data: {
        cinemaType,
        title: node.title,
        rawData: cinemaType === "image"
          ? canonicalizeCinemaImageNodeData(node.data ?? {})
          : node.data ?? {},
        size,
      },
    }
  })
}

function toCanvasNode(node: CinemaFlowNode): CinemaCanvasNode {
  const cinemaType = node.data.cinemaType
  const width = typeof node.style?.width === "number"
    ? node.style.width
    : node.measured?.width ?? node.data.size?.width ?? DEFAULT_NODE_SIZE[cinemaType].width
  const height = typeof node.style?.height === "number"
    ? node.style.height
    : node.measured?.height ?? node.data.size?.height ?? DEFAULT_NODE_SIZE[cinemaType].height

  return {
    id: node.id,
    type: cinemaType,
    title: node.data.title.trim() || "Untitled Node",
    position: node.position,
    size: { width, height },
    data: cinemaType === "image"
      ? canonicalizeCinemaImageNodeData(node.data.rawData)
      : node.data.rawData,
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

function makeAssetNodeID() {
  return `node-asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function cinemaAssetLocatorStatusKey(assetRef: CinemaAssetLocator) {
  return JSON.stringify(assetRef.scope.type === "personal"
    ? ["personal", assetRef.assetID]
    : ["project", assetRef.scope.projectID, assetRef.assetID])
}

type CanvasAssetLiveState = {
  status: string
  asset?: CinemaAssetRecord
}

function makeAssetLibraryOperationID(type: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${type}-${suffix}`
}

function makeGenerationOperationID() {
  const browserCrypto = globalThis.crypto as Crypto | undefined
  if (typeof browserCrypto?.randomUUID === "function") return browserCrypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (browserCrypto) {
    browserCrypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isDefaultGeneratedTitle(label: string, title: string) {
  const normalizedTitle = title.trim()
  const labels = label === "Image" ? [label, "Image Gen"] : [label]
  return labels.some((candidate) => {
    const pattern = new RegExp(`^${escapeRegExp(candidate)}\\s+\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s?[AP]M)?$`, "i")
    return pattern.test(normalizedTitle)
  })
}

function readRawString(rawData: Record<string, unknown>, key: string, fallback = "") {
  const value = rawData[key]
  return typeof value === "string" ? value : fallback
}

function readOptionalRawString(rawData: Record<string, unknown>, key: string) {
  const value = rawData[key]
  return typeof value === "string" ? value : null
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

function generationFormDefaultParameters(formSpec: GenerationFormSpec | null | undefined) {
  return generationControlDefaultParameters(formSpec?.controls ?? [])
}

function readGenerationFormParameters(rawData: Record<string, unknown>, formSpec: GenerationFormSpec | null | undefined) {
  return {
    ...generationFormDefaultParameters(formSpec),
    ...readRawRecord(rawData, "parameters"),
  }
}

function generationControlVisible(control: GenerationControl, parameters: Record<string, unknown>) {
  if (!control.visibleWhen) return true
  return Object.entries(control.visibleWhen).every(([key, value]) => parameters[key] === value)
}

function generationSelectOptionIndex(control: Extract<GenerationControl, { type: "select" }>, value: unknown) {
  return control.options.findIndex((option) => option === value)
}

function generationControlValueLabel(control: Extract<GenerationControl, { type: "select" }>, value: string | number | boolean) {
  return control.labels?.[String(value)] ?? String(value)
}

function isPrimaryImageGenerationControl(control: GenerationControl) {
  const key = normalizedProviderInputRole(control.key)
  const label = normalizedProviderInputRole(control.label)
  return key === "resolution" ||
    key === "aspectratio" ||
    key === "count" ||
    key === "size" ||
    label === "resolution" ||
    label === "aspectratio" ||
    label === "count" ||
    label === "size"
}

function primaryImageGenerationControlRank(control: GenerationControl) {
  const roles = [
    normalizedProviderInputRole(control.key),
    normalizedProviderInputRole(control.label),
  ]
  if (roles.some((role) => role === "resolution" || role === "size")) return 0
  if (roles.includes("aspectratio")) return 1
  if (roles.includes("count")) return 2
  return 3
}

function generationControlReady(control: GenerationControl, parameters: Record<string, unknown>) {
  if (!control.required) return true
  const value = parameters[control.key]
  switch (control.type) {
    case "text":
    case "prompt":
      return typeof value === "string" && value.trim().length > 0
    case "media": {
      const values = Array.isArray(value) ? value : value ? [value] : []
      return values.length >= (control.minCount ?? 1)
    }
    case "image-list":
      return Array.isArray(value) && value.length >= (control.minCount ?? 1)
    case "select":
      return control.options.some((option) => option === value)
    case "number":
      return typeof value === "number" && Number.isFinite(value)
    case "boolean":
      return typeof value === "boolean"
    case "json":
      return value !== undefined && value !== null
  }
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

function parseJsonDraft(value: string, fallback: unknown = {}) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return fallback
  }
}

type CinemaComposerSelectOption = {
  value: string
  label: string
  triggerLabel?: string
  disabled?: boolean
}

type CinemaComposerSelectProps = {
  id?: string
  ariaLabel: string
  value: string
  options: CinemaComposerSelectOption[]
  disabled?: boolean
  placeholder?: string
  className?: string
  menuMinWidth?: number
  onChange: (value: string) => void
}

function CinemaComposerSelect({
  id,
  ariaLabel,
  value,
  options,
  disabled = false,
  placeholder = "未选择",
  className = "",
  menuMinWidth = 176,
  onChange,
}: CinemaComposerSelectProps) {
  const generatedID = useId().replace(/:/g, "")
  const controlID = id ?? `cinema-composer-select-${generatedID}`
  const menuID = `${controlID}-menu`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef(new Map<string, HTMLButtonElement>())
  const didFocusMenuRef = useRef(false)
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<{
    left: number
    top: number
    width: number
    maxHeight: number
  } | null>(null)
  const selectedOption = options.find((option) => option.value === value) ?? null
  const enabledOptions = options.filter((option) => !option.disabled)
  const focusTargetValue = selectedOption && !selectedOption.disabled
    ? selectedOption.value
    : enabledOptions[0]?.value ?? ""

  useEffect(() => {
    if (!isOpen) return
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof globalThis.Node)) return
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setIsOpen(false)
    }
    window.addEventListener("pointerdown", closeOnOutsidePointerDown)
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointerDown)
  }, [isOpen])

  useEffect(() => {
    if (!disabled) return
    setIsOpen(false)
  }, [disabled])

  useLayoutEffect(() => {
    if (!isOpen) {
      didFocusMenuRef.current = false
      setMenuPosition(null)
      return
    }

    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const bounds = trigger.getBoundingClientRect()
      const viewportInset = 12
      const menuGap = 6
      const preferredHeight = Math.min(256, Math.max(42, options.length * 34 + 8))
      const spaceBelow = window.innerHeight - bounds.bottom - viewportInset - menuGap
      const spaceAbove = bounds.top - viewportInset - menuGap
      const placeBelow = spaceBelow >= Math.min(preferredHeight, spaceAbove)
      const availableHeight = Math.max(96, placeBelow ? spaceBelow : spaceAbove)
      const maxHeight = Math.min(preferredHeight, availableHeight)
      const width = Math.min(
        Math.max(bounds.width, menuMinWidth),
        Math.max(menuMinWidth, window.innerWidth - viewportInset * 2),
      )
      const left = Math.min(
        window.innerWidth - viewportInset - width,
        Math.max(viewportInset, bounds.left),
      )
      const nextPosition = {
        left,
        top: placeBelow ? bounds.bottom + menuGap : Math.max(viewportInset, bounds.top - menuGap - maxHeight),
        width,
        maxHeight,
      }
      setMenuPosition((current) => current
        && current.left === nextPosition.left
        && current.top === nextPosition.top
        && current.width === nextPosition.width
        && current.maxHeight === nextPosition.maxHeight
        ? current
        : nextPosition)
    }

    updatePosition()
    let animationFrameID = 0
    const trackAnchorPosition = () => {
      updatePosition()
      animationFrameID = window.requestAnimationFrame(trackAnchorPosition)
    }
    animationFrameID = window.requestAnimationFrame(trackAnchorPosition)
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.cancelAnimationFrame(animationFrameID)
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [isOpen, menuMinWidth, options.length])

  useEffect(() => {
    if (!isOpen || !menuPosition || didFocusMenuRef.current || !focusTargetValue) return
    const frameID = window.requestAnimationFrame(() => {
      const target = optionRefs.current.get(focusTargetValue)
      if (!target) return
      target.focus()
      didFocusMenuRef.current = true
    })
    return () => window.cancelAnimationFrame(frameID)
  }, [focusTargetValue, isOpen, menuPosition])

  const closeAndRestoreFocus = () => {
    setIsOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    stopCanvasKeyboardEvent(event)
    if (event.key === "Escape") {
      event.preventDefault()
      closeAndRestoreFocus()
      return
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    if (enabledOptions.length === 0) return
    const focusedValue = [...optionRefs.current.entries()]
      .find(([, element]) => element === document.activeElement)?.[0]
    const focusedIndex = focusedValue ? enabledOptions.findIndex((option) => option.value === focusedValue) : -1
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? enabledOptions.length - 1
        : event.key === "ArrowUp"
          ? (focusedIndex <= 0 ? enabledOptions.length - 1 : focusedIndex - 1)
          : (focusedIndex + 1) % enabledOptions.length
    optionRefs.current.get(enabledOptions[nextIndex]!.value)?.focus()
  }

  return (
    <div className={`cinema-composer-select ${className}`.trim()}>
      <button
        ref={triggerRef}
        id={controlID}
        type="button"
        className="cinema-composer-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={menuID}
        title={selectedOption?.label ?? placeholder}
        disabled={disabled || enabledOptions.length === 0}
        onKeyDown={(event) => {
          stopCanvasKeyboardEvent(event)
          if (event.key === "Escape" && isOpen) {
            event.preventDefault()
            setIsOpen(false)
            return
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          event.preventDefault()
          setIsOpen(true)
        }}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{selectedOption?.triggerLabel ?? selectedOption?.label ?? placeholder}</span>
      </button>
      {isOpen && menuPosition ? createPortal(
        <div
          ref={menuRef}
          id={menuID}
          className="cinema-composer-select-menu nodrag nowheel"
          role="listbox"
          aria-label={ariaLabel}
          style={menuPosition}
          onKeyDown={handleMenuKeyDown}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget
            if (nextTarget instanceof globalThis.Node && event.currentTarget.contains(nextTarget)) return
            setIsOpen(false)
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          {options.map((option) => (
            <button
              ref={(element) => {
                if (element) optionRefs.current.set(option.value, element)
                else optionRefs.current.delete(option.value)
              }}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              tabIndex={option.value === value ? 0 : -1}
              className={`cinema-composer-select-option ${option.value === value ? "is-selected" : ""}`}
              disabled={option.disabled}
              title={option.label}
              onClick={() => {
                if (option.value !== value) onChange(option.value)
                closeAndRestoreFocus()
              }}
            >
              <span>{option.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

type GenerationSpecPopoverProps = {
  id: string
  ariaLabel: string
  summary: string
  disabled?: boolean
  onKeepActive?: () => void
  children: ReactNode
}

function GenerationSpecPopover({
  id,
  ariaLabel,
  summary,
  disabled = false,
  onKeepActive,
  children,
}: GenerationSpecPopoverProps) {
  const panelID = `${id}-panel`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const didFocusPanelRef = useRef(false)
  const [isOpen, setIsOpen] = useState(false)
  const [panelPosition, setPanelPosition] = useState<{
    left: number
    top: number
    width: number
    maxHeight: number
  } | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof globalThis.Node)) return
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setIsOpen(false)
    }
    window.addEventListener("pointerdown", closeOnOutsidePointerDown)
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointerDown)
  }, [isOpen])

  useEffect(() => {
    if (!disabled) return
    setIsOpen(false)
  }, [disabled])

  useLayoutEffect(() => {
    if (!isOpen) {
      didFocusPanelRef.current = false
      setPanelPosition(null)
      return
    }

    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const bounds = trigger.getBoundingClientRect()
      const viewportInset = 12
      const panelGap = 6
      const preferredWidth = 320
      const preferredHeight = 220
      const viewportWidth = Math.max(0, window.innerWidth - viewportInset * 2)
      const width = Math.min(Math.max(bounds.width, preferredWidth), viewportWidth)
      const spaceBelow = window.innerHeight - bounds.bottom - viewportInset - panelGap
      const spaceAbove = bounds.top - viewportInset - panelGap
      const placeBelow = spaceBelow >= Math.min(preferredHeight, spaceAbove)
      const availableHeight = Math.max(96, placeBelow ? spaceBelow : spaceAbove)
      const maxHeight = Math.min(preferredHeight, availableHeight)
      const measuredHeight = panelRef.current?.getBoundingClientRect().height ?? 0
      const placementHeight = measuredHeight > 0 ? Math.min(measuredHeight, maxHeight) : maxHeight
      const preferredTop = placeBelow ? bounds.bottom + panelGap : bounds.top - panelGap - placementHeight
      const maximumTop = Math.max(viewportInset, window.innerHeight - viewportInset - placementHeight)
      const left = Math.min(
        window.innerWidth - viewportInset - width,
        Math.max(viewportInset, bounds.right - width),
      )
      const nextPosition = {
        left,
        top: Math.min(maximumTop, Math.max(viewportInset, preferredTop)),
        width,
        maxHeight,
      }
      setPanelPosition((current) => current
        && current.left === nextPosition.left
        && current.top === nextPosition.top
        && current.width === nextPosition.width
        && current.maxHeight === nextPosition.maxHeight
        ? current
        : nextPosition)
    }

    updatePosition()
    let animationFrameID = 0
    const trackAnchorPosition = () => {
      updatePosition()
      animationFrameID = window.requestAnimationFrame(trackAnchorPosition)
    }
    animationFrameID = window.requestAnimationFrame(trackAnchorPosition)
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.cancelAnimationFrame(animationFrameID)
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !panelPosition || didFocusPanelRef.current) return
    const frameID = window.requestAnimationFrame(() => {
      const focusTarget = panelRef.current?.querySelector<HTMLElement>(
        '[role="radio"][aria-checked="true"], input:not(:disabled), button:not(:disabled)',
      )
      if (!focusTarget) return
      focusTarget.focus()
      didFocusPanelRef.current = true
    })
    return () => window.cancelAnimationFrame(frameID)
  }, [isOpen, panelPosition])

  const closeAndRestoreFocus = () => {
    onKeepActive?.()
    setIsOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  return (
    <div className="cinema-generation-spec">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="cinema-generation-spec-trigger"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={panelID}
        title={`${ariaLabel}: ${summary}`}
        disabled={disabled}
        onKeyDown={(event) => {
          stopCanvasKeyboardEvent(event)
          if (event.key === "Escape" && isOpen) {
            event.preventDefault()
            closeAndRestoreFocus()
            return
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          event.preventDefault()
          setIsOpen(true)
        }}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span>{summary}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {isOpen && panelPosition ? createPortal(
        <div
          ref={panelRef}
          id={panelID}
          className="cinema-generation-spec-panel nodrag nowheel"
          role="dialog"
          aria-label={ariaLabel}
          style={panelPosition}
          onKeyDown={(event) => {
            stopCanvasKeyboardEvent(event)
            if (event.key !== "Escape") return
            event.preventDefault()
            closeAndRestoreFocus()
          }}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget
            if (nextTarget instanceof globalThis.Node && event.currentTarget.contains(nextTarget)) return
            setIsOpen(false)
          }}
          onPointerDown={(event) => {
            event.stopPropagation()
            onKeepActive?.()
          }}
          onClick={(event) => {
            event.stopPropagation()
            onKeepActive?.()
          }}
          onWheel={(event) => event.stopPropagation()}
        >
          {children}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

type GenerationSpecOption = {
  value: string
  label: string
}

function GenerationSpecOptionGroup({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: GenerationSpecOption[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  const selectedIndex = options.findIndex((option) => option.value === value)
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    if (disabled || options.length === 0) return
    const focusedIndex = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
      .findIndex((button) => button === document.activeElement)
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (focusedIndex <= 0 ? options.length - 1 : focusedIndex - 1)
          : (focusedIndex + 1) % options.length
    const nextOption = options[nextIndex]
    if (!nextOption) return
    const nextButton = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]
    nextButton?.focus()
    onChange(nextOption.value)
  }

  return (
    <section className="cinema-generation-spec-section">
      <h3>{label}</h3>
      <div
        className="cinema-generation-spec-options"
        role="radiogroup"
        aria-label={label}
        onKeyDown={handleKeyDown}
      >
        {options.map((option, index) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
              className={selected ? "is-selected" : ""}
              disabled={disabled}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function GenerationParameterControlField({
  control,
  parameters,
  disabled,
  agentBaseURL,
  projectID,
  onChange,
}: {
  control: GenerationControl
  parameters: Record<string, unknown>
  disabled: boolean
  agentBaseURL?: string
  projectID?: string
  onChange: (patch: Record<string, unknown>) => void
}) {
  const { locale, t } = useI18n()
  const mediaInputID = useId().replace(/:/g, "")
  const [mediaImportError, setMediaImportError] = useState<string | null>(null)
  const importMediaMutation = useMutation({
    mutationFn: async (files: File[]) => {
      if (control.type !== "media" || !agentBaseURL || !projectID) {
        throw new Error("Project media import is unavailable.")
      }
      const assets: CinemaImportedMediaAssetResult["asset"][] = []
      for (const file of files) {
        const dataBase64 = await fileToDataBase64(file)
        const result = await requestJson<CinemaImportedMediaAssetResult>(
          agentBaseURL,
          `/api/cinema/projects/${encodeURIComponent(projectID)}/assets/media-imports`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
    onMutate: () => setMediaImportError(null),
    onSuccess: (assets) => {
      if (control.type !== "media") return
      const values = assets.map((asset) => ({ path: asset.path, assetID: asset.id }))
      onChange({
        [control.key]: control.multiple ? values : values[0],
      })
    },
    onError: (error) => {
      setMediaImportError(error instanceof Error ? error.message : "Media import failed.")
    },
  })
  if (control.type === "image-list") return null
  const controlLabel = translateGenerationParameterLabel(locale, control.key, control.label)

  if (control.type === "select") {
    const selectedIndex = generationSelectOptionIndex(control, parameters[control.key])
    return (
      <div key={control.key} className="cinema-image-form-control">
        <span>{controlLabel}</span>
        <CinemaComposerSelect
          ariaLabel={controlLabel}
          value={selectedIndex >= 0 ? String(selectedIndex) : ""}
          disabled={disabled}
          options={control.options.map((option, index) => ({
            value: String(index),
            label: translateGenerationOptionLabel(
              locale,
              option,
              generationControlValueLabel(control, option),
            ),
          }))}
          onChange={(nextValue) => {
            const option = control.options[Number(nextValue)]
            onChange({ [control.key]: option })
          }}
        />
        {control.description ? <small>{control.description}</small> : null}
      </div>
    )
  }

  if (control.type === "number") {
    const value = parameters[control.key]
    return (
      <label key={control.key} className="cinema-image-form-control">
        <span>{controlLabel}</span>
        <input
          aria-label={controlLabel}
          type="number"
          min={control.min}
          max={control.max}
          step={control.step}
          value={typeof value === "number" && Number.isFinite(value) ? String(value) : ""}
          disabled={disabled}
          onKeyDown={(event) => event.stopPropagation()}
          onChange={(event) => {
            const nextValue = event.target.value.trim()
            const number = Number(nextValue)
            onChange({
              [control.key]: nextValue && Number.isFinite(number) ? number : undefined,
            })
          }}
        />
        {control.description ? <small>{control.description}</small> : null}
      </label>
    )
  }

  if (control.type === "boolean") {
    const checked = parameters[control.key] === true
    return (
      <div key={control.key} className="cinema-image-form-control">
        <span>{controlLabel}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          className={`cinema-image-form-switch ${checked ? "is-on" : ""}`}
          disabled={disabled}
          onClick={() => onChange({ [control.key]: !checked })}
        >
          <span aria-hidden="true" />
          <strong>{t(checked ? "common.on" : "common.off")}</strong>
        </button>
        {control.description ? <small>{control.description}</small> : null}
      </div>
    )
  }

  if (control.type === "text" || control.type === "prompt") {
    const value = parameters[control.key]
    if (control.type === "text" && !control.multiline) {
      return (
        <label key={control.key} className="cinema-image-form-control">
          <span>{controlLabel}</span>
          <input
            aria-label={controlLabel}
            type="text"
            defaultValue={typeof value === "string" ? value : ""}
            disabled={disabled}
            maxLength={control.maxLength}
            placeholder={control.placeholder}
            onKeyDown={(event) => event.stopPropagation()}
            onBlur={(event) => onChange({ [control.key]: event.currentTarget.value })}
          />
          {control.description ? <small>{control.description}</small> : null}
        </label>
      )
    }
    return (
      <label key={control.key} className="cinema-image-form-control is-json">
        <span>{controlLabel}</span>
        <textarea
          aria-label={controlLabel}
          defaultValue={typeof value === "string" ? value : ""}
          disabled={disabled}
          maxLength={control.maxLength}
          placeholder={control.placeholder}
          spellCheck={false}
          onKeyDown={(event) => event.stopPropagation()}
          onBlur={(event) => onChange({
            [control.key]: event.currentTarget.value.length > 0 ? event.currentTarget.value : undefined,
          })}
        />
        {control.description ? <small>{control.description}</small> : null}
      </label>
    )
  }

  if (control.type === "media") {
    const rawValue = parameters[control.key]
    const values = (Array.isArray(rawValue) ? rawValue : rawValue ? [rawValue] : []).flatMap((value) => {
      if (typeof value === "string") return [value]
      if (!value || typeof value !== "object" || Array.isArray(value)) return []
      const path = (value as Record<string, unknown>).path
      return typeof path === "string" ? [path] : []
    })
    const accept = control.supportedMimeTypes?.join(",")
      ?? `${control.mediaKind}/*`
    return (
      <div key={control.key} className="cinema-image-form-control cinema-generation-media-control">
        <span>{controlLabel}</span>
        <input
          id={mediaInputID}
          className="cinema-file-input"
          type="file"
          accept={accept}
          multiple={control.multiple}
          disabled={disabled || importMediaMutation.isPending || !agentBaseURL || !projectID}
          tabIndex={-1}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])]
            event.currentTarget.value = ""
            if (files.length > 0) importMediaMutation.mutate(files)
          }}
        />
        <div className="cinema-generation-media-actions">
          <label
            htmlFor={mediaInputID}
            className={`cinema-generation-media-import ${disabled || importMediaMutation.isPending ? "is-disabled" : ""}`}
            aria-disabled={disabled || importMediaMutation.isPending}
          >
            {importMediaMutation.isPending ? <Loader2 size={13} className="is-spinning" aria-hidden="true" /> : <Upload size={13} aria-hidden="true" />}
            <span>{values.length > 0 ? values.map((value) => value.split("/").pop()).join(", ") : "Choose media"}</span>
          </label>
          {values.length > 0 ? (
            <button
              type="button"
              disabled={disabled || importMediaMutation.isPending}
              aria-label={`Clear ${controlLabel}`}
              onClick={() => onChange({ [control.key]: undefined })}
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {control.description ? <small>{control.description}</small> : null}
        {mediaImportError ? <small className="cinema-image-error" role="alert">{mediaImportError}</small> : null}
      </div>
    )
  }

  return (
    <label key={control.key} className="cinema-image-form-control is-json">
      <span>{controlLabel}</span>
      <textarea
        aria-label={controlLabel}
        defaultValue={stringifyJson(parameters[control.key])}
        disabled={disabled}
        spellCheck={false}
        onKeyDown={(event) => event.stopPropagation()}
        onBlur={(event) => {
          const parsed = control.serializedObjectOnly !== false
            ? parseJsonObjectDraft(event.currentTarget.value, {})
            : parseJsonDraft(event.currentTarget.value, {})
          onChange({ [control.key]: parsed })
        }}
      />
      {control.description ? <small>{control.description}</small> : null}
    </label>
  )
}

const GENERATION_PROGRESS_PHASES = [
  "preparing",
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
    case "preparing":
      return "Preparing"
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
  return progress.phase === "preparing"
    || progress.phase === "queued"
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
  const { locale, t } = useI18n()
  if (!progress) return null
  const percent = typeof progress.percent === "number" && Number.isFinite(progress.percent)
    ? Math.min(100, Math.max(0, progress.percent))
    : null
  const isActive = isActiveProgress(progress)
  const isIndeterminate = isActive && percent === null
  const label = progress.message?.startsWith("Waiting for Local ComfyUI")
    ? t("generation.progress.waitingForComfyUI")
    : translateGenerationProgress(locale, progress.phase, progressLabel(progress, status))
  return (
    <div className={`cinema-generation-progress is-${progress.phase} ${isIndeterminate ? "is-indeterminate" : ""} ${className}`}>
      <div className="cinema-generation-progress-meta">
        <span>{label}</span>
        {percent !== null ? <span>{Math.round(percent)}%</span> : null}
      </div>
      <div
        className="cinema-generation-progress-track"
        role="progressbar"
        aria-label={t("generation.progress")}
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

type PreviewAspectRatio = {
  value: string
  shape: "landscape" | "square" | "portrait"
}

function previewAspectRatioFromDimensions(width: number | undefined, height: number | undefined): PreviewAspectRatio | null {
  if (!width || !height) return null
  const ratio = width / height
  return {
    value: `${width} / ${height}`,
    shape: ratio < 0.9 ? "portrait" : ratio > 1.1 ? "landscape" : "square",
  }
}

function previewAspectRatioFromText(value: string | null | undefined): PreviewAspectRatio | null {
  const match = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(value?.trim() ?? "")
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? previewAspectRatioFromDimensions(width, height)
    : null
}

function videoPreviewAspectRatio(asset: { width?: number; height?: number } | null, fallbackAspectRatio: string) {
  return previewAspectRatioFromDimensions(asset?.width, asset?.height)
    ?? previewAspectRatioFromText(fallbackAspectRatio)
    ?? previewAspectRatioFromText(DEFAULT_VIDEO_ASPECT_RATIO)!
}

function projectAssetPreviewURL(agentBaseURL: string, projectID: string, assetPath: string) {
  const encodedPath = assetPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return resolveCinemaRuntimeURL(
    agentBaseURL,
    `/api/cinema/projects/${encodeURIComponent(projectID)}/assets/${encodedPath}`,
  )
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

const VIDEO_OUTPUT_GENERATION_MODES = new Set([
  "text-to-video",
  "image-to-video",
  "frames-to-video",
  "reference-to-video",
  "video-to-video",
  "edit",
  "extend",
  "motion-control",
])

function generationModeOutputsVideo(mode: string) {
  const normalized = mode.trim().toLowerCase()
  return VIDEO_OUTPUT_GENERATION_MODES.has(normalized) ||
    normalized.includes("-to-video") ||
    normalized.endsWith("-video")
}

function providerModelOutputModalities(model: VideoProviderModel) {
  return model.modalities?.output.map((item) => item.trim().toLowerCase()).filter(Boolean) ?? []
}

function providerModelOutputsVideo(model: VideoProviderModel) {
  const outputModalities = providerModelOutputModalities(model)
  if (outputModalities.length > 0) return outputModalities.includes("video")
  return model.modes.some(generationModeOutputsVideo) ||
    (model.inputCombinations ?? []).some((combination) => generationModeOutputsVideo(combination.mode))
}

function modelInputCombinationsForProvider(provider: CinemaVideoProvider | null, model: VideoProviderModel | null) {
  if (!provider || !model) return []
  return (model.inputCombinations ?? []).filter((combination) =>
    generationModeOutputsVideo(combination.mode) &&
    providerRuntimeSupportsCombination(provider, combination.mode)
  )
}

function modelHasAvailableInputCombinations(provider: CinemaVideoProvider, model: VideoProviderModel) {
  return providerModelOutputsVideo(model) && modelInputCombinationsForProvider(provider, model).length > 0
}

function availableVideoProviders(providers: CinemaVideoProvider[]) {
  return providers.filter((provider) =>
    providerAdapterAvailable(provider) &&
    provider.manifest.models.some((model) => modelHasAvailableInputCombinations(provider, model))
  )
}

function providerForSelection(providers: CinemaVideoProvider[], providerID: string) {
  const explicitlySelected = providerID
    ? providers.find((provider) => provider.manifest.id === providerID)
    : null
  if (explicitlySelected) return explicitlySelected
  const availableProviders = availableVideoProviders(providers)
  return availableProviders[0] ?? null
}

function availableModelsForProvider(provider: CinemaVideoProvider | null) {
  return provider?.manifest.models.filter((model) => modelHasAvailableInputCombinations(provider, model)) ?? []
}

function modelForSelection(provider: CinemaVideoProvider | null, modelID: string) {
  const availableModels = availableModelsForProvider(provider)
  if (modelID) return availableModels.find((model) => providerModelMatchesID(model, modelID)) ?? null
  return availableModels[0] ?? null
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

function hiddenDefaultParametersForCombination(combination: VideoProviderInputCombination | null) {
  return generationHiddenDefaultParametersForCombination(combination)
}

function videoModeInputContractForCombination(combination: VideoProviderInputCombination | null): VideoModeInputContract {
  return generationModeInputContractForCombination(combination, FALLBACK_VIDEO_INPUT_COMBINATION_MODE)
}

function isVideoImageInputSlot(slot: VideoInputSlot): slot is VideoImageInputSlot {
  return isGenerationImageInputSlot(slot)
}

function isVideoMediaInputSlot(slot: VideoInputSlot): slot is VideoMediaInputSlot {
  return isGenerationMediaInputSlot(slot)
}

function canImportVideoInputLocalMedia(slot: VideoInputSlot | null): slot is VideoMediaInputSlot {
  return Boolean(slot && (VIDEO_LOCAL_MEDIA_INPUT_SLOTS as readonly VideoInputSlot[]).includes(slot))
}

function isVideoMediaInputControl(input: VideoInputControl): input is VideoInputControl & { slot: VideoMediaInputSlot } {
  return isGenerationMediaInputControl(input)
}

function videoInputControlsForNode(
  node: CinemaFlowNode,
  providers: CinemaVideoProvider[],
): VideoInputControl[] | undefined {
  if (node.data.cinemaType !== "video") return undefined
  const provider = providerForSelection(
    providers,
    readRawString(node.data.rawData, "providerID"),
  )
  const model = modelForSelection(
    provider,
    readRawString(node.data.rawData, "modelID"),
  )
  const combination = inputCombinationForSelection(
    provider,
    model,
    readVideoMode(node.data.rawData),
  )
  return combination
    ? videoModeInputContractForCombination(combination).inputs
    : undefined
}

function videoInputAssetList(value: VideoInputAssetValue | undefined) {
  if (Array.isArray(value)) return value
  return value ? [value] : []
}

function readVideoMode(rawData: Record<string, unknown>) {
  return readRawString(rawData, "mode", FALLBACK_VIDEO_INPUT_COMBINATION_MODE)
}

function normalizedProviderInputRole(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function providerInputOptionValues(input: VideoProviderInputCombination["inputs"][number]) {
  const record = input as Record<string, unknown>
  const options = Array.isArray(record.options)
    ? record.options
    : Array.isArray(record.values)
      ? record.values
      : []
  return options
}

function providerInputForRoles(
  combination: VideoProviderInputCombination | null,
  roles: string[],
) {
  return combination?.inputs.find((input) => providerInputMatchesRole(input, roles)) ?? null
}

function providerInputMatchesRole(
  input: VideoProviderInputCombination["inputs"][number],
  roles: string[],
) {
  const normalizedRole = normalizedProviderInputRole(input.role)
  return roles.some((role) => normalizedRole === normalizedProviderInputRole(role))
}

function stringParameterOptionLabelsForCombination(
  combination: VideoProviderInputCombination | null,
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

function stringParameterOptionsForCombination(
  combination: VideoProviderInputCombination | null,
  roles: string[],
) {
  const values = combination?.inputs.flatMap((input) =>
    providerInputMatchesRole(input, roles)
      ? providerInputOptionValues(input).flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : [])
      : []
  ) ?? []
  return [...new Set(values)]
}

function numberParameterOptionsForCombination(
  combination: VideoProviderInputCombination | null,
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

function modelAspectRatioOptions(model: VideoProviderModel | null, combination: VideoProviderInputCombination | null) {
  const inputOptions = stringParameterOptionsForCombination(combination, ["aspect_ratio", "aspectRatio"])
  return inputOptions.length > 0 ? inputOptions : model?.aspectRatios ?? []
}

function modelDurationOptions(model: VideoProviderModel | null, combination: VideoProviderInputCombination | null) {
  const inputOptions = numberParameterOptionsForCombination(combination, ["duration"])
  return inputOptions.length > 0 ? inputOptions : model?.durations ?? []
}

function modelResolutionOptions(model: VideoProviderModel | null, combination: VideoProviderInputCombination | null) {
  const inputOptions = stringParameterOptionsForCombination(combination, ["quality_mode", "qualityMode", "mode", "resolution"])
  return inputOptions.length > 0 ? inputOptions : model?.resolutions ?? []
}

function defaultModelAspectRatio(model: VideoProviderModel | null, combination: VideoProviderInputCombination | null = null) {
  return modelAspectRatioOptions(model, combination)[0] ?? DEFAULT_VIDEO_ASPECT_RATIO
}

function defaultModelDuration(model: VideoProviderModel | null, combination: VideoProviderInputCombination | null = null) {
  return modelDurationOptions(model, combination)[0] ?? DEFAULT_VIDEO_DURATION_SECONDS
}

function defaultModelResolution(model: VideoProviderModel | null, combination: VideoProviderInputCombination | null = null) {
  return modelResolutionOptions(model, combination)[0] ?? DEFAULT_VIDEO_RESOLUTION
}

function validAspectRatioForSelection(
  value: string,
  model: VideoProviderModel | null,
  combination: VideoProviderInputCombination | null,
) {
  const trimmed = value.trim()
  const options = modelAspectRatioOptions(model, combination)
  return trimmed && (options.length === 0 || options.includes(trimmed))
    ? trimmed
    : defaultModelAspectRatio(model, combination)
}

function validDurationForSelection(
  value: string,
  model: VideoProviderModel | null,
  combination: VideoProviderInputCombination | null,
) {
  const parsed = Number.parseFloat(value)
  const options = modelDurationOptions(model, combination)
  return Number.isFinite(parsed) && parsed > 0 && (options.length === 0 || options.includes(parsed))
    ? parsed
    : defaultModelDuration(model, combination)
}

function validResolutionForSelection(
  value: string,
  model: VideoProviderModel | null,
  combination: VideoProviderInputCombination | null,
) {
  const trimmed = value.trim()
  const options = modelResolutionOptions(model, combination)
  return trimmed && (options.length === 0 || options.includes(trimmed))
    ? trimmed
    : defaultModelResolution(model, combination)
}

function generationTaskUserPrompt(task: CinemaGenerationTask | null) {
  const value = task?.input.parameters.userPrompt
  return typeof value === "string" ? value : null
}

const GENERATION_ERROR_TRANSLATION_KEYS: Partial<Record<string, TranslationKey>> = {
  COMFYUI_OFFLINE: "video.error.comfyuiOffline",
  COMFYUI_BASE_URL_INVALID: "video.error.comfyuiEndpointInvalid",
  COMFYUI_BASE_URL_NOT_LOCAL: "video.error.comfyuiEndpointNotLocal",
  COMFYUI_NODES_MISSING: "video.error.comfyuiNodesMissing",
  COMFYUI_MODELS_MISSING: "video.error.comfyuiModelsMissing",
  COMFYUI_WORKFLOW_INCOMPATIBLE: "video.error.comfyuiWorkflowInvalid",
  COMFYUI_PROFILE_INVALID: "video.error.comfyuiWorkflowInvalid",
  COMFYUI_PROFILE_DIGEST_MISMATCH: "video.error.comfyuiWorkflowInvalid",
  COMFYUI_EXECUTION_FAILED: "video.error.comfyuiExecutionFailed",
  COMFYUI_EXECUTION_INTERRUPTED: "video.error.comfyuiExecutionFailed",
  COMFYUI_TASK_LOST: "video.error.comfyuiTaskLost",
  COMFYUI_IMAGE_REQUIRED: "video.error.comfyuiInputInvalid",
  COMFYUI_IMAGE_INVALID: "video.error.comfyuiInputInvalid",
  COMFYUI_IMAGE_UNSUPPORTED: "video.error.comfyuiInputInvalid",
  COMFYUI_IMAGE_COUNT_INVALID: "video.error.comfyuiInputInvalid",
  COMFYUI_IMAGE_TOO_LARGE: "video.error.comfyuiInputTooLarge",
  COMFYUI_OUTPUT_INVALID: "video.error.comfyuiOutputInvalid",
  COMFYUI_OUTPUT_EMPTY: "video.error.comfyuiOutputInvalid",
  COMFYUI_OUTPUT_DOWNLOAD_FAILED: "video.error.comfyuiOutputInvalid",
  COMFYUI_OUTPUT_PATH_INVALID: "video.error.comfyuiOutputInvalid",
  COMFYUI_OUTPUT_TOO_LARGE: "video.error.comfyuiOutputTooLarge",
  COMFYUI_CANCEL_CONFLICT: "video.error.comfyuiCancelConflict",
}

function localizedGenerationError(
  errorCode: string | undefined,
  fallback: string | null,
  t: (key: TranslationKey) => string,
) {
  if (!errorCode) return fallback
  const key = GENERATION_ERROR_TRANSLATION_KEYS[errorCode]
  if (!key) return fallback
  const localized = t(key)
  return errorCode === "COMFYUI_WORKFLOW_INCOMPATIBLE" && fallback
    ? `${localized} ${fallback}`
    : localized
}

function localizedGenerationTaskError(
  task: CinemaGenerationTask | null,
  t: (key: TranslationKey) => string,
) {
  return localizedGenerationError(task?.errorCode, task?.error ?? null, t)
}

const COMFYUI_SETTINGS_ERROR_CODES = new Set([
  "COMFYUI_OFFLINE",
  "COMFYUI_BASE_URL_INVALID",
  "COMFYUI_BASE_URL_NOT_LOCAL",
  "COMFYUI_NODES_MISSING",
  "COMFYUI_MODELS_MISSING",
  "COMFYUI_WORKFLOW_INCOMPATIBLE",
])

function requestDesktopCinemaProviderSettings(providerID: string) {
  const message = {
    type: "anybox:open-cinema-provider-settings",
    providerID,
  }
  window.postMessage(message, window.location.origin)
  if (window.parent !== window) window.parent.postMessage(message, "*")
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
      width: typeof record.width === "number" ? record.width : undefined,
      height: typeof record.height === "number" ? record.height : undefined,
    }]
  })
}

function readImageAsset(value: unknown): CinemaGeneratedAsset | null {
  return parseCinemaImageAsset(value)
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
  for (const slot of VIDEO_LOCAL_MEDIA_INPUT_SLOTS) {
    const rawAsset = record[slot]
    if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset)) continue
    const value = rawAsset as Record<string, unknown>
    const kind = value.kind === "image" || value.kind === "video" || value.kind === "audio" || value.kind === "file"
      ? value.kind
      : null
    const asset: CinemaGeneratedAsset | null = typeof value.id === "string" && typeof value.path === "string" && kind
      ? {
        id: value.id,
        path: value.path,
        kind,
        ...(typeof value.mimeType === "string" ? { mimeType: value.mimeType } : {}),
        ...(typeof value.sizeBytes === "number" ? { sizeBytes: value.sizeBytes } : {}),
        ...(typeof value.width === "number" ? { width: value.width } : {}),
        ...(typeof value.height === "number" ? { height: value.height } : {}),
      }
      : null
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

function readFinalImageAsset(rawData: Record<string, unknown>) {
  return readCinemaImageFinalAsset(rawData)
}

function selectedImageAssetForNode(node: CinemaFlowNode): VideoSourceImageAsset | null {
  const asset = readCinemaImageFinalAsset(node.data.rawData)
  if (!asset) return null
  return {
    ...asset,
    nodeID: node.id,
    nodeTitle: node.data.title,
  }
}

function selectedSourceImageAssetForNode(node: CinemaFlowNode): VideoSourceImageAsset | null {
  if (node.data.cinemaType === "image") {
    return selectedImageAssetForNode(node)
  }
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

function edgeMatchesVideoSlot(
  edge: Edge,
  slot: VideoInputSlot,
  nodes: CinemaFlowNode[],
  edges: Edge[],
  legacySlot: VideoInputSlot | null = null,
  targetInputs?: readonly VideoInputControl[],
) {
  const edgeSlot = edgeTargetVideoInput(edge, nodes, edges, targetInputs)?.slot ?? null
  if (edgeSlot) return edgeSlot === slot
  if (targetInputs !== undefined) return false
  return legacySlot === slot
}

function sourceAssetsForVideoSlot(
  nodeID: string,
  nodes: CinemaFlowNode[],
  edges: Edge[],
  slot: VideoMediaInputSlot,
  targetInputs?: readonly VideoInputControl[],
) {
  const assets: VideoSourceImageAsset[] = []
  const seen = new Set<string>()
  const legacySlot = slot === "sourceImage" ? "sourceImage" : null
  for (const edge of edges) {
    if (
      edge.target !== nodeID
      || !edgeMatchesVideoSlot(edge, slot, nodes, edges, legacySlot, targetInputs)
    ) continue
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
  targetInputs?: readonly VideoInputControl[],
) {
  return sourceAssetsForVideoSlot(nodeID, nodes, edges, slot, targetInputs)
}

function sourceImageAssetForVideoSlot(
  nodeID: string,
  nodes: CinemaFlowNode[],
  edges: Edge[],
  slot: VideoImageInputSlot,
  targetInputs?: readonly VideoInputControl[],
) {
  return sourceImageAssetsForVideoSlot(nodeID, nodes, edges, slot, targetInputs)[0] ?? null
}

function sourceImageAssetsForVideoNode(
  nodeID: string,
  nodes: CinemaFlowNode[],
  edges: Edge[],
  targetInputs?: readonly VideoInputControl[],
) {
  const assets: VideoImageInputAssets = {}
  for (const slot of VIDEO_IMAGE_INPUT_SLOTS) {
    const slotAssets = sourceImageAssetsForVideoSlot(nodeID, nodes, edges, slot, targetInputs)
    assets[slot] = slot === "referenceImage" ? slotAssets : slotAssets[0] ?? null
  }
  return assets
}

function sourceInputAssetsForVideoNode(
  nodeID: string,
  nodes: CinemaFlowNode[],
  edges: Edge[],
  targetInputs?: readonly VideoInputControl[],
) {
  const assets: VideoInputAssets = {}
  for (const slot of VIDEO_INPUT_SLOTS) {
    if (!isVideoMediaInputSlot(slot)) continue
    const slotAssets = sourceAssetsForVideoSlot(nodeID, nodes, edges, slot, targetInputs)
    assets[slot] = slot === "referenceImage" ? slotAssets : slotAssets[0] ?? null
  }
  return assets
}

function sourceInputAssetMapsForVideoNode(
  nodeID: string,
  nodes: CinemaFlowNode[],
  edges: Edge[],
  targetInputs?: readonly VideoInputControl[],
) {
  const byInputKey: VideoInputAssetMap = {}
  const byRole: VideoInputAssetMap = {}
  const appendAsset = (map: VideoInputAssetMap, key: string, asset: VideoSourceImageAsset, allowMultiple: boolean) => {
    const current = videoInputAssetList(map[key])
    const next = allowMultiple ? [...current, asset] : [asset]
    map[key] = allowMultiple ? mergeSourceImageAssets(next) : next[0] ?? null
  }

  for (const edge of edges) {
    if (edge.target !== nodeID) continue
    const targetInput = edgeTargetVideoInput(edge, nodes, edges, targetInputs)
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

function sourceImageAssetForVideoNode(
  nodeID: string,
  nodes: CinemaFlowNode[],
  edges: Edge[],
  targetInputs?: readonly VideoInputControl[],
) {
  return sourceImageAssetForVideoSlot(nodeID, nodes, edges, "sourceImage", targetInputs)
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

function sourceTextParametersForNode(
  nodeID: string,
  nodes: CinemaFlowNode[],
  edges: Edge[],
  targetInputs?: readonly VideoInputControl[],
) {
  const parameters: SourceTextParameter[] = []
  const seenNodeIDs = new Set<string>()
  for (const edge of edges) {
    if (edge.target !== nodeID) continue
    const targetInput = edgeTargetVideoInput(edge, nodes, edges, targetInputs)
    if (targetInput && targetInput.slot !== "textParameter") continue
    if (seenNodeIDs.has(edge.source)) continue
    const sourceNode = nodes.find((node) => node.id === edge.source)
    if (!sourceNode || sourceNode.data.cinemaType !== "text") continue
    const text = readRawString(sourceNode.data.rawData, "text")
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

function blobToDataBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Could not read cropped image"))
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      const commaIndex = result.indexOf(",")
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

function dataBase64ToFile(dataBase64: string, fileName: string, mimeType: string) {
  const binary = window.atob(dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new globalThis.File([bytes], fileName, { type: mimeType })
}

function clampNumber(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function defaultImageCropDraft(): ImageCropDraftRect {
  return {
    x: 0.15,
    y: 0.15,
    width: 0.7,
    height: 0.7,
  }
}

function imageCropMinimumRatio(size: { width: number; height: number } | null): { width: number; height: number } {
  if (!size || size.width <= 0 || size.height <= 0) return { width: 0.05, height: 0.05 }
  return {
    width: Math.min(1, MIN_IMAGE_CROP_PIXELS / size.width),
    height: Math.min(1, MIN_IMAGE_CROP_PIXELS / size.height),
  }
}

function imageCropDraftFromDrag(
  drag: ImageCropDragState,
  pointer: { x: number; y: number },
  minRatio: { width: number; height: number },
): ImageCropDraftRect {
  const dx = pointer.x - drag.startPointer.x
  const dy = pointer.y - drag.startPointer.y
  const start = drag.startCrop

  if (drag.mode === "move") {
    return {
      ...start,
      x: clampNumber(start.x + dx, 0, 1 - start.width),
      y: clampNumber(start.y + dy, 0, 1 - start.height),
    }
  }

  let left = start.x
  let top = start.y
  let right = start.x + start.width
  let bottom = start.y + start.height

  if (drag.mode.includes("w")) left = clampNumber(start.x + dx, 0, right - minRatio.width)
  if (drag.mode.includes("e")) right = clampNumber(start.x + start.width + dx, left + minRatio.width, 1)
  if (drag.mode.includes("n")) top = clampNumber(start.y + dy, 0, bottom - minRatio.height)
  if (drag.mode.includes("s")) bottom = clampNumber(start.y + start.height + dy, top + minRatio.height, 1)

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }
}

function imageCropRectFromDraft(draft: ImageCropDraftRect, size: { width: number; height: number }): ImageCropRect {
  const x = Math.round(draft.x * size.width)
  const y = Math.round(draft.y * size.height)
  const right = Math.round((draft.x + draft.width) * size.width)
  const bottom = Math.round((draft.y + draft.height) * size.height)
  return normalizeImageCropRect({
    x,
    y,
    width: right - x,
    height: bottom - y,
    unit: "pixel",
  }, size.width, size.height)
}

function normalizeImageCropRect(crop: ImageCropRect, imageWidth: number, imageHeight: number): ImageCropRect {
  const width = Math.max(1, Math.round(imageWidth))
  const height = Math.max(1, Math.round(imageHeight))
  const x = clampNumber(Math.round(crop.x), 0, width - 1)
  const y = clampNumber(Math.round(crop.y), 0, height - 1)
  return {
    x,
    y,
    width: clampNumber(Math.round(crop.width), 1, width - x),
    height: clampNumber(Math.round(crop.height), 1, height - y),
    unit: "pixel",
  }
}

function scaleImageCropRect(
  crop: ImageCropRect,
  fromSize: { width: number; height: number },
  toSize: { width: number; height: number },
): ImageCropRect {
  return normalizeImageCropRect({
    x: Math.round(crop.x * toSize.width / fromSize.width),
    y: Math.round(crop.y * toSize.height / fromSize.height),
    width: Math.round(crop.width * toSize.width / fromSize.width),
    height: Math.round(crop.height * toSize.height / fromSize.height),
    unit: "pixel",
  }, toSize.width, toSize.height)
}

async function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error("Could not export cropped image"))
    }, "image/png")
  })
}

function imageCropOutputSize(crop: ImageCropRect) {
  const sourceWidth = Math.max(1, crop.width)
  const sourceHeight = Math.max(1, crop.height)
  const scale = Math.min(1, IMAGE_CROP_MAX_OUTPUT_SIDE / Math.max(sourceWidth, sourceHeight))
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

async function cropImageURLToPngDataBase64(
  imageURL: string,
  crop: ImageCropRect,
  sourceSize: { width: number; height: number } | null,
) {
  const response = await fetch(imageURL)
  if (!response.ok) throw new Error(`Could not load image for crop (${response.status})`)
  const blob = await response.blob()
  if (sourceSize && sourceSize.width > 0 && sourceSize.height > 0) {
    const sourceCrop = normalizeImageCropRect(crop, sourceSize.width, sourceSize.height)
    const outputSize = imageCropOutputSize(sourceCrop)
    try {
      const bitmap = await createImageBitmap(blob, sourceCrop.x, sourceCrop.y, sourceCrop.width, sourceCrop.height, {
        resizeWidth: outputSize.width,
        resizeHeight: outputSize.height,
        resizeQuality: "high",
      })
      try {
        const canvas = document.createElement("canvas")
        canvas.width = outputSize.width
        canvas.height = outputSize.height
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Could not prepare image crop")
        context.drawImage(bitmap, 0, 0, outputSize.width, outputSize.height)
        return {
          dataBase64: await blobToDataBase64(await canvasToPngBlob(canvas)),
          outputSize,
          bitmapCrop: sourceCrop,
        }
      } finally {
        bitmap.close()
      }
    } catch {
      // Some image formats cannot be decoded through the cropped ImageBitmap path.
    }
  }

  const bitmap = await createImageBitmap(blob)
  try {
    const bitmapCrop = sourceSize && sourceSize.width > 0 && sourceSize.height > 0
      ? scaleImageCropRect(crop, sourceSize, { width: bitmap.width, height: bitmap.height })
      : normalizeImageCropRect(crop, bitmap.width, bitmap.height)
    const outputSize = imageCropOutputSize(bitmapCrop)
    const canvas = document.createElement("canvas")
    canvas.width = outputSize.width
    canvas.height = outputSize.height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Could not prepare image crop")
    context.drawImage(
      bitmap,
      bitmapCrop.x,
      bitmapCrop.y,
      bitmapCrop.width,
      bitmapCrop.height,
      0,
      0,
      outputSize.width,
      outputSize.height,
    )
    return {
      dataBase64: await blobToDataBase64(await canvasToPngBlob(canvas)),
      outputSize,
      bitmapCrop,
    }
  } finally {
    bitmap.close()
  }
}

function stripImageFileExtension(fileName: string) {
  return fileName.trim().replace(/\.(?:apng|avif|bmp|gif|jpe?g|png|svg|webp)$/i, "")
}

function croppedImageTitle(sourceTitle: string) {
  const base = stripImageFileExtension(sourceTitle).trim() || "Image"
  return `${base} - 编辑`.slice(0, 220)
}

function readImageCropRect(rawData: Record<string, unknown>): ImageCropRect | null {
  const crop = readRawRecord(rawData, "crop")
  const x = readRawNumber(crop, "x", Number.NaN)
  const y = readRawNumber(crop, "y", Number.NaN)
  const width = readRawNumber(crop, "width", Number.NaN)
  const height = readRawNumber(crop, "height", Number.NaN)
  const unit = readRawString(crop, "unit")
  if (
    unit !== "pixel" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null
  }
  return { x, y, width, height, unit }
}

function createNode(type: CinemaNodeType, position: { x: number; y: number }): CinemaFlowNode {
  const cinemaType = type
  const id = makeNodeID(cinemaType)
  const size = DEFAULT_NODE_SIZE[cinemaType]
  const rawData = cinemaType === "image"
    ? {
      prompt: "",
      size: DEFAULT_IMAGE_GENERATION_SIZE,
      count: DEFAULT_IMAGE_GENERATION_COUNT,
      status: "idle",
      placeholder: NODE_META[cinemaType].placeholder,
    }
    : cinemaType === "video"
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
    : {
      text: "",
      placeholder: NODE_META[cinemaType].placeholder,
    }

  return {
    id,
    type: "cinemaNode",
    position,
    style: flowNodeStyle(cinemaType, size),
    data: {
      cinemaType,
      title: titleForType(cinemaType),
      rawData,
      size,
    },
  }
}

function createImageAssetNode(
  asset: CinemaGeneratedAsset,
  fileName: string,
  position: { x: number; y: number },
  options: {
    title?: string
    rawDataPatch?: Record<string, unknown>
  } = {},
): CinemaFlowNode {
  const type = "image" satisfies CinemaNodeType
  const size = DEFAULT_NODE_SIZE[type]
  return {
    id: makeNodeID(type),
    type: "cinemaNode",
    position,
    style: flowNodeStyle(type, size),
    data: {
      cinemaType: type,
      title: options.title?.trim() || fileName.trim() || titleForType(type),
      rawData: {
        asset,
        sourceKind: options.rawDataPatch?.derivedOperation === "crop" ? "crop" : "upload",
        sourceFileName: fileName,
        status: "ready",
        importedAt: new Date().toISOString(),
        ...options.rawDataPatch,
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

function activateNodeOnPointerDown(
  event: ReactPointerEvent<HTMLElement>,
  nodeID: string,
  onActivateNode?: (nodeID: string, pointerID: number, multiSelect: boolean) => void,
) {
  if (event.button !== 0 || !event.isPrimary) return
  onActivateNode?.(nodeID, event.pointerId, hasMultiSelectModifier(event))
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"))
}

function stopCanvasKeyboardEvent(event: ReactKeyboardEvent<HTMLElement>) {
  event.stopPropagation()
  event.nativeEvent.stopImmediatePropagation()
}

const NODE_INPUT_OVERLAY_GAP = 12

function CinemaNodeInputOverlay({
  nodeID,
  selected,
  overlayRoot,
  width,
  accentStyle,
  children,
}: {
  nodeID: string
  selected?: boolean
  overlayRoot?: HTMLElement | null
  width: number
  accentStyle: CSSProperties
  children: ReactNode
}) {
  const viewport = useViewport()
  const internalNode = useInternalNode<CinemaFlowNode>(nodeID)
  const measuredWidth = internalNode?.measured.width ?? internalNode?.width ?? 0
  const measuredHeight = internalNode?.measured.height ?? internalNode?.height ?? 0
  const position = internalNode?.internals.positionAbsolute ?? { x: 0, y: 0 }
  const canRender = Boolean(selected && overlayRoot && internalNode && measuredWidth > 0 && measuredHeight > 0)

  if (!canRender || !overlayRoot) return null

  const left = viewport.x + (position.x + measuredWidth / 2) * viewport.zoom
  const top = viewport.y + (position.y + measuredHeight) * viewport.zoom + NODE_INPUT_OVERLAY_GAP

  const overlayStyle = {
    ...accentStyle,
    "--cinema-node-overlay-width": `${width}px`,
    left,
    top,
  } as unknown as CSSProperties

  return createPortal(
    <div
      className="cinema-node-overlay-panel"
      data-cinema-node-overlay={nodeID}
      style={overlayStyle}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    overlayRoot,
  )
}

function NodeTitleInput({
  nodeID,
  title,
  onChangeTitle,
  autoFocus = false,
  onFinishEditing,
}: {
  nodeID: string
  title: string
  onChangeTitle?: (nodeID: string, title: string) => void
  autoFocus?: boolean
  onFinishEditing?: () => void
}) {
  const { t } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(title)

  useEffect(() => {
    setDraft(title)
  }, [title])

  useEffect(() => {
    if (!autoFocus) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [autoFocus])

  const commitTitle = useCallback(() => {
    const nextTitle = draft.trim() || "Untitled Node"
    setDraft(nextTitle)
    if (nextTitle !== title) onChangeTitle?.(nodeID, nextTitle)
    onFinishEditing?.()
  }, [draft, nodeID, onChangeTitle, onFinishEditing, title])

  return (
    <input
      ref={inputRef}
      className="cinema-node-title-input nodrag nowheel"
      aria-label={t("text.nodeTitle")}
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
          event.preventDefault()
          setDraft(title)
          onFinishEditing?.()
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
  const { t } = useI18n()
  if (!onDeleteNode) return null
  return (
    <button
      type="button"
      className={`${className} nodrag nowheel`}
      title={t("node.delete")}
      aria-label={t("node.delete")}
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

function statusClassName(status: string) {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown"
}

function NodeStatusDot({ status, label }: { status?: string | null; label?: string }) {
  if (!status) return null
  const normalizedStatus = statusClassName(status)
  const statusLabel = label ?? status
  return (
    <span
      className={`cinema-node-status-dot is-${normalizedStatus}`}
      title={statusLabel}
      aria-label={statusLabel}
    >
      <span>{statusLabel}</span>
    </span>
  )
}

function CinemaNodeTitle({
  icon: Icon,
  label,
  nodeID,
  title,
  onChangeTitle,
  editRequestKey = 0,
  isDragHandle = false,
}: {
  icon: typeof FileText
  label: string
  nodeID: string
  title: string
  onChangeTitle?: (nodeID: string, title: string) => void
  editRequestKey?: number
  isDragHandle?: boolean
}) {
  const { t } = useI18n()
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const canEditTitle = Boolean(onChangeTitle)
  const hasCustomTitle = !isDefaultGeneratedTitle(label, title)

  const startEditingTitle = () => {
    if (!canEditTitle) return
    setIsEditingTitle(true)
  }

  useEffect(() => {
    if (editRequestKey > 0) startEditingTitle()
  }, [editRequestKey])

  return (
    <span
      className={`cinema-node-type ${canEditTitle ? `is-editable nowheel ${isDragHandle ? "is-drag-handle" : "nodrag"}` : ""}`}
      title={hasCustomTitle ? `${label} · ${title}` : `${label} · ${t("node.renameHint")}`}
      tabIndex={canEditTitle && !isEditingTitle ? 0 : undefined}
      onDoubleClick={(event) => {
        event.stopPropagation()
        startEditingTitle()
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "F2") return
        event.preventDefault()
        event.stopPropagation()
        startEditingTitle()
      }}
    >
      <Icon size={13} aria-hidden="true" />
      <span className="cinema-node-kind">{label}</span>
      {hasCustomTitle || isEditingTitle ? <span className="cinema-node-title-separator" aria-hidden="true">·</span> : null}
      {isEditingTitle ? (
        <NodeTitleInput
          nodeID={nodeID}
          title={title}
          onChangeTitle={onChangeTitle}
          autoFocus
          onFinishEditing={() => setIsEditingTitle(false)}
        />
      ) : hasCustomTitle ? (
        <span
          className="cinema-node-title-text"
          title={canEditTitle ? `${title} · ${t("node.renameHint")}` : title}
        >
          {title}
        </span>
      ) : null}
    </span>
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
  const { t } = useI18n()
  const active = data.isActiveNode ?? Boolean(selected)
  const updateNodeInternals = useUpdateNodeInternals()
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const generatorPromptRef = useRef<HTMLTextAreaElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const sourceImageInputRef = useRef<HTMLInputElement>(null)
  const modelControlRef = useRef<HTMLDivElement>(null)
  const modelButtonRef = useRef<HTMLButtonElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const modelOptionRefs = useRef(new Map<string, HTMLButtonElement>())
  const didFocusModelMenuRef = useRef(false)
  const [isTextEditorOpen, setIsTextEditorOpen] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [modelMenuPosition, setModelMenuPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null)
  const [moreMenuPosition, setMoreMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [titleEditRequestKey, setTitleEditRequestKey] = useState(0)
  const [sourceImageImportError, setSourceImageImportError] = useState<string | null>(null)
  const text = readRawString(data.rawData, "text")
  const generatorPrompt = readRawString(data.rawData, "generationPrompt")
  const placeholder = t("text.placeholder")
  const [textDraft, setTextDraftState] = useState(text)
  const [generatorPromptDraft, setGeneratorPromptDraftState] = useState(generatorPrompt)
  const textDraftRef = useRef(text)
  const generatorPromptDraftRef = useRef(generatorPrompt)
  const rawDataRef = useRef(data.rawData)
  const onChangeRawDataRef = useRef(data.onChangeRawData)
  const onNodeInputEditingChangeRef = useRef(data.onNodeInputEditingChange)
  const textCommitTimerRef = useRef<number | null>(null)
  const generatorPromptCommitTimerRef = useRef<number | null>(null)
  const isTextComposingRef = useRef(false)
  const isGeneratorPromptComposingRef = useRef(false)
  const isTextFocusedRef = useRef(false)
  const isGeneratorPromptFocusedRef = useRef(false)
  const textModels = data.textModels ?? []
  const selectedTextModelValue = readRawString(data.rawData, "textModel")
  const selectedTextModel =
    textModels.find((model) => model.value === selectedTextModelValue) ??
    data.effectiveTextModel ??
    textModels[0] ??
    null
  const modelMenuID = `${id}-text-model-menu`
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
  onNodeInputEditingChangeRef.current = data.onNodeInputEditingChange

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

  const syncNodeInputEditing = useCallback(() => {
    onNodeInputEditingChangeRef.current?.(id, (
      isTextFocusedRef.current
      || isGeneratorPromptFocusedRef.current
      || isTextComposingRef.current
      || isGeneratorPromptComposingRef.current
    ))
  }, [id])

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
    if (isTextFocusedRef.current || isTextComposingRef.current || textCommitTimerRef.current !== null) return
    textDraftRef.current = text
    setTextDraftState(text)
  }, [text])

  useEffect(() => {
    if (
      isGeneratorPromptFocusedRef.current
      || isGeneratorPromptComposingRef.current
      || generatorPromptCommitTimerRef.current !== null
    ) return
    generatorPromptDraftRef.current = generatorPrompt
    setGeneratorPromptDraftState(generatorPrompt)
  }, [generatorPrompt])

  useEffect(() => () => {
    clearTextCommitTimer()
    clearGeneratorPromptCommitTimer()
    onNodeInputEditingChangeRef.current?.(id, false)
  }, [clearGeneratorPromptCommitTimer, clearTextCommitTimer, id])

  useEffect(() => {
    if (!isModelMenuOpen) return

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof globalThis.Node)) return
      if (!modelControlRef.current?.contains(target) && !modelMenuRef.current?.contains(target)) {
        setIsModelMenuOpen(false)
      }
    }

    window.addEventListener("pointerdown", closeOnOutsidePointerDown)
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointerDown)
  }, [isModelMenuOpen])

  useLayoutEffect(() => {
    if (!isModelMenuOpen) {
      didFocusModelMenuRef.current = false
      setModelMenuPosition(null)
      return
    }

    const updatePosition = () => {
      const control = modelControlRef.current
      if (!control) return

      const bounds = control.getBoundingClientRect()
      const viewportInset = 12
      const menuGap = 6
      const preferredHeight = 220
      const spaceBelow = window.innerHeight - bounds.bottom - viewportInset - menuGap
      const spaceAbove = bounds.top - viewportInset - menuGap
      const placeBelow = spaceBelow >= Math.min(preferredHeight, spaceAbove)
      const availableHeight = Math.max(96, placeBelow ? spaceBelow : spaceAbove)
      const maxHeight = Math.min(preferredHeight, availableHeight)

      setModelMenuPosition({
        left: Math.min(window.innerWidth - viewportInset - 220, Math.max(viewportInset, bounds.left)),
        top: placeBelow ? bounds.bottom + menuGap : bounds.top - menuGap - maxHeight,
        maxHeight,
      })
    }

    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [isModelMenuOpen])

  useEffect(() => {
    if (!isModelMenuOpen || !modelMenuPosition || didFocusModelMenuRef.current) return
    didFocusModelMenuRef.current = true
    const frameID = window.requestAnimationFrame(() => {
      const targetValue = selectedTextModel?.value ?? textModels[0]?.value
      if (targetValue) modelOptionRefs.current.get(targetValue)?.focus()
    })
    return () => window.cancelAnimationFrame(frameID)
  }, [isModelMenuOpen, modelMenuPosition, selectedTextModel?.value, textModels])

  useEffect(() => {
    if (active) return
    isTextFocusedRef.current = false
    isGeneratorPromptFocusedRef.current = false
    isTextComposingRef.current = false
    isGeneratorPromptComposingRef.current = false
    onNodeInputEditingChangeRef.current?.(id, false)
    setIsTextEditorOpen(false)
    setIsModelMenuOpen(false)
    setMoreMenuPosition(null)
  }, [active, id])

  useEffect(() => {
    if (!data.isGeneratingText) return
    isTextFocusedRef.current = false
    isTextComposingRef.current = false
    syncNodeInputEditing()
    setIsTextEditorOpen(false)
  }, [data.isGeneratingText, syncNodeInputEditing])

  useLayoutEffect(() => {
    updateNodeInternals(id)
  }, [id, isTextEditorOpen, textDraft, updateNodeInternals])

  const focusEditor = () => {
    if (data.isGeneratingText) return
    data.onSelectNode?.(id)
    setIsTextEditorOpen(true)
    window.requestAnimationFrame(() => editorRef.current?.focus())
  }
  const copyText = () => {
    if (!textDraft.trim()) return
    void navigator.clipboard?.writeText(textDraft)
  }
  const closeMoreMenu = (restoreFocus = true) => {
    setMoreMenuPosition(null)
    if (restoreFocus) window.requestAnimationFrame(() => moreButtonRef.current?.focus())
  }
  const requestDelete = () => {
    if ((textDraft.trim() || data.hasConnections) && !window.confirm(t("text.deleteConfirm"))) return
    data.onDeleteNode?.(id)
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
  const handleModelMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    stopCanvasKeyboardEvent(event)
    if (event.key === "Escape") {
      event.preventDefault()
      setIsModelMenuOpen(false)
      window.requestAnimationFrame(() => modelButtonRef.current?.focus())
      return
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return

    event.preventDefault()
    const values = textModels.map((model) => model.value)
    if (values.length === 0) return
    const focusedValue = [...modelOptionRefs.current.entries()]
      .find(([, element]) => element === document.activeElement)?.[0]
    const focusedIndex = focusedValue ? values.indexOf(focusedValue) : -1
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? values.length - 1
        : event.key === "ArrowUp"
          ? (focusedIndex <= 0 ? values.length - 1 : focusedIndex - 1)
          : (focusedIndex + 1) % values.length
    modelOptionRefs.current.get(values[nextIndex]!)?.focus()
  }
  const generateText = () => {
    const prompt = generatorPromptDraft.trim()
    if (!prompt) {
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
  const hasPreviewText = textDraft.trim().length > 0
  const previewText = hasPreviewText ? textDraft : t("text.empty")
  const visibleLineCount = textNodeVisibleLineCount(textDraft)
  const textStatus = data.isGeneratingText ? "generating" : data.textGenerationError ? "failed" : null

  return (
    <>
      <Handle
        id="input"
        type="target"
        position={Position.Left}
        className={`cinema-node-handle cinema-node-handle-input ${data.hasIncomingConnection ? "is-connected" : ""}`}
        style={accentStyle}
        title={t("text.inputPort")}
        aria-label={t("text.inputPort")}
      />
      <article
        className={`cinema-node cinema-text-card-node ${selected ? "is-selected" : ""}`}
        style={{ ...accentStyle, "--cinema-text-visible-lines": visibleLineCount } as CSSProperties}
        onPointerDown={(event) => activateNodeOnPointerDown(event, id, data.onActivateNode)}
      >
        <header className="cinema-node-header">
          <CinemaNodeTitle
            icon={FileText}
            label="Text"
            nodeID={id}
            title={data.title}
            onChangeTitle={data.onChangeTitle}
            editRequestKey={titleEditRequestKey}
          />
          <div className="cinema-node-header-actions nodrag nowheel" role="toolbar" aria-label={t("text.actions")}>
            <NodeStatusDot status={textStatus} label={textStatus === "generating" ? t("text.generating") : textStatus === "failed" ? t("text.failed") : undefined} />
            <button
              ref={moreButtonRef}
              type="button"
              className={`cinema-node-action-button ${moreMenuPosition ? "is-active" : ""}`}
              title={t("text.more")}
              aria-label={t("text.more")}
              aria-haspopup="menu"
              aria-expanded={Boolean(moreMenuPosition)}
              tabIndex={active ? 0 : -1}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                data.onSelectNode?.(id)
                const bounds = event.currentTarget.getBoundingClientRect()
                setMoreMenuPosition({ x: bounds.right, y: bounds.bottom + 4 })
              }}
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className={`cinema-node-preview cinema-text-card-preview ${isTextEditorOpen ? "is-editing" : ""} ${hasPreviewText ? "has-text" : "is-empty"}`}>
          {active && isTextEditorOpen ? (
            <textarea
              ref={editorRef}
              className="cinema-text-card-editor nodrag nowheel"
              value={textDraft}
              placeholder={placeholder}
              rows={visibleLineCount}
              spellCheck={false}
              onFocus={() => {
                isTextFocusedRef.current = true
                syncNodeInputEditing()
              }}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key !== "Escape") return
                event.preventDefault()
                clearTextCommitTimer()
                commitRawDataPatch({ text: textDraftRef.current })
                isTextFocusedRef.current = false
                isTextComposingRef.current = false
                syncNodeInputEditing()
                setIsTextEditorOpen(false)
                window.requestAnimationFrame(() => previewRef.current?.focus())
              }}
              onChange={(event) => {
                const value = event.target.value
                isTextFocusedRef.current = true
                syncNodeInputEditing()
                setTextDraft(value)
                if (!isTextComposingRef.current) scheduleTextCommit(value)
              }}
              onCompositionStart={() => {
                isTextComposingRef.current = true
                syncNodeInputEditing()
                clearTextCommitTimer()
              }}
              onCompositionEnd={(event) => {
                isTextComposingRef.current = false
                const value = event.currentTarget.value
                setTextDraft(value)
                commitRawDataPatch({ text: value })
                syncNodeInputEditing()
              }}
              onBlur={() => {
                isTextFocusedRef.current = false
                if (isTextComposingRef.current) {
                  syncNodeInputEditing()
                  return
                }
                clearTextCommitTimer()
                commitRawDataPatch({ text: textDraftRef.current })
                syncNodeInputEditing()
              }}
            />
          ) : (
            <>
              {hasPreviewText ? null : <FileText size={28} aria-hidden="true" />}
              <div
                ref={previewRef}
                className="cinema-text-card-preview-text nowheel"
                title={previewText}
                tabIndex={0}
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  focusEditor()
                }}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  focusEditor()
                }}
              >
                {hasPreviewText ? <TextNodeMarkdownPreview text={textDraft} /> : previewText}
              </div>
            </>
          )}
        </div>
      </article>

      {moreMenuPosition ? (
        <CinemaContextMenuSurface
          x={moreMenuPosition.x}
          y={moreMenuPosition.y}
          compact
          className="cinema-text-more-menu"
          onClose={closeMoreMenu}
        >
          <button type="button" role="menuitem" disabled={!hasPreviewText} onClick={() => { copyText(); closeMoreMenu() }}>
            <Copy size={15} aria-hidden="true" /><span>{t("text.copy")}</span>
          </button>
          <button type="button" role="menuitem" disabled={!hasPreviewText} onClick={() => { downloadTextFile(data.title, textDraft); closeMoreMenu() }}>
            <Download size={15} aria-hidden="true" /><span>{t("text.download")}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => { setTitleEditRequestKey((value) => value + 1); closeMoreMenu(false) }}>
            <PencilLine size={15} aria-hidden="true" /><span>{t("text.rename")}</span>
          </button>
          <div className="cinema-context-menu-separator" role="separator" />
          <button type="button" role="menuitem" data-variant="danger" onClick={() => { requestDelete(); closeMoreMenu(false) }}>
            <Trash2 size={15} aria-hidden="true" /><span>{t("text.delete")}</span>
          </button>
        </CinemaContextMenuSurface>
      ) : null}

      {active ? (
        <CinemaNodeInputOverlay
          nodeID={id}
          selected={active}
          overlayRoot={data.nodeInputOverlayRoot}
          width={520}
          accentStyle={accentStyle}
        >
        <section className="cinema-node-input-panel cinema-text-card-generator nodrag nowheel" aria-label={t("text.generatorTitle")} style={accentStyle}>
          <div className="cinema-text-card-prompt-shell">
          {supportsSourceImage ? (
            <section className={`cinema-text-source-image ${selectedSourceImageAssets.length > 0 ? "is-ready" : "is-empty"}`} aria-label={t("text.availableReferenceImages")}>
              {sourceImageAssets.length > 0 ? (
                <>
                  <div className="cinema-text-source-image-main">
                    <Image size={13} aria-hidden="true" />
                    <span>{selectedSourceImageAssets.length > 0
                      ? t("text.referenceImages", { count: selectedSourceImageAssets.length })
                      : t("text.chooseReferenceImages")}</span>
                  </div>
                  <div className="cinema-text-source-image-list" aria-label={t("text.availableReferenceImages")}>
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
                            aria-label={t("text.selectReferenceImage", { name: asset.nodeTitle })}
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
                            title={t("text.removeReferenceImage", { name: asset.nodeTitle })}
                            aria-label={t("text.removeReferenceImage", { name: asset.nodeTitle })}
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
                  <span>{t("text.referenceEmpty")}</span>
                </div>
              )}
              <div className="cinema-text-source-image-actions">
                <button
                  type="button"
                  className="cinema-text-source-image-add"
                  title={t("text.localReferenceImage")}
                  aria-label={t("text.localReferenceImage")}
                  disabled={importTextSourceImageMutation.isPending}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    openSourceImagePicker()
                  }}
                >
                  <div className="cinema-video-input-slot-thumb" aria-hidden="true">
                    {importTextSourceImageMutation.isPending
                      ? <Loader2 size={14} className="is-spinning" />
                      : <Image size={14} />}
                  </div>
                  <span>{t("text.addReferenceImage")}</span>
                </button>
              </div>
              {sourceImageImportError ? (
                <p className="cinema-text-generator-error" role="alert" title={sourceImageImportError}>
                  {sourceImageImportError}
                </p>
              ) : null}
              <input
                ref={sourceImageInputRef}
                className="cinema-file-input"
                type="file"
                accept={IMAGE_FILE_ACCEPT}
                multiple
                onChange={handleSourceImageFileInputChange}
              />
            </section>
          ) : null}
          <textarea
            ref={generatorPromptRef}
            className="cinema-text-card-generator-input"
            value={generatorPromptDraft}
            placeholder={t("text.generatorPrompt")}
            onFocus={() => {
              isGeneratorPromptFocusedRef.current = true
              syncNodeInputEditing()
            }}
            onKeyDownCapture={stopCanvasKeyboardEvent}
            onKeyDown={stopCanvasKeyboardEvent}
            onChange={(event) => {
              const value = event.target.value
              isGeneratorPromptFocusedRef.current = true
              syncNodeInputEditing()
              setGeneratorPromptDraft(value)
              if (!isGeneratorPromptComposingRef.current) scheduleGeneratorPromptCommit(value)
            }}
            onCompositionStart={() => {
              isGeneratorPromptComposingRef.current = true
              syncNodeInputEditing()
              clearGeneratorPromptCommitTimer()
            }}
            onCompositionEnd={(event) => {
              isGeneratorPromptComposingRef.current = false
              const value = event.currentTarget.value
              setGeneratorPromptDraft(value)
              commitRawDataPatch({ generationPrompt: value })
              syncNodeInputEditing()
            }}
            onBlur={() => {
              isGeneratorPromptFocusedRef.current = false
              if (isGeneratorPromptComposingRef.current) {
                syncNodeInputEditing()
                return
              }
              clearGeneratorPromptCommitTimer()
              commitRawDataPatch({ generationPrompt: generatorPromptDraftRef.current })
              syncNodeInputEditing()
            }}
          />
          </div>
          <div className="cinema-text-card-generator-lower">
            {data.textGenerationError ? (
              <p className="cinema-text-generator-error" role="alert" title={data.textGenerationError}>
                {data.textGenerationError}
              </p>
            ) : null}
            <footer className="cinema-text-card-generator-footer">
              <div className="cinema-text-model-control" ref={modelControlRef}>
                <button
                  ref={modelButtonRef}
                  type="button"
                  className="cinema-text-card-model-button"
                  title={t("text.chooseModel")}
                  aria-haspopup="listbox"
                  aria-expanded={isModelMenuOpen}
                  aria-controls={modelMenuID}
                  disabled={textModels.length === 0 || data.isGeneratingText}
                  onKeyDown={(event) => {
                    stopCanvasKeyboardEvent(event)
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
                    event.preventDefault()
                    setIsModelMenuOpen(true)
                  }}
                  onClick={() => setIsModelMenuOpen((current) => !current)}
                >
                  <span>{selectedTextModel?.label ?? t("text.noModel")}</span>
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
                {isModelMenuOpen && modelMenuPosition ? createPortal(
                  <div
                    ref={modelMenuRef}
                    id={modelMenuID}
                    className="cinema-text-model-menu nodrag nowheel"
                    role="listbox"
                    aria-label={t("text.chooseModel")}
                    style={modelMenuPosition}
                    onKeyDown={handleModelMenuKeyDown}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                  >
                    {textModels.length > 0 ? textModels.map((model) => (
                      <button
                        ref={(element) => {
                          if (element) modelOptionRefs.current.set(model.value, element)
                          else modelOptionRefs.current.delete(model.value)
                        }}
                        key={model.value}
                        type="button"
                        role="option"
                        aria-selected={model.value === selectedTextModel?.value}
                        tabIndex={model.value === selectedTextModel?.value ? 0 : -1}
                        className={`cinema-text-model-option ${model.value === selectedTextModel?.value ? "is-selected" : ""}`}
                        onClick={() => {
                          commitRawDataPatch({ textModel: model.value })
                          setIsModelMenuOpen(false)
                          window.requestAnimationFrame(() => modelButtonRef.current?.focus())
                        }}
                      >
                        <span className="cinema-text-model-option-title">
                          <span>{model.label}</span>
                          {model.supportsImageInput ? (
                            <span
                              className="cinema-text-model-capability"
                              title={t("text.supportsImageInput")}
                              aria-label={t("text.supportsImageInput")}
                            >
                              <Image size={11} aria-hidden="true" />
                            </span>
                          ) : null}
                        </span>
                        <small>{model.providerLabel}</small>
                      </button>
                    )) : (
                      <span className="cinema-text-model-empty">{t("text.noModels")}</span>
                    )}
                  </div>,
                  document.body,
                ) : null}
              </div>
              <button
                type="button"
                className="cinema-text-card-submit"
                title={selectedTextModel ? t("text.generate") : t("text.noModelTitle")}
                aria-label={t("text.generate")}
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
        </CinemaNodeInputOverlay>
      ) : null}

      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className={`cinema-node-handle cinema-node-handle-output ${data.hasOutgoingConnection ? "is-connected" : ""}`}
        style={accentStyle}
        title={t("text.outputPort")}
        aria-label={t("text.outputPort")}
      />
    </>
  )
}

function ImageCreationState({
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
  const { locale, t } = useI18n()
  const active = data.isActiveNode ?? Boolean(selected)
  const nodeRef = useRef<HTMLElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const mainImageInputRef = useRef<HTMLInputElement>(null)
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
  const [isImageAdvancedOpen, setIsImageAdvancedOpen] = useState(false)
  const promptDraftRef = useRef(prompt)
  const styleDraftRef = useRef(style)
  const sizeDraftRef = useRef(size)
  const countDraftRef = useRef(count)
  const rawDataRef = useRef(data.rawData)
  const onChangeRawDataRef = useRef(data.onChangeRawData)
  const onNodeInputEditingChangeRef = useRef(data.onNodeInputEditingChange)
  const promptCommitTimerRef = useRef<number | null>(null)
  const isPromptComposingRef = useRef(false)
  const isPromptFocusedRef = useRef(false)
  const acceptsSourceImageImportResultRef = useRef(true)
  const imageModels = data.imageModels ?? []
  const sourceTextParameters = data.sourceTextParameters ?? []
  const tasks = data.generationTasks ?? []
  const taskID = readRawString(data.rawData, "taskID")
  const task = tasks.find((item) => item.id === taskID) ?? null
  const selectedImageModelValue = readRawString(data.rawData, "model")
  const storedImageWorkflowID = readRawString(data.rawData, "workflowID")
  const selectedImageModel =
    (selectedImageModelValue
      ? imageModels.find((model) => model.value === selectedImageModelValue)
      : data.effectiveImageModel ?? imageModels.find((model) => model.available) ?? imageModels[0]) ??
    null
  const selectedImageWorkflowTarget = selectedImageModel?.target?.kind === "workflow"
    ? selectedImageModel.target
    : null
  const comfyWorkflowCatalog = data.workflowCatalogs?.find((catalog) => catalog.providerID === "comfyui-local") ?? null
  const selectedImageWorkflowID = selectedImageWorkflowTarget?.workflowID || storedImageWorkflowID
  const selectedImageWorkflow = selectedImageWorkflowID
    ? comfyWorkflowCatalog?.workflows.find((workflow) => workflow.workflowID === selectedImageWorkflowID) ?? null
    : null
  const readyImageModelValues = new Set(imageModels.map((model) => model.value))
  const disabledImageWorkflowChoices = (data.workflowCatalogs ?? []).flatMap((catalog) => {
    const provider = data.videoProviders?.find((item) => item.manifest.id === catalog.providerID)
    if (!provider) return []
    return catalog.workflows.flatMap((workflow) => {
      if (workflow.output?.kind && workflow.output.kind !== "image") return []
      const value = `${catalog.providerID}/${workflow.workflowID}`
      if (readyImageModelValues.has(value)) return []
      const reason = catalog.status !== "ready"
        ? catalog.issues[0]?.message ?? t("generation.workflowCatalogStale")
        : workflowIssueSummary(workflow)
      return [{
        value,
        label: `${provider.manifest.name} · ${workflow.name} · ${reason}`,
        triggerLabel: workflow.name,
        disabled: true,
      }]
    })
  })
  const imageFormSpec = selectedImageModel?.formSpec ?? null
  const imageFormParameters = readGenerationFormParameters(data.rawData, imageFormSpec)
  const imageFormParametersRef = useRef(imageFormParameters)
  const visibleImageFormControls = imageFormSpec?.controls.filter((control) => generationControlVisible(control, imageFormParameters)) ?? []
  const promptControl = visibleImageFormControls.find((
    control,
  ): control is Extract<GenerationControl, { type: "prompt" | "text" }> =>
    control.type === "prompt" || control.type === "text"
  ) ?? null
  const sourceImageControl = visibleImageFormControls.find((
    control,
  ): control is Extract<GenerationControl, { type: "image-list" | "media" }> =>
    control.type === "image-list" || (control.type === "media" && control.mediaKind === "image")
  ) ?? null
  const parameterControls = visibleImageFormControls.filter((control) =>
    control.key !== promptControl?.key && control.key !== sourceImageControl?.key
  )
  const primaryImageParameterControls = parameterControls
    .filter(isPrimaryImageGenerationControl)
    .sort((left, right) => primaryImageGenerationControlRank(left) - primaryImageGenerationControlRank(right))
  const imageResolutionControl = primaryImageParameterControls.find((control) => primaryImageGenerationControlRank(control) === 0) ?? null
  const imageAspectRatioControl = primaryImageParameterControls.find((control) => primaryImageGenerationControlRank(control) === 1) ?? null
  const imageCountControls = primaryImageParameterControls.filter((control) => primaryImageGenerationControlRank(control) === 2)
  const advancedImageParameterControls = parameterControls.filter((control) => !isPrimaryImageGenerationControl(control))
  const hasImageAdvancedInputs = !imageFormSpec || advancedImageParameterControls.length > 0
  const sourceImageMaxCount = sourceImageControl?.maxCount
  const supportsSourceImage = Boolean(selectedImageModel?.supportsImageInput) && (!imageFormSpec || Boolean(sourceImageControl))
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
  const submitSourceImageAssets = sourceImageMaxCount === undefined
    ? selectedSourceImageAssets
    : selectedSourceImageAssets.slice(0, sourceImageMaxCount)
  const status = data.isGeneratingImage ? "queued" : task?.status ?? readRawString(data.rawData, "status", "idle")
  const nodeState = deriveCinemaImageNodeState(data.rawData, status)
  const candidateAssets = readCinemaImageCandidateAssets(data.rawData)
  const selectedCandidate = readCinemaImageSelectedCandidate(data.rawData)
  const nodeError = data.imageImportError
    ?? data.imageGenerationError
    ?? data.imageFinalizeError
    ?? task?.error
    ?? readOptionalRawString(data.rawData, "error")
    ?? (selectedImageWorkflow?.status === "disabled" ? workflowIssueSummary(selectedImageWorkflow) : null)
    ?? (selectedImageWorkflow?.output?.kind && selectedImageWorkflow.output.kind !== "image"
      ? t("generation.workflowOutputChanged")
      : null)
    ?? (storedImageWorkflowID && comfyWorkflowCatalog?.status === "ready" && !selectedImageWorkflow
      ? t("generation.workflowSelectionInvalid")
      : null)
    ?? (selectedImageModel?.target?.kind === "workflow" && comfyWorkflowCatalog?.status !== "ready"
      ? comfyWorkflowCatalog?.issues[0]?.message ?? "ComfyUI workflows must be refreshed before generation."
      : null)
    ?? (selectedImageModelValue.startsWith("comfyui-local/") && !selectedImageModel
      ? t(storedImageWorkflowID ? "generation.workflowSelectionInvalid" : "generation.legacyWorkflowRemoved")
      : null)
    ?? data.workflowRefreshError
  const progress = effectiveGenerationProgress({
    task,
    rawData: data.rawData,
    status,
    message: nodeError,
    forceQueued: Boolean(data.isGeneratingImage),
  })
  const previewSrc = selectedCandidate && data.agentBaseURL && data.projectID
    ? projectAssetPreviewURL(data.agentBaseURL, data.projectID, selectedCandidate.path)
    : ""
  const previewAspectRatio = selectedCandidate ? imagePreviewAspectRatio(selectedCandidate, sizeDraft) : null
  const previewStyle = previewAspectRatio
    ? { "--cinema-image-preview-aspect-ratio": previewAspectRatio } as CSSProperties
    : undefined
  const effectivePromptDraft = imagePromptWithSourceText(promptDraft, sourceTextParameters)
  const promptReady = imageFormSpec
    ? !promptControl?.required || effectivePromptDraft.trim().length > 0
    : effectivePromptDraft.trim().length > 0
  const isImageTaskActive = status === "queued" || status === "running"
  const isImageFillBusy = Boolean(data.isGeneratingImage)
    || Boolean(data.isImportingImage)
    || Boolean(data.isFinalizingImageCandidate)
    || isImageTaskActive
  const formParametersReady = parameterControls.every((control) => generationControlReady(control, imageFormParameters))
  const sourceImagesReady = !sourceImageControl?.required || submitSourceImageAssets.length >= (sourceImageControl.minCount ?? 1)
  acceptsSourceImageImportResultRef.current = nodeState === "empty" && !isImageFillBusy

  rawDataRef.current = data.rawData
  onChangeRawDataRef.current = data.onChangeRawData
  onNodeInputEditingChangeRef.current = data.onNodeInputEditingChange
  imageFormParametersRef.current = imageFormParameters

  useEffect(() => () => {
    onNodeInputEditingChangeRef.current?.(id, false)
  }, [id])

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

  const setPromptInputEditing = useCallback((isEditing: boolean) => {
    onNodeInputEditingChangeRef.current?.(id, isEditing)
  }, [id])

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

  const commitFormParameterPatch = useCallback((patch: Record<string, unknown>) => {
    const nextParameters = {
      ...imageFormParametersRef.current,
      ...patch,
    }
    for (const [key, value] of Object.entries(nextParameters)) {
      if (value === undefined) delete nextParameters[key]
    }
    imageFormParametersRef.current = nextParameters
    commitRawDataPatch({ parameters: nextParameters })
  }, [commitRawDataPatch])

  useEffect(() => {
    if (selectedImageModel?.target?.kind !== "workflow" || !imageFormSpec) return
    const currentParameters = readRawRecord(rawDataRef.current, "parameters")
    const nextParameters = reconcileGenerationParameters(currentParameters, imageFormSpec)
    const revisionChanged = readRawString(rawDataRef.current, "workflowRevision") !== selectedImageModel.target.revision
    if (!revisionChanged && JSON.stringify(currentParameters) === JSON.stringify(nextParameters)) return
    imageFormParametersRef.current = nextParameters
    commitRawDataPatch({
      workflowID: selectedImageModel.target.workflowID,
      workflowRevision: selectedImageModel.target.revision,
      parameters: nextParameters,
      ...(revisionChanged ? { error: null, errorCode: null } : {}),
    })
  }, [commitRawDataPatch, imageFormSpec, selectedImageModel?.target])

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
      if (!acceptsSourceImageImportResultRef.current) return
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

  const isImageBusy = isImageFillBusy || importImageSourceImageMutation.isPending
  const canGenerate = nodeState === "empty"
    && promptReady
    && formParametersReady
    && sourceImagesReady
    && selectedImageModel?.available === true
    && !isImageBusy

  const schedulePromptCommit = useCallback((value: string) => {
    clearPromptCommitTimer()
    promptCommitTimerRef.current = window.setTimeout(() => {
      promptCommitTimerRef.current = null
      commitRawDataPatch({ prompt: value })
    }, 320)
  }, [clearPromptCommitTimer, commitRawDataPatch])

  useEffect(() => {
    if (isPromptFocusedRef.current || isPromptComposingRef.current || promptCommitTimerRef.current !== null) return
    if (promptDraftRef.current === prompt) return
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

  useEffect(() => {
    if (active) return
    const wasEditing = isPromptFocusedRef.current
      || isPromptComposingRef.current
      || promptCommitTimerRef.current !== null
    const value = promptDraftRef.current
    isPromptFocusedRef.current = false
    isPromptComposingRef.current = false
    clearPromptCommitTimer()
    if (wasEditing) commitRawDataPatch({ prompt: value })
    setPromptInputEditing(false)
  }, [active, clearPromptCommitTimer, commitRawDataPatch, setPromptInputEditing])

  const openSourceImagePicker = () => {
    if (isImageBusy) return
    setSourceImageImportError(null)
    sourceImageInputRef.current?.click()
  }

  const handleSourceImageFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (files.length === 0 || isImageBusy) return
    importImageSourceImageMutation.mutate(files)
  }

  const openMainImagePicker = () => {
    if (nodeState !== "empty" || isImageBusy) return
    setSourceImageImportError(null)
    mainImageInputRef.current?.click()
  }

  const handleMainImageFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ""
    if (!file || nodeState !== "empty" || isImageBusy) return
    data.onImportImage?.(id, file)
  }

  const chooseCandidate = (assetID: string) => {
    if (nodeState !== "choosing" || data.isFinalizingImageCandidate) return
    commitRawDataPatch({ selectedCandidateAssetID: assetID })
  }

  const acceptCandidate = () => {
    if (nodeState !== "choosing" || !selectedCandidate || data.isFinalizingImageCandidate) return
    clearPromptCommitTimer()
    data.onFinalizeImageCandidate?.(id, selectedCandidate.id)
  }

  const dismissNodeOverlay = () => {
    const wasEditing = isPromptFocusedRef.current
      || isPromptComposingRef.current
      || promptCommitTimerRef.current !== null
    isPromptFocusedRef.current = false
    isPromptComposingRef.current = false
    clearPromptCommitTimer()
    if (wasEditing) commitRawDataPatch({ prompt: promptDraftRef.current })
    setPromptInputEditing(false)
    data.onDismissNodeOverlay?.()
    window.requestAnimationFrame(() => nodeRef.current?.focus())
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
    if (!promptReady) {
      promptRef.current?.focus()
      return
    }
    if (!selectedImageModel || !selectedImageModel.available || isImageBusy) return
    setSourceImageImportError(null)
    clearPromptCommitTimer()
    const nextSize = sizeDraftRef.current.trim() || DEFAULT_IMAGE_GENERATION_SIZE
    const nextCount = normalizeCountDraft()
    const nextParameters: Record<string, unknown> = imageFormSpec
      ? { ...imageFormParametersRef.current }
      : {
        size: nextSize,
        count: nextCount,
        ...(styleDraftRef.current.trim() ? { style: styleDraftRef.current.trim() } : {}),
      }
    if (promptControl) nextParameters[promptControl.key] = nextEffectivePrompt
    if (sourceImageControl) {
      if (submitSourceImageAssets.length > 0) {
        const mediaValues = submitSourceImageAssets.map((asset) => ({
          image: asset.path,
          path: asset.path,
          assetID: asset.id,
        }))
        nextParameters[sourceImageControl.key] = sourceImageControl.type === "media" && !sourceImageControl.multiple
          ? mediaValues[0]
          : mediaValues
      } else {
        delete nextParameters[sourceImageControl.key]
      }
    }
    commitRawDataPatch({
      prompt: nextPrompt,
      model: selectedImageModel.value,
      size: nextSize,
      count: nextCount,
      style: styleDraftRef.current,
      parameters: nextParameters,
      sourceNodeIDs: uniqueSourceNodeIDs(
        sourceTextParameters.map((parameter) => parameter.nodeID),
        supportsSourceImage ? submitSourceImageAssets.filter((asset) => asset.nodeID !== id).map((asset) => asset.nodeID) : [],
      ),
      sourceTextPrompts: nextSourceTextPrompts,
      ...(supportsSourceImage ? sourceImageSelectionPatch(submitSourceImageAssets) : {}),
    })
    data.onGenerateImage?.(id, {
      prompt: nextEffectivePrompt,
      userPrompt: nextPrompt,
      model: selectedImageModel.value,
      target: selectedImageModel.target,
      parameters: nextParameters,
      ...(!imageFormSpec
        ? {
          size: nextSize,
          count: nextCount,
          style: styleDraftRef.current.trim() || undefined,
        }
        : {}),
      sourceNodeIDs: uniqueSourceNodeIDs(
        sourceTextParameters.map((parameter) => parameter.nodeID),
        supportsSourceImage ? submitSourceImageAssets.filter((asset) => asset.nodeID !== id).map((asset) => asset.nodeID) : [],
      ),
      sourceTextPrompts: nextSourceTextPrompts.length > 0 ? nextSourceTextPrompts : undefined,
      ...(supportsSourceImage && submitSourceImageAssets.length > 0
        ? {
          sourceImageAssetID: submitSourceImageAssets[0]?.id,
          sourceImageAssetIDs: submitSourceImageAssets.map((asset) => asset.id),
          sourceImagePath: submitSourceImageAssets[0]?.path,
          sourceImagePaths: submitSourceImageAssets.map((asset) => asset.path),
        }
        : {}),
    })
  }

  const renderImageParameterControl = (control: GenerationControl) => {
    if (control.type === "prompt" || control.type === "image-list") return null
    return (
      <GenerationParameterControlField
        key={`${selectedImageModel?.value ?? "none"}-${selectedImageWorkflowTarget?.revision ?? "model"}-${control.key}`}
        control={control}
        parameters={imageFormParameters}
        disabled={isImageBusy}
        agentBaseURL={data.agentBaseURL}
        projectID={data.projectID}
        onChange={commitFormParameterPatch}
      />
    )
  }
  const imageControlSummary = (control: GenerationControl | null) => {
    if (!control) return ""
    const value = imageFormParameters[control.key]
    if (control.type === "select") {
      const index = generationSelectOptionIndex(control, value)
      if (index < 0) return ""
      const option = control.options[index]
      return translateGenerationOptionLabel(
        locale,
        option,
        generationControlValueLabel(control, option),
      )
    }
    if (control.type === "number" && typeof value === "number" && Number.isFinite(value)) return String(value)
    if (control.type === "boolean" && typeof value === "boolean") return t(value ? "common.on" : "common.off")
    return typeof value === "string" || typeof value === "number" ? String(value) : ""
  }
  const imageCanvasSpecSummary = imageFormSpec
    ? [imageControlSummary(imageAspectRatioControl), imageControlSummary(imageResolutionControl)].filter(Boolean).join(" · ")
    : sizeDraft
  const hasImageCanvasSpec = !imageFormSpec || Boolean(imageAspectRatioControl || imageResolutionControl)
  const renderImageCanvasSpecControl = (control: GenerationControl) => {
    const controlLabel = translateGenerationParameterLabel(locale, control.key, control.label)
    if (control.type === "select") {
      const selectedIndex = generationSelectOptionIndex(control, imageFormParameters[control.key])
      return (
        <GenerationSpecOptionGroup
          key={`${selectedImageModel?.value ?? "none"}-${control.key}`}
          label={controlLabel}
          value={selectedIndex >= 0 ? String(selectedIndex) : ""}
          disabled={isImageBusy}
          options={control.options.map((option, index) => ({
            value: String(index),
            label: translateGenerationOptionLabel(
              locale,
              option,
              generationControlValueLabel(control, option),
            ),
          }))}
          onChange={(nextValue) => {
            const option = control.options[Number(nextValue)]
            commitFormParameterPatch({ [control.key]: option })
          }}
        />
      )
    }
    return (
      <section
        key={`${selectedImageModel?.value ?? "none"}-${selectedImageWorkflowTarget?.revision ?? "model"}-${control.key}`}
        className="cinema-generation-spec-section"
      >
        <GenerationParameterControlField
          control={control}
          parameters={imageFormParameters}
          disabled={isImageBusy}
          agentBaseURL={data.agentBaseURL}
          projectID={data.projectID}
          onChange={commitFormParameterPatch}
        />
      </section>
    )
  }
  const renderImageCountControl = (control: GenerationControl) => {
    const controlLabel = translateGenerationParameterLabel(locale, control.key, control.label)
    if (control.type === "select") {
      const selectedIndex = generationSelectOptionIndex(control, imageFormParameters[control.key])
      return (
        <CinemaComposerSelect
          key={`${selectedImageModel?.value ?? "none"}-${control.key}`}
          id={`${id}-image-${control.key}`}
          ariaLabel={controlLabel}
          className="cinema-image-count-select"
          menuMinWidth={52}
          value={selectedIndex >= 0 ? String(selectedIndex) : ""}
          disabled={isImageBusy}
          options={control.options.map((option, index) => {
            const label = translateGenerationOptionLabel(
              locale,
              option,
              generationControlValueLabel(control, option),
            )
            return { value: String(index), label, triggerLabel: `×${label}` }
          })}
          onChange={(nextValue) => {
            const option = control.options[Number(nextValue)]
            commitFormParameterPatch({ [control.key]: option })
          }}
        />
      )
    }
    if (control.type === "number") {
      const minimum = Number.isFinite(control.min) ? Math.ceil(control.min!) : 1
      const maximum = Number.isFinite(control.max) ? Math.floor(control.max!) : minimum - 1
      if (maximum >= minimum && maximum - minimum <= 8) {
        const value = imageFormParameters[control.key]
        return (
          <CinemaComposerSelect
            key={`${selectedImageModel?.value ?? "none"}-${control.key}`}
            id={`${id}-image-${control.key}`}
            ariaLabel={controlLabel}
            className="cinema-image-count-select"
            menuMinWidth={52}
            value={typeof value === "number" && Number.isFinite(value) ? String(value) : ""}
            disabled={isImageBusy}
            options={Array.from({ length: maximum - minimum + 1 }, (_, index) => {
              const option = String(minimum + index)
              return { value: option, label: option, triggerLabel: `×${option}` }
            })}
            onChange={(nextValue) => commitFormParameterPatch({ [control.key]: Number(nextValue) })}
          />
        )
      }
    }
    return renderImageParameterControl(control)
  }
  const imageStatus = data.isFinalizingImageCandidate
    ? "finalizing"
    : data.isImportingImage
      ? "uploading"
      : data.isGeneratingImage
        ? "submitting"
        : isImageTaskActive
          ? "generating"
          : nodeState === "choosing"
            ? "choosing"
            : status

  return (
    <>
      {nodeState === "empty" || data.hasIncomingImageEdge ? (
        <Handle
          id="input"
          type="target"
          position={Position.Left}
          className={`cinema-node-handle cinema-node-handle-input ${data.hasIncomingConnection ? "is-connected" : ""} ${nodeState === "empty" && !isImageBusy ? "" : "is-locked"}`}
          style={accentStyle}
          isConnectable={nodeState === "empty" && !isImageBusy}
        />
      ) : null}
      {active && nodeState === "empty" && !isImageBusy ? (
        <div className="cinema-image-upload-toolbar nodrag nowheel" role="toolbar" aria-label={t("image.source")}>
          <button
            type="button"
            className="cinema-image-upload-button"
            title={t("image.upload")}
            aria-label={t("image.upload")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              openMainImagePicker()
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.preventDefault()
              event.stopPropagation()
              dismissNodeOverlay()
            }}
          >
            <Upload size={15} aria-hidden="true" />
            <span>{t("common.upload")}</span>
          </button>
        </div>
      ) : null}
      <input
        ref={mainImageInputRef}
        className="cinema-file-input"
        type="file"
        accept={IMAGE_FILE_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleMainImageFileInputChange}
      />
      <article
        ref={nodeRef}
        className={`cinema-image-node is-creating ${selected ? "is-selected" : ""}`}
        style={accentStyle}
        tabIndex={0}
        onPointerDown={(event) => activateNodeOnPointerDown(event, id, data.onActivateNode)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            event.stopPropagation()
            data.onSelectNode?.(id)
            return
          }
          if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            dismissNodeOverlay()
          }
        }}
      >
        <header className="cinema-image-header">
          <CinemaNodeTitle
            icon={Image}
            label="Image"
            nodeID={id}
            title={data.title}
            onChangeTitle={data.onChangeTitle}
          />
          <div className="cinema-node-header-actions">
            <NodeStatusDot status={imageStatus} />
            <NodeDeleteButton nodeID={id} onDeleteNode={data.onDeleteNode} />
          </div>
        </header>

        <section className="cinema-image-frame" aria-label={t("image.preview")} style={previewStyle}>
          {previewSrc ? (
            <img src={previewSrc} alt={promptDraft || data.title} draggable={false} />
          ) : (
            <div className="cinema-image-empty">
              <Image size={28} aria-hidden="true" />
              <span>{t("image.empty")}</span>
            </div>
          )}
          {isImageFillBusy ? (
            <div className="cinema-generation-overlay" aria-live="polite">
              <Loader2 size={18} aria-hidden="true" className="is-spinning" />
              <span>{data.isFinalizingImageCandidate
                ? "Saving"
                : data.isImportingImage
                  ? "Uploading"
                  : data.isGeneratingImage
                    ? "Submitting"
                    : "Generating"}</span>
            </div>
          ) : null}
        </section>

        {isImageTaskActive || data.isGeneratingImage ? <GenerationProgress progress={progress} status={status} /> : null}

        {nodeState === "choosing" ? (
          <div className="cinema-image-candidate-panel nodrag nowheel">
            <div className="cinema-image-thumbnails" role="radiogroup" aria-label={t("image.choices")}>
            {candidateAssets.map((asset) => {
              const src = data.agentBaseURL && data.projectID
                ? projectAssetPreviewURL(data.agentBaseURL, data.projectID, asset.path)
                : ""
              return (
                <button
                  key={asset.id}
                  type="button"
                  role="radio"
                  aria-checked={asset.id === selectedCandidate?.id}
                  className={`cinema-image-thumb ${asset.id === selectedCandidate?.id ? "is-selected" : ""}`}
                  title={asset.path}
                  disabled={data.isFinalizingImageCandidate}
                  onClick={() => chooseCandidate(asset.id)}
                >
                  {src ? <img src={src} alt="" draggable={false} /> : <Image size={14} aria-hidden="true" />}
                </button>
              )
            })}
            </div>
            <button
              type="button"
              className="cinema-image-candidate-accept"
              disabled={!selectedCandidate || data.isFinalizingImageCandidate}
              onClick={acceptCandidate}
            >
              {data.isFinalizingImageCandidate ? "Saving..." : "使用此图片"}
            </button>
            {nodeError ? (
              <p className="cinema-image-error" role="alert" title={nodeError}>{nodeError}</p>
            ) : null}
          </div>
        ) : null}

      </article>

      {active && nodeState === "empty" && !isImageFillBusy ? (
        <CinemaNodeInputOverlay
          nodeID={id}
          selected={active}
          overlayRoot={data.nodeInputOverlayRoot}
          width={520}
          accentStyle={accentStyle}
        >
          <section
            className="cinema-node-input-panel cinema-generation-composer cinema-image-composer nodrag nowheel"
            aria-label={t("image.controls")}
            onKeyDownCapture={(event) => {
              if (event.key !== "Escape") return
              const target = event.target
              if (
                target instanceof globalThis.Element
                && target.closest(".cinema-composer-select-menu, .cinema-generation-spec-panel")
              ) return
              if (event.nativeEvent.isComposing || isPromptComposingRef.current) return
              event.preventDefault()
              event.stopPropagation()
              dismissNodeOverlay()
            }}
          >
          {sourceTextParameters.length > 0 ? (
            <div className="cinema-image-param-tags" aria-label={t("generation.connectedText")}>
              {sourceTextParameters.map((parameter) => (
                <span
                  key={parameter.edgeID}
                  className={`cinema-image-param-tag ${parameter.text.trim() ? "" : "is-empty"}`}
                  title={parameter.text.trim() ? `${parameter.nodeTitle}: ${parameter.text.trim()}` : `${parameter.nodeTitle}: ${t("generation.emptyText")}`}
                >
                  <FileText size={12} aria-hidden="true" />
                  <span>{parameter.nodeTitle}</span>
                  <button
                    type="button"
                    title={t("generation.removeText", { name: parameter.nodeTitle })}
                    aria-label={t("generation.removeText", { name: parameter.nodeTitle })}
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
          {supportsSourceImage ? (
            <section className={`cinema-text-source-image ${selectedSourceImageAssets.length > 0 ? "is-ready" : "is-empty"}`} aria-label={t("image.sourceImage")}>
              {sourceImageAssets.length > 0 ? (
                <>
                  <div className="cinema-text-source-image-main">
                    <Image size={13} aria-hidden="true" />
                    <span>{selectedSourceImageAssets.length > 0 ? t("text.referenceImages", { count: selectedSourceImageAssets.length }) : t("text.chooseReferenceImages")}</span>
                  </div>
                  <div className="cinema-text-source-image-list" aria-label={t("text.availableReferenceImages")}>
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
                            aria-label={t("text.selectReferenceImage", { name: asset.nodeTitle })}
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
                            title={t("text.removeReferenceImage", { name: asset.nodeTitle })}
                            aria-label={t("text.removeReferenceImage", { name: asset.nodeTitle })}
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
                  <span>{t("text.referenceEmpty")}</span>
                </div>
              )}
              <div className="cinema-text-source-image-actions">
                <button
                  type="button"
                  className="cinema-text-source-image-add"
                  title={t("text.localReferenceImage")}
                  aria-label={t("text.localReferenceImage")}
                  disabled={isImageBusy || importImageSourceImageMutation.isPending}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    openSourceImagePicker()
                  }}
                >
                  <div className="cinema-video-input-slot-thumb" aria-hidden="true">
                    {importImageSourceImageMutation.isPending
                      ? <Loader2 size={14} className="is-spinning" />
                      : <Image size={14} />}
                  </div>
                  <span>{t("text.addReferenceImage")}</span>
                </button>
              </div>
              {sourceImageImportError ? (
                <p className="cinema-image-error" role="alert" title={sourceImageImportError}>
                  {sourceImageImportError}
                </p>
              ) : null}
              <input
                ref={sourceImageInputRef}
                className="cinema-file-input"
                type="file"
                accept={IMAGE_FILE_ACCEPT}
                multiple
                onChange={handleSourceImageFileInputChange}
              />
            </section>
          ) : null}
          {!imageFormSpec || promptControl ? <textarea
            ref={promptRef}
            aria-label={promptControl?.label ?? t("image.prompt")}
            value={promptDraft}
            placeholder={promptControl?.placeholder ?? promptControl?.description ?? t("image.promptPlaceholder")}
            maxLength={promptControl?.maxLength}
            spellCheck={false}
            onFocus={() => {
              isPromptFocusedRef.current = true
              setPromptInputEditing(true)
            }}
            onKeyDownCapture={stopCanvasKeyboardEvent}
            onKeyDown={stopCanvasKeyboardEvent}
            onChange={(event) => {
              const value = event.target.value
              setPromptInputEditing(true)
              setPromptDraft(value)
              if (isPromptComposingRef.current) return
              schedulePromptCommit(value)
            }}
            onCompositionStart={() => {
              isPromptComposingRef.current = true
              setPromptInputEditing(true)
              clearPromptCommitTimer()
            }}
            onCompositionEnd={(event) => {
              isPromptComposingRef.current = false
              const value = event.currentTarget.value
              setPromptDraft(value)
              commitRawDataPatch({ prompt: value })
              if (!isPromptFocusedRef.current) setPromptInputEditing(false)
            }}
            onBlur={() => {
              isPromptFocusedRef.current = false
              const value = promptRef.current?.value ?? promptDraftRef.current
              const wasComposing = isPromptComposingRef.current
              promptDraftRef.current = value
              if (wasComposing) {
                isPromptComposingRef.current = false
                setPromptDraft(value)
              }
              clearPromptCommitTimer()
              commitRawDataPatch({ prompt: value })
              setPromptInputEditing(false)
            }}
          /> : null}
          {hasImageAdvancedInputs && isImageAdvancedOpen ? (
            <section id={`${id}-image-advanced`} className="cinema-image-advanced-panel" aria-label={t("image.advancedInputs")}>
              {!imageFormSpec ? (
                <input
                  className="cinema-image-style"
                  value={styleDraft}
                  placeholder={t("image.stylePlaceholder")}
                  spellCheck={false}
                  disabled={isImageBusy}
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => setStyleDraft(event.target.value)}
                  onBlur={() => commitRawDataPatch({ style: styleDraftRef.current })}
                />
              ) : null}
              {imageFormSpec && advancedImageParameterControls.length > 0 ? (
                <section className="cinema-image-form-controls" aria-label={t("image.parameters")}>
                  {advancedImageParameterControls.map(renderImageParameterControl)}
                </section>
              ) : null}
            </section>
          ) : null}
          {nodeError ? (
            <p className="cinema-image-error" role="alert" title={nodeError}>
              {nodeError}
            </p>
          ) : null}
          <footer className="cinema-generation-footer cinema-image-composer-footer">
            <div className="cinema-generation-target-picker">
              <CinemaComposerSelect
                id={`${id}-image-model`}
                ariaLabel={t("generation.target")}
                className="cinema-generation-model-select"
                menuMinWidth={236}
                value={selectedImageModel?.value ?? selectedImageModelValue}
                disabled={(imageModels.length === 0 && disabledImageWorkflowChoices.length === 0) || isImageBusy}
                placeholder={t("generation.noWorkflowOrModel")}
                options={[
                  ...imageModels.map((model) => ({
                    value: model.value,
                    label: `${model.providerLabel} · ${model.label}${model.available ? "" : ` · ${t("generation.unavailable")}`}`,
                    triggerLabel: model.label,
                    disabled: !model.available,
                  })),
                  ...disabledImageWorkflowChoices,
                ]}
                onChange={(nextValue) => {
                  if (nextValue === selectedImageModel?.value) return
                  const nextModel = imageModels.find((model) => model.value === nextValue) ?? null
                  commitRawDataPatch({
                    model: nextValue || undefined,
                    workflowID: nextModel?.target?.kind === "workflow" ? nextModel.target.workflowID : undefined,
                    workflowRevision: nextModel?.target?.kind === "workflow" ? nextModel.target.revision : undefined,
                    parameters: generationFormDefaultParameters(nextModel?.formSpec ?? null),
                    error: null,
                    errorCode: null,
                  })
                }}
              />
              {comfyWorkflowCatalog ? (
                <button
                  type="button"
                  className="cinema-generation-workflow-refresh"
                  title={t("generation.refreshWorkflows")}
                  aria-label={t("generation.refreshWorkflows")}
                  disabled={isImageBusy || data.isRefreshingWorkflows}
                  onClick={() => data.onRefreshProviderWorkflows?.("comfyui-local")}
                >
                  <RefreshCw size={14} aria-hidden="true" className={data.isRefreshingWorkflows ? "is-spinning" : ""} />
                </button>
              ) : null}
            </div>
            <div className={`cinema-image-quick-controls cinema-image-parameter-rail ${imageFormSpec ? "is-form-spec" : ""}`}>
              {hasImageCanvasSpec ? (
                <GenerationSpecPopover
                  id={`${id}-image-canvas-spec`}
                  ariaLabel={t("image.canvasSpec")}
                  summary={imageCanvasSpecSummary || t("generation.option.auto")}
                  disabled={isImageBusy}
                  onKeepActive={() => data.onSelectNode?.(id)}
                >
                  {imageFormSpec ? (
                    <>
                      {imageAspectRatioControl ? renderImageCanvasSpecControl(imageAspectRatioControl) : null}
                      {imageResolutionControl ? renderImageCanvasSpecControl(imageResolutionControl) : null}
                    </>
                  ) : (
                    <section className="cinema-generation-spec-section">
                      <h3>{t("image.size")}</h3>
                      <input
                        className="cinema-generation-spec-input"
                        aria-label={t("image.size")}
                        value={sizeDraft}
                        disabled={isImageBusy}
                        inputMode="numeric"
                        onKeyDown={(event) => event.stopPropagation()}
                        onChange={(event) => setSizeDraft(event.target.value)}
                        onBlur={() => commitRawDataPatch({ size: sizeDraftRef.current.trim() || DEFAULT_IMAGE_GENERATION_SIZE })}
                      />
                    </section>
                  )}
                </GenerationSpecPopover>
              ) : null}
              {imageFormSpec ? imageCountControls.map(renderImageCountControl) : (
                <CinemaComposerSelect
                  id={`${id}-image-count`}
                  ariaLabel={t("image.count")}
                  className="cinema-image-count-select"
                  menuMinWidth={52}
                  value={String(normalizeCountDraft())}
                  disabled={isImageBusy}
                  options={[1, 2, 3, 4].map((value) => ({
                    value: String(value),
                    label: String(value),
                    triggerLabel: `×${value}`,
                  }))}
                  onChange={(nextValue) => {
                    const normalized = Number(nextValue)
                    setCountDraft(String(normalized))
                    commitRawDataPatch({ count: normalized })
                  }}
                />
              )}
              {hasImageAdvancedInputs ? (
                <button
                  type="button"
                  className={`cinema-image-advanced-toggle ${isImageAdvancedOpen ? "is-open" : ""}`}
                  aria-label={t("common.advanced")}
                  aria-expanded={isImageAdvancedOpen}
                  aria-controls={`${id}-image-advanced`}
                  onClick={() => setIsImageAdvancedOpen((value) => !value)}
                >
                  <span>{t("common.advanced")}</span>
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="cinema-image-submit"
              title={selectedImageModel ? t("image.generateWithProvider") : t("image.noGenerationModel")}
              aria-label={t("image.generate")}
              disabled={!canGenerate}
              onClick={generateImage}
            >
              {isImageBusy
                ? <Loader2 size={18} aria-hidden="true" className="is-spinning" />
                : <ArrowUp size={18} aria-hidden="true" />}
            </button>
          </footer>
          </section>
        </CinemaNodeInputOverlay>
      ) : null}
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className={`cinema-node-handle cinema-node-handle-output ${data.hasOutgoingConnection ? "is-connected" : ""}`}
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
  const { locale, t } = useI18n()
  const active = data.isActiveNode ?? Boolean(selected)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const videoInputImageInputRef = useRef<HTMLInputElement>(null)
  const pendingVideoInputImageSlotRef = useRef<VideoMediaInputSlot | null>(null)
  const rawDataRef = useRef(data.rawData)
  const onChangeRawDataRef = useRef(data.onChangeRawData)
  const onNodeInputEditingChangeRef = useRef(data.onNodeInputEditingChange)
  const promptCommitTimerRef = useRef<number | null>(null)
  const isPromptComposingRef = useRef(false)
  const isPromptFocusedRef = useRef(false)
  const providers = data.videoProviders ?? []
  const tasks = data.generationTasks ?? []
  const taskID = readRawString(data.rawData, "taskID")
  const task = tasks.find((item) => item.id === taskID) ?? null
  const taskUserPrompt = generationTaskUserPrompt(task)
  const initialMode = readVideoMode(data.rawData)
  const [mode, setModeState] = useState<CinemaGenerationMode>(initialMode)
  const [providerID, setProviderIDState] = useState(() => readRawString(data.rawData, "providerID"))
  const [modelID, setModelIDState] = useState(() => readRawString(data.rawData, "modelID"))
  const storedVideoWorkflowID = readRawString(data.rawData, "workflowID")
  const [promptDraft, setPromptDraftState] = useState(() => {
    const rawPrompt = readOptionalRawString(data.rawData, "text")
    return rawPrompt ?? taskUserPrompt ?? task?.input.prompt ?? ""
  })
  const [aspectRatioDraft, setAspectRatioDraftState] = useState(() => readRawString(data.rawData, "aspectRatio", DEFAULT_VIDEO_ASPECT_RATIO))
  const [durationDraft, setDurationDraftState] = useState(() => String(readRawNumber(data.rawData, "duration", DEFAULT_VIDEO_DURATION_SECONDS)))
  const [resolutionDraft, setResolutionDraftState] = useState(() => readRawString(data.rawData, "resolution", DEFAULT_VIDEO_RESOLUTION))
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [isVideoPreviewPlaying, setIsVideoPreviewPlaying] = useState(false)
  const [videoInputImageImportError, setVideoInputImageImportError] = useState<string | null>(null)
  const [importingVideoInputImageSlot, setImportingVideoInputImageSlot] = useState<VideoMediaInputSlot | null>(null)
  const promptDraftRef = useRef(promptDraft)
  const modeRef = useRef(mode)
  const providerIDRef = useRef(providerID)
  const modelIDRef = useRef(modelID)
  const aspectRatioDraftRef = useRef(aspectRatioDraft)
  const durationDraftRef = useRef(durationDraft)
  const resolutionDraftRef = useRef(resolutionDraft)
  const videoFormParametersRef = useRef<Record<string, unknown>>({})

  rawDataRef.current = data.rawData
  onChangeRawDataRef.current = data.onChangeRawData
  onNodeInputEditingChangeRef.current = data.onNodeInputEditingChange

  const selectedProvider = providerForSelection(providers, providerID)
  const selectedModel = modelForSelection(selectedProvider, modelID)
  const selectedModelSelectionID = selectedModel ? providerModelSelectionID(selectedModel) : ""
  const selectedWorkflowForm = selectedModel?.formSpecs.find((formSpec) =>
    formSpec.target.kind === "workflow" && formSpec.output === "video"
  ) ?? null
  const selectedWorkflowTarget = selectedWorkflowForm?.target.kind === "workflow"
    ? selectedWorkflowForm.target
    : null
  const taskMatchesSelectedWorkflow = !selectedWorkflowTarget || (
    task?.target.kind === "workflow"
    && task.target.workflowID === selectedWorkflowTarget.workflowID
    && task.target.revision === selectedWorkflowTarget.revision
  )
  const activeTask = taskMatchesSelectedWorkflow ? task : null
  const selectedWorkflowCatalog = data.workflowCatalogs?.find((catalog) =>
    catalog.providerID === (selectedProvider?.manifest.id ?? providerID)
  ) ?? null
  const selectedCatalogWorkflow = selectedWorkflowCatalog?.workflows.find((workflow) =>
    workflow.workflowID === (selectedWorkflowTarget?.workflowID ?? modelID)
  ) ?? null
  const selectedInputCombination = inputCombinationForSelection(selectedProvider, selectedModel, mode)
  const selectedEndpoint: CinemaProviderEndpoint | undefined = selectedInputCombination?.endpoint
  const aspectRatioOptions = modelAspectRatioOptions(selectedModel, selectedInputCombination)
  const durationOptions = modelDurationOptions(selectedModel, selectedInputCombination)
  const resolutionOptions = modelResolutionOptions(selectedModel, selectedInputCombination)
  const resolutionOptionLabels = stringParameterOptionLabelsForCombination(
    selectedInputCombination,
    ["quality_mode", "qualityMode", "mode", "resolution"],
  )
  const aspectRatioSelectOptions = [...new Set([...aspectRatioOptions, aspectRatioDraft, DEFAULT_VIDEO_ASPECT_RATIO].filter(Boolean))]
  const durationSelectOptions = [...new Set([...durationOptions, Number.parseFloat(durationDraft) || DEFAULT_VIDEO_DURATION_SECONDS])]
    .filter((value) => Number.isFinite(value) && value > 0)
  const resolutionSelectOptions = [...new Set([...resolutionOptions, resolutionDraft, DEFAULT_VIDEO_RESOLUTION].filter(Boolean))]
  const videoAspectRatioSpecOptions = aspectRatioSelectOptions.map((item) => ({
    value: item,
    label: translateGenerationOptionLabel(locale, item, item),
  }))
  const videoResolutionSpecOptions = resolutionSelectOptions.map((item) => ({
    value: item,
    label: resolutionOptionLabels[item] ?? item,
  }))
  const videoSpecSummary = [
    videoAspectRatioSpecOptions.find((option) => option.value === aspectRatioDraft)?.label ?? aspectRatioDraft,
    videoResolutionSpecOptions.find((option) => option.value === resolutionDraft)?.label ?? resolutionDraft,
  ].filter(Boolean).join(" · ")
  const availableProviders = availableVideoProviders(providers)
  const videoModelChoices = availableProviders.flatMap((provider) =>
    availableModelsForProvider(provider).map((model) => ({
      provider,
      model,
      value: JSON.stringify([provider.manifest.id, providerModelSelectionID(model)]),
      label: `${provider.manifest.name} · ${model.label}`,
    })))
  const readyVideoModelChoiceValues = new Set(videoModelChoices.map((choice) => choice.value))
  const disabledWorkflowChoices = (data.workflowCatalogs ?? []).flatMap((catalog) => {
    const provider = providers.find((item) => item.manifest.id === catalog.providerID)
    if (!provider) return []
    return catalog.workflows.flatMap((workflow) => {
      if (workflow.output?.kind && workflow.output.kind !== "video") return []
      const value = JSON.stringify([provider.manifest.id, workflow.workflowID])
      if (readyVideoModelChoiceValues.has(value)) return []
      const reason = catalog.status !== "ready"
        ? catalog.issues[0]?.message ?? t("generation.workflowCatalogStale")
        : workflowIssueSummary(workflow)
      return [{
        value,
        label: `${provider.manifest.name} · ${workflow.name} · ${reason}`,
        triggerLabel: workflow.name,
        disabled: true,
      }]
    })
  })
  const selectedVideoModelChoiceValue = selectedProvider && selectedModel
    ? JSON.stringify([selectedProvider.manifest.id, providerModelSelectionID(selectedModel)])
    : providerID && modelID
      ? JSON.stringify([providerID, modelID])
      : ""
  const availableInputCombinations = inputCombinationsForModel(selectedProvider, selectedModel)
  const visibleModeContracts = availableInputCombinations.map(videoModeInputContractForCombination)
  const modeContract = videoModeInputContractForCombination(selectedInputCombination)
  const workflowPrimaryTextControl = selectedWorkflowForm?.controls.find((control) =>
    control.type === "prompt" || control.type === "text"
  ) ?? null
  const workflowSlottedControlKeys = new Set(modeContract.inputs.flatMap((input) =>
    input.slot && input.slot !== "textParameter" ? [input.parameterKey] : []
  ))
  const formParameterControls = selectedWorkflowForm
    ? selectedWorkflowForm.controls.filter((control) =>
      control.key !== workflowPrimaryTextControl?.key
      && !(
        (control.type === "media" || control.type === "image-list")
        && workflowSlottedControlKeys.has(control.key)
      )
    )
    : modeContract.parameterControls
  const videoFormParameters = {
    ...generationControlDefaultParameters(selectedWorkflowForm?.controls ?? modeContract.parameterControls),
    ...readRawRecord(data.rawData, "parameters"),
  }
  const visibleVideoParameterControls = formParameterControls.filter((control) =>
    generationControlVisible(control, videoFormParameters)
  )
  const hasVideoAdvancedInputs = visibleVideoParameterControls.length > 0
  videoFormParametersRef.current = videoFormParameters
  const outputAssets = task?.outputAssets ?? readDisplayAssets(data.rawData)
  const outputAsset = outputAssets.find((asset) => asset.kind === "video") ?? outputAssets[0] ?? null
  const previewSrc = outputAsset && data.agentBaseURL && data.projectID
    ? projectAssetPreviewURL(data.agentBaseURL, data.projectID, outputAsset.path)
    : ""
  const previewAspectRatio = videoPreviewAspectRatio(outputAsset, aspectRatioDraft)
  const previewStyle = {
    "--cinema-video-preview-aspect-ratio": previewAspectRatio.value,
  } as CSSProperties
  const previewClassName = `cinema-video-gen-preview ${previewSrc ? "has-video" : "is-empty"} is-${previewAspectRatio.shape}`
  const currentStatus = data.isCreatingVideoTask
    ? "queued"
    : activeTask?.status ?? (taskMatchesSelectedWorkflow
      ? readRawString(data.rawData, "status", "draft")
      : "draft")
  const isWaiting = currentStatus === "queued" || currentStatus === "running"
  const isBusy = data.isCreatingVideoTask || isWaiting
  const providerNeedsCredential = Boolean(selectedProvider?.auth.requiresCredential)
  const providerConnected = selectedProvider?.auth.connected !== false
  const providerAdapterUnavailable = Boolean(selectedProvider) && selectedProvider?.runtime?.adapterAvailable !== true
  const videoMediaInputs = modeContract.inputs.filter(isVideoMediaInputControl)
  const localizedVideoInputLabel = (input: VideoInputControl) => (
    translateVideoInputLabel(locale, input.slot, input.role, input.label)
  )
  const localizedVideoInputEmptyText = (input: VideoInputControl) => (
    translateVideoInputEmptyText(locale, input.slot, input.emptyText)
  )
  const inputAssets: VideoInputAssets = data.videoInputAssets ?? data.videoInputImageAssets ?? {}
  const videoLocalInputAssets = readVideoLocalInputAssets(data.rawData, id)
  const sourceImageAsset = videoInputAssetList(inputAssets.sourceImage)[0] ?? data.sourceImageAsset ?? null
  const inputAssetsForControl = (input: VideoInputControl & { slot: VideoMediaInputSlot }) => {
    const localAssets = canImportVideoInputLocalMedia(input.slot)
      ? videoInputAssetList(videoLocalInputAssets[input.slot])
      : []
    const keyedAssets = videoInputAssetList(data.videoInputAssetsByInputKey?.[input.inputKey])
    const roleAssets = videoInputAssetList(data.videoInputAssetsByRole?.[input.role])
    const slotAssets = input.slot === "sourceImage"
      ? (sourceImageAsset ? [sourceImageAsset] : [])
      : videoInputAssetList(inputAssets[input.slot])
    const assets = localAssets.length > 0 ? localAssets : keyedAssets.length > 0 ? keyedAssets : roleAssets.length > 0 ? roleAssets : slotAssets
    const maxCount = input.maxCount ?? (input.slot === "referenceImage" ? assets.length : 1)
    return assets.slice(0, Math.max(0, maxCount))
  }
  const activeInputAssets = videoMediaInputs.flatMap((input) =>
    inputAssetsForControl(input).map((asset) => ({ input, asset }))
  )
  const missingRequiredInput = videoMediaInputs.find((input) =>
    input.required && inputAssetsForControl(input).length < Math.max(input.minCount, 1)
  )
  const missingRequiredInputLabel = missingRequiredInput ? localizedVideoInputLabel(missingRequiredInput) : ""
  const sourceTextParameters = data.sourceTextParameters ?? []
  const effectivePromptDraft = imagePromptWithSourceText(promptDraft, sourceTextParameters)
  const promptRequired = selectedWorkflowForm
    ? workflowPrimaryTextControl?.required === true
    : modeContract.inputs.some((input) => input.slot === "textParameter" && input.required)
  const missingRequiredParameterControl = visibleVideoParameterControls.find((control) =>
    !generationControlReady(control, videoFormParameters)
  ) ?? null
  const videoFormParametersReady = missingRequiredParameterControl === null
  const unsupportedRequiredInput = modeContract.unsupportedRequiredInputs[0] ?? null
  const unsupportedRequiredInputLabel = unsupportedRequiredInput ? localizedVideoInputLabel(unsupportedRequiredInput) : ""
  const missingRequiredParameterLabel = missingRequiredParameterControl
    ? translateGenerationParameterLabel(locale, missingRequiredParameterControl.key, missingRequiredParameterControl.label)
    : ""
  const requiredInputMissing = Boolean(missingRequiredInput)
  const hasSourceImageInput = videoMediaInputs.some((input) => input.slot === "sourceImage")
  const missingRequiredInputSlotLabel = missingRequiredInputLabel
  const nodeError = data.videoGenerationError
    ?? localizedGenerationTaskError(activeTask, t)
    ?? (taskMatchesSelectedWorkflow ? readOptionalRawString(data.rawData, "error") : null)
    ?? (selectedCatalogWorkflow?.status === "disabled" ? workflowIssueSummary(selectedCatalogWorkflow) : null)
    ?? (selectedCatalogWorkflow?.output?.kind && selectedCatalogWorkflow.output.kind !== "video"
      ? t("generation.workflowOutputChanged")
      : null)
    ?? (providerID === "comfyui-local" && storedVideoWorkflowID && selectedWorkflowCatalog?.status === "ready" && !selectedCatalogWorkflow
      ? t("generation.workflowSelectionInvalid")
      : null)
    ?? (selectedWorkflowCatalog && selectedWorkflowCatalog.status !== "ready"
      ? selectedWorkflowCatalog.issues[0]?.message ?? t("generation.workflowCatalogStale")
      : null)
    ?? (data.isLoadingWorkflows ? t("generation.loadingWorkflows") : null)
    ?? (providerID === "comfyui-local" && modelID && !selectedModel
      ? t("generation.legacyWorkflowRemoved")
      : null)
    ?? data.workflowRefreshError
  const nodeErrorCode = taskMatchesSelectedWorkflow
    ? activeTask?.errorCode ?? readRawString(data.rawData, "errorCode")
    : undefined
  const comfyUIWaitingForService = (
    activeTask?.providerID === "comfyui-local"
    && activeTask.progress?.message?.startsWith("Waiting for Local ComfyUI")
  )
  const showComfyUISettingsAction = (
    (activeTask?.providerID === "comfyui-local" || selectedProvider?.manifest.id === "comfyui-local")
    && (
      Boolean(nodeErrorCode && COMFYUI_SETTINGS_ERROR_CODES.has(nodeErrorCode))
      || comfyUIWaitingForService
    )
  )
  const progress = effectiveGenerationProgress({
    task: activeTask,
    rawData: data.rawData,
    status: currentStatus,
    message: nodeError,
    forceQueued: Boolean(data.isCreatingVideoTask),
  })
  const shouldShowVideoProgress = Boolean(progress) && (isBusy || currentStatus === "failed" || currentStatus === "canceled")
  const providerLabel = selectedProvider?.manifest.name ?? t("video.provider")
  const providerConnectionReason = providerNeedsCredential && !providerConnected
    ? t("video.error.providerDisconnected", { provider: providerLabel })
    : null
  const providerAdapterReason = providerAdapterUnavailable
    ? t("video.error.adapterUnavailable", { provider: providerLabel })
    : null
  const unsupportedInputReason = unsupportedRequiredInput
    ? t("video.error.unsupportedInput", { input: unsupportedRequiredInputLabel })
    : null
  const requiredParameterReason = !videoFormParametersReady
    ? t("video.error.parameterRequired", { parameter: missingRequiredParameterLabel })
    : null
  const requiredInputReason = requiredInputMissing
    ? canImportVideoInputLocalMedia(missingRequiredInput?.slot ?? null)
      ? t("video.error.importOrConnectImage", { input: missingRequiredInputLabel })
      : t("video.error.connectInput", { input: missingRequiredInputLabel })
    : null
  const submitDisabledReason = !selectedProvider
    ? t("video.error.noProvider")
    : !selectedModel
      ? t("video.error.noModel")
      : !selectedInputCombination
        ? t("video.error.noInputCombination")
        : promptRequired && effectivePromptDraft.trim().length === 0
          ? t("video.error.promptRequired")
          : isBusy
            ? t("video.error.taskRunning")
            : providerConnectionReason
              ?? providerAdapterReason
              ?? unsupportedInputReason
              ?? requiredParameterReason
              ?? requiredInputReason
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

  const setPromptInputEditing = useCallback((isEditing: boolean) => {
    onNodeInputEditingChangeRef.current?.(id, isEditing)
  }, [id])

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

  const commitVideoFormParameterPatch = useCallback((patch: Record<string, unknown>) => {
    const nextParameters = {
      ...videoFormParametersRef.current,
      ...patch,
    }
    for (const [key, value] of Object.entries(nextParameters)) {
      if (value === undefined) delete nextParameters[key]
    }
    videoFormParametersRef.current = nextParameters
    commitRawDataPatch({ parameters: nextParameters })
  }, [commitRawDataPatch])

  useEffect(() => {
    if (!selectedWorkflowForm || !selectedWorkflowTarget) return
    const currentParameters = readRawRecord(rawDataRef.current, "parameters")
    const nextParameters = reconcileGenerationParameters(currentParameters, selectedWorkflowForm)
    const revisionChanged = readRawString(rawDataRef.current, "workflowRevision") !== selectedWorkflowTarget.revision
    if (!revisionChanged && JSON.stringify(currentParameters) === JSON.stringify(nextParameters)) return
    videoFormParametersRef.current = nextParameters
    commitRawDataPatch({
      workflowID: selectedWorkflowTarget.workflowID,
      workflowRevision: selectedWorkflowTarget.revision,
      parameters: nextParameters,
      ...(revisionChanged ? { error: null, errorCode: null } : {}),
    })
  }, [commitRawDataPatch, selectedWorkflowForm, selectedWorkflowTarget])

  const writeVideoLocalInputAsset = useCallback((slot: VideoMediaInputSlot, asset: CinemaGeneratedAsset | null) => {
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
    mutationFn: async ({ slot, file }: { slot: VideoMediaInputSlot; file: File }) => {
      if (!data.agentBaseURL || !data.projectID) throw new Error(t("video.error.projectUnavailable"))
      const dataBase64 = await fileToDataBase64(file)
      const result = await requestJson<CinemaImportedMediaAssetResult>(
        data.agentBaseURL,
        `/api/cinema/projects/${encodeURIComponent(data.projectID)}/assets/media-imports`,
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
      setVideoInputImageImportError(error instanceof Error ? error.message : t("video.error.imageImportFailed"))
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
    const storedProviderID = readRawString(data.rawData, "providerID")
    const storedModelID = readRawString(data.rawData, "modelID")
    const hasStoredModelSelection = Boolean(storedProviderID && storedModelID)
    const nextProvider = providerForSelection(providers, storedProviderID)
    const nextModel = modelForSelection(nextProvider, storedModelID)
    if (hasStoredModelSelection && nextProvider?.manifest.id === storedProviderID && !nextModel) {
      setMode(storedMode)
      setProviderID(storedProviderID)
      setModelID(storedModelID)
      return
    }
    const nextCombination = inputCombinationForSelection(nextProvider, nextModel, storedMode)
    const nextMode = nextCombination?.mode ?? FALLBACK_VIDEO_INPUT_COMBINATION_MODE
    setMode(nextMode)
    setProviderID(nextProvider?.manifest.id ?? "")
    setModelID(nextModel ? providerModelSelectionID(nextModel) : "")
    const nextAspectRatio = validAspectRatioForSelection(
      hasStoredModelSelection
        ? readRawString(data.rawData, "aspectRatio", defaultModelAspectRatio(nextModel, nextCombination))
        : defaultModelAspectRatio(nextModel, nextCombination),
      nextModel,
      nextCombination,
    )
    const nextDuration = validDurationForSelection(
      String(hasStoredModelSelection
        ? readRawNumber(data.rawData, "duration", defaultModelDuration(nextModel, nextCombination))
        : defaultModelDuration(nextModel, nextCombination)),
      nextModel,
      nextCombination,
    )
    const nextResolution = validResolutionForSelection(
      hasStoredModelSelection
        ? readRawString(data.rawData, "resolution", defaultModelResolution(nextModel, nextCombination))
        : defaultModelResolution(nextModel, nextCombination),
      nextModel,
      nextCombination,
    )
    setAspectRatioDraft(nextAspectRatio)
    setDurationDraft(String(nextDuration))
    setResolutionDraft(nextResolution)
  }, [data.rawData, providers, setAspectRatioDraft, setDurationDraft, setMode, setModelID, setProviderID, setResolutionDraft])

  useEffect(() => {
    if (isPromptFocusedRef.current || isPromptComposingRef.current || promptCommitTimerRef.current !== null) return
    const rawPrompt = readOptionalRawString(data.rawData, "text")
    const nextPrompt = rawPrompt ?? taskUserPrompt ?? task?.input.prompt ?? ""
    if (promptDraftRef.current === nextPrompt) return
    promptDraftRef.current = nextPrompt
    setPromptDraftState(nextPrompt)
  }, [data.rawData, task?.input.prompt, taskUserPrompt])

  useEffect(() => () => {
    clearPromptCommitTimer()
    onNodeInputEditingChangeRef.current?.(id, false)
  }, [clearPromptCommitTimer, id])

  useEffect(() => {
    if (active) return
    const wasEditing = isPromptFocusedRef.current
      || isPromptComposingRef.current
      || promptCommitTimerRef.current !== null
    const value = promptDraftRef.current
    isPromptFocusedRef.current = false
    isPromptComposingRef.current = false
    clearPromptCommitTimer()
    if (wasEditing) commitRawDataPatch({ text: value })
    setPromptInputEditing(false)
  }, [active, clearPromptCommitTimer, commitRawDataPatch, setPromptInputEditing])

  useEffect(() => {
    setIsVideoPreviewPlaying(false)
  }, [previewSrc])

  const toggleVideoPreviewPlayback = async () => {
    const video = videoPreviewRef.current
    if (!video) return
    if (video.paused || video.ended) {
      try {
        await video.play()
      } catch {
        setIsVideoPreviewPlaying(false)
      }
      return
    }
    video.pause()
  }

  const openVideoInputImagePicker = (slot: VideoMediaInputSlot) => {
    if (!canImportVideoInputLocalMedia(slot) || isBusy || importVideoInputImageMutation.isPending) return
    pendingVideoInputImageSlotRef.current = slot
    setVideoInputImageImportError(null)
    if (videoInputImageInputRef.current) {
      videoInputImageInputRef.current.accept = slot === "sourceVideo"
        ? "video/mp4,video/webm,video/quicktime"
        : IMAGE_FILE_ACCEPT
    }
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

  const clearVideoInputLocalImage = (slot: VideoMediaInputSlot) => {
    if (!canImportVideoInputLocalMedia(slot) || isBusy || importVideoInputImageMutation.isPending) return
    setVideoInputImageImportError(null)
    writeVideoLocalInputAsset(slot, null)
  }

  const chooseMode = (nextMode: CinemaGenerationMode) => {
    if (nextMode === modeRef.current) return
    const nextCombination = inputCombinationForSelection(selectedProvider, selectedModel, nextMode)
    const nextAspectRatio = validAspectRatioForSelection(aspectRatioDraftRef.current, selectedModel, nextCombination)
    const nextDuration = validDurationForSelection(durationDraftRef.current, selectedModel, nextCombination)
    const nextResolution = validResolutionForSelection(resolutionDraftRef.current, selectedModel, nextCombination)
    const nextParameters = generationControlDefaultParameters(
      videoModeInputContractForCombination(nextCombination).parameterControls,
    )
    videoFormParametersRef.current = nextParameters
    setMode(nextMode)
    setAspectRatioDraft(nextAspectRatio)
    setDurationDraft(String(nextDuration))
    setResolutionDraft(nextResolution)
    commitRawDataPatch({
      mode: nextMode,
      aspectRatio: nextAspectRatio,
      duration: nextDuration,
      resolution: nextResolution,
      parameters: nextParameters,
    })
  }

  const chooseVideoModel = (nextChoiceValue: string) => {
    if (nextChoiceValue === selectedVideoModelChoiceValue) return
    const nextChoice = videoModelChoices.find((choice) => choice.value === nextChoiceValue)
    if (!nextChoice) return
    const nextProvider = nextChoice.provider
    const nextModel = nextChoice.model
    const nextCombination = inputCombinationForSelection(nextProvider, nextModel, modeRef.current)
    const nextMode = nextCombination?.mode ?? FALLBACK_VIDEO_INPUT_COMBINATION_MODE
    const nextAspectRatio = defaultModelAspectRatio(nextModel, nextCombination)
    const nextDuration = defaultModelDuration(nextModel, nextCombination)
    const nextResolution = defaultModelResolution(nextModel, nextCombination)
    const nextWorkflowForm = nextModel.formSpecs.find((formSpec) => formSpec.target.kind === "workflow") ?? null
    const nextParameters = generationControlDefaultParameters(
      nextWorkflowForm?.controls ?? videoModeInputContractForCombination(nextCombination).parameterControls,
    )
    videoFormParametersRef.current = nextParameters
    setMode(nextMode)
    setProviderID(nextProvider.manifest.id)
    setModelID(providerModelSelectionID(nextModel))
    setAspectRatioDraft(nextAspectRatio)
    setDurationDraft(String(nextDuration))
    setResolutionDraft(nextResolution)
    commitRawDataPatch({
      mode: nextMode,
      providerID: nextProvider.manifest.id,
      modelID: providerModelSelectionID(nextModel),
      workflowID: nextWorkflowForm?.target.kind === "workflow" ? nextWorkflowForm.target.workflowID : undefined,
      workflowRevision: nextWorkflowForm?.target.kind === "workflow" ? nextWorkflowForm.target.revision : undefined,
      aspectRatio: nextAspectRatio,
      duration: nextDuration,
      resolution: nextResolution,
      parameters: nextParameters,
    })
  }

  const handleVideoModeKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    stopCanvasKeyboardEvent(event)
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    if (visibleModeContracts.length === 0) return
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? visibleModeContracts.length - 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (currentIndex <= 0 ? visibleModeContracts.length - 1 : currentIndex - 1)
          : (currentIndex + 1) % visibleModeContracts.length
    const nextMode = visibleModeContracts[nextIndex]?.mode
    if (!nextMode) return
    chooseMode(nextMode)
    window.requestAnimationFrame(() => {
      document.getElementById(`${id}-video-mode-${nextMode}`)?.focus()
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
    if (!selectedProvider || !selectedModel || !selectedInputCombination || isBusy || requiredInputMissing || unsupportedRequiredInput || !videoFormParametersReady) return
    clearPromptCommitTimer()
    const duration = validDurationForSelection(durationDraftRef.current, selectedModel, selectedInputCombination)
    const aspectRatio = validAspectRatioForSelection(aspectRatioDraftRef.current, selectedModel, selectedInputCombination)
    const resolution = validResolutionForSelection(resolutionDraftRef.current, selectedModel, selectedInputCombination)
    const sourceNodeIDs = uniqueSourceNodeIDs(
      sourceTextParameters.map((parameter) => parameter.nodeID),
      activeInputAssets.filter(({ asset }) => asset.nodeID !== id).map(({ asset }) => asset.nodeID),
    )
    const inputCombinationMode = selectedInputCombination.mode
    let parameters: Record<string, unknown>
    if (selectedWorkflowForm && selectedWorkflowTarget) {
      parameters = reconcileGenerationParameters(videoFormParametersRef.current, selectedWorkflowForm)
      if (workflowPrimaryTextControl) parameters[workflowPrimaryTextControl.key] = prompt
      for (const control of selectedWorkflowForm.controls) {
        if (control.type !== "media" && control.type !== "image-list") continue
        const mediaInput = videoMediaInputs.find((input) => input.parameterKey === control.key)
        if (!mediaInput) continue
        const paths = inputAssetsForControl(mediaInput).map((asset) => ({
          path: asset.path,
          assetID: asset.id,
        }))
        if (paths.length === 0) {
          delete parameters[control.key]
        } else if (control.type === "media" && !control.multiple) {
          parameters[control.key] = paths[0]
        } else {
          parameters[control.key] = paths
        }
      }
      for (const [key, value] of Object.entries(parameters)) {
        if (value === undefined) delete parameters[key]
      }
    } else {
      const hiddenDefaultParameters = hiddenDefaultParametersForCombination(selectedInputCombination)
      parameters = buildGenerationTaskParameters({
        baseParameters: videoFormParametersRef.current,
        hiddenDefaultParameters,
        fixedParameters: {
          aspectRatio,
          duration,
          resolution,
          qualityMode: resolution,
          quality_mode: resolution,
          inputCombinationMode,
          selectedInputCombination: selectedInputCombination.mode,
          modelSelectionID: selectedModelSelectionID,
          ...(selectedEndpoint ? { endpoint: selectedEndpoint } : {}),
          ...(selectedModel.offeringID ? { offeringID: selectedModel.offeringID } : {}),
          ...(selectedModel.providerModelID ? { providerModelID: selectedModel.providerModelID } : {}),
          userPrompt,
          sourceTextPrompts,
        },
        sourceTextParameters,
        activeInputAssets,
        legacyAssetsBySlot: generationLegacyAssetsBySlot(activeInputAssets),
        includeSourceImageFields: hasSourceImageInput,
      })
    }

    commitRawDataPatch({
      text: userPrompt,
      mode: inputCombinationMode,
      providerID: selectedProvider.manifest.id,
      modelID: selectedModelSelectionID,
      workflowID: selectedWorkflowTarget?.workflowID,
      workflowRevision: selectedWorkflowTarget?.revision,
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
      errorCode: null,
    })
    data.onCreateVideoGenerationTask?.(id, {
      operationID: makeGenerationOperationID(),
      taskNodeID: id,
      providerID: selectedProvider.manifest.id,
      target: selectedWorkflowTarget ?? { kind: "model", modelID: selectedModelSelectionID },
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
        className="cinema-file-input"
        type="file"
        accept={IMAGE_FILE_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleVideoInputImageFileChange}
      />
      <Handle
        id="input"
        type="target"
        position={Position.Left}
        className={`cinema-node-handle cinema-node-handle-input ${data.hasIncomingConnection ? "is-connected" : ""}`}
        style={accentStyle}
      />
      <article
        className={`cinema-video-gen-node ${selected ? "is-selected" : ""}`}
        style={accentStyle}
        onPointerDown={(event) => activateNodeOnPointerDown(event, id, data.onActivateNode)}
      >
        <header className="cinema-video-gen-header">
          <CinemaNodeTitle
            icon={Video}
            label={t("video.type")}
            nodeID={id}
            title={data.title}
            onChangeTitle={data.onChangeTitle}
          />
          <div className="cinema-node-header-actions">
            <NodeStatusDot
              status={currentStatus}
              label={isBusy
                ? t("generation.status.inProgress", { status: translateGenerationStatus(locale, currentStatus) })
                : translateGenerationStatus(locale, currentStatus)}
            />
            <NodeDeleteButton nodeID={id} onDeleteNode={data.onDeleteNode} />
          </div>
        </header>

        <section className={previewClassName} style={previewStyle} aria-label={t("video.preview")}>
          {previewSrc ? (
            <>
              <video
                ref={videoPreviewRef}
                src={previewSrc}
                controls
                preload="metadata"
                playsInline
                onPlay={() => setIsVideoPreviewPlaying(true)}
                onPause={() => setIsVideoPreviewPlaying(false)}
                onEnded={() => setIsVideoPreviewPlaying(false)}
              />
              <button
                type="button"
                className={`cinema-video-preview-play nodrag nowheel ${isVideoPreviewPlaying ? "is-playing" : ""}`}
                title={t(isVideoPreviewPlaying ? "video.pausePreview" : "video.playPreview")}
                aria-label={t(isVideoPreviewPlaying ? "video.pausePreview" : "video.playPreview")}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  void toggleVideoPreviewPlayback()
                }}
              >
                {isVideoPreviewPlaying ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
              </button>
            </>
          ) : (
            <div className="cinema-video-gen-empty">
              <Play size={26} aria-hidden="true" />
              <span>{t(isWaiting ? "video.waiting" : "video.empty")}</span>
            </div>
          )}
          {data.isCreatingVideoTask ? (
            <div className="cinema-generation-overlay" aria-live="polite">
              <Loader2 size={18} aria-hidden="true" className="is-spinning" />
              <span>{t("video.submitting")}</span>
            </div>
          ) : null}
        </section>

        {shouldShowVideoProgress ? <GenerationProgress progress={progress} status={currentStatus} /> : null}

      </article>

      {active ? (
        <CinemaNodeInputOverlay
          nodeID={id}
          selected={active}
          overlayRoot={data.nodeInputOverlayRoot}
          width={640}
          accentStyle={accentStyle}
        >
          <section className="cinema-node-input-panel cinema-generation-composer cinema-video-gen-composer nodrag nowheel" aria-label={t("video.controls")}>
          {visibleModeContracts.length > 1 ? (
            <div className="cinema-video-mode-tabs" role="tablist" aria-label={t("video.mode")}>
              {visibleModeContracts.map((contract, contractIndex) => (
                <button
                  id={`${id}-video-mode-${contract.mode}`}
                  key={contract.mode}
                  type="button"
                  role="tab"
                  aria-selected={mode === contract.mode}
                  aria-controls={`${id}-video-mode-panel`}
                  tabIndex={mode === contract.mode ? 0 : -1}
                  className={mode === contract.mode ? "is-active" : ""}
                  disabled={isBusy}
                  onKeyDown={(event) => handleVideoModeKeyDown(event, contractIndex)}
                  onClick={() => chooseMode(contract.mode)}
                >
                  {translateVideoModeLabel(locale, contract.mode, contract.label)}
                </button>
              ))}
            </div>
          ) : null}
          <div
            key={mode}
            id={`${id}-video-mode-panel`}
            className="cinema-video-gen-scroll"
            role="tabpanel"
            aria-label={visibleModeContracts.length === 1 ? visibleModeContracts[0]?.label : undefined}
            aria-labelledby={visibleModeContracts.length > 1 ? `${id}-video-mode-${mode}` : undefined}
          >
          {sourceTextParameters.length > 0 ? (
            <div className="cinema-video-gen-param-tags" aria-label={t("generation.connectedText")}>
              {sourceTextParameters.map((parameter) => (
                <span
                  key={parameter.edgeID}
                  className={`cinema-video-gen-param-tag ${parameter.text.trim() ? "" : "is-empty"}`}
                  title={parameter.text.trim() ? `${parameter.nodeTitle}: ${parameter.text.trim()}` : `${parameter.nodeTitle}: ${t("generation.emptyText")}`}
                >
                  <FileText size={12} aria-hidden="true" />
                  <span>{parameter.nodeTitle}</span>
                  <button
                    type="button"
                    title={t("generation.removeText", { name: parameter.nodeTitle })}
                    aria-label={t("generation.removeText", { name: parameter.nodeTitle })}
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
          {videoMediaInputs.length > 0 ? (
            <section
              className={`cinema-video-input-slots ${videoMediaInputs.some((input) => input.slot === "startFrame") && videoMediaInputs.some((input) => input.slot === "endFrame") ? "is-frame-pair" : ""}`}
              aria-label={t("video.inputSlots")}
            >
              {videoMediaInputs.flatMap((input, inputIndex) => {
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
                  const importSlot = canImportVideoInputLocalMedia(input.slot) ? input.slot : null
                  const canImportLocalImage = importSlot !== null
                  const canOpenLocalImagePicker = canImportLocalImage && !asset
                  const isImportingThisSlot = importSlot !== null && importingVideoInputImageSlot === importSlot
                  const isLocalImportedAsset = Boolean(asset && !edgeID && importSlot !== null && asset.nodeID === id)
                  const inputLabel = localizedVideoInputLabel(input)
                  const inputEmptyText = localizedVideoInputEmptyText(input)
                  const slotLabel = input.slot === "referenceImage" && asset
                    ? `${inputLabel} ${assetIndex + 1}/${input.maxCount ?? slotAssets.length}`
                    : input.slot === "referenceImage" && input.maxCount
                      ? t("video.input.maxCount", { input: inputLabel, count: input.maxCount })
                      : inputLabel
                  const assetDisplayTitle = isLocalImportedAsset
                    ? t("video.input.localAsset", { input: inputLabel })
                    : asset?.nodeTitle ?? ""
                  const slotValueTitle = asset ? `${assetDisplayTitle} · ${asset.path}` : inputEmptyText
                  const slotActionLabel = asset
                    ? t("video.input.replaceLocal", { input: inputLabel })
                    : t("video.input.importLocal", { input: inputLabel })
                  const slotIndexLabel = input.slot === "startFrame"
                    ? "1"
                    : input.slot === "endFrame"
                      ? "2"
                      : String(input.slot === "referenceImage" ? assetIndex + 1 : inputIndex + 1)
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
                          {asset ? slotValueTitle : inputEmptyText}
                        </span>
                      </div>
                    </>
                  )
                  return (
                  <div
                    key={asset ? `${input.inputKey}-${asset.edgeID ?? sourceImageAssetKey(asset)}` : input.inputKey}
                    className={`cinema-video-input-slot ${asset ? "is-ready" : "is-missing"} ${isRequired ? "is-required" : ""}`}
                    data-slot-index={slotIndexLabel}
                    data-slot-kind={input.slot}
                    title={slotValueTitle}
                  >
                    {assetIndex === 0 ? (
                      <Handle
                        id={input.inputKey}
                        type="target"
                        position={Position.Left}
                        className={`cinema-node-handle cinema-node-handle-input cinema-video-input-slot-handle ${asset ? "is-connected" : ""} ${isBusy ? "is-locked" : ""}`}
                        style={accentStyle}
                        isConnectable={!isBusy}
                      />
                    ) : null}
                    {canOpenLocalImagePicker ? (
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
                        title={edgeID
                          ? t("video.input.remove", { input: inputLabel })
                          : t("video.input.clearLocal", { input: inputLabel })}
                        aria-label={edgeID
                          ? t("video.input.remove", { input: inputLabel })
                          : t("video.input.clearLocal", { input: inputLabel })}
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
                      <span className="cinema-video-input-slot-required">{t("video.input.required")}</span>
                    ) : null}
                  </div>
                )
                })
              })}
            </section>
          ) : null}
          {!selectedWorkflowForm || workflowPrimaryTextControl ? <textarea
            ref={promptRef}
            className="cinema-video-prompt-input"
            aria-label={workflowPrimaryTextControl?.label ?? t("video.prompt")}
            value={promptDraft}
            placeholder={workflowPrimaryTextControl?.placeholder
              ?? workflowPrimaryTextControl?.description
              ?? translateVideoPromptPlaceholder(locale, modeContract.promptPlaceholder)}
            spellCheck={false}
            disabled={isBusy}
            onFocus={() => {
              isPromptFocusedRef.current = true
              setPromptInputEditing(true)
            }}
            onKeyDown={stopCanvasKeyboardEvent}
            onChange={(event) => {
              const value = event.target.value
              setPromptInputEditing(true)
              setPromptDraft(value)
              if (!isPromptComposingRef.current) schedulePromptCommit(value)
            }}
            onCompositionStart={() => {
              isPromptComposingRef.current = true
              setPromptInputEditing(true)
              clearPromptCommitTimer()
            }}
            onCompositionEnd={(event) => {
              isPromptComposingRef.current = false
              const value = event.currentTarget.value
              setPromptDraft(value)
              commitRawDataPatch({ text: value })
              if (!isPromptFocusedRef.current) setPromptInputEditing(false)
            }}
            onBlur={() => {
              isPromptFocusedRef.current = false
              const value = promptRef.current?.value ?? promptDraftRef.current
              const wasComposing = isPromptComposingRef.current
              promptDraftRef.current = value
              if (wasComposing) {
                isPromptComposingRef.current = false
                setPromptDraft(value)
              }
              clearPromptCommitTimer()
              commitRawDataPatch({ text: value })
              setPromptInputEditing(false)
            }}
          /> : null}
          {hasVideoAdvancedInputs && isAdvancedOpen ? (
            <section id={`${id}-video-advanced`} className="cinema-video-advanced-panel" aria-label={t("video.advancedInputs")}>
              {visibleVideoParameterControls.length > 0 ? (
                <section className="cinema-video-form-controls" aria-label={t("video.parameters")}>
                  {visibleVideoParameterControls.map((control) => (
                    <GenerationParameterControlField
                      key={`${selectedVideoModelChoiceValue}-${selectedWorkflowTarget?.revision ?? mode}-${control.key}`}
                      control={control}
                      parameters={videoFormParameters}
                      disabled={isBusy}
                      agentBaseURL={data.agentBaseURL}
                      projectID={data.projectID}
                      onChange={commitVideoFormParameterPatch}
                    />
                  ))}
                </section>
              ) : null}
            </section>
          ) : null}
          {videoInputImageImportError || nodeError || showComfyUISettingsAction ? (
            <div className="cinema-video-gen-error-actions">
              {videoInputImageImportError || nodeError ? (
                <p className="cinema-video-gen-error" role="alert" title={videoInputImageImportError ?? nodeError ?? undefined}>
                  {videoInputImageImportError ?? nodeError}
                </p>
              ) : null}
              {showComfyUISettingsAction ? (
                <button
                  type="button"
                  className="cinema-video-gen-settings-link"
                  onClick={() => requestDesktopCinemaProviderSettings("comfyui-local")}
                >
                  {t("video.comfyui.openSettings")}
                </button>
              ) : null}
            </div>
          ) : unsupportedRequiredInput || requiredInputMissing || providerNeedsCredential && !providerConnected || providerAdapterUnavailable ? (
            <p className="cinema-video-gen-error" role="status">
              {unsupportedInputReason ?? requiredInputReason ?? providerAdapterReason ?? providerConnectionReason}
            </p>
          ) : null}
          </div>
          {submitDisabledReason ? (
            <span id={`${id}-video-submit-reason`} className="cinema-visually-hidden">
              {submitDisabledReason}
            </span>
          ) : null}
          <footer className="cinema-generation-footer cinema-video-composer-footer">
            <div className="cinema-generation-target-picker">
              <CinemaComposerSelect
                id={`${id}-video-model`}
                ariaLabel={t("generation.target")}
                className="cinema-generation-model-select"
                menuMinWidth={236}
                value={selectedVideoModelChoiceValue}
                disabled={isBusy || videoModelChoices.length + disabledWorkflowChoices.length === 0}
                placeholder={t("generation.noWorkflowOrModel")}
                options={[
                  ...videoModelChoices.map((choice) => ({
                    value: choice.value,
                    label: choice.label,
                    triggerLabel: choice.model.label,
                  })),
                  ...disabledWorkflowChoices,
                ]}
                onChange={chooseVideoModel}
              />
              {selectedWorkflowCatalog ? (
                <button
                  type="button"
                  className="cinema-generation-workflow-refresh"
                  title={t("generation.refreshWorkflows")}
                  aria-label={t("generation.refreshWorkflows")}
                  disabled={isBusy || data.isRefreshingWorkflows}
                  onClick={() => data.onRefreshProviderWorkflows?.(selectedWorkflowCatalog.providerID)}
                >
                  <RefreshCw size={14} aria-hidden="true" className={data.isRefreshingWorkflows ? "is-spinning" : ""} />
                </button>
              ) : null}
            </div>
            <div className="cinema-video-quick-controls cinema-video-parameter-rail">
              {!selectedWorkflowForm ? <GenerationSpecPopover
                id={`${id}-video-spec`}
                ariaLabel={t("video.canvasSpec")}
                summary={videoSpecSummary}
                disabled={isBusy}
                onKeepActive={() => data.onSelectNode?.(id)}
              >
                <GenerationSpecOptionGroup
                  label={t("video.ratio")}
                  value={aspectRatioDraft}
                  options={videoAspectRatioSpecOptions}
                  disabled={isBusy}
                  onChange={(nextValue) => {
                    setAspectRatioDraft(nextValue)
                    commitRawDataPatch({ aspectRatio: nextValue })
                  }}
                />
                <GenerationSpecOptionGroup
                  label={t("video.quality")}
                  value={resolutionDraft}
                  options={videoResolutionSpecOptions}
                  disabled={isBusy}
                  onChange={(nextValue) => {
                    setResolutionDraft(nextValue)
                    commitRawDataPatch({ resolution: nextValue })
                  }}
                />
              </GenerationSpecPopover> : null}
              {!selectedWorkflowForm ? <CinemaComposerSelect
                id={`${id}-video-duration`}
                ariaLabel={t("video.duration")}
                className="cinema-video-duration-select"
                menuMinWidth={60}
                value={durationDraft}
                disabled={isBusy}
                options={durationSelectOptions.map((value) => ({
                  value: String(value),
                  label: `${value}s`,
                  triggerLabel: `${value}s`,
                }))}
                onChange={(nextValue) => {
                  setDurationDraft(nextValue)
                  commitRawDataPatch({ duration: Number.parseFloat(nextValue) || DEFAULT_VIDEO_DURATION_SECONDS })
                }}
              /> : null}
              {hasVideoAdvancedInputs ? (
                <button
                  type="button"
                  className={`cinema-video-advanced-toggle ${isAdvancedOpen ? "is-open" : ""}`}
                  aria-label={t("common.advanced")}
                  aria-expanded={isAdvancedOpen}
                  aria-controls={`${id}-video-advanced`}
                  onClick={() => setIsAdvancedOpen((value) => !value)}
                >
                  <span>{t("common.advanced")}</span>
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="cinema-video-gen-submit"
              title={submitDisabledReason ?? t("video.generate")}
              aria-label={t("video.generate")}
              aria-describedby={submitDisabledReason ? `${id}-video-submit-reason` : undefined}
              disabled={!canGenerate}
              onClick={createTask}
            >
              {data.isCreatingVideoTask
                ? <Loader2 size={18} aria-hidden="true" className="is-spinning" />
                : <ArrowUp size={18} aria-hidden="true" />}
            </button>
          </footer>
          </section>
        </CinemaNodeInputOverlay>
      ) : null}
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className={`cinema-node-handle cinema-node-handle-output ${data.hasOutgoingConnection ? "is-connected" : ""}`}
        style={accentStyle}
      />
    </>
  )
}

function ImageReadyState({
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
  const { t } = useI18n()
  const active = data.isActiveNode ?? Boolean(selected)
  const asset = readFinalImageAsset(data.rawData)
  const libraryAssetRef = cinemaAssetRefFromNodeData(data.rawData)
  const librarySnapshot = libraryAssetRef?.snapshot.kind === "image" ? libraryAssetRef.snapshot : null
  const libraryAssetStatus = readRawString(data.rawData, "assetStatus", "ready")
  const nodeRef = useRef<HTMLElement>(null)
  const cropFrameRef = useRef<HTMLElement | null>(null)
  const [hasPreviewError, setHasPreviewError] = useState(false)
  const [imagePixelSize, setImagePixelSize] = useState<{ width: number; height: number } | null>(
    () => asset?.width && asset.height
      ? { width: asset.width, height: asset.height }
      : librarySnapshot?.width && librarySnapshot.height
        ? { width: librarySnapshot.width, height: librarySnapshot.height }
        : null,
  )
  const [isCropEditorOpen, setIsCropEditorOpen] = useState(false)
  const [cropDraft, setCropDraft] = useState<ImageCropDraftRect | null>(null)
  const [cropDrag, setCropDrag] = useState<ImageCropDragState | null>(null)
  const [localCropError, setLocalCropError] = useState<string | null>(null)
  const previewSrc = libraryAssetRef && data.agentBaseURL
    ? cinemaAssetURL(data.agentBaseURL, libraryAssetRef, "preview")
    : asset && data.agentBaseURL && data.projectID
      ? projectAssetPreviewURL(data.agentBaseURL, data.projectID, asset.path)
      : ""
  const fileName = readRawString(data.rawData, "sourceFileName", data.title)
  const effectiveImageSize = imagePixelSize
    ?? (asset?.width && asset.height ? { width: asset.width, height: asset.height } : null)
    ?? (librarySnapshot?.width && librarySnapshot.height
      ? { width: librarySnapshot.width, height: librarySnapshot.height }
      : null)
  const previewAspectRatio = effectiveImageSize ? `${effectiveImageSize.width} / ${effectiveImageSize.height}` : null
  const previewStyle = previewAspectRatio
    ? { "--cinema-image-preview-aspect-ratio": previewAspectRatio } as CSSProperties
    : undefined
  const isCropping = Boolean(data.isCroppingImage)
  const cropError = localCropError ?? data.imageCropError ?? null
  const isLibraryAssetUnavailable = Boolean(libraryAssetRef && (libraryAssetStatus === "missing" || hasPreviewError))
  const canCrop = Boolean(
    (asset || libraryAssetRef && libraryAssetStatus === "ready")
    && previewSrc
    && !hasPreviewError
    && effectiveImageSize
    && data.onCreateCroppedImageNode,
  )

  useEffect(() => {
    setHasPreviewError(false)
    setLocalCropError(null)
    setImagePixelSize(
      asset?.width && asset.height
        ? { width: asset.width, height: asset.height }
        : librarySnapshot?.width && librarySnapshot.height
          ? { width: librarySnapshot.width, height: librarySnapshot.height }
          : null,
    )
  }, [asset?.height, asset?.width, librarySnapshot?.height, librarySnapshot?.width, previewSrc])

  useEffect(() => {
    if (active) return
    setIsCropEditorOpen(false)
    setCropDrag(null)
  }, [active])

  const framePointerPosition = useCallback((event: Pick<globalThis.PointerEvent, "clientX" | "clientY">) => {
    const frame = cropFrameRef.current
    if (!frame) return null
    const bounds = frame.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return null
    return {
      x: clampNumber((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clampNumber((event.clientY - bounds.top) / bounds.height, 0, 1),
    }
  }, [])

  useEffect(() => {
    if (!cropDrag) return

    const moveCrop = (event: globalThis.PointerEvent) => {
      event.preventDefault()
      const pointer = framePointerPosition(event)
      if (!pointer) return
      const minimumRatio = imageCropMinimumRatio(effectiveImageSize)
      setCropDraft(imageCropDraftFromDrag(cropDrag, pointer, minimumRatio))
    }
    const stopCrop = () => setCropDrag(null)

    window.addEventListener("pointermove", moveCrop)
    window.addEventListener("pointerup", stopCrop)
    window.addEventListener("pointercancel", stopCrop)
    return () => {
      window.removeEventListener("pointermove", moveCrop)
      window.removeEventListener("pointerup", stopCrop)
      window.removeEventListener("pointercancel", stopCrop)
    }
  }, [cropDrag, effectiveImageSize, framePointerPosition])

  const openCropEditor = useCallback(() => {
    if (!canCrop) return
    setLocalCropError(null)
    setCropDraft(defaultImageCropDraft())
    setIsCropEditorOpen(true)
  }, [canCrop])

  const resetCropDraft = useCallback(() => {
    setLocalCropError(null)
    setCropDraft(defaultImageCropDraft())
  }, [])

  const cancelCropEditor = useCallback(() => {
    setIsCropEditorOpen(false)
    setCropDrag(null)
    setLocalCropError(null)
  }, [])

  const startCropDrag = useCallback((mode: ImageCropDragMode, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!cropDraft) return
    const pointer = framePointerPosition(event)
    if (!pointer) return
    setLocalCropError(null)
    setCropDrag({
      mode,
      startPointer: pointer,
      startCrop: cropDraft,
    })
  }, [cropDraft, framePointerPosition])

  const applyCrop = useCallback(async () => {
    if (!cropDraft || !effectiveImageSize) {
      setLocalCropError("Image dimensions are unavailable.")
      return
    }
    if (!data.onCreateCroppedImageNode) {
      setLocalCropError("Crop action is unavailable.")
      return
    }
    setLocalCropError(null)
    const crop = imageCropRectFromDraft(cropDraft, effectiveImageSize)
    setCropDrag(null)
    setIsCropEditorOpen(false)
    try {
      await data.onCreateCroppedImageNode(id, crop)
    } catch (error) {
      setLocalCropError(error instanceof Error ? error.message : "Image crop failed")
    }
  }, [cropDraft, data, effectiveImageSize, id])

  const cropBoxStyle = cropDraft
    ? {
      left: `${cropDraft.x * 100}%`,
      top: `${cropDraft.y * 100}%`,
      width: `${cropDraft.width * 100}%`,
      height: `${cropDraft.height * 100}%`,
    } as CSSProperties
    : undefined
  const cropLayerStyle = cropDraft
    ? {
      "--cinema-image-crop-left": `${cropDraft.x * 100}%`,
      "--cinema-image-crop-top": `${cropDraft.y * 100}%`,
      "--cinema-image-crop-width": `${cropDraft.width * 100}%`,
      "--cinema-image-crop-height": `${cropDraft.height * 100}%`,
    } as CSSProperties
    : undefined

  return (
    <>
      {data.hasIncomingImageEdge ? (
        <Handle
          id="input"
          type="target"
          position={Position.Left}
          className="cinema-node-handle cinema-node-handle-input is-connected is-locked"
          style={accentStyle}
          isConnectable={false}
        />
      ) : null}
      <article
        ref={nodeRef}
        className={`cinema-image-node is-ready ${selected ? "is-selected" : ""}`}
        style={accentStyle}
        tabIndex={0}
        onPointerDown={(event) => activateNodeOnPointerDown(event, id, data.onActivateNode)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            event.stopPropagation()
            data.onSelectNode?.(id)
            return
          }
          if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            data.onDismissNodeOverlay?.()
            window.requestAnimationFrame(() => nodeRef.current?.focus())
          }
        }}
      >
        {active ? (
          <div className="cinema-image-toolbar nodrag nowheel" role="toolbar" aria-label={t("image.tools")}>
            <button
              type="button"
              className={`cinema-image-tool-button ${isCropEditorOpen ? "is-active" : ""}`}
              title={t("image.crop")}
              aria-label={t("image.crop")}
              aria-expanded={isCropEditorOpen}
              disabled={!canCrop || isCropping}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                openCropEditor()
              }}
            >
              {isCropping
                ? <Loader2 size={15} aria-hidden="true" className="is-spinning" />
                : <Scissors size={15} aria-hidden="true" />}
            </button>
          </div>
        ) : null}
        <header className="cinema-image-header">
          <CinemaNodeTitle
            icon={Image}
            label="Image"
            nodeID={id}
            title={data.title}
            onChangeTitle={data.onChangeTitle}
          />
          <div className="cinema-node-header-actions nodrag nowheel" role="toolbar" aria-label={t("image.actions")}>
            <NodeDeleteButton nodeID={id} onDeleteNode={data.onDeleteNode} />
          </div>
        </header>

        <section
          ref={cropFrameRef}
          className={`cinema-image-frame ${isCropEditorOpen ? "is-cropping" : ""}`}
          aria-label={t("image.preview")}
          style={previewStyle}
        >
          {previewSrc && !isLibraryAssetUnavailable && !hasPreviewError ? (
            <>
              <img
                src={previewSrc}
                alt={fileName}
                draggable={false}
                onLoad={(event) => {
                  const image = event.currentTarget
                  if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                    setImagePixelSize({ width: image.naturalWidth, height: image.naturalHeight })
                  }
                }}
                onError={() => setHasPreviewError(true)}
              />
              {isCropEditorOpen && cropDraft ? (
                <div
                  className="cinema-image-crop-layer nodrag nowheel"
                  role="group"
                  aria-label={t("image.cropEditor")}
                  style={cropLayerStyle}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="cinema-image-crop-scrim is-top" aria-hidden="true" />
                  <div className="cinema-image-crop-scrim is-right" aria-hidden="true" />
                  <div className="cinema-image-crop-scrim is-bottom" aria-hidden="true" />
                  <div className="cinema-image-crop-scrim is-left" aria-hidden="true" />
                  <div
                    className="cinema-image-crop-box"
                    style={cropBoxStyle}
                    onPointerDown={(event) => startCropDrag("move", event)}
                  >
                    {IMAGE_CROP_HANDLES.map((handle) => (
                      <span
                        key={handle}
                        className={`cinema-image-crop-handle is-${handle}`}
                        aria-hidden="true"
                        onPointerDown={(event) => startCropDrag(handle, event)}
                      />
                    ))}
                  </div>
                  <div className="cinema-image-crop-actions">
                    <button
                      type="button"
                      className="cinema-image-crop-command"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        cancelCropEditor()
                      }}
                      disabled={isCropping}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="cinema-image-crop-command"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        resetCropDraft()
                      }}
                      disabled={isCropping}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      className="cinema-image-crop-command is-primary"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        void applyCrop()
                      }}
                      disabled={isCropping}
                    >
                      {isCropping ? "Applying" : "Apply"}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className={`cinema-image-empty ${hasPreviewError || libraryAssetStatus === "missing" ? "is-error" : ""}`}>
              <Image size={28} aria-hidden="true" />
              <span>{t(isLibraryAssetUnavailable ? "image.assetUnavailable" : hasPreviewError ? "image.unavailable" : "image.noneSelected")}</span>
              {isLibraryAssetUnavailable && data.onRelinkAsset ? (
                <button type="button" onClick={() => data.onRelinkAsset?.(id)}>重新关联</button>
              ) : null}
            </div>
          )}
        </section>
        {cropError ? (
          <p className="cinema-image-crop-error" role="alert">{cropError}</p>
        ) : null}
      </article>
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className={`cinema-node-handle cinema-node-handle-output ${data.hasOutgoingConnection ? "is-connected" : ""}`}
        style={accentStyle}
      />
    </>
  )
}

function ImageCanvasNode({
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
  const active = data.isActiveNode ?? Boolean(selected)
  return readCinemaImageFinalAsset(data.rawData) || cinemaAssetRefFromNodeData(data.rawData)?.snapshot.kind === "image"
    ? <ImageReadyState id={id} data={data} selected={selected} accentStyle={accentStyle} />
    : <ImageCreationState id={id} data={data} selected={selected} accentStyle={accentStyle} />
}

function CinemaAssetReferenceBadge({ data }: { data: CinemaFlowNodeData }) {
  const { t } = useI18n()
  const assetRef = cinemaAssetRefFromNodeData(data.rawData)
  const assetStatus = readRawString(data.rawData, "assetStatus", "ready")
  if (!assetRef) return null
  const isPersonal = isPersonalCinemaAssetRef(assetRef)
  const isTrashed = assetStatus === "trashed"
  if (!isPersonal && !isTrashed) return null
  return (
    <div className="cinema-asset-node-badges" aria-label={t("asset.referenceStatus")}>
      {isPersonal ? <span>{t("asset.personal")}</span> : null}
      {isTrashed ? <span className="is-warning">{t("asset.deleted")}</span> : null}
    </div>
  )
}

function VideoReadyState({
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
  const { t } = useI18n()
  const assetRef = cinemaAssetRefFromNodeData(data.rawData)
  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const [playbackError, setPlaybackError] = useState(false)
  const [isVideoPreviewPlaying, setIsVideoPreviewPlaying] = useState(false)
  const status = readRawString(data.rawData, "assetStatus", "ready")
  const unavailable = status === "missing" || playbackError || !assetRef
  const previewSrc = assetRef && data.agentBaseURL ? cinemaAssetURL(data.agentBaseURL, assetRef, "preview") : ""
  const posterSrc = assetRef && data.agentBaseURL ? cinemaAssetURL(data.agentBaseURL, assetRef, "thumbnail") : undefined
  const previewAspectRatio = videoPreviewAspectRatio(assetRef?.snapshot ?? null, DEFAULT_VIDEO_ASPECT_RATIO)
  const previewStyle = {
    "--cinema-video-preview-aspect-ratio": previewAspectRatio.value,
  } as CSSProperties

  useEffect(() => {
    setPlaybackError(false)
    setIsVideoPreviewPlaying(false)
  }, [previewSrc])

  const toggleVideoPreviewPlayback = async () => {
    const video = videoPreviewRef.current
    if (!video) return
    if (video.paused || video.ended) {
      try {
        await video.play()
      } catch {
        setIsVideoPreviewPlaying(false)
      }
      return
    }
    video.pause()
  }

  return (
    <>
      {data.hasIncomingConnection ? (
        <Handle
          id="input"
          type="target"
          position={Position.Left}
          className="cinema-node-handle cinema-node-handle-input is-connected is-locked"
          style={accentStyle}
          isConnectable={false}
        />
      ) : null}
      <article
        className={`cinema-video-gen-node cinema-asset-ready-node is-video ${selected ? "is-selected" : ""}`}
        style={accentStyle}
        onPointerDown={(event) => activateNodeOnPointerDown(event, id, data.onActivateNode)}
      >
        <header className="cinema-video-gen-header">
          <CinemaNodeTitle
            icon={Video}
            label={t("video.type")}
            nodeID={id}
            title={data.title}
            onChangeTitle={data.onChangeTitle}
            isDragHandle
          />
          <div className="cinema-node-header-actions">
            <NodeStatusDot
              status={unavailable ? "failed" : "ready"}
              label={t(unavailable ? "asset.referenceUnavailable" : "asset.referenceStatus")}
            />
            <NodeDeleteButton nodeID={id} onDeleteNode={data.onDeleteNode} />
          </div>
        </header>
        <CinemaAssetReferenceBadge data={data} />
        <div
          className={`cinema-video-gen-preview cinema-asset-ready-preview nodrag nowheel ${unavailable ? "is-empty" : "has-video"} is-${previewAspectRatio.shape}`}
          style={previewStyle}
          aria-label={t("video.preview")}
        >
          {unavailable ? (
            <div className="cinema-video-gen-empty cinema-asset-reference-unavailable" role="status">
              <Video size={26} aria-hidden="true" />
              <strong>{t("asset.referenceUnavailable")}</strong>
              {data.onRelinkAsset ? (
                <button type="button" onClick={() => data.onRelinkAsset?.(id)}>{t("asset.relink")}</button>
              ) : null}
            </div>
          ) : (
            <>
              <video
                ref={videoPreviewRef}
                src={previewSrc}
                poster={posterSrc}
                controls
                preload="metadata"
                playsInline
                aria-label={t("asset.videoPreview", { name: data.title })}
                onPlay={() => setIsVideoPreviewPlaying(true)}
                onPause={() => setIsVideoPreviewPlaying(false)}
                onEnded={() => setIsVideoPreviewPlaying(false)}
                onError={() => setPlaybackError(true)}
              />
              <button
                type="button"
                className={`cinema-video-preview-play nodrag nowheel ${isVideoPreviewPlaying ? "is-playing" : ""}`}
                title={t(isVideoPreviewPlaying ? "video.pausePreview" : "video.playPreview")}
                aria-label={t(isVideoPreviewPlaying ? "video.pausePreview" : "video.playPreview")}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  void toggleVideoPreviewPlayback()
                }}
              >
                {isVideoPreviewPlaying ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
              </button>
            </>
          )}
        </div>
      </article>
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className={`cinema-node-handle cinema-node-handle-output ${data.hasOutgoingConnection ? "is-connected" : ""}`}
        style={accentStyle}
      />
    </>
  )
}

function AudioCanvasNode({
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
  const { t } = useI18n()
  const assetRef = cinemaAssetRefFromNodeData(data.rawData)
  const [playbackError, setPlaybackError] = useState(false)
  const status = readRawString(data.rawData, "assetStatus", "ready")
  const unavailable = Boolean(assetRef) && (status === "missing" || playbackError)
  const previewSrc = assetRef && data.agentBaseURL ? cinemaAssetURL(data.agentBaseURL, assetRef, "preview") : ""

  useEffect(() => setPlaybackError(false), [previewSrc])

  return (
    <>
      <article
        className={`cinema-asset-ready-node is-audio ${selected ? "is-selected" : ""}`}
        style={accentStyle}
        onPointerDown={(event) => activateNodeOnPointerDown(event, id, data.onActivateNode)}
      >
        <header className="cinema-node-header">
          <CinemaNodeTitle
            icon={Music}
            label="Audio"
            nodeID={id}
            title={data.title}
            onChangeTitle={data.onChangeTitle}
          />
          <div className="cinema-node-header-actions">
            <NodeDeleteButton nodeID={id} onDeleteNode={data.onDeleteNode} />
          </div>
        </header>
        <CinemaAssetReferenceBadge data={data} />
        <div className="cinema-asset-ready-preview nodrag nowheel">
          {!assetRef ? (
            <div className="cinema-asset-reference-unavailable" role="status">
              <Music size={24} aria-hidden="true" />
              <strong>{t("audio.noneSelected")}</strong>
            </div>
          ) : unavailable ? (
            <div className="cinema-asset-reference-unavailable" role="status">
              <Music size={24} aria-hidden="true" />
              <strong>{t("asset.referenceUnavailable")}</strong>
              {data.onRelinkAsset ? (
                <button type="button" onClick={() => data.onRelinkAsset?.(id)}>{t("asset.relink")}</button>
              ) : null}
            </div>
          ) : (
            <audio
              src={previewSrc}
              controls
              preload="metadata"
              aria-label={t("asset.audioPreview", { name: data.title })}
              onError={() => setPlaybackError(true)}
            />
          )}
        </div>
      </article>
      <Handle
        id="output"
        type="source"
        position={Position.Right}
        className={`cinema-node-handle cinema-node-handle-output ${data.hasOutgoingConnection ? "is-connected" : ""}`}
        style={accentStyle}
      />
    </>
  )
}

function CinemaNodeCard({ id, data, selected }: NodeProps<CinemaFlowNode>) {
  const meta = NODE_META[data.cinemaType]
  const accentStyle = { "--node-accent": meta.accent } as CSSProperties

  if (data.cinemaType === "text") {
    return <TextCanvasNode id={id} data={data} selected={selected} accentStyle={accentStyle} />
  }

  if (data.cinemaType === "image") {
    return <ImageCanvasNode id={id} data={data} selected={selected} accentStyle={accentStyle} />
  }

  if (data.cinemaType === "video") {
    return cinemaAssetRefFromNodeData(data.rawData)?.snapshot.kind === "video"
      ? <VideoReadyState id={id} data={data} selected={selected} accentStyle={accentStyle} />
      : <VideoGenerationCanvasNode id={id} data={data} selected={selected} accentStyle={accentStyle} />
  }

  if (data.cinemaType === "audio") {
    return <AudioCanvasNode id={id} data={data} selected={selected} accentStyle={accentStyle} />
  }

  return null
}

type CinemaNodeInspectorRow = {
  label: string
  value: string
  tone?: "danger" | "muted"
  multiline?: boolean
}

function addInspectorRow(
  rows: CinemaNodeInspectorRow[],
  label: string,
  value: string | number | null | undefined,
  options: Pick<CinemaNodeInspectorRow, "tone" | "multiline"> = {},
) {
  const normalized = typeof value === "number" ? String(value) : value?.trim()
  if (!normalized) return
  rows.push({ label, value: normalized, ...options })
}

function nodeStyleNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function formatAssetDimensions(asset: { width?: number; height?: number } | null | undefined) {
  return asset?.width && asset.height ? `${asset.width} x ${asset.height}` : ""
}

function selectedAssetForInspector(node: CinemaFlowNode) {
  if (node.data.cinemaType === "image") return selectedImageAssetForNode(node)
  if (node.data.cinemaType === "video") return selectedVideoAssetForNode(node)
  return null
}

function inspectorRowsForNode(node: CinemaFlowNode) {
  const rows: CinemaNodeInspectorRow[] = []
  const meta = NODE_META[node.data.cinemaType]
  const rawData = node.data.rawData
  const status = readRawString(rawData, "status")
  const error = readRawString(rawData, "error")
  const taskID = readRawString(rawData, "taskID")
  const task = taskID ? node.data.generationTasks?.find((item) => item.id === taskID) ?? null : null
  const nodeWidth = nodeStyleNumber(node.style?.width) ?? node.data.size?.width
  const nodeHeight = nodeStyleNumber(node.style?.height) ?? node.data.size?.height
  const selectedAsset = selectedAssetForInspector(node)
  const libraryAssetRef = cinemaAssetRefFromNodeData(rawData)

  addInspectorRow(rows, "Type", meta.label)
  addInspectorRow(rows, "Status", status)
  addInspectorRow(rows, "Node ID", node.id)
  addInspectorRow(rows, "Position", `${Math.round(node.position.x)}, ${Math.round(node.position.y)}`)
  if (nodeWidth && nodeHeight) addInspectorRow(rows, "Node size", `${Math.round(nodeWidth)} x ${Math.round(nodeHeight)}`)

  if (node.data.cinemaType === "text") {
    const text = readRawString(rawData, "text")
    const prompt = readRawString(rawData, "generationPrompt")
    addInspectorRow(rows, "Text length", text ? `${text.length} chars` : "")
    addInspectorRow(rows, "Prompt", prompt, { multiline: true })
    addInspectorRow(rows, "Model", readRawString(rawData, "textModel"))
  }

  if (node.data.cinemaType === "image") {
    addInspectorRow(rows, "Source", readRawString(rawData, "sourceKind"))
    addInspectorRow(rows, "Source file", readRawString(rawData, "sourceFileName"))
    addInspectorRow(rows, "Prompt", readRawString(rawData, "prompt"), { multiline: true })
    addInspectorRow(rows, "Model", readRawString(rawData, "model"))
    addInspectorRow(rows, "Requested size", readRawString(rawData, "size"))
    addInspectorRow(rows, "Count", readRawNumber(rawData, "count", 0) || "")
    addInspectorRow(rows, "Candidates", readCinemaImageCandidateAssets(rawData).length || "")
    addInspectorRow(rows, "Task ID", taskID)
    addInspectorRow(rows, "Generated", formatTaskTimestamp(readRawString(rawData, "generatedAt") || task?.updatedAt))
    addInspectorRow(rows, "Derived from", readRawString(rawData, "derivedFromNodeID"))
    addInspectorRow(rows, "Operation", readRawString(rawData, "derivedOperation"))
    const crop = readImageCropRect(rawData)
    if (crop) addInspectorRow(rows, "Crop", `${crop.width} x ${crop.height} at ${crop.x}, ${crop.y}`)
    const cropOutputSize = readRawRecord(rawData, "cropOutputSize")
    const cropOutputWidth = readRawNumber(cropOutputSize, "width", Number.NaN)
    const cropOutputHeight = readRawNumber(cropOutputSize, "height", Number.NaN)
    if (Number.isFinite(cropOutputWidth) && Number.isFinite(cropOutputHeight)) {
      addInspectorRow(rows, "Crop output", `${cropOutputWidth} x ${cropOutputHeight}`)
    }
  }

  if (node.data.cinemaType === "video") {
    addInspectorRow(rows, "Prompt", readRawString(rawData, "text"), { multiline: true })
    addInspectorRow(rows, "Provider", readRawString(rawData, "providerID"))
    addInspectorRow(rows, "Model", readRawString(rawData, "modelID"))
    addInspectorRow(rows, "Mode", readRawString(rawData, "mode") || readRawString(rawData, "inputCombinationMode"))
    addInspectorRow(rows, "Aspect ratio", readRawString(rawData, "aspectRatio"))
    addInspectorRow(rows, "Duration", readRawNumber(rawData, "duration", 0) ? `${readRawNumber(rawData, "duration", 0)}s` : "")
    addInspectorRow(rows, "Resolution", readRawString(rawData, "resolution"))
    addInspectorRow(rows, "Task ID", taskID)
    addInspectorRow(rows, "Updated", formatTaskTimestamp(task?.updatedAt))
  }

  if (selectedAsset) {
    addInspectorRow(rows, "Asset path", selectedAsset.path, { multiline: true })
    addInspectorRow(rows, "Dimensions", formatAssetDimensions(selectedAsset))
    addInspectorRow(rows, "File size", formatFileSize(selectedAsset.sizeBytes))
    addInspectorRow(rows, "MIME type", selectedAsset.mimeType)
  }

  if (libraryAssetRef) {
    addInspectorRow(rows, "Asset ID", libraryAssetRef.assetID)
    addInspectorRow(
      rows,
      "Asset scope",
      libraryAssetRef.scope.type === "personal" ? "个人素材" : "项目素材",
    )
    addInspectorRow(rows, "Content revision", libraryAssetRef.contentRevision)
    addInspectorRow(rows, "MIME type", libraryAssetRef.snapshot.mimeType)
    addInspectorRow(rows, "Dimensions", formatAssetDimensions(libraryAssetRef.snapshot))
    addInspectorRow(
      rows,
      "Duration",
      libraryAssetRef.snapshot.durationSeconds !== undefined
        ? `${libraryAssetRef.snapshot.durationSeconds.toFixed(2)}s`
        : "",
    )
    const assetStatus = readRawString(rawData, "assetStatus", "ready")
    if (assetStatus === "trashed") {
      addInspectorRow(rows, "Reference", "素材已删除，请重新关联", { tone: "danger" })
    } else if (assetStatus === "missing") {
      addInspectorRow(rows, "Reference", "引用不可用，请重新关联", { tone: "danger" })
    }
    if (libraryAssetRef.scope.type === "personal") {
      addInspectorRow(rows, "Portability", "此项目引用个人素材，移动到其他设备后可能不可用。", {
        tone: "muted",
        multiline: true,
      })
    }
  }

  addInspectorRow(rows, "Error", error, { tone: "danger", multiline: true })

  return rows
}

function CinemaNodeInspectorPanel({
  node,
  onClose,
}: {
  node: CinemaFlowNode
  onClose: () => void
}) {
  const { t } = useI18n()
  const meta = NODE_META[node.data.cinemaType]
  const Icon = meta.icon
  const rows = inspectorRowsForNode(node)

  return (
    <aside
      className="cinema-node-inspector"
      aria-label={t("node.selectedDetails")}
      style={{ "--node-accent": meta.accent } as CSSProperties}
    >
      <header className="cinema-node-inspector-header">
        <div>
          <span>
            <Icon size={13} aria-hidden="true" />
            {meta.label}
          </span>
          <strong title={node.data.title}>{node.data.title}</strong>
        </div>
        <button
          type="button"
          className="cinema-file-icon-button"
          title={t("node.closeDetails")}
          aria-label={t("node.closeDetails")}
          onClick={onClose}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>
      <dl className="cinema-node-inspector-list">
        {rows.map((row) => (
          <div
            key={`${row.label}-${row.value}`}
            className={`${row.multiline ? "is-multiline" : ""} ${row.tone === "danger" ? "is-danger" : ""}`}
          >
            <dt>{row.label}</dt>
            <dd title={row.value}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
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
  const { t } = useI18n()
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
      aria-label={t("files.title")}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="cinema-file-browser-header">
        <div>
          <span>{t("files.thisProject")}</span>
          <strong>{t("files.title")}</strong>
        </div>
        <div className="cinema-file-browser-actions">
          <button
            type="button"
            className="cinema-file-icon-button"
            title={t("files.back")}
            aria-label={t("files.back")}
            disabled={!canGoUp}
            onClick={() => listing?.parentPath !== undefined && setCurrentPath(listing.parentPath ?? "")}
          >
            <ArrowLeft size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="cinema-file-icon-button"
            title={t("files.refresh")}
            aria-label={t("files.refresh")}
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
            title={t("settings.close")}
            aria-label={t("files.close")}
            onClick={onClose}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <nav className="cinema-file-breadcrumbs" aria-label={t("files.folderPath")}>
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
            <span>{t("files.loading")}</span>
          </div>
        ) : listingQuery.error ? (
          <div className="cinema-file-browser-state is-error" role="alert">
            <span>{listingQuery.error instanceof Error ? listingQuery.error.message : t("files.loadFailed")}</span>
          </div>
        ) : listing && listing.entries.length === 0 ? (
          <div className="cinema-file-browser-state">
            <Folder size={16} aria-hidden="true" />
            <span>{t("files.empty")}</span>
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

      <section className="cinema-file-preview" aria-label={t("files.selected")}>
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
            <span>{t("files.noneSelected")}</span>
          </div>
        )}
      </section>
    </aside>
  )
}

function CinemaContextMenuSurface({
  x,
  y,
  compact = false,
  className = "",
  onClose,
  children,
}: {
  x: number
  y: number
  compact?: boolean
  className?: string
  onClose: () => void
  children: ReactNode
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ x, y })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const bounds = menu.getBoundingClientRect()
    const nextPosition = clampContextMenuPosition(
      x,
      y,
      bounds.width,
      bounds.height,
      window.innerWidth,
      window.innerHeight,
    )
    setPosition((current) => current.x === nextPosition.x && current.y === nextPosition.y ? current : nextPosition)
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [x, y])

  useEffect(() => {
    window.addEventListener("resize", onClose)
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof globalThis.Node && !menuRef.current?.contains(target)) onClose()
    }
    window.addEventListener("pointerdown", closeOnOutsidePointerDown)
    return () => {
      window.removeEventListener("resize", onClose)
      window.removeEventListener("pointerdown", closeOnOutsidePointerDown)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      className={`cinema-context-menu ${compact ? "is-compact" : ""} ${className}`}
      style={{ left: position.x, top: position.y }}
      role="menu"
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          onClose()
          return
        }
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        if (items.length === 0) return
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault()
          items[event.key === "Home" ? 0 : items.length - 1]?.focus({ preventScroll: true })
          return
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
        event.preventDefault()
        const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
        const offset = event.key === "ArrowDown" ? 1 : -1
        const nextIndex = currentIndex < 0
          ? 0
          : (currentIndex + offset + items.length) % items.length
        items[nextIndex]?.focus({ preventScroll: true })
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

function ContextMenu({
  menu,
  onAddNode,
  onClose,
}: {
  menu: ContextMenuState
  onAddNode: (type: CinemaNodeType, position: { x: number; y: number }) => void
  onClose: () => void
}) {
  if (!menu) return null

  return (
    <CinemaContextMenuSurface x={menu.x} y={menu.y} onClose={onClose}>
      {CREATABLE_NODE_TYPES.map((type) => {
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
    </CinemaContextMenuSurface>
  )
}

function NodeContextMenu({
  menu,
  onShowDetails,
  onDeleteNodes,
  onClose,
}: {
  menu: NodeContextMenuState
  onShowDetails: (nodeID: string) => void
  onDeleteNodes: (nodeIDs: string[]) => void
  onClose: () => void
}) {
  if (!menu) return null
  const selectionCountLabel = menu.kind === "selection" ? `${menu.nodeIDs.length} 个节点` : null

  return (
    <CinemaContextMenuSurface key={menu.kind} x={menu.x} y={menu.y} compact onClose={onClose}>
      {menu.kind === "selection" ? (
        <button
          type="button"
          role="menuitem"
          data-variant="danger"
          title={`删除选中的 ${selectionCountLabel}`}
          aria-label={`删除选中的 ${selectionCountLabel}`}
          onClick={() => {
            onDeleteNodes(menu.nodeIDs)
            onClose()
          }}
        >
          <Trash2 size={15} aria-hidden="true" />
          <span>删除</span>
          <span className="cinema-context-menu-item-meta">{selectionCountLabel}</span>
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onShowDetails(menu.nodeID)
            onClose()
          }}
        >
          <Info size={15} aria-hidden="true" />
          <span>详细信息</span>
        </button>
      )}
    </CinemaContextMenuSurface>
  )
}

function CanvasPanelNavigation({
  activePanel,
  onTogglePanel,
  assetButtonRef,
  assetLibraryEnabled,
}: {
  activePanel: CanvasPanel | null
  onTogglePanel: (panel: CanvasPanel) => void
  assetButtonRef: RefObject<HTMLButtonElement | null>
  assetLibraryEnabled: boolean
}) {
  const { t } = useI18n()
  const isFilesOpen = activePanel === "files"
  const isAssetsOpen = activePanel === "assets"

  return (
    <nav
      className="cinema-canvas-nav"
      aria-label={t("canvas.panels")}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className={`cinema-canvas-nav-button ${isFilesOpen ? "is-active" : ""}`}
        title={t(isFilesOpen ? "canvas.closeFiles" : "canvas.openFiles")}
        aria-label={t(isFilesOpen ? "canvas.closeFiles" : "canvas.openFiles")}
        aria-controls="cinema-file-browser"
        aria-expanded={isFilesOpen}
        aria-pressed={isFilesOpen}
        onClick={() => onTogglePanel("files")}
      >
        <Folder size={18} aria-hidden="true" />
      </button>
      {assetLibraryEnabled ? <button
        ref={assetButtonRef}
        type="button"
        className={`cinema-canvas-nav-button ${isAssetsOpen ? "is-active" : ""}`}
        title={t(isAssetsOpen ? "canvas.closeAssets" : "canvas.openAssets")}
        aria-label={t(isAssetsOpen ? "canvas.closeAssets" : "canvas.openAssets")}
        aria-controls="cinema-asset-library"
        aria-expanded={isAssetsOpen}
        aria-pressed={isAssetsOpen}
        onClick={() => onTogglePanel("assets")}
      >
        <Images size={18} aria-hidden="true" />
      </button> : null}
    </nav>
  )
}

type CinemaRecentProject = {
  id: string
  name: string
  worktree: string
  lastOpenedAt: string
}

function CinemaProjectLauncher({
  agentBaseURL,
  onOpen,
}: {
  agentBaseURL: string
  onOpen: (project: CinemaRecentProject) => void
}) {
  const projectsQuery = useQuery({
    queryKey: ["cinema-projects", agentBaseURL],
    queryFn: () => requestJson<CinemaRecentProject[]>(agentBaseURL, "/api/cinema/projects"),
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<CinemaRequestError | null>(null)
  const migrationProjectID = error?.data && typeof error.data === "object" && "projectID" in error.data
    && typeof error.data.projectID === "string"
    ? error.data.projectID
    : error?.data && typeof error.data === "object" && "cloneProjectID" in error.data
      && typeof error.data.cloneProjectID === "string"
      ? error.data.cloneProjectID
      : undefined

  const run = async (action: () => Promise<CinemaRecentProject | null>) => {
    setPending(true)
    setError(null)
    try {
      const project = await action()
      if (project) onOpen(project)
      else await projectsQuery.refetch()
    } catch (caught) {
      setError(caught instanceof CinemaRequestError
        ? caught
        : new CinemaRequestError(caught instanceof Error ? caught.message : String(caught), 500))
    } finally {
      setPending(false)
    }
  }

  const pick = (initialize: boolean) => run(async () => {
    const result = await requestJson<{ cancelled: boolean; project?: CinemaRecentProject }>(
      agentBaseURL,
      "/api/cinema/projects/pick",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initialize }),
      },
    )
    return result.cancelled ? null : result.project ?? null
  })

  return (
    <CinemaWorkbenchShell
      projectName="Cinema"
      activeWorkspace="create"
      onWorkspaceChange={() => undefined}
      availableWorkspaces={{ edit: false, deliver: false }}
    >
      <section className="cinema-project-launcher" aria-busy={pending}>
        <header>
          <Film size={28} aria-hidden="true" />
          <div>
            <h1>Cinema projects</h1>
            <p>Open an existing Cinema project, or initialize a folder you choose.</p>
          </div>
        </header>
        <div className="cinema-project-launcher-actions">
          <button type="button" disabled={pending} onClick={() => void pick(false)}>Open project folder</button>
          <button type="button" disabled={pending} onClick={() => void pick(true)}>Initialize folder</button>
        </div>
        {error ? (
          <div className="cinema-project-launcher-error" role="alert">
            <strong>{error.code ?? "PROJECT_OPEN_FAILED"}</strong>
            <span>{error.message}</span>
            {migrationProjectID && ["PROJECT_MIGRATION_REQUIRED", "PROJECT_ID_CONFLICT"].includes(error.code ?? "") ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void run(async () => {
                  const result = await requestJson<{ project: CinemaRecentProject }>(
                    agentBaseURL,
                    `/api/cinema/projects/${encodeURIComponent(migrationProjectID)}/migration`,
                    { method: "POST" },
                  )
                  return result.project
                })}
              >
                {error.code === "PROJECT_ID_CONFLICT" ? "Clone with a new project ID" : "Back up and migrate project"}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="cinema-project-recent">
          <h2>Recent projects</h2>
          {projectsQuery.isLoading ? (
            <p>Loading projects…</p>
          ) : projectsQuery.error ? (
            <p role="alert">{projectsQuery.error instanceof Error ? projectsQuery.error.message : "Could not load projects."}</p>
          ) : projectsQuery.data?.length ? (
            projectsQuery.data.map((project) => (
              <article key={project.id}>
                <button
                  type="button"
                  className="cinema-project-open"
                  disabled={pending}
                  onClick={() => void run(async () => requestJson<CinemaRecentProject>(
                    agentBaseURL,
                    `/api/cinema/projects/${encodeURIComponent(project.id)}/open`,
                    { method: "POST" },
                  ))}
                >
                  <strong>{project.name}</strong>
                  <span>{project.worktree}</span>
                </button>
                <button
                  type="button"
                  className="cinema-project-remove"
                  aria-label={`Remove ${project.name} from recent projects`}
                  disabled={pending}
                  onClick={() => void run(async () => {
                    await requestJson(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(project.id)}/recent`, { method: "DELETE" })
                    return null
                  })}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </article>
            ))
          ) : (
            <p>No recent Cinema projects.</p>
          )}
        </div>
      </section>
    </CinemaWorkbenchShell>
  )
}

export function App() {
  const initial = useMemo(readSearchParams, [])
  const [projectID, setProjectID] = useState(initial.projectID)
  const openProject = useCallback((project: CinemaRecentProject) => {
    const next = new URL(window.location.href)
    next.searchParams.set("projectID", project.id)
    window.history.replaceState(null, "", next)
    setProjectID(project.id)
  }, [])

  if (!projectID) return <CinemaProjectLauncher agentBaseURL={initial.agentBaseURL} onOpen={openProject} />
  return <CinemaProjectApp key={projectID} projectID={projectID} agentBaseURL={initial.agentBaseURL} />
}

function CinemaProjectApp({ projectID, agentBaseURL }: { projectID: string; agentBaseURL: string }) {
  const { t } = useI18n()
  const activeNodeID = useUiStore((state) => state.activeNodeID)
  const setActiveNodeID = useUiStore((state) => state.setActiveNodeID)
  const reactFlow = useReactFlow<CinemaFlowNode, Edge>()
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<CinemaFlowNode, Edge> | null>(null)
  const [activeWorkspace, setActiveWorkspace] = useState<CinemaWorkspaceID>("create")
  const [deliverTimelineID, setDeliverTimelineID] = useState<string | null>(null)
  const editFlushRef = useRef<(() => Promise<void>) | null>(null)
  const changeWorkspace = useCallback((workspace: CinemaWorkspaceID) => {
    if (workspace === activeWorkspace) return
    if (activeWorkspace !== "edit") {
      setActiveWorkspace(workspace)
      return
    }
    void (async () => {
      try {
        await editFlushRef.current?.()
        setActiveWorkspace(workspace)
      } catch {
        // The Edit topbar retains the failed command and exposes Retry.
      }
    })()
  }, [activeWorkspace])
  const [nodes, setNodes] = useState<CinemaFlowNode[]>([])
  const pendingCanvasSelectionNodeIDRef = useRef<string | null>(null)
  const selectedNodeIDs = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes],
  )
  const selectSingleNode = useCallback((nodeID: string | null) => {
    pendingCanvasSelectionNodeIDRef.current = null
    setNodes((current) => current.map((node) => {
      const selected = nodeID !== null && node.id === nodeID
      return node.selected === selected ? node : { ...node, selected }
    }))
    setActiveNodeID(nodeID)
  }, [setActiveNodeID])
  const selectSingleNodeWhenAvailable = useCallback((nodeID: string) => {
    selectSingleNode(nodeID)
    pendingCanvasSelectionNodeIDRef.current = nodeID
  }, [selectSingleNode])
  const [edges, setEdges] = useState<Edge[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [nodeContextMenu, setNodeContextMenu] = useState<NodeContextMenuState>(null)
  const [inspectorNodeID, setInspectorNodeID] = useState<string | null>(null)
  const [activeCanvasPanel, setActiveCanvasPanel] = useState<CanvasPanel | null>(null)
  const [relinkNodeID, setRelinkNodeID] = useState<string | null>(null)
  const [assetLibraryRevealRequest, setAssetLibraryRevealRequest] = useState<AssetLibraryRevealRequest | null>(null)
  const assetLibraryRevealNonceRef = useRef(0)
  const assetRailButtonRef = useRef<HTMLButtonElement>(null)
  const [nodeInputOverlayRoot, setNodeInputOverlayRoot] = useState<HTMLDivElement | null>(null)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pendingSaveCount, setPendingSaveCount] = useState(0)
  const [autoRefreshingTaskIDs, setAutoRefreshingTaskIDs] = useState<string[]>([])
  const [textGenerationOperations, dispatchTextGenerationOperation] = useReducer(nodeOperationReducer, createNodeOperationState())
  const [textGenerationUndo, setTextGenerationUndo] = useState<TextGenerationUndoRecord | null>(null)
  const [connectionErrorKey, setConnectionErrorKey] = useState<TranslationKey | null>(null)
  const [imageGenerationOperations, dispatchImageGenerationOperation] = useReducer(nodeOperationReducer, createNodeOperationState())
  const [videoGenerationOperations, dispatchVideoGenerationOperation] = useReducer(nodeOperationReducer, createNodeOperationState())
  const [imageImportNodeIDs, setImageImportNodeIDs] = useState<Set<string>>(() => new Set())
  const [imageImportError, setImageImportError] = useState<{ nodeID: string; message: string } | null>(null)
  const [imageFinalizeNodeIDs, setImageFinalizeNodeIDs] = useState<Set<string>>(() => new Set())
  const [imageFinalizeError, setImageFinalizeError] = useState<{ nodeID: string; message: string } | null>(null)
  const [imageCropNodeID, setImageCropNodeID] = useState<string | null>(null)
  const [imageCropError, setImageCropError] = useState<{ nodeID: string; message: string } | null>(null)
  const saveStateRef = useRef<SaveState>("idle")
  const canvasRevisionRef = useRef(0)
  const commandQueueRef = useRef<CinemaCommandQueue | null>(null)
  const autoRefreshInFlightRef = useRef(false)
  const nodePatchTimersRef = useRef(new Map<string, number>())
  const nodePatchQueueRef = useRef(new Map<string, CinemaNodePatch>())
  const editingNodeIDsRef = useRef(new Set<string>())
  const deferredCanvasWhileEditingRef = useRef<CinemaCanvasDocument | null>(null)
  const eventCursorRef = useRef<number | null>(null)
  const nodePointerPaneClickGuardRef = useRef<{ x: number; y: number; expiresAt: number } | null>(null)
  const nodePointerPaneClickGuardTimerRef = useRef<number | null>(null)
  const pendingPointerSelectionRef = useRef<{ nodeID: string; selectedNodeIDs: Set<string> } | null>(null)
  const latestNodeDeletionRequestIDRef = useRef(0)
  const queuedNodeDeletionErrorRef = useRef<string | null>(null)

  useEffect(() => () => {
    if (nodePointerPaneClickGuardTimerRef.current !== null) {
      window.clearTimeout(nodePointerPaneClickGuardTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!textGenerationUndo) return
    const timeoutID = window.setTimeout(
      () => setTextGenerationUndo((current) => current === textGenerationUndo ? null : current),
      Math.max(0, textGenerationUndo.expiresAt - Date.now()),
    )
    return () => window.clearTimeout(timeoutID)
  }, [textGenerationUndo])

  useEffect(() => {
    if (!connectionErrorKey) return
    const timeoutID = window.setTimeout(() => setConnectionErrorKey(null), 4_000)
    return () => window.clearTimeout(timeoutID)
  }, [connectionErrorKey])

  const applyCanvas = useCallback((canvas: CinemaCanvasDocument) => {
    canvasRevisionRef.current = canvas.revision ?? 0
    commandQueueRef.current?.syncRevision(canvasRevisionRef.current)
    setNodes((current) => {
      const pendingNodeID = pendingCanvasSelectionNodeIDRef.current
      const next = preserveNodeSelection(current, toFlowNodes(canvas), pendingNodeID)
      if (!pendingNodeID || !next.some((node) => node.id === pendingNodeID)) return next

      pendingCanvasSelectionNodeIDRef.current = null
      return next
    })
    const videoNodeIDs = new Set(canvas.nodes.filter((node) => node.type === "video").map((node) => node.id))
    setEdges(canvas.edges.map((edge) => videoNodeIDs.has(edge.target)
      ? normalizeVideoTargetEdgeHandle(edge)
      : edge
    ))
    saveStateRef.current = "saved"
    setSaveState("saved")
    setSaveError(null)
  }, [])

  const commandQueue = useMemo(() => new CinemaCommandQueue({
    initialRevision: canvasRevisionRef.current,
    send: (command) => requestJson<CinemaCommandResult>(
      agentBaseURL,
      `/api/cinema/projects/${encodeURIComponent(projectID)}/commands`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      },
    ),
    fetchLatestCanvas: () => requestJson<CinemaCanvasDocument>(
      agentBaseURL,
      `/api/cinema/projects/${encodeURIComponent(projectID)}/canvas`,
    ),
    isRevisionConflict: (error) => (
      error instanceof CinemaRequestError
      && error.status === 409
      && error.code === "CINEMA_CANVAS_REVISION_CONFLICT"
    ),
    onResult: (result, pendingCount) => {
      canvasRevisionRef.current = result.canvas.revision ?? canvasRevisionRef.current
      if (
        pendingCount > 0
        || nodePatchQueueRef.current.size > 0
        || nodePatchTimersRef.current.size > 0
      ) return

      if (editingNodeIDsRef.current.size > 0) {
        deferredCanvasWhileEditingRef.current = result.canvas
        return
      }

      deferredCanvasWhileEditingRef.current = null
      applyCanvas(result.canvas)
    },
    onSnapshot: (snapshot) => {
      setPendingSaveCount(snapshot.pendingCount)
      if (snapshot.status === "error") {
        saveStateRef.current = "error"
        setSaveState("error")
        setSaveError(snapshot.error instanceof Error ? snapshot.error.message : "保存失败")
        return
      }

      if (snapshot.status === "saving") {
        saveStateRef.current = "saving"
        setSaveState("saving")
        setSaveError(null)
        return
      }

      const hasDrafts = nodePatchQueueRef.current.size > 0 || nodePatchTimersRef.current.size > 0
      saveStateRef.current = hasDrafts ? "dirty" : "saved"
      setSaveState(saveStateRef.current)
      if (!hasDrafts) setSaveError(null)
    },
  }), [agentBaseURL, applyCanvas, projectID])
  commandQueueRef.current = commandQueue

  const applyCanvasWhenSafe = useCallback((canvas: CinemaCanvasDocument) => {
    const incomingRevision = canvas.revision ?? 0
    if (incomingRevision < canvasRevisionRef.current) return false
    canvasRevisionRef.current = incomingRevision
    commandQueue.syncRevision(canvasRevisionRef.current)
    if (
      commandQueue.hasPendingCommands()
      || nodePatchQueueRef.current.size > 0
      || nodePatchTimersRef.current.size > 0
      || editingNodeIDsRef.current.size > 0
    ) {
      deferredCanvasWhileEditingRef.current = canvas
      return false
    }
    deferredCanvasWhileEditingRef.current = null
    applyCanvas(canvas)
    return true
  }, [applyCanvas, commandQueue])

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
  const workflowProviderIDs = (providersQuery.data ?? [])
    .filter((provider) => provider.manifest.capabilities?.workflowDiscovery)
    .map((provider) => provider.manifest.id)
  const workflowCatalogsQuery = useQuery({
    queryKey: ["cinema-provider-workflows", agentBaseURL, workflowProviderIDs],
    enabled: Boolean(projectID)
      && projectQuery.data?.initialized === true
      && workflowProviderIDs.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    queryFn: () => Promise.all(workflowProviderIDs.map((providerID) =>
      requestJson<CinemaProviderWorkflowCatalog>(
        agentBaseURL,
        `/api/cinema/video-providers/${encodeURIComponent(providerID)}/workflows`,
      )
    )),
  })
  const refetchWorkflowCatalogs = workflowCatalogsQuery.refetch
  const refreshWorkflowsMutation = useMutation({
    mutationFn: (providerID: string) =>
      requestJson<CinemaProviderWorkflowCatalog>(
        agentBaseURL,
        `/api/cinema/video-providers/${encodeURIComponent(providerID)}/workflows/refresh`,
        { method: "POST" },
      ),
    onSuccess: async () => {
      await Promise.all([
        refetchWorkflowCatalogs(),
        refetchImageModels(),
        refetchProviders(),
      ])
    },
  })
  const workflowCatalogs = workflowCatalogsQuery.data ?? []
  const videoProviders = useMemo(
    () => providersWithDiscoveredWorkflows(providersQuery.data ?? [], workflowCatalogs),
    [providersQuery.data, workflowCatalogs],
  )

  const tasksQuery = useQuery({
    queryKey: ["cinema-generation-tasks", agentBaseURL, projectID],
    enabled: Boolean(projectID) && projectQuery.data?.initialized === true,
    queryFn: () => requestJson<CinemaGenerationTask[]>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}/generation-tasks`),
  })
  const refetchTasks = tasksQuery.refetch

  const commandMutation = useMutation({
    mutationFn: (command: CinemaCommandDraft) => commandQueue.enqueue(command),
  })
  const assetLibraryEnabled = projectQuery.data?.capabilities?.assetLibrary !== false
  const timelineEditingAvailable = projectQuery.data?.capabilities?.timelineEditing === true
    || import.meta.env.VITE_CINEMA_EDIT_DEV === "1"
  const timelineDeliveryCapabilityAvailable = projectQuery.data?.capabilities?.timelineDelivery === true
  const timelineDeliveryDevelopmentOverride = import.meta.env.VITE_CINEMA_DELIVER_DEV === "1"
  const timelineDeliveryBetaAvailable = import.meta.env.VITE_CINEMA_DELIVER_BETA !== "0"
  const timelineDeliveryAvailable = timelineDeliveryCapabilityAvailable
    || timelineDeliveryDevelopmentOverride
    || timelineDeliveryBetaAvailable
  const availableWorkspaces = {
    edit: timelineEditingAvailable,
    deliver: timelineDeliveryAvailable,
  } as const

  const createNodeFromAssetMutation = useMutation({
    scope: { id: `cinema-create-node-from-asset:${projectID}` },
    mutationFn: async ({
      assetRef,
      position,
      nodeID,
    }: {
      assetRef: CinemaAssetLocator
      position: { x: number; y: number }
      nodeID: string
    }) => {
      const result = await commandQueue.enqueue({
        id: makeCommandID("create-node-from-asset"),
        type: "create-node-from-asset",
        actor: "cinema-web",
        nodeID,
        assetRef,
        position,
      })
      return { result, nodeID }
    },
    onSuccess: ({ nodeID }) => {
      selectSingleNode(nodeID)
    },
    onError: (error) => {
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(error instanceof Error ? error.message : "Could not add the asset to the Canvas")
    },
  })

  const relinkNodeAssetMutation = useMutation({
    scope: { id: `cinema-relink-node-asset:${projectID}` },
    mutationFn: async ({
      assetRef,
      nodeID,
    }: {
      assetRef: CinemaAssetLocator
      nodeID: string
    }) => {
      const result = await commandQueue.enqueue({
        id: makeCommandID("relink-node-asset"),
        type: "relink-node-asset",
        actor: "cinema-web",
        nodeID,
        assetRef,
      })
      return { result, nodeID }
    },
    onSuccess: ({ nodeID }) => {
      selectSingleNode(nodeID)
      setRelinkNodeID(null)
    },
    onError: (error) => {
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(error instanceof Error ? error.message : "Could not relink the asset")
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
    // TanStack retries the same variables object, so the operationID created by
    // the user's click remains stable across a transient network retry.
    retry: (failureCount, error) => (
      failureCount < 1
      && (!(error instanceof CinemaRequestError) || error.status >= 500)
    ),
    onMutate: ({ draftNodeID }) => {
      dispatchVideoGenerationOperation({ type: "begin", nodeID: draftNodeID })
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
      if (task.taskNodeID) selectSingleNodeWhenAvailable(task.taskNodeID)
      await refetchRuntimeState()
      saveStateRef.current = "saved"
      setSaveState("saved")
    },
    onError: (error, variables) => {
      const errorCode = error instanceof CinemaRequestError ? error.code : undefined
      const fallbackMessage = error instanceof Error ? error.message : "Task creation failed"
      const message = localizedGenerationError(errorCode, fallbackMessage, t) ?? fallbackMessage
      const failedNode = nodes.find((node) => node.id === variables.draftNodeID)
      if (failedNode) {
        const failedRawData = {
          ...failedNode.data.rawData,
          status: "failed",
          error: message,
          errorCode: errorCode ?? null,
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
                    errorCode: errorCode ?? null,
                  },
                },
              }
              : node
          )
        )
        queueNodePatch(variables.draftNodeID, { data: failedRawData })
      }
      dispatchVideoGenerationOperation({ type: "fail", nodeID: variables.draftNodeID, message })
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(message)
    },
    onSettled: (_data, _error, variables) => {
      dispatchVideoGenerationOperation({ type: "settle", nodeID: variables.draftNodeID })
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
      if (task.taskNodeID) selectSingleNode(task.taskNodeID)
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
      if (task.taskNodeID) selectSingleNode(task.taskNodeID)
      await refetchRuntimeState()
      saveStateRef.current = "saved"
      setSaveState("saved")
    },
    onError: (error) => {
      const errorCode = error instanceof CinemaRequestError ? error.code : undefined
      const fallbackMessage = error instanceof Error ? error.message : "Task cancel failed"
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(localizedGenerationError(errorCode, fallbackMessage, t) ?? fallbackMessage)
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
    setActiveCanvasPanel(null)
    setRelinkNodeID(null)
    setInspectorNodeID(null)
    dispatchTextGenerationOperation({ type: "reset" })
    dispatchImageGenerationOperation({ type: "reset" })
    dispatchVideoGenerationOperation({ type: "reset" })
  }, [agentBaseURL, projectID])

  useEffect(() => {
    if (!assetLibraryEnabled) {
      setActiveCanvasPanel((current) => current === "assets" ? null : current)
      setRelinkNodeID(null)
    }
  }, [assetLibraryEnabled])

  useEffect(() => {
    if (!canvasQuery.data) return
    if (
      editingNodeIDsRef.current.size > 0 ||
      saveStateRef.current === "dirty" ||
      saveStateRef.current === "saving" ||
      commandQueue.hasPendingCommands() ||
      nodePatchQueueRef.current.size > 0 ||
      nodePatchTimersRef.current.size > 0
    ) {
      if (editingNodeIDsRef.current.size > 0) {
        deferredCanvasWhileEditingRef.current = canvasQuery.data
      }
      return
    }
    deferredCanvasWhileEditingRef.current = null
    applyCanvas(canvasQuery.data)
  }, [applyCanvas, canvasQuery.data, commandQueue])

  useEffect(() => () => {
    for (const timer of nodePatchTimersRef.current.values()) window.clearTimeout(timer)
    nodePatchTimersRef.current.clear()
    nodePatchQueueRef.current.clear()
  }, [])

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !commandQueue.hasPendingCommands()
        && nodePatchQueueRef.current.size === 0
        && nodePatchTimersRef.current.size === 0
        && saveStateRef.current !== "dirty"
        && saveStateRef.current !== "saving"
        && saveStateRef.current !== "error"
      ) return

      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [commandQueue])

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

    await commandQueue.enqueue({
      id: makeCommandID("update-node"),
      type: "update-node",
      actor: "cinema-web",
      nodeID,
      patch,
    })
  }, [commandQueue])

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
      const sourceNode = nodes.find((node) => node.id === nodeID)
      const previousText = sourceNode ? readRawString(sourceNode.data.rawData, "text") : ""
      dispatchTextGenerationOperation({ type: "begin", nodeID })
      setTextGenerationUndo(null)
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
      return { previousText }
    },
    onSuccess: async (result, _variables, context) => {
      const generatedNode = result.canvas.nodes.find((node) => node.id === result.nodeID)
      const replacementData = {
        ...(generatedNode?.data ?? {}),
        text: result.generatedText,
        generationPrompt: "",
      }
      const replacementCanvas: CinemaCanvasDocument = {
        ...result.canvas,
        nodes: result.canvas.nodes.map((node) => node.id === result.nodeID
          ? { ...node, data: replacementData }
          : node),
      }
      applyCanvasWhenSafe(replacementCanvas)
      await commandQueue.enqueue({
        id: makeCommandID("update-node"),
        type: "update-node",
        actor: "cinema-web",
        nodeID: result.nodeID,
        patch: { data: replacementData },
      })
      setTextGenerationUndo({
        nodeID: result.nodeID,
        previousText: context?.previousText ?? "",
        generatedText: result.generatedText,
        expiresAt: Date.now() + 8_000,
      })
      selectSingleNode(result.nodeID)
      await refetchRuntimeState()
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : t("text.generationFailed")
      dispatchTextGenerationOperation({ type: "fail", nodeID: variables.nodeID, message })
      if (saveStateRef.current !== "error") {
        saveStateRef.current = nodePatchQueueRef.current.size > 0 || nodePatchTimersRef.current.size > 0 ? "dirty" : "saved"
        setSaveState(saveStateRef.current)
      }
    },
    onSettled: (_data, _error, variables) => {
      dispatchTextGenerationOperation({ type: "settle", nodeID: variables.nodeID })
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
      dispatchImageGenerationOperation({ type: "begin", nodeID })
      setImageImportError((current) => current?.nodeID === nodeID ? null : current)
      setImageFinalizeError((current) => current?.nodeID === nodeID ? null : current)
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: (result) => {
      applyCanvasWhenSafe(result.canvas)
      selectSingleNode(result.nodeID)
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : "Image generation failed"
      dispatchImageGenerationOperation({ type: "fail", nodeID: variables.nodeID, message })
      void refetchCanvas()
      if (saveStateRef.current !== "error") {
        saveStateRef.current = nodePatchQueueRef.current.size > 0 || nodePatchTimersRef.current.size > 0 ? "dirty" : "saved"
        setSaveState(saveStateRef.current)
      }
    },
    onSettled: (_data, _error, variables) => {
      dispatchImageGenerationOperation({ type: "settle", nodeID: variables.nodeID })
    },
  })

  const importImageMutation = useMutation({
    mutationFn: async ({ nodeID, file }: { nodeID: string; file: File }) => {
      const sourceNode = nodes.find((node) => node.id === nodeID)
      if (!sourceNode || sourceNode.data.cinemaType !== "image") {
        throw new Error("Image node is unavailable.")
      }
      if (deriveCinemaImageNodeState(sourceNode.data.rawData, readRawString(sourceNode.data.rawData, "status")) !== "empty") {
        throw new Error("This image node already has content.")
      }
      await flushNodePatch(nodeID)
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
      const nextRawData = canonicalizeCinemaImageNodeData(sourceNode.data.rawData)
      for (const key of [
        "candidateAssets",
        "selectedCandidateAssetID",
        "prompt",
        "style",
        "size",
        "count",
        "model",
        "providerID",
        "modelID",
        "mode",
        "taskID",
        "progress",
        "parameters",
        "generatedAt",
        "error",
        "sourceImageAsset",
        "sourceImageAssets",
        "sourceImageAssetID",
        "sourceImageAssetIDs",
        "sourceImageAssetKey",
        "sourceImageAssetKeys",
        "sourceImagePath",
        "sourceImagePaths",
        "sourceImageSelectionMode",
        "sourceNodeIDs",
        "sourceTextPrompts",
        "hiddenSourceImageAssetKeys",
      ]) {
        delete nextRawData[key]
      }
      Object.assign(nextRawData, {
        asset: result.asset,
        sourceKind: "upload",
        sourceFileName: file.name,
        importedAt: new Date().toISOString(),
        status: "ready",
      })
      await commandQueue.enqueue({
        id: makeCommandID("update-node"),
        type: "update-node",
        actor: "cinema-web",
        nodeID,
        patch: { data: nextRawData },
      })
      return { nodeID }
    },
    onMutate: ({ nodeID }) => {
      setImageImportNodeIDs((current) => new Set(current).add(nodeID))
      setImageImportError(null)
      dispatchImageGenerationOperation({ type: "clear-error", nodeID })
      setImageFinalizeError((current) => current?.nodeID === nodeID ? null : current)
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: ({ nodeID }) => {
      selectSingleNode(nodeID)
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : "Image import failed"
      setImageImportError({ nodeID: variables.nodeID, message })
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(message)
    },
    onSettled: (_data, _error, variables) => {
      setImageImportNodeIDs((current) => {
        const next = new Set(current)
        next.delete(variables.nodeID)
        return next
      })
    },
  })

  const finalizeImageCandidateMutation = useMutation({
    mutationFn: async ({ nodeID, candidateID }: { nodeID: string; candidateID: string }) => {
      const sourceNode = nodes.find((node) => node.id === nodeID)
      if (!sourceNode || sourceNode.data.cinemaType !== "image") {
        throw new Error("Image node is unavailable.")
      }
      if (deriveCinemaImageNodeState(sourceNode.data.rawData) !== "choosing") {
        throw new Error("This image node is no longer waiting for a choice.")
      }
      const nextRawData = finalizeCinemaImageCandidate(sourceNode.data.rawData, candidateID)
      if (!readCinemaImageFinalAsset(nextRawData)) {
        throw new Error("The selected image candidate is unavailable.")
      }

      await flushNodePatch(nodeID)
      await commandQueue.enqueue({
        id: makeCommandID("update-node"),
        type: "update-node",
        actor: "cinema-web",
        nodeID,
        patch: { data: nextRawData },
      })
      return { nodeID }
    },
    onMutate: ({ nodeID }) => {
      setImageFinalizeNodeIDs((current) => new Set(current).add(nodeID))
      setImageFinalizeError(null)
      dispatchImageGenerationOperation({ type: "clear-error", nodeID })
      setImageImportError((current) => current?.nodeID === nodeID ? null : current)
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: ({ nodeID }) => {
      selectSingleNode(nodeID)
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : "Image selection failed"
      setImageFinalizeError({ nodeID: variables.nodeID, message })
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(message)
    },
    onSettled: (_data, _error, variables) => {
      setImageFinalizeNodeIDs((current) => {
        const next = new Set(current)
        next.delete(variables.nodeID)
        return next
      })
    },
  })

  const createCroppedImageMutation = useMutation({
    mutationFn: async ({ nodeID, crop }: { nodeID: string; crop: ImageCropRect }) => {
      const sourceNode = nodes.find((node) => node.id === nodeID)
      if (!sourceNode || sourceNode.data.cinemaType !== "image") {
        throw new Error("Source image node is unavailable.")
      }
      const asset = readFinalImageAsset(sourceNode.data.rawData)
      const sourceAssetRef = cinemaAssetRefFromNodeData(sourceNode.data.rawData)
      const libraryAssetRef = sourceAssetRef?.snapshot.kind === "image" ? sourceAssetRef : null
      if (!asset && !libraryAssetRef) {
        throw new Error("Source image asset is unavailable.")
      }
      if (!agentBaseURL || !projectID) throw new Error("Cinema project is unavailable.")

      const pendingNodeIDs = new Set([
        ...nodePatchQueueRef.current.keys(),
        ...nodePatchTimersRef.current.keys(),
      ])
      for (const pendingNodeID of pendingNodeIDs) {
        await flushNodePatch(pendingNodeID)
      }

      const sourceSize = asset?.width && asset.height
        ? { width: asset.width, height: asset.height }
        : libraryAssetRef?.snapshot.width && libraryAssetRef.snapshot.height
          ? { width: libraryAssetRef.snapshot.width, height: libraryAssetRef.snapshot.height }
          : null
      const normalizedCrop = sourceSize
        ? normalizeImageCropRect(crop, sourceSize.width, sourceSize.height)
        : crop
      const previewURL = libraryAssetRef
        ? cinemaAssetURL(agentBaseURL, libraryAssetRef, "preview")
        : projectAssetPreviewURL(agentBaseURL, projectID, asset!.path)
      const croppedImage = await cropImageURLToPngDataBase64(previewURL, normalizedCrop, sourceSize)
      const sourceFileName = readRawString(sourceNode.data.rawData, "sourceFileName", sourceNode.data.title)
      const nextTitle = croppedImageTitle(sourceFileName || sourceNode.data.title)
      const nextFileName = `${nextTitle}.png`

      if (libraryAssetRef) {
        const api = createAssetLibraryApi(agentBaseURL, projectID, libraryAssetRef.scope)
        let sourceDetail = await api.getAsset(libraryAssetRef.assetID)
        if (sourceDetail.asset.kind !== "image" || sourceDetail.asset.status !== "ready") {
          throw new Error("The source image is unavailable. Relink or repair it before cropping.")
        }
        const file = dataBase64ToFile(croppedImage.dataBase64, nextFileName, "image/png")
        const operationID = makeAssetLibraryOperationID("crop")
        const upload = (baseRevision: number) => api.upload({
          file,
          folderID: sourceDetail.asset.folderID,
          operationID,
          baseRevision,
          source: "crop",
        })
        let uploaded
        try {
          uploaded = await upload(sourceDetail.revision)
        } catch (error) {
          if (!(error instanceof AssetLibraryApiError) || error.status !== 409) throw error
          sourceDetail = await api.getAsset(libraryAssetRef.assetID)
          if (sourceDetail.asset.kind !== "image" || sourceDetail.asset.status !== "ready") {
            throw new Error("The source image changed while the crop was being prepared.")
          }
          uploaded = await upload(sourceDetail.revision)
        }

        const nextNodeID = makeAssetNodeID()
        const created = await createNodeFromAssetMutation.mutateAsync({
          assetRef: { scope: libraryAssetRef.scope, assetID: uploaded.asset.id },
          position: {
            x: sourceNode.position.x + IMAGE_CROP_NODE_OFFSET_X,
            y: sourceNode.position.y,
          },
          nodeID: nextNodeID,
        })
        await commandQueue.enqueue({
          id: makeCommandID("connect-nodes"),
          type: "connect-nodes",
          actor: "cinema-web",
          edge: {
            id: `edge-${sourceNode.id}-${nextNodeID}-${Date.now().toString(36)}`,
            source: sourceNode.id,
            target: nextNodeID,
            sourceHandle: "output",
            targetHandle: "input",
            data: { derivedOperation: "crop" },
          },
        })
        return { nodeID: created.nodeID }
      }

      const importResult = await requestJson<CinemaImportedImageAssetResult>(
        agentBaseURL,
        `/api/cinema/projects/${encodeURIComponent(projectID)}/assets/imports`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName: nextFileName,
            mimeType: "image/png",
            dataBase64: croppedImage.dataBase64,
          }),
        },
      )
      const nextNode = createImageAssetNode(
        importResult.asset,
        nextFileName,
        {
          x: sourceNode.position.x + IMAGE_CROP_NODE_OFFSET_X,
          y: sourceNode.position.y,
        },
        {
          title: nextTitle,
          rawDataPatch: {
            derivedFromNodeID: sourceNode.id,
            derivedFromAssetID: asset!.id,
            derivedOperation: "crop",
            crop: normalizedCrop,
            cropOutputSize: croppedImage.outputSize,
          },
        },
      )

      await commandQueue.enqueue({
        id: makeCommandID("create-node"),
        type: "create-node",
        actor: "cinema-web",
        node: toCanvasNode(nextNode),
      })
      await commandQueue.enqueue({
        id: makeCommandID("connect-nodes"),
        type: "connect-nodes",
        actor: "cinema-web",
        edge: {
          id: `edge-${sourceNode.id}-${nextNode.id}-${Date.now().toString(36)}`,
          source: sourceNode.id,
          target: nextNode.id,
          sourceHandle: "output",
          targetHandle: "input",
          data: {
            derivedOperation: "crop",
          },
        },
      })
      return { nodeID: nextNode.id }
    },
    onMutate: ({ nodeID }) => {
      setImageCropNodeID(nodeID)
      setImageCropError(null)
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: ({ nodeID }) => {
      selectSingleNode(nodeID)
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : "Image crop failed"
      setImageCropError({ nodeID: variables.nodeID, message })
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(message)
    },
    onSettled: () => {
      setImageCropNodeID(null)
    },
  })

  useEffect(() => {
    if (!projectID || !canvasQuery.data || projectQuery.data?.initialized !== true) return
    let cancelled = false
    let intervalID: number | null = null

    async function pollEvents() {
      if (
        cancelled ||
        editingNodeIDsRef.current.size > 0 ||
        commandQueue.hasPendingCommands() ||
        saveStateRef.current === "dirty" ||
        saveStateRef.current === "saving" ||
        saveStateRef.current === "error"
      ) {
        return
      }

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
  }, [agentBaseURL, canvasQuery.data, commandQueue, projectID, projectQuery.data?.initialized, refetchCanvas, refetchTasks])

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
        editingNodeIDsRef.current.size > 0 ||
        commandQueue.hasPendingCommands() ||
        saveStateRef.current === "dirty" ||
        saveStateRef.current === "saving" ||
        saveStateRef.current === "error"
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
  }, [activeGenerationTaskIDs, activeGenerationTaskIDsKey, agentBaseURL, commandQueue, projectID, projectQuery.data?.initialized, refetchRuntimeState])

  const deleteNodesMutation = useMutation({
    scope: { id: `cinema-node-deletions:${projectID}` },
    mutationFn: async ({ requestID, nodeIDs: requestedNodeIDs }: { requestID: number; nodeIDs: string[] }) => {
      const nodeIDs = [...new Set(requestedNodeIDs)]
      for (const nodeID of nodeIDs) {
        await commandQueue.enqueue({
          id: makeCommandID("delete-node"),
          type: "delete-node",
          actor: "cinema-web",
          nodeID,
        })
      }

      return { requestID, nodeIDs }
    },
    onMutate: ({ nodeIDs }) => {
      for (const nodeID of nodeIDs) {
        const timerID = nodePatchTimersRef.current.get(nodeID)
        if (timerID !== undefined) window.clearTimeout(timerID)
        nodePatchTimersRef.current.delete(nodeID)
        nodePatchQueueRef.current.delete(nodeID)
      }
      saveStateRef.current = "saving"
      setSaveState("saving")
      setSaveError(null)
    },
    onSuccess: ({ requestID }) => {
      if (requestID !== latestNodeDeletionRequestIDRef.current) return
      queuedNodeDeletionErrorRef.current = null
    },
    onError: (error, { requestID }) => {
      const message = error instanceof Error ? error.message : "Node deletion failed"
      if (requestID !== latestNodeDeletionRequestIDRef.current) {
        queuedNodeDeletionErrorRef.current = message
        return
      }
      queuedNodeDeletionErrorRef.current = null
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(message)
    },
  })
  const mutateNodeDeletions = deleteNodesMutation.mutate
  const submitNodeDeletions = useCallback((nodeIDs: string[]) => {
    const requestID = latestNodeDeletionRequestIDRef.current + 1
    latestNodeDeletionRequestIDRef.current = requestID
    mutateNodeDeletions({ requestID, nodeIDs })
  }, [mutateNodeDeletions])

  const onNodesChange = useCallback((changes: NodeChange<CinemaFlowNode>[]) => {
    const removedNodeIDs = changes
      .filter((change): change is Extract<NodeChange<CinemaFlowNode>, { type: "remove" }> => change.type === "remove")
      .map((change) => change.id)
    const settledPositionChanges = changes.filter(
      (change): change is Extract<NodeChange<CinemaFlowNode>, { type: "position" }> =>
        change.type === "position" && change.dragging !== true && Boolean(change.position),
    )
    if (isMutationChange(changes)) {
      saveStateRef.current = "dirty"
      setSaveState("dirty")
    }
    setNodes((current) => applyNodeChanges(changes, current))
    for (const change of settledPositionChanges) {
      if (change.position) queueNodePatch(change.id, { position: change.position })
    }
    if (removedNodeIDs.length > 0) {
      if (activeNodeID && removedNodeIDs.includes(activeNodeID)) setActiveNodeID(null)
      setInspectorNodeID((current) => current && removedNodeIDs.includes(current) ? null : current)
      setNodeContextMenu(null)
      submitNodeDeletions(removedNodeIDs)
    }
  }, [activeNodeID, queueNodePatch, setActiveNodeID, submitNodeDeletions])

  const deleteNodes = useCallback((nodeIDs: string[]) => {
    const uniqueNodeIDs = [...new Set(nodeIDs)]
    if (uniqueNodeIDs.length === 0) return
    onNodesChange(uniqueNodeIDs.map((id) => ({ id, type: "remove" })))
  }, [onNodesChange])

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
    const validation = validateCinemaConnection(connection, nodes, edges)
    if (!validation.valid) {
      setConnectionErrorKey(validation.reason)
      return
    }
    if (!connection.source || !connection.target) return
    const sourceType = nodes.find((node) => node.id === connection.source)?.data.cinemaType
    const targetNode = nodes.find((node) => node.id === connection.target)
    const targetType = targetNode?.data.cinemaType
    const edgeID = `edge-${connection.source}-${connection.target}-${Date.now().toString(36)}`
    const pendingEdge = {
      id: edgeID,
      source: connection.source,
      target: connection.target,
      ...(connection.sourceHandle ? { sourceHandle: connection.sourceHandle } : {}),
      ...(connection.targetHandle ? { targetHandle: connection.targetHandle } : {}),
    }
    const targetInput = targetType === "video"
      ? edgeTargetVideoInput(
        pendingEdge,
        nodes,
        [...edges, pendingEdge],
        targetNode ? videoInputControlsForNode(targetNode, videoProviders) : undefined,
      )
      : null
    if (targetType === "video" && !targetInput) {
      setConnectionErrorKey("connection.invalid")
      return
    }
    const targetImageIndex = sourceType === "image"
      ? targetInput?.slot === "startFrame"
        ? 0
        : targetInput?.slot === "endFrame"
          ? 1
          : null
      : null
    const edgeData = {
      ...(targetInput?.slot ? { targetSlot: targetInput.slot } : {}),
      ...(targetInput?.role ? { targetRole: targetInput.role } : {}),
      ...(targetInput?.inputKey ? { targetInputKey: targetInput.inputKey } : {}),
      ...(targetImageIndex !== null ? { targetImageIndex } : {}),
    }
    const edge = {
      ...pendingEdge,
      ...(Object.keys(edgeData).length > 0 ? { data: edgeData } : {}),
    }
    commandMutation.mutate({
      id: makeCommandID("connect-nodes"),
      type: "connect-nodes",
      actor: "cinema-web",
      edge,
    })
  }, [commandMutation, edges, nodes, videoProviders])

  const isValidConnection = useCallback((connection: Connection | Edge) => (
    validateCinemaConnection(connection, nodes, edges).valid
  ), [edges, nodes])

  const onConnectEnd: OnConnectEnd = useCallback((_event, state) => {
    if (state.isValid !== false || !state.fromNode || !state.toNode) return
    const startsAtSource = state.fromHandle?.type === "source"
    const validation = validateCinemaConnection({
      source: startsAtSource ? state.fromNode.id : state.toNode.id,
      target: startsAtSource ? state.toNode.id : state.fromNode.id,
      sourceHandle: startsAtSource ? state.fromHandle?.id ?? null : state.toHandle?.id ?? null,
      targetHandle: startsAtSource ? state.toHandle?.id ?? null : state.fromHandle?.id ?? null,
    }, nodes, edges)
    if (!validation.valid) setConnectionErrorKey(validation.reason)
  }, [edges, nodes])

  const addNode = useCallback((type: CinemaNodeType, position: { x: number; y: number }) => {
    const next = createNode(type, position)
    commandMutation.mutate({
      id: makeCommandID("create-node"),
      type: "create-node",
      actor: "cinema-web",
      node: toCanvasNode(next),
    }, {
      onSuccess: () => selectSingleNode(next.id),
    })
  }, [commandMutation, selectSingleNode])

  const addAssetToCanvas = useCallback(async (
    assetRef: CinemaAssetLocator,
    position?: { x: number; y: number },
  ) => {
    const pendingNodeIDs = new Set([
      ...nodePatchQueueRef.current.keys(),
      ...nodePatchTimersRef.current.keys(),
    ])
    for (const pendingNodeID of pendingNodeIDs) await flushNodePatch(pendingNodeID)

    let targetPosition = position
    if (!targetPosition) {
      const canvasElement = document.querySelector<HTMLElement>(".cinema-canvas")
      const bounds = canvasElement?.getBoundingClientRect()
      targetPosition = (flowInstance ?? reactFlow).screenToFlowPosition({
        x: bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2,
        y: bounds ? bounds.top + bounds.height / 2 : window.innerHeight / 2,
      })
    }
    const nodeID = makeAssetNodeID()
    await createNodeFromAssetMutation.mutateAsync({ assetRef, position: targetPosition, nodeID })
    return nodeID
  }, [createNodeFromAssetMutation, flowInstance, flushNodePatch, reactFlow])

  const handleAssetLibraryAdd = useCallback(async ({ scope, asset }: AssetLibraryAddRequest) => {
    if (relinkNodeID) {
      const targetNode = nodes.find((node) => node.id === relinkNodeID)
      if (!targetNode) throw new Error("The node selected for relinking no longer exists.")
      if (targetNode.data.cinemaType !== asset.kind) {
        throw new Error(`Choose a ${targetNode.data.cinemaType} asset to relink this node.`)
      }
      await relinkNodeAssetMutation.mutateAsync({
        nodeID: relinkNodeID,
        assetRef: { scope, assetID: asset.id },
      })
      return
    }
    await addAssetToCanvas({ scope, assetID: asset.id })
  }, [addAssetToCanvas, nodes, relinkNodeAssetMutation, relinkNodeID])

  const beginRelinkAsset = useCallback((nodeID: string) => {
    setRelinkNodeID(nodeID)
    setInspectorNodeID(null)
    setActiveCanvasPanel("assets")
    selectSingleNode(nodeID)
  }, [selectSingleNode])

  const revealAssetInLibrary = useCallback((assetRef: CinemaAssetLocator) => {
    assetLibraryRevealNonceRef.current += 1
    setAssetLibraryRevealRequest({
      requestID: `deliver-output-${assetLibraryRevealNonceRef.current}`,
      assetRef: { scope: assetRef.scope, assetID: assetRef.assetID },
    })
    setRelinkNodeID(null)
    setInspectorNodeID(null)
    setContextMenu(null)
    setNodeContextMenu(null)
    setActiveCanvasPanel("assets")
    setActiveWorkspace("create")
  }, [])

  const handleAssetLibraryRevealRequest = useCallback((requestID: string) => {
    setAssetLibraryRevealRequest((current) => current?.requestID === requestID ? null : current)
  }, [])

  const onCanvasAssetDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes(CINEMA_ASSET_DRAG_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }, [])

  const onCanvasAssetDrop = useCallback((event: ReactDragEvent<HTMLElement>) => {
    const assetRef = cinemaAssetLocatorFromDragPayload(event.dataTransfer.getData(CINEMA_ASSET_DRAG_MIME))
    if (!assetRef) return
    event.preventDefault()
    event.stopPropagation()
    const position = (flowInstance ?? reactFlow).screenToFlowPosition({ x: event.clientX, y: event.clientY })
    void addAssetToCanvas(assetRef, position)
  }, [addAssetToCanvas, flowInstance, reactFlow])

  const toggleCanvasPanel = useCallback((panel: CanvasPanel) => {
    setActiveCanvasPanel((current) => {
      const next = current === panel ? null : panel
      if (next) setInspectorNodeID(null)
      if (next !== "assets") setRelinkNodeID(null)
      return next
    })
  }, [])

  const closeAssetPanel = useCallback(() => {
    setActiveCanvasPanel((current) => current === "assets" ? null : current)
    setRelinkNodeID(null)
    setAssetLibraryRevealRequest(null)
    window.requestAnimationFrame(() => assetRailButtonRef.current?.focus({ preventScroll: true }))
  }, [])

  const onPaneContextMenu = useCallback((event: globalThis.MouseEvent | ReactMouseEvent<Element>) => {
    if (isEditableElement(event.target)) return
    event.preventDefault()
    setNodeContextMenu(null)
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

  const onNodeContextMenu = useCallback((event: ReactMouseEvent<Element>, node: CinemaFlowNode) => {
    if (isEditableElement(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    pendingCanvasSelectionNodeIDRef.current = null
    setContextMenu(null)
    if (node.selected && selectedNodeIDs.length > 1) {
      setNodeContextMenu({
        kind: "selection",
        x: event.clientX,
        y: event.clientY,
        nodeIDs: selectedNodeIDs,
      })
      return
    }
    if (node.selected) setActiveNodeID(node.id)
    else selectSingleNode(node.id)
    setInspectorNodeID((current) => current === node.id ? current : null)
    setNodeContextMenu({
      kind: "node",
      x: event.clientX,
      y: event.clientY,
      nodeID: node.id,
    })
  }, [selectSingleNode, selectedNodeIDs, setActiveNodeID])

  const onSelectionContextMenu = useCallback((event: ReactMouseEvent<Element>, selectedNodes: CinemaFlowNode[]) => {
    if (isEditableElement(event.target)) return
    const nodeIDs = [...new Set(selectedNodes.map((node) => node.id))]
    if (nodeIDs.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    pendingCanvasSelectionNodeIDRef.current = null
    setContextMenu(null)
    setNodeContextMenu(nodeIDs.length === 1
      ? {
          kind: "node",
          x: event.clientX,
          y: event.clientY,
          nodeID: nodeIDs[0]!,
        }
      : {
          kind: "selection",
          x: event.clientX,
          y: event.clientY,
          nodeIDs,
        })
  }, [])

  const selectNodeOnly = useCallback((nodeID: string) => {
    setContextMenu(null)
    setNodeContextMenu(null)
    selectSingleNode(nodeID)
    setInspectorNodeID((current) => current === nodeID ? current : null)
  }, [selectSingleNode])

  const setNodeInputEditing = useCallback((nodeID: string, isEditing: boolean) => {
    const editingNodeIDs = editingNodeIDsRef.current
    const wasEditing = editingNodeIDs.has(nodeID)

    if (isEditing) {
      if (wasEditing) return
      editingNodeIDs.add(nodeID)
    } else {
      if (!wasEditing) return
      editingNodeIDs.delete(nodeID)
    }

    if (
      !isEditing &&
      editingNodeIDs.size === 0 &&
      !commandQueue.hasPendingCommands() &&
      saveStateRef.current !== "dirty" &&
      saveStateRef.current !== "saving" &&
      saveStateRef.current !== "error" &&
      nodePatchQueueRef.current.size === 0 &&
      nodePatchTimersRef.current.size === 0
    ) {
      const deferredCanvas = deferredCanvasWhileEditingRef.current
      if (deferredCanvas) {
        applyCanvasWhenSafe(deferredCanvas)
      }
    }
  }, [applyCanvasWhenSafe, commandQueue])

  const clearNodePointerPaneClickGuard = useCallback(() => {
    nodePointerPaneClickGuardRef.current = null
    if (nodePointerPaneClickGuardTimerRef.current !== null) {
      window.clearTimeout(nodePointerPaneClickGuardTimerRef.current)
      nodePointerPaneClickGuardTimerRef.current = null
    }
  }, [])

  const scheduleNodePointerPaneClickGuardClear = useCallback((event: PointerEvent) => {
    clearNodePointerPaneClickGuard()
    nodePointerPaneClickGuardRef.current = {
      x: event.clientX,
      y: event.clientY,
      expiresAt: performance.now() + NODE_POINTER_PANE_CLICK_GUARD_MS,
    }
    nodePointerPaneClickGuardTimerRef.current = window.setTimeout(() => {
      clearNodePointerPaneClickGuard()
    }, NODE_POINTER_PANE_CLICK_GUARD_MS)
  }, [clearNodePointerPaneClickGuard])

  const activateNodeFromPointer = useCallback((nodeID: string, pointerID: number, multiSelect: boolean) => {
    clearNodePointerPaneClickGuard()
    pendingCanvasSelectionNodeIDRef.current = null
    setContextMenu(null)
    setNodeContextMenu(null)
    const currentSelectedNodeIDs = nodes.filter((node) => node.selected).map((node) => node.id)
    if (multiSelect) {
      pendingPointerSelectionRef.current = {
        nodeID,
        selectedNodeIDs: toggleNodeSelection(currentSelectedNodeIDs, nodeID),
      }
      setActiveNodeID(null)
    } else if (shouldDeferSingleSelection(currentSelectedNodeIDs, nodeID)) {
      // Keep the group selected while the pointer may become a drag. A plain click
      // still collapses to this node in onNodeClick after React Flow confirms it was not a drag.
      pendingPointerSelectionRef.current = { nodeID, selectedNodeIDs: new Set([nodeID]) }
    } else {
      pendingPointerSelectionRef.current = { nodeID, selectedNodeIDs: new Set([nodeID]) }
      selectSingleNode(nodeID)
    }

    const stopGuardAfterPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerID) return
      window.removeEventListener("pointerup", stopGuardAfterPointerEnd)
      window.removeEventListener("pointercancel", stopGuardAfterPointerEnd)
      scheduleNodePointerPaneClickGuardClear(event)
    }

    window.addEventListener("pointerup", stopGuardAfterPointerEnd)
    window.addEventListener("pointercancel", stopGuardAfterPointerEnd)
  }, [clearNodePointerPaneClickGuard, nodes, scheduleNodePointerPaneClickGuardClear, selectSingleNode, setActiveNodeID])

  const onNodeClick = useCallback((_event: ReactMouseEvent<Element>, node: CinemaFlowNode) => {
    const pendingSelection = pendingPointerSelectionRef.current
    pendingPointerSelectionRef.current = null
    if (!pendingSelection || pendingSelection.nodeID !== node.id) return

    setNodes((current) => current.map((currentNode) => {
      const selected = pendingSelection.selectedNodeIDs.has(currentNode.id)
      return currentNode.selected === selected ? currentNode : { ...currentNode, selected }
    }))
  }, [])

  const showNodeDetails = useCallback((nodeID: string) => {
    setNodes((current) => current.some((node) => node.id === nodeID && node.selected)
      ? current
      : current.map((node) => ({ ...node, selected: node.id === nodeID })))
    setActiveNodeID(nodeID)
    setActiveCanvasPanel(null)
    setInspectorNodeID(nodeID)
  }, [setActiveNodeID])

  const clearCanvasSelection = useCallback((event?: ReactMouseEvent<Element>) => {
    const guard = nodePointerPaneClickGuardRef.current
    if (event && guard && performance.now() <= guard.expiresAt) {
      const distance = Math.hypot(event.clientX - guard.x, event.clientY - guard.y)
      if (distance <= NODE_POINTER_PANE_CLICK_GUARD_DISTANCE_PX) {
        clearNodePointerPaneClickGuard()
        return
      }
    }

    clearNodePointerPaneClickGuard()
    pendingCanvasSelectionNodeIDRef.current = null
    pendingPointerSelectionRef.current = null
    setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node))
    setActiveNodeID(null)
    setInspectorNodeID(null)
  }, [clearNodePointerPaneClickGuard, setActiveNodeID])

  const onSelectionChange = useCallback((selection: OnSelectionChangeParams<CinemaFlowNode, Edge>) => {
    const nextActiveNodeID = selection.nodes.length === 1 ? selection.nodes[0]?.id ?? null : null
    setActiveNodeID(nextActiveNodeID)
    setInspectorNodeID((current) => current === nextActiveNodeID ? current : null)
  }, [setActiveNodeID])

  const clearCanvasSelectionOnPointerDown = useCallback((event: ReactPointerEvent<Element>) => {
    if (event.button !== 0 || !event.isPrimary) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (
      target.closest(
        [
          ".react-flow__node",
          ".react-flow__nodesselection",
          ".react-flow__handle",
          ".react-flow__controls",
          ".react-flow__minimap",
          ".react-flow__attribution",
          ".cinema-node-overlay-panel",
          ".cinema-context-menu",
           ".cinema-text-model-menu",
           ".cinema-composer-select-menu",
           ".cinema-generation-spec-panel",
           ".cinema-file-browser",
          ".cinema-node-inspector",
          ".cinema-canvas-nav",
        ].join(", "),
      )
    ) {
      return
    }

    clearCanvasSelection()
  }, [clearCanvasSelection])

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

  useEffect(() => {
    if (!textGenerationUndo) return
    const node = nodes.find((item) => item.id === textGenerationUndo.nodeID)
    if (!node || !canRestoreGeneratedText(textGenerationUndo, readRawString(node.data.rawData, "text"))) {
      setTextGenerationUndo(null)
    }
  }, [nodes, textGenerationUndo])

  const undoTextGeneration = useCallback(() => {
    if (!textGenerationUndo) return
    const node = nodes.find((item) => item.id === textGenerationUndo.nodeID)
    if (!node || !canRestoreGeneratedText(textGenerationUndo, readRawString(node.data.rawData, "text"))) {
      setTextGenerationUndo(null)
      return
    }
    changeNode(textGenerationUndo.nodeID, {
      rawData: { ...node.data.rawData, text: textGenerationUndo.previousText },
    })
    setTextGenerationUndo(null)
  }, [changeNode, nodes, textGenerationUndo])

  const deleteNode = useCallback((nodeID: string) => {
    deleteNodes([nodeID])
  }, [deleteNodes])

  useEffect(() => {
    const handleDeleteSelectedNodes = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key !== "Backspace" && event.key !== "Delete") return
      if (selectedNodeIDs.length === 0 || editingNodeIDsRef.current.size > 0 || isEditableElement(event.target)) return

      event.preventDefault()
      deleteNodes(selectedNodeIDs)
    }

    window.addEventListener("keydown", handleDeleteSelectedNodes)
    return () => window.removeEventListener("keydown", handleDeleteSelectedNodes)
  }, [deleteNodes, selectedNodeIDs])

  const canvasAssetLocators = useMemo(() => {
    const unique = new Map<string, CinemaAssetLocator>()
    for (const node of nodes) {
      const assetRef = cinemaAssetRefFromNodeData(node.data.rawData)
      if (!assetRef) continue
      unique.set(cinemaAssetLocatorStatusKey(assetRef), {
        scope: assetRef.scope,
        assetID: assetRef.assetID,
      })
    }
    return [...unique.values()]
  }, [nodes])
  const canvasAssetStateQueries = useQueries({
    queries: canvasAssetLocators.map((assetRef) => ({
      queryKey: ["cinema-canvas-asset-state", agentBaseURL, cinemaAssetLocatorStatusKey(assetRef)],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        createAssetLibraryApi(agentBaseURL, projectID, assetRef.scope).getAsset(assetRef.assetID, signal),
      staleTime: 1_000,
      refetchInterval: 30_000,
      retry: false,
    })),
  })
  const canvasAssetStateByKey = useMemo(() => {
    const states = new Map<string, CanvasAssetLiveState>()
    for (let index = 0; index < canvasAssetLocators.length; index += 1) {
      const locator = canvasAssetLocators[index]!
      const query = canvasAssetStateQueries[index]
      if (query?.data?.asset.status) {
        states.set(cinemaAssetLocatorStatusKey(locator), {
          status: query.data.asset.status,
          asset: query.data.asset,
        })
      } else if (query?.error instanceof AssetLibraryApiError && query.error.status === 404) {
        states.set(cinemaAssetLocatorStatusKey(locator), { status: "missing" })
      }
    }
    return states
  }, [canvasAssetLocators, canvasAssetStateQueries])

  const textModels = textModelsQuery.data?.items ?? []
  const effectiveTextModel = textModelsQuery.data?.effectiveModel ?? null
  const imageModels = imageModelsQuery.data?.items ?? []
  const effectiveImageModel = imageModelsQuery.data?.effectiveModel ?? null
  const renderedNodes = useMemo(
    () => nodes.map((node) => {
      const hasIncomingConnection = edges.some((edge) => edge.target === node.id)
      const hasOutgoingConnection = edges.some((edge) => edge.source === node.id)
      const videoInputControls = videoInputControlsForNode(node, videoProviders)
      const videoInputAssetMaps = node.data.cinemaType === "video"
        ? sourceInputAssetMapsForVideoNode(node.id, nodes, edges, videoInputControls)
        : { byInputKey: {}, byRole: {} }
      const assetRef = cinemaAssetRefFromNodeData(node.data.rawData)
      const liveAssetState = assetRef
        ? canvasAssetStateByKey.get(cinemaAssetLocatorStatusKey(assetRef))
        : undefined
      const liveAssetRef = assetRef && liveAssetState?.asset
        ? {
            ...assetRef,
            contentRevision: liveAssetState.asset.contentRevision,
            snapshot: {
              kind: liveAssetState.asset.kind,
              displayName: liveAssetState.asset.displayName,
              mimeType: liveAssetState.asset.mimeType,
              ...(liveAssetState.asset.width ? { width: liveAssetState.asset.width } : {}),
              ...(liveAssetState.asset.height ? { height: liveAssetState.asset.height } : {}),
              ...(liveAssetState.asset.durationSeconds !== undefined
                ? { durationSeconds: liveAssetState.asset.durationSeconds }
                : {}),
            },
          }
        : assetRef
      const liveRawData = liveAssetState || liveAssetRef !== assetRef
        ? {
            ...node.data.rawData,
            ...(liveAssetState ? { assetStatus: liveAssetState.status } : {}),
            ...(liveAssetRef ? { assetRef: liveAssetRef } : {}),
          }
        : node.data.rawData
      return {
        ...node,
        data: {
          ...node.data,
          rawData: liveRawData,
        isActiveNode: node.id === activeNodeID,
        onChangeRawData: (nodeID: string, rawData: Record<string, unknown>) => changeNode(nodeID, { rawData }),
        onChangeTitle: (nodeID: string, title: string) => changeNode(nodeID, { title }),
        onActivateNode: activateNodeFromPointer,
        onSelectNode: selectNodeOnly,
        onNodeInputEditingChange: setNodeInputEditing,
        onDeleteNode: deleteNode,
        hasConnections: hasIncomingConnection || hasOutgoingConnection,
        hasIncomingConnection,
        hasOutgoingConnection,
        onRelinkAsset: beginRelinkAsset,
        textModels,
        effectiveTextModel,
        isGeneratingText: isNodeOperationPending(textGenerationOperations, node.id),
        textGenerationError: nodeOperationError(textGenerationOperations, node.id),
        sourceImageAssets: node.data.cinemaType === "text" || node.data.cinemaType === "image"
          ? sourceImageAssetsForNode(node.id, nodes, edges)
          : [],
        onGenerateText: (nodeID: string, request: TextGenerationRequest) =>
          createTextGenerationMutation.mutate({ nodeID, request }),
        imageModels,
        effectiveImageModel,
        isGeneratingImage: isNodeOperationPending(imageGenerationOperations, node.id),
        imageGenerationError: nodeOperationError(imageGenerationOperations, node.id),
        isFinalizingImageCandidate: imageFinalizeNodeIDs.has(node.id),
        imageFinalizeError: imageFinalizeError?.nodeID === node.id ? imageFinalizeError.message : null,
        sourceTextParameters: node.data.cinemaType === "image" || node.data.cinemaType === "video"
          ? sourceTextParametersForNode(node.id, nodes, edges, videoInputControls)
          : [],
        agentBaseURL,
        projectID,
        onDisconnectEdge: disconnectEdge,
        onGenerateImage: (nodeID: string, request: ImageGenerationRequest) =>
          createImageGenerationMutation.mutate({ nodeID, request }),
        videoProviders,
        workflowCatalogs,
        isLoadingWorkflows: workflowCatalogsQuery.isLoading,
        isRefreshingWorkflows: refreshWorkflowsMutation.isPending,
        workflowRefreshError: refreshWorkflowsMutation.error instanceof Error
          ? refreshWorkflowsMutation.error.message
          : workflowCatalogsQuery.error instanceof Error
            ? workflowCatalogsQuery.error.message
            : null,
        onRefreshProviderWorkflows: (providerID: string) => {
          if (!refreshWorkflowsMutation.isPending) refreshWorkflowsMutation.mutate(providerID)
        },
        generationTasks: tasksQuery.data ?? [],
        sourceImageAsset: node.data.cinemaType === "video"
          ? sourceImageAssetForVideoNode(node.id, nodes, edges, videoInputControls)
          : null,
        videoInputImageAssets: node.data.cinemaType === "video"
          ? sourceImageAssetsForVideoNode(node.id, nodes, edges, videoInputControls)
          : {},
        videoInputAssets: node.data.cinemaType === "video"
          ? sourceInputAssetsForVideoNode(node.id, nodes, edges, videoInputControls)
          : {},
        videoInputAssetsByInputKey: videoInputAssetMaps.byInputKey,
        videoInputAssetsByRole: videoInputAssetMaps.byRole,
        isCreatingVideoTask: isNodeOperationPending(videoGenerationOperations, node.id),
        videoGenerationError: nodeOperationError(videoGenerationOperations, node.id),
        onCreateVideoGenerationTask: (nodeID: string, body: CreateCinemaGenerationTaskBody) =>
          createGenerationTaskMutation.mutate({ body, draftNodeID: nodeID }),
        isImportingImage: imageImportNodeIDs.has(node.id),
        imageImportError: imageImportError?.nodeID === node.id ? imageImportError.message : null,
        onImportImage: (nodeID: string, file: File) =>
          importImageMutation.mutate({ nodeID, file }),
        onFinalizeImageCandidate: (nodeID: string, candidateID: string) =>
          finalizeImageCandidateMutation.mutate({ nodeID, candidateID }),
        isCroppingImage: createCroppedImageMutation.isPending && imageCropNodeID === node.id,
        imageCropError: imageCropError?.nodeID === node.id ? imageCropError.message : null,
        onCreateCroppedImageNode: (nodeID: string, crop: ImageCropRect) =>
          createCroppedImageMutation.mutateAsync({ nodeID, crop }).then(() => undefined),
        hasIncomingImageEdge: hasIncomingConnection,
        onDismissNodeOverlay: clearCanvasSelection,
          nodeInputOverlayRoot,
        },
      }
    }),
    [
      agentBaseURL,
      activateNodeFromPointer,
      canvasAssetStateByKey,
      changeNode,
      createCroppedImageMutation,
      createGenerationTaskMutation,
      createImageGenerationMutation,
      createTextGenerationMutation,
      deleteNode,
      disconnectEdge,
      edges,
      effectiveImageModel,
      effectiveTextModel,
      imageGenerationOperations,
      imageModels,
      imageCropError,
      imageCropNodeID,
      imageImportError,
      imageImportNodeIDs,
      imageFinalizeError,
      imageFinalizeNodeIDs,
      finalizeImageCandidateMutation,
      importImageMutation,
      nodes,
      nodeInputOverlayRoot,
      projectID,
      refreshWorkflowsMutation,
      setNodeInputEditing,
      selectNodeOnly,
      tasksQuery.data,
      textGenerationOperations,
      textModels,
      activeNodeID,
      beginRelinkAsset,
      clearCanvasSelection,
      videoGenerationOperations,
      videoProviders,
      workflowCatalogs,
      workflowCatalogsQuery.error,
      workflowCatalogsQuery.isLoading,
    ],
  )
  const inspectorNode = useMemo(
    () => inspectorNodeID ? renderedNodes.find((node) => node.id === inspectorNodeID) ?? null : null,
    [inspectorNodeID, renderedNodes],
  )
  const hasPersonalAssetDependencies = useMemo(
    () => nodes.some((node) => cinemaAssetRefFromNodeData(node.data.rawData)?.scope.type === "personal"),
    [nodes],
  )
  const relinkAssetKind = useMemo<CinemaAssetKind | undefined>(() => {
    if (!relinkNodeID) return undefined
    const nodeType = nodes.find((node) => node.id === relinkNodeID)?.data.cinemaType
    if (nodeType === "image") return "image"
    if (nodeType === "video" || nodeType === "audio") return nodeType
    return undefined
  }, [nodes, relinkNodeID])

  if (!projectID) {
    return (
      <CinemaWorkbenchShell projectName="Cinema" activeWorkspace={activeWorkspace} onWorkspaceChange={changeWorkspace} availableWorkspaces={availableWorkspaces}>
        <div className="cinema-empty-state">
          <h1>{t("app.missingProject")}</h1>
          <p>{t("app.missingProjectDescription")}</p>
        </div>
      </CinemaWorkbenchShell>
    )
  }

  if (projectQuery.isLoading || (projectQuery.data?.initialized && canvasQuery.isLoading)) {
    return (
      <CinemaWorkbenchShell projectName={projectQuery.data?.name ?? "Cinema"} activeWorkspace={activeWorkspace} onWorkspaceChange={changeWorkspace} availableWorkspaces={availableWorkspaces}>
        <div className="cinema-empty-state">
          <Loader2 className="is-spinning" aria-hidden="true" />
          <h1>{t("app.opening")}</h1>
          <p>{t("app.openingDescription")}</p>
        </div>
      </CinemaWorkbenchShell>
    )
  }

  if (projectQuery.error || canvasQuery.error || providersQuery.error || textModelsQuery.error || imageModelsQuery.error || tasksQuery.error) {
    const error = projectQuery.error ?? canvasQuery.error ?? providersQuery.error ?? textModelsQuery.error ?? imageModelsQuery.error ?? tasksQuery.error
    return (
      <CinemaWorkbenchShell projectName={projectQuery.data?.name ?? "Cinema"} activeWorkspace={activeWorkspace} onWorkspaceChange={changeWorkspace} availableWorkspaces={availableWorkspaces}>
        <div className="cinema-empty-state is-error">
          <h1>{t("app.openFailed")}</h1>
          <p>{error instanceof Error ? error.message : t("app.unknownError")}</p>
        </div>
      </CinemaWorkbenchShell>
    )
  }

  if (projectQuery.data && !projectQuery.data.initialized) {
    return (
      <CinemaWorkbenchShell projectName={projectQuery.data.name} activeWorkspace={activeWorkspace} onWorkspaceChange={changeWorkspace} availableWorkspaces={availableWorkspaces}>
        <div className="cinema-empty-state">
          <Film aria-hidden="true" />
          <h1>{t("app.initialize")}</h1>
          <p>{t("app.initializeDescription")}</p>
        </div>
      </CinemaWorkbenchShell>
    )
  }

  if (activeWorkspace === "edit") {
    return (
      <CinemaWorkbenchShell
        projectName={projectQuery.data?.name ?? "Cinema"}
        activeWorkspace={activeWorkspace}
        onWorkspaceChange={changeWorkspace}
        availableWorkspaces={availableWorkspaces}
      >
        <Suspense fallback={<div className="cinema-timeline-empty" role="status"><p>{t("app.loadingEdit")}</p></div>}>
          <EditWorkbench
            agentBaseURL={agentBaseURL}
            projectID={projectID}
            onRegisterFlush={(flush) => { editFlushRef.current = flush }}
            onTimelineSelected={setDeliverTimelineID}
          />
        </Suspense>
      </CinemaWorkbenchShell>
    )
  }

  if (activeWorkspace === "deliver") {
    return (
      <CinemaWorkbenchShell
        projectName={projectQuery.data?.name ?? "Cinema"}
        activeWorkspace={activeWorkspace}
        onWorkspaceChange={changeWorkspace}
        availableWorkspaces={availableWorkspaces}
      >
        <Suspense fallback={<div className="cinema-empty-state" role="status"><p>{t("app.loadingDeliver")}</p></div>}>
          <DeliverWorkbench
            agentBaseURL={agentBaseURL}
            projectID={projectID}
            initialTimelineID={deliverTimelineID}
            technicalPreview={!timelineDeliveryCapabilityAvailable && timelineDeliveryAvailable}
            onShowAssetInLibrary={assetLibraryEnabled ? revealAssetInLibrary : undefined}
          />
        </Suspense>
      </CinemaWorkbenchShell>
    )
  }

  return (
    <CinemaWorkbenchShell
      projectName={projectQuery.data?.name ?? "Cinema"}
      activeWorkspace={activeWorkspace}
      onWorkspaceChange={changeWorkspace}
      availableWorkspaces={availableWorkspaces}
      onClick={() => {
        setContextMenu(null)
        setNodeContextMenu(null)
      }}
    >
      <section className="cinema-workspace">
        <div className="cinema-canvas" onDragOver={onCanvasAssetDragOver} onDrop={onCanvasAssetDrop}>
          <ReactFlow<CinemaFlowNode, Edge>
            nodes={renderedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={setFlowInstance}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            onSelectionChange={onSelectionChange}
            onNodeClick={onNodeClick}
            onSelectionContextMenu={onSelectionContextMenu}
            onNodeContextMenu={onNodeContextMenu}
            onPaneClick={clearCanvasSelection}
            onPaneContextMenu={onPaneContextMenu}
            onPointerDownCapture={clearCanvasSelectionOnPointerDown}
            fitView
            fitViewOptions={{ padding: 0.38 }}
            minZoom={0.2}
            maxZoom={2}
            autoPanOnNodeDrag={false}
            panOnDrag={[1]}
            deleteKeyCode={null}
            selectionOnDrag
          >
            <Background gap={32} size={1.2} color="var(--cinema-canvas-grid)" />
            <Controls position="bottom-center" orientation="horizontal" />
            <MiniMap
              position="bottom-left"
              nodeColor={(node) => NODE_META[(node as CinemaFlowNode).data.cinemaType].accent}
              maskColor="var(--cinema-minimap-mask)"
              pannable
              zoomable
            />
          </ReactFlow>
          <div ref={setNodeInputOverlayRoot} className="cinema-node-overlay-root" />
          <CanvasSaveStatus
            state={saveState}
            error={saveError}
            pendingCount={pendingSaveCount}
            onRetry={() => commandQueue.retry()}
          />
          {textGenerationUndo ? (
            <div className="cinema-canvas-toast" role="status" aria-live="polite">
              <span>{t("text.generated")}</span>
              <button type="button" onClick={undoTextGeneration}>{t("text.undo")}</button>
            </div>
          ) : null}
          {connectionErrorKey ? (
            <div className="cinema-canvas-toast is-error" role="alert">
              <span>{t(connectionErrorKey)}</span>
            </div>
          ) : null}
          {hasPersonalAssetDependencies ? (
            <div className="cinema-personal-asset-notice" role="status">
              <Info size={14} aria-hidden="true" />
              <span>{t("app.personalAssetWarning")}</span>
            </div>
          ) : null}
          <ContextMenu
            menu={contextMenu}
            onAddNode={addNode}
            onClose={() => setContextMenu(null)}
          />
          <NodeContextMenu
            menu={nodeContextMenu}
            onShowDetails={showNodeDetails}
            onDeleteNodes={deleteNodes}
            onClose={() => setNodeContextMenu(null)}
          />
          {activeCanvasPanel === "files" ? (
            <ProjectFileBrowser
              projectID={projectID}
              agentBaseURL={agentBaseURL}
              onClose={() => setActiveCanvasPanel(null)}
            />
          ) : null}
          {activeCanvasPanel === "assets" ? (
            <Suspense fallback={null}>
              <AssetLibraryPanel
                projectID={projectID}
                agentBaseURL={agentBaseURL}
                onClose={closeAssetPanel}
                onAddToCanvas={handleAssetLibraryAdd}
                mode={relinkNodeID ? "relink" : "add"}
                acceptKind={relinkAssetKind}
                initialScope={assetLibraryRevealRequest?.assetRef.scope.type}
                revealRequest={assetLibraryRevealRequest}
                onRevealRequestHandled={handleAssetLibraryRevealRequest}
              />
            </Suspense>
          ) : null}
          {inspectorNode ? (
            <CinemaNodeInspectorPanel
              node={inspectorNode}
              onClose={() => setInspectorNodeID(null)}
            />
          ) : null}
          <CanvasPanelNavigation
            activePanel={activeCanvasPanel}
            onTogglePanel={toggleCanvasPanel}
            assetButtonRef={assetRailButtonRef}
            assetLibraryEnabled={assetLibraryEnabled}
          />
        </div>
      </section>
    </CinemaWorkbenchShell>
  )
}
