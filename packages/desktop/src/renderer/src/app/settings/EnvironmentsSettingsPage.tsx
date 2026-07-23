import { useEffect, useMemo, useRef, useState } from "react"
import type {
  AgentEnvironmentCandidate,
  AgentEnvironmentDefinition,
  AgentEnvironmentIPCEvent,
  AgentEnvironmentListResult,
  AgentEnvironmentRunRecord,
  AgentProjectWorkspace,
} from "../../../../shared/desktop-ipc-contract"
import { DeleteIcon, PlusIcon, SearchIcon } from "../icons"
import { useI18n } from "../i18n/I18nProvider"

const EMPTY_ENVIRONMENT: AgentEnvironmentDefinition = {
  version: 1,
  name: "",
  actions: [],
}

const SCRIPT_FIELDS = ["default", "windows", "macos", "linux"] as const
type ScriptField = (typeof SCRIPT_FIELDS)[number]
type AgentEnvironmentAction = AgentEnvironmentDefinition["actions"][number]

interface EnvironmentLocation {
  id: string
  projectID: string
  projectName: string
  directory: string
  label: string
}

interface EnvironmentsSettingsPageProps {
  onDirtyChange?: (dirty: boolean) => void
}

interface TrustRequest {
  kind: "candidate" | "save"
  candidate?: AgentEnvironmentCandidate
}

function normalizeDirectory(value: string) {
  return value.trim().replace(/[\\/]+$/, "").toLocaleLowerCase()
}

function getDirectoryLabel(directory: string) {
  const normalized = directory.trim().replace(/[\\/]+$/, "")
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized
}

function buildEnvironmentLocations(projects: AgentProjectWorkspace[]): EnvironmentLocation[] {
  const locations: EnvironmentLocation[] = []
  const seen = new Set<string>()

  for (const project of projects) {
    const projectName = project.name?.trim() || getDirectoryLabel(project.repositoryRoot ?? project.worktree) || project.id
    const directories = [
      project.repositoryRoot ?? project.worktree,
      ...(project.workspaceRoots ?? []),
      ...project.sessions.map((session) => session.directory),
      ...(project.worktrees ?? [])
        .filter((worktree) => !["removed", "missing"].includes(worktree.status))
        .map((worktree) => worktree.workingDirectory ?? worktree.path),
    ]

    for (const directory of directories) {
      const normalized = normalizeDirectory(directory)
      if (!normalized) continue
      const key = `${project.id}\u0000${normalized}`
      if (seen.has(key)) continue
      seen.add(key)
      locations.push({
        id: key,
        projectID: project.id,
        projectName,
        directory,
        label: normalizeDirectory(directory) === normalizeDirectory(project.repositoryRoot ?? project.worktree)
          ? projectName
          : getDirectoryLabel(directory),
      })
    }
  }

  return locations.sort((left, right) =>
    left.projectName.localeCompare(right.projectName) || left.directory.localeCompare(right.directory),
  )
}

function cloneDefinition(definition: AgentEnvironmentDefinition): AgentEnvironmentDefinition {
  return JSON.parse(JSON.stringify(definition)) as AgentEnvironmentDefinition
}

function normalizeDraft(definition: AgentEnvironmentDefinition) {
  return JSON.stringify(definition)
}

function nextActionID(actions: AgentEnvironmentAction[]) {
  const used = new Set(actions.map((action) => action.id))
  let index = actions.length + 1
  while (used.has(`action-${index}`)) index += 1
  return `action-${index}`
}

function describeSource(source: AgentEnvironmentCandidate["source"], t: ReturnType<typeof useI18n>["t"]) {
  if (source === "anybox-jsonc") return t("settings.environments.source.anybox")
  if (source === "codex-toml") return t("settings.environments.source.codex")
  return t("settings.environments.source.legacy")
}

