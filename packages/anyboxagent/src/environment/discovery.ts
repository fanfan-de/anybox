import { createHash } from "node:crypto"
import { realpath, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { isSshWorkspaceUri } from "@anybox/shared"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import * as Project from "#project/project.ts"
import * as Worktree from "#project/worktree.ts"
import { ApiError } from "#server/error.ts"
import * as Store from "#environment/store.ts"
import {
  ENVIRONMENT_CONFIG_MAX_BYTES,
  EnvironmentCandidate,
  EnvironmentDefinition,
  type EnvironmentDefinition as EnvironmentDefinitionValue,
  type EnvironmentIssue,
  type EnvironmentListResult,
  type EnvironmentSource,
} from "#environment/types.ts"

const ANYBOX_ENVIRONMENT_RELATIVE_PATH = path.join(".anybox", "environments", "environment.jsonc")
const CODEX_ENVIRONMENT_RELATIVE_PATH = path.join(".codex", "environments", "environment.toml")

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function normalizeComparablePath(input: string) {
  const normalized = path.normalize(path.resolve(input))
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function containsPath(root: string, candidate: string) {
  const relative = path.relative(normalizeComparablePath(root), normalizeComparablePath(candidate))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function canonicalize(input: string) {
  const resolved = path.resolve(input)
  return path.normalize(await realpath(resolved).catch(() => resolved))
}

function environmentKey(configPath: string) {
  return `env_${sha256(normalizeComparablePath(configPath)).slice(0, 24)}`
}

function issuePath(pathValue: PropertyKey[]) {
  return pathValue.length ? pathValue.map(String).join(".") : undefined
}

function zodIssues(error: { issues: Array<{ code: string; message: string; path: PropertyKey[] }> }) {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issuePath(issue.path),
    severity: "error" as const,
  }))
}

function parseErrorMessage(error: ParseError) {
  return `JSONC parse error ${error.error} at offset ${error.offset}.`
}

function parseNativeDefinition(text: string) {
  const errors: ParseError[] = []
  const raw = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  })
  if (errors.length) {
    return {
      definition: null,
      issues: errors.map((error) => ({
        code: "INVALID_JSONC",
        message: parseErrorMessage(error),
        severity: "error" as const,
      })),
    }
  }

  const parsed = EnvironmentDefinition.safeParse(raw)
  if (!parsed.success) {
    return {
      definition: null,
      issues: zodIssues(parsed.error),
    }
  }

  return {
    definition: parsed.data,
    issues: [] satisfies EnvironmentIssue[],
  }
}

function stringRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function slugActionID(name: string, index: number, used: Set<string>) {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 52) || `action-${index + 1}`
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 56)}-${suffix++}`
  }
  used.add(candidate)
  return candidate
}

function codexUnknownFieldWarnings(raw: Record<string, unknown>) {
  const issues: EnvironmentIssue[] = []
  for (const key of Object.keys(raw)) {
    if (!["version", "name", "setup", "actions"].includes(key)) {
      issues.push({
        code: "UNSUPPORTED_CODEX_FIELD",
        message: `Codex field '${key}' is not supported by Anybox yet.`,
        path: key,
        severity: "warning",
      })
    }
  }
  const setup = stringRecord(raw.setup)
  for (const key of Object.keys(setup ?? {})) {
    if (key !== "script") {
      issues.push({
        code: "UNSUPPORTED_CODEX_FIELD",
        message: `Codex setup field '${key}' is not supported by Anybox yet.`,
        path: `setup.${key}`,
        severity: "warning",
      })
    }
  }
  const actions = Array.isArray(raw.actions) ? raw.actions : []
  for (const [index, actionValue] of actions.entries()) {
    const action = stringRecord(actionValue)
    for (const key of Object.keys(action ?? {})) {
      if (!["name", "icon", "command"].includes(key)) {
        issues.push({
          code: "UNSUPPORTED_CODEX_FIELD",
          message: `Codex action field '${key}' is not supported by Anybox yet.`,
          path: `actions.${index}.${key}`,
          severity: "warning",
        })
      }
    }
  }
  return issues
}

export function convertCodexDefinition(
  rawValue: unknown,
  fallbackName: string,
): { definition: EnvironmentDefinitionValue | null; issues: EnvironmentIssue[] } {
  const raw = stringRecord(rawValue)
  if (!raw) {
    return {
      definition: null,
      issues: [{
        code: "INVALID_CODEX_TOML",
        message: "Codex environment must contain a TOML object.",
        severity: "error",
      }],
    }
  }

  const issues = codexUnknownFieldWarnings(raw)
  if (raw.version !== undefined && raw.version !== 1) {
    return {
      definition: null,
      issues: [
        ...issues,
        {
          code: "UNSUPPORTED_CODEX_VERSION",
          message: "Only Codex environment version 1 is supported.",
          path: "version",
          severity: "error",
        },
      ],
    }
  }
  const setup = stringRecord(raw.setup)
  const setupScript = typeof setup?.script === "string" ? setup.script.trim() : ""
  const usedActionIDs = new Set<string>()
  const actions = (Array.isArray(raw.actions) ? raw.actions : [])
    .map((value, index) => {
      const action = stringRecord(value)
      const command = typeof action?.command === "string" ? action.command.trim() : ""
      if (!command) {
        issues.push({
          code: "INVALID_CODEX_ACTION",
          message: "Codex action command is empty and was ignored.",
          path: `actions.${index}.command`,
          severity: "warning",
        })
        return undefined
      }
      const name = typeof action?.name === "string" && action.name.trim()
        ? action.name.trim()
        : `Action ${index + 1}`
      return {
        id: slugActionID(name, index, usedActionIDs),
        name,
        icon: typeof action?.icon === "string" && action.icon.trim()
          ? action.icon.trim()
          : "terminal",
        scripts: { default: command },
        cwd: ".",
      }
    })
    .filter((action): action is NonNullable<typeof action> => Boolean(action))

  const candidate = {
    version: 1 as const,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : fallbackName,
    ...(setupScript
      ? {
          setup: {
            scripts: { default: setupScript },
            cwd: ".",
            timeoutSeconds: 900,
          },
        }
      : {}),
    actions,
  }
  const parsed = EnvironmentDefinition.safeParse(candidate)
  if (!parsed.success) {
    return {
      definition: null,
      issues: [...issues, ...zodIssues(parsed.error)],
    }
  }
  return { definition: parsed.data, issues }
}

function parseCodexDefinition(text: string, fallbackName: string) {
  try {
    const raw = Bun.TOML.parse(text)
    return convertCodexDefinition(raw, fallbackName)
  } catch (error) {
    return {
      definition: null,
      issues: [{
        code: "INVALID_CODEX_TOML",
        message: error instanceof Error ? error.message : "Codex TOML could not be parsed.",
        severity: "error" as const,
      }],
    }
  }
}

async function readCandidate(input: {
  projectID: string
  requestedDirectory: string
  rootDirectory: string
  boundaryRoot: string
  configPath: string
  source: EnvironmentSource
  scope: "direct" | "ancestor"
}): Promise<EnvironmentCandidate | undefined> {
  const fileStat = await stat(input.configPath).catch(() => undefined)
  if (!fileStat?.isFile()) return undefined

  const canonicalConfigPath = await canonicalize(input.configPath)
  if (!containsPath(input.boundaryRoot, canonicalConfigPath)) {
    const contentHash = sha256(canonicalConfigPath)
    return {
      key: environmentKey(canonicalConfigPath),
      projectID: input.projectID,
      requestedDirectory: input.requestedDirectory,
      rootDirectory: input.rootDirectory,
      configPath: canonicalConfigPath,
      source: input.source,
      scope: input.scope,
      contentHash,
      readonly: input.source !== "anybox-jsonc",
      trusted: false,
      definition: null,
      issues: [{
        code: "ENVIRONMENT_SYMLINK_OUTSIDE_PROJECT",
        message: "Environment configuration resolves outside the current project boundary.",
        severity: "error",
      }],
    }
  }

  if (fileStat.size > ENVIRONMENT_CONFIG_MAX_BYTES) {
    const contentHash = sha256(`${canonicalConfigPath}:${fileStat.size}`)
    return {
      key: environmentKey(canonicalConfigPath),
      projectID: input.projectID,
      requestedDirectory: input.requestedDirectory,
      rootDirectory: input.rootDirectory,
      configPath: canonicalConfigPath,
      source: input.source,
      scope: input.scope,
      contentHash,
      readonly: input.source !== "anybox-jsonc",
      trusted: false,
      definition: null,
      issues: [{
        code: "ENVIRONMENT_FILE_TOO_LARGE",
        message: `Environment configuration exceeds ${ENVIRONMENT_CONFIG_MAX_BYTES} bytes.`,
        severity: "error",
      }],
    }
  }

  const bytes = await readFile(canonicalConfigPath)
  const contentHash = sha256(bytes)
  if (bytes.byteLength > ENVIRONMENT_CONFIG_MAX_BYTES) {
    return {
      key: environmentKey(canonicalConfigPath),
      projectID: input.projectID,
      requestedDirectory: input.requestedDirectory,
      rootDirectory: input.rootDirectory,
      configPath: canonicalConfigPath,
      source: input.source,
      scope: input.scope,
      contentHash,
      readonly: input.source !== "anybox-jsonc",
      trusted: false,
      definition: null,
      issues: [{
        code: "ENVIRONMENT_FILE_TOO_LARGE",
        message: `Environment configuration exceeds ${ENVIRONMENT_CONFIG_MAX_BYTES} bytes.`,
        severity: "error",
      }],
    }
  }
  const text = bytes.toString("utf8")
  const parsed = input.source === "anybox-jsonc"
    ? parseNativeDefinition(text)
    : parseCodexDefinition(text, path.basename(input.rootDirectory))

  return {
    key: environmentKey(canonicalConfigPath),
    projectID: input.projectID,
    requestedDirectory: input.requestedDirectory,
    rootDirectory: input.rootDirectory,
    configPath: canonicalConfigPath,
    source: input.source,
    scope: input.scope,
    contentHash,
    readonly: input.source !== "anybox-jsonc",
    trusted: Boolean(parsed.definition)
      && Store.isTrusted(input.projectID, canonicalConfigPath, contentHash),
    definition: parsed.definition,
    issues: parsed.issues,
  }
}

export async function resolveProjectEnvironmentBoundary(projectID: string, rawDirectory: string) {
  const project = Project.get(projectID)
  if (!project) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", `Project '${projectID}' not found.`)
  }
  if (isSshWorkspaceUri(rawDirectory) || isSshWorkspaceUri(Project.getRepositoryRoot(project))) {
    throw new ApiError(
      409,
      "ENVIRONMENT_UNAVAILABLE_FOR_SSH",
      "Project environments are not available for SSH workspaces yet.",
    )
  }

  const directory = await canonicalize(rawDirectory.trim())
  const directoryStat = await stat(directory).catch(() => undefined)
  if (!directoryStat?.isDirectory()) {
    throw new ApiError(400, "ENVIRONMENT_DIRECTORY_NOT_FOUND", `Directory '${rawDirectory}' does not exist.`)
  }

  Project.listWorktrees(projectID)
  const worktree = Worktree.findForDirectory(projectID, directory)
  const roots = [
    ...Project.getWorkspaceRoots(project),
    Project.getRepositoryRoot(project),
    ...Project.listWorktrees(projectID).map((record) => record.path),
  ]
  const matchingRoots = (await Promise.all(roots.map(canonicalize)))
    .filter((root) => containsPath(root, directory))
    .sort((left, right) => right.length - left.length)
  const boundaryRoot = worktree
    ? await canonicalize(worktree.path)
    : matchingRoots[0]

  if (!boundaryRoot) {
    throw new ApiError(
      400,
      "DIRECTORY_NOT_IN_PROJECT",
      `Directory '${directory}' does not belong to project '${projectID}'.`,
    )
  }

  return { project, directory, boundaryRoot, worktree }
}

function boundCandidate(input: {
  binding: NonNullable<ReturnType<typeof Store.findBindingByWorktree>>
  requestedDirectory: string
}) {
  const { binding } = input
  const setupRun = Store.listRuns({ worktreeID: binding.worktreeID })
    .filter((run) => run.kind === "setup")
    .sort((left, right) => right.createdAt - left.createdAt)[0]
  return EnvironmentCandidate.parse({
    key: binding.environmentKey,
    projectID: binding.projectID,
    requestedDirectory: input.requestedDirectory,
    rootDirectory: binding.targetRoot,
    configPath: binding.sourceConfigPath,
    source: binding.source,
    scope: "bound",
    contentHash: binding.contentHash,
    readonly: binding.source !== "anybox-jsonc",
    trusted: Store.isTrusted(
      binding.projectID,
      binding.sourceConfigPath,
      binding.contentHash,
    ),
    definition: binding.definition,
    issues: [],
    bindingID: binding.id,
    setupRunID: setupRun?.id,
    setupRunStatus: setupRun?.status,
  })
}

export async function discoverProjectEnvironments(
  projectID: string,
  rawDirectory: string,
): Promise<EnvironmentListResult> {
  const resolved = await resolveProjectEnvironmentBoundary(projectID, rawDirectory)
  const items: EnvironmentCandidate[] = []
  const seen = new Set<string>()

  if (resolved.worktree?.managed) {
    const binding = Store.findBindingByWorktree(resolved.worktree.id)
    if (binding) {
      const candidate = boundCandidate({
        binding,
        requestedDirectory: resolved.directory,
      })
      items.push(candidate)
      seen.add(candidate.key)
    }
  }

  let cursor = resolved.directory
  while (containsPath(resolved.boundaryRoot, cursor)) {
    const scope = normalizeComparablePath(cursor) === normalizeComparablePath(resolved.directory)
      ? "direct" as const
      : "ancestor" as const
    for (const [relativePath, source] of [
      [ANYBOX_ENVIRONMENT_RELATIVE_PATH, "anybox-jsonc"],
      [CODEX_ENVIRONMENT_RELATIVE_PATH, "codex-toml"],
    ] as const) {
      const candidate = await readCandidate({
        projectID,
        requestedDirectory: resolved.directory,
        rootDirectory: cursor,
        boundaryRoot: resolved.boundaryRoot,
        configPath: path.join(cursor, relativePath),
        source,
        scope,
      })
      if (candidate && !seen.has(candidate.key)) {
        items.push(candidate)
        seen.add(candidate.key)
      }
    }

    if (normalizeComparablePath(cursor) === normalizeComparablePath(resolved.boundaryRoot)) break
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }

  const legacyScript = resolved.project.commands?.start?.trim()
  if (legacyScript) {
    const configPath = `legacy:${projectID}:commands.start`
    const contentHash = sha256(legacyScript)
    const legacy = EnvironmentCandidate.parse({
      key: environmentKey(configPath),
      projectID,
      requestedDirectory: resolved.directory,
      rootDirectory: resolved.boundaryRoot,
      configPath,
      source: "legacy-start",
      scope: "ancestor",
      contentHash,
      readonly: true,
      trusted: Store.isTrusted(projectID, configPath, contentHash),
      definition: {
        version: 1,
        name: `${resolved.project.name ?? path.basename(resolved.boundaryRoot)} legacy`,
        setup: {
          scripts: { default: legacyScript },
          cwd: ".",
          timeoutSeconds: 900,
        },
        actions: [],
      },
      issues: [{
        code: "LEGACY_START_SCRIPT",
        message: "This environment comes from the legacy project startup command.",
        severity: "warning",
      }],
    })
    items.push(legacy)
  }

  const preference = Store.getPreference(projectID, normalizeComparablePath(resolved.directory))
  const bound = items.find((item) => item.scope === "bound" && item.definition)
  const selectedKey = bound?.key ?? (
    items.some((item) => item.key === preference?.selectedKey)
      ? preference?.selectedKey ?? undefined
      : items.find((item) => item.definition)?.key
  )

  return {
    projectID,
    directory: resolved.directory,
    boundaryRoot: resolved.boundaryRoot,
    items,
    selectedKey,
    autoSetup: preference?.autoSetup ?? true,
  }
}

export async function requireEnvironmentCandidate(input: {
  projectID: string
  directory: string
  key: string
  expectedHash?: string
  requireTrusted?: boolean
}) {
  const result = await discoverProjectEnvironments(input.projectID, input.directory)
  const candidate = result.items.find((item) => item.key === input.key)
  if (!candidate) {
    throw new ApiError(404, "ENVIRONMENT_NOT_FOUND", `Environment '${input.key}' was not found.`)
  }
  if (!candidate.definition) {
    throw new ApiError(
      400,
      "ENVIRONMENT_INVALID",
      "Environment configuration is invalid.",
      { issues: candidate.issues },
    )
  }
  if (input.expectedHash && candidate.contentHash !== input.expectedHash) {
    throw new ApiError(
      409,
      "ENVIRONMENT_CONFLICT",
      "Environment configuration changed. Reload it before continuing.",
    )
  }
  if (input.requireTrusted && !candidate.trusted) {
    throw new ApiError(
      403,
      "ENVIRONMENT_NOT_TRUSTED",
      "Trust this environment configuration before running its scripts.",
    )
  }
  return candidate as EnvironmentCandidate & { definition: EnvironmentDefinitionValue }
}

export const paths = {
  anybox: ANYBOX_ENVIRONMENT_RELATIVE_PATH,
  codex: CODEX_ENVIRONMENT_RELATIVE_PATH,
}

export const internal = {
  containsPath,
  environmentKey,
  normalizeComparablePath,
  parseNativeDefinition,
  sha256,
}
