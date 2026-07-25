import fs from "node:fs/promises"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const electronState = vi.hoisted(() => ({
  userDataPath: "",
  windows: [] as Array<{
    isDestroyed: () => boolean
    webContents: {
      isDestroyed: () => boolean
      send: (channel: string, ...args: unknown[]) => void
    }
  }>,
}))

const requestAgentJSONMock = vi.hoisted(() => vi.fn())
const agentClientState = vi.hoisted(() => ({
  baseUrl: "http://127.0.0.1:4096",
}))
const desktopCloudRelayState = vi.hoisted(() => ({
  status: {
    account: {
      state: "unknown",
    },
    baseUrl: null,
    connectedAt: null,
    desktopID: null,
    enabled: false,
    pairingCode: null,
    pairingDeepLink: null,
    pairingExpiresAt: null,
    state: "disabled",
  } as any,
}))
const refreshDesktopCloudRelayPairingMock = vi.hoisted(() => vi.fn(async () => desktopCloudRelayState.status))

vi.mock("electron", () => ({
  app: {
    getName: vi.fn(() => "Anybox"),
    getPath: vi.fn(() => electronState.userDataPath),
    getVersion: vi.fn(() => "0.1.13"),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => electronState.windows),
  },
}))

vi.mock("./agent-client", () => ({
  requestAgentJSON: requestAgentJSONMock,
  resolveAgentURL: vi.fn((agentPath: string) => `${agentClientState.baseUrl}${agentPath}`),
}))

vi.mock("./safe-console", () => ({
  safeError: vi.fn(),
  safeLog: vi.fn(),
  safeWarn: vi.fn(),
}))

vi.mock("./desktop-cloud-relay-client", () => ({
  ensureDesktopCloudRelayClientRunning: vi.fn(() => desktopCloudRelayState.status),
  getDesktopCloudRelayStatus: vi.fn(() => desktopCloudRelayState.status),
  refreshDesktopCloudRelayPairing: refreshDesktopCloudRelayPairingMock,
  stopDesktopCloudRelayClient: vi.fn(),
}))

import { DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL } from "../shared/desktop-ipc-contract"
import { ensureMobileBridgeServerRunning, getMobileBridgeStatus, refreshMobilePairingCode, stopMobileBridgeServer } from "./mobile-bridge-server"

function listenOnFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
  })
}

async function readMobileJSON(baseUrl: string, route: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  const body = (await response.json()) as unknown
  return { body, response }
}

function successData<T>(body: unknown) {
  expect(body).toMatchObject({ success: true })
  return (body as { data: T }).data
}

async function readMobileText(baseUrl: string, route: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  const body = await response.text()
  return { body, response }
}

async function readNodeRequestBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

function jsonAgentResponse(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  })
  response.end(`${JSON.stringify(body)}\n`)
}

function agentOk(data: unknown) {
  return { success: true, data }
}

function createConnectOptionsDeepLink(input: { relay?: string; lan?: string; bridge?: string }) {
  const params = new URLSearchParams()
  if (input.relay) params.set("relay", input.relay)
  if (input.lan) params.set("lan", input.lan)
  if (input.bridge) params.set("bridge", input.bridge)
  return `anybox-mobile://connect-options?${params.toString()}`
}

function expectedDesktopPlatform() {
  if (process.platform === "win32") return "windows"
  if (process.platform === "darwin") return "macos"
  if (process.platform === "linux") return "linux"
  return "unknown"
}

function createMockProject(workspaceDir: string, now = Date.now()) {
  return {
    id: "project-smoke",
    kind: "git",
    name: "Smoke Project",
    repositoryRoot: workspaceDir,
    worktree: workspaceDir,
    vcs: "git",
    created: now - 20_000,
    updated: now,
    sandboxes: [],
  }
}

function createMockSession(workspaceDir: string, now = Date.now()) {
  return {
    id: "session-smoke",
    projectID: "project-smoke",
    directory: workspaceDir,
    title: "Smoke Chat",
    kind: "main",
    workflow: {
      active: false,
      status: "completed",
      updatedAt: now,
    },
    time: {
      created: now - 10_000,
      updated: now,
    },
  }
}

function createMockApproval(now = Date.now()) {
  return {
    id: "approval-smoke",
    approvalID: "approval-smoke",
    sessionID: "session-smoke",
    status: "pending",
    createdAt: now - 5_000,
    prompt: {
      title: "Allow smoke command",
      summary: "Allow the mobile bridge smoke command.",
      risk: "low",
      details: {
        command: "echo smoke",
        paths: ["README.md"],
        workdir: "C:\\Projects\\Smoke Workspace",
      },
    },
  }
}

