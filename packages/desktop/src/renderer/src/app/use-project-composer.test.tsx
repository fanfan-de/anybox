import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ProviderModel } from "./types"
import { useProjectComposer } from "./use-project-composer"

interface Deferred<T> {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return {
    promise,
    reject,
    resolve,
  }
}

function createModel(providerID: string, id: string, input?: { outputImage?: boolean; reasoning?: boolean; toolcall?: boolean }): ProviderModel {
  return {
    id,
    providerID,
    name: `${providerID}/${id}`,
    status: "active",
    available: true,
    capabilities: {
      temperature: true,
      reasoning: input?.reasoning ?? false,
      attachment: false,
      toolcall: input?.toolcall ?? true,
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
        image: input?.outputImage ?? false,
        video: false,
        pdf: false,
      },
    },
    limit: {
      context: 128_000,
      output: 16_000,
    },
  }
}

const models = [
  createModel("openai", "gpt-5.4"),
  createModel("anthropic", "claude-sonnet-4.5"),
]

function createModelsPayload(selection?: { model?: string; small_model?: string; reasoning_effort?: "high" | "medium" | "low" | "max" }) {
  return {
    effectiveModel: null,
    items: models,
    selection: selection ?? {},
  }
}

const originalDesktop = window.desktop

afterEach(() => {
  Object.defineProperty(window, "desktop", {
    configurable: true,
    value: originalDesktop,
  })
  vi.restoreAllMocks()
})

