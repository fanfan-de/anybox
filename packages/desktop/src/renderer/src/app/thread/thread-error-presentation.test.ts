import { describe, expect, it } from "vitest"
import { t } from "../i18n/translations"
import type { AssistantTraceItem } from "../types"
import {
  getAssistantTraceErrorDiagnosticEntry,
  getAssistantTraceErrorPresentation,
} from "./thread-error-presentation"

function errorItem(overrides: Partial<AssistantTraceItem> = {}): AssistantTraceItem {
  return {
    id: "error-1",
    kind: "error",
    timestamp: 1,
    label: "Error",
    title: "Backend request failed: AI_APICallError",
    detail: "Insufficient Balance",
    status: "error",
    errorInfo: {
      context: "backend-request",
      message: "Insufficient Balance",
      name: "AI_APICallError",
      statusCode: 402,
      retryable: false,
      providerID: "anybox",
      modelID: "deepseek-chat",
    },
    ...overrides,
  }
}

describe("thread error presentation", () => {
  it("localizes a provider balance error without exposing the raw provider message", () => {
    const item = errorItem()
    const zhPresentation = getAssistantTraceErrorPresentation(item, (key, params) => t("zh-CN", key, params))
    const enPresentation = getAssistantTraceErrorPresentation(item, (key, params) => t("en-US", key, params))

    expect(zhPresentation).toEqual({
      detail: "余额不足，请充值后重试。",
      label: "错误",
      status: "错误",
      title: "后端请求失败",
    })
    expect(enPresentation.detail).toBe("Your balance is insufficient. Add funds and try again.")
    expect(zhPresentation.detail).not.toContain(item.errorInfo!.message)
  })

  it("prefers stable provider error codes when classifying balance failures", () => {
    const item = errorItem({
      detail: "Payment could not be processed",
      errorInfo: {
        context: "backend-request",
        message: "Payment could not be processed",
        code: "insufficient_balance",
      },
    })

    expect(
      getAssistantTraceErrorPresentation(item, (key, params) => t("zh-CN", key, params)).detail,
    ).toBe("余额不足，请充值后重试。")
  })

  it("falls back to a localized generic message for unknown provider errors", () => {
    const item = errorItem({
      detail: "upstream socket closed",
      errorInfo: {
        context: "api-stream",
        message: "upstream socket closed",
      },
    })
    const presentation = getAssistantTraceErrorPresentation(item, (key, params) => t("zh-CN", key, params))

    expect(presentation.title).toBe("API 流错误")
    expect(presentation.detail).toBe("请求未能完成，请重试。")
    expect(presentation.detail).not.toContain("upstream socket closed")
  })

  it("keeps the original structured error in a technical diagnostic entry", () => {
    const entry = getAssistantTraceErrorDiagnosticEntry(
      errorItem({
        errorInfo: {
          context: "backend-request",
          message: "Insufficient Balance",
          name: "AI_APICallError",
          code: "INSUFFICIENT_BALANCE",
          statusCode: 402,
          retryable: false,
          providerID: "anybox",
          modelID: "deepseek-chat",
        },
      }),
      (key, params) => t("zh-CN", key, params),
    )

    expect(entry.label).toBe("错误诊断")
    expect(JSON.parse(entry.value)).toEqual({
      context: "backend-request",
      name: "AI_APICallError",
      message: "Insufficient Balance",
      code: "INSUFFICIENT_BALANCE",
      statusCode: 402,
      retryable: false,
      providerID: "anybox",
      modelID: "deepseek-chat",
    })
  })

  it("recognizes legacy error trace titles created before structured error metadata", () => {
    const item = errorItem({
      errorInfo: undefined,
      title: "Backend request failed: AI_APICallError",
    })
    const presentation = getAssistantTraceErrorPresentation(item, (key, params) => t("zh-CN", key, params))
    const diagnostic = getAssistantTraceErrorDiagnosticEntry(item, (key, params) => t("zh-CN", key, params))

    expect(presentation.title).toBe("后端请求失败")
    expect(JSON.parse(diagnostic.value)).toMatchObject({
      context: "backend-request",
      name: "AI_APICallError",
      message: "Insufficient Balance",
    })
  })
})
