import path from "node:path"
import { realpath } from "node:fs/promises"
import { containsWorkspaceLocation, isSshWorkspaceUri } from "@anybox/shared"
import z from "zod"
import * as db from "#database/Sqlite.ts"
import * as Config from "#config/config.ts"
import * as GitCommitMessage from "#git/commit-message.ts"
import * as Git from "#git/git.ts"
import * as Mcp from "#mcp/manager.ts"
import type { PtyRegistry } from "#pty/registry.ts"
import { Instance } from "#project/instance.ts"
import * as Project from "#project/project.ts"
import * as Worktree from "#project/worktree.ts"
import * as ModelsDev from "#provider/modelsdev.ts"
import * as ModelRegistry from "#model/registry.ts"
import * as ModelSelection from "#model/selection.ts"
import * as Plugin from "#plugin/plugin.ts"
import * as Provider from "#provider/provider.ts"
import { ApiError } from "#server/error.ts"
import {
  clearProjectModelListCache,
  listProjectModelsWithFallback,
  resolveEffectiveModelWithFallback,
  resolveProjectModelSelectionWithGlobalFallback,
} from "#server/usecases/model-list-cache.ts"
import * as Session from "#session/core/session.ts"
import * as PromptPresets from "#session/support/prompt-presets.ts"
import * as Subtask from "#session/tasks/subtask.ts"
import * as Skill from "#skill/skill.ts"

export const CreateProjectBody = z.object({
  directory: z.string().min(1),
})

export const CreateProjectSessionBody = z.object({
  directory: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
})

export const CreateProjectWorktreeBody = z.object({
  baseRef: z.string().trim().min(1).optional(),
  branchName: z.string().trim().min(1).optional(),
  cleanupPolicy: Worktree.WorktreeCleanupPolicy.optional().default("manual"),
  ownerRunID: z.string().trim().min(1).optional(),
  ownerSessionID: z.string().trim().min(1).optional(),
  ownerType: Worktree.WorktreeOwnerType.optional().default("manual"),
})

export const DeleteProjectWorktreeBody = z.object({
  force: z.boolean().optional().default(false),
  ownerRunID: z.string().trim().min(1).optional(),
  ownerSessionID: z.string().trim().min(1).optional(),
})

export const UpdateMcpServerBody = Config.McpServerInput
export const UpdateProjectProviderBody = Config.Provider
export const UpdateProjectModelSelectionBody = Config.ModelSelection
export const UpdateProjectSkillSelectionBody = Config.ProjectSkillSelection
export const UpdateProjectMcpSelectionBody = Config.ProjectMcpSelection
export const UpdateProjectPluginSelectionBody = Config.ProjectPluginSelection

export const GitDirectoryQuery = z.object({
  directory: z.string().min(1),
  includePullRequestRemoteCheck: z.preprocess((value) => {
    if (value === "true") return true
    if (value === "false") return false
    return value
  }, z.boolean().optional()),
})

export const GitCommitBody = z.object({
  directory: z.string().min(1),
  message: z.string().min(1),
  stageAll: z.boolean().optional(),
})

export const GitCommitMessageBody = z.object({
  directory: z.string().min(1),
  stageAll: z.boolean().optional(),
})

export const GitDirectoryBody = z.object({
  directory: z.string().min(1),
})

export const GitCreateBranchBody = z.object({
  directory: z.string().min(1),
  name: z.string().min(1),
})

export const GitCheckoutBranchBody = z.object({
  directory: z.string().min(1),
  name: z.string().min(1),
})

function safeReadProject(projectID: string) {
  const project = Project.get(projectID)
  if (!project) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", `Project '${projectID}' not found`)
  }

  return project
}

