import { describe, expect, test } from "bun:test"
import { buildAgentSessionTraceExport, buildSafeStoredTraceEventPage, sanitizeTraceExportValue } from "#session/runtime/trace-export.ts"

describe("session trace export sanitization", () => {
  test("removes credential keys, whole Bearer values, URL query credentials, and data URLs", () => {
    const stats = { redactedCount: 0, truncatedCount: 0 }
    const safe = sanitizeTraceExportValue({
      api_key: "sk-test-key",
      Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.secret.signature",
      cookie: "session=private-cookie",
      note: "Authorization: Bearer visible-token",
      url: "https://example.test/path?token=query-secret&ok=1&password=hidden",
      image: "data:image/png;base64,c2VjcmV0LWltYWdl",
      usage: { inputTokens: 123, outputTokens: 45 },
    }, stats)
    const serialized = JSON.stringify(safe)

    expect(serialized).not.toContain("sk-test-key")
    expect(serialized).not.toContain("eyJhbGciOiJIUzI1NiJ9")
    expect(serialized).not.toContain("visible-token")
    expect(serialized).not.toContain("query-secret")
    expect(serialized).not.toContain("hidden")
    expect(serialized).not.toContain("c2VjcmV0LWltYWdl")
    expect(serialized).toContain("[REDACTED]")
    expect(safe).toMatchObject({
      note: "Authorization: [REDACTED]",
      url: "https://example.test/path?token=%5BREDACTED%5D&ok=1&password=%5BREDACTED%5D",
      image: "[DATA_URL:image/png;redacted]",
      usage: { inputTokens: 123, outputTokens: 45 },
    })
    expect(stats.redactedCount).toBeGreaterThanOrEqual(6)
  })

  test("preserves shared runtime turn references while still redacting real cycles", () => {
    const sharedTurn = {
      id: "turn-1",
      turnID: "turn-1",
      status: "completed",
      resume: false,
      tools: [
        {
          callID: "toolcall-1",
          tool: "grep",
          status: "completed",
        },
      ],
      llmCalls: [],
      recentEvents: [],
    }
    const runtime = {
      generatedAt: 1,
      logging: {},
      session: {
        id: "session-1",
        missing: false,
      },
      status: {
        type: "idle",
      },
      running: {
        sessionID: "session-1",
        startedAt: null,
        activeForMs: 0,
      },
      runner: null,
      runnerLimits: {},
      activeTurnID: null,
      turn: sharedTurn,
      latestTurn: sharedTurn,
      turns: [sharedTurn],
      recentEvents: [],
      tasks: {},
      diagnostics: {
        blockedOnApproval: false,
        activeToolCount: 0,
        failedToolCount: 0,
        llmFailureCount: 0,
      },
    }

    const trace = buildAgentSessionTraceExport({
      events: [],
      generatedAt: 2,
      messages: [],
      runtime: runtime as never,
    })

    expect(trace.runtime.turn).toMatchObject({
      turnID: "turn-1",
      status: "completed",
    })
    expect(trace.runtime.latestTurn).toMatchObject({
      turnID: "turn-1",
      status: "completed",
    })
    expect(trace.runtime.turns[0]!).toMatchObject({
      turnID: "turn-1",
      status: "completed",
    })
    expect(trace.runtime.turns[0]!).not.toBe("[CIRCULAR]")

    const stats = {
      redactedCount: 0,
      truncatedCount: 0,
    }
    const cyclic: Record<string, unknown> = {
      name: "root",
    }
    cyclic.self = cyclic

    expect(sanitizeTraceExportValue(cyclic, stats)).toEqual({
      name: "root",
      self: "[CIRCULAR]",
    })
    expect(stats.redactedCount).toBe(1)
  })

  test("adds diagnostics for completed shell calls with command-level failures", () => {
    const runtime = {
      generatedAt: 1,
      logging: {},
      session: {
        id: "session-1",
        missing: false,
      },
      status: {
        type: "idle",
      },
      running: {
        sessionID: "session-1",
        startedAt: null,
        activeForMs: 0,
      },
      runner: null,
      runnerLimits: {},
      activeTurnID: null,
      turn: null,
      latestTurn: null,
      turns: [],
      recentEvents: [],
      tasks: {},
      diagnostics: {
        blockedOnApproval: false,
        activeToolCount: 0,
        failedToolCount: 0,
        llmFailureCount: 0,
      },
    }

    const trace = buildAgentSessionTraceExport({
      events: [],
      generatedAt: 2,
      messages: [
        {
          info: {
            turnID: "turn-1",
          },
          parts: [
            {
              type: "tool",
              callID: "toolcall-1",
              tool: "powershell_command",
              messageID: "message-1",
              state: {
                status: "completed",
                input: {
                  command: "missing-command",
                },
                modelOutput: {
                  type: "json",
                  value: {
                    status: "failed",
                    exitCode: 1,
                    timedOut: false,
                    aborted: false,
                    stdoutTruncated: false,
                    stderrTruncated: false,
                    stderr: "missing-command: The term is not recognized",
                  },
                },
              },
            },
          ],
        },
      ] as never,
      runtime: runtime as never,
    })

    expect(trace.toolCalls[0]).toMatchObject({
      callID: "toolcall-1",
      status: "completed",
      diagnosticStatus: "error",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "shell.exit_nonzero",
        }),
        expect.objectContaining({
          severity: "warning",
          code: "shell.stderr",
        }),
      ]),
    })
  })

  test("single JSON exports keep only the newest 5000 trace records and mark truncation", () => {
    const events = Array.from({ length: 5_002 }, (_, index) => ({
      position: index + 1,
      schemaVersion: 2 as const,
      eventID: `event-${index + 1}`,
      sessionID: "session-1",
      turnID: "turn-1",
      seq: index + 1,
      type: "retry.scheduled",
      timestamp: index + 1,
      payload: { payloadBytes: 2 },
    }))
    const runtime = {
      generatedAt: 1,
      logging: {},
      session: { id: "session-1", missing: false },
      status: { type: "idle" },
      running: { sessionID: "session-1", startedAt: null, activeForMs: 0 },
      activeTurnID: null,
      latestTurn: null,
      turns: [],
      recentEvents: [],
      diagnostics: { blockedOnApproval: false, activeToolCount: 0, failedToolCount: 0, llmFailureCount: 0 },
    }

    const trace = buildAgentSessionTraceExport({ events, messages: [], runtime: runtime as never })
    expect(trace.events).toHaveLength(5_000)
    expect(trace.events[0]?.position).toBe(3)
    expect(trace.truncation).toEqual({
      eventsTruncated: true,
      maxEvents: 5_000,
      omittedEvents: 2,
    })
    expect(trace.stats.totalRetainedEventCount).toBe(5_002)
  })

  test("paged trace sanitization never returns complete Bearer credentials", () => {
    const page = buildSafeStoredTraceEventPage([{
      position: 1,
      schemaVersion: 2,
      eventID: "event-1",
      sessionID: "session-1",
      turnID: null,
      seq: 1,
      type: "permission.requested",
      timestamp: 1,
      payload: {
        payloadBytes: 10,
        error: "Authorization: Bearer page-secret-token",
      },
    }])
    expect(JSON.stringify(page.events)).not.toContain("page-secret-token")
    expect(page.redaction.redactedCount).toBeGreaterThan(0)
  })
})
