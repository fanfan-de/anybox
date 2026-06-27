import type { AssistantThreadMessage, ThreadMessage } from "./types"

export type ConversationMessageMap = Record<string, ThreadMessage[]>
export type SessionIDMap = Record<string, string>

export function appendConversationMessages(conversations: ConversationMessageMap, sessionID: string, nextMessages: ThreadMessage[]) {
  return {
    ...conversations,
    [sessionID]: [...(conversations[sessionID] ?? []), ...nextMessages],
  }
}

export function updateAssistantThreadMessage(
  conversations: ConversationMessageMap,
  sessionID: string,
  assistantMessageID: string,
  updater: (message: AssistantThreadMessage) => AssistantThreadMessage,
) {
  const messages = conversations[sessionID] ?? []
  let updated = false
  const nextMessages = messages.map((message) => {
    if (message.kind !== "assistant" || message.id !== assistantMessageID) return message
    updated = true
    return updater(message)
  })

  if (!updated) return conversations
  return {
    ...conversations,
    [sessionID]: nextMessages,
  }
}

export function ensureConversationSessions(conversations: ConversationMessageMap, sessionIDs: string[]) {
  const next = { ...conversations }
  for (const sessionID of sessionIDs) {
    next[sessionID] ??= []
  }
  return next
}

export function ensureAgentSessions(agentSessions: SessionIDMap, sessionIDs: string[]) {
  const next = { ...agentSessions }
  for (const sessionID of sessionIDs) {
    next[sessionID] ??= sessionID
  }
  return next
}

export function removeConversationSession(conversations: ConversationMessageMap, sessionID: string) {
  const next = { ...conversations }
  delete next[sessionID]
  return next
}

export function removeAgentSession(agentSessions: SessionIDMap, sessionID: string) {
  const next = { ...agentSessions }
  delete next[sessionID]
  return next
}
