import { test, expect } from "bun:test"
import "./sqlite.cleanup.ts"
import { $ } from "bun"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import z from "zod"
import { createServerApp } from "#server/server.ts"
import * as Config from "#config/config.ts"
import { Instance } from "#project/instance.ts"
import * as Identifier from "#id/id.ts"
import * as Permission from "#permission/permission.ts"
import * as Message from "#session/core/message.ts"
import * as Session from "#session/core/session.ts"
import * as db from "#database/Sqlite.ts"

interface JsonEnvelope<T = Record<string, unknown>> {
  success: boolean
  requestId?: string
  data?: T
  error?: {
    code: string
    message: string
  }
}

type PermissionRequestRecord = z.infer<typeof Permission.Request>

type PermissionRequestResponse = JsonEnvelope<{
  request: PermissionRequestRecord
  resumed?: unknown
}>

type PermissionRequestListResponse = JsonEnvelope<PermissionRequestRecord[]>
type ToolPermissionModeResponse = JsonEnvelope<{
  mode: "default" | "full_access"
}>

async function createGitRepo(root: string, seed: string) {
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, "README.md"), `# ${seed}\n`)
  await $`git init`.cwd(root).quiet()
  await $`git config user.email test@example.com`.cwd(root).quiet()
  await $`git config user.name anybox-test`.cwd(root).quiet()
  await $`git add README.md`.cwd(root).quiet()
  await $`git commit -m init`.cwd(root).quiet()
}

async function createApprovalRequest(repositoryRoot: string, targetPath: string) {
  return Instance.provide({
    directory: repositoryRoot,
    async fn() {
      const session = await Session.createSession({
        directory: Instance.directory,
        projectID: Instance.project.id,
      })

      const assistant: Message.Assistant = {
        id: Identifier.ascending("message"),
        sessionID: session.id,
        role: "assistant",
        created: Date.now(),
        parentID: "",
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
      }

      Session.DataBaseCreate("messages", assistant)

      const toolPart = Message.ToolPart.parse({
        id: Identifier.ascending("part"),
        sessionID: session.id,
        messageID: assistant.id,
        type: "tool",
        callID: `toolcall_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tool: "read_file",
        schemaVersion: 3,
        turnID: "turn-test",
        input: { raw: JSON.stringify({
            path: targetPath,
          }), value: {
            path: targetPath,
          } },
        source: { kind: "model" },
        retry: { attempt: 1 },
        revision: 1,
        timestamps: { createdAt: Date.now(), approvalRequestedAt: Date.now() },
        presentation: { title: "Read File" },
        state: { phase: "waiting-approval", approval: { id: `approval_${Date.now()}_${Math.random().toString(16).slice(2)}` } },
      })

      await Session.updatePart(toolPart)

      const request = await Permission.registerApprovalRequest({
        assistant,
        toolPart,
      })

      return {
        request,
        sessionID: session.id,
        messageID: assistant.id,
        toolCallID: toolPart.callID,
      }
    },
  })
}

async function createAdditionalApprovalRequest(
  repositoryRoot: string,
  input: {
    messageID: string
    sessionID: string
    targetPath: string
  },
) {
  return Instance.provide({
    directory: repositoryRoot,
    async fn() {
      const assistant = Session.DataBaseRead("messages", input.messageID) as Message.Assistant | null
      if (!assistant) {
        throw new Error(`Assistant message '${input.messageID}' not found.`)
      }

      const toolPart = Message.ToolPart.parse({
        id: Identifier.ascending("part"),
        sessionID: input.sessionID,
        messageID: assistant.id,
        type: "tool",
        callID: `toolcall_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        tool: "read_file",
        schemaVersion: 3,
        turnID: "turn-test",
        input: { raw: JSON.stringify({
            path: input.targetPath,
          }), value: {
            path: input.targetPath,
          } },
        source: { kind: "model" },
        retry: { attempt: 1 },
        revision: 1,
        timestamps: { createdAt: Date.now(), approvalRequestedAt: Date.now() },
        presentation: { title: "Read File" },
        state: { phase: "waiting-approval", approval: { id: `approval_${Date.now()}_${Math.random().toString(16).slice(2)}` } },
      })

      await Session.updatePart(toolPart)

      const request = await Permission.registerApprovalRequest({
        assistant,
        toolPart,
      })

      return {
        request,
        sessionID: input.sessionID,
        messageID: assistant.id,
        toolCallID: toolPart.callID,
      }
    },
  })
}

function findToolPart(messageID: string, toolCallID: string) {
  const parts = db.findManyWithSchema("parts", Message.Part, {
    where: [{ column: "messageID", value: messageID }],
  })

  return parts.find(
    (part): part is Message.ToolPart => part.type === "tool" && part.callID === toolCallID,
  )
}

