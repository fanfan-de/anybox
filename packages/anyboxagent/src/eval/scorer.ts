import type { EvalAssertion, EvalCase } from "#eval/schema.ts"
import type {
  ToolCallOutcome,
  ToolCallPhase,
  ToolCallResultCompleteness,
  ToolCallResultPolarity,
  ToolCallTurnControlMode,
} from "@anybox/shared"

export type EvalExecutionStatus = "completed" | "blocked" | "failed" | "cancelled"

export type EvalToolCall = {
  name: string
  input?: unknown
  output?: unknown
  phase: ToolCallPhase
  outcome?: ToolCallOutcome["kind"]
  result?: ToolCallResultPolarity
  completeness?: ToolCallResultCompleteness
  turnControl?: ToolCallTurnControlMode
  startedAt?: number
  endedAt?: number
  metadata?: Record<string, unknown>
}

export type EvalTokenUsage = {
  input?: number
  output?: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
}

export type EvalExecution = {
  outputText: string
  status: EvalExecutionStatus
  startedAt: number
  endedAt: number
  durationMs?: number
  toolCalls?: EvalToolCall[]
  usage?: EvalTokenUsage
  cost?: number
  error?: string
  metadata?: Record<string, unknown>
}

export type EvalAssertionResult = {
  assertion: EvalAssertion
  passed: boolean
  score: number
  weight: number
  message: string
  expected?: unknown
  actual?: unknown
}

export type EvalCaseScore = {
  caseID: string
  passed: boolean
  score: number
  threshold: number
  assertionResults: EvalAssertionResult[]
}

export type EvalAssertionScorer = (input: {
  assertion: EvalAssertion
  testCase: EvalCase
  execution: EvalExecution
}) => EvalAssertionResult | undefined | Promise<EvalAssertionResult | undefined>

function assertionLabel(assertion: EvalAssertion) {
  return assertion.id ?? assertion.description ?? assertion.type
}

function result(
  assertion: EvalAssertion,
  passed: boolean,
  message: string,
  actual?: unknown,
  expected?: unknown,
): EvalAssertionResult {
  return {
    assertion,
    passed,
    score: passed ? 1 : 0,
    weight: assertion.weight,
    message,
    actual,
    expected,
  }
}

function normalizeText(value: string, caseSensitive: boolean | undefined) {
  return caseSensitive ? value : value.toLowerCase()
}

function countToolCalls(execution: EvalExecution, name?: string) {
  return (execution.toolCalls ?? []).filter((call) => !name || call.name === name).length
}

function tokenTotal(usage: EvalTokenUsage | undefined) {
  if (!usage) return undefined
  return (
    (usage.input ?? 0) +
    (usage.output ?? 0) +
    (usage.reasoning ?? 0) +
    (usage.cacheRead ?? 0) +
    (usage.cacheWrite ?? 0)
  )
}

function getPathValue(input: unknown, path: string): unknown {
  let current = input
  for (const segment of path.split(".")) {
    if (!segment) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
      continue
    }
    if (!current || typeof current !== "object") return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function stableStringify(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
  return `{${entries.join(",")}}`
}

function valuesEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true
  return stableStringify(left) === stableStringify(right)
}

