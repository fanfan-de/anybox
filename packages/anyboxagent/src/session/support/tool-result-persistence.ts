import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { existsSync, rmSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import * as Global from "#global/global.ts"

export const DEFAULT_MAX_RESULT_CHARS = 50_000
export const SERIALIZED_RESULT_MAX_BYTES = 64 * 1024
export const PREVIEW_CHARS = 2_000

const METADATA_KIND = "persisted-tool-output"
const METADATA_VERSION = 2
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/
const DATA_URL_PATTERN = /^data:([^;,]+)?(?:;[^;,=]+=[^;,]*)*(;base64)?,(.*)$/is
const SCRUBBED_METADATA_KEYS = new Set([
  "body",
  "content",
  "data",
  "modeloutput",
  "output",
  "raw",
  "stderr",
  "stdout",
  "text",
])

export type ToolArtifactReference = {
  path: string
  mime: string
  bytes: number
  sha256: string
  kind: "result" | "attachment" | "embedded-data"
  filename?: string
}

export type ToolArtifactManifest = {
  schemaVersion: 2
  sessionID: string
  toolCallID: string
  toolName: string
  createdAt: number
  files: ToolArtifactReference[]
}

export type PersistedOutputMetadata = {
  kind: typeof METADATA_KIND
  version: 1 | typeof METADATA_VERSION
  path?: string
  relativePath?: string
  envelopePath?: string
  manifestPath?: string
  manifestRelativePath?: string
  artifacts?: ToolArtifactReference[]
  originalSizeChars: number
  originalSizeBytes: number
  previewChars: number
  hasMore: boolean
  replacement: string
  failed?: boolean
  error?: string
}

type AttachmentLike = {
  url: string
  mime: string
  filename?: string
  metadata?: Record<string, unknown>
}

export type PersistToolResultInput = {
  sessionID: string
  toolCallID: string
  toolName: string
  output: string
  metadata: Record<string, unknown>
  modelOutput: unknown
  data?: unknown
  attachments?: AttachmentLike[]
  rawResult?: unknown
  maxResultSizeChars?: number
}

export type PersistToolResultOutput = {
  output: string
  metadata: Record<string, unknown>
  modelOutput: unknown
  data?: unknown
  attachments?: AttachmentLike[]
  persisted?: PersistedOutputMetadata
}

export function getEffectiveThreshold(maxResultSizeChars?: number) {
  if (maxResultSizeChars === Infinity) return Infinity
  if (typeof maxResultSizeChars === "number" && Number.isFinite(maxResultSizeChars) && maxResultSizeChars > 0) {
    return Math.min(maxResultSizeChars, DEFAULT_MAX_RESULT_CHARS)
  }

  return DEFAULT_MAX_RESULT_CHARS
}

export function makeSafeFileSegment(value: string) {
  if (SAFE_SEGMENT_PATTERN.test(value)) return value
  return `tool_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`
}

export function getSessionOutputDirectory(sessionID: string) {
  return path.join(Global.Path.state, "sessions", makeSafeFileSegment(sessionID), "tool-results")
}

export function getSessionDirectory(sessionID: string) {
  return path.join(Global.Path.state, "sessions", makeSafeFileSegment(sessionID))
}

function assertWithin(parent: string, child: string) {
  const resolvedParent = path.resolve(parent)
  const resolvedChild = path.resolve(child)
  const relative = path.relative(resolvedParent, resolvedChild)
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return
  }

  throw new Error(`Resolved path is outside expected directory: ${resolvedChild}`)
}

export function isManagedSessionArtifactPath(sessionID: string, candidate: string) {
  try {
    const root = getSessionOutputDirectory(sessionID)
    assertWithin(root, candidate)
    return path.resolve(root) !== path.resolve(candidate)
  } catch {
    return false
  }
}

export function removeSessionOutputDirectory(sessionID: string) {
  const sessionsRoot = path.join(Global.Path.state, "sessions")
  const sessionDir = getSessionDirectory(sessionID)
  assertWithin(sessionsRoot, sessionDir)
  rmSync(sessionDir, { recursive: true, force: true })
}

