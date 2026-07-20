import { describe, expect, test } from "bun:test"
import {
  generateKeyPairSync,
  randomUUID,
  sign as signPayload,
} from "node:crypto"
import {
  BROWSER_CONTRACT_COMMAND_METHODS,
  BROWSER_CONTRACT_VERSION,
  createBrowserBackendInfo,
  type BrowserAuthorizationChallenge,
} from "@anybox/chrome-shared/browser-contract"
import type { BrowserExtensionBridge } from "../src/bridge.ts"
import {
  BrowserAuthorizationError,
  BrowserAuthorizationService,
  type BrowserAuthorizationExpectation,
} from "../src/browser-authorization.ts"
import {
  runBrowserRuntimeCommand,
} from "../src/command-gateway.ts"

const testKeyPair = generateKeyPairSync("ed25519")
const encodedPublicKey = testKeyPair.publicKey.export({
  type: "spki",
  format: "der",
}).toString("base64url")

function context() {
  return {
    sessionID: "session-auth",
    turnID: "turn-auth",
    messageID: "message-auth",
    toolCallID: "tool-auth",
    browserID: "extension:profile-auth",
  }
}

function createChallenge(service: BrowserAuthorizationService) {
  return service.createChallenge({
    method: "tabs.open",
    security: "target-url",
    context: context(),
    extensionInstanceID: "profile-auth",
    origin: "https://example.com/private?token=secret",
    sensitive: false,
    permissionAction: "ask",
    risk: "medium",
    rationale: "Origin-scoped approval is required.",
    authorizationPublicKey: encodedPublicKey,
  })
}

function expectation(
  challenge: BrowserAuthorizationChallenge,
  overrides: Partial<BrowserAuthorizationExpectation> = {},
): BrowserAuthorizationExpectation {
  return {
    method: challenge.method,
    security: challenge.security,
    context: {
      sessionID: challenge.sessionID,
      turnID: challenge.turnID,
      messageID: challenge.messageID,
      toolCallID: challenge.toolCallID,
      browserID: challenge.browserID,
    },
    extensionInstanceID: challenge.extensionInstanceID,
    origin: challenge.origin,
    tabId: challenge.tabId,
    sensitive: challenge.sensitive,
    ...overrides,
  }
}

function sign(
  challenge: BrowserAuthorizationChallenge,
  overrides: Record<string, unknown> = {},
  privateKey = testKeyPair.privateKey,
) {
  const claims = {
    challengeID: challenge.challengeID,
    challengeNonce: challenge.nonce,
    receiptNonce: randomUUID(),
    grantID: challenge.grantID,
    decision: "allow-once",
    method: challenge.method,
    security: challenge.security,
    sessionID: challenge.sessionID,
    turnID: challenge.turnID,
    messageID: challenge.messageID,
    toolCallID: challenge.toolCallID,
    browserID: challenge.browserID,
    extensionInstanceID: challenge.extensionInstanceID,
    origin: challenge.origin,
    tabId: challenge.tabId,
    sensitive: challenge.sensitive,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    ...overrides,
  }
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")
  const signature = signPayload(
    null,
    Buffer.from(payload, "utf8"),
    privateKey,
  ).toString("base64url")
  return `v1.${payload}.${signature}`
}

