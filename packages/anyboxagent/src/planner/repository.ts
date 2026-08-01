import * as db from "#database/Sqlite.ts"
import * as Identifier from "#id/id.ts"
import {
  AgentTaskRun,
  PlanProposal,
  PlannerAuditEvent,
  PlannerTodo,
} from "#planner/model.ts"

const TODOS_TABLE = "planner_tasks"
const PROPOSALS_TABLE = "planner_proposals"
const RUNS_TABLE = "planner_agent_task_runs"
const AUDIT_TABLE = "planner_audit_events"

let plannerTablesGeneration = -1

export function ensurePlannerTables() {
  const generation = db.getDatabaseGeneration()
  if (plannerTablesGeneration === generation && generation > 0) return

  // planner_tasks is the existing Calendar/Todo table. It is extended in place so
  // Calendar, native tools, and Planner APIs never create competing sources of truth.
  db.syncTableColumnsWithZodObject(TODOS_TABLE, PlannerTodo)
  db.syncTableColumnsWithZodObject(PROPOSALS_TABLE, PlanProposal)
  db.syncTableColumnsWithZodObject(RUNS_TABLE, AgentTaskRun)
  db.syncTableColumnsWithZodObject(AUDIT_TABLE, PlannerAuditEvent)

  db.db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_planner_tasks_id"
    ON "planner_tasks" ("id");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_planner_tasks_schedule"
    ON "planner_tasks" ("scheduledStartAt", "scheduledEndAt");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_planner_tasks_status"
    ON "planner_tasks" ("status", "updatedAt");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_planner_tasks_project"
    ON "planner_tasks" ("projectId", "status", "updatedAt");
  `)
  db.db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_planner_proposals_id"
    ON "planner_proposals" ("id");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_planner_proposals_status"
    ON "planner_proposals" ("status", "createdAt");
  `)
  db.db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_planner_runs_id"
    ON "planner_agent_task_runs" ("id");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_planner_runs_todo_status"
    ON "planner_agent_task_runs" ("todoId", "status", "updatedAt");
  `)
  db.db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_planner_audit_id"
    ON "planner_audit_events" ("id");
  `)
  db.db.run(`
    CREATE INDEX IF NOT EXISTS "idx_planner_audit_entity"
    ON "planner_audit_events" ("entityType", "entityId", "createdAt");
  `)

  migrateLegacyTodoRows()
  plannerTablesGeneration = db.getDatabaseGeneration()
}

function migrateLegacyTodoRows() {
  db.db.run(`
    UPDATE "planner_tasks"
    SET "status" = 'todo'
    WHERE "status" NOT IN ('inbox', 'todo', 'doing', 'waiting', 'done', 'canceled');
  `)
  db.db.run(`
    UPDATE "planner_tasks"
    SET "priority" = 'medium'
    WHERE "priority" NOT IN ('low', 'medium', 'high', 'urgent');
  `)
  db.db.run(`
    UPDATE "planner_tasks"
    SET "projectId" = "workspaceId"
    WHERE ("projectId" IS NULL OR TRIM("projectId") = '')
      AND "workspaceId" IS NOT NULL
      AND TRIM("workspaceId") != '';
  `)
  db.db.run(`
    UPDATE "planner_tasks"
    SET "workspaceId" = "projectId"
    WHERE ("workspaceId" IS NULL OR TRIM("workspaceId") = '')
      AND "projectId" IS NOT NULL
      AND TRIM("projectId") != '';
  `)
  db.db.run(`
    UPDATE "planner_tasks"
    SET "completedAt" = "updatedAt"
    WHERE "status" = 'done' AND "completedAt" IS NULL;
  `)
}

export function createTodoID() {
  return Identifier.descending("task")
}

export function createProposalID() {
  return Identifier.descending("plannerProposal")
}

export function createRunID() {
  return Identifier.descending("plannerRun")
}

export function createAuditID() {
  return Identifier.descending("plannerAudit")
}

export function listTodos() {
  ensurePlannerTables()
  return db.findManyWithSchema(TODOS_TABLE, PlannerTodo, {
    orderBy: [
      { column: "createdAt", direction: "DESC" },
      { column: "id", direction: "ASC" },
    ],
  })
}

export function getTodo(id: string) {
  ensurePlannerTables()
  return db.findById(TODOS_TABLE, PlannerTodo, id)
}

export function insertTodo(todo: PlannerTodo) {
  ensurePlannerTables()
  db.insertOneWithSchema(TODOS_TABLE, todo, PlannerTodo)
  return todo
}

export function updateTodo(todo: PlannerTodo) {
  ensurePlannerTables()
  db.updateByIdWithSchema(TODOS_TABLE, todo.id, todo, PlannerTodo)
  return todo
}

export function deleteTodo(id: string) {
  ensurePlannerTables()
  return db.deleteById(TODOS_TABLE, id)
}

export function listProposals() {
  ensurePlannerTables()
  return db.findManyWithSchema(PROPOSALS_TABLE, PlanProposal, {
    orderBy: [
      { column: "createdAt", direction: "DESC" },
      { column: "id", direction: "ASC" },
    ],
  })
}

export function getProposal(id: string) {
  ensurePlannerTables()
  return db.findById(PROPOSALS_TABLE, PlanProposal, id)
}

export function insertProposal(proposal: PlanProposal) {
  ensurePlannerTables()
  db.insertOneWithSchema(PROPOSALS_TABLE, proposal, PlanProposal)
  return proposal
}

export function updateProposal(proposal: PlanProposal) {
  ensurePlannerTables()
  db.updateByIdWithSchema(PROPOSALS_TABLE, proposal.id, proposal, PlanProposal)
  return proposal
}

export function listRuns() {
  ensurePlannerTables()
  return db.findManyWithSchema(RUNS_TABLE, AgentTaskRun, {
    orderBy: [
      { column: "createdAt", direction: "DESC" },
      { column: "id", direction: "ASC" },
    ],
  })
}

export function getRun(id: string) {
  ensurePlannerTables()
  return db.findById(RUNS_TABLE, AgentTaskRun, id)
}

export function insertRun(run: AgentTaskRun) {
  ensurePlannerTables()
  db.insertOneWithSchema(RUNS_TABLE, run, AgentTaskRun)
  return run
}

export function updateRun(run: AgentTaskRun) {
  ensurePlannerTables()
  db.updateByIdWithSchema(RUNS_TABLE, run.id, run, AgentTaskRun)
  return run
}

export function insertAuditEvent(event: PlannerAuditEvent) {
  ensurePlannerTables()
  db.insertOneWithSchema(AUDIT_TABLE, event, PlannerAuditEvent)
  return event
}

export function listAuditEvents(input: {
  entityType?: PlannerAuditEvent["entityType"]
  entityId?: string
} = {}) {
  ensurePlannerTables()
  return db.findManyWithSchema(AUDIT_TABLE, PlannerAuditEvent, {
    orderBy: [
      { column: "createdAt", direction: "DESC" },
      { column: "id", direction: "ASC" },
    ],
  }).filter((event) => {
    if (input.entityType && event.entityType !== input.entityType) return false
    if (input.entityId && event.entityId !== input.entityId) return false
    return true
  })
}

export function transaction<T>(fn: () => T) {
  ensurePlannerTables()
  return db.db.transaction(fn)()
}
