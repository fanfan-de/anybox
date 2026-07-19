import { afterEach, describe, expect, test } from "bun:test"
import { createHmac, randomUUID } from "node:crypto"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs"
import { createConnection, type Socket } from "node:net"
import os from "node:os"
import path from "node:path"
import {
  ANYBOX_CHROME_EXTENSION_ID,
  ANYBOX_CHROME_NATIVE_HOST_NAME,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
} from "@anybox/chrome-shared/browser-extension"
import {
  BROWSER_IPC_PROTOCOL_VERSION,
  BrowserIpcFrameDecoder,
  browserIpcProofTranscript,
  encodeBrowserIpcFrame,
  type BrowserIpcChallengeMessage,
  type BrowserIpcRole,
} from "@anybox/chrome-shared/browser-ipc"
import { BrowserExtensionBridge } from "../src/bridge.ts"
import {
  BrowserIpcGateway,
  defaultBrowserIpcPaths,
} from "../src/ipc-gateway.ts"

type JsonRecord = Record<string, unknown>

class FramedClient {
  private readonly decoder = new BrowserIpcFrameDecoder()
  private readonly queued: unknown[] = []
  private readonly waiters: Array<{
    resolve(value: unknown): void
    reject(error: Error): void
    timer: ReturnType<typeof setTimeout>
  }> = []

  constructor(readonly socket: Socket) {
    socket.on("data", (chunk) => {
      try {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk
        for (const message of this.decoder.push(bytes)) this.deliver(message)
      } catch (error) {
        this.rejectAll(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.on("error", (error) => this.rejectAll(error))
    socket.on("close", () => {
      this.rejectAll(new Error("Browser IPC test connection closed."))
    })
  }

  send(message: unknown) {
    this.socket.write(encodeBrowserIpcFrame(message))
  }

  next(timeoutMs = 2_000) {
    const queued = this.queued.shift()
    if (queued !== undefined) return Promise.resolve(queued as JsonRecord)
    return new Promise<JsonRecord>((resolve, reject) => {
      const waiter = {
        resolve: (value: unknown) => resolve(value as JsonRecord),
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter)
          if (index >= 0) this.waiters.splice(index, 1)
          reject(new Error("Timed out waiting for a Browser IPC frame."))
        }, timeoutMs),
      }
      this.waiters.push(waiter)
    })
  }

  close() {
    this.socket.destroy()
  }

  private deliver(message: unknown) {
    const waiter = this.waiters.shift()
    if (!waiter) {
      this.queued.push(message)
      return
    }
    clearTimeout(waiter.timer)
    waiter.resolve(message)
  }

  private rejectAll(error: Error) {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }
}

const gateways: Array<{ gateway: BrowserIpcGateway; root: string }> = []

afterEach(async () => {
  await Promise.all(gateways.splice(0).map(async ({ gateway, root }) => {
    await gateway.stop()
    rmSync(root, { recursive: true, force: true })
  }))
})

function proofFor(
  secret: string,
  input: {
    role: BrowserIpcRole
    brokerInstanceID: string
    nonce: string
    clientInstanceID: string
    clientVersion: string
  },
) {
  return createHmac("sha256", secret)
    .update(browserIpcProofTranscript(input))
    .digest("base64url")
}

function gatewayFixture(options: {
  now?: () => number
  nativeBootstrapTtlMs?: number
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "anybox-browser-ipc-test-"))
  const suffix = `${process.pid}-${randomUUID()}`
  const runtimeEndpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\anybox-browser-runtime-test-${suffix}`
    : path.join(root, "runtime.sock")
  const nativeHostEndpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\anybox-browser-native-test-${suffix}`
    : path.join(root, "native.sock")
  const bootstrapPath = path.join(root, "native-bootstrap.json")
  const bridge = new BrowserExtensionBridge()
  const gateway = new BrowserIpcGateway({
    bootstrapPath,
    bridge,
    brokerInstanceID: `broker-${suffix}`,
    handshakeTimeoutMs: 5_000,
    nativeHostEndpoint,
    runtimeEndpoint,
    runtimeProof: `runtime-proof-${suffix}`,
    ...options,
  })
  gateways.push({ gateway, root })
  return { bootstrapPath, bridge, gateway, root }
}

async function connect(endpoint: string) {
  const socket = createConnection(endpoint)
  const client = new FramedClient(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  })
  return client
}

