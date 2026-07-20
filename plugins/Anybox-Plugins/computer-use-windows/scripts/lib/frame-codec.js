"use strict"

const { MAX_FRAME_BYTES } = require("./build-info")
const { cuError } = require("./errors")

function encodeFrame(payload, maxFrameBytes = MAX_FRAME_BYTES) {
  let body
  try {
    body = Buffer.from(JSON.stringify(payload), "utf8")
  } catch (error) {
    throw cuError("CU_PROTOCOL_MISMATCH", "Could not encode a helper protocol message.", { cause: error })
  }
  if (body.length === 0 || body.length > maxFrameBytes) {
    throw cuError(
      "CU_PROTOCOL_MISMATCH",
      `Helper protocol frame length ${body.length} is outside the supported range.`,
    )
  }
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}

class FrameDecoder {
  constructor(options = {}) {
    this.maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES
    this.buffer = Buffer.alloc(0)
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk)
    if (chunk.length === 0) return []
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const messages = []

    while (this.buffer.length >= 4) {
      const bodyLength = this.buffer.readUInt32LE(0)
      if (bodyLength === 0 || bodyLength > this.maxFrameBytes) {
        this.buffer = Buffer.alloc(0)
        throw cuError(
          "CU_PROTOCOL_MISMATCH",
          `Helper protocol frame length ${bodyLength} is outside the supported range.`,
        )
      }
      if (this.buffer.length < bodyLength + 4) break

      const body = this.buffer.subarray(4, bodyLength + 4)
      this.buffer = this.buffer.subarray(bodyLength + 4)
      let message
      try {
        message = JSON.parse(body.toString("utf8"))
      } catch (error) {
        this.buffer = Buffer.alloc(0)
        throw cuError("CU_PROTOCOL_MISMATCH", "Helper returned invalid UTF-8 JSON.", { cause: error })
      }
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        throw cuError("CU_PROTOCOL_MISMATCH", "Helper returned a non-object protocol message.")
      }
      messages.push(message)
    }

    return messages
  }

  reset() {
    this.buffer = Buffer.alloc(0)
  }
}

module.exports = {
  FrameDecoder,
  encodeFrame,
}
