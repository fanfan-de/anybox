import type { WebContents } from "electron"
import { randomUUID } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import type { Dirent } from "node:fs"
import path from "node:path"
import postcss from "postcss"
import type {
  CommitSemanticTokenAuthoringCommitInput,
  CommitSemanticTokenAuthoringCommitResult,
  DiscardSemanticTokenAuthoringCommitInput,
  DiscardSemanticTokenAuthoringCommitResult,
  PrepareSemanticTokenAuthoringCommitInput,
  PrepareSemanticTokenAuthoringCommitResult,
} from "../shared/semantic-token-authoring"
import {
  analyzeSemanticTokenStyles,
  type SemanticTokenInspectorDeclaration,
  type SemanticTokenInspectorEvent,
  type SemanticTokenInspectorInspectInput,
  type SemanticTokenInspectorInspectResult,
  type SemanticTokenInspectorStartResult,
  type SemanticTokenInspectorStopResult,
  type SemanticTokenInspectorStyleRule,
  type SemanticTokenInspectorTarget,
} from "../shared/semantic-token-inspector"
import {
  resolveSemanticTokenSourcePath,
  SemanticTokenAuthoringService,
  type SemanticTokenAuthoringOpaqueReference,
} from "./semantic-token-authoring"

interface ProtocolRange {
  startLine?: number
  startColumn?: number
  endLine?: number
  endColumn?: number
}

interface ProtocolSpecificity {
  a?: number
  b?: number
  c?: number
}

interface ProtocolValue {
  text?: string
  specificity?: ProtocolSpecificity
}

interface ProtocolProperty {
  name?: string
  value?: string
  important?: boolean
  implicit?: boolean
  disabled?: boolean
  parsedOk?: boolean
  range?: ProtocolRange
  longhandProperties?: ProtocolProperty[]
}

interface ProtocolStyle {
  styleSheetId?: string
  range?: ProtocolRange
  cssProperties?: ProtocolProperty[]
}

interface ProtocolRule {
  styleSheetId?: string
  origin?: string
  selectorList?: {
    text?: string
    selectors?: ProtocolValue[]
  }
  style?: ProtocolStyle
  media?: Array<{ active?: boolean }>
  containerQueries?: Array<{ active?: boolean }>
  supports?: Array<{ active?: boolean }>
  layers?: ProtocolValue[]
  scopes?: unknown[]
}

interface ProtocolRuleMatch {
  rule?: ProtocolRule
  matchingSelectors?: number[]
}

interface ProtocolMatchedStyles {
  inlineStyle?: ProtocolStyle
  attributesStyle?: ProtocolStyle
  matchedCSSRules?: ProtocolRuleMatch[]
  inherited?: Array<{
    inlineStyle?: ProtocolStyle
    matchedCSSRules?: ProtocolRuleMatch[]
  }>
}

interface ProtocolNode {
  nodeId?: number
  backendNodeId?: number
  nodeType?: number
  nodeName?: string
  localName?: string
  parentId?: number
  attributes?: string[]
  pseudoType?: string
}

interface ProtocolStyleSheetHeader {
  styleSheetId?: string
  sourceURL?: string
  ownerNode?: number
}

interface InspectorStyleSheetHeader {
  order: number
  sourceURL?: string
  sourceResolution?: Promise<void>
}

interface LocalCssRuleLocation {
  filePath: string
  ruleLine?: number
  declarations: Array<{ name: string; value: string }>
}

interface InspectorSession {
  contents: WebContents
  authoringSessionID: string
  authoringReferences: Map<string, SemanticTokenAuthoringOpaqueReference>
  authoringReferenceIDs: Map<string, string>
  rendererSourceRoot?: string
  stylesheetHeaders: Map<string, InspectorStyleSheetHeader>
  localCssRuleIndex?: Map<string, LocalCssRuleLocation[]>
  nextStylesheetOrder: number
  stopping: boolean
  onBeforeInputEvent: (...args: unknown[]) => void
  onDebuggerDetach: (...args: unknown[]) => void
  onDebuggerMessage: (...args: unknown[]) => void
  onDevToolsOpened: () => void
  onDestroyed: () => void
  onDidNavigate: () => void
  onRenderProcessGone: () => void
}

type InspectorEventEmitter = (contents: WebContents, event: SemanticTokenInspectorEvent) => void

interface SemanticTokenInspectorSessionManagerOptions {
  packageRoot?: string
  rendererSourceRoot?: string
  packaged?: boolean
}

const PROTOCOL_VERSION = "1.3"
const MAX_ANCESTOR_DEPTH = 8
const MAX_COORDINATE = 1_000_000
const MAX_AUTHORING_REFERENCES = 4_096
const AUTHORABLE_COLOR_DECLARATIONS = new Set([
  "background",
  "background-color",
  "color",
  "border",
  "border-color",
  "border-top",
  "border-top-color",
  "border-right",
  "border-right-color",
  "border-bottom",
  "border-bottom-color",
  "border-left",
  "border-left-color",
  "outline",
  "outline-color",
  "text-decoration",
  "text-decoration-color",
  "fill",
  "stroke",
  "box-shadow",
  "text-shadow",
  "caret-color",
  "accent-color",
])

