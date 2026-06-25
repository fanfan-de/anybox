import {
  DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE,
  DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG,
  createDefaultAppearanceConfigDocument,
  normalizeAppearanceCodeThemePreference,
  normalizeAppearanceConfigDocument,
  normalizeAppearanceHtmlBackgroundConfig,
  type AppearanceBrandTheme,
  type AppearanceCodeThemePreference,
  type AppearanceColorMode,
  type AppearanceFontFamily,
  type AppearanceHtmlBackgroundConfig,
  type AppearanceTokenMap,
} from "./appearance"

export type AppearanceThemeSource = "built-in" | "user" | "imported"

export interface AppearanceTheme {
  id: string
  name: string
  source: AppearanceThemeSource
  readonly: boolean
  createdAt: number
  updatedAt: number
  colorMode: AppearanceColorMode
  brandTheme: AppearanceBrandTheme
  fontFamily: AppearanceFontFamily
  codeThemePreference: AppearanceCodeThemePreference
  htmlBackgroundConfig: AppearanceHtmlBackgroundConfig
  overrides: AppearanceTokenMap
}

export interface AppearanceThemePreset extends AppearanceTheme {
  source: "built-in"
  readonly: true
}

export interface AppearanceThemeDocument {
  version: 1
  activeThemeID: string
  userThemes: AppearanceTheme[]
}

export interface AppearanceThemeLibrarySnapshot {
  path: string
  exists: boolean
  document: AppearanceThemeDocument
  builtInThemes: AppearanceThemePreset[]
  themes: AppearanceTheme[]
  activeThemeID: string
}

export interface AppearanceThemeSaveInput {
  id?: string
  name: string
  source?: AppearanceThemeSource
  colorMode: AppearanceColorMode
  brandTheme: AppearanceBrandTheme
  fontFamily: AppearanceFontFamily
  codeThemePreference: AppearanceCodeThemePreference
  htmlBackgroundConfig: AppearanceHtmlBackgroundConfig
  overrides: AppearanceTokenMap
}

export interface AppearanceThemeDuplicateInput {
  themeID: string
  name?: string
}

export interface AppearanceThemeMutationResult {
  snapshot: AppearanceThemeLibrarySnapshot
  theme: AppearanceTheme | null
}

export const DEFAULT_APPEARANCE_THEME_ID = "built-in:anybox-terra"

const APPEARANCE_THEME_ID_PATTERN = /^[a-z0-9:_-]+$/i
const MAX_APPEARANCE_THEME_ID_LENGTH = 120
const MAX_APPEARANCE_THEME_NAME_LENGTH = 80
const DEFAULT_USER_THEME_NAME = "My Theme"
const DEFAULT_APPEARANCE_OVERRIDES = createDefaultAppearanceConfigDocument().overrides

const NIGHT_WORKBENCH_OVERRIDES = {
  "surface-app-dark": "#0f172a",
  "surface-shell-dark": "#111827",
  "surface-panel-dark": "#1f2937",
  "surface-panel-muted-dark": "#273244",
  "surface-sidebar-dark": "#111827",
  "surface-sidebar-strong-dark": "#0b1120",
  "surface-user-bubble-dark": "#2563eb",
  "surface-trace-dark": "#172033",
  "surface-elevated-dark": "#273244",
  "text-primary-dark": "#f8fafc",
  "text-secondary-dark": "#cbd5e1",
  "text-tertiary-dark": "#94a3b8",
  "brand-primary-dark": "#38bdf8",
  "brand-primary-hover-dark": "#7dd3fc",
  "brand-accent-highlight-dark": "#22d3ee",
  "brand-primary-soft-dark": "rgba(56, 189, 248, 0.16)",
  "brand-primary-soft-strong-dark": "rgba(56, 189, 248, 0.24)",
  "semantic-sidebar-tree-row-surface-active-dark": "rgba(56, 189, 248, 0.18)",
  "semantic-sidebar-tree-row-leading-active-dark": "#38bdf8",
  "semantic-composer-surface-dark": "#1f2937",
  "semantic-dropdown-menu-surface-dark": "#273244",
  "semantic-thread-panel-surface-dark": "#1f2937",
  "semantic-thread-panel-surface-muted-dark": "#273244",
  "semantic-thread-panel-surface-hover-dark": "#223047",
} satisfies AppearanceTokenMap

