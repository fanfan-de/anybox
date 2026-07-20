import assert from "node:assert/strict"
import path from "node:path"
import { spawn } from "node:child_process"
import test from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const { MAX_FRAME_BYTES } = require("../scripts/lib/build-info")
const { FrameDecoder, encodeFrame } = require("../scripts/lib/frame-codec")

const directory = path.dirname(fileURLToPath(import.meta.url))
const helper = path.resolve(directory, "..", "helper", "win32-x64", "computer-use-helper.exe")

function startHelper() {
  const child = spawn(helper, [], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  const decoder = new FrameDecoder()
  const messages = []
  const waiters = []
  child.stdout.on("data", (chunk) => {
    messages.push(...decoder.push(chunk))
    while (messages.length > 0 && waiters.length > 0) {
      waiters.shift()(messages.shift())
    }
  })
  const next = () => messages.length > 0
    ? Promise.resolve(messages.shift())
    : new Promise((resolve) => waiters.push(resolve))
  return { child, next }
}

function initialize(id = "init", protocolVersion = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion,
      client: { name: "test", version: "0.2.0" },
      maxFrameBytes: MAX_FRAME_BYTES,
    },
    meta: {
      protocolVersion: 1,
      requestId: id,
      sessionId: null,
      turnId: null,
      deadlineUnixMs: Date.now() + 5000,
    },
  }
}

test("real helper accepts fragmented frames and multiple frames in one write", async () => {
  const { child, next } = startHelper()
  try {
    const frame = encodeFrame(initialize())
    child.stdin.write(frame.subarray(0, 3))
    child.stdin.write(frame.subarray(3, 19))
    child.stdin.write(frame.subarray(19))
    const initialized = await next()
    assert.equal(initialized.result.protocolVersion, 1)

    child.stdin.write(Buffer.concat([
      encodeFrame({
        jsonrpc: "2.0",
        id: "health",
        method: "health_check",
        params: {},
        meta: { deadlineUnixMs: Date.now() + 5000 },
      }),
      encodeFrame({
        jsonrpc: "2.0",
        id: "unknown",
        method: "unknown_method",
        params: {},
        meta: { deadlineUnixMs: Date.now() + 5000 },
      }),
    ]))
    const health = await next()
    const unknown = await next()
    assert.equal(health.result.helperVersion, "0.2.0")
    assert.equal(unknown.error.data.computerUseCode, "CU_PROTOCOL_MISMATCH")
  } finally {
    child.kill()
  }
})

test("real helper rejects an incompatible handshake and oversized frame", async () => {
  {
    const { child, next } = startHelper()
    try {
      child.stdin.write(encodeFrame(initialize("bad-version", 99)))
      const response = await next()
      assert.equal(response.error.data.computerUseCode, "CU_PROTOCOL_MISMATCH")
    } finally {
      child.kill()
    }
  }

  {
    const { child, next } = startHelper()
    try {
      const header = Buffer.alloc(4)
      header.writeUInt32LE(MAX_FRAME_BYTES + 1)
      child.stdin.write(header)
      const response = await next()
      assert.equal(response.error.data.computerUseCode, "CU_PROTOCOL_MISMATCH")
    } finally {
      child.kill()
    }
  }
})
