import { z } from "zod"

export const PLAYWRIGHT_LOCATOR_MAX_NODES = 64
export const PLAYWRIGHT_LOCATOR_MAX_FRAME_DEPTH = 16
export const PLAYWRIGHT_LOCATOR_MAX_SERIALIZED_BYTES = 32 * 1024
export const PLAYWRIGHT_LOCATOR_MAX_TEXT_CHARS = 2_000
export const PLAYWRIGHT_LOCATOR_MAX_TIMEOUT_MS = 60_000
export const PLAYWRIGHT_DOM_SNAPSHOT_MAX_NODES = 5_000
export const PLAYWRIGHT_DOM_SNAPSHOT_MAX_CHARS = 1_000_000

const RequiredTabID = z.number().int().positive()
const TimeoutMs = z.number().int().positive()
  .max(PLAYWRIGHT_LOCATOR_MAX_TIMEOUT_MS)
const BoundedText = z.string().max(PLAYWRIGHT_LOCATOR_MAX_TEXT_CHARS)
const NonBlankText = BoundedText.trim().min(1)

type RegexGroupSafety = {
  hasAlternation: boolean
  hasRepetition: boolean
  lastAtom?: {
    kind: "group" | "other"
    hasAlternation?: boolean
    hasRepetition?: boolean
  }
}

function hasUnsafeRegexStructure(source: string) {
  const groups: RegexGroupSafety[] = [{
    hasAlternation: false,
    hasRepetition: false,
  }]
  let inCharacterClass = false
  for (let index = 0; index < source.length; index += 1) {
    const token = source[index]!
    const current = groups.at(-1)!
    if (token === "\\") {
      const escaped = source[index + 1]
      if (
        escaped !== undefined
        && (
          /^[1-9]$/u.test(escaped)
          || (escaped === "k" && source[index + 2] === "<")
        )
      ) {
        return true
      }
      index += escaped === undefined ? 0 : 1
      current.lastAtom = { kind: "other" }
      continue
    }
    if (inCharacterClass) {
      if (token === "]") inCharacterClass = false
      continue
    }
    if (token === "[") {
      inCharacterClass = true
      current.lastAtom = { kind: "other" }
      continue
    }
    if (token === "(") {
      groups.push({
        hasAlternation: false,
        hasRepetition: false,
      })
      continue
    }
    if (token === ")" && groups.length > 1) {
      const nested = groups.pop()!
      const parent = groups.at(-1)!
      parent.hasAlternation ||= nested.hasAlternation
      parent.hasRepetition ||= nested.hasRepetition
      parent.lastAtom = {
        kind: "group",
        hasAlternation: nested.hasAlternation,
        hasRepetition: nested.hasRepetition,
      }
      continue
    }
    if (token === "|") {
      current.hasAlternation = true
      current.lastAtom = undefined
      continue
    }

    let repetition = token === "*" || token === "+" || (
      token === "?" && current.lastAtom !== undefined
    )
    if (token === "{") {
      const bounded = source.slice(index).match(
        /^\{(\d+)(?:,(\d*))?\}/u,
      )
      if (bounded) {
        repetition = true
        const lower = Number(bounded[1])
        const upperText = bounded[2]
        const upper = upperText === undefined
          ? lower
          : upperText === ""
            ? Number.POSITIVE_INFINITY
            : Number(upperText)
        if (upper > 1_000) {
          return true
        }
        index += bounded[0].length - 1
      }
    }
    if (repetition) {
      if (
        current.lastAtom?.kind === "group"
        && (
          current.lastAtom.hasAlternation
          || current.lastAtom.hasRepetition
        )
      ) {
        return true
      }
      current.hasRepetition = true
      continue
    }
    if (token !== "?" && token !== "^" && token !== "$") {
      current.lastAtom = { kind: "other" }
    }
  }
  return false
}

export const BrowserPlaywrightRegexMatcherV3 = z.object({
  type: z.literal("regex"),
  source: BoundedText,
  flags: z.string()
    .max(16)
    .regex(/^[dgimsuvy]*$/u)
    .refine(
      (flags) => new Set(flags).size === flags.length,
      "Regular-expression flags must be unique.",
    ),
}).strict().refine(({ source, flags }) => {
  try {
    new RegExp(source, flags)
    return true
  } catch {
    return false
  }
}, "The regular expression source or flags are invalid.").refine(
  ({ source }) => !hasUnsafeRegexStructure(source),
  "The regular expression contains unsafe nested, ambiguous, or unbounded repetition.",
)

export const BrowserPlaywrightStringMatcherV3 = z.object({
  type: z.literal("string"),
  value: BoundedText,
  exact: z.boolean().optional(),
}).strict()

