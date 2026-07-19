import {
  BrowserIpcNativeChunkMessage,
  MAX_BROWSER_IPC_CHUNK_BYTES,
  MAX_BROWSER_IPC_MESSAGE_BYTES,
} from "@anybox/chrome-shared/browser-ipc"

type NativeHostChunk = ReturnType<typeof BrowserIpcNativeChunkMessage.parse>

type PendingTransfer = {
  total: number
  totalBytes: number
  chunks: Map<number, Uint8Array>
  receivedBytes: number
  timer: ReturnType<typeof setTimeout>
}

const TRANSFER_TIMEOUT_MS = 30_000
const MAX_COMPLETED_TRANSFER_IDS = 256

function decodeCanonicalBase64(value: string) {
  const decoded = atob(value)
  if (btoa(decoded) !== value) {
    throw new Error("Native Host chunk data is not canonical base64.")
  }
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return bytes
}

export class NativeHostChunkReassembler {
  readonly #transfers = new Map<string, PendingTransfer>()
  readonly #completed = new Map<string, number>()
  #reservedBytes = 0

  push(raw: unknown): unknown | undefined {
    const chunk = BrowserIpcNativeChunkMessage.parse(raw)
    const now = Date.now()
    this.#pruneCompleted(now)
    if (this.#completed.has(chunk.transferID)) {
      throw new Error("Native Host chunk transfer was already completed.")
    }

    let transfer = this.#transfers.get(chunk.transferID)
    if (!transfer) {
      if (
        this.#reservedBytes + chunk.totalBytes
        > MAX_BROWSER_IPC_MESSAGE_BYTES
      ) {
        throw new Error(
          "In-flight Native Host chunks exceed the 64 MiB message limit.",
        )
      }
      const timer = setTimeout(() => {
        this.#drop(chunk.transferID)
      }, TRANSFER_TIMEOUT_MS)
      transfer = {
        total: chunk.total,
        totalBytes: chunk.totalBytes,
        chunks: new Map(),
        receivedBytes: 0,
        timer,
      }
      this.#transfers.set(chunk.transferID, transfer)
      this.#reservedBytes += chunk.totalBytes
    } else if (
      transfer.total !== chunk.total
      || transfer.totalBytes !== chunk.totalBytes
    ) {
      this.#drop(chunk.transferID)
      throw new Error("Native Host chunk metadata changed during transfer.")
    }

    if (transfer.chunks.has(chunk.index)) {
      this.#drop(chunk.transferID)
      throw new Error("Native Host chunk index was received more than once.")
    }
    const bytes = decodeCanonicalBase64(chunk.data)
    if (
      bytes.byteLength === 0
      || bytes.byteLength > MAX_BROWSER_IPC_CHUNK_BYTES
      || transfer.receivedBytes + bytes.byteLength > transfer.totalBytes
    ) {
      this.#drop(chunk.transferID)
      throw new Error("Native Host chunk data is outside its declared limits.")
    }
    transfer.chunks.set(chunk.index, bytes)
    transfer.receivedBytes += bytes.byteLength
    if (transfer.chunks.size < transfer.total) return undefined

    this.#drop(chunk.transferID)
    if (transfer.receivedBytes !== transfer.totalBytes) {
      throw new Error("Native Host chunks do not match the declared message size.")
    }
    const payload = new Uint8Array(transfer.totalBytes)
    let offset = 0
    for (let index = 0; index < transfer.total; index += 1) {
      const part = transfer.chunks.get(index)
      if (!part) {
        throw new Error("Native Host chunk sequence is incomplete.")
      }
      payload.set(part, offset)
      offset += part.byteLength
    }
    this.#completed.set(
      chunk.transferID,
      now + TRANSFER_TIMEOUT_MS,
    )
    while (this.#completed.size > MAX_COMPLETED_TRANSFER_IDS) {
      const oldest = this.#completed.keys().next().value
      if (typeof oldest !== "string") break
      this.#completed.delete(oldest)
    }
    const serialized = new TextDecoder("utf-8", { fatal: true }).decode(payload)
    return JSON.parse(serialized)
  }

  reset() {
    for (const transfer of this.#transfers.values()) {
      clearTimeout(transfer.timer)
    }
    this.#transfers.clear()
    this.#completed.clear()
    this.#reservedBytes = 0
  }

  #drop(transferID: string) {
    const transfer = this.#transfers.get(transferID)
    if (!transfer) return
    clearTimeout(transfer.timer)
    this.#transfers.delete(transferID)
    this.#reservedBytes = Math.max(
      0,
      this.#reservedBytes - transfer.totalBytes,
    )
  }

  #pruneCompleted(now: number) {
    for (const [transferID, expiresAt] of this.#completed) {
      if (expiresAt <= now) this.#completed.delete(transferID)
    }
  }
}

