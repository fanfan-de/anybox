import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SessionDiffSummary, SessionSummary } from "../types"
import { ChangesPanel } from "./ChangesPanel"

function createSession(): SessionSummary {
  return {
    id: "session-1",
    title: "Session",
  } as SessionSummary
}

const scopeOptions: NonNullable<SessionDiffSummary["availableScopes"]> = [
  {
    scope: "git:unstaged",
    label: "未暂存",
    enabled: true,
    count: 2,
  },
  {
    scope: "git:staged",
    label: "已暂存",
    enabled: true,
    count: 1,
  },
  {
    scope: "git:commit",
    label: "提交",
    enabled: false,
    hasChildren: true,
  },
  {
    scope: "git:branch",
    label: "分支",
    enabled: false,
  },
  {
    scope: "session:last-turn",
    label: "上轮对话",
    enabled: true,
    count: 1,
  },
]

const gitOnlyScopeOptions = scopeOptions.filter((option) => option.scope !== "session:last-turn")

describe("ChangesPanel", () => {
  const originalDesktop = window.desktop

  afterEach(() => {
    window.desktop = originalDesktop
  })

  it("loads the latest turn diff from the scope menu", async () => {
    const onDiffScopeLoad = vi.fn(async (): Promise<SessionDiffSummary> => ({
      scope: "session:last-turn",
      restoreMode: "none",
      availableScopes: scopeOptions,
      stats: {
        additions: 1,
        deletions: 0,
        files: 1,
      },
      diffs: [
        {
          file: "latest.txt",
          additions: 1,
          deletions: 0,
          patch: [
            "diff --git a/latest.txt b/latest.txt",
            "--- a/latest.txt",
            "+++ b/latest.txt",
            "@@ -0,0 +1 @@",
            "+latest",
          ].join("\n"),
        },
      ],
    }))

    render(
      <ChangesPanel
        activeSession={createSession()}
        activeSessionDirectory={"C:\\Projects\\Atlas"}
        activeSessionDiff={{
          scope: "git:unstaged",
          restoreMode: "git-file",
          availableScopes: gitOnlyScopeOptions,
          stats: {
            additions: 2,
            deletions: 0,
            files: 2,
          },
          diffs: [
            {
              file: "unstaged.txt",
              additions: 2,
              deletions: 0,
            },
          ],
        }}
        activeSessionDiffState={{
          status: "ready",
          errorMessage: null,
          updatedAt: 1,
          isStale: false,
        }}
        selectedDiffFile={null}
        onDiffFileRestore={vi.fn()}
        onDiffFileSelect={vi.fn()}
        onDiffScopeLoad={onDiffScopeLoad}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /未暂存/ }))
    const menu = screen.getByRole("menu", { name: "Diff scope" })
    fireEvent.click(within(menu).getByRole("menuitem", { name: /上轮对话/ }))

    await waitFor(() => expect(onDiffScopeLoad).toHaveBeenCalledWith("session:last-turn"))
    expect(await screen.findByText("latest.txt")).toBeInTheDocument()
    expect(screen.queryByLabelText("Restore latest.txt")).toBeNull()
  })

  it("shows file action buttons for unstaged files", async () => {
    const stageWorkspaceDiffFile = vi.fn(async () => ({
      directory: "C:\\Projects\\Atlas",
      file: "src/App.tsx",
    }))
    const openInExternalEditor = vi.fn(async () => ({
      ok: true as const,
      editor: {
        id: "vscode",
        label: "VS Code",
        executablePath: "Code.exe",
      },
      targetPath: "C:\\Projects\\Atlas\\src\\App.tsx",
    }))
    const onDiffScopeLoad = vi.fn(async (): Promise<SessionDiffSummary> => ({
      scope: "git:unstaged",
      restoreMode: "git-file",
      availableScopes: scopeOptions,
      stats: {
        additions: 0,
        deletions: 0,
        files: 0,
      },
      diffs: [],
    }))

    window.desktop = {
      ...originalDesktop,
      stageWorkspaceDiffFile,
      openInExternalEditor,
    } as typeof window.desktop

    render(
      <ChangesPanel
        activeSession={createSession()}
        activeSessionDirectory={"C:\\Projects\\Atlas"}
        activeSessionDiff={{
          scope: "git:unstaged",
          restoreMode: "git-file",
          availableScopes: scopeOptions,
          stats: {
            additions: 1,
            deletions: 0,
            files: 1,
          },
          diffs: [
            {
              file: "src/App.tsx",
              additions: 1,
              deletions: 0,
            },
          ],
        }}
        activeSessionDiffState={{
          status: "ready",
          errorMessage: null,
          updatedAt: 1,
          isStale: false,
        }}
        selectedDiffFile={null}
        onDiffFileRestore={vi.fn()}
        onDiffFileSelect={vi.fn()}
        onDiffScopeLoad={onDiffScopeLoad}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Open src/App.tsx in editor" }))
    await waitFor(() => expect(openInExternalEditor).toHaveBeenCalledWith({
      targetPath: "C:\\Projects\\Atlas\\src\\App.tsx",
    }))

    fireEvent.click(screen.getByRole("button", { name: "Stage src/App.tsx" }))
    await waitFor(() => expect(stageWorkspaceDiffFile).toHaveBeenCalledWith({
      directory: "C:\\Projects\\Atlas",
      file: "src/App.tsx",
    }))
    expect(onDiffScopeLoad).toHaveBeenCalledWith("git:unstaged")
  })

  it("shows patch restore, stage, and editor actions for latest-turn files in git workspaces", async () => {
    const latestMessageDiff: SessionDiffSummary = {
      scope: "session:last-turn",
      restoreMode: "patch",
      availableScopes: scopeOptions,
      stats: {
        additions: 1,
        deletions: 0,
        files: 1,
      },
      diffs: [
        {
          file: "README.md",
          additions: 1,
          deletions: 0,
          gitState: "unstaged",
          patch: [
            "diff --git a/README.md b/README.md",
            "--- a/README.md",
            "+++ b/README.md",
            "@@ -1 +1 @@",
            "-old",
            "+new",
          ].join("\n"),
        },
      ],
    }
    const reverseApplyWorkspaceDiffPatches = vi.fn(async () => ({
      directory: "C:\\Projects\\Atlas",
      restored: [{ file: "README.md" }],
      failed: [],
    }))
    const stageWorkspaceDiffFile = vi.fn(async () => ({
      directory: "C:\\Projects\\Atlas",
      file: "README.md",
    }))
    const openInExternalEditor = vi.fn(async () => ({
      ok: true as const,
      editor: {
        id: "vscode",
        label: "VS Code",
        executablePath: "Code.exe",
      },
      targetPath: "C:\\Projects\\Atlas\\README.md",
    }))
    const onDiffScopeLoad = vi.fn(async () => latestMessageDiff)
    const onDiffFileRestore = vi.fn()

    window.desktop = {
      ...originalDesktop,
      reverseApplyWorkspaceDiffPatches,
      stageWorkspaceDiffFile,
      openInExternalEditor,
    } as typeof window.desktop

    render(
      <ChangesPanel
        activeSession={createSession()}
        activeSessionDirectory={"C:\\Projects\\Atlas"}
        activeSessionDiff={latestMessageDiff}
        activeSessionDiffState={{
          status: "ready",
          errorMessage: null,
          updatedAt: 1,
          isStale: false,
        }}
        selectedDiffFile={null}
        onDiffFileRestore={onDiffFileRestore}
        onDiffFileSelect={vi.fn()}
        onDiffScopeLoad={onDiffScopeLoad}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Restore README.md" }))
    await waitFor(() => expect(reverseApplyWorkspaceDiffPatches).toHaveBeenCalledWith({
      directory: "C:\\Projects\\Atlas",
      diffs: [
        {
          file: "README.md",
          patch: latestMessageDiff.diffs[0]?.patch,
        },
      ],
    }))
    expect(onDiffFileRestore).not.toHaveBeenCalled()
    expect(onDiffScopeLoad).toHaveBeenCalledWith("session:last-turn")

    fireEvent.click(screen.getByRole("button", { name: "Stage README.md" }))
    await waitFor(() => expect(stageWorkspaceDiffFile).toHaveBeenCalledWith({
      directory: "C:\\Projects\\Atlas",
      file: "README.md",
    }))

    fireEvent.click(screen.getByRole("button", { name: "Open README.md in editor" }))
    await waitFor(() => expect(openInExternalEditor).toHaveBeenCalledWith({
      targetPath: "C:\\Projects\\Atlas\\README.md",
    }))
  })
})
