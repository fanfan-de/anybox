import path from "node:path"

const GIT_BINARY_NAMES = process.platform === "win32" ? ["git.exe", "git"] : ["git"]
const GH_BINARY_NAMES = process.platform === "win32" ? ["gh.exe", "gh"] : ["gh"]

export interface GitCapability {
  enabled: boolean
  reason?: string
}

export interface GitCapabilities {
  directory: string
  root: string | null
  branch: string | null
  defaultBranch: string | null
  isGitRepo: boolean
  canCommit: GitCapability
  canStageAllCommit: GitCapability
  canPush: GitCapability
  canCreatePullRequest: GitCapability
  canCreateBranch: GitCapability
}

export interface GitBranchSummary {
  name: string
  kind: "local" | "remote"
  current: boolean
}

export interface GitActionResult {
  directory: string
  root: string
  branch: string | null
  stdout: string
  stderr: string
  summary: string
  url?: string
}

export interface GitCommitMessageContext {
  directory: string
  root: string
  stageAll: boolean
  content: string
  truncated: boolean
}

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

interface RunCommandOptions {
  disableOptionalLocks?: boolean
}

export interface GitCapabilitiesOptions {
  includePullRequestRemoteCheck?: boolean
}

const COMMIT_MESSAGE_CONTEXT_MAX_CHARS = 20_000
const COMMIT_MESSAGE_CONTEXT_TRUNCATION_MARKER = "\n[diff context truncated]"

function resolveCommandBinary(names: string[]) {
  for (const name of names) {
    const resolved = Bun.which(name)
    if (resolved) return resolved
  }

  return null
}

function trimCommandOutput(value: string) {
  return value.replace(/\r\n/g, "\n").trim()
}

