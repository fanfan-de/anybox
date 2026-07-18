const HEADER_BYTES = 4
const DEFAULT_MAX_MESSAGE_BYTES = 16 * 1024 * 1024

export class NativeMessageDecoder {
  private buffer = Buffer.alloc(0)
  private readonly maxMessageBytes: number

  constructor(options: { maxMessageBytes?: number } = {}) {
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES
  }

  push(chunk: Buffer | Uint8Array) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    const messages: unknown[] = []

    while (this.buffer.length >= HEADER_BYTES) {
      const length = this.buffer.readUInt32LE(0)
      if (length > this.maxMessageBytes) {
        throw new Error(`Native message exceeds ${this.maxMessageBytes} bytes.`)
      }
      if (this.buffer.length < HEADER_BYTES + length) break

      const payload = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + length)
      this.buffer = this.buffer.subarray(HEADER_BYTES + length)
      messages.push(JSON.parse(payload.toString("utf8")) as unknown)
    }

    return messages
  }
}

export function encodeNativeMessage(message: unknown) {
  const payload = Buffer.from(JSON.stringify(message), "utf8")
  if (payload.length > DEFAULT_MAX_MESSAGE_BYTES) {
    throw new Error(`Native message exceeds ${DEFAULT_MAX_MESSAGE_BYTES} bytes.`)
  }

  const frame = Buffer.alloc(HEADER_BYTES + payload.length)
  frame.writeUInt32LE(payload.length, 0)
  payload.copy(frame, HEADER_BYTES)
  return frame
}
