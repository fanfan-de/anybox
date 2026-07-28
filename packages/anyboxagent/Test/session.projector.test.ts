import { expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { Instance } from "#project/instance.ts"
import * as db from "#database/Sqlite.ts"
import * as Identifier from "#id/id.ts"
import * as Permission from "#permission/schema.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as LiveStreamHub from "#session/runtime/live-stream-hub.ts"
import * as Message from "#session/core/message.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import * as Session from "#session/core/session.ts"
import * as ToolResultPersistence from "#session/support/tool-result-persistence.ts"

test("runtime events project messages and parts into the session read model", async () => {
  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const session = await Session.createSession({
        directory: Instance.directory,
        projectID: Instance.project.id,
      })

      const userMessage = Message.User.parse({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        created: Date.now(),
        agent: "plan",
        model: {
          providerID: "test-provider",
          modelID: "test-model",
        },
      })

      const userPart = Message.TextPart.parse({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: userMessage.id,
        type: "text",
        text: "hello",
      })

      const assistantMessage = Message.Assistant.parse({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "assistant",
        created: Date.now(),
        parentID: userMessage.id,
        modelID: "test-model",
        providerID: "test-provider",
        agent: "plan",
        path: {
          cwd: Instance.directory,
          root: Instance.worktree,
        },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
      })

      const completedAssistant = Message.Assistant.parse({
        ...assistantMessage,
        finishReason: "stop",
      })

      const streamedTextID = Identifier.ascending("part")
      const streamedText = Message.TextPart.parse({
        id: streamedTextID,
        sessionID: session.id,
        messageID: assistantMessage.id,
        type: "text",
        text: "world",
        time: {
          start: Date.now(),
          end: Date.now(),
        },
        metadata: {
          source: "projector-test",
        },
      })

      const patchPart = Message.PatchPart.parse({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: assistantMessage.id,
        type: "patch",
        hash: "snapshot-hash",
        files: ["README.md"],
      })
      const sourcePart = Message.SourceUrlPart.parse({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: assistantMessage.id,
        type: "source-url",
        sourceID: "source-projector",
        url: "https://example.com/spec",
        title: "Spec reference",
      })
      const generatedFilePart = Message.FilePart.parse({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: assistantMessage.id,
        type: "file",
        mime: "application/json",
        filename: "report.json",
        url: "data:application/json;base64,e30=",
      })

      const approvalID = "approval-projector"
      const permissionAsk = Message.PermissionPart.parse({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: assistantMessage.id,
        type: "permission",
        approvalID,
        toolCallID: "tool-approval",
        tool: "replace_text",
        action: "ask",
        created: Date.now(),
      })
      const permissionAllow = Message.PermissionPart.parse({
        ...permissionAsk,
        id: Identifier.ascending("part"),
        action: "allow",
      })
      const permissionRequest = Permission.Request.parse({
        id: Identifier.ascending("permission"),
        approvalID,
        sessionID: session.id,
        messageID: assistantMessage.id,
        toolCallID: "tool-approval",
        projectID: Instance.project.id,
        agent: "plan",
        tool: "replace_text",
        toolKind: "write",
        risk: "medium",
        status: "pending",
        input: {
          path: "README.md",
        },
        createdAt: Date.now(),
      })
      const resolvedRequest = Permission.Request.parse({
        ...permissionRequest,
        status: "approved",
        resolvedAt: Date.now(),
        resolution: {
          decision: "allow",
          approved: true,
          resolvedAt: Date.now(),
        },
      })

      const turn = Orchestrator.startTurn({
        sessionID: session.id,
        userMessageID: userMessage.id,
        agent: userMessage.agent,
        model: userMessage.model,
      })

      try {
        turn.emit("message.recorded", {
          message: userMessage,
        })
        turn.emit("part.recorded", {
          part: userPart,
        })
        turn.emit("message.recorded", {
          message: assistantMessage,
        })
        turn.emit("text.part.started", {
          messageID: assistantMessage.id,
          partID: streamedTextID,
          kind: "text",
          text: "",
          metadata: {
            source: "projector-test",
          },
        })
        turn.emit("text.part.delta", {
          messageID: assistantMessage.id,
          partID: streamedTextID,
          kind: "text",
          delta: "world",
          metadata: {
            source: "projector-test",
          },
        })
        turn.emit("text.part.completed", {
          part: streamedText,
        })
        turn.emit("patch.generated", {
          part: patchPart,
        })
        turn.emit("source.recorded", {
          part: sourcePart,
        })
        turn.emit("file.generated", {
          part: generatedFilePart,
        })
        expect(db.findById("parts", Message.Part, streamedText.id)).toMatchObject({
          id: streamedText.id,
          text: "world",
        })
        expect(db.findById("parts", Message.Part, sourcePart.id)).toMatchObject({ id: sourcePart.id })
        expect(db.findById("parts", Message.Part, generatedFilePart.id)).toMatchObject({ id: generatedFilePart.id })

        turn.emit("message.recorded", {
          message: completedAssistant,
        })
        turn.emit("part.recorded", {
          part: streamedText,
        })
        turn.emit("part.recorded", {
          part: sourcePart,
        })
        turn.emit("part.recorded", {
          part: generatedFilePart,
        })
        turn.emit("permission.requested", {
          request: permissionRequest,
          part: permissionAsk,
        })
        turn.emit("permission.resolved", {
          request: resolvedRequest,
          part: permissionAllow,
        })
        turn.emit("part.removed", {
          partID: patchPart.id,
          messageID: assistantMessage.id,
        })
        turn.emit("turn.completed", {
          status: "completed",
          finishReason: "stop",
          message: completedAssistant,
          parts: [streamedText],
        })
      } finally {
        Orchestrator.finishTurn(turn)
      }

      const messages = db.findManyWithSchema("messages", Message.MessageInfo, {
        where: [{ column: "sessionID", value: session.id }],
        orderBy: [{ column: "created", direction: "ASC" }],
      })
      expect(messages).toHaveLength(2)
      expect(messages[1]).toMatchObject({
        id: assistantMessage.id,
        finishReason: "stop",
      })

      const persistedUserPart = db.findById("parts", Message.Part, userPart.id)
      expect(persistedUserPart).toMatchObject({
        id: userPart.id,
        text: "hello",
      })

      const persistedAssistantText = db.findById("parts", Message.Part, streamedTextID)
      expect(persistedAssistantText).toMatchObject({
        id: streamedTextID,
        type: "text",
        text: "world",
      })
      const persistedSource = db.findById("parts", Message.Part, sourcePart.id)
      expect(persistedSource).toMatchObject({
        id: sourcePart.id,
        type: "source-url",
        title: "Spec reference",
      })
      const persistedGeneratedFile = db.findById("parts", Message.Part, generatedFilePart.id)
      expect(persistedGeneratedFile).toMatchObject({
        id: generatedFilePart.id,
        type: "file",
        filename: "report.json",
      })

      const projectedPermissionRequest = db.findById("permission_requests", Permission.Request, permissionRequest.id)
      expect(projectedPermissionRequest).toMatchObject({
        id: permissionRequest.id,
        status: "approved",
        resolution: {
          decision: "allow",
          approved: true,
        },
      })

      const removedPatch = db.findById("parts", Message.Part, patchPart.id)
      expect(removedPatch).toBeNull()

      EventStore.appendSessionEvent(session.id, "message.removed", { messageID: userMessage.id })
      expect(db.findById("messages", Message.MessageInfo, userMessage.id)).toBeNull()
      expect(db.findById("parts", Message.Part, userPart.id)).toBeNull()
    },
  })
})

