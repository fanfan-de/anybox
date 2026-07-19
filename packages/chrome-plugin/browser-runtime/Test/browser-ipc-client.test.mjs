import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import os from "node:os"
import path from "node:path"
import test from "node:test"

const require = createRequire(import.meta.url)
const {
  BROWSER_IPC_PROTOCOL_VERSION,
  BrowserIpcRuntimeClient,
  FrameDecoder,
  encodeFrame,
  proofFor,
} = require("../../runtime/scripts/browser-ipc-client.cjs")

function endpoint() {
  const suffix = `${process.pid}-${randomUUID()}`
  return process.platform === "win32"
    ? `\\\\.\\pipe\\anybox-browser-runtime-client-test-${suffix}`
    : path.join(os.tmpdir(), `anybox-browser-runtime-client-test-${suffix}.sock`)
}

function framedConnection(socket, onMessage) {
  const decoder = new FrameDecoder()
  socket.on("data", (chunk) => {
    for (const message of decoder.push(chunk)) onMessage(message)
  })
}

function listen(server, target) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(target, () => {
      server.off("error", reject)
      resolve()
    })
  })
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()))
}

test("runtime framing handles split and coalesced frames", () => {
  const first = encodeFrame({ value: 1 })
  const second = encodeFrame({ value: 2 })
  const decoder = new FrameDecoder()

  assert.deepEqual(decoder.push(first.subarray(0, 3)), [])
  assert.deepEqual(
    decoder.push(Buffer.concat([first.subarray(3), second])),
    [{ value: 1 }, { value: 2 }],
  )
  assert.doesNotThrow(() => decoder.finish())
})

test("runtime framing rejects malformed, oversized, and truncated input", () => {
  const malformed = Buffer.from("{invalid")
  const malformedFrame = Buffer.alloc(malformed.length + 4)
  malformedFrame.writeUInt32BE(malformed.length)
  malformed.copy(malformedFrame, 4)
  assert.throws(
    () => new FrameDecoder().push(malformedFrame),
    (error) => error.code === "FRAME_MALFORMED_JSON",
  )

  const invalidUtf8 = Buffer.from([0xff])
  const invalidUtf8Frame = Buffer.alloc(invalidUtf8.length + 4)
  invalidUtf8Frame.writeUInt32BE(invalidUtf8.length)
  invalidUtf8.copy(invalidUtf8Frame, 4)
  assert.throws(
    () => new FrameDecoder().push(invalidUtf8Frame),
    (error) => error.code === "FRAME_MALFORMED_JSON",
  )
  assert.throws(
    () => encodeFrame(undefined),
    (error) => error.code === "FRAME_MALFORMED_JSON",
  )

  const oversized = Buffer.alloc(4)
  oversized.writeUInt32BE(9)
  assert.throws(
    () => new FrameDecoder(8).push(oversized),
    (error) => error.code === "FRAME_TOO_LARGE",
  )

  const truncated = new FrameDecoder()
  truncated.push(encodeFrame({ value: 1 }).subarray(0, 5))
  assert.throws(
    () => truncated.finish(),
    (error) => error.code === "FRAME_TRUNCATED",
  )
})

test("runtime client authenticates, reconnects, and rejects pending work on reset", async () => {
  const runtimeEndpoint = endpoint()
  const brokerInstanceID = `broker-${randomUUID()}`
  const bootstrapProof = `proof-${randomUUID()}`
  let connections = 0
  let holdNextRequest = false
  let resolveHeldRequest
  const heldRequest = new Promise((resolve) => {
    resolveHeldRequest = resolve
  })

  const server = createServer((socket) => {
    connections += 1
    const nonce = `challenge-${randomUUID()}`
    socket.write(encodeFrame({
      type: "challenge",
      protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
      role: "runtime",
      brokerInstanceID,
      nonce,
      expiresAt: Date.now() + 5_000,
    }))
    let authenticated = false
    framedConnection(socket, (message) => {
      if (!authenticated) {
        assert.equal(message.type, "hello")
        assert.equal(message.role, "runtime")
        assert.equal(message.brokerInstanceID, brokerInstanceID)
        assert.equal(
          message.proof,
          proofFor(bootstrapProof, {
            role: "runtime",
            brokerInstanceID,
            nonce,
            clientInstanceID: message.clientInstanceID,
            clientVersion: message.clientVersion,
          }),
        )
        authenticated = true
        socket.write(encodeFrame({
          type: "ready",
          protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
          role: "runtime",
          brokerInstanceID,
          ...(connections > 1
            ? {
                applicationCapabilities: {
                  runtimeOperations: [
                    "status",
                    "getInfo",
                    "command",
                    "future.operation",
                  ],
                  browserContractVersions: [1],
                },
              }
            : {}),
        }))
        return
      }

      if (holdNextRequest) {
        resolveHeldRequest()
        return
      }
      socket.write(encodeFrame({
        type: "runtime.response",
        requestID: message.requestID,
        ok: true,
        data: { connection: connections, operation: message.operation },
      }))
    })
  })
  await listen(server, runtimeEndpoint)

  const client = new BrowserIpcRuntimeClient({
    endpoint: runtimeEndpoint,
    brokerInstanceID,
    bootstrapProof,
    clientVersion: "test-runtime",
    connectTimeoutMs: 1_000,
  })

  try {
    assert.deepEqual(await client.request({ operation: "status" }), {
      connection: 1,
      operation: "status",
    })
    await assert.rejects(
      client.request({ operation: "getInfo", contractVersion: 1 }),
      (error) => error.code === "CONTRACT_VERSION_UNSUPPORTED",
    )

    client.reset()
    assert.deepEqual(await client.request({ operation: "status" }), {
      connection: 2,
      operation: "status",
    })
    assert.deepEqual(
      await client.request({ operation: "getInfo", contractVersion: 1 }),
      {
        connection: 2,
        operation: "getInfo",
      },
    )

    holdNextRequest = true
    const pending = client.request({
      operation: "command",
      method: "tabs.list",
    })
    await heldRequest
    client.reset()
    await assert.rejects(
      pending,
      (error) => error.code === "CONNECTION_CLOSED",
    )
  } finally {
    client.reset()
    await close(server)
  }
})

test("runtime client fails closed on stale broker challenges", async () => {
  const runtimeEndpoint = endpoint()
  const server = createServer((socket) => {
    socket.write(encodeFrame({
      type: "challenge",
      protocolVersion: BROWSER_IPC_PROTOCOL_VERSION,
      role: "runtime",
      brokerInstanceID: "different-broker",
      nonce: `challenge-${randomUUID()}`,
      expiresAt: Date.now() + 5_000,
    }))
  })
  await listen(server, runtimeEndpoint)
  const client = new BrowserIpcRuntimeClient({
    endpoint: runtimeEndpoint,
    brokerInstanceID: "expected-broker",
    bootstrapProof: "expected-proof",
    clientVersion: "test-runtime",
    connectTimeoutMs: 100,
  })

  try {
    await assert.rejects(
      client.request({ operation: "status" }),
      (error) => error.code === "BROKER_STALE",
    )
  } finally {
    client.reset()
    await close(server)
  }
})
