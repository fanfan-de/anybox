import {
  APPEARANCE_BRAND_DEFINITIONS,
  APPEARANCE_TOKEN_DERIVATIONS,
  APPEARANCE_TOKEN_GROUPS,
  APPEARANCE_TOKEN_METADATA,
  APPEARANCE_TOKEN_RUNTIME_MAP,
  type AppearanceTokenLayer,
} from "./appearance"
import type {
  SemanticTokenAuthoringCapability,
  SemanticTokenAuthoringRuleCandidate,
  SemanticTokenColorChannelKind,
  SemanticTokenColorChannelResult,
  SemanticTokenColorChannelVisibility,
  SemanticTokenInspectorInteractionState,
} from "./semantic-token-authoring"

export const SEMANTIC_TOKEN_INSPECTOR_EVENT_CHANNEL = "desktop:semantic-token-inspector-event"

export const SEMANTIC_TOKEN_INSPECTED_PROPERTIES = [
  "background-color",
  "background-image",
  "color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "fill",
  "stroke",
  "box-shadow",
  "text-shadow",
  "caret-color",
  "accent-color",
] as const

export type SemanticTokenInspectedProperty = (typeof SEMANTIC_TOKEN_INSPECTED_PROPERTIES)[number]
export type SemanticTokenInspectorResolvedColorMode = "light" | "dark"
export type SemanticTokenInspectorConfidence = "exact" | "ambiguous" | "computed-only"
export type SemanticTokenInspectorSeverity = "pass" | "warning" | "error" | "info" | "unknown"
export type SemanticTokenInspectorSourceScope =
  | "direct"
  | "inherited"
  | "currentColor"
  | "pseudo"
  | "computed"

export type SemanticTokenInspectorDiagnosis =
  | "semantic-runtime"
  | "semantic-runtime-indirect"
  | "mode-token"
  | "brand-token"
  | "foundation-token"
  | "legacy-token"
  | "mixed-color"
  | "hardcoded-color"
  | "neutral-keyword"
  | "image-resource"
  | "local-token"
  | "computed-only"
  | "ambiguous"

export type SemanticTokenInspectorTokenKind =
  | "semantic-runtime"
  | "semantic-mode"
  | "brand"
  | "foundation"
  | "legacy"
  | "mixed"
  | "local"
  | "unknown"

export interface SemanticTokenInspectorSource {
  selector: string
  origin: string
  sourceURL?: string
  line?: number
  column?: number
  important?: boolean
  inheritedDepth?: number
  pseudoType?: string
  editRef?: string
  ruleRef?: string
}

export interface SemanticTokenInspectorTokenNode {
  name: string
  depth: number
  kind: SemanticTokenInspectorTokenKind
  value?: string
  label?: string
  groupLabel?: string
  layer?: AppearanceTokenLayer
  mode?: SemanticTokenInspectorResolvedColorMode
  rowID?: string
  source?: SemanticTokenInspectorSource
  cycle?: boolean
  unresolved?: boolean
}

export interface SemanticTokenInspectorPropertyResult {
  property: SemanticTokenInspectedProperty | "border-color" | "image-source"
  authoredProperty?: string
  authoredValue?: string
  computedValue: string
  confidence: SemanticTokenInspectorConfidence
  diagnosis: SemanticTokenInspectorDiagnosis
  severity: SemanticTokenInspectorSeverity
  summary: string
  scope: SemanticTokenInspectorSourceScope
  source?: SemanticTokenInspectorSource
  tokens: SemanticTokenInspectorTokenNode[]
  candidates?: SemanticTokenInspectorSource[]
  dynamic?: boolean
}

export interface SemanticTokenInspectorBreadcrumb {
  tagName: string
  id?: string
  classes: string[]
}

export interface SemanticTokenInspectorTarget {
  tagName: string
  id?: string
  classes: string[]
  pseudoType?: string
  borderQuad?: readonly number[]
  assetKind?: "image" | "canvas" | "webview" | "iframe"
}

export interface SemanticTokenInspection {
  target: SemanticTokenInspectorTarget
  properties: SemanticTokenInspectorPropertyResult[]
  channels: SemanticTokenColorChannelResult[]
  warnings: string[]
}

export type SemanticTokenInspectorStartResult =
  | {
      status: "active"
      authoring?: SemanticTokenAuthoringCapability
    }
  | {
      status: "blocked"
      reason:
        | "packaged"
        | "development-disabled"
        | "devtools-open"
        | "debugger-in-use"
        | "protocol-unsupported"
        | "attach-failed"
      message: string
    }

export interface SemanticTokenInspectorInspectInput {
  x: number
  y: number
  ancestorDepth: number
  requestID: number
  resolvedColorMode: SemanticTokenInspectorResolvedColorMode
}

export type SemanticTokenInspectorInspectResult =
  | {
      status: "ok"
      requestID: number
      inspection: SemanticTokenInspection
    }
  | {
      status: "unavailable"
      requestID: number
      reason: "inactive" | "target-not-found" | "protocol-error"
      message: string
    }

export interface SemanticTokenInspectorStopResult {
  status: "inactive"
}

export type SemanticTokenInspectorEvent =
  | {
    type: "detached"
    reason: "devtools-opened" | "navigation" | "target-closed" | "protocol-error" | "unknown"
    message: string
  }
  | {
    type: "pin-current"
  }

export interface SemanticTokenInspectorDeclaration {
  name: string
  value: string
  important?: boolean
  implicit?: boolean
  disabled?: boolean
  parsedOk?: boolean
  longhands?: readonly {
    name: string
    value: string
  }[]
  editRef?: string
}

export interface SemanticTokenInspectorStyleRule {
  selector: string
  origin: string
  inline?: boolean
  specificity?: readonly [number, number, number]
  sourceOrder: number
  layerOrder?: number
  layered?: boolean
  unsupportedScope?: boolean
  sourceURL?: string
  line?: number
  column?: number
  pseudoType?: string
  ruleRef?: string
  declarations: readonly SemanticTokenInspectorDeclaration[]
}

