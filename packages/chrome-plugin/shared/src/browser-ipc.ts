// Browser IPC is implemented and versioned by the Chrome plugin.
import { z } from "zod"
import {
  ANYBOX_CHROME_EXTENSION_ID,
  ANYBOX_CHROME_NATIVE_HOST_NAME,
  BrowserExtensionCommandContext,
} from "./browser-extension"
import {
  BROWSER_CONTRACT_ERROR_CODES,
  BrowserGetInfoResult,
} from "./browser-contract"

export const BROWSER_IPC_PROTOCOL_VERSION = 1 as const
export const MAX_BROWSER_IPC_FRAME_BYTES = 16 * 1024 * 1024
export const BROWSER_IPC_HANDSHAKE_TIMEOUT_MS = 5_000
export const BROWSER_IPC_RUNTIME_CLIENT_VERSION = "0.4.0"
export const BROWSER_IPC_NATIVE_HOST_VERSION = "0.3.0"

export const BrowserIpcRole = z.enum(["runtime", "native-host"])
export type BrowserIpcRole = z.infer<typeof BrowserIpcRole>

export const BrowserIpcTransportKind = z.enum([
  "windows-named-pipe",
  "unix-domain-socket",
])
export type BrowserIpcTransportKind = z.infer<typeof BrowserIpcTransportKind>

// Browser IPC is a transport envelope, not the Browser Contract authority.
// Bounded strings let the Agent return request-scoped version/command errors
// without treating future application methods as a broken IPC frame.
export const BrowserIpcRuntimeCommandMethod = z.string().trim().min(1).max(128)
export type BrowserIpcRuntimeCommandMethod = z.infer<typeof BrowserIpcRuntimeCommandMethod>

export const BrowserIpcErrorCode = z.enum([
  "AUTH_FAILED",
  "BROKER_STALE",
  "BROWSER_COMMAND_FAILED",
  "CONNECTION_CLOSED",
  "DUPLICATE_REQUEST",
  "FRAME_INVALID_LENGTH",
  "FRAME_MALFORMED_JSON",
  "FRAME_TOO_LARGE",
  "FRAME_TRUNCATED",
  "HANDSHAKE_EXPIRED",
  "HELLO_REQUIRED",
  "IDENTITY_INVALID",
  "INTERNAL_ERROR",
  "INVALID_MESSAGE",
  "PLATFORM_UNSUPPORTED",
  "PROTOCOL_MISMATCH",
  "ROLE_FORBIDDEN",
  "ROLE_MISMATCH",
  "UNKNOWN_MESSAGE_TYPE",
  ...BROWSER_CONTRACT_ERROR_CODES,
])
export type BrowserIpcErrorCode = z.infer<typeof BrowserIpcErrorCode>

export const BrowserIpcChallengeMessage = z.object({
  type: z.literal("challenge"),
  protocolVersion: z.literal(BROWSER_IPC_PROTOCOL_VERSION),
  role: BrowserIpcRole,
  brokerInstanceID: z.string().min(1),
  nonce: z.string().min(16),
  expiresAt: z.number().int().positive(),
}).strict()
export type BrowserIpcChallengeMessage = z.infer<typeof BrowserIpcChallengeMessage>

const BrowserIpcHelloBase = {
  type: z.literal("hello"),
  protocolVersion: z.literal(BROWSER_IPC_PROTOCOL_VERSION),
  brokerInstanceID: z.string().min(1),
  clientInstanceID: z.string().min(1),
  clientVersion: z.string().min(1),
  nonce: z.string().min(16),
  proof: z.string().min(16),
}

export const BrowserIpcRuntimeHelloMessage = z.object({
  ...BrowserIpcHelloBase,
  role: z.literal("runtime"),
}).strict()
export type BrowserIpcRuntimeHelloMessage = z.infer<typeof BrowserIpcRuntimeHelloMessage>

export const BrowserIpcNativeHostHelloMessage = z.object({
  ...BrowserIpcHelloBase,
  role: z.literal("native-host"),
  nativeHostName: z.literal(ANYBOX_CHROME_NATIVE_HOST_NAME),
  extensionID: z.literal(ANYBOX_CHROME_EXTENSION_ID),
}).strict()
export type BrowserIpcNativeHostHelloMessage = z.infer<typeof BrowserIpcNativeHostHelloMessage>

export const BrowserIpcHelloMessage = z.discriminatedUnion("role", [
  BrowserIpcRuntimeHelloMessage,
  BrowserIpcNativeHostHelloMessage,
])
export type BrowserIpcHelloMessage = z.infer<typeof BrowserIpcHelloMessage>

