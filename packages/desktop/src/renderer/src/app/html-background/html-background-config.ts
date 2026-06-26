import {
  DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG,
  normalizeAppearanceHtmlBackgroundConfig,
  resolveAppearanceHtmlBackgroundState,
  type AppearanceDesktopBackgroundMode,
  type AppearanceHtmlBackgroundConfig,
  type AppearanceHtmlBackgroundRenderMode,
  type AppearanceHtmlBackgroundState,
} from "../../../../shared/appearance"

export type HtmlBackgroundRenderMode = AppearanceHtmlBackgroundRenderMode
export type DesktopBackgroundMode = AppearanceDesktopBackgroundMode
export type HtmlBackgroundConfig = AppearanceHtmlBackgroundConfig
export type HtmlBackgroundAppearanceState = AppearanceHtmlBackgroundState

export const HTML_BACKGROUND_STORAGE_KEY = "desktop.htmlBackground.v1"

export const DEFAULT_HTML_BACKGROUND_CONFIG: HtmlBackgroundConfig = DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG

export function normalizeHtmlBackgroundConfig(value: unknown): HtmlBackgroundConfig {
  return normalizeAppearanceHtmlBackgroundConfig(value)
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

export function resolveHtmlBackgroundAppearance(config: HtmlBackgroundConfig): HtmlBackgroundAppearanceState {
  return resolveAppearanceHtmlBackgroundState(config)
}
