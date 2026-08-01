import z from "zod"
import * as Calendar from "#calendar/calendar.ts"
import * as PlannerService from "#planner/service.ts"
import { ApiError } from "#server/error.ts"

const TrimmedString = z.string().transform((value) => value.trim()).pipe(z.string().min(1))

const OptionalTrimmedString = z.string().transform((value) => value.trim()).pipe(z.string()).optional()

const TimestampInput = z
  .union([z.string(), z.number()])
  .transform((value) => Number(value))
  .pipe(z.number().int().nonnegative())

const NullableTimestampInput = z.union([TimestampInput, z.null()])
const PropertiesInput = z.record(z.string(), z.unknown())
const PlannerTaskStatusInput = z
  .enum(["todo", "doing", "done", "canceled"])
  .transform((status): Calendar.PlannerTaskStatus => (status === "done" ? "done" : "todo"))

function splitSourceIds(value: string | undefined) {
  return value
    ?.split(",")
    .map((sourceId) => sourceId.trim())
    .filter(Boolean)
}

export const ListCalendarItemsQuery = z.object({
  startAt: TimestampInput.optional(),
  endAt: TimestampInput.optional(),
  sourceIds: z.string().optional().transform(splitSourceIds),
})

export const UpdateCalendarSourceBody = z.object({
  name: TrimmedString.optional(),
  enabled: z.boolean().optional(),
  color: TrimmedString.optional(),
  subtitle: TrimmedString.optional(),
})

export const CreateCalendarEventBody = z.object({
  sourceId: TrimmedString,
  title: TrimmedString,
  description: OptionalTrimmedString,
  status: Calendar.CalendarEventStatus.optional().default("scheduled"),
  startAt: TimestampInput,
  endAt: TimestampInput,
  allDay: z.boolean().optional().default(false),
  timezone: TrimmedString.optional().default("UTC"),
  location: OptionalTrimmedString,
  meetingUrl: OptionalTrimmedString,
  attendees: z.array(z.string()).optional().default([]),
  linkedPageIds: z.array(z.string()).optional().default([]),
  linkedWorkspaceId: OptionalTrimmedString,
})

export const UpdateCalendarEventBody = z.object({
  sourceId: TrimmedString.optional(),
  title: TrimmedString.optional(),
  description: OptionalTrimmedString,
  status: Calendar.CalendarEventStatus.optional(),
  startAt: TimestampInput.optional(),
  endAt: TimestampInput.optional(),
  allDay: z.boolean().optional(),
  timezone: TrimmedString.optional(),
  location: OptionalTrimmedString,
  meetingUrl: OptionalTrimmedString,
  attendees: z.array(z.string()).optional(),
  linkedPageIds: z.array(z.string()).optional(),
  linkedWorkspaceId: OptionalTrimmedString,
})

export const CreateCalendarTaskBody = z.object({
  title: TrimmedString,
  description: OptionalTrimmedString,
  status: PlannerTaskStatusInput.optional().default("todo"),
  priority: Calendar.PlannerTaskPriority.optional().default("medium"),
  dueAt: TimestampInput.optional(),
  reminderAt: TimestampInput.optional(),
  scheduledStartAt: TimestampInput.optional(),
  scheduledEndAt: TimestampInput.optional(),
  estimateMinutes: z.number().int().positive().optional().default(60),
  workspaceId: OptionalTrimmedString,
  properties: PropertiesInput.optional(),
  timezone: OptionalTrimmedString,
})

export const UpdateCalendarTaskBody = z.object({
  title: TrimmedString.optional(),
  description: OptionalTrimmedString.or(z.null()).optional(),
  status: PlannerTaskStatusInput.optional(),
  priority: Calendar.PlannerTaskPriority.optional(),
  dueAt: NullableTimestampInput.optional(),
  reminderAt: NullableTimestampInput.optional(),
  scheduledStartAt: NullableTimestampInput.optional(),
  scheduledEndAt: NullableTimestampInput.optional(),
  estimateMinutes: z.number().int().positive().optional(),
  workspaceId: OptionalTrimmedString.or(z.null()).optional(),
  properties: PropertiesInput.optional(),
  timezone: OptionalTrimmedString.or(z.null()).optional(),
})

export const ScheduleCalendarTaskBody = z.object({
  scheduledStartAt: NullableTimestampInput.optional(),
  scheduledEndAt: NullableTimestampInput.optional(),
})

