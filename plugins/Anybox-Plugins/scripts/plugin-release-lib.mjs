import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path"
import { deflateRawSync } from "node:zlib"

export const PLUGIN_CATALOG_ID = "anybox-plugins"
export const PLUGIN_CATALOG_RELEASE_TAG = "anybox-plugin-catalog"
export const PLUGIN_RELEASE_REGISTRY_FILENAME = "anybox-plugin-registry.json"
export const PLUGIN_RELEASE_MANIFEST_FILENAME = "anybox-plugin-release-manifest.json"
export const MAX_PLUGIN_PACKAGE_BYTES = 100 * 1024 * 1024
export const CURRENT_PLUGIN_COUNT = 60

const PLUGIN_MANIFEST_PATH = ".anybox-plugin/plugin.json"
const RELEASE_OWNER = "fanfan-de"
const RELEASE_REPOSITORY = "anybox"
const COMMIT_PATTERN = /^[a-f0-9]{40}$/i
const SAFE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i
const DISPLAY_ASSET_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
])
const SECRET_FILE_PATTERN = /\.(?:key|p12|pem|pfx)$/i
const RELEASE_EXCLUDED_TOP_LEVEL_DIRECTORIES = new Set([
  "__fixtures__",
  "fixtures",
  "test",
  "tests",
])
const ZIP_UTF8_FLAG = 0x0800
const ZIP_METHOD_DEFLATE = 8
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP_DOS_TIME = 0
const ZIP_DOS_DATE = 0x21

function invariant(condition, message) {
  if (!condition) throw new Error(message)
}

function isPathInside(parent, candidate) {
  const child = relative(resolve(parent), resolve(candidate))
  return Boolean(child) && !child.startsWith("..") && !isAbsolute(child)
}

function assertSafeOutputDirectory(repoRoot, pluginsRoot, outputDirectory) {
  const output = resolve(outputDirectory)
  invariant(
    isPathInside(repoRoot, output) || isPathInside(tmpdir(), output),
    `Plugin release output must be inside ${repoRoot} or ${tmpdir()}.`,
  )
  invariant(output !== resolve(repoRoot), "Plugin release output must not replace the repository root.")
  invariant(output !== resolve(pluginsRoot), "Plugin release output must not replace the plugin source root.")
  invariant(output !== resolve(dirname(repoRoot)), "Plugin release output is too broad.")
  invariant(output !== resolve(sep), "Plugin release output must not be a filesystem root.")
  return output
}

function runGit(repoRoot, args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    windowsHide: true,
    ...options,
  })
}

function normalizeRepositoryPath(path) {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "")
}

function parseGitIndexEntries(repoRoot, pluginRepositoryPath) {
  const output = runGit(
    repoRoot,
    ["ls-files", "--stage", "-z", "--", pluginRepositoryPath],
  )
  const entries = []
  for (const record of output.toString("utf8").split("\0").filter(Boolean)) {
    const match = /^(\d+) [a-f0-9]+ \d+\t(.+)$/i.exec(record)
    invariant(match, `Could not parse git index entry: ${record}`)
    entries.push({
      mode: match[1],
      repositoryPath: normalizeRepositoryPath(match[2]),
    })
  }
  return entries
}

function assertCleanPluginSources(repoRoot) {
  const output = runGit(
    repoRoot,
    [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      "plugins/Anybox-Plugins",
    ],
    { encoding: "utf8" },
  ).trim()
  invariant(!output, "Plugin release sources must be committed before building a publishable release.")
}

function readJSON(filePath, label) {
  let value
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  return value
}

