import { afterEach, describe, expect, test } from "bun:test"
import { createServerRuntime } from "#server/server.ts"
import { createPtyRegistry } from "#pty/registry.ts"
import type { PtyRuntimeAdapter, PtyRuntimeHandle } from "#pty/runtime.ts"
import type { PtyServerMessage, PtySessionInfo } from "#pty/types.ts"
import * as Identifier from "#id/id.ts"
import * as Message from "#session/core/message.ts"
import * as SessionCore from "#session/core/session.ts"

interface JsonEnvelope<T = Record<string, unknown>> {
  success: boolean
  requestId?: string
  data?: T
  error?: {
    code: string
    message: string
  }
}

interface SessionSummary {
  id: string
  directory: string
  kind?: string
}

class FakePtyHandle implements PtyRuntimeHandle {
  readonly pid = Math.floor(Math.random() * 10_000)
  readonly writes: string[] = []
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(event: { exitCode: number | null; signal?: number }) => void>()

  constructor(
    public cols: number,
    public rows: number,
  ) {}

  write(data: string) {
    this.writes.push(data)
  }

  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
  }

  kill() {
    this.emitExit(0)
  }

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener)
    return () => {
      this.dataListeners.delete(listener)
    }
  }

  onExit(listener: (event: { exitCode: number | null; signal?: number }) => void) {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  emitData(data: string) {
    for (const listener of [...this.dataListeners]) {
      listener(data)
    }
  }

  emitExit(exitCode: number | null) {
    for (const listener of [...this.exitListeners]) {
      listener({ exitCode })
    }
  }
}

class FakePtyRuntime implements PtyRuntimeAdapter {
  readonly handles: FakePtyHandle[] = []

  spawn(input: { shell: string; cwd: string; rows: number; cols: number; env: Record<string, string> }) {
    void input.shell
    void input.cwd
    void input.env
    const handle = new FakePtyHandle(input.cols, input.rows)
    this.handles.push(handle)
    return handle
  }
}

class ThrowingPtyRuntime implements PtyRuntimeAdapter {
  spawn(): PtyRuntimeHandle {
    throw new Error("native PTY spawn failed")
  }
}

class ThrowingResizePtyRuntime implements PtyRuntimeAdapter {
  readonly handles: FakePtyHandle[] = []

  spawn(input: { shell: string; cwd: string; rows: number; cols: number; env: Record<string, string> }) {
    void input.shell
    void input.cwd
    void input.env
    const handle = new FakePtyHandle(input.cols, input.rows)
    handle.resize = () => {
      throw new Error("ioctl(2) failed")
    }
    this.handles.push(handle)
    return handle
  }
}

class SocketHarness {
  readonly socket: WebSocket
  private readonly queue: PtyServerMessage[] = []
  private readonly waiters: Array<(message: PtyServerMessage) => void> = []

  private constructor(socket: WebSocket) {
    this.socket = socket
  }

  static async connect(url: string) {
    return new Promise<SocketHarness>((resolve, reject) => {
      const socket = new WebSocket(url)
      const harness = new SocketHarness(socket)

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as PtyServerMessage
        const waiter = harness.waiters.shift()
        if (waiter) {
          waiter(message)
          return
        }
        harness.queue.push(message)
      })

      socket.addEventListener(
        "open",
        () => {
          resolve(harness)
        },
        { once: true },
      )

      socket.addEventListener(
        "error",
        () => {
          reject(new Error("WebSocket connection failed"))
        },
        { once: true },
      )
    })
  }

  async nextMessage(timeoutMs = 2_000) {
    if (this.queue.length > 0) {
      return this.queue.shift()!
    }

    return new Promise<PtyServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(onMessage)
        if (index >= 0) {
          this.waiters.splice(index, 1)
        }
        reject(new Error("Timed out waiting for PTY socket message"))
      }, timeoutMs)

      const onMessage = (message: PtyServerMessage) => {
        clearTimeout(timer)
        resolve(message)
      }

      this.waiters.push(onMessage)
    })
  }

  close() {
    this.socket.close()
  }
}