function normalizeProjectDirectory(input: string) {
  if (isSshWorkspaceUri(input)) return input
  const normalized = path.normalize(input)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

async function canonicalizeProjectDirectory(input: string) {
  if (isSshWorkspaceUri(input)) return input
  const resolved = path.resolve(input)

  try {
    return path.normalize(await realpath(resolved))
  } catch {
    return path.normalize(resolved)
  }
}

function isDirectoryInsideProjectRoot(directory: string, root: string) {
  if (isSshWorkspaceUri(directory) || isSshWorkspaceUri(root)) {
    return containsWorkspaceLocation(root, directory)
  }

  const normalizedRoot = normalizeProjectDirectory(root)
  const normalizedDirectory = normalizeProjectDirectory(directory)
  const relative = path.relative(normalizedRoot, normalizedDirectory)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function resolveProjectBoundaryRoots(project: Project.ProjectInfo) {
  const roots = new Set<string>()

  roots.add(await canonicalizeProjectDirectory(Project.getRepositoryRoot(project)))

  for (const root of Project.getWorkspaceRoots(project)) {
    roots.add(await canonicalizeProjectDirectory(root))
  }

  return [...roots]
}

function projectContainsDirectory(projectRoots: string[], directory: string) {
  return projectRoots.some((root) => isDirectoryInsideProjectRoot(directory, root))
}

async function resolveProjectGitDirectory(
  projectID: string,
  rawDirectory: string,
  options?: {
    verifyRepositoryRoot?: boolean
  },
) {
  const project = safeReadProject(projectID)
  const directory = rawDirectory.trim()
  if (!directory) {
    throw new ApiError(400, "INVALID_PAYLOAD", "Body must include a non-empty 'directory'")
  }

  const repositoryRoot = Project.getRepositoryRoot(project)
  if (isSshWorkspaceUri(repositoryRoot) || isSshWorkspaceUri(directory)) {
    if (!containsWorkspaceLocation(repositoryRoot, directory)) {
      throw new ApiError(400, "DIRECTORY_NOT_IN_PROJECT", `Directory '${directory}' does not belong to project '${projectID}'`)
    }
    throw new ApiError(409, "GIT_UNAVAILABLE_FOR_SSH", "Git shortcuts are not available for SSH workspaces yet")
  }

  const [projectRoots, canonicalDirectory] = await Promise.all([
    resolveProjectBoundaryRoots(project),
    canonicalizeProjectDirectory(directory),
  ])

  if (!projectContainsDirectory(projectRoots, canonicalDirectory)) {
    throw new ApiError(400, "DIRECTORY_NOT_IN_PROJECT", `Directory '${directory}' does not belong to project '${projectID}'`)
  }

  if (options?.verifyRepositoryRoot) {
    const repositoryRoot = await Git.resolveGitRepositoryRoot(canonicalDirectory)
    if (repositoryRoot) {
      const canonicalRepositoryRoot = await canonicalizeProjectDirectory(repositoryRoot)
      if (!projectContainsDirectory(projectRoots, canonicalRepositoryRoot)) {
        throw new ApiError(
          400,
          "DIRECTORY_NOT_IN_PROJECT",
          `Git repository root '${repositoryRoot}' does not belong to project '${projectID}'`,
        )
      }
    }
  }

  return canonicalDirectory
}

function createProjectGitApiError(error: unknown) {
  if (error instanceof ApiError) return error

  const message = error instanceof Error && error.message.trim()
    ? error.message
    : "Git operation failed."

  return new ApiError(400, "GIT_OPERATION_FAILED", message)
}

async function runProjectGitOperation<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    throw createProjectGitApiError(error)
  }
}

function createProjectWorktreeApiError(error: unknown) {
  if (error instanceof ApiError) return error

  const message = error instanceof Error && error.message.trim()
    ? error.message
    : "Worktree operation failed."

  if (message.includes("uncommitted changes") || message.includes("force=true")) {
    return new ApiError(409, "WORKTREE_DIRTY", message)
  }
  if (message.includes("Only managed worktrees")) {
    return new ApiError(403, "WORKTREE_NOT_MANAGED", message)
  }
  if (message.includes("outside the configured worktree parent") || message.includes("ownerRunID") || message.includes("ownerSessionID")) {
    return new ApiError(403, "WORKTREE_DELETE_FORBIDDEN", message)
  }
  if (message.includes("SSH workspaces")) {
    return new ApiError(409, "WORKTREE_UNAVAILABLE_FOR_SSH", message)
  }

  return new ApiError(400, "WORKTREE_OPERATION_FAILED", message)
}

