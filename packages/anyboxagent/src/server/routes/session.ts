import { Hono } from "hono"
import z from "zod"
import { ok, parseJsonBody } from "#server/http.ts"
import { ApiError } from "#server/error.ts"
import type { AppEnv } from "#server/types.ts"
import type { PtyRegistry } from "#pty/registry.ts"
import * as SessionUseCase from "#server/usecases/session.ts"
import * as ImageAssets from "#session/support/image-assets.ts"
import { computerUseBroker } from "#mcp/computer-use/broker.ts"

const InterruptComputerUseBody = z.object({
  turnID: z.string().trim().min(1),
}).strict()

export { createSessionExecutionStream } from "#server/usecases/session.ts"

export function SessionRoutes(options: { ptyRegistry: PtyRegistry }) {
  const app = new Hono<AppEnv>()

  app.get("/", (c) =>
    ok(c, {
      hint: "Use POST /api/sessions with { directory } to create a session",
    }),
  )

  app.post("/", async (c) => {
    const payload = await parseJsonBody(
      c,
      SessionUseCase.CreateSessionBody,
      "Body must include a non-empty 'directory'",
    )
    return ok(c, await SessionUseCase.createSession(payload), 201)
  })

  app.get("/archived", (c) => ok(c, SessionUseCase.listArchivedSessions()))

  app.post("/:id/archive", (c) => ok(c, SessionUseCase.archiveSession(c.req.param("id"), options)))

  app.post("/archived/:id/restore", (c) => ok(c, SessionUseCase.restoreArchivedSession(c.req.param("id"))))

  app.delete("/archived/:id", (c) => ok(c, SessionUseCase.deleteArchivedSession(c.req.param("id"))))

  app.post("/:id/side-chats", async (c) => {
    const payload = await parseJsonBody(
      c,
      SessionUseCase.CreateSideChatBody,
      "Body must include a non-empty 'anchorMessageID'",
    )
    return ok(c, await SessionUseCase.createSideChat(c.req.param("id"), payload), 201)
  })

  app.get("/:id/side-chats", (c) =>
    ok(
      c,
      SessionUseCase.listSideChats(
        c.req.param("id"),
        c.req.query("anchorMessageID")?.trim() || undefined,
      ),
    ),
  )

  app.get("/:id/side-chat-link", (c) => ok(c, SessionUseCase.getSideChatLink(c.req.param("id"))))

  app.get("/:id/side-chat-context", (c) => ok(c, SessionUseCase.getSideChatContext(c.req.param("id"))))

  app.get("/:id/pty", (c) => ok(c, SessionUseCase.getSessionPty(c.req.param("id"), options)))

  app.post("/:id/pty", async (c) => ok(c, await SessionUseCase.createSessionPty(c.req.param("id"), options), 201))

  app.get("/:id/tasks", (c) =>
    ok(
      c,
      SessionUseCase.listSessionTasks(c.req.param("id"), {
        owner: c.req.query("owner"),
        status: c.req.query("status"),
        includeCompleted: c.req.query("includeCompleted"),
      }),
    ),
  )

  app.get("/:id/tasks/:taskID", (c) =>
    ok(c, SessionUseCase.getSessionTask(c.req.param("id"), c.req.param("taskID"))),
  )

  app.get("/:id", (c) => ok(c, SessionUseCase.getSession(c.req.param("id"))))

  app.patch("/:id/active-message", async (c) => {
    const payload = await parseJsonBody(
      c,
      SessionUseCase.UpdateSessionActiveMessageBody,
      "Body must include a non-empty 'messageID'",
    )
    return ok(c, SessionUseCase.updateSessionActiveMessage(c.req.param("id"), payload))
  })

  app.post("/:id/rollback", async (c) => {
    const payload = await parseJsonBody(
      c,
      SessionUseCase.RollbackSessionBody,
      "Body must include targetMessageID, reason, and correctivePrompt",
    )
    return ok(c, await SessionUseCase.rollbackSessionToCheckpoint(c.req.param("id"), payload))
  })

  app.get("/:id/models", async (c) => ok(c, await SessionUseCase.listSessionModels(c.req.param("id"))))

  app.patch("/:id/model-selection", async (c) => {
    const payload = await parseJsonBody(
      c,
      SessionUseCase.UpdateSessionModelSelectionBody,
      "Body must contain nullable 'model' and 'small_model' fields",
    )
    return ok(c, await SessionUseCase.updateSessionModelSelection(c.req.param("id"), payload))
  })

  app.post("/:id/compact", async (c) => ok(c, await SessionUseCase.compactSession(c.req.param("id"))))

  app.patch("/:id/title", async (c) => {
    const payload = await parseJsonBody(
      c,
      SessionUseCase.UpdateSessionTitleBody,
      "Body must include a non-empty 'title'",
    )
    return ok(c, SessionUseCase.updateSessionTitle(c.req.param("id"), payload))
  })

  app.patch("/:id/pinned", async (c) => {
    const payload = await parseJsonBody(
      c,
      SessionUseCase.UpdateSessionPinnedBody,
      "Body must include a boolean 'pinned'",
    )
    return ok(c, SessionUseCase.updateSessionPinned(c.req.param("id"), payload))
  })

  app.patch("/:id/workflow", async (c) => {
    const payload = await parseJsonBody(
      c,
      SessionUseCase.UpdateSessionWorkflowBody,
      "Body must contain a valid workflow action.",
    )
    return ok(c, SessionUseCase.updateSessionWorkflow(c.req.param("id"), payload))
  })

  app.get("/:id/messages", async (c) =>
    ok(c, await SessionUseCase.listSessionMessages(c.req.param("id"), {
      view: c.req.query("view"),
    })),
  )

  app.get("/:id/assets/:assetID", async (c) => {
    let result: Awaited<ReturnType<typeof ImageAssets.readImageAsset>>
    try {
      result = await ImageAssets.readImageAsset(c.req.param("id"), c.req.param("assetID"))
    } catch (error) {
      if (error instanceof Error && error.message === "Invalid asset id.") {
        throw new ApiError(400, "INVALID_IMAGE_ASSET_ID", error.message)
      }
      throw new ApiError(404, "IMAGE_ASSET_NOT_FOUND", `Image asset '${c.req.param("assetID")}' was not found`)
    }
    c.header("content-type", result.metadata.mime)
    c.header("cache-control", "private, max-age=31536000, immutable")
    c.header("x-content-type-options", "nosniff")
    return c.body(result.file.stream())
  })

  app.get("/:id/diff", async (c) => ok(c, await SessionUseCase.getSessionDiff(c.req.param("id"), {
    scope: c.req.query("scope"),
  })))

  app.post("/:id/cancel", async (c) => {
    const payload = await parseJsonBody(
      c,
      SessionUseCase.CancelSessionBody,
      "Body must include optional cancelQueued and reason fields",
      {},
    )
    return ok(c, await SessionUseCase.cancelSession(c.req.param("id"), payload))
  })

  app.post("/:id/computer-use/interrupt", async (c) => {
    const payload = await parseJsonBody(
      c,
      InterruptComputerUseBody,
      "Body must include the active turnID.",
    )
    return ok(c, {
      interrupted: computerUseBroker().interrupt(
        {
          sessionID: c.req.param("id"),
          turnID: payload.turnID,
        },
        "desktop-escape",
      ),
    })
  })

  app.post("/:id/questions/answer", async (c) => {
    const payload = await parseJsonBody(
      c,
      SessionUseCase.AnswerSessionQuestionBody,
      "Body must include a questionID and an answer",
    )
    return ok(c, SessionUseCase.answerSessionQuestion(c.req.param("id"), payload))
  })

  app.delete("/:id", async (c) =>
    ok(c, await SessionUseCase.deleteSession(c.req.param("id"), options)))

  app.get("/:id/events/stream", (c) =>
    SessionUseCase.createEventStreamResponse({
      sessionID: c.req.param("id"),
      requestId: c.get("requestId"),
      replayCursor: c.req.query("since") ?? c.req.header("last-event-id"),
    }),
  )

  app.post("/:id/messages/stream", async (c) => {
    const payload = await parseJsonBody(
      c,
      SessionUseCase.StreamSessionMessageBody,
      "Body must include a non-empty 'text' or at least one attachment",
    )
    return SessionUseCase.createMessageStreamResponse({
      sessionID: c.req.param("id"),
      payload,
      requestId: c.get("requestId"),
      replayTurnID: c.req.query("turnID"),
      sinceSeq: c.req.query("sinceSeq"),
      signal: c.req.raw.signal,
    })
  })

  app.post("/:id/resume/stream", (c) =>
    SessionUseCase.createResumeStreamResponse({
      sessionID: c.req.param("id"),
      requestId: c.get("requestId"),
      replayTurnID: c.req.query("turnID"),
      sinceSeq: c.req.query("sinceSeq"),
      signal: c.req.raw.signal,
    }),
  )

  return app
}
