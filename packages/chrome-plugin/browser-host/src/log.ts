type LogContext = Record<string, unknown>

function write(
  level: "debug" | "info" | "warn" | "error",
  service: string,
  event: string,
  context?: LogContext,
) {
  if (level === "debug" && process.env.ANYBOX_BROWSER_HOST_DEBUG !== "1") return
  const suffix = context && Object.keys(context).length > 0
    ? ` ${JSON.stringify(context, (_key, value) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack }
          : value
      )}`
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
