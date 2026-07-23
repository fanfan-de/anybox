import { Hono, type Context } from "hono"
import z from "zod"
import * as Discovery from "#environment/discovery.ts"
import * as EnvironmentActions from "#environment/actions.ts"
import * as EnvironmentEvents from "#environment/events.ts"
import * as EnvironmentManager from "#environment/manager.ts"
import * as EnvironmentRunner from "#environment/runner.ts"
import { EnvironmentDefinition } from "#environment/types.ts"
import { ok, parseJsonBody, parseQuery } from "#server/http.ts"
import type { AppEnv } from "#server/types.ts"
import type { PtyRegistry } from "#pty/registry.ts"

const STREAM_HEARTBEAT_INTERVAL_MS = 3000

const EnvironmentDirectoryQuery = z.object({
  directory: z.string().trim().min(1),
})

const SaveNativeEnvironmentBody = z.object({
  directory: z.string().trim().min(1),
  definition: EnvironmentDefinition,
  expectedHash: z.string().nullable(),
  trust: z.boolean().optional().default(false),
})

const ImportEnvironmentBody = z.object({
  directory: z.string().trim().min(1),
  key: z.string().trim().min(1),
  expectedHash: z.string().trim().min(1),
  trust: z.boolean().optional().default(false),
})

const TrustEnvironmentBody = z.object({
  directory: z.string().trim().min(1),
  expectedHash: z.string().trim().min(1),
})

const RevokeEnvironmentTrustBody = z.object({
  directory: z.string().trim().min(1),
  expectedHash: z.string().trim().min(1).optional(),
})

const UpdateEnvironmentPreferenceBody = z
  .object({
    directory: z.string().trim().min(1),
    selectedKey: z.string().trim().min(1).nullable().optional(),
    autoSetup: z.boolean().optional(),
  })
  .refine(
    (value) => value.selectedKey !== undefined || value.autoSetup !== undefined,
    "Preference update must contain selectedKey or autoSetup.",
  )

const EnvironmentActionBody = z.object({
  sessionID: z.string().trim().min(1),
  expectedHash: z.string().trim().min(1),
})

const StopEnvironmentActionBody = z.object({
  sessionID: z.string().trim().min(1),
})

function createSSEHeaders(requestId?: string) {
  const headers: Record<string, string> = {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  }
  if (requestId) headers["x-request-id"] = requestId
  return headers
}

function environmentEventStream(c: Context<AppEnv>) {
  const encoder = new TextEncoder()
  const lastEventID = c.req.header("last-event-id")?.trim() || undefined
  const requestSignal = c.req.raw.signal
  let closeStream: (() => void) | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let unsubscribe: (() => void) | undefined
      let heartbeat: ReturnType<typeof setInterval> | undefined

      const enqueue = (text: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(text))
        } catch {
          close()
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        unsubscribe?.()
        if (heartbeat) clearInterval(heartbeat)
        requestSignal.removeEventListener("abort", close)
        try {
          controller.close()
        } catch {
          // The client may already have disconnected.
        }
      }

      requestSignal.addEventListener("abort", close)
      closeStream = close
      for (const event of EnvironmentEvents.listEventsAfter(lastEventID)) {
        enqueue(EnvironmentEvents.toSSE(event))
      }
      unsubscribe = EnvironmentEvents.subscribe((event) => {
        enqueue(EnvironmentEvents.toSSE(event))
      })
      heartbeat = setInterval(() => enqueue(": heartbeat\n\n"), STREAM_HEARTBEAT_INTERVAL_MS)
    },
    cancel() {
      closeStream?.()
    },
  })

  return new Response(stream, {
    headers: createSSEHeaders(c.get("requestId")),
  })
}

