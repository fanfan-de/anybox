import { test, expect } from "bun:test"
import "./sqlite.cleanup.ts"
import { $ } from "bun"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Instance } from "#project/instance.ts"
import * as Identifier from "#id/id.ts"
import * as Config from "#config/config.ts"
import * as Permission from "#permission/permission.ts"
import { runWithFilesystemAuthorization } from "#permission/filesystem-authorization.ts"
import { resolveToolPath } from "#tool/shared.ts"
import {
  getBrowserAuthorizationEnvironment,
  signBrowserAuthorizationReceipt,
  verifyBrowserAuthorizationReceiptForTest,
} from "#permission/authorization-receipt.ts"
import * as Message from "#session/core/message.ts"
import * as Session from "#session/core/session.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"
import * as db from "#database/Sqlite.ts"

test("browser authorization exposes only an asymmetric verification key", () => {
  const environment = getBrowserAuthorizationEnvironment()
  expect(Object.keys(environment)).toEqual([
    "ANYBOX_BROWSER_AUTH_PUBLIC_KEY",
  ])
  expect(environment).not.toHaveProperty("ANYBOX_BROWSER_AUTH_SECRET")

  const context = {
    sessionID: "session-public-key",
    turnID: "turn-public-key",
    messageID: "message-public-key",
    toolCallID: "tool-public-key",
  }
  const now = Date.now()
  const receipt = signBrowserAuthorizationReceipt({
    context,
    decision: "allow-once",
    challenge: {
      challengeID: "challenge-public-key",
      nonce: "challenge-nonce",
      grantID: "grant-public-key",
      method: "tabs.open",
      security: "target-url",
      ...context,
      browserID: "extension:profile-public-key",
      extensionInstanceID: "profile-public-key",
      origin: "https://example.com",
      sensitive: false,
      issuedAt: now,
      expiresAt: now + 60_000,
    },
  })

  expect(verifyBrowserAuthorizationReceiptForTest(receipt)).toMatchObject({
    method: "tabs.open",
    origin: "https://example.com",
    ...context,
  })
})

async function createGitRepo(root: string, seed: string) {
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, "README.md"), `# ${seed}\n`)
  await $`git init`.cwd(root).quiet()
  await $`git config user.email test@example.com`.cwd(root).quiet()
  await $`git config user.name anybox-test`.cwd(root).quiet()
  await $`git add README.md`.cwd(root).quiet()
  await $`git commit -m init`.cwd(root).quiet()
}

async function waitForPendingBrowserPermission(
  sessionID: string,
  toolCallID: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const request = (await Permission.listRequests({
      sessionID,
      status: "pending",
    })).find((candidate) => candidate.toolCallID === toolCallID)
    if (request) return request
    await Bun.sleep(5)
  }
  throw new Error(`Pending browser permission '${toolCallID}' was not created.`)
}