export const BrowserPlaywrightTextMatcherV3 = z.discriminatedUnion("type", [
  BrowserPlaywrightStringMatcherV3,
  BrowserPlaywrightRegexMatcherV3,
])
export type BrowserPlaywrightTextMatcherV3 = z.infer<
  typeof BrowserPlaywrightTextMatcherV3
>

export type BrowserLocatorExpressionV3 =
  | {
      kind: "selector"
      value: string
    }
  | {
      kind: "role"
      role: string
      name?: BrowserPlaywrightTextMatcherV3
      includeHidden?: boolean
    }
  | {
      kind:
        | "text"
        | "label"
        | "placeholder"
        | "testId"
        | "accessibleName"
      matcher: BrowserPlaywrightTextMatcherV3
    }
  | {
      kind: "descendant" | "and" | "or"
      left: BrowserLocatorExpressionV3
      right: BrowserLocatorExpressionV3
    }
  | {
      kind: "filter"
      source: BrowserLocatorExpressionV3
      has?: BrowserLocatorExpressionV3
      hasNot?: BrowserLocatorExpressionV3
      hasText?: BrowserPlaywrightTextMatcherV3
      hasNotText?: BrowserPlaywrightTextMatcherV3
      visible?: boolean
    }
  | {
      kind: "nth"
      source: BrowserLocatorExpressionV3
      index: number
    }

