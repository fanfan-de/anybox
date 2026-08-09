import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import z from "zod"
import "./sqlite.cleanup.ts"
import * as Agent from "#agent/agent.ts"
import * as Sqlite from "#database/Sqlite.ts"
import { Instance } from "#project/instance.ts"
import * as Identifier from "#id/id.ts"
import * as Message from "#session/core/message.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as RuntimeEvent from "#session/runtime/runtime-event.ts"
import { resolveTools } from "#session/core/resolve-tools.ts"
import * as Session from "#session/core/session.ts"
import * as ToolResultPersistence from "#session/support/tool-result-persistence.ts"
import { ReadFileTool } from "#tool/read-file.ts"
import * as Tool from "#tool/tool.ts"
import * as ToolRegistry from "#tool/registry.ts"

const testModel = {
  id: "test-model",
  providerID: "test-provider",
  capabilities: {
    replayAssistantReasoning: false,
    attachment: false,
    input: {
      image: false,
      pdf: false,
    },
  },
} as any

const cleanupSessions = new Set<string>()

async function removeTreeWithRetry(target: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "EBUSY" || attempt === 4) throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

afterEach(async () => {
  for (const sessionID of cleanupSessions) {
    ToolResultPersistence.removeSessionOutputDirectory(sessionID)
  }
  cleanupSessions.clear()
  await Instance.disposeAll().catch(() => undefined)
  Sqlite.setDatabaseFile()
  Sqlite.closeDatabase()
})

test("makePreview prefers a nearby newline boundary", () => {
  const text = `${"a".repeat(900)}\n${"b".repeat(2_000)}`
  const preview = ToolResultPersistence.makePreview(text, 1_200)
  expect(preview.endsWith("\n")).toBe(false)
  expect(preview).toBe("a".repeat(900))
  expect(ToolResultPersistence.makeSafeFileSegment("..")).toMatch(/^tool_[a-f0-9]{16}$/)
})

test("maybePersistToolResult writes large output and keeps Infinity below the hard byte cap", async () => {
  const sessionID = "ses_persist_unit"
  cleanupSessions.add(sessionID)
  const large = `${"alpha ".repeat(9_000)}tail-marker`

  const persisted = await ToolResultPersistence.maybePersistToolResult({
    sessionID,
    toolCallID: "tool/call:1",
    toolName: "unit-tool",
    output: large,
    metadata: {
      stdout: large,
      keep: "small",
    },
    modelOutput: {
      type: "text",
      value: large,
    },
    maxResultSizeChars: 1_000,
  })

  expect(persisted.output).toContain("<persisted-output>")
  expect(persisted.output).not.toContain("tail-marker")
  expect(persisted.persisted?.path).toBeDefined()
  expect(existsSync(persisted.persisted?.path ?? "")).toBe(true)
  expect(persisted.modelOutput).toBeUndefined()
  expect(persisted.metadata.keep).toBe("small")
  expect(String(persisted.metadata.stdout)).toContain("omitted from context")

  const passthrough = await ToolResultPersistence.maybePersistToolResult({
    sessionID,
    toolCallID: "tool-call-2",
    toolName: "unit-tool",
    output: "x".repeat(52_000),
    metadata: {},
    modelOutput: undefined,
    maxResultSizeChars: Infinity,
  })

  expect(passthrough.output).toBe("x".repeat(52_000))
  expect(passthrough.persisted).toBeUndefined()

  const hardCapped = await ToolResultPersistence.maybePersistToolResult({
    sessionID,
    toolCallID: "tool-call-3",
    toolName: "unit-tool",
    output: "ok",
    metadata: {},
    modelOutput: {
      type: "json",
      value: "x".repeat(70_000),
    },
    maxResultSizeChars: Infinity,
  })
  expect(hardCapped.output).toContain("<persisted-output>")
  expect(hardCapped.persisted?.originalSizeBytes).toBeGreaterThan(64 * 1024)
})

