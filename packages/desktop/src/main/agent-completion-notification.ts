import { BrowserWindow, Notification, type WebContents } from "electron"
import { safeError } from "./safe-console"

const DEFAULT_NOTIFICATION_TITLE = "\u4efb\u52a1\u5df2\u5b8c\u6210"
const DEFAULT_NOTIFICATION_BODY = "Agent \u5df2\u5b8c\u6210\u5f53\u524d\u4efb\u52a1\u3002"
const DEFAULT_DEDUP_LIMIT = 1_000
const DEFAULT_RESPONSE_PREVIEW_LENGTH = 160

interface RuntimeEventRecord {
  eventID?: string
  payload?: Record<string, unknown>
  sessionID?: string
  turnID?: string
  type?: string
}

export interface AgentCompletionNotificationInput {
  data: unknown
  dedupKey?: string
  event: string
  id?: string
  target: WebContents
}

export interface AgentCompletionNotificationManagerOptions {
  body?: string
  dedupLimit?: number
  isAppWindowFocused?: () => boolean
  notifyWhenFocused?: boolean
  onNotificationClick?: (input: { sessionID?: string; target: WebContents }) => void
  resolveSessionTitle?: (sessionID: string) => Promise<string | undefined> | string | undefined
  responsePreviewLength?: number
  title?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readRuntimeEvent(value: unknown): RuntimeEventRecord | null {
  if (!isRecord(value)) return null

  const type = readString(value.type)
  const sessionID = readString(value.sessionID)
  const turnID = readString(value.turnID)
  if (!type || !sessionID || !turnID) return null

  const payload = isRecord(value.payload) ? value.payload : undefined
  return {
    eventID: readString(value.eventID),
    payload,
    sessionID,
    turnID,
    type,
  }
}

function readCompletionEventKey(input: Pick<AgentCompletionNotificationInput, "data" | "event">) {
  if (input.event !== "runtime") return null

  const runtimeEvent = readRuntimeEvent(input.data)
  if (!runtimeEvent || runtimeEvent.type !== "turn.completed") return null
  if (readString(runtimeEvent.payload?.status) !== "completed") return null

  return runtimeEvent.eventID ?? `${runtimeEvent.sessionID}:${runtimeEvent.turnID}`
}

function readNotificationEventKey(input: Pick<AgentCompletionNotificationInput, "data" | "event">) {
  return readCompletionEventKey(input)
}

function readNotificationSessionID(input: Pick<AgentCompletionNotificationInput, "data" | "event">) {
  if (input.event === "runtime") {
    return readRuntimeEvent(input.data)?.sessionID
  }

  return undefined
}

function readTextFromParts(value: unknown) {
  if (!Array.isArray(value)) return undefined

  const text = value
    .map((part) => isRecord(part) ? part : null)
    .filter((part): part is Record<string, unknown> => Boolean(part))
    .filter((part) => readString(part.type) === "text")
    .map((part) => readString(part.text))
    .filter(Boolean)
    .join("\n\n")

  return normalizePreviewText(text)
}

function normalizePreviewText(value: string | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim()
  return normalized || undefined
}

function truncatePreviewText(value: string | undefined, maxLength: number) {
  const normalized = normalizePreviewText(value)
  if (!normalized) return undefined

  const limit = Math.max(1, Math.floor(maxLength))
  const chars = Array.from(normalized)
  if (chars.length <= limit) return normalized

  if (limit <= 3) return chars.slice(0, limit).join("")
  return `${chars.slice(0, limit - 3).join("").trimEnd()}...`
}

function readNotificationResponseText(input: Pick<AgentCompletionNotificationInput, "data" | "event">) {
  if (input.event === "runtime") {
    const payload = readRuntimeEvent(input.data)?.payload
    return readTextFromParts(payload?.parts)
  }

  return undefined
}

function readNotificationResponsePreview(
  input: Pick<AgentCompletionNotificationInput, "data" | "event">,
  maxLength = DEFAULT_RESPONSE_PREVIEW_LENGTH,
) {
  return truncatePreviewText(readNotificationResponseText(input), maxLength)
}

function focusNotificationTarget(target: WebContents) {
  if (target.isDestroyed()) return

  const window = BrowserWindow.fromWebContents(target)
  if (!window || window.isDestroyed()) return

  if (window.isMinimized()) {
    window.restore()
  }
  window.show()
  window.focus()
}

export class AgentCompletionNotificationManager {
  private readonly body: string
  private readonly activeNotifications = new Set<Notification>()
  private readonly dedupLimit: number
  private readonly isAppWindowFocused: () => boolean
  private readonly notifyWhenFocused: boolean
  private readonly onNotificationClick?: (input: { sessionID?: string; target: WebContents }) => void
  private readonly notifiedKeys = new Set<string>()
  private readonly notifiedKeyOrder: string[] = []
  private readonly resolveSessionTitle?: (sessionID: string) => Promise<string | undefined> | string | undefined
  private readonly responsePreviewLength: number
  private readonly sessionTitleCache = new Map<string, string>()
  private readonly title: string

