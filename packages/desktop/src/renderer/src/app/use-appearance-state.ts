import { useEffect, useMemo, useRef, useState } from "react"
import {
  APPEARANCE_TOKEN_GROUPS,
  isAppearanceCodeFontFamily,
  isAppearanceTokenName,
  isAppearanceFontFamily,
  normalizeAppearanceConfigDocument,
  normalizeAppearanceRuntimeState,
  type AppearanceConfigDocument,
  type AppearanceCodeFontFamily,
  type AppearanceFontFamily,
  type AppearanceRuntimeState,
  type AppearanceTokenMap,
  type AppearanceTokenName,
  type AppearanceTokenValue,
} from "../../../shared/appearance"
import {
  evaluateAppearanceContrastWarnings,
  parseAppearanceColorLiteral,
  resolveAppearanceTokenCssValues,
} from "../../../shared/appearance-color"
import {
  AppearanceDtcgValidationError,
  parseAppearanceDtcgJson,
  serializeAppearanceThemeToDtcg,
} from "../../../shared/appearance-dtcg"
import {
  createAppearanceThemeLibrarySnapshot,
  createDefaultAppearanceThemeDocument,
  findAppearanceThemeByID,
  type AppearanceTheme,
  type AppearanceThemeLibrarySnapshot,
  type AppearanceThemeSaveInput,
} from "../../../shared/appearance-themes"
import type {
  SemanticTokenAuthoringDraft,
  SemanticTokenThemeValueEdit,
} from "../../../shared/semantic-token-authoring"
import { applyAppearanceOverrides } from "./appearance-theme"
import { resolveCodeFontFamilyStack } from "./code-font"
import {
  normalizeCodeThemePreference,
  resolveCodeHighlightTheme,
  type CodeThemePreference,
  type ResolvedColorMode,
} from "./code-theme"
import type { BrandTheme, ColorMode } from "./types"

const COLOR_MODE_STORAGE_KEY = "desktop.colorMode"
const CODE_THEME_STORAGE_KEY = "desktop.codeTheme"
const BRAND_THEME_STORAGE_KEY = "desktop.brandTheme"
const FONT_FAMILY_STORAGE_KEY = "desktop.fontFamily"
const CODE_FONT_FAMILY_STORAGE_KEY = "desktop.codeFontFamily"
const APPEARANCE_CONFIG_SAVE_DEBOUNCE_MS = 160

const SEMANTIC_RUNTIME_MODE_TOKENS = new Map(
  APPEARANCE_TOKEN_GROUPS.flatMap((group) =>
    group.rows.map((row) => {
      const runtimeToken = "runtimeToken" in row ? row.runtimeToken : row.id
      return [
        runtimeToken,
        { light: row.lightToken, dark: row.darkToken },
      ] as const
    }),
  ),
)

function authoringModeToken(
  edit: SemanticTokenThemeValueEdit,
  createdRuntimeTokens: ReadonlySet<string>,
) {
  const existing = SEMANTIC_RUNTIME_MODE_TOKENS.get(edit.runtimeToken)
  if (existing) return existing[edit.mode]
  return createdRuntimeTokens.has(edit.runtimeToken)
    ? `${edit.runtimeToken}-${edit.mode}`
    : null
}

export function applySemanticAuthoringDraftToOverrides(
  current: AppearanceTokenMap,
  draft: SemanticTokenAuthoringDraft,
  includeNewTokens: boolean,
) {
  const next = { ...current } as Record<string, AppearanceTokenValue>
  const createdRuntimeTokens = new Set(
    draft.operations
      .filter((operation) => operation.kind === "token-creation")
      .map((operation) => operation.runtimeToken),
  )
  for (const operation of draft.operations) {
    if (operation.kind === "token-creation") {
      if (!includeNewTokens) continue
      const light = parseAppearanceColorLiteral(operation.light.value)
      const dark = parseAppearanceColorLiteral(operation.dark.value)
      if (light) next[`${operation.runtimeToken}-light`] = light
      if (dark) next[`${operation.runtimeToken}-dark`] = dark
      continue
    }
    if (operation.kind !== "theme-token-value-edit") continue
    const modeToken = authoringModeToken(operation, createdRuntimeTokens)
    if (!modeToken || (!includeNewTokens && !isAppearanceTokenName(modeToken))) continue
    if (operation.action === "reset") {
      delete next[modeToken]
      continue
    }
    const value = parseAppearanceColorLiteral(operation.value ?? "")
    if (value) next[modeToken] = value
  }
  return next as AppearanceTokenMap
}

