export type HtmlBackgroundRenderMode = "dynamic" | "static"

export interface HtmlBackgroundConfig {
  blurPx: number
  dim: number
  enabled: boolean
  html: string
  opacity: number
  paused: boolean
  renderMode: HtmlBackgroundRenderMode
  surfaceOpacity: number
}

export const HTML_BACKGROUND_STORAGE_KEY = "desktop.htmlBackground.v1"

export const DEFAULT_HTML_BACKGROUND_CONFIG: HtmlBackgroundConfig = {
  blurPx: 0,
  dim: 0.18,
  enabled: false,
  html: "",
  opacity: 0.78,
  paused: false,
  renderMode: "static",
  surfaceOpacity: 0.68,
}

const MAX_HTML_BACKGROUND_HTML_LENGTH = 220_000
const LEGACY_LOW_VISIBILITY_DEFAULTS = {
  dim: 0.34,
  opacity: 0.64,
  surfaceOpacity: 0.82,
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(max, Math.max(min, numberValue))
}

export function normalizeHtmlBackgroundConfig(value: unknown): HtmlBackgroundConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_HTML_BACKGROUND_CONFIG }
  }

  const record = value as Record<string, unknown>
  const rawHtml = typeof record.html === "string" ? record.html : ""
  const html = rawHtml.length > MAX_HTML_BACKGROUND_HTML_LENGTH
    ? rawHtml.slice(0, MAX_HTML_BACKGROUND_HTML_LENGTH)
    : rawHtml
  const usesLegacyLowVisibilityDefaults =
    record.dim === LEGACY_LOW_VISIBILITY_DEFAULTS.dim &&
    record.opacity === LEGACY_LOW_VISIBILITY_DEFAULTS.opacity &&
    record.surfaceOpacity === LEGACY_LOW_VISIBILITY_DEFAULTS.surfaceOpacity

  return {
    blurPx: clampNumber(record.blurPx, 0, 24, DEFAULT_HTML_BACKGROUND_CONFIG.blurPx),
    dim: usesLegacyLowVisibilityDefaults
      ? DEFAULT_HTML_BACKGROUND_CONFIG.dim
      : clampNumber(record.dim, 0, 0.86, DEFAULT_HTML_BACKGROUND_CONFIG.dim),
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_HTML_BACKGROUND_CONFIG.enabled,
    html,
    opacity: usesLegacyLowVisibilityDefaults
      ? DEFAULT_HTML_BACKGROUND_CONFIG.opacity
      : clampNumber(record.opacity, 0.08, 1, DEFAULT_HTML_BACKGROUND_CONFIG.opacity),
    paused: typeof record.paused === "boolean" ? record.paused : DEFAULT_HTML_BACKGROUND_CONFIG.paused,
    renderMode: record.renderMode === "dynamic" ? "dynamic" : DEFAULT_HTML_BACKGROUND_CONFIG.renderMode,
    surfaceOpacity: usesLegacyLowVisibilityDefaults
      ? DEFAULT_HTML_BACKGROUND_CONFIG.surfaceOpacity
      : clampNumber(record.surfaceOpacity, 0.36, 1, DEFAULT_HTML_BACKGROUND_CONFIG.surfaceOpacity),
  }
}

export function readHtmlBackgroundConfigPreference(): HtmlBackgroundConfig {
  if (typeof window === "undefined") return { ...DEFAULT_HTML_BACKGROUND_CONFIG }

  try {
    const storedValue = window.localStorage.getItem(HTML_BACKGROUND_STORAGE_KEY)
    if (!storedValue) return { ...DEFAULT_HTML_BACKGROUND_CONFIG }
    return normalizeHtmlBackgroundConfig(JSON.parse(storedValue))
  } catch {
    return { ...DEFAULT_HTML_BACKGROUND_CONFIG }
  }
}

export function serializeHtmlBackgroundConfig(config: HtmlBackgroundConfig) {
  return JSON.stringify(normalizeHtmlBackgroundConfig(config))
}
