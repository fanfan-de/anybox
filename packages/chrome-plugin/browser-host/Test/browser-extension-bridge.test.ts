import { describe, expect, test } from "bun:test"
import {
  ANYBOX_CHROME_EXTENSION_ID,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
} from "@anybox/chrome-shared/browser-extension"
import {
  BROWSER_CONTRACT_V1_VERSION,
  BROWSER_CONTRACT_VERSION,
} from "@anybox/chrome-shared/browser-contract"
import { BrowserExtensionBridge } from "../src/bridge.ts"

type SentCommand = {
  type: "command"
  commandID: string
  contractVersion: number
}

function createSocket() {
  const messages: unknown[] = []
  const closes: Array<{ code?: number; reason?: string }> = []

  return {
    closes,
    messages,
    socket: {
      send(data: string) {
        messages.push(JSON.parse(data))
      },
      close(code?: number, reason?: string) {
        closes.push({ code, reason })
      },
    },
  }
}

function registerReady(
  bridge: BrowserExtensionBridge,
  socket: ReturnType<typeof createSocket>,
  instanceID: string,
) {
  const connectionID = bridge.register(socket.socket, { transport: "native" })
  bridge.handleRawMessage(connectionID, {
    type: "hello",
    protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
    extensionInstanceID: instanceID,
    extensionID: ANYBOX_CHROME_EXTENSION_ID,
    version: "0.1.0",
  })
  return connectionID
}

