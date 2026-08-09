import { randomUUID } from "node:crypto"
import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import type {
  DesktopPreviewRenderer,
  DesktopReadPreviewTextInput,
  DesktopResolvedPreviewTarget,
  DesktopResolvePreviewTargetInput,
} from "../shared/desktop-ipc-contract"
import { LOCAL_PREVIEW_PROTOCOL, toLocalPreviewProtocolUrl } from "../shared/local-preview-protocol"

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024
const ARTIFACT_METADATA_FILE = "artifact.json"

const previewMimeTypes = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".css", "text/css; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".gif", "image/gif"],
  [".htm", "text/html; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
])

const codeExtensions = new Set([
  ".c",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".log",
  ".mjs",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
])

const validRenderers = new Set<DesktopPreviewRenderer>([
  "url-webview",
  "markdown-preview",
  "html-preview",
  "svg-preview",
  "json-viewer",
  "table-preview",
  "image-preview",
  "code-viewer",
  "system-open",
])

const WINDOWS_DRIVE_PATH_WITH_LEADING_SLASH_PATTERN = /^[\\/]+([A-Za-z]:[\\/].*)$/
const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:[\\/]/
const WINDOWS_UNC_PATH_PATTERN = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/

type PreviewRegistration = {
  purpose: "default" | "plugin-view"
  root: string
  workspaceRoot: string
  pluginID?: string
  viewID?: string
}

const previewRegistrations = new Map<string, PreviewRegistration>()

interface LocalPreviewProtocolRegistrar {
  registerSchemesAsPrivileged(schemes: Array<{
    scheme: string
    privileges: {
      standard: boolean
      secure: boolean
      supportFetchAPI: boolean
    }
  }>): void
  handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void
}

function isPathInside(parent: string, candidate: string) {
  const relativePath = path.relative(parent, candidate)
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
}

function normalizePreviewInputPath(value: string) {
  if (process.platform !== "win32") return value
  return value.replace(WINDOWS_DRIVE_PATH_WITH_LEADING_SLASH_PATTERN, "$1")
}

function isAbsolutePreviewInputPath(value: string) {
  return path.isAbsolute(value) || WINDOWS_DRIVE_PATH_PATTERN.test(value) || WINDOWS_UNC_PATH_PATTERN.test(value)
}

async function maybeRealpath(candidate: string) {
  try {
    return await realpath(candidate)
  } catch {
    return null
  }
}

async function resolveWorkspaceRoot(workspaceRoot: string | null | undefined) {
  const trimmedRoot = workspaceRoot?.trim()
  if (!trimmedRoot) {
    throw new Error("Select a workspace before opening this preview.")
  }

  const resolvedRoot = await realpath(trimmedRoot)
  const rootStats = await stat(resolvedRoot)
  if (!rootStats.isDirectory()) {
    throw new Error("Preview workspace is not available.")
  }

  return resolvedRoot
}

function normalizeUrlPreview(input: string): DesktopResolvedPreviewTarget | null {
  const trimmedInput = input.trim()
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedInput)) return null

  try {
    const parsedUrl = new URL(trimmedInput)
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return null
    return {
      externalOpenTarget: {
        kind: "url",
        value: parsedUrl.toString(),
      },
      input: trimmedInput,
      kind: "url",
      mime: "text/html",
      normalizedInput: parsedUrl.toString(),
      renderer: "url-webview",
      safePreviewUrl: parsedUrl.toString(),
      textReadable: false,
      title: parsedUrl.host || parsedUrl.toString(),
    }
  } catch {
    return null
  }
}

function normalizeImplicitUrlPreview(input: string): DesktopResolvedPreviewTarget | null {
  const trimmedInput = input.trim()
  if (!trimmedInput || trimmedInput.includes("\\") || trimmedInput.startsWith(".") || trimmedInput.startsWith("/")) {
    return null
  }
  if (!/^[\w.-]+(?::\d+)?(?:\/.*)?$/i.test(trimmedInput)) return null

  const host = trimmedInput.split("/")[0]?.split(":")[0]?.toLowerCase() ?? ""
  if (!host.includes(".") && host !== "localhost" && host !== "127.0.0.1" && host !== "0.0.0.0") {
    return null
  }

  return normalizeUrlPreview(`${host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" ? "http" : "https"}://${trimmedInput}`)
}

