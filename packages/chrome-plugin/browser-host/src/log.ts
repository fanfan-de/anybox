import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs"
import path from "node:path"
import { browserRuntimePaths } from "@anybox/chrome-shared/runtime-paths"

type LogContext = Record<string, unknown>
type LogLevel = "debug" | "info" | "warn" | "error"

const MAX_LOG_BYTES = 2 * 1024 * 1024
const MAX_LOG_FILES = 4
const MAX_STRING_LENGTH = 512
const SENSITIVE_KEY = /(?:authorization|body|content|cookie|credential|html|input|params|password|proof|script|secret|text|token|value|url)/iu
const URL_PATTERN = /\b(?:https?|file):\/\/[^\s"'<>]+/giu
const EXECUTABLE_URL_PATTERN = /\b(?:data|javascript|vbscript):[^\s"'<>]*/giu

function scrubString(value: string) {
  const scrubbed = value
    .replace(URL_PATTERN, (candidate) => {
      try {
        const parsed = new URL(candidate)
        return `${parsed.protocol}//${parsed.host}/…`
      } catch {
        return "[redacted-url]"
      }
    })
    .replace(EXECUTABLE_URL_PATTERN, "[redacted-url]")
  return scrubbed.length > MAX_STRING_LENGTH
    ? `${scrubbed.slice(0, MAX_STRING_LENGTH)}…`
    : scrubbed
}

function sanitizeValue(
  value: unknown,
  key: string | undefined,
  depth: number,
): unknown {
  if (key && SENSITIVE_KEY.test(key)) return "[redacted]"
  if (key === "origin" && typeof value === "string") {
    try {
      return new URL(value).origin
    } catch {
      return "[invalid-origin]"
    }
  }
  if (depth > 5) return "[truncated]"
  if (value instanceof Error) {
    const code = "code" in value && typeof value.code === "string"
      ? value.code
      : undefined
    return {
      name: value.name,
      message: scrubString(value.message),
      ...(code ? { code } : {}),
    }
  }
  if (typeof value === "string") return scrubString(value)
  if (
    value === null
    || typeof value === "number"
    || typeof value === "boolean"
    || value === undefined
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) =>
      sanitizeValue(entry, undefined, depth + 1)
    )
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([entryKey, entryValue]) => [
          entryKey,
          sanitizeValue(entryValue, entryKey, depth + 1),
        ]),
    )
  }
  return scrubString(String(value))
}

export function sanitizeLogContext(context?: LogContext) {
  if (!context) return undefined
  return sanitizeValue(context, undefined, 0) as LogContext
}

function logFilePath() {
  const configured = process.env.ANYBOX_BROWSER_HOST_LOG_DIR?.trim()
  const directory = configured
    ? path.resolve(configured)
    : path.join(browserRuntimePaths().state, "logs")
  return path.join(directory, "browser-host.jsonl")
}

function rotate(filePath: string) {
  if (!existsSync(filePath) || statSync(filePath).size < MAX_LOG_BYTES) return
  const oldest = `${filePath}.${MAX_LOG_FILES - 1}`
  rmSync(oldest, { force: true })
  for (let index = MAX_LOG_FILES - 2; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`
    if (existsSync(source)) renameSync(source, `${filePath}.${index + 1}`)
  }
  renameSync(filePath, `${filePath}.1`)
}

function appendJsonLog(record: Record<string, unknown>) {
  try {
    const filePath = logFilePath()
    mkdirSync(path.dirname(filePath), { recursive: true })
    rotate(filePath)
    appendFileSync(filePath, `${JSON.stringify(record)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
  } catch {
    // Logging must never interrupt browser command handling.
  }
}

function write(
  level: LogLevel,
  service: string,
  event: string,
  context?: LogContext,
) {
  if (level === "debug" && process.env.ANYBOX_BROWSER_HOST_DEBUG !== "1") return
  const sanitized = sanitizeLogContext(context)
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service,
    event,
    ...(sanitized && Object.keys(sanitized).length > 0
      ? { context: sanitized }
      : {}),
  }
  appendJsonLog(record)
  const suffix = sanitized && Object.keys(sanitized).length > 0
    ? ` ${JSON.stringify(sanitized)}`
    : ""
  process.stderr.write(`[anybox-chrome:${service}] ${level} ${event}${suffix}\n`)
}

export function create(input: { service: string }) {
  return {
    debug: (event: string, context?: LogContext) =>
      write("debug", input.service, event, context),
    info: (event: string, context?: LogContext) =>
      write("info", input.service, event, context),
    warn: (event: string, context?: LogContext) =>
      write("warn", input.service, event, context),
    error: (event: string, context?: LogContext) =>
      write("error", input.service, event, context),
  }
}
