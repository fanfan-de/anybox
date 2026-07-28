import z from "zod"
import * as db from "#database/Sqlite.ts"
import * as Permission from "#permission/schema.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import * as Session from "#session/core/session.ts"
import * as Task from "#session/tasks/task.ts"

let permissionProjectionGeneration = -1

function clearStreamPartProjection(sessionID: string, partID: string) {
  void sessionID
  void partID
}

function ensurePermissionProjectionTables() {
  const generation = db.getDatabaseGeneration()
  if (permissionProjectionGeneration === generation && generation > 0) return
  if (!db.tableExists("permission_requests")) {
    db.createTableByZodObject("permission_requests", Permission.Request)
  }
  db.syncTableColumnsWithZodObject("permission_requests", Permission.Request)
  permissionProjectionGeneration = db.getDatabaseGeneration()
}

function upsertPermissionRequest(request: Permission.Request) {
  ensurePermissionProjectionTables()
  const existing = db.findById("permission_requests", Permission.Request, request.id)
  if (existing) {
    db.updateByIdWithSchema("permission_requests", request.id, request, Permission.Request)
    return
  }

  db.insertOneWithSchema("permission_requests", request, Permission.Request)
}

function projectTerminalState(
  event:
    | z.infer<typeof RuntimeEvent.TurnCompletedEvent>
    | z.infer<typeof RuntimeEvent.TurnFailedEvent>
    | z.infer<typeof RuntimeEvent.TurnCancelledEvent>,
) {
  if (event.payload.message) {
    Session.upsertMessage(event.payload.message)
  }

  for (const part of event.payload.parts ?? []) {
    clearStreamPartProjection(event.sessionID, part.id)
    Session.upsertPart(part)
  }

  const lastMessageID = event.payload.message?.id
  if (event.type === "turn.completed") {
    Session.updateTurn(event.turnID ?? undefined, {
      status: event.payload.status === "stopped" ? "cancelled" : event.payload.status,
      phase: event.payload.status,
      finishReason: event.payload.finishReason,
      lastMessageID,
      completedAt: event.timestamp,
    })
    return
  }
  if (event.type === "turn.failed") {
    Session.updateTurn(event.turnID ?? undefined, {
      status: "failed",
      phase: event.payload.phase ?? "failed",
      error: event.payload.error,
      errorInfo: event.payload.errorInfo,
      lastMessageID,
      completedAt: event.timestamp,
    })
    return
  }
  Session.updateTurn(event.turnID ?? undefined, {
    status: "cancelled",
    phase: "cancelled",
    error: event.payload.detail,
    lastMessageID,
    completedAt: event.timestamp,
  })
}

function projectTurnStarted(event: z.infer<typeof RuntimeEvent.TurnStartedEvent>) {
  if (!event.turnID) return
  const existing = Session.DataBaseRead("turns", event.turnID) as Session.TurnInfo | null
  if (existing) {
    Session.updateTurn(event.turnID, { status: "running", phase: "preparing" })
    return
  }
  const session = Session.DataBaseRead("sessions", event.sessionID) as Session.SessionInfo | null
  if (!session) return
  Session.createTurn({
    id: event.turnID,
    sessionID: event.sessionID,
    projectID: session.projectID,
    userMessageID: event.payload.userMessageID,
    resume: event.payload.resume,
    agent: event.payload.agent,
    model: event.payload.model,
    executionID: event.payload.executionID,
    threadTargetKind: event.payload.targetKind,
    initialParentMessageID: event.payload.initialParentMessageID,
    phase: "preparing",
  })
}

function projectTurnState(event: z.infer<typeof RuntimeEvent.TurnStateChangedEvent>) {
  const terminalStatus: Partial<Record<RuntimeEvent.TurnRuntimePhase, Session.TurnStatus>> = {
    blocked: "blocked",
    continued_by_user: "continued_by_user",
    completed: "completed",
    cancelled: "cancelled",
    failed: "failed",
  }
  Session.updateTurn(event.turnID ?? undefined, {
    status: terminalStatus[event.payload.phase] ?? "running",
    phase: event.payload.phase,
    lastMessageID: event.payload.messageID,
    error: event.payload.phase === "failed" ? event.payload.reason : undefined,
    completedAt: terminalStatus[event.payload.phase] ? event.timestamp : undefined,
  })
}

export function project(event: RuntimeEvent.RuntimeEvent) {
  switch (event.type) {
    case "turn.started":
      projectTurnStarted(event)
      return
    case "turn.state.changed":
      projectTurnState(event)
      return
    case "llm.call.started":
    case "llm.call.completed":
    case "llm.call.failed":
    case "turn.error.context":
    case "retry.scheduled":
    case "subagent.created":
      return
    case "task.state.updated":
      Task.replaceTasksFromState({
        sessionID: event.sessionID,
        state: event.payload.state,
      })
      return
    case "message.recorded":
      if (
        event.targetKind === "detached-branch" ||
        (
          event.turnID &&
          (Session.DataBaseRead("turns", event.turnID) as Session.TurnInfo | null)?.threadTargetKind ===
            "detached-branch"
        )
      ) {
        Session.recordMessage(event.payload.message)
      } else {
        Session.recordActiveMessage(event.payload.message)
      }
      return
    case "message.removed":
      Session.deleteMessage(event.sessionID, event.payload.messageID)
      return
    case "part.recorded":
      Session.upsertPart(event.payload.part)
      return
    case "part.removed":
      clearStreamPartProjection(event.sessionID, event.payload.partID)
      Session.deletePart(event.payload.partID)
      return
    case "permission.requested":
    case "permission.resolved":
      upsertPermissionRequest(event.payload.request)
      Session.upsertPart(event.payload.part)
      return
    case "text.part.started":
    case "text.part.delta":
      return
    case "text.part.completed":
      clearStreamPartProjection(event.sessionID, event.payload.part.id)
      Session.upsertPart(event.payload.part)
      return
    case "reasoning.part.started":
    case "reasoning.part.delta":
      return
    case "reasoning.part.completed":
      clearStreamPartProjection(event.sessionID, event.payload.part.id)
      Session.upsertPart(event.payload.part)
      return
    case "tool.call.pending":
    case "tool.call.started":
    case "tool.call.waiting_approval":
    case "tool.call.approved":
    case "tool.call.denied":
    case "tool.call.cancelled":
    case "tool.call.completed":
    case "tool.call.failed":
      Session.upsertPart(event.payload.part)
      return
    case "source.recorded":
    case "file.generated":
      Session.upsertPart(event.payload.part)
      return
    case "patch.generated":
    case "snapshot.captured":
      Session.upsertPart(event.payload.part)
      return
    case "turn.completed":
    case "turn.failed":
    case "turn.cancelled":
      projectTerminalState(event)
      return
  }
}
