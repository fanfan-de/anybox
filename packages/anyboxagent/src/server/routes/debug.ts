import { Hono, type Context } from "hono"
import { ApiError } from "#server/error.ts"
import type { AppEnv } from "#server/types.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as LiveStreamHub from "#session/runtime/live-stream-hub.ts"
import * as RunningState from "#session/runtime/running-state.ts"
import * as SessionRunner from "#session/runtime/session-runner.ts"
import { getSessionRuntimeDebugSnapshot } from "#session/runtime/runtime-debug.ts"
import { buildAgentSessionTraceExport, buildSafeStoredTraceEventPage } from "#session/runtime/trace-export.ts"
import * as Session from "#session/core/session.ts"
import * as SessionUseCase from "#server/usecases/session.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "server.debug" })
const LOG_STREAM_HEARTBEAT_INTERVAL_MS = 3000
const STATUS_STREAM_SNAPSHOT_INTERVAL_MS = 1000

function parseLimit(value: string | undefined, fallback: number, max: number) {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, max)
}

function parseLogLevel(value: string | undefined) {
  if (!value) return undefined
  const parsed = Log.Level.safeParse(value.trim().toUpperCase())
  return parsed.success ? parsed.data : undefined
}

function parseLogQuery(c: Context<AppEnv>) {
  return {
    level: parseLogLevel(c.req.query("level")),
    service: c.req.query("service")?.trim() || undefined,
    excludeService: c.req.query("excludeService")?.trim() || undefined,
    q: c.req.query("q")?.trim() || undefined,
    limit: parseLimit(c.req.query("limit"), 200, 1000),
  } satisfies Log.LogQuery
}

function toSSE(event: string, data: unknown, id?: string) {
  const lines = []
  if (id) lines.push(`id: ${id}`)
  lines.push(`event: ${event}`)
  lines.push(`data: ${JSON.stringify(data)}`)
  return `${lines.join("\n")}\n\n`
}

function createSSEHeaders(requestId?: string) {
  const headers: Record<string, string> = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  }
  if (requestId) headers["x-request-id"] = requestId
  return headers
}

function buildStatusPayload() {
  const runningSessions = RunningState.snapshot()
  const memory = process.memoryUsage()

  return {
    ok: true,
    generatedAt: Date.now(),
    process: {
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      platform: process.platform,
      memory,
    },
    logging: Log.status(),
    trace: EventStore.traceStoreHealth(),
    streams: LiveStreamHub.snapshot(),
    runnerLimits: SessionRunner.runtimeLimitsSnapshot(),
    runningSessions: {
      count: runningSessions.length,
      items: runningSessions,
    },
    recentErrors: Log.list({
      level: "ERROR",
      limit: 10,
    }),
  }
}

function buildRuntimePayload(input?: {
  eventLimit?: number
  turnLimit?: number
}) {
  const eventLimit = input?.eventLimit ?? 12
  const turnLimit = input?.turnLimit ?? 2

  return {
    generatedAt: Date.now(),
    process: {
      pid: process.pid,
      uptimeMs: Math.round(process.uptime() * 1000),
      platform: process.platform,
    },
    logging: Log.status(),
    trace: EventStore.traceStoreHealth(),
    runnerLimits: SessionRunner.runtimeLimitsSnapshot(),
    runningSessions: RunningState.snapshot().map((item) =>
      getSessionRuntimeDebugSnapshot({
        sessionID: item.sessionID,
        eventLimit,
        turnLimit,
        recentOnly: true,
      }),
    ),
  }
}

function buildStatusStreamPayload(input?: { includeRuntime?: boolean }) {
  const payload: {
    status: ReturnType<typeof buildStatusPayload>
    runtime?: ReturnType<typeof buildRuntimePayload>
  } = {
    status: buildStatusPayload(),
  }

  if (input?.includeRuntime ?? true) {
    payload.runtime = buildRuntimePayload()
  }

  return payload
}

function createLogStream(input: {
  query: Omit<Log.LogQuery, "limit">
  requestId?: string
}) {
  let cancelled = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let unsubscribe: (() => void) | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()

      const enqueue = (chunk: string) => {
        if (cancelled) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cancelled = true
          heartbeat && clearInterval(heartbeat)
          unsubscribe?.()
        }
      }

      heartbeat = setInterval(() => {
        enqueue(`: keepalive ${Date.now()}\n\n`)
      }, LOG_STREAM_HEARTBEAT_INTERVAL_MS)

      unsubscribe = Log.subscribe((entry) => {
        if (!Log.matches(entry, input.query)) return
        enqueue(toSSE("log", entry, entry.id))
      })
    },
    cancel() {
      cancelled = true
      if (heartbeat) clearInterval(heartbeat)
      unsubscribe?.()
    },
  })

  return new Response(stream, {
    headers: createSSEHeaders(input.requestId),
  })
}