function nodeAttribute(attributes: readonly string[] | undefined, name: string) {
  if (!attributes) return undefined
  for (let index = 0; index < attributes.length; index += 2) {
    if (attributes[index] === name) return attributes[index + 1]
  }
  return undefined
}

async function resolveStyleSheetOwnerSource(
  session: InspectorSession,
  styleSheetID: string,
  ownerNode: number,
  entry: InspectorStyleSheetHeader,
) {
  try {
    const description = await session.contents.debugger.sendCommand("DOM.describeNode", {
      backendNodeId: ownerNode,
      depth: 0,
      pierce: true,
    }) as { node?: ProtocolNode }
    const viteDevID = nodeAttribute(description.node?.attributes, "data-vite-dev-id")
    if (
      viteDevID &&
      session.stylesheetHeaders.get(styleSheetID) === entry
    ) {
      entry.sourceURL = viteDevID
    }
  } catch {
    // A stylesheet may disappear during HMR before its owner node is resolved.
  }
}

async function waitForStyleSheetOwnerSources(session: InspectorSession) {
  const pending = [...session.stylesheetHeaders.values()]
    .map((entry) => entry.sourceResolution)
    .filter((resolution): resolution is Promise<void> => Boolean(resolution))
  if (pending.length > 0) await Promise.allSettled(pending)
}

function normalizeLocalSelector(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeCssValue(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function listLocalCssFiles(rootPath: string) {
  const files: string[] = []
  const directories = [rootPath]
  while (directories.length > 0) {
    const directory = directories.pop()!
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true, encoding: "utf8" })
    } catch {
      continue
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() !== "node_modules") directories.push(entryPath)
        continue
      }
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".css") {
        files.push(entryPath)
      }
    }
  }
  return files
}

function getLocalCssRuleIndex(session: InspectorSession) {
  if (session.localCssRuleIndex) return session.localCssRuleIndex
  const index = new Map<string, LocalCssRuleLocation[]>()
  const rendererSourceRoot = session.rendererSourceRoot
  if (!rendererSourceRoot) {
    session.localCssRuleIndex = index
    return index
  }

  for (const candidatePath of listLocalCssFiles(rendererSourceRoot)) {
    const filePath = resolveSemanticTokenSourcePath(candidatePath, rendererSourceRoot)
    if (!filePath) continue
    try {
      const root = postcss.parse(readFileSync(filePath, "utf8"), { from: filePath })
      root.walkRules((rule) => {
        const location: LocalCssRuleLocation = {
          filePath,
          ruleLine: rule.source?.start?.line,
          declarations: [],
        }
        rule.walkDecls((declaration) => {
          location.declarations.push({
            name: declaration.prop,
            value: declaration.value,
          })
        })
        let selectors: string[]
        try {
          selectors = rule.selectors
        } catch {
          selectors = [rule.selector]
        }
        for (const selector of selectors) {
          const key = normalizeLocalSelector(selector)
          if (!key) continue
          const locations = index.get(key) ?? []
          locations.push(location)
          index.set(key, locations)
        }
      })
    } catch {
      // Invalid or partially edited CSS remains inspectable but is not authorable.
    }
  }

  session.localCssRuleIndex = index
  return index
}

function resolveLocalCssRuleLocation(
  session: InspectorSession,
  sourcePath: string | null,
  selector: string,
  style: ProtocolStyle | undefined,
) {
  const candidates = getLocalCssRuleIndex(session).get(normalizeLocalSelector(selector)) ?? []
  if (candidates.length === 0) return null
  const sameSourceCandidates = sourcePath
    ? candidates.filter((candidate) => path.resolve(candidate.filePath) === path.resolve(sourcePath))
    : []
  const pool = sameSourceCandidates.length > 0 ? sameSourceCandidates : candidates
  if (pool.length === 1) return pool[0]

  const authoredDeclarations = (style?.cssProperties ?? [])
    .filter((property) =>
      Boolean(property.name) &&
      typeof property.value === "string" &&
      property.value.trim().length > 0 &&
      !property.implicit &&
      !property.disabled,
    )
    .map((property) => ({
      name: property.name!,
      value: normalizeCssValue(property.value!),
    }))
  const ranked = pool
    .map((candidate) => ({
      candidate,
      score: authoredDeclarations.reduce((score, authored) => {
        const exact = candidate.declarations.some((declaration) =>
          declaration.name === authored.name &&
          normalizeCssValue(declaration.value) === authored.value,
        )
        if (exact) return score + 4
        return candidate.declarations.some((declaration) => declaration.name === authored.name)
          ? score + 1
          : score
      }, 0),
    }))
    .sort((left, right) => right.score - left.score)
  if (ranked[0]?.score > 0 && ranked[0].score > (ranked[1]?.score ?? -1)) {
    return ranked[0].candidate
  }
  return null
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isProtocolUnsupportedError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes("method") ||
    message.includes("css.") ||
    message.includes("dom.")
  ) && (message.includes("not found") || message.includes("wasn't found"))
}

