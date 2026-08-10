import type { Connection, Edge } from "@xyflow/react"
import type { CinemaNodeType } from "@anybox/cinema-plugin/contracts"
import type { TranslationKey } from "../../i18n"
import { videoInputHandleMetadata } from "../generation/videoInputRouting"

type ConnectionNode = {
  id: string
  data: { cinemaType: CinemaNodeType }
}

export type ConnectionValidation =
  | { valid: true }
  | { valid: false; reason: TranslationKey }

export function validateCinemaConnection(
  connection: Pick<Connection, "source" | "target"> & {
    sourceHandle?: string | null
    targetHandle?: string | null
  },
  nodes: readonly ConnectionNode[],
  edges: readonly Edge[],
): ConnectionValidation {
  if (!connection.source || !connection.target) return { valid: false, reason: "connection.invalid" }
  if (connection.source === connection.target) return { valid: false, reason: "connection.self" }
  if (edges.some((edge) => (
    edge.source === connection.source
    && edge.target === connection.target
    && (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null)
    && (edge.targetHandle ?? null) === (connection.targetHandle ?? null)
  ))) return { valid: false, reason: "connection.duplicate" }

  const sourceType = nodes.find((node) => node.id === connection.source)?.data.cinemaType
  const targetType = nodes.find((node) => node.id === connection.target)?.data.cinemaType
  if (!sourceType || !targetType) return { valid: false, reason: "connection.invalid" }

  if (targetType === "text" && sourceType !== "image") {
    return { valid: false, reason: "connection.textInput" }
  }
  if (sourceType === "text" && targetType !== "image" && targetType !== "video") {
    return { valid: false, reason: "connection.textOutput" }
  }
  const targetVideoInput = targetType === "video"
    ? videoInputHandleMetadata(connection.targetHandle)
    : null
  const targetsSpecificVideoInput = Boolean(
    targetVideoInput
    && connection.targetHandle
    && connection.targetHandle !== "input",
  )
  if (targetsSpecificVideoInput) {
    const slot = targetVideoInput?.slot
    if (
      (slot === "textParameter" && sourceType !== "text")
      || (slot !== "textParameter" && sourceType === "text")
      || (slot === "sourceVideo" && sourceType !== "video")
      || (slot !== "sourceVideo" && slot !== "textParameter" && sourceType !== "image")
    ) {
      return { valid: false, reason: "connection.invalid" }
    }
    if (slot !== "referenceImage") {
      const occupied = edges.some((edge) => (
        edge.target === connection.target
        && (edge.targetHandle ?? null) === (connection.targetHandle ?? null)
      ))
      if (occupied) return { valid: false, reason: "connection.videoImageLimit" }
    }
  }
  const allowed = (
    (sourceType === "text" && (targetType === "image" || targetType === "video"))
    || (sourceType === "image" && (targetType === "text" || targetType === "video"))
    || (sourceType === "video" && targetType === "video")
  )
  if (!allowed) return { valid: false, reason: "connection.invalid" }
  if (targetType === "video" && sourceType === "image" && !targetsSpecificVideoInput) {
    const incomingImageCount = edges.filter((edge) => {
      if (edge.target !== connection.target) return false
      const edgeSourceType = nodes.find((node) => node.id === edge.source)?.data.cinemaType
      return edgeSourceType === "image"
    }).length
    if (incomingImageCount >= 2) return { valid: false, reason: "connection.videoImageLimit" }
  }
  return { valid: true }
}
