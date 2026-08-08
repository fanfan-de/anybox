export const IPYTHON_HOST_PROTOCOL_VERSION = 1

export type IpythonExecutionStatus = "ok" | "error" | "aborted" | "timed_out"

export interface IpythonExecutionError {
  name: string
  message: string
  traceback: string[]
}

export interface IpythonExecutionResult {
  status: IpythonExecutionStatus
  executionCount?: number
  stdout: string
  stderr: string
  result?: string
  displays: Array<{
    mime: "text/plain"
    data: string
  }>
  error?: IpythonExecutionError
  durationMs: number
  kernelGeneration: number
  stateLost: boolean
  outputTruncated: boolean
}

export interface IpythonRuntimeFailure {
  status: "runtime_error"
  errorCode: IpythonRuntimeErrorCode
  message: string
  kernelGeneration: number
  stateLost: true
}

export type IpythonHostCommand =
  | {
      type: "probe"
      protocolVersion: typeof IPYTHON_HOST_PROTOCOL_VERSION
      requestId: string
    }
  | {
      type: "execute"
      protocolVersion: typeof IPYTHON_HOST_PROTOCOL_VERSION
      requestId: string
      code: string
      maxOutputChars: number
    }
  | {
      type: "interrupt"
      protocolVersion: typeof IPYTHON_HOST_PROTOCOL_VERSION
      requestId: string
    }
  | {
      type: "shutdown"
      protocolVersion: typeof IPYTHON_HOST_PROTOCOL_VERSION
      requestId: string
    }

export type IpythonHostEvent =
  | {
      type: "kernel_started"
      protocolVersion: number
      kernelPid: number
    }
  | {
      type: "ready"
      protocolVersion: number
      pythonVersion?: string
      ipythonVersion?: string
      kernelPid?: number
    }
  | {
      type: "probe"
      requestId?: string
      protocolVersion?: number
      pythonVersion?: string
      ipythonVersion?: string
      kernelPid?: number
      ok?: boolean
    }
  | {
      type: "stream"
      requestId: string
      name?: "stdout" | "stderr"
      text?: string
      truncated?: boolean
    }
  | {
      type: "display"
      requestId: string
      mime?: string
      data?: string
      truncated?: boolean
    }
  | {
      type: "result"
      requestId: string
      text?: string
      data?: string
      executionCount?: number
      truncated?: boolean
    }
  | {
      type: "error"
      requestId: string
      ename?: string
      evalue?: string
      traceback?: string[]
      executionCount?: number
    }
  | {
      type: "idle"
      requestId: string
      durationMs?: number
      executionCount?: number
      truncated?: boolean
    }
  | {
      type: "interrupted"
      requestId?: string
    }
  | {
      type: "shutdown"
      requestId?: string
    }
  | {
      type: "fatal"
      requestId?: string
      message?: string
      code?: string
    }

export type IpythonRuntimeErrorCode =
  | "IPYTHON_RUNTIME_NOT_CONFIGURED"
  | "IPYTHON_PYTHON_MISSING"
  | "IPYTHON_HOST_START_FAILED"
  | "IPYTHON_HOST_START_TIMEOUT"
  | "IPYTHON_HOST_PROTOCOL_ERROR"
  | "IPYTHON_HOST_PROTOCOL_MISMATCH"
  | "IPYTHON_HOST_EXITED"
  | "IPYTHON_EXECUTION_ABORTED"
  | "IPYTHON_EXECUTION_TIMED_OUT"
  | "IPYTHON_KERNEL_LIMIT"
  | "IPYTHON_SESSION_WORKDIR_CHANGED"

export class IpythonRuntimeError extends Error {
  readonly code: IpythonRuntimeErrorCode
  readonly stateLost: boolean
  readonly kernelGeneration?: number

  constructor(
    code: IpythonRuntimeErrorCode,
    message: string,
    options: { cause?: unknown; stateLost?: boolean; kernelGeneration?: number } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "IpythonRuntimeError"
    this.code = code
    this.stateLost = options.stateLost ?? false
    this.kernelGeneration = options.kernelGeneration
  }

  withKernelGeneration(kernelGeneration: number) {
    if (this.kernelGeneration !== undefined) return this
    const enriched = new IpythonRuntimeError(this.code, this.message, {
      cause: this,
      stateLost: this.stateLost,
      kernelGeneration,
    })
    enriched.stack = this.stack
    return enriched
  }
}
