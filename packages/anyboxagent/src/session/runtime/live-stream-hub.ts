import { randomBytes } from "node:crypto"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import {
  getSessionLimits,
  SessionLimitError,
} from "#session/runtime/session-limits.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "session.live-stream" })
export const MAX_SUBSCRIPTION_QUEUE_EVENTS = 1_000
export const MAX_SUBSCRIPTION_QUEUE_BYTES = 2 * 1024 * 1024
export const MAX_RECENT_EVENTS_PER_SESSION = 2_000
export const MAX_RECENT_BYTES_PER_SESSION = 4 * 1024 * 1024
export const MAX_RECENT_BYTES_GLOBAL = 16 * 1024 * 1024
export const RECENT_EVENT_TTL_MS = 5 * 60 * 1_000
const PRUNE_INTERVAL_MS = 60 * 1_000

const processEpoch = randomBytes(12).toString("base64url")
let nextSequence = 0
let globalRecentBytes = 0

export type LiveStreamCursor = {
  schemaVersion: 2
  processEpoch: string
  sequence: number
}

const metrics = {
  coalescedEvents: 0,
  droppedEvents: 0,
  closedSlowClients: 0,
  maxQueueLength: 0,
  maxQueueBytes: 0,
  resyncRequired: 0,
}

type SubscriberOptions = {
  sessionID: string
  turnID?: string | null
  closeOnTerminalTurn?: boolean
  seed?: RuntimeEvent.RuntimeEvent[]
}

type PendingResolver = (event: RuntimeEvent.RuntimeEvent | undefined) => void
type RecentEventEntry = {
  event: RuntimeEvent.RuntimeEvent
  cursor: LiveStreamCursor
  sequence: number
  bytes: number
  observedAt: number
}
type QueueEntry = {
  event: RuntimeEvent.RuntimeEvent
  bytes: number
}

export interface LiveStreamSubscription {
  next(): Promise<RuntimeEvent.RuntimeEvent | undefined>
  close(): void
}

export type ReplayResult =
  | { status: "ok"; events: RuntimeEvent.RuntimeEvent[] }
  | { status: "resync-required"; reason: "epoch-changed" | "cursor-expired" | "cursor-invalid"; events: [] }

type StreamDeltaEvent = RuntimeEvent.RuntimeEvent & {
  type: "text.part.delta" | "reasoning.part.delta" | "tool.call.input_delta"
  payload:
    | RuntimeEvent.RuntimeEventPayloadByType["text.part.delta"]
    | RuntimeEvent.RuntimeEventPayloadByType["reasoning.part.delta"]
    | RuntimeEvent.RuntimeEventPayloadByType["tool.call.input_delta"]
}

const cursorByEvent = new WeakMap<object, LiveStreamCursor>()
const subscriptionsBySession = new Map<string, Set<Subscription>>()
const recentEventsBySession = new Map<string, RecentEventEntry[]>()
const latestSequenceBySession = new Map<string, number>()
const droppedThroughSequenceBySession = new Map<string, number>()

function isStreamDeltaEvent(event: RuntimeEvent.RuntimeEvent): event is StreamDeltaEvent {
  return event.type === "text.part.delta" || event.type === "reasoning.part.delta" || event.type === "tool.call.input_delta"
}

function eventBytes(event: RuntimeEvent.RuntimeEvent) {
  try {
    return Buffer.byteLength(JSON.stringify(event), "utf8")
  } catch {
    return MAX_RECENT_BYTES_PER_SESSION + 1
  }
}

function assignCursor(event: RuntimeEvent.RuntimeEvent, existing?: LiveStreamCursor) {
  const cursor = existing ?? {
    schemaVersion: 2 as const,
    processEpoch,
    sequence: ++nextSequence,
  }
  cursorByEvent.set(event, cursor)
  return cursor
}

export function cursorForEvent(event: RuntimeEvent.RuntimeEvent) {
  return cursorByEvent.get(event) ?? assignCursor(event)
}

export function serializeCursor(cursor: LiveStreamCursor) {
  return `v2.${cursor.processEpoch}.${cursor.sequence}`
}

export function parseCursor(value: string): LiveStreamCursor {
  const match = /^v2\.([A-Za-z0-9_-]+)\.(\d+)$/.exec(value.trim())
  if (!match) throw new Error("Invalid v2 live stream cursor")
  const sequence = Number(match[2])
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error("Invalid v2 live stream sequence")
  return {
    schemaVersion: 2,
    processEpoch: match[1]!,
    sequence,
  }
}

export function getProcessEpoch() {
  return processEpoch
}

