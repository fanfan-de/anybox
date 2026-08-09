import { expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "#project/instance.ts"
import * as Message from "#session/core/message.ts"
import * as Prompt from "#session/core/prompt.ts"
import * as Session from "#session/core/session.ts"

const hasRealModel = Boolean(process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY)
const realTest = hasRealModel ? test : test.skip

function selectModel() {
  if (process.env.OPENAI_API_KEY) {
    return {
      providerID: "openai",
      modelID: "gpt-4o-mini",
    }
  }

  if (process.env.DEEPSEEK_API_KEY) {
    return {
      providerID: "deepseek",
      modelID: "deepseek-chat",
    }
  }

  throw new Error("No supported LLM API key found.")
}

type Scenario = {
  name: string
  toolName: string
  prompt: string
  setup: (directory: string) => Promise<void>
  verify: (
    directory: string,
    assistant: Message.WithParts,
    toolPart: Message.ToolPart,
  ) => Promise<void> | void
}

function returnedOutput(toolPart: Message.ToolPart) {
  if (toolPart.state.phase !== "settled" || toolPart.state.outcome.kind !== "returned") {
    throw new Error(`Expected ${toolPart.tool} to return a tool result.`)
  }
  return toolPart.state.outcome.output
}

async function runScenario(scenario: Scenario) {
  const workspaceRoot = process.cwd()
  const tempRoot = path.join(workspaceRoot, "Test", ".tmp")
  const directory = path.join(
    tempRoot,
    `prompt-llm-${scenario.toolName}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )

  await fs.mkdir(directory, { recursive: true })

  try {
    await scenario.setup(directory)

    await Instance.provide({
      directory,
      async fn() {
        const selectedModel = selectModel()
        const session = await Session.createSession({
          directory: Instance.directory,
          projectID: Instance.project.id,
        })

        const assistant = await Prompt.prompt({
          sessionID: session.id,
          model: selectedModel,
          system: "You are validating a code-agent tool. Use the requested tool exactly once, then give a short confirmation.",
          parts: [
            {
              type: "text",
              text: scenario.prompt,
            },
          ],
        })

        const conversation: Message.WithParts[] = []
        for await (const item of Message.stream(session.id)) {
          if (item.info.role === "user") continue
          conversation.push(item)
        }

        const toolPart = conversation
          .flatMap((item) => item.parts)
          .find((part): part is Message.ToolPart => part.type === "tool" && part.tool === scenario.toolName)

        expect(toolPart, `${scenario.name}: expected ${scenario.toolName} to be persisted in DB`).toBeDefined()
        expect(toolPart?.state.phase, `${scenario.name}: tool result was not settled`).toBe("settled")

        await scenario.verify(directory, assistant, toolPart as Message.ToolPart)

        return assistant
      },
    })
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

realTest("real LLM can use prompt() to drive core tools", async () => {
  const selectedModel = selectModel()
  const Provider = await import("#provider/provider.ts")
  try {
    await Provider.getModel(selectedModel.providerID, selectedModel.modelID)
  } catch (error) {
    console.warn(
      `Skipping real LLM e2e because ${selectedModel.providerID}/${selectedModel.modelID} is not available: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return
  }

  const shellScenario: Scenario | null = process.platform === "darwin"
    ? {
        name: "macos_shell_command",
        toolName: "macos_shell_command",
        setup: async () => undefined,
        prompt: "Run echo macos-shell-ok with the macos_shell_command tool and then confirm macos-shell-ok.",
        verify: async (_directory, _assistant, toolPart) => {
          expect(String(returnedOutput(toolPart))).toContain("macos-shell-ok")
        },
      }
    : process.platform === "win32"
      ? {
          name: "git_bash_command",
          toolName: "git_bash_command",
          setup: async () => undefined,
          prompt: "Run echo git-bash-ok with the git_bash_command tool and then confirm git-bash-ok.",
          verify: async (_directory, _assistant, toolPart) => {
            expect(String(returnedOutput(toolPart))).toContain("git-bash-ok")
          },
        }
      : null

  const scenarios: Scenario[] = [
    {
      name: "read_file",
      toolName: "read_file",
      setup: async (directory) => {
        await fs.writeFile(path.join(directory, "readme.txt"), "alpha-content", "utf8")
      },
      prompt: "Read readme.txt with the read_file tool and reply with the exact content.",
      verify: async (_directory, _assistant, toolPart) => {
        expect(String(returnedOutput(toolPart))).toContain("alpha-content")
      },
    },
    {
      name: "list-directory",
      toolName: "list-directory",
      setup: async (directory) => {
        await fs.mkdir(path.join(directory, "nested", "deep"), { recursive: true })
        await fs.writeFile(path.join(directory, "root.txt"), "root", "utf8")
        await fs.writeFile(path.join(directory, "nested", "deep", "child.txt"), "child", "utf8")
      },
      prompt: "List the current directory recursively with the list-directory tool and mention nested and child.txt.",
      verify: async (_directory, _assistant, toolPart) => {
        const output = returnedOutput(toolPart)
        expect(String(output)).toContain("nested")
        expect(String(output)).toContain("child.txt")
      },
    },
    {
      name: "glob",
      toolName: "glob",
      setup: async (directory) => {
        await fs.mkdir(path.join(directory, "src", "nested"), { recursive: true })
        await fs.writeFile(path.join(directory, "src", "index.ts"), "export const index = true\n", "utf8")
        await fs.writeFile(path.join(directory, "src", "nested", "child.ts"), "export const child = true\n", "utf8")
        await fs.writeFile(path.join(directory, "notes.txt"), "notes", "utf8")
      },
      prompt: "Find the TypeScript files under src with the glob tool and mention index.ts and child.ts.",
      verify: async (_directory, _assistant, toolPart) => {
        const output = returnedOutput(toolPart)
        expect(String(output)).toContain("index.ts")
        expect(String(output)).toContain("child.ts")
      },
    },
    {
      name: "grep",
      toolName: "grep",
      setup: async (directory) => {
        await fs.mkdir(path.join(directory, "grep"), { recursive: true })
        await fs.writeFile(path.join(directory, "grep", "one.ts"), "const needle = 'value'\n", "utf8")
        await fs.writeFile(path.join(directory, "grep", "two.ts"), "const haystack = true\n", "utf8")
      },
      prompt: "Use the grep tool to search the current directory for needle and mention one.ts.",
      verify: async (_directory, _assistant, toolPart) => {
        const output = returnedOutput(toolPart)
        expect(String(output)).toContain("needle")
        expect(String(output)).toContain("one.ts")
      },
    },
    {
      name: "replace_text",
      toolName: "replace_text",
      setup: async (directory) => {
        await fs.writeFile(path.join(directory, "edit.txt"), "alpha beta alpha", "utf8")
      },
      prompt: "Replace all occurrences of alpha with omega in edit.txt using the replace_text tool.",
      verify: async (directory, _assistant, toolPart) => {
        const updated = await fs.readFile(path.join(directory, "edit.txt"), "utf8")
        expect(updated).toBe("omega beta omega")
        expect(String(returnedOutput(toolPart))).toContain("Replaced 2")
      },
    },
    ...(shellScenario ? [shellScenario] : []),
  ]

  for (const scenario of scenarios) {
    await runScenario(scenario)
  }
}, 360000)
