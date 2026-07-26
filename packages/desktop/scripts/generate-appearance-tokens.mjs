import fs from "node:fs/promises"
import path from "node:path"

const packageDirectory = path.resolve(import.meta.dirname, "..")
const manifestPath = path.join(packageDirectory, "src", "shared", "appearance-token-manifest.json")
const generatedTypeScriptPath = path.join(
  packageDirectory,
  "src",
  "shared",
  "appearance-tokens.generated.ts",
)
const stylesDirectory = path.join(packageDirectory, "src", "renderer", "src", "styles")
const generatedCssPath = path.join(stylesDirectory, "appearance-tokens.generated.css")
const manualTokensPath = path.join(stylesDirectory, "tokens.css")
const checkOnly = process.argv.includes("--check")

const DTCG_COLOR_SPACES = [
  "srgb",
  "srgb-linear",
  "hsl",
  "hwb",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "display-p3",
  "a98-rgb",
  "prophoto-rgb",
  "rec2020",
  "xyz-d65",
  "xyz-d50",
]

function fail(message) {
  throw new Error(`Appearance token manifest: ${message}`)
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${label} must be a non-empty string.`)
  }
}

function assertUnique(values, label) {
  const seen = new Set()

  for (const value of values) {
    if (seen.has(value)) {
      fail(`${label} contains duplicate value "${value}".`)
    }
    seen.add(value)
  }
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`)
  }
}

function readManifestTokenRows(manifest) {
  return manifest.groups.flatMap((group) =>
    group.rows.map((row) => ({
      ...row,
      groupID: group.id,
      groupLabel: group.label,
      layer: group.layer,
    })),
  )
}

function validateDtcgColorValue(value, label) {
  assertRecord(value, label)

  if (!DTCG_COLOR_SPACES.includes(value.colorSpace)) {
    fail(`${label}.colorSpace "${value.colorSpace}" is unsupported.`)
  }
  if (value.colorSpace !== "srgb") {
    fail(`${label}.colorSpace must be "srgb" in the source manifest.`)
  }
  if (
    !Array.isArray(value.components) ||
    value.components.length !== 3 ||
    value.components.some(
      (component) =>
        typeof component !== "number" ||
        !Number.isFinite(component) ||
        component < 0 ||
        component > 1,
    )
  ) {
    fail(`${label}.components must contain three finite sRGB values from 0 to 1.`)
  }
  if (
    value.alpha !== undefined &&
    (
      typeof value.alpha !== "number" ||
      !Number.isFinite(value.alpha) ||
      value.alpha < 0 ||
      value.alpha > 1
    )
  ) {
    fail(`${label}.alpha must be a finite number from 0 to 1.`)
  }
  if (value.hex !== undefined && !/^#[0-9a-f]{6}$/i.test(value.hex)) {
    fail(`${label}.hex must be a six-digit CSS hex fallback.`)
  }
}

function validateTokenValue(value, label, knownNodeNames) {
  assertRecord(value, label)

  if (value.type === "literal") {
    validateDtcgColorValue(value.value, `${label}.value`)
    return
  }
  if (value.type === "alias") {
    assertNonEmptyString(value.token, `${label}.token`)
    if (!knownNodeNames.has(value.token)) {
      fail(`${label} references unknown mode token "--${value.token}".`)
    }
    return
  }

  fail(`${label}.type must be "literal" or "alias".`)
}

function collectDependencies(value) {
  return value.type === "alias" ? [value.token] : []
}

