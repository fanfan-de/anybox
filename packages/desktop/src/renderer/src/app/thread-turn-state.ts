import type {
  AssistantThreadMessage,
  ConversationTurnMap,
  ThreadMessage,
  ThreadTurn,
  ThreadTurnStatus,
  UserThreadMessage,
} from "./types"

export type ThreadTurnUpdater = (turn: ThreadTurn) => ThreadTurn
export type AssistantThreadMessageUpdater = (message: AssistantThreadMessage) => AssistantThreadMessage

const PENDING_TURN_PREFIX = "pending:"

function readAssistantBackendTurnID(message: AssistantThreadMessage, fallbackTurnID?: string) {
  const candidate = message as AssistantThreadMessage & { backendTurnID?: string }
  return (
    candidate.backendTurnID ||
    message.items.find((item) => item.backendTurnID)?.backendTurnID ||
    fallbackTurnID ||
    message.messageID ||
    message.id
  )
}

function readAssistantSegmentID(message: AssistantThreadMessage) {
  const candidate = message as AssistantThreadMessage & { segmentID?: string }
  return candidate.segmentID || message.messageID || message.id
}

function readAssistantLlmCallID(message: AssistantThreadMessage) {
  const candidate = message as AssistantThreadMessage & { llmCallID?: string }
  return candidate.llmCallID
}

export function normalizeAssistantThreadMessage(
  message: AssistantThreadMessage,
  fallbackTurnID?: string,
): AssistantThreadMessage {
  const backendTurnID = readAssistantBackendTurnID(message, fallbackTurnID)
  const segmentID = readAssistantSegmentID(message)
  const llmCallID = readAssistantLlmCallID(message)

  if (
    message.backendTurnID === backendTurnID &&
    message.segmentID === segmentID &&
    message.llmCallID === llmCallID
  ) {
    return message
  }

  return {
    ...message,
    backendTurnID,
    segmentID,
    ...(llmCallID ? { llmCallID } : {}),
  }
}

export function deriveActiveMessages(turns: ThreadTurn[]) {
  return turns.flatMap((turn) => turn.messages)
}

export function deriveConversationMessages(turnsBySession: ConversationTurnMap) {
  const conversations: Record<string, ThreadMessage[]> = {}
  for (const [sessionID, turns] of Object.entries(turnsBySession)) {
    conversations[sessionID] = deriveActiveMessages(turns)
  }
  return conversations
}

export function ensureConversationTurnSessions(turnsBySession: ConversationTurnMap, sessionIDs: string[]) {
  let nextTurnsBySession = turnsBySession
  for (const sessionID of sessionIDs) {
    if (Object.prototype.hasOwnProperty.call(nextTurnsBySession, sessionID)) continue
    if (nextTurnsBySession === turnsBySession) {
      nextTurnsBySession = { ...turnsBySession }
    }
    nextTurnsBySession[sessionID] = []
  }
  return nextTurnsBySession
}

export function removeConversationTurnSession(turnsBySession: ConversationTurnMap, sessionID: string) {
  if (!Object.prototype.hasOwnProperty.call(turnsBySession, sessionID)) return turnsBySession
  const nextTurnsBySession = { ...turnsBySession }
  delete nextTurnsBySession[sessionID]
  return nextTurnsBySession
}

function isPendingTurnID(turnID: string) {
  return turnID.startsWith(PENDING_TURN_PREFIX)
}

function pendingTurnIDForUserMessage(message: UserThreadMessage) {
  return `${PENDING_TURN_PREFIX}${message.id}`
}

function turnStatusFromAssistant(message: AssistantThreadMessage): ThreadTurnStatus {
  if (message.runtime.phase === "blocked") return "blocked"
  if (message.runtime.phase === "continued_by_user") return "continued_by_user"
  if (message.runtime.phase === "failed") return "failed"
  if (message.runtime.phase === "cancelled") return "cancelled"
  if (message.runtime.phase === "completed") return "completed"
  return "running"
}

function createBaseTurn(input: {
  turnID: string
  previous?: ThreadTurn
  status?: ThreadTurnStatus
  startedAt: number
  updatedAt?: number
  userMessageID?: string
}): ThreadTurn {
  return {
    turnID: input.turnID,
    ...(input.previous?.backendSessionID ? { backendSessionID: input.previous.backendSessionID } : {}),
    ...(input.previous?.lastMessageID ? { lastMessageID: input.previous.lastMessageID } : {}),
    ...(input.previous?.finalSegmentID ? { finalSegmentID: input.previous.finalSegmentID } : {}),
    status: input.previous?.status ?? input.status ?? "running",
    ...(input.previous?.phase ? { phase: input.previous.phase } : {}),
    startedAt: input.previous?.startedAt ?? input.startedAt,
    updatedAt: Math.max(input.previous?.updatedAt ?? input.updatedAt ?? input.startedAt, input.updatedAt ?? input.startedAt),
    ...(input.previous?.completedAt ? { completedAt: input.previous.completedAt } : {}),
    userMessageID: input.userMessageID ?? input.previous?.userMessageID,
    messages: [],
  }
}

