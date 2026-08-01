import { describe, expect, it } from "bun:test"
import "./sqlite.cleanup.ts"
import type * as Planner from "#planner/model.ts"
import { createServerApp } from "#server/server.ts"

type ApiEnvelope<T> = {
  success: boolean
  data?: T
  error?: { code: string; message: string; data?: unknown }
}

async function readJson<T>(response: Response) {
  return await response.json() as ApiEnvelope<T>
}

describe("Planner API", () => {
  it("uses one Planner domain across Planner routes and Calendar projection", async () => {
    const app = createServerApp()
    const rangeStartAt = Date.UTC(2026, 7, 7, 8, 0)
    const scheduledStartAt = Date.UTC(2026, 7, 7, 9, 0)
    const scheduledEndAt = Date.UTC(2026, 7, 7, 10, 0)
    const dueAt = Date.UTC(2026, 7, 8, 10, 0)

    const createResponse = await app.request("/api/planner/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Planner API canonical todo",
        projectId: "project-api",
        priority: "urgent",
        dueAt,
      }),
    })
    expect(createResponse.status).toBe(201)
    const createdBody = await readJson<Planner.PlannerTodo>(createResponse)
    const created = createdBody.data!
    expect(created).toMatchObject({
      status: "inbox",
      projectId: "project-api",
      workspaceId: "project-api",
      priority: "urgent",
      dueAt,
    })

    const inboxResponse = await app.request("/api/planner/todos?view=inbox")
    const inbox = await readJson<Planner.PlannerTodo[]>(inboxResponse)
    expect(inbox.data?.map((todo) => todo.id)).toContain(created.id)

    const calendarTodosResponse = await app.request("/api/calendar/todos")
    const calendarTodos = await readJson<Planner.PlannerTodo[]>(calendarTodosResponse)
    expect(calendarTodos.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: created.id,
        projectId: "project-api",
        workspaceId: "project-api",
      }),
    ]))

    const scheduleResponse = await app.request(`/api/planner/todos/${created.id}/schedule`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduledStartAt, scheduledEndAt }),
    })
    expect(scheduleResponse.status).toBe(200)

    const calendarItemsResponse = await app.request(
      `/api/calendar/items?startAt=${rangeStartAt}&endAt=${dueAt}`,
    )
    const calendarItems = await readJson<Array<{
      entityId: string
      displayKind: string
      startAt?: number
      endAt?: number
    }>>(calendarItemsResponse)
    expect(calendarItems.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: created.id,
        displayKind: "scheduled_todo",
        startAt: scheduledStartAt,
        endAt: scheduledEndAt,
      }),
    ]))

    const proposalResponse = await app.request("/api/planner/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "Move the reviewed todo into active work",
        changes: [{
          kind: "update",
          todoId: created.id,
          fields: { status: "doing", title: "Planner API accepted title" },
        }],
      }),
    })
    expect(proposalResponse.status).toBe(201)
    const proposalBody = await readJson<Planner.PlanProposal>(proposalResponse)
    const proposal = proposalBody.data!
    expect(proposal.status).toBe("pending")

    const beforeAcceptResponse = await app.request(`/api/planner/todos/${created.id}`)
    const beforeAccept = await readJson<Planner.PlannerTodo>(beforeAcceptResponse)
    expect(beforeAccept.data?.title).toBe("Planner API canonical todo")

    const acceptResponse = await app.request(`/api/planner/proposals/${proposal.id}/accept`, {
      method: "POST",
    })
    expect(acceptResponse.status).toBe(200)
    const accepted = await readJson<{
      proposal: Planner.PlanProposal
      appliedTodos: Planner.PlannerTodo[]
    }>(acceptResponse)
    expect(accepted.data?.proposal.status).toBe("accepted")
    expect(accepted.data?.appliedTodos[0]).toMatchObject({
      id: created.id,
      title: "Planner API accepted title",
      status: "doing",
    })

    const auditResponse = await app.request(
      `/api/planner/audit?entityType=proposal&entityId=${proposal.id}`,
    )
    const audit = await readJson<Planner.PlannerAuditEvent[]>(auditResponse)
    expect(audit.data?.map((event) => event.action)).toEqual(expect.arrayContaining([
      "proposal.created",
      "proposal.accepted",
    ]))
  })

  it("returns Planner domain errors without partially applying invalid requests", async () => {
    const app = createServerApp()
    const createdResponse = await app.request("/api/planner/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Invalid schedule guard" }),
    })
    const created = (await readJson<Planner.PlannerTodo>(createdResponse)).data!

    const invalidScheduleResponse = await app.request(`/api/planner/todos/${created.id}/schedule`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scheduledStartAt: 200, scheduledEndAt: 100 }),
    })
    expect(invalidScheduleResponse.status).toBe(400)
    const invalidSchedule = await readJson<never>(invalidScheduleResponse)
    expect(invalidSchedule.error?.code).toBe("INVALID_PLANNER_SCHEDULE")

    const fetchedResponse = await app.request(`/api/planner/todos/${created.id}`)
    const fetched = await readJson<Planner.PlannerTodo>(fetchedResponse)
    expect(fetched.data?.scheduledStartAt).toBeUndefined()
    expect(fetched.data?.scheduledEndAt).toBeUndefined()
  })

  it("links an existing AutomationDefinition and requires an execution target for Agent runs", async () => {
    const app = createServerApp()
    const todoResponse = await app.request("/api/planner/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Planner Automation link" }),
    })
    const todo = (await readJson<Planner.PlannerTodo>(todoResponse)).data!

    const missingTargetResponse = await app.request(`/api/planner/todos/${todo.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(missingTargetResponse.status).toBe(400)
    expect((await readJson<never>(missingTargetResponse)).error?.code).toBe("PLANNER_RUN_TARGET_REQUIRED")

    const automationResponse = await app.request("/api/automations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Planner linked automation",
        kind: "project",
        status: "paused",
        schedule: { type: "cron", expression: "0 9 * * 1-5", timezone: "UTC" },
        scope: { directories: [process.cwd()] },
        execution: { environment: "local", permissionMode: "read-only" },
        prompt: "Continue the recurring Planner work.",
      }),
    })
    expect(automationResponse.status).toBe(201)
    const automation = (await readJson<{ id: string }>(automationResponse)).data!

    const linkResponse = await app.request(`/api/planner/todos/${todo.id}/automations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ automationId: automation.id }),
    })
    expect(linkResponse.status).toBe(200)
    expect((await readJson<Planner.PlannerTodo>(linkResponse)).data?.automationIds).toEqual([automation.id])

    const unlinkResponse = await app.request(
      `/api/planner/todos/${todo.id}/automations/${automation.id}`,
      { method: "DELETE" },
    )
    expect(unlinkResponse.status).toBe(200)
    expect((await readJson<Planner.PlannerTodo>(unlinkResponse)).data?.automationIds).toBeUndefined()
  })
})
