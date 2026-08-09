import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import "./sqlite.cleanup.ts"
import * as Identifier from "#id/id.ts"
import { Instance } from "#project/instance.ts"
import * as Message from "#session/core/message.ts"
import * as SessionRollback from "#session/core/rollback.ts"
import * as Session from "#session/core/session.ts"
import * as Snapshot from "#snapshot/snapshot.ts"
import { ListRollbackCheckpointsTool } from "#tool/list-rollback-checkpoints.ts"
import { RollbackToCheckpointTool } from "#tool/rollback-to-checkpoint.ts"

const hasGit = spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0
const testIfGit = hasGit ? test : test.skip

function modelRef() {
  return {
    providerID: "test-provider",
    modelID: "test-model",
  }
}

async function createTestSession(directory = "/tmp/rollback-test") {
  return Session.createSession({
    directory,
    projectID: `project-${Identifier.ascending("message")}`,
    title: "Rollback test",
  })
}

function makeUser(input: {
  sessionID: string
  parentMessageID?: string | null
  internal?: boolean
  turnID?: string
}) {
  return Message.User.parse({
    id: Identifier.ascending("message"),
    sessionID: input.sessionID,
    turnID: input.turnID,
    parentMessageID: input.parentMessageID,
    role: "user",
    created: Date.now(),
    agent: "default",
    model: modelRef(),
    internal: input.internal,
  })
}