export const CreateCalendarTodoBody = CreateCalendarTaskBody
export const UpdateCalendarTodoBody = UpdateCalendarTaskBody
export const ScheduleCalendarTodoBody = ScheduleCalendarTaskBody

type CreateCalendarEventInput = z.output<typeof CreateCalendarEventBody>
type UpdateCalendarEventInput = z.output<typeof UpdateCalendarEventBody>
type UpdateCalendarSourceInput = z.output<typeof UpdateCalendarSourceBody>
type CreateCalendarTaskInput = z.output<typeof CreateCalendarTaskBody>
type UpdateCalendarTaskInput = z.output<typeof UpdateCalendarTaskBody>
type ScheduleCalendarTaskInput = z.output<typeof ScheduleCalendarTaskBody>

function toCalendarSourceOutput(source: Calendar.CalendarSource) {
  return {
    id: source.id,
    name: source.name,
    enabled: source.enabled,
    color: source.color,
    subtitle: source.subtitle,
  }
}

function requireSource(id: string) {
  const source = Calendar.getSource(id)
  if (!source) throw new ApiError(404, "CALENDAR_SOURCE_NOT_FOUND", `Calendar source '${id}' not found`)
  return source
}

function requireEventSource(id: string) {
  return requireSource(id)
}

function requireEvent(id: string) {
  const event = Calendar.getEvent(id)
  if (!event) throw new ApiError(404, "CALENDAR_EVENT_NOT_FOUND", `Calendar event '${id}' not found`)
  return event
}

function validateEventRange(input: { startAt: number; endAt: number }) {
  if (input.endAt < input.startAt) {
    throw new ApiError(400, "INVALID_CALENDAR_EVENT_RANGE", "Calendar event endAt must be greater than or equal to startAt")
  }
}

function plannerCall<T>(fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ApiError(400, "INVALID_CALENDAR_TASK_INPUT", "Calendar task input is invalid", {
        issues: error.issues,
      })
    }
    if (!PlannerService.isPlannerError(error)) throw error
    if (error.code === "PLANNER_TODO_NOT_FOUND") {
      throw new ApiError(404, "CALENDAR_TASK_NOT_FOUND", error.message, error.data)
    }
    if (error.code === "INVALID_PLANNER_SCHEDULE") {
      throw new ApiError(400, "INVALID_CALENDAR_TASK_SCHEDULE", error.message, error.data)
    }
    if (error.code === "PLANNER_TODO_HAS_CHILDREN") {
      throw new ApiError(409, "CALENDAR_TASK_HAS_CHILDREN", error.message, error.data)
    }
    throw new ApiError(400, error.code, error.message, error.data)
  }
}

function validateTaskSchedule(input: { scheduledStartAt?: number; scheduledEndAt?: number }) {
  if (input.scheduledStartAt === undefined && input.scheduledEndAt === undefined) return
  if (input.scheduledStartAt === undefined || input.scheduledEndAt === undefined) {
    throw new ApiError(400, "INVALID_CALENDAR_TASK_SCHEDULE", "Calendar task schedule must include both scheduledStartAt and scheduledEndAt")
  }
  if (input.scheduledEndAt < input.scheduledStartAt) {
    throw new ApiError(400, "INVALID_CALENDAR_TASK_SCHEDULE", "Calendar task scheduledEndAt must be greater than or equal to scheduledStartAt")
  }
}

export function listSources() {
  return Calendar.listSources().map(toCalendarSourceOutput)
}

export function updateSource(id: string, input: UpdateCalendarSourceInput) {
  const existing = requireEventSource(id)
  const now = Date.now()
  const updated = Calendar.updateSourceRecord(Calendar.CalendarSource.parse({
    ...existing,
    ...input,
    updatedAt: now,
  }))
  return toCalendarSourceOutput(updated)
}

export function listItems(input: z.output<typeof ListCalendarItemsQuery>) {
  if (input.startAt !== undefined && input.endAt !== undefined && input.endAt < input.startAt) {
    throw new ApiError(400, "INVALID_CALENDAR_RANGE", "Calendar range endAt must be greater than or equal to startAt")
  }
  return Calendar.listItems(input)
}