test("in-process browser permissions scope session grants and fail closed", async () => {
  const repositoryRoot = await mkdtemp(
    path.join(tmpdir(), "anybox-permission-browser-origin-"),
  )

  try {
    await createGitRepo(repositoryRoot, "browser-origin-permission")
    await Instance.provide({
      directory: repositoryRoot,
      async fn() {
        await Config.setPermissionMode(Config.GLOBAL_CONFIG_ID, "default")
        const session = await Session.createSession({
          directory: Instance.directory,
          projectID: Instance.project.id,
        })
        const assistant: Message.Assistant = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          created: Date.now(),
          parentID: "",
          modelID: "test-model",
          providerID: "test-provider",
          agent: "default",
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        }
        Session.DataBaseCreate("messages", assistant)
        const turn = Orchestrator.startTurn({ sessionID: session.id })
        const scope = {
          kind: "browser-origin" as const,
          sessionID: session.id,
          extensionInstanceID: "extension-profile-a",
          origin: "https://example.com",
          browserID: "browser-profile-a",
        }
        const request = (
          toolCallID: string,
          overrides: Partial<Permission.InProcessPermissionInput> = {},
        ) => Permission.requestInProcessPermission({
          context: {
            sessionID: session.id,
            turnID: turn.turnID,
            messageID: assistant.id,
            toolCallID,
          },
          scope,
          method: "page.click",
          tabID: 42,
          tabTitle: "Example",
          risk: "medium",
          action: "ask",
          ...overrides,
        })

        try {
          const firstResult = request("browser_first")
          const first = await waitForPendingBrowserPermission(
            session.id,
            "browser_first",
          )
          expect(first.prompt?.allowedDecisions).toEqual([
            "deny",
            "allow-once",
            "allow-session",
          ])
          await Permission.resolveRequest(first.id, {
            decision: "allow-session",
          })
          await expect(firstResult).resolves.toMatchObject({
            decision: "allow-session",
            grantID: first.grantID,
          })

          const duplicate = await Permission.resolveRequest(first.id, {
            decision: "deny",
          })
          expect(duplicate.request.resolution?.decision).toBe("allow-session")

          await expect(request("browser_reused")).resolves.toMatchObject({
            decision: "allow-session",
            grantID: first.grantID,
          })

          const sensitiveResult = request("browser_sensitive", {
            method: "locator.fill",
            sensitive: true,
            risk: "high",
          })
          const sensitive = await waitForPendingBrowserPermission(
            session.id,
            "browser_sensitive",
          )
          expect(sensitive.prompt?.allowedDecisions).toEqual([
            "deny",
            "allow-once",
          ])
          await expect(Permission.resolveRequest(sensitive.id, {
            decision: "allow-session",
          })).rejects.toThrow("is not allowed")
          await Permission.resolveRequest(sensitive.id, {
            decision: "allow-once",
          })
          await expect(sensitiveResult).resolves.toMatchObject({
            decision: "allow-once",
          })

          const otherOriginResult = request("browser_other_origin", {
            scope: {
              ...scope,
              origin: "https://other.example",
            },
          })
          const otherOrigin = await waitForPendingBrowserPermission(
            session.id,
            "browser_other_origin",
          )
          await Permission.resolveRequest(otherOrigin.id, {
            decision: "deny",
          })
          await expect(otherOriginResult).resolves.toMatchObject({
            decision: "deny",
          })

          const cancelledResult = request("browser_cancelled", {
            scope: {
              ...scope,
              origin: "https://cancel.example",
            },
          })
          const cancelled = await waitForPendingBrowserPermission(
            session.id,
            "browser_cancelled",
          )
          await Permission.clearInProcessPermissionSession(session.id)
          await expect(cancelledResult).resolves.toMatchObject({
            decision: "deny",
          })
          expect((await Permission.getRequest(cancelled.id))?.status).toBe(
            "denied",
          )

          const timeoutResult = request("browser_timeout", {
            scope: {
              ...scope,
              origin: "https://timeout.example",
            },
            timeoutMs: 1_000,
          })
          const timedOut = await waitForPendingBrowserPermission(
            session.id,
            "browser_timeout",
          )
          await expect(Promise.race([
            timeoutResult,
            Bun.sleep(2_500).then(() => {
              throw new Error("Browser permission timeout did not settle.")
            }),
          ])).resolves.toMatchObject({
            decision: "deny",
          })
          expect((await Permission.getRequest(timedOut.id))?.status).toBe(
            "expired",
          )

          const audits = db.findManyWithSchema(
            "permission_audits",
            Permission.Audit,
            {
              where: [{ column: "sessionID", value: session.id }],
            },
          )
          expect(audits.some((audit) => audit.action === "ask")).toBe(true)
          expect(audits.some((audit) => audit.action === "allow")).toBe(true)
          expect(audits.some((audit) => audit.action === "deny")).toBe(true)
          expect(JSON.stringify(audits)).not.toContain("fill text")
        } finally {
          await Permission.clearInProcessPermissionSession(session.id)
          Orchestrator.finishTurn(turn)
        }
      },
    })
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
}, 120000)

