import { describe, expect, test } from "bun:test"
import {
  BROWSER_CONTRACT_COMMAND_METHODS,
  BROWSER_CONTRACT_VERSION,
  createBrowserBackendInfo,
} from "@anybox/shared/browser-contract"
import type { BrowserExtensionBridge } from "#browser-extension/bridge.ts"
import {
  BrowserCommandGatewayError,
  runBrowserRuntimeCommand,
} from "#browser-extension/command-gateway.ts"
import {
  BrowserPolicyEngine,
  type BrowserPolicyEngine as BrowserPolicyEngineType,
} from "#browser-extension/browser-policy.ts"

function bridgeStub(input: {
  connected?: boolean
  commands?: Parameters<typeof createBrowserBackendInfo>[0]["commands"]
  preferredTabID?: number
  events?: string[]
  sendCommand?: (
    method: string,
    params: unknown,
  ) => Promise<unknown>
  releaseOwnedTab?: (tabId: number, sessionID?: string) => boolean
}) {
  const events = input.events ?? []
  return {
    backendInfo: () => createBrowserBackendInfo({
      connected: input.connected ?? true,
      commands: input.commands ?? BROWSER_CONTRACT_COMMAND_METHODS,
    }),
    preferredTabID: () => input.preferredTabID,
    sendCommand: async (method: string, params: unknown) => {
      events.push(`bridge:${method}`)
      if (input.sendCommand) return await input.sendCommand(method, params)
      return { tabs: [] }
    },
    releaseOwnedTab: (tabId: number, sessionID?: string) => {
      events.push("bridge:tabs.release")
      return input.releaseOwnedTab?.(tabId, sessionID) ?? false
    },
    markOwnedTab: () => events.push("ownership:mark"),
    touchTab: () => events.push("ownership:touch"),
  } as unknown as BrowserExtensionBridge
}

function recordingPolicy(events: string[]) {
  return {
    authorize(input: { method: string }) {
      events.push(`policy:${input.method}`)
    },
  } as unknown as BrowserPolicyEngineType
}

