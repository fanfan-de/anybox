import {
  APPEARANCE_TOKEN_NAMES,
  DEFAULT_APPEARANCE_THEME_DEFINITION,
  type AppearanceTokenMap,
  type AppearanceTokenName,
} from "./appearance-tokens.generated"
import { normalizeAppearanceTokenValue } from "./appearance-color"

export {
  APPEARANCE_BRAND_DEFINITIONS,
  APPEARANCE_BRAND_NAMES,
  APPEARANCE_CONTRAST_CONTRACTS,
  APPEARANCE_DTCG_SCHEMA_URL,
  APPEARANCE_DTCG_VERSION,
  APPEARANCE_TOKEN_GROUPS,
  APPEARANCE_TOKEN_LAYERS,
  APPEARANCE_TOKEN_MANIFEST_VERSION,
  APPEARANCE_TOKEN_METADATA,
  APPEARANCE_TOKEN_NAMES,
  APPEARANCE_TOKEN_DERIVATIONS,
  APPEARANCE_TOKEN_RUNTIME_MAP,
  APPEARANCE_TOKEN_TEST_DATA,
  DTCG_COLOR_SPACES,
} from "./appearance-tokens.generated"
export type {
  AppearanceBrandName,
  AppearanceContrastContract,
  AppearanceTokenAlias,
  AppearanceTokenDerivation,
  AppearanceTokenGroup,
  AppearanceTokenLayer,
  AppearanceTokenLiteral,
  AppearanceTokenMap,
  AppearanceTokenMetadata,
  AppearanceTokenName,
  AppearanceTokenRow,
  AppearanceTokenValue,
  DtcgColorSpace,
  DtcgColorValue,
} from "./appearance-tokens.generated"

export type AppearanceColorMode = "system" | "light" | "dark"
export type AppearanceBrandTheme = "terra" | "sage"
export type AppearanceFontFamily = "default" | "system" | "segoe" | "microsoft-yahei" | "pingfang"

export const APPEARANCE_FONT_FAMILIES = [
  "default",
  "system",
  "segoe",
  "microsoft-yahei",
  "pingfang",
] as const satisfies readonly AppearanceFontFamily[]

export const APPEARANCE_CODE_HIGHLIGHT_THEMES = [
  "github-light",
  "github-dark",
  "vitesse-light",
  "vitesse-dark",
  "nord",
  "dracula",
] as const

export const DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE = "auto"

export type AppearanceCodeHighlightTheme = (typeof APPEARANCE_CODE_HIGHLIGHT_THEMES)[number]
export type AppearanceCodeThemePreference =
  | typeof DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE
  | AppearanceCodeHighlightTheme

export type AppearanceHtmlBackgroundRenderMode = "dynamic" | "static"
export type AppearanceDesktopBackgroundMode = "default" | "custom-html"

export interface AppearanceHtmlBackgroundConfig {
  blurPx: number
  dim: number
  enabled: boolean
  html: string
  opacity: number
  paused: boolean
  renderMode: AppearanceHtmlBackgroundRenderMode
  surfaceOpacity: number
}

export interface AppearanceHtmlBackgroundState {
  backgroundMode: AppearanceDesktopBackgroundMode
  hasHtmlBackground: boolean
}

export const DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG: AppearanceHtmlBackgroundConfig = {
  blurPx: 0,
  dim: 0.18,
  enabled: false,
  html: "",
  opacity: 0.78,
  paused: false,
  renderMode: "static",
  surfaceOpacity: 0.68,
}

export interface AppearanceConfigDocument {
  version: 2
  brandTheme: AppearanceBrandTheme
  colorMode: AppearanceColorMode
  fontFamily: AppearanceFontFamily
  overrides: AppearanceTokenMap
  foreignDtcg: Record<string, unknown>
  updatedAt: number
}

export interface AppearanceConfigSnapshot {
  path: string
  exists: boolean
  document: AppearanceConfigDocument
}

export interface AppearanceRuntimeState {
  document: AppearanceConfigDocument
  codeThemePreference: AppearanceCodeThemePreference
  htmlBackgroundConfig: AppearanceHtmlBackgroundConfig
}

const APPEARANCE_TOKEN_NAME_SET = new Set<string>(APPEARANCE_TOKEN_NAMES)
const APPEARANCE_FONT_FAMILY_SET = new Set<string>(APPEARANCE_FONT_FAMILIES)

