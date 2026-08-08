import path from "node:path"
import { IpythonWorkerClient } from "#ipython/worker-client.ts"
import { IpythonRuntimeError, type IpythonExecutionResult } from "#ipython/types.ts"

export interface IpythonSessionWorker {
  readonly isExited: boolean
  execute(input: { code: string; signal?: AbortSignal }): Promise<IpythonExecutionResult>
  interruptActive(): Promise<boolean>
  shutdown(): Promise<void>
}

export interface IpythonSessionManagerOptions {
  sessionID: string
  cwd: string
  generation: number
  onExit?: (manager: IpythonSessionManager) => void
  client?: IpythonSessionWorker
}

function abortedResult(generation: number): IpythonExecutionResult {
  return {
    status: "aborted",
    stdout: "",
    stderr: "",
    displays: [],
    durationMs: 0,
    kernelGeneration: generation,
    stateLost: false,
    outputTruncated: false,
  }
}

export class IpythonSessionManager {
  readonly sessionID: string
  readonly cwd: string
  readonly generation: number

  private readonly client: IpythonSessionWorker
  private tail: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(options: IpythonSessionManagerOptions) {
    this.sessionID = options.sessionID
    this.cwd = path.resolve(options.cwd)
    this.generation = options.generation
    this.client = options.client ?? new IpythonWorkerClient({
      sessionID: options.sessionID,
      cwd: this.cwd,
      generation: options.generation,
      onExit: () => options.onExit?.(this),
    })
  }

  get isExited() {
    return this.client.isExited
  }

  execute(input: { code: string; signal?: AbortSignal }) {
    let started = false
    const run = this.tail
      .catch(() => undefined)
      .then(async () => {
        started = true
        if (input.signal?.aborted) return abortedResult(this.generation)
        if (this.disposed) {
          throw new IpythonRuntimeError(
            "IPYTHON_HOST_EXITED",
            "The IPython session has already been closed.",
            { stateLost: true, kernelGeneration: this.generation },
          )
        }
        try {
          return await this.client.execute(input)
        } catch (error) {
          if (error instanceof IpythonRuntimeError) {
            throw error.withKernelGeneration(this.generation)
          }
          throw error
        }
      })
    this.tail = run.then(() => undefined, () => undefined)
    if (!input.signal) return run

    const signal = input.signal
    return new Promise<IpythonExecutionResult>((resolve, reject) => {
      let settled = false
      const cleanup = () => signal.removeEventListener("abort", onAbort)
      const finish = (result: IpythonExecutionResult) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const onAbort = () => {
        // A queued cell has not touched the kernel, so its caller can be
        // released immediately. The internal queue entry remains as a cheap
        // no-op that observes the already-aborted signal when it reaches head.
        if (!started) finish(abortedResult(this.generation))
      }

      signal.addEventListener("abort", onAbort, { once: true })
      if (signal.aborted) onAbort()
      run.then(finish, fail)
    })
  }

  async interrupt() {
    if (this.disposed) return false
    return await this.client.interruptActive()
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    await this.client.shutdown()
    await this.tail.catch(() => undefined)
  }
}
