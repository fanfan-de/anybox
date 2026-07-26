import type { AppearanceTokenLayer } from "./appearance"

export const SEMANTIC_TOKEN_AUTHORING_DRAFT_VERSION = 1 as const

export type SemanticTokenColorChannelKind =
  | "background"
  | "foreground"
  | "border"
  | "border-top"
  | "border-right"
  | "border-bottom"
  | "border-left"
  | "outline"
  | "text-decoration"
  | "icon-fill"
  | "icon-stroke"
  | "shadow"
  | "text-shadow"
  | "caret"
  | "accent"
  | "background-image"
  | "image-source"

export type SemanticTokenColorChannelVisibility = "visible" | "inactive" | "unknown"

export type SemanticTokenInspectorInteractionState =
  | "default"
  | "hover"
  | "focus"
  | "active"
  | "expanded"
  | "selected"
  | "disabled"

export interface SemanticTokenAuthoringRuleCandidate {
  ruleRef: string
  selector: string
  sourceLabel: string
  recommended: boolean
}

export interface SemanticTokenColorChannelResult {
  id: string
  kind: SemanticTokenColorChannelKind
  label: string
  cssProperty: string
  authoredProperty?: string
  authoredValue?: string
  computedColor: string
  visibility: SemanticTokenColorChannelVisibility
  visibilityReason?: string
  currentRuntimeToken?: string
  followsChannelID?: string
  state: SemanticTokenInspectorInteractionState
  stateLabel: string
  scopeDescription: string
  previewable: boolean
  writable: boolean
  readOnlyReason?: string
  editRef?: string
  insertionRules: SemanticTokenAuthoringRuleCandidate[]
}

export interface SemanticTokenBindingEdit {
  kind: "binding-edit"
  channelID: string
  cssProperty: string
  runtimeToken: string
  editRef?: string
  ruleRef?: string
  selector: string
  sourceLabel: string
}

export interface SemanticTokenThemeValueEdit {
  kind: "theme-token-value-edit"
  runtimeToken: string
  mode: "light" | "dark"
  action: "set" | "reset"
  value?: string
}

export interface SemanticTokenCreationValue {
  value: string
  baseAlias?: string
}

export interface SemanticTokenCreation {
  kind: "token-creation"
  runtimeToken: string
  groupID: string
  createGroup: boolean
  groupLabel?: string
  groupDescription?: string
  layer: Exclude<AppearanceTokenLayer, "foundation">
  label: string
  description: string
  light: SemanticTokenCreationValue
  dark: SemanticTokenCreationValue
}

export type SemanticTokenAuthoringOperation =
  | SemanticTokenBindingEdit
  | SemanticTokenThemeValueEdit
  | SemanticTokenCreation

export interface SemanticTokenAuthoringDraft {
  version: typeof SEMANTIC_TOKEN_AUTHORING_DRAFT_VERSION
  sourceThemeID: string
  operations: SemanticTokenAuthoringOperation[]
}

export type SemanticTokenAuthoringReadOnlyReason =
  | "packaged"
  | "source-root-unavailable"
  | "external-source"

export type SemanticTokenAuthoringCapability =
  | {
      status: "available"
      sessionID: string
      defaultSourceThemeID: string
      sourceThemes: readonly {
        id: string
        name: string
      }[]
    }
  | {
      status: "read-only"
      reason: SemanticTokenAuthoringReadOnlyReason
      message: string
    }

export interface SemanticTokenAuthoringValidationIssue {
  code:
    | "invalid-draft"
    | "invalid-reference"
    | "invalid-token"
    | "invalid-theme"
    | "conflict"
    | "source-unavailable"
    | "source-ambiguous"
    | "unsafe-css"
    | "manifest-invalid"
  message: string
  operationIndex?: number
}

export interface SemanticTokenAuthoringReviewFile {
  path: string
  kind: "css" | "manifest" | "generated"
  diff: string
  additions: number
  deletions: number
}

export interface SemanticTokenAuthoringReviewSummary {
  bindingEdits: number
  tokenValueEdits: number
  tokenCreations: number
  generatedFiles: readonly string[]
}

export interface PrepareSemanticTokenAuthoringCommitInput {
  sessionID: string
  draft: SemanticTokenAuthoringDraft
}

export type PrepareSemanticTokenAuthoringCommitResult =
  | {
      status: "prepared"
      transactionID: string
      files: SemanticTokenAuthoringReviewFile[]
      summary: SemanticTokenAuthoringReviewSummary
    }
  | {
      status: "invalid"
      issues: SemanticTokenAuthoringValidationIssue[]
    }
  | {
      status: "unavailable"
      message: string
    }

