import path from "node:path"
import { createReadStream, realpathSync } from "node:fs"
import { mkdir, open, readFile, readdir, rename, rm, stat as localStat, writeFile } from "node:fs/promises"
import {
  containsSshRemotePath,
  createSshWorkspaceUri,
  isSshWorkspaceUri,
  joinSshRemotePath,
  normalizeSshRemotePath,
  parseWorkspaceLocation,
  relativeSshRemotePath,
} from "@anybox/shared"
import { Instance } from "#project/instance.ts"
import * as Filesystem from "#util/filesystem.ts"
import { currentFilesystemAuthorization } from "#permission/filesystem-authorization.ts"
import * as Ssh from "#remote/ssh/index.ts"

const FAST_TEXT_READ_BYTES = 1024 * 1024
const TEXT_SAMPLE_BYTES = 8192

const BLOCKED_DEVICE_PATHS = new Set([
  "/dev/zero",
  "/dev/random",
  "/dev/urandom",
  "/dev/full",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/tty",
  "/dev/console",
  "/dev/fd/0",
  "/dev/fd/1",
  "/dev/fd/2",
])

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".a",
  ".avi",
  ".bin",
  ".bmp",
  ".class",
  ".dll",
  ".dmg",
  ".doc",
  ".docx",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".lib",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".pdf",
  ".png",
  ".pyc",
  ".rar",
  ".so",
  ".sqlite",
  ".sqlite3",
  ".tar",
  ".ttf",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".zip",
])

const DEFAULT_SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
])

type TextFileAction = "read" | "write"
export type ProjectEntryKind = "file" | "directory"

export interface ProjectEntry {
  path: string
  relativePath: string
  displayPath: string
  kind: ProjectEntryKind
}

export interface WriteTextFileTarget {
  path: string
  displayPath: string
  exists: boolean
}

export interface WorkspacePathStat {
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
  size: number
  mtimeMs: number
}

export interface WorkspaceDirectoryEntry {
  name: string
  path: string
  displayPath: string
  kind: ProjectEntryKind
  size: number
  modifiedAt: number
}

function isRemoteWorkspace() {
  return isSshWorkspaceUri(Instance.directory)
}

function currentSshLocation() {
  const location = parseWorkspaceLocation(Instance.directory)
  if (location.kind !== "ssh") throw new Error("Current workspace is not an SSH workspace")
  return location
}

function toWorkspaceStat(info: Ssh.RemoteFileStat): WorkspacePathStat {
  return {
    isFile: () => info.isFile,
    isDirectory: () => info.isDirectory,
    isSymbolicLink: () => info.isSymbolicLink,
    size: info.size,
    mtimeMs: info.mtimeMs,
  }
}

function extnameForPath(resolvedPath: string) {
  if (isSshWorkspaceUri(resolvedPath)) {
    const location = parseWorkspaceLocation(resolvedPath)
    return location.kind === "ssh" ? path.posix.extname(location.remotePath) : path.extname(resolvedPath)
  }

  return path.extname(resolvedPath)
}

function dirnameForPath(resolvedPath: string) {
  if (isSshWorkspaceUri(resolvedPath)) {
    const location = parseWorkspaceLocation(resolvedPath)
    if (location.kind === "ssh") return createSshWorkspaceUri(location.profileID, path.posix.dirname(location.remotePath))
  }

  return path.dirname(resolvedPath)
}

function basenameForPath(resolvedPath: string) {
  if (isSshWorkspaceUri(resolvedPath)) {
    const location = parseWorkspaceLocation(resolvedPath)
    if (location.kind === "ssh") return path.posix.basename(location.remotePath)
  }

  return path.basename(resolvedPath)
}

function joinWorkspacePath(base: string, child: string) {
  if (isSshWorkspaceUri(base)) {
    const location = parseWorkspaceLocation(base)
    if (location.kind === "ssh") return createSshWorkspaceUri(location.profileID, joinSshRemotePath(location.remotePath, child))
  }

  return path.join(base, child)
}

function isUncPath(targetPath: string) {
  return targetPath.startsWith("\\\\") || targetPath.startsWith("//")
}