function assertRecord(value, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`)
  return value
}

function assertSafePackagePath(pluginRoot, reference, label) {
  invariant(typeof reference === "string" && reference.trim(), `${label} must be a package-relative path.`)
  const trimmed = reference.trim().replace(/\\/g, "/")
  invariant(!trimmed.includes("\0"), `${label} contains an invalid character.`)
  invariant(!isAbsolute(trimmed) && !trimmed.startsWith("/"), `${label} must be relative.`)
  invariant(!/^[a-z][a-z0-9+.-]*:/i.test(trimmed), `${label} must not be a URL.`)
  const target = resolve(pluginRoot, trimmed)
  const pathFromRoot = relative(resolve(pluginRoot), target)
  invariant(
    pathFromRoot && !pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot),
    `${label} must stay inside the plugin package.`,
  )
  invariant(existsSync(target), `${label} does not exist: ${trimmed}`)
  return {
    absolutePath: target,
    relativePath: normalizeRepositoryPath(pathFromRoot),
  }
}

function resolveComponentDeclaration(manifest, pluginRoot, field) {
  const declaration = manifest[field]
  if (typeof declaration !== "string") return
  const componentPath = assertSafePackagePath(pluginRoot, declaration, `Manifest field '${field}'`)
  const component = readJSON(componentPath.absolutePath, `Plugin component '${declaration}'`)
  const resolved = Array.isArray(component)
    ? component
    : assertRecord(component, `Plugin component '${declaration}'`)[field]
  invariant(Array.isArray(resolved), `Plugin component '${declaration}' must contain an '${field}' array.`)
  manifest[field] = resolved
}

function validateHooksDeclaration(manifest, pluginRoot) {
  if (typeof manifest.hooks === "string") {
    const hooksPath = assertSafePackagePath(pluginRoot, manifest.hooks, "Manifest field 'hooks'")
    readJSON(hooksPath.absolutePath, `Plugin hooks '${manifest.hooks}'`)
  }
  delete manifest.hooks
}

function extensionOf(reference) {
  const clean = reference.split(/[?#]/, 1)[0]?.toLowerCase() ?? ""
  const dot = clean.lastIndexOf(".")
  return dot >= 0 ? clean.slice(dot) : ""
}

function isResolvableDisplayAsset(reference) {
  const value = reference.trim()
  if (!value || /^(?:https?:\/\/|data:image\/)/i.test(value)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return false
  return (
    value.startsWith("./")
    || value.startsWith("../")
    || value.startsWith("/")
    || value.includes("/")
    || value.includes("\\")
    || DISPLAY_ASSET_EXTENSIONS.has(extensionOf(value))
  )
}

function encodeURLPath(path) {
  return normalizeRepositoryPath(path)
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function immutableSourceAssetURL(commit, pluginID, relativePath) {
  return `https://raw.githubusercontent.com/${RELEASE_OWNER}/${RELEASE_REPOSITORY}/${commit}/plugins/Anybox-Plugins/${encodeURIComponent(pluginID)}/${encodeURLPath(relativePath)}`
}

function resolveDisplayAsset(pluginRoot, pluginID, commit, value, label) {
  if (typeof value !== "string" || !isResolvableDisplayAsset(value)) return value
  const asset = assertSafePackagePath(pluginRoot, value, label)
  invariant(
    DISPLAY_ASSET_EXTENSIONS.has(extensionOf(asset.relativePath)),
    `${label} uses an unsupported display asset type.`,
  )
  const stat = lstatSync(asset.absolutePath)
  invariant(stat.isFile() && !stat.isSymbolicLink(), `${label} must reference a regular file.`)
  return immutableSourceAssetURL(commit, pluginID, asset.relativePath)
}

function resolveManifestDisplayAssets(manifest, pluginRoot, pluginID, commit) {
  if (!manifest.interface || typeof manifest.interface !== "object" || Array.isArray(manifest.interface)) return
  const fields = ["composerIcon", "logo", "iconUrl", "thumbnailUrl", "heroImageUrl"]
  for (const field of fields) {
    manifest.interface[field] = resolveDisplayAsset(
      pluginRoot,
      pluginID,
      commit,
      manifest.interface[field],
      `Manifest interface field '${field}'`,
    )
  }
  if (Array.isArray(manifest.interface.screenshots)) {
    manifest.interface.screenshots = manifest.interface.screenshots.map((value, index) =>
      resolveDisplayAsset(
        pluginRoot,
        pluginID,
        commit,
        value,
        `Manifest interface screenshot ${index + 1}`,
      ))
  }
}

