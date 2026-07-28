import { useState } from "react"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DesktopIpcOutput } from "../../../../shared/desktop-ipc-contract"
import { createConversationStore, type ConversationStoreApi } from "../agent-workspace/conversation-store"
import { I18nProvider } from "../i18n/I18nProvider"
import type { AssistantThreadMessage, ThreadTurn, UserThreadMessage } from "../types"
import {
  SessionBagSubmissionDialog,
  resolveWorkbenchPaneNavigationRequest,
  useWorkbenchPaneConversationSnapshot,
} from "./WorkbenchPaneSurface"

type SessionBagPrepareResult = DesktopIpcOutput<"desktop:prepare-session-bag-submission">

describe("resolveWorkbenchPaneNavigationRequest", () => {
  const request = {
    messageID: "assistant-2",
    paneID: "pane-2",
    requestID: 1,
  }

  it("isolates pane-targeted message navigation while preserving legacy requests", () => {
    expect(resolveWorkbenchPaneNavigationRequest(
      "pane-2",
      "session-1",
      { "session-1": request },
    )).toBe(request)
    expect(resolveWorkbenchPaneNavigationRequest(
      "pane-1",
      "session-1",
      { "session-1": request },
    )).toBeNull()

    const legacyRequest = { requestID: 2, turnID: "turn-2" }
    expect(resolveWorkbenchPaneNavigationRequest(
      "pane-1",
      "session-1",
      { "session-1": legacyRequest },
    )).toBe(legacyRequest)
  })
})

const prepare: SessionBagPrepareResult = {
  account: {
    email: "dev@example.com",
    workspaceName: "Anybox Admin",
    planLabel: "Pro",
  },
  baseURL: "https://api.anybox.test",
  filename: "anybox-bag-session-1-20260619-180614.zip",
  fileCount: 45,
  generatedAt: "2026-06-19T10:06:14.000Z",
  projectID: "project-1",
  recordCount: 29,
  redaction: {
    enabled: true,
    maxStringLength: 20000,
    redactedKeyPattern: "apiKey|token|secret|authorization",
  },
  sessionID: "session-1",
  sha256: "sha256",
  sizeBytes: 159500,
  submissionID: "bag-1",
}

function renderSessionBagDialog({
  initialDescription = "",
  onCancel = vi.fn(),
  onClose = vi.fn(),
  onSubmit = vi.fn(),
  state = { stage: "confirm", prepare } as const,
}: Partial<Parameters<typeof SessionBagSubmissionDialog>[0]> & {
  initialDescription?: string
} = {}) {
  function Harness() {
    const [description, setDescription] = useState(initialDescription)

    return (
      <I18nProvider>
        <SessionBagSubmissionDialog
          description={description}
          state={state}
          onDescriptionChange={setDescription}
          onCancel={onCancel}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      </I18nProvider>
    )
  }

  return render(<Harness />)
}

function userMessage(id: string): UserThreadMessage {
  return {
    id,
    kind: "user",
    text: "Prompt",
    timestamp: 1,
  }
}

function assistantMessage(id: string): AssistantThreadMessage {
  return {
    backendTurnID: "turn-canonical",
    id,
    items: [],
    kind: "assistant",
    runtime: {
      phase: "responding",
      startedAt: 2,
      updatedAt: 3,
    },
    segmentID: "segment-canonical",
    state: "responding",
    timestamp: 2,
  }
}

function ConversationSnapshotProbe({
  store,
}: {
  store: ConversationStoreApi
}) {
  const { activeMessages, activeTurns } = useWorkbenchPaneConversationSnapshot(store, "session-1")
  const flattenedMessages = activeTurns.flatMap((turn) => turn.messages)
  const sharesTurnMessages = activeMessages.length === flattenedMessages.length &&
    activeMessages.every((message, index) => Object.is(message, flattenedMessages[index]))

  return (
    <output
      data-testid="conversation-snapshot"
      data-message-ids={activeMessages.map((message) => message.id).join(",")}
      data-shares-turn-messages={String(sharesTurnMessages)}
      data-turn-ids={activeTurns.map((turn) => turn.turnID).join(",")}
    />
  )
}