const LEGACY_APPEARANCE_TOKEN_MIGRATIONS: Record<string, readonly AppearanceTokenName[]> = {
  "surface-sidebar": [
    "surface-left-sidebar-light",
    "surface-left-sidebar-dark",
    "surface-right-sidebar-light",
    "surface-right-sidebar-dark",
  ],
  "surface-sidebar-light": [
    "surface-left-sidebar-light",
    "surface-right-sidebar-light",
  ],
  "surface-sidebar-dark": [
    "surface-left-sidebar-dark",
    "surface-right-sidebar-dark",
  ],
  "semantic-accent-icon": ["semantic-accent-icon-light", "semantic-accent-icon-dark"],
  "semantic-accent-icon-hover": ["semantic-accent-icon-hover-light", "semantic-accent-icon-hover-dark"],
  "semantic-accent-icon-active": ["semantic-accent-icon-active-light", "semantic-accent-icon-active-dark"],
  "semantic-button-primary-surface": [
    "semantic-button-primary-surface-light",
    "semantic-button-primary-surface-dark",
  ],
  "semantic-button-primary-surface-hover": [
    "semantic-button-primary-surface-hover-light",
    "semantic-button-primary-surface-hover-dark",
  ],
  "semantic-button-primary-border": [
    "semantic-button-primary-border-light",
    "semantic-button-primary-border-dark",
  ],
  "semantic-button-primary-border-hover": [
    "semantic-button-primary-border-hover-light",
    "semantic-button-primary-border-hover-dark",
  ],
  "semantic-button-primary-text": [
    "semantic-button-primary-text-light",
    "semantic-button-primary-text-dark",
  ],
  "semantic-button-primary-text-hover": [
    "semantic-button-primary-text-hover-light",
    "semantic-button-primary-text-hover-dark",
  ],
  "semantic-button-primary-disabled-surface": [
    "semantic-button-primary-disabled-surface-light",
    "semantic-button-primary-disabled-surface-dark",
  ],
  "semantic-button-primary-disabled-border": [
    "semantic-button-primary-disabled-border-light",
    "semantic-button-primary-disabled-border-dark",
  ],
  "semantic-button-primary-disabled-text": [
    "semantic-button-primary-disabled-text-light",
    "semantic-button-primary-disabled-text-dark",
  ],
  "semantic-button-secondary-surface": [
    "semantic-button-secondary-surface-light",
    "semantic-button-secondary-surface-dark",
  ],
  "semantic-button-secondary-surface-hover": [
    "semantic-button-secondary-surface-hover-light",
    "semantic-button-secondary-surface-hover-dark",
  ],
  "semantic-button-secondary-border": [
    "semantic-button-secondary-border-light",
    "semantic-button-secondary-border-dark",
  ],
  "semantic-button-secondary-border-hover": [
    "semantic-button-secondary-border-hover-light",
    "semantic-button-secondary-border-hover-dark",
  ],
  "semantic-button-secondary-text": [
    "semantic-button-secondary-text-light",
    "semantic-button-secondary-text-dark",
  ],
  "semantic-button-secondary-text-hover": [
    "semantic-button-secondary-text-hover-light",
    "semantic-button-secondary-text-hover-dark",
  ],
  "semantic-button-secondary-disabled-surface": [
    "semantic-button-secondary-disabled-surface-light",
    "semantic-button-secondary-disabled-surface-dark",
  ],
  "semantic-button-secondary-disabled-border": [
    "semantic-button-secondary-disabled-border-light",
    "semantic-button-secondary-disabled-border-dark",
  ],
  "semantic-button-secondary-disabled-text": [
    "semantic-button-secondary-disabled-text-light",
    "semantic-button-secondary-disabled-text-dark",
  ],
  "semantic-button-danger-surface": [
    "semantic-button-danger-surface-light",
    "semantic-button-danger-surface-dark",
  ],
  "semantic-button-danger-surface-hover": [
    "semantic-button-danger-surface-hover-light",
    "semantic-button-danger-surface-hover-dark",
  ],
  "semantic-button-danger-border": [
    "semantic-button-danger-border-light",
    "semantic-button-danger-border-dark",
  ],
  "semantic-button-danger-border-hover": [
    "semantic-button-danger-border-hover-light",
    "semantic-button-danger-border-hover-dark",
  ],
  "semantic-button-danger-text": [
    "semantic-button-danger-text-light",
    "semantic-button-danger-text-dark",
  ],
  "semantic-button-danger-text-hover": [
    "semantic-button-danger-text-hover-light",
    "semantic-button-danger-text-hover-dark",
  ],
  "semantic-button-danger-disabled-surface": [
    "semantic-button-danger-disabled-surface-light",
    "semantic-button-danger-disabled-surface-dark",
  ],
  "semantic-button-danger-disabled-border": [
    "semantic-button-danger-disabled-border-light",
    "semantic-button-danger-disabled-border-dark",
  ],
  "semantic-button-danger-disabled-text": [
    "semantic-button-danger-disabled-text-light",
    "semantic-button-danger-disabled-text-dark",
  ],
  "semantic-success": ["semantic-success-light", "semantic-success-dark"],
  "semantic-success-strong": ["semantic-success-strong-light", "semantic-success-strong-dark"],
  "semantic-success-text": ["semantic-success-text-light", "semantic-success-text-dark"],
  "semantic-success-border": ["semantic-success-border-light", "semantic-success-border-dark"],
  "semantic-success-surface": ["semantic-success-surface-light", "semantic-success-surface-dark"],
  "semantic-success-surface-strong": [
    "semantic-success-surface-strong-light",
    "semantic-success-surface-strong-dark",
  ],
  "semantic-warning": ["semantic-warning-light", "semantic-warning-dark"],
  "semantic-warning-strong": ["semantic-warning-strong-light", "semantic-warning-strong-dark"],
  "semantic-warning-text": ["semantic-warning-text-light", "semantic-warning-text-dark"],
  "semantic-warning-border": ["semantic-warning-border-light", "semantic-warning-border-dark"],
  "semantic-warning-surface": ["semantic-warning-surface-light", "semantic-warning-surface-dark"],
  "semantic-warning-surface-strong": [
    "semantic-warning-surface-strong-light",
    "semantic-warning-surface-strong-dark",
  ],
  "semantic-error": ["semantic-error-light", "semantic-error-dark"],
  "semantic-error-strong": ["semantic-error-strong-light", "semantic-error-strong-dark"],
  "semantic-error-text": ["semantic-error-text-light", "semantic-error-text-dark"],
  "semantic-error-border": ["semantic-error-border-light", "semantic-error-border-dark"],
  "semantic-error-surface": ["semantic-error-surface-light", "semantic-error-surface-dark"],
  "semantic-error-surface-strong": ["semantic-error-surface-strong-light", "semantic-error-surface-strong-dark"],
  "semantic-info": ["semantic-info-light", "semantic-info-dark"],
  "semantic-info-strong": ["semantic-info-strong-light", "semantic-info-strong-dark"],
  "semantic-info-text": ["semantic-info-text-light", "semantic-info-text-dark"],
  "semantic-info-border": ["semantic-info-border-light", "semantic-info-border-dark"],
  "semantic-info-surface": ["semantic-info-surface-light", "semantic-info-surface-dark"],
  "semantic-info-surface-strong": ["semantic-info-surface-strong-light", "semantic-info-surface-strong-dark"],
  "semantic-pane-tab-bar-surface": [
    "semantic-shell-chrome-surface-light",
    "semantic-shell-chrome-surface-dark",
  ],
  "semantic-pane-tab-bar-surface-light": ["semantic-shell-chrome-surface-light"],
  "semantic-pane-tab-bar-surface-dark": ["semantic-shell-chrome-surface-dark"],
  "semantic-left-sidebar-top-menu-surface": [
    "semantic-shell-chrome-surface-light",
    "semantic-shell-chrome-surface-dark",
  ],
  "semantic-left-sidebar-top-menu-surface-light": ["semantic-shell-chrome-surface-light"],
  "semantic-left-sidebar-top-menu-surface-dark": ["semantic-shell-chrome-surface-dark"],
  "semantic-right-sidebar-top-menu-surface": [
    "semantic-shell-chrome-surface-light",
    "semantic-shell-chrome-surface-dark",
  ],
  "semantic-right-sidebar-top-menu-surface-light": ["semantic-shell-chrome-surface-light"],
  "semantic-right-sidebar-top-menu-surface-dark": ["semantic-shell-chrome-surface-dark"],
  "semantic-popup-panel-surface": [
    "semantic-popup-panel-surface-light",
    "semantic-popup-panel-surface-dark",
  ],
  "semantic-settings-page-surface": [
    "semantic-settings-page-surface-light",
    "semantic-settings-page-surface-dark",
  ],
  "semantic-switch-row-surface-focus": [
    "semantic-switch-row-surface-focus-light",
    "semantic-switch-row-surface-focus-dark",
  ],
  "semantic-switch-track-surface": [
    "semantic-switch-track-surface-light",
    "semantic-switch-track-surface-dark",
  ],
  "semantic-switch-track-border": [
    "semantic-switch-track-border-light",
    "semantic-switch-track-border-dark",
  ],
  "semantic-switch-track-border-focus": [
    "semantic-switch-track-border-focus-light",
    "semantic-switch-track-border-focus-dark",
  ],
  "semantic-switch-track-surface-active": [
    "semantic-switch-track-surface-active-light",
    "semantic-switch-track-surface-active-dark",
  ],
  "semantic-switch-track-border-active": [
    "semantic-switch-track-border-active-light",
    "semantic-switch-track-border-active-dark",
  ],
  "semantic-switch-track-surface-disabled": [
    "semantic-switch-track-surface-disabled-light",
    "semantic-switch-track-surface-disabled-dark",
  ],
  "semantic-switch-track-border-disabled": [
    "semantic-switch-track-border-disabled-light",
    "semantic-switch-track-border-disabled-dark",
  ],
  "semantic-switch-thumb-surface": [
    "semantic-switch-thumb-surface-light",
    "semantic-switch-thumb-surface-dark",
  ],
  "semantic-switch-thumb-surface-disabled": [
    "semantic-switch-thumb-surface-disabled-light",
    "semantic-switch-thumb-surface-disabled-dark",
  ],
  // Deprecated settings-scoped switch names migrate to the shared switch group.
  "semantic-settings-switch-row-surface-focus": [
    "semantic-switch-row-surface-focus-light",
    "semantic-switch-row-surface-focus-dark",
  ],
  "semantic-settings-switch-row-surface-focus-light": ["semantic-switch-row-surface-focus-light"],
  "semantic-settings-switch-row-surface-focus-dark": ["semantic-switch-row-surface-focus-dark"],
  "semantic-settings-switch-track-surface": [
    "semantic-switch-track-surface-light",
    "semantic-switch-track-surface-dark",
  ],
  "semantic-settings-switch-track-surface-light": ["semantic-switch-track-surface-light"],
  "semantic-settings-switch-track-surface-dark": ["semantic-switch-track-surface-dark"],
  "semantic-settings-switch-track-border": [
    "semantic-switch-track-border-light",
    "semantic-switch-track-border-dark",
  ],
  "semantic-settings-switch-track-border-light": ["semantic-switch-track-border-light"],
  "semantic-settings-switch-track-border-dark": ["semantic-switch-track-border-dark"],
  "semantic-settings-switch-track-border-focus": [
    "semantic-switch-track-border-focus-light",
    "semantic-switch-track-border-focus-dark",
  ],
  "semantic-settings-switch-track-border-focus-light": ["semantic-switch-track-border-focus-light"],
  "semantic-settings-switch-track-border-focus-dark": ["semantic-switch-track-border-focus-dark"],
  "semantic-settings-switch-track-surface-active": [
    "semantic-switch-track-surface-active-light",
    "semantic-switch-track-surface-active-dark",
  ],
  "semantic-settings-switch-track-surface-active-light": ["semantic-switch-track-surface-active-light"],
  "semantic-settings-switch-track-surface-active-dark": ["semantic-switch-track-surface-active-dark"],
  "semantic-settings-switch-track-border-active": [
    "semantic-switch-track-border-active-light",
    "semantic-switch-track-border-active-dark",
  ],
  "semantic-settings-switch-track-border-active-light": ["semantic-switch-track-border-active-light"],
  "semantic-settings-switch-track-border-active-dark": ["semantic-switch-track-border-active-dark"],
  "semantic-settings-switch-track-surface-disabled": [
    "semantic-switch-track-surface-disabled-light",
    "semantic-switch-track-surface-disabled-dark",
  ],
  "semantic-settings-switch-track-surface-disabled-light": ["semantic-switch-track-surface-disabled-light"],
  "semantic-settings-switch-track-surface-disabled-dark": ["semantic-switch-track-surface-disabled-dark"],
  "semantic-settings-switch-track-border-disabled": [
    "semantic-switch-track-border-disabled-light",
    "semantic-switch-track-border-disabled-dark",
  ],
  "semantic-settings-switch-track-border-disabled-light": ["semantic-switch-track-border-disabled-light"],
  "semantic-settings-switch-track-border-disabled-dark": ["semantic-switch-track-border-disabled-dark"],
  "semantic-settings-switch-thumb-surface": [
    "semantic-switch-thumb-surface-light",
    "semantic-switch-thumb-surface-dark",
  ],
  "semantic-settings-switch-thumb-surface-light": ["semantic-switch-thumb-surface-light"],
  "semantic-settings-switch-thumb-surface-dark": ["semantic-switch-thumb-surface-dark"],
  "semantic-settings-switch-thumb-surface-disabled": [
    "semantic-switch-thumb-surface-disabled-light",
    "semantic-switch-thumb-surface-disabled-dark",
  ],
  "semantic-settings-switch-thumb-surface-disabled-light": ["semantic-switch-thumb-surface-disabled-light"],
  "semantic-settings-switch-thumb-surface-disabled-dark": ["semantic-switch-thumb-surface-disabled-dark"],
  "semantic-segmented-control-surface": [
    "semantic-segmented-control-surface-light",
    "semantic-segmented-control-surface-dark",
  ],
  "semantic-segmented-control-border": [
    "semantic-segmented-control-border-light",
    "semantic-segmented-control-border-dark",
  ],
  "semantic-segmented-control-item-surface-hover": [
    "semantic-segmented-control-item-surface-hover-light",
    "semantic-segmented-control-item-surface-hover-dark",
  ],
  "semantic-segmented-control-item-surface-active": [
    "semantic-segmented-control-item-surface-active-light",
    "semantic-segmented-control-item-surface-active-dark",
  ],
  "semantic-segmented-control-item-text": [
    "semantic-segmented-control-item-text-light",
    "semantic-segmented-control-item-text-dark",
  ],
  "semantic-segmented-control-item-text-hover": [
    "semantic-segmented-control-item-text-hover-light",
    "semantic-segmented-control-item-text-hover-dark",
  ],
  "semantic-segmented-control-item-text-active": [
    "semantic-segmented-control-item-text-active-light",
    "semantic-segmented-control-item-text-active-dark",
  ],
  "semantic-segmented-control-item-meta-text": [
    "semantic-segmented-control-item-meta-text-light",
    "semantic-segmented-control-item-meta-text-dark",
  ],
  "semantic-segmented-control-item-meta-text-active": [
    "semantic-segmented-control-item-meta-text-active-light",
    "semantic-segmented-control-item-meta-text-active-dark",
  ],
  "semantic-segmented-control-item-text-disabled": [
    "semantic-segmented-control-item-text-disabled-light",
    "semantic-segmented-control-item-text-disabled-dark",
  ],
  "semantic-composer-surface": ["semantic-composer-surface-light", "semantic-composer-surface-dark"],
  "semantic-composer-border": ["semantic-composer-border-light", "semantic-composer-border-dark"],
  "semantic-dropdown-menu-surface": [
    "semantic-dropdown-menu-surface-light",
    "semantic-dropdown-menu-surface-dark",
  ],
  "semantic-question-card-surface": [
    "semantic-question-card-surface-light",
    "semantic-question-card-surface-dark",
  ],
  "semantic-proposed-plan-card-surface": [
    "semantic-proposed-plan-card-surface-light",
    "semantic-proposed-plan-card-surface-dark",
  ],
  "semantic-thread-response-text": [
    "semantic-thread-response-text-light",
    "semantic-thread-response-text-dark",
  ],
  "semantic-thread-reasoning-text": [
    "semantic-thread-reasoning-text-light",
    "semantic-thread-reasoning-text-dark",
  ],
  "semantic-thread-divider": ["semantic-thread-divider-light", "semantic-thread-divider-dark"],
  "semantic-thread-panel-surface": [
    "semantic-thread-panel-surface-light",
    "semantic-thread-panel-surface-dark",
  ],
  "semantic-thread-panel-surface-muted": [
    "semantic-thread-panel-surface-muted-light",
    "semantic-thread-panel-surface-muted-dark",
  ],
  "semantic-thread-tool-io-panel-surface": [
    "semantic-thread-tool-io-panel-surface-light",
    "semantic-thread-tool-io-panel-surface-dark",
  ],
  "semantic-thread-panel-surface-hover": [
    "semantic-thread-panel-surface-hover-light",
    "semantic-thread-panel-surface-hover-dark",
  ],
  "semantic-thread-user-message-diff-card-surface": [
    "semantic-thread-user-message-diff-card-surface-light",
    "semantic-thread-user-message-diff-card-surface-dark",
  ],
  "semantic-thread-user-message-diff-card-border": [
    "semantic-thread-user-message-diff-card-border-light",
    "semantic-thread-user-message-diff-card-border-dark",
  ],
  "semantic-thread-user-message-diff-divider": [
    "semantic-thread-user-message-diff-divider-light",
    "semantic-thread-user-message-diff-divider-dark",
  ],
  "semantic-thread-user-message-diff-row-surface-hover": [
    "semantic-thread-user-message-diff-row-surface-hover-light",
    "semantic-thread-user-message-diff-row-surface-hover-dark",
  ],
  "semantic-thread-user-message-diff-row-surface-focus": [
    "semantic-thread-user-message-diff-row-surface-focus-light",
    "semantic-thread-user-message-diff-row-surface-focus-dark",
  ],
  "semantic-thread-user-message-diff-preview-surface": [
    "semantic-thread-user-message-diff-preview-surface-light",
    "semantic-thread-user-message-diff-preview-surface-dark",
  ],
  "semantic-markdown-text": ["semantic-markdown-text-light", "semantic-markdown-text-dark"],
  "semantic-markdown-muted-text": [
    "semantic-markdown-muted-text-light",
    "semantic-markdown-muted-text-dark",
  ],
  "semantic-markdown-strong-text": [
    "semantic-markdown-strong-text-light",
    "semantic-markdown-strong-text-dark",
  ],
  "semantic-markdown-accent": ["semantic-markdown-accent-light", "semantic-markdown-accent-dark"],
  "semantic-markdown-selection-background": [
    "semantic-markdown-selection-background-light",
    "semantic-markdown-selection-background-dark",
  ],
  "semantic-markdown-selection-text": [
    "semantic-markdown-selection-text-light",
    "semantic-markdown-selection-text-dark",
  ],
  "semantic-markdown-border": ["semantic-markdown-border-light", "semantic-markdown-border-dark"],
  "semantic-markdown-border-strong": [
    "semantic-markdown-border-strong-light",
    "semantic-markdown-border-strong-dark",
  ],
  "semantic-markdown-quote-surface": [
    "semantic-markdown-quote-surface-light",
    "semantic-markdown-quote-surface-dark",
  ],
  "semantic-markdown-inline-code-surface": [
    "semantic-markdown-inline-code-surface-light",
    "semantic-markdown-inline-code-surface-dark",
  ],
  "semantic-markdown-table-head-surface": [
    "semantic-markdown-table-head-surface-light",
    "semantic-markdown-table-head-surface-dark",
  ],
  "semantic-markdown-table-row-alt-surface": [
    "semantic-markdown-table-row-alt-surface-light",
    "semantic-markdown-table-row-alt-surface-dark",
  ],
  "semantic-markdown-code-surface": [
    "semantic-markdown-code-surface-light",
    "semantic-markdown-code-surface-dark",
  ],
  "semantic-markdown-code-text": [
    "semantic-markdown-code-text-light",
    "semantic-markdown-code-text-dark",
  ],
  "semantic-markdown-code-muted-text": [
    "semantic-markdown-code-muted-text-light",
    "semantic-markdown-code-muted-text-dark",
  ],
  "semantic-markdown-code-border": [
    "semantic-markdown-code-border-light",
    "semantic-markdown-code-border-dark",
  ],
  "semantic-terminal-surface": [
    "semantic-terminal-surface-light",
    "semantic-terminal-surface-dark",
  ],
  "semantic-composer-button-surface": [
    "semantic-composer-button-surface-light",
    "semantic-composer-button-surface-dark",
  ],
  "semantic-composer-button-surface-strong": [
    "semantic-composer-button-surface-strong-light",
    "semantic-composer-button-surface-strong-dark",
  ],
  "semantic-composer-button-text": ["semantic-composer-button-text-light", "semantic-composer-button-text-dark"],
  "semantic-composer-button-text-strong": [
    "semantic-composer-button-text-strong-light",
    "semantic-composer-button-text-strong-dark",
  ],
  "semantic-composer-icon-button-surface": [
    "semantic-composer-icon-button-surface-light",
    "semantic-composer-icon-button-surface-dark",
  ],
  "semantic-composer-icon-button-surface-hover": [
    "semantic-composer-icon-button-surface-hover-light",
    "semantic-composer-icon-button-surface-hover-dark",
  ],
  "semantic-composer-icon-button-text": [
    "semantic-composer-icon-button-text-light",
    "semantic-composer-icon-button-text-dark",
  ],
  "semantic-composer-icon-button-text-hover": [
    "semantic-composer-icon-button-text-hover-light",
    "semantic-composer-icon-button-text-hover-dark",
  ],
  "semantic-icon-button-text": ["semantic-icon-button-text-light", "semantic-icon-button-text-dark"],
  "semantic-icon-button-text-hover": [
    "semantic-icon-button-text-hover-light",
    "semantic-icon-button-text-hover-dark",
  ],
  "semantic-icon-button-text-active": [
    "semantic-icon-button-text-active-light",
    "semantic-icon-button-text-active-dark",
  ],
  "semantic-icon-button-surface-hover": [
    "semantic-icon-button-surface-hover-light",
    "semantic-icon-button-surface-hover-dark",
  ],
  "semantic-icon-button-surface-active": [
    "semantic-icon-button-surface-active-light",
    "semantic-icon-button-surface-active-dark",
  ],
}

