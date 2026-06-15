import { open, readdir, readFile, realpath, stat } from "node:fs/promises"
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { TextDecoder } from "node:util"
import type {
  AgentWorkspaceDirectoryEntry,
  AgentWorkspaceFileDocument,
  AgentWorkspaceFileSearchResult,
} from "./types"
import {
  getLocalImageMimeType,
  getLocalVideoMimeType,
  LOCAL_IMAGE_MAX_BYTES,
  LOCAL_VIDEO_MAX_BYTES,
} from "./local-image-protocol"
import { toLocalImageProtocolUrl, toLocalVideoProtocolUrl } from "../shared/local-image-protocol"

const EXCLUDED_DIRECTORY_NAMES = new Set([".git", "node_modules", "dist", "build", "out"])
const HIDDEN_DIRECTORY_NAMES = new Set([".git"])
const TEXT_FILE_EXTENSIONS = new Set([
  "astro",
  "bat",
  "c",
  "cc",
  "cfg",
  "cjs",
  "cmd",
  "conf",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "htm",
  "html",
  "java",
  "js",
  "jsx",
  "json",
  "kt",
  "kts",
  "less",
  "log",
  "lua",
  "md",
  "mjs",
  "php",
  "ps1",
  "py",
  "rb",
  "rs",
  "sass",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
])
const SEARCH_RESULT_LIMIT = 200
const TEXT_DETECTION_SAMPLE_BYTES = 8192
const UNSUPPORTED_FILE_MESSAGE = "This file type is not supported in the Files panel yet."
const IMAGE_TOO_LARGE_MESSAGE = "This image is too large to preview in the Files panel."
const VIDEO_TOO_LARGE_MESSAGE = "This video is too large to preview in the Files panel."
const UTF8_TEXT_DECODER = new TextDecoder("utf-8", { fatal: true })

function getFileExtension(fileName: string) {
  const extension = extname(fileName).slice(1).toLowerCase()
  return extension.length > 0 ? extension : null
}

function toRelativeWorkspacePath(workspaceRoot: string, targetPath: string) {
  return relative(workspaceRoot, targetPath).split(sep).join("/")
}

function normalizeRelativeWorkspaceInputPath(input?: string | null) {
  const normalized = (input ?? "").trim().replace(/\\/g, "/").replace(/\/+/g, "/")
  if (!normalized || normalized === "." || normalized === "/") return ""
  return normalized.replace(/^\/+/, "").replace(/\/+$/, "")
}

function isPathInsideWorkspace(workspaceRoot: string, targetPath: string) {
  const relativePath = relative(workspaceRoot, targetPath)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function isLikelyTextBuffer(buffer: Buffer) {
  if (buffer.length === 0) return true
  if (buffer.includes(0)) return false

  try {
    UTF8_TEXT_DECODER.decode(buffer)
  } catch {
    return false
  }

  let disallowedControlBytes = 0
  for (const byte of buffer) {
    if (byte >= 32) continue
    if (byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 27) continue
    disallowedControlBytes += 1
  }

  return disallowedControlBytes / buffer.length <= 0.01
}

async function isLikelyTextFile(filePath: string, fileSize: number) {
  if (fileSize === 0) return true

  const sampleBytes = Math.min(fileSize, TEXT_DETECTION_SAMPLE_BYTES)
  const sampleBuffer = Buffer.alloc(sampleBytes)
  const fileHandle = await open(filePath, "r")
  try {
    const { bytesRead } = await fileHandle.read(sampleBuffer, 0, sampleBytes, 0)
    return isLikelyTextBuffer(sampleBuffer.subarray(0, bytesRead))
  } finally {
    await fileHandle.close()
  }
}

async function readDetectedTextFile(filePath: string) {
  const contentBuffer = await readFile(filePath)
  return isLikelyTextBuffer(contentBuffer) ? UTF8_TEXT_DECODER.decode(contentBuffer) : null
}

async function resolveWorkspaceRoot(directory: string) {
  const trimmedDirectory = directory.trim()
  if (!trimmedDirectory) {
    throw new Error("Workspace directory is required.")
  }

  const resolvedRoot = await realpath(trimmedDirectory)
  const workspaceStats = await stat(resolvedRoot)
  if (!workspaceStats.isDirectory()) {
    throw new Error("Workspace directory is not available.")
  }

  return resolvedRoot
}

async function collectWorkspaceFileMatches(
  workspaceRoot: string,
  currentDirectory: string,
  normalizedQuery: string,
  results: AgentWorkspaceFileSearchResult[],
) {
  if (results.length >= SEARCH_RESULT_LIMIT) return

  const entries = await readdir(currentDirectory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    if (results.length >= SEARCH_RESULT_LIMIT) return

    const entryPath = join(currentDirectory, entry.name)
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLowerCase())) {
        continue
      }

      await collectWorkspaceFileMatches(workspaceRoot, entryPath, normalizedQuery, results)
      continue
    }

    if (!entry.isFile()) continue
    if (!entry.name.toLowerCase().includes(normalizedQuery)) continue

    results.push({
      path: toRelativeWorkspacePath(workspaceRoot, entryPath),
      absolutePath: entryPath,
      name: entry.name,
      extension: getFileExtension(entry.name),
    })
  }
}