function indexPreviousTurns(previousTurns?: ThreadTurn[]) {
  const byTurnID = new Map<string, ThreadTurn>()
  const byUserMessageID = new Map<string, ThreadTurn>()
  for (const turn of previousTurns ?? []) {
    byTurnID.set(turn.turnID, turn)
    if (turn.userMessageID) byUserMessageID.set(turn.userMessageID, turn)
  }
  return { byTurnID, byUserMessageID }
}

function appendMessageToTurn(turn: ThreadTurn, message: ThreadMessage): ThreadTurn {
  const updatedAt = Math.max(turn.updatedAt, message.timestamp)
  if (message.kind === "assistant") {
    const status = turn.status === "running" ? turnStatusFromAssistant(message) : turn.status
    return {
      ...turn,
      ...(status === "completed" || status === "blocked" || status === "continued_by_user" || status === "failed" || status === "cancelled"
        ? {
            lastMessageID: message.messageID ?? message.id,
            ...(message.segmentID ? { finalSegmentID: message.segmentID } : {}),
          }
        : {}),
      status,
      phase: message.runtime.phase,
      updatedAt,
      ...(status === "completed" || status === "blocked" || status === "continued_by_user" || status === "failed" || status === "cancelled"
        ? { completedAt: turn.completedAt ?? message.runtime.updatedAt ?? message.timestamp }
        : {}),
      messages: [...turn.messages, message],
    }
  }

  return {
    ...turn,
    userMessageID: turn.userMessageID ?? message.id,
    updatedAt,
    messages: [...turn.messages, message],
  }
}

function reconcileOneTurn(turn: ThreadTurn) {
  return reconcileThreadTurns([turn])[0] ?? turn
}

function updateTurnMessages(turn: ThreadTurn, messages: ThreadMessage[], updatedAt = Date.now()): ThreadTurn {
  const userMessage = messages.find((message): message is UserThreadMessage => message.kind === "user")
  const baseTurn = userMessage
    ? {
        ...turn,
        userMessageID: turn.userMessageID ?? userMessage.id,
      }
    : (() => {
        const { userMessageID: _userMessageID, ...turnWithoutUserMessageID } = turn
        return turnWithoutUserMessageID
      })()

  return {
    ...baseTurn,
    updatedAt: Math.max(turn.updatedAt, updatedAt),
    messages,
  }
}

function findTurnIndexForAssistantMessage(turns: ThreadTurn[], message: AssistantThreadMessage) {
  const normalized = normalizeAssistantThreadMessage(message)
  const byTurnIDIndex = turns.findIndex((turn) => turn.turnID === normalized.backendTurnID)
  if (byTurnIDIndex >= 0) return byTurnIDIndex

  return turns.findIndex((turn) =>
    turn.messages.some(
      (candidate) =>
        candidate.kind === "assistant" &&
        (candidate.id === normalized.id ||
          candidate.segmentID === normalized.segmentID ||
          Boolean(normalized.messageID && candidate.messageID === normalized.messageID && candidate.segmentID === normalized.segmentID)),
    ),
  )
}

function appendUserMessageToTurns(turns: ThreadTurn[], message: UserThreadMessage) {
  if (turns.some((turn) => turn.messages.some((candidate) => candidate.id === message.id))) return turns
  return [
    ...turns,
    appendMessageToTurn(
      createBaseTurn({
        turnID: pendingTurnIDForUserMessage(message),
        status: "running",
        startedAt: message.timestamp,
        updatedAt: message.timestamp,
        userMessageID: message.id,
      }),
      message,
    ),
  ]
}