function getPreviewMimeType(filePath: string) {
  return previewMimeTypes.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream"
}

export function inferPreviewRenderer(filePath: string, mimeType = getPreviewMimeType(filePath)): DesktopPreviewRenderer {
  const extension = path.extname(filePath).toLowerCase()
  const normalizedMime = mimeType.toLowerCase()

  if (extension === ".md" || normalizedMime.includes("markdown")) return "markdown-preview"
  if (extension === ".html" || extension === ".htm" || normalizedMime.includes("text/html")) return "html-preview"
  if (extension === ".svg" || normalizedMime.includes("image/svg")) return "svg-preview"
  if (extension === ".json" || normalizedMime.includes("application/json")) return "json-viewer"
  if (extension === ".csv" || normalizedMime.includes("text/csv")) return "table-preview"
  if (normalizedMime.startsWith("image/")) return "image-preview"
  if (codeExtensions.has(extension) || normalizedMime.startsWith("text/")) return "code-viewer"
  return "system-open"
}

function isTextReadableRenderer(renderer: DesktopPreviewRenderer) {
  return renderer === "markdown-preview" || renderer === "json-viewer" || renderer === "table-preview" || renderer === "code-viewer"
}

function normalizeRenderer(value: unknown): DesktopPreviewRenderer | null {
  return typeof value === "string" && validRenderers.has(value as DesktopPreviewRenderer)
    ? value as DesktopPreviewRenderer
    : null
}

function makePreviewToken() {
  return randomUUID()
}

function registerPreviewRoot(
  root: string,
  workspaceRoot: string,
  purpose: PreviewRegistration["purpose"] = "default",
  owner?: { pluginID: string; viewID: string },
) {
  if (purpose === "plugin-view" && owner) {
    for (const [existingToken, registration] of previewRegistrations) {
      if (
        registration.purpose === "plugin-view"
        && registration.pluginID === owner.pluginID
        && registration.viewID === owner.viewID
      ) {
        previewRegistrations.delete(existingToken)
      }
    }
  }
  const token = makePreviewToken()
  previewRegistrations.set(token, { purpose, root, workspaceRoot, ...owner })
  return token
}

export function revokePluginViewPreviewRegistrations(pluginID: string, keepViewIDs: ReadonlySet<string> = new Set()) {
  for (const [token, registration] of previewRegistrations) {
    if (
      registration.purpose === "plugin-view"
      && registration.pluginID === pluginID
      && (!registration.viewID || !keepViewIDs.has(registration.viewID))
    ) {
      previewRegistrations.delete(token)
    }
  }
}

export function isPluginViewPreviewUrl(value: string) {
  try {
    const parsedUrl = new URL(value)
    if (parsedUrl.protocol !== `${LOCAL_PREVIEW_PROTOCOL}:` || parsedUrl.hostname !== "preview") return false
    const token = parsedUrl.pathname.split("/").filter(Boolean)[0]
    return Boolean(token && previewRegistrations.get(token)?.purpose === "plugin-view")
  } catch {
    return false
  }
}

function toWorkspaceRelativePath(workspaceRoot: string, filePath: string) {
  return path.relative(workspaceRoot, filePath).split(path.sep).join("/")
}