async function authenticateRuntime(
  gateway: BrowserIpcGateway,
  overrides: Partial<{
    brokerInstanceID: string
    clientInstanceID: string
    clientVersion: string
    nonce: string
    proof: string
    protocolVersion: number
    role: string
  }> = {},
) {
  const client = await connect(gateway.runtimeEndpoint)
  const challenge = await client.next() as unknown as BrowserIpcChallengeMessage
  const proofInput = {
    role: "runtime" as const,
    brokerInstanceID: overrides.brokerInstanceID ?? gateway.brokerInstanceID,
    nonce: overrides.nonce ?? challenge.nonce,
    clientInstanceID: overrides.clientInstanceID ?? `runtime-${randomUUID()}`,
    clientVersion: overrides.clientVersion ?? "test-runtime",
  }
  const hello = {
    type: "hello",
    protocolVersion: overrides.protocolVersion ?? BROWSER_IPC_PROTOCOL_VERSION,
    ...proofInput,
    role: overrides.role ?? proofInput.role,
    proof: overrides.proof ?? proofFor(gateway.runtimeProof, proofInput),
  }
  client.send(hello)
  return { challenge, client, hello, response: await client.next() }
}

async function authenticateNative(
  gateway: BrowserIpcGateway,
  bootstrap: JsonRecord = JSON.parse(
    readFileSync(gateway.bootstrapPath, "utf8"),
  ) as JsonRecord,
) {
  const client = await connect(gateway.nativeHostEndpoint)
  const challenge = await client.next() as unknown as BrowserIpcChallengeMessage
  const proofInput = {
    role: "native-host" as const,
    brokerInstanceID: String(bootstrap.brokerInstanceID),
    nonce: challenge.nonce,
    clientInstanceID: `native-${randomUUID()}`,
    clientVersion: "test-native-host",
  }
  client.send({
    type: "hello",
    protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
    ...proofInput,
    proof: proofFor(String(bootstrap.proof), proofInput),
    nativeHostName: ANYBOX_CHROME_NATIVE_HOST_NAME,
    extensionID: ANYBOX_CHROME_EXTENSION_ID,
  })
  return { challenge, client, response: await client.next() }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) {
      throw new Error("Timed out waiting for Browser IPC test state.")
    }
    await Bun.sleep(10)
  }
}

