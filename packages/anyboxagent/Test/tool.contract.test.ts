import { describe, expect, it } from "bun:test"
import "./sqlite.cleanup.ts"
import { $ } from "bun"
import { assistantModelMessageSchema, toolModelMessageSchema } from "ai"
import { EventEmitter } from "node:events"
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import z from "zod"
import {
  createPowerShell7Detector,
  POWERSHELL_7_INSTALL_MESSAGE,
  type PowerShell7Detector,
} from "@anybox/platform"
import * as Agent from "#agent/agent.ts"
import * as Identifier from "#id/id.ts"
import { Instance } from "#project/instance.ts"
import type * as Provider from "#provider/provider.ts"
import { getShellTaskRegistry } from "#shell/task-registry.ts"
import * as Message from "#session/core/message.ts"
import { resolveToolPlan, resolveTools } from "#session/core/resolve-tools.ts"
import * as ImageAssets from "#session/support/image-assets.ts"
import * as ToolResultPersistence from "#session/support/tool-result-persistence.ts"
import { AskUserQuestionTool, answerAskUserQuestion } from "#tool/ask-user-question.ts"
import {
  CmdCommandTool,
  GitBashCommandTool,
  MacOSShellCommandTool,
  PowerShellCommandTool,
  WslBashCommandTool,
  assessShellPermission,
  buildPowerShellArgs,
  createPowerShellCommandTool,
  resolveCmdExecutable,
  resolveGitBashExecutable,
  resolveMacOSShellExecutable,
  resolvePowerShellExecutable,
  resolveWslExecutable,
  waitForProcessExit,
} from "#tool/shell-command.ts"
import { GlobTool } from "#tool/glob.ts"
import { GrepTool } from "#tool/grep.ts"
import { ListDirectoryTool } from "#tool/list-directory.ts"
import { ReadFileTool } from "#tool/read-file.ts"
import { ReplaceTextTool } from "#tool/replace-text.ts"
import { SshShellCommandTool } from "#tool/ssh-shell-command.ts"
import * as Tool from "#tool/tool.ts"
import { createToolExecution } from "#tool/execution.ts"
import * as ToolRegistry from "#tool/registry.ts"
import { TOOL_SEARCH_ID, TOOL_SEARCH_MODEL_NAME } from "#tool/tool-search.ts"
import { WebFetchTool } from "#tool/web-fetch.ts"
import { ViewImageTool } from "#tool/view-image.ts"
import { WriteStdinTool } from "#tool/write-stdin.ts"
import {
  LoadWorkspaceDependenciesTool,
  WORKSPACE_NODE_PACKAGES,
  WORKSPACE_PYTHON_IMPORTS,
} from "#tool/workspace-dependencies.ts"
import { buildPtyEnvironment } from "#pty/runtime.ts"

async function createGitRepo(root: string, seed: string) {
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, "README.md"), `# ${seed}\n`)
  await $`git init`.cwd(root).quiet()
  await $`git config user.email test@example.com`.cwd(root).quiet()
  await $`git config user.name anybox-test`.cwd(root).quiet()
  await $`git add README.md`.cwd(root).quiet()
  await $`git commit -m init`.cwd(root).quiet()
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
)

function textOnlyTestModel(): Provider.Model {
  return {
    id: "text-test-model",
    providerID: "test-provider",
    api: {
      id: "text-test-model",
      url: "https://example.test/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Text Test Model",
    family: "test",
    capabilities: {
      temperature: true,
      reasoning: false,
      replayAssistantReasoning: true,
      attachment: false,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    },
    limit: { context: 128_000, output: 8_000 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
  }
}

function visionTestModel(): Provider.Model {
  const model = textOnlyTestModel()
  return {
    ...model,
    id: "vision-test-model",
    name: "Vision Test Model",
    capabilities: {
      ...model.capabilities,
      attachment: true,
      input: {
        ...model.capabilities.input,
        image: true,
      },
    },
  }
}

async function withProcessEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const backup = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(overrides)) {
    backup.set(key, process.env[key])
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return await fn()
  } finally {
    for (const [key, value] of backup.entries()) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

async function createWorkspaceDependenciesFixture(root: string) {
  const dependenciesRoot = path.join(root, "dependencies")
  const nodeModulesDir = path.join(dependenciesRoot, "node", "node_modules")
  const pythonRoot = path.join(dependenciesRoot, "python")
  const pythonSitePackages = path.join(pythonRoot, "Lib", "site-packages")
  const pythonExecutable = process.platform === "win32"
    ? path.join(pythonRoot, "python.exe")
    : path.join(pythonRoot, "bin", "python3")

  for (const packageName of WORKSPACE_NODE_PACKAGES) {
    const packageRoot = path.join(nodeModulesDir, packageName)
    await mkdir(packageRoot, { recursive: true })
    await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: packageName }))
  }

  await mkdir(pythonSitePackages, { recursive: true })
  await mkdir(path.dirname(pythonExecutable), { recursive: true })
  await writeFile(pythonExecutable, "")
  for (const importDirectory of Object.values(WORKSPACE_PYTHON_IMPORTS)) {
    await mkdir(path.join(pythonSitePackages, importDirectory), { recursive: true })
  }

  await writeFile(
    path.join(dependenciesRoot, "manifest.json"),
    JSON.stringify({
      kind: "anybox-workspace-dependencies",
      version: 1,
      bundleVersion: "fixture-manifest-version",
    }),
  )

  return dependenciesRoot
}

function platformShellToolID() {
  return ToolRegistry.builtinShellToolsForPlatform(process.platform)[0]?.id ?? null
}