const DEFAULT_APPEARANCE_TOKEN_VALUES = resolveAppearanceTokenCssValues({
  brandTheme: "terra",
})

function createDefaultAppearanceThemeSnapshot(): AppearanceThemeLibrarySnapshot {
  return createAppearanceThemeLibrarySnapshot({
    path: "",
    exists: false,
    document: createDefaultAppearanceThemeDocument(),
  })
}

function readColorModePreference(): ColorMode {
  if (typeof window === "undefined") return "system"
  try {
    const stored = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY)
    if (stored === "light" || stored === "dark" || stored === "system") return stored
    return "system"
  } catch {
    return "system"
  }
}

function readCodeThemePreference(): CodeThemePreference {
  if (typeof window === "undefined") return "auto"
  try {
    return normalizeCodeThemePreference(window.localStorage.getItem(CODE_THEME_STORAGE_KEY))
  } catch {
    return "auto"
  }
}

function readBrandThemePreference(): BrandTheme {
  if (typeof window === "undefined") return "terra"
  try {
    const stored = window.localStorage.getItem(BRAND_THEME_STORAGE_KEY)
    if (stored === "terra" || stored === "sage") return stored
    return "terra"
  } catch {
    return "terra"
  }
}

function readSystemDarkModePreference() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
  } catch {
    return false
  }
}

function readFontFamilyPreference(): AppearanceFontFamily {
  if (typeof window === "undefined") return "default"
  try {
    const stored = window.localStorage.getItem(FONT_FAMILY_STORAGE_KEY)
    if (stored && isAppearanceFontFamily(stored)) {
      return stored
    }
    return "default"
  } catch {
    return "default"
  }
}

function readCodeFontFamilyPreference(): AppearanceCodeFontFamily {
  if (typeof window === "undefined") return "default"
  try {
    const stored = window.localStorage.getItem(CODE_FONT_FAMILY_STORAGE_KEY)
    if (stored && isAppearanceCodeFontFamily(stored)) {
      return stored
    }
    return "default"
  } catch {
    return "default"
  }
}

function getAppearanceRuntimeSignature(input: {
  brandTheme: BrandTheme
  codeThemePreference: CodeThemePreference
  colorMode: ColorMode
  fontFamily: AppearanceFontFamily
  codeFontFamily: AppearanceCodeFontFamily
  overrides: AppearanceTokenMap
  foreignDtcg: Record<string, unknown>
}) {
  return JSON.stringify(input)
}

function getAppearanceStateSignature(state: AppearanceRuntimeState) {
  return getAppearanceRuntimeSignature({
    brandTheme: state.document.brandTheme,
    codeThemePreference: state.codeThemePreference,
    colorMode: state.document.colorMode,
    fontFamily: state.document.fontFamily,
    codeFontFamily: state.document.codeFontFamily,
    overrides: state.document.overrides,
    foreignDtcg: state.document.foreignDtcg,
  })
}

