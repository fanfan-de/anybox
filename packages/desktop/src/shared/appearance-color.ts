import Color from "colorjs.io"
import {
  APPEARANCE_BRAND_DEFINITIONS,
  APPEARANCE_CONTRAST_CONTRACTS,
  APPEARANCE_TOKEN_DERIVATIONS,
  APPEARANCE_TOKEN_NAMES,
  DTCG_COLOR_SPACES,
  type AppearanceBrandName,
  type AppearanceTokenLiteral,
  type AppearanceTokenMap,
  type AppearanceTokenName,
  type AppearanceTokenValue,
  type DtcgColorSpace,
  type DtcgColorValue,
} from "./appearance-tokens.generated"

const DTCG_COLOR_SPACE_SET = new Set<string>(DTCG_COLOR_SPACES)
const APPEARANCE_TOKEN_NAME_SET = new Set<string>(APPEARANCE_TOKEN_NAMES)

const DTCG_TO_COLOR_JS_SPACE: Record<DtcgColorSpace, string> = {
  "srgb": "srgb",
  "srgb-linear": "srgb-linear",
  "hsl": "hsl",
  "hwb": "hwb",
  "lab": "lab",
  "lch": "lch",
  "oklab": "oklab",
  "oklch": "oklch",
  "display-p3": "p3",
  "a98-rgb": "a98rgb",
  "prophoto-rgb": "prophoto",
  "rec2020": "rec2020",
  "xyz-d65": "xyz-d65",
  "xyz-d50": "xyz-d50",
}

export interface AppearanceColorChannels {
  red: number
  green: number
  blue: number
  alpha: number
}

export interface AppearanceContrastWarning {
  contractID: string
  kind: "text" | "ui"
  mode: "light" | "dark"
  foregroundToken: AppearanceTokenName
  backgroundToken: AppearanceTokenName
  contrast: number
  minimumContrast: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number, precision = 6) {
  return Number(value.toFixed(precision))
}

function normalizeAlpha(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, 0, 1)
    : 1
}

function toHexChannel(value: number) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")
}

function toDtcgSrgbValue(color: Color): DtcgColorValue {
  const srgb = color.to("srgb").toGamut({ space: "srgb", method: "clip" })
  const components = srgb.coords.map((component) => (
    round(clamp(typeof component === "number" ? component : 0, 0, 1))
  )) as [
    number,
    number,
    number,
  ]
  const channels = components.map((component) => Math.round(component * 255))

  return {
    colorSpace: "srgb",
    components,
    alpha: round(normalizeAlpha(srgb.alpha)),
    hex: `#${channels.map(toHexChannel).join("")}`,
  }
}

function createColorFromDtcg(value: DtcgColorValue) {
  const colorSpace = DTCG_TO_COLOR_JS_SPACE[value.colorSpace]
  const components = value.components.map((component) => {
    if (component === "none") {
      throw new Error(`Anybox cannot apply a DTCG color containing "none" components.`)
    }
    return component
  })

  return new Color(
    colorSpace,
    components as [number, number, number],
    normalizeAlpha(value.alpha),
  )
}

export function createAppearanceLiteralFromChannels(
  channels: AppearanceColorChannels,
): AppearanceTokenLiteral {
  return {
    type: "literal",
    value: toDtcgSrgbValue(
      new Color(
        "srgb",
        [
          clamp(channels.red, 0, 255) / 255,
          clamp(channels.green, 0, 255) / 255,
          clamp(channels.blue, 0, 255) / 255,
        ],
        clamp(channels.alpha, 0, 1),
      ),
    ),
  }
}

export function parseAppearanceColorLiteral(value: string): AppearanceTokenLiteral | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    return {
      type: "literal",
      value: toDtcgSrgbValue(new Color(trimmed)),
    }
  } catch {
    return null
  }
}

export function normalizeDtcgColorValue(input: unknown): DtcgColorValue | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null

  const record = input as Record<string, unknown>
  if (typeof record.colorSpace !== "string" || !DTCG_COLOR_SPACE_SET.has(record.colorSpace)) {
    return null
  }
  if (
    !Array.isArray(record.components) ||
    record.components.length !== 3 ||
    record.components.some(
      (component) =>
        (typeof component !== "number" || !Number.isFinite(component)) &&
        component !== "none",
    )
  ) {
    return null
  }
  if (
    record.alpha !== undefined &&
    (
      typeof record.alpha !== "number" ||
      !Number.isFinite(record.alpha) ||
      record.alpha < 0 ||
      record.alpha > 1
    )
  ) {
    return null
  }
  if (
    record.hex !== undefined &&
    (typeof record.hex !== "string" || !/^#[0-9a-f]{6}$/i.test(record.hex))
  ) {
    return null
  }

  const normalized = {
    colorSpace: record.colorSpace as DtcgColorSpace,
    components: [...record.components] as Array<number | "none">,
    alpha: normalizeAlpha(record.alpha),
    ...(typeof record.hex === "string" ? { hex: record.hex.toLowerCase() } : {}),
  } satisfies DtcgColorValue

  try {
    createColorFromDtcg(normalized)
  } catch {
    return null
  }

  return normalized
}