function validateManifest(manifest) {
  assertRecord(manifest, "root")
  if (manifest.schemaVersion !== 2) {
    fail(`unsupported schemaVersion "${manifest.schemaVersion}".`)
  }
  if (manifest.dtcgVersion !== "2025.10") {
    fail(`dtcgVersion must be "2025.10".`)
  }
  if (!Array.isArray(manifest.layers) || manifest.layers.length === 0) {
    fail("layers must be a non-empty array.")
  }
  if (!Array.isArray(manifest.groups) || manifest.groups.length === 0) {
    fail("groups must be a non-empty array.")
  }
  assertRecord(manifest.brands, "brands")
  assertRecord(manifest.derivations, "derivations")
  if (!Array.isArray(manifest.contracts)) {
    fail("contracts must be an array.")
  }
  if (!Array.isArray(manifest.themes) || manifest.themes.length === 0) {
    fail("themes must be a non-empty array.")
  }
  assertRecord(manifest.compatibility, "compatibility")

  assertUnique(manifest.layers, "layers")
  assertUnique(manifest.groups.map((group) => group.id), "group ids")

  const layerSet = new Set(manifest.layers)
  const rows = readManifestTokenRows(manifest)
  const tokenNames = rows.flatMap((row) => [row.lightToken, row.darkToken])
  const runtimeTokenNames = rows.map((row) => row.runtimeToken)
  const tokenNameSet = new Set(tokenNames)
  const derivationNames = Object.keys(manifest.derivations)
  const derivationNameSet = new Set(derivationNames)
  const knownNodeNames = new Set([...tokenNames, ...derivationNames])

  assertUnique(rows.map((row) => row.id), "row ids")
  assertUnique(tokenNames, "mode token names")
  assertUnique(runtimeTokenNames, "runtime token names")
  assertUnique(derivationNames, "derivation names")

  for (const group of manifest.groups) {
    assertNonEmptyString(group.id, "group.id")
    assertNonEmptyString(group.label, `${group.id}.label`)
    assertNonEmptyString(group.description, `${group.id}.description`)
    if (!layerSet.has(group.layer)) {
      fail(`group "${group.id}" uses unknown layer "${group.layer}".`)
    }
    if (!Array.isArray(group.rows) || group.rows.length === 0) {
      fail(`group "${group.id}" must contain rows.`)
    }
  }

  for (const row of rows) {
    assertNonEmptyString(row.id, `${row.groupID}.row.id`)
    assertNonEmptyString(row.label, `${row.id}.label`)
    assertNonEmptyString(row.description, `${row.id}.description`)
    assertNonEmptyString(row.lightToken, `${row.id}.lightToken`)
    assertNonEmptyString(row.darkToken, `${row.id}.darkToken`)
    assertNonEmptyString(row.runtimeToken, `${row.id}.runtimeToken`)

    if (row.lightToken === row.darkToken) {
      fail(`row "${row.id}" must use distinct light and dark tokens.`)
    }
    if (tokenNameSet.has(row.runtimeToken)) {
      fail(`row "${row.id}" runtime token "--${row.runtimeToken}" collides with a mode token.`)
    }
  }

  for (const [name, derivation] of Object.entries(manifest.derivations)) {
    assertRecord(derivation, `derivations.${name}`)
    if (derivation.kind !== "blend") {
      fail(`derivations.${name}.kind must be "blend".`)
    }
    if (derivation.colorSpace !== "srgb") {
      fail(`derivations.${name}.colorSpace must be "srgb".`)
    }
    if (!Array.isArray(derivation.sources) || derivation.sources.length !== 2) {
      fail(`derivations.${name}.sources must contain exactly two entries.`)
    }
    const weightTotal = derivation.sources.reduce((total, source, index) => {
      assertRecord(source, `derivations.${name}.sources[${index}]`)
      if (
        typeof source.weight !== "number" ||
        !Number.isFinite(source.weight) ||
        source.weight < 0 ||
        source.weight > 100
      ) {
        fail(`derivations.${name}.sources[${index}].weight must be from 0 to 100.`)
      }
      validateTokenValue(
        source.value,
        `derivations.${name}.sources[${index}].value`,
        knownNodeNames,
      )
      return total + source.weight
    }, 0)
    if (Math.abs(weightTotal - 100) > Number.EPSILON) {
      fail(`derivations.${name} weights must total 100 (received ${weightTotal}).`)
    }
    if (name.startsWith("mix-") !== Boolean(derivation.compatibility)) {
      fail(`derivations.${name}.compatibility does not match its namespace.`)
    }
  }

  const terraTokens = manifest.brands.terra?.tokens
  const sageTokens = manifest.brands.sage?.tokens
  assertRecord(terraTokens, "brands.terra.tokens")
  assertRecord(sageTokens, "brands.sage.tokens")

  for (const tokenName of tokenNames) {
    const hasTerraValue = Object.hasOwn(terraTokens, tokenName)
    const hasDerivation = derivationNameSet.has(tokenName)
    if (hasTerraValue === hasDerivation) {
      fail(
        `--${tokenName} must have exactly one Terra definition or internal derivation.`,
      )
    }
  }
  for (const [brandName, brand] of Object.entries(manifest.brands)) {
    assertNonEmptyString(brand.label, `brands.${brandName}.label`)
    assertRecord(brand.tokens, `brands.${brandName}.tokens`)
    for (const [tokenName, value] of Object.entries(brand.tokens)) {
      if (!tokenNameSet.has(tokenName)) {
        fail(`${brandName} defines unregistered token "--${tokenName}".`)
      }
      validateTokenValue(value, `brands.${brandName}.tokens.${tokenName}`, knownNodeNames)
    }
  }

  const readBaseNodeValue = (nodeName) => {
    const derivation = manifest.derivations[nodeName]
    if (derivation) {
      return {
        type: "composite",
        dependencies: derivation.sources.flatMap((source) => collectDependencies(source.value)),
      }
    }
    return terraTokens[nodeName]
  }
  const collectNodeDependencies = (value) =>
    value?.type === "composite" ? value.dependencies : collectDependencies(value)

  function validateGraph(readValue, label) {
    const visiting = new Set()
    const visited = new Set()

    function visit(nodeName, stack) {
      if (visited.has(nodeName)) return
      if (visiting.has(nodeName)) {
        const cycleStart = stack.indexOf(nodeName)
        const cycle = [...stack.slice(Math.max(0, cycleStart)), nodeName]
        fail(`${label} contains a dependency cycle: ${cycle.map((name) => `--${name}`).join(" -> ")}.`)
      }
      visiting.add(nodeName)
      const value = readValue(nodeName)
      if (!value) fail(`${label} cannot resolve "--${nodeName}".`)
      for (const dependency of collectNodeDependencies(value)) {
        visit(dependency, [...stack, nodeName])
      }
      visiting.delete(nodeName)
      visited.add(nodeName)
    }

    for (const nodeName of knownNodeNames) visit(nodeName, [])
  }

  validateGraph(readBaseNodeValue, "Terra")
  for (const [brandName, brand] of Object.entries(manifest.brands)) {
    validateGraph(
      (nodeName) => brand.tokens[nodeName] ?? readBaseNodeValue(nodeName),
      `brand "${brandName}"`,
    )
  }

  assertUnique(manifest.contracts.map((contract) => contract.id), "contract ids")
  for (const contract of manifest.contracts) {
    assertNonEmptyString(contract.id, "contract.id")
    if (!["text", "ui"].includes(contract.kind)) {
      fail(`contract "${contract.id}" kind must be "text" or "ui".`)
    }
    if (
      typeof contract.minimumContrast !== "number" ||
      !Number.isFinite(contract.minimumContrast) ||
      contract.minimumContrast < 1 ||
      contract.minimumContrast > 21
    ) {
      fail(`contract "${contract.id}" minimumContrast must be from 1 to 21.`)
    }
    for (const role of ["foreground", "background"]) {
      assertRecord(contract[role], `contract "${contract.id}" ${role}`)
      for (const mode of ["light", "dark"]) {
        const tokenName = contract[role][mode]
        if (!tokenNameSet.has(tokenName)) {
          fail(`contract "${contract.id}" ${role}.${mode} references unknown token "--${tokenName}".`)
        }
      }
    }
  }

  assertUnique(manifest.themes.map((theme) => theme.id), "theme ids")
  const themeIds = new Set(manifest.themes.map((theme) => theme.id))
  if (!themeIds.has(manifest.defaultThemeId)) {
    fail(`defaultThemeId "${manifest.defaultThemeId}" does not identify a theme.`)
  }

  for (const theme of manifest.themes) {
    assertNonEmptyString(theme.id, "theme.id")
    assertNonEmptyString(theme.name, `${theme.id}.name`)
    if (!["system", "light", "dark"].includes(theme.colorMode)) {
      fail(`theme "${theme.id}" has invalid colorMode "${theme.colorMode}".`)
    }
    if (!Object.hasOwn(manifest.brands, theme.brandTheme)) {
      fail(`theme "${theme.id}" uses unknown brandTheme "${theme.brandTheme}".`)
    }
    assertRecord(theme.overrides, `theme "${theme.id}" overrides`)
    for (const [tokenName, value] of Object.entries(theme.overrides)) {
      if (!tokenNameSet.has(tokenName)) {
        fail(`theme "${theme.id}" overrides unregistered token "--${tokenName}".`)
      }
      validateTokenValue(value, `${theme.id}.overrides.${tokenName}`, knownNodeNames)
    }
    const brand = manifest.brands[theme.brandTheme]
    validateGraph(
      (nodeName) =>
        theme.overrides[nodeName] ??
        brand.tokens[nodeName] ??
        readBaseNodeValue(nodeName),
      `theme "${theme.id}"`,
    )
  }

  const legacyMixLightNames = derivationNames.filter(
    (name) => name.startsWith("mix-") && name.endsWith("-light"),
  )
  const legacyMixRuntimeNames = legacyMixLightNames.map((name) => name.slice(0, -"-light".length))
  for (const lightName of legacyMixLightNames) {
    const darkName = `${lightName.slice(0, -"-light".length)}-dark`
    if (!derivationNameSet.has(darkName)) {
      fail(`legacy mix "--${lightName}" is missing "--${darkName}".`)
    }
  }
  if (manifest.compatibility.legacyMixPairCount !== legacyMixLightNames.length) {
    fail(
      `compatibility.legacyMixPairCount must be ${legacyMixLightNames.length}.`,
    )
  }
  if (!Array.isArray(manifest.compatibility.allowedDirectMixConsumers)) {
    fail("compatibility.allowedDirectMixConsumers must be an array.")
  }
  for (const field of [
    "legacyDirectMixUsageCount",
    "legacyDirectColorMixUsageCount",
  ]) {
    if (
      !Number.isInteger(manifest.compatibility[field]) ||
      manifest.compatibility[field] < 0
    ) {
      fail(`compatibility.${field} must be a non-negative integer.`)
    }
  }
  if (manifest.compatibility.legacyDirectColorMixUsageCount !== 0) {
    fail("compatibility.legacyDirectColorMixUsageCount must remain 0.")
  }
  assertUnique(
    manifest.compatibility.allowedDirectMixConsumers,
    "allowed direct mix consumers",
  )
  for (const tokenName of manifest.compatibility.allowedDirectMixConsumers) {
    if (!legacyMixRuntimeNames.includes(tokenName)) {
      fail(`allowed direct mix consumer "--${tokenName}" is not a legacy runtime mix.`)
    }
  }

  return {
    rows,
    tokenNames,
    runtimeTokenNames,
    derivationNames,
    legacyMixLightNames,
    legacyMixRuntimeNames,
    knownNodeNames,
    defaultThemeIndex: manifest.themes.findIndex(
      (theme) => theme.id === manifest.defaultThemeId,
    ),
  }
}