test("detached branch message events never advance the session active head", async () => {
  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const session = await Session.createSession({
        directory: Instance.directory,
        projectID: Instance.project.id,
      })
      const activeMessage = Message.User.parse({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        created: Date.now(),
        agent: "plan",
        model: {
          providerID: "test-provider",
          modelID: "test-model",
        },
      })
      Session.recordActiveMessage(activeMessage)

      const detachedMessage = Message.User.parse({
        ...activeMessage,
        id: Identifier.ascending("message"),
        parentMessageID: activeMessage.id,
        created: Date.now() + 1,
      })
      const turn = Orchestrator.startTurn({
        sessionID: session.id,
        executionID: "detached-projector-test",
        targetKind: "detached-branch",
        initialParentMessageID: activeMessage.id,
        userMessageID: detachedMessage.id,
        agent: detachedMessage.agent,
        model: detachedMessage.model,
      })

      try {
        turn.emit("message.recorded", {
          message: detachedMessage,
        })

        expect(Session.getActiveMessageID(session.id)).toBe(activeMessage.id)
        expect(db.findById("messages", Message.MessageInfo, detachedMessage.id)).toMatchObject({
          id: detachedMessage.id,
          parentMessageID: activeMessage.id,
        })
      } finally {
        Orchestrator.finishTurn(turn)
        Session.removeSession(session.id)
      }
    },
  })
})

