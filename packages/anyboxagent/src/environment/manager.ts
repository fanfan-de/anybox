import { randomUUID } from "node:crypto"
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { applyEdits, modify } from "jsonc-parser"
import * as Discovery from "#environment/discovery.ts"
import * as EnvironmentEvents from "#environment/events.ts"
import * as Store from "#environment/store.ts"
import {
  ENVIRONMENT_CONFIG_MAX_BYTES,
  EnvironmentDefinition,
  type EnvironmentCandidate,
  type EnvironmentDefinition as EnvironmentDefinitionValue,
} from "#environment/types.ts"
import { ApiError } from "#server/error.ts"

const FORMATTING_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
  eol: "\n",
} as const

function updateJsoncDefinition(current: string | undefined, definition: EnvironmentDefinitionValue) {
  let text = current?.trim() ? current : "{\n}\n"
  for (const [key, value] of [
    ["version", definition.version],
    ["name", definition.name],
    ["setup", definition.setup],
    ["actions", definition.actions],
  ] as const) {
    text = applyEdits(
      text,
      modify(text, [key], value, {
        formattingOptions: FORMATTING_OPTIONS,
      }),
    )
  }
  return `${text.trimEnd()}\n`
}

async function currentFile(pathValue: string) {
  const file = await lstat(pathValue).catch(() => undefined)
  if (!file) return undefined
  if (file.isSymbolicLink()) {
    throw new ApiError(
      400,
      "ENVIRONMENT_SYMLINK_NOT_WRITABLE",
      "Anybox does not overwrite environment configuration symlinks.",
    )
  }
  if (!file.isFile()) {
    throw new ApiError(
      400,
      "ENVIRONMENT_PATH_NOT_FILE",
      "Environment configuration path is not a file.",
    )
  }
  const bytes = await readFile(pathValue)
  const text = bytes.toString("utf8")
  return {
    text,
    hash: Discovery.internal.sha256(bytes),
  }
}