function canCoalesceStreamDeltaEvent(current: RuntimeEvent.RuntimeEvent, next: RuntimeEvent.RuntimeEvent) {
  if (!isStreamDeltaEvent(current) || !isStreamDeltaEvent(next)) return false
  if (current.type !== next.type) return false
  if (current.type === "tool.call.input_delta" && next.type === "tool.call.input_delta") {
    return (
      current.sessionID === next.sessionID &&
      current.turnID === next.turnID &&
      current.payload.messageID === next.payload.messageID &&
      current.payload.partID === next.payload.partID &&
      current.payload.toolCallID === next.payload.toolCallID
    )
  }
  return (
    current.sessionID === next.sessionID &&
    current.turnID === next.turnID &&
    current.payload.messageID === next.payload.messageID &&
    current.payload.partID === next.payload.partID
  )
}

function coalesceStreamDeltaEvent(current: StreamDeltaEvent, next: StreamDeltaEvent): StreamDeltaEvent {
  const coalesced = {
    ...next,
    payload: {
      ...next.payload,
      delta: current.payload.delta + next.payload.delta,
    },
  } as StreamDeltaEvent
  assignCursor(coalesced, cursorForEvent(next))
  return coalesced
}

function noteDroppedSequence(sessionID: string, sequence: number) {
  const current = droppedThroughSequenceBySession.get(sessionID) ?? 0
  if (sequence > current) droppedThroughSequenceBySession.set(sessionID, sequence)
}

function removeRecentEntry(sessionID: string, entries: RecentEventEntry[], index: number) {
  const [removed] = entries.splice(index, 1)
  if (!removed) return
  globalRecentBytes = Math.max(0, globalRecentBytes - removed.bytes)
  noteDroppedSequence(sessionID, removed.sequence)
}

function pruneRecentEventsForSession(sessionID: string, now = Date.now()) {
  const entries = recentEventsBySession.get(sessionID)
  if (!entries) return
  const cutoff = now - RECENT_EVENT_TTL_MS
  while (entries[0] && entries[0].observedAt < cutoff) removeRecentEntry(sessionID, entries, 0)

  let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  while (entries.length > MAX_RECENT_EVENTS_PER_SESSION || bytes > MAX_RECENT_BYTES_PER_SESSION) {
    const deltaIndex = entries.findIndex((entry) => isStreamDeltaEvent(entry.event))
    const index = deltaIndex >= 0 ? deltaIndex : 0
    const removedBytes = entries[index]?.bytes ?? 0
    removeRecentEntry(sessionID, entries, index)
    bytes = Math.max(0, bytes - removedBytes)
  }
  if (entries.length === 0) recentEventsBySession.delete(sessionID)
}

function pruneGlobalRecentEvents() {
  while (globalRecentBytes > MAX_RECENT_BYTES_GLOBAL) {
    let targetSessionID: string | undefined
    let targetIndex = -1
    let targetSequence = Number.POSITIVE_INFINITY
    for (const [sessionID, entries] of recentEventsBySession) {
      const deltaIndex = entries.findIndex((entry) => isStreamDeltaEvent(entry.event))
      const index = deltaIndex >= 0 ? deltaIndex : 0
      const candidate = entries[index]
      if (candidate && candidate.sequence < targetSequence) {
        targetSessionID = sessionID
        targetIndex = index
        targetSequence = candidate.sequence
      }
    }
    if (!targetSessionID || targetIndex < 0) break
    const entries = recentEventsBySession.get(targetSessionID)!
    removeRecentEntry(targetSessionID, entries, targetIndex)
    if (entries.length === 0) recentEventsBySession.delete(targetSessionID)
  }
}

function pruneAllRecentEvents(now = Date.now()) {
  for (const sessionID of [...recentEventsBySession.keys()]) pruneRecentEventsForSession(sessionID, now)
  pruneGlobalRecentEvents()
}

const pruneTimer = setInterval(() => pruneAllRecentEvents(), PRUNE_INTERVAL_MS)
pruneTimer.unref?.()

function rememberRecentEvent(event: RuntimeEvent.RuntimeEvent) {
  const cursor = cursorForEvent(event)
  const bytes = eventBytes(event)
  const entries = recentEventsBySession.get(event.sessionID) ?? []
  latestSequenceBySession.set(event.sessionID, cursor.sequence)
  if (bytes > MAX_RECENT_BYTES_PER_SESSION) {
    noteDroppedSequence(event.sessionID, cursor.sequence)
    return
  }
  entries.push({ event, cursor, sequence: cursor.sequence, bytes, observedAt: Date.now() })
  recentEventsBySession.set(event.sessionID, entries)
  globalRecentBytes += bytes
  pruneRecentEventsForSession(event.sessionID)
  pruneGlobalRecentEvents()
}

function noteQueueSize(length: number, bytes: number) {
  metrics.maxQueueLength = Math.max(metrics.maxQueueLength, length)
  metrics.maxQueueBytes = Math.max(metrics.maxQueueBytes, bytes)
}

