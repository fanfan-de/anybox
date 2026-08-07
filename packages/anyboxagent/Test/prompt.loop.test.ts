import { describe, expect, it } from "bun:test"
import "./sqlite.cleanup.ts"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Instance } from "#project/instance.ts"
import * as SessionDiff from "#session/diff/diff.ts"
import * as LLM from "#session/core/llm.ts"
import type * as MessageTypes from "#session/core/message.ts"
import * as ImageAssets from "#session/support/image-assets.ts"
import * as Provider from "#provider/provider.ts"

const hasGit = spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0
const itIfGit = hasGit ? it : it.skip

function createTestModel(): Provider.Model {
  return {
    ...Provider.testDeepSeekModel,
    id: "test-model",
    providerID: "test-provider",
    api: {
      ...Provider.testDeepSeekModel.api,
      id: "test-model",
      url: "https://example.test/v1",
    },
    capabilities: {
      ...Provider.testDeepSeekModel.capabilities,
      toolcall: true,
      input: {
        ...Provider.testDeepSeekModel.capabilities.input,
      },
      output: {
        ...Provider.testDeepSeekModel.capabilities.output,
      },
    },
  }
}

function createVisionTestModel(): Provider.Model {
  const model = createTestModel()
  return {
    ...model,
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

describe("prompt loop concurrency", () => {
  itIfGit("records model-call patch parts per assistant iteration in a non-git directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "anybox-model-call-diff-"))
    let streamCalls = 0

    const restoreProvider = Provider.setProviderFunctionOverridesForTesting({
      getDefaultModelRef: async () => ({
        providerID: "test-provider",
        modelID: "test-model",
      }),
      getSelection: async () => ({}),
      getModel: async () => createTestModel(),
      getLanguage: async (model) => model as never,
    })

    const restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: ((input: any) => {
        streamCalls += 1
        const call = streamCalls
        const file = call === 1 ? "first.txt" : "second.txt"
        const text = call === 1 ? "first change" : "second change"
        const finishReason = call === 1 ? "unknown" : "stop"

        return {
          fullStream: (async function* () {
            yield { type: "start" }
            await writeFile(join(tempDir, file), `${text}\n`, "utf8")
            yield { type: "text-start" }
            yield { type: "text-delta", text }
            yield { type: "text-end" }
            yield {
              type: "finish",
              finishReason,
            }
            await input.onFinish?.({
              finishReason,
              text,
              totalUsage: {},
            })
          })(),
        }
      }) as never,
    })

    try {
      const Session = await import("#session/core/session.ts")
      const Prompt = await import("#session/core/prompt.ts")
      const Message = await import("#session/core/message.ts")

      await Instance.provide({
        directory: tempDir,
        async fn() {
          const session = await Session.createSession({
            directory: Instance.directory,
            projectID: Instance.project.id,
          })

          await Prompt.prompt({
            sessionID: session.id,
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
            parts: [
              {
                type: "text",
                text: "make two changes",
              },
            ],
          })

          const assistants: MessageTypes.WithParts[] = []
          const users: MessageTypes.WithParts[] = []
          for await (const item of Message.stream(session.id)) {
            if (item.info.role === "assistant") assistants.push(item)
            if (item.info.role === "user") users.push(item)
          }

          expect(streamCalls).toBe(2)
          expect(assistants).toHaveLength(2)
          expect(users).toHaveLength(1)

          const firstPatch = assistants[0]?.parts.find((part): part is MessageTypes.PatchPart => part.type === "patch")
          const secondPatch = assistants[1]?.parts.find((part): part is MessageTypes.PatchPart => part.type === "patch")

          expect(firstPatch?.scope).toBe("model-call")
          expect(firstPatch?.iteration).toBe(1)
          expect(typeof firstPatch?.fromSnapshot).toBe("string")
          expect(typeof firstPatch?.hash).toBe("string")
          expect(firstPatch?.files).toEqual(["first.txt"])
          expect(firstPatch?.summary).toEqual({
            files: 1,
            additions: 1,
            deletions: 0,
          })
          expect(firstPatch?.changes?.[0]?.patch).toContain("first change")

          expect(secondPatch?.scope).toBe("model-call")
          expect(secondPatch?.iteration).toBe(2)
          expect(typeof secondPatch?.fromSnapshot).toBe("string")
          expect(typeof secondPatch?.hash).toBe("string")
          expect(secondPatch?.files).toEqual(["second.txt"])
          expect(secondPatch?.summary).toEqual({
            files: 1,
            additions: 1,
            deletions: 0,
          })
          expect(secondPatch?.changes?.[0]?.patch).toContain("second change")
          expect(users[0]?.info.role === "user" ? users[0].info.diffSummary : undefined).toBeUndefined()
          expect(assistants[0]?.info.role === "assistant" ? assistants[0].info.diffSummary : undefined).toBeUndefined()
          const assistantDiffSummary = assistants[1]?.info.role === "assistant" ? assistants[1].info.diffSummary : undefined
          expect(assistantDiffSummary?.diffs.map((diff) => diff.file)).toEqual(["first.txt", "second.txt"])
          expect(assistantDiffSummary?.stats).toEqual({
            files: 2,
            additions: 2,
            deletions: 0,
          })
          expect(assistantDiffSummary?.diffs[0]?.patch).toContain("first change")
          expect(assistantDiffSummary?.diffs[1]?.patch).toContain("second change")

          expect(existsSync(join(tempDir, ".git"))).toBe(false)
        },
      })
    } finally {
      restoreLLM()
      restoreProvider()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  itIfGit("does not record a model-call patch part when files do not change", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "anybox-model-call-no-diff-"))

    const restoreProvider = Provider.setProviderFunctionOverridesForTesting({
      getDefaultModelRef: async () => ({
        providerID: "test-provider",
        modelID: "test-model",
      }),
      getSelection: async () => ({}),
      getModel: async () => createTestModel(),
      getLanguage: async (model) => model as never,
    })

    const restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: ((input: any) => ({
        fullStream: (async function* () {
          yield { type: "start" }
          yield { type: "text-start" }
          yield { type: "text-delta", text: "no changes" }
          yield { type: "text-end" }
          yield {
            type: "finish",
            finishReason: "stop",
          }
          await input.onFinish?.({
            finishReason: "stop",
            text: "no changes",
            totalUsage: {},
          })
        })(),
      })) as never,
    })

    try {
      const Session = await import("#session/core/session.ts")
      const Prompt = await import("#session/core/prompt.ts")
      const Message = await import("#session/core/message.ts")

      await Instance.provide({
        directory: tempDir,
        async fn() {
          const session = await Session.createSession({
            directory: Instance.directory,
            projectID: Instance.project.id,
          })

          await Prompt.prompt({
            sessionID: session.id,
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
            parts: [
              {
                type: "text",
                text: "do not edit files",
              },
            ],
          })

          const assistants: MessageTypes.WithParts[] = []
          const users: MessageTypes.WithParts[] = []
          for await (const item of Message.stream(session.id)) {
            if (item.info.role === "assistant") assistants.push(item)
            if (item.info.role === "user") users.push(item)
          }

          expect(assistants).toHaveLength(1)
          expect(assistants[0]?.parts.some((part) => part.type === "patch")).toBe(false)
          expect(assistants[0]?.info.role === "assistant" ? assistants[0].info.diffSummary : undefined).toBeUndefined()
          expect(users[0]?.info.role === "user" ? users[0].info.diffSummary : undefined).toBeUndefined()
        },
      })
    } finally {
      restoreLLM()
      restoreProvider()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  itIfGit("records a model-call patch part when the model call fails after changing files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "anybox-model-call-failed-diff-"))

    const restoreProvider = Provider.setProviderFunctionOverridesForTesting({
      getDefaultModelRef: async () => ({
        providerID: "test-provider",
        modelID: "test-model",
      }),
      getSelection: async () => ({}),
      getModel: async () => createTestModel(),
      getLanguage: async (model) => model as never,
    })

    const restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: (() => ({
        fullStream: (async function* () {
          yield { type: "start" }
          await writeFile(join(tempDir, "failed.txt"), "changed before failure\n", "utf8")
          throw new Error("model failed")
        })(),
      })) as never,
    })

    try {
      const Session = await import("#session/core/session.ts")
      const Prompt = await import("#session/core/prompt.ts")
      const Message = await import("#session/core/message.ts")

      await Instance.provide({
        directory: tempDir,
        async fn() {
          const session = await Session.createSession({
            directory: Instance.directory,
            projectID: Instance.project.id,
          })

          await expect(Prompt.prompt({
            sessionID: session.id,
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
            parts: [
              {
                type: "text",
                text: "fail after editing",
              },
            ],
          })).rejects.toThrow("model failed")

          const assistants: MessageTypes.WithParts[] = []
          for await (const item of Message.stream(session.id)) {
            if (item.info.role === "assistant") assistants.push(item)
          }

          expect(assistants).toHaveLength(1)
          const patch = assistants[0]?.parts.find((part): part is MessageTypes.PatchPart => part.type === "patch")
          expect(patch?.scope).toBe("model-call")
          expect(patch?.iteration).toBe(1)
          expect(patch?.files).toEqual(["failed.txt"])
          expect(patch?.summary).toEqual({
            files: 1,
            additions: 1,
            deletions: 0,
          })
          expect(patch?.changes?.[0]?.patch).toContain("changed before failure")
        },
      })
    } finally {
      restoreLLM()
      restoreProvider()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  itIfGit("records steer continuation turns with separate turn diff summaries", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "anybox-turn-diff-steer-"))
    let streamCalls = 0
    let releaseFirstPrompt: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseFirstPrompt = resolve
    })
    let markFirstEditDone: (() => void) | undefined
    const firstEditDone = new Promise<void>((resolve) => {
      markFirstEditDone = resolve
    })

    const restoreProvider = Provider.setProviderFunctionOverridesForTesting({
      getDefaultModelRef: async () => ({
        providerID: "test-provider",
        modelID: "test-model",
      }),
      getSelection: async () => ({}),
      getModel: async () => createTestModel(),
      getLanguage: async (model) => model as never,
    })

    const restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: ((input: any) => {
        streamCalls += 1
        const call = streamCalls

        return {
          fullStream: (async function* () {
            yield { type: "start" }
            if (call === 1) {
              await writeFile(join(tempDir, "first.txt"), "first turn segment\n", "utf8")
              markFirstEditDone?.()
              await gate
            } else {
              await writeFile(join(tempDir, "second.txt"), "second turn segment\n", "utf8")
            }
            yield {
              type: "finish",
              finishReason: "stop",
            }
            await input.onFinish?.({
              finishReason: "stop",
              text: "",
              totalUsage: {},
            })
          })(),
        }
      }) as never,
    })

    try {
      const Session = await import("#session/core/session.ts")
      const Prompt = await import("#session/core/prompt.ts")
      const Message = await import("#session/core/message.ts")

      await Instance.provide({
        directory: tempDir,
        async fn() {
          const session = await Session.createSession({
            directory: Instance.directory,
            projectID: Instance.project.id,
          })

          const firstPrompt = Prompt.promptExecution({
            sessionID: session.id,
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
            parts: [
              {
                type: "text",
                text: "first",
              },
            ],
          })

          await firstEditDone

          const secondPrompt = Prompt.promptExecution({
            sessionID: session.id,
            concurrentInputMode: "steer",
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
            parts: [
              {
                type: "text",
                text: "second",
              },
            ],
          })

          expect(secondPrompt.mode).toBe("steer")
          expect(secondPrompt.turnID).not.toBe(firstPrompt.turnID)

          releaseFirstPrompt?.()
          await firstPrompt.promise
          await secondPrompt.promise

          const assistants: MessageTypes.WithParts[] = []
          const users: MessageTypes.WithParts[] = []
          for await (const item of Message.stream(session.id)) {
            if (item.info.role === "assistant") assistants.push(item)
            if (item.info.role === "user") users.push(item)
          }
          const turns = Session.listTurns(session.id)

          expect(streamCalls).toBe(2)
          expect(assistants).toHaveLength(2)
          expect(users).toHaveLength(2)
          expect(turns.map((turn) => turn.status)).toEqual(["continued_by_user", "completed"])
          expect(users[0]?.info.role === "user" ? users[0].info.diffSummary : undefined).toBeUndefined()
          expect(users[1]?.info.role === "user" ? users[1].info.diffSummary : undefined).toBeUndefined()
          expect(assistants[0]?.info.role === "assistant" ? assistants[0].info.diffSummary?.diffs.map((diff) => diff.file) : []).toEqual(["first.txt"])
          expect(assistants[1]?.info.role === "assistant" ? assistants[1].info.diffSummary?.diffs.map((diff) => diff.file) : []).toEqual(["second.txt"])
          expect((await SessionDiff.computeLatestTurnDetailedDiff(session.id))?.diffs.map((diff) => diff.file)).toEqual(["second.txt"])
        },
      })
    } finally {
      restoreLLM()
      restoreProvider()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  itIfGit("records turn diff summaries on each assistant message during resume", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "anybox-turn-diff-resume-"))
    let streamCalls = 0

    const restoreProvider = Provider.setProviderFunctionOverridesForTesting({
      getDefaultModelRef: async () => ({
        providerID: "test-provider",
        modelID: "test-model",
      }),
      getSelection: async () => ({}),
      getModel: async () => createTestModel(),
      getLanguage: async (model) => model as never,
    })

    const restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: ((input: any) => {
        streamCalls += 1
        const call = streamCalls
        const file = call === 1 ? "first.txt" : "second.txt"

        return {
          fullStream: (async function* () {
            yield { type: "start" }
            await writeFile(join(tempDir, file), `${file}\n`, "utf8")
            if (call === 1) {
              throw new Error("first call failed")
            }
            yield {
              type: "finish",
              finishReason: "stop",
            }
            await input.onFinish?.({
              finishReason: "stop",
              text: "",
              totalUsage: {},
            })
          })(),
        }
      }) as never,
    })

    try {
      const Session = await import("#session/core/session.ts")
      const Prompt = await import("#session/core/prompt.ts")
      const Message = await import("#session/core/message.ts")

      await Instance.provide({
        directory: tempDir,
        async fn() {
          const session = await Session.createSession({
            directory: Instance.directory,
            projectID: Instance.project.id,
          })

          await expect(Prompt.prompt({
            sessionID: session.id,
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
            parts: [
              {
                type: "text",
                text: "first",
              },
            ],
          })).rejects.toThrow("first call failed")
          await Prompt.resume({ sessionID: session.id })

          const assistants: MessageTypes.WithParts[] = []
          const users: MessageTypes.WithParts[] = []
          for await (const item of Message.stream(session.id)) {
            if (item.info.role === "assistant") assistants.push(item)
            if (item.info.role === "user") users.push(item)
          }

          expect(streamCalls).toBe(2)
          expect(users).toHaveLength(1)
          expect(assistants).toHaveLength(2)
          expect(users[0]?.info.role === "user" ? users[0].info.diffSummary : undefined).toBeUndefined()
          expect(assistants[0]?.info.role === "assistant" ? assistants[0].info.diffSummary?.diffs.map((diff) => diff.file) : []).toEqual(["first.txt"])
          expect(assistants[1]?.info.role === "assistant" ? assistants[1].info.diffSummary?.diffs.map((diff) => diff.file) : []).toEqual(["second.txt"])
          expect(assistants[1]?.info.role === "assistant" ? assistants[1].info.diffSummary?.stats : undefined).toEqual({
            files: 1,
            additions: 1,
            deletions: 0,
          })
        },
      })
    } finally {
      restoreLLM()
      restoreProvider()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it("records concurrent steer prompts as new continuation turns", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "anybox-prompt-loop-concurrency-"))
    let releaseFirstPrompt: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseFirstPrompt = resolve
    })
    let markStreamStarted: (() => void) | undefined
    const streamStarted = new Promise<void>((resolve) => {
      markStreamStarted = resolve
    })

    const restoreProvider = Provider.setProviderFunctionOverridesForTesting({
      getDefaultModelRef: async () => ({
        providerID: "test-provider",
        modelID: "test-model",
      }),
      getSelection: async () => ({}),
      getModel: async () => createTestModel(),
      getLanguage: async (model) => model as never,
    })

    const restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: ((input: any) => ({
        fullStream: (async function* () {
          yield { type: "start" }
          markStreamStarted?.()
          await gate
          yield {
            type: "text-start",
          }
          yield {
            type: "text-delta",
            text: "ok",
          }
          yield {
            type: "text-end",
          }
          yield {
            type: "finish",
            finishReason: "stop",
          }
          await input.onFinish?.({
            finishReason: "stop",
            text: "ok",
            totalUsage: {},
          })
        })(),
      })) as never,
    })

    try {
      const Session = await import("#session/core/session.ts")
      const Prompt = await import("#session/core/prompt.ts")
      const Message = await import("#session/core/message.ts")

      await Instance.provide({
        directory: tempDir,
        async fn() {
          const session = await Session.createSession({
            directory: Instance.directory,
            projectID: Instance.project.id,
          })

          const firstPrompt = Prompt.promptExecution({
            sessionID: session.id,
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
            parts: [
              {
                type: "text",
                text: "first",
              },
            ],
          })

          await streamStarted

          const secondPrompt = Prompt.promptExecution({
            sessionID: session.id,
            concurrentInputMode: "steer",
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
            parts: [
              {
                type: "text",
                text: "second",
              },
            ],
          })

          expect(secondPrompt.mode).toBe("steer")
          expect(secondPrompt.turnID).not.toBe(firstPrompt.turnID)

          releaseFirstPrompt?.()
          await firstPrompt.promise
          await secondPrompt.promise

          const messages: Array<{ role: string }> = []
          for await (const item of Message.stream(session.id)) {
            messages.push({ role: item.info.role })
          }
          const turns = Session.listTurns(session.id)

          expect(messages.filter((message) => message.role === "user")).toHaveLength(2)
          expect(turns.map((turn) => turn.status)).toEqual(["continued_by_user", "completed"])
        },
      })
    } finally {
      restoreLLM()
      restoreProvider()
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  itIfGit("injects view_image bytes into the second provider request", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "anybox-view-image-loop-"))
    const imagePath = join(tempDir, "pixel.png")
    await writeFile(
      imagePath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64",
      ),
    )
    let streamCalls = 0
    let secondProviderMessages: any[] | undefined
    let assetPath: string | undefined

    const restoreProvider = Provider.setProviderFunctionOverridesForTesting({
      getDefaultModelRef: async () => ({
        providerID: "test-provider",
        modelID: "test-model",
      }),
      getSelection: async () => ({}),
      getModel: async () => createVisionTestModel(),
      getLanguage: async (model) => model as never,
    })

    const restoreLLM = LLM.setRuntimeDependenciesForTesting({
      getLanguage: async (model) => model as never,
      streamText: ((input: any) => {
        streamCalls += 1
        const call = streamCalls
        if (call === 2) secondProviderMessages = input.prompt

        return {
          fullStream: (async function* () {
            yield { type: "start" }
            if (call === 1) {
              const toolCallId = "call-view-image-loop"
              const viewImage = input.tools?.view_image
              if (!viewImage?.execute) throw new Error("view_image was not exposed to the visual model")
              const output = await viewImage.execute(
                { path: imagePath },
                {
                  toolCallId,
                  messages: input.prompt,
                  abortSignal: input.abortSignal,
                },
              )
              const ref = output.metadata?.modelImageRef as ImageAssets.ImageAssetRef
              assetPath = (await ImageAssets.readImageAsset(ref.sessionID, ref.assetID)).metadata.path

              yield {
                type: "tool-call",
                toolCallId,
                toolName: "view_image",
                input: { path: imagePath },
                title: output.title,
              }
              yield {
                type: "tool-result",
                toolCallId,
                toolName: "view_image",
                input: { path: imagePath },
                output,
                title: output.title,
                providerMetadata: {},
              }
              yield { type: "finish", finishReason: "tool-calls", totalUsage: {} }
              await input.onFinish?.({
                finishReason: "tool-calls",
                text: "",
                totalUsage: {},
              })
              return
            }

            yield { type: "text-start" }
            yield { type: "text-delta", text: "I can see the image." }
            yield { type: "text-end" }
            yield { type: "finish", finishReason: "stop", totalUsage: {} }
            await input.onFinish?.({
              finishReason: "stop",
              text: "I can see the image.",
              totalUsage: {},
            })
          })(),
        }
      }) as never,
    })

    let unsubscribe = () => false
    try {
      const Session = await import("#session/core/session.ts")
      const Prompt = await import("#session/core/prompt.ts")
      const Message = await import("#session/core/message.ts")
      const EventStore = await import("#session/runtime/event-store.ts")

      await Instance.provide({
        directory: tempDir,
        async fn() {
          const session = await Session.createSession({
            directory: Instance.directory,
            projectID: Instance.project.id,
          })
          const runtimeEvents: any[] = []
          unsubscribe = EventStore.subscribe((event) => {
            if (event.sessionID === session.id) runtimeEvents.push(event)
          })

          await Prompt.prompt({
            sessionID: session.id,
            model: {
              providerID: "test-provider",
              modelID: "test-model",
            },
            parts: [{
              type: "text",
              text: `Inspect ${imagePath}`,
            }],
          })

          expect(streamCalls).toBe(2)
          const toolMessage = secondProviderMessages?.find((message) => message.role === "tool")
          if (!toolMessage) {
            throw new Error("Second provider request had no tool message")
          }
          const toolResult = toolMessage?.content?.find((part: any) => part.toolName === "view_image")
          expect(toolResult?.output?.type).toBe("content")
          const image = toolResult?.output?.value?.find((part: any) => part.type === "file")
          expect(image?.mediaType).toBe("image/png")
          expect(image?.data?.data).toBeInstanceOf(Uint8Array)
          expect([...image.data.data.slice(0, 8)]).toEqual([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
          ])

          const startedCalls = runtimeEvents.filter((event) => event.type === "llm.call.started")
          expect(startedCalls).toHaveLength(2)
          expect(startedCalls[1]?.payload.toolResultImageParts).toBe(1)
          expect(startedCalls[1]?.payload.images?.[0]).toMatchObject({
            location: "tool-result",
            mime: "image/png",
            width: 1,
            height: 1,
            sourceTool: "view_image",
          })

          const assistants: MessageTypes.WithParts[] = []
          for await (const item of Message.stream(session.id)) {
            if (item.info.role === "assistant") assistants.push(item)
          }
          const firstTool = assistants[0]?.parts.find(
            (part): part is MessageTypes.ToolPart => part.type === "tool" && part.tool === "view_image",
          )
          expect(firstTool?.state.status).toBe("completed")
          if (!firstTool || firstTool.state.status !== "completed") {
            throw new Error("Expected a completed view_image tool result")
          }
          expect(firstTool.state.attachments?.[0]).toMatchObject({
            type: "image",
            mime: "image/png",
            width: 1,
            height: 1,
          })
          expect(firstTool.state.attachments?.[0]?.url).toContain("/api/sessions/")
          expect(JSON.stringify(firstTool.state)).not.toContain("iVBORw0KGgo")
        },
      })
    } finally {
      unsubscribe()
      restoreLLM()
      restoreProvider()
      if (assetPath) {
        await rm(assetPath, { force: true })
        await rm(`${assetPath}.json`, { force: true })
      }
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