export const BrowserIpcRuntimeApplicationCapabilities = z.object({
  // Bounded strings make the advertisement forward-compatible. A Runtime
  // checks only the operations it understands and ignores future additions.
  runtimeOperations: z.array(z.string().trim().min(1).max(64)).min(1),
  browserContractVersions: z.array(z.number().int().positive()).min(1),
}).strict()
export type BrowserIpcRuntimeApplicationCapabilities = z.infer<
  typeof BrowserIpcRuntimeApplicationCapabilities
>

export const BrowserIpcReadyMessage = z.object({
  type: z.literal("ready"),
  protocolVersion: z.literal(BROWSER_IPC_PROTOCOL_VERSION),
  role: BrowserIpcRole,
  brokerInstanceID: z.string().min(1),
  // Optional at IPC protocol v1 for mixed-version detection. A new Runtime
  // must not send getInfo to an older Agent that did not advertise it.
  applicationCapabilities: BrowserIpcRuntimeApplicationCapabilities.optional(),
}).strict()
export type BrowserIpcReadyMessage = z.infer<typeof BrowserIpcReadyMessage>

export const BrowserIpcErrorMessage = z.object({
  type: z.literal("error"),
  code: BrowserIpcErrorCode,
  message: z.string().min(1),
  requestID: z.string().min(1).optional(),
}).strict()
export type BrowserIpcErrorMessage = z.infer<typeof BrowserIpcErrorMessage>

export const BrowserIpcRuntimeStatusRequest = z.object({
  type: z.literal("runtime.request"),
  requestID: z.string().min(1),
  operation: z.literal("status"),
}).strict()
export type BrowserIpcRuntimeStatusRequest = z.infer<typeof BrowserIpcRuntimeStatusRequest>

export const BrowserIpcRuntimeGetInfoRequest = z.object({
  type: z.literal("runtime.request"),
  requestID: z.string().min(1),
  operation: z.literal("getInfo"),
  contractVersion: z.number().int().positive(),
}).strict()
export type BrowserIpcRuntimeGetInfoRequest = z.infer<
  typeof BrowserIpcRuntimeGetInfoRequest
>

export const BrowserIpcRuntimeCommandRequest = z.object({
  type: z.literal("runtime.request"),
  requestID: z.string().min(1),
  operation: z.literal("command"),
  // Accept a positive version number at the transport schema so the Agent can
  // return CONTRACT_VERSION_UNSUPPORTED instead of collapsing negotiation into
  // a generic malformed-message error.
  contractVersion: z.number().int().positive().optional(),
  method: BrowserIpcRuntimeCommandMethod,
  params: z.unknown().optional(),
  context: BrowserExtensionCommandContext.optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
}).strict()
export type BrowserIpcRuntimeCommandRequest = z.infer<typeof BrowserIpcRuntimeCommandRequest>

export const BrowserIpcRuntimeRequest = z.discriminatedUnion("operation", [
  BrowserIpcRuntimeStatusRequest,
  BrowserIpcRuntimeGetInfoRequest,
  BrowserIpcRuntimeCommandRequest,
])
export type BrowserIpcRuntimeRequest = z.infer<typeof BrowserIpcRuntimeRequest>

export const BrowserIpcRuntimeResponse = z.discriminatedUnion("ok", [
  z.object({
    type: z.literal("runtime.response"),
    requestID: z.string().min(1),
    ok: z.literal(true),
    data: z.unknown(),
  }).strict(),
  z.object({
    type: z.literal("runtime.response"),
    requestID: z.string().min(1),
    ok: z.literal(false),
    error: z.object({
      code: BrowserIpcErrorCode,
      message: z.string().min(1),
      retryable: z.boolean().optional(),
      details: z.record(z.string(), z.unknown()).optional(),
    }).strict(),
  }).strict(),
])
export type BrowserIpcRuntimeResponse = z.infer<typeof BrowserIpcRuntimeResponse>

export const BrowserIpcRuntimeGetInfoResponse = z.object({
  type: z.literal("runtime.response"),
  requestID: z.string().min(1),
  ok: z.literal(true),
  data: BrowserGetInfoResult,
}).strict()
export type BrowserIpcRuntimeGetInfoResponse = z.infer<
  typeof BrowserIpcRuntimeGetInfoResponse
>

export const BrowserIpcNativeMessage = z.object({
  type: z.literal("native.message"),
  message: z.unknown(),
}).strict()
export type BrowserIpcNativeMessage = z.infer<typeof BrowserIpcNativeMessage>

