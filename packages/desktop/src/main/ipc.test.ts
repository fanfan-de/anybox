import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { NativeImage } from "electron"

const requestAgentJSONMock = vi.hoisted(() => vi.fn())

function toWindowsSeparators(value: unknown) {
  return String(value).replaceAll("/", "\\")
}

vi.mock("electron-updater", () => {
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    forceDevUpdateConfig: false,
    checkForUpdates: vi.fn(),
    on: vi.fn(),
    quitAndInstall: vi.fn(),
  }

  return {
    autoUpdater,
    default: {
      autoUpdater,
    },
  }
})

vi.mock("./agent-client", () => ({
  getAgentConfig: vi.fn(() => ({
    baseURL: "http://localhost:4096",
    defaultDirectory: "C:\\Projects",
  })),
  readAgentSSEStream: vi.fn(),
  requestAgentJSON: requestAgentJSONMock,
  resolveAgentURL: vi.fn((path: string) => `http://localhost:4096${path}`),
}))

import { internal } from "./ipc"

beforeEach(() => {
  requestAgentJSONMock.mockReset()
})

describe("ipc session stream cleanup helpers", () => {
  it("matches subscription keys by exact webContents id prefix", () => {
    expect(internal.isSessionStreamSubscriptionKeyForWebContents("12:session-a", 12)).toBe(true)
    expect(internal.isSessionStreamSubscriptionKeyForWebContents("112:session-a", 12)).toBe(false)
    expect(internal.isSessionStreamSubscriptionKeyForWebContents("1:12:session-a", 12)).toBe(false)
  })

  it("disposes only subscriptions owned by the destroyed webContents", () => {
    const owned = { dispose: vi.fn() }
    const otherSender = { dispose: vi.fn() }
    const otherPrefix = { dispose: vi.fn() }
    const subscriptions = new Map([
      ["12:session-a", owned],
      ["112:session-b", otherSender],
      ["1:12:session-c", otherPrefix],
    ])

    const disposedCount = internal.disposeSessionStreamSubscriptionsForWebContents(subscriptions, 12)

    expect(disposedCount).toBe(1)
    expect(owned.dispose).toHaveBeenCalledTimes(1)
    expect(otherSender.dispose).not.toHaveBeenCalled()
    expect(otherPrefix.dispose).not.toHaveBeenCalled()
    expect([...subscriptions.keys()]).toEqual(["112:session-b", "1:12:session-c"])
  })

  it("aborts only the matching client turn when provided", () => {
    const matching = new AbortController()
    const sameSessionOtherTurn = new AbortController()
    const requests = new Map([
      ["12:turn-a", {
        backendSessionID: "session-a",
        cancelRequested: false,
        clientTurnID: "turn-a",
        controller: matching,
      }],
      ["12:turn-b", {
        backendSessionID: "session-a",
        cancelRequested: false,
        clientTurnID: "turn-b",
        controller: sameSessionOtherTurn,
      }],
    ])

    const aborted = internal.abortActiveAgentSessionRequestsInMap(requests, {
      backendSessionID: "session-a",
      clientTurnID: "turn-a",
      webContentsID: 12,
    })

    expect(aborted).toBe(1)
    expect(requests.get("12:turn-a")?.cancelRequested).toBe(true)
    expect(matching.signal.aborted).toBe(true)
    expect(requests.get("12:turn-b")?.cancelRequested).toBe(false)
    expect(sameSessionOtherTurn.signal.aborted).toBe(false)
  })

  it("aborts all active requests for the same backend session in one webContents when no turn is provided", () => {
    const first = new AbortController()
    const second = new AbortController()
    const otherSession = new AbortController()
    const otherWebContents = new AbortController()
    const requests = new Map([
      ["12:turn-a", {
        backendSessionID: "session-a",
        cancelRequested: false,
        clientTurnID: "turn-a",
        controller: first,
      }],
      ["12:turn-b", {
        backendSessionID: "session-a",
        cancelRequested: false,
        clientTurnID: "turn-b",
        controller: second,
      }],
      ["12:turn-c", {
        backendSessionID: "session-b",
        cancelRequested: false,
        clientTurnID: "turn-c",
        controller: otherSession,
      }],
      ["13:turn-d", {
        backendSessionID: "session-a",
        cancelRequested: false,
        clientTurnID: "turn-d",
        controller: otherWebContents,
      }],
    ])

    const aborted = internal.abortActiveAgentSessionRequestsInMap(requests, {
      backendSessionID: "session-a",
      webContentsID: 12,
    })

    expect(aborted).toBe(2)
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(otherSession.signal.aborted).toBe(false)
    expect(otherWebContents.signal.aborted).toBe(false)
  })

  it("sends interrupt to the backend without aborting the active local request first", async () => {
    const requestBackendCancel = vi.fn(async () => ({
      sessionID: "session-a",
      cancelled: true,
      activeCancelled: true,
      queuedCancelled: 2,
    }))

    await expect(internal.interruptAgentSessionBackendFirst({
      backendSessionID: " session-a ",
      clientTurnID: " turn-a ",
      webContentsID: 12,
      requestBackendCancel,
    })).resolves.toEqual({
      backendSessionID: "session-a",
      clientTurnID: "turn-a",
      localRequestsAborted: 0,
      backendCancelled: true,
      activeCancelled: true,
      queuedCancelled: 2,
    })

    expect(requestBackendCancel).toHaveBeenCalledWith("session-a")
  })

  it("reports backend interrupt failure without aborting the active local request", async () => {
    const requestBackendCancel = vi.fn(async () => {
      throw new Error("agent offline")
    })

    await expect(internal.interruptAgentSessionBackendFirst({
      backendSessionID: " session-a ",
      clientTurnID: " turn-a ",
      webContentsID: 12,
      requestBackendCancel,
    })).resolves.toEqual({
      backendSessionID: "session-a",
      clientTurnID: "turn-a",
      localRequestsAborted: 0,
      backendCancelled: false,
      backendCancelError: "agent offline",
    })
  })
})

