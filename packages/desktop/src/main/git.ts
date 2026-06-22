import { requestAgentJSON } from "./agent-client"

export interface GitCapabilityState {
  enabled: boolean
  reason?: string
}

export interface GitCapabilities {
  directory: string
  root: string | null
  branch: string | null
  defaultBranch: string | null
  isGitRepo: boolean
  canCommit: GitCapabilityState
  canStageAllCommit: GitCapabilityState
  canPush: GitCapabilityState
  canCreatePullRequest: GitCapabilityState
  canCreateBranch: GitCapabilityState
}

export interface GitGetCapabilitiesInput {
  projectID: string
  directory: string
  includePullRequestRemoteCheck?: boolean
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

export interface GitCommitMessageResult {
  message: string
}

export interface GitBranchSummary {
  name: string
  kind: "local" | "remote"
  current: boolean
}

function encodeProjectPath(projectID: string, suffix: string) {
  return `/api/projects/${encodeURIComponent(projectID)}/git/${suffix}`
}

export async function getGitCapabilities(input: GitGetCapabilitiesInput): Promise<GitCapabilities> {
  const params = new URLSearchParams({
    directory: input.directory.trim(),
  })
  if (input.includePullRequestRemoteCheck === true) {
    params.set("includePullRequestRemoteCheck", "true")
  }

  const pathname = encodeProjectPath(input.projectID.trim(), `capabilities?${params.toString()}`)
  const response = await requestAgentJSON<GitCapabilities>(pathname)
  return response.data
}

export async function commitGitChanges(input: {
  projectID: string
  directory: string
  message: string
  stageAll?: boolean
}): Promise<GitActionResult> {
  const response = await requestAgentJSON<GitActionResult>(encodeProjectPath(input.projectID.trim(), "commit"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      directory: input.directory.trim(),
      message: input.message,
      ...(input.stageAll ? { stageAll: true } : {}),
    }),
  })

  return response.data
}

export async function generateGitCommitMessage(input: {
  projectID: string
  directory: string
  stageAll?: boolean
}): Promise<GitCommitMessageResult> {
  const response = await requestAgentJSON<GitCommitMessageResult>(encodeProjectPath(input.projectID.trim(), "commit-message"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      directory: input.directory.trim(),
      ...(input.stageAll ? { stageAll: true } : {}),
    }),
  })

  return response.data
}

export async function pushGitChanges(input: { projectID: string; directory: string }): Promise<GitActionResult> {
  const response = await requestAgentJSON<GitActionResult>(encodeProjectPath(input.projectID.trim(), "push"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      directory: input.directory.trim(),
    }),
  })

  return response.data
}

export async function createGitBranch(input: { projectID: string; directory: string; name: string }): Promise<GitActionResult> {
  const response = await requestAgentJSON<GitActionResult>(encodeProjectPath(input.projectID.trim(), "branches"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      directory: input.directory.trim(),
      name: input.name,
    }),
  })

  return response.data
}

export async function listGitBranches(input: { projectID: string; directory: string }): Promise<GitBranchSummary[]> {
  const pathname = encodeProjectPath(
    input.projectID.trim(),
    `branches?directory=${encodeURIComponent(input.directory.trim())}`,
  )
  const response = await requestAgentJSON<GitBranchSummary[]>(pathname)
  return response.data
}

export async function checkoutGitBranch(input: {
  projectID: string
  directory: string
  name: string
}): Promise<GitActionResult> {
  const response = await requestAgentJSON<GitActionResult>(encodeProjectPath(input.projectID.trim(), "checkout"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      directory: input.directory.trim(),
      name: input.name,
    }),
  })

  return response.data
}

export async function createGitPullRequest(input: { projectID: string; directory: string }): Promise<GitActionResult> {
  const response = await requestAgentJSON<GitActionResult>(encodeProjectPath(input.projectID.trim(), "pull-requests"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      directory: input.directory.trim(),
    }),
  })

  return response.data
}