test("appendAndProject is idempotent and publishes only committed events", async () => {
  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const session = await Session.createSession({
        directory: Instance.directory,
        projectID: Instance.project.id,
      })
      const turnID = Identifier.ascending("turn")
      const factory = RuntimeEvent.createRuntimeEventFactory({
        sessionID: session.id,
        turnID,
      })
      const userMessage = Message.User.parse({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        created: Date.now(),
        agent: "plan",
        model: {
          providerID: "test-provider",
          modelID: "test-model",
        },
      })
      const event = factory.next("message.recorded", {
        message: userMessage,
      })
      const subscription = LiveStreamHub.subscribe({
        sessionID: session.id,
        turnID,
        closeOnTerminalTurn: false,
      })

      try {
        EventStore.appendAndProject(event)
        EventStore.appendAndProject(event)

        const projectedMessages = db.findManyWithSchema("messages", Message.MessageInfo, {
          where: [{ column: "sessionID", value: session.id }],
        })
        expect(projectedMessages).toHaveLength(1)

        const firstPublished = await subscription.next()
        const secondPublished = await Promise.race([
          subscription.next(),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 20)),
        ])

        expect(firstPublished?.eventID).toBe(event.eventID)
        expect(secondPublished).toBeUndefined()
      } finally {
        subscription.close()
      }
    },
  })
})

test("stream delta runtime events publish immediately without event-store persistence", async () => {
  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const sessionID = Identifier.ascending("session")
      const turnID = Identifier.ascending("turn")
      const factory = RuntimeEvent.createRuntimeEventFactory({
        sessionID,
        turnID,
      })
      const deltaEvent = factory.next("text.part.delta", {
        messageID: Identifier.ascending("message"),
        partID: Identifier.ascending("part"),
        kind: "text",
        delta: "hello",
      })
      const subscription = LiveStreamHub.subscribe({
        sessionID,
        turnID,
        closeOnTerminalTurn: false,
      })

      try {
        EventStore.appendAndProject(deltaEvent)

        const published = await subscription.next()
        expect(published?.eventID).toBe(deltaEvent.eventID)

        const replayed = EventStore.listTurnEvents({
          sessionID,
          turnID,
        })
        expect(replayed.map((event) => event.eventID)).not.toContain(deltaEvent.eventID)
      } finally {
        subscription.close()
      }
    },
  })
})