test("plugin actions always require a one-time decision", async () => {
  const repositoryRoot = await mkdtemp(
    path.join(tmpdir(), "anybox-permission-plugin-action-"),
  )
  try {
    await createGitRepo(repositoryRoot, "plugin-action-permission")
    await Instance.provide({
      directory: repositoryRoot,
      async fn() {
        await Config.setPermissionMode(Config.GLOBAL_CONFIG_ID, "full_access")
        const session = await Session.createSession({
          directory: Instance.directory,
          projectID: Instance.project.id,
        })
        const assistant: Message.Assistant = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          created: Date.now(),
          parentID: "",
          modelID: "test-model",
          providerID: "test-provider",
          agent: "default",
          path: { cwd: Instance.directory, root: Instance.worktree },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        }
        Session.DataBaseCreate("messages", assistant)
        const turn = Orchestrator.startTurn({ sessionID: session.id })
        const request = (toolCallID: string) =>
          Permission.requestInProcessPermission({
            context: {
              sessionID: session.id,
              turnID: turn.turnID,
              messageID: assistant.id,
              toolCallID,
            },
            scope: {
              kind: "plugin-action",
              sessionID: session.id,
              pluginID: "desktop-automation",
              pluginDisplayName: "Desktop Automation",
              actionTitle: "Click",
              actionSummary: "Click the selected control.",
              actionBody: "Action: click\nArguments: {\"text\":\"<redacted>\"}",
            },
            method: "click",
            risk: "medium",
            action: "ask",
          })
        try {
          const firstResult = request("plugin_capability_first")
          const first = await waitForPendingBrowserPermission(
            session.id,
            "plugin_capability_first",
          )
          expect(first.scope).toMatchObject({
            kind: "plugin-action",
            pluginID: "desktop-automation",
            actionTitle: "Click",
          })
          expect(first.prompt).toMatchObject({
            title: "Desktop Automation: Click",
            summary: "Click the selected control.",
            allowedDecisions: ["deny", "allow-once"],
            details: {
              body: expect.stringContaining("<redacted>"),
            },
          })
          await Permission.resolveRequest(first.id, { decision: "allow-once" })
          await expect(firstResult).resolves.toMatchObject({ decision: "allow-once" })

          const secondResult = request("plugin_capability_second")
          const second = await waitForPendingBrowserPermission(
            session.id,
            "plugin_capability_second",
          )
          expect(second.id).not.toBe(first.id)
          await Permission.resolveRequest(second.id, { decision: "deny" })
          await expect(secondResult).resolves.toMatchObject({ decision: "deny" })
        } finally {
          await Permission.clearInProcessPermissionSession(session.id)
          Orchestrator.finishTurn(turn)
          await Config.setPermissionMode(Config.GLOBAL_CONFIG_ID, "default")
        }
      },
    })
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
}, 120000)

