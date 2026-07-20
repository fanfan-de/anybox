import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { McpToolRequestContext } from "#mcp/client.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"
import { ComputerUseHelperTransport } from "./helper-transport.ts"
import { computerUseError, ComputerUseBrokerError } from "./errors.ts"
import { ComputerUseTurnLease } from "./turn-lease.ts"
import { recordComputerUseTelemetry } from "./telemetry.ts"
import {
  allowComputerUseApp,
  evaluateComputerUseAdminPolicy,
  getComputerUseAppDecision,
} from "./app-policy.ts"

interface BrokerToolContext {
  sessionID: string
  turnID: string
  messageID: string
  toolCallID: string
  signal?: AbortSignal
  toolName: string
}

interface RawApp {
  appId?: string
  displayName?: string
}

const TERMINAL_EVENTS = new Set([
  "turn.completed",
  "turn.failed",
  "turn.cancelled",
])

const UNLEASED_METHODS = new Set([
  "health_check",
  "list_apps",
  "list_windows",
])

function runtimeRoot() {
  return dirname(fileURLToPath(import.meta.url))
}

export function resolveComputerUseHelperPath() {
  const candidates = [
    resolve(runtimeRoot(), "computer-use", "win32-x64", "computer-use-helper.exe"),
    resolve(runtimeRoot(), "..", "..", "..", "..", "..", "plugins", "Anybox-Plugins", "computer-use-windows", "helper", "win32-x64", "computer-use-helper.exe"),
  ]
  return candidates.find(existsSync) ?? candidates[0]!
}

export class ComputerUseBroker {
  private readonly context = new AsyncLocalStorage<BrokerToolContext>()
  private readonly lease = new ComputerUseTurnLease()
  private readonly apps = new Map<string, string>()
  private readonly windows = new Map<string, { appID: string; displayName: string }>()
  private readonly transport: ComputerUseHelperTransport
  private activeAppID?: string
  private readonly unsubscribe: () => void
  private readonly watchdog: ReturnType<typeof setInterval>

  constructor(helperPath = resolveComputerUseHelperPath()) {
    this.transport = new ComputerUseHelperTransport(
      helperPath,
      () => this.interrupt(undefined, "physical-escape"),
    )
    this.unsubscribe = EventStore.subscribe((event) => {
      if (!TERMINAL_EVENTS.has(event.type)) return
      const active = this.lease.active()
      if (
        !active
        || active.sessionID !== event.sessionID
        || active.turnID !== event.turnID
      ) {
        return
      }
      void this.finishTurn(
        { sessionID: event.sessionID, turnID: event.turnID },
        "turn-terminal",
      )
    })
    this.watchdog = setInterval(() => {
      const active = this.lease.active()
      if (!active || Date.now() - active.touchedAt < 10 * 60_000) return
      void this.finishTurn(active, "expired")
    }, 30_000)
    this.watchdog.unref?.()
  }

  available() {
    return this.transport.available()
  }

  runTool<T>(
    toolName: string,
    context: McpToolRequestContext | undefined,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ) {
    const sessionID = context?.sessionID?.trim()
    const turnID = context?.turnID?.trim()
    const toolCallID = context?.toolCallID?.trim()
    const messageID = context?.messageID?.trim()
    if (!sessionID || !turnID || !messageID || !toolCallID) {
      throw computerUseError(
        "CU_PROTOCOL_MISMATCH",
        "Computer Use requires session, turn, message, and tool-call identity.",
      )
    }
    return this.context.run(
      {
        sessionID,
        turnID,
        messageID,
        toolCallID,
        signal,
        toolName,
      },
      operation,
    )
  }