export function isAppearanceTokenName(value: string): value is AppearanceTokenName {
  return APPEARANCE_TOKEN_NAME_SET.has(value)
}

export function isAppearanceFontFamily(value: string): value is AppearanceFontFamily {
  return APPEARANCE_FONT_FAMILY_SET.has(value)
}

export function createDefaultAppearanceConfigDocument(): AppearanceConfigDocument {
  return {
    version: 2,
    brandTheme: DEFAULT_APPEARANCE_THEME_DEFINITION.brandTheme,
    colorMode: DEFAULT_APPEARANCE_THEME_DEFINITION.colorMode,
    fontFamily: DEFAULT_APPEARANCE_THEME_DEFINITION.fontFamily,
    overrides: { ...DEFAULT_APPEARANCE_THEME_DEFINITION.overrides },
    foreignDtcg: {},
    updatedAt: 0,
  }
}

function normalizeAppearanceTokenMap(input: unknown): AppearanceTokenMap {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {}
  }

  const normalized: AppearanceTokenMap = {}

  for (const [key, value] of Object.entries(input)) {
    if (!isAppearanceTokenName(key)) continue

    const normalizedValue = normalizeAppearanceTokenValue(value)
    if (
      normalizedValue &&
      (normalizedValue.type !== "alias" || isAppearanceTokenName(normalizedValue.token))
    ) {
      normalized[key] = normalizedValue
    }
  }

  for (const [key, value] of Object.entries(input)) {
    if (isAppearanceTokenName(key)) continue

    const migratedTokenNames = LEGACY_APPEARANCE_TOKEN_MIGRATIONS[key]
    if (!migratedTokenNames) continue

    const normalizedValue = normalizeAppearanceTokenValue(value)
    if (
      !normalizedValue ||
      (normalizedValue.type === "alias" && !isAppearanceTokenName(normalizedValue.token))
    ) continue

    for (const tokenName of migratedTokenNames) {
      normalized[tokenName] ??= normalizedValue
    }
  }

  return normalized
}