function isTargetNotFoundError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase()
  return message.includes("node") && (
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("could not find")
  )
}

function validateInspectInput(input: SemanticTokenInspectorInspectInput) {
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return false
  if (input.x < 0 || input.y < 0 || input.x > MAX_COORDINATE || input.y > MAX_COORDINATE) return false
  if (!Number.isInteger(input.requestID) || input.requestID < 0) return false
  if (!Number.isInteger(input.ancestorDepth) || input.ancestorDepth < 0 || input.ancestorDepth > MAX_ANCESTOR_DEPTH) {
    return false
  }
  return input.resolvedColorMode === "light" || input.resolvedColorMode === "dark"
}

function attributesToRecord(attributes: readonly string[] | undefined) {
  const record: Record<string, string> = {}
  if (!attributes) return record
  for (let index = 0; index < attributes.length; index += 2) {
    const name = attributes[index]
    if (!name) continue
    record[name] = attributes[index + 1] ?? ""
  }
  return record
}

function assetKindForNode(nodeName: string): SemanticTokenInspectorTarget["assetKind"] {
  if (nodeName === "IMG") return "image"
  if (nodeName === "CANVAS") return "canvas"
  if (nodeName === "WEBVIEW") return "webview"
  if (nodeName === "IFRAME") return "iframe"
  return undefined
}

function targetFromNode(node: ProtocolNode, borderQuad?: readonly number[]): SemanticTokenInspectorTarget {
  const attributes = attributesToRecord(node.attributes)
  const tagName = (node.localName || node.nodeName || "unknown").toUpperCase()
  return {
    tagName,
    id: attributes.id || undefined,
    classes: (attributes.class ?? "").split(/\s+/).filter(Boolean).slice(0, 12),
    pseudoType: node.pseudoType,
    borderQuad,
    assetKind: assetKindForNode(tagName),
  }
}

function registerAuthoringReference(
  session: InspectorSession,
  reference: SemanticTokenAuthoringOpaqueReference,
) {
  const referenceKey = JSON.stringify(reference)
  const existingReferenceID = session.authoringReferenceIDs.get(referenceKey)
  if (existingReferenceID) return existingReferenceID
  if (session.authoringReferences.size >= MAX_AUTHORING_REFERENCES) return undefined
  const referenceID = randomUUID()
  session.authoringReferences.set(referenceID, reference)
  session.authoringReferenceIDs.set(referenceKey, referenceID)
  return referenceID
}

function normalizeDeclaration(
  property: ProtocolProperty,
  editRef?: string,
): SemanticTokenInspectorDeclaration | null {
  if (!property.name || typeof property.value !== "string") return null
  return {
    name: property.name,
    value: property.value,
    important: property.important,
    implicit: property.implicit,
    disabled: property.disabled,
    parsedOk: property.parsedOk,
    longhands: property.longhandProperties
      ?.filter((entry): entry is ProtocolProperty & { name: string; value: string } =>
        Boolean(entry.name) && typeof entry.value === "string",
      )
      .map((entry) => ({ name: entry.name, value: entry.value })),
    editRef,
  }
}

function maximumSpecificity(
  selectors: readonly ProtocolValue[],
  matchingSelectors: readonly number[],
) {
  let maximum: readonly [number, number, number] | undefined
  for (const selectorIndex of matchingSelectors) {
    const specificity = selectors[selectorIndex]?.specificity
    if (!specificity) continue
    const next = [specificity.a ?? 0, specificity.b ?? 0, specificity.c ?? 0] as const
    if (
      !maximum ||
      next[0] > maximum[0] ||
      (next[0] === maximum[0] && next[1] > maximum[1]) ||
      (next[0] === maximum[0] && next[1] === maximum[1] && next[2] > maximum[2])
    ) {
      maximum = next
    }
  }
  return maximum
}

function ruleConditionsAreActive(rule: ProtocolRule) {
  const conditions = [
    ...(rule.media ?? []),
    ...(rule.containerQueries ?? []),
    ...(rule.supports ?? []),
  ]
  return conditions.every((condition) => condition.active !== false)
}