test("short text with large structured data and data URL attachments is externalized once", async () => {
  const sessionID = "ses_persist_structured"
  cleanupSessions.add(sessionID)
  const imageBytes = Buffer.from("image-bytes/with-standard-base64")
  const imageDataURL = `data:image/png;base64,${imageBytes.toString("base64")}`
  const persisted = await ToolResultPersistence.maybePersistToolResult({
    sessionID,
    toolCallID: "tool-structured",
    toolName: "structured-tool",
    output: "ok",
    metadata: { keep: "small" },
    modelOutput: undefined,
    data: {
      structured: "s".repeat(6 * 1024 * 1024),
    },
    attachments: [{
      url: imageDataURL,
      mime: "image/png",
      filename: "preview.png",
    }],
  })

  expect(persisted.output).toContain("<persisted-output>")
  expect(persisted.data).toBeUndefined()
  expect(JSON.stringify(persisted)).not.toContain(imageDataURL)
  expect(persisted.attachments?.[0]?.url.startsWith("data:")).toBe(false)
  expect(existsSync(persisted.attachments?.[0]?.url ?? "")).toBe(true)
  const manifest = JSON.parse(await readFile(persisted.persisted?.manifestPath ?? "", "utf8"))
  expect(manifest.files.filter((file: { kind: string }) => file.kind === "result")).toHaveLength(1)
  expect(manifest.files.some((file: { kind: string; sha256: string }) =>
    file.kind === "attachment" && file.sha256.length === 64)).toBe(true)
})

test("resolveTools persists large tool output before the processor sees it", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-wrapper-persist-"))
  const sessionID = "ses_wrapper_persist"
  cleanupSessions.add(sessionID)
  const large = `${"wrapper-output ".repeat(5_000)}secret-tail`
  let toModelOutputCalled = false

  try {
    await Instance.provide({
      directory: root,
      async fn() {
        const registry = await ToolRegistry.state()
        registry.custom.push(
          Tool.define(
            "large-wrapper-tool",
            async () => ({
              description: "Test-only large output tool.",
              parameters: z.object({}),
              execute: async () => ({
                text: large,
                title: "Large Wrapper Tool",
                metadata: {
                  stdout: large,
                  keep: "small",
                },
                data: {
                  leaked: "secret-tail",
                },
              }),
              toModelOutput: async () => {
                toModelOutputCalled = true
                return {
                  type: "json" as const,
                  value: {
                    leaked: "secret-tail",
                  },
                }
              },
            }),
            {
              maxResultSizeChars: 1_000,
              capabilities: {
                kind: "read",
                readOnly: true,
                destructive: false,
                concurrency: "safe",
              },
            },
          ),
        )

        const agent = await Agent.get("default")
        expect(agent).toBeDefined()
        const tools = await resolveTools({
          agent: agent!,
          sessionID,
          messageID: "msg-wrapper-persist",
          abort: new AbortController().signal,
        })
        const runtimeTool = tools["large_wrapper_tool"] as any
        const output = await runtimeTool.execute({}, {
          toolCallId: "tool-wrapper-persist",
          messages: [],
        })

        expect(output.text).toContain("<persisted-output>")
        expect(output.text).not.toContain("secret-tail")
        expect(output.title).toBe("Large Wrapper Tool")
        expect(output.data).toBeUndefined()
        expect(output.metadata.keep).toBe("small")
        expect(String(output.metadata.stdout)).toContain("omitted from context")

        const persisted = ToolResultPersistence.readPersistedOutputMetadata(output.metadata)
        expect(persisted?.path).toBeDefined()
        expect(existsSync(persisted?.path ?? "")).toBe(true)
        expect(await readFile(persisted?.path ?? "", "utf8")).toContain("secret-tail")

        const modelOutput = await runtimeTool.toModelOutput({
          toolCallId: "tool-wrapper-persist",
          input: {},
          output,
        })
        expect(modelOutput).toEqual({
          type: "text",
          value: persisted?.replacement,
        })
        expect(toModelOutputCalled).toBe(false)
        expect(JSON.stringify(modelOutput)).not.toContain("secret-tail")
      },
    })
  } finally {
    await removeTreeWithRetry(root)
  }
}, 15_000)

