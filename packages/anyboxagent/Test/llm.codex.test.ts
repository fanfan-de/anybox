import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  setRuntimeDependenciesForTesting,
  stream,
} from "#session/core/llm.ts"

const capturedRequests: Array<Record<string, unknown>> = []
let restoreRuntimeDependencies: (() => void) | undefined

function createModel(input: { providerID: string; url: string; id?: string; apiID?: string; reasoning?: boolean }) {
  return {
    id: input.id ?? "test-model",
    providerID: input.providerID,
    api: {
      id: input.apiID ?? input.id ?? "test-model",
      url: input.url,
      npm: "@ai-sdk/openai",
    },
    capabilities: {
      reasoning: input.reasoning ?? false,
      attachment: false,
      toolcall: true,
      input: {
        image: false,
        pdf: false,
      },
    },
  } as any
}

function createInput(model: ReturnType<typeof createModel>) {
  return {
    user: {
      id: "user-1",
    },
    sessionID: "session-1",
    messageID: "message-1",
    model,
    agent: {
      name: "plan",
      mode: "primary",
    },
    system: ["alpha", "beta"],
    abort: new AbortController().signal,
    messages: [],
    tools: {},
  } as any
}

describe("llm codex request shaping", () => {
  beforeEach(() => {
    restoreRuntimeDependencies = setRuntimeDependenciesForTesting({
      streamText(options: Record<string, unknown>) {
        capturedRequests.push(options)
        return {
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "finish", finishReason: "stop" }
          })(),
        }
      },
      getLanguage: async () => ({
        id: "language-model",
      }),
      outputText: () => ({
        type: "text",
      }),
      stepCountIs: () => undefined,
    } as any)
  })

  afterEach(() => {
    restoreRuntimeDependencies?.()
    restoreRuntimeDependencies = undefined
    capturedRequests.length = 0
  })

  it("sends OpenAI Codex system prompts as provider instructions", async () => {
    await stream(
      createInput(
        createModel({
          providerID: "openai",
          url: "https://chatgpt.com/backend-api/codex",
        }),
      ),
    )

    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]?.providerOptions).toEqual({
      openai: {
        store: false,
        instructions: "alpha\nbeta",
      },
    })
    expect(capturedRequests[0]?.system).toBeUndefined()
  })

  it("keeps non-Codex providers on the normal system field", async () => {
    await stream(
      createInput(
        createModel({
          providerID: "deepseek",
          url: "https://api.deepseek.com/v1",
        }),
      ),
    )

    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]?.providerOptions).toBeUndefined()
    expect(capturedRequests[0]?.system).toBe("alpha\nbeta")
  })

  it("requests OpenAI reasoning summaries for reasoning models", async () => {
    await stream({
      ...createInput(
        createModel({
          providerID: "openai",
          url: "https://api.openai.com/v1",
          reasoning: true,
        }),
      ),
      reasoningEffort: "high",
    })

    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]?.providerOptions).toEqual({
      openai: {
        reasoningEffort: "high",
        reasoningSummary: "auto",
      },
    })
    expect(capturedRequests[0]?.system).toBe("alpha\nbeta")
  })

  it("sends DeepSeek reasoning effort through provider options", async () => {
    await stream({
      ...createInput(
        createModel({
          providerID: "deepseek",
          url: "https://api.deepseek.com/v1",
          id: "deepseek-v4-pro",
          reasoning: true,
        }),
      ),
      reasoningEffort: "max",
    })

    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]?.providerOptions).toEqual({
      deepseek: {
        thinking: {
          type: "enabled",
        },
        reasoningEffort: "max",
      },
    })
    expect(capturedRequests[0]?.system).toBe("alpha\nbeta")
  })

  it("requests Gemini 3 thought summaries through Google provider options", async () => {
    await stream(
      createInput(
        createModel({
          providerID: "google",
          url: "https://generativelanguage.googleapis.com/v1beta",
          id: "gemini-3.1-pro-preview",
        }),
      ),
    )

    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]?.providerOptions).toEqual({
      google: {
        thinkingConfig: {
          thinkingLevel: "high",
          includeThoughts: true,
        },
      },
    })
    expect(capturedRequests[0]?.system).toBe("alpha\nbeta")
  })

  it("maps Gemini 3 reasoning effort to thinking level", async () => {
    await stream({
      ...createInput(
        createModel({
          providerID: "google",
          url: "https://generativelanguage.googleapis.com/v1beta",
          id: "gemini-3.1-pro-preview",
        }),
      ),
      reasoningEffort: "medium",
    })

    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]?.providerOptions).toEqual({
      google: {
        thinkingConfig: {
          thinkingLevel: "medium",
          includeThoughts: true,
        },
      },
    })
  })

  it("detects Gemini thinking support from the provider API model id", async () => {
    await stream(
      createInput(
        createModel({
          providerID: "google",
          url: "https://generativelanguage.googleapis.com/v1beta",
          id: "custom-gemini-alias",
          apiID: "gemini-3.1-pro-preview",
        }),
      ),
    )

    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]?.providerOptions).toEqual({
      google: {
        thinkingConfig: {
          thinkingLevel: "high",
          includeThoughts: true,
        },
      },
    })
  })

  it("requests Gemini 2.5 thought summaries with a thinking budget", async () => {
    await stream({
      ...createInput(
        createModel({
          providerID: "google",
          url: "https://generativelanguage.googleapis.com/v1beta",
          id: "gemini-2.5-flash",
        }),
      ),
      reasoningEffort: "none",
    })

    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]?.providerOptions).toEqual({
      google: {
        thinkingConfig: {
          thinkingBudget: 0,
          includeThoughts: true,
        },
      },
    })
  })

  it("does not send Google thinking config for Gemini models without thinking support", async () => {
    await stream(
      createInput(
        createModel({
          providerID: "google",
          url: "https://generativelanguage.googleapis.com/v1beta",
          id: "gemini-2.0-flash",
        }),
      ),
    )

    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]?.providerOptions).toBeUndefined()
  })

  it("does not request OpenAI reasoning summaries unless reasoning effort is explicit", async () => {
    await stream(
      createInput(
        createModel({
          providerID: "openai",
          url: "https://api.openai.com/v1",
          reasoning: true,
        }),
      ),
    )

    expect(capturedRequests).toHaveLength(1)
    expect(capturedRequests[0]?.providerOptions).toBeUndefined()
    expect(capturedRequests[0]?.system).toBe("alpha\nbeta")
  })
})
