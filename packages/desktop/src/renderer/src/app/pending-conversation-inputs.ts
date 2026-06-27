import type { PendingConversationInput, UserThreadMessage } from "./types"

export type PendingConversationInputMap = Record<string, PendingConversationInput[]>

const EMPTY_PENDING_INPUTS: PendingConversationInput[] = []

function pendingInputsAreEqual(left: PendingConversationInput[], right: PendingConversationInput[]) {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((item, index) => Object.is(item, right[index]))
}

function removeSessionIfEmpty(
  current: PendingConversationInputMap,
  sessionID: string,
  nextInputs: PendingConversationInput[],
) {
  if (nextInputs.length > 0) {
    return {
      ...current,
      [sessionID]: nextInputs,
    }
  }

  if (!(sessionID in current)) return current
  const next = { ...current }
  delete next[sessionID]
  return next
}

export function getPendingConversationInputsForSession(
  inputsBySession: PendingConversationInputMap,
  sessionID: string | null | undefined,
) {
  return sessionID ? inputsBySession[sessionID] ?? EMPTY_PENDING_INPUTS : EMPTY_PENDING_INPUTS
}

export function appendPendingConversationInput(
  current: PendingConversationInputMap,
  input: PendingConversationInput,
) {
  const currentInputs = current[input.sessionID] ?? EMPTY_PENDING_INPUTS
  const existingIndex = currentInputs.findIndex((item) => item.id === input.id)
  const nextInputs =
    existingIndex === -1
      ? [...currentInputs, input]
      : currentInputs.map((item, index) => index === existingIndex ? input : item)

  if (pendingInputsAreEqual(currentInputs, nextInputs)) return current

  return {
    ...current,
    [input.sessionID]: nextInputs,
  }
}

export function updatePendingConversationInput(
  current: PendingConversationInputMap,
  sessionID: string,
  inputID: string,
  updater: (input: PendingConversationInput) => PendingConversationInput,
) {
  const currentInputs = current[sessionID] ?? EMPTY_PENDING_INPUTS
  let didUpdate = false
  const nextInputs = currentInputs.map((input) => {
    if (input.id !== inputID) return input
    const nextInput = updater(input)
    didUpdate ||= !Object.is(input, nextInput)
    return nextInput
  })

  if (!didUpdate) return current
  return removeSessionIfEmpty(current, sessionID, nextInputs)
}

export function removePendingConversationInput(
  current: PendingConversationInputMap,
  sessionID: string,
  inputID: string,
) {
  const currentInputs = current[sessionID] ?? EMPTY_PENDING_INPUTS
  const nextInputs = currentInputs.filter((input) => input.id !== inputID)
  if (nextInputs.length === currentInputs.length) return current
  return removeSessionIfEmpty(current, sessionID, nextInputs)
}

export function pendingConversationInputToUserThreadMessage(
  input: PendingConversationInput,
  options: {
    streamInsertion?: UserThreadMessage["streamInsertion"]
  } = {},
): UserThreadMessage {
  return {
    id: input.id,
    kind: "user",
    text: input.text,
    ...(input.displayText ? { displayText: input.displayText } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.references?.length ? { references: input.references } : {}),
    ...(input.questionAnswer ? { questionAnswer: input.questionAnswer } : {}),
    ...(options.streamInsertion ? { streamInsertion: options.streamInsertion } : {}),
    timestamp: input.createdAt,
  }
}
