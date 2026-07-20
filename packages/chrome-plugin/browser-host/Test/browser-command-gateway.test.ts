import { describe, expect, test } from "bun:test"
import {
  BROWSER_CONTRACT_COMMAND_METHODS,
  BROWSER_CONTRACT_VERSION,
  createBrowserBackendInfo,
} from "@anybox/chrome-shared/browser-contract"
import type { BrowserExtensionBridge } from "../src/bridge.ts"
import {
  backendGatewayError,
  runBrowserRuntimeCommand,
} from "../src/command-gateway.ts"
import { BrowserPolicyEngine } from "../src/browser-policy.ts"

function context() {
  return {
    sessionID: "session-gateway",
    turnID: "turn-gateway",
    messageID: "message-gateway",
    toolCallID: "tool-gateway",
    browserID: "extension:gateway",
  }
}

function bridgeStub(input: {
  connected?: boolean
  commands?: Parameters<typeof createBrowserBackendInfo>[0]["commands"]
  events?: string[]
}) {
  const events = input.events ?? []
  return {
    backendInfo: () => createBrowserBackendInfo({
      connected: input.connected ?? true,
      browserId: "extension:gateway",
      instanceID: "gateway",
      commands: input.commands ?? BROWSER_CONTRACT_COMMAND_METHODS,
    }),
    sendCommand: async (method: string) => {
      events.push(`bridge:${method}`)
      return { tabs: [] }
    },
    markOwnedTab: () => events.push("ownership:mark"),
    touchTab: () => events.push("ownership:touch"),
    releaseOwnedTab: () => false,
  } as unknown as BrowserExtensionBridge
}

describe("Browser command gateway contract boundary", () => {
  test.each([2, BROWSER_CONTRACT_VERSION + 1])(
    "rejects contract version %i instead of negotiating",
    async (contractVersion) => {
      const events: string[] = []
      await expect(runBrowserRuntimeCommand({
        contractVersion,
        method: "tabs.list",
        params: {},
        context: context(),
      }, bridgeStub({ events }))).rejects.toMatchObject({
        code: "CONTRACT_VERSION_UNSUPPORTED",
        retryable: false,
      })
      expect(events).toEqual([])
    },
  )

  test("rejects a missing contract version", async () => {
    await expect(runBrowserRuntimeCommand({
      method: "tabs.list",
      params: {},
      context: context(),
    } as never, bridgeStub({}))).rejects.toMatchObject({
      code: "CONTRACT_VERSION_UNSUPPORTED",
      retryable: false,
    })
  })

  test("rejects malformed v3 params before authorization or dispatch", async () => {
    const events: string[] = []
    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      params: { unexpected: true },
      context: context(),
    }, bridgeStub({ events }))).rejects.toMatchObject({
      code: "INVALID_COMMAND_PARAMS",
      retryable: false,
    })
    expect(events).toEqual([])
  })

  test("requires the complete v3 execution context", async () => {
    const events: string[] = []
    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      params: {},
      context: { sessionID: "incomplete" },
    }, bridgeStub({ events }))).rejects.toMatchObject({
      code: "SESSION_REQUIRED",
      retryable: false,
    })
    expect(events).toEqual([])
  })

  test("rejects raw JavaScript at the contract boundary", async () => {
    const events: string[] = []
    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "page.executeScript",
      params: { tabId: 7, script: "document.title" },
      context: context(),
    } as never, bridgeStub({ events }))).rejects.toMatchObject({
      code: "COMMAND_NOT_SUPPORTED",
    })
    expect(events).toEqual([])
  })

  test("authoritatively rejects unavailable capabilities and backends", async () => {
    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      params: {},
      context: context(),
    }, bridgeStub({ commands: [] }), new BrowserPolicyEngine()))
      .rejects.toMatchObject({
        code: "CAPABILITY_UNAVAILABLE",
        retryable: false,
      })

    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      params: {},
      context: context(),
    }, bridgeStub({ connected: false }), new BrowserPolicyEngine()))
      .rejects.toMatchObject({
        code: "BACKEND_UNAVAILABLE",
        retryable: true,
      })
  })

  test("requires an authorization receipt before extension dispatch", async () => {
    const events: string[] = []
    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      params: {},
      context: context(),
    }, bridgeStub({ events }), new BrowserPolicyEngine(), "test-public-key"))
      .rejects.toMatchObject({
        code: "APPROVAL_REQUIRED",
        retryable: true,
        details: {
          challenge: {
            method: "tabs.list",
            browserID: "extension:gateway",
          },
        },
      })
    expect(events).toEqual([])
  })
})

describe("Browser command gateway policy and transport errors", () => {
  test("publishes explicit enforcement metadata", () => {
    const decision = new BrowserPolicyEngine().authorize({
      method: "page.screenshot",
      params: { tabId: 7 },
      backend: createBrowserBackendInfo({
        connected: true,
        commands: ["page.screenshot"],
      }),
    })
    expect(decision).toMatchObject({
      method: "page.screenshot",
      security: "page-content-read",
      capabilityChecked: true,
      ownershipEnforced: true,
      perActionApprovalEnforced: true,
      permissionAction: "allow",
      risk: "low",
      sensitive: false,
    })

    const localFile = new BrowserPolicyEngine().authorize({
      method: "playwright.fileChooser.setFiles",
      params: {
        tabId: 7,
        eventID: "00000000-0000-4000-8000-000000000001",
        files: ["C:\\private\\upload.txt"],
      },
      backend: createBrowserBackendInfo({
        connected: true,
        commands: BROWSER_CONTRACT_COMMAND_METHODS,
      }),
      origin: "https://example.com",
    })
    expect(localFile).toMatchObject({
      security: "local-file-read",
      permissionAction: "ask",
      risk: "high",
      sensitive: true,
    })
  })

  test("never marks interrupted non-idempotent actions as retryable", () => {
    expect(backendGatewayError(
      new Error("extension transport closed"),
      "playwright.locator.click",
    )).toMatchObject({
      code: "ACTION_OUTCOME_UNKNOWN",
      retryable: false,
      details: {
        phase: "transport",
        action: "playwright.locator.click",
      },
    })
    expect(backendGatewayError(
      new Error("extension transport closed"),
      "playwright.locator.count",
    )).toMatchObject({
      code: "COMMAND_FAILED",
      retryable: true,
    })
    const timeout = Object.assign(new Error("bridge timed out"), {
      code: "DEADLINE_EXCEEDED",
      retryable: true,
    })
    expect(backendGatewayError(
      timeout,
      "playwright.locator.fill",
    )).toMatchObject({
      code: "ACTION_OUTCOME_UNKNOWN",
      retryable: false,
      details: {
        phase: "transport-timeout",
        action: "playwright.locator.fill",
      },
    })
  })
})
