import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import * as Calendar from "#calendar/calendar.ts"
import * as db from "#database/Sqlite.ts"
import { createServerApp } from "#server/server.ts"

interface JsonEnvelope<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

interface CalendarSource {
  id: string
  name: string
  enabled: boolean
  color: string
  subtitle?: string
}

interface CalendarEvent {
  id: string
  sourceId: string
  title: string
  status: string
  startAt: number
  endAt: number
  allDay: boolean
  linkedWorkspaceId?: string
}

interface PlannerTask {
  id: string
  title: string
  status: string
  priority: string
  dueAt?: number
  estimateMinutes?: number
  properties?: Record<string, unknown>
  reminderAt?: number
  scheduledStartAt?: number
  scheduledEndAt?: number
  timezone?: string
  workspaceId?: string
}

interface CalendarItem {
  id: string
  sourceId: string
  displayKind: string
  entityType: string
  entityId: string
  title: string
  startAt?: number
  endAt?: number
  allDay: boolean
  color: string
  status?: string
  workspace?: string
}

async function readJson<T>(response: Response) {
  return await response.json() as JsonEnvelope<T>
}

function seedCompatiblePersonalSource() {
  if (Calendar.getSource("personal")) return
  const now = Date.now()
  db.insertOneWithSchema(
    "calendar_sources",
    Calendar.CalendarSource.parse({
      id: "personal",
      name: "Personal",
      subtitle: "Local calendar",
      kind: "external_calendar",
      color: "#2f9d7e",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }),
    Calendar.CalendarSource,
  )
}

