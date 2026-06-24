import {
  APPEARANCE_CODE_HIGHLIGHT_THEMES,
  DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE,
  isAppearanceCodeHighlightTheme,
  normalizeAppearanceCodeThemePreference,
  type AppearanceCodeHighlightTheme,
  type AppearanceCodeThemePreference,
} from "../../../shared/appearance"

export const DEFAULT_LIGHT_CODE_THEME = "github-light"
export const DEFAULT_DARK_CODE_THEME = "github-dark"
export const DEFAULT_CODE_THEME_PREFERENCE = DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE

export const CODE_HIGHLIGHT_THEMES = APPEARANCE_CODE_HIGHLIGHT_THEMES

export type CodeHighlightTheme = AppearanceCodeHighlightTheme
export type CodeThemePreference = AppearanceCodeThemePreference
export type ResolvedColorMode = "light" | "dark"

export const CODE_THEME_LABELS: Record<CodeHighlightTheme, string> = {
  "github-light": "GitHub Light",
  "github-dark": "GitHub Dark",
  "vitesse-light": "Vitesse Light",
  "vitesse-dark": "Vitesse Dark",
  nord: "Nord",
  dracula: "Dracula",
}

export function isCodeHighlightTheme(value: string | null | undefined): value is CodeHighlightTheme {
  return isAppearanceCodeHighlightTheme(value)
}

export function normalizeCodeThemePreference(value: string | null | undefined): CodeThemePreference {
  return normalizeAppearanceCodeThemePreference(value)
}

export function resolveCodeHighlightTheme(
  preference: CodeThemePreference,
  resolvedColorMode: ResolvedColorMode,
): CodeHighlightTheme {
  if (preference !== DEFAULT_CODE_THEME_PREFERENCE) return preference
  return resolvedColorMode === "dark" ? DEFAULT_DARK_CODE_THEME : DEFAULT_LIGHT_CODE_THEME
}
