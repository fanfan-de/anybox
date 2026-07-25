import {
  appearanceTokenValueToCss,
  createAppearanceLiteralFromChannels,
  getAppearanceColorChannels as getSharedAppearanceColorChannels,
  parseAppearanceColorLiteral,
} from "../../../shared/appearance-color"
import {
  APPEARANCE_TOKEN_NAMES,
  type AppearanceTokenMap,
  type AppearanceTokenValue,
} from "../../../shared/appearance"

export type { AppearanceColorChannels } from "../../../shared/appearance-color"

export function normalizeAppearanceColorInputValue(
  value: string | AppearanceTokenValue,
  fallback = "#000000",
) {
  if (typeof value !== "string") return appearanceTokenValueToCss(value)

  const literal = parseAppearanceColorLiteral(value)
  return literal ? appearanceTokenValueToCss(literal) : fallback
}

export function getAppearanceColorChannels(value: string | AppearanceTokenValue) {
  return getSharedAppearanceColorChannels(value)
}

export function withAppearanceColorChannels(
  value: string | AppearanceTokenValue,
  patch: Partial<ReturnType<typeof getSharedAppearanceColorChannels>>,
) {
  return appearanceTokenValueToCss(
    createAppearanceLiteralFromChannels({
      ...getSharedAppearanceColorChannels(value),
      ...patch,
    }),
  )
}

export function applyAppearanceOverrides(root: HTMLElement, overrides: AppearanceTokenMap) {
  for (const tokenName of APPEARANCE_TOKEN_NAMES) {
    const nextValue = overrides[tokenName]
    if (nextValue) {
      root.style.setProperty(`--${tokenName}`, appearanceTokenValueToCss(nextValue))
      continue
    }

    root.style.removeProperty(`--${tokenName}`)
  }
}
