import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react"
import { createPortal } from "react-dom"
import type { AgentSessionBackgroundProcessList } from "../../../../shared/desktop-ipc-contract"
import { ChevronDownIcon, MoreIcon, SessionRunningIcon, StopIcon, TerminalIcon } from "../icons"

const POLL_INTERVAL_MS = 2_000
const ACTION_MENU_WIDTH = 224
const ACTION_MENU_HEIGHT = 46
const ACTION_MENU_GAP = 6
const ACTION_MENU_MARGIN = 8

type BackgroundProcess = AgentSessionBackgroundProcessList["items"][number]

interface ActionMenuState {
  kind: "all" | "process"
  processID?: string
  left: number
  top: number
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return "强制终止失败，请稍后重试。"
}

function getActionMenuPosition(trigger: HTMLButtonElement) {
  const rect = trigger.getBoundingClientRect()
  const left = Math.max(
    ACTION_MENU_MARGIN,
    Math.min(rect.right - ACTION_MENU_WIDTH, window.innerWidth - ACTION_MENU_WIDTH - ACTION_MENU_MARGIN),
  )
  const availableBelow = window.innerHeight - rect.bottom - ACTION_MENU_GAP - ACTION_MENU_MARGIN
  const top = availableBelow >= ACTION_MENU_HEIGHT
    ? rect.bottom + ACTION_MENU_GAP
    : Math.max(ACTION_MENU_MARGIN, rect.top - ACTION_MENU_HEIGHT - ACTION_MENU_GAP)

  return { left, top }
}

function getProcessTooltip(process: BackgroundProcess) {
  return [
    process.command,
    `工作目录：${process.cwd}`,
    `Shell：${process.shell}`,
    `TTY：${process.tty ? "是" : "否"}`,
  ].join("\n")
}

