import type { TerminalStoragePayload, TerminalWorkspaceState } from "./types"

const TERMINAL_STORAGE_KEY = "desktop.terminal.workspace.v1"
const DEFAULT_PANEL_HEIGHT = 280

function resolveTerminalStorageKey(storageKey?: string) {
  return storageKey?.trim() || TERMINAL_STORAGE_KEY
}

export function createEmptyTerminalWorkspaceState(): TerminalWorkspaceState {
  return {
    isOpen: false,
    activePtyID: null,
    order: [],
    sessions: {},
    scrollTopBySessionID: {},
    panelHeight: DEFAULT_PANEL_HEIGHT,
    preferredShellProfileID: null,
  }
}

export function loadTerminalWorkspaceState(storageKey?: string): TerminalWorkspaceState {
  if (typeof window === "undefined") return createEmptyTerminalWorkspaceState()

  try {
    const resolvedStorageKey = resolveTerminalStorageKey(storageKey)
    const raw = window.localStorage.getItem(resolvedStorageKey)
    if (!raw) return createEmptyTerminalWorkspaceState()

    const parsed = JSON.parse(raw) as TerminalStoragePayload
    if (parsed.version !== 2) {
      return createEmptyTerminalWorkspaceState()
    }

    const preferredShellProfileID = typeof parsed.preferredShellProfileID === "string"
      ? parsed.preferredShellProfileID === "powershell"
        ? "pwsh"
        : parsed.preferredShellProfileID
      : null

    if (parsed.preferredShellProfileID === "powershell") {
      try {
        window.localStorage.setItem(resolvedStorageKey, JSON.stringify({
          ...parsed,
          preferredShellProfileID,
        }))
      } catch {
        // The in-memory migration still applies when storage is unavailable.
      }
    }

    return {
      isOpen: parsed.isOpen === true,
      activePtyID: null,
      order: [],
      sessions: {},
      scrollTopBySessionID:
        parsed.scrollTopBySessionID && typeof parsed.scrollTopBySessionID === "object"
          ? Object.fromEntries(
              Object.entries(parsed.scrollTopBySessionID)
                .filter(([, value]) => typeof value === "number" && Number.isFinite(value)),
            )
          : {},
      panelHeight: Number.isFinite(parsed.panelHeight) ? Math.max(220, Math.min(parsed.panelHeight, 560)) : DEFAULT_PANEL_HEIGHT,
      preferredShellProfileID,
    }
  } catch {
    return createEmptyTerminalWorkspaceState()
  }
}

export function saveTerminalWorkspaceState(state: TerminalWorkspaceState, storageKey?: string) {
  if (typeof window === "undefined") return

  const payload = serializeTerminalWorkspaceState(state)

  window.localStorage.setItem(resolveTerminalStorageKey(storageKey), payload)
}

export function serializeTerminalWorkspaceState(state: TerminalWorkspaceState) {
  const payload: TerminalStoragePayload = {
    version: 2,
    isOpen: state.isOpen,
    activePtyID: null,
    order: [],
    sessions: [],
    scrollTopBySessionID: state.scrollTopBySessionID,
    panelHeight: state.panelHeight,
    preferredShellProfileID: state.preferredShellProfileID,
  }

  return JSON.stringify(payload)
}

export function clearTerminalWorkspaceState(storageKey?: string) {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(resolveTerminalStorageKey(storageKey))
}
