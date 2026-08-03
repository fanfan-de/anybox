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
  it("shows local skill details with a persistent right-side file navigator", () => {
    window.localStorage.setItem("desktop.locale", "en-US")
    const onFileSelect = vi.fn()
    const skillPath = "C:/Anybox/skills/Design/brand-guidelines/SKILL.md"
    const licensePath = "C:/Anybox/skills/Design/brand-guidelines/LICENSE.txt"
    const skillContent = '---\nname: brand-guidelines\ndescription: Keep the product voice consistent.\n---\n\n# Brand guide'
    const renderCanvas = (
      selectedFilePath = skillPath,
      selectedFileContent = skillContent,
      isLoadingFile = false,
    ) => (
      <I18nProvider>
        <GlobalSkillsCanvas
          globalSkillsRoot="C:/Anybox/skills"
          isDirty={false}
          isLoadingFile={isLoadingFile}
          isSavingFile={false}
          selectedFileContent={selectedFileContent}
          selectedFilePath={selectedFilePath}
          selectedFileReadOnly={false}
          selectedSkillDirectoryPath="C:/Anybox/skills/Design/brand-guidelines"
          selectedSkillDirectoryName="brand-guidelines"
          selectedSkillFiles={[
            {
              name: "SKILL.md",
              path: skillPath,
              kind: "file",
            },
            {
              name: "LICENSE.txt",
              path: licensePath,
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
          onFileSelect={onFileSelect}
          onSave={vi.fn()}
        />
      </I18nProvider>
    )

    const { rerender } = render(renderCanvas())

    expect(screen.getByRole("heading", { name: "brand-guidelines", level: 2 })).toBeInTheDocument()
    expect(screen.getByText("Keep the product voice consistent.")).toBeInTheDocument()
    expect(document.querySelector(".skill-library-local-detail .skill-library-product-icon")).toBeNull()
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument()
    expect(document.querySelector(".skill-library-overview-grid")).not.toBeInTheDocument()
    expect(screen.queryByText("Skill content")).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "SKILL.md" })).toBeInTheDocument()
    const fileSidebar = screen.getByRole("complementary", { name: "Skill files" })
    const threeColumnDetail = document.querySelector(".skill-library-downloaded-detail")
    expect(threeColumnDetail?.firstElementChild).toHaveClass("skill-library-detail-center")
    expect(threeColumnDetail?.lastElementChild).toBe(fileSidebar)
    expect(screen.getByRole("tree", { name: "Skill files" })).toBeInTheDocument()
    expect(screen.getByRole("treeitem", { name: "SKILL.md" })).toHaveAttribute("aria-selected", "true")
    const referencesFolder = screen.getByRole("treeitem", { name: "references" })
    expect(referencesFolder).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("treeitem", { name: "voice.md" })).not.toBeInTheDocument()

    act(() => referencesFolder.focus())
    fireEvent.keyDown(referencesFolder, { key: "ArrowRight" })
    expect(referencesFolder).toHaveAttribute("aria-expanded", "true")
    const voiceFile = screen.getByRole("treeitem", { name: "voice.md" })
    expect(voiceFile).toHaveAttribute("aria-level", "2")
    fireEvent.keyDown(referencesFolder, { key: "ArrowRight" })
    expect(voiceFile).toHaveFocus()
    fireEvent.keyDown(voiceFile, { key: "Enter" })
    expect(onFileSelect).toHaveBeenCalledWith("C:/Anybox/skills/Design/brand-guidelines/references/voice.md")

    const fileTree = screen.getByRole("tree", { name: "Skill files" })
    const renderedSkillHeading = screen.getByRole("heading", { name: "Brand guide" })
    rerender(renderCanvas(skillPath, skillContent, true))

    expect(screen.getByRole("tree", { name: "Skill files" })).toBe(fileTree)
    expect(screen.getByRole("treeitem", { name: "references" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("treeitem", { name: "voice.md" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Brand guide" })).toBe(renderedSkillHeading)
    expect(document.querySelector(".global-skills-editor-shell")).toHaveAttribute("aria-busy", "true")

    const licenseFile = screen.getByRole("treeitem", { name: "LICENSE.txt" })

    fireEvent.click(licenseFile)

    expect(onFileSelect).toHaveBeenCalledWith(licensePath)
    rerender(renderCanvas(licensePath, "License terms"))
    expect(screen.getByRole("region", { name: "LICENSE.txt" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled()
  })
})