export interface SemanticTokenInspectorStyleContext {
  target: SemanticTokenInspectorTarget
  computedStyle: Readonly<Record<string, string>>
  directRules: readonly SemanticTokenInspectorStyleRule[]
  inheritedRules: readonly (readonly SemanticTokenInspectorStyleRule[])[]
  resolvedColorMode: SemanticTokenInspectorResolvedColorMode
  dynamic?: boolean
  warnings?: readonly string[]
}

interface RuntimeTokenMetadata {
  darkToken: string
  groupLabel: string
  label: string
  layer: AppearanceTokenLayer
  lightToken: string
  rowID: string
  runtime: string
}

interface DeclarationCandidate {
  authoredProperty: string
  authoredValue: string
  effectiveValue: string
  editRef?: string
  important: boolean
  rule: SemanticTokenInspectorStyleRule
  declarationOrder: number
  inheritedDepth?: number
}

interface WinningDeclaration {
  winner: DeclarationCandidate | null
  confidence: SemanticTokenInspectorConfidence
  candidates: DeclarationCandidate[]
}

interface CssFunctionCall {
  name: string
  argumentsText: string
}

interface CssVarReference {
  name: string
  fallback: string
}

const INHERITED_COLOR_PROPERTIES = new Set<SemanticTokenInspectedProperty>(["color", "fill", "stroke"])
const NEUTRAL_VALUES = new Set([
  "",
  "auto",
  "currentcolor",
  "inherit",
  "initial",
  "none",
  "revert",
  "revert-layer",
  "transparent",
  "unset",
])

const runtimeMetadataByName = new Map<string, RuntimeTokenMetadata>()
for (const group of APPEARANCE_TOKEN_GROUPS) {
  for (const row of group.rows) {
    const runtime = (APPEARANCE_TOKEN_RUNTIME_MAP as Readonly<Record<string, string>>)[row.id]
    if (!runtime) continue
    runtimeMetadataByName.set(runtime, {
      darkToken: row.darkToken,
      groupLabel: group.label,
      label: row.label,
      layer: group.layer,
      lightToken: row.lightToken,
      rowID: row.id,
      runtime,
    })
  }
}

const modeTokenMetadata = APPEARANCE_TOKEN_METADATA as Readonly<Record<string, {
  groupLabel: string
  label: string
  layer: AppearanceTokenLayer
  mode: SemanticTokenInspectorResolvedColorMode
  rowID: string
}>>

const brandModeTokenNames = new Set<string>()
for (const definition of Object.values(APPEARANCE_BRAND_DEFINITIONS)) {
  for (const tokenName of Object.keys(definition.tokens)) {
    brandModeTokenNames.add(tokenName)
  }
}

const derivationNames = new Set(Object.keys(APPEARANCE_TOKEN_DERIVATIONS))

function normalizeTokenName(name: string) {
  return name.startsWith("--") ? name.slice(2) : name
}

function tokenCssName(name: string) {
  return name.startsWith("--") ? name : `--${name}`
}

function scanCssFunctions(value: string): CssFunctionCall[] {
  const calls: CssFunctionCall[] = []

  function scanRange(text: string) {
    let index = 0
    while (index < text.length) {
      const char = text[index]
      if (char === "\"" || char === "'") {
        const quote = char
        index += 1
        while (index < text.length) {
          if (text[index] === "\\") {
            index += 2
            continue
          }
          if (text[index] === quote) {
            index += 1
            break
          }
          index += 1
        }
        continue
      }

      if (!/[a-zA-Z-]/.test(char)) {
        index += 1
        continue
      }

      const nameStart = index
      while (index < text.length && /[a-zA-Z0-9-]/.test(text[index])) index += 1
      const name = text.slice(nameStart, index).toLowerCase()
      while (index < text.length && /\s/.test(text[index])) index += 1
      if (text[index] !== "(") continue

      const argumentsStart = index + 1
      let depth = 1
      let cursor = argumentsStart
      let quote: string | null = null
      while (cursor < text.length && depth > 0) {
        const next = text[cursor]
        if (quote) {
          if (next === "\\") {
            cursor += 2
            continue
          }
          if (next === quote) quote = null
          cursor += 1
          continue
        }
        if (next === "\"" || next === "'") {
          quote = next
          cursor += 1
          continue
        }
        if (next === "(") depth += 1
        if (next === ")") depth -= 1
        cursor += 1
      }

      const argumentsText = text.slice(argumentsStart, Math.max(argumentsStart, cursor - 1))
      calls.push({ name, argumentsText })
      scanRange(argumentsText)
      index = cursor
    }
  }

  scanRange(value)
  return calls
}

function splitFirstTopLevelComma(value: string) {
  let depth = 0
  let quote: string | null = null
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (char === "\\") {
        index += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === "\"" || char === "'") {
      quote = char
      continue
    }
    if (char === "(") depth += 1
    if (char === ")") depth = Math.max(0, depth - 1)
    if (char === "," && depth === 0) {
      return [value.slice(0, index).trim(), value.slice(index + 1).trim()] as const
    }
  }
  return [value.trim(), ""] as const
}

function extractVarReferences(value: string) {
  const references: CssVarReference[] = []

  function scanRange(text: string) {
    let index = 0
    while (index < text.length) {
      const char = text[index]
      if (char === "\"" || char === "'") {
        const quote = char
        index += 1
        while (index < text.length) {
          if (text[index] === "\\") {
            index += 2
            continue
          }
          if (text[index] === quote) {
            index += 1
            break
          }
          index += 1
        }
        continue
      }

      if (!/[a-zA-Z-]/.test(char)) {
        index += 1
        continue
      }

      const nameStart = index
      while (index < text.length && /[a-zA-Z0-9-]/.test(text[index])) index += 1
      const functionName = text.slice(nameStart, index).toLowerCase()
      while (index < text.length && /\s/.test(text[index])) index += 1
      if (text[index] !== "(") continue

      const argumentsStart = index + 1
      let depth = 1
      let cursor = argumentsStart
      let quote: string | null = null
      while (cursor < text.length && depth > 0) {
        const next = text[cursor]
        if (quote) {
          if (next === "\\") {
            cursor += 2
            continue
          }
          if (next === quote) quote = null
          cursor += 1
          continue
        }
        if (next === "\"" || next === "'") {
          quote = next
          cursor += 1
          continue
        }
        if (next === "(") depth += 1
        if (next === ")") depth -= 1
        cursor += 1
      }

      const argumentsEnd = depth === 0 ? cursor - 1 : cursor
      const argumentsText = text.slice(argumentsStart, argumentsEnd)
      if (functionName === "var") {
        const [name, fallback] = splitFirstTopLevelComma(argumentsText)
        if (name.startsWith("--")) references.push({ name, fallback })
      } else {
        scanRange(argumentsText)
      }
      index = cursor
    }
  }

  scanRange(value)
  return references
}

