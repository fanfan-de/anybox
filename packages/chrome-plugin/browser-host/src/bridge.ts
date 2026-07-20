import {
  ANYBOX_CHROME_EXTENSION_ID,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  BrowserExtensionClientMessage,
  BrowserExtensionCommandMethod,
  BrowserExtensionServerMessage,
  BrowserExtensionTabsListResult,
  type BrowserExtensionClientMessage as BrowserExtensionClientMessageValue,
  type BrowserExtensionCommandContext,
  type BrowserExtensionCommandMethod as BrowserExtensionCommandMethodValue,
  type BrowserExtensionTabSummary,
} from "@anybox/chrome-shared/browser-extension"
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import {
  BROWSER_CONTRACT_COMMAND_METHODS,
  BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS,
  BROWSER_CONTRACT_VERSION,
  BrowserContractCommandMethod,
  createBrowserBackendInfo,
  createBrowserGetInfoResult,
  type BrowserContractVersion,
  type BrowserContractCommandMethod as BrowserContractCommandMethodValue,
} from "@anybox/chrome-shared/browser-contract"
import * as Log from "./log.ts"

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000

type SocketLike = {
  send(data: string): void
  close(code?: number, reason?: string): void
}

type Connection = {
  socket: SocketLike
  connectionID: string
  ready: boolean
  extensionInstanceID?: string
  extensionID?: string
  version?: string
  transport?: "native" | "native-ipc"
  hostName?: string
  lastTransportError?: string
  browserCommands?: BrowserContractCommandMethodValue[]
  advertisedBrowserContractVersion?: number
  browserContractVersion?: BrowserContractVersion
  browserContractCompatible?: boolean
  browserID?: string
  connectedAt: number
  lastSeenAt: number
}

type PendingCommand = {
  commandID: string
  connectionID: string
  method: BrowserExtensionCommandMethodValue
  context?: BrowserExtensionCommandContext
  trusted?: boolean
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

type OwnedTab = {
  tabId: number
  sessionID: string
  url?: string
  title?: string
  openedAt: number
  lastUsedAt: number
}

type LastCommand = {
  commandID: string
  method: BrowserExtensionCommandMethodValue
  sessionID?: string
  messageID?: string
  turnID?: string
  toolCallID?: string
  browserID?: string
  startedAt: number
  completedAt?: number
  ok?: boolean
  error?: string
  trusted?: boolean
}

type ConnectionOptions = {
  transport?: "native" | "native-ipc"
  hostName?: string
}

type SendCommandOptions = {
  timeoutMs?: number
  context?: BrowserExtensionCommandContext
  trusted?: boolean
  browserID?: string
  contractVersion?: number
}

const log = Log.create({ service: "browser-extension" })

function send(socket: SocketLike, payload: unknown) {
  socket.send(JSON.stringify(BrowserExtensionServerMessage.parse(payload)))
}

function normalizeError(error: unknown) {
  if (error instanceof Error) return error
  return new Error(typeof error === "string" ? error : String(error))
}

const DOWNLOAD_DIRECTORY_PREFIX = "anybox-browser-downloads-"
const DOWNLOAD_TTL_MS = 24 * 60 * 60 * 1_000
const DOWNLOAD_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000
let downloadDirectory: string | undefined
let downloadCleanupTimer: ReturnType<typeof setInterval> | undefined

function cleanupManagedDownloadDirectories(now = Date.now()) {
  const root = resolve(tmpdir())
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(
        DOWNLOAD_DIRECTORY_PREFIX,
      )) {
        continue
      }
      const candidate = resolve(join(root, entry.name))
      if (!candidate.startsWith(rootPrefix)) continue
      try {
        for (const file of readdirSync(candidate, { withFileTypes: true })) {
          if (!file.isFile()) continue
          const filePath = resolve(join(candidate, file.name))
          const candidatePrefix = candidate.endsWith(sep)
            ? candidate
            : `${candidate}${sep}`
          if (!filePath.startsWith(candidatePrefix)) continue
          if (now - statSync(filePath).mtimeMs >= DOWNLOAD_TTL_MS) {
            rmSync(filePath, { force: true })
          }
        }
        if (
          candidate !== downloadDirectory
          && readdirSync(candidate).length === 0
        ) {
          rmSync(candidate, { force: true })
        }
      } catch {
        // A concurrent Host may own or remove this directory.
      }
    }
  } catch {
    // Cleanup is best-effort.
  }
}