const MAX_FOREIGN_DTCG_JSON_LENGTH = 1_000_000

function normalizeForeignDtcg(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}

  try {
    const serialized = JSON.stringify(input)
    if (!serialized || serialized.length > MAX_FOREIGN_DTCG_JSON_LENGTH) return {}
    const parsed = JSON.parse(serialized) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function validateAppearanceOverrideAliasCycles(
  overrides: Record<string, unknown>,
): string[] {
  const aliases = new Map<AppearanceTokenName, AppearanceTokenName>()
  for (const [tokenName, value] of Object.entries(overrides)) {
    if (!isAppearanceTokenName(tokenName)) continue
    const normalized = normalizeAppearanceTokenValue(value)
    if (
      normalized?.type === "alias" &&
      isAppearanceTokenName(normalized.token)
    ) {
      aliases.set(tokenName, normalized.token)
    }
  }

  const visiting = new Set<AppearanceTokenName>()
  const visited = new Set<AppearanceTokenName>()
  const errors: string[] = []

  function visit(tokenName: AppearanceTokenName, stack: AppearanceTokenName[]) {
    if (visited.has(tokenName)) return
    if (visiting.has(tokenName)) {
      const cycleStart = stack.indexOf(tokenName)
      const cycle = [...stack.slice(Math.max(0, cycleStart)), tokenName]
      errors.push(
        `Appearance token alias cycle: ${cycle
          .map((name) => `--${name}`)
          .join(" -> ")}.`,
      )
      return
    }

    visiting.add(tokenName)
    const target = aliases.get(tokenName)
    if (target) visit(target, [...stack, tokenName])
    visiting.delete(tokenName)
    visited.add(tokenName)
  }

  for (const tokenName of aliases.keys()) visit(tokenName, [])
  return [...new Set(errors)]
}

export function validateAppearanceConfigDocumentStructure(
  input: unknown,
  options: { requireComplete?: boolean } = {},
): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return ["Appearance config must be a JSON object."]
  }

  const record = input as Record<string, unknown>
  const errors: string[] = []
  if (record.version !== 1 && record.version !== 2 && record.version !== undefined) {
    errors.push(`Unsupported appearance config version "${String(record.version)}".`)
  }
  if (options.requireComplete && record.version !== 2) {
    errors.push("Appearance config version must be 2.")
  }

  const requiredFields = [
    "brandTheme",
    "colorMode",
    "fontFamily",
    "overrides",
    "foreignDtcg",
    "updatedAt",
  ] as const
  if (options.requireComplete) {
    for (const field of requiredFields) {
      if (!Object.hasOwn(record, field)) {
        errors.push(`Appearance config is missing "${field}".`)
      }
    }
  }
  if (
    record.brandTheme !== undefined &&
    record.brandTheme !== "terra" &&
    record.brandTheme !== "sage"
  ) {
    errors.push("Appearance config brandTheme must be \"terra\" or \"sage\".")
  }
  if (
    record.colorMode !== undefined &&
    record.colorMode !== "system" &&
    record.colorMode !== "light" &&
    record.colorMode !== "dark"
  ) {
    errors.push("Appearance config colorMode must be \"system\", \"light\", or \"dark\".")
  }
  if (
    record.fontFamily !== undefined &&
    (
      typeof record.fontFamily !== "string" ||
      !isAppearanceFontFamily(record.fontFamily)
    )
  ) {
    errors.push("Appearance config fontFamily is unsupported.")
  }
  if (
    record.updatedAt !== undefined &&
    (
      typeof record.updatedAt !== "number" ||
      !Number.isFinite(record.updatedAt) ||
      record.updatedAt < 0
    )
  ) {
    errors.push("Appearance config updatedAt must be a non-negative finite number.")
  }
  if (
    record.foreignDtcg !== undefined &&
    (
      !record.foreignDtcg ||
      typeof record.foreignDtcg !== "object" ||
      Array.isArray(record.foreignDtcg)
    )
  ) {
    errors.push("Appearance config foreignDtcg must be an object.")
  } else if (record.foreignDtcg !== undefined) {
    try {
      const serialized = JSON.stringify(record.foreignDtcg)
      if (!serialized || serialized.length > MAX_FOREIGN_DTCG_JSON_LENGTH) {
        errors.push(
          `Appearance config foreignDtcg exceeds the ${MAX_FOREIGN_DTCG_JSON_LENGTH.toLocaleString()} character limit.`,
        )
      }
    } catch {
      errors.push("Appearance config foreignDtcg must be JSON-serializable.")
    }
  }
  if (!record.overrides || typeof record.overrides !== "object" || Array.isArray(record.overrides)) {
    if (record.overrides !== undefined || options.requireComplete) {
      errors.push("Appearance config overrides must be an object.")
    }
    return errors
  }

  for (const [tokenName, value] of Object.entries(record.overrides)) {
    const isKnownName = isAppearanceTokenName(tokenName)
    const isLegacyName = Boolean(LEGACY_APPEARANCE_TOKEN_MIGRATIONS[tokenName])
    if (!isKnownName && !isLegacyName) {
      errors.push(`Unknown appearance token "--${tokenName}".`)
      continue
    }

    const normalizedValue = normalizeAppearanceTokenValue(value)
    if (!normalizedValue) {
      errors.push(`Appearance token "--${tokenName}" has an invalid color value.`)
      continue
    }
    if (normalizedValue.type === "alias" && !isAppearanceTokenName(normalizedValue.token)) {
      errors.push(
        `Appearance token "--${tokenName}" aliases unknown public mode token "--${normalizedValue.token}".`,
      )
    }
  }

  errors.push(
    ...validateAppearanceOverrideAliasCycles(
      record.overrides as Record<string, unknown>,
    ),
  )
  return errors
}

