import {
  semanticTokenAuthoringOperationKey,
  type SemanticTokenAuthoringOperation,
} from "../../../../shared/semantic-token-authoring"

export interface SemanticTokenAuthoringHistoryState {
  past: SemanticTokenAuthoringOperation[][]
  present: SemanticTokenAuthoringOperation[]
  future: SemanticTokenAuthoringOperation[][]
}

export type SemanticTokenAuthoringHistoryAction =
  | { type: "upsert"; operation: SemanticTokenAuthoringOperation }
  | { type: "batch-upsert"; operations: SemanticTokenAuthoringOperation[] }
  | { type: "remove"; key: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "discard" }

const MAX_HISTORY_ENTRIES = 100

export function createSemanticTokenAuthoringHistoryState(): SemanticTokenAuthoringHistoryState {
  return {
    past: [],
    present: [],
    future: [],
  }
}

function operationsEqual(
  left: readonly SemanticTokenAuthoringOperation[],
  right: readonly SemanticTokenAuthoringOperation[],
) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function pushPresent(
  state: SemanticTokenAuthoringHistoryState,
  next: SemanticTokenAuthoringOperation[],
) {
  if (operationsEqual(state.present, next)) return state
  return {
    past: [...state.past, state.present].slice(-MAX_HISTORY_ENTRIES),
    present: next,
    future: [],
  }
}

function upsertOperations(
  current: readonly SemanticTokenAuthoringOperation[],
  operations: readonly SemanticTokenAuthoringOperation[],
) {
  const next = [...current]
  for (const operation of operations) {
    const key = semanticTokenAuthoringOperationKey(operation)
    const index = next.findIndex((candidate) =>
      semanticTokenAuthoringOperationKey(candidate) === key,
    )
    if (index >= 0) next[index] = operation
    else next.push(operation)
  }
  return next
}

export function semanticTokenAuthoringSessionReducer(
  state: SemanticTokenAuthoringHistoryState,
  action: SemanticTokenAuthoringHistoryAction,
): SemanticTokenAuthoringHistoryState {
  if (action.type === "upsert") {
    return pushPresent(state, upsertOperations(state.present, [action.operation]))
  }
  if (action.type === "batch-upsert") {
    return pushPresent(state, upsertOperations(state.present, action.operations))
  }
  if (action.type === "remove") {
    return pushPresent(
      state,
      state.present.filter((operation) =>
        semanticTokenAuthoringOperationKey(operation) !== action.key,
      ),
    )
  }
  if (action.type === "undo") {
    const previous = state.past.at(-1)
    if (!previous) return state
    return {
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
    }
  }
  if (action.type === "redo") {
    const next = state.future[0]
    if (!next) return state
    return {
      past: [...state.past, state.present].slice(-MAX_HISTORY_ENTRIES),
      present: next,
      future: state.future.slice(1),
    }
  }
  return createSemanticTokenAuthoringHistoryState()
}