function normalizedManifestDocument(raw, pluginRoot, pluginID, commit) {
  const manifest = structuredClone(assertRecord(raw, `Plugin '${pluginID}' manifest`))
  invariant(manifest.name === pluginID, `Plugin directory '${pluginID}' must match manifest name '${manifest.name ?? ""}'.`)
  invariant(typeof manifest.version === "string" && manifest.version.trim(), `Plugin '${pluginID}' has no version.`)
  invariant(SAFE_SEGMENT_PATTERN.test(manifest.version), `Plugin '${pluginID}' has an unsafe version '${manifest.version}'.`)
  invariant(typeof manifest.description === "string" && manifest.description.trim(), `Plugin '${pluginID}' has no description.`)
  invariant(manifest.package === undefined, `Plugin '${pluginID}' source manifest must not commit release package metadata.`)

  for (const field of ["apps", "connectors", "mcpServers"]) {
    resolveComponentDeclaration(manifest, pluginRoot, field)
  }
  validateHooksDeclaration(manifest, pluginRoot)
  resolveManifestDisplayAssets(manifest, pluginRoot, pluginID, commit)
  delete manifest.package
  manifest.id = pluginID
  return manifest
}

function canonicalManifestURL(pluginID) {
  return `https://raw.githubusercontent.com/${RELEASE_OWNER}/${RELEASE_REPOSITORY}/master/plugins/Anybox-Plugins/${pluginID}/${PLUGIN_MANIFEST_PATH}`
}

function assertIndexMatchesInventory(pluginsRoot, pluginIDs) {
  const index = readJSON(join(pluginsRoot, "index.json"), "Plugin development index")
  invariant(Array.isArray(index), "Plugin development index must be an array.")
  const expected = pluginIDs.map(canonicalManifestURL).sort()
  const actual = [...new Set(index)].sort()
  invariant(index.length === actual.length, "Plugin development index contains duplicate entries.")
  invariant(
    JSON.stringify(actual) === JSON.stringify(expected),
    "Plugin development index does not exactly match the canonical plugin inventory.",
  )
}

function discoverPluginPackages(pluginsRoot, expectedPluginCount) {
  const directories = readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name))
  const packages = []
  const compatibilityOnly = []

  for (const directory of directories) {
    const pluginRoot = join(pluginsRoot, directory.name)
    const canonicalManifest = join(pluginRoot, PLUGIN_MANIFEST_PATH)
    const rootManifest = join(pluginRoot, "plugin.json")
    if (!existsSync(canonicalManifest)) {
      if (existsSync(rootManifest)) compatibilityOnly.push(directory.name)
      continue
    }
    invariant(SAFE_SEGMENT_PATTERN.test(directory.name), `Plugin directory '${directory.name}' is not a safe package ID.`)
    packages.push({
      id: directory.name,
      root: pluginRoot,
      manifestPath: canonicalManifest,
    })
  }

  invariant(
    compatibilityOnly.length === 0,
    `Release plugins must use ${PLUGIN_MANIFEST_PATH}; migrate: ${compatibilityOnly.join(", ")}`,
  )
  invariant(
    packages.length === expectedPluginCount,
    `Expected ${expectedPluginCount} canonical plugins, found ${packages.length}.`,
  )
  return packages
}

function isSensitivePackagePath(repositoryPath) {
  const name = basename(repositoryPath).toLowerCase()
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return true
  return SECRET_FILE_PATTERN.test(name)
}