function createStatusStream(input: {
  requestId?: string
  includeRuntime?: boolean
}) {
  let cancelled = false
  let pending = false
  let snapshotTimer: ReturnType<typeof setInterval> | undefined
  const unsubscribers: Array<() => void> = []

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()

      const enqueue = (chunk: string) => {
        if (cancelled) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cancelled = true
          if (snapshotTimer) clearInterval(snapshotTimer)
          for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
        }
      }

      const pushSnapshot = () => {
        if (cancelled) return
        enqueue(toSSE("status", buildStatusStreamPayload({ includeRuntime: input.includeRuntime })))
      }

      const scheduleSnapshot = () => {
        if (cancelled || pending) return
        pending = true
        queueMicrotask(() => {
          pending = false
          pushSnapshot()
        })
      }

      pushSnapshot()

      snapshotTimer = setInterval(() => {
        scheduleSnapshot()
      }, STATUS_STREAM_SNAPSHOT_INTERVAL_MS)

      unsubscribers.push(
        Log.subscribe(() => scheduleSnapshot()),
        RunningState.subscribe(() => scheduleSnapshot()),
        EventStore.subscribe(() => scheduleSnapshot()),
      )
    },
    cancel() {
      cancelled = true
      if (snapshotTimer) clearInterval(snapshotTimer)
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe()
    },
  })

  return new Response(stream, {
    headers: createSSEHeaders(input.requestId),
  })
}

export function DebugRoutes() {
  const app = new Hono<AppEnv>()

  app.get("/status", (c) => {
    return c.json({
      success: true,
      data: buildStatusPayload(),
      requestId: c.get("requestId"),
    })
  })

  app.get("/status/stream", (c) =>
    createStatusStream({
      requestId: c.get("requestId"),
      includeRuntime: c.req.query("runtime") !== "0",
    }),
  )

  app.get("/logs", (c) => {
    const query = parseLogQuery(c)

    return c.json({
      success: true,
      data: {
        logs: Log.list(query),
      },
      requestId: c.get("requestId"),
    })
  })

  app.get("/logs/stream", (c) => {
    const query = parseLogQuery(c)
    const { limit: _limit, ...streamQuery } = query
    return createLogStream({
      query: streamQuery,
      requestId: c.get("requestId"),
    })
  })

  app.get("/runtime", (c) => {
    const eventLimit = parseLimit(c.req.query("limit"), 12, 100)
    const turnLimit = parseLimit(c.req.query("turns"), 2, 10)
    const runtime = buildRuntimePayload({ eventLimit, turnLimit })

    log.info("runtime debug snapshot requested", {
      requestId: c.get("requestId"),
      runningSessions: runtime.runningSessions.length,
      eventLimit,
      turnLimit,
    })

    return c.json({
      success: true,
      data: runtime,
      requestId: c.get("requestId"),
    })
  })

  app.get("/sessions/:id/runtime", (c) => {
    const sessionID = c.req.param("id")
    const session = Session.DataBaseRead("sessions", sessionID) as Session.SessionInfo | null
    if (!session) {
      throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${sessionID}' not found`)
    }

    const eventLimit = parseLimit(c.req.query("limit"), 25, 100)
    const turnLimit = parseLimit(c.req.query("turns"), 6, 20)
    const detail = getSessionRuntimeDebugSnapshot({
      sessionID,
      eventLimit,
      turnLimit,
    })

    log.info("session runtime debug requested", {
      requestId: c.get("requestId"),
      sessionID,
      eventLimit,
      turnLimit,
    })

    return c.json({
      success: true,
      data: detail,
      requestId: c.get("requestId"),
    })
  })

  app.get("/sessions/:id/trace-export", async (c) => {
    const sessionID = c.req.param("id")
    const session = Session.DataBaseRead("sessions", sessionID) as Session.SessionInfo | null
    if (!session) {
      throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${sessionID}' not found`)
    }

    const totalRetainedEventCount = EventStore.countSessionEvents(sessionID)
    const events = EventStore.listRecentSessionEvents({ sessionID, limit: 5_000 })
    const runtime = getSessionRuntimeDebugSnapshot({
      sessionID,
      eventLimit: 100,
      turnLimit: 20,
    })
    const messages = await SessionUseCase.listSessionMessages(sessionID, { view: "all" })
    const trace = buildAgentSessionTraceExport({
      events,
      messages,
      runtime,
      totalRetainedEventCount,
    })

    log.info("session trace export requested", {
      requestId: c.get("requestId"),
      sessionID,
      eventCount: events.length,
      totalRetainedEventCount,
      messageCount: messages.length,
      toolCallCount: trace.toolCalls.length,
    })

    return c.json({
      success: true,
      data: trace,
      requestId: c.get("requestId"),
    })
  })

  app.get("/sessions/:id/trace-events", (c) => {
    const sessionID = c.req.param("id")
    const session = Session.DataBaseRead("sessions", sessionID) as Session.SessionInfo | null
    if (!session) {
      throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${sessionID}' not found`)
    }

    const afterPositionValue = Number(c.req.query("afterPosition") ?? 0)
    const afterPosition = Number.isSafeInteger(afterPositionValue) && afterPositionValue >= 0
      ? afterPositionValue
      : 0
    const limit = parseLimit(c.req.query("limit"), 1_000, 1_000)
    const rows = EventStore.listSessionEvents({
      sessionID,
      after: { position: afterPosition },
      limit: limit + 1,
    })
    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const safePage = buildSafeStoredTraceEventPage(pageRows)

    return c.json({
      success: true,
      data: {
        schemaVersion: 2,
        mode: "safe",
        events: safePage.events,
        redaction: safePage.redaction,
        hasMore,
        nextPosition: pageRows.at(-1)?.position ?? afterPosition,
        totalRetainedEventCount: EventStore.countSessionEvents(sessionID),
      },
      requestId: c.get("requestId"),
    })
  })

  return app
}
