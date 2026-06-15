import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { WorkspaceGroup } from "../types"
import { CreateSessionCanvas } from "./CreateSessionCanvas"

function createWorkspace(overrides: Partial<WorkspaceGroup> = {}): WorkspaceGroup {
  return {
    id: "workspace-1",
    name: "app",
    directory: "C:\\Projects\\Project 1\\app",
    created: 1,
    updated: 2,
    project: {
      id: "project-1",
      name: "Project 1",
      worktree: "C:\\Projects\\Project 1",
    },
    sessions: [],
    ...overrides,
  }
}

function renderCreateSessionCanvas(input: Partial<Parameters<typeof CreateSessionCanvas>[0]> = {}) {
  const props = {
    isCreatingSession: false,
    selectedWorkspaceID: "workspace-1",
    workspaces: [createWorkspace()],
    onOpenProjectFolder: vi.fn(),
    onWorkspaceChange: vi.fn(),
    ...input,
  } satisfies Parameters<typeof CreateSessionCanvas>[0]

  return {
    ...render(<CreateSessionCanvas {...props} />),
    props,
  }
}

describe("CreateSessionCanvas", () => {
  it("shows a strong open-folder guide when no project is available", () => {
    const { props } = renderCreateSessionCanvas({
      selectedWorkspaceID: null,
      workspaces: [],
    })

    expect(screen.getByRole("heading", { name: "Open a project folder to start" })).toBeInTheDocument()
    expect(screen.getByText(/Anybox needs a local project folder/)).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Session project" })).toBeDisabled()

    fireEvent.click(screen.getByRole("button", { name: "Open project folder" }))

    expect(props.onOpenProjectFolder).toHaveBeenCalledTimes(1)
  })

  it("shows only the selected project selector when a project is selected", () => {
    renderCreateSessionCanvas()

    expect(screen.getAllByText("Project 1 / app").length).toBeGreaterThan(0)
    expect(screen.queryByRole("heading", { name: "Start with a concrete task" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Prompt examples")).not.toBeInTheDocument()
  })

  it("shows a selection-required guide when workspaces exist but none is selected", () => {
    const { props } = renderCreateSessionCanvas({
      selectedWorkspaceID: null,
    })

    expect(screen.getByRole("heading", { name: "Select a project before sending" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open project folder" }))

    expect(props.onOpenProjectFolder).toHaveBeenCalledTimes(1)
  })
})