function tryRealpath(targetPath: string): string | undefined {
  try {
    return Filesystem.normalizePath(realpathSync.native(targetPath))
  } catch {
    return undefined
  }
}

function resolveDeepestExistingPath(targetPath: string): string {
  const suffix: string[] = []
  let current = targetPath

  while (true) {
    const resolved = tryRealpath(current)
    if (resolved) {
      return Filesystem.normalizePath(
        suffix.length > 0 ? path.join(resolved, ...suffix) : resolved,
      )
    }

    const parent = path.dirname(current)
    if (parent === current) return Filesystem.normalizePath(targetPath)
    suffix.unshift(path.basename(current))
    current = parent
  }
}

export function resolveToolPath(inputPath: string): string {
  if (isRemoteWorkspace()) {
    const root = currentSshLocation()
    const target =
      isSshWorkspaceUri(inputPath)
        ? parseWorkspaceLocation(inputPath)
        : {
            kind: "ssh" as const,
            profileID: root.profileID,
            remotePath: inputPath.startsWith("/")
              ? normalizeSshRemotePath(inputPath)
              : joinSshRemotePath(root.remotePath, inputPath),
          }

    if (target.kind !== "ssh" || target.profileID !== root.profileID) {
      throw new Error(`Path is outside the active SSH profile: ${inputPath}`)
    }

    return createSshWorkspaceUri(root.profileID, target.remotePath)
  }

  if (isUncPath(inputPath)) {
    throw new Error(`UNC paths are not supported: ${inputPath}`)
  }

  const resolved = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(Instance.directory, inputPath)
  const normalized = Filesystem.normalizePath(resolved)

  const canonical = resolveDeepestExistingPath(normalized)
  const canonicalRoots = [
    resolveDeepestExistingPath(Instance.directory),
    resolveDeepestExistingPath(Instance.worktree),
  ]

  const insideCanonicalBoundary = canonicalRoots.some((root) =>
    Filesystem.contains(root, canonical)
  )
  const insideWorkspace = Instance.containsPath(normalized) && insideCanonicalBoundary
  const authorization = currentFilesystemAuthorization()

  if (authorization && !insideWorkspace) {
    const authorizedOutsidePath = authorization.allowOutsideWorkspace
      || authorization.paths.some((approvedPath) => {
        const canonicalApproved = resolveDeepestExistingPath(Filesystem.normalizePath(path.resolve(approvedPath)))
        return canonicalApproved === canonical
      })

    if (!authorizedOutsidePath) {
      throw new Error(`Path does not match the frozen filesystem authorization: ${inputPath}`)
    }
  }

  return normalized
}

export function resolveReadableTextFilePath(inputPath: string): string {
  if (isRemoteWorkspace()) return resolveToolPath(inputPath)

  if (!path.isAbsolute(inputPath)) {
    return resolveToolPath(inputPath)
  }

  if (isUncPath(inputPath)) {
    throw new Error(`UNC paths are not supported: ${inputPath}`)
  }

  return Filesystem.normalizePath(path.resolve(inputPath))
}

export function toDisplayPath(resolvedPath: string): string {
  if (isSshWorkspaceUri(resolvedPath)) {
    const root = currentSshLocation()
    const target = parseWorkspaceLocation(resolvedPath)
    if (target.kind !== "ssh" || target.profileID !== root.profileID) return resolvedPath
    return relativeSshRemotePath(root.remotePath, target.remotePath) ?? target.remotePath
  }

  const relative = path.relative(Instance.directory, resolvedPath)
  return relative ? relative : "."
}

export async function statResolvedPath(resolvedPath: string): Promise<WorkspacePathStat> {
  if (isSshWorkspaceUri(resolvedPath)) return toWorkspaceStat(await Ssh.stat(resolvedPath))
  return localStat(resolvedPath)
}

