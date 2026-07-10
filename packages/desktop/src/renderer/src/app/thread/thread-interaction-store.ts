import { createStore, type StoreApi } from "zustand/vanilla"

export type ThreadInteractionScopeID = string
export type ThreadInteractionRowID = string

declare const threadOperationTokenBrand: unique symbol
export type ThreadOperationToken = string & {
  readonly [threadOperationTokenBrand]: true
}

export interface ThreadInteractionRowRef {
  readonly scopeID: ThreadInteractionScopeID
  readonly rowID: ThreadInteractionRowID
}

export interface ThreadQuestionInteraction {
  readonly draft: string
  readonly selectedOptions: readonly string[]
}

export type ThreadInteractionOperation =
  | {
      readonly error: null
      readonly status: "idle"
      readonly token: null
    }
  | {
      readonly error: null
      readonly status: "submitting"
      readonly token: ThreadOperationToken
    }
  | {
      readonly error: null
      readonly status: "submitted"
      readonly token: ThreadOperationToken
    }
  | {
      readonly error: string
      readonly status: "failed"
      readonly token: ThreadOperationToken
    }

export interface ThreadInteractionEntry extends ThreadInteractionRowRef {
  readonly lastTouched: number
  readonly operation: ThreadInteractionOperation
  readonly planCancelled: boolean
  readonly question: ThreadQuestionInteraction
  readonly revision: string | null
}

export interface ThreadInteractionStoreState {
  readonly entries: ReadonlyMap<string, ThreadInteractionEntry>
  readonly focusedRow: ThreadInteractionRowRef | null
}

export interface ThreadInteractionStoreActions {
  beginOperation: (
    scopeID: ThreadInteractionScopeID,
    rowID: ThreadInteractionRowID,
  ) => ThreadOperationToken | null
  blurRow: (scopeID: ThreadInteractionScopeID, rowID: ThreadInteractionRowID) => void
  clearAll: () => void
  clearRow: (scopeID: ThreadInteractionScopeID, rowID: ThreadInteractionRowID) => void
  clearScope: (scopeID: ThreadInteractionScopeID) => void
  completeOperation: (
    scopeID: ThreadInteractionScopeID,
    rowID: ThreadInteractionRowID,
    token: ThreadOperationToken,
  ) => boolean
  ensureRevision: (
    scopeID: ThreadInteractionScopeID,
    rowID: ThreadInteractionRowID,
    revision: string,
  ) => void
  failOperation: (
    scopeID: ThreadInteractionScopeID,
    rowID: ThreadInteractionRowID,
    token: ThreadOperationToken,
    error: string,
  ) => boolean
  focusRow: (scopeID: ThreadInteractionScopeID, rowID: ThreadInteractionRowID) => void
  reconcileScope: (scopeID: ThreadInteractionScopeID, validRowIDs: Iterable<ThreadInteractionRowID>) => void
  resetOperation: (scopeID: ThreadInteractionScopeID, rowID: ThreadInteractionRowID) => void
  setPlanCancelled: (
    scopeID: ThreadInteractionScopeID,
    rowID: ThreadInteractionRowID,
    cancelled: boolean,
  ) => void
  setQuestionDraft: (
    scopeID: ThreadInteractionScopeID,
    rowID: ThreadInteractionRowID,
    draft: string,
  ) => void
  setQuestionSelectedOptions: (
    scopeID: ThreadInteractionScopeID,
    rowID: ThreadInteractionRowID,
    selectedOptions: Iterable<string>,
  ) => void
}

export type ThreadInteractionStore = ThreadInteractionStoreState & ThreadInteractionStoreActions
export type ThreadInteractionStoreApi = StoreApi<ThreadInteractionStore>

export interface CreateThreadInteractionStoreOptions {
  maxEntries?: number
}

const DEFAULT_MAX_ENTRIES = 256
const IDLE_OPERATION: ThreadInteractionOperation = {
  error: null,
  status: "idle",
  token: null,
}
let storeSequence = 0

function entryKey(scopeID: ThreadInteractionScopeID, rowID: ThreadInteractionRowID) {
  return `${scopeID.length}:${scopeID}${rowID}`
}

function rowsAreEqual(left: ThreadInteractionRowRef | null, right: ThreadInteractionRowRef | null) {
  return left === right || Boolean(
    left &&
    right &&
    left.scopeID === right.scopeID &&
    left.rowID === right.rowID,
  )
}

function arraysAreEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function normalizeSelectedOptions(values: Iterable<string>) {
  return [...new Set(values)]
}

function createEntry(
  scopeID: ThreadInteractionScopeID,
  rowID: ThreadInteractionRowID,
  lastTouched: number,
): ThreadInteractionEntry {
  return {
    scopeID,
    rowID,
    lastTouched,
    operation: IDLE_OPERATION,
    planCancelled: false,
    question: {
      draft: "",
      selectedOptions: [],
    },
    revision: null,
  }
}

function limitEntries(
  entries: Map<string, ThreadInteractionEntry>,
  maxEntries: number,
  focusedRow: ThreadInteractionRowRef | null,
) {
  while (entries.size > maxEntries) {
    let oldestKey: string | null = null
    let oldestTouch = Number.POSITIVE_INFINITY

    for (const [key, entry] of entries) {
      // Pending canonical acknowledgement and focused input must survive row unmounts.
      if (
        entry.operation.status === "submitting" ||
        entry.operation.status === "submitted" ||
        rowsAreEqual(entry, focusedRow)
      ) continue
      if (entry.lastTouched >= oldestTouch) continue
      oldestKey = key
      oldestTouch = entry.lastTouched
    }

    if (oldestKey === null) break
    entries.delete(oldestKey)
  }

  return entries
}

export function selectThreadInteractionEntry(
  state: ThreadInteractionStoreState,
  scopeID: ThreadInteractionScopeID,
  rowID: ThreadInteractionRowID,
) {
  return state.entries.get(entryKey(scopeID, rowID)) ?? null
}