function normalizeStyleRule(
  style: ProtocolStyle | undefined,
  options: {
    selector: string
    origin: string
    inline?: boolean
    specificity?: readonly [number, number, number]
    sourceOrder: number
    stylesheetHeaders: InspectorSession["stylesheetHeaders"]
    styleSheetId?: string
    layerOrder?: number
    layered?: boolean
    unsupportedScope?: boolean
    pseudoType?: string
    session: InspectorSession
  },
): SemanticTokenInspectorStyleRule | null {
  const styleSheetId = style?.styleSheetId ?? options.styleSheetId
  const header = styleSheetId
    ? options.stylesheetHeaders.get(styleSheetId)
    : undefined
  const reportedSourceURL = header?.sourceURL
  const reportedSourcePath = (
    !options.inline &&
    !options.pseudoType &&
    options.origin.toLowerCase() === "regular"
  )
    ? resolveSemanticTokenSourcePath(
        reportedSourceURL,
        options.session.rendererSourceRoot,
      )
    : null
  const localLocation = (
    !options.inline &&
    !options.pseudoType &&
    options.origin.toLowerCase() === "regular"
  )
    ? resolveLocalCssRuleLocation(
        options.session,
        reportedSourcePath,
        options.selector,
        style,
      )
    : null
  const sourcePath = localLocation?.filePath ?? null
  const sourceURL = sourcePath?.replaceAll(path.sep, "/") ?? reportedSourceURL
  const ruleLine = localLocation?.ruleLine ??
    (style?.range?.startLine === undefined ? undefined : style.range.startLine + 1)
  const ruleRef = sourcePath
    ? registerAuthoringReference(options.session, {
        kind: "rule",
        filePath: sourcePath,
        selector: options.selector,
        ruleLine,
      })
    : undefined
  const declarations = (style?.cssProperties ?? [])
    .map((property) => {
      const editRef = (
        sourcePath &&
        property.name &&
        typeof property.value === "string" &&
        property.value.trim().length > 0 &&
        AUTHORABLE_COLOR_DECLARATIONS.has(property.name.toLowerCase()) &&
        !property.implicit &&
        !property.disabled &&
        property.parsedOk !== false
      )
        ? registerAuthoringReference(options.session, {
            kind: "declaration",
            filePath: sourcePath,
            selector: options.selector,
            ruleLine,
            declarationLine: property.range?.startLine === undefined
              ? undefined
              : property.range.startLine + 1,
            authoredProperty: property.name,
            originalValue: property.value,
            important: Boolean(property.important),
          })
        : undefined
      return normalizeDeclaration(property, editRef)
    })
    .filter((declaration): declaration is SemanticTokenInspectorDeclaration => Boolean(declaration))
  if (declarations.length === 0) return null

  return {
    selector: options.selector,
    origin: options.origin,
    inline: options.inline,
    specificity: options.specificity,
    sourceOrder: options.sourceOrder,
    layerOrder: options.layerOrder,
    layered: options.layered,
    unsupportedScope: options.unsupportedScope,
    sourceURL,
    line: ruleLine,
    column: style?.range?.startColumn === undefined ? undefined : style.range.startColumn + 1,
    pseudoType: options.pseudoType,
    ruleRef,
    declarations,
  }
}

function collectLayerOrders(payload: unknown) {
  const orders = new Map<string, number>()
  let fallbackOrder = 0

  function visit(value: unknown) {
    if (!value || typeof value !== "object") return
    const record = value as Record<string, unknown>
    if (typeof record.name === "string" && record.name) {
      const order = typeof record.order === "number" ? record.order : fallbackOrder
      orders.set(record.name, order)
      fallbackOrder += 1
    }
    if (Array.isArray(record.subLayers)) {
      record.subLayers.forEach(visit)
    }
  }

  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null
  visit(record?.rootLayer)
  return orders
}

function normalizeMatchedRule(
  match: ProtocolRuleMatch,
  index: number,
  session: InspectorSession,
  layerOrders: ReadonlyMap<string, number>,
  pseudoType?: string,
) {
  const rule = match.rule
  if (!rule?.style || !ruleConditionsAreActive(rule)) return null
  const selectors = rule.selectorList?.selectors ?? []
  const matchingSelectors = match.matchingSelectors ?? []
  const matchedSelectorTexts = matchingSelectors
    .map((selectorIndex) => selectors[selectorIndex]?.text)
    .filter((text): text is string => Boolean(text))
  const selector = matchedSelectorTexts.join(", ") || rule.selectorList?.text || "<matched rule>"
  const styleSheetOrder = rule.styleSheetId
    ? session.stylesheetHeaders.get(rule.styleSheetId)?.order ?? 0
    : 0
  const line = rule.style.range?.startLine ?? 0
  const column = rule.style.range?.startColumn ?? 0
  const layerName = rule.layers?.at(-1)?.text
  return normalizeStyleRule(rule.style, {
    selector,
    origin: rule.origin ?? "regular",
    specificity: maximumSpecificity(selectors, matchingSelectors),
    sourceOrder: styleSheetOrder * 1_000_000_000 + line * 1_000_000 + column * 1_000 + index,
    stylesheetHeaders: session.stylesheetHeaders,
    styleSheetId: rule.styleSheetId,
    layerOrder: layerName ? layerOrders.get(layerName) : undefined,
    layered: Boolean(layerName),
    unsupportedScope: Boolean(rule.scopes?.length),
    pseudoType,
    session,
  })
}

