import { type SetStateAction, useRef, useSyncExternalStore } from "react"
import type { AssistantTraceItem, AssistantThreadMessage, ConversationTurnMap, ThreadMessage, ThreadTurn } from "../types"
import {
  buildConversationTurnsFromMessagesMap,
  deriveConversationMessages,
  updateAssistantMessageInTurn,
} from "../thread-turn-state"
import { getRendererRuntimeCapabilities } from "../runtime-capabilities"

export type ConversationMessageMap = Record<string, ThreadMessage[]>
export type ConversationStoreUpdater = SetStateAction<ConversationMessageMap>
export type ConversationTurnStoreUpdater = SetStateAction<ConversationTurnMap>

export interface ConversationActivity {
  hasStreamingAssistantMessage: boolean
  messageCount: number
}

export type ConversationActivityMap = Record<string, ConversationActivity>

interface NormalizedSessionConversation {
  activity: ConversationActivity
  traceItemsByMessageID: Record<string, AssistantTraceItem[]>
  messageByID: Record<string, ThreadMessage>
  messageIDs: string[]
  messages: ThreadMessage[]
}

export interface ConversationStoreApi {
  appendAssistantDelta: (
    sessionID: string,
    assistantMessageID: string,
    updater: (message: AssistantThreadMessage) => AssistantThreadMessage,
  ) => boolean
  getActivityBySession: () => ConversationActivityMap
  getConversations: () => ConversationMessageMap
  getSessionTurns: (sessionID: string | null | undefined) => ThreadTurn[]
  getTurns: () => ConversationTurnMap
  getSessionActivity: (sessionID: string | null | undefined) => ConversationActivity
  getSessionMessages: (sessionID: string | null | undefined) => ThreadMessage[]
  hasSession: (sessionID: string | null | undefined) => boolean
  replaceConversations: (nextConversations: ConversationMessageMap) => boolean
  replaceTurns: (nextTurns: ConversationTurnMap) => boolean
  replaceTraceItem: (
    sessionID: string,
    assistantMessageID: string,
    itemID: string,
    item: AssistantTraceItem,
  ) => boolean
  subscribe: (listener: () => void) => () => void
  subscribeSession: (sessionID: string | null | undefined, listener: () => void) => () => void
  updateConversations: (update: ConversationStoreUpdater) => boolean
  updateTurns: (update: ConversationTurnStoreUpdater) => boolean
}

interface ThreadDebugWatchOptions {
  intervalMs?: number
  sessionID?: string | null
}

interface ThreadDebugAssistantMessageSnapshot {
  sessionID: string
  message: AssistantThreadMessage
}

type ThreadDebugWatchSnapshot =
  | {
      kind: "latest-streaming"
      snapshot: ThreadDebugAssistantMessageSnapshot
    }
  | {
      kind: "assistant-messages"
      snapshots: ThreadDebugAssistantMessageSnapshot[]
    }

interface ThreadDebugApi {
  getAssistantMessages: (sessionID?: string | null) => ThreadDebugAssistantMessageSnapshot[]
  getConversations: () => ConversationMessageMap
  getSessionMessages: (sessionID: string) => ThreadMessage[]
  getSessionTurns: (sessionID: string) => ThreadTurn[]
  getTurns: () => ConversationTurnMap
  getStreamingMessages: (sessionID?: string | null) => ThreadDebugAssistantMessageSnapshot[]
  latestStreaming: (sessionID?: string | null) => ThreadDebugAssistantMessageSnapshot | null
  sessionIDs: () => string[]
  unwatch: () => void
  watch: (options?: ThreadDebugWatchOptions | string | null) => () => void
}

declare global {
  interface Window {
    __ANYBOX_THREAD_DEBUG__?: ThreadDebugApi
  }
}

const EMPTY_MESSAGES: ThreadMessage[] = []
const EMPTY_TURNS: ThreadTurn[] = []
const EMPTY_CONVERSATION_ACTIVITY: ConversationActivity = {
  hasStreamingAssistantMessage: false,
  messageCount: 0,
}

function resolveConversationUpdate(current: ConversationMessageMap, update: ConversationStoreUpdater) {
  return typeof update === "function" ? (update as (value: ConversationMessageMap) => ConversationMessageMap)(current) : update
}

function resolveTurnUpdate(current: ConversationTurnMap, update: ConversationTurnStoreUpdater) {
  return typeof update === "function" ? (update as (value: ConversationTurnMap) => ConversationTurnMap)(current) : update
}

