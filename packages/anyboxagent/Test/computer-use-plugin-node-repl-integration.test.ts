import { afterEach, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { $ } from "bun"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import * as Config from "../src/config/config.ts"
import * as Identifier from "../src/id/id.ts"
import * as BuiltinMcp from "../src/mcp/builtin.ts"
import { McpManager } from "../src/mcp/manager.ts"
import * as Permission from "../src/permission/permission.ts"
import { Instance } from "../src/project/instance.ts"
import type * as Message from "../src/session/core/message.ts"
import * as Session from "../src/session/core/session.ts"
import * as Orchestrator from "../src/session/runtime/orchestrator.ts"
import * as Tool from "../src/tool/tool.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Instance.disposeAll()
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function waitForPluginActionPermission(sessionID: string, toolCallID: string) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const request = (await Permission.listRequests({
      sessionID,
      status: "pending",
    })).find((candidate) => candidate.toolCallID === toolCallID)
    if (request) return request
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for permission ${toolCallID}.`)
}

test.skipIf(process.platform !== "win32")(
  "runs the plugin-owned Computer Use runtime directly inside the generic Node REPL",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "anybox-computer-use-plugin-runtime-"))
    temporaryRoots.push(root)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, "README.md"), "# computer-use-plugin-runtime\n")
    await $`git init`.cwd(root).quiet()
    await $`git config user.email test@example.com`.cwd(root).quiet()
    await $`git config user.name anybox-test`.cwd(root).quiet()
    await $`git add README.md`.cwd(root).quiet()
    await $`git commit -m init`.cwd(root).quiet()

    await Config.removeMcpServer(Config.GLOBAL_CONFIG_ID, BuiltinMcp.NODE_REPL_SERVER_ID)
    await BuiltinMcp.syncBuiltinMcpRuntimeBindings()

    await Instance.provide({
      directory: root,
      async fn() {
        await Config.setSelectedMcpServerIDs(Instance.project.id, [
          BuiltinMcp.NODE_REPL_SERVER_ID,
        ])
        const manager = new McpManager(Instance.project.id)
        try {
          expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, "anybox.computer-use"))
            .toBeUndefined()
          const tools = await manager.tools()
          expect(tools.some((tool) => tool.source?.id === "anybox.computer-use")).toBe(false)
          const js = tools.find(
            (tool) => tool.source?.id === BuiltinMcp.NODE_REPL_SERVER_ID
              && tool.id.endsWith("__js"),
          )
          expect(js).toBeDefined()

          const pluginClientURL = pathToFileURL(resolve(
            import.meta.dir,
            "..",
            "..",
            "..",
            "plugins",
            "Anybox-Plugins",
            "computer-use-windows",
            "scripts",
            "computer-use-client.mjs",
          )).href
          const runtime = await js!.init()
          const output = Tool.normalizeToolOutput(await runtime.execute({
            code: `const { setupComputerUseRuntime } = await import(${JSON.stringify(pluginClientURL)})
              await setupComputerUseRuntime({ globals: globalThis })
              globalThis.computerUseWindows = await sky.list_windows()
              return {
                target: sky.target,
                windowCount: computerUseWindows.length,
                validWindows: computerUseWindows.every((window) =>
                  typeof window.id === "number"
                  && typeof window.app === "string"
                  && !("windowRef" in window)
                )
              }`,
          }, {
            sessionID: "session_computer_use_plugin",
            turnID: "turn_computer_use_plugin",
            messageID: "message_computer_use_plugin",
            toolCallID: "tool_computer_use_plugin",
            cwd: Instance.directory,
            worktree: Instance.worktree,
          }))
          expect(output.data).toMatchObject({
            structuredContent: {
              result: {
                target: "windows",
                validWindows: true,
              },
            },
            isError: false,
          })

          const blocked = Tool.normalizeToolOutput(await runtime.execute({
            code: `return await sky.activate_window({
              window: computerUseWindows[0],
              safety: "finance",
              purpose: "Attempt a financial action"
            })`,
          }, {
            sessionID: "session_computer_use_plugin",
            turnID: "turn_computer_use_plugin",
            messageID: "message_computer_use_plugin",
            toolCallID: "tool_computer_use_plugin_blocked",
            cwd: Instance.directory,
            worktree: Instance.worktree,
          }))
          expect(blocked.data).toMatchObject({
            structuredContent: { code: "CU_APP_BLOCKED" },
            isError: true,
          })

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
            const toolCallID = "tool_computer_use_plugin_prompt"
            const pendingAction = runtime.execute({
              code: `globalThis.computerUseWindows = await sky.list_windows()
                await sky.get_window_state({
                  window: computerUseWindows[0],
                  include_screenshot: false,
                  include_text: true
                })
                return await sky.type_text({
                  window: computerUseWindows[0],
                  safety: "submit_or_send",
                  purpose: "Send a fixture message",
                  text: "private integration fixture"
                })`,
            }, {
              sessionID: session.id,
              turnID: turn.turnID,
              messageID: assistant.id,
              toolCallID,
              cwd: Instance.directory,
              worktree: Instance.worktree,
            })
            const prompt = await waitForPluginActionPermission(session.id, toolCallID)
            expect(prompt).toMatchObject({
              tool: "plugin-action.computer-use-windows.type_text",
              scope: {
                kind: "plugin-action",
                pluginID: "computer-use-windows",
              },
              prompt: {
                allowedDecisions: ["deny", "allow-once"],
              },
            })
            expect(prompt.prompt?.details?.body).not.toContain("private integration fixture")
            expect(prompt.prompt?.details?.body).toContain("<redacted;")
            await Permission.resolveRequest(prompt.id, { decision: "deny" })
            const actionOutput = Tool.normalizeToolOutput(await pendingAction)
            expect(actionOutput.data).toMatchObject({
              structuredContent: { code: "PERMISSION_DENIED" },
              isError: true,
            })
          } finally {
            await Permission.clearInProcessPermissionSession(session.id)
            Orchestrator.finishTurn(turn)
          }
        } finally {
          await manager.dispose()
        }
      },
    })
  },
  120_000,
)