function normalizeRuleMatches(
  matches: readonly ProtocolRuleMatch[] | undefined,
  session: InspectorSession,
  layerOrders: ReadonlyMap<string, number>,
  pseudoType?: string,
) {
  return (matches ?? [])
    .map((match, index) => normalizeMatchedRule(match, index, session, layerOrders, pseudoType))
    .filter((rule): rule is SemanticTokenInspectorStyleRule => Boolean(rule))
}

function normalizeDirectRules(
  payload: ProtocolMatchedStyles,
  session: InspectorSession,
  layerOrders: ReadonlyMap<string, number>,
  pseudoType?: string,
) {
  const rules = normalizeRuleMatches(payload.matchedCSSRules, session, layerOrders, pseudoType)
  const attributes = normalizeStyleRule(payload.attributesStyle, {
    selector: "<presentation attributes>",
    origin: "regular",
    sourceOrder: Number.MAX_SAFE_INTEGER - 2,
    stylesheetHeaders: session.stylesheetHeaders,
    pseudoType,
    session,
  })
  const inline = normalizeStyleRule(payload.inlineStyle, {
    selector: "<element style>",
    origin: "regular",
    inline: true,
    specificity: [0, 0, 0],
    sourceOrder: Number.MAX_SAFE_INTEGER - 1,
    stylesheetHeaders: session.stylesheetHeaders,
    pseudoType,
    session,
  })
  if (attributes) rules.push(attributes)
  if (inline) rules.push(inline)
  return rules
}

function normalizeInheritedRules(
  payload: ProtocolMatchedStyles,
  session: InspectorSession,
  layerOrders: ReadonlyMap<string, number>,
) {
  return (payload.inherited ?? []).map((entry, inheritedIndex) => {
    const rules = normalizeRuleMatches(entry.matchedCSSRules, session, layerOrders)
    const inline = normalizeStyleRule(entry.inlineStyle, {
      selector: `<ancestor ${inheritedIndex + 1} style>`,
      origin: "regular",
      inline: true,
      specificity: [0, 0, 0],
      sourceOrder: Number.MAX_SAFE_INTEGER - inheritedIndex,
      stylesheetHeaders: session.stylesheetHeaders,
      session,
    })
    if (inline) rules.push(inline)
    return rules
  })
}

function normalizeComputedStyle(payload: unknown) {
  const record: Record<string, string> = {}
  const computedStyle = payload && typeof payload === "object"
    ? (payload as { computedStyle?: Array<{ name?: string; value?: string }> }).computedStyle
    : undefined
  for (const property of computedStyle ?? []) {
    if (!property.name || typeof property.value !== "string") continue
    record[property.name] = property.value
  }
  return record
}

function hasDynamicColorStyle(computedStyle: Readonly<Record<string, string>>) {
  const animationName = computedStyle["animation-name"]?.trim().toLowerCase()
  if (animationName && animationName !== "none") return true
  const durations = computedStyle["transition-duration"]?.split(",").map((value) => value.trim()) ?? []
  return durations.some((duration) => duration !== "0s" && duration !== "0ms")
}

async function resolveFrontendNodeID(contents: WebContents, pointResult: Record<string, unknown>) {
  if (typeof pointResult.nodeId === "number") return pointResult.nodeId
  if (typeof pointResult.backendNodeId !== "number") return null
  const pushed = await contents.debugger.sendCommand("DOM.pushNodesByBackendIdsToFrontend", {
    backendNodeIds: [pointResult.backendNodeId],
  }) as { nodeIds?: number[] }
  return pushed.nodeIds?.[0] ?? null
}

async function resolveSelectedNode(
  contents: WebContents,
  initialNodeID: number,
  ancestorDepth: number,
) {
  let nodeID = initialNodeID
  let description = await contents.debugger.sendCommand("DOM.describeNode", {
    nodeId: nodeID,
    depth: 0,
    pierce: true,
  }) as { node?: ProtocolNode }
  let node = description.node

  if (node?.nodeType === 3 && node.parentId) {
    nodeID = node.parentId
    description = await contents.debugger.sendCommand("DOM.describeNode", {
      nodeId: nodeID,
      depth: 0,
      pierce: true,
    }) as { node?: ProtocolNode }
    node = description.node
  }

  for (let depth = 0; depth < ancestorDepth; depth += 1) {
    if (!node?.parentId) break
    nodeID = node.parentId
    description = await contents.debugger.sendCommand("DOM.describeNode", {
      nodeId: nodeID,
      depth: 0,
      pierce: true,
    }) as { node?: ProtocolNode }
    node = description.node
  }

  return node ? { nodeID, node } : null
}