function buildResolvedFileTarget(input: {
  artifactID?: string
  artifactType?: string
  entry: string
  input: string
  kind: "artifact" | "file"
  mime?: string
  renderer?: DesktopPreviewRenderer | null
  root: string
  title?: string
  workspaceRoot: string
  purpose?: PreviewRegistration["purpose"]
  owner?: { pluginID: string; viewID: string }
}): DesktopResolvedPreviewTarget {
  const mime = input.mime?.trim() || getPreviewMimeType(input.entry)
  const renderer = input.renderer ?? inferPreviewRenderer(input.entry, mime)
  const token = renderer === "html-preview" || renderer === "svg-preview" || renderer === "image-preview"
    ? registerPreviewRoot(input.root, input.workspaceRoot, input.purpose, input.owner)
    : null
  const safePreviewUrl = token
    ? toLocalPreviewProtocolUrl(token, path.relative(input.root, input.entry).split(path.sep).join("/"))
    : undefined

  return {
    ...(input.artifactID ? { artifactID: input.artifactID } : {}),
    ...(input.artifactType ? { artifactType: input.artifactType } : {}),
    entry: input.entry,
    externalOpenTarget: {
      kind: "path",
      value: input.entry,
    },
    input: input.input,
    kind: input.kind,
    mime,
    normalizedInput: input.kind === "artifact"
      ? `agent://artifact/${input.artifactID ?? ""}`
      : toWorkspaceRelativePath(input.workspaceRoot, input.entry),
    path: input.entry,
    renderer,
    ...(safePreviewUrl ? { safePreviewUrl } : {}),
    textReadable: isTextReadableRenderer(renderer),
    title: input.title?.trim() || path.basename(input.entry),
    workspaceRoot: input.workspaceRoot,
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

async function readArtifactMetadata(metadataPath: string) {
  const raw = await readFile(metadataPath, "utf8")
  const parsed = JSON.parse(raw) as Record<string, unknown>
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
}

function resolveMetadataPath(baseDirectory: string, value: string | null) {
  if (!value) return null
  return path.resolve(path.isAbsolute(value) ? value : path.join(baseDirectory, value))
}

async function resolveArtifactEntryFromMetadata(input: {
  artifactID: string
  artifactsRoot: string
  metadataBase: string
  metadataPath: string
  workspaceRoot: string
}) {
  const metadata = await readArtifactMetadata(input.metadataPath)
  const metadataEntry = readString(metadata.entry)
  const metadataPath = readString(metadata.path)
  const candidateEntry = resolveMetadataPath(input.metadataBase, metadataEntry ?? metadataPath)
  const artifactPath = resolveMetadataPath(input.metadataBase, metadataPath)
  const artifactPathStats = artifactPath ? await stat(artifactPath).catch(() => null) : null
  let artifactRoot = input.metadataBase
  if (artifactPath && artifactPathStats?.isDirectory()) {
    artifactRoot = await realpath(artifactPath)
  }
  const fallbackIndex = path.join(artifactRoot, "index.html")
  const rawEntry = candidateEntry ?? ((await maybeRealpath(fallbackIndex)) ? fallbackIndex : null)

  if (!rawEntry) {
    return {
      metadata,
      entry: null,
      root: artifactRoot,
    }
  }

  const entry = await realpath(rawEntry)
  if (!isPathInside(input.artifactsRoot, entry)) {
    throw new Error("Artifact preview entry must stay inside the workspace artifacts directory.")
  }

  return {
    metadata,
    entry,
    root: await realpath(artifactRoot).catch(() => input.metadataBase),
  }
}

function parseArtifactID(input: string) {
  try {
    const parsedUrl = new URL(input.trim())
    if (parsedUrl.protocol !== "agent:" || parsedUrl.hostname !== "artifact") return null
    const id = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, "")).trim()
    return /^[A-Za-z0-9._-]+$/.test(id) ? id : null
  } catch {
    return null
  }
}

