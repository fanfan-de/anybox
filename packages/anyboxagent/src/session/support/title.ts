import * as Log from "#util/log.ts"
import * as ModelRegistry from "#model/registry.ts"
import * as ModelRuntime from "#model/runtime.ts"
import * as ModelSelection from "#model/selection.ts"
import * as Message from "#session/core/message.ts"
import * as Provider from "#provider/provider.ts"
import type { Model as ProviderModel } from "#provider/provider.ts"

const log = Log.create({ service: "session.title" })
const MAX_SESSION_TITLE_CHARS = 50
const SESSION_TITLE_TIMEOUT_MS = 5_000
let cachedTitlePrompt: Promise<string> | undefined

async function loadTitlePrompt() {
  cachedTitlePrompt ??= Bun.file(new URL("../../prompts/title.txt", import.meta.url)).text()
  return cachedTitlePrompt
}

async function getGenerateText() {
  return (await import("ai")).generateText
}

const defaultRuntimeDependencies = {
  getGenerateText,
  loadTitlePrompt,
}
let runtimeDependencies = defaultRuntimeDependencies

export function setRuntimeDependenciesForTesting(
  overrides: Partial<typeof defaultRuntimeDependencies>,
) {
  const previous = runtimeDependencies
  runtimeDependencies = {
    ...previous,
    ...overrides,
  }

  return () => {
    runtimeDependencies = previous
  }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function truncateTitle(value: string, maxChars = MAX_SESSION_TITLE_CHARS) {
  const normalized = normalizeWhitespace(value)
  if (!normalized) return ""

  const chars = [...normalized]
  if (chars.length <= maxChars) return normalized
  return chars.slice(0, maxChars).join("").trim()
}

function normalizeGeneratedTitle(value: string) {
  const firstLine =
    value
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? ""

  const unquoted = firstLine.replace(/^[`"']+|[`"']+$/g, "").trim()
  return truncateTitle(unquoted)
}

function summarizeUserInput(parts: Message.Part[]) {
  const textBlocks: string[] = []
  const attachmentNames: string[] = []

  for (const part of parts) {
    if (part.type === "text") {
      const trimmed = part.text.trim()
      if (trimmed) textBlocks.push(trimmed)
      continue
    }

    if (part.type === "file" || part.type === "image") {
      const trimmed = part.filename?.trim()
      if (trimmed) attachmentNames.push(trimmed)
    }
  }

  return {
    textBlocks,
    attachmentNames,
  }
}

function buildTitlePrompt(parts: Message.Part[]) {
  const summary = summarizeUserInput(parts)
  if (summary.textBlocks.length === 0 && summary.attachmentNames.length === 0) {
    return ""
  }

  return [
    summary.textBlocks.length > 0
      ? `User message:\n${summary.textBlocks.join("\n\n")}`
      : "User message:\n(none)",
    summary.attachmentNames.length > 0
      ? `Attachments:\n${summary.attachmentNames.join("\n")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function buildFallbackTitle(parts: Message.Part[]) {
  const summary = summarizeUserInput(parts)
  const primaryText = summary.textBlocks[0]
  if (primaryText) {
    return truncateTitle(primaryText)
  }

  if (summary.attachmentNames.length > 0) {
    return truncateTitle(summary.attachmentNames.join(", "))
  }

  return ""
}

async function resolveTitleModel(projectID: string, fallbackModel: ProviderModel) {
  try {
    const selection = await Provider.getSelection(projectID)
    const reference = ModelSelection.parseModelReference(selection.small_model)
    if (!reference) return fallbackModel
    return await ModelRegistry.getAISDKModel(reference.providerID, reference.modelID, projectID)
  } catch {
    return fallbackModel
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Session title generation timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function generateSessionTitle(input: {
  projectID: string
  fallbackModel: ProviderModel
  parts: Message.Part[]
}) {
  const prompt = buildTitlePrompt(input.parts)
  if (!prompt) return ""

  const fallbackTitle = buildFallbackTitle(input.parts)

  try {
    const [system, model, generateText] = await Promise.all([
      runtimeDependencies.loadTitlePrompt(),
      resolveTitleModel(input.projectID, input.fallbackModel),
      runtimeDependencies.getGenerateText(),
    ])
    const languageModel = await ModelRuntime.getLanguage(model, input.projectID)
    const result = await withTimeout(
      generateText({
        model: languageModel,
        temperature: 0,
        system,
        prompt,
      }),
      SESSION_TITLE_TIMEOUT_MS,
    )

    const title = normalizeGeneratedTitle(result.text)
    if (title) return title
  } catch (error) {
    log.warn("llm session title generation failed, using fallback title", {
      providerID: input.fallbackModel.providerID,
      modelID: input.fallbackModel.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return fallbackTitle
}

export const internal = {
  buildFallbackTitle,
  buildTitlePrompt,
  normalizeGeneratedTitle,
  truncateTitle,
}
