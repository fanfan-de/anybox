type DesktopBridge = NonNullable<Window["desktop"]>
type GitGetCapabilities = NonNullable<DesktopBridge["gitGetCapabilities"]>
type GitCommit = NonNullable<DesktopBridge["gitCommit"]>
type GitGenerateCommitMessage = NonNullable<DesktopBridge["gitGenerateCommitMessage"]>
type GitPush = NonNullable<DesktopBridge["gitPush"]>
type GitCreateBranch = NonNullable<DesktopBridge["gitCreateBranch"]>
type GitListBranches = NonNullable<DesktopBridge["gitListBranches"]>
type GitCheckoutBranch = NonNullable<DesktopBridge["gitCheckoutBranch"]>
type GitCreatePullRequest = NonNullable<DesktopBridge["gitCreatePullRequest"]>

export type GitCapabilitiesState = Awaited<ReturnType<GitGetCapabilities>>
export type GitBranchSummary = Awaited<ReturnType<GitListBranches>>[number]

const GIT_CAPABILITIES_CACHE_MS = 1000

const gitCapabilitiesCache = new Map<string, { expiresAt: number; value: GitCapabilitiesState }>()
const gitCapabilitiesRequests = new Map<string, Promise<GitCapabilitiesState>>()
let activeGitGetCapabilities: GitGetCapabilities | null = null
let gitCapabilitiesCacheGeneration = 0

function unavailableError(action: string) {
  return new Error("Git " + action + " is unavailable in this desktop shell.")
}

function normalizeDirectory(value: string) {
  return value.trim().replace(/\//g, "\\").toLowerCase()
}

function getCapabilitiesCachePrefix(input: { projectID: string; directory: string }) {
  return `${input.projectID.trim()}\0${normalizeDirectory(input.directory)}\0`
}

function getCapabilitiesCacheKey(input: Parameters<GitGetCapabilities>[0]) {
  return `${getCapabilitiesCachePrefix(input)}${input.includePullRequestRemoteCheck === true ? "remote" : "local"}`
}

function syncGitCapabilitiesClient(gitGetCapabilities: GitGetCapabilities) {
  if (activeGitGetCapabilities === gitGetCapabilities) return
  activeGitGetCapabilities = gitGetCapabilities
  gitCapabilitiesCacheGeneration += 1
  gitCapabilitiesCache.clear()
  gitCapabilitiesRequests.clear()
}

export function invalidateGitCapabilities(input?: { projectID?: string; directory?: string }) {
  gitCapabilitiesCacheGeneration += 1
  if (!input?.projectID || !input.directory) {
    gitCapabilitiesCache.clear()
    gitCapabilitiesRequests.clear()
    return
  }

  const prefix = getCapabilitiesCachePrefix({
    projectID: input.projectID,
    directory: input.directory,
  })
  for (const key of gitCapabilitiesCache.keys()) {
    if (key.startsWith(prefix)) {
      gitCapabilitiesCache.delete(key)
    }
  }
  for (const key of gitCapabilitiesRequests.keys()) {
    if (key.startsWith(prefix)) {
      gitCapabilitiesRequests.delete(key)
    }
  }
}

export function hasGitQuickMenuClient() {
  return Boolean(window.desktop?.gitGetCapabilities)
}

export async function getGitCapabilities(input: Parameters<GitGetCapabilities>[0], options?: { bypassCache?: boolean }) {
  const gitGetCapabilities = window.desktop?.gitGetCapabilities
  if (!gitGetCapabilities) throw unavailableError("status")
  syncGitCapabilitiesClient(gitGetCapabilities)

  const key = getCapabilitiesCacheKey(input)
  const canUseCache = options?.bypassCache !== true && input.includePullRequestRemoteCheck !== true
  if (canUseCache) {
    const cached = gitCapabilitiesCache.get(key)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }
  }

  const pendingRequest = gitCapabilitiesRequests.get(key)
  if (pendingRequest) {
    return pendingRequest
  }

  const requestGeneration = gitCapabilitiesCacheGeneration
  const request = gitGetCapabilities(input)
    .then((value) => {
      if (input.includePullRequestRemoteCheck !== true && requestGeneration === gitCapabilitiesCacheGeneration) {
        gitCapabilitiesCache.set(key, {
          expiresAt: Date.now() + GIT_CAPABILITIES_CACHE_MS,
          value,
        })
      }
      return value
    })
    .finally(() => {
      if (gitCapabilitiesRequests.get(key) === request) {
        gitCapabilitiesRequests.delete(key)
      }
    })
  gitCapabilitiesRequests.set(key, request)
  return request
}

export async function commitGit(input: Parameters<GitCommit>[0]) {
  const gitCommit = window.desktop?.gitCommit
  if (!gitCommit) throw unavailableError("commit")
  const result = await gitCommit(input)
  invalidateGitCapabilities(input)
  return result
}

export async function generateGitCommitMessage(input: Parameters<GitGenerateCommitMessage>[0]) {
  const gitGenerateCommitMessage = window.desktop?.gitGenerateCommitMessage
  if (!gitGenerateCommitMessage) throw unavailableError("commit message generation")
  return gitGenerateCommitMessage(input)
}

export async function pushGit(input: Parameters<GitPush>[0]) {
  const gitPush = window.desktop?.gitPush
  if (!gitPush) throw unavailableError("push")
  const result = await gitPush(input)
  invalidateGitCapabilities(input)
  return result
}

export async function createGitBranch(input: Parameters<GitCreateBranch>[0]) {
  const gitCreateBranch = window.desktop?.gitCreateBranch
  if (!gitCreateBranch) throw unavailableError("branch creation")
  const result = await gitCreateBranch(input)
  invalidateGitCapabilities(input)
  return result
}

export async function listGitBranches(input: Parameters<GitListBranches>[0]) {
  const gitListBranches = window.desktop?.gitListBranches
  if (!gitListBranches) throw unavailableError("branch listing")
  return gitListBranches(input)
}

export async function checkoutGitBranch(input: Parameters<GitCheckoutBranch>[0]) {
  const gitCheckoutBranch = window.desktop?.gitCheckoutBranch
  if (!gitCheckoutBranch) throw unavailableError("branch checkout")
  const result = await gitCheckoutBranch(input)
  invalidateGitCapabilities(input)
  return result
}

export async function createGitPullRequest(input: Parameters<GitCreatePullRequest>[0]) {
  const gitCreatePullRequest = window.desktop?.gitCreatePullRequest
  if (!gitCreatePullRequest) throw unavailableError("pull request creation")
  const result = await gitCreatePullRequest(input)
  invalidateGitCapabilities(input)
  return result
}
