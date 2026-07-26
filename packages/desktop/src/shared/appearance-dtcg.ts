import Ajv, { type ErrorObject } from "ajv"
import {
  APPEARANCE_DTCG_SCHEMA_URL,
  APPEARANCE_TOKEN_DERIVATIONS,
  APPEARANCE_TOKEN_METADATA,
  APPEARANCE_TOKEN_NAMES,
  normalizeAppearanceCodeThemePreference,
  normalizeAppearanceConfigDocument,
  validateAppearanceConfigDocumentStructure,
  type AppearanceTokenMap,
  type AppearanceTokenName,
  type AppearanceTokenValue,
} from "./appearance"
import {
  evaluateAppearanceContrastWarnings,
  normalizeDtcgColorValue,
  resolveAppearanceTokenColors,
  type AppearanceContrastWarning,
} from "./appearance-color"
import type {
  AppearanceTheme,
  AppearanceThemeSaveInput,
} from "./appearance-themes"

export const ANYBOX_APPEARANCE_DTCG_EXTENSION =
  "io.github.fanfan-de.anybox.appearance" as const

const MAX_DTCG_JSON_LENGTH = 1_000_000
const DTCG_TOKEN_NAME_PATTERN = /^[^${}.][^{}.]*$/
const APPEARANCE_TOKEN_NAME_SET = new Set<string>(APPEARANCE_TOKEN_NAMES)
const ajv = new Ajv({ allErrors: true, strict: false })

const validateDtcgRoot = ajv.compile({
  type: "object",
  properties: {
    $schema: { type: "string" },
    $type: { type: "string" },
    $description: { type: "string" },
    $extensions: { type: "object" },
    $extends: { type: ["string", "object"] },
    $deprecated: { type: ["boolean", "string"] },
    $root: { type: "object" },
  },
  additionalProperties: true,
})

const validateDtcgColor = ajv.compile({
  type: "object",
  required: ["colorSpace", "components"],
  properties: {
    colorSpace: {
      enum: [
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
      ],
    },
    components: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        anyOf: [
          { type: "number" },
          { type: "string", const: "none" },
        ],
      },
    },
    alpha: { type: "number", minimum: 0, maximum: 1 },
    hex: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
  },
  additionalProperties: false,
})

interface DtcgTokenEntry {
  node: Record<string, unknown>
  path: string[]
  pointer: string
  type: string | null
}

interface AnyboxDtcgExtension {
  schemaVersion?: unknown
  theme?: unknown
  overrides?: unknown
  tokenMap?: unknown
}

export interface AppearanceDtcgImportResult {
  theme: AppearanceThemeSaveInput
  warnings: string[]
  contrastWarnings: AppearanceContrastWarning[]
  importedTokenCount: number
  ignoredTokenCount: number
}