test("in-process plugin approval resolves outside the project instance context", async () => {
  const repositoryRoot = await mkdtemp(
    path.join(tmpdir(), "anybox-permission-plugin-resolution-"),
  )

  try {
    await createGitRepo(repositoryRoot, "plugin-action-resolution")
    const setup = await Instance.provide({
      directory: repositoryRoot,
      async fn() {
        const session = await Session.createSession({
          directory: Instance.directory,
          projectID: Instance.project.id,
        })
        const assistant: Message.Assistant = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          created: Date.now(),
          parentID: "",
          modelID: "test-model",
          providerID: "test-provider",
          agent: "default",
          path: { cwd: Instance.directory, root: Instance.worktree },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        }
        Session.DataBaseCreate("messages", assistant)
        const turn = Orchestrator.startTurn({ sessionID: session.id })

        try {
          const pendingResult = Permission.requestInProcessPermission({
            context: {
              sessionID: session.id,
              turnID: turn.turnID,
              messageID: assistant.id,
              toolCallID: "plugin_resolution_outside_instance",
            },
            scope: {
              kind: "plugin-action",
              sessionID: session.id,
              pluginID: "desktop-automation",
              pluginDisplayName: "Desktop Automation",
              actionTitle: "Observe application window",
              actionSummary: "Capture the selected application window.",
            },
            method: "get_window_state",
            risk: "high",
            action: "ask",
          })
          const request = await waitForPendingBrowserPermission(
            session.id,
            "plugin_resolution_outside_instance",
          )
          return { session, turn, pendingResult, request }
        } catch (error) {
          await Permission.clearInProcessPermissionSession(session.id)
          Orchestrator.finishTurn(turn)
          throw error
        }
      },
    })

    try {
      const resolved = await Permission.resolveRequest(setup.request.id, {
        decision: "allow-once",
      })
      expect(resolved.request.status).toBe("approved")
      await expect(Promise.race([
        setup.pendingResult,
        Bun.sleep(2_500).then(() => {
          throw new Error("Approved in-process permission did not settle.")
        }),
      ])).resolves.toMatchObject({
        decision: "allow-once",
        grantID: setup.request.grantID,
      })

      const audits = db.findManyWithSchema(
        "permission_audits",
        Permission.Audit,
        {
          where: [{ column: "sessionID", value: setup.session.id }],
        },
      )
      expect(audits).toContainEqual(expect.objectContaining({
        action: "allow",
        projectID: setup.session.projectID,
        toolCallID: "plugin_resolution_outside_instance",
      }))
    } finally {
      await Permission.clearInProcessPermissionSession(setup.session.id)
      Orchestrator.finishTurn(setup.turn)
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
}, 120000)

test("permission defaults auto-run safe reads and writes while honoring tool deny intents", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-permission-defaults-"))

  try {
    await createGitRepo(repositoryRoot, "permission-defaults")

    await Instance.provide({
      directory: repositoryRoot,
      async fn() {
        const sessionID = Identifier.ascending("session")
        const messageID = Identifier.ascending("message")

        const readDecision = await Permission.evaluate({
          sessionID,
          messageID,
          projectID: Instance.project.id,
          agent: "plan",
          cwd: Instance.directory,
          worktree: Instance.worktree,
          tool: {
            id: "read_file",
            kind: "read",
            readOnly: true,
            destructive: false,
            needsShell: false,
          },
          input: {
            path: "README.md",
          },
        })

        const writeDecision = await Permission.evaluate({
          sessionID,
          messageID,
          projectID: Instance.project.id,
          agent: "plan",
          cwd: Instance.directory,
          worktree: Instance.worktree,
          tool: {
            id: "replace_text",
            kind: "write",
            readOnly: false,
            destructive: false,
            needsShell: false,
          },
          input: {
            file_path: "README.md",
            old_string: "# permission-defaults",
            new_string: "# changed",
          },
        })

        const execDecision = await Permission.evaluate({
          sessionID,
          messageID,
          projectID: Instance.project.id,
          agent: "plan",
          cwd: Instance.directory,
          worktree: Instance.worktree,
          tool: {
            id: "git_bash_command",
            kind: "exec",
            readOnly: false,
            destructive: true,
            needsShell: true,
          },
          input: {
            command: "rm -rf /",
          },
          intent: {
            action: "deny",
            risk: "critical",
            reason: "Command matches a critical-risk shell pattern.",
            resource: {
              command: "rm -rf /",
              workdir: ".",
              paths: ["."],
            },
          },
        })

        expect(readDecision.action).toBe("allow")
        expect(writeDecision.action).toBe("allow")
        expect(writeDecision.derived.paths).toContain("README.md")
        expect(execDecision.action).toBe("deny")
      },
    })
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
}, 120000)

test("permission asks for outside writes by default and allows them in full access mode", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-permission-read-outside-"))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), "anybox-permission-read-outside-target-"))

  try {
    await createGitRepo(repositoryRoot, "permission-read-outside")

    await Instance.provide({
      directory: repositoryRoot,
      async fn() {
        const outsideFile = path.join(outsideRoot, "outside.txt")
        const base = {
          sessionID: Identifier.ascending("session"),
          messageID: Identifier.ascending("message"),
          projectID: Instance.project.id,
          agent: "default",
          cwd: Instance.directory,
          worktree: Instance.worktree,
          input: {
            file_path: outsideFile,
          },
        }

        const readDecision = await Permission.evaluate({
          ...base,
          tool: {
            id: "read_file",
            kind: "read",
            readOnly: true,
            destructive: false,
            needsShell: false,
          },
        })
        const writeDecision = await Permission.evaluate({
          ...base,
          tool: {
            id: "replace_text",
            kind: "write",
            readOnly: false,
            destructive: false,
            needsShell: false,
          },
        })

        expect(readDecision.action).toBe("allow")
        expect(writeDecision.action).toBe("ask")
        expect(writeDecision.risk).toBe("high")
        expect(writeDecision.filesystemAuthorization).toEqual({
          allowOutsideWorkspace: false,
          paths: [outsideFile],
        })
        expect(readDecision.derived.paths).toContain(outsideFile.replaceAll("\\", "/"))

        await Config.setPermissionMode(Config.GLOBAL_CONFIG_ID, "full_access")
        const fullAccessDecision = await Permission.evaluate({
          ...base,
          toolCallID: "toolcall_write_outside_full_access",
          tool: {
            id: "replace_text",
            kind: "write",
            readOnly: false,
            destructive: false,
            needsShell: false,
          },
        })

        expect(fullAccessDecision.action).toBe("allow")
        expect(fullAccessDecision.risk).toBe("high")
        expect(fullAccessDecision.filesystemAuthorization).toEqual({
          allowOutsideWorkspace: false,
          paths: [outsideFile],
        })
        expect(resolveToolPath(outsideFile)).toBe(outsideFile)
        expect(runWithFilesystemAuthorization(
          fullAccessDecision.filesystemAuthorization!,
          () => resolveToolPath(outsideFile),
        )).toBe(outsideFile)
        expect(() => runWithFilesystemAuthorization(
          fullAccessDecision.filesystemAuthorization!,
          () => resolveToolPath(path.join(outsideRoot, "not-approved.txt")),
        )).toThrow("does not match the frozen filesystem authorization")
        await Config.setPermissionMode(Config.GLOBAL_CONFIG_ID, "default")

        const patchTarget = path.join(outsideRoot, "created-by-patch.txt")
        const patchDecision = await Permission.evaluate({
          ...base,
          toolCallID: "toolcall_patch_outside",
          input: {
            patch: `*** Begin Patch\n*** Add File: ${patchTarget}\n+created\n*** End Patch`,
          },
          tool: {
            id: "apply_patch",
            kind: "write",
            readOnly: false,
            destructive: false,
            needsShell: false,
          },
        })
        expect(patchDecision.action).toBe("ask")
        expect(patchDecision.filesystemAuthorization?.paths).toEqual([patchTarget])

        const sensitiveDecision = await Permission.evaluate({
          ...base,
          toolCallID: "toolcall_sensitive_outside",
          input: {
            file_path: path.join(outsideRoot, ".env"),
          },
          tool: {
            id: "replace_text",
            kind: "write",
            readOnly: false,
            destructive: false,
            needsShell: false,
          },
        })
        expect(sensitiveDecision).toMatchObject({
          action: "deny",
          risk: "critical",
        })

        const linkedDirectory = path.join(repositoryRoot, "outside-link")
        await symlink(outsideRoot, linkedDirectory, process.platform === "win32" ? "junction" : "dir")
        const linkedWriteDecision = await Permission.evaluate({
          ...base,
          toolCallID: "toolcall_symlinked_write_outside",
          input: {
            file_path: path.join(linkedDirectory, "linked-output.txt"),
          },
          tool: {
            id: "replace_text",
            kind: "write",
            readOnly: false,
            destructive: false,
            needsShell: false,
          },
        })
        expect(linkedWriteDecision.action).toBe("ask")
        expect(linkedWriteDecision.filesystemAuthorization?.paths).toEqual([
          path.join(outsideRoot, "linked-output.txt"),
        ])
      },
    })
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
}, 120000)

test("permission rejects forged write tools for detached branch turns", async () => {
  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const session = await Session.createSession({
        directory: Instance.directory,
        projectID: Instance.project.id,
        title: "Detached branch permission test",
      })

      try {
        const turn = Session.createTurn({
          sessionID: session.id,
          projectID: Instance.project.id,
          executionID: "branch-permission-execution",
          threadTargetKind: "detached-branch",
          initialParentMessageID: null,
        })
        const decision = await Permission.evaluate({
          sessionID: session.id,
          turnID: turn.id,
          messageID: Identifier.ascending("message"),
          projectID: Instance.project.id,
          agent: "default",
          cwd: Instance.directory,
          worktree: Instance.worktree,
          tool: {
            id: "apply_patch",
            kind: "write",
            readOnly: false,
            destructive: false,
            needsShell: false,
          },
          input: {
            patch: "*** Begin Patch\n*** End Patch",
          },
        })

        expect(decision.action).toBe("deny")
        expect(decision.reason).toContain("Branch Chat is read-only")
      } finally {
        Session.removeSession(session.id)
      }
    },
  })
})