  readonly helper = {
    ensureInitialized: async () => await this.transport.ensureInitialized(),
    call: async (
      method: string,
      params: Record<string, unknown> = {},
      options: { signal?: AbortSignal; timeoutMs?: number } = {},
    ) => {
      const context = this.context.getStore()
      if (!context) {
        throw computerUseError(
          "CU_PROTOCOL_MISMATCH",
          "Computer Use helper calls must originate from a bound MCP tool call.",
        )
      }
      if (!UNLEASED_METHODS.has(method)) {
        const { lease, created } = this.lease.acquire(context)
        const app = this.resolveApp(method, params)
        try {
          if (app) {
            await this.assertAppApproval(context, app)
          }
        } catch (error) {
          if (created) this.lease.release(context)
          throw error
        }
        if (created) {
          this.emit(context.sessionID, "computer.use.started", {
            leaseID: lease.leaseID,
            ...(app?.appID ? { appID: app.appID } : {}),
            ...(app?.displayName ? { appDisplayName: app.displayName } : {}),
          })
        }
        if (app?.appID && app.appID !== this.activeAppID) {
          this.activeAppID = app.appID
          this.emit(context.sessionID, "computer.use.app_changed", {
            leaseID: lease.leaseID,
            appID: app.appID,
            appDisplayName: app.displayName,
          })
        }
      }

      const startedAt = Date.now()
      const app = this.resolveApp(method, params)
      try {
        const result = await this.transport.call(method, params, {
          context: {
            sessionID: context.sessionID,
            turnID: context.turnID,
            toolCallID: context.toolCallID,
          },
          signal: options.signal ?? context.signal,
          timeoutMs: options.timeoutMs,
        })
        this.rememberApps(method, result)
        recordComputerUseTelemetry({
          sessionID: context.sessionID,
          turnID: context.turnID,
          toolCallID: context.toolCallID,
          toolName: context.toolName,
          operation: method,
          appID: app?.appID,
          windowRef:
            typeof params.windowRef === "string" ? params.windowRef : undefined,
          stateRef:
            typeof params.stateRef === "string" ? params.stateRef : undefined,
          durationMs: Date.now() - startedAt,
          resultCode: "OK",
          helperVersion: this.transport.version(),
        })
        return result
      } catch (error) {
        recordComputerUseTelemetry({
          sessionID: context.sessionID,
          turnID: context.turnID,
          toolCallID: context.toolCallID,
          toolName: context.toolName,
          operation: method,
          appID: app?.appID,
          windowRef:
            typeof params.windowRef === "string" ? params.windowRef : undefined,
          stateRef:
            typeof params.stateRef === "string" ? params.stateRef : undefined,
          durationMs: Date.now() - startedAt,
          resultCode:
            error instanceof ComputerUseBrokerError
              ? error.code
              : "CU_INTERNAL_ERROR",
          helperVersion: this.transport.version(),
          effectMayHaveOccurred:
            error instanceof ComputerUseBrokerError
              ? error.effectMayHaveOccurred
              : undefined,
        })
        throw error
      }
    },
    // The facade is per-MCP-manager, while the trusted helper belongs to the host.
    stop: () => undefined,
  }

  interrupt(
    identity?: { sessionID: string; turnID: string },
    reason: "physical-escape" | "desktop-escape" | "user" | "shutdown" = "user",
  ) {
    const active = this.lease.interrupt(identity)
    if (!active) return false
    this.transport.stop(computerUseError(
      "CU_INTERRUPTED",
      "Computer Use was interrupted by the user.",
    ))
    this.emit(active.sessionID, "computer.use.interrupted", {
      leaseID: active.leaseID,
      reason,
    })
    void import("#session/core/prompt.ts")
      .then((prompt) => {
        prompt.cancelSession(active.sessionID, {
          cancelQueued: true,
          reason: "user",
        })
      })
      .catch(() => undefined)
    return true
  }

  async finishTurn(
    identity: { sessionID: string; turnID: string },
    reason: "turn-terminal" | "interrupted" | "expired" | "shutdown",
  ) {
    const active = this.lease.active()
    if (
      !active
      || active.sessionID !== identity.sessionID
      || active.turnID !== identity.turnID
    ) {
      return false
    }
    if (!active.interrupted) {
      try {
        await this.transport.call("end_turn", {}, {
          context: {
            sessionID: active.sessionID,
            turnID: active.turnID,
            toolCallID: "host_end_turn",
          },
          timeoutMs: 2_000,
        })
      } catch {
        // Lease release remains authoritative if helper cleanup cannot be delivered.
      }
    }
    this.lease.release(identity)
    this.activeAppID = undefined
    this.emit(identity.sessionID, "computer.use.stopped", {
      leaseID: active.leaseID,
      reason: active.interrupted ? "interrupted" : reason,
    })
    return true
  }

  dispose() {
    this.unsubscribe()
    clearInterval(this.watchdog)
    const active = this.lease.release()
    this.transport.stop(computerUseError("CU_INTERRUPTED", "Computer Use broker shut down."))
    if (active) {
      this.emit(active.sessionID, "computer.use.stopped", {
        leaseID: active.leaseID,
        reason: "shutdown",
      })
    }
  }

