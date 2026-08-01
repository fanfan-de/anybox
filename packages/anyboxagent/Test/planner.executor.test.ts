import { describe, expect, it } from "bun:test"
import "./sqlite.cleanup.ts"
import * as PlannerExecutor from "#planner/executor.ts"
import * as PlannerService from "#planner/service.ts"

describe("Planner AgentTaskRun executor", () => {
  it("records target failures without changing Todo completion", async () => {
    const todo = PlannerService.createTodo({
      title: "Planner executor missing target",
      status: "todo",
      projectId: "project-does-not-exist",
    })
    const queued = PlannerService.createRun({
      todoId: todo.id,
      projectId: todo.projectId,
      requestedToolModuleIds: ["planner.core"],
    }, { actor: "user" })

    const failed = await PlannerExecutor.executeRun(queued.id)
    expect(failed).toMatchObject({
      id: queued.id,
      status: "failed",
      error: "Project 'project-does-not-exist' was not found.",
    })
    expect(PlannerService.getTodo(todo.id)?.status).toBe("todo")
    expect(PlannerService.listAuditEvents({ entityType: "run", entityId: queued.id }).map((event) => event.action)).toEqual(
      expect.arrayContaining(["run.created", "run.failed"]),
    )
  })

  it("cancels queued runs without starting a session", () => {
    const todo = PlannerService.createTodo({ title: "Cancel queued Planner run" })
    const queued = PlannerService.createRun({ todoId: todo.id, projectId: "project-unused" })
    const canceled = PlannerExecutor.cancelRun(queued.id, { actor: "user" })
    expect(canceled.status).toBe("canceled")
    expect(canceled.sessionId).toBeUndefined()
    expect(PlannerService.getTodo(todo.id)?.status).toBe("inbox")
  })
})
