import type { PtyEvent, PtySessionInfo } from "./types"

function requireDesktopApi<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message)
  }

  return value
}

export const terminalClient = {
  createSession(input: {
    sessionID: string
    terminalKey?: string
    purpose?: "interactive" | "environment-action"
    title?: string
    shell?: string
    rows?: number
    cols?: number
  }) {
    return requireDesktopApi(window.desktop?.createPtySession, "PTY create bridge is unavailable")(input)
  },
  getSession(input: { id: string }) {
    return requireDesktopApi(window.desktop?.getPtySession, "PTY get bridge is unavailable")(input)
  },
  updateSession(input: { id: string; title?: string; rows?: number; cols?: number }) {
    return requireDesktopApi(window.desktop?.updatePtySession, "PTY update bridge is unavailable")(input)
  },
  deleteSession(input: { id: string }) {
    return requireDesktopApi(window.desktop?.deletePtySession, "PTY delete bridge is unavailable")(input)
  },
  attachSession(input: { id: string; cursor?: number }) {
    return requireDesktopApi(window.desktop?.attachPtySession, "PTY attach bridge is unavailable")(input)
  },
  detachSession(input: { id: string }) {
    return requireDesktopApi(window.desktop?.detachPtySession, "PTY detach bridge is unavailable")(input)
  },
  writeInput(input: { id: string; data: string }) {
    return requireDesktopApi(window.desktop?.writePtyInput, "PTY write bridge is unavailable")(input)
  },
  subscribe(listener: (event: PtyEvent) => void) {
    return requireDesktopApi(window.desktop?.onPtyEvent, "PTY event bridge is unavailable")(listener)
  },
}

export function mapPtySessionInfoToRecord(
  session: PtySessionInfo,
  current?: {
    buffer?: string
    scrollTop?: number
    transportState?: "idle" | "connecting" | "connected" | "disconnected" | "error"
    lastError?: string
  },
) {
  return {
    ptyID: session.id,
    sessionID: session.sessionID,
    terminalKey: session.terminalKey,
    purpose: session.purpose,
    title: session.title,
    cwd: session.cwd,
    shell: session.shell,
    rows: session.rows,
    cols: session.cols,
    status: session.status,
    exitCode: session.exitCode,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    cursor: session.cursor,
    buffer: current?.buffer ?? "",
    scrollTop: current?.scrollTop ?? 0,
    transportState: current?.transportState ?? "idle",
    lastError: current?.lastError,
  } as const
}