export function createThreadInteractionStore(
  options: CreateThreadInteractionStoreOptions = {},
): ThreadInteractionStoreApi {
  const requestedMaxEntries = Math.trunc(options.maxEntries ?? DEFAULT_MAX_ENTRIES)
  const maxEntries = Number.isFinite(requestedMaxEntries) && requestedMaxEntries > 0
    ? requestedMaxEntries
    : DEFAULT_MAX_ENTRIES
  storeSequence += 1
  const storeID = storeSequence
  let touchSequence = 0
  let operationSequence = 0

  const nextTouch = () => {
    touchSequence += 1
    return touchSequence
  }
  const nextOperationToken = () => {
    operationSequence += 1
    return `thread-operation:${storeID}:${operationSequence}` as ThreadOperationToken
  }

  return createStore<ThreadInteractionStore>((set) => {
    function updateEntry(
      scopeID: ThreadInteractionScopeID,
      rowID: ThreadInteractionRowID,
      update: (entry: ThreadInteractionEntry) => ThreadInteractionEntry,
    ) {
      set((state) => {
        const key = entryKey(scopeID, rowID)
        const current = state.entries.get(key) ?? createEntry(scopeID, rowID, 0)
        const next = update(current)
        if (next === current) return state

        const entries = new Map(state.entries)
        entries.set(key, next)
        limitEntries(entries, maxEntries, state.focusedRow)
        return { ...state, entries }
      })
    }

    return {
      entries: new Map(),
      focusedRow: null,

      beginOperation(scopeID, rowID) {
        let nextToken: ThreadOperationToken | null = null
        updateEntry(scopeID, rowID, (entry) => {
          if (entry.operation.status === "submitting" || entry.operation.status === "submitted") return entry

          nextToken = nextOperationToken()
          return {
            ...entry,
            lastTouched: nextTouch(),
            operation: {
              error: null,
              status: "submitting",
              token: nextToken,
            },
          }
        })
        return nextToken
      },

      blurRow(scopeID, rowID) {
        set((state) => {
          if (!rowsAreEqual(state.focusedRow, { scopeID, rowID })) return state
          if (state.entries.size <= maxEntries) return { ...state, focusedRow: null }

          const entries = new Map(state.entries)
          limitEntries(entries, maxEntries, null)
          return { ...state, entries, focusedRow: null }
        })
      },

      clearAll() {
        set((state) => state.entries.size === 0 && state.focusedRow === null
          ? state
          : { ...state, entries: new Map(), focusedRow: null })
      },

      clearRow(scopeID, rowID) {
        set((state) => {
          const key = entryKey(scopeID, rowID)
          const clearsFocus = rowsAreEqual(state.focusedRow, { scopeID, rowID })
          if (!state.entries.has(key) && !clearsFocus) return state

          const entries = new Map(state.entries)
          entries.delete(key)
          return {
            ...state,
            entries,
            focusedRow: clearsFocus ? null : state.focusedRow,
          }
        })
      },

      clearScope(scopeID) {
        set((state) => {
          let entries: Map<string, ThreadInteractionEntry> | null = null
          for (const [key, entry] of state.entries) {
            if (entry.scopeID !== scopeID) continue
            entries ??= new Map(state.entries)
            entries.delete(key)
          }

          const clearsFocus = state.focusedRow?.scopeID === scopeID
          if (!entries && !clearsFocus) return state
          return {
            ...state,
            entries: entries ?? state.entries,
            focusedRow: clearsFocus ? null : state.focusedRow,
          }
        })
      },

      completeOperation(scopeID, rowID, token) {
        let didComplete = false
        updateEntry(scopeID, rowID, (entry) => {
          if (entry.operation.status !== "submitting" || entry.operation.token !== token) return entry
          didComplete = true
          return {
            ...entry,
            lastTouched: nextTouch(),
            operation: {
              error: null,
              status: "submitted",
              token,
            },
          }
        })
        return didComplete
      },

      ensureRevision(scopeID, rowID, revision) {
        updateEntry(scopeID, rowID, (entry) => {
          if (entry.revision === revision) return entry

          return {
            ...createEntry(scopeID, rowID, nextTouch()),
            revision,
          }
        })
      },

      failOperation(scopeID, rowID, token, error) {
        let didFail = false
        updateEntry(scopeID, rowID, (entry) => {
          if (entry.operation.status !== "submitting" || entry.operation.token !== token) return entry
          didFail = true
          return {
            ...entry,
            lastTouched: nextTouch(),
            operation: {
              error,
              status: "failed",
              token,
            },
          }
        })
        return didFail
      },

      focusRow(scopeID, rowID) {
        set((state) => {
          const focusedRow = { scopeID, rowID }
          if (rowsAreEqual(state.focusedRow, focusedRow)) return state
          if (state.entries.size <= maxEntries) return { ...state, focusedRow }

          const entries = new Map(state.entries)
          limitEntries(entries, maxEntries, focusedRow)
          return { ...state, entries, focusedRow }
        })
      },

      reconcileScope(scopeID, validRowIDs) {
        const validRows = new Set(validRowIDs)
        set((state) => {
          let entries: Map<string, ThreadInteractionEntry> | null = null
          for (const [key, entry] of state.entries) {
            if (entry.scopeID !== scopeID || validRows.has(entry.rowID)) continue
            entries ??= new Map(state.entries)
            entries.delete(key)
          }

          const clearsFocus = Boolean(
            state.focusedRow?.scopeID === scopeID && !validRows.has(state.focusedRow.rowID),
          )
          if (!entries && !clearsFocus) return state
          return {
            ...state,
            entries: entries ?? state.entries,
            focusedRow: clearsFocus ? null : state.focusedRow,
          }
        })
      },

      resetOperation(scopeID, rowID) {
        updateEntry(scopeID, rowID, (entry) => entry.operation.status === "idle"
          ? entry
          : {
              ...entry,
              lastTouched: nextTouch(),
              operation: IDLE_OPERATION,
            })
      },

      setPlanCancelled(scopeID, rowID, cancelled) {
        updateEntry(scopeID, rowID, (entry) => entry.planCancelled === cancelled
          ? entry
          : {
              ...entry,
              lastTouched: nextTouch(),
              planCancelled: cancelled,
            })
      },

      setQuestionDraft(scopeID, rowID, draft) {
        updateEntry(scopeID, rowID, (entry) => entry.question.draft === draft
          ? entry
          : {
              ...entry,
              lastTouched: nextTouch(),
              question: {
                ...entry.question,
                draft,
              },
            })
      },

      setQuestionSelectedOptions(scopeID, rowID, selectedOptions) {
        const normalizedOptions = normalizeSelectedOptions(selectedOptions)
        updateEntry(scopeID, rowID, (entry) => arraysAreEqual(entry.question.selectedOptions, normalizedOptions)
          ? entry
          : {
              ...entry,
              lastTouched: nextTouch(),
              question: {
                ...entry.question,
                selectedOptions: normalizedOptions,
              },
            })
      },
    }
  })
}
