#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto"
import { existsSync, lstatSync, readdirSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { inflateRawSync } from "node:zlib"

const UPSTREAM_VERSION = "1.0.0"
const BUNDLE_NAME = `blender-${UPSTREAM_VERSION}.mcpb`
const BUNDLE_URL =
  `https://projects.blender.org/lab/blender_mcp/releases/download/v${UPSTREAM_VERSION}/${BUNDLE_NAME}`
const RELEASE_URL = `https://projects.blender.org/lab/blender_mcp/releases/tag/v${UPSTREAM_VERSION}`
const EXPECTED_BUNDLE_SHA256 = "93b070b1df82f57b1e7678b88b6bae28d06f105cd23ff6a4e0cc5f538bee2450"
const EXPECTED_BUNDLE_SIZE = 5_553_447
const EXPECTED_ENTRY_COUNT = 4_445
const EXPECTED_UNCOMPRESSED_SIZE = 15_797_990
const MAX_ENTRY_COUNT = 5_000
const MAX_UNCOMPRESSED_SIZE = 25 * 1024 * 1024
const PROVENANCE_FILENAME = ".anybox-upstream.json"

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP64_SENTINEL = 0xffffffff

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(scriptDirectory, "..")
const runtimeParent = join(pluginRoot, "runtime")
const runtimeRoot = join(runtimeParent, "blender-mcp")

const expectedToolModules = [
  "execute_blender_code",
  "get_blendfile_summary_datablocks",
  "get_blendfile_summary_missing_files",
  "get_blendfile_summary_of_linked_libraries",
  "get_blendfile_summary_path_info",
  "get_blendfile_summary_usage_guess",
  "get_object_detail_summary",
  "get_objects_summary",
  "get_python_api_docs",
  "get_screenshot_of_area_as_image",
  "get_screenshot_of_window_as_image",
  "get_screenshot_of_window_as_json",
  "jump_to_tab_by_name",
  "jump_to_tab_by_space_type",
  "jump_to_view3d_object_by_name",
  "jump_to_view3d_object_data_by_name",
  "render_thumbnail_to_path",
  "render_viewport_to_path",
  "search_api_docs",
  "search_manual_docs",
]

const expectedRegisteredTools = [
  ...expectedToolModules,
  "execute_blender_code_for_cli",
  "get_blendfile_summary_datablocks_for_cli",
  "get_blendfile_summary_missing_files_for_cli",
  "get_blendfile_summary_of_linked_libraries_for_cli",
  "get_blendfile_summary_path_info_for_cli",
  "get_blendfile_summary_usage_guess_for_cli",
].sort()

function fail(message) {
  throw new Error(`[blender-mcp-sync] ${message}`)
}

function argument(name) {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) fail(`${name} requires a value.`)
  return value
}

function normalizePath(value) {
  return value.replace(/\\/g, "/")
}

function isPathInside(parent, candidate) {
  const child = relative(resolve(parent), resolve(candidate))
  return Boolean(child) && !child.startsWith("..") && !isAbsolute(child)
}