function containsColorMix(value: string) {
  return scanCssFunctions(value).some((call) => call.name === "color-mix")
}

function containsUrl(value: string) {
  return scanCssFunctions(value).some((call) => call.name === "url")
}

function isNeutralValue(value: string) {
  return NEUTRAL_VALUES.has(value.trim().toLowerCase())
}

function originRank(origin: string, important: boolean) {
  const normalized = origin.toLowerCase()
  const isUserAgent = normalized === "user-agent" || normalized === "useragent"
  const isUser = normalized === "user"
  if (important) {
    if (isUserAgent) return 6
    if (isUser) return 5
    return 4
  }
  if (isUserAgent) return 1
  if (isUser) return 2
  return 3
}

function layerRank(candidate: DeclarationCandidate) {
  if (!candidate.rule.layered) {
    return candidate.important ? 0 : 1_000_000
  }
  const order = candidate.rule.layerOrder ?? 0
  return candidate.important ? 999_999 - order : order
}

function specificityTuple(candidate: DeclarationCandidate): readonly [number, number, number, number] {
  const specificity = candidate.rule.specificity ?? [0, 0, 0]
  return [candidate.rule.inline ? 1 : 0, specificity[0], specificity[1], specificity[2]]
}

function compareTuples(left: readonly number[], right: readonly number[]) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function compareCandidates(left: DeclarationCandidate, right: DeclarationCandidate) {
  const originDifference = originRank(left.rule.origin, left.important) - originRank(right.rule.origin, right.important)
  if (originDifference !== 0) return originDifference
  const layerDifference = layerRank(left) - layerRank(right)
  if (layerDifference !== 0) return layerDifference
  const specificityDifference = compareTuples(specificityTuple(left), specificityTuple(right))
  if (specificityDifference !== 0) return specificityDifference
  const sourceOrderDifference = left.rule.sourceOrder - right.rule.sourceOrder
  if (sourceOrderDifference !== 0) return sourceOrderDifference
  return left.declarationOrder - right.declarationOrder
}

function declarationMatchesProperty(
  declaration: SemanticTokenInspectorDeclaration,
  property: string,
) {
  if (declaration.disabled || declaration.parsedOk === false || declaration.implicit) return null
  if (declaration.name === property) {
    return {
      authoredProperty: declaration.name,
      authoredValue: declaration.value,
      effectiveValue: declaration.value,
      editRef: declaration.editRef,
    }
  }
  const longhand = declaration.longhands?.find((entry) => entry.name === property)
  if (!longhand) return null
  return {
    authoredProperty: declaration.name,
    authoredValue: declaration.value,
    effectiveValue: longhand.value,
    editRef: declaration.editRef,
  }
}

function collectCandidates(
  rules: readonly SemanticTokenInspectorStyleRule[],
  property: string,
  inheritedDepth?: number,
) {
  const candidates: DeclarationCandidate[] = []
  for (const rule of rules) {
    rule.declarations.forEach((declaration, declarationOrder) => {
      const match = declarationMatchesProperty(declaration, property)
      if (!match) return
      candidates.push({
        ...match,
        important: Boolean(declaration.important),
        rule,
        declarationOrder,
        inheritedDepth,
      })
    })
  }
  return candidates
}

function chooseWinner(candidates: DeclarationCandidate[]): WinningDeclaration {
  if (candidates.length === 0) {
    return { winner: null, confidence: "computed-only", candidates: [] }
  }

  const sorted = [...candidates].sort(compareCandidates)
  const winner = sorted[sorted.length - 1]
  const runnerUp = sorted[sorted.length - 2]
  let confidence: SemanticTokenInspectorConfidence = "exact"

  if (winner.rule.unsupportedScope || (winner.rule.layered && winner.rule.layerOrder === undefined)) {
    confidence = "ambiguous"
  }

  if (
    runnerUp &&
    originRank(winner.rule.origin, winner.important) === originRank(runnerUp.rule.origin, runnerUp.important) &&
    layerRank(winner) === layerRank(runnerUp) &&
    (!winner.rule.specificity || !runnerUp.rule.specificity) &&
    winner.rule.inline === runnerUp.rule.inline
  ) {
    confidence = "ambiguous"
  }

  return { winner, confidence, candidates: sorted }
}

function findWinningDeclaration(
  context: SemanticTokenInspectorStyleContext,
  property: SemanticTokenInspectedProperty,
) {
  const direct = chooseWinner(collectCandidates(context.directRules, property))
  if (direct.winner || !INHERITED_COLOR_PROPERTIES.has(property)) return direct

  for (let inheritedDepth = 0; inheritedDepth < context.inheritedRules.length; inheritedDepth += 1) {
    const inherited = chooseWinner(
      collectCandidates(context.inheritedRules[inheritedDepth], property, inheritedDepth + 1),
    )
    if (inherited.winner) return inherited
  }
  return direct
}

function findCustomPropertyWinner(context: SemanticTokenInspectorStyleContext, property: string) {
  const direct = chooseWinner(collectCandidates(context.directRules, property))
  if (direct.winner) return direct.winner
  for (let inheritedDepth = 0; inheritedDepth < context.inheritedRules.length; inheritedDepth += 1) {
    const inherited = chooseWinner(
      collectCandidates(context.inheritedRules[inheritedDepth], property, inheritedDepth + 1),
    )
    if (inherited.winner) return inherited.winner
  }
  return null
}