function appendAssistantMessageToTurns(turns: ThreadTurn[], message: AssistantThreadMessage) {
  const normalized = normalizeAssistantThreadMessage(message)
  let turnIndex = findTurnIndexForAssistantMessage(turns, normalized)

  if (turnIndex < 0 && turns.length > 0) {
    const latestTurn = turns[turns.length - 1]
    const latestTurnHasAssistant = latestTurn.messages.some((candidate) => candidate.kind === "assistant")
    if (!latestTurnHasAssistant && isPendingTurnID(latestTurn.turnID)) {
      turnIndex = turns.length - 1
    }
  }

  if (turnIndex < 0) {
    const turn = createBaseTurn({
      turnID: normalized.backendTurnID,
      status: turnStatusFromAssistant(normalized),
      startedAt: normalized.timestamp,
      updatedAt: normalized.runtime.updatedAt,
    })
    return [...turns, reconcileOneTurn(appendMessageToTurn(turn, normalizeAssistantThreadMessage(normalized, turn.turnID)))]
  }

  const targetTurn = turns[turnIndex]
  const normalizedForTurn = normalizeAssistantThreadMessage(normalized, targetTurn.turnID)
  const nextTurn = reconcileOneTurn(appendMessageToTurn(
    isPendingTurnID(targetTurn.turnID)
      ? {
          ...targetTurn,
          turnID: normalizedForTurn.backendTurnID,
        }
      : targetTurn,
    normalizedForTurn,
  ))
  if (Object.is(nextTurn, targetTurn)) return turns

  return turns.map((turn, index) => (index === turnIndex ? nextTurn : turn))
}

export function appendMessagesToThreadTurns(turns: ThreadTurn[], nextMessages: ThreadMessage[]) {
  if (nextMessages.length === 0) return turns
  return nextMessages.reduce((currentTurns, message) => (
    message.kind === "user"
      ? appendUserMessageToTurns(currentTurns, message)
      : appendAssistantMessageToTurns(currentTurns, message)
  ), turns)
}

export function insertUserMessageIntoTurns(
  turns: ThreadTurn[],
  userMessage: UserThreadMessage,
  options?: { beforeMessageID?: string },
) {
  if (turns.some((turn) => turn.messages.some((message) => message.id === userMessage.id))) return turns
  const beforeMessageID = options?.beforeMessageID
  if (!beforeMessageID) return appendUserMessageToTurns(turns, userMessage)

  const turnIndex = turns.findIndex((turn) => turn.messages.some((message) => message.id === beforeMessageID))
  if (turnIndex < 0) return appendUserMessageToTurns(turns, userMessage)

  const targetTurn = turns[turnIndex]
  const beforeIndex = targetTurn.messages.findIndex((message) => message.id === beforeMessageID)
  if (beforeIndex < 0) return appendUserMessageToTurns(turns, userMessage)

  const nextMessages = [
    ...targetTurn.messages.slice(0, beforeIndex),
    userMessage,
    ...targetTurn.messages.slice(beforeIndex),
  ]
  const nextTurn = updateTurnMessages(targetTurn, nextMessages, userMessage.timestamp)
  return turns.map((turn, index) => (index === turnIndex ? nextTurn : turn))
}

export function removeMessageFromTurns(turns: ThreadTurn[], messageID: string) {
  let didUpdate = false
  const nextTurns: ThreadTurn[] = []

  for (const turn of turns) {
    const nextMessages = turn.messages.filter((message) => message.id !== messageID)
    if (nextMessages.length === turn.messages.length) {
      nextTurns.push(turn)
      continue
    }

    didUpdate = true
    if (nextMessages.length === 0) continue
    nextTurns.push(updateTurnMessages(turn, nextMessages))
  }

  return didUpdate ? nextTurns : turns
}

export function mapMessageInTurns(
  turns: ThreadTurn[],
  updater: (message: ThreadMessage) => ThreadMessage,
) {
  let didUpdate = false
  const nextTurns = turns.map((turn) => {
    let didUpdateTurn = false
    const nextMessages = turn.messages.map((message) => {
      const nextMessage = updater(message)
      if (!Object.is(nextMessage, message)) {
        didUpdate = true
        didUpdateTurn = true
      }
      return nextMessage
    })

    return didUpdateTurn ? updateTurnMessages(turn, nextMessages) : turn
  })

  return didUpdate ? reconcileThreadTurns(nextTurns) : turns
}