test("permission defaults allow workflow, interaction, delegation, exec, and other tools explicitly", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-permission-tool-kinds-"))

  try {
    await createGitRepo(repositoryRoot, "permission-tool-kinds")

    await Instance.provide({
      directory: repositoryRoot,
      async fn() {
        const baseInput = {
          sessionID: Identifier.ascending("session"),
          messageID: Identifier.ascending("message"),
          projectID: Instance.project.id,
          agent: "default",
          cwd: Instance.directory,
          worktree: Instance.worktree,
          input: {},
        }

        await expect(Permission.evaluate({
          ...baseInput,
          tool: {
            id: "ask_user_question",
            kind: "interaction",
            readOnly: true,
            destructive: false,
            needsShell: false,
          },
        })).resolves.toMatchObject({
          action: "allow",
          risk: "low",
        })

        await expect(Permission.evaluate({
          ...baseInput,
          tool: {
            id: "workflow_probe",
            kind: "workflow",
            readOnly: false,
            destructive: false,
            needsShell: false,
          },
        })).resolves.toMatchObject({
          action: "allow",
          risk: "low",
        })

        await expect(Permission.evaluate({
          ...baseInput,
          tool: {
            id: "spawn_subagent",
            kind: "delegation",
            readOnly: false,
            destructive: false,
            needsShell: false,
          },
        })).resolves.toMatchObject({
          action: "allow",
          risk: "medium",
        })

        await expect(Permission.evaluate({
          ...baseInput,
          tool: {
            id: "git_bash_command",
            kind: "exec",
            readOnly: false,
            destructive: true,
            needsShell: true,
          },
        })).resolves.toMatchObject({
          action: "allow",
          risk: "high",
        })

        await expect(Permission.evaluate({
          ...baseInput,
          tool: {
            id: "custom_unknown_tool",
            kind: "other",
            readOnly: false,
            destructive: false,
            needsShell: false,
          },
        })).resolves.toMatchObject({
          action: "allow",
          risk: "low",
        })
      },
    })
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
}, 120000)

