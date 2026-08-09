import z from "zod"
import type { JSONValue } from "@ai-sdk/provider"
import type {
  ToolCallExecutionSemantics,
  ToolCallFailure,
  ToolCallResultCompleteness,
  ToolCallResultPolarity,
  ToolCallReturnedOutcome,
  ToolCallSideEffectCertainty,
  ToolCallRetrySafety,
  ToolCallOutcome,
  ToolCallTurnControl,
  ToolModuleProviderKind,
} from "@anybox/shared"
import type * as Agent from "#agent/agent.ts"
import type * as Provider from "#provider/provider.ts"

type Metadata = Record<string, unknown>
export type Awaitable<T> = T | Promise<T>

export type ToolKind =
  | "read"
  | "write"
  | "search"
  | "exec"
  | "workflow"
  | "interaction"
  | "delegation"
  | "other"
export type ToolConcurrency = "safe" | "exclusive"

export interface ToolCapabilities {
  kind?: ToolKind
  readOnly?: boolean
  destructive?: boolean
  concurrency?: ToolConcurrency
  needsShell?: boolean
}

export type ToolModelInputModality = keyof Provider.Model["capabilities"]["input"]

export interface ToolModelRequirements {
  inputModalities?: ToolModelInputModality[]
}

export function getModelRequirementFailure(
  item: Pick<ToolInfo, "id" | "modelRequirements">,
  model?: Provider.Model,
) {
  if (!model) return undefined

  const missing = (item.modelRequirements?.inputModalities ?? [])
    .filter((modality) => model.capabilities.input[modality] !== true)
  if (missing.length === 0) return undefined

  const requirement = missing.join(", ")
  const suggestion = missing.includes("image")
    ? " Select a multimodal model with image input to use this tool."
    : " Select a model that supports the required input modalities."
  return `Tool "${item.id}" requires model input support for: ${requirement}.${suggestion}`
}

export interface ToolProviderSource {
  kind: ToolModuleProviderKind
  id: string
  name?: string
}

interface ToolModuleSourceMetadata {
  /** Stable capability module ownership. Optional only for legacy callers during migration. */
  moduleID?: string
  /** Transport/loading provenance. Module ownership and provider transport are intentionally separate. */
  provider?: ToolProviderSource
}

export type ToolSource = ToolModuleSourceMetadata & (
  | {
      kind: "mcp"
      id: string
      name: string
      description?: string
    }
  | {
      kind: "native-module"
      id: string
      name: string
      description?: string
    }
  | {
      kind: "builtin-module"
      id: string
      name: string
      description?: string
    }
  | {
      kind: "custom-module"
      id: string
      name: string
      description?: string
    }
  | {
      kind: "plugin-module"
      id: string
      name: string
      description?: string
    }
)

export interface InitContext {
  agent?: Agent.AgentInfo
  model?: Provider.Model
}

export interface Context {
  sessionID: string
  // Optional for legacy direct callers during the v1/v2 migration. Production
  // turn execution always supplies it and Browser Contract v2 requires it.
  turnID?: string
  messageID: string
  cwd?: string
  worktree?: string
  abort?: AbortSignal
  toolCallID?: string
  model?: Provider.Model
}

export interface ToolAttachment<M extends Metadata = Metadata> {
  url: string
  mime: string
  filename?: string
  metadata?: M
}

export interface ToolApprovalDetails {
  command?: string
  paths?: string[]
  workdir?: string
  body?: string
}

export interface ToolPermissionIntent {
  action?: "allow" | "ask" | "deny"
  risk?: "low" | "medium" | "high" | "critical"
  reason?: string
  resource?: ToolApprovalDetails
  allowInPlanning?: boolean
  forceAsk?: boolean
}

export interface ToolApprovalDescriptor {
  title?: string
  summary: string
  details?: ToolApprovalDetails
}

export interface ToolOutput<M extends Metadata = Metadata, D = unknown> {
  text: string
  title?: string
  metadata?: M
  data?: D
  attachments?: ToolAttachment<M>[]
  result?: ToolCallResultPolarity
  completeness?: ToolCallResultCompleteness
  sideEffect?: ToolCallSideEffectCertainty
  retry?: ToolCallRetrySafety
  control?: ToolCallTurnControl
}