export class SemanticTokenInspectorSessionManager {
  private readonly sessions = new Map<number, InspectorSession>()
  private readonly authoringService: SemanticTokenAuthoringService
  private readonly options: SemanticTokenInspectorSessionManagerOptions

  constructor(
    private readonly emitEvent: InspectorEventEmitter,
    options: SemanticTokenInspectorSessionManagerOptions = {},
  ) {
    this.options = options
    this.authoringService = new SemanticTokenAuthoringService({
      packageRoot: options.packageRoot,
      rendererSourceRoot: options.rendererSourceRoot,
      packaged: options.packaged ?? false,
    })
  }

  private activeResult(session: InspectorSession): SemanticTokenInspectorStartResult {
    if (!this.authoringService.available) {
      const packaged = Boolean(this.options.packaged)
      return {
        status: "active",
        authoring: {
          status: "read-only",
          reason: packaged ? "packaged" : "source-root-unavailable",
          message: packaged
            ? "打包版本只提供只读 Semantic Token Inspector。"
            : "无法定位本地 renderer 源码；样式编辑和写回不可用。",
        },
      }
    }
    const sourceThemes = this.authoringService.getSourceThemes()
    return {
      status: "active",
      authoring: {
        status: "available",
        sessionID: session.authoringSessionID,
        defaultSourceThemeID: sourceThemes.some((theme) => theme.id === "built-in:classic")
          ? "built-in:classic"
          : sourceThemes[0]?.id ?? "built-in:classic",
        sourceThemes,
      },
    }
  }

  async start(contents: WebContents): Promise<SemanticTokenInspectorStartResult> {
    if (contents.isDestroyed()) {
      return {
        status: "blocked",
        reason: "attach-failed",
        message: "The renderer window is no longer available.",
      }
    }
    const existingSession = this.sessions.get(contents.id)
    if (existingSession) return this.activeResult(existingSession)
    if (contents.isDevToolsOpened()) {
      return {
        status: "blocked",
        reason: "devtools-open",
        message: "Close DevTools before enabling Semantic Token Inspector.",
      }
    }
    if (contents.debugger.isAttached()) {
      return {
        status: "blocked",
        reason: "debugger-in-use",
        message: "This window is already attached to another debugger.",
      }
    }

    const session = this.createSession(contents)
    try {
      contents.debugger.attach(PROTOCOL_VERSION)
      this.sessions.set(contents.id, session)
      this.addSessionListeners(session)
      await contents.debugger.sendCommand("DOM.enable")
      await contents.debugger.sendCommand("CSS.enable")
      await contents.debugger.sendCommand("DOM.getDocument", { depth: 0, pierce: true })
      return this.activeResult(session)
    } catch (error) {
      this.cleanupSession(session, true)
      return {
        status: "blocked",
        reason: isProtocolUnsupportedError(error) ? "protocol-unsupported" : "attach-failed",
        message: isProtocolUnsupportedError(error)
          ? "This Electron build does not expose the required CSS inspection protocol."
          : `Unable to start Semantic Token Inspector: ${getErrorMessage(error)}`,
      }
    }
  }