async function runProjectWorktreeOperation<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    throw createProjectWorktreeApiError(error)
  }
}

function createCommitMessageGenerationApiError(error: unknown) {
  if (error instanceof ApiError) return error

  const message = error instanceof Error && error.message.trim()
    ? error.message
    : "Commit message generation failed."

  if (error instanceof GitCommitMessage.internal.GitCommitMessageError) {
    return new ApiError(
      502,
      error.code === "EMPTY" ? "COMMIT_MESSAGE_EMPTY" : "COMMIT_MESSAGE_GENERATION_FAILED",
      message,
    )
  }

  return createProjectGitApiError(error)
}

async function runProjectGitCommitMessageOperation<T>(operation: () => Promise<T>) {
  try {
    return await operation()
  } catch (error) {
    throw createCommitMessageGenerationApiError(error)
  }
}

function mapSessionSummary(session: Session.SessionInfo) {
  const normalized = Session.normalizeSessionInfo(session)
  return {
    ...normalized,
    origin: Session.getSessionOrigin(normalized.id),
    subagent: Subtask.getSubtaskSessionOrigin(normalized.id),
  }
}

export async function listProjects() {
  return Project.list()
}

export async function createProject(input: z.infer<typeof CreateProjectBody>) {
  const { project } = await Project.fromDirectory(input.directory)
  return project
}

export function listProjectSessions(projectID: string) {
  safeReadProject(projectID)
  return Session.listByProject(projectID).map(mapSessionSummary)
}

export async function listProjectWorktrees(projectID: string) {
  safeReadProject(projectID)
  return Project.refreshWorktrees(projectID)
}

export async function createProjectWorktree(
  projectID: string,
  input: z.infer<typeof CreateProjectWorktreeBody>,
) {
  safeReadProject(projectID)
  return runProjectWorktreeOperation(async () => {
    const worktree = await Project.createManagedWorktree(projectID, {
      baseRef: input.baseRef,
      branch: input.branchName,
      cleanupPolicy: input.cleanupPolicy,
      ownerRunID: input.ownerRunID,
      ownerSessionID: input.ownerSessionID,
      ownerType: input.ownerType,
    })
    if (!worktree) throw new ApiError(404, "PROJECT_NOT_FOUND", `Project '${projectID}' not found`)
    return worktree
  })
}

export async function refreshProjectWorktree(projectID: string, worktreeID: string) {
  safeReadProject(projectID)
  return runProjectWorktreeOperation(async () => {
    const worktree = await Project.refreshWorktree(projectID, worktreeID)
    if (!worktree) {
      throw new ApiError(404, "WORKTREE_NOT_FOUND", `Worktree '${worktreeID}' not found`)
    }
    return worktree
  })
}

export async function deleteProjectWorktree(
  projectID: string,
  worktreeID: string,
  input: z.infer<typeof DeleteProjectWorktreeBody>,
) {
  safeReadProject(projectID)
  return runProjectWorktreeOperation(async () => {
    const worktree = await Project.removeManagedWorktree(projectID, worktreeID, input)
    if (!worktree) {
      throw new ApiError(404, "WORKTREE_NOT_FOUND", `Worktree '${worktreeID}' not found`)
    }
    return worktree
  })
}

export async function createProjectSession(
  projectID: string,
  input: z.infer<typeof CreateProjectSessionBody>,
) {
  const project = safeReadProject(projectID)

  let directory = input.directory?.trim() || Project.getRepositoryRoot(project)
  if (input.directory) {
    const resolved = await Project.fromDirectory(directory)
    if (resolved.project.id !== projectID) {
      throw new ApiError(400, "DIRECTORY_NOT_IN_PROJECT", `Directory '${directory}' does not belong to project '${projectID}'`)
    }
    directory = input.directory.trim()
  }

  Project.listWorktrees(projectID)
  const session = await Session.createSession({
    directory,
    projectID,
    title: input.title?.trim() || undefined,
  })

  return mapSessionSummary(session)
}

export async function listProjectProviderCatalog(projectID: string) {
  safeReadProject(projectID)
  return Provider.catalog(projectID)
}

