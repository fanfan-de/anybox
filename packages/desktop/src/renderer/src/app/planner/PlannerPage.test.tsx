import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n/I18nProvider"
import type { AgentAutomationCreateInput, AgentAutomationDefinition } from "../../../../shared/desktop-ipc-contract"
import { PlannerPage } from "./PlannerPage"
import { usePlannerData } from "./use-planner-data"
import type { AgentTaskRun, PlanProposal, PlannerTodo } from "./planner-types"

vi.mock("./use-planner-data", () => ({ usePlannerData: vi.fn() }))
vi.mock("../calendar/CalendarPage", () => ({
  CalendarPage: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="calendar-stub">{embedded ? "embedded-calendar" : "standalone-calendar"}</div>
  ),
}))

const usePlannerDataMock = vi.mocked(usePlannerData)

const todo: PlannerTodo = {
  id: "tsk_today",
  title: "Ship Planner workspace",
  status: "doing",
  priority: "high",
  projectId: "prj_anybox",
  dueAt: Date.now(),
  createdAt: Date.now() - 1000,
  updatedAt: Date.now(),
}

const proposal: PlanProposal = {
  id: "plp_review",
  reason: "Make room for the release task",
  changes: [{ kind: "schedule", todoId: todo.id, scheduledStartAt: Date.now(), scheduledEndAt: Date.now() + 3_600_000 }],
  status: "pending",
  createdAt: Date.now(),
}

const completedRun: AgentTaskRun = {
  id: "plr_completed",
  todoId: todo.id,
  projectId: "prj_anybox",
  directory: "C:\\Projects\\Anybox",
  sessionId: "session-planner-run",
  status: "completed",
  permissionMode: "read-only",
  requestedToolModuleIds: ["planner.core"],
  result: { summary: "Prepared the release checklist." },
  createdAt: Date.now() - 2000,
  updatedAt: Date.now() - 1000,
  completedAt: Date.now() - 1000,
}

function createPlannerData() {
  return {
    allTodos: [todo],
    error: null,
    isLoading: false,
    isMutating: false,
    proposals: [proposal],
    runs: [],
    todos: [todo],
    reload: vi.fn(async () => undefined),
    clearError: vi.fn(),
    createTodo: vi.fn(async () => todo),
    updateTodo: vi.fn(async () => todo),
    scheduleTodo: vi.fn(async () => todo),
    completeTodo: vi.fn(async () => todo),
    deleteTodo: vi.fn(async () => ({ todoId: todo.id, deleted: true as const })),
    acceptProposal: vi.fn(async () => ({ proposal: { ...proposal, status: "accepted" as const }, appliedTodos: [todo] })),
    dismissProposal: vi.fn(async () => ({ ...proposal, status: "dismissed" as const })),
    startRun: vi.fn(async () => ({ ...completedRun, status: "queued" as const })),
    cancelRun: vi.fn(async () => ({ ...completedRun, status: "canceled" as const })),
    retryRun: vi.fn(async () => ({ ...completedRun, id: "plr_retry", status: "queued" as const })),
    linkAutomation: vi.fn(async () => ({ ...todo, automationIds: ["automation-linked"] })),
    unlinkAutomation: vi.fn(async () => ({ ...todo, automationIds: [] })),
  }
}

function renderPlanner(onOpenSession?: (sessionId: string) => void) {
  return render(
    <I18nProvider>
      <PlannerPage
        onOpenSession={onOpenSession}
        projects={[{ id: "prj_anybox", name: "Anybox", directory: "C:\\Projects\\Anybox" }]}
        quickAddProjects={[{ id: "prj_anybox", name: "Anybox", directory: "C:\\Projects\\Anybox" }]}
      />
    </I18nProvider>,
  )
}

