import { createStore, type StoreApi } from "zustand/vanilla"

export type ThreadPresentationScopeID = string
export type ThreadPresentationGroupID = string

export type ProcessDisclosurePreference = "auto" | "collapsed" | "expanded"
export type ExplicitProcessDisclosurePreference = Exclude<ProcessDisclosurePreference, "auto">

export interface ThreadPresentationEntry {
  readonly groupID: ThreadPresentationGroupID
  readonly preference: ExplicitProcessDisclosurePreference
  readonly scopeID: ThreadPresentationScopeID
}

export interface ThreadPresentationStoreState {
  readonly entries: ReadonlyMap<string, ThreadPresentationEntry>
}

export interface ThreadPresentationStoreActions {
  clearAll: () => void
  clearScope: (scopeID: ThreadPresentationScopeID) => void
  getProcessDisclosurePreference: (
    scopeID: ThreadPresentationScopeID,
    groupID: ThreadPresentationGroupID,
  ) => ProcessDisclosurePreference
  migrateProcessDisclosurePreference: (
    scopeID: ThreadPresentationScopeID,
    fromGroupID: ThreadPresentationGroupID,
    toGroupID: ThreadPresentationGroupID,
  ) => void
  setProcessDisclosurePreference: (
    scopeID: ThreadPresentationScopeID,
    groupID: ThreadPresentationGroupID,
    preference: ProcessDisclosurePreference,
  ) => void
  toggleProcessDisclosure: (
    scopeID: ThreadPresentationScopeID,
    groupID: ThreadPresentationGroupID,
    autoExpanded: boolean,
  ) => ExplicitProcessDisclosurePreference
}

export type ThreadPresentationStore = ThreadPresentationStoreState & ThreadPresentationStoreActions
export type ThreadPresentationStoreApi = StoreApi<ThreadPresentationStore>

function entryKey(scopeID: ThreadPresentationScopeID, groupID: ThreadPresentationGroupID) {
  return `${scopeID.length}:${scopeID}${groupID}`
}

export function selectThreadPresentationEntry(
  state: ThreadPresentationStoreState,
  scopeID: ThreadPresentationScopeID,
  groupID: ThreadPresentationGroupID,
) {
  return state.entries.get(entryKey(scopeID, groupID)) ?? null
}

export function selectProcessDisclosurePreference(
  state: ThreadPresentationStoreState,
  scopeID: ThreadPresentationScopeID,
  groupID: ThreadPresentationGroupID,
): ProcessDisclosurePreference {
  return selectThreadPresentationEntry(state, scopeID, groupID)?.preference ?? "auto"
}

export function resolveProcessDisclosureExpanded(
  preference: ProcessDisclosurePreference,
  autoExpanded: boolean,
) {
  if (preference === "auto") return autoExpanded
  return preference === "expanded"
}

export function createThreadPresentationStore(): ThreadPresentationStoreApi {
  return createStore<ThreadPresentationStore>((set, get) => ({
    entries: new Map(),

    clearAll() {
      set((state) => state.entries.size === 0
        ? state
        : { ...state, entries: new Map() })
    },

    clearScope(scopeID) {
      set((state) => {
        let entries: Map<string, ThreadPresentationEntry> | null = null
        for (const [key, entry] of state.entries) {
          if (entry.scopeID !== scopeID) continue
          entries ??= new Map(state.entries)
          entries.delete(key)
        }

        return entries ? { ...state, entries } : state
      })
    },

    getProcessDisclosurePreference(scopeID, groupID) {
      return selectProcessDisclosurePreference(get(), scopeID, groupID)
    },

    migrateProcessDisclosurePreference(scopeID, fromGroupID, toGroupID) {
      if (fromGroupID === toGroupID) return

      set((state) => {
        const sourceKey = entryKey(scopeID, fromGroupID)
        const source = state.entries.get(sourceKey)
        if (!source) return state

        const targetKey = entryKey(scopeID, toGroupID)
        const target = state.entries.get(targetKey)
        const preference = source.preference === "expanded" || target?.preference === "expanded"
          ? "expanded"
          : "collapsed"
        const entries = new Map(state.entries)
        entries.delete(sourceKey)
        if (!target || target.preference !== preference) {
          entries.set(targetKey, { groupID: toGroupID, preference, scopeID })
        }

        return { ...state, entries }
      })
    },

    setProcessDisclosurePreference(scopeID, groupID, preference) {
      set((state) => {
        const key = entryKey(scopeID, groupID)
        const current = state.entries.get(key)

        // "auto" is the default and therefore needs no durable override entry.
        if (preference === "auto") {
          if (!current) return state
          const entries = new Map(state.entries)
          entries.delete(key)
          return { ...state, entries }
        }

        if (current?.preference === preference) return state
        const entries = new Map(state.entries)
        entries.set(key, { groupID, preference, scopeID })
        return { ...state, entries }
      })
    },

    toggleProcessDisclosure(scopeID, groupID, autoExpanded) {
      const current = selectProcessDisclosurePreference(get(), scopeID, groupID)
      const preference = resolveProcessDisclosureExpanded(current, autoExpanded)
        ? "collapsed"
        : "expanded"
      get().setProcessDisclosurePreference(scopeID, groupID, preference)
      return preference
    },
  }))
}
