import { buildUserThreadMessageText } from "./stream"
import type { SessionDiffSummary, ThreadMessage, UserThreadMessage, UserThreadMessageAttachment, UserThreadMessageReference } from "./types"

const USER_MESSAGE_PRESENTATION_STORAGE_KEY = "desktop.userMessagePresentation.v1"
const MAX_PERSISTED_SESSION_COUNT = 100
const MAX_PERSISTED_USER_MESSAGES_PER_SESSION = 200

type PersistedUserMessagePresentationMap = Record<string, UserThreadMessage[]>

function readString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function sanitizeUserMessageDiffSummary(value: unknown): SessionDiffSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined

  const record = value as Record<string, unknown>
  if (!Array.isArray(record.diffs)) return undefined

  const diffs = record.diffs
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null

      const diff = item as Record<string, unknown>
      const file = readString(diff.file).trim()
      if (!file) return null
      const patch = readString(diff.patch).trim()

      return {
        file,
        additions: readNumber(diff.additions),
        deletions: readNumber(diff.deletions),
        ...(patch ? { patch } : {}),
      }
    })
    .filter((item): item is SessionDiffSummary["diffs"][number] => item !== null)

  if (diffs.length === 0) return undefined

  const statsRecord =
    record.stats && typeof record.stats === "object" && !Array.isArray(record.stats)
      ? record.stats as Record<string, unknown>
      : null
  const title = readString(record.title).trim()
  const body = readString(record.body).trim()

  return {
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
    ...(statsRecord
      ? {
          stats: {
            additions: readNumber(statsRecord.additions),
            deletions: readNumber(statsRecord.deletions),
            files: readNumber(statsRecord.files),
          },
        }
      : {}),
    diffs,
  }
}

function sanitizeUserThreadMessageAttachments(value: unknown): UserThreadMessageAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined

  const attachments = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null

      const name = readString((item as Record<string, unknown>).name).trim()
      if (!name) return null

      const path = readString((item as Record<string, unknown>).path).trim()
      return {
        name,
        ...(path ? { path } : {}),
      } satisfies UserThreadMessageAttachment
    })
    .filter((item): item is UserThreadMessageAttachment => item !== null)

  return attachments.length > 0 ? attachments : undefined
}

function sanitizeUserThreadMessageReferences(value: unknown): UserThreadMessageReference[] | undefined {
  if (!Array.isArray(value)) return undefined

  const references = value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null

      const id = readString((item as Record<string, unknown>).id).trim()
      const label = readString((item as Record<string, unknown>).label).trim()
      if (!id || !label) return null

      const title = readString((item as Record<string, unknown>).title).trim()
      const kind = (item as Record<string, unknown>).kind

      return {
        id,
        label,
        ...(title ? { title } : {}),
        ...(kind === "comment" || kind === "file" ? { kind } : {}),
      } satisfies UserThreadMessageReference
    })
    .filter((item): item is UserThreadMessageReference => item !== null)

  return references.length > 0 ? references : undefined
}

function sanitizeUserMessage(value: unknown): UserThreadMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null

  const record = value as Record<string, unknown>
  const id = readString(record.id).trim()
  const text = readString(record.text).trim()
  const timestamp = readNumber(record.timestamp)

  if (!id || !text || timestamp <= 0) {
    return null
  }

  const displayText = readString(record.displayText).trim()
  const attachments = sanitizeUserThreadMessageAttachments(record.attachments)
  const references = sanitizeUserThreadMessageReferences(record.references)
  const diffSummary = sanitizeUserMessageDiffSummary(record.diffSummary)
  const submissionMode = record.submissionMode === "steer" ? "steer" : undefined
  const questionAnswer =
    record.questionAnswer && typeof record.questionAnswer === "object" && !Array.isArray(record.questionAnswer)
      ? (() => {
          const questionRecord = record.questionAnswer as Record<string, unknown>
          const questionID = readString(questionRecord.questionID).trim()
          if (!questionID) return undefined

          const selectedOptions = Array.isArray(questionRecord.selectedOptions)
            ? questionRecord.selectedOptions
                .map((item) => readString(item).trim())
                .filter(Boolean)
            : []
          const freeformText = readString(questionRecord.freeformText).trim()

          return {
            questionID,
            ...(selectedOptions.length > 0 ? { selectedOptions } : {}),
            ...(freeformText ? { freeformText } : {}),
          } satisfies UserThreadMessage["questionAnswer"]
        })()
      : undefined

  return {
    id,
    kind: "user",
    text,
    ...(displayText ? { displayText } : {}),
    ...(attachments ? { attachments } : {}),
    ...(references ? { references } : {}),
    ...(questionAnswer ? { questionAnswer } : {}),
    ...(diffSummary ? { diffSummary } : {}),
    ...(submissionMode ? { submissionMode } : {}),
    timestamp,
  }
}