function collectPluginFiles(repoRoot, plugin, allowDirty) {
  const pluginRepositoryPath = normalizeRepositoryPath(relative(repoRoot, plugin.root))
  const byPath = new Map()
  for (const entry of parseGitIndexEntries(repoRoot, pluginRepositoryPath)) {
    const pathFromPluginRoot = normalizeRepositoryPath(
      entry.repositoryPath.slice(pluginRepositoryPath.length).replace(/^\/+/, ""),
    )
    if (RELEASE_EXCLUDED_TOP_LEVEL_DIRECTORIES.has(pathFromPluginRoot.split("/")[0]?.toLowerCase())) {
      continue
    }
    const absolutePath = resolve(repoRoot, entry.repositoryPath)
    if (!existsSync(absolutePath)) continue
    byPath.set(entry.repositoryPath, entry)
  }

  const manifestRepositoryPath = normalizeRepositoryPath(relative(repoRoot, plugin.manifestPath))
  if (!byPath.has(manifestRepositoryPath)) {
    invariant(
      allowDirty,
      `Plugin '${plugin.id}' manifest is not tracked by git: ${manifestRepositoryPath}.`,
    )
    byPath.set(manifestRepositoryPath, {
      mode: "100644",
      repositoryPath: manifestRepositoryPath,
    })
  }

  const files = [...byPath.values()].sort((left, right) =>
    left.repositoryPath.localeCompare(right.repositoryPath))
  invariant(files.length > 0, `Plugin '${plugin.id}' has no tracked files.`)
  invariant(
    files.some((entry) => entry.repositoryPath === manifestRepositoryPath),
    `Plugin '${plugin.id}' package is missing ${PLUGIN_MANIFEST_PATH}.`,
  )
  const manifestFiles = files.filter((entry) => basename(entry.repositoryPath).toLowerCase() === "plugin.json")
  invariant(
    manifestFiles.length === 1 && manifestFiles[0].repositoryPath === manifestRepositoryPath,
    `Plugin '${plugin.id}' must contain exactly one canonical plugin.json manifest.`,
  )

  return files.map((entry) => {
    invariant(entry.mode === "100644" || entry.mode === "100755", `Plugin '${plugin.id}' contains unsupported git mode ${entry.mode}: ${entry.repositoryPath}`)
    invariant(!isSensitivePackagePath(entry.repositoryPath), `Plugin '${plugin.id}' contains a sensitive file: ${entry.repositoryPath}`)
    const absolutePath = resolve(repoRoot, entry.repositoryPath)
    const pathFromRoot = relative(plugin.root, absolutePath)
    invariant(
      pathFromRoot && !pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot),
      `Plugin '${plugin.id}' contains a file outside its package root.`,
    )
    const stat = lstatSync(absolutePath)
    invariant(stat.isFile() && !stat.isSymbolicLink(), `Plugin '${plugin.id}' contains a non-regular file: ${entry.repositoryPath}`)
    return {
      absolutePath,
      archivePath: `${plugin.id}/${normalizeRepositoryPath(pathFromRoot)}`,
      mode: entry.mode === "100755" ? 0o100755 : 0o100644,
    }
  })
}

function crc32Table() {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

const CRC32_TABLE = crc32Table()

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

export async function createDeterministicZip(files) {
  invariant(files.length > 0, "Plugin ZIP must contain at least one file.")
  invariant(files.length <= 0xffff, "Plugin ZIP contains too many files.")
  const chunks = []
  const centralDirectoryChunks = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.archivePath, "utf8")
    const data = await readFile(file.absolutePath)
    invariant(data.length <= 0xffffffff, `Plugin ZIP file is too large: ${file.archivePath}`)
    const compressed = deflateRawSync(data, { level: 9 })
    const checksum = crc32(data)

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6)
    localHeader.writeUInt16LE(ZIP_METHOD_DEFLATE, 8)
    localHeader.writeUInt16LE(ZIP_DOS_TIME, 10)
    localHeader.writeUInt16LE(ZIP_DOS_DATE, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(name.length, 26)
    localHeader.writeUInt16LE(0, 28)
    chunks.push(localHeader, name, compressed)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8)
    centralHeader.writeUInt16LE(ZIP_METHOD_DEFLATE, 10)
    centralHeader.writeUInt16LE(ZIP_DOS_TIME, 12)
    centralHeader.writeUInt16LE(ZIP_DOS_DATE, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(name.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE((file.mode << 16) >>> 0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralDirectoryChunks.push(centralHeader, name)

    offset += localHeader.length + name.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centralDirectoryChunks)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, centralDirectory, end])
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function releaseAssetName(pluginID, pluginVersion) {
  return `anybox-plugin-${pluginID}-${pluginVersion}.zip`
}