export function normalizeAppearanceConfigDocument(input: unknown): AppearanceConfigDocument {
  const defaults = createDefaultAppearanceConfigDocument()
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return defaults
  }

  const partial = input as Partial<AppearanceConfigDocument>
  const brandTheme =
    partial.brandTheme === "terra" || partial.brandTheme === "sage"
      ? partial.brandTheme
      : defaults.brandTheme
  const colorMode =
    partial.colorMode === "light" || partial.colorMode === "dark" || partial.colorMode === "system"
      ? partial.colorMode
      : defaults.colorMode
  const fontFamily =
    typeof partial.fontFamily === "string" && isAppearanceFontFamily(partial.fontFamily)
      ? partial.fontFamily
      : defaults.fontFamily
  const updatedAt = typeof partial.updatedAt === "number" && Number.isFinite(partial.updatedAt)
    ? partial.updatedAt
    : 0

  return {
    version: 2,
    brandTheme,
    colorMode,
    fontFamily,
    overrides: normalizeAppearanceTokenMap(partial.overrides),
    foreignDtcg: normalizeForeignDtcg(
      (input as { foreignDtcg?: unknown }).foreignDtcg,
    ),
    updatedAt,
  }
}

const APPEARANCE_CODE_HIGHLIGHT_THEME_SET = new Set<string>(APPEARANCE_CODE_HIGHLIGHT_THEMES)
const MAX_APPEARANCE_HTML_BACKGROUND_HTML_LENGTH = 220_000
const LEGACY_LOW_VISIBILITY_HTML_BACKGROUND_DEFAULTS = {
  dim: 0.34,
  opacity: 0.64,
  surfaceOpacity: 0.82,
}

