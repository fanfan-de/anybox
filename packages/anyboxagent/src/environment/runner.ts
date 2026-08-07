import { realpath, stat } from "node:fs/promises"
import path from "node:path"
import * as EnvironmentEvents from "#environment/events.ts"
import { resolveEnvironmentShellInvocation } from "#environment/shell.ts"
import * as Store from "#environment/store.ts"
import {
  resolveEnvironmentScript,
  type EnvironmentRunRecord,
  type WorktreeEnvironmentBinding,
} from "#environment/types.ts"
import { buildPtyEnvironment } from "#pty/runtime.ts"
import { ApiError } from "#server/error.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "environment.runner" })

type CancellationReason = "cancelled" | "timed-out"

interface ActiveSetup {
  process: Bun.Subprocess<"ignore", "pipe", "pipe">
  worktreeID: string
  cancellation?: CancellationReason
  timeout?: ReturnType<typeof setTimeout>
}

const activeSetups = new Map<string, ActiveSetup>()

function normalizePath(input: string) {
  const normalized = path.normalize(path.resolve(input))
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function containsPath(root: string, candidate: string) {
  const relative = path.relative(normalizePath(root), normalizePath(candidate))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function resolveDirectory(root: string, relativeDirectory: string) {
  if (path.isAbsolute(relativeDirectory)) {
    throw new ApiError(
      400,
      "ENVIRONMENT_CWD_OUTSIDE_ROOT",
      "Environment cwd must be relative.",
    )
  }
  const candidate = path.resolve(root, relativeDirectory)
  if (!containsPath(root, candidate)) {
    throw new ApiError(
      400,
      "ENVIRONMENT_CWD_OUTSIDE_ROOT",
      "Environment cwd resolves outside the environment root.",
    )
  }
  return candidate
}

async function requireDirectory(candidate: string) {
  const info = await stat(candidate).catch(() => undefined)
  if (!info?.isDirectory()) {
    throw new ApiError(
      400,
      "ENVIRONMENT_CWD_NOT_FOUND",
      `Environment working directory '${candidate}' does not exist.`,
    )
  }
  return candidate
}

async function verifyWorkingDirectory(root: string, candidate: string) {
  await requireDirectory(candidate)
  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ])
  if (!containsPath(canonicalRoot, canonicalCandidate)) {
    throw new ApiError(
      400,
      "ENVIRONMENT_CWD_OUTSIDE_ROOT",
      "Environment cwd resolves outside the environment root through a symbolic link.",
    )
  }
  return canonicalCandidate
}

async function resolveWorkingDirectory(root: string, relativeDirectory: string) {
  return verifyWorkingDirectory(root, resolveDirectory(root, relativeDirectory))
}

async function pumpOutput(
  runID: string,
  stream: ReadableStream<Uint8Array>,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const result = await reader.read()
    if (result.done) break
    const chunk = decoder.decode(result.value, { stream: true })
    if (!chunk) continue
    Store.appendRunOutput(runID, chunk)
    EnvironmentEvents.publish("environment.run.output", { runID, chunk })
  }
  const tail = decoder.decode()
  if (tail) {
    Store.appendRunOutput(runID, tail)
    EnvironmentEvents.publish("environment.run.output", { runID, chunk: tail })
  }
}

async function terminateProcessTree(active: ActiveSetup) {
  const pid = active.process.pid
  if (process.platform === "win32") {
    const termination = Bun.spawn(
      ["taskkill.exe", "/PID", String(pid), "/T", "/F"],
      { stdout: "ignore", stderr: "ignore" },
    )
    const exitCode = await termination.exited.catch(() => undefined)
    if (exitCode !== undefined && exitCode !== 0) {
      log.warn("process-tree-termination-failed", { pid, exitCode })
    }
    active.process.kill()
    return
  }

  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    active.process.kill("SIGTERM")
  }
  const force = setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL")
    } catch {
      active.process.kill("SIGKILL")
    }
  }, 2000)
  force.unref?.()
}