function managedDownloadDirectory() {
  cleanupManagedDownloadDirectories()
  if (downloadDirectory) return downloadDirectory
  const root = resolve(tmpdir())
  downloadDirectory = mkdtempSync(join(root, DOWNLOAD_DIRECTORY_PREFIX))
  if (!downloadCleanupTimer) {
    downloadCleanupTimer = setInterval(
      () => cleanupManagedDownloadDirectories(),
      DOWNLOAD_CLEANUP_INTERVAL_MS,
    )
    downloadCleanupTimer.unref?.()
  }
  return downloadDirectory
}

function browserIDForInstance(extensionInstanceID: string) {
  return `extension:${extensionInstanceID}`
}

export class BrowserExtensionBridge {
  private readonly connections = new Map<string, Connection>()
  private readonly pending = new Map<string, PendingCommand>()
  private readonly ownedTabs = new Map<number, OwnedTab>()
  private activeConnectionID: string | undefined
  private activeSessionID: string | undefined
  private lastCommand: LastCommand | undefined
  private readonly seenExtensionInstances = new Set<string>()
  private reconnectCount = 0
  private lastCleanup: {
    sessionID?: string
    closed: number
    released: number
    deliverable: number
    handoff: number
    detached: number
    completedAt: number
  } | undefined

  status() {
    const active = this.activeConnection()
    return {
      connected: Boolean(active),
      active: active
        ? {
            connectionID: active.connectionID,
            extensionInstanceID: active.extensionInstanceID,
            extensionID: active.extensionID,
            version: active.version,
            transport: active.transport,
            hostName: active.hostName,
            lastTransportError: active.lastTransportError,
            connectedAt: active.connectedAt,
            lastSeenAt: active.lastSeenAt,
          }
        : null,
      connectionCount: this.connections.size,
      backends: this.backendInfos(),
      activeSessionID: this.activeSessionID,
      ownedTabs: [...this.ownedTabs.values()].sort((left, right) => right.lastUsedAt - left.lastUsedAt),
      lastCommand: this.lastCommand,
      reconnectCount: this.reconnectCount,
      lastCleanup: this.lastCleanup,
    }
  }

  backendInfo(browserID?: string) {
    const active = this.activeConnection(browserID)
    const contractVersion =
      active?.browserContractVersion ?? BROWSER_CONTRACT_VERSION
    const commands = active?.browserCommands ?? []
    const playwrightLocator =
      BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS.every((method) =>
        commands.includes(method)
      )
    return createBrowserBackendInfo({
      connected: Boolean(active),
      contractVersion,
      browserId: active?.browserID ?? browserID ?? "extension",
      instanceID: active?.extensionInstanceID,
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      backendVersion: active?.version,
      commands,
      features: {
        ownership: true,
        claim: true,
        playwrightLocator,
        playwrightApiRevision: playwrightLocator ? 1 : 0,
        ...(playwrightLocator
          ? { playwrightEngineVersion: "1.61.1" }
          : {}),
        cancel: false,
      },
    })
  }

  backendInfos() {
    return [...this.connections.values()]
      .filter((connection) =>
        connection.ready && connection.browserContractCompatible === true
      )
      .map((connection) => this.backendInfo(connection.browserID))
  }

  getInfo(
    browserID?: string,
    contractVersion: BrowserContractVersion = BROWSER_CONTRACT_VERSION,
  ) {
    return createBrowserGetInfoResult(
      this.backendInfo(browserID),
      contractVersion,
    )
  }

  browserContractCompatibility() {
    const active = this.activeConnection()
    const incompatible = active
      ? undefined
      : [...this.connections.values()].find((connection) =>
          connection.ready && connection.browserContractCompatible === false
        )
    return {
      connected: Boolean(active ?? incompatible),
      compatible: Boolean(active) || !incompatible,
      advertisedVersion:
        active?.advertisedBrowserContractVersion
          ?? incompatible?.advertisedBrowserContractVersion,
    }
  }

  preferredTabID(sessionID: string | undefined, explicitTabID?: number) {
    if (explicitTabID) return explicitTabID
    if (!sessionID) return undefined

    let preferred: OwnedTab | undefined
    for (const tab of this.ownedTabs.values()) {
      if (tab.sessionID !== sessionID) continue
      if (!preferred || tab.lastUsedAt > preferred.lastUsedAt) preferred = tab
    }
    return preferred?.tabId
  }

  markOwnedTab(tab: BrowserExtensionTabSummary, context?: BrowserExtensionCommandContext) {
    const sessionID = context?.sessionID
    if (!sessionID || typeof tab.id !== "number") return

    const now = Date.now()
    this.activeSessionID = sessionID
    this.ownedTabs.set(tab.id, {
      tabId: tab.id,
      sessionID,
      url: tab.url,
      title: tab.title,
      openedAt: this.ownedTabs.get(tab.id)?.openedAt ?? now,
      lastUsedAt: now,
    })
  }