async function writeAtomic(pathValue: string, content: string) {
  const parent = path.dirname(pathValue)
  const temporary = path.join(parent, `.environment-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, "utf8")
    await rename(temporary, pathValue)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function ensureWritableEnvironmentParent(rootDirectory: string, targetPath: string) {
  const parent = path.dirname(targetPath)
  const relative = path.relative(rootDirectory, parent)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError(
      400,
      "ENVIRONMENT_PATH_OUTSIDE_ROOT",
      "Environment configuration path must stay inside its project directory.",
    )
  }

  let cursor = rootDirectory
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    const entry = await lstat(cursor).catch(() => undefined)
    if (entry?.isSymbolicLink()) {
      throw new ApiError(
        400,
        "ENVIRONMENT_SYMLINK_NOT_WRITABLE",
        "Anybox does not write environment configuration through directory symlinks.",
      )
    }
    if (entry && !entry.isDirectory()) {
      throw new ApiError(
        400,
        "ENVIRONMENT_PATH_NOT_DIRECTORY",
        "An environment configuration parent path is not a directory.",
      )
    }
    if (!entry) await mkdir(cursor)
  }

  const canonicalParent = await realpath(parent)
  const canonicalRoot = await realpath(rootDirectory)
  const canonicalRelative = path.relative(canonicalRoot, canonicalParent)
  if (canonicalRelative.startsWith("..") || path.isAbsolute(canonicalRelative)) {
    throw new ApiError(
      400,
      "ENVIRONMENT_SYMLINK_OUTSIDE_PROJECT",
      "Environment configuration parent resolves outside the current project directory.",
    )
  }
}

async function findSavedNativeEnvironment(projectID: string, directory: string) {
  const result = await Discovery.discoverProjectEnvironments(projectID, directory)
  const root = Discovery.internal.normalizeComparablePath(directory)
  const candidate = result.items.find(
    (item) =>
      item.source === "anybox-jsonc"
      && Discovery.internal.normalizeComparablePath(item.rootDirectory) === root,
  )
  if (!candidate) {
    throw new ApiError(
      500,
      "ENVIRONMENT_SAVE_FAILED",
      "The saved environment configuration could not be read back.",
    )
  }
  return candidate
}

export async function saveNativeEnvironment(input: {
  projectID: string
  directory: string
  definition: EnvironmentDefinitionValue
  expectedHash: string | null
  trust: boolean
}) {
  const definition = EnvironmentDefinition.parse(input.definition)
  const resolved = await Discovery.resolveProjectEnvironmentBoundary(
    input.projectID,
    input.directory,
  )
  const targetPath = path.join(resolved.directory, Discovery.paths.anybox)
  const current = await currentFile(targetPath)

  if (current) {
    if (input.expectedHash === null || input.expectedHash !== current.hash) {
      throw new ApiError(
        409,
        "ENVIRONMENT_CONFLICT",
        "Environment configuration changed. Reload it before saving.",
      )
    }
  } else if (input.expectedHash !== null) {
    throw new ApiError(
      409,
      "ENVIRONMENT_CONFLICT",
      "Environment configuration no longer exists. Reload before saving.",
    )
  }

  const next = updateJsoncDefinition(current?.text, definition)
  if (Buffer.byteLength(next, "utf8") > ENVIRONMENT_CONFIG_MAX_BYTES) {
    throw new ApiError(
      413,
      "ENVIRONMENT_FILE_TOO_LARGE",
      `Environment configuration exceeds ${ENVIRONMENT_CONFIG_MAX_BYTES} bytes.`,
    )
  }
  await ensureWritableEnvironmentParent(resolved.directory, targetPath)
  await writeAtomic(targetPath, next)
  const candidate = await findSavedNativeEnvironment(input.projectID, resolved.directory)
  if (input.trust) {
    Store.trustEnvironment(input.projectID, candidate.configPath, candidate.contentHash)
    candidate.trusted = true
  }
  EnvironmentEvents.publish("environment.definition.changed", {
    projectID: input.projectID,
    directory: resolved.directory,
    environment: candidate,
  })
  return candidate
}

export async function importEnvironment(input: {
  projectID: string
  directory: string
  key: string
  expectedHash: string
  trust: boolean
}) {
  const candidate = await Discovery.requireEnvironmentCandidate({
    projectID: input.projectID,
    directory: input.directory,
    key: input.key,
    expectedHash: input.expectedHash,
  })
  if (candidate.source === "anybox-jsonc") {
    throw new ApiError(
      409,
      "ENVIRONMENT_ALREADY_NATIVE",
      "This environment already uses the Anybox JSONC format.",
    )
  }

  const targetPath = path.join(candidate.rootDirectory, Discovery.paths.anybox)
  if (await lstat(targetPath).catch(() => undefined)) {
    throw new ApiError(
      409,
      "ENVIRONMENT_NATIVE_EXISTS",
      "An Anybox environment already exists in this directory.",
    )
  }

  return saveNativeEnvironment({
    projectID: input.projectID,
    directory: candidate.rootDirectory,
    definition: candidate.definition,
    expectedHash: null,
    trust: input.trust,
  })
}

export async function trustEnvironment(input: {
  projectID: string
  directory: string
  key: string
  expectedHash: string
}) {
  const candidate = await Discovery.requireEnvironmentCandidate({
    projectID: input.projectID,
    directory: input.directory,
    key: input.key,
    expectedHash: input.expectedHash,
  })
  Store.trustEnvironment(input.projectID, candidate.configPath, candidate.contentHash)
  const trusted = {
    ...candidate,
    trusted: true,
  } satisfies EnvironmentCandidate
  EnvironmentEvents.publish("environment.definition.changed", {
    projectID: input.projectID,
    directory: candidate.requestedDirectory,
    environment: trusted,
  })
  return trusted
}

export async function revokeEnvironmentTrust(input: {
  projectID: string
  directory: string
  key: string
  expectedHash?: string
}) {
  const candidate = await Discovery.requireEnvironmentCandidate({
    projectID: input.projectID,
    directory: input.directory,
    key: input.key,
    expectedHash: input.expectedHash,
  })
  Store.revokeEnvironmentTrust(input.projectID, candidate.configPath)
  const revoked = {
    ...candidate,
    trusted: false,
  } satisfies EnvironmentCandidate
  EnvironmentEvents.publish("environment.definition.changed", {
    projectID: input.projectID,
    directory: candidate.requestedDirectory,
    environment: revoked,
  })
  return revoked
}

export async function updatePreference(input: {
  projectID: string
  directory: string
  selectedKey?: string | null
  autoSetup?: boolean
}) {
  const resolved = await Discovery.resolveProjectEnvironmentBoundary(
    input.projectID,
    input.directory,
  )
  if (input.selectedKey) {
    await Discovery.requireEnvironmentCandidate({
      projectID: input.projectID,
      directory: resolved.directory,
      key: input.selectedKey,
    })
  }
  return Store.setPreference({
    projectID: input.projectID,
    directory: Discovery.internal.normalizeComparablePath(resolved.directory),
    selectedKey: input.selectedKey,
    autoSetup: input.autoSetup,
  })
}