async function runCommand(binary: string, args: string[], cwd: string, options?: RunCommandOptions): Promise<CommandResult> {
  const proc = Bun.spawn([binary, ...args], {
    cwd,
    env: options?.disableOptionalLocks === true ? { ...process.env, GIT_OPTIONAL_LOCKS: "0" } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return {
    stdout: trimCommandOutput(stdout),
    stderr: trimCommandOutput(stderr),
    exitCode,
  }
}

function buildCommandError(result: CommandResult, fallback: string) {
  return new Error(result.stderr || result.stdout || fallback)
}

async function runCommandOrThrow(binary: string, args: string[], cwd: string, fallback: string) {
  const result = await runCommand(binary, args, cwd)
  if (result.exitCode !== 0) {
    throw buildCommandError(result, fallback)
  }

  return result
}

function requireDirectory(directory: string) {
  const trimmed = directory.trim()
  if (!trimmed) {
    throw new Error("A Git working directory is required.")
  }

  return path.resolve(trimmed)
}

function requireGitBinary() {
  const git = resolveCommandBinary(GIT_BINARY_NAMES)
  if (!git) {
    throw new Error("Git is not installed.")
  }

  return git
}

function requireGhBinary() {
  const gh = resolveCommandBinary(GH_BINARY_NAMES)
  if (!gh) {
    throw new Error("GitHub CLI is not installed.")
  }

  return gh
}

function parseBranchName(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed === "HEAD") return null
  return trimmed
}

function parseDefaultBranch(ref: string) {
  const trimmed = ref.trim()
  if (!trimmed) return null
  const segments = trimmed.split("/")
  return segments[segments.length - 1] || null
}

function parseAheadBehind(value: string) {
  const [behindRaw = "0", aheadRaw = "0"] = value.trim().split(/\s+/)
  const behind = Number.parseInt(behindRaw, 10)
  const ahead = Number.parseInt(aheadRaw, 10)

  return {
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
  }
}

function emptyCapabilities(directory: string, reason: string): GitCapabilities {
  return {
    directory,
    root: null,
    branch: null,
    defaultBranch: null,
    isGitRepo: false,
    canCommit: { enabled: false, reason },
    canStageAllCommit: { enabled: false, reason },
    canPush: { enabled: false, reason },
    canCreatePullRequest: { enabled: false, reason },
    canCreateBranch: { enabled: false, reason },
  }
}

async function resolveGitRoot(directory: string, gitBinary: string) {
  const result = await runCommand(gitBinary, ["rev-parse", "--show-toplevel"], directory)
  if (result.exitCode !== 0 || !result.stdout) return null
  return path.resolve(result.stdout)
}

async function resolveCurrentBranch(directory: string, gitBinary: string) {
  const symbolicResult = await runCommand(gitBinary, ["symbolic-ref", "--quiet", "--short", "HEAD"], directory)
  if (symbolicResult.exitCode === 0 && symbolicResult.stdout) {
    return parseBranchName(symbolicResult.stdout)
  }

  const result = await runCommand(gitBinary, ["rev-parse", "--abbrev-ref", "HEAD"], directory)
  if (result.exitCode !== 0) return null
  return parseBranchName(result.stdout)
}

async function resolveHeadCommit(directory: string, gitBinary: string) {
  const result = await runCommand(gitBinary, ["rev-parse", "--verify", "HEAD"], directory)
  return result.exitCode === 0 && Boolean(result.stdout)
}

function parseBranchList(stdout: string) {
  return stdout
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseRemoteBranchList(stdout: string) {
  return parseBranchList(stdout)
    .filter((name) => !isRemoteHeadReference(name))
    .map((name) => name.replace(/^refs\/remotes\//, ""))
    .filter(Boolean)
}

function isRemoteHeadReference(name: string) {
  return /\/HEAD$/.test(name)
}

function resolveRemoteLocalBranchName(name: string) {
  const [, ...segments] = name.split("/")
  return segments.join("/")
}

function sortGitBranches(left: GitBranchSummary, right: GitBranchSummary) {
  if (left.current !== right.current) return left.current ? -1 : 1
  if (left.kind !== right.kind) return left.kind === "local" ? -1 : 1
  return left.name.localeCompare(right.name)
}

async function resolveUpstream(directory: string, gitBinary: string) {
  const result = await runCommand(gitBinary, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], directory)
  if (result.exitCode !== 0 || !result.stdout) return null
  return result.stdout
}

async function resolveRemoteName(directory: string, gitBinary: string, upstream: string | null) {
  if (upstream) {
    const [remoteName] = upstream.split("/")
    if (remoteName) return remoteName
  }

  const remotes = await runCommand(gitBinary, ["remote"], directory)
  if (remotes.exitCode !== 0 || !remotes.stdout) return null
  return remotes.stdout.split("\n").map((item) => item.trim()).find(Boolean) ?? null
}

async function resolveRemoteUrl(directory: string, gitBinary: string, remoteName: string | null) {
  if (!remoteName) return null
  const result = await runCommand(gitBinary, ["remote", "get-url", remoteName], directory)
  if (result.exitCode !== 0 || !result.stdout) return null
  return result.stdout
}

async function resolveDefaultBranch(directory: string, gitBinary: string, remoteName: string | null) {
  if (!remoteName) return null
  const result = await runCommand(gitBinary, ["symbolic-ref", "--short", `refs/remotes/${remoteName}/HEAD`], directory)
  if (result.exitCode !== 0 || !result.stdout) return null
  return parseDefaultBranch(result.stdout)
}

async function resolveAheadBehind(directory: string, gitBinary: string, hasUpstream: boolean) {
  if (!hasUpstream) {
    return { ahead: 0, behind: 0 }
  }

  const result = await runCommand(gitBinary, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], directory)
  if (result.exitCode !== 0 || !result.stdout) {
    return { ahead: 0, behind: 0 }
  }

  return parseAheadBehind(result.stdout)
}

async function canAccessGhRepository(directory: string, ghBinary: string) {
  const result = await runCommand(ghBinary, ["repo", "view", "--json", "url"], directory)
  return result.exitCode === 0
}

async function findOpenPullRequestUrl(directory: string, ghBinary: string, branch: string | null) {
  if (!branch) return null

  const result = await runCommand(ghBinary, ["pr", "list", "--head", branch, "--state", "open", "--json", "url"], directory)
  if (result.exitCode !== 0 || !result.stdout) return null

  try {
    const parsed = JSON.parse(result.stdout) as Array<{ url?: string }>
    const url = parsed.find((item) => typeof item.url === "string" && item.url.trim())?.url?.trim()
    return url || null
  } catch {
    return null
  }
}

function extractUrl(value: string) {
  const match = value.match(/https?:\/\/\S+/)
  return match?.[0] ?? undefined
}

async function inspectStagedChanges(directory: string, gitBinary: string) {
  return runCommand(gitBinary, ["diff", "--cached", "--name-only"], directory, {
    disableOptionalLocks: true,
  })
}

async function inspectWorktreeStatus(directory: string, gitBinary: string) {
  return runCommand(gitBinary, ["status", "--porcelain"], directory, {
    disableOptionalLocks: true,
  })
}

function appendCommitMessageContextSection(lines: string[], title: string, value: string) {
  lines.push(`## ${title}`)
  lines.push(value.trim() || "(none)")
  lines.push("")
}

function limitCommitMessageContext(content: string) {
  const chars = [...content.trim()]
  if (chars.length <= COMMIT_MESSAGE_CONTEXT_MAX_CHARS) {
    return {
      content: content.trim(),
      truncated: false,
    }
  }

  const maxContentChars = Math.max(0, COMMIT_MESSAGE_CONTEXT_MAX_CHARS - [...COMMIT_MESSAGE_CONTEXT_TRUNCATION_MARKER].length)
  return {
    content: chars.slice(0, maxContentChars).join("").trimEnd() + COMMIT_MESSAGE_CONTEXT_TRUNCATION_MARKER,
    truncated: true,
  }
}

export async function buildGitCommitMessageContext(
  directory: string,
  options?: {
    stageAll?: boolean
  },
): Promise<GitCommitMessageContext> {
  const gitBinary = requireGitBinary()
  const targetDirectory = requireDirectory(directory)
  const stageAll = options?.stageAll === true

  const root = await resolveGitRoot(targetDirectory, gitBinary)
  if (!root) {
    throw new Error("The current workspace is not a Git repository.")
  }

  const stagedStat = await runCommandOrThrow(gitBinary, ["diff", "--cached", "--stat"], targetDirectory, "Failed to inspect staged changes.")
  const stagedDiff = await runCommandOrThrow(gitBinary, ["diff", "--cached"], targetDirectory, "Failed to inspect staged changes.")
  let hasChanges = Boolean(stagedStat.stdout || stagedDiff.stdout)

  let status: CommandResult | null = null
  let unstagedStat: CommandResult | null = null
  let unstagedDiff: CommandResult | null = null

  if (stageAll) {
    status = await runCommandOrThrow(gitBinary, ["status", "--porcelain"], targetDirectory, "Failed to inspect local changes.")
    unstagedStat = await runCommandOrThrow(gitBinary, ["diff", "--stat"], targetDirectory, "Failed to inspect unstaged changes.")
    unstagedDiff = await runCommandOrThrow(gitBinary, ["diff"], targetDirectory, "Failed to inspect unstaged changes.")
    hasChanges ||= Boolean(status.stdout || unstagedStat.stdout || unstagedDiff.stdout)
  }

  if (!hasChanges) {
    throw new Error(stageAll ? "There are no local changes to summarize." : "There are no staged changes to summarize.")
  }

  const lines = [
    "Generate a Git commit subject for the following changes.",
    `Repository root: ${root}`,
    `Scope: ${stageAll ? "staged and unstaged local changes" : "staged changes only"}`,
    "",
  ]
  appendCommitMessageContextSection(lines, "Staged diffstat", stagedStat.stdout)
  appendCommitMessageContextSection(lines, "Staged patch", stagedDiff.stdout)

  if (stageAll) {
    appendCommitMessageContextSection(lines, "Unstaged and untracked status", status?.stdout ?? "")
    appendCommitMessageContextSection(lines, "Unstaged diffstat", unstagedStat?.stdout ?? "")
    appendCommitMessageContextSection(lines, "Unstaged patch", unstagedDiff?.stdout ?? "")
  }

  const limited = limitCommitMessageContext(lines.join("\n"))
  return {
    directory: targetDirectory,
    root,
    stageAll,
    content: limited.content,
    truncated: limited.truncated,
  }
}

function resolveLocalPullRequestCapability(input: {
  branch: string | null
  defaultBranch: string | null
  hasHeadCommit: boolean
  hasUpstream: boolean
}): GitCapability {
  if (!input.branch) {
    return { enabled: false, reason: "The current worktree is on a detached HEAD." }
  }
  if (!input.hasHeadCommit) {
    return { enabled: false, reason: "Create the first commit before opening a pull request." }
  }
  if (!input.hasUpstream) {
    return { enabled: false, reason: "Push the current branch before creating a pull request." }
  }
  if (input.defaultBranch && input.branch === input.defaultBranch) {
    return { enabled: false, reason: "Switch to a feature branch before creating a pull request." }
  }

  return { enabled: true }
}

async function resolveRemotePullRequestCapability(
  directory: string,
  branch: string | null,
  localCapability: GitCapability,
): Promise<GitCapability> {
  if (!localCapability.enabled) return localCapability

  const ghBinary = resolveCommandBinary(GH_BINARY_NAMES)
  if (!ghBinary) {
    return { enabled: false, reason: "GitHub CLI is not installed." }
  }
  if (!await canAccessGhRepository(directory, ghBinary)) {
    return {
      enabled: false,
      reason: "GitHub CLI cannot access the current repository.",
    }
  }

  const existingPullRequestUrl = await findOpenPullRequestUrl(directory, ghBinary, branch)
  return existingPullRequestUrl
    ? { enabled: false, reason: "An open pull request already exists for this branch." }
    : { enabled: true }
}

export async function resolveGitRepositoryRoot(directory: string) {
  const targetDirectory = requireDirectory(directory)
  const gitBinary = resolveCommandBinary(GIT_BINARY_NAMES)
  if (!gitBinary) {
    return null
  }

  return resolveGitRoot(targetDirectory, gitBinary)
}

export async function getGitCapabilities(directory: string, options?: GitCapabilitiesOptions): Promise<GitCapabilities> {
  const targetDirectory = requireDirectory(directory)
  const gitBinary = resolveCommandBinary(GIT_BINARY_NAMES)

  if (!gitBinary) {
    return emptyCapabilities(targetDirectory, "Git is not installed.")
  }

  const root = await resolveGitRoot(targetDirectory, gitBinary)
  if (!root) {
    return emptyCapabilities(targetDirectory, "The current workspace is not a Git repository.")
  }

  const branch = await resolveCurrentBranch(targetDirectory, gitBinary)
  const hasHeadCommit = await resolveHeadCommit(targetDirectory, gitBinary)
  const stagedDiff = await inspectStagedChanges(targetDirectory, gitBinary)
  const hasStagedChanges = stagedDiff.exitCode === 0 && Boolean(stagedDiff.stdout)
  const status = await inspectWorktreeStatus(targetDirectory, gitBinary)
  const hasWorktreeChanges = status.exitCode === 0 && Boolean(status.stdout)
  const upstream = await resolveUpstream(targetDirectory, gitBinary)
  const hasUpstream = Boolean(upstream)
  const { ahead } = await resolveAheadBehind(targetDirectory, gitBinary, hasUpstream)
  const remoteName = await resolveRemoteName(targetDirectory, gitBinary, upstream)
  const defaultBranch = await resolveDefaultBranch(targetDirectory, gitBinary, remoteName)

  let canCommit: GitCapability
  if (stagedDiff.exitCode !== 0) {
    canCommit = { enabled: false, reason: "Failed to inspect staged changes." }
  } else if (hasStagedChanges) {
    canCommit = { enabled: true }
  } else {
    canCommit = { enabled: false, reason: "Stage changes before committing." }
  }

  let canStageAllCommit: GitCapability
  if (status.exitCode !== 0) {
    canStageAllCommit = { enabled: false, reason: "Failed to inspect local changes." }
  } else if (hasWorktreeChanges) {
    canStageAllCommit = { enabled: true }
  } else {
    canStageAllCommit = { enabled: false, reason: "There are no local changes to stage and commit." }
  }

  const canPush = !branch
    ? { enabled: false, reason: "The current worktree is on a detached HEAD." }
    : !hasHeadCommit
      ? { enabled: false, reason: "Create the first commit before pushing this branch." }
    : !hasUpstream
      ? { enabled: false, reason: "The current branch does not track a remote branch." }
      : ahead <= 0
        ? { enabled: false, reason: "The current branch has no commits to push." }
        : { enabled: true }

  const canCreateBranch: GitCapability = hasHeadCommit
    ? {
        enabled: true,
      }
    : {
        enabled: false,
        reason: "Create the first commit before creating a branch.",
      }

  const localPullRequestCapability = resolveLocalPullRequestCapability({
    branch,
    defaultBranch,
    hasHeadCommit,
    hasUpstream,
  })
  const canCreatePullRequest = options?.includePullRequestRemoteCheck === true
    ? await resolveRemotePullRequestCapability(targetDirectory, branch, localPullRequestCapability)
    : localPullRequestCapability

  return {
    directory: targetDirectory,
    root,
    branch,
    defaultBranch,
    isGitRepo: true,
    canCommit,
    canStageAllCommit,
    canPush,
    canCreatePullRequest,
    canCreateBranch,
  }
}

export async function listGitBranches(directory: string): Promise<GitBranchSummary[]> {
  const gitBinary = requireGitBinary()
  const targetDirectory = requireDirectory(directory)
  const root = await resolveGitRoot(targetDirectory, gitBinary)

  if (!root) {
    throw new Error("The current workspace is not a Git repository.")
  }

  const currentBranch = await resolveCurrentBranch(targetDirectory, gitBinary)
  const localResult = await runCommandOrThrow(
    gitBinary,
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    targetDirectory,
    "Failed to list local branches.",
  )
  const localBranches = parseBranchList(localResult.stdout)
  if (currentBranch && !localBranches.includes(currentBranch)) {
    localBranches.unshift(currentBranch)
  }
  const localBranchNames = new Set(localBranches)

  const remoteResult = await runCommandOrThrow(
    gitBinary,
    ["for-each-ref", "--format=%(refname)", "refs/remotes"],
    targetDirectory,
    "Failed to list remote branches.",
  )
  const remoteBranches = parseRemoteBranchList(remoteResult.stdout).filter((name) => {
    const localName = resolveRemoteLocalBranchName(name)
    return localName ? !localBranchNames.has(localName) : true
  })

  return [
    ...localBranches.map((name) => ({
      name,
      kind: "local" as const,
      current: name === currentBranch,
    })),
    ...remoteBranches.map((name) => ({
      name,
      kind: "remote" as const,
      current: false,
    })),
  ].sort(sortGitBranches)
}

export async function commitGitChanges(
  directory: string,
  message: string,
  options?: {
    stageAll?: boolean
  },
): Promise<GitActionResult> {
  const gitBinary = requireGitBinary()
  const targetDirectory = requireDirectory(directory)
  const trimmedMessage = message.trim()
  const stageAll = options?.stageAll === true

  if (!trimmedMessage) {
    throw new Error("Enter a commit message.")
  }

  const root = await resolveGitRoot(targetDirectory, gitBinary)
  if (!root) {
    throw new Error("The current workspace is not a Git repository.")
  }

  if (stageAll) {
    await runCommandOrThrow(gitBinary, ["add", "-A"], targetDirectory, "Failed to stage changes.")
  }

  const stagedDiff = await inspectStagedChanges(targetDirectory, gitBinary)
  if (stagedDiff.exitCode !== 0) {
    throw buildCommandError(stagedDiff, "Failed to inspect staged changes.")
  }
  if (!stagedDiff.stdout) {
    throw new Error(stageAll ? "There are no local changes to stage and commit." : "There are no staged changes to commit.")
  }

  const result = await runCommandOrThrow(gitBinary, ["commit", "-m", trimmedMessage], targetDirectory, "Git commit failed.")
  const branch = await resolveCurrentBranch(targetDirectory, gitBinary)

  return {
    directory: targetDirectory,
    root,
    branch,
    stdout: result.stdout,
    stderr: result.stderr,
    summary: branch ? `Committed to ${branch}.` : "Committed changes.",
  }
}

export async function pushGitChanges(directory: string): Promise<GitActionResult> {
  const gitBinary = requireGitBinary()
  const targetDirectory = requireDirectory(directory)
  const capabilities = await getGitCapabilities(targetDirectory)

  if (!capabilities.isGitRepo || !capabilities.root) {
    throw new Error("The current workspace is not a Git repository.")
  }
  if (!capabilities.canPush.enabled) {
    throw new Error(capabilities.canPush.reason || "The current branch cannot be pushed.")
  }

  const result = await runCommandOrThrow(gitBinary, ["push"], targetDirectory, "Git push failed.")

  return {
    directory: targetDirectory,
    root: capabilities.root,
    branch: capabilities.branch,
    stdout: result.stdout,
    stderr: result.stderr,
    summary: capabilities.branch ? `Pushed ${capabilities.branch}.` : "Pushed changes.",
  }
}

export async function createGitBranch(directory: string, name: string): Promise<GitActionResult> {
  const gitBinary = requireGitBinary()
  const targetDirectory = requireDirectory(directory)
  const trimmedName = name.trim()

  if (!trimmedName) {
    throw new Error("Enter a branch name.")
  }

  const root = await resolveGitRoot(targetDirectory, gitBinary)
  if (!root) {
    throw new Error("The current workspace is not a Git repository.")
  }
  if (!await resolveHeadCommit(targetDirectory, gitBinary)) {
    throw new Error("Create the first commit before creating a branch.")
  }

  const isValidBranch = await runCommand(gitBinary, ["check-ref-format", "--branch", trimmedName], targetDirectory)
  if (isValidBranch.exitCode !== 0) {
    throw new Error("Enter a valid branch name.")
  }

  const existingBranch = await runCommand(gitBinary, ["show-ref", "--verify", "--quiet", `refs/heads/${trimmedName}`], targetDirectory)
  if (existingBranch.exitCode === 0) {
    throw new Error(`Branch '${trimmedName}' already exists.`)
  }

  let result = await runCommand(gitBinary, ["switch", "-c", trimmedName], targetDirectory)
  if (result.exitCode !== 0) {
    result = await runCommand(gitBinary, ["checkout", "-b", trimmedName], targetDirectory)
  }
  if (result.exitCode !== 0) {
    throw buildCommandError(result, "Failed to create the branch.")
  }

  return {
    directory: targetDirectory,
    root,
    branch: trimmedName,
    stdout: result.stdout,
    stderr: result.stderr,
    summary: `Created and switched to ${trimmedName}.`,
  }
}

export async function checkoutGitBranch(directory: string, name: string): Promise<GitActionResult> {
  const gitBinary = requireGitBinary()
  const targetDirectory = requireDirectory(directory)
  const trimmedName = name.trim()

  if (!trimmedName) {
    throw new Error("Select a branch.")
  }

  const root = await resolveGitRoot(targetDirectory, gitBinary)
  if (!root) {
    throw new Error("The current workspace is not a Git repository.")
  }

  const branches = await listGitBranches(targetDirectory)
  const targetBranch = branches.find((branch) => branch.name === trimmedName)
  if (!targetBranch) {
    throw new Error(`Branch '${trimmedName}' was not found.`)
  }

  if (targetBranch.current) {
    return {
      directory: targetDirectory,
      root,
      branch: trimmedName,
      stdout: "",
      stderr: "",
      summary: `Already on ${trimmedName}.`,
    }
  }

  let result: CommandResult
  if (targetBranch.kind === "local") {
    result = await runCommand(gitBinary, ["switch", trimmedName], targetDirectory)
    if (result.exitCode !== 0) {
      result = await runCommand(gitBinary, ["checkout", trimmedName], targetDirectory)
    }
  } else {
    result = await runCommand(gitBinary, ["switch", "--track", trimmedName], targetDirectory)
    if (result.exitCode !== 0) {
      result = await runCommand(gitBinary, ["checkout", "--track", trimmedName], targetDirectory)
    }
  }

  if (result.exitCode !== 0) {
    throw buildCommandError(result, "Failed to switch branches.")
  }

  const branch = await resolveCurrentBranch(targetDirectory, gitBinary)

  return {
    directory: targetDirectory,
    root,
    branch,
    stdout: result.stdout,
    stderr: result.stderr,
    summary: branch ? `Switched to ${branch}.` : "Switched branches.",
  }
}

export async function createGitPullRequest(directory: string): Promise<GitActionResult> {
  const targetDirectory = requireDirectory(directory)
  const capabilities = await getGitCapabilities(targetDirectory, {
    includePullRequestRemoteCheck: true,
  })

  if (!capabilities.isGitRepo || !capabilities.root) {
    throw new Error("The current workspace is not a Git repository.")
  }
  if (!capabilities.canCreatePullRequest.enabled) {
    throw new Error(capabilities.canCreatePullRequest.reason || "A pull request cannot be created right now.")
  }
  if (!capabilities.branch) {
    throw new Error("The current worktree is on a detached HEAD.")
  }

  const ghBinary = requireGhBinary()
  const existingPullRequestUrl = await findOpenPullRequestUrl(targetDirectory, ghBinary, capabilities.branch)
  if (existingPullRequestUrl) {
    throw new Error("An open pull request already exists for this branch.")
  }

  const args = ["pr", "create", "--fill"]
  if (capabilities.defaultBranch) {
    args.push("--base", capabilities.defaultBranch)
  }

  const result = await runCommandOrThrow(ghBinary, args, targetDirectory, "Failed to create the pull request.")
  const url = extractUrl([result.stdout, result.stderr].filter(Boolean).join("\n"))

  return {
    directory: targetDirectory,
    root: capabilities.root,
    branch: capabilities.branch,
    stdout: result.stdout,
    stderr: result.stderr,
    summary: url ? `Created pull request ${url}.` : "Created pull request.",
    ...(url ? { url } : {}),
  }
}
