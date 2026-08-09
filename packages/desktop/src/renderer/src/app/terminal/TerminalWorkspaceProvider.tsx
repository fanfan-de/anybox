import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
  type ReactNode,
} from "react"
import { terminalClient } from "./client"
import { useTerminalWorkspace } from "./use-terminal-workspace"

export type TerminalWorkspaceController = ReturnType<typeof useTerminalWorkspace>

interface TerminalWorkspaceProviderProps {
  children: ReactNode
  connectionEnabled: boolean
  currentSessionID: string | null
  storageKey?: string
}

const TerminalWorkspaceContext = createContext<TerminalWorkspaceController | null>(null)

export function TerminalWorkspaceProvider({
  children,
  connectionEnabled,
  currentSessionID,
  storageKey,
}: TerminalWorkspaceProviderProps) {
  const workspace = useTerminalWorkspace({
    autoCreateWhenOpen: false,
    connectionEnabled,
    currentSessionID,
    storageKey,
  })
  const syncSessionPty = useEffectEvent(workspace.handleSyncSessionPty)
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

    const sync = async () => {
      let info = null
      try {
        info = await terminalClient.getSessionPty({ sessionID })
      } catch (error) {
        if (cancelled) return
        console.error("[desktop] getSessionPty failed:", error)
        return
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

      syncSessionPty(null)
    }

    void sync()

    return () => {
      cancelled = true
    }
  }, [connectionEnabled, currentSessionID, resumeVersion])

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