const RawSelector = NonBlankText.refine(
  (value) => !value.toLowerCase().includes("internal:"),
  "Internal Playwright selector engines are not public Browser Contract input.",
).refine(
  (value) =>
    !value.includes(">>")
    && !/^\s*(?:(?:[a-z_][a-z0-9_-]*)=|\/\/|\.\.\/)/iu.test(value)
    && !/:(?:has-text|text(?:-is|-matches)?|nth-match|visible|light)\s*\(/iu
      .test(value)
    && !/:visible\b/iu.test(value),
  "Raw Locator selector nodes accept CSS only; selector-engine chains must use the structured AST.",
)

export const BrowserLocatorExpressionV3:
  z.ZodType<BrowserLocatorExpressionV3> = z.lazy(() => z.discriminatedUnion(
    "kind",
    [
      z.object({
        kind: z.literal("selector"),
        value: RawSelector,
      }).strict(),
      z.object({
        kind: z.literal("role"),
        role: z.string().trim().min(1).max(128),
        name: BrowserPlaywrightTextMatcherV3.optional(),
        includeHidden: z.boolean().optional(),
      }).strict(),
      z.object({
        kind: z.enum([
          "text",
          "label",
          "placeholder",
          "testId",
          "accessibleName",
        ]),
        matcher: BrowserPlaywrightTextMatcherV3,
      }).strict(),
      z.object({
        kind: z.enum(["descendant", "and", "or"]),
        left: BrowserLocatorExpressionV3,
        right: BrowserLocatorExpressionV3,
      }).strict(),
      z.object({
        kind: z.literal("filter"),
        source: BrowserLocatorExpressionV3,
        has: BrowserLocatorExpressionV3.optional(),
        hasNot: BrowserLocatorExpressionV3.optional(),
        hasText: BrowserPlaywrightTextMatcherV3.optional(),
        hasNotText: BrowserPlaywrightTextMatcherV3.optional(),
        visible: z.boolean().optional(),
      }).strict().refine(
        (value) =>
          value.has !== undefined
          || value.hasNot !== undefined
          || value.hasText !== undefined
          || value.hasNotText !== undefined
          || value.visible !== undefined,
        "A locator filter requires at least one constraint.",
      ),
      z.object({
        kind: z.literal("nth"),
        source: BrowserLocatorExpressionV3,
        index: z.number().int().min(-1_000_000).max(1_000_000),
      }).strict(),
    ],
  ))

function expressionMetrics(
  expression: BrowserLocatorExpressionV3,
  depth = 1,
): { nodes: number; depth: number } {
  if ("left" in expression) {
    const left = expressionMetrics(expression.left, depth + 1)
    const right = expressionMetrics(expression.right, depth + 1)
    return {
      nodes: left.nodes + right.nodes + 1,
      depth: Math.max(left.depth, right.depth),
    }
  }
  if ("source" in expression && expression.kind === "nth") {
    const nested = expressionMetrics(expression.source, depth + 1)
    return { nodes: nested.nodes + 1, depth: nested.depth }
  }
  if (!("source" in expression)) {
    return { nodes: 1, depth }
  }

  const source = expressionMetrics(expression.source, depth + 1)
  const has = expression.has
    ? expressionMetrics(expression.has, depth + 1)
    : { nodes: 0, depth }
  const hasNot = expression.hasNot
    ? expressionMetrics(expression.hasNot, depth + 1)
    : { nodes: 0, depth }
  return {
    nodes: source.nodes + has.nodes + hasNot.nodes + 1,
    depth: Math.max(source.depth, has.depth, hasNot.depth),
  }
}

const ParsedBrowserLocatorPlanV3 = z.object({
  framePath: z.array(RawSelector)
    .max(PLAYWRIGHT_LOCATOR_MAX_FRAME_DEPTH)
    .default([]),
  expression: BrowserLocatorExpressionV3,
}).strict().superRefine((value, context) => {
  const metrics = expressionMetrics(value.expression)
  if (metrics.nodes > PLAYWRIGHT_LOCATOR_MAX_NODES) {
    context.addIssue({
      code: "custom",
      path: ["expression"],
      message:
        `A locator plan may contain at most ${PLAYWRIGHT_LOCATOR_MAX_NODES} nodes.`,
    })
  }
  if (metrics.depth > PLAYWRIGHT_LOCATOR_MAX_NODES) {
    context.addIssue({
      code: "custom",
      path: ["expression"],
      message:
        `A locator expression may be at most ${PLAYWRIGHT_LOCATOR_MAX_NODES} levels deep.`,
    })
  }
  const serializedBytes = new TextEncoder().encode(JSON.stringify(value)).length
  if (serializedBytes > PLAYWRIGHT_LOCATOR_MAX_SERIALIZED_BYTES) {
    context.addIssue({
      code: "custom",
      message:
        `A locator plan may serialize to at most ${PLAYWRIGHT_LOCATOR_MAX_SERIALIZED_BYTES} bytes.`,
    })
  }
})
export const BrowserLocatorPlanV3 = z.unknown().superRefine(
  (value, context) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return
    const expression = (value as { expression?: unknown }).expression
    if (!expression || typeof expression !== "object") return
    const pending: Array<{ node: unknown; depth: number }> = [{
      node: expression,
      depth: 1,
    }]
    const seen = new Set<object>()
    let nodes = 0
    while (pending.length > 0) {
      const { node, depth } = pending.pop()!
      if (!node || typeof node !== "object" || Array.isArray(node)) continue
      if (seen.has(node)) {
        context.addIssue({
          code: "custom",
          path: ["expression"],
          message: "A locator expression must be acyclic.",
        })
        return
      }
      seen.add(node)
      nodes += 1
      if (
        nodes > PLAYWRIGHT_LOCATOR_MAX_NODES
        || depth > PLAYWRIGHT_LOCATOR_MAX_NODES
      ) {
        context.addIssue({
          code: "custom",
          path: ["expression"],
          message:
            `A locator plan may contain at most ${PLAYWRIGHT_LOCATOR_MAX_NODES} nodes and levels.`,
        })
        return
      }
      const record = node as Record<string, unknown>
      for (const key of ["left", "right", "source", "has", "hasNot"]) {
        if (record[key] !== undefined) {
          pending.push({ node: record[key], depth: depth + 1 })
        }
      }
    }
  },
).pipe(ParsedBrowserLocatorPlanV3)
export type BrowserLocatorPlanV3 = z.infer<typeof BrowserLocatorPlanV3>

const LocatorBaseParams = {
  tabId: RequiredTabID,
  plan: BrowserLocatorPlanV3,
  timeoutMs: TimeoutMs.optional(),
} as const

export const BrowserPlaywrightDomSnapshotParams = z.object({
  tabId: RequiredTabID,
  maxNodes: z.number().int().positive()
    .max(PLAYWRIGHT_DOM_SNAPSHOT_MAX_NODES)
    .optional(),
  maxChars: z.number().int().min(16)
    .max(PLAYWRIGHT_DOM_SNAPSHOT_MAX_CHARS)
    .optional(),
}).strict()

export const BrowserPlaywrightElementInfoParams = z.object({
  tabId: RequiredTabID,
  x: z.number().finite(),
  y: z.number().finite(),
  includeNonInteractable: z.boolean().optional(),
}).strict()

export const BrowserPlaywrightLocatorCountParams =
  z.object(LocatorBaseParams).strict()
export const BrowserPlaywrightLocatorReadParams =
  z.object(LocatorBaseParams).strict()
export const BrowserPlaywrightLocatorGetAttributeParams = z.object({
  ...LocatorBaseParams,
  name: z.string().trim().min(1).max(256),
}).strict()

