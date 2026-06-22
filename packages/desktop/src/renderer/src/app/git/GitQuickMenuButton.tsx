import { useEffect, useEffectEvent, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react"
import type { SessionDiffSummary } from "../types"
import { isMatchingGitStateChangedDetail, notifyGitStateChanged, subscribeToGitStateChanged } from "../git-events"
import {
  ChangesIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  CommitIcon,
  ForkIcon,
  PlusIcon,
  PullRequestIcon,
  PushIcon,
  SearchIcon,
} from "../icons"
import {
  checkoutGitBranch,
  commitGit,
  createGitBranch,
  createGitPullRequest,
  getGitCapabilities,
  hasGitQuickMenuClient,
  listGitBranches,
  pushGit,
  type GitBranchSummary,
  type GitCapabilitiesState,
} from "./client"

const GIT_STATE_CHANGED_REFRESH_DEBOUNCE_MS = 300

type ActivePanel = "commit" | "branches" | null
type PendingGitAction = "commit" | "stage-all-commit" | "commit-push" | "push" | "pull-request" | "checkout" | "create-branch" | null

type DiffStats = {
  additions: number
  deletions: number
  files: number
}

type DiffStatsRefreshOptions = {
  showLoading?: boolean
}

const EMPTY_DIFF_STATS: DiffStats = {
  additions: 0,
  deletions: 0,
  files: 0,
}

function readDiffStats(diff: SessionDiffSummary | null): DiffStats {
  if (diff?.stats) {
    return {
      additions: diff.stats.additions,
      deletions: diff.stats.deletions,
      files: diff.stats.files,
    }
  }

  if (!diff?.diffs.length) return EMPTY_DIFF_STATS

  return diff.diffs.reduce<DiffStats>((stats, file) => ({
    additions: stats.additions + file.additions,
    deletions: stats.deletions + file.deletions,
    files: stats.files + 1,
  }), EMPTY_DIFF_STATS)
}

function mergeDiffStats(left: DiffStats, right: DiffStats): DiffStats {
  return {
    additions: left.additions + right.additions,
    deletions: left.deletions + right.deletions,
    files: left.files + right.files,
  }
}

function formatDiffCount(value: number) {
  return value.toLocaleString("en-US")
}

function GitDiffStatsView({
  className = "",
  isLoading,
  stats,
}: {
  className?: string
  isLoading: boolean
  stats: DiffStats | null
}) {
  const displayStats = stats ?? EMPTY_DIFF_STATS
  const label = `${displayStats.additions} additions, ${displayStats.deletions} deletions`

  return (
    <span className={["git-quick-menu-diff-stats", className].filter(Boolean).join(" ")} aria-label={label}>
      {isLoading ? (
        <span className="git-quick-menu-diff-loading">...</span>
      ) : (
        <>
          <span className="is-add">+{formatDiffCount(displayStats.additions)}</span>
          <span className="is-remove">-{formatDiffCount(displayStats.deletions)}</span>
        </>
      )}
    </span>
  )
}

export function GitQuickMenuButton({
  directory,
  onOpenReview,
  projectID,
  sessionID,
}: {
  directory: string | null
  onOpenReview?: (() => void | Promise<void>) | null
  projectID: string | null
  sessionID?: string | null
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null)
  const branchInputRef = useRef<HTMLInputElement | null>(null)
  const loadRequestRef = useRef(0)
  const visibleLoadRequestRef = useRef(0)
  const branchesRequestRef = useRef(0)
  const diffStatsRequestRef = useRef(0)
  const gitStateRefreshTimerRef = useRef<number | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [activePanel, setActivePanel] = useState<ActivePanel>(null)
  const [commitMessage, setCommitMessage] = useState("")
  const [includeUnstagedChanges, setIncludeUnstagedChanges] = useState(true)
  const [branchName, setBranchName] = useState("")
  const [branchFilter, setBranchFilter] = useState("")
  const [branches, setBranches] = useState<GitBranchSummary[]>([])
  const [branchError, setBranchError] = useState("")
  const [isCreateBranchFormOpen, setIsCreateBranchFormOpen] = useState(false)
  const [isLoadingBranches, setIsLoadingBranches] = useState(false)
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null)
  const [isLoadingDiffStats, setIsLoadingDiffStats] = useState(false)
  const [capabilities, setCapabilities] = useState<GitCapabilitiesState | null>(null)
  const [isLoadingCapabilities, setIsLoadingCapabilities] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingGitAction>(null)
  const [pendingBranchName, setPendingBranchName] = useState<string | null>(null)
  const [status, setStatus] = useState<{
    tone: "neutral" | "success" | "error"
    text: string
  }>({
    tone: "neutral",
    text: "",
  })

  const hasGitClient = hasGitQuickMenuClient()

  async function refreshCapabilities({
    bypassCache = false,
    includePullRequestRemoteCheck = false,
    reportError = false,
    silent = false,
  }: {
    bypassCache?: boolean
    includePullRequestRemoteCheck?: boolean
    reportError?: boolean
    silent?: boolean
  } = {}) {
    if (!projectID || !directory || !hasGitClient) {
      setCapabilities(null)
      setIsLoadingCapabilities(false)
      return null
    }

    const requestID = loadRequestRef.current + 1
    loadRequestRef.current = requestID
    const visibleRequestID = silent ? null : visibleLoadRequestRef.current + 1
    if (visibleRequestID !== null) {
      visibleLoadRequestRef.current = visibleRequestID
      setIsLoadingCapabilities(true)
    }

    try {
      const nextCapabilities = await getGitCapabilities({
        projectID,
        directory,
        ...(includePullRequestRemoteCheck ? { includePullRequestRemoteCheck: true } : {}),
      }, {
        bypassCache,
      })

      if (loadRequestRef.current !== requestID) {
        return null
      }

      setCapabilities(nextCapabilities)
      return nextCapabilities
    } catch (error) {
      if (loadRequestRef.current !== requestID) {
        return null
      }

      setCapabilities(null)
      if (reportError) {
        setStatus({
          tone: "error",
          text: error instanceof Error ? error.message : String(error),
        })
      }
      return null
    } finally {
      if (visibleRequestID !== null && visibleLoadRequestRef.current === visibleRequestID) {
        setIsLoadingCapabilities(false)
      }
    }
  }

  async function refreshBranches(reportError = false) {
    if (!projectID || !directory || !capabilities?.isGitRepo) {
      setBranches([])
      setIsLoadingBranches(false)
      return []
    }

    const requestID = branchesRequestRef.current + 1
    branchesRequestRef.current = requestID
    setIsLoadingBranches(true)

    try {
      const nextBranches = await listGitBranches({
        projectID,
        directory,
      })

      if (branchesRequestRef.current !== requestID) {
        return []
      }

      setBranches(nextBranches)
      return nextBranches
    } catch (error) {
      if (branchesRequestRef.current !== requestID) {
        return []
      }

      setBranches([])
      if (reportError) {
        setBranchError(error instanceof Error ? error.message : String(error))
      }
      return []
    } finally {
      if (branchesRequestRef.current === requestID) {
        setIsLoadingBranches(false)
      }
    }
  }

  async function refreshDiffStats(reportError = false, options: DiffStatsRefreshOptions = {}) {
    const getSessionDiff = window.desktop?.getSessionDiff
    if (!sessionID || !getSessionDiff) {
      setDiffStats(null)
      setIsLoadingDiffStats(false)
      return null
    }

    const requestID = diffStatsRequestRef.current + 1
    diffStatsRequestRef.current = requestID
    const showLoading = options.showLoading ?? true
    if (showLoading) {
      setIsLoadingDiffStats(true)
    }

    try {
      const [unstagedDiff, stagedDiff] = await Promise.all([
        getSessionDiff({ sessionID, scope: "git:unstaged" }),
        getSessionDiff({ sessionID, scope: "git:staged" }),
      ])

      if (diffStatsRequestRef.current !== requestID) {
        return null
      }

      const nextStats = mergeDiffStats(readDiffStats(unstagedDiff), readDiffStats(stagedDiff))
      setDiffStats(nextStats)
      return nextStats
    } catch (error) {
      if (diffStatsRequestRef.current !== requestID) {
        return null
      }

      if (showLoading || reportError) {
        setDiffStats(null)
      }
      if (reportError) {
        setStatus({
          tone: "error",
          text: error instanceof Error ? error.message : String(error),
        })
      }
      return null
    } finally {
      if (diffStatsRequestRef.current === requestID) {
        setIsLoadingDiffStats(false)
      }
    }
  }

  const refreshCapabilitiesSilently = useEffectEvent((reportError = false) => {
    void refreshCapabilities({
      bypassCache: true,
      reportError,
      silent: true,
    })
  })

  const refreshDiffStatsSilently = useEffectEvent((reportError = false) => {
    void refreshDiffStats(reportError, {
      showLoading: diffStats === null,
    })
  })

  const refreshBranchesSilently = useEffectEvent((reportError = false) => {
    void refreshBranches(reportError)
  })

  const scheduleGitStateRefresh = useEffectEvent(() => {
    if (gitStateRefreshTimerRef.current !== null) {
      window.clearTimeout(gitStateRefreshTimerRef.current)
    }

    gitStateRefreshTimerRef.current = window.setTimeout(() => {
      gitStateRefreshTimerRef.current = null
      void refreshCapabilities({
        bypassCache: true,
        silent: true,
      })
      if (isMenuOpen) {
        refreshDiffStatsSilently()
      }
      if (activePanel === "branches") {
        refreshBranchesSilently()
      }
    }, GIT_STATE_CHANGED_REFRESH_DEBOUNCE_MS)
  })

  const handleGitStateChanged = useEffectEvent((detail: { directory: string }) => {
    if (!isMatchingGitStateChangedDetail(detail, directory)) return
    scheduleGitStateRefresh()
  })

  const refreshVisibleGitQuickMenuState = useEffectEvent((reportError = false) => {
    refreshCapabilitiesSilently(reportError)
    refreshDiffStatsSilently()
    if (activePanel === "branches") {
      refreshBranchesSilently()
    }
  })

  useEffect(() => {
    setIsMenuOpen(false)
    setActivePanel(null)
    setCommitMessage("")
    setIncludeUnstagedChanges(true)
    setBranchName("")
    setBranchFilter("")
    setBranches([])
    setBranchError("")
    setIsCreateBranchFormOpen(false)
    setDiffStats(null)
    setStatus({
      tone: "neutral",
      text: "",
    })
    void refreshCapabilities()
  }, [projectID, directory])

  useEffect(() => subscribeToGitStateChanged(handleGitStateChanged), [handleGitStateChanged])

  useEffect(() => () => {
    if (gitStateRefreshTimerRef.current !== null) {
      window.clearTimeout(gitStateRefreshTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isMenuOpen) return

    refreshVisibleGitQuickMenuState(true)

    const handleWindowFocus = () => {
      refreshVisibleGitQuickMenuState()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return
      refreshVisibleGitQuickMenuState()
    }

    window.addEventListener("focus", handleWindowFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.removeEventListener("focus", handleWindowFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [isMenuOpen])

  useEffect(() => {
    if (!isMenuOpen) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setIsMenuOpen(false)
      setActivePanel(null)
      setBranchError("")
      setIsCreateBranchFormOpen(false)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false)
        setActivePanel(null)
        setBranchError("")
        setIsCreateBranchFormOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isMenuOpen])

  useEffect(() => {
    if (!isMenuOpen) return

    if (activePanel === "commit") {
      commitInputRef.current?.focus()
      return
    }

    if (activePanel === "branches") {
      void refreshBranches(true)
      if (isCreateBranchFormOpen) {
        branchInputRef.current?.focus()
      }
    }
  }, [activePanel, isCreateBranchFormOpen, isMenuOpen])

  async function handleCommit(options?: { pushAfter?: boolean; stageAll?: boolean }) {
    const message = commitMessage.trim()
    const stageAll = options?.stageAll === true
    const pushAfter = options?.pushAfter === true
    let didCommit = false

    if (!message) {
      setStatus({
        tone: "error",
        text: "Enter a commit message.",
      })
      return
    }

    if (!projectID || !directory) {
      setStatus({
        tone: "error",
        text: "The current workspace is unavailable.",
      })
      return
    }

    setPendingAction(pushAfter ? "commit-push" : stageAll ? "stage-all-commit" : "commit")
    setStatus({
      tone: "neutral",
      text: stageAll ? "Staging all changes and committing..." : "Committing staged changes...",
    })

    try {
      const commitResult = await commitGit({
        projectID,
        directory,
        message,
        ...(stageAll ? { stageAll: true } : {}),
      })
      didCommit = true

      if (pushAfter) {
        setStatus({
          tone: "neutral",
          text: "Pushing branch...",
        })
        const pushResult = await pushGit({
          projectID,
          directory,
        })
        setCommitMessage("")
        setStatus({
          tone: "success",
          text: `${commitResult.summary} ${pushResult.summary}`,
        })
      } else {
        setCommitMessage("")
        setStatus({
          tone: "success",
          text: commitResult.summary,
        })
      }

      void refreshDiffStats()
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (didCommit) {
        notifyGitStateChanged({
          directory,
        })
      }
      setPendingAction(null)
    }
  }

  async function handlePush() {
    if (!projectID || !directory) {
      setStatus({
        tone: "error",
        text: "The current workspace is unavailable.",
      })
      return
    }

    setPendingAction("push")
    setStatus({
      tone: "neutral",
      text: "Pushing branch...",
    })

    try {
      const result = await pushGit({
        projectID,
        directory,
      })
      setStatus({
        tone: "success",
        text: result.summary,
      })
      notifyGitStateChanged({
        directory,
      })
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPendingAction(null)
    }
  }

  async function handleCheckoutBranch(name: string) {
    if (!projectID || !directory) {
      setBranchError("The current workspace is unavailable.")
      return
    }

    setPendingAction("checkout")
    setPendingBranchName(name)
    setBranchError("")

    try {
      const result = await checkoutGitBranch({
        projectID,
        directory,
        name,
      })
      setActivePanel(null)
      setStatus({
        tone: "success",
        text: result.summary,
      })
      await Promise.all([
        refreshCapabilities({ bypassCache: true, silent: true }),
        refreshBranches(),
        refreshDiffStats(),
      ]).catch((error) => {
        console.error("[desktop] git quick menu refresh failed:", error)
      })
      notifyGitStateChanged({
        directory: result.directory,
        branchesChanged: true,
      })
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : String(error))
    } finally {
      setPendingAction(null)
      setPendingBranchName(null)
    }
  }

  async function handleCreateBranch() {
    const name = branchName.trim()

    if (!capabilities?.canCreateBranch.enabled) {
      setBranchError(capabilities?.canCreateBranch.reason ?? "A branch cannot be created right now.")
      return
    }

    if (!name) {
      setBranchError("Enter a branch name.")
      return
    }

    if (!projectID || !directory) {
      setBranchError("The current workspace is unavailable.")
      return
    }

    setPendingAction("create-branch")
    setPendingBranchName(name)
    setBranchError("")

    try {
      const result = await createGitBranch({
        projectID,
        directory,
        name,
      })
      setBranchName("")
      setBranchFilter("")
      setIsCreateBranchFormOpen(false)
      setActivePanel(null)
      setStatus({
        tone: "success",
        text: result.summary,
      })
      await Promise.all([
        refreshCapabilities({ bypassCache: true, silent: true }),
        refreshBranches(true),
        refreshDiffStats(),
      ]).catch((error) => {
        console.error("[desktop] git quick menu refresh failed:", error)
      })
      notifyGitStateChanged({
        directory: result.directory,
        branchesChanged: true,
      })
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : String(error))
    } finally {
      setPendingAction(null)
      setPendingBranchName(null)
    }
  }

  async function handleCreatePullRequest() {
    if (!projectID || !directory) {
      setStatus({
        tone: "error",
        text: "The current workspace is unavailable.",
      })
      return
    }

    setPendingAction("pull-request")
    setActivePanel(null)
    setStatus({
      tone: "neutral",
      text: "Checking pull request status...",
    })

    try {
      const nextCapabilities = await refreshCapabilities({
        bypassCache: true,
        includePullRequestRemoteCheck: true,
        silent: true,
      })
      if (!nextCapabilities?.canCreatePullRequest.enabled) {
        setStatus({
          tone: "error",
          text: nextCapabilities?.canCreatePullRequest.reason ?? "A pull request cannot be created right now.",
        })
        return
      }

      setStatus({
        tone: "neutral",
        text: "Creating pull request...",
      })
      const result = await createGitPullRequest({
        projectID,
        directory,
      })
      setStatus({
        tone: "success",
        text: result.summary,
      })
      notifyGitStateChanged({
        directory,
      })
    } catch (error) {
      setStatus({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setPendingAction(null)
    }
  }

  function handleBranchNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return
    event.preventDefault()
    void handleCreateBranch()
  }

  function handleOpenReview() {
    setIsMenuOpen(false)
    setActivePanel(null)
    setBranchError("")
    setIsCreateBranchFormOpen(false)
    void onOpenReview?.()
  }

  if (!projectID || !directory || !hasGitClient || !capabilities?.isGitRepo) {
    return null
  }

  const isBusy = pendingAction !== null || isLoadingCapabilities
  const branchLabel = capabilities.branch ?? "Detached HEAD"
  const defaultStatusText = capabilities.branch
    ? `Current branch: ${capabilities.branch}`
    : "The current worktree is on a detached HEAD."
  const canCommitWithSelection = includeUnstagedChanges
    ? capabilities.canStageAllCommit.enabled
    : capabilities.canCommit.enabled
  const commitActionTitle = includeUnstagedChanges
    ? capabilities.canStageAllCommit.enabled
      ? "Stage all local changes and commit them."
      : capabilities.canStageAllCommit.reason
    : capabilities.canCommit.enabled
      ? "Commit only the staged changes."
      : capabilities.canCommit.reason
  const canOpenCommitPanel = capabilities.canCommit.enabled || capabilities.canStageAllCommit.enabled || capabilities.canPush.enabled
  const commitPanelTitle = canOpenCommitPanel
    ? "Commit or push changes."
    : capabilities.canStageAllCommit.reason ?? capabilities.canCommit.reason ?? capabilities.canPush.reason
  const normalizedBranchFilter = branchFilter.trim().toLowerCase()
  const visibleBranches = normalizedBranchFilter
    ? branches.filter((branch) => branch.name.toLowerCase().includes(normalizedBranchFilter))
    : branches

  return (
    <div className="canvas-top-menu-quick-anchor">
      <button
        ref={buttonRef}
        type="button"
        className={isMenuOpen ? "canvas-top-menu-button canvas-top-menu-git-trigger is-active" : "canvas-top-menu-button canvas-top-menu-git-trigger"}
        aria-controls="canvas-top-menu-git-menu"
        aria-expanded={isMenuOpen}
        aria-haspopup="dialog"
        title="Git actions"
        onClick={() => setIsMenuOpen((current) => !current)}
      >
        Git
        <ChevronDownIcon />
      </button>

      {isMenuOpen ? (
        <div ref={menuRef} id="canvas-top-menu-git-menu" className="canvas-top-menu-quick-panel git-quick-menu-panel" role="dialog" aria-label="Git quick menu">
          <div className="git-quick-menu-main">
            <button
              type="button"
              className="composer-menu-option git-quick-menu-option git-quick-menu-main-option git-quick-menu-summary-row canvas-top-menu-segmented-option"
              disabled={!onOpenReview || isBusy}
              title="Open Review"
              onClick={handleOpenReview}
            >
              <span className="git-quick-menu-option-main">
                <ChangesIcon />
                <span className="git-quick-menu-summary-label">Changes</span>
              </span>
              <GitDiffStatsView isLoading={isLoadingDiffStats} stats={diffStats} />
            </button>

            <button
              type="button"
              className={activePanel === "branches" ? "composer-menu-option git-quick-menu-option git-quick-menu-main-option canvas-top-menu-segmented-option is-selected" : "composer-menu-option git-quick-menu-option git-quick-menu-main-option canvas-top-menu-segmented-option"}
              disabled={isBusy}
              title={`Current branch: ${branchLabel}`}
              onClick={() => {
                setBranchError("")
                setActivePanel((current) => current === "branches" ? null : "branches")
              }}
            >
              <span className="git-quick-menu-option-main">
                <ForkIcon />
                <span className="composer-menu-option-copy">
                  <strong>{branchLabel}</strong>
                </span>
                <ChevronDownIcon className="git-quick-menu-inline-chevron" />
              </span>
            </button>

            <button
              type="button"
              className={activePanel === "commit" ? "composer-menu-option git-quick-menu-option git-quick-menu-main-option canvas-top-menu-segmented-option is-selected" : "composer-menu-option git-quick-menu-option git-quick-menu-main-option canvas-top-menu-segmented-option"}
              disabled={!canOpenCommitPanel || isBusy}
              title={commitPanelTitle}
              onClick={() => {
                setActivePanel((current) => current === "commit" ? null : "commit")
              }}
            >
              <span className="git-quick-menu-option-main">
                <CommitIcon />
                <span className="composer-menu-option-copy">
                  <strong>Commit or push</strong>
                </span>
                <ChevronDownIcon className="git-quick-menu-inline-chevron" />
              </span>
            </button>

            <button
              type="button"
              className="composer-menu-option git-quick-menu-option git-quick-menu-main-option canvas-top-menu-segmented-option"
              aria-label="Create pull request"
              disabled={!capabilities.canCreatePullRequest.enabled || isBusy}
              title={capabilities.canCreatePullRequest.enabled ? "Create a pull request for the current branch." : capabilities.canCreatePullRequest.reason}
              onClick={() => {
                void handleCreatePullRequest()
              }}
            >
              <span className="git-quick-menu-option-main">
                <PullRequestIcon />
                <span className="composer-menu-option-copy">
                  <strong>Create pull request</strong>
                </span>
              </span>
              <span className="composer-menu-option-check">{pendingAction === "pull-request" ? "Working..." : "Run"}</span>
            </button>
          </div>

          {activePanel === "commit" ? (
            <div className="git-quick-menu-subpanel git-quick-menu-commit-panel" role="dialog" aria-label="Commit or push">
              <div className="git-quick-menu-subpanel-header">
                <button
                  type="button"
                  className="git-quick-menu-branch-pill"
                  title={`Current branch: ${branchLabel}`}
                  onClick={() => {
                    setBranchError("")
                    setActivePanel("branches")
                  }}
                >
                  <ForkIcon />
                  <span>{branchLabel}</span>
                  <ChevronDownIcon />
                </button>
                <GitDiffStatsView className="git-quick-menu-panel-stats" isLoading={isLoadingDiffStats} stats={diffStats} />
              </div>

              <label className="canvas-top-menu-quick-field git-quick-menu-message-field">
                <span>Commit message</span>
                <textarea
                  ref={commitInputRef}
                  value={commitMessage}
                  placeholder="Describe the change"
                  rows={3}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setCommitMessage(event.target.value)}
                />
              </label>

              <label className="git-quick-menu-checkbox">
                <input
                  type="checkbox"
                  checked={includeUnstagedChanges}
                  disabled={isBusy}
                  onChange={(event) => setIncludeUnstagedChanges(event.target.checked)}
                />
                <span>Include unstaged changes</span>
              </label>

              <div className="git-quick-menu-action-list" role="group" aria-label="Commit and push actions">
                <button
                  type="button"
                  className="composer-menu-option git-quick-menu-action-option canvas-top-menu-segmented-option"
                  aria-label="Commit"
                  disabled={!canCommitWithSelection || isBusy}
                  title={commitActionTitle}
                  onClick={() => void handleCommit({ stageAll: includeUnstagedChanges })}
                >
                  <span className="git-quick-menu-option-main">
                    <CommitIcon />
                    <strong>Commit</strong>
                  </span>
                  <span className="composer-menu-option-check">
                    {pendingAction === "commit" || pendingAction === "stage-all-commit" ? "Working..." : "Run"}
                  </span>
                </button>

                <button
                  type="button"
                  className="composer-menu-option git-quick-menu-action-option canvas-top-menu-segmented-option"
                  aria-label="Commit and push"
                  disabled={!canCommitWithSelection || isBusy}
                  title={capabilities.canPush.enabled ? "Commit and push the current branch." : capabilities.canPush.reason ?? "Commit, then push the current branch."}
                  onClick={() => void handleCommit({ pushAfter: true, stageAll: includeUnstagedChanges })}
                >
                  <span className="git-quick-menu-option-main">
                    <PushIcon />
                    <strong>Commit and push</strong>
                  </span>
                  <span className="composer-menu-option-check">{pendingAction === "commit-push" ? "Working..." : "Run"}</span>
                </button>

                <button
                  type="button"
                  className="composer-menu-option git-quick-menu-action-option canvas-top-menu-segmented-option"
                  aria-label="Push"
                  disabled={!capabilities.canPush.enabled || isBusy}
                  title={capabilities.canPush.enabled ? "Push the current branch." : capabilities.canPush.reason}
                  onClick={() => void handlePush()}
                >
                  <span className="git-quick-menu-option-main">
                    <PushIcon />
                    <strong>Push</strong>
                  </span>
                  <span className="composer-menu-option-check">{pendingAction === "push" ? "Working..." : "Run"}</span>
                </button>
              </div>
            </div>
          ) : null}

          {activePanel === "branches" ? (
            <div className="git-quick-menu-subpanel git-quick-menu-branches-panel" role="dialog" aria-label="Git branches">
              <div className="git-quick-menu-subpanel-header">
                <strong>Branches</strong>
                <button
                  type="button"
                  className="git-quick-menu-icon-button"
                  title="Close branch panel"
                  aria-label="Close branch panel"
                  onClick={() => {
                    setActivePanel(null)
                    setBranchError("")
                    setIsCreateBranchFormOpen(false)
                  }}
                >
                  <CloseIcon />
                </button>
              </div>

              <label className="git-quick-menu-search-field">
                <SearchIcon />
                <input
                  type="search"
                  aria-label="Search branches"
                  value={branchFilter}
                  placeholder="Search branches"
                  onChange={(event) => setBranchFilter(event.target.value)}
                />
              </label>

              <div className="git-quick-menu-branch-list" role="group" aria-label="Git branches">
                {isLoadingBranches ? (
                  <p className="composer-menu-empty">Loading branches...</p>
                ) : visibleBranches.length > 0 ? (
                  visibleBranches.map((branch) => {
                    const isPending = pendingAction === "checkout" && pendingBranchName === branch.name

                    return (
                      <button
                        key={`${branch.kind}:${branch.name}`}
                        type="button"
                        className={branch.current ? "composer-menu-option git-quick-menu-branch-option canvas-top-menu-segmented-option is-selected is-current" : "composer-menu-option git-quick-menu-branch-option canvas-top-menu-segmented-option"}
                        disabled={branch.current || isBusy}
                        onClick={() => void handleCheckoutBranch(branch.name)}
                      >
                        <span className="git-quick-menu-option-main">
                          <ForkIcon />
                          <span className="composer-menu-option-copy">
                            <strong>{branch.name}</strong>
                          </span>
                        </span>
                        <span className="composer-menu-option-check">
                          {branch.current ? (
                            <CheckIcon />
                          ) : isPending ? (
                            "Switching..."
                          ) : branch.kind === "remote" ? (
                            "Remote"
                          ) : (
                            "Switch"
                          )}
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <p className="composer-menu-empty">No matching branches.</p>
                )}
              </div>

              <div className="git-quick-menu-branch-footer">
                <button
                  type="button"
                  className="composer-menu-option git-quick-menu-branch-create-option canvas-top-menu-segmented-option"
                  aria-label="Create and checkout new branch"
                  disabled={isBusy || !capabilities.canCreateBranch.enabled}
                  title={capabilities.canCreateBranch.enabled ? "Create and checkout a new branch." : capabilities.canCreateBranch.reason}
                  onClick={() => {
                    setBranchError("")
                    setIsCreateBranchFormOpen((current) => !current)
                  }}
                >
                  <span className="git-quick-menu-option-main">
                    <PlusIcon />
                    <strong>Create and checkout new branch...</strong>
                  </span>
                </button>

                {isCreateBranchFormOpen ? (
                  <div className="git-quick-menu-create-branch-form">
                    <label className="canvas-top-menu-quick-field">
                      <span>Branch name</span>
                      <input
                        ref={branchInputRef}
                        type="text"
                        value={branchName}
                        placeholder="feature/new-branch"
                        onChange={(event: ChangeEvent<HTMLInputElement>) => setBranchName(event.target.value)}
                        onKeyDown={handleBranchNameKeyDown}
                      />
                    </label>
                    <div className="canvas-top-menu-quick-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          setIsCreateBranchFormOpen(false)
                          setBranchName("")
                          setBranchError("")
                        }}
                        disabled={isBusy}
                      >
                        Cancel
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => void handleCreateBranch()}
                        disabled={!capabilities.canCreateBranch.enabled || isBusy}
                        title={capabilities.canCreateBranch.enabled ? "Create and checkout a new branch." : capabilities.canCreateBranch.reason}
                      >
                        {pendingAction === "create-branch" ? "Creating..." : "Create branch"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {branchError ? (
                <p className="canvas-top-menu-quick-status is-error" role="alert">
                  {branchError}
                </p>
              ) : null}
            </div>
          ) : null}

          <p
            className={[
              "canvas-top-menu-quick-status",
              status.tone === "success" ? "is-success" : "",
              status.tone === "error" ? "is-error" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-live="polite"
          >
            {status.text || (isLoadingCapabilities ? "Checking Git status..." : defaultStatusText)}
          </p>
        </div>
      ) : null}
    </div>
  )
}