  private rememberApps(method: string, value: unknown) {
    const record = asRecord(value)
    if (method === "list_apps") {
      for (const item of Array.isArray(record.apps) ? record.apps : []) {
        const app = asRecord(item) as RawApp
        if (app.appId && app.displayName) this.apps.set(app.appId, app.displayName)
        for (const window of Array.isArray(asRecord(item).windows)
          ? asRecord(item).windows
          : []) {
          this.rememberWindow(window)
        }
      }
    }
    if (method === "list_windows") {
      for (const window of Array.isArray(record.windows) ? record.windows : []) {
        this.rememberWindow(window)
      }
    }
    if (record.window) this.rememberWindow(record.window)
  }

  private resolveApp(method: string, params: Record<string, unknown>) {
    const expected = asRecord(params.expectedIdentity)
    const knownWindow = this.windows.get(this.windowIdentityKey(expected))
    const appID = knownWindow?.appID ?? (
      typeof expected.appId === "string"
      ? expected.appId
      : method === "launch_app" && typeof params.appId === "string"
        ? params.appId
        : undefined
    )
    if (!appID) return undefined
    return {
      appID,
      displayName: knownWindow?.displayName ?? this.apps.get(appID) ?? (
        typeof expected.processName === "string" ? expected.processName : appID
      ),
    }
  }

  private rememberWindow(value: unknown) {
    const window = asRecord(value)
    const appID = typeof window.appId === "string" ? window.appId : undefined
    if (!appID) return
    const displayName = this.apps.get(appID) ?? (
      typeof window.processName === "string" ? window.processName : appID
    )
    this.apps.set(appID, displayName)
    const key = this.windowIdentityKey(asRecord(window.identity))
    if (key) {
      if (this.windows.size >= 2_000 && !this.windows.has(key)) {
        this.windows.delete(this.windows.keys().next().value ?? "")
      }
      this.windows.set(key, { appID, displayName })
    }
  }

  private windowIdentityKey(identity: Record<string, unknown>) {
    const keys = [
      "hwnd",
      "pid",
      "processStartTime",
      "rootOwnerHwnd",
      "executableIdentity",
      "sessionId",
      "integrityLevel",
    ]
    if (!identity.hwnd || !identity.pid || !identity.processStartTime) return ""
    return JSON.stringify(keys.map((key) => identity[key] ?? null))
  }

  private async assertAppApproval(
    context: BrokerToolContext,
    app: { appID: string; displayName: string },
  ) {
    const adminPolicy = evaluateComputerUseAdminPolicy(app.appID)
    if (adminPolicy.denied) {
      throw computerUseError(
        "CU_APP_BLOCKED",
        adminPolicy.reason ?? "This application is blocked by administrator policy.",
      )
    }
    if (getComputerUseAppDecision(app.appID)?.decision === "allow") {
      return
    }
    const permission = await import("#permission/permission.ts")
    const result = await permission.requestInProcessPermission({
      context: {
        sessionID: context.sessionID,
        turnID: context.turnID,
        messageID: context.messageID,
        toolCallID: context.toolCallID,
      },
      scope: {
        kind: "computer-use-app",
        sessionID: context.sessionID,
        appID: app.appID,
        appDisplayName: app.displayName,
      },
      grantID: `computer-use:${createHash("sha256").update(app.appID).digest("hex")}`,
      method: context.toolName,
      risk: "high",
      action: "ask",
      rationale:
        "Computer Use can observe this application's window content and send mouse or keyboard input.",
      timeoutMs: 120_000,
    })
    if (result.decision === "deny") {
      throw computerUseError(
        "CU_APP_APPROVAL_REQUIRED",
        `Computer Use access to ${app.displayName} was not approved.`,
        { retryable: true },
      )
    }
    if (result.decision === "allow") {
      allowComputerUseApp({
        appID: app.appID,
        displayName: app.displayName,
      })
    }
  }

  private emit<T extends
    | "computer.use.started"
    | "computer.use.app_changed"
    | "computer.use.interrupted"
    | "computer.use.stopped"
  >(
    sessionID: string,
    type: T,
    payload: Parameters<NonNullable<ReturnType<typeof Orchestrator.activeTurn>>["emit"]>[1],
  ) {
    const turn = Orchestrator.activeTurn(sessionID)
    if (!turn) return
    turn.emit(type, payload as never)
  }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

let singleton: ComputerUseBroker | undefined

export function computerUseBroker() {
  singleton ??= new ComputerUseBroker()
  return singleton
}
