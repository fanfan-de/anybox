import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n/I18nProvider"
import type { WorkspaceGroup } from "../types"
import { CreateSessionCanvas, GlobalSkillsCanvas } from "./CreateSessionCanvas"

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
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("shows only an open-folder button when no project is available", () => {
    const { props } = renderCreateSessionCanvas({
      selectedWorkspaceID: null,
      workspaces: [],
    })

    expect(screen.queryByRole("heading", { name: "Open a project folder to start" })).not.toBeInTheDocument()
    expect(screen.queryByText(/Anybox needs a local project folder/)).not.toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Session project" })).toBeDisabled()
    expect(screen.queryByText("What should we build in Anybox?")).not.toBeInTheDocument()
    expect(screen.queryByTitle("Click to show another tip")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open project folder" }))

    expect(props.onOpenProjectFolder).toHaveBeenCalledTimes(1)
  })

  it("shows only an open-folder button when only the default conversation workspace is available", () => {
    renderCreateSessionCanvas({
      conversationWorkspaceID: "workspace-1",
      selectedWorkspaceID: "workspace-1",
      workspaces: [createWorkspace({ name: "conversation" })],
    })

    expect(screen.queryByRole("heading", { name: "Open a project folder to start" })).not.toBeInTheDocument()
    expect(screen.queryByText(/Anybox needs a local project folder/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open project folder" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "Session project" })).toBeDisabled()
  })

  it("shows the selected project and one usage tip without a heading", () => {
    renderCreateSessionCanvas()

    expect(screen.queryByText("What should we build in Anybox?")).not.toBeInTheDocument()
    expect(screen.getAllByText("Project 1 / app").length).toBeGreaterThan(0)
    expect(screen.getByText("Define the goal, constraints, and acceptance criteria so Anybox can complete the task more reliably.")).toBeInTheDocument()
    expect(screen.getAllByTitle("Click to show another tip")).toHaveLength(1)
    expect(screen.queryByRole("heading", { name: "Start with a concrete task" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Prompt examples")).not.toBeInTheDocument()
  })

  it("does not repeat the project name when the workspace has the same name", () => {
    renderCreateSessionCanvas({
      workspaces: [createWorkspace({ name: "Project 1" })],
    })

    expect(screen.getByRole("combobox", { name: "Session project" })).toHaveTextContent("Project 1")
    expect(screen.queryByText("Project 1 / Project 1")).not.toBeInTheDocument()
  })

  it("rotates the usage tip after eight seconds without repeating it", () => {
    renderCreateSessionCanvas()

    const tipButton = screen.getByTitle("Click to show another tip")
    expect(screen.getByText(/Define the goal, constraints/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(8_000)
    })
    expect(tipButton).toHaveClass("is-exiting")
    expect(screen.getByText(/Define the goal, constraints/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(120)
    })

    expect(screen.queryByText(/Define the goal, constraints/)).not.toBeInTheDocument()
    expect(screen.getByText(/For complex tasks, use Plan mode/)).toBeInTheDocument()
    expect(tipButton).toHaveClass("is-entering")

    act(() => {
      vi.advanceTimersByTime(180)
    })
    expect(tipButton).toHaveClass("is-idle")
  })

  it("rotates on click and restarts the eight-second timer", () => {
    renderCreateSessionCanvas()

    act(() => {
      vi.advanceTimersByTime(4_000)
    })
    const tipButton = screen.getByTitle("Click to show another tip")
    fireEvent.click(tipButton)

    expect(tipButton).toHaveClass("is-exiting")

    act(() => {
      vi.advanceTimersByTime(120)
    })

    expect(screen.getByText(/For complex tasks, use Plan mode/)).toBeInTheDocument()
    expect(tipButton).toHaveClass("is-entering")

    act(() => {
      vi.advanceTimersByTime(180)
    })
    expect(tipButton).toHaveClass("is-idle")

    act(() => {
      vi.advanceTimersByTime(7_999)
    })
    expect(screen.getByText(/For complex tasks, use Plan mode/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(tipButton).toHaveClass("is-exiting")
    expect(screen.getByText(/For complex tasks, use Plan mode/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(120)
    })
    expect(screen.queryByText(/For complex tasks, use Plan mode/)).not.toBeInTheDocument()
  })

  it("shows a selection-required guide when workspaces exist but none is selected", () => {
    const { props } = renderCreateSessionCanvas({
      selectedWorkspaceID: null,
    })

    expect(screen.getByRole("heading", { name: "Select a project before sending" })).toBeInTheDocument()
    expect(screen.queryByTitle("Click to show another tip")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open project folder" }))

    expect(props.onOpenProjectFolder).toHaveBeenCalledTimes(1)
  })
})

describe("GlobalSkillsCanvas", () => {
  it("shows local skill details first and keeps internal files in the Files tab", () => {
    window.localStorage.setItem("desktop.locale", "en-US")
    const onFileSelect = vi.fn()

    render(
      <I18nProvider>
        <GlobalSkillsCanvas
          deletingGlobalSkillDirectory={null}
          globalSkillsRoot="C:/Anybox/skills"
          isDirty={false}
          isLoadingFile={false}
          isSavingFile={false}
          selectedFileContent={'---\nname: brand-guidelines\ndescription: Keep the product voice consistent.\n---\n\n# Brand guide'}
          selectedFilePath="C:/Anybox/skills/Design/brand-guidelines/SKILL.md"
          selectedFileReadOnly={false}
          selectedSkillDirectoryPath="C:/Anybox/skills/Design/brand-guidelines"
          selectedSkillDirectoryName="brand-guidelines"
          selectedSkillFiles={[
            {
              name: "SKILL.md",
              path: "C:/Anybox/skills/Design/brand-guidelines/SKILL.md",
              kind: "file",
            },
            {
              name: "LICENSE.txt",
              path: "C:/Anybox/skills/Design/brand-guidelines/LICENSE.txt",
              kind: "file",
            },
            {
              name: "references",
              path: "C:/Anybox/skills/Design/brand-guidelines/references",
              kind: "directory",
              children: [{
                name: "voice.md",
                path: "C:/Anybox/skills/Design/brand-guidelines/references/voice.md",
                kind: "file",
              }],
            },
          ]}
          onChange={vi.fn()}
          onDelete={vi.fn()}
          onFileSelect={onFileSelect}
          onSave={vi.fn()}
        />
      </I18nProvider>,
    )

    expect(screen.getByRole("heading", { name: "brand-guidelines", level: 2 })).toBeInTheDocument()
    expect(screen.getByText("Keep the product voice consistent.")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true")
    expect(screen.queryByRole("button", { name: "LICENSE.txt" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("tab", { name: "Files" }))

    expect(screen.getByRole("button", { name: "SKILL.md" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "LICENSE.txt" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "references/voice.md" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "LICENSE.txt" }))
    expect(onFileSelect).toHaveBeenCalledWith("C:/Anybox/skills/Design/brand-guidelines/LICENSE.txt")
  })
})
