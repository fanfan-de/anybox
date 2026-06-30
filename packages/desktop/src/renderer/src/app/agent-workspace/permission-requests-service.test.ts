import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentSessionBridge } from "../agent-session/client"
import { getAgentSessionBridge } from "../agent-session/client"
import type { PendingAgentStream, PermissionRequest } from "../types"
import { respondPermissionRequest } from "./permission-requests-service"

vi.mock("../agent-session/client", () => ({
  getAgentSessionBridge: vi.fn(),
}))

function createPermissionRequest(): PermissionRequest {
  return {
    id: "permission-1",
    approvalID: "approval-1",
    sessionID: "backend-session-1",
    messageID: "assistant-approval",
    toolCallID: "tool-call-1",
    projectID: "project-1",
    agent: "default",
    status: "pending",
    createdAt: 1,
    prompt: {
      title: "Check Node.js and npm availability",
      summary: "Run a Git Bash command in C:/Projects/Anybox.",
      rationale: "Tool requires approval before it can continue.",
      risk: "high",
      detailsAvailable: true,
      details: {
        command: "node --version && npm --version",
        workdir: "C:/Projects/Anybox",
      },
      allowedDecisions: ["deny", "allow"],
      recommendedDecision: "allow",
    },
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

function setupPermissionResponseTest(options: { canResumeStream?: boolean } = {}) {
  const request = createPermissionRequest()
  let pendingPermissionRequestsBySession: Record<string, PermissionRequest[]> = {
    "session-1": [request],
  }
  const respondPermissionRequestMock = vi.fn()
  vi.mocked(getAgentSessionBridge).mockReturnValue({
    canResumeStream: options.canResumeStream ?? false,
    canStream: true,
    loadHistory: vi.fn(),
    sendTurn: vi.fn(),
    resumeTurn: vi.fn(),
    cancelTurn: vi.fn(),
    abortTurn: vi.fn(),
    interrupt: vi.fn(),
    answerQuestion: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    loadPermissionRequests: vi.fn(),
    respondPermissionRequest: respondPermissionRequestMock,
    onEvent: vi.fn(),
  } as unknown as AgentSessionBridge)

  const setPendingPermissionRequestsBySession = vi.fn((update) => {
    pendingPermissionRequestsBySession = typeof update === "function"
      ? update(pendingPermissionRequestsBySession)
      : update
  })

  const input = {
    appendConversationMessages: vi.fn(),
    input: {
      decision: "allow" as const,
      request,
      sessionID: "session-1",
    },
    loadPendingPermissionRequestsForSession: vi.fn(async () => undefined),
    loadSessionDiffForSession: vi.fn(async () => undefined),
    loadSessionRuntimeDebugForSession: vi.fn(async () => undefined),
    pendingStreamsRef: { current: {} },
    permissionRequestActionRequestID: null,
    permissionRequestsRequestRef: { current: {} },
    refreshWorkspaceForSession: vi.fn(),
    reloadSessionHistoryForSession: vi.fn(async () => undefined),
    setPendingPermissionRequestsBySession,
    setPermissionRequestActionError: vi.fn(),
    setPermissionRequestActionRequestID: vi.fn(),
    updateAssistantConversationMessage: vi.fn(),
  }

  return {
    getPendingPermissionRequestsBySession: () => pendingPermissionRequestsBySession,
    input,
    request,
    respondPermissionRequestMock,
    setPendingPermissionRequestsBySession,
  }
}

describe("permission requests service", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("keeps the pending permission request visible while a response is applying", async () => {
    const setup = setupPermissionResponseTest()
    const deferredResponse = createDeferred<Awaited<ReturnType<AgentSessionBridge["respondPermissionRequest"]>>>()
    setup.respondPermissionRequestMock.mockReturnValue(deferredResponse.promise)

    const responsePromise = respondPermissionRequest(setup.input)
    await Promise.resolve()

    expect(setup.getPendingPermissionRequestsBySession()["session-1"]).toEqual([setup.request])
    expect(setup.setPendingPermissionRequestsBySession).not.toHaveBeenCalled()

    deferredResponse.resolve({})
    await responsePromise

    expect(setup.getPendingPermissionRequestsBySession()["session-1"]).toEqual([])
    expect(setup.setPendingPermissionRequestsBySession).toHaveBeenCalledTimes(1)
  })

  it("keeps the pending permission request when a response fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const setup = setupPermissionResponseTest()
    setup.respondPermissionRequestMock.mockRejectedValue(new Error("Approval failed"))

    await respondPermissionRequest(setup.input)

    expect(setup.getPendingPermissionRequestsBySession()["session-1"]).toEqual([setup.request])
    expect(setup.setPendingPermissionRequestsBySession).not.toHaveBeenCalled()
    expect(setup.input.setPermissionRequestActionError).toHaveBeenCalledWith("Approval failed")

  })

  it("creates an unbound stream placeholder when resuming after approval", async () => {
    const setup = setupPermissionResponseTest({ canResumeStream: true })
    setup.respondPermissionRequestMock.mockResolvedValue({})

    await respondPermissionRequest(setup.input)

    expect(setup.respondPermissionRequestMock).toHaveBeenCalledWith({
      requestID: "permission-1",
      decision: "allow",
      note: undefined,
      resume: false,
    })
    expect(setup.input.appendConversationMessages).toHaveBeenCalledTimes(1)
    const [[sessionID, messages]] = setup.input.appendConversationMessages.mock.calls
    expect(sessionID).toBe("session-1")
    expect(messages).toHaveLength(1)
    const streamingMessage = messages[0]
    expect(streamingMessage.kind).toBe("assistant")
    if (streamingMessage.kind !== "assistant") return
    expect(streamingMessage.messageID).toBeUndefined()
    expect(streamingMessage.segmentID).toBe(streamingMessage.id)

    const pendingStream = Object.values(setup.input.pendingStreamsRef.current as Record<string, PendingAgentStream>)[0]
    expect(pendingStream).toMatchObject({
      sessionID: "session-1",
      backendSessionID: "backend-session-1",
      assistantThreadMessageID: streamingMessage.id,
      requestedMode: "new-turn",
      createdAssistantThreadMessageID: streamingMessage.id,
    })
    expect(pendingStream?.backendTurnID).toBeUndefined()
  })
})