function startAgentStub() {
  const requests: string[] = []
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1")
    requests.push(`${request.method ?? "GET"} ${requestUrl.pathname}`)

    if (requestUrl.pathname === "/api/sessions/session-smoke/messages" && request.method === "GET") {
      jsonAgentResponse(response, 200, agentOk([
        {
          info: {
            id: "message-user-smoke",
            role: "user",
            created: Date.now() - 1000,
            updated: Date.now() - 1000,
          },
          parts: [{ type: "text", text: "Hello from bridge test." }],
        },
      ]))
      return
    }

    if (requestUrl.pathname === "/api/sessions/session-smoke/messages/stream" && request.method === "POST") {
      await readNodeRequestBody(request)
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
      })
      response.write(`event: delta\ndata: ${JSON.stringify({ kind: "text", delta: "streamed smoke reply" })}\n\n`)
      response.write(`event: done\ndata: ${JSON.stringify({ generatedAt: Date.now() })}\n\n`)
      response.end()
      return
    }

    if (requestUrl.pathname === "/api/sessions/session-smoke/questions/answer" && request.method === "POST") {
      const body = JSON.parse(await readNodeRequestBody(request)) as { questionID?: string; selectedOptions?: string[] }
      jsonAgentResponse(response, 200, agentOk({
        questionID: body.questionID,
        selectedOptions: body.selectedOptions ?? [],
        answered: true,
      }))
      return
    }

    if (requestUrl.pathname === "/api/sessions/session-smoke/tasks" && request.method === "GET") {
      jsonAgentResponse(response, 200, agentOk({
        sessionID: "session-smoke",
        generatedAt: Date.now(),
        tasks: [],
        current: [],
        next: [],
        blocked: [],
        summary: {
          total: 0,
          completed: 0,
          pending: 0,
          inProgress: 0,
          blocked: 0,
        },
      }))
      return
    }

    if (requestUrl.pathname === "/api/sessions/session-smoke/models" && request.method === "GET") {
      const model = {
        id: "gpt-smoke",
        providerID: "openai",
        providerName: "OpenAI",
        name: "GPT Smoke",
        status: "active",
        available: true,
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: false,
          toolcall: true,
          input: {
            text: true,
            image: false,
            video: false,
            pdf: false,
          },
          output: {
            text: true,
            image: false,
            video: false,
            pdf: false,
          },
        },
        limit: {
          context: 128_000,
          output: 16_000,
        },
      }
      jsonAgentResponse(response, 200, agentOk({
        items: [model],
        selection: {
          model: "openai/gpt-smoke",
        },
        effectiveModel: model,
      }))
      return
    }

    if (requestUrl.pathname === "/api/sessions/session-smoke/model-selection" && request.method === "PATCH") {
      const body = JSON.parse(await readNodeRequestBody(request)) as { model?: string | null }
      jsonAgentResponse(response, 200, agentOk({
        model: body.model ?? undefined,
      }))
      return
    }

    if (requestUrl.pathname === "/api/sessions/session-smoke/cancel" && request.method === "POST") {
      jsonAgentResponse(response, 200, agentOk({ sessionID: "session-smoke", cancelled: true }))
      return
    }

    if (requestUrl.pathname === "/api/workspace-files/directory" && request.method === "GET") {
      jsonAgentResponse(response, 200, agentOk([
        {
          path: "README.md",
          name: "README.md",
          kind: "file",
          extension: ".md",
          hasChildren: false,
        },
      ]))
      return
    }

    if (requestUrl.pathname === "/api/workspace-files/file" && request.method === "GET") {
      jsonAgentResponse(response, 200, agentOk({
        path: requestUrl.searchParams.get("path") ?? "",
        content: "# Smoke\n",
      }))
      return
    }

    if (requestUrl.pathname === "/api/workspace-files/search" && request.method === "GET") {
      jsonAgentResponse(response, 200, agentOk([
        {
          path: "README.md",
          name: "README.md",
          kind: "file",
        },
      ]))
      return
    }

    jsonAgentResponse(response, 404, {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Unhandled stub route: ${requestUrl.pathname}`,
      },
    })
  })

  return new Promise<{ baseUrl: string; close: () => Promise<void>; requests: string[] }>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((closeResolve) => server.close(() => closeResolve())),
        requests,
      })
    })
  })
}

async function pairMobileDevice(baseUrl: string, name = "Android emulator") {
  const status = await getMobileBridgeStatus()
  const pairingCode = new URL(status.pairingLocalUrl ?? "").searchParams.get("code")
  expect(pairingCode).toBeTruthy()

  const paired = await readMobileJSON(baseUrl, `/api/mobile/pair?code=${encodeURIComponent(pairingCode ?? "")}`, {
    body: JSON.stringify({ name }),
    method: "POST",
  })
  expect(paired.response.status).toBe(200)
  return successData<{ device: { id: string; name: string; revokedAt?: number }; token: string }>(paired.body)
}

describe("mobile bridge server", () => {
  let userDataPath = ""

  beforeEach(async () => {
    userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), "anybox-mobile-bridge-"))
    electronState.userDataPath = userDataPath
    process.env.ANYBOX_MOBILE_BRIDGE_HOST = "127.0.0.1"
    process.env.ANYBOX_MOBILE_BRIDGE_PORT = String(await listenOnFreePort())
    process.env.ANYBOX_MOBILE_BRIDGE_TUNNEL = "0"
    process.env.ANYBOX_DESKTOP_DEVICE_NAME = "Codex Workstation"
    delete process.env.ANYBOX_MOBILE_BRIDGE_PUBLIC_URL
    agentClientState.baseUrl = "http://127.0.0.1:4096"
    desktopCloudRelayState.status = {
      account: {
        state: "unknown",
      },
      baseUrl: null,
      connectedAt: null,
      desktopID: null,
      enabled: false,
      pairingCode: null,
      pairingDeepLink: null,
      pairingExpiresAt: null,
      state: "disabled",
    }

    requestAgentJSONMock.mockReset()
    refreshDesktopCloudRelayPairingMock.mockClear()
    electronState.windows = []
    requestAgentJSONMock.mockImplementation(async (agentPath: string) => {
      if (agentPath === "/api/projects") return { data: [] }
      if (agentPath.startsWith("/api/permissions/requests?")) return { data: [] }
      throw new Error(`Unexpected agent request: ${agentPath}`)
    })
  })

  afterEach(async () => {
    await stopMobileBridgeServer()
    delete process.env.ANYBOX_MOBILE_BRIDGE_HOST
    delete process.env.ANYBOX_MOBILE_BRIDGE_PORT
    delete process.env.ANYBOX_MOBILE_BRIDGE_TUNNEL
    delete process.env.ANYBOX_MOBILE_BRIDGE_PUBLIC_URL
    delete process.env.ANYBOX_DESKTOP_DEVICE_NAME
    if (userDataPath) {
      await fs.rm(userDataPath, { force: true, recursive: true })
    }
  })

  it("pairs a mobile device with a one-time code and revokes its device token", async () => {
    const status = await ensureMobileBridgeServerRunning()
    expect(status.running).toBe(true)
    expect(status.pairingLocalUrl).toBeTruthy()

    const baseUrl = `http://127.0.0.1:${status.port}`
    const pairingCode = new URL(status.pairingLocalUrl ?? "").searchParams.get("code")
    expect(pairingCode).toBeTruthy()

    const publicStatus = await readMobileJSON(baseUrl, "/api/mobile/status")
    expect(publicStatus.response.status).toBe(200)
    expect(successData<{ online: boolean }>(publicStatus.body).online).toBe(true)

    const deniedPair = await readMobileJSON(baseUrl, "/api/mobile/pair?code=wrong", {
      body: JSON.stringify({ name: "Android emulator" }),
      method: "POST",
    })
    expect(deniedPair.response.status).toBe(401)

    const paired = await readMobileJSON(baseUrl, `/api/mobile/pair?code=${encodeURIComponent(pairingCode ?? "")}`, {
      body: JSON.stringify({ name: "Android emulator" }),
      method: "POST",
    })
    expect(paired.response.status).toBe(200)
    const pairData = successData<{ device: { id: string; name: string; revokedAt?: number }; token: string }>(paired.body)
    expect(pairData.device.name).toBe("Android emulator")
    expect(pairData.token).toMatch(/^mobile_/)

    const authHeaders = { authorization: `Bearer ${pairData.token}` }
    const workspaces = await readMobileJSON(baseUrl, "/api/mobile/workspaces", { headers: authHeaders })
    expect(workspaces.response.status).toBe(200)
    expect(successData<unknown[]>(workspaces.body)).toEqual([])

    const approvals = await readMobileJSON(baseUrl, "/api/mobile/approvals", { headers: authHeaders })
    expect(approvals.response.status).toBe(200)
    expect(successData<unknown[]>(approvals.body)).toEqual([])

    const revoked = await readMobileJSON(baseUrl, "/api/mobile/devices/me/revoke", {
      headers: authHeaders,
      method: "POST",
    })
    expect(revoked.response.status).toBe(200)
    expect(successData<{ revoked: boolean }>(revoked.body).revoked).toBe(true)

    const deniedAfterRevoke = await readMobileJSON(baseUrl, "/api/mobile/workspaces", { headers: authHeaders })
    expect(deniedAfterRevoke.response.status).toBe(401)

    const finalStatus = await getMobileBridgeStatus()
    expect(finalStatus.devices).toEqual([
      expect.objectContaining({
        id: pairData.device.id,
        name: "Android emulator",
        revokedAt: expect.any(Number),
      }),
    ])
  })

  it("previews a pairing code without consuming it and marks it invalid after pairing", async () => {
    const status = await ensureMobileBridgeServerRunning()
    const baseUrl = `http://127.0.0.1:${status.port}`
    const pairingCode = new URL(status.pairingLocalUrl ?? "").searchParams.get("code")
    expect(pairingCode).toBeTruthy()

    const preview = await readMobileJSON(baseUrl, `/api/mobile/pair/preview?code=${encodeURIComponent(pairingCode ?? "")}`)
    expect(preview.response.status).toBe(200)
    const previewData = successData<{
      appVersion: string
      arch: string
      capabilities: string[]
      desktopName: string
      online: boolean
      platform: "windows" | "macos" | "linux" | "unknown"
      platformVersion: string
      pairing: { expiresAt: number | null; serverTime: number; valid: boolean }
      running: boolean
      service: string
    }>(preview.body)
    expect(previewData).toMatchObject({
      appVersion: "0.1.13",
      arch: process.arch,
      desktopName: "Codex Workstation",
      online: true,
      platform: expectedDesktopPlatform(),
      platformVersion: expect.any(String),
      pairing: {
        expiresAt: status.pairingExpiresAt,
        valid: true,
      },
      running: true,
      service: "anybox-mobile-bridge",
    })
    expect(previewData.pairing.serverTime).toEqual(expect.any(Number))
    expect(previewData.capabilities).toContain("workspace:read")

    const paired = await readMobileJSON(baseUrl, `/api/mobile/pair?code=${encodeURIComponent(pairingCode ?? "")}`, {
      body: JSON.stringify({ name: "Android emulator" }),
      method: "POST",
    })
    expect(paired.response.status).toBe(200)

    const consumedPreview = await readMobileJSON(baseUrl, `/api/mobile/pair/preview?code=${encodeURIComponent(pairingCode ?? "")}`)
    expect(consumedPreview.response.status).toBe(200)
    expect(successData<{ pairing: { expiresAt: number | null; valid: boolean } }>(consumedPreview.body).pairing).toMatchObject({
      expiresAt: null,
      valid: false,
    })
  })

  it("proxies scoped mobile API routes through the real bridge server", async () => {
    const agent = await startAgentStub()
    agentClientState.baseUrl = agent.baseUrl

    try {
      const workspaceDir = path.join(userDataPath, "workspace")
      await fs.mkdir(workspaceDir, { recursive: true })
      const project = createMockProject(workspaceDir)
      const session = createMockSession(workspaceDir)
      const approval = createMockApproval()
      const projectModel = {
        id: "gpt-project-smoke",
        providerID: "openai",
        providerName: "OpenAI",
        name: "GPT Project Smoke",
        status: "active",
        available: true,
      }

      requestAgentJSONMock.mockImplementation(async (agentPath: string, init?: RequestInit) => {
        if (agentPath === "/api/projects") return { data: [project] }
        if (agentPath === "/api/projects/project-smoke/models") {
          return {
            data: {
              effectiveModel: projectModel,
              items: [projectModel],
              selection: {},
            },
          }
        }
        if (agentPath === "/api/projects/project-smoke/sessions" && init?.method === "POST") {
          return {
            data: {
              ...session,
              id: "session-created",
              title: "Created Chat",
              time: {
                created: Date.now(),
                updated: Date.now(),
              },
            },
          }
        }
        if (agentPath === "/api/projects/project-smoke/sessions") return { data: [session] }
        if (agentPath === "/api/sessions/session-smoke/title" && init?.method === "PATCH") {
          const body = JSON.parse(String(init.body ?? "{}")) as { title?: string }
          return {
            data: {
              ...session,
              title: body.title ?? session.title,
              time: {
                created: session.time.created,
                updated: session.time.updated + 1,
              },
            },
          }
        }
        if (agentPath === "/api/sessions/session-smoke/pinned" && init?.method === "PATCH") {
          const body = JSON.parse(String(init.body ?? "{}")) as { pinned?: boolean }
          return {
            data: {
              ...session,
              pinned: body.pinned,
            },
          }
        }
        if (agentPath.startsWith("/api/permissions/requests?")) return { data: [approval] }
        if (agentPath === "/api/permissions/requests/approval-smoke/resolve") {
          return { data: { approvalID: "approval-smoke", decision: "allow", approved: true } }
        }
        throw new Error(`Unexpected agent request: ${agentPath}`)
      })

      const status = await ensureMobileBridgeServerRunning()
      const baseUrl = `http://127.0.0.1:${status.port}`
      const pairData = await pairMobileDevice(baseUrl)
      const authHeaders = { authorization: `Bearer ${pairData.token}` }
      const workspaceRoute = `/api/mobile/workspaces/${encodeURIComponent(workspaceDir)}`
      const desktopSend = vi.fn()
      electronState.windows = [
        {
          isDestroyed: () => false,
          webContents: {
            isDestroyed: () => false,
            send: desktopSend,
          },
        },
      ]

      const workspaces = await readMobileJSON(baseUrl, "/api/mobile/workspaces", { headers: authHeaders })
      expect(workspaces.response.status).toBe(200)
      expect(successData<Array<{ id: string; sessions: Array<{ id: string }> }>>(workspaces.body)).toEqual([
        expect.objectContaining({
          id: workspaceDir,
          sessions: [expect.objectContaining({ id: "session-smoke" })],
        }),
      ])

      const sessions = await readMobileJSON(baseUrl, `${workspaceRoute}/sessions`, { headers: authHeaders })
      expect(sessions.response.status).toBe(200)
      expect(successData<Array<{ id: string }>>(sessions.body)).toEqual([expect.objectContaining({ id: "session-smoke" })])

      const workspaceModels = await readMobileJSON(baseUrl, `${workspaceRoute}/models`, { headers: authHeaders })
      expect(workspaceModels.response.status).toBe(200)
      expect(successData<{ items: Array<{ id: string }>; effectiveModel?: { id: string } }>(workspaceModels.body)).toMatchObject({
        effectiveModel: { id: "gpt-project-smoke" },
        items: [expect.objectContaining({ id: "gpt-project-smoke" })],
      })

      const createdSession = await readMobileJSON(baseUrl, `${workspaceRoute}/sessions`, {
        body: JSON.stringify({ title: "Created Chat" }),
        headers: authHeaders,
        method: "POST",
      })
      expect(createdSession.response.status).toBe(200)
      expect(successData<{ id: string; title: string }>(createdSession.body)).toMatchObject({
        id: "session-created",
        title: "Created Chat",
      })
      expect(desktopSend).toHaveBeenCalledWith(
        DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL,
        expect.objectContaining({
          type: "session.created",
          source: "mobile",
          workspaceID: workspaceDir,
          directory: workspaceDir,
          sessionID: "session-created",
          generatedAt: expect.any(Number),
        }),
      )

      const messages = await readMobileJSON(baseUrl, "/api/mobile/sessions/session-smoke/messages", { headers: authHeaders })
      expect(messages.response.status).toBe(200)
      expect(successData<Array<{ parts: Array<{ text: string }> }>>(messages.body)[0]?.parts[0]?.text).toBe("Hello from bridge test.")

      const stream = await readMobileText(baseUrl, "/api/mobile/sessions/session-smoke/messages/stream", {
        body: JSON.stringify({ text: "run smoke" }),
        headers: authHeaders,
        method: "POST",
      })
      expect(stream.response.status).toBe(200)
      expect(stream.body).toContain("streamed smoke reply")
      expect(desktopSend).toHaveBeenCalledWith(
        DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL,
        expect.objectContaining({
          type: "session.updated",
          source: "mobile",
          sessionID: "session-smoke",
          generatedAt: expect.any(Number),
        }),
      )

      const questionAnswer = await readMobileJSON(baseUrl, "/api/mobile/sessions/session-smoke/questions/answer", {
        body: JSON.stringify({ questionID: "que_smoke", selectedOptions: ["first"] }),
        headers: authHeaders,
        method: "POST",
      })
      expect(questionAnswer.response.status).toBe(200)
      expect(successData<{ answered: boolean; questionID: string }>(questionAnswer.body)).toMatchObject({
        answered: true,
        questionID: "que_smoke",
      })
      expect(desktopSend).toHaveBeenCalledWith(
        DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL,
        expect.objectContaining({
          type: "session.updated",
          source: "mobile",
          sessionID: "session-smoke",
          generatedAt: expect.any(Number),
        }),
      )

      const tasks = await readMobileJSON(baseUrl, "/api/mobile/sessions/session-smoke/tasks", { headers: authHeaders })
      expect(tasks.response.status).toBe(200)
      expect(successData<{ sessionID: string; summary: { total: number } }>(tasks.body)).toMatchObject({
        sessionID: "session-smoke",
        summary: { total: 0 },
      })

      const models = await readMobileJSON(baseUrl, "/api/mobile/sessions/session-smoke/models", { headers: authHeaders })
      expect(models.response.status).toBe(200)
      expect(successData<{ items: Array<{ id: string }>; selection: { model?: string } }>(models.body)).toMatchObject({
        items: [expect.objectContaining({ id: "gpt-smoke" })],
        selection: { model: "openai/gpt-smoke" },
      })

      const modelSelection = await readMobileJSON(baseUrl, "/api/mobile/sessions/session-smoke/model-selection", {
        body: JSON.stringify({ model: "openai/gpt-smoke" }),
        headers: authHeaders,
        method: "PATCH",
      })
      expect(modelSelection.response.status).toBe(200)
      expect(successData<{ model?: string }>(modelSelection.body).model).toBe("openai/gpt-smoke")
      expect(desktopSend).toHaveBeenCalledWith(
        DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL,
        expect.objectContaining({
          type: "session.updated",
          source: "mobile",
          sessionID: "session-smoke",
          generatedAt: expect.any(Number),
        }),
      )

      const renamed = await readMobileJSON(baseUrl, "/api/mobile/sessions/session-smoke/title", {
        body: JSON.stringify({ title: "Renamed Chat" }),
        headers: authHeaders,
        method: "PATCH",
      })
      expect(renamed.response.status).toBe(200)
      expect(successData<{ created: number; id: string; title: string; updated: number }>(renamed.body)).toMatchObject({
        created: session.time.created,
        id: "session-smoke",
        title: "Renamed Chat",
        updated: session.time.updated + 1,
      })

      const pinned = await readMobileJSON(baseUrl, "/api/mobile/sessions/session-smoke/pinned", {
        body: JSON.stringify({ pinned: true }),
        headers: authHeaders,
        method: "PATCH",
      })
      expect(pinned.response.status).toBe(200)
      expect(successData<{ id: string; pinned?: boolean }>(pinned.body)).toMatchObject({
        id: "session-smoke",
        pinned: true,
      })
      expect(desktopSend).toHaveBeenCalledWith(
        DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL,
        expect.objectContaining({
          type: "session.updated",
          source: "mobile",
          sessionID: "session-smoke",
          generatedAt: expect.any(Number),
        }),
      )

      const cancelled = await readMobileJSON(baseUrl, "/api/mobile/sessions/session-smoke/cancel", {
        headers: authHeaders,
        method: "POST",
      })
      expect(cancelled.response.status).toBe(200)
      expect(successData<{ cancelled: boolean }>(cancelled.body).cancelled).toBe(true)
      expect(desktopSend).toHaveBeenCalledWith(
        DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL,
        expect.objectContaining({
          type: "session.updated",
          source: "mobile",
          sessionID: "session-smoke",
          generatedAt: expect.any(Number),
        }),
      )

      const files = await readMobileJSON(baseUrl, `${workspaceRoute}/files`, { headers: authHeaders })
      expect(files.response.status).toBe(200)
      expect(successData<Array<{ path: string }>>(files.body)).toEqual([expect.objectContaining({ path: "README.md" })])

      const fileContent = await readMobileJSON(baseUrl, `${workspaceRoute}/files/content?path=README.md`, { headers: authHeaders })
      expect(fileContent.response.status).toBe(200)
      expect(successData<{ content: string; path: string }>(fileContent.body)).toMatchObject({
        content: "# Smoke\n",
        path: "README.md",
      })

      const fileSearch = await readMobileJSON(baseUrl, `${workspaceRoute}/files/search?q=readme`, { headers: authHeaders })
      expect(fileSearch.response.status).toBe(200)
      expect(successData<Array<{ path: string }>>(fileSearch.body)).toEqual([expect.objectContaining({ path: "README.md" })])

      const approvals = await readMobileJSON(baseUrl, "/api/mobile/approvals", { headers: authHeaders })
      expect(approvals.response.status).toBe(200)
      expect(successData<Array<{ id: string }>>(approvals.body)).toEqual([expect.objectContaining({ id: "approval-smoke" })])

      const approved = await readMobileJSON(baseUrl, "/api/mobile/approvals/approval-smoke/approve", {
        body: JSON.stringify({ resume: true }),
        headers: authHeaders,
        method: "POST",
      })
      expect(approved.response.status).toBe(200)
      expect(successData<{ approved: boolean }>(approved.body).approved).toBe(true)
      expect(desktopSend).toHaveBeenCalledWith(
        DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL,
        expect.objectContaining({
          type: "approval.updated",
          source: "mobile",
          approvalID: "approval-smoke",
          generatedAt: expect.any(Number),
        }),
      )

      const eventController = new AbortController()
      const eventResponse = await fetch(`${baseUrl}/api/mobile/events/stream`, {
        headers: authHeaders,
        signal: eventController.signal,
      })
      expect(eventResponse.status).toBe(200)
      const eventReader = eventResponse.body?.getReader()
      expect(eventReader).toBeTruthy()
      const eventChunk = await Promise.race([
        eventReader?.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for mobile event stream.")), 2000)),
      ])
      eventController.abort()
      await eventReader?.cancel().catch(() => undefined)
      const eventText = new TextDecoder().decode(eventChunk?.value)
      expect(eventText).toContain("event: sync.ready")

      expect(agent.requests).toEqual(expect.arrayContaining([
        "GET /api/sessions/session-smoke/messages",
        "POST /api/sessions/session-smoke/messages/stream",
        "POST /api/sessions/session-smoke/questions/answer",
        "GET /api/sessions/session-smoke/tasks",
        "GET /api/sessions/session-smoke/models",
        "PATCH /api/sessions/session-smoke/model-selection",
        "POST /api/sessions/session-smoke/cancel",
        "GET /api/workspace-files/directory",
        "GET /api/workspace-files/file",
        "GET /api/workspace-files/search",
      ]))
    } finally {
      await agent.close()
    }
  })

  it("refreshes the one-time pairing code without rotating the legacy bridge token", async () => {
    const status = await ensureMobileBridgeServerRunning()
    const originalToken = status.token
    const originalPairingCode = new URL(status.pairingLocalUrl ?? "").searchParams.get("code")
    expect(originalPairingCode).toBeTruthy()

    const refreshed = await refreshMobilePairingCode()
    const refreshedPairingCode = new URL(refreshed.pairingLocalUrl ?? "").searchParams.get("code")

    expect(refreshed.token).toBe(originalToken)
    expect(refreshedPairingCode).toBeTruthy()
    expect(refreshedPairingCode).not.toBe(originalPairingCode)
  })

  it("uses a reachable LAN address instead of reserved virtual-network addresses for Android handoff", async () => {
    process.env.ANYBOX_MOBILE_BRIDGE_HOST = "0.0.0.0"
    process.env.ANYBOX_MOBILE_BRIDGE_PUBLIC_URL = "none"
    const networkInterfaces: ReturnType<typeof os.networkInterfaces> = {
      "vEthernet (Default Switch)": [
        {
          address: "198.18.0.1",
          cidr: "198.18.0.1/15",
          family: "IPv4",
          internal: false,
          mac: "00:00:00:00:00:00",
          netmask: "255.254.0.0",
        },
      ],
      "Wi-Fi": [
        {
          address: "192.168.1.20",
          cidr: "192.168.1.20/24",
          family: "IPv4",
          internal: false,
          mac: "00:00:00:00:00:01",
          netmask: "255.255.255.0",
        },
      ],
    }
    const networkSpy = vi.spyOn(os, "networkInterfaces").mockReturnValue(networkInterfaces)

    try {
      const status = await ensureMobileBridgeServerRunning()
      const handoffPath = path.join(userDataPath, "mobile-bridge-handoff.json")
      const handoff = JSON.parse(await fs.readFile(handoffPath, "utf8")) as {
        android?: {
          deepLink?: string
          pairingUrl?: string
        }
      }

      expect(status.pairingUrls).toEqual([expect.stringContaining("192.168.1.20")])
      expect(status.publicPairingUrl).toBeNull()
      expect(JSON.stringify(status)).not.toContain("198.18.0.1")
      expect(handoff.android?.pairingUrl).toContain("192.168.1.20")
      expect(handoff.android?.deepLink).toBe(createConnectOptionsDeepLink({ lan: handoff.android?.pairingUrl ?? "" }))
    } finally {
      networkSpy.mockRestore()
    }
  })

  it("writes a public Android handoff file without exposing the legacy bridge token", async () => {
    const status = await ensureMobileBridgeServerRunning()
    const handoffPath = path.join(userDataPath, "mobile-bridge-handoff.json")
    const handoff = JSON.parse(await fs.readFile(handoffPath, "utf8")) as {
      android?: {
        deepLink?: string
        handoffCommand?: string
        pairingUrl?: string
        smokeCommand?: string
      }
      bridge?: {
        port?: number
      }
      pairingExpiresAt?: string
      schemaVersion?: number
    }

    expect(handoff.schemaVersion).toBe(1)
    expect(handoff.bridge?.port).toBe(status.port)
    expect(status.publicUrl).toBe(`https://anybox.com.cn/?token=${encodeURIComponent(status.token)}`)
    expect(status.publicPairingUrl).toBeTruthy()
    expect(handoff.android?.pairingUrl).toBe(status.publicPairingUrl)
    expect(handoff.android?.deepLink).toBe(`anybox-mobile://connect?url=${encodeURIComponent(status.publicPairingUrl ?? "")}`)
    expect(handoff.android?.smokeCommand).toContain("corepack pnpm mobile:android:smoke:bridge")
    expect(handoff.android?.handoffCommand).toContain("corepack pnpm mobile:android:handoff-check")
    expect(handoff.pairingExpiresAt).toBe(new Date(status.pairingExpiresAt ?? 0).toISOString())
    expect(JSON.stringify(handoff)).not.toContain(status.token)
  })

  it("does not write an expired cloud relay pairing deep link to the Android handoff file", async () => {
    desktopCloudRelayState.status = {
      account: {
        state: "connected",
        email: "owner@example.com",
      },
      baseUrl: "https://anybox.com.cn",
      connectedAt: Date.now() - 30_000,
      desktopID: "desktop-123",
      enabled: true,
      pairingCode: "expired-relay-pair",
      pairingDeepLink: "anybox-mobile://pair?code=expired-relay-pair&url=https%3A%2F%2Fanybox.com.cn",
      pairingExpiresAt: Date.now() - 1_000,
      state: "connected",
    }

    const status = await ensureMobileBridgeServerRunning()
    const handoffPath = path.join(userDataPath, "mobile-bridge-handoff.json")
    const handoff = JSON.parse(await fs.readFile(handoffPath, "utf8")) as {
      android?: {
        deepLink?: string
        pairingUrl?: string
      }
      pairingExpiresAt?: string
    }

    expect(handoff.android?.pairingUrl).toBe(status.publicPairingUrl)
    expect(handoff.android?.deepLink).toBe(`anybox-mobile://connect?url=${encodeURIComponent(status.publicPairingUrl ?? "")}`)
    expect(handoff.android?.deepLink).not.toContain("expired-relay-pair")
    expect(handoff.pairingExpiresAt).toBe(new Date(status.pairingExpiresAt ?? 0).toISOString())
  })

  it("refreshes an expired cloud relay pairing code before writing the Android handoff file", async () => {
    process.env.ANYBOX_MOBILE_BRIDGE_PUBLIC_URL = "https://anybox.com.cn"
    const refreshedRelayStatus = {
      account: {
        state: "connected",
        email: "owner@example.com",
      },
      baseUrl: "https://anybox.com.cn",
      connectedAt: Date.now() - 30_000,
      desktopID: "desktop-123",
      enabled: true,
      pairingCode: "fresh-relay-pair",
      pairingDeepLink: "anybox-mobile://pair?code=fresh-relay-pair&url=https%3A%2F%2Fanybox.com.cn",
      pairingExpiresAt: Date.now() + 60_000,
      state: "connected",
    }
    desktopCloudRelayState.status = {
      ...refreshedRelayStatus,
      pairingCode: "expired-relay-pair",
      pairingDeepLink: "anybox-mobile://pair?code=expired-relay-pair&url=https%3A%2F%2Fanybox.com.cn",
      pairingExpiresAt: Date.now() - 1_000,
    }
    refreshDesktopCloudRelayPairingMock.mockImplementationOnce(async () => {
      desktopCloudRelayState.status = refreshedRelayStatus
      return refreshedRelayStatus
    })

    const status = await ensureMobileBridgeServerRunning()
    const handoffPath = path.join(userDataPath, "mobile-bridge-handoff.json")
    const handoff = JSON.parse(await fs.readFile(handoffPath, "utf8")) as {
      android?: {
        deepLink?: string
        pairingUrl?: string
      }
      pairingExpiresAt?: string
    }

    expect(refreshDesktopCloudRelayPairingMock).toHaveBeenCalledTimes(1)
    expect(status.cloudRelay.pairingDeepLink).toBe(refreshedRelayStatus.pairingDeepLink)
    expect(handoff.android?.pairingUrl).toBe(refreshedRelayStatus.pairingDeepLink)
    expect(handoff.android?.deepLink).toBe(createConnectOptionsDeepLink({
      relay: refreshedRelayStatus.pairingDeepLink,
    }))
    expect(handoff.android?.deepLink).not.toContain("expired-relay-pair")
    expect(handoff.pairingExpiresAt).toBe(new Date(refreshedRelayStatus.pairingExpiresAt).toISOString())
  })
})
