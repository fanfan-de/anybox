import path from "node:path"
import { PtyBuffer } from "#pty/buffer.ts"
import { PtyEvents, publishPtyEvent } from "#pty/events.ts"
import type { PtyRuntimeAdapter } from "#pty/runtime.ts"
import type { PtyReplayPayload, PtySessionInfo } from "#pty/types.ts"

export type PtySessionEvent =
  | {
      type: "output"
      id: string
      data: string
      cursor: number
      session: PtySessionInfo
    }
  | {
      type: "state"
      session: PtySessionInfo
    }
  | {
      type: "exited"
      session: PtySessionInfo
    }
  | {
      type: "deleted"
      session: PtySessionInfo
    }

export interface ManagedPtySession {
  readonly id: string
  info(): PtySessionInfo
  replay(cursor?: number | null): PtyReplayPayload
  write(data: string): void
  update(input: { title?: string; rows?: number; cols?: number }): PtySessionInfo
  markDeleted(): PtySessionInfo
  dispose(): void
  subscribe(listener: (event: PtySessionEvent) => void): () => void
}

interface CreateManagedPtySessionOptions {
  id: string
  sessionID: string
  terminalKey: string
  purpose: PtySessionInfo["purpose"]
  title?: string
  cwd: string
  shell: string
  rows: number
  cols: number
  bufferChars: number
  runtime: PtyRuntimeAdapter
  now?: () => number
  onExited?: (session: PtySessionInfo) => void
  onDeleted?: (session: PtySessionInfo) => void
}

function defaultTitle(cwd: string) {
  const folder = path.basename(cwd)
  return folder || cwd
}

export async function createManagedPtySession(options: CreateManagedPtySessionOptions): Promise<ManagedPtySession> {
  const now = options.now ?? Date.now
  const buffer = new PtyBuffer(options.bufferChars)
  const createdAt = now()
  let info: PtySessionInfo = {
    id: options.id,
    sessionID: options.sessionID,
    terminalKey: options.terminalKey,
    purpose: options.purpose,
    title: options.title?.trim() || defaultTitle(options.cwd),
    cwd: options.cwd,
    shell: options.shell,
    rows: options.rows,
    cols: options.cols,
    status: "running",
    exitCode: null,
    createdAt,
    updatedAt: createdAt,
    cursor: 0,
  }
  const listeners = new Set<(event: PtySessionEvent) => void>()
  const runtime = await options.runtime.spawn({
    shell: options.shell,
    cwd: options.cwd,
    rows: options.rows,
    cols: options.cols,
    env: {},
  })
  let cleaned = false
  let onDataDispose: (() => void) | null = null
  let onExitDispose: (() => void) | null = null

  function serialize() {
    return { ...info }
  }

  function emit(event: PtySessionEvent) {
    for (const listener of [...listeners]) {
      listener(event)
    }
  }

  function updateInfo(next: Partial<PtySessionInfo>) {
    info = {
      ...info,
      ...next,
      updatedAt: next.updatedAt ?? now(),
    }
    return serialize()
  }

  function publishUpdated() {
    const session = serialize()
    publishPtyEvent(PtyEvents.Updated, { session })
    emit({
      type: "state",
      session,
    })
  }

  onDataDispose = runtime.onData((data) => {
    if (cleaned || info.status !== "running" || !data) return
    const cursor = buffer.append(data)
    const session = updateInfo({ cursor })
    emit({
      type: "output",
      id: info.id,
      data,
      cursor,
      session,
    })
  })

  onExitDispose = runtime.onExit((event) => {
    if (cleaned || info.status === "deleted" || info.status === "exited") return
    const session = updateInfo({
      status: "exited",
      exitCode: event.exitCode ?? null,
      cursor: buffer.cursor,
    })
    publishPtyEvent(PtyEvents.Exited, { session })
    emit({
      type: "exited",
      session,
    })
    options.onExited?.(session)
  })

  return {
    get id() {
      return info.id
    },
    info() {
      return serialize()
    },
    replay(cursor) {
      return buffer.replayFrom(cursor)
    },
    write(data) {
      if (info.status !== "running") {
        throw new Error(`PTY session '${info.id}' is not running`)
      }
      runtime.write(data)
    },
    update(input) {
      let changed = false
      if (typeof input.title === "string" && input.title.trim() && input.title.trim() !== info.title) {
        info = {
          ...info,
          title: input.title.trim(),
          updatedAt: now(),
        }
        changed = true
      }

      const nextCols = input.cols ?? info.cols
      const nextRows = input.rows ?? info.rows
      if (nextCols !== info.cols || nextRows !== info.rows) {
        try {
          runtime.resize(nextCols, nextRows)
        } catch {
          // Resizing is advisory; stale PTY file descriptors can reject ioctl while the shell is exiting.
        }
        info = {
          ...info,
          cols: nextCols,
          rows: nextRows,
          updatedAt: now(),
        }
        changed = true
      }

      if (changed) {
        publishUpdated()
      }

      return serialize()
    },
    markDeleted() {
      if (info.status === "deleted") return serialize()

      const session = updateInfo({
        status: "deleted",
        cursor: buffer.cursor,
      })
      publishPtyEvent(PtyEvents.Deleted, { session })
      emit({
        type: "deleted",
        session,
      })
      options.onDeleted?.(session)
      runtime.kill()
      return session
    },
    dispose() {
      if (cleaned) return
      cleaned = true
      onDataDispose?.()
      onExitDispose?.()
      onDataDispose = null
      onExitDispose = null
      if (info.status === "running") {
        runtime.kill()
      }
      listeners.clear()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