export async function listProjectProviders(projectID: string) {
  safeReadProject(projectID)
  return {
    items: await Provider.listPublicProviders(projectID),
    selection: await Provider.getSelection(projectID),
  }
}

export async function listProjectModels(projectID: string) {
  safeReadProject(projectID)

  const items = await listProjectModelsWithFallback(projectID)
  const selection = await resolveProjectModelSelectionWithGlobalFallback(projectID, items)

  return {
    effectiveModel: await resolveEffectiveModelWithFallback(projectID, items, selection.model),
    items,
    selection,
  }
}

export async function listProjectModelCatalog(projectID: string) {
  safeReadProject(projectID)

  return {
    items: await ModelRegistry.listModelCatalog(projectID),
  }
}

export async function updateProjectProvider(
  projectID: string,
  providerID: string,
  input: z.infer<typeof Config.Provider>,
) {
  safeReadProject(projectID)

  try {
    await Provider.validateProviderConfig(providerID, input, projectID)
  } catch (error) {
    throw new ApiError(
      400,
      "PROVIDER_VALIDATION_FAILED",
      error instanceof Error ? error.message : String(error),
    )
  }

  const providerConfig = await Config.setProvider(projectID, providerID, input)
  clearProjectModelListCache(projectID)
  const provider = await Provider.getPublicProvider(providerID, projectID)
  if (!provider) {
    throw new ApiError(404, "PROVIDER_NOT_FOUND", `Provider '${providerID}' not found in the catalog`)
  }

  return {
    provider,
    selection: {
      model: providerConfig.model,
      small_model: providerConfig.small_model,
      reasoning_effort: providerConfig.reasoning_effort,
    },
  }
}

export async function removeProjectProvider(projectID: string, providerID: string) {
  safeReadProject(projectID)
  const providerConfig = await Config.removeProvider(projectID, providerID)
  clearProjectModelListCache(projectID)

  return {
    providerID,
    selection: {
      model: providerConfig.model,
      small_model: providerConfig.small_model,
      reasoning_effort: providerConfig.reasoning_effort,
    },
  }
}

export async function updateProjectModelSelection(
  projectID: string,
  input: z.infer<typeof Config.ModelSelection>,
) {
  safeReadProject(projectID)

  if (input.model) {
    await ModelSelection.resolveSelectableModel(input.model, projectID)
  }

  if (input.small_model) {
    await ModelSelection.resolveSelectableModel(input.small_model, projectID)
  }

  const selection = await Config.setModelSelection(projectID, input)
  return {
    model: selection.model,
    small_model: selection.small_model,
    reasoning_effort: selection.reasoning_effort,
  }
}

export async function refreshProjectProviderCatalog(projectID: string) {
  safeReadProject(projectID)

  try {
    await ModelsDev.refresh()
  } catch (error) {
    throw new ApiError(
      502,
      "PROVIDER_CATALOG_REFRESH_FAILED",
      error instanceof Error ? error.message : String(error),
    )
  }

  clearProjectModelListCache(projectID)
  return Provider.catalog(projectID)
}

export async function getProjectGitCapabilities(
  projectID: string,
  input: z.infer<typeof GitDirectoryQuery>,
) {
  const directory = await resolveProjectGitDirectory(projectID, input.directory, { verifyRepositoryRoot: true })
  return Git.getGitCapabilities(directory, {
    includePullRequestRemoteCheck: input.includePullRequestRemoteCheck === true,
  })
}

export async function commitProjectGitChanges(
  projectID: string,
  input: z.infer<typeof GitCommitBody>,
) {
  return runProjectGitOperation(async () => {
    const directory = await resolveProjectGitDirectory(projectID, input.directory, { verifyRepositoryRoot: true })
    return Git.commitGitChanges(directory, input.message, {
      stageAll: input.stageAll,
    })
  })
}