describe("ipc tool permission mode helpers", () => {
  it("loads the global tool permission mode from the agent API", async () => {
    requestAgentJSONMock.mockResolvedValueOnce({
      data: {
        mode: "default",
      },
    })

    await expect(internal.getToolPermissionMode()).resolves.toEqual({
      mode: "default",
    })
    expect(requestAgentJSONMock).toHaveBeenCalledWith("/api/tools/permission-mode")
  })

  it("updates the global tool permission mode through the agent API", async () => {
    requestAgentJSONMock.mockResolvedValueOnce({
      data: {
        mode: "full_access",
      },
    })

    await expect(internal.updateToolPermissionMode({ mode: "full_access" })).resolves.toEqual({
      mode: "full_access",
    })

    expect(requestAgentJSONMock).toHaveBeenCalledWith("/api/tools/permission-mode", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "full_access",
      }),
    })
  })
})

describe("ipc prompt helpers", () => {
  it("translates prompt presets through the agent API", async () => {
    requestAgentJSONMock.mockResolvedValueOnce({
      data: {
        id: "custom-system-prompt",
        label: "System prompt - 简体中文",
        description: "Translated prompt.",
        source: "custom",
        hasOverride: false,
        editable: true,
        content: "translated prompt",
      },
    })

    const input = {
      sourcePresetID: "system-default",
      sourceLabel: "System prompt",
      content: "source prompt",
      languageID: "zh-Hans" as const,
      model: "openai/gpt-5",
    }

    await expect(internal.translatePromptPreset(input)).resolves.toMatchObject({
      id: "custom-system-prompt",
      label: "System prompt - 简体中文",
      content: "translated prompt",
    })
    expect(requestAgentJSONMock).toHaveBeenCalledWith("/api/prompts/translate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    })
  })

  it("updates prompt preset selection with all assignment slots", async () => {
    const selection = {
      systemPromptPresetID: "system-codex",
      planModePromptPresetID: "plan-mode",
      sideChatPromptPresetID: "side-chat",
      gitCommitPromptPresetID: "git-commit-message",
    }
    requestAgentJSONMock.mockResolvedValueOnce({
      data: selection,
    })

    await expect(internal.updatePromptPresetSelection(selection)).resolves.toEqual(selection)
    expect(requestAgentJSONMock).toHaveBeenCalledWith("/api/prompts/selection", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(selection),
    })
  })
})

describe("ipc side chat cleanup helpers", () => {
  function createSideChatLink(input: {
    sessionID: string
    assistantText?: string
    archived?: boolean
  }) {
    return {
      sessionID: input.sessionID,
      parentSessionID: "parent-1",
      anchorMessageID: "assistant-1",
      createdAt: 1,
      anchorPreview: "Parent response",
      snapshotVersion: 1 as const,
      snapshot: {
        assistantText: input.assistantText ?? "",
      },
      archived: input.archived,
    }
  }

  it("deletes live side chat links that do not have an assistant response", async () => {
    const deleteSession = vi.fn().mockResolvedValue(undefined)
    const links = [
      createSideChatLink({ sessionID: "empty-1" }),
      createSideChatLink({ sessionID: "response-1", assistantText: "A real answer." }),
      createSideChatLink({ sessionID: "empty-archived", archived: true }),
      createSideChatLink({ sessionID: "empty-2", assistantText: "   " }),
    ]

    await expect(internal.cleanupSideChatLinksWithoutResponses(links, deleteSession)).resolves.toEqual([
      links[1],
      links[2],
    ])
    expect(deleteSession).toHaveBeenCalledTimes(2)
    expect(deleteSession).toHaveBeenNthCalledWith(1, "empty-1")
    expect(deleteSession).toHaveBeenNthCalledWith(2, "empty-2")
  })

  it("keeps an empty side chat link when deletion fails so the cleanup can be retried", async () => {
    const deleteSession = vi.fn().mockRejectedValue(new Error("network failed"))
    const link = createSideChatLink({ sessionID: "empty-1" })
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true)

    try {
      await expect(internal.cleanupSideChatLinksWithoutResponses([link], deleteSession)).resolves.toEqual([link])
    } finally {
      stderrWrite.mockRestore()
    }
  })
})

