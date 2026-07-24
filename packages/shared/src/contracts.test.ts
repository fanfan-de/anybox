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
        turnMcpServerIDs: ["gmail", "feishu"],
      }).success,
    ).toBe(true)
    expect(
      AgentRouteSchemas.sessions.streamMessage.body.safeParse({
        text: "hello",
        turnMcpServerIDs: "gmail",
      }).success,
    ).toBe(false)
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

  it("validates desktop storage usage snapshots", () => {
    expect(
      DesktopIpcSchemas.getStorageUsage.output.parse({
        generatedAt: 1,
        database: {
          path: "/tmp/agent_local_data.db",
          totalBytes: 4096,
          mainBytes: 4096,
          walBytes: 0,
          shmBytes: 0,
          pageSize: 4096,
          pageCount: 1,
          freelistBytes: 0,
        },
        categories: [
          {
            id: "archivedSessions",
            label: "Archived sessions",
            bytes: 128,
            approximate: true,
            count: 1,
          },
          {
            id: "sqliteOverhead",
            label: "SQLite overhead",
            bytes: 3968,
            approximate: true,
          },
        ],
        archivedSessions: [
          {
            id: "session-1",
            title: "Archived work",
            projectID: "project-1",
            projectName: null,
            directory: "/tmp/project",
            updated: 1,
            archivedAt: 2,
            messageCount: 3,
            eventCount: 4,
            estimatedBytes: 128,
          },
        ],
        tables: [
          {
            name: "archived_sessions",
            category: "archivedSessions",
            rowCount: 1,
            estimatedBytes: 128,
          },
        ],
        trace: {
          count: 0,
          estimatedBytes: 0,
          earliestTimestamp: null,
          retentionDays: 30,
        },
        toolArtifacts: {
          fileCount: 0,
          bytes: 0,
        },
        maintenance: {
          status: "idle",
          reclaimableBytes: 0,
        },
      }).database.pageSize,
    ).toBe(4096)
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
