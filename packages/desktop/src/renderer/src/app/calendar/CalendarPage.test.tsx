import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n/I18nProvider"
import { CalendarPage } from "./CalendarPage"
import {
  createCalendarEvent,
  createCalendarTask,
  deleteCalendarTask,
  listCalendarItems,
  listCalendarSources,
  listCalendarTodos,
  scheduleCalendarTask,
  updateCalendarTask,
} from "./calendar-client"
import type { CalendarApiItem, CalendarEventRecord, CalendarSource, PlannerTaskRecord } from "./calendar-types"

vi.mock("./calendar-client", () => ({
  createCalendarEvent: vi.fn(),
  createCalendarTask: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  deleteCalendarTask: vi.fn(),
  listCalendarItems: vi.fn(),
  listCalendarSources: vi.fn(),
  listCalendarTasks: vi.fn(),
  listCalendarTodos: vi.fn(),
  scheduleCalendarTask: vi.fn(),
  updateCalendarEvent: vi.fn(),
  updateCalendarTask: vi.fn(),
}))

const listCalendarSourcesMock = vi.mocked(listCalendarSources)
const listCalendarItemsMock = vi.mocked(listCalendarItems)
const listCalendarTodosMock = vi.mocked(listCalendarTodos)
const createCalendarEventMock = vi.mocked(createCalendarEvent)
const createCalendarTaskMock = vi.mocked(createCalendarTask)
const deleteCalendarTaskMock = vi.mocked(deleteCalendarTask)
const updateCalendarTaskMock = vi.mocked(updateCalendarTask)
const scheduleCalendarTaskMock = vi.mocked(scheduleCalendarTask)

let apiSources: CalendarSource[]
let apiEvents: CalendarApiItem[]
let apiTodos: PlannerTaskRecord[]

const testNow = new Date("2026-06-17T10:00:00.000Z")

const testProjects = [
  {
    directory: "C:\\Projects\\Anybox",
    id: "prj_anybox_desktop",
    name: "Anybox Desktop",
  },
  {
    directory: "C:\\Projects\\AnyboxMobile",
    id: "prj_anybox_mobile",
    name: "Anybox Mobile",
  },
]

function renderCalendarPage() {
  return render(<CalendarPage projects={testProjects} quickAddProjects={[testProjects[0]!]} />)
}

function renderLocalizedCalendarPage(locale: string) {
  window.localStorage.setItem("desktop.locale", locale)
  return render(
    <I18nProvider>
      <CalendarPage projects={testProjects} quickAddProjects={[testProjects[0]!]} />
    </I18nProvider>,
  )
}

function createSources(): CalendarSource[] {
  return [
    {
      id: "work",
      name: "Work",
      subtitle: "Local calendar",
      color: "#3f7af0",
      enabled: true,
    },
    {
      id: "personal",
      name: "Personal",
      subtitle: "Local calendar",
      color: "#2f9d7e",
      enabled: true,
    },
  ]
}

function createApiEvents(): CalendarApiItem[] {
  const now = new Date()
  now.setHours(10, 0, 0, 0)
  return [
    {
      id: "evt_weekly_sync",
      entityId: "evt_weekly_sync",
      entityType: "event",
      displayKind: "external_event",
      sourceId: "work",
      title: "Weekly product sync",
      description: "Loaded from API.",
      startAt: now.getTime(),
      endAt: now.getTime() + 45 * 60 * 1000,
      allDay: false,
      color: "#3f7af0",
      status: "scheduled",
      isReadOnly: false,
      isSuggestion: false,
      workspace: "prj_anybox_desktop",
    },
  ]
}

function createApiTodos(): PlannerTaskRecord[] {
  const now = new Date()
  now.setHours(10, 0, 0, 0)
  return [
    {
      id: "tsk_calendar_spec",
      title: "Connect Todo to optional time",
      description: "Loaded from Todo API.",
      status: "todo",
      priority: "medium",
      estimateMinutes: 75,
      workspaceId: "prj_anybox_desktop",
      properties: { lane: "design" },
      createdAt: 1,
      updatedAt: 2,
    },
    {
      id: "tsk_release_notes",
      title: "Write mobile release notes",
      description: "Scheduled Todo from API.",
      status: "todo",
      priority: "medium",
      scheduledStartAt: now.getTime() + 2 * 60 * 60 * 1000,
      scheduledEndAt: now.getTime() + 3 * 60 * 60 * 1000,
      estimateMinutes: 60,
      workspaceId: "prj_anybox_mobile",
      createdAt: 1,
      updatedAt: 2,
    },
    {
      id: "tsk_mobile_feedback",
      title: "Triage mobile feedback",
      description: "Unscheduled mobile Todo from API.",
      status: "todo",
      priority: "medium",
      dueAt: now.getTime() + 24 * 60 * 60 * 1000,
      estimateMinutes: 45,
      workspaceId: "prj_anybox_mobile",
      createdAt: 1,
      updatedAt: 2,
    },
  ]
}

