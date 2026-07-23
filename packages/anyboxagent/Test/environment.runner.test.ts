import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import * as EnvironmentRunner from "#environment/runner.ts"
import * as Store from "#environment/store.ts"
import { ENVIRONMENT_OUTPUT_MAX_CHARS } from "#environment/types.ts"
import * as Identifier from "#id/id.ts"

function scripts(input: { windows: string; unix: string }) {
  return {
    windows: input.windows,
    macos: input.unix,
    linux: input.unix,
  }
}

async function createBinding(input: {
  root: string
  setupScript: { windows: string; unix: string }
  timeoutSeconds?: number
}) {
  const projectID = `project_environment_runner_${Date.now()}_${Math.random()}`
  const contentHash = `${Date.now()}${Math.random()}`.replace(".", "")
  const sourceConfigPath = path.join(input.root, "environment.jsonc")
  Store.trustEnvironment(projectID, sourceConfigPath, contentHash)
  return Store.createBinding({
    projectID,
    worktreeID: Identifier.descending("worktree"),
    sourceDirectory: input.root,
    targetDirectory: input.root,
    sourceConfigPath,
    sourceRoot: input.root,
    targetRoot: input.root,
    environmentKey: `environment_${contentHash}`,
    contentHash,
    source: "anybox-jsonc",
    definition: {
      version: 1,
      name: "Runner test",
      setup: {
        scripts: scripts(input.setupScript),
        cwd: ".",
        timeoutSeconds: input.timeoutSeconds ?? 10,
      },
      actions: [],
    },
  })
}

async function waitForRun(runID: string, timeoutMs = 8_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const run = EnvironmentRunner.getRun(runID)
    if (!["queued", "running"].includes(run.status)) return run
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for environment run '${runID}'.`)
}

describe("environment setup runner", () => {
  test("records output and a successful exit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-environment-runner-success-"))
    try {
      const binding = await createBinding({
        root,
        setupScript: {
          windows: "Write-Output 'setup-ok'",
          unix: "printf 'setup-ok\\n'",
        },
      })
      const queued = await EnvironmentRunner.startSetup(binding)
      expect(queued?.status).toBe("queued")

      const run = await waitForRun(queued!.id)
      expect(run.status).toBe("succeeded")
      expect(run.exitCode).toBe(0)
      expect(run.output).toContain("setup-ok")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("records non-zero exits without removing the binding", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-environment-runner-failure-"))
    try {
      const binding = await createBinding({
        root,
        setupScript: {
          windows: "Write-Error 'setup-failed'; exit 7",
          unix: "printf 'setup-failed\\n' >&2; exit 7",
        },
      })
      const queued = await EnvironmentRunner.startSetup(binding)
      const run = await waitForRun(queued!.id)

      expect(run.status).toBe("failed")
      expect(run.exitCode).toBe(7)
      expect(Store.getBinding(binding.id)?.id).toBe(binding.id)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("truncates retained setup output from the front", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-environment-runner-output-"))
    try {
      const binding = await createBinding({
        root,
        setupScript: {
          windows: "Write-Output 'unused'",
          unix: "printf 'unused\\n'",
        },
      })
      const run = Store.createRun({
        projectID: binding.projectID,
        environmentKey: binding.environmentKey,
        contentHash: binding.contentHash,
        kind: "setup",
        worktreeID: binding.worktreeID,
        bindingID: binding.id,
        cwd: root,
      })
      Store.appendRunOutput(run.id, `prefix-${"x".repeat(ENVIRONMENT_OUTPUT_MAX_CHARS)}-tail`)
      const retained = Store.getRun(run.id)!

      expect(retained.output).toHaveLength(ENVIRONMENT_OUTPUT_MAX_CHARS)
      expect(retained.output.startsWith("prefix-")).toBe(false)
      expect(retained.output.endsWith("-tail")).toBe(true)
      expect(retained.outputTruncated).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("rejects a cwd symlink that resolves outside the environment root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-environment-runner-root-"))
    const outside = await mkdtemp(path.join(tmpdir(), "anybox-environment-runner-outside-"))
    try {
      await symlink(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir")
      const binding = await createBinding({
        root,
        setupScript: {
          windows: "Write-Output 'unsafe'",
          unix: "printf 'unsafe\\n'",
        },
      })
      binding.definition.setup!.cwd = "linked"
      Store.createBinding({
        ...binding,
        definition: binding.definition,
      })

      let rejected: unknown
      try {
        await EnvironmentRunner.startSetup(Store.getBinding(binding.id)!)
      } catch (error) {
        rejected = error
      }
      expect(rejected).toBeInstanceOf(Error)
      expect((rejected as { code?: string }).code).toBe("ENVIRONMENT_CWD_OUTSIDE_ROOT")
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  test("times out and terminates a long-running setup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-environment-runner-timeout-"))
    try {
      const binding = await createBinding({
        root,
        timeoutSeconds: 1,
        setupScript: {
          windows: "Start-Sleep -Seconds 10",
          unix: "sleep 10",
        },
      })
      const queued = await EnvironmentRunner.startSetup(binding)
      const run = await waitForRun(queued!.id, 5_000)

      expect(run.status).toBe("timed-out")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("cancels and terminates a running setup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-environment-runner-cancel-"))
    try {
      const binding = await createBinding({
        root,
        setupScript: {
          windows: "Start-Sleep -Seconds 10",
          unix: "sleep 10",
        },
      })
      const queued = await EnvironmentRunner.startSetup(binding)
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (EnvironmentRunner.getRun(queued!.id).status === "running") break
        await Bun.sleep(10)
      }
      const cancelled = await EnvironmentRunner.cancelRun(queued!.id)

      expect(cancelled.status).toBe("cancelled")
      expect(EnvironmentRunner.getRun(queued!.id).status).toBe("cancelled")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
