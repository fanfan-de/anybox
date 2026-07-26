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
import { resolveAppearanceTokenColors } from "./appearance-color"

const packageRoot = process.cwd()
const stylesRoot = resolve(packageRoot, "src/renderer/src/styles")
const generatedCss = readFileSync(
  resolve(stylesRoot, "appearance-tokens.generated.css"),
  "utf8",
)
const manualTokensCss = readFileSync(resolve(stylesRoot, "tokens.css"), "utf8")
const baseCss = readFileSync(resolve(stylesRoot, "base.css"), "utf8")
const calendarCss = readFileSync(resolve(stylesRoot, "calendar.css"), "utf8")
const composerCss = readFileSync(resolve(stylesRoot, "composer.css"), "utf8")
const rightSidebarCss = readFileSync(resolve(stylesRoot, "right-sidebar.css"), "utf8")
const settingsCss = readFileSync(resolve(stylesRoot, "settings.css"), "utf8")
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

  it("gives plugin marketplace rows their own hover surface semantic", () => {
    const pluginMarketplaceGroup = APPEARANCE_TOKEN_GROUPS.find(
      (group) => group.id === "component-plugin-marketplace",
    )

    expect(pluginMarketplaceGroup?.rows.map((row) => row.id)).toContain(
      "semantic-plugin-market-item-surface-hover",
    )
    expect(generatedCss).toMatch(
      /--semantic-plugin-market-item-surface-hover-light:\s*var\(--surface-shell-light\);/,
    )
    expect(generatedCss).toMatch(
      /--semantic-plugin-market-item-surface-hover-dark:\s*var\(--surface-shell-dark\);/,
    )
    expect(settingsCss).toMatch(
      /\.plugins-page-main\s*\{[^}]*--plugins-market-item-surface-hover:\s*var\(--semantic-plugin-market-item-surface-hover\);/s,
    )

    const pluginItemHoverRule = settingsCss.match(
      /\.plugins-market-item:hover,\s*\.plugins-market-item:has\(\.plugins-market-item-main:focus-visible\),\s*\.plugins-market-item\.is-active\s*\{[^}]*\}/s,
    )?.[0] ?? ""

    expect(pluginItemHoverRule).toContain(
      "background: var(--plugins-market-item-surface-hover);",
    )
    expect(pluginItemHoverRule).not.toContain("--plugins-market-surface-hover")
    expect(pluginItemHoverRule).not.toContain("--seg-shell")
    expect(pluginItemHoverRule).not.toContain("--semantic-list-detail-row-surface-hover")
  })

  it("routes appearance color mode cards through segmented-control semantics", () => {
    const colorModeRules =
      settingsCss.match(/\.settings-color-mode[^{}]*\{[^{}]*\}/g)?.join("\n") ?? ""

    expect(colorModeRules).toContain("--semantic-segmented-control-surface")
    expect(colorModeRules).toContain("--semantic-segmented-control-border")
    expect(colorModeRules).toContain("--semantic-segmented-control-item-surface-hover")
    expect(colorModeRules).toContain("--semantic-segmented-control-item-surface-active")
    expect(colorModeRules).toContain("--semantic-segmented-control-item-text")
    expect(colorModeRules).toContain("--semantic-segmented-control-item-text-hover")
    expect(colorModeRules).toContain("--semantic-segmented-control-item-text-active")
    expect(colorModeRules).not.toMatch(
      /var\(--(?:color-|seg-(?:accent|border|danger|panel|shell|text)|surface-|text-|border-|brand-|mix-)/,
    )
    expect(colorModeRules).not.toContain("color-mix(")
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

  it("exposes complete field semantics and uses them for editable fields", () => {
    const fieldGroup = APPEARANCE_TOKEN_GROUPS.find((group) => group.id === "component-fields")

    expect(fieldGroup?.rows.map((row) => row.id)).toEqual([
      "semantic-field-surface",
      "semantic-field-surface-muted",
      "semantic-field-surface-focus",
      "semantic-field-surface-disabled",
      "semantic-field-border",
      "semantic-field-border-focus",
      "semantic-field-border-disabled",
      "semantic-field-border-invalid",
      "semantic-field-text",
      "semantic-field-caret",
      "semantic-field-text-disabled",
      "semantic-field-placeholder",
    ])
    expect(generatedCss).toMatch(
      /--semantic-field-surface-light:\s*var\(--surface-panel-light\);/,
    )
    expect(generatedCss).toMatch(
      /--semantic-field-surface:\s*var\(--semantic-field-surface-dark\);/,
    )
    expect(generatedCss).toMatch(
      /--semantic-field-caret-light:\s*var\(--semantic-field-text-light\);/,
    )
    expect(generatedCss).toMatch(
      /--semantic-field-caret:\s*var\(--semantic-field-caret-dark\);/,
    )
    expect(baseCss).toMatch(
      /input,\s*textarea\s*\{[^}]*caret-color:\s*var\(--semantic-field-caret\);/s,
    )
    expect(composerCss).toMatch(
      /\.composer-editor-input\s*\{[^}]*caret-color:\s*var\(--semantic-field-caret\);/s,
    )
    expect(composerCss).not.toMatch(
      /\.composer-editor-input\s*\{[^}]*caret-color:\s*var\(--(?:seg-accent|brand-accent-active)\);/s,
    )
    for (const theme of BUILT_IN_APPEARANCE_THEME_DEFINITIONS) {
      const colors = resolveAppearanceTokenColors({
        brandTheme: theme.brandTheme,
        overrides: { ...theme.overrides },
      })
      expect(colors["semantic-field-caret-light"].alpha ?? 1).toBeGreaterThan(0)
      expect(colors["semantic-field-caret-dark"].alpha ?? 1).toBeGreaterThan(0)
    }
    expect(baseCss).toMatch(
      /\.search-field input\s*\{[^}]*border:\s*1px solid var\(--semantic-field-border\);[^}]*background:\s*var\(--semantic-field-surface\);[^}]*color:\s*var\(--semantic-field-text\);/s,
    )
    expect(rightSidebarCss).toMatch(
      /\.preview-toolbar-address\s*\{[^}]*border:\s*1px solid var\(--semantic-field-border\);[^}]*background:\s*var\(--semantic-field-surface\);/s,
    )
    expect(rightSidebarCss).not.toMatch(
      /\.preview-toolbar-address\s*\{[^}]*background:\s*var\(--seg-panel\);/s,
    )
    expect(calendarCss).toMatch(
      /\.calendar-source-search\s*\{[^}]*border:\s*1px solid var\(--semantic-field-border\);[^}]*background:\s*var\(--semantic-field-surface\);/s,
    )
    expect(calendarCss).toMatch(
      /\.calendar-source-search:focus-within\s*\{[^}]*border-color:\s*var\(--semantic-field-border-focus\);[^}]*background:\s*var\(--semantic-field-surface-focus\);/s,
    )
    expect(calendarCss).toMatch(
      /\.calendar-source-search input\s*\{[^}]*color:\s*var\(--semantic-field-text\);[^}]*background:\s*transparent;/s,
    )
    expect(calendarCss).toMatch(
      /\.calendar-source-search input::placeholder\s*\{[^}]*color:\s*var\(--semantic-field-placeholder\);/s,
    )
  })

  it("exposes complete dropdown option semantics and uses them for selection pickers", () => {
    const dropdownGroup = APPEARANCE_TOKEN_GROUPS.find(
      (group) => group.id === "component-dropdown-select",
    )

    expect(dropdownGroup?.rows.map((row) => row.id)).toEqual([
      "semantic-dropdown-menu-surface",
      "semantic-dropdown-option-surface-hover",
      "semantic-dropdown-option-surface-selected",
      "semantic-dropdown-option-text",
      "semantic-dropdown-option-text-hover",
      "semantic-dropdown-option-text-selected",
      "semantic-dropdown-option-meta-text",
      "semantic-dropdown-option-meta-text-selected",
    ])
    expect(generatedCss).toMatch(
      /--semantic-dropdown-option-surface-hover-light:\s*var\(--surface-panel-muted-light\);/,
    )
    expect(generatedCss).toMatch(
      /--semantic-dropdown-option-surface-selected-dark:\s*var\(--brand-primary-soft-dark\);/,
    )
    expect(calendarCss).toMatch(
      /\.calendar-project-filter-menu\s*\{[^}]*background:\s*var\(--semantic-dropdown-menu-surface\);/s,
    )
    expect(calendarCss).toMatch(
      /\.calendar-project-filter-option\s*\{[^}]*color:\s*var\(--semantic-dropdown-option-text\);[^}]*background:\s*transparent;/s,
    )
    expect(calendarCss).toMatch(
      /\.calendar-project-filter-option:hover,\s*\.calendar-project-filter-option:focus-visible\s*\{[^}]*color:\s*var\(--semantic-dropdown-option-text-hover\);[^}]*background:\s*var\(--semantic-dropdown-option-surface-hover\);/s,
    )
    expect(calendarCss).toMatch(
      /\.calendar-project-filter-option\.is-selected\s*\{[^}]*color:\s*var\(--semantic-dropdown-option-text-selected\);[^}]*background:\s*var\(--semantic-dropdown-option-surface-selected\);/s,
    )
    expect(calendarCss).toMatch(
      /\.calendar-project-filter-option\.is-selected strong\s*\{[^}]*color:\s*var\(--semantic-dropdown-option-meta-text-selected\);/s,
    )

    const dropdownStyles = calendarCss.slice(
      calendarCss.indexOf(".calendar-project-filter-menu"),
      calendarCss.indexOf(".calendar-section-heading"),
    )
    expect(dropdownStyles).not.toContain("--calendar-control-")
    expect(dropdownStyles).not.toContain("--calendar-panel")

    expect(settingsCss).toMatch(
      /\.provider-model-picker-button\s*\{[^}]*border:\s*1px solid var\(--semantic-button-secondary-border\);[^}]*background:\s*var\(--semantic-button-secondary-surface\);[^}]*color:\s*var\(--semantic-button-secondary-text\);/s,
    )
    expect(settingsCss).toMatch(
      /\.provider-model-picker-button:hover,\s*\.provider-model-picker-button:focus-visible,\s*\.provider-model-picker-button\.is-open\s*\{[^}]*border-color:\s*var\(--semantic-button-secondary-border-hover\);[^}]*background:\s*var\(--semantic-button-secondary-surface-hover\);[^}]*color:\s*var\(--semantic-button-secondary-text-hover\);/s,
    )
    expect(settingsCss).toMatch(
      /\.provider-model-picker-panel\s*\{[^}]*background:\s*var\(--semantic-dropdown-menu-surface\);[^}]*color:\s*var\(--semantic-dropdown-option-text\);/s,
    )
    expect(settingsCss).toMatch(
      /\.provider-model-picker-search\s*\{[^}]*border:\s*1px solid var\(--semantic-field-border\);[^}]*background:\s*var\(--semantic-field-surface\);[^}]*color:\s*var\(--semantic-field-text\);/s,
    )
    expect(settingsCss).toMatch(
      /\.provider-model-picker-search::placeholder\s*\{[^}]*color:\s*var\(--semantic-field-placeholder\);/s,
    )
    expect(settingsCss).toMatch(
      /\.provider-model-picker-search:focus\s*\{[^}]*border-color:\s*var\(--semantic-field-border-focus\);[^}]*background:\s*var\(--semantic-field-surface-focus\);/s,
    )
    expect(settingsCss).toMatch(
      /\.provider-model-picker-provider\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-dropdown-option-text\);/s,
    )
    expect(settingsCss).toMatch(
      /\.provider-model-picker-model\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-dropdown-option-text\);/s,
    )
    expect(settingsCss).toMatch(
      /\.provider-model-picker-provider:hover,\s*\.provider-model-picker-provider:focus-visible\s*\{[^}]*background:\s*var\(--semantic-dropdown-option-surface-hover\);[^}]*color:\s*var\(--semantic-dropdown-option-text-hover\);/s,
    )
    expect(settingsCss).toMatch(
      /\.provider-model-picker-model:hover,\s*\.provider-model-picker-model:focus-visible\s*\{[^}]*background:\s*var\(--semantic-dropdown-option-surface-hover\);[^}]*color:\s*var\(--semantic-dropdown-option-text-hover\);/s,
    )
    expect(settingsCss).toMatch(
      /\.provider-model-picker-provider\.is-active\s*\{[^}]*background:\s*var\(--semantic-dropdown-option-surface-selected\);[^}]*color:\s*var\(--semantic-dropdown-option-text-selected\);/s,
    )
    expect(settingsCss).toMatch(
      /\.provider-model-picker-model\[aria-selected="true"\]\s*\{[^}]*background:\s*var\(--semantic-dropdown-option-surface-selected\);[^}]*color:\s*var\(--semantic-dropdown-option-text-selected\);/s,
    )
    expect(settingsCss).toMatch(
      /\.provider-model-picker-empty\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-dropdown-option-meta-text\);/s,
    )

    const providerModelPickerStyles = settingsCss.slice(
      settingsCss.indexOf(".provider-model-picker {"),
      settingsCss.indexOf(".mcp-tools-policy-panel"),
    )
    expect(providerModelPickerStyles).not.toContain("--semantic-list-detail-")
    expect(providerModelPickerStyles).not.toMatch(/--seg-(?:border|dropdown|panel|text)/)
    expect(providerModelPickerStyles).not.toMatch(
      /--(?:border-subtle|focus-outline-color|surface-panel-muted)/,
    )
  })

  it("keeps editable field fills off generic panel and shell tokens", () => {
    const violations: string[] = []
    const editableElement = /(^|[\s,>+~])(?:input|textarea|select)(?=$|[\s,.:#\[\]>+~])/
    const genericSurface =
      /var\(\s*--(?:seg-(?:panel(?:-muted)?|shell)|surface-(?:panel(?:-muted)?|elevated|shell)|color-surface-panel)/

    for (const fileName of readdirSync(stylesRoot)) {
      if (
        !fileName.endsWith(".css") ||
        fileName === "tokens.css" ||
        fileName === "appearance-tokens.generated.css"
      ) {
        continue
      }

      const source = readFileSync(resolve(stylesRoot, fileName), "utf8")
      const root = postcss.parse(source, { from: fileName })
      root.walkRules((rule) => {
        const selector = rule.selector.replace(/\s+/g, " ")
        if (!editableElement.test(selector)) return
        if (selector.includes(".provider-radio-option input")) return
        if (selector.includes(".settings-theme-config-preview textarea")) return

        rule.walkDecls(/^background(?:-color)?$/, (declaration) => {
          if (!genericSurface.test(declaration.value)) return
          violations.push(
            `${fileName}:${declaration.source?.start?.line ?? 0} ${selector} -> ${declaration.value}`,
          )
        })
      })
    }

    expect(violations).toEqual([])
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