describe("calendar api", () => {
  test("seeds the default event source only", async () => {
    const app = createServerApp()
    const response = await app.request("/api/calendar/sources")

    expect(response.status).toBe(200)
    const body = await readJson<CalendarSource[]>(response)
    expect(body.success).toBe(true)
    expect(body.data?.map((source) => source.id)).toEqual(["work"])
    expect(body.data?.every((source) => source.enabled)).toBe(true)
    expect(body.data?.[0]).not.toHaveProperty("kind")
  })

  test("creates, lists, updates, filters, and deletes local calendar events with compatible sources", async () => {
    const app = createServerApp()
    seedCompatiblePersonalSource()
    const rangeStart = Date.UTC(2026, 5, 10, 0, 0, 0)
    const eventStart = Date.UTC(2026, 5, 10, 9, 30, 0)
    const eventEnd = Date.UTC(2026, 5, 10, 10, 30, 0)
    const rangeEnd = Date.UTC(2026, 5, 10, 23, 59, 59)

    const sourcesResponse = await app.request("/api/calendar/sources")
    const sources = await readJson<CalendarSource[]>(sourcesResponse)
    expect(sources.data?.map((source) => source.id)).toEqual(["work", "personal"])
    expect(sources.data?.every((source) => !("kind" in source))).toBe(true)

    const createResponse = await app.request("/api/calendar/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceId: "work",
        title: "Calendar API smoke",
        description: "Created by the calendar API test.",
        status: "scheduled",
        startAt: eventStart,
        endAt: eventEnd,
        timezone: "UTC",
        linkedWorkspaceId: "Anybox Desktop",
      }),
    })

    expect(createResponse.status).toBe(201)
    const created = await readJson<CalendarEvent>(createResponse)
    expect(created.success).toBe(true)
    expect(created.data?.id).toStartWith("evt_")
    expect(created.data?.allDay).toBe(false)
    expect(created.data?.status).toBe("scheduled")
    expect(created.data?.linkedWorkspaceId).toBe("Anybox Desktop")

    const listResponse = await app.request(`/api/calendar/items?startAt=${rangeStart}&endAt=${rangeEnd}`)
    expect(listResponse.status).toBe(200)
    const list = await readJson<CalendarItem[]>(listResponse)
    expect(list.data?.map((item) => item.id)).toContain(created.data!.id)
    const listedItem = list.data?.find((item) => item.id === created.data!.id)
    expect(listedItem?.entityType).toBe("event")
    expect(listedItem?.displayKind).toBe("external_event")
    expect(listedItem?.entityId).toBe(created.data!.id)
    expect(listedItem?.color).toBe("#3f7af0")
    expect(listedItem?.status).toBe("scheduled")
    expect(listedItem?.workspace).toBe("Anybox Desktop")

    const updateResponse = await app.request(`/api/calendar/events/${created.data!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Updated calendar API smoke",
        sourceId: "personal",
        status: "canceled",
        linkedWorkspaceId: "Anybox Mobile",
      }),
    })
    expect(updateResponse.status).toBe(200)
    const updated = await readJson<CalendarEvent>(updateResponse)
    expect(updated.data?.title).toBe("Updated calendar API smoke")
    expect(updated.data?.sourceId).toBe("personal")
    expect(updated.data?.status).toBe("canceled")
    expect(updated.data?.linkedWorkspaceId).toBe("Anybox Mobile")

    const workOnlyResponse = await app.request(`/api/calendar/items?startAt=${rangeStart}&endAt=${rangeEnd}&sourceIds=work`)
    const workOnly = await readJson<CalendarItem[]>(workOnlyResponse)
    expect(workOnly.data?.map((item) => item.id)).not.toContain(created.data!.id)

    const disableResponse = await app.request("/api/calendar/sources/personal", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    })
    expect(disableResponse.status).toBe(200)

    const disabledListResponse = await app.request(
      `/api/calendar/items?startAt=${rangeStart}&endAt=${rangeEnd}&sourceIds=personal`,
    )
    const disabledList = await readJson<CalendarItem[]>(disabledListResponse)
    expect(disabledList.data).toEqual([])

    await app.request("/api/calendar/sources/personal", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })

    const deleteResponse = await app.request(`/api/calendar/events/${created.data!.id}`, {
      method: "DELETE",
    })
    expect(deleteResponse.status).toBe(200)

    const afterDeleteResponse = await app.request(`/api/calendar/items?startAt=${rangeStart}&endAt=${rangeEnd}`)
    const afterDelete = await readJson<CalendarItem[]>(afterDeleteResponse)
    expect(afterDelete.data?.map((item) => item.id)).not.toContain(created.data!.id)
  })

  test("rejects invalid ranges", async () => {
    const app = createServerApp()
    const response = await app.request("/api/calendar/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceId: "work",
        title: "Invalid range",
        startAt: 2000,
        endAt: 1000,
      }),
    })

    expect(response.status).toBe(400)
    const body = await readJson(response)
    expect(body.error?.code).toBe("INVALID_CALENDAR_EVENT_RANGE")
  })

  test("keeps unscheduled todos out of calendar items and projects schedule overlays", async () => {
    const app = createServerApp()
    const rangeStart = Date.UTC(2026, 5, 11, 0, 0, 0)
    const taskStart = Date.UTC(2026, 5, 11, 13, 0, 0)
    const taskEnd = Date.UTC(2026, 5, 11, 14, 15, 0)
    const allDayTaskStart = new Date(2026, 5, 11, 0, 0, 0, 0).getTime()
    const allDayTaskEndDate = new Date(allDayTaskStart)
    allDayTaskEndDate.setDate(allDayTaskEndDate.getDate() + 1)
    const allDayTaskEnd = allDayTaskEndDate.getTime()
    const dueAt = Date.UTC(2026, 5, 12, 0, 0, 0)
    const reminderAt = Date.UTC(2026, 5, 11, 8, 45, 0)
    const rangeEnd = Date.UTC(2026, 5, 12, 23, 59, 59)

    const createResponse = await app.request("/api/calendar/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Write Todo model tests",
        description: "Created by the calendar Todo API test.",
        estimateMinutes: 75,
        workspaceId: "Anybox Desktop",
        properties: { lane: "qa" },
        timezone: "Asia/Shanghai",
      }),
    })

    expect(createResponse.status).toBe(201)
    const created = await readJson<PlannerTask>(createResponse)
    expect(created.success).toBe(true)
    expect(created.data?.id).toStartWith("tsk_")
    expect(created.data?.status).toBe("todo")
    expect(created.data?.priority).toBe("medium")
    expect(created.data?.scheduledStartAt).toBeUndefined()
    expect(created.data?.properties).toEqual({ lane: "qa" })
    expect(created.data?.timezone).toBe("Asia/Shanghai")

    const todosResponse = await app.request("/api/calendar/todos")
    const todos = await readJson<PlannerTask[]>(todosResponse)
    expect(todos.data?.map((todo) => todo.id)).toContain(created.data!.id)

    const unscheduledResponse = await app.request(`/api/calendar/items?startAt=${rangeStart}&endAt=${rangeEnd}`)
    const unscheduledList = await readJson<CalendarItem[]>(unscheduledResponse)
    expect(unscheduledList.data?.map((item) => item.entityId)).not.toContain(created.data!.id)

    const scheduleResponse = await app.request(`/api/calendar/todos/${created.data!.id}/schedule`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scheduledStartAt: taskStart,
        scheduledEndAt: taskEnd,
      }),
    })
    expect(scheduleResponse.status).toBe(200)
    const scheduled = await readJson<PlannerTask>(scheduleResponse)
    expect(scheduled.data?.scheduledStartAt).toBe(taskStart)
    expect(scheduled.data?.scheduledEndAt).toBe(taskEnd)

    const scheduledResponse = await app.request(`/api/calendar/items?startAt=${rangeStart}&endAt=${rangeEnd}`)
    const scheduledList = await readJson<CalendarItem[]>(scheduledResponse)
    const scheduledItem = scheduledList.data?.find((item) => item.id === `todo:${created.data!.id}:scheduled`)
    expect(scheduledItem?.displayKind).toBe("scheduled_todo")
    expect(scheduledItem?.entityId).toBe(created.data!.id)
    expect(scheduledItem?.sourceId).toBe("todos")
    expect(scheduledItem?.startAt).toBe(taskStart)
    expect(scheduledItem?.endAt).toBe(taskEnd)
    expect(scheduledItem?.allDay).toBe(false)
    expect(scheduledItem?.title).toBe("Write Todo model tests")

    const allDayScheduleResponse = await app.request(`/api/calendar/todos/${created.data!.id}/schedule`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scheduledStartAt: allDayTaskStart,
        scheduledEndAt: allDayTaskEnd,
      }),
    })
    expect(allDayScheduleResponse.status).toBe(200)

    const allDayItemsResponse = await app.request(`/api/calendar/items?startAt=${rangeStart}&endAt=${rangeEnd}`)
    const allDayItems = await readJson<CalendarItem[]>(allDayItemsResponse)
    const allDayScheduledItem = allDayItems.data?.find((item) => item.id === `todo:${created.data!.id}:scheduled`)
    expect(allDayScheduledItem?.startAt).toBe(allDayTaskStart)
    expect(allDayScheduledItem?.endAt).toBe(allDayTaskEnd)
    expect(allDayScheduledItem?.allDay).toBe(true)

    const overlayPatchResponse = await app.request(`/api/calendar/todos/${created.data!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dueAt,
        reminderAt,
        status: "done",
      }),
    })
    expect(overlayPatchResponse.status).toBe(200)

    const overlaysResponse = await app.request(`/api/calendar/items?startAt=${rangeStart}&endAt=${rangeEnd}`)
    const overlays = await readJson<CalendarItem[]>(overlaysResponse)
    const deadline = overlays.data?.find((item) => item.id === `todo:${created.data!.id}:deadline`)
    const reminder = overlays.data?.find((item) => item.id === `todo:${created.data!.id}:reminder`)
    expect(deadline?.displayKind).toBe("deadline")
    expect(deadline?.sourceId).toBe("deadlines")
    expect(deadline?.startAt).toBe(dueAt)
    expect(reminder?.displayKind).toBe("reminder")
    expect(reminder?.sourceId).toBe("reminders")
    expect(reminder?.startAt).toBe(reminderAt)

    const outOfRangeResponse = await app.request(
      `/api/calendar/items?startAt=${Date.UTC(2026, 5, 13, 0, 0, 0)}&endAt=${Date.UTC(2026, 5, 13, 23, 59, 59)}`,
    )
    const outOfRange = await readJson<CalendarItem[]>(outOfRangeResponse)
    expect(outOfRange.data?.map((item) => item.entityId)).not.toContain(created.data!.id)

    const unscheduleResponse = await app.request(`/api/calendar/todos/${created.data!.id}/schedule`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scheduledStartAt: null,
        scheduledEndAt: null,
      }),
    })
    expect(unscheduleResponse.status).toBe(200)

    const afterUnscheduleResponse = await app.request(`/api/calendar/items?startAt=${rangeStart}&endAt=${rangeEnd}`)
    const afterUnschedule = await readJson<CalendarItem[]>(afterUnscheduleResponse)
    expect(afterUnschedule.data?.map((item) => item.id)).not.toContain(`todo:${created.data!.id}:scheduled`)
    expect(afterUnschedule.data?.map((item) => item.id)).toContain(`todo:${created.data!.id}:deadline`)

    const deleteResponse = await app.request(`/api/calendar/todos/${created.data!.id}`, {
      method: "DELETE",
    })
    expect(deleteResponse.status).toBe(200)

    const afterDeleteTodosResponse = await app.request("/api/calendar/todos")
    const afterDeleteTodos = await readJson<PlannerTask[]>(afterDeleteTodosResponse)
    expect(afterDeleteTodos.data?.map((todo) => todo.id)).not.toContain(created.data!.id)
  })

  test("keeps task routes as compatibility aliases for todos", async () => {
    const app = createServerApp()
    const taskStart = Date.UTC(2026, 5, 14, 10, 0, 0)
    const taskEnd = Date.UTC(2026, 5, 14, 11, 0, 0)

    const createResponse = await app.request("/api/calendar/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Compat task route Todo",
        workspaceId: "Anybox",
      }),
    })
    expect(createResponse.status).toBe(201)
    const created = await readJson<PlannerTask>(createResponse)

    const todosResponse = await app.request("/api/calendar/todos")
    const todos = await readJson<PlannerTask[]>(todosResponse)
    expect(todos.data?.map((todo) => todo.id)).toContain(created.data!.id)

    const scheduleResponse = await app.request(`/api/calendar/tasks/${created.data!.id}/schedule`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scheduledStartAt: taskStart,
        scheduledEndAt: taskEnd,
      }),
    })
    expect(scheduleResponse.status).toBe(200)

    const itemsResponse = await app.request(
      `/api/calendar/items?startAt=${Date.UTC(2026, 5, 14, 0, 0, 0)}&endAt=${Date.UTC(2026, 5, 14, 23, 59, 59)}`,
    )
    const items = await readJson<CalendarItem[]>(itemsResponse)
    expect(items.data?.find((item) => item.id === `todo:${created.data!.id}:scheduled`)?.displayKind).toBe("scheduled_todo")
  })
})
