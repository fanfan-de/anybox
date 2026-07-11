/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CanvasSaveStatus } from "./CanvasSaveStatus"
import { I18nProvider } from "../../i18n"

afterEach(cleanup)

describe("CanvasSaveStatus", () => {
  it("exposes save failures and a keyboard-accessible retry action", () => {
    const retry = vi.fn()
    render(
      <I18nProvider locale="zh-CN"><CanvasSaveStatus
        state="error"
        error="Agent is offline"
        pendingCount={1}
        onRetry={retry}
      /></I18nProvider>,
    )

    expect(screen.getByRole("status")).toHaveTextContent("保存失败")
    expect(screen.getByRole("status")).toHaveAttribute("title", "Agent is offline")
    fireEvent.click(screen.getByRole("button", { name: "重试保存" }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it("shows the number of commands waiting for acknowledgement", () => {
    render(
      <I18nProvider locale="zh-CN"><CanvasSaveStatus
        state="saving"
        error={null}
        pendingCount={3}
        onRetry={() => undefined}
      /></I18nProvider>,
    )

    expect(screen.getByRole("status")).toHaveTextContent("正在保存 3 项")
    expect(screen.queryByRole("button", { name: "重试保存" })).not.toBeInTheDocument()
  })
})