const SOFT_LIGHT_OVERRIDES = {
  "surface-app-light": "#fbfaf7",
  "surface-shell-light": "#f3eee7",
  "surface-panel-light": "#fffdf9",
  "surface-panel-muted-light": "#f4eee6",
  "surface-sidebar-light": "#f2eadf",
  "surface-sidebar-strong-light": "#eadfce",
  "surface-user-bubble-light": "#fff8f0",
  "surface-trace-light": "#fffdf9",
  "surface-elevated-light": "#f7f0e6",
  "text-primary-light": "#241f1c",
  "text-secondary-light": "#70665d",
  "text-tertiary-light": "#9a8b7b",
  "border-subtle-light": "#e8dcca",
  "border-default-light": "rgba(36, 31, 28, 0.12)",
  "brand-primary": "#b9794f",
  "brand-primary-hover": "#9f633e",
  "brand-accent-highlight": "#d89c6a",
  "brand-primary-soft": "rgba(185, 121, 79, 0.14)",
  "brand-primary-soft-strong": "rgba(185, 121, 79, 0.22)",
  "semantic-sidebar-tree-row-surface-active-light": "rgba(185, 121, 79, 0.16)",
  "semantic-sidebar-tree-row-leading-active-light": "#b9794f",
  "semantic-composer-surface-light": "#fffdf9",
  "semantic-dropdown-menu-surface-light": "#fffdf9",
  "semantic-thread-panel-surface-light": "#fffdf9",
  "semantic-thread-panel-surface-muted-light": "#f4eee6",
  "semantic-thread-panel-surface-hover-light": "#f7f0e6",
} satisfies AppearanceTokenMap

export const BUILT_IN_APPEARANCE_THEME_PRESETS = [
  {
    id: DEFAULT_APPEARANCE_THEME_ID,
    name: "Anybox Terra",
    source: "built-in",
    readonly: true,
    createdAt: 0,
    updatedAt: 0,
    colorMode: "light",
    brandTheme: "terra",
    fontFamily: "default",
    codeThemePreference: DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE,
    htmlBackgroundConfig: { ...DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG },
    overrides: { ...DEFAULT_APPEARANCE_OVERRIDES },
  },
  {
    id: "built-in:sage-slate",
    name: "Sage Slate",
    source: "built-in",
    readonly: true,
    createdAt: 0,
    updatedAt: 0,
    colorMode: "system",
    brandTheme: "sage",
    fontFamily: "default",
    codeThemePreference: DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE,
    htmlBackgroundConfig: { ...DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG },
    overrides: {},
  },
  {
    id: "built-in:night-workbench",
    name: "Night Workbench",
    source: "built-in",
    readonly: true,
    createdAt: 0,
    updatedAt: 0,
    colorMode: "dark",
    brandTheme: "sage",
    fontFamily: "default",
    codeThemePreference: "nord",
    htmlBackgroundConfig: { ...DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG },
    overrides: { ...NIGHT_WORKBENCH_OVERRIDES },
  },
  {
    id: "built-in:soft-light",
    name: "Soft Light",
    source: "built-in",
    readonly: true,
    createdAt: 0,
    updatedAt: 0,
    colorMode: "light",
    brandTheme: "terra",
    fontFamily: "default",
    codeThemePreference: "github-light",
    htmlBackgroundConfig: { ...DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG },
    overrides: { ...SOFT_LIGHT_OVERRIDES },
  },
] as const satisfies readonly AppearanceThemePreset[]

const BUILT_IN_APPEARANCE_THEME_IDS = new Set<string>(BUILT_IN_APPEARANCE_THEME_PRESETS.map((theme) => theme.id))

export function isBuiltInAppearanceThemeID(themeID: string) {
  return BUILT_IN_APPEARANCE_THEME_IDS.has(themeID)
}

export function normalizeAppearanceThemeID(value: unknown): string | null {
  if (typeof value !== "string") return null

  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_APPEARANCE_THEME_ID_LENGTH) return null
  return APPEARANCE_THEME_ID_PATTERN.test(trimmed) ? trimmed : null
}

function normalizeAppearanceThemeName(value: unknown, fallback = DEFAULT_USER_THEME_NAME) {
  if (typeof value !== "string") return fallback

  const trimmed = value.trim().replace(/\s+/g, " ")
  return trimmed ? trimmed.slice(0, MAX_APPEARANCE_THEME_NAME_LENGTH) : fallback
}

function normalizeAppearanceThemeTimestamp(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback
}

function normalizeUserThemeSource(value: unknown): "user" | "imported" {
  return value === "imported" ? "imported" : "user"
}

function normalizeThemeCore(record: Record<string, unknown>) {
  const document = normalizeAppearanceConfigDocument({
    brandTheme: record.brandTheme,
    colorMode: record.colorMode,
    fontFamily: record.fontFamily,
    overrides: record.overrides,
    resolvedTokens: {},
    updatedAt: 0,
  })

  return {
    colorMode: document.colorMode,
    brandTheme: document.brandTheme,
    fontFamily: document.fontFamily,
    codeThemePreference: normalizeAppearanceCodeThemePreference(record.codeThemePreference),
    htmlBackgroundConfig: normalizeAppearanceHtmlBackgroundConfig(record.htmlBackgroundConfig),
    overrides: document.overrides,
  }
}

