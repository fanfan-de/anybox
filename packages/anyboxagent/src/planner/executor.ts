import { PLANNER_CORE_TOOL_MODULE_ID } from "@anybox/shared"
import * as db from "#database/Sqlite.ts"
import * as Project from "#project/project.ts"
import { Instance } from "#project/instance.ts"
import * as PlannerService from "#planner/service.ts"
import * as Session from "#session/core/session.ts"
import * as Prompt from "#session/core/prompt.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "planner.executor" })

type ActiveRunHandle = {
  cancel: () => void
  sessionId: string
  turnId?: string
}

type PromptExecutionResult = {
  latest?: {
    parts?: unknown[]
  }
  status?: "completed" | "blocked" | "failed" | "continued_by_user"
  finishReason?: string
  errorInfo?: {
    message?: string
  }
}

const activeRuns = new Map<string, ActiveRunHandle>()

function compactText(value: string | undefined, maxLength = 2_000) {
  const compacted = value?.replace(/\s+/g, " ").trim()
  if (!compacted) return undefined
  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 3).trimEnd()}...`
    : compacted
}

function extractTextFromParts(parts: unknown[] | undefined) {
  return (parts ?? [])
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const record = part as Record<string, unknown>
      return record.type === "text" && typeof record.text === "string" ? record.text : ""
    })
    .filter(Boolean)
    .join("\n\n")
}

function buildTodoRunPrompt(todo: NonNullable<ReturnType<typeof PlannerService.getTodo>>, instructions?: string) {
  return [
    "Execute the explicitly delegated Anybox Planner todo below.",
    `Todo ID: ${todo.id}`,
    `Title: ${todo.title}`,
    todo.description ? `Notes: ${todo.description}` : undefined,
    todo.projectId ? `Project ID: ${todo.projectId}` : undefined,
    todo.dueAt ? `Due at: ${new Date(todo.dueAt).toISOString()}` : undefined,
    instructions ? `Delegation instructions: ${instructions}` : undefined,
    "Do not mark the Planner todo complete. Agent execution status and Todo completion are separate user decisions.",
    "Do not delegate this todo into another AgentTaskRun.",
    "Finish with a concise summary of work performed, results, artifacts, blockers, and suggested next action.",
  ].filter(Boolean).join("\n\n")
}

function applyReadOnlyPolicy(session: Session.SessionInfo, permissionMode: "read-only" | "default") {
  if (permissionMode !== "read-only") return
  db.updateByIdWithSchema(
    "sessions",
    session.id,
    {
      ...session,
      policy: {
        toolPolicy: "read-only",
        ignoreFullAccess: true,
      },
    },
    Session.SessionInfo,
  )
}

function resolveDirectory(run: NonNullable<ReturnType<typeof PlannerService.getRun>>) {
  const directory = run.directory?.trim()
  if (directory) return directory

  const projectId = run.projectId?.trim()
  if (!projectId) {
    throw new Error(`Planner run '${run.id}' needs a project or directory target.`)
  }
  const project = Project.get(projectId)
  if (!project) throw new Error(`Project '${projectId}' was not found.`)
  return Project.getRepositoryRoot(project)
}

export async function executeRun(runId: string) {
  const initialRun = PlannerService.getRun(runId)
  if (!initialRun) throw new Error(`Planner Agent run '${runId}' was not found.`)
  if (initialRun.status !== "queued") return initialRun

  const todo = PlannerService.getTodo(initialRun.todoId)
  if (!todo) {
    return PlannerService.transitionRun(runId, {
      status: "failed",
      error: `Planner todo '${initialRun.todoId}' was not found.`,
    }, { actor: "system" })
  }

  try {
    const directory = resolveDirectory(initialRun)
    const { project } = await Project.fromDirectory(directory)
    const session = await Session.createSession({
      directory,
      projectID: project.id,
      title: `Planner · ${todo.title}`,
    })
    const permissionMode = initialRun.permissionMode ?? "default"
    applyReadOnlyPolicy(session, permissionMode)

    const requestedToolModuleIds = initialRun.requestedToolModuleIds?.length
      ? initialRun.requestedToolModuleIds
      : [PLANNER_CORE_TOOL_MODULE_ID]
    const prompt = buildTodoRunPrompt(todo, initialRun.prompt)
    const handle = await Instance.provide({
      directory,
      fn: () => Prompt.promptExecution({
        sessionID: session.id,
        parts: [{ type: "text", text: prompt }],
        displayText: initialRun.prompt ?? todo.title,
        turnToolModuleIDs: requestedToolModuleIds,
      }),
    })

    activeRuns.set(runId, {
      cancel: handle.cancel,
      sessionId: session.id,
      turnId: handle.turnID,
    })
    PlannerService.transitionRun(runId, {
      status: "running",
      directory,
      projectId: project.id,
      sessionId: session.id,
      turnId: handle.turnID,
    }, {
      actor: "system",
      sourceSessionId: initialRun.sourceSessionId,
      sourceTurnId: initialRun.sourceTurnId,
    })

    const promptResult = await handle.promise as PromptExecutionResult
    const status = promptResult.status === "blocked"
      ? "blocked" as const
      : promptResult.status === "failed"
        ? "failed" as const
        : "completed" as const
    const summary = compactText(extractTextFromParts(promptResult.latest?.parts))
    return PlannerService.transitionRun(runId, {
      status,
      result: {
        summary,
        finishReason: promptResult.finishReason,
        toolModuleIds: requestedToolModuleIds,
      },
      error: promptResult.errorInfo?.message,
    }, {
      actor: "system",
      sourceSessionId: initialRun.sourceSessionId,
      sourceTurnId: initialRun.sourceTurnId,
    })
  } catch (error) {
    const current = PlannerService.getRun(runId)
    if (!current || current.status === "canceled") return current
    const message = error instanceof Error ? error.message : String(error)
    log.error("run-failed", { runId, todoId: initialRun.todoId, error: message })
    return PlannerService.transitionRun(runId, {
      status: "failed",
      error: message,
    }, {
      actor: "system",
      sourceSessionId: initialRun.sourceSessionId,
      sourceTurnId: initialRun.sourceTurnId,
    })
  } finally {
    activeRuns.delete(runId)
  }
}

export function startRun(runId: string) {
  void executeRun(runId).catch((error) => {
    log.error("background-run-failed", {
      runId,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

export function cancelRun(
  runId: string,
  context: PlannerService.MutationContext = { actor: "user" },
) {
  const run = PlannerService.getRun(runId)
  if (!run) throw new Error(`Planner Agent run '${runId}' was not found.`)
  if (["completed", "failed", "canceled"].includes(run.status)) return run
  activeRuns.get(runId)?.cancel()
  return PlannerService.transitionRun(runId, { status: "canceled" }, context)
}