export function createEvent(input: CreateCalendarEventInput) {
  requireEventSource(input.sourceId)
  validateEventRange(input)
  const now = Date.now()
  return Calendar.insertEvent(Calendar.CalendarEvent.parse({
    id: Calendar.createCalendarEventID(),
    sourceId: input.sourceId,
    title: input.title,
    description: input.description || undefined,
    status: input.status,
    startAt: input.startAt,
    endAt: input.endAt,
    allDay: input.allDay,
    timezone: input.timezone,
    location: input.location || undefined,
    meetingUrl: input.meetingUrl || undefined,
    attendees: input.attendees,
    linkedPageIds: input.linkedPageIds,
    linkedWorkspaceId: input.linkedWorkspaceId || undefined,
    createdAt: now,
    updatedAt: now,
  }))
}

export function updateEvent(id: string, input: UpdateCalendarEventInput) {
  const existing = requireEvent(id)
  if (input.sourceId) requireEventSource(input.sourceId)
  const next = Calendar.CalendarEvent.parse({
    ...existing,
    ...input,
    description: input.description === "" ? undefined : input.description ?? existing.description,
    location: input.location === "" ? undefined : input.location ?? existing.location,
    meetingUrl: input.meetingUrl === "" ? undefined : input.meetingUrl ?? existing.meetingUrl,
    linkedWorkspaceId: input.linkedWorkspaceId === "" ? undefined : input.linkedWorkspaceId ?? existing.linkedWorkspaceId,
    updatedAt: Date.now(),
  })
  validateEventRange(next)
  return Calendar.updateEventRecord(next)
}

export function deleteEvent(id: string) {
  requireEvent(id)
  Calendar.deleteEvent(id)
  return {
    eventID: id,
    deleted: true,
  }
}

export function listTasks() {
  return PlannerService.listAllTodos()
}

export function listTodos() {
  return listTasks()
}

export function createTask(input: CreateCalendarTaskInput) {
  validateTaskSchedule(input)
  return plannerCall(() => PlannerService.createTodo({
    title: input.title,
    description: input.description || undefined,
    status: input.status,
    priority: input.priority,
    dueAt: input.dueAt,
    reminderAt: input.reminderAt,
    scheduledStartAt: input.scheduledStartAt,
    scheduledEndAt: input.scheduledEndAt,
    estimateMinutes: input.estimateMinutes,
    projectId: input.workspaceId || undefined,
    workspaceId: input.workspaceId || undefined,
    properties: input.properties,
    timezone: input.timezone || undefined,
  }, { actor: "calendar" }))
}

export function createTodo(input: CreateCalendarTaskInput) {
  return createTask(input)
}

export function updateTask(id: string, input: UpdateCalendarTaskInput) {
  const {
    scheduledStartAt,
    scheduledEndAt,
    ...fields
  } = input
  const todoFields = {
    ...fields,
    ...(Object.prototype.hasOwnProperty.call(input, "description")
      ? { description: fields.description === "" ? null : fields.description }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "workspaceId")
      ? { workspaceId: fields.workspaceId === "" ? null : fields.workspaceId }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(input, "timezone")
      ? { timezone: fields.timezone === "" ? null : fields.timezone }
      : {}),
  }
  return plannerCall(() => PlannerService.updateTodoAndSchedule(
    id,
    todoFields,
    {
      ...(Object.prototype.hasOwnProperty.call(input, "scheduledStartAt") ? { scheduledStartAt } : {}),
      ...(Object.prototype.hasOwnProperty.call(input, "scheduledEndAt") ? { scheduledEndAt } : {}),
    },
    { actor: "calendar" },
  ))
}

export function updateTodo(id: string, input: UpdateCalendarTaskInput) {
  return updateTask(id, input)
}

export function scheduleTask(id: string, input: ScheduleCalendarTaskInput) {
  return plannerCall(() => PlannerService.updateTodoAndSchedule(
    id,
    {},
    input,
    { actor: "calendar" },
  ))
}

export function scheduleTodo(id: string, input: ScheduleCalendarTaskInput) {
  return scheduleTask(id, input)
}

export function deleteTask(id: string) {
  plannerCall(() => PlannerService.deleteTodo(id, { actor: "calendar" }))
  return {
    taskID: id,
    todoID: id,
    deleted: true,
  }
}

export function deleteTodo(id: string) {
  return deleteTask(id)
}