function createSessionConversation(messages: ThreadMessage[]): NormalizedSessionConversation {
  const messageByID: Record<string, ThreadMessage> = {}
  const traceItemsByMessageID: Record<string, AssistantTraceItem[]> = {}
  const messageIDs: string[] = []
  let hasStreamingAssistantMessage = false

  for (const message of messages) {
    messageIDs.push(message.id)
    messageByID[message.id] = message
    if (message.kind === "assistant") {
      traceItemsByMessageID[message.id] = message.items
      hasStreamingAssistantMessage ||= Boolean(message.isStreaming)
    }
  }

  return {
    activity: {
      hasStreamingAssistantMessage,
      messageCount: messages.length,
    },
    traceItemsByMessageID,
    messageByID,
    messageIDs,
    messages,
  }
}

function conversationActivityIsEqual(left: ConversationActivity, right: ConversationActivity) {
  return left.hasStreamingAssistantMessage === right.hasStreamingAssistantMessage && left.messageCount === right.messageCount
}

function conversationActivityMapsAreEqual(left: ConversationActivityMap, right: ConversationActivityMap) {
  if (Object.is(left, right)) return true
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => {
    const leftValue = left[key]
    const rightValue = right[key]
    return Boolean(rightValue && conversationActivityIsEqual(leftValue, rightValue))
  })
}

function conversationsAreEquivalent(left: ConversationMessageMap, right: ConversationMessageMap) {
  if (Object.is(left, right)) return true
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.is(left[key], right[key]))
}

function turnsAreEquivalent(left: ConversationTurnMap, right: ConversationTurnMap) {
  if (Object.is(left, right)) return true
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.is(left[key], right[key]))
}

function cloneThreadDebugValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as T
}

function readThreadDebugWatchOptions(input?: ThreadDebugWatchOptions | string | null): Required<ThreadDebugWatchOptions> {
  if (typeof input === "string") {
    return {
      intervalMs: 250,
      sessionID: input,
    }
  }

  return {
    intervalMs: Math.max(0, Number(input?.intervalMs ?? 250)),
    sessionID: input?.sessionID ?? null,
  }
}

function findStreamingAssistantMessages(conversations: ConversationMessageMap, sessionID?: string | null) {
  const snapshots: ThreadDebugAssistantMessageSnapshot[] = []
  const entries = sessionID
    ? ([[sessionID, conversations[sessionID] ?? EMPTY_MESSAGES]] as Array<[string, ThreadMessage[]]>)
    : Object.entries(conversations)

  for (const [currentSessionID, messages] of entries) {
    for (const message of messages) {
      if (message.kind === "assistant" && message.isStreaming) {
        snapshots.push({ sessionID: currentSessionID, message })
      }
    }
  }

  return snapshots
}

function findAssistantMessages(conversations: ConversationMessageMap, sessionID?: string | null) {
  const snapshots: ThreadDebugAssistantMessageSnapshot[] = []
  const entries = sessionID
    ? ([[sessionID, conversations[sessionID] ?? EMPTY_MESSAGES]] as Array<[string, ThreadMessage[]]>)
    : Object.entries(conversations)

  for (const [currentSessionID, messages] of entries) {
    for (const message of messages) {
      if (message.kind === "assistant") {
        snapshots.push({ sessionID: currentSessionID, message })
      }
    }
  }

  return snapshots
}

function findLatestStreamingAssistantMessage(conversations: ConversationMessageMap, sessionID?: string | null) {
  const snapshots = findStreamingAssistantMessages(conversations, sessionID)
  return snapshots.reduce<ThreadDebugAssistantMessageSnapshot | null>((latest, snapshot) => {
    if (!latest) return snapshot
    const latestUpdatedAt = latest.message.runtime.updatedAt || latest.message.timestamp
    const snapshotUpdatedAt = snapshot.message.runtime.updatedAt || snapshot.message.timestamp
    return snapshotUpdatedAt >= latestUpdatedAt ? snapshot : latest
  }, null)
}

function readThreadDebugWatchSnapshot(conversations: ConversationMessageMap, sessionID?: string | null): ThreadDebugWatchSnapshot {
  const latestStreaming = findLatestStreamingAssistantMessage(conversations, sessionID)
  if (latestStreaming) {
    return {
      kind: "latest-streaming",
      snapshot: latestStreaming,
    }
  }

  return {
    kind: "assistant-messages",
    snapshots: findAssistantMessages(conversations, sessionID),
  }
}

