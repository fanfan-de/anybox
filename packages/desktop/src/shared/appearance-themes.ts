import {
  BUILT_IN_APPEARANCE_THEME_DEFINITIONS,
  DEFAULT_APPEARANCE_THEME_ID,
} from "./appearance-tokens.generated"
import {
  normalizeAppearanceCodeThemePreference,
  normalizeAppearanceConfigDocument,
  normalizeAppearanceHtmlBackgroundConfig,
  validateAppearanceConfigDocumentStructure,
  type AppearanceBrandTheme,
  type AppearanceCodeThemePreference,
  type AppearanceColorMode,
  type AppearanceFontFamily,
  type AppearanceHtmlBackgroundConfig,
  type AppearanceTokenMap,
} from "./appearance"

export { DEFAULT_APPEARANCE_THEME_ID } from "./appearance-tokens.generated"

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
  foreignDtcg: Record<string, unknown>
}

export interface AppearanceThemePreset extends AppearanceTheme {
  source: "built-in"
  readonly: true
}

export interface AppearanceThemeDocument {
  version: 2
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
  foreignDtcg?: Record<string, unknown>
}

export interface AppearanceThemeDuplicateInput {
  themeID: string
  name?: string
}

export interface AppearanceThemeRenameInput {
  themeID: string
  name: string
}

export interface AppearanceThemeMutationResult {
  snapshot: AppearanceThemeLibrarySnapshot
  theme: AppearanceTheme | null
}

const APPEARANCE_THEME_ID_PATTERN = /^[a-z0-9:_-]+$/i
const MAX_APPEARANCE_THEME_ID_LENGTH = 120
const MAX_APPEARANCE_THEME_NAME_LENGTH = 80
const DEFAULT_USER_THEME_NAME = "My Theme"

export const BUILT_IN_APPEARANCE_THEME_PRESETS = BUILT_IN_APPEARANCE_THEME_DEFINITIONS.map(
  (theme) => ({
    ...theme,
    source: "built-in" as const,
    readonly: true as const,
    createdAt: 0,
    updatedAt: 0,
    htmlBackgroundConfig: { ...theme.htmlBackgroundConfig },
    overrides: { ...theme.overrides },
    foreignDtcg: {},
  }),
) satisfies readonly AppearanceThemePreset[]

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
    foreignDtcg: record.foreignDtcg,
    updatedAt: 0,
  })

  return {
    colorMode: document.colorMode,
    brandTheme: document.brandTheme,
    fontFamily: document.fontFamily,
    codeThemePreference: normalizeAppearanceCodeThemePreference(record.codeThemePreference),
    htmlBackgroundConfig: normalizeAppearanceHtmlBackgroundConfig(record.htmlBackgroundConfig),
    overrides: document.overrides,
    foreignDtcg: document.foreignDtcg,
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

export function validateAppearanceThemeSaveInputStructure(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return ["Appearance theme must be a JSON object."]
  }

  const record = input as Record<string, unknown>
  const errors = validateAppearanceConfigDocumentStructure({
    version: 2,
    brandTheme: record.brandTheme,
    colorMode: record.colorMode,
    fontFamily: record.fontFamily,
    overrides: record.overrides,
    foreignDtcg: record.foreignDtcg,
  })
  if (typeof record.name !== "string" || !record.name.trim()) {
    errors.push("Appearance theme name must be a non-empty string.")
  }
  if (record.id !== undefined && !normalizeAppearanceThemeID(record.id)) {
    errors.push("Appearance theme id is invalid.")
  }
  if (
    record.source !== undefined &&
    record.source !== "user" &&
    record.source !== "imported"
  ) {
    errors.push("Appearance theme source must be \"user\" or \"imported\".")
  }
  for (const field of ["brandTheme", "colorMode", "fontFamily", "overrides"] as const) {
    if (!Object.hasOwn(record, field)) {
      errors.push(`Appearance theme is missing "${field}".`)
    }
  }
  if (
    typeof record.codeThemePreference !== "string" ||
    normalizeAppearanceCodeThemePreference(record.codeThemePreference) !== record.codeThemePreference
  ) {
    errors.push("Appearance theme codeThemePreference is unsupported.")
  }
  if (
    !record.htmlBackgroundConfig ||
    typeof record.htmlBackgroundConfig !== "object" ||
    Array.isArray(record.htmlBackgroundConfig)
  ) {
    errors.push("Appearance theme htmlBackgroundConfig must be an object.")
  }
  return errors
}

