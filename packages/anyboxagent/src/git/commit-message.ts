import { generateText } from "ai"
import type { LanguageModel } from "ai"
import type { GitCommitMessageContext } from "#git/git.ts"
import * as Provider from "#provider/provider.ts"
import * as ProviderTransform from "#provider/transform.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "git.commit-message" })
const COMMIT_MESSAGE_TIMEOUT_MS = 10_000
const MAX_COMMIT_MESSAGE_CHARS = 72

type GenerateTextFunction = typeof generateText
type GetLanguageFunction = typeof Provider.getLanguage

class GitCommitMessageError extends Error {
  readonly code: "EMPTY" | "FAILED"

  constructor(code: "EMPTY" | "FAILED", message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "GitCommitMessageError"
    this.code = code
  }
}

const defaultRuntimeDependencies = {
  getGenerateText: async () => generateText,
  getLanguage: Provider.getLanguage,
}

let runtimeDependencies = defaultRuntimeDependencies

export function setRuntimeDependenciesForTesting(
  overrides: Partial<{
    getGenerateText: () => Promise<GenerateTextFunction>
    getLanguage: GetLanguageFunction
  }>,
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

function truncateCommitMessage(value: string) {
  const normalized = normalizeWhitespace(value)
  if (!normalized) return ""

  const chars = [...normalized]
  if (chars.length <= MAX_COMMIT_MESSAGE_CHARS) return normalized
  return chars.slice(0, MAX_COMMIT_MESSAGE_CHARS).join("").trim()
}

function normalizeGeneratedCommitMessage(value: string) {
  const firstLine =
    value
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("```")) ?? ""

  const cleaned = firstLine
    .replace(/^[-*]\s+/, "")
    .replace(/^commit message:\s*/i, "")
    .replace(/^[`"']+|[`"']+$/g, "")
    .trim()

  return truncateCommitMessage(cleaned)
}

function buildCommitMessagePrompt(context: GitCommitMessageContext) {
  return [
    "Generate a commit subject for this Git change.",
    "",
    context.content,
  ].join("\n")
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Commit message generation timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function getCommitMessageTemperature(model: Provider.Model) {
  if (!model.capabilities.temperature) return undefined
  if (ProviderTransform.isProviderReasoningModel(model)) return undefined
  return 0
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  return String(error)
}

export async function generateGitCommitMessage(input: {
  projectID: string
  model: Provider.Model
  context: GitCommitMessageContext
  systemPrompt: string
}) {
  try {
    const [languageModel, generate] = await Promise.all([
      runtimeDependencies.getLanguage(input.model, input.projectID) as Promise<LanguageModel>,
      runtimeDependencies.getGenerateText(),
    ])
    const temperature = getCommitMessageTemperature(input.model)
    const result = await withTimeout(
      generate({
        model: languageModel,
        ...(temperature === undefined ? {} : { temperature }),
        system: input.systemPrompt,
        prompt: buildCommitMessagePrompt(input.context),
      }),
      COMMIT_MESSAGE_TIMEOUT_MS,
    )

    const message = normalizeGeneratedCommitMessage(result.text)
    if (!message) {
      throw new GitCommitMessageError("EMPTY", "Model returned an empty commit message.")
    }

    return {
      message,
    }
  } catch (error) {
    if (error instanceof GitCommitMessageError) throw error
    log.warn("git commit message generation failed", {
      providerID: input.model.providerID,
      modelID: input.model.id,
      error: getErrorMessage(error),
    })
    throw new GitCommitMessageError(
      "FAILED",
      `Commit message generation failed: ${getErrorMessage(error)}`,
      error instanceof Error ? { cause: error } : undefined,
    )
  }
}

export const internal = {
  GitCommitMessageError,
  normalizeGeneratedCommitMessage,
  truncateCommitMessage,
}