  constructor(options: AgentCompletionNotificationManagerOptions = {}) {
    this.body = options.body ?? DEFAULT_NOTIFICATION_BODY
    this.dedupLimit = options.dedupLimit ?? DEFAULT_DEDUP_LIMIT
    this.isAppWindowFocused = options.isAppWindowFocused ?? (() => Boolean(BrowserWindow.getFocusedWindow()))
    this.notifyWhenFocused = options.notifyWhenFocused ?? true
    this.onNotificationClick = options.onNotificationClick
    this.resolveSessionTitle = options.resolveSessionTitle
    this.responsePreviewLength = options.responsePreviewLength ?? DEFAULT_RESPONSE_PREVIEW_LENGTH
    this.title = options.title ?? DEFAULT_NOTIFICATION_TITLE
  }

  async handleSessionStreamEvent(input: AgentCompletionNotificationInput) {
    const key = readNotificationEventKey(input)
    if (!key) return false

    if (!this.rememberNotificationKey(key)) return false
    if (!this.notifyWhenFocused && this.isAppWindowFocused()) return false

    const sessionID = readNotificationSessionID(input)
    const title = await this.resolveNotificationTitle(sessionID)
    const body = readNotificationResponsePreview(input, this.responsePreviewLength) ?? this.body
    return this.showNativeNotification(input.target, { body, sessionID, title })
  }

  private rememberNotificationKey(key: string) {
    if (this.notifiedKeys.has(key)) return false

    this.notifiedKeys.add(key)
    this.notifiedKeyOrder.push(key)
    while (this.notifiedKeyOrder.length > this.dedupLimit) {
      const expired = this.notifiedKeyOrder.shift()
      if (expired) {
        this.notifiedKeys.delete(expired)
      }
    }

    return true
  }

  private async resolveNotificationTitle(sessionID: string | undefined) {
    if (!sessionID || !this.resolveSessionTitle) return this.title

    const cached = this.sessionTitleCache.get(sessionID)
    if (cached) return cached

    try {
      const title = readString(await this.resolveSessionTitle(sessionID))
      if (title) {
        this.sessionTitleCache.set(sessionID, title)
        return title
      }
    } catch (error) {
      safeError("[desktop] failed to resolve agent completion notification title", error)
    }

    return this.title
  }

  private showNativeNotification(target: WebContents, content: { body: string; sessionID?: string; title: string }) {
    if (!Notification.isSupported()) return false

    try {
      const notification = new Notification({
        body: content.body,
        title: content.title,
      })
      const releaseNotification = () => {
        this.activeNotifications.delete(notification)
      }
      this.activeNotifications.add(notification)
      notification.on("click", () => {
        releaseNotification()
        focusNotificationTarget(target)
        try {
          this.onNotificationClick?.({
            sessionID: content.sessionID,
            target,
          })
        } catch (error) {
          safeError("[desktop] failed to handle agent completion notification click", error)
        }
      })
      notification.on("close", releaseNotification)
      notification.on("failed", (_event, error) => {
        releaseNotification()
        safeError("[desktop] agent completion notification failed", error)
      })
      notification.show()
      return true
    } catch (error) {
      safeError("[desktop] failed to show agent completion notification", error)
      return false
    }
  }
}

export const internal = {
  readCompletionEventKey,
  readNotificationResponsePreview,
  readNotificationSessionID,
  readNotificationEventKey,
  truncatePreviewText,
}
