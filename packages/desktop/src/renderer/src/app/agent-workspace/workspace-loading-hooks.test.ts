import { describe, expect, it, vi } from "vitest"
import type { WorkspaceGroup } from "../types"
import {
  handleWorkspaceFileChange,
  isGitInternalRelativePath,
  shouldRefreshGitStateFromRelativePaths,
  shouldRefreshWorkspaceDiffFromRelativePaths,
} from "./workspace-loading-hooks"

function createWorkspace(): WorkspaceGroup {
  return {
    id: "workspace-1",
    name: "Workspace",
    directory: "C:/work/workspace-1",
    created: 1,
    updated: 1,
    project: {
      id: "project-1",
      name: "Project",
      worktree: "C:/work/workspace-1",
    },
    sessions: [],
  }
}

describe("workspace file change filtering", () => {
  it("recognizes git internals at the workspace root and inside nested repositories", () => {
    expect(isGitInternalRelativePath(".git/index.lock")).toBe(true)
    expect(isGitInternalRelativePath("repo/.git/HEAD")).toBe(true)
    expect(isGitInternalRelativePath("repo\\.git\\refs\\heads\\main")).toBe(true)
    expect(isGitInternalRelativePath("repo/.gitignore")).toBe(false)
    expect(isGitInternalRelativePath("src/App.tsx")).toBe(false)
  })

  it("does not refresh workspace diffs for git internals at any depth", () => {
    expect(shouldRefreshWorkspaceDiffFromRelativePaths([".git/index"])).toBe(false)
    expect(shouldRefreshWorkspaceDiffFromRelativePaths(["repo/.git/index.lock"])).toBe(false)
    expect(shouldRefreshWorkspaceDiffFromRelativePaths(["repo/.git/HEAD", "src/App.tsx"])).toBe(true)
  })

  it("ignores transient git lock noise while preserving meaningful git state refreshes", () => {
    expect(shouldRefreshGitStateFromRelativePaths([".git", ".git/index.lock"])).toBe(false)
    expect(shouldRefreshGitStateFromRelativePaths(["repo/.git", "repo/.git/index.lock"])).toBe(false)
    expect(shouldRefreshGitStateFromRelativePaths([".git/index"])).toBe(true)
    expect(shouldRefreshGitStateFromRelativePaths(["repo/.git/HEAD"])).toBe(true)
    expect(shouldRefreshGitStateFromRelativePaths(["src/App.tsx"])).toBe(true)
  })

  it("does not emit another git refresh for index lock watcher events", () => {
    const workspace = createWorkspace()
    const gitStateListener = vi.fn()
    window.addEventListener("desktop:git-state-changed", gitStateListener)

    try {
      handleWorkspaceFileChange({
        activeSessionDirectory: workspace.directory,
        activeSessionID: "session-1",
        gitRefreshSuppressedUntilRef: { current: {} },
        platform: "win32",
        refreshWorkspaceFromDirectory: vi.fn(),
        scheduleSessionDiffRefreshForSession: vi.fn(),
        setSessionDiffStateBySession: vi.fn(),
        workspaces: [workspace],
        workspaceEvent: {
          directory: workspace.directory,
          paths: [
            "C:/work/workspace-1/.git",
            "C:/work/workspace-1/.git/index.lock",
          ],
        },
        workspaceReloadSuppressedUntilRef: { current: {} },
      })

      expect(gitStateListener).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener("desktop:git-state-changed", gitStateListener)
    }
  })
})
