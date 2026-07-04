import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import type {
  AgentFolderWorkspace,
  AgentSshDirectoryEntry,
  AgentSshProfile,
} from "../../../../shared/desktop-ipc-contract"
import {
  ArrowUpIcon,
  ChevronRightIcon,
  EditIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreIcon,
  ResetIcon,
  SearchIcon,
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { useToast } from "../toast"

interface SshDraft {
  id?: string
  name: string
  host: string
  port: string
  username: string
  privateKeyPath: string
  defaultRemotePath: string
  passphrase: string
}

interface SshConnectionsPageProps {
  searchQuery: string
  onWorkspaceOpened?: (workspace: AgentFolderWorkspace) => void | Promise<void>
}

interface SshPageMessage {
  tone: "success" | "error" | "info"
  text: string
}

interface SshPathCrumb {
  label: string
  path: string
}

const EMPTY_DRAFT: SshDraft = {
  name: "",
  host: "",
  port: "22",
  username: "",
  privateKeyPath: "",
  defaultRemotePath: "/",
  passphrase: "",
}

function profileMatches(profile: AgentSshProfile, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return [profile.name, profile.host, profile.username, profile.defaultRemotePath].some((value) =>
    value.toLowerCase().includes(normalized),
  )
}

function parentPath(remotePath: string) {
  const trimmed = remotePath.replace(/\/+$/, "")
  if (!trimmed || trimmed === "/") return "/"
  return trimmed.replace(/\/[^/]+$/, "") || "/"
}

function normalizeRemotePath(input: string) {
  const trimmed = input.trim().replace(/\\/g, "/")
  if (!trimmed.startsWith("/")) return null
  const normalized = trimmed.replace(/\/+/g, "/")
  if (normalized === "/") return "/"
  return normalized.replace(/\/+$/, "")
}

function getPathCrumbs(remotePath: string): SshPathCrumb[] {
  const normalized = normalizeRemotePath(remotePath) ?? "/"
  const segments = normalized.split("/").filter(Boolean)
  const crumbs: SshPathCrumb[] = [{ label: "/", path: "/" }]
  let currentPath = ""

  for (const segment of segments) {
    currentPath = `${currentPath}/${segment}`
    crumbs.push({ label: segment, path: currentPath })
  }

  return crumbs
}

function getEntryTypeRank(entry: AgentSshDirectoryEntry) {
  if (entry.type === "directory") return 0
  if (entry.type === "file") return 1
  return 2
}

function sortDirectoryEntries(entries: AgentSshDirectoryEntry[]) {
  return [...entries].sort((left, right) => {
    const rankDifference = getEntryTypeRank(left) - getEntryTypeRank(right)
    if (rankDifference !== 0) return rankDifference
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    })
  })
}

function entryMatchesFilter(entry: AgentSshDirectoryEntry, filter: string) {
  const normalizedFilter = filter.trim().toLowerCase()
  if (!normalizedFilter) return true
  return `${entry.name} ${entry.path}`.toLowerCase().includes(normalizedFilter)
}

function formatFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B"

  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

function formatRemoteModifiedAt(modifiedAt: number) {
  if (!Number.isFinite(modifiedAt) || modifiedAt <= 0) return ""
  const timestamp = modifiedAt < 1_000_000_000_000 ? modifiedAt * 1000 : modifiedAt
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ""

  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, [contenteditable='true']"))
}

