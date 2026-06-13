import { Fragment, useMemo, useRef, useState, type DragEvent, type FormEvent, type MouseEvent, type ReactNode } from "react"
import {
  AutomationIcon,
  CalendarIcon,
  ChevronRightIcon,
  CloseIcon,
  DeleteIcon,
  SearchIcon,
} from "../icons"
import { ShellTopMenu, joinClassNames } from "../shared-ui"
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
  activeProjectID?: string | null
  projects?: CalendarProjectOption[]
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
type CalendarOverlayKey = "deadlines" | "reminders" | "agent"

interface TodoSummary {
  inbox: number
  scheduled: number
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

const CREATE_EVENT_STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "canceled", label: "Canceled" },
] satisfies Array<{ value: CalendarEventStatus; label: string }>

const TODO_COLOR = "#8a5cf6"
const DEADLINE_COLOR = "#c47a2c"
const REMINDER_COLOR = "#d94d64"
const AGENT_COLOR = "#64748b"

const HOURS = Array.from({ length: 12 }, (_item, index) => index + 8)
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const VIEW_MODES: CalendarViewMode[] = ["day", "week", "month", "schedule"]
const CALENDAR_CONTEXT_MENU_WIDTH = 240
const CALENDAR_SLOT_CONTEXT_MENU_HEIGHT = 96
const CALENDAR_ITEM_CONTEXT_MENU_HEIGHT = 46

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

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date)
}

function formatDayLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", weekday: "short" }).format(date)
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date)
}

function formatDateTimeRange(item: CalendarItem) {
  if (!item.startAt) return "Not scheduled"
  if (item.allDay) return `${formatDayLabel(item.startAt)} - All day`
  const endLabel = item.endAt ? `-${formatTime(item.endAt)}` : ""
  return `${formatDayLabel(item.startAt)}, ${formatTime(item.startAt)}${endLabel}`
}

function getEntityLabel(type: CalendarEntityType) {
  switch (type) {
    case "event":
      return "Event"
    case "task":
      return "Todo"
    case "project":
      return "Project"
    case "reminder":
      return "Reminder"
    case "agent_suggestion":
      return "Suggestion"
  }
}

function getDisplayKindLabel(displayKind: CalendarDisplayKind | undefined) {
  switch (displayKind) {
    case "external_event":
      return "Event"
    case "scheduled_todo":
      return "Todo"
    case "deadline":
      return "Deadline"
    case "reminder":
      return "Reminder"
    case "agent_suggestion":
      return "Suggestion"
    default:
      return null
  }
}