export function isAppearanceCodeHighlightTheme(value: string | null | undefined): value is AppearanceCodeHighlightTheme {
  return Boolean(value && APPEARANCE_CODE_HIGHLIGHT_THEME_SET.has(value))
}

export function normalizeAppearanceCodeThemePreference(value: unknown): AppearanceCodeThemePreference {
  if (typeof value !== "string") {
    return DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE
  }

  if (value === DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE || isAppearanceCodeHighlightTheme(value)) {
    return value
  }

  return DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE
}

function clampAppearanceNumber(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numberValue)) return fallback
  return Math.min(max, Math.max(min, numberValue))
}

export function normalizeAppearanceHtmlBackgroundConfig(value: unknown): AppearanceHtmlBackgroundConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG }
  }

  const record = value as Record<string, unknown>
  const rawHtml = typeof record.html === "string" ? record.html : ""
  const html = rawHtml.length > MAX_APPEARANCE_HTML_BACKGROUND_HTML_LENGTH
    ? rawHtml.slice(0, MAX_APPEARANCE_HTML_BACKGROUND_HTML_LENGTH)
    : rawHtml
  const usesLegacyLowVisibilityDefaults =
    record.dim === LEGACY_LOW_VISIBILITY_HTML_BACKGROUND_DEFAULTS.dim &&
    record.opacity === LEGACY_LOW_VISIBILITY_HTML_BACKGROUND_DEFAULTS.opacity &&
    record.surfaceOpacity === LEGACY_LOW_VISIBILITY_HTML_BACKGROUND_DEFAULTS.surfaceOpacity

  return {
    blurPx: clampAppearanceNumber(
      record.blurPx,
      0,
      24,
      DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG.blurPx,
    ),
    dim: usesLegacyLowVisibilityDefaults
      ? DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG.dim
      : clampAppearanceNumber(record.dim, 0, 0.86, DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG.dim),
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG.enabled,
    html,
    opacity: usesLegacyLowVisibilityDefaults
      ? DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG.opacity
      : clampAppearanceNumber(record.opacity, 0.08, 1, DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG.opacity),
    paused: typeof record.paused === "boolean" ? record.paused : DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG.paused,
    renderMode: record.renderMode === "dynamic" ? "dynamic" : DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG.renderMode,
    surfaceOpacity: usesLegacyLowVisibilityDefaults
      ? DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG.surfaceOpacity
      : clampAppearanceNumber(
        record.surfaceOpacity,
        0.36,
        1,
        DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG.surfaceOpacity,
      ),
  }
}