function formatJsonAsTypeScript(value) {
  return JSON.stringify(value, null, 2)
}

function countTokenValueTypes(values) {
  const counts = { literal: 0, alias: 0 }
  for (const value of values) counts[value.type] += 1
  return counts
}

function generateTypeScript(manifest, data) {
  const publicGroups = manifest.groups.map((group) => ({
    ...group,
    rows: group.rows.map(({ runtimeToken: _runtimeToken, ...row }) => row),
  }))
  const groups = formatJsonAsTypeScript(publicGroups)
  const tokenNames = formatJsonAsTypeScript(data.tokenNames)
  const layers = formatJsonAsTypeScript(manifest.layers)
  const themes = formatJsonAsTypeScript(manifest.themes)
  const brands = formatJsonAsTypeScript(manifest.brands)
  const brandNames = formatJsonAsTypeScript(Object.keys(manifest.brands))
  const derivations = formatJsonAsTypeScript(manifest.derivations)
  const contracts = formatJsonAsTypeScript(manifest.contracts)
  const compatibility = formatJsonAsTypeScript(manifest.compatibility)
  const runtimeMap = formatJsonAsTypeScript(
    Object.fromEntries(data.rows.map((row) => [row.id, row.runtimeToken])),
  )
  const testData = formatJsonAsTypeScript({
    schemaVersion: manifest.schemaVersion,
    dtcgVersion: manifest.dtcgVersion,
    groupCount: manifest.groups.length,
    pairCount: data.rows.length,
    modeTokenCount: data.tokenNames.length,
    runtimeTokenCount: data.runtimeTokenNames.length,
    derivationCount: data.derivationNames.length,
    canonicalDerivationCount: data.derivationNames.filter((name) => !name.startsWith("mix-")).length,
    legacyMixPairCount: data.legacyMixLightNames.length,
    contractCount: manifest.contracts.length,
    modeTokens: data.tokenNames,
    runtimeTokens: data.runtimeTokenNames,
    legacyMixRuntimeTokens: data.legacyMixRuntimeNames,
    brandTokenCounts: Object.fromEntries(
      Object.entries(manifest.brands).map(([brandName, brand]) => [
        brandName,
        Object.keys(brand.tokens).length,
      ]),
    ),
    brandValueTypes: Object.fromEntries(
      Object.entries(manifest.brands).map(([brandName, brand]) => [
        brandName,
        countTokenValueTypes(Object.values(brand.tokens)),
      ]),
    ),
    themeIds: manifest.themes.map((theme) => theme.id),
  })

  return `/* eslint-disable */
/* This file is generated by scripts/generate-appearance-tokens.mjs. */
/* Edit src/shared/appearance-token-manifest.json, then run npm run appearance:tokens:generate. */

export const APPEARANCE_TOKEN_MANIFEST_VERSION = ${manifest.schemaVersion} as const
export const APPEARANCE_DTCG_VERSION = ${JSON.stringify(manifest.dtcgVersion)} as const
export const APPEARANCE_DTCG_SCHEMA_URL =
  "https://www.designtokens.org/schemas/2025.10/format.json" as const

export const DTCG_COLOR_SPACES = ${formatJsonAsTypeScript(DTCG_COLOR_SPACES)} as const
export type DtcgColorSpace = (typeof DTCG_COLOR_SPACES)[number]

export interface DtcgColorValue {
  colorSpace: DtcgColorSpace
  components: readonly (number | "none")[]
  alpha?: number
  hex?: string
}

export interface AppearanceTokenLiteral {
  type: "literal"
  value: DtcgColorValue
}

export interface AppearanceTokenAlias {
  type: "alias"
  token: string
}

export type AppearanceTokenValue = AppearanceTokenLiteral | AppearanceTokenAlias

export const APPEARANCE_TOKEN_LAYERS = ${layers} as const

export type AppearanceTokenLayer = (typeof APPEARANCE_TOKEN_LAYERS)[number]

export const APPEARANCE_TOKEN_NAMES = ${tokenNames} as const

export type AppearanceTokenName = (typeof APPEARANCE_TOKEN_NAMES)[number]

export type AppearanceTokenMap = Partial<Record<AppearanceTokenName, AppearanceTokenValue>>

export interface AppearanceTokenRow {
  id: string
  label: string
  description: string
  lightToken: AppearanceTokenName
  darkToken: AppearanceTokenName
}

export interface AppearanceTokenGroup {
  id: string
  layer: AppearanceTokenLayer
  label: string
  description: string
  rows: readonly AppearanceTokenRow[]
}

export type AppearanceTokenMetadata = {
  label: string
  description: string
  groupID: string
  groupLabel: string
  layer: AppearanceTokenLayer
  rowID: string
  mode: "light" | "dark"
}

export interface AppearanceBlendSource {
  value: AppearanceTokenValue
  weight: number
}

export interface AppearanceTokenDerivation {
  kind: "blend"
  colorSpace: "srgb"
  sources: readonly [AppearanceBlendSource, AppearanceBlendSource]
  compatibility: boolean
}

export interface AppearanceContrastContract {
  id: string
  kind: "text" | "ui"
  foreground: { light: AppearanceTokenName; dark: AppearanceTokenName }
  background: { light: AppearanceTokenName; dark: AppearanceTokenName }
  minimumContrast: number
}

export const APPEARANCE_TOKEN_GROUPS = ${groups} as const satisfies readonly AppearanceTokenGroup[]

export const APPEARANCE_TOKEN_RUNTIME_MAP = ${runtimeMap} as const

export const APPEARANCE_TOKEN_METADATA = Object.fromEntries(
  APPEARANCE_TOKEN_GROUPS.flatMap((group) =>
    group.rows.flatMap((row) => [
      [
        row.lightToken,
        {
          label: row.label,
          description: row.description,
          groupID: group.id,
          groupLabel: group.label,
          layer: group.layer,
          rowID: row.id,
          mode: "light" as const,
        },
      ],
      [
        row.darkToken,
        {
          label: row.label,
          description: row.description,
          groupID: group.id,
          groupLabel: group.label,
          layer: group.layer,
          rowID: row.id,
          mode: "dark" as const,
        },
      ],
    ]),
  ),
) as Record<AppearanceTokenName, AppearanceTokenMetadata>

export const APPEARANCE_BRAND_NAMES = ${brandNames} as const
export type AppearanceBrandName = (typeof APPEARANCE_BRAND_NAMES)[number]

export const APPEARANCE_BRAND_DEFINITIONS = ${brands} as const

export const APPEARANCE_TOKEN_DERIVATIONS =
  ${derivations} as const satisfies Record<string, AppearanceTokenDerivation>

export const APPEARANCE_CONTRAST_CONTRACTS =
  ${contracts} as const satisfies readonly AppearanceContrastContract[]

export const APPEARANCE_TOKEN_COMPATIBILITY = ${compatibility} as const

export const DEFAULT_APPEARANCE_THEME_ID = ${JSON.stringify(manifest.defaultThemeId)} as const

export const BUILT_IN_APPEARANCE_THEME_DEFINITIONS = ${themes} as const

export const DEFAULT_APPEARANCE_THEME_DEFINITION =
  BUILT_IN_APPEARANCE_THEME_DEFINITIONS[${data.defaultThemeIndex}]

export const APPEARANCE_TOKEN_TEST_DATA = ${testData} as const
`
}

