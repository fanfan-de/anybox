import z from "zod"
import type { JSONValue } from "@ai-sdk/provider"
import type * as Agent from "#agent/agent.ts"

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

export interface ToolSource {
  kind: "mcp"
  id: string
  name: string
  description?: string
}

export interface InitContext {
  agent?: Agent.AgentInfo
}

export interface Context {
  sessionID: string
  messageID: string
  cwd?: string
  worktree?: string
  abort?: AbortSignal
  toolCallID?: string
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
  aliases?: string[]
  capabilities?: ToolCapabilities
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
          if (runtime.formatValidationError) {
            throw new Error(runtime.formatValidationError(parsed.error), { cause: parsed.error })
          }

          throw new Error(
            `The ${id} tool was called with invalid arguments: ${parsed.error.message}. Please rewrite the input so it satisfies the expected schema.`,
            { cause: parsed.error },
          )
        }

        const validationFailure = toGuardErrorMessage(await runtime.validate?.(parsed.data, ctx))
        if (validationFailure) {
          throw new Error(validationFailure)
        }

        const authorizationFailure = toGuardErrorMessage(await runtime.authorize?.(parsed.data, ctx))
        if (authorizationFailure) {
          throw new Error(authorizationFailure)
        }

        return normalizeToolOutput(await execute(parsed.data, ctx))
      }

      if (assessPermission) {
        runtime.assessPermission = async (args, ctx) => {
          const parsed = runtime.parameters.safeParse(args)
          if (!parsed.success) {
            if (runtime.formatValidationError) {
              throw new Error(runtime.formatValidationError(parsed.error), { cause: parsed.error })
            }

            throw new Error(
              `The ${id} tool was called with invalid arguments: ${parsed.error.message}. Please rewrite the input so it satisfies the expected schema.`,
              { cause: parsed.error },
            )
          }

          return await assessPermission(parsed.data, ctx)
        }
      }

      return runtime as NormalizedToolRuntime<Parameters, Result, Data>
    },
  }
}