export const BrowserIpcPingMessage = z.object({
  type: z.literal("ping"),
  nonce: z.string().min(1),
}).strict()

export const BrowserIpcPongMessage = z.object({
  type: z.literal("pong"),
  nonce: z.string().min(1),
}).strict()

export const BrowserIpcClientMessage = z.union([
  BrowserIpcHelloMessage,
  BrowserIpcRuntimeRequest,
  BrowserIpcNativeMessage,
  BrowserIpcPongMessage,
])
export type BrowserIpcClientMessage = z.infer<typeof BrowserIpcClientMessage>

export const BrowserIpcServerMessage = z.union([
  BrowserIpcChallengeMessage,
  BrowserIpcReadyMessage,
  BrowserIpcErrorMessage,
  BrowserIpcRuntimeResponse,
  BrowserIpcNativeMessage,
  BrowserIpcPingMessage,
])
export type BrowserIpcServerMessage = z.infer<typeof BrowserIpcServerMessage>

export class BrowserIpcProtocolError extends Error {
  constructor(
    readonly code: BrowserIpcErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "BrowserIpcProtocolError"
  }
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder("utf-8", { fatal: true })

function appendBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength === 0) return right.slice()
  const combined = new Uint8Array(left.byteLength + right.byteLength)
  combined.set(left, 0)
  combined.set(right, left.byteLength)
  return combined
}

export function encodeBrowserIpcFrame(
  value: unknown,
  maxFrameBytes = MAX_BROWSER_IPC_FRAME_BYTES,
) {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== "string") {
    throw new BrowserIpcProtocolError(
      "FRAME_MALFORMED_JSON",
      "Browser IPC frames must contain a JSON value.",
    )
  }
  const payload = textEncoder.encode(serialized)
  if (payload.byteLength === 0) {
    throw new BrowserIpcProtocolError(
      "FRAME_INVALID_LENGTH",
      "Browser IPC frames cannot be empty.",
    )
  }
  if (payload.byteLength > maxFrameBytes) {
    throw new BrowserIpcProtocolError(
      "FRAME_TOO_LARGE",
      `Browser IPC frame is ${payload.byteLength} bytes; maximum is ${maxFrameBytes}.`,
    )
  }

  const frame = new Uint8Array(4 + payload.byteLength)
  new DataView(frame.buffer).setUint32(0, payload.byteLength, false)
  frame.set(payload, 4)
  return frame
}

export class BrowserIpcFrameDecoder {
  private buffered = new Uint8Array(0)

  constructor(
    private readonly maxFrameBytes = MAX_BROWSER_IPC_FRAME_BYTES,
  ) {}

  push(chunk: Uint8Array) {
    this.buffered = appendBytes(this.buffered, chunk)
    const values: unknown[] = []

    while (this.buffered.byteLength >= 4) {
      const length = new DataView(
        this.buffered.buffer,
        this.buffered.byteOffset,
        4,
      ).getUint32(0, false)
      if (length === 0) {
        throw new BrowserIpcProtocolError(
          "FRAME_INVALID_LENGTH",
          "Browser IPC frame length must be greater than zero.",
        )
      }
      if (length > this.maxFrameBytes) {
        throw new BrowserIpcProtocolError(
          "FRAME_TOO_LARGE",
          `Browser IPC frame declares ${length} bytes; maximum is ${this.maxFrameBytes}.`,
        )
      }
      if (this.buffered.byteLength < 4 + length) break

      const payload = this.buffered.slice(4, 4 + length)
      this.buffered = this.buffered.slice(4 + length)
      try {
        values.push(JSON.parse(textDecoder.decode(payload)))
      } catch {
        throw new BrowserIpcProtocolError(
          "FRAME_MALFORMED_JSON",
          "Browser IPC frame must contain valid UTF-8 JSON.",
        )
      }
    }

    return values
  }

  finish() {
    if (this.buffered.byteLength > 0) {
      throw new BrowserIpcProtocolError(
        "FRAME_TRUNCATED",
        "Browser IPC connection closed inside a frame.",
      )
    }
  }

  get bufferedBytes() {
    return this.buffered.byteLength
  }
}

export function browserIpcProofTranscript(input: {
  role: BrowserIpcRole
  brokerInstanceID: string
  nonce: string
  clientInstanceID: string
  clientVersion: string
}) {
  return [
    `anybox-browser-ipc-v${BROWSER_IPC_PROTOCOL_VERSION}`,
    input.role,
    input.brokerInstanceID,
    input.nonce,
    input.clientInstanceID,
    input.clientVersion,
  ].join("\n")
}