export class ToolControlSignal extends Error {
  readonly outcome: Exclude<ToolCallOutcome, ToolCallReturnedOutcome | { kind: "failed" }>
  readonly control: ToolCallTurnControl

  constructor(
    outcome: Exclude<ToolCallOutcome, ToolCallReturnedOutcome | { kind: "failed" }>,
    control: ToolCallTurnControl,
  ) {
    super(outcome.reason)
    this.name = "ToolControlSignal"
    this.outcome = outcome
    this.control = control
  }
}

export function isToolControlSignal(value: unknown): value is ToolControlSignal {
  return value instanceof ToolControlSignal
}

export function findToolControlSignal(value: unknown): ToolControlSignal | undefined {
  let current = value
  const seen = new Set<unknown>()
  for (let depth = 0; depth < 4 && current && !seen.has(current); depth += 1) {
    if (isToolControlSignal(current)) return current
    seen.add(current)
    if (current instanceof Error) {
      current = current.cause
      continue
    }
    if (typeof current === "object" && !Array.isArray(current) && "cause" in current) {
      current = (current as { cause?: unknown }).cause
      continue
    }
    break
  }
  return undefined
}

export function toolExecutionSemantics(
  capabilities?: ToolCapabilities,
  overrides?: Partial<ToolCallExecutionSemantics>,
): ToolCallExecutionSemantics {
  const readOnly = capabilities?.readOnly === true
  return {
    sideEffect: overrides?.sideEffect ?? (readOnly ? "none" : "possible"),
    retry: overrides?.retry ?? (readOnly ? "safe" : capabilities?.destructive ? "unsafe" : "unknown"),
  }
}

type ToolFailureOverrides = Partial<Omit<ToolCallFailure, "message">> & { message?: string }

function buildToolFailure(
  value: unknown,
  overrides: ToolFailureOverrides = {},
): ToolCallFailure {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : undefined
  const inferredCode = typeof record?.code === "string" && record.code.trim()
    ? record.code.trim()
    : undefined
  const inferredMessage = value instanceof Error
    ? value.message
    : typeof value === "string"
      ? value
      : undefined

  return {
    stage: overrides.stage ?? "execution",
    source: overrides.source ?? "tool",
    code: overrides.code?.trim() || inferredCode || "TOOL_EXECUTION_ERROR",
    message: overrides.message?.trim() || inferredMessage?.trim() || "Tool execution failed.",
    handlerExecuted: overrides.handlerExecuted ?? true,
    retryable: overrides.retryable ?? false,
    severity: overrides.severity ?? "recoverable",
    details: overrides.details,
  }
}

export class ToolFailureError extends Error {
  readonly failure: ToolCallFailure
  readonly partialOutput?: unknown

  constructor(
    value: unknown,
    overrides: ToolFailureOverrides = {},
    options: { partialOutput?: unknown } = {},
  ) {
    const failure = buildToolFailure(value, overrides)
    super(failure.message, value instanceof Error ? { cause: value } : undefined)
    this.name = "ToolFailureError"
    this.failure = failure
    this.partialOutput = options.partialOutput
  }
}

export function findToolFailureError(value: unknown): ToolFailureError | undefined {
  let current = value
  const seen = new Set<unknown>()
  for (let depth = 0; depth < 4 && current && !seen.has(current); depth += 1) {
    if (current instanceof ToolFailureError) return current
    seen.add(current)
    if (current instanceof Error) {
      current = current.cause
      continue
    }
    if (typeof current === "object" && !Array.isArray(current) && "cause" in current) {
      current = (current as { cause?: unknown }).cause
      continue
    }
    break
  }
  return undefined
}

export function toolFailure(
  value: unknown,
  overrides: ToolFailureOverrides = {},
): ToolCallFailure {
  const structured = findToolFailureError(value)?.failure
  return buildToolFailure(value, {
    ...structured,
    ...overrides,
    message: overrides.message ?? structured?.message,
  })
}

