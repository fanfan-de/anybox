import type {
  CinemaTimelineCommand,
  CinemaTimelineCommandResult,
  CinemaTimelineDocument,
} from "@anybox/shared/cinema-timeline"

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type CinemaTimelineCommandDraft = DistributiveOmit<CinemaTimelineCommand, "baseRevision">

export type CinemaTimelineCommandQueueSnapshot = {
  status: "idle" | "saving" | "error"
  pendingCount: number
  error: unknown | null
}

type QueueItem = {
  command: CinemaTimelineCommandDraft
  failureCount: number
  conflictCount: number
  settled: boolean
  resolve: (result: CinemaTimelineCommandResult) => void
  reject: (error: unknown) => void
}

type FlushWaiter = {
  resolve: () => void
  reject: (error: unknown) => void
}

export type CinemaTimelineCommandQueueOptions = {
  initialRevision?: number
  send: (command: CinemaTimelineCommand) => Promise<CinemaTimelineCommandResult>
  fetchLatestTimeline: () => Promise<CinemaTimelineDocument>
  isRevisionConflict: (error: unknown) => boolean
  onResult?: (result: CinemaTimelineCommandResult, pendingCount: number) => void
  onSnapshot?: (snapshot: CinemaTimelineCommandQueueSnapshot) => void
  retryDelaysMs?: readonly number[]
  wait?: (delayMs: number) => Promise<void>
}

function defaultWait(delayMs: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs))
}

export class CinemaTimelineCommandQueue {
  private readonly items: QueueItem[] = []
  private readonly flushWaiters: FlushWaiter[] = []
  private readonly retryDelaysMs: readonly number[]
  private readonly wait: (delayMs: number) => Promise<void>
  private processing = false
  private revision: number
  private snapshot: CinemaTimelineCommandQueueSnapshot = {
    status: "idle",
    pendingCount: 0,
    error: null,
  }

  constructor(private readonly options: CinemaTimelineCommandQueueOptions) {
    this.revision = options.initialRevision ?? 0
    this.retryDelaysMs = options.retryDelaysMs ?? [250, 750]
    this.wait = options.wait ?? defaultWait
  }

  getSnapshot() {
    return this.snapshot
  }

  hasPendingCommands() {
    return this.items.length > 0
  }

  syncRevision(revision: number) {
    if (Number.isInteger(revision) && revision >= 0) {
      this.revision = Math.max(this.revision, revision)
    }
  }

  enqueue(command: CinemaTimelineCommandDraft) {
    const promise = new Promise<CinemaTimelineCommandResult>((resolve, reject) => {
      this.items.push({
        command,
        failureCount: 0,
        conflictCount: 0,
        settled: false,
        resolve,
        reject,
      })
    })

    this.emit("saving", null)
    void this.drain()
    return promise
  }

  flush() {
    if (this.items.length === 0) return Promise.resolve()
    if (this.snapshot.status === "error") return Promise.reject(this.snapshot.error)
    return new Promise<void>((resolve, reject) => {
      this.flushWaiters.push({ resolve, reject })
    })
  }

  retry() {
    if (this.items.length === 0) return
    this.items[0]!.failureCount = 0
    this.emit("saving", null)
    void this.drain()
  }

  private settleFlushWaiters(error?: unknown) {
    const waiters = this.flushWaiters.splice(0)
    for (const waiter of waiters) {
      if (error === undefined) waiter.resolve()
      else waiter.reject(error)
    }
  }

  private emit(status: CinemaTimelineCommandQueueSnapshot["status"], error: unknown | null) {
    this.snapshot = {
      status,
      pendingCount: this.items.length,
      error,
    }
    this.options.onSnapshot?.(this.snapshot)
  }

  private async rebase() {
    const latest = await this.options.fetchLatestTimeline()
    this.revision = latest.revision
  }

  private async drain() {
    if (this.processing) return
    this.processing = true

    try {
      while (this.items.length > 0) {
        const item = this.items[0]!
        this.emit("saving", null)

        try {
          const result = await this.options.send({
            ...item.command,
            baseRevision: this.revision,
          } as CinemaTimelineCommand)
          this.revision = result.timeline.revision
          this.items.shift()
          this.options.onResult?.(result, this.items.length)
          item.settled = true
          item.resolve(result)
        } catch (caughtError) {
          let error = caughtError
          if (this.options.isRevisionConflict(error) && item.conflictCount < 4) {
            try {
              item.conflictCount += 1
              await this.rebase()
              continue
            } catch (rebaseError) {
              error = rebaseError
            }
          }

          const retryDelay = this.retryDelaysMs[item.failureCount]
          if (retryDelay !== undefined) {
            item.failureCount += 1
            await this.wait(retryDelay)
            continue
          }

          if (!item.settled) {
            item.settled = true
            item.reject(error)
          }
          this.emit("error", error)
          this.settleFlushWaiters(error)
          return
        }
      }

      this.emit("idle", null)
      this.settleFlushWaiters()
    } finally {
      this.processing = false
    }
  }
}
