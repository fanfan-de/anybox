import type { EvalCase } from "#eval/schema.ts"
import type { EvalExecution, EvalExecutionStatus, EvalToolCall } from "#eval/scorer.ts"
import type { EvalExecutor, EvalExecutorContext } from "#eval/runner.ts"
import { Instance } from "#project/instance.ts"
import * as Session from "#session/core/session.ts"
import * as Prompt from "#session/core/prompt.ts"
import * as Message from "#session/core/message.ts"

export type StaticEvalResponse =
  | string
  | Partial<EvalExecution>
  | ((testCase: EvalCase, context: EvalExecutorContext) => string | Partial<EvalExecution> | Promise<string | Partial<EvalExecution>>)

function nowExecution(partial: Partial<EvalExecution>): EvalExecution {
  const startedAt = partial.startedAt ?? Date.now()
  const endedAt = partial.endedAt ?? startedAt
  return {
    outputText: partial.outputText ?? "",
    status: partial.status ?? "completed",
    startedAt,
    endedAt,
    durationMs: partial.durationMs ?? Math.max(0, endedAt - startedAt),
    toolCalls: partial.toolCalls,
    usage: partial.usage,
    cost: partial.cost,
    error: partial.error,
    metadata: partial.metadata,
  }
}

export function createStaticExecutor(responses: Record<string, StaticEvalResponse>): EvalExecutor {
  return {
    async run(testCase, context) {
      const response = responses[testCase.id]
      if (response === undefined) {
        throw new Error(`No static eval response configured for case '${testCase.id}'.`)
      }

      const resolved = typeof response === "function"
        ? await response(testCase, context)
        : response
      if (typeof resolved === "string") {
        return nowExecution({ outputText: resolved })
      }
      return nowExecution(resolved)
    },
  }
}

function textFromParts(parts: Message.Part[]) {
  return parts
    .filter((part): part is Message.TextPart => part.type === "text")
    .map((part) => part.text)
    .join("")
}

function toolCallsFromParts(parts: Message.Part[]): EvalToolCall[] {
  return parts
    .filter((part): part is Message.ToolPart => part.type === "tool")
    .map((part) => {
      const outcome = Message.toolPartOutcome(part)
      const returned = Message.toolPartReturnedOutcome(part)
      return {
        name: part.tool,
        input: Message.toolPartInput(part),
        output: returned?.output,
        phase: part.state.phase,
        outcome: outcome?.kind,
        result: returned?.result,
        completeness: returned?.completeness,
        turnControl: part.state.phase === "settled" ? part.state.control.mode : undefined,
        startedAt: part.timestamps.startedAt,
        endedAt: part.timestamps.settledAt,
        metadata: Message.toolPartMetadata(part),
      }
    })
}

function statusFromAssistant(result: Message.WithParts): EvalExecutionStatus {
  const blocked = result.parts.some((part) =>
    part.type === "tool" && part.state.phase === "waiting-approval"
  )
  if (blocked) return "blocked"
  if (result.info.role === "assistant" && result.info.error) return "failed"
  return "completed"
}

function errorFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function createPromptExecutor(options: { directory: string }): EvalExecutor {
  return {
    async run(testCase) {
      const startedAt = Date.now()
      try {
        return await Instance.provide({
          directory: options.directory,
          async fn() {
            const session = await Session.createSession({
              directory: Instance.directory,
              projectID: Instance.project.id,
            })
            const result = await Prompt.prompt({
              sessionID: session.id,
              system: testCase.input.system,
              agent: testCase.input.agent,
              skills: testCase.input.skills,
              model: testCase.input.model,
              parts: [
                {
                  type: "text",
                  text: testCase.input.prompt,
                  time: {
                    start: startedAt,
                  },
                },
              ],
            })
            const endedAt = Date.now()
            return {
              outputText: textFromParts(result.parts),
              status: statusFromAssistant(result),
              startedAt,
              endedAt,
              durationMs: endedAt - startedAt,
              toolCalls: toolCallsFromParts(result.parts),
              usage: result.info.role === "assistant"
                ? {
                    input: result.info.tokens.input,
                    output: result.info.tokens.output,
                    reasoning: result.info.tokens.reasoning,
                    cacheRead: result.info.tokens.cache.read,
                    cacheWrite: result.info.tokens.cache.write,
                  }
                : undefined,
              cost: result.info.role === "assistant" ? result.info.cost : undefined,
              metadata: {
                sessionID: session.id,
                assistantMessageID: result.info.id,
                projectID: Instance.project.id,
              },
            } satisfies EvalExecution
          },
        })
      } catch (error) {
        const endedAt = Date.now()
        return {
          outputText: "",
          status: "failed",
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
          error: errorFromUnknown(error),
          metadata: {
            caseID: testCase.id,
          },
        }
      }
    },
  }
}
