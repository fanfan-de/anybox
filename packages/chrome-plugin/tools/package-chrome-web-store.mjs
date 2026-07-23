import { createHash } from "node:crypto"
import fsp from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { deflateRawSync } from "node:zlib"
import {
  buildChromeExtension,
  defaultProjectRoot,
} from "./package-chrome-plugin.mjs"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, "..", "..", "..")

export const defaultExtensionDistRoot = path.join(
  defaultProjectRoot,
  "browser-extension",
  "dist",
)
export const defaultStoreIconRoot = path.join(
  defaultProjectRoot,
  "browser-extension",
  "web-store",
  "icons",
)
export const defaultArtifactsRoot = path.join(defaultProjectRoot, "artifacts")

const WEB_STORE_ICON_SIZES = Object.freeze([16, 48, 128])
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ZIP_UTF8_FLAG = 0x0800
const ZIP_VERSION = 20
const ZIP_DOS_DATE_1980_01_01 = 0x21

function toPosixPath(value) {
  return value.split(path.sep).join("/")
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

async function pathExists(target) {
  try {
    await fsp.access(target)
    return true
  } catch {
    return false
  }
}

async function listFiles(root) {
  const files = []

  async function visit(current, relativeRoot = "") {
    const entries = await fsp.readdir(current, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"))

    for (const entry of entries) {
      const relativePath = path.join(relativeRoot, entry.name)
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Chrome Web Store packages must not contain symbolic links: ${relativePath}`,
        )
      }

      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(
          `Chrome Web Store package contains an unsupported entry: ${relativePath}`,
        )
      }
      files.push(relativePath)
    }
  }

  await visit(root)
  return files
}

async function copyFile(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  await fsp.copyFile(source, destination)
}

function packagePath(root, relativePath) {
  if (
    typeof relativePath !== "string"
    || !relativePath
    || path.posix.isAbsolute(relativePath)
  ) {
    throw new Error(`Chrome extension icon path must be package-relative: ${relativePath}`)
  }

  const normalized = path.posix.normalize(relativePath)
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Chrome extension icon path escapes the package: ${relativePath}`)
  }
  return path.join(root, ...normalized.split("/"))
}

async function readPngDimensions(filePath) {
  const bytes = await fsp.readFile(filePath)
  if (
    bytes.byteLength < 24
    || !bytes.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)
    || bytes.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error(`Chrome Web Store icon is not a valid PNG: ${filePath}`)
  }
  return {
    height: bytes.readUInt32BE(20),
    width: bytes.readUInt32BE(16),
  }
}

async function readManifest(packageRoot) {
  const manifestPath = path.join(packageRoot, "manifest.json")
  let manifest
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"))
  } catch (error) {
    throw new Error(
      `Chrome Web Store manifest is missing or invalid: ${manifestPath}`,
      { cause: error },
    )
  }

  if (
    manifest?.manifest_version !== 3
    || typeof manifest?.version !== "string"
    || !manifest.version
  ) {
    throw new Error(
      "Chrome Web Store package must contain a versioned Manifest V3 manifest at its root.",
    )
  }
  return manifest
}

export async function validateChromeWebStorePackage(
  packageRoot,
  {
    internalExtensionRoot,
    storeIconRoot = defaultStoreIconRoot,
  } = {},
) {
  if (!(await pathExists(packageRoot))) {
    throw new Error(`Chrome Web Store package does not exist: ${packageRoot}`)
  }

  const files = await listFiles(packageRoot)
  const normalizedFiles = files.map(toPosixPath)
  if (!normalizedFiles.includes("manifest.json")) {
    throw new Error("Chrome Web Store ZIP must contain manifest.json at its root.")
  }
  const sourceMaps = normalizedFiles.filter((entry) => entry.endsWith(".map"))
  if (sourceMaps.length > 0) {
    throw new Error(
      `Chrome Web Store package must not contain source maps: ${sourceMaps.join(", ")}`,
    )
  }

  const manifest = await readManifest(packageRoot)
  const icons = []
  for (const size of WEB_STORE_ICON_SIZES) {
    const relativePath = manifest.icons?.[String(size)]
    if (typeof relativePath !== "string" || !relativePath) {
      throw new Error(`Chrome Web Store manifest must declare a ${size}px icon.`)
    }

    const packagedIconPath = packagePath(packageRoot, relativePath)
    const storeIconPath = path.join(storeIconRoot, `icon${size}.png`)
    if (!(await pathExists(storeIconPath))) {
      throw new Error(`Anybox Web Store icon source is missing: ${storeIconPath}`)
    }
    if (!(await pathExists(packagedIconPath))) {
      throw new Error(`Chrome Web Store package is missing icon: ${relativePath}`)
    }

    const storeDimensions = await readPngDimensions(storeIconPath)
    const packagedDimensions = await readPngDimensions(packagedIconPath)
    for (const [label, dimensions] of [
      ["source", storeDimensions],
      ["packaged", packagedDimensions],
    ]) {
      if (dimensions.width !== size || dimensions.height !== size) {
        throw new Error(
          `Anybox Web Store ${label} icon must be ${size}x${size}, got `
          + `${dimensions.width}x${dimensions.height}: ${relativePath}`,
        )
      }
    }

    const storeBytes = await fsp.readFile(storeIconPath)
    const packagedBytes = await fsp.readFile(packagedIconPath)
    const storeHash = sha256(storeBytes)
    const packagedHash = sha256(packagedBytes)
    if (packagedHash !== storeHash) {
      throw new Error(
        `Chrome Web Store package did not use the Anybox box-cat icon: ${relativePath}`,
      )
    }

    let internalHash
    if (internalExtensionRoot) {
      const internalIconPath = packagePath(internalExtensionRoot, relativePath)
      if (!(await pathExists(internalIconPath))) {
        throw new Error(`Internal Chrome extension icon is missing: ${internalIconPath}`)
      }
      internalHash = sha256(await fsp.readFile(internalIconPath))
      if (internalHash === packagedHash) {
        throw new Error(
          `Chrome Web Store icon must differ from the internal Chrome-branded icon: ${relativePath}`,
        )
      }
    }

    icons.push({
      internalSha256: internalHash,
      packagedSha256: packagedHash,
      path: relativePath,
      size,
    })
  }

  return {
    files,
    icons,
    manifest,
    version: manifest.version,
  }
}

