import {
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from "node:crypto"

const RECEIPT_VERSION = "v1"
const PUBLIC_KEY_ENV = "ANYBOX_BROWSER_AUTH_PUBLIC_KEY"
const DEFAULT_RECEIPT_TTL_MS = 60_000

// The private key never leaves AnyboxAgent. The Node REPL and Browser Host receive
// only the public verification key, so model-authored JavaScript cannot forge a
// receipt by reading its process environment.
const receiptKeyPair = generateKeyPairSync("ed25519")
const encodedPublicKey = receiptKeyPair.publicKey.export({
  type: "spki",
  format: "der",
}).toString("base64url")

function canonicalJson(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  )
}

function signature(payload: string) {
  return sign(
    null,
    Buffer.from(payload, "utf8"),
    receiptKeyPair.privateKey,
  ).toString("base64url")
}

export type BrowserAuthorizationReceiptClaims = {
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

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Browser authorization challenge is missing '${key}'.`)
  }
  return value.trim()
}

export function signBrowserAuthorizationReceipt(input: {
  challenge: Record<string, unknown>
  context: {
    sessionID: string
    turnID: string
    messageID: string
    toolCallID: string
  }
  decision: "allow-once" | "allow-session"
}) {
  const challenge = input.challenge
  for (const key of ["sessionID", "turnID", "messageID", "toolCallID"] as const) {
    if (readString(challenge, key) !== input.context[key]) {
      throw new Error(
        `Browser authorization challenge '${key}' does not match the active tool call.`,
      )
    }
  }
  const now = Date.now()
  const challengeExpiresAt = Number(challenge.expiresAt)
  if (!Number.isFinite(challengeExpiresAt) || challengeExpiresAt <= now) {
    throw new Error("Browser authorization challenge has expired.")
  }
  const claims: BrowserAuthorizationReceiptClaims = {
    challengeID: readString(challenge, "challengeID"),
    challengeNonce: readString(challenge, "nonce"),
    receiptNonce: randomUUID(),
    grantID: readString(challenge, "grantID"),
    decision: input.decision,
    method: readString(challenge, "method"),
    security: readString(challenge, "security"),
    sessionID: input.context.sessionID,
    turnID: input.context.turnID,
    messageID: input.context.messageID,
    toolCallID: input.context.toolCallID,
    browserID: readString(challenge, "browserID"),
    extensionInstanceID: readString(challenge, "extensionInstanceID"),
    origin: readString(challenge, "origin"),
    tabId: typeof challenge.tabId === "number" ? challenge.tabId : undefined,
    sensitive: challenge.sensitive === true,
    issuedAt: now,
    expiresAt: Math.min(
      challengeExpiresAt,
      now + DEFAULT_RECEIPT_TTL_MS,
    ),
  }
  const payload = Buffer.from(canonicalJson(claims), "utf8").toString("base64url")
  return `${RECEIPT_VERSION}.${payload}.${signature(payload)}`
}

export function verifyBrowserAuthorizationReceiptForTest(receipt: string) {
  const [version, payload, providedSignature, extra] = receipt.split(".")
  let validSignature = false
  if (payload && providedSignature) {
    try {
      validSignature = verify(
        null,
        Buffer.from(payload, "utf8"),
        receiptKeyPair.publicKey,
        Buffer.from(providedSignature, "base64url"),
      )
    } catch {
      validSignature = false
    }
  }
  if (
    version !== RECEIPT_VERSION
    || !payload
    || !providedSignature
    || extra !== undefined
    || !validSignature
  ) {
    throw new Error("Browser authorization receipt signature is invalid.")
  }
  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as BrowserAuthorizationReceiptClaims
}

export function getBrowserAuthorizationEnvironment() {
  return {
    [PUBLIC_KEY_ENV]: encodedPublicKey,
  }
}
