import {
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as verifySignature,
} from "node:crypto"
import {
  BrowserAuthorizationChallenge,
  type BrowserAuthorizationChallenge as BrowserAuthorizationChallengeValue,
  type BrowserCommandExecutionContextV2,
  type BrowserContractCommandMethod,
  type BrowserContractErrorCode,
} from "@anybox/chrome-shared/browser-contract"

const RECEIPT_VERSION = "v1"
const CHALLENGE_TTL_MS = 60_000

type AuthorizationFailureCode = Extract<
  BrowserContractErrorCode,
  | "APPROVAL_REQUIRED"
  | "AUTHORIZATION_INVALID"
  | "AUTHORIZATION_EXPIRED"
  | "AUTHORIZATION_REPLAYED"
  | "PERMISSION_DENIED"
>

export class BrowserAuthorizationError extends Error {
  constructor(
    readonly code: AuthorizationFailureCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "BrowserAuthorizationError"
  }
}

type ReceiptClaims = {
  challengeID: string
  challengeNonce: string
  receiptNonce: string
  grantID: string
  decision: "allow-once" | "allow-session"
  method: string
  security: string
  sessionID: string
  turnID: string
  messageID: string
  toolCallID: string
  browserID: string
  extensionInstanceID: string
  origin: string
  tabId?: number
  sensitive: boolean
  issuedAt: number
  expiresAt: number
}

export type BrowserAuthorizationExpectation = {
  method: BrowserContractCommandMethod
  security: string
  context: BrowserCommandExecutionContextV2
  extensionInstanceID: string
  origin: string
  tabId?: number
  sensitive: boolean
}

function hasValidSignature(
  encodedPublicKey: string,
  payload: string,
  signature: string,
) {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(encodedPublicKey, "base64url"),
      format: "der",
      type: "spki",
    })
    return verifySignature(
      null,
      Buffer.from(payload, "utf8"),
      publicKey,
      Buffer.from(signature, "base64url"),
    )
  } catch {
    return false
  }
}

function readClaims(payload: string): ReceiptClaims {
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    throw new BrowserAuthorizationError(
      "AUTHORIZATION_INVALID",
      "Browser authorization receipt payload is malformed.",
    )
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BrowserAuthorizationError(
      "AUTHORIZATION_INVALID",
      "Browser authorization receipt claims are invalid.",
    )
  }
  return value as ReceiptClaims
}

function exactMatch(
  claims: ReceiptClaims,
  challenge: BrowserAuthorizationChallengeValue,
) {
  return claims.challengeID === challenge.challengeID
    && claims.challengeNonce === challenge.nonce
    && claims.grantID === challenge.grantID
    && claims.method === challenge.method
    && claims.security === challenge.security
    && claims.sessionID === challenge.sessionID
    && claims.turnID === challenge.turnID
    && claims.messageID === challenge.messageID
    && claims.toolCallID === challenge.toolCallID
    && claims.browserID === challenge.browserID
    && claims.extensionInstanceID === challenge.extensionInstanceID
    && claims.origin === challenge.origin
    && claims.tabId === challenge.tabId
    && claims.sensitive === challenge.sensitive
}

function matchesCurrentRequest(
  challenge: BrowserAuthorizationChallengeValue,
  expected: BrowserAuthorizationExpectation,
) {
  return challenge.method === expected.method
    && challenge.security === expected.security
    && challenge.sessionID === expected.context.sessionID
    && challenge.turnID === expected.context.turnID
    && challenge.messageID === expected.context.messageID
    && challenge.toolCallID === expected.context.toolCallID
    && challenge.browserID === expected.context.browserID
    && challenge.extensionInstanceID === expected.extensionInstanceID
    && challenge.origin === normalizeBrowserOrigin(expected.origin)
    && challenge.tabId === expected.tabId
    && challenge.sensitive === expected.sensitive
}

export function normalizeBrowserOrigin(value: string | undefined) {
  if (!value) return "browser://profile"
  try {
    const url = new URL(value)
    if (["javascript:", "data:", "vbscript:"].includes(url.protocol.toLowerCase())) {
      throw new Error("Executable URL schemes are forbidden.")
    }
    if (url.origin !== "null") return url.origin
    return `${url.protocol}//${url.host || "local"}`
  } catch {
    return "browser://unknown"
  }
}

export class BrowserAuthorizationService {
  private readonly challenges = new Map<
    string,
    {
      challenge: BrowserAuthorizationChallengeValue
      authorizationPublicKey: string
    }
  >()
  private readonly usedReceiptNonces = new Map<string, number>()

