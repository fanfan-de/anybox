import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react"
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
  Bot,
  Check,
  Clock3,
  FileText,
  Film,
  Image,
  KeyRound,
  Loader2,
  MessageSquareText,
  Music,
  Plus,
  Play,
  RefreshCw,
  Scissors,
  Sparkles,
  Trash2,
  Video,
  WandSparkles,
  XCircle,
} from "lucide-react"
import {
  type CinemaCommand,
  type CinemaCommandResult,
  type CinemaEventsResult,
  type CinemaCanvasDocument,
  type CinemaCanvasNode,
  type CinemaGenerationMode,
  type CinemaGenerationTask,
  type CinemaNodeType,
  type CinemaProjectSummary,
  type CinemaVideoProvider,
  type CreateCinemaGenerationTaskBody,
} from "@anybox/shared/cinema"

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error"

type CinemaFlowNodeData = {
  cinemaType: CinemaNodeType
  title: string
  rawData: Record<string, unknown>
  size?: {
    width: number
    height: number
  }
}

type CinemaFlowNode = Node<CinemaFlowNodeData, "cinemaNode">
type CinemaNodePatch = Extract<CinemaCommand, { type: "update-node" }>["patch"]
type ContextMenuState = {
  x: number
  y: number
  flowX: number
  flowY: number
} | null
type GenerationTaskActionState = {
  isCreating: boolean
  isRefreshing: boolean
  isCanceling: boolean
  error: string | null
}
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

const DEFAULT_NODE_SIZE: Record<CinemaNodeType, { width: number; height: number }> = {
  text: { width: 360, height: 220 },
  prompt: { width: 380, height: 240 },
  image: { width: 340, height: 220 },
  video: { width: 360, height: 220 },
  audio: { width: 320, height: 180 },
  shot: { width: 380, height: 250 },
  agent: { width: 360, height: 220 },
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
    label: "Image",
    accent: "#f9a8d4",
    icon: Image,
    placeholder: "Reference image, keyframe, or style frame.",
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
  return node.size ?? DEFAULT_NODE_SIZE[node.type]
}