function exposeThreadDebugApi(store: ConversationStoreApi) {
  if (typeof window === "undefined") return

  window.__ANYBOX_THREAD_DEBUG__?.unwatch()

  let watchUnsubscribe: (() => void) | null = null
  let watchTimer: number | null = null
  let lastWatchSignature = ""

  const readLatestStreamingSnapshot = (sessionID?: string | null) =>
    findLatestStreamingAssistantMessage(store.getConversations(), sessionID)

  const cloneSnapshot = <T,>(value: T): T => cloneThreadDebugValue(value)

  const api: ThreadDebugApi = {
    getAssistantMessages(sessionID) {
      return cloneSnapshot(findAssistantMessages(store.getConversations(), sessionID))
    },
    getConversations() {
      return cloneSnapshot(store.getConversations())
    },
    getSessionMessages(sessionID) {
      return cloneSnapshot(store.getSessionMessages(sessionID))
    },
    getSessionTurns(sessionID) {
      return cloneSnapshot(store.getSessionTurns(sessionID))
    },
    getTurns() {
      return cloneSnapshot(store.getTurns())
    },
    getStreamingMessages(sessionID) {
      return cloneSnapshot(findStreamingAssistantMessages(store.getConversations(), sessionID))
    },
    latestStreaming(sessionID) {
      return cloneSnapshot(readLatestStreamingSnapshot(sessionID))
    },
    sessionIDs() {
      return Object.keys(store.getConversations())
    },
    unwatch() {
      if (watchTimer !== null) {
        window.clearTimeout(watchTimer)
        watchTimer = null
      }
      watchUnsubscribe?.()
      watchUnsubscribe = null
      lastWatchSignature = ""
    },
    watch(input) {
      const options = readThreadDebugWatchOptions(input)

      api.unwatch()

      const emit = () => {
        watchTimer = null
        const snapshot = readThreadDebugWatchSnapshot(store.getConversations(), options.sessionID)
        const signature = JSON.stringify(snapshot)
        if (signature === lastWatchSignature) return

        lastWatchSignature = signature
        if (snapshot.kind === "latest-streaming") {
          console.log("[anybox thread debug] latest streaming assistant message", cloneSnapshot(snapshot.snapshot))
          return
        }

        console.log("[anybox thread debug] assistant messages", cloneSnapshot(snapshot.snapshots))
      }

      const scheduleEmit = () => {
        if (options.intervalMs === 0) {
          emit()
          return
        }
        if (watchTimer !== null) return
        watchTimer = window.setTimeout(emit, options.intervalMs)
      }

      watchUnsubscribe = store.subscribe(scheduleEmit)
      emit()
      return api.unwatch
    },
  }

  window.__ANYBOX_THREAD_DEBUG__ = api
}

function installThreadDebugApi(store: ConversationStoreApi) {
  if (typeof window === "undefined" || !import.meta.env.DEV) return

  void getRendererRuntimeCapabilities().then((capabilities) => {
    if (!capabilities.developmentFeaturesEnabled) {
      window.__ANYBOX_THREAD_DEBUG__?.unwatch()
      delete window.__ANYBOX_THREAD_DEBUG__
      return
    }

    exposeThreadDebugApi(store)
  })
}