async function resolveProjectCommitMessageModel(projectID: string) {
  const items = await listProjectModelsWithFallback(projectID)
  const selection = await resolveProjectModelSelectionWithGlobalFallback(projectID, items)
  const publicModel = await resolveEffectiveModelWithFallback(projectID, items, selection.small_model ?? selection.model)

  if (!publicModel) {
    throw new ApiError(
      400,
      "MODEL_UNAVAILABLE",
      "No provider model is available for this project. Configure a provider/model before generating commit messages.",
    )
  }

  const model = await ModelRegistry.getAISDKModel(publicModel.providerID, publicModel.id, projectID)
  if (!model.capabilities.output.text) {
    throw new ApiError(
      400,
      "MODEL_NOT_TEXT_CAPABLE",
      `${model.providerID}/${model.id} does not support text output.`,
    )
  }

  return model
}

export async function generateProjectGitCommitMessage(
  projectID: string,
  input: z.infer<typeof GitCommitMessageBody>,
) {
  return runProjectGitCommitMessageOperation(async () => {
    const directory = await resolveProjectGitDirectory(projectID, input.directory, { verifyRepositoryRoot: true })
    return Instance.provide({
      directory,
      fn: async () => {
        const context = await Git.buildGitCommitMessageContext(directory, {
          stageAll: input.stageAll,
        })
        const selection = await PromptPresets.getPromptPresetSelection(Config.GLOBAL_CONFIG_ID)
        const systemPrompt = await PromptPresets.getResolvedPromptPresetContent(
          selection.gitCommitPromptPresetID,
          Config.GLOBAL_CONFIG_ID,
        )
        const model = await resolveProjectCommitMessageModel(projectID)
        return GitCommitMessage.generateGitCommitMessage({
          projectID,
          model,
          context,
          systemPrompt,
        })
      },
    })
  })
}

export async function pushProjectGitChanges(
  projectID: string,
  input: z.infer<typeof GitDirectoryBody>,
) {
  return runProjectGitOperation(async () => {
    const directory = await resolveProjectGitDirectory(projectID, input.directory, { verifyRepositoryRoot: true })
    return Git.pushGitChanges(directory)
  })
}

export async function createProjectGitBranch(
  projectID: string,
  input: z.infer<typeof GitCreateBranchBody>,
) {
  return runProjectGitOperation(async () => {
    const directory = await resolveProjectGitDirectory(projectID, input.directory, { verifyRepositoryRoot: true })
    return Git.createGitBranch(directory, input.name)
  })
}

export async function listProjectGitBranches(
  projectID: string,
  input: z.infer<typeof GitDirectoryQuery>,
) {
  return runProjectGitOperation(async () => {
    const directory = await resolveProjectGitDirectory(projectID, input.directory, { verifyRepositoryRoot: true })
    return Git.listGitBranches(directory)
  })
}

export async function checkoutProjectGitBranch(
  projectID: string,
  input: z.infer<typeof GitCheckoutBranchBody>,
) {
  return runProjectGitOperation(async () => {
    const directory = await resolveProjectGitDirectory(projectID, input.directory, { verifyRepositoryRoot: true })
    return Git.checkoutGitBranch(directory, input.name)
  })
}

export async function createProjectGitPullRequest(
  projectID: string,
  input: z.infer<typeof GitDirectoryBody>,
) {
  return runProjectGitOperation(async () => {
    const directory = await resolveProjectGitDirectory(projectID, input.directory, { verifyRepositoryRoot: true })
    return Git.createGitPullRequest(directory)
  })
}

export async function listProjectSkills(projectID: string) {
  const project = safeReadProject(projectID)
  const repositoryRoot = Project.getRepositoryRoot(project)
  if (isSshWorkspaceUri(repositoryRoot)) return []
  return Skill.list(repositoryRoot, {
    pluginIDs: await Config.getSelectedPluginIDs(projectID),
  })
}

export async function getProjectSkillSelection(projectID: string) {
  const project = safeReadProject(projectID)
  const repositoryRoot = Project.getRepositoryRoot(project)
  if (isSshWorkspaceUri(repositoryRoot)) {
    return { skillIDs: [] }
  }
  const pluginIDs = await Config.getSelectedPluginIDs(projectID)
  return {
    skillIDs: await Skill.resolveSelectedSkillIDs(repositoryRoot, await Config.getSelectedSkillIDs(projectID), {
      pluginIDs,
    }),
  }
}

