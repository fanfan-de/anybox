import { memo, useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { CloseIcon, PlusIcon } from "../icons"
import { joinClassNames } from "../shared-ui"
import { TerminalPanelToggleButton } from "./TerminalPanelToggleButton"
import type { TerminalSessionRecord, TerminalShellProfile } from "./types"

interface TerminalTabsProps {
  activePtyID: string | null
  canCreateTerminal?: boolean
  isCreatingTerminal?: boolean
  showToggleButton?: boolean
  sessions: TerminalSessionRecord[]
  onCloseTerminal: (ptyID: string) => void | Promise<void>
  onCreateTerminal: (profileID: string) => void | Promise<void>
  onShellProfileChange: (profileID: string) => void
  onSelectTerminal: (ptyID: string) => void
  selectedShellProfileID: string
  shellProfiles: TerminalShellProfile[]
  onTogglePanel: () => void | Promise<void>
}

function formatTerminalStatus(session: TerminalSessionRecord) {
  if (session.status === "invalid") return "Unavailable"
  if (session.status === "deleted") return "Deleted"
  if (session.status === "exited") {
    return session.exitCode === null ? "Exited" : `Exited (${String(session.exitCode)})`
  }

  if (session.transportState === "connecting") return "Connecting"
  if (session.transportState === "error") return "Reconnect failed"
  if (session.transportState === "disconnected") return "Reconnect pending"
  return "Running"
}

function getFirstProfileIndex(options: TerminalShellProfile[]) {
  return options.length > 0 ? 0 : -1
}

function getSelectedIndex(options: TerminalShellProfile[], value: string) {
  return options.findIndex((option) => option.id === value)
}

function getNextEnabledIndex(options: TerminalShellProfile[], currentIndex: number, direction: 1 | -1) {
  if (options.length === 0) return -1

  for (let offset = 1; offset <= options.length; offset += 1) {
    const nextIndex = (currentIndex + offset * direction + options.length) % options.length
    if (options[nextIndex]) return nextIndex
  }

  return -1
}

export interface TerminalShellPickerProps {
  disabled: boolean
  onChange: (profileID: string) => void
  profiles: TerminalShellProfile[]
  selectedProfileID: string
}

export function TerminalShellPicker({
  disabled,
  onChange,
  profiles,
  selectedProfileID,
}: TerminalShellPickerProps) {
  const listboxID = useId()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const selectedIndex = getSelectedIndex(profiles, selectedProfileID)
  const selectedProfile = selectedIndex >= 0 ? profiles[selectedIndex] : null
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() =>
    selectedIndex >= 0 ? selectedIndex : getFirstProfileIndex(profiles),
  )

  useEffect(() => {
    if (isOpen) return
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : getFirstProfileIndex(profiles))
  }, [isOpen, profiles, selectedIndex])

  useEffect(() => {
    if (!isOpen) return
    panelRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (disabled) setIsOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!isOpen) return

    function handleDocumentPointerDown(event: globalThis.PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return

      setIsOpen(false)
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown)
    return () => document.removeEventListener("pointerdown", handleDocumentPointerDown)
  }, [isOpen])

  function openPicker(index = selectedIndex >= 0 ? selectedIndex : getFirstProfileIndex(profiles)) {
    if (disabled) return
    setActiveIndex(index)
    setIsOpen(true)
  }

  function closePicker({ restoreFocus = true }: { restoreFocus?: boolean } = {}) {
    setIsOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  function commitProfile(index: number) {
    const profile = profiles[index]
    if (!profile) return

    onChange(profile.id)
    closePicker()
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      const index = selectedIndex >= 0 ? selectedIndex : getFirstProfileIndex(profiles)
      openPicker(index >= 0 ? index : 0)
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      openPicker(profiles.length - 1)
      return
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      if (isOpen) {
        commitProfile(activeIndex)
        return
      }

      openPicker()
    }
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closePicker()
      return
    }

    if (event.key === "Tab") {
      setIsOpen(false)
      return
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const nextIndex = getNextEnabledIndex(profiles, activeIndex, event.key === "ArrowDown" ? 1 : -1)
      if (nextIndex >= 0) setActiveIndex(nextIndex)
      return
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      setActiveIndex(event.key === "Home" ? getFirstProfileIndex(profiles) : profiles.length - 1)
      return
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      commitProfile(activeIndex)
    }
  }

  return (
    <div className={joinClassNames("terminal-shell-picker-select", isOpen && "is-open")}>
      <button
        ref={buttonRef}
        aria-controls={isOpen ? listboxID : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label="Terminal shell profile"
        className="terminal-shell-picker-trigger"
        disabled={disabled}
        role="combobox"
        title={selectedProfile?.label ?? "Default"}
        type="button"
        onClick={() => {
          if (isOpen) {
            closePicker({ restoreFocus: false })
            return
          }

          openPicker()
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="terminal-shell-picker-value">{selectedProfile?.label ?? "Default"}</span>
      </button>

      {isOpen ? (
        <div
          ref={panelRef}
          aria-label="Terminal shell profile"
          className="terminal-shell-picker-panel"
          id={listboxID}
          role="listbox"
          tabIndex={-1}
          onKeyDown={handlePanelKeyDown}
        >
          {profiles.map((profile, index) => {
            const isSelected = profile.id === selectedProfileID
            const isActive = index === activeIndex

            return (
              <button
                key={profile.id}
                aria-selected={isSelected}
                className={joinClassNames(
                  "terminal-shell-picker-option",
                  isSelected && "is-selected",
                  isActive && "is-active",
                )}
                role="option"
                tabIndex={-1}
                title={profile.label}
                type="button"
                onClick={() => commitProfile(index)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span>{profile.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export const TerminalTabs = memo(function TerminalTabs({
  activePtyID,
  canCreateTerminal = true,
  isCreatingTerminal = false,
  showToggleButton = true,
  sessions,
  onCloseTerminal,
  onCreateTerminal,
  onShellProfileChange,
  onSelectTerminal,
  selectedShellProfileID,
  shellProfiles,
  onTogglePanel,
}: TerminalTabsProps) {
  const selectedShellLabel = shellProfiles.find((profile) => profile.id === selectedShellProfileID)?.label ?? "Default"

  return (
    <div className="terminal-tabs">
      {showToggleButton ? <TerminalPanelToggleButton isOpen={true} onToggle={onTogglePanel} /> : null}

      <div className="terminal-tabs-list" aria-label="Session terminal">
        {sessions.map((session) => {
          const isActive = session.ptyID === activePtyID
          return (
            <div key={session.ptyID} className={isActive ? "terminal-tab is-active" : "terminal-tab"}>
              <button
                className="terminal-tab-trigger"
                aria-label={`${session.title}, ${formatTerminalStatus(session)}`}
                id={`terminal-tab-${session.ptyID}`}
                onClick={() => onSelectTerminal(session.ptyID)}
                type="button"
              >
                <span className="terminal-tab-title">{session.title}</span>
              </button>

              <button
                className="terminal-tab-close"
                aria-label={`Close terminal ${session.title}`}
                onClick={() => void onCloseTerminal(session.ptyID)}
                type="button"
              >
                <CloseIcon />
              </button>
            </div>
          )
        })}
      </div>

      <div className="terminal-tabs-actions">
        <div className="terminal-shell-picker">
          <span className="terminal-shell-picker-label">Shell</span>
          <TerminalShellPicker
            disabled={!canCreateTerminal || isCreatingTerminal}
            onChange={onShellProfileChange}
            profiles={shellProfiles}
            selectedProfileID={selectedShellProfileID}
          />
        </div>

        {canCreateTerminal ? (
          <button
            className="terminal-panel-create"
            aria-label={`Create terminal (${selectedShellLabel})`}
            disabled={isCreatingTerminal}
            title={`New terminal (${selectedShellLabel})`}
            onClick={() => void onCreateTerminal(selectedShellProfileID)}
            type="button"
          >
            <PlusIcon />
          </button>
        ) : null}
      </div>
    </div>
  )
})