export const BrowserPlaywrightMouseButton = z.enum([
  "left",
  "right",
  "middle",
])
export const BrowserPlaywrightKeyboardModifier = z.enum([
  "Alt",
  "Control",
  "ControlOrMeta",
  "Meta",
  "Shift",
])

export const BrowserPlaywrightLocatorClickParams = z.object({
  ...LocatorBaseParams,
  button: BrowserPlaywrightMouseButton.optional(),
  force: z.boolean().optional(),
  modifiers: z.array(BrowserPlaywrightKeyboardModifier)
    .max(5)
    .optional(),
}).strict()

export const BrowserPlaywrightLocatorFillParams = z.object({
  ...LocatorBaseParams,
  value: z.string(),
  sensitive: z.boolean().optional(),
}).strict()

export const BrowserPlaywrightLocatorTypeParams =
  BrowserPlaywrightLocatorFillParams

export const BrowserPlaywrightLocatorPressParams = z.object({
  ...LocatorBaseParams,
  value: z.string().trim().min(1).max(128).refine((value) => {
    const tokens = value.split("+")
    if (tokens.some((token) => token.length === 0)) return false
    return tokens.slice(0, -1).every((token) =>
      token === "Alt"
      || token === "Control"
      || token === "ControlOrMeta"
      || token === "Meta"
      || token === "Shift"
    )
  }, "A key chord may only use supported modifiers before its final key."),
}).strict()

export const BrowserPlaywrightSelectOptionDescriptor = z.object({
  index: z.number().int().nonnegative().optional(),
  label: z.string().max(2_000).optional(),
  value: z.string().max(2_000).optional(),
}).strict().refine(
  (value) =>
    value.index !== undefined
    || value.label !== undefined
    || value.value !== undefined,
  "A select option descriptor requires index, label, or value.",
)
export const BrowserPlaywrightSelectOptionInput = z.union([
  z.string().max(2_000),
  BrowserPlaywrightSelectOptionDescriptor,
])
export type BrowserPlaywrightSelectOptionInput = z.infer<
  typeof BrowserPlaywrightSelectOptionInput
>

export const BrowserPlaywrightLocatorSelectOptionParams = z.object({
  ...LocatorBaseParams,
  values: z.array(BrowserPlaywrightSelectOptionInput).min(1).max(100),
}).strict()

export const BrowserPlaywrightLocatorSetCheckedParams = z.object({
  ...LocatorBaseParams,
  checked: z.boolean(),
  force: z.boolean().optional(),
}).strict()

export const BrowserPlaywrightLocatorWaitForParams = z.object({
  ...LocatorBaseParams,
  state: z.enum(["attached", "detached", "visible", "hidden"]),
}).strict()

export const BrowserPlaywrightWaitForNavigationParams = z.object({
  tabId: RequiredTabID,
  mode: z.enum(["register", "wait", "cancel"]).optional(),
  waiterID: z.string().uuid().optional(),
  fromGeneration: z.number().int().nonnegative().optional(),
  url: NonBlankText.optional(),
  waitUntil: z.enum(["commit", "domcontentloaded", "load", "networkidle"])
    .optional(),
  timeoutMs: TimeoutMs.optional(),
}).strict().superRefine((value, context) => {
  if (
    (value.mode === "wait" || value.mode === "cancel")
    && !value.waiterID
  ) {
    context.addIssue({
      code: "custom",
      path: ["waiterID"],
      message: "Waiting on a registered navigation requires waiterID.",
    })
  }
})

export const BrowserPlaywrightWaitForLoadStateParams = z.object({
  tabId: RequiredTabID,
  state: z.enum(["domcontentloaded", "load", "networkidle"]).optional(),
  timeoutMs: TimeoutMs.optional(),
}).strict()

export const BrowserPlaywrightWaitForURLParams = z.object({
  tabId: RequiredTabID,
  url: NonBlankText,
  waitUntil: z.enum(["commit", "domcontentloaded", "load", "networkidle"])
    .optional(),
  timeoutMs: TimeoutMs.optional(),
}).strict()

export const BrowserPlaywrightWaitForEventParams = z.object({
  tabId: RequiredTabID,
  event: z.enum(["download", "filechooser"]),
  timeoutMs: TimeoutMs.optional(),
}).strict()

export const BrowserPlaywrightEventHandleParams = z.object({
  tabId: RequiredTabID,
  eventID: z.string().uuid(),
  timeoutMs: TimeoutMs.optional(),
}).strict()

export const BrowserPlaywrightFileChooserSetFilesParams = z.object({
  tabId: RequiredTabID,
  eventID: z.string().uuid(),
  files: z.array(z.string().trim().min(1).max(32_768)).min(1).max(100),
  timeoutMs: TimeoutMs.optional(),
}).strict()