test("permission evaluates tool intents before falling back to tool kind defaults", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-permission-intents-"))

  try {
    await createGitRepo(repositoryRoot, "permission-intents")

    await Instance.provide({
      directory: repositoryRoot,
      async fn() {
        await Config.setPermissionMode(Config.GLOBAL_CONFIG_ID, "default")
        const baseInput = {
          sessionID: Identifier.ascending("session"),
          messageID: Identifier.ascending("message"),
          projectID: Instance.project.id,
          agent: "plan",
          cwd: Instance.directory,
          worktree: Instance.worktree,
          tool: {
            id: "intent-tool",
            kind: "other" as const,
            readOnly: false,
            destructive: false,
            needsShell: false,
          },
          input: {},
        }

        await expect(Permission.evaluate({
          ...baseInput,
          toolCallID: "toolcall_intent_allow",
          intent: {
            action: "allow",
            risk: "low",
            reason: "Tool assessed this call as safe.",
          },
        })).resolves.toMatchObject({
          action: "allow",
          reason: "Tool assessed this call as safe.",
        })

        await expect(Permission.evaluate({
          ...baseInput,
          toolCallID: "toolcall_intent_ask",
          intent: {
            action: "ask",
            risk: "medium",
            reason: "Tool requires user confirmation.",
          },
        })).resolves.toMatchObject({
          action: "ask",
          reason: "Tool requires approval before it can continue. Original approval rationale: Tool requires user confirmation.",
        })

        await Config.setPermissionMode(Config.GLOBAL_CONFIG_ID, "full_access")
        await expect(Permission.evaluate({
          ...baseInput,
          toolCallID: "toolcall_intent_ask_full_access",
          intent: {
            action: "ask",
            risk: "medium",
            reason: "Tool requires user confirmation.",
          },
        })).resolves.toMatchObject({
          action: "allow",
          reason: "Full access mode approved this approval-required tool call. Original approval rationale: Tool requires user confirmation.",
        })

        await expect(Permission.evaluate({
          ...baseInput,
          toolCallID: "toolcall_intent_deny",
          intent: {
            action: "deny",
            risk: "critical",
            reason: "Tool blocked this operation.",
          },
        })).resolves.toMatchObject({
          action: "deny",
          reason: "Tool blocked this operation.",
          risk: "critical",
        })

        await expect(Permission.evaluate({
          ...baseInput,
          toolCallID: "toolcall_intent_ask_critical",
          intent: {
            action: "ask",
            risk: "critical",
            reason: "Critical request still needs approval.",
          },
        })).resolves.toMatchObject({
          action: "deny",
          risk: "critical",
          reason: "Critical-risk tool calls are blocked by the automatic safe-run policy.",
        })
      },
    })
  } finally {
    await Config.setPermissionMode(Config.GLOBAL_CONFIG_ID, "default")
    await rm(repositoryRoot, { recursive: true, force: true })
  }
}, 120000)

