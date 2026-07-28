import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import "./sqlite.cleanup.ts"
import * as Identifier from "#id/id.ts"
import * as Sqlite from "#database/Sqlite.ts"
import * as Message from "#session/core/message.ts"
import * as Prompt from "#session/core/prompt.ts"
import * as Session from "#session/core/session.ts"
import { z } from "zod"

const LegacyUserMessage = z.object({
  id: z.string(),
  sessionID: z.string(),
  role: z.literal("user"),
  created: z.number(),
  agent: z.string(),
  model: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }),
})

const LegacyAssistantMessage = z.object({
  id: z.string(),
  sessionID: z.string(),
  role: z.literal("assistant"),
  created: z.number(),
  agent: z.string(),
  parentID: z.string(),
  modelID: z.string(),
  providerID: z.string(),
  path: z.object({
    cwd: z.string(),
    root: z.string(),
  }),
  cost: z.number(),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    reasoning: z.number(),
    cache: z.object({
      read: z.number(),
      write: z.number(),
    }),
  }),
})

const LegacyMessageInfo = z.discriminatedUnion("role", [LegacyUserMessage, LegacyAssistantMessage])

const LegacySessionInfo = z.object({
  id: Identifier.schema("session"),
  projectID: z.string(),
  directory: z.string(),
  title: z.string(),
  version: z.string(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})

async function removeWithRetry(target: string, attempts = 10) {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      Bun.gc(true)
      await rm(target, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      await Bun.sleep(50 * (attempt + 1))
    }
  }

  throw lastError
}

function tableColumns(tableName: string) {
  return Sqlite.db
    .prepare(`PRAGMA table_info("${tableName}")`)
    .all()
    .map((row) => (row as { name: string }).name)
}

function makeLegacySession(id = Identifier.descending("session")) {
  return {
    id,
    projectID: "project-tree",
    directory: "/tmp/project-tree",
    title: "Tree history",
    version: "test",
    time: {
      created: 1,
      updated: 1,
    },
  }
}

function makeSession(id = Identifier.descending("session")): Session.SessionInfo {
  return Session.SessionInfo.parse(makeLegacySession(id))
}

function makeUserMessage(input: {
  id?: string
  sessionID: string
  created: number
  parentMessageID?: string | null
}): Message.User {
  return Message.User.parse({
    id: input.id ?? Identifier.ascending("message"),
    sessionID: input.sessionID,
    parentMessageID: input.parentMessageID,
    role: "user",
    created: input.created,
    agent: "default",
    model: {
      providerID: "test-provider",
      modelID: "test-model",
    },
  })
}

