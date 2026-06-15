export const DEFAULT_LIGHT_CODE_THEME = "github-light"
export const DEFAULT_DARK_CODE_THEME = "github-dark"
export const DEFAULT_CODE_THEME_PREFERENCE = "auto"

export const CODE_HIGHLIGHT_THEMES = [
  DEFAULT_LIGHT_CODE_THEME,
  DEFAULT_DARK_CODE_THEME,
  "vitesse-light",
  "vitesse-dark",
  "nord",
  "dracula",
] as const

export type CodeHighlightTheme = typeof CODE_HIGHLIGHT_THEMES[number]
export type CodeThemePreference = typeof DEFAULT_CODE_THEME_PREFERENCE | CodeHighlightTheme
export type ResolvedColorMode = "light" | "dark"

export const CODE_THEME_LABELS: Record<CodeHighlightTheme, string> = {
  "github-light": "GitHub Light",
  "github-dark": "GitHub Dark",
  "vitesse-light": "Vitesse Light",
  "vitesse-dark": "Vitesse Dark",
  nord: "Nord",
  dracula: "Dracula",
}

const CODE_HIGHLIGHT_THEME_SET = new Set<string>(CODE_HIGHLIGHT_THEMES)

export function isCodeHighlightTheme(value: string | null | undefined): value is CodeHighlightTheme {
  return Boolean(value && CODE_HIGHLIGHT_THEME_SET.has(value))
}

export function normalizeCodeThemePreference(value: string | null | undefined): CodeThemePreference {
  if (value === DEFAULT_CODE_THEME_PREFERENCE || isCodeHighlightTheme(value)) return value
  return DEFAULT_CODE_THEME_PREFERENCE
}

export function resolveCodeHighlightTheme(
  preference: CodeThemePreference,
  resolvedColorMode: ResolvedColorMode,
): CodeHighlightTheme {
  if (preference !== DEFAULT_CODE_THEME_PREFERENCE) return preference
  return resolvedColorMode === "dark" ? DEFAULT_DARK_CODE_THEME : DEFAULT_LIGHT_CODE_THEME
}
