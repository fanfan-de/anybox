import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const fingerprintProfile = "production-channel-path-normalized-v2"
const autolinkingPathKeys = new Set([
  "cmakeListsPath",
  "cxxModuleCMakeListsPath",
  "root",
  "sourceDir",
])
const textFileExtensions = new Set([
  ".bat",
  ".c",
  ".cc",
  ".cjs",
  ".cmake",
  ".cmd",
  ".cpp",
  ".gradle",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".m",
  ".md",
  ".mjs",
  ".mm",
  ".mk",
  ".podspec",
  ".pro",
  ".properties",
  ".rb",
  ".sh",
  ".swift",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
])
const textFileNames = new Set([".gitignore", "gradlew"])

function isPathInside(root, target) {
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function toPosix(value) {
  return value.replaceAll(path.sep, "/")
}

function isTextFile(filePath) {
  return textFileNames.has(path.basename(filePath)) || textFileExtensions.has(path.extname(filePath).toLowerCase())
}

function normalizeCrlf(buffer) {
  const firstCarriageReturn = buffer.indexOf(13)
  if (firstCarriageReturn < 0) return buffer
  const output = Buffer.allocUnsafe(buffer.length)
  let outputIndex = 0
  for (let inputIndex = 0; inputIndex < buffer.length; inputIndex += 1) {
    if (buffer[inputIndex] === 13 && buffer[inputIndex + 1] === 10) {
      output[outputIndex] = 10
      outputIndex += 1
      inputIndex += 1
    } else {
      output[outputIndex] = buffer[inputIndex]
      outputIndex += 1
    }
  }
  return output.subarray(0, outputIndex)
}

export function createLineEndingNormalizer() {
  const pendingCarriageReturns = new Set()
  return (source, chunk, isEndOfFile) => {
    if (source.type !== "file" || !isTextFile(source.filePath)) return chunk
    const key = source.filePath
    if (isEndOfFile) {
      const hadPendingCarriageReturn = pendingCarriageReturns.delete(key)
      return hadPendingCarriageReturn ? Buffer.from([13]) : null
    }

    const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const output = []
    let body = input
    if (pendingCarriageReturns.delete(key)) {
      if (input[0] === 10) {
        output.push(Buffer.from([10]))
        body = input.subarray(1)
      } else {
        output.push(Buffer.from([13]))
      }
    }

    if (body.at(-1) === 13) {
      pendingCarriageReturns.add(key)
      body = body.subarray(0, -1)
    }
    if (output.length === 0 && body === input && body.indexOf(13) < 0) return input
    output.push(normalizeCrlf(body))
    return Buffer.concat(output)
  }
}

function findPackageMetadata(absolutePath) {
  let current = absolutePath
  const filesystemRoot = path.parse(current).root
  while (true) {
    const packageJsonPath = path.join(current, "package.json")
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"))
      if (typeof packageJson.name === "string" && typeof packageJson.version === "string") {
        return { name: packageJson.name, root: current, version: packageJson.version }
      }
    }
    if (current === filesystemRoot) return null
    current = path.dirname(current)
  }
}

function stablePathIdentity(value, { projectRoot, repoRoot }) {
  const absolutePath = path.resolve(projectRoot, value)
  if (isPathInside(projectRoot, absolutePath)) {
    return `project:${toPosix(path.relative(projectRoot, absolutePath)) || "."}`
  }

  const isInstalledDependency = absolutePath.split(path.sep).includes("node_modules")
  if (isInstalledDependency || !isPathInside(repoRoot, absolutePath)) {
    const dependency = findPackageMetadata(absolutePath)
    if (dependency) {
      const relative = toPosix(path.relative(dependency.root, absolutePath))
      return `npm:${dependency.name}@${dependency.version}${relative ? `/${relative}` : ""}`
    }
  }

  if (isPathInside(repoRoot, absolutePath)) {
    return `repo:${toPosix(path.relative(repoRoot, absolutePath)) || "."}`
  }

  throw new Error(`Unable to normalize native fingerprint path outside the repository: ${absolutePath}`)
}

function normalizeAutolinkingContents(contents, context) {
  const parsed = JSON.parse(String(contents))
  const visit = (value, key) => {
    if (typeof value === "string" && autolinkingPathKeys.has(key)) {
      return stablePathIdentity(value, context)
    }
    if (Array.isArray(value)) return value.map((item) => visit(item, key))
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, visit(child, childKey)]))
    }
    return value
  }
  return JSON.stringify(visit(parsed, ""))
}

function flattenDirectoryFiles(node, topPath, projectRoot, files) {
  for (const child of node.children ?? []) {
    if (!child) continue
    if (Array.isArray(child.children)) {
      flattenDirectoryFiles(child, topPath, projectRoot, files)
      continue
    }
    const absoluteChildPath = path.resolve(projectRoot, child.path)
    const relative = toPosix(path.relative(topPath, absoluteChildPath))
    if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)) {
      throw new Error(`Native fingerprint directory contains an out-of-tree file: ${absoluteChildPath}`)
    }
    files.push({ hash: child.hash, path: relative })
  }
}

function normalizedDirectoryHash(source, projectRoot) {
  if (!source.debugInfo || !Array.isArray(source.debugInfo.children)) {
    throw new Error(`Native fingerprint debug data is missing for directory: ${source.filePath}`)
  }
  const topPath = path.resolve(projectRoot, source.filePath)
  const files = []
  flattenDirectoryFiles(source.debugInfo, topPath, projectRoot, files)
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const hasher = createHash("sha1")
  for (const file of files) {
    hasher.update(file.path)
    hasher.update(file.hash)
  }
  return hasher.digest("hex")
}

function normalizedContentsHash(source, context) {
  const contents = source.id === "expoAutolinkingConfig:android" || source.id === "rncoreAutolinkingConfig:android"
    ? normalizeAutolinkingContents(source.contents, context)
    : source.contents
  return createHash("sha1").update(contents).digest("hex")
}

export function normalizeFingerprintSources(sources, context) {
  const normalized = []
  for (const source of sources) {
    if (source.hash == null) continue
    if (source.type === "contents") {
      normalized.push({ hash: normalizedContentsHash(source, context), id: `contents:${source.id}` })
      continue
    }
    const identity = stablePathIdentity(source.filePath, context)
    normalized.push({
      hash: source.type === "dir" ? normalizedDirectoryHash(source, context.projectRoot) : source.hash,
      id: `${source.type}:${identity}`,
    })
  }

  normalized.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].id === normalized[index].id) {
      throw new Error(`Native fingerprint source identity is ambiguous: ${normalized[index].id}`)
    }
  }

  return normalized
}

export function createPathNormalizedFingerprint(sources, context) {
  const normalized = normalizeFingerprintSources(sources, context)

  const hasher = createHash("sha1")
  hasher.update(`${fingerprintProfile}\0`)
  for (const source of normalized) {
    hasher.update(source.id)
    hasher.update(source.hash)
  }
  return hasher.digest("hex")
}

export async function createAndroidNativeFingerprint(projectRoot, repoRoot) {
  const { createFingerprintAsync } = await import("@expo/fingerprint")
  const fingerprint = await createFingerprintAsync(projectRoot, {
    debug: true,
    fileHookTransform: createLineEndingNormalizer(),
    platforms: ["android"],
    silent: true,
  })
  return createPathNormalizedFingerprint(fingerprint.sources, { projectRoot, repoRoot })
}

export { fingerprintProfile }