describe("ipc session trace export helpers", () => {
  const traceExport = {
    schemaVersion: 1 as const,
    generatedAt: 1,
    mode: "safe" as const,
    session: {
      id: "session-1",
      missing: false,
    },
    stats: {
      messageCount: 1,
      eventCount: 1,
      turnCount: 1,
      toolCallCount: 1,
      redactedCount: 0,
      truncatedCount: 0,
    },
    redaction: {
      enabled: true as const,
      maxStringLength: 20000,
      redactedKeyPattern: "token",
    },
    messages: [],
    events: [],
    runtime: {
      generatedAt: 1,
      logging: {},
      session: {
        id: "session-1",
        missing: false,
      },
      status: {
        type: "idle" as const,
      },
      running: {
        sessionID: "session-1",
        startedAt: null,
        activeForMs: 0,
      },
      activeTurnID: null,
      latestTurn: null,
      turns: [],
      recentEvents: [],
      diagnostics: {
        blockedOnApproval: false,
        activeToolCount: 0,
        failedToolCount: 0,
        llmFailureCount: 0,
      },
    },
    toolCalls: [],
  }

  it("loads a safe session trace export from the agent API", async () => {
    requestAgentJSONMock.mockResolvedValueOnce({
      data: traceExport,
    })

    await expect(internal.getSessionTraceExport({ sessionID: " session-1 " })).resolves.toEqual(traceExport)
    expect(requestAgentJSONMock).toHaveBeenCalledWith("/api/debug/sessions/session-1/trace-export")
  })

  it("saves formatted session trace JSON through an injected save dialog", async () => {
    const showSaveDialog = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: "C:\\Temp\\trace.json",
    })
    const writeTraceFile = vi.fn().mockResolvedValue(undefined)
    requestAgentJSONMock.mockResolvedValueOnce({
      data: traceExport,
    })

    const result = await internal.saveSessionTraceExport(
      { sessionID: "session-1" },
      {
        downloadsPath: "C:\\Downloads",
        now: new Date(2026, 4, 22, 9, 8, 7),
        showSaveDialog,
        writeTraceFile,
      },
    )

    expect(result).toEqual({
      canceled: false,
      path: "C:\\Temp\\trace.json",
    })
    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: expect.stringContaining("anybox-trace-session-1-20260522-090807.json"),
      filters: [{ name: "JSON", extensions: ["json"] }],
      title: "Save session trace JSON",
    }))
    expect(writeTraceFile).toHaveBeenCalledWith(
      "C:\\Temp\\trace.json",
      `${JSON.stringify(traceExport, null, 2)}\n`,
      "utf8",
    )
  })

  it("saves a split session trace directory with per-record files", async () => {
    const largeToolOutput = {
      matches: Array.from({ length: 30 }, (_, index) => ({
        file: `src/file-${index}.ts`,
        line: index + 1,
        text: `const value${index} = "${"x".repeat(48)}";`,
      })),
    }
    const turn = {
      turnID: "turn-1",
      status: "completed" as const,
      resume: false,
      llmCalls: [
        {
          id: "llm-1",
          messageID: "message-1",
          providerID: "provider-1",
          modelID: "model-1",
          status: "completed" as const,
          startedAt: 20,
          endedAt: 21,
          durationMs: 1,
          messageCount: 1,
        },
      ],
      tools: [
        {
          callID: "toolcall-1",
          tool: "grep",
          status: "completed",
        },
      ],
      recentEvents: [],
    }
    const traceWithRecords = {
      ...traceExport,
      stats: {
        ...traceExport.stats,
        messageCount: 1,
        eventCount: 2,
        turnCount: 1,
        toolCallCount: 1,
      },
      messages: [
        {
          info: {
            id: "message-1",
            role: "assistant",
            turnID: "turn-1",
            parentMessageID: "user-message-1",
            created: 1,
            completed: 40,
            providerID: "provider-1",
            modelID: "model-1",
            agent: "default",
            path: {
              cwd: "C:\\Projects\\Demo",
              root: "C:\\Projects\\Demo",
            },
          },
          parts: [
            {
              id: "patch-1",
              messageID: "message-1",
              type: "patch",
              files: ["src/file.ts"],
              summary: {
                additions: 1,
                deletions: 0,
              },
              hash: "patch-hash",
            },
          ],
        },
      ],
      events: [
        {
          eventID: "event-1",
          sessionID: "session-1",
          turnID: "turn-1",
          seq: 1,
          timestamp: 2,
          type: "tool.call.completed",
          payload: {
            part: {
              callID: "toolcall-1",
            },
          },
        },
        {
          eventID: "event-2",
          sessionID: "session-1",
          turnID: "turn-1",
          seq: 2,
          timestamp: 30,
          type: "patch.generated",
          payload: {
            part: {
              id: "patch-1",
              messageID: "message-1",
              type: "patch",
              files: ["src/file.ts"],
              summary: {
                additions: 1,
                deletions: 0,
              },
              hash: "patch-hash",
            },
          },
        },
      ],
      runtime: {
        ...traceExport.runtime,
        latestTurn: turn,
        turns: [turn],
        recentEvents: [
          {
            eventID: "event-1",
            type: "tool.call.completed",
            sessionID: "session-1",
            turnID: "turn-1",
            seq: 1,
            timestamp: 2,
          },
        ],
      },
      toolCalls: [
        {
          callID: "toolcall-1",
          tool: "grep",
          status: "completed",
          diagnosticStatus: "error",
          diagnostics: [
            {
              severity: "error",
              code: "shell.exit_nonzero",
              message: "Shell command exited with code 1.",
            },
            {
              severity: "warning",
              code: "shell.stderr",
              message: "Shell command wrote to stderr.",
            },
          ],
          turnID: "turn-1",
          messageID: "message-1",
          startedAt: 20,
          endedAt: 21,
          durationMs: 1,
          output: largeToolOutput,
          eventIDs: ["event-1"],
        },
      ],
    }
    const showOpenDialog = vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ["C:\\Exports"],
    })
    const makeDirectory = vi.fn().mockResolvedValue(undefined)
    const writeTraceFile = vi.fn().mockResolvedValue(undefined)
    requestAgentJSONMock.mockResolvedValueOnce({
      data: traceWithRecords,
    })

    const result = await internal.saveSessionTraceExportDirectory(
      { sessionID: "session-1" },
      {
        downloadsPath: "C:\\Downloads",
        now: new Date(2026, 4, 22, 9, 8, 7),
        showOpenDialog,
        makeDirectory,
        writeTraceFile,
      },
    )

    expect(result).toEqual({
      canceled: false,
      path: expect.any(String),
      fileCount: 17,
      recordCount: 2,
    })
    expect(toWindowsSeparators(result.path)).toBe("C:\\Exports\\anybox-trace-session-1-20260522-090807")
    expect(showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      buttonLabel: "Export Here",
      defaultPath: "C:\\Downloads",
      properties: ["openDirectory", "createDirectory"],
      title: "Select folder for split session trace",
    }))
    expect(toWindowsSeparators(makeDirectory.mock.calls[0]?.[0])).toBe(
      "C:\\Exports\\anybox-trace-session-1-20260522-090807",
    )
    expect(makeDirectory.mock.calls[0]?.[1]).toEqual(
      { recursive: true },
    )

    const writtenPaths = writeTraceFile.mock.calls.map((call) => call[0])
    expect(writtenPaths.some((filePath) => toWindowsSeparators(filePath).endsWith("\\manifest.json"))).toBe(true)
    expect(writtenPaths.some((filePath) => toWindowsSeparators(filePath).endsWith("\\README_FIRST.md"))).toBe(true)
    expect(writtenPaths.some((filePath) => toWindowsSeparators(filePath).endsWith("\\event-flow.md"))).toBe(true)
    expect(writtenPaths.some((filePath) => toWindowsSeparators(filePath).endsWith("\\semantic-flow.md"))).toBe(true)
    expect(writtenPaths.some((filePath) => toWindowsSeparators(filePath).endsWith("\\payload-index.json"))).toBe(true)
    expect(writtenPaths.some((filePath) => toWindowsSeparators(filePath).includes("\\payloads\\payload-000001-grep-toolcall-1-output.json"))).toBe(true)
    expect(writtenPaths.some((filePath) => toWindowsSeparators(filePath).endsWith("\\records\\index.json"))).toBe(true)
    expect(writtenPaths.some((filePath) => toWindowsSeparators(filePath).includes("\\records\\000001-tool.call.completed-1-event-1.json"))).toBe(true)
    expect(writtenPaths.some((filePath) => toWindowsSeparators(filePath).endsWith("\\runtime\\status.json"))).toBe(true)

    const manifestCall = writeTraceFile.mock.calls.find((call) => toWindowsSeparators(call[0]).endsWith("\\manifest.json"))
    expect(manifestCall?.[1]).toContain('"exportFormat": "anybox-session-trace-directory"')
    expect(manifestCall?.[1]).toContain('"readme": "README_FIRST.md"')
    expect(manifestCall?.[1]).toContain('"eventFlow": "event-flow.md"')
    expect(manifestCall?.[1]).toContain('"semanticFlow": "semantic-flow.md"')
    expect(manifestCall?.[1]).toContain('"payloadIndex": "payload-index.json"')
    const readmeCall = writeTraceFile.mock.calls.find((call) => toWindowsSeparators(call[0]).endsWith("\\README_FIRST.md"))
    expect(readmeCall?.[1]).toContain("# README FIRST: Anybox Session Trace")
    expect(readmeCall?.[1]).toContain("read `semantic-flow.md` first")
    expect(readmeCall?.[1]).toContain("`messages/index.json`: searchable message index")
    expect(readmeCall?.[1]).toContain("`payload-index.json`: index for large payload files")
    expect(readmeCall?.[1]).toContain("payloadRefs: 1")
    const eventFlowCall = writeTraceFile.mock.calls.find((call) => toWindowsSeparators(call[0]).endsWith("\\event-flow.md"))
    expect(eventFlowCall?.[1]).toContain("# Anybox Agent Event Flow")
    expect(eventFlowCall?.[1]).toContain("tool.call.completed")
    expect(eventFlowCall?.[1]).toContain("shell.exit_nonzero")
    expect(eventFlowCall?.[1]).toContain("Shell command exited with code 1.")
    expect(eventFlowCall?.[1]).toContain("output=[ref:payloads/payload-000001-grep-toolcall-1-output.json")
    const semanticFlowCall = writeTraceFile.mock.calls.find((call) => toWindowsSeparators(call[0]).endsWith("\\semantic-flow.md"))
    expect(semanticFlowCall?.[1]).toContain("# Anybox Agent Semantic Flow")
    expect(semanticFlowCall?.[1]).toContain("### 1. tool - grep")
    expect(semanticFlowCall?.[1]).toContain("### 2. patch - patch / patch-1")
    expect(String(semanticFlowCall?.[1]).indexOf("### 1. tool - grep")).toBeLessThan(
      String(semanticFlowCall?.[1]).indexOf("### 2. patch - patch / patch-1"),
    )
    expect(semanticFlowCall?.[1]).toContain("tool")
    expect(semanticFlowCall?.[1]).toContain("grep")
    expect(semanticFlowCall?.[1]).toContain("diagnostics=`error:shell.exit_nonzero")
    expect(semanticFlowCall?.[1]).toContain("- sourceEvents:")
    expect(semanticFlowCall?.[1]).toContain("output=[ref:payloads/payload-000001-grep-toolcall-1-output.json")
    expect(semanticFlowCall?.[1]).not.toContain("| # | elapsed")
    expect(semanticFlowCall?.[1]).not.toContain("tool.call.completed")
    const payloadIndexCall = writeTraceFile.mock.calls.find((call) => toWindowsSeparators(call[0]).endsWith("\\payload-index.json"))
    expect(payloadIndexCall?.[1]).toContain('"fieldPath": "output"')
    expect(payloadIndexCall?.[1]).toContain('"path": "payloads/payload-000001-grep-toolcall-1-output.json"')
    const payloadIndex = JSON.parse(String(payloadIndexCall?.[1])) as Array<{
      chars: number
      path: string
      sha256: string
    }>
    expect(payloadIndex).toHaveLength(1)
    const payloadEntry = payloadIndex[0]!
    const payloadCall = writeTraceFile.mock.calls.find((call) =>
      toWindowsSeparators(call[0]).endsWith(toWindowsSeparators(payloadEntry.path)))
    const payloadContent = String(payloadCall?.[1])
    expect(payloadContent.length).toBe(payloadEntry.chars)
    expect(createHash("sha256").update(payloadContent).digest("hex")).toBe(payloadEntry.sha256)
    const toolCallIndexCall = writeTraceFile.mock.calls.find((call) => toWindowsSeparators(call[0]).endsWith("\\tool-calls\\index.json"))
    const toolCallIndex = JSON.parse(String(toolCallIndexCall?.[1])) as Array<{
      diagnosticStatus?: string
      diagnostics?: Array<{ code: string; severity: string }>
    }>
    expect(toolCallIndex[0]!).toMatchObject({
      diagnosticStatus: "error",
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "shell.exit_nonzero",
        }),
      ]),
    })
    const messageIndexCall = writeTraceFile.mock.calls.find((call) => toWindowsSeparators(call[0]).endsWith("\\messages\\index.json"))
    const messageIndex = JSON.parse(String(messageIndexCall?.[1])) as Array<{
      agent?: string
      created?: number
      cwd?: string
      messageID?: string
      modelID?: string
      providerID?: string
      role?: string
      turnID?: string
    }>
    expect(messageIndex[0]!).toMatchObject({
      agent: "default",
      created: 1,
      cwd: "C:\\Projects\\Demo",
      messageID: "message-1",
      modelID: "model-1",
      providerID: "provider-1",
      role: "assistant",
      turnID: "turn-1",
    })
    const turnIndexCall = writeTraceFile.mock.calls.find((call) => toWindowsSeparators(call[0]).endsWith("\\runtime\\turns\\index.json"))
    const turnIndex = JSON.parse(String(turnIndexCall?.[1])) as Array<{
      file: string
      llmCallCount: number
      status?: string
      toolCount: number
      turnID?: string
    }>
    expect(turnIndex[0]!).toMatchObject({
      llmCallCount: 1,
      status: "completed",
      toolCount: 1,
      turnID: "turn-1",
    })
    const turnRecordCall = writeTraceFile.mock.calls.find((call) =>
      toWindowsSeparators(call[0]).endsWith(toWindowsSeparators(turnIndex[0]!.file)))
    const turnRecord = JSON.parse(String(turnRecordCall?.[1])) as {
      turn: unknown
    }
    expect(turnRecord.turn).not.toBe("[CIRCULAR]")
    expect(turnRecord.turn).toMatchObject({
      status: "completed",
      turnID: "turn-1",
    })
    const recordCall = writeTraceFile.mock.calls.find((call) =>
      toWindowsSeparators(call[0]).includes("\\records\\000001-tool.call.completed-1-event-1.json"))
    expect(recordCall?.[1]).toContain('"relatedToolCallFiles"')
    expect(recordCall?.[1]).toContain('"tool-calls/000001-grep-toolcall-1.json"')
  })

  it("saves a split session trace directory under the project default location", async () => {
    const makeDirectory = vi.fn().mockResolvedValue(undefined)
    const writeTraceFile = vi.fn().mockResolvedValue(undefined)
    requestAgentJSONMock.mockResolvedValueOnce({
      data: traceExport,
    })

    const result = await internal.saveSessionTraceExportToProject(
      {
        sessionID: "session-1",
        directory: "C:\\Projects\\Demo",
        projectID: "project-1",
      },
      {
        makeDirectory,
        now: new Date(2026, 4, 22, 9, 8, 7),
        userDataPath: "C:\\Users\\Demo\\AppData\\Roaming\\Anybox",
        writeTraceFile,
      },
    )

    expect(result).toEqual(expect.objectContaining({
      canceled: false,
      path: expect.any(String),
      recordCount: 0,
    }))
    expect(toWindowsSeparators(result.path)).toBe(
      "C:\\Users\\Demo\\AppData\\Roaming\\Anybox\\session-traces\\project-1\\anybox-trace-session-1-20260522-090807",
    )
    expect(toWindowsSeparators(makeDirectory.mock.calls[0]?.[0])).toBe(
      "C:\\Users\\Demo\\AppData\\Roaming\\Anybox\\session-traces\\project-1\\anybox-trace-session-1-20260522-090807",
    )
    expect(makeDirectory.mock.calls[0]?.[1]).toEqual(
      { recursive: true },
    )
    expect(writeTraceFile.mock.calls.some((call) => toWindowsSeparators(call[0]).endsWith("\\manifest.json"))).toBe(true)
  })

  it("prepares a session bag submission in a local staging directory", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "anybox-bag-prepare-"))
    try {
      requestAgentJSONMock.mockResolvedValueOnce({
        data: traceExport,
      })

      const result = await internal.prepareSessionBagSubmission(
        {
          sessionID: " session-1 ",
          projectID: " project-1 ",
          workspaceDirectory: "C:\\Projects\\Demo",
        },
        {
          fetchRelaySession: async () => ({
            connected: true,
            status: "connected",
            accessToken: "relay-token",
            baseURL: "https://api.anybox.test/",
            account: {
              email: "dev@example.com",
              workspaceName: "Demo workspace",
            },
          }),
          now: new Date(2026, 4, 22, 9, 8, 7),
          userDataPath: tempRoot,
        },
      )

      expect(result).toEqual(expect.objectContaining({
        baseURL: "https://api.anybox.test",
        filename: "anybox-bag-session-1-20260522-090807.zip",
        fileCount: 11,
        projectID: "project-1",
        recordCount: 0,
        sessionID: "session-1",
        submissionID: expect.stringMatching(/^bag-/),
      }))
      expect(result.account).toEqual(expect.objectContaining({
        email: "dev@example.com",
        workspaceName: "Demo workspace",
      }))

      const zipPath = path.join(tempRoot, "session-bags", "staging", result.submissionID, result.filename)
      const zipContent = await readFile(zipPath)
      expect((await stat(zipPath)).size).toBe(result.sizeBytes)
      expect(createHash("sha256").update(zipContent).digest("hex")).toBe(result.sha256)
      expect(zipContent.toString("utf8")).toContain("bag-manifest.json")
      expect(zipContent.toString("utf8")).toContain("session-1")
      expect(requestAgentJSONMock).toHaveBeenCalledWith("/api/debug/sessions/session-1/trace-export")
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it("uploads a prepared session bag and removes the staging directory", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "anybox-bag-upload-"))
    try {
      requestAgentJSONMock.mockResolvedValueOnce({
        data: traceExport,
      })

      const prepared = await internal.prepareSessionBagSubmission(
        { sessionID: "session-1", projectID: "project-1", workspaceDirectory: "C:\\Projects\\Demo" },
        {
          fetchRelaySession: async () => ({
            connected: true,
            status: "connected",
            accessToken: "relay-token",
            baseURL: "https://api.anybox.test",
          }),
          now: new Date(2026, 4, 22, 9, 8, 7),
          userDataPath: tempRoot,
        },
      )
      const zipPath = path.join(tempRoot, "session-bags", "staging", prepared.submissionID, prepared.filename)
      const uploadBody = await readFile(zipPath)
      const rawDescription = ` ${"Report context ".repeat(180)} `
      const expectedDescription = rawDescription.trim().slice(0, 2000)
      const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const requestURL = String(url)
        if (requestURL === "https://api.anybox.test/api/agent/bags/init") {
          expect(init?.method).toBe("POST")
          expect(init?.headers).toMatchObject({
            authorization: "Bearer relay-token",
            "content-type": "application/json",
          })
          const initBody = JSON.parse(String(init?.body))
          expect(initBody).toMatchObject({
            kind: "session-trace",
            filename: prepared.filename,
            contentType: "application/zip",
            sizeBytes: prepared.sizeBytes,
            sha256: prepared.sha256,
            sessionID: "session-1",
            projectID: "project-1",
            description: expectedDescription,
          })
          expect(initBody.description).toHaveLength(2000)
          return new Response(JSON.stringify({
            data: {
              bagID: "bag-1",
              uploadUrl: "https://upload.anybox.test/bag-1",
              uploadHeaders: {
                "x-upload-token": "token-1",
              },
            },
          }), { status: 200 })
        }

        if (requestURL === "https://upload.anybox.test/bag-1") {
          expect(init?.method).toBe("PUT")
          expect(init?.headers).toMatchObject({
            "content-type": "application/zip",
            "x-upload-token": "token-1",
          })
          expect(Buffer.compare(Buffer.from(init?.body as Buffer), uploadBody)).toBe(0)
          return new Response(null, { status: 200 })
        }

        if (requestURL === "https://api.anybox.test/api/agent/bags/complete") {
          expect(init?.method).toBe("POST")
          expect(init?.headers).toMatchObject({
            authorization: "Bearer relay-token",
            "content-type": "application/json",
          })
          const completeBody = JSON.parse(String(init?.body))
          expect(completeBody).not.toHaveProperty("description")
          expect(completeBody).toEqual({
            bagID: "bag-1",
            sizeBytes: prepared.sizeBytes,
            sha256: prepared.sha256,
          })
          return new Response(JSON.stringify({
            data: {
              bagID: "bag-1",
              url: "https://api.anybox.test/bags/bag-1",
            },
          }), { status: 200 })
        }

        throw new Error(`unexpected request: ${requestURL}`)
      })

      await expect(internal.uploadSessionBagSubmission(
        { submissionID: prepared.submissionID, description: rawDescription },
        { fetch: fetchMock as unknown as typeof fetch },
      )).resolves.toEqual({
        bagID: "bag-1",
        url: "https://api.anybox.test/bags/bag-1",
      })

      expect(fetchMock).toHaveBeenCalledTimes(3)
      await expect(stat(zipPath)).rejects.toThrow()
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it("uploads session bags against the Anybox root when relay baseURL includes /v1", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "anybox-bag-upload-v1-"))
    try {
      requestAgentJSONMock.mockResolvedValueOnce({
        data: traceExport,
      })

      const prepared = await internal.prepareSessionBagSubmission(
        { sessionID: "session-1", projectID: "project-1", workspaceDirectory: "C:\\Projects\\Demo" },
        {
          fetchRelaySession: async () => ({
            connected: true,
            status: "connected",
            accessToken: "relay-token",
            baseURL: "https://api.anybox.test/v1",
          }),
          now: new Date(2026, 4, 22, 9, 8, 7),
          userDataPath: tempRoot,
        },
      )
      const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const requestURL = String(url)
        if (requestURL === "https://api.anybox.test/api/agent/bags/init") {
          expect(JSON.parse(String(init?.body))).not.toHaveProperty("description")
          return new Response(JSON.stringify({
            data: {
              bagID: "bag-1",
              uploadUrl: "https://upload.anybox.test/bag-1",
            },
          }), { status: 200 })
        }

        if (requestURL === "https://upload.anybox.test/bag-1") {
          return new Response(null, { status: 200 })
        }

        if (requestURL === "https://api.anybox.test/api/agent/bags/complete") {
          return new Response(JSON.stringify({
            data: {
              bagID: "bag-1",
              url: "https://api.anybox.test/bags/bag-1",
            },
          }), { status: 200 })
        }

        throw new Error(`unexpected request: ${requestURL}`)
      })

      await expect(internal.uploadSessionBagSubmission(
        { submissionID: prepared.submissionID, description: "   " },
        { fetch: fetchMock as unknown as typeof fetch },
      )).resolves.toEqual({
        bagID: "bag-1",
        url: "https://api.anybox.test/bags/bag-1",
      })
    } finally {
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it("rejects bag preparation before reading trace data when Anybox is disconnected", async () => {
    await expect(internal.prepareSessionBagSubmission(
      { sessionID: "session-1", projectID: null, workspaceDirectory: null },
      {
        fetchRelaySession: async () => ({
          connected: false,
          status: "signed-out",
          error: "Connect Anybox first.",
        }),
        userDataPath: "C:\\Temp\\Anybox",
      },
    )).rejects.toThrow("Connect Anybox first.")

    expect(requestAgentJSONMock).not.toHaveBeenCalled()
  })

  it("saves a split session trace directory when runtime arrays are missing", async () => {
    const traceWithSparseRuntime = {
      ...traceExport,
      events: [
        {
          eventID: "event-1",
          sessionID: "session-1",
          turnID: "turn-1",
          seq: 1,
          timestamp: 2,
          type: "turn.started",
          payload: {},
        },
      ],
      runtime: {
        ...traceExport.runtime,
        latestTurn: {
          turnID: "turn-1",
          status: "completed",
        },
        turns: [
          {
            turnID: "turn-1",
            status: "completed",
          },
        ],
        recentEvents: undefined,
      },
      toolCalls: [
        {
          callID: "toolcall-1",
          tool: "grep",
          status: "completed",
        },
      ],
    }
    const showOpenDialog = vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ["C:\\Exports"],
    })
    const makeDirectory = vi.fn().mockResolvedValue(undefined)
    const writeTraceFile = vi.fn().mockResolvedValue(undefined)
    requestAgentJSONMock.mockResolvedValueOnce({
      data: traceWithSparseRuntime,
    })

    await expect(internal.saveSessionTraceExportDirectory(
      { sessionID: "session-1" },
      {
        downloadsPath: "C:\\Downloads",
        showOpenDialog,
        makeDirectory,
        writeTraceFile,
      },
    )).resolves.toEqual(expect.objectContaining({
      canceled: false,
      recordCount: 1,
    }))

    const turnIndexCall = writeTraceFile.mock.calls.find((call) => toWindowsSeparators(call[0]).endsWith("\\runtime\\turns\\index.json"))
    expect(turnIndexCall?.[1]).toContain('"toolCount": 0')
    expect(turnIndexCall?.[1]).toContain('"llmCallCount": 0')
    expect(turnIndexCall?.[1]).toContain('"recentEventCount": 0')
  })

  it("does not write a trace file when the save dialog is canceled", async () => {
    const showSaveDialog = vi.fn().mockResolvedValue({
      canceled: true,
    })
    const writeTraceFile = vi.fn().mockResolvedValue(undefined)
    requestAgentJSONMock.mockResolvedValueOnce({
      data: traceExport,
    })

    await expect(internal.saveSessionTraceExport(
      { sessionID: "session-1" },
      {
        downloadsPath: "C:\\Downloads",
        showSaveDialog,
        writeTraceFile,
      },
    )).resolves.toEqual({ canceled: true })

    expect(writeTraceFile).not.toHaveBeenCalled()
  })
})