export function validateAppearanceThemeDocumentStructure(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return ["Appearance theme library must be a JSON object."]
  }

  const record = input as Record<string, unknown>
  if (record.version !== undefined && record.version !== 1 && record.version !== 2) {
    return [`Unsupported appearance theme library version "${String(record.version)}".`]
  }
  const isCurrentDocument = record.version === 2
  const errors: string[] = []
  if (isCurrentDocument) {
    if (typeof record.activeThemeID !== "string" || !normalizeAppearanceThemeID(record.activeThemeID)) {
      errors.push("Appearance theme library activeThemeID is invalid.")
    }
    if (!Object.hasOwn(record, "userThemes")) {
      errors.push("Appearance theme library is missing \"userThemes\".")
    }
  }
  if (record.userThemes !== undefined && !Array.isArray(record.userThemes)) {
    errors.push("Appearance theme library userThemes must be an array.")
    return errors
  }

  const documentVersion = isCurrentDocument ? 2 : 1
  const seenThemeIDs = new Set<string>()
  for (const [index, theme] of ((record.userThemes as unknown[] | undefined) ?? []).entries()) {
    if (!theme || typeof theme !== "object" || Array.isArray(theme)) {
      errors.push(`Appearance theme at index ${index} must be an object.`)
      continue
    }
    const themeRecord = theme as Record<string, unknown>
    const themeErrors = validateAppearanceConfigDocumentStructure({
      ...themeRecord,
      version: documentVersion,
    }, {
      requireComplete: isCurrentDocument,
    })
    errors.push(...themeErrors.map((error) => `Theme ${index + 1}: ${error}`))
    if (!isCurrentDocument) continue

    const id = normalizeAppearanceThemeID(themeRecord.id)
    if (!id || isBuiltInAppearanceThemeID(id)) {
      errors.push(`Theme ${index + 1}: id is invalid or reserved.`)
    } else if (seenThemeIDs.has(id)) {
      errors.push(`Theme ${index + 1}: duplicate id "${id}".`)
    } else {
      seenThemeIDs.add(id)
    }
    if (typeof themeRecord.name !== "string" || !themeRecord.name.trim()) {
      errors.push(`Theme ${index + 1}: name must be a non-empty string.`)
    }
    if (themeRecord.source !== "user" && themeRecord.source !== "imported") {
      errors.push(`Theme ${index + 1}: source must be "user" or "imported".`)
    }
    if (themeRecord.readonly !== false) {
      errors.push(`Theme ${index + 1}: readonly must be false.`)
    }
    if (
      typeof themeRecord.createdAt !== "number" ||
      !Number.isFinite(themeRecord.createdAt) ||
      themeRecord.createdAt < 0
    ) {
      errors.push(`Theme ${index + 1}: createdAt must be a non-negative finite number.`)
    }
    if (
      typeof themeRecord.codeThemePreference !== "string" ||
      normalizeAppearanceCodeThemePreference(themeRecord.codeThemePreference) !==
        themeRecord.codeThemePreference
    ) {
      errors.push(`Theme ${index + 1}: codeThemePreference is unsupported.`)
    }
    if (
      !themeRecord.htmlBackgroundConfig ||
      typeof themeRecord.htmlBackgroundConfig !== "object" ||
      Array.isArray(themeRecord.htmlBackgroundConfig)
    ) {
      errors.push(`Theme ${index + 1}: htmlBackgroundConfig must be an object.`)
    }
  }
  return errors
}

export function createDefaultAppearanceThemeDocument(): AppearanceThemeDocument {
  return {
    version: 2,
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
    version: 2,
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
      foreignDtcg: structuredClone(theme.foreignDtcg),
    })),
    ...document.userThemes.map((theme) => ({
      ...theme,
      htmlBackgroundConfig: { ...theme.htmlBackgroundConfig },
      overrides: { ...theme.overrides },
      foreignDtcg: structuredClone(theme.foreignDtcg),
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
        foreignDtcg: structuredClone(theme.foreignDtcg),
      })),
    },
    builtInThemes: BUILT_IN_APPEARANCE_THEME_PRESETS.map((theme) => ({
      ...theme,
      htmlBackgroundConfig: { ...theme.htmlBackgroundConfig },
      overrides: { ...theme.overrides },
      foreignDtcg: structuredClone(theme.foreignDtcg),
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
