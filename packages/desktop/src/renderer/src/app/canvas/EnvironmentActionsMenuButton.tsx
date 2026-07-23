import { useCallback, useEffect, useRef, useState } from "react"
import type {
  AgentEnvironmentCandidate,
  AgentEnvironmentIPCEvent,
  AgentEnvironmentRunRecord,
} from "../../../../shared/desktop-ipc-contract"
import { useI18n } from "../i18n/I18nProvider"
import { PlayIcon, SettingsIcon, StopIcon, TerminalIcon } from "../icons"
import { requestOpenEnvironmentSettings } from "../settings/events"
import { requestOpenPtySession } from "../terminal/events"

interface EnvironmentActionsMenuButtonProps {
  directory: string | null
  projectID: string | null
  sessionID: string
}

function readRunFromEvent(event: AgentEnvironmentIPCEvent) {
  if (!event.event.startsWith("environment.run.")) return null
  const data = event.data as { run?: AgentEnvironmentRunRecord } | null
  return data?.run ?? null
}

export function EnvironmentActionsMenuButton({
  directory,
  projectID,
  sessionID,
}: EnvironmentActionsMenuButtonProps) {
  const { t } = useI18n()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [candidate, setCandidate] = useState<AgentEnvironmentCandidate | null>(null)
  const [runs, setRuns] = useState<Record<string, AgentEnvironmentRunRecord>>({})
  const [busyActionID, setBusyActionID] = useState<string | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectID || !directory || !window.desktop?.listProjectEnvironments) {
      setCandidate(null)
      return
    }
    try {
      const result = await window.desktop.listProjectEnvironments({ projectID, directory })
      const next =
        result.items.find((item) => item.key === result.selectedKey) ??
        result.items[0] ??
        null
      setCandidate(next?.definition ? next : null)
    } catch (loadError) {
      console.error("[desktop] environment action discovery failed:", loadError)
      setCandidate(null)
    }
  }, [directory, projectID])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    return window.desktop?.onEnvironmentEvent?.((event) => {
      const run = readRunFromEvent(event)
      if (
        run &&
        run.sessionID === sessionID &&
        run.kind === "action" &&
        run.actionID
      ) {
        setRuns((current) => ({
          ...current,
          [run.actionID!]: run,
        }))
      }

      if (event.event === "environment.definition.changed") {
        const data = event.data as { projectID?: string; directory?: string } | null
        if (data?.projectID === projectID) void load()
      }
    })
  }, [load, projectID, sessionID])

  useEffect(() => {
    if (!isMenuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target || menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setIsMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isMenuOpen])

  if (!candidate?.definition) return null
  const definition = candidate.definition
  if (definition.actions.length === 0 && !definition.setup) return null

  async function startAction(actionID: string) {
    if (!projectID || !candidate || busyActionID) return
    setBusyActionID(actionID)
    setError(null)
    try {
      const result = await window.desktop?.startEnvironmentAction?.({
        projectID,
        environmentKey: candidate.key,
        expectedHash: candidate.contentHash,
        actionID,
        sessionID,
      })
      if (!result) throw new Error(t("environment.actions.bridgeUnavailable"))
      setRuns((current) => ({ ...current, [actionID]: result.run }))
      requestOpenPtySession(result.pty)
      setIsMenuOpen(false)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError))
    } finally {
      setBusyActionID(null)
    }
  }

  async function stopAction(actionID: string) {
    if (!projectID || !candidate || busyActionID) return
    setBusyActionID(actionID)
    setError(null)
    try {
      const run = await window.desktop?.stopEnvironmentAction?.({
        projectID,
        environmentKey: candidate.key,
        actionID,
        sessionID,
      })
      if (run) setRuns((current) => ({ ...current, [actionID]: run }))
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : String(stopError))
    } finally {
      setBusyActionID(null)
    }
  }

  async function restartSetup() {
    if (!projectID || !candidate || busyActionID) return
    setBusyActionID("__setup__")
    setError(null)
    try {
      const run = await window.desktop?.restartEnvironmentSetup?.({
        projectID,
        environmentKey: candidate.key,
        expectedHash: candidate.contentHash,
        sessionID,
      })
      if (!run) throw new Error(t("environment.actions.setupUnavailable"))
      setIsMenuOpen(false)
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : String(setupError))
    } finally {
      setBusyActionID(null)
    }
  }

  return (
    <div className="canvas-top-menu-selector-anchor environment-actions-menu-anchor">
      <button
        ref={buttonRef}
        className={isMenuOpen ? "canvas-top-menu-button environment-actions-trigger is-active" : "canvas-top-menu-button environment-actions-trigger"}
        type="button"
        aria-label={t("environment.actions.buttonAria", { name: definition.name })}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen}
        title={t("environment.actions.buttonTitle", { name: definition.name })}
        onClick={() => {
          setError(null)
          setIsMenuOpen((current) => !current)
          if (!isMenuOpen) void load()
        }}
      >
        <TerminalIcon />
        <span className={candidate.trusted ? "environment-actions-trust-dot is-trusted" : "environment-actions-trust-dot"} />
      </button>

      {isMenuOpen ? (
        <div
          ref={menuRef}
          className="canvas-top-menu-selector-panel canvas-top-menu-context-panel environment-actions-panel"
          role="menu"
          aria-label={t("environment.actions.menuAria", { name: definition.name })}
        >
          <header className="environment-actions-panel-header">
            <span>{definition.name}</span>
            <small>
              {candidate.trusted
                ? t("environment.actions.trusted")
                : t("environment.actions.untrusted")}
            </small>
          </header>

          {definition.actions.map((action) => {
            const run = runs[action.id]
            const running = run?.status === "queued" || run?.status === "running"
            return (
              <div key={action.id} className="environment-actions-option-row">
                <button
                  className="canvas-top-menu-context-option environment-actions-option"
                  type="button"
                  role="menuitem"
                  disabled={!candidate.trusted || busyActionID !== null}
                  onClick={() => void startAction(action.id)}
                >
                  <span className="canvas-top-menu-context-option-label">
                    <PlayIcon />
                    <strong>{action.name}</strong>
                  </span>
                  <span className="canvas-top-menu-context-option-status">
                    {running
                      ? t("environment.actions.running")
                      : run?.status === "failed"
                        ? t("environment.actions.failed")
                        : ""}
                  </span>
                </button>
                {running ? (
                  <button
                    className="environment-action-stop"
                    type="button"
                    aria-label={t("environment.actions.stop", { name: action.name })}
                    disabled={busyActionID !== null}
                    onClick={() => void stopAction(action.id)}
                  >
                    <StopIcon />
                  </button>
                ) : null}
              </div>
            )
          })}

          {definition.setup && candidate.scope === "bound" ? (
            <>
              <div className="environment-actions-divider" role="separator" />
              <button
                className="canvas-top-menu-context-option"
                type="button"
                role="menuitem"
                disabled={!candidate.trusted || busyActionID !== null}
                onClick={() => void restartSetup()}
              >
                <span className="canvas-top-menu-context-option-label">
                  <span aria-hidden="true">↻</span>
                  <strong>{t("environment.actions.reinitialize")}</strong>
                </span>
              </button>
            </>
          ) : null}

          <button
            className="canvas-top-menu-context-option"
            type="button"
            role="menuitem"
            onClick={() => {
              setIsMenuOpen(false)
              requestOpenEnvironmentSettings()
            }}
          >
            <span className="canvas-top-menu-context-option-label">
              <SettingsIcon />
              <strong>{t("environment.actions.openSettings")}</strong>
            </span>
          </button>

          {!candidate.trusted ? (
            <p className="environment-actions-message">{t("environment.actions.trustRequired")}</p>
          ) : null}
          {error ? <p className="environment-actions-message is-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
