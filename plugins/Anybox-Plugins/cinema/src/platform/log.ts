const SENSITIVE_KEY = /(authorization|bearer|credential|password|secret|token|api[_-]?key)/i

function sanitize(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]"
  if (depth > 5) return "[TRUNCATED]"
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key, depth + 1))
  if (value && typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: value.message }
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey, depth + 1)]))
  }
  return value
}

export type Logger = ReturnType<typeof create>

export function create(tags: Record<string, unknown> = {}) {
  const emit = (level: string, message?: unknown, extra?: Record<string, unknown>) => {
    const payload = sanitize({ ...tags, ...extra })
    const text = typeof message === "string" ? message : JSON.stringify(sanitize(message))
    process.stderr.write(`${new Date().toISOString()} ${level} ${text ?? ""} ${JSON.stringify(payload)}\n`)
  }
  return {
    debug: (message?: unknown, extra?: Record<string, unknown>) => emit("DEBUG", message, extra),
    info: (message?: unknown, extra?: Record<string, unknown>) => emit("INFO", message, extra),
    warn: (message?: unknown, extra?: Record<string, unknown>) => emit("WARN", message, extra),
    error: (message?: unknown, extra?: Record<string, unknown>) => emit("ERROR", message, extra),
    tag(key: string, value: string) {
      tags[key] = value
      return this
    },
    clone: () => create({ ...tags }),
  }
}

export const Default = create({ service: "cinema" })