function cloneUserMessageDiffSummary(diffSummary: SessionDiffSummary): SessionDiffSummary {
  return {
    ...(diffSummary.title ? { title: diffSummary.title } : {}),
    ...(diffSummary.body ? { body: diffSummary.body } : {}),
    ...(diffSummary.stats ? { stats: { ...diffSummary.stats } } : {}),
    diffs: diffSummary.diffs.map((diff) => ({ ...diff })),
  }
}

function readPersistedPresentationMap(): PersistedUserMessagePresentationMap {
  if (typeof window === "undefined") return {}

  try {
    const storedValue = window.localStorage.getItem(USER_MESSAGE_PRESENTATION_STORAGE_KEY)
    if (!storedValue) return {}

    const parsed = JSON.parse(storedValue) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([sessionID, messages]) => {
        if (!Array.isArray(messages)) return []

        const sanitizedMessages = messages
          .map((item) => sanitizeUserMessage(item))
          .filter((item): item is UserThreadMessage => item !== null)

        return sanitizedMessages.length > 0 ? [[sessionID, sanitizedMessages]] : []
      }),
    )
  } catch {
    return {}
  }
}

function writePersistedPresentationMap(value: PersistedUserMessagePresentationMap) {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(USER_MESSAGE_PRESENTATION_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Ignore storage failures.
  }
}

function selectPersistableUserMessages(messages: ThreadMessage[]) {
  return messages
    .filter(
      (message): message is UserThreadMessage =>
        message.kind === "user" && !message.delivery,
    )
    .slice(-MAX_PERSISTED_USER_MESSAGES_PER_SESSION)
    .map((message) => {
      const {
        streamInsertion: _streamInsertion,
        submissionMode,
        ...persistableMessage
      } = message

      return {
        ...persistableMessage,
        ...(submissionMode === "steer" ? { submissionMode } : {}),
        ...(message.attachments?.length ? { attachments: message.attachments.map((attachment) => ({ ...attachment })) } : {}),
        ...(message.references?.length ? { references: message.references.map((reference) => ({ ...reference })) } : {}),
        ...(message.diffSummary ? { diffSummary: cloneUserMessageDiffSummary(message.diffSummary) } : {}),
        ...(message.questionAnswer
          ? {
              questionAnswer: {
                ...message.questionAnswer,
                ...(message.questionAnswer.selectedOptions
                  ? { selectedOptions: [...message.questionAnswer.selectedOptions] }
                  : {}),
              },
            }
          : {}),
      }
    })
}

function prunePersistedPresentationMap(value: PersistedUserMessagePresentationMap) {
  const rankedSessions = Object.entries(value)
    .map(([sessionID, messages]) => ({
      sessionID,
      messages,
      lastTimestamp: messages[messages.length - 1]?.timestamp ?? 0,
    }))
    .sort((left, right) => right.lastTimestamp - left.lastTimestamp)
    .slice(0, MAX_PERSISTED_SESSION_COUNT)

  return Object.fromEntries(rankedSessions.map(({ sessionID, messages }) => [sessionID, messages]))
}

export function readPersistedUserMessages(sessionID: string) {
  return readPersistedPresentationMap()[sessionID] ?? []
}