function sourceFromCandidate(candidate: DeclarationCandidate): SemanticTokenInspectorSource {
  return {
    selector: candidate.rule.selector,
    origin: candidate.rule.origin,
    sourceURL: candidate.rule.sourceURL,
    line: candidate.rule.line,
    column: candidate.rule.column,
    important: candidate.important || undefined,
    inheritedDepth: candidate.inheritedDepth,
    pseudoType: candidate.rule.pseudoType,
    editRef: candidate.editRef,
    ruleRef: candidate.rule.ruleRef,
  }
}

function classifyTokenName(name: string): SemanticTokenInspectorTokenKind {
  const normalized = normalizeTokenName(name)
  if (normalized.startsWith("mix-") || derivationNames.has(normalized)) return "mixed"
  if (normalized.startsWith("seg-")) return "legacy"
  if (runtimeMetadataByName.has(normalized)) {
    const metadata = runtimeMetadataByName.get(normalized)
    if (normalized.startsWith("brand-")) return "brand"
    if (metadata?.layer === "foundation") return "foundation"
    return "semantic-runtime"
  }
  if (modeTokenMetadata[normalized]) {
    if (normalized.startsWith("brand-") || brandModeTokenNames.has(normalized)) return "brand"
    return "semantic-mode"
  }
  if (normalized.startsWith("brand-")) return "brand"
  if (normalized.startsWith("surface-") || normalized.startsWith("text-") || normalized.startsWith("border-")) {
    return "foundation"
  }
  return "local"
}

function createTokenNode(
  name: string,
  depth: number,
  value?: string,
  source?: SemanticTokenInspectorSource,
): SemanticTokenInspectorTokenNode {
  const normalized = normalizeTokenName(name)
  const runtime = runtimeMetadataByName.get(normalized)
  const mode = modeTokenMetadata[normalized]
  return {
    name: tokenCssName(normalized),
    depth,
    kind: classifyTokenName(normalized),
    value,
    label: runtime?.label ?? mode?.label,
    groupLabel: runtime?.groupLabel ?? mode?.groupLabel,
    layer: runtime?.layer ?? mode?.layer,
    mode: mode?.mode,
    rowID: runtime?.rowID ?? mode?.rowID,
    source,
  }
}

function canResolveCssValue(
  context: SemanticTokenInspectorStyleContext,
  value: string,
  depth: number,
  visited: Set<string>,
): boolean {
  if (depth >= 16) return false
  return extractVarReferences(value).every((reference) =>
    canResolveTokenReference(context, reference, depth + 1, visited),
  )
}

function canResolveTokenReference(
  context: SemanticTokenInspectorStyleContext,
  reference: CssVarReference,
  depth: number,
  visited: Set<string>,
): boolean {
  const normalized = normalizeTokenName(reference.name)
  if (depth >= 16 || visited.has(normalized)) {
    return Boolean(reference.fallback) &&
      canResolveCssValue(context, reference.fallback, depth + 1, visited)
  }

  const nextVisited = new Set(visited)
  nextVisited.add(normalized)
  const winner = findCustomPropertyWinner(context, tokenCssName(normalized))
  if (winner && canResolveCssValue(context, winner.authoredValue, depth + 1, nextVisited)) {
    return true
  }

  const runtime = runtimeMetadataByName.get(normalized)
  if (runtime) {
    const activeModeToken = context.resolvedColorMode === "dark" ? runtime.darkToken : runtime.lightToken
    if (canResolveTokenReference(
      context,
      { name: activeModeToken, fallback: "" },
      depth + 1,
      nextVisited,
    )) {
      return true
    }
  } else if (modeTokenMetadata[normalized] || derivationNames.has(normalized)) {
    return true
  }

  return Boolean(reference.fallback) &&
    canResolveCssValue(context, reference.fallback, depth + 1, nextVisited)
}

function resolveReferenceNodes(
  context: SemanticTokenInspectorStyleContext,
  reference: CssVarReference,
  depth: number,
  visited: Set<string>,
): SemanticTokenInspectorTokenNode[] {
  const primaryNodes = resolveTokenNodes(context, reference.name, depth, visited)
  const primaryReference = { name: reference.name, fallback: "" }
  if (canResolveTokenReference(context, primaryReference, depth, visited) || !reference.fallback) {
    return primaryNodes
  }

  const fallbackNodes = extractVarReferences(reference.fallback).flatMap((fallbackReference) =>
    resolveReferenceNodes(context, fallbackReference, depth + 1, visited),
  )
  return [...primaryNodes, ...fallbackNodes]
}

function resolveTokenNodes(
  context: SemanticTokenInspectorStyleContext,
  name: string,
  depth: number,
  visited: Set<string>,
): SemanticTokenInspectorTokenNode[] {
  const normalized = normalizeTokenName(name)
  const cssName = tokenCssName(normalized)
  const winner = findCustomPropertyWinner(context, cssName)
  const node = createTokenNode(
    cssName,
    depth,
    winner?.authoredValue,
    winner ? sourceFromCandidate(winner) : undefined,
  )

  if (visited.has(normalized)) {
    node.cycle = true
    node.unresolved = true
    return [node]
  }
  if (depth >= 16) {
    node.unresolved = true
    return [node]
  }

  const nextVisited = new Set(visited)
  nextVisited.add(normalized)
  const nodes = [node]
  const references = winner ? extractVarReferences(winner.authoredValue) : []

  for (const reference of references) {
    nodes.push(...resolveReferenceNodes(context, reference, depth + 1, nextVisited))
  }

  const runtime = runtimeMetadataByName.get(normalized)
  if (runtime && references.length === 0) {
    const activeModeToken = context.resolvedColorMode === "dark" ? runtime.darkToken : runtime.lightToken
    nodes.push(...resolveReferenceNodes(
      context,
      { name: activeModeToken, fallback: "" },
      depth + 1,
      nextVisited,
    ))
  }

  if (!winner && !runtime && !modeTokenMetadata[normalized] && !derivationNames.has(normalized)) {
    node.unresolved = true
  }

  return nodes
}