export function resolveAppearanceHtmlBackgroundState(
  config: AppearanceHtmlBackgroundConfig,
): AppearanceHtmlBackgroundState {
  const hasHtmlBackground = config.enabled && config.html.trim().length > 0

  return {
    backgroundMode: hasHtmlBackground ? "custom-html" : "default",
    hasHtmlBackground,
  }
}

export function createDefaultAppearanceRuntimeState(
  document: AppearanceConfigDocument = createDefaultAppearanceConfigDocument(),
): AppearanceRuntimeState {
  return {
    document: normalizeAppearanceConfigDocument(document),
    codeThemePreference: DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE,
    htmlBackgroundConfig: { ...DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG },
  }
}

export function normalizeAppearanceRuntimeState(
  input: unknown,
  fallback: AppearanceRuntimeState = createDefaultAppearanceRuntimeState(),
): AppearanceRuntimeState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fallback
  }

  const record = input as Partial<AppearanceRuntimeState>

  return {
    document: normalizeAppearanceConfigDocument(record.document ?? fallback.document),
    codeThemePreference: normalizeAppearanceCodeThemePreference(
      record.codeThemePreference ?? fallback.codeThemePreference,
    ),
    htmlBackgroundConfig: normalizeAppearanceHtmlBackgroundConfig(
      record.htmlBackgroundConfig ?? fallback.htmlBackgroundConfig,
    ),
  }
}