async function resolveArtifactPreviewTarget(input: string, workspaceRoot: string): Promise<DesktopResolvedPreviewTarget> {
  const artifactID = parseArtifactID(input)
  if (!artifactID) {
    throw new Error("Artifact link is invalid.")
  }

  const artifactsRoot = path.join(workspaceRoot, "artifacts")
  const resolvedArtifactsRoot = await realpath(artifactsRoot).catch(() => null)
  if (!resolvedArtifactsRoot) {
    throw new Error("This workspace does not have an artifacts directory yet.")
  }

  const artifactDirectory = path.join(resolvedArtifactsRoot, artifactID)
  const artifactMetadataPath = path.join(artifactDirectory, ARTIFACT_METADATA_FILE)
  const sidecarMetadataPath = path.join(resolvedArtifactsRoot, `${artifactID}.artifact.json`)
  const metadataPath = (await maybeRealpath(artifactMetadataPath)) ?? (await maybeRealpath(sidecarMetadataPath))

  if (metadataPath) {
    const resolvedArtifactDirectory = await maybeRealpath(artifactDirectory)
    const metadataBase = resolvedArtifactDirectory && path.dirname(metadataPath) === resolvedArtifactDirectory
      ? artifactDirectory
      : resolvedArtifactsRoot
    const { entry, metadata, root } = await resolveArtifactEntryFromMetadata({
      artifactID,
      artifactsRoot: resolvedArtifactsRoot,
      metadataBase,
      metadataPath,
      workspaceRoot,
    })
    const title = readString(metadata.title) ?? artifactID
    const renderer = normalizeRenderer(metadata.renderer)
    const mime = readString(metadata.mime) ?? undefined
    const artifactType = readString(metadata.artifactType) ?? undefined

    if (!entry) {
      return {
        artifactID,
        artifactType,
        externalOpenTarget: {
          kind: "path",
          value: root,
        },
        input,
        kind: "artifact",
        mime: "inode/directory",
        normalizedInput: `agent://artifact/${artifactID}`,
        path: root,
        renderer: "system-open",
        textReadable: false,
        title,
        workspaceRoot,
      }
    }

    return buildResolvedFileTarget({
      artifactID,
      artifactType,
      entry,
      input,
      kind: "artifact",
      mime,
      renderer,
      root,
      title,
      workspaceRoot,
    })
  }

  const directDirectory = await maybeRealpath(artifactDirectory)
  if (directDirectory) {
    const indexPath = await maybeRealpath(path.join(directDirectory, "index.html"))
    if (indexPath) {
      return buildResolvedFileTarget({
        artifactID,
        entry: indexPath,
        input,
        kind: "artifact",
        root: directDirectory,
        title: artifactID,
        workspaceRoot,
      })
    }
  }

  const directFileCandidates = [
    ".md",
    ".html",
    ".svg",
    ".json",
    ".csv",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".txt",
  ].map((extension) => path.join(resolvedArtifactsRoot, `${artifactID}${extension}`))

  for (const candidate of directFileCandidates) {
    const resolved = await maybeRealpath(candidate)
    if (!resolved) continue
    return buildResolvedFileTarget({
      artifactID,
      entry: resolved,
      input,
      kind: "artifact",
      root: resolvedArtifactsRoot,
      title: artifactID,
      workspaceRoot,
    })
  }

  throw new Error(`Artifact '${artifactID}' was not found in this workspace.`)
}

async function resolveWorkspaceFilePreviewTarget(
  input: string,
  workspaceRoot: string,
  purpose: PreviewRegistration["purpose"] = "default",
  owner?: { pluginID: string; viewID: string },
): Promise<DesktopResolvedPreviewTarget> {
  const trimmedInput = normalizePreviewInputPath(input.trim())
  const candidatePath = path.resolve(isAbsolutePreviewInputPath(trimmedInput) ? trimmedInput : path.join(workspaceRoot, trimmedInput))
  const resolvedPath = await realpath(candidatePath)

  if (!isPathInside(workspaceRoot, resolvedPath)) {
    throw new Error("Preview file must stay inside the current workspace.")
  }

  const fileStat = await stat(resolvedPath)
  if (!fileStat.isFile()) {
    throw new Error("Preview target must be a file.")
  }

  return buildResolvedFileTarget({
    entry: resolvedPath,
    input,
    kind: isPathInside(path.join(workspaceRoot, "artifacts"), resolvedPath) ? "artifact" : "file",
    root: purpose === "plugin-view" ? workspaceRoot : path.dirname(resolvedPath),
    workspaceRoot,
    purpose,
    owner,
  })
}

export async function resolvePreviewTarget(input: DesktopResolvePreviewTargetInput): Promise<DesktopResolvedPreviewTarget> {
  const value = input.value.trim()
  if (!value) {
    throw new Error("Enter a URL, Artifact link, or workspace file path to preview.")
  }

  const urlPreview = normalizeUrlPreview(value) ?? normalizeImplicitUrlPreview(value)
  if (urlPreview) return urlPreview

  const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot)
  if (value.toLowerCase().startsWith("agent://artifact/")) {
    return resolveArtifactPreviewTarget(value, workspaceRoot)
  }

  return resolveWorkspaceFilePreviewTarget(value, workspaceRoot)
}

export async function resolvePluginViewPreviewTarget(input: {
  entry: string
  packageRoot: string
  pluginID: string
  viewID: string
}) {
  const workspaceRoot = await resolveWorkspaceRoot(input.packageRoot)
  return resolveWorkspaceFilePreviewTarget(input.entry, workspaceRoot, "plugin-view", {
    pluginID: input.pluginID,
    viewID: input.viewID,
  })
}

