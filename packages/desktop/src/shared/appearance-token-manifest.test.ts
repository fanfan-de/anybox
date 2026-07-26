import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import postcss from "postcss"
import { describe, expect, it } from "vitest"
import {
  APPEARANCE_TOKEN_GROUPS,
  APPEARANCE_TOKEN_NAMES,
  APPEARANCE_TOKEN_RUNTIME_MAP,
  APPEARANCE_TOKEN_TEST_DATA,
  BUILT_IN_APPEARANCE_THEME_DEFINITIONS,
  DEFAULT_APPEARANCE_THEME_DEFINITION,
  DEFAULT_APPEARANCE_THEME_ID,
} from "./appearance-tokens.generated"
import { createDefaultAppearanceConfigDocument } from "./appearance"

const packageRoot = process.cwd()
const stylesRoot = resolve(packageRoot, "src/renderer/src/styles")
const generatedCss = readFileSync(
  resolve(stylesRoot, "appearance-tokens.generated.css"),
  "utf8",
)
const manualTokensCss = readFileSync(resolve(stylesRoot, "tokens.css"), "utf8")
const manifest = JSON.parse(
  readFileSync(
    resolve(packageRoot, "src/shared/appearance-token-manifest.json"),
    "utf8",
  ),
) as {
  schemaVersion: number
  dtcgVersion: string
  brands: Record<string, { tokens: Record<string, {
    type: string
    token?: string
    value?: { colorSpace?: string }
  }> }>
  derivations: Record<string, {
    kind: string
    colorSpace: string
    compatibility: boolean
    sources: Array<{
      weight: number
      value: { type: string; token?: string }
    }>
  }>
  themes: Array<{ overrides: Record<string, {
    type: string
    token?: string
    value?: { colorSpace?: string }
  }> }>
  compatibility: {
    legacyMixPairCount: number
    legacyDirectMixUsageCount: number
    legacyDirectColorMixUsageCount: number
    allowedDirectMixConsumers: string[]
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function definedCustomProperties(source: string) {
  return new Set(
    Array.from(
      source.matchAll(/^\s*--([a-zA-Z0-9_-]+)\s*:/gm),
      (match) => match[1],
    ),
  )
}

describe("appearance token manifest", () => {
  it("keeps public values literal/alias-only and blends internal", () => {
    const modeTokenNames = new Set<string>(APPEARANCE_TOKEN_NAMES)
    const publicValues = [
      ...Object.values(manifest.brands).flatMap((brand) =>
        Object.values(brand.tokens),
      ),
      ...manifest.themes.flatMap((theme) => Object.values(theme.overrides)),
    ]

    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.dtcgVersion).toBe("2025.10")
    expect(publicValues.every((value) =>
      value.type === "literal" || value.type === "alias"
    )).toBe(true)
    for (const value of publicValues) {
      if (value.type === "literal") {
        expect(value.value?.colorSpace).toBe("srgb")
      } else {
        expect(modeTokenNames.has(value.token ?? "")).toBe(true)
      }
    }

    for (const [name, derivation] of Object.entries(manifest.derivations)) {
      expect(derivation).toMatchObject({
        kind: "blend",
        colorSpace: "srgb",
      })
      expect(derivation.sources).toHaveLength(2)
      expect(derivation.sources.reduce(
        (total, source) => total + source.weight,
        0,
      )).toBe(100)
      expect(name.startsWith("mix-")).toBe(derivation.compatibility)
      expect(derivation.sources.every((source) =>
        source.value.type === "literal" || source.value.type === "alias"
      )).toBe(true)
    }
  })

  it("keeps detail icon colors independent from panel, brand, and blend tokens", () => {
    const detailIconModeTokens = [
      "semantic-detail-icon-surface-light",
      "semantic-detail-icon-surface-dark",
      "semantic-detail-icon-border-light",
      "semantic-detail-icon-border-dark",
      "semantic-detail-icon-text-light",
      "semantic-detail-icon-text-dark",
    ]

    for (const tokenName of detailIconModeTokens) {
      expect(manifest.brands.terra.tokens[tokenName]?.type).toBe("literal")
      expect(manifest.brands.sage.tokens[tokenName]?.type).toBe("literal")
      expect(manifest.derivations[tokenName]).toBeUndefined()
      for (const theme of manifest.themes) {
        const override = theme.overrides[tokenName]
        if (override) expect(override.type).toBe("literal")
      }
    }
  })

  it("generates one complete typed catalog for editor and runtime consumers", () => {
    const rows: Array<{
      id: keyof typeof APPEARANCE_TOKEN_RUNTIME_MAP
      lightToken: (typeof APPEARANCE_TOKEN_NAMES)[number]
      darkToken: (typeof APPEARANCE_TOKEN_NAMES)[number]
    }> = []
    for (const group of APPEARANCE_TOKEN_GROUPS) {
      for (const row of group.rows) rows.push(row)
    }
    const modeTokens = rows.flatMap((row) => [row.lightToken, row.darkToken])
    const runtimeTokens = rows.map((row) => APPEARANCE_TOKEN_RUNTIME_MAP[row.id])
    const modeTokenSet = new Set<string>(modeTokens)

    expect(APPEARANCE_TOKEN_GROUPS).toHaveLength(APPEARANCE_TOKEN_TEST_DATA.groupCount)
    expect(rows).toHaveLength(APPEARANCE_TOKEN_TEST_DATA.pairCount)
    expect(APPEARANCE_TOKEN_NAMES).toEqual(modeTokens)
    expect(new Set(modeTokens).size).toBe(modeTokens.length)
    expect(new Set(runtimeTokens).size).toBe(runtimeTokens.length)
    expect(runtimeTokens.filter((tokenName) => modeTokenSet.has(tokenName))).toEqual([])
  })

  it("generates every mode definition and light/dark runtime alias", () => {
    for (const group of APPEARANCE_TOKEN_GROUPS) {
      for (const row of group.rows) {
        const runtimeToken = APPEARANCE_TOKEN_RUNTIME_MAP[row.id]
        expect(generatedCss).toMatch(
          new RegExp(`--${escapeRegExp(row.lightToken)}\\s*:`),
        )
        expect(generatedCss).toMatch(
          new RegExp(`--${escapeRegExp(row.darkToken)}\\s*:`),
        )
        expect(generatedCss).toMatch(
          new RegExp(
            `--${escapeRegExp(runtimeToken)}\\s*:\\s*var\\(--${escapeRegExp(row.lightToken)}\\)`,
          ),
        )

        const darkAliasMatches = generatedCss.match(
          new RegExp(
            `--${escapeRegExp(runtimeToken)}\\s*:\\s*var\\(--${escapeRegExp(row.darkToken)}\\)`,
            "g",
          ),
        )
        expect(darkAliasMatches).toHaveLength(2)
      }
    }
  })

  it("keeps manifest-owned declarations out of the manual compatibility token file", () => {
    const manualDefinitions = definedCustomProperties(manualTokensCss)
    const managedDefinitions = [
      ...APPEARANCE_TOKEN_NAMES,
      ...APPEARANCE_TOKEN_GROUPS.flatMap((group) =>
        group.rows.map((row) => APPEARANCE_TOKEN_RUNTIME_MAP[row.id]),
      ),
    ]

    expect(managedDefinitions.filter((name) => manualDefinitions.has(name))).toEqual([])
  })

  it("prevents component styles from consuming light/dark mode tokens directly", () => {
    const modeTokenNames = new Set<string>(APPEARANCE_TOKEN_NAMES)
    const violations: string[] = []

    for (const fileName of readdirSync(stylesRoot)) {
      if (
        !fileName.endsWith(".css") ||
        fileName === "tokens.css" ||
        fileName === "appearance-tokens.generated.css"
      ) {
        continue
      }

      const source = readFileSync(resolve(stylesRoot, fileName), "utf8")
      for (const match of source.matchAll(/var\(\s*--([a-zA-Z0-9_-]+)/g)) {
        if (modeTokenNames.has(match[1])) {
          const violation = `${fileName}: --${match[1]}`
          violations.push(violation)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it("forbids runtime color mixing in component styles", () => {
    const violations: string[] = []

    expect(manifest.compatibility.legacyDirectColorMixUsageCount).toBe(0)
    for (const fileName of readdirSync(stylesRoot)) {
      if (
        !fileName.endsWith(".css") ||
        fileName === "tokens.css" ||
        fileName === "appearance-tokens.generated.css"
      ) {
        continue
      }

      const source = readFileSync(resolve(stylesRoot, fileName), "utf8")
      const count = Array.from(source.matchAll(/color-mix\s*\(/g)).length
      if (count > 0) violations.push(`${fileName}: ${count}`)
    }

    expect(violations).toEqual([])
  })

  it("keeps legacy mix compatibility closed after the component migration", () => {
    const violations: string[] = []

    expect(manifest.compatibility).toMatchObject({
      legacyMixPairCount: 0,
      legacyDirectMixUsageCount: 0,
      legacyDirectColorMixUsageCount: 0,
      allowedDirectMixConsumers: [],
    })
    expect(
      Object.keys(manifest.derivations).filter((name) => name.startsWith("mix-")),
    ).toEqual([])

    for (const fileName of readdirSync(stylesRoot)) {
      if (
        !fileName.endsWith(".css") ||
        fileName === "appearance-tokens.generated.css"
      ) {
        continue
      }

      const source = readFileSync(resolve(stylesRoot, fileName), "utf8")
      const count = Array.from(source.matchAll(/var\(\s*--mix-/g)).length
      if (count > 0) violations.push(`${fileName}: ${count}`)
    }

    expect(violations).toEqual([])
  })

  it("forbids hardcoded colors in theme-aware component styles", () => {
    const violations: string[] = []
    const colorLiteral =
      /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi

    for (const fileName of readdirSync(stylesRoot)) {
      if (
        !fileName.endsWith(".css") ||
        fileName === "tokens.css" ||
        fileName === "debug.css" ||
        fileName === "appearance-tokens.generated.css"
      ) {
        continue
      }

      const source = readFileSync(resolve(stylesRoot, fileName), "utf8")
      const root = postcss.parse(source, { from: fileName })
      root.walkDecls((declaration) => {
        const matches = Array.from(declaration.value.matchAll(colorLiteral))
        if (matches.length === 0) return
        violations.push(
          `${fileName}:${declaration.source?.start?.line ?? 0} ${declaration.prop}: ${declaration.value}`,
        )
      })
    }

    expect(violations).toEqual([])
  })

  it("derives the default config and built-in themes from the same generated data", () => {
    const defaultDocument = createDefaultAppearanceConfigDocument()

    expect(DEFAULT_APPEARANCE_THEME_DEFINITION.id).toBe(DEFAULT_APPEARANCE_THEME_ID)
    expect(defaultDocument).toMatchObject({
      version: 2,
      brandTheme: DEFAULT_APPEARANCE_THEME_DEFINITION.brandTheme,
      colorMode: DEFAULT_APPEARANCE_THEME_DEFINITION.colorMode,
      fontFamily: DEFAULT_APPEARANCE_THEME_DEFINITION.fontFamily,
      overrides: DEFAULT_APPEARANCE_THEME_DEFINITION.overrides,
      foreignDtcg: {},
    })
    expect(BUILT_IN_APPEARANCE_THEME_DEFINITIONS.map((theme) => theme.id)).toEqual(
      APPEARANCE_TOKEN_TEST_DATA.themeIds,
    )
  })
})
