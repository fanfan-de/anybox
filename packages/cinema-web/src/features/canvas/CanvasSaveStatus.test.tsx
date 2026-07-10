/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CanvasSaveStatus } from "./CanvasSaveStatus"

afterEach(cleanup)

describe("CanvasSaveStatus", () => {
  it("exposes save failures and a keyboard-accessible retry action", () => {
    const retry = vi.fn()
    render(
      <CanvasSaveStatus
        state="error"
        error="Agent is offline"
        pendingCount={1}
        onRetry={retry}
      />,
    )

    expect(screen.getByRole("status")).toHaveTextContent("保存失败")
    expect(screen.getByRole("status")).toHaveAttribute("title", "Agent is offline")
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it("shows the number of commands waiting for acknowledgement", () => {
    render(
      <CanvasSaveStatus
        state="saving"
        error={null}
        pendingCount={3}
        onRetry={() => undefined}
      />,
    )

    expect(screen.getByRole("status")).toHaveTextContent("正在保存 3 项")
    expect(screen.queryByRole("button", { name: "重试保存" })).not.toBeInTheDocument()
  })
})
