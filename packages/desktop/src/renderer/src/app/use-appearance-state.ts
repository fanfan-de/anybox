import { useEffect, useRef, useState } from "react"
import {
  APPEARANCE_TOKEN_NAMES,
  isAppearanceFontFamily,
  normalizeAppearanceConfigDocument,
  normalizeAppearanceRuntimeState,
  type AppearanceConfigDocument,
  type AppearanceFontFamily,
  type AppearanceRuntimeState,
  type AppearanceTokenMap,
  type AppearanceTokenName,
} from "../../../shared/appearance"
import { applyAppearanceOverrides, normalizeAppearanceColorInputValue, readResolvedAppearanceTokenValues } from "./appearance-theme"
import {
  normalizeCodeThemePreference,
  resolveCodeHighlightTheme,
  type CodeThemePreference,
  type ResolvedColorMode,
} from "./code-theme"
import {
  HTML_BACKGROUND_STORAGE_KEY,
  readHtmlBackgroundConfigPreference,
  serializeHtmlBackgroundConfig,
  type HtmlBackgroundConfig,
} from "./html-background/html-background-config"
import type { BrandTheme, ColorMode } from "./types"

const COLOR_MODE_STORAGE_KEY = "desktop.colorMode"
const CODE_THEME_STORAGE_KEY = "desktop.codeTheme"
const BRAND_THEME_STORAGE_KEY = "desktop.brandTheme"
const FONT_FAMILY_STORAGE_KEY = "desktop.fontFamily"
const APPEARANCE_CONFIG_SAVE_DEBOUNCE_MS = 160

const EMPTY_APPEARANCE_TOKEN_VALUES = Object.fromEntries(
  APPEARANCE_TOKEN_NAMES.map((tokenName) => [tokenName, "#000000"]),
) as Record<AppearanceTokenName, string>

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

function getAppearanceRuntimeSignature(input: {
  brandTheme: BrandTheme
  codeThemePreference: CodeThemePreference
  colorMode: ColorMode
  fontFamily: AppearanceFontFamily
  htmlBackgroundConfig: HtmlBackgroundConfig
  overrides: AppearanceTokenMap
}) {
  return JSON.stringify(input)
}

function getAppearanceStateSignature(state: AppearanceRuntimeState) {
  return getAppearanceRuntimeSignature({
    brandTheme: state.document.brandTheme,
    codeThemePreference: state.codeThemePreference,
    colorMode: state.document.colorMode,
    fontFamily: state.document.fontFamily,
    htmlBackgroundConfig: state.htmlBackgroundConfig,
    overrides: state.document.overrides,
  })
}

