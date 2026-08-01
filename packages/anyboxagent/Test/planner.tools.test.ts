import { describe, expect, it } from "bun:test"
import "./sqlite.cleanup.ts"
import { PLANNER_CORE_TOOL_MODULE_ID } from "@anybox/shared"
import * as Calendar from "#calendar/calendar.ts"
import { Instance } from "#project/instance.ts"
import { createServerApp } from "#server/server.ts"
import * as Tool from "#tool/tool.ts"
import * as ToolModule from "#tool/module.ts"

type PlannerTodo = Calendar.PlannerTask

function readData(output: Tool.ToolOutput | string) {
  return Tool.normalizeToolOutput(output).data as Record<string, unknown>
}

describe("Planner native tool module", () => {
  it("manages the existing Planner domain after explicit module activation", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const moduleTools = await ToolModule.load(PLANNER_CORE_TOOL_MODULE_ID)
        expect(moduleTools?.map((item) => item.id)).toEqual([
          "planner_list_todos",
          "planner_get_todo",
          "planner_create_todo",
          "planner_update_todo",
          "planner_complete_todo",
          "planner_schedule_todo",
          "planner_find_free_time",
          "planner_create_proposal",
          "planner_accept_proposal",
          "planner_dismiss_proposal",
          "planner_run_todo",
          "planner_link_automation",
        ])
        expect(moduleTools?.every((item) =>
          item.source?.kind === "native-module" && item.source.id === PLANNER_CORE_TOOL_MODULE_ID,
        )).toBe(true)

        const byID = new Map(moduleTools?.map((item) => [item.id, item]))
        const runtimeContext = {
          sessionID: "planner-native-tool-test",
          messageID: "planner-native-tool-message",
          abort: new AbortController().signal,
        }
        const run = async (toolID: string, parameters: Record<string, unknown>) => {
          const definition = byID.get(toolID)
          if (!definition) throw new Error(`Expected Planner tool '${toolID}'.`)
          const runtime = await definition.init()
          return readData(await runtime.execute(parameters, runtimeContext))
        }

        const acceptRuntime = await byID.get("planner_accept_proposal")!.init()
        expect(await acceptRuntime.assessPermission?.({ id: "plp_permission_probe" }, runtimeContext)).toMatchObject({
          action: "ask",
          forceAsk: true,
        })
        const runRuntime = await byID.get("planner_run_todo")!.init()
        expect(await runRuntime.assessPermission?.({ id: "tsk_permission_probe" }, runtimeContext)).toMatchObject({
          action: "ask",
          forceAsk: true,
          risk: "high",
        })
        const linkRuntime = await byID.get("planner_link_automation")!.init()
        expect(await linkRuntime.assessPermission?.({
          id: "tsk_permission_probe",
          automationId: "automation_permission_probe",
        }, runtimeContext)).toMatchObject({
          action: "ask",
          forceAsk: true,
        })

        const rangeStartAt = Date.UTC(2026, 7, 1, 9, 0)
        const scheduledStartAt = Date.UTC(2026, 7, 1, 10, 0)
        const scheduledEndAt = Date.UTC(2026, 7, 1, 11, 0)
        const rangeEndAt = Date.UTC(2026, 7, 1, 12, 0)
        let todoID: string | undefined

        try {
          const created = await run("planner_create_todo", {
            title: "Verify native Planner tools",
            description: "Created by the native Planner tool integration test.",
            priority: "high",
            dueAt: "2026-08-02T03:00:00.000Z",
            estimateMinutes: 60,
            workspaceId: "Anybox",
          })
          const createdTodo = created.todo as PlannerTodo
          todoID = createdTodo.id

          expect(createdTodo).toMatchObject({
            title: "Verify native Planner tools",
            priority: "high",
            dueAt: Date.parse("2026-08-02T03:00:00.000Z"),
            estimateMinutes: 60,
            workspaceId: "Anybox",
            status: "todo",
          })
          expect(Calendar.getTask(todoID)).toEqual(createdTodo)

          const api = createServerApp()
          const todosResponse = await api.request("/api/calendar/todos")
          const todosBody = await todosResponse.json() as {
            success: boolean
            data?: PlannerTodo[]
          }
          expect(todosResponse.status).toBe(200)
          expect(todosBody.success).toBe(true)
          expect(todosBody.data).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: todoID }),
          ]))

          const updated = await run("planner_update_todo", {
            id: todoID,
            description: "Updated through the native tool.",
          })
          expect(updated.todo).toMatchObject({
            id: todoID,
            description: "Updated through the native tool.",
          })

          const scheduled = await run("planner_schedule_todo", {
            id: todoID,
            scheduledStartAt,
            scheduledEndAt,
          })
          expect(scheduled.todo).toMatchObject({
            id: todoID,
            scheduledStartAt,
            scheduledEndAt,
          })

          const calendarItemsResponse = await api.request(
            `/api/calendar/items?startAt=${rangeStartAt}&endAt=${rangeEndAt}`,
          )
          const calendarItemsBody = await calendarItemsResponse.json() as {
            success: boolean
            data?: Calendar.CalendarItem[]
          }
          expect(calendarItemsBody.data).toEqual(expect.arrayContaining([
            expect.objectContaining({
              entityId: todoID,
              displayKind: "scheduled_todo",
              startAt: scheduledStartAt,
              endAt: scheduledEndAt,
            }),
          ]))

          const freeTime = await run("planner_find_free_time", {
            rangeStartAt,
            rangeEndAt,
            durationMinutes: 30,
            limit: 3,
          })
          expect(freeTime.busy).toEqual(expect.arrayContaining([
            expect.objectContaining({
              source: "todo",
              sourceID: todoID,
              startAt: scheduledStartAt,
              endAt: scheduledEndAt,
            }),
          ]))
          expect(freeTime.slots).toEqual(expect.arrayContaining([
            expect.objectContaining({
              startAt: rangeStartAt,
              endAt: rangeStartAt + 30 * 60_000,
            }),
          ]))

          const listed = await run("planner_list_todos", {
            query: "native planner",
            status: "todo",
          })
          expect(listed.todos).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: todoID }),
          ]))

          const current = Calendar.getTask(todoID)!
          const proposed = await run("planner_create_proposal", {
            reason: "Review a priority change before applying it.",
            changes: [{
              kind: "update",
              todoId: todoID,
              fields: { priority: "urgent" },
              expectedUpdatedAt: current.updatedAt,
            }],
          })
          const proposal = proposed.proposal as { id: string; status: string }
          expect(proposal.status).toBe("pending")
          expect(Calendar.getTask(todoID)?.priority).toBe("high")

          const accepted = await run("planner_accept_proposal", { id: proposal.id })
          expect(accepted.proposal).toMatchObject({ id: proposal.id, status: "accepted" })
          expect(Calendar.getTask(todoID)?.priority).toBe("urgent")

          const proposedDismissal = await run("planner_create_proposal", {
            reason: "Review a title change that will be dismissed.",
            changes: [{
              kind: "update",
              todoId: todoID,
              fields: { title: "This title must not be applied" },
            }],
          })
          const dismissalProposal = proposedDismissal.proposal as { id: string }
          const dismissed = await run("planner_dismiss_proposal", {
            id: dismissalProposal.id,
            reason: "Keep the original title.",
          })
          expect(dismissed.proposal).toMatchObject({
            id: dismissalProposal.id,
            status: "dismissed",
          })
          expect(Calendar.getTask(todoID)?.title).toBe("Verify native Planner tools")

          const completed = await run("planner_complete_todo", { id: todoID })
          expect(completed.todo).toMatchObject({ id: todoID, status: "done" })

          const fetched = await run("planner_get_todo", { id: todoID })
          expect(fetched.todo).toMatchObject({ id: todoID, status: "done" })
        } finally {
          if (todoID && Calendar.getTask(todoID)) Calendar.deleteTask(todoID)
        }
      },
    })
  })
})
