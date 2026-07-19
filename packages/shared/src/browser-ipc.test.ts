import { describe, expect, test } from "vitest"
import {
  BrowserIpcErrorCode,
  BrowserIpcFrameDecoder,
  BrowserIpcProtocolError,
  BrowserIpcRuntimeCommandMethod,
  BrowserIpcRuntimeGetInfoRequest,
  BrowserIpcRuntimeGetInfoResponse,
  BrowserIpcReadyMessage,
  BrowserIpcRuntimeRequest,
  BrowserIpcRuntimeResponse,
  encodeBrowserIpcFrame,
} from "./browser-ipc"
import {
  createBrowserBackendInfo,
  createBrowserGetInfoResult,
} from "./browser-contract"

function frameBytes(payload: Uint8Array) {
  const frame = new Uint8Array(payload.byteLength + 4)
  new DataView(frame.buffer).setUint32(0, payload.byteLength, false)
  frame.set(payload, 4)
  return frame
}

function errorCode(run: () => unknown) {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserIpcProtocolError)
    return (error as BrowserIpcProtocolError).code
  }
  throw new Error("Expected Browser IPC decoding to fail.")
}

describe("Browser IPC framing", () => {
  test("decodes one complete frame", () => {
    const decoder = new BrowserIpcFrameDecoder()
    expect(decoder.push(encodeBrowserIpcFrame({ type: "ping", nonce: "one" })))
      .toEqual([{ type: "ping", nonce: "one" }])
    expect(decoder.bufferedBytes).toBe(0)
    expect(() => decoder.finish()).not.toThrow()
  })

  test("buffers a frame split across arbitrary chunks", () => {
    const frame = encodeBrowserIpcFrame({ type: "ping", nonce: "fragmented" })
    const decoder = new BrowserIpcFrameDecoder()

    expect(decoder.push(frame.slice(0, 2))).toEqual([])
    expect(decoder.push(frame.slice(2, 7))).toEqual([])
    expect(decoder.push(frame.slice(7))).toEqual([
      { type: "ping", nonce: "fragmented" },
    ])
  })

  test("decodes multiple coalesced frames", () => {
    const first = encodeBrowserIpcFrame({ sequence: 1 })
    const second = encodeBrowserIpcFrame({ sequence: 2 })
    const combined = new Uint8Array(first.byteLength + second.byteLength)
    combined.set(first)
    combined.set(second, first.byteLength)

    expect(new BrowserIpcFrameDecoder().push(combined)).toEqual([
      { sequence: 1 },
      { sequence: 2 },
    ])
  })

  test("rejects malformed JSON and invalid UTF-8", () => {
    const malformed = frameBytes(new TextEncoder().encode("{invalid"))
    expect(errorCode(() => new BrowserIpcFrameDecoder().push(malformed)))
      .toBe("FRAME_MALFORMED_JSON")

    const invalidUtf8 = frameBytes(Uint8Array.from([0xc3, 0x28]))
    expect(errorCode(() => new BrowserIpcFrameDecoder().push(invalidUtf8)))
      .toBe("FRAME_MALFORMED_JSON")
  })

  test("rejects values that JSON cannot encode", () => {
    expect(() => encodeBrowserIpcFrame(undefined)).toThrowError(
      expect.objectContaining({ code: "FRAME_MALFORMED_JSON" }),
    )
  })

  test("rejects zero and oversized declared lengths", () => {
    const zero = new Uint8Array(4)
    expect(errorCode(() => new BrowserIpcFrameDecoder().push(zero)))
      .toBe("FRAME_INVALID_LENGTH")

    const oversized = new Uint8Array(4)
    new DataView(oversized.buffer).setUint32(0, 9, false)
    expect(errorCode(() => new BrowserIpcFrameDecoder(8).push(oversized)))
      .toBe("FRAME_TOO_LARGE")
  })

  test("rejects oversized encoded frames", () => {
    expect(errorCode(() => encodeBrowserIpcFrame({ value: "too large" }, 4)))
      .toBe("FRAME_TOO_LARGE")
  })

  test("reports a connection closed inside a frame", () => {
    const frame = encodeBrowserIpcFrame({ type: "ping", nonce: "truncated" })
    const decoder = new BrowserIpcFrameDecoder()
    decoder.push(frame.slice(0, frame.byteLength - 1))
    expect(errorCode(() => decoder.finish())).toBe("FRAME_TRUNCATED")
  })
})

