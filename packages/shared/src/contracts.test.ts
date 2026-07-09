import { describe, expect, it } from "vitest"
import {
  AgentRouteSchemas,
  ApiEnvelopeSchema,
  DesktopIpcSchemas,
  getDefaultReasoningEffort,
  getSupportedReasoningEfforts,
  normalizeReasoningEffort,
  SessionEventSchema,
} from "./index"

describe("shared contracts", () => {
  it("accepts API success and failure envelopes", () => {
    expect(ApiEnvelopeSchema.parse({ success: true, data: { ok: true }, requestId: "req_1" }).success).toBe(true)
    expect(
      ApiEnvelopeSchema.parse({
        success: false,
        error: { code: "INVALID_PAYLOAD", message: "Bad payload" },
      }).success,
    ).toBe(false)
  })

  it("validates session stream request payloads", () => {
    expect(AgentRouteSchemas.sessions.streamMessage.body.safeParse({ text: "hello" }).success).toBe(true)
    expect(
      AgentRouteSchemas.sessions.streamMessage.body.safeParse({
        text: "hello",
        concurrentInputMode: "queue",
      }).success,
    ).toBe(true)
    expect(
      AgentRouteSchemas.sessions.streamMessage.body.safeParse({
        text: "hello",
        concurrentInputMode: "steer",
      }).success,
    ).toBe(true)
    expect(
      AgentRouteSchemas.sessions.streamMessage.body.safeParse({
        text: "hello",
        concurrentInputMode: "interrupt",
      }).success,
    ).toBe(false)
    expect(AgentRouteSchemas.sessions.streamMessage.body.safeParse({ attachments: [{ path: "/tmp/a.png" }] }).success).toBe(true)
    expect(AgentRouteSchemas.sessions.streamMessage.body.safeParse({}).success).toBe(false)
  })

  it("validates desktop openPath and session event contracts", () => {
    expect(DesktopIpcSchemas.openPath.input.parse({ targetPath: "/tmp/project" }).targetPath).toBe("/tmp/project")
    expect(SessionEventSchema.parse({ event: "message", data: { text: "ok" }, id: "1" }).event).toBe("message")
  })

  it("keeps provider reasoning effort differences explicit", () => {
    expect(getSupportedReasoningEfforts({
      providerID: "deepseek",
      modelID: "deepseek-v4-pro",
      reasoning: true,
    })).toEqual(["high", "max"])
    expect(normalizeReasoningEffort({
      providerID: "deepseek",
      modelID: "deepseek-v4-pro",
      reasoning: true,
      reasoningEffort: "xhigh",
    })).toBe("max")
    expect(getSupportedReasoningEfforts({
      providerID: "openai",
      modelID: "gpt-5.4",
      reasoning: true,
    })).toEqual(["none", "low", "medium", "high", "xhigh"])
    expect(getSupportedReasoningEfforts({
      providerID: "google",
      modelID: "gemini-3.1-pro-preview",
      reasoning: true,
    })).toEqual(["low", "medium", "high"])
    expect(getDefaultReasoningEffort({
      providerID: "google",
      modelID: "gemini-3.1-pro-preview",
      reasoning: true,
    })).toBe("high")
    expect(getSupportedReasoningEfforts({
      providerID: "google",
      modelID: "gemini-2.5-flash-image",
      reasoning: true,
    })).toEqual([])
    expect(getDefaultReasoningEffort({
      providerID: "google",
      modelID: "gemini-2.5-flash-image",
      reasoning: true,
    })).toBeUndefined()
    expect(normalizeReasoningEffort({
      providerID: "google",
      modelID: "gemini-3.1-pro-preview",
      reasoning: true,
      reasoningEffort: "xhigh",
    })).toBe("high")
  })
})
