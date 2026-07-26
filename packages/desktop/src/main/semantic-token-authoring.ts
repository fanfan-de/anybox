import { createHash, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import {
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"
import { createTwoFilesPatch } from "diff"
import { applyEdits, modify, parse, type FormattingOptions, type ParseError } from "jsonc-parser"
import postcss, { type Declaration, type Root, type Rule } from "postcss"
import {
  APPEARANCE_TOKEN_DERIVATIONS,
  type AppearanceTokenLayer,
  type AppearanceTokenValue,
} from "../shared/appearance"
import { parseAppearanceColorLiteral } from "../shared/appearance-color"
import {
  isSemanticTokenAuthoringLayer,
  isValidSemanticRuntimeTokenName,
  isValidSemanticTokenGroupID,
  semanticTokenAuthoringOperationKey,
  type CommitSemanticTokenAuthoringCommitResult,
  type DiscardSemanticTokenAuthoringCommitResult,
  type PrepareSemanticTokenAuthoringCommitResult,
  type SemanticTokenAuthoringDraft,
  type SemanticTokenAuthoringOperation,
  type SemanticTokenAuthoringReviewFile,
  type SemanticTokenAuthoringValidationIssue,
  type SemanticTokenBindingEdit,
  type SemanticTokenCreation,
  type SemanticTokenThemeValueEdit,
} from "../shared/semantic-token-authoring"

const execFileAsync = promisify(execFile)
const MAX_AUTHORING_OPERATIONS = 200
const MAX_PREPARED_TRANSACTIONS = 12
const RUNTIME_TOKEN_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SAFE_CSS_PROPERTIES = new Set([
  "background-color",
  "color",
  "border-color",
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
])
const GENERATED_RELATIVE_PATHS = [
  "src/shared/appearance-tokens.generated.ts",
  "src/renderer/src/styles/appearance-tokens.generated.css",
] as const
const CATALOG_RELATIVE_PATH = "../../docs/desktop-semantic-token-catalog.md"
const JSON_FORMATTING: FormattingOptions = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n",
  keepLines: true,
}

export interface SemanticTokenAuthoringDeclarationReference {
  kind: "declaration"
  filePath: string
  selector: string
  ruleLine?: number
  declarationLine?: number
  authoredProperty: string
  originalValue: string
  important: boolean
}

export interface SemanticTokenAuthoringRuleReference {
  kind: "rule"
  filePath: string
  selector: string
  ruleLine?: number
}

export type SemanticTokenAuthoringOpaqueReference =
  | SemanticTokenAuthoringDeclarationReference
  | SemanticTokenAuthoringRuleReference

interface AuthoringServiceOptions {
  packageRoot?: string
  rendererSourceRoot?: string
  packaged: boolean
}

interface ManifestRow {
  id: string
  label: string
  description: string
  lightToken: string
  darkToken: string
  runtimeToken: string
}

interface ManifestGroup {
  id: string
  layer: AppearanceTokenLayer
  label: string
  description: string
  rows: ManifestRow[]
}

interface ManifestTheme {
  id: string
  name: string
  overrides: Record<string, AppearanceTokenValue>
}

interface AppearanceManifest {
  groups: ManifestGroup[]
  brands: {
    terra: {
      tokens: Record<string, AppearanceTokenValue>
    }
  }
  derivations?: Record<string, unknown>
  themes: ManifestTheme[]
}

interface FileMutation {
  filePath: string
  relativePath: string
  kind: "css" | "manifest"
  original: string
  next: string
  hash: string
}

interface PreparedTransaction {
  id: string
  sessionID: string
  mutations: FileMutation[]
  generatedFiles: string[]
  fingerprints: Map<string, string | null>
  createdAt: number
}

interface FileSnapshot {
  filePath: string
  existed: boolean
  content?: string
}

class AuthoringValidationError extends Error {
  constructor(readonly issue: SemanticTokenAuthoringValidationIssue) {
    super(issue.message)
  }
}

function validationError(
  code: SemanticTokenAuthoringValidationIssue["code"],
  message: string,
  operationIndex?: number,
): never {
  throw new AuthoringValidationError({ code, message, operationIndex })
}

function normalizePathForComparison(value: string) {
  const normalized = path.resolve(value)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function isPathInside(rootPath: string, candidatePath: string) {
  const root = normalizePathForComparison(rootPath)
  const candidate = normalizePathForComparison(candidatePath)
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function tryRealpath(value: string) {
  try {
    return realpathSync.native(value)
  } catch {
    return null
  }
}

function resolveSafeRendererCssFile(filePath: string, rendererSourceRoot: string) {
  const realFilePath = tryRealpath(filePath)
  if (
    !realFilePath ||
    path.extname(realFilePath).toLowerCase() !== ".css" ||
    !isPathInside(rendererSourceRoot, realFilePath) ||
    realFilePath.split(path.sep).some((part) => part.toLowerCase() === "node_modules") ||
    realFilePath.toLowerCase().includes(".generated.")
  ) {
    return null
  }
  return realFilePath
}

function decodeViteFsPath(pathname: string) {
  let decoded = decodeURIComponent(pathname.slice("/@fs/".length))
  if (/^\/[a-zA-Z]:\//.test(decoded)) decoded = decoded.slice(1)
  return decoded
}

export function resolveSemanticTokenSourcePath(
  sourceURL: string | undefined,
  rendererSourceRoot: string | undefined,
) {
  if (!sourceURL || !rendererSourceRoot) return null
  const realRoot = tryRealpath(rendererSourceRoot)
  if (!realRoot) return null

  let candidate: string | null = null
  const rawSource = sourceURL.trim()
  const sourceWithoutQuery = rawSource.replace(/[?#].*$/, "")
  if (sourceWithoutQuery.startsWith("/@fs/")) {
    candidate = decodeViteFsPath(sourceWithoutQuery)
  } else if (sourceWithoutQuery.startsWith("/src/")) {
    candidate = path.join(
      rendererSourceRoot,
      decodeURIComponent(sourceWithoutQuery.slice("/src/".length)),
    )
  } else if (/^\/?[a-zA-Z]:[\\/]/.test(sourceWithoutQuery)) {
    candidate = sourceWithoutQuery.replace(/^\/(?=[a-zA-Z]:[\\/])/, "")
  } else {
    try {
      const parsed = new URL(rawSource)
      if (parsed.protocol === "file:") {
        candidate = fileURLToPath(parsed)
      } else if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        if (parsed.pathname.startsWith("/@fs/")) {
          candidate = decodeViteFsPath(parsed.pathname)
        } else if (parsed.pathname.startsWith("/src/")) {
          candidate = path.join(rendererSourceRoot, decodeURIComponent(parsed.pathname.slice("/src/".length)))
        }
      }
    } catch {
      if (path.isAbsolute(sourceWithoutQuery)) candidate = sourceWithoutQuery
    }
  }

  if (!candidate || path.extname(candidate).toLowerCase() !== ".css") return null
  const normalizedCandidate = path.resolve(candidate)
  if (
    normalizedCandidate.split(path.sep).some((part) => part.toLowerCase() === "node_modules") ||
    normalizedCandidate.toLowerCase().includes(".generated.")
  ) {
    return null
  }
  const realCandidate = tryRealpath(normalizedCandidate)
  if (!realCandidate || !isPathInside(realRoot, realCandidate)) return null
  return realCandidate
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function toWorkspacePath(packageRoot: string, filePath: string) {
  return path.relative(packageRoot, filePath).replaceAll(path.sep, "/")
}

function normalizeSelector(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function ruleMatchesSelector(rule: Rule, selector: string) {
  const expected = normalizeSelector(selector)
  if (normalizeSelector(rule.selector) === expected) return true
  return rule.selectors.some((candidate) => normalizeSelector(candidate) === expected)
}

function nearestByLine<T extends { source?: { start?: { line?: number } } }>(
  values: T[],
  line: number | undefined,
) {
  if (values.length === 0) return null
  if (line === undefined) return values.length === 1 ? values[0] : null
  return [...values].sort((left, right) => {
    const leftLine = left.source?.start?.line ?? Number.MAX_SAFE_INTEGER
    const rightLine = right.source?.start?.line ?? Number.MAX_SAFE_INTEGER
    return Math.abs(leftLine - line) - Math.abs(rightLine - line)
  })[0]
}

function findReferencedRule(root: Root, reference: SemanticTokenAuthoringOpaqueReference) {
  const candidates: Rule[] = []
  root.walkRules((rule) => {
    if (ruleMatchesSelector(rule, reference.selector)) candidates.push(rule)
  })
  const rule = nearestByLine(candidates, reference.ruleLine)
  if (!rule) {
    validationError(
      "source-ambiguous",
      `无法在最新源码中唯一定位 selector “${reference.selector}”。`,
    )
  }
  return rule
}

function findReferencedDeclaration(
  rule: Rule,
  reference: SemanticTokenAuthoringDeclarationReference,
) {
  const candidates: Declaration[] = []
  rule.walkDecls(reference.authoredProperty, (declaration) => {
    if (
      declaration.value.trim() === reference.originalValue.trim() &&
      Boolean(declaration.important) === reference.important
    ) {
      candidates.push(declaration)
    }
  })
  const declaration = nearestByLine(candidates, reference.declarationLine)
  if (!declaration) {
    validationError(
      "source-ambiguous",
      `声明 ${reference.authoredProperty}: ${reference.originalValue} 已变化或无法唯一定位。`,
    )
  }
  return declaration
}

function findBalancedFunctionEnd(value: string, start: number) {
  let depth = 0
  let quote = ""
  for (let index = start; index < value.length; index += 1) {
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
    else if (character === ")") {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return -1
}

function shadowColorRanges(value: string) {
  const ranges: Array<{ start: number; end: number }> = []
  const functionPattern = /\b(?:var|rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = functionPattern.exec(value))) {
    const end = findBalancedFunctionEnd(value, match.index + match[0].length - 1)
    if (end < 0) break
    ranges.push({ start: match.index, end })
    functionPattern.lastIndex = end
  }
  const keywordPattern = /#[0-9a-f]{3,8}\b|\b(?:transparent|currentcolor)\b/gi
  while ((match = keywordPattern.exec(value))) {
    ranges.push({ start: match.index, end: match.index + match[0].length })
  }
  return ranges.sort((left, right) => left.start - right.start)
}

function replaceSimpleShadowColor(value: string, runtimeToken: string) {
  let depth = 0
  let quote = ""
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (character === "\\") index += 1
      else if (character === quote) quote = ""
      continue
    }
    if (character === "\"" || character === "'") quote = character
    else if (character === "(") depth += 1
    else if (character === ")") depth = Math.max(0, depth - 1)
    else if (character === "," && depth === 0) {
      validationError("unsafe-css", "多重阴影不能安全绑定到单一颜色 Token。")
    }
  }

  const ranges = shadowColorRanges(value)
  if (ranges.length !== 1) {
    validationError("unsafe-css", "无法在阴影声明中唯一定位可替换的颜色表达式。")
  }
  const [range] = ranges
  return `${value.slice(0, range.start)}var(--${runtimeToken})${value.slice(range.end)}`
}

function applyBindingEdit(
  root: Root,
  operation: SemanticTokenBindingEdit,
  reference: SemanticTokenAuthoringOpaqueReference,
) {
  if (!SAFE_CSS_PROPERTIES.has(operation.cssProperty)) {
    validationError("unsafe-css", `不支持写回 CSS 属性 “${operation.cssProperty}”。`)
  }
  const rule = findReferencedRule(root, reference)
  const tokenValue = `var(--${operation.runtimeToken})`

  if (reference.kind === "rule") {
    const existing = rule.nodes
      .filter((node): node is Declaration => node.type === "decl" && node.prop === operation.cssProperty)
      .at(-1)
    if (existing) {
      existing.value = tokenValue
    } else {
      rule.append({ prop: operation.cssProperty, value: tokenValue })
    }
    return
  }

  const declaration = findReferencedDeclaration(rule, reference)
  if (operation.cssProperty === "box-shadow" || operation.cssProperty === "text-shadow") {
    declaration.value = replaceSimpleShadowColor(declaration.value, operation.runtimeToken)
    return
  }
  if (reference.authoredProperty === operation.cssProperty) {
    declaration.value = tokenValue
    return
  }

  declaration.cloneAfter({
    prop: operation.cssProperty,
    value: tokenValue,
    important: declaration.important,
  })
}

function dedupeOperations(operations: readonly SemanticTokenAuthoringOperation[]) {
  const deduped = new Map<string, SemanticTokenAuthoringOperation>()
  for (const operation of operations) {
    const key = semanticTokenAuthoringOperationKey(operation)
    if (deduped.has(key)) deduped.delete(key)
    deduped.set(key, operation)
  }
  return [...deduped.values()]
}

function setJsoncValue(text: string, jsonPath: (string | number)[], value: unknown) {
  return applyEdits(text, modify(text, jsonPath, value, {
    formattingOptions: JSON_FORMATTING,
    isArrayInsertion: false,
  }))
}

function parseManifest(text: string) {
  const errors: ParseError[] = []
  const manifest = parse(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as AppearanceManifest | undefined
  if (!manifest || errors.length > 0) {
    validationError("manifest-invalid", "Appearance manifest 不是有效的 JSONC 文档。")
  }
  if (
    !Array.isArray(manifest.groups) ||
    !Array.isArray(manifest.themes) ||
    !manifest.brands?.terra?.tokens
  ) {
    validationError("manifest-invalid", "Appearance manifest 缺少 groups、themes 或 Terra tokens。")
  }
  return manifest
}

function allManifestRows(manifest: AppearanceManifest) {
  return manifest.groups.flatMap((group) =>
    group.rows.map((row) => ({ group, row })),
  )
}

function findRuntimeRow(manifest: AppearanceManifest, runtimeToken: string) {
  return allManifestRows(manifest).find(({ row }) => row.runtimeToken === runtimeToken)
}

function isEditableSemanticRow(group: ManifestGroup, row: ManifestRow) {
  return (
    group.layer !== "foundation" &&
    row.runtimeToken.startsWith("semantic-") &&
    !row.runtimeToken.startsWith("semantic-mix-") &&
    !row.runtimeToken.endsWith("-light") &&
    !row.runtimeToken.endsWith("-dark")
  )
}

function requireEditableRuntime(
  manifest: AppearanceManifest,
  runtimeToken: string,
  createdRuntimeTokens: ReadonlySet<string>,
  operationIndex: number,
) {
  if (createdRuntimeTokens.has(runtimeToken)) return
  const match = findRuntimeRow(manifest, runtimeToken)
  if (!match || !isEditableSemanticRow(match.group, match.row)) {
    validationError(
      "invalid-token",
      `“--${runtimeToken}” 不是可直接绑定的 Semantic runtime token。`,
      operationIndex,
    )
  }
}

function requireLiteral(value: string, label: string, operationIndex: number) {
  const literal = parseAppearanceColorLiteral(value)
  if (!literal) {
    validationError("invalid-token", `${label} “${value}” 不是有效颜色。`, operationIndex)
  }
  return literal
}

function sourceBaseValue(
  manifest: AppearanceManifest,
  value: { value: string; baseAlias?: string },
  label: string,
  operationIndex: number,
): AppearanceTokenValue {
  const alias = value.baseAlias?.replace(/^--/, "")
  if (alias) {
    const exists = Boolean(
      manifest.brands.terra.tokens[alias] ||
      manifest.derivations?.[alias] ||
      (APPEARANCE_TOKEN_DERIVATIONS as Readonly<Record<string, unknown>>)[alias],
    )
    if (!exists) {
      validationError("invalid-token", `${label} fallback alias “--${alias}” 不存在。`, operationIndex)
    }
    return { type: "alias", token: alias }
  }
  return requireLiteral(value.value, label, operationIndex)
}

function validateCreationText(value: string | undefined, label: string, operationIndex: number) {
  const normalized = value?.trim() ?? ""
  if (!normalized || normalized.length > 240) {
    validationError("invalid-token", `${label}不能为空且不能超过 240 个字符。`, operationIndex)
  }
  return normalized
}

function applyTokenCreation(
  manifest: AppearanceManifest,
  manifestText: string,
  creation: SemanticTokenCreation,
  sourceThemeIndex: number,
  operationIndex: number,
) {
  if (!isValidSemanticRuntimeTokenName(creation.runtimeToken)) {
    validationError(
      "invalid-token",
      `runtime 名称 “${creation.runtimeToken}” 必须是 semantic-*，且不能带 -light/-dark。`,
      operationIndex,
    )
  }
  if (!isValidSemanticTokenGroupID(creation.groupID)) {
    validationError("invalid-token", `分组 ID “${creation.groupID}” 无效。`, operationIndex)
  }
  if (!isSemanticTokenAuthoringLayer(creation.layer)) {
    validationError("invalid-token", "元素编辑器不能创建 foundation token。", operationIndex)
  }

  const lightToken = `${creation.runtimeToken}-light`
  const darkToken = `${creation.runtimeToken}-dark`
  const existingNames = new Set(allManifestRows(manifest).flatMap(({ row }) => [
    row.id,
    row.runtimeToken,
    row.lightToken,
    row.darkToken,
  ]))
  const conflictingNames = [creation.runtimeToken, lightToken, darkToken]
  const brandTokenMaps = Object.values(
    manifest.brands as Record<string, { tokens?: Record<string, AppearanceTokenValue> }>,
  )
  if (
    conflictingNames.some((name) => existingNames.has(name)) ||
    conflictingNames.some((name) =>
      brandTokenMaps.some((brand) => Boolean(brand.tokens?.[name])),
    ) ||
    conflictingNames.some((name) => Boolean(manifest.derivations?.[name]))
  ) {
    validationError(
      "conflict",
      `“${creation.runtimeToken}” 与现有 runtime、mode token、row 或 derivation 冲突。`,
      operationIndex,
    )
  }

  const label = validateCreationText(creation.label, "显示名称", operationIndex)
  const description = validateCreationText(creation.description, "用途说明", operationIndex)
  let groupIndex = manifest.groups.findIndex((group) => group.id === creation.groupID)
  if (creation.createGroup) {
    if (groupIndex >= 0) {
      validationError("conflict", `分组 “${creation.groupID}” 已存在。`, operationIndex)
    }
    const group: ManifestGroup = {
      id: creation.groupID,
      layer: creation.layer,
      label: validateCreationText(creation.groupLabel, "分组显示名称", operationIndex),
      description: validateCreationText(creation.groupDescription, "分组说明", operationIndex),
      rows: [],
    }
    groupIndex = manifest.groups.length
    manifestText = setJsoncValue(manifestText, ["groups", groupIndex], group)
    manifest.groups.push(group)
  } else {
    if (groupIndex < 0) {
      validationError("invalid-token", `分组 “${creation.groupID}” 不存在。`, operationIndex)
    }
    if (manifest.groups[groupIndex].layer !== creation.layer) {
      validationError(
        "conflict",
        `分组 “${creation.groupID}” 的 layer 是 ${manifest.groups[groupIndex].layer}，与草稿不一致。`,
        operationIndex,
      )
    }
  }

  const row: ManifestRow = {
    id: creation.runtimeToken,
    label,
    description,
    lightToken,
    darkToken,
    runtimeToken: creation.runtimeToken,
  }
  const group = manifest.groups[groupIndex]
  manifestText = setJsoncValue(manifestText, ["groups", groupIndex, "rows", group.rows.length], row)
  group.rows.push(row)

  const lightBaseValue = sourceBaseValue(manifest, creation.light, "Light 初始颜色", operationIndex)
  const darkBaseValue = sourceBaseValue(manifest, creation.dark, "Dark 初始颜色", operationIndex)
  manifestText = setJsoncValue(manifestText, ["brands", "terra", "tokens", lightToken], lightBaseValue)
  manifestText = setJsoncValue(manifestText, ["brands", "terra", "tokens", darkToken], darkBaseValue)
  manifest.brands.terra.tokens[lightToken] = lightBaseValue
  manifest.brands.terra.tokens[darkToken] = darkBaseValue

  const lightOverride = requireLiteral(creation.light.value, "Light 主题颜色", operationIndex)
  const darkOverride = requireLiteral(creation.dark.value, "Dark 主题颜色", operationIndex)
  manifestText = setJsoncValue(
    manifestText,
    ["themes", sourceThemeIndex, "overrides", lightToken],
    lightOverride,
  )
  manifestText = setJsoncValue(
    manifestText,
    ["themes", sourceThemeIndex, "overrides", darkToken],
    darkOverride,
  )
  manifest.themes[sourceThemeIndex].overrides[lightToken] = lightOverride
  manifest.themes[sourceThemeIndex].overrides[darkToken] = darkOverride

  return manifestText
}

function applyThemeValueEdit(
  manifest: AppearanceManifest,
  manifestText: string,
  edit: SemanticTokenThemeValueEdit,
  sourceThemeIndex: number,
  createdRuntimeTokens: ReadonlySet<string>,
  operationIndex: number,
) {
  requireEditableRuntime(manifest, edit.runtimeToken, createdRuntimeTokens, operationIndex)
  const match = findRuntimeRow(manifest, edit.runtimeToken)
  if (!match) {
    validationError("invalid-token", `找不到 “--${edit.runtimeToken}” 的 Light/Dark pairing。`, operationIndex)
  }
  const modeToken = edit.mode === "light" ? match.row.lightToken : match.row.darkToken
  const value = edit.action === "reset"
    ? undefined
    : requireLiteral(edit.value ?? "", `${edit.mode} 颜色`, operationIndex)
  manifestText = setJsoncValue(
    manifestText,
    ["themes", sourceThemeIndex, "overrides", modeToken],
    value,
  )
  if (value) manifest.themes[sourceThemeIndex].overrides[modeToken] = value
  else delete manifest.themes[sourceThemeIndex].overrides[modeToken]
  return manifestText
}

function countDiffLines(diff: string) {
  let additions = 0
  let deletions = 0
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1
  }
  return { additions, deletions }
}

function createReviewFile(mutation: FileMutation): SemanticTokenAuthoringReviewFile {
  const diff = createTwoFilesPatch(
    mutation.relativePath,
    mutation.relativePath,
    mutation.original,
    mutation.next,
    "source",
    "prepared",
    { context: 4 },
  )
  return {
    path: mutation.relativePath,
    kind: mutation.kind,
    diff,
    ...countDiffLines(diff),
  }
}

async function readMutation(packageRoot: string, filePath: string, kind: FileMutation["kind"]) {
  const original = await readFile(filePath, "utf8")
  return {
    filePath,
    relativePath: toWorkspacePath(packageRoot, filePath),
    kind,
    original,
    next: original,
    hash: sha256(original),
  } satisfies FileMutation
}

async function readFileFingerprint(filePath: string) {
  try {
    return sha256(await readFile(filePath, "utf8"))
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null
    }
    throw error
  }
}

async function atomicWriteFile(filePath: string, content: string) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.semantic-token.tmp`,
  )
  await writeFile(temporaryPath, content, "utf8")
  try {
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function snapshotFiles(filePaths: readonly string[]) {
  return Promise.all(filePaths.map(async (filePath): Promise<FileSnapshot> => {
    try {
      return {
        filePath,
        existed: true,
        content: await readFile(filePath, "utf8"),
      }
    } catch {
      return { filePath, existed: false }
    }
  }))
}

async function restoreSnapshots(snapshots: readonly FileSnapshot[]) {
  let restored = true
  for (const snapshot of snapshots) {
    try {
      if (snapshot.existed) {
        await atomicWriteFile(snapshot.filePath, snapshot.content ?? "")
      } else if (existsSync(snapshot.filePath)) {
        await rm(snapshot.filePath, { force: true })
      }
    } catch {
      restored = false
    }
  }
  return restored
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export class SemanticTokenAuthoringService {
  private readonly transactions = new Map<string, PreparedTransaction>()
  readonly packageRoot: string | null
  readonly rendererSourceRoot: string | null
  readonly manifestPath: string | null

  constructor(private readonly options: AuthoringServiceOptions) {
    this.packageRoot = options.packageRoot ? tryRealpath(options.packageRoot) : null
    const rendererRoot = options.rendererSourceRoot ??
      (this.packageRoot ? path.join(this.packageRoot, "src", "renderer", "src") : undefined)
    this.rendererSourceRoot = rendererRoot ? tryRealpath(rendererRoot) : null
    this.manifestPath = this.packageRoot
      ? path.join(this.packageRoot, "src", "shared", "appearance-token-manifest.json")
      : null
  }

  get available() {
    return Boolean(
      !this.options.packaged &&
      this.packageRoot &&
      this.rendererSourceRoot &&
      this.manifestPath &&
      existsSync(this.manifestPath),
    )
  }

  getSourceThemes() {
    if (!this.available || !this.manifestPath) return []
    try {
      const manifest = parseManifest(readFileSync(this.manifestPath, "utf8"))
      return manifest.themes.map((theme) => ({ id: theme.id, name: theme.name }))
    } catch {
      return []
    }
  }

  async prepare(
    sessionID: string,
    draft: SemanticTokenAuthoringDraft,
    references: ReadonlyMap<string, SemanticTokenAuthoringOpaqueReference>,
  ): Promise<PrepareSemanticTokenAuthoringCommitResult> {
    if (!this.available || !this.packageRoot || !this.manifestPath || !this.rendererSourceRoot) {
      return { status: "unavailable", message: "当前运行环境没有可写回的 renderer 源码。" }
    }
    if (
      !draft ||
      draft.version !== 1 ||
      !Array.isArray(draft.operations) ||
      draft.operations.length === 0 ||
      draft.operations.length > MAX_AUTHORING_OPERATIONS
    ) {
      return {
        status: "invalid",
        issues: [{
          code: "invalid-draft",
          message: `设计会话必须包含 1–${MAX_AUTHORING_OPERATIONS} 项修改。`,
        }],
      }
    }

    try {
      const operations = dedupeOperations(draft.operations)
      const indexedOperations = operations.map((operation) => ({
        operation,
        originalIndex: draft.operations.lastIndexOf(operation),
      }))
      const cssOperations = indexedOperations.filter(
        (entry): entry is typeof entry & { operation: SemanticTokenBindingEdit } =>
          entry.operation.kind === "binding-edit",
      )
      const creationOperations = indexedOperations.filter(
        (entry): entry is typeof entry & { operation: SemanticTokenCreation } =>
          entry.operation.kind === "token-creation",
      )
      const themeOperations = indexedOperations.filter(
        (entry): entry is typeof entry & { operation: SemanticTokenThemeValueEdit } =>
          entry.operation.kind === "theme-token-value-edit",
      )
      const createdRuntimeTokens = new Set(creationOperations.map(({ operation }) => operation.runtimeToken))
      if (createdRuntimeTokens.size !== creationOperations.length) {
        validationError("conflict", "设计会话包含重复的新 Token runtime 名称。")
      }

      const mutations = new Map<string, FileMutation>()
      let manifest: AppearanceManifest | null = null
      let manifestMutation: FileMutation | null = null
      if (creationOperations.length > 0 || themeOperations.length > 0) {
        manifestMutation = await readMutation(this.packageRoot, this.manifestPath, "manifest")
        manifest = parseManifest(manifestMutation.original)
        const sourceThemeIndex = manifest.themes.findIndex((theme) => theme.id === draft.sourceThemeID)
        if (sourceThemeIndex < 0 || !draft.sourceThemeID.startsWith("built-in:")) {
          validationError("invalid-theme", `源码目标主题 “${draft.sourceThemeID}” 不是内置主题。`)
        }

        for (const { operation, originalIndex } of creationOperations) {
          manifestMutation.next = applyTokenCreation(
            manifest,
            manifestMutation.next,
            operation,
            sourceThemeIndex,
            originalIndex,
          )
        }
        for (const { operation, originalIndex } of themeOperations) {
          manifestMutation.next = applyThemeValueEdit(
            manifest,
            manifestMutation.next,
            operation,
            sourceThemeIndex,
            createdRuntimeTokens,
            originalIndex,
          )
        }
        mutations.set(manifestMutation.filePath, manifestMutation)
      } else {
        const manifestText = await readFile(this.manifestPath, "utf8")
        manifest = parseManifest(manifestText)
      }

      for (const { operation, originalIndex } of cssOperations) {
        if (!RUNTIME_TOKEN_PATTERN.test(operation.runtimeToken)) {
          validationError("invalid-token", `Token “${operation.runtimeToken}” 名称无效。`, originalIndex)
        }
        requireEditableRuntime(manifest, operation.runtimeToken, createdRuntimeTokens, originalIndex)
        const referenceID = operation.editRef ?? operation.ruleRef
        const reference = referenceID ? references.get(referenceID) : undefined
        if (!reference) {
          validationError("invalid-reference", "颜色通道的 opaque 源码引用已失效。", originalIndex)
        }
        if (operation.editRef && reference.kind !== "declaration") {
          validationError("invalid-reference", "声明引用类型不匹配。", originalIndex)
        }
        if (operation.ruleRef && reference.kind !== "rule") {
          validationError("invalid-reference", "规则引用类型不匹配。", originalIndex)
        }
        const safeFilePath = resolveSafeRendererCssFile(
          reference.filePath,
          this.rendererSourceRoot,
        )
        if (!safeFilePath) {
          validationError("source-unavailable", "目标样式表不在允许的 renderer 源码根目录内。", originalIndex)
        }

        let mutation = mutations.get(safeFilePath)
        if (!mutation) {
          mutation = await readMutation(this.packageRoot, safeFilePath, "css")
          mutations.set(safeFilePath, mutation)
        }
        const root = postcss.parse(mutation.next, { from: safeFilePath })
        applyBindingEdit(root, operation, reference)
        mutation.next = root.toString()
      }

      const changedMutations = [...mutations.values()].filter(
        (mutation) => mutation.next !== mutation.original,
      )
      if (changedMutations.length === 0) {
        validationError("invalid-draft", "设计会话没有产生可写回的源码差异。")
      }

      while (this.transactions.size >= MAX_PREPARED_TRANSACTIONS) {
        const oldest = [...this.transactions.values()].sort((left, right) => left.createdAt - right.createdAt)[0]
        if (!oldest) break
        this.transactions.delete(oldest.id)
      }

      const generatedFiles = manifestMutation
        ? [...GENERATED_RELATIVE_PATHS, CATALOG_RELATIVE_PATH].map((relativePath) =>
            path.resolve(this.packageRoot!, relativePath),
          )
        : []
      const fingerprintPaths = [
        ...changedMutations.map((mutation) => mutation.filePath),
        ...generatedFiles,
      ]
      const fingerprints = new Map(await Promise.all(
        [...new Set(fingerprintPaths)].map(async (filePath) => [
          filePath,
          await readFileFingerprint(filePath),
        ] as const),
      ))
      const transactionID = randomUUID()
      this.transactions.set(transactionID, {
        id: transactionID,
        sessionID,
        mutations: changedMutations,
        generatedFiles,
        fingerprints,
        createdAt: Date.now(),
      })

      const reviewFiles = changedMutations.map(createReviewFile)
      reviewFiles.push(...generatedFiles.map((filePath): SemanticTokenAuthoringReviewFile => ({
        path: toWorkspacePath(this.packageRoot!, filePath),
        kind: "generated",
        diff: "提交后由 appearance token generator 重新生成。",
        additions: 0,
        deletions: 0,
      })))
      return {
        status: "prepared",
        transactionID,
        files: reviewFiles,
        summary: {
          bindingEdits: cssOperations.length,
          tokenValueEdits: themeOperations.length,
          tokenCreations: creationOperations.length,
          generatedFiles: generatedFiles.map((filePath) => toWorkspacePath(this.packageRoot!, filePath)),
        },
      }
    } catch (error) {
      if (error instanceof AuthoringValidationError) {
        return { status: "invalid", issues: [error.issue] }
      }
      return {
        status: "invalid",
        issues: [{
          code: "invalid-draft",
          message: `无法准备写回：${getErrorMessage(error)}`,
        }],
      }
    }
  }

  async commit(
    sessionID: string,
    transactionID: string,
  ): Promise<CommitSemanticTokenAuthoringCommitResult> {
    const transaction = this.transactions.get(transactionID)
    if (!transaction || transaction.sessionID !== sessionID || !this.packageRoot) {
      return { status: "unavailable", message: "准备事务不存在、已释放或不属于当前 Inspector 会话。" }
    }

    const staleFiles: string[] = []
    for (const [filePath, expectedFingerprint] of transaction.fingerprints) {
      try {
        const currentFingerprint = await readFileFingerprint(filePath)
        if (currentFingerprint !== expectedFingerprint) {
          staleFiles.push(toWorkspacePath(this.packageRoot, filePath))
        }
      } catch {
        staleFiles.push(toWorkspacePath(this.packageRoot, filePath))
      }
    }
    if (staleFiles.length > 0) {
      this.transactions.delete(transactionID)
      return {
        status: "stale",
        files: staleFiles,
        message: "审阅期间源码发生变化；请重新检查元素并再次准备提交。",
      }
    }

    const allTouchedFiles = [
      ...transaction.mutations.map((mutation) => mutation.filePath),
      ...transaction.generatedFiles,
    ]
    const snapshots = await snapshotFiles([...new Set(allTouchedFiles)])
    try {
      for (const mutation of transaction.mutations) {
        await atomicWriteFile(mutation.filePath, mutation.next)
      }
      if (transaction.generatedFiles.length > 0) {
        await execFileAsync(process.execPath, ["./scripts/generate-appearance-tokens.mjs"], {
          cwd: this.packageRoot,
          timeout: 60_000,
          windowsHide: true,
        })
        await execFileAsync(process.execPath, ["./scripts/generate-semantic-token-catalog.mjs"], {
          cwd: this.packageRoot,
          timeout: 60_000,
          windowsHide: true,
        })
      }
      this.transactions.delete(transactionID)
      return {
        status: "committed",
        files: transaction.mutations.map((mutation) => mutation.relativePath),
        generatedFiles: transaction.generatedFiles.map((filePath) =>
          toWorkspacePath(this.packageRoot!, filePath),
        ),
        verification: "pending-hmr",
      }
    } catch (error) {
      const rolledBack = await restoreSnapshots(snapshots)
      this.transactions.delete(transactionID)
      return {
        status: "failed",
        message: `写回或生成失败：${getErrorMessage(error)}`,
        rolledBack,
      }
    }
  }

  discard(
    sessionID: string,
    transactionID: string,
  ): DiscardSemanticTokenAuthoringCommitResult {
    const transaction = this.transactions.get(transactionID)
    if (!transaction || transaction.sessionID !== sessionID) return { status: "unavailable" }
    this.transactions.delete(transactionID)
    return { status: "discarded" }
  }

  discardSession(sessionID: string) {
    for (const [transactionID, transaction] of this.transactions) {
      if (transaction.sessionID === sessionID) this.transactions.delete(transactionID)
    }
  }
}