export function SshConnectionsPage({ searchQuery, onWorkspaceOpened }: SshConnectionsPageProps) {
  const { t } = useI18n()
  const toast = useToast()
  const [profiles, setProfiles] = useState<AgentSshProfile[]>([])
  const [draft, setDraft] = useState<SshDraft>(EMPTY_DRAFT)
  const [activeProfileID, setActiveProfileID] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState("/")
  const [pathDraft, setPathDraft] = useState("/")
  const [isEditingPath, setIsEditingPath] = useState(false)
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(null)
  const [directoryFilter, setDirectoryFilter] = useState("")
  const [entries, setEntries] = useState<AgentSshDirectoryEntry[]>([])
  const [message, setMessage] = useState<SshPageMessage | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const loadRequestIDRef = useRef(0)
  const pathInputRef = useRef<HTMLInputElement | null>(null)

  const filteredProfiles = useMemo(
    () => profiles.filter((profile) => profileMatches(profile, searchQuery)),
    [profiles, searchQuery],
  )
  const activeProfile = profiles.find((profile) => profile.id === activeProfileID) ?? null
  const visibleEntries = useMemo(
    () => entries.filter((entry) => entryMatchesFilter(entry, directoryFilter)),
    [directoryFilter, entries],
  )
  const selectedEntry = visibleEntries.find((entry) => entry.path === selectedEntryPath) ?? null
  const workspaceTargetPath = selectedEntry?.type === "directory" ? selectedEntry.path : currentPath
  const pathCrumbs = useMemo(() => getPathCrumbs(currentPath), [currentPath])

  useEffect(() => {
    if (!isEditingPath) return
    pathInputRef.current?.focus()
    pathInputRef.current?.select()
  }, [isEditingPath])

  function selectProfile(profile: AgentSshProfile) {
    const nextPath = normalizeRemotePath(profile.defaultRemotePath) ?? "/"
    loadRequestIDRef.current += 1
    setActiveProfileID(profile.id)
    setDraft({
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: String(profile.port),
      username: profile.username,
      privateKeyPath: profile.privateKeyPath,
      defaultRemotePath: profile.defaultRemotePath,
      passphrase: "",
    })
    setCurrentPath(nextPath)
    setPathDraft(nextPath)
    setIsEditingPath(false)
    setSelectedEntryPath(null)
    setDirectoryFilter("")
    setEntries([])
    setMessage(null)
  }

  function startNewProfile() {
    loadRequestIDRef.current += 1
    setDraft(EMPTY_DRAFT)
    setActiveProfileID(null)
    setCurrentPath("/")
    setPathDraft("/")
    setIsEditingPath(false)
    setSelectedEntryPath(null)
    setDirectoryFilter("")
    setEntries([])
    setMessage(null)
  }

  async function loadProfiles() {
    const nextProfiles = await window.desktop!.listSshProfiles?.()
    setProfiles(nextProfiles ?? [])
    if (!activeProfileID && nextProfiles?.[0]) {
      selectProfile(nextProfiles[0])
    }
  }

  useEffect(() => {
    void loadProfiles().catch((error) => {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) })
    })
  }, [])

  function validateDraft() {
    if (!draft.name.trim()) return t("ssh.validation.requireName")
    if (!draft.host.trim()) return t("ssh.validation.requireHost")
    if (!draft.username.trim()) return t("ssh.validation.requireUsername")
    if (!draft.privateKeyPath.trim()) return t("ssh.validation.requirePrivateKey")
    if (!draft.defaultRemotePath.trim().startsWith("/")) return t("ssh.validation.defaultPathAbsolute")
    const port = Number.parseInt(draft.port, 10)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return t("ssh.validation.portRange")
    return null
  }

  async function saveProfile() {
    const validationError = validateDraft()
    if (validationError) {
      setMessage({ tone: "error", text: validationError })
      return
    }
    setIsBusy(true)
    setMessage(null)
    try {
      const saved = await window.desktop!.saveSshProfile?.({
        id: draft.id,
        name: draft.name,
        host: draft.host,
        port: Number.parseInt(draft.port, 10) || 22,
        username: draft.username,
        privateKeyPath: draft.privateKeyPath,
        defaultRemotePath: draft.defaultRemotePath || "/",
        passphrase: draft.passphrase || undefined,
      })
      if (saved) {
        await loadProfiles()
        selectProfile(saved)
        toast.success(t("ssh.profile.saved"))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  async function deleteProfile() {
    if (!draft.id) return
    setIsBusy(true)
    setMessage(null)
    try {
      await window.desktop!.deleteSshProfile?.({ profileID: draft.id })
      loadRequestIDRef.current += 1
      setDraft(EMPTY_DRAFT)
      setActiveProfileID(null)
      setEntries([])
      await loadProfiles()
      toast.success(t("ssh.profile.deleted"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  async function loadDirectory(path: string) {
    if (!activeProfileID) return false
    const normalizedPath = normalizeRemotePath(path)
    if (!normalizedPath) {
      setPathDraft(currentPath)
      setMessage({ tone: "error", text: t("ssh.browser.pathMustBeAbsolute") })
      return false
    }

    const requestID = loadRequestIDRef.current + 1
    loadRequestIDRef.current = requestID
    setIsBusy(true)
    setMessage(null)
    try {
      const listing = await window.desktop!.listSshDirectory?.({ profileID: activeProfileID, path: normalizedPath })
      if (loadRequestIDRef.current !== requestID) return false

      const nextPath = normalizeRemotePath(listing?.path ?? normalizedPath) ?? normalizedPath
      setCurrentPath(nextPath)
      setPathDraft(nextPath)
      setIsEditingPath(false)
      setSelectedEntryPath(null)
      setDirectoryFilter("")
      setEntries(sortDirectoryEntries(listing?.entries ?? []))
      return true
    } catch (error) {
      if (loadRequestIDRef.current !== requestID) return false
      setMessage({ tone: "error", text: error instanceof Error ? error.message : String(error) })
      setPathDraft(currentPath)
      return false
    } finally {
      if (loadRequestIDRef.current === requestID) {
        setIsBusy(false)
      }
    }
  }

  async function testProfile() {
    if (!draft.id) return
    setIsBusy(true)
    setMessage(null)
    try {
      const result = await window.desktop!.testSshProfile?.({ profileID: draft.id })
      const loaded = await loadDirectory(result?.remotePath ?? currentPath)
      if (loaded) {
        toast.success(result
          ? t("ssh.browser.connectedPath", { path: result.remotePath })
          : t("ssh.browser.connectionTestCompleted"))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  async function openWorkspace() {
    if (!activeProfileID) return
    setIsBusy(true)
    setMessage(null)
    try {
      const path = workspaceTargetPath
      const workspace = await window.desktop!.openSshFolderWorkspace?.({ profileID: activeProfileID, path })
      if (workspace) {
        await onWorkspaceOpened?.(workspace)
        toast.success(t("ssh.browser.openedWorkspace", { name: workspace.name }))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBusy(false)
    }
  }

  function startPathEditing() {
    setPathDraft(currentPath)
    setIsEditingPath(true)
  }

  function handlePathSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void loadDirectory(pathDraft)
  }

  function handlePathInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Escape") return
    event.preventDefault()
    setPathDraft(currentPath)
    setIsEditingPath(false)
  }

  function getEntryTypeLabel(entry: AgentSshDirectoryEntry) {
    if (entry.type === "directory") return t("ssh.browser.entryDirectory")
    if (entry.type === "file") return t("ssh.browser.entryFile")
    return t("ssh.browser.entryOther")
  }

  function getEntryMeta(entry: AgentSshDirectoryEntry) {
    const modified = formatRemoteModifiedAt(entry.modifiedAt)
    if (entry.type === "file") {
      return [formatFileSize(entry.size), modified].filter(Boolean).join(" - ")
    }
    return modified || getEntryTypeLabel(entry)
  }

  function handleBrowserKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!activeProfile) return

    const key = event.key
    const isCommandKey = event.ctrlKey || event.metaKey
    if (isCommandKey && key.toLowerCase() === "l") {
      event.preventDefault()
      startPathEditing()
      return
    }
    if (isCommandKey && key.toLowerCase() === "r") {
      event.preventDefault()
      void loadDirectory(currentPath)
      return
    }
    if (isCommandKey && key === "Enter") {
      event.preventDefault()
      void openWorkspace()
      return
    }
    if (isEditableKeyboardTarget(event.target)) return

    const selectedIndex = visibleEntries.findIndex((entry) => entry.path === selectedEntryPath)
    if (key === "ArrowDown") {
      event.preventDefault()
      const nextIndex = selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, visibleEntries.length - 1)
      setSelectedEntryPath(visibleEntries[nextIndex]?.path ?? null)
      return
    }
    if (key === "ArrowUp") {
      event.preventDefault()
      const nextIndex = selectedIndex < 0 ? visibleEntries.length - 1 : Math.max(selectedIndex - 1, 0)
      setSelectedEntryPath(visibleEntries[nextIndex]?.path ?? null)
      return
    }
    if (key === "Enter") {
      if (selectedEntry?.type !== "directory") return
      event.preventDefault()
      void loadDirectory(selectedEntry.path)
      return
    }
    if (key === "Backspace" && currentPath !== "/") {
      event.preventDefault()
      void loadDirectory(parentPath(currentPath))
    }
  }

  function renderEntryIcon(entry: AgentSshDirectoryEntry, isSelected: boolean) {
    if (entry.type === "directory") {
      return isSelected ? <FolderOpenIcon /> : <FolderIcon />
    }
    if (entry.type === "file") return <FileTextIcon />
    return <MoreIcon />
  }

  function renderDirectoryContent() {
    if (!activeProfile) {
      return (
        <div className="ssh-empty-state">
          <strong>{t("ssh.browser.noProfileTitle")}</strong>
          <span>{t("ssh.browser.noProfileCopy")}</span>
        </div>
      )
    }
    if (isBusy && entries.length === 0) {
      return (
        <div className="ssh-empty-state" role="status">
          <strong>{t("ssh.browser.loading")}</strong>
          <span>{currentPath}</span>
        </div>
      )
    }
    if (entries.length === 0) {
      return (
        <div className="ssh-empty-state">
          <strong>{t("ssh.browser.noEntriesTitle")}</strong>
          <span>{t("ssh.browser.noEntriesCopy")}</span>
          <button className="secondary-button" type="button" onClick={() => void loadDirectory(currentPath)}>
            {t("app.refresh")}
          </button>
        </div>
      )
    }
    if (visibleEntries.length === 0) {
      return (
        <div className="ssh-empty-state">
          <strong>{t("ssh.browser.noMatchesTitle")}</strong>
          <span>{t("ssh.browser.noMatchesCopy")}</span>
          <button className="secondary-button" type="button" onClick={() => setDirectoryFilter("")}>
            {t("ssh.browser.clearFilter")}
          </button>
        </div>
      )
    }

    return (
      <div className="ssh-directory-list" role="listbox" aria-label={t("ssh.browser.ariaList")}>
        {visibleEntries.map((entry) => {
          const isSelected = entry.path === selectedEntryPath
          const isUnavailable = entry.type === "other"

          return (
            <button
              key={`${entry.type}:${entry.path}`}
              type="button"
              role="option"
              aria-selected={isSelected}
              aria-label={`${entry.name}, ${getEntryTypeLabel(entry)}, ${entry.path}`}
              className={[
                "ssh-directory-row",
                isSelected ? "is-selected" : "",
                entry.type === "directory" ? "is-directory" : "",
                entry.type === "file" ? "is-file" : "",
                isUnavailable ? "is-unavailable" : "",
              ].filter(Boolean).join(" ")}
              disabled={isUnavailable}
              title={entry.path}
              onClick={() => setSelectedEntryPath(entry.path)}
              onDoubleClick={() => {
                if (entry.type === "directory") void loadDirectory(entry.path)
              }}
            >
              <span className="ssh-directory-icon" aria-hidden="true">
                {renderEntryIcon(entry, isSelected)}
              </span>
              <span className="ssh-directory-copy">
                <strong>{entry.name}</strong>
                <small>{entry.path}</small>
              </span>
              <span className="ssh-directory-meta">{getEntryMeta(entry)}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <section className="ssh-connections-page" aria-label={t("ssh.page.aria")}>
      <aside className="ssh-profile-sidebar" aria-label={t("ssh.profiles.aria")}>
        <div className="ssh-sidebar-header">
          <div>
            <h2>{t("ssh.profiles.title")}</h2>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={startNewProfile}
          >
            {t("ssh.profiles.new")}
          </button>
        </div>

        <div className="ssh-profile-list">
          {filteredProfiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={profile.id === activeProfileID ? "ssh-profile-card is-active" : "ssh-profile-card"}
              onClick={() => selectProfile(profile)}
            >
              <span className="ssh-profile-card-main">
                <strong>{profile.name}</strong>
                <span title={`${profile.username}@${profile.host}:${profile.port}`}>{profile.username}@{profile.host}:{profile.port}</span>
              </span>
              <span className="ssh-profile-card-path" title={profile.defaultRemotePath}>{profile.defaultRemotePath}</span>
            </button>
          ))}
          {filteredProfiles.length === 0 ? (
            <div className="ssh-empty-state">
              <strong>{t("ssh.profiles.emptyTitle")}</strong>
              <span>{t("ssh.profiles.emptyCopy")}</span>
            </div>
          ) : null}
        </div>
      </aside>

      <main className="ssh-detail-panel">
        <header className="ssh-detail-hero">
          <div>
            <h2>{draft.id ? draft.name || t("ssh.detail.untitled") : t("ssh.detail.newProfile")}</h2>
          </div>
          <div className="ssh-detail-status" title={activeProfile ? `${activeProfile.username}@${activeProfile.host}` : undefined}>
            {activeProfile ? `${activeProfile.username}@${activeProfile.host}` : t("ssh.detail.notSaved")}
          </div>
        </header>

        {message ? (
          <div className={`ssh-message is-${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
            {message.text}
          </div>
        ) : null}

        <section className="ssh-card" aria-label={t("ssh.form.aria")}>
          <div className="ssh-card-header">
            <div>
              <h3>{t("ssh.form.title")}</h3>
            </div>
          </div>

          <div className="ssh-form-grid">
            <label className="ssh-field">
              <span>{t("ssh.form.name")}</span>
              <input value={draft.name} placeholder={t("ssh.form.namePlaceholder")} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <label className="ssh-field">
              <span>{t("ssh.form.host")}</span>
              <input value={draft.host} placeholder="203.0.113.10" onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
            </label>
            <label className="ssh-field">
              <span>{t("ssh.form.port")}</span>
              <input value={draft.port} inputMode="numeric" onChange={(event) => setDraft({ ...draft, port: event.target.value })} />
            </label>
            <label className="ssh-field">
              <span>{t("ssh.form.username")}</span>
              <input value={draft.username} placeholder="ubuntu" onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
            </label>
            <label className="ssh-field is-wide">
              <span>{t("ssh.form.privateKeyPath")}</span>
              <input
                value={draft.privateKeyPath}
                placeholder="C:\\Users\\you\\.ssh\\id_rsa"
                onChange={(event) => setDraft({ ...draft, privateKeyPath: event.target.value })}
              />
            </label>
            <label className="ssh-field">
              <span>{t("ssh.form.defaultRemotePath")}</span>
              <input
                value={draft.defaultRemotePath}
                placeholder="/home/ubuntu/app"
                onChange={(event) => setDraft({ ...draft, defaultRemotePath: event.target.value })}
              />
            </label>
            <label className="ssh-field">
              <span>{t("ssh.form.passphrase")}</span>
              <input
                type="password"
                value={draft.passphrase}
                placeholder={activeProfile?.hasPassphrase ? t("ssh.form.passphraseSavedPlaceholder") : t("ssh.form.passphraseOptional")}
                onChange={(event) => setDraft({ ...draft, passphrase: event.target.value })}
              />
            </label>
          </div>

          <div className="ssh-action-row">
            <button className="primary-button" type="button" disabled={isBusy} onClick={() => void saveProfile()}>
              {t("ssh.actions.saveProfile")}
            </button>
            <button className="secondary-button" type="button" disabled={isBusy || !draft.id} onClick={() => void testProfile()}>
              {t("ssh.actions.testConnection")}
            </button>
            <button className="secondary-button is-danger" type="button" disabled={isBusy || !draft.id} onClick={() => void deleteProfile()}>
              {t("app.delete")}
            </button>
          </div>
        </section>

        <section
          className={activeProfile ? "ssh-card ssh-browser-card" : "ssh-card ssh-browser-card is-disabled"}
          aria-label={t("ssh.browser.aria")}
          onKeyDown={handleBrowserKeyDown}
        >
          <div className="ssh-card-header">
            <div>
              <h3>{t("ssh.browser.title")}</h3>
            </div>
            <div className="ssh-browser-open-target">
              <button className="primary-button" type="button" disabled={isBusy || !activeProfile} onClick={() => void openWorkspace()}>
                {t("ssh.browser.openWorkspace")}
              </button>
              {activeProfile ? <span title={workspaceTargetPath}>{t("ssh.browser.target", { path: workspaceTargetPath })}</span> : null}
            </div>
          </div>

          <div className="ssh-path-toolbar">
            <button
              className="ssh-icon-button"
              type="button"
              aria-label={t("ssh.browser.up")}
              title={t("ssh.browser.up")}
              disabled={!activeProfile || currentPath === "/"}
              onClick={() => void loadDirectory(parentPath(currentPath))}
            >
              <ArrowUpIcon />
            </button>
            <div className="ssh-path-main">
              {activeProfile ? (
                isEditingPath ? (
                  <form className="ssh-path-edit-form" onSubmit={handlePathSubmit}>
                    <input
                      ref={pathInputRef}
                      aria-label={t("ssh.browser.pathInputLabel")}
                      value={pathDraft}
                      onChange={(event) => setPathDraft(event.target.value)}
                      onKeyDown={handlePathInputKeyDown}
                    />
                    <button className="secondary-button" type="submit">
                      {t("ssh.browser.go")}
                    </button>
                  </form>
                ) : (
                  <nav className="ssh-path-breadcrumbs" aria-label={t("ssh.browser.breadcrumbs")}>
                    {pathCrumbs.map((crumb, index) => (
                      <span key={crumb.path} className="ssh-path-crumb-wrap">
                        {index > 0 ? <ChevronRightIcon /> : null}
                        <button type="button" title={crumb.path} onClick={() => void loadDirectory(crumb.path)}>
                          {crumb.label}
                        </button>
                      </span>
                    ))}
                  </nav>
                )
              ) : (
                <span className="ssh-path-placeholder">{t("ssh.browser.noProfileCopy")}</span>
              )}
            </div>
            <div className="ssh-path-actions">
              <button
                className="ssh-icon-button"
                type="button"
                aria-label={t("ssh.browser.editPath")}
                title={t("ssh.browser.editPath")}
                disabled={!activeProfile}
                onClick={startPathEditing}
              >
                <EditIcon />
              </button>
              <button
                className="ssh-icon-button"
                type="button"
                aria-label={t("app.refresh")}
                title={t("app.refresh")}
                disabled={!activeProfile}
                onClick={() => void loadDirectory(currentPath)}
              >
                <ResetIcon />
              </button>
            </div>
          </div>

          <label className="ssh-directory-filter">
            <SearchIcon />
            <input
              aria-label={t("ssh.browser.searchLabel")}
              type="search"
              value={directoryFilter}
              placeholder={t("ssh.browser.searchPlaceholder")}
              disabled={!activeProfile}
              onChange={(event) => setDirectoryFilter(event.target.value)}
            />
          </label>

          <div className="ssh-directory-browser">
            {isBusy ? <span className="ssh-browser-loading" role="status">{t("ssh.browser.loading")}</span> : null}
            {renderDirectoryContent()}
          </div>
        </section>
      </main>
    </section>
  )
}
