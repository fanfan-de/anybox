import type {
  CalendarApiItem,
  CalendarEventRecord,
  CalendarSource,
  CreateCalendarEventInput,
  CreateCalendarTaskInput,
  PlannerTaskRecord,
  ScheduleCalendarTaskInput,
  UpdateCalendarEventInput,
  UpdateCalendarTaskInput,
} from "./calendar-types"
import { jsonRequestInit, requestAgentJSON } from "../agent-api-client"

export function listCalendarSources() {
  return requestAgentJSON<CalendarSource[]>("/api/calendar/sources")
}

export function updateCalendarSource(input: { sourceId: string; update: Partial<CalendarSource> }) {
  return requestAgentJSON<CalendarSource>(
    `/api/calendar/sources/${encodeURIComponent(input.sourceId)}`,
    jsonRequestInit("PATCH", input.update),
  )
}

export function listCalendarItems(input: { startAt: number; endAt: number; sourceIds?: string[] }) {
  const params = new URLSearchParams({
    startAt: String(input.startAt),
    endAt: String(input.endAt),
  })
  if (input.sourceIds && input.sourceIds.length > 0) {
    params.set("sourceIds", input.sourceIds.join(","))
  }
  return requestAgentJSON<CalendarApiItem[]>(`/api/calendar/items?${params.toString()}`)
}

export function createCalendarEvent(input: CreateCalendarEventInput) {
  return requestAgentJSON<CalendarEventRecord>("/api/calendar/events", jsonRequestInit("POST", input))
}

export function updateCalendarEvent(input: { eventId: string; update: UpdateCalendarEventInput }) {
  return requestAgentJSON<CalendarEventRecord>(
    `/api/calendar/events/${encodeURIComponent(input.eventId)}`,
    jsonRequestInit("PATCH", input.update),
  )
}

export function deleteCalendarEvent(input: { eventId: string }) {
  return requestAgentJSON<{ eventID: string; deleted: boolean }>(
    `/api/calendar/events/${encodeURIComponent(input.eventId)}`,
    { method: "DELETE" },
  )
}

export function listCalendarTasks() {
  return listCalendarTodos()
}

export function listCalendarTodos() {
  return requestAgentJSON<PlannerTaskRecord[]>("/api/calendar/todos")
}

export function createCalendarTodo(input: CreateCalendarTaskInput) {
  return requestAgentJSON<PlannerTaskRecord>("/api/calendar/todos", jsonRequestInit("POST", input))
}

export function createCalendarTask(input: CreateCalendarTaskInput) {
  return createCalendarTodo(input)
}

export function updateCalendarTodo(input: { todoId: string; update: UpdateCalendarTaskInput }) {
  return requestAgentJSON<PlannerTaskRecord>(
    `/api/calendar/todos/${encodeURIComponent(input.todoId)}`,
    jsonRequestInit("PATCH", input.update),
  )
}

export function updateCalendarTask(input: { taskId: string; update: UpdateCalendarTaskInput }) {
  return updateCalendarTodo({ todoId: input.taskId, update: input.update })
}

export function scheduleCalendarTodo(input: { todoId: string; schedule: ScheduleCalendarTaskInput }) {
  return requestAgentJSON<PlannerTaskRecord>(
    `/api/calendar/todos/${encodeURIComponent(input.todoId)}/schedule`,
    jsonRequestInit("PATCH", input.schedule),
  )
}

export function scheduleCalendarTask(input: { taskId: string; schedule: ScheduleCalendarTaskInput }) {
  return scheduleCalendarTodo({ todoId: input.taskId, schedule: input.schedule })
}

export function deleteCalendarTodo(input: { todoId: string }) {
  return requestAgentJSON<{ taskID: string; todoID?: string; deleted: boolean }>(
    `/api/calendar/todos/${encodeURIComponent(input.todoId)}`,
    { method: "DELETE" },
  )
}

export function deleteCalendarTask(input: { taskId: string }) {
  return deleteCalendarTodo({ todoId: input.taskId })
}
