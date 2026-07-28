export type SessionDataLoadKind = "history" | "diff" | "permissions" | "runtime" | "tasks"
export type SessionDataLoadMode = "silent" | "visible"
export type SessionDataLoadReason = "open" | "stream" | "permission" | "manual"

export interface SessionDataLoadOptions {
  force?: boolean
  mode?: SessionDataLoadMode
  preserveUserPresentation?: boolean
  reason?: SessionDataLoadReason
}

export interface SessionDataLoadCacheEntry {
  backendSessionID: string
  loadedAt?: number
  promise?: Promise<void>
  status: "loading" | "ready" | "error"
}

export type SessionDataLoadCache = Record<SessionDataLoadKind, Record<string, SessionDataLoadCacheEntry>>

export function createSessionDataLoadCache(): SessionDataLoadCache {
  return {
    diff: {},
    history: {},
    permissions: {},
    runtime: {},
    tasks: {},
  }
}

export function clearSessionDataLoadCacheForSession(cache: SessionDataLoadCache, sessionID: string) {
  for (const entries of Object.values(cache)) {
    delete entries[sessionID]
  }
}

export function ensureSessionDataLoad(
  cache: SessionDataLoadCache,
  kind: SessionDataLoadKind,
  sessionID: string,
  backendSessionID: string,
  options: SessionDataLoadOptions | undefined,
  load: () => Promise<void>,
) {
  const cacheBySession = cache[kind]
  const current = cacheBySession[sessionID]
  if (!options?.force && current?.backendSessionID === backendSessionID) {
    if (current.status === "ready") return Promise.resolve()
    if (current.status === "loading" && current.promise) return current.promise
  }

  let promise: Promise<void>
  promise = load()
    .then(() => {
      if (cacheBySession[sessionID]?.promise !== promise) return
      cacheBySession[sessionID] = {
        backendSessionID,
        loadedAt: Date.now(),
        status: "ready",
      }
    })
    .catch((error) => {
      if (cacheBySession[sessionID]?.promise === promise) {
        cacheBySession[sessionID] = {
          backendSessionID,
          status: "error",
        }
      }
      throw error
    })

  cacheBySession[sessionID] = {
    backendSessionID,
    promise,
    status: "loading",
  }
  return promise
}
