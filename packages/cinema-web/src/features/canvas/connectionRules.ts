import type { Connection, Edge } from "@xyflow/react"
import type { CinemaNodeType } from "@anybox/shared/cinema"
import type { TranslationKey } from "../../i18n"

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
  const allowed = (
    (sourceType === "text" && (targetType === "image" || targetType === "video"))
    || (sourceType === "image" && (targetType === "text" || targetType === "video"))
    || (sourceType === "video" && targetType === "video")
  )
  if (!allowed) return { valid: false, reason: "connection.invalid" }
  if (targetType === "video" && sourceType === "image") {
    const incomingImageCount = edges.filter((edge) => {
      if (edge.target !== connection.target) return false
      const edgeSourceType = nodes.find((node) => node.id === edge.source)?.data.cinemaType
      return edgeSourceType === "image"
    }).length
    if (incomingImageCount >= 2) return { valid: false, reason: "connection.videoImageLimit" }
  }
  return { valid: true }
}