export interface CommitSemanticTokenAuthoringCommitInput {
  transactionID: string
}

export type CommitSemanticTokenAuthoringCommitResult =
  | {
      status: "committed"
      files: readonly string[]
      generatedFiles: readonly string[]
      verification: "pending-hmr"
    }
  | {
      status: "stale"
      files: readonly string[]
      message: string
    }
  | {
      status: "failed"
      message: string
      rolledBack: boolean
    }
  | {
      status: "unavailable"
      message: string
    }

export interface DiscardSemanticTokenAuthoringCommitInput {
  transactionID: string
}

export interface DiscardSemanticTokenAuthoringCommitResult {
  status: "discarded" | "unavailable"
}

const RUNTIME_TOKEN_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const GROUP_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const SEMANTIC_EDITABLE_LAYERS = new Set<AppearanceTokenLayer>([
  "component",
  "product",
  "status",
  "global",
])

export function normalizeSemanticRuntimeTokenName(value: string) {
  return value
    .trim()
    .replace(/^--/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
}

export function isValidSemanticRuntimeTokenName(value: string) {
  const normalized = normalizeSemanticRuntimeTokenName(value)
  return (
    normalized === value &&
    RUNTIME_TOKEN_PATTERN.test(value) &&
    value.startsWith("semantic-") &&
    !value.endsWith("-light") &&
    !value.endsWith("-dark") &&
    !value.startsWith("semantic-mix-")
  )
}

export function isValidSemanticTokenGroupID(value: string) {
  return GROUP_ID_PATTERN.test(value)
}

export function isSemanticTokenAuthoringLayer(
  value: AppearanceTokenLayer,
): value is Exclude<AppearanceTokenLayer, "foundation"> {
  return SEMANTIC_EDITABLE_LAYERS.has(value)
}

export function isBindableSemanticRuntimeToken(
  value: string,
  layer: AppearanceTokenLayer,
) {
  const normalized = normalizeSemanticRuntimeTokenName(value)
  return (
    normalized === value &&
    RUNTIME_TOKEN_PATTERN.test(value) &&
    value.startsWith("semantic-") &&
    !value.startsWith("semantic-mix-") &&
    !value.endsWith("-light") &&
    !value.endsWith("-dark") &&
    layer !== "foundation"
  )
}

function selectorNameParts(selector: string) {
  return selector
    .replace(/^\s*[a-z][a-z0-9-]*(?=[.#:\[\s>+~]|$)/i, " ")
    .replace(/::?[a-z-]+(?:\([^)]*\))?/gi, " ")
    .replace(/\[[^\]]+]/g, " ")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part && !["is", "has", "where", "not", "root"].includes(part))
    .slice(-5)
}

const CHANNEL_NAME_PARTS: Record<SemanticTokenColorChannelKind, string> = {
  background: "surface",
  foreground: "text",
  border: "border",
  "border-top": "border-top",
  "border-right": "border-right",
  "border-bottom": "border-bottom",
  "border-left": "border-left",
  outline: "outline",
  "text-decoration": "text-decoration",
  "icon-fill": "icon-fill",
  "icon-stroke": "icon-stroke",
  shadow: "shadow",
  "text-shadow": "text-shadow",
  caret: "caret",
  accent: "accent",
  "background-image": "background-image",
  "image-source": "image",
}

export function recommendSemanticRuntimeTokenName(input: {
  selector: string
  channel: SemanticTokenColorChannelKind
  state: SemanticTokenInspectorInteractionState
}) {
  const selectorParts = selectorNameParts(input.selector)
    .filter((part) => part !== input.state)
  const statePart = input.state === "default" ? [] : [input.state]
  return normalizeSemanticRuntimeTokenName([
    "semantic",
    ...(selectorParts.length > 0 ? selectorParts : ["component"]),
    CHANNEL_NAME_PARTS[input.channel],
    ...statePart,
  ].join("-"))
}

export function semanticTokenAuthoringOperationKey(operation: SemanticTokenAuthoringOperation) {
  if (operation.kind === "binding-edit") {
    return `binding:${operation.editRef ?? operation.ruleRef ?? operation.selector}:${operation.cssProperty}`
  }
  if (operation.kind === "theme-token-value-edit") {
    return `theme:${operation.runtimeToken}:${operation.mode}`
  }
  return `creation:${operation.runtimeToken}`
}
