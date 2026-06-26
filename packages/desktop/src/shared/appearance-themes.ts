import {
  DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE,
  DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG,
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

export interface AppearanceThemeRenameInput {
  themeID: string
  name: string
}

export interface AppearanceThemeMutationResult {
  snapshot: AppearanceThemeLibrarySnapshot
  theme: AppearanceTheme | null
}

export const DEFAULT_APPEARANCE_THEME_ID = "built-in:classic"

const APPEARANCE_THEME_ID_PATTERN = /^[a-z0-9:_-]+$/i
const MAX_APPEARANCE_THEME_ID_LENGTH = 120
const MAX_APPEARANCE_THEME_NAME_LENGTH = 80
const DEFAULT_USER_THEME_NAME = "My Theme"

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

const CLASSIC_OVERRIDES = {
  "surface-app-light": "#f2f2f2",
  "surface-shell-light": "rgba(255, 255, 255, 0)",
  "surface-panel-light": "#f2f2f2",
  "surface-panel-muted-light": "rgba(232, 232, 232, 0.01)",
  "surface-sidebar-light": "rgba(232, 232, 232, 0)",
  "surface-sidebar-strong-light": "rgba(232, 232, 232, 0)",
  "surface-user-bubble-light": "rgba(255, 255, 255, 0)",
  "surface-trace-light": "rgba(255, 255, 255, 0)",
  "surface-elevated-light": "rgba(227, 227, 227, 0)",
  "surface-code-light": "rgba(28, 28, 28, 0)",
  "surface-code-strong-light": "rgba(0, 0, 0, 0)",
  "text-primary-light": "#000000",
  "text-secondary-dark": "#ababab",
  "text-tertiary-light": "rgba(0, 0, 0, 0.5)",
  "text-on-dark-light": "#ffffff",
  "border-subtle-light": "#bcbcbc",
  "border-default-light": "rgba(0, 0, 0, 0.11)",
  "brand-primary": "rgba(0, 0, 0, 0.66)",
  "brand-primary-dark": "rgba(255, 255, 255, 0.66)",
  "brand-primary-hover": "#000000",
  "brand-primary-hover-dark": "#ffffff",
  "brand-accent-highlight": "rgba(199, 199, 199, 0)",
  "brand-accent-highlight-dark": "rgba(97, 97, 97, 0)",
  "semantic-accent-icon-light": "#000000",
  "semantic-accent-icon-hover-light": "#000000",
  "semantic-accent-icon-active-light": "#000000",
  "semantic-markdown-inline-code-surface-light": "#ffffff",
  "semantic-sidebar-tree-row-text-light": "#525252",
  "semantic-sidebar-tree-row-text-active-light": "#000000",
  "semantic-sidebar-tree-row-surface-hover-light": "#dedede",
  "semantic-sidebar-tree-row-surface-active-light": "#dedede",
  "semantic-sidebar-tree-row-leading-active-light": "#000000",
  "semantic-dropdown-menu-surface-light": "#fafafa",
  "semantic-composer-button-text-light": "#000000",
  "semantic-composer-button-text-dark": "#ffffff",
  "semantic-composer-button-text-strong-light": "#212121",
  "semantic-composer-button-text-strong-dark": "#ffffff",
  "semantic-shell-chrome-surface-light": "rgba(0, 0, 0, 0)",
  "surface-overlay-light": "rgba(41, 37, 36, 0)",
  "text-secondary-light": "rgba(0, 0, 0, 0.47)",
  "text-primary-dark": "#ffffff",
  "text-tertiary-dark": "#ababab",
  "brand-primary-soft": "rgba(0, 0, 0, 0)",
  "brand-primary-soft-strong": "#000000",
  "semantic-button-primary-surface-light": "rgba(0, 0, 0, 0.83)",
  "semantic-button-primary-surface-hover-light": "#000000",
  "semantic-button-primary-border-light": "rgba(255, 0, 0, 0)",
  "semantic-button-primary-border-hover-light": "rgba(0, 0, 0, 0)",
  "semantic-button-primary-disabled-surface-light": "#a9a9a9",
  "semantic-button-primary-disabled-border-light": "rgba(41, 37, 36, 0)",
  "semantic-button-primary-disabled-text-light": "#ffffff",
  "semantic-button-secondary-surface-light": "#d6d6d6",
  "semantic-button-secondary-surface-hover-light": "#a7a7a7",
  "semantic-button-secondary-border-light": "rgba(41, 37, 36, 0)",
  "semantic-button-secondary-border-hover-light": "rgba(226, 200, 197, 0)",
  "semantic-button-secondary-text-light": "#000000",
  "semantic-button-secondary-disabled-surface-light": "#d6d5d5",
  "semantic-button-secondary-disabled-border-light": "rgba(41, 37, 36, 0)",
  "semantic-button-danger-surface-light": "rgba(157, 0, 0, 0.43)",
  "semantic-button-danger-surface-hover-light": "#e16f6f",
  "semantic-button-danger-border-light": "rgba(211, 170, 180, 0)",
  "semantic-button-danger-border-hover-light": "rgba(211, 170, 180, 0)",
  "semantic-button-danger-text-light": "#000000",
  "semantic-button-danger-text-hover-light": "#1d1c1c",
  "semantic-button-danger-disabled-surface-light": "#a5a5a5",
  "semantic-button-danger-disabled-border-light": "rgba(41, 37, 36, 0)",
  "semantic-success-light": "#64a805",
  "semantic-success-strong-light": "#64a805",
  "semantic-success-text-light": "#64a805",
  "semantic-info-light": "#7a7ce2",
  "semantic-info-surface-light": "#c8c8f6",
  "semantic-info-surface-strong-light": "#0914dc",
  "semantic-info-border-light": "rgba(10, 0, 202, 0)",
  "semantic-info-text-light": "#7c7dc5",
  "semantic-info-strong-light": "#8283c3",
  "semantic-composer-button-surface-light": "rgba(197, 197, 197, 0.15)",
  "semantic-composer-button-surface-strong-light": "rgba(0, 0, 0, 0.12)",
  "semantic-composer-surface-light": "rgba(255, 255, 255, 0)",
  "semantic-settings-switch-row-surface-focus-light": "#958884",
  "semantic-composer-border-light": "rgba(0, 0, 0, 0.2)",
  "semantic-segmented-control-item-surface-active-light": "#c5c5c5",
  "semantic-segmented-control-surface-light": "#e5e5e5",
  "semantic-segmented-control-border-light": "rgba(28, 26, 26, 0)",
  "semantic-segmented-control-item-surface-hover-light": "rgba(213, 213, 213, 0.86)",
  "semantic-thread-response-text-light": "#ffffff",
  "semantic-thread-reasoning-text-light": "rgba(0, 0, 0, 0.56)",
  "semantic-thread-divider-light": "rgba(41, 37, 36, 0.12)",
  "semantic-thread-panel-surface-light": "#ffffff",
  "semantic-thread-panel-surface-muted-light": "rgba(255, 255, 255, 0)",
  "semantic-markdown-text-light": "#000000",
  "semantic-markdown-strong-text-light": "#000000",
  "semantic-markdown-muted-text-light": "#000000",
  "semantic-markdown-accent-light": "#000000",
  "semantic-markdown-border-light": "rgba(177, 177, 177, 0.82)",
  "semantic-markdown-code-surface-light": "#000000",
  "semantic-markdown-table-head-surface-light": "#949494",
  "semantic-markdown-selection-background-light": "#a9a9a9",
  "semantic-markdown-selection-text-light": "#000000",
  "semantic-markdown-table-row-alt-surface-light": "rgba(0, 0, 0, 0.14)",
  "semantic-composer-icon-button-surface-light": "rgba(0, 0, 0, 0)",
  "semantic-composer-icon-button-surface-hover-light": "rgba(197, 197, 197, 0.15)",
  "semantic-composer-icon-button-text-light": "#000000",
  "semantic-icon-button-text-hover-light": "#000000",
  "semantic-icon-button-text-light": "rgba(0, 0, 0, 0.9)",
  "semantic-icon-button-text-active-light": "#000000",
  "semantic-icon-button-surface-hover-light": "rgba(130, 130, 130, 0.3)",
  "semantic-icon-button-surface-active-light": "rgba(0, 0, 0, 0.21)",
  "semantic-thread-panel-surface-hover-light": "rgba(0, 0, 0, 0.08)",
  "semantic-settings-switch-track-border-light": "rgba(0, 0, 0, 0)",
  "semantic-settings-switch-track-surface-active-light": "rgba(60, 0, 255, 0.49)",
  "semantic-settings-switch-track-surface-light": "#646464",
  "semantic-settings-switch-track-border-focus-light": "rgba(0, 0, 0, 0)",
  "semantic-settings-switch-track-border-active-light": "rgba(60, 0, 255, 0)",
  "semantic-popup-panel-surface-light": "#ffffff",
  "semantic-settings-list-detail-row-surface-hover-light": "rgba(196, 196, 196, 0.86)",
  "surface-app-dark": "#141414",
  "surface-shell-dark": "rgba(34, 29, 26, 0)",
  "surface-panel-dark": "rgba(0, 0, 0, 0)",
  "surface-panel-muted-dark": "rgba(52, 45, 42, 0)",
  "surface-sidebar-dark": "rgba(36, 31, 28, 0)",
  "surface-sidebar-strong-dark": "rgba(24, 19, 17, 0)",
  "surface-user-bubble-dark": "rgba(0, 0, 0, 0.16)",
  "surface-trace-dark": "rgba(36, 29, 27, 0)",
  "surface-elevated-dark": "rgba(41, 37, 36, 0)",
  "surface-overlay-dark": "rgba(149, 135, 127, 0)",
  "surface-code-dark": "rgba(39, 39, 42, 0)",
  "surface-code-strong-dark": "rgba(20, 16, 15, 0)",
  "text-on-dark-dark": "#ffffff",
  "border-default-dark": "rgba(231, 229, 228, 0.29)",
  "border-subtle-dark": "rgba(103, 103, 103, 0.56)",
  "semantic-accent-icon-dark": "#ffffff",
  "semantic-accent-icon-hover-dark": "#ffffff",
  "semantic-accent-icon-active-dark": "#ffffff",
  "brand-primary-soft-dark": "#ffffff",
  "brand-primary-soft-strong-dark": "#ffffff",
  "semantic-button-primary-surface-dark": "#ffffff",
  "semantic-button-primary-surface-hover-dark": "#ffffff",
  "semantic-button-primary-border-dark": "rgba(207, 207, 207, 0)",
  "semantic-button-primary-border-hover-dark": "rgba(255, 255, 255, 0)",
  "semantic-button-primary-text-dark": "#000000",
  "semantic-button-primary-text-hover-dark": "#ffffff",
  "semantic-button-primary-disabled-surface-dark": "#2b2b2b",
  "semantic-button-primary-disabled-border-dark": "rgba(86, 86, 86, 0.32)",
  "semantic-button-primary-disabled-text-dark": "#ffffff",
  "semantic-button-secondary-surface-dark": "#1e1e1e",
  "semantic-button-secondary-surface-hover-dark": "#2a2a2a",
  "semantic-button-secondary-border-dark": "rgba(231, 229, 228, 0)",
  "semantic-button-secondary-border-hover-dark": "rgba(228, 163, 158, 0)",
  "semantic-button-secondary-disabled-surface-dark": "#878787",
  "semantic-button-secondary-disabled-border-dark": "rgba(231, 229, 228, 0)",
  "semantic-button-secondary-disabled-text-dark": "rgba(143, 143, 143, 0.68)",
  "semantic-button-danger-surface-dark": "rgba(157, 0, 0, 0.43)",
  "semantic-button-danger-surface-hover-dark": "#e16f6f",
  "semantic-button-danger-border-dark": "rgba(211, 170, 180, 0)",
  "semantic-button-danger-border-hover-dark": "rgba(211, 170, 180, 0)",
  "semantic-button-danger-text-dark": "#e3e3e3",
  "semantic-button-danger-text-hover-dark": "#ffffff",
  "semantic-button-danger-disabled-surface-dark": "#8c8c8c",
  "semantic-button-danger-disabled-border-dark": "rgba(231, 229, 228, 0)",
  "semantic-button-danger-disabled-text-dark": "rgba(0, 0, 0, 0.4)",
  "semantic-icon-button-text-dark": "#ffffff",
  "semantic-icon-button-text-hover-dark": "#ffffff",
  "semantic-icon-button-text-active-dark": "#ffffff",
  "semantic-icon-button-surface-hover-dark": "rgba(52, 45, 42, 0)",
  "semantic-icon-button-surface-active-dark": "rgba(225, 112, 104, 0)",
  "semantic-shell-chrome-surface-dark": "rgba(34, 29, 26, 0)",
  "semantic-popup-panel-surface-dark": "#2b2b2b",
  "semantic-settings-switch-row-surface-focus-dark": "#342d2a",
  "semantic-sidebar-tree-row-surface-active-dark": "rgba(255, 255, 255, 0.12)",
  "semantic-sidebar-tree-row-surface-hover-dark": "rgba(255, 255, 255, 0.12)",
  "semantic-settings-switch-track-surface-dark": "#a5a5a5",
  "semantic-settings-switch-track-border-dark": "rgba(231, 229, 228, 0)",
  "semantic-settings-switch-track-border-focus-dark": "rgba(226, 141, 135, 0)",
  "semantic-settings-switch-track-surface-active-dark": "#ab8cff",
  "semantic-settings-switch-track-border-active-dark": "rgba(165, 165, 165, 0)",
  "semantic-settings-switch-track-border-disabled-dark": "rgba(231, 229, 228, 0)",
  "semantic-settings-switch-thumb-surface-dark": "#ffffff",
  "semantic-settings-switch-thumb-surface-disabled-dark": "#dfdfdf",
  "semantic-dropdown-menu-surface-dark": "#252525",
  "semantic-composer-surface-dark": "#282828",
  "semantic-composer-border-dark": "rgba(231, 229, 228, 0)",
  "semantic-composer-button-surface-dark": "rgba(255, 255, 255, 0.28)",
  "semantic-composer-icon-button-surface-dark": "rgba(0, 0, 0, 0)",
  "semantic-composer-icon-button-surface-hover-dark": "rgba(255, 255, 255, 0.06)",
  "semantic-markdown-border-strong-dark": "rgba(255, 255, 255, 0.55)",
  "semantic-markdown-selection-background-dark": "rgba(255, 255, 255, 0.118)",
  "semantic-markdown-quote-surface-dark": "rgba(108, 108, 108, 0.381)",
  "semantic-markdown-inline-code-surface-dark": "rgba(140, 138, 138, 0.312)",
  "semantic-markdown-table-head-surface-dark": "#272727",
  "semantic-markdown-table-row-alt-surface-dark": "#363636",
  "semantic-segmented-control-item-surface-active-dark": "rgba(221, 221, 221, 0.38)",
} satisfies AppearanceTokenMap

const TRANSPARENT_FROSTED_OVERRIDES = {
  "surface-app-light": "rgba(242, 242, 242, 0)",
  "surface-shell-light": "rgba(255, 255, 255, 0)",
  "surface-panel-light": "rgba(242, 242, 242, 0)",
  "surface-panel-muted-light": "rgba(232, 232, 232, 0.01)",
  "surface-sidebar-light": "rgba(232, 232, 232, 0)",
  "surface-sidebar-strong-light": "rgba(232, 232, 232, 0)",
  "surface-user-bubble-light": "rgba(255, 255, 255, 0)",
  "surface-trace-light": "rgba(255, 255, 255, 0)",
  "surface-elevated-light": "rgba(227, 227, 227, 0)",
  "surface-code-light": "rgba(28, 28, 28, 0)",
  "surface-code-strong-light": "rgba(0, 0, 0, 0)",
  "text-primary-light": "#000000",
  "text-secondary-dark": "#ababab",
  "text-tertiary-light": "rgba(0, 0, 0, 0.5)",
  "text-on-dark-light": "#ffffff",
  "border-subtle-light": "rgba(255, 255, 255, 0)",
  "border-default-light": "rgba(0, 0, 0, 0)",
  "brand-primary": "rgba(0, 0, 0, 0.66)",
  "brand-primary-dark": "rgba(255, 255, 255, 0.66)",
  "brand-primary-hover": "#000000",
  "brand-primary-hover-dark": "#ffffff",
  "brand-accent-highlight": "rgba(199, 199, 199, 0)",
  "brand-accent-highlight-dark": "rgba(97, 97, 97, 0)",
  "semantic-accent-icon-light": "#000000",
  "semantic-accent-icon-hover-light": "#000000",
  "semantic-accent-icon-active-light": "#000000",
  "semantic-markdown-inline-code-surface-light": "rgba(255, 255, 255, 0.24)",
  "semantic-sidebar-tree-row-text-light": "#525252",
  "semantic-sidebar-tree-row-text-active-light": "#000000",
  "semantic-sidebar-tree-row-surface-hover-light": "#dedede",
  "semantic-sidebar-tree-row-surface-active-light": "rgba(222, 222, 222, 0.38)",
  "semantic-sidebar-tree-row-leading-active-light": "#000000",
  "semantic-dropdown-menu-surface-light": "#fafafa",
  "semantic-composer-button-text-light": "#000000",
  "semantic-composer-button-text-dark": "#ffffff",
  "semantic-composer-button-text-strong-light": "#212121",
  "semantic-composer-button-text-strong-dark": "#ffffff",
  "semantic-shell-chrome-surface-light": "rgba(0, 0, 0, 0)",
  "surface-overlay-light": "rgba(41, 37, 36, 0)",
  "text-secondary-light": "rgba(0, 0, 0, 0.47)",
  "text-primary-dark": "#ffffff",
  "text-tertiary-dark": "#ababab",
  "brand-primary-soft": "#000000",
  "brand-primary-soft-strong": "#000000",
  "semantic-button-primary-surface-light": "rgba(0, 0, 0, 0.83)",
  "semantic-button-primary-surface-hover-light": "#000000",
  "semantic-button-primary-border-light": "rgba(255, 255, 255, 0)",
  "semantic-button-primary-border-hover-light": "rgba(0, 0, 0, 0)",
  "semantic-button-primary-disabled-surface-light": "#a9a9a9",
  "semantic-button-primary-disabled-border-light": "rgba(41, 37, 36, 0)",
  "semantic-button-primary-disabled-text-light": "#ffffff",
  "semantic-button-secondary-surface-light": "rgba(214, 214, 214, 0)",
  "semantic-button-secondary-surface-hover-light": "#a7a7a7",
  "semantic-button-secondary-border-light": "rgba(41, 37, 36, 0)",
  "semantic-button-secondary-border-hover-light": "rgba(226, 200, 197, 0)",
  "semantic-button-secondary-text-light": "#000000",
  "semantic-button-secondary-disabled-surface-light": "#d6d5d5",
  "semantic-button-secondary-disabled-border-light": "rgba(41, 37, 36, 0)",
  "semantic-button-danger-surface-light": "rgba(157, 0, 0, 0.43)",
  "semantic-button-danger-surface-hover-light": "#e16f6f",
  "semantic-button-danger-border-light": "rgba(211, 170, 180, 0)",
  "semantic-button-danger-border-hover-light": "rgba(211, 170, 180, 0)",
  "semantic-button-danger-text-light": "#000000",
  "semantic-button-danger-text-hover-light": "#1d1c1c",
  "semantic-button-danger-disabled-surface-light": "#a5a5a5",
  "semantic-button-danger-disabled-border-light": "rgba(41, 37, 36, 0)",
  "semantic-success-light": "#64a805",
  "semantic-success-strong-light": "#64a805",
  "semantic-success-text-light": "#64a805",
  "semantic-info-light": "#7a7ce2",
  "semantic-info-surface-light": "#c8c8f6",
  "semantic-info-surface-strong-light": "#0914dc",
  "semantic-info-border-light": "rgba(10, 0, 202, 0)",
  "semantic-info-text-light": "#7c7dc5",
  "semantic-info-strong-light": "#8283c3",
  "semantic-composer-button-surface-light": "rgba(197, 197, 197, 0.15)",
  "semantic-composer-button-surface-strong-light": "rgba(0, 0, 0, 0.12)",
  "semantic-composer-surface-light": "rgba(255, 255, 255, 0)",
  "semantic-settings-switch-row-surface-focus-light": "#958884",
  "semantic-composer-border-light": "rgba(0, 0, 0, 0.2)",
  "semantic-segmented-control-item-surface-active-light": "#c5c5c5",
  "semantic-segmented-control-surface-light": "#e5e5e5",
  "semantic-segmented-control-border-light": "rgba(28, 26, 26, 0)",
  "semantic-segmented-control-item-surface-hover-light": "rgba(213, 213, 213, 0.86)",
  "semantic-thread-response-text-light": "#ffffff",
  "semantic-thread-reasoning-text-light": "rgba(0, 0, 0, 0.56)",
  "semantic-thread-divider-light": "rgba(41, 37, 36, 0.12)",
  "semantic-thread-panel-surface-light": "rgba(255, 255, 255, 0.03)",
  "semantic-thread-panel-surface-muted-light": "rgba(255, 255, 255, 0)",
  "semantic-markdown-text-light": "#000000",
  "semantic-markdown-strong-text-light": "#000000",
  "semantic-markdown-muted-text-light": "#000000",
  "semantic-markdown-accent-light": "#000000",
  "semantic-markdown-border-light": "rgba(177, 177, 177, 0.82)",
  "semantic-markdown-code-surface-light": "rgba(0, 0, 0, 0.66)",
  "semantic-markdown-table-head-surface-light": "#949494",
  "semantic-markdown-selection-background-light": "#a9a9a9",
  "semantic-markdown-selection-text-light": "#000000",
  "semantic-markdown-table-row-alt-surface-light": "rgba(0, 0, 0, 0.14)",
  "semantic-composer-icon-button-surface-light": "rgba(0, 0, 0, 0)",
  "semantic-composer-icon-button-surface-hover-light": "rgba(197, 197, 197, 0.15)",
  "semantic-composer-icon-button-text-light": "#000000",
  "semantic-icon-button-text-hover-light": "#000000",
  "semantic-icon-button-text-light": "rgba(0, 0, 0, 0.9)",
  "semantic-icon-button-text-active-light": "#000000",
  "semantic-icon-button-surface-hover-light": "rgba(130, 130, 130, 0.3)",
  "semantic-icon-button-surface-active-light": "rgba(0, 0, 0, 0.21)",
  "semantic-thread-panel-surface-hover-light": "rgba(0, 0, 0, 0.08)",
  "semantic-settings-switch-track-border-light": "rgba(0, 0, 0, 0)",
  "semantic-settings-switch-track-surface-active-light": "rgba(60, 0, 255, 0.49)",
  "semantic-settings-switch-track-surface-light": "#646464",
  "semantic-settings-switch-track-border-focus-light": "rgba(0, 0, 0, 0)",
  "semantic-settings-switch-track-border-active-light": "rgba(60, 0, 255, 0)",
  "semantic-popup-panel-surface-light": "#ffffff",
  "semantic-settings-list-detail-row-surface-hover-light": "rgba(196, 196, 196, 0.86)",
  "surface-app-dark": "rgba(20, 20, 20, 0)",
  "surface-shell-dark": "rgba(34, 29, 26, 0)",
  "surface-panel-dark": "rgba(0, 0, 0, 0)",
  "surface-panel-muted-dark": "rgba(52, 45, 42, 0)",
  "surface-sidebar-dark": "rgba(36, 31, 28, 0)",
  "surface-sidebar-strong-dark": "rgba(24, 19, 17, 0)",
  "surface-user-bubble-dark": "rgba(0, 0, 0, 0.16)",
  "surface-trace-dark": "rgba(36, 29, 27, 0)",
  "surface-elevated-dark": "rgba(41, 37, 36, 0)",
  "surface-overlay-dark": "rgba(149, 135, 127, 0)",
  "surface-code-dark": "rgba(39, 39, 42, 0)",
  "surface-code-strong-dark": "rgba(20, 16, 15, 0)",
  "text-on-dark-dark": "#ffffff",
  "border-default-dark": "rgba(231, 229, 228, 0.29)",
  "border-subtle-dark": "rgba(103, 103, 103, 0.56)",
  "semantic-accent-icon-dark": "#ffffff",
  "semantic-accent-icon-hover-dark": "#ffffff",
  "semantic-accent-icon-active-dark": "#ffffff",
  "brand-primary-soft-dark": "#ffffff",
  "brand-primary-soft-strong-dark": "#ffffff",
  "semantic-button-primary-surface-dark": "#ffffff",
  "semantic-button-primary-surface-hover-dark": "#ffffff",
  "semantic-button-primary-border-dark": "rgba(207, 207, 207, 0)",
  "semantic-button-primary-border-hover-dark": "rgba(255, 255, 255, 0)",
  "semantic-button-primary-text-dark": "#000000",
  "semantic-button-primary-text-hover-dark": "#ffffff",
  "semantic-button-primary-disabled-surface-dark": "#2b2b2b",
  "semantic-button-primary-disabled-border-dark": "rgba(86, 86, 86, 0.32)",
  "semantic-button-primary-disabled-text-dark": "#ffffff",
  "semantic-button-secondary-surface-dark": "#1e1e1e",
  "semantic-button-secondary-surface-hover-dark": "#2a2a2a",
  "semantic-button-secondary-border-dark": "rgba(231, 229, 228, 0)",
  "semantic-button-secondary-border-hover-dark": "rgba(228, 163, 158, 0)",
  "semantic-button-secondary-disabled-surface-dark": "#878787",
  "semantic-button-secondary-disabled-border-dark": "rgba(231, 229, 228, 0)",
  "semantic-button-secondary-disabled-text-dark": "rgba(143, 143, 143, 0.68)",
  "semantic-button-danger-surface-dark": "rgba(157, 0, 0, 0.43)",
  "semantic-button-danger-surface-hover-dark": "#e16f6f",
  "semantic-button-danger-border-dark": "rgba(211, 170, 180, 0)",
  "semantic-button-danger-border-hover-dark": "rgba(211, 170, 180, 0)",
  "semantic-button-danger-text-dark": "#e3e3e3",
  "semantic-button-danger-text-hover-dark": "#ffffff",
  "semantic-button-danger-disabled-surface-dark": "#8c8c8c",
  "semantic-button-danger-disabled-border-dark": "rgba(231, 229, 228, 0)",
  "semantic-button-danger-disabled-text-dark": "rgba(0, 0, 0, 0.4)",
  "semantic-icon-button-text-dark": "#ffffff",
  "semantic-icon-button-text-hover-dark": "#ffffff",
  "semantic-icon-button-text-active-dark": "#ffffff",
  "semantic-icon-button-surface-hover-dark": "rgba(52, 45, 42, 0)",
  "semantic-icon-button-surface-active-dark": "rgba(225, 112, 104, 0)",
  "semantic-shell-chrome-surface-dark": "rgba(34, 29, 26, 0)",
  "semantic-popup-panel-surface-dark": "#2b2b2b",
  "semantic-settings-switch-row-surface-focus-dark": "#342d2a",
  "semantic-sidebar-tree-row-surface-active-dark": "rgba(255, 255, 255, 0.12)",
  "semantic-sidebar-tree-row-surface-hover-dark": "rgba(255, 255, 255, 0.12)",
  "semantic-settings-switch-track-surface-dark": "#a5a5a5",
  "semantic-settings-switch-track-border-dark": "rgba(231, 229, 228, 0)",
  "semantic-settings-switch-track-border-focus-dark": "rgba(226, 141, 135, 0)",
  "semantic-settings-switch-track-surface-active-dark": "#ab8cff",
  "semantic-settings-switch-track-border-active-dark": "rgba(165, 165, 165, 0)",
  "semantic-settings-switch-track-border-disabled-dark": "rgba(231, 229, 228, 0)",
  "semantic-settings-switch-thumb-surface-dark": "#ffffff",
  "semantic-settings-switch-thumb-surface-disabled-dark": "#dfdfdf",
  "semantic-dropdown-menu-surface-dark": "#252525",
  "semantic-composer-surface-dark": "rgba(40, 40, 40, 0.21)",
  "semantic-composer-border-dark": "rgba(231, 229, 228, 0)",
  "semantic-composer-button-surface-dark": "rgba(255, 255, 255, 0.28)",
  "semantic-composer-icon-button-surface-dark": "rgba(0, 0, 0, 0)",
  "semantic-composer-icon-button-surface-hover-dark": "rgba(255, 255, 255, 0.06)",
  "semantic-markdown-border-strong-dark": "rgba(255, 255, 255, 0.55)",
  "semantic-markdown-selection-background-dark": "rgba(255, 255, 255, 0.118)",
  "semantic-markdown-quote-surface-dark": "rgba(108, 108, 108, 0.381)",
  "semantic-markdown-inline-code-surface-dark": "rgba(140, 138, 138, 0.312)",
  "semantic-markdown-table-head-surface-dark": "#272727",
  "semantic-markdown-table-row-alt-surface-dark": "#363636",
  "semantic-segmented-control-item-surface-active-dark": "rgba(221, 221, 221, 0.38)",
  "semantic-thread-user-turn-diff-card-border-light": "rgba(231, 229, 228, 0)",
  "semantic-thread-user-turn-diff-card-surface-light": "rgba(255, 255, 255, 0.1)",
  "semantic-thread-user-turn-diff-divider-light": "rgba(255, 255, 255, 0.21)",
  "semantic-thread-user-turn-diff-row-surface-hover-light": "rgba(222, 222, 222, 0.14)",
  "semantic-markdown-code-border-light": "rgba(139, 138, 139, 0)",
  "semantic-markdown-code-border-dark": "rgba(79, 78, 80, 0)",
} satisfies AppearanceTokenMap

export const BUILT_IN_APPEARANCE_THEME_PRESETS = [
  {
    id: DEFAULT_APPEARANCE_THEME_ID,
    name: "经典",
    source: "built-in",
    readonly: true,
    createdAt: 0,
    updatedAt: 0,
    colorMode: "light",
    brandTheme: "terra",
    fontFamily: "default",
    codeThemePreference: DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE,
    htmlBackgroundConfig: { ...DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG },
    overrides: { ...CLASSIC_OVERRIDES },
  },
  {
    id: "built-in:transparent-frosted",
    name: "透明磨砂",
    source: "built-in",
    readonly: true,
    createdAt: 0,
    updatedAt: 0,
    colorMode: "light",
    brandTheme: "terra",
    fontFamily: "default",
    codeThemePreference: DEFAULT_APPEARANCE_CODE_THEME_PREFERENCE,
    htmlBackgroundConfig: { ...DEFAULT_APPEARANCE_HTML_BACKGROUND_CONFIG },
    overrides: { ...TRANSPARENT_FROSTED_OVERRIDES },
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
