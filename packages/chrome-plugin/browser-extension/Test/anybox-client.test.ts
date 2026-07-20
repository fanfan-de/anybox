import { expect, test } from "bun:test"
import { BrowserExtensionServerMessage } from "@anybox/chrome-shared/browser-extension"
import {
  supportsBrowserCommandContractVersion,
} from "../src/background/browser-contract-compat"

test("accepts a legacy Browser Host command envelope while rejecting an explicit future contract", () => {
  const legacy = BrowserExtensionServerMessage.parse({
    type: "command",
    commandID: "legacy-command",
    method: "tabs.list",
    params: {},
  })

  expect(legacy.type).toBe("command")
  if (legacy.type !== "command") throw new Error("Expected a browser command.")
  expect(legacy.contractVersion).toBeUndefined()
  expect(supportsBrowserCommandContractVersion(legacy.contractVersion)).toBe(true)
  expect(supportsBrowserCommandContractVersion(2)).toBe(true)
  expect(supportsBrowserCommandContractVersion(3)).toBe(false)
})

test("marks Native transport connected only after helloAck and drops a stale heartbeat", async () => {
  const localStorage: Record<string, unknown> = {
    ANYBOX_EXTENSION_INSTANCE_ID: "extension-handshake-test",
  }
  const posted: unknown[] = []
  let onMessage: ((message: unknown) => void) | undefined
  let onAlarm: ((alarm: { name?: string }) => void) | undefined
  let disconnected = false
  const port = {
    postMessage(message: unknown) {
      posted.push(message)
    },
    disconnect() {
      disconnected = true
    },
    onMessage: {
      addListener(listener: (message: unknown) => void) {
        onMessage = listener
      },
    },
    onDisconnect: {
      addListener() {},
    },
  }
  ;(globalThis as any).chrome = {
    runtime: {
      id: "hjbejdmgpifdjjlpgmdfmbmbhkedgnjc",
      getManifest: () => ({ version: "0.11.2" }),
      connectNative: () => port,
      lastError: undefined,
    },
    storage: {
      local: {
        async get(key: string) {
          return { [key]: localStorage[key] }
        },
        async set(value: Record<string, unknown>) {
          Object.assign(localStorage, structuredClone(value))
        },
      },
      session: {
        async get(key: string) {
          return { [key]: undefined }
        },
        async set() {},
      },
    },
    alarms: {
      create() {},
      async clear() {
        return true
      },
      onAlarm: {
        addListener(listener: (alarm: { name?: string }) => void) {
          onAlarm = listener
        },
      },
    },
    debugger: {
      onDetach: {
        addListener() {},
      },
    },
  }
  ;(globalThis as any).self = globalThis
  const module = await import(
    `../src/background/anybox-client.ts?handshake=${Date.now()}`
  )
  module.connectAnybox()
  await waitFor(() => posted.some(
    (message) => (message as { type?: string }).type === "hello",
  ))
  expect(localStorage.ANYBOX_BRIDGE_STATUS).toMatchObject({
    state: "connecting",
  })

  onMessage?.({
    type: "helloAck",
    protocolVersion: 1,
    contractVersion: 2,
    browserID: "extension:extension-handshake-test",
    extensionInstanceID: "extension-handshake-test",
    heartbeatIntervalMs: 30_000,
    heartbeatTimeoutMs: 10_000,
  })
  await waitFor(() =>
    (localStorage.ANYBOX_BRIDGE_STATUS as { state?: string })?.state
      === "connected"
  )
  expect(localStorage.ANYBOX_BRIDGE_STATUS).toMatchObject({
    state: "connected",
    protocolVersion: 1,
    contractVersion: 2,
    reconnectCount: 0,
  })

  const realNow = Date.now
  const heartbeatDeadline = realNow() + 40_001
  Date.now = () => heartbeatDeadline
  try {
    onAlarm?.({ name: "anybox-browser-health-v2" })
    await waitFor(() =>
      (localStorage.ANYBOX_BRIDGE_STATUS as { state?: string })?.state
        === "disconnected"
    )
  } finally {
    Date.now = realNow
  }
  expect(localStorage.ANYBOX_BRIDGE_STATUS).toMatchObject({
    state: "disconnected",
  })

  module.shutdownAnyboxClient()
  expect(disconnected).toBe(true)
})

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for client state.")
    await Bun.sleep(5)
  }
}