  async inspect(
    contents: WebContents,
    input: SemanticTokenInspectorInspectInput,
  ): Promise<SemanticTokenInspectorInspectResult> {
    if (!validateInspectInput(input)) {
      return {
        status: "unavailable",
        requestID: Number.isInteger(input.requestID) ? input.requestID : 0,
        reason: "protocol-error",
        message: "Invalid Semantic Token Inspector coordinates or request metadata.",
      }
    }

    const session = this.sessions.get(contents.id)
    if (!session || session.contents !== contents || !contents.debugger.isAttached()) {
      return {
        status: "unavailable",
        requestID: input.requestID,
        reason: "inactive",
        message: "Semantic Token Inspector is not active for this window.",
      }
    }

    await waitForStyleSheetOwnerSources(session)

    try {
      const pointResult = await contents.debugger.sendCommand("DOM.getNodeForLocation", {
        x: Math.round(input.x),
        y: Math.round(input.y),
        includeUserAgentShadowDOM: false,
        ignorePointerEventsNone: false,
      }) as Record<string, unknown>
      const initialNodeID = await resolveFrontendNodeID(contents, pointResult)
      if (!initialNodeID) {
        return {
          status: "unavailable",
          requestID: input.requestID,
          reason: "target-not-found",
          message: "No inspectable DOM node was found at this point.",
        }
      }

      const selected = await resolveSelectedNode(contents, initialNodeID, input.ancestorDepth)
      if (!selected) {
        return {
          status: "unavailable",
          requestID: input.requestID,
          reason: "target-not-found",
          message: "The inspected DOM node no longer exists.",
        }
      }

      const layerPayload = await contents.debugger
        .sendCommand("CSS.getLayersForNode", { nodeId: selected.nodeID })
        .catch(() => null)
      const layerOrders = collectLayerOrders(layerPayload)
      const [matchedPayload, computedPayload, boxPayload] = await Promise.all([
        contents.debugger.sendCommand("CSS.getMatchedStylesForNode", { nodeId: selected.nodeID }),
        contents.debugger.sendCommand("CSS.getComputedStyleForNode", { nodeId: selected.nodeID }),
        contents.debugger.sendCommand("DOM.getBoxModel", { nodeId: selected.nodeID }).catch(() => null),
      ])
      const matched = matchedPayload as ProtocolMatchedStyles
      const computedStyle = normalizeComputedStyle(computedPayload)
      const borderQuad = boxPayload && typeof boxPayload === "object"
        ? (boxPayload as { model?: { border?: number[] } }).model?.border
        : undefined
      const target = targetFromNode(selected.node, borderQuad)
      const warnings: string[] = []
      const dynamic = hasDynamicColorStyle(computedStyle)
      if (dynamic) {
        warnings.push("The element has an active transition or animation; computed values may change between samples.")
      }
      if (target.assetKind && target.assetKind !== "image") {
        warnings.push(`Only the ${target.assetKind} host element can be inspected; its internally rendered content is out of scope.`)
      }

      const inspection = analyzeSemanticTokenStyles({
        target,
        computedStyle,
        directRules: normalizeDirectRules(matched, session, layerOrders, selected.node.pseudoType),
        inheritedRules: normalizeInheritedRules(matched, session, layerOrders),
        resolvedColorMode: input.resolvedColorMode,
        dynamic,
        warnings,
      })
      return {
        status: "ok",
        requestID: input.requestID,
        inspection,
      }
    } catch (error) {
      if (!contents.debugger.isAttached()) {
        this.handleUnexpectedDetach(session, "protocol-error", "The Chromium debugger disconnected during inspection.")
      }
      return {
        status: "unavailable",
        requestID: input.requestID,
        reason: isTargetNotFoundError(error) ? "target-not-found" : "protocol-error",
        message: isTargetNotFoundError(error)
          ? "The inspected DOM node no longer exists."
          : `Semantic token inspection failed: ${getErrorMessage(error)}`,
      }
    }
  }

  async prepareAuthoringCommit(
    contents: WebContents,
    input: PrepareSemanticTokenAuthoringCommitInput,
  ): Promise<PrepareSemanticTokenAuthoringCommitResult> {
    const session = this.sessions.get(contents.id)
    if (
      !session ||
      session.contents !== contents ||
      input.sessionID !== session.authoringSessionID
    ) {
      return { status: "unavailable", message: "Inspector authoring session 不存在或已经失效。" }
    }
    return this.authoringService.prepare(
      session.authoringSessionID,
      input.draft,
      session.authoringReferences,
    )
  }

  async commitAuthoringCommit(
    contents: WebContents,
    input: CommitSemanticTokenAuthoringCommitInput,
  ): Promise<CommitSemanticTokenAuthoringCommitResult> {
    const session = this.sessions.get(contents.id)
    if (!session || session.contents !== contents) {
      return { status: "unavailable", message: "Inspector authoring session 不存在或已经失效。" }
    }
    return this.authoringService.commit(session.authoringSessionID, input.transactionID)
  }

  discardAuthoringCommit(
    contents: WebContents,
    input: DiscardSemanticTokenAuthoringCommitInput,
  ): DiscardSemanticTokenAuthoringCommitResult {
    const session = this.sessions.get(contents.id)
    if (!session || session.contents !== contents) return { status: "unavailable" }
    return this.authoringService.discard(session.authoringSessionID, input.transactionID)
  }

  stop(contents: WebContents): SemanticTokenInspectorStopResult {
    const session = this.sessions.get(contents.id)
    if (session && session.contents === contents) {
      this.cleanupSession(session, true)
    }
    return { status: "inactive" }
  }