function collectScripts(definition: AgentEnvironmentDefinition) {
  const scripts: Array<{ label: string; script: string }> = []
  if (definition.setup) {
    for (const platform of SCRIPT_FIELDS) {
      const script = definition.setup.scripts[platform]?.trim()
      if (script) scripts.push({ label: `Setup · ${platform}`, script })
    }
  }
  for (const action of definition.actions) {
    for (const platform of SCRIPT_FIELDS) {
      const script = action.scripts[platform]?.trim()
      if (script) scripts.push({ label: `${action.name || action.id} · ${platform}`, script })
    }
  }
  return scripts
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function environmentRunFromEvent(event: AgentEnvironmentIPCEvent) {
  const data = event.data as { run?: AgentEnvironmentRunRecord } | null
  return data?.run ?? null
}

export function EnvironmentsSettingsPage({ onDirtyChange }: EnvironmentsSettingsPageProps) {
  const { t } = useI18n()
  const [projects, setProjects] = useState<AgentProjectWorkspace[]>([])
  const [selectedLocationID, setSelectedLocationID] = useState<string | null>(null)
  const [environmentResult, setEnvironmentResult] = useState<AgentEnvironmentListResult | null>(null)
  const [selectedEnvironmentKey, setSelectedEnvironmentKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<AgentEnvironmentDefinition>(EMPTY_ENVIRONMENT)
  const [baseline, setBaseline] = useState(normalizeDraft(EMPTY_ENVIRONMENT))
  const [editDirectory, setEditDirectory] = useState("")
  const [expectedHash, setExpectedHash] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)
  const [isLoadingEnvironment, setIsLoadingEnvironment] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [trustRequest, setTrustRequest] = useState<TrustRequest | null>(null)
  const [setupRun, setSetupRun] = useState<AgentEnvironmentRunRecord | null>(null)
  const [isManagingSetup, setIsManagingSetup] = useState(false)
  const loadSequenceRef = useRef(0)

  const locations = useMemo(() => buildEnvironmentLocations(projects), [projects])
  const filteredLocations = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return locations
    return locations.filter((location) =>
      `${location.projectName}\n${location.label}\n${location.directory}`.toLocaleLowerCase().includes(query),
    )
  }, [locations, search])
  const selectedLocation =
    locations.find((location) => location.id === selectedLocationID) ?? locations[0] ?? null
  const selectedCandidate =
    environmentResult?.items.find((candidate) => candidate.key === selectedEnvironmentKey) ?? null
  const dirty = normalizeDraft(draft) !== baseline
  const readonly = Boolean(selectedCandidate?.readonly) && !isCreating
  const scriptsForTrust = collectScripts(
    trustRequest?.kind === "candidate" && trustRequest.candidate?.definition
      ? trustRequest.candidate.definition
      : draft,
  )

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  useEffect(() => {
    let cancelled = false
    setIsLoadingProjects(true)
    setError(null)
    const listProjects = window.desktop?.listProjectWorkspaces
    if (!listProjects) {
      setError(t("settings.environments.bridgeUnavailable"))
      setIsLoadingProjects(false)
      return
    }
    listProjects()
      .then((items) => {
        if (cancelled) return
        setProjects(items.filter((project) => !project.worktree.includes("://")))
      })
      .catch((loadError) => {
        if (!cancelled) setError(getErrorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProjects(false)
      })
    return () => {
      cancelled = true
    }
  }, [t])

  useEffect(() => {
    if (!selectedLocationID && locations[0]) {
      setSelectedLocationID(locations[0].id)
    }
  }, [locations, selectedLocationID])

  function loadCandidate(candidate: AgentEnvironmentCandidate | null, location: EnvironmentLocation) {
    const definition = cloneDefinition(candidate?.definition ?? EMPTY_ENVIRONMENT)
    setSelectedEnvironmentKey(candidate?.key ?? null)
    setDraft(definition)
    setBaseline(normalizeDraft(definition))
    setEditDirectory(candidate?.rootDirectory ?? location.directory)
    setExpectedHash(candidate?.source === "anybox-jsonc" ? candidate.contentHash : null)
    setIsCreating(!candidate)
  }

  async function loadEnvironment(location: EnvironmentLocation, preferredKey?: string | null) {
    const api = window.desktop?.listProjectEnvironments
    if (!api) {
      setError(t("settings.environments.bridgeUnavailable"))
      return
    }
    const sequence = loadSequenceRef.current + 1
    loadSequenceRef.current = sequence
    setIsLoadingEnvironment(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api({ projectID: location.projectID, directory: location.directory })
      if (sequence !== loadSequenceRef.current) return
      setEnvironmentResult(result)
      const candidate =
        result.items.find((item) => item.key === preferredKey) ??
        result.items.find((item) => item.key === result.selectedKey) ??
        result.items[0] ??
        null
      loadCandidate(candidate, location)
    } catch (loadError) {
      if (sequence === loadSequenceRef.current) setError(getErrorMessage(loadError))
    } finally {
      if (sequence === loadSequenceRef.current) setIsLoadingEnvironment(false)
    }
  }

  useEffect(() => {
    if (!selectedLocation) return
    void loadEnvironment(selectedLocation)
    // Location IDs are stable for a project/directory pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocation?.id])

  useEffect(() => {
    const runID = selectedCandidate?.setupRunID
    if (!runID || !window.desktop?.getEnvironmentRun) {
      setSetupRun(null)
      return
    }
    let cancelled = false
    setSetupRun(null)
    window.desktop.getEnvironmentRun({ runID })
      .then((run) => {
        if (!cancelled) setSetupRun(run)
      })
      .catch((loadError) => {
        if (!cancelled) setError(getErrorMessage(loadError))
      })
    return () => {
      cancelled = true
    }
  }, [selectedCandidate?.setupRunID])

  useEffect(() => {
    return window.desktop?.onEnvironmentEvent?.((event) => {
      if (event.event === "environment.run.output") {
        const data = event.data as { runID?: string; chunk?: string } | null
        if (!data?.runID || !data.chunk) return
        setSetupRun((current) => current?.id === data.runID
          ? {
              ...current,
              output: `${current.output}${data.chunk}`.slice(-200_000),
            }
          : current)
        return
      }
      const run = environmentRunFromEvent(event)
      if (
        run?.kind === "setup"
        && (
          run.id === selectedCandidate?.setupRunID
          || (selectedCandidate?.bindingID && run.bindingID === selectedCandidate.bindingID)
        )
      ) {
        setSetupRun(run)
      }
    })
  }, [selectedCandidate?.bindingID, selectedCandidate?.setupRunID])

  function confirmDiscard() {
    return !dirty || typeof window.confirm !== "function" || window.confirm(t("settings.environments.dirtyConfirm"))
  }

  function selectLocation(location: EnvironmentLocation) {
    if (location.id === selectedLocation?.id || !confirmDiscard()) return
    setSelectedLocationID(location.id)
  }

  async function selectCandidate(candidate: AgentEnvironmentCandidate) {
    if (!selectedLocation || candidate.key === selectedEnvironmentKey || !confirmDiscard()) return
    loadCandidate(candidate, selectedLocation)
    try {
      await window.desktop?.updateProjectEnvironmentPreference?.({
        projectID: selectedLocation.projectID,
        directory: selectedLocation.directory,
        selectedKey: candidate.key,
      })
    } catch (preferenceError) {
      setError(getErrorMessage(preferenceError))
    }
  }

  function startNewEnvironment() {
    if (!selectedLocation || !confirmDiscard()) return
    const definition = cloneDefinition(EMPTY_ENVIRONMENT)
    definition.name = selectedLocation.projectName
    setSelectedEnvironmentKey(null)
    setDraft(definition)
    setBaseline(normalizeDraft(EMPTY_ENVIRONMENT))
    setEditDirectory(selectedLocation.directory)
    setExpectedHash(null)
    setIsCreating(true)
    setError(null)
    setNotice(null)
  }

  function updateSetup(enabled: boolean) {
    setDraft((current) => ({
      ...current,
      setup: enabled
        ? current.setup ?? { scripts: { default: "" }, cwd: ".", timeoutSeconds: 900 }
        : undefined,
    }))
  }

  function updateSetupScript(field: ScriptField, value: string) {
    setDraft((current) => ({
      ...current,
      setup: {
        ...(current.setup ?? { scripts: {}, cwd: ".", timeoutSeconds: 900 }),
        scripts: {
          ...(current.setup?.scripts ?? {}),
          [field]: value,
        },
      },
    }))
  }

  function updateAction(index: number, update: Partial<AgentEnvironmentAction>) {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action, actionIndex) =>
        actionIndex === index ? { ...action, ...update } : action,
      ),
    }))
  }

  function updateActionScript(index: number, field: ScriptField, value: string) {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action, actionIndex) =>
        actionIndex === index
          ? {
              ...action,
              scripts: {
                ...action.scripts,
                [field]: value,
              },
            }
          : action,
      ),
    }))
  }

  function moveAction(index: number, offset: -1 | 1) {
    setDraft((current) => {
      const target = index + offset
      if (target < 0 || target >= current.actions.length) return current
      const actions = [...current.actions]
      const [action] = actions.splice(index, 1)
      actions.splice(target, 0, action!)
      return { ...current, actions }
    })
  }

  function addAction() {
    setDraft((current) => ({
      ...current,
      actions: [
        ...current.actions,
        {
          id: nextActionID(current.actions),
          name: t("settings.environments.newActionName"),
          icon: "play",
          scripts: { default: "" },
          cwd: ".",
        },
      ],
    }))
  }

  async function saveEnvironment(trust: boolean) {
    if (!selectedLocation || readonly || isSaving) return
    const api = window.desktop?.saveProjectEnvironment
    if (!api) {
      setError(t("settings.environments.bridgeUnavailable"))
      return
    }
    setIsSaving(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await api({
        projectID: selectedLocation.projectID,
        directory: editDirectory,
        definition: draft,
        expectedHash,
        trust,
      })
      setNotice(trust ? t("settings.environments.savedAndTrusted") : t("settings.environments.saved"))
      await loadEnvironment(selectedLocation, saved.key)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setIsSaving(false)
      setTrustRequest(null)
    }
  }

  async function importCandidate(candidate: AgentEnvironmentCandidate) {
    if (!selectedLocation || isSaving) return
    setIsSaving(true)
    setError(null)
    setNotice(null)
    try {
      const imported = await window.desktop?.importProjectEnvironment?.({
        projectID: selectedLocation.projectID,
        directory: candidate.rootDirectory,
        key: candidate.key,
        expectedHash: candidate.contentHash,
        trust: false,
      })
      if (!imported) throw new Error(t("settings.environments.bridgeUnavailable"))
      setNotice(t("settings.environments.imported"))
      await loadEnvironment(selectedLocation, imported.key)
    } catch (importError) {
      setError(getErrorMessage(importError))
    } finally {
      setIsSaving(false)
    }
  }

  async function setCandidateTrust(candidate: AgentEnvironmentCandidate, trusted: boolean) {
    if (!selectedLocation || isSaving) return
    setIsSaving(true)
    setError(null)
    try {
      const updated = trusted
        ? await window.desktop?.trustProjectEnvironment?.({
            projectID: selectedLocation.projectID,
            directory: selectedLocation.directory,
            key: candidate.key,
            expectedHash: candidate.contentHash,
          })
        : await window.desktop?.revokeProjectEnvironmentTrust?.({
            projectID: selectedLocation.projectID,
            directory: selectedLocation.directory,
            key: candidate.key,
            expectedHash: candidate.contentHash,
          })
      if (!updated) throw new Error(t("settings.environments.bridgeUnavailable"))
      setEnvironmentResult((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.key === updated.key ? updated : item)),
            }
          : current,
      )
      setNotice(trusted ? t("settings.environments.trustedNotice") : t("settings.environments.revokedNotice"))
    } catch (trustError) {
      setError(getErrorMessage(trustError))
    } finally {
      setIsSaving(false)
      setTrustRequest(null)
    }
  }

  async function updateAutoSetup(value: boolean) {
    if (!selectedLocation || !environmentResult) return
    setEnvironmentResult({ ...environmentResult, autoSetup: value })
    try {
      await window.desktop?.updateProjectEnvironmentPreference?.({
        projectID: selectedLocation.projectID,
        directory: selectedLocation.directory,
        autoSetup: value,
      })
    } catch (preferenceError) {
      setEnvironmentResult({ ...environmentResult, autoSetup: !value })
      setError(getErrorMessage(preferenceError))
    }
  }

  function setupStatusLabel(status: AgentEnvironmentRunRecord["status"]) {
    if (status === "queued") return t("settings.environments.setupStatus.queued")
    if (status === "running") return t("settings.environments.setupStatus.running")
    if (status === "succeeded") return t("settings.environments.setupStatus.succeeded")
    if (status === "failed") return t("settings.environments.setupStatus.failed")
    if (status === "cancelled") return t("settings.environments.setupStatus.cancelled")
    return t("settings.environments.setupStatus.timedOut")
  }

  async function manageSetupRun(action: "cancel" | "retry") {
    if (!setupRun || isManagingSetup) return
    const api = action === "cancel"
      ? window.desktop?.cancelEnvironmentRun
      : window.desktop?.retryEnvironmentRun
    if (!api) {
      setError(t("settings.environments.bridgeUnavailable"))
      return
    }
    setIsManagingSetup(true)
    setError(null)
    try {
      setSetupRun(await api({ runID: setupRun.id }))
    } catch (runError) {
      setError(getErrorMessage(runError))
    } finally {
      setIsManagingSetup(false)
    }
  }

  async function copySetupLog() {
    if (!setupRun) return
    try {
      await navigator.clipboard.writeText(setupRun.output)
      setNotice(t("settings.environments.logCopied"))
    } catch (copyError) {
      setError(getErrorMessage(copyError))
    }
  }

  if (isLoadingProjects) {
    return <div className="environment-settings-state">{t("settings.environments.loading")}</div>
  }

  if (locations.length === 0) {
    return (
      <div className="environment-settings-state">
        <h3>{t("settings.environments.noProjects")}</h3>
        <p>{t("settings.environments.noProjectsCopy")}</p>
      </div>
    )
  }

  return (
    <div className="environment-settings">
      <aside className="environment-settings-list" aria-label={t("settings.environments.projectListAria")}>
        <div className="environment-settings-search">
          <SearchIcon />
          <input
            aria-label={t("settings.environments.search")}
            placeholder={t("settings.environments.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="environment-location-list">
          {filteredLocations.map((location) => {
            const active = location.id === selectedLocation?.id
            return (
              <button
                key={location.id}
                className={active ? "environment-location-row is-active" : "environment-location-row"}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => selectLocation(location)}
              >
                <span className="environment-location-name">{location.label}</span>
                <span className="environment-location-project">{location.projectName}</span>
                <span className="environment-path" title={location.directory}>{location.directory}</span>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="environment-settings-detail">
        <header className="environment-detail-header">
          <div>
            <p className="environment-detail-eyebrow">{t("settings.environments.title")}</p>
            <h2>{selectedLocation?.label}</h2>
            <p className="environment-path" title={selectedLocation?.directory}>{selectedLocation?.directory}</p>
          </div>
          <button className="secondary-button" type="button" onClick={startNewEnvironment}>
            <PlusIcon />
            {t("settings.environments.newConfig")}
          </button>
        </header>

        {error ? <div className="settings-banner is-error">{error}</div> : null}
        {notice ? <div className="settings-banner is-success">{notice}</div> : null}

        {isLoadingEnvironment ? (
          <div className="environment-settings-state">{t("settings.environments.loading")}</div>
        ) : (
          <>
            {environmentResult && environmentResult.items.length > 0 ? (
              <div className="environment-candidate-tabs" role="tablist" aria-label={t("settings.environments.candidates")}>
                {environmentResult.items.map((candidate) => (
                  <button
                    key={candidate.key}
                    className={candidate.key === selectedEnvironmentKey ? "environment-candidate-tab is-active" : "environment-candidate-tab"}
                    type="button"
                    role="tab"
                    aria-selected={candidate.key === selectedEnvironmentKey}
                    onClick={() => void selectCandidate(candidate)}
                  >
                    <span>{candidate.definition?.name || describeSource(candidate.source, t)}</span>
                    <span className={`environment-status is-${candidate.issues.some((issue) => issue.severity === "error") ? "error" : candidate.trusted ? "trusted" : "untrusted"}`}>
                      {candidate.issues.some((issue) => issue.severity === "error")
                        ? t("settings.environments.error")
                        : candidate.trusted
                          ? t("settings.environments.trusted")
                          : t("settings.environments.untrusted")}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedCandidate?.issues.length ? (
              <div className="environment-issues">
                {selectedCandidate.issues.map((issue, index) => (
                  <p key={`${issue.code}-${index}`} className={`is-${issue.severity}`}>
                    {issue.message}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="environment-definition-meta">
              <div>
                <span>{t("settings.environments.configPath")}</span>
                <code title={selectedCandidate?.configPath ?? `${editDirectory}\\.anybox\\environments\\environment.jsonc`}>
                  {selectedCandidate?.configPath ?? `${editDirectory} · .anybox/environments/environment.jsonc`}
                </code>
              </div>
              <div>
                <span>{t("settings.environments.source")}</span>
                <strong>{selectedCandidate ? describeSource(selectedCandidate.source, t) : t("settings.environments.source.anybox")}</strong>
              </div>
              {selectedCandidate ? (
                <div>
                  <span>{t("settings.environments.hash")}</span>
                  <code>{selectedCandidate.contentHash.slice(0, 12)}</code>
                </div>
              ) : null}
            </div>

            {setupRun ? (
              <section className="environment-setup-run" aria-label={t("settings.environments.setupRun")}>
                <header>
                  <div>
                    <strong>{t("settings.environments.setupRun")}</strong>
                    <span className={`environment-status is-run-${setupRun.status}`}>
                      {setupStatusLabel(setupRun.status)}
                    </span>
                  </div>
                  <div className="environment-setup-run-actions">
                    {setupRun.status === "queued" || setupRun.status === "running" ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={isManagingSetup}
                        onClick={() => void manageSetupRun("cancel")}
                      >
                        {t("settings.environments.cancelSetup")}
                      </button>
                    ) : setupRun.status !== "succeeded" ? (
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={isManagingSetup}
                        onClick={() => void manageSetupRun("retry")}
                      >
                        {t("settings.environments.retrySetup")}
                      </button>
                    ) : null}
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={!setupRun.output}
                      onClick={() => void copySetupLog()}
                    >
                      {t("settings.environments.copyLog")}
                    </button>
                  </div>
                </header>
                {setupRun.error ? <p className="environment-setup-run-error">{setupRun.error}</p> : null}
                {setupRun.outputTruncated ? (
                  <p className="environment-setup-run-note">{t("settings.environments.outputTruncated")}</p>
                ) : null}
                <pre>{setupRun.output || t("settings.environments.noSetupOutput")}</pre>
              </section>
            ) : null}

            <label className="environment-field">
              <span>{t("settings.environments.name")}</span>
              <input
                value={draft.name}
                disabled={readonly}
                maxLength={128}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              />
            </label>

            <div className="environment-section-heading">
              <div>
                <h3>{t("settings.environments.setup")}</h3>
                <p>{t("settings.environments.setupCopy")}</p>
              </div>
              <label className="environment-inline-check">
                <input
                  type="checkbox"
                  checked={Boolean(draft.setup)}
                  disabled={readonly}
                  onChange={(event) => updateSetup(event.target.checked)}
                />
                <span>{t("settings.environments.setupEnabled")}</span>
              </label>
            </div>

            {draft.setup ? (
              <div className="environment-section-body">
                <div className="environment-script-grid">
                  {SCRIPT_FIELDS.map((field) => (
                    <label key={field} className="environment-field">
                      <span>{t(`settings.environments.script.${field}`)}</span>
                      <textarea
                        value={draft.setup?.scripts[field] ?? ""}
                        disabled={readonly}
                        rows={field === "default" ? 3 : 2}
                        spellCheck={false}
                        onChange={(event) => updateSetupScript(field, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <div className="environment-two-column">
                  <label className="environment-field">
                    <span>{t("settings.environments.cwd")}</span>
                    <input
                      value={draft.setup.cwd}
                      disabled={readonly}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          setup: current.setup ? { ...current.setup, cwd: event.target.value } : current.setup,
                        }))
                      }
                    />
                  </label>
                  <label className="environment-field">
                    <span>{t("settings.environments.timeout")}</span>
                    <input
                      type="number"
                      min={1}
                      max={3600}
                      value={draft.setup.timeoutSeconds}
                      disabled={readonly}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          setup: current.setup
                            ? { ...current.setup, timeoutSeconds: Number(event.target.value) }
                            : current.setup,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            ) : null}

            <div className="environment-section-heading">
              <div>
                <h3>{t("settings.environments.actions")}</h3>
                <p>{t("settings.environments.actionsCopy")}</p>
              </div>
              {!readonly ? (
                <button className="secondary-button" type="button" disabled={draft.actions.length >= 32} onClick={addAction}>
                  <PlusIcon />
                  {t("settings.environments.addAction")}
                </button>
              ) : null}
            </div>

            <div className="environment-actions-list">
              {draft.actions.length === 0 ? (
                <p className="environment-empty-copy">{t("settings.environments.noActions")}</p>
              ) : null}
              {draft.actions.map((action, index) => (
                <section key={`${action.id}-${index}`} className="environment-action-row">
                  <header>
                    <strong>{action.name || action.id}</strong>
                    {!readonly ? (
                      <div className="environment-action-controls">
                        <button
                          type="button"
                          aria-label={t("settings.environments.moveUp")}
                          disabled={index === 0}
                          onClick={() => moveAction(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={t("settings.environments.moveDown")}
                          disabled={index === draft.actions.length - 1}
                          onClick={() => moveAction(index, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          aria-label={t("settings.environments.deleteAction")}
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              actions: current.actions.filter((_, actionIndex) => actionIndex !== index),
                            }))
                          }
                        >
                          <DeleteIcon />
                        </button>
                      </div>
                    ) : null}
                  </header>
                  <div className="environment-three-column">
                    <label className="environment-field">
                      <span>{t("settings.environments.actionId")}</span>
                      <input value={action.id} disabled={readonly} maxLength={64} onChange={(event) => updateAction(index, { id: event.target.value })} />
                    </label>
                    <label className="environment-field">
                      <span>{t("settings.environments.actionName")}</span>
                      <input value={action.name} disabled={readonly} onChange={(event) => updateAction(index, { name: event.target.value })} />
                    </label>
                    <label className="environment-field">
                      <span>{t("settings.environments.actionIcon")}</span>
                      <input value={action.icon} disabled={readonly} onChange={(event) => updateAction(index, { icon: event.target.value })} />
                    </label>
                  </div>
                  <div className="environment-script-grid">
                    {SCRIPT_FIELDS.map((field) => (
                      <label key={field} className="environment-field">
                        <span>{t(`settings.environments.script.${field}`)}</span>
                        <textarea
                          value={action.scripts[field] ?? ""}
                          disabled={readonly}
                          rows={field === "default" ? 3 : 2}
                          spellCheck={false}
                          onChange={(event) => updateActionScript(index, field, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                  <label className="environment-field">
                    <span>{t("settings.environments.cwd")}</span>
                    <input value={action.cwd} disabled={readonly} onChange={(event) => updateAction(index, { cwd: event.target.value })} />
                  </label>
                </section>
              ))}
            </div>

            <div className="environment-footer">
              <label className="environment-inline-check">
                <input
                  type="checkbox"
                  checked={environmentResult?.autoSetup ?? true}
                  disabled={!environmentResult}
                  onChange={(event) => void updateAutoSetup(event.target.checked)}
                />
                <span>{t("settings.environments.autoSetup")}</span>
              </label>
              <div className="environment-footer-actions">
                {selectedCandidate?.readonly ? (
                  <button className="secondary-button" type="button" disabled={isSaving || !selectedCandidate.definition} onClick={() => void importCandidate(selectedCandidate)}>
                    {t("settings.environments.import")}
                  </button>
                ) : null}
                {selectedCandidate && !selectedCandidate.trusted ? (
                  <button className="secondary-button" type="button" disabled={isSaving || !selectedCandidate.definition} onClick={() => setTrustRequest({ kind: "candidate", candidate: selectedCandidate })}>
                    {t("settings.environments.trust")}
                  </button>
                ) : null}
                {selectedCandidate?.trusted ? (
                  <button className="secondary-button" type="button" disabled={isSaving} onClick={() => void setCandidateTrust(selectedCandidate, false)}>
                    {t("settings.environments.revoke")}
                  </button>
                ) : null}
                {!readonly ? (
                  <>
                    <button className="secondary-button" type="button" disabled={isSaving || !dirty} onClick={() => void saveEnvironment(false)}>
                      {t("settings.environments.saveOnly")}
                    </button>
                    <button className="primary-button" type="button" disabled={isSaving || !dirty} onClick={() => setTrustRequest({ kind: "save" })}>
                      {isSaving ? t("app.saving") : t("settings.environments.saveTrust")}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </>
        )}
      </section>

      {trustRequest ? (
        <div className="environment-trust-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isSaving) setTrustRequest(null)
        }}>
          <section className="environment-trust-dialog" role="dialog" aria-modal="true" aria-labelledby="environment-trust-title">
            <header>
              <h3 id="environment-trust-title">{t("settings.environments.trustTitle")}</h3>
              <p>{t("settings.environments.trustDescription")}</p>
            </header>
            <dl>
              <div>
                <dt>{t("settings.environments.configPath")}</dt>
                <dd title={trustRequest.candidate?.configPath ?? editDirectory}>{trustRequest.candidate?.configPath ?? editDirectory}</dd>
              </div>
              <div>
                <dt>{t("settings.environments.hash")}</dt>
                <dd>{trustRequest.candidate?.contentHash.slice(0, 16) ?? t("settings.environments.finalHash")}</dd>
              </div>
            </dl>
            <p className="environment-trust-warning">{t("settings.environments.trustUserWarning")}</p>
            <div className="environment-trust-scripts">
              <h4>{t("settings.environments.scripts")}</h4>
              {scriptsForTrust.length ? scriptsForTrust.map((item, index) => (
                <div key={`${item.label}-${index}`}>
                  <span>{item.label}</span>
                  <pre>{item.script}</pre>
                </div>
              )) : <p>{t("settings.environments.noScripts")}</p>}
            </div>
            <footer>
              <button className="secondary-button" type="button" disabled={isSaving} onClick={() => setTrustRequest(null)}>
                {t("app.cancel")}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={isSaving || scriptsForTrust.length === 0}
                onClick={() => {
                  if (trustRequest.kind === "save") {
                    void saveEnvironment(true)
                  } else if (trustRequest.candidate) {
                    void setCandidateTrust(trustRequest.candidate, true)
                  }
                }}
              >
                {t("settings.environments.confirmTrust")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}