  createChallenge(input: {
    method: BrowserContractCommandMethod
    security: string
    context: BrowserCommandExecutionContextV2
    extensionInstanceID: string
    origin: string
    tabId?: number
    tabTitle?: string
    sensitive: boolean
    permissionAction: "allow" | "ask" | "deny"
    risk: "low" | "medium" | "high" | "critical"
    rationale: string
    authorizationPublicKey: string
  }) {
    const now = Date.now()
    this.prune(now)
    const challenge = BrowserAuthorizationChallenge.parse({
      grantID: randomUUID(),
      challengeID: randomUUID(),
      nonce: randomBytes(24).toString("base64url"),
      method: input.method,
      security: input.security,
      permissionAction: input.permissionAction,
      risk: input.risk,
      rationale: input.rationale,
      sessionID: input.context.sessionID,
      turnID: input.context.turnID,
      messageID: input.context.messageID,
      toolCallID: input.context.toolCallID,
      browserID: input.context.browserID,
      extensionInstanceID: input.extensionInstanceID,
      origin: normalizeBrowserOrigin(input.origin),
      tabId: input.tabId,
      tabTitle: input.tabTitle?.slice(0, 200),
      sensitive: input.sensitive,
      issuedAt: now,
      expiresAt: now + CHALLENGE_TTL_MS,
    })
    this.challenges.set(challenge.challengeID, {
      challenge,
      authorizationPublicKey: input.authorizationPublicKey,
    })
    return challenge
  }

  verify(
    receipt: string,
    expected: BrowserAuthorizationExpectation,
    encodedPublicKey: string,
  ) {
    if (!encodedPublicKey) {
      throw new BrowserAuthorizationError(
        "AUTHORIZATION_INVALID",
        "Browser authorization verification is unavailable.",
      )
    }
    const [version, payload, providedSignature, extra] = receipt.split(".")
    if (
      version !== RECEIPT_VERSION
      || !payload
      || !providedSignature
      || extra !== undefined
    ) {
      throw new BrowserAuthorizationError(
        "AUTHORIZATION_INVALID",
        "Browser authorization receipt format is invalid.",
      )
    }
    if (!hasValidSignature(encodedPublicKey, payload, providedSignature)) {
      throw new BrowserAuthorizationError(
        "AUTHORIZATION_INVALID",
        "Browser authorization receipt signature is invalid.",
      )
    }
    const claims = readClaims(payload)
    const now = Date.now()
    this.prune(now)
    if (
      typeof claims.receiptNonce !== "string"
      || !claims.receiptNonce
    ) {
      throw new BrowserAuthorizationError(
        "AUTHORIZATION_INVALID",
        "Browser authorization receipt nonce is invalid.",
      )
    }
    if (this.usedReceiptNonces.has(claims.receiptNonce)) {
      throw new BrowserAuthorizationError(
        "AUTHORIZATION_REPLAYED",
        "Browser authorization receipt was already used.",
      )
    }
    const pendingChallenge = this.challenges.get(claims.challengeID)
    const challenge = pendingChallenge?.challenge
    if (
      !pendingChallenge
      || !challenge
      || pendingChallenge.authorizationPublicKey !== encodedPublicKey
      || !exactMatch(claims, challenge)
      || !matchesCurrentRequest(challenge, expected)
    ) {
      throw new BrowserAuthorizationError(
        "AUTHORIZATION_INVALID",
        "Browser authorization receipt does not match its challenge.",
      )
    }
    if (
      challenge.expiresAt <= now
      || claims.expiresAt <= now
      || claims.issuedAt < challenge.issuedAt
      || claims.expiresAt > challenge.expiresAt
    ) {
      throw new BrowserAuthorizationError(
        "AUTHORIZATION_EXPIRED",
        "Browser authorization receipt has expired.",
      )
    }
    if (
      claims.decision !== "allow-once"
      && claims.decision !== "allow-session"
    ) {
      throw new BrowserAuthorizationError(
        "PERMISSION_DENIED",
        "The browser action was not approved.",
      )
    }

    this.challenges.delete(challenge.challengeID)
    this.usedReceiptNonces.set(claims.receiptNonce, claims.expiresAt)
    this.prune(now)
    return { claims, challenge }
  }

  private prune(now: number) {
    for (const [id, pending] of this.challenges) {
      if (pending.challenge.expiresAt <= now) this.challenges.delete(id)
    }
    for (const [nonce, expiresAt] of this.usedReceiptNonces) {
      if (expiresAt <= now) this.usedReceiptNonces.delete(nonce)
    }
  }
}

export const browserAuthorizationService = new BrowserAuthorizationService()
