import { Fragment, useMemo, useState, type DragEvent, type FormEvent, type MouseEvent, type ReactNode } from "react"
import {
  CalendarIcon,
  ChevronRightIcon,
  CloseIcon,
  DeleteIcon,
  PlusIcon,
  SearchIcon,
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import type { TranslationKey } from "../i18n/translations"
import { ShellTopMenu, joinClassNames } from "../shared-ui"
import type { AppLocale } from "../../../../shared/locale"
import { useCalendarData } from "./use-calendar-data"
import type {
  CalendarEventStatus,
  CalendarEntityType,
  CalendarDisplayKind,
  CalendarItem,
  CalendarSource,
  CalendarViewMode,
  UpdateCalendarEventInput,
  UpdateCalendarTaskInput,
  PlannerTaskStatus,
} from "./calendar-types"

interface CalendarPageProps {
  projects?: CalendarProjectOption[]
  quickAddProjects?: CalendarProjectOption[]
  windowControls?: ReactNode
}

interface CalendarProjectOption {
  directory?: string
  id: string
  name: string
}

interface QuickAddContext {
  startAt: Date
  endAt: Date
  allDay: boolean
}

interface CalendarContextMenuPosition {
  x: number
  y: number
}

interface CalendarSlotContextMenuState extends CalendarContextMenuPosition {
  context: QuickAddContext
}

interface CalendarItemContextMenuState extends CalendarContextMenuPosition {
  itemId: string
}

type QuickAddMode = "todo" | "event"
type CalendarTranslate = (key: TranslationKey, params?: Record<string, string | number>) => string

interface TodoSummary {
  unscheduled: number
}

interface ProjectSummary {
  count: number
  id: string
  name: string
}

interface CalendarOverlaysState {
  agent: boolean
  deadlines: boolean
  reminders: boolean
}

const CREATE_EVENT_STATUS_VALUES = ["scheduled", "canceled"] as const satisfies readonly CalendarEventStatus[]

const TODO_COLOR = "#8a5cf6"
const DEADLINE_COLOR = "#c47a2c"
const REMINDER_COLOR = "#d94d64"
const AGENT_COLOR = "#64748b"

const HOURS = Array.from({ length: 12 }, (_item, index) => index + 8)
const WEEKDAY_LABEL_REFERENCE = new Date(2020, 5, 7)
const VIEW_MODES: CalendarViewMode[] = ["day", "week", "month", "schedule"]
const CALENDAR_CONTEXT_MENU_WIDTH = 240
const CALENDAR_SLOT_CONTEXT_MENU_HEIGHT = 54
const CALENDAR_ITEM_CONTEXT_MENU_HEIGHT = 46
const TODO_PROJECT_ALL_FILTER_ID = "__all_projects__"
const TODO_PROJECT_NO_PROJECT_FILTER_ID = "__no_project__"
const DEFAULT_ENABLED_OVERLAYS: CalendarOverlaysState = {
  agent: true,
  deadlines: true,
  reminders: true,
}

function formatActionError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getViewModeLabel(mode: CalendarViewMode, t: CalendarTranslate) {
  switch (mode) {
    case "day":
      return t("calendar.view.day")
    case "week":
      return t("calendar.view.week")
    case "month":
      return t("calendar.view.month")
    case "schedule":
      return t("calendar.view.schedule")
  }
}

function startOfDay(date: Date) {
  const nextDate = new Date(date)
  nextDate.setHours(0, 0, 0, 0)
  return nextDate
}

function startOfWeek(date: Date) {
  const nextDate = startOfDay(date)
  nextDate.setDate(nextDate.getDate() - nextDate.getDay())
  return nextDate
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + days)
  return nextDate
}

function setTime(date: Date, hour: number, minute = 0) {
  const nextDate = new Date(date)
  nextDate.setHours(hour, minute, 0, 0)
  return nextDate
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
}

function getDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function getHourKey(date: Date) {
  return date.getHours()
}

function formatMonthLabel(date: Date, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(date)
}

function formatDateOnlyLabel(date: Date, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date)
}

function formatWeekRangeLabel(weekStart: Date, locale: AppLocale) {
  const weekEnd = addDays(weekStart, 6)
  if (locale !== "en-US") {
    return `${formatDateOnlyLabel(weekStart, locale)} - ${formatDateOnlyLabel(weekEnd, locale)}`
  }

  const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short" })
  const startMonth = monthFormatter.format(weekStart)
  const endMonth = monthFormatter.format(weekEnd)
  if (weekStart.getFullYear() !== weekEnd.getFullYear()) {
    return `${formatDayLabel(weekStart, locale)} - ${formatDayLabel(weekEnd, locale)}`
  }
  if (weekStart.getMonth() === weekEnd.getMonth()) {
    return `${startMonth} ${weekStart.getDate()} - ${weekEnd.getDate()}, ${weekStart.getFullYear()}`
  }
  return `${startMonth} ${weekStart.getDate()} - ${endMonth} ${weekEnd.getDate()}, ${weekStart.getFullYear()}`
}

function formatScheduleRangeLabel(anchorDate: Date, locale: AppLocale, t: CalendarTranslate) {
  return t("calendar.scheduleRange", { date: formatDayLabel(anchorDate, locale) })
}

function formatDayLabel(date: Date, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", weekday: "short" }).format(date)
}

function formatWeekdayLabel(date: Date, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date)
}

function formatWeekdayLabelForIndex(index: number, locale: AppLocale) {
  return formatWeekdayLabel(addDays(WEEKDAY_LABEL_REFERENCE, index), locale)
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number(part))
  if (!year || !month || !day) return null
  return startOfDay(new Date(year, month - 1, day))
}

function formatTime(date: Date, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)
}

function formatHourLabel(hour: number, locale: AppLocale) {
  return formatTime(setTime(new Date(2020, 0, 1), hour), locale)
}

function formatDateTimeRange(item: CalendarItem, locale: AppLocale, t: CalendarTranslate) {
  if (!item.startAt) return t("calendar.notScheduled")
  if (item.allDay) return t("calendar.dateTimeAllDay", { date: formatDayLabel(item.startAt, locale) })
  const startTime = formatTime(item.startAt, locale)
  const time = item.endAt
    ? t("calendar.timeRange", { start: startTime, end: formatTime(item.endAt, locale) })
    : startTime
  return t("calendar.dateTimeTimed", { date: formatDayLabel(item.startAt, locale), time })
}

function getEntityLabel(type: CalendarEntityType, t: CalendarTranslate) {
  switch (type) {
    case "event":
      return t("calendar.type.event")
    case "task":
      return t("calendar.type.todo")
    case "project":
      return t("calendar.type.project")
    case "reminder":
      return t("calendar.type.reminder")
    case "agent_suggestion":
      return t("calendar.type.suggestion")
  }
}

function getDisplayKindLabel(displayKind: CalendarDisplayKind | undefined, t: CalendarTranslate) {
  switch (displayKind) {
    case "external_event":
      return t("calendar.type.event")
    case "scheduled_todo":
      return t("calendar.type.todo")
    case "deadline":
      return t("calendar.type.date")
    case "reminder":
      return t("calendar.type.reminder")
    case "agent_suggestion":
      return t("calendar.type.suggestion")
    default:
      return null
  }
}

function getItemTypeLabel(item: CalendarItem, t: CalendarTranslate) {
  return getDisplayKindLabel(item.displayKind, t) ?? getEntityLabel(item.entityType, t)
}

function getDateFieldLabel(item: CalendarItem) {
  switch (item.displayKind) {
    case "deadline":
      return "dueAt"
    case "reminder":
      return "reminderAt"
    case "scheduled_todo":
      return "scheduledStartAt"
    case "agent_suggestion":
      return "suggestedStartAt"
    case "external_event":
    default:
      return item.entityType === "task" ? "scheduledStartAt" : "startAt"
  }
}

function getScheduledTodoItemId(todoId: string) {
  return `todo:${todoId}:scheduled`
}

function getDeadlineItemId(todoId: string) {
  return `todo:${todoId}:deadline`
}

function getItemAccentColor(item: CalendarItem, source?: CalendarSource) {
  return source?.color ?? item.color ?? (
    item.displayKind === "deadline" ? DEADLINE_COLOR :
    item.displayKind === "reminder" ? REMINDER_COLOR :
    item.displayKind === "agent_suggestion" ? AGENT_COLOR :
    item.entityType === "task" ? TODO_COLOR :
    "#64748b"
  )
}

function getScheduleListSourceLabel(item: CalendarItem, source: CalendarSource | undefined, t: CalendarTranslate) {
  return source?.name ?? getItemTypeLabel(item, t)
}

function getProjectOptionLabel(project: CalendarProjectOption) {
  return project.name.trim() || project.directory?.trim() || project.id
}