export function buildThreadTurnsFromMessages(
  messages: ThreadMessage[],
  previousTurns?: ThreadTurn[],
): ThreadTurn[] {
  const turns: ThreadTurn[] = []
  const { byTurnID, byUserMessageID } = indexPreviousTurns(previousTurns)
  let currentTurnIndex = -1

  function findTurnIndex(turnID: string) {
    return turns.findIndex((turn) => turn.turnID === turnID)
  }

  for (const message of messages) {
    if (message.kind === "user") {
      const previous = byUserMessageID.get(message.id)
      const turnID = previous?.turnID ?? pendingTurnIDForUserMessage(message)
      const turn = createBaseTurn({
        turnID,
        previous,
        status: previous?.status ?? "running",
        startedAt: message.timestamp,
        updatedAt: message.timestamp,
        userMessageID: message.id,
      })
      turns.push(appendMessageToTurn(turn, message))
      currentTurnIndex = turns.length - 1
      continue
    }

    const normalizedAssistant = normalizeAssistantThreadMessage(message)
    const turnID = normalizedAssistant.backendTurnID
    let turnIndex = findTurnIndex(turnID)

    if (turnIndex < 0 && currentTurnIndex >= 0) {
      const currentTurn = turns[currentTurnIndex]
      const currentTurnHasAssistant = currentTurn.messages.some((candidate) => candidate.kind === "assistant")
      if (!currentTurnHasAssistant && isPendingTurnID(currentTurn.turnID)) {
        const previous = byTurnID.get(turnID)
        turns[currentTurnIndex] = {
          ...currentTurn,
          ...(previous ?? {}),
          turnID,
          status: previous?.status ?? currentTurn.status,
          phase: previous?.phase ?? currentTurn.phase,
          startedAt: previous?.startedAt ?? currentTurn.startedAt,
          updatedAt: Math.max(previous?.updatedAt ?? currentTurn.updatedAt, normalizedAssistant.timestamp),
          userMessageID: currentTurn.userMessageID ?? previous?.userMessageID,
          messages: currentTurn.messages,
        }
        turnIndex = currentTurnIndex
      }
    }

    if (turnIndex < 0) {
      const previous = byTurnID.get(turnID)
      const turn = createBaseTurn({
        turnID,
        previous,
        status: turnStatusFromAssistant(normalizedAssistant),
        startedAt: normalizedAssistant.timestamp,
        updatedAt: normalizedAssistant.runtime.updatedAt,
      })
      turns.push(turn)
      turnIndex = turns.length - 1
    }

    const turn = turns[turnIndex]
    turns[turnIndex] = appendMessageToTurn(turn, normalizeAssistantThreadMessage(normalizedAssistant, turn.turnID))
    currentTurnIndex = turnIndex
  }

  return reconcileThreadTurns(turns).map((turn) => {
    const previous = byTurnID.get(turn.turnID) ?? (
      turn.userMessageID ? byUserMessageID.get(turn.userMessageID) : undefined
    )
    if (!previous || previous.status === "running") return turn

    if (previous.finalSegmentID) {
      return {
        ...turn,
        finalSegmentID: previous.finalSegmentID,
        ...(previous.lastMessageID ? { lastMessageID: previous.lastMessageID } : {}),
      }
    }
    if (!previous.lastMessageID) return turn

    const { finalSegmentID: _inferredFinalSegmentID, ...withoutInferredSegment } = turn
    return {
      ...withoutInferredSegment,
      lastMessageID: previous.lastMessageID,
    }
  })
}

export function buildConversationTurnsFromMessagesMap(
  conversations: Record<string, ThreadMessage[]>,
  previousTurnsBySession: ConversationTurnMap = {},
): ConversationTurnMap {
  const turnsBySession: ConversationTurnMap = {}
  for (const [sessionID, messages] of Object.entries(conversations)) {
    turnsBySession[sessionID] = buildThreadTurnsFromMessages(messages, previousTurnsBySession[sessionID])
  }
  return turnsBySession
}

function assistantSegmentMergeKey(message: AssistantThreadMessage) {
  if (message.segmentID) return `segment:${message.segmentID}`
  if (message.messageID) return `message:${message.messageID}`
  return `id:${message.id}`
}

function mergeAssistantMessages(current: AssistantThreadMessage, incoming: AssistantThreadMessage): AssistantThreadMessage {
  const incomingItemIDs = new Set(incoming.items.map((item) => item.id))
  const currentItemsWithoutIncomingDuplicates = current.items.filter((item) => !incomingItemIDs.has(item.id))
  const items = [...currentItemsWithoutIncomingDuplicates, ...incoming.items]
  const updatedAt = Math.max(current.runtime.updatedAt, incoming.runtime.updatedAt)
  return {
    ...current,
    ...incoming,
    id: current.id,
    backendTurnID: current.backendTurnID,
    segmentID: current.segmentID,
    timestamp: Math.min(current.timestamp, incoming.timestamp),
    runtime: {
      ...current.runtime,
      ...incoming.runtime,
      updatedAt,
      firstVisibleAt: current.runtime.firstVisibleAt ?? incoming.runtime.firstVisibleAt,
    },
    items,
  }
}

export function reconcileThreadTurns(turns: ThreadTurn[]): ThreadTurn[] {
  return turns.map((turn) => {
    const messages: ThreadMessage[] = []
    const assistantIndexByKey = new Map<string, number>()

    for (const message of turn.messages) {
      if (message.kind !== "assistant") {
        messages.push(message)
        continue
      }

      const normalized = normalizeAssistantThreadMessage(message, turn.turnID)
      const key = assistantSegmentMergeKey(normalized)
      const existingIndex = assistantIndexByKey.get(key)
      if (existingIndex === undefined) {
        assistantIndexByKey.set(key, messages.length)
        messages.push(normalized)
        continue
      }

      const existing = messages[existingIndex]
      if (!existing || existing.kind !== "assistant") {
        messages.push(normalized)
        continue
      }

      messages[existingIndex] = mergeAssistantMessages(existing, normalized)
    }

    return {
      ...turn,
      messages,
    }
  })
}

