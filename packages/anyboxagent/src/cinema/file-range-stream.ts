import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

/**
 * Returns a backpressure-aware file stream. Unlike `readFile`, the resident
 * memory used here does not grow with a multi-gigabyte media asset.
 */
export function streamCinemaFile(
  filePath: string,
  range?: { start: number; end: number },
): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(filePath, range
    ? { start: range.start, end: range.end }
    : undefined)
  return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
}
