import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type PointerEvent,
} from "react"
import {
  APPEARANCE_TOKEN_LAYERS,
  APPEARANCE_TOKEN_GROUPS,
  type AppearanceFontFamily,
  type AppearanceTokenGroup,
  type AppearanceTokenLayer,
  type AppearanceTokenMap,
  type AppearanceTokenName,
} from "../../../../shared/appearance"
import { getAppearanceTokenGroupCopy, getAppearanceTokenRowCopy } from "../../../../shared/appearance-token-copy"
import type { AppearanceTheme } from "../../../../shared/appearance-themes"
import type {
  DesktopAppUpdateState,
  DesktopProviderAuthPrompt,
  DesktopStoragePaths,
  DesktopStorageUsageSnapshot,
} from "../../../../shared/desktop-ipc-contract"
import {
  AccountSettingsIcon,
  ArchiveRestoreIcon,
  CloseIcon,
  CodeModeIcon,
  ConnectedStatusIcon,
  StorageSettingsIcon,
  DisconnectedStatusIcon,
  ChevronDownIcon,
  DeleteIcon,
  EditIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  LayoutSidebarLeftIcon,
  MinimizeIcon,
  GeneralSettingsIcon,
  ModelSettingsIcon,
  PaletteIcon,
  PlusIcon,
  ProviderSettingsIcon,
  ResetIcon,
  SearchIcon,
  SubscriptionSettingsIcon,
} from "../icons"
import {
  type AppearanceColorChannels,
  getAppearanceColorChannels,
  normalizeAppearanceColorInputValue,
  withAppearanceColorChannels,
} from "../appearance-theme"
import { useI18n } from "../i18n/I18nProvider"
import type { TranslationKey } from "../i18n/translations"
import { writeTextToClipboard } from "../shared-ui"
import type {
  ArchivedSessionSummary,
  AssistantTraceVisibility,
  AssistantTraceVisibilityKey,
  ColorMode,
  CinemaVideoProvider,
  CinemaVideoProviderDraftState,
  CustomProviderDraftState,
  InstalledPlugin,
  McpServerDiagnostic,
  McpServerDraftState,
  McpServerSummary,
  McpToolPolicyValue,
  ModelCatalogItem,
  PluginCatalogItem,
  ProjectModelSelection,
  ProviderAuthCapability,
  ProviderCatalogItem,
  ProviderDraftState,
  ProviderModel,
} from "../types"
import { McpToolsPolicyPanel } from "../mcp/McpToolsPolicyPanel"
import { SubscriptionSettingsPanel } from "./SubscriptionSettingsPanel"
import {
  buildMcpServerPluginSourceMap,
  getMcpServerPluginSource,
  getMcpServerPluginSourceAriaLabel,
  getMcpServerPluginSourceSearchText,
  getMcpServerPluginSourceTitle,
  type McpServerPluginSource,
} from "../mcp/mcp-server-source"
import { clamp, formatTime } from "../utils"
import {
  getStoragePaths,
  openAppearanceWindow,
  openExternalUrl,
  openMonitorWindow,
} from "./client"
import { formatStorageBytes, sortArchivedSessionUsage, sortStorageTables } from "./storage-usage"
import {
  shouldOpenUpdateCenterOnly,
  type AppUpdateStatus,
} from "../update/UpdateDialog"
import { APP_LOCALES, APP_LOCALE_METADATA, type AppLocale } from "../../../../shared/locale"
import {
  DEFAULT_HTML_BACKGROUND_CONFIG,
  type HtmlBackgroundConfig,
} from "../html-background/html-background-config"
import { SettingsSelect } from "./SettingsSelect"

const assistantTraceVisibilityOptions: Array<{
  key: AssistantTraceVisibilityKey
  title: string
  description: string
}> = [
  {
    key: "response",
    title: "Response",
    description: "Show the assistant's user-facing response text inside the main trace.",
  },
  {
    key: "reasoning",
    title: "Reasoning",
    description: "Show captured reasoning text segments when the model streams them.",
  },
  {
    key: "toolCalls",
    title: "Tool calls",
    description: "Show tool lifecycle entries such as running, waiting for approval, and completed calls.",
  },
  {
    key: "toolInputs",
    title: "Tool inputs",
    description: "Reveal streamed tool arguments and structured input payloads inside tool entries.",
  },
  {
    key: "toolOutputs",
    title: "Tool outputs",
    description: "Reveal completed tool results, failure messages, and denied reasons inside tool entries.",
  },
  {
    key: "sources",
    title: "Sources",
    description: "Show cited URLs and document references that the model used during this response.",
  },
  {
    key: "files",
    title: "Files and attachments",
    description: "Show generated files, images, and patch summaries in the main trace.",
  },
  {
    key: "approvals",
    title: "Approvals",
    description: "Show permission requests, approval pauses, and related tool approval events.",
  },
  {
    key: "workflow",
    title: "Workflow events",
    description: "Show step boundaries, completion summaries, stream lifecycle, and other execution events.",
  },
  {
    key: "debugMetadata",
    title: "Debug metadata",
    description: "Show backend identifiers, payload previews, timing, and token metadata for each trace item.",
  },
]

const fontFamilyOptions: Array<{
  value: AppearanceFontFamily
  label: string
  description: string
  previewClassName: string
}> = [
  {
    value: "default",
    label: "IBM Plex Sans",
    description: "Default app stack with balanced Latin and CJK fallbacks.",
    previewClassName: "is-default",
  },
  {
    value: "system",
    label: "System UI",
    description: "Use the operating system interface font stack.",
    previewClassName: "is-system",
  },
  {
    value: "segoe",
    label: "Segoe UI",
    description: "Windows-native UI rhythm with Chinese fallbacks.",
    previewClassName: "is-segoe",
  },
  {
    value: "microsoft-yahei",
    label: "微软雅黑",
    description: "Microsoft YaHei UI / Microsoft YaHei for Simplified Chinese rendering on Windows.",
    previewClassName: "is-microsoft-yahei",
  },
  {
    value: "pingfang",
    label: "PingFang SC",
    description: "macOS-style Chinese font with cross-platform fallbacks.",
    previewClassName: "is-pingfang",
  },
]

function formatContextWindow(value: number) {
  if (value >= 1000) {
    const formatted = value >= 100000 ? Math.round(value / 1000) : Number((value / 1000).toFixed(1))
    return `${String(formatted).replace(/\.0$/, "")}k`
  }

  return String(value)
}

type SettingsTranslate = (key: TranslationKey, params?: Record<string, string | number>) => string

function providerSourceLabel(provider: ProviderCatalogItem) {
  if (provider.source === "config") return "Saved config"
  if (provider.source === "env") return "Environment"
  if (provider.source === "custom") return "Custom"
  return "Catalog"
}

function getProviderSourceLabel(provider: ProviderCatalogItem, t: SettingsTranslate) {
  if (provider.source === "config") return t("settings.provider.sourceSavedConfig")
  if (provider.source === "env") return t("settings.provider.sourceEnvironment")
  if (provider.source === "custom") return t("settings.provider.sourceCustom")
  return t("settings.provider.sourceCatalog")
}

function getAppearanceTokenLayerLabel(layer: AppearanceTokenLayer, t: SettingsTranslate) {
  if (layer === "foundation") return t("settings.appearance.tokenLayerFoundation")
  if (layer === "component") return t("settings.appearance.tokenLayerComponent")
  if (layer === "product") return t("settings.appearance.tokenLayerProduct")
  if (layer === "status") return t("settings.appearance.tokenLayerStatus")
  return t("settings.appearance.tokenLayerGlobal")
}

const providerLogoBaseURL = "https://models.dev/logos"

function getProviderLogoUrl(providerID: string) {
  return `${providerLogoBaseURL}/${encodeURIComponent(providerID)}.svg`
}

function getProviderLogoInitial(provider: ProviderCatalogItem) {
  return (provider.name.trim() || provider.id.trim()).slice(0, 1).toUpperCase() || "?"
}

function ProviderLogo({ provider, className = "" }: { provider: ProviderCatalogItem; className?: string }) {
  const [loadedImageProviderID, setLoadedImageProviderID] = useState<string | null>(null)
  const isImageLoaded = loadedImageProviderID === provider.id

  useEffect(() => {
    setLoadedImageProviderID(null)
  }, [provider.id])

  return (
    <span className={className ? `provider-logo ${className}` : "provider-logo"} aria-hidden="true">
      <span className="provider-logo-fallback" hidden={isImageLoaded}>
        {getProviderLogoInitial(provider)}
      </span>
      <img
        key={provider.id}
        className="provider-logo-image"
        src={getProviderLogoUrl(provider.id)}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => {
          setLoadedImageProviderID(provider.id)
        }}
        onError={(event) => {
          setLoadedImageProviderID(null)
          event.currentTarget.hidden = true
        }}
      />
    </span>
  )
}