function assertInside(parent, candidate, label) {
  if (!isPathInside(parent, candidate)) fail(`${label} must stay inside ${parent}.`)
  return resolve(candidate)
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function findEndOfCentralDirectory(archive) {
  const minimumLength = 22
  const maximumCommentLength = 0xffff
  if (archive.length < minimumLength) fail("Bundle is missing its ZIP central directory.")
  const start = Math.max(0, archive.length - minimumLength - maximumCommentLength)

  for (let offset = archive.length - minimumLength; offset >= start; offset -= 1) {
    if (archive.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset
  }
  fail("Bundle is missing its ZIP central directory.")
}

function assertSafeEntryPath(rawName) {
  const slashName = normalizePath(rawName)
  if (!slashName || slashName.includes("\0")) fail("Bundle contains an invalid path.")
  const trimmed = slashName.replace(/\/+$/g, "")
  if (!trimmed) return null
  if (trimmed.startsWith("/") || /^[A-Za-z]:($|\/)/.test(trimmed)) {
    fail(`Bundle contains an absolute path: ${rawName}`)
  }
  const segments = trimmed.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail(`Bundle contains an unsafe path: ${rawName}`)
  }
  return segments.join("/")
}

function readZipEntries(archive) {
  const eocdOffset = findEndOfCentralDirectory(archive)
  const diskNumber = archive.readUInt16LE(eocdOffset + 4)
  const centralDirectoryDisk = archive.readUInt16LE(eocdOffset + 6)
  const totalEntries = archive.readUInt16LE(eocdOffset + 10)
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12)
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16)

  if (diskNumber !== 0 || centralDirectoryDisk !== 0) fail("Split ZIP bundles are not supported.")
  if (
    totalEntries === 0xffff
    || centralDirectorySize === ZIP64_SENTINEL
    || centralDirectoryOffset === ZIP64_SENTINEL
  ) {
    fail("ZIP64 bundles are not supported.")
  }
  if (totalEntries > MAX_ENTRY_COUNT) fail(`Bundle contains more than ${MAX_ENTRY_COUNT} entries.`)
  if (centralDirectoryOffset + centralDirectorySize > archive.length) {
    fail("Bundle central directory is invalid.")
  }

  const entries = []
  const seenPaths = new Set()
  let offset = centralDirectoryOffset
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      fail("Bundle central directory is invalid.")
    }

    const flags = archive.readUInt16LE(offset + 8)
    const method = archive.readUInt16LE(offset + 10)
    const compressedSize = archive.readUInt32LE(offset + 20)
    const uncompressedSize = archive.readUInt32LE(offset + 24)
    const nameLength = archive.readUInt16LE(offset + 28)
    const extraLength = archive.readUInt16LE(offset + 30)
    const commentLength = archive.readUInt16LE(offset + 32)
    const externalAttributes = archive.readUInt32LE(offset + 38)
    const localHeaderOffset = archive.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const nextOffset = nameStart + nameLength + extraLength + commentLength

    if (
      compressedSize === ZIP64_SENTINEL
      || uncompressedSize === ZIP64_SENTINEL
      || localHeaderOffset === ZIP64_SENTINEL
    ) {
      fail("ZIP64 entries are not supported.")
    }
    if (nextOffset > archive.length) fail("Bundle central directory is invalid.")

    const rawName = archive.subarray(nameStart, nameStart + nameLength).toString("utf8")
    const normalizedName = assertSafeEntryPath(rawName)
    if (normalizedName) {
      if (seenPaths.has(normalizedName)) fail(`Bundle contains duplicate path: ${normalizedName}`)
      if (normalizedName === PROVENANCE_FILENAME) fail(`Bundle reserves ${PROVENANCE_FILENAME}.`)
      seenPaths.add(normalizedName)
    }

    const mode = (externalAttributes >>> 16) & 0xffff
    const isDirectory = rawName.endsWith("/") || rawName.endsWith("\\") || (mode & 0o170000) === 0o040000
    const isSymlink = (mode & 0o170000) === 0o120000
    if (isSymlink) fail(`Bundle contains a symbolic link: ${rawName}`)
    if ((flags & 0x1) !== 0) fail(`Bundle contains an encrypted entry: ${rawName}`)
    if (!isDirectory && method !== 0 && method !== 8) {
      fail(`Bundle uses unsupported compression method ${method}: ${rawName}`)
    }

    entries.push({
      rawName,
      normalizedName,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory,
    })
    offset = nextOffset
  }

  const uncompressedSize = entries.reduce((total, entry) => total + entry.uncompressedSize, 0)
  if (uncompressedSize > MAX_UNCOMPRESSED_SIZE) {
    fail(`Bundle expands beyond ${MAX_UNCOMPRESSED_SIZE} bytes.`)
  }
  return { entries, uncompressedSize }
}