export function normalizeAppearanceTokenValue(input: unknown): AppearanceTokenValue | null {
  if (typeof input === "string") {
    const aliasMatch = input.trim().match(/^var\(\s*--([a-zA-Z0-9_-]+)\s*\)$/)
    if (aliasMatch) {
      return { type: "alias", token: aliasMatch[1] }
    }
    return parseAppearanceColorLiteral(input)
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return null

  const record = input as Record<string, unknown>
  if (record.type === "literal") {
    const value = normalizeDtcgColorValue(record.value)
    return value ? { type: "literal", value } : null
  }
  if (
    record.type === "alias" &&
    typeof record.token === "string" &&
    record.token.trim() &&
    /^[a-zA-Z0-9_-]+$/.test(record.token)
  ) {
    return { type: "alias", token: record.token }
  }

  return null
}

export function appearanceTokenValueToCss(value: AppearanceTokenValue): string {
  if (value.type === "alias") return `var(--${value.token})`

  const srgb = toDtcgSrgbValue(createColorFromDtcg(value.value))
  const [red, green, blue] = srgb.components.map((component) =>
    component === "none" ? 0 : Math.round(component * 255)
  )
  const alpha = srgb.alpha ?? 1
  if (alpha >= 1) return srgb.hex ?? `rgb(${red}, ${green}, ${blue})`
  return `rgba(${red}, ${green}, ${blue}, ${round(alpha, 3)})`
}

export function getAppearanceColorChannels(value: string | AppearanceTokenValue): AppearanceColorChannels {
  const literal = typeof value === "string"
    ? parseAppearanceColorLiteral(value)
    : value.type === "literal"
      ? value
      : null
  if (!literal) return { red: 0, green: 0, blue: 0, alpha: 1 }

  const srgb = toDtcgSrgbValue(createColorFromDtcg(literal.value))
  return {
    red: Math.round(Number(srgb.components[0]) * 255),
    green: Math.round(Number(srgb.components[1]) * 255),
    blue: Math.round(Number(srgb.components[2]) * 255),
    alpha: srgb.alpha ?? 1,
  }
}

export function withAppearanceColorChannels(
  value: string | AppearanceTokenValue,
  patch: Partial<AppearanceColorChannels>,
) {
  return createAppearanceLiteralFromChannels({
    ...getAppearanceColorChannels(value),
    ...patch,
  })
}

function mixSrgbColors(
  first: DtcgColorValue,
  firstWeight: number,
  second: DtcgColorValue,
  secondWeight: number,
) {
  const firstSrgb = toDtcgSrgbValue(createColorFromDtcg(first))
  const secondSrgb = toDtcgSrgbValue(createColorFromDtcg(second))
  const normalizedFirstWeight = firstWeight / 100
  const normalizedSecondWeight = secondWeight / 100
  const firstAlpha = firstSrgb.alpha ?? 1
  const secondAlpha = secondSrgb.alpha ?? 1
  const alpha =
    firstAlpha * normalizedFirstWeight +
    secondAlpha * normalizedSecondWeight
  const components = [0, 1, 2].map((index) => {
    if (alpha <= Number.EPSILON) return 0
    return (
      Number(firstSrgb.components[index]) * firstAlpha * normalizedFirstWeight +
      Number(secondSrgb.components[index]) * secondAlpha * normalizedSecondWeight
    ) / alpha
  }) as [number, number, number]

  return toDtcgSrgbValue(new Color("srgb", components, alpha))
}

export function resolveAppearanceTokenColors(input: {
  brandTheme: AppearanceBrandName
  overrides?: AppearanceTokenMap
}): Record<AppearanceTokenName, DtcgColorValue> {
  const brand = APPEARANCE_BRAND_DEFINITIONS[input.brandTheme]
  const terra = APPEARANCE_BRAND_DEFINITIONS.terra
  const overrides = input.overrides ?? {}
  const cache = new Map<string, DtcgColorValue>()
  const resolving = new Set<string>()

  function resolveValue(value: AppearanceTokenValue): DtcgColorValue {
    if (value.type === "literal") {
      return toDtcgSrgbValue(createColorFromDtcg(value.value))
    }
    return resolveNode(value.token)
  }

  function resolveNode(nodeName: string): DtcgColorValue {
    const cached = cache.get(nodeName)
    if (cached) return cached
    if (resolving.has(nodeName)) {
      throw new Error(`Appearance token dependency cycle at "--${nodeName}".`)
    }

    resolving.add(nodeName)
    try {
      const tokenName = APPEARANCE_TOKEN_NAME_SET.has(nodeName)
        ? nodeName as AppearanceTokenName
        : null
      const value =
        (tokenName ? overrides[tokenName] : undefined) ??
        brand.tokens[nodeName as keyof typeof brand.tokens] ??
        terra.tokens[nodeName as keyof typeof terra.tokens]

      let resolved: DtcgColorValue
      if (value) {
        resolved = resolveValue(value as AppearanceTokenValue)
      } else {
        const derivation =
          APPEARANCE_TOKEN_DERIVATIONS[nodeName as keyof typeof APPEARANCE_TOKEN_DERIVATIONS]
        if (!derivation) {
          throw new Error(`Unknown appearance token dependency "--${nodeName}".`)
        }
        const [first, second] = derivation.sources
        resolved = mixSrgbColors(
          resolveValue(first.value),
          first.weight,
          resolveValue(second.value),
          second.weight,
        )
      }

      cache.set(nodeName, resolved)
      return resolved
    } finally {
      resolving.delete(nodeName)
    }
  }

  return Object.fromEntries(
    APPEARANCE_TOKEN_NAMES.map((tokenName) => [tokenName, resolveNode(tokenName)]),
  ) as Record<AppearanceTokenName, DtcgColorValue>
}

export function resolveAppearanceTokenCssValues(input: {
  brandTheme: AppearanceBrandName
  overrides?: AppearanceTokenMap
}): Record<AppearanceTokenName, string> {
  const colors = resolveAppearanceTokenColors(input)
  return Object.fromEntries(
    APPEARANCE_TOKEN_NAMES.map((tokenName) => [
      tokenName,
      appearanceTokenValueToCss({ type: "literal", value: colors[tokenName] }),
    ]),
  ) as Record<AppearanceTokenName, string>
}

function compositeColor(
  foreground: DtcgColorValue,
  background: DtcgColorValue,
): DtcgColorValue {
  const foregroundSrgb = toDtcgSrgbValue(createColorFromDtcg(foreground))
  const backgroundSrgb = toDtcgSrgbValue(createColorFromDtcg(background))
  const foregroundAlpha = foregroundSrgb.alpha ?? 1
  const backgroundAlpha = backgroundSrgb.alpha ?? 1
  const alpha = foregroundAlpha + backgroundAlpha * (1 - foregroundAlpha)
  const components = [0, 1, 2].map((index) => {
    if (alpha <= Number.EPSILON) return 0
    return (
      Number(foregroundSrgb.components[index]) * foregroundAlpha +
      Number(backgroundSrgb.components[index]) * backgroundAlpha * (1 - foregroundAlpha)
    ) / alpha
  }) as [number, number, number]
  return toDtcgSrgbValue(new Color("srgb", components, alpha))
}

export function evaluateAppearanceContrastWarnings(input: {
  brandTheme: AppearanceBrandName
  overrides?: AppearanceTokenMap
}): AppearanceContrastWarning[] {
  const colors = resolveAppearanceTokenColors(input)
  const warnings: AppearanceContrastWarning[] = []

  for (const contract of APPEARANCE_CONTRAST_CONTRACTS) {
    for (const mode of ["light", "dark"] as const) {
      const foregroundToken = contract.foreground[mode]
      const backgroundToken = contract.background[mode]
      const background = colors[backgroundToken]
      const foreground = compositeColor(colors[foregroundToken], background)
      const contrast = new Color(
        "srgb",
        foreground.components as [number, number, number],
      ).contrast(
        new Color(
          "srgb",
          background.components as [number, number, number],
        ),
        "WCAG21",
      )

      if (contrast + 0.001 < contract.minimumContrast) {
        warnings.push({
          contractID: contract.id,
          kind: contract.kind,
          mode,
          foregroundToken,
          backgroundToken,
          contrast: round(contrast, 2),
          minimumContrast: contract.minimumContrast,
        })
      }
    }
  }

  return warnings
}