  private createSession(contents: WebContents): InspectorSession {
    const session = {
      contents,
      authoringSessionID: randomUUID(),
      authoringReferences: new Map<string, SemanticTokenAuthoringOpaqueReference>(),
      authoringReferenceIDs: new Map<string, string>(),
      rendererSourceRoot: this.authoringService.rendererSourceRoot ?? undefined,
      stylesheetHeaders: new Map<string, InspectorStyleSheetHeader>(),
      localCssRuleIndex: undefined,
      nextStylesheetOrder: 0,
      stopping: false,
      onBeforeInputEvent: (...args: unknown[]) => {
        const input = args[1] as {
          alt?: boolean
          code?: string
          isAutoRepeat?: boolean
          key?: string
          type?: string
        } | undefined
        const isAltKey = input?.key?.toLowerCase() === "alt" ||
          input?.code === "AltLeft" ||
          input?.code === "AltRight"
        const isKeyDown = input?.type === "keyDown" || input?.type === "rawKeyDown"
        const altIsPressed = isAltKey ? isKeyDown : Boolean(input?.alt)
        contents.setIgnoreMenuShortcuts(altIsPressed)
        if (isAltKey && isKeyDown && !input?.isAutoRepeat) {
          this.emitEvent(contents, { type: "pin-current" })
        }
      },
      onDebuggerDetach: () => {
        this.handleUnexpectedDetach(
          session,
          contents.isDevToolsOpened() ? "devtools-opened" : "target-closed",
          contents.isDevToolsOpened()
            ? "Semantic Token Inspector stopped because DevTools was opened."
            : "Semantic Token Inspector detached from the renderer.",
        )
      },
      onDebuggerMessage: (...args: unknown[]) => {
        const method = args[1]
        const params = args[2]
        if (method === "DOM.documentUpdated") {
          session.stylesheetHeaders.clear()
          session.localCssRuleIndex = undefined
          session.nextStylesheetOrder = 0
          return
        }
        if (method === "CSS.styleSheetRemoved" && params && typeof params === "object") {
          const styleSheetId = (params as { styleSheetId?: string }).styleSheetId
          if (styleSheetId) session.stylesheetHeaders.delete(styleSheetId)
          session.localCssRuleIndex = undefined
          return
        }
        if (method !== "CSS.styleSheetAdded" || !params || typeof params !== "object") return
        const header = (params as { header?: ProtocolStyleSheetHeader }).header
        if (!header?.styleSheetId) return
        session.localCssRuleIndex = undefined
        if (!session.stylesheetHeaders.has(header.styleSheetId)) {
          const entry: InspectorStyleSheetHeader = {
            order: session.nextStylesheetOrder,
            sourceURL: header.sourceURL || undefined,
          }
          session.stylesheetHeaders.set(header.styleSheetId, entry)
          session.nextStylesheetOrder += 1
          if (!entry.sourceURL && header.ownerNode) {
            entry.sourceResolution = resolveStyleSheetOwnerSource(
              session,
              header.styleSheetId,
              header.ownerNode,
              entry,
            )
          }
        }
      },
      onDevToolsOpened: () => {
        this.handleUnexpectedDetach(
          session,
          "devtools-opened",
          "Semantic Token Inspector stopped because DevTools was opened.",
        )
      },
      onDestroyed: () => {
        this.cleanupSession(session, false)
      },
      onDidNavigate: () => {
        this.handleUnexpectedDetach(
          session,
          "navigation",
          "Semantic Token Inspector stopped because the renderer navigated.",
        )
      },
      onRenderProcessGone: () => {
        this.handleUnexpectedDetach(
          session,
          "target-closed",
          "Semantic Token Inspector stopped because the renderer process exited.",
        )
      },
    } satisfies InspectorSession
    return session
  }

  private addSessionListeners(session: InspectorSession) {
    const { contents } = session
    contents.on("before-input-event", session.onBeforeInputEvent)
    contents.debugger.on("detach", session.onDebuggerDetach)
    contents.debugger.on("message", session.onDebuggerMessage)
    contents.on("devtools-opened", session.onDevToolsOpened)
    contents.on("destroyed", session.onDestroyed)
    contents.on("did-navigate", session.onDidNavigate)
    contents.on("render-process-gone", session.onRenderProcessGone)
  }

  private removeSessionListeners(session: InspectorSession) {
    const { contents } = session
    contents.off("before-input-event", session.onBeforeInputEvent)
    contents.debugger.off("detach", session.onDebuggerDetach)
    contents.debugger.off("message", session.onDebuggerMessage)
    contents.off("devtools-opened", session.onDevToolsOpened)
    contents.off("destroyed", session.onDestroyed)
    contents.off("did-navigate", session.onDidNavigate)
    contents.off("render-process-gone", session.onRenderProcessGone)
  }

  private handleUnexpectedDetach(
    session: InspectorSession,
    reason: Extract<SemanticTokenInspectorEvent, { type: "detached" }>["reason"],
    message: string,
  ) {
    if (session.stopping || this.sessions.get(session.contents.id) !== session) return
    this.cleanupSession(session, true)
    if (!session.contents.isDestroyed()) {
      this.emitEvent(session.contents, { type: "detached", reason, message })
    }
  }

  private cleanupSession(session: InspectorSession, detach: boolean) {
    if (session.stopping) return
    session.stopping = true
    if (this.sessions.get(session.contents.id) === session) {
      this.sessions.delete(session.contents.id)
    }
    this.authoringService.discardSession(session.authoringSessionID)
    session.authoringReferences.clear()
    session.authoringReferenceIDs.clear()
    this.removeSessionListeners(session)
    if (!session.contents.isDestroyed()) {
      session.contents.setIgnoreMenuShortcuts(false)
    }
    if (detach && !session.contents.isDestroyed() && session.contents.debugger.isAttached()) {
      try {
        session.contents.debugger.detach()
      } catch {
        // The renderer may already have detached while DevTools was opening.
      }
    }
  }
}