describe("Browser command gateway contract and policy order", () => {
  test("validates v1 params, applies policy, routes, then validates the result", async () => {
    const events: string[] = []
    const bridge = bridgeStub({
      events,
      sendCommand: async (method, params) => {
        expect(method).toBe("tabs.list")
        expect(params).toEqual({})
        return {
          tabs: [{
            id: 7,
            active: true,
            title: "Fixture",
            url: "https://fixture.invalid/",
          }],
        }
      },
    })

    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      params: {},
    }, bridge, recordingPolicy(events))).resolves.toEqual({
      tabs: [{
        id: 7,
        active: true,
        title: "Fixture",
        url: "https://fixture.invalid/",
      }],
    })
    expect(events).toEqual([
      "policy:tabs.list",
      "bridge:tabs.list",
      "ownership:touch",
    ])
  })

  test("rejects malformed v1 params before policy or bridge", async () => {
    const events: string[] = []
    const bridge = bridgeStub({ events })

    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      params: { unexpected: true },
    }, bridge, recordingPolicy(events))).rejects.toMatchObject({
      code: "INVALID_COMMAND_PARAMS",
      retryable: false,
    })
    expect(events).toEqual([])
  })

  test("rejects a future contract version with a specific stable error", async () => {
    const events: string[] = []
    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION + 1,
      method: "tabs.list",
      params: {},
    }, bridgeStub({ events }), recordingPolicy(events))).rejects.toMatchObject({
      code: "CONTRACT_VERSION_UNSUPPORTED",
      retryable: false,
    })
    expect(events).toEqual([])
  })

  test("rejects malformed backend results before ownership bookkeeping", async () => {
    const events: string[] = []
    const bridge = bridgeStub({
      events,
      sendCommand: async () => ({
        tabs: [{ id: 0, active: true }],
      }),
    })

    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      params: {},
    }, bridge, recordingPolicy(events))).rejects.toMatchObject({
      code: "INVALID_COMMAND_RESULT",
    })
    expect(events).toEqual([
      "policy:tabs.list",
      "bridge:tabs.list",
    ])
  })

  test("authoritatively rejects unavailable capabilities and disconnected backends", async () => {
    const noCapabilityEvents: string[] = []
    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      params: {},
    }, bridgeStub({
      events: noCapabilityEvents,
      commands: [],
    }), new BrowserPolicyEngine())).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
      retryable: false,
    })
    expect(noCapabilityEvents).toEqual([])

    const disconnectedEvents: string[] = []
    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      params: {},
    }, bridgeStub({
      connected: false,
      events: disconnectedEvents,
    }), new BrowserPolicyEngine())).rejects.toMatchObject({
      code: "BACKEND_UNAVAILABLE",
      retryable: true,
    })
    expect(disconnectedEvents).toEqual([])
  })

  test("rejects raw JavaScript at the Agent contract boundary", async () => {
    const events: string[] = []
    const request = {
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "page.executeScript",
      params: { tabId: 7, script: "document.title" },
    } as never

    await expect(runBrowserRuntimeCommand(
      request,
      bridgeStub({ events }),
      recordingPolicy(events),
    )).rejects.toMatchObject({
      code: "COMMAND_NOT_SUPPORTED",
    })
    expect(events).toEqual([])
  })

  test("keeps the legacy optional-tab adapter while v1 requires tabId", async () => {
    const v1Events: string[] = []
    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "page.screenshot",
      params: {},
    }, bridgeStub({ events: v1Events }), recordingPolicy(v1Events))).rejects.toMatchObject({
      code: "INVALID_COMMAND_PARAMS",
    })
    expect(v1Events).toEqual([])

    const legacyEvents: string[] = []
    const legacyBridge = bridgeStub({
      events: legacyEvents,
      sendCommand: async (method, params) => {
        if (method === "tabs.list") {
          expect(params).toEqual({})
          return {
            tabs: [
              { id: 8, active: false },
              { id: 9, active: true },
            ],
          }
        }
        expect(method).toBe("page.screenshot")
        expect(params).toEqual({ tabId: 9 })
        return {
          tabId: 9,
          mime: "image/png",
          data: "AA==",
        }
      },
    })

    await expect(runBrowserRuntimeCommand({
      method: "page.screenshot",
      params: {},
      context: { sessionID: "legacy-session" },
    }, legacyBridge, recordingPolicy(legacyEvents))).resolves.toEqual({
      tabId: 9,
      mime: "image/png",
      data: "AA==",
    })
    expect(legacyEvents).toEqual([
      "policy:tabs.list",
      "bridge:tabs.list",
      "policy:page.screenshot",
      "bridge:page.screenshot",
      "ownership:touch",
    ])
  })

  test("uses the legacy session-preferred tab without an active-tab lookup", async () => {
    const events: string[] = []
    const bridge = bridgeStub({
      events,
      preferredTabID: 12,
      sendCommand: async (method, params) => {
        expect(method).toBe("page.type")
        expect(params).toEqual({ tabId: 12, text: "hello" })
        return { tabId: 12, textLength: 5 }
      },
    })

    await expect(runBrowserRuntimeCommand({
      method: "page.type",
      params: { text: "hello" },
      context: { sessionID: "legacy-session" },
    }, bridge, recordingPolicy(events))).resolves.toEqual({
      tabId: 12,
      textLength: 5,
    })
    expect(events).toEqual([
      "policy:page.type",
      "bridge:page.type",
      "ownership:touch",
    ])
  })

  test("keeps legacy tabs.activate optional-tab behavior", async () => {
    const events: string[] = []
    const bridge = bridgeStub({
      events,
      preferredTabID: 12,
      sendCommand: async (method, params) => {
        expect(method).toBe("tabs.activate")
        expect(params).toEqual({ tabId: 12 })
        return {
          id: 12,
          active: true,
          title: "Legacy current tab",
        }
      },
    })

    await expect(runBrowserRuntimeCommand({
      method: "tabs.activate",
      params: {},
      context: { sessionID: "legacy-session" },
    }, bridge, recordingPolicy(events))).resolves.toMatchObject({
      id: 12,
      active: true,
    })
    expect(events).toEqual([
      "policy:tabs.activate",
      "bridge:tabs.activate",
      "ownership:touch",
    ])
  })

  test("preserves stable errors from the legacy active-tab lookup", async () => {
    const events: string[] = []
    const bridge = bridgeStub({
      events,
      sendCommand: async () => {
        const error = new Error(
          "Permission denied at https://private.example/account",
        ) as Error & {
          code: string
          retryable: boolean
        }
        error.code = "PERMISSION_DENIED"
        error.retryable = false
        throw error
      },
    })

    await expect(runBrowserRuntimeCommand({
      method: "page.screenshot",
      params: {},
    }, bridge, recordingPolicy(events))).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      retryable: false,
      message: "Browser command 'tabs.list' was denied by the extension backend.",
    })
    expect(events).toEqual([
      "policy:tabs.list",
      "bridge:tabs.list",
    ])
  })

  test("applies policy before the Agent-local tabs.release implementation", async () => {
    const events: string[] = []
    const bridge = bridgeStub({
      events,
      releaseOwnedTab: (tabId, sessionID) =>
        tabId === 42 && sessionID === "session-a",
    })

    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.release",
      params: { tabId: 42 },
      context: { sessionID: "session-a" },
    }, bridge, recordingPolicy(events))).resolves.toEqual({
      tabId: 42,
      released: true,
    })
    expect(events).toEqual([
      "policy:tabs.release",
      "bridge:tabs.release",
      "ownership:touch",
    ])
  })

  test("policy decisions state the enforcement that is and is not present", () => {
    const decision = new BrowserPolicyEngine().authorize({
      method: "page.screenshot",
      params: { tabId: 7 },
      backend: createBrowserBackendInfo({
        connected: true,
        commands: ["page.screenshot"],
      }),
    })
    expect(decision).toEqual({
      method: "page.screenshot",
      security: "page-content-read",
      capabilityChecked: true,
      ownershipEnforced: false,
      perActionApprovalEnforced: false,
    })
  })

  test("uses stable command failure errors for transport failures", async () => {
    const bridge = bridgeStub({
      sendCommand: async () => {
        throw new Error("extension disconnected")
      },
    })

    try {
      await runBrowserRuntimeCommand({
        contractVersion: BROWSER_CONTRACT_VERSION,
        method: "tabs.list",
        params: {},
      }, bridge, new BrowserPolicyEngine())
      throw new Error("Expected runBrowserRuntimeCommand to reject.")
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserCommandGatewayError)
      expect(error).toMatchObject({
        code: "COMMAND_FAILED",
        retryable: true,
        message: "Browser command 'tabs.list' failed in the extension backend.",
      })
    }
  })

  test("preserves a stable validation error returned by the extension", async () => {
    const bridge = bridgeStub({
      sendCommand: async () => {
        const error = new Error("Extension result does not match the contract.") as Error & {
          code: string
          retryable: boolean
        }
        error.code = "INVALID_COMMAND_RESULT"
        error.retryable = false
        throw error
      },
    })

    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      params: {},
    }, bridge, new BrowserPolicyEngine())).rejects.toMatchObject({
      code: "INVALID_COMMAND_RESULT",
      retryable: false,
      message: "Browser command 'tabs.list' failed in the extension backend.",
    })
  })

  test("redacts URL and local-path details returned by the extension", async () => {
    const bridge = bridgeStub({
      sendCommand: async () => {
        throw new Error(
          "Failed at https://private.example/account and C:\\Users\\Alice\\secret.txt",
        )
      },
    })

    await expect(runBrowserRuntimeCommand({
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.list",
      params: {},
    }, bridge, new BrowserPolicyEngine())).rejects.toMatchObject({
      code: "COMMAND_FAILED",
      message: "Browser command 'tabs.list' failed in the extension backend.",
    })
  })
})
