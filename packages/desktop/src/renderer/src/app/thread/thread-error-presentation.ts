import type {
  AssistantTraceDebugEntry,
  AssistantTraceErrorContext,
  AssistantTraceItem,
} from "../types"
import type { TranslationKey } from "../i18n/translations"

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

const ERROR_TITLE_KEYS = {
  "backend-request": "thread.error.title.backendRequestFailed",
  "stream-request": "thread.error.title.streamRequestFailed",
  "runtime-execution": "thread.error.title.runtimeExecutionFailed",
  "api-stream": "thread.error.title.apiStreamError",
  "tool-argument-validation": "thread.error.title.toolArgumentValidationFailed",
} satisfies Record<AssistantTraceErrorContext, TranslationKey>

const LEGACY_ERROR_CONTEXTS = [
  ["Tool argument validation failed", "tool-argument-validation"],
  ["Backend request failed", "backend-request"],
  ["Stream request failed", "stream-request"],
  ["Runtime execution failed", "runtime-execution"],
  ["API stream error", "api-stream"],
] as const satisfies ReadonlyArray<readonly [string, AssistantTraceErrorContext]>

const INSUFFICIENT_BALANCE_CODES = new Set([
  "ACCOUNT_BALANCE_INSUFFICIENT",
  "BALANCE_INSUFFICIENT",
  "BILLING_BALANCE_INSUFFICIENT",
  "CREDIT_BALANCE_INSUFFICIENT",
  "INSUFFICIENT_BALANCE",
  "INSUFFICIENT_CREDIT",
  "INSUFFICIENT_CREDITS",
  "INSUFFICIENT_FUNDS",
  "LOW_BALANCE",
  "PAYMENT_REQUIRED",
])

export interface AssistantTraceErrorPresentation {
  detail: string
  label: string
  status: string
  title: string
}

function normalizeErrorCode(value?: string) {
  return value?.trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toUpperCase() ?? ""
}

function inferLegacyErrorContext(title?: string): AssistantTraceErrorContext | null {
  const normalizedTitle = title?.trim().toLowerCase()
  if (!normalizedTitle) return null

  for (const [prefix, context] of LEGACY_ERROR_CONTEXTS) {
    const normalizedPrefix = prefix.toLowerCase()
    if (normalizedTitle === normalizedPrefix || normalizedTitle.startsWith(`${normalizedPrefix}:`)) {
      return context
    }
  }

  return null
}

function inferLegacyErrorName(item: AssistantTraceItem, context: AssistantTraceErrorContext) {
  if (item.errorInfo?.name) return item.errorInfo.name

  const prefix = LEGACY_ERROR_CONTEXTS.find((entry) => entry[1] === context)?.[0]
  const title = item.title?.trim()
  if (!prefix || !title || !title.toLowerCase().startsWith(`${prefix.toLowerCase()}:`)) return undefined
  return title.slice(prefix.length + 1).trim() || undefined
}

function resolveErrorContext(item: AssistantTraceItem): AssistantTraceErrorContext | null {
  return item.errorInfo?.context ?? inferLegacyErrorContext(item.title)
}

function resolveOriginalErrorMessage(item: AssistantTraceItem) {
  return item.errorInfo?.message.trim() || item.detail?.trim() || item.text?.trim() || ""
}

function hasInsufficientBalanceCode(code?: string) {
  const normalizedCode = normalizeErrorCode(code)
  return Boolean(normalizedCode && INSUFFICIENT_BALANCE_CODES.has(normalizedCode))
}

function hasInsufficientBalanceMessage(message: string) {
  return (
    /\binsufficient\s+(?:account\s+)?(?:balance|credits?|funds?)\b/i.test(message) ||
    /\b(?:balance|credits?|funds?)\s+(?:is\s+|are\s+)?insufficient\b/i.test(message) ||
    /余额不足|餘額不足/.test(message)
  )
}

function resolveErrorDetailKey(
  item: AssistantTraceItem,
  context: AssistantTraceErrorContext | null,
): TranslationKey {
  const message = resolveOriginalErrorMessage(item)
  if (hasInsufficientBalanceCode(item.errorInfo?.code) || hasInsufficientBalanceMessage(message)) {
    return "thread.error.message.insufficientBalance"
  }

  if (
    context === "tool-argument-validation" ||
    message.toLowerCase().includes("tool argument validation failed")
  ) {
    return "thread.error.message.toolArgumentValidation"
  }

  return "thread.error.message.requestFailed"
}

export function getAssistantTraceErrorPresentation(
  item: AssistantTraceItem,
  translate: Translate,
): AssistantTraceErrorPresentation {
  const context = resolveErrorContext(item)
  const titleKey = context ? ERROR_TITLE_KEYS[context] : "thread.error.title.requestFailed"

  return {
    detail: translate(resolveErrorDetailKey(item, context)),
    label: translate("app.error"),
    status: translate("app.error"),
    title: translate(titleKey),
  }
}

export function getAssistantTraceErrorDiagnosticEntry(
  item: AssistantTraceItem,
  translate: Translate,
): AssistantTraceDebugEntry {
  const context = resolveErrorContext(item)
  const name = context ? inferLegacyErrorName(item, context) : item.errorInfo?.name
  const message = resolveOriginalErrorMessage(item)
  const diagnostic = {
    ...(context ? { context } : {}),
    ...(name ? { name } : {}),
    ...(message ? { message } : {}),
    ...(item.errorInfo?.code ? { code: item.errorInfo.code } : {}),
    ...(item.errorInfo?.statusCode !== undefined ? { statusCode: item.errorInfo.statusCode } : {}),
    ...(item.errorInfo?.retryable !== undefined ? { retryable: item.errorInfo.retryable } : {}),
    ...(item.errorInfo?.providerID ? { providerID: item.errorInfo.providerID } : {}),
    ...(item.errorInfo?.modelID ? { modelID: item.errorInfo.modelID } : {}),
  }

  return {
    label: translate("thread.error.debug.diagnostics"),
    value: JSON.stringify(diagnostic),
  }
}