function AppearanceColorTextInput({
  ariaLabel,
  onCommit,
  value,
}: {
  ariaLabel: string
  onCommit: (value: string) => void
  value: string
}) {
  const [draftValue, setDraftValue] = useState(value)

  useEffect(() => {
    setDraftValue(value)
  }, [value])

  function commitDraftValue() {
    const normalizedValue = normalizeAppearanceColorInputValue(draftValue, value)
    setDraftValue(normalizedValue)
    onCommit(normalizedValue)
  }

  return (
    <input
      aria-label={ariaLabel}
      className="settings-theme-color-input"
      inputMode="text"
      spellCheck={false}
      type="text"
      value={draftValue}
      onBlur={commitDraftValue}
      onChange={(event) => setDraftValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          event.currentTarget.blur()
          return
        }

        if (event.key === "Escape") {
          event.preventDefault()
          setDraftValue(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

type AppearanceColorPickerChannelLabels = {
  hue: string
  saturation: string
  brightness: string
  alpha: string
}

type AppearanceHsvColor = {
  hue: number
  saturation: number
  brightness: number
}

function clampAppearanceColorEditorValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function clampAppearanceColorUnitValue(value: number) {
  return clampAppearanceColorEditorValue(value, 0, 1)
}

function normalizeAppearanceColorHue(value: number) {
  if (!Number.isFinite(value)) return 0
  return clampAppearanceColorEditorValue(Math.round(value), 0, 360)
}

function getAppearanceColorHsv(channels: AppearanceColorChannels): AppearanceHsvColor {
  const red = channels.red / 255
  const green = channels.green / 255
  const blue = channels.blue / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let hue = 0

  if (delta > 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6)
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2)
    } else {
      hue = 60 * ((red - green) / delta + 4)
    }
  }

  if (hue < 0) hue += 360

  return {
    hue: normalizeAppearanceColorHue(hue),
    saturation: max === 0 ? 0 : delta / max,
    brightness: max,
  }
}

function getAppearanceColorRgbFromHsv({ hue, saturation, brightness }: AppearanceHsvColor) {
  const normalizedHue = normalizeAppearanceColorHue(hue) % 360
  const normalizedSaturation = clampAppearanceColorUnitValue(saturation)
  const normalizedBrightness = clampAppearanceColorUnitValue(brightness)
  const chroma = normalizedBrightness * normalizedSaturation
  const hueSegment = normalizedHue / 60
  const secondary = chroma * (1 - Math.abs((hueSegment % 2) - 1))
  const match = normalizedBrightness - chroma
  let red = 0
  let green = 0
  let blue = 0

  if (hueSegment >= 0 && hueSegment < 1) {
    red = chroma
    green = secondary
  } else if (hueSegment < 2) {
    red = secondary
    green = chroma
  } else if (hueSegment < 3) {
    green = chroma
    blue = secondary
  } else if (hueSegment < 4) {
    green = secondary
    blue = chroma
  } else if (hueSegment < 5) {
    red = secondary
    blue = chroma
  } else {
    red = chroma
    blue = secondary
  }

  return {
    red: Math.round((red + match) * 255),
    green: Math.round((green + match) * 255),
    blue: Math.round((blue + match) * 255),
  }
}

function AppearanceColorPicker({
  ariaLabel,
  channelLabels,
  onChange,
  value,
}: {
  ariaLabel: string
  channelLabels: AppearanceColorPickerChannelLabels
  onChange: (value: string) => void
  value: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const channels = getAppearanceColorChannels(value)
  const hsvColor = getAppearanceColorHsv(channels)
  const [editorHue, setEditorHue] = useState(() => hsvColor.hue)
  const hue = hsvColor.saturation > 0 && hsvColor.brightness > 0 ? hsvColor.hue : editorHue
  const saturation = hsvColor.saturation
  const brightness = hsvColor.brightness
  const alphaPercent = Math.round(channels.alpha * 100)
  const swatchColor = `rgba(${channels.red}, ${channels.green}, ${channels.blue}, ${channels.alpha})`
  const colorFieldStyle = {
    "--settings-theme-color-field-hue": `hsl(${hue} 100% 50%)`,
  } as CSSProperties
  const colorFieldThumbStyle = {
    left: `${saturation * 100}%`,
    top: `${(1 - brightness) * 100}%`,
    backgroundColor: swatchColor,
  }
  const alphaSliderStyle = {
    "--settings-theme-alpha-color": `rgb(${channels.red} ${channels.green} ${channels.blue})`,
  } as CSSProperties

  useEffect(() => {
    if (!isOpen) return

    function handleDocumentPointerDown(event: globalThis.PointerEvent) {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return

      setIsOpen(false)
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false)
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown)
    window.addEventListener("keydown", handleWindowKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown)
      window.removeEventListener("keydown", handleWindowKeyDown)
    }
  }, [isOpen])

  useEffect(() => {
    if (hsvColor.saturation > 0 && hsvColor.brightness > 0) setEditorHue(hsvColor.hue)
  }, [hsvColor.brightness, hsvColor.hue, hsvColor.saturation])

  function updateHsv(nextColor: Partial<AppearanceHsvColor>) {
    const nextHue = normalizeAppearanceColorHue(nextColor.hue ?? hue)
    const nextSaturation = clampAppearanceColorUnitValue(nextColor.saturation ?? saturation)
    const nextBrightness = clampAppearanceColorUnitValue(nextColor.brightness ?? brightness)
    setEditorHue(nextHue)
    onChange(withAppearanceColorChannels(value, getAppearanceColorRgbFromHsv({
      hue: nextHue,
      saturation: nextSaturation,
      brightness: nextBrightness,
    })))
  }

  function updateHue(nextValue: number) {
    if (!Number.isFinite(nextValue)) return

    updateHsv({ hue: nextValue })
  }

  function updateAlpha(nextValue: number) {
    if (!Number.isFinite(nextValue)) return

    onChange(withAppearanceColorChannels(value, {
      alpha: clampAppearanceColorEditorValue(nextValue, 0, 1),
    }))
  }

  function updateColorFieldFromPointer(event: PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    updateHsv({
      saturation: (event.clientX - rect.left) / rect.width,
      brightness: 1 - (event.clientY - rect.top) / rect.height,
    })
  }

  function handleColorFieldPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    updateColorFieldFromPointer(event)
  }

  function handleColorFieldPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return

    updateColorFieldFromPointer(event)
  }

  function handleColorFieldPointerUp(event: PointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return

    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function handleColorFieldKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 0.1 : 0.01
    let nextSaturation = saturation
    let nextBrightness = brightness

    if (event.key === "ArrowLeft") {
      nextSaturation -= step
    } else if (event.key === "ArrowRight") {
      nextSaturation += step
    } else if (event.key === "ArrowDown") {
      nextBrightness -= step
    } else if (event.key === "ArrowUp") {
      nextBrightness += step
    } else if (event.key === "Home") {
      nextSaturation = 0
    } else if (event.key === "End") {
      nextSaturation = 1
    } else {
      return
    }

    event.preventDefault()
    updateHsv({
      saturation: nextSaturation,
      brightness: nextBrightness,
    })
  }

  return (
    <div className="settings-theme-color-picker" ref={rootRef}>
      <button
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="settings-theme-color-trigger"
        type="button"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        <span className="settings-theme-color-swatch" aria-hidden="true">
          <span style={{ backgroundColor: swatchColor }} />
        </span>
      </button>

      {isOpen ? (
        <div className="settings-theme-color-popover" role="dialog" aria-label={ariaLabel}>
          <button
            aria-label={`${ariaLabel} ${channelLabels.saturation} ${Math.round(saturation * 100)} ${channelLabels.brightness} ${Math.round(brightness * 100)}`}
            className="settings-theme-color-field"
            type="button"
            style={colorFieldStyle}
            onKeyDown={handleColorFieldKeyDown}
            onPointerDown={handleColorFieldPointerDown}
            onPointerMove={handleColorFieldPointerMove}
            onPointerUp={handleColorFieldPointerUp}
            onPointerCancel={handleColorFieldPointerUp}
          >
            <span
              className="settings-theme-color-field-thumb"
              aria-hidden="true"
              style={colorFieldThumbStyle}
            />
          </button>

          <div className="settings-theme-color-slider-list">
            <div className="settings-theme-color-slider is-hue">
              <span>H</span>
              <input
                aria-label={`${ariaLabel} ${channelLabels.hue}`}
                type="range"
                min="0"
                max="360"
                step="1"
                value={hue}
                onChange={(event) => updateHue(event.currentTarget.valueAsNumber)}
              />
              <input
                aria-label={`${ariaLabel} ${channelLabels.hue} value`}
                className="settings-theme-color-number"
                type="number"
                min="0"
                max="360"
                step="1"
                value={Math.round(hue)}
                onChange={(event) => updateHue(event.currentTarget.valueAsNumber)}
              />
            </div>

            <div className="settings-theme-color-slider is-alpha" style={alphaSliderStyle}>
              <span>A</span>
              <input
                aria-label={`${ariaLabel} ${channelLabels.alpha}`}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={channels.alpha}
                onChange={(event) => updateAlpha(event.currentTarget.valueAsNumber)}
              />
              <input
                aria-label={`${ariaLabel} ${channelLabels.alpha} value`}
                className="settings-theme-color-number"
                type="number"
                min="0"
                max="100"
                step="1"
                value={alphaPercent}
                onChange={(event) => updateAlpha(event.currentTarget.valueAsNumber / 100)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function buildModelTags(model: ProviderModel, t?: SettingsTranslate) {
  const tags = [`${formatContextWindow(model.limit.context)} ctx`]

  if (model.capabilities.reasoning) tags.push(t ? t("settings.models.tagReasoning") : "Reasoning")
  if (model.capabilities.toolcall) tags.push(t ? t("settings.models.tagTools") : "Tools")
  if (model.capabilities.input.image) tags.push(t ? t("settings.models.tagVision") : "Vision")
  if (model.capabilities.output.image) tags.push(t ? t("settings.models.tagImageOut") : "Image Out")
  if (model.capabilities.attachment && model.capabilities.input.pdf) tags.push("PDF")

  return tags
}

function toModelValue(model: ProviderModel) {
  return `${model.providerID}/${model.id}`
}

function toModelOptionLabel(model: ProviderModel, providers: ProviderCatalogItem[]) {
  const providerName = providers.find((item) => item.id === model.providerID)?.name ?? model.providerID
  return `${providerName} / ${model.name}`
}

function getProviderConnectionLabel(provider: ProviderCatalogItem, t?: SettingsTranslate) {
  const label = provider.connectionLabel ?? provider.authState.connectionLabel

  switch (provider.authState.status) {
    case "connected":
      return label ?? (t ? t("app.connected") : "Connected")
    case "pending":
      return label ?? (t ? t("settings.provider.statusPending") : "Pending")
    case "expired":
      return label ?? (t ? t("settings.provider.statusExpired") : "Expired")
    case "error":
      return label ?? (t ? t("settings.provider.statusError") : "Error")
    case "not_connected":
      if (provider.apiKeyConfigured) return t ? t("app.configured") : "Configured"
      return label ?? (t ? t("app.notConnected") : "Not connected")
  }
}

function isProviderConnected(provider: ProviderCatalogItem) {
  return provider.authState.status === "connected"
}

function isAnyboxProvider(provider: ProviderCatalogItem) {
  return provider.id === ANYBOX_ACCOUNT_PROVIDER_ID
}

function getProviderAuthCapability(provider: ProviderCatalogItem, method: string | null | undefined) {
  if (!method) return null
  return provider.authCapabilities.find((capability) => capability.method === method) ?? null
}

function isProviderFlowTerminal(status?: string | null) {
  return !status || ["connected", "error", "expired", "cancelled"].includes(status)
}

function getProviderKeyPlaceholder(provider: ProviderCatalogItem, t?: SettingsTranslate) {
  const apiKeyCredential = provider.authState.credentials.find((credential) => credential.kind === "api_key")
  if (apiKeyCredential?.configured || provider.apiKeyConfigured) {
    return t ? t("settings.provider.storedKeyPlaceholder") : "Stored key detected. Leave blank to keep it."
  }

  if (provider.env.length > 0) {
    const env = provider.env.join(", ")
    return t ? t("settings.provider.environmentKeyPlaceholder", { env }) : `Or rely on ${env}`
  }

  return t ? t("settings.provider.enterApiKey") : "Enter API key"
}

type ProviderApiKeyMode = "environment" | "manual"

const ANYBOX_ACCOUNT_PROVIDER_ID = "anybox"

function getProviderActiveCredential(provider: ProviderCatalogItem) {
  return (
    provider.authState.credentials.find((credential) => credential.method === provider.authState.activeMethod) ??
    provider.authState.credentials.find((credential) => credential.configured) ??
    null
  )
}

function hasStoredProviderApiKey(provider: ProviderCatalogItem) {
  return provider.authState.credentials.some(
    (credential) =>
      credential.kind === "api_key" &&
      credential.configured &&
      credential.source !== "environment",
  )
}

function getProviderApiKeyMode(provider: ProviderCatalogItem): ProviderApiKeyMode {
  const activeCredential = getProviderActiveCredential(provider)
  if (activeCredential?.kind === "api_key" && activeCredential.source === "environment") {
    return "environment"
  }
  if (provider.source === "env" && provider.env.length > 0 && !hasStoredProviderApiKey(provider)) {
    return "environment"
  }
  return "manual"
}

function getProviderStatusText(provider: ProviderCatalogItem, t: SettingsTranslate) {
  switch (provider.authState.status) {
    case "connected":
      return t("app.connected")
    case "pending":
      return t("settings.provider.statusPending")
    case "expired":
      return t("settings.provider.statusExpired")
    case "error":
      return t("settings.provider.statusError")
    case "not_connected":
      return provider.apiKeyConfigured ? t("app.configured") : t("app.notConnected")
  }
}

function getProviderSourceText(provider: ProviderCatalogItem, t: SettingsTranslate) {
  const activeCredential = getProviderActiveCredential(provider)
  if (isAnyboxProvider(provider) && activeCredential?.kind === "oauth_session") return t("settings.provider.sourceAnyboxAccount")
  if (activeCredential?.source === "environment" || provider.source === "env") return t("settings.provider.sourceFromEnvironment")
  if (activeCredential?.source === "credential_store") return t("settings.provider.sourceSavedKey")
  if (activeCredential?.source === "external_cache") return t("settings.provider.sourceSharedLogin")
  if (activeCredential?.source === "legacy_config") return t("settings.provider.sourceLegacyConfig")
  return provider.configured ? t("settings.provider.sourceFromSavedConfig") : t("settings.provider.sourceNoCredential")
}

function getProviderHeaderSummary(provider: ProviderCatalogItem, t: SettingsTranslate) {
  return `${getProviderStatusText(provider, t)} · ${t("settings.provider.sharedAcrossApp")} · ${getProviderSourceText(provider, t)}`
}

function getCinemaVideoProviderStatusText(provider: CinemaVideoProvider, t: SettingsTranslate) {
  if (!provider.auth.requiresCredential) return t("app.connected")
  switch (provider.auth.status) {
    case "connected":
      return t("app.connected")
    case "pending":
      return t("settings.provider.statusPending")
    case "expired":
      return t("settings.provider.statusExpired")
    case "error":
      return t("settings.provider.statusError")
    case "not_connected":
      return t("app.notConnected")
  }
}

function getCinemaVideoProviderModelSummary(provider: CinemaVideoProvider) {
  const models = provider.manifest.models
  return `${models.length} ${models.length === 1 ? "model" : "models"}`
}

function getCinemaVideoProviderKindLabel(kind?: string) {
  if (!kind) return "Catalog"
  return kind
    .split(/[-_]/)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
}

function getCinemaVideoProviderSourceText(provider: CinemaVideoProvider, t: SettingsTranslate) {
  if (provider.auth.credentialSource === "credential_store") return t("settings.provider.sourceSavedKey")
  if (provider.auth.credentialSource === "environment") return t("settings.provider.sourceFromEnvironment")
  return provider.auth.connected ? t("settings.provider.sourceFromSavedConfig") : t("settings.provider.sourceNoCredential")
}

function getCinemaVideoProviderEndpointSourceText(provider: CinemaVideoProvider, t: SettingsTranslate) {
  switch (provider.runtime?.baseURLSource) {
    case "settings":
      return t("settings.videoProviders.endpointSourceSettings")
    case "environment":
      return t("settings.videoProviders.endpointSourceEnvironment")
    case "default":
      return t("settings.videoProviders.endpointSourceDefault")
    default:
      return ""
  }
}

function getCinemaVideoProviderHeaderSummary(provider: CinemaVideoProvider, t: SettingsTranslate) {
  return [
    getCinemaVideoProviderStatusText(provider, t),
    getCinemaVideoProviderModelSummary(provider),
    getCinemaVideoProviderKindLabel(provider.manifest.kind),
    getCinemaVideoProviderSourceText(provider, t),
  ].join(" · ")
}

function doesCinemaVideoProviderMatchSearch(provider: CinemaVideoProvider, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  const modelText = provider.manifest.models
    .flatMap((model) => [
      model.id,
      model.label,
      model.catalogID ?? "",
      model.family ?? "",
      model.lab ?? "",
      model.baseModel ?? "",
      model.modes.join(" "),
    ])
    .join(" ")
  const haystack = [
    provider.manifest.id,
    provider.manifest.name,
    provider.manifest.kind ?? "",
    provider.manifest.authType ?? "",
    provider.manifest.website ?? "",
    provider.manifest.doc ?? "",
    provider.manifest.regions?.join(" ") ?? "",
    modelText,
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(query)
}

function getVisibleCinemaVideoProvidersForSettings(providers: CinemaVideoProvider[], query: string) {
  return providers.filter((provider) => doesCinemaVideoProviderMatchSearch(provider, query))
}

function emptyProviderCapabilities(): ProviderCapabilitySummary {
  return {
    text: false,
    image: false,
    video: false,
  }
}

function getModelCatalogProviderCapabilities(models: ModelCatalogItem[]): ProviderCapabilitySummary {
  return models.reduce<ProviderCapabilitySummary>((result, model) => ({
    text: result.text || Boolean(model.capabilities.output.text),
    image: result.image || Boolean(model.capabilities.output.image),
    video: result.video || Boolean(model.capabilities.output.video),
  }), emptyProviderCapabilities())
}

function getCinemaProviderCapabilities(provider: CinemaVideoProvider): ProviderCapabilitySummary {
  return provider.manifest.models.reduce<ProviderCapabilitySummary>((result, model) => {
    const output = model.modalities?.output ?? []
    const modeText = model.modes.join(" ")

    return {
      text: result.text || output.includes("text") || (/\btext\b/.test(modeText) && !/\bvideo\b|\bimage\b/.test(modeText)),
      image: result.image || output.includes("image") || (/\bimage\b/.test(modeText) && !/\bvideo\b/.test(modeText)),
      video: result.video || output.includes("video") || /\bvideo\b/.test(modeText),
    }
  }, emptyProviderCapabilities())
}

function doesProviderCapabilityMatchFilter(item: ProviderSettingsListItem, filter: ProviderCapabilityFilterKey) {
  switch (filter) {
    case "all":
      return true
    case "connected":
      return item.connected
    case "text":
      return item.capabilities.text
    case "image":
      return item.capabilities.image
    case "video":
      return item.capabilities.video
  }
}

function getProviderCapabilityTags(capabilities: ProviderCapabilitySummary, t: SettingsTranslate) {
  return [
    capabilities.text ? t("settings.provider.filterText") : null,
    capabilities.image ? t("settings.provider.filterImage") : null,
    capabilities.video ? t("settings.provider.filterVideo") : null,
  ].filter((tag): tag is string => typeof tag === "string")
}

function formatCinemaVideoModelLimit(model: CinemaVideoProvider["manifest"]["models"][number]) {
  const values = [
    model.maxDurationSeconds ? `${model.maxDurationSeconds}s max` : null,
    model.durations?.length ? `${model.durations.join("/")}s` : null,
    model.resolutions?.length ? model.resolutions.join("/") : null,
    model.aspectRatios?.length ? model.aspectRatios.join(", ") : null,
  ].filter(Boolean)
  return values.join(" · ")
}

function formatCinemaVideoPricing(model: CinemaVideoProvider["manifest"]["models"][number]) {
  const first = model.pricing?.[0]
  if (!first) return null
  const amount = typeof first.amount === "number" ? first.amount : null
  const currency = typeof first.currency === "string" ? first.currency : null
  const unit = typeof first.unit === "string" ? first.unit : null
  const note = typeof first.note === "string" ? first.note : null
  if (amount !== null && currency && unit) return `${currency} ${amount} / ${unit}`
  return note ?? unit
}

function CinemaVideoModelListView({ provider, t }: { provider: CinemaVideoProvider; t: SettingsTranslate }) {
  if (provider.manifest.models.length === 0) {
    return (
      <article className="settings-empty-state">
        <span className="label">{t("settings.videoProviders.noModelsLabel")}</span>
        <h3>{t("settings.videoProviders.noModelsTitle")}</h3>
        <p>{t("settings.videoProviders.noModelsCopy")}</p>
      </article>
    )
  }

  return (
    <div className="model-list cinema-video-model-list">
      {provider.manifest.models.map((model) => {
        const modalities = [
          model.modalities?.input.length ? `${t("settings.videoProviders.inputPrefix")}: ${model.modalities.input.join("/")}` : null,
          model.modalities?.output.length ? `${t("settings.videoProviders.outputPrefix")}: ${model.modalities.output.join("/")}` : null,
        ].filter(Boolean)
        const limit = formatCinemaVideoModelLimit(model)
        const pricing = formatCinemaVideoPricing(model)

        return (
          <article key={model.id} className="model-row cinema-video-model-row">
            <div className="model-row-main">
              <div className="model-row-heading">
                <div>
                  <h4>{model.label}</h4>
                  <p className="model-row-copy">
                    <strong>{provider.manifest.name}</strong>
                    {model.baseModel ? ` / ${model.baseModel}` : model.family ? ` / ${model.family}` : ""}
                  </p>
                </div>

                <div className="model-row-statuses">
                  {model.endpointType ? <span className="settings-badge">{model.endpointType}</span> : null}
                  {model.supportsAudio ? <span className="settings-badge">{t("settings.videoProviders.audioBadge")}</span> : null}
                  {model.sourceCheckedAt ? <span className="settings-badge">{model.sourceCheckedAt}</span> : null}
                </div>
              </div>

              <div className="model-row-tags">
                {model.modes.map((mode) => (
                  <span key={`${model.id}-${mode}`} className="settings-badge">
                    {mode}
                  </span>
                ))}
                {modalities.map((item) => (
                  <span key={`${model.id}-${item}`} className="settings-badge">
                    {item}
                  </span>
                ))}
                {limit ? <span className="settings-badge">{limit}</span> : null}
                {pricing ? <span className="settings-badge">{pricing}</span> : null}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function getProviderAuthMethodOptionLabel(provider: ProviderCatalogItem, capability: ProviderAuthCapability, t: SettingsTranslate) {
  if (isAnyboxProvider(provider) && capability.kind === "browser_oauth") return t("settings.provider.anyboxBrowserLogin")
  if (provider.id === "openai" && capability.kind === "browser_oauth") return t("settings.provider.openaiBrowserLogin")
  if (provider.id === "openai" && capability.kind === "device_code") return t("settings.provider.openaiDeviceLogin")
  return capability.recommended ? `${capability.label} (${t("settings.provider.recommended")})` : capability.label
}

function formatProviderBalance(account: ProviderCatalogItem["authState"]["account"]) {
  if (account?.balanceMicrocents === undefined) return null
  const currency = account.currency || "CNY"
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(account.balanceMicrocents / 100_000_000)
}

function formatProviderPlanLabel(account: ProviderCatalogItem["authState"]["account"]) {
  return account?.planLabel ?? formatPlanCode(account?.planType ?? account?.subscription?.planCode) ?? null
}

function formatPlanCode(value: string | undefined) {
  const normalized = value?.trim()
  if (!normalized) return null
  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1).toLocaleLowerCase()}`)
    .join(" ")
}

const ANYBOX_ACCOUNT_DASHBOARD_URL = "https://provider.anybox.com.cn/app/dashboard"
const ANYBOX_PRODUCT_HOME_URL = "https://anybox.com.cn"
const ANYBOX_COMMUNITY_QR_IMAGE_SRC = "/anybox-community-qr.png"

function getAnyboxRechargeUrl(provider: ProviderCatalogItem) {
  const account = provider.authState.account
  const credential = getProviderActiveCredential(provider)
  const direct = account?.rechargeUrl ?? credential?.rechargeUrl
  if (direct) return direct

  return ANYBOX_ACCOUNT_DASHBOARD_URL
}

type AnyboxAccountStatus = "unavailable" | "not_connected" | "pending" | "connected" | "expired" | "error"

interface AnyboxAccountViewModel {
  account: ProviderCatalogItem["authState"]["account"] | null
  flow: ProviderCatalogItem["authState"]["flow"] | null
  provider: ProviderCatalogItem | null
  status: AnyboxAccountStatus
  title: string
}

function getAnyboxAccountViewModel(
  provider: ProviderCatalogItem | null,
  draft: ProviderDraftState | null,
  t: SettingsTranslate,
): AnyboxAccountViewModel {
  if (!provider) {
    return {
      account: null,
      flow: null,
      provider: null,
      status: "unavailable",
      title: t("settings.account.unavailableTitle"),
    }
  }

  const flow = draft?.activeFlow ?? provider.authState.flow ?? null
  const account = provider.authState.account ?? flow?.account ?? null
  if (flow && !isProviderFlowTerminal(flow.status)) {
    return {
      account,
      flow,
      provider,
      status: "pending",
      title: t("settings.account.pendingTitle"),
    }
  }

  if (provider.authState.status === "connected") {
    return {
      account,
      flow,
      provider,
      status: "connected",
      title: t("settings.account.connectedTitle"),
    }
  }

  if (provider.authState.status === "expired") {
    return {
      account,
      flow,
      provider,
      status: "expired",
      title: t("settings.account.expiredTitle"),
    }
  }

  if (provider.authState.status === "error") {
    return {
      account,
      flow,
      provider,
      status: "error",
      title: t("settings.account.errorTitle"),
    }
  }

  return {
    account,
    flow,
    provider,
    status: "not_connected",
    title: t("settings.account.notConnectedTitle"),
  }
}

function matchesProviderSearch(provider: ProviderCatalogItem, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  const haystack = [
    provider.id,
    provider.name,
    provider.baseURL ?? "",
    provider.env.join(" "),
    providerSourceLabel(provider),
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(query)
}

function getVisibleProvidersForSettings(catalog: ProviderCatalogItem[], rawQuery: string) {
  return catalog
    .map((provider, index) => ({ index, provider }))
    .filter(({ provider }) => matchesProviderSearch(provider, rawQuery))
    .sort((left, right) => {
      if (left.provider.available !== right.provider.available) {
        return left.provider.available ? -1 : 1
      }

      return left.index - right.index
    })
    .map(({ provider }) => provider)
}

function countAppearanceTokenRows(groups: readonly AppearanceTokenGroup[]) {
  return groups.reduce((count, group) => count + group.rows.length, 0)
}

type AppearanceTokenGroupFilter = "all" | (typeof APPEARANCE_TOKEN_GROUPS)[number]["id"]
type AppearanceTokenLayerFilter = "all" | AppearanceTokenLayer
type AppearanceTokenCustomizationFilter = "all" | "customized"

function isAppearanceTokenRowCustomized(
  row: AppearanceTokenGroup["rows"][number],
  appearanceOverrides: AppearanceTokenMap,
) {
  return Boolean(appearanceOverrides[row.lightToken] || appearanceOverrides[row.darkToken])
}

function matchesAppearanceTokenRowSearch(
  group: AppearanceTokenGroup,
  row: AppearanceTokenGroup["rows"][number],
  appearanceTokenValues: Record<AppearanceTokenName, string>,
  normalizedQuery: string,
  locale: AppLocale,
) {
  const groupCopy = getAppearanceTokenGroupCopy(locale, group)
  const rowCopy = getAppearanceTokenRowCopy(locale, row)
  const haystack = [
    group.id,
    group.layer,
    group.label,
    group.description,
    groupCopy.label,
    groupCopy.description,
    row.id,
    row.label,
    row.description,
    rowCopy.label,
    rowCopy.description,
    row.lightToken,
    row.darkToken,
    appearanceTokenValues[row.lightToken] ?? "",
    appearanceTokenValues[row.darkToken] ?? "",
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(normalizedQuery)
}

function filterAppearanceTokenGroups(
  groups: readonly AppearanceTokenGroup[],
  rawQuery: string,
  appearanceTokenValues: Record<AppearanceTokenName, string>,
  locale: AppLocale,
  layerFilter: AppearanceTokenLayerFilter,
  groupFilter: AppearanceTokenGroupFilter,
  customizationFilter: AppearanceTokenCustomizationFilter,
  appearanceOverrides: AppearanceTokenMap,
): AppearanceTokenGroup[] {
  const normalizedQuery = rawQuery.trim().toLowerCase()

  return groups.flatMap((group) => {
    if (layerFilter !== "all" && group.layer !== layerFilter) return []
    if (groupFilter !== "all" && group.id !== groupFilter) return []

    const groupCopy = getAppearanceTokenGroupCopy(locale, group)
    const groupHaystack = [
      group.id,
      group.layer,
      group.label,
      group.description,
      groupCopy.label,
      groupCopy.description,
    ]
      .join(" ")
      .toLowerCase()
    const rows = group.rows.filter((row) => {
      if (customizationFilter === "customized" && !isAppearanceTokenRowCustomized(row, appearanceOverrides)) {
        return false
      }

      if (!normalizedQuery || groupHaystack.includes(normalizedQuery)) return true

      return matchesAppearanceTokenRowSearch(group, row, appearanceTokenValues, normalizedQuery, locale)
    })

    if (rows.length === 0) return []

    return [{ ...group, rows }]
  })
}

interface AppearanceTokenEditorProps {
  appearanceOverrides: AppearanceTokenMap
  appearanceTokenValues: Record<AppearanceTokenName, string>
  onAppearanceTokenChange: (tokenName: AppearanceTokenName, value: string) => void
  onAppearanceTokenReset: (tokenName: AppearanceTokenName) => void
}

export function AppearanceTokenEditor({
  appearanceOverrides,
  appearanceTokenValues,
  onAppearanceTokenChange,
  onAppearanceTokenReset,
}: AppearanceTokenEditorProps) {
  const { locale, t } = useI18n()
  const [themeTokenSearchQuery, setThemeTokenSearchQuery] = useState("")
  const [themeTokenLayerFilter, setThemeTokenLayerFilter] = useState<AppearanceTokenLayerFilter>("all")
  const [themeTokenGroupFilter, setThemeTokenGroupFilter] = useState<AppearanceTokenGroupFilter>("all")
  const [themeTokenCustomizationFilter, setThemeTokenCustomizationFilter] =
    useState<AppearanceTokenCustomizationFilter>("all")
  const availableAppearanceTokenGroups = useMemo(
    () =>
      APPEARANCE_TOKEN_GROUPS.filter((group) =>
        themeTokenLayerFilter === "all" || group.layer === themeTokenLayerFilter,
      ),
    [themeTokenLayerFilter],
  )
  const appearanceTokenLayerFilterOptions = useMemo<Array<{ value: AppearanceTokenLayerFilter; label: string }>>(
    () => [
      { value: "all", label: t("settings.appearance.allTokenLayers") },
      ...APPEARANCE_TOKEN_LAYERS.map((layer) => ({
        value: layer,
        label: getAppearanceTokenLayerLabel(layer, t),
      })),
    ],
    [t],
  )
  const appearanceTokenGroupFilterOptions = useMemo<Array<{ value: AppearanceTokenGroupFilter; label: string }>>(
    () => [
      { value: "all", label: t("settings.appearance.allTokenGroups") },
      ...availableAppearanceTokenGroups.map((group) => ({
        value: group.id,
        label: getAppearanceTokenGroupCopy(locale, group).label,
      })),
    ],
    [availableAppearanceTokenGroups, locale, t],
  )
  const appearanceTokenCustomizationFilterOptions = useMemo<
    Array<{ value: AppearanceTokenCustomizationFilter; label: string }>
  >(
    () => [
      { value: "all", label: t("settings.appearance.allTokens") },
      { value: "customized", label: t("settings.appearance.customizedTokens") },
    ],
    [t],
  )
  const filteredAppearanceTokenGroups = useMemo(
    () =>
      filterAppearanceTokenGroups(
        APPEARANCE_TOKEN_GROUPS,
        themeTokenSearchQuery,
        appearanceTokenValues,
        locale,
        themeTokenLayerFilter,
        themeTokenGroupFilter,
        themeTokenCustomizationFilter,
        appearanceOverrides,
      ),
    [
      appearanceOverrides,
      appearanceTokenValues,
      locale,
      themeTokenCustomizationFilter,
      themeTokenGroupFilter,
      themeTokenLayerFilter,
      themeTokenSearchQuery,
    ],
  )
  useEffect(() => {
    if (themeTokenGroupFilter === "all") return

    const selectedGroup = APPEARANCE_TOKEN_GROUPS.find((group) => group.id === themeTokenGroupFilter)
    if (selectedGroup && (themeTokenLayerFilter === "all" || selectedGroup.layer === themeTokenLayerFilter)) {
      return
    }

    setThemeTokenGroupFilter("all")
  }, [themeTokenGroupFilter, themeTokenLayerFilter])

  const appearanceTokenTotalCount = countAppearanceTokenRows(availableAppearanceTokenGroups)
  const appearanceTokenVisibleCount = countAppearanceTokenRows(filteredAppearanceTokenGroups)
  const colorValueLabel = t("settings.appearance.tokenColorValue")
  const channelLabels = {
    hue: t("settings.appearance.tokenHue"),
    saturation: t("settings.appearance.tokenSaturation"),
    brightness: t("settings.appearance.tokenBrightness"),
    alpha: t("settings.appearance.tokenAlpha"),
  }

  return (
    <>
      <div className="settings-theme-token-toolbar">
        <div className="settings-provider-search-control settings-theme-token-search" role="search">
          <SearchIcon />
          <input
            aria-label={t("settings.appearance.searchTokensLabel")}
            type="search"
            value={themeTokenSearchQuery}
            placeholder={t("settings.appearance.searchTokensPlaceholder")}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setThemeTokenSearchQuery(event.target.value)}
          />
        </div>
        <div className="settings-theme-token-filter-controls">
          <SettingsSelect<AppearanceTokenLayerFilter>
            ariaLabel={t("settings.appearance.tokenLayerFilterLabel")}
            className="settings-theme-token-layer-select"
            options={appearanceTokenLayerFilterOptions}
            value={themeTokenLayerFilter}
            onChange={setThemeTokenLayerFilter}
          />
          <SettingsSelect<AppearanceTokenGroupFilter>
            ariaLabel={t("settings.appearance.tokenGroupFilterLabel")}
            className="settings-theme-token-filter-select"
            options={appearanceTokenGroupFilterOptions}
            value={themeTokenGroupFilter}
            onChange={setThemeTokenGroupFilter}
          />
          <SettingsSelect<AppearanceTokenCustomizationFilter>
            ariaLabel={t("settings.appearance.tokenStatusFilterLabel")}
            className="settings-theme-token-status-select"
            options={appearanceTokenCustomizationFilterOptions}
            value={themeTokenCustomizationFilter}
            onChange={setThemeTokenCustomizationFilter}
          />
          <span className="settings-theme-token-search-count" aria-live="polite">
            {t("settings.appearance.searchTokensCount", {
              total: appearanceTokenTotalCount,
              visible: appearanceTokenVisibleCount,
            })}
          </span>
        </div>
      </div>

      {filteredAppearanceTokenGroups.length === 0 ? (
        <article className="settings-empty-state settings-theme-token-empty-result">
          <span className="label">{t("app.search")}</span>
          <h3>{t("settings.appearance.noTokenResultsTitle")}</h3>
          <p>{t("settings.appearance.noTokenResultsCopy")}</p>
        </article>
      ) : (
        filteredAppearanceTokenGroups.map((group) => {
          const groupLayerLabel = getAppearanceTokenLayerLabel(group.layer, t)
          const groupCopy = getAppearanceTokenGroupCopy(locale, group)

          return (
            <section key={group.id} className="settings-panel settings-theme-token-panel">
              <div className="settings-section-header">
                <div>
                  <span className="settings-theme-token-layer-badge">{groupLayerLabel}</span>
                  <h3>{groupCopy.label}</h3>
                </div>
                <p>{groupCopy.description}</p>
              </div>

              <div className="settings-theme-token-grid">
                {group.rows.map((row) => {
                  const rowCopy = getAppearanceTokenRowCopy(locale, row)
                  const isLightCustomized = Boolean(appearanceOverrides[row.lightToken])
                  const isDarkCustomized = Boolean(appearanceOverrides[row.darkToken])
                  const isCustomized = isLightCustomized || isDarkCustomized
                  const lightColorLabel = `${groupCopy.label} ${rowCopy.label} ${t("settings.appearance.light")} ${row.lightToken}`
                  const darkColorLabel = `${groupCopy.label} ${rowCopy.label} ${t("settings.appearance.dark")} ${row.darkToken}`
                  const lightTokenValue = appearanceTokenValues[row.lightToken]
                  const darkTokenValue = appearanceTokenValues[row.darkToken]

                  return (
                    <article
                      key={row.id}
                      className={
                        isCustomized
                          ? "settings-theme-token-card is-customized"
                          : "settings-theme-token-card"
                      }
                      title={`${row.id} / ${row.lightToken} / ${row.darkToken}`}
                    >
                      <div className="settings-theme-token-copy">
                        <strong>{rowCopy.label}</strong>
                        <span className="settings-theme-token-description">{rowCopy.description}</span>
                      </div>

                      <div className="settings-theme-token-controls">
                        <div className="settings-theme-token-mode">
                          <span>{t("settings.appearance.light")}</span>
                          <AppearanceColorPicker
                            ariaLabel={lightColorLabel}
                            channelLabels={channelLabels}
                            value={lightTokenValue}
                            onChange={(value) => onAppearanceTokenChange(row.lightToken, value)}
                          />
                          <AppearanceColorTextInput
                            ariaLabel={`${lightColorLabel} ${colorValueLabel}`}
                            value={lightTokenValue}
                            onCommit={(value) => onAppearanceTokenChange(row.lightToken, value)}
                          />
                        </div>
                        <div className="settings-theme-token-mode">
                          <span>{t("settings.appearance.dark")}</span>
                          <AppearanceColorPicker
                            ariaLabel={darkColorLabel}
                            channelLabels={channelLabels}
                            value={darkTokenValue}
                            onChange={(value) => onAppearanceTokenChange(row.darkToken, value)}
                          />
                          <AppearanceColorTextInput
                            ariaLabel={`${darkColorLabel} ${colorValueLabel}`}
                            value={darkTokenValue}
                            onCommit={(value) => onAppearanceTokenChange(row.darkToken, value)}
                          />
                        </div>
                        <button
                          aria-label={t("settings.appearance.usePresetFor", {
                            name: `${groupCopy.label} ${rowCopy.label}`,
                          })}
                          className="secondary-button settings-theme-token-reset"
                          type="button"
                          disabled={!isCustomized}
                          title={t("settings.appearance.usePreset")}
                          onClick={() => {
                            onAppearanceTokenReset(row.lightToken)
                            onAppearanceTokenReset(row.darkToken)
                          }}
                        >
                          <ResetIcon size={14} />
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })
      )}
    </>
  )
}

const appearanceThemeSwatchTokenPairs = [
  ["surface-app-light", "surface-app-dark"],
  ["surface-panel-light", "surface-panel-dark"],
  ["text-primary-light", "text-primary-dark"],
  ["brand-primary", "brand-primary-dark"],
] as const satisfies readonly (readonly [AppearanceTokenName, AppearanceTokenName])[]

function resolveAppearanceThemeSwatchColor(
  theme: AppearanceTheme,
  lightToken: AppearanceTokenName,
  darkToken: AppearanceTokenName,
  appearanceTokenValues: Record<AppearanceTokenName, string>,
) {
  const preferredToken = theme.colorMode === "dark" ? darkToken : lightToken
  return theme.overrides[preferredToken]
    ?? theme.overrides[lightToken]
    ?? theme.overrides[darkToken]
    ?? appearanceTokenValues[preferredToken]
    ?? "var(--seg-panel)"
}

function AppearanceThemeSwatches({
  appearanceTokenValues,
  theme,
}: {
  appearanceTokenValues: Record<AppearanceTokenName, string>
  theme: AppearanceTheme
}) {
  return (
    <span className="settings-theme-library-swatches" aria-hidden="true">
      {appearanceThemeSwatchTokenPairs.map(([lightToken, darkToken]) => (
        <span
          key={`${theme.id}:${lightToken}`}
          style={{
            "--settings-theme-library-swatch": resolveAppearanceThemeSwatchColor(
              theme,
              lightToken,
              darkToken,
              appearanceTokenValues,
            ),
          } as CSSProperties}
        />
      ))}
    </span>
  )
}

interface AppearanceThemeLibraryPanelProps {
  activeThemeID?: string
  appearanceTokenValues: Record<AppearanceTokenName, string>
  error?: string | null
  onApply?: (themeID: string) => void | Promise<void>
  onDelete?: (themeID: string) => void | Promise<void>
  onDuplicate?: (themeID: string, name?: string) => Promise<AppearanceTheme | null>
  onRename?: (themeID: string, name: string) => Promise<AppearanceTheme | null>
  onSaveCurrent?: (name: string) => Promise<AppearanceTheme | null>
  themes: readonly AppearanceTheme[]
}

function AppearanceThemeLibraryPanel({
  activeThemeID,
  appearanceTokenValues,
  error,
  onApply,
  onDelete,
  onDuplicate,
  onRename,
  onSaveCurrent,
  themes,
}: AppearanceThemeLibraryPanelProps) {
  const { t } = useI18n()
  const defaultNewThemeName = t("settings.appearance.themeNewNameDefault")
  const [selectedThemeID, setSelectedThemeID] = useState(() => activeThemeID ?? themes[0]?.id ?? "")
  const [themeNameDraft, setThemeNameDraft] = useState(defaultNewThemeName)
  const [pendingThemeAction, setPendingThemeAction] = useState<string | null>(null)
  const pendingSelectedThemeIDRef = useRef<string | null>(null)
  const selectedTheme = themes.find((theme) => theme.id === selectedThemeID) ?? themes[0] ?? null
  const trimmedThemeName = themeNameDraft.trim()
  const isRenameDisabled =
    !selectedTheme ||
    selectedTheme.readonly ||
    !onRename ||
    pendingThemeAction !== null ||
    !trimmedThemeName ||
    trimmedThemeName === selectedTheme.name

  useEffect(() => {
    const pendingSelectedThemeID = pendingSelectedThemeIDRef.current
    if (pendingSelectedThemeID && themes.some((theme) => theme.id === pendingSelectedThemeID)) {
      pendingSelectedThemeIDRef.current = null
      setSelectedThemeID(pendingSelectedThemeID)
      return
    }

    if (selectedThemeID && themes.some((theme) => theme.id === selectedThemeID)) return
    setSelectedThemeID(activeThemeID ?? themes[0]?.id ?? "")
  }, [activeThemeID, selectedThemeID, themes])

  useEffect(() => {
    if (!selectedTheme || selectedTheme.readonly) {
      setThemeNameDraft(defaultNewThemeName)
      return
    }

    setThemeNameDraft(selectedTheme.name)
  }, [defaultNewThemeName, selectedTheme?.id, selectedTheme?.name, selectedTheme?.readonly])

  function getThemeSourceLabel(theme: AppearanceTheme) {
    if (theme.source === "built-in") return t("settings.appearance.themeSourceBuiltIn")
    if (theme.source === "imported") return t("settings.appearance.themeSourceImported")
    return t("settings.appearance.themeSourceUser")
  }

  async function runThemeAction(actionID: string, action: () => Promise<void>) {
    setPendingThemeAction(actionID)
    try {
      await action()
    } finally {
      setPendingThemeAction(null)
    }
  }

  async function handleApplyTheme() {
    if (!selectedTheme || !onApply) return
    await runThemeAction("apply", async () => {
      await onApply(selectedTheme.id)
    })
  }

  async function handleSaveCurrentTheme() {
    if (!onSaveCurrent) return

    const name = trimmedThemeName || defaultNewThemeName
    await runThemeAction("save", async () => {
      const theme = await onSaveCurrent(name)
      if (theme) {
        pendingSelectedThemeIDRef.current = theme.id
        if (themes.some((item) => item.id === theme.id)) {
          pendingSelectedThemeIDRef.current = null
          setSelectedThemeID(theme.id)
        }
        setThemeNameDraft(defaultNewThemeName)
      }
    })
  }

  async function handleRenameTheme() {
    if (!selectedTheme || selectedTheme.readonly || !onRename || isRenameDisabled) return

    await runThemeAction("rename", async () => {
      const theme = await onRename(selectedTheme.id, trimmedThemeName)
      if (theme) {
        setSelectedThemeID(theme.id)
        setThemeNameDraft(theme.name)
      }
    })
  }

  async function handleDuplicateTheme() {
    if (!selectedTheme || !onDuplicate) return

    await runThemeAction("duplicate", async () => {
      const theme = await onDuplicate(selectedTheme.id, `${selectedTheme.name} ${t("settings.appearance.themeCopySuffix")}`)
      if (theme) {
        pendingSelectedThemeIDRef.current = theme.id
        if (themes.some((item) => item.id === theme.id)) {
          pendingSelectedThemeIDRef.current = null
          setSelectedThemeID(theme.id)
        }
      }
    })
  }

  async function handleDeleteTheme() {
    if (!selectedTheme || selectedTheme.readonly || !onDelete) return
    if (!window.confirm(t("settings.appearance.themeDeleteConfirm", { name: selectedTheme.name }))) return

    await runThemeAction("delete", async () => {
      await onDelete(selectedTheme.id)
      setSelectedThemeID(activeThemeID ?? themes.find((theme) => theme.id !== selectedTheme.id)?.id ?? "")
    })
  }

  if (themes.length === 0) return null

  return (
    <section className="settings-panel settings-theme-library-panel">
      <div className="settings-section-header">
        <div>
          <span className="label">{t("settings.appearance.themeLibraryLabel")}</span>
          <h3>{t("settings.appearance.themeLibraryTitle")}</h3>
        </div>
        <p>{t("settings.appearance.themeLibraryCopy")}</p>
      </div>

      <div className="settings-theme-library-shell">
        <div
          className="settings-theme-library-list"
          role="listbox"
          aria-label={t("settings.appearance.themeLibraryListLabel")}
        >
          {themes.map((theme) => {
            const isActive = theme.id === activeThemeID
            const isSelected = theme.id === selectedTheme?.id

            return (
              <button
                key={theme.id}
                className={[
                  "settings-theme-library-item",
                  isActive ? "is-active" : "",
                  isSelected ? "is-selected" : "",
                ].filter(Boolean).join(" ")}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => setSelectedThemeID(theme.id)}
              >
                <AppearanceThemeSwatches
                  appearanceTokenValues={appearanceTokenValues}
                  theme={theme}
                />
                <span className="settings-theme-library-item-copy">
                  <strong>{theme.name}</strong>
                  <small>
                    {getThemeSourceLabel(theme)}
                    {isActive ? ` · ${t("settings.appearance.themeCurrent")}` : ""}
                  </small>
                </span>
              </button>
            )
          })}
        </div>

        <div className="settings-theme-library-detail">
          {selectedTheme ? (
            <>
              <div className="settings-theme-library-detail-header">
                <div>
                  <span className="label">{getThemeSourceLabel(selectedTheme)}</span>
                  <h4>{selectedTheme.name}</h4>
                </div>
                <AppearanceThemeSwatches
                  appearanceTokenValues={appearanceTokenValues}
                  theme={selectedTheme}
                />
              </div>

              <dl className="settings-theme-library-meta">
                <div>
                  <dt>{t("settings.appearance.colorMode")}</dt>
                  <dd>{selectedTheme.colorMode}</dd>
                </div>
                <div>
                  <dt>{t("settings.appearance.accentTheme")}</dt>
                  <dd>{selectedTheme.brandTheme}</dd>
                </div>
                <div>
                  <dt>{t("settings.appearance.codeTheme")}</dt>
                  <dd>{selectedTheme.codeThemePreference}</dd>
                </div>
              </dl>

              <div className="settings-theme-library-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!onApply || selectedTheme.id === activeThemeID || pendingThemeAction !== null}
                  onClick={handleApplyTheme}
                >
                  {t("settings.appearance.themeApply")}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!onDuplicate || pendingThemeAction !== null}
                  onClick={handleDuplicateTheme}
                >
                  {t("settings.appearance.themeDuplicate")}
                </button>
                <button
                  className="secondary-button is-danger"
                  type="button"
                  disabled={selectedTheme.readonly || !onDelete || pendingThemeAction !== null}
                  onClick={handleDeleteTheme}
                >
                  {t("settings.appearance.themeDelete")}
                </button>
              </div>
            </>
          ) : null}

          <div className="settings-theme-library-save">
            <label>
              <span className="label">{t("settings.appearance.themeNameLabel")}</span>
              <input
                type="text"
                value={themeNameDraft}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setThemeNameDraft(event.target.value)}
              />
            </label>
            {selectedTheme && !selectedTheme.readonly ? (
              <button
                className="secondary-button"
                type="button"
                disabled={isRenameDisabled}
                onClick={handleRenameTheme}
              >
                {t("settings.appearance.themeRename")}
              </button>
            ) : null}
            <button
              className="primary-button"
              type="button"
              disabled={!onSaveCurrent || pendingThemeAction !== null}
              onClick={handleSaveCurrentTheme}
            >
              {t("settings.appearance.themeSaveCurrent")}
            </button>
          </div>

          {error ? (
            <p className="settings-helper-text settings-theme-config-error">{error}</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

interface AppearanceSettingsPanelProps {
  appearanceConfigError: string | null
  appearanceConfigPath: string | null
  appearanceConfigPreview: string
  appearanceOverrides: AppearanceTokenMap
  appearanceThemeError?: string | null
  appearanceThemes?: readonly AppearanceTheme[]
  activeAppearanceThemeID?: string
  appearanceTokenValues: Record<AppearanceTokenName, string>
  colorMode: ColorMode
  fontFamily: AppearanceFontFamily
  htmlBackgroundConfig: HtmlBackgroundConfig
  isActivityRailVisible?: boolean
  showShellLayoutSettings?: boolean
  onActivityRailVisibilityChange?: (value: boolean) => void
  onAppearancePaletteReset: () => void
  onAppearanceThemeApply?: (themeID: string) => void | Promise<void>
  onAppearanceThemeDelete?: (themeID: string) => void | Promise<void>
  onAppearanceThemeDuplicate?: (themeID: string, name?: string) => Promise<AppearanceTheme | null>
  onAppearanceThemeRename?: (themeID: string, name: string) => Promise<AppearanceTheme | null>
  onAppearanceThemeSaveCurrent?: (name: string) => Promise<AppearanceTheme | null>
  onAppearanceTokenChange: (tokenName: AppearanceTokenName, value: string) => void
  onAppearanceTokenReset: (tokenName: AppearanceTokenName) => void
  onColorModeChange: (mode: ColorMode) => void
  onFontFamilyChange: (fontFamily: AppearanceFontFamily) => void
  onHtmlBackgroundConfigChange: (config: HtmlBackgroundConfig) => void
  onOpenAppearanceWindow?: () => void
}

export function AppearanceSettingsPanel({
  appearanceConfigError,
  appearanceConfigPath,
  appearanceConfigPreview,
  appearanceOverrides,
  appearanceThemeError,
  appearanceThemes = [],
  activeAppearanceThemeID,
  appearanceTokenValues,
  colorMode,
  fontFamily,
  htmlBackgroundConfig,
  isActivityRailVisible = true,
  showShellLayoutSettings = false,
  onActivityRailVisibilityChange,
  onAppearancePaletteReset,
  onAppearanceThemeApply,
  onAppearanceThemeDelete,
  onAppearanceThemeDuplicate,
  onAppearanceThemeRename,
  onAppearanceThemeSaveCurrent,
  onAppearanceTokenChange,
  onAppearanceTokenReset,
  onColorModeChange,
  onFontFamilyChange,
  onHtmlBackgroundConfigChange,
  onOpenAppearanceWindow,
}: AppearanceSettingsPanelProps) {
  const { t } = useI18n()
  const colorModeOptions: Array<{ value: ColorMode; label: string }> = [
    { value: "light", label: t("settings.appearance.light") },
    { value: "dark", label: t("settings.appearance.dark") },
    { value: "system", label: t("settings.appearance.system") },
  ]
  const hasCustomAppearanceOverrides = Object.keys(appearanceOverrides).length > 0
  const hasHtmlBackgroundSource = htmlBackgroundConfig.html.trim().length > 0

  function updateHtmlBackgroundConfig(patch: Partial<HtmlBackgroundConfig>) {
    onHtmlBackgroundConfigChange({
      ...htmlBackgroundConfig,
      ...patch,
    })
  }

  return (
    <div className="settings-appearance-layout">
      <AppearanceThemeLibraryPanel
        activeThemeID={activeAppearanceThemeID}
        appearanceTokenValues={appearanceTokenValues}
        error={appearanceThemeError}
        themes={appearanceThemes}
        onApply={onAppearanceThemeApply}
        onDelete={onAppearanceThemeDelete}
        onDuplicate={onAppearanceThemeDuplicate}
        onRename={onAppearanceThemeRename}
        onSaveCurrent={onAppearanceThemeSaveCurrent}
      />

      <section className="settings-panel">
        <div className="settings-select-list">
          <div className="settings-select-row">
            <span className="settings-select-copy">
              <span className="settings-select-title">{t("settings.appearance.colorMode")}</span>
            </span>
            <span className="settings-select-control">
              <SettingsSelect<ColorMode>
                ariaLabel={t("settings.appearance.colorMode")}
                options={colorModeOptions}
                value={colorMode}
                onChange={onColorModeChange}
              />
            </span>
          </div>

          <div className="settings-select-row">
            <span className="settings-select-copy">
              <span className="settings-select-title">{t("settings.appearance.interfaceFont")}</span>
            </span>
            <span className="settings-select-control">
              <SettingsSelect<AppearanceFontFamily>
                ariaLabel={t("settings.appearance.interfaceFont")}
                options={fontFamilyOptions}
                value={fontFamily}
                onChange={onFontFamilyChange}
              />
            </span>
          </div>
        </div>
      </section>

      <section className="settings-panel settings-html-background-panel">
        <div className="settings-section-header">
          <div>
            <span className="label">{t("settings.appearance.htmlBackgroundLabel")}</span>
            <h3>{t("settings.appearance.htmlBackgroundTitle")}</h3>
          </div>
          <p>{t("settings.appearance.htmlBackgroundCopy")}</p>
        </div>

        <button
          className={htmlBackgroundConfig.enabled ? "settings-toggle-card is-active" : "settings-toggle-card"}
          role="switch"
          aria-checked={htmlBackgroundConfig.enabled}
          aria-label={t("settings.appearance.htmlBackgroundEnable")}
          type="button"
          disabled={!hasHtmlBackgroundSource}
          onClick={() => updateHtmlBackgroundConfig({ enabled: !htmlBackgroundConfig.enabled })}
        >
          <span className="settings-toggle-copy">
            <strong className="settings-toggle-title">
              <span>{t("settings.appearance.htmlBackgroundEnable")}</span>
            </strong>
            <small>
              {hasHtmlBackgroundSource
                ? t("settings.appearance.htmlBackgroundEnableCopy")
                : t("settings.appearance.htmlBackgroundEmptyCopy")}
            </small>
          </span>
          <span className="settings-toggle-control" aria-hidden="true">
            <span className="settings-toggle-thumb" />
          </span>
        </button>

        <label className="settings-html-background-editor">
          <span className="label">{t("settings.appearance.htmlBackgroundHtmlLabel")}</span>
          <textarea
            aria-label={t("settings.appearance.htmlBackgroundHtmlLabel")}
            spellCheck={false}
            value={htmlBackgroundConfig.html}
            placeholder={t("settings.appearance.htmlBackgroundPlaceholder")}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateHtmlBackgroundConfig({
              enabled: event.target.value.trim().length > 0 ? htmlBackgroundConfig.enabled : false,
              html: event.target.value,
            })}
          />
        </label>

        <button
          className={htmlBackgroundConfig.renderMode === "dynamic" ? "settings-toggle-card is-active" : "settings-toggle-card"}
          role="switch"
          aria-checked={htmlBackgroundConfig.renderMode === "dynamic"}
          aria-label={t("settings.appearance.htmlBackgroundDynamicMode")}
          type="button"
          disabled={!hasHtmlBackgroundSource}
          onClick={() => updateHtmlBackgroundConfig({
            renderMode: htmlBackgroundConfig.renderMode === "dynamic" ? "static" : "dynamic",
          })}
        >
          <span className="settings-toggle-copy">
            <strong className="settings-toggle-title">{t("settings.appearance.htmlBackgroundDynamicMode")}</strong>
            <small>{t("settings.appearance.htmlBackgroundDynamicModeCopy")}</small>
          </span>
          <span className="settings-toggle-control" aria-hidden="true">
            <span className="settings-toggle-thumb" />
          </span>
        </button>

        <div className="settings-html-background-controls" aria-label={t("settings.appearance.htmlBackgroundVisualControls")}>
          <label className="settings-html-background-range">
            <span>{t("settings.appearance.htmlBackgroundOpacity")}</span>
            <input
              type="range"
              min="0.08"
              max="1"
              step="0.02"
              value={htmlBackgroundConfig.opacity}
              onChange={(event: ChangeEvent<HTMLInputElement>) => updateHtmlBackgroundConfig({ opacity: Number(event.target.value) })}
            />
            <output>{Math.round(htmlBackgroundConfig.opacity * 100)}%</output>
          </label>

          <label className="settings-html-background-range">
            <span>{t("settings.appearance.htmlBackgroundBlur")}</span>
            <input
              type="range"
              min="0"
              max="24"
              step="1"
              value={htmlBackgroundConfig.blurPx}
              onChange={(event: ChangeEvent<HTMLInputElement>) => updateHtmlBackgroundConfig({ blurPx: Number(event.target.value) })}
            />
            <output>{Math.round(htmlBackgroundConfig.blurPx)}px</output>
          </label>

          <label className="settings-html-background-range">
            <span>{t("settings.appearance.htmlBackgroundDim")}</span>
            <input
              type="range"
              min="0"
              max="0.86"
              step="0.02"
              value={htmlBackgroundConfig.dim}
              onChange={(event: ChangeEvent<HTMLInputElement>) => updateHtmlBackgroundConfig({ dim: Number(event.target.value) })}
            />
            <output>{Math.round(htmlBackgroundConfig.dim * 100)}%</output>
          </label>
        </div>

        <button
          className={htmlBackgroundConfig.paused ? "settings-toggle-card is-active" : "settings-toggle-card"}
          role="switch"
          aria-checked={htmlBackgroundConfig.paused}
          aria-label={t("settings.appearance.htmlBackgroundPauseMotion")}
          type="button"
          disabled={!hasHtmlBackgroundSource}
          onClick={() => updateHtmlBackgroundConfig({ paused: !htmlBackgroundConfig.paused })}
        >
          <span className="settings-toggle-copy">
            <strong className="settings-toggle-title">{t("settings.appearance.htmlBackgroundPauseMotion")}</strong>
            <small>{t("settings.appearance.htmlBackgroundPauseMotionCopy")}</small>
          </span>
          <span className="settings-toggle-control" aria-hidden="true">
            <span className="settings-toggle-thumb" />
          </span>
        </button>

        <div className="settings-actions-row settings-html-background-actions">
          <span className="settings-helper-text">
            {htmlBackgroundConfig.renderMode === "dynamic"
              ? t("settings.appearance.htmlBackgroundDynamicSafetyCopy")
              : t("settings.appearance.htmlBackgroundSafetyCopy")}
          </span>
          <button
            className="secondary-button"
            type="button"
            disabled={!hasHtmlBackgroundSource && !htmlBackgroundConfig.enabled}
            onClick={() => onHtmlBackgroundConfigChange({ ...DEFAULT_HTML_BACKGROUND_CONFIG })}
          >
            {t("settings.appearance.htmlBackgroundReset")}
          </button>
        </div>
      </section>

      <section className="settings-panel">
        <div className="settings-section-header">
          <div>
            <span className="label">{t("settings.appearance.config")}</span>
            <h3>{t("settings.appearance.themeConfigFile")}</h3>
          </div>
          <div className="settings-inline-actions">
            {onOpenAppearanceWindow ? (
              <button
                className="secondary-button"
                type="button"
                onClick={onOpenAppearanceWindow}
              >
                {t("settings.appearance.openWindow")}
              </button>
            ) : null}
            <button
              className="secondary-button"
              type="button"
              disabled={!hasCustomAppearanceOverrides}
              onClick={onAppearancePaletteReset}
            >
              {t("settings.appearance.resetPalette")}
            </button>
          </div>
        </div>

        <div className="settings-theme-config-meta">
          <div className="settings-theme-config-path">
            <span className="label">{t("settings.appearance.savedTo")}</span>
            <code>{appearanceConfigPath ?? t("settings.appearance.configUnavailable")}</code>
          </div>
          <p className="settings-helper-text">
            {t("settings.appearance.configAutoSavedCopy")}
          </p>
          {appearanceConfigError ? (
            <p className="settings-helper-text settings-theme-config-error">{appearanceConfigError}</p>
          ) : null}
        </div>

        <label className="settings-theme-config-preview">
          <span className="label">{t("settings.appearance.currentJson")}</span>
          <textarea
            aria-label={t("settings.appearance.currentJsonLabel")}
            readOnly
            value={appearanceConfigPreview}
          />
        </label>
      </section>

      <AppearanceTokenEditor
        appearanceOverrides={appearanceOverrides}
        appearanceTokenValues={appearanceTokenValues}
        onAppearanceTokenChange={onAppearanceTokenChange}
        onAppearanceTokenReset={onAppearanceTokenReset}
      />

      {showShellLayoutSettings ? (
        <>
          <section className="settings-panel">
            <div className="settings-section-header">
              <div>
                <span className="label">{t("settings.appearance.shell")}</span>
                <h3>{t("settings.appearance.layoutVisibility")}</h3>
              </div>
              <p>{t("settings.appearance.layoutVisibilityCopy")}</p>
            </div>

            <button
              className={isActivityRailVisible ? "settings-toggle-card is-active" : "settings-toggle-card"}
              role="switch"
              aria-checked={isActivityRailVisible}
              aria-label={t("settings.appearance.showLeftRail")}
              type="button"
              onClick={() => onActivityRailVisibilityChange?.(!isActivityRailVisible)}
            >
              <span className="settings-toggle-copy">
                <strong className="settings-toggle-title">
                  <span className="settings-toggle-icon" aria-hidden="true">
                    <LayoutSidebarLeftIcon />
                  </span>
                  <span>{t("settings.appearance.showLeftRail")}</span>
                </strong>
                <small>{t("settings.appearance.showLeftRailCopy")}</small>
              </span>
              <span className="settings-toggle-control" aria-hidden="true">
                <span className="settings-toggle-thumb" />
              </span>
            </button>

            <p className="settings-helper-text">
              {t("settings.appearance.leftRailHiddenCopy")}
            </p>
          </section>

          <section className="settings-panel">
            <div className="settings-section-header">
              <div>
                <span className="label">{t("settings.appearance.current")}</span>
                <h3>{t("settings.appearance.state")}</h3>
              </div>
              <p>{t("settings.appearance.stateCopy")}</p>
            </div>

            <div className="settings-section-summary">
              <article className="settings-summary-card">
                <span className="label">{t("settings.appearance.left")}</span>
                <strong>
                  {isActivityRailVisible ? t("settings.appearance.shown") : t("settings.appearance.hidden")}
                </strong>
                <p>
                  {isActivityRailVisible
                    ? t("settings.appearance.leftRailShownSummary")
                    : t("settings.appearance.leftRailHiddenSummary")}
                </p>
              </article>
              <article className="settings-summary-card">
                <span className="label">{t("settings.appearance.right")}</span>
                <strong>{t("settings.appearance.noRail")}</strong>
                <p>{t("settings.appearance.rightNoRailSummary")}</p>
              </article>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

type ModelCatalogFilterKey = "all" | "text" | "image" | "video"

interface ModelCatalogViewProps {
  filter: ModelCatalogFilterKey
  items: ModelCatalogItem[]
  selectionDraft: ProjectModelSelection
  onFilterChange: (filter: ModelCatalogFilterKey) => void
  t: SettingsTranslate
}

interface ModelCatalogListViewProps {
  items: ModelCatalogItem[]
  selectionDraft: ProjectModelSelection
  t: SettingsTranslate
}

interface ProviderModelPickerProps {
  catalog: ProviderCatalogItem[]
  emptyLabel: string
  label: string
  models: ProviderModel[]
  value: string | null
  onChange: (value: string | null) => void
}

interface ProviderModelPickerGroup {
  matchingModels: ProviderModel[]
  provider: ProviderCatalogItem
}

function matchesProviderModelSearch(provider: ProviderCatalogItem, model: ProviderModel, normalizedQuery: string) {
  if (!normalizedQuery) return true

  return `${provider.name} ${provider.id} ${model.name} ${model.id}`.toLowerCase().includes(normalizedQuery)
}

function matchesProviderModelPickerProviderSearch(provider: ProviderCatalogItem, normalizedQuery: string) {
  if (!normalizedQuery) return true

  return `${provider.name} ${provider.id}`.toLowerCase().includes(normalizedQuery)
}

function buildProviderModelPickerGroups(
  catalog: ProviderCatalogItem[],
  models: ProviderModel[],
  searchQuery: string,
): ProviderModelPickerGroup[] {
  const normalizedQuery = searchQuery.trim().toLowerCase()

  return catalog.flatMap((provider) => {
    if (!provider.available) return []

    const providerModels = models.filter((model) => model.providerID === provider.id)
    if (providerModels.length === 0) return []

    const providerMatches = matchesProviderModelPickerProviderSearch(provider, normalizedQuery)
    const matchingModels = normalizedQuery
      ? providerModels.filter((model) => matchesProviderModelSearch(provider, model, normalizedQuery))
      : providerModels

    if (normalizedQuery && !providerMatches && matchingModels.length === 0) return []

    return [
      {
        matchingModels: providerMatches ? providerModels : matchingModels,
        provider,
      },
    ]
  })
}

function ProviderModelPicker({
  catalog,
  emptyLabel,
  label,
  models,
  value,
  onChange,
}: ProviderModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeProviderID, setActiveProviderID] = useState<string | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const selectedModel = models.find((model) => toModelValue(model) === value) ?? null
  const selectedProviderID = selectedModel?.providerID ?? value?.split("/")[0] ?? null
  const selectedLabel = selectedModel ? toModelOptionLabel(selectedModel, catalog) : (value ?? emptyLabel)
  const allProviderGroups = useMemo(() => buildProviderModelPickerGroups(catalog, models, ""), [catalog, models])
  const providerGroups = useMemo(
    () => buildProviderModelPickerGroups(catalog, models, searchQuery),
    [catalog, models, searchQuery],
  )
  const activeProviderGroup =
    (activeProviderID ? providerGroups.find((group) => group.provider.id === activeProviderID) : null) ?? providerGroups[0] ?? null

  useEffect(() => {
    if (!isOpen) return

    setSearchQuery("")
    setActiveProviderID(
      selectedProviderID && allProviderGroups.some((group) => group.provider.id === selectedProviderID)
        ? selectedProviderID
        : (allProviderGroups[0]?.provider.id ?? null),
    )
  }, [allProviderGroups, isOpen, selectedProviderID])

  useEffect(() => {
    if (!isOpen) return
    if (activeProviderID && providerGroups.some((group) => group.provider.id === activeProviderID)) return

    setActiveProviderID(providerGroups[0]?.provider.id ?? null)
  }, [activeProviderID, isOpen, providerGroups])

  useEffect(() => {
    if (!isOpen) return

    function handleDocumentPointerDown(event: globalThis.PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return

      setIsOpen(false)
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown)
    return () => document.removeEventListener("pointerdown", handleDocumentPointerDown)
  }, [isOpen])

  function closePicker() {
    setIsOpen(false)
    setSearchQuery("")
    setActiveProviderID(null)
    buttonRef.current?.focus()
  }

  function handleModelSelect(model: ProviderModel) {
    closePicker()
    onChange(toModelValue(model))
  }

  return (
    <div className="provider-model-picker">
      <button
        ref={buttonRef}
        type="button"
        className={isOpen ? "provider-model-picker-button is-open" : "provider-model-picker-button"}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`${label}: ${selectedLabel}`}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className={value ? "provider-model-picker-value" : "provider-model-picker-value is-empty"}>{selectedLabel}</span>
        <ChevronDownIcon />
      </button>

      {isOpen ? (
        <div
          ref={panelRef}
          className="provider-model-picker-panel"
          role="dialog"
          aria-label={`${label} model picker`}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            event.preventDefault()
            event.stopPropagation()
            closePicker()
          }}
        >
          <div className="provider-model-picker-search-row">
            <input
              aria-label="Search providers or models"
              autoFocus
              className="provider-model-picker-search"
              placeholder="搜索 Provider 或模型"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
            />
          </div>

          {providerGroups.length > 0 ? (
            <div className="provider-model-picker-body">
              <div className="provider-model-picker-provider-list" role="listbox" aria-label={`${label} providers`}>
                {providerGroups.map((group) => {
                  const isActive = activeProviderGroup?.provider.id === group.provider.id

                  return (
                    <button
                      key={group.provider.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={isActive ? "provider-model-picker-provider is-active" : "provider-model-picker-provider"}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setActiveProviderID(group.provider.id)
                      }}
                    >
                      <span className="provider-model-picker-provider-name">{group.provider.name}</span>
                    </button>
                  )
                })}
              </div>

              <div className="provider-model-picker-model-list" role="listbox" aria-label={`${label} models`}>
                {activeProviderGroup && activeProviderGroup.matchingModels.length > 0 ? (
                  activeProviderGroup.matchingModels.map((model) => {
                    const modelValue = toModelValue(model)
                    const isSelected = value === modelValue

                    return (
                      <button
                        key={modelValue}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className="provider-model-picker-model"
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          handleModelSelect(model)
                        }}
                      >
                        <span className="provider-model-picker-model-name">{model.name}</span>
                      </button>
                    )
                  })
                ) : (
                  <p className="provider-model-picker-empty">No models found.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="provider-model-picker-empty">
              {models.length === 0 ? "No models available." : "No providers or models found."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function getModelStatusLabel(status: string, t: SettingsTranslate) {
  switch (status.toLowerCase()) {
    case "active":
      return t("settings.models.statusActive")
    case "inactive":
      return t("settings.models.statusInactive")
    case "deprecated":
      return t("settings.models.statusDeprecated")
    default:
      return status
  }
}

function modelCatalogValue(item: ModelCatalogItem) {
  return `${item.providerID}/${item.modelID}`
}

function legacyModelToCatalogItem(model: ProviderModel, catalog: ProviderCatalogItem[]): ModelCatalogItem {
  const providerName = catalog.find((item) => item.id === model.providerID)?.name ?? model.providerName ?? model.providerID
  return {
    registryID: `${model.providerID}/${model.id}`,
    providerID: model.providerID,
    modelID: model.id,
    name: model.name,
    providerName,
    ...(model.family ? { family: model.family } : {}),
    runtimeKind: "ai-sdk",
    selectable: true,
    available: model.available,
    capabilities: {
      temperature: model.capabilities.temperature,
      reasoning: model.capabilities.reasoning,
      attachment: model.capabilities.attachment,
      toolcall: model.capabilities.toolcall,
      input: model.capabilities.input,
      output: model.capabilities.output,
      taskModes: [],
    },
    status: model.status,
    source: "provider",
  }
}

function modelCatalogFilterMatches(item: ModelCatalogItem, filter: ModelCatalogFilterKey) {
  switch (filter) {
    case "text":
      return item.capabilities.output.text || item.capabilities.input.text
    case "image":
      return item.capabilities.output.image || item.capabilities.input.image
    case "video":
      return item.capabilities.output.video || item.capabilities.input.video
    case "all":
    default:
      return true
  }
}

function buildModelCatalogTags(item: ModelCatalogItem, t: SettingsTranslate) {
  const tags: string[] = []
  if (item.selectable) tags.push(t("settings.models.selectable"))
  if (!item.selectable) tags.push(t("settings.models.readOnly"))
  if (item.capabilities.output.text) tags.push(t("settings.models.filterText"))
  if (item.capabilities.output.image) tags.push(t("settings.models.filterImage"))
  if (item.capabilities.output.video) tags.push(t("settings.models.filterVideo"))
  if (item.capabilities.taskModes.length > 0) {
    tags.push(...item.capabilities.taskModes.slice(0, 2).map(formatModelTaskModeTag))
  }
  return tags
}

function formatModelTaskModeTag(mode: string) {
  return mode
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function ModelCatalogListView({ items, selectionDraft, t }: ModelCatalogListViewProps) {
  return (
    <div className="model-list">
      {items.map((item) => {
        const itemValue = modelCatalogValue(item)

        return (
          <article key={item.registryID} className={item.available ? "model-row" : "model-row is-muted"}>
            <div className="model-row-main">
              <div className="model-row-heading">
                <div>
                  <h4>{item.name}</h4>
                  <p className="model-row-copy">
                    <strong>{item.providerName}</strong>
                    {item.family ? ` / ${item.family}` : ""}
                  </p>
                </div>

                <div className="model-row-statuses">
                  <span className="settings-badge">{getModelStatusLabel(item.status, t)}</span>
                  <span className="settings-badge">{item.available ? t("settings.models.statusVisible") : t("settings.models.statusCatalog")}</span>
                  {item.selectable ? null : <span className="settings-badge">{t("settings.models.readOnly")}</span>}
                  {selectionDraft.model === itemValue ? <span className="settings-badge is-highlight">{t("app.primary")}</span> : null}
                  {selectionDraft.smallModel === itemValue ? <span className="settings-badge is-highlight">{t("app.small")}</span> : null}
                  {selectionDraft.imageModel === itemValue ? <span className="settings-badge is-highlight">{t("settings.models.imageBadge")}</span> : null}
                </div>
              </div>

              <div className="model-row-tags">
                {buildModelCatalogTags(item, t).map((tag) => (
                  <span key={`${item.registryID}-${tag}`} className="settings-badge">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function ModelCatalogView({ filter, items, selectionDraft, onFilterChange, t }: ModelCatalogViewProps) {
  const filteredItems = items.filter((item) => modelCatalogFilterMatches(item, filter))
  const filterOptions: Array<{ value: ModelCatalogFilterKey; label: string }> = [
    { value: "all", label: t("settings.models.filterAll") },
    { value: "text", label: t("settings.models.filterText") },
    { value: "image", label: t("settings.models.filterImage") },
    { value: "video", label: t("settings.models.filterVideo") },
  ]

  return (
    <div className="model-catalog-view">
      <div className="settings-inline-toolbar">
        <SettingsSelect
          ariaLabel={t("settings.models.filterCatalog")}
          options={filterOptions}
          value={filter}
          onChange={(value) => onFilterChange(value as ModelCatalogFilterKey)}
        />
      </div>

      {filteredItems.length > 0 ? (
        <ModelCatalogListView items={filteredItems} selectionDraft={selectionDraft} t={t} />
      ) : (
        <article className="settings-empty-state">
          <span className="label">{t("settings.models.connectedModels")}</span>
          <h3>{t("settings.models.noFilterMatchTitle")}</h3>
        </article>
      )}
    </div>
  )
}

function getMcpTransportLabel(transport: McpServerSummary["transport"] | McpServerDraftState["transport"]) {
  if (transport === "remote") return "http"
  if (transport === "connector") return "connector"
  return "stdio"
}

function doesMcpServerMatchSearch(
  server: McpServerSummary,
  rawQuery: string,
  pluginSource: McpServerPluginSource | null = null,
) {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  const haystack = [
    server.id,
    server.name ?? "",
    getMcpTransportLabel(server.transport),
    server.enabled ? "enabled" : "disabled",
    server.transport === "stdio" ? server.command ?? "" : server.transport === "remote" ? server.serverUrl ?? "" : server.connectorId,
    getMcpServerPluginSourceSearchText(pluginSource),
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(query)
}

type SettingsSectionKey =
  | "general"
  | "account"
  | "subscription"
  | "services"
  | "defaults"
  | "mcp"
  | "appearance"
  | "developer"
  | "storage"
  | "archive"
type ProviderCapabilityFilterKey = "all" | "text" | "image" | "video" | "connected"
type ProviderDetailKind = "model" | "cinema"

interface ProviderCapabilitySummary {
  text: boolean
  image: boolean
  video: boolean
}

type ProviderSettingsListItem =
  | {
      key: string
      kind: "model"
      id: string
      provider: ProviderCatalogItem
      connected: boolean
      capabilities: ProviderCapabilitySummary
    }
  | {
      key: string
      kind: "cinema"
      id: string
      provider: CinemaVideoProvider
      connected: boolean
      capabilities: ProviderCapabilitySummary
    }

function doesArchivedSessionMatchSearch(session: ArchivedSessionSummary, query: string) {
  if (!query) return true

  const haystack = [
    session.title,
    session.projectName,
    session.projectID,
    session.directory,
    session.id,
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase()

  return haystack.includes(query)
}

const storagePathItems: Array<{
  key: keyof DesktopStoragePaths
  label: string
  description: string
}> = [
  {
    key: "appData",
    label: "Application data",
    description: "Electron settings, UI preferences, and desktop-managed files.",
  },
  {
    key: "agentRoot",
    label: "Agent root",
    description: "Managed agent home directory used by the desktop app.",
  },
  {
    key: "agentData",
    label: "Agent data",
    description: "Agent database-adjacent data, plugin records, and durable state.",
  },
  {
    key: "installedPlugins",
    label: "Installed plugins",
    description: "Downloaded plugin package folders.",
  },
  {
    key: "pluginRegistryCache",
    label: "Plugin registry cache",
    description: "Cached plugin catalog metadata.",
  },
  {
    key: "agentCache",
    label: "Agent cache",
    description: "Runtime caches and re-downloadable temporary data.",
  },
  {
    key: "pluginInstallTemp",
    label: "Plugin install temp",
    description: "Temporary plugin zip extraction directory.",
  },
]

function getStorageCategoryLabel(t: (key: TranslationKey, params?: Record<string, string | number>) => string, id: DesktopStorageUsageSnapshot["categories"][number]["id"]) {
  switch (id) {
    case "archivedSessions":
      return t("settings.storage.category.archivedSessions")
    case "activeSessions":
      return t("settings.storage.category.activeSessions")
    case "otherDatabase":
      return t("settings.storage.category.otherDatabase")
    case "sqliteOverhead":
      return t("settings.storage.category.sqliteOverhead")
  }
}

function getStorageTableCategoryLabel(t: (key: TranslationKey, params?: Record<string, string | number>) => string, category: DesktopStorageUsageSnapshot["tables"][number]["category"]) {
  switch (category) {
    case "archivedSessions":
      return t("settings.storage.category.archivedSessions")
    case "activeSessions":
      return t("settings.storage.category.activeSessions")
    case "otherDatabase":
      return t("settings.storage.category.otherDatabase")
  }
}

const SETTINGS_PAGE_DRAG_MARGIN = 16

interface SettingsPageOffset {
  x: number
  y: number
}

interface SettingsPageDragBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface SettingsPageDragState {
  bounds: SettingsPageDragBounds
  pointerID: number
  startClientX: number
  startClientY: number
  startOffset: SettingsPageOffset
}

function resolveSettingsPageDragBounds(
  overlayRect: DOMRect,
  pageRect: DOMRect,
  currentOffset: SettingsPageOffset,
): SettingsPageDragBounds {
  const leftLimit = currentOffset.x + overlayRect.left + SETTINGS_PAGE_DRAG_MARGIN - pageRect.left
  const rightLimit = currentOffset.x + overlayRect.right - SETTINGS_PAGE_DRAG_MARGIN - pageRect.right
  const topLimit = currentOffset.y + overlayRect.top + SETTINGS_PAGE_DRAG_MARGIN - pageRect.top
  const bottomLimit = currentOffset.y + overlayRect.bottom - SETTINGS_PAGE_DRAG_MARGIN - pageRect.bottom

  return {
    minX: Math.min(leftLimit, rightLimit),
    maxX: Math.max(leftLimit, rightLimit),
    minY: Math.min(topLimit, bottomLimit),
    maxY: Math.max(topLimit, bottomLimit),
  }
}

function clampSettingsPageOffset(offset: SettingsPageOffset, bounds: SettingsPageDragBounds): SettingsPageOffset {
  return {
    x: clamp(offset.x, bounds.minX, bounds.maxX),
    y: clamp(offset.y, bounds.minY, bounds.maxY),
  }
}

function shouldIgnoreSettingsDragTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false

  return Boolean(target.closest("button, a, input, select, textarea, [role='button']"))
}

interface SettingsDisclosurePanelProps {
  children: ReactNode
  defaultOpen?: boolean
  description: string
  label: string
  panelID: string
  title: string
}

function SettingsDisclosurePanel({
  children,
  defaultOpen = false,
  description,
  label,
  panelID,
  title,
}: SettingsDisclosurePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const bodyID = `${panelID}-body`

  return (
    <section className={isOpen ? "settings-panel settings-disclosure-panel is-open" : "settings-panel settings-disclosure-panel"}>
      <button
        className="settings-disclosure-summary"
        type="button"
        aria-controls={bodyID}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="settings-disclosure-copy">
          <span className="settings-disclosure-label">{label}</span>
          <span className="settings-disclosure-title">{title}</span>
          <span className="settings-disclosure-description">{description}</span>
        </span>
        <span className="settings-disclosure-chevron" aria-hidden="true">
          <ChevronDownIcon />
        </span>
      </button>

      {isOpen ? (
        <div id={bodyID} className="settings-disclosure-body">
          {children}
        </div>
      ) : null}
    </section>
  )
}

interface SettingsPageProps {
  activeMcpServerID: string | null
  activeMcpServerDiagnostic: McpServerDiagnostic | null
  appearanceConfigError: string | null
  appearanceConfigPath: string | null
  appearanceConfigPreview: string
  appearanceOverrides: AppearanceTokenMap
  appearanceThemeError?: string | null
  appearanceThemes?: readonly AppearanceTheme[]
  activeAppearanceThemeID?: string
  appearanceTokenValues: Record<AppearanceTokenName, string>
  assistantTraceVisibility: AssistantTraceVisibility
  archivedSessions: ArchivedSessionSummary[]
  archivedSessionsError: string | null
  storageUsage: DesktopStorageUsageSnapshot | null
  storageUsageError: string | null
  catalog: ProviderCatalogItem[]
  cinemaVideoProviders: CinemaVideoProvider[]
  deletingArchivedSessionID: string | null
  deletingMcpServerID: string | null
  deletingProviderID: string | null
  colorMode: ColorMode
  fontFamily: AppearanceFontFamily
  htmlBackgroundConfig: HtmlBackgroundConfig
  isActivityRailVisible: boolean
  isAgentDebugTraceEnabled: boolean
  isDebugLineColorsEnabled: boolean
  isDebugUiRegionsEnabled: boolean
  isMobileConnectionAdvancedInfoEnabled: boolean
  isDeletingAllArchivedSessions: boolean
  isLoading: boolean
  isLoadingArchivedSessions: boolean
  isLoadingStorageUsage: boolean
  isOpen: boolean
  appUpdateState: DesktopAppUpdateState | null
  appUpdateStatus: AppUpdateStatus | null
  isCheckingAppUpdate: boolean
  isSavingAutomaticUpdates: boolean
  isRefreshingProviderCatalog: boolean
  isRefreshingCinemaVideoProviderCatalog: boolean
  loadError: string | null
  installedPlugins?: InstalledPlugin[]
  mcpServerDraft: McpServerDraftState
  mcpServers: McpServerSummary[]
  modelCatalog: ModelCatalogItem[]
  models: ProviderModel[]
  pluginCatalog?: PluginCatalogItem[]
  providerDrafts: Record<string, ProviderDraftState>
  cinemaVideoProviderDrafts: Record<string, CinemaVideoProviderDraftState>
  customProviderDraft: CustomProviderDraftState
  restoringArchivedSessionID: string | null
  savingMcpServerID: string | null
  savingProviderID: string | null
  savingCinemaVideoProviderID: string | null
  testingProviderID: string | null
  selectionDraft: ProjectModelSelection
  onColorModeChange: (mode: ColorMode) => void
  onFontFamilyChange: (fontFamily: AppearanceFontFamily) => void
  onHtmlBackgroundConfigChange: (config: HtmlBackgroundConfig) => void
  onActivityRailVisibilityChange: (value: boolean) => void
  onAppearancePaletteReset: () => void
  onAppearanceThemeApply?: (themeID: string) => void | Promise<void>
  onAppearanceThemeDelete?: (themeID: string) => void | Promise<void>
  onAppearanceThemeDuplicate?: (themeID: string, name?: string) => Promise<AppearanceTheme | null>
  onAppearanceThemeRename?: (themeID: string, name: string) => Promise<AppearanceTheme | null>
  onAppearanceThemeSaveCurrent?: (name: string) => Promise<AppearanceTheme | null>
  onAppearanceTokenChange: (tokenName: AppearanceTokenName, value: string) => void
  onAppearanceTokenReset: (tokenName: AppearanceTokenName) => void
  onAssistantTraceVisibilityChange: (key: AssistantTraceVisibilityKey, value: boolean) => void
  onAgentDebugTraceChange: (value: boolean) => void
  onDebugLineColorsChange: (value: boolean) => void
  onDebugUiRegionsChange: (value: boolean) => void
  onMobileConnectionAdvancedInfoChange: (value: boolean) => void
  onAutomaticUpdatesToggle: () => void
  onCheckForUpdates: () => void
  onClose: () => void
  onDeleteAllArchivedSessions: (sessionIDs: string[]) => boolean | Promise<boolean>
  onDeleteArchivedSession: (sessionID: string) => boolean | Promise<boolean>
  onDeleteMcpServer: (serverID: string) => void | Promise<void>
  onDeleteProvider: (providerID: string) => void | Promise<void>
  onDeleteProviderAuthSession: (providerID: string) => boolean | Promise<boolean>
  onMcpServerDraftChange: (field: keyof McpServerDraftState, value: string | boolean) => void
  onMcpToolPolicyChange: (toolName: string, policy: McpToolPolicyValue) => void
  onMcpServerSelect: (serverID: string) => void
  onProviderAuthMethodChange: (providerID: string, method: string) => void
  onProviderDraftChange: (
    providerID: string,
    field: "apiKey" | "baseURL",
    value: string,
  ) => void
  onCinemaVideoProviderDraftChange: (
    providerID: string,
    field: "apiKey" | "baseURL",
    value: string,
  ) => void
  onCustomProviderDraftChange: (field: keyof CustomProviderDraftState, value: string) => void
  onCustomProviderDraftReset: (draft?: CustomProviderDraftState) => void
  onRefreshProviderCatalog: () => boolean | Promise<boolean>
  onRefreshCinemaVideoProviderCatalog: () => boolean | Promise<boolean>
  onLoadArchivedSessions: () => void | Promise<void>
  onLoadStorageUsage: () => void | Promise<void>
  onOpenUpdateCenter: () => void
  onRestoreArchivedSession: (sessionID: string) => boolean | Promise<boolean>
  onSaveMcpServer: () => boolean | Promise<boolean>
  onSaveProviderApiKey: (providerID: string, apiKey?: string | null) => boolean | Promise<boolean>
  onSaveCinemaVideoProviderApiKey: (providerID: string, apiKey?: string | null) => boolean | Promise<boolean>
  onSaveProvider: (providerID: string) => boolean | Promise<boolean>
  onSaveCustomProvider: (providerID?: string) => boolean | Promise<boolean>
  onSelectionChange: <K extends keyof ProjectModelSelection>(field: K, value: ProjectModelSelection[K]) => void
  onTestProviderConnection: (
    providerID: string,
    input?: {
      method?: string
      credentialMode?: "active" | "manual" | "environment"
      apiKey?: string | null
      baseURL?: string | null
    },
  ) => boolean | Promise<boolean>
  onTestCinemaVideoProviderConnection: (providerID: string) => boolean | Promise<boolean>
  onTestCustomProviderConnection: (providerID?: string) => boolean | Promise<boolean>
  onStartProviderAuthFlow: (
    providerID: string,
    options?: { prompt?: DesktopProviderAuthPrompt },
  ) => boolean | Promise<boolean>
  onStartNewMcpServer: () => void
  onCancelProviderAuthFlow: (providerID: string) => boolean | Promise<boolean>
}

export function SettingsPage({
  activeMcpServerID,
  activeMcpServerDiagnostic,
  appearanceConfigError,
  appearanceConfigPath,
  appearanceConfigPreview,
  appearanceOverrides,
  appearanceThemeError,
  appearanceThemes,
  activeAppearanceThemeID,
  appearanceTokenValues,
  assistantTraceVisibility,
  archivedSessions,
  archivedSessionsError,
  storageUsage,
  storageUsageError,
  catalog,
  cinemaVideoProviders,
  deletingArchivedSessionID,
  deletingMcpServerID,
  deletingProviderID,
  colorMode,
  fontFamily,
  htmlBackgroundConfig,
  isActivityRailVisible,
  isAgentDebugTraceEnabled,
  isDebugLineColorsEnabled,
  isDebugUiRegionsEnabled,
  isMobileConnectionAdvancedInfoEnabled,
  isDeletingAllArchivedSessions,
  isLoading,
  isLoadingArchivedSessions,
  isLoadingStorageUsage,
  isOpen,
  appUpdateState,
  isCheckingAppUpdate,
  isSavingAutomaticUpdates,
  isRefreshingProviderCatalog,
  isRefreshingCinemaVideoProviderCatalog,
  loadError,
  installedPlugins = [],
  mcpServerDraft,
  mcpServers,
  modelCatalog,
  models,
  pluginCatalog = [],
  providerDrafts,
  cinemaVideoProviderDrafts,
  customProviderDraft,
  restoringArchivedSessionID,
  savingMcpServerID,
  savingProviderID,
  savingCinemaVideoProviderID,
  testingProviderID,
  selectionDraft,
  onColorModeChange,
  onFontFamilyChange,
  onHtmlBackgroundConfigChange,
  onActivityRailVisibilityChange,
  onAppearancePaletteReset,
  onAppearanceThemeApply,
  onAppearanceThemeDelete,
  onAppearanceThemeDuplicate,
  onAppearanceThemeRename,
  onAppearanceThemeSaveCurrent,
  onAppearanceTokenChange,
  onAppearanceTokenReset,
  onAssistantTraceVisibilityChange,
  onAgentDebugTraceChange,
  onDebugLineColorsChange,
  onDebugUiRegionsChange,
  onMobileConnectionAdvancedInfoChange,
  onAutomaticUpdatesToggle,
  onCheckForUpdates,
  onClose,
  onDeleteAllArchivedSessions,
  onDeleteArchivedSession,
  onDeleteMcpServer,
  onDeleteProvider,
  onDeleteProviderAuthSession,
  onMcpServerDraftChange,
  onMcpToolPolicyChange,
  onMcpServerSelect,
  onProviderAuthMethodChange,
  onProviderDraftChange,
  onCinemaVideoProviderDraftChange,
  onCustomProviderDraftChange,
  onCustomProviderDraftReset,
  onRefreshProviderCatalog,
  onRefreshCinemaVideoProviderCatalog,
  onLoadArchivedSessions,
  onLoadStorageUsage,
  onOpenUpdateCenter,
  onRestoreArchivedSession,
  onSaveMcpServer,
  onSaveProviderApiKey,
  onSaveCinemaVideoProviderApiKey,
  onSaveProvider,
  onSaveCustomProvider,
  onSelectionChange,
  onTestCinemaVideoProviderConnection,
  onTestProviderConnection,
  onTestCustomProviderConnection,
  onStartProviderAuthFlow,
  onStartNewMcpServer,
  onCancelProviderAuthFlow,
}: SettingsPageProps) {
  {
    const { error: localeError, locale, setLocale, t } = useI18n()
    const [activeSection, setActiveSection] = useState<SettingsSectionKey>("general")
    const [storagePaths, setStoragePaths] = useState<DesktopStoragePaths | null>(null)
    const [storagePathStatus, setStoragePathStatus] = useState<AppUpdateStatus | null>(null)
    const [selectedProviderID, setSelectedProviderID] = useState<string | null>(null)
    const [archivedSessionSearchQuery, setArchivedSessionSearchQuery] = useState("")
    const [providerSearch, setProviderSearch] = useState("")
    const [providerCapabilityFilter, setProviderCapabilityFilter] = useState<ProviderCapabilityFilterKey>("all")
    const [selectedProviderKind, setSelectedProviderKind] = useState<ProviderDetailKind | null>(null)
    const [modelCatalogFilter, setModelCatalogFilter] = useState<ModelCatalogFilterKey>("all")
    const [isCustomProviderDialogOpen, setIsCustomProviderDialogOpen] = useState(false)
    const [editingCustomProviderID, setEditingCustomProviderID] = useState<string | null>(null)
    const [mcpServerSearchQuery, setMcpServerSearchQuery] = useState("")
    const [selectedVideoProviderID, setSelectedVideoProviderID] = useState<string | null>(null)
    const [providerApiKeyModes, setProviderApiKeyModes] = useState<Record<string, ProviderApiKeyMode>>({})
    const [visibleProviderApiKeys, setVisibleProviderApiKeys] = useState<Record<string, boolean>>({})
    const settingsOverlayRef = useRef<HTMLElement | null>(null)
    const settingsPageRef = useRef<HTMLDivElement | null>(null)
    const settingsMainRef = useRef<HTMLDivElement | null>(null)
    const settingsMainTopAnchorRef = useRef<HTMLDivElement | null>(null)
    const serviceDetailPanelRef = useRef<HTMLDivElement | null>(null)
    const settingsPageOffsetRef = useRef<SettingsPageOffset>({ x: 0, y: 0 })
    const settingsPageDragRef = useRef<SettingsPageDragState | null>(null)
    const [settingsPageOffset, setSettingsPageOffset] = useState<SettingsPageOffset>({ x: 0, y: 0 })
    const [isSettingsPageDragging, setIsSettingsPageDragging] = useState(false)
    const enabledTraceVisibilityCount = assistantTraceVisibilityOptions.filter(
      (option) => assistantTraceVisibility[option.key],
    ).length

    const modelGroups = useMemo(() => models.reduce<Record<string, ProviderModel[]>>((result, model) => {
      result[model.providerID] = [...(result[model.providerID] ?? []), model]
      return result
    }, {}), [models])
    const connectedProviderIDs = useMemo(
      () => new Set(catalog.filter((item) => item.available).map((item) => item.id)),
      [catalog],
    )
    const visibleModels = useMemo(
      () => models.filter((model) => model.available && connectedProviderIDs.has(model.providerID)),
      [connectedProviderIDs, models],
    )
    const visibleImageModels = useMemo(
      () => visibleModels.filter((model) => model.capabilities.output.image),
      [visibleModels],
    )
    const effectiveModelCatalog = useMemo(
      () => modelCatalog.length > 0
        ? modelCatalog
        : visibleModels.map((model) => legacyModelToCatalogItem(model, catalog)),
      [catalog, modelCatalog, visibleModels],
    )
    const catalogModelGroups = useMemo(() => effectiveModelCatalog.reduce<Record<string, ModelCatalogItem[]>>((result, model) => {
      if (model.source !== "provider") return result
      result[model.providerID] = [...(result[model.providerID] ?? []), model]
      return result
    }, {}), [effectiveModelCatalog])
    const filteredProviderItems = useMemo<ProviderSettingsListItem[]>(() => {
      const filteredCatalog = getVisibleProvidersForSettings(catalog, providerSearch)
      const filteredCinemaVideoProviders = getVisibleCinemaVideoProvidersForSettings(cinemaVideoProviders, providerSearch)

      return [
        ...filteredCatalog.map((provider): ProviderSettingsListItem => ({
          key: `model:${provider.id}`,
          kind: "model",
          id: provider.id,
          provider,
          connected: isProviderConnected(provider),
          capabilities: getModelCatalogProviderCapabilities(catalogModelGroups[provider.id] ?? []),
        })),
        ...filteredCinemaVideoProviders.map((provider): ProviderSettingsListItem => ({
          key: `cinema:${provider.manifest.id}`,
          kind: "cinema",
          id: provider.manifest.id,
          provider,
          connected: provider.auth.connected || !provider.auth.requiresCredential,
          capabilities: getCinemaProviderCapabilities(provider),
        })),
      ].filter((item) => doesProviderCapabilityMatchFilter(item, providerCapabilityFilter))
    }, [catalog, catalogModelGroups, cinemaVideoProviders, providerCapabilityFilter, providerSearch])
    const mcpServerPluginSourceMap = useMemo(
      () => buildMcpServerPluginSourceMap(installedPlugins, pluginCatalog),
      [installedPlugins, pluginCatalog],
    )
    const filteredMcpServers = mcpServers.filter((server) => doesMcpServerMatchSearch(
      server,
      mcpServerSearchQuery,
      getMcpServerPluginSource(server, mcpServerPluginSourceMap),
    ))
    const normalizedArchivedSessionSearchQuery = archivedSessionSearchQuery.trim().toLocaleLowerCase()
    const filteredArchivedSessions = archivedSessions.filter((session) =>
      doesArchivedSessionMatchSearch(session, normalizedArchivedSessionSearchQuery),
    )
    const storageCategoryByID = new Map(storageUsage?.categories.map((category) => [category.id, category]) ?? [])
    const largestArchivedSessionUsage = storageUsage ? sortArchivedSessionUsage(storageUsage.archivedSessions).slice(0, 8) : []
    const storageTables = storageUsage ? sortStorageTables(storageUsage.tables) : []
    const storageSummaryItems = storageUsage
      ? [
          {
            key: "database",
            label: t("settings.storage.summary.database"),
            value: formatStorageBytes(storageUsage.database.totalBytes),
            detail: t("settings.storage.summary.databaseCopy"),
            approximate: false,
          },
          {
            key: "archived",
            label: t("settings.storage.summary.archived"),
            value: formatStorageBytes(storageCategoryByID.get("archivedSessions")?.bytes ?? 0),
            detail: t("settings.storage.summary.archivedCopy", {
              count: storageCategoryByID.get("archivedSessions")?.count ?? 0,
            }),
            approximate: true,
          },
          {
            key: "active",
            label: t("settings.storage.summary.active"),
            value: formatStorageBytes(storageCategoryByID.get("activeSessions")?.bytes ?? 0),
            detail: t("settings.storage.summary.activeCopy", {
              count: storageCategoryByID.get("activeSessions")?.count ?? 0,
            }),
            approximate: true,
          },
          {
            key: "other",
            label: t("settings.storage.summary.other"),
            value: formatStorageBytes(storageCategoryByID.get("otherDatabase")?.bytes ?? 0),
            detail: t("settings.storage.summary.otherCopy"),
            approximate: true,
          },
          {
            key: "free",
            label: t("settings.storage.summary.reclaimable"),
            value: storageUsage.database.freelistBytes === null
              ? t("settings.storage.unknown")
              : formatStorageBytes(storageUsage.database.freelistBytes),
            detail: t("settings.storage.summary.reclaimableCopy"),
            approximate: false,
          },
        ]
      : []
    const activeProvider = selectedProviderKind === "model" && selectedProviderID
      ? catalog.find((item) => item.id === selectedProviderID) ?? null
      : null
    const activeCinemaVideoProvider = selectedProviderKind === "cinema" && selectedVideoProviderID
      ? cinemaVideoProviders.find((item) => item.manifest.id === selectedVideoProviderID) ?? null
      : null
    const isEditingCustomProvider = editingCustomProviderID !== null
    const customProviderBusy = savingProviderID === "custom" || testingProviderID === "custom"
    const customProviderCanSubmit =
      customProviderDraft.apiBaseURL.trim().length > 0 &&
      (customProviderDraft.apiKey.trim().length > 0 || isEditingCustomProvider) &&
      customProviderDraft.defaultModel.trim().length > 0 &&
      customProviderDraft.chatEndpoint.trim().length > 0
    const activeProviderDraft = activeProvider
      ? (providerDrafts[activeProvider.id] ?? {
          apiKey: "",
          baseURL: activeProvider.baseURL ?? "",
          selectedAuthMethod: activeProvider.authState.activeMethod ?? activeProvider.authCapabilities[0]?.method ?? null,
          activeFlow: activeProvider.authState.flow ?? null,
        })
      : null
    const anyboxAccountProvider = catalog.find(isAnyboxProvider) ?? null
    const anyboxAccountDraft = anyboxAccountProvider
      ? (providerDrafts[anyboxAccountProvider.id] ?? {
          apiKey: "",
          baseURL: anyboxAccountProvider.baseURL ?? "",
          selectedAuthMethod:
            anyboxAccountProvider.authState.activeMethod ?? anyboxAccountProvider.authCapabilities[0]?.method ?? null,
          activeFlow: anyboxAccountProvider.authState.flow ?? null,
        })
      : null
    const anyboxAccountView = getAnyboxAccountViewModel(anyboxAccountProvider, anyboxAccountDraft, t)
    const anyboxAccountBusy = anyboxAccountProvider
      ? savingProviderID === anyboxAccountProvider.id || deletingProviderID === anyboxAccountProvider.id
      : false
    const anyboxAccountBalance = anyboxAccountProvider ? formatProviderBalance(anyboxAccountView.account ?? undefined) : null
    const anyboxAccountPlanLabel = formatProviderPlanLabel(anyboxAccountView.account ?? undefined)
    const anyboxAccountRechargeUrl = anyboxAccountProvider ? getAnyboxRechargeUrl(anyboxAccountProvider) : null
    const activeProviderModels = activeProvider ? catalogModelGroups[activeProvider.id] ?? [] : []
    const activeProviderBusy = activeProvider ? savingProviderID === activeProvider.id || deletingProviderID === activeProvider.id : false
    const activeCinemaVideoProviderID = activeCinemaVideoProvider?.manifest.id ?? null
    const activeCinemaVideoProviderDraft = activeCinemaVideoProviderID
      ? (cinemaVideoProviderDrafts[activeCinemaVideoProviderID] ?? { apiKey: "", baseURL: "" })
      : null
    const activeCinemaVideoProviderBusy = activeCinemaVideoProviderID
      ? savingCinemaVideoProviderID === activeCinemaVideoProviderID
      : false
    const activeCinemaVideoProviderIsTesting = activeCinemaVideoProviderID
      ? testingProviderID === `cinema-video:${activeCinemaVideoProviderID}`
      : false
    const activeCinemaVideoProviderCanTest = Boolean(activeCinemaVideoProvider?.manifest.connectionTest)
    const activeCinemaVideoProviderConfiguredBaseURL = activeCinemaVideoProvider?.runtime?.configuredBaseURL ?? ""
    const activeCinemaVideoProviderEndpoint = activeCinemaVideoProvider?.runtime?.baseURL ?? ""
    const activeCinemaVideoProviderEndpointSource = activeCinemaVideoProvider
      ? getCinemaVideoProviderEndpointSourceText(activeCinemaVideoProvider, t)
      : ""
    const activeCinemaVideoProviderApiKeyDirty = (activeCinemaVideoProviderDraft?.apiKey.trim().length ?? 0) > 0
    const activeCinemaVideoProviderBaseURLDirty =
      (activeCinemaVideoProviderDraft?.baseURL.trim() ?? "") !== activeCinemaVideoProviderConfiguredBaseURL
    const activeCinemaVideoProviderCanSave =
      activeCinemaVideoProviderApiKeyDirty || activeCinemaVideoProviderBaseURLDirty
    const activeProviderSelectedMethod =
      activeProviderDraft?.selectedAuthMethod ?? activeProvider?.authState.activeMethod ?? activeProvider?.authCapabilities[0]?.method ?? null
    const activeProviderSelectedCapability = activeProvider
      ? getProviderAuthCapability(activeProvider, activeProviderSelectedMethod)
      : null
    const activeProviderApiKeyCapability =
      activeProvider?.authCapabilities.find((capability) => capability.kind === "api_key") ?? null
    const activeProviderFlow = activeProviderDraft?.activeFlow ?? activeProvider?.authState.flow ?? null
    const activeProviderConfigDirty = activeProvider
      ? (activeProviderDraft?.baseURL.trim() ?? "") !== (activeProvider.baseURL ?? "")
      : false
    const activeProviderApiKeyDirty =
      activeProviderSelectedCapability?.kind === "api_key" ? (activeProviderDraft?.apiKey.trim().length ?? 0) > 0 : false
    const activeProviderApiKeyMode = activeProvider
      ? providerApiKeyModes[activeProvider.id] ?? getProviderApiKeyMode(activeProvider)
      : "manual"
    const activeProviderUsesEnvironment =
      activeProviderSelectedCapability?.kind === "api_key" &&
      activeProviderApiKeyMode === "environment" &&
      Boolean(activeProvider?.env.length)
    const activeProviderApiKeyVisible = activeProvider ? Boolean(visibleProviderApiKeys[activeProvider.id]) : false
    const activeProviderCredentialModeDirty = Boolean(
      activeProvider &&
        activeProviderSelectedCapability?.kind === "api_key" &&
        activeProviderApiKeyMode === "environment" &&
        hasStoredProviderApiKey(activeProvider),
    )
    const activeProviderCanSave =
      activeProviderConfigDirty || activeProviderApiKeyDirty || activeProviderCredentialModeDirty
    const activeProviderIsTesting = activeProvider ? testingProviderID === activeProvider.id : false
    const activeProviderAccountSummary =
      activeProvider?.authState.account?.label ??
      activeProvider?.authState.account?.email ??
      activeProvider?.authState.account?.workspaceName ??
      null
    const activeProviderAccount = activeProvider?.authState.account ?? null
    const activeProviderBalance = activeProvider ? formatProviderBalance(activeProvider.authState.account) : null
    const activeMcpServer = activeMcpServerID ? mcpServers.find((server) => server.id === activeMcpServerID) ?? null : null
    const activeMcpServerPluginSource = activeMcpServer
      ? getMcpServerPluginSource(activeMcpServer, mcpServerPluginSourceMap)
      : null
    const mcpServerBusyID = activeMcpServerID ?? mcpServerDraft.id.trim() ?? null
    const mcpServerBusy = Boolean(
      (mcpServerBusyID && savingMcpServerID === mcpServerBusyID) ||
      (mcpServerBusyID && deletingMcpServerID === mcpServerBusyID),
    )
    const mcpServerValidationError = !mcpServerDraft.id.trim()
      ? t("mcp.validation.requireId")
      : mcpServerDraft.transport === "stdio"
        ? !mcpServerDraft.command.trim()
          ? t("mcp.validation.requireCommand")
          : null
        : mcpServerDraft.transport === "remote"
          ? !mcpServerDraft.serverUrl.trim()
            ? t("mcp.validation.requireUrl")
            : (mcpServerDraft.allowedToolsMode === "names" || mcpServerDraft.allowedToolsMode === "read-only-names") &&
                !mcpServerDraft.allowedToolNames.trim()
              ? t("mcp.validation.requireToolNames")
              : null
          : !mcpServerDraft.connectorId.trim()
            ? t("mcp.validation.requireConnectorId")
            : null
    const mcpServerCanSave = !mcpServerValidationError
    const showLoadedState = !isLoading && !loadError
    const showProviderSections = activeSection === "services" || activeSection === "defaults" || activeSection === "mcp"
    const useServiceSettingsChrome = activeSection === "services"
    const appVersionNumber = appUpdateState?.version ?? "..."
    const appVersionLabel = `${t("settings.about.version")} ${appVersionNumber}`
    const automaticUpdatesEnabled = appUpdateState?.automaticUpdates ?? true
    const aboutUpdateActionLabel = shouldOpenUpdateCenterOnly(appUpdateState)
      ? t("settings.about.openUpdateCenter")
      : isCheckingAppUpdate
        ? t("settings.about.checkingUpdates")
        : t("settings.about.checkUpdates")

    function handleAboutUpdateAction() {
      if (shouldOpenUpdateCenterOnly(appUpdateState)) {
        onOpenUpdateCenter()
        return
      }

      onCheckForUpdates()
    }

    function handleDeleteAllArchivedSessionsClick() {
      const targetSessionIDs = archivedSessions.map((session) => session.id)
      if (
        isDeletingAllArchivedSessions ||
        restoringArchivedSessionID !== null ||
        deletingArchivedSessionID !== null ||
        targetSessionIDs.length === 0
      ) {
        return
      }
      if (
        typeof window.confirm === "function" &&
        !window.confirm(t("settings.archive.confirmDeleteAll", { count: targetSessionIDs.length }))
      ) {
        return
      }

      void onDeleteAllArchivedSessions(targetSessionIDs)
    }

    useEffect(() => {
      if (!isOpen) {
        setActiveSection("general")
        setSelectedProviderID(null)
        setSelectedVideoProviderID(null)
        setSelectedProviderKind(null)
        setArchivedSessionSearchQuery("")
        setProviderSearch("")
        setProviderCapabilityFilter("all")
      }
    }, [isOpen])

    useEffect(() => {
      if (!isOpen || activeSection !== "archive") return

      void onLoadArchivedSessions()
    }, [activeSection, isOpen, onLoadArchivedSessions])

    useEffect(() => {
      if (!isOpen || activeSection !== "storage" || storageUsage || isLoadingStorageUsage) return

      void onLoadStorageUsage()
    }, [activeSection, isLoadingStorageUsage, isOpen, onLoadStorageUsage, storageUsage])

    useLayoutEffect(() => {
      if (!isOpen) return

      scrollSettingsMainToTop()
    }, [activeSection, isOpen])

    useEffect(() => {
      if (!isOpen) return

      return scheduleSettingsMainScrollReset()
    }, [activeSection, isOpen])

    useEffect(() => {
      if (!isOpen || activeSection !== "developer" || !storagePaths) return

      return scheduleSettingsMainScrollReset()
    }, [activeSection, isOpen, storagePaths])

    useEffect(() => {
      if (!isOpen || activeSection !== "developer" || storagePaths) return

      let disposed = false
      void getStoragePaths()
        .then((paths) => {
          if (disposed || !paths) return
          setStoragePaths(paths)
        })
        .catch((error: unknown) => {
          if (disposed) return
          const message = error instanceof Error ? error.message : String(error)
          setStoragePathStatus({
            tone: "error",
            text: `Unable to load storage paths. ${message}`,
          })
        })

      return () => {
        disposed = true
      }
    }, [activeSection, isOpen, storagePaths])

    useEffect(() => {
      if (activeSection !== "services") return

      if (filteredProviderItems.length === 0) {
        if (selectedProviderKind !== null || selectedProviderID !== null || selectedVideoProviderID !== null) {
          setSelectedProviderKind(null)
          setSelectedProviderID(null)
          setSelectedVideoProviderID(null)
        }
        return
      }

      const hasSelection = filteredProviderItems.some((item) =>
        item.kind === selectedProviderKind &&
        (item.kind === "model" ? item.id === selectedProviderID : item.id === selectedVideoProviderID),
      )
      if (hasSelection) return

      const nextProvider = filteredProviderItems[0]
      setSelectedProviderKind(nextProvider.kind)
      if (nextProvider.kind === "model") {
        setSelectedProviderID(nextProvider.id)
        setSelectedVideoProviderID(null)
      } else {
        setSelectedVideoProviderID(nextProvider.id)
        setSelectedProviderID(null)
      }
    }, [activeSection, filteredProviderItems, selectedProviderID, selectedProviderKind, selectedVideoProviderID])

    useEffect(() => {
      if (activeSection !== "services") return
      if (!serviceDetailPanelRef.current) return

      if (typeof serviceDetailPanelRef.current.scrollTo === "function") {
        serviceDetailPanelRef.current.scrollTo({ top: 0 })
      } else {
        serviceDetailPanelRef.current.scrollTop = 0
      }
    }, [activeSection, selectedProviderID, selectedProviderKind, selectedVideoProviderID])

    useEffect(() => {
      if (isOpen) return

      settingsPageDragRef.current = null
      setIsSettingsPageDragging(false)
    }, [isOpen])

    useEffect(() => {
      if (!isOpen) return

      function handleWindowResize() {
        clampSettingsPageIntoOverlay()
      }

      handleWindowResize()
      window.addEventListener("resize", handleWindowResize)
      return () => window.removeEventListener("resize", handleWindowResize)
    }, [isOpen])

    useEffect(() => {
      if (!isSettingsPageDragging) return

      function handleWindowPointerMove(event: globalThis.PointerEvent) {
        const dragState = settingsPageDragRef.current
        if (!dragState || event.pointerId !== dragState.pointerID) return

        event.preventDefault()
        updateSettingsPageOffset(
          clampSettingsPageOffset(
            {
              x: dragState.startOffset.x + event.clientX - dragState.startClientX,
              y: dragState.startOffset.y + event.clientY - dragState.startClientY,
            },
            dragState.bounds,
          ),
        )
      }

      function stopSettingsPageDrag(pointerID?: number) {
        const dragState = settingsPageDragRef.current
        if (dragState && typeof pointerID === "number" && pointerID !== dragState.pointerID) return

        settingsPageDragRef.current = null
        setIsSettingsPageDragging(false)
      }

      function handleWindowPointerStop(event: globalThis.PointerEvent) {
        stopSettingsPageDrag(event.pointerId)
      }

      function handleWindowBlur() {
        stopSettingsPageDrag()
      }

      document.body.classList.add("is-dragging-settings-page")
      window.addEventListener("pointermove", handleWindowPointerMove)
      window.addEventListener("pointerup", handleWindowPointerStop)
      window.addEventListener("pointercancel", handleWindowPointerStop)
      window.addEventListener("blur", handleWindowBlur)
      return () => {
        document.body.classList.remove("is-dragging-settings-page")
        window.removeEventListener("pointermove", handleWindowPointerMove)
        window.removeEventListener("pointerup", handleWindowPointerStop)
        window.removeEventListener("pointercancel", handleWindowPointerStop)
        window.removeEventListener("blur", handleWindowBlur)
      }
    }, [isSettingsPageDragging])

    if (!isOpen) return null

    function updateSettingsPageOffset(nextOffset: SettingsPageOffset) {
      settingsPageOffsetRef.current = nextOffset
      setSettingsPageOffset((currentOffset) =>
        currentOffset.x === nextOffset.x && currentOffset.y === nextOffset.y ? currentOffset : nextOffset,
      )
    }

    function scrollSettingsMainToTop() {
      scrollElementToTop(settingsOverlayRef.current)
      scrollElementToTop(settingsPageRef.current)
      scrollElementToTop(settingsMainRef.current)

      if (typeof settingsMainTopAnchorRef.current?.scrollIntoView === "function") {
        settingsMainTopAnchorRef.current.scrollIntoView({ block: "start", inline: "nearest" })
      }
    }

    function scrollElementToTop(element: HTMLElement | null) {
      if (!element) return

      if (typeof element.scrollTo === "function") {
        element.scrollTo({ left: 0, top: 0 })
      } else {
        element.scrollLeft = 0
        element.scrollTop = 0
      }
    }

    function scheduleSettingsMainScrollReset() {
      scrollSettingsMainToTop()

      const cancelers: Array<() => void> = []
      if (typeof window.requestAnimationFrame === "function") {
        const frame = window.requestAnimationFrame(() => scrollSettingsMainToTop())
        cancelers.push(() => window.cancelAnimationFrame(frame))
      }

      for (const delay of [0, 50, 150, 300]) {
        const timer = window.setTimeout(() => scrollSettingsMainToTop(), delay)
        cancelers.push(() => window.clearTimeout(timer))
      }

      return () => {
        for (const cancel of cancelers) {
          cancel()
        }
      }
    }

    function clampSettingsPageIntoOverlay() {
      const overlayElement = settingsOverlayRef.current
      const pageElement = settingsPageRef.current
      if (!overlayElement || !pageElement) return

      const bounds = resolveSettingsPageDragBounds(
        overlayElement.getBoundingClientRect(),
        pageElement.getBoundingClientRect(),
        settingsPageOffsetRef.current,
      )
      updateSettingsPageOffset(clampSettingsPageOffset(settingsPageOffsetRef.current, bounds))
    }

    function handleSettingsHeaderPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || shouldIgnoreSettingsDragTarget(event.target)) return

      const overlayElement = settingsOverlayRef.current
      const pageElement = settingsPageRef.current
      if (!overlayElement || !pageElement) return

      event.preventDefault()
      const startOffset = settingsPageOffsetRef.current
      settingsPageDragRef.current = {
        bounds: resolveSettingsPageDragBounds(
          overlayElement.getBoundingClientRect(),
          pageElement.getBoundingClientRect(),
          startOffset,
        ),
        pointerID: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startOffset,
      }
      setIsSettingsPageDragging(true)
    }

    async function handleOpenStoragePath(targetPath: string) {
      const openPath = window.desktop?.openPath
      if (!openPath) {
        setStoragePathStatus({
          tone: "error",
          text: "Opening storage folders is unavailable in this desktop shell.",
        })
        return
      }

      try {
        await openPath({ targetPath })
        setStoragePathStatus({
          tone: "success",
          text: "Opened storage folder.",
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setStoragePathStatus({
          tone: "error",
          text: `Unable to open storage folder. ${message}`,
        })
      }
    }

    async function handleCopyStoragePath(targetPath: string) {
      try {
        await writeTextToClipboard(targetPath)
        setStoragePathStatus({
          tone: "success",
          text: "Storage path copied.",
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setStoragePathStatus({
          tone: "error",
          text: `Unable to copy storage path. ${message}`,
        })
      }
    }

    function setProviderApiKeyMode(providerID: string, mode: ProviderApiKeyMode) {
      setProviderApiKeyModes((current) => ({
        ...current,
        [providerID]: mode,
      }))
    }

    function toggleProviderApiKeyVisibility(providerID: string) {
      setVisibleProviderApiKeys((current) => ({
        ...current,
        [providerID]: !current[providerID],
      }))
    }

    function selectProviderAuthOption(providerID: string, method: string, apiKeyMode?: ProviderApiKeyMode) {
      if (apiKeyMode) {
        setProviderApiKeyMode(providerID, apiKeyMode)
      }
      onProviderAuthMethodChange(providerID, method)
    }

    function handleAnyboxAccountSignIn() {
      if (!anyboxAccountProvider || anyboxAccountBusy) return
      void onStartProviderAuthFlow(anyboxAccountProvider.id, { prompt: "select_account" })
    }

    function handleAnyboxAccountCancel() {
      if (!anyboxAccountProvider || anyboxAccountBusy || anyboxAccountView.status !== "pending") return
      void onCancelProviderAuthFlow(anyboxAccountProvider.id)
    }

    function handleAnyboxAccountSignOut() {
      if (!anyboxAccountProvider || anyboxAccountBusy) return
      void onDeleteProviderAuthSession(anyboxAccountProvider.id)
    }

    async function handleActiveProviderSave() {
      if (!activeProvider || !activeProviderDraft) return

      if (activeProviderConfigDirty) {
        const didSaveConfig = await onSaveProvider(activeProvider.id)
        if (!didSaveConfig) return
      }

      if (activeProviderSelectedCapability?.kind === "api_key") {
        if (activeProviderCredentialModeDirty) {
          await onSaveProviderApiKey(activeProvider.id, null)
          return
        }

        if (activeProviderApiKeyMode === "manual" && activeProviderApiKeyDirty) {
          await onSaveProviderApiKey(activeProvider.id, activeProviderDraft.apiKey)
        }
      }
    }

    function handleActiveProviderTest() {
      if (!activeProvider || !activeProviderDraft) return

      void onTestProviderConnection(activeProvider.id, {
        method: activeProviderSelectedMethod ?? undefined,
        credentialMode:
          activeProviderSelectedCapability?.kind === "api_key" ? activeProviderApiKeyMode : "active",
        apiKey:
          activeProviderSelectedCapability?.kind === "api_key" &&
          activeProviderApiKeyMode === "manual" &&
          activeProviderDraft.apiKey.trim()
            ? activeProviderDraft.apiKey.trim()
            : undefined,
        baseURL: activeProviderDraft.baseURL.trim() || undefined,
      })
    }

    function getCustomProviderEditDraft(provider: ProviderCatalogItem): CustomProviderDraftState {
      return {
        apiBaseURL: provider.baseURL ?? "",
        apiKey: "",
        defaultModel: provider.customDefaultModel ?? modelGroups[provider.id]?.[0]?.id ?? "",
        chatEndpoint: provider.customChatEndpoint ?? "/chat/completions",
      }
    }

    function openNewCustomProviderDialog() {
      setEditingCustomProviderID(null)
      onCustomProviderDraftReset()
      setIsCustomProviderDialogOpen(true)
    }

    function openEditCustomProviderDialog(provider: ProviderCatalogItem) {
      setEditingCustomProviderID(provider.id)
      onCustomProviderDraftReset(getCustomProviderEditDraft(provider))
      setIsCustomProviderDialogOpen(true)
    }

    function handleCustomProviderCancel() {
      if (customProviderBusy) return
      setIsCustomProviderDialogOpen(false)
      setEditingCustomProviderID(null)
      onCustomProviderDraftReset()
    }

    function handleCustomProviderOverlayClick(event: MouseEvent<HTMLDivElement>) {
      if (event.target !== event.currentTarget) return
      handleCustomProviderCancel()
    }

    async function handleCustomProviderSave() {
      if (!customProviderCanSubmit || customProviderBusy) return
      const didSave = await onSaveCustomProvider(editingCustomProviderID ?? undefined)
      if (!didSave) return
      setIsCustomProviderDialogOpen(false)
      setEditingCustomProviderID(null)
      onCustomProviderDraftReset()
    }

    function handleCustomProviderTest() {
      if (!customProviderCanSubmit || customProviderBusy) return
      void onTestCustomProviderConnection(editingCustomProviderID ?? undefined)
    }

    const languageOptions: Array<{ value: AppLocale; label: string; description: string }> = APP_LOCALES.map((value) => ({
      value,
      ...APP_LOCALE_METADATA[value],
    }))

    const primarySectionGroups = [
      {
        label: t("settings.options"),
        items: [
          { key: "general" as const, label: t("settings.nav.general"), Icon: GeneralSettingsIcon },
          { key: "account" as const, label: t("settings.nav.account"), Icon: AccountSettingsIcon },
          { key: "subscription" as const, label: t("settings.nav.subscription"), Icon: SubscriptionSettingsIcon },
          { key: "services" as const, label: t("settings.nav.provider"), Icon: ProviderSettingsIcon },
          { key: "defaults" as const, label: t("settings.nav.models"), Icon: ModelSettingsIcon },
          { key: "appearance" as const, label: t("settings.nav.appearance"), Icon: PaletteIcon },
          { key: "developer" as const, label: t("settings.nav.developer"), Icon: CodeModeIcon },
          { key: "storage" as const, label: t("settings.nav.storage"), Icon: StorageSettingsIcon },
          { key: "archive" as const, label: t("settings.nav.archive"), Icon: ArchiveRestoreIcon },
        ],
      },
    ] as const

    const updateSettingsSection = (
      <section className="settings-panel settings-about-panel" aria-label={t("settings.about.automaticUpdates")}>
        <div className="settings-about-row settings-about-version-row">
          <div className="settings-about-copy settings-about-version-copy">
            <h3>{appVersionLabel}</h3>
          </div>
          <button
            className="secondary-button settings-about-check-button"
            type="button"
            disabled={!appUpdateState && isCheckingAppUpdate}
            onClick={handleAboutUpdateAction}
          >
            {aboutUpdateActionLabel}
          </button>
        </div>

        <div className="settings-about-divider" />

        <button
          className={
            automaticUpdatesEnabled
              ? "settings-about-toggle-row is-active"
              : "settings-about-toggle-row"
          }
          type="button"
          role="switch"
          aria-checked={automaticUpdatesEnabled}
          disabled={!appUpdateState || isSavingAutomaticUpdates}
          onClick={onAutomaticUpdatesToggle}
        >
          <span className="settings-about-copy">
            <span className="settings-about-title">{t("settings.about.automaticUpdates")}</span>
          </span>
          <span className="settings-toggle-control" aria-hidden="true">
            <span className="settings-toggle-thumb" />
          </span>
        </button>

      </section>
    )

    const languageSection = (
      <section className="settings-panel">
        <div className="settings-select-list">
          <div className="settings-select-row">
            <span className="settings-select-copy">
              <span className="settings-select-title">{t("settings.general.languageTitle")}</span>
            </span>
            <span className="settings-select-control">
              <SettingsSelect<AppLocale>
                ariaLabel={t("settings.general.languageTitle")}
                options={languageOptions}
                value={locale}
                onChange={(nextLocale) => void setLocale(nextLocale)}
              />
            </span>
          </div>
        </div>
        {localeError ? (
          <p className="settings-helper-text settings-theme-config-error">
            {t("settings.general.localeSaveFailed")} {localeError}
          </p>
        ) : null}
      </section>
    )

    const accountSection = (
      <div className="settings-account-layout">
        <section className="settings-panel settings-account-panel" aria-label={t("settings.account.title")}>
          <div className="settings-account-list">
            <div className="settings-account-row settings-account-status-row">
              <span className="settings-account-copy">
                <span className="settings-account-title">{t("settings.account.status")}</span>
              </span>
              <div className="settings-account-status-side">
                <span className={`settings-account-status is-${anyboxAccountView.status}`}>
                  <span className="settings-account-status-dot" aria-hidden="true" />
                  <span>{anyboxAccountView.title}</span>
                </span>
                <span className="settings-inline-actions settings-account-actions">
                  {anyboxAccountView.status === "connected" && anyboxAccountRechargeUrl ? (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={anyboxAccountBusy}
                      onClick={() => void openExternalUrl(anyboxAccountRechargeUrl)}
                    >
                      {t("settings.account.recharge")}
                    </button>
                  ) : null}
                  {anyboxAccountView.status === "connected" ? (
                    <>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={anyboxAccountBusy}
                        onClick={handleAnyboxAccountSignIn}
                      >
                        {t("settings.account.signInAgain")}
                      </button>
                      <button
                        className="secondary-button is-danger"
                        type="button"
                        disabled={anyboxAccountBusy}
                        onClick={handleAnyboxAccountSignOut}
                      >
                        {t("settings.account.signOut")}
                      </button>
                    </>
                  ) : anyboxAccountView.status === "pending" ? (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={anyboxAccountBusy}
                      onClick={handleAnyboxAccountCancel}
                    >
                      {t("settings.account.cancelSignIn")}
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      type="button"
                      disabled={!anyboxAccountProvider || anyboxAccountBusy}
                      onClick={handleAnyboxAccountSignIn}
                    >
                      {t("settings.account.signIn")}
                    </button>
                  )}
                </span>
              </div>
            </div>

            <div className="settings-account-row">
              <span className="settings-account-title">{t("settings.account.productPage")}</span>
              <button
                className="settings-account-link-button"
                type="button"
                onClick={() => void openExternalUrl(ANYBOX_PRODUCT_HOME_URL)}
              >
                anybox.com.cn
              </button>
            </div>

            {anyboxAccountView.status === "connected" ? (
              <>
                <div className="settings-account-row">
                  <span className="settings-account-title">{t("settings.account.email")}</span>
                  <strong className="settings-account-value">
                    {anyboxAccountView.account?.email ?? t("settings.account.noValue")}
                  </strong>
                </div>

                <div className="settings-account-row">
                  <span className="settings-account-title">{t("settings.account.workspace")}</span>
                  <strong className="settings-account-value">
                    {anyboxAccountView.account?.workspaceName ?? t("settings.account.noValue")}
                  </strong>
                </div>

                <div className="settings-account-row">
                  <span className="settings-account-title">{t("settings.account.plan")}</span>
                  <strong className="settings-account-value">
                    {anyboxAccountPlanLabel ?? t("settings.account.noValue")}
                  </strong>
                </div>

                {anyboxAccountBalance ? (
                  <div className="settings-account-row">
                    <span className="settings-account-title">{t("settings.account.balance")}</span>
                    <strong className="settings-account-value">{anyboxAccountBalance}</strong>
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="settings-account-community" aria-label={t("settings.account.communityTitle")}>
              <span className="settings-account-community-copy">
                <span className="settings-account-community-title">{t("settings.account.communityTitle")}</span>
                <span className="settings-account-community-description">
                  {t("settings.account.communityDescription")}
                </span>
              </span>
              <img
                className="settings-account-community-qr"
                src={ANYBOX_COMMUNITY_QR_IMAGE_SRC}
                alt={t("settings.account.communityQrAlt")}
              />
            </div>
          </div>
        </section>
      </div>
    )

    return (
      <section
        ref={settingsOverlayRef}
        className={isSettingsPageDragging ? "settings-page-overlay is-dragging-settings-page" : "settings-page-overlay"}
        role="presentation"
      >
        <div
          ref={settingsPageRef}
          className={isSettingsPageDragging ? "settings-page-positioner is-dragging" : "settings-page-positioner"}
          style={{ transform: `translate3d(${settingsPageOffset.x}px, ${settingsPageOffset.y}px, 0)` }}
        >
          <div className="settings-page-motion">
            <div
              className={isSettingsPageDragging ? "settings-page is-dragging" : "settings-page"}
              role="dialog"
              aria-modal="true"
              aria-label={t("settings.title")}
            >
              <header className="settings-page-header" title={t("settings.dragSettings")} onPointerDown={handleSettingsHeaderPointerDown}>
                <button className="settings-page-close-button" aria-label={t("settings.close")} title={t("settings.close")} onClick={onClose}>
                  <CloseIcon />
                </button>
              </header>

              <div className="settings-page-shell">
            <aside className="settings-page-primary-nav" aria-label={t("settings.sections")}>
              {primarySectionGroups.map((group) => (
                <section key={group.label} className="settings-primary-nav-group" aria-label={group.label}>
                  <p className="settings-primary-nav-group-label">{group.label}</p>
                  <div className="settings-primary-nav-group-items">
                    {group.items.map((section) => {
                      const isActive = activeSection === section.key
                      const Icon = section.Icon

                      return (
                        <button
                          key={section.key}
                          className={isActive ? "settings-primary-nav-item is-active" : "settings-primary-nav-item"}
                          aria-current={isActive ? "page" : undefined}
                          type="button"
                          onClick={() => {
                            if (activeSection === section.key) {
                              scrollSettingsMainToTop()
                              return
                            }

                            setActiveSection(section.key)
                          }}
                        >
                          <span className="settings-primary-nav-icon" aria-hidden="true">
                            <Icon />
                          </span>
                          <span className="settings-primary-nav-copy">
                            <span className="settings-primary-nav-label">{section.label}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </aside>

            <div
              ref={settingsMainRef}
              className={useServiceSettingsChrome ? "settings-page-main is-services" : "settings-page-main"}
            >
              <div ref={settingsMainTopAnchorRef} className="settings-page-main-scroll-anchor" aria-hidden="true" />

              {loadError && showProviderSections ? <div className="settings-banner is-error">{loadError}</div> : null}

              {archivedSessionsError && activeSection === "archive" ? (
                <div className="settings-banner is-error">{archivedSessionsError}</div>
              ) : null}

              {storageUsageError && activeSection === "storage" ? (
                <div className="settings-banner is-error">{storageUsageError}</div>
              ) : null}

              {isLoading && showProviderSections ? (
                <article className="settings-empty-state">
                  <span className="label">Loading</span>
                  <h3>Fetching provider catalog</h3>
                  <p>Reading provider availability, model visibility, and saved model preferences.</p>
                </article>
              ) : null}

              {isLoadingArchivedSessions && activeSection === "archive" ? (
                <article className="settings-empty-state">
                  <span className="label">Loading</span>
                  <h3>Fetching archived sessions</h3>
                  <p>Reading archived session snapshots so you can restore or permanently delete them.</p>
                </article>
              ) : null}

              {isLoadingStorageUsage && activeSection === "storage" && !storageUsage ? (
                <article className="settings-empty-state">
                  <span className="label">{t("settings.storage.loadingLabel")}</span>
                  <h3>{t("settings.storage.loadingTitle")}</h3>
                  <p>{t("settings.storage.loadingCopy")}</p>
                </article>
              ) : null}

              {activeSection === "general" ? (
                <div className="settings-general-layout">
                  {updateSettingsSection}

                  {languageSection}
                </div>
              ) : activeSection === "account" ? (
                accountSection
              ) : activeSection === "subscription" ? (
                <SubscriptionSettingsPanel
                  accountBusy={anyboxAccountBusy}
                  connected={anyboxAccountView.status === "connected"}
                  onSignIn={handleAnyboxAccountSignIn}
                />
              ) : activeSection === "appearance" ? (
                <AppearanceSettingsPanel
                  appearanceConfigError={appearanceConfigError}
                  appearanceConfigPath={appearanceConfigPath}
                  appearanceConfigPreview={appearanceConfigPreview}
                  appearanceOverrides={appearanceOverrides}
                  appearanceThemeError={appearanceThemeError}
                  appearanceThemes={appearanceThemes}
                  activeAppearanceThemeID={activeAppearanceThemeID}
                  appearanceTokenValues={appearanceTokenValues}
                  colorMode={colorMode}
                  fontFamily={fontFamily}
                  htmlBackgroundConfig={htmlBackgroundConfig}
                  isActivityRailVisible={isActivityRailVisible}
                  showShellLayoutSettings
                  onActivityRailVisibilityChange={onActivityRailVisibilityChange}
                  onAppearancePaletteReset={onAppearancePaletteReset}
                  onAppearanceThemeApply={onAppearanceThemeApply}
                  onAppearanceThemeDelete={onAppearanceThemeDelete}
                  onAppearanceThemeDuplicate={onAppearanceThemeDuplicate}
                  onAppearanceThemeRename={onAppearanceThemeRename}
                  onAppearanceThemeSaveCurrent={onAppearanceThemeSaveCurrent}
                  onAppearanceTokenChange={onAppearanceTokenChange}
                  onAppearanceTokenReset={onAppearanceTokenReset}
                  onColorModeChange={onColorModeChange}
                  onFontFamilyChange={onFontFamilyChange}
                  onHtmlBackgroundConfigChange={onHtmlBackgroundConfigChange}
                  onOpenAppearanceWindow={() => void openAppearanceWindow()}
                />
              ) : activeSection === "developer" ? (
                <div className="settings-developer-layout">
                  <SettingsDisclosurePanel
                    panelID="developer-agent-monitor"
                    label="Monitor"
                    title="Agent Monitor"
                    description="Open the standalone monitor dashboard for local agent status, runtime sessions, and live logs."
                  >
                    <div className="settings-actions-row">
                      <span className="settings-helper-text">
                        Opens a dedicated desktop window and falls back to the bundled monitor build when the dev server is not running.
                      </span>
                      <button
                        className="secondary-button"
                        type="button"
                        aria-label="Open monitor"
                        onClick={() => void openMonitorWindow()}
                      >
                        Open Monitor
                      </button>
                    </div>
                  </SettingsDisclosurePanel>

                  <SettingsDisclosurePanel
                    panelID="developer-debug-overlays"
                    label="Development"
                    title="Debug Overlays"
                    description="Toggle temporary visual overlays used during UI structure discussions and layout iteration."
                  >
                    <div className="settings-section-summary">
                      <button
                        className={isDebugUiRegionsEnabled ? "settings-toggle-card is-active" : "settings-toggle-card"}
                        role="switch"
                        aria-checked={isDebugUiRegionsEnabled}
                        aria-label="Show debug region colors"
                        type="button"
                        onClick={() => onDebugUiRegionsChange(!isDebugUiRegionsEnabled)}
                      >
                        <span className="settings-toggle-copy">
                          <strong className="settings-toggle-title">
                            <span className="settings-toggle-icon" aria-hidden="true">
                              <PaletteIcon />
                            </span>
                            <span>Show debug region colors</span>
                          </strong>
                          <small>Fill major UI regions with temporary colors so layout discussions can refer to them directly.</small>
                        </span>
                        <span className="settings-toggle-control" aria-hidden="true">
                          <span className="settings-toggle-thumb" />
                        </span>
                      </button>

                      <button
                        className={isDebugLineColorsEnabled ? "settings-toggle-card is-active" : "settings-toggle-card"}
                        role="switch"
                        aria-checked={isDebugLineColorsEnabled}
                        aria-label="Show line debug colors"
                        type="button"
                        onClick={() => onDebugLineColorsChange(!isDebugLineColorsEnabled)}
                      >
                        <span className="settings-toggle-copy">
                          <strong className="settings-toggle-title">
                            <span className="settings-toggle-icon" aria-hidden="true">
                              <MinimizeIcon />
                            </span>
                            <span>Show line debug colors</span>
                          </strong>
                          <small>Use separate highlight colors for the shell top border and the pane tab divider.</small>
                        </span>
                        <span className="settings-toggle-control" aria-hidden="true">
                          <span className="settings-toggle-thumb" />
                        </span>
                      </button>
                    </div>

                    <p className="settings-helper-text">
                      Debug region colors follow the desktop UI structure guide. Line colors keep the normal theme untouched until you need to inspect which thin divider is being painted in the top region.
                    </p>
                  </SettingsDisclosurePanel>

                  <SettingsDisclosurePanel
                    panelID="developer-trace-visibility"
                    label="Agent"
                    title="Trace Visibility"
                    description="Decide which trace categories get a seat in the main thread, from user-facing response text down to workflow markers and backend metadata."
                  >
                    <div className="settings-section-summary">
                      {assistantTraceVisibilityOptions.map((option) => {
                        const enabled = assistantTraceVisibility[option.key]

                        return (
                          <button
                            key={option.key}
                            className={enabled ? "settings-toggle-card is-active" : "settings-toggle-card"}
                            role="switch"
                            aria-checked={enabled}
                            aria-label={`Show trace ${option.title.toLowerCase()}`}
                            type="button"
                            onClick={() => onAssistantTraceVisibilityChange(option.key, !enabled)}
                          >
                            <span className="settings-toggle-copy">
                              <strong className="settings-toggle-title">
                                <span className="settings-toggle-icon" aria-hidden="true">
                                  <FileTextIcon />
                                </span>
                                <span>{option.title}</span>
                              </strong>
                              <small>{option.description}</small>
                            </span>
                            <span className="settings-toggle-control" aria-hidden="true">
                              <span className="settings-toggle-thumb" />
                            </span>
                          </button>
                        )
                      })}
                    </div>

                    <p className="settings-helper-text">
                      Tool calls stay visible through the main trace. The tool input and output switches control whether each tool entry reveals the streamed payloads behind that lifecycle item, while debug metadata adds backend-only identifiers and timing details to every entry.
                    </p>
                  </SettingsDisclosurePanel>

                  <SettingsDisclosurePanel
                    panelID="developer-mobile-connection"
                    label="Mobile"
                    title="Mobile Connection"
                    description="Control whether the mobile connection page reveals bridge URLs, token access, and handoff test commands."
                  >
                    <div className="settings-section-summary">
                      <button
                        className={isMobileConnectionAdvancedInfoEnabled ? "settings-toggle-card is-active" : "settings-toggle-card"}
                        role="switch"
                        aria-checked={isMobileConnectionAdvancedInfoEnabled}
                        aria-label="Show mobile connection advanced info"
                        type="button"
                        onClick={() => onMobileConnectionAdvancedInfoChange(!isMobileConnectionAdvancedInfoEnabled)}
                      >
                        <span className="settings-toggle-copy">
                          <strong className="settings-toggle-title">
                            <span className="settings-toggle-icon" aria-hidden="true">
                              <ConnectedStatusIcon />
                            </span>
                            <span>Show mobile connection advanced info</span>
                          </strong>
                          <small>Reveal raw pairing links, legacy token URLs, the bridge token, and Android smoke-test commands on the mobile connection page.</small>
                        </span>
                        <span className="settings-toggle-control" aria-hidden="true">
                          <span className="settings-toggle-thumb" />
                        </span>
                      </button>
                    </div>

                    <p className="settings-helper-text">
                      Keep this off for normal pairing flows. Turn it on only while debugging mobile bridge networking or preparing a handoff test.
                    </p>
                  </SettingsDisclosurePanel>

                  <SettingsDisclosurePanel
                    panelID="developer-storage-locations"
                    label="Storage"
                    title="Storage Locations"
                    description="Open or copy the folders used for app data, managed agent data, plugins, and caches."
                  >
                    <div className="settings-storage-list" aria-label="Storage locations">
                      {storagePaths ? (
                        storagePathItems.map((item) => {
                          const targetPath = storagePaths[item.key]

                          return (
                            <div key={item.key} className="settings-storage-row">
                              <div className="settings-storage-copy">
                                <strong>{item.label}</strong>
                                <span>{item.description}</span>
                                <code title={targetPath}>{targetPath}</code>
                              </div>
                              <div className="settings-storage-actions">
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() => void handleCopyStoragePath(targetPath)}
                                >
                                  Copy
                                </button>
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() => void handleOpenStoragePath(targetPath)}
                                >
                                  Open
                                </button>
                              </div>
                            </div>
                          )
                        })
                      ) : (
                        <p className="settings-helper-text">Loading storage paths...</p>
                      )}
                    </div>
                    {storagePathStatus ? (
                      <p className={`settings-about-status is-${storagePathStatus.tone}`}>{storagePathStatus.text}</p>
                    ) : null}
                  </SettingsDisclosurePanel>

                  <SettingsDisclosurePanel
                    panelID="developer-state"
                    label="Current"
                    title="Developer State"
                    description="Region and line colors are development overlays, while the trace controls decide how much backend execution detail appears inside the main thread."
                    defaultOpen
                  >
                    <div className="settings-section-summary">
                      <article className="settings-summary-card">
                        <span className="label">Debug Regions</span>
                        <strong>{isDebugUiRegionsEnabled ? "Shown" : "Hidden"}</strong>
                        <p>
                          {isDebugUiRegionsEnabled
                            ? "Major interface regions use temporary background colors to make layout discussions faster."
                            : "Region debug colors are disabled, so the interface shows only the current visual theme."}
                        </p>
                      </article>
                      <article className="settings-summary-card">
                        <span className="label">Line Colors</span>
                        <strong>{isDebugLineColorsEnabled ? "Shown" : "Hidden"}</strong>
                        <p>
                          {isDebugLineColorsEnabled
                            ? "The remaining top-region dividers use separate colors so the shell border and pane divider can be distinguished immediately."
                            : "Top divider lines use the current theme colors, so they blend back into the regular interface."}
                        </p>
                      </article>
                      <article className="settings-summary-card">
                        <span className="label">Agent Trace</span>
                        <strong>{enabledTraceVisibilityCount}/{assistantTraceVisibilityOptions.length} enabled</strong>
                        <p>
                          {assistantTraceVisibility.debugMetadata
                            ? "The main trace is showing backend metadata in addition to the enabled response, tool, approval, file, and workflow categories."
                            : "The main trace is showing the enabled user-facing categories while backend metadata stays collapsed."}
                        </p>
                      </article>
                      <article className="settings-summary-card">
                        <span className="label">Mobile Advanced Info</span>
                        <strong>{isMobileConnectionAdvancedInfoEnabled ? "Shown" : "Hidden"}</strong>
                        <p>
                          {isMobileConnectionAdvancedInfoEnabled
                            ? "The mobile connection page reveals bridge URLs, tokens, and handoff commands for debugging."
                            : "The mobile connection page keeps bridge URLs, tokens, and test commands out of the normal pairing flow."}
                        </p>
                      </article>
                    </div>
                  </SettingsDisclosurePanel>
                </div>
              ) : activeSection === "storage" ? (
                isLoadingStorageUsage && !storageUsage ? null : (
                <div className="settings-storage-layout">
                  <section className="settings-panel">
                    <div className="settings-section-header settings-storage-header">
                      <div>
                        <span className="label">{t("settings.storage.label")}</span>
                        <h3>{t("settings.storage.title")}</h3>
                      </div>
                      <p>{t("settings.storage.copy")}</p>
                      <button
                        className="secondary-button"
                        disabled={isLoadingStorageUsage}
                        type="button"
                        onClick={() => void onLoadStorageUsage()}
                      >
                        {isLoadingStorageUsage ? t("settings.storage.refreshing") : t("settings.storage.refresh")}
                      </button>
                    </div>

                    {storageUsage ? (
                      <div className="settings-storage-content">
                        <div className="settings-section-summary settings-storage-summary" aria-label={t("settings.storage.summaryAria")}>
                          {storageSummaryItems.map((item) => (
                            <article key={item.key} className="settings-summary-card settings-storage-summary-card">
                              <span className="label">{item.label}</span>
                              <strong>{item.approximate ? t("settings.storage.approximateValue", { value: item.value }) : item.value}</strong>
                              <p>{item.detail}</p>
                            </article>
                          ))}
                        </div>

                        <section className="settings-storage-block">
                          <div className="settings-storage-block-header">
                            <h4>{t("settings.storage.databaseTitle")}</h4>
                            <span>{t("settings.storage.generatedAt", { time: formatTime(storageUsage.generatedAt) })}</span>
                          </div>
                          <div className="settings-storage-detail-list">
                            <div className="settings-storage-detail-row">
                              <span>{t("settings.storage.databasePath")}</span>
                              <code title={storageUsage.database.path}>{storageUsage.database.path}</code>
                            </div>
                            <div className="settings-storage-detail-row">
                              <span>{t("settings.storage.mainFile")}</span>
                              <strong>{formatStorageBytes(storageUsage.database.mainBytes)}</strong>
                            </div>
                            <div className="settings-storage-detail-row">
                              <span>{t("settings.storage.walFile")}</span>
                              <strong>{formatStorageBytes(storageUsage.database.walBytes)}</strong>
                            </div>
                            <div className="settings-storage-detail-row">
                              <span>{t("settings.storage.shmFile")}</span>
                              <strong>{formatStorageBytes(storageUsage.database.shmBytes)}</strong>
                            </div>
                            <div className="settings-storage-detail-row">
                              <span>{t("settings.storage.pageStats")}</span>
                              <strong>
                                {storageUsage.database.pageSize && storageUsage.database.pageCount !== null
                                  ? t("settings.storage.pageStatsValue", {
                                      pageSize: formatStorageBytes(storageUsage.database.pageSize),
                                      pageCount: storageUsage.database.pageCount,
                                    })
                                  : t("settings.storage.unknown")}
                              </strong>
                            </div>
                          </div>
                        </section>

                        <section className="settings-storage-block">
                          <div className="settings-storage-block-header">
                            <h4>{t("settings.storage.categoriesTitle")}</h4>
                            <span>{t("settings.storage.approximateHint")}</span>
                          </div>
                          <div className="settings-storage-category-list">
                            {storageUsage.categories.map((category) => (
                              <div key={category.id} className="settings-storage-category-row">
                                <div>
                                  <strong>{getStorageCategoryLabel(t, category.id)}</strong>
                                  <span>
                                    {category.count !== undefined
                                      ? t("settings.storage.categoryCount", { count: category.count })
                                      : t("settings.storage.categoryNoCount")}
                                  </span>
                                </div>
                                <span>{t("settings.storage.approximateValue", { value: formatStorageBytes(category.bytes) })}</span>
                              </div>
                            ))}
                          </div>
                        </section>

                        <section className="settings-storage-block">
                          <div className="settings-storage-block-header">
                            <h4>{t("settings.storage.archivedSessionsTitle")}</h4>
                            <span>{t("settings.storage.archivedSessionsCopy")}</span>
                          </div>
                          {largestArchivedSessionUsage.length > 0 ? (
                            <div className="settings-storage-session-list">
                              {largestArchivedSessionUsage.map((session) => (
                                <article key={session.id} className="settings-storage-session-row">
                                  <div>
                                    <strong>{session.title || session.id}</strong>
                                    <span>
                                      {[session.projectName ?? session.projectID, session.directory].filter(Boolean).join(" - ")}
                                    </span>
                                    <small>
                                      {t("settings.archive.messageCount", { count: session.messageCount })} - {t("settings.archive.eventCount", { count: session.eventCount })} - {t("settings.archive.archivedAt", { time: formatTime(session.archivedAt) })}
                                    </small>
                                  </div>
                                  <span>{t("settings.storage.approximateValue", { value: formatStorageBytes(session.estimatedBytes) })}</span>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="settings-helper-text">{t("settings.storage.noArchivedSessions")}</p>
                          )}
                        </section>

                        <section className="settings-storage-block">
                          <div className="settings-storage-block-header">
                            <h4>{t("settings.storage.tablesTitle")}</h4>
                            <span>{t("settings.storage.tablesCopy")}</span>
                          </div>
                          {storageTables.length > 0 ? (
                            <div className="settings-storage-table-list" role="table" aria-label={t("settings.storage.tablesTitle")}>
                              <div className="settings-storage-table-row is-header" role="row">
                                <span role="columnheader">{t("settings.storage.tableName")}</span>
                                <span role="columnheader">{t("settings.storage.tableCategory")}</span>
                                <span role="columnheader">{t("settings.storage.tableRows")}</span>
                                <span role="columnheader">{t("settings.storage.tableBytes")}</span>
                              </div>
                              {storageTables.map((table) => (
                                <div key={table.name} className="settings-storage-table-row" role="row">
                                  <code role="cell">{table.name}</code>
                                  <span role="cell">{getStorageTableCategoryLabel(t, table.category)}</span>
                                  <span role="cell">{table.rowCount}</span>
                                  <span role="cell">{t("settings.storage.approximateValue", { value: formatStorageBytes(table.estimatedBytes) })}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="settings-helper-text">{t("settings.storage.noTables")}</p>
                          )}
                        </section>
                      </div>
                    ) : (
                      <article className="settings-empty-state">
                        <span className="label">{t("settings.storage.emptyLabel")}</span>
                        <h3>{t("settings.storage.emptyTitle")}</h3>
                        <p>{t("settings.storage.emptyCopy")}</p>
                      </article>
                    )}
                  </section>
                </div>
                )
              ) : activeSection === "archive" ? (
                isLoadingArchivedSessions ? null : (
                <div className="settings-archive-layout">
                  <section className="settings-panel">
                    <div className="settings-section-header">
                      <div>
                        <span className="label">Archive</span>
                        <h3>{t("settings.archive.title")}</h3>
                      </div>
                      <p>{t("settings.archive.copy")}</p>
                    </div>

                    <div className="settings-provider-search-row settings-archive-toolbar">
                      <div className="settings-provider-search-control settings-archive-search-control" role="search">
                        <SearchIcon />
                        <input
                          aria-label={t("settings.archive.searchLabel")}
                          type="search"
                          value={archivedSessionSearchQuery}
                          placeholder={t("settings.archive.searchPlaceholder")}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => setArchivedSessionSearchQuery(event.target.value)}
                        />
                      </div>
                      <button
                        className="secondary-button is-danger"
                        disabled={
                          isDeletingAllArchivedSessions ||
                          restoringArchivedSessionID !== null ||
                          deletingArchivedSessionID !== null ||
                          archivedSessions.length === 0
                        }
                        type="button"
                        onClick={handleDeleteAllArchivedSessionsClick}
                      >
                        {isDeletingAllArchivedSessions ? t("settings.archive.deletingAll") : t("settings.archive.deleteAll")}
                      </button>
                    </div>

                    {archivedSessions.length === 0 ? (
                      <article className="settings-empty-state">
                        <span className="label">Empty</span>
                        <h3>{t("settings.archive.emptyTitle")}</h3>
                        <p>{t("settings.archive.emptyCopy")}</p>
                      </article>
                    ) : filteredArchivedSessions.length === 0 ? (
                      <article className="settings-empty-state settings-archive-empty-result">
                        <span className="label">{t("app.search")}</span>
                        <h3>{t("settings.archive.noResultsTitle")}</h3>
                        <p>{t("settings.archive.noResultsCopy")}</p>
                      </article>
                    ) : (
                      <div className="settings-archive-list" role="list" aria-label="Archived sessions">
                        {filteredArchivedSessions.map((session) => {
                          const isRestoring = restoringArchivedSessionID === session.id
                          const isDeleting = deletingArchivedSessionID === session.id
                          const projectLabel = session.projectName ?? session.projectID

                          return (
                            <article key={session.id} className="settings-archive-item" role="listitem">
                              <div className="settings-archive-copy">
                                <div className="settings-archive-heading">
                                  <strong>{session.title}</strong>
                                  {session.projectMissing ? (
                                    <span className="settings-badge settings-archive-badge is-warning">{t("settings.archive.projectMissing")}</span>
                                  ) : null}
                                </div>
                                <div className="settings-archive-meta">
                                  <span>{projectLabel}</span>
                                  <span>{session.directory}</span>
                                  <span>{t("settings.archive.updatedAt", { time: formatTime(session.updated) })}</span>
                                  <span>{t("settings.archive.archivedAt", { time: formatTime(session.archivedAt) })}</span>
                                  <span>{t("settings.archive.messageCount", { count: session.messageCount })}</span>
                                  <span>{t("settings.archive.eventCount", { count: session.eventCount })}</span>
                                </div>
                              </div>

                              <div className="settings-inline-actions settings-archive-actions">
                                <button
                                  className="secondary-button"
                                  disabled={isDeletingAllArchivedSessions || isRestoring || isDeleting}
                                  type="button"
                                  onClick={() => void onRestoreArchivedSession(session.id)}
                                >
                                  {isRestoring ? t("settings.archive.restoring") : t("app.restore")}
                                </button>
                                <button
                                  className="secondary-button is-danger"
                                  disabled={isDeletingAllArchivedSessions || isRestoring || isDeleting}
                                  type="button"
                                  onClick={() => void onDeleteArchivedSession(session.id)}
                                >
                                  {isDeleting ? t("settings.archive.deleting") : t("app.delete")}
                                </button>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    )}
                  </section>
                </div>
                )
              ) : showLoadedState ? (
                activeSection === "services" ? (
                  <section
                    className="settings-services-layout"
                    aria-label={t("settings.provider.pageAria")}
                  >
                    <nav
                      className="top-menu-segment-list settings-service-view-switch"
                      role="radiogroup"
                      aria-label={t("settings.provider.filterAria")}
                    >
                      {([
                        ["all", t("settings.provider.filterAll")] as const,
                        ["text", t("settings.provider.filterText")] as const,
                        ["image", t("settings.provider.filterImage")] as const,
                        ["video", t("settings.provider.filterVideo")] as const,
                        ["connected", t("settings.provider.filterConnected")] as const,
                      ]).map(([filter, label]) => {
                        const isActive = providerCapabilityFilter === filter

                        return (
                          <button
                            key={filter}
                            className={isActive ? "top-menu-segment is-active" : "top-menu-segment"}
                            type="button"
                            role="radio"
                            aria-checked={isActive}
                            onClick={() => setProviderCapabilityFilter(filter)}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </nav>

                    <div className="settings-service-list-panel settings-provider-list-panel">
                      <div className="settings-provider-search-row">
                        <div className="settings-provider-search-control" role="search">
                          <SearchIcon />
                          <input
                            aria-label={t("settings.provider.searchProviders")}
                            type="search"
                            value={providerSearch}
                            placeholder={t("settings.provider.searchProviders")}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => setProviderSearch(event.target.value)}
                          />
                        </div>
                        <button
                          className="secondary-button settings-provider-add-button"
                          aria-label="Add custom provider"
                          title="Add custom provider"
                          type="button"
                          onClick={openNewCustomProviderDialog}
                        >
                          <PlusIcon />
                        </button>
                        <button
                          className="secondary-button settings-provider-refresh-button"
                          aria-label="Refresh provider catalog"
                          type="button"
                          disabled={isRefreshingProviderCatalog || isRefreshingCinemaVideoProviderCatalog}
                          onClick={() => {
                            void onRefreshProviderCatalog()
                            void onRefreshCinemaVideoProviderCatalog()
                          }}
                        >
                          {isRefreshingProviderCatalog || isRefreshingCinemaVideoProviderCatalog
                            ? t("settings.provider.refreshingCatalog")
                            : t("app.refresh")}
                        </button>
                      </div>

                      <div className="settings-service-list-body">
                        {filteredProviderItems.length > 0 ? (
                          <div className="settings-service-list" role="list" aria-label={t("settings.provider.providerList")}>
                            {filteredProviderItems.map((item) => {
                              const isActive =
                                item.kind === selectedProviderKind &&
                                (item.kind === "model"
                                  ? item.id === selectedProviderID
                                  : item.id === selectedVideoProviderID)
                              const capabilityTags = getProviderCapabilityTags(item.capabilities, t)

                              if (item.kind === "model") {
                                const provider = item.provider
                                const connectionLabel = getProviderConnectionLabel(provider, t)
                                const sourceLabel = getProviderSourceLabel(provider, t)

                                return (
                                  <button
                                    key={item.key}
                                    className={isActive ? "settings-service-item is-active" : "settings-service-item"}
                                    aria-label={`${provider.name} ${connectionLabel}`}
                                    aria-pressed={isActive}
                                    onClick={() => {
                                      setSelectedProviderKind("model")
                                      setSelectedProviderID(provider.id)
                                      setSelectedVideoProviderID(null)
                                    }}
                                  >
                                    <div className="settings-service-item-header">
                                      <span className="settings-service-item-title">
                                        <ProviderLogo provider={provider} />
                                        <strong>{provider.name}</strong>
                                      </span>
                                      <span
                                        className={
                                          item.connected
                                            ? "settings-status-indicator is-connected"
                                            : "settings-status-indicator is-disconnected"
                                        }
                                        aria-hidden="true"
                                        title={connectionLabel}
                                      >
                                        {item.connected ? <ConnectedStatusIcon /> : <DisconnectedStatusIcon />}
                                      </span>
                                    </div>
                                    <span className="settings-service-item-copy">
                                      {provider.source !== "api" ? sourceLabel : t("settings.provider.sourceCatalog")}
                                    </span>
                                    {capabilityTags.length > 0 ? (
                                      <span className="settings-service-item-tags" aria-hidden="true">
                                        {capabilityTags.map((tag) => (
                                          <span key={`${item.key}-${tag}`} className="settings-badge">{tag}</span>
                                        ))}
                                      </span>
                                    ) : null}
                                  </button>
                                )
                              }

                              const provider = item.provider
                              const connectionLabel = getCinemaVideoProviderStatusText(provider, t)
                              const modelSummary = getCinemaVideoProviderModelSummary(provider)

                              return (
                                <button
                                  key={item.key}
                                  className={isActive ? "settings-service-item is-active" : "settings-service-item"}
                                  aria-label={`${provider.manifest.name} ${connectionLabel}`}
                                  aria-pressed={isActive}
                                  onClick={() => {
                                    setSelectedProviderKind("cinema")
                                    setSelectedVideoProviderID(provider.manifest.id)
                                    setSelectedProviderID(null)
                                  }}
                                >
                                  <div className="settings-service-item-header">
                                    <span className="settings-service-item-title">
                                      <span className="provider-logo" aria-hidden="true">
                                        <span className="provider-logo-fallback">{provider.manifest.name.slice(0, 1).toUpperCase()}</span>
                                      </span>
                                      <strong>{provider.manifest.name}</strong>
                                    </span>
                                    <span
                                      className={
                                        item.connected
                                          ? "settings-status-indicator is-connected"
                                          : "settings-status-indicator is-disconnected"
                                      }
                                      aria-hidden="true"
                                      title={connectionLabel}
                                    >
                                      {item.connected ? <ConnectedStatusIcon /> : <DisconnectedStatusIcon />}
                                    </span>
                                  </div>
                                  <span className="settings-service-item-copy">
                                    {getCinemaVideoProviderKindLabel(provider.manifest.kind)} · {modelSummary}
                                  </span>
                                  {capabilityTags.length > 0 ? (
                                    <span className="settings-service-item-tags" aria-hidden="true">
                                      {capabilityTags.map((tag) => (
                                        <span key={`${item.key}-${tag}`} className="settings-badge">{tag}</span>
                                      ))}
                                    </span>
                                  ) : null}
                                </button>
                              )
                            })}
                          </div>
                        ) : (
                          <article className="settings-empty-state settings-service-list-empty-state">
                            <span className="label">{t("settings.videoProviders.noMatchLabel")}</span>
                            <h3>{t("settings.provider.noSearchMatchTitle")}</h3>
                            <p>{t("settings.provider.noSearchMatchCopy")}</p>
                          </article>
                        )}
                      </div>
                    </div>

                    <div ref={serviceDetailPanelRef} className="settings-service-detail-panel">
                      {activeProvider && activeProviderDraft ? (
                        <>
                          <div className="settings-panel provider-detail-card">
                            <div className="provider-detail-header">
                              <ProviderLogo provider={activeProvider} className="is-large" />
                              <div className="provider-detail-heading">
                                <h3>{activeProvider.name}</h3>
                                <p>
                                  <span
                                    className={
                                      isProviderConnected(activeProvider)
                                        ? "provider-detail-status-dot is-connected"
                                        : "provider-detail-status-dot"
                                    }
                                    aria-hidden="true"
                                  />
                                  {getProviderHeaderSummary(activeProvider, t)}
                                </p>
                              </div>
                              {activeProvider.isCustomProvider === true ? (
                                <div className="provider-detail-actions">
                                  <button
                                    className="provider-detail-icon-button"
                                    aria-label={`Edit ${activeProvider.name}`}
                                    title="Edit"
                                    type="button"
                                    disabled={activeProviderBusy}
                                    onClick={() => openEditCustomProviderDialog(activeProvider)}
                                  >
                                    <EditIcon />
                                  </button>
                                  <button
                                    className="provider-detail-icon-button is-danger"
                                    aria-label={`${t("app.delete")} ${activeProvider.name}`}
                                    title={t("app.delete")}
                                    type="button"
                                    disabled={activeProviderBusy}
                                    onClick={() => void onDeleteProvider(activeProvider.id)}
                                  >
                                    <DeleteIcon />
                                  </button>
                                </div>
                              ) : null}
                            </div>

                            <div className="provider-detail-divider" />

                            <div className="provider-detail-body">
                              <div className="provider-detail-row">
                                <div className="provider-detail-row-copy">
                                  <span className="settings-field-label">{t("settings.provider.connectionMethod")}</span>
                                </div>

                                <div
                                  className="provider-radio-stack provider-detail-row-control"
                                  role="radiogroup"
                                  aria-label={`${activeProvider.name} connection method`}
                                >
                                  {activeProvider.authCapabilities
                                    .filter((capability) => capability.kind !== "api_key")
                                    .map((capability) => (
                                      <label key={capability.method} className="provider-radio-option">
                                        <input
                                          type="radio"
                                          name={`provider-${activeProvider.id}-connection-method`}
                                          checked={activeProviderSelectedMethod === capability.method}
                                          onChange={() => selectProviderAuthOption(activeProvider.id, capability.method)}
                                        />
                                        <span>{getProviderAuthMethodOptionLabel(activeProvider, capability, t)}</span>
                                      </label>
                                    ))}
                                  {activeProviderApiKeyCapability && activeProvider.env.length > 0 ? (
                                    <label className="provider-radio-option">
                                      <input
                                        type="radio"
                                        name={`provider-${activeProvider.id}-connection-method`}
                                        checked={
                                          activeProviderSelectedMethod === activeProviderApiKeyCapability.method &&
                                          activeProviderApiKeyMode === "environment"
                                        }
                                        onChange={() =>
                                          selectProviderAuthOption(activeProvider.id, activeProviderApiKeyCapability.method, "environment")
                                        }
                                      />
                                      <span>{t("settings.provider.useEnvironmentVariable", { env: activeProvider.env.join(", ") })}</span>
                                    </label>
                                  ) : null}
                                  {activeProviderApiKeyCapability ? (
                                    <label className="provider-radio-option">
                                      <input
                                        type="radio"
                                        name={`provider-${activeProvider.id}-connection-method`}
                                        checked={
                                          activeProviderSelectedMethod === activeProviderApiKeyCapability.method &&
                                          (activeProviderApiKeyMode === "manual" || activeProvider.env.length === 0)
                                        }
                                        onChange={() =>
                                          selectProviderAuthOption(activeProvider.id, activeProviderApiKeyCapability.method, "manual")
                                        }
                                      />
                                      <span>{t("settings.provider.enterApiKeyManually")}</span>
                                    </label>
                                  ) : null}
                                </div>
                              </div>

                              {activeProviderSelectedCapability?.kind === "api_key" ? (
                                <div className="provider-detail-row">
                                  <div className="provider-detail-row-copy">
                                    <span className="settings-field-label">{t("settings.provider.apiKeyLabel")}</span>
                                  </div>

                                  <label className="provider-key-field provider-detail-row-control">
                                    <span className="provider-key-input-wrap">
                                      <input
                                        aria-label={`API key for ${activeProvider.name}`}
                                        type={activeProviderApiKeyVisible ? "text" : "password"}
                                        readOnly={activeProviderUsesEnvironment}
                                        value={
                                          activeProviderUsesEnvironment
                                            ? "••••••••••••••••••••••••"
                                            : activeProviderDraft.apiKey
                                        }
                                        placeholder={getProviderKeyPlaceholder(activeProvider, t)}
                                        onChange={(event) =>
                                          onProviderDraftChange(activeProvider.id, "apiKey", event.target.value)
                                        }
                                      />
                                      <button
                                        className="provider-key-visibility-button"
                                        type="button"
                                        aria-label={
                                          activeProviderApiKeyVisible ? t("settings.provider.hideApiKey") : t("settings.provider.showApiKey")
                                        }
                                        onClick={() => toggleProviderApiKeyVisibility(activeProvider.id)}
                                      >
                                        {activeProviderApiKeyVisible ? <EyeIcon /> : <EyeOffIcon />}
                                      </button>
                                    </span>
                                  </label>
                                </div>
                              ) : null}

                              {activeProviderSelectedCapability?.kind === "browser_oauth" ? (
                                <div className="provider-detail-field">
                                  {isAnyboxProvider(activeProvider) ? (
                                    <>
                                      <p className="provider-detail-helper">{t("settings.account.managedProviderCopy")}</p>
                                      <div className="provider-account-summary" aria-label="Anybox account summary">
                                        <div className="provider-account-summary-row">
                                          <span>{t("settings.account.status")}</span>
                                          <strong>{anyboxAccountView.title}</strong>
                                        </div>
                                        {anyboxAccountView.account?.email ? (
                                          <div className="provider-account-summary-row">
                                            <span>{t("settings.account.email")}</span>
                                            <strong>{anyboxAccountView.account.email}</strong>
                                          </div>
                                        ) : null}
                                        {anyboxAccountView.account?.workspaceName || anyboxAccountPlanLabel ? (
                                          <div className="provider-account-summary-row">
                                            <span>
                                              {t("settings.account.workspace")} / {t("settings.account.plan")}
                                            </span>
                                            <strong>
                                              {[anyboxAccountView.account?.workspaceName, anyboxAccountPlanLabel]
                                                .filter(Boolean)
                                                .join(" / ")}
                                            </strong>
                                          </div>
                                        ) : null}
                                        {anyboxAccountBalance ? (
                                          <div className="provider-account-summary-row">
                                            <span>{t("settings.account.balance")}</span>
                                            <strong>{anyboxAccountBalance}</strong>
                                          </div>
                                        ) : null}
                                      </div>
                                      <div className="settings-inline-actions">
                                        <button
                                          className="primary-button"
                                          type="button"
                                          onClick={() => setActiveSection("account")}
                                        >
                                          {t("settings.account.openAccountPage")}
                                        </button>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <p className="provider-detail-helper">
                                        {activeProviderFlow && !isProviderFlowTerminal(activeProviderFlow.status)
                                          ? activeProviderFlow.errorMessage ?? "请在浏览器中完成登录。"
                                          : activeProviderAccountSummary ?? activeProvider.lastAuthError ?? "使用浏览器登录来连接此 provider。"}
                                      </p>
                                      {activeProvider.authState.status === "connected" ? (
                                        <div className="provider-account-summary" aria-label={`${activeProvider.name} account summary`}>
                                          {activeProviderAccount?.email ? (
                                            <div className="provider-account-summary-row">
                                              <span>{t("settings.account.email")}</span>
                                              <strong>{activeProviderAccount.email}</strong>
                                            </div>
                                          ) : null}
                                          {activeProviderAccount?.workspaceName || activeProviderAccount?.planLabel || activeProviderAccount?.planType ? (
                                            <div className="provider-account-summary-row">
                                              <span>
                                                {t("settings.account.workspace")} / {t("settings.account.plan")}
                                              </span>
                                              <strong>
                                                {[activeProviderAccount.workspaceName, formatProviderPlanLabel(activeProviderAccount)]
                                                  .filter(Boolean)
                                                  .join(" / ")}
                                              </strong>
                                            </div>
                                          ) : null}
                                          {activeProviderBalance ? (
                                            <div className="provider-account-summary-row">
                                              <span>{t("settings.account.balance")}</span>
                                              <strong>{activeProviderBalance}</strong>
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : null}
                                      <div className="settings-inline-actions">
                                        {activeProvider.authState.status !== "not_connected" ? (
                                          <button
                                            className="secondary-button"
                                            type="button"
                                            disabled={activeProviderBusy}
                                            onClick={() => void onDeleteProviderAuthSession(activeProvider.id)}
                                          >
                                            断开连接
                                          </button>
                                        ) : null}
                                        {activeProviderFlow && !isProviderFlowTerminal(activeProviderFlow.status) ? (
                                          <button
                                            className="secondary-button"
                                            type="button"
                                            disabled={activeProviderBusy}
                                            onClick={() => void onCancelProviderAuthFlow(activeProvider.id)}
                                          >
                                            取消
                                          </button>
                                        ) : null}
                                        <button
                                          className="primary-button"
                                          type="button"
                                          disabled={activeProviderBusy}
                                          onClick={() => void onStartProviderAuthFlow(activeProvider.id)}
                                        >
                                          {activeProvider.authState.status === "connected" ? "重新登录" : "继续登录"}
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              ) : null}

                              {activeProviderSelectedCapability?.kind === "device_code" ? (
                                <div className="provider-detail-field">
                                  <div className="settings-field-grid">
                                    <label className="settings-field">
                                      <span className="settings-field-label">验证链接</span>
                                      <input
                                        aria-label={`${activeProvider.name} verification URL`}
                                        type="text"
                                        readOnly
                                        value={activeProviderFlow?.verificationURI ?? ""}
                                        placeholder="启动设备登录后生成链接"
                                      />
                                    </label>

                                    <label className="settings-field">
                                      <span className="settings-field-label">一次性代码</span>
                                      <input
                                        aria-label={`${activeProvider.name} device code`}
                                        type="text"
                                        readOnly
                                        value={activeProviderFlow?.userCode ?? ""}
                                        placeholder="启动设备登录后生成代码"
                                      />
                                    </label>
                                  </div>
                                  <p className="provider-detail-helper">
                                    {activeProviderFlow && !isProviderFlowTerminal(activeProviderFlow.status)
                                      ? activeProviderFlow.errorMessage ?? "输入代码并保持此窗口打开。"
                                      : activeProvider.lastAuthError ?? "当浏览器登录无法完成时使用设备代码连接。"}
                                  </p>
                                  <div className="settings-inline-actions">
                                    {activeProviderFlow?.verificationURI ? (
                                      <button
                                        className="secondary-button"
                                        onClick={() => void openExternalUrl(activeProviderFlow.verificationURI!)}
                                      >
                                        打开链接
                                      </button>
                                    ) : null}
                                    {activeProviderFlow?.verificationURI ? (
                                      <button
                                        className="secondary-button"
                                        onClick={() => void writeTextToClipboard(activeProviderFlow.verificationURI!)}
                                      >
                                        复制链接
                                      </button>
                                    ) : null}
                                    {activeProviderFlow?.userCode ? (
                                      <button
                                        className="secondary-button"
                                        onClick={() => void writeTextToClipboard(activeProviderFlow.userCode!)}
                                      >
                                        复制代码
                                      </button>
                                    ) : null}
                                    {activeProviderFlow && !isProviderFlowTerminal(activeProviderFlow.status) ? (
                                      <button
                                        className="secondary-button"
                                        disabled={activeProviderBusy}
                                        onClick={() => void onCancelProviderAuthFlow(activeProvider.id)}
                                      >
                                        取消
                                      </button>
                                    ) : null}
                                    <button
                                      className="primary-button"
                                      disabled={activeProviderBusy}
                                      onClick={() => void onStartProviderAuthFlow(activeProvider.id)}
                                    >
                                      {activeProviderFlow && !isProviderFlowTerminal(activeProviderFlow.status) ? "重新开始" : "开始设备登录"}
                                    </button>
                                  </div>
                                </div>
                              ) : null}

                              <details className="provider-advanced-settings">
                                <summary>
                                  <span>{t("settings.provider.advancedSettings")}</span>
                                  <ChevronDownIcon />
                                </summary>
                                <div className="provider-advanced-settings-body">
                                  <label className="settings-field">
                                    <span className="settings-field-label">
                                      {isAnyboxProvider(activeProvider) ? "Anybox API URL" : "Base URL"}
                                    </span>
                                    <input
                                      aria-label={`Base URL for ${activeProvider.name}`}
                                      type="text"
                                      value={activeProviderDraft.baseURL}
                                      placeholder={activeProvider.baseURL ?? t("settings.provider.optionalCustomEndpoint")}
                                      onChange={(event) =>
                                        onProviderDraftChange(activeProvider.id, "baseURL", event.target.value)
                                      }
                                    />
                                  </label>
                                </div>
                              </details>
                            </div>

                            <div className="provider-detail-footer">
                              <div className="settings-inline-actions">
                                <button
                                  className="secondary-button"
                                  type="button"
                                  disabled={activeProviderBusy || activeProviderIsTesting}
                                  onClick={handleActiveProviderTest}
                                >
                                  {activeProviderIsTesting ? t("settings.provider.testingConnection") : t("settings.provider.testConnection")}
                                </button>
                                <button
                                  className="primary-button"
                                  aria-label={`Save ${activeProvider.name} settings`}
                                  type="button"
                                  disabled={activeProviderBusy || activeProviderIsTesting || !activeProviderCanSave}
                                  onClick={() => void handleActiveProviderSave()}
                                >
                                  {savingProviderID === activeProvider.id ? t("app.saving") : t("app.save")}
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="settings-panel">
                            <div className="settings-section-header">
                              <div>
                                <h3>{t("settings.provider.providerModels")}</h3>
                              </div>
                            </div>

                            {activeProviderModels.length > 0 ? (
                              <ModelCatalogListView items={activeProviderModels} selectionDraft={selectionDraft} t={t} />
                            ) : (
                              <article className="settings-empty-state">
                                <span className="label">{t("settings.provider.noModelsLabel")}</span>
                                <h3>{t("settings.provider.noModelsTitle")}</h3>
                                <p>{t("settings.provider.noModelsCopy")}</p>
                              </article>
                            )}
                          </div>
                        </>
                      ) : activeCinemaVideoProvider && activeCinemaVideoProviderDraft ? (
                        <>
                          <div className="settings-panel provider-detail-card">
                            <div className="provider-detail-header">
                              <span className="provider-logo is-large" aria-hidden="true">
                                <span className="provider-logo-fallback">{activeCinemaVideoProvider.manifest.name.slice(0, 1).toUpperCase()}</span>
                              </span>
                              <div className="provider-detail-heading">
                                <h3>{activeCinemaVideoProvider.manifest.name}</h3>
                                <p>
                                  <span
                                    className={
                                      activeCinemaVideoProvider.auth.connected
                                        ? "provider-detail-status-dot is-connected"
                                        : "provider-detail-status-dot"
                                    }
                                    aria-hidden="true"
                                  />
                                  {getCinemaVideoProviderHeaderSummary(activeCinemaVideoProvider, t)}
                                </p>
                              </div>
                            </div>

                            <div className="provider-detail-divider" />

                            <div className="provider-detail-body">
                              <div className="provider-account-summary" aria-label={`${activeCinemaVideoProvider.manifest.name} catalog summary`}>
                                <div className="provider-account-summary-row">
                                  <span>{t("settings.videoProviders.providerIdLabel")}</span>
                                  <strong>{activeCinemaVideoProvider.manifest.id}</strong>
                                </div>
                                <div className="provider-account-summary-row">
                                  <span>{t("settings.videoProviders.authTypeLabel")}</span>
                                  <strong>{activeCinemaVideoProvider.manifest.authType ?? "unknown"}</strong>
                                </div>
                                {activeCinemaVideoProvider.manifest.regions?.length ? (
                                  <div className="provider-account-summary-row">
                                    <span>{t("settings.videoProviders.regionsLabel")}</span>
                                    <strong>{activeCinemaVideoProvider.manifest.regions.join(", ")}</strong>
                                  </div>
                                ) : null}
                              </div>

                              {activeCinemaVideoProvider.auth.requiresCredential ? (
                                <div className="provider-detail-row">
                                  <div className="provider-detail-row-copy">
                                    <span className="settings-field-label">{t("settings.provider.apiKeyLabel")}</span>
                                    <p className="provider-detail-helper">
                                      {activeCinemaVideoProvider.auth.connected
                                        ? t("settings.videoProviders.storedCredentialPlaceholder")
                                        : t("settings.videoProviders.credentialPlaceholder")}
                                    </p>
                                  </div>

                                  <label className="provider-key-field provider-detail-row-control">
                                    <span className="provider-key-input-wrap provider-key-input-wrap-plain">
                                      <input
                                        aria-label={`Credential for ${activeCinemaVideoProvider.manifest.name}`}
                                        type="password"
                                        value={activeCinemaVideoProviderDraft.apiKey}
                                        placeholder={
                                          activeCinemaVideoProvider.auth.connected
                                            ? t("settings.videoProviders.storedCredentialPlaceholder")
                                            : t("settings.videoProviders.credentialPlaceholder")
                                        }
                                        onChange={(event) =>
                                          onCinemaVideoProviderDraftChange(activeCinemaVideoProvider.manifest.id, "apiKey", event.target.value)
                                        }
                                      />
                                    </span>
                                  </label>
                                </div>
                              ) : null}

                              <div className="provider-detail-row">
                                <div className="provider-detail-row-copy">
                                  <span className="settings-field-label">{t("settings.videoProviders.endpointLabel")}</span>
                                  <p className="provider-detail-helper">{t("settings.videoProviders.endpointInputHelper")}</p>
                                </div>

                                <div className="provider-detail-row-control provider-endpoint-control">
                                  <div
                                    className="provider-endpoint-current"
                                    aria-label={`Current endpoint for ${activeCinemaVideoProvider.manifest.name}`}
                                  >
                                    <span>{t("settings.videoProviders.endpointCurrentLabel")}</span>
                                    <code title={activeCinemaVideoProviderEndpoint}>
                                      {activeCinemaVideoProviderEndpoint || t("settings.videoProviders.endpointUnavailable")}
                                    </code>
                                    {activeCinemaVideoProviderEndpointSource ? <small>{activeCinemaVideoProviderEndpointSource}</small> : null}
                                  </div>

                                  <label className="provider-key-field">
                                    <span className="provider-key-input-wrap provider-key-input-wrap-plain">
                                      <input
                                        aria-label={`Endpoint for ${activeCinemaVideoProvider.manifest.name}`}
                                        type="url"
                                        value={activeCinemaVideoProviderDraft.baseURL}
                                        placeholder={t("settings.videoProviders.endpointPlaceholder")}
                                        onChange={(event) =>
                                          onCinemaVideoProviderDraftChange(activeCinemaVideoProvider.manifest.id, "baseURL", event.target.value)
                                        }
                                      />
                                    </span>
                                  </label>
                                </div>
                              </div>

                              {activeCinemaVideoProvider.manifest.website || activeCinemaVideoProvider.manifest.doc ? (
                                <div className="settings-inline-actions">
                                  {activeCinemaVideoProvider.manifest.website ? (
                                    <button
                                      className="secondary-button"
                                      type="button"
                                      onClick={() => void openExternalUrl(activeCinemaVideoProvider.manifest.website!)}
                                    >
                                      {t("settings.videoProviders.websiteAction")}
                                    </button>
                                  ) : null}
                                  {activeCinemaVideoProvider.manifest.doc ? (
                                    <button
                                      className="secondary-button"
                                      type="button"
                                      onClick={() => void openExternalUrl(activeCinemaVideoProvider.manifest.doc!)}
                                    >
                                      {t("settings.videoProviders.docsAction")}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>

                            <div className="provider-detail-footer">
                              <div className="settings-inline-actions">
                                <button
                                  className="secondary-button"
                                  type="button"
                                  disabled={
                                    activeCinemaVideoProviderBusy ||
                                    activeCinemaVideoProviderIsTesting ||
                                    !activeCinemaVideoProviderCanTest
                                  }
                                  title={
                                    activeCinemaVideoProviderCanTest
                                      ? undefined
                                      : t("settings.videoProviders.testUnavailable")
                                  }
                                  onClick={() =>
                                    void onTestCinemaVideoProviderConnection(activeCinemaVideoProvider.manifest.id)
                                  }
                                >
                                  {activeCinemaVideoProviderIsTesting
                                    ? t("settings.provider.testingConnection")
                                    : t("settings.provider.testConnection")}
                                </button>
                                {activeCinemaVideoProvider.auth.connected ? (
                                  <button
                                    className="secondary-button"
                                    type="button"
                                    disabled={activeCinemaVideoProviderBusy || activeCinemaVideoProviderIsTesting}
                                    onClick={() => void onSaveCinemaVideoProviderApiKey(activeCinemaVideoProvider.manifest.id, null)}
                                  >
                                    {t("app.clear")}
                                  </button>
                                ) : null}
                                <button
                                  className="primary-button"
                                  aria-label={`Save ${activeCinemaVideoProvider.manifest.name} settings`}
                                  type="button"
                                  disabled={
                                    activeCinemaVideoProviderBusy ||
                                    activeCinemaVideoProviderIsTesting ||
                                    !activeCinemaVideoProviderCanSave
                                  }
                                  onClick={() => void onSaveCinemaVideoProviderApiKey(activeCinemaVideoProvider.manifest.id)}
                                >
                                  {activeCinemaVideoProviderBusy ? t("app.saving") : t("app.save")}
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="settings-panel">
                            <div className="settings-section-header">
                              <div>
                                <h3>{t("settings.videoProviders.providerModels")}</h3>
                              </div>
                            </div>

                            <CinemaVideoModelListView provider={activeCinemaVideoProvider} t={t} />
                          </div>
                        </>
                      ) : (
                        <article className="settings-empty-state settings-detail-empty-state">
                          <span className="label">{t("settings.videoProviders.noProviderLabel")}</span>
                          <h3>{t("settings.videoProviders.emptyTitle")}</h3>
                          <p>{t("settings.videoProviders.emptyCopy")}</p>
                        </article>
                      )}
                    </div>
                  </section>
                ) : activeSection === "mcp" ? (
                  <section className="settings-services-layout" aria-label="MCP server layout">
                    <div className="settings-service-list-panel mcp-servers-list-panel">
                      <div className="mcp-servers-search-row" role="search">
                        <SearchIcon />
                        <input
                          aria-label="Search MCP servers"
                          type="search"
                          value={mcpServerSearchQuery}
                          placeholder="Search servers"
                          onChange={(event) => setMcpServerSearchQuery(event.target.value)}
                        />
                        {mcpServerSearchQuery ? (
                          <button
                            aria-label="Clear MCP server search"
                            title="Clear search"
                            type="button"
                            onClick={() => setMcpServerSearchQuery("")}
                          >
                            <CloseIcon />
                          </button>
                        ) : null}
                      </div>
                      <div className="settings-service-list-body">
                        <div className="settings-service-list mcp-servers-list-stack" role="list" aria-label="MCP servers">
                          {filteredMcpServers.length > 0 ? (
                            filteredMcpServers.map((server) => {
                              const isActive = server.id === activeMcpServerID
                              const pluginSource = getMcpServerPluginSource(server, mcpServerPluginSourceMap)
                              const pluginSourceAriaLabel = pluginSource ? getMcpServerPluginSourceAriaLabel(pluginSource) : null

                              return (
                                <button
                                  key={server.id}
                                  className={isActive ? "settings-service-item is-active" : "settings-service-item"}
                                  aria-label={`${server.name ?? server.id}${pluginSourceAriaLabel ? ` ${pluginSourceAriaLabel}` : ""} ${server.enabled ? "enabled" : "disabled"}`}
                                  aria-pressed={isActive}
                                  onClick={() => onMcpServerSelect(server.id)}
                                >
                                  <div className="settings-service-item-header">
                                    <strong>{server.name ?? server.id}</strong>
                                    <div className="provider-row-statuses">
                                      <span className="settings-badge">{getMcpTransportLabel(server.transport)}</span>
                                      {pluginSource ? (
                                        <span className="settings-badge is-plugin" title={getMcpServerPluginSourceTitle(pluginSource)}>
                                          Plugin
                                        </span>
                                      ) : null}
                                      <span className={server.enabled ? "settings-badge is-highlight" : "settings-badge"}>
                                        {server.enabled ? "Enabled" : "Disabled"}
                                      </span>
                                    </div>
                                  </div>
                                </button>
                              )
                            })
                          ) : mcpServers.length > 0 ? (
                            <article className="settings-empty-state settings-service-list-empty-state">
                              <span className="label">{t("mcp.noMatch")}</span>
                              <h3>{t("mcp.noMatchTitle")}</h3>
                            </article>
                          ) : (
                            <article className="settings-empty-state settings-service-list-empty-state">
                              <span className="label">{t("mcp.noServers")}</span>
                              <h3>{t("mcp.noServersTitle")}</h3>
                              <p>{t("mcp.noServersCopy")}</p>
                            </article>
                          )}

                          <button
                            aria-label="New server"
                            aria-pressed={!activeMcpServer}
                            className={
                              activeMcpServer
                                ? "settings-service-item mcp-servers-new-button"
                                : "settings-service-item mcp-servers-new-button is-active"
                            }
                            onClick={onStartNewMcpServer}
                            title="New server"
                            type="button"
                          >
                            <PlusIcon />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="settings-service-detail-panel">
                      <>
                        <div className="settings-detail-hero">
                          <div>
                            <h3>{activeMcpServer ? activeMcpServer.name ?? activeMcpServer.id : t("mcp.createServer")}</h3>
                            <p className="settings-page-copy">
                              {activeMcpServer
                                ? t("mcp.editServerCopy")
                                : t("mcp.createServerCopy")}
                            </p>
                          </div>

                          <div className="provider-row-statuses">
                            <span className="settings-badge">{activeMcpServer ? "Editing" : "New"}</span>
                            {activeMcpServerPluginSource ? (
                              <span className="settings-badge is-plugin" title={getMcpServerPluginSourceTitle(activeMcpServerPluginSource)}>
                                Plugin
                              </span>
                            ) : null}
                            <span className={mcpServerDraft.enabled ? "settings-badge is-highlight" : "settings-badge"}>
                              {mcpServerDraft.enabled ? "Enabled" : "Disabled"}
                            </span>
                            <span className="settings-badge">{getMcpTransportLabel(mcpServerDraft.transport)}</span>
                          </div>
                        </div>

                        <div className="settings-panel">
                          <div className="settings-section-header mcp-server-configuration-header">
                            <div>
                              <span className="label">{t("mcp.definition")}</span>
                              <h3>{t("mcp.serverConfiguration")}</h3>
                            </div>
                            <div className="mcp-server-configuration-header-side">
                              <div className="settings-inline-actions mcp-server-configuration-actions">
                                {activeMcpServer ? (
                                  <button
                                    className="secondary-button"
                                    disabled={mcpServerBusy}
                                    onClick={() => void onDeleteMcpServer(activeMcpServer.id)}
                                    type="button"
                                  >
                                    {deletingMcpServerID === activeMcpServer.id ? "Removing..." : "Remove"}
                                  </button>
                                ) : null}
                                <button
                                  className="primary-button"
                                  disabled={mcpServerBusy || !mcpServerCanSave}
                                  onClick={() => void onSaveMcpServer()}
                                  type="button"
                                >
                                  {savingMcpServerID === (activeMcpServerID ?? mcpServerDraft.id.trim()) ? "Saving..." : "Save"}
                                </button>
                              </div>
                            </div>
                          </div>

                          {activeMcpServerDiagnostic ? (
                            <div className={activeMcpServerDiagnostic.ok ? "settings-banner is-success" : "settings-banner is-error"}>
                              {activeMcpServerDiagnostic.ok
                                ? activeMcpServerDiagnostic.toolCount > 0
                                  ? `Reachable. Exposed tools: ${activeMcpServerDiagnostic.toolNames.join(", ")}`
                                  : "Reachable, but the server did not expose any tools."
                                : activeMcpServerDiagnostic.error ?? "Tool discovery failed."}
                            </div>
                          ) : null}

                            <div className="settings-field-grid">
                              <label className="settings-field">
                                <span className="settings-field-label">Server ID</span>
                                <input
                                  aria-label="MCP server id"
                                  type="text"
                                  value={mcpServerDraft.id}
                                  placeholder="filesystem"
                                  onChange={(event) => onMcpServerDraftChange("id", event.target.value)}
                                />
                              </label>

                              <label className="settings-field">
                                <span className="settings-field-label">Name</span>
                                <input
                                  aria-label="MCP server name"
                                  type="text"
                                  value={mcpServerDraft.name}
                                  placeholder="Filesystem"
                                  onChange={(event) => onMcpServerDraftChange("name", event.target.value)}
                                />
                              </label>

                              <div className="settings-field">
                                <span className="settings-field-label">Transport</span>
                                <SettingsSelect
                                  ariaLabel="MCP server transport"
                                  options={[
                                    { value: "stdio", label: "Local stdio" },
                                    { value: "remote", label: "Remote HTTP" },
                                    ...(mcpServerDraft.transport === "connector"
                                      ? [{ value: "connector", label: "Connector" }]
                                      : []),
                                  ]}
                                  value={mcpServerDraft.transport}
                                  onChange={(value) => onMcpServerDraftChange("transport", value)}
                                />
                              </div>

                              {mcpServerDraft.transport === "stdio" ? (
                                <label className="settings-field">
                                  <span className="settings-field-label">Command</span>
                                  <input
                                    aria-label="MCP server command"
                                    type="text"
                                    value={mcpServerDraft.command}
                                    placeholder="npx"
                                    onChange={(event) => onMcpServerDraftChange("command", event.target.value)}
                                  />
                                </label>
                              ) : null}

                              {mcpServerDraft.transport === "stdio" ? (
                                <label className="settings-field">
                                  <span className="settings-field-label">Working directory</span>
                                  <input
                                    aria-label="MCP server working directory"
                                    type="text"
                                    value={mcpServerDraft.cwd}
                                    placeholder="Optional, e.g. ~/code"
                                    onChange={(event) => onMcpServerDraftChange("cwd", event.target.value)}
                                  />
                                </label>
                              ) : mcpServerDraft.transport === "remote" ? (
                                <label className="settings-field">
                                  <span className="settings-field-label">Server URL</span>
                                  <input
                                    aria-label="MCP server URL"
                                    type="text"
                                    value={mcpServerDraft.serverUrl}
                                    placeholder="https://mcp.example.com"
                                    onChange={(event) => onMcpServerDraftChange("serverUrl", event.target.value)}
                                  />
                                </label>
                              ) : (
                                <label className="settings-field">
                                  <span className="settings-field-label">Connector ID</span>
                                  <input
                                    aria-label="MCP connector id"
                                    type="text"
                                    value={mcpServerDraft.connectorId}
                                    readOnly
                                  />
                                </label>
                              )}

                              <label className="settings-field">
                                <span className="settings-field-label">Timeout (ms)</span>
                                <input
                                  aria-label="MCP server timeout"
                                  type="text"
                                  value={mcpServerDraft.timeoutMs}
                                  placeholder="Optional"
                                  onChange={(event) => onMcpServerDraftChange("timeoutMs", event.target.value)}
                                />
                              </label>

                              <label className="settings-field settings-checkbox-field">
                                <span className="settings-field-label">Enabled</span>
                                <input
                                  aria-label="Enable MCP server"
                                  checked={mcpServerDraft.enabled}
                                  type="checkbox"
                                  onChange={(event) => onMcpServerDraftChange("enabled", event.target.checked)}
                                />
                              </label>
                            </div>

                            {mcpServerDraft.transport === "stdio" ? (
                              <div className="settings-field-grid">
                                <label className="settings-field">
                                  <span className="settings-field-label">Arguments</span>
                                  <textarea
                                    aria-label="MCP server arguments"
                                    rows={5}
                                    value={mcpServerDraft.args}
                                    placeholder="one argument per line"
                                    onChange={(event) => onMcpServerDraftChange("args", event.target.value)}
                                  />
                                </label>

                                <label className="settings-field">
                                  <span className="settings-field-label">Environment</span>
                                  <textarea
                                    aria-label="MCP server environment"
                                    rows={5}
                                    value={mcpServerDraft.env}
                                    placeholder="KEY=value"
                                    onChange={(event) => onMcpServerDraftChange("env", event.target.value)}
                                  />
                                </label>
                              </div>
                            ) : mcpServerDraft.transport === "remote" ? (
                              <>
                                <div className="settings-field-grid">
                                  <label className="settings-field">
                                    <span className="settings-field-label">Authorization</span>
                                    <input
                                      aria-label="MCP authorization"
                                      type="text"
                                      value={mcpServerDraft.authorization}
                                      placeholder="Optional Authorization header value"
                                      onChange={(event) => onMcpServerDraftChange("authorization", event.target.value)}
                                    />
                                  </label>

                                  <label className="settings-field">
                                    <span className="settings-field-label">Headers</span>
                                    <textarea
                                      aria-label="MCP server headers"
                                      rows={5}
                                      value={mcpServerDraft.headers}
                                      placeholder="KEY=value"
                                      onChange={(event) => onMcpServerDraftChange("headers", event.target.value)}
                                    />
                                  </label>
                                </div>

                                <div className="settings-field-grid">
                                  <div className="settings-field">
                                    <span className="settings-field-label">Allowed tools</span>
                                    <SettingsSelect
                                      ariaLabel="MCP allowed tools mode"
                                      options={[
                                        { value: "all", label: "All tools" },
                                        { value: "names", label: "Named tools only" },
                                        { value: "read-only", label: "Read-only tools" },
                                        { value: "read-only-names", label: "Read-only named tools" },
                                      ]}
                                      value={mcpServerDraft.allowedToolsMode}
                                      onChange={(value) => onMcpServerDraftChange("allowedToolsMode", value)}
                                    />
                                  </div>

                                  {mcpServerDraft.allowedToolsMode === "names" || mcpServerDraft.allowedToolsMode === "read-only-names" ? (
                                    <label className="settings-field">
                                      <span className="settings-field-label">Allowed tool names</span>
                                      <textarea
                                        aria-label="MCP allowed tool names"
                                        rows={5}
                                        value={mcpServerDraft.allowedToolNames}
                                        placeholder="one tool name per line"
                                        onChange={(event) => onMcpServerDraftChange("allowedToolNames", event.target.value)}
                                      />
                                    </label>
                                  ) : null}
                                </div>
                              </>
                            ) : (
                              <div className="settings-actions-row">
                                <span className="settings-helper-text">
                                  {t("mcp.connectorGenerated")}
                                </span>
                              </div>
                            )}

                            <McpToolsPolicyPanel
                              diagnostic={activeMcpServerDiagnostic}
                              draft={mcpServerDraft}
                              onPolicyChange={onMcpToolPolicyChange}
                            />

                            {mcpServerValidationError || mcpServerDraft.transport === "remote" || mcpServerDraft.transport === "connector" ? (
                              <div className="settings-actions-row">
                                <span className="settings-helper-text">
                                  {mcpServerValidationError
                                    ? mcpServerValidationError
                                    : mcpServerDraft.transport === "connector"
                                      ? t("mcp.connectorRuntime")
                                      : t("mcp.remoteRuntime")}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </>
                      </div>
                  </section>
                ) : (
                  <div className="settings-default-layout">
                    <section className="settings-panel">
                      <div className="settings-section-header">
                        <div>
                          <span className="label">Routing</span>
                          <h3>Models</h3>
                        </div>
                      </div>

                      <div className="settings-field-grid">
                        <div className="settings-field">
                          <span className="settings-field-label">Primary model</span>
                          <ProviderModelPicker
                            catalog={catalog}
                            emptyLabel="Use server default"
                            label="Primary model"
                            models={visibleModels}
                            value={selectionDraft.model}
                            onChange={(value) => onSelectionChange("model", value)}
                          />
                        </div>

                        <div className="settings-field">
                          <span className="settings-field-label">Small model</span>
                          <ProviderModelPicker
                            catalog={catalog}
                            emptyLabel="Use server default"
                            label="Small model"
                            models={visibleModels}
                            value={selectionDraft.smallModel}
                            onChange={(value) => onSelectionChange("smallModel", value)}
                          />
                        </div>

                        <div className="settings-field">
                          <span className="settings-field-label">Image generation model</span>
                          <ProviderModelPicker
                            catalog={catalog}
                            emptyLabel="Not configured"
                            label="Image generation model"
                            models={visibleImageModels}
                            value={selectionDraft.imageModel}
                            onChange={(value) => onSelectionChange("imageModel", value)}
                          />
                        </div>

                        <div className="settings-field">
                          <span className="settings-field-label">Default image size</span>
                          <SettingsSelect
                            ariaLabel="Default image size"
                            options={[
                              { value: "", label: "Provider default" },
                              { value: "1024x1024", label: "1024x1024" },
                              { value: "1024x1536", label: "1024x1536" },
                              { value: "1536x1024", label: "1536x1024" },
                            ]}
                            value={selectionDraft.imageDefaultSize ?? ""}
                            onChange={(value) => onSelectionChange("imageDefaultSize", value ? value : null)}
                          />
                        </div>

                        <div className="settings-field">
                          <span className="settings-field-label">Default image count</span>
                          <SettingsSelect
                            ariaLabel="Default image count"
                            options={[
                              { value: "", label: "1 image" },
                              { value: "2", label: "2 images" },
                              { value: "3", label: "3 images" },
                              { value: "4", label: "4 images" },
                            ]}
                            value={selectionDraft.imageDefaultCount?.toString() ?? ""}
                            onChange={(value) => onSelectionChange("imageDefaultCount", value ? Number(value) : null)}
                          />
                        </div>
                      </div>

                    </section>

                    <section className="settings-panel">
                      <div className="settings-section-header">
                        <div>
                          <span className="label">{t("settings.models.catalogLabel")}</span>
                          <h3>{t("settings.models.unifiedCatalogTitle")}</h3>
                        </div>
                      </div>

                      {effectiveModelCatalog.length > 0 ? (
                        <ModelCatalogView
                          filter={modelCatalogFilter}
                          items={effectiveModelCatalog}
                          selectionDraft={selectionDraft}
                          onFilterChange={setModelCatalogFilter}
                          t={t}
                        />
                      ) : (
                        <article className="settings-empty-state">
                          <span className="label">{t("settings.models.connectedModels")}</span>
                          <h3>{t("settings.models.noCatalogTitle")}</h3>
                          <p>{t("settings.models.noCatalogCopy")}</p>
                        </article>
                      )}
                    </section>
                  </div>
                )
              ) : null}
              {isCustomProviderDialogOpen ? (
                <div className="provider-connect-overlay" role="presentation" onClick={handleCustomProviderOverlayClick}>
                  <article className="provider-connect-modal" role="dialog" aria-modal="true" aria-labelledby="custom-provider-title">
                    <header className="provider-connect-header">
                      <div>
                        <span className="label">Custom</span>
                        <h3 id="custom-provider-title">{isEditingCustomProvider ? "Edit Custom Provider" : "Custom Provider"}</h3>
                      </div>

                      <button className="secondary-button" aria-label="Close custom provider dialog" onClick={handleCustomProviderCancel}>
                        Close
                      </button>
                    </header>

                    <div className="provider-connect-body">
                      <label className="settings-field">
                        <span className="settings-field-label">API Base URL</span>
                        <input
                          aria-label="Custom provider API Base URL"
                          autoFocus
                          type="text"
                          value={customProviderDraft.apiBaseURL}
                          placeholder="https://api.example.com/v1"
                          onChange={(event) => onCustomProviderDraftChange("apiBaseURL", event.target.value)}
                        />
                      </label>

                      <label className="settings-field">
                        <span className="settings-field-label">API key</span>
                        <input
                          aria-label="Custom provider API key"
                          type="password"
                          value={customProviderDraft.apiKey}
                          placeholder={isEditingCustomProvider ? "Leave blank to keep saved key" : "Enter API key"}
                          onChange={(event) => onCustomProviderDraftChange("apiKey", event.target.value)}
                        />
                      </label>

                      <label className="settings-field">
                        <span className="settings-field-label">Default model</span>
                        <input
                          aria-label="Custom provider default model"
                          type="text"
                          value={customProviderDraft.defaultModel}
                          placeholder="model-name"
                          onChange={(event) => onCustomProviderDraftChange("defaultModel", event.target.value)}
                        />
                      </label>

                      <label className="settings-field">
                        <span className="settings-field-label">Chat endpoint</span>
                        <input
                          aria-label="Custom provider chat endpoint"
                          type="text"
                          value={customProviderDraft.chatEndpoint}
                          placeholder="/chat/completions"
                          onChange={(event) => onCustomProviderDraftChange("chatEndpoint", event.target.value)}
                        />
                      </label>
                    </div>

                    <div className="settings-actions-row">
                      <div className="settings-inline-actions">
                        <button className="secondary-button" disabled={customProviderBusy} onClick={handleCustomProviderCancel}>
                          Cancel
                        </button>
                        <button
                          className="secondary-button"
                          disabled={customProviderBusy || !customProviderCanSubmit}
                          onClick={handleCustomProviderTest}
                        >
                          {testingProviderID === "custom" ? "Testing..." : "Test"}
                        </button>
                        <button
                          className="primary-button"
                          aria-label="Save custom provider"
                          disabled={customProviderBusy || !customProviderCanSubmit}
                          onClick={() => void handleCustomProviderSave()}
                        >
                          {savingProviderID === "custom" ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  </article>
                </div>
              ) : null}
              </div>
            </div>
          </div>
        </div>
        </div>
      </section>
    )
  }
}

/*
  const [activeTab, setActiveTab] = useState<"provider" | "model">("provider")
  const [connectProviderID, setConnectProviderID] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setActiveTab("provider")
      setConnectProviderID(null)
    }
  }, [isOpen])

  useEffect(() => {
    if (activeTab !== "provider") {
      setConnectProviderID(null)
    }
  }, [activeTab])

  useEffect(() => {
    if (connectProviderID && !catalog.some((item) => item.id === connectProviderID)) {
      setConnectProviderID(null)
    }
  }, [catalog, connectProviderID])

  useEffect(() => {
    if (!isOpen || !connectProviderID) return

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return

      event.preventDefault()

      setConnectProviderID(null)
    }

    window.addEventListener("keydown", handleWindowKeyDown)
    return () => window.removeEventListener("keydown", handleWindowKeyDown)
  }, [connectProviderID, isOpen])

  if (!isOpen) return null

  const modelGroups = models.reduce<Record<string, ProviderModel[]>>((result, model) => {
    result[model.providerID] = [...(result[model.providerID] ?? []), model]
    return result
  }, {})
  const connectedProviderIDs = new Set(catalog.filter((item) => item.available).map((item) => item.id))
  const visibleModels = models.filter((model) => model.available && connectedProviderIDs.has(model.providerID))
  const activeProvider = connectProviderID ? catalog.find((item) => item.id === connectProviderID) ?? null : null
  const activeProviderDraft = activeProvider
    ? (providerDrafts[activeProvider.id] ?? {
        apiKey: "",
        baseURL: activeProvider.baseURL ?? "",
      })
    : null
  const selectionUnchanged =
    savedSelection.model === selectionDraft.model && savedSelection.smallModel === selectionDraft.smallModel
  const showEmptyState = !project
  const showLoadedState = !showEmptyState && !isLoading && !loadError

  async function handleProviderSubmit() {
    if (!activeProvider) return

    const didSave = await onSaveProvider(activeProvider.id)

    if (didSave) {
      setConnectProviderID(null)
    }
  }

  function handleProviderOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return
    setConnectProviderID(null)
  }

  return (
    <section className="settings-page-overlay" role="presentation">
      <div className="settings-page" role="dialog" aria-modal="true" aria-labelledby="settings-page-title">
        <header className="settings-page-header">
          <div>
            <span className="label">Settings</span>
            <h2 id="settings-page-title">Provider &amp; Model</h2>
            <p className="settings-page-copy">Connect providers for this project, then review the models that become available.</p>
          </div>

          <div className="settings-page-actions">
            {project ? (
              <div className="settings-project-chip">
                <strong>{project.name}</strong>
                <span>{project.repositoryRoot ?? project.worktree}</span>
              </div>
            ) : null}
            <button className="secondary-button" aria-label="Close settings" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <div className="settings-page-body">
          <aside className="settings-page-nav" aria-label="Settings sections">
            <button
              className={activeTab === "provider" ? "settings-nav-item is-active" : "settings-nav-item"}
              aria-current={activeTab === "provider" ? "page" : undefined}
              onClick={() => setActiveTab("provider")}
            >
              <span>Provider</span>
              <small>{catalog.length} entries</small>
            </button>
            <button
              className={activeTab === "model" ? "settings-nav-item is-active" : "settings-nav-item"}
              aria-current={activeTab === "model" ? "page" : undefined}
              onClick={() => setActiveTab("model")}
            >
              <span>Model</span>
              <small>{visibleModels.length} available</small>
            </button>
          </aside>

          <div className="settings-page-content">
            {loadError ? <div className="settings-banner is-error">{loadError}</div> : null}

            {showEmptyState ? (
              <article className="settings-empty-state">
                <span className="label">No Project</span>
                <h3>Select a workspace first</h3>
                <p>Provider settings are stored per project. Pick a folder workspace from the sidebar, then reopen settings.</p>
              </article>
            ) : null}

            {isLoading ? (
              <article className="settings-empty-state">
                <span className="label">Loading</span>
                <h3>Fetching provider catalog</h3>
                <p>Reading provider availability, model visibility, and saved project selection.</p>
              </article>
            ) : null}

            {showLoadedState ? (
              <>
                {activeTab === "provider" ? (
                  <section className="settings-panel">
                    <div className="settings-section-header">
                      <div>
                        <span className="label">Catalog</span>
                        <h3>Provider Connections</h3>
                      </div>
                      <p>Select a provider and open a dedicated connect window to submit the API key for this project.</p>
                    </div>

                    <div className="settings-section-summary">
                      <div className="settings-summary-card">
                        <span className="label">Connected</span>
                        <strong>{catalog.filter((provider) => provider.available).length}</strong>
                        <p>Providers already unlocked for this workspace.</p>
                      </div>
                      <div className="settings-summary-card">
                        <span className="label">Potential</span>
                        <strong>{catalog.length}</strong>
                        <p>All providers discovered from the catalog, environment, and project config.</p>
                      </div>
                    </div>

                    <div className="provider-list">
                      {catalog.map((provider) => {
                        const providerModels = modelGroups[provider.id] ?? []
                        const providerBusy = savingProviderID === provider.id || deletingProviderID === provider.id
                        const canResetProvider = provider.source === "config"

                        return (
                          <article key={provider.id} className={provider.available ? "provider-row" : "provider-row is-muted"}>
                            <div className="provider-row-main">
                              <div className="provider-row-heading">
                                <div className="provider-row-title">
                                  <ProviderLogo provider={provider} className="is-large" />
                                  <div>
                                    <span className="label">{providerSourceLabel(provider)}</span>
                                    <h4>{provider.name}</h4>
                                  </div>
                                </div>

                                <div className="provider-row-statuses">
                                  <span className="settings-badge">{provider.available ? "Connected" : "Not connected"}</span>
                                  {provider.apiKeyConfigured ? <span className="settings-badge">Key ready</span> : null}
                                  <span className="settings-badge">{provider.modelCount} models</span>
                                </div>
                              </div>

                              <p className="provider-row-copy">
                                <strong>{provider.id}</strong>
                                {provider.env.length > 0 ? ` / Env ${provider.env.join(", ")}` : " / No env key fallback"}
                                {provider.baseURL ? ` / ${provider.baseURL}` : ""}
                              </p>

                              <div className="provider-row-models">
                                {providerModels.length > 0 ? (
                                  providerModels.slice(0, 3).map((model) => (
                                    <div key={`${model.providerID}/${model.id}`} className="provider-model-chip">
                                      <strong>{model.name}</strong>
                                      <span>{buildModelTags(model, t).join(" / ")}</span>
                                    </div>
                                  ))
                                ) : (
                                  <span className="provider-model-empty">No project-visible models yet.</span>
                                )}
                              </div>
                            </div>

                            <div className="provider-row-actions">
                              {canResetProvider ? (
                                <button
                                  className="secondary-button"
                                  aria-label={`Reset ${provider.name} settings`}
                                  disabled={providerBusy}
                                  onClick={() => void onDeleteProvider(provider.id)}
                                >
                                  {deletingProviderID === provider.id ? "Resetting..." : "Reset"}
                                </button>
                              ) : null}
                              <button
                                className="primary-button"
                                aria-label={`Connect ${provider.name}`}
                                disabled={providerBusy}
                                onClick={() => setConnectProviderID(provider.id)}
                              >
                                Connect
                              </button>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  </section>
                ) : (
                  <section className="settings-panel">
                    <div className="settings-section-header">
                      <div>
                        <span className="label">Routing</span>
                        <h3>Default Model Selection</h3>
                      </div>
                    </div>

                    <div className="settings-field-grid">
                      <div className="settings-field">
                        <span className="settings-field-label">Primary model</span>
                        <ProviderModelPicker
                          catalog={catalog}
                          emptyLabel="Use server default"
                          label="Primary model"
                          models={visibleModels}
                          value={selectionDraft.model}
                          onChange={(value) => onSelectionChange("model", value)}
                        />
                      </div>

                      <div className="settings-field">
                        <span className="settings-field-label">Small model</span>
                        <ProviderModelPicker
                          catalog={catalog}
                          emptyLabel="Use server default"
                          label="Small model"
                          models={visibleModels}
                          value={selectionDraft.smallModel}
                          onChange={(value) => onSelectionChange("smallModel", value)}
                        />
                      </div>
                    </div>

                    <div className="settings-actions-row">
                      <span className="settings-helper-text">Use the small model for lightweight tasks such as naming, titling, or utility generations.</span>
                      <button
                        className="primary-button"
                        aria-label="Save model selection"
                        disabled={isSavingSelection || selectionUnchanged}
                        onClick={() => void onSaveSelection()}
                      >
                        {isSavingSelection ? "Saving..." : "Save model selection"}
                      </button>
                    </div>
                  </section>
                )}

                {activeTab === "model" ? (
                  <section className="settings-panel">
                    <div className="settings-section-header">
                      <div>
                        <span className="label">Available</span>
                        <h3>Connected Models</h3>
                      </div>
                    </div>

                  {visibleModels.length > 0 ? (
                    <div className="model-list">
                      {visibleModels.map((model) => {
                        const providerName = catalog.find((item) => item.id === model.providerID)?.name ?? model.providerID
                        const modelValue = `${model.providerID}/${model.id}`

                        return (
                          <article key={modelValue} className="model-row">
                            <div className="model-row-main">
                              <div className="model-row-heading">
                                <div>
                                  <h4>{model.name}</h4>
                                  <p className="model-row-copy">
                                    <strong>{providerName}</strong>
                                    {model.family ? ` / ${model.family}` : ""}
                                  </p>
                                </div>

                                <div className="model-row-statuses">
                                  <span className="settings-badge">{model.status}</span>
                                  {selectionDraft.model === modelValue ? <span className="settings-badge is-highlight">Primary</span> : null}
                                  {selectionDraft.smallModel === modelValue ? <span className="settings-badge is-highlight">Small</span> : null}
                                </div>
                              </div>

                              <div className="model-row-tags">
                                {buildModelTags(model, t).map((tag) => (
                                  <span key={`${modelValue}-${tag}`} className="settings-badge">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <article className="settings-empty-state">
                      <span className="label">No Models</span>
                      <h3>No connected provider is exposing models yet</h3>
                      <p>Open the Provider tab, connect a provider account or API key, then come back here to review the unlocked models.</p>
                    </article>
                  )}

                  {false ? (
                    <div className="provider-grid">
                    {catalog.map((provider) => {
                      const draft = providerDrafts[provider.id] ?? {
                        apiKey: "",
                        baseURL: provider.baseURL ?? "",
                      }
                      const providerModels = modelGroups[provider.id] ?? []
                      const providerBusy = savingProviderID === provider.id || deletingProviderID === provider.id
                      const providerDirty = draft.apiKey.trim().length > 0 || draft.baseURL.trim() !== (provider.baseURL ?? "")
                      const canResetProvider = provider.source === "config"

                      return (
                        <article key={provider.id} className={provider.available ? "provider-card" : "provider-card is-muted"}>
                          <div className="provider-card-header">
                            <div>
                              <span className="label">{providerSourceLabel(provider)}</span>
                              <h4>{provider.name}</h4>
                            </div>

                            <div className="provider-card-statuses">
                              <span className="settings-badge">{provider.available ? "Available" : "Needs key"}</span>
                              {provider.apiKeyConfigured ? <span className="settings-badge">Key ready</span> : null}
                              <span className="settings-badge">{provider.modelCount} models</span>
                            </div>
                          </div>

                          <p className="provider-card-copy">
                            <strong>{provider.id}</strong>
                            {provider.env.length > 0 ? ` · Env ${provider.env.join(", ")}` : " · No env key required"}
                          </p>

                          <div className="provider-model-strip">
                            {providerModels.length > 0 ? (
                              providerModels.slice(0, 3).map((model) => (
                                <div key={`${model.providerID}/${model.id}`} className="provider-model-chip">
                                  <strong>{model.name}</strong>
                                  <span>{buildModelTags(model, t).join(" · ")}</span>
                                </div>
                              ))
                            ) : (
                              <span className="provider-model-empty">No project-visible models yet.</span>
                            )}
                          </div>

                          <div className="settings-field-grid">
                            <label className="settings-field">
                              <span className="settings-field-label">API key</span>
                              <input
                                aria-label={`API key for ${provider.name}`}
                                type="password"
                                value={draft.apiKey}
                                placeholder={
                                  provider.apiKeyConfigured
                                    ? "Stored key detected. Leave blank to keep it."
                                    : provider.env.length > 0
                                      ? `Or rely on ${provider.env.join(", ")}`
                                      : "Enter API key"
                                }
                                onChange={(event) => onProviderDraftChange(provider.id, "apiKey", event.target.value)}
                              />
                            </label>

                            <label className="settings-field">
                              <span className="settings-field-label">Base URL</span>
                              <input
                                aria-label={`Base URL for ${provider.name}`}
                                type="text"
                                value={draft.baseURL}
                                placeholder={provider.baseURL ?? "Optional custom endpoint"}
                                onChange={(event) => onProviderDraftChange(provider.id, "baseURL", event.target.value)}
                              />
                            </label>
                          </div>

                          <div className="settings-actions-row">
                            <span className="settings-helper-text">
                              {canResetProvider
                                ? "Reset removes the project override and falls back to environment or catalog defaults."
                                : provider.source === "env"
                                  ? "This provider is currently active because the environment already exposes its key."
                                  : "Save a project override to make this provider selectable here."}
                            </span>

                            <div className="settings-inline-actions">
                              <button
                                className="secondary-button"
                                aria-label={`Reset ${provider.name} settings`}
                                disabled={!canResetProvider || providerBusy}
                                onClick={() => void onDeleteProvider(provider.id)}
                              >
                                {deletingProviderID === provider.id ? "Resetting..." : "Reset"}
                              </button>
                              <button
                                className="primary-button"
                                aria-label={`Save ${provider.name} settings`}
                                disabled={providerBusy || !providerDirty}
                                onClick={() => void onSaveProvider(provider.id)}
                              >
                                {savingProviderID === provider.id ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                    </div>
                  ) : null}
                </section>
                ) : null}
              </>
            ) : null}

            {activeProvider && activeProviderDraft ? (
              <div className="provider-connect-overlay" role="presentation" onClick={handleProviderOverlayClick}>
                <article className="provider-connect-modal" role="dialog" aria-modal="true" aria-labelledby="provider-connect-title">
                  <header className="provider-connect-header">
                    <div>
                      <span className="label">{providerSourceLabel(activeProvider)}</span>
                      <h3 id="provider-connect-title">Connect {activeProvider.name}</h3>
                      <p>
                        Enter the API key below, then submit to enable this provider for {project?.name ?? "the current project"}.
                      </p>
                    </div>

                    <button className="secondary-button" aria-label="Close provider connect dialog" onClick={() => setConnectProviderID(null)}>
                      Close
                    </button>
                  </header>

                  <div className="provider-connect-body">
                    <label className="settings-field">
                      <span className="settings-field-label">API key</span>
                      <input
                        aria-label={`API key for ${activeProvider.name}`}
                        autoFocus
                        type="password"
                        value={activeProviderDraft.apiKey}
                        placeholder={
                          activeProvider.apiKeyConfigured
                            ? "Stored key detected. Leave blank to keep it."
                            : activeProvider.env.length > 0
                              ? `Or rely on ${activeProvider.env.join(", ")}`
                              : "Enter API key"
                        }
                        onChange={(event) => onProviderDraftChange(activeProvider.id, "apiKey", event.target.value)}
                      />
                    </label>

                    <label className="settings-field">
                      <span className="settings-field-label">Base URL</span>
                      <input
                        aria-label={`Base URL for ${activeProvider.name}`}
                        type="text"
                        value={activeProviderDraft.baseURL}
                        placeholder={activeProvider.baseURL ?? "Optional custom endpoint"}
                        onChange={(event) => onProviderDraftChange(activeProvider.id, "baseURL", event.target.value)}
                      />
                    </label>
                  </div>

                  <div className="settings-actions-row">
                    <div className="settings-inline-actions">
                      <button className="secondary-button" onClick={() => setConnectProviderID(null)}>
                        Cancel
                      </button>
                      <button
                        className="primary-button"
                        aria-label={`Submit ${activeProvider.name} provider settings`}
                        disabled={
                          savingProviderID === activeProvider.id ||
                          (activeProviderDraft.apiKey.trim().length === 0 && activeProviderDraft.baseURL.trim() === (activeProvider.baseURL ?? ""))
                        }
                        onClick={() => void handleProviderSubmit()}
                      >
                        {savingProviderID === activeProvider.id ? "Submitting..." : "Submit"}
                      </button>
                    </div>
                  </div>
                </article>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
*/
