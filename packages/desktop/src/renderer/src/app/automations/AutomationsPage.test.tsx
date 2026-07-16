import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  AgentAutomationCreateInput,
  AgentAutomationDefinition,
  AgentAutomationRun,
  AgentAutomationUpdateInput,
} from "../../../../shared/desktop-ipc-contract"
import { I18nProvider } from "../i18n/I18nProvider"
import { AutomationCreatePanel, AutomationsPage } from "./AutomationsPage"

function setDesktopMock(value: unknown) {
  Object.defineProperty(window, "desktop", {
    configurable: true,
    writable: true,
    value,
  })
}

const defaultWindowInnerHeight = window.innerHeight
const defaultWindowInnerWidth = window.innerWidth

function createAutomation(overrides: Partial<AgentAutomationDefinition> = {}): AgentAutomationDefinition {
  return {
    id: "aut_existing",
    name: "Existing automation",
    kind: "project",
    status: "active",
    schedule: {
      type: "rrule",
      expression: "FREQ=DAILY;INTERVAL=1",
      timezone: "UTC",
    },
    scope: {
      projectIDs: ["proj_1"],
    },
    execution: {
      environment: "local",
      permissionMode: "default",
    },
    prompt: "Review the project.",
    promptVersion: 1,
    outputPolicy: {
      triage: "findings-only",
      autoArchiveNoFindings: true,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    nextRunAt: Date.now() + 60_000,
    ...overrides,
  }
}

describe("AutomationsPage", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, "innerHeight", { configurable: true, value: defaultWindowInnerHeight })
    Object.defineProperty(window, "innerWidth", { configurable: true, value: defaultWindowInnerWidth })
    window.localStorage.clear()
    setDesktopMock(undefined)
  })

  it("loads existing automations and creates a project automation", async () => {
    const createAutomationMock = vi.fn(async (input: AgentAutomationCreateInput) => createAutomation({
      id: "aut_created",
      name: input.name,
      prompt: input.prompt,
    }))
    const runAutomationMock = vi.fn(async () => ({ runs: [] }))
    const updateAutomationMock = vi.fn(async (input: { automationID: string; automation: AgentAutomationUpdateInput }) => createAutomation({
      id: input.automationID,
      name: input.automation.name ?? "Existing automation",
      prompt: input.automation.prompt ?? "Review the project.",
      status: input.automation.status ?? "active",
      schedule: input.automation.schedule ?? createAutomation().schedule,
      execution: {
        ...createAutomation().execution,
        ...input.automation.execution,
      },
    }))
    setDesktopMock({
      cancelAutomationRun: vi.fn(),
      createAutomation: createAutomationMock,
      deleteAutomation: vi.fn(),
      listAutomationRuns: vi.fn(async () => [] satisfies AgentAutomationRun[]),
      listAutomations: vi.fn(async () => [createAutomation()]),
      runAutomation: runAutomationMock,
      updateAutomation: updateAutomationMock,
      updateAutomationRunTriage: vi.fn(),
    })

    render(
      <AutomationsPage
        projects={[{
          directory: "C:/Projects/example",
          id: "proj_1",
          name: "Example",
        }]}
      />,
    )

    expect(await screen.findByText("Existing automation")).toBeInTheDocument()
    expect(screen.queryByText("Review the project.")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Run Existing automation" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Pause Existing automation" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Delete Existing automation" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Run Existing automation" }))

    await waitFor(() => expect(runAutomationMock).toHaveBeenCalledWith({ automationID: "aut_existing" }))
    expect(screen.queryByRole("heading", { name: "Prompt" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open Existing automation" }))

    const titleInput = await screen.findByRole("textbox", { name: "Automation title" })
    const promptInput = screen.getByRole("textbox", { name: "Automation prompt" })
    expect(titleInput).toHaveValue("Existing automation")
    expect(promptInput).toHaveValue("Review the project.")
    expect(screen.queryByRole("heading", { name: "Prompt" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Run history" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Instructions" })).not.toBeInTheDocument()
    expect(screen.queryByText("Runs")).not.toBeInTheDocument()

    fireEvent.change(titleInput, { target: { value: "Edited automation" } })
    fireEvent.blur(titleInput)
    await waitFor(() => expect(updateAutomationMock).toHaveBeenCalledWith({
      automationID: "aut_existing",
      automation: { name: "Edited automation" },
    }))

    fireEvent.change(promptInput, { target: { value: "Edited prompt." } })
    fireEvent.blur(promptInput)
    await waitFor(() => expect(updateAutomationMock).toHaveBeenCalledWith({
      automationID: "aut_existing",
      automation: { prompt: "Edited prompt." },
    }))

    fireEvent.click(screen.getByRole("button", { name: "Run environment" }))
    expect(screen.getByRole("menu", { name: "Run environment" })).toHaveClass("automation-detail-environment-menu")
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Worktree" }))
    await waitFor(() => expect(updateAutomationMock).toHaveBeenCalledWith({
      automationID: "aut_existing",
      automation: { execution: { environment: "worktree" } },
    }))

    fireEvent.click(screen.getByRole("button", { name: "Cadence" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Weekly" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "Monday" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: "09:00" }))
    await waitFor(() => expect(updateAutomationMock).toHaveBeenCalledWith({
      automationID: "aut_existing",
      automation: {
        schedule: {
          type: "cron",
          expression: "0 9 * * 1",
          timezone: "UTC",
        },
      },
    }))

    fireEvent.click(screen.getByRole("button", { name: "Back to automations" }))
    fireEvent.click(screen.getByRole("button", { name: "New automation" }))

    fireEvent.click(screen.getByRole("button", { name: "Create automation" }))

    await waitFor(() => expect(createAutomationMock).toHaveBeenCalledTimes(1))
    expect(createAutomationMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: "project",
      scope: {
        projectIDs: ["proj_1"],
      },
      execution: expect.objectContaining({
        environment: "local",
      }),
      schedule: expect.objectContaining({
        type: "rrule",
      }),
    }))
  })

  it("creates from the standalone panel with the requested project preselected", async () => {
    const createAutomationMock = vi.fn(async (input: AgentAutomationCreateInput) => createAutomation({
      id: "aut_from_workspace",
      name: input.name,
      prompt: input.prompt,
      scope: input.scope,
    }))
    const onClose = vi.fn()
    const onCreated = vi.fn()
    setDesktopMock({
      cancelAutomationRun: vi.fn(),
      createAutomation: createAutomationMock,
      deleteAutomation: vi.fn(),
      listAutomationRuns: vi.fn(),
      listAutomations: vi.fn(),
      runAutomation: vi.fn(),
      updateAutomation: vi.fn(),
      updateAutomationRunTriage: vi.fn(),
    })

    render(
      <AutomationCreatePanel
        initialProjectID="proj_2"
        isOpen
        portal
        projects={[
          { directory: "C:/Projects/one", id: "proj_1", name: "One" },
          { directory: "C:/Projects/two", id: "proj_2", name: "Two" },
        ]}
        onClose={onClose}
        onCreated={onCreated}
      />,
    )

    expect(screen.getByRole("dialog", { name: "Create automation" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Two" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Create automation" }))

    await waitFor(() => expect(createAutomationMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: { projectIDs: ["proj_2"] },
    })))
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "aut_from_workspace" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("filters linked worktree targets in local mode and scopes linked worktrees by directory", async () => {
    const createAutomationMock = vi.fn(async (input: AgentAutomationCreateInput) => createAutomation({
      id: "aut_created",
      name: input.name,
      prompt: input.prompt,
      scope: input.scope,
      execution: {
        environment: input.execution?.environment ?? "local",
        permissionMode: input.execution?.permissionMode ?? "default",
      },
    }))
    setDesktopMock({
      cancelAutomationRun: vi.fn(),
      createAutomation: createAutomationMock,
      deleteAutomation: vi.fn(),
      listAutomationRuns: vi.fn(async () => [] satisfies AgentAutomationRun[]),
      listAutomations: vi.fn(async () => [] satisfies AgentAutomationDefinition[]),
      runAutomation: vi.fn(),
      updateAutomation: vi.fn(),
      updateAutomationRunTriage: vi.fn(),
    })

    render(
      <AutomationsPage
        projects={[
          {
            directory: "C:/repo/app",
            id: "workspace-primary",
            name: "Repo",
            projectID: "proj_git",
            projectKind: "git",
            repositoryRoot: "C:/repo/app",
            vcs: "git",
            worktree: "C:/repo/app",
            workspaceRoots: ["C:/repo/app", "C:/worktrees/app-feature"],
          },
          {
            directory: "C:/worktrees/app-feature",
            id: "workspace-linked",
            name: "Feature",
            projectID: "proj_git",
            projectKind: "git",
            repositoryRoot: "C:/repo/app",
            vcs: "git",
            worktree: "C:/repo/app",
            workspaceRoots: ["C:/repo/app", "C:/worktrees/app-feature"],
          },
          {
            directory: "C:/scratch/plain",
            id: "workspace-plain",
            name: "Plain",
            projectID: "proj_plain",
            projectKind: "directory",
            worktree: "C:/scratch/plain",
          },
        ]}
      />,
    )

    fireEvent.click(await screen.findByRole("button", { name: "New automation" }))

    fireEvent.click(screen.getByRole("button", { name: "Worktree" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Local" }))

    fireEvent.click(screen.getByRole("button", { name: "Repo" }))
    expect(screen.getByRole("menuitemradio", { name: "Repo" })).toBeInTheDocument()
    expect(screen.getByRole("menuitemradio", { name: "Plain" })).toBeInTheDocument()
    expect(screen.queryByRole("menuitemradio", { name: "Feature" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Local" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Worktree" }))
    fireEvent.click(screen.getByRole("button", { name: "Repo" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Feature" }))
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }))

    await waitFor(() => expect(createAutomationMock).toHaveBeenCalledTimes(1))
    expect(createAutomationMock).toHaveBeenCalledWith(expect.objectContaining({
      execution: expect.objectContaining({
        environment: "local",
      }),
      scope: {
        directories: ["C:/worktrees/app-feature"],
      },
    }))
  })

  it("portals detail cadence menu and clamps it to the viewport", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 520 })
    setDesktopMock({
      cancelAutomationRun: vi.fn(),
      createAutomation: vi.fn(),
      deleteAutomation: vi.fn(),
      listAutomationRuns: vi.fn(async () => [] satisfies AgentAutomationRun[]),
      listAutomations: vi.fn(async () => [createAutomation()]),
      runAutomation: vi.fn(),
      updateAutomation: vi.fn(),
      updateAutomationRunTriage: vi.fn(),
    })

    render(
      <AutomationsPage
        projects={[{
          directory: "C:/Projects/example",
          id: "proj_1",
          name: "Example",
        }]}
      />,
    )

    fireEvent.click(await screen.findByRole("button", { name: "Open Existing automation" }))
    const cadenceButton = await screen.findByRole("button", { name: "Cadence" })
    vi.spyOn(cadenceButton, "getBoundingClientRect").mockReturnValue({
      bottom: 108,
      height: 28,
      left: 280,
      right: 350,
      top: 80,
      width: 70,
      x: 280,
      y: 80,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.click(cadenceButton)

    const cadenceMenu = screen.getByRole("menu", { name: "Cadence" })
    expect(cadenceMenu.parentElement).toBe(document.body)
    expect(cadenceMenu).toHaveStyle({
      "--automation-detail-cadence-menu-max-height": "320px",
      left: "124px",
      top: "114px",
    })
  })

  it("renders automation chrome in the configured Chinese locale", async () => {
    window.localStorage.setItem("desktop.locale", "zh-CN")
    setDesktopMock({
      cancelAutomationRun: vi.fn(),
      createAutomation: vi.fn(),
      deleteAutomation: vi.fn(),
      getLocaleConfig: undefined,
      listAutomationRuns: vi.fn(async () => [] satisfies AgentAutomationRun[]),
      listAutomations: vi.fn(async () => [createAutomation()]),
      runAutomation: vi.fn(),
      updateAutomation: vi.fn(),
      updateAutomationRunTriage: vi.fn(),
    })

    render(
      <I18nProvider>
        <AutomationsPage
          projects={[{
            directory: "C:/Projects/example",
            id: "proj_1",
            name: "Example",
          }]}
        />
      </I18nProvider>,
    )

    expect(await screen.findByRole("heading", { name: "自动化" })).toBeInTheDocument()
    expect(screen.queryByText("1 个启用，共 1 个")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "运行 Existing automation" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "暂停 Existing automation" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "删除 Existing automation" })).toBeInTheDocument()
  })
})