export function returnedToolOutcome(
  output: ToolOutput,
  options?: {
    capabilities?: ToolCapabilities
    modelOutput?: unknown
    attachments?: unknown[]
  },
): ToolCallReturnedOutcome {
  return {
    kind: "returned",
    result: output.result ?? "success",
    completeness: output.completeness ?? "complete",
    output: output.text,
    modelOutput: options?.modelOutput,
    title: output.title,
    metadata: output.metadata,
    attachments: options?.attachments ?? output.attachments,
    execution: toolExecutionSemantics(output ? options?.capabilities : undefined, {
      sideEffect: output.sideEffect,
      retry: output.retry,
    }),
  }
}

export type ToolGuardResult =
  | void
  | string
  | {
    message: string
  }

export type ToolModelOutput =
  | string
  | { type: "text"; value: string }
  | { type: "json"; value: JSONValue }
  | {
      type: "content"
      value: Array<
        | { type: "text"; text: string }
        | {
            type: "file"
            data: { type: "data"; data: Uint8Array }
            mediaType: string
            filename?: string
          }
      >
    }
  | { type: "error-text"; value: string }
  | { type: "error-json"; value: JSONValue }
  | { type: "execution-denied"; reason?: string }
export interface ToolRuntime<
  Parameters extends z.ZodType = z.ZodType,
  M extends Metadata = Metadata,
  D = unknown,
> {
  description: string
  title?: string
  parameters: Parameters
  execute(
    args: z.infer<Parameters>,
    ctx: Context,
  ): Awaitable<ToolOutput<M, D> | string>

  formatValidationError?(error: z.ZodError): string
  validate?(args: z.infer<Parameters>, ctx: Context): Promise<ToolGuardResult> | ToolGuardResult
  authorize?(args: z.infer<Parameters>, ctx: Context): Promise<ToolGuardResult> | ToolGuardResult
  assessPermission?(
    args: z.infer<Parameters>,
    ctx: Context,
  ): Awaitable<ToolPermissionIntent>
  describeApproval?(
    args: z.infer<Parameters>,
    ctx: Context,
  ): Awaitable<ToolApprovalDescriptor>
  toModelOutput?(
    result: ToolOutput<M, D>,
  ): Awaitable<ToolModelOutput>
}

export interface NormalizedToolRuntime<
  Parameters extends z.ZodType = z.ZodType,
  M extends Metadata = Metadata,
  D = unknown,
> extends Omit<ToolRuntime<Parameters, M, D>, "execute"> {
  execute(
    args: z.infer<Parameters>,
    ctx: Context,
  ): Awaitable<ToolOutput<M, D>>
}

export interface ToolInfo<
  Parameters extends z.ZodType = z.ZodType,
  M extends Metadata = Metadata,
  D = unknown,
> {
  id: string
  title?: string
  description?: string
  aliases?: string[]
  /** Used for built-ins when global selection has no explicit state. Defaults to true. */
  defaultEnabled?: boolean
  capabilities?: ToolCapabilities
  modelRequirements?: ToolModelRequirements
  source?: ToolSource
  inputSchema?: Record<string, unknown>
  maxResultSizeChars?: number
  init: (ctx?: InitContext) => Promise<NormalizedToolRuntime<Parameters, M, D>>
}

type ToolDefineOptions<
  Parameters extends z.ZodType = z.ZodType,
  M extends Metadata = Metadata,
  D = unknown,
> = Omit<ToolInfo<Parameters, M, D>, "id" | "init">

export function toModelToolName(name: string): string {
  const normalized = name
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()

  return normalized || "tool"
}

function toGuardErrorMessage(result: ToolGuardResult): string | undefined {
  if (typeof result === "string") {
    const message = result.trim()
    return message ? message : undefined
  }

  if (result && typeof result === "object" && typeof result.message === "string") {
    const message = result.message.trim()
    return message ? message : undefined
  }

  return undefined
}

export function toolMatchesName(
  tool: Pick<ToolInfo, "id" | "aliases">,
  name: string,
): boolean {
  if (tool.id === name || (tool.aliases?.includes(name) ?? false)) return true

  const modelName = toModelToolName(name)
  return (
    toModelToolName(tool.id) === modelName ||
    (tool.aliases?.some((alias) => toModelToolName(alias) === modelName) ?? false)
  )
}