export function createConversationStore(initialConversations: ConversationMessageMap = {}): ConversationStoreApi {
  let turnsBySession: ConversationTurnMap = {}
  let conversations: ConversationMessageMap = {}
  let activityBySession: ConversationActivityMap = {}
  const sessions = new Map<string, NormalizedSessionConversation>()
  const listeners = new Set<() => void>()
  const sessionListeners = new Map<string, Set<() => void>>()

  function rebuildFromTurns(nextTurnsBySession: ConversationTurnMap) {
    const nextConversations = deriveConversationMessages(nextTurnsBySession)
    const previousConversations = conversations
    const previousActivityBySession = activityBySession
    const changedSessionIDs = new Set<string>()
    const nextActivityBySession: ConversationActivityMap = {}

    for (const sessionID of Object.keys(previousConversations)) {
      if (!Object.prototype.hasOwnProperty.call(nextConversations, sessionID)) {
        sessions.delete(sessionID)
        changedSessionIDs.add(sessionID)
      }
    }

    for (const [sessionID, derivedMessages] of Object.entries(nextConversations)) {
      const previousSession = sessions.get(sessionID)
      const messages = previousSession && Object.is(turnsBySession[sessionID], nextTurnsBySession[sessionID])
        ? previousSession.messages
        : derivedMessages
      if (messages !== derivedMessages) {
        nextConversations[sessionID] = messages
      }
      if (!previousSession || !Object.is(previousSession.messages, messages)) {
        const nextSession = createSessionConversation(messages)
        sessions.set(sessionID, nextSession)
        changedSessionIDs.add(sessionID)
        nextActivityBySession[sessionID] = nextSession.activity
        continue
      }

      nextActivityBySession[sessionID] = previousSession.activity
    }

    turnsBySession = nextTurnsBySession
    conversations = nextConversations
    activityBySession = nextActivityBySession

    return {
      activityChanged: !conversationActivityMapsAreEqual(previousActivityBySession, nextActivityBySession),
      changedSessionIDs,
    }
  }

  function emitChanges(changedSessionIDs: Set<string>) {
    if (changedSessionIDs.size === 0) return

    for (const listener of [...listeners]) {
      listener()
    }

    for (const sessionID of changedSessionIDs) {
      const listenersForSession = sessionListeners.get(sessionID)
      if (!listenersForSession) continue
      for (const listener of [...listenersForSession]) {
        listener()
      }
    }
  }

  function replaceTurns(nextTurns: ConversationTurnMap) {
    if (turnsAreEquivalent(turnsBySession, nextTurns)) return false
    const { changedSessionIDs } = rebuildFromTurns(nextTurns)
    emitChanges(changedSessionIDs)
    return changedSessionIDs.size > 0
  }

  function replaceConversations(nextConversations: ConversationMessageMap) {
    if (conversationsAreEquivalent(conversations, nextConversations)) return false
    return replaceTurns(buildConversationTurnsFromMessagesMap(nextConversations, turnsBySession))
  }

  function updateConversations(update: ConversationStoreUpdater) {
    return replaceConversations(resolveConversationUpdate(conversations, update))
  }

  function updateTurns(update: ConversationTurnStoreUpdater) {
    return replaceTurns(resolveTurnUpdate(turnsBySession, update))
  }

  const api: ConversationStoreApi = {
    appendAssistantDelta(sessionID, assistantMessageID, updater) {
      return updateTurns((current) => {
        const currentTurns = current[sessionID] ?? EMPTY_TURNS
        const nextTurns = currentTurns.map((turn) =>
          updateAssistantMessageInTurn([turn], {
            turnID: turn.turnID,
            id: assistantMessageID,
            updater,
          })[0] ?? turn,
        )
        return nextTurns === currentTurns || nextTurns.every((turn, index) => Object.is(turn, currentTurns[index]))
          ? current
          : { ...current, [sessionID]: nextTurns }
      })
    },
    getActivityBySession() {
      return activityBySession
    },
    getConversations() {
      return conversations
    },
    getSessionTurns(sessionID) {
      return sessionID ? turnsBySession[sessionID] ?? EMPTY_TURNS : EMPTY_TURNS
    },
    getTurns() {
      return turnsBySession
    },
    getSessionActivity(sessionID) {
      return sessionID ? activityBySession[sessionID] ?? EMPTY_CONVERSATION_ACTIVITY : EMPTY_CONVERSATION_ACTIVITY
    },
    getSessionMessages(sessionID) {
      return sessionID ? sessions.get(sessionID)?.messages ?? EMPTY_MESSAGES : EMPTY_MESSAGES
    },
    hasSession(sessionID) {
      return Boolean(sessionID && Object.prototype.hasOwnProperty.call(conversations, sessionID))
    },
    replaceConversations,
    replaceTurns,
    replaceTraceItem(sessionID, assistantMessageID, itemID, item) {
      return updateConversations((current) => {
        const currentMessages = current[sessionID] ?? EMPTY_MESSAGES
        let didUpdate = false
        const nextMessages = currentMessages.map((message) => {
          if (message.kind !== "assistant" || message.id !== assistantMessageID) return message
          const itemIndex = message.items.findIndex((candidate) => candidate.id === itemID)
          if (itemIndex === -1) return message
          const nextItems = [...message.items]
          nextItems[itemIndex] = item
          didUpdate = true
          return {
            ...message,
            items: nextItems,
          }
        })
        return didUpdate ? { ...current, [sessionID]: nextMessages } : current
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribeSession(sessionID, listener) {
      if (!sessionID) return () => {}
      const listenersForSession = sessionListeners.get(sessionID) ?? new Set<() => void>()
      listenersForSession.add(listener)
      sessionListeners.set(sessionID, listenersForSession)

      return () => {
        listenersForSession.delete(listener)
        if (listenersForSession.size === 0) {
          sessionListeners.delete(sessionID)
        }
      }
    },
    updateConversations,
    updateTurns,
  }

  replaceConversations(initialConversations)
  installThreadDebugApi(api)

  return api
}

export function useConversationMessages(
  store: ConversationStoreApi,
  sessionID: string | null | undefined,
) {
  const storeRef = useRef(store)
  const sessionIDRef = useRef(sessionID)

  storeRef.current = store
  sessionIDRef.current = sessionID

  return useSyncExternalStore(
    (listener) => storeRef.current.subscribeSession(sessionIDRef.current, listener),
    () => storeRef.current.getSessionMessages(sessionIDRef.current),
    () => storeRef.current.getSessionMessages(sessionIDRef.current),
  )
}

export function useConversationTurns(
  store: ConversationStoreApi,
  sessionID: string | null | undefined,
) {
  const storeRef = useRef(store)
  const sessionIDRef = useRef(sessionID)

  storeRef.current = store
  sessionIDRef.current = sessionID

  return useSyncExternalStore(
    (listener) => storeRef.current.subscribeSession(sessionIDRef.current, listener),
    () => storeRef.current.getSessionTurns(sessionIDRef.current),
    () => storeRef.current.getSessionTurns(sessionIDRef.current),
  )
}

export { conversationActivityMapsAreEqual }
