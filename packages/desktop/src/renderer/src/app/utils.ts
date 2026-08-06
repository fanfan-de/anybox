import {
  MAX_RIGHT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_CANVAS_WIDTH,
  MIN_RIGHT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  RIGHT_SIDEBAR_MIN_LEFT_EDGE_RATIO,
} from "./constants"
import { normalizeAppLocale, type AppLocale } from "../../../shared/locale"

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function resolveWidthBounds(
  containerWidth: number | undefined,
  minWidth: number,
  maxWidth: number,
  minContentWidth: number,
) {
  if (!containerWidth || containerWidth <= 0) {
    return {
      min: minWidth,
      max: maxWidth,
    }
  }

  return {
    min: minWidth,
    max: Math.min(maxWidth, Math.max(minWidth, containerWidth - minContentWidth)),
  }
}

export function resolveSidebarWidthBounds(containerWidth?: number) {
  return resolveWidthBounds(containerWidth, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_CANVAS_WIDTH)
}

export function resolveRightSidebarWidthBounds(
  containerWidth?: number,
  minLeftEdgeRatio = RIGHT_SIDEBAR_MIN_LEFT_EDGE_RATIO,
  minWidth = MIN_RIGHT_SIDEBAR_WIDTH,
) {
  return resolveWidthBounds(
    containerWidth,
    minWidth,
    MAX_RIGHT_SIDEBAR_WIDTH,
    containerWidth && containerWidth > 0 ? Math.max(0, containerWidth * minLeftEdgeRatio) : 0,
  )
}

export function createID(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function getDocumentLocale(): AppLocale {
  if (typeof document === "undefined") return "zh-CN"
  return normalizeAppLocale(document.documentElement.lang)
}

export function formatTime(timestamp: number, locale: AppLocale = getDocumentLocale()) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp)
}

export function compactText(input: string, maxLength = 180) {
  const normalized = input.replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized
}
