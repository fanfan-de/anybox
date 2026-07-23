import type { PtySessionInfo } from "./types"

export const OPEN_PTY_SESSION_EVENT = "anybox:open-pty-session"

export function requestOpenPtySession(session: PtySessionInfo) {
  window.dispatchEvent(new CustomEvent<PtySessionInfo>(OPEN_PTY_SESSION_EVENT, {
    detail: session,
  }))
}
