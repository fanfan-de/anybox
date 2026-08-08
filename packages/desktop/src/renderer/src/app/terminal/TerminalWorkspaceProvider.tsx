import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { terminalClient } from "./client"
import { useTerminalWorkspace } from "./use-terminal-workspace"

export const TERMINAL_DISCOVERY_RETRY_DELAYS_MS = [100, 300, 750] as const

export type TerminalWorkspaceController = ReturnType<typeof useTerminalWorkspace>

interface TerminalWorkspaceProviderProps {
  children: ReactNode
  connectionEnabled: boolean
  currentSessionID: string | null
  discoveryKey?: string
  storageKey?: string
}

const TerminalWorkspaceContext = createContext<TerminalWorkspaceController | null>(null)

export function TerminalWorkspaceProvider({
  children,
  connectionEnabled,
  currentSessionID,
  discoveryKey,
  storageKey,
}: TerminalWorkspaceProviderProps) {
  const workspace = useTerminalWorkspace({
    autoCreateWhenOpen: false,
    connectionEnabled,
    currentSessionID,
    storageKey,
  })
  const syncSessionPty = useEffectEvent(workspace.handleSyncSessionPty)
  const lastDiscoveryKeyRef = useRef<string | undefined>(undefined)
  const [resumeVersion, setResumeVersion] = useState(0)

  useEffect(() => {
    const refreshAfterResume = () => {
      setResumeVersion((current) => current + 1)
    }
    const refreshAfterVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshAfterResume()
      }
    }

    window.addEventListener("focus", refreshAfterResume)
    document.addEventListener("visibilitychange", refreshAfterVisibilityChange)
    return () => {
      window.removeEventListener("focus", refreshAfterResume)
      document.removeEventListener("visibilitychange", refreshAfterVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const sessionID = currentSessionID?.trim() || null
    if (!sessionID) return

    let cancelled = false
    let retryTimer: number | null = null
    let attemptIndex = 0
    const shouldRetry = Boolean(discoveryKey && discoveryKey !== lastDiscoveryKeyRef.current)
    lastDiscoveryKeyRef.current = discoveryKey
    const attemptDelays = shouldRetry ? [0, ...TERMINAL_DISCOVERY_RETRY_DELAYS_MS] : [0]

    const discover = async () => {
      let info = null
      try {
        info = await terminalClient.getSessionPty({ sessionID })
      } catch (error) {
        if (cancelled) return
        if (attemptIndex >= attemptDelays.length - 1) {
          console.error("[desktop] getSessionPty failed:", error)
          return
        }
      }

      if (cancelled) return
      if (
        info &&
        info.sessionID === sessionID &&
        info.purpose === "interactive" &&
        info.terminalKey === "interactive" &&
        info.status === "running"
      ) {
        syncSessionPty(info)
        return
      }

      if (attemptIndex >= attemptDelays.length - 1) {
        syncSessionPty(null)
        return
      }

      const currentDelay = attemptDelays[attemptIndex] ?? 0
      attemptIndex += 1
      const nextDelay = attemptDelays[attemptIndex] ?? currentDelay
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        void discover()
      }, Math.max(0, nextDelay - currentDelay))
    }

    void discover()

    return () => {
      cancelled = true
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
      }
    }
  }, [connectionEnabled, currentSessionID, discoveryKey, resumeVersion])

  return (
    <TerminalWorkspaceContext.Provider value={workspace}>
      {children}
    </TerminalWorkspaceContext.Provider>
  )
}

export function useOptionalTerminalWorkspace() {
  return useContext(TerminalWorkspaceContext)
}

export function useTerminalWorkspaceContext() {
  const workspace = useOptionalTerminalWorkspace()
  if (!workspace) {
    throw new Error("Terminal workspace context is unavailable")
  }
  return workspace
}
