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

type AgentEnvelope<T> =
  | {
      success: true
      data: T
    }
  | {
      success: false
      error?: {
        message?: string
      }
    }

const FALLBACK_AGENT_BASE_URL = "http://127.0.0.1:4096"
const AGENT_REQUEST_TIMEOUT_MS = 15_000

async function resolveAgentBaseURL() {
  if (typeof window !== "undefined") {
    const config = await window.desktop?.getAgentConfig?.().catch(() => undefined)
    if (config?.baseURL) return config.baseURL
  }

  return FALLBACK_AGENT_BASE_URL
}

function resolveAgentURL(pathname: string, baseURL: string) {
  const normalizedBaseURL = baseURL.endsWith("/") ? baseURL : `${baseURL}/`
  return new URL(pathname, normalizedBaseURL).toString()
}

async function requestAgentJSON<T>(pathname: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), AGENT_REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(resolveAgentURL(pathname, await resolveAgentBaseURL()), {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Local agent API timed out after ${AGENT_REQUEST_TIMEOUT_MS / 1000}s.`)
    }
    throw new Error(`Local agent API could not be reached. ${formatError(error)}`)
  } finally {
    globalThis.clearTimeout(timeout)
  }

  const envelope = (await response.json().catch(() => null)) as AgentEnvelope<T> | null
  if (!response.ok || !envelope) {
    throw new Error(`Agent API request failed (${response.status}).`)
  }
  if (envelope.success !== true) {
    throw new Error(envelope.error?.message || `Agent API request failed (${response.status}).`)
  }

  return envelope.data
}

function jsonRequestInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: {
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

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