describe("WorkbenchPaneSurface conversation snapshot", () => {
  it("reacts to canonical turn updates and derives messages from the same turns snapshot", () => {
    const user = userMessage("user-1")
    const baseStore = createConversationStore({ "session-1": [user] })
    const staleMessagesGetter = vi.fn(() => [user])
    const store: ConversationStoreApi = {
      ...baseStore,
      getSessionMessages: staleMessagesGetter,
    }

    render(<ConversationSnapshotProbe store={store} />)

    expect(screen.getByTestId("conversation-snapshot")).toHaveAttribute(
      "data-message-ids",
      "user-1",
    )

    const assistant = assistantMessage("assistant-1")
    const canonicalTurn: ThreadTurn = {
      messages: [user, assistant],
      startedAt: 1,
      status: "running",
      turnID: "turn-canonical",
      updatedAt: 3,
      userMessageID: user.id,
    }
    act(() => {
      baseStore.replaceTurns({ "session-1": [canonicalTurn] })
    })

    expect(screen.getByTestId("conversation-snapshot")).toHaveAttribute(
      "data-turn-ids",
      "turn-canonical",
    )
    expect(screen.getByTestId("conversation-snapshot")).toHaveAttribute(
      "data-message-ids",
      "user-1,assistant-1",
    )
    expect(screen.getByTestId("conversation-snapshot")).toHaveAttribute(
      "data-shares-turn-messages",
      "true",
    )
    expect(staleMessagesGetter).not.toHaveBeenCalled()
  })
})

describe("SessionBagSubmissionDialog", () => {
  beforeEach(() => {
    window.localStorage.setItem("desktop.locale", "en-US")
  })

  it("edits the optional problem description and enforces the 2000 character limit", () => {
    const onSubmit = vi.fn()
    renderSessionBagDialog({ onSubmit })

    const dialog = screen.getByRole("dialog", { name: "Submit diagnostic report" })
    const description = within(dialog).getByRole("textbox", {
      name: "Problem description (optional)",
    })

    expect(description).toHaveValue("")
    expect(within(dialog).getByText("0 / 2000 chars")).toBeInTheDocument()

    const longDescription = "The app stopped after submitting a prompt. ".repeat(60)
    fireEvent.change(description, { target: { value: longDescription } })

    expect(description).toHaveValue(longDescription.slice(0, 2000))
    expect(within(dialog).getByText("2000 / 2000 chars")).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole("button", { name: "Submit report" }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("keeps the problem description editable while retrying after an upload error", () => {
    renderSessionBagDialog({
      initialDescription: "The terminal panel froze.",
      state: {
        stage: "error",
        prepare,
        message: "Upload failed.",
      },
    })

    const description = screen.getByRole("textbox", {
      name: "Problem description (optional)",
    })
    expect(description).toBeEnabled()
    expect(description).toHaveValue("The terminal panel froze.")
  })

  it("disables the problem description while uploading and hides it after success", () => {
    const { rerender } = renderSessionBagDialog({
      initialDescription: "The model selector disappeared.",
      state: {
        stage: "uploading",
        prepare,
      },
    })

    expect(screen.getByRole("textbox", { name: "Problem description (optional)" })).toBeDisabled()

    function SuccessHarness() {
      return (
        <I18nProvider>
          <SessionBagSubmissionDialog
            description="The model selector disappeared."
            state={{
              stage: "success",
              prepare,
              result: {
                bagID: "bag-1",
                url: "https://api.anybox.test/bags/bag-1",
              },
            }}
            onDescriptionChange={vi.fn()}
            onCancel={vi.fn()}
            onClose={vi.fn()}
            onSubmit={vi.fn()}
          />
        </I18nProvider>
      )
    }

    rerender(<SuccessHarness />)
    expect(screen.queryByRole("textbox", { name: "Problem description (optional)" })).toBeNull()
  })
})