export function useAppearanceState(options: {
  appearanceAuthoringEnabled: boolean
  runtimeCapabilitiesReady: boolean
}) {
  const [colorMode, setColorMode] = useState<ColorMode>(readColorModePreference)
  const [codeThemePreference, setCodeThemePreference] = useState<CodeThemePreference>(readCodeThemePreference)
  const [isSystemDarkMode, setIsSystemDarkMode] = useState(readSystemDarkModePreference)
  const [brandTheme, setBrandTheme] = useState<BrandTheme>(readBrandThemePreference)
  const [fontFamily, setFontFamily] = useState<AppearanceFontFamily>(readFontFamilyPreference)
  const [codeFontFamily, setCodeFontFamily] =
    useState<AppearanceCodeFontFamily>(readCodeFontFamilyPreference)
  const [appearanceOverrides, setAppearanceOverrides] = useState<AppearanceTokenMap>({})
  const [appearanceForeignDtcg, setAppearanceForeignDtcg] = useState<Record<string, unknown>>({})
  const [appearanceTokenValues, setAppearanceTokenValues] =
    useState<Record<AppearanceTokenName, string>>(DEFAULT_APPEARANCE_TOKEN_VALUES)
  const [appearanceConfigPath, setAppearanceConfigPath] = useState<string | null>(null)
  const [appearanceConfigError, setAppearanceConfigError] = useState<string | null>(null)
  const [isAppearanceConfigReady, setIsAppearanceConfigReady] = useState(false)
  const [appearanceThemeSnapshot, setAppearanceThemeSnapshot] =
    useState<AppearanceThemeLibrarySnapshot>(createDefaultAppearanceThemeSnapshot)
  const [appearanceThemeError, setAppearanceThemeError] = useState<string | null>(null)
  const [appearanceThemeNotice, setAppearanceThemeNotice] = useState<string | null>(null)
  const lastRemoteAppearanceSignatureRef = useRef<string | null>(null)
  const lastPublishedAppearanceSignatureRef = useRef<string | null>(null)

  const resolvedColorMode: ResolvedColorMode = colorMode === "dark" || (colorMode === "system" && isSystemDarkMode)
    ? "dark"
    : "light"
  const resolvedCodeTheme = resolveCodeHighlightTheme(codeThemePreference, resolvedColorMode)
  const appearanceConfigPreview = JSON.stringify(
    {
      version: 2,
      path: appearanceConfigPath,
      brandTheme,
      colorMode,
      fontFamily,
      codeFontFamily,
      overrides: appearanceOverrides,
      foreignDtcg: appearanceForeignDtcg,
    },
    null,
    2,
  )
  const appearanceRuntimeSignature = getAppearanceRuntimeSignature({
    brandTheme,
    codeThemePreference,
    colorMode,
    fontFamily,
    codeFontFamily,
    overrides: appearanceOverrides,
    foreignDtcg: appearanceForeignDtcg,
  })
  const appearanceContrastWarnings = useMemo(
    () => evaluateAppearanceContrastWarnings({
      brandTheme,
      overrides: appearanceOverrides,
    }),
    [appearanceOverrides, brandTheme],
  )

  function createAppearanceRuntimeState(): AppearanceRuntimeState {
    const nextDocument: AppearanceConfigDocument = {
      version: 2,
      brandTheme,
      colorMode,
      fontFamily,
      codeFontFamily,
      overrides: appearanceOverrides,
      foreignDtcg: appearanceForeignDtcg,
      updatedAt: Date.now(),
    }

    return {
      document: nextDocument,
      codeThemePreference,
    }
  }

  useEffect(() => {
    let mounted = true
    if (!options.runtimeCapabilitiesReady) {
      return () => {
        mounted = false
      }
    }

    if (!window.desktop?.getAppearanceConfig) {
      setIsAppearanceConfigReady(true)
      return () => {
        mounted = false
      }
    }

    void window.desktop.getAppearanceConfig()
      .then((snapshot) => {
        if (!mounted) return

        const nextDocument = normalizeAppearanceConfigDocument(snapshot.document)
        setAppearanceConfigPath(snapshot.path)
        setAppearanceConfigError(null)
        setColorMode(nextDocument.colorMode)
        setBrandTheme(nextDocument.brandTheme)
        setFontFamily(nextDocument.fontFamily)
        setCodeFontFamily(nextDocument.codeFontFamily)
        setAppearanceOverrides(nextDocument.overrides)
        setAppearanceForeignDtcg(nextDocument.foreignDtcg)
      })
      .catch((error) => {
        if (!mounted) return

        setAppearanceConfigError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (mounted) {
          setIsAppearanceConfigReady(true)
        }
      })

    return () => {
      mounted = false
    }
  }, [options.runtimeCapabilitiesReady])

  useEffect(() => {
    let mounted = true
    if (!options.runtimeCapabilitiesReady) {
      return () => {
        mounted = false
      }
    }
    const getAppearanceThemes = window.desktop?.getAppearanceThemes

    if (!getAppearanceThemes) {
      setAppearanceThemeSnapshot(createDefaultAppearanceThemeSnapshot())
      return () => {
        mounted = false
      }
    }

    void getAppearanceThemes()
      .then((snapshot) => {
        if (!mounted) return
        setAppearanceThemeSnapshot(snapshot)
        if (!options.appearanceAuthoringEnabled) {
          const activeTheme = findAppearanceThemeByID(snapshot.themes, snapshot.activeThemeID)
          if (activeTheme) {
            setCodeThemePreference(activeTheme.codeThemePreference)
          }
        }
        setAppearanceThemeError(null)
      })
      .catch((error) => {
        if (!mounted) return
        setAppearanceThemeSnapshot(createDefaultAppearanceThemeSnapshot())
        setAppearanceThemeError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      mounted = false
    }
  }, [options.appearanceAuthoringEnabled, options.runtimeCapabilitiesReady])

  useEffect(() => {
    const unsubscribe = window.desktop?.onAppearanceStateChange?.((state) => {
      const normalizedState = normalizeAppearanceRuntimeState(state, createAppearanceRuntimeState())
      lastRemoteAppearanceSignatureRef.current = getAppearanceStateSignature(normalizedState)
      setColorMode(normalizedState.document.colorMode)
      setBrandTheme(normalizedState.document.brandTheme)
      setFontFamily(normalizedState.document.fontFamily)
      setCodeFontFamily(normalizedState.document.codeFontFamily)
      setAppearanceOverrides(normalizedState.document.overrides)
      setAppearanceForeignDtcg(normalizedState.document.foreignDtcg)
      setCodeThemePreference(normalizedState.codeThemePreference)
      setAppearanceConfigError(null)
    })

    return unsubscribe
  }, [
    appearanceForeignDtcg,
    appearanceOverrides,
    brandTheme,
    codeThemePreference,
    colorMode,
    fontFamily,
    codeFontFamily,
  ])

  useEffect(() => {
    if (colorMode === "system") {
      document.documentElement.removeAttribute("data-theme")
    } else {
      document.documentElement.setAttribute("data-theme", colorMode)
    }
    try {
      window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, colorMode)
    } catch {
      return
    }
  }, [colorMode])

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return

    let mediaQueryList: MediaQueryList
    try {
      mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)")
    } catch {
      return
    }

    const handleChange = () => {
      setIsSystemDarkMode(mediaQueryList.matches)
    }

    handleChange()
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", handleChange)
      return () => mediaQueryList.removeEventListener("change", handleChange)
    }

    mediaQueryList.addListener(handleChange)
    return () => mediaQueryList.removeListener(handleChange)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(CODE_THEME_STORAGE_KEY, codeThemePreference)
    } catch {
      return
    }
  }, [codeThemePreference])

  useEffect(() => {
    document.documentElement.setAttribute("data-brand-theme", brandTheme)
    try {
      window.localStorage.setItem(BRAND_THEME_STORAGE_KEY, brandTheme)
    } catch {
      return
    }
  }, [brandTheme])

  useEffect(() => {
    document.documentElement.setAttribute("data-font-family", fontFamily)
    try {
      window.localStorage.setItem(FONT_FAMILY_STORAGE_KEY, fontFamily)
    } catch {
      return
    }
  }, [fontFamily])

  useEffect(() => {
    document.documentElement.setAttribute("data-code-font-family", codeFontFamily)
    document.documentElement.style.setProperty(
      "--font-mono",
      resolveCodeFontFamilyStack(codeFontFamily),
    )
    try {
      window.localStorage.setItem(CODE_FONT_FAMILY_STORAGE_KEY, codeFontFamily)
    } catch {
      return
    }
  }, [codeFontFamily])

  useEffect(() => {
    applyAppearanceOverrides(document.documentElement, appearanceOverrides)
    setAppearanceTokenValues(resolveAppearanceTokenCssValues({
      brandTheme,
      overrides: appearanceOverrides,
    }))
  }, [appearanceOverrides, brandTheme])

  useEffect(() => {
    const publishAppearanceState = window.desktop?.publishAppearanceState
    if (!isAppearanceConfigReady || !publishAppearanceState) return
    if (appearanceRuntimeSignature === lastRemoteAppearanceSignatureRef.current) return
    if (appearanceRuntimeSignature === lastPublishedAppearanceSignatureRef.current) return

    lastPublishedAppearanceSignatureRef.current = appearanceRuntimeSignature
    void publishAppearanceState(createAppearanceRuntimeState()).catch((error) => {
      if (lastPublishedAppearanceSignatureRef.current === appearanceRuntimeSignature) {
        lastPublishedAppearanceSignatureRef.current = null
      }
      setAppearanceConfigError(error instanceof Error ? error.message : String(error))
    })
  }, [appearanceRuntimeSignature, isAppearanceConfigReady])

  useEffect(() => {
    const saveAppearanceConfig = window.desktop?.saveAppearanceConfig
    if (!isAppearanceConfigReady || !saveAppearanceConfig) return
    if (appearanceRuntimeSignature === lastRemoteAppearanceSignatureRef.current) return

    const timer = window.setTimeout(() => {
      const nextDocument = createAppearanceRuntimeState().document

      void saveAppearanceConfig({ document: nextDocument })
        .then((snapshot) => {
          setAppearanceConfigPath(snapshot.path)
          setAppearanceConfigError(null)
        })
        .catch((error) => {
          setAppearanceConfigError(error instanceof Error ? error.message : String(error))
        })
    }, APPEARANCE_CONFIG_SAVE_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [appearanceRuntimeSignature, isAppearanceConfigReady])

  function handleAppearanceTokenChange(tokenName: AppearanceTokenName, nextValue: string) {
    const normalizedValue = parseAppearanceColorLiteral(nextValue)
    if (!normalizedValue) {
      setAppearanceConfigError(`Invalid color value for --${tokenName}.`)
      return
    }

    setAppearanceOverrides((current) => {
      if (JSON.stringify(current[tokenName]) === JSON.stringify(normalizedValue)) return current

      return {
        ...current,
        [tokenName]: normalizedValue,
      }
    })
    setAppearanceConfigError(null)
  }

  function handleAppearanceTokenReset(tokenName: AppearanceTokenName) {
    setAppearanceOverrides((current) => {
      if (!(tokenName in current)) return current

      const nextOverrides = { ...current }
      delete nextOverrides[tokenName]
      return nextOverrides
    })
  }

  function handleAppearancePaletteReset() {
    setAppearanceOverrides({})
  }

  function handleSemanticTokenAuthoringCommitted(draft: SemanticTokenAuthoringDraft) {
    setAppearanceThemeSnapshot((current) => {
      const updateTheme = <Theme extends AppearanceTheme>(theme: Theme): Theme =>
        theme.id === draft.sourceThemeID
          ? {
              ...theme,
              overrides: applySemanticAuthoringDraftToOverrides(
                theme.overrides,
                draft,
                true,
              ),
            }
          : theme
      return {
        ...current,
        builtInThemes: current.builtInThemes.map(updateTheme),
        themes: current.themes.map(updateTheme),
      }
    })

    if (appearanceThemeSnapshot.activeThemeID !== draft.sourceThemeID) return
    const createdRuntimeTokens = new Set(
      draft.operations
        .filter((operation) => operation.kind === "token-creation")
        .map((operation) => operation.runtimeToken),
    )
    for (const operation of draft.operations) {
      if (operation.kind === "token-creation") {
        document.documentElement.style.setProperty(
          `--${operation.runtimeToken}-light`,
          operation.light.value,
        )
        document.documentElement.style.setProperty(
          `--${operation.runtimeToken}-dark`,
          operation.dark.value,
        )
        continue
      }
      if (operation.kind !== "theme-token-value-edit") continue
      const modeToken = authoringModeToken(operation, createdRuntimeTokens)
      if (!modeToken) continue
      if (operation.action === "reset") {
        document.documentElement.style.removeProperty(`--${modeToken}`)
      } else if (operation.value) {
        document.documentElement.style.setProperty(`--${modeToken}`, operation.value)
      }
    }
    setAppearanceOverrides((current) =>
      applySemanticAuthoringDraftToOverrides(current, draft, false),
    )
    setAppearanceConfigError(null)
  }

  function createAppearanceThemeSaveInput(name: string): AppearanceThemeSaveInput {
    return {
      name,
      source: "user",
      colorMode,
      brandTheme,
      fontFamily,
      codeFontFamily,
      codeThemePreference,
      overrides: appearanceOverrides,
      foreignDtcg: appearanceForeignDtcg,
    }
  }

  function applyAppearanceTheme(theme: AppearanceTheme) {
    setColorMode(theme.colorMode)
    setBrandTheme(theme.brandTheme)
    setFontFamily(theme.fontFamily)
    setCodeFontFamily(theme.codeFontFamily)
    setCodeThemePreference(theme.codeThemePreference)
    setAppearanceOverrides({ ...theme.overrides })
    setAppearanceForeignDtcg(structuredClone(theme.foreignDtcg))
  }

  async function handleAppearanceThemeApply(themeID: string) {
    const theme = findAppearanceThemeByID(appearanceThemeSnapshot.themes, themeID)
    if (!theme) {
      setAppearanceThemeError("Theme not found.")
      return
    }

    applyAppearanceTheme(theme)
    setAppearanceThemeSnapshot((current) => ({
      ...current,
      activeThemeID: theme.id,
      document: {
        ...current.document,
        activeThemeID: theme.id,
      },
    }))

    const setActiveAppearanceTheme = window.desktop?.setActiveAppearanceTheme
    if (!setActiveAppearanceTheme) return

    try {
      const snapshot = await setActiveAppearanceTheme({ themeID: theme.id })
      setAppearanceThemeSnapshot(snapshot)
      setAppearanceThemeError(null)
    } catch (error) {
      setAppearanceThemeError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleAppearanceThemeSaveCurrent(name: string): Promise<AppearanceTheme | null> {
    const saveAppearanceTheme = window.desktop?.saveAppearanceTheme
    if (!saveAppearanceTheme) {
      setAppearanceThemeError("Desktop appearance theme APIs are unavailable.")
      return null
    }

    try {
      const result = await saveAppearanceTheme({ theme: createAppearanceThemeSaveInput(name) })
      setAppearanceThemeSnapshot(result.snapshot)
      setAppearanceThemeError(null)
      setAppearanceThemeNotice(null)
      return result.theme
    } catch (error) {
      setAppearanceThemeError(error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async function handleAppearanceThemeImportDtcg(
    json: string,
    fallbackName?: string,
  ): Promise<AppearanceTheme | null> {
    const saveAppearanceTheme = window.desktop?.saveAppearanceTheme
    if (!saveAppearanceTheme) {
      setAppearanceThemeError("Desktop appearance theme APIs are unavailable.")
      return null
    }

    try {
      const imported = parseAppearanceDtcgJson(json, { fallbackName })
      const result = await saveAppearanceTheme({ theme: imported.theme })
      setAppearanceThemeSnapshot(result.snapshot)
      setAppearanceThemeError(null)

      if (result.theme) {
        applyAppearanceTheme(result.theme)
      }

      const noticeParts = [
        `Imported ${imported.importedTokenCount} Anybox tokens.`,
        ...imported.warnings,
      ]
      if (imported.contrastWarnings.length > 0) {
        noticeParts.push(
          `${imported.contrastWarnings.length} contrast ${
            imported.contrastWarnings.length === 1 ? "warning" : "warnings"
          } were kept as non-blocking quality feedback.`,
        )
      }
      setAppearanceThemeNotice(noticeParts.join(" "))
      return result.theme
    } catch (error) {
      const message = error instanceof AppearanceDtcgValidationError
        ? error.issues.join(" ")
        : error instanceof Error
          ? error.message
          : String(error)
      setAppearanceThemeError(message)
      setAppearanceThemeNotice(null)
      return null
    }
  }

  function handleAppearanceThemeExportDtcg(themeID: string) {
    const theme = findAppearanceThemeByID(appearanceThemeSnapshot.themes, themeID)
    if (!theme) {
      setAppearanceThemeError("Theme not found.")
      return null
    }

    const fileStem = theme.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      || "anybox-theme"
    setAppearanceThemeError(null)
    setAppearanceThemeNotice(`Exported "${theme.name}" as DTCG 2025.10 tokens.`)
    return {
      contents: serializeAppearanceThemeToDtcg(theme),
      fileName: `${fileStem}.tokens.json`,
    }
  }

  async function handleAppearanceThemeDuplicate(themeID: string, name?: string): Promise<AppearanceTheme | null> {
    const duplicateAppearanceTheme = window.desktop?.duplicateAppearanceTheme
    if (!duplicateAppearanceTheme) {
      setAppearanceThemeError("Desktop appearance theme APIs are unavailable.")
      return null
    }

    try {
      const result = await duplicateAppearanceTheme({ themeID, name })
      setAppearanceThemeSnapshot(result.snapshot)
      setAppearanceThemeError(null)
      return result.theme
    } catch (error) {
      setAppearanceThemeError(error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async function handleAppearanceThemeRename(themeID: string, name: string): Promise<AppearanceTheme | null> {
    const renameAppearanceTheme = window.desktop?.renameAppearanceTheme
    if (!renameAppearanceTheme) {
      setAppearanceThemeError("Desktop appearance theme APIs are unavailable.")
      return null
    }

    try {
      const result = await renameAppearanceTheme({ themeID, name })
      setAppearanceThemeSnapshot(result.snapshot)
      setAppearanceThemeError(null)
      return result.theme
    } catch (error) {
      setAppearanceThemeError(error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async function handleAppearanceThemeDelete(themeID: string) {
    const deleteAppearanceTheme = window.desktop?.deleteAppearanceTheme
    if (!deleteAppearanceTheme) {
      setAppearanceThemeError("Desktop appearance theme APIs are unavailable.")
      return
    }

    const wasActiveTheme = appearanceThemeSnapshot.activeThemeID === themeID

    try {
      const snapshot = await deleteAppearanceTheme({ themeID })
      setAppearanceThemeSnapshot(snapshot)
      setAppearanceThemeError(null)

      if (wasActiveTheme) {
        const fallbackTheme = findAppearanceThemeByID(snapshot.themes, snapshot.activeThemeID)
        if (fallbackTheme) {
          applyAppearanceTheme(fallbackTheme)
        }
      }
    } catch (error) {
      setAppearanceThemeError(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    appearanceConfigError,
    appearanceConfigPath,
    appearanceConfigPreview,
    appearanceContrastWarnings,
    appearanceOverrides,
    appearanceThemeError,
    appearanceThemeNotice,
    appearanceThemes: appearanceThemeSnapshot.themes,
    activeAppearanceThemeID: appearanceThemeSnapshot.activeThemeID,
    appearanceTokenValues,
    brandTheme,
    codeThemePreference,
    colorMode,
    fontFamily,
    codeFontFamily,
    handleAppearancePaletteReset,
    handleAppearanceThemeApply,
    handleAppearanceThemeDelete,
    handleAppearanceThemeDuplicate,
    handleAppearanceThemeExportDtcg,
    handleAppearanceThemeImportDtcg,
    handleAppearanceThemeRename,
    handleAppearanceThemeSaveCurrent,
    handleAppearanceTokenChange,
    handleAppearanceTokenReset,
    handleSemanticTokenAuthoringCommitted,
    handleBrandThemeChange: setBrandTheme,
    handleCodeThemeChange: setCodeThemePreference,
    handleColorModeChange: setColorMode,
    handleFontFamilyChange: setFontFamily,
    handleCodeFontFamilyChange: setCodeFontFamily,
    resolvedColorMode,
    resolvedCodeTheme,
  }
}