describe("ipc preview screenshot helpers", () => {
  it("captures the requested bounds and writes a marker screenshot under user data", async () => {
    const pngBuffer = Buffer.from("preview-marker")
    const capturePage = vi.fn().mockResolvedValue({
      toPNG: () => pngBuffer,
    })
    const makeDirectory = vi.fn().mockResolvedValue(undefined)
    const writeImageFile = vi.fn().mockResolvedValue(undefined)

    const result = await internal.capturePreviewScreenshotFromWindow(
      { capturePage },
      {
        bounds: {
          height: 0,
          width: 320.4,
          x: -8.2,
          y: 12.6,
        },
        url: "http://localhost:5174/page?a=1",
      },
      {
        makeDirectory,
        now: new Date("2026-05-03T01:02:03.004Z"),
        userDataPath: "C:\\Users\\codex\\AppData\\Roaming\\Desktop",
        writeImageFile,
      },
    )

    expect(capturePage).toHaveBeenCalledWith({
      height: 1,
      width: 320,
      x: 0,
      y: 13,
    })
    expect(result.path).toContain("preview-comment-screenshots")
    expect(result.path).toContain("2026-05-03T01-02-03-004Z-localhost-5174-page-a-1.png")
    expect(makeDirectory).toHaveBeenCalledWith(expect.stringContaining("preview-comment-screenshots"), {
      recursive: true,
    })
    expect(writeImageFile).toHaveBeenCalledWith(result.path, pngBuffer)
    expect(result.copiedToClipboard).toBe(false)
  })

  it("copies preview screenshots to the clipboard when requested", async () => {
    const image = {
      toPNG: () => Buffer.from("preview-marker"),
    }
    const capturePage = vi.fn().mockResolvedValue(image)
    const writeClipboardImage = vi.fn()

    const result = await internal.capturePreviewScreenshotFromWindow(
      { capturePage },
      {
        bounds: {
          height: 240,
          width: 320,
          x: 12,
          y: 40,
        },
        copyToClipboard: true,
        url: "http://localhost:5174/",
      },
      {
        makeDirectory: vi.fn().mockResolvedValue(undefined),
        userDataPath: "C:\\Users\\codex\\AppData\\Roaming\\Desktop",
        writeClipboardImage,
        writeImageFile: vi.fn().mockResolvedValue(undefined),
      },
    )

    expect(writeClipboardImage).toHaveBeenCalledWith(image)
    expect(result.copiedToClipboard).toBe(true)
  })
})