function toCssNumber(value) {
  return String(Number(value.toFixed(6)))
}

function dtcgColorToCss(value) {
  if (value.colorSpace !== "srgb") {
    fail(`generator only emits sRGB literals, received "${value.colorSpace}".`)
  }
  const components = value.components.map((component) => {
    if (component === "none") fail(`generator cannot emit "none" sRGB components.`)
    return Math.round(component * 255)
  })
  const alpha = value.alpha ?? 1
  if (alpha >= 1 && value.hex) return value.hex.toLowerCase()
  return `rgba(${components.join(", ")}, ${toCssNumber(alpha)})`
}

function tokenValueToCss(value) {
  return value.type === "alias"
    ? `var(--${value.token})`
    : dtcgColorToCss(value.value)
}

function derivationToCss(derivation) {
  return `color-mix(in ${derivation.colorSpace}, ${derivation.sources
    .map((source) => `${tokenValueToCss(source.value)} ${toCssNumber(source.weight)}%`)
    .join(", ")})`
}

function declarationLine(name, value, indentation = "  ") {
  return `${indentation}--${name}: ${value};`
}

function generateModeDefinitions(manifest, rows, brandName) {
  const values = manifest.brands[brandName].tokens
  const lines = []

  for (const group of manifest.groups) {
    const groupRows = rows.filter((row) => row.groupID === group.id)
    const declarations = groupRows.flatMap((row) => {
      const output = []
      for (const tokenName of [row.lightToken, row.darkToken]) {
        const value = values[tokenName]
        if (value) {
          output.push(declarationLine(tokenName, tokenValueToCss(value)))
        } else if (brandName === "terra") {
          const derivation = manifest.derivations[tokenName]
          if (!derivation) fail(`missing Terra output for --${tokenName}.`)
          output.push(declarationLine(tokenName, derivationToCss(derivation)))
        }
      }
      return output
    })

    if (declarations.length > 0) {
      if (lines.length > 0) lines.push("")
      lines.push(`  /* ${group.label} */`, ...declarations)
    }
  }

  return lines
}