test("resolveTools honors Infinity maxResultSizeChars opt-out", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-wrapper-passthrough-"))
  const sessionID = "ses_wrapper_passthrough"
  cleanupSessions.add(sessionID)
  const large = `${"p".repeat(52_000)}secret-tail`

  try {
    await Instance.provide({
      directory: root,
      async fn() {
        const registry = await ToolRegistry.state()
        registry.custom.push(
          Tool.define(
            "passthrough-wrapper-tool",
            async () => ({
              description: "Test-only passthrough output tool.",
              parameters: z.object({}),
              execute: async () => ({
                text: large,
                metadata: {},
              }),
            }),
            {
              maxResultSizeChars: Infinity,
              capabilities: {
                kind: "read",
                readOnly: true,
                destructive: false,
                concurrency: "safe",
              },
            },
          ),
        )

        const agent = await Agent.get("default")
        expect(agent).toBeDefined()
        const tools = await resolveTools({
          agent: agent!,
          sessionID,
          messageID: "msg-wrapper-passthrough",
          abort: new AbortController().signal,
        })
        const output = await (tools["passthrough_wrapper_tool"] as any).execute({}, {
          toolCallId: "tool-wrapper-passthrough",
          messages: [],
        })

        expect(output.text).toBe(large)
        expect(output.text).toContain("secret-tail")
        expect(ToolResultPersistence.readPersistedOutputMetadata(output.metadata)).toBeUndefined()
      },
    })
  } finally {
    await removeTreeWithRetry(root)
  }
}, 15_000)

test("read-file caps output before the persistence layer", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-read-file-no-persist-"))
  const sessionID = "ses_read_file_no_persist"
  cleanupSessions.add(sessionID)

  try {
    await writeFile(
      join(root, "large.txt"),
      Array.from({ length: 400 }, (_, index) =>
        `line ${index + 1} ${"x".repeat(120)}`,
      ).join("\n"),
    )

    await Instance.provide({
      directory: root,
      async fn() {
        const agent = await Agent.get("default")
        expect(agent).toBeDefined()
        const tools = await resolveTools({
          agent: agent!,
          sessionID,
          messageID: "msg-read-file-no-persist",
          abort: new AbortController().signal,
        })

        const output = await (tools["read_file"] as any).execute({
          file_path: "large.txt",
          startLine: 1,
          endLine: 400,
          maxOutputChars: 1_000,
        }, {
          toolCallId: "tool-read-file-no-persist",
          messages: [],
        })

        expect(output.text).toContain("content output was truncated")
        expect(output.text).not.toContain("<persisted-output>")
        expect(output.metadata.budget.truncatedByLineBudget).toBe(false)
        expect(output.metadata.budget.truncatedByCharBudget).toBe(true)
        expect(output.metadata.budget.resultPersistence).toBe("disabled")
        expect(ToolResultPersistence.readPersistedOutputMetadata(output.metadata)).toBeUndefined()
      },
    })
  } finally {
    await removeTreeWithRetry(root)
  }
}, 15_000)

