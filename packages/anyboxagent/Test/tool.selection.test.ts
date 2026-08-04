import { afterEach, describe, expect, it } from "bun:test"
import "./sqlite.cleanup.ts"
import z from "zod"
import * as Agent from "#agent/agent.ts"
import * as Config from "#config/config.ts"
import * as db from "#database/Sqlite.ts"
import { Instance } from "#project/instance.ts"
import { resolveTools } from "#session/core/resolve-tools.ts"
import * as Session from "#session/core/session.ts"
import { readOnlyToolsOnlyForSession } from "#tool/execution.ts"
import * as ToolRegistry from "#tool/registry.ts"
import * as Tool from "#tool/tool.ts"

async function resolveAgentToolNames(agentName: string) {
  const agent = await Agent.get(agentName)
  if (!agent) {
    throw new Error(`Expected built-in agent '${agentName}' to exist.`)
  }

  return Object.keys(
    await resolveTools({
      agent,
      sessionID: `ses_tool_selection_${agentName}`,
      messageID: `msg_tool_selection_${agentName}`,
      abort: new AbortController().signal,
    }),
  )
}

function activeOneTimeShellToolIDs() {
  return ToolRegistry.builtinShellToolsForPlatform(process.platform).map((tool) => tool.id)
}

describe("global built-in tool selection", () => {
  afterEach(async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {})
  })

  it("exposes only provider-safe tool names to the model", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const toolNames = await resolveAgentToolNames("default")
        expect(toolNames.every((name) => /^[a-z0-9_]+$/.test(name))).toBe(true)
        expect(toolNames).toContain("multi_tool_use_parallel")
        expect(toolNames).toContain("exec")
        expect(toolNames).not.toContain("multi_tool_use.parallel")
        expect(toolNames).not.toContain("read-file")
        expect(toolNames).not.toContain("AskUserQuestion")
      },
    })
  })

  it("keeps built-in tools available when the global selection is empty", async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {})

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const toolNames = await resolveAgentToolNames("default")
        const shellToolIDs = activeOneTimeShellToolIDs()
        expect(toolNames).toContain("read_file")
        expect(toolNames).toContain("multi_tool_use_parallel")
        expect(toolNames).toContain("exec")
        expect(toolNames.some((name) => name.startsWith("planner_"))).toBe(false)
        for (const shellToolID of shellToolIDs) {
          expect(toolNames).toContain(shellToolID)
        }
        if (process.platform === "darwin") {
          expect(toolNames).not.toContain("git_bash_command")
          expect(toolNames).not.toContain("powershell_command")
          expect(toolNames).not.toContain("cmd_command")
          expect(toolNames).not.toContain("wsl_bash_command")
        }
        expect(toolNames).not.toContain("exec_command")
        expect(toolNames).not.toContain("bash")
        expect(toolNames).not.toContain("exec-command")
        expect(await ToolRegistry.get("exec_command")).toBeUndefined()
        expect(await ToolRegistry.get("bash")).toBeUndefined()
        expect(await ToolRegistry.get("exec-command")).toBeUndefined()
      },
    })
  })

  it("keeps browser tools out of global built-in selection", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const toolNames = await resolveAgentToolNames("default")
        expect(toolNames.some((name) => name.startsWith("browser_"))).toBe(false)
        expect(await ToolRegistry.get("browser_status")).toBeUndefined()
      },
    })
  })

  it("filters a globally disabled built-in shell tool without legacy aliases", async () => {
    const selectedToolID = activeOneTimeShellToolIDs()[0] ?? "read_file"
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
      [selectedToolID]: false,
    })

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const toolNames = await resolveAgentToolNames("default")
        expect(toolNames).not.toContain(selectedToolID)
        for (const shellToolID of activeOneTimeShellToolIDs()) {
          if (shellToolID !== selectedToolID) {
            expect(toolNames).toContain(shellToolID)
          }
        }
        expect(toolNames).not.toContain("exec_command")
        expect(toolNames).not.toContain("bash")
        expect(toolNames).not.toContain("exec-command")
      },
    })
  })

  it("does not let explicit global true bypass the agent allowlist", async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
      "replace-text": true,
    })

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const toolNames = await resolveAgentToolNames("plan")
        expect(toolNames).toContain("read_file")
        expect(toolNames).toContain("multi_tool_use_parallel")
        expect(toolNames).toContain("exec")
        expect(toolNames).not.toContain("replace_text")
      },
    })
  })

  it("filters the built-in parallel tool through global selection", async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
      "multi_tool_use.parallel": false,
    })

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const defaultToolNames = await resolveAgentToolNames("default")
        const planToolNames = await resolveAgentToolNames("plan")
        expect(defaultToolNames).not.toContain("multi_tool_use_parallel")
        expect(planToolNames).not.toContain("multi_tool_use_parallel")
      },
    })
  })

  it("catalogs tool_search as a read-only search tool without activating it unconditionally", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const builtinTools = await ToolRegistry.builtinTools()
        const catalogTool = builtinTools.find((tool) => tool.id === "tool_search")
        expect(catalogTool).toMatchObject({
          id: "tool_search",
          title: "Tool Search",
          capabilities: {
            kind: "search",
            readOnly: true,
            destructive: false,
          },
        })

        const runtime = await catalogTool?.init()
        expect(runtime?.title).toBe("Tool Search")
        expect(runtime?.parameters.safeParse({ query: "email", limit: 8 }).success).toBe(true)
        expect(runtime?.parameters.safeParse({ query: "", limit: 33 }).success).toBe(false)
        await expect(runtime?.execute(
          { query: "email" },
          {} as Tool.Context,
        )).rejects.toThrow("must be bound to the current Turn tool plan")

        const toolNames = await resolveAgentToolNames("default")
        expect(toolNames).not.toContain("tool_search")
      },
    })
  })

  it("filters exec through global selection", async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
      exec: false,
    })

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const defaultToolNames = await resolveAgentToolNames("default")
        const planToolNames = await resolveAgentToolNames("plan")
        expect(defaultToolNames).not.toContain("exec")
        expect(planToolNames).not.toContain("exec")
      },
    })
  })

  it("keeps generic session read-only policy independent from agent identity", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const session = await Session.createSession({
          directory: process.cwd(),
          projectID: Instance.project.id,
          title: "Read-only policy test",
        })

        try {
          const current = Session.DataBaseRead("sessions", session.id) as Session.SessionInfo
          db.updateByIdWithSchema("sessions", session.id, {
            ...current,
            policy: {
              toolPolicy: "read-only",
            },
          }, Session.SessionInfo)
          expect(
            (Session.DataBaseRead("sessions", session.id) as Session.SessionInfo).policy?.toolPolicy,
          ).toBe("read-only")
          const agent = await Agent.get("default")
          if (!agent) throw new Error("Expected default agent to exist.")
          expect(readOnlyToolsOnlyForSession(agent, session.id)).toBe(true)

          const toolNames = Object.keys(await resolveTools({
            agent,
            sessionID: session.id,
            messageID: "msg_read_only_policy",
            abort: new AbortController().signal,
          }))

          expect(toolNames).toContain("read_file")
          expect(toolNames).toContain("exec")
          expect(toolNames).not.toContain("apply_patch")

          const plannerToolNames = Object.keys(await resolveTools({
            agent,
            sessionID: session.id,
            messageID: "msg_read_only_planner_module",
            abort: new AbortController().signal,
            turnToolModuleIDs: ["planner.core"],
          }))
          expect(plannerToolNames).toEqual(expect.arrayContaining([
            "planner_list_todos",
            "planner_get_todo",
            "planner_find_free_time",
          ]))
          expect(plannerToolNames).not.toContain("planner_create_todo")
          expect(plannerToolNames).not.toContain("planner_update_todo")
          expect(plannerToolNames).not.toContain("planner_complete_todo")
          expect(plannerToolNames).not.toContain("planner_schedule_todo")

          const agentPolicyToolNames = Object.keys(await resolveTools({
            agent: {
              ...agent,
              name: "read-only-test",
              toolPolicy: "read-only",
            },
            sessionID: "ses_missing_read_only_agent_policy",
            messageID: "msg_read_only_agent_policy",
            abort: new AbortController().signal,
          }))
          expect(agentPolicyToolNames).toContain("read_file")
          expect(agentPolicyToolNames).toContain("exec")
          expect(agentPolicyToolNames).not.toContain("apply_patch")
        } finally {
          Session.removeSession(session.id)
        }
      },
    })
  })

  it("limits detached branch turns to explicitly read-only tools", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const session = await Session.createSession({
          directory: process.cwd(),
          projectID: Instance.project.id,
          title: "Detached branch policy test",
        })

        try {
          const turn = Session.createTurn({
            sessionID: session.id,
            projectID: Instance.project.id,
            executionID: "branch-execution",
            threadTargetKind: "detached-branch",
            initialParentMessageID: null,
          })
          const agent = await Agent.get("default")
          if (!agent) throw new Error("Expected default agent to exist.")

          expect(readOnlyToolsOnlyForSession(agent, session.id, turn.id)).toBe(true)

          const toolNames = Object.keys(await resolveTools({
            agent,
            sessionID: session.id,
            turnID: turn.id,
            messageID: "msg_detached_branch_policy",
            abort: new AbortController().signal,
          }))

          expect(toolNames).toContain("read_file")
          expect(toolNames).toContain("exec")
          expect(toolNames).not.toContain("apply_patch")
          expect(toolNames).not.toContain("replace_text")
        } finally {
          Session.removeSession(session.id)
        }
      },
    })
  })

  it("does not apply built-in selection records to custom tools", async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
      "custom-test-tool": false,
    })

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const registry = await ToolRegistry.state()
        registry.custom.push(
          Tool.define("custom-test-tool", async () => ({
            description: "Test-only custom tool.",
            parameters: z.object({}),
            execute: async () => "ok",
          })),
        )

        const toolNames = await resolveAgentToolNames("default")
        expect(toolNames).toContain("custom_test_tool")
      },
    })
  })
})
