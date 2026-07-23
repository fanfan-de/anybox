import * as EnvironmentDiscovery from "#environment/discovery.ts"
import * as EnvironmentEvents from "#environment/events.ts"
import * as EnvironmentRunner from "#environment/runner.ts"
import { resolveEnvironmentShellInvocation } from "#environment/shell.ts"
import * as Store from "#environment/store.ts"
import { resolveEnvironmentScript } from "#environment/types.ts"
import type { PtyRegistry } from "#pty/registry.ts"
import { ApiError } from "#server/error.ts"
import * as Session from "#session/core/session.ts"

function requireSession(projectID: string, sessionID: string) {
  const session = Session.DataBaseRead("sessions", sessionID) as Session.SessionInfo | null
  if (!session || session.projectID !== projectID) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${sessionID}' was not found in this project.`)
  }
  if (Session.isSideChatSession(session)) {
    throw new ApiError(409, "TERMINAL_UNAVAILABLE", "Side chat sessions do not support environment actions.")
  }
  return Session.normalizeSessionInfo(session)
}

function actionTerminalKey(input: {
  bindingID?: string
  environmentKey: string
  contentHash: string
  actionID: string
}) {
  const owner = input.bindingID ?? `${input.environmentKey}:${input.contentHash.slice(0, 12)}`
  return `environment-action:${owner}:${input.actionID}`.slice(0, 240)
}

function actionCommand(script: string) {
  if (process.platform === "win32") {
    return `${script.trimEnd()}\r\nexit $LASTEXITCODE\r\n`
  }
  return `${script.trimEnd()}\nexit $?\n`
}

function activeActionRun(input: {
  projectID: string
  sessionID: string
  environmentKey: string
  actionID: string
}) {
  return Store.listRuns({
    projectID: input.projectID,
    sessionID: input.sessionID,
  }).find(
    (run) =>
      run.kind === "action"
      && run.environmentKey === input.environmentKey
      && run.actionID === input.actionID
      && (run.status === "queued" || run.status === "running"),
  )
}

function completeActionRun(
  runID: string,
  status: "succeeded" | "failed" | "cancelled",
  input?: { exitCode?: number | null; error?: string },
) {
  const current = Store.getRun(runID)
  if (!current || !["queued", "running"].includes(current.status)) return current
  const run = Store.updateRun(runID, {
    status,
    exitCode: input?.exitCode,
    error: input?.error,
    finishedAt: Date.now(),
  })
  if (run) EnvironmentEvents.publish("environment.run.completed", { run })
  return run
}

export async function startAction(input: {
  projectID: string
  environmentKey: string
  expectedHash: string
  actionID: string
  sessionID: string
  registry: PtyRegistry
}) {
  const session = requireSession(input.projectID, input.sessionID)
  const environment = await EnvironmentDiscovery.requireEnvironmentCandidate({
    projectID: input.projectID,
    directory: session.directory,
    key: input.environmentKey,
    expectedHash: input.expectedHash,
    requireTrusted: true,
  })
  const binding = environment.bindingID
    ? Store.getBinding(environment.bindingID)
    : undefined
  const action = environment.definition.actions.find((item) => item.id === input.actionID)
  if (!action) {
    throw new ApiError(
      404,
      "ENVIRONMENT_ACTION_NOT_FOUND",
      `Environment action '${input.actionID}' was not found.`,
    )
  }
  const script = resolveEnvironmentScript(action.scripts)
  if (!script) {
    throw new ApiError(
      409,
      "ENVIRONMENT_SCRIPT_UNAVAILABLE",
      "This action has no script for the current platform.",
    )
  }
  const cwd = await EnvironmentRunner.internal.resolveWorkingDirectory(
    environment.rootDirectory,
    action.cwd,
  )
  const invocation = resolveEnvironmentShellInvocation(script)
  const terminalKey = actionTerminalKey({
    bindingID: environment.bindingID,
    environmentKey: environment.key,
    contentHash: environment.contentHash,
    actionID: action.id,
  })
  const existingPty = input.registry.getBySession(input.sessionID, terminalKey)
  const existingRun = activeActionRun({
    projectID: input.projectID,
    sessionID: input.sessionID,
    environmentKey: environment.key,
    actionID: action.id,
  })
  if (existingPty) {
    const run = existingRun ?? Store.createRun({
      projectID: input.projectID,
      environmentKey: environment.key,
      contentHash: environment.contentHash,
      kind: "action",
      actionID: action.id,
      sessionID: input.sessionID,
      bindingID: environment.bindingID,
      worktreeID: binding?.worktreeID,
      cwd,
      status: "running",
    })
    if (!existingRun) {
      const updated = Store.updateRun(run.id, {
        ptyID: existingPty.id,
        startedAt: Date.now(),
      })
      if (updated) EnvironmentEvents.publish("environment.run.created", { run: updated })
    }
    return {
      run: Store.getRun(run.id) ?? run,
      pty: existingPty.info(),
      reused: true,
    }
  }

  const run = Store.createRun({
    projectID: input.projectID,
    environmentKey: environment.key,
    contentHash: environment.contentHash,
    kind: "action",
    actionID: action.id,
    sessionID: input.sessionID,
    bindingID: environment.bindingID,
    worktreeID: binding?.worktreeID,
    cwd,
  })
  EnvironmentEvents.publish("environment.run.created", { run })

  try {
    const pty = await input.registry.create({
      sessionID: input.sessionID,
      terminalKey,
      purpose: "environment-action",
      title: action.name,
      cwd,
      shell: invocation.executable,
    })
    const running = Store.updateRun(run.id, {
      status: "running",
      ptyID: pty.id,
      startedAt: Date.now(),
    })
    if (running) EnvironmentEvents.publish("environment.run.updated", { run: running })

    const managed = input.registry.get(pty.id)
    const unsubscribe = managed?.subscribe((event) => {
      if (event.type === "exited") {
        unsubscribe?.()
        completeActionRun(
          run.id,
          event.session.exitCode === 0 ? "succeeded" : "failed",
          {
            exitCode: event.session.exitCode,
            error: event.session.exitCode === 0
              ? undefined
              : `Environment action exited with code ${event.session.exitCode ?? "unknown"}.`,
          },
        )
      } else if (event.type === "deleted") {
        unsubscribe?.()
        completeActionRun(run.id, "cancelled", {
          error: "Environment action was stopped.",
        })
      }
    })
    input.registry.write(pty.id, actionCommand(script))
    return {
      run: Store.getRun(run.id) ?? run,
      pty,
      reused: false,
    }
  } catch (error) {
    completeActionRun(run.id, "failed", {
      exitCode: null,
      error: error instanceof Error ? error.message : "Environment action failed to start.",
    })
    throw error
  }
}

