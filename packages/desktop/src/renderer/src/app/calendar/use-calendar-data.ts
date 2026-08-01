import { useCallback, useEffect, useState } from "react"
import {
  createCalendarEvent,
  createCalendarTask,
  deleteCalendarEvent,
  deleteCalendarTask,
  listCalendarItems,
  listCalendarSources,
  listCalendarTodos,
  scheduleCalendarTask,
  updateCalendarEvent,
  updateCalendarSource,
  updateCalendarTask,
} from "./calendar-client"
import type {
  CalendarApiItem,
  CalendarItem,
  CalendarItemStatus,
  CalendarSource,
  CreateCalendarEventInput,
  CreateCalendarTaskInput,
  PlannerTaskRecord,
  ScheduleCalendarTaskInput,
  UpdateCalendarEventInput,
  UpdateCalendarTaskInput,
} from "./calendar-types"

const KNOWN_STATUSES = new Set<CalendarItemStatus>([
  "scheduled",
  "todo",
  "done",
  "canceled",
  "pending",
  "blocked",
])

function isLocalMidnight(timestamp: number) {
  const date = new Date(timestamp)
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0
}

function isAllDayScheduledRange(startAt: number | undefined, endAt: number | undefined) {
  return startAt !== undefined && endAt !== undefined && endAt > startAt && isLocalMidnight(startAt) && isLocalMidnight(endAt)
}

function normalizeItemStatus(apiItem: CalendarApiItem): CalendarItemStatus | undefined {
  if (apiItem.entityType === "task") {
    if (apiItem.status === "done") return "done"
    if (["inbox", "todo", "doing", "waiting", "canceled"].includes(apiItem.status ?? "")) return "todo"
  }
  return apiItem.status && KNOWN_STATUSES.has(apiItem.status as CalendarItemStatus)
    ? apiItem.status as CalendarItemStatus
    : undefined
}

function toCalendarItem(apiItem: CalendarApiItem): CalendarItem {
  return {
    ...apiItem,
    startAt: apiItem.startAt === undefined ? undefined : new Date(apiItem.startAt),
    endAt: apiItem.endAt === undefined ? undefined : new Date(apiItem.endAt),
    allDay: apiItem.allDay || (
      apiItem.displayKind === "scheduled_todo" && isAllDayScheduledRange(apiItem.startAt, apiItem.endAt)
    ),
    status: normalizeItemStatus(apiItem),
  }
}