export function persistUserMessages(sessionID: string, messages: ThreadMessage[]) {
  const normalizedSessionID = sessionID.trim()
  if (!normalizedSessionID) return

  const nextSessionMessages = selectPersistableUserMessages(messages)
  const nextMap = readPersistedPresentationMap()

  if (nextSessionMessages.length > 0) {
    nextMap[normalizedSessionID] = nextSessionMessages
  } else {
    delete nextMap[normalizedSessionID]
  }

  writePersistedPresentationMap(prunePersistedPresentationMap(nextMap))
}

function isLocalGeneratedUserMessage(message: UserThreadMessage) {
  return message.id.startsWith("user-")
}

export function mergeUserMessagePresentationState(previousMessages: ThreadMessage[], nextMessages: ThreadMessage[]) {
  const previousUserMessages = previousMessages.filter((message): message is UserThreadMessage => message.kind === "user")
  const previousUserMessageByID = new Map(previousUserMessages.map((message) => [message.id, message]))
  const usedPreviousUserThreadMessageIDs = new Set<string>()
  let fallbackPreviousUserMessageIndex = 0

  function takeFallbackUserMessage() {
    while (fallbackPreviousUserMessageIndex < previousUserMessages.length) {
      const candidate = previousUserMessages[fallbackPreviousUserMessageIndex++]
      if (!candidate || usedPreviousUserThreadMessageIDs.has(candidate.id)) continue
      if (!isLocalGeneratedUserMessage(candidate)) continue

      usedPreviousUserThreadMessageIDs.add(candidate.id)
      return candidate
    }

    return undefined
  }

  const mergedMessages = nextMessages.map((message) => {
    if (message.kind !== "user") return message

    const exactPreviousMessage = previousUserMessageByID.get(message.id)
    const previousMessage = exactPreviousMessage ?? takeFallbackUserMessage()
    if (!previousMessage) return message
    usedPreviousUserThreadMessageIDs.add(previousMessage.id)

    const mergedDisplayText = previousMessage.displayText ?? message.displayText
    const mergedAttachments = previousMessage.attachments?.length ? previousMessage.attachments : message.attachments
    const mergedReferences = previousMessage.references?.length ? previousMessage.references : message.references

    return {
      ...message,
      ...(previousMessage.delivery
        ? {
            id: previousMessage.id,
            timestamp: previousMessage.timestamp,
          }
        : {}),
      text: buildUserThreadMessageText({
        text: mergedDisplayText ?? message.displayText ?? message.text,
        attachmentNames: mergedAttachments?.map((attachment) => attachment.name),
        referenceLabels: mergedReferences?.map((reference) => reference.label),
      }),
      ...(mergedDisplayText ? { displayText: mergedDisplayText } : {}),
      ...(mergedAttachments?.length ? { attachments: mergedAttachments } : {}),
      ...(mergedReferences?.length ? { references: mergedReferences } : {}),
      ...(message.diffSummary ? { diffSummary: message.diffSummary } : {}),
      ...(previousMessage.submissionMode === "steer" ? { submissionMode: previousMessage.submissionMode } : {}),
      ...(previousMessage.delivery ? { delivery: previousMessage.delivery } : {}),
    }
  })

  if (mergedMessages.length === 0) {
    return previousMessages.length > 0 ? previousMessages : mergedMessages
  }

  if (mergedMessages.length >= previousMessages.length) {
    return mergedMessages
  }

  const hasMatchingPrefix = mergedMessages.every((message, index) => {
    const previousMessage = previousMessages[index]
    if (!previousMessage || previousMessage.kind !== message.kind) return false

    if (previousMessage.id === message.id) return true

    if (previousMessage.kind === "user" && message.kind === "user") {
      return previousMessage.text === message.text &&
        (previousMessage.questionAnswer?.questionID ?? "") === (message.questionAnswer?.questionID ?? "")
    }

    if (previousMessage.kind === "assistant" && message.kind === "assistant") {
      return previousMessage.state === message.state && previousMessage.items.length === message.items.length
    }

    return false
  })

  return hasMatchingPrefix ? [...mergedMessages, ...previousMessages.slice(mergedMessages.length)] : mergedMessages
}
