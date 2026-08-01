import { jsonRequestInit, requestAgentJSON } from "../agent-api-client"
import type {
  AgentTaskRun,
  AgentTaskRunStatus,
  CreateAgentTaskRunInput,
  CreatePlannerTodoInput,
  PlanProposal,
  PlanProposalStatus,
  PlannerScheduleInput,
  PlannerTodo,
  PlannerTodoStatus,
  PlannerTodoView,
  UpdatePlannerTodoInput,
} from "./planner-types"

export interface ListPlannerTodosInput {
  view?: PlannerTodoView
  now?: number
  query?: string
  projectId?: string
  status?: PlannerTodoStatus | "all"
  schedule?: "scheduled" | "unscheduled" | "all"
  includeTerminal?: boolean
  limit?: number
}

function appendParam(params: URLSearchParams, key: string, value: string | number | boolean | undefined) {
  if (value !== undefined && value !== "") params.set(key, String(value))
}

export function listPlannerTodos(input: ListPlannerTodosInput = {}) {
  const params = new URLSearchParams()
  appendParam(params, "view", input.view)
  appendParam(params, "now", input.now)
  appendParam(params, "query", input.query?.trim())
  appendParam(params, "projectId", input.projectId)
  appendParam(params, "status", input.status)
  appendParam(params, "schedule", input.schedule)
  appendParam(params, "includeTerminal", input.includeTerminal)
  appendParam(params, "limit", input.limit)
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  return requestAgentJSON<PlannerTodo[]>(`/api/planner/todos${suffix}`)
}

export function createPlannerTodo(input: CreatePlannerTodoInput) {
  return requestAgentJSON<PlannerTodo>("/api/planner/todos", jsonRequestInit("POST", input))
}

export function updatePlannerTodo(todoId: string, input: UpdatePlannerTodoInput) {
  return requestAgentJSON<PlannerTodo>(
    `/api/planner/todos/${encodeURIComponent(todoId)}`,
    jsonRequestInit("PATCH", input),
  )
}

export function schedulePlannerTodo(todoId: string, input: PlannerScheduleInput) {
  return requestAgentJSON<PlannerTodo>(
    `/api/planner/todos/${encodeURIComponent(todoId)}/schedule`,
    jsonRequestInit("PATCH", input),
  )
}

export function completePlannerTodo(todoId: string, completed = true) {
  return requestAgentJSON<PlannerTodo>(
    `/api/planner/todos/${encodeURIComponent(todoId)}/complete`,
    jsonRequestInit("POST", { completed }),
  )
}

export function deletePlannerTodo(todoId: string) {
  return requestAgentJSON<{ todoId: string; deleted: true }>(
    `/api/planner/todos/${encodeURIComponent(todoId)}`,
    { method: "DELETE" },
  )
}

export function listPlanProposals(status: PlanProposalStatus | "all" = "pending") {
  const params = new URLSearchParams({ status })
  return requestAgentJSON<PlanProposal[]>(`/api/planner/proposals?${params.toString()}`)
}

export function acceptPlanProposal(proposalId: string) {
  return requestAgentJSON<{ proposal: PlanProposal; appliedTodos: PlannerTodo[] }>(
    `/api/planner/proposals/${encodeURIComponent(proposalId)}/accept`,
    { method: "POST" },
  )
}

export function dismissPlanProposal(proposalId: string, reason?: string) {
  return requestAgentJSON<PlanProposal>(
    `/api/planner/proposals/${encodeURIComponent(proposalId)}/dismiss`,
    jsonRequestInit("POST", reason ? { reason } : {}),
  )
}

export function listPlannerRuns(input: { todoId?: string; status?: AgentTaskRunStatus | "all" } = {}) {
  const params = new URLSearchParams()
  appendParam(params, "todoId", input.todoId)
  appendParam(params, "status", input.status)
  const suffix = params.size > 0 ? `?${params.toString()}` : ""
  return requestAgentJSON<AgentTaskRun[]>(`/api/planner/runs${suffix}`)
}

export function startPlannerRun(todoId: string, input: CreateAgentTaskRunInput) {
  return requestAgentJSON<AgentTaskRun>(
    `/api/planner/todos/${encodeURIComponent(todoId)}/runs`,
    jsonRequestInit("POST", input),
  )
}

export function cancelPlannerRun(runId: string) {
  return requestAgentJSON<AgentTaskRun>(
    `/api/planner/runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" },
  )
}

export function retryPlannerRun(runId: string, input: Partial<CreateAgentTaskRunInput> = {}) {
  return requestAgentJSON<AgentTaskRun>(
    `/api/planner/runs/${encodeURIComponent(runId)}/retry`,
    jsonRequestInit("POST", input),
  )
}

export function linkPlannerAutomation(todoId: string, automationId: string) {
  return requestAgentJSON<PlannerTodo>(
    `/api/planner/todos/${encodeURIComponent(todoId)}/automations`,
    jsonRequestInit("POST", { automationId }),
  )
}

export function unlinkPlannerAutomation(todoId: string, automationId: string) {
  return requestAgentJSON<PlannerTodo>(
    `/api/planner/todos/${encodeURIComponent(todoId)}/automations/${encodeURIComponent(automationId)}`,
    { method: "DELETE" },
  )
}