describe("PlannerPage", () => {
  beforeEach(() => {
    window.localStorage.setItem("desktop.locale", "en-US")
  })

  it("opens on Today and creates a todo without treating Planner as a calendar", async () => {
    const data = createPlannerData()
    usePlannerDataMock.mockReturnValue(data)
    renderPlanner()

    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument()
    expect(screen.getByText("Ship Planner workspace")).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText("Add a todo…"), { target: { value: "Review proposal UX" } })
    fireEvent.click(screen.getByRole("button", { name: "Add todo" }))

    await waitFor(() => expect(data.createTodo).toHaveBeenCalledWith(expect.objectContaining({
      title: "Review proposal UX",
      status: "todo",
      dueAt: expect.any(Number),
    })))
  })

  it("requires an explicit action to apply a pending Agent proposal", async () => {
    const data = createPlannerData()
    usePlannerDataMock.mockReturnValue(data)
    renderPlanner()

    fireEvent.click(screen.getByRole("button", { name: "Agent proposals" }))
    expect(await screen.findByRole("heading", { name: "Make room for the release task" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Accept and apply" }))

    await waitFor(() => expect(data.acceptProposal).toHaveBeenCalledWith(proposal.id))
  })

  it("edits and completes the selected todo from separate controls", async () => {
    const data = createPlannerData()
    usePlannerDataMock.mockReturnValue(data)
    renderPlanner()

    fireEvent.change(await screen.findByRole("textbox", { name: "Title" }), {
      target: { value: "Ship the complete Planner workspace" },
    })
    fireEvent.change(screen.getByRole("combobox", { name: "Priority" }), { target: { value: "urgent" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(data.updateTodo).toHaveBeenCalledWith(todo.id, expect.objectContaining({
      title: "Ship the complete Planner workspace",
      priority: "urgent",
    })))

    fireEvent.click(screen.getByRole("button", { name: "Complete Ship Planner workspace" }))
    await waitFor(() => expect(data.completeTodo).toHaveBeenCalledWith(todo.id, true))
  })

  it("keeps Calendar as an embedded secondary Planner view", () => {
    usePlannerDataMock.mockReturnValue(createPlannerData())
    renderPlanner()

    fireEvent.click(screen.getByRole("button", { name: "Calendar" }))
    expect(screen.getByTestId("calendar-stub")).toHaveTextContent("embedded-calendar")
  })

  it("supports keyboard access to quick add and search", () => {
    usePlannerDataMock.mockReturnValue(createPlannerData())
    renderPlanner()

    fireEvent.keyDown(window, { key: "n", ctrlKey: true })
    const quickAdd = screen.getByPlaceholderText("Add a todo…")
    expect(quickAdd).toHaveFocus()
    fireEvent.blur(quickAdd)

    fireEvent.keyDown(window, { key: "/" })
    expect(screen.getByRole("textbox", { name: "Search todos" })).toHaveFocus()
  })

  it("previews a turn-scoped Planner Agent run before starting it", async () => {
    const data = createPlannerData()
    usePlannerDataMock.mockReturnValue(data)
    renderPlanner()

    fireEvent.click(await screen.findByRole("button", { name: "Delegate to Agent" }))
    expect(screen.getByText("planner.core · current turn only")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Additional instructions"), {
      target: { value: "Prepare a release checklist" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Start Agent run" }))

    await waitFor(() => expect(data.startRun).toHaveBeenCalledWith(todo.id, {
      projectId: "prj_anybox",
      directory: "C:\\Projects\\Anybox",
      prompt: "Prepare a release checklist",
      permissionMode: "default",
    }))
    expect(data.completeTodo).not.toHaveBeenCalled()
  })

  it("shows Agent run provenance, result, and its session link", async () => {
    const data = { ...createPlannerData(), runs: [completedRun] }
    const onOpenSession = vi.fn()
    usePlannerDataMock.mockReturnValue(data)
    renderPlanner(onOpenSession)

    expect(await screen.findByText("Prepared the release checklist.")).toBeInTheDocument()
    expect(screen.getByText(/tools: planner\.core · turn-scoped/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Open session" }))
    expect(onOpenSession).toHaveBeenCalledWith("session-planner-run")
  })

  it("creates an explicit AutomationDefinition and links it to the todo", async () => {
    const data = createPlannerData()
    const createAutomation = vi.fn(async (input: AgentAutomationCreateInput): Promise<AgentAutomationDefinition> => ({
      id: "automation-linked",
      name: input.name,
      kind: input.kind ?? "project",
      status: input.status ?? "active",
      schedule: input.schedule,
      scope: input.scope,
      execution: {
        environment: input.execution?.environment ?? "local",
        ...input.execution,
      },
      prompt: input.prompt,
      promptVersion: 1,
      outputPolicy: {
        triage: input.outputPolicy?.triage ?? "findings-only",
        autoArchiveNoFindings: input.outputPolicy?.autoArchiveNoFindings ?? true,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }))
    window.desktop = {
      ...window.desktop,
      createAutomation,
      deleteAutomation: vi.fn(async () => ({ automationID: "automation-linked", deleted: true })),
    } as NonNullable<Window["desktop"]>
    usePlannerDataMock.mockReturnValue(data)
    renderPlanner()

    fireEvent.click(await screen.findByRole("button", { name: "Make recurring" }))
    fireEvent.click(screen.getByRole("button", { name: "Create and activate" }))

    await waitFor(() => expect(createAutomation).toHaveBeenCalledWith(expect.objectContaining({
      name: todo.title,
      kind: "project",
      status: "active",
      scope: { projectIDs: ["prj_anybox"] },
      execution: expect.objectContaining({ permissionMode: "read-only" }),
      schedule: expect.objectContaining({ type: "cron", expression: "0 9 * * 1-5" }),
    })))
    expect(data.linkAutomation).toHaveBeenCalledWith(todo.id, "automation-linked")
  })
})