function releaseAssetURL(releaseTag, assetName) {
  return `https://github.com/${RELEASE_OWNER}/${RELEASE_REPOSITORY}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`
}

function validateReleaseRegistryShape(registry, expectedPluginCount) {
  invariant(registry.schemaVersion === 3, "Plugin catalog registry schemaVersion must be 3.")
  invariant(registry.catalogID === PLUGIN_CATALOG_ID, "Plugin catalog registry ID is invalid.")
  invariant(registry.pluginCount === expectedPluginCount, "Plugin release registry count does not match the release inventory.")
  invariant(Array.isArray(registry.plugins) && registry.plugins.length === expectedPluginCount, "Plugin release registry is incomplete.")
  const ids = new Set()
  for (const plugin of registry.plugins) {
    invariant(typeof plugin.id === "string" && plugin.id === plugin.name, "Plugin release registry IDs must match manifest names.")
    invariant(!ids.has(plugin.id), `Plugin release registry contains duplicate ID '${plugin.id}'.`)
    ids.add(plugin.id)
    invariant(plugin.package?.type === "zip", `Plugin '${plugin.id}' must use a ZIP release package.`)
    const assetName = releaseAssetName(plugin.id, plugin.version)
    invariant(
      plugin.package.url === releaseAssetURL(PLUGIN_CATALOG_RELEASE_TAG, assetName),
      `Plugin '${plugin.id}' has an invalid Release URL.`,
    )
    invariant(/^[a-f0-9]{64}$/.test(plugin.package.sha256), `Plugin '${plugin.id}' has an invalid package checksum.`)
    invariant(
      Number.isSafeInteger(plugin.package.size)
      && plugin.package.size > 0
      && plugin.package.size <= MAX_PLUGIN_PACKAGE_BYTES,
      `Plugin '${plugin.id}' has an invalid package size.`,
    )
  }
}

async function fileDigest(filePath) {
  return sha256(await readFile(filePath))
}