describe("BrowserExtensionBridge command result ownership", () => {
  test("does not route commands until the authenticated connection completes hello", async () => {
    const bridge = new BrowserExtensionBridge()
    const connection = createSocket()
    bridge.register(connection.socket, { transport: "native" })

    expect(bridge.status()).toMatchObject({
      connected: false,
      connectionCount: 1,
    })
    await expect(bridge.sendCommand("tabs.list")).rejects.toThrow(
      "No Chrome extension is connected to Anybox.",
    )
  })

  test("accepts only the packaged Chrome extension identity", () => {
    const bridge = new BrowserExtensionBridge()
    const rejected = createSocket()
    const rejectedConnectionID = bridge.register(rejected.socket, { transport: "native" })

    bridge.handleRawMessage(rejectedConnectionID, {
      type: "hello",
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      extensionInstanceID: "forged-instance",
      extensionID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      version: "0.1.0",
    })

    expect(rejected.closes).toEqual([{
      code: 1008,
      reason: "Browser extension identity is invalid.",
    }])
    expect(bridge.status().connectionCount).toBe(0)

    const accepted = createSocket()
    const acceptedConnectionID = bridge.register(accepted.socket, { transport: "native" })
    bridge.handleRawMessage(acceptedConnectionID, {
      type: "hello",
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      extensionInstanceID: "real-instance",
      extensionID: ANYBOX_CHROME_EXTENSION_ID,
      version: "0.1.0",
    })

    expect(accepted.closes).toEqual([])
    expect(bridge.status().active).toMatchObject({
      extensionID: ANYBOX_CHROME_EXTENSION_ID,
      extensionInstanceID: "real-instance",
      transport: "native",
    })
  })

  test("keeps the first ready connection active until it disconnects", () => {
    const bridge = new BrowserExtensionBridge()
    const first = createSocket()
    const second = createSocket()
    const firstConnectionID = registerReady(bridge, first, "first-instance")
    registerReady(bridge, second, "second-instance")

    expect(bridge.status().active).toMatchObject({
      extensionInstanceID: "first-instance",
    })

    bridge.unregister(firstConnectionID)
    expect(bridge.status().active).toMatchObject({
      extensionInstanceID: "second-instance",
    })
  })

  test("pings healthy backends and disconnects a stale heartbeat", () => {
    const bridge = new BrowserExtensionBridge()
    const connection = createSocket()
    registerReady(bridge, connection, "heartbeat-instance")

    expect(bridge.heartbeat(Date.now())).toEqual({
      pinged: 1,
      disconnected: 0,
    })
    expect(connection.messages.at(-1)).toMatchObject({
      type: "ping",
    })

    expect(bridge.heartbeat(Date.now() + 40_001)).toEqual({
      pinged: 0,
      disconnected: 1,
    })
    expect(connection.closes).toContainEqual({
      code: 1011,
      reason: "Browser extension heartbeat timed out.",
    })
    expect(bridge.status().connected).toBe(false)
  })

  test("fails closed on a mismatched advertised Browser Contract version", () => {
    const bridge = new BrowserExtensionBridge()
    const connection = createSocket()
    const connectionID = bridge.register(connection.socket, {
      transport: "native",
    })
    bridge.handleRawMessage(connectionID, {
      type: "hello",
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      extensionInstanceID: "future-contract",
      extensionID: ANYBOX_CHROME_EXTENSION_ID,
      version: "0.2.0",
      capabilities: {
        contractVersion: BROWSER_CONTRACT_VERSION + 1,
        commands: ["tabs.list"],
      },
    })

    expect(bridge.backendInfo().capabilities.commands).toEqual([])
    expect(bridge.browserContractCompatibility()).toEqual({
      connected: true,
      compatible: false,
      advertisedVersion: BROWSER_CONTRACT_VERSION + 1,
    })
  })

  test("prefers a compatible backend that connects after an incompatible one", () => {
    const bridge = new BrowserExtensionBridge()
    const incompatible = createSocket()
    const incompatibleID = bridge.register(incompatible.socket, {
      transport: "native",
    })
    bridge.handleRawMessage(incompatibleID, {
      type: "hello",
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      extensionInstanceID: "incompatible-first",
      extensionID: ANYBOX_CHROME_EXTENSION_ID,
      version: "0.2.0",
      capabilities: {
        contractVersion: BROWSER_CONTRACT_VERSION + 1,
        commands: ["tabs.list"],
      },
    })

    const compatible = createSocket()
    const compatibleID = bridge.register(compatible.socket, {
      transport: "native",
    })
    bridge.handleRawMessage(compatibleID, {
      type: "hello",
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      extensionInstanceID: "compatible-second",
      extensionID: ANYBOX_CHROME_EXTENSION_ID,
      version: "0.2.0",
      capabilities: {
        contractVersion: BROWSER_CONTRACT_VERSION,
        commands: ["tabs.list"],
      },
    })

    expect(bridge.status().active).toMatchObject({
      extensionInstanceID: "compatible-second",
    })
    expect(bridge.backendInfo().capabilities.commands).toEqual(["tabs.list"])
    expect(bridge.browserContractCompatibility()).toMatchObject({
      connected: true,
      compatible: true,
    })
  })

  test("rechecks the selected connection capability immediately before dispatch", async () => {
    const bridge = new BrowserExtensionBridge()
    const limited = createSocket()
    const connectionID = bridge.register(limited.socket, {
      transport: "native",
    })
    bridge.handleRawMessage(connectionID, {
      type: "hello",
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      extensionInstanceID: "limited-capability",
      extensionID: ANYBOX_CHROME_EXTENSION_ID,
      version: "0.2.0",
      capabilities: {
        contractVersion: BROWSER_CONTRACT_VERSION,
        commands: ["tabs.list"],
      },
    })

    await expect(bridge.sendCommand("page.screenshot", {
      tabId: 7,
    })).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
      retryable: false,
    })
    expect(limited.messages).toEqual([])
  })

  test.each([
    {
      name: "successful",
      forgedResult: { ok: true as const, data: "forged" },
    },
    {
      name: "failed",
      forgedResult: { ok: false as const, error: "forged failure" },
    },
  ])("ignores a $name result from a connection that does not own the command", async ({ forgedResult }) => {
    const bridge = new BrowserExtensionBridge()
    const owner = createSocket()
    const ownerConnectionID = registerReady(bridge, owner, "owner-instance")
    const commandPromise = bridge.sendCommand("tabs.list", undefined, { timeoutMs: 1_000 })
    const command = owner.messages[0] as SentCommand
    expect(command.contractVersion).toBe(BROWSER_CONTRACT_V1_VERSION)

    const other = createSocket()
    const otherConnectionID = registerReady(bridge, other, "other-instance")
    let settled = false
    void commandPromise.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    bridge.handleRawMessage(otherConnectionID, {
      type: "result",
      commandID: command.commandID,
      ...forgedResult,
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(bridge.status().lastCommand).not.toHaveProperty("completedAt")

    bridge.handleRawMessage(ownerConnectionID, {
      type: "result",
      commandID: command.commandID,
      ok: true,
      data: "owner result",
    })

    await expect(commandPromise).resolves.toBe("owner result")
    expect(bridge.status().lastCommand).toMatchObject({
      commandID: command.commandID,
      ok: true,
    })
  })

  test("fails an owned pending command when its connection disconnects", async () => {
    const bridge = new BrowserExtensionBridge()
    const owner = createSocket()
    const ownerConnectionID = registerReady(
      bridge,
      owner,
      "disconnecting-owner",
    )
    const command = bridge.sendCommand("tabs.list", undefined, {
      timeoutMs: 1_000,
    })

    bridge.unregister(ownerConnectionID)

    await expect(command).rejects.toThrow(
      "Browser extension disconnected before returning a result.",
    )
    expect(bridge.status()).toMatchObject({
      connected: false,
      connectionCount: 0,
    })
  })

  test("classifies a Bridge timeout as a retryable deadline error", async () => {
    const bridge = new BrowserExtensionBridge()
    const owner = createSocket()
    registerReady(bridge, owner, "timing-out-owner")

    await expect(bridge.sendCommand("tabs.list", {}, {
      timeoutMs: 1,
    })).rejects.toMatchObject({
      code: "DEADLINE_EXCEEDED",
      retryable: true,
    })
  })
})