test("permission api approves a waiting tool request and completes the tool part", async () => {
  const app = createServerApp()
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-permission-api-approve-"))

  try {
    await createGitRepo(repositoryRoot, "permission-api-approve")
    const seeded = await createApprovalRequest(repositoryRoot, "README.md")

    const approveResponse = await app.request(
      `http://localhost/api/permissions/requests/${seeded.request.id}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    )
    const approveBody = (await approveResponse.json()) as PermissionRequestResponse

    expect(approveResponse.status).toBe(200)
    expect(approveBody.success).toBe(true)
    expect(approveBody.data?.request.status).toBe("approved")

    const requestResponse = await app.request(
      `http://localhost/api/permissions/requests/${seeded.request.id}`,
    )
    const requestBody = (await requestResponse.json()) as JsonEnvelope<PermissionRequestRecord>

    expect(requestResponse.status).toBe(200)
    expect(requestBody.data?.status).toBe("approved")

    const listResponse = await app.request(
      `http://localhost/api/permissions/requests?sessionID=${seeded.sessionID}`,
    )
    const listBody = (await listResponse.json()) as PermissionRequestListResponse

    expect(listResponse.status).toBe(200)
    expect(listBody.data?.some((request) => request.id === seeded.request.id)).toBe(true)

    const fullListResponse = await app.request(
      `http://localhost/api/permissions/requests?sessionID=${seeded.sessionID}&view=full`,
    )
    const fullListBody = (await fullListResponse.json()) as PermissionRequestListResponse
    const listedFullRequest = fullListBody.data?.find((request) => request.id === seeded.request.id)

    expect(fullListResponse.status).toBe(200)
    expect(listedFullRequest?.input).toEqual({
      path: "README.md",
    })

    const toolPart = findToolPart(seeded.messageID, seeded.toolCallID)
    expect(toolPart?.state.phase).toBe("settled")
    if (toolPart?.state.phase === "settled" && toolPart.state.outcome.kind === "returned") {
      expect(String(toolPart.state.outcome.output)).toContain("README.md")
    } else {
      throw new Error("Expected the approved tool call to return.")
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
}, 120000)

test("permission api defers resume while another approval request is still pending", async () => {
  const app = createServerApp()
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-permission-api-multiple-approval-"))

  try {
    await createGitRepo(repositoryRoot, "permission-api-multiple-approval")
    const first = await createApprovalRequest(repositoryRoot, "README.md")
    const second = await createAdditionalApprovalRequest(repositoryRoot, {
      messageID: first.messageID,
      sessionID: first.sessionID,
      targetPath: "README.md",
    })

    const approveResponse = await app.request(
      `http://localhost/api/permissions/requests/${first.request.id}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision: "allow",
          resume: true,
        }),
      },
    )
    const approveBody = (await approveResponse.json()) as PermissionRequestResponse

    expect(approveResponse.status).toBe(200)
    expect(approveBody.success).toBe(true)
    expect(approveBody.data?.request.status).toBe("approved")
    expect(approveBody.data?.resumed).toBeUndefined()

    const pendingRequests = await Permission.listRequests({
      sessionID: first.sessionID,
      status: "pending",
    })

    expect(pendingRequests.map((request) => request.id)).toEqual([second.request.id])
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
}, 120000)

test("permission api deny marks the tool part denied without creating persisted rules", async () => {
  const app = createServerApp()
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-permission-api-deny-"))

  try {
    await createGitRepo(repositoryRoot, "permission-api-deny")
    const seeded = await createApprovalRequest(repositoryRoot, "README.md")

    const denyResponse = await app.request(
      `http://localhost/api/permissions/requests/${seeded.request.id}/deny`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Need explicit review first.",
        }),
      },
    )
    const denyBody = (await denyResponse.json()) as PermissionRequestResponse

    expect(denyResponse.status).toBe(200)
    expect(denyBody.success).toBe(true)
    expect(denyBody.data?.request.status).toBe("denied")
    expect("rule" in (denyBody.data ?? {})).toBe(false)

    const toolPart = findToolPart(seeded.messageID, seeded.toolCallID)
    expect(toolPart?.state.phase).toBe("settled")
    if (toolPart?.state.phase === "settled" && toolPart.state.outcome.kind === "denied") {
      expect(toolPart.state.outcome.reason).toContain("Need explicit review first.")
    } else {
      throw new Error("Expected the tool call to be denied.")
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
}, 120000)

test("permission api approval keeps tool history consistent when the approved execution fails", async () => {
  const app = createServerApp()
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "anybox-permission-api-error-"))

  try {
    await createGitRepo(repositoryRoot, "permission-api-error")
    const seeded = await createApprovalRequest(repositoryRoot, "missing.txt")

    const approveResponse = await app.request(
      `http://localhost/api/permissions/requests/${seeded.request.id}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    )
    const approveBody = (await approveResponse.json()) as PermissionRequestResponse

    expect(approveResponse.status).toBe(200)
    expect(approveBody.success).toBe(true)
    expect(approveBody.data?.request.status).toBe("approved")

    const toolPart = findToolPart(seeded.messageID, seeded.toolCallID)
    expect(toolPart?.state.phase).toBe("settled")
    if (toolPart?.state.phase === "settled" && toolPart.state.outcome.kind === "failed") {
      expect(toolPart.state.outcome.error.message).toContain("missing.txt")
    } else {
      throw new Error("Expected the approved tool call to fail.")
    }
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true })
  }
}, 120000)

test("settings api reads, updates, and validates the tool permission mode", async () => {
  const app = createServerApp()

  try {
    await Config.setPermissionMode(Config.GLOBAL_CONFIG_ID, "default")

    const defaultResponse = await app.request("http://localhost/api/tools/permission-mode")
    const defaultBody = (await defaultResponse.json()) as ToolPermissionModeResponse

    expect(defaultResponse.status).toBe(200)
    expect(defaultBody.success).toBe(true)
    expect(defaultBody.data?.mode).toBe("default")

    const updateResponse = await app.request("http://localhost/api/tools/permission-mode", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "full_access" }),
    })
    const updateBody = (await updateResponse.json()) as ToolPermissionModeResponse

    expect(updateResponse.status).toBe(200)
    expect(updateBody.success).toBe(true)
    expect(updateBody.data?.mode).toBe("full_access")

    const invalidResponse = await app.request("http://localhost/api/tools/permission-mode", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "unknown" }),
    })
    const invalidBody = (await invalidResponse.json()) as JsonEnvelope

    expect(invalidResponse.status).toBe(400)
    expect(invalidBody.success).toBe(false)
  } finally {
    await Config.setPermissionMode(Config.GLOBAL_CONFIG_ID, "default")
  }
}, 120000)