function resolveProjectValue(value: string | undefined, projects: CalendarProjectOption[]) {
  const normalized = value?.trim()
  if (!normalized) return ""
  if (projects.some((project) => project.id === normalized)) return normalized
  const matchingProject = projects.find((project) => getProjectOptionLabel(project) === normalized)
  return matchingProject?.id ?? normalized
}

function getProjectDisplayName(value: string | undefined, projects: CalendarProjectOption[], t: CalendarTranslate) {
  const normalized = value?.trim()
  if (!normalized) return t("calendar.noProject")
  const resolved = resolveProjectValue(normalized, projects)
  return projects.find((project) => project.id === resolved)
    ? getProjectOptionLabel(projects.find((project) => project.id === resolved)!)
    : normalized
}

function getTodoProjectFilterId(item: CalendarItem, projects: CalendarProjectOption[]) {
  return resolveProjectValue(item.workspace, projects) || TODO_PROJECT_NO_PROJECT_FILTER_ID
}

function getSidebarTodoMeta(item: CalendarItem, projects: CalendarProjectOption[], locale: AppLocale, t: CalendarTranslate) {
  const projectName = getProjectDisplayName(item.workspace, projects, t)
  const estimate = t("calendar.minuteEstimate", { minutes: item.estimateMinutes ?? 60 })
  if (item.startAt && item.endAt) {
    return t("calendar.sidebarTodoMetaWithTime", {
      estimate,
      project: projectName,
      time: t("calendar.timeRange", { start: formatTime(item.startAt, locale), end: formatTime(item.endAt, locale) }),
    })
  }
  return t("calendar.sidebarTodoMeta", { estimate, project: projectName })
}

function hasLegacyProjectValue(value: string | undefined, projects: CalendarProjectOption[]) {
  const resolved = resolveProjectValue(value, projects)
  return Boolean(resolved && !projects.some((project) => project.id === resolved))
}

function getStatusLabel(status: CalendarItem["status"], t: CalendarTranslate) {
  switch (status) {
    case "scheduled":
      return t("calendar.status.scheduled")
    case "canceled":
      return t("calendar.status.canceled")
    case "todo":
      return t("calendar.status.todo")
    case "done":
      return t("calendar.status.done")
    case "pending":
      return t("calendar.status.pending")
    case "blocked":
      return t("calendar.status.blocked")
    default:
      return status ?? t("calendar.unknown")
  }
}

function getCreateEventStatusOptions(t: CalendarTranslate) {
  return CREATE_EVENT_STATUS_VALUES.map((value) => ({
    label: getStatusLabel(value, t),
    value,
  }))
}

function getStatusOptions(item: CalendarItem, t: CalendarTranslate) {
  if (item.entityType === "event") {
    return getCreateEventStatusOptions(t)
  }

  if (item.entityType === "task") {
    return [
      { value: "todo", label: getStatusLabel("todo", t) },
      { value: "done", label: getStatusLabel("done", t) },
    ] satisfies Array<{ value: CalendarItem["status"]; label: string }>
  }

  if (item.entityType === "agent_suggestion") {
    return [
      { value: "pending", label: getStatusLabel("pending", t) },
      { value: "blocked", label: getStatusLabel("blocked", t) },
    ] satisfies Array<{ value: CalendarItem["status"]; label: string }>
  }

  return [
    { value: "scheduled", label: getStatusLabel("scheduled", t) },
    { value: "todo", label: getStatusLabel("todo", t) },
    { value: "done", label: getStatusLabel("done", t) },
    { value: "canceled", label: getStatusLabel("canceled", t) },
  ] satisfies Array<{ value: CalendarItem["status"]; label: string }>
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase()
}

function getNextDefaultStart(anchorDate: Date) {
  const now = new Date()
  if (isSameDay(anchorDate, now)) {
    const nextHour = Math.min(Math.max(now.getHours() + 1, 9), 17)
    return setTime(anchorDate, nextHour)
  }
  return setTime(anchorDate, 9)
}

function isPlannerTaskStatus(status: CalendarItem["status"]): status is PlannerTaskStatus {
  return status === "todo" || status === "done"
}

function isCalendarEventStatus(status: CalendarItem["status"]): status is CalendarEventStatus {
  return status === "scheduled" || status === "canceled"
}