export function useAppearanceState() {
  const [colorMode, setColorMode] = useState<ColorMode>(readColorModePreference)
  const [codeThemePreference, setCodeThemePreference] = useState<CodeThemePreference>(readCodeThemePreference)
  const [isSystemDarkMode, setIsSystemDarkMode] = useState(readSystemDarkModePreference)
  const [brandTheme, setBrandTheme] = useState<BrandTheme>(readBrandThemePreference)
  const [fontFamily, setFontFamily] = useState<AppearanceFontFamily>(readFontFamilyPreference)
  const [htmlBackgroundConfig, setHtmlBackgroundConfig] = useState<HtmlBackgroundConfig>(readHtmlBackgroundConfigPreference)
  const [appearanceOverrides, setAppearanceOverrides] = useState<AppearanceTokenMap>({})
  const [appearanceTokenValues, setAppearanceTokenValues] =
    useState<Record<AppearanceTokenName, string>>(EMPTY_APPEARANCE_TOKEN_VALUES)
  const [appearanceConfigPath, setAppearanceConfigPath] = useState<string | null>(null)
  const [appearanceConfigError, setAppearanceConfigError] = useState<string | null>(null)
  const [isAppearanceConfigReady, setIsAppearanceConfigReady] = useState(false)
  const lastRemoteAppearanceSignatureRef = useRef<string | null>(null)
  const lastPublishedAppearanceSignatureRef = useRef<string | null>(null)

  const resolvedColorMode: ResolvedColorMode = colorMode === "dark" || (colorMode === "system" && isSystemDarkMode)
    ? "dark"
    : "light"
  const resolvedCodeTheme = resolveCodeHighlightTheme(codeThemePreference, resolvedColorMode)
  const appearanceConfigPreview = JSON.stringify(
    {
      version: 1,
      path: appearanceConfigPath,
      brandTheme,
      colorMode,
      fontFamily,
      overrides: appearanceOverrides,
      resolvedTokens: appearanceTokenValues,
    },
    null,
    2,
  )
  const appearanceRuntimeSignature = getAppearanceRuntimeSignature({
    brandTheme,
    codeThemePreference,
    colorMode,
    fontFamily,
    htmlBackgroundConfig,
    overrides: appearanceOverrides,
  })

  function createAppearanceRuntimeState(): AppearanceRuntimeState {
    const nextDocument: AppearanceConfigDocument = {
      version: 1,
      brandTheme,
      colorMode,
      fontFamily,
      overrides: appearanceOverrides,
      resolvedTokens: readResolvedAppearanceTokenValues(document.documentElement),
      updatedAt: Date.now(),
    }

    return {
      document: nextDocument,
      codeThemePreference,
      htmlBackgroundConfig,
    }
  }

  useEffect(() => {
    let mounted = true

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
        setAppearanceOverrides(nextDocument.overrides)
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
  }, [])

  useEffect(() => {
    const unsubscribe = window.desktop?.onAppearanceStateChange?.((state) => {
      const normalizedState = normalizeAppearanceRuntimeState(state, createAppearanceRuntimeState())
      lastRemoteAppearanceSignatureRef.current = getAppearanceStateSignature(normalizedState)
      setColorMode(normalizedState.document.colorMode)
      setBrandTheme(normalizedState.document.brandTheme)
      setFontFamily(normalizedState.document.fontFamily)
      setAppearanceOverrides(normalizedState.document.overrides)
      setCodeThemePreference(normalizedState.codeThemePreference)
      setHtmlBackgroundConfig(normalizedState.htmlBackgroundConfig)
      setAppearanceConfigError(null)
    })

    return unsubscribe
  }, [
    appearanceOverrides,
    brandTheme,
    codeThemePreference,
    colorMode,
    fontFamily,
    htmlBackgroundConfig,
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
    try {
      window.localStorage.setItem(HTML_BACKGROUND_STORAGE_KEY, serializeHtmlBackgroundConfig(htmlBackgroundConfig))
    } catch {
      return
    }
  }, [htmlBackgroundConfig])

  useEffect(() => {
    applyAppearanceOverrides(document.documentElement, appearanceOverrides)
    setAppearanceTokenValues(readResolvedAppearanceTokenValues(document.documentElement))
  }, [appearanceOverrides, brandTheme, colorMode, fontFamily])

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
    const normalizedValue = normalizeAppearanceColorInputValue(nextValue)

    setAppearanceOverrides((current) => {
      if (current[tokenName] === normalizedValue) return current

      return {
        ...current,
        [tokenName]: normalizedValue,
      }
    })
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

  function handleHtmlBackgroundConfigChange(nextConfig: HtmlBackgroundConfig) {
    setHtmlBackgroundConfig(nextConfig)
  }

  return {
    appearanceConfigError,
    appearanceConfigPath,
    appearanceConfigPreview,
    appearanceOverrides,
    appearanceTokenValues,
    brandTheme,
    codeThemePreference,
    colorMode,
    fontFamily,
    handleAppearancePaletteReset,
    handleAppearanceTokenChange,
    handleAppearanceTokenReset,
    handleBrandThemeChange: setBrandTheme,
    handleCodeThemeChange: setCodeThemePreference,
    handleColorModeChange: setColorMode,
    handleFontFamilyChange: setFontFamily,
    handleHtmlBackgroundConfigChange,
    htmlBackgroundConfig,
    resolvedCodeTheme,
  }
}