export async function listDirectoryEntries(resolvedPath: string): Promise<WorkspaceDirectoryEntry[]> {
  if (isSshWorkspaceUri(resolvedPath)) {
    return (await Ssh.listDirectory(resolvedPath))
      .filter((entry) => entry.type === "file" || entry.type === "directory")
      .map((entry) => ({
        name: entry.name,
        path: entry.uri,
        displayPath: toDisplayPath(entry.uri),
        kind: entry.type as ProjectEntryKind,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
      }))
  }

  const entries = await readdir(resolvedPath, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  const result: WorkspaceDirectoryEntry[] = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const kind = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : undefined
    if (!kind) continue
    const fullPath = path.join(resolvedPath, entry.name)
    const info = await localStat(fullPath).catch(() => undefined)
    result.push({
      name: entry.name,
      path: fullPath,
      displayPath: toDisplayPath(fullPath),
      kind,
      size: info?.size ?? 0,
      modifiedAt: info?.mtimeMs ?? 0,
    })
  }
  return result
}

export async function removeResolvedFile(resolvedPath: string) {
  if (isSshWorkspaceUri(resolvedPath)) {
    await Ssh.unlink(resolvedPath)
    return
  }

  await rm(resolvedPath, { force: true })
}

export function workspacePathBasename(resolvedPath: string) {
  return basenameForPath(resolvedPath)
}

export function workspacePathMatchesGlob(resolvedPath: string, pattern: string) {
  const candidate = isSshWorkspaceUri(resolvedPath) ? toDisplayPath(resolvedPath) : resolvedPath
  return path.matchesGlob(candidate, pattern)
}

export async function walkProjectEntries(
  root: string,
  options: {
    includeHidden?: boolean
    visit: (entry: ProjectEntry) => boolean | void | Promise<boolean | void>
  },
) {
  const info = await statResolvedPath(root)
  if (!info.isDirectory()) return

  let stopped = false

  const walk = async (current: string): Promise<void> => {
    if (stopped) return

    for (const item of await listDirectoryEntries(current)) {
      if (stopped) return
      if (!options.includeHidden && item.name.startsWith(".")) continue

      const fullPath = item.path
      const kind = item.kind

      if (!kind) continue
      if (kind === "directory" && DEFAULT_SKIPPED_DIRECTORY_NAMES.has(item.name)) continue

      const entry: ProjectEntry = {
        path: fullPath,
        relativePath: isSshWorkspaceUri(fullPath)
          ? (() => {
              const rootLocation = parseWorkspaceLocation(root)
              const targetLocation = parseWorkspaceLocation(fullPath)
              if (rootLocation.kind === "ssh" && targetLocation.kind === "ssh") {
                return relativeSshRemotePath(rootLocation.remotePath, targetLocation.remotePath) || item.name
              }
              return item.name
            })()
          : path.relative(root, fullPath) || item.name,
        displayPath: toDisplayPath(fullPath),
        kind,
      }

      if (await options.visit(entry) === false) {
        stopped = true
        return
      }

      if (kind === "directory") {
        await walk(fullPath)
      }
    }
  }

  await walk(root)
}

function formatTextFileAccessError(
  action: TextFileAction,
  resolvedPath: string,
  reason: string,
) {
  return `Cannot ${action} ${toDisplayPath(resolvedPath)} because ${reason}.`
}

function isBlockedDevicePath(resolvedPath: string): boolean {
  if (BLOCKED_DEVICE_PATHS.has(resolvedPath)) return true

  if (
    resolvedPath.startsWith("/proc/") &&
    (resolvedPath.endsWith("/fd/0") ||
      resolvedPath.endsWith("/fd/1") ||
      resolvedPath.endsWith("/fd/2"))
  ) {
    return true
  }

  return false
}

function isProbablyBinarySample(sample: Buffer): boolean {
  if (sample.length === 0) return false

  let suspicious = 0

  for (const byte of sample) {
    if (byte === 0) return true
    if ((byte < 7 || (byte > 14 && byte < 32) || byte === 127)) {
      suspicious += 1
    }
  }

  return suspicious / sample.length > 0.1
}

async function statIfExists(resolvedPath: string) {
  try {
    return await statResolvedPath(resolvedPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined
    }

    throw error
  }
}