test("session-scoped runtime events use a nullable turn and monotonic session sequence", async () => {
  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const session = await Session.createSession({
        directory: Instance.directory,
        projectID: Instance.project.id,
      })
      const first = EventStore.appendSessionEvent(session.id, "retry.scheduled", { attempt: 1 })
      const second = EventStore.appendSessionEvent(session.id, "retry.scheduled", { attempt: 2 })

      expect(first).toMatchObject({ schemaVersion: 2, scope: "session", turnID: null, seq: 1 })
      expect(second).toMatchObject({ schemaVersion: 2, scope: "session", turnID: null, seq: 2 })
      expect(EventStore.listSessionEvents({ sessionID: session.id }).map((event) => ({
        turnID: event.turnID,
        seq: event.seq,
      }))).toEqual([
        { turnID: null, seq: 1 },
        { turnID: null, seq: 2 },
      ])
    },
  })
})

test("session-scoped sequence remains monotonic when trace insertion fails", async () => {
  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const session = await Session.createSession({
        directory: Instance.directory,
        projectID: Instance.project.id,
      })

      EventStore.setTraceInsertFailureForTest(true)
      const first = EventStore.appendSessionEvent(session.id, "retry.scheduled", { attempt: 1 })
      EventStore.setTraceInsertFailureForTest(false)
      try {
        const second = EventStore.appendSessionEvent(session.id, "retry.scheduled", { attempt: 2 })
        expect(first.seq).toBe(1)
        expect(second.seq).toBe(2)
        expect(EventStore.listSessionEvents({ sessionID: session.id }).map((event) => event.seq)).toEqual([2])
      } finally {
        EventStore.setTraceInsertFailureForTest(false)
      }
    },
  })
})

test("stream boundary runtime events persist for trace replay", async () => {
  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const sessionID = Identifier.ascending("session")
      const turnID = Identifier.ascending("turn")
      const messageID = Identifier.ascending("message")
      const textPartID = Identifier.ascending("part")
      const reasoningPartID = Identifier.ascending("part")
      const factory = RuntimeEvent.createRuntimeEventFactory({
        sessionID,
        turnID,
      })
      const events = [
        factory.next("text.part.started", {
          messageID,
          partID: textPartID,
          kind: "text",
          text: "",
        }),
        factory.next("text.part.completed", {
          part: Message.TextPart.parse({
            id: textPartID,
            sessionID,
            messageID,
            type: "text",
            text: "hello",
            time: {
              start: 1,
              end: 2,
            },
          }),
        }),
        factory.next("reasoning.part.started", {
          messageID,
          partID: reasoningPartID,
          kind: "reasoning",
          text: "",
        }),
        factory.next("reasoning.part.completed", {
          part: Message.ReasoningPart.parse({
            id: reasoningPartID,
            sessionID,
            messageID,
            type: "reasoning",
            text: "why",
            time: {
              start: 3,
              end: 4,
            },
          }),
        }),
      ]

      for (const event of events) {
        EventStore.appendAndProject(event)
      }

      const replayed = EventStore.listTurnEvents({
        sessionID,
        turnID,
      })
      expect(replayed.map((event) => event.type)).toEqual([
        "text.part.started",
        "text.part.completed",
        "reasoning.part.started",
        "reasoning.part.completed",
      ])
    },
  })
})

test("trace insertion failures do not roll back canonical messages or live publication", async () => {
  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const session = await Session.createSession({
        directory: Instance.directory,
        projectID: Instance.project.id,
      })
      const turnID = Identifier.ascending("turn")
      const factory = RuntimeEvent.createRuntimeEventFactory({ sessionID: session.id, turnID })
      const message = Message.User.parse({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "user",
        created: Date.now(),
        agent: "plan",
        model: { providerID: "test-provider", modelID: "test-model" },
      })
      const event = factory.next("message.recorded", { message })
      const subscription = LiveStreamHub.subscribe({
        sessionID: session.id,
        turnID,
        closeOnTerminalTurn: false,
      })

      EventStore.setTraceInsertFailureForTest(true)
      try {
        expect(() => EventStore.appendAndProject(event)).not.toThrow()
        expect(db.findById("messages", Message.MessageInfo, message.id)).toMatchObject({ id: message.id })
        expect(EventStore.listTurnEvents({ sessionID: session.id, turnID })).toHaveLength(0)
        expect((await subscription.next())?.eventID).toBe(event.eventID)
        expect(EventStore.traceStoreHealth().insertFailures).toBeGreaterThan(0)
      } finally {
        EventStore.setTraceInsertFailureForTest(false)
        subscription.close()
      }
    },
  })
})