type PendingTurnMatch =
  | { kind: "none" }
  | { kind: "unique"; index: number }
  | { kind: "ambiguous" }

function resolvePendingTurnMatch(indexes: number[]): PendingTurnMatch {
  if (indexes.length === 0) return { kind: "none" }
  if (indexes.length === 1) return { kind: "unique", index: indexes[0]! }
  return { kind: "ambiguous" }
}

function pendingTurnMatchesCanonicalBackendTurn(turn: ThreadTurn, turnID: string) {
  const assistantMessages = turn.messages.filter(
    (message): message is AssistantThreadMessage => message.kind === "assistant",
  )
  return assistantMessages.some((message) => message.backendTurnID === turnID) &&
    assistantMessages.every((message) => (
      isPendingTurnID(message.backendTurnID) || message.backendTurnID === turnID
    ))
}

function findPendingTurnIndexForCanonicalBinding(
  turns: ThreadTurn[],
  input: {
    assistantThreadMessageID?: string
    optimisticUserMessageID?: string
    turnID: string
  },
) {
  const pendingTurnIndexes = turns.flatMap((turn, index) => (
    isPendingTurnID(turn.turnID) ? [index] : []
  ))
  const matches: PendingTurnMatch[] = []

  if (input.assistantThreadMessageID) {
    matches.push(resolvePendingTurnMatch(pendingTurnIndexes.filter((index) => {
      const turn = turns[index]!
      return turn.turnID === `${PENDING_TURN_PREFIX}${input.assistantThreadMessageID}` ||
        turn.messages.some(
          (message) => message.kind === "assistant" && message.id === input.assistantThreadMessageID,
        )
    })))
  }

  if (input.optimisticUserMessageID) {
    matches.push(resolvePendingTurnMatch(pendingTurnIndexes.filter((index) => {
      const turn = turns[index]!
      return turn.userMessageID === input.optimisticUserMessageID ||
        turn.messages.some(
          (message) => message.kind === "user" && message.id === input.optimisticUserMessageID,
        )
    })))
  }

  matches.push(resolvePendingTurnMatch(pendingTurnIndexes.filter((index) =>
    pendingTurnMatchesCanonicalBackendTurn(turns[index]!, input.turnID),
  )))
  if (matches.some((match) => match.kind === "ambiguous")) return -1

  const uniqueIndexes = new Set(matches.flatMap((match) => (
    match.kind === "unique" ? [match.index] : []
  )))
  return uniqueIndexes.size === 1 ? [...uniqueIndexes][0]! : -1
}

function pendingTurnCanBindToCanonicalTurn(turn: ThreadTurn, turnID: string) {
  return turn.messages.every((message) => (
    message.kind !== "assistant" ||
    isPendingTurnID(message.backendTurnID) ||
    message.backendTurnID === turnID
  ))
}

function mergeBoundUserMessages(
  current: UserThreadMessage,
  incoming: UserThreadMessage,
  preferredUserMessageID: string | undefined,
): UserThreadMessage {
  const preferred = incoming.id === preferredUserMessageID && current.id !== preferredUserMessageID
    ? incoming
    : current
  const fallback = preferred === current ? incoming : current
  return {
    ...fallback,
    ...preferred,
    id: preferred.id,
    text: preferred.text || fallback.text,
    timestamp: Math.min(current.timestamp, incoming.timestamp),
  }
}

function mergeBoundAssistantMessages(
  current: AssistantThreadMessage,
  incoming: AssistantThreadMessage,
  input: {
    currentWasPending: boolean
    incomingWasPending: boolean
    preferredAssistantThreadMessageID?: string
    turnID: string
  },
) {
  const identity = input.currentWasPending && !input.incomingWasPending
    ? incoming
    : !input.currentWasPending && input.incomingWasPending
      ? current
      : incoming
  const withCanonicalIdentity = (message: AssistantThreadMessage): AssistantThreadMessage => {
    const {
      messageID: _messageID,
      llmCallID: _llmCallID,
      ...messageWithoutOptionalIdentity
    } = message
    return {
      ...messageWithoutOptionalIdentity,
      backendTurnID: input.turnID,
      segmentID: identity.segmentID,
      ...(identity.messageID ? { messageID: identity.messageID } : {}),
      ...(identity.llmCallID ? { llmCallID: identity.llmCallID } : {}),
    }
  }
  const currentWithCanonicalIdentity = withCanonicalIdentity(current)
  const incomingWithCanonicalIdentity = withCanonicalIdentity(incoming)
  const merged = !input.currentWasPending && input.incomingWasPending
    ? mergeAssistantMessages(incomingWithCanonicalIdentity, currentWithCanonicalIdentity)
    : mergeAssistantMessages(currentWithCanonicalIdentity, incomingWithCanonicalIdentity)
  const preferredID = current.id === input.preferredAssistantThreadMessageID
    ? current.id
    : incoming.id === input.preferredAssistantThreadMessageID
      ? incoming.id
      : current.id
  return withCanonicalIdentity({
    ...merged,
    id: preferredID,
  })
}