export async function stageChromeWebStorePackage({
  extensionDistRoot = defaultExtensionDistRoot,
  packageRoot,
  storeIconRoot = defaultStoreIconRoot,
}) {
  if (!packageRoot) {
    throw new Error("Chrome Web Store staging directory is required.")
  }
  if (!(await pathExists(path.join(extensionDistRoot, "manifest.json")))) {
    throw new Error(
      `Chrome extension build output is missing at ${extensionDistRoot}. Run the extension build first.`,
    )
  }

  await fsp.rm(packageRoot, { recursive: true, force: true })
  await fsp.mkdir(packageRoot, { recursive: true })

  for (const relativePath of await listFiles(extensionDistRoot)) {
    const normalized = toPosixPath(relativePath)
    if (
      normalized.endsWith(".map")
      || path.posix.basename(normalized) === ".DS_Store"
    ) {
      continue
    }
    await copyFile(
      path.join(extensionDistRoot, relativePath),
      path.join(packageRoot, relativePath),
    )
  }

  const manifest = await readManifest(packageRoot)
  for (const size of WEB_STORE_ICON_SIZES) {
    const relativePath = manifest.icons?.[String(size)]
    if (typeof relativePath !== "string" || !relativePath) {
      throw new Error(`Chrome Web Store manifest must declare a ${size}px icon.`)
    }
    await copyFile(
      path.join(storeIconRoot, `icon${size}.png`),
      packagePath(packageRoot, relativePath),
    )
  }

  return validateChromeWebStorePackage(packageRoot, {
    internalExtensionRoot: extensionDistRoot,
    storeIconRoot,
  })
}

