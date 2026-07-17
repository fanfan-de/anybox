import { afterEach, describe, expect, it } from "bun:test"
import "./sqlite.cleanup.ts"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import * as Agent from "#agent/agent.ts"
import * as Config from "#config/config.ts"
import * as Identifier from "#id/id.ts"
import * as Permission from "#permission/permission.ts"
import { Instance } from "#project/instance.ts"
import { resolveTools } from "#session/core/resolve-tools.ts"
import { EXEC_CHILD_TOOL_IDS, ExecTool, type ExecResult } from "#tool/exec.ts"
import { ReadFileTool } from "#tool/read-file.ts"

async function resolvedExecTool(input: {
  agent?: Agent.AgentInfo
  agentName?: string
  sessionID?: string
  abort?: AbortSignal
}) {
  const agentName = input.agentName ?? "default"
  const agent = input.agent ?? await Agent.get(agentName)
  if (!agent) throw new Error(`Expected agent "${agentName}" to exist.`)

  const tools = await resolveTools({
    agent,
    sessionID: input.sessionID ?? `ses_exec_${Identifier.ascending("message")}`,
    messageID: Identifier.ascending("message"),
    abort: input.abort ?? new AbortController().signal,
  })
  const exec = tools.exec as any
  if (!exec) throw new Error(`Expected exec to be available for agent "${agentName}".`)
  return exec
}

async function runExec(code: string, toolCallID: string) {
  const exec = await resolvedExecTool({})
  return await exec.execute(
    { code },
    {
      toolCallId: toolCallID,
      messages: [],
    },
  ) as { data: ExecResult; metadata: ExecResult; text: string }
}

