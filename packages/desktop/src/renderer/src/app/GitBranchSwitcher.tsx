import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { isMatchingGitStateChangedDetail, notifyGitStateChanged, subscribeToGitStateChanged } from "./git-events"
import {
  checkoutGitBranch,
  createGitBranch,
  getGitCapabilities,
  hasGitQuickMenuClient,
  listGitBranches,
  type GitBranchSummary,
  type GitCapabilitiesState,
} from "./git/client"
import { ChevronDownIcon } from "./icons"

const GIT_STATE_CHANGED_REFRESH_DEBOUNCE_MS = 300

interface GitBranchSwitcherProps {
  projectID: string | null
  directory: string | null
}

export function GitBranchSwitcher({ projectID, directory }: GitBranchSwitcherProps) {
  const branchButtonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const branchInputRef = useRef<HTMLInputElement | null>(null)
  const capabilitiesRequestRef = useRef(0)
  const branchesRequestRef = useRef(0)
  const gitStateRefreshTimerRef = useRef<number | null>(null)
  const scheduledBranchesRefreshRef = useRef(false)
  const [capabilities, setCapabilities] = useState<GitCapabilitiesState | null>(null)
  const [branches, setBranches] = useState<GitBranchSummary[]>([])
  const [branchName, setBranchName] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isLoadingBranches, setIsLoadingBranches] = useState(false)
  const [isLoadingCapabilities, setIsLoadingCapabilities] = useState(false)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<"checkout" | "create" | null>(null)
  const [pendingBranchName, setPendingBranchName] = useState<string | null>(null)

  const hasGitClient = hasGitQuickMenuClient()
  const hasCurrentGitCapabilities =
    capabilities?.isGitRepo === true &&
    isMatchingGitStateChangedDetail({ directory: capabilities.directory }, directory)

  async function refreshCapabilities(reportError = false, options?: { bypassCache?: boolean }) {
    if (!projectID || !directory || !hasGitClient) {
      setCapabilities(null)
      setBranches([])
      setIsLoadingCapabilities(false)
      return null
    }

    const requestID = capabilitiesRequestRef.current + 1
    capabilitiesRequestRef.current = requestID
    setIsLoadingCapabilities(true)

    try {
      const nextCapabilities = await getGitCapabilities({
        projectID,
        directory,
      }, {
        bypassCache: options?.bypassCache === true,
      })

      if (capabilitiesRequestRef.current !== requestID) {
        return null
      }

      setCapabilities(nextCapabilities)
      if (!nextCapabilities.isGitRepo) {
        setBranches([])
        setIsPanelOpen(false)
        setIsCreateDialogOpen(false)
      }
      return nextCapabilities
    } catch (error) {
      if (capabilitiesRequestRef.current !== requestID) {
        return null
      }

      setCapabilities(null)
      setBranches([])
      setIsPanelOpen(false)
      setIsCreateDialogOpen(false)
      if (reportError) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
      return null
    } finally {
      if (capabilitiesRequestRef.current === requestID) {
        setIsLoadingCapabilities(false)
      }
    }
  }

  async function refreshBranches(reportError = false) {
    if (!projectID || !directory || !hasCurrentGitCapabilities) {
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
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
      return []
    } finally {
      if (branchesRequestRef.current === requestID) {
        setIsLoadingBranches(false)
      }
    }
  }

  useEffect(() => {
    setBranches([])
    setBranchName("")
    setErrorMessage("")
    setIsCreateDialogOpen(false)
    setIsPanelOpen(false)
    void refreshCapabilities()
  }, [projectID, directory])

  const handleGitStateChanged = useEffectEvent((detail: { directory: string; branchesChanged?: boolean }) => {
    if (!isMatchingGitStateChangedDetail(detail, directory)) return
    if (detail.branchesChanged || isPanelOpen) {
      scheduledBranchesRefreshRef.current = true
    }
    scheduleGitStateRefresh()
  })

  const scheduleGitStateRefresh = useEffectEvent(() => {
    if (gitStateRefreshTimerRef.current !== null) {
      window.clearTimeout(gitStateRefreshTimerRef.current)
    }

    gitStateRefreshTimerRef.current = window.setTimeout(() => {
      gitStateRefreshTimerRef.current = null
      const shouldRefreshBranches = scheduledBranchesRefreshRef.current
      scheduledBranchesRefreshRef.current = false
      void refreshCapabilities(false, {
        bypassCache: true,
      })
      if (shouldRefreshBranches) {
        void refreshBranches()
      }
    }, GIT_STATE_CHANGED_REFRESH_DEBOUNCE_MS)
  })

  useEffect(() => subscribeToGitStateChanged(handleGitStateChanged), [handleGitStateChanged])

  useEffect(() => () => {
    if (gitStateRefreshTimerRef.current !== null) {
      window.clearTimeout(gitStateRefreshTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!isPanelOpen) return

    void refreshBranches(true)

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target) || branchButtonRef.current?.contains(target)) return
      setIsPanelOpen(false)
      setErrorMessage("")
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      setIsPanelOpen(false)
      setErrorMessage("")
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isPanelOpen])

  useEffect(() => {
    if (!isCreateDialogOpen) return

    branchInputRef.current?.focus()

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return
      setIsCreateDialogOpen(false)
      setBranchName("")
      setErrorMessage("")
    }

    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isCreateDialogOpen])

  async function handleCheckoutBranch(name: string) {
    if (!projectID || !directory) {
      setErrorMessage("The current workspace is unavailable.")
      return
    }

    setPendingAction("checkout")
    setPendingBranchName(name)
    setErrorMessage("")

    try {
      const result = await checkoutGitBranch({
        projectID,
        directory,
        name,
      })
      setIsPanelOpen(false)
      await Promise.all([refreshCapabilities(false, { bypassCache: true }), refreshBranches()]).catch((error) => {
        console.error("[desktop] git branch switcher refresh failed:", error)
      })
      notifyGitStateChanged({
        directory: result.directory,
        branchesChanged: true,
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setPendingAction(null)
      setPendingBranchName(null)
    }
  }

  async function handleCreateAndCheckoutBranch() {
    const name = branchName.trim()

    if (!capabilities?.canCreateBranch.enabled) {
      setErrorMessage(capabilities?.canCreateBranch.reason ?? "A branch cannot be created right now.")
      return
    }

    if (!name) {
      setErrorMessage("Enter a branch name.")
      return
    }

    if (!projectID || !directory) {
      setErrorMessage("The current workspace is unavailable.")
      return
    }

    setPendingAction("create")
    setPendingBranchName(name)
    setErrorMessage("")

    try {
      const result = await createGitBranch({
        projectID,
        directory,
        name,
      })
      setIsCreateDialogOpen(false)
      setBranchName("")
      await Promise.all([refreshCapabilities(false, { bypassCache: true }), refreshBranches(true)]).catch((error) => {
        console.error("[desktop] git branch switcher refresh failed:", error)
      })
      notifyGitStateChanged({
        directory: result.directory,
        branchesChanged: true,
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setPendingAction(null)
      setPendingBranchName(null)
    }
  }

  function handleBranchNameKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return
    event.preventDefault()
    void handleCreateAndCheckoutBranch()
  }

  if (!projectID || !directory || !hasGitClient) {
    return null
  }

  if (!hasCurrentGitCapabilities) {
    return null
  }

  const isBusy = pendingAction !== null || isLoadingCapabilities
  const branchLabel = capabilities.branch ?? "Detached HEAD"

  return (
    <>
      <div className="composer-utility-git-branch-anchor">
        <button
          ref={branchButtonRef}
          type="button"
          className={
            isPanelOpen
              ? "composer-utility-chip composer-utility-git-branch-button is-active"
              : "composer-utility-chip composer-utility-git-branch-button"
          }
          aria-controls="composer-utility-git-branch-panel"
          aria-expanded={isPanelOpen}
          aria-haspopup="dialog"
          title={`Git branch: ${branchLabel}`}
          onClick={() => {
            setErrorMessage("")
            setIsPanelOpen((current) => !current)
          }}
        >
          <span className="composer-utility-git-branch-label">{branchLabel}</span>
          <ChevronDownIcon />
        </button>

        {isPanelOpen ? (
          <div
            ref={panelRef}
            id="composer-utility-git-branch-panel"
            className="composer-utility-git-branch-panel"
            role="dialog"
            aria-label="Git branch switcher"
          >
            <div className="composer-utility-git-branch-list" role="group" aria-label="Git branches">
              {isLoadingBranches ? (
                <p className="composer-menu-empty">Loading branches...</p>
              ) : branches.length > 0 ? (
                branches.map((branch) => {
                  const isPending = pendingAction === "checkout" && pendingBranchName === branch.name

                  return (
                    <button
                      key={`${branch.kind}:${branch.name}`}
                      type="button"
                      className={
                        branch.current
                          ? "composer-menu-option composer-utility-git-branch-option is-selected is-current"
                          : "composer-menu-option composer-utility-git-branch-option"
                      }
                      disabled={branch.current || isBusy}
                      onClick={() => void handleCheckoutBranch(branch.name)}
                    >
                      <span className="composer-menu-option-copy composer-utility-git-branch-meta">
                        <strong>{branch.name}</strong>
                        <small>{branch.current ? "Current branch" : branch.kind === "remote" ? "Remote branch" : "Local branch"}</small>
                      </span>
                      <span className="composer-menu-option-check">
                        {branch.current ? (
                          "Current"
                        ) : (
                          <>
                            {branch.kind === "remote" ? <span className="git-branch-badge">Remote</span> : null}
                            {isPending ? "Switching..." : "Switch"}
                          </>
                        )}
                      </span>
                    </button>
                  )
                })
              ) : (
                <p className="composer-menu-empty">No branches are available.</p>
              )}
            </div>

            <div className="composer-utility-git-branch-footer">
              <button
                type="button"
                className="secondary-button composer-utility-git-branch-create-button"
                disabled={isBusy || !capabilities.canCreateBranch.enabled}
                title={capabilities.canCreateBranch.enabled ? "Create and switch to a new branch." : capabilities.canCreateBranch.reason}
                onClick={() => {
                  setErrorMessage("")
                  setIsPanelOpen(false)
                  setIsCreateDialogOpen(true)
                }}
              >
                Create and switch branch
              </button>
            </div>

            {errorMessage ? (
              <p className="composer-utility-git-branch-status is-error" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {isCreateDialogOpen ? (
        <div
          className="git-branch-create-overlay"
          role="presentation"
          onClick={(event) => {
            if (event.target !== event.currentTarget || pendingAction === "create") return
            setIsCreateDialogOpen(false)
            setBranchName("")
            setErrorMessage("")
          }}
        >
          <article
            className="git-branch-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Create and checkout branch"
          >
            <label className="git-branch-create-field">
              <span>Branch name</span>
              <input
                ref={branchInputRef}
                type="text"
                value={branchName}
                placeholder="Enter a branch name"
                onChange={(event) => setBranchName(event.target.value)}
                onKeyDown={handleBranchNameKeyDown}
              />
            </label>

            {errorMessage ? (
              <p className="git-branch-create-error" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <div className="git-branch-create-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={pendingAction === "create"}
                onClick={() => {
                  setIsCreateDialogOpen(false)
                  setBranchName("")
                  setErrorMessage("")
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={pendingAction === "create" || !capabilities.canCreateBranch.enabled}
                title={capabilities.canCreateBranch.enabled ? "Create and switch to a new branch." : capabilities.canCreateBranch.reason}
                onClick={() => void handleCreateAndCheckoutBranch()}
              >
                {pendingAction === "create" ? "Creating..." : "Create and switch"}
              </button>
            </div>
          </article>
        </div>
      ) : null}
    </>
  )
}
