import { describe, expect, it } from "bun:test"
import "./sqlite.cleanup.ts"
import * as Sqlite from "#database/Sqlite.ts"
import * as PlannerRepository from "#planner/repository.ts"
import * as PlannerService from "#planner/service.ts"

describe("Planner domain service", () => {
  it("migrates the existing planner_tasks table in place", () => {
    Sqlite.db.run(`
      CREATE TABLE IF NOT EXISTS "planner_tasks" (
        "id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT,
        "status" TEXT NOT NULL,
        "priority" TEXT NOT NULL,
        "dueAt" REAL,
        "reminderAt" REAL,
        "scheduledStartAt" REAL,
        "scheduledEndAt" REAL,
        "estimateMinutes" REAL,
        "workspaceId" TEXT,
        "properties" TEXT,
        "timezone" TEXT,
        "createdAt" REAL NOT NULL,
        "updatedAt" REAL NOT NULL
      );
    `)
    const id = "tsk_legacyPlannerMigration"
    const updatedAt = Date.UTC(2026, 6, 31, 8, 0)
    Sqlite.db.prepare(`
      INSERT INTO "planner_tasks" (
        "id", "title", "status", "priority", "workspaceId", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, "Legacy Calendar todo", "done", "high", "legacy-project", updatedAt - 1000, updatedAt)

    // Reopen the same database to exercise the one-time migration for a new runtime generation.
    Sqlite.closeDatabase()
    const migrated = PlannerRepository.getTodo(id)
    expect(migrated).toMatchObject({
      id,
      status: "done",
      priority: "high",
      projectId: "legacy-project",
      workspaceId: "legacy-project",
      completedAt: updatedAt,
    })

    const columns = Sqlite.db.prepare(`PRAGMA table_info("planner_tasks")`).all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "projectId",
      "parentTodoId",
      "completedAt",
      "automationIds",
    ]))
  })

  it("serves Today, Inbox, Upcoming, Unscheduled, Completed, and Project views", () => {
    const nowDate = new Date(2026, 7, 1, 12, 0, 0, 0)
    const now = nowDate.getTime()
    const todayDue = new Date(2026, 7, 1, 18, 0, 0, 0).getTime()
    const tomorrowDue = new Date(2026, 7, 2, 18, 0, 0, 0).getTime()

    const inbox = PlannerService.createTodo({ title: "Planner view inbox" }, { now })
    const today = PlannerService.createTodo({
      title: "Planner view today",
      status: "todo",
      dueAt: todayDue,
    }, { now: now + 1 })
    const upcoming = PlannerService.createTodo({
      title: "Planner view upcoming",
      status: "todo",
      dueAt: tomorrowDue,
    }, { now: now + 2 })
    const project = PlannerService.createTodo({
      title: "Planner project work",
      status: "doing",
      projectId: "project-alpha",
    }, { now: now + 3 })
    const completed = PlannerService.createTodo({
      title: "Planner completed work",
      status: "done",
    }, { now: now + 4 })

    expect(PlannerService.listTodos({ view: "inbox", now }).map((todo) => todo.id)).toContain(inbox.id)
    expect(PlannerService.listTodos({ view: "today", now }).map((todo) => todo.id)).toContain(today.id)
    expect(PlannerService.listTodos({ view: "upcoming", now }).map((todo) => todo.id)).toContain(upcoming.id)
    expect(PlannerService.listTodos({ view: "unscheduled", now }).map((todo) => todo.id)).toContain(project.id)
    expect(PlannerService.listTodos({
      view: "project",
      projectId: "project-alpha",
      now,
    }).map((todo) => todo.id)).toEqual([project.id])
    expect(PlannerService.listTodos({ view: "completed", now }).map((todo) => todo.id)).toContain(completed.id)
    expect(PlannerService.listTodos({ status: "done", now }).map((todo) => todo.id)).toContain(completed.id)
    expect(PlannerService.listTodos({ view: "all", now }).map((todo) => todo.id)).not.toContain(completed.id)
  })

  it("creates unapplied proposals and accepts every change atomically", () => {
    const now = Date.UTC(2026, 7, 3, 8, 0)
    const first = PlannerService.createTodo({
      title: "Proposal first todo",
      status: "todo",
    }, { now })
    const second = PlannerService.createTodo({
      title: "Proposal second todo",
      status: "todo",
      dueAt: now + 24 * 60 * 60_000,
    }, { now: now + 1 })
    const scheduledStartAt = now + 60 * 60_000
    const scheduledEndAt = scheduledStartAt + 30 * 60_000

    const proposal = PlannerService.createProposal({
      reason: "Batch the reviewed Planner changes",
      changes: [
        {
          kind: "update",
          todoId: first.id,
          fields: { title: "Proposal first todo updated" },
          expectedUpdatedAt: first.updatedAt,
        },
        {
          kind: "schedule",
          todoId: second.id,
          scheduledStartAt,
          scheduledEndAt,
          expectedUpdatedAt: second.updatedAt,
        },
      ],
    }, { actor: "agent", now: now + 2 })

    expect(proposal.status).toBe("pending")
    expect(PlannerService.getTodo(first.id)?.title).toBe("Proposal first todo")
    expect(PlannerService.getTodo(second.id)?.scheduledStartAt).toBeUndefined()

    const accepted = PlannerService.acceptProposal(proposal.id, { actor: "user", now: now + 3 })
    expect(accepted.proposal.status).toBe("accepted")
    expect(PlannerService.getTodo(first.id)?.title).toBe("Proposal first todo updated")
    expect(PlannerService.getTodo(second.id)).toMatchObject({ scheduledStartAt, scheduledEndAt })
    expect(PlannerService.getTodo(second.id)?.dueAt).toBe(now + 24 * 60 * 60_000)
    expect(() => PlannerService.acceptProposal(proposal.id)).toThrow("already accepted")

    expect(PlannerService.listAuditEvents({
      entityType: "proposal",
      entityId: proposal.id,
    }).map((event) => event.action)).toEqual(expect.arrayContaining([
      "proposal.created",
      "proposal.accepted",
    ]))
  })

  it("rolls back all proposal changes when a later change fails", () => {
    const now = Date.UTC(2026, 7, 4, 8, 0)
    const first = PlannerService.createTodo({
      title: "Atomic rollback first",
      status: "todo",
    }, { now })
    const second = PlannerService.createTodo({
      title: "Atomic rollback second",
      status: "todo",
    }, { now: now + 1 })
    const proposal = PlannerService.createProposal({
      reason: "This proposal will become invalid before acceptance",
      changes: [
        { kind: "update", todoId: first.id, fields: { title: "Must roll back" } },
        { kind: "update", todoId: second.id, fields: { title: "Missing later todo" } },
      ],
    }, { actor: "agent", now: now + 2 })

    PlannerService.deleteTodo(second.id, { now: now + 3 })
    expect(() => PlannerService.acceptProposal(proposal.id, { now: now + 4 })).toThrow("was not found")
    expect(PlannerService.getTodo(first.id)?.title).toBe("Atomic rollback first")
    expect(PlannerService.getProposal(proposal.id)?.status).toBe("pending")
  })

  it("rejects stale proposals and dismisses proposals without changing todos", () => {
    const now = Date.UTC(2026, 7, 5, 8, 0)
    const todo = PlannerService.createTodo({ title: "Proposal conflict todo", status: "todo" }, { now })
    const stale = PlannerService.createProposal({
      reason: "Stale update",
      changes: [{
        kind: "update",
        todoId: todo.id,
        fields: { title: "Stale title" },
        expectedUpdatedAt: todo.updatedAt,
      }],
    }, { actor: "agent", now: now + 1 })
    PlannerService.updateTodo(todo.id, { title: "User title wins" }, { actor: "user", now: now + 2 })

    expect(() => PlannerService.acceptProposal(stale.id, { now: now + 3 })).toThrow("changed after")
    expect(PlannerService.getTodo(todo.id)?.title).toBe("User title wins")
    expect(PlannerService.getProposal(stale.id)?.status).toBe("pending")

    const dismissed = PlannerService.dismissProposal(stale.id, "No longer relevant", {
      actor: "user",
      now: now + 4,
    })
    expect(dismissed).toMatchObject({ status: "dismissed", decisionReason: "No longer relevant" })
    expect(PlannerService.getTodo(todo.id)?.title).toBe("User title wins")
  })

  it("tracks AgentTaskRun independently from todo completion", () => {
    const now = Date.UTC(2026, 7, 6, 8, 0)
    const todo = PlannerService.createTodo({
      title: "Run boundary todo",
      status: "todo",
    }, { now })
    const queued = PlannerService.createRun({
      todoId: todo.id,
      sessionId: "session-planner-run",
      input: { prompt: "Do the work" },
    }, { actor: "agent", now: now + 1 })
    const running = PlannerService.transitionRun(queued.id, { status: "running" }, {
      actor: "agent",
      now: now + 2,
    })
    const completed = PlannerService.transitionRun(running.id, {
      status: "completed",
      result: { summary: "Work finished" },
    }, { actor: "agent", now: now + 3 })

    expect(completed).toMatchObject({
      status: "completed",
      result: { summary: "Work finished" },
    })
    expect(PlannerService.getTodo(todo.id)?.status).toBe("todo")
    expect(PlannerService.listRuns({ todoId: todo.id }).map((run) => run.id)).toContain(queued.id)
  })

  it("links Automation definitions without copying their schedule or run state", () => {
    const now = Date.UTC(2026, 7, 6, 12, 0)
    const todo = PlannerService.createTodo({ title: "Automation relationship todo" }, { now })
    const linked = PlannerService.linkAutomation(todo.id, "automation-example", true, {
      actor: "user",
      now: now + 1,
    })
    expect(linked.automationIds).toEqual(["automation-example"])
    expect(PlannerService.linkAutomation(todo.id, "automation-example", true).automationIds).toEqual([
      "automation-example",
    ])

    const unlinked = PlannerService.linkAutomation(todo.id, "automation-example", false, {
      actor: "user",
      now: now + 2,
    })
    expect(unlinked.automationIds).toBeUndefined()
    expect(PlannerService.listAuditEvents({ entityType: "todo", entityId: todo.id }).map((event) => event.action)).toEqual(
      expect.arrayContaining(["todo.automation.linked", "todo.automation.unlinked"]),
    )
  })
})