function scheduledTodoItem(todo: PlannerTaskRecord): CalendarApiItem | null {
  if (todo.scheduledStartAt === undefined || todo.scheduledEndAt === undefined) return null
  return {
    id: `todo:${todo.id}:scheduled`,
    entityId: todo.id,
    entityType: "task",
    displayKind: "scheduled_todo",
    sourceId: "todos",
    title: todo.title,
    description: todo.description,
    startAt: todo.scheduledStartAt,
    endAt: todo.scheduledEndAt,
    allDay: false,
    color: "#8a5cf6",
    estimateMinutes: todo.estimateMinutes,
    status: todo.status,
    isReadOnly: false,
    isSuggestion: false,
    workspace: todo.workspaceId,
    properties: todo.properties,
    timezone: todo.timezone,
  }
}

function deadlineItem(todo: PlannerTaskRecord): CalendarApiItem | null {
  if (todo.dueAt === undefined) return null
  return {
    id: `todo:${todo.id}:deadline`,
    entityId: todo.id,
    entityType: "task",
    displayKind: "deadline",
    sourceId: "deadlines",
    title: todo.title,
    description: todo.description,
    startAt: todo.dueAt,
    endAt: todo.dueAt,
    allDay: false,
    color: "#c47a2c",
    estimateMinutes: todo.estimateMinutes,
    status: todo.status,
    isReadOnly: false,
    isSuggestion: false,
    workspace: todo.workspaceId,
    properties: todo.properties,
    timezone: todo.timezone,
  }
}

function visibleApiItems() {
  const enabled = new Set(apiSources.filter((source) => source.enabled).map((source) => source.id))
  return [
    ...apiEvents.filter((item) => enabled.has(item.sourceId)),
    ...apiTodos.map(scheduledTodoItem).filter((item): item is CalendarApiItem => Boolean(item)),
    ...apiTodos.map(deadlineItem).filter((item): item is CalendarApiItem => Boolean(item)),
  ]
}

function eventRecordFromItem(item: CalendarApiItem, inputTimezone = "UTC"): CalendarEventRecord {
  return {
    id: item.id,
    sourceId: item.sourceId,
    title: item.title,
    description: item.description,
    startAt: item.startAt!,
    endAt: item.endAt!,
    allDay: item.allDay,
    status: item.status === "canceled" ? "canceled" : "scheduled",
    timezone: inputTimezone,
    attendees: [],
    linkedPageIds: [],
    linkedWorkspaceId: item.workspace,
    createdAt: 1,
    updatedAt: 2,
  }
}

function taskRecordFromTodo(todo: PlannerTaskRecord): PlannerTaskRecord {
  return {
    ...todo,
    description: todo.description,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
  }
}

function createDragDataTransfer() {
  const data = new Map<string, string>()
  return {
    dropEffect: "",
    effectAllowed: "",
    getData(type: string) {
      return data.get(type) ?? ""
    },
    setData(type: string, value: string) {
      data.set(type, value)
    },
  }
}

function startOfTestDay(date: Date) {
  const nextDate = new Date(date)
  nextDate.setHours(0, 0, 0, 0)
  return nextDate
}

function startOfTestWeek(date: Date) {
  const nextDate = startOfTestDay(date)
  nextDate.setDate(nextDate.getDate() - nextDate.getDay())
  return nextDate
}

function addTestDays(date: Date, days: number) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)
  return nextDate
}

function getTestDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function formatTestDayLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", weekday: "short" }).format(date)
}