function resolveDeclarationTokenNodes(
  context: SemanticTokenInspectorStyleContext,
  value: string,
) {
  return extractVarReferences(value).flatMap((reference) =>
    resolveReferenceNodes(context, reference, 0, new Set()),
  )
}

function hasHardcodedFallback(value: string): boolean {
  return extractVarReferences(value).some((reference) => {
    if (!reference.fallback) return false
    if (isNeutralValue(reference.fallback)) return false
    const nestedReferences = extractVarReferences(reference.fallback)
    return nestedReferences.length === 0 || hasHardcodedFallback(reference.fallback)
  })
}

function classifyProperty(
  authoredValue: string | undefined,
  tokens: readonly SemanticTokenInspectorTokenNode[],
  confidence: SemanticTokenInspectorConfidence,
) {
  if (confidence === "ambiguous") {
    return {
      diagnosis: "ambiguous" as const,
      severity: "unknown" as const,
      summary: "无法唯一判定生效声明",
    }
  }
  if (!authoredValue) {
    return {
      diagnosis: "computed-only" as const,
      severity: "unknown" as const,
      summary: "仅能读取计算值",
    }
  }
  if (containsUrl(authoredValue)) {
    return {
      diagnosis: "image-resource" as const,
      severity: "info" as const,
      summary: "图像资源，不由颜色 token 控制",
    }
  }

  const hasMix = containsColorMix(authoredValue) || tokens.some((token) =>
    token.kind === "mixed" || (token.value ? containsColorMix(token.value) : false),
  )
  if (hasMix) {
    return {
      diagnosis: "mixed-color" as const,
      severity: "error" as const,
      summary: "颜色链包含运行时混色",
    }
  }

  const topLevelTokens = tokens.filter((token) => token.depth === 0)
  const localLiteral = tokens.some((token) =>
    token.kind === "local" &&
    Boolean(token.value) &&
    extractVarReferences(token.value ?? "").length === 0 &&
    !isNeutralValue(token.value ?? ""),
  )
  const chainHasHardcodedFallback = tokens.some((token) =>
    Boolean(token.value) && hasHardcodedFallback(token.value ?? ""),
  )
  if (hasHardcodedFallback(authoredValue) || chainHasHardcodedFallback || localLiteral) {
    return {
      diagnosis: "hardcoded-color" as const,
      severity: "error" as const,
      summary: "颜色链包含组件级字面颜色或硬编码 fallback",
    }
  }
  if (topLevelTokens.some((token) => token.kind === "semantic-mode" || (token.mode && token.kind === "brand"))) {
    return {
      diagnosis: "mode-token" as const,
      severity: "error" as const,
      summary: "组件直接使用了 light/dark 模式 token",
    }
  }
  if (topLevelTokens.some((token) => token.kind === "legacy")) {
    return {
      diagnosis: "legacy-token" as const,
      severity: "warning" as const,
      summary: "组件仍在使用兼容或历史 token",
    }
  }
  if (topLevelTokens.some((token) => token.kind === "brand")) {
    return {
      diagnosis: "brand-token" as const,
      severity: "warning" as const,
      summary: "组件直接使用品牌 token",
    }
  }
  if (topLevelTokens.some((token) => token.kind === "foundation")) {
    return {
      diagnosis: "foundation-token" as const,
      severity: "warning" as const,
      summary: "组件直接使用 foundation token",
    }
  }
  if (topLevelTokens.some((token) => token.kind === "semantic-runtime")) {
    return {
      diagnosis: "semantic-runtime" as const,
      severity: "pass" as const,
      summary: "组件使用已登记的 runtime token",
    }
  }

  const reachesRuntime = tokens.some((token) => token.kind === "semantic-runtime")
  if (topLevelTokens.length > 0 && reachesRuntime) {
    return {
      diagnosis: "semantic-runtime-indirect" as const,
      severity: "pass" as const,
      summary: "局部别名最终指向 runtime token",
    }
  }

  const unresolvedLocal = tokens.some((token) => token.kind === "local" && token.unresolved)
  if (topLevelTokens.length > 0) {
    return {
      diagnosis: "local-token" as const,
      severity: unresolvedLocal ? "unknown" as const : "warning" as const,
      summary: unresolvedLocal ? "局部 token 无法解析" : "局部 token 未连接到已登记 runtime token",
    }
  }
  if (isNeutralValue(authoredValue)) {
    return {
      diagnosis: "neutral-keyword" as const,
      severity: "info" as const,
      summary: "CSS 语义关键字",
    }
  }
  return {
    diagnosis: "hardcoded-color" as const,
    severity: "error" as const,
    summary: "组件直接使用字面颜色",
  }
}

function shouldIncludeComputedOnly(property: SemanticTokenInspectedProperty, computedValue: string) {
  const normalized = computedValue.trim().toLowerCase()
  if (property === "color") return Boolean(normalized)
  if (property === "background-color") return Boolean(normalized) && normalized !== "rgba(0, 0, 0, 0)" && normalized !== "transparent"
  if (property === "background-image") return normalized !== "" && normalized !== "none"
  return false
}

function sourceCandidates(candidates: readonly DeclarationCandidate[]) {
  return candidates
    .slice(-4)
    .reverse()
    .map(sourceFromCandidate)
}

