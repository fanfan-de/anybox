import { StrictMode, useCallback, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { I18nProvider } from "../src/renderer/src/app/i18n/I18nProvider"
import { ThreadView, type ThreadScrollSnapshot } from "../src/renderer/src/app/thread/ThreadView"
import {
  DEFAULT_ASSISTANT_TRACE_VISIBILITY,
  type AssistantThreadMessage,
  type SessionSummary,
  type ThreadMessage,
  type ThreadTurn,
  type UserThreadMessage,
} from "../src/renderer/src/app/types"
import "../src/renderer/src/styles/index.css"
import "./thread-execution-harness.css"

const TARGET_TURN_ID = "turn-e2e"
const TARGET_MESSAGE_ID = "assistant-e2e"

const session: SessionSummary = {
  id: "session-e2e",
  title: "Execution disclosure E2E",
  branch: "main",
  status: "Live",
  updated: 1,
  focus: "",
  summary: "",
}

function userMessage(id: string, text: string, timestamp: number): UserThreadMessage {
  return {
    id,
    kind: "user",
    text,
    timestamp,
  }
}

function targetAssistantMessage(completed: boolean): AssistantThreadMessage {
  const terminalStatus = completed ? "completed" : "running"
  const items: AssistantThreadMessage["items"] = [
    {
      id: "process-reasoning",
      kind: "reasoning",
      timestamp: 1_010,
      label: "Reasoning",
      text: "Inspecting the renderer before applying the final response.",
      status: terminalStatus,
    },
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `process-tool-${index + 1}`,
      kind: "tool" as const,
      timestamp: 1_020 + index,
      label: "Tool",
      title: `process-tool-${index + 1}`,
      detail: `Tool output ${index + 1}`,
      status: terminalStatus,
    })),
    {
      id: "target-final-response",
      kind: "text",
      timestamp: 2_000,
      label: "Assistant",
      text: "E2E final response remains visible.",
      status: terminalStatus,
      isStreaming: !completed,
    },
  ]

  return {
    id: TARGET_MESSAGE_ID,
    kind: "assistant",
    backendTurnID: TARGET_TURN_ID,
    segmentID: "segment-e2e",
    timestamp: 1_000,
    runtime: {
      phase: completed ? "completed" : "responding",
      startedAt: 1_000,
      updatedAt: completed ? 845_000 : 2_000,
    },
    state: completed ? "completed" : "responding",
    items,
    isStreaming: !completed,
  }
}

function targetTurn(user: UserThreadMessage, assistant: AssistantThreadMessage, completed: boolean): ThreadTurn {
  return {
    turnID: TARGET_TURN_ID,
    status: completed ? "completed" : "running",
    startedAt: 1_000,
    updatedAt: completed ? 845_000 : 2_000,
    completedAt: completed ? 845_000 : undefined,
    userMessageID: user.id,
    lastMessageID: assistant.id,
    finalSegmentID: assistant.segmentID,
    messages: [user, assistant],
  }
}

function trailingTurn(index: number) {
  const timestamp = 10_000 + index * 10
  const turnID = `tail-turn-${index}`
  const user = userMessage(`tail-user-${index}`, `Tail request ${index}`, timestamp)
  const assistant: AssistantThreadMessage = {
    id: `tail-assistant-${index}`,
    kind: "assistant",
    backendTurnID: turnID,
    segmentID: `tail-segment-${index}`,
    timestamp: timestamp + 1,
    runtime: {
      phase: "completed",
      startedAt: timestamp,
      updatedAt: timestamp + 2,
    },
    state: "completed",
    items: [
      {
        id: `tail-response-${index}`,
        kind: "text",
        timestamp: timestamp + 2,
        label: "Assistant",
        text: `Tail response ${index}`,
        status: "completed",
      },
    ],
    isStreaming: false,
  }
  const turn: ThreadTurn = {
    turnID,
    status: "completed",
    startedAt: timestamp,
    updatedAt: timestamp + 2,
    completedAt: timestamp + 2,
    userMessageID: user.id,
    lastMessageID: assistant.id,
    finalSegmentID: assistant.segmentID,
    messages: [user, assistant],
  }
  return { messages: [user, assistant] satisfies ThreadMessage[], turn }
}

function Harness() {
  const [completed, setCompleted] = useState(false)
  const threadColumnRef = useRef<HTMLDivElement | null>(null)
  const scrollSnapshotRef = useRef<ThreadScrollSnapshot>({
    scrollTop: 0,
    pinnedToBottom: false,
    updatedAt: Date.now(),
  })
  const readScrollSnapshot = useCallback(() => scrollSnapshotRef.current, [])
  const saveScrollSnapshot = useCallback((_key: string, snapshot: ThreadScrollSnapshot) => {
    scrollSnapshotRef.current = snapshot
  }, [])
  const targetUser = useMemo(
    () => userMessage("user-e2e", "Run a long renderer inspection", 1_000),
    [],
  )
  const tails = useMemo(() => Array.from({ length: 36 }, (_, index) => trailingTurn(index + 1)), [])
  const targetAssistant = useMemo(() => targetAssistantMessage(completed), [completed])
  const activeMessages = useMemo(
    () => [targetUser, targetAssistant, ...tails.flatMap((tail) => tail.messages)],
    [tails, targetAssistant, targetUser],
  )
  const activeTurns = useMemo(
    () => [targetTurn(targetUser, targetAssistant, completed), ...tails.map((tail) => tail.turn)],
    [completed, tails, targetAssistant, targetUser],
  )

  return (
    <main className="thread-e2e-harness" data-completed={completed ? "true" : "false"}>
      <div className="thread-e2e-controls">
        <button id="complete-turn" type="button" disabled={completed} onClick={() => setCompleted(true)}>
          Complete target turn
        </button>
      </div>
      <div className="thread-e2e-host">
        <ThreadView
          activeSession={session}
          activeMessages={activeMessages}
          activeTurns={activeTurns}
          assistantTraceVisibility={DEFAULT_ASSISTANT_TRACE_VISIBILITY}
          isResolvingPermissionRequest={false}
          isSessionRunning={!completed}
          pendingPermissionRequests={[]}
          permissionRequestActionError={null}
          permissionRequestActionRequestID={null}
          readScrollSnapshot={readScrollSnapshot}
          saveScrollSnapshot={saveScrollSnapshot}
          scrollStateKey="thread-execution-e2e"
          showTurnNavigator={false}
          sideChatCountsByAnchorMessageID={{}}
          threadColumnRef={threadColumnRef}
          onAskUserQuestionAnswer={() => undefined}
          onPermissionRequestResponse={() => undefined}
        />
      </div>
    </main>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <Harness />
    </I18nProvider>
  </StrictMode>,
)
