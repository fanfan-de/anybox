import { StrictMode, useCallback, useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { I18nProvider } from "../src/renderer/src/app/i18n/I18nProvider"
import { ThreadView, type ThreadScrollSnapshot } from "../src/renderer/src/app/thread/ThreadView"
import {
  bindPendingThreadTurnToCanonical,
  deriveActiveMessages,
  reconcileThreadTurns,
} from "../src/renderer/src/app/thread-turn-state"
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
const SECOND_TARGET_MESSAGE_ID = "assistant-e2e-second"
const QUESTION_TURN_ID = "turn-question-e2e"
const PENDING_TURN_ID = "pending:user-e2e"
const INITIAL_REASONING_TEXT = "Inspecting the renderer before applying the final response."
const SECOND_REASONING_LINE = "Checking the compact reasoning viewport on a second line."
const SHOW_QUESTION_SCENARIO = new URLSearchParams(window.location.search).has("questions")
const WRAPPED_REASONING_TAIL = [
  "This deliberately long live reasoning sentence verifies that the browser wraps text at the real pane width",
  "and advances the one-line viewport without increasing the outer reasoning row height.",
  "LIVE_REASONING_WRAP_TAIL",
].join(" ")

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

function targetAssistantMessage(completed: boolean, reasoningText: string): AssistantThreadMessage {
  const terminalStatus = completed ? "completed" : "running"
  const items: AssistantThreadMessage["items"] = [
    {
      id: "process-reasoning",
      kind: "reasoning",
      timestamp: 1_010,
      label: "Reasoning",
      text: reasoningText,
      status: terminalStatus,
      isStreaming: !completed,
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
      id: "target-intermediate-response",
      kind: "text",
      timestamp: 2_000,
      label: "Assistant",
      text: "The first execution segment has finished; continuing with the canonical segment.",
      status: terminalStatus,
      isStreaming: !completed,
    },
  ]

  return {
    id: TARGET_MESSAGE_ID,
    kind: "assistant",
    backendTurnID: PENDING_TURN_ID,
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

function targetSecondAssistantMessage(completed: boolean): AssistantThreadMessage {
  const terminalStatus = completed ? "completed" : "running"

  return {
    id: SECOND_TARGET_MESSAGE_ID,
    kind: "assistant",
    backendTurnID: TARGET_TURN_ID,
    segmentID: "segment-e2e-second",
    timestamp: 2_100,
    runtime: {
      phase: completed ? "completed" : "responding",
      startedAt: 2_100,
      updatedAt: completed ? 845_000 : 3_000,
    },
    state: completed ? "completed" : "responding",
    items: [
      {
        id: "process-second-reasoning",
        kind: "reasoning",
        timestamp: 2_110,
        label: "Reasoning",
        text: "The canonical reservation continues the same backend turn in a second assistant segment.",
        status: terminalStatus,
      },
      {
        id: "process-second-tool",
        kind: "tool",
        timestamp: 2_120,
        label: "Tool",
        title: "process-second-tool",
        detail: "Second-segment tool output",
        status: terminalStatus,
      },
      {
        id: "target-final-response",
        kind: "text",
        timestamp: 3_000,
        label: "Assistant",
        text: "E2E final response remains visible.",
        status: terminalStatus,
        isStreaming: !completed,
      },
    ],
    isStreaming: !completed,
  }
}

function targetTurn(user: UserThreadMessage, assistant: AssistantThreadMessage, completed: boolean): ThreadTurn {
  return {
    turnID: PENDING_TURN_ID,
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

function canonicalTargetTurn(assistant: AssistantThreadMessage, completed: boolean): ThreadTurn {
  return {
    turnID: TARGET_TURN_ID,
    status: completed ? "completed" : "running",
    startedAt: 2_100,
    updatedAt: completed ? 845_000 : 3_000,
    completedAt: completed ? 845_000 : undefined,
    lastMessageID: assistant.id,
    finalSegmentID: assistant.segmentID,
    messages: [assistant],
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

function questionTurn() {
  const timestamp = 20_000
  const user = userMessage("question-user-e2e", "Confirm the final release review scope", timestamp)
  const assistant: AssistantThreadMessage = {
    id: "assistant-question-e2e",
    kind: "assistant",
    backendTurnID: QUESTION_TURN_ID,
    segmentID: "segment-question-e2e",
    timestamp: timestamp + 1,
    runtime: {
      phase: "blocked",
      startedAt: timestamp,
      updatedAt: timestamp + 2,
    },
    state: "blocked",
    items: [
      {
        id: "question-process-reasoning-1",
        kind: "reasoning",
        timestamp: timestamp + 1,
        label: "Reasoning",
        text: "Reviewing the first answered interaction before continuing.",
        status: "completed",
      },
      {
        id: "question-process-reasoning-2",
        kind: "reasoning",
        timestamp: timestamp + 1,
        label: "Reasoning",
        text: "Checking whether answered question cards join the processing disclosure.",
        status: "completed",
      },
      {
        id: "answered-question-e2e",
        kind: "question",
        timestamp: timestamp + 2,
        label: "Question",
        title: "Release scope",
        status: "completed",
        questionPrompt: {
          questionID: "que_answered_e2e",
          header: "Release scope",
          question: "Which parts should be included in the release review before the deployment proceeds?",
          options: [
            {
              label: "Implementation and regression coverage",
              value: "implementation",
              description: "Review the desktop UI behavior, automated tests, and relevant documentation.",
            },
            {
              label: "Mobile release",
              value: "mobile",
              description: "Review the independently shipped mobile application.",
            },
          ],
          allowFreeform: true,
          multiple: true,
          required: true,
          answered: true,
          answerText: "Also verify long text wrapping in narrow panes and keyboard submission behavior.",
          selectedOptions: ["implementation", "legacy-review-value"],
          freeformText: "Also verify long text wrapping in narrow panes and keyboard submission behavior.",
        },
      },
      {
        id: "pending-question-e2e",
        kind: "question",
        timestamp: timestamp + 3,
        label: "Question",
        title: "Keyboard check",
        status: "pending",
        questionPrompt: {
          questionID: "que_pending_e2e",
          header: "Keyboard check",
          question: "What final keyboard behavior should be verified?",
          options: [],
          allowFreeform: true,
          multiple: false,
          required: true,
        },
      },
    ],
    isStreaming: false,
  }
  const turn: ThreadTurn = {
    turnID: QUESTION_TURN_ID,
    status: "blocked",
    startedAt: timestamp,
    updatedAt: timestamp + 3,
    userMessageID: user.id,
    lastMessageID: assistant.id,
    finalSegmentID: assistant.segmentID,
    messages: [user, assistant],
  }
  return { messages: [user, assistant] satisfies ThreadMessage[], turn }
}

function Harness() {
  const [canonicalized, setCanonicalized] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [reasoningText, setReasoningText] = useState(INITIAL_REASONING_TEXT)
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
  const questions = useMemo(() => questionTurn(), [])
  const targetAssistant = useMemo(
    () => targetAssistantMessage(completed, reasoningText),
    [completed, reasoningText],
  )
  const secondTargetAssistant = useMemo(() => targetSecondAssistantMessage(completed), [completed])
  const targetTurns = useMemo(() => {
    const pendingTurn = targetTurn(targetUser, targetAssistant, completed)
    if (!canonicalized) return [pendingTurn]

    const splitTurns = [
      pendingTurn,
      canonicalTargetTurn(secondTargetAssistant, completed),
    ]
    return reconcileThreadTurns(bindPendingThreadTurnToCanonical(splitTurns, {
      turnID: TARGET_TURN_ID,
      assistantThreadMessageID: targetAssistant.id,
      optimisticUserMessageID: targetUser.id,
    }))
  }, [canonicalized, completed, secondTargetAssistant, targetAssistant, targetUser])
  const activeTurns = useMemo(
    () => [
      ...targetTurns,
      ...tails.map((tail) => tail.turn),
      ...(SHOW_QUESTION_SCENARIO ? [questions.turn] : []),
    ],
    [questions, tails, targetTurns],
  )
  const activeMessages = useMemo(() => deriveActiveMessages(activeTurns), [activeTurns])
  const targetAssistantCount = targetTurns.reduce(
    (count, turn) => count + turn.messages.filter((message) => message.kind === "assistant").length,
    0,
  )

  return (
    <main
      className="thread-e2e-harness"
      data-completed={completed ? "true" : "false"}
      data-target-assistant-count={targetAssistantCount}
      data-target-turn-count={targetTurns.length}
    >
      <div className="thread-e2e-controls">
        <button
          id="canonicalize-turn"
          type="button"
          disabled={canonicalized}
          onClick={() => setCanonicalized(true)}
        >
          Canonicalize target turn
        </button>
        <button id="complete-turn" type="button" disabled={completed} onClick={() => setCompleted(true)}>
          Complete target turn
        </button>
        <button
          id="append-reasoning-line"
          type="button"
          disabled={completed || reasoningText.includes(SECOND_REASONING_LINE)}
          onClick={() => setReasoningText((current) => `${current}\n${SECOND_REASONING_LINE}`)}
        >
          Line
        </button>
        <button
          id="append-reasoning-wrap"
          type="button"
          disabled={completed || reasoningText.includes("LIVE_REASONING_WRAP_TAIL")}
          onClick={() => setReasoningText((current) => `${current}\n${WRAPPED_REASONING_TAIL}`)}
        >
          Wrap
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
