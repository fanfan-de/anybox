import { APPEARANCE_TOKEN_NAMES, type AppearanceTokenMap, type AppearanceTokenName } from "../../../shared/appearance"

const RGB_COMMA_COLOR_PATTERN =
  /^rgba?\(\s*(?<red>\d{1,3})\s*,\s*(?<green>\d{1,3})\s*,\s*(?<blue>\d{1,3})(?:\s*,\s*(?<alpha>[\d.]+%?))?\s*\)$/i
const RGB_SLASH_COLOR_PATTERN =
  /^rgba?\(\s*(?<red>\d{1,3})\s+(?<green>\d{1,3})\s+(?<blue>\d{1,3})(?:\s*\/\s*(?<alpha>[\d.]+%?))?\s*\)$/i
const HEX_ALPHA_COLOR_PATTERN = /^#[0-9a-f]{8}$/i
const SHORT_HEX_COLOR_PATTERN = /^#(?<r>[0-9a-f])(?<g>[0-9a-f])(?<b>[0-9a-f])$/i
const SHORT_HEX_ALPHA_COLOR_PATTERN = /^#(?<r>[0-9a-f])(?<g>[0-9a-f])(?<b>[0-9a-f])(?<a>[0-9a-f])$/i
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

export interface AppearanceColorChannels {
  red: number
  green: number
  blue: number
  alpha: number
}

function clampRgbChannel(value: number) {
  return Math.max(0, Math.min(255, value))
}

function clampAlpha(value: number) {
  return Math.max(0, Math.min(1, value))
}

function toHexChannel(value: number) {
  return clampRgbChannel(value).toString(16).padStart(2, "0")
}

function parseAlphaChannel(value: string | undefined, fallback = 1) {
  if (!value) return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback

  if (trimmed.endsWith("%")) {
    const nextValue = Number.parseFloat(trimmed.slice(0, -1)) / 100
    return Number.isFinite(nextValue) ? clampAlpha(nextValue) : fallback
  }

  const nextValue = Number.parseFloat(trimmed)
  return Number.isFinite(nextValue) ? clampAlpha(nextValue) : fallback
}

function parseAppearanceColorChannels(value: string): AppearanceColorChannels | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (HEX_COLOR_PATTERN.test(trimmed)) {
    return {
      red: Number.parseInt(trimmed.slice(1, 3), 16),
      green: Number.parseInt(trimmed.slice(3, 5), 16),
      blue: Number.parseInt(trimmed.slice(5, 7), 16),
      alpha: 1,
    }
  }

  if (HEX_ALPHA_COLOR_PATTERN.test(trimmed)) {
    return {
      red: Number.parseInt(trimmed.slice(1, 3), 16),
      green: Number.parseInt(trimmed.slice(3, 5), 16),
      blue: Number.parseInt(trimmed.slice(5, 7), 16),
      alpha: Number.parseInt(trimmed.slice(7, 9), 16) / 255,
    }
  }

  const shortHexMatch = trimmed.match(SHORT_HEX_COLOR_PATTERN)
  if (shortHexMatch?.groups) {
    const { r, g, b } = shortHexMatch.groups
    return {
      red: Number.parseInt(`${r}${r}`, 16),
      green: Number.parseInt(`${g}${g}`, 16),
      blue: Number.parseInt(`${b}${b}`, 16),
      alpha: 1,
    }
  }

  const shortHexAlphaMatch = trimmed.match(SHORT_HEX_ALPHA_COLOR_PATTERN)
  if (shortHexAlphaMatch?.groups) {
    const { r, g, b, a } = shortHexAlphaMatch.groups
    return {
      red: Number.parseInt(`${r}${r}`, 16),
      green: Number.parseInt(`${g}${g}`, 16),
      blue: Number.parseInt(`${b}${b}`, 16),
      alpha: Number.parseInt(`${a}${a}`, 16) / 255,
    }
  }

  const rgbMatch = trimmed.match(RGB_COMMA_COLOR_PATTERN) ?? trimmed.match(RGB_SLASH_COLOR_PATTERN)
  if (rgbMatch?.groups) {
    return {
      red: Number.parseInt(rgbMatch.groups.red, 10),
      green: Number.parseInt(rgbMatch.groups.green, 10),
      blue: Number.parseInt(rgbMatch.groups.blue, 10),
      alpha: parseAlphaChannel(rgbMatch.groups.alpha),
    }
  }

  return null
}

function formatHexColor({ red, green, blue }: AppearanceColorChannels) {
  return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`
}

function formatAlpha(value: number) {
  return String(Number(clampAlpha(value).toFixed(3)))
}

function formatAppearanceColorValue(channels: AppearanceColorChannels) {
  const alpha = clampAlpha(channels.alpha)
  if (alpha >= 1) return formatHexColor(channels)

  return `rgba(${clampRgbChannel(channels.red)}, ${clampRgbChannel(channels.green)}, ${clampRgbChannel(channels.blue)}, ${formatAlpha(alpha)})`
}

export function normalizeAppearanceColorInputValue(value: string, fallback = "#000000") {
  const channels = parseAppearanceColorChannels(value)
  return channels ? formatAppearanceColorValue(channels) : fallback
}

export function getAppearanceColorChannels(value: string): AppearanceColorChannels {
  return parseAppearanceColorChannels(value) ?? { red: 0, green: 0, blue: 0, alpha: 1 }
}

export function withAppearanceColorChannels(value: string, patch: Partial<AppearanceColorChannels>) {
  return formatAppearanceColorValue({
    ...getAppearanceColorChannels(value),
    ...patch,
  })
}

export function applyAppearanceOverrides(root: HTMLElement, overrides: AppearanceTokenMap) {
  for (const tokenName of APPEARANCE_TOKEN_NAMES) {
    const nextValue = overrides[tokenName]
    if (nextValue) {
      root.style.setProperty(`--${tokenName}`, nextValue)
      continue
    }

    root.style.removeProperty(`--${tokenName}`)
  }
}

export function readResolvedAppearanceTokenValues(root: HTMLElement): Record<AppearanceTokenName, string> {
  const styles = getComputedStyle(root)
  return Object.fromEntries(
    APPEARANCE_TOKEN_NAMES.map((tokenName) => {
      const value = styles.getPropertyValue(`--${tokenName}`).trim()
      return [tokenName, normalizeAppearanceColorInputValue(value)]
    }),
  ) as Record<AppearanceTokenName, string>
}