function toTodoItem(todo: PlannerTaskRecord): CalendarItem {
  return {
    id: todo.id,
    sourceId: "todos",
    entityType: "task",
    displayKind: "scheduled_todo",
    entityId: todo.id,
    title: todo.title,
    description: todo.description,
    dueAt: todo.dueAt === undefined ? undefined : new Date(todo.dueAt),
    startAt: todo.scheduledStartAt === undefined ? undefined : new Date(todo.scheduledStartAt),
    endAt: todo.scheduledEndAt === undefined ? undefined : new Date(todo.scheduledEndAt),
    allDay: isAllDayScheduledRange(todo.scheduledStartAt, todo.scheduledEndAt),
    color: "#8a5cf6",
    estimateMinutes: todo.estimateMinutes,
    status: todo.status === "done" ? "done" : "todo",
    isReadOnly: false,
    isSuggestion: false,
    workspace: todo.projectId ?? todo.workspaceId,
    properties: todo.properties,
    reminderAt: todo.reminderAt === undefined ? undefined : new Date(todo.reminderAt),
    timezone: todo.timezone,
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function useCalendarData(input: { rangeStart: Date; rangeEnd: Date }) {
  const [sources, setSources] = useState<CalendarSource[]>([])
  const [items, setItems] = useState<CalendarItem[]>([])
  const [todos, setTodos] = useState<CalendarItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setIsLoading(true)
    try {
      const [nextSources, nextItems, nextTodos] = await Promise.all([
        listCalendarSources(),
        listCalendarItems({
          startAt: input.rangeStart.getTime(),
          endAt: input.rangeEnd.getTime(),
        }),
        listCalendarTodos(),
      ])
      setSources(nextSources)
      setItems(nextItems.map(toCalendarItem))
      setTodos(nextTodos.map(toTodoItem))
      setError(null)
    } catch (nextError) {
      setError(formatError(nextError))
    } finally {
      setIsLoading(false)
    }
  }, [input.rangeEnd, input.rangeStart])

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    void (async () => {
      try {
        const [nextSources, nextItems, nextTodos] = await Promise.all([
          listCalendarSources(),
          listCalendarItems({
            startAt: input.rangeStart.getTime(),
            endAt: input.rangeEnd.getTime(),
          }),
          listCalendarTodos(),
        ])
        if (cancelled) return
        setSources(nextSources)
        setItems(nextItems.map(toCalendarItem))
        setTodos(nextTodos.map(toTodoItem))
        setError(null)
      } catch (nextError) {
        if (cancelled) return
        setError(formatError(nextError))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [input.rangeEnd, input.rangeStart])

  const createEvent = useCallback(async (event: CreateCalendarEventInput) => {
    try {
      const created = await createCalendarEvent(event)
      await reload()
      return created
    } catch (nextError) {
      setError(formatError(nextError))
      throw nextError
    }
  }, [reload])

  const updateEvent = useCallback(async (eventId: string, update: UpdateCalendarEventInput) => {
    try {
      const updated = await updateCalendarEvent({ eventId, update })
      await reload()
      return updated
    } catch (nextError) {
      setError(formatError(nextError))
      throw nextError
    }
  }, [reload])

  const createTask = useCallback(async (task: CreateCalendarTaskInput) => {
    try {
      const created = await createCalendarTask(task)
      await reload()
      return created
    } catch (nextError) {
      setError(formatError(nextError))
      throw nextError
    }
  }, [reload])

  const updateTask = useCallback(async (taskId: string, update: UpdateCalendarTaskInput) => {
    try {
      const updated = await updateCalendarTask({ taskId, update })
      await reload()
      return updated
    } catch (nextError) {
      setError(formatError(nextError))
      throw nextError
    }
  }, [reload])

  const deleteEvent = useCallback(async (eventId: string) => {
    try {
      const deleted = await deleteCalendarEvent({ eventId })
      await reload()
      return deleted
    } catch (nextError) {
      setError(formatError(nextError))
      throw nextError
    }
  }, [reload])

  const deleteTask = useCallback(async (taskId: string) => {
    try {
      const deleted = await deleteCalendarTask({ taskId })
      await reload()
      return deleted
    } catch (nextError) {
      setError(formatError(nextError))
      throw nextError
    }
  }, [reload])

  const scheduleTask = useCallback(async (taskId: string, schedule: ScheduleCalendarTaskInput) => {
    try {
      const updated = await scheduleCalendarTask({ taskId, schedule })
      await reload()
      return updated
    } catch (nextError) {
      setError(formatError(nextError))
      throw nextError
    }
  }, [reload])

  const updateSource = useCallback(async (sourceId: string, update: Partial<CalendarSource>) => {
    try {
      const updated = await updateCalendarSource({ sourceId, update })
      await reload()
      return updated
    } catch (nextError) {
      setError(formatError(nextError))
      throw nextError
    }
  }, [reload])

  const patchItem = useCallback((itemId: string, update: Partial<CalendarItem>) => {
    setItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...update } : item)))
    setTodos((current) => current.map((todo) => (todo.id === itemId ? { ...todo, ...update } : todo)))
  }, [])

  const patchSource = useCallback((sourceId: string, update: Partial<CalendarSource>) => {
    setSources((current) => current.map((source) => (source.id === sourceId ? { ...source, ...update } : source)))
  }, [])

  return {
    error,
    isLoading,
    items,
    sources,
    todos,
    createEvent,
    createTask,
    reload,
    patchItem,
    patchSource,
    deleteEvent,
    deleteTask,
    updateEvent,
    updateTask,
    scheduleTask,
    updateSource,
  }
}
