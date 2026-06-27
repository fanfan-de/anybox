import type { LoadedSessionHistoryMessage } from "./types"

const ROOT_PARENT_ID = "__root__"
const MESSAGE_TREE_NODE_CONTENT_LIMIT = 12_000
const MESSAGE_TREE_NODE_TRUNCATION_MARKER = "\n\n[Message tree preview truncated to keep the desktop responsive.]"

export interface SessionMessageTreeNode {
  id: string
  sessionID: string
  role: "user" | "assistant"
  created: number
  parentMessageID: string | null
  content: string
  preview: string
}

export interface SessionMessageBranchOption {
  childMessageID: string
  index: number
  isActive: boolean
  label: string
  leafMessageID: string
  parentMessageID: string
  preview: string
  total: number
}

export interface SessionMessageTree {
  activeMessageID: string | null
  activePathMessageIDs: string[]
  branchOptionsByParentID: Record<string, SessionMessageBranchOption[]>
  childIDsByParentID: Record<string, string[]>
  nodesByID: Record<string, SessionMessageTreeNode>
  rootMessageIDs: string[]
  sessionID: string
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false
}

function compactPreview(value: string, maxLength = 72) {
  const compacted = value.replace(/\s+/g, " ").trim()
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1)}...` : compacted
}

function limitNodeContent(value: string) {
  if (value.length <= MESSAGE_TREE_NODE_CONTENT_LIMIT) return value
  return `${value.slice(0, MESSAGE_TREE_NODE_CONTENT_LIMIT)}${MESSAGE_TREE_NODE_TRUNCATION_MARKER}`
}

function readTextPartPreview(part: unknown) {
  const record = readRecord(part)
  if (!record || readString(record.type) !== "text") return ""
  return readString(record.text)
}

function getMessageContent(message: LoadedSessionHistoryMessage) {
  const displayText = readString(message.info.displayText)
  if (displayText.trim()) return displayText.trim()

  const text = message.parts.map(readTextPartPreview).filter(Boolean).join("\n\n").trim()
  if (text) return text

  if (message.info.role === "user") return "User message"
  return "Assistant response"
}

function getMessagePreview(message: LoadedSessionHistoryMessage) {
  return compactPreview(getMessageContent(message).replace(/\n+/g, " "))
}

function hasAssistantResponseText(message: LoadedSessionHistoryMessage) {
  if (readString(message.info.displayText).trim()) return true
  return message.parts.some((part) => readTextPartPreview(part).trim())
}

function getMessageTurnID(message: LoadedSessionHistoryMessage) {
  return readString(message["turn"]?.id).trim() || readString(message.info.turnID).trim()
}

function getMessageTurnLastMessageID(message: LoadedSessionHistoryMessage) {
  return readString(message["turn"]?.lastMessageID).trim() || readString(message.info.lastMessageID).trim()
}

function isAssistantResponseTreeCandidate(message: LoadedSessionHistoryMessage) {
  return (
    !readBoolean(message.info.internal) &&
    message.info.role === "assistant" &&
    Boolean(message.info.id) &&
    hasAssistantResponseText(message)
  )
}

function selectFinalAssistantMessagesByTurn(messages: LoadedSessionHistoryMessage[]) {
  const candidatesByTurnID = new Map<string, LoadedSessionHistoryMessage[]>()

  for (const message of messages) {
    if (!isAssistantResponseTreeCandidate(message)) continue
    const turnID = getMessageTurnID(message)
    if (!turnID) continue
    candidatesByTurnID.set(turnID, [...(candidatesByTurnID.get(turnID) ?? []), message])
  }

  const finalAssistantMessageIDs = new Set<string>()
  const finalAssistantMessageIDByTurnID = new Map<string, string>()

  for (const [turnID, candidates] of candidatesByTurnID) {
    const candidatesByID = new Map(candidates.map((candidate) => [candidate.info.id, candidate]))
    let finalMessage: LoadedSessionHistoryMessage | undefined

    for (const candidate of candidates) {
      const lastMessageID = getMessageTurnLastMessageID(candidate)
      if (!lastMessageID) continue
      finalMessage = candidatesByID.get(lastMessageID)
      if (finalMessage) break
    }

    finalMessage ??= [...candidates].sort((left, right) => {
      const createdDelta = readNumber(left.info.created) - readNumber(right.info.created)
      if (createdDelta !== 0) return createdDelta
      return left.info.id.localeCompare(right.info.id)
    }).at(-1)

    if (!finalMessage?.info.id) continue
    finalAssistantMessageIDs.add(finalMessage.info.id)
    finalAssistantMessageIDByTurnID.set(turnID, finalMessage.info.id)
  }

  return {
    finalAssistantMessageIDByTurnID,
    finalAssistantMessageIDs,
  }
}

function shouldIncludeMessageTreeNode(
  message: LoadedSessionHistoryMessage,
  finalAssistantMessageIDs: Set<string>,
) {
  if (readBoolean(message.info.internal)) return false
  if (message.info.role === "user") return true
  if (message.info.role !== "assistant") return false
  if (!hasAssistantResponseText(message)) return false

  const turnID = getMessageTurnID(message)
  if (!turnID) return true

  return finalAssistantMessageIDs.has(message.info.id)
}

function getParentKey(parentMessageID: string | null) {
  return parentMessageID ?? ROOT_PARENT_ID
}

function sortMessageNodes(left: SessionMessageTreeNode, right: SessionMessageTreeNode) {
  if (left.created !== right.created) return left.created - right.created
  return left.id.localeCompare(right.id)
}

function buildActivePath(nodesByID: Record<string, SessionMessageTreeNode>, activeMessageID: string | null) {
  if (!activeMessageID) return []

  const path: string[] = []
  const seen = new Set<string>()
  let currentID: string | null = activeMessageID

  while (currentID) {
    if (seen.has(currentID)) return []
    seen.add(currentID)

    const node: SessionMessageTreeNode | undefined = nodesByID[currentID]
    if (!node) return []

    path.push(node.id)
    currentID = node.parentMessageID
  }

  return path.reverse()
}

function resolveLatestLeafID(
  childIDsByParentID: Record<string, string[]>,
  nodesByID: Record<string, SessionMessageTreeNode>,
  messageID: string,
) {
  let currentID = messageID
  const seen = new Set<string>()

  while (!seen.has(currentID)) {
    seen.add(currentID)
    const children = childIDsByParentID[currentID] ?? []
    if (children.length === 0) return currentID
    currentID = children[children.length - 1] ?? currentID
    if (!nodesByID[currentID]) return messageID
  }

  return messageID
}

export function buildSessionMessageTree(
  messages: LoadedSessionHistoryMessage[],
  activeMessageID?: string | null,
): SessionMessageTree | null {
  const messageByID = new Map<string, LoadedSessionHistoryMessage>()
  const parentIDByMessageID = new Map<string, string | null>()
  for (const message of messages) {
    if (!message.info.id) continue
    messageByID.set(message.info.id, message)
    parentIDByMessageID.set(
      message.info.id,
      typeof message.info.parentMessageID === "string" ? message.info.parentMessageID : null,
    )
  }
  const {
    finalAssistantMessageIDByTurnID,
    finalAssistantMessageIDs,
  } = selectFinalAssistantMessagesByTurn(messages)

  const nodes = messages
    .filter((message) => shouldIncludeMessageTreeNode(message, finalAssistantMessageIDs))
    .map((message): SessionMessageTreeNode => ({
      id: message.info.id,
      sessionID: message.info.sessionID,
      role: message.info.role,
      created: readNumber(message.info.created),
      content: limitNodeContent(getMessageContent(message)),
      parentMessageID: typeof message.info.parentMessageID === "string" ? message.info.parentMessageID : null,
      preview: getMessagePreview(message),
    }))
    .filter((node) => node.id && node.sessionID)
    .sort(sortMessageNodes)

  const firstNode = nodes[0]
  if (!firstNode) return null

  const nodesByID: Record<string, SessionMessageTreeNode> = {}
  const childIDsByParentID: Record<string, string[]> = {}

  for (const node of nodes) {
    nodesByID[node.id] = node
  }

  for (const node of nodes) {
    let parentMessageID = node.parentMessageID
    const seenParentIDs = new Set<string>()
    while (parentMessageID && !nodesByID[parentMessageID]) {
      if (seenParentIDs.has(parentMessageID)) {
        parentMessageID = null
        break
      }
      seenParentIDs.add(parentMessageID)
      parentMessageID = parentIDByMessageID.get(parentMessageID) ?? null
    }

    node.parentMessageID = parentMessageID
    const parentKey = getParentKey(parentMessageID)
    childIDsByParentID[parentKey] = [...(childIDsByParentID[parentKey] ?? []), node.id]
  }

  for (const [parentID, childIDs] of Object.entries(childIDsByParentID)) {
    childIDsByParentID[parentID] = [...childIDs].sort((leftID, rightID) =>
      sortMessageNodes(nodesByID[leftID]!, nodesByID[rightID]!),
    )
  }

  const rootMessageIDs = childIDsByParentID[ROOT_PARENT_ID] ?? []
  const resolvedActiveMessageID = (() => {
    if (activeMessageID && nodesByID[activeMessageID]) return activeMessageID

    if (activeMessageID) {
      const activeMessage = messageByID.get(activeMessageID)
      const activeTurnID = activeMessage ? getMessageTurnID(activeMessage) : ""
      const activeTurnFinalMessageID = activeTurnID
        ? finalAssistantMessageIDByTurnID.get(activeTurnID) ?? null
        : null
      if (activeTurnFinalMessageID && nodesByID[activeTurnFinalMessageID]) return activeTurnFinalMessageID

      let parentMessageID = parentIDByMessageID.get(activeMessageID) ?? null
      const seenParentIDs = new Set<string>()
      while (parentMessageID) {
        if (nodesByID[parentMessageID]) return parentMessageID
        if (seenParentIDs.has(parentMessageID)) break
        seenParentIDs.add(parentMessageID)
        parentMessageID = parentIDByMessageID.get(parentMessageID) ?? null
      }
    }

    return nodes[nodes.length - 1]?.id ?? null
  })()
  const activePathMessageIDs = buildActivePath(nodesByID, resolvedActiveMessageID)
  const activePathSet = new Set(activePathMessageIDs)
  const branchOptionsByParentID: Record<string, SessionMessageBranchOption[]> = {}

  for (const [parentID, childIDs] of Object.entries(childIDsByParentID)) {
    if (parentID === ROOT_PARENT_ID || childIDs.length <= 1) continue

    branchOptionsByParentID[parentID] = childIDs.map((childMessageID, index) => {
      const child = nodesByID[childMessageID]!
      const leafMessageID = activePathSet.has(childMessageID) && resolvedActiveMessageID
        ? resolvedActiveMessageID
        : resolveLatestLeafID(childIDsByParentID, nodesByID, childMessageID)

      return {
        childMessageID,
        index,
        isActive: activePathSet.has(childMessageID),
        label: `Branch ${index + 1}`,
        leafMessageID,
        parentMessageID: parentID,
        preview: child.preview,
        total: childIDs.length,
      }
    })
  }

  return {
    activeMessageID: resolvedActiveMessageID,
    activePathMessageIDs,
    branchOptionsByParentID,
    childIDsByParentID,
    nodesByID,
    rootMessageIDs,
    sessionID: firstNode.sessionID,
  }
}

export function getSessionMessageIDForMessage(input: {
  kind: "user" | "assistant"
  id: string
  messageID?: string
}) {
  return input.kind === "assistant" ? input.messageID ?? input.id : input.id
}