function completeRun(
  runID: string,
  update: Pick<EnvironmentRunRecord, "status"> & {
    exitCode?: number | null
    error?: string
  },
) {
  const run = Store.updateRun(runID, {
    ...update,
    finishedAt: Date.now(),
  })
  if (run) EnvironmentEvents.publish("environment.run.completed", { run })
  if (run) {
    log.info("run-completed", {
      runID: run.id,
      worktreeID: run.worktreeID,
      status: run.status,
      exitCode: run.exitCode,
    })
  }
  return run
}

async function executeSetup(
  run: EnvironmentRunRecord,
  binding: WorktreeEnvironmentBinding,
  script: string,
  timeoutSeconds: number,
) {
  let active: ActiveSetup | undefined
  try {
    const verifiedCwd = await verifyWorkingDirectory(binding.targetRoot, run.cwd)
    if (normalizePath(verifiedCwd) !== normalizePath(run.cwd)) {
      throw new ApiError(
        409,
        "ENVIRONMENT_CWD_CHANGED",
        "Environment cwd changed after the run was queued.",
      )
    }
    const invocation = await resolveEnvironmentShellInvocation(script)
    const running = Store.updateRun(run.id, {
      status: "running",
      startedAt: Date.now(),
    })
    if (running) EnvironmentEvents.publish("environment.run.updated", { run: running })
    log.info("setup-started", {
      runID: run.id,
      worktreeID: binding.worktreeID,
      cwd: run.cwd,
    })

    const child = Bun.spawn(
      [invocation.executable, ...invocation.args],
      {
        cwd: run.cwd,
        env: buildPtyEnvironment(run.cwd, invocation.executable),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        // Bun currently drops PowerShell 7 command arguments for detached Windows
        // children. taskkill /T can still terminate the full tree without a
        // detached process group, while Unix needs one for negative-PID signals.
        detached: process.platform !== "win32",
      },
    )
    active = {
      process: child,
      worktreeID: binding.worktreeID,
    }
    activeSetups.set(run.id, active)
    active.timeout = setTimeout(() => {
      const current = activeSetups.get(run.id)
      if (!current) return
      current.cancellation = "timed-out"
      void terminateProcessTree(current)
    }, timeoutSeconds * 1000)
    active.timeout.unref?.()

    await Promise.all([
      pumpOutput(run.id, child.stdout),
      pumpOutput(run.id, child.stderr),
      child.exited,
    ])
    const exitCode = child.exitCode
    const cancellation = active.cancellation
    if (cancellation) {
      completeRun(run.id, {
        status: cancellation,
        exitCode,
        error: cancellation === "timed-out"
          ? `Environment setup timed out after ${timeoutSeconds} seconds.`
          : "Environment setup was cancelled.",
      })
      return
    }
    if (exitCode === 0) {
      completeRun(run.id, { status: "succeeded", exitCode })
      return
    }
    completeRun(run.id, {
      status: "failed",
      exitCode,
      error: `Environment setup exited with code ${exitCode ?? "unknown"}.`,
    })
  } catch (error) {
    log.error("setup-failed", {
      runID: run.id,
      worktreeID: binding.worktreeID,
      error,
    })
    completeRun(run.id, {
      status: "failed",
      exitCode: null,
      error: error instanceof Error ? error.message : "Environment setup failed.",
    })
  } finally {
    if (active?.timeout) clearTimeout(active.timeout)
    activeSetups.delete(run.id)
  }
}

export async function startSetup(binding: WorktreeEnvironmentBinding) {
  const setup = binding.definition.setup
  if (!setup) return undefined
  const script = resolveEnvironmentScript(setup.scripts)
  if (!script) {
    throw new ApiError(
      409,
      "ENVIRONMENT_SCRIPT_UNAVAILABLE",
      "This environment has no setup script for the current platform.",
    )
  }
  if (!Store.isTrusted(binding.projectID, binding.sourceConfigPath, binding.contentHash)) {
    throw new ApiError(
      403,
      "ENVIRONMENT_NOT_TRUSTED",
      "Trust this environment configuration before running setup.",
    )
  }
  const existing = Store.listRuns({
    worktreeID: binding.worktreeID,
    status: "running",
  }).find((run) => run.kind === "setup")
  const queued = Store.listRuns({
    worktreeID: binding.worktreeID,
    status: "queued",
  }).find((run) => run.kind === "setup")
  if (existing || queued) {
    throw new ApiError(
      409,
      "ENVIRONMENT_RUN_ACTIVE",
      "Environment setup is already running for this worktree.",
      { runID: (existing ?? queued)?.id },
    )
  }

  const cwd = await resolveWorkingDirectory(binding.targetRoot, setup.cwd)
  const run = Store.createRun({
    projectID: binding.projectID,
    environmentKey: binding.environmentKey,
    contentHash: binding.contentHash,
    kind: "setup",
    worktreeID: binding.worktreeID,
    bindingID: binding.id,
    cwd,
  })
  EnvironmentEvents.publish("environment.run.created", { run })
  log.info("setup-queued", {
    runID: run.id,
    worktreeID: binding.worktreeID,
    cwd,
  })
  void executeSetup(run, binding, script, setup.timeoutSeconds)
  return run
}