function formatTestWeekRangeLabel(weekStart: Date) {
  const weekEnd = addTestDays(weekStart, 6)
  const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short" })
  const startMonth = monthFormatter.format(weekStart)
  const endMonth = monthFormatter.format(weekEnd)
  if (weekStart.getFullYear() !== weekEnd.getFullYear()) {
    return `${formatTestDayLabel(weekStart)} - ${formatTestDayLabel(weekEnd)}`
  }
  if (weekStart.getMonth() === weekEnd.getMonth()) {
    return `${startMonth} ${weekStart.getDate()} - ${weekEnd.getDate()}, ${weekStart.getFullYear()}`
  }
  return `${startMonth} ${weekStart.getDate()} - ${endMonth} ${weekEnd.getDate()}, ${weekStart.getFullYear()}`
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(testNow)

  apiSources = createSources()
  apiEvents = createApiEvents()
  apiTodos = createApiTodos()
  vi.clearAllMocks()

  listCalendarSourcesMock.mockImplementation(async () => apiSources)
  listCalendarItemsMock.mockImplementation(async () => visibleApiItems())
  listCalendarTodosMock.mockImplementation(async () => apiTodos)
  updateCalendarTaskMock.mockImplementation(async ({ taskId, update }) => {
    apiTodos = apiTodos.map((todo) => (todo.id === taskId ? {
      ...todo,
      title: update.title ?? todo.title,
      description: update.description === null ? undefined : update.description ?? todo.description,
      dueAt: update.dueAt === null ? undefined : update.dueAt ?? todo.dueAt,
      estimateMinutes: update.estimateMinutes ?? todo.estimateMinutes,
      properties: update.properties ?? todo.properties,
      status: update.status ?? todo.status,
      timezone: update.timezone === null ? undefined : update.timezone ?? todo.timezone,
      workspaceId: update.workspaceId === null ? undefined : update.workspaceId ?? todo.workspaceId,
      updatedAt: 3,
    } : todo))
    return taskRecordFromTodo(apiTodos.find((candidate) => candidate.id === taskId)!)
  })
  scheduleCalendarTaskMock.mockImplementation(async ({ taskId, schedule }) => {
    apiTodos = apiTodos.map((todo) => (todo.id === taskId ? {
      ...todo,
      scheduledStartAt: schedule.scheduledStartAt === null ? undefined : schedule.scheduledStartAt ?? todo.scheduledStartAt,
      scheduledEndAt: schedule.scheduledEndAt === null ? undefined : schedule.scheduledEndAt ?? todo.scheduledEndAt,
      updatedAt: 3,
    } : todo))
    return taskRecordFromTodo(apiTodos.find((candidate) => candidate.id === taskId)!)
  })
  deleteCalendarTaskMock.mockImplementation(async ({ taskId }) => {
    apiTodos = apiTodos.filter((todo) => todo.id !== taskId)
    return { taskID: taskId, todoID: taskId, deleted: true }
  })
  createCalendarEventMock.mockImplementation(async (input) => {
    const created: CalendarApiItem = {
      id: "evt_created",
      entityId: "evt_created",
      entityType: "event",
      displayKind: "external_event",
      sourceId: input.sourceId,
      title: input.title,
      description: input.description,
      startAt: input.startAt,
      endAt: input.endAt,
      allDay: input.allDay ?? false,
      color: "#3f7af0",
      status: input.status ?? "scheduled",
      isReadOnly: false,
      isSuggestion: false,
      workspace: input.linkedWorkspaceId,
    }
    apiEvents = [created, ...apiEvents]
    return eventRecordFromItem(created, input.timezone)
  })
  createCalendarTaskMock.mockImplementation(async (input) => {
    const created: PlannerTaskRecord = {
      id: "tsk_created",
      title: input.title,
      description: input.description,
      status: input.status ?? "todo",
      priority: input.priority ?? "medium",
      dueAt: input.dueAt,
      estimateMinutes: input.estimateMinutes,
      properties: input.properties,
      reminderAt: input.reminderAt,
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      timezone: input.timezone,
      workspaceId: input.workspaceId,
      createdAt: 1,
      updatedAt: 1,
    }
    apiTodos = [created, ...apiTodos]
    return created
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("CalendarPage", () => {
  it("embeds as a secondary view without duplicating the Planner shell", async () => {
    render(<CalendarPage embedded projects={testProjects} quickAddProjects={[testProjects[0]!]} />)

    expect(screen.getByRole("region", { name: "Calendar" })).toHaveClass("is-embedded")
    expect(screen.queryByRole("banner", { name: "Calendar top menu" })).not.toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "Calendar sidebar" })).not.toBeInTheDocument()
    expect(screen.getByRole("main", { name: "week calendar view" })).toBeInTheDocument()
    await waitFor(() => expect(listCalendarTodosMock).toHaveBeenCalled())
  })

  it("loads Todo-only sidebar sections without calendar source controls", async () => {
    renderCalendarPage()

    expect(screen.getByRole("region", { name: "Calendar" })).toBeInTheDocument()
    expect(screen.getByRole("complementary", { name: "Calendar sidebar" })).toBeInTheDocument()
    expect(screen.getByRole("main", { name: "week calendar view" })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "Mini calendar" })).not.toBeInTheDocument()
    const sidebar = screen.getByRole("complementary", { name: "Calendar sidebar" })
    expect(within(sidebar).queryByRole("group", { name: "Sidebar view" })).not.toBeInTheDocument()
    expect(within(sidebar).getByPlaceholderText("Search Todos...")).toBeInTheDocument()
    expect(within(sidebar).queryByRole("button", { name: "Dates" })).not.toBeInTheDocument()
    expect(within(sidebar).queryByRole("group", { name: "Todo schedule filter" })).not.toBeInTheDocument()
    expect(within(sidebar).getByRole("button", { name: "Project filter: All projects" })).toBeInTheDocument()
    expect(within(sidebar).getByRole("button", { name: "New Todo" })).toBeInTheDocument()
    expect(within(sidebar).getByRole("heading", { name: "Todos" })).toBeInTheDocument()
    expect(screen.queryByText("Projects")).not.toBeInTheDocument()
    expect(screen.queryByText("No Todo projects yet.")).not.toBeInTheDocument()
    expect(within(sidebar).queryByText("Unscheduled")).not.toBeInTheDocument()
    expect(within(sidebar).queryByText("Inbox")).not.toBeInTheDocument()
    expect(screen.queryByText("Workspaces")).not.toBeInTheDocument()
    await screen.findByText("Connect Todo to optional time")
    expect(within(sidebar).getByText("Connect Todo to optional time")).toBeInTheDocument()
    expect(within(sidebar).queryByText("Triage mobile feedback")).not.toBeInTheDocument()
    expect(within(sidebar).queryByText("Write mobile release notes")).not.toBeInTheDocument()
    expect(screen.queryByText("Event calendars")).not.toBeInTheDocument()
    expect(screen.queryByText("Calendars")).not.toBeInTheDocument()
    expect(screen.queryByText("Overlays")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Work/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Personal/ })).not.toBeInTheDocument()
    expect(screen.queryByText("Project dates")).not.toBeInTheDocument()
    expect(screen.queryByText("My Tasks")).not.toBeInTheDocument()
    expect(screen.queryByText("Weekly product sync")).not.toBeInTheDocument()
  })

  it("localizes calendar chrome through the app i18n provider", async () => {
    renderLocalizedCalendarPage("zh-CN")

    expect(screen.getByRole("region", { name: "日历" })).toBeInTheDocument()
    const sidebar = screen.getByRole("complementary", { name: "日历侧边栏" })
    expect(within(sidebar).getByPlaceholderText("搜索 Todos...")).toBeInTheDocument()
    expect(within(sidebar).getByRole("button", { name: "项目筛选：所有项目" })).toBeInTheDocument()
    expect(within(sidebar).getByRole("heading", { name: "全部" })).toBeInTheDocument()
    expect(screen.getByRole("main", { name: "周 日历视图" })).toBeInTheDocument()
  })

  it("keeps fixed dates out of the sidebar while showing them in the calendar", async () => {
    renderCalendarPage()

    const sidebar = screen.getByRole("complementary", { name: "Calendar sidebar" })
    await screen.findByText("Connect Todo to optional time")
    const main = screen.getByRole("main", { name: "week calendar view" })

    expect(within(sidebar).queryByRole("heading", { name: "Dates" })).not.toBeInTheDocument()
    expect(within(sidebar).queryByPlaceholderText("Search Dates...")).not.toBeInTheDocument()
    expect(within(sidebar).queryByRole("button", { name: "Dates" })).not.toBeInTheDocument()
    expect(within(sidebar).getByRole("button", { name: "Project filter: All projects" })).toBeInTheDocument()

    const dateChip = await within(main).findByRole("button", { name: /Triage mobile feedback/ })
    fireEvent.click(dateChip)

    const detailPanel = screen.getByRole("complementary", { name: "Calendar details" })
    expect(within(detailPanel).getAllByText("Date").length).toBeGreaterThan(0)
    expect(within(detailPanel).queryByText("Deadline")).not.toBeInTheDocument()
  })

  it("filters the unscheduled Todo sidebar by project", async () => {
    renderCalendarPage()

    const sidebar = screen.getByRole("complementary", { name: "Calendar sidebar" })
    await screen.findByText("Connect Todo to optional time")
    expect(within(sidebar).getByText("Connect Todo to optional time")).toBeInTheDocument()
    expect(within(sidebar).queryByText("Triage mobile feedback")).not.toBeInTheDocument()
    expect(within(sidebar).queryByText("Write mobile release notes")).not.toBeInTheDocument()

    fireEvent.click(within(sidebar).getByRole("button", { name: "Project filter: All projects" }))

    const listbox = within(sidebar).getByRole("listbox", { name: "Todo project filter" })
    expect(within(listbox).getByRole("option", { name: /All projects/ })).toBeInTheDocument()
    expect(within(listbox).getByRole("option", { name: /Anybox Desktop/ })).toBeInTheDocument()
    expect(within(listbox).queryByRole("option", { name: /Anybox Mobile/ })).not.toBeInTheDocument()
    fireEvent.click(within(listbox).getByRole("option", { name: /Anybox Desktop/ }))

    expect(within(sidebar).getByRole("button", { name: "Project filter: Anybox Desktop" })).toBeInTheDocument()
    expect(within(sidebar).getByText("Connect Todo to optional time")).toBeInTheDocument()
    expect(within(sidebar).queryByText("Triage mobile feedback")).not.toBeInTheDocument()
    expect(within(sidebar).queryByText("Write mobile release notes")).not.toBeInTheDocument()

    fireEvent.click(within(sidebar).getByRole("button", { name: "Project filter: Anybox Desktop" }))
    fireEvent.click(within(sidebar).getByRole("option", { name: /All projects/ }))

    expect(within(sidebar).getByText("Connect Todo to optional time")).toBeInTheDocument()
    expect(within(sidebar).queryByText("Triage mobile feedback")).not.toBeInTheDocument()
  })

  it("uses the centered period title for view-aware date navigation", async () => {
    renderCalendarPage()

    const dateNavigation = screen.getByLabelText("Date navigation")
    const today = startOfTestDay(new Date())
    const weekStart = startOfTestWeek(today)
    expect(within(dateNavigation).getByRole("button", {
      name: `Change calendar date, current range ${formatTestWeekRangeLabel(weekStart)}`,
    })).toBeInTheDocument()

    fireEvent.click(within(dateNavigation).getByRole("button", { name: "Next calendar range" }))

    const nextWeekAnchor = addTestDays(today, 7)
    expect(within(dateNavigation).getByRole("button", {
      name: `Change calendar date, current range ${formatTestWeekRangeLabel(startOfTestWeek(nextWeekAnchor))}`,
    })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "day" }))
    expect(screen.getByRole("main", { name: "day calendar view" })).toBeInTheDocument()
    expect(within(dateNavigation).getByRole("button", {
      name: `Change calendar date, current range ${formatTestDayLabel(nextWeekAnchor)}`,
    })).toBeInTheDocument()

    fireEvent.click(within(dateNavigation).getByRole("button", { name: "Next calendar range" }))

    expect(within(dateNavigation).getByRole("button", {
      name: `Change calendar date, current range ${formatTestDayLabel(addTestDays(nextWeekAnchor, 1))}`,
    })).toBeInTheDocument()

    fireEvent.click(within(dateNavigation).getByRole("button", { name: /Change calendar date/ }))
    expect(screen.getByRole("dialog", { name: "Choose calendar date" })).toBeInTheDocument()
    expect(screen.getByLabelText("Jump to date")).toHaveValue(getTestDateKey(addTestDays(nextWeekAnchor, 1)))
  })

  it("renders all items in a month day instead of limiting the cell to four", async () => {
    const testDate = startOfTestDay(new Date())
    testDate.setHours(9, 0, 0, 0)
    apiTodos = Array.from({ length: 5 }, (_item, index): PlannerTaskRecord => ({
      id: `tsk_stacked_${index + 1}`,
      title: `Stacked month Todo ${index + 1}`,
      description: "Same day month item.",
      status: "todo",
      priority: "medium",
      estimateMinutes: 30,
      scheduledStartAt: testDate.getTime() + index * 60 * 1000,
      scheduledEndAt: testDate.getTime() + (index + 1) * 60 * 1000,
      workspaceId: "prj_anybox_desktop",
      createdAt: 1,
      updatedAt: 2,
    }))

    renderCalendarPage()
    fireEvent.click(screen.getByRole("button", { name: "month" }))

    const monthView = screen.getByRole("main", { name: "month calendar view" })
    expect(await within(monthView).findByText("Stacked month Todo 5")).toBeInTheDocument()
  })

  it("keeps event calendar source controls hidden when only the default source exists", async () => {
    apiSources = [createSources()[0]!]

    renderCalendarPage()

    expect(await screen.findByRole("button", { name: "Project filter: All projects" })).toBeInTheDocument()
    expect(screen.queryByText("Projects")).not.toBeInTheDocument()
    expect(screen.queryByText("Event calendars")).not.toBeInTheDocument()
    expect(screen.queryByText("Overlays")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Work/ })).not.toBeInTheDocument()
    expect(screen.queryByText("Weekly product sync")).not.toBeInTheDocument()
  })

  it("persists Todo title and status edits from the unscheduled list", async () => {
    renderCalendarPage()

    fireEvent.click(await screen.findByText("Connect Todo to optional time"))

    const detailPanel = screen.getByRole("complementary", { name: "Calendar details" })
    expect(within(detailPanel).queryByText("Title")).not.toBeInTheDocument()
    const titleInput = await within(detailPanel).findByRole("textbox", { name: "Title" })
    expect(titleInput).toHaveValue("Connect Todo to optional time")
    expect(within(detailPanel).getAllByText("Todo").length).toBeGreaterThan(0)
    expect(within(detailPanel).queryByRole("button", { name: "Unschedule" })).not.toBeInTheDocument()
    fireEvent.change(titleInput, { target: { value: "Connect real Todos to calendar" } })

    await waitFor(() => expect(updateCalendarTaskMock).toHaveBeenCalledWith({
      taskId: "tsk_calendar_spec",
      update: { title: "Connect real Todos to calendar" },
    }))

    const statusGroup = within(detailPanel).getByRole("radiogroup", { name: "Status" })
    const statusSegments = within(statusGroup).getAllByRole("radio")
    expect(statusSegments).toHaveLength(2)
    expect(statusSegments[0]).toHaveAttribute("aria-checked", "true")
    fireEvent.click(statusSegments[1]!)

    await waitFor(() => expect(updateCalendarTaskMock).toHaveBeenCalledWith({
      taskId: "tsk_calendar_spec",
      update: { status: "done" },
    }))
  })

  it("deletes a Todo from the detail panel", async () => {
    renderCalendarPage()

    fireEvent.click(await screen.findByText("Connect Todo to optional time"))

    const detailPanel = screen.getByRole("complementary", { name: "Calendar details" })
    fireEvent.click(await within(detailPanel).findByRole("button", { name: "Delete" }))

    await waitFor(() => expect(deleteCalendarTaskMock).toHaveBeenCalledWith({ taskId: "tsk_calendar_spec" }))
    await waitFor(() => expect(screen.queryByText("Connect Todo to optional time")).not.toBeInTheDocument())
  })

  it("shows only the delete action for a scheduled Todo detail", async () => {
    renderCalendarPage()

    fireEvent.click((await screen.findAllByText("Write mobile release notes"))[0]!)

    const detailPanel = screen.getByRole("complementary", { name: "Calendar details" })
    const actionPanel = detailPanel.querySelector(".calendar-detail-actions")
    expect(actionPanel).not.toBeNull()
    expect(within(actionPanel as HTMLElement).getByRole("button", { name: "Delete" })).toBeInTheDocument()
    expect(within(actionPanel as HTMLElement).queryByRole("button", { name: "Move 30m later" })).not.toBeInTheDocument()
    expect(within(actionPanel as HTMLElement).queryByRole("button", { name: "Unschedule" })).not.toBeInTheDocument()
    expect(within(actionPanel as HTMLElement).queryByRole("button", { name: "标记完成" })).not.toBeInTheDocument()
    expect(within(actionPanel as HTMLElement).queryByRole("button", { name: "标记未完成" })).not.toBeInTheDocument()
  })

  it("quick add defaults to creating an unscheduled Todo", async () => {
    renderCalendarPage()

    await screen.findByText("Connect Todo to optional time")
    const sidebar = screen.getByRole("complementary", { name: "Calendar sidebar" })
    fireEvent.click(within(sidebar).getByRole("button", { name: "New Todo" }))

    const dialog = screen.getByRole("dialog", { name: "New Todo" })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Todo title" }), {
      target: { value: "Prototype check" },
    })
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Project" }), {
      target: { value: "prj_anybox_desktop" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create todo" }))

    await waitFor(() => expect(createCalendarTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Prototype check",
      workspaceId: "prj_anybox_desktop",
      scheduledStartAt: undefined,
      scheduledEndAt: undefined,
    })))
    expect(createCalendarEventMock).not.toHaveBeenCalled()
  })

  it("limits quick add project choices to open projects with no project selected by default", async () => {
    render(<CalendarPage projects={testProjects} quickAddProjects={[testProjects[0]!]} />)

    await screen.findByText("Connect Todo to optional time")
    const sidebar = screen.getByRole("complementary", { name: "Calendar sidebar" })
    fireEvent.click(within(sidebar).getByRole("button", { name: "New Todo" }))

    const dialog = screen.getByRole("dialog", { name: "New Todo" })
    const projectSelect = within(dialog).getByRole("combobox", { name: "Project" })
    expect(projectSelect).toHaveValue("")
    expect(within(projectSelect).getByRole("option", { name: "No project" })).toBeInTheDocument()
    expect(within(projectSelect).getByRole("option", { name: "Anybox Desktop" })).toBeInTheDocument()
    expect(within(projectSelect).queryByRole("option", { name: "Anybox Mobile" })).not.toBeInTheDocument()

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Todo title" }), {
      target: { value: "No project Todo" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create todo" }))

    await waitFor(() => expect(createCalendarTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "No project Todo",
      workspaceId: undefined,
    })))
  })

  it("keeps the quick add dialog open and reports Todo creation errors", async () => {
    renderCalendarPage()

    await screen.findByText("Connect Todo to optional time")
    const sidebar = screen.getByRole("complementary", { name: "Calendar sidebar" })
    fireEvent.click(within(sidebar).getByRole("button", { name: "New Todo" }))

    const dialog = screen.getByRole("dialog", { name: "New Todo" })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Todo title" }), {
      target: { value: "Prototype check" },
    })
    createCalendarTaskMock.mockRejectedValueOnce(new Error("Agent timeout"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Create todo" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Create failed: Agent timeout")
    expect(screen.getByRole("dialog", { name: "New Todo" })).toBeInTheDocument()
  })

  it("creates a scheduled Todo from a right-clicked time slot", async () => {
    const { container } = renderCalendarPage()

    await screen.findByText("Connect Todo to optional time")
    const slot = container.querySelector('[data-calendar-hour="14"]') as HTMLElement | null
    expect(slot).not.toBeNull()

    fireEvent.contextMenu(slot!)

    const menu = screen.getByRole("menu", { name: "Calendar slot actions" })
    fireEvent.click(within(menu).getByRole("menuitem", { name: /^New Todo/ }))

    const dialog = screen.getByRole("dialog", { name: "New Todo" })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Todo title" }), {
      target: { value: "Write follow-up Todo" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create todo" }))

    await waitFor(() => expect(createCalendarTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Write follow-up Todo",
      scheduledStartAt: expect.any(Number),
      scheduledEndAt: expect.any(Number),
    })))
    expect(createCalendarEventMock).not.toHaveBeenCalled()
    const createdInput = createCalendarTaskMock.mock.calls.at(-1)?.[0]
    expect(createdInput).toBeDefined()
    expect(new Date(createdInput!.scheduledStartAt!).getHours()).toBe(14)
    expect(new Date(createdInput!.scheduledEndAt!).getHours()).toBe(15)
  })

  it("does not offer event creation from a right-clicked time slot", async () => {
    const { container } = renderCalendarPage()

    await screen.findByText("Connect Todo to optional time")
    const slot = container.querySelector('[data-calendar-hour="14"]') as HTMLElement | null
    expect(slot).not.toBeNull()

    fireEvent.contextMenu(slot!)

    const menu = screen.getByRole("menu", { name: "Calendar slot actions" })
    expect(within(menu).getByRole("menuitem", { name: /^New Todo/ })).toBeInTheDocument()
    expect(within(menu).queryByRole("menuitem", { name: /Create event/ })).not.toBeInTheDocument()
    expect(createCalendarEventMock).not.toHaveBeenCalled()
  })

  it("unschedules a scheduled Todo when dragged back to the sidebar", async () => {
    renderCalendarPage()

    await screen.findByText("Connect Todo to optional time")
    const main = screen.getByRole("main", { name: "week calendar view" })
    const scheduledTodo = await within(main).findByRole("button", { name: /Write mobile release notes/ })
    const sidebar = screen.getByRole("complementary", { name: "Calendar sidebar" })
    const transfer = createDragDataTransfer()

    fireEvent.dragStart(scheduledTodo, { dataTransfer: transfer })
    fireEvent.drop(sidebar, { dataTransfer: transfer })

    await waitFor(() => expect(scheduleCalendarTaskMock).toHaveBeenCalledWith({
      taskId: "tsk_release_notes",
      schedule: {
        scheduledStartAt: null,
        scheduledEndAt: null,
      },
    }))
    expect(await within(sidebar).findByText("Write mobile release notes")).toBeInTheDocument()
  })

  it("schedules an unscheduled Todo when dragged into the grid", async () => {
    const { container } = renderCalendarPage()

    const todo = await screen.findByRole("button", { name: /Connect Todo to optional time/ })
    const slot = container.querySelector('[data-calendar-hour="13"]') as HTMLElement | null
    expect(slot).not.toBeNull()
    const transfer = createDragDataTransfer()

    fireEvent.dragStart(todo, { dataTransfer: transfer })
    fireEvent.drop(slot!, { dataTransfer: transfer })

    await waitFor(() => expect(scheduleCalendarTaskMock).toHaveBeenCalledWith({
      taskId: "tsk_calendar_spec",
      schedule: {
        scheduledStartAt: expect.any(Number),
        scheduledEndAt: expect.any(Number),
      },
    }))
    const schedule = scheduleCalendarTaskMock.mock.calls.at(-1)?.[0].schedule
    expect(new Date(schedule!.scheduledStartAt!).getHours()).toBe(13)
  })

  it("shows an unscheduled Todo in the all-day row after it is dragged there", async () => {
    const { container } = renderCalendarPage()

    const todo = await screen.findByRole("button", { name: /Connect Todo to optional time/ })
    const allDayCell = container.querySelector('[data-calendar-slot="all-day"]') as HTMLElement | null
    expect(allDayCell).not.toBeNull()
    const transfer = createDragDataTransfer()

    fireEvent.dragStart(todo, { dataTransfer: transfer })
    fireEvent.drop(allDayCell!, { dataTransfer: transfer })

    await waitFor(() => expect(scheduleCalendarTaskMock).toHaveBeenCalledWith({
      taskId: "tsk_calendar_spec",
      schedule: {
        scheduledStartAt: expect.any(Number),
        scheduledEndAt: expect.any(Number),
      },
    }))
    const schedule = scheduleCalendarTaskMock.mock.calls.at(-1)?.[0].schedule
    expect(new Date(schedule!.scheduledStartAt!).getHours()).toBe(0)
    expect(new Date(schedule!.scheduledEndAt!).getHours()).toBe(0)
    expect(await within(allDayCell!).findByRole("button", { name: /Connect Todo to optional time/ })).toBeInTheDocument()
  })

  it("moves a fixed Date by updating dueAt instead of scheduling the Todo", async () => {
    const { container } = renderCalendarPage()

    await screen.findByText("Connect Todo to optional time")
    const main = screen.getByRole("main", { name: "week calendar view" })
    const dateItem = await within(main).findByRole("button", { name: /Triage mobile feedback/ })
    const slot = container.querySelector('[data-calendar-hour="13"]') as HTMLElement | null
    expect(slot).not.toBeNull()
    const transfer = createDragDataTransfer()

    fireEvent.dragStart(dateItem, { dataTransfer: transfer })
    fireEvent.drop(slot!, { dataTransfer: transfer })

    await waitFor(() => expect(updateCalendarTaskMock).toHaveBeenCalledWith({
      taskId: "tsk_mobile_feedback",
      update: {
        dueAt: expect.any(Number),
      },
    }))
    expect(scheduleCalendarTaskMock).not.toHaveBeenCalled()
    const update = updateCalendarTaskMock.mock.calls.at(-1)?.[0].update
    expect(new Date(update!.dueAt!).getHours()).toBe(13)
  })

  it("keeps fixed Dates out of the unscheduled Todo sidebar and ignores sidebar drops", async () => {
    renderCalendarPage()

    await screen.findByText("Connect Todo to optional time")
    const main = screen.getByRole("main", { name: "week calendar view" })
    const dateItem = await within(main).findByRole("button", { name: /Triage mobile feedback/ })
    const sidebar = screen.getByRole("complementary", { name: "Calendar sidebar" })
    const detailPanel = screen.getByRole("complementary", { name: "Calendar details" })

    expect(within(sidebar).queryByText("Triage mobile feedback")).not.toBeInTheDocument()
    fireEvent.click(dateItem)
    expect(await within(detailPanel).findByDisplayValue("Triage mobile feedback")).toBeInTheDocument()
    const actionPanel = detailPanel.querySelector(".calendar-detail-actions")
    expect(actionPanel).not.toBeNull()
    expect(within(actionPanel as HTMLElement).getByRole("button", { name: "Delete" })).toBeInTheDocument()
    expect(within(actionPanel as HTMLElement).queryByRole("button", { name: "Move 30m later" })).not.toBeInTheDocument()
    expect(within(actionPanel as HTMLElement).queryByRole("button", { name: "Unschedule" })).not.toBeInTheDocument()
    expect(within(actionPanel as HTMLElement).queryByRole("button", { name: "标记完成" })).not.toBeInTheDocument()
    expect(within(actionPanel as HTMLElement).queryByRole("button", { name: "标记未完成" })).not.toBeInTheDocument()

    const transfer = createDragDataTransfer()
    fireEvent.dragStart(dateItem, { dataTransfer: transfer })
    fireEvent.drop(sidebar, { dataTransfer: transfer })

    expect(scheduleCalendarTaskMock).not.toHaveBeenCalled()
    expect(updateCalendarTaskMock).not.toHaveBeenCalled()
  })

  it("shows an error state when the local agent API is unavailable", async () => {
    listCalendarSourcesMock.mockRejectedValue(new Error("API offline"))
    listCalendarItemsMock.mockRejectedValue(new Error("API offline"))
    listCalendarTodosMock.mockRejectedValue(new Error("API offline"))

    renderCalendarPage()

    expect(await screen.findByRole("alert")).toHaveTextContent("Calendar data unavailable: API offline")
    expect(screen.queryByText("Project dates")).not.toBeInTheDocument()
  })
})