export async function scoreAssertion(
  assertion: EvalAssertion,
  testCase: EvalCase,
  execution: EvalExecution,
  customScorers: EvalAssertionScorer[] = [],
): Promise<EvalAssertionResult> {
  if (assertion.type === "custom") {
    for (const scorer of customScorers) {
      const scored = await scorer({ assertion, testCase, execution })
      if (scored) return scored
    }
    return result(assertion, false, `No custom scorer handled '${assertion.name}'.`, undefined, assertion.name)
  }

  switch (assertion.type) {
    case "status":
      return result(
        assertion,
        execution.status === assertion.value,
        `${assertionLabel(assertion)} expected status '${assertion.value}'.`,
        execution.status,
        assertion.value,
      )
    case "output_contains": {
      const actual = normalizeText(execution.outputText, assertion.caseSensitive)
      const expected = normalizeText(assertion.value, assertion.caseSensitive)
      return result(
        assertion,
        actual.includes(expected),
        `${assertionLabel(assertion)} expected output to contain '${assertion.value}'.`,
        execution.outputText,
        assertion.value,
      )
    }
    case "output_not_contains": {
      const actual = normalizeText(execution.outputText, assertion.caseSensitive)
      const expected = normalizeText(assertion.value, assertion.caseSensitive)
      return result(
        assertion,
        !actual.includes(expected),
        `${assertionLabel(assertion)} expected output not to contain '${assertion.value}'.`,
        execution.outputText,
        assertion.value,
      )
    }
    case "output_exact": {
      const actual = assertion.trim ? execution.outputText.trim() : execution.outputText
      const expected = assertion.trim ? assertion.value.trim() : assertion.value
      return result(
        assertion,
        actual === expected,
        `${assertionLabel(assertion)} expected exact output match.`,
        actual,
        expected,
      )
    }
    case "output_regex": {
      const regex = new RegExp(assertion.pattern, assertion.flags)
      return result(
        assertion,
        regex.test(execution.outputText),
        `${assertionLabel(assertion)} expected output to match /${assertion.pattern}/${assertion.flags ?? ""}.`,
        execution.outputText,
        assertion.pattern,
      )
    }
    case "output_min_length":
      return result(
        assertion,
        execution.outputText.length >= assertion.min,
        `${assertionLabel(assertion)} expected output length >= ${assertion.min}.`,
        execution.outputText.length,
        assertion.min,
      )
    case "output_max_length":
      return result(
        assertion,
        execution.outputText.length <= assertion.max,
        `${assertionLabel(assertion)} expected output length <= ${assertion.max}.`,
        execution.outputText.length,
        assertion.max,
      )
    case "tool_called": {
      const count = countToolCalls(execution, assertion.name)
      return result(
        assertion,
        count >= assertion.minCalls,
        `${assertionLabel(assertion)} expected tool '${assertion.name}' to be called at least ${assertion.minCalls} time(s).`,
        count,
        assertion.minCalls,
      )
    }
    case "tool_not_called": {
      const count = countToolCalls(execution, assertion.name)
      return result(
        assertion,
        count === 0,
        `${assertionLabel(assertion)} expected tool '${assertion.name}' not to be called.`,
        count,
        0,
      )
    }
    case "tool_call_count": {
      const count = countToolCalls(execution, assertion.name)
      if (assertion.min === undefined && assertion.max === undefined) {
        return result(
          assertion,
          false,
          `${assertionLabel(assertion)} requires min or max.`,
          count,
          { min: assertion.min, max: assertion.max },
        )
      }
      const minPassed = assertion.min === undefined || count >= assertion.min
      const maxPassed = assertion.max === undefined || count <= assertion.max
      return result(
        assertion,
        minPassed && maxPassed,
        `${assertionLabel(assertion)} expected tool call count within configured range.`,
        count,
        { min: assertion.min, max: assertion.max },
      )
    }
    case "metadata_equals": {
      const actual = getPathValue(execution.metadata, assertion.path)
      return result(
        assertion,
        valuesEqual(actual, assertion.value),
        `${assertionLabel(assertion)} expected metadata path '${assertion.path}' to match.`,
        actual,
        assertion.value,
      )
    }
    case "latency_under_ms": {
      const duration = execution.durationMs ?? Math.max(0, execution.endedAt - execution.startedAt)
      return result(
        assertion,
        duration <= assertion.maxMs,
        `${assertionLabel(assertion)} expected latency <= ${assertion.maxMs}ms.`,
        duration,
        assertion.maxMs,
      )
    }
    case "token_usage_under": {
      const total = tokenTotal(execution.usage)
      return result(
        assertion,
        total !== undefined && total <= assertion.maxTokens,
        `${assertionLabel(assertion)} expected token usage <= ${assertion.maxTokens}.`,
        total,
        assertion.maxTokens,
      )
    }
    case "cost_under":
      return result(
        assertion,
        execution.cost !== undefined && execution.cost <= assertion.maxCost,
        `${assertionLabel(assertion)} expected cost <= ${assertion.maxCost}.`,
        execution.cost,
        assertion.maxCost,
      )
  }
}

export async function scoreCase(
  testCase: EvalCase,
  execution: EvalExecution,
  options: { threshold?: number; customScorers?: EvalAssertionScorer[] } = {},
): Promise<EvalCaseScore> {
  const threshold = options.threshold ?? testCase.threshold ?? 1
  const assertionResults: EvalAssertionResult[] = []
  for (const assertion of testCase.assertions) {
    assertionResults.push(await scoreAssertion(assertion, testCase, execution, options.customScorers))
  }

  const totalWeight = assertionResults.reduce((sum, item) => sum + item.weight, 0)
  const score = totalWeight > 0
    ? assertionResults.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight
    : 1

  return {
    caseID: testCase.id,
    passed: score >= threshold,
    score,
    threshold,
    assertionResults,
  }
}