export function normalizeToolOutput<M extends Metadata = Metadata, D = unknown>(
  result: ToolOutput<M, D> | string,
): ToolOutput<M, D> {
  if (typeof result === "string") {
    return { text: result }
  }

  return {
    text: result.text,
    title: result.title,
    metadata: result.metadata,
    data: result.data,
    attachments: result.attachments,
    result: result.result,
    completeness: result.completeness,
    sideEffect: result.sideEffect,
    retry: result.retry,
    control: result.control,
  }
}

export function normalizeToolModelOutput(output: ToolModelOutput): Exclude<ToolModelOutput, string> {
  if (typeof output === "string") {
    return {
      type: "text",
      value: output,
    }
  }

  return output
}
/**
 * 创建工具定义，并为其运行时包装参数校验、守卫检查和输出标准化逻辑。
 *
 * @param id 对外暴露给调用方的稳定工具标识。
 * @param init 根据初始化上下文构建工具运行时的工厂函数。
 * @param options 会合并到返回结果中的静态工具元数据。
 * @returns 一个工具定义；其 execute 方法会执行参数校验、鉴权检查并标准化返回结果。
 */
export function define<Parameters extends z.ZodType, Result extends Metadata, Data = unknown>(
  id: string,
  init: (ctx?: InitContext) => Promise<ToolRuntime<Parameters, Result, Data>>,
  options: ToolDefineOptions<Parameters, Result, Data> = {},
): ToolInfo<Parameters, Result, Data> {
  return {
    id,
    ...options,
    init: async (initctx): Promise<NormalizedToolRuntime<Parameters, Result, Data>> => {
      const runtime = await init(initctx)
      const execute = runtime.execute
      const assessPermission = runtime.assessPermission

      runtime.execute = async (args, ctx) => {
        const parsed = runtime.parameters.safeParse(args)
        if (!parsed.success) {
          const message = runtime.formatValidationError?.(parsed.error) ??
            `The ${id} tool was called with invalid arguments: ${parsed.error.message}. Please rewrite the input so it satisfies the expected schema.`
          throw new ToolControlSignal({
            kind: "blocked",
            reason: message,
            code: "TOOL_INPUT_VALIDATION_BLOCKED",
            execution: toolExecutionSemantics(options.capabilities, {
              sideEffect: "none",
              retry: "safe",
            }),
          }, { mode: "continue-model", reason: message })
        }

        const validationFailure = toGuardErrorMessage(await runtime.validate?.(parsed.data, ctx))
        if (validationFailure) {
          throw new ToolControlSignal({
            kind: "blocked",
            reason: validationFailure,
            code: "TOOL_PRECONDITION_BLOCKED",
            execution: toolExecutionSemantics(options.capabilities, {
              sideEffect: "none",
              retry: "safe",
            }),
          }, { mode: "continue-model", reason: validationFailure })
        }

        const authorizationFailure = toGuardErrorMessage(await runtime.authorize?.(parsed.data, ctx))
        if (authorizationFailure) {
          throw new ToolControlSignal({
            kind: "blocked",
            reason: authorizationFailure,
            code: "TOOL_AUTHORIZATION_BLOCKED",
            execution: toolExecutionSemantics(options.capabilities, {
              sideEffect: "none",
              retry: "safe",
            }),
          }, { mode: "continue-model", reason: authorizationFailure })
        }

        return normalizeToolOutput(await execute(parsed.data, ctx))
      }

      if (assessPermission) {
        runtime.assessPermission = async (args, ctx) => {
          const parsed = runtime.parameters.safeParse(args)
          if (!parsed.success) {
            const message = runtime.formatValidationError?.(parsed.error) ??
              `The ${id} tool was called with invalid arguments: ${parsed.error.message}. Please rewrite the input so it satisfies the expected schema.`
            throw new ToolControlSignal({
              kind: "blocked",
              reason: message,
              code: "TOOL_INPUT_VALIDATION_BLOCKED",
              execution: toolExecutionSemantics(options.capabilities, {
                sideEffect: "none",
                retry: "safe",
              }),
            }, { mode: "continue-model", reason: message })
          }

          return await assessPermission(parsed.data, ctx)
        }
      }

      return runtime as NormalizedToolRuntime<Parameters, Result, Data>
    },
  }
}
