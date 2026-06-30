import { test, expect } from "bun:test"
import "./sqlite.cleanup.ts"
import { $ } from "bun"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Instance } from "#project/instance.ts"
import * as Identifier from "#id/id.ts"
import * as Config from "#config/config.ts"
import * as Permission from "#permission/permission.ts"
import * as Message from "#session/core/message.ts"
import * as Session from "#session/core/session.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import * as db from "#database/Sqlite.ts"

async function createGitRepo(root: string, seed: string) {
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, "README.md"), `# ${seed}\n`)
  await $`git init`.cwd(root).quiet()
  await $`git config user.email test@example.com`.cwd(root).quiet()
  await $`git config user.name anybox-test`.cwd(root).quiet()
  await $`git add README.md`.cwd(root).quiet()
  await $`git commit -m init`.cwd(root).quiet()
}

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

test("permission allows read-only tools to reference outside paths", async () => {
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
        expect(writeDecision.action).toBe("deny")
        expect(readDecision.derived.paths).toContain(outsideFile.replaceAll("\\", "/"))
      },
    })
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
    await rm(outsideRoot, { recursive: true, force: true })
  }
}, 120000)

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
            id: "enter_plan_mode",
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