export async function stopAction(input: {
  projectID: string
  environmentKey: string
  actionID: string
  sessionID: string
  registry: PtyRegistry
}) {
  requireSession(input.projectID, input.sessionID)
  const run = activeActionRun(input)
  if (!run) {
    throw new ApiError(
      404,
      "ENVIRONMENT_ACTION_NOT_RUNNING",
      "This environment action is not running.",
    )
  }
  if (run.ptyID) input.registry.delete(run.ptyID)
  return completeActionRun(run.id, "cancelled", {
    error: "Environment action was stopped.",
  }) ?? run
}

export async function restartSetupForSession(input: {
  projectID: string
  environmentKey: string
  expectedHash: string
  sessionID: string
}) {
  const session = requireSession(input.projectID, input.sessionID)
  const environment = await EnvironmentDiscovery.requireEnvironmentCandidate({
    projectID: input.projectID,
    directory: session.directory,
    key: input.environmentKey,
    expectedHash: input.expectedHash,
    requireTrusted: true,
  })
  if (!environment.bindingID) {
    throw new ApiError(
      409,
      "ENVIRONMENT_SETUP_REQUIRES_WORKTREE",
      "Setup can only be re-run for a managed worktree binding.",
    )
  }
  const binding = Store.getBinding(environment.bindingID)
  if (!binding) {
    throw new ApiError(404, "ENVIRONMENT_BINDING_NOT_FOUND", "Worktree environment binding was not found.")
  }
  return EnvironmentRunner.startSetup(binding)
}

export async function cancelWorktreeActions(worktreeID: string, registry: PtyRegistry) {
  const runs = Store.listRuns({ worktreeID })
    .filter((run) => run.kind === "action" && (run.status === "queued" || run.status === "running"))
  for (const run of runs) {
    if (run.ptyID) registry.delete(run.ptyID)
    completeActionRun(run.id, "cancelled", {
      error: "Environment action was stopped because its worktree was removed.",
    })
  }
}

export async function cancelProjectActions(projectID: string, registry: PtyRegistry) {
  const runs = Store.listRuns({ projectID })
    .filter((run) => run.kind === "action" && (run.status === "queued" || run.status === "running"))
  for (const run of runs) {
    if (run.ptyID) registry.delete(run.ptyID)
    completeActionRun(run.id, "cancelled", {
      error: "Environment action was stopped because its project was removed.",
    })
  }
}

export async function cancelAllActions(registry: PtyRegistry) {
  const runs = Store.listRuns()
    .filter((run) => run.kind === "action" && (run.status === "queued" || run.status === "running"))
  for (const run of runs) {
    if (run.ptyID) registry.delete(run.ptyID)
    completeActionRun(run.id, "cancelled", {
      error: "Environment action was stopped because the Agent shut down.",
    })
  }
}