export function EnvironmentRoutes(options: { ptyRegistry: PtyRegistry }) {
  const app = new Hono<AppEnv>()

  app.get("/projects/:projectID/environments", async (c) => {
    const query = parseQuery(
      c.req.query(),
      EnvironmentDirectoryQuery,
      "INVALID_QUERY",
      "Query parameter 'directory' must be a non-empty string.",
    )
    return ok(
      c,
      await Discovery.discoverProjectEnvironments(c.req.param("projectID"), query.directory),
    )
  })

  app.put("/projects/:projectID/environments/native", async (c) => {
    const input = await parseJsonBody(
      c,
      SaveNativeEnvironmentBody,
      "Environment definition is invalid.",
    )
    return ok(c, await EnvironmentManager.saveNativeEnvironment({
      ...input,
      projectID: c.req.param("projectID"),
    }))
  })

  app.post("/projects/:projectID/environments/import-codex", async (c) => {
    const input = await parseJsonBody(
      c,
      ImportEnvironmentBody,
      "Environment import request is invalid.",
    )
    return ok(c, await EnvironmentManager.importEnvironment({
      ...input,
      projectID: c.req.param("projectID"),
    }), 201)
  })

  app.put("/projects/:projectID/environments/preference", async (c) => {
    const input = await parseJsonBody(
      c,
      UpdateEnvironmentPreferenceBody,
      "Environment preference request is invalid.",
    )
    return ok(c, await EnvironmentManager.updatePreference({
      ...input,
      projectID: c.req.param("projectID"),
    }))
  })

  app.post("/projects/:projectID/environments/:key/trust", async (c) => {
    const input = await parseJsonBody(
      c,
      TrustEnvironmentBody,
      "Environment trust request is invalid.",
    )
    return ok(c, await EnvironmentManager.trustEnvironment({
      ...input,
      projectID: c.req.param("projectID"),
      key: c.req.param("key"),
    }))
  })

  app.delete("/projects/:projectID/environments/:key/trust", async (c) => {
    const input = await parseJsonBody(
      c,
      RevokeEnvironmentTrustBody,
      "Environment trust request is invalid.",
    )
    return ok(c, await EnvironmentManager.revokeEnvironmentTrust({
      ...input,
      projectID: c.req.param("projectID"),
      key: c.req.param("key"),
    }))
  })

  app.get("/environment-events/stream", environmentEventStream)

  app.get("/environment-runs/:runID", (c) =>
    ok(c, EnvironmentRunner.getRun(c.req.param("runID"))))

  app.post("/environment-runs/:runID/cancel", async (c) =>
    ok(c, await EnvironmentRunner.cancelRun(c.req.param("runID"))))

  app.post("/environment-runs/:runID/retry", async (c) =>
    ok(c, await EnvironmentRunner.retrySetup(c.req.param("runID")), 201))

  app.post(
    "/projects/:projectID/environments/:key/actions/:actionID/start",
    async (c) => {
      const input = await parseJsonBody(
        c,
        EnvironmentActionBody,
        "Environment action request is invalid.",
      )
      return ok(c, await EnvironmentActions.startAction({
        ...input,
        projectID: c.req.param("projectID"),
        environmentKey: c.req.param("key"),
        actionID: c.req.param("actionID"),
        registry: options.ptyRegistry,
      }), 201)
    },
  )

  app.post(
    "/projects/:projectID/environments/:key/actions/:actionID/stop",
    async (c) => {
      const input = await parseJsonBody(
        c,
        StopEnvironmentActionBody,
        "Environment action stop request is invalid.",
      )
      return ok(c, await EnvironmentActions.stopAction({
        ...input,
        projectID: c.req.param("projectID"),
        environmentKey: c.req.param("key"),
        actionID: c.req.param("actionID"),
        registry: options.ptyRegistry,
      }))
    },
  )

  app.post("/projects/:projectID/environments/:key/setup", async (c) => {
    const input = await parseJsonBody(
      c,
      EnvironmentActionBody,
      "Environment setup request is invalid.",
    )
    return ok(c, await EnvironmentActions.restartSetupForSession({
      ...input,
      projectID: c.req.param("projectID"),
      environmentKey: c.req.param("key"),
    }), 201)
  })

  return app
}