function getItemTypeLabel(item: CalendarItem) {
  return getDisplayKindLabel(item.displayKind) ?? getEntityLabel(item.entityType)
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

function getItemAccentColor(item: CalendarItem, source?: CalendarSource) {
  return source?.color ?? item.color ?? (
    item.displayKind === "deadline" ? DEADLINE_COLOR :
    item.displayKind === "reminder" ? REMINDER_COLOR :
    item.displayKind === "agent_suggestion" ? AGENT_COLOR :
    item.entityType === "task" ? TODO_COLOR :
    "#64748b"
  )
}

function getScheduleListSourceLabel(item: CalendarItem, source?: CalendarSource) {
  return source?.name ?? getItemTypeLabel(item)
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

function getProjectDisplayName(value: string | undefined, projects: CalendarProjectOption[]) {
  const normalized = value?.trim()
  if (!normalized) return "Inbox"
  const resolved = resolveProjectValue(normalized, projects)
  return projects.find((project) => project.id === resolved)
    ? getProjectOptionLabel(projects.find((project) => project.id === resolved)!)
    : normalized
}

function hasLegacyProjectValue(value: string | undefined, projects: CalendarProjectOption[]) {
  const resolved = resolveProjectValue(value, projects)
  return Boolean(resolved && !projects.some((project) => project.id === resolved))
}

function getStatusOptions(item: CalendarItem) {
  if (item.entityType === "event") {
    return CREATE_EVENT_STATUS_OPTIONS
  }

  if (item.entityType === "task") {
    return [
      { value: "todo", label: "未完成" },
      { value: "done", label: "已完成" },
    ] satisfies Array<{ value: CalendarItem["status"]; label: string }>
  }

  if (item.entityType === "agent_suggestion") {
    return [
      { value: "pending", label: "Pending" },
      { value: "blocked", label: "Blocked" },
    ] satisfies Array<{ value: CalendarItem["status"]; label: string }>
  }

  return [
    { value: "scheduled", label: "Scheduled" },
    { value: "todo", label: "未完成" },
    { value: "done", label: "已完成" },
    { value: "canceled", label: "Canceled" },
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

function itemMatchesQuery(item: CalendarItem, query: string) {
  const normalized = normalizeSearchText(query)
  if (!normalized) return true
  return [
    item.title,
    item.description,
    item.workspace,
    item.status,
    item.entityType,
    getItemTypeLabel(item),
  ].some((value) => value?.toLowerCase().includes(normalized))
}

function canDeleteCalendarItem(item: CalendarItem | undefined) {
  return Boolean(item && item.entityType !== "agent_suggestion" && !item.isReadOnly)
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

function formatQuickAddContext(context: QuickAddContext) {
  if (context.allDay) return `${formatDayLabel(context.startAt)} - All day`
  return `${formatDayLabel(context.startAt)}, ${formatTime(context.startAt)}-${formatTime(context.endAt)}`
}

export function CalendarPage({ activeProjectID = null, projects = [], windowControls }: CalendarPageProps) {
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()))
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week")
  const [localItems, setLocalItems] = useState<CalendarItem[]>([])
  const [enabledOverlays, setEnabledOverlays] = useState<CalendarOverlaysState>({
    agent: true,
    deadlines: true,
    reminders: true,
  })
  const [selectedItemId, setSelectedItemId] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [quickAddMode, setQuickAddMode] = useState<QuickAddMode>("todo")
  const [quickAddText, setQuickAddText] = useState("")
  const [quickAddSourceId, setQuickAddSourceId] = useState("")
  const [quickAddStatus, setQuickAddStatus] = useState<CalendarEventStatus>("scheduled")
  const [quickAddWorkspace, setQuickAddWorkspace] = useState("")
  const [quickAddNotes, setQuickAddNotes] = useState("")
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false)
  const [quickAddContext, setQuickAddContext] = useState<QuickAddContext | null>(null)
  const [calendarContextMenu, setCalendarContextMenu] = useState<CalendarSlotContextMenuState | null>(null)
  const [calendarItemContextMenu, setCalendarItemContextMenu] = useState<CalendarItemContextMenuState | null>(null)
  const itemCounterRef = useRef(0)

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
    () => [...calendarData.items, ...localItems],
    [calendarData.items, localItems],
  )
  const todoItems = calendarData.todos
  const selectableItems = useMemo(
    () => [...items, ...todoItems],
    [items, todoItems],
  )
  const remoteItemIds = useMemo(() => new Set(calendarData.items.map((item) => item.id)), [calendarData.items])
  const remoteTodoIds = useMemo(() => new Set(calendarData.todos.map((item) => item.id)), [calendarData.todos])
  const remoteSourceIds = useMemo(() => new Set(calendarData.sources.map((source) => source.id)), [calendarData.sources])
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
    () => items.filter((item) => itemMatchesQuery(item, searchQuery) && (
      item.displayKind === "deadline" ? enabledOverlays.deadlines :
      item.displayKind === "reminder" ? enabledOverlays.reminders :
      item.displayKind === "agent_suggestion" || item.entityType === "agent_suggestion" ? enabledOverlays.agent :
      item.entityType === "event" ? enabledSourceIds.has(item.sourceId) :
      true
    )),
    [enabledOverlays.agent, enabledOverlays.deadlines, enabledOverlays.reminders, enabledSourceIds, items, searchQuery],
  )
  const unscheduledTasks = useMemo(
    () => todoItems.filter((item) => (
      item.entityType === "task" &&
      !item.startAt &&
      itemMatchesQuery(item, searchQuery)
    )),
    [todoItems, searchQuery],
  )
  const todoSummary = useMemo<TodoSummary>(() => ({
    inbox: todoItems.filter((item) => item.status !== "done").length,
    scheduled: todoItems.filter((item) => Boolean(item.startAt)).length,
    unscheduled: todoItems.filter((item) => !item.startAt).length,
  }), [todoItems])
  const projectSummaries = useMemo<ProjectSummary[]>(() => {
    const counts = new Map<string, ProjectSummary>()
    for (const todo of todoItems) {
      const projectId = resolveProjectValue(todo.workspace, projects) || "inbox"
      const existing = counts.get(projectId)
      counts.set(projectId, {
        count: (existing?.count ?? 0) + 1,
        id: projectId,
        name: getProjectDisplayName(todo.workspace, projects),
      })
    }
    return Array.from(counts.values()).sort((left, right) => left.name.localeCompare(right.name))
  }, [projects, todoItems])
  const overlayCounts = useMemo<Record<CalendarOverlayKey, number>>(() => ({
    agent: items.filter((item) => item.displayKind === "agent_suggestion" || item.entityType === "agent_suggestion").length,
    deadlines: items.filter((item) => item.displayKind === "deadline").length,
    reminders: items.filter((item) => item.displayKind === "reminder").length,
  }), [items])
  const selectedItem = useMemo(
    () => selectableItems.find((item) => item.id === selectedItemId) ?? visibleItems[0] ?? todoItems[0] ?? null,
    [selectableItems, selectedItemId, todoItems, visibleItems],
  )
  const calendarItemContextMenuItem = useMemo(
    () => calendarItemContextMenu
      ? selectableItems.find((item) => item.id === calendarItemContextMenu.itemId)
      : undefined,
    [calendarItemContextMenu, selectableItems],
  )
  const currentViewLabel = viewMode === "day" ? formatDayLabel(anchorDate) : formatMonthLabel(anchorDate)

  function createItemId(prefix: string) {
    itemCounterRef.current += 1
    return `${prefix}-${Date.now()}-${itemCounterRef.current}`
  }

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
      calendarData.patchItem(itemId, update)
      calendarData.patchItem(todoId, update)
      const taskUpdate = toCalendarTaskUpdate(update)
      if (Object.keys(taskUpdate).length > 0) {
        void calendarData.updateTask(todoId, taskUpdate).catch(() => undefined)
      }
      if ("startAt" in update || "endAt" in update) {
        const nextStart = "startAt" in update ? update.startAt : existing.startAt
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

  function toggleSource(sourceId: string) {
    const existing = sources.find((source) => source.id === sourceId)
    if (!existing) return
    const enabled = !existing.enabled
    if (remoteSourceIds.has(sourceId)) {
      calendarData.patchSource(sourceId, { enabled })
      void calendarData.updateSource(sourceId, { enabled }).catch(() => undefined)
    }
  }

  function toggleOverlay(overlay: CalendarOverlayKey) {
    setEnabledOverlays((current) => ({ ...current, [overlay]: !current[overlay] }))
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

  function moveItemToContext(itemId: string, context: QuickAddContext) {
    const item = selectableItems.find((candidate) => candidate.id === itemId)
    if (!item || item.entityType === "agent_suggestion") return

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

  function openQuickAddDialog(mode: QuickAddMode, context: QuickAddContext | null = null) {
    setQuickAddMode(mode)
    setQuickAddText("")
    setQuickAddSourceId(defaultEventSource?.id ?? "")
    setQuickAddStatus("scheduled")
    setQuickAddWorkspace(activeProjectID ?? "")
    setQuickAddNotes("")
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
    const title = quickAddText.trim()
    if (!title) return

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
    const created = quickAddMode === "event" ? (
      sourceId && startAt && endAt ? await calendarData.createEvent({
        title,
        sourceId,
        startAt: startAt.getTime(),
        endAt: endAt.getTime(),
        allDay: context?.allDay ?? false,
        timezone,
        description: notes || undefined,
        status: quickAddStatus,
        linkedWorkspaceId: workspace || undefined,
      }).catch(() => null) : null
    ) : await calendarData.createTask({
      title,
      description: notes || undefined,
      estimateMinutes: startAt && endAt ? Math.max(15, Math.round((endAt.getTime() - startAt.getTime()) / 60000)) : 60,
      priority: "medium",
      scheduledStartAt: startAt?.getTime(),
      scheduledEndAt: endAt?.getTime(),
      status: "todo",
      timezone,
      workspaceId: workspace || undefined,
    }).catch(() => null)
    if (!created) return
    setSelectedItemId(quickAddMode === "todo" && startAt ? getScheduledTodoItemId(created.id) : created.id)
    setQuickAddText("")
    setQuickAddSourceId(defaultEventSource?.id ?? "")
    setQuickAddStatus("scheduled")
    setQuickAddWorkspace(activeProjectID ?? "")
    setQuickAddNotes("")
    setQuickAddContext(null)
    setIsQuickAddOpen(false)
  }

  function closeQuickAddDialog() {
    setQuickAddMode("todo")
    setQuickAddText("")
    setQuickAddSourceId(defaultEventSource?.id ?? "")
    setQuickAddStatus("scheduled")
    setQuickAddWorkspace(activeProjectID ?? "")
    setQuickAddNotes("")
    setQuickAddContext(null)
    setIsQuickAddOpen(false)
  }

  function generateAgentSuggestions() {
    const candidateTasks = unscheduledTasks.slice(0, 2)
    if (candidateTasks.length === 0) return

    const existingSuggestionTargetIds = new Set(
      items.filter((item) => item.entityType === "agent_suggestion").map((item) => item.targetItemId),
    )
    const suggestionDays = [addDays(weekStart, 2), addDays(weekStart, 4)]
    const suggestions = candidateTasks
      .filter((task) => !existingSuggestionTargetIds.has(task.id))
      .map((task, index): CalendarItem => {
        const startAt = setTime(suggestionDays[index] ?? addDays(anchorDate, index + 1), index === 0 ? 11 : 14)
        return {
          id: createItemId("suggestion"),
          title: task.title,
          displayKind: "agent_suggestion",
          entityType: "agent_suggestion",
          sourceId: "agent",
          targetItemId: task.id,
          startAt,
          endAt: addMinutes(startAt, task.estimateMinutes ?? 60),
          allDay: false,
          color: AGENT_COLOR,
          status: "pending",
          isSuggestion: true,
          workspace: task.workspace,
          description: `Suggested from ${getProjectDisplayName(task.workspace, projects)} Todo.`,
        }
      })

    if (suggestions.length === 0) return
    setLocalItems((current) => [...suggestions, ...current])
    setSelectedItemId(suggestions[0].id)
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
    updateItem(itemId, { startAt: undefined, endAt: undefined, allDay: false, status: "todo" })
    const existing = selectableItems.find((item) => item.id === itemId)
    if (existing?.entityType === "task") {
      setSelectedItemId(existing.entityId ?? itemId)
    }
  }

  return (
    <section className="calendar-page" aria-label="Calendar">
      <ShellTopMenu
        as="header"
        ariaLabel="Calendar top menu"
        className="calendar-top-menu"
        contentClassName="calendar-top-menu-content"
        content={(
          <div className="calendar-top-menu-title">
            <CalendarIcon />
            <span>Calendar</span>
          </div>
        )}
        dragRegion
        trailing={windowControls}
        trailingClassName="calendar-top-menu-window-controls"
      />

      <div className="calendar-toolbar">
        <div className="calendar-date-controls" aria-label="Date navigation">
          <button type="button" className="calendar-toolbar-button" onClick={() => moveAnchor(-1)}>
            Prev
          </button>
          <button type="button" className="calendar-toolbar-button" onClick={() => setAnchorDate(startOfDay(new Date()))}>
            Today
          </button>
          <button type="button" className="calendar-toolbar-button" onClick={() => moveAnchor(1)}>
            Next
          </button>
          <h1>{currentViewLabel}</h1>
        </div>

        <div className="calendar-toolbar-center">
          <div className="calendar-view-switcher" aria-label="Calendar view">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={joinClassNames("calendar-view-button", viewMode === mode && "is-active")}
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        <div className="calendar-quick-add">
          <button
            type="button"
            className="calendar-quick-add-trigger"
            aria-haspopup="dialog"
            aria-expanded={isQuickAddOpen}
            aria-label="New Todo"
            onClick={() => openQuickAddDialog("todo")}
          >
            <span>New Todo</span>
          </button>
        </div>
      </div>

      {calendarContextMenu ? (
        <div className="calendar-context-menu-layer" role="presentation" onClick={() => setCalendarContextMenu(null)}>
          <div
            className="calendar-context-menu"
            role="menu"
            aria-label="Calendar slot actions"
            style={{ left: calendarContextMenu.x, top: calendarContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => openQuickAddDialog("todo", calendarContextMenu.context)}
            >
              <span>New Todo</span>
              <small>{formatQuickAddContext(calendarContextMenu.context)}</small>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => openQuickAddDialog("event", calendarContextMenu.context)}
            >
              <span>Create event</span>
              <small>{formatQuickAddContext(calendarContextMenu.context)}</small>
            </button>
          </div>
        </div>
      ) : null}

      {calendarItemContextMenu ? (
        <div className="calendar-context-menu-layer" role="presentation" onClick={() => setCalendarItemContextMenu(null)}>
          <div
            className="calendar-context-menu calendar-item-context-menu"
            role="menu"
            aria-label={`${calendarItemContextMenuItem?.title ?? "Calendar item"} actions`}
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
              <span>Delete</span>
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
              <h2 id="calendar-quick-add-title">{quickAddMode === "todo" ? "New Todo" : "Create event"}</h2>
              <button
                type="button"
                className="calendar-quick-add-close"
                aria-label="Close add calendar item dialog"
                onClick={closeQuickAddDialog}
              >
                <CloseIcon />
              </button>
            </header>

            <form
              className="calendar-quick-add-form"
              aria-label={quickAddMode === "todo" ? "New Todo details" : "Create event details"}
              onSubmit={handleQuickAdd}
            >
              <div className="calendar-quick-add-summary">
                <span>{quickAddMode === "todo" ? "Todo" : "Event"}</span>
                <strong>
                  {quickAddContext ? formatQuickAddContext(quickAddContext) : (
                    quickAddMode === "todo" ? "Unscheduled Todo" : "New calendar event"
                  )}
                </strong>
              </div>
              <label className="calendar-quick-add-field">
                <span>Title</span>
                <input
                  aria-label={quickAddMode === "todo" ? "Todo title" : "Event title"}
                  autoFocus
                  value={quickAddText}
                  placeholder={quickAddMode === "todo" ? "Todo title..." : "Event title..."}
                  onChange={(event) => setQuickAddText(event.target.value)}
                />
              </label>

              {quickAddMode === "event" ? (
                <>
                  <label className="calendar-quick-add-field">
                    <span>Calendar</span>
                    <select
                      aria-label="Calendar"
                      value={quickAddSourceId}
                      onChange={(event) => setQuickAddSourceId(event.target.value)}
                    >
                      {sources.map((source) => (
                        <option key={source.id} value={source.id}>{source.name}</option>
                      ))}
                    </select>
                  </label>

                  <label className="calendar-quick-add-field">
                    <span>Status</span>
                    <select
                      aria-label="Status"
                      value={quickAddStatus}
                      onChange={(event) => setQuickAddStatus(event.target.value as CalendarEventStatus)}
                    >
                      {CREATE_EVENT_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}

              <label className="calendar-quick-add-field">
                <span>Project</span>
                <select
                  aria-label="Project"
                  value={quickAddWorkspace}
                  onChange={(event) => setQuickAddWorkspace(event.target.value)}
                >
                  <option value="">No project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{getProjectOptionLabel(project)}</option>
                  ))}
                </select>
              </label>

              <label className="calendar-quick-add-field">
                <span>Notes</span>
                <textarea
                  aria-label="Notes"
                  value={quickAddNotes}
                  placeholder="Context for this calendar item"
                  onChange={(event) => setQuickAddNotes(event.target.value)}
                />
              </label>

              <div className="calendar-quick-add-meta">
                <div>
                  <span>{quickAddMode === "todo" ? "Project" : "Calendar"}</span>
                  <strong>{quickAddMode === "todo" ? getProjectDisplayName(quickAddWorkspace, projects) : sourceById.get(quickAddSourceId)?.name ?? "Not selected"}</strong>
                </div>
                <div>
                  <span>Date field</span>
                  <strong>{quickAddMode === "todo" ? "scheduledStartAt" : "startAt"}</strong>
                </div>
              </div>

              <div className="calendar-quick-add-actions">
                <button type="button" className="calendar-secondary-action" onClick={closeQuickAddDialog}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="calendar-primary-action"
                  aria-label={quickAddMode === "todo" ? "Create todo" : "Create event"}
                  disabled={quickAddMode === "event" && !quickAddSourceId}
                >
                  Create
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <div className="calendar-shell">
        <CalendarSourcesPanel
          anchorDate={anchorDate}
          enabledOverlays={enabledOverlays}
          overlayCounts={overlayCounts}
          projects={projects}
          searchQuery={searchQuery}
          sources={sources}
          todoSummary={todoSummary}
          unscheduledTasks={unscheduledTasks}
          projectSummaries={projectSummaries}
          onSearchQueryChange={setSearchQuery}
          onAgentPlan={generateAgentSuggestions}
          onItemSelect={setSelectedItemId}
          onOverlayToggle={toggleOverlay}
          onSourceToggle={toggleSource}
        />

        <main className="calendar-main" aria-label={`${viewMode} calendar view`}>
          {calendarData.error ? (
            <p className="calendar-data-status is-error" role="alert">
              Calendar data unavailable: {calendarData.error}
            </p>
          ) : calendarData.isLoading ? (
            <p className="calendar-data-status" role="status">Loading calendar data...</p>
          ) : null}
          <div className="calendar-main-stage">
            {viewMode === "day" ? (
              <TimeGrid
                days={[anchorDate]}
                items={visibleItems}
                sourceById={sourceById}
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
                sourceById={sourceById}
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
                sourceById={sourceById}
                onItemContextMenu={handleItemContextMenu}
                onItemDragStart={handleItemDragStart}
                onItemSelect={setSelectedItemId}
              />
            )}
          </div>
        </main>

        <CalendarDetailPanel
          item={selectedItem}
          projects={projects}
          source={selectedItem ? sourceById.get(selectedItem.sourceId) : undefined}
          sources={sources}
          onAcceptSuggestion={acceptSuggestion}
          onDismissSuggestion={dismissSuggestion}
          onDelete={deleteItem}
          onItemUpdate={updateItem}
          onMoveLater={(item) => {
            if (!item.startAt) return
            const nextStart = addMinutes(item.startAt, 30)
            updateItem(item.id, {
              startAt: nextStart,
              endAt: item.endAt ? addMinutes(item.endAt, 30) : addMinutes(nextStart, item.estimateMinutes ?? 60),
            })
          }}
          onUnschedule={unscheduleItem}
        />
      </div>
    </section>
  )
}

interface CalendarSourcesPanelProps {
  anchorDate: Date
  enabledOverlays: CalendarOverlaysState
  overlayCounts: Record<CalendarOverlayKey, number>
  projects: CalendarProjectOption[]
  searchQuery: string
  sources: CalendarSource[]
  todoSummary: TodoSummary
  unscheduledTasks: CalendarItem[]
  projectSummaries: ProjectSummary[]
  onAgentPlan: () => void
  onItemSelect: (itemId: string) => void
  onOverlayToggle: (overlay: CalendarOverlayKey) => void
  onSearchQueryChange: (query: string) => void
  onSourceToggle: (sourceId: string) => void
}

function CalendarSourcesPanel({
  anchorDate,
  enabledOverlays,
  overlayCounts,
  projects,
  searchQuery,
  sources,
  todoSummary,
  unscheduledTasks,
  projectSummaries,
  onAgentPlan,
  onItemSelect,
  onOverlayToggle,
  onSearchQueryChange,
  onSourceToggle,
}: CalendarSourcesPanelProps) {
  return (
    <aside className="calendar-sources-panel" aria-label="Calendar sidebar">
      <MiniCalendar date={anchorDate} />

      <label className="calendar-source-search">
        <SearchIcon />
        <input
          value={searchQuery}
          placeholder="Search calendar..."
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
      </label>

      <section className="calendar-source-section">
        <div className="calendar-section-heading">
          <h2>Todos</h2>
          <span>{todoSummary.inbox} open</span>
        </div>
        <div className="calendar-todo-summary-list">
          <div className="calendar-todo-summary-row">
            <span>Inbox</span>
            <strong>{todoSummary.inbox}</strong>
          </div>
          <div className="calendar-todo-summary-row">
            <span>Unscheduled</span>
            <strong>{todoSummary.unscheduled}</strong>
          </div>
          <div className="calendar-todo-summary-row">
            <span>Scheduled</span>
            <strong>{todoSummary.scheduled}</strong>
          </div>
        </div>
        <div className="calendar-unscheduled-list">
          {unscheduledTasks.length > 0 ? unscheduledTasks.map((task) => (
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
              <small>{getProjectDisplayName(task.workspace, projects)} - {task.estimateMinutes ?? 60}m</small>
            </button>
          )) : (
            <p className="calendar-empty-note">No unscheduled Todos match this view.</p>
          )}
        </div>
      </section>

      <section className="calendar-source-section">
        <div className="calendar-section-heading">
          <h2>Projects</h2>
          <span>{projectSummaries.length}</span>
        </div>
        <div className="calendar-workspace-list">
          {projectSummaries.length > 0 ? projectSummaries.map((project) => (
            <div key={project.id} className="calendar-workspace-row">
              <span>{project.name}</span>
              <strong>{project.count}</strong>
            </div>
          )) : (
            <p className="calendar-empty-note">No Todo projects yet.</p>
          )}
        </div>
      </section>

      {sources.length > 1 ? (
        <section className="calendar-source-section">
          <div className="calendar-section-heading">
            <h2>Event calendars</h2>
            <span>{sources.filter((source) => source.enabled).length} active</span>
          </div>
          <div className="calendar-source-list">
            {sources.map((source) => (
              <button
                key={source.id}
                type="button"
                className={joinClassNames("calendar-source-row", source.enabled && "is-enabled")}
                aria-pressed={source.enabled}
                onClick={() => onSourceToggle(source.id)}
              >
                <span className="calendar-source-swatch" style={{ backgroundColor: source.color }} />
                <span className="calendar-source-copy">
                  <span>{source.name}</span>
                  {source.subtitle ? <small>{source.subtitle}</small> : null}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="calendar-source-section">
        <div className="calendar-section-heading">
          <h2>Overlays</h2>
          <span>{Object.values(enabledOverlays).filter(Boolean).length} active</span>
        </div>
        <div className="calendar-overlay-list">
          {([
            ["deadlines", "Deadlines"],
            ["reminders", "Reminders"],
            ["agent", "Agent suggestions"],
          ] satisfies Array<[CalendarOverlayKey, string]>).map(([overlay, label]) => (
            <button
              key={overlay}
              type="button"
              className={joinClassNames("calendar-overlay-row", enabledOverlays[overlay] && "is-enabled")}
              aria-pressed={enabledOverlays[overlay]}
              onClick={() => onOverlayToggle(overlay)}
            >
              <span>{label}</span>
              <strong>{overlayCounts[overlay]}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="calendar-agent-panel">
        <div>
          <AutomationIcon />
          <h2>Agent plan</h2>
          <p>Suggest time blocks for unscheduled Todos in this week.</p>
        </div>
        <button type="button" className="calendar-agent-button" onClick={onAgentPlan}>
          Ask Agent
        </button>
      </section>
    </aside>
  )
}

function MiniCalendar({ date }: { date: Date }) {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
  const gridStart = startOfWeek(monthStart)
  const days = Array.from({ length: 35 }, (_item, index) => addDays(gridStart, index))

  return (
    <section className="calendar-mini" aria-label="Mini calendar">
      <h2>{formatMonthLabel(date)}</h2>
      <div className="calendar-mini-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => <span key={label}>{label.slice(0, 1)}</span>)}
      </div>
      <div className="calendar-mini-grid">
        {days.map((day) => (
          <span
            key={getDateKey(day)}
            className={joinClassNames(
              "calendar-mini-day",
              day.getMonth() !== date.getMonth() && "is-muted",
              isSameDay(day, new Date()) && "is-today",
            )}
          >
            {day.getDate()}
          </span>
        ))}
      </div>
    </section>
  )
}

interface TimeGridProps {
  days: Date[]
  items: CalendarItem[]
  sourceById: Map<string, CalendarSource>
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
  sourceById,
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
            <span>{WEEKDAY_LABELS[day.getDay()]}</span>
            <strong>{day.getDate()}</strong>
          </div>
        ))}

        <div className="calendar-time-label is-all-day">All day</div>
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
                  source={sourceById.get(item.sourceId)}
                  onClick={() => onItemSelect(item.id)}
                  onContextMenu={(event) => onItemContextMenu(event, item)}
                  onDragStart={(event) => onItemDragStart(event, item)}
                />
              ))}
          </div>
        ))}

        {HOURS.map((hour) => (
          <Fragment key={`hour-row-${hour}`}>
            <div key={`time-${hour}`} className="calendar-time-label">{String(hour).padStart(2, "0")}:00</div>
            {days.map((day) => {
              const cellItems = timedItems.filter((item) => (
                item.startAt && isSameDay(item.startAt, day) && getHourKey(item.startAt) === hour
              ))

              return (
                <div
                  key={`${getDateKey(day)}-${hour}`}
                  role="gridcell"
                  className="calendar-time-cell"
                  aria-label={`Schedule at ${formatDayLabel(day)} ${hour}:00`}
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
                      source={sourceById.get(item.sourceId)}
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
  source?: CalendarSource
  onClick: () => void
  onContextMenu: (event: MouseEvent<HTMLElement>) => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
}

function CalendarEventChip({ item, source, onClick, onContextMenu, onDragStart }: CalendarEventChipProps) {
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
      <small>{item.isSuggestion ? "Suggested" : item.startAt ? formatTime(item.startAt) : getItemTypeLabel(item)}</small>
    </span>
  )
}

interface MonthGridProps {
  anchorDate: Date
  items: CalendarItem[]
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
      {WEEKDAY_LABELS.map((label) => <div key={label} className="calendar-month-weekday">{label}</div>)}
      {days.map((day) => {
        const dayItems = datedItems.filter((item) => item.startAt && isSameDay(item.startAt, day)).slice(0, 4)
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
  sourceById: Map<string, CalendarSource>
  onItemContextMenu: (event: MouseEvent<HTMLElement>, item: CalendarItem) => void
  onItemDragStart: (event: DragEvent<HTMLElement>, item: CalendarItem) => void
  onItemSelect: (itemId: string) => void
}

function ScheduleList({ anchorDate, items, sourceById, onItemContextMenu, onItemDragStart, onItemSelect }: ScheduleListProps) {
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
          <h2>{formatDayLabel(groupItems[0].startAt!)}</h2>
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
                <span className="calendar-schedule-time">{item.allDay ? "All day" : item.startAt ? formatTime(item.startAt) : ""}</span>
                <span className="calendar-schedule-copy">
                  <strong>{item.title}</strong>
                  <small>
                    <span style={{ backgroundColor: getItemAccentColor(item, sourceById.get(item.sourceId)) }} />
                    {getScheduleListSourceLabel(item, sourceById.get(item.sourceId))}
                  </small>
                </span>
                <ChevronRightIcon />
              </button>
            ))}
          </div>
        </section>
      ))}
      {scheduledItems.length === 0 ? <p className="calendar-empty-state">No visible items in the next two weeks.</p> : null}
    </div>
  )
}

interface CalendarDetailPanelProps {
  item: CalendarItem | null
  projects: CalendarProjectOption[]
  source?: CalendarSource
  sources: CalendarSource[]
  onAcceptSuggestion: (item: CalendarItem) => void
  onDelete: (itemId: string) => void
  onDismissSuggestion: (itemId: string) => void
  onItemUpdate: (itemId: string, update: Partial<CalendarItem>) => void
  onMoveLater: (item: CalendarItem) => void
  onUnschedule: (itemId: string) => void
}

function CalendarDetailPanel({
  item,
  projects,
  source,
  sources,
  onAcceptSuggestion,
  onDelete,
  onDismissSuggestion,
  onItemUpdate,
  onMoveLater,
  onUnschedule,
}: CalendarDetailPanelProps) {
  if (!item) {
    return (
      <aside className="calendar-detail-panel" aria-label="Calendar details">
        <div className="calendar-detail-empty">
          <CalendarIcon />
          <h2>Select a calendar item</h2>
          <p>Events, Todos, and Agent suggestions open here.</p>
        </div>
      </aside>
    )
  }
  const sourceOptions = sources
  const sourceOptionsWithCurrent = source && !sourceOptions.some((candidate) => candidate.id === source.id)
    ? [source, ...sourceOptions]
    : sourceOptions
  const statusOptions = getStatusOptions(item)
  const statusValue = item.status ?? (item.entityType === "task" ? "todo" : "scheduled")
  const isTaskLikeItem = item.entityType === "task"
  const projectValue = resolveProjectValue(item.workspace, projects)
  const hasLegacyProject = hasLegacyProjectValue(item.workspace, projects)

  return (
    <aside className="calendar-detail-panel" aria-label="Calendar details">
      <div className="calendar-detail-heading">
        <span className="calendar-detail-type">{getItemTypeLabel(item)}</span>
        <h2>{item.title}</h2>
        <p>{formatDateTimeRange(item)}</p>
      </div>

      <div className="calendar-detail-form">
        <label>
          Title
          <input
            value={item.title}
            onChange={(event) => onItemUpdate(item.id, { title: event.target.value })}
          />
        </label>

        {item.entityType === "event" ? (
          <label>
            Calendar
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

        <label>
          Status
          <select
            value={statusValue}
            onChange={(event) => onItemUpdate(item.id, { status: event.target.value as CalendarItem["status"] })}
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label>
          Project
          <select
            value={projectValue}
            onChange={(event) => onItemUpdate(item.id, { workspace: event.target.value })}
          >
            <option value="">No project</option>
            {hasLegacyProject ? (
              <option value={projectValue}>{item.workspace}</option>
            ) : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{getProjectOptionLabel(project)}</option>
            ))}
          </select>
        </label>

        <label>
          Notes
          <textarea
            value={item.description ?? ""}
            rows={4}
            placeholder="Context for this calendar item"
            onChange={(event) => onItemUpdate(item.id, { description: event.target.value })}
          />
        </label>
      </div>

      <div className="calendar-detail-meta">
        <div>
          <span>{item.entityType === "event" ? "Calendar" : "Context"}</span>
          <strong>{item.entityType === "event" ? source?.name ?? "Unknown" : getItemTypeLabel(item)}</strong>
        </div>
        <div>
          <span>Date field</span>
          <strong>{getDateFieldLabel(item)}</strong>
        </div>
      </div>

      <div className="calendar-detail-actions">
        {item.entityType === "agent_suggestion" ? (
          <>
            <button type="button" className="calendar-primary-action" onClick={() => onAcceptSuggestion(item)}>
              Accept suggestion
            </button>
            <button type="button" className="calendar-secondary-action" onClick={() => onDismissSuggestion(item.id)}>
              Dismiss
            </button>
          </>
        ) : (
          <>
            <button type="button" className="calendar-primary-action" onClick={() => onMoveLater(item)} disabled={!item.startAt}>
              Move 30m later
            </button>
            {isTaskLikeItem ? (
              <button
                type="button"
                className="calendar-secondary-action"
                onClick={() => onItemUpdate(item.id, { status: item.status === "done" ? "todo" : "done" })}
              >
                {item.status === "done" ? "标记未完成" : "标记完成"}
              </button>
            ) : null}
            {isTaskLikeItem ? (
              <button
                type="button"
                className="calendar-secondary-action"
                disabled={!item.startAt}
                onClick={() => onUnschedule(item.id)}
              >
                {item.startAt ? "Unschedule" : "Already unscheduled"}
              </button>
            ) : null}
            {item.entityType === "event" || isTaskLikeItem ? (
              <button
                type="button"
                className="calendar-danger-action"
                disabled={item.isReadOnly}
                onClick={() => onDelete(item.id)}
              >
                {isTaskLikeItem ? "Delete Todo" : "Delete event"}
              </button>
            ) : null}
          </>
        )}
      </div>
    </aside>
  )
}