function generateInternalDerivations(manifest) {
  return Object.entries(manifest.derivations)
    .filter(([name]) => name.startsWith("mix-"))
    .map(([name, derivation]) => declarationLine(name, derivationToCss(derivation)))
}

function generateRuntimeAliases(rows, mode, indentation = "  ") {
  return rows.map((row) =>
    declarationLine(
      row.runtimeToken,
      `var(--${mode === "light" ? row.lightToken : row.darkToken})`,
      indentation,
    ),
  )
}

function generateLegacyMixRuntimeAliases(data, mode, indentation = "  ") {
  return data.legacyMixRuntimeNames.map((runtimeName) =>
    declarationLine(runtimeName, `var(--${runtimeName}-${mode})`, indentation),
  )
}

function generateCss(manifest, data) {
  const rootDefinitions = generateModeDefinitions(manifest, data.rows, "terra")
  const sageDefinitions = generateModeDefinitions(manifest, data.rows, "sage")
  const internalDerivations = generateInternalDerivations(manifest)
  const lightAliases = [
    ...generateRuntimeAliases(data.rows, "light"),
    ...generateLegacyMixRuntimeAliases(data, "light"),
  ]
  const darkAliases = [
    ...generateRuntimeAliases(data.rows, "dark"),
    ...generateLegacyMixRuntimeAliases(data, "dark"),
  ]
  const indentedDarkAliases = [
    ...generateRuntimeAliases(data.rows, "dark", "    "),
    ...generateLegacyMixRuntimeAliases(data, "dark", "    "),
  ]

  return `/*
 * This file is generated by scripts/generate-appearance-tokens.mjs.
 * Edit src/shared/appearance-token-manifest.json, then run
 * npm run appearance:tokens:generate.
 */

:root {
${rootDefinitions.join("\n")}

  /* Internal compatibility derivations. Do not consume these in new component CSS. */
${internalDerivations.join("\n")}

  /* Runtime aliases: components consume these mode-independent tokens. */
${lightAliases.join("\n")}
}

:root[data-brand-theme="sage"] {
${sageDefinitions.join("\n")}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${indentedDarkAliases.join("\n")}
  }
}

:root[data-theme="dark"] {
${darkAliases.join("\n")}
}
`
}