export async function updateProjectSkillSelection(
  projectID: string,
  input: z.infer<typeof UpdateProjectSkillSelectionBody>,
) {
  const project = safeReadProject(projectID)
  const repositoryRoot = Project.getRepositoryRoot(project)
  if (isSshWorkspaceUri(repositoryRoot)) {
    const config = await Config.setSelectedSkillIDs(projectID, [])
    return { skillIDs: config.selected_skills ?? [] }
  }
  const pluginIDs = await Config.getSelectedPluginIDs(projectID)
  const skillIDs = await Skill.resolveSelectedSkillIDs(repositoryRoot, input.skillIDs, {
    pluginIDs,
  })
  const config = await Config.setSelectedSkillIDs(projectID, skillIDs)

  return {
    skillIDs: config.selected_skills ?? [],
  }
}

export async function listProjectPlugins(projectID: string) {
  safeReadProject(projectID)
  return Plugin.listEnabledInstalled()
}

export async function getProjectPluginSelection(projectID: string) {
  safeReadProject(projectID)
  return {
    pluginIDs: Plugin.resolveEnabledInstalledPluginIDs(await Config.getSelectedPluginIDs(projectID)),
  }
}

export async function updateProjectPluginSelection(
  projectID: string,
  input: z.infer<typeof UpdateProjectPluginSelectionBody>,
) {
  safeReadProject(projectID)
  const pluginIDs = Plugin.resolveEnabledInstalledPluginIDs(input.pluginIDs)
  const config = await Config.setSelectedPluginIDs(projectID, pluginIDs)

  return {
    pluginIDs: config.selected_plugins ?? [],
  }
}

export async function getProjectMcpSelection(projectID: string) {
  safeReadProject(projectID)
  return {
    serverIDs: await Config.getSelectedMcpServerIDs(projectID),
  }
}

export async function updateProjectMcpSelection(
  projectID: string,
  input: z.infer<typeof UpdateProjectMcpSelectionBody>,
) {
  safeReadProject(projectID)
  const config = await Config.setSelectedMcpServerIDs(projectID, input.serverIDs)

  return {
    serverIDs: config.selected_mcp_servers ?? [],
  }
}

export async function listProjectMcpServers(projectID: string) {
  safeReadProject(projectID)
  return Config.resolveProjectMcpServers(projectID)
}

export async function getProjectMcpServerDiagnostic(projectID: string, serverID: string) {
  const project = safeReadProject(projectID)

  const server = await Config.getProjectMcpServer(projectID, serverID)
  if (!server) {
    throw new ApiError(404, "MCP_SERVER_NOT_FOUND", `MCP server '${serverID}' is not available for project '${projectID}'`)
  }

  return Instance.provide({
    directory: Project.getRepositoryRoot(project),
    fn: async () => await Mcp.diagnose(serverID),
  })
}

export async function updateProjectMcpServer(
  projectID: string,
  serverID: string,
  input: z.infer<typeof UpdateMcpServerBody>,
) {
  safeReadProject(projectID)
  return Config.setMcpServer(projectID, serverID, input)
}

export async function removeProjectMcpServer(projectID: string, serverID: string) {
  safeReadProject(projectID)
  return {
    serverID,
    removed: Boolean(await Config.removeMcpServer(projectID, serverID)),
  }
}

export function deleteProject(projectID: string, options?: { ptyRegistry?: PtyRegistry }) {
  safeReadProject(projectID)

  const deletedSessions = Session.removeProjectSessions(projectID)
  for (const session of deletedSessions) {
    options?.ptyRegistry?.deleteBySession(session.id)
  }
  db.deleteById("projects", projectID)
  db.deleteById("project_configs", projectID, "projectID")
  if (db.tableExists("permission_requests")) {
    db.deleteMany("permission_requests", [{ column: "projectID", value: projectID }])
  }
  if (db.tableExists("permission_audits")) {
    db.deleteMany("permission_audits", [{ column: "projectID", value: projectID }])
  }
  Project.removeWorktrees(projectID)

  return {
    projectID,
    deletedSessionIDs: deletedSessions.map((session) => session.id),
  }
}

export function getProject(projectID: string) {
  return safeReadProject(projectID)
}