function mergeBoundTurnMessages(
  turns: ThreadTurn[],
  turnIndexes: ReadonlySet<number>,
  input: {
    assistantThreadMessageID?: string
    backendUserMessageID?: string
    optimisticUserMessageID?: string
    preferredUserMessageID?: string
    turnID: string
    userMessageAliases?: readonly string[]
  },
) {
  const messages: ThreadMessage[] = []
  const assistantWasPendingByIndex = new Map<number, boolean>()
  const explicitUserAliases = new Set(
    [
      input.optimisticUserMessageID,
      input.backendUserMessageID,
      ...(input.userMessageAliases ?? []),
    ].filter(
      (value): value is string => Boolean(value),
    ),
  )
  let explicitUserAliasIndex = -1

  turns.forEach((turn, turnIndex) => {
    if (!turnIndexes.has(turnIndex)) return

    turn.messages.forEach((sourceMessage) => {
      if (sourceMessage.kind === "user") {
        const exactIndex = messages.findIndex(
          (message) => message.kind === "user" && message.id === sourceMessage.id,
        )
        const aliasIndex = explicitUserAliases.has(sourceMessage.id) ? explicitUserAliasIndex : -1
        const existingIndex = exactIndex >= 0 ? exactIndex : aliasIndex
        if (existingIndex < 0) {
          if (explicitUserAliases.has(sourceMessage.id)) explicitUserAliasIndex = messages.length
          messages.push(sourceMessage)
          return
        }

        const existing = messages[existingIndex]
        if (existing?.kind === "user") {
          messages[existingIndex] = mergeBoundUserMessages(
            existing,
            sourceMessage,
            input.preferredUserMessageID,
          )
        }
        return
      }

      const sourceWasPending = isPendingTurnID(turn.turnID) || isPendingTurnID(sourceMessage.backendTurnID)
      const message = isPendingTurnID(sourceMessage.backendTurnID)
        ? { ...sourceMessage, backendTurnID: input.turnID }
        : sourceMessage
      const existingIndex = messages.findIndex((candidate) =>
        candidate.kind === "assistant" && (
          candidate.id === message.id || candidate.segmentID === message.segmentID
        ),
      )
      if (existingIndex < 0) {
        assistantWasPendingByIndex.set(messages.length, sourceWasPending)
        messages.push(message)
        return
      }

      const existing = messages[existingIndex]
      if (existing?.kind !== "assistant") return
      const currentWasPending = assistantWasPendingByIndex.get(existingIndex) ?? false
      messages[existingIndex] = mergeBoundAssistantMessages(existing, message, {
        currentWasPending,
        incomingWasPending: sourceWasPending,
        preferredAssistantThreadMessageID: input.assistantThreadMessageID,
        turnID: input.turnID,
      })
      assistantWasPendingByIndex.set(existingIndex, currentWasPending && sourceWasPending)
    })
  })

  return messages
}

function resolveBoundTurnUserMessageID(
  messages: ThreadMessage[],
  pendingTurn: ThreadTurn,
  canonicalTurn: ThreadTurn | undefined,
  input: {
    backendUserMessageID?: string
    optimisticUserMessageID?: string
  },
) {
  const userMessageIDs = new Set(
    messages.flatMap((message) => message.kind === "user" ? [message.id] : []),
  )
  const candidates = [
    input.optimisticUserMessageID,
    pendingTurn.userMessageID,
    input.backendUserMessageID,
    canonicalTurn?.userMessageID,
  ]
  const matchingCandidate = candidates.find(
    (candidate): candidate is string => Boolean(candidate && userMessageIDs.has(candidate)),
  )
  if (matchingCandidate) return matchingCandidate
  return canonicalTurn?.userMessageID ?? pendingTurn.userMessageID
}

/**
 * Atomically re-homes a renderer-created pending turn under its authoritative backend turn id.
 * Only explicit user/assistant identities or an already-bound assistant backend turn may match;
 * positional or text-based inference is intentionally forbidden.
 */
