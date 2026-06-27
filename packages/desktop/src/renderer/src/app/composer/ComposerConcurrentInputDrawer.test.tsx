import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ComposerConcurrentInputDrawer } from "./ComposerConcurrentInputDrawer"
import type { PendingConversationInput } from "../types"

describe("ComposerConcurrentInputDrawer", () => {
  it("stays hidden until a submitted input is pending", () => {
    render(
      <ComposerConcurrentInputDrawer
        canSteer
        hasPendingPermissionRequests={false}
        isCancelling={false}
        pendingInputs={[]}
      />,
    )

    expect(screen.queryByRole("button", { name: "引导当前执行" })).toBeNull()
  })

  it("renders queued pending submissions with the steer action", () => {
    const onSteerQueuedMessage = vi.fn()
    const queuedInput: PendingConversationInput = {
      id: "input-queued",
      sessionID: "session-1",
      text: "Queued request",
      mode: "queued",
      status: "pending",
      createdAt: 1,
    }

    render(
      <ComposerConcurrentInputDrawer
        canSteer
        hasPendingPermissionRequests={false}
        isCancelling={false}
        pendingInputs={[queuedInput]}
        onSteerQueuedMessage={onSteerQueuedMessage}
      />,
    )

    expect(screen.getByText("Queued request")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "引导当前执行" }))

    expect(onSteerQueuedMessage).toHaveBeenCalledWith(queuedInput)
  })

  it("renders pending steer submissions with a waiting note", () => {
    const steerInput: PendingConversationInput = {
      id: "input-steer",
      sessionID: "session-1",
      text: "Adjust current execution",
      mode: "steer",
      status: "pending",
      targetAssistantThreadMessageID: "assistant-active",
      afterItemCount: 1,
      createdAt: 2,
    }

    render(
      <ComposerConcurrentInputDrawer
        canSteer
        hasPendingPermissionRequests={false}
        isCancelling={false}
        pendingInputs={[steerInput]}
      />,
    )

    expect(screen.getByText("Adjust current execution")).toBeInTheDocument()
    expect(screen.getByText("将在当前执行到达安全边界后继续")).toBeInTheDocument()
  })

  it("renders steer submissions without insertion metadata with a waiting note", () => {
    const steerInput: PendingConversationInput = {
      id: "input-steer",
      sessionID: "session-1",
      text: "Adjust during tool input",
      mode: "steer",
      status: "pending",
      createdAt: 2,
    }

    render(
      <ComposerConcurrentInputDrawer
        canSteer
        hasPendingPermissionRequests={false}
        isCancelling={false}
        pendingInputs={[steerInput]}
      />,
    )

    expect(screen.getByText("Adjust during tool input")).toBeInTheDocument()
    expect(screen.getByText("将在当前执行到达安全边界后继续")).toBeInTheDocument()
  })
})
