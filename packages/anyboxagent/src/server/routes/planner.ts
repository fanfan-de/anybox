import { Hono } from "hono"
import { ok, parseJsonBody, parseQuery } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"
import * as PlannerUseCase from "#server/usecases/planner.ts"

export function PlannerRoutes() {
  const app = new Hono<AppEnv>()

  app.get("/todos", (c) => {
    const input = parseQuery(
      c.req.query(),
      PlannerUseCase.ListPlannerTodosQuery,
      "INVALID_PLANNER_QUERY",
      "Planner todo query is invalid",
    )
    return ok(c, PlannerUseCase.listTodos(input))
  })

  app.get("/todos/:id", (c) => ok(c, PlannerUseCase.getTodo(c.req.param("id"))))

  app.post("/todos", async (c) => {
    const input = await parseJsonBody(
      c,
      PlannerUseCase.CreatePlannerTodoBody,
      "Body must include a valid Planner todo title",
    )
    return ok(c, PlannerUseCase.createTodo(input), 201)
  })

  app.patch("/todos/:id", async (c) => {
    const input = await parseJsonBody(
      c,
      PlannerUseCase.UpdatePlannerTodoBody,
      "Body must contain valid Planner todo fields",
    )
    return ok(c, PlannerUseCase.updateTodo(c.req.param("id"), input))
  })

  app.patch("/todos/:id/schedule", async (c) => {
    const input = await parseJsonBody(
      c,
      PlannerUseCase.SchedulePlannerTodoBody,
      "Body must set or clear both Planner schedule fields",
    )
    return ok(c, PlannerUseCase.scheduleTodo(c.req.param("id"), input))
  })

  app.post("/todos/:id/complete", async (c) => {
    const input = await parseJsonBody(
      c,
      PlannerUseCase.CompletePlannerTodoBody,
      "Body must contain a valid completion state",
      {},
    )
    return ok(c, PlannerUseCase.completeTodo(c.req.param("id"), input))
  })

  app.delete("/todos/:id", (c) => ok(c, PlannerUseCase.deleteTodo(c.req.param("id"))))

  app.post("/todos/:id/runs", async (c) => {
    const input = await parseJsonBody(
      c,
      PlannerUseCase.CreatePlannerRunBody,
      "Body must contain valid Planner Agent run options",
      {},
    )
    return ok(c, PlannerUseCase.createRun(c.req.param("id"), input), 202)
  })

  app.post("/todos/:id/automations", async (c) => {
    const input = await parseJsonBody(
      c,
      PlannerUseCase.LinkPlannerAutomationBody,
      "Body must include a valid automationId",
    )
    return ok(c, PlannerUseCase.linkAutomation(c.req.param("id"), input))
  })

  app.delete("/todos/:id/automations/:automationId", (c) => ok(c, PlannerUseCase.unlinkAutomation(
    c.req.param("id"),
    c.req.param("automationId"),
  )))

  app.get("/proposals", (c) => {
    const input = parseQuery(
      c.req.query(),
      PlannerUseCase.ListPlanProposalsQuery,
      "INVALID_PLANNER_PROPOSAL_QUERY",
      "Planner proposal query is invalid",
    )
    return ok(c, PlannerUseCase.listProposals(input))
  })

  app.get("/proposals/:id", (c) => ok(c, PlannerUseCase.getProposal(c.req.param("id"))))

  app.post("/proposals", async (c) => {
    const input = await parseJsonBody(
      c,
      PlannerUseCase.CreatePlanProposalBody,
      "Body must contain a reason and at least one valid Planner change",
    )
    return ok(c, PlannerUseCase.createProposal(input), 201)
  })

  app.post("/proposals/:id/accept", (c) =>
    ok(c, PlannerUseCase.acceptProposal(c.req.param("id"))))

  app.post("/proposals/:id/dismiss", async (c) => {
    const input = await parseJsonBody(
      c,
      PlannerUseCase.DismissPlanProposalBody,
      "Body must contain a valid dismissal reason",
      {},
    )
    return ok(c, PlannerUseCase.dismissProposal(c.req.param("id"), input))
  })

  app.get("/runs", (c) => {
    const input = parseQuery(
      c.req.query(),
      PlannerUseCase.ListPlannerRunsQuery,
      "INVALID_PLANNER_RUN_QUERY",
      "Planner Agent run query is invalid",
    )
    return ok(c, PlannerUseCase.listRuns(input))
  })

  app.get("/runs/:id", (c) => ok(c, PlannerUseCase.getRun(c.req.param("id"))))

  app.post("/runs/:id/cancel", (c) => ok(c, PlannerUseCase.cancelRun(c.req.param("id"))))

  app.post("/runs/:id/retry", async (c) => {
    const input = await parseJsonBody(
      c,
      PlannerUseCase.RetryPlannerRunBody,
      "Body must contain valid Planner Agent retry options",
      {},
    )
    return ok(c, PlannerUseCase.retryRun(c.req.param("id"), input), 202)
  })

  app.get("/audit", (c) => {
    const input = parseQuery(
      c.req.query(),
      PlannerUseCase.ListPlannerAuditQuery,
      "INVALID_PLANNER_AUDIT_QUERY",
      "Planner audit query is invalid",
    )
    return ok(c, PlannerUseCase.listAuditEvents(input))
  })

  return app
}