test("toModelMessages replays persisted replacement instead of stored modelOutput", async () => {
  const sessionID = "ses_replay_unit"
  cleanupSessions.add(sessionID)
  const large = `${"visible ".repeat(9_000)}secret-tail`
  const persisted = await ToolResultPersistence.maybePersistToolResult({
    sessionID,
    toolCallID: "tool-replay",
    toolName: "remote-tool",
    output: large,
    metadata: {},
    modelOutput: {
      type: "json",
      value: {
        leaked: "secret-tail",
      },
    },
    maxResultSizeChars: 1_000,
  })

  const assistant = Message.Assistant.parse({
    id: "msg-replay",
    sessionID,
    role: "assistant",
    created: Date.now(),
    parentID: "msg-user",
    modelID: testModel.id,
    providerID: testModel.providerID,
    agent: "default",
    finishReason: "tool-calls",
    path: {
      cwd: ".",
      root: ".",
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
  const toolPart = Message.ToolPart.parse({
    id: "part-replay-tool",
    sessionID,
    messageID: assistant.id,
    type: "tool",
    callID: "tool-replay",
    tool: "remote-tool",
    schemaVersion: 3,
    turnID: "turn-test",
    input: { raw: JSON.stringify({
        q: "large",
      }), value: {
        q: "large",
      } },
    source: { kind: "provider" },
    retry: { attempt: 1 },
    revision: 1,
    timestamps: { createdAt: Date.now(), settledAt: Date.now() + 1 },
    state: { phase: "settled", outcome: { kind: "returned", result: "success", completeness: "complete", output: persisted.output, modelOutput: {
        type: "json",
        value: {
          leaked: "secret-tail",
        },
      }, title: "Remote Tool", metadata: persisted.metadata, execution: { sideEffect: "unknown", retry: "unknown" } }, control: { mode: "continue-model" } },
  })

  const messages = await Message.toModelMessages([
    {
      info: assistant,
      parts: [toolPart],
    },
  ], testModel)

  const serialized = JSON.stringify(messages)
  expect(serialized).toContain("<persisted-output>")
  expect(serialized).not.toContain("secret-tail")
})

test("read-file can read an absolute text file outside the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-read-root-"))
  const outside = await mkdtemp(join(tmpdir(), "anybox-read-outside-"))
  const outsideFile = join(outside, "outside.txt")
  await writeFile(outsideFile, "first\nsecond\nthird", "utf8")

  try {
    await Instance.provide({
      directory: root,
      async fn() {
        const runtime = await ReadFileTool.init()
        const result = await runtime.execute({
          path: outsideFile,
          startLine: 2,
          endLine: 2,
        }, {
          sessionID: "ses_read_outside",
          messageID: "msg-read-outside",
          cwd: Instance.directory,
          worktree: Instance.worktree,
        })

        expect(result.text).toContain(outsideFile)
        expect(result.text).toContain("2 | second")
      },
    })
  } finally {
    await removeTreeWithRetry(root)
    await removeTreeWithRetry(outside)
  }
}, 15_000)

test("archiving keeps persisted results and deleting the archive removes them", async () => {
  const root = await mkdtemp(join(tmpdir(), "anybox-persist-lifecycle-"))
  const dbRoot = await mkdtemp(join(tmpdir(), "anybox-persist-db-"))
  const databaseFile = join(dbRoot, "lifecycle.db")

  try {
    Sqlite.setDatabaseFile(databaseFile)

    await Instance.provide({
      directory: root,
      async fn() {
        const session = await Session.createSession({
          directory: Instance.directory,
          projectID: Instance.project.id,
        })
        cleanupSessions.add(session.id)

        const persisted = await ToolResultPersistence.maybePersistToolResult({
          sessionID: session.id,
          toolCallID: Identifier.ascending("part"),
          toolName: "unit-tool",
          output: "large ".repeat(9_000),
          metadata: {},
          modelOutput: undefined,
          maxResultSizeChars: 1_000,
        })

        expect(existsSync(persisted.persisted?.path ?? "")).toBe(true)
        const traceEvent = RuntimeEvent.createRuntimeEventFactory({
          sessionID: session.id,
          turnID: Identifier.ascending("turn"),
        }).next("retry.scheduled", { attempt: 1 })
        EventStore.append(traceEvent)
        expect(Session.archiveSession(session.id)).not.toBeNull()
        expect(existsSync(persisted.persisted?.path ?? "")).toBe(true)
        expect(EventStore.countSessionEvents(session.id)).toBe(1)

        expect(Session.deleteArchivedSession(session.id)).not.toBeNull()
        expect(existsSync(ToolResultPersistence.getSessionDirectory(session.id))).toBe(false)
        expect(EventStore.countSessionEvents(session.id)).toBe(0)
        cleanupSessions.delete(session.id)
      },
    })
  } finally {
    await Instance.disposeAll().catch(() => undefined)
    Sqlite.setDatabaseFile()
    Sqlite.closeDatabase()
    await removeTreeWithRetry(root)
    await removeTreeWithRetry(dbRoot).catch(() => undefined)
  }
})