export function SessionBackgroundProcessesSection({ sessionID }: { sessionID: string }) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null)
  const sessionGenerationRef = useRef(0)
  const requestSequenceRef = useRef(0)
  const latestAppliedRequestRef = useRef(0)
  const requestInFlightRef = useRef(false)
  const hadProcessesRef = useRef(false)
  const [items, setItems] = useState<BackgroundProcess[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [actionMenu, setActionMenu] = useState<ActionMenuState | null>(null)
  const [busyProcessIDs, setBusyProcessIDs] = useState<Set<string>>(() => new Set())
  const [isTerminatingAll, setIsTerminatingAll] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const applyItems = useCallback((nextItems: BackgroundProcess[]) => {
    const hasProcesses = nextItems.length > 0
    if (!hadProcessesRef.current && hasProcesses) setIsOpen(true)
    if (!hasProcesses) {
      setIsOpen(false)
      setErrorMessage(null)
    }
    setActionMenu((current) => (
      current?.processID && !nextItems.some((item) => item.id === current.processID)
        ? null
        : current
    ))
    hadProcessesRef.current = hasProcesses
    setItems(nextItems)
  }, [])

  const refreshProcesses = useCallback(async () => {
    const api = window.desktop?.getSessionBackgroundProcesses
    if (!api) throw new Error("后台进程控制当前不可用。")

    const generation = sessionGenerationRef.current
    const requestSequence = ++requestSequenceRef.current
    const result = await api({ sessionID })
    if (
      generation !== sessionGenerationRef.current ||
      requestSequence < latestAppliedRequestRef.current
    ) return null
    latestAppliedRequestRef.current = requestSequence
    applyItems(result.items)
    return result.items
  }, [applyItems, sessionID])

  useEffect(() => {
    sessionGenerationRef.current += 1
    hadProcessesRef.current = false
    requestInFlightRef.current = false
    setItems([])
    setIsOpen(false)
    setActionMenu(null)
    setBusyProcessIDs(new Set())
    setIsTerminatingAll(false)
    setErrorMessage(null)

    let disposed = false
    const poll = async () => {
      if (disposed || requestInFlightRef.current) return
      requestInFlightRef.current = true
      try {
        await refreshProcesses()
      } catch {
        // A later poll retries. Existing rows remain visible if the service is temporarily unavailable.
      } finally {
        requestInFlightRef.current = false
      }
    }

    void poll()
    const intervalID = window.setInterval(() => void poll(), POLL_INTERVAL_MS)

    return () => {
      disposed = true
      sessionGenerationRef.current += 1
      requestInFlightRef.current = false
      window.clearInterval(intervalID)
    }
  }, [refreshProcesses, sessionID])

  const closeActionMenu = useCallback(({ restoreFocus = false } = {}) => {
    setActionMenu(null)
    if (restoreFocus) activeTriggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!actionMenu) return

    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>(".ui-context-menu__item:not(:disabled)")?.focus()
    })

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (menuRef.current?.contains(target) || activeTriggerRef.current?.contains(target)) return
      closeActionMenu()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      closeActionMenu({ restoreFocus: true })
    }

    const handleViewportChange = () => closeActionMenu()

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("scroll", handleViewportChange, true)

    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("scroll", handleViewportChange, true)
    }
  }, [actionMenu, closeActionMenu])

  function openActionMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    target: Pick<ActionMenuState, "kind" | "processID">,
  ) {
    const trigger = event.currentTarget
    if (actionMenu?.kind === target.kind && actionMenu.processID === target.processID) {
      closeActionMenu()
      return
    }
    activeTriggerRef.current = trigger
    setActionMenu({ ...target, ...getActionMenuPosition(trigger) })
  }

  function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      if (event.key === "Tab") closeActionMenu()
      return
    }

    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(".ui-context-menu__item:not(:disabled)") ?? [],
    )
    if (menuItems.length === 0) return

    event.preventDefault()
    const currentIndex = menuItems.findIndex((item) => item === document.activeElement)
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? menuItems.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1 + menuItems.length) % menuItems.length
          : (currentIndex - 1 + menuItems.length) % menuItems.length
    menuItems[nextIndex]?.focus()
  }

  async function refreshAfterFailure(error: unknown, processID?: string) {
    let actualItems: BackgroundProcess[] | null = null
    try {
      actualItems = await refreshProcesses()
    } catch {
      actualItems = processID ? items.filter((item) => item.id === processID) : items
    }
    const processStillExists = processID
      ? actualItems?.some((item) => item.id === processID)
      : Boolean(actualItems?.length)
    if (processStillExists) setErrorMessage(getErrorMessage(error))
  }

  async function terminateProcess(processID: string) {
    closeActionMenu()
    const generation = sessionGenerationRef.current
    const api = window.desktop?.terminateSessionBackgroundProcess
    if (!api) {
      await refreshAfterFailure(new Error("后台进程控制当前不可用。"), processID)
      return
    }

    setErrorMessage(null)
    setBusyProcessIDs((current) => new Set(current).add(processID))
    try {
      const result = await api({ sessionID, processID })
      if (generation !== sessionGenerationRef.current) return
      if (result.terminated) applyItems(items.filter((item) => item.id !== processID))
      await refreshProcesses()
    } catch (error) {
      if (generation !== sessionGenerationRef.current) return
      await refreshAfterFailure(error, processID)
    } finally {
      if (generation === sessionGenerationRef.current) {
        setBusyProcessIDs((current) => {
          const next = new Set(current)
          next.delete(processID)
          return next
        })
      }
    }
  }

  async function terminateAllProcesses() {
    closeActionMenu()
    if (!window.confirm(`确定强制终止此会话的 ${items.length} 个后台进程吗？进程中的未保存状态将丢失。`)) return

    const generation = sessionGenerationRef.current
    const api = window.desktop?.terminateAllSessionBackgroundProcesses
    if (!api) {
      await refreshAfterFailure(new Error("后台进程控制当前不可用。"))
      return
    }

    setErrorMessage(null)
    setIsTerminatingAll(true)
    try {
      const result = await api({ sessionID })
      if (generation !== sessionGenerationRef.current) return
      const terminatedIDs = new Set(result.terminatedProcessIDs)
      if (terminatedIDs.size > 0) applyItems(items.filter((item) => !terminatedIDs.has(item.id)))
      await refreshProcesses()
    } catch (error) {
      if (generation !== sessionGenerationRef.current) return
      await refreshAfterFailure(error)
    } finally {
      if (generation === sessionGenerationRef.current) setIsTerminatingAll(false)
    }
  }

  if (items.length === 0) return null

  const menuProcess = actionMenu?.processID
    ? items.find((item) => item.id === actionMenu.processID)
    : undefined
  const menuBusy = isTerminatingAll || Boolean(menuProcess && busyProcessIDs.has(menuProcess.id))

  return (
    <>
      <section className="session-background-processes" aria-label="后台进程">
        <div className="session-background-processes-header">
          <button
            type="button"
            className="session-background-processes-toggle"
            aria-expanded={isOpen}
            aria-label={isOpen ? "收起后台进程" : "展开后台进程"}
            onClick={() => setIsOpen((current) => !current)}
          >
            <span className="task-progress-menu-title-row">
              <span className="task-progress-menu-icon" aria-hidden="true"><TerminalIcon /></span>
              <span className="task-progress-menu-title">后台进程</span>
              <span className="session-background-processes-count">{items.length}</span>
            </span>
            <span className={isOpen ? "task-progress-menu-chevron is-open" : "task-progress-menu-chevron"} aria-hidden="true">
              <ChevronDownIcon />
            </span>
          </button>
          <button
            type="button"
            className={actionMenu?.kind === "all" ? "session-background-processes-action is-active" : "session-background-processes-action"}
            aria-label="后台进程操作"
            aria-expanded={actionMenu?.kind === "all"}
            aria-haspopup="menu"
            disabled={isTerminatingAll}
            onClick={(event) => openActionMenu(event, { kind: "all" })}
          >
            <MoreIcon />
          </button>
        </div>

        {isOpen ? (
          <ol className="session-background-processes-list">
            {items.map((process) => {
              const isBusy = isTerminatingAll || busyProcessIDs.has(process.id)
              return (
                <li key={process.id} className="session-background-processes-row" title={getProcessTooltip(process)}>
                  <span className="session-background-processes-running-icon" aria-hidden="true"><SessionRunningIcon /></span>
                  <span className="session-background-processes-title">{process.title || process.command}</span>
                  <button
                    type="button"
                    className={actionMenu?.processID === process.id ? "session-background-processes-action is-active" : "session-background-processes-action"}
                    aria-label={`后台进程操作：${process.title || process.command}`}
                    aria-expanded={actionMenu?.processID === process.id}
                    aria-haspopup="menu"
                    disabled={isBusy}
                    onClick={(event) => openActionMenu(event, { kind: "process", processID: process.id })}
                  >
                    <MoreIcon />
                  </button>
                </li>
              )
            })}
          </ol>
        ) : null}

        {errorMessage ? <div className="session-background-processes-error" role="status">{errorMessage}</div> : null}
      </section>
      <div className="task-progress-menu-divider" />

      {actionMenu
        ? createPortal(
            <div
              ref={menuRef}
              className="ui-context-menu session-background-processes-menu"
              data-session-info-popover="true"
              role="menu"
              aria-label={actionMenu.kind === "all" ? "后台进程操作" : `后台进程操作：${menuProcess?.title ?? ""}`}
              style={{ left: actionMenu.left, top: actionMenu.top }}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={handleMenuKeyDown}
            >
              <button
                type="button"
                className="ui-context-menu__item"
                data-variant="danger"
                disabled={menuBusy}
                role="menuitem"
                onClick={() => {
                  if (actionMenu.kind === "all") void terminateAllProcesses()
                  else if (actionMenu.processID) void terminateProcess(actionMenu.processID)
                }}
              >
                <span className="ui-context-menu__icon" aria-hidden="true"><StopIcon /></span>
                <span className="ui-context-menu__label">
                  {actionMenu.kind === "all" ? "终止全部后台进程" : "强制终止"}
                </span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