class Subscription implements LiveStreamSubscription {
  readonly sessionID: string
  readonly turnID?: string | null
  readonly closeOnTerminalTurn: boolean
  private readonly queue: QueueEntry[] = []
  private readonly waiters: PendingResolver[] = []
  private closed = false
  private queuedBytes = 0

  constructor(options: SubscriberOptions) {
    this.sessionID = options.sessionID
    this.turnID = options.turnID
    this.closeOnTerminalTurn = options.closeOnTerminalTurn ?? true
    for (const event of options.seed ?? []) this.enqueue(event)
  }

  matches(event: RuntimeEvent.RuntimeEvent) {
    if (event.sessionID !== this.sessionID) return false
    if (this.turnID && event.turnID !== this.turnID) return false
    return true
  }

  push(event: RuntimeEvent.RuntimeEvent) {
    if (this.closed || !this.matches(event)) return
    const waiter = this.waiters.shift()
    if (waiter) waiter(event)
    else this.enqueue(event)
    if (this.closeOnTerminalTurn && RuntimeEvent.isTerminalRuntimeEvent(event)) this.close()
  }

  private enqueue(event: RuntimeEvent.RuntimeEvent) {
    const bytes = eventBytes(event)
    if (this.coalesceQueuedEvent(event)) return
    while (
      this.queue.length >= MAX_SUBSCRIPTION_QUEUE_EVENTS ||
      this.queuedBytes + bytes > MAX_SUBSCRIPTION_QUEUE_BYTES
    ) {
      if (!this.makeRoomFor()) {
        if (isStreamDeltaEvent(event)) {
          metrics.droppedEvents += 1
          return
        }
        metrics.closedSlowClients += 1
        log.warn("closing slow stream subscriber with a full queue", {
          sessionID: this.sessionID,
          turnID: this.turnID,
          queueLength: this.queue.length,
          queuedBytes: this.queuedBytes,
          eventType: event.type,
        })
        this.close()
        return
      }
    }
    this.queue.push({ event, bytes })
    this.queuedBytes += bytes
    noteQueueSize(this.queue.length, this.queuedBytes)
  }

  private coalesceQueuedEvent(event: RuntimeEvent.RuntimeEvent) {
    if (!isStreamDeltaEvent(event)) return false
    const last = this.queue[this.queue.length - 1]
    if (!last || !canCoalesceStreamDeltaEvent(last.event, event)) return false
    const coalesced = coalesceStreamDeltaEvent(last.event as StreamDeltaEvent, event)
    const bytes = eventBytes(coalesced)
    if (this.queuedBytes - last.bytes + bytes > MAX_SUBSCRIPTION_QUEUE_BYTES) return false
    this.queuedBytes += bytes - last.bytes
    this.queue[this.queue.length - 1] = { event: coalesced, bytes }
    metrics.coalescedEvents += 1
    return true
  }

  private makeRoomFor() {
    const index = this.queue.findIndex((queued) => isStreamDeltaEvent(queued.event))
    if (index < 0) return false
    const [removed] = this.queue.splice(index, 1)
    this.queuedBytes = Math.max(0, this.queuedBytes - (removed?.bytes ?? 0))
    metrics.droppedEvents += 1
    return true
  }

  async next() {
    const queued = this.queue.shift()
    if (queued) {
      this.queuedBytes = Math.max(0, this.queuedBytes - queued.bytes)
      return queued.event
    }
    if (this.closed) return undefined
    return new Promise<RuntimeEvent.RuntimeEvent | undefined>((resolve) => this.waiters.push(resolve))
  }

  close() {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) this.waiters.shift()?.(undefined)
  }

  isClosed() {
    return this.closed
  }

  queueSnapshot() {
    return { events: this.queue.length, bytes: this.queuedBytes }
  }
}

function subscriptionsForSession(sessionID: string) {
  let current = subscriptionsBySession.get(sessionID)
  if (!current) {
    current = new Set<Subscription>()
    subscriptionsBySession.set(sessionID, current)
  }
  return current
}

function activeSubscriptionCount() {
  let count = 0
  for (const subscriptions of subscriptionsBySession.values()) count += subscriptions.size
  return count
}

export function publish(event: RuntimeEvent.RuntimeEvent) {
  rememberRecentEvent(event)
  const subscribers = subscriptionsBySession.get(event.sessionID)
  if (!subscribers) return event
  for (const subscriber of [...subscribers]) {
    subscriber.push(event)
    if (subscriber.isClosed()) subscribers.delete(subscriber)
  }
  if (subscribers.size === 0) subscriptionsBySession.delete(event.sessionID)
  return event
}