export function bindPendingThreadTurnToCanonical(
  turns: ThreadTurn[],
  input: {
    assistantThreadMessageID?: string
    backendUserMessageID?: string
    optimisticUserMessageID?: string
    turnID: string
  },
): ThreadTurn[] {
  if (!input.turnID || isPendingTurnID(input.turnID)) return turns

  const canonicalTurnIndexes = turns.flatMap((turn, index) => (
    turn.turnID === input.turnID ? [index] : []
  ))
  if (canonicalTurnIndexes.length > 1) return turns

  const pendingTurnIndex = findPendingTurnIndexForCanonicalBinding(turns, input)
  if (pendingTurnIndex < 0) return turns
  const pendingTurn = turns[pendingTurnIndex]!
  if (!pendingTurnCanBindToCanonicalTurn(pendingTurn, input.turnID)) return turns

  const canonicalTurnIndex = canonicalTurnIndexes[0]
  if (canonicalTurnIndex !== undefined) {
    const firstIndex = Math.min(pendingTurnIndex, canonicalTurnIndex)
    const lastIndex = Math.max(pendingTurnIndex, canonicalTurnIndex)
    const crossesUserTurn = turns.slice(firstIndex + 1, lastIndex).some((turn) =>
      turn.messages.some((message) => message.kind === "user"),
    )
    if (crossesUserTurn) return turns
  }

  const canonicalTurn = canonicalTurnIndex === undefined ? undefined : turns[canonicalTurnIndex]
  const turnIndexes = new Set([
    pendingTurnIndex,
    ...(canonicalTurnIndex === undefined ? [] : [canonicalTurnIndex]),
  ])
  const messages = mergeBoundTurnMessages(turns, turnIndexes, {
    ...input,
    preferredUserMessageID: input.optimisticUserMessageID ?? pendingTurn.userMessageID,
    userMessageAliases: [
      ...(pendingTurn.userMessageID ? [pendingTurn.userMessageID] : []),
      ...(canonicalTurn?.userMessageID ? [canonicalTurn.userMessageID] : []),
    ],
  })
  const userMessageID = resolveBoundTurnUserMessageID(messages, pendingTurn, canonicalTurn, input)
  const sourceForCanonicalMetadata = canonicalTurn ?? pendingTurn
  const mergedTurn: ThreadTurn = {
    turnID: input.turnID,
    ...(canonicalTurn?.backendSessionID ?? pendingTurn.backendSessionID
      ? { backendSessionID: canonicalTurn?.backendSessionID ?? pendingTurn.backendSessionID }
      : {}),
    status: sourceForCanonicalMetadata.status,
    ...(canonicalTurn?.phase ?? pendingTurn.phase
      ? { phase: canonicalTurn?.phase ?? pendingTurn.phase }
      : {}),
    startedAt: canonicalTurn
      ? Math.min(pendingTurn.startedAt, canonicalTurn.startedAt)
      : pendingTurn.startedAt,
    updatedAt: canonicalTurn
      ? Math.max(pendingTurn.updatedAt, canonicalTurn.updatedAt)
      : pendingTurn.updatedAt,
    ...(canonicalTurn
      ? canonicalTurn.completedAt !== undefined ? { completedAt: canonicalTurn.completedAt } : {}
      : pendingTurn.completedAt !== undefined ? { completedAt: pendingTurn.completedAt } : {}),
    ...(canonicalTurn
      ? canonicalTurn.lastMessageID ? { lastMessageID: canonicalTurn.lastMessageID } : {}
      : pendingTurn.lastMessageID ? { lastMessageID: pendingTurn.lastMessageID } : {}),
    ...(canonicalTurn
      ? canonicalTurn.finalSegmentID ? { finalSegmentID: canonicalTurn.finalSegmentID } : {}
      : pendingTurn.finalSegmentID ? { finalSegmentID: pendingTurn.finalSegmentID } : {}),
    ...(userMessageID ? { userMessageID } : {}),
    messages,
  }
  const reconciledTurn = reconcileThreadTurns([mergedTurn])[0] ?? mergedTurn

  if (canonicalTurnIndex === undefined) {
    return turns.map((turn, index) => index === pendingTurnIndex ? reconciledTurn : turn)
  }

  const insertIndex = Math.min(pendingTurnIndex, canonicalTurnIndex)
  const nextTurns: ThreadTurn[] = []
  turns.forEach((turn, index) => {
    if (index === insertIndex) nextTurns.push(reconciledTurn)
    if (index !== pendingTurnIndex && index !== canonicalTurnIndex) nextTurns.push(turn)
  })
  return nextTurns
}