describe("Browser IPC runtime command schema", () => {
  test("advertises Browser Contract application support without changing IPC v1", () => {
    expect(BrowserIpcReadyMessage.parse({
      type: "ready",
      protocolVersion: 1,
      role: "runtime",
      brokerInstanceID: "broker-1",
      applicationCapabilities: {
        runtimeOperations: ["status", "getInfo", "command", "turnEnded"],
        browserContractVersions: [1],
      },
    })).toMatchObject({
      applicationCapabilities: {
        runtimeOperations: ["status", "getInfo", "command", "turnEnded"],
        browserContractVersions: [1],
      },
    })
  })

  test.each(["page.executeScript", "cdp.send", "trusted-command"])(
    "keeps the transport envelope open for Agent-rejected method %s",
    (method) => {
      expect(BrowserIpcRuntimeRequest.safeParse({
        type: "runtime.request",
        requestID: "request-1",
        operation: "command",
        contractVersion: 1,
        method,
        params: {},
      }).success).toBe(true)
    },
  )
  test("bounds transport command method strings", () => {
    expect(BrowserIpcRuntimeCommandMethod.safeParse("").success).toBe(false)
    expect(BrowserIpcRuntimeCommandMethod.safeParse("x".repeat(129)).success)
      .toBe(false)
  })

  test("accepts getInfo without changing the IPC transport protocol", () => {
    const request = {
      type: "runtime.request",
      requestID: "get-info-1",
      operation: "getInfo",
      contractVersion: 1,
    }
    expect(BrowserIpcRuntimeGetInfoRequest.parse(request)).toEqual(request)
    expect(BrowserIpcRuntimeRequest.parse(request)).toEqual(request)
    expect(BrowserIpcRuntimeRequest.safeParse({
      ...request,
      contractVersion: 2,
    }).success).toBe(true)
  })

  test("accepts legacy/current commands and defers future versions to the Agent", () => {
    const legacy = {
      type: "runtime.request",
      requestID: "legacy-command",
      operation: "command",
      method: "tabs.list",
      params: {},
    }
    expect(BrowserIpcRuntimeRequest.safeParse(legacy).success).toBe(true)
    expect(BrowserIpcRuntimeRequest.safeParse({
      ...legacy,
      requestID: "contract-command",
      contractVersion: 1,
    }).success).toBe(true)
    expect(BrowserIpcRuntimeRequest.safeParse({
      ...legacy,
      requestID: "future-contract-command",
      contractVersion: 2,
    }).success).toBe(true)
    expect(BrowserIpcRuntimeRequest.safeParse({
      ...legacy,
      requestID: "invalid-contract-command",
      contractVersion: 0,
    }).success).toBe(false)
  })

  test("admits structured Browser Contract error codes", () => {
    expect(BrowserIpcErrorCode.safeParse("PERMISSION_DENIED").success).toBe(true)
    expect(BrowserIpcErrorCode.safeParse("TAB_NOT_OWNED").success).toBe(true)
    expect(BrowserIpcErrorCode.safeParse("CANCELLED").success).toBe(true)

    const response = {
      type: "runtime.response",
      requestID: "request-denied",
      ok: false,
      error: {
        code: "PERMISSION_DENIED",
        message: "The browser action was denied.",
        retryable: false,
        details: { policy: "browser-origin" },
      },
    }
    expect(BrowserIpcRuntimeResponse.parse(response)).toEqual(response)
  })

  test("defines the exact successful getInfo response data shape", () => {
    const response = {
      type: "runtime.response",
      requestID: "get-info-result",
      ok: true,
      data: createBrowserGetInfoResult(createBrowserBackendInfo({
        connected: true,
        protocolVersion: 1,
        commands: ["tabs.list"],
      })),
    }
    expect(BrowserIpcRuntimeGetInfoResponse.parse(response)).toEqual(response)
  })
})