export async function verifyPluginRelease({
  outputDirectory,
  sourceCommit,
  expectedPluginCount = CURRENT_PLUGIN_COUNT,
}) {
  const resolvedOutput = resolve(outputDirectory)
  const releaseManifestPath = join(resolvedOutput, PLUGIN_RELEASE_MANIFEST_FILENAME)
  const registryPath = join(resolvedOutput, PLUGIN_RELEASE_REGISTRY_FILENAME)
  const releaseManifest = readJSON(releaseManifestPath, "Plugin release manifest")
  const registryBytes = await readFile(registryPath)
  const registry = JSON.parse(registryBytes.toString("utf8"))
  const expectedCommit = sourceCommit.toLowerCase()

  invariant(releaseManifest.schemaVersion === 2, "Plugin release manifest schemaVersion must be 2.")
  invariant(releaseManifest.catalogID === PLUGIN_CATALOG_ID, "Plugin release manifest catalog ID is invalid.")
  invariant(releaseManifest.releaseTag === PLUGIN_CATALOG_RELEASE_TAG, "Plugin release manifest tag does not match the catalog channel.")
  invariant(releaseManifest.sourceCommit === expectedCommit, "Plugin release manifest source commit does not match.")
  invariant(releaseManifest.pluginCount === expectedPluginCount, "Plugin release manifest count does not match.")
  invariant(Array.isArray(releaseManifest.assets) && releaseManifest.assets.length === expectedPluginCount, "Plugin release asset list is incomplete.")
  invariant(releaseManifest.registry?.name === PLUGIN_RELEASE_REGISTRY_FILENAME, "Plugin release registry filename is invalid.")
  invariant(releaseManifest.registry.size === registryBytes.length, "Plugin release registry size does not match.")
  invariant(releaseManifest.registry.sha256 === sha256(registryBytes), "Plugin release registry checksum does not match.")

  invariant(registry.catalogID === PLUGIN_CATALOG_ID, "Plugin release registry catalog ID is invalid.")
  invariant(registry.sourceCommit === expectedCommit, "Plugin release registry source commit does not match.")
  validateReleaseRegistryShape(registry, expectedPluginCount)

  const registryByID = new Map(registry.plugins.map((plugin) => [plugin.id, plugin]))
  const seenAssetNames = new Set()
  const seenPluginIDs = new Set()
  for (const asset of releaseManifest.assets) {
    invariant(typeof asset.pluginID === "string" && registryByID.has(asset.pluginID), `Unknown plugin release asset '${asset.pluginID ?? ""}'.`)
    invariant(!seenPluginIDs.has(asset.pluginID), `Duplicate plugin release asset for '${asset.pluginID}'.`)
    invariant(!seenAssetNames.has(asset.name), `Duplicate plugin release filename '${asset.name}'.`)
    seenPluginIDs.add(asset.pluginID)
    seenAssetNames.add(asset.name)

    const plugin = registryByID.get(asset.pluginID)
    const expectedName = releaseAssetName(asset.pluginID, plugin.version)
    invariant(asset.pluginVersion === plugin.version, `Plugin '${asset.pluginID}' asset version does not match.`)
    invariant(asset.name === expectedName, `Plugin '${asset.pluginID}' asset filename does not match.`)
    invariant(asset.sha256 === plugin.package.sha256, `Plugin '${asset.pluginID}' asset checksum differs from the registry.`)
    invariant(asset.size === plugin.package.size, `Plugin '${asset.pluginID}' asset size differs from the registry.`)

    const assetPath = join(resolvedOutput, asset.name)
    const stat = lstatSync(assetPath)
    invariant(stat.isFile() && !stat.isSymbolicLink(), `Plugin release asset is not a regular file: ${asset.name}`)
    invariant(stat.size === asset.size, `Plugin release asset size mismatch: ${asset.name}`)
    invariant(await fileDigest(assetPath) === asset.sha256, `Plugin release asset checksum mismatch: ${asset.name}`)
  }

  const expectedFiles = new Set([
    PLUGIN_RELEASE_MANIFEST_FILENAME,
    PLUGIN_RELEASE_REGISTRY_FILENAME,
    ...seenAssetNames,
  ])
  const actualFiles = readdirSync(resolvedOutput, { withFileTypes: true })
  invariant(
    actualFiles.every((entry) => entry.isFile() && expectedFiles.has(entry.name))
    && actualFiles.length === expectedFiles.size,
    "Plugin release directory contains missing or unexpected files.",
  )

  return { registry, releaseManifest }
}