async function assertTextFileContent(resolvedPath: string, action: TextFileAction) {
  const extension = extnameForPath(resolvedPath).toLowerCase()
  if (BINARY_EXTENSIONS.has(extension)) {
    throw new Error(formatTextFileAccessError(action, resolvedPath, "it appears to be a binary file"))
  }

  if (isSshWorkspaceUri(resolvedPath)) {
    const sample = (await Ssh.readFileBuffer(resolvedPath)).subarray(0, TEXT_SAMPLE_BYTES)
    if (isProbablyBinarySample(sample)) {
      throw new Error(formatTextFileAccessError(action, resolvedPath, "it appears to be a binary file"))
    }
    return
  }

  const file = await open(resolvedPath, "r")

  try {
    const sample = Buffer.alloc(TEXT_SAMPLE_BYTES)
    const { bytesRead } = await file.read(sample, 0, sample.length, 0)
    if (isProbablyBinarySample(sample.subarray(0, bytesRead))) {
      throw new Error(formatTextFileAccessError(action, resolvedPath, "it appears to be a binary file"))
    }
  } finally {
    await file.close()
  }
}

async function assertReadableTextFile(resolvedPath: string) {
  if (isBlockedDevicePath(resolvedPath)) {
    throw new Error(formatTextFileAccessError("read", resolvedPath, "it is a blocked device path"))
  }

  const info = await statResolvedPath(resolvedPath)

  if (info.isDirectory()) {
    throw new Error(formatTextFileAccessError("read", resolvedPath, "it is a directory"))
  }

  if (!info.isFile()) {
    throw new Error(formatTextFileAccessError("read", resolvedPath, "it is not a regular file"))
  }

  await assertTextFileContent(resolvedPath, "read")
}

export async function readTextFile(inputPath: string): Promise<string> {
  const resolved = resolveToolPath(inputPath)
  await assertReadableTextFile(resolved)
  if (isSshWorkspaceUri(resolved)) return await Ssh.readText(resolved)
  return await readFile(resolved, "utf8")
}