export class AppearanceDtcgValidationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(issues.join("\n"))
    this.name = "AppearanceDtcgValidationError"
    this.issues = issues
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function cloneJsonRecord(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined) {
  return (errors ?? []).map((error) =>
    `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  )
}

function escapeJsonPointerSegment(value: string) {
  return value.replace(/~/g, "~0").replace(/\//g, "~1")
}

function unescapeJsonPointerSegment(value: string) {
  return value.replace(/~1/g, "/").replace(/~0/g, "~")
}

function pathToPointer(path: readonly string[]) {
  return `#/${path.map(escapeJsonPointerSegment).join("/")}`
}

function pathToCurlyReference(path: readonly string[]) {
  return `{${path.join(".")}}`
}

function collectDtcgTokens(
  document: Record<string, unknown>,
  issues: string[],
): DtcgTokenEntry[] {
  const tokens: DtcgTokenEntry[] = []

  function visit(
    node: Record<string, unknown>,
    path: string[],
    inheritedType: string | null,
  ) {
    const nodeType = typeof node.$type === "string" ? node.$type : inheritedType
    const hasValue = Object.hasOwn(node, "$value")
    const hasReference = Object.hasOwn(node, "$ref")

    if (hasValue || hasReference) {
      if (hasValue && hasReference) {
        issues.push(`${pathToPointer(path)} cannot define both $value and $ref.`)
      }
      if (
        hasReference &&
        (typeof node.$ref !== "string" || !node.$ref.startsWith("#/"))
      ) {
        issues.push(`${pathToPointer(path)}/$ref must be a JSON Pointer reference.`)
      }
      if (
        hasValue &&
        typeof node.$value === "string" &&
        !/^\{[^{}]+\}$/.test(node.$value)
      ) {
        issues.push(`${pathToPointer(path)}/$value has an invalid token reference.`)
      }
      if (
        hasValue &&
        nodeType === "color" &&
        typeof node.$value !== "string" &&
        !validateDtcgColor(node.$value)
      ) {
        issues.push(
          ...formatAjvErrors(validateDtcgColor.errors).map(
            (issue) => `${pathToPointer(path)}/$value ${issue}`,
          ),
        )
      }
      tokens.push({
        node,
        path,
        pointer: pathToPointer(path),
        type: nodeType,
      })
      return
    }

    if (isRecord(node.$root)) {
      visit(node.$root, [...path, "$root"], nodeType)
    }

    for (const [name, child] of Object.entries(node)) {
      if (name.startsWith("$")) continue
      if (!DTCG_TOKEN_NAME_PATTERN.test(name)) {
        issues.push(`${pathToPointer([...path, name])} uses an invalid DTCG token/group name.`)
        continue
      }
      if (!isRecord(child)) {
        issues.push(`${pathToPointer([...path, name])} must be a token or group object.`)
        continue
      }
      visit(child, [...path, name], nodeType)
    }
  }

  visit(document, [], null)
  return tokens
}

function readAnyboxExtension(document: Record<string, unknown>): AnyboxDtcgExtension | null {
  const extensions = isRecord(document.$extensions) ? document.$extensions : null
  const extension = extensions?.[ANYBOX_APPEARANCE_DTCG_EXTENSION]
  return isRecord(extension) ? extension : null
}

function readKnownTokenNameFromEntry(
  entry: DtcgTokenEntry,
  tokenMap: Map<string, AppearanceTokenName>,
) {
  const mapped = tokenMap.get(entry.pointer)
  if (mapped) return mapped

  const lastSegment = entry.path.at(-1)
  return lastSegment && APPEARANCE_TOKEN_NAME_SET.has(lastSegment)
    ? lastSegment as AppearanceTokenName
    : null
}

function readTokenMap(extension: AnyboxDtcgExtension | null) {
  const tokenMap = new Map<string, AppearanceTokenName>()
  if (!extension || !isRecord(extension.tokenMap)) return tokenMap

  for (const [tokenName, pointer] of Object.entries(extension.tokenMap)) {
    if (
      APPEARANCE_TOKEN_NAME_SET.has(tokenName) &&
      typeof pointer === "string" &&
      pointer.startsWith("#/")
    ) {
      tokenMap.set(pointer, tokenName as AppearanceTokenName)
    }
  }
  return tokenMap
}

function resolveReferenceTokenName(
  reference: string,
  entriesByPointer: Map<string, DtcgTokenEntry>,
  entriesByPath: Map<string, DtcgTokenEntry>,
  knownNamesByPointer: Map<string, AppearanceTokenName>,
) {
  let entry: DtcgTokenEntry | undefined
  if (reference.startsWith("#/")) {
    entry = entriesByPointer.get(reference)
  } else {
    const match = reference.match(/^\{(.+)\}$/)
    if (match) entry = entriesByPath.get(match[1])
  }
  if (!entry) return null

  return knownNamesByPointer.get(entry.pointer) ?? null
}

function readTokenValue(
  entry: DtcgTokenEntry,
  entriesByPointer: Map<string, DtcgTokenEntry>,
  entriesByPath: Map<string, DtcgTokenEntry>,
  knownNamesByPointer: Map<string, AppearanceTokenName>,
): AppearanceTokenValue | null {
  const reference = typeof entry.node.$ref === "string"
    ? entry.node.$ref
    : typeof entry.node.$value === "string"
      ? entry.node.$value
      : null
  if (reference) {
    const token = resolveReferenceTokenName(
      reference,
      entriesByPointer,
      entriesByPath,
      knownNamesByPointer,
    )
    return token ? { type: "alias", token } : null
  }

  const value = normalizeDtcgColorValue(entry.node.$value)
  return value ? { type: "literal", value } : null
}

function normalizeImportedThemeMetadata(
  extension: AnyboxDtcgExtension | null,
  fallbackName: string,
) {
  const theme = extension && isRecord(extension.theme) ? extension.theme : {}
  const normalized = normalizeAppearanceConfigDocument({
    version: 2,
    brandTheme: theme.brandTheme,
    colorMode: theme.colorMode,
    fontFamily: theme.fontFamily,
    overrides: {},
  })

  return {
    name:
      typeof theme.name === "string" && theme.name.trim()
        ? theme.name.trim().slice(0, 80)
        : fallbackName,
    colorMode: normalized.colorMode,
    brandTheme: normalized.brandTheme,
    fontFamily: normalized.fontFamily,
    codeThemePreference: normalizeAppearanceCodeThemePreference(
      theme.codeThemePreference,
    ),
  }
}

export function parseAppearanceDtcgJson(
  json: string,
  options: { fallbackName?: string } = {},
): AppearanceDtcgImportResult {
  if (json.length > MAX_DTCG_JSON_LENGTH) {
    throw new AppearanceDtcgValidationError([
      `DTCG file exceeds the ${MAX_DTCG_JSON_LENGTH.toLocaleString()} character limit.`,
    ])
  }

  let input: unknown
  try {
    input = JSON.parse(json) as unknown
  } catch (error) {
    throw new AppearanceDtcgValidationError([
      `DTCG file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ])
  }

  if (!validateDtcgRoot(input) || !isRecord(input)) {
    throw new AppearanceDtcgValidationError([
      ...formatAjvErrors(validateDtcgRoot.errors),
    ])
  }

  const issues: string[] = []
  const entries = collectDtcgTokens(input, issues)
  const extension = readAnyboxExtension(input)
  const tokenMap = readTokenMap(extension)
  const entriesByPointer = new Map(entries.map((entry) => [entry.pointer, entry]))
  const entriesByPath = new Map(entries.map((entry) => [entry.path.join("."), entry]))
  const knownNamesByPointer = new Map<string, AppearanceTokenName>()

  for (const entry of entries) {
    const tokenName = readKnownTokenNameFromEntry(entry, tokenMap)
    if (!tokenName) continue
    if ([...knownNamesByPointer.values()].includes(tokenName)) {
      issues.push(`DTCG document maps more than one token to "--${tokenName}".`)
      continue
    }
    knownNamesByPointer.set(entry.pointer, tokenName)
  }

  let overrides: AppearanceTokenMap = {}
  if (extension?.schemaVersion === 2 && isRecord(extension.overrides)) {
    overrides = normalizeAppearanceConfigDocument({
      version: 2,
      overrides: extension.overrides,
    }).overrides
  } else {
    for (const entry of entries) {
      const tokenName = knownNamesByPointer.get(entry.pointer)
      if (!tokenName) continue
      if (entry.type && entry.type !== "color") {
        issues.push(`DTCG token "--${tokenName}" must have $type "color".`)
        continue
      }

      const value = readTokenValue(
        entry,
        entriesByPointer,
        entriesByPath,
        knownNamesByPointer,
      )
      if (!value) {
        issues.push(`DTCG token "--${tokenName}" has an unresolved or unsupported value.`)
        continue
      }
      overrides[tokenName] = value
    }
  }

  issues.push(...validateAppearanceConfigDocumentStructure({
    version: 2,
    overrides,
  }))
  if (issues.length > 0) {
    throw new AppearanceDtcgValidationError(issues)
  }

  const metadata = normalizeImportedThemeMetadata(
    extension,
    options.fallbackName?.trim() || "Imported Theme",
  )
  let contrastWarnings: AppearanceContrastWarning[]
  try {
    contrastWarnings = evaluateAppearanceContrastWarnings({
      brandTheme: metadata.brandTheme,
      overrides,
    })
  } catch (error) {
    throw new AppearanceDtcgValidationError([
      error instanceof Error ? error.message : String(error),
    ])
  }
  const ignoredTokenCount = entries.length - knownNamesByPointer.size
  const warnings = ignoredTokenCount > 0
    ? [`Preserved ${ignoredTokenCount} unknown DTCG token${ignoredTokenCount === 1 ? "" : "s"} without applying them.`]
    : []

  return {
    theme: {
      name: metadata.name,
      source: "imported",
      colorMode: metadata.colorMode,
      brandTheme: metadata.brandTheme,
      fontFamily: metadata.fontFamily,
      codeThemePreference: metadata.codeThemePreference,
      overrides,
      foreignDtcg: cloneJsonRecord(input),
    },
    warnings,
    contrastWarnings,
    importedTokenCount: Object.keys(overrides).length,
    ignoredTokenCount,
  }
}

function ensureRecordProperty(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const current = parent[key]
  if (isRecord(current)) return current
  const next: Record<string, unknown> = {}
  parent[key] = next
  return next
}

function readThemeExtensionMetadata(theme: AppearanceTheme) {
  return {
    id: theme.id,
    name: theme.name,
    colorMode: theme.colorMode,
    brandTheme: theme.brandTheme,
    fontFamily: theme.fontFamily,
    codeThemePreference: theme.codeThemePreference,
  }
}

export function createAppearanceDtcgDocument(theme: AppearanceTheme) {
  const document = cloneJsonRecord(theme.foreignDtcg)
  document.$schema = APPEARANCE_DTCG_SCHEMA_URL
  document.$description = `Anybox appearance theme: ${theme.name}`

  const extensions = ensureRecordProperty(document, "$extensions")
  const tokenMap: Record<string, string> = {}
  const publicDerivations = Object.fromEntries(
    Object.entries(APPEARANCE_TOKEN_DERIVATIONS).filter(
      ([tokenName]) => APPEARANCE_TOKEN_NAME_SET.has(tokenName),
    ),
  )
  extensions[ANYBOX_APPEARANCE_DTCG_EXTENSION] = {
    schemaVersion: 2,
    dtcgVersion: "2025.10",
    theme: readThemeExtensionMetadata(theme),
    overrides: theme.overrides,
    derivations: publicDerivations,
    tokenMap,
  }

  const anyboxGroup = ensureRecordProperty(document, "anybox")
  anyboxGroup.$type = "color"
  anyboxGroup.$description = "Resolved Anybox light and dark appearance mode tokens."

  const resolved = resolveAppearanceTokenColors({
    brandTheme: theme.brandTheme,
    overrides: theme.overrides,
  })

  for (const tokenName of APPEARANCE_TOKEN_NAMES) {
    const pointer = pathToPointer(["anybox", tokenName])
    tokenMap[tokenName] = pointer
    const metadata = APPEARANCE_TOKEN_METADATA[tokenName]
    anyboxGroup[tokenName] = {
      $value: resolved[tokenName],
      $description: metadata.description,
      $extensions: {
        [ANYBOX_APPEARANCE_DTCG_EXTENSION]: {
          groupID: metadata.groupID,
          layer: metadata.layer,
          mode: metadata.mode,
          rowID: metadata.rowID,
          source: theme.overrides[tokenName] ? "override" : "resolved",
        },
      },
    }
  }

  return document
}

export function serializeAppearanceThemeToDtcg(theme: AppearanceTheme) {
  return `${JSON.stringify(createAppearanceDtcgDocument(theme), null, 2)}\n`
}

export function getAppearanceDtcgTokenReference(tokenName: AppearanceTokenName) {
  return pathToCurlyReference(["anybox", tokenName])
}

export function readAppearanceDtcgPointer(
  document: Record<string, unknown>,
  pointer: string,
) {
  if (!pointer.startsWith("#/")) return undefined

  let value: unknown = document
  for (const segment of pointer.slice(2).split("/").map(unescapeJsonPointerSegment)) {
    if (!isRecord(value)) return undefined
    value = value[segment]
  }
  return value
}