function readEntryData(archive, entry) {
  if (entry.localHeaderOffset + 30 > archive.length) fail(`Invalid local header: ${entry.rawName}`)
  if (archive.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    fail(`Invalid local header signature: ${entry.rawName}`)
  }

  const nameLength = archive.readUInt16LE(entry.localHeaderOffset + 26)
  const extraLength = archive.readUInt16LE(entry.localHeaderOffset + 28)
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > archive.length) fail(`Invalid compressed data: ${entry.rawName}`)

  const compressed = archive.subarray(dataStart, dataEnd)
  let data
  if (entry.method === 0) {
    data = Buffer.from(compressed)
  } else {
    try {
      data = inflateRawSync(compressed, {
        maxOutputLength: Math.max(1, entry.uncompressedSize),
      })
    } catch (error) {
      fail(`Could not inflate ${entry.rawName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (data.byteLength !== entry.uncompressedSize) fail(`Expanded size mismatch: ${entry.rawName}`)
  return data
}

async function readBundle() {
  const sourcePath = argument("--source")
  if (sourcePath) {
    const absoluteSource = resolve(sourcePath)
    if (!existsSync(absoluteSource) || !lstatSync(absoluteSource).isFile()) {
      fail(`Bundle source is not a regular file: ${absoluteSource}`)
    }
    return readFile(absoluteSource)
  }

  const response = await fetch(BUNDLE_URL, {
    headers: { "user-agent": "Anybox-Blender-MCP-Sync/0.1.0" },
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) fail(`Bundle download failed with HTTP ${response.status}.`)
  return Buffer.from(await response.arrayBuffer())
}

function validateBundle(archive) {
  if (archive.length !== EXPECTED_BUNDLE_SIZE) {
    fail(`Bundle size mismatch: expected ${EXPECTED_BUNDLE_SIZE}, received ${archive.length}.`)
  }
  const digest = sha256(archive)
  if (digest !== EXPECTED_BUNDLE_SHA256) {
    fail(`Bundle SHA-256 mismatch: expected ${EXPECTED_BUNDLE_SHA256}, received ${digest}.`)
  }

  const parsed = readZipEntries(archive)
  if (parsed.entries.length !== EXPECTED_ENTRY_COUNT) {
    fail(`Bundle entry count mismatch: expected ${EXPECTED_ENTRY_COUNT}, received ${parsed.entries.length}.`)
  }
  if (parsed.uncompressedSize !== EXPECTED_UNCOMPRESSED_SIZE) {
    fail(
      `Bundle expanded size mismatch: expected ${EXPECTED_UNCOMPRESSED_SIZE}, received ${parsed.uncompressedSize}.`,
    )
  }
  return parsed.entries
}

async function extractBundle(archive, entries, destination) {
  const root = resolve(destination)
  for (const entry of entries) {
    if (!entry.normalizedName) continue
    const target = assertInside(root, join(root, entry.normalizedName), `Entry ${entry.normalizedName}`)
    if (entry.isDirectory) {
      await mkdir(target, { recursive: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, readEntryData(archive, entry), { flag: "wx" })
  }
}

function collectFiles(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolutePath = join(current, entry.name)
    const stat = lstatSync(absolutePath)
    if (stat.isSymbolicLink()) fail(`Extracted runtime contains a symbolic link: ${absolutePath}`)
    if (stat.isDirectory()) collectFiles(root, absolutePath, files)
    else if (stat.isFile()) files.push(normalizePath(relative(root, absolutePath)))
    else fail(`Extracted runtime contains a non-regular entry: ${absolutePath}`)
  }
  return files
}

async function validateRuntime(root, archive, entries, expectMarker) {
  const entryByPath = new Map(
    entries
      .filter((entry) => entry.normalizedName && !entry.isDirectory)
      .map((entry) => [entry.normalizedName, entry]),
  )
  const files = collectFiles(root)
  const expectedFileCount = entryByPath.size + (expectMarker ? 1 : 0)
  if (files.length !== expectedFileCount) {
    fail(`Runtime file count mismatch: expected ${expectedFileCount}, received ${files.length}.`)
  }

  for (const [relativePath, entry] of entryByPath) {
    const target = assertInside(root, join(root, relativePath), `Runtime file ${relativePath}`)
    if (!existsSync(target) || !lstatSync(target).isFile()) fail(`Runtime file is missing: ${relativePath}`)
    const actual = await readFile(target)
    const expected = readEntryData(archive, entry)
    if (!actual.equals(expected)) fail(`Runtime file differs from the official Bundle: ${relativePath}`)
  }

  const unexpected = files.filter((file) => !entryByPath.has(file) && file !== PROVENANCE_FILENAME)
  if (unexpected.length > 0) fail(`Runtime contains unexpected files: ${unexpected.slice(0, 5).join(", ")}`)

  const manifestPath = join(root, "manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  if (
    manifest.manifest_version !== "0.4"
    || manifest.version !== UPSTREAM_VERSION
    || manifest.server?.type !== "uv"
    || manifest.server?.mcp_config?.command !== "uv"
    || JSON.stringify(manifest.server?.mcp_config?.args) !== JSON.stringify(["run", "blender-mcp"])
  ) {
    fail("Official MCP Bundle manifest no longer matches the reviewed v1.0.0 contract.")
  }

  const actualTools = files
    .filter((file) => /^blmcp\/tools\/[^/]+\.py$/.test(file))
    .map((file) => file.slice("blmcp/tools/".length, -3))
    .filter((name) => name !== "__init__" && !name.startsWith("_template_") && !name.endsWith("_toolcode"))
    .sort()
  if (JSON.stringify(actualTools) !== JSON.stringify([...expectedToolModules].sort())) {
    fail(`Official MCP tool module inventory changed: ${actualTools.join(", ")}`)
  }

  const registeredTools = []
  for (const moduleName of actualTools) {
    const entry = entryByPath.get(`blmcp/tools/${moduleName}.py`)
    if (!entry) fail(`Official MCP tool module is missing: ${moduleName}`)
    const source = readEntryData(archive, entry).toString("utf8")
    for (const match of source.matchAll(/^    def ([a-z][a-z0-9_]*)\(/gm)) {
      registeredTools.push(match[1])
    }
  }
  registeredTools.sort()
  if (JSON.stringify(registeredTools) !== JSON.stringify(expectedRegisteredTools)) {
    fail(`Official registered MCP tool inventory changed: ${registeredTools.join(", ")}`)
  }

  if (expectMarker) {
    const marker = JSON.parse(await readFile(join(root, PROVENANCE_FILENAME), "utf8"))
    if (
      marker.upstreamVersion !== UPSTREAM_VERSION
      || marker.bundleSha256 !== EXPECTED_BUNDLE_SHA256
      || marker.entryCount !== EXPECTED_ENTRY_COUNT
      || marker.uncompressedSize !== EXPECTED_UNCOMPRESSED_SIZE
    ) {
      fail("Runtime provenance marker is invalid.")
    }
  }
}

function provenanceMarker() {
  return {
    schemaVersion: 1,
    upstreamProject: "https://projects.blender.org/lab/blender_mcp",
    upstreamVersion: UPSTREAM_VERSION,
    releaseURL: RELEASE_URL,
    bundleURL: BUNDLE_URL,
    bundleSha256: EXPECTED_BUNDLE_SHA256,
    bundleSize: EXPECTED_BUNDLE_SIZE,
    entryCount: EXPECTED_ENTRY_COUNT,
    uncompressedSize: EXPECTED_UNCOMPRESSED_SIZE,
  }
}

async function synchronize(archive, entries) {
  await mkdir(runtimeParent, { recursive: true })
  assertInside(pluginRoot, runtimeParent, "Runtime directory")
  assertInside(runtimeParent, runtimeRoot, "Blender runtime directory")

  const stagingRoot = await mkdtemp(join(runtimeParent, ".blender-mcp-sync-"))
  const backupRoot = assertInside(
    runtimeParent,
    join(runtimeParent, `.blender-mcp-backup-${randomUUID()}`),
    "Blender runtime backup",
  )
  let movedExisting = false
  let activated = false

  try {
    await extractBundle(archive, entries, stagingRoot)
    await writeFile(
      join(stagingRoot, PROVENANCE_FILENAME),
      `${JSON.stringify(provenanceMarker(), null, 2)}\n`,
      { flag: "wx" },
    )
    await validateRuntime(stagingRoot, archive, entries, true)

    if (existsSync(runtimeRoot)) {
      if (existsSync(backupRoot)) fail(`Refusing to replace existing backup: ${backupRoot}`)
      await rename(runtimeRoot, backupRoot)
      movedExisting = true
    }

    try {
      await rename(stagingRoot, runtimeRoot)
      activated = true
    } catch (error) {
      if (movedExisting && !existsSync(runtimeRoot) && existsSync(backupRoot)) {
        await rename(backupRoot, runtimeRoot)
        movedExisting = false
      }
      throw error
    }

    if (movedExisting) {
      await rm(backupRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      movedExisting = false
    }
  } finally {
    if (!activated && existsSync(stagingRoot)) {
      await rm(stagingRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  }
}

async function main() {
  const archive = await readBundle()
  const entries = validateBundle(archive)
  if (process.argv.includes("--check")) {
    if (!existsSync(runtimeRoot) || !lstatSync(runtimeRoot).isDirectory()) {
      fail(`Runtime directory does not exist: ${runtimeRoot}`)
    }
    await validateRuntime(runtimeRoot, archive, entries, true)
    console.log(`[blender-mcp-sync] verified ${EXPECTED_ENTRY_COUNT} official v${UPSTREAM_VERSION} entries.`)
    return
  }

  await synchronize(archive, entries)
  console.log(`[blender-mcp-sync] installed official v${UPSTREAM_VERSION} into ${relative(pluginRoot, runtimeRoot)}.`)
  console.log(`[blender-mcp-sync] SHA-256 ${EXPECTED_BUNDLE_SHA256}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