export async function searchWorkspaceFiles(
  directory: string,
  query: string,
): Promise<AgentWorkspaceFileSearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []

  const workspaceRoot = await resolveWorkspaceRoot(directory)
  const results: AgentWorkspaceFileSearchResult[] = []
  await collectWorkspaceFileMatches(workspaceRoot, workspaceRoot, normalizedQuery, results)
  return results
}

export async function listWorkspaceDirectory(
  directory: string,
  directoryPath?: string | null,
): Promise<AgentWorkspaceDirectoryEntry[]> {
  const workspaceRoot = await resolveWorkspaceRoot(directory)
  const normalizedDirectoryPath = normalizeRelativeWorkspaceInputPath(directoryPath)
  const candidatePath = resolve(workspaceRoot, normalizedDirectoryPath)
  if (!isPathInsideWorkspace(workspaceRoot, candidatePath)) {
    throw new Error("Workspace directory path must stay within the current project.")
  }

  const resolvedDirectoryPath = await realpath(candidatePath)
  if (!isPathInsideWorkspace(workspaceRoot, resolvedDirectoryPath)) {
    throw new Error("Workspace directory path must stay within the current project.")
  }

  const directoryStats = await stat(resolvedDirectoryPath)
  if (!directoryStats.isDirectory()) {
    throw new Error("Requested workspace path is not a directory.")
  }

  const entries = await readdir(resolvedDirectoryPath, { withFileTypes: true })
  const visibleEntries = entries.flatMap((entry): AgentWorkspaceDirectoryEntry[] => {
    if (entry.isDirectory()) {
      if (HIDDEN_DIRECTORY_NAMES.has(entry.name.toLowerCase())) return []
      const entryPath = join(resolvedDirectoryPath, entry.name)
      return [{
        path: toRelativeWorkspacePath(workspaceRoot, entryPath),
        name: entry.name,
        kind: "directory",
        extension: null,
        hasChildren: true,
      }]
    }

    if (!entry.isFile()) return []
    const entryPath = join(resolvedDirectoryPath, entry.name)
    return [{
      path: toRelativeWorkspacePath(workspaceRoot, entryPath),
      name: entry.name,
      kind: "file",
      extension: getFileExtension(entry.name),
      hasChildren: false,
    }]
  })

  visibleEntries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  })

  return visibleEntries
}

export async function readWorkspaceFile(
  directory: string,
  filePath: string,
): Promise<AgentWorkspaceFileDocument> {
  const workspaceRoot = await resolveWorkspaceRoot(directory)
  const trimmedFilePath = filePath.trim()
  if (!trimmedFilePath) {
    throw new Error("Workspace file path is required.")
  }

  const candidatePath = resolve(workspaceRoot, trimmedFilePath.replace(/\\/g, "/"))
  if (!isPathInsideWorkspace(workspaceRoot, candidatePath)) {
    throw new Error("Workspace file path must stay within the current project.")
  }

  const resolvedFilePath = await realpath(candidatePath)

  if (!isPathInsideWorkspace(workspaceRoot, resolvedFilePath)) {
    throw new Error("Workspace file path must stay within the current project.")
  }

  const fileStats = await stat(resolvedFilePath)
  if (!fileStats.isFile()) {
    throw new Error("Requested workspace path is not a file.")
  }

  const name = basename(resolvedFilePath)
  const extension = getFileExtension(name)
  const normalizedPath = toRelativeWorkspacePath(workspaceRoot, resolvedFilePath)
  const imageMimeType = getLocalImageMimeType(resolvedFilePath)
  if (imageMimeType) {
    const previewUrl = toLocalImageProtocolUrl(resolvedFilePath)
    if (fileStats.size > LOCAL_IMAGE_MAX_BYTES || !previewUrl) {
      return {
        path: normalizedPath,
        name,
        extension,
        kind: "unsupported",
        unsupportedReason: IMAGE_TOO_LARGE_MESSAGE,
      }
    }

    return {
      path: normalizedPath,
      name,
      extension,
      kind: "image",
      mimeType: imageMimeType,
      previewUrl,
      size: fileStats.size,
    }
  }

  const videoMimeType = getLocalVideoMimeType(resolvedFilePath)
  if (videoMimeType) {
    const previewUrl = toLocalVideoProtocolUrl(resolvedFilePath)
    if (fileStats.size > LOCAL_VIDEO_MAX_BYTES || !previewUrl) {
      return {
        path: normalizedPath,
        name,
        extension,
        kind: "unsupported",
        unsupportedReason: VIDEO_TOO_LARGE_MESSAGE,
      }
    }

    return {
      path: normalizedPath,
      name,
      extension,
      kind: "video",
      mimeType: videoMimeType,
      previewUrl,
      size: fileStats.size,
    }
  }

  const hasKnownTextExtension = extension ? TEXT_FILE_EXTENSIONS.has(extension) : false
  if (!hasKnownTextExtension && !(await isLikelyTextFile(resolvedFilePath, fileStats.size))) {
    return {
      path: normalizedPath,
      name,
      extension,
      kind: "unsupported",
      unsupportedReason: UNSUPPORTED_FILE_MESSAGE,
    }
  }

  const content = hasKnownTextExtension
    ? await readFile(resolvedFilePath, "utf8")
    : await readDetectedTextFile(resolvedFilePath)

  if (content === null) {
    return {
      path: normalizedPath,
      name,
      extension,
      kind: "unsupported",
      unsupportedReason: UNSUPPORTED_FILE_MESSAGE,
    }
  }

  return {
    path: normalizedPath,
    name,
    extension,
    kind: "text",
    content,
  }
}