test("terminal events repair missing final messages and parts", async () => {
  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const session = await Session.createSession({
        directory: Instance.directory,
        projectID: Instance.project.id,
      })
      const turnID = Identifier.ascending("turn")
      const factory = RuntimeEvent.createRuntimeEventFactory({ sessionID: session.id, turnID })
      EventStore.appendAndProject(factory.next("turn.started", {}))
      const message = Message.Assistant.parse({
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "assistant",
        created: Date.now(),
        parentID: "msg-user-terminal",
        modelID: "test-model",
        providerID: "test-provider",
        agent: "plan",
        path: { cwd: Instance.directory, root: Instance.worktree },
        cost: 0,
        tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        finishReason: "stop",
      })
      const part = Message.TextPart.parse({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: message.id,
        type: "text",
        text: "repaired final answer",
      })

      EventStore.appendAndProject(factory.next("turn.completed", {
        status: "completed",
        finishReason: "stop",
        message,
        parts: [part],
      }))

      expect(db.findById("messages", Message.MessageInfo, message.id)).toMatchObject({
        id: message.id,
        finishReason: "stop",
      })
      expect(db.findById("parts", Message.Part, part.id)).toMatchObject({
        id: part.id,
        text: "repaired final answer",
      })
      expect(Session.DataBaseRead("turns", turnID)).toMatchObject({
        id: turnID,
        status: "completed",
        lastMessageID: message.id,
      })
    },
  })
})

test("persisted trace payloads stay below 32 KiB and do not duplicate large tool output", async () => {
  await Instance.provide({
    directory: process.cwd(),
    async fn() {
      const session = await Session.createSession({
        directory: Instance.directory,
        projectID: Instance.project.id,
      })
      try {
        const fullOutput = `${"large-tool-output ".repeat(8_000)}unique-secret-tail`
        const persisted = await ToolResultPersistence.maybePersistToolResult({
          sessionID: session.id,
          toolCallID: "call-large-trace",
          toolName: "large-tool",
          output: fullOutput,
          metadata: {},
          modelOutput: { type: "text", value: fullOutput },
        })
        const part = Message.ToolPart.parse({
          id: Identifier.ascending("part"),
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
          type: "tool",
          callID: "call-large-trace",
          tool: "large-tool",
          state: {
            status: "completed",
            input: {},
            output: persisted.output,
            modelOutput: persisted.modelOutput,
            title: "Large tool",
            metadata: persisted.metadata,
            time: { start: 1, end: 2 },
            attachments: persisted.attachments,
          },
        })
        const turnID = Identifier.ascending("turn")
        const event = RuntimeEvent.createRuntimeEventFactory({ sessionID: session.id, turnID })
          .next("tool.call.completed", { part })
        EventStore.appendAndProject(event)

        const row = db.db.prepare(`SELECT "payload" FROM "session_events" WHERE "eventID" = ?`).get(event.eventID) as {
          payload: string
        }
        expect(Buffer.byteLength(row.payload, "utf8")).toBeLessThanOrEqual(32 * 1024)
        expect(row.payload).not.toContain("unique-secret-tail")
        const canonical = db.findById("parts", Message.Part, part.id)
        expect(JSON.stringify(canonical)).not.toContain("unique-secret-tail")
        expect(JSON.stringify(canonical)).toContain("persisted-tool-output")
      } finally {
        ToolResultPersistence.removeSessionOutputDirectory(session.id)
      }
    },
  })
})