describe("useProjectComposer model selection", () => {
  it("uses the project selection for create-session composers when session model APIs are available", async () => {
    const getProjectModels = vi.fn(async () =>
      createModelsPayload({
        model: "anthropic/claude-sonnet-4.5",
      }),
    )
    const getSessionModels = vi.fn(async () => createModelsPayload({ model: "openai/gpt-5.4" }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        getProjectModels,
        getSessionModels,
      } as unknown as typeof window.desktop,
    })

    const { result } = renderHook(() =>
      useProjectComposer({
        attachmentPaths: [],
        projectID: "project-1",
      }),
    )

    await waitFor(() => expect(result.current.selectedModel).toBe("anthropic/claude-sonnet-4.5"))

    expect(result.current.selectedModelLabel).toBe("anthropic/claude-sonnet-4.5")
    expect(getProjectModels).toHaveBeenCalledWith({ projectID: "project-1" })
    expect(getSessionModels).not.toHaveBeenCalled()
  })

  it("resolves unique bare model ids from the model catalog", async () => {
    const getProjectModels = vi.fn(async () =>
      createModelsPayload({
        model: "claude-sonnet-4.5",
      }),
    )

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        getProjectModels,
      } as unknown as typeof window.desktop,
    })

    const { result } = renderHook(() =>
      useProjectComposer({
        attachmentPaths: [],
        projectID: "project-1",
      }),
    )

    await waitFor(() => expect(result.current.selectedModel).toBe("claude-sonnet-4.5"))

    expect(result.current.selectedModelLabel).toBe("anthropic/claude-sonnet-4.5")
  })

  it("persists create-session model changes to the project selection", async () => {
    const getProjectModels = vi.fn(async () =>
      createModelsPayload({
        model: "anthropic/claude-sonnet-4.5",
      }),
    )
    const updateProjectModelSelection = vi.fn(async () => ({
      model: "openai/gpt-5.4",
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        getProjectModels,
        updateProjectModelSelection,
      } as unknown as typeof window.desktop,
    })

    const { result } = renderHook(() =>
      useProjectComposer({
        attachmentPaths: [],
        projectID: "project-1",
      }),
    )

    await waitFor(() => expect(result.current.selectedModel).toBe("anthropic/claude-sonnet-4.5"))

    await act(async () => {
      await result.current.handleModelChange("openai/gpt-5.4")
    })

    expect(updateProjectModelSelection).toHaveBeenCalledWith({
      projectID: "project-1",
      model: "openai/gpt-5.4",
    })
    expect(result.current.selectedModel).toBe("openai/gpt-5.4")
  })

  it("uses and persists the project reasoning effort for create-session composers", async () => {
    const reasoningModel = createModel("deepseek", "deepseek-v4-pro", { reasoning: true })
    const getProjectModels = vi.fn(async () => ({
      effectiveModel: reasoningModel,
      items: [reasoningModel],
      selection: {
        model: "deepseek/deepseek-v4-pro",
        reasoning_effort: "max" as const,
      },
    }))
    const updateProjectModelSelection = vi.fn(async () => ({
      model: "deepseek/deepseek-v4-pro",
      reasoning_effort: "high" as const,
    }))

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        getProjectModels,
        updateProjectModelSelection,
      } as unknown as typeof window.desktop,
    })

    const { result } = renderHook(() =>
      useProjectComposer({
        attachmentPaths: [],
        projectID: "project-1",
      }),
    )

    await waitFor(() => expect(result.current.selectedReasoningEffort).toBe("max"))

    act(() => {
      result.current.handleReasoningEffortChange("high")
    })

    await waitFor(() =>
      expect(updateProjectModelSelection).toHaveBeenCalledWith({
        projectID: "project-1",
        reasoning_effort: "high",
      }),
    )
    await act(async () => {
      await result.current.awaitPendingModelSelection()
    })

    expect(result.current.selectedReasoningEffort).toBe("high")
  })

  it("shows the current session selection while stale model requests are still pending", async () => {
    const requests = new Map<string, Deferred<ReturnType<typeof createModelsPayload>>>()
    const getSessionModels = vi.fn((input: { sessionID: string }) => {
      const deferred = createDeferred<ReturnType<typeof createModelsPayload>>()
      requests.set(input.sessionID, deferred)
      return deferred.promise
    })

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        getSessionModels,
      } as unknown as typeof window.desktop,
    })

    const { result, rerender } = renderHook(
      (props: { model: string; sessionID: string }) =>
        useProjectComposer({
          attachmentPaths: [],
          projectID: "project-1",
          sessionID: props.sessionID,
          sessionModelSelection: { model: props.model },
        }),
      {
        initialProps: {
          model: "openai/gpt-5.4",
          sessionID: "session-a",
        },
      },
    )

    expect(result.current.selectedModel).toBe("openai/gpt-5.4")
    await waitFor(() => expect(getSessionModels).toHaveBeenCalledWith({ sessionID: "session-a" }))

    rerender({
      model: "anthropic/claude-sonnet-4.5",
      sessionID: "session-b",
    })

    expect(result.current.selectedModel).toBe("anthropic/claude-sonnet-4.5")
    await waitFor(() => expect(getSessionModels).toHaveBeenCalledWith({ sessionID: "session-b" }))

    await act(async () => {
      requests.get("session-a")?.resolve(createModelsPayload({ model: "openai/gpt-5.4" }))
      await requests.get("session-a")?.promise
    })

    expect(result.current.selectedModel).toBe("anthropic/claude-sonnet-4.5")
  })

  it("ignores a model save response after switching to another session", async () => {
    const pendingSave = createDeferred<{ model?: string; small_model?: string }>()
    const updateSessionModelSelection = vi.fn(() => pendingSave.promise)

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        getSessionModels: vi.fn(() => new Promise<ReturnType<typeof createModelsPayload>>(() => undefined)),
        updateSessionModelSelection,
      } as unknown as typeof window.desktop,
    })

    const { result, rerender } = renderHook(
      (props: { model: string; sessionID: string }) =>
        useProjectComposer({
          attachmentPaths: [],
          projectID: "project-1",
          sessionID: props.sessionID,
          sessionModelSelection: { model: props.model },
        }),
      {
        initialProps: {
          model: "openai/gpt-5.4",
          sessionID: "session-a",
        },
      },
    )

    let savePromise!: Promise<void>
    act(() => {
      savePromise = result.current.handleModelChange("openai/gpt-5.4-mini")
    })
    expect(result.current.selectedModel).toBe("openai/gpt-5.4-mini")

    rerender({
      model: "anthropic/claude-sonnet-4.5",
      sessionID: "session-b",
    })
    expect(result.current.selectedModel).toBe("anthropic/claude-sonnet-4.5")

    await act(async () => {
      pendingSave.resolve({ model: "openai/gpt-5.4-mini" })
      await savePromise
    })

    expect(result.current.selectedModel).toBe("anthropic/claude-sonnet-4.5")
  })

  it("keeps the session summary selection when the models endpoint fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        getSessionModels: vi.fn(async () => {
          throw new Error("models unavailable")
        }),
      } as unknown as typeof window.desktop,
    })

    const { result } = renderHook(() =>
      useProjectComposer({
        attachmentPaths: [],
        projectID: "project-1",
        sessionID: "session-a",
        sessionModelSelection: { model: "openai/gpt-5.4" },
      }),
    )

    await waitFor(() => expect(errorSpy).toHaveBeenCalled())

    expect(result.current.selectedModel).toBe("openai/gpt-5.4")
  })

  it("shows a concrete default reasoning effort for OpenAI reasoning models", async () => {
    const reasoningModel = createModel("openai", "gpt-5.4", { reasoning: true })

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        getProjectModels: vi.fn(async () => ({
          effectiveModel: reasoningModel,
          items: [reasoningModel],
          selection: {
            model: "openai/gpt-5.4",
          },
        })),
      } as unknown as typeof window.desktop,
    })

    const { result } = renderHook(() =>
      useProjectComposer({
        attachmentPaths: [],
        projectID: "project-reasoning-default",
      }),
    )

    await waitFor(() => expect(result.current.selectedReasoningEffort).toBe("medium"))

    expect(result.current.selectedReasoningEffortLabel).toBe("Medium")
  })

  it("shows DeepSeek reasoning effort options for reasoning models", async () => {
    const reasoningModel = createModel("deepseek", "deepseek-v4-pro", { reasoning: true })

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        getProjectModels: vi.fn(async () => ({
          effectiveModel: reasoningModel,
          items: [reasoningModel],
          selection: {
            model: "deepseek/deepseek-v4-pro",
          },
        })),
      } as unknown as typeof window.desktop,
    })

    const { result } = renderHook(() =>
      useProjectComposer({
        attachmentPaths: [],
        projectID: "project-deepseek-reasoning",
      }),
    )

    await waitFor(() => expect(result.current.selectedReasoningEffort).toBe("high"))

    expect(result.current.selectedReasoningEffortLabel).toBe("High")
    expect(result.current.reasoningEffortOptions.map((option) => option.value)).toEqual(["high", "max"])
  })

  it("hides reasoning effort controls for Gemini image generation models", async () => {
    const imageModel = createModel("google", "gemini-2.5-flash-image", {
      outputImage: true,
      reasoning: true,
      toolcall: false,
    })

    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: {
        getProjectModels: vi.fn(async () => ({
          effectiveModel: imageModel,
          items: [imageModel],
          selection: {
            model: "google/gemini-2.5-flash-image",
            reasoning_effort: "low" as const,
          },
        })),
      } as unknown as typeof window.desktop,
    })

    const { result } = renderHook(() =>
      useProjectComposer({
        attachmentPaths: [],
        projectID: "project-gemini-image",
      }),
    )

    await waitFor(() => expect(result.current.selectedModel).toBe("google/gemini-2.5-flash-image"))

    expect(result.current.reasoningEffortOptions).toEqual([])
    expect(result.current.selectedReasoningEffort).toBeNull()
    expect(result.current.selectedReasoningEffortLabel).toBe("")
  })
})