function readQuickAddHour(text: string) {
  const match = text.match(/(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  if (!match) return null

  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const meridiem = match[3]?.toLowerCase()
  if (meridiem === "pm" && hour < 12) hour += 12
  if (meridiem === "am" && hour === 12) hour = 0
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null
  return { hour, minute: Number.isFinite(minute) ? minute : 0 }
}

function itemMatchesQuery(item: CalendarItem, query: string, t: CalendarTranslate) {
  const normalized = normalizeSearchText(query)
  if (!normalized) return true
  return [
    item.title,
    item.description,
    item.workspace,
    item.status,
    item.entityType,
    getItemTypeLabel(item, t),
  ].some((value) => value?.toLowerCase().includes(normalized))
}

function canDeleteCalendarItem(item: CalendarItem | undefined) {
  return Boolean(item && item.entityType !== "agent_suggestion" && !item.isReadOnly)
}

function getDetailTitleRows(title: string) {
  return Math.min(4, Math.max(1, title.split(/\r?\n/).reduce((rows, line) => {
    return rows + Math.max(1, Math.ceil(line.length / 24))
  }, 0)))
}

function isTodoCalendarItem(item: CalendarItem) {
  return item.entityType !== "event" && item.displayKind !== "external_event"
}

function isUnscheduledTodoItem(item: CalendarItem) {
  return (
    item.entityType === "task" &&
    item.displayKind === "scheduled_todo" &&
    !item.startAt &&
    !item.dueAt &&
    !item.reminderAt
  )
}

function canUnscheduleCalendarItem(item: CalendarItem | undefined) {
  return Boolean(
    item &&
    item.entityType === "task" &&
    item.displayKind === "scheduled_todo" &&
    item.startAt &&
    !item.isReadOnly,
  )
}

function getCalendarContextMenuPosition(
  event: MouseEvent<HTMLElement>,
  estimatedWidth = CALENDAR_CONTEXT_MENU_WIDTH,
  estimatedHeight = CALENDAR_SLOT_CONTEXT_MENU_HEIGHT,
): CalendarContextMenuPosition {
  const margin = 8
  const pageRect = event.currentTarget.closest(".calendar-page")?.getBoundingClientRect()
  const boundsWidth = pageRect?.width ?? (typeof window === "undefined" ? estimatedWidth + margin * 2 : window.innerWidth)
  const boundsHeight = pageRect?.height ?? (typeof window === "undefined" ? estimatedHeight + margin * 2 : window.innerHeight)
  const rawX = event.clientX - (pageRect?.left ?? 0)
  const rawY = event.clientY - (pageRect?.top ?? 0)

  return {
    x: Math.max(margin, Math.min(rawX, boundsWidth - estimatedWidth - margin)),
    y: Math.max(margin, Math.min(rawY, boundsHeight - estimatedHeight - margin)),
  }
}

function formatQuickAddContext(context: QuickAddContext, locale: AppLocale, t: CalendarTranslate) {
  if (context.allDay) return t("calendar.dateTimeAllDay", { date: formatDayLabel(context.startAt, locale) })
  return t("calendar.dateTimeTimed", {
    date: formatDayLabel(context.startAt, locale),
    time: t("calendar.timeRange", { start: formatTime(context.startAt, locale), end: formatTime(context.endAt, locale) }),
  })
}

export function CalendarPage({ projects = [], quickAddProjects = [], windowControls }: CalendarPageProps) {
  const { locale, t } = useI18n()
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()))
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week")
  const [localItems, setLocalItems] = useState<CalendarItem[]>([])
  const enabledOverlays = DEFAULT_ENABLED_OVERLAYS
  const [selectedItemId, setSelectedItemId] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTodoProjectID, setSelectedTodoProjectID] = useState(TODO_PROJECT_ALL_FILTER_ID)
  const [isTodoProjectFilterOpen, setIsTodoProjectFilterOpen] = useState(false)
  const [quickAddMode, setQuickAddMode] = useState<QuickAddMode>("todo")
  const [quickAddText, setQuickAddText] = useState("")
  const [quickAddSourceId, setQuickAddSourceId] = useState("")
  const [quickAddStatus, setQuickAddStatus] = useState<CalendarEventStatus>("scheduled")
  const [quickAddWorkspace, setQuickAddWorkspace] = useState("")
  const [quickAddNotes, setQuickAddNotes] = useState("")
  const [quickAddError, setQuickAddError] = useState<string | null>(null)
  const [isCreatingQuickAdd, setIsCreatingQuickAdd] = useState(false)
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false)
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false)
  const [quickAddContext, setQuickAddContext] = useState<QuickAddContext | null>(null)
  const [calendarContextMenu, setCalendarContextMenu] = useState<CalendarSlotContextMenuState | null>(null)
  const [calendarItemContextMenu, setCalendarItemContextMenu] = useState<CalendarItemContextMenuState | null>(null)
  const quickAddProjectOptions = useMemo(() => {
    const projectsByID = new Map<string, CalendarProjectOption>()
    for (const project of quickAddProjects) {
      const id = project.id.trim()
      if (!id || projectsByID.has(id)) continue
      projectsByID.set(id, {
        ...project,
        id,
        name: getProjectOptionLabel(project),
      })
    }
    return Array.from(projectsByID.values()).sort((left, right) => left.name.localeCompare(right.name, locale))
  }, [locale, quickAddProjects])
  const quickAddProjectIDs = useMemo(
    () => new Set(quickAddProjectOptions.map((project) => project.id)),
    [quickAddProjectOptions],
  )

  const weekStart = useMemo(() => startOfWeek(anchorDate), [anchorDate])
  const calendarRange = useMemo(() => {
    if (viewMode === "month") {
      const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
      const rangeStart = startOfWeek(monthStart)
      return {
        rangeStart,
        rangeEnd: addDays(rangeStart, 42),
      }
    }

    if (viewMode === "schedule") {
      const rangeStart = startOfDay(anchorDate)
      return {
        rangeStart,
        rangeEnd: addDays(rangeStart, 14),
      }
    }

    const rangeStart = viewMode === "day" ? startOfDay(anchorDate) : weekStart
    return {
      rangeStart,
      rangeEnd: addDays(rangeStart, viewMode === "day" ? 1 : 7),
    }
  }, [anchorDate, viewMode, weekStart])
  const calendarData = useCalendarData(calendarRange)
  const sources = calendarData.sources
  const items = useMemo(
    () => [...calendarData.items, ...localItems].filter(isTodoCalendarItem),
    [calendarData.items, localItems],
  )
  const todoItems = calendarData.todos
  const allUnscheduledTasks = useMemo(
    () => todoItems.filter(isUnscheduledTodoItem),
    [todoItems],
  )
  const selectableItems = useMemo(
    () => [...items, ...allUnscheduledTasks],
    [allUnscheduledTasks, items],
  )
  const remoteItemIds = useMemo(() => new Set(calendarData.items.map((item) => item.id)), [calendarData.items])
  const remoteTodoIds = useMemo(() => new Set(calendarData.todos.map((item) => item.id)), [calendarData.todos])
  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources])
  const defaultEventSource = useMemo(
    () => sources.find((source) => source.enabled) ?? sources[0] ?? null,
    [sources],
  )
  const enabledSourceIds = useMemo(
    () => new Set(sources.filter((source) => source.enabled).map((source) => source.id)),
    [sources],
  )
  const visibleItems = useMemo(
    () => items.filter((item) => (
      item.displayKind === "deadline" ? enabledOverlays.deadlines :
      item.displayKind === "reminder" ? enabledOverlays.reminders :
      item.displayKind === "agent_suggestion" || item.entityType === "agent_suggestion" ? enabledOverlays.agent :
      item.entityType === "event" ? enabledSourceIds.has(item.sourceId) :
      true
    )),
    [enabledOverlays.agent, enabledOverlays.deadlines, enabledOverlays.reminders, enabledSourceIds, items],
  )
  const todoSummary = useMemo<TodoSummary>(() => ({
    unscheduled: allUnscheduledTasks.length,
  }), [allUnscheduledTasks.length])
  const projectSummaries = useMemo<ProjectSummary[]>(() => {
    const counts = new Map<string, ProjectSummary>()
    for (const todo of allUnscheduledTasks) {
      const projectId = getTodoProjectFilterId(todo, projects)
      const existing = counts.get(projectId)
      counts.set(projectId, {
        count: (existing?.count ?? 0) + 1,
        id: projectId,
        name: getProjectDisplayName(todo.workspace, projects, t),
      })
    }
    return Array.from(counts.values()).sort((left, right) => left.name.localeCompare(right.name, locale))
  }, [allUnscheduledTasks, locale, projects, t])
  const todoProjectFilterOptions = useMemo<ProjectSummary[]>(() => [
    {
      count: allUnscheduledTasks.length,
      id: TODO_PROJECT_ALL_FILTER_ID,
      name: t("calendar.allProjects"),
    },
    ...projectSummaries,
  ], [allUnscheduledTasks.length, projectSummaries, t])
  const activeTodoProjectID = useMemo(
    () => todoProjectFilterOptions.some((project) => project.id === selectedTodoProjectID)
      ? selectedTodoProjectID
      : TODO_PROJECT_ALL_FILTER_ID,
    [selectedTodoProjectID, todoProjectFilterOptions],
  )
  const unscheduledTasks = useMemo(
    () => allUnscheduledTasks.filter((item) => (
      itemMatchesQuery(item, searchQuery, t) &&
      (
        activeTodoProjectID === TODO_PROJECT_ALL_FILTER_ID ||
        getTodoProjectFilterId(item, projects) === activeTodoProjectID
      )
    )),
    [activeTodoProjectID, allUnscheduledTasks, projects, searchQuery, t],
  )
  const selectedItem = useMemo(
    () => selectableItems.find((item) => item.id === selectedItemId) ?? visibleItems[0] ?? allUnscheduledTasks[0] ?? null,
    [allUnscheduledTasks, selectableItems, selectedItemId, visibleItems],
  )
  const calendarItemContextMenuItem = useMemo(
    () => calendarItemContextMenu
      ? selectableItems.find((item) => item.id === calendarItemContextMenu.itemId)
      : undefined,
    [calendarItemContextMenu, selectableItems],
  )
  const currentViewLabel = (
    viewMode === "day" ? formatDayLabel(anchorDate, locale) :
    viewMode === "week" ? formatWeekRangeLabel(weekStart, locale) :
    viewMode === "month" ? formatMonthLabel(anchorDate, locale) :
    formatScheduleRangeLabel(anchorDate, locale, t)
  )

  function toCalendarEventUpdate(update: Partial<CalendarItem>): UpdateCalendarEventInput {
    const eventUpdate: UpdateCalendarEventInput = {}
    if (update.title !== undefined) eventUpdate.title = update.title
    if (update.description !== undefined) eventUpdate.description = update.description
    if (update.sourceId !== undefined) eventUpdate.sourceId = update.sourceId
    if (update.startAt !== undefined) eventUpdate.startAt = update.startAt.getTime()
    if (update.endAt !== undefined) eventUpdate.endAt = update.endAt.getTime()
    if (update.allDay !== undefined) eventUpdate.allDay = update.allDay
    if (isCalendarEventStatus(update.status)) eventUpdate.status = update.status
    if (update.workspace !== undefined) eventUpdate.linkedWorkspaceId = update.workspace || ""
    return eventUpdate
  }

  function toCalendarTaskUpdate(update: Partial<CalendarItem>): UpdateCalendarTaskInput {
    const taskUpdate: UpdateCalendarTaskInput = {}
    if (update.title !== undefined) taskUpdate.title = update.title
    if (update.description !== undefined) taskUpdate.description = update.description || null
    if (isPlannerTaskStatus(update.status)) taskUpdate.status = update.status
    if (update.workspace !== undefined) taskUpdate.workspaceId = update.workspace || null
    if (update.estimateMinutes !== undefined) taskUpdate.estimateMinutes = update.estimateMinutes
    if (update.properties !== undefined) taskUpdate.properties = update.properties
    if (update.timezone !== undefined) taskUpdate.timezone = update.timezone || null
    return taskUpdate
  }

  function updateItem(itemId: string, update: Partial<CalendarItem>) {
    const existing = selectableItems.find((item) => item.id === itemId)
    if (existing?.entityType === "event" && remoteItemIds.has(itemId)) {
      calendarData.patchItem(itemId, update)
      const eventUpdate = toCalendarEventUpdate(update)
      if (Object.keys(eventUpdate).length > 0) {
        void calendarData.updateEvent(existing.entityId ?? itemId, eventUpdate).catch(() => undefined)
      }
      return
    }

    const todoId = existing?.entityType === "task" ? existing.entityId ?? itemId : ""
    if (existing?.entityType === "task" && remoteTodoIds.has(todoId)) {
      const isDatePoint = existing.displayKind === "deadline"
      const nextStart = "startAt" in update ? update.startAt : existing.startAt
      const nextEnd = isDatePoint && "startAt" in update ? update.startAt : ("endAt" in update ? update.endAt : existing.endAt)
      const itemUpdate = isDatePoint ? { ...update, endAt: nextEnd } : update
      calendarData.patchItem(itemId, itemUpdate)
      const {
        allDay: _allDay,
        endAt: _endAt,
        startAt: _startAt,
        ...nonDateTodoUpdate
      } = update
      const todoUpdate = isDatePoint ? nonDateTodoUpdate : update
      calendarData.patchItem(todoId, todoUpdate)
      const taskUpdate = {
        ...toCalendarTaskUpdate(update),
        ...(
          isDatePoint && "startAt" in update
            ? { dueAt: nextStart ? nextStart.getTime() : null }
            : {}
        ),
      }
      if (Object.keys(taskUpdate).length > 0) {
        void calendarData.updateTask(todoId, taskUpdate).catch(() => undefined)
      }
      if (!isDatePoint && ("startAt" in update || "endAt" in update)) {
        const nextEnd = "endAt" in update ? update.endAt : existing.endAt
        const schedule = nextStart && nextEnd
          ? {
              scheduledStartAt: nextStart.getTime(),
              scheduledEndAt: nextEnd.getTime(),
            }
          : {
              scheduledStartAt: null,
              scheduledEndAt: null,
            }
        void calendarData.scheduleTask(todoId, schedule).catch(() => undefined)
      }
      return
    }

    setLocalItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...update } : item)))
  }

  function deleteItem(itemId: string) {
    const existing = selectableItems.find((candidate) => candidate.id === itemId)
    if (!existing || existing.entityType === "agent_suggestion") return

    setSelectedItemId("")

    if (existing.entityType === "event" && remoteItemIds.has(existing.id)) {
      void calendarData.deleteEvent(existing.entityId ?? existing.id).catch(() => undefined)
      return
    }

    if (existing.entityType === "task") {
      const todoId = existing.entityId ?? existing.id
      if (remoteTodoIds.has(todoId)) {
        void calendarData.deleteTask(todoId).catch(() => undefined)
        return
      }
    }

    setLocalItems((current) => current.filter((item) => item.id !== itemId && item.entityId !== existing.entityId))
  }

  function moveAnchor(delta: number) {
    setIsDatePickerOpen(false)
    if (viewMode === "month") {
      setAnchorDate((current) => {
        const nextDate = new Date(current)
        nextDate.setMonth(nextDate.getMonth() + delta)
        return startOfDay(nextDate)
      })
      return
    }

    setAnchorDate((current) => addDays(current, viewMode === "day" ? delta : delta * 7))
  }

  function selectAnchorDate(date: Date) {
    setAnchorDate(startOfDay(date))
    setIsDatePickerOpen(false)
  }

  function moveItemToContext(itemId: string, context: QuickAddContext) {
    const item = selectableItems.find((candidate) => candidate.id === itemId)
    if (!item || item.entityType === "agent_suggestion") return

    if (item.displayKind === "deadline") {
      const startAt = context.allDay ? startOfDay(context.startAt) : context.startAt
      updateItem(itemId, {
        startAt,
        endAt: startAt,
        allDay: context.allDay,
      })
      setSelectedItemId(getDeadlineItemId(item.entityId ?? item.id))
      return
    }

    const duration = item.startAt && item.endAt
      ? Math.max(15, Math.round((item.endAt.getTime() - item.startAt.getTime()) / 60000))
      : item.estimateMinutes ?? 60
    const startAt = context.startAt
    updateItem(itemId, {
      startAt,
      endAt: context.allDay ? context.endAt : addMinutes(startAt, duration),
      allDay: context.allDay,
    })
    setSelectedItemId(item.entityType === "task" ? getScheduledTodoItemId(item.entityId ?? item.id) : itemId)
  }

  function scheduleItem(itemId: string, day: Date, hour: number) {
    const startAt = setTime(day, hour)
    moveItemToContext(itemId, {
      startAt,
      endAt: addMinutes(startAt, 60),
      allDay: false,
    })
  }

  function handleCellDrop(event: DragEvent<HTMLDivElement>, day: Date, hour: number) {
    const itemId = event.dataTransfer.getData("text/calendar-item-id")
    if (!itemId) return
    event.preventDefault()
    scheduleItem(itemId, day, hour)
  }

  function handleAllDayDrop(event: DragEvent<HTMLElement>, day: Date) {
    const itemId = event.dataTransfer.getData("text/calendar-item-id")
    if (!itemId) return
    event.preventDefault()
    const startAt = startOfDay(day)
    moveItemToContext(itemId, {
      startAt,
      endAt: addDays(startAt, 1),
      allDay: true,
    })
  }

  function handleItemDragStart(event: DragEvent<HTMLElement>, item: CalendarItem) {
    if (item.entityType === "agent_suggestion") {
      event.preventDefault()
      return
    }

    setCalendarContextMenu(null)
    setCalendarItemContextMenu(null)
    event.stopPropagation()
    event.dataTransfer.setData("text/calendar-item-id", item.id)
    event.dataTransfer.setData("text/plain", item.title)
    event.dataTransfer.effectAllowed = "move"
  }

  function openQuickAddDialog(mode: QuickAddMode, context: QuickAddContext | null = null, workspaceOverride?: string) {
    setQuickAddMode(mode)
    setQuickAddText("")
    setQuickAddSourceId(defaultEventSource?.id ?? "")
    setQuickAddStatus("scheduled")
    setQuickAddWorkspace(getQuickAddWorkspaceValue(workspaceOverride))
    setQuickAddNotes("")
    setQuickAddError(null)
    setQuickAddContext(context)
    setCalendarContextMenu(null)
    setCalendarItemContextMenu(null)
    setIsQuickAddOpen(true)
  }

  function handleSlotContextMenu(event: MouseEvent<HTMLElement>, context: QuickAddContext) {
    event.preventDefault()
    event.stopPropagation()
    setCalendarItemContextMenu(null)
    setCalendarContextMenu({
      context,
      ...getCalendarContextMenuPosition(event, CALENDAR_CONTEXT_MENU_WIDTH, CALENDAR_SLOT_CONTEXT_MENU_HEIGHT),
    })
  }

  function handleItemContextMenu(event: MouseEvent<HTMLElement>, item: CalendarItem) {
    event.preventDefault()
    event.stopPropagation()
    setSelectedItemId(item.id)
    setCalendarContextMenu(null)
    setCalendarItemContextMenu({
      itemId: item.id,
      ...getCalendarContextMenuPosition(event, CALENDAR_CONTEXT_MENU_WIDTH, CALENDAR_ITEM_CONTEXT_MENU_HEIGHT),
    })
  }

  async function handleQuickAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isCreatingQuickAdd) return

    const title = quickAddText.trim()
    if (!title) {
      setQuickAddError(t("calendar.titleRequired"))
      return
    }

    const context = quickAddContext
    const targetDate = context?.startAt ?? (/tomorrow|明天/.test(title.toLowerCase()) ? addDays(anchorDate, 1) : anchorDate)
    const parsedTime = readQuickAddHour(title)
    const defaultStart = getNextDefaultStart(targetDate)
    const startAt = context?.startAt ?? (
      quickAddMode === "event" ? (parsedTime ? setTime(targetDate, parsedTime.hour, parsedTime.minute) : defaultStart) :
      parsedTime ? setTime(targetDate, parsedTime.hour, parsedTime.minute) :
      undefined
    )
    const endAt = context?.endAt ?? (startAt ? addMinutes(startAt, 60) : undefined)
    const sourceId = quickAddSourceId || defaultEventSource?.id
    const workspace = quickAddWorkspace.trim()
    const notes = quickAddNotes.trim()
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    setIsCreatingQuickAdd(true)
    setQuickAddError(null)

    try {
      let created: { id: string } | null = null
      if (quickAddMode === "event") {
        if (!sourceId || !startAt || !endAt) {
          setQuickAddError(t("calendar.createMissingFields"))
          return
        }
        created = await calendarData.createEvent({
          title,
          sourceId,
          startAt: startAt.getTime(),
          endAt: endAt.getTime(),
          allDay: context?.allDay ?? false,
          timezone,
          description: notes || undefined,
          status: quickAddStatus,
          linkedWorkspaceId: workspace || undefined,
        })
      } else {
        created = await calendarData.createTask({
          title,
          description: notes || undefined,
          estimateMinutes: startAt && endAt ? Math.max(15, Math.round((endAt.getTime() - startAt.getTime()) / 60000)) : 60,
          priority: "medium",
          scheduledStartAt: startAt?.getTime(),
          scheduledEndAt: endAt?.getTime(),
          status: "todo",
          timezone,
          workspaceId: workspace || undefined,
        })
      }

      setSelectedItemId(quickAddMode === "todo" && startAt ? getScheduledTodoItemId(created.id) : created.id)
      setQuickAddText("")
      setQuickAddSourceId(defaultEventSource?.id ?? "")
      setQuickAddStatus("scheduled")
      setQuickAddWorkspace("")
      setQuickAddNotes("")
      setQuickAddError(null)
      setQuickAddContext(null)
      setIsQuickAddOpen(false)
    } catch (error) {
      setQuickAddError(t("calendar.createFailedWithMessage", { message: formatActionError(error) }))
    } finally {
      setIsCreatingQuickAdd(false)
    }
  }

  function closeQuickAddDialog() {
    setQuickAddMode("todo")
    setQuickAddText("")
    setQuickAddSourceId(defaultEventSource?.id ?? "")
    setQuickAddStatus("scheduled")
    setQuickAddWorkspace("")
    setQuickAddNotes("")
    setQuickAddError(null)
    setQuickAddContext(null)
    setIsQuickAddOpen(false)
  }

  function getQuickAddWorkspaceValue(value: string | undefined) {
    const normalized = value?.trim()
    return normalized && quickAddProjectIDs.has(normalized) ? normalized : ""
  }

  function getSidebarQuickAddWorkspace() {
    if (activeTodoProjectID === TODO_PROJECT_ALL_FILTER_ID) return ""
    if (activeTodoProjectID === TODO_PROJECT_NO_PROJECT_FILTER_ID) return ""
    return getQuickAddWorkspaceValue(activeTodoProjectID)
  }

  function acceptSuggestion(suggestion: CalendarItem) {
    if (!suggestion.targetItemId || !suggestion.startAt) return
    updateItem(suggestion.targetItemId, {
      startAt: suggestion.startAt,
      endAt: suggestion.endAt,
    })
    setLocalItems((current) => current.filter((item) => item.id !== suggestion.id))
    setSelectedItemId(suggestion.targetItemId)
  }

  function dismissSuggestion(suggestionId: string) {
    setLocalItems((current) => current.filter((item) => item.id !== suggestionId))
    setSelectedItemId((current) => (current === suggestionId ? "" : current))
  }

  function unscheduleItem(itemId: string) {
    const existing = selectableItems.find((item) => item.id === itemId)
    if (!existing || !canUnscheduleCalendarItem(existing)) return
    updateItem(itemId, { startAt: undefined, endAt: undefined, allDay: false, status: "todo" })
    setSelectedItemId(existing.entityId ?? itemId)
  }

  function handleUnscheduledTodoDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }

  function handleUnscheduledTodoDrop(event: DragEvent<HTMLElement>) {
    const itemId = event.dataTransfer.getData("text/calendar-item-id")
    const existing = selectableItems.find((item) => item.id === itemId)
    if (!canUnscheduleCalendarItem(existing)) return
    event.preventDefault()
    unscheduleItem(itemId)
  }

  return (
    <section className="calendar-page" aria-label={t("calendar.title")}>
      <ShellTopMenu
        as="header"
        ariaLabel={t("calendar.topMenu")}
        className="calendar-top-menu"
        contentClassName="calendar-top-menu-content"
        content={(
          <div className="calendar-top-menu-title">
            <CalendarIcon />
            <span>{t("calendar.title")}</span>
          </div>
        )}
        dragRegion
        trailing={windowControls}
        trailingClassName="calendar-top-menu-window-controls"
      />

      <div className="calendar-toolbar">
        <div className="calendar-toolbar-spacer" aria-hidden="true" />

        <div className="calendar-date-controls" aria-label={t("calendar.dateNavigation")}>
          <button
            type="button"
            className="calendar-period-step"
            aria-label={t("calendar.previousRange")}
            title={t("calendar.previous")}
            onClick={() => moveAnchor(-1)}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <div className="calendar-period-picker">
            <button
              type="button"
              className="calendar-period-title"
              aria-haspopup="dialog"
              aria-expanded={isDatePickerOpen}
              aria-label={t("calendar.changeDate", { range: currentViewLabel })}
              onClick={() => setIsDatePickerOpen((current) => !current)}
            >
              <h1>{currentViewLabel}</h1>
              <span aria-hidden="true">⌄</span>
            </button>
            {isDatePickerOpen ? (
              <div className="calendar-date-popover" role="dialog" aria-label={t("calendar.chooseDate")}>
                <label>
                  {t("calendar.jumpToDate")}
                  <input
                    type="date"
                    value={getDateKey(anchorDate)}
                    onChange={(event) => {
                      const nextDate = parseDateKey(event.currentTarget.value)
                      if (nextDate) selectAnchorDate(nextDate)
                    }}
                  />
                </label>
                <button type="button" className="calendar-date-popover-today" onClick={() => selectAnchorDate(new Date())}>
                  {t("calendar.today")}
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="calendar-period-step"
            aria-label={t("calendar.nextRange")}
            title={t("calendar.next")}
            onClick={() => moveAnchor(1)}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>

        <div className="calendar-toolbar-actions">
          <div className="calendar-view-switcher" aria-label={t("calendar.view")}>
            {VIEW_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={joinClassNames("calendar-view-button", viewMode === mode && "is-active")}
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
              >
                {getViewModeLabel(mode, t)}
              </button>
            ))}
          </div>
        </div>

      </div>

      {calendarContextMenu ? (
        <div className="calendar-context-menu-layer" role="presentation" onClick={() => setCalendarContextMenu(null)}>
          <div
            className="calendar-context-menu"
            role="menu"
            aria-label={t("calendar.slotActions")}
            style={{ left: calendarContextMenu.x, top: calendarContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => openQuickAddDialog("todo", calendarContextMenu.context)}
            >
              <span>{t("calendar.newTodo")}</span>
              <small>{formatQuickAddContext(calendarContextMenu.context, locale, t)}</small>
            </button>
          </div>
        </div>
      ) : null}

      {calendarItemContextMenu ? (
        <div className="calendar-context-menu-layer" role="presentation" onClick={() => setCalendarItemContextMenu(null)}>
          <div
            className="calendar-context-menu calendar-item-context-menu"
            role="menu"
            aria-label={t("calendar.itemActions", {
              title: calendarItemContextMenuItem?.title ?? t("calendar.itemFallback"),
            })}
            style={{ left: calendarItemContextMenu.x, top: calendarItemContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              className="calendar-context-menu-danger"
              disabled={!canDeleteCalendarItem(calendarItemContextMenuItem)}
              onClick={() => {
                if (!canDeleteCalendarItem(calendarItemContextMenuItem)) return
                deleteItem(calendarItemContextMenu.itemId)
                setCalendarItemContextMenu(null)
              }}
            >
              <DeleteIcon />
              <span>{t("calendar.delete")}</span>
            </button>
          </div>
        </div>
      ) : null}

      {isQuickAddOpen ? (
        <div
          className="calendar-quick-add-overlay"
          role="presentation"
          onClick={closeQuickAddDialog}
        >
          <section
            className="calendar-quick-add-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-quick-add-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeQuickAddDialog()
            }}
          >
            <header className="calendar-quick-add-dialog-header">
              <h2 id="calendar-quick-add-title">
                {quickAddMode === "todo" ? t("calendar.newTodo") : t("calendar.createEvent")}
              </h2>
              <button
                type="button"
                className="calendar-quick-add-close"
                aria-label={t("calendar.closeQuickAdd")}
                onClick={closeQuickAddDialog}
              >
                <CloseIcon />
              </button>
            </header>

            <form
              className="calendar-quick-add-form"
              aria-label={quickAddMode === "todo" ? t("calendar.newTodoDetails") : t("calendar.createEventDetails")}
              aria-busy={isCreatingQuickAdd}
              onSubmit={handleQuickAdd}
            >
              <div className="calendar-quick-add-summary">
                <span>{quickAddMode === "todo" ? t("calendar.todo") : t("calendar.event")}</span>
                <strong>
                  {quickAddContext ? formatQuickAddContext(quickAddContext, locale, t) : (
                    quickAddMode === "todo" ? t("calendar.unscheduledTodo") : t("calendar.newCalendarEvent")
                  )}
                </strong>
              </div>
              <label className="calendar-quick-add-field">
                <span>{t("calendar.titleLabel")}</span>
                <input
                  aria-label={quickAddMode === "todo" ? t("calendar.todoTitle") : t("calendar.eventTitle")}
                  autoFocus
                  value={quickAddText}
                  placeholder={quickAddMode === "todo" ? t("calendar.todoTitlePlaceholder") : t("calendar.eventTitlePlaceholder")}
                  onChange={(event) => {
                    setQuickAddText(event.target.value)
                    setQuickAddError(null)
                  }}
                />
              </label>

              {quickAddMode === "event" ? (
                <>
                  <label className="calendar-quick-add-field">
                    <span>{t("calendar.calendarLabel")}</span>
                    <select
                      aria-label={t("calendar.calendarLabel")}
                      value={quickAddSourceId}
                      onChange={(event) => {
                        setQuickAddSourceId(event.target.value)
                        setQuickAddError(null)
                      }}
                    >
                      {sources.map((source) => (
                        <option key={source.id} value={source.id}>{source.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="calendar-quick-add-field">
                    <span>{t("calendar.status")}</span>
                    <select
                      aria-label={t("calendar.status")}
                      value={quickAddStatus}
                      onChange={(event) => {
                        setQuickAddStatus(event.target.value as CalendarEventStatus)
                        setQuickAddError(null)
                      }}
                    >
                      {getCreateEventStatusOptions(t).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}

              <label className="calendar-quick-add-field">
                <span>{t("calendar.project")}</span>
                <select
                  aria-label={t("calendar.project")}
                  value={quickAddWorkspace}
                  onChange={(event) => {
                    setQuickAddWorkspace(event.target.value)
                    setQuickAddError(null)
                  }}
                >
                  <option value="">{t("calendar.noProject")}</option>
                  {quickAddProjectOptions.map((project) => (
                    <option key={project.id} value={project.id}>{getProjectOptionLabel(project)}</option>
                  ))}
                </select>
              </label>

              <label className="calendar-quick-add-field">
                <span>{t("calendar.notes")}</span>
                <textarea
                  aria-label={t("calendar.notes")}
                  value={quickAddNotes}
                  placeholder={t("calendar.notesPlaceholder")}
                  onChange={(event) => {
                    setQuickAddNotes(event.target.value)
                    setQuickAddError(null)
                  }}
                />
              </label>

              <div className="calendar-quick-add-meta">
                <div>
                  <span>{quickAddMode === "todo" ? t("calendar.project") : t("calendar.calendarLabel")}</span>
                  <strong>
                    {quickAddMode === "todo"
                      ? getProjectDisplayName(quickAddWorkspace, quickAddProjectOptions, t)
                      : sourceById.get(quickAddSourceId)?.name ?? t("calendar.notSelected")}
                  </strong>
                </div>
                <div>
                  <span>{t("calendar.dateField")}</span>
                  <strong>{quickAddMode === "todo" ? "scheduledStartAt" : "startAt"}</strong>
                </div>
              </div>

              {quickAddError ? (
                <p className="calendar-quick-add-error" role="alert">{quickAddError}</p>
              ) : null}

              <div className="calendar-quick-add-actions">
                <button type="button" className="calendar-secondary-action" onClick={closeQuickAddDialog}>
                  {t("calendar.cancel")}
                </button>
                <button
                  type="submit"
                  className="calendar-primary-action"
                  aria-label={quickAddMode === "todo" ? t("calendar.createTodo") : t("calendar.createEvent")}
                  disabled={isCreatingQuickAdd || !quickAddText.trim() || (quickAddMode === "event" && !quickAddSourceId)}
                >
                  {isCreatingQuickAdd ? t("calendar.creating") : t("calendar.create")}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <div className="calendar-shell">
        <CalendarSourcesPanel
          isQuickAddOpen={isQuickAddOpen}
          isProjectFilterOpen={isTodoProjectFilterOpen}
          locale={locale}
          projects={projects}
          projectFilterOptions={todoProjectFilterOptions}
          searchQuery={searchQuery}
          selectedProjectFilterID={activeTodoProjectID}
          todoSummary={todoSummary}
          todoItems={unscheduledTasks}
          t={t}
          onCreateTodo={() => openQuickAddDialog("todo", null, getSidebarQuickAddWorkspace())}
          onSearchQueryChange={setSearchQuery}
          onItemSelect={setSelectedItemId}
          onTodoDragOver={handleUnscheduledTodoDragOver}
          onTodoDrop={handleUnscheduledTodoDrop}
          onProjectFilterSelect={(projectId) => {
            setSelectedTodoProjectID(projectId)
            setIsTodoProjectFilterOpen(false)
          }}
          onProjectFilterToggle={() => setIsTodoProjectFilterOpen((current) => !current)}
        />

        <main className="calendar-main" aria-label={t("calendar.viewAria", { view: getViewModeLabel(viewMode, t) })}>
          {calendarData.error ? (
            <p className="calendar-data-status is-error" role="alert">
              {t("calendar.dataUnavailable", { message: calendarData.error })}
            </p>
          ) : calendarData.isLoading ? (
            <p className="calendar-data-status" role="status">{t("calendar.loadingData")}</p>
          ) : null}
          <div className="calendar-main-stage">
            {viewMode === "day" ? (
              <TimeGrid
                days={[anchorDate]}
                items={visibleItems}
                locale={locale}
                sourceById={sourceById}
                t={t}
                onAllDayDrop={handleAllDayDrop}
                onCellDrop={handleCellDrop}
                onCreateEvent={handleSlotContextMenu}
                onItemContextMenu={handleItemContextMenu}
                onItemDragStart={handleItemDragStart}
                onItemSelect={setSelectedItemId}
              />
            ) : viewMode === "week" ? (
              <TimeGrid
                days={Array.from({ length: 7 }, (_item, index) => addDays(weekStart, index))}
                items={visibleItems}
                locale={locale}
                sourceById={sourceById}
                t={t}
                onAllDayDrop={handleAllDayDrop}
                onCellDrop={handleCellDrop}
                onCreateEvent={handleSlotContextMenu}
                onItemContextMenu={handleItemContextMenu}
                onItemDragStart={handleItemDragStart}
                onItemSelect={setSelectedItemId}
              />
            ) : viewMode === "month" ? (
              <MonthGrid
                anchorDate={anchorDate}
                items={visibleItems}
                locale={locale}
                sourceById={sourceById}
                onDayDrop={handleAllDayDrop}
                onCreateEvent={handleSlotContextMenu}
                onItemContextMenu={handleItemContextMenu}
                onItemDragStart={handleItemDragStart}
                onItemSelect={setSelectedItemId}
              />
            ) : (
              <ScheduleList
                anchorDate={anchorDate}
                items={visibleItems}
                locale={locale}
                sourceById={sourceById}
                t={t}
                onItemContextMenu={handleItemContextMenu}
                onItemDragStart={handleItemDragStart}
                onItemSelect={setSelectedItemId}
              />
            )}
          </div>
        </main>

        <CalendarDetailPanel
          item={selectedItem}
          locale={locale}
          projects={projects}
          source={selectedItem ? sourceById.get(selectedItem.sourceId) : undefined}
          sources={sources}
          t={t}
          onAcceptSuggestion={acceptSuggestion}
          onDismissSuggestion={dismissSuggestion}
          onDelete={deleteItem}
          onItemUpdate={updateItem}
        />
      </div>
    </section>
  )
}

interface CalendarSourcesPanelProps {
  isQuickAddOpen: boolean
  isProjectFilterOpen: boolean
  locale: AppLocale
  projects: CalendarProjectOption[]
  projectFilterOptions: ProjectSummary[]
  searchQuery: string
  selectedProjectFilterID: string
  t: CalendarTranslate
  todoSummary: TodoSummary
  todoItems: CalendarItem[]
  onCreateTodo: () => void
  onItemSelect: (itemId: string) => void
  onProjectFilterSelect: (projectId: string) => void
  onProjectFilterToggle: () => void
  onSearchQueryChange: (query: string) => void
  onTodoDragOver: (event: DragEvent<HTMLElement>) => void
  onTodoDrop: (event: DragEvent<HTMLElement>) => void
}

function CalendarSourcesPanel({
  isQuickAddOpen,
  isProjectFilterOpen,
  locale,
  projects,
  projectFilterOptions,
  searchQuery,
  selectedProjectFilterID,
  t,
  todoSummary,
  todoItems,
  onCreateTodo,
  onItemSelect,
  onProjectFilterSelect,
  onProjectFilterToggle,
  onSearchQueryChange,
  onTodoDragOver,
  onTodoDrop,
}: CalendarSourcesPanelProps) {
  const selectedProject = projectFilterOptions.find((project) => project.id === selectedProjectFilterID) ?? projectFilterOptions[0]

  return (
    <aside
      className="calendar-sources-panel"
      aria-label={t("calendar.sidebar")}
      onDragOver={onTodoDragOver}
      onDrop={onTodoDrop}
    >
      <div className="calendar-source-search-row">
        <label className="calendar-source-search">
          <SearchIcon />
          <input
            value={searchQuery}
            placeholder={t("calendar.searchTodos")}
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="calendar-source-add-button"
          aria-haspopup="dialog"
          aria-expanded={isQuickAddOpen}
          aria-label={t("calendar.newTodo")}
          title={t("calendar.newTodo")}
          onClick={onCreateTodo}
        >
          <PlusIcon />
        </button>
      </div>

      <div className="calendar-project-filter">
        <button
          type="button"
          className="calendar-project-filter-trigger"
          aria-haspopup="listbox"
          aria-expanded={isProjectFilterOpen}
          aria-label={t("calendar.projectFilter", { project: selectedProject?.name ?? t("calendar.allProjects") })}
          title={selectedProject?.name ?? t("calendar.allProjects")}
          onClick={onProjectFilterToggle}
        >
          <span>{t("calendar.projectPrefix", { project: selectedProject?.name ?? t("calendar.allProjects") })}</span>
          <strong>{selectedProject?.count ?? 0}</strong>
        </button>
        {isProjectFilterOpen ? (
          <div className="calendar-project-filter-menu" role="listbox" aria-label={t("calendar.todoProjectFilter")}>
            {projectFilterOptions.map((project) => (
              <button
                key={project.id}
                type="button"
                role="option"
                className={joinClassNames(
                  "calendar-project-filter-option",
                  project.id === selectedProjectFilterID && "is-selected",
                )}
                aria-selected={project.id === selectedProjectFilterID}
                title={project.name}
                onClick={() => onProjectFilterSelect(project.id)}
              >
                <span>{project.name}</span>
                <strong>{project.count}</strong>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <section className="calendar-source-section" aria-label={t("calendar.unscheduledTodos")}>
        <div className="calendar-section-heading">
          <h2>{t("calendar.todos")}</h2>
          <span>{t("calendar.unscheduledCount", { count: todoSummary.unscheduled })}</span>
        </div>
        <div className="calendar-unscheduled-list">
          {todoItems.length > 0 ? todoItems.map((task) => (
            <button
              key={task.id}
              type="button"
              className="calendar-unscheduled-task"
              draggable
              onClick={() => onItemSelect(task.id)}
              onDragStart={(event) => {
                event.dataTransfer.setData("text/calendar-item-id", task.id)
                event.dataTransfer.effectAllowed = "move"
              }}
            >
              <span>{task.title}</span>
              <small>{getSidebarTodoMeta(task, projects, locale, t)}</small>
            </button>
          )) : (
            <p className="calendar-empty-note">{t("calendar.emptyUnscheduledTodos")}</p>
          )}
        </div>
      </section>
    </aside>
  )
}

interface TimeGridProps {
  days: Date[]
  items: CalendarItem[]
  locale: AppLocale
  sourceById: Map<string, CalendarSource>
  t: CalendarTranslate
  onAllDayDrop: (event: DragEvent<HTMLElement>, day: Date) => void
  onCellDrop: (event: DragEvent<HTMLDivElement>, day: Date, hour: number) => void
  onCreateEvent: (event: MouseEvent<HTMLElement>, context: QuickAddContext) => void
  onItemContextMenu: (event: MouseEvent<HTMLElement>, item: CalendarItem) => void
  onItemDragStart: (event: DragEvent<HTMLElement>, item: CalendarItem) => void
  onItemSelect: (itemId: string) => void
}

function TimeGrid({
  days,
  items,
  locale,
  sourceById,
  t,
  onAllDayDrop,
  onCellDrop,
  onCreateEvent,
  onItemContextMenu,
  onItemDragStart,
  onItemSelect,
}: TimeGridProps) {
  const timedItems = items.filter((item) => item.startAt && !item.allDay)
  const allDayItems = items.filter((item) => item.startAt && item.allDay)
  const columnTemplate = `64px repeat(${days.length}, minmax(124px, 1fr))`

  return (
    <div className="calendar-time-grid-wrap">
      <div className="calendar-time-grid" style={{ gridTemplateColumns: columnTemplate }}>
        <div className="calendar-grid-corner" />
        {days.map((day) => (
          <div key={getDateKey(day)} className={joinClassNames("calendar-day-header", isSameDay(day, new Date()) && "is-today")}>
            <span>{formatWeekdayLabel(day, locale)}</span>
            <strong>{day.getDate()}</strong>
          </div>
        ))}

        <div className="calendar-time-label is-all-day">{t("calendar.allDay")}</div>
        {days.map((day) => (
          <div
            key={`all-day-${getDateKey(day)}`}
            className="calendar-all-day-cell"
            data-calendar-date={getDateKey(day)}
            data-calendar-slot="all-day"
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = "move"
            }}
            onDrop={(event) => onAllDayDrop(event, day)}
            onContextMenu={(event) => {
              const startAt = startOfDay(day)
              onCreateEvent(event, {
                startAt,
                endAt: addDays(startAt, 1),
                allDay: true,
              })
            }}
          >
            {allDayItems
              .filter((item) => item.startAt && isSameDay(item.startAt, day))
              .map((item) => (
                <CalendarEventChip
                  key={item.id}
                  item={item}
                  locale={locale}
                  source={sourceById.get(item.sourceId)}
                  t={t}
                  onClick={() => onItemSelect(item.id)}
                  onContextMenu={(event) => onItemContextMenu(event, item)}
                  onDragStart={(event) => onItemDragStart(event, item)}
                />
              ))}
          </div>
        ))}

        {HOURS.map((hour) => (
          <Fragment key={`hour-row-${hour}`}>
            <div key={`time-${hour}`} className="calendar-time-label">{formatHourLabel(hour, locale)}</div>
            {days.map((day) => {
              const cellItems = timedItems.filter((item) => (
                item.startAt && isSameDay(item.startAt, day) && getHourKey(item.startAt) === hour
              ))

              return (
                <div
                  key={`${getDateKey(day)}-${hour}`}
                  role="gridcell"
                  className="calendar-time-cell"
                  aria-label={t("calendar.scheduleAt", { date: formatDayLabel(day, locale), time: formatHourLabel(hour, locale) })}
                  data-calendar-date={getDateKey(day)}
                  data-calendar-hour={hour}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = "move"
                  }}
                  onDrop={(event) => onCellDrop(event, day, hour)}
                  onContextMenu={(event) => {
                    const startAt = setTime(day, hour)
                    onCreateEvent(event, {
                      startAt,
                      endAt: addMinutes(startAt, 60),
                      allDay: false,
                    })
                  }}
                >
                  {cellItems.map((item) => (
                    <CalendarEventChip
                      key={item.id}
                      item={item}
                      locale={locale}
                      source={sourceById.get(item.sourceId)}
                      t={t}
                      onClick={() => onItemSelect(item.id)}
                      onContextMenu={(event) => onItemContextMenu(event, item)}
                      onDragStart={(event) => onItemDragStart(event, item)}
                    />
                  ))}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

interface CalendarEventChipProps {
  item: CalendarItem
  locale: AppLocale
  source?: CalendarSource
  t: CalendarTranslate
  onClick: () => void
  onContextMenu: (event: MouseEvent<HTMLElement>) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
}

function CalendarEventChip({ item, locale, source, t, onClick, onContextMenu, onDragStart }: CalendarEventChipProps) {
  const isMovable = item.entityType !== "agent_suggestion"
  return (
    <span
      role="button"
      tabIndex={0}
      className={joinClassNames("calendar-event-chip", item.isSuggestion && "is-suggestion")}
      draggable={isMovable}
      style={{ borderLeftColor: getItemAccentColor(item, source) }}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      onDragStart={(event) => onDragStart(event)}
      onContextMenu={(event) => {
        onContextMenu(event)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onClick()
        }
      }}
    >
      <span>{item.title}</span>
      <small>{item.isSuggestion ? t("calendar.suggested") : item.startAt ? formatTime(item.startAt, locale) : getItemTypeLabel(item, t)}</small>
    </span>
  )
}

interface MonthGridProps {
  anchorDate: Date
  items: CalendarItem[]
  locale: AppLocale
  sourceById: Map<string, CalendarSource>
  onDayDrop: (event: DragEvent<HTMLElement>, day: Date) => void
  onCreateEvent: (event: MouseEvent<HTMLElement>, context: QuickAddContext) => void
  onItemContextMenu: (event: MouseEvent<HTMLElement>, item: CalendarItem) => void
  onItemDragStart: (event: DragEvent<HTMLElement>, item: CalendarItem) => void
  onItemSelect: (itemId: string) => void
}

function MonthGrid({
  anchorDate,
  items,
  locale,
  sourceById,
  onDayDrop,
  onCreateEvent,
  onItemContextMenu,
  onItemDragStart,
  onItemSelect,
}: MonthGridProps) {
  const monthStart = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1)
  const gridStart = startOfWeek(monthStart)
  const days = Array.from({ length: 42 }, (_item, index) => addDays(gridStart, index))
  const datedItems = items.filter((item) => item.startAt)

  return (
    <div className="calendar-month-view">
      {Array.from({ length: 7 }, (_item, index) => (
        <div key={index} className="calendar-month-weekday">{formatWeekdayLabelForIndex(index, locale)}</div>
      ))}
      {days.map((day) => {
        const dayItems = datedItems.filter((item) => item.startAt && isSameDay(item.startAt, day))
        return (
          <section
            key={getDateKey(day)}
            data-calendar-date={getDateKey(day)}
            className={joinClassNames(
              "calendar-month-day",
              day.getMonth() !== anchorDate.getMonth() && "is-muted",
              isSameDay(day, new Date()) && "is-today",
            )}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = "move"
            }}
            onDrop={(event) => onDayDrop(event, day)}
            onContextMenu={(event) => {
              const startAt = startOfDay(day)
              onCreateEvent(event, {
                startAt,
                endAt: addDays(startAt, 1),
                allDay: true,
              })
            }}
          >
            <div className="calendar-month-day-number">{day.getDate()}</div>
            <div className="calendar-month-day-items">
              {dayItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={joinClassNames("calendar-month-item", item.isSuggestion && "is-suggestion")}
                  draggable={item.entityType !== "agent_suggestion"}
                  style={{ borderLeftColor: getItemAccentColor(item, sourceById.get(item.sourceId)) }}
                  onClick={() => onItemSelect(item.id)}
                  onDragStart={(event) => onItemDragStart(event, item)}
                  onContextMenu={(event) => {
                    onItemContextMenu(event, item)
                  }}
                >
                  {item.title}
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

interface ScheduleListProps {
  anchorDate: Date
  items: CalendarItem[]
  locale: AppLocale
  sourceById: Map<string, CalendarSource>
  t: CalendarTranslate
  onItemContextMenu: (event: MouseEvent<HTMLElement>, item: CalendarItem) => void
  onItemDragStart: (event: DragEvent<HTMLElement>, item: CalendarItem) => void
  onItemSelect: (itemId: string) => void
}

function ScheduleList({ anchorDate, items, locale, sourceById, t, onItemContextMenu, onItemDragStart, onItemSelect }: ScheduleListProps) {
  const rangeStart = startOfDay(anchorDate)
  const rangeEnd = addDays(rangeStart, 14)
  const scheduledItems = items
    .filter((item) => item.startAt && item.startAt >= rangeStart && item.startAt <= rangeEnd)
    .sort((left, right) => (left.startAt?.getTime() ?? 0) - (right.startAt?.getTime() ?? 0))
  const groups = scheduledItems.reduce<Record<string, CalendarItem[]>>((accumulator, item) => {
    if (!item.startAt) return accumulator
    const key = getDateKey(item.startAt)
    accumulator[key] ??= []
    accumulator[key].push(item)
    return accumulator
  }, {})

  return (
    <div className="calendar-schedule-view">
      {Object.entries(groups).map(([key, groupItems]) => (
        <section key={key} className="calendar-schedule-group">
          <h2>{formatDayLabel(groupItems[0].startAt!, locale)}</h2>
          <div className="calendar-schedule-items">
            {groupItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={joinClassNames("calendar-schedule-item", item.isSuggestion && "is-suggestion")}
                draggable={item.entityType !== "agent_suggestion"}
                onClick={() => onItemSelect(item.id)}
                onDragStart={(event) => onItemDragStart(event, item)}
                onContextMenu={(event) => onItemContextMenu(event, item)}
              >
                <span className="calendar-schedule-time">{item.allDay ? t("calendar.allDay") : item.startAt ? formatTime(item.startAt, locale) : ""}</span>
                <span className="calendar-schedule-copy">
                  <strong>{item.title}</strong>
                  <small>
                    <span style={{ backgroundColor: getItemAccentColor(item, sourceById.get(item.sourceId)) }} />
                    {getScheduleListSourceLabel(item, sourceById.get(item.sourceId), t)}
                  </small>
                </span>
                <ChevronRightIcon />
              </button>
            ))}
          </div>
        </section>
      ))}
      {scheduledItems.length === 0 ? <p className="calendar-empty-state">{t("calendar.noVisibleItemsTwoWeeks")}</p> : null}
    </div>
  )
}

interface CalendarDetailPanelProps {
  item: CalendarItem | null
  locale: AppLocale
  projects: CalendarProjectOption[]
  source?: CalendarSource
  sources: CalendarSource[]
  t: CalendarTranslate
  onAcceptSuggestion: (item: CalendarItem) => void
  onDelete: (itemId: string) => void
  onDismissSuggestion: (itemId: string) => void
  onItemUpdate: (itemId: string, update: Partial<CalendarItem>) => void
}

function CalendarDetailPanel({
  item,
  locale,
  projects,
  source,
  sources,
  t,
  onAcceptSuggestion,
  onDelete,
  onDismissSuggestion,
  onItemUpdate,
}: CalendarDetailPanelProps) {
  if (!item) {
    return (
      <aside className="calendar-detail-panel" aria-label={t("calendar.details")}>
        <div className="calendar-detail-empty">
          <CalendarIcon />
          <h2>{t("calendar.selectItemTitle")}</h2>
          <p>{t("calendar.selectItemCopy")}</p>
        </div>
      </aside>
    )
  }
  const sourceOptions = sources
  const sourceOptionsWithCurrent = source && !sourceOptions.some((candidate) => candidate.id === source.id)
    ? [source, ...sourceOptions]
    : sourceOptions
  const statusOptions = getStatusOptions(item, t)
  const statusValue = item.status ?? (item.entityType === "task" ? "todo" : "scheduled")
  const useSegmentedStatus = statusOptions.length === 2
  const isTaskLikeItem = item.entityType === "task"
  const projectValue = resolveProjectValue(item.workspace, projects)
  const hasLegacyProject = hasLegacyProjectValue(item.workspace, projects)

  return (
    <aside className="calendar-detail-panel" aria-label={t("calendar.details")}>
      <div className="calendar-detail-heading">
        <span className="calendar-detail-type">{getItemTypeLabel(item, t)}</span>
        <textarea
          className="calendar-detail-title-input"
          aria-label={t("calendar.titleLabel")}
          value={item.title}
          rows={getDetailTitleRows(item.title)}
          onChange={(event) => onItemUpdate(item.id, { title: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
        />
        <p>{formatDateTimeRange(item, locale, t)}</p>
      </div>

      <div className="calendar-detail-form">
        {item.entityType === "event" ? (
          <label className="calendar-detail-field-row">
            <span>{t("calendar.calendarLabel")}</span>
            <select
              value={item.sourceId}
              onChange={(event) => onItemUpdate(item.id, { sourceId: event.target.value })}
            >
              {sourceOptionsWithCurrent.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
          </label>
        ) : null}

        {useSegmentedStatus ? (
          <div className="calendar-detail-field-row">
            <span>{t("calendar.status")}</span>
            <div className="calendar-status-segmented" role="radiogroup" aria-label={t("calendar.status")}>
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={statusValue === option.value}
                  className={joinClassNames(
                    "calendar-status-segment",
                    statusValue === option.value && "is-selected",
                  )}
                  onClick={() => {
                    if (statusValue !== option.value) {
                      onItemUpdate(item.id, { status: option.value })
                    }
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <label className="calendar-detail-field-row">
            <span>{t("calendar.status")}</span>
            <select
              value={statusValue}
              onChange={(event) => onItemUpdate(item.id, { status: event.target.value as CalendarItem["status"] })}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        )}

        <label className="calendar-detail-field-row">
          <span>{t("calendar.project")}</span>
          <select
            value={projectValue}
            onChange={(event) => onItemUpdate(item.id, { workspace: event.target.value })}
          >
            <option value="">{t("calendar.noProject")}</option>
            {hasLegacyProject ? (
              <option value={projectValue}>{item.workspace}</option>
            ) : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{getProjectOptionLabel(project)}</option>
            ))}
          </select>
        </label>

        <label>
          {t("calendar.notes")}
          <textarea
            value={item.description ?? ""}
            rows={4}
            placeholder={t("calendar.notesPlaceholder")}
            onChange={(event) => onItemUpdate(item.id, { description: event.target.value })}
          />
        </label>
      </div>

      <div className="calendar-detail-meta">
        <div>
          <span>{item.entityType === "event" ? t("calendar.calendarLabel") : t("calendar.context")}</span>
          <strong>{item.entityType === "event" ? source?.name ?? t("calendar.unknown") : getItemTypeLabel(item, t)}</strong>
        </div>
        <div>
          <span>{t("calendar.dateField")}</span>
          <strong>{getDateFieldLabel(item)}</strong>
        </div>
      </div>

      <div className="calendar-detail-actions">
        {item.entityType === "agent_suggestion" ? (
          <>
            <button type="button" className="calendar-primary-action" onClick={() => onAcceptSuggestion(item)}>
              {t("calendar.acceptSuggestion")}
            </button>
            <button type="button" className="calendar-secondary-action" onClick={() => onDismissSuggestion(item.id)}>
              {t("calendar.dismiss")}
            </button>
          </>
        ) : (
          <>
            {item.entityType === "event" || isTaskLikeItem ? (
              <button
                type="button"
                className="calendar-danger-action"
                disabled={item.isReadOnly}
                onClick={() => onDelete(item.id)}
              >
                {t("calendar.delete")}
              </button>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}