function createPropertyResult(
  context: SemanticTokenInspectorStyleContext,
  property: SemanticTokenInspectedProperty,
  includeInactive = false,
): SemanticTokenInspectorPropertyResult | null {
  const computedValue = context.computedStyle[property] ?? ""
  const winning = findWinningDeclaration(context, property)
  if (
    !winning.winner &&
    !shouldIncludeComputedOnly(property, computedValue) &&
    !includeInactive
  ) {
    return null
  }

  const winner = winning.winner
  const authoredValue = winner?.authoredValue
  const usesCurrentColor = property !== "color" && authoredValue?.trim().toLowerCase() === "currentcolor"
  const linkedColor = usesCurrentColor ? findWinningDeclaration(context, "color").winner : undefined
  const tokenSourceValue = linkedColor?.authoredValue ?? authoredValue
  const tokens = tokenSourceValue ? resolveDeclarationTokenNodes(context, tokenSourceValue) : []
  const classification = classifyProperty(authoredValue, tokens, winning.confidence)

  return {
    property,
    authoredProperty: winner?.authoredProperty,
    authoredValue,
    computedValue,
    confidence: winning.confidence,
    diagnosis: classification.diagnosis,
    severity: classification.severity,
    summary: usesCurrentColor && tokens.length > 0
      ? `currentColor → ${classification.summary}`
      : classification.summary,
    scope: usesCurrentColor
      ? "currentColor"
      : winner?.rule.pseudoType
      ? "pseudo"
      : winner?.inheritedDepth
        ? "inherited"
        : winner
          ? "direct"
          : "computed",
    source: winner ? sourceFromCandidate(winner) : undefined,
    tokens,
    candidates: winning.confidence === "ambiguous" ? sourceCandidates(winning.candidates) : undefined,
    dynamic: context.dynamic || undefined,
  }
}

function borderRenderingSignature(
  context: SemanticTokenInspectorStyleContext,
  side: "top" | "right" | "bottom" | "left",
) {
  return [
    context.computedStyle[`border-${side}-width`] ?? "",
    context.computedStyle[`border-${side}-style`] ?? "",
  ].join("|")
}

function collapseBorderProperties(
  properties: SemanticTokenInspectorPropertyResult[],
  context: SemanticTokenInspectorStyleContext,
) {
  const borderNames = [
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
  ] as const
  const borders = borderNames.map((name) => properties.find((property) => property.property === name))
  if (borders.some((property) => !property)) return properties
  const renderingSignatures = (["top", "right", "bottom", "left"] as const)
    .map((side) => borderRenderingSignature(context, side))
  if (renderingSignatures.some((signature) => signature !== renderingSignatures[0])) {
    return properties
  }
  const [first, ...rest] = borders as SemanticTokenInspectorPropertyResult[]
  const comparableSource = first.source
    ? {
        ...first.source,
        editRef: undefined,
      }
    : undefined
  const signature = JSON.stringify({
    authoredValue: first.authoredValue,
    computedValue: first.computedValue,
    diagnosis: first.diagnosis,
    source: comparableSource,
    tokens: first.tokens.map((token) => [token.name, token.value]),
  })
  if (rest.some((property) => JSON.stringify({
    authoredValue: property.authoredValue,
    computedValue: property.computedValue,
    diagnosis: property.diagnosis,
    source: property.source
      ? {
          ...property.source,
          editRef: undefined,
        }
      : undefined,
    tokens: property.tokens.map((token) => [token.name, token.value]),
  }) !== signature)) {
    return properties
  }

  const sharesEditableDeclaration = rest.every((property) =>
    property.authoredProperty === first.authoredProperty &&
    property.source?.editRef === first.source?.editRef,
  )
  const collapsed = sharesEditableDeclaration
    ? first
    : {
        ...first,
        authoredProperty: undefined,
        authoredValue: undefined,
        source: first.source
          ? {
              ...first.source,
              editRef: undefined,
            }
          : undefined,
      }
  const borderNameSet = new Set<string>(borderNames)
  return [
    ...properties.filter((property) => !borderNameSet.has(property.property)),
    { ...collapsed, property: "border-color" as const },
  ]
}

const CHANNEL_METADATA: Record<
  SemanticTokenInspectorPropertyResult["property"],
  { kind: SemanticTokenColorChannelKind; label: string }
> = {
  "background-color": { kind: "background", label: "背景" },
  "background-image": { kind: "background-image", label: "背景图片与渐变" },
  "color": { kind: "foreground", label: "文字与前景" },
  "border-color": { kind: "border", label: "边框" },
  "border-top-color": { kind: "border-top", label: "上边框" },
  "border-right-color": { kind: "border-right", label: "右边框" },
  "border-bottom-color": { kind: "border-bottom", label: "下边框" },
  "border-left-color": { kind: "border-left", label: "左边框" },
  "outline-color": { kind: "outline", label: "轮廓" },
  "text-decoration-color": { kind: "text-decoration", label: "文本装饰" },
  "fill": { kind: "icon-fill", label: "图标填充" },
  "stroke": { kind: "icon-stroke", label: "图标描边" },
  "box-shadow": { kind: "shadow", label: "阴影" },
  "text-shadow": { kind: "text-shadow", label: "文字阴影" },
  "caret-color": { kind: "caret", label: "光标" },
  "accent-color": { kind: "accent", label: "控件强调色" },
  "image-source": { kind: "image-source", label: "图片内容" },
}

const CHANNEL_ORDER: SemanticTokenColorChannelKind[] = [
  "background",
  "foreground",
  "icon-fill",
  "icon-stroke",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left",
  "outline",
  "text-decoration",
  "shadow",
  "text-shadow",
  "caret",
  "accent",
  "background-image",
  "image-source",
]

const SVG_TARGETS = new Set([
  "SVG",
  "PATH",
  "CIRCLE",
  "ELLIPSE",
  "LINE",
  "POLYGON",
  "POLYLINE",
  "RECT",
  "TEXT",
  "USE",
])

function isTransparentComputedColor(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === "transparent" || normalized === "none") return true
  if (/^rgba?\([^)]*[,/]\s*0(?:\.0+)?\s*\)$/.test(normalized)) return true
  if (/^color\([^)]*\/\s*0(?:\.0+)?\s*\)$/.test(normalized)) return true
  return false
}

function isPositiveCssLength(value: string) {
  const numeric = Number.parseFloat(value)
  return Number.isFinite(numeric) && numeric > 0
}

function borderSideFromProperty(property: string) {
  const match = property.match(/^border-(top|right|bottom|left)-color$/)
  return match?.[1] as "top" | "right" | "bottom" | "left" | undefined
}