function makeLegacyAssistantMessage(input: {
  id?: string
  sessionID: string
  created: number
}) {
  return LegacyAssistantMessage.parse({
    id: input.id ?? Identifier.ascending("message"),
    sessionID: input.sessionID,
    role: "assistant",
    created: input.created,
    agent: "default",
    parentID: "",
    modelID: "test-model",
    providerID: "test-provider",
    path: {
      cwd: "/tmp/project-tree",
      root: "/tmp/project-tree",
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

test("MessageInfo accepts legacy messages without turnID", () => {
  const message = Message.MessageInfo.parse({
    id: Identifier.ascending("message"),
    sessionID: Identifier.ascending("session"),
    role: "user",
    created: Date.now(),
    agent: "default",
    model: {
      providerID: "test-provider",
      modelID: "test-model",
    },
  })

  expect(message.turnID).toBeUndefined()
})

test("existing messages union table can add nullable turnID and read old rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-turn-schema-"))
  const databaseFile = join(root, "turn-schema.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)
    Sqlite.createTableByZodDiscriminatedUnion("messages", LegacyMessageInfo)
    expect(tableColumns("messages")).not.toContain("turnID")

    Sqlite.syncTableColumnsWithZodDiscriminatedUnion("messages", Message.MessageInfo)
    expect(tableColumns("messages")).toContain("turnID")

    const userMessage = Message.User.parse({
      id: Identifier.ascending("message"),
      sessionID: Identifier.ascending("session"),
      role: "user",
      created: Date.now(),
      agent: "default",
      model: {
        providerID: "test-provider",
        modelID: "test-model",
      },
    })

    Sqlite.insertOneWithSchema("messages", userMessage, Message.MessageInfo)
    const found = Sqlite.findById("messages", Message.MessageInfo, userMessage.id)

    expect(found?.id).toBe(userMessage.id)
    expect(found?.turnID).toBeUndefined()
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})

test("legacy session migration backfills a single message chain and active head", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-message-tree-backfill-"))
  const databaseFile = join(root, "message-tree-backfill.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)
    Sqlite.createTableByZodObject("sessions", LegacySessionInfo)
    Sqlite.createTableByZodDiscriminatedUnion("messages", LegacyMessageInfo)

    const session = makeLegacySession()
    const first = makeUserMessage({ sessionID: session.id, created: 1 })
    const second = makeLegacyAssistantMessage({ sessionID: session.id, created: 2 })
    const third = makeUserMessage({ sessionID: session.id, created: 3 })

    Sqlite.insertOneWithSchema("sessions", session, LegacySessionInfo)
    Sqlite.insertOneWithSchema("messages", first, LegacyMessageInfo)
    Sqlite.insertOneWithSchema("messages", second, LegacyMessageInfo)
    Sqlite.insertOneWithSchema("messages", third, LegacyMessageInfo)

    const migratedSession = Session.DataBaseRead("sessions", session.id) as Session.SessionInfo | null
    const migratedMessages = Sqlite.findManyWithSchema("messages", Message.MessageInfo, {
      where: [{ column: "sessionID", value: session.id }],
      orderBy: [
        { column: "created", direction: "ASC" },
        { column: "id", direction: "ASC" },
      ],
    })

    expect(tableColumns("sessions")).toContain("activeMessageID")
    expect(tableColumns("messages")).toContain("parentMessageID")
    expect(migratedSession?.activeMessageID).toBe(third.id)
    expect(migratedMessages.map((message) => message.parentMessageID ?? null)).toEqual([
      null,
      first.id,
      second.id,
    ])
    expect(migratedMessages[1]?.role === "assistant" ? migratedMessages[1].parentID : undefined).toBe(first.id)
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})

test("active branch history follows parentMessageID from the session head", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-message-tree-active-"))
  const databaseFile = join(root, "message-tree-active.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)
    const session = makeSession()
    Session.DataBaseCreate("sessions", session)

    const rootMessage = makeUserMessage({ sessionID: session.id, created: 1, parentMessageID: null })
    const sharedMessage = makeUserMessage({ sessionID: session.id, created: 2, parentMessageID: rootMessage.id })
    const inactiveMessage = makeUserMessage({ sessionID: session.id, created: 3, parentMessageID: sharedMessage.id })
    const activeMessage = makeUserMessage({ sessionID: session.id, created: 4, parentMessageID: sharedMessage.id })

    Session.upsertMessage(rootMessage)
    Session.upsertMessage(sharedMessage)
    Session.upsertMessage(inactiveMessage)
    Session.upsertMessage(activeMessage)
    Session.updateActiveMessageID(session.id, activeMessage.id)

    expect(Message.listActiveBranch(session.id).map((message) => message.info.id)).toEqual([
      rootMessage.id,
      sharedMessage.id,
      activeMessage.id,
    ])
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})

test("listBranch resolves any head strictly and rejects invalid tree edges", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-message-tree-branch-"))
  const databaseFile = join(root, "message-tree-branch.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)
    const session = makeSession()
    const otherSession = makeSession()
    Session.DataBaseCreate("sessions", session)
    Session.DataBaseCreate("sessions", otherSession)

    const rootMessage = makeUserMessage({ sessionID: session.id, created: 1, parentMessageID: null })
    const firstLeaf = makeUserMessage({ sessionID: session.id, created: 2, parentMessageID: rootMessage.id })
    const secondLeaf = makeUserMessage({ sessionID: session.id, created: 3, parentMessageID: rootMessage.id })
    Session.upsertMessage(rootMessage)
    Session.upsertMessage(firstLeaf)
    Session.upsertMessage(secondLeaf)

    expect(Message.listBranch(session.id, secondLeaf.id).map((message) => message.info.id)).toEqual([
      rootMessage.id,
      secondLeaf.id,
    ])

    const missingHead = makeUserMessage({
      sessionID: session.id,
      created: 4,
      parentMessageID: Identifier.ascending("message"),
    })
    Session.upsertMessage(missingHead)
    expect(() => Message.listBranch(session.id, missingHead.id)).toThrow("references missing message")

    const otherMessage = makeUserMessage({ sessionID: otherSession.id, created: 1, parentMessageID: null })
    const crossSessionHead = makeUserMessage({
      sessionID: session.id,
      created: 5,
      parentMessageID: otherMessage.id,
    })
    Session.upsertMessage(otherMessage)
    Session.upsertMessage(crossSessionHead)
    expect(() => Message.listBranch(session.id, crossSessionHead.id)).toThrow("belongs to a different session")

    const cycleRoot = makeUserMessage({ sessionID: session.id, created: 6 })
    const cycleHead = makeUserMessage({ sessionID: session.id, created: 7, parentMessageID: cycleRoot.id })
    Session.upsertMessage({ ...cycleRoot, parentMessageID: cycleHead.id })
    Session.upsertMessage(cycleHead)
    expect(() => Message.listBranch(session.id, cycleHead.id)).toThrow("contains a cycle")
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})

test("detached prompt targets reject invalid parents before an execution is accepted", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-detached-parent-validation-"))
  const databaseFile = join(root, "detached-parent-validation.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)
    const session = makeSession()
    const otherSession = makeSession()
    Session.DataBaseCreate("sessions", session)
    Session.DataBaseCreate("sessions", otherSession)

    const crossSessionParent = makeUserMessage({
      sessionID: otherSession.id,
      created: 1,
      parentMessageID: null,
    })
    const internalParent = Message.User.parse({
      ...makeUserMessage({
        sessionID: session.id,
        created: 2,
        parentMessageID: null,
      }),
      internal: true,
    })
    Session.recordMessage(crossSessionParent)
    Session.recordMessage(internalParent)

    const promptInput = (parentMessageID: string) => ({
      sessionID: session.id,
      executionID: `branch-${parentMessageID}`,
      threadTarget: {
        kind: "detached-branch" as const,
        parentMessageID,
      },
      parts: [{ type: "text" as const, text: "Inspect this branch." }],
    })

    expect(() =>
      Prompt.promptExecution(promptInput(Identifier.ascending("message"))),
    ).toThrow("was not found")
    expect(() =>
      Prompt.promptExecution(promptInput(crossSessionParent.id)),
    ).toThrow("same session")
    expect(() =>
      Prompt.promptExecution(promptInput(internalParent.id)),
    ).toThrow("Internal messages")
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})

test("recordActiveMessage advances the main head while recordMessage stays side-effect free", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-message-tree-record-"))
  const databaseFile = join(root, "message-tree-record.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)
    const session = makeSession()
    Session.DataBaseCreate("sessions", session)

    const first = makeUserMessage({ sessionID: session.id, created: 1, parentMessageID: null })
    const second = makeUserMessage({ sessionID: session.id, created: 2, parentMessageID: first.id })

    Session.recordActiveMessage(first)
    expect(Session.getActiveMessageID(session.id)).toBe(first.id)

    Session.recordActiveMessage(second)
    expect(Session.getActiveMessageID(session.id)).toBe(second.id)

    const detached = makeUserMessage({ sessionID: session.id, created: 3, parentMessageID: first.id })
    Session.recordMessage(detached)
    expect(Session.getActiveMessageID(session.id)).toBe(second.id)

    Session.recordActiveMessage({
      ...first,
      displayText: "Updated old message",
    })

    expect(Session.getActiveMessageID(session.id)).toBe(second.id)
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})

test("invalid active branch links fall back to linear history", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-message-tree-fallback-"))
  const databaseFile = join(root, "message-tree-fallback.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)

    const missingParentSession = makeSession()
    Session.DataBaseCreate("sessions", missingParentSession)
    const missingRoot = makeUserMessage({ sessionID: missingParentSession.id, created: 1, parentMessageID: null })
    const missingHead = makeUserMessage({
      sessionID: missingParentSession.id,
      created: 2,
      parentMessageID: Identifier.ascending("message"),
    })
    Session.upsertMessage(missingRoot)
    Session.upsertMessage(missingHead)
    Session.updateActiveMessageID(missingParentSession.id, missingHead.id)
    expect(Message.listActiveBranch(missingParentSession.id).map((message) => message.info.id)).toEqual([
      missingRoot.id,
      missingHead.id,
    ])

    const cycleSession = makeSession()
    Session.DataBaseCreate("sessions", cycleSession)
    const cycleRoot = makeUserMessage({ sessionID: cycleSession.id, created: 1 })
    const cycleHead = makeUserMessage({ sessionID: cycleSession.id, created: 2, parentMessageID: cycleRoot.id })
    const cycleRootLinked = { ...cycleRoot, parentMessageID: cycleHead.id } satisfies Message.User
    Session.upsertMessage(cycleRootLinked)
    Session.upsertMessage(cycleHead)
    Session.updateActiveMessageID(cycleSession.id, cycleHead.id)
    expect(Message.listActiveBranch(cycleSession.id).map((message) => message.info.id)).toEqual([
      cycleRoot.id,
      cycleHead.id,
    ])

    const otherSession = makeSession()
    const crossSession = makeSession()
    Session.DataBaseCreate("sessions", otherSession)
    Session.DataBaseCreate("sessions", crossSession)
    const otherMessage = makeUserMessage({ sessionID: otherSession.id, created: 1, parentMessageID: null })
    const crossRoot = makeUserMessage({ sessionID: crossSession.id, created: 1, parentMessageID: null })
    const crossHead = makeUserMessage({ sessionID: crossSession.id, created: 2, parentMessageID: otherMessage.id })
    Session.upsertMessage(otherMessage)
    Session.upsertMessage(crossRoot)
    Session.upsertMessage(crossHead)
    Session.updateActiveMessageID(crossSession.id, crossHead.id)
    expect(Message.listActiveBranch(crossSession.id).map((message) => message.info.id)).toEqual([
      crossRoot.id,
      crossHead.id,
    ])
  } finally {
    Sqlite.closeDatabase()
    Sqlite.setDatabaseFile(undefined)
    await removeWithRetry(root)
  }
})