export async function readPreviewText(input: DesktopReadPreviewTextInput) {
  const workspaceRoot = await resolveWorkspaceRoot(input.workspaceRoot)
  const targetPath = path.resolve(input.path)
  const resolvedPath = await realpath(targetPath)

  if (!isPathInside(workspaceRoot, resolvedPath)) {
    throw new Error("Preview file must stay inside the current workspace.")
  }

  const fileStat = await stat(resolvedPath)
  if (!fileStat.isFile()) {
    throw new Error("Preview target must be a file.")
  }
  if (fileStat.size > MAX_TEXT_PREVIEW_BYTES) {
    throw new Error("Preview file is too large for inline text preview.")
  }

  return {
    content: await readFile(resolvedPath, "utf8"),
    path: resolvedPath,
  }
}

export async function resolveLocalPreviewProtocolRequest(requestUrl: string) {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(requestUrl)
  } catch {
    return { ok: false as const, status: 400, error: "Invalid preview URL." }
  }

  if (parsedUrl.protocol !== `${LOCAL_PREVIEW_PROTOCOL}:` || parsedUrl.hostname !== "preview") {
    return { ok: false as const, status: 400, error: "Invalid preview protocol." }
  }

  const segments = parsedUrl.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment))
  const token = segments.shift()
  if (!token) {
    return { ok: false as const, status: 400, error: "Missing preview token." }
  }

  const registration = previewRegistrations.get(token)
  if (!registration) {
    return { ok: false as const, status: 404, error: "Preview token was not found or has expired." }
  }

  const relativePath = segments.join("/")
  const candidatePath = path.resolve(registration.root, relativePath || ".")
  const resolvedPath = await realpath(candidatePath).catch(() => null)
  if (!resolvedPath) {
    return { ok: false as const, status: 404, error: "Preview file was not found." }
  }
  if (!isPathInside(registration.root, resolvedPath) || !isPathInside(registration.workspaceRoot, resolvedPath)) {
    return { ok: false as const, status: 403, error: "Preview file is outside the registered preview root." }
  }

  const fileStat = await stat(resolvedPath).catch(() => null)
  if (!fileStat?.isFile()) {
    return { ok: false as const, status: 400, error: "Preview source must be a file." }
  }
  if (fileStat.size > MAX_PREVIEW_BYTES) {
    return { ok: false as const, status: 413, error: "Preview file is too large." }
  }

  const mimeType = getPreviewMimeType(resolvedPath)
  if (mimeType === "application/octet-stream") {
    return { ok: false as const, status: 415, error: "Preview file type is not supported." }
  }

  return {
    ok: true as const,
    filePath: resolvedPath,
    mimeType,
    purpose: registration.purpose,
    size: fileStat.size,
  }
}

export async function handleLocalPreviewProtocolRequest(request: Request) {
  const result = await resolveLocalPreviewProtocolRequest(request.url)
  if (!result.ok) {
    return new Response(result.error, {
      status: result.status,
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
    })
  }

  const body = await readFile(result.filePath)
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "content-length": String(result.size),
    "content-type": result.mimeType,
  }
  if (result.purpose === "plugin-view") {
    headers["content-security-policy"] = [
      "default-src 'none'",
      "base-uri 'none'",
      "connect-src 'none'",
      "font-src 'self' data:",
      "form-action 'none'",
      "frame-src 'none'",
      "img-src 'self' data:",
      "media-src 'self'",
      "navigate-to 'self'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "worker-src 'none'",
    ].join("; ")
    headers["cross-origin-resource-policy"] = "same-origin"
    headers["x-content-type-options"] = "nosniff"
  }

  return new Response(body, { headers })
}

export function registerLocalPreviewProtocolScheme(protocolRegistrar: Pick<LocalPreviewProtocolRegistrar, "registerSchemesAsPrivileged">) {
  protocolRegistrar.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_PREVIEW_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ])
}

export function registerLocalPreviewProtocolHandler(protocolRegistrar: Pick<LocalPreviewProtocolRegistrar, "handle">) {
  protocolRegistrar.handle(LOCAL_PREVIEW_PROTOCOL, handleLocalPreviewProtocolRequest)
}