describe("Browser IPC Gateway transport and authentication", () => {
  test("uses separate local endpoints and secret-free public status", async () => {
    const { bootstrapPath, gateway, root } = gatewayFixture()
    await gateway.start()

    expect(gateway.runtimeEndpoint).not.toBe(gateway.nativeHostEndpoint)
    expect(gateway.runtimeEndpoint.startsWith("\\\\.\\pipe\\")).toBe(
      process.platform === "win32",
    )
    expect(gateway.status()).toMatchObject({
      running: true,
      runtimeConnections: 0,
      nativeHostConnections: 0,
      legacyHttpTransportEnabled: false,
      legacyWebSocketTransportEnabled: false,
      peerProcessIdentityVerified: false,
    })
    const bootstrap = JSON.parse(readFileSync(bootstrapPath, "utf8")) as JsonRecord
    expect(bootstrap).toMatchObject({
      protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
      role: "native-host",
      brokerInstanceID: gateway.brokerInstanceID,
      endpoint: gateway.nativeHostEndpoint,
    })
    expect(typeof bootstrap.proof).toBe("string")
    expect(typeof bootstrap.expiresAt).toBe("number")

    if (process.platform !== "win32") {
      expect(statSync(root).mode & 0o777).toBe(0o700)
      expect(statSync(gateway.runtimeEndpoint).mode & 0o777).toBe(0o600)
      expect(statSync(gateway.nativeHostEndpoint).mode & 0o777).toBe(0o600)
      expect(statSync(bootstrapPath).mode & 0o777).toBe(0o600)
    }
  })

  test("rejects messages before hello and incompatible identities", async () => {
    const { gateway } = gatewayFixture()
    await gateway.start()

    const beforeHello = await connect(gateway.runtimeEndpoint)
    await beforeHello.next()
    beforeHello.send({
      type: "runtime.request",
      requestID: "before-hello",
      operation: "status",
    })
    expect(await beforeHello.next()).toMatchObject({
      type: "error",
      code: "HELLO_REQUIRED",
    })

    const protocol = await authenticateRuntime(gateway, { protocolVersion: 99 })
    expect(protocol.response).toMatchObject({
      type: "error",
      code: "PROTOCOL_MISMATCH",
    })

    const role = await authenticateRuntime(gateway, { role: "native-host" })
    expect(role.response).toMatchObject({
      type: "error",
      code: "ROLE_MISMATCH",
    })

    const broker = await authenticateRuntime(gateway, {
      brokerInstanceID: "stale-broker",
    })
    expect(broker.response).toMatchObject({
      type: "error",
      code: "BROKER_STALE",
    })

    const proof = await authenticateRuntime(gateway, { proof: "x".repeat(32) })
    expect(proof.response).toMatchObject({
      type: "error",
      code: "AUTH_FAILED",
    })
  })

  test("rejects replayed hello and role confusion while routing application methods to policy", async () => {
    const { gateway } = gatewayFixture()
    await gateway.start()

    const authenticated = await authenticateRuntime(gateway)
    expect(authenticated.response).toMatchObject({
      type: "ready",
      role: "runtime",
      applicationCapabilities: {
        runtimeOperations: ["status", "getInfo", "command"],
        browserContractVersions: [1],
      },
    })

    authenticated.client.send({
      type: "runtime.request",
      requestID: "raw-script",
      operation: "command",
      contractVersion: 1,
      method: "page.executeScript",
      params: { script: "document.title" },
    })
    expect(await authenticated.client.next()).toMatchObject({
      type: "runtime.response",
      requestID: "raw-script",
      ok: false,
      error: {
        code: "COMMAND_NOT_SUPPORTED",
      },
    })
    authenticated.client.send({
      type: "runtime.request",
      requestID: "still-open",
      operation: "status",
    })
    expect(await authenticated.client.next()).toMatchObject({
      type: "runtime.response",
      requestID: "still-open",
      ok: true,
    })

    const unknownType = await authenticateRuntime(gateway)
    expect(unknownType.response.type).toBe("ready")
    unknownType.client.send({ type: "runtime.unknown" })
    expect(await unknownType.client.next()).toMatchObject({
      type: "error",
      code: "UNKNOWN_MESSAGE_TYPE",
    })

    const runtimeRoleConfusion = await authenticateRuntime(gateway)
    expect(runtimeRoleConfusion.response.type).toBe("ready")
    runtimeRoleConfusion.client.send({
      type: "native.message",
      message: { type: "hello" },
    })
    expect(await runtimeRoleConfusion.client.next()).toMatchObject({
      type: "error",
      code: "ROLE_FORBIDDEN",
    })

    const replayClient = await connect(gateway.runtimeEndpoint)
    await replayClient.next()
    replayClient.send(authenticated.hello)
    expect(await replayClient.next()).toMatchObject({
      type: "error",
      code: "HANDSHAKE_EXPIRED",
    })
  })

  test("consumes, expires, and rotates Native Host bootstrap proofs", async () => {
    let now = 10_000
    const { bootstrapPath, gateway } = gatewayFixture({
      now: () => now,
      nativeBootstrapTtlMs: 1_000,
    })
    await gateway.start()
    const original = JSON.parse(readFileSync(bootstrapPath, "utf8")) as JsonRecord

    const first = await authenticateNative(gateway, original)
    expect(first.response).toMatchObject({ type: "ready", role: "native-host" })
    expect(existsSync(bootstrapPath)).toBe(false)

    const replay = await authenticateNative(gateway, original)
    expect(replay.response).toMatchObject({
      type: "error",
      code: "AUTH_FAILED",
    })

    first.client.close()
    await waitFor(() => existsSync(bootstrapPath))
    const rotated = JSON.parse(readFileSync(bootstrapPath, "utf8")) as JsonRecord
    expect(rotated.proof).not.toBe(original.proof)

    const expiringClient = await connect(gateway.nativeHostEndpoint)
    const challenge = await expiringClient.next() as unknown as BrowserIpcChallengeMessage
    now += 2_000
    const proofInput = {
      role: "native-host" as const,
      brokerInstanceID: gateway.brokerInstanceID,
      nonce: challenge.nonce,
      clientInstanceID: "expired-native",
      clientVersion: "test-native-host",
    }
    expiringClient.send({
      type: "hello",
      protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
      ...proofInput,
      proof: proofFor(String(rotated.proof), proofInput),
      nativeHostName: ANYBOX_CHROME_NATIVE_HOST_NAME,
      extensionID: ANYBOX_CHROME_EXTENSION_ID,
    })
    expect(await expiringClient.next()).toMatchObject({
      type: "error",
      code: "HANDSHAKE_EXPIRED",
    })
  })

  test("routes runtime commands through the plugin Browser Host with context and ownership", async () => {
    const { bridge, gateway } = gatewayFixture()
    await gateway.start()
    const native = await authenticateNative(gateway)
    expect(native.response.type).toBe("ready")
    native.client.send({
      type: "native.message",
      message: {
        type: "hello",
        protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
        extensionInstanceID: "extension-profile-a",
        extensionID: ANYBOX_CHROME_EXTENSION_ID,
        version: "0.1.1",
      },
    })
    await waitFor(() => bridge.status().connected)

    const runtime = await authenticateRuntime(gateway)
    expect(runtime.response.type).toBe("ready")

    runtime.client.send({
      type: "runtime.request",
      requestID: "public-status",
      operation: "status",
    })
    const publicStatus = await runtime.client.next()
    expect(publicStatus).toMatchObject({
      type: "runtime.response",
      requestID: "public-status",
      ok: true,
      data: {
        connected: true,
        contractCompatible: true,
        backendVersion: "0.1.1",
        protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
        runtimeConnections: 1,
        nativeHostConnections: 1,
      },
    })
    const publicStatusText = JSON.stringify(publicStatus)
    for (const internalField of [
      "brokerInstanceID",
      "activeSessionID",
      "ownedTabs",
      "lastCommand",
      "connectionID",
      "extensionInstanceID",
      "lastTransportError",
    ]) {
      expect(publicStatusText).not.toContain(internalField)
    }

    runtime.client.send({
      type: "runtime.request",
      requestID: "backend-info",
      operation: "getInfo",
      contractVersion: 1,
    })
    const backendInfoResponse = await runtime.client.next()
    expect(backendInfoResponse).toMatchObject({
      type: "runtime.response",
      requestID: "backend-info",
      ok: true,
      data: {
        backend: {
          contractVersion: 1,
          browserId: "extension",
          kind: "extension",
          connected: true,
          protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
          backendVersion: "0.1.1",
          capabilities: {
            features: {
              ownership: false,
              claim: false,
              locator: false,
              cancel: false,
              arbitraryJavaScript: false,
              scopedCdp: false,
              fullCdp: false,
            },
          },
        },
        apiManifest: {
          contractVersion: 1,
        },
        documentationManifest: {
          contractVersion: 1,
        },
      },
    })
    const infoData = backendInfoResponse.data as JsonRecord
    const backend = infoData.backend as JsonRecord
    const capabilities = backend.capabilities as JsonRecord
    const advertisedMethods = capabilities.commands as string[]
    const apiManifest = infoData.apiManifest as JsonRecord
    const documentationManifest = infoData.documentationManifest as JsonRecord
    expect((apiManifest.commands as JsonRecord[]).map((entry) => entry.method))
      .toEqual(advertisedMethods)
    expect((documentationManifest.entries as JsonRecord[]).map((entry) => entry.method))
      .toEqual(advertisedMethods)
    expect(advertisedMethods).toContain("tabs.list")
    expect(advertisedMethods).not.toContain("page.executeScript")
    expect(advertisedMethods).not.toContain("cdp.send")

    runtime.client.send({
      type: "runtime.request",
      requestID: "future-runtime-info",
      operation: "getInfo",
      contractVersion: 2,
    })
    expect(await runtime.client.next()).toMatchObject({
      type: "runtime.response",
      requestID: "future-runtime-info",
      ok: false,
      error: {
        code: "CONTRACT_VERSION_UNSUPPORTED",
      },
    })

    runtime.client.send({
      type: "runtime.request",
      requestID: "open-tab",
      operation: "command",
      contractVersion: 1,
      method: "tabs.open",
      params: { url: "https://example.com/" },
      context: {
        sessionID: "session-1",
        messageID: "message-1",
        toolCallID: "tool-1",
      },
    })

    const forwarded = await native.client.next()
    expect(forwarded).toMatchObject({
      type: "native.message",
      message: {
        type: "command",
        method: "tabs.open",
        params: { url: "https://example.com/" },
        context: {
          sessionID: "session-1",
          messageID: "message-1",
          toolCallID: "tool-1",
        },
      },
    })
    const command = forwarded.message as JsonRecord
    native.client.send({
      type: "native.message",
      message: {
        type: "result",
        commandID: command.commandID,
        ok: true,
        data: {
          id: 42,
          title: "Example",
          url: "https://example.com/",
        },
      },
    })

    expect(await runtime.client.next()).toMatchObject({
      type: "runtime.response",
      requestID: "open-tab",
      ok: true,
      data: { id: 42 },
    })
    expect(bridge.status()).toMatchObject({
      activeSessionID: "session-1",
      ownedTabs: [{
        tabId: 42,
        sessionID: "session-1",
      }],
      lastCommand: {
        method: "tabs.open",
        sessionID: "session-1",
        messageID: "message-1",
        toolCallID: "tool-1",
        ok: true,
      },
    })
  })

  test("filters getInfo manifests to capabilities negotiated by the extension", async () => {
    const { bridge, gateway } = gatewayFixture()
    await gateway.start()
    const native = await authenticateNative(gateway)
    native.client.send({
      type: "native.message",
      message: {
        type: "hello",
        protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
        extensionInstanceID: "extension-capabilities",
        extensionID: ANYBOX_CHROME_EXTENSION_ID,
        version: "0.2.0",
        capabilities: {
          contractVersion: 1,
          commands: ["tabs.list", "page.executeScript", "page.future"],
        },
      },
    })
    await waitFor(() => bridge.status().connected)

    const runtime = await authenticateRuntime(gateway)
    runtime.client.send({
      type: "runtime.request",
      requestID: "negotiated-info",
      operation: "getInfo",
      contractVersion: 1,
    })
    const response = await runtime.client.next()
    const data = response.data as JsonRecord
    const backend = data.backend as JsonRecord
    const capabilities = backend.capabilities as JsonRecord
    const apiManifest = data.apiManifest as JsonRecord
    const documentationManifest = data.documentationManifest as JsonRecord
    expect(capabilities.commands).toEqual(["tabs.list"])
    expect((apiManifest.commands as JsonRecord[]).map((entry) => entry.method))
      .toEqual(["tabs.list"])
    expect((documentationManifest.entries as JsonRecord[]).map((entry) => entry.method))
      .toEqual(["tabs.list"])
  })

  test("returns a stable getInfo error for an incompatible extension contract", async () => {
    const { bridge, gateway } = gatewayFixture()
    await gateway.start()
    const native = await authenticateNative(gateway)
    native.client.send({
      type: "native.message",
      message: {
        type: "hello",
        protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
        extensionInstanceID: "extension-future-contract",
        extensionID: ANYBOX_CHROME_EXTENSION_ID,
        version: "0.2.0",
        capabilities: {
          contractVersion: 2,
          commands: ["tabs.list"],
        },
      },
    })
    await waitFor(() => {
      const compatibility = bridge.browserContractCompatibility()
      return compatibility.connected && !compatibility.compatible
    })

    const runtime = await authenticateRuntime(gateway)
    runtime.client.send({
      type: "runtime.request",
      requestID: "incompatible-info",
      operation: "getInfo",
      contractVersion: 1,
    })
    expect(await runtime.client.next()).toMatchObject({
      type: "runtime.response",
      requestID: "incompatible-info",
      ok: false,
      error: {
        code: "CONTRACT_VERSION_UNSUPPORTED",
        retryable: false,
      },
    })
  })

  test("returns stable validation errors without forwarding malformed commands", async () => {
    const { bridge, gateway } = gatewayFixture()
    await gateway.start()
    const native = await authenticateNative(gateway)
    expect(native.response.type).toBe("ready")
    native.client.send({
      type: "native.message",
      message: {
        type: "hello",
        protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
        extensionInstanceID: "extension-validation",
        extensionID: ANYBOX_CHROME_EXTENSION_ID,
        version: "0.1.1",
      },
    })
    await waitFor(() => bridge.status().connected)

    const runtime = await authenticateRuntime(gateway)
    expect(runtime.response.type).toBe("ready")
    runtime.client.send({
      type: "runtime.request",
      requestID: "future-contract-version",
      operation: "command",
      contractVersion: 2,
      method: "tabs.list",
      params: {},
    })
    expect(await runtime.client.next()).toMatchObject({
      type: "runtime.response",
      requestID: "future-contract-version",
      ok: false,
      error: {
        code: "CONTRACT_VERSION_UNSUPPORTED",
        retryable: false,
      },
    })

    runtime.client.send({
      type: "runtime.request",
      requestID: "invalid-list-params",
      operation: "command",
      contractVersion: 1,
      method: "tabs.list",
      params: { unexpected: true },
    })
    expect(await runtime.client.next()).toMatchObject({
      type: "runtime.response",
      requestID: "invalid-list-params",
      ok: false,
      error: {
        code: "INVALID_COMMAND_PARAMS",
        retryable: false,
      },
    })

    runtime.client.send({
      type: "runtime.request",
      requestID: "invalid-list-result",
      operation: "command",
      contractVersion: 1,
      method: "tabs.list",
      params: {},
    })
    const forwarded = await native.client.next()
    expect(forwarded).toMatchObject({
      type: "native.message",
      message: {
        type: "command",
        method: "tabs.list",
        params: {},
      },
    })
    const command = forwarded.message as JsonRecord
    native.client.send({
      type: "native.message",
      message: {
        type: "result",
        commandID: command.commandID,
        ok: true,
        data: {
          tabs: [{ id: 0, active: true }],
        },
      },
    })
    expect(await runtime.client.next()).toMatchObject({
      type: "runtime.response",
      requestID: "invalid-list-result",
      ok: false,
      error: {
        code: "INVALID_COMMAND_RESULT",
        retryable: false,
      },
    })

    runtime.client.send({
      type: "runtime.request",
      requestID: "extension-validation-error",
      operation: "command",
      contractVersion: 1,
      method: "tabs.list",
      params: {},
    })
    const rejectedForward = await native.client.next()
    const rejectedCommand = rejectedForward.message as JsonRecord
    native.client.send({
      type: "native.message",
      message: {
        type: "result",
        commandID: rejectedCommand.commandID,
        ok: false,
        error: "Extension result does not match the Browser Contract.",
        code: "INVALID_COMMAND_RESULT",
        retryable: false,
      },
    })
    expect(await runtime.client.next()).toMatchObject({
      type: "runtime.response",
      requestID: "extension-validation-error",
      ok: false,
      error: {
        code: "INVALID_COMMAND_RESULT",
        retryable: false,
      },
    })
  })

  test("keeps runtime and Native Host roles on separate methods", async () => {
    const { gateway } = gatewayFixture()
    await gateway.start()
    const native = await authenticateNative(gateway)
    expect(native.response.type).toBe("ready")
    native.client.send({
      type: "runtime.request",
      requestID: "native-cannot-command",
      operation: "status",
    })
    expect(await native.client.next()).toMatchObject({
      type: "error",
      code: "ROLE_FORBIDDEN",
    })
  })

  test("rebinds endpoints with fresh credentials across a Browser Host restart", async () => {
    const { bootstrapPath, bridge, gateway } = gatewayFixture()
    await gateway.start()
    const runtime = await authenticateRuntime(gateway)
    expect(runtime.response.type).toBe("ready")
    expect(gateway.status().runtimeConnections).toBe(1)
    const oldBrokerInstanceID = gateway.brokerInstanceID
    const oldRuntimeProof = gateway.runtimeProof

    await gateway.stop()
    expect(gateway.status()).toMatchObject({
      running: false,
      runtimeConnections: 0,
      nativeHostConnections: 0,
    })
    await Bun.sleep(50)
    const restarted = new BrowserIpcGateway({
      bootstrapPath,
      bridge,
      brokerInstanceID: `restarted-${randomUUID()}`,
      nativeHostEndpoint: gateway.nativeHostEndpoint,
      runtimeEndpoint: gateway.runtimeEndpoint,
      runtimeProof: `restarted-proof-${randomUUID()}`,
    })
    try {
      await restarted.start()

      const stale = await connect(restarted.runtimeEndpoint)
      const challenge = await stale.next() as unknown as BrowserIpcChallengeMessage
      const staleProofInput = {
        role: "runtime" as const,
        brokerInstanceID: oldBrokerInstanceID,
        nonce: challenge.nonce,
        clientInstanceID: `stale-runtime-${randomUUID()}`,
        clientVersion: "test-runtime",
      }
      stale.send({
        type: "hello",
        protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
        ...staleProofInput,
        proof: proofFor(oldRuntimeProof, staleProofInput),
      })
      expect(await stale.next()).toMatchObject({
        type: "error",
        code: "BROKER_STALE",
      })

      const reconnected = await authenticateRuntime(restarted)
      expect(reconnected.response).toMatchObject({ type: "ready", role: "runtime" })
      const native = await authenticateNative(restarted)
      expect(native.response).toMatchObject({ type: "ready", role: "native-host" })
    } finally {
      await restarted.stop()
    }
  })

  test("marks unsupported operating systems explicitly", () => {
    expect(() => defaultBrowserIpcPaths("aix")).toThrow(
      "Browser IPC is unsupported on platform 'aix'",
    )
  })
})
