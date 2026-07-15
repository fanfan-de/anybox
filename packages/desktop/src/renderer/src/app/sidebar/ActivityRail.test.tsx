import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ActivityRail } from "./ActivityRail"

function renderActivityRail() {
  const props = {
    activeView: "workspace" as const,
    isSettingsOpen: false,
    isSidebarCollapsed: false,
    onOpenSettings: vi.fn(),
    onToggleSidebar: vi.fn(),
    onViewChange: vi.fn(),
    side: "left" as const,
  }

  return {
    ...render(<ActivityRail {...props} />),
    props,
  }
}

describe("ActivityRail", () => {
  it("uses the square chart Gantt icon for the workspace entry", () => {
    renderActivityRail()

    const workspaceButton = screen.getByRole("button", { name: "Open workspace" })
    expect(workspaceButton.querySelector(".lucide-square-chart-gantt")).not.toBeNull()
  })

  it("uses the plug icon for the connections and extensions entry", () => {
    renderActivityRail()

    const connectionsButton = screen.getByRole("button", { name: "Open connections and extensions" })
    expect(connectionsButton.querySelector(".lucide-plug")).not.toBeNull()
  })

  it("uses the calendar icon for the calendar entry", () => {
    renderActivityRail()

    const calendarButton = screen.getByRole("button", { name: "Open calendar" })
    expect(calendarButton.querySelector(".lucide-calendar")).not.toBeNull()
    expect(calendarButton.querySelector(".lucide-calendar-days")).toBeNull()
  })

  it("places mobile as a primary rail entry after connections", () => {
    const { props } = renderActivityRail()
    const rail = screen.getByLabelText("Primary navigation rail")
    const primaryStack = within(rail).getByLabelText("Primary views")
    const buttons = within(primaryStack).getAllByRole("button")

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Open workspace",
      "Open connections and extensions",
      "Open mobile",
      "Open calendar",
      "Open automations",
    ])

    fireEvent.click(within(primaryStack).getByRole("button", { name: "Open connections and extensions" }))
    fireEvent.click(within(primaryStack).getByRole("button", { name: "Open mobile" }))

    expect(props.onViewChange).toHaveBeenCalledWith("connections")
    expect(props.onViewChange).toHaveBeenCalledWith("mobile")
  })

  it("keeps settings as the last control in the left rail footer", () => {
    const { props } = renderActivityRail()
    const rail = screen.getByLabelText("Primary navigation rail")
    const footer = rail.querySelector(".activity-rail-footer") as HTMLElement | null

    expect(footer).not.toBeNull()
    const settingsButton = within(footer!).getByRole("button", { name: "Open settings" })
    expect(footer!.lastElementChild).toBe(settingsButton)

    fireEvent.click(settingsButton)

    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it("uses disclosure icons for configuration shortcuts", () => {
    renderActivityRail()

    const collapsedToggle = screen.getByRole("button", { name: "Show configuration shortcuts" })
    expect(collapsedToggle.querySelector(".lucide-settings")).toBeNull()
    expect(collapsedToggle.querySelector(".lucide-chevron-right")).not.toBeNull()

    fireEvent.click(collapsedToggle)

    const expandedToggle = screen.getByRole("button", { name: "Hide configuration shortcuts" })
    expect(expandedToggle.querySelector(".lucide-settings")).toBeNull()
    expect(expandedToggle.querySelector(".lucide-chevron-down")).not.toBeNull()
  })

  it("keeps external capability shortcuts out of the configuration stack", () => {
    const { props } = renderActivityRail()

    fireEvent.click(screen.getByRole("button", { name: "Show configuration shortcuts" }))

    expect(screen.queryByRole("button", { name: "Open SSH" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open MCP" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open connectors" })).not.toBeInTheDocument()
    expect(within(screen.getByLabelText("Configuration views")).queryByRole("button", {
      name: "Open mobile",
    })).not.toBeInTheDocument()
    expect(within(screen.getByLabelText("Configuration views")).queryByRole("button", {
      name: "Open connections and extensions",
    })).not.toBeInTheDocument()

    fireEvent.click(within(screen.getByLabelText("Primary views")).getByRole("button", {
      name: "Open connections and extensions",
    }))

    expect(props.onViewChange).toHaveBeenCalledWith("connections")
  })
})
