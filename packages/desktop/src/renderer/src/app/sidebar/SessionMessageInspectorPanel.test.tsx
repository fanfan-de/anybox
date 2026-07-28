import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import type { SessionMessageTree } from "../session-message-tree"
import { SessionMessageInspectorPanel } from "./SessionMessageInspectorPanel"

function createMessageTree(): SessionMessageTree {
  return {
    activeMessageID: "assistant-1",
    activePathMessageIDs: ["user-1", "assistant-1"],
    branchOptionsByParentID: {},
    childIDsByParentID: {
      "user-1": ["assistant-1", "assistant-2"],
    },
    nodesByID: {
      "user-1": {
        content: "How should this work?",
        created: 1,
        id: "user-1",
        parentMessageID: null,
        preview: "How should this work?",
        role: "user",
        sessionID: "session-1",
      },
      "assistant-1": {
        content: "Use the active response.",
        created: 2,
        id: "assistant-1",
        parentMessageID: "user-1",
        preview: "Active response",
        role: "assistant",
        sessionID: "session-1",
      },
      "assistant-2": {
        content: "Use the alternative response.",
        created: 3,
        id: "assistant-2",
        parentMessageID: "user-1",
        preview: "Alternative response",
        role: "assistant",
        sessionID: "session-1",
      },
    },
    rootMessageIDs: ["user-1"],
    sessionID: "session-1",
  }
}

describe("SessionMessageInspectorPanel", () => {
  it("pairs an inspected assistant response with its user prompt", () => {
    render(
      <SessionMessageInspectorPanel
        messageID="assistant-2"
        messageTree={createMessageTree()}
      />,
    )

    expect(screen.getByRole("heading", { name: "Alternative response" })).toBeInTheDocument()
    expect(screen.getByText("How should this work?")).toBeInTheDocument()
    expect(screen.getByText("Use the alternative response.")).toBeInTheDocument()
    expect(screen.queryByText("Use the active response.")).not.toBeInTheDocument()
  })

  it("shows the active response for a user node and allows inspecting a sibling response", () => {
    render(
      <SessionMessageInspectorPanel
        messageID="user-1"
        messageTree={createMessageTree()}
      />,
    )

    expect(screen.getByText("Use the active response.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Active response/ })).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(screen.getByRole("button", { name: /Alternative response/ }))

    expect(screen.getByText("Use the alternative response.")).toBeInTheDocument()
    expect(screen.queryByText("Use the active response.")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Alternative response/ })).toHaveAttribute("aria-pressed", "true")
  })
})