function buildCrc32Table() {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

const CRC32_TABLE = buildCrc32Table()

function crc32(buffer) {
  let value = 0xffffffff
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

export async function writeDeterministicZipFile(rootDirectory, zipPath) {
  const files = (await listFiles(rootDirectory))
    .map((relativePath) => ({
      absolutePath: path.join(rootDirectory, relativePath),
      zipPath: toPosixPath(relativePath),
    }))
    .sort((left, right) => left.zipPath.localeCompare(right.zipPath, "en"))

  const chunks = []
  const centralDirectory = []
  let offset = 0

  function append(buffer) {
    chunks.push(buffer)
    offset += buffer.byteLength
  }

  for (const file of files) {
    const content = await fsp.readFile(file.absolutePath)
    const compressed = deflateRawSync(content, { level: 9 })
    const payload = compressed.byteLength < content.byteLength ? compressed : content
    const method = payload === compressed ? 8 : 0
    const name = Buffer.from(file.zipPath, "utf8")
    const checksum = crc32(content)
    const localOffset = offset

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(ZIP_VERSION, 4)
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(ZIP_DOS_DATE_1980_01_01, 12)
    localHeader.writeUInt32LE(checksum, 14)
    localHeader.writeUInt32LE(payload.byteLength, 18)
    localHeader.writeUInt32LE(content.byteLength, 22)
    localHeader.writeUInt16LE(name.byteLength, 26)
    localHeader.writeUInt16LE(0, 28)
    append(localHeader)
    append(name)
    append(payload)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(ZIP_VERSION, 4)
    centralHeader.writeUInt16LE(ZIP_VERSION, 6)
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(ZIP_DOS_DATE_1980_01_01, 14)
    centralHeader.writeUInt32LE(checksum, 16)
    centralHeader.writeUInt32LE(payload.byteLength, 20)
    centralHeader.writeUInt32LE(content.byteLength, 24)
    centralHeader.writeUInt16LE(name.byteLength, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(localOffset, 42)
    centralDirectory.push(Buffer.concat([centralHeader, name]))
  }

  const centralDirectoryOffset = offset
  for (const header of centralDirectory) append(header)
  const centralDirectorySize = offset - centralDirectoryOffset

  if (
    files.length > 0xffff
    || centralDirectoryOffset > 0xffffffff
    || centralDirectorySize > 0xffffffff
  ) {
    throw new Error("Chrome Web Store package is too large for the built-in ZIP writer.")
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralDirectorySize, 12)
  end.writeUInt32LE(centralDirectoryOffset, 16)
  end.writeUInt16LE(0, 20)
  append(end)

  await fsp.mkdir(path.dirname(zipPath), { recursive: true })
  await fsp.writeFile(zipPath, Buffer.concat(chunks))
  return files.map((file) => file.zipPath)
}

export async function readZipEntryNames(zipPath) {
  const bytes = await fsp.readFile(zipPath)
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const endOffset = bytes.lastIndexOf(endSignature)
  if (endOffset < 0 || endOffset + 22 > bytes.byteLength) {
    throw new Error(`Chrome Web Store ZIP has no valid end record: ${zipPath}`)
  }

  const entryCount = bytes.readUInt16LE(endOffset + 10)
  let offset = bytes.readUInt32LE(endOffset + 16)
  const entries = []
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Chrome Web Store ZIP has an invalid central directory: ${zipPath}`)
    }
    const nameLength = bytes.readUInt16LE(offset + 28)
    const extraLength = bytes.readUInt16LE(offset + 30)
    const commentLength = bytes.readUInt16LE(offset + 32)
    entries.push(bytes.toString("utf8", offset + 46, offset + 46 + nameLength))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

export async function packageChromeWebStore({
  extensionDistRoot = defaultExtensionDistRoot,
  outputPath,
  storeIconRoot = defaultStoreIconRoot,
} = {}) {
  const temporaryRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "anybox-chrome-web-store-"),
  )
  const packageRoot = path.join(temporaryRoot, "extension")

  try {
    const staged = await stageChromeWebStorePackage({
      extensionDistRoot,
      packageRoot,
      storeIconRoot,
    })
    const resolvedOutputPath = path.resolve(
      outputPath
      ?? path.join(
        defaultArtifactsRoot,
        `anybox-chrome-${staged.version}-web-store.zip`,
      ),
    )
    const temporaryOutputPath = `${resolvedOutputPath}.tmp-${process.pid}-${Date.now()}`

    try {
      const expectedEntries = await writeDeterministicZipFile(
        packageRoot,
        temporaryOutputPath,
      )
      const actualEntries = await readZipEntryNames(temporaryOutputPath)
      if (
        expectedEntries.length !== actualEntries.length
        || expectedEntries.some((entry, index) => entry !== actualEntries[index])
      ) {
        throw new Error("Chrome Web Store ZIP central directory does not match its staged files.")
      }
      if (actualEntries[0] === undefined || !actualEntries.includes("manifest.json")) {
        throw new Error("Chrome Web Store ZIP must contain manifest.json at its root.")
      }

      await fsp.rm(resolvedOutputPath, { force: true })
      await fsp.rename(temporaryOutputPath, resolvedOutputPath)
    } finally {
      await fsp.rm(temporaryOutputPath, { force: true })
    }

    const bytes = await fsp.readFile(resolvedOutputPath)
    return {
      ...staged,
      bytes: bytes.byteLength,
      outputPath: resolvedOutputPath,
      sha256: sha256(bytes),
    }
  } finally {
    await fsp.rm(temporaryRoot, { recursive: true, force: true })
  }
}

function parseArgs(argv) {
  const options = {
    build: true,
  }

  for (const value of argv) {
    if (value === "--skip-build") {
      options.build = false
    } else if (value.startsWith("--output=")) {
      options.outputPath = path.resolve(repoRoot, value.slice("--output=".length))
    } else if (value === "--help" || value === "-h") {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${value}`)
    }
  }
  return options
}

function printHelp() {
  process.stdout.write([
    "Build the Chrome extension and create a Chrome Web Store ZIP with Anybox box-cat branding.",
    "",
    "The internal Anybox Chrome plugin keeps its Chrome-branded icons. Only the Web Store",
    "staging directory receives the Anybox box-cat icon set.",
    "",
    "Usage:",
    "  node tools/package-chrome-web-store.mjs [options]",
    "",
    "Options:",
    "  --skip-build        Reuse the current browser-extension/dist output.",
    "  --output=<path>      Write the ZIP to a custom repository-relative or absolute path.",
    "  -h, --help           Show this help.",
    "",
  ].join("\n"))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  if (options.build) buildChromeExtension()

  const result = await packageChromeWebStore({
    outputPath: options.outputPath,
  })
  process.stdout.write(`${JSON.stringify({
    bytes: result.bytes,
    files: result.files.length,
    icons: result.icons.map((icon) => ({
      path: icon.path,
      sha256: icon.packagedSha256,
      size: icon.size,
    })),
    outputPath: result.outputPath,
    sha256: result.sha256,
    version: result.version,
  }, null, 2)}\n`)
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