const activeServers: Bun.Server<unknown>[] = []

afterEach(() => {
  for (const server of activeServers.splice(0, activeServers.length)) {
    server.stop(true)
  }
})

async function waitForWrites(read: () => string[] | undefined, expected: string[]) {
  const started = Date.now()

  while (Date.now() - started < 2_000) {
    const value = read()
    if (JSON.stringify(value) === JSON.stringify(expected)) return
    await Bun.sleep(20)
  }

  expect(read()).toEqual(expected)
}

async function startPtyTestServer(input?: { runtime?: PtyRuntimeAdapter }) {
  const runtime = input?.runtime ?? new FakePtyRuntime()
  const registry = createPtyRegistry({
    runtime,
    exitRetentionMs: 30_000,
    deleteRetentionMs: 30_000,
  })
  const serverRuntime = createServerRuntime({ ptyRegistry: registry })
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, bunServer) {
      return serverRuntime.app.fetch(request, bunServer)
    },
    websocket: serverRuntime.websocket,
  })
  activeServers.push(server)

  const baseURL = `http://127.0.0.1:${String(server.port)}`
  return {
    baseURL,
    registry,
    runtime: runtime as FakePtyRuntime,
  }
}

async function createPty(baseURL: string) {
  const sessionResponse = await fetch(`${baseURL}/api/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      directory: process.cwd(),
    }),
  })
  const sessionBody = (await sessionResponse.json()) as JsonEnvelope<SessionSummary>
  expect(sessionResponse.status).toBe(201)
  expect(sessionBody.data?.id).toBeString()

  const response = await fetch(`${baseURL}/api/pty`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sessionID: sessionBody.data!.id,
      rows: 24,
      cols: 80,
    }),
  })
  const body = (await response.json()) as JsonEnvelope<PtySessionInfo>
  return {
    response,
    body,
    session: sessionBody.data!,
  }
}

function createAnchorMessages(session: SessionSummary) {
  const userMessage = Message.User.parse({
    id: Identifier.ascending("message"),
    sessionID: session.id,
    role: "user",
    created: Date.now(),
    agent: "plan",
    model: {
      providerID: "test",
      modelID: "test-model",
    },
  })
  const userPart = Message.TextPart.parse({
    id: Identifier.ascending("part"),
    sessionID: session.id,
    messageID: userMessage.id,
    type: "text",
    text: "Parent prompt",
  })
  const assistantMessage = Message.Assistant.parse({
    id: Identifier.ascending("message"),
    sessionID: session.id,
    role: "assistant",
    created: Date.now(),
    completed: Date.now(),
    parentID: userMessage.id,
    modelID: "test-model",
    providerID: "test",
    agent: "plan",
    path: {
      cwd: session.directory,
      root: session.directory,
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
  const assistantPart = Message.TextPart.parse({
    id: Identifier.ascending("part"),
    sessionID: session.id,
    messageID: assistantMessage.id,
    type: "text",
    text: "Anchorable answer",
  })

  SessionCore.upsertMessage(userMessage)
  SessionCore.upsertPart(userPart)
  SessionCore.upsertMessage(assistantMessage)
  SessionCore.upsertPart(assistantPart)

  return {
    assistantMessage,
  }
}

describe("server pty api", () => {
  test("rejects PTY creation without a session owner", async () => {
    const { baseURL } = await startPtyTestServer()
    const response = await fetch(`${baseURL}/api/pty`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        rows: 24,
        cols: 80,
      }),
    })
    const body = (await response.json()) as JsonEnvelope<PtySessionInfo>

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
  })

  test("rejects caller-provided cwd during PTY creation", async () => {
    const { baseURL } = await startPtyTestServer()
    const sessionResponse = await fetch(`${baseURL}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        directory: process.cwd(),
      }),
    })
    const sessionBody = (await sessionResponse.json()) as JsonEnvelope<SessionSummary>

    const response = await fetch(`${baseURL}/api/pty`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionID: sessionBody.data!.id,
        cwd: process.cwd(),
      }),
    })
    const body = (await response.json()) as JsonEnvelope<PtySessionInfo>

    expect(response.status).toBe(400)
    expect(body.success).toBe(false)
  })

  test("creates a PTY session and returns the JSON envelope", async () => {
    const { baseURL, runtime } = await startPtyTestServer()
    const { response, body, session } = await createPty(baseURL)

    expect(response.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.requestId).toBeString()
    expect(body.data?.id).toStartWith("pty_")
    expect(body.data?.sessionID).toBe(session.id)
    expect(body.data?.status).toBe("running")
    expect(runtime.handles).toHaveLength(1)
    expect(runtime.handles[0]?.cols).toBe(80)
    expect(runtime.handles[0]?.rows).toBe(24)
  })

  test("returns a readable error when PTY runtime spawn fails", async () => {
    const { baseURL } = await startPtyTestServer({
      runtime: new ThrowingPtyRuntime(),
    })
    const { response, body } = await createPty(baseURL)

    expect(response.status).toBe(500)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("PTY_CREATE_FAILED")
    expect(body.error?.message).toContain("native PTY spawn failed")
  })

  test("returns the same running PTY for repeated session creation", async () => {
    const { baseURL, runtime } = await startPtyTestServer()
    const created = await createPty(baseURL)
    const sessionID = created.session.id
    const firstPtyID = created.body.data?.id

    const response = await fetch(`${baseURL}/api/sessions/${sessionID}/pty`, {
      method: "POST",
    })
    const body = (await response.json()) as JsonEnvelope<PtySessionInfo>

    expect(response.status).toBe(201)
    expect(body.data?.id).toBe(firstPtyID)
    expect(body.data?.sessionID).toBe(sessionID)
    expect(runtime.handles).toHaveLength(1)
  })

  test("keeps interactive and environment action PTYs isolated by terminal key", async () => {
    const { baseURL, registry } = await startPtyTestServer()
    const interactive = await createPty(baseURL)
    const sessionID = interactive.session.id

    const actionResponse = await fetch(`${baseURL}/api/pty`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sessionID,
        terminalKey: "environment-action:binding:dev",
        purpose: "environment-action",
        title: "Run dev",
      }),
    })
    const actionBody = (await actionResponse.json()) as JsonEnvelope<PtySessionInfo>

    expect(actionResponse.status).toBe(201)
    expect(actionBody.data?.id).not.toBe(interactive.body.data?.id)
    expect(actionBody.data?.terminalKey).toBe("environment-action:binding:dev")
    expect(actionBody.data?.purpose).toBe("environment-action")
    expect(registry.infoBySession(sessionID)?.id).toBe(interactive.body.data?.id)
    expect(registry.infoBySession(sessionID, "environment-action:binding:dev")?.id).toBe(actionBody.data?.id)

    registry.delete(actionBody.data!.id)

    expect(registry.infoBySession(sessionID)?.status).toBe("running")
    expect(registry.infoBySession(sessionID, "environment-action:binding:dev")).toBeNull()
  })

  test("keeps PTYs isolated across sessions", async () => {
    const { baseURL, registry, runtime } = await startPtyTestServer()
    const first = await createPty(baseURL)
    const second = await createPty(baseURL)

    expect(first.body.data?.id).not.toBe(second.body.data?.id)
    expect(first.body.data?.sessionID).toBe(first.session.id)
    expect(second.body.data?.sessionID).toBe(second.session.id)
    expect(registry.infoBySession(first.session.id)?.id).toBe(first.body.data?.id)
    expect(registry.infoBySession(second.session.id)?.id).toBe(second.body.data?.id)
    expect(runtime.handles).toHaveLength(2)
  })

  test("rejects session PTY creation for side chats", async () => {
    const { baseURL } = await startPtyTestServer()
    const parent = await createPty(baseURL)
    const { assistantMessage } = createAnchorMessages(parent.session)
    const sideChat = await SessionCore.createSideChat({
      parentSessionID: parent.session.id,
      anchorMessageID: assistantMessage.id,
    })

    const response = await fetch(`${baseURL}/api/sessions/${sideChat.id}/pty`, {
      method: "POST",
    })
    const body = (await response.json()) as JsonEnvelope<PtySessionInfo>

    expect(response.status).toBe(409)
    expect(body.success).toBe(false)
    expect(body.error?.code).toBe("TERMINAL_UNAVAILABLE")
  })

  test("returns null for a session without a terminal", async () => {
    const { baseURL } = await startPtyTestServer()
    const sessionResponse = await fetch(`${baseURL}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        directory: process.cwd(),
      }),
    })
    const sessionBody = (await sessionResponse.json()) as JsonEnvelope<SessionSummary>

    const response = await fetch(`${baseURL}/api/sessions/${sessionBody.data!.id}/pty`)
    const body = (await response.json()) as JsonEnvelope<PtySessionInfo | null>

    expect(response.status).toBe(200)
    expect(body.data).toBeNull()
  })

  test("updates rows and cols through PUT /api/pty/:id", async () => {
    const { baseURL, runtime } = await startPtyTestServer()
    const created = await createPty(baseURL)
    const ptyID = created.body.data?.id

    expect(ptyID).toBeString()

    const response = await fetch(`${baseURL}/api/pty/${ptyID}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        rows: 40,
        cols: 120,
      }),
    })
    const body = (await response.json()) as JsonEnvelope<PtySessionInfo>

    expect(response.status).toBe(200)
    expect(body.data?.rows).toBe(40)
    expect(body.data?.cols).toBe(120)
    expect(runtime.handles[0]?.rows).toBe(40)
    expect(runtime.handles[0]?.cols).toBe(120)
  })

  test("treats runtime resize errors as non-fatal", async () => {
    const { baseURL } = await startPtyTestServer({
      runtime: new ThrowingResizePtyRuntime(),
    })
    const created = await createPty(baseURL)
    const ptyID = created.body.data?.id

    expect(ptyID).toBeString()

    const response = await fetch(`${baseURL}/api/pty/${ptyID}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        rows: 40,
        cols: 120,
      }),
    })
    const body = (await response.json()) as JsonEnvelope<PtySessionInfo>

    expect(response.status).toBe(200)
    expect(body.data?.rows).toBe(40)
    expect(body.data?.cols).toBe(120)
  })

  test("replays only missing output when reconnecting with a cursor", async () => {
    const { baseURL, runtime } = await startPtyTestServer()
    const created = await createPty(baseURL)
    const ptyID = created.body.data?.id

    expect(ptyID).toBeString()

    runtime.handles[0]?.emitData("hello")

    const firstSocket = await SocketHarness.connect(`${baseURL.replace("http", "ws")}/api/pty/${ptyID}/connect`)
    const firstReady = await firstSocket.nextMessage()

    expect(firstReady).toMatchObject({
      type: "ready",
      replay: {
        mode: "reset",
        buffer: "hello",
        cursor: 5,
      },
    })

    firstSocket.close()

    runtime.handles[0]?.emitData(" world")

    const secondSocket = await SocketHarness.connect(
      `${baseURL.replace("http", "ws")}/api/pty/${ptyID}/connect?cursor=5`,
    )
    const secondReady = await secondSocket.nextMessage()

    expect(secondReady).toMatchObject({
      type: "ready",
      replay: {
        mode: "delta",
        buffer: " world",
        cursor: 11,
      },
    })

    secondSocket.close()
  })

  test("forwards exit events over the PTY websocket", async () => {
    const { baseURL, runtime } = await startPtyTestServer()
    const created = await createPty(baseURL)
    const ptyID = created.body.data?.id

    expect(ptyID).toBeString()

    const socket = await SocketHarness.connect(`${baseURL.replace("http", "ws")}/api/pty/${ptyID}/connect`)
    const ready = await socket.nextMessage()
    expect(ready.type).toBe("ready")

    runtime.handles[0]?.emitExit(17)

    const exited = await socket.nextMessage()
    expect(exited).toMatchObject({
      type: "exited",
      session: {
        id: ptyID,
        status: "exited",
        exitCode: 17,
      },
    })

    socket.close()
  })

  test("forwards websocket input to the PTY runtime", async () => {
    const { baseURL, runtime } = await startPtyTestServer()
    const created = await createPty(baseURL)
    const ptyID = created.body.data?.id

    expect(ptyID).toBeString()

    const socket = await SocketHarness.connect(`${baseURL.replace("http", "ws")}/api/pty/${ptyID}/connect`)
    const ready = await socket.nextMessage()
    expect(ready.type).toBe("ready")

    socket.socket.send(
      JSON.stringify({
        type: "input",
        data: "echo 123\r",
      }),
    )

    await waitForWrites(() => runtime.handles[0]?.writes, ["echo 123\r"])

    socket.close()
  })

  test("deletes a PTY session and pushes the deleted event to the socket", async () => {
    const { baseURL } = await startPtyTestServer()
    const created = await createPty(baseURL)
    const ptyID = created.body.data?.id

    expect(ptyID).toBeString()

    const socket = await SocketHarness.connect(`${baseURL.replace("http", "ws")}/api/pty/${ptyID}/connect`)
    const ready = await socket.nextMessage()
    expect(ready.type).toBe("ready")

    const response = await fetch(`${baseURL}/api/pty/${ptyID}`, {
      method: "DELETE",
    })
    const body = (await response.json()) as JsonEnvelope<PtySessionInfo>

    expect(response.status).toBe(200)
    expect(body.data?.status).toBe("deleted")

    const deleted = await socket.nextMessage()
    expect(deleted).toMatchObject({
      type: "deleted",
      session: {
        id: ptyID,
        status: "deleted",
      },
    })

    socket.close()
  })

  test("deleting a session removes its PTY ownership mapping", async () => {
    const { baseURL, registry } = await startPtyTestServer()
    const created = await createPty(baseURL)

    expect(registry.infoBySession(created.session.id)?.id).toBe(created.body.data?.id)

    const response = await fetch(`${baseURL}/api/sessions/${created.session.id}`, {
      method: "DELETE",
    })
    const body = (await response.json()) as JsonEnvelope<{ sessionID: string }>

    expect(response.status).toBe(200)
    expect(body.data?.sessionID).toBe(created.session.id)
    expect(registry.infoBySession(created.session.id)).toBeNull()
  })

  test("archiving a session removes its PTY and restore does not recreate it", async () => {
    const { baseURL, registry } = await startPtyTestServer()
    const created = await createPty(baseURL)

    expect(registry.infoBySession(created.session.id)?.id).toBe(created.body.data?.id)

    const archiveResponse = await fetch(`${baseURL}/api/sessions/${created.session.id}/archive`, {
      method: "POST",
    })
    expect(archiveResponse.status).toBe(200)
    expect(registry.infoBySession(created.session.id)).toBeNull()

    const restoreResponse = await fetch(`${baseURL}/api/sessions/archived/${created.session.id}/restore`, {
      method: "POST",
    })
    expect(restoreResponse.status).toBe(200)

    const getResponse = await fetch(`${baseURL}/api/sessions/${created.session.id}/pty`)
    const getBody = (await getResponse.json()) as JsonEnvelope<PtySessionInfo | null>

    expect(getResponse.status).toBe(200)
    expect(getBody.data).toBeNull()
  })
})