export function makePreview(text: string, maxChars = PREVIEW_CHARS) {
  if (text.length <= maxChars) return text

  const slice = text.slice(0, maxChars)
  const lastNewline = slice.lastIndexOf("\n")

  if (lastNewline > maxChars * 0.5) {
    return slice.slice(0, lastNewline)
  }

  return slice
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KiB", "MiB", "GiB"]
  let value = bytes / 1024
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`
    }
    value /= 1024
  }

  return `${bytes} B`
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function buildPersistedMessage(input: {
  path?: string
  bytes: number
  preview: string
  hasMore: boolean
  failed?: boolean
  error?: string
}) {
  const lines = [
    "<persisted-output>",
    input.failed
      ? `Tool result exceeded the in-database budget (${formatBytes(input.bytes)}). The artifact could not be saved: ${input.error ?? "unknown error"}`
      : `Tool result exceeded the in-database budget (${formatBytes(input.bytes)}). The full result was saved to: ${input.path}`,
    input.failed ? undefined : "Use read_file with this path if you need the full result.",
    "",
    `Preview (first ${PREVIEW_CHARS} chars):`,
    input.preview,
    input.hasMore ? "" : undefined,
    input.hasMore ? "[result truncated in context; read the artifact for the full result]" : undefined,
    "</persisted-output>",
  ].filter((line): line is string => line !== undefined)

  return lines.join("\n")
}

function serializableJson(value: unknown, pretty = false) {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(value, (_key, current) => {
      if (typeof current === "bigint") return current.toString()
      if (typeof current === "object" && current !== null) {
        if (seen.has(current)) return "[Circular]"
        seen.add(current)
      }
      return current
    }, pretty ? 2 : undefined) ?? "null"
  } catch {
    return JSON.stringify({
      serializationError: "Value could not be JSON serialized.",
      value: String(value),
    }, null, pretty ? 2 : undefined)
  }
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function mimeExtension(mime: string) {
  const normalized = mime.toLowerCase().split(";", 1)[0] ?? ""
  const known: Record<string, string> = {
    "application/json": ".json",
    "application/pdf": ".pdf",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
    "text/plain": ".txt",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  }
  return known[normalized] ?? ""
}

function decodeInlineAttachment(url: string, fallbackMime: string) {
  const dataUrl = DATA_URL_PATTERN.exec(url)
  if (dataUrl) {
    const mime = dataUrl[1] || fallbackMime || "application/octet-stream"
    const data = dataUrl[3] ?? ""
    return {
      mime,
      bytes: dataUrl[2]
        ? Buffer.from(data.replace(/\s+/g, ""), "base64")
        : Buffer.from(decodeURIComponent(data), "utf8"),
    }
  }

  // Some MCP providers expose a bare base64 string as the attachment URL.
  // Restrict detection to long, scheme-less values so normal relative paths are untouched.
  if (
    url.length >= 128 &&
    !url.includes("://") &&
    !url.includes("/") &&
    /^[A-Za-z0-9+_=\r\n-]+$/.test(url)
  ) {
    const normalized = url.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/")
    return {
      mime: fallbackMime || "application/octet-stream",
      bytes: Buffer.from(normalized, "base64"),
    }
  }

  return undefined
}

function containsInlineAttachment(attachments: AttachmentLike[] | undefined) {
  return attachments?.some((attachment) => Boolean(decodeInlineAttachment(attachment.url, attachment.mime))) ?? false
}

function shouldScrubMetadataString(key: string, value: string) {
  return SCRUBBED_METADATA_KEYS.has(key.toLowerCase()) || value.length > PREVIEW_CHARS || value.startsWith("data:")
}

export function scrubMetadataForPersistedOutput(
  value: Record<string, unknown>,
  persisted: PersistedOutputMetadata,
): Record<string, unknown> {
  function scrub(current: unknown, key = "", depth = 0): unknown {
    if (typeof current === "string") {
      if (shouldScrubMetadataString(key, current)) {
        return `[omitted from context; full tool result is saved at ${persisted.path ?? "(save failed)"}]`
      }
      return current
    }

    if (!current || typeof current !== "object") return current
    if (depth > 6) return "[omitted from context]"

    if (Array.isArray(current)) {
      return current.slice(0, 100).map((item) => scrub(item, key, depth + 1))
    }

    const output: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(current as Record<string, unknown>)) {
      output[childKey] = scrub(childValue, childKey, depth + 1)
    }
    return output
  }

  const scrubbed = scrub(value) as Record<string, unknown>
  const result = {
    ...scrubbed,
    persistedOutput: persisted,
  } as Record<string, unknown>

  // Metadata itself is diagnostic. Never let it defeat the result budget with
  // large arrays or deeply nested structured content.
  if (Buffer.byteLength(serializableJson(result), "utf8") > 16 * 1024) {
    return { persistedOutput: persisted }
  }
  return result
}

export function readPersistedOutputMetadata(metadata: Record<string, unknown> | undefined): PersistedOutputMetadata | undefined {
  const candidate = metadata?.persistedOutput
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined
  const record = candidate as Record<string, unknown>
  if (record.kind !== METADATA_KIND || (record.version !== 1 && record.version !== METADATA_VERSION)) return undefined
  if (typeof record.replacement !== "string") return undefined

  return record as PersistedOutputMetadata
}

function resultEnvelope(input: PersistToolResultInput) {
  if (input.rawResult !== undefined) {
    return {
      schemaVersion: 2,
      sessionID: input.sessionID,
      toolCallID: input.toolCallID,
      toolName: input.toolName,
      result: input.rawResult,
    }
  }
  return {
    schemaVersion: 2,
    sessionID: input.sessionID,
    toolCallID: input.toolCallID,
    toolName: input.toolName,
    output: input.output,
    metadata: input.metadata,
    modelOutput: input.modelOutput,
    data: input.data,
    attachments: input.attachments,
  }
}

async function persistEnvelope(input: PersistToolResultInput, serializedBytes: number) {
  const sessionRoot = getSessionOutputDirectory(input.sessionID)
  await mkdir(sessionRoot, { recursive: true })

  const sourceJson = serializableJson(resultEnvelope(input))
  const contentHash = sha256(sourceJson).slice(0, 12)
  const directoryName = `${makeSafeFileSegment(input.toolCallID)}-${contentHash}`
  const finalDirectory = path.join(sessionRoot, directoryName)
  const temporaryDirectory = path.join(sessionRoot, `.tmp-${directoryName}-${randomUUID()}`)
  assertWithin(sessionRoot, finalDirectory)
  assertWithin(sessionRoot, temporaryDirectory)

  await mkdir(temporaryDirectory, { recursive: false })
  const files: ToolArtifactReference[] = []

  try {
    const writtenInlineFiles = new Map<string, { absolutePath: string; reference: ToolArtifactReference }>()
    let inlineIndex = 0
    const externalizeInlineValues = async (
      current: unknown,
      context?: { key?: string; mime?: string; filename?: string },
      depth = 0,
    ): Promise<unknown> => {
      if (typeof current === "string") {
        const decoded = current.startsWith("data:")
          ? decodeInlineAttachment(current, context?.mime ?? "application/octet-stream")
          : context?.key === "url"
            ? decodeInlineAttachment(current, context.mime ?? "application/octet-stream")
            : undefined
        if (!decoded) return current

        const digest = sha256(decoded.bytes)
        const existing = writtenInlineFiles.get(digest)
        if (existing) return existing.absolutePath

        inlineIndex += 1
        const isAttachment = context?.key === "url"
        const suggestedExtension = path.extname(context?.filename ?? "") || mimeExtension(decoded.mime)
        const filename = `${isAttachment ? "attachment" : "embedded"}-${inlineIndex}-${digest.slice(0, 12)}${suggestedExtension}`
        const temporaryPath = path.join(temporaryDirectory, filename)
        assertWithin(temporaryDirectory, temporaryPath)
        await writeFile(temporaryPath, decoded.bytes, { flag: "wx" })
        const relativePath = path.join(directoryName, filename)
        const reference: ToolArtifactReference = {
          path: relativePath,
          mime: decoded.mime,
          bytes: decoded.bytes.byteLength,
          sha256: digest,
          kind: isAttachment ? "attachment" : "embedded-data",
          filename: context?.filename,
        }
        files.push(reference)
        const absolutePath = path.join(finalDirectory, filename)
        writtenInlineFiles.set(digest, { absolutePath, reference })
        return absolutePath
      }

      if (current === null || typeof current !== "object" || depth > 30) return current
      if (Array.isArray(current)) {
        return Promise.all(current.map((item) => externalizeInlineValues(item, undefined, depth + 1)))
      }

      const record = current as Record<string, unknown>
      const mime = typeof record.mime === "string" ? record.mime : context?.mime
      const filename = typeof record.filename === "string" ? record.filename : context?.filename
      const transformed: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(record)) {
        transformed[key] = await externalizeInlineValues(value, { key, mime, filename }, depth + 1)
      }
      if (typeof record.url === "string" && typeof transformed.url === "string" && transformed.url !== record.url) {
        const saved = [...writtenInlineFiles.values()].find((item) => item.absolutePath === transformed.url)
        transformed.metadata = {
          ...(transformed.metadata && typeof transformed.metadata === "object" && !Array.isArray(transformed.metadata)
            ? transformed.metadata as Record<string, unknown>
            : {}),
          artifact: saved
            ? {
                path: saved.reference.path,
                bytes: saved.reference.bytes,
                sha256: saved.reference.sha256,
              }
            : undefined,
        }
      }
      return transformed
    }

    const envelope = await externalizeInlineValues(resultEnvelope(input)) as Record<string, unknown>
    const transformedResult = input.rawResult !== undefined && envelope.result && typeof envelope.result === "object"
      ? envelope.result as Record<string, unknown>
      : envelope
    const transformedAttachments = Array.isArray(transformedResult.attachments)
      ? transformedResult.attachments as AttachmentLike[]
      : input.attachments
    const resultJson = serializableJson(envelope, true)
    const resultFilename = "result.json"
    await writeFile(path.join(temporaryDirectory, resultFilename), resultJson, { encoding: "utf8", flag: "wx" })
    const resultReference: ToolArtifactReference = {
      path: path.join(directoryName, resultFilename),
      mime: "application/json",
      bytes: Buffer.byteLength(resultJson, "utf8"),
      sha256: sha256(resultJson),
      kind: "result",
    }
    files.unshift(resultReference)

    const manifest: ToolArtifactManifest = {
      schemaVersion: 2,
      sessionID: input.sessionID,
      toolCallID: input.toolCallID,
      toolName: input.toolName,
      createdAt: Date.now(),
      files,
    }
    const manifestJson = serializableJson(manifest, true)
    const manifestFilename = "manifest.json"
    await writeFile(path.join(temporaryDirectory, manifestFilename), manifestJson, { encoding: "utf8", flag: "wx" })

    try {
      await rename(temporaryDirectory, finalDirectory)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!existsSync(finalDirectory) || !["EEXIST", "ENOTEMPTY", "EPERM"].includes(code ?? "")) throw error
      await rm(temporaryDirectory, { recursive: true, force: true })
    }

    // A concurrent/idempotent writer may have won the deterministic directory.
    // Read its manifest so database references always match files on disk.
    const manifestPath = path.join(finalDirectory, manifestFilename)
    const persistedManifest = JSON.parse(await readFile(manifestPath, "utf8")) as ToolArtifactManifest
    const resultPath = path.join(sessionRoot, persistedManifest.files.find((file) => file.kind === "result")?.path ?? resultReference.path)
    return {
      serializedBytes,
      resultPath,
      resultRelativePath: path.relative(sessionRoot, resultPath),
      manifestPath,
      manifestRelativePath: path.relative(sessionRoot, manifestPath),
      manifest: persistedManifest,
      attachments: transformedAttachments,
    }
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

export async function maybePersistToolResult(input: PersistToolResultInput): Promise<PersistToolResultOutput> {
  const threshold = getEffectiveThreshold(input.maxResultSizeChars)
  const serialized = serializableJson(resultEnvelope(input))
  const serializedBytes = Buffer.byteLength(serialized, "utf8")
  const requiresPersistence =
    input.output.length > threshold ||
    serializedBytes > SERIALIZED_RESULT_MAX_BYTES ||
    containsInlineAttachment(input.attachments)

  if (!requiresPersistence) {
    return {
      output: input.output,
      metadata: input.metadata,
      modelOutput: input.modelOutput,
      data: input.data,
      attachments: input.attachments,
    }
  }

  const outputBytes = Buffer.byteLength(input.output, "utf8")
  const preview = makePreview(input.output, PREVIEW_CHARS)
  const hasMore = input.output.length > preview.length || serializedBytes > outputBytes

  try {
    const saved = await persistEnvelope(input, serializedBytes)
    const replacement = buildPersistedMessage({
      path: saved.resultPath,
      bytes: serializedBytes,
      preview,
      hasMore,
    })
    const persisted: PersistedOutputMetadata = {
      kind: METADATA_KIND,
      version: METADATA_VERSION,
      path: saved.resultPath,
      relativePath: saved.resultRelativePath,
      envelopePath: saved.resultPath,
      manifestPath: saved.manifestPath,
      manifestRelativePath: saved.manifestRelativePath,
      artifacts: saved.manifest.files,
      originalSizeChars: input.output.length,
      originalSizeBytes: serializedBytes,
      previewChars: preview.length,
      hasMore,
      replacement,
    }

    return {
      output: replacement,
      metadata: scrubMetadataForPersistedOutput(input.metadata, persisted),
      modelOutput: undefined,
      data: undefined,
      attachments: saved.attachments,
      persisted,
    }
  } catch (error) {
    const replacement = buildPersistedMessage({
      bytes: serializedBytes,
      preview,
      hasMore,
      failed: true,
      error: errorMessage(error),
    })
    const persisted: PersistedOutputMetadata = {
      kind: METADATA_KIND,
      version: METADATA_VERSION,
      originalSizeChars: input.output.length,
      originalSizeBytes: serializedBytes,
      previewChars: preview.length,
      hasMore,
      replacement,
      failed: true,
      error: errorMessage(error),
    }

    return {
      output: replacement,
      metadata: scrubMetadataForPersistedOutput(input.metadata, persisted),
      modelOutput: undefined,
      data: undefined,
      attachments: input.attachments?.filter((attachment) => !decodeInlineAttachment(attachment.url, attachment.mime)),
      persisted,
    }
  }
}
