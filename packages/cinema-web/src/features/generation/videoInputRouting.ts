import type { CinemaNodeType } from "@anybox/shared/cinema"
import type { Edge } from "@xyflow/react"
import {
  GENERATION_INPUT_SLOTS,
  isGenerationImageInputSlot,
  slotForInputRole,
  type GenerationInputControl,
  type GenerationInputSlot,
} from "./generationContract"

export type VideoEdgeTargetInput = {
  inputKey?: string
  role?: string
  slot: GenerationInputSlot | null
}

export type VideoInputRoutingControl = Pick<
  GenerationInputControl,
  "inputKey" | "role" | "slot" | "modality"
>

type VideoInputRoutingNode = {
  id: string
  data: { cinemaType: CinemaNodeType }
}

function isVideoInputSlot(value: unknown): value is GenerationInputSlot {
  return typeof value === "string" && (GENERATION_INPUT_SLOTS as readonly string[]).includes(value)
}

function explicitEdgeTargetVideoInput(edge: Edge): VideoEdgeTargetInput | null {
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

function storedVideoImageInputIndex(edge: Edge): 0 | 1 | null {
  const data = edge.data
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const value = (data as Record<string, unknown>).targetImageIndex
  return value === 0 || value === 1 ? value : null
}

function explicitVideoImageInputIndex(edge: Edge): 0 | 1 | null {
  const storedIndex = storedVideoImageInputIndex(edge)
  if (storedIndex !== null) return storedIndex
  const slot = explicitEdgeTargetVideoInput(edge)?.slot
  if (slot === "startFrame") return 0
  if (slot === "endFrame") return 1
  return null
}

function isImageSourceNode(node: VideoInputRoutingNode | undefined) {
  return node?.data.cinemaType === "image"
}

function videoImageInputAssignments(
  targetNodeID: string,
  nodes: readonly VideoInputRoutingNode[],
  edges: readonly Edge[],
) {
  const imageEdges = edges.filter((candidate) => (
    candidate.target === targetNodeID
    && isImageSourceNode(nodes.find((node) => node.id === candidate.source))
  ))
  const assignments = new Map<string, 0 | 1>()
  const usedIndexes = new Set<0 | 1>()

  for (const candidate of imageEdges) {
    const explicitIndex = explicitVideoImageInputIndex(candidate)
    if (explicitIndex === null || usedIndexes.has(explicitIndex)) continue
    assignments.set(candidate.id, explicitIndex)
    usedIndexes.add(explicitIndex)
  }
  for (const candidate of imageEdges) {
    if (assignments.has(candidate.id)) continue
    const availableIndex = ([0, 1] as const).find((index) => !usedIndexes.has(index))
    if (availableIndex === undefined) continue
    assignments.set(candidate.id, availableIndex)
    usedIndexes.add(availableIndex)
  }
  return assignments
}

function targetInputMetadata(input: VideoInputRoutingControl): VideoEdgeTargetInput {
  return {
    inputKey: input.inputKey,
    role: input.role,
    slot: input.slot,
  }
}

function targetInputAcceptsSource(
  input: VideoInputRoutingControl,
  sourceType: CinemaNodeType | undefined,
) {
  if (sourceType === "text") return input.slot === "textParameter"
  if (sourceType === "video") return input.slot === "sourceVideo"
  if (sourceType === "image") {
    return Boolean(input.slot && isGenerationImageInputSlot(input.slot))
  }
  return false
}

function contractTargetVideoInput(
  edge: Edge,
  sourceType: CinemaNodeType | undefined,
  nodes: readonly VideoInputRoutingNode[],
  edges: readonly Edge[],
  targetInputs: readonly VideoInputRoutingControl[],
): VideoEdgeTargetInput | null {
  const compatibleInputs = targetInputs.filter((input) =>
    targetInputAcceptsSource(input, sourceType)
  )
  if (compatibleInputs.length === 1) {
    return targetInputMetadata(compatibleInputs[0]!)
  }

  if (sourceType !== "image" || compatibleInputs.length !== 2) return null
  const startFrameInput = compatibleInputs.find((input) => input.slot === "startFrame")
  const endFrameInput = compatibleInputs.find((input) => input.slot === "endFrame")
  if (!startFrameInput || !endFrameInput) return null

  const imageIndex = videoImageInputAssignments(edge.target, nodes, edges).get(edge.id)
  if (imageIndex === undefined) return null
  return targetInputMetadata(imageIndex === 0 ? startFrameInput : endFrameInput)
}

export function videoInputHandleMetadata(handle: string | null | undefined): VideoEdgeTargetInput | null {
  if (!handle) return null
  if (isVideoInputSlot(handle)) return { slot: handle }
  const match = /^input:([^:]+):(.+)$/.exec(handle)
  if (!match) return null
  const role = match[2] ?? ""
  return {
    inputKey: handle,
    role,
    slot: slotForInputRole(role, ""),
  }
}

export function edgeTargetVideoInput(
  edge: Edge,
  nodes: readonly VideoInputRoutingNode[],
  edges: readonly Edge[],
  targetInputs?: readonly VideoInputRoutingControl[],
): VideoEdgeTargetInput | null {
  const explicitInput = explicitEdgeTargetVideoInput(edge)
  if (explicitInput) return explicitInput

  const sourceNode = nodes.find((node) => node.id === edge.source)
  const sourceType = sourceNode?.data.cinemaType
  if (targetInputs !== undefined) {
    return contractTargetVideoInput(edge, sourceType, nodes, edges, targetInputs)
  }

  if (sourceType === "text") return { slot: "textParameter" }
  if (sourceType === "video") return { slot: "sourceVideo" }
  if (!isImageSourceNode(sourceNode)) return null

  const imageIndex = videoImageInputAssignments(edge.target, nodes, edges).get(edge.id)
  if (imageIndex === undefined) return null
  return { slot: imageIndex === 0 ? "startFrame" : "endFrame" }
}

export function nextVideoImageInputIndex(
  targetNodeID: string,
  nodes: readonly VideoInputRoutingNode[],
  edges: readonly Edge[],
) {
  const usedIndexes = new Set(videoImageInputAssignments(targetNodeID, nodes, edges).values())
  return ([0, 1] as const).find((index) => !usedIndexes.has(index)) ?? null
}

export function normalizeVideoTargetEdgeHandle(edge: Edge): Edge {
  if (edge.targetHandle === "input") return edge
  const targetInput = explicitEdgeTargetVideoInput(edge)
  const currentData = edge.data && typeof edge.data === "object" && !Array.isArray(edge.data)
    ? edge.data as Record<string, unknown>
    : {}
  const nextData = targetInput
    ? {
        ...currentData,
        ...(targetInput.slot ? { targetSlot: targetInput.slot } : {}),
        ...(targetInput.role ? { targetRole: targetInput.role } : {}),
        ...(targetInput.inputKey ? { targetInputKey: targetInput.inputKey } : {}),
      }
    : currentData
  return {
    ...edge,
    targetHandle: "input",
    ...(Object.keys(nextData).length > 0 ? { data: nextData } : {}),
  }
}
