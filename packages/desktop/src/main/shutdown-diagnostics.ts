import { app } from "electron"
import fs from "node:fs"
import path from "node:path"

const DIAGNOSTIC_LOG_FILENAME = "shutdown-diagnostics.log"
const MAX_STRING_LENGTH = 8_000
const MAX_ARRAY_LENGTH = 50
const MAX_OBJECT_KEYS = 80
const MAX_DEPTH = 6

type DiagnosticJsonValue =
  | null
  | boolean
  | number
  | string
  | DiagnosticJsonValue[]
  | { [key: string]: DiagnosticJsonValue }

let processDiagnosticsInstalled = false

export function getShutdownDiagnosticsLogPath() {
  try {
    return path.join(app.getPath("userData"), DIAGNOSTIC_LOG_FILENAME)
  } catch {
    return path.join(process.cwd(), DIAGNOSTIC_LOG_FILENAME)
  }
}

function truncateString(value: string, maxLength = MAX_STRING_LENGTH) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`
}

function normalizeError(error: Error, depth: number, seen: WeakSet<object>): DiagnosticJsonValue {
  const errorWithMetadata = error as Error & {
    cause?: unknown
    code?: unknown
    errno?: unknown
    syscall?: unknown
  }
  const output: { [key: string]: DiagnosticJsonValue } = {
    message: truncateString(error.message),
    name: error.name,
  }

  if (error.stack) output.stack = truncateString(error.stack, 16_000)
  if (errorWithMetadata.code !== undefined) output.code = normalizeDiagnosticValue(errorWithMetadata.code, depth + 1, seen)
  if (errorWithMetadata.errno !== undefined) output.errno = normalizeDiagnosticValue(errorWithMetadata.errno, depth + 1, seen)
  if (errorWithMetadata.syscall !== undefined) output.syscall = normalizeDiagnosticValue(errorWithMetadata.syscall, depth + 1, seen)
  if (errorWithMetadata.cause !== undefined) output.cause = normalizeDiagnosticValue(errorWithMetadata.cause, depth + 1, seen)

  return output
}

function normalizeDiagnosticValue(value: unknown, depth = 0, seen = new WeakSet<object>()): DiagnosticJsonValue {
  if (value === null || value === undefined) return value ?? null

  if (typeof value === "string") return truncateString(value)
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value)
  if (typeof value === "boolean") return value
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "symbol") return value.toString()
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`

  if (value instanceof Error) return normalizeError(value, depth, seen)

  if (typeof value !== "object") return String(value)
  if (seen.has(value)) return "[Circular]"
  if (depth >= MAX_DEPTH) return "[MaxDepth]"
  seen.add(value)

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_LENGTH).map((item) => normalizeDiagnosticValue(item, depth + 1, seen))
    if (value.length > MAX_ARRAY_LENGTH) {
      items.push(`...[truncated ${value.length - MAX_ARRAY_LENGTH} items]`)
    }
    return items
  }

  const output: { [key: string]: DiagnosticJsonValue } = {}
  const entries = Object.entries(value as Record<string, unknown>)
  for (const [key, item] of entries.slice(0, MAX_OBJECT_KEYS)) {
    output[key] = normalizeDiagnosticValue(item, depth + 1, seen)
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    output.__truncatedKeys = entries.length - MAX_OBJECT_KEYS
  }
  return output
}

function getAppVersionSafely() {
  try {
    return app.getVersion()
  } catch {
    return null
  }
}

export function recordShutdownDiagnostic(event: string, details?: unknown) {
  try {
    const logPath = getShutdownDiagnosticsLogPath()
    const entry = {
      timestamp: new Date().toISOString(),
      event,
      pid: process.pid,
      platform: process.platform,
      cwd: process.cwd(),
      execPath: process.execPath,
      argv: process.argv,
      appVersion: getAppVersionSafely(),
      versions: {
        chrome: process.versions.chrome ?? null,
        electron: process.versions.electron ?? null,
        node: process.versions.node,
      },
      details: normalizeDiagnosticValue(details ?? {}),
    }

    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8")
  } catch {
    // Diagnostics must never become the reason the app fails to start or quit.
  }
}

export function installProcessCrashDiagnostics() {
  if (processDiagnosticsInstalled) return
  processDiagnosticsInstalled = true

  recordShutdownDiagnostic("process-started")

  process.on("uncaughtExceptionMonitor", (error, origin) => {
    recordShutdownDiagnostic("uncaughtException", { error, origin })
  })

  process.on("unhandledRejection", (reason) => {
    recordShutdownDiagnostic("unhandledRejection", { reason })
  })
}