export function ensureThreadTurn(
  turns: ThreadTurn[],
  input: {
    turnID: string
    backendSessionID?: string
    lastMessageID?: string
    finalSegmentID?: string
    status?: ThreadTurnStatus
    phase?: ThreadTurn["phase"]
    userMessageID?: string
    timestamp?: number
  },
): ThreadTurn[] {
  const now = input.timestamp ?? Date.now()
  const mergeRuntimeState = (turn: ThreadTurn, nextTurnID = turn.turnID): ThreadTurn => {
    const nextStatus = input.status ?? turn.status
    const next: ThreadTurn = {
      ...turn,
      turnID: nextTurnID,
      ...(input.backendSessionID ? { backendSessionID: input.backendSessionID } : {}),
      status: nextStatus,
      phase: input.phase ?? turn.phase,
      userMessageID: input.userMessageID ?? turn.userMessageID,
      updatedAt: Math.max(turn.updatedAt, now),
    }

    if (input.status === "running") {
      delete next.completedAt
      delete next.lastMessageID
      delete next.finalSegmentID
      return next
    }

    if (input.lastMessageID) {
      next.lastMessageID = input.lastMessageID
      if (turn.lastMessageID && turn.lastMessageID !== input.lastMessageID && !input.finalSegmentID) {
        delete next.finalSegmentID
      }
    }
    if (input.finalSegmentID) next.finalSegmentID = input.finalSegmentID
    return next
  }
  const existingIndex = turns.findIndex((turn) => turn.turnID === input.turnID)
  if (existingIndex >= 0) {
    return turns.map((turn, index) => (
      index === existingIndex
        ? mergeRuntimeState(turn)
        : turn
    ))
  }

  const pendingUserTurnIndex = input.userMessageID
    ? turns.findIndex((turn) => turn.userMessageID === input.userMessageID && isPendingTurnID(turn.turnID))
    : -1
  if (pendingUserTurnIndex >= 0) {
    return turns.map((turn, index) => (
      index === pendingUserTurnIndex
        ? mergeRuntimeState(turn, input.turnID)
        : turn
    ))
  }

  return [
    ...turns,
    {
      turnID: input.turnID,
      ...(input.backendSessionID ? { backendSessionID: input.backendSessionID } : {}),
      ...(input.lastMessageID ? { lastMessageID: input.lastMessageID } : {}),
      ...(input.finalSegmentID ? { finalSegmentID: input.finalSegmentID } : {}),
      status: input.status ?? "running",
      ...(input.phase ? { phase: input.phase } : {}),
      startedAt: now,
      updatedAt: now,
      ...(input.userMessageID ? { userMessageID: input.userMessageID } : {}),
      messages: [],
    },
  ]
}

export function findAssistantSegmentInTurn(
  turn: ThreadTurn,
  input: {
    id?: string
    messageID?: string
    segmentID?: string
  },
) {
  return turn.messages.find((message): message is AssistantThreadMessage => {
    if (message.kind !== "assistant") return false
    if (input.id && message.id === input.id) return true
    if (input.segmentID && message.segmentID === input.segmentID) return true
    return Boolean(input.messageID && message.messageID === input.messageID && (!input.segmentID || message.segmentID === input.segmentID))
  }) ?? null
}

export function updateAssistantMessageInTurn(
  turns: ThreadTurn[],
  input: {
    turnID: string
    id?: string
    messageID?: string
    segmentID?: string
    updater: AssistantThreadMessageUpdater
  },
) {
  let didUpdate = false
  const nextTurns = turns.map((turn) => {
    if (turn.turnID !== input.turnID) return turn

    let didUpdateTurn = false
    const nextMessages = turn.messages.map((message): ThreadMessage => {
      if (message.kind !== "assistant") return message
      if (input.id && message.id === input.id) {
        const nextMessage = input.updater(message)
        if (!Object.is(nextMessage, message)) {
          didUpdate = true
          didUpdateTurn = true
        }
        return nextMessage
      }
      if (input.segmentID && message.segmentID === input.segmentID) {
        const nextMessage = input.updater(message)
        if (!Object.is(nextMessage, message)) {
          didUpdate = true
          didUpdateTurn = true
        }
        return nextMessage
      }
      if (input.messageID && message.messageID === input.messageID && (!input.segmentID || message.segmentID === input.segmentID)) {
        const nextMessage = input.updater(message)
        if (!Object.is(nextMessage, message)) {
          didUpdate = true
          didUpdateTurn = true
        }
        return nextMessage
      }
      return message
    })

    return didUpdateTurn
      ? {
          ...turn,
          updatedAt: Date.now(),
          messages: nextMessages,
        }
      : turn
  })

  return didUpdate ? nextTurns : turns
}