describe("Browser authorization receipts", () => {
  test("binds a receipt to its method, origin, tool call, and one-time nonce", () => {
    const service = new BrowserAuthorizationService()
    const challenge = createChallenge(service)
    expect(challenge.origin).toBe("https://example.com")

    const receipt = sign(challenge)
    expect(service.verify(
      receipt,
      expectation(challenge),
      encodedPublicKey,
    ).challenge.challengeID)
      .toBe(challenge.challengeID)
    expect(() => service.verify(
      receipt,
      expectation(challenge),
      encodedPublicKey,
    )).toThrow(
      expect.objectContaining({ code: "AUTHORIZATION_REPLAYED" }),
    )

    const second = createChallenge(service)
    expect(() => service.verify(sign(second, {
      method: "page.click",
    }), expectation(second), encodedPublicKey)).toThrow(expect.objectContaining({
      code: "AUTHORIZATION_INVALID",
    }))
  })

  test("rejects forged and expired receipts before dispatch", () => {
    const service = new BrowserAuthorizationService()
    const forgedChallenge = createChallenge(service)
    const forged = sign(forgedChallenge).replace(/\.[^.]+$/, ".forged")
    expect(() => service.verify(
      forged,
      expectation(forgedChallenge),
      encodedPublicKey,
    )).toThrow(
      expect.objectContaining({ code: "AUTHORIZATION_INVALID" }),
    )

    const expiredChallenge = createChallenge(service)
    expect(() => service.verify(sign(expiredChallenge, {
      issuedAt: expiredChallenge.issuedAt,
      expiresAt: expiredChallenge.issuedAt - 1,
    }), expectation(expiredChallenge), encodedPublicKey)).toThrow(expect.objectContaining({
      code: "AUTHORIZATION_EXPIRED",
    }))
  })

  test("rejects a valid receipt when the current retry targets another request", () => {
    const service = new BrowserAuthorizationService()
    const challenge = createChallenge(service)
    const receipt = sign(challenge)

    expect(() => service.verify(receipt, expectation(challenge, {
      method: "page.click",
    }), encodedPublicKey)).toThrow(expect.objectContaining({
      code: "AUTHORIZATION_INVALID",
    }))
    expect(service.verify(
      receipt,
      expectation(challenge),
      encodedPublicKey,
    ).challenge.challengeID)
      .toBe(challenge.challengeID)
  })

  test("binds each challenge to the runtime connection public key", () => {
    const service = new BrowserAuthorizationService()
    const challenge = createChallenge(service)
    const otherKeyPair = generateKeyPairSync("ed25519")
    const otherPublicKey = otherKeyPair.publicKey.export({
      type: "spki",
      format: "der",
    }).toString("base64url")

    expect(() => service.verify(
      sign(challenge, {}, otherKeyPair.privateKey),
      expectation(challenge),
      otherPublicKey,
    )).toThrow(expect.objectContaining({
      code: "AUTHORIZATION_INVALID",
    }))
  })

  test("never forwards a v2 write before a valid Host challenge receipt", async () => {
    let forwarded = 0
    const bridge = {
      backendInfo: () => createBrowserBackendInfo({
        connected: true,
        contractVersion: BROWSER_CONTRACT_VERSION,
        browserId: "extension:profile-auth",
        instanceID: "profile-auth",
        commands: BROWSER_CONTRACT_COMMAND_METHODS,
        features: {
          ownership: true,
          claim: true,
          locator: true,
        },
      }),
      describeTab: async () => undefined,
      sendCommand: async () => {
        forwarded += 1
        return {
          id: 9,
          url: "https://example.com/[redacted-path]",
          active: true,
        }
      },
      markOwnedTab() {},
      touchTab() {},
      releaseOwnedTab() {},
    } as unknown as BrowserExtensionBridge
    const request = {
      contractVersion: BROWSER_CONTRACT_VERSION,
      method: "tabs.open",
      params: { url: "https://example.com/private?token=secret" },
      context: context(),
    } as const

    let challenge: BrowserAuthorizationChallenge | undefined
    try {
      await runBrowserRuntimeCommand(
        request,
        bridge,
        undefined,
        encodedPublicKey,
      )
    } catch (error) {
      expect(error).toMatchObject({
        code: "APPROVAL_REQUIRED",
      })
      challenge = (error as {
        details?: { challenge?: BrowserAuthorizationChallenge }
      }).details?.challenge
    }
    expect(forwarded).toBe(0)
    expect(challenge).toBeDefined()

    await expect(runBrowserRuntimeCommand({
      ...request,
      authorization: { value: sign(challenge!) },
    }, bridge, undefined, encodedPublicKey)).resolves.toMatchObject({ id: 9 })
    expect(forwarded).toBe(1)
  })

  test("uses stable receipt errors", () => {
    expect(new BrowserAuthorizationError(
      "AUTHORIZATION_REPLAYED",
      "replayed",
    )).toMatchObject({
      code: "AUTHORIZATION_REPLAYED",
      message: "replayed",
    })
  })
})