export async function buildPluginRelease({
  repoRoot,
  pluginsRoot = join(repoRoot, "plugins", "Anybox-Plugins"),
  outputDirectory,
  sourceCommit,
  expectedPluginCount = CURRENT_PLUGIN_COUNT,
  allowDirty = false,
  maxPluginPackageBytes = MAX_PLUGIN_PACKAGE_BYTES,
}) {
  const resolvedRepoRoot = resolve(repoRoot)
  const resolvedPluginsRoot = resolve(pluginsRoot)
  const resolvedOutput = assertSafeOutputDirectory(resolvedRepoRoot, resolvedPluginsRoot, outputDirectory)
  invariant(COMMIT_PATTERN.test(sourceCommit), "Plugin release source commit must be a 40-character Git SHA.")
  invariant(Number.isSafeInteger(expectedPluginCount) && expectedPluginCount > 0, "Expected plugin count must be positive.")
  invariant(Number.isSafeInteger(maxPluginPackageBytes) && maxPluginPackageBytes > 0, "Plugin package byte limit must be positive.")
  if (!allowDirty) assertCleanPluginSources(resolvedRepoRoot)

  const sourceCommitLower = sourceCommit.toLowerCase()
  const releaseTag = PLUGIN_CATALOG_RELEASE_TAG
  const packages = discoverPluginPackages(resolvedPluginsRoot, expectedPluginCount)
  const pluginIDs = packages.map((plugin) => plugin.id)
  assertIndexMatchesInventory(resolvedPluginsRoot, pluginIDs)

  const stagingDirectory = `${resolvedOutput}.staging-${process.pid}`
  await rm(stagingDirectory, { recursive: true, force: true })
  await mkdir(stagingDirectory, { recursive: true })

  try {
    const registryPlugins = []
    const assets = []
    for (const plugin of packages) {
      const sourceManifest = readJSON(plugin.manifestPath, `Plugin '${plugin.id}' manifest`)
      const registryManifest = normalizedManifestDocument(
        sourceManifest,
        plugin.root,
        plugin.id,
        sourceCommitLower,
      )
      const files = collectPluginFiles(resolvedRepoRoot, plugin, allowDirty)
      const zipBytes = await createDeterministicZip(files)
      invariant(
        zipBytes.length <= maxPluginPackageBytes,
        `Plugin '${plugin.id}' ZIP is ${zipBytes.length} bytes; the limit is ${maxPluginPackageBytes}.`,
      )
      const assetName = releaseAssetName(plugin.id, registryManifest.version)
      const asset = {
        pluginID: plugin.id,
        pluginVersion: registryManifest.version,
        name: assetName,
        sha256: sha256(zipBytes),
        size: zipBytes.length,
      }
      await writeFile(join(stagingDirectory, assetName), zipBytes)
      assets.push(asset)
      registryPlugins.push({
        ...registryManifest,
        package: {
          type: "zip",
          url: releaseAssetURL(releaseTag, assetName),
          sha256: asset.sha256,
          size: asset.size,
        },
      })
    }

    const registry = {
      schemaVersion: 3,
      catalogID: PLUGIN_CATALOG_ID,
      sourceCommit: sourceCommitLower,
      pluginCount: registryPlugins.length,
      plugins: registryPlugins,
    }
    validateReleaseRegistryShape(registry, expectedPluginCount)
    const registryBytes = Buffer.from(`${JSON.stringify(registry, null, 2)}\n`)
    await writeFile(join(stagingDirectory, PLUGIN_RELEASE_REGISTRY_FILENAME), registryBytes)

    const releaseManifest = {
      schemaVersion: 2,
      catalogID: PLUGIN_CATALOG_ID,
      releaseTag,
      sourceCommit: sourceCommitLower,
      pluginCount: assets.length,
      registry: {
        name: PLUGIN_RELEASE_REGISTRY_FILENAME,
        sha256: sha256(registryBytes),
        size: registryBytes.length,
      },
      assets,
    }
    await writeFile(
      join(stagingDirectory, PLUGIN_RELEASE_MANIFEST_FILENAME),
      `${JSON.stringify(releaseManifest, null, 2)}\n`,
    )

    await rm(resolvedOutput, { recursive: true, force: true })
    await mkdir(dirname(resolvedOutput), { recursive: true })
    await rename(stagingDirectory, resolvedOutput)
    return {
      outputDirectory: resolvedOutput,
      registry,
      releaseManifest,
    }
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true })
    throw error
  }
}
