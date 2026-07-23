import { startTransition, useEffect, useRef, useState } from "react"
import { mapPtySessionInfoToRecord, terminalClient } from "./client"
import { DEFAULT_TERMINAL_SHELL_PROFILE_ID, resolveShellFromProfile, resolveTerminalShellProfiles } from "./shell-profiles"
import { loadTerminalWorkspaceState, saveTerminalWorkspaceState, serializeTerminalWorkspaceState } from "./storage"
import type { PtyEvent, PtySessionInfo, TerminalSessionRecord, TerminalShellProfile, TerminalStreamEvent, TerminalWorkspaceState } from "./types"
import { OPEN_PTY_SESSION_EVENT } from "./events"

const MIN_PANEL_HEIGHT = 220
const MAX_PANEL_HEIGHT = 560
const RECONNECT_DELAYS_MS = [600, 1_000, 1_600, 2_400, 3_600]
export const TERMINAL_LIVE_BUFFER_MAX_CHARS = 200_000
export const TERMINAL_PENDING_INPUT_MAX_CHARS = 100_000

function clampPanelHeight(value: number) {
  return Math.max(MIN_PANEL_HEIGHT, Math.min(MAX_PANEL_HEIGHT, value))
}

export function trimTerminalLiveBuffer(buffer: string, maxChars = TERMINAL_LIVE_BUFFER_MAX_CHARS) {
  if (buffer.length <= maxChars) return buffer
  return buffer.slice(-maxChars)
}

function orderedSessions(state: TerminalWorkspaceState) {
  return state.order.map((ptyID) => state.sessions[ptyID]).filter((session): session is TerminalSessionRecord => Boolean(session))
}

function nextActivePtyID(order: string[], removedPtyID: string) {
  const index = order.indexOf(removedPtyID)
  if (index === -1) return order[0] ?? null
  return order[index + 1] ?? order[index - 1] ?? null
}

function removeSession(state: TerminalWorkspaceState, ptyID: string): TerminalWorkspaceState {
  if (!state.sessions[ptyID]) return state

  const nextOrder = state.order.filter((id) => id !== ptyID)
  const nextSessions = { ...state.sessions }
  delete nextSessions[ptyID]

  return {
    ...state,
    activePtyID: state.activePtyID === ptyID ? nextActivePtyID(nextOrder, ptyID) : state.activePtyID,
    order: nextOrder,
    sessions: nextSessions,
  }
}

function upsertSession(state: TerminalWorkspaceState, session: TerminalSessionRecord, activate = false): TerminalWorkspaceState {
  const nextOrder = state.order.includes(session.ptyID) ? state.order : [...state.order, session.ptyID]

  return {
    ...state,
    isOpen: state.isOpen,
    activePtyID: activate ? session.ptyID : state.activePtyID ?? session.ptyID,
    order: nextOrder,
    sessions: {
      ...state.sessions,
      [session.ptyID]: session,
    },
  }
}

interface LiveTerminalSessionSnapshot {
  buffer: string
  cursor: number
  scrollTop: number
}

interface PendingTerminalCreateRequest {
  requestID: number
  sessionID: string
  shell: string | null
  openPanel: boolean
  phase: "measuring" | "creating"
}

type TerminalStreamListener = (event: TerminalStreamEvent) => void

export interface UseTerminalWorkspaceOptions {
  currentSessionID?: string | null
  storageKey?: string
}