describe("tool contract", () => {
  it("wraps validation, authorization, aliases, and structured output", async () => {
    const customTool = Tool.define(
      "primary-tool",
      async () => ({
        title: "Primary Tool",
        description: "Test-only tool.",
        parameters: z.object({
          value: z.string(),
        }),
        validate: ({ value }) => {
          if (value === "invalid") return "value is invalid"
        },
        authorize: ({ value }) => {
          if (value === "blocked") {
            return { message: "value is blocked" }
          }
        },
        execute: async ({ value }) => ({
          text: `echo:${value}`,
          title: "Executed",
          metadata: { scope: "test" },
          data: { value },
        }),
      }),
      {
        title: "Primary Tool",
        aliases: ["secondary-tool"],
        capabilities: {
          kind: "read",
          readOnly: true,
          destructive: false,
          concurrency: "safe",
        },
      },
    )

    expect(customTool.aliases).toEqual(["secondary-tool"])
    expect(customTool.capabilities).toEqual({
      kind: "read",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    })
    expect(Tool.toolMatchesName(customTool, "secondary-tool")).toBe(true)

    const runtime = await customTool.init()
    const output = await runtime.execute(
      { value: "ok" },
      {
        sessionID: "session-1",
        messageID: "message-1",
      },
    )

    expect(output).toEqual({
      text: "echo:ok",
      title: "Executed",
      metadata: { scope: "test" },
      data: { value: "ok" },
      attachments: undefined,
    })

    expect(Tool.normalizeToolOutput("plain-text")).toEqual({
      text: "plain-text",
    })

    expect(Tool.normalizeToolModelOutput("plain-text")).toEqual({
      type: "text",
      value: "plain-text",
    })

    let invalidArguments: unknown
    try {
      await runtime.execute(
        { value: 42 } as never,
        {
          sessionID: "session-invalid-arguments",
          messageID: "message-invalid-arguments",
        },
      )
    } catch (error) {
      invalidArguments = error
    }
    expect(Tool.findToolControlSignal(invalidArguments)).toMatchObject({
      outcome: {
        kind: "blocked",
        code: "TOOL_INPUT_VALIDATION_BLOCKED",
        execution: { sideEffect: "none", retry: "safe" },
      },
      control: { mode: "continue-model" },
    })

    await expect(
      runtime.execute(
        { value: "invalid" },
        {
          sessionID: "session-2",
          messageID: "message-2",
        },
      ),
    ).rejects.toThrow("value is invalid")

    await expect(
      runtime.execute(
        { value: "blocked" },
        {
          sessionID: "session-3",
          messageID: "message-3",
        },
      ),
    ).rejects.toThrow("value is blocked")
  })

  it("normalizes plain string tool results", async () => {
    const customTool = Tool.define(
      "string-tool",
      async () => ({
        description: "Test-only tool.",
        parameters: z.object({}),
        execute: () => "plain-result",
      }),
    )

    const runtime = await customTool.init()

    await expect(
      runtime.execute(
        {},
        {
          sessionID: "session-4",
          messageID: "message-4",
        },
      ),
    ).resolves.toEqual({
      text: "plain-result",
    })
  })

  it("runs eligible read/search child tools concurrently and preserves result order", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-parallel-tool-"))
    let active = 0
    let maxActive = 0

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          const registry = await ToolRegistry.state()
          const createDelayTool = (id: string) =>
            Tool.define(
              id,
              async () => ({
                description: "Test-only delayed read tool.",
                parameters: z.object({
                  value: z.string(),
                }),
                execute: async ({ value }) => {
                  active += 1
                  maxActive = Math.max(maxActive, active)
                  try {
                    await sleep(80)
                    return {
                      title: `Delay ${value}`,
                      text: `${id}:${value}`,
                    }
                  } finally {
                    active -= 1
                  }
                },
              }),
              {
                capabilities: {
                  kind: "read",
                  readOnly: true,
                  destructive: false,
                  concurrency: "safe",
                },
              },
            )

          registry.custom.push(createDelayTool("parallel-delay-a"))
          registry.custom.push(createDelayTool("parallel-delay-b"))

          const agent = await Agent.get("default")
          expect(agent).toBeDefined()
          const tools = await resolveTools({
            agent: agent!,
            sessionID: "ses_parallel_delay",
            messageID: Identifier.ascending("message"),
            abort: new AbortController().signal,
          })
          const parallel = tools["multi_tool_use_parallel"] as any
          const output = await parallel.execute({
            calls: [
              { tool: "parallel-delay-a", input: { value: "first" } },
              { tool: "parallel-delay-b", input: { value: "second" } },
            ],
          }, {
            toolCallId: "tool-parallel-delay",
            messages: [],
          })

          expect(maxActive).toBe(2)
          expect(output.data.results).toEqual([
            expect.objectContaining({
              index: 0,
              tool: "parallel-delay-a",
              phase: "settled",
              outcome: "returned",
              result: "success",
              completeness: "complete",
              output: "parallel-delay-a:first",
            }),
            expect.objectContaining({
              index: 1,
              tool: "parallel-delay-b",
              phase: "settled",
              outcome: "returned",
              result: "success",
              completeness: "complete",
              output: "parallel-delay-b:second",
            }),
          ])
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects ineligible, recursive, and unknown parallel child tools without executing them", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-parallel-tool-safety-"))

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          const agent = await Agent.get("default")
          expect(agent).toBeDefined()
          const tools = await resolveTools({
            agent: agent!,
            sessionID: "ses_parallel_safety",
            messageID: Identifier.ascending("message"),
            abort: new AbortController().signal,
          })
          const parallel = tools["multi_tool_use_parallel"] as any
          const shellToolID = platformShellToolID()
          const output = await parallel.execute({
            calls: [
              { tool: "replace_text", input: {} },
              ...(shellToolID ? [{ tool: shellToolID, input: {} }] : []),
              { tool: "generate_image", input: {} },
              { tool: "view_image", input: { path: "pixel.png" } },
              { tool: "ask_user_question", input: {} },
              { tool: "multi_tool_use_parallel", input: {} },
              { tool: "multi_tool_use.parallel", input: {} },
              { tool: "missing_parallel_child", input: {} },
            ],
          }, {
            toolCallId: "tool-parallel-safety",
            messages: [],
          })

          const results = output.data.results as Array<{ tool: string; outcome: string; error?: string }>
          expect(results.every((result) => result.outcome === "blocked")).toBe(true)
          expect(results.find((result) => result.tool === "replace_text")?.error).toContain("not eligible")
          if (shellToolID) {
            expect(results.find((result) => result.tool === shellToolID)?.error).toContain("not eligible")
          }
          expect(results.find((result) => result.tool === "generate_image")?.error).toContain("not eligible")
          expect(results.find((result) => result.tool === "view_image")?.error).toContain("must be called directly")
          expect(results.find((result) => result.tool === "ask_user_question")?.error).toContain("not eligible")
          expect(results.find((result) => result.tool === "multi_tool_use_parallel")?.error).toContain("cannot call itself")
          expect(results.find((result) => result.tool === "multi_tool_use.parallel")?.error).toContain("cannot call itself")
          expect(results.find((result) => result.tool === "missing_parallel_child")?.error).toContain("not available")
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("persists large child outputs before returning parallel model output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-parallel-tool-persist-"))
    const sessionID = "ses_parallel_persist"
    const large = `${"parallel-large-output ".repeat(5_000)}secret-tail`

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          const registry = await ToolRegistry.state()
          registry.custom.push(
            Tool.define(
              "parallel-large-tool",
              async () => ({
                description: "Test-only large read tool.",
                parameters: z.object({}),
                execute: async () => ({
                  title: "Large Parallel Child",
                  text: large,
                  metadata: {
                    stdout: large,
                  },
                }),
                toModelOutput: async () => ({
                  type: "json" as const,
                  value: {
                    leaked: "secret-tail",
                  },
                }),
              }),
              {
                maxResultSizeChars: 1_000,
                capabilities: {
                  kind: "read",
                  readOnly: true,
                  destructive: false,
                  concurrency: "safe",
                },
              },
            ),
          )

          const agent = await Agent.get("default")
          expect(agent).toBeDefined()
          const tools = await resolveTools({
            agent: agent!,
            sessionID,
            messageID: Identifier.ascending("message"),
            abort: new AbortController().signal,
          })
          const parallel = tools["multi_tool_use_parallel"] as any
          const output = await parallel.execute({
            calls: [
              { tool: "parallel-large-tool", input: {} },
            ],
          }, {
            toolCallId: "tool-parallel-persist",
            messages: [],
          })

          const child = output.data.results[0]
          expect(child).toMatchObject({
            phase: "settled",
            outcome: "returned",
            result: "success",
          })
          expect(child.output).toContain("<persisted-output>")
          expect(child.modelOutput).toMatchObject({
            type: "text",
          })
          expect(JSON.stringify(child)).not.toContain("secret-tail")
          expect(output.text).not.toContain("secret-tail")
        },
      })
    } finally {
      ToolResultPersistence.removeSessionOutputDirectory(sessionID)
      await rm(root, { recursive: true, force: true })
    }
  })

  it("loads workspace dependency paths as structured read-only JSON", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-workspace-deps-"))

    try {
      const dependenciesRoot = await createWorkspaceDependenciesFixture(root)
      const nodeExecutable = path.join(root, process.platform === "win32" ? "node.exe" : "node")
      await writeFile(nodeExecutable, "")

      await withProcessEnv(
        {
          ANYBOX_WORKSPACE_DEPENDENCIES_DIR: dependenciesRoot,
          ANYBOX_WORKSPACE_DEPENDENCIES_VERSION: "fixture-env-version",
          ANYBOX_NODE_BINARY: nodeExecutable,
          ANYBOX_NODE_RUN_AS_NODE: "1",
        },
        async () => {
          expect(LoadWorkspaceDependenciesTool.aliases).toEqual(["load-workspace-dependencies"])
          expect(LoadWorkspaceDependenciesTool.capabilities).toMatchObject({
            kind: "read",
            readOnly: true,
            destructive: false,
            concurrency: "safe",
          })
          expect(Tool.toolMatchesName(LoadWorkspaceDependenciesTool, "load-workspace-dependencies")).toBe(true)

          const runtime = await LoadWorkspaceDependenciesTool.init()
          const result = Tool.normalizeToolOutput(await runtime.execute(
            {},
            {
              sessionID: "session-workspace-deps",
              messageID: "message-workspace-deps",
            },
          ))
          const data = result.data as any

          expect(result.title).toBe("Workspace dependencies")
          expect(data).toMatchObject({
            kind: "workspace-dependencies",
            version: 1,
            bundleVersion: "fixture-env-version",
            dependenciesRoot,
            bun: {
              executable: process.execPath,
              available: true,
            },
            node: {
              executable: nodeExecutable,
              packages: path.join(dependenciesRoot, "node", "node_modules"),
              env: {
                ELECTRON_RUN_AS_NODE: "1",
              },
              available: true,
            },
            python: {
              executable: process.platform === "win32"
                ? path.join(dependenciesRoot, "python", "python.exe")
                : path.join(dependenciesRoot, "python", "bin", "python3"),
              packages: path.join(dependenciesRoot, "python"),
              available: true,
            },
            missing: [],
          })

          const modelOutput = Tool.normalizeToolModelOutput(await runtime.toModelOutput!(result))
          expect(modelOutput).toMatchObject({
            type: "json",
            value: {
              kind: "workspace-dependencies",
              bundleVersion: "fixture-env-version",
            },
          })
        },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("reports missing workspace dependencies without throwing", async () => {
    await withProcessEnv(
      {
        ANYBOX_WORKSPACE_DEPENDENCIES_DIR: undefined,
        ANYBOX_WORKSPACE_DEPENDENCIES_VERSION: undefined,
        ANYBOX_NODE_BINARY: undefined,
        ANYBOX_NODE_RUN_AS_NODE: undefined,
      },
      async () => {
        const runtime = await LoadWorkspaceDependenciesTool.init()
        const result = Tool.normalizeToolOutput(await runtime.execute(
          {},
          {
            sessionID: "session-workspace-deps-missing",
            messageID: "message-workspace-deps-missing",
          },
        ))
        const data = result.data as any

        expect(data.kind).toBe("workspace-dependencies")
        expect(data.bundleVersion).toBe("unavailable")
        expect(data.missing).toContain("ANYBOX_WORKSPACE_DEPENDENCIES_DIR")
        expect(data.missing.length).toBeGreaterThan(0)
        expect(result.text).toContain("Missing:")
      },
    )
  })

  it("shapes AskUserQuestion output for the user and the model", async () => {
    const runtime = await AskUserQuestionTool.init()
    const toolCallID = "tool-call-ask-1"
    const questionID = "que_tool_call_ask_1"
    const pendingOutput = runtime.execute(
      {
        header: "Deployment target",
        question: "Where should I deploy this app?",
        options: [
          {
            label: "Vercel",
            description: "Best fit for the current setup.",
          },
          {
            label: "Cloudflare",
            value: "cloudflare",
          },
        ],
        allowFreeform: true,
      },
      {
        sessionID: "session-ask-question",
        messageID: "message-ask-question",
        toolCallID,
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    answerAskUserQuestion({
      sessionID: "session-ask-question",
      questionID,
      selectedOptions: ["Vercel"],
    })

    const output = Tool.normalizeToolOutput(
      await pendingOutput,
    )

    expect(output.title).toBe("Deployment target")
    expect(output.text).toContain("Question: Where should I deploy this app?")
    expect(output.text).toContain("User answer received:")
    expect(output.metadata).toMatchObject({
      kind: "ask-user-question",
      version: 1,
      questionID,
      toolCallID,
      header: "Deployment target",
      question: "Where should I deploy this app?",
      options: [
        {
          label: "Vercel",
          value: "Vercel",
          description: "Best fit for the current setup.",
        },
        {
          label: "Cloudflare",
          value: "cloudflare",
          description: undefined,
        },
      ],
      allowFreeform: true,
      placeholder: undefined,
      multiple: false,
      required: true,
      answered: true,
      answerText: "Vercel",
      selectedOptions: ["Vercel"],
    })

    const modelOutput = Tool.normalizeToolModelOutput(await runtime.toModelOutput?.(output)!)
    expect(modelOutput.type).toBe("json")
    if (modelOutput.type !== "json") {
      throw new Error(`Expected json model output, received ${modelOutput.type}`)
    }
    expect(modelOutput.value).toMatchObject({
      kind: "ask-user-question",
      shownToUser: true,
      answered: true,
      toolCallID,
      header: "Deployment target",
      question: "Where should I deploy this app?",
      options: [
        {
          label: "Vercel",
          value: "Vercel",
          description: "Best fit for the current setup.",
        },
        {
          label: "Cloudflare",
          value: "cloudflare",
          description: undefined,
        },
      ],
      allowFreeform: true,
      multiple: false,
      required: true,
      answerText: "Vercel",
      selectedOptions: ["Vercel"],
      instruction: "The user answered this question. Continue using the answer.",
    })
  })

  it("replays structured question answers into model context", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "user-question-answer",
            sessionID: "session-question-answer",
            role: "user",
            created: Date.now(),
            agent: "plan",
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
          } as Message.User,
          parts: [
            {
              id: "part-question-answer",
              sessionID: "session-question-answer",
              messageID: "user-question-answer",
              type: "text",
              text: "vercel",
              metadata: {
                kind: "question-answer",
                questionID: "que_deploy_target",
                selectedOptions: ["vercel"],
              },
            } as Message.TextPart,
          ],
        },
      ],
      model,
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "user",
    })
    const serializedMessage = JSON.stringify(messages[0])
    expect(serializedMessage).toContain("\"type\":\"text\"")
    expect(serializedMessage).toContain("<question-answer>")
    expect(serializedMessage).toContain("question_id: que_deploy_target")
    expect(serializedMessage).toContain("selected_options: vercel")
    expect(serializedMessage).toContain("answer: vercel")
  })

  it("replays structured message quotes with stable escaped boundaries", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "user-message-quote",
            sessionID: "session-message-quote",
            role: "user",
            created: Date.now(),
            agent: "default",
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
          } as Message.User,
          parts: [
            {
              id: "part-message-quote",
              sessionID: "session-message-quote",
              messageID: "user-message-quote",
              type: "message-quote",
              sourceMessageID: "assistant-source",
              text: "Use <this> & do not close </message-quote> early.",
            } as Message.MessageQuotePart,
          ],
        },
      ],
      model,
    )

    const serializedMessage = JSON.stringify(messages[0])
    expect(serializedMessage).toContain(
      '<message-quote source_message_id=\\"assistant-source\\">',
    )
    expect(serializedMessage).toContain(
      "Use &lt;this&gt; &amp; do not close &lt;/message-quote&gt; early.",
    )
    expect(serializedMessage.match(/<\/message-quote>/g)).toHaveLength(1)
  })

  it("replays internal runtime event user messages into model context", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "user-runtime-event",
            sessionID: "session-runtime-event",
            role: "user",
            created: Date.now(),
            agent: "default",
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
            internal: true,
          } as Message.User,
          parts: [
            {
              id: "part-runtime-event",
              sessionID: "session-runtime-event",
              messageID: "user-runtime-event",
              type: "text",
              text: [
                '<runtime_event type="subagent.completed">',
                "task_id: task_123",
                "agent_id: default",
                "child_session_id: session_child",
                "status: completed",
                "",
                "summary:",
                "delegated work completed",
                "</runtime_event>",
              ].join("\n"),
              synthetic: true,
              metadata: {
                kind: "runtime-event",
                runtimeEventType: "subagent.completed",
                taskID: "task_123",
                childSessionID: "session_child",
                status: "completed",
                agent: "default",
              },
            } as Message.TextPart,
          ],
        },
      ],
      model,
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "user",
    })
    const serializedMessage = JSON.stringify(messages[0])
    expect(serializedMessage).toContain("<runtime_event type=\\\"subagent.completed\\\">")
    expect(serializedMessage).toContain("delegated work completed")
  })

  it("does not replay AskUserQuestion UI metadata as provider options", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
    } as any

    const providerMetadata = {
      openai: {
        itemId: "item-1",
      },
    }
    const questionMetadata = {
      kind: "ask-user-question",
      version: 1,
      questionID: "que_call_ask",
      toolCallID: "call-ask",
      header: "Question",
      question: "What next?",
      options: [{ label: "Feature", value: "feature" }],
      allowFreeform: true,
      multiple: false,
      required: true,
    }

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "assistant-question",
            sessionID: "session-question-provider-options",
            role: "assistant",
            created: Date.now(),
            parentID: "user-question",
            modelID: "test-model",
            providerID: "test-provider",
            agent: "plan",
            path: {
              cwd: ".",
              root: ".",
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
          } satisfies Message.Assistant,
          parts: [
            {
              id: "part-question-tool",
              sessionID: "session-question-provider-options",
              messageID: "assistant-question",
              type: "tool",
              callID: "call-ask",
              tool: "AskUserQuestion",
              schemaVersion: 3,
              turnID: "turn-test",
              input: { raw: JSON.stringify({
                  header: "Question",
                  question: "What next?",
                  options: [{ label: "Feature", value: "feature" }],
                  allowFreeform: true,
                }), value: {
                  header: "Question",
                  question: "What next?",
                  options: [{ label: "Feature", value: "feature" }],
                  allowFreeform: true,
                } },
              source: { kind: "provider", metadata: providerMetadata },
              retry: { attempt: 1 },
              revision: 1,
              timestamps: { createdAt: 1, settledAt: 2 },
              state: { phase: "settled", outcome: { kind: "returned", result: "success", completeness: "complete", output: "User answer received:\nfeature", modelOutput: {
                  type: "json",
                  value: {
                    answered: true,
                    answerText: "feature",
                  },
                }, title: "Question", metadata: {
                  ...questionMetadata,
                  answered: true,
                  answerText: "feature",
                  selectedOptions: ["feature"],
                }, execution: { sideEffect: "unknown", retry: "unknown" } }, control: { mode: "continue-model" } },
            } as Message.ToolPart,
          ],
        },
      ],
      model,
    )

    const assistantMessage = messages.find((item) => item.role === "assistant") as any
    expect(assistantMessage?.content[0]).toMatchObject({
      type: "tool-call",
      toolCallId: "call-ask",
      toolName: "ask_user_question",
      providerOptions: {
        openai: {
          itemId: "item-1",
        },
      },
    })
    expect(JSON.stringify(assistantMessage?.content[0]?.providerOptions)).not.toContain("questionID")
    expect(assistantMessage?.content[1]).toMatchObject({
      type: "tool-result",
      toolCallId: "call-ask",
      toolName: "ask_user_question",
      providerOptions: {
        openai: {
          itemId: "item-1",
        },
      },
    })
    expect(JSON.stringify(assistantMessage?.content[1]?.providerOptions)).not.toContain("questionID")
  })

  it("rewrites legacy Anybox tool_search history without renaming native provider calls", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "assistant-tool-search-history",
            sessionID: "session-tool-search-history",
            role: "assistant",
            created: Date.now(),
            parentID: "user-tool-search-history",
            modelID: "test-model",
            providerID: "test-provider",
            agent: "plan",
            path: { cwd: ".", root: "." },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          } satisfies Message.Assistant,
          parts: [
            {
              id: "part-a-legacy-search",
              sessionID: "session-tool-search-history",
              messageID: "assistant-tool-search-history",
              type: "tool",
              callID: "call-legacy-search",
              tool: TOOL_SEARCH_ID,
              schemaVersion: 3,
              turnID: "turn-test",
              input: { raw: JSON.stringify({ query: "computer use", limit: 8 }), value: { query: "computer use", limit: 8 } },
              source: { kind: "model" },
              retry: { attempt: 1 },
              revision: 1,
              timestamps: { createdAt: 1, settledAt: 2 },
              state: { phase: "settled", outcome: { kind: "denied", reason: "test denial", approvalID: "approval-test", execution: { sideEffect: "none", retry: "safe" } }, control: { mode: "continue-model" } },
            } as Message.ToolPart,
            {
              id: "part-b-native-search",
              sessionID: "session-tool-search-history",
              messageID: "assistant-tool-search-history",
              type: "tool",
              callID: "call-native-search",
              tool: TOOL_SEARCH_ID,
              schemaVersion: 3,
              turnID: "turn-test",
              input: { raw: JSON.stringify({ arguments: { query: "native" } }), value: { arguments: { query: "native" } } },
              source: { kind: "provider" },
              retry: { attempt: 1 },
              revision: 1,
              timestamps: { createdAt: 1, settledAt: 2 },
              state: { phase: "settled", outcome: { kind: "returned", result: "success", completeness: "complete", output: "native search result", modelOutput: { type: "text", value: "native search result" }, title: "Native search", metadata: {}, execution: { sideEffect: "unknown", retry: "unknown" } }, control: { mode: "continue-model" } },
            } as Message.ToolPart,
          ],
        },
      ],
      model,
    )

    const assistantMessage = messages.find((item) => item.role === "assistant") as any
    const legacyCall = assistantMessage?.content.find(
      (part: any) => part.type === "tool-call" && part.toolCallId === "call-legacy-search",
    )
    const nativeCall = assistantMessage?.content.find(
      (part: any) => part.type === "tool-call" && part.toolCallId === "call-native-search",
    )
    const legacyResult = (messages.find((item) => item.role === "tool") as any)?.content.find(
      (part: any) => part.toolCallId === "call-legacy-search",
    )

    expect(legacyCall?.toolName).toBe(TOOL_SEARCH_MODEL_NAME)
    expect(legacyResult?.toolName).toBe(TOOL_SEARCH_MODEL_NAME)
    expect(nativeCall?.toolName).toBe(TOOL_SEARCH_ID)
  })

  it("exposes git_bash_command runtime hooks with structured behavior", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-shell-command-"))

    try {
      await createGitRepo(repositoryRoot, "shell-command")

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await GitBashCommandTool.init()
          const ctx = {
            sessionID: "session-shell-command",
            messageID: "message-shell-command",
          }

          expect(runtime.formatValidationError).toBeTypeOf("function")
          expect(runtime.validate).toBeTypeOf("function")
          expect(runtime.authorize).toBeTypeOf("function")
          expect(runtime.toModelOutput).toBeTypeOf("function")

          await expect(
            runtime.execute(
              {
                command: "",
              } as never,
              ctx,
            ),
          ).rejects.toThrow("Invalid git_bash_command arguments. command:")

          await expect(runtime.validate?.({ command: "   ", tty: false }, ctx)).resolves.toBe(
            "Command must contain non-whitespace characters.",
          )

          await expect(
            runtime.validate?.(
              {
                command: "pwd",
                workdir: "missing",
                tty: false,
              },
              ctx,
            ),
          ).resolves.toBe("Workdir must be a directory: missing")

          expect(
            runtime.authorize?.(
              {
                command: "rm -rf /",
                tty: false,
              },
              ctx,
            ),
          ).toEqual({
            message:
              "Command matched a dangerous pattern and was blocked. Set allowUnsafe=true only when this action is explicitly intended.",
          })

          const modelOutput = await runtime.toModelOutput?.({
            title: "git_bash_command: printf hello",
            text: "Command: printf hello\nWorkdir: .\nShell: /bin/bash\nExit: 0\n\nSTDOUT:\nhello\n\nSTDERR:\n(no stderr)",
            metadata: {
              command: "printf hello",
              shell: "/bin/bash",
              cwd: repositoryRoot,
              displayCwd: ".",
              timeoutMs: 60_000,
              exitCode: 0,
              signal: null,
              tty: false,
              timedOut: false,
              aborted: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdout: "hello",
              stderr: "",
              terminalOutput: "",
              terminalOutputTruncated: false,
              runInBackground: false,
              backgroundTaskId: null,
            },
          })

          expect(Tool.normalizeToolModelOutput(modelOutput!)).toEqual({
            type: "json",
            value: {
              workdir: ".",
              shell: "/bin/bash",
              tty: false,
              exitCode: 0,
              signal: null,
              timedOut: false,
              aborted: false,
              result: "success",
              completeness: "complete",
              processState: "settled",
              backgroundTaskId: null,
              runInBackground: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdout: "hello",
              stderr: "",
            },
          })

          expect(JSON.stringify(modelOutput)).not.toContain("printf hello")
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  }, 120000)

  it("waits for process exit without depending on stream close", async () => {
    const proc = new EventEmitter() as EventEmitter & {
      once(event: "error", listener: (error: Error) => void): unknown
      once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
    }

    const pending = waitForProcessExit(proc)
    proc.emit("exit", 0, null)

    await expect(pending).resolves.toEqual({
      code: 0,
      signal: null,
    })
  })

  it("formats SSH shell model output without repeating invocation fields", async () => {
    const runtime = await SshShellCommandTool.init()
    const modelOutput = Tool.normalizeToolModelOutput(await runtime.toModelOutput!({
      title: "ssh_shell_command: printf ssh-result",
      text: [
        "Command: printf ssh-result",
        "Workdir: /srv/project",
        "Shell: remote sh -lc",
        "Exit: 0",
        "STDOUT:",
        "ssh-result",
        "STDERR:",
        "(no stderr)",
      ].join("\n"),
      metadata: {
        command: "printf ssh-result",
        shell: "remote sh -lc",
        cwd: "ssh://profile/srv/project",
        displayCwd: "/srv/project",
        timeoutMs: 60_000,
        exitCode: 0,
        stdout: "ssh-result",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 12,
      },
    }))

    expect(modelOutput).toEqual({
      type: "json",
      value: {
        workdir: "/srv/project",
        shell: "remote sh -lc",
        exitCode: 0,
        result: "success",
        completeness: "complete",
        stdout: "ssh-result",
        stderr: "",
      },
    })
    expect(JSON.stringify(modelOutput)).not.toContain("printf ssh-result")
  })

  it("starts background shell tasks, polls them with write_stdin, and cleans them up through the registry", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const execTool = process.platform === "darwin"
          ? MacOSShellCommandTool
          : process.platform === "win32"
            ? GitBashCommandTool
            : null
        if (!execTool) return
        const execRuntime = await execTool.init()
        const writeRuntime = await WriteStdinTool.init()
        const ctx = {
          sessionID: "session-background-task",
          messageID: "message-background-task",
        }

        const started = Tool.normalizeToolOutput(await execRuntime.execute(
          {
            command: "printf hello && exec sleep 30",
            run_in_background: true,
            tty: false,
          },
          ctx,
        ))

        const backgroundTaskId = String((started.metadata as any)?.backgroundTaskId)
        const modelOutput = await execRuntime.toModelOutput?.(started as any)
        expect(started.text).toContain("Status: started in background")
        expect(started.text).toContain("Session Information > Background Processes")
        expect(started.text).not.toContain("printf hello && exec sleep 30")
        expect(started.text).not.toContain("Command:")
        expect(started.text).not.toContain("Workdir:")
        expect(started.text).not.toContain("Shell:")
        expect(started.text).not.toContain("TTY:")
        expect(started.title).toMatch(/command running$/)
        expect(started.metadata).toMatchObject({
          runInBackground: true,
          backgroundTaskId: expect.stringMatching(/^tsk_/),
        })

        const normalizedModelOutput = Tool.normalizeToolModelOutput(modelOutput!)
        expect(normalizedModelOutput.type).toBe("json")
        if (normalizedModelOutput.type !== "json") {
          throw new Error(`Expected json model output, received ${normalizedModelOutput.type}`)
        }
        expect(normalizedModelOutput.value).toMatchObject({
          result: "success",
          completeness: "partial",
          processState: "running",
        })
        expect(String((normalizedModelOutput.value as any).backgroundTaskId)).toStartWith("tsk_")
        expect((normalizedModelOutput.value as any).session_id).toBe(backgroundTaskId)
        expect((normalizedModelOutput.value as any).runInBackground).toBe(true)
        expect(normalizedModelOutput.value).not.toHaveProperty("title")
        expect(normalizedModelOutput.value).not.toHaveProperty("command")

        const snapshot = Tool.normalizeToolOutput(await writeRuntime.execute(
          {
            session_id: backgroundTaskId,
            chars: "",
            "yield-time_ms": 5_000,
          },
          ctx,
        ))

        expect(snapshot.text).toContain("OUTPUT:")
        expect(String((snapshot.metadata as any)?.output ?? "")).toContain("hello")
        expect((snapshot.metadata as any)?.processState).toBe("running")

        const stopped = await getShellTaskRegistry().stop(backgroundTaskId, ctx.sessionID)

        expect(stopped).toMatchObject({
          id: backgroundTaskId,
          status: "deleted",
        })

        await Bun.sleep(150)
      },
    })
  }, 120000)

  it("automatically yields a still-running shell command on every supported host shell", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const shellCase = process.platform === "darwin"
          ? {
              tool: MacOSShellCommandTool,
              command: "printf hello && exec sleep 30",
            }
          : process.platform === "win32"
            ? {
                tool: PowerShellCommandTool,
                command: "Write-Output hello; Start-Sleep -Seconds 30",
              }
            : null
        if (!shellCase) return

        const execRuntime = await shellCase.tool.init()
        const writeRuntime = await WriteStdinTool.init()
        const ctx = {
          sessionID: "session-shell-auto-yield",
          messageID: "message-shell-auto-yield",
        }

        const started = Tool.normalizeToolOutput(await execRuntime.execute(
          {
            command: shellCase.command,
            "yield-time_ms": 100,
            tty: false,
          },
          ctx,
        ))
        const backgroundTaskId = String((started.metadata as any)?.backgroundTaskId)
        const cursor = Number((started.metadata as any)?.backgroundTaskCursor ?? 0)

        expect(started.text).toContain("continuing in background")
        expect(started.metadata).toMatchObject({
          runInBackground: true,
          backgroundTaskId: expect.stringMatching(/^tsk_/),
        })
        expect(await execRuntime.toModelOutput!(started)).toMatchObject({
          type: "json",
          value: {
            result: "success",
            completeness: "partial",
            processState: "running",
            backgroundTaskId,
            backgroundTaskCursor: cursor,
            session_id: backgroundTaskId,
            yieldTimeMs: 100,
          },
        })

        const snapshot = Tool.normalizeToolOutput(await writeRuntime.execute(
          {
            session_id: backgroundTaskId,
            chars: "",
            "yield-time_ms": 5_000,
          },
          ctx,
        ))

        expect(
          `${String((started.metadata as any)?.stdout ?? "")}\n${String((snapshot.metadata as any)?.output ?? "")}`,
        ).toContain("hello")

        const stopped = await getShellTaskRegistry().stop(backgroundTaskId, ctx.sessionID)
        expect(stopped).toMatchObject({
          id: backgroundTaskId,
          status: "deleted",
        })
      },
    })
  }, 120000)

  it("returns a short shell command directly when it exits before the yield deadline", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const shellCase = process.platform === "darwin"
          ? {
              tool: MacOSShellCommandTool,
              command: "printf short-result",
            }
          : process.platform === "win32"
            ? {
                tool: PowerShellCommandTool,
                command: "Write-Output short-result; Write-Output \"中文输出正常\"",
              }
            : null
        if (!shellCase) return

        const runtime = await shellCase.tool.init()
        const result = Tool.normalizeToolOutput(await runtime.execute(
          {
            command: shellCase.command,
            "yield-time_ms": 5_000,
            tty: false,
          },
          {
            sessionID: "session-shell-short-command",
            messageID: "message-shell-short-command",
          },
        ))

        const stdout = String(result.metadata?.stdout)
        expect(result.metadata).toMatchObject({
          exitCode: 0,
          runInBackground: false,
          backgroundTaskId: null,
        })
        expect(result.title).toMatch(/command completed$/)
        expect(result.text).toContain("Exit: 0")
        expect(result.text).toContain("STDOUT:")
        expect(result.text).toContain("STDERR:")
        expect(result.text).not.toContain(shellCase.command)
        expect(result.text).not.toContain("Command:")
        expect(result.text).not.toContain("Workdir:")
        expect(result.text).not.toContain("Shell:")
        expect(result.text).not.toContain("TTY:")
        expect(stdout).toContain("short-result")
        if (process.platform === "win32") {
          const modelOutput = await runtime.toModelOutput!(result)
          expect(String(result.metadata?.shell)).toMatch(/pwsh\.exe$/i)
          expect(String(result.metadata?.shellVersion)).toMatch(/^7\./)
          expect(result.metadata?.shellEdition).toBe("Core")
          expect(stdout).toContain("中文输出正常")
          expect(modelOutput).toMatchObject({
            type: "json",
            value: {
              shellVersion: expect.stringMatching(/^7\./),
              shellEdition: "Core",
            },
          })
          expect((modelOutput as any).value).not.toHaveProperty("title")
          expect((modelOutput as any).value).not.toHaveProperty("command")
        }
      },
    })
  }, 120000)

  it("formats completed tty commands as merged terminal output", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const shellCase = process.platform === "darwin"
          ? {
              tool: MacOSShellCommandTool,
              command: "printf '\\033[32mterminal-short\\033[0m\\n'",
            }
          : process.platform === "win32"
            ? {
                tool: PowerShellCommandTool,
                command: "Write-Host \"$([char]27)[32mterminal-short$([char]27)[0m\"; Write-Output \"终端中文正常\"",
              }
            : null
        if (!shellCase) return

        const runtime = await shellCase.tool.init()
        const result = Tool.normalizeToolOutput(await runtime.execute(
          {
            command: shellCase.command,
            tty: true,
            "yield-time_ms": 5_000,
          },
          {
            sessionID: "session-shell-short-tty",
            messageID: "message-shell-short-tty",
          },
        ))

        expect(result.text).toContain("TERMINAL OUTPUT:")
        expect(result.text).toContain("Exit: 0")
        expect(result.text).not.toContain("STDOUT:")
        expect(result.text).not.toContain(shellCase.command)
        expect(result.text).not.toContain("Command:")
        expect(result.text).not.toContain("Workdir:")
        expect(result.text).not.toContain("Shell:")
        expect(result.text).not.toContain("TTY:")
        expect(result.metadata).toMatchObject({
          tty: true,
          exitCode: 0,
          terminalOutputTruncated: false,
        })
        expect(String((result.metadata as any)?.terminalOutput)).toContain("terminal-short")
        expect(String((result.metadata as any)?.terminalOutput)).not.toContain("\x1b[")
        if (process.platform === "win32") {
          expect(String((result.metadata as any)?.terminalOutput)).toContain("终端中文正常")
          expect(result.metadata).toMatchObject({
            shellEdition: "Core",
          })
          expect(String(result.metadata?.shellVersion)).toMatch(/^7\./)
        }
        const modelOutput = await runtime.toModelOutput!(result)
        expect((modelOutput as any).type).toBe("json")
        expect((modelOutput as any).value.tty).toBe(true)
        expect((modelOutput as any).value.terminalOutput).toContain("terminal-short")
        expect((modelOutput as any).value).not.toHaveProperty("title")
        expect((modelOutput as any).value).not.toHaveProperty("command")
      },
    })
  }, 120000)

  it("keeps foreground truncation state in model output without adding display notes", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const shellCase = process.platform === "darwin"
          ? MacOSShellCommandTool
          : process.platform === "win32"
            ? GitBashCommandTool
            : null
        if (!shellCase) return

        const runtime = await shellCase.init()
        const command = "i=0; while [ \"$i\" -lt 400 ]; do printf x; i=$((i+1)); done"
        const result = Tool.normalizeToolOutput(await runtime.execute(
          {
            command,
            maxOutputChars: 80,
            "yield-time_ms": 5_000,
            tty: false,
          },
          {
            sessionID: "session-shell-truncated-command",
            messageID: "message-shell-truncated-command",
          },
        ))

        expect(result.text).toContain("Exit: 0")
        expect(result.text).toContain("STDOUT:")
        expect(result.text).toContain("STDERR:")
        expect(result.text).not.toContain("Note:")
        expect(result.text).not.toContain(command)
        expect(result.metadata).toMatchObject({
          stdoutTruncated: true,
          runInBackground: false,
        })

        const modelOutput = await runtime.toModelOutput!(result)
        expect(modelOutput).toMatchObject({
          type: "json",
          value: {
            stdoutTruncated: true,
          },
        })
        expect((modelOutput as any).value).not.toHaveProperty("title")
        expect((modelOutput as any).value).not.toHaveProperty("command")
      },
    })
  }, 120000)

  it("formats failed shell commands as result-only output", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const shellCase = process.platform === "darwin"
          ? {
              tool: MacOSShellCommandTool,
              command: "exit 7",
            }
          : process.platform === "win32"
            ? {
                tool: GitBashCommandTool,
                command: "exit 7",
              }
            : null
        if (!shellCase) return

        const runtime = await shellCase.tool.init()
        const result = Tool.normalizeToolOutput(await runtime.execute(
          {
            command: shellCase.command,
            "yield-time_ms": 5_000,
            tty: false,
          },
          {
            sessionID: "session-shell-failed-command",
            messageID: "message-shell-failed-command",
          },
        ))

        expect(result.title).toMatch(/command returned a non-zero exit code$/)
        expect(result.result).toBe("negative")
        expect(result.completeness).toBe("complete")
        expect(result.text).toContain("Exit: 7")
        expect(result.text).not.toContain(shellCase.command)
        expect(result.text).not.toContain("Command:")
      },
    })
  }, 120000)

  it("formats timed-out shell commands as result-only output", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const shellCase = process.platform === "darwin"
          ? {
              tool: MacOSShellCommandTool,
              command: "sleep 5",
            }
          : process.platform === "win32"
            ? {
                tool: GitBashCommandTool,
                command: "sleep 5",
              }
            : null
        if (!shellCase) return

        const runtime = await shellCase.tool.init()
        let thrown: unknown
        try {
          await runtime.execute(
            {
              command: shellCase.command,
              timeoutMs: 50,
              "yield-time_ms": 5_000,
              tty: false,
            },
            {
              sessionID: "session-shell-timed-out-command",
              messageID: "message-shell-timed-out-command",
            },
          )
        } catch (error) {
          thrown = error
        }

        const signal = Tool.findToolControlSignal(thrown)
        expect(signal?.outcome).toMatchObject({
          kind: "timeout",
          timeoutMs: 50,
          execution: { sideEffect: "possible", retry: "unknown" },
        })
        if (signal?.outcome.kind !== "timeout") throw new Error("Expected a timeout outcome.")
        expect(String(signal.outcome.partialOutput)).toContain("(timed out)")
        expect(String(signal.outcome.partialOutput)).not.toContain(shellCase.command)
      },
    })
  }, 120000)

  it("continues a yielded shell session through write_stdin without exposing a cursor", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const shellCase = process.platform === "darwin"
          ? {
              tool: MacOSShellCommandTool,
              command: "printf initial; sleep 0.5; printf final",
            }
          : process.platform === "win32"
            ? {
                tool: PowerShellCommandTool,
                command: "Write-Output initial; Start-Sleep -Milliseconds 500; Write-Output final",
              }
            : null
        if (!shellCase) return

        const execRuntime = await shellCase.tool.init()
        const writeRuntime = await WriteStdinTool.init()
        const ctx = {
          sessionID: "session-write-stdin-poll",
          messageID: "message-write-stdin-poll",
        }
        const started = Tool.normalizeToolOutput(await execRuntime.execute(
          {
            command: shellCase.command,
            "yield-time_ms": 50,
            tty: false,
          },
          ctx,
        ))
        const sessionID = String((started.metadata as any)?.sessionID)

        expect(sessionID).toStartWith("tsk_")
        expect(await execRuntime.toModelOutput!(started)).toMatchObject({
          type: "json",
          value: {
            session_id: sessionID,
            result: "success",
            completeness: "partial",
            processState: "running",
          },
        })

        const completed = Tool.normalizeToolOutput(await writeRuntime.execute(
          {
            session_id: sessionID,
            chars: "",
            "yield-time_ms": 5_000,
          },
          ctx,
        ))
        expect(completed.metadata).toMatchObject({
          id: sessionID,
          sessionID: null,
          processState: "exited",
          exitCode: 0,
        })
        expect(String((completed.metadata as any)?.output ?? "")).toContain("final")
        const modelOutput = await writeRuntime.toModelOutput!(completed) as any
        expect(modelOutput.type).toBe("json")
        expect(modelOutput.value.process_state).toBe("exited")
        expect(modelOutput.value.result).toBe("success")
        expect(modelOutput.value.completeness).toBe("complete")
        expect(modelOutput.value.exit_code).toBe(0)
        expect(modelOutput.value.output).toContain("final")
        expect(modelOutput.value.session_id).toBeUndefined()
      },
    })
  }, 120000)

  it("interrupts a yielded shell session through write_stdin Ctrl-C", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const shellCase = process.platform === "darwin"
          ? {
              tool: MacOSShellCommandTool,
              command: "exec sleep 30",
            }
          : process.platform === "win32"
            ? {
                tool: PowerShellCommandTool,
                command: "Start-Sleep -Seconds 30",
              }
            : null
        if (!shellCase) return

        const execRuntime = await shellCase.tool.init()
        const writeRuntime = await WriteStdinTool.init()
        const ctx = {
          sessionID: "session-write-stdin-interrupt",
          messageID: "message-write-stdin-interrupt",
        }
        const started = Tool.normalizeToolOutput(await execRuntime.execute(
          {
            command: shellCase.command,
            "yield-time_ms": 50,
            tty: false,
          },
          ctx,
        ))
        const sessionID = String((started.metadata as any)?.sessionID)
        const interrupted = Tool.normalizeToolOutput(await writeRuntime.execute(
          {
            session_id: sessionID,
            chars: "\x03",
            "yield-time_ms": 2_000,
          },
          ctx,
        ))

        expect(interrupted.metadata).toMatchObject({
          id: sessionID,
          interrupted: true,
        })
        if (process.platform === "win32") {
          expect((interrupted.metadata as any)?.processState).toBe("running")
          expect(interrupted.text).toContain("Session Information > Background Processes")
        }
        if ((interrupted.metadata as any)?.processState === "running") {
          await getShellTaskRegistry().stop(sessionID, ctx.sessionID)
        } else {
          expect((interrupted.metadata as any)?.processState).toBe("exited")
        }
      },
    })
  }, 120000)

  it("closes pipe stdin by default so readers receive EOF", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const shellCase = process.platform === "darwin"
          ? {
              tool: MacOSShellCommandTool,
              command: "if IFS= read -r value; then printf 'stdin:unexpected'; else printf 'stdin:eof'; fi",
            }
          : process.platform === "win32"
            ? {
                tool: PowerShellCommandTool,
                command: "$value = [Console]::In.ReadLine(); if ($null -eq $value) { Write-Output 'stdin:eof' } else { Write-Output 'stdin:unexpected' }",
              }
            : null
        if (!shellCase) return

        const runtime = await shellCase.tool.init()
        const result = Tool.normalizeToolOutput(await runtime.execute(
          {
            command: shellCase.command,
            tty: false,
            "yield-time_ms": 5_000,
          },
          {
            sessionID: "session-pipe-stdin-eof",
            messageID: "message-pipe-stdin-eof",
          },
        ))

        expect(result.metadata).toMatchObject({
          tty: false,
          exitCode: 0,
          runInBackground: false,
          stdout: expect.stringContaining("stdin:eof"),
        })
      },
    })
  }, 120000)

  it("rejects ordinary write_stdin input for pipe sessions with an actionable tty hint", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const shellCase = process.platform === "darwin"
          ? {
              tool: MacOSShellCommandTool,
              command: "exec sleep 30",
            }
          : process.platform === "win32"
            ? {
                tool: PowerShellCommandTool,
                command: "Start-Sleep -Seconds 30",
              }
            : null
        if (!shellCase) return

        const execRuntime = await shellCase.tool.init()
        const writeRuntime = await WriteStdinTool.init()
        const ctx = {
          sessionID: "session-pipe-stdin-rejected",
          messageID: "message-pipe-stdin-rejected",
        }
        const started = Tool.normalizeToolOutput(await execRuntime.execute(
          {
            command: shellCase.command,
            tty: false,
            "yield-time_ms": 50,
          },
          ctx,
        ))
        const sessionID = String((started.metadata as any)?.sessionID)

        await expect(writeRuntime.execute({
          session_id: sessionID,
          chars: "yes\n",
        }, ctx)).rejects.toThrow("tty=true")
        await getShellTaskRegistry().stop(sessionID, ctx.sessionID)
      },
    })
  }, 120000)

  it("writes ordinary stdin to a yielded tty shell session", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const shellCase = process.platform === "darwin"
          ? {
              tool: MacOSShellCommandTool,
              command: "if [ -t 0 ] && [ -t 1 ]; then printf 'tty:true\\n'; else printf 'tty:false\\n'; fi; IFS= read -r value; printf 'got:%s' \"$value\"",
            }
          : process.platform === "win32"
            ? {
                tool: PowerShellCommandTool,
                command: "Write-Output \"tty:$(-not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected)\"; $value = [Console]::In.ReadLine(); Write-Output \"got:$value\"",
              }
            : null
        if (!shellCase) return

        const execRuntime = await shellCase.tool.init()
        const writeRuntime = await WriteStdinTool.init()
        const ctx = {
          sessionID: "session-write-stdin-input",
          messageID: "message-write-stdin-input",
        }
        const started = Tool.normalizeToolOutput(await execRuntime.execute(
          {
            command: shellCase.command,
            "yield-time_ms": 50,
            tty: true,
          },
          ctx,
        ))
        const sessionID = String((started.metadata as any)?.sessionID)
        const completed = Tool.normalizeToolOutput(await writeRuntime.execute(
          {
            session_id: sessionID,
            chars: "yes\r",
            "yield-time_ms": 2_000,
          },
          ctx,
        ))

        expect(completed.metadata).toMatchObject({
          id: sessionID,
          processState: "exited",
          exitCode: 0,
          tty: true,
          inputChars: 4,
        })
        const output = String((completed.metadata as any)?.output ?? "")
        expect(output.toLowerCase()).toContain("tty:true")
        expect(output).toContain("got:yes")
      },
    })
  }, 120000)

  it("sends terminal Ctrl-C without force-killing a tty session that handles SIGINT", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        if (process.platform !== "darwin" && process.platform !== "win32") return
        const tool = process.platform === "darwin" ? MacOSShellCommandTool : PowerShellCommandTool
        const command = "node -e \"process.on('SIGINT',()=>console.log('interrupt-kept-alive'));console.log('ready');setInterval(()=>{},1000)\""
        const execRuntime = await tool.init()
        const writeRuntime = await WriteStdinTool.init()
        const ctx = {
          sessionID: "session-tty-interrupt-handler",
          messageID: "message-tty-interrupt-handler",
        }
        const started = Tool.normalizeToolOutput(await execRuntime.execute(
          {
            command,
            tty: true,
            "yield-time_ms": 500,
          },
          ctx,
        ))
        const sessionID = String((started.metadata as any)?.sessionID)
        const interrupted = Tool.normalizeToolOutput(await writeRuntime.execute(
          {
            session_id: sessionID,
            chars: "\x03",
            "yield-time_ms": 1_500,
          },
          ctx,
        ))

        expect(interrupted.metadata).toMatchObject({
          id: sessionID,
          tty: true,
          processState: "running",
          interrupted: true,
        })
        expect(String((interrupted.metadata as any)?.output ?? "")).toContain("interrupt-kept-alive")
        expect(interrupted.text).toContain("Session Information > Background Processes")
        await getShellTaskRegistry().stop(sessionID, ctx.sessionID)
      },
    })
  }, 120000)

  it("exposes the Codex-style write_stdin contract with input-sensitive permissions", async () => {
    const runtime = await WriteStdinTool.init()
    const shape = (runtime.parameters as z.ZodObject<any>).shape
    const ctx = {
      sessionID: "session-write-stdin-contract",
      messageID: "message-write-stdin-contract",
    }

    expect(Boolean(shape.session_id)).toBe(true)
    expect(Boolean(shape.chars)).toBe(true)
    expect(Boolean(shape["yield-time_ms"])).toBe(true)
    expect(Boolean(shape.max_output_tokens)).toBe(true)
    expect(runtime.description).toContain("empty chars")
    expect(runtime.description).toContain("Session Information > Background Processes")
    expect(WriteStdinTool.capabilities).toMatchObject({
      kind: "exec",
      readOnly: false,
      destructive: true,
      concurrency: "safe",
    })
    expect(await runtime.assessPermission!({ session_id: "tsk_test", chars: "" }, ctx)).toMatchObject({
      action: "allow",
      allowInPlanning: true,
    })
    expect(await runtime.assessPermission!({ session_id: "tsk_test", chars: "\x03" }, ctx)).toMatchObject({
      action: "allow",
      risk: "medium",
    })
    expect(await runtime.assessPermission!({ session_id: "tsk_test", chars: "yes\n" }, ctx)).toMatchObject({
      action: "ask",
      risk: "medium",
    })
  })

  it("classifies shell permission intent conservatively for each shell", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-shell-permission-"))

    try {
      await createGitRepo(repositoryRoot, "shell-permission")

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const cases = [
            {
              shell: "bash" as const,
              readonly: "ls -la",
              writeLike: "rm temporary.txt",
              dangerous: "rm -rf /",
              unknown: "custom-task --flag",
            },
            {
              shell: "posix" as const,
              readonly: "git status --short",
              writeLike: "touch temporary.txt",
              dangerous: "diskutil eraseDisk APFS Test /dev/disk9",
              unknown: "custom-task --flag",
            },
            {
              shell: "powershell" as const,
              readonly: "Get-ChildItem",
              writeLike: "Set-Content temporary.txt hello",
              dangerous: "Remove-Item -Recurse -Force C:\\",
              unknown: "Invoke-Build",
            },
            {
              shell: "cmd" as const,
              readonly: "dir",
              writeLike: "del temporary.txt",
              dangerous: "format c:",
              unknown: "custom-task /flag",
            },
            {
              shell: "wsl" as const,
              readonly: "cat README.md",
              writeLike: "npm install",
              dangerous: "mkfs.ext4 /dev/sda",
              unknown: "custom-task --flag",
            },
          ]

          for (const item of cases) {
            expect(assessShellPermission(item.shell, { command: item.readonly }, Instance.directory)).toMatchObject({
              action: "allow",
              risk: "low",
            })
            expect(assessShellPermission(item.shell, { command: item.dangerous }, Instance.directory)).toMatchObject({
              action: "deny",
              risk: "critical",
            })
            expect(assessShellPermission(item.shell, { command: item.writeLike }, Instance.directory)).toMatchObject({
              action: "allow",
              risk: "low",
            })
            expect(assessShellPermission(item.shell, { command: item.unknown }, Instance.directory)).toMatchObject({
              action: "ask",
              risk: "medium",
            })
          }

          expect(assessShellPermission("cmd", { command: "taskkill /F /IM Anybox.exe" }, Instance.directory)).toMatchObject({
            action: "deny",
            risk: "critical",
          })
          expect(assessShellPermission("powershell", { command: "Stop-Process -Name Anybox" }, Instance.directory)).toMatchObject({
            action: "deny",
            risk: "critical",
          })
          expect(assessShellPermission("bash", { command: `kill -9 ${process.ppid}` }, Instance.directory)).toMatchObject({
            action: "deny",
            risk: "critical",
          })

          await withProcessEnv(
            {
              ANYBOX_DESKTOP_PROCESS_ID: "424242",
              ANYBOX_PROTECTED_PROCESS_NAMES: "electron.exe",
            },
            async () => {
              expect(assessShellPermission("cmd", { command: "taskkill /PID %ANYBOX_DESKTOP_PROCESS_ID%" }, Instance.directory)).toMatchObject({
                action: "deny",
                risk: "critical",
              })
              expect(assessShellPermission("powershell", { command: "Stop-Process -Name electron" }, Instance.directory)).toMatchObject({
                action: "deny",
                risk: "critical",
              })
            },
          )
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  }, 120000)

  it("exposes shell tools with distinct schemas and capabilities", async () => {
    const tools = [
      {
        tool: GitBashCommandTool,
        id: "git_bash_command",
        title: "Git Bash",
        distro: false,
      },
      {
        tool: MacOSShellCommandTool,
        id: "macos_shell_command",
        title: "macOS Shell",
        distro: false,
      },
      {
        tool: PowerShellCommandTool,
        id: "powershell_command",
        title: "PowerShell",
        distro: false,
      },
      {
        tool: CmdCommandTool,
        id: "cmd_command",
        title: "Command Prompt",
        distro: false,
      },
      {
        tool: WslBashCommandTool,
        id: "wsl_bash_command",
        title: "WSL Bash",
        distro: true,
      },
    ]

    for (const item of tools) {
      const runtime = await item.tool.init()
      expect(item.tool.id).toBe(item.id)
      expect(item.tool.title).toBe(item.title)
      expect(item.tool.aliases ?? []).toEqual([])
      expect(item.tool.capabilities).toMatchObject({
        kind: "exec",
        readOnly: false,
        destructive: true,
        needsShell: true,
      })
      expect(runtime.title).toBe(item.title)
      expect(runtime.description).toBeString()

      const shape = (runtime.parameters as z.ZodObject<any>).shape
      expect(Boolean(shape.tty)).toBe(true)
      expect(shape.tty.parse(undefined)).toBe(item.id === "cmd_command")
      expect(Boolean(shape["yield-time_ms"])).toBe(true)
      expect(Boolean(shape.runInBackground)).toBe(true)
      expect(Boolean(shape.run_in_background)).toBe(true)
      expect(Boolean(shape.distro)).toBe(item.distro)
    }
  })

  it("runs Command Prompt through a pseudoconsole by default", async () => {
    if (process.platform !== "win32") return

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const runtime = await CmdCommandTool.init()
        const parameters = runtime.parameters.parse({
          command: "echo CMD 默认 PTY 中文正常",
          "yield-time_ms": 5_000,
        })
        expect(parameters.tty).toBe(true)

        const result = Tool.normalizeToolOutput(await runtime.execute(
          parameters,
          {
            sessionID: "session-cmd-default-pty",
            messageID: "message-cmd-default-pty",
          },
        ))

        expect(result.text).toContain("TERMINAL OUTPUT:")
        expect(result.text).not.toContain("STDOUT:")
        expect(result.metadata).toMatchObject({
          tty: true,
          exitCode: 0,
        })
        expect(String(result.metadata?.terminalOutput)).toContain("CMD 默认 PTY 中文正常")
      },
    })
  }, 120000)

  it("keeps PowerShell non-interactive by default and removes the flag for tty sessions", () => {
    expect(buildPowerShellArgs("python", false)).toContain("-NonInteractive")
    expect(buildPowerShellArgs("python", true)).not.toContain("-NonInteractive")
    expect(buildPowerShellArgs("Write-Output '你好'", false).at(-1)).toContain(
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    )
    expect(buildPowerShellArgs("Write-Output '你好'", false).at(-1)).toEndWith("Write-Output '你好'")
  })

  it("describes the exact cached PowerShell 7 runtime before the tool is called", async () => {
    let probes = 0
    const detector = createPowerShell7Detector({
      platform: "win32",
      env: { PATH: "C:\\Tools" },
      whichCommand: () => "C:\\Tools\\pwsh.exe",
      probe: async () => {
        probes += 1
        return {
          stdout: JSON.stringify({ version: "7.6.4", edition: "Core" }),
          stderr: "",
        }
      },
    })
    const tool = createPowerShellCommandTool(detector)

    const firstRuntime = await tool.init()
    const secondRuntime = await tool.init()

    expect(firstRuntime.description).toContain("Run commands using PowerShell 7.6.4 (Core).")
    expect(firstRuntime.description).toContain(
      "This tool only uses PowerShell 7 and never Windows PowerShell 5.1.",
    )
    expect(secondRuntime.description).toBe(firstRuntime.description)
    expect(probes).toBe(1)

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        await expect(firstRuntime.validate?.(
          { command: "$PSVersionTable", tty: false },
          { cwd: process.cwd() } as Tool.Context,
        )).resolves.toBeUndefined()
      },
    })
    expect(probes).toBe(1)

    const modelOutput = await firstRuntime.toModelOutput?.({
      text: "ok",
      metadata: {
        command: "$PSVersionTable",
        shell: "C:\\Tools\\pwsh.exe",
        shellVersion: "7.6.4",
        shellEdition: "Core",
        cwd: process.cwd(),
        displayCwd: ".",
        timeoutMs: null,
        exitCode: 0,
        signal: null,
        tty: false,
        timedOut: false,
        aborted: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdout: "ok",
        stderr: "",
        terminalOutput: "",
        terminalOutputTruncated: false,
      },
    })
    expect(modelOutput).toMatchObject({
      type: "json",
      value: {
        shell: "C:\\Tools\\pwsh.exe",
        shellVersion: "7.6.4",
        shellEdition: "Core",
      },
    })
  })

  it("keeps the PowerShell tool visible but unavailable without blocking other tools", async () => {
    const detector: PowerShell7Detector = {
      async detect() {
        return {
          available: false,
          message: POWERSHELL_7_INSTALL_MESSAGE,
          detail: "missing",
        }
      },
      async validate() {
        throw new Error("validate should not be called")
      },
    }
    const runtime = await createPowerShellCommandTool(detector).init()

    expect(runtime.description).toContain("PowerShell 7 is unavailable on this machine. Do not call this tool.")
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        await expect(runtime.validate?.(
          { command: "Write-Output ok", tty: false },
          { cwd: process.cwd() } as Tool.Context,
        )).resolves.toBe(POWERSHELL_7_INSTALL_MESSAGE)
      },
    })
    await expect(CmdCommandTool.init()).resolves.toMatchObject({
      title: "Command Prompt",
    })
  })

  it("selects one-time shell tools by host platform", () => {
    expect(ToolRegistry.builtinShellToolsForPlatform("darwin").map((tool) => tool.id)).toEqual([
      "macos_shell_command",
    ])
    expect(ToolRegistry.builtinShellToolsForPlatform("win32").map((tool) => tool.id)).toEqual([
      "git_bash_command",
      "powershell_command",
      "cmd_command",
      "wsl_bash_command",
    ])
    expect(ToolRegistry.builtinShellToolsForPlatform("linux").map((tool) => tool.id)).toEqual([])
  })

  it("does not expose the user-owned interactive terminal as Agent tools", async () => {
    const toolIDs = (await ToolRegistry.builtinTools()).map((tool) => tool.id)

    expect(toolIDs).not.toContain("terminal_run_command")
    expect(toolIDs).not.toContain("terminal_read")
    expect(toolIDs).not.toContain("terminal_write_input")
  })

  it("resolves shell executables by shell-specific Windows rules", async () => {
    const gitBash = await resolveGitBashExecutable({
      platform: "win32",
      configuredGitBashPath: null,
      env: {
        PATH: "C:\\WINDOWS\\System32",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      },
      whichCommand: (command) => {
        if (command === "git.exe" || command === "git") {
          return "C:\\Apps\\Git\\cmd\\git.exe"
        }

        if (command === "bash" || command === "bash.exe") {
          return "C:\\WINDOWS\\System32\\bash.exe"
        }

        return null
      },
      isFile: async (filePath) => filePath === "C:\\Apps\\Git\\bin\\bash.exe",
    })

    expect(gitBash).toBe("C:\\Apps\\Git\\bin\\bash.exe")

    const powershell = await resolvePowerShellExecutable({
      platform: "win32",
      env: {
        ProgramFiles: "C:\\Program Files",
      },
      whichCommand: () => null,
      isFile: async (filePath) => filePath === "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
      probe: async () => ({
        stdout: JSON.stringify({ version: "7.6.4", edition: "Core" }),
        stderr: "",
      }),
    })
    expect(powershell).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe")

    const cmd = await resolveCmdExecutable({
      platform: "win32",
      env: {
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
      },
      whichCommand: () => null,
      isFile: async (filePath) => filePath === "C:\\Windows\\System32\\cmd.exe",
    })
    expect(cmd).toBe("C:\\Windows\\System32\\cmd.exe")

    const wsl = await resolveWslExecutable({
      platform: "win32",
      env: {
        SystemRoot: "C:\\Windows",
      },
      whichCommand: () => null,
      isFile: async (filePath) => filePath === "C:\\Windows\\System32\\wsl.exe",
    })
    expect(wsl).toBe("C:\\Windows\\System32\\wsl.exe")

    await expect(
      resolveGitBashExecutable({
        platform: "win32",
        configuredGitBashPath: null,
        env: {},
        whichCommand: (command) => {
          if (command === "bash" || command === "bash.exe") {
            return "C:\\WINDOWS\\System32\\bash.exe"
          }

          return null
        },
        isFile: async (filePath) => filePath === "C:\\WINDOWS\\System32\\bash.exe",
      }),
    ).rejects.toThrow("No Git Bash executable was found")
  })

  it("resolves macOS shell executables and preserves Homebrew PATH entries", async () => {
    const configured = await resolveMacOSShellExecutable({
      platform: "darwin",
      env: {
        ANYBOX_MACOS_SHELL: "/custom/zsh",
        SHELL: "/bin/zsh",
      },
      whichCommand: () => null,
      isFile: async (filePath) => filePath === "/custom/zsh",
    })
    expect(configured).toBe("/custom/zsh")

    const fromShellEnv = await resolveMacOSShellExecutable({
      platform: "darwin",
      env: {
        SHELL: "/bin/fish",
      },
      whichCommand: () => null,
      isFile: async (filePath) => filePath === "/bin/fish",
    })
    expect(fromShellEnv).toBe("/bin/fish")

    const fallback = await resolveMacOSShellExecutable({
      platform: "darwin",
      env: {},
      whichCommand: () => null,
      isFile: async (filePath) => filePath === "/bin/zsh",
    })
    expect(fallback).toBe("/bin/zsh")

    await expect(
      resolveMacOSShellExecutable({
        platform: "darwin",
        env: {},
        whichCommand: () => null,
        isFile: async () => false,
      }),
    ).rejects.toThrow("No macOS shell executable was found")

    const env = buildPtyEnvironment("/tmp/project", "/bin/zsh")
    if (process.platform === "darwin") {
      const pathSegments = (env.PATH ?? "").split(":")
      expect(pathSegments).toContain("/opt/homebrew/bin")
      expect(pathSegments).toContain("/usr/local/bin")
    }
  })

  it("replays completed tool history through the tool model output formatter", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-tool-history-"))

    try {
      await createGitRepo(repositoryRoot, "tool-history")

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const shellToolID = platformShellToolID()
          if (!shellToolID) return
          const model = {
            capabilities: {
              reasoning: false,
              attachment: true,
              toolcall: true,
            },
          } as any

          const messages = await Message.toModelMessages(
            [
              {
                info: {
                  id: "assistant-history",
                  sessionID: "session-history",
                  role: "assistant",
                  created: Date.now(),
                  parentID: "user-history",
                  modelID: "test-model",
                  providerID: "test-provider",
                  agent: "plan",
                  path: {
                    cwd: repositoryRoot,
                    root: repositoryRoot,
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
                } as Message.Assistant,
                parts: [
                  {
                    id: "tool-history",
                    sessionID: "session-history",
                    messageID: "assistant-history",
                    type: "tool",
                    callID: "call-history",
                    tool: shellToolID,
                    schemaVersion: 3,
                    turnID: "turn-test",
                    input: { raw: JSON.stringify({ command: "printf hello" }), value: { command: "printf hello" } },
                    source: { kind: "model" },
                    retry: { attempt: 1 },
                    revision: 1,
                    timestamps: { createdAt: 1, settledAt: 2 },
                    state: { phase: "settled", outcome: { kind: "returned", result: "success", completeness: "complete", output: "Command: printf hello", title: `${shellToolID}: printf hello`, metadata: {
                        command: "printf hello",
                        shell: "/bin/bash",
                        cwd: repositoryRoot,
                        displayCwd: ".",
                        timeoutMs: 60_000,
                        exitCode: 0,
                        signal: null,
                        timedOut: false,
                        aborted: false,
                        stdoutTruncated: false,
                        stderrTruncated: false,
                        stdout: "hello",
                        stderr: "",
                        runInBackground: false,
                        backgroundTaskId: null,
                      }, execution: { sideEffect: "unknown", retry: "unknown" } }, control: { mode: "continue-model" } },
                  } as Message.ToolPart,
                ],
              },
            ],
            model,
          )

          const assistantMessage = messages.find((item) => item.role === "assistant") as any
          const toolCall = assistantMessage?.content.find(
            (item: any) => item.type === "tool-call" && item.toolCallId === "call-history",
          )
          const toolMessage = messages.find((item) => item.role === "tool") as any
          expect(toolCall).toMatchObject({
            type: "tool-call",
            toolCallId: "call-history",
            toolName: shellToolID,
            input: {
              command: "printf hello",
            },
          })
          expect(toolMessage).toBeDefined()
          expect(toolMessage.content).toHaveLength(1)
          const toolResult = toolMessage.content.find((item: any) => item.toolName === shellToolID)
          expect(toolResult).toMatchObject({
            type: "tool-result",
            toolCallId: "call-history",
            toolName: shellToolID,
            output: {
              type: "json",
              value: {
                result: "success",
                completeness: "complete",
                processState: "settled",
                stdout: "hello",
                runInBackground: false,
                backgroundTaskId: null,
              },
            },
          })
          expect(toolResult.output.value).not.toHaveProperty("title")
          expect(toolResult.output.value).not.toHaveProperty("command")
          expect(JSON.stringify(messages).match(/printf hello/g)).toHaveLength(1)
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  }, 120000)

  it("maps user image and file parts to the AI SDK multimodal shape", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: true,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "user-multimodal",
            sessionID: "session-multimodal",
            role: "user",
            created: Date.now(),
            agent: "plan",
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
          } as Message.User,
          parts: [
            {
              id: "part-1",
              sessionID: "session-multimodal",
              messageID: "user-multimodal",
              type: "text",
              text: "Describe these references.",
            } as Message.TextPart,
            {
              id: "part-2",
              sessionID: "session-multimodal",
              messageID: "user-multimodal",
              type: "image",
              mime: "image/png",
              filename: "hero.png",
              url: "data:image/png;base64,aGVsbG8=",
            } as Message.ImagePart,
            {
              id: "part-3",
              sessionID: "session-multimodal",
              messageID: "user-multimodal",
              type: "file",
              mime: "application/pdf",
              filename: "brief.pdf",
              url: "data:application/pdf;base64,aGVsbG8=",
            } as Message.FilePart,
          ],
        },
      ],
      model,
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe("user")
    const content = messages[0]?.content
    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) throw new Error("Expected user content array")

    expect(content[0]).toMatchObject({
      type: "text",
      text: "Describe these references.",
    })

    const imagePart = content[1] as { image?: unknown; mediaType?: string; type?: string }
    expect(imagePart).toMatchObject({
      type: "image",
      mediaType: "image/png",
    })
    expect(imagePart.image).toBeInstanceOf(Uint8Array)
    expect(imagePart.image).not.toBe("data:image/png;base64,aGVsbG8=")
    expect(Buffer.from(imagePart.image as Uint8Array).toString("utf8")).toBe("hello")

    const filePart = content[2] as { data?: unknown; filename?: string; mediaType?: string; type?: string }
    expect(filePart).toMatchObject({
      type: "file",
      filename: "brief.pdf",
      mediaType: "application/pdf",
    })
    expect(filePart.data).toBeInstanceOf(Uint8Array)
    expect(filePart.data).not.toBe("data:application/pdf;base64,aGVsbG8=")
    expect(Buffer.from(filePart.data as Uint8Array).toString("utf8")).toBe("hello")
  })

  it("maps assistant image parts to AI SDK file parts for replay", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: false,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "assistant-image-output",
            sessionID: "session-assistant-image",
            role: "assistant",
            created: Date.now(),
            agent: "default",
            model: {
              providerID: "google",
              modelID: "gemini-3-pro-image-preview",
            },
          } as unknown as Message.Assistant,
          parts: [
            {
              id: "part-1",
              sessionID: "session-assistant-image",
              messageID: "assistant-image-output",
              type: "text",
              text: "Generated an image.",
            } as Message.TextPart,
            {
              id: "part-2",
              sessionID: "session-assistant-image",
              messageID: "assistant-image-output",
              type: "image",
              mime: "image/jpeg",
              filename: "kitten.jpg",
              url: "data:image/jpeg;base64,aGVsbG8=",
            } as Message.ImagePart,
          ],
        },
      ],
      model,
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe("assistant")
    const content = messages[0]?.content
    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) throw new Error("Expected assistant content array")

    const filePart = content[1] as { data?: unknown; filename?: string; mediaType?: string; type?: string }
    expect(filePart).toMatchObject({
      type: "file",
      filename: "kitten.jpg",
      mediaType: "image/jpeg",
    })
    expect(filePart.data).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(filePart.data as Uint8Array).toString("utf8")).toBe("hello")
    expect(assistantModelMessageSchema.safeParse(messages[0]).success).toBe(true)
  })

  it("keeps only the latest historical image for image-output models by default", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: false,
        },
        output: {
          image: true,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "old-user",
            sessionID: "session-image-window",
            role: "user",
            created: Date.now(),
            agent: "default",
            model: { providerID: "google", modelID: "gemini-3-pro-image-preview" },
          } as Message.User,
          parts: [
            {
              id: "part-1",
              sessionID: "session-image-window",
              messageID: "old-user",
              type: "image",
              mime: "image/png",
              filename: "old.png",
              url: "data:image/png;base64,b2xk",
            } as Message.ImagePart,
          ],
        },
        {
          info: {
            id: "middle-assistant",
            sessionID: "session-image-window",
            role: "assistant",
            created: Date.now(),
            agent: "default",
            modelID: "gemini-3-pro-image-preview",
            providerID: "google",
          } as unknown as Message.Assistant,
          parts: [
            {
              id: "part-2",
              sessionID: "session-image-window",
              messageID: "middle-assistant",
              type: "image",
              mime: "image/jpeg",
              filename: "middle.jpg",
              url: "data:image/jpeg;base64,bWlk",
            } as Message.ImagePart,
          ],
        },
        {
          info: {
            id: "latest-user",
            sessionID: "session-image-window",
            role: "user",
            created: Date.now(),
            agent: "default",
            model: { providerID: "google", modelID: "gemini-3-pro-image-preview" },
          } as Message.User,
          parts: [
            {
              id: "part-3",
              sessionID: "session-image-window",
              messageID: "latest-user",
              type: "image",
              mime: "image/png",
              filename: "latest.png",
              url: "data:image/png;base64,bGF0ZXN0",
            } as Message.ImagePart,
          ],
        },
      ],
      model,
    )

    expect(messages).toHaveLength(3)
    const oldContent = messages[0]?.content
    const middleContent = messages[1]?.content
    const latestContent = messages[2]?.content
    if (!Array.isArray(oldContent) || !Array.isArray(middleContent) || !Array.isArray(latestContent)) {
      throw new Error("Expected content arrays")
    }

    expect(oldContent[0]).toMatchObject({
      type: "text",
      text: "Earlier image omitted from model input due to the image history window: mime=image/png, filename=old.png.",
    })
    expect(middleContent[0]).toMatchObject({
      type: "text",
      text: "Earlier image omitted from model input due to the image history window: mime=image/jpeg, filename=middle.jpg.",
    })

    const latestImage = latestContent[0] as { image?: unknown; mediaType?: string; type?: string }
    expect(latestImage).toMatchObject({
      type: "image",
      mediaType: "image/png",
    })
    expect(Buffer.from(latestImage.image as Uint8Array).toString("utf8")).toBe("latest")
  })

  it("preserves all current-turn images while keeping one historical image", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: false,
        },
        output: {
          image: true,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "old-user",
            sessionID: "session-current-images",
            role: "user",
            created: Date.now(),
            agent: "default",
            model: { providerID: "google", modelID: "gemini-3-pro-image-preview" },
          } as Message.User,
          parts: [
            {
              id: "part-1",
              sessionID: "session-current-images",
              messageID: "old-user",
              type: "image",
              mime: "image/png",
              filename: "old.png",
              url: "data:image/png;base64,b2xk",
            } as Message.ImagePart,
          ],
        },
        {
          info: {
            id: "recent-assistant",
            sessionID: "session-current-images",
            role: "assistant",
            created: Date.now(),
            agent: "default",
            modelID: "gemini-3-pro-image-preview",
            providerID: "google",
          } as unknown as Message.Assistant,
          parts: [
            {
              id: "part-2",
              sessionID: "session-current-images",
              messageID: "recent-assistant",
              type: "image",
              mime: "image/jpeg",
              filename: "recent.jpg",
              url: "data:image/jpeg;base64,cmVjZW50",
            } as Message.ImagePart,
          ],
        },
        {
          info: {
            id: "current-user",
            sessionID: "session-current-images",
            role: "user",
            created: Date.now(),
            agent: "default",
            model: { providerID: "google", modelID: "gemini-3-pro-image-preview" },
          } as Message.User,
          parts: [
            {
              id: "part-3",
              sessionID: "session-current-images",
              messageID: "current-user",
              type: "image",
              mime: "image/png",
              filename: "reference-a.png",
              url: "data:image/png;base64,cmVmLWE=",
            } as Message.ImagePart,
            {
              id: "part-4",
              sessionID: "session-current-images",
              messageID: "current-user",
              type: "image",
              mime: "image/png",
              filename: "reference-b.png",
              url: "data:image/png;base64,cmVmLWI=",
            } as Message.ImagePart,
          ],
        },
      ],
      model,
      {
        imageWindow: {
          maxHistoricalImageParts: 1,
          preserveAllImagePartsForMessageID: "current-user",
        },
      },
    )

    const oldContent = messages[0]?.content
    const recentContent = messages[1]?.content
    const currentContent = messages[2]?.content
    if (!Array.isArray(oldContent) || !Array.isArray(recentContent) || !Array.isArray(currentContent)) {
      throw new Error("Expected content arrays")
    }

    expect(oldContent[0]).toMatchObject({
      type: "text",
      text: "Earlier image omitted from model input due to the image history window: mime=image/png, filename=old.png.",
    })
    expect(recentContent[0]).toMatchObject({
      type: "file",
      filename: "recent.jpg",
      mediaType: "image/jpeg",
    })
    expect(Buffer.from((recentContent[0] as { data?: Uint8Array }).data as Uint8Array).toString("utf8")).toBe("recent")
    expect(currentContent[0]).toMatchObject({ type: "image", mediaType: "image/png" })
    expect(currentContent[1]).toMatchObject({ type: "image", mediaType: "image/png" })
    expect(Buffer.from((currentContent[0] as { image?: Uint8Array }).image as Uint8Array).toString("utf8")).toBe("ref-a")
    expect(Buffer.from((currentContent[1] as { image?: Uint8Array }).image as Uint8Array).toString("utf8")).toBe("ref-b")
  })

  it("does not decode omitted images", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        output: {
          image: true,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "old-user",
            sessionID: "session-invalid-omitted-image",
            role: "user",
            created: Date.now(),
            agent: "default",
            model: { providerID: "google", modelID: "gemini-3-pro-image-preview" },
          } as Message.User,
          parts: [
            {
              id: "part-1",
              sessionID: "session-invalid-omitted-image",
              messageID: "old-user",
              type: "image",
              mime: "image/png",
              filename: "invalid.png",
              url: "data:image/png;base64,",
            } as Message.ImagePart,
          ],
        },
      ],
      model,
      {
        imageWindow: {
          maxHistoricalImageParts: 0,
        },
      },
    )

    const content = messages[0]?.content
    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) throw new Error("Expected content array")
    expect(content[0]).toMatchObject({
      type: "text",
      text: "Earlier image omitted from model input due to the image history window: mime=image/png, filename=invalid.png.",
    })
  })

  it("counts image files in the image window without affecting ordinary files", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: false,
        },
        output: {
          image: true,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "mixed-user",
            sessionID: "session-image-file-window",
            role: "user",
            created: Date.now(),
            agent: "default",
            model: { providerID: "google", modelID: "gemini-3-pro-image-preview" },
          } as Message.User,
          parts: [
            {
              id: "part-1",
              sessionID: "session-image-file-window",
              messageID: "mixed-user",
              type: "file",
              mime: "image/webp",
              filename: "old-reference.webp",
              url: "data:image/webp;base64,",
            } as Message.FilePart,
            {
              id: "part-2",
              sessionID: "session-image-file-window",
              messageID: "mixed-user",
              type: "image",
              mime: "image/png",
              filename: "latest-reference.png",
              url: "data:image/png;base64,bGF0ZXN0",
            } as Message.ImagePart,
            {
              id: "part-3",
              sessionID: "session-image-file-window",
              messageID: "mixed-user",
              type: "file",
              mime: "text/plain",
              filename: "note.txt",
              url: "data:text/plain;base64,aGVsbG8=",
            } as Message.FilePart,
          ],
        },
      ],
      model,
    )

    const content = messages[0]?.content
    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) throw new Error("Expected content array")
    expect(content[0]).toMatchObject({
      type: "text",
      text: "Earlier image omitted from model input due to the image history window: mime=image/webp, filename=old-reference.webp.",
    })
    expect(content[1]).toMatchObject({ type: "image", mediaType: "image/png" })
    expect(Buffer.from((content[1] as { image?: Uint8Array }).image as Uint8Array).toString("utf8")).toBe("latest")
    expect(content[2]).toMatchObject({
      type: "file",
      filename: "note.txt",
      mediaType: "text/plain",
    })
    expect(Buffer.from((content[2] as { data?: Uint8Array }).data as Uint8Array).toString("utf8")).toBe("hello")
  })

  it("does not enable the image window by default for non-image-output models", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: false,
        },
        output: {
          image: false,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "old-user",
            sessionID: "session-no-default-window",
            role: "user",
            created: Date.now(),
            agent: "default",
            model: { providerID: "test-provider", modelID: "text-vision-model" },
          } as Message.User,
          parts: [
            {
              id: "part-1",
              sessionID: "session-no-default-window",
              messageID: "old-user",
              type: "image",
              mime: "image/png",
              filename: "old.png",
              url: "data:image/png;base64,b2xk",
            } as Message.ImagePart,
          ],
        },
        {
          info: {
            id: "latest-user",
            sessionID: "session-no-default-window",
            role: "user",
            created: Date.now(),
            agent: "default",
            model: { providerID: "test-provider", modelID: "text-vision-model" },
          } as Message.User,
          parts: [
            {
              id: "part-2",
              sessionID: "session-no-default-window",
              messageID: "latest-user",
              type: "image",
              mime: "image/png",
              filename: "latest.png",
              url: "data:image/png;base64,bGF0ZXN0",
            } as Message.ImagePart,
          ],
        },
      ],
      model,
    )

    const oldContent = messages[0]?.content
    const latestContent = messages[1]?.content
    if (!Array.isArray(oldContent) || !Array.isArray(latestContent)) throw new Error("Expected content arrays")
    expect(oldContent[0]).toMatchObject({ type: "image", mediaType: "image/png" })
    expect(latestContent[0]).toMatchObject({ type: "image", mediaType: "image/png" })
    expect(Buffer.from((oldContent[0] as { image?: Uint8Array }).image as Uint8Array).toString("utf8")).toBe("old")
    expect(Buffer.from((latestContent[0] as { image?: Uint8Array }).image as Uint8Array).toString("utf8")).toBe("latest")
  })

  it("replays assistant reasoning parts into subsequent model context by default", async () => {
    const model = {
      capabilities: {
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "assistant-reasoning-history",
            sessionID: "session-reasoning-history",
            role: "assistant",
            created: Date.now(),
            parentID: "user-reasoning-history",
            modelID: "test-model",
            providerID: "test-provider",
            agent: "plan",
            path: {
              cwd: ".",
              root: ".",
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
          } as Message.Assistant,
          parts: [
            {
              id: "assistant-reasoning-text",
              sessionID: "session-reasoning-history",
              messageID: "assistant-reasoning-history",
              type: "text",
              text: "Final answer",
            } as Message.TextPart,
            {
              id: "assistant-reasoning-part",
              sessionID: "session-reasoning-history",
              messageID: "assistant-reasoning-history",
              type: "reasoning",
              text: "Hidden chain-of-thought",
              time: {
                start: Date.now(),
              },
            } as Message.ReasoningPart,
          ],
        },
      ],
      model,
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "Hidden chain-of-thought",
        },
        {
          type: "text",
          text: "Final answer",
        },
      ],
    })
  })

  it("does not replay assistant reasoning when the model explicitly opts out", async () => {
    const model = {
      capabilities: {
        reasoning: true,
        replayAssistantReasoning: false,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "assistant-reasoning-opt-out-history",
            sessionID: "session-reasoning-opt-out-history",
            role: "assistant",
            created: Date.now(),
            parentID: "user-reasoning-opt-out-history",
            modelID: "test-model",
            providerID: "test-provider",
            agent: "plan",
            path: {
              cwd: ".",
              root: ".",
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
          } as Message.Assistant,
          parts: [
            {
              id: "assistant-reasoning-opt-out-text",
              sessionID: "session-reasoning-opt-out-history",
              messageID: "assistant-reasoning-opt-out-history",
              type: "text",
              text: "Final answer",
            } as Message.TextPart,
            {
              id: "assistant-reasoning-opt-out-part",
              sessionID: "session-reasoning-opt-out-history",
              messageID: "assistant-reasoning-opt-out-history",
              type: "reasoning",
              text: "Hidden chain-of-thought",
              time: {
                start: Date.now(),
              },
            } as Message.ReasoningPart,
          ],
        },
      ],
      model,
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Final answer",
        },
      ],
    })
    expect((messages[0] as any).content).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reasoning",
        }),
      ]),
    )
  })

  it("replays assistant reasoning parts for models that require reasoning_content", async () => {
    const model = {
      id: "deepseek-reasoner",
      providerID: "deepseek",
      api: {
        id: "deepseek-reasoner",
        url: "https://api.deepseek.com",
        npm: "@ai-sdk/deepseek",
      },
      capabilities: {
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: {
          field: "reasoning_content",
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "assistant-required-reasoning-history",
            sessionID: "session-required-reasoning-history",
            role: "assistant",
            created: Date.now(),
            parentID: "user-required-reasoning-history",
            modelID: "deepseek-reasoner",
            providerID: "deepseek",
            agent: "plan",
            path: {
              cwd: ".",
              root: ".",
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
          } as Message.Assistant,
          parts: [
            {
              id: "assistant-required-reasoning-1",
              sessionID: "session-required-reasoning-history",
              messageID: "assistant-required-reasoning-history",
              type: "text",
              text: "Final answer",
            } as Message.TextPart,
            {
              id: "assistant-required-reasoning-2",
              sessionID: "session-required-reasoning-history",
              messageID: "assistant-required-reasoning-history",
              type: "reasoning",
              text: "Required reasoning context",
              time: {
                start: Date.now(),
              },
            } as Message.ReasoningPart,
          ],
        },
      ],
      model,
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Final answer",
        },
        {
          type: "reasoning",
          text: "Required reasoning context",
        },
      ],
    })
  })

  it("keeps reasoning and tool-call history in the same assistant message for reasoning_content models", async () => {
    const model = {
      id: "deepseek-reasoner",
      providerID: "deepseek",
      api: {
        id: "deepseek-reasoner",
        url: "https://api.deepseek.com",
        npm: "@ai-sdk/deepseek",
      },
      capabilities: {
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: {
          field: "reasoning_content",
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "assistant-reasoning-tool-history",
            sessionID: "session-reasoning-tool-history",
            role: "assistant",
            created: Date.now(),
            parentID: "user-reasoning-tool-history",
            modelID: "deepseek-reasoner",
            providerID: "deepseek",
            agent: "plan",
            path: {
              cwd: ".",
              root: ".",
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
          } as Message.Assistant,
          parts: [
            {
              id: "assistant-reasoning-tool-1",
              sessionID: "session-reasoning-tool-history",
              messageID: "assistant-reasoning-tool-history",
              type: "reasoning",
              text: "Need to inspect the file before answering.",
              time: {
                start: Date.now(),
              },
            } as Message.ReasoningPart,
            {
              id: "assistant-reasoning-tool-2",
              sessionID: "session-reasoning-tool-history",
              messageID: "assistant-reasoning-tool-history",
              type: "tool",
              callID: "call-reasoning-tool",
              tool: "read-file",
              schemaVersion: 3,
              turnID: "turn-test",
              input: { raw: JSON.stringify({
                  path: "README.md",
                }), value: {
                  path: "README.md",
                } },
              source: { kind: "model" },
              retry: { attempt: 1 },
              revision: 1,
              timestamps: { createdAt: Date.now(), approvalRequestedAt: Date.now() },
              state: { phase: "waiting-approval", approval: { id: "approval-reasoning-tool" } },
            } as Message.ToolPart,
          ],
        },
      ],
      model,
    )

    const assistantMessages = messages.filter((item) => item.role === "assistant") as any[]
    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]?.content).toEqual([
      {
        type: "reasoning",
        text: "Need to inspect the file before answering.",
      },
      {
        type: "tool-call",
        toolCallId: "call-reasoning-tool",
        toolName: "read_file",
        input: {
          path: "README.md",
        },
      },
    ])
  })

  it("replays legacy parallel tool history with the provider-safe model-facing name", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "assistant-legacy-parallel-history",
            sessionID: "session-legacy-parallel-history",
            role: "assistant",
            created: Date.now(),
            parentID: "user-legacy-parallel-history",
            modelID: "deepseek-v4-pro",
            providerID: "deepseek",
            agent: "plan",
            path: {
              cwd: ".",
              root: ".",
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
          } as Message.Assistant,
          parts: [
            {
              id: "assistant-legacy-parallel-tool",
              sessionID: "session-legacy-parallel-history",
              messageID: "assistant-legacy-parallel-history",
              type: "tool",
              callID: "call-legacy-parallel",
              tool: "multi_tool_use.parallel",
              schemaVersion: 3,
              turnID: "turn-test",
              input: { raw: JSON.stringify({
                  calls: [{ tool: "read-file", input: { path: "README.md" } }],
                }), value: {
                  calls: [{ tool: "read-file", input: { path: "README.md" } }],
                } },
              source: { kind: "model" },
              retry: { attempt: 1 },
              revision: 1,
              timestamps: { createdAt: 1, settledAt: 2 },
              state: { phase: "settled", outcome: { kind: "denied", reason: "approval denied", approvalID: "approval-test", execution: { sideEffect: "none", retry: "safe" } }, control: { mode: "continue-model" } },
            } as Message.ToolPart,
          ],
        },
      ],
      model,
    )

    const assistantMessage = messages.find((item) => item.role === "assistant") as any
    expect(assistantMessage.content).toEqual([
      {
        type: "tool-call",
        toolCallId: "call-legacy-parallel",
        toolName: "multi_tool_use_parallel",
        input: {
          calls: [{ tool: "read-file", input: { path: "README.md" } }],
        },
      },
    ])

    const toolMessage = messages.find((item) => item.role === "tool") as any
    expect(toolMessage.content).toEqual([
      {
        type: "tool-result",
        toolCallId: "call-legacy-parallel",
        toolName: "multi_tool_use_parallel",
        output: {
          type: "execution-denied",
          reason: "approval denied",
        },
      },
    ])
  })

  it("keeps multiple tool calls in the same assistant message for reasoning_content models", async () => {
    const model = {
      id: "deepseek-reasoner",
      providerID: "deepseek",
      api: {
        id: "deepseek-reasoner",
        url: "https://api.deepseek.com",
        npm: "@ai-sdk/deepseek",
      },
      capabilities: {
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: {
          field: "reasoning_content",
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "assistant-multi-tool-history",
            sessionID: "session-multi-tool-history",
            role: "assistant",
            created: Date.now(),
            parentID: "user-multi-tool-history",
            modelID: "deepseek-reasoner",
            providerID: "deepseek",
            agent: "plan",
            path: {
              cwd: ".",
              root: ".",
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
          } as Message.Assistant,
          parts: [
            {
              id: "assistant-multi-tool-1",
              sessionID: "session-multi-tool-history",
              messageID: "assistant-multi-tool-history",
              type: "reasoning",
              text: "Need two reads before answering.",
              time: {
                start: Date.now(),
              },
            } as Message.ReasoningPart,
            {
              id: "assistant-multi-tool-2",
              sessionID: "session-multi-tool-history",
              messageID: "assistant-multi-tool-history",
              type: "tool",
              callID: "call-multi-tool-a",
              tool: "read-file",
              schemaVersion: 3,
              turnID: "turn-test",
              input: { raw: JSON.stringify({
                  path: "README.md",
                }), value: {
                  path: "README.md",
                } },
              source: { kind: "model" },
              retry: { attempt: 1 },
              revision: 1,
              timestamps: { createdAt: Date.now(), approvalRequestedAt: Date.now() },
              state: { phase: "waiting-approval", approval: { id: "approval-multi-tool-a" } },
            } as Message.ToolPart,
            {
              id: "assistant-multi-tool-3",
              sessionID: "session-multi-tool-history",
              messageID: "assistant-multi-tool-history",
              type: "tool",
              callID: "call-multi-tool-b",
              tool: "glob",
              schemaVersion: 3,
              turnID: "turn-test",
              input: { raw: JSON.stringify({
                  pattern: "*.ts",
                }), value: {
                  pattern: "*.ts",
                } },
              source: { kind: "model" },
              retry: { attempt: 1 },
              revision: 1,
              timestamps: { createdAt: Date.now(), approvalRequestedAt: Date.now() },
              state: { phase: "waiting-approval", approval: { id: "approval-multi-tool-b" } },
            } as Message.ToolPart,
          ],
        },
      ],
      model,
    )

    const assistantMessages = messages.filter((item) => item.role === "assistant") as any[]
    expect(assistantMessages).toHaveLength(1)
    expect(assistantMessages[0]?.content).toEqual([
      {
        type: "reasoning",
        text: "Need two reads before answering.",
      },
      {
        type: "tool-call",
        toolCallId: "call-multi-tool-a",
        toolName: "read_file",
        input: {
          path: "README.md",
        },
      },
      {
        type: "tool-call",
        toolCallId: "call-multi-tool-b",
        toolName: "glob",
        input: {
          pattern: "*.ts",
        },
      },
    ])
  })

  it("fails fast with a clear error when the model does not support image input", async () => {
    const model = {
      id: "deepseek-chat",
      providerID: "deepseek",
      capabilities: {
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
    } as any

    await expect(
      Message.toModelMessages(
        [
          {
            info: {
              id: "user-image-unsupported",
              sessionID: "session-image-unsupported",
              role: "user",
              created: Date.now(),
              agent: "plan",
              model: {
                providerID: "deepseek",
                modelID: "deepseek-chat",
              },
            } as Message.User,
            parts: [
              {
                id: "part-1",
                sessionID: "session-image-unsupported",
                messageID: "user-image-unsupported",
                type: "image",
                mime: "image/png",
                filename: "hero.png",
                url: "data:image/png;base64,aGVsbG8=",
              } as Message.ImagePart,
            ],
          },
        ],
        model,
      ),
    ).rejects.toThrow("does not support image input")
  })

  it("accepts image parts when the model supports image input without generic attachments", async () => {
    const model = {
      id: "qwen-vl-max",
      providerID: "alibaba-cn",
      capabilities: {
        reasoning: false,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: false,
        },
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "user-image-supported",
            sessionID: "session-image-supported",
            role: "user",
            created: Date.now(),
            agent: "plan",
            model: {
              providerID: "alibaba-cn",
              modelID: "qwen-vl-max",
            },
          } as Message.User,
          parts: [
            {
              id: "part-1",
              sessionID: "session-image-supported",
              messageID: "user-image-supported",
              type: "image",
              mime: "image/png",
              filename: "hero.png",
              url: "data:image/png;base64,aGVsbG8=",
            } as Message.ImagePart,
          ],
        },
      ],
      model,
    )

    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe("user")
    const content = messages[0]?.content
    expect(Array.isArray(content)).toBe(true)
    if (!Array.isArray(content)) throw new Error("Expected user content array")

    const imagePart = content[0] as { image?: unknown; mediaType?: string; type?: string }
    expect(imagePart).toMatchObject({
      type: "image",
      mediaType: "image/png",
    })
    expect(imagePart.image).toBeInstanceOf(Uint8Array)
    expect(imagePart.image).not.toBe("data:image/png;base64,aGVsbG8=")
  })

  it("replays provider-executed MCP history on the assistant message", async () => {
    const model = {
      capabilities: {
        reasoning: false,
        attachment: false,
        toolcall: true,
      },
    } as any

    const messages = await Message.toModelMessages(
      [
        {
          info: {
            id: "assistant-provider-executed",
            sessionID: "session-provider-executed",
            role: "assistant",
            created: Date.now(),
            parentID: "user-provider-executed",
            modelID: "gpt-5",
            providerID: "openai",
            agent: "plan",
            path: {
              cwd: ".",
              root: ".",
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
          } as Message.Assistant,
          parts: [
            {
              id: "provider-executed-tool",
              sessionID: "session-provider-executed",
              messageID: "assistant-provider-executed",
              type: "tool",
              callID: "call-provider-executed",
              tool: "mcp.remote-search",
              schemaVersion: 3,
              turnID: "turn-test",
              input: { raw: JSON.stringify({
                  query: "latest ai news",
                }), value: {
                  query: "latest ai news",
                } },
              source: { kind: "provider", metadata: {
                  openai: {
                    itemId: "item-1",
                  },
                } },
              retry: { attempt: 1 },
              revision: 1,
              timestamps: { createdAt: 1, settledAt: 2 },
              state: { phase: "settled", outcome: { kind: "returned", result: "success", completeness: "complete", output: "headline results", modelOutput: {
                  type: "call",
                  serverLabel: "remote-search",
                  name: "search",
                  arguments: "{\"query\":\"latest ai news\"}",
                  output: "headline results",
                }, title: "Remote Search", execution: { sideEffect: "unknown", retry: "unknown" } }, control: { mode: "continue-model" } },
            } as Message.ToolPart,
          ],
        },
      ],
      model,
    )

    const assistantMessage = messages.find((item) => item.role === "assistant") as any
    expect(assistantMessage).toBeDefined()
    expect(assistantMessage.content).toEqual([
      {
        type: "tool-call",
        toolCallId: "call-provider-executed",
        toolName: "mcp_remote_search",
        input: {
          query: "latest ai news",
        },
        providerExecuted: true,
        providerOptions: {
          openai: {
            itemId: "item-1",
          },
        },
      },
      {
        type: "tool-result",
        toolCallId: "call-provider-executed",
        toolName: "mcp_remote_search",
        output: {
          type: "call",
          serverLabel: "remote-search",
          name: "search",
          arguments: "{\"query\":\"latest ai news\"}",
          output: "headline results",
        },
        providerOptions: {
          openai: {
            itemId: "item-1",
          },
        },
      },
    ])

    expect(messages.find((item) => item.role === "tool")).toBeUndefined()
  })

  it("reads line ranges from large text files", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-read-file-"))

    try {
      await createGitRepo(repositoryRoot, "read-file")

      const bigFile = path.join(repositoryRoot, "large.txt")
      const lines = Array.from({ length: 25_000 }, (_, index) =>
        `line ${String(index + 1).padStart(5, "0")} ${"x".repeat(48)}`,
      ).join("\n")
      await writeFile(bigFile, lines)

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await ReadFileTool.init()
          const result = Tool.normalizeToolOutput(await runtime.execute(
            {
              path: "large.txt",
              startLine: 12_500,
              endLine: 12_502,
            },
            {
              sessionID: "session-read-file",
              messageID: "message-read-file",
            },
          ))

          expect(result.title).toBe("Read large.txt")
          expect(result.text).toContain("Lines: 12500-12502 of 25000")
          expect(result.text).toContain("12500 | line 12500")
          expect(result.text).toContain("12502 | line 12502")
          expect(result.text).not.toContain("12503 |")
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  }, 120000)

  it("returns structured read-file data and caps explicit ranges", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-read-file-budget-"))

    try {
      await createGitRepo(repositoryRoot, "read-file-budget")
      const text = Array.from({ length: 10 }, (_, index) =>
        `line ${index + 1} ${"x".repeat(32)}`,
      ).join("\n")
      await writeFile(path.join(repositoryRoot, "budget.txt"), text)

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await ReadFileTool.init()
          const result = Tool.normalizeToolOutput(await runtime.execute(
            {
              file_path: "budget.txt",
              startLine: 1,
              endLine: 8,
              maxLines: 3,
              maxOutputChars: 120,
            },
            {
              sessionID: "session-read-file-budget",
              messageID: "message-read-file-budget",
            },
          ))

          expect(result.title).toBe("Read budget.txt")
          expect(result.text).toContain("Lines: 1-3 of 10")
          expect(result.text).toContain("line output was truncated")
          expect(result.text).not.toContain("4 | line 4")
          expect(result.metadata?.kind).toBe("text")
          expect(result.metadata?.contentFormat).toBe("numbered-lines")
          expect((result.metadata?.budget as any)?.resultPersistence).toBe("disabled")

          const modelOutput = await runtime.toModelOutput?.(result)
          expect(modelOutput).toMatchObject({
            type: "json",
            value: {
              kind: "text",
              displayPath: "budget.txt",
            },
          })
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  }, 120000)

  it("reads explicit absolute text files outside the project", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-read-outside-project-"))
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "anybox-read-outside-source-"))

    try {
      await createGitRepo(repositoryRoot, "read-outside-project")
      const outsideFile = path.join(outsideRoot, "outside.txt")
      await writeFile(outsideFile, "outside project\n")

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await ReadFileTool.init()
          const result = Tool.normalizeToolOutput(await runtime.execute(
            {
              file_path: outsideFile,
            },
            {
              sessionID: "session-read-outside",
              messageID: "message-read-outside",
            },
          ))

          expect(result.title).toBe(`Read ${outsideFile}`)
          expect(result.text).toContain("outside project")
          expect(result.metadata?.path).toBe(outsideFile)
          expect(result.metadata?.displayPath).toBe(outsideFile)
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  }, 120000)

  it("lists an explicit absolute directory outside the project", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-list-outside-project-"))
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "anybox-list-outside-source-"))

    try {
      await createGitRepo(repositoryRoot, "list-outside-project")
      await writeFile(path.join(outsideRoot, "outside.txt"), "outside project\n")

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await ListDirectoryTool.init()
          const result = Tool.normalizeToolOutput(await runtime.execute(
            {
              path: outsideRoot,
              recursive: true,
              maxEntries: 50,
              includeHidden: true,
            },
            {
              sessionID: "session-list-outside",
              messageID: "message-list-outside",
            },
          ))

          expect(result.text).toContain("outside.txt")
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  }, 120000)

  it("rejects binary files for text reads", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-read-binary-"))

    try {
      await createGitRepo(repositoryRoot, "read-binary")
      await writeFile(path.join(repositoryRoot, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await ReadFileTool.init()

          await expect(
            runtime.execute(
              {
                path: "image.png",
              },
              {
                sessionID: "session-read-binary",
                messageID: "message-read-binary",
              },
            ),
          ).rejects.toThrow("appears to be a binary file")
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  it("creates new files with Claude-style replace-text arguments", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-replace-text-create-"))

    try {
      await createGitRepo(repositoryRoot, "replace-text-create")

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await ReplaceTextTool.init()
          const displayPath = path.join("generated", "from-tool.txt")
          const ctx = {
            sessionID: "session-replace-text-create",
            messageID: "message-replace-text-create",
          }

          await expect(runtime.describeApproval?.({
            file_path: "generated/from-tool.txt",
            old_string: "",
            new_string: "hello",
          }, ctx)).resolves.toMatchObject({
            title: `Create ${displayPath}`,
            summary: `Create ${displayPath} with new file contents.`,
          })

          const result = Tool.normalizeToolOutput(await runtime.execute(
            {
              file_path: "generated/from-tool.txt",
              old_string: "",
              new_string: "hello",
            },
            ctx,
          ))

          expect(await readFile(path.join(repositoryRoot, "generated", "from-tool.txt"), "utf8")).toBe("hello")
          expect(result.title).toBe(`Created ${displayPath}`)
          expect(result.text).toBe(`Created ${displayPath} with 5 bytes.`)
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  it("rejects ambiguous replace-text edits unless replace_all is true", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-replace-text-ambiguous-"))

    try {
      await createGitRepo(repositoryRoot, "replace-text-ambiguous")
      await writeFile(path.join(repositoryRoot, "notes.txt"), "alpha beta alpha", "utf8")

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await ReplaceTextTool.init()

          await expect(
            runtime.execute(
              {
                file_path: "notes.txt",
                old_string: "alpha",
                new_string: "omega",
              },
              {
                sessionID: "session-replace-text-ambiguous",
                messageID: "message-replace-text-ambiguous",
              },
            ),
          ).rejects.toThrow("Found 2 matches in notes.txt, but replace_all is false.")
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  it("preserves CRLF replacements", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-replace-text-crlf-"))

    try {
      await createGitRepo(repositoryRoot, "replace-text-crlf")
      await writeFile(path.join(repositoryRoot, "notes.txt"), "alpha\r\nbeta\r\n", "utf8")

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await ReplaceTextTool.init()
          const result = Tool.normalizeToolOutput(await runtime.execute(
            {
              file_path: "notes.txt",
              old_string: "alpha\nbeta",
              new_string: "omega\ngamma",
              replace_all: true,
            },
            {
              sessionID: "session-replace-text-crlf",
              messageID: "message-replace-text-crlf",
            },
          ))

          expect(await readFile(path.join(repositoryRoot, "notes.txt"), "utf8")).toBe("omega\r\ngamma\r\n")
          expect(result.title).toBe("Updated notes.txt")
          expect(result.text).toBe("Replaced 1 occurrence(s) in notes.txt.")
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  it("matches files and directories with glob", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-glob-"))

    try {
      await createGitRepo(repositoryRoot, "glob")
      await mkdir(path.join(repositoryRoot, "src", "utils"), { recursive: true })
      await mkdir(path.join(repositoryRoot, "docs"), { recursive: true })
      await writeFile(path.join(repositoryRoot, "src", "app.ts"), "export const app = true\n", "utf8")
      await writeFile(path.join(repositoryRoot, "src", "utils", "helper.ts"), "export const helper = true\n", "utf8")
      await writeFile(path.join(repositoryRoot, "docs", "guide.md"), "# docs\n", "utf8")

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await GlobTool.init()
          const ctx = {
            sessionID: "session-glob",
            messageID: "message-glob",
          }

          const fileResult = Tool.normalizeToolOutput(await runtime.execute(
            {
              pattern: "**/*.ts",
              path: "src",
            },
            ctx,
          ))

          expect(fileResult.title).toBe("Glob **/*.ts")
          expect(fileResult.text).toContain(`[file] ${path.join("src", "app.ts")}`)
          expect(fileResult.text).toContain(`[file] ${path.join("src", "utils", "helper.ts")}`)
          expect(fileResult.text).not.toContain("guide.md")

          const dirResult = Tool.normalizeToolOutput(await runtime.execute(
            {
              pattern: "**/utils",
              type: "dirs",
            },
            ctx,
          ))

          expect(dirResult.text).toContain(`[dir] ${path.join("src", "utils")}`)
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  it("searches file contents with grep and respects glob filters", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-grep-"))

    try {
      await createGitRepo(repositoryRoot, "grep")
      await mkdir(path.join(repositoryRoot, "src"), { recursive: true })
      await writeFile(path.join(repositoryRoot, "src", "one.ts"), "const Alpha = 1\nconst beta = Alpha + 1\n", "utf8")
      await writeFile(path.join(repositoryRoot, "src", "two.ts"), "const beta = 2\n", "utf8")
      await writeFile(path.join(repositoryRoot, "notes.txt"), "Alpha outside src\n", "utf8")

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await GrepTool.init()
          const result = Tool.normalizeToolOutput(await runtime.execute(
            {
              pattern: "Alpha\\s*=\\s*\\d",
              glob: "src/**/*.ts",
            },
            {
              sessionID: "session-grep",
              messageID: "message-grep",
            },
          ))

          expect(result.title).toBe("Grep Alpha\\s*=\\s*\\d")
          expect(result.text).toContain(`${path.join("src", "one.ts")}:1:7: const Alpha = 1`)
          expect(result.text).not.toContain("notes.txt")
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  it("fetches HTML pages with validated redirects and returns structured metadata", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-web-fetch-"))
    const originalFetch = globalThis.fetch

    try {
      await createGitRepo(repositoryRoot, "web-fetch")

      let fetchCalls = 0
      globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        fetchCalls += 1
        const requestedUrl = String(input)

        expect(init?.method).toBe("GET")
        expect(init?.redirect).toBe("manual")

        if (fetchCalls === 1) {
          expect(requestedUrl).toBe("https://example.com/start")
          return new Response(null, {
            status: 302,
            headers: {
              location: "/article",
            },
          })
        }

        expect(requestedUrl).toBe("https://example.com/article")
        return new Response(
          [
            "<html lang=\"en\">",
            "<head>",
            "<title>Example Article</title>",
            "<meta name=\"description\" content=\"A compact HTML fixture.\" />",
            "<meta property=\"og:site_name\" content=\"Example Site\" />",
            "</head>",
            "<body>",
            "<main>",
            "<h1>Example Article</h1>",
            "<p>Hello <strong>world</strong>.</p>",
            "<p><a href=\"/docs\">Docs</a></p>",
            "</main>",
            "</body>",
            "</html>",
          ].join(""),
          {
            status: 200,
            statusText: "OK",
            headers: {
              "content-type": "text/html; charset=utf-8",
            },
          },
        )
      }) as typeof fetch

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await WebFetchTool.init()
          const ctx = {
            sessionID: "session-web-fetch",
            messageID: "message-web-fetch",
          }

          const result = Tool.normalizeToolOutput(await runtime.execute(
            {
              url: "https://example.com/start",
              maxContentChars: 500,
              maxLinks: 5,
            },
            ctx,
          ))

          expect(result.title).toBe("Fetched https://example.com/article")
          expect(result).toMatchObject({
            result: "success",
            completeness: "complete",
            sideEffect: "none",
            retry: "safe",
          })
          expect(result.text).toContain("Status: 200 OK")
          expect(result.text).toContain("Final URL: https://example.com/article")
          expect(result.text).toContain("# Example Article")
          expect(result.text).toContain("[Docs](https://example.com/docs)")

          expect(result.metadata).toMatchObject({
            url: "https://example.com/start",
            finalUrl: "https://example.com/article",
            status: 200,
            contentType: "text/html",
            contentFormat: "markdown",
            title: "Example Article",
            description: "A compact HTML fixture.",
            siteName: "Example Site",
            language: "en",
            redirects: ["https://example.com/article"],
            links: [
              {
                text: "Docs",
                url: "https://example.com/docs",
              },
            ],
          })

          const modelOutput = await runtime.toModelOutput?.(result as any)
          expect(Tool.normalizeToolModelOutput(modelOutput!)).toEqual({
            type: "json",
            value: expect.objectContaining({
              finalUrl: "https://example.com/article",
              contentFormat: "markdown",
              content: expect.stringContaining("# Example Article"),
            }),
          })
        },
      })
    } finally {
      globalThis.fetch = originalFetch
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  it("returns non-2xx web responses as valid negative results and preserves truncation separately", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-web-fetch-negative-"))
    const originalFetch = globalThis.fetch

    try {
      await createGitRepo(repositoryRoot, "web-fetch-negative")
      globalThis.fetch = (async () => new Response("missing ".repeat(100), {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "text/plain; charset=utf-8" },
      })) as unknown as typeof fetch

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await WebFetchTool.init()
          const result = await runtime.execute({
            url: "https://example.com/missing",
            maxContentChars: 40,
          }, {
            sessionID: "session-web-fetch-negative",
            messageID: "message-web-fetch-negative",
          })

          expect(result).toMatchObject({
            result: "negative",
            completeness: "partial",
            sideEffect: "none",
            retry: "safe",
            metadata: {
              status: 404,
              ok: false,
              contentTruncated: true,
            },
          })
        },
      })
    } finally {
      globalThis.fetch = originalFetch
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  it("blocks loopback targets in web_fetch before issuing a network request", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-web-fetch-blocked-"))

    try {
      await createGitRepo(repositoryRoot, "web-fetch-blocked")

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await WebFetchTool.init()

          let blocked: unknown
          try {
            await runtime.execute(
              {
                url: "http://localhost:3000/private",
              },
              {
                sessionID: "session-web-fetch-blocked",
                messageID: "message-web-fetch-blocked",
              },
            )
          } catch (error) {
            blocked = error
          }
          expect(Tool.findToolControlSignal(blocked)).toMatchObject({
            outcome: {
              kind: "blocked",
              code: "TOOL_PRECONDITION_BLOCKED",
              execution: { sideEffect: "none", retry: "safe" },
            },
            control: { mode: "continue-model" },
          })
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })

  it("allows read-only access through symlinks that resolve outside the project boundary", async () => {
    const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-read-symlink-"))
    const outsideRoot = await mkdtemp(path.join(tmpdir(), "anybox-read-symlink-target-"))

    try {
      await createGitRepo(repositoryRoot, "read-symlink")
      await writeFile(path.join(outsideRoot, "secret.txt"), "outside project\n")

      const linkedDirectory = path.join(repositoryRoot, "linked")
      await symlink(
        outsideRoot,
        linkedDirectory,
        process.platform === "win32" ? "junction" : "dir",
      )

      await Instance.provide({
        directory: repositoryRoot,
        async fn() {
          const runtime = await ReadFileTool.init()

          const result = Tool.normalizeToolOutput(await runtime.execute(
            {
              path: "linked/secret.txt",
            },
            {
              sessionID: "session-read-symlink",
              messageID: "message-read-symlink",
            },
          ))
          expect(result.text).toContain("outside project")
        },
      })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  })

  it("loads local image metadata and rejects files that only look like images by extension", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-image-assets-"))

    try {
      const pngPath = path.join(root, "pixel.png")
      const fakePath = path.join(root, "not-an-image.png")
      await writeFile(
        pngPath,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
          "base64",
        ),
      )
      await writeFile(fakePath, "plain text")

      const image = await ImageAssets.readLocalImage(pngPath)
      expect(image.mime).toBe("image/png")
      expect(image.width).toBe(1)
      expect(image.height).toBe(1)

      await expect(ImageAssets.readLocalImage(fakePath)).rejects.toThrow("Unsupported image file type")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("loads view_image bytes into content/file output while persisting only an asset reference", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-view-image-content-"))
    const pngPath = path.join(root, "pixel.png")
    let assetPath: string | undefined

    try {
      await writeFile(pngPath, ONE_PIXEL_PNG)

      await Instance.provide({
        directory: root,
        async fn() {
          const runtime = await ViewImageTool.init({ model: visionTestModel() })
          const output = await runtime.execute(
            { path: pngPath },
            {
              sessionID: `session-view-image-${Date.now()}`,
              messageID: "message-view-image",
              model: visionTestModel(),
            },
          )

          expect(output.data).toMatchObject({
            image: {
              path: pngPath,
              width: 1,
              height: 1,
              mimeType: "image/png",
              sourceTool: "view_image",
            },
          })
          expect(output.attachments?.[0]).toMatchObject({
            mime: "image/png",
            filename: "pixel.png",
          })
          expect(output.attachments?.[0]?.url).toContain("/api/sessions/")

          const ref = output.metadata?.modelImageRef as ImageAssets.ImageAssetRef
          expect(ref.sessionID).toBeString()
          expect(ref.assetID).toBeString()
          const stored = await ImageAssets.readImageAsset(ref.sessionID, ref.assetID)
          assetPath = stored.metadata.path
          expect(stored.metadata.sha256).toMatch(/^[a-f0-9]{64}$/)
          expect(stored.metadata.sizeBytes).toBe(ONE_PIXEL_PNG.byteLength)

          const serializedOutput = JSON.stringify(output)
          const serializedMetadata = await readFile(`${stored.metadata.path}.json`, "utf8")
          expect(serializedOutput).not.toContain("iVBORw0KGgo")
          expect(serializedMetadata).not.toContain("iVBORw0KGgo")

          const modelOutput = await runtime.toModelOutput?.(output)
          expect(modelOutput).toMatchObject({ type: "content" })
          if (!modelOutput || typeof modelOutput === "string" || modelOutput.type !== "content") {
            throw new Error("Expected content tool output")
          }
          const file = modelOutput.value.find((part) => part.type === "file")
          expect(file).toBeDefined()
          if (!file || file.type !== "file") throw new Error("Expected model image file")
          expect(file.mediaType).toBe("image/png")
          expect(file.data.data).toBeInstanceOf(Uint8Array)
          expect([...file.data.data.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

          const { modelImageRef: _ignored, ...legacyMetadata } = output.metadata ?? {}
          const legacyOutput = {
            ...output,
            metadata: legacyMetadata,
            attachments: output.attachments?.map((attachment) => ({
              ...attachment,
              url: `http://127.0.0.1:1${new URL(attachment.url).pathname}`,
            })),
          }
          const legacyModelOutput = await runtime.toModelOutput?.(legacyOutput)
          expect(legacyModelOutput).toMatchObject({ type: "content" })

          const missingLegacyModelOutput = await runtime.toModelOutput?.({
            ...legacyOutput,
            attachments: legacyOutput.attachments?.map((attachment) => ({
              ...attachment,
              url: "https://example.test/not-an-anybox-asset",
            })),
          })
          expect(missingLegacyModelOutput).toMatchObject({ type: "text" })
          if (
            !missingLegacyModelOutput ||
            typeof missingLegacyModelOutput === "string" ||
            missingLegacyModelOutput.type !== "text"
          ) {
            throw new Error("Expected legacy recovery fallback text")
          }
          expect(missingLegacyModelOutput.value).toContain("Please call view_image again")
        },
      })
    } finally {
      if (assetPath) {
        await rm(assetPath, { force: true })
        await rm(`${assetPath}.json`, { force: true })
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  it("rejects non-transport image formats and images above the 20 MB limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-view-image-validation-"))
    const gifPath = path.join(root, "pixel.gif")
    const oversizedPath = path.join(root, "oversized.png")

    try {
      await writeFile(
        gifPath,
        Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
      )
      const oversized = Buffer.alloc(ImageAssets.MAX_IMAGE_BYTES + 1)
      ONE_PIXEL_PNG.copy(oversized)
      await writeFile(oversizedPath, oversized)

      await Instance.provide({
        directory: root,
        async fn() {
          const runtime = await ViewImageTool.init({ model: visionTestModel() })
          const context = {
            sessionID: "session-view-image-validation",
            messageID: "message-view-image-validation",
            model: visionTestModel(),
          }
          await expect(runtime.execute({ path: gifPath }, context)).rejects.toThrow(
            "Convert it to PNG, JPEG, or WebP first",
          )
          await expect(runtime.execute({ path: oversizedPath }, context)).rejects.toThrow(
            "Maximum supported size",
          )
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("gates view_image registration and direct execution by model image capability", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-view-image-gating-"))

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          const agent = await Agent.get("default")
          expect(agent).toBeDefined()
          const deepSeekModel = (await import("#provider/provider.ts")).testDeepSeekModel

          const visualPlan = await resolveToolPlan({
            agent: agent!,
            model: visionTestModel(),
            sessionID: "session-view-image-visual-plan",
            messageID: "message-view-image-visual-plan",
            abort: new AbortController().signal,
          })
          expect(visualPlan.entries.some((entry) => entry.item.id === "view_image")).toBe(true)
          expect(visualPlan.registryTools.view_image).toBeDefined()
          expect(visualPlan.activeToolNames).toContain("view_image")

          const textPlan = await resolveToolPlan({
            agent: agent!,
            model: deepSeekModel,
            sessionID: "session-view-image-text-plan",
            messageID: "message-view-image-text-plan",
            abort: new AbortController().signal,
          })
          expect(textPlan.entries.some((entry) => entry.item.id === "view_image")).toBe(false)
          expect(textPlan.registryTools.view_image).toBeUndefined()
          expect(textPlan.activeToolNames).not.toContain("view_image")

          await expect(createToolExecution({
            item: ViewImageTool,
            agent: agent!,
            model: deepSeekModel,
            sessionID: "session-view-image-direct",
            messageID: "message-view-image-direct",
            abort: new AbortController().signal,
          })).rejects.toThrow("requires model input support for: image")
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("replays real view_image bytes only to visual models and windows tool-result images", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-view-image-replay-"))
    const pngPath = path.join(root, "pixel.png")
    let assetPath: string | undefined

    try {
      await writeFile(pngPath, ONE_PIXEL_PNG)

      await Instance.provide({
        directory: root,
        async fn() {
          const agent = await Agent.get("default")
          expect(agent).toBeDefined()
          const model = visionTestModel()
          const deepSeekModel = (await import("#provider/provider.ts")).testDeepSeekModel
          const runtime = await ViewImageTool.init({ agent: agent!, model })
          const output = await runtime.execute(
            { path: pngPath },
            {
              sessionID: `session-view-image-replay-${Date.now()}`,
              messageID: "message-view-image-replay",
              model,
            },
          )
          const ref = output.metadata?.modelImageRef as ImageAssets.ImageAssetRef
          assetPath = (await ImageAssets.readImageAsset(ref.sessionID, ref.assetID)).metadata.path

          const assistantMessage = (id: string, count: number): Message.WithParts => ({
            info: {
              id,
              sessionID: ref.sessionID,
              role: "assistant",
              created: Date.now(),
              parentID: "user-view-image-replay",
              modelID: model.id,
              providerID: model.providerID,
              agent: "default",
            } as unknown as Message.Assistant,
            parts: Array.from({ length: count }, (_, index) => ({
              id: `${id}-part-${index}`,
              sessionID: ref.sessionID,
              messageID: id,
              type: "tool",
              callID: `${id}-call-${index}`,
              tool: "view_image",
              schemaVersion: 3,
              turnID: "turn-test",
              input: { raw: JSON.stringify({ path: pngPath }), value: { path: pngPath } },
              source: { kind: "model" },
              retry: { attempt: 1 },
              revision: 1,
              timestamps: { createdAt: 1, settledAt: 2 },
              state: { phase: "settled", outcome: { kind: "returned", result: "success", completeness: "complete", output: output.text, modelOutput: output, title: output.title ?? "View pixel.png", attachments: output.attachments?.map((attachment, attachmentIndex) => ({
                  id: `${id}-attachment-${index}-${attachmentIndex}`,
                  sessionID: ref.sessionID,
                  messageID: id,
                  type: "image",
                  mime: attachment.mime,
                  filename: attachment.filename,
                  url: attachment.url,
                  width: 1,
                  height: 1,
                  metadata: attachment.metadata,
                })), metadata: output.metadata ?? {}, execution: { sideEffect: "unknown", retry: "unknown" } }, control: { mode: "continue-model" } },
            } as Message.ToolPart)),
          })

          const oneBatch = [assistantMessage("assistant-view-image", 1)]
          const visualMessages = await Message.toModelMessages(oneBatch, model, { agent: agent! })
          const visualToolMessage = visualMessages.find((message) => message.role === "tool") as any
          const visualOutput = visualToolMessage.content[0].output
          expect(visualOutput.type).toBe("content")
          expect(visualOutput.value.find((part: any) => part.type === "file")?.data.data).toBeInstanceOf(Uint8Array)
          expect(toolModelMessageSchema.safeParse(visualToolMessage).success).toBe(true)

          const textMessages = await Message.toModelMessages(oneBatch, deepSeekModel, { agent: agent! })
          const textToolMessage = textMessages.find((message) => message.role === "tool") as any
          expect(textToolMessage.content[0].output).toMatchObject({ type: "text" })
          expect(textToolMessage.content[0].output.value).toContain("Select a multimodal model")
          expect(textToolMessage.content[0].output.value).toContain("no image bytes were sent")

          const windowedMessages = await Message.toModelMessages(
            [
              assistantMessage("assistant-old-view-image", 1),
              assistantMessage("assistant-latest-view-image", 5),
            ],
            model,
            {
              agent: agent!,
              imageWindow: {
                maxHistoricalImageParts: 1,
                maxLatestToolResultImageParts: 4,
              },
            },
          )
          const outputs = windowedMessages
            .filter((message) => message.role === "tool" && Array.isArray(message.content))
            .flatMap((message) => message.content as any[])
            .map((part) => part.output)
          expect(outputs.filter((candidate) => candidate.type === "content")).toHaveLength(4)
          expect(outputs.filter((candidate) =>
            candidate.type === "text" &&
            String(candidate.value).includes("tool-result image history window"),
          )).toHaveLength(2)
        },
      })
    } finally {
      if (assetPath) {
        await rm(assetPath, { force: true })
        await rm(`${assetPath}.json`, { force: true })
      }
      await rm(root, { recursive: true, force: true })
    }
  })
})
