import z from "zod"
import type * as RuntimeEvent from "#session/runtime/runtime-event.ts"

export const MAX_STORED_TRACE_PAYLOAD_BYTES = 32 * 1024

const ArtifactReference = z.object({
  path: z.string(),
  mime: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
})

const ImageSummary = z.object({
  location: z.enum(["top-level", "tool-result"]),
  mime: z.string(),
  bytes: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceTool: z.string().optional(),
})

export const StoredTracePayload = z.object({
  messageID: z.string().optional(),
  partID: z.string().optional(),
  callID: z.string().optional(),
  toolName: z.string().optional(),
  status: z.string().optional(),
  phase: z.string().optional(),
  finishReason: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  retryable: z.boolean().optional(),
  usage: z.object({
    inputTokens: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative().optional(),
    reasoningTokens: z.number().nonnegative().optional(),
    cacheReadTokens: z.number().nonnegative().optional(),
    cacheWriteTokens: z.number().nonnegative().optional(),
  }).optional(),
  textChars: z.number().int().nonnegative().optional(),
  topLevelImageParts: z.number().int().nonnegative().optional(),
  toolResultImageParts: z.number().int().nonnegative().optional(),
  totalImageBytes: z.number().int().nonnegative().optional(),
  images: ImageSummary.array().optional(),
  payloadBytes: z.number().int().nonnegative(),
  artifacts: ArtifactReference.array().optional(),
  payloadTruncated: z.boolean().optional(),
})

export const StoredTraceEvent = z.object({
  position: z.number().int().positive(),
  schemaVersion: z.literal(2),
  eventID: z.string(),
  sessionID: z.string(),
  turnID: z.string().nullable(),
  seq: z.number().int().positive(),
  type: z.string(),
  timestamp: z.number().int().nonnegative(),
  payload: StoredTracePayload,
})

export type StoredTraceEvent = z.infer<typeof StoredTraceEvent>
export type StoredTracePayload = z.infer<typeof StoredTracePayload>

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function shortString(value: unknown, max = 1_000) {
  if (typeof value !== "string" || value.length === 0) return undefined
  const shortened = value.length > max ? `${value.slice(0, max)}…` : value
  return shortened
    .replace(/data:(?:([a-z0-9.+/-]+))?(?:;[^,\s"']*)?,[^\s"']+/gi, "[DATA_URL_OMITTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "[REDACTED]")
}

function jsonBytes(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8")
  } catch {
    return MAX_STORED_TRACE_PAYLOAD_BYTES + 1
  }
}

function collectArtifactReferences(value: unknown) {
  const found = new Map<string, z.infer<typeof ArtifactReference>>()
  const visit = (current: unknown, depth = 0) => {
    if (!current || typeof current !== "object" || depth > 8) return
    if (Array.isArray(current)) {
      for (const item of current.slice(0, 100)) visit(item, depth + 1)
      return
    }

    const candidate = current as Record<string, unknown>
    const path = typeof candidate.path === "string" ? candidate.path : undefined
    const sha256 = typeof candidate.sha256 === "string" ? candidate.sha256 : undefined
    if (path && !path.startsWith("data:") && (sha256 || candidate.kind === "result" || candidate.kind === "attachment" || candidate.kind === "embedded-data")) {
      found.set(path, {
        path,
        mime: shortString(candidate.mime, 200),
        bytes: finiteNumber(candidate.bytes),
        sha256,
      })
    }
    for (const [key, child] of Object.entries(candidate)) {
      if (["input", "output", "modelOutput", "data", "raw", "text"].includes(key)) continue
      visit(child, depth + 1)
    }
  }
  visit(value)
  return [...found.values()].slice(0, 100)
}

export function summarizeRuntimeEvent(event: RuntimeEvent.RuntimeEvent): StoredTracePayload {
  const payload = record(event.payload) ?? {}
  const part = record(payload.part)
  const message = record(payload.message)
  const state = record(part?.state)
  const time = record(state?.time)
  const error = record(payload.error)
  const usage = record(payload.usage)
  const originalBytes = jsonBytes(event.payload)
  const text = typeof part?.text === "string"
    ? part.text
    : typeof payload.text === "string"
      ? payload.text
      : undefined
  const start = finiteNumber(time?.start)
  const end = finiteNumber(time?.end)
  const artifacts = collectArtifactReferences(event.payload)
  const parsedImages = ImageSummary.array().safeParse(payload.images)
  const summary: StoredTracePayload = {
    messageID: shortString(part?.messageID ?? message?.id ?? payload.messageID, 300),
    partID: shortString(part?.id ?? payload.partID, 300),
    callID: shortString(part?.callID ?? payload.toolCallID, 300),
    toolName: shortString(part?.tool ?? payload.toolName, 300),
    status: shortString(state?.status ?? payload.status ?? payload.action, 100),
    phase: shortString(payload.phase, 100),
    finishReason: shortString(payload.finishReason, 300),
    durationMs: start !== undefined && end !== undefined ? Math.max(0, end - start) : undefined,
    error: shortString(
      typeof payload.error === "string"
        ? payload.error
        : error?.message ?? state?.error ?? payload.detail,
    ),
    errorCode: shortString(payload.code ?? error?.code, 200),
    retryable: typeof payload.retryable === "boolean"
      ? payload.retryable
      : typeof error?.retryable === "boolean"
        ? error.retryable
        : undefined,
    usage: usage
      ? {
          inputTokens: finiteNumber(usage.inputTokens),
          outputTokens: finiteNumber(usage.outputTokens),
          reasoningTokens: finiteNumber(usage.reasoningTokens),
          cacheReadTokens: finiteNumber(usage.cacheReadTokens),
          cacheWriteTokens: finiteNumber(usage.cacheWriteTokens),
        }
      : undefined,
    textChars: text?.length,
    topLevelImageParts: finiteNumber(payload.topLevelImageParts),
    toolResultImageParts: finiteNumber(payload.toolResultImageParts),
    totalImageBytes: finiteNumber(payload.totalImageBytes),
    images: parsedImages.success ? parsedImages.data : undefined,
    payloadBytes: originalBytes,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
    payloadTruncated: originalBytes > MAX_STORED_TRACE_PAYLOAD_BYTES ? true : undefined,
  }

  let serialized = JSON.stringify(summary)
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_TRACE_PAYLOAD_BYTES) {
    summary.artifacts = summary.artifacts?.slice(0, 10)
    summary.images = summary.images?.slice(0, 10)
    summary.error = shortString(summary.error, 300)
    summary.payloadTruncated = true
    serialized = JSON.stringify(summary)
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_TRACE_PAYLOAD_BYTES) {
    return {
      payloadBytes: originalBytes,
      payloadTruncated: true,
      status: summary.status,
      partID: summary.partID,
      callID: summary.callID,
      toolName: summary.toolName,
      topLevelImageParts: summary.topLevelImageParts,
      toolResultImageParts: summary.toolResultImageParts,
      totalImageBytes: summary.totalImageBytes,
      images: summary.images?.slice(0, 4),
    }
  }
  return summary
}