export function useTerminalWorkspace({ currentSessionID, storageKey }: UseTerminalWorkspaceOptions) {
  const normalizedCurrentSessionID = currentSessionID?.trim() || null
  const shellProfilesRef = useRef<TerminalShellProfile[]>(
    resolveTerminalShellProfiles(typeof window === "undefined" ? undefined : window.desktop?.platform),
  )
  const [workspace, setWorkspace] = useState(() => loadTerminalWorkspaceState(storageKey))
  const [creationError, setCreationError] = useState<string | null>(null)
  const [isCreatingTerminal, setIsCreatingTerminal] = useState(false)
  const [pendingCreateRequestID, setPendingCreateRequestID] = useState<number | null>(null)
  const workspaceRef = useRef(workspace)
  const currentSessionIDRef = useRef<string | null>(normalizedCurrentSessionID)
  // Keep the hot terminal buffer path outside React state so typing does not trigger
  // a render + diff cycle for every PTY output chunk.
  const liveSessionsRef = useRef<Record<string, LiveTerminalSessionSnapshot>>(
    Object.fromEntries(
      Object.values(workspace.sessions).map((session) => [
        session.ptyID,
        {
          buffer: session.buffer,
          cursor: session.cursor,
          scrollTop: session.scrollTop,
        },
      ]),
    ),
  )
  const terminalStreamListenersRef = useRef<Record<string, Set<TerminalStreamListener>>>({})
  const attachedPtyIDRef = useRef<string | null>(null)
  const reconnectTimersRef = useRef<Record<string, number>>({})
  const reconnectAttemptsRef = useRef<Record<string, number>>({})
  const resizeTimersRef = useRef<Record<string, number>>({})
  const isCreatingTerminalRef = useRef(false)
  const nextCreateRequestIDRef = useRef(0)
  const pendingCreateRef = useRef<PendingTerminalCreateRequest | null>(null)
  const pendingInputRef = useRef<Record<string, string>>({})
  const persistTimerRef = useRef<number | null>(null)
  const persistedSnapshotRef = useRef(serializeTerminalWorkspaceState(workspace))

  function readLiveSessionSnapshot(ptyID: string, fallback?: Pick<TerminalSessionRecord, "buffer" | "cursor">) {
    const existing = liveSessionsRef.current[ptyID]
    if (existing) {
      const trimmedBuffer = trimTerminalLiveBuffer(existing.buffer)
      if (trimmedBuffer !== existing.buffer) {
        liveSessionsRef.current[ptyID] = {
          ...existing,
          buffer: trimmedBuffer,
        }
      }
      return liveSessionsRef.current[ptyID]!
    }

    const session = workspaceRef.current.sessions[ptyID]
    const nextSnapshot = {
      buffer: trimTerminalLiveBuffer(fallback?.buffer ?? session?.buffer ?? ""),
      cursor: fallback?.cursor ?? session?.cursor ?? 0,
      scrollTop: session?.scrollTop ?? 0,
    }
    liveSessionsRef.current[ptyID] = nextSnapshot
    return nextSnapshot
  }

  function writeLiveSessionSnapshot(
    ptyID: string,
    input: Partial<LiveTerminalSessionSnapshot> & { buffer?: string; cursor?: number; scrollTop?: number },
  ) {
    const current = readLiveSessionSnapshot(ptyID)
    const nextSnapshot = {
      buffer: trimTerminalLiveBuffer(input.buffer ?? current.buffer),
      cursor: input.cursor ?? current.cursor,
      scrollTop: input.scrollTop ?? current.scrollTop,
    }
    liveSessionsRef.current[ptyID] = nextSnapshot
    return nextSnapshot
  }

  function materializeSession(session: TerminalSessionRecord) {
    const live = readLiveSessionSnapshot(session.ptyID, session)
    return {
      ...session,
      buffer: live.buffer,
      cursor: live.cursor,
      scrollTop: live.scrollTop,
    }
  }

  function buildPersistedWorkspaceState(state: TerminalWorkspaceState): TerminalWorkspaceState {
    const scrollTopBySessionID = { ...state.scrollTopBySessionID }
    for (const [ptyID, session] of Object.entries(state.sessions)) {
      scrollTopBySessionID[session.sessionID] = readLiveSessionSnapshot(ptyID, session).scrollTop
    }

    return {
      ...state,
      scrollTopBySessionID,
      sessions: Object.fromEntries(
        Object.entries(state.sessions).map(([ptyID, session]) => [
          ptyID,
          {
            ...session,
            scrollTop: readLiveSessionSnapshot(ptyID, session).scrollTop,
          },
        ]),
      ),
    }
  }

  function scheduleWorkspacePersistence() {
    const nextSnapshot = serializeTerminalWorkspaceState(buildPersistedWorkspaceState(workspaceRef.current))
    if (nextSnapshot === persistedSnapshotRef.current) {
      return
    }

    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current)
    }

    persistTimerRef.current = window.setTimeout(() => {
      const nextState = buildPersistedWorkspaceState(workspaceRef.current)
      const serialized = serializeTerminalWorkspaceState(nextState)
      if (serialized !== persistedSnapshotRef.current) {
        saveTerminalWorkspaceState(nextState, storageKey)
        persistedSnapshotRef.current = serialized
      }
      persistTimerRef.current = null
    }, 120)
  }

  function emitTerminalStreamEvent(ptyID: string, event: TerminalStreamEvent) {
    const listeners = terminalStreamListenersRef.current[ptyID]
    if (!listeners || listeners.size === 0) return

    for (const listener of [...listeners]) {
      listener(event)
    }
  }

  function getKnownCursor(ptyID: string) {
    return readLiveSessionSnapshot(ptyID).cursor
  }

  const subscribeToTerminalStream = useRef((ptyID: string, listener: TerminalStreamListener) => {
    const listeners = terminalStreamListenersRef.current[ptyID] ?? new Set<TerminalStreamListener>()
    listeners.add(listener)
    terminalStreamListenersRef.current[ptyID] = listeners

    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        delete terminalStreamListenersRef.current[ptyID]
      }
    }
  }).current

  const sessions = orderedSessions(workspace)
    .filter((session) => session.sessionID === normalizedCurrentSessionID)
    .map((session) => materializeSession(session))
  const activeSession =
    workspace.activePtyID &&
    workspace.sessions[workspace.activePtyID] &&
    workspace.sessions[workspace.activePtyID]!.sessionID === normalizedCurrentSessionID
      ? materializeSession(workspace.sessions[workspace.activePtyID]!)
      : null
  workspaceRef.current = workspace
  currentSessionIDRef.current = normalizedCurrentSessionID

  const shellProfiles = shellProfilesRef.current
  const selectedShellProfileID = shellProfiles.some((profile) => profile.id === workspace.preferredShellProfileID)
    ? workspace.preferredShellProfileID!
    : DEFAULT_TERMINAL_SHELL_PROFILE_ID

  useEffect(() => {
    scheduleWorkspacePersistence()
  }, [workspace])

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current)
        const nextState = buildPersistedWorkspaceState(workspaceRef.current)
        const serialized = serializeTerminalWorkspaceState(nextState)
        if (serialized !== persistedSnapshotRef.current) {
          saveTerminalWorkspaceState(nextState, storageKey)
          persistedSnapshotRef.current = serialized
        }
        persistTimerRef.current = null
      }
    }
  }, [storageKey])

  useEffect(() => {
    setCreationError(null)
    const pendingCreate = pendingCreateRef.current
    if (pendingCreate && pendingCreate.sessionID !== normalizedCurrentSessionID) {
      cancelPendingCreateRequest(pendingCreate.requestID)
    }

    const activePtyID = workspaceRef.current.activePtyID
    const active = activePtyID ? workspaceRef.current.sessions[activePtyID] : null
    if (active && active.sessionID !== normalizedCurrentSessionID) {
      void detachSession(active.ptyID, true)
      updateWorkspace((current) => ({
        ...current,
        activePtyID: null,
        order: [],
        sessions: {},
      }))
      delete liveSessionsRef.current[active.ptyID]
      delete terminalStreamListenersRef.current[active.ptyID]
    }

    if (workspaceRef.current.isOpen && normalizedCurrentSessionID) {
      const nextActivePtyID = workspaceRef.current.activePtyID
      const nextActive = nextActivePtyID ? workspaceRef.current.sessions[nextActivePtyID] : null
      if (!nextActive || nextActive.sessionID !== normalizedCurrentSessionID) {
        void handleCreateTerminal(true)
      }
    }
  }, [normalizedCurrentSessionID])

  function updateWorkspace(updater: (current: TerminalWorkspaceState) => TerminalWorkspaceState) {
    startTransition(() => {
      setWorkspace((current) => updater(current))
    })
  }

  function cancelPendingCreateRequest(requestID?: number) {
    const pending = pendingCreateRef.current
    if (!pending) return false
    if (requestID !== undefined && pending.requestID !== requestID) return false

    pendingCreateRef.current = null
    setPendingCreateRequestID(null)
    isCreatingTerminalRef.current = false
    setIsCreatingTerminal(false)
    return true
  }

  function handleShellProfileChange(profileID: string) {
    const resolvedProfileID =
      profileID === DEFAULT_TERMINAL_SHELL_PROFILE_ID || !shellProfiles.some((profile) => profile.id === profileID)
        ? null
        : profileID

    updateWorkspace((current) => ({
      ...current,
      preferredShellProfileID: resolvedProfileID,
    }))
  }

  function cancelReconnect(ptyID: string) {
    const timer = reconnectTimersRef.current[ptyID]
    if (timer !== undefined) {
      window.clearTimeout(timer)
      delete reconnectTimersRef.current[ptyID]
    }
    delete reconnectAttemptsRef.current[ptyID]
  }

  function queuePendingInput(ptyID: string, data: string, placement: "append" | "prepend" = "append") {
    if (!data) return

    const current = pendingInputRef.current[ptyID] ?? ""
    const next = placement === "prepend" ? `${data}${current}` : `${current}${data}`
    pendingInputRef.current[ptyID] =
      next.length > TERMINAL_PENDING_INPUT_MAX_CHARS ? next.slice(-TERMINAL_PENDING_INPUT_MAX_CHARS) : next
  }

  async function flushPendingInput(ptyID: string) {
    const pendingInput = pendingInputRef.current[ptyID]
    if (!pendingInput) return

    delete pendingInputRef.current[ptyID]

    try {
      await terminalClient.writeInput({
        id: ptyID,
        data: pendingInput,
      })
    } catch (error) {
      queuePendingInput(ptyID, pendingInput, "prepend")
      console.error("[desktop] writePtyInput failed while flushing pending input:", error)
      scheduleReconnect(ptyID)
    }
  }

  async function replaceMissingSession(ptyID: string) {
    const current = workspaceRef.current
    const missingSessionID = current.sessions[ptyID]?.sessionID
    const shouldCreateReplacement =
      current.isOpen &&
      current.activePtyID === ptyID &&
      current.order.length === 1 &&
      missingSessionID === normalizedCurrentSessionID

    delete liveSessionsRef.current[ptyID]
    delete terminalStreamListenersRef.current[ptyID]
    delete pendingInputRef.current[ptyID]
    updateWorkspace((workspaceState) => removeSession(workspaceState, ptyID))

    if (shouldCreateReplacement) {
      await handleCreateTerminal(true)
    }
  }

  async function detachSession(ptyID: string, userInitiated = false) {
    cancelReconnect(ptyID)
    if (attachedPtyIDRef.current === ptyID) {
      attachedPtyIDRef.current = null
    }

    try {
      await terminalClient.detachSession({ id: ptyID })
    } catch (error) {
      console.error("[desktop] detachPtySession failed:", error)
    }

    updateWorkspace((current) => {
      const session = current.sessions[ptyID]
      if (!session) return current
      return {
        ...current,
        sessions: {
          ...current.sessions,
          [ptyID]: {
            ...session,
            transportState: "disconnected",
            lastError: userInitiated ? undefined : session.lastError,
          },
        },
      }
    })
  }

  function scheduleReconnect(ptyID: string) {
    const current = workspaceRef.current
    const session = current.sessions[ptyID]
    if (
      !current.isOpen ||
      current.activePtyID !== ptyID ||
      !session ||
      session.sessionID !== currentSessionIDRef.current ||
      session.status !== "running"
    ) {
      return
    }
    if (reconnectTimersRef.current[ptyID] !== undefined) return

    const attempt = Math.min((reconnectAttemptsRef.current[ptyID] ?? 0) + 1, RECONNECT_DELAYS_MS.length)
    reconnectAttemptsRef.current[ptyID] = attempt
    const delay = RECONNECT_DELAYS_MS[attempt - 1] ?? RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1]!

    reconnectTimersRef.current[ptyID] = window.setTimeout(() => {
      delete reconnectTimersRef.current[ptyID]
      void attachSession(ptyID, getKnownCursor(ptyID))
    }, delay)
  }

  async function attachSession(ptyID: string, cursor?: number) {
    const target = workspaceRef.current.sessions[ptyID]
    if (!target || target.status === "deleted" || target.status === "invalid") return
    if (target.sessionID !== currentSessionIDRef.current) return

    const attachedPtyID = attachedPtyIDRef.current
    if (attachedPtyID && attachedPtyID !== ptyID) {
      await detachSession(attachedPtyID, true)
    }

    cancelReconnect(ptyID)
    attachedPtyIDRef.current = ptyID
    updateWorkspace((current) => {
      const session = current.sessions[ptyID]
      if (!session) return current
      return {
        ...current,
        sessions: {
          ...current.sessions,
          [ptyID]: {
            ...session,
            transportState: "connecting",
            lastError: undefined,
          },
        },
      }
    })

    try {
      const info = await terminalClient.attachSession({ id: ptyID, cursor })
      updateWorkspace((current) => {
        const existing = current.sessions[ptyID]
        if (!existing) return current
        return upsertSession(
          current,
          mapPtySessionInfoToRecord(info, {
            buffer: readLiveSessionSnapshot(ptyID, existing).buffer,
            scrollTop: readLiveSessionSnapshot(ptyID, existing).scrollTop,
            transportState: "connecting",
          }),
        )
      })
    } catch (error) {
      if (attachedPtyIDRef.current === ptyID) {
        attachedPtyIDRef.current = null
      }

      const message = error instanceof Error ? error.message : String(error)
      const isMissing = /not found/i.test(message)

      if (isMissing) {
        await replaceMissingSession(ptyID)
        return
      }

      updateWorkspace((current) => {
        const session = current.sessions[ptyID]
        if (!session) return current
        return {
          ...current,
          sessions: {
            ...current.sessions,
            [ptyID]: {
              ...session,
              status: session.status,
              transportState: "error",
              lastError: message,
            },
          },
        }
      })

      scheduleReconnect(ptyID)
    }
  }

  useEffect(() => {
    let unsubscribe: (() => void) | undefined

    try {
      unsubscribe = terminalClient.subscribe((event: PtyEvent) => {
        if (event.type === "transport") {
          updateWorkspace((current) => {
            const session = current.sessions[event.ptyID]
            if (!session) return current
            return {
              ...current,
              sessions: {
                ...current.sessions,
                [event.ptyID]: {
                  ...session,
                  transportState:
                    event.state === "error"
                      ? "error"
                      : event.state === "connecting"
                        ? "connecting"
                        : event.state === "connected"
                          ? "connected"
                          : "disconnected",
                  lastError:
                    event.state === "error" ? event.message : event.state === "connected" ? undefined : session.lastError,
                },
              },
            }
          })

          if (event.state === "connected") {
            cancelReconnect(event.ptyID)
            void flushPendingInput(event.ptyID)
            return
          }

          if (event.state === "disconnected") {
            if (attachedPtyIDRef.current === event.ptyID) {
              attachedPtyIDRef.current = null
            }
            if (!event.userInitiated) {
              scheduleReconnect(event.ptyID)
            }
            return
          }

          if (event.state === "error") {
            scheduleReconnect(event.ptyID)
          }

          return
        }

        if (event.type === "ready") {
          if (event.session.sessionID !== currentSessionIDRef.current) return
          cancelReconnect(event.ptyID)
          attachedPtyIDRef.current = event.ptyID
          const previous = readLiveSessionSnapshot(event.ptyID)
          const replayBuffer =
            event.replay.mode === "reset" ? event.replay.buffer : `${previous.buffer}${event.replay.buffer}`

          const nextLiveSnapshot = writeLiveSessionSnapshot(event.ptyID, {
            buffer: replayBuffer,
            cursor: event.replay.cursor,
          })

          if (event.replay.mode === "reset" || nextLiveSnapshot.buffer !== replayBuffer) {
            emitTerminalStreamEvent(event.ptyID, {
              type: "replace",
              buffer: nextLiveSnapshot.buffer,
              cursor: nextLiveSnapshot.cursor,
              scrollTop: workspaceRef.current.sessions[event.ptyID]?.scrollTop ?? 0,
            })
          } else if (event.replay.buffer) {
            emitTerminalStreamEvent(event.ptyID, {
              type: "append",
              data: event.replay.buffer,
              cursor: nextLiveSnapshot.cursor,
            })
          }

          updateWorkspace((current) => {
            const previousSession = current.sessions[event.ptyID]
            const scrollTop = previousSession ? readLiveSessionSnapshot(event.ptyID, previousSession).scrollTop : 0

            return upsertSession(
              current,
              mapPtySessionInfoToRecord(event.session, {
                buffer: previousSession ? readLiveSessionSnapshot(event.ptyID, previousSession).buffer : "",
                scrollTop,
                transportState: "connected",
              }),
            )
          })
          void flushPendingInput(event.ptyID)
          return
        }

        if (event.type === "output") {
          const session = workspaceRef.current.sessions[event.ptyID]
          if (!session || session.sessionID !== currentSessionIDRef.current) return
          const previous = readLiveSessionSnapshot(event.ptyID)
          const nextBuffer = `${previous.buffer}${event.data}`
          const nextLiveSnapshot = writeLiveSessionSnapshot(event.ptyID, {
            buffer: nextBuffer,
            cursor: event.cursor,
          })
          if (nextLiveSnapshot.buffer === nextBuffer) {
            emitTerminalStreamEvent(event.ptyID, {
              type: "append",
              data: event.data,
              cursor: nextLiveSnapshot.cursor,
            })
          } else {
            emitTerminalStreamEvent(event.ptyID, {
              type: "replace",
              buffer: nextLiveSnapshot.buffer,
              cursor: nextLiveSnapshot.cursor,
              scrollTop: workspaceRef.current.sessions[event.ptyID]?.scrollTop ?? 0,
            })
          }
          return
        }

        if (event.type === "state" || event.type === "exited" || event.type === "deleted") {
          if (event.session.sessionID !== currentSessionIDRef.current) return
          if (event.type === "deleted") {
            cancelReconnect(event.ptyID)
            delete pendingInputRef.current[event.ptyID]
          }

          writeLiveSessionSnapshot(event.ptyID, {
            cursor: event.session.cursor,
          })

          updateWorkspace((current) => {
            const previous = current.sessions[event.ptyID]
            return upsertSession(
              current,
              mapPtySessionInfoToRecord(event.session, {
                buffer: previous ? readLiveSessionSnapshot(event.ptyID, previous).buffer : "",
                scrollTop: previous ? readLiveSessionSnapshot(event.ptyID, previous).scrollTop : 0,
                transportState:
                  event.type === "deleted"
                    ? "disconnected"
                    : event.type === "exited"
                      ? previous?.transportState ?? "disconnected"
                      : previous?.transportState ?? "idle",
                lastError: previous?.lastError,
              }),
            )
          })
          return
        }

        if (event.type === "error") {
          updateWorkspace((current) => {
            const session = current.sessions[event.ptyID]
            if (!session) return current
            return {
              ...current,
              sessions: {
                ...current.sessions,
                [event.ptyID]: {
                  ...session,
                  transportState: "error",
                  lastError: event.message,
                },
              },
            }
          })
        }
      })
    } catch (error) {
      console.error("[desktop] onPtyEvent subscription failed:", error)
    }

    return () => {
      unsubscribe?.()
      for (const timer of Object.values(reconnectTimersRef.current)) {
        window.clearTimeout(timer)
      }
      for (const timer of Object.values(resizeTimersRef.current)) {
        window.clearTimeout(timer)
      }
    }
  }, [])

  useEffect(() => {
    const targetPtyID = workspace.isOpen ? workspace.activePtyID : null
    if (!targetPtyID) {
      if (attachedPtyIDRef.current) {
        void detachSession(attachedPtyIDRef.current, true)
      }
      return
    }

    const targetSession = workspace.sessions[targetPtyID]
    if (!targetSession || targetSession.sessionID !== normalizedCurrentSessionID) return
    if (attachedPtyIDRef.current === targetPtyID) return
    void attachSession(targetPtyID, getKnownCursor(targetPtyID))
  }, [workspace.activePtyID, workspace.isOpen, normalizedCurrentSessionID])

  async function handleCreateTerminal(openPanel = true, shellOverride?: string | null) {
    const ownerSessionID = currentSessionIDRef.current
    if (!ownerSessionID) return
    if (isCreatingTerminalRef.current) return

    const existing = Object.values(workspaceRef.current.sessions).find(
      (session) =>
        session.sessionID === ownerSessionID &&
        session.terminalKey === "interactive" &&
        session.status !== "deleted" &&
        session.status !== "invalid",
    )
    if (existing) {
      setCreationError(null)
      updateWorkspace((current) => ({
        ...current,
        isOpen: current.isOpen || openPanel,
        activePtyID: existing.ptyID,
      }))
      return
    }

    const shell = shellOverride ?? resolveShellFromProfile(shellProfilesRef.current, workspaceRef.current.preferredShellProfileID)
    const requestID = nextCreateRequestIDRef.current + 1
    nextCreateRequestIDRef.current = requestID
    pendingCreateRef.current = {
      requestID,
      sessionID: ownerSessionID,
      shell,
      openPanel,
      phase: "measuring",
    }
    isCreatingTerminalRef.current = true
    setIsCreatingTerminal(true)
    setPendingCreateRequestID(requestID)
    setCreationError(null)
    if (openPanel) {
      updateWorkspace((current) => ({
        ...current,
        isOpen: true,
      }))
    }
  }

  async function handleTerminalInitialDimensions(requestID: number, dimensions: { rows: number; cols: number }) {
    const pending = pendingCreateRef.current
    if (!pending || pending.requestID !== requestID) return
    if (pending.phase !== "measuring") return
    if (pending.sessionID !== currentSessionIDRef.current || !workspaceRef.current.isOpen) {
      cancelPendingCreateRequest(requestID)
      return
    }

    pendingCreateRef.current = {
      ...pending,
      phase: "creating",
    }
    setPendingCreateRequestID(null)

    try {
      const session = await terminalClient.createSession({
        sessionID: pending.sessionID,
        rows: dimensions.rows,
        cols: dimensions.cols,
        ...(pending.shell ? { shell: pending.shell } : {}),
      })

      const stillCurrent =
        pendingCreateRef.current?.requestID === requestID &&
        pending.sessionID === currentSessionIDRef.current &&
        workspaceRef.current.isOpen

      if (!stillCurrent) {
        await terminalClient.deleteSession({ id: session.id }).catch((error) => {
          console.error("[desktop] deletePtySession failed for canceled create:", error)
        })
        return
      }

      writeLiveSessionSnapshot(session.id, {
        buffer: "",
        cursor: session.cursor,
        scrollTop: workspaceRef.current.scrollTopBySessionID[pending.sessionID] ?? 0,
      })

      updateWorkspace((current) =>
        upsertSession(
          {
            ...current,
            isOpen: current.isOpen || pending.openPanel,
          },
          mapPtySessionInfoToRecord(session, {
            scrollTop: workspaceRef.current.scrollTopBySessionID[pending.sessionID] ?? 0,
            transportState: "idle",
          }),
          true,
        ),
      )
      setCreationError(null)
    } catch (error) {
      if (pendingCreateRef.current?.requestID !== requestID) return
      const message = error instanceof Error ? error.message : String(error)
      setCreationError(message)
      console.error("[desktop] createPtySession failed:", error)
    } finally {
      if (pendingCreateRef.current?.requestID === requestID) {
        pendingCreateRef.current = null
        setPendingCreateRequestID(null)
        isCreatingTerminalRef.current = false
        setIsCreatingTerminal(false)
      }
    }
  }

  function handleTerminalInitialDimensionsError(requestID: number, message: string) {
    if (!cancelPendingCreateRequest(requestID)) return
    setCreationError(message)
  }

  async function handleCreateTerminalForShellProfile(profileID: string) {
    const shell = resolveShellFromProfile(shellProfilesRef.current, profileID)
    await handleCreateTerminal(true, shell)
  }

  async function handleTogglePanel() {
    if (workspaceRef.current.isOpen) {
      cancelPendingCreateRequest()
      updateWorkspace((current) => ({
        ...current,
        isOpen: false,
      }))
      return
    }

    const ownerSessionID = currentSessionIDRef.current
    if (!ownerSessionID) return

    const activeForCurrentSession = Object.values(workspaceRef.current.sessions).some(
      (session) =>
        session.sessionID === ownerSessionID &&
        session.terminalKey === "interactive" &&
        session.status !== "deleted" &&
        session.status !== "invalid",
    )
    if (!activeForCurrentSession) {
      updateWorkspace((current) => ({
        ...current,
        isOpen: true,
      }))
      await handleCreateTerminal(true)
      return
    }

    updateWorkspace((current) => ({
      ...current,
      isOpen: true,
    }))
  }

  function handleSelectTerminal(ptyID: string) {
    updateWorkspace((current) => ({
      ...current,
      activePtyID: ptyID,
      isOpen: true,
    }))
  }

  function handleOpenPtySession(info: PtySessionInfo) {
    if (info.sessionID !== currentSessionIDRef.current) return
    writeLiveSessionSnapshot(info.id, {
      buffer: "",
      cursor: info.cursor,
      scrollTop: workspaceRef.current.scrollTopBySessionID[info.sessionID] ?? 0,
    })
    updateWorkspace((current) =>
      upsertSession(
        {
          ...current,
          isOpen: true,
        },
        mapPtySessionInfoToRecord(info, {
          scrollTop: workspaceRef.current.scrollTopBySessionID[info.sessionID] ?? 0,
          transportState: "idle",
        }),
        true,
      ),
    )
  }

  useEffect(() => {
    const handleOpenRequest = (event: Event) => {
      const info = (event as CustomEvent<PtySessionInfo>).detail
      if (!info) return
      handleOpenPtySession(info)
    }
    window.addEventListener(OPEN_PTY_SESSION_EVENT, handleOpenRequest)
    return () => window.removeEventListener(OPEN_PTY_SESSION_EVENT, handleOpenRequest)
  }, [])

  async function handleCloseTerminal(ptyID: string) {
    cancelReconnect(ptyID)

    if (resizeTimersRef.current[ptyID] !== undefined) {
      window.clearTimeout(resizeTimersRef.current[ptyID]!)
      delete resizeTimersRef.current[ptyID]
    }

    const session = workspaceRef.current.sessions[ptyID]
    const removedSnapshot = session ? readLiveSessionSnapshot(ptyID, session) : null
    if (attachedPtyIDRef.current === ptyID) {
      await detachSession(ptyID, true)
    }

    if (session && session.status !== "invalid") {
      try {
        await terminalClient.deleteSession({ id: ptyID })
      } catch (error) {
        console.error("[desktop] deletePtySession failed:", error)
      }
    }

    updateWorkspace((current) => {
      const nextOrder = current.order.filter((id) => id !== ptyID)
      const nextSessions = { ...current.sessions }
      delete nextSessions[ptyID]

      return {
        ...current,
        scrollTopBySessionID:
          session && removedSnapshot
            ? {
                ...current.scrollTopBySessionID,
                [session.sessionID]: removedSnapshot.scrollTop,
              }
            : current.scrollTopBySessionID,
        activePtyID:
          current.activePtyID === ptyID ? nextActivePtyID(nextOrder, ptyID) : current.activePtyID,
        order: nextOrder,
        sessions: nextSessions,
      }
    })
    delete liveSessionsRef.current[ptyID]
    delete terminalStreamListenersRef.current[ptyID]
    delete pendingInputRef.current[ptyID]
  }

  function handlePanelHeightChange(height: number) {
    updateWorkspace((current) => ({
      ...current,
      panelHeight: clampPanelHeight(height),
    }))
  }

  function handleTerminalResize(ptyID: string, rows: number, cols: number) {
    updateWorkspace((current) => {
      const session = current.sessions[ptyID]
      if (!session) return current
      return {
        ...current,
        sessions: {
          ...current.sessions,
          [ptyID]: {
            ...session,
            rows,
            cols,
          },
        },
      }
    })

    if (resizeTimersRef.current[ptyID] !== undefined) {
      window.clearTimeout(resizeTimersRef.current[ptyID]!)
    }

    resizeTimersRef.current[ptyID] = window.setTimeout(() => {
      delete resizeTimersRef.current[ptyID]
      void terminalClient.updateSession({ id: ptyID, rows, cols }).catch((error) => {
        console.error("[desktop] updatePtySession failed:", error)
      })
    }, 120)
  }

  function handleTerminalSnapshotChange(ptyID: string, input: { scrollTop?: number }) {
    const session = workspace.sessions[ptyID] ?? workspaceRef.current.sessions[ptyID]
    if (!session) return

    const current = readLiveSessionSnapshot(ptyID, session)
    const nextScrollTop = input.scrollTop ?? current.scrollTop
    if (nextScrollTop === current.scrollTop) return

    writeLiveSessionSnapshot(ptyID, {
      scrollTop: nextScrollTop,
    })
    updateWorkspace((currentState) => ({
      ...currentState,
      scrollTopBySessionID: {
        ...currentState.scrollTopBySessionID,
        [session.sessionID]: nextScrollTop,
      },
    }))
    scheduleWorkspacePersistence()
  }

  async function handleTerminalInput(ptyID: string, data: string) {
    const targetPtyID = ptyID.trim()
    if (!targetPtyID) return

    const session = workspaceRef.current.sessions[targetPtyID]
    if (!session || session.sessionID !== currentSessionIDRef.current || session.status !== "running") return

    if (session.transportState !== "connected" && session.transportState !== "connecting") {
      queuePendingInput(targetPtyID, data)
      if (attachedPtyIDRef.current !== targetPtyID) {
        void attachSession(targetPtyID, getKnownCursor(targetPtyID))
      }
      return
    }

    try {
      await terminalClient.writeInput({
        id: targetPtyID,
        data,
      })
    } catch (error) {
      queuePendingInput(targetPtyID, data, "prepend")
      console.error("[desktop] writePtyInput failed:", error)
      scheduleReconnect(targetPtyID)
    }
  }

  return {
    activeSession,
    creationError,
    handleCreateTerminalForShellProfile,
    handleTerminalInitialDimensions,
    handleTerminalInitialDimensionsError,
    isCreatingTerminal,
    isOpen: workspace.isOpen,
    panelHeight: clampPanelHeight(workspace.panelHeight),
    pendingCreateRequestID,
    selectedShellProfileID,
    shellProfiles,
    sessions,
    handleCloseTerminal,
    handleCreateTerminal,
    handleShellProfileChange,
    handlePanelHeightChange,
    handleOpenPtySession,
    handleSelectTerminal,
    handleTerminalInput,
    handleTerminalResize,
    handleTerminalSnapshotChange,
    handleTogglePanel,
    subscribeToTerminalStream,
  }
}