export function recordRejectedSetup(
  binding: WorktreeEnvironmentBinding,
  error: unknown,
) {
  const setup = binding.definition.setup
  let cwd = binding.targetRoot
  if (setup) {
    try {
      cwd = resolveDirectory(binding.targetRoot, setup.cwd)
    } catch {
      // Preserve the target root in the diagnostic record when cwd itself is invalid.
    }
  }
  const run = Store.createRun({
    projectID: binding.projectID,
    environmentKey: binding.environmentKey,
    contentHash: binding.contentHash,
    kind: "setup",
    worktreeID: binding.worktreeID,
    bindingID: binding.id,
    cwd,
    status: "failed",
  })
  EnvironmentEvents.publish("environment.run.created", { run })
  return completeRun(run.id, {
    status: "failed",
    exitCode: null,
    error: error instanceof Error ? error.message : "Environment setup could not be started.",
  }) ?? run
}

export function getRun(runID: string) {
  const run = Store.getRun(runID)
  if (!run) {
    throw new ApiError(404, "ENVIRONMENT_RUN_NOT_FOUND", `Environment run '${runID}' was not found.`)
  }
  return run
}

export async function cancelRun(runID: string) {
  const run = getRun(runID)
  if (run.status === "queued") {
    return completeRun(runID, {
      status: "cancelled",
      error: "Environment setup was cancelled.",
    })
  }
  if (run.status !== "running") return run
  const active = activeSetups.get(runID)
  if (!active) {
    return completeRun(runID, {
      status: "cancelled",
      error: "Environment setup was cancelled after its process became unavailable.",
    })
  }
  active.cancellation = "cancelled"
  await terminateProcessTree(active)
  await active.process.exited.catch(() => undefined)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = Store.getRun(runID)
    if (!current || !["queued", "running"].includes(current.status)) return current ?? run
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
  }
  return Store.getRun(runID) ?? run
}

export async function retrySetup(runID: string) {
  const run = getRun(runID)
  if (run.kind !== "setup" || !run.bindingID) {
    throw new ApiError(409, "ENVIRONMENT_RUN_NOT_RETRYABLE", "Only bound setup runs can be retried.")
  }
  if (run.status === "queued" || run.status === "running") {
    throw new ApiError(409, "ENVIRONMENT_RUN_ACTIVE", "Environment setup is still running.")
  }
  const binding = Store.getBinding(run.bindingID)
  if (!binding) {
    throw new ApiError(404, "ENVIRONMENT_BINDING_NOT_FOUND", "The worktree environment binding no longer exists.")
  }
  return startSetup(binding)
}

export async function cancelWorktreeRuns(worktreeID: string) {
  const running = Store.listRuns({ worktreeID })
    .filter((run) => run.status === "queued" || run.status === "running")
  await Promise.all(running.map((run) => cancelRun(run.id)))
}

export async function cancelProjectRuns(projectID: string) {
  const running = Store.listRuns({ projectID })
    .filter((run) => run.kind === "setup" && (run.status === "queued" || run.status === "running"))
  await Promise.all(running.map((run) => cancelRun(run.id)))
}

export async function cancelAllRuns() {
  await Promise.all([...activeSetups.keys()].map(cancelRun))
}

export const internal = {
  activeSetups,
  containsPath,
  requireDirectory,
  resolveDirectory,
  resolveWorkingDirectory,
  verifyWorkingDirectory,
}