test("permission approval can complete a waiting read_file tool call without resuming the LLM loop", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-permission-approve-"))

  try {
    await createGitRepo(repositoryRoot, "permission-approve")

    const request = await Instance.provide({
      directory: repositoryRoot,
      async fn() {
        const session = await Session.createSession({
          directory: Instance.directory,
          projectID: Instance.project.id,
        })

        const assistant: Message.Assistant = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          created: Date.now(),
          parentID: "",
          modelID: "test-model",
          providerID: "test-provider",
          agent: "plan",
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        }

        Session.DataBaseCreate("messages", assistant)

        const toolPart = Message.ToolPart.parse({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: assistant.id,
          type: "tool",
          callID: "toolcall_readme",
          tool: "read_file",
          state: {
            status: "waiting-approval",
            approvalID: "approval_readme",
            input: {
              path: "README.md",
            },
            title: "Read File",
            time: {
              start: Date.now(),
            },
          },
        })

        await Session.updatePart(toolPart)
        return await Permission.registerApprovalRequest({
          assistant,
          toolPart,
        })
      },
    })

    const observedEvents: RuntimeEvent.RuntimeEvent[] = []
    const unsubscribe = EventStore.subscribe((event) => {
      if (event.sessionID === request.sessionID) {
        observedEvents.push(structuredClone(event))
      }
    })

    const resolved = await (async () => {
      try {
        return await Permission.resolveRequest(request.id, {
          decision: "allow",
        })
      } finally {
        unsubscribe()
      }
    })()

    expect(resolved.request.status).toBe("approved")

    const eventTypes = observedEvents.map((event) => event.type)
    const resolvedIndex = eventTypes.indexOf("permission.resolved")
    const approvedIndex = eventTypes.indexOf("tool.call.approved")
    const startedIndex = eventTypes.indexOf("tool.call.started")
    const completedIndex = eventTypes.indexOf("tool.call.completed")
    expect(resolvedIndex).toBeGreaterThanOrEqual(0)
    expect(approvedIndex).toBeGreaterThan(resolvedIndex)
    expect(startedIndex).toBeGreaterThan(approvedIndex)
    expect(completedIndex).toBeGreaterThan(startedIndex)

    const startedEvent = observedEvents[startedIndex]
    expect(startedEvent?.type).toBe("tool.call.started")
    if (startedEvent?.type === "tool.call.started") {
      expect(startedEvent.payload.part.callID).toBe(request.toolCallID)
      expect(startedEvent.payload.part.state.status).toBe("running")
      expect(startedEvent.payload.part.state.input).toEqual({
        path: "README.md",
      })
    }

    const restoredSession = Session.DataBaseRead("sessions", request.sessionID)
    expect(restoredSession).not.toBeNull()

    const toolParts = db.findManyWithSchema("parts", Message.Part, {
      where: [{ column: "messageID", value: request.messageID }],
    })

    const updatedTool = toolParts.find(
      (part): part is Message.ToolPart => part.type === "tool" && part.callID === request.toolCallID,
    )

    expect(updatedTool?.state.status).toBe("completed")
    if (updatedTool?.state.status === "completed") {
      expect(updatedTool.state.output).toContain("README.md")
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
}, 120000)

