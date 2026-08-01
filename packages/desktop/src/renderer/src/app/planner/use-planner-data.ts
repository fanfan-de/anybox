import { useCallback, useEffect, useRef, useState } from "react"
import {
  acceptPlanProposal,
  cancelPlannerRun,
  completePlannerTodo,
  createPlannerTodo,
  deletePlannerTodo,
  dismissPlanProposal,
  linkPlannerAutomation,
  listPlanProposals,
  listPlannerRuns,
  listPlannerTodos,
  schedulePlannerTodo,
  startPlannerRun,
  retryPlannerRun,
  unlinkPlannerAutomation,
  updatePlannerTodo,
} from "./planner-client"
import type {
  AgentTaskRun,
  CreateAgentTaskRunInput,
  CreatePlannerTodoInput,
  PlanProposal,
  PlannerScheduleInput,
  PlannerSection,
  PlannerTodo,
  UpdatePlannerTodoInput,
} from "./planner-types"

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sectionToView(section: PlannerSection) {
  return section === "pending" || section === "calendar" ? "today" : section
}

export function usePlannerData(input: { section: PlannerSection; projectId?: string; query?: string }) {
  const [todos, setTodos] = useState<PlannerTodo[]>([])
  const [allTodos, setAllTodos] = useState<PlannerTodo[]>([])
  const [proposals, setProposals] = useState<PlanProposal[]>([])
  const [runs, setRuns] = useState<AgentTaskRun[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isMutating, setIsMutating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestVersionRef = useRef(0)

  const reload = useCallback(async () => {
    const requestVersion = ++requestVersionRef.current
    setIsLoading(true)
    try {
      const view = sectionToView(input.section)
      const [nextTodos, nextAllTodos, nextProposals, nextRuns] = await Promise.all([
        listPlannerTodos({
          view,
          now: Date.now(),
          query: input.query,
          projectId: view === "project" ? input.projectId : undefined,
          limit: 500,
        }),
        listPlannerTodos({ view: "all", includeTerminal: true, limit: 500 }),
        listPlanProposals("pending"),
        listPlannerRuns(),
      ])
      if (requestVersion === requestVersionRef.current) {
        setTodos(nextTodos)
        setAllTodos(nextAllTodos)
        setProposals(nextProposals)
        setRuns(nextRuns)
        setError(null)
      }
    } catch (nextError) {
      if (requestVersion === requestVersionRef.current) setError(formatError(nextError))
    } finally {
      if (requestVersion === requestVersionRef.current) setIsLoading(false)
    }
  }, [input.projectId, input.query, input.section])

  useEffect(() => {
    void reload()
    return () => {
      requestVersionRef.current += 1
    }
  }, [reload])

  useEffect(() => {
    if (!runs.some((run) => run.status === "queued" || run.status === "running")) return
    const intervalId = window.setInterval(() => void reload(), 2_000)
    return () => window.clearInterval(intervalId)
  }, [reload, runs])

  const mutate = useCallback(async <T,>(action: () => Promise<T>) => {
    setIsMutating(true)
    try {
      const result = await action()
      await reload()
      return result
    } catch (nextError) {
      setError(formatError(nextError))
      throw nextError
    } finally {
      setIsMutating(false)
    }
  }, [reload])

  return {
    allTodos,
    error,
    isLoading,
    isMutating,
    proposals,
    runs,
    todos,
    reload,
    clearError: () => setError(null),
    createTodo: (todo: CreatePlannerTodoInput) => mutate(() => createPlannerTodo(todo)),
    updateTodo: (todoId: string, update: UpdatePlannerTodoInput) => mutate(() => updatePlannerTodo(todoId, update)),
    scheduleTodo: (todoId: string, schedule: PlannerScheduleInput) => mutate(() => schedulePlannerTodo(todoId, schedule)),
    completeTodo: (todoId: string, completed = true) => mutate(() => completePlannerTodo(todoId, completed)),
    deleteTodo: (todoId: string) => mutate(() => deletePlannerTodo(todoId)),
    acceptProposal: (proposalId: string) => mutate(() => acceptPlanProposal(proposalId)),
    dismissProposal: (proposalId: string) => mutate(() => dismissPlanProposal(proposalId)),
    startRun: (todoId: string, run: CreateAgentTaskRunInput) => mutate(() => startPlannerRun(todoId, run)),
    cancelRun: (runId: string) => mutate(() => cancelPlannerRun(runId)),
    retryRun: (runId: string, run: Partial<CreateAgentTaskRunInput> = {}) => mutate(() => retryPlannerRun(runId, run)),
    linkAutomation: (todoId: string, automationId: string) => mutate(() => linkPlannerAutomation(todoId, automationId)),
    unlinkAutomation: (todoId: string, automationId: string) => mutate(() => unlinkPlannerAutomation(todoId, automationId)),
  }
}