function toFlowNodes(canvas: CinemaCanvasDocument): CinemaFlowNode[] {
  return canvas.nodes.map((node) => {
    const size = nodeSize(node)
    return {
      id: node.id,
      type: "cinemaNode",
      position: node.position,
      style: {
        width: size.width,
        height: size.height,
      },
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
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
}

function providerFor(providers: CinemaVideoProvider[], providerID: string) {
  return providers.find((provider) => provider.manifest.id === providerID) ?? providers[0] ?? null
}

function modelFor(provider: CinemaVideoProvider | null, modelID: string) {
  return provider?.manifest.models.find((model) => model.id === modelID) ?? provider?.manifest.models[0] ?? null
}

function modeFor(provider: CinemaVideoProvider | null, modelID: string, mode: string): CinemaGenerationMode {
  const model = modelFor(provider, modelID)
  if (model?.modes.includes(mode as CinemaGenerationMode)) return mode as CinemaGenerationMode
  return model?.modes[0] ?? FALLBACK_GENERATION_MODE
}

function stringifyParameters(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return JSON.stringify(value, null, 2)
  }
  return "{}"
}

function parseParameters(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return {}
  const parsed: unknown = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Parameters must be a JSON object.")
  }
  return parsed as Record<string, unknown>
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

function isFinalGenerationTaskStatus(status: string) {
  return status === "succeeded" || status === "failed" || status === "canceled"
}

function createNode(type: CinemaNodeType, position: { x: number; y: number }): CinemaFlowNode {
  const size = DEFAULT_NODE_SIZE[type]
  return {
    id: makeNodeID(type),
    type: "cinemaNode",
    position,
    style: {
      width: size.width,
      height: size.height,
    },
    data: {
      cinemaType: type,
      title: titleForType(type),
      rawData: {
        text: "",
        placeholder: NODE_META[type].placeholder,
      },
      size,
    },
  }
}

function isMutationChange(changes: NodeChange[] | EdgeChange[]) {
  return changes.some((change) => change.type !== "select" && change.type !== "dimensions")
}

function CinemaNodeCard({ data, selected }: NodeProps<CinemaFlowNode>) {
  const meta = NODE_META[data.cinemaType]
  const Icon = meta.icon
  const text = typeof data.rawData.text === "string" && data.rawData.text.trim()
    ? data.rawData.text.trim()
    : typeof data.rawData.placeholder === "string"
      ? data.rawData.placeholder
      : meta.placeholder
  const status = typeof data.rawData.status === "string" ? data.rawData.status : null
  const accentStyle = { "--node-accent": meta.accent } as CSSProperties

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
          {status ? <span className="cinema-node-status">{status}</span> : null}
        </header>
        <div className="cinema-node-preview">
          <Icon size={28} aria-hidden="true" />
        </div>
        <footer className="cinema-node-footer">
          <strong>{data.title}</strong>
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

function GenerationTaskPanel({
  selectedNode,
  providers,
  tasks,
  actionState,
  onCreateGenerationTask,
  onRefreshGenerationTask,
  onCancelGenerationTask,
}: {
  selectedNode: CinemaFlowNode
  providers: CinemaVideoProvider[]
  tasks: CinemaGenerationTask[]
  actionState: GenerationTaskActionState
  onCreateGenerationTask: (body: CreateCinemaGenerationTaskBody, draftNodeID: string) => void
  onRefreshGenerationTask: (taskID: string) => void
  onCancelGenerationTask: (taskID: string) => void
}) {
  const rawData = selectedNode.data.rawData
  const taskID = readRawString(rawData, "taskID")
  const task = useMemo(() => tasks.find((item) => item.id === taskID) ?? null, [taskID, tasks])
  const [providerID, setProviderID] = useState(() => readRawString(rawData, "providerID", providers[0]?.manifest.id ?? "mock"))
  const [modelID, setModelID] = useState(() => {
    const provider = providerFor(providers, providerID)
    return readRawString(rawData, "modelID", provider?.manifest.models[0]?.id ?? "")
  })
  const [mode, setMode] = useState<CinemaGenerationMode>(() => {
    const provider = providerFor(providers, providerID)
    const initialModelID = readRawString(rawData, "modelID", provider?.manifest.models[0]?.id ?? "")
    return modeFor(provider, initialModelID, readRawString(rawData, "mode"))
  })
  const [prompt, setPrompt] = useState(() => task?.input.prompt ?? readRawString(rawData, "text"))
  const [parametersText, setParametersText] = useState(() => stringifyParameters(task?.input.parameters ?? rawData.parameters))
  const [localError, setLocalError] = useState<string | null>(null)

  useEffect(() => {
    const nextProviderID = readRawString(rawData, "providerID", providers[0]?.manifest.id ?? "mock")
    const nextProvider = providerFor(providers, nextProviderID)
    const nextModelID = readRawString(rawData, "modelID", nextProvider?.manifest.models[0]?.id ?? "")
    setProviderID(nextProvider?.manifest.id ?? nextProviderID)
    setModelID(nextModelID)
    setMode(modeFor(nextProvider, nextModelID, readRawString(rawData, "mode")))
    setPrompt(task?.input.prompt ?? readRawString(rawData, "text"))
    setParametersText(stringifyParameters(task?.input.parameters ?? rawData.parameters))
    setLocalError(null)
  }, [providers, rawData, selectedNode.id, task?.id, task?.input.parameters, task?.input.prompt])

  const provider = providerFor(providers, providerID)
  const model = modelFor(provider, modelID)
  const hasTaskRef = taskID.trim().length > 0
  const currentStatus = task?.status ?? readRawString(rawData, "status", hasTaskRef ? "loading" : "draft")
  const outputAssets = task?.outputAssets ?? readDisplayAssets(rawData)
  const providerAuth = provider?.auth
  const providerNeedsCredential = Boolean(providerAuth?.requiresCredential)
  const providerConnected = providerAuth?.connected !== false
  const formDisabled = hasTaskRef || actionState.isCreating
  const canRefresh = Boolean(task && !isFinalGenerationTaskStatus(task.status))
  const canCancel = Boolean(task && !isFinalGenerationTaskStatus(task.status))

  const handleProviderChange = (nextProviderID: string) => {
    const nextProvider = providerFor(providers, nextProviderID)
    const nextModelID = nextProvider?.manifest.models[0]?.id ?? ""
    setProviderID(nextProvider?.manifest.id ?? nextProviderID)
    setModelID(nextModelID)
    setMode(modeFor(nextProvider, nextModelID, ""))
  }

  const handleModelChange = (nextModelID: string) => {
    setModelID(nextModelID)
    setMode(modeFor(provider, nextModelID, mode))
  }

  const handleCreateTask = () => {
    setLocalError(null)
    if (!provider) {
      setLocalError("No video provider is available.")
      return
    }
    if (provider.auth.requiresCredential && !provider.auth.connected) {
      setLocalError(`${provider.manifest.name} is not connected.`)
      return
    }
    if (!model) {
      setLocalError("Select a model before creating the task.")
      return
    }

    let parameters: Record<string, unknown>
    try {
      parameters = parseParameters(parametersText)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Parameters must be valid JSON.")
      return
    }

    onCreateGenerationTask({
      providerID: provider.manifest.id,
      modelID: model.id,
      mode: modeFor(provider, model.id, mode),
      title: selectedNode.data.title,
      prompt,
      sourceNodeIDs: readRawStringArray(rawData, "sourceNodeIDs"),
      parameters,
      position: selectedNode.position,
    }, selectedNode.id)
  }

  return (
    <section className="cinema-task-panel" aria-label="Generation task">
      <div className="cinema-task-status-row">
        <span className={`cinema-task-status is-${currentStatus}`}>{currentStatus}</span>
        {task ? <code>{task.id}</code> : null}
      </div>

      <label className="cinema-field">
        <span>Provider</span>
        <select
          value={provider?.manifest.id ?? providerID}
          disabled={formDisabled || providers.length === 0}
          onChange={(event) => handleProviderChange(event.target.value)}
        >
          {providers.map((item) => (
            <option key={item.manifest.id} value={item.manifest.id}>{item.manifest.name}</option>
          ))}
        </select>
      </label>

      {providerNeedsCredential ? (
        <div className={`cinema-provider-auth ${providerConnected ? "is-connected" : "is-missing"}`}>
          <div>
            <KeyRound size={14} aria-hidden="true" />
            <span>{providerConnected ? "Connected" : "Not connected"}</span>
            {providerAuth?.credentialProviderID ? <code>{providerAuth.credentialProviderID}</code> : null}
          </div>
        </div>
      ) : null}

      <label className="cinema-field">
        <span>Model</span>
        <select
          value={model?.id ?? modelID}
          disabled={formDisabled || !provider}
          onChange={(event) => handleModelChange(event.target.value)}
        >
          {provider?.manifest.models.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>

      <label className="cinema-field">
        <span>Mode</span>
        <select
          value={mode}
          disabled={formDisabled || !model}
          onChange={(event) => setMode(event.target.value as CinemaGenerationMode)}
        >
          {(model?.modes ?? [FALLBACK_GENERATION_MODE]).map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>

      <label className="cinema-field">
        <span>Prompt</span>
        <textarea
          className="is-compact"
          value={prompt}
          disabled={formDisabled}
          placeholder="Describe the clip to generate."
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>

      <label className="cinema-field">
        <span>Params JSON</span>
        <textarea
          className="is-compact"
          value={parametersText}
          disabled={formDisabled}
          spellCheck={false}
          onChange={(event) => setParametersText(event.target.value)}
        />
      </label>

      {(localError || actionState.error || task?.error) ? (
        <p className="cinema-task-error">{localError ?? actionState.error ?? task?.error}</p>
      ) : null}

      <div className="cinema-task-actions">
        {!hasTaskRef ? (
          <button
            type="button"
            className="cinema-command-button"
            disabled={actionState.isCreating || providerNeedsCredential && !providerConnected}
            onClick={handleCreateTask}
          >
            {actionState.isCreating ? <Loader2 size={14} aria-hidden="true" className="is-spinning" /> : <Play size={14} aria-hidden="true" />}
            Create
          </button>
        ) : (
          <>
            <button
              type="button"
              className="cinema-command-button"
              disabled={!task || !canRefresh || actionState.isRefreshing}
              onClick={() => task && onRefreshGenerationTask(task.id)}
            >
              {actionState.isRefreshing ? <Loader2 size={14} aria-hidden="true" className="is-spinning" /> : <RefreshCw size={14} aria-hidden="true" />}
              Refresh
            </button>
            <button
              type="button"
              className="cinema-command-button"
              disabled={!task || !canCancel || actionState.isCanceling}
              onClick={() => task && onCancelGenerationTask(task.id)}
            >
              {actionState.isCanceling ? <Loader2 size={14} aria-hidden="true" className="is-spinning" /> : <XCircle size={14} aria-hidden="true" />}
              Cancel
            </button>
          </>
        )}
      </div>

      {outputAssets.length > 0 ? (
        <div className="cinema-task-assets">
          <span>Outputs</span>
          {outputAssets.map((asset) => (
            <code key={asset.id}>{asset.kind}: {asset.path}</code>
          ))}
        </div>
      ) : null}
    </section>
  )
}

function Inspector({
  selectedNode,
  providers,
  tasks,
  taskActionState,
  onChangeNode,
  onDeleteNode,
  onCreateGenerationTask,
  onRefreshGenerationTask,
  onCancelGenerationTask,
}: {
  selectedNode: CinemaFlowNode | null
  providers: CinemaVideoProvider[]
  tasks: CinemaGenerationTask[]
  taskActionState: GenerationTaskActionState
  onChangeNode: (nodeID: string, update: Partial<CinemaFlowNodeData>) => void
  onDeleteNode: (nodeID: string) => void
  onCreateGenerationTask: (body: CreateCinemaGenerationTaskBody, draftNodeID: string) => void
  onRefreshGenerationTask: (taskID: string) => void
  onCancelGenerationTask: (taskID: string) => void
}) {
  if (!selectedNode) {
    return (
      <aside className="cinema-inspector">
        <div className="cinema-inspector-empty">
          <Sparkles size={22} aria-hidden="true" />
          <h2>Select a node</h2>
          <p>Pick a canvas node to edit its title and first draft content.</p>
        </div>
      </aside>
    )
  }

  const meta = NODE_META[selectedNode.data.cinemaType]
  const Icon = meta.icon
  const text = typeof selectedNode.data.rawData.text === "string" ? selectedNode.data.rawData.text : ""

  return (
    <aside className="cinema-inspector">
      <header className="cinema-inspector-header">
        <span style={{ "--node-accent": meta.accent } as CSSProperties}>
          <Icon size={16} aria-hidden="true" />
          {meta.label}
        </span>
        <button type="button" className="cinema-icon-button" title="Delete node" aria-label="Delete node" onClick={() => onDeleteNode(selectedNode.id)}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </header>
      <div className="cinema-inspector-body">
        <label className="cinema-field">
          <span>Title</span>
          <input
            value={selectedNode.data.title}
            onChange={(event) => onChangeNode(selectedNode.id, { title: event.target.value })}
          />
        </label>
        {selectedNode.data.cinemaType === "generation-task" ? (
          <GenerationTaskPanel
            selectedNode={selectedNode}
            providers={providers}
            tasks={tasks}
            actionState={taskActionState}
            onCreateGenerationTask={onCreateGenerationTask}
            onRefreshGenerationTask={onRefreshGenerationTask}
            onCancelGenerationTask={onCancelGenerationTask}
          />
        ) : (
          <label className="cinema-field">
            <span>Text</span>
            <textarea
              value={text}
              placeholder={meta.placeholder}
              onChange={(event) =>
                onChangeNode(selectedNode.id, {
                  rawData: {
                    ...selectedNode.data.rawData,
                    text: event.target.value,
                  },
                })}
            />
          </label>
        )}
        <div className="cinema-inspector-meta">
          <span>ID</span>
          <code>{selectedNode.id}</code>
        </div>
      </div>
    </aside>
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
    <div className="cinema-context-menu" style={{ left: menu.x, top: menu.y }} role="menu">
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

function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  if (state === "saving") {
    return (
      <span className="cinema-save-indicator">
        <Loader2 size={14} aria-hidden="true" className="is-spinning" />
        Saving
      </span>
    )
  }
  if (state === "dirty") {
    return (
      <span className="cinema-save-indicator">
        <Clock3 size={14} aria-hidden="true" />
        Unsaved
      </span>
    )
  }
  if (state === "error") {
    return <span className="cinema-save-indicator is-error">{error ?? "Save failed"}</span>
  }
  return (
    <span className="cinema-save-indicator">
      <Check size={14} aria-hidden="true" />
      Saved
    </span>
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const saveStateRef = useRef<SaveState>("idle")
  const nodePatchTimersRef = useRef(new Map<string, number>())
  const nodePatchQueueRef = useRef(new Map<string, CinemaNodePatch>())
  const eventCursorRef = useRef<number | null>(null)
  const applyingCanvasRef = useRef(false)

  const applyCanvas = useCallback((canvas: CinemaCanvasDocument) => {
    applyingCanvasRef.current = true
    setNodes(toFlowNodes(canvas))
    setEdges(canvas.edges)
    saveStateRef.current = "saved"
    setSaveState("saved")
    setSaveError(null)
    window.requestAnimationFrame(() => {
      reactFlow.setViewport(canvas.viewport)
      window.setTimeout(() => {
        applyingCanvasRef.current = false
      }, 50)
    })
  }, [reactFlow])

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
    ])
  }, [refetchCanvas, refetchProviders, refetchTasks])

  const createGenerationTaskMutation = useMutation({
    mutationFn: ({ body }: { body: CreateCinemaGenerationTaskBody; draftNodeID: string }) =>
      requestJson<CinemaGenerationTask>(agentBaseURL, `/api/cinema/projects/${encodeURIComponent(projectID)}/generation-tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    onMutate: () => {
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
    onError: (error) => {
      saveStateRef.current = "error"
      setSaveState("error")
      setSaveError(error instanceof Error ? error.message : "Task creation failed")
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

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeID) ?? null,
    [nodes, selectedNodeID],
  )

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

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    const edge = {
      id: `edge-${connection.source}-${connection.target}-${Date.now().toString(36)}`,
      source: connection.source,
      target: connection.target,
      ...(connection.sourceHandle ? { sourceHandle: connection.sourceHandle } : {}),
      ...(connection.targetHandle ? { targetHandle: connection.targetHandle } : {}),
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

  const taskActionError =
    createGenerationTaskMutation.error ??
    refreshGenerationTaskMutation.error ??
    cancelGenerationTaskMutation.error
  const taskActionState: GenerationTaskActionState = {
    isCreating: createGenerationTaskMutation.isPending,
    isRefreshing: refreshGenerationTaskMutation.isPending,
    isCanceling: cancelGenerationTaskMutation.isPending,
    error: taskActionError instanceof Error ? taskActionError.message : null,
  }

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

  if (projectQuery.error || canvasQuery.error || providersQuery.error || tasksQuery.error) {
    const error = projectQuery.error ?? canvasQuery.error ?? providersQuery.error ?? tasksQuery.error
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
      <section className="cinema-workspace">
        <header className="cinema-topbar">
          <div>
            <span className="cinema-brand">anybox for cinema</span>
            <strong>{projectQuery.data?.name ?? "Cinema Project"}</strong>
          </div>
          <div className="cinema-topbar-actions">
            <SaveIndicator state={saveState} error={saveError} />
            <button
              type="button"
              className="cinema-command-button"
              onClick={() => addNode("text", { x: 120, y: 120 })}
            >
              <Plus size={15} aria-hidden="true" />
              Text
            </button>
            <button
              type="button"
              className="cinema-command-button"
              onClick={() => addNode("shot", { x: 180, y: 180 })}
            >
              <Plus size={15} aria-hidden="true" />
              Shot
            </button>
            <button
              type="button"
              className="cinema-command-button"
              onClick={() => addNode("generation-task", { x: 260, y: 220 })}
            >
              <Plus size={15} aria-hidden="true" />
              Task
            </button>
          </div>
        </header>
        <div className="cinema-canvas">
          <ReactFlow<CinemaFlowNode, Edge>
            nodes={nodes}
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
            onMoveEnd={(_, nextViewport) => {
              if (applyingCanvasRef.current) return
              commandMutation.mutate({
                id: makeCommandID("update-viewport"),
                type: "update-viewport",
                actor: "cinema-web",
                viewport: nextViewport,
              })
            }}
            fitView
            minZoom={0.2}
            maxZoom={2}
          >
            <Background gap={32} size={1.2} color="rgba(255,255,255,0.16)" />
            <Controls position="bottom-center" />
            <MiniMap
              position="bottom-left"
              nodeColor={(node) => NODE_META[(node as CinemaFlowNode).data.cinemaType].accent}
              maskColor="rgba(0,0,0,0.55)"
              pannable
              zoomable
            />
          </ReactFlow>
          <ContextMenu menu={contextMenu} onAddNode={addNode} onClose={() => setContextMenu(null)} />
        </div>
      </section>
      <Inspector
        selectedNode={selectedNode}
        providers={providersQuery.data ?? []}
        tasks={tasksQuery.data ?? []}
        taskActionState={taskActionState}
        onChangeNode={changeNode}
        onDeleteNode={deleteNode}
        onCreateGenerationTask={(body, draftNodeID) => createGenerationTaskMutation.mutate({ body, draftNodeID })}
        onRefreshGenerationTask={(taskID) => refreshGenerationTaskMutation.mutate(taskID)}
        onCancelGenerationTask={(taskID) => cancelGenerationTaskMutation.mutate(taskID)}
      />
    </main>
  )
}