function makeAssistant(input: {
  sessionID: string
  parentMessageID: string
  turnID?: string
}) {
  return Message.Assistant.parse({
    id: Identifier.ascending("message"),
    sessionID: input.sessionID,
    turnID: input.turnID,
    parentMessageID: input.parentMessageID,
    role: "assistant",
    created: Date.now(),
    parentID: input.parentMessageID,
    modelID: "test-model",
    providerID: "test-provider",
    agent: "default",
    path: {
      cwd: "/tmp/rollback-test",
      root: "/tmp/rollback-test",
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
}

function makeTextPart(input: {
  sessionID: string
  messageID: string
  text: string
}) {
  return Message.TextPart.parse({
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "text",
    text: input.text,
  })
}

function makeSnapshotPart(input: {
  sessionID: string
  messageID: string
  snapshot: string
}) {
  return Message.SnapshotPart.parse({
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "snapshot",
    snapshot: input.snapshot,
  })
}

function writeMessage(message: Message.MessageInfo, parts: Message.Part[] = []) {
  Session.upsertMessage(message)
  for (const part of parts) {
    Session.upsertPart(part)
  }
}

async function fileExists(file: string) {
  return stat(file).then(
    () => true,
    () => false,
  )
}

describe("rollback_to_checkpoint", () => {
  test("creates a corrective assistant branch from a historical assistant message", async () => {
    const session = await createTestSession()
    const rootUser = makeUser({ sessionID: session.id, parentMessageID: null })
    const targetAssistant = makeAssistant({ sessionID: session.id, parentMessageID: rootUser.id })
    const wrongUser = makeUser({ sessionID: session.id, parentMessageID: targetAssistant.id })
    const wrongAssistant = makeAssistant({ sessionID: session.id, parentMessageID: wrongUser.id })

    writeMessage(rootUser, [makeTextPart({ sessionID: session.id, messageID: rootUser.id, text: "Start" })])
    writeMessage(targetAssistant, [
      makeTextPart({ sessionID: session.id, messageID: targetAssistant.id, text: "Base answer" }),
    ])
    writeMessage(wrongUser)
    writeMessage(wrongAssistant)
    Session.updateActiveMessageID(session.id, wrongAssistant.id)

    const result = await SessionRollback.createCorrectiveBranch({
      sessionID: session.id,
      targetMessageID: targetAssistant.id,
      reason: "Assumed the wrong field name.",
      correctivePrompt: "Use id instead of userId.",
    })

    expect(Session.getActiveMessageID(session.id)).toBe(result.assistantMessage.id)
    expect(result.assistantMessage.parentMessageID).toBe(targetAssistant.id)
    expect(result.assistantMessage.parentID).toBe(targetAssistant.id)
    expect(result.assistantMessage.modelID).toBe(rootUser.model.modelID)
    expect(result.assistantMessage.providerID).toBe(rootUser.model.providerID)
    expect(result.assistantMessage.finishReason).toBeUndefined()
    expect(result.textPart.metadata).toMatchObject({
      kind: "rollback-correction",
      targetMessageID: targetAssistant.id,
      restoreWorkspace: false,
    })
    expect(Message.listActiveBranch(session.id).map((message) => message.info.id)).toEqual([
      rootUser.id,
      targetAssistant.id,
      result.assistantMessage.id,
    ])
    expect(Message.listAllWithParts(session.id).map((message) => message.info.id)).toContain(wrongAssistant.id)
  })

  test("rejects invalid rollback targets", async () => {
    const session = await createTestSession()
    const other = await createTestSession()
    const rootUser = makeUser({ sessionID: session.id, parentMessageID: null })
    const internalUser = makeUser({ sessionID: session.id, parentMessageID: rootUser.id, internal: true })
    const otherMessage = makeUser({ sessionID: other.id, parentMessageID: null })
    writeMessage(rootUser)
    writeMessage(internalUser)
    writeMessage(otherMessage)

    await expect(SessionRollback.createCorrectiveBranch({
      sessionID: session.id,
      targetMessageID: Identifier.ascending("message"),
      reason: "Missing target.",
      correctivePrompt: "Try again.",
    })).rejects.toThrow("was not found")

    await expect(SessionRollback.createCorrectiveBranch({
      sessionID: session.id,
      targetMessageID: otherMessage.id,
      reason: "Cross session.",
      correctivePrompt: "Try again.",
    })).rejects.toThrow("must belong to the current session")

    await expect(SessionRollback.createCorrectiveBranch({
      sessionID: session.id,
      targetMessageID: internalUser.id,
      reason: "Internal target.",
      correctivePrompt: "Try again.",
    })).rejects.toThrow("Internal messages cannot be used")
  })

  test("tool returns workflow-control metadata and model output", async () => {
    const session = await createTestSession()
    const user = makeUser({ sessionID: session.id, parentMessageID: null })
    const assistant = makeAssistant({ sessionID: session.id, parentMessageID: user.id, turnID: Identifier.ascending("turn") })
    writeMessage(user)
    writeMessage(assistant)
    Session.updateActiveMessageID(session.id, assistant.id)

    const runtime = await RollbackToCheckpointTool.init()
    const permission = await runtime.assessPermission?.({
      targetMessageID: user.id,
      reason: "Bad path.",
      correctivePrompt: "Use the other path.",
    }, {
      sessionID: session.id,
      messageID: assistant.id,
    })
    expect(permission).toMatchObject({
      action: "allow",
      risk: "low",
      allowInPlanning: true,
    })

    const result = await runtime.execute({
      targetMessageID: user.id,
      reason: "Bad path.",
      correctivePrompt: "Use the other path.",
    }, {
      sessionID: session.id,
      messageID: assistant.id,
    })
    expect(result.metadata).toMatchObject({
      kind: "workflow-control",
      action: "rollback-to-checkpoint",
      restartLoop: true,
      targetMessageID: user.id,
      restoreWorkspace: false,
    })
    expect(result.control).toEqual({
      mode: "restart-loop",
      reason: "The active session head moved to a corrective branch.",
    })

    const modelOutput = await runtime.toModelOutput?.(result)
    expect(modelOutput).toEqual({
      type: "json",
      value: expect.objectContaining({
        kind: "workflow-control",
        action: "rollback-to-checkpoint",
        restartLoop: true,
        targetMessageID: user.id,
        restoreWorkspace: false,
      }),
    })

    const restorePermission = await runtime.assessPermission?.({
      targetMessageID: user.id,
      reason: "Bad files.",
      correctivePrompt: "Restore first.",
      restoreWorkspace: true,
    }, {
      sessionID: session.id,
      messageID: assistant.id,
      cwd: "/tmp/rollback-test",
      worktree: "/tmp/rollback-test",
    })
    expect(restorePermission).toMatchObject({
      action: "ask",
      risk: "high",
      forceAsk: true,
    })
  })

  test("lists rollback checkpoints for model target selection", async () => {
    const session = await createTestSession()
    const rootUser = makeUser({ sessionID: session.id, parentMessageID: null })
    const activeAssistant = makeAssistant({ sessionID: session.id, parentMessageID: rootUser.id })
    const activeUser = makeUser({ sessionID: session.id, parentMessageID: activeAssistant.id })
    const activeLeaf = makeAssistant({ sessionID: session.id, parentMessageID: activeUser.id })
    const inactiveUser = makeUser({ sessionID: session.id, parentMessageID: activeAssistant.id })
    const inactiveLeaf = makeAssistant({ sessionID: session.id, parentMessageID: inactiveUser.id })
    const internalUser = makeUser({ sessionID: session.id, parentMessageID: activeLeaf.id, internal: true })

    writeMessage(rootUser, [
      makeTextPart({ sessionID: session.id, messageID: rootUser.id, text: "Root request" }),
      makeSnapshotPart({ sessionID: session.id, messageID: rootUser.id, snapshot: "snapshot-root" }),
    ])
    writeMessage(activeAssistant, [
      makeTextPart({ sessionID: session.id, messageID: activeAssistant.id, text: "Shared answer" }),
    ])
    writeMessage(activeUser, [
      makeTextPart({ sessionID: session.id, messageID: activeUser.id, text: "Wrong follow up" }),
    ])
    writeMessage(activeLeaf, [
      makeTextPart({ sessionID: session.id, messageID: activeLeaf.id, text: "Wrong answer" }),
    ])
    writeMessage(inactiveUser, [
      makeTextPart({ sessionID: session.id, messageID: inactiveUser.id, text: "Inactive follow up" }),
    ])
    writeMessage(inactiveLeaf, [
      makeTextPart({ sessionID: session.id, messageID: inactiveLeaf.id, text: "Inactive answer" }),
    ])
    writeMessage(internalUser)
    Session.updateActiveMessageID(session.id, activeLeaf.id)

    const activeOnly = SessionRollback.listRollbackCheckpoints({ sessionID: session.id })
    expect(activeOnly.activeMessageID).toBe(activeLeaf.id)
    expect(activeOnly.checkpoints.map((checkpoint) => checkpoint.messageID)).toEqual([
      rootUser.id,
      activeAssistant.id,
      activeUser.id,
      activeLeaf.id,
    ])
    expect(activeOnly.checkpoints.every((checkpoint) => checkpoint.activePath)).toBe(true)
    expect(activeOnly.checkpoints.every((checkpoint) => checkpoint.canRestoreWorkspace)).toBe(true)
    expect(activeOnly.checkpoints[0]).toMatchObject({
      messageID: rootUser.id,
      role: "user",
      preview: "Root request",
      snapshotMessageID: rootUser.id,
      snapshotSource: "user-snapshot",
    })

    const withInactive = SessionRollback.listRollbackCheckpoints({
      sessionID: session.id,
      includeInactive: true,
    })
    expect(withInactive.checkpoints.map((checkpoint) => checkpoint.messageID)).toContain(inactiveLeaf.id)
    expect(withInactive.checkpoints.find((checkpoint) => checkpoint.messageID === inactiveLeaf.id)?.activePath).toBe(false)
    expect(withInactive.checkpoints.map((checkpoint) => checkpoint.messageID)).not.toContain(internalUser.id)

    const runtime = await ListRollbackCheckpointsTool.init()
    const permission = await runtime.assessPermission?.({}, {
      sessionID: session.id,
      messageID: activeLeaf.id,
    })
    expect(permission).toMatchObject({
      action: "allow",
      risk: "low",
      allowInPlanning: true,
    })

    const output = await runtime.execute({ includeInactive: true, limit: 2 }, {
      sessionID: session.id,
      messageID: activeLeaf.id,
    })
    expect(output.metadata).toMatchObject({
      kind: "rollback-checkpoints",
      sessionID: session.id,
      truncated: true,
    })
    expect(output.data?.checkpoints).toHaveLength(2)

    const modelOutput = await runtime.toModelOutput?.(output)
    expect(modelOutput).toMatchObject({
      type: "json",
      value: {
        sessionID: session.id,
        activeMessageID: activeLeaf.id,
        truncated: true,
      },
    })
  })

  testIfGit("restores workspace files before creating a corrective branch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-rollback-restore-"))

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          await mkdir(path.join(root, "src"), { recursive: true })
          const existingFile = path.join(root, "src", "app.txt")
          const newFile = path.join(root, "src", "new.txt")
          await writeFile(existingFile, "before\n", "utf8")
          const snapshot = await Snapshot.track()
          if (!snapshot) {
            throw new Error("Expected snapshot to be captured.")
          }

          const session = await createTestSession(root)
          const user = makeUser({ sessionID: session.id, parentMessageID: null })
          writeMessage(user, [
            makeSnapshotPart({
              sessionID: session.id,
              messageID: user.id,
              snapshot,
            }),
          ])
          Session.updateActiveMessageID(session.id, user.id)

          await writeFile(existingFile, "after\n", "utf8")
          await writeFile(newFile, "new\n", "utf8")

          const runtime = await RollbackToCheckpointTool.init()
          const result = await runtime.execute({
            targetMessageID: user.id,
            reason: "Wrong file edits.",
            correctivePrompt: "Restart from the clean snapshot.",
            restoreWorkspace: true,
          }, {
            sessionID: session.id,
            messageID: user.id,
            cwd: root,
            worktree: root,
          })

          expect(await readFile(existingFile, "utf8")).toBe("before\n")
          expect(await fileExists(newFile)).toBe(false)
          expect(result.metadata).toMatchObject({
            action: "rollback-to-checkpoint",
            restoreWorkspace: true,
            targetSnapshot: snapshot,
          })
          expect((result.metadata?.restoredFiles as string[] | undefined)?.sort()).toEqual([
            existingFile,
            newFile,
          ].sort())
          expect(Message.listActiveBranch(session.id).at(-1)?.info.role).toBe("assistant")
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  testIfGit("does not create a branch when workspace restore has no snapshot", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "anybox-rollback-missing-snapshot-"))

    try {
      await Instance.provide({
        directory: root,
        async fn() {
          await $`git init`.cwd(root).quiet()
          const session = await createTestSession(root)
          const user = makeUser({ sessionID: session.id, parentMessageID: null })
          writeMessage(user)
          Session.updateActiveMessageID(session.id, user.id)
          const countBefore = Message.listAllWithParts(session.id).length

          const runtime = await RollbackToCheckpointTool.init()
          await expect(runtime.execute({
            targetMessageID: user.id,
            reason: "Need missing snapshot.",
            correctivePrompt: "Do not create a branch.",
            restoreWorkspace: true,
          }, {
            sessionID: session.id,
            messageID: user.id,
            cwd: root,
            worktree: root,
          })).rejects.toThrow("No rollback snapshot was found")

          expect(Message.listAllWithParts(session.id)).toHaveLength(countBefore)
          expect(Session.getActiveMessageID(session.id)).toBe(user.id)
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