async function writeOrCheck(filePath, expected) {
  if (checkOnly) {
    let actual
    try {
      actual = await fs.readFile(filePath, "utf8")
    } catch (error) {
      if (error?.code === "ENOENT") {
        fail(`generated file is missing: ${path.relative(packageDirectory, filePath)}`)
      }
      throw error
    }

    if (actual !== expected) {
      fail(
        `${path.relative(packageDirectory, filePath)} is stale. Run npm run appearance:tokens:generate.`,
      )
    }
    return
  }

  await fs.writeFile(filePath, expected, "utf8")
}

function parseDefinedCustomProperties(source) {
  return new Set(
    [...source.matchAll(/^\s*--([a-zA-Z0-9_-]+)\s*:/gm)].map((match) => match[1]),
  )
}

async function readLegacyMixUsage() {
  const fileNames = (await fs.readdir(stylesDirectory))
    .filter((fileName) => fileName.endsWith(".css"))
    .filter((fileName) => !["tokens.css", "appearance-tokens.generated.css"].includes(fileName))
  const consumers = new Set()
  let directMixUsageCount = 0
  let directColorMixUsageCount = 0

  for (const fileName of fileNames) {
    const source = await fs.readFile(path.join(stylesDirectory, fileName), "utf8")
    const directMixMatches = source.matchAll(/var\(\s*--(mix-[a-zA-Z0-9_-]+)/g)
    for (const match of directMixMatches) {
      consumers.add(match[1])
      directMixUsageCount += 1
    }
    directColorMixUsageCount += [...source.matchAll(/color-mix\s*\(/g)].length
  }

  return {
    consumers,
    directMixUsageCount,
    directColorMixUsageCount,
  }
}

async function validateGeneratedBoundary(manifest, data, manualTokensSource) {
  const manualDefinitions = parseDefinedCustomProperties(manualTokensSource)
  const managedDefinitions = new Set([
    ...data.tokenNames,
    ...data.runtimeTokenNames,
    ...data.derivationNames,
    ...data.legacyMixRuntimeNames,
  ])
  const duplicateDefinitions = [...managedDefinitions].filter((name) =>
    manualDefinitions.has(name),
  )

  if (duplicateDefinitions.length > 0) {
    fail(
      `tokens.css still defines manifest-owned properties: ${duplicateDefinitions
        .slice(0, 8)
        .map((name) => `--${name}`)
        .join(", ")}${duplicateDefinitions.length > 8 ? ", …" : ""}`,
    )
  }

  const knownDefinitions = new Set([...manualDefinitions, ...managedDefinitions])
  const readReferences = (value) => collectDependencies(value)
  for (const [brandName, brand] of Object.entries(manifest.brands)) {
    for (const [tokenName, value] of Object.entries(brand.tokens)) {
      for (const reference of readReferences(value)) {
        if (!knownDefinitions.has(reference)) {
          fail(`${brandName}.--${tokenName} references undefined token "--${reference}".`)
        }
      }
    }
  }

  const {
    consumers: actualDirectMixConsumers,
    directMixUsageCount,
    directColorMixUsageCount,
  } = await readLegacyMixUsage()
  const allowedDirectMixConsumers = new Set(
    manifest.compatibility.allowedDirectMixConsumers,
  )
  const newConsumers = [...actualDirectMixConsumers].filter(
    (name) => !allowedDirectMixConsumers.has(name),
  )
  if (newConsumers.length > 0) {
    fail(
      `new component CSS directly consumes internal mix tokens: ${newConsumers
        .map((name) => `--${name}`)
        .join(", ")}. Add or reuse a semantic token instead.`,
    )
  }
  const staleAllowlist = [...allowedDirectMixConsumers].filter(
    (name) => !actualDirectMixConsumers.has(name),
  )
  if (staleAllowlist.length > 0) {
    fail(
      `remove migrated mix tokens from compatibility.allowedDirectMixConsumers: ${staleAllowlist
        .map((name) => `--${name}`)
        .join(", ")}.`,
    )
  }
  if (directMixUsageCount !== manifest.compatibility.legacyDirectMixUsageCount) {
    fail(
      `legacy direct --mix-* usage count changed from ${
        manifest.compatibility.legacyDirectMixUsageCount
      } to ${directMixUsageCount}. Migrate removed usages to semantic tokens; do not add new usages.`,
    )
  }
  if (directColorMixUsageCount !== 0) {
    fail(
      `component CSS contains ${directColorMixUsageCount} direct color-mix() call${
        directColorMixUsageCount === 1 ? "" : "s"
      }. Use an explicit runtime semantic token instead.`,
    )
  }
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
const data = validateManifest(manifest)
const manualTokensSource = await fs.readFile(manualTokensPath, "utf8")
await validateGeneratedBoundary(manifest, data, manualTokensSource)

await Promise.all([
  writeOrCheck(generatedTypeScriptPath, generateTypeScript(manifest, data)),
  writeOrCheck(generatedCssPath, generateCss(manifest, data)),
])

console.log(
  `${checkOnly ? "Checked" : "Generated"} ${data.rows.length} editable pairs and ${
    data.legacyMixLightNames.length
  } legacy compatibility blend pairs from ${path.relative(process.cwd(), manifestPath)}`,
)
