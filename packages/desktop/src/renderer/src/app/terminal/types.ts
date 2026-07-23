export type TerminalSessionStatus = "running" | "exited" | "deleted" | "invalid"
export type TerminalTransportState = "idle" | "connecting" | "connected" | "disconnected" | "error"
export interface TerminalShellProfile {
  id: string
  label: string
  shell: string | null
}
export type TerminalStreamEvent =
  | {
      type: "append"
      data: string
      cursor: number
    }
  | {
      type: "replace"
      buffer: string
      cursor: number
      scrollTop: number
    }

export interface TerminalSessionRecord {
  ptyID: string
  sessionID: string
  terminalKey: string
  purpose: "interactive" | "environment-action"
  title: string
  cwd: string
  shell: string
  rows: number
  cols: number
  status: TerminalSessionStatus
  exitCode: number | null
  createdAt: number
  updatedAt: number
  cursor: number
  buffer: string
  scrollTop: number
  transportState: TerminalTransportState
  lastError?: string
}

export interface TerminalWorkspaceState {
  isOpen: boolean
  activePtyID: string | null
  order: string[]
  sessions: Record<string, TerminalSessionRecord>
  scrollTopBySessionID: Record<string, number>
  panelHeight: number
  preferredShellProfileID: string | null
}

export interface TerminalStorageSessionSnapshot {
  ptyID: string
  sessionID: string
  terminalKey: string
  purpose: "interactive" | "environment-action"
  title: string
  cwd: string
  shell: string
  rows: number
  cols: number
  status: TerminalSessionStatus
  exitCode: number | null
  createdAt: number
  updatedAt: number
  cursor: number
  buffer: string
  scrollTop: number
}

export interface TerminalStoragePayload {
  version: 2
  isOpen: boolean
  activePtyID: string | null
  order: string[]
  sessions: TerminalStorageSessionSnapshot[]
  scrollTopBySessionID: Record<string, number>
  panelHeight: number
  preferredShellProfileID?: string | null
}

export interface PtySessionInfo {
  id: string
  sessionID: string
  terminalKey: string
  purpose: "interactive" | "environment-action"
  title: string
  cwd: string
  shell: string
  rows: number
  cols: number
  status: "running" | "exited" | "deleted"
  exitCode: number | null
  createdAt: number
  updatedAt: number
  cursor: number
}

export interface PtyReplayPayload {
  mode: "delta" | "reset"
  buffer: string
  cursor: number
  startCursor: number
}

export type PtyEvent =
  | {
      ptyID: string
      type: "transport"
      state: "connecting" | "connected" | "disconnected" | "error"
      code?: number
      reason?: string
      userInitiated?: boolean
      message?: string
    }
  | {
      ptyID: string
      type: "ready"
      session: PtySessionInfo
      replay: PtyReplayPayload
    }
  | {
      ptyID: string
      type: "output"
      id: string
      data: string
      cursor: number
    }
  | {
      ptyID: string
      type: "state" | "exited" | "deleted"
      session: PtySessionInfo
    }
  | {
      ptyID: string
      type: "error"
      code: string
      message: string
    }