function channelVisibility(
  context: SemanticTokenInspectorStyleContext,
  property: SemanticTokenInspectorPropertyResult,
): { visibility: SemanticTokenColorChannelVisibility; reason?: string } {
  const value = property.computedValue.trim()
  const side = borderSideFromProperty(property.property)
  if (property.property === "border-color") {
    const results = (["top", "right", "bottom", "left"] as const).map((borderSide) =>
      channelVisibility(context, {
        ...property,
        property: `border-${borderSide}-color`,
        computedValue: context.computedStyle[`border-${borderSide}-color`] ?? value,
      }),
    )
    if (results.every((result) => result.visibility === "visible")) return { visibility: "visible" }
    if (results.every((result) => result.visibility === "inactive")) {
      return { visibility: "inactive", reason: "边框宽度为 0、样式为 none，或颜色完全透明。" }
    }
    return { visibility: "unknown", reason: "四条边的渲染状态不一致。" }
  }
  if (side) {
    const width = context.computedStyle[`border-${side}-width`] ?? ""
    const style = (context.computedStyle[`border-${side}-style`] ?? "").trim().toLowerCase()
    if (!width || !style) {
      return { visibility: "unknown", reason: "缺少边框宽度或样式的计算值。" }
    }
    if (
      !isPositiveCssLength(width) ||
      style === "none" ||
      style === "hidden" ||
      isTransparentComputedColor(value)
    ) {
      return { visibility: "inactive", reason: "边框宽度为 0、样式为 none，或颜色完全透明。" }
    }
    return { visibility: "visible" }
  }
  if (property.property === "outline-color") {
    const width = context.computedStyle["outline-width"] ?? ""
    const style = (context.computedStyle["outline-style"] ?? "").trim().toLowerCase()
    if (!width || !style) return { visibility: "unknown", reason: "缺少轮廓宽度或样式的计算值。" }
    if (!isPositiveCssLength(width) || style === "none" || isTransparentComputedColor(value)) {
      return { visibility: "inactive", reason: "轮廓宽度为 0、样式为 none，或颜色完全透明。" }
    }
    return { visibility: "visible" }
  }
  if (property.property === "text-decoration-color") {
    const line = (context.computedStyle["text-decoration-line"] ?? "").trim().toLowerCase()
    if (!line) return { visibility: "unknown", reason: "缺少文本装饰线的计算值。" }
    if (line === "none" || isTransparentComputedColor(value)) {
      return { visibility: "inactive", reason: "当前没有显示文本装饰线。" }
    }
    return { visibility: "visible" }
  }
  if (property.property === "box-shadow" || property.property === "text-shadow") {
    if (!value) return { visibility: "unknown", reason: "缺少阴影计算值。" }
    if (value.toLowerCase() === "none") return { visibility: "inactive", reason: "当前没有显示阴影。" }
    return { visibility: "visible" }
  }
  if (property.property === "background-image") {
    if (!value) return { visibility: "unknown", reason: "缺少背景图片计算值。" }
    return value.toLowerCase() === "none"
      ? { visibility: "inactive", reason: "当前没有显示背景图片或渐变。" }
      : { visibility: "visible" }
  }
  if (property.property === "fill" || property.property === "stroke") {
    if (!value) return { visibility: "unknown", reason: "缺少 SVG 颜色计算值。" }
    if (
      isTransparentComputedColor(value) ||
      (!SVG_TARGETS.has(context.target.tagName) && !property.authoredProperty)
    ) {
      return { visibility: "inactive", reason: "该元素当前没有显示这一图标颜色通道。" }
    }
    return { visibility: "visible" }
  }
  if (property.property === "caret-color") {
    const supportsCaret = ["INPUT", "TEXTAREA"].includes(context.target.tagName)
    if (!supportsCaret && !property.authoredProperty) {
      return { visibility: "inactive", reason: "该元素当前不显示文本输入光标。" }
    }
  }
  if (property.property === "accent-color") {
    const supportsAccent = ["INPUT", "METER", "PROGRESS", "SELECT"].includes(context.target.tagName)
    if (!supportsAccent && !property.authoredProperty) {
      return { visibility: "inactive", reason: "该元素当前不使用控件强调色。" }
    }
  }
  if (property.property === "image-source") return { visibility: "visible" }
  if (!value) return { visibility: "unknown", reason: "缺少该通道的计算值。" }
  if (
    property.property === "background-color" &&
    isTransparentComputedColor(value)
  ) {
    return { visibility: "inactive", reason: "背景颜色完全透明。" }
  }
  return { visibility: "visible" }
}