  touchTab(tabId: number | undefined, context?: BrowserExtensionCommandContext) {
    if (!tabId) return
    const owned = this.ownedTabs.get(tabId)
    if (!owned) return
    if (context?.sessionID && owned.sessionID !== context.sessionID) return
    owned.lastUsedAt = Date.now()
    if (context?.sessionID) this.activeSessionID = context.sessionID
  }

  releaseOwnedTab(tabId: number, sessionID?: string) {
    const owned = this.ownedTabs.get(tabId)
    if (!owned) return false
    if (sessionID && owned.sessionID !== sessionID) return false
    this.ownedTabs.delete(tabId)
    return true
  }

  register(socket: SocketLike, options: ConnectionOptions = {}) {
    const connectionID = crypto.randomUUID()
    const connection: Connection = {
      socket,
      connectionID,
      ready: false,
      transport: options.transport,
      hostName: options.hostName,
      connectedAt: Date.now(),
      lastSeenAt: Date.now(),
    }
    this.connections.set(connectionID, connection)
    log.info("connected", { connectionID, transport: options.transport, hostName: options.hostName })
    return connectionID
  }

  unregister(connectionID: string) {
    const connection = this.connections.get(connectionID)
    if (!connection) return

    this.connections.delete(connectionID)
    if (this.activeConnectionID === connectionID) {
      this.activeConnectionID = [...this.connections.values()].find(
        (candidate) =>
          candidate.ready && candidate.browserContractCompatible === true,
      )?.connectionID
    }

    for (const [commandID, pending] of this.pending) {
      if (pending.connectionID !== connectionID) continue
      clearTimeout(pending.timer)
      this.pending.delete(commandID)
      pending.reject(new Error("Browser extension disconnected before returning a result."))
    }

    log.info("disconnected", {
      connectionID,
      extensionInstanceID: connection.extensionInstanceID,
    })
  }

  handleRawMessage(connectionID: string, raw: unknown) {
    const connection = this.connections.get(connectionID)
    if (!connection) return

    let parsedJson: unknown
    try {
      parsedJson = typeof raw === "string" ? JSON.parse(raw) : raw
    } catch {
      throw new Error("Browser extension transport message must be valid JSON.")
    }

    const message = BrowserExtensionClientMessage.parse(parsedJson)
    connection.lastSeenAt = Date.now()
    this.handleMessage(connection, message)
  }