export function replay(input: { sessionID: string; cursor?: LiveStreamCursor; turnID?: string | null }): ReplayResult {
  pruneRecentEventsForSession(input.sessionID)
  const entries = recentEventsBySession.get(input.sessionID) ?? []
  if (!input.cursor) {
    return {
      status: "ok",
      events: entries.filter((entry) => !input.turnID || entry.event.turnID === input.turnID).map((entry) => entry.event),
    }
  }
  if (input.cursor.processEpoch !== processEpoch) {
    metrics.resyncRequired += 1
    return { status: "resync-required", reason: "epoch-changed", events: [] }
  }
  const latest = latestSequenceBySession.get(input.sessionID)
  const droppedThrough = droppedThroughSequenceBySession.get(input.sessionID) ?? 0
  if (!latest || input.cursor.sequence > latest) {
    metrics.resyncRequired += 1
    return { status: "resync-required", reason: "cursor-invalid", events: [] }
  }
  if (input.cursor.sequence <= droppedThrough || !entries.some((entry) => entry.sequence === input.cursor!.sequence)) {
    metrics.resyncRequired += 1
    return { status: "resync-required", reason: "cursor-expired", events: [] }
  }
  return {
    status: "ok",
    events: entries
      .filter((entry) => entry.sequence > input.cursor!.sequence)
      .filter((entry) => !input.turnID || entry.event.turnID === input.turnID)
      .map((entry) => entry.event),
  }
}

export function listRecentEvents(input: {
  sessionID: string
  turnID?: string | null
  since?: LiveStreamCursor
  sinceSeq?: number
}) {
  const replayed = replay({ sessionID: input.sessionID, cursor: input.since, turnID: input.turnID })
  if (replayed.status !== "ok") return []
  return replayed.events.filter((event) => (
    !input.turnID ||
    typeof input.sinceSeq !== "number" ||
    !Number.isFinite(input.sinceSeq) ||
    event.seq > input.sinceSeq
  ))
}

export function subscribe(options: SubscriberOptions): LiveStreamSubscription {
  const existingSessionSubscriptions = subscriptionsBySession.get(options.sessionID)
  const limits = getSessionLimits()
  if (activeSubscriptionCount() >= limits.maxStreamSubscribers) {
    throw new SessionLimitError(
      "SESSION_STREAM_SUBSCRIBER_LIMIT",
      `At most ${limits.maxStreamSubscribers} session stream subscribers can be active.`,
      limits.maxStreamSubscribers,
    )
  }
  if ((existingSessionSubscriptions?.size ?? 0) >= limits.maxStreamSubscribersPerSession) {
    throw new SessionLimitError(
      "SESSION_STREAM_SUBSCRIBER_LIMIT",
      `At most ${limits.maxStreamSubscribersPerSession} stream subscribers can be active for one session.`,
      limits.maxStreamSubscribersPerSession,
    )
  }
  const subscriber = new Subscription(options)
  const sessionSubscriptions = subscriptionsForSession(options.sessionID)
  sessionSubscriptions.add(subscriber)
  return {
    next: () => subscriber.next(),
    close: () => {
      subscriber.close()
      sessionSubscriptions.delete(subscriber)
      if (sessionSubscriptions.size === 0) subscriptionsBySession.delete(options.sessionID)
    },
  }
}

export function clearSession(sessionID: string) {
  const subscriptions = subscriptionsBySession.get(sessionID)
  for (const subscription of subscriptions ?? []) subscription.close()
  subscriptionsBySession.delete(sessionID)
  const entries = recentEventsBySession.get(sessionID) ?? []
  for (const entry of entries) globalRecentBytes = Math.max(0, globalRecentBytes - entry.bytes)
  recentEventsBySession.delete(sessionID)
  latestSequenceBySession.delete(sessionID)
  droppedThroughSequenceBySession.delete(sessionID)
}

export function snapshot() {
  const sessionIDs = new Set([...subscriptionsBySession.keys(), ...recentEventsBySession.keys()])
  const sessions = [...sessionIDs].map((sessionID) => {
    const subscriptions = subscriptionsBySession.get(sessionID) ?? new Set<Subscription>()
    const queues = [...subscriptions].map((subscription) => subscription.queueSnapshot())
    const recent = recentEventsBySession.get(sessionID) ?? []
    return {
      sessionID,
      subscriptions: subscriptions.size,
      queuedEvents: queues.reduce((sum, value) => sum + value.events, 0),
      queuedBytes: queues.reduce((sum, value) => sum + value.bytes, 0),
      maxQueueLength: queues.length > 0 ? Math.max(...queues.map((queue) => queue.events)) : 0,
      recentEvents: recent.length,
      recentBytes: recent.reduce((sum, entry) => sum + entry.bytes, 0),
    }
  })
  return {
    processEpoch,
    activeSubscriptions: sessions.reduce((sum, session) => sum + session.subscriptions, 0),
    globalRecentBytes,
    sessions,
    totals: { ...metrics },
  }
}
