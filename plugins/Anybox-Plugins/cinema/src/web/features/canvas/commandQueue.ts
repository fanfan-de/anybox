import type {
  CinemaCanvasDocument,
  CinemaCommand,
  CinemaCommandResult,
} from "@anybox/cinema-plugin/contracts"

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type CinemaCommandDraft = DistributiveOmit<CinemaCommand, "baseRevision">

export type CinemaCommandQueueSnapshot = {
  status: "idle" | "saving" | "error"
  pendingCount: number
  error: unknown | null
}

type QueueItem = {
  command: CinemaCommandDraft
  failureCount: number
  conflictCount: number
  settled: boolean
  resolve: (result: CinemaCommandResult) => void
  reject: (error: unknown) => void
}

export type CinemaCommandQueueOptions = {
  initialRevision?: number
  send: (command: CinemaCommand) => Promise<CinemaCommandResult>
  fetchLatestCanvas: () => Promise<CinemaCanvasDocument>
  isRevisionConflict: (error: unknown) => boolean
  onResult?: (result: CinemaCommandResult, pendingCount: number) => void
  onSnapshot?: (snapshot: CinemaCommandQueueSnapshot) => void
  retryDelaysMs?: readonly number[]
  wait?: (delayMs: number) => Promise<void>
}

function defaultWait(delayMs: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs))
}

export class CinemaCommandQueue {
  private readonly items: QueueItem[] = []
  private readonly retryDelaysMs: readonly number[]
  private readonly wait: (delayMs: number) => Promise<void>
  private processing = false
  private revision: number
  private snapshot: CinemaCommandQueueSnapshot = {
    status: "idle",
    pendingCount: 0,
    error: null,
  }

  constructor(private readonly options: CinemaCommandQueueOptions) {
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

  enqueue(command: CinemaCommandDraft) {
    const promise = new Promise<CinemaCommandResult>((resolve, reject) => {
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

  retry() {
    if (this.items.length === 0) return
    this.items[0].failureCount = 0
    this.emit("saving", null)
    void this.drain()
  }

  private emit(status: CinemaCommandQueueSnapshot["status"], error: unknown | null) {
    this.snapshot = {
      status,
      pendingCount: this.items.length,
      error,
    }
    this.options.onSnapshot?.(this.snapshot)
  }

  private async rebase() {
    const latest = await this.options.fetchLatestCanvas()
    this.revision = latest.revision ?? 0
  }

  private async drain() {
    if (this.processing) return
    this.processing = true

    try {
      while (this.items.length > 0) {
        const item = this.items[0]
        this.emit("saving", null)

        try {
          const result = await this.options.send({
            ...item.command,
            baseRevision: this.revision,
          } as CinemaCommand)
          this.revision = result.canvas.revision ?? this.revision
          this.items.shift()
          this.options.onResult?.(result, this.items.length)
          item.settled = true
          item.resolve(result)
        } catch (error) {
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
          return
        }
      }

      this.emit("idle", null)
    } finally {
      this.processing = false
    }
  }
}
