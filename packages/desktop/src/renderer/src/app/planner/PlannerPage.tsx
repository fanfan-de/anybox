import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import {
  AutomationIcon,
  CalendarIcon,
  CheckIcon,
  DeleteIcon,
  FolderIcon,
  PlannerNavigationIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SessionRunningIcon,
  SkillIcon,
  StopIcon,
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import type { TranslationKey } from "../i18n/translations"
import { joinClassNames, ShellTopMenu } from "../shared-ui"
import { CalendarPage } from "../calendar/CalendarPage"
import type {
  AgentAutomationCreateInput,
  AgentAutomationDefinition,
} from "../../../../shared/desktop-ipc-contract"
import { usePlannerData } from "./use-planner-data"
import type {
  AgentTaskRun,
  CreateAgentTaskRunInput,
  PlanProposal,
  PlannerChange,
  PlannerProjectOption,
  PlannerSection,
  PlannerTodo,
  PlannerTodoPriority,
  PlannerTodoStatus,
} from "./planner-types"

interface PlannerPageProps {
  onOpenSession?: (sessionId: string) => void
  projects?: PlannerProjectOption[]
  quickAddProjects?: PlannerProjectOption[]
  windowControls?: ReactNode
}

type PlannerTranslate = (key: TranslationKey, params?: Record<string, string | number>) => string

interface TodoDraft {
  description: string
  dueAt: string
  estimateMinutes: string
  priority: PlannerTodoPriority
  projectId: string
  scheduledEndAt: string
  scheduledStartAt: string
  status: PlannerTodoStatus
  title: string
}

type PlannerAutomationCadence = "daily" | "weekdays" | "weekly"

interface TodoAutomationDraft {
  cadence: PlannerAutomationCadence
  name: string
  permissionMode: "read-only" | "default"
  projectId: string
  prompt: string
  time: string
}

const ACTIVE_STATUSES = new Set<PlannerTodoStatus>(["inbox", "todo", "doing", "waiting"])
const STATUS_VALUES: PlannerTodoStatus[] = ["inbox", "todo", "doing", "waiting", "done", "canceled"]
const PRIORITY_VALUES: PlannerTodoPriority[] = ["urgent", "high", "medium", "low"]

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function endOfToday() {
  const date = new Date()
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

function isActive(todo: PlannerTodo) {
  return ACTIVE_STATUSES.has(todo.status)
}

function isToday(todo: PlannerTodo) {
  const start = startOfToday()
  const end = endOfToday()
  if (!isActive(todo)) return false
  const scheduledToday = todo.scheduledStartAt !== undefined
    && todo.scheduledStartAt <= end
    && (todo.scheduledEndAt ?? todo.scheduledStartAt) >= start
  const dueTodayOrOverdue = todo.dueAt !== undefined && todo.dueAt <= end
  return scheduledToday || dueTodayOrOverdue
}

function toDateTimeLocal(timestamp: number | undefined) {
  if (timestamp === undefined) return ""
  const date = new Date(timestamp)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function fromDateTimeLocal(value: string) {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function todoToDraft(todo: PlannerTodo): TodoDraft {
  return {
    description: todo.description ?? "",
    dueAt: toDateTimeLocal(todo.dueAt),
    estimateMinutes: todo.estimateMinutes === undefined ? "" : String(todo.estimateMinutes),
    priority: todo.priority,
    projectId: todo.projectId ?? "",
    scheduledEndAt: toDateTimeLocal(todo.scheduledEndAt),
    scheduledStartAt: toDateTimeLocal(todo.scheduledStartAt),
    status: todo.status,
    title: todo.title,
  }
}

function formatDateTime(timestamp: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp))
}

function createAutomationSchedule(cadence: PlannerAutomationCadence, time: string) {
  const [hourValue, minuteValue] = time.split(":").map(Number)
  const hour = Number.isInteger(hourValue) ? Math.min(Math.max(hourValue, 0), 23) : 9
  const minute = Number.isInteger(minuteValue) ? Math.min(Math.max(minuteValue, 0), 59) : 0
  const dayExpression = cadence === "weekdays" ? "1-5" : cadence === "weekly" ? "1" : "*"
  return {
    type: "cron" as const,
    expression: `${minute} ${hour} * * ${dayExpression}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  }
}

function statusLabel(status: PlannerTodoStatus, t: PlannerTranslate) {
  return t(`planner.status.${status}` as TranslationKey)
}

function priorityLabel(priority: PlannerTodoPriority, t: PlannerTranslate) {
  return t(`planner.priority.${priority}` as TranslationKey)
}

function sectionDescriptionKey(section: PlannerSection) {
  if (section === "project") return "planner.view.project.description" as const
  return `planner.view.${section}.description` as TranslationKey
}

function sectionLabel(section: PlannerSection, t: PlannerTranslate, projectName?: string) {
  if (section === "project") return projectName ?? t("planner.nav.projects")
  return t(`planner.nav.${section}` as TranslationKey)
}

function getProposalTodoTitle(change: PlannerChange, todosById: Map<string, PlannerTodo>, t: PlannerTranslate) {
  if (change.kind === "create") return change.todo.title
  return todosById.get(change.todoId)?.title ?? t("planner.proposal.todoFallback", { id: change.todoId })
}

function proposalChangeLabel(change: PlannerChange, todosById: Map<string, PlannerTodo>, t: PlannerTranslate) {
  return t(`planner.proposal.change.${change.kind}` as TranslationKey, {
    title: getProposalTodoTitle(change, todosById, t),
  })
}

function proposalFieldLabel(key: string, t: PlannerTranslate) {
  const labels: Partial<Record<string, TranslationKey>> = {
    title: "planner.inspector.title",
    description: "planner.inspector.description",
    status: "planner.inspector.status",
    priority: "planner.inspector.priority",
    projectId: "planner.inspector.project",
    scheduledStartAt: "planner.inspector.scheduleStart",
    scheduledEndAt: "planner.inspector.scheduleEnd",
    dueAt: "planner.inspector.due",
    estimateMinutes: "planner.inspector.estimate",
  }
  return labels[key] ? t(labels[key]) : key
}

function proposalFieldValue(
  key: string,
  value: unknown,
  locale: string,
  projectById: Map<string, PlannerProjectOption>,
  t: PlannerTranslate,
) {
  if (value === null || value === undefined || value === "") return t("planner.proposal.detail.cleared")
  if (key === "status") return statusLabel(value as PlannerTodoStatus, t)
  if (key === "priority") return priorityLabel(value as PlannerTodoPriority, t)
  if (key === "projectId") return projectById.get(String(value))?.name ?? String(value)
  if (["dueAt", "scheduledStartAt", "scheduledEndAt", "reminderAt"].includes(key) && typeof value === "number") {
    return formatDateTime(value, locale)
  }
  if (key === "estimateMinutes" && typeof value === "number") return t("planner.todo.estimate", { minutes: value })
  if (key === "description" || key === "properties") return t("planner.proposal.detail.updated")
  return String(value)
}

function proposalChangeDetail(
  change: PlannerChange,
  locale: string,
  projectById: Map<string, PlannerProjectOption>,
  t: PlannerTranslate,
) {
  if (change.kind === "schedule") {
    if (change.scheduledStartAt === null || change.scheduledEndAt === null) {
      return t("planner.proposal.detail.unschedule")
    }
    return t("planner.proposal.detail.schedule", {
      start: formatDateTime(change.scheduledStartAt, locale),
      end: formatDateTime(change.scheduledEndAt, locale),
    })
  }
  if (change.kind === "complete") {
    return t(change.completed === false ? "planner.proposal.detail.reopen" : "planner.proposal.detail.complete")
  }
  const fields = change.kind === "create" ? change.todo : change.fields
  const detail = Object.entries(fields)
    .filter(([key]) => !["id", "properties", "parentTodoId"].includes(key))
    .map(([key, value]) => (
      `${proposalFieldLabel(key, t)}: ${proposalFieldValue(key, value, locale, projectById, t)}`
    ))
    .join(" · ")
  return detail || t("planner.proposal.detail.updated")
}

export function PlannerPage({ onOpenSession, projects = [], quickAddProjects = [], windowControls }: PlannerPageProps) {
  const { locale, t } = useI18n()
  const [section, setSection] = useState<PlannerSection>("today")
  const [projectId, setProjectId] = useState("")
  const [query, setQuery] = useState("")
  const [quickTitle, setQuickTitle] = useState("")
  const [selectedTodoId, setSelectedTodoId] = useState("")
  const [selectedProposalId, setSelectedProposalId] = useState("")
  const [draft, setDraft] = useState<TodoDraft | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const quickAddRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const data = usePlannerData({ section, projectId: projectId || undefined, query })

  const projectOptions = useMemo(() => {
    const byId = new Map<string, PlannerProjectOption>()
    for (const project of [...projects, ...quickAddProjects]) {
      const id = project.id.trim()
      if (!id || byId.has(id)) continue
      byId.set(id, { ...project, id, name: project.name.trim() || id })
    }
    return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name, locale))
  }, [locale, projects, quickAddProjects])
  const projectById = useMemo(() => new Map(projectOptions.map((project) => [project.id, project])), [projectOptions])
  const todosById = useMemo(() => new Map(data.allTodos.map((todo) => [todo.id, todo])), [data.allTodos])
  const selectedTodo = data.allTodos.find((todo) => todo.id === selectedTodoId)
  const selectedProposal = data.proposals.find((proposal) => proposal.id === selectedProposalId)
  const activeTodos = data.allTodos.filter(isActive)
  const counts = {
    today: activeTodos.filter(isToday).length,
    inbox: activeTodos.filter((todo) => todo.status === "inbox").length,
    upcoming: activeTodos.filter((todo) => (
      (todo.scheduledStartAt !== undefined && todo.scheduledStartAt > endOfToday())
      || (todo.dueAt !== undefined && todo.dueAt > endOfToday())
    )).length,
    unscheduled: activeTodos.filter((todo) => todo.scheduledStartAt === undefined && todo.scheduledEndAt === undefined).length,
    all: activeTodos.length,
    completed: data.allTodos.filter((todo) => todo.status === "done").length,
    pending: data.proposals.length,
  }

  useEffect(() => {
    if (section === "pending" || section === "calendar") return
    if (data.todos.length === 0) {
      setSelectedTodoId("")
      return
    }
    if (!data.todos.some((todo) => todo.id === selectedTodoId)) setSelectedTodoId(data.todos[0]!.id)
  }, [data.todos, section, selectedTodoId])

  useEffect(() => {
    if (!selectedTodo) {
      setDraft(null)
      return
    }
    setDraft(todoToDraft(selectedTodo))
    setActionError(null)
  }, [selectedTodo])

  useEffect(() => {
    if (section !== "pending") return
    if (data.proposals.length === 0) {
      setSelectedProposalId("")
      return
    }
    if (!data.proposals.some((proposal) => proposal.id === selectedProposalId)) {
      setSelectedProposalId(data.proposals[0]!.id)
    }
  }, [data.proposals, section, selectedProposalId])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isEditing = event.target instanceof Element
        && event.target.matches("input, textarea, select, [contenteditable='true']")
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "n") {
        event.preventDefault()
        quickAddRef.current?.focus()
      } else if (event.key === "/" && !isEditing && section !== "calendar") {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("")
        searchRef.current?.blur()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [section])

  function selectSection(nextSection: PlannerSection, nextProjectId = "") {
    setSection(nextSection)
    setProjectId(nextProjectId)
    setQuery("")
    setActionError(null)
  }

  async function handleQuickAdd(event: FormEvent) {
    event.preventDefault()
    const title = quickTitle.trim()
    if (!title) return
    const createInput = {
      title,
      status: section === "inbox" ? "inbox" as const : "todo" as const,
      projectId: section === "project" && projectId ? projectId : undefined,
      dueAt: section === "today" ? endOfToday() : undefined,
    }
    try {
      const created = await data.createTodo(createInput)
      setQuickTitle("")
      setSelectedTodoId(created.id)
      setActionError(null)
      quickAddRef.current?.focus()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleSaveTodo(event: FormEvent) {
    event.preventDefault()
    if (!selectedTodo || !draft || !draft.title.trim()) return
    const startAt = fromDateTimeLocal(draft.scheduledStartAt)
    const endAt = fromDateTimeLocal(draft.scheduledEndAt)
    if ((startAt === null) !== (endAt === null)) {
      setActionError(t("planner.inspector.schedulePairError"))
      return
    }
    const estimate = draft.estimateMinutes.trim() ? Number(draft.estimateMinutes) : null
    try {
      await data.updateTodo(selectedTodo.id, {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        status: draft.status,
        priority: draft.priority,
        projectId: draft.projectId || null,
        dueAt: fromDateTimeLocal(draft.dueAt),
        estimateMinutes: estimate && estimate > 0 ? estimate : null,
      })
      if (startAt !== (selectedTodo.scheduledStartAt ?? null) || endAt !== (selectedTodo.scheduledEndAt ?? null)) {
        await data.scheduleTodo(selectedTodo.id, { scheduledStartAt: startAt, scheduledEndAt: endAt })
      }
      setActionError(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function toggleTodoComplete(todo: PlannerTodo) {
    try {
      await data.completeTodo(todo.id, todo.status !== "done")
      setActionError(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleDeleteTodo(todo: PlannerTodo) {
    if (!window.confirm(t("planner.inspector.deleteConfirm"))) return
    try {
      await data.deleteTodo(todo.id)
      setSelectedTodoId("")
      setActionError(null)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleCreateTodoAutomation(todo: PlannerTodo, input: AgentAutomationCreateInput) {
    const desktop = window.desktop
    if (!desktop?.createAutomation || !desktop.deleteAutomation) {
      throw new Error(t("planner.automation.apiUnavailable"))
    }
    const automation = await desktop.createAutomation(input)
    try {
      await data.linkAutomation(todo.id, automation.id)
      return automation
    } catch (error) {
      await desktop.deleteAutomation({ automationID: automation.id }).catch(() => undefined)
      throw error
    }
  }

  const selectedProjectName = projectById.get(projectId)?.name
  const title = sectionLabel(section, t, selectedProjectName)

  return (
    <section className={joinClassNames("planner-page", section === "calendar" && "is-calendar")} aria-label={t("planner.title")}>
      <ShellTopMenu
        as="header"
        ariaLabel={t("planner.topMenu")}
        className="planner-top-menu"
        contentClassName="planner-top-menu-content"
        content={(
          <div className="planner-top-menu-title">
            <PlannerNavigationIcon />
            <span>{t("planner.title")}</span>
          </div>
        )}
        dragRegion
        trailing={windowControls}
        trailingClassName="planner-top-menu-window-controls"
      />

      <div className="planner-shell">
        <PlannerNavigation
          allTodos={data.allTodos}
          counts={counts}
          projectId={projectId}
          projects={projectOptions}
          section={section}
          t={t}
          onSelect={selectSection}
        />

        {section === "calendar" ? (
          <main className="planner-calendar" aria-label={t("planner.calendar.aria")}>
            <CalendarPage embedded projects={projects} quickAddProjects={quickAddProjects} />
          </main>
        ) : (
          <>
            <main className="planner-main">
              <header className="planner-view-header">
                <div>
                  <h1>{title}</h1>
                  <p>{t(sectionDescriptionKey(section))}</p>
                </div>
                {section !== "pending" ? (
                  <label className="planner-search">
                    <SearchIcon />
                    <input
                      ref={searchRef}
                      aria-label={t("planner.search.label")}
                      value={query}
                      placeholder={t("planner.search.placeholder")}
                      onChange={(event) => setQuery(event.currentTarget.value)}
                    />
                  </label>
                ) : null}
              </header>

              {section === "today" && data.proposals.length > 0 ? (
                <button className="planner-proposal-banner" type="button" onClick={() => selectSection("pending")}>
                  <SkillIcon />
                  <span>
                    <strong>{t("planner.pendingBanner.title")}</strong>
                    <small>{t("planner.pendingBanner.description", { count: data.proposals.length })}</small>
                  </span>
                  <b>{t("planner.pendingBanner.review")}</b>
                </button>
              ) : null}

              {section === "pending" ? (
                <ProposalList
                  locale={locale}
                  proposals={data.proposals}
                  selectedProposalId={selectedProposalId}
                  t={t}
                  onSelect={setSelectedProposalId}
                />
              ) : (
                <>
                  <form className="planner-quick-add" aria-label={t("planner.quickAdd.label")} onSubmit={handleQuickAdd}>
                    <PlusIcon />
                    <input
                      ref={quickAddRef}
                      value={quickTitle}
                      placeholder={t("planner.quickAdd.placeholder")}
                      onChange={(event) => setQuickTitle(event.currentTarget.value)}
                    />
                    <button type="submit" disabled={data.isMutating || !quickTitle.trim()}>
                      {data.isMutating ? t("planner.quickAdd.adding") : t("planner.quickAdd.submit")}
                    </button>
                  </form>
                  <TodoList
                    error={data.error}
                    isLoading={data.isLoading}
                    locale={locale}
                    projectById={projectById}
                    selectedTodoId={selectedTodoId}
                    t={t}
                    title={title}
                    todos={data.todos}
                    onComplete={toggleTodoComplete}
                    onRetry={() => void data.reload()}
                    onSelect={setSelectedTodoId}
                  />
                </>
              )}

              {actionError ? <p className="planner-action-error" role="alert">{actionError}</p> : null}
            </main>

            {section === "pending" ? (
              <ProposalInspector
                isMutating={data.isMutating}
                locale={locale}
                proposal={selectedProposal}
                projectById={projectById}
                t={t}
                todosById={todosById}
                onAccept={async (proposal) => {
                  try {
                    await data.acceptProposal(proposal.id)
                    setSelectedProposalId("")
                    setActionError(null)
                  } catch (error) {
                    setActionError(error instanceof Error ? error.message : String(error))
                  }
                }}
                onDismiss={async (proposal) => {
                  try {
                    await data.dismissProposal(proposal.id)
                    setSelectedProposalId("")
                    setActionError(null)
                  } catch (error) {
                    setActionError(error instanceof Error ? error.message : String(error))
                  }
                }}
              />
            ) : (
              <TodoInspector
                key={selectedTodo?.id ?? "empty"}
                draft={draft}
                isMutating={data.isMutating}
                locale={locale}
                projects={projectOptions}
                runs={selectedTodo ? data.runs.filter((run) => run.todoId === selectedTodo.id) : []}
                t={t}
                todo={selectedTodo}
                onCancelRun={(runId) => data.cancelRun(runId)}
                onCreateAutomation={handleCreateTodoAutomation}
                onDelete={handleDeleteTodo}
                onDraftChange={setDraft}
                onOpenSession={onOpenSession}
                onRetryRun={(runId, input) => data.retryRun(runId, input)}
                onSave={handleSaveTodo}
                onStartRun={(todoId, input) => data.startRun(todoId, input)}
                onToggleComplete={toggleTodoComplete}
                onUnlinkAutomation={(todoId, automationId) => data.unlinkAutomation(todoId, automationId)}
              />
            )}
          </>
        )}
      </div>
    </section>
  )
}

interface PlannerNavigationProps {
  allTodos: PlannerTodo[]
  counts: Record<"today" | "inbox" | "upcoming" | "unscheduled" | "all" | "completed" | "pending", number>
  projectId: string
  projects: PlannerProjectOption[]
  section: PlannerSection
  t: PlannerTranslate
  onSelect: (section: PlannerSection, projectId?: string) => void
}

function PlannerNavigation({ allTodos, counts, projectId, projects, section, t, onSelect }: PlannerNavigationProps) {
  const primary = ["today", "inbox", "upcoming", "unscheduled", "all"] as const
  const projectCounts = new Map<string, number>()
  for (const todo of allTodos) {
    if (!todo.projectId || !isActive(todo)) continue
    projectCounts.set(todo.projectId, (projectCounts.get(todo.projectId) ?? 0) + 1)
  }
  return (
    <aside className="planner-navigation" aria-label={t("planner.navigation")}>
      <nav>
        {primary.map((item) => (
          <PlannerNavigationRow
            key={item}
            active={section === item}
            count={counts[item]}
            icon={item === "today" ? <AutomationIcon /> : <PlannerNavigationIcon />}
            label={t(`planner.nav.${item}` as TranslationKey)}
            onClick={() => onSelect(item)}
          />
        ))}
        <PlannerNavigationRow
          active={section === "pending"}
          count={counts.pending}
          icon={<SkillIcon />}
          label={t("planner.nav.pending")}
          onClick={() => onSelect("pending")}
        />
      </nav>

      <div className="planner-navigation-group">
        <h2>{t("planner.nav.projects")}</h2>
        {projects.map((project) => (
          <PlannerNavigationRow
            key={project.id}
            active={section === "project" && projectId === project.id}
            count={projectCounts.get(project.id) ?? 0}
            icon={<FolderIcon />}
            label={project.name}
            onClick={() => onSelect("project", project.id)}
          />
        ))}
      </div>

      <nav className="planner-navigation-footer">
        <PlannerNavigationRow
          active={section === "calendar"}
          icon={<CalendarIcon />}
          label={t("planner.nav.calendar")}
          onClick={() => onSelect("calendar")}
        />
        <PlannerNavigationRow
          active={section === "completed"}
          count={counts.completed}
          icon={<CheckIcon />}
          label={t("planner.nav.completed")}
          onClick={() => onSelect("completed")}
        />
      </nav>
    </aside>
  )
}

function PlannerNavigationRow({ active, count, icon, label, onClick }: {
  active: boolean
  count?: number
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      className={joinClassNames("planner-navigation-row", active && "is-active")}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined ? <small>{count}</small> : null}
    </button>
  )
}

function TodoList({ error, isLoading, locale, projectById, selectedTodoId, t, title, todos, onComplete, onRetry, onSelect }: {
  error: string | null
  isLoading: boolean
  locale: string
  projectById: Map<string, PlannerProjectOption>
  selectedTodoId: string
  t: PlannerTranslate
  title: string
  todos: PlannerTodo[]
  onComplete: (todo: PlannerTodo) => void
  onRetry: () => void
  onSelect: (todoId: string) => void
}) {
  if (error) {
    return (
      <div className="planner-empty-state" role="alert">
        <strong>{t("planner.list.error", { message: error })}</strong>
        <button type="button" onClick={onRetry}>{t("planner.list.retry")}</button>
      </div>
    )
  }
  if (isLoading) return <p className="planner-loading" role="status">{t("planner.list.loading")}</p>
  if (todos.length === 0) {
    return (
      <div className="planner-empty-state">
        <strong>{t("planner.list.emptyTitle")}</strong>
        <span>{t("planner.list.emptyDescription")}</span>
      </div>
    )
  }
  return (
    <div className="planner-todo-list" role="list" aria-label={t("planner.list.aria", { view: title })}>
      {todos.map((todo) => {
        const date = todo.scheduledStartAt ?? todo.dueAt
        const dateLabel = date === undefined
          ? t("planner.todo.unscheduled")
          : todo.scheduledStartAt !== undefined
            ? t("planner.todo.scheduled", { date: formatDateTime(date, locale) })
            : t("planner.todo.due", { date: formatDateTime(date, locale) })
        return (
          <div
            key={todo.id}
            className={joinClassNames("planner-todo-row", todo.id === selectedTodoId && "is-current")}
            role="listitem"
          >
            <button
              className={joinClassNames("planner-complete-button", todo.status === "done" && "is-complete")}
              aria-label={t(todo.status === "done" ? "planner.todo.restore" : "planner.todo.complete", { title: todo.title })}
              type="button"
              onClick={() => onComplete(todo)}
            >
              {todo.status === "done" ? <CheckIcon /> : null}
            </button>
            <button className="planner-todo-row-content" type="button" onClick={() => onSelect(todo.id)}>
              <span className="planner-todo-row-title">
                <strong>{todo.title}</strong>
                <i className={`is-${todo.priority}`}>{priorityLabel(todo.priority, t)}</i>
              </span>
              <span className="planner-todo-row-meta">
                <small>{dateLabel}</small>
                <small>{todo.projectId ? projectById.get(todo.projectId)?.name ?? todo.projectId : t("planner.todo.noProject")}</small>
                {todo.estimateMinutes ? <small>{t("planner.todo.estimate", { minutes: todo.estimateMinutes })}</small> : null}
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function TodoInspector({
  draft,
  isMutating,
  locale,
  projects,
  runs,
  t,
  todo,
  onCancelRun,
  onCreateAutomation,
  onDelete,
  onDraftChange,
  onOpenSession,
  onRetryRun,
  onSave,
  onStartRun,
  onToggleComplete,
  onUnlinkAutomation,
}: {
  draft: TodoDraft | null
  isMutating: boolean
  locale: string
  projects: PlannerProjectOption[]
  runs: AgentTaskRun[]
  t: PlannerTranslate
  todo: PlannerTodo | undefined
  onCancelRun: (runId: string) => Promise<AgentTaskRun>
  onCreateAutomation: (todo: PlannerTodo, input: AgentAutomationCreateInput) => Promise<AgentAutomationDefinition>
  onDelete: (todo: PlannerTodo) => void
  onDraftChange: (draft: TodoDraft) => void
  onOpenSession?: (sessionId: string) => void
  onRetryRun: (runId: string, input?: Partial<CreateAgentTaskRunInput>) => Promise<AgentTaskRun>
  onSave: (event: FormEvent) => void
  onStartRun: (todoId: string, input: CreateAgentTaskRunInput) => Promise<AgentTaskRun>
  onToggleComplete: (todo: PlannerTodo) => void
  onUnlinkAutomation: (todoId: string, automationId: string) => Promise<PlannerTodo>
}) {
  if (!todo || !draft) {
    return (
      <aside className="planner-inspector planner-inspector-empty" aria-label={t("planner.inspector.aria")}>
        <PlannerNavigationIcon />
        <strong>{t("planner.inspector.emptyTitle")}</strong>
        <span>{t("planner.inspector.emptyDescription")}</span>
      </aside>
    )
  }
  const patchDraft = (patch: Partial<TodoDraft>) => onDraftChange({ ...draft, ...patch })
  return (
    <aside className="planner-inspector" aria-label={t("planner.inspector.aria")}>
      <header>
        <span>{t("planner.inspector.details")}</span>
        <i>{statusLabel(todo.status, t)}</i>
      </header>
      <form className="planner-inspector-form" onSubmit={onSave}>
        <label>
          <span>{t("planner.inspector.title")}</span>
          <input value={draft.title} onChange={(event) => patchDraft({ title: event.currentTarget.value })} />
        </label>
        <label>
          <span>{t("planner.inspector.description")}</span>
          <textarea value={draft.description} onChange={(event) => patchDraft({ description: event.currentTarget.value })} />
        </label>
        <div className="planner-inspector-fields">
          <label>
            <span>{t("planner.inspector.status")}</span>
            <select value={draft.status} onChange={(event) => patchDraft({ status: event.currentTarget.value as PlannerTodoStatus })}>
              {STATUS_VALUES.map((status) => <option key={status} value={status}>{statusLabel(status, t)}</option>)}
            </select>
          </label>
          <label>
            <span>{t("planner.inspector.priority")}</span>
            <select value={draft.priority} onChange={(event) => patchDraft({ priority: event.currentTarget.value as PlannerTodoPriority })}>
              {PRIORITY_VALUES.map((priority) => <option key={priority} value={priority}>{priorityLabel(priority, t)}</option>)}
            </select>
          </label>
        </div>
        <label>
          <span>{t("planner.inspector.project")}</span>
          <select value={draft.projectId} onChange={(event) => patchDraft({ projectId: event.currentTarget.value })}>
            <option value="">{t("planner.todo.noProject")}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <div className="planner-inspector-fields">
          <label>
            <span>{t("planner.inspector.scheduleStart")}</span>
            <input type="datetime-local" value={draft.scheduledStartAt} onChange={(event) => patchDraft({ scheduledStartAt: event.currentTarget.value })} />
          </label>
          <label>
            <span>{t("planner.inspector.scheduleEnd")}</span>
            <input type="datetime-local" value={draft.scheduledEndAt} onChange={(event) => patchDraft({ scheduledEndAt: event.currentTarget.value })} />
          </label>
        </div>
        <label>
          <span>{t("planner.inspector.due")}</span>
          <input type="datetime-local" value={draft.dueAt} onChange={(event) => patchDraft({ dueAt: event.currentTarget.value })} />
        </label>
        <label>
          <span>{t("planner.inspector.estimate")}</span>
          <input min="1" step="1" type="number" value={draft.estimateMinutes} onChange={(event) => patchDraft({ estimateMinutes: event.currentTarget.value })} />
        </label>
        <button className="planner-primary-action" type="submit" disabled={isMutating || !draft.title.trim()}>
          {isMutating ? t("planner.inspector.saving") : t("planner.inspector.save")}
        </button>
      </form>
      <TodoAgentSection
        key={todo.id}
        isMutating={isMutating}
        locale={locale}
        projects={projects}
        runs={runs}
        t={t}
        todo={todo}
        onCancelRun={onCancelRun}
        onCreateAutomation={onCreateAutomation}
        onOpenSession={onOpenSession}
        onRetryRun={onRetryRun}
        onStartRun={onStartRun}
        onUnlinkAutomation={onUnlinkAutomation}
      />
      <div className="planner-inspector-actions">
        <button type="button" onClick={() => onToggleComplete(todo)}>
          <CheckIcon />
          {t(todo.status === "done" ? "planner.inspector.reopen" : "planner.inspector.complete")}
        </button>
        <button className="is-danger" type="button" onClick={() => onDelete(todo)}>
          <DeleteIcon />
          {t("planner.inspector.delete")}
        </button>
      </div>
    </aside>
  )
}

function TodoAgentSection({
  isMutating,
  locale,
  projects,
  runs,
  t,
  todo,
  onCancelRun,
  onCreateAutomation,
  onOpenSession,
  onRetryRun,
  onStartRun,
  onUnlinkAutomation,
}: {
  isMutating: boolean
  locale: string
  projects: PlannerProjectOption[]
  runs: AgentTaskRun[]
  t: PlannerTranslate
  todo: PlannerTodo
  onCancelRun: (runId: string) => Promise<AgentTaskRun>
  onCreateAutomation: (todo: PlannerTodo, input: AgentAutomationCreateInput) => Promise<AgentAutomationDefinition>
  onOpenSession?: (sessionId: string) => void
  onRetryRun: (runId: string, input?: Partial<CreateAgentTaskRunInput>) => Promise<AgentTaskRun>
  onStartRun: (todoId: string, input: CreateAgentTaskRunInput) => Promise<AgentTaskRun>
  onUnlinkAutomation: (todoId: string, automationId: string) => Promise<PlannerTodo>
}) {
  const initialProjectId = todo.projectId ?? projects[0]?.id ?? ""
  const [mode, setMode] = useState<"run" | "automation" | null>(null)
  const [runInstructions, setRunInstructions] = useState("")
  const [runPermissionMode, setRunPermissionMode] = useState<"read-only" | "default">("default")
  const [runProjectId, setRunProjectId] = useState(initialProjectId)
  const [automationDraft, setAutomationDraft] = useState<TodoAutomationDraft>({
    cadence: "weekdays",
    name: todo.title,
    permissionMode: "read-only",
    projectId: initialProjectId,
    prompt: [
      t("planner.automation.defaultPrompt", { title: todo.title }),
      todo.description,
    ].filter(Boolean).join("\n\n"),
    time: "09:00",
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])

  async function startRun(event: FormEvent) {
    event.preventDefault()
    const project = projectsById.get(runProjectId)
    if (!project) return
    setIsSubmitting(true)
    setError(null)
    try {
      await onStartRun(todo.id, {
        projectId: project.id,
        directory: project.directory,
        prompt: runInstructions.trim() || undefined,
        permissionMode: runPermissionMode,
      })
      setMode(null)
      setRunInstructions("")
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function createAutomation(event: FormEvent) {
    event.preventDefault()
    const project = projectsById.get(automationDraft.projectId)
    const name = automationDraft.name.trim()
    const prompt = automationDraft.prompt.trim()
    if (!project || !name || !prompt) return
    setIsSubmitting(true)
    setError(null)
    try {
      await onCreateAutomation(todo, {
        name,
        kind: "project",
        status: "active",
        schedule: createAutomationSchedule(automationDraft.cadence, automationDraft.time),
        scope: { projectIDs: [project.id] },
        execution: {
          environment: "local",
          permissionMode: automationDraft.permissionMode,
        },
        prompt,
        outputPolicy: {
          triage: "findings-only",
          autoArchiveNoFindings: true,
        },
      })
      setMode(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function runAction(action: () => Promise<unknown>) {
    setIsSubmitting(true)
    setError(null)
    try {
      await action()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const patchAutomationDraft = (patch: Partial<TodoAutomationDraft>) => {
    setAutomationDraft((current) => ({ ...current, ...patch }))
  }

  return (
    <section className="planner-agent-section" aria-label={t("planner.agent.aria")}>
      <header>
        <span>
          <SkillIcon />
          {t("planner.agent.title")}
        </span>
        <small>{t("planner.agent.runCount", { count: runs.length })}</small>
      </header>

      <p className="planner-agent-provenance">
        {t("planner.agent.provenance", { module: "planner.core" })}
      </p>

      <div className="planner-agent-launch-actions">
        <button type="button" disabled={isMutating || isSubmitting} onClick={() => setMode(mode === "run" ? null : "run")}>
          <PlayIcon />
          {t("planner.agent.delegate")}
        </button>
        <button type="button" disabled={isMutating || isSubmitting} onClick={() => setMode(mode === "automation" ? null : "automation")}>
          <AutomationIcon />
          {t("planner.automation.convert")}
        </button>
      </div>

      {mode === "run" ? (
        <form className="planner-agent-confirmation" onSubmit={startRun}>
          <strong>{t("planner.agent.previewTitle")}</strong>
          <label>
            <span>{t("planner.agent.targetProject")}</span>
            <select value={runProjectId} onChange={(event) => setRunProjectId(event.currentTarget.value)}>
              <option value="">{t("planner.agent.chooseProject")}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            <span>{t("planner.agent.instructions")}</span>
            <textarea
              value={runInstructions}
              placeholder={t("planner.agent.instructionsPlaceholder")}
              onChange={(event) => setRunInstructions(event.currentTarget.value)}
            />
          </label>
          <label>
            <span>{t("planner.agent.permission")}</span>
            <select value={runPermissionMode} onChange={(event) => setRunPermissionMode(event.currentTarget.value as "read-only" | "default")}>
              <option value="default">{t("planner.agent.permission.default")}</option>
              <option value="read-only">{t("planner.agent.permission.readOnly")}</option>
            </select>
          </label>
          <dl>
            <div><dt>{t("planner.agent.todoState")}</dt><dd>{t("planner.agent.todoStateIndependent")}</dd></div>
            <div><dt>{t("planner.agent.toolSource")}</dt><dd>planner.core · {t("planner.agent.currentTurn")}</dd></div>
          </dl>
          <div className="planner-agent-confirmation-actions">
            <button type="button" onClick={() => setMode(null)}>{t("planner.actions.cancel")}</button>
            <button className="planner-primary-action" type="submit" disabled={!runProjectId || isSubmitting}>
              {isSubmitting ? t("planner.agent.starting") : t("planner.agent.start")}
            </button>
          </div>
        </form>
      ) : null}

      {mode === "automation" ? (
        <form className="planner-agent-confirmation" onSubmit={createAutomation}>
          <strong>{t("planner.automation.previewTitle")}</strong>
          <label>
            <span>{t("planner.automation.name")}</span>
            <input value={automationDraft.name} onChange={(event) => patchAutomationDraft({ name: event.currentTarget.value })} />
          </label>
          <label>
            <span>{t("planner.agent.targetProject")}</span>
            <select value={automationDraft.projectId} onChange={(event) => patchAutomationDraft({ projectId: event.currentTarget.value })}>
              <option value="">{t("planner.agent.chooseProject")}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <div className="planner-agent-confirmation-fields">
            <label>
              <span>{t("planner.automation.cadence")}</span>
              <select value={automationDraft.cadence} onChange={(event) => patchAutomationDraft({ cadence: event.currentTarget.value as PlannerAutomationCadence })}>
                <option value="daily">{t("planner.automation.cadence.daily")}</option>
                <option value="weekdays">{t("planner.automation.cadence.weekdays")}</option>
                <option value="weekly">{t("planner.automation.cadence.weekly")}</option>
              </select>
            </label>
            <label>
              <span>{t("planner.automation.time")}</span>
              <input type="time" value={automationDraft.time} onChange={(event) => patchAutomationDraft({ time: event.currentTarget.value })} />
            </label>
          </div>
          <label>
            <span>{t("planner.agent.permission")}</span>
            <select value={automationDraft.permissionMode} onChange={(event) => patchAutomationDraft({ permissionMode: event.currentTarget.value as "read-only" | "default" })}>
              <option value="read-only">{t("planner.agent.permission.readOnly")}</option>
              <option value="default">{t("planner.agent.permission.default")}</option>
            </select>
          </label>
          <label>
            <span>{t("planner.automation.prompt")}</span>
            <textarea value={automationDraft.prompt} onChange={(event) => patchAutomationDraft({ prompt: event.currentTarget.value })} />
          </label>
          <p>{t("planner.automation.confirmation")}</p>
          <div className="planner-agent-confirmation-actions">
            <button type="button" onClick={() => setMode(null)}>{t("planner.actions.cancel")}</button>
            <button
              className="planner-primary-action"
              type="submit"
              disabled={!automationDraft.projectId || !automationDraft.name.trim() || !automationDraft.prompt.trim() || isSubmitting}
            >
              {isSubmitting ? t("planner.automation.creating") : t("planner.automation.createAndActivate")}
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p className="planner-agent-error" role="alert">{error}</p> : null}

      {todo.automationIds?.length ? (
        <div className="planner-automation-links">
          <h3>{t("planner.automation.linked")}</h3>
          {todo.automationIds.map((automationId) => (
            <div key={automationId}>
              <code>{automationId}</code>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void runAction(() => onUnlinkAutomation(todo.id, automationId))}
              >
                {t("planner.automation.unlink")}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="planner-run-history">
        <h3>{t("planner.agent.history")}</h3>
        {runs.length === 0 ? <p>{t("planner.agent.noRuns")}</p> : runs.map((run) => {
          const isActiveRun = run.status === "queued" || run.status === "running"
          const canRetry = run.status === "failed" || run.status === "canceled" || run.status === "blocked"
          const summary = typeof run.result?.summary === "string" ? run.result.summary : undefined
          const moduleIds = run.requestedToolModuleIds ?? (
            Array.isArray(run.result?.toolModuleIds)
              ? run.result.toolModuleIds.filter((value): value is string => typeof value === "string")
              : []
          )
          return (
            <article key={run.id} className={`is-${run.status}`}>
              <header>
                {isActiveRun ? <SessionRunningIcon /> : <SkillIcon />}
                <strong>{t(`planner.agent.status.${run.status}` as TranslationKey)}</strong>
                <time>{formatDateTime(run.startedAt ?? run.createdAt, locale)}</time>
              </header>
              {run.prompt ? <p>{run.prompt}</p> : null}
              {summary ? <p>{summary}</p> : null}
              {run.error ? <p className="planner-run-error">{run.error}</p> : null}
              <small>
                {t("planner.agent.runProvenance", {
                  mode: t(run.permissionMode === "read-only" ? "planner.agent.permission.readOnly" : "planner.agent.permission.default"),
                  modules: moduleIds.join(", ") || "planner.core",
                })}
              </small>
              <div>
                {run.sessionId && onOpenSession ? (
                  <button type="button" onClick={() => onOpenSession(run.sessionId!)}>{t("planner.agent.openSession")}</button>
                ) : null}
                {isActiveRun ? (
                  <button type="button" disabled={isSubmitting} onClick={() => void runAction(() => onCancelRun(run.id))}>
                    <StopIcon />
                    {t("planner.agent.cancelRun")}
                  </button>
                ) : null}
                {canRetry ? (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void runAction(() => onRetryRun(run.id, {
                      projectId: run.projectId ?? initialProjectId,
                      directory: run.directory ?? projectsById.get(run.projectId ?? initialProjectId)?.directory,
                    }))}
                  >
                    <PlayIcon />
                    {t("planner.agent.retry")}
                  </button>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function ProposalList({ locale, proposals, selectedProposalId, t, onSelect }: {
  locale: string
  proposals: PlanProposal[]
  selectedProposalId: string
  t: PlannerTranslate
  onSelect: (proposalId: string) => void
}) {
  if (proposals.length === 0) {
    return (
      <div className="planner-empty-state">
        <strong>{t("planner.proposal.emptyTitle")}</strong>
        <span>{t("planner.proposal.emptyDescription")}</span>
      </div>
    )
  }
  return (
    <div className="planner-proposal-list" role="list" aria-label={t("planner.proposal.listAria")}>
      {proposals.map((proposal) => (
        <div key={proposal.id} role="listitem">
          <button
            className={joinClassNames("planner-proposal-row", proposal.id === selectedProposalId && "is-current")}
            type="button"
            onClick={() => onSelect(proposal.id)}
          >
            <SkillIcon />
            <span>
              <strong>{proposal.reason}</strong>
              <small>{t("planner.proposal.changeCount", { count: proposal.changes.length })}</small>
            </span>
            <time>{t("planner.proposal.created", { date: formatDateTime(proposal.createdAt, locale) })}</time>
          </button>
        </div>
      ))}
    </div>
  )
}

function ProposalInspector({ isMutating, locale, proposal, projectById, t, todosById, onAccept, onDismiss }: {
  isMutating: boolean
  locale: string
  proposal: PlanProposal | undefined
  projectById: Map<string, PlannerProjectOption>
  t: PlannerTranslate
  todosById: Map<string, PlannerTodo>
  onAccept: (proposal: PlanProposal) => void
  onDismiss: (proposal: PlanProposal) => void
}) {
  if (!proposal) {
    return (
      <aside className="planner-inspector planner-inspector-empty" aria-label={t("planner.proposal.detailsAria")}>
        <SkillIcon />
        <strong>{t("planner.proposal.selectTitle")}</strong>
        <span>{t("planner.proposal.selectDescription")}</span>
      </aside>
    )
  }
  return (
    <aside className="planner-inspector planner-proposal-inspector" aria-label={t("planner.proposal.detailsAria")}>
      <header>
        <span>{t("planner.proposal.reviewTitle")}</span>
        <time>{formatDateTime(proposal.createdAt, locale)}</time>
      </header>
      <h2>{proposal.reason}</h2>
      <section>
        <h3>{t("planner.proposal.changes")}</h3>
        <ol>
          {proposal.changes.map((change, index) => (
            <li key={`${change.kind}-${index}`}>
              <span>{index + 1}</span>
              <div>
                <strong>{proposalChangeLabel(change, todosById, t)}</strong>
                <small>{proposalChangeDetail(change, locale, projectById, t)}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <p className="planner-proposal-warning">{t("planner.proposal.warning")}</p>
      <div className="planner-proposal-actions">
        <button type="button" disabled={isMutating} onClick={() => onDismiss(proposal)}>{t("planner.proposal.dismiss")}</button>
        <button className="planner-primary-action" type="button" disabled={isMutating} onClick={() => onAccept(proposal)}>
          {isMutating ? t("planner.proposal.applying") : t("planner.proposal.accept")}
        </button>
      </div>
    </aside>
  )
}
