import { Hono } from "hono"
import z from "zod"
import * as Permission from "#permission/permission.ts"
import * as Session from "#session/core/session.ts"
import * as Prompt from "#session/core/prompt.ts"
import { Instance } from "#project/instance.ts"
import { ApiError } from "#server/error.ts"
import type { AppEnv } from "#server/types.ts"

const ListRequestsQuery = z.object({
  status: Permission.RequestStatus.optional(),
  sessionID: z.string().optional(),
  view: z.enum(["prompt", "full"]).optional(),
})

const ResolveBody = Permission.RequestResolution.extend({
  resume: z.boolean().optional(),
})

const LegacyRespondBody = z.object({
  reason: z.string().optional(),
  resume: z.boolean().optional(),
})

function decisionFromLegacy(approved: boolean): Permission.Decision {
  return approved ? "allow" : "deny"
}

function safeReadSession(sessionID: string) {
  try {
    return Session.DataBaseRead("sessions", sessionID) as Session.SessionInfo | null
  } catch {
    return null
  }
}

async function resumeSessionIfReady(input: {
  resume?: boolean
  sessionID: string
}) {
  if (!input.resume) return undefined

  const pendingRequests = await Permission.listRequests({
    sessionID: input.sessionID,
    status: "pending",
  })
  if (pendingRequests.length > 0) return undefined

  const session = safeReadSession(input.sessionID)
  if (!session) {
    throw new ApiError(404, "SESSION_NOT_FOUND", `Session '${input.sessionID}' not found`)
  }

  return Instance.provide({
    directory: session.directory,
    fn: () => Prompt.resume({ sessionID: session.id }),
  })
}

export function PermissionsRoutes() {
  const app = new Hono<AppEnv>()

  app.get("/requests", async (c) => {
    const query = ListRequestsQuery.safeParse({
      status: c.req.query("status"),
      sessionID: c.req.query("sessionID"),
      view: c.req.query("view"),
    })
    if (!query.success) {
      throw new ApiError(400, "INVALID_QUERY", "Query parameters must include an optional valid status and sessionID")
    }

    return c.json({
      success: true,
      data: query.data.view === "full"
        ? await Permission.listRequests(query.data)
        : await Permission.listRequestPrompts(query.data),
      requestId: c.get("requestId"),
    })
  })

  app.get("/requests/:id", async (c) => {
    const id = c.req.param("id")
    const request = await Permission.getRequest(id)
    if (!request) {
      throw new ApiError(404, "PERMISSION_REQUEST_NOT_FOUND", `Permission request '${id}' not found`)
    }

    return c.json({
      success: true,
      data: request,
      requestId: c.get("requestId"),
    })
  })

  app.post("/requests/:id/approve", async (c) => {
    const id = c.req.param("id")
    const payload = LegacyRespondBody.safeParse(await c.req.json().catch(() => ({})))
    if (!payload.success) {
      throw new ApiError(400, "INVALID_PAYLOAD", "Body must contain a valid approval response")
    }

    const resolved = await Permission.resolveRequest(id, {
      decision: decisionFromLegacy(true),
      note: payload.data.reason,
    }).catch((error) => {
      throw new ApiError(400, "PERMISSION_REQUEST_RESOLUTION_FAILED", error instanceof Error ? error.message : String(error))
    })

    const resumed = await resumeSessionIfReady({
      resume: payload.data.resume,
      sessionID: resolved.request.sessionID,
    })

    return c.json({
      success: true,
      data: {
        ...resolved,
        request: await Permission.getRequestPrompt(resolved.request.id),
        resumed,
      },
      requestId: c.get("requestId"),
    })
  })

  app.post("/requests/:id/deny", async (c) => {
    const id = c.req.param("id")
    const payload = LegacyRespondBody.safeParse(await c.req.json().catch(() => ({})))
    if (!payload.success) {
      throw new ApiError(400, "INVALID_PAYLOAD", "Body must contain a valid denial response")
    }

    const resolved = await Permission.resolveRequest(id, {
      decision: decisionFromLegacy(false),
      note: payload.data.reason,
    }).catch((error) => {
      throw new ApiError(400, "PERMISSION_REQUEST_RESOLUTION_FAILED", error instanceof Error ? error.message : String(error))
    })

    const resumed = await resumeSessionIfReady({
      resume: payload.data.resume,
      sessionID: resolved.request.sessionID,
    })

    return c.json({
      success: true,
      data: {
        ...resolved,
        request: await Permission.getRequestPrompt(resolved.request.id),
        resumed,
      },
      requestId: c.get("requestId"),
    })
  })

  app.post("/requests/:id/resolve", async (c) => {
    const id = c.req.param("id")
    const payload = ResolveBody.safeParse(await c.req.json().catch(() => ({})))
    if (!payload.success) {
      throw new ApiError(400, "INVALID_PAYLOAD", "Body must contain a valid permission decision")
    }

    const resolved = await Permission.resolveRequest(id, {
      decision: payload.data.decision,
      note: payload.data.note,
    }).catch((error) => {
      throw new ApiError(400, "PERMISSION_REQUEST_RESOLUTION_FAILED", error instanceof Error ? error.message : String(error))
    })

    const resumed = await resumeSessionIfReady({
      resume: payload.data.resume,
      sessionID: resolved.request.sessionID,
    })

    return c.json({
      success: true,
      data: {
        ...resolved,
        request: await Permission.getRequestPrompt(resolved.request.id),
        resumed,
      },
      requestId: c.get("requestId"),
    })
  })

  return app
}