describe("exec tool", () => {
  afterEach(async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {})
  })

  it("is a read-only workflow tool with the fixed child allowlist", () => {
    expect(ExecTool.capabilities).toEqual({
      kind: "workflow",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    })
    expect(EXEC_CHILD_TOOL_IDS).toEqual([
      "read_file",
      "list_directory",
      "glob",
      "grep",
    ])
  })

  it("orchestrates glob, concurrent reads, directory listing, and grep", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-exec-orchestration-"))

    try {
      await mkdir(path.join(root, "src"), { recursive: true })
      await writeFile(path.join(root, "src", "one.ts"), "export const one = 'needle-one'\n")
      await writeFile(path.join(root, "src", "two.ts"), "export const two = 'needle-two'\n")

      await Instance.provide({
        directory: root,
        async fn() {
          const output = await runExec(
            `
const listing = await tools.glob({
  pattern: "**/*.ts",
  path: "src",
  maxResults: 20,
})
const files = await Promise.all(
  listing.matches.map((item) =>
    tools.read_file({
      file_path: item.path,
      maxLines: 20,
    })
  )
)
const directory = await tools.list_directory({ path: "src" })
const search = await tools.grep({
  pattern: "needle",
  path: "src",
  literal: true,
})
return {
  paths: listing.matches.map((item) => item.path),
  contents: files.map((file) => file.content),
  directory,
  hitCount: search.hits.length,
}
`,
            "tool-exec-orchestration",
          )

          expect(output.data).toBe(output.metadata)
          expect(output.data.result).toMatchObject({
            paths: [
              path.join("src", "one.ts"),
              path.join("src", "two.ts"),
            ],
            hitCount: 2,
          })
          expect((output.data.result as any).contents[0]).toContain("needle-one")
          expect((output.data.result as any).contents[1]).toContain("needle-two")
          expect((output.data.result as any).directory).toContain("one.ts")
          expect(output.data.toolCalls.map((call) => call.tool)).toEqual([
            "glob",
            "read_file",
            "read_file",
            "list_directory",
            "grep",
          ])
          expect(output.data.toolCalls.every((call) => call.status === "completed")).toBe(true)
          expect(output.data.durationMs).toBeGreaterThanOrEqual(0)
          expect(JSON.parse(output.text)).toEqual(output.data)
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("returns null without an explicit return value", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-exec-no-return-"))

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          const output = await runExec("const value = 1 + 1", "tool-exec-no-return")
          expect(output.data.result).toBeNull()
          expect(output.data.toolCalls).toEqual([])
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("returns the structured ExecResult as its model output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-exec-model-output-"))

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          const exec = await resolvedExecTool({})
          const output = await exec.execute(
            { code: `return { marker: "model-output" }` },
            {
              toolCallId: "tool-exec-model-output",
              messages: [],
            },
          )
          const modelOutput = await exec.toModelOutput({ output })

          expect(modelOutput).toEqual({
            type: "json",
            value: output.data,
          })
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("keeps caught child failures in the summary and exposes no extra host tools", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-exec-boundary-"))
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`)

    try {
      await writeFile(outside, "outside project\n")

      await Instance.provide({
        directory: root,
        async fn() {
          const output = await runExec(
            `
let error = ""
try {
  await tools.read_file({ file_path: ${JSON.stringify(outside)} })
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught)
}
return {
  error,
  toolNames: Object.keys(tools).sort(),
  hasExec: typeof tools.exec !== "undefined",
  hasShell: typeof tools.shell_command !== "undefined",
}
`,
            "tool-exec-boundary",
          )

          expect(output.data.result).toMatchObject({
            toolNames: [...EXEC_CHILD_TOOL_IDS].sort(),
            hasExec: false,
            hasShell: false,
          })
          expect((output.data.result as any).error).toContain("outside the active project boundary")
          expect(output.data.toolCalls).toEqual([
            expect.objectContaining({
              callID: "tool-exec-boundary:exec:1",
              tool: "read_file",
              status: "failed",
              error: expect.stringContaining("outside the active project boundary"),
            }),
          ])
        },
      })
    } finally {
      await rm(outside, { force: true })
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rechecks global child-tool selection for every nested call", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-exec-disabled-child-"))

    try {
      await writeFile(path.join(root, "notes.txt"), "needle\n")
      await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
        grep: false,
      })

      await Instance.provide({
        directory: root,
        async fn() {
          const output = await runExec(
            `
let error = ""
try {
  await tools.grep({ pattern: "needle", literal: true })
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught)
}
return { error }
`,
            "tool-exec-disabled-child",
          )

          expect((output.data.result as any).error).toContain(
            'Tool "grep" is disabled by the global tool selection.',
          )
          expect(output.data.toolCalls).toEqual([
            expect.objectContaining({
              tool: "grep",
              status: "failed",
              error: expect.stringContaining("disabled by the global tool selection"),
            }),
          ])
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rechecks the current agent policy for every nested call", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-exec-agent-policy-"))

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          const baseAgent = await Agent.get("default")
          if (!baseAgent) throw new Error("Expected the default agent to exist.")
          const agent: Agent.AgentInfo = {
            ...baseAgent,
            name: "exec-restricted-test",
            tools: {
              exec: true,
              read_file: true,
              list_directory: true,
              glob: true,
              grep: false,
            },
          }
          const exec = await resolvedExecTool({ agent })
          const output = await exec.execute(
            {
              code: `
let error = ""
try {
  await tools.grep({ pattern: "needle", literal: true })
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught)
}
return { error }
`,
            },
            {
              toolCallId: "tool-exec-agent-policy",
              messages: [],
            },
          )

          expect(output.data.result.error).toContain(
            'Tool "grep" is not enabled for agent "exec-restricted-test".',
          )
          expect(output.data.toolCalls).toEqual([
            expect.objectContaining({
              tool: "grep",
              status: "failed",
            }),
          ])
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects approval-required child calls without creating a permission request", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-exec-approval-"))
    const originalInit = ReadFileTool.init

    try {
      ReadFileTool.init = async (context) => {
        const runtime = await originalInit(context)
        return {
          ...runtime,
          assessPermission: async () => ({
            action: "ask",
            forceAsk: true,
            risk: "low",
            reason: "Exec approval test.",
          }),
        }
      }

      await Instance.provide({
        directory: root,
        async fn() {
          const sessionID = `ses_exec_approval_${Identifier.ascending("message")}`
          const exec = await resolvedExecTool({ sessionID })
          const output = await exec.execute(
            {
              code: `
let error = ""
try {
  await tools.read_file({ file_path: "missing.txt" })
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught)
}
return { error }
`,
            },
            {
              toolCallId: "tool-exec-approval",
              messages: [],
            },
          )

          expect(output.data.result.error).toContain(
            'Tool "read_file" requires approval and cannot run inside exec.',
          )
          expect(output.data.toolCalls).toEqual([
            expect.objectContaining({
              tool: "read_file",
              status: "failed",
            }),
          ])
          expect(await Permission.listRequests({ sessionID })).toEqual([])
        },
      })
    } finally {
      ReadFileTool.init = originalInit
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects read_file paths whose symlink target escapes the project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-exec-symlink-"))
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "anybox-exec-symlink-target-"))

    try {
      await writeFile(path.join(outsideRoot, "secret.txt"), "outside project\n")
      await symlink(
        outsideRoot,
        path.join(root, "linked"),
        process.platform === "win32" ? "junction" : "dir",
      )

      await Instance.provide({
        directory: root,
        async fn() {
          const output = await runExec(
            `
let error = ""
try {
  await tools.read_file({ file_path: "linked/secret.txt" })
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught)
}
return { error }
`,
            "tool-exec-symlink",
          )

          expect((output.data.result as any).error).toContain(
            "outside the active project boundary",
          )
          expect(output.data.toolCalls).toEqual([
            expect.objectContaining({
              tool: "read_file",
              status: "failed",
              error: expect.stringContaining("outside the active project boundary"),
            }),
          ])
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  })

  it("fails the outer call when a child error is not caught", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-exec-uncaught-"))

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          const exec = await resolvedExecTool({})
          await expect(
            exec.execute(
              {
                code: `await tools.read_file({ file_path: "missing.txt" })`,
              },
              {
                toolCallId: "tool-exec-uncaught",
                messages: [],
              },
            ),
          ).rejects.toThrow("0 child calls completed, 1 failed")
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("fails when guest code returns before awaiting or catching a dispatched child tool", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-exec-detached-"))

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          const exec = await resolvedExecTool({})

          await expect(
            exec.execute(
              {
                code: `
tools.list_directory({ path: "." });
return "done";
`,
              },
              {
                toolCallId: "tool-exec-detached",
                messages: [],
              },
            ),
          ).rejects.toThrow(
            "returned with 1 unconsumed tool call(s). Await or catch every tools call before returning",
          )
          await expect(
            exec.execute(
              {
                code: `
tools.list_directory({ path: "." });
return "done";
`,
              },
              {
                toolCallId: "tool-exec-detached-count",
                messages: [],
              },
            ),
          ).rejects.toThrow("0 child calls completed, 1 failed")
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("fails when a quickly rejected child call is left unconsumed", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-exec-unconsumed-failure-"))

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          const exec = await resolvedExecTool({})

          await expect(
            exec.execute(
              {
                code: `
tools.read_file({ file_path: "missing.txt" });
await tools.list_directory({ path: "." });
return "must-not-succeed";
`,
              },
              {
                toolCallId: "tool-exec-unconsumed-failure",
                messages: [],
              },
            ),
          ).rejects.toThrow(
            "returned with 1 unconsumed tool call(s). Await or catch every tools call before returning",
          )
          await expect(
            exec.execute(
              {
                code: `
tools.read_file({ file_path: "missing.txt" });
await tools.list_directory({ path: "." });
return "must-not-succeed";
`,
              },
              {
                toolCallId: "tool-exec-unconsumed-failure-counts",
                messages: [],
              },
            ),
          ).rejects.toThrow("1 child calls completed, 1 failed")
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("honors an already-aborted outer execution before dispatching a child tool", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-exec-aborted-"))

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          const controller = new AbortController()
          controller.abort(new Error("Exec integration cancellation."))
          const exec = await resolvedExecTool({ abort: controller.signal })

          await expect(
            exec.execute(
              {
                code: `return await tools.list_directory({ path: "." })`,
              },
              {
                toolCallId: "tool-exec-aborted",
                messages: [],
              },
            ),
          ).rejects.toThrow("Exec integration cancellation")
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