  async sendCommand(
    method: BrowserExtensionCommandMethodValue,
    params?: unknown,
    options: SendCommandOptions = {},
  ) {
    BrowserExtensionCommandMethod.parse(method)
    const connection = this.activeConnection(
      options.browserID ?? options.context?.browserID,
    )
    if (!connection) {
      throw new Error("No Chrome extension is connected to Anybox.")
    }
    if (!connection.browserCommands?.includes(
      method as BrowserContractCommandMethodValue,
    )) {
      const error = new Error(
        `Chrome extension capability '${method}' is unavailable on the active connection.`,
      ) as Error & {
        code: string
        retryable: boolean
      }
      error.code = "CAPABILITY_UNAVAILABLE"
      error.retryable = false
      throw error
    }

    const commandID = crypto.randomUUID()
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    if (options.context?.sessionID) this.activeSessionID = options.context.sessionID
    const commandContext: BrowserExtensionCommandContext = {
      ...options.context,
      browserID: connection.browserID,
      extensionInstanceID: connection.extensionInstanceID,
    }
    this.lastCommand = {
      commandID,
      method,
      sessionID: commandContext.sessionID,
      turnID: commandContext.turnID,
      messageID: commandContext.messageID,
      toolCallID: commandContext.toolCallID,
      browserID: connection.browserID,
      startedAt: Date.now(),
      trusted: options.trusted,
    }

    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandID)
        this.lastCommand = {
          ...(this.lastCommand?.commandID === commandID ? this.lastCommand : {
            commandID,
            method,
            sessionID: commandContext.sessionID,
            turnID: commandContext.turnID,
            messageID: commandContext.messageID,
            toolCallID: commandContext.toolCallID,
            browserID: connection.browserID,
            startedAt: Date.now(),
            trusted: options.trusted,
          }),
          completedAt: Date.now(),
          ok: false,
          error: `Timed out after ${timeoutMs}ms.`,
        }
        const error = new Error(
          `Browser command '${method}' timed out after ${timeoutMs}ms.`,
        ) as Error & {
          code: string
          retryable: boolean
        }
        error.code = "DEADLINE_EXCEEDED"
        error.retryable = true
        reject(error)
      }, timeoutMs)

      this.pending.set(commandID, {
        commandID,
        connectionID: connection.connectionID,
        method,
        context: commandContext,
        trusted: options.trusted,
        resolve,
        reject,
        timer,
      })

      try {
        send(connection.socket, {
          type: "command",
          commandID,
          contractVersion: options.contractVersion ?? BROWSER_CONTRACT_VERSION,
          method,
          params,
          context: commandContext,
        })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(commandID)
        this.lastCommand = {
          ...(this.lastCommand?.commandID === commandID ? this.lastCommand : {
            commandID,
            method,
            sessionID: commandContext.sessionID,
            turnID: commandContext.turnID,
            messageID: commandContext.messageID,
            toolCallID: commandContext.toolCallID,
            browserID: connection.browserID,
            startedAt: Date.now(),
            trusted: options.trusted,
          }),
          completedAt: Date.now(),
          ok: false,
          error: normalizeError(error).message,
          trusted: options.trusted,
        }
        reject(normalizeError(error))
      }
    })
  }

  ping() {
    const connection = this.activeConnection()
    if (!connection) return false
    send(connection.socket, {
      type: "ping",
      nonce: crypto.randomUUID(),
    })
    return true
  }

  async describeTab(
    tabId: number,
    options: SendCommandOptions = {},
  ) {
    const connection = this.activeConnection(
      options.browserID ?? options.context?.browserID,
    )
    if (!connection) return undefined
    const methods: BrowserExtensionCommandMethodValue[] = [
      "tabs.list",
      "tabs.listUser",
    ]
    for (const method of methods) {
      if (!connection.browserCommands?.includes(
        method as BrowserContractCommandMethodValue,
      )) {
        continue
      }
      const result = BrowserExtensionTabsListResult.safeParse(
        await this.sendCommand(method, {}, {
          ...options,
          trusted: true,
          contractVersion: connection.browserContractVersion,
        }),
      )
      const tab = result.success
        ? result.data.tabs.find((candidate) => candidate.id === tabId)
        : undefined
      if (tab) return tab
    }
    return undefined
  }

  heartbeat(now = Date.now()) {
    let pinged = 0
    let disconnected = 0
    for (const connection of [...this.connections.values()]) {
      if (!connection.ready) continue
      if (now - connection.lastSeenAt > 40_000) {
        disconnected += 1
        connection.socket.close(1011, "Browser extension heartbeat timed out.")
        this.unregister(connection.connectionID)
        continue
      }
      send(connection.socket, {
        type: "ping",
        nonce: crypto.randomUUID(),
      })
      pinged += 1
    }
    return { pinged, disconnected }
  }

  private activeConnection(browserID?: string) {
    if (browserID) {
      return [...this.connections.values()].find((connection) =>
        connection.ready
        && connection.browserContractCompatible === true
        && (
          connection.browserID === browserID
          || connection.extensionInstanceID === browserID
        )
      )
    }
    if (this.activeConnectionID) {
      const active = this.connections.get(this.activeConnectionID)
      if (active?.ready && active.browserContractCompatible === true) {
        return active
      }
    }

    const next = [...this.connections.values()].find(
      (connection) =>
        connection.ready && connection.browserContractCompatible === true,
    )
    this.activeConnectionID = next?.connectionID
    return next
  }

  private handleMessage(connection: Connection, message: BrowserExtensionClientMessageValue) {
    switch (message.type) {
      case "hello":
        if (message.extensionID !== ANYBOX_CHROME_EXTENSION_ID) {
          log.warn("rejected extension identity", {
            connectionID: connection.connectionID,
            extensionID: message.extensionID,
          })
          connection.socket.close(1008, "Browser extension identity is invalid.")
          this.unregister(connection.connectionID)
          return
        }
        connection.extensionInstanceID = message.extensionInstanceID
        if (this.seenExtensionInstances.has(message.extensionInstanceID)) {
          this.reconnectCount += 1
        } else {
          this.seenExtensionInstances.add(message.extensionInstanceID)
        }
        connection.browserID = browserIDForInstance(message.extensionInstanceID)
        connection.extensionID = message.extensionID
        connection.version = message.version
        connection.lastTransportError = message.lastTransportError
        connection.advertisedBrowserContractVersion =
          message.capabilities.contractVersion
        connection.browserContractCompatible =
          message.capabilities.contractVersion === BROWSER_CONTRACT_VERSION
        connection.browserContractVersion = connection.browserContractCompatible
          ? BROWSER_CONTRACT_VERSION
          : undefined
        connection.browserCommands = connection.browserContractCompatible
          ? BROWSER_CONTRACT_COMMAND_METHODS.filter((method) =>
              message.capabilities.commands.includes(method)
            )
          : []
        if (connection.browserContractCompatible) {
          const advertisedPlaywright = new Set(
            connection.browserCommands.filter((method) =>
              method.startsWith("playwright.")
            ),
          )
          if (
            advertisedPlaywright.size > 0
            && !BROWSER_CONTRACT_V3_PLAYWRIGHT_COMMAND_METHODS.every(
              (method) => advertisedPlaywright.has(method),
            )
          ) {
            connection.browserCommands = connection.browserCommands.filter(
              (method) => !method.startsWith("playwright."),
            )
          }
        }
        connection.ready = true
        const active = this.activeConnectionID
          ? this.connections.get(this.activeConnectionID)
          : undefined
        if (
          connection.browserContractCompatible
          && (!active?.ready || active.browserContractCompatible !== true)
        ) {
          this.activeConnectionID = connection.connectionID
        }
        if (
          connection.browserContractCompatible
        ) {
          send(connection.socket, {
            type: "helloAck",
            protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
            contractVersion: connection.browserContractVersion,
            browserID: connection.browserID,
            extensionInstanceID: message.extensionInstanceID,
            heartbeatIntervalMs: 30_000,
            heartbeatTimeoutMs: 10_000,
            downloadDirectory: managedDownloadDirectory(),
          })
        }
        log.info("hello", {
          connectionID: connection.connectionID,
          extensionInstanceID: message.extensionInstanceID,
          extensionID: message.extensionID,
          version: message.version,
          transport: connection.transport,
          hostName: connection.hostName,
        })
        return
      case "result": {
        const pending = this.pending.get(message.commandID)
        if (!pending) return
        if (pending.connectionID !== connection.connectionID) return
        clearTimeout(pending.timer)
        this.pending.delete(message.commandID)
        this.lastCommand = {
          commandID: pending.commandID,
          method: pending.method,
          sessionID: pending.context?.sessionID,
          turnID: pending.context?.turnID,
          messageID: pending.context?.messageID,
          toolCallID: pending.context?.toolCallID,
          browserID: pending.context?.browserID,
          startedAt: this.lastCommand?.commandID === pending.commandID ? this.lastCommand.startedAt : Date.now(),
          completedAt: Date.now(),
          ok: message.ok,
          error: message.ok ? undefined : message.error,
          trusted: pending.trusted,
        }
        if (message.ok) {
          if (
            pending.method === "tabs.finalize"
            && message.data
            && typeof message.data === "object"
            && !Array.isArray(message.data)
          ) {
            const cleanup = message.data as Record<string, unknown>
            this.lastCleanup = {
              sessionID: pending.context?.sessionID,
              closed: Array.isArray(cleanup.closedTabIds)
                ? cleanup.closedTabIds.length
                : 0,
              released: Array.isArray(cleanup.releasedTabIds)
                ? cleanup.releasedTabIds.length
                : 0,
              deliverable: Array.isArray(cleanup.deliverableTabIds)
                ? cleanup.deliverableTabIds.length
                : 0,
              handoff: Array.isArray(cleanup.handoffTabIds)
                ? cleanup.handoffTabIds.length
                : 0,
              detached: Array.isArray(cleanup.detachedTabIds)
                ? cleanup.detachedTabIds.length
                : 0,
              completedAt: Date.now(),
            }
            log.info("lease-cleanup", this.lastCleanup)
          }
          pending.resolve(message.data)
        } else {
          const error = new Error(
            message.error || `Browser command '${pending.method}' failed.`,
          ) as Error & {
            code?: string
            retryable?: boolean
            details?: Record<string, unknown>
          }
          if (message.code) error.code = message.code
          if (message.retryable !== undefined) {
            error.retryable = message.retryable
          }
          if (message.details) error.details = message.details
          pending.reject(error)
        }
        return
      }
      case "event":
        if (message.event === "transport_error") {
          connection.lastTransportError = readMessage(message.data)
        }
        log.debug("event", {
          connectionID: connection.connectionID,
          event: message.event,
        })
        return
      case "pong":
        return
    }
  }
}

export const browserExtensionBridge = new BrowserExtensionBridge()

function readMessage(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const message = (value as { message?: unknown }).message
  return typeof message === "string" && message.trim() ? message.trim() : undefined
}