test("permission approval emits tool running before a failed approved tool call", async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-permission-approve-failed-"))

  try {
    await createGitRepo(repositoryRoot, "permission-approve-failed")

    const request = await Instance.provide({
      directory: repositoryRoot,
      async fn() {
        const session = await Session.createSession({
          directory: Instance.directory,
          projectID: Instance.project.id,
        })

        const assistant: Message.Assistant = {
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "assistant",
          created: Date.now(),
          parentID: "",
          modelID: "test-model",
          providerID: "test-provider",
          agent: "plan",
          path: {
            cwd: Instance.directory,
            root: Instance.worktree,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
        }

        Session.DataBaseCreate("messages", assistant)

        const toolPart = Message.ToolPart.parse({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: assistant.id,
          type: "tool",
          callID: "toolcall_missing_readme",
          tool: "read_file",
          state: {
            status: "waiting-approval",
            approvalID: "approval_missing_readme",
            input: {
              path: "MISSING.md",
            },
            title: "Read File",
            time: {
              start: Date.now(),
            },
          },
        })

        await Session.updatePart(toolPart)
        return await Permission.registerApprovalRequest({
          assistant,
          toolPart,
        })
      },
    })

    const observedEvents: RuntimeEvent.RuntimeEvent[] = []
    const unsubscribe = EventStore.subscribe((event) => {
      if (event.sessionID === request.sessionID) {
        observedEvents.push(structuredClone(event))
      }
    })

    await (async () => {
      try {
        await Permission.resolveRequest(request.id, {
          decision: "allow",
        })
      } finally {
        unsubscribe()
      }
    })()

    const eventTypes = observedEvents.map((event) => event.type)
    const approvedIndex = eventTypes.indexOf("tool.call.approved")
    const startedIndex = eventTypes.indexOf("tool.call.started")
    const failedIndex = eventTypes.indexOf("tool.call.failed")
    expect(approvedIndex).toBeGreaterThanOrEqual(0)
    expect(startedIndex).toBeGreaterThan(approvedIndex)
    expect(failedIndex).toBeGreaterThan(startedIndex)

    const startedEvent = observedEvents[startedIndex]
    expect(startedEvent?.type).toBe("tool.call.started")
    if (startedEvent?.type === "tool.call.started") {
      expect(startedEvent.payload.part.callID).toBe(request.toolCallID)
      expect(startedEvent.payload.part.state.status).toBe("running")
      expect(startedEvent.payload.part.state.input).toEqual({
        path: "MISSING.md",
      })
    }

    const toolParts = db.findManyWithSchema("parts", Message.Part, {
      where: [{ column: "messageID", value: request.messageID }],
    })
    const updatedTool = toolParts.find(
      (part): part is Message.ToolPart => part.type === "tool" && part.callID === request.toolCallID,
    )
    expect(updatedTool?.state.status).toBe("error")
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
}, 120000)