export function normalizeAppearanceThemeRecord(
  input: unknown,
  options: {
    fallbackID: string
    fallbackName?: string
    now?: number
    source?: "user" | "imported"
  },
): AppearanceTheme | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null

  const record = input as Record<string, unknown>
  const id = normalizeAppearanceThemeID(record.id) ?? normalizeAppearanceThemeID(options.fallbackID)
  if (!id || isBuiltInAppearanceThemeID(id)) return null

  const now = options.now ?? Date.now()
  const createdAt = normalizeAppearanceThemeTimestamp(record.createdAt, now)
  const updatedAt = normalizeAppearanceThemeTimestamp(record.updatedAt, createdAt)
  const source = options.source ?? normalizeUserThemeSource(record.source)

  return {
    id,
    name: normalizeAppearanceThemeName(record.name, options.fallbackName),
    source,
    readonly: false,
    createdAt,
    updatedAt,
    ...normalizeThemeCore(record),
  }
}

export function normalizeAppearanceThemeSaveInput(
  input: unknown,
  options: {
    fallbackID: string
    now?: number
    existingTheme?: AppearanceTheme
  },
): AppearanceTheme {
  const now = options.now ?? Date.now()
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
  const requestedID = normalizeAppearanceThemeID(record.id)
  const id = requestedID && !isBuiltInAppearanceThemeID(requestedID) ? requestedID : options.fallbackID
  const existingTheme = options.existingTheme

  return {
    id,
    name: normalizeAppearanceThemeName(record.name, existingTheme?.name ?? DEFAULT_USER_THEME_NAME),
    source: normalizeUserThemeSource(record.source),
    readonly: false,
    createdAt: existingTheme?.createdAt ?? now,
    updatedAt: now,
    ...normalizeThemeCore(record),
  }
}

export function createDefaultAppearanceThemeDocument(): AppearanceThemeDocument {
  return {
    version: 1,
    activeThemeID: DEFAULT_APPEARANCE_THEME_ID,
    userThemes: [],
  }
}

export function normalizeAppearanceThemeDocument(input: unknown): AppearanceThemeDocument {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return createDefaultAppearanceThemeDocument()
  }

  const record = input as Record<string, unknown>
  const userThemesInput = Array.isArray(record.userThemes) ? record.userThemes : []
  const seenThemeIDs = new Set<string>(BUILT_IN_APPEARANCE_THEME_IDS)
  const userThemes: AppearanceTheme[] = []

  for (const [index, themeInput] of userThemesInput.entries()) {
    const theme = normalizeAppearanceThemeRecord(themeInput, {
      fallbackID: `user:theme-${index + 1}`,
      fallbackName: `Theme ${index + 1}`,
    })
    if (!theme || seenThemeIDs.has(theme.id)) continue

    seenThemeIDs.add(theme.id)
    userThemes.push(theme)
  }

  const activeThemeID = normalizeAppearanceThemeID(record.activeThemeID)
  const hasActiveTheme = Boolean(activeThemeID && seenThemeIDs.has(activeThemeID))

  return {
    version: 1,
    activeThemeID: hasActiveTheme ? activeThemeID! : DEFAULT_APPEARANCE_THEME_ID,
    userThemes,
  }
}

export function createAppearanceThemeLibrarySnapshot(input: {
  path: string
  exists: boolean
  document: AppearanceThemeDocument
}): AppearanceThemeLibrarySnapshot {
  const document = normalizeAppearanceThemeDocument(input.document)
  const themes = [
    ...BUILT_IN_APPEARANCE_THEME_PRESETS.map((theme) => ({
      ...theme,
      htmlBackgroundConfig: { ...theme.htmlBackgroundConfig },
      overrides: { ...theme.overrides },
    })),
    ...document.userThemes.map((theme) => ({
      ...theme,
      htmlBackgroundConfig: { ...theme.htmlBackgroundConfig },
      overrides: { ...theme.overrides },
    })),
  ]
  const activeTheme = themes.find((theme) => theme.id === document.activeThemeID)
  const activeThemeID = activeTheme?.id ?? DEFAULT_APPEARANCE_THEME_ID

  return {
    path: input.path,
    exists: input.exists,
    document: {
      ...document,
      activeThemeID,
      userThemes: document.userThemes.map((theme) => ({
        ...theme,
        htmlBackgroundConfig: { ...theme.htmlBackgroundConfig },
        overrides: { ...theme.overrides },
      })),
    },
    builtInThemes: BUILT_IN_APPEARANCE_THEME_PRESETS.map((theme) => ({
      ...theme,
      htmlBackgroundConfig: { ...theme.htmlBackgroundConfig },
      overrides: { ...theme.overrides },
    })),
    themes,
    activeThemeID,
  }
}

export function findAppearanceThemeByID(
  themes: readonly AppearanceTheme[],
  themeID: string | null | undefined,
): AppearanceTheme | null {
  if (!themeID) return null
  return themes.find((theme) => theme.id === themeID) ?? null
}