function selectorInteractionState(selector: string): SemanticTokenInspectorInteractionState {
  const normalized = selector.toLowerCase()
  if (
    normalized.includes(":disabled") ||
    normalized.includes("[disabled") ||
    normalized.includes("aria-disabled") ||
    /(?:^|[.\s_-])disabled(?:$|[.\s_:[-])/.test(normalized)
  ) {
    return "disabled"
  }
  if (
    normalized.includes(":checked") ||
    normalized.includes("aria-selected") ||
    normalized.includes("data-selected") ||
    /(?:^|[.\s_-])selected(?:$|[.\s_:[-])/.test(normalized)
  ) {
    return "selected"
  }
  if (
    normalized.includes("aria-expanded") ||
    normalized.includes("data-expanded") ||
    /(?:^|[.\s_-])expanded(?:$|[.\s_:[-])/.test(normalized)
  ) {
    return "expanded"
  }
  if (normalized.includes(":active") || normalized.includes("[data-state=\"active\"]")) {
    return "active"
  }
  if (normalized.includes(":focus")) return "focus"
  if (normalized.includes(":hover")) return "hover"
  return "default"
}

const STATE_LABELS: Record<SemanticTokenInspectorInteractionState, string> = {
  default: "Default",
  hover: "Hover",
  focus: "Focus",
  active: "Active",
  expanded: "Expanded",
  selected: "Selected",
  disabled: "Disabled",
}

function scopeDescription(property: SemanticTokenInspectorPropertyResult) {
  if (property.scope === "currentColor") return "跟随文字与前景颜色"
  if (property.scope === "inherited") return "从祖先元素继承"
  if (property.scope === "pseudo") return "来自伪元素规则"
  if (property.scope === "computed") return "仅有浏览器计算值"
  return "当前命中 selector 的 author rule"
}

function hasTopLevelComma(value: string) {
  let depth = 0
  let quote = ""
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (character === "\\") index += 1
      else if (character === quote) quote = ""
      continue
    }
    if (character === "\"" || character === "'") {
      quote = character
      continue
    }
    if (character === "(") depth += 1
    else if (character === ")") depth = Math.max(0, depth - 1)
    else if (character === "," && depth === 0) return true
  }
  return false
}

function insertionRuleCandidates(
  context: SemanticTokenInspectorStyleContext,
): SemanticTokenAuthoringRuleCandidate[] {
  const candidates = context.directRules
    .filter((rule) =>
      Boolean(rule.ruleRef) &&
      !rule.inline &&
      !rule.pseudoType &&
      rule.origin.toLowerCase() === "regular",
    )
    .sort((left, right) => {
      const leftSpecificity = left.specificity ?? [0, 0, 0]
      const rightSpecificity = right.specificity ?? [0, 0, 0]
      const specificity = compareTuples(leftSpecificity, rightSpecificity)
      return specificity === 0 ? left.sourceOrder - right.sourceOrder : specificity
    })
    .reverse()
    .slice(0, 8)

  return candidates.map((rule, index) => ({
    ruleRef: rule.ruleRef!,
    selector: rule.selector,
    sourceLabel: rule.sourceURL
      ? `${rule.sourceURL}${rule.line ? `:${rule.line}` : ""}`
      : rule.selector,
    recommended: index === 0,
  }))
}

function channelReadOnlyReason(
  property: SemanticTokenInspectorPropertyResult,
  insertionRules: readonly SemanticTokenAuthoringRuleCandidate[],
) {
  if (property.property === "image-source") return "图片内部颜色不能安全改写。"
  if (property.property === "background-image") return "图片与渐变结构在第一版中只读。"
  if (
    (property.property === "box-shadow" || property.property === "text-shadow") &&
    hasTopLevelComma(property.authoredValue ?? property.computedValue)
  ) {
    return "多重阴影无法安全地绑定为单一颜色 Token。"
  }
  if (property.confidence === "ambiguous") return "存在多个无法唯一排序的生效声明。"
  if (property.scope === "pseudo") return "伪元素声明暂不支持写回。"
  if (property.scope === "inherited") return "继承声明属于祖先元素，请先选择对应祖先。"
  if (property.source?.editRef) return undefined
  if (insertionRules.length > 0) return undefined
  if (property.scope === "computed") return "没有可安全插入声明的本地 author rule。"
  return "声明来自外部、生成或无法定位的样式表。"
}

function createColorChannel(
  context: SemanticTokenInspectorStyleContext,
  property: SemanticTokenInspectorPropertyResult,
  insertionRules: SemanticTokenAuthoringRuleCandidate[],
): SemanticTokenColorChannelResult {
  const metadata = CHANNEL_METADATA[property.property]
  const visibility = channelVisibility(context, property)
  const state = selectorInteractionState(property.source?.selector ?? "")
  const currentRuntimeToken = property.tokens.find((token) => token.kind === "semantic-runtime")
    ?.name.replace(/^--/, "")
  const reason = channelReadOnlyReason(property, insertionRules)
  const previewable = (
    property.property !== "image-source" &&
    property.property !== "background-image" &&
    !(
      (property.property === "box-shadow" || property.property === "text-shadow") &&
      hasTopLevelComma(property.authoredValue ?? property.computedValue)
    )
  )

  return {
    id: property.property,
    kind: metadata.kind,
    label: metadata.label,
    cssProperty: property.property,
    authoredProperty: property.authoredProperty,
    authoredValue: property.authoredValue,
    computedColor: property.computedValue,
    visibility: visibility.visibility,
    visibilityReason: visibility.reason,
    currentRuntimeToken,
    followsChannelID: property.scope === "currentColor" ? "color" : undefined,
    state,
    stateLabel: STATE_LABELS[state],
    scopeDescription: scopeDescription(property),
    previewable,
    writable: previewable && !reason,
    readOnlyReason: reason,
    editRef: property.source?.editRef,
    insertionRules: property.source?.editRef ? [] : insertionRules,
  }
}

function sortColorChannels(channels: SemanticTokenColorChannelResult[]) {
  const visibilityOrder: Record<SemanticTokenColorChannelVisibility, number> = {
    visible: 0,
    inactive: 1,
    unknown: 2,
  }
  return channels.sort((left, right) => {
    const visibility = visibilityOrder[left.visibility] - visibilityOrder[right.visibility]
    if (visibility !== 0) return visibility
    return CHANNEL_ORDER.indexOf(left.kind) - CHANNEL_ORDER.indexOf(right.kind)
  })
}

export function analyzeSemanticTokenStyles(
  context: SemanticTokenInspectorStyleContext,
): SemanticTokenInspection {
  const properties = SEMANTIC_TOKEN_INSPECTED_PROPERTIES
    .map((property) => createPropertyResult(context, property))
    .filter((property): property is SemanticTokenInspectorPropertyResult => Boolean(property))
  const channelProperties = SEMANTIC_TOKEN_INSPECTED_PROPERTIES
    .map((property) => createPropertyResult(context, property, true))
    .filter((property): property is SemanticTokenInspectorPropertyResult => Boolean(property))

  if (context.target.assetKind === "image") {
    const imageSource = {
      property: "image-source",
      computedValue: "",
      confidence: "exact",
      diagnosis: "image-resource",
      severity: "info",
      summary: "图像资源，不由颜色 token 控制",
      scope: "direct",
      tokens: [],
    } satisfies SemanticTokenInspectorPropertyResult
    properties.unshift(imageSource)
    channelProperties.unshift(imageSource)
  }

  const insertionRules = insertionRuleCandidates(context)
  const collapsedChannels = collapseBorderProperties(channelProperties, context)

  return {
    target: context.target,
    properties: collapseBorderProperties(properties, context),
    channels: sortColorChannels(
      collapsedChannels.map((property) => createColorChannel(context, property, insertionRules)),
    ),
    warnings: [...(context.warnings ?? [])],
  }
}
