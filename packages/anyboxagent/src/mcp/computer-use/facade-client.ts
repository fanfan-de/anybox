import { createRequire } from "node:module"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type {
  McpClientLike,
  McpToolCallResult,
  McpToolDefinition,
  McpToolRequestContext,
} from "#mcp/client.ts"
import { ComputerUseBrokerError } from "./errors.ts"
import { computerUseBroker } from "./broker.ts"

interface FacadeModule {
  ComputerUseServer: new (options: Record<string, unknown>) => {
    toolDefinitions(): McpToolDefinition[]
    callTool(
      name: string,
      args: Record<string, unknown>,
      context: { signal?: AbortSignal },
    ): Promise<McpToolCallResult>
    close(): void
  }
  errorResult(error: unknown): McpToolCallResult
}

function resolveFacadePath() {
  const root = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(root, "mcp", "computer-use", "server.js"),
    resolve(root, "..", "..", "..", "..", "..", "plugins", "Anybox-Plugins", "computer-use-windows", "scripts", "server.js"),
  ]
  return candidates.find(existsSync) ?? candidates[0]!
}

function loadFacade() {
  const path = resolveFacadePath()
  if (!existsSync(path)) {
    throw new Error("The host-bundled Computer Use facade is missing.")
  }
  return createRequire(import.meta.url)(path) as FacadeModule
}

export class ComputerUseFacadeClient implements McpClientLike {
  private readonly module = loadFacade()
  private readonly broker = computerUseBroker()
  private readonly server = new this.module.ComputerUseServer({
    helper: this.broker.helper,
  })

  async listTools() {
    return this.server.toolDefinitions()
  }

  async listResources() {
    return []
  }

  async listResourceTemplates() {
    return []
  }

  async readResource(_uri: string, _abort?: AbortSignal): Promise<never> {
    throw new Error("Computer Use does not expose MCP resources.")
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown> | undefined,
    abort?: AbortSignal,
    context?: McpToolRequestContext,
  ) {
    try {
      return await this.broker.runTool(
        toolName,
        context,
        abort,
        () => this.server.callTool(toolName, args ?? {}, { signal: abort }),
      )
    } catch (error) {
      if (error instanceof ComputerUseBrokerError) {
        const facadeErrors = createRequire(import.meta.url)(
          resolve(dirname(resolveFacadePath()), "lib", "errors.js"),
        ) as {
          cuError(code: string, message: string, options: Record<string, unknown>): Error
        }
        return this.module.errorResult(facadeErrors.cuError(
          error.code,
          error.message,
          {
            retryable: error.retryable,
            requiresFreshState: error.requiresFreshState,
            effectMayHaveOccurred: error.effectMayHaveOccurred,
          },
        ))
      }
      return this.module.errorResult(error)
    }
  }

  async notifyLifecycle(input: {
    type: string
    context: { sessionID: string; turnID: string }
  }) {
    if (input.type === "turn-end") {
      await this.broker.finishTurn(input.context, "turn-terminal")
    }
  }

  async dispose() {
    this.server.close()
  }
}