describe("ipc composer pasted image helpers", () => {
  it("copies image data URLs to the native clipboard", () => {
    const imageBuffer = Buffer.from("clipboard-image")
    const nativeImageStub = { isEmpty: () => false } as NativeImage
    const createImageFromBuffer = vi.fn(() => nativeImageStub)
    const writeClipboardImage = vi.fn()

    internal.copyImageDataUrlToClipboard(
      {
        dataUrl: `data:image/png;base64,${imageBuffer.toString("base64")}`,
        mimeType: "image/png",
      },
      {
        createImageFromBuffer,
        writeClipboardImage,
      },
    )

    expect(createImageFromBuffer).toHaveBeenCalledWith(imageBuffer)
    expect(writeClipboardImage).toHaveBeenCalledWith(nativeImageStub)
  })

  it("decodes and writes pasted composer images under user data", async () => {
    const imageBuffer = Buffer.from("clipboard-image")
    const makeDirectory = vi.fn().mockResolvedValue(undefined)
    const writeImageFile = vi.fn().mockResolvedValue(undefined)

    const result = await internal.saveComposerPastedImages(
      {
        images: [
          {
            dataUrl: `data:image/png;base64,${imageBuffer.toString("base64")}`,
            mimeType: "image/png",
            name: "screen shot.png",
          },
        ],
      },
      {
        makeDirectory,
        now: new Date("2026-05-03T01:02:03.004Z"),
        userDataPath: "C:\\Users\\codex\\AppData\\Roaming\\Desktop",
        writeImageFile,
      },
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toContain("composer-pasted-images")
    expect(result[0]).toContain("2026-05-03T01-02-03-004Z-01-screen-shot.png")
    expect(makeDirectory).toHaveBeenCalledWith(expect.stringContaining("composer-pasted-images"), {
      recursive: true,
    })
    expect(writeImageFile).toHaveBeenCalledWith(result[0], imageBuffer)
  })
})