export async function readSearchableTextFile(resolvedPath: string): Promise<string | undefined> {
  try {
    await assertReadableTextFile(resolvedPath)
    if (isSshWorkspaceUri(resolvedPath)) return await Ssh.readText(resolvedPath)
    return await readFile(resolvedPath, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    const code = (error as NodeJS.ErrnoException | undefined)?.code

    if (
      code === "ENOENT" ||
      message.includes("binary file") ||
      message.includes("it is a directory") ||
      message.includes("it is not a regular file") ||
      message.includes("blocked device path")
    ) {
      return undefined
    }

    throw error
  }
}

export async function prepareWriteTextFile(inputPath: string): Promise<WriteTextFileTarget> {
  const resolved = resolveToolPath(inputPath)

  if (isBlockedDevicePath(resolved)) {
    throw new Error(formatTextFileAccessError("write", resolved, "it is a blocked device path"))
  }

  const info = await statIfExists(resolved)
  if (info?.isDirectory()) {
    throw new Error(formatTextFileAccessError("write", resolved, "it is a directory"))
  }

  if (info && !info.isFile()) {
    throw new Error(formatTextFileAccessError("write", resolved, "it is not a regular file"))
  }

  if (info) {
    await assertTextFileContent(resolved, "write")
  }

  return {
    path: resolved,
    displayPath: toDisplayPath(resolved),
    exists: info !== undefined,
  }
}

async function writeResolvedTextFile(resolvedPath: string, content: string) {
  if (isSshWorkspaceUri(resolvedPath)) {
    const tempPath = joinWorkspacePath(
      dirnameForPath(resolvedPath),
      `.${basenameForPath(resolvedPath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    await Ssh.writeText(tempPath, content)
    try {
      await Ssh.rename(tempPath, resolvedPath)
    } catch {
      await Ssh.writeText(resolvedPath, content)
      await Ssh.unlink(tempPath).catch(() => undefined)
    }
    return
  }

  await mkdir(path.dirname(resolvedPath), { recursive: true })

  const tempPath = path.join(
    path.dirname(resolvedPath),
    `.${path.basename(resolvedPath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )

  await writeFile(tempPath, content, "utf8")

  try {
    // Prefer replace-by-rename so a successful write does not leave a partially written file behind.
    await rename(tempPath, resolvedPath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "EEXIST" && code !== "EPERM") {
      throw error
    }

    await writeFile(resolvedPath, content, "utf8")
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

export async function writePreparedTextFile(
  target: WriteTextFileTarget,
  content: string,
): Promise<{ path: string; bytes: number; existed: boolean }> {
  await writeResolvedTextFile(target.path, content)
  return {
    path: target.path,
    bytes: Buffer.byteLength(content, "utf8"),
    existed: target.exists,
  }
}

export async function writeTextFile(
  inputPath: string,
  content: string,
): Promise<{ path: string; bytes: number; existed: boolean }> {
  const target = await prepareWriteTextFile(inputPath)
  return await writePreparedTextFile(target, content)
}

function splitTextLines(text: string) {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return normalized.split(/\r?\n/)
}

function createFormattedLineRange(
  selectedLines: string[],
  startLine: number,
  endLine: number,
  totalLines: number,
) {
  const width = String(Math.max(endLine, 1)).length
  const rendered = selectedLines
    .map((line, index) => {
      const number = String(startLine + index).padStart(width, " ")
      return `${number} | ${line}`
    })
    .join("\n")

  return {
    rendered,
    totalLines,
    startLine,
    endLine,
    outOfRange: startLine > totalLines,
  }
}

export function formatLineRange(text: string, startLine = 1, endLine?: number) {
  const lines = splitTextLines(text)
  const from = Math.max(1, startLine)
  const to = Math.min(endLine ?? lines.length, lines.length)
  return createFormattedLineRange(lines.slice(from - 1, to), from, to, lines.length)
}

export async function readTextFileRange(
  inputPath: string,
  startLine = 1,
  endLine?: number,
) {
  const resolved = resolveToolPath(inputPath)
  return await readResolvedTextFileRange(resolved, startLine, endLine)
}

export async function readResolvedTextFileRange(
  resolvedPath: string,
  startLine = 1,
  endLine?: number,
) {
  if (isSshWorkspaceUri(resolvedPath)) {
    await assertReadableTextFile(resolvedPath)
    return formatLineRange(await Ssh.readText(resolvedPath), startLine, endLine)
  }

  const resolved = Filesystem.normalizePath(path.resolve(resolvedPath))
  await assertReadableTextFile(resolved)

  const info = await localStat(resolved)
  if (info.size <= FAST_TEXT_READ_BYTES) {
    const text = await readFile(resolved, "utf8")
    return formatLineRange(text, startLine, endLine)
  }

  const from = Math.max(1, startLine)
  const to = endLine == null ? Number.POSITIVE_INFINITY : Math.max(from, endLine)

  return await new Promise<ReturnType<typeof formatLineRange>>((resolve, reject) => {
    const selectedLines: string[] = []
    let currentLine = 1
    let carry = ""
    let isFirstChunk = true
    const stream = createReadStream(resolved, { encoding: "utf8" })

    stream.on("data", (chunk: string) => {
      if (isFirstChunk) {
        isFirstChunk = false
        if (chunk.charCodeAt(0) === 0xfeff) {
          chunk = chunk.slice(1)
        }
      }

      const data = carry + chunk
      let start = 0

      while (true) {
        const newline = data.indexOf("\n", start)
        if (newline === -1) break

        let line = data.slice(start, newline)
        if (line.endsWith("\r")) line = line.slice(0, -1)
        if (currentLine >= from && currentLine <= to) {
          selectedLines.push(line)
        }

        currentLine += 1
        start = newline + 1
      }

      carry = data.slice(start)
    })

    stream.once("error", reject)
    stream.once("end", () => {
      let line = carry
      if (line.endsWith("\r")) line = line.slice(0, -1)
      if (currentLine >= from && currentLine <= to) {
        selectedLines.push(line)
      }

      const totalLines = currentLine
      const finalEndLine = Math.min(to, totalLines)
      resolve(createFormattedLineRange(selectedLines, from, finalEndLine, totalLines))
    })
  })
}
