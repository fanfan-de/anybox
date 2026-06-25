import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  ArchiveIcon,
  AutomationIcon,
  BackIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  DeleteIcon,
  FolderIcon,
  ForkIcon,
  PauseIcon,
  PlayIcon,
  SessionRunningIcon,
  StopIcon,
} from "../icons"
import { ShellTopMenu, joinClassNames } from "../shared-ui"
import type {
  AgentAutomationCreateInput,
  AgentAutomationDefinition,
  AgentAutomationRun,
  AgentAutomationTriageStatus,
  AgentAutomationUpdateInput,
} from "../../../../shared/desktop-ipc-contract"
import { useI18n } from "../i18n/I18nProvider"
import type { TranslationKey } from "../i18n/translations"

type AgentAutomationSchedule = AgentAutomationDefinition["schedule"]
type AgentAutomationStatus = AgentAutomationDefinition["status"]
type CreateMenuKey = "cadence" | "environment" | "project"
type DetailMenuKey = "cadence" | "environment"
type CreatePanelMode = "manual" | "templates"
type CreateTargetMode = "local" | "worktree"
type AutomationEnvironment = AgentAutomationDefinition["execution"]["environment"]
type DetailCadenceKey = "hourly" | "daily" | "weekdays" | "weekly" | "custom"
type WeekdayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday"
type AutomationDetailDraft = {
  automationID: string
  name: string
  prompt: string
}
type AutomationTextPatch = Pick<AgentAutomationUpdateInput, "name" | "prompt">
type DetailCadenceMenuPosition = {
  left: number
  maxHeight: number
  top: number
}
type AutomationDesktopApi = Required<
  Pick<
    NonNullable<Window["desktop"]>,
    | "cancelAutomationRun"
    | "createAutomation"
    | "deleteAutomation"
    | "listAutomationRuns"
    | "listAutomations"
    | "runAutomation"
    | "updateAutomation"
    | "updateAutomationRunTriage"
  >
>

interface AutomationProjectOption {
  directory: string
  id: string
  name: string
  projectID?: string
  projectKind?: "directory" | "git"
  repositoryRoot?: string
  vcs?: "git"
  worktree?: string
  workspaceRoots?: string[]
}

interface AutomationsPageProps {
  projects: AutomationProjectOption[]
  windowControls?: ReactNode
  onOpenSession?: (sessionID: string) => void
}

type CadenceKey = "one-minute" | "five-minutes" | "fifteen-minutes" | "hourly" | "daily" | "weekdays" | "weekly"

type ScheduleSelection =
  | { cadence: "hourly" }
  | { cadence: "daily"; time?: string }
  | { cadence: "weekdays"; time?: string }
  | { cadence: "weekly"; time?: string; weekday?: WeekdayKey }
  | { cadence: "custom" }

type DetailCadenceMenuView =
  | { step: "frequency" }
  | { step: "time"; cadence: "daily" | "weekdays" }
  | { step: "weekday" }
  | { step: "weekly-time"; weekday: WeekdayKey }

const SCHEDULE_OPTIONS: Array<{
  expression: string
  key: CadenceKey
  labelKey: TranslationKey
  type: AgentAutomationSchedule["type"]
}> = [
  { key: "daily", labelKey: "automations.cadence.daily", type: "rrule", expression: "FREQ=DAILY;INTERVAL=1" },
  { key: "weekdays", labelKey: "automations.cadence.weekdays", type: "cron", expression: "0 9 * * 1-5" },
  { key: "weekly", labelKey: "automations.cadence.weekly", type: "rrule", expression: "FREQ=WEEKLY;INTERVAL=1" },
  { key: "hourly", labelKey: "automations.cadence.hourly", type: "rrule", expression: "FREQ=HOURLY;INTERVAL=1" },
  { key: "fifteen-minutes", labelKey: "automations.cadence.fifteenMinutes", type: "cron", expression: "*/15 * * * *" },
  { key: "five-minutes", labelKey: "automations.cadence.fiveMinutes", type: "cron", expression: "*/5 * * * *" },
  { key: "one-minute", labelKey: "automations.cadence.oneMinute", type: "cron", expression: "*/1 * * * *" },
]

const DETAIL_CADENCE_OPTIONS: Array<{
  key: DetailCadenceKey
  labelKey: TranslationKey
}> = [
  { key: "hourly", labelKey: "automations.cadence.hourly" },
  { key: "daily", labelKey: "automations.cadence.daily" },
  { key: "weekdays", labelKey: "automations.cadence.weekdays" },
  { key: "weekly", labelKey: "automations.cadence.weekly" },
  { key: "custom", labelKey: "automations.cadence.custom" },
]

const WEEKDAY_OPTIONS: Array<{
  cronValue: string
  key: WeekdayKey
  labelKey: TranslationKey
  rruleValue: string
}> = [
  { key: "monday", labelKey: "automations.weekday.monday", cronValue: "1", rruleValue: "MO" },
  { key: "tuesday", labelKey: "automations.weekday.tuesday", cronValue: "2", rruleValue: "TU" },
  { key: "wednesday", labelKey: "automations.weekday.wednesday", cronValue: "3", rruleValue: "WE" },
  { key: "thursday", labelKey: "automations.weekday.thursday", cronValue: "4", rruleValue: "TH" },
  { key: "friday", labelKey: "automations.weekday.friday", cronValue: "5", rruleValue: "FR" },
  { key: "saturday", labelKey: "automations.weekday.saturday", cronValue: "6", rruleValue: "SA" },
  { key: "sunday", labelKey: "automations.weekday.sunday", cronValue: "0", rruleValue: "SU" },
]

const DEFAULT_SCHEDULE_TIME = "09:00"
const DEFAULT_WEEKDAY: WeekdayKey = "monday"
const DETAIL_CADENCE_MENU_WIDTH = 188
const DETAIL_CADENCE_MENU_GAP = 6
const DETAIL_CADENCE_MENU_MAX_HEIGHT = 320
const DETAIL_CADENCE_MENU_MIN_HEIGHT = 180
const DETAIL_CADENCE_MENU_VIEWPORT_PADDING = 8
const SCHEDULE_TIME_OPTIONS = Array.from({ length: 48 }, (_item, index) => {
  const hour = Math.floor(index / 2)
  const minute = index % 2 === 0 ? 0 : 30
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
})

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getDetailCadenceMenuPosition(trigger: HTMLElement): DetailCadenceMenuPosition {
  const rect = trigger.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const maxLeft = Math.max(
    DETAIL_CADENCE_MENU_VIEWPORT_PADDING,
    viewportWidth - DETAIL_CADENCE_MENU_WIDTH - DETAIL_CADENCE_MENU_VIEWPORT_PADDING,
  )
  const left = clampNumber(
    rect.right - DETAIL_CADENCE_MENU_WIDTH,
    DETAIL_CADENCE_MENU_VIEWPORT_PADDING,
    maxLeft,
  )
  const belowTop = rect.bottom + DETAIL_CADENCE_MENU_GAP
  const availableBelow = viewportHeight - belowTop - DETAIL_CADENCE_MENU_VIEWPORT_PADDING
  const availableAbove = rect.top - DETAIL_CADENCE_MENU_GAP - DETAIL_CADENCE_MENU_VIEWPORT_PADDING
  const shouldOpenAbove = availableBelow < DETAIL_CADENCE_MENU_MIN_HEIGHT && availableAbove > availableBelow
  const availableHeight = Math.max(0, shouldOpenAbove ? availableAbove : availableBelow)
  const viewportMaxHeight = Math.max(
    DETAIL_CADENCE_MENU_MIN_HEIGHT,
    viewportHeight - DETAIL_CADENCE_MENU_VIEWPORT_PADDING * 2,
  )
  const maxHeight = Math.min(
    DETAIL_CADENCE_MENU_MAX_HEIGHT,
    viewportMaxHeight,
    Math.max(DETAIL_CADENCE_MENU_MIN_HEIGHT, availableHeight),
  )
  const desiredTop = shouldOpenAbove
    ? rect.top - DETAIL_CADENCE_MENU_GAP - maxHeight
    : belowTop
  const maxTop = Math.max(
    DETAIL_CADENCE_MENU_VIEWPORT_PADDING,
    viewportHeight - maxHeight - DETAIL_CADENCE_MENU_VIEWPORT_PADDING,
  )
  const top = clampNumber(desiredTop, DETAIL_CADENCE_MENU_VIEWPORT_PADDING, maxTop)

  return { left, maxHeight, top }
}

const AUTOMATION_ENVIRONMENT_OPTIONS = ["local", "worktree"] satisfies AutomationEnvironment[]

const AUTOMATION_TEMPLATES: Array<{
  cadence: CadenceKey
  id: string
  nameKey: TranslationKey
  promptKey: TranslationKey
}> = [
  {
    id: "daily-brief",
    cadence: "daily",
    nameKey: "automations.templates.dailyBrief.name",
    promptKey: "automations.templates.dailyBrief.prompt",
  },
  {
    id: "weekly-review",
    cadence: "weekly",
    nameKey: "automations.templates.weeklyReview.name",
    promptKey: "automations.templates.weeklyReview.prompt",
  },
  {
    id: "one-minute-watch",
    cadence: "one-minute",
    nameKey: "automations.templates.oneMinuteWatch.name",
    promptKey: "automations.templates.oneMinuteWatch.prompt",
  },
]

const ACTIVE_RUN_STATUSES = new Set<AgentAutomationRun["status"]>(["queued", "running"])

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

function requireDesktopApi(translate?: Translate): AutomationDesktopApi {
  if (!window.desktop) {
    throw new Error(translate?.("automations.error.desktopApiUnavailable") ?? "Desktop API is unavailable.")
  }
  const desktop = window.desktop
  if (
    !desktop.cancelAutomationRun ||
    !desktop.createAutomation ||
    !desktop.deleteAutomation ||
    !desktop.listAutomationRuns ||
    !desktop.listAutomations ||
    !desktop.runAutomation ||
    !desktop.updateAutomation ||
    !desktop.updateAutomationRunTriage
  ) {
    throw new Error(translate?.("automations.error.automationApiUnavailable") ?? "Automation API is unavailable.")
  }
  return desktop as AutomationDesktopApi
}

function getTemplateDraft(template: (typeof AUTOMATION_TEMPLATES)[number], translate: Translate) {
  return {
    name: translate(template.nameKey),
    prompt: translate(template.promptKey),
  }
}

function parseCronNumber(value: string, min: number, max: number) {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null
  return parsed
}

function formatScheduleTime(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function parseCronTime(minuteField: string, hourField: string) {
  const minute = parseCronNumber(minuteField, 0, 59)
  const hour = parseCronNumber(hourField, 0, 23)
  if (minute === null || hour === null) return null
  return formatScheduleTime(hour, minute)
}

function parseScheduleTime(value: string) {
  const [hourValue, minuteValue] = value.split(":")
  if (hourValue === undefined || minuteValue === undefined) return null
  const hour = parseCronNumber(hourValue, 0, 23)
  const minute = parseCronNumber(minuteValue, 0, 59)
  if (hour === null || minute === null) return null
  return { hour, minute }
}

function getWeekdayOption(weekday: WeekdayKey) {
  return WEEKDAY_OPTIONS.find((option) => option.key === weekday) ?? WEEKDAY_OPTIONS[0]
}

function getWeekdayFromCronValue(value: string): WeekdayKey | null {
  const normalized = value.trim().toUpperCase()
  if (normalized === "7") return "sunday"
  return WEEKDAY_OPTIONS.find((option) => (
    option.cronValue === normalized || option.rruleValue === normalized
  ))?.key ?? null
}

function getWeekdayFromRRuleValue(value: string | undefined): WeekdayKey | null {
  if (!value) return null
  const firstValue = value.split(",")[0]?.trim().toUpperCase()
  if (!firstValue) return null
  return WEEKDAY_OPTIONS.find((option) => option.rruleValue === firstValue)?.key ?? null
}

function parseRRuleExpression(expression: string) {
  return new Map(expression.split(";").map((part) => {
    const [key, ...valueParts] = part.split("=")
    return [key.trim().toUpperCase(), valueParts.join("=").trim().toUpperCase()]
  }))
}

function getScheduleSelection(schedule: AgentAutomationSchedule): ScheduleSelection {
  if (schedule.type === "cron") {
    const cronFields = schedule.expression.trim().split(/\s+/)
    if (cronFields.length !== 5) return { cadence: "custom" }
    const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = cronFields
    if (!minuteField || !hourField || !dayOfMonth || !month || !dayOfWeek) return { cadence: "custom" }

    const time = parseCronTime(minuteField, hourField)
    if (!time || dayOfMonth !== "*" || month !== "*") return { cadence: "custom" }
    if (dayOfWeek === "*") return { cadence: "daily", time }
    if (dayOfWeek === "1-5") return { cadence: "weekdays", time }

    const weekday = getWeekdayFromCronValue(dayOfWeek)
    return weekday ? { cadence: "weekly", weekday, time } : { cadence: "custom" }
  }

  const rrule = parseRRuleExpression(schedule.expression)
  const freq = rrule.get("FREQ")
  const interval = rrule.get("INTERVAL") ?? "1"
  if (freq === "HOURLY" && interval === "1") return { cadence: "hourly" }

  const time = parseCronTime(rrule.get("BYMINUTE") ?? "", rrule.get("BYHOUR") ?? "") ?? undefined
  if (freq === "DAILY" && interval === "1") return { cadence: "daily", time }

  if (freq === "WEEKLY" && interval === "1") {
    const weekday = getWeekdayFromRRuleValue(rrule.get("BYDAY")) ?? undefined
    return { cadence: "weekly", weekday, time }
  }

  return { cadence: "custom" }
}

function getWeekdayLabel(weekday: WeekdayKey, translate: Translate) {
  return translate(getWeekdayOption(weekday).labelKey)
}

function formatScheduleSelectionLabel(selection: ScheduleSelection, translate: Translate) {
  if (selection.cadence === "hourly") return translate("automations.cadence.hourly")
  if (selection.cadence === "daily") {
    return selection.time
      ? translate("automations.schedule.dailyAt", { time: selection.time })
      : translate("automations.cadence.daily")
  }
  if (selection.cadence === "weekdays") {
    return selection.time
      ? translate("automations.schedule.weekdaysAt", { time: selection.time })
      : translate("automations.cadence.weekdays")
  }
  if (selection.cadence === "weekly") {
    if (selection.weekday && selection.time) {
      return translate("automations.schedule.weeklyAt", {
        weekday: getWeekdayLabel(selection.weekday, translate),
        time: selection.time,
      })
    }
    if (selection.weekday) {
      return translate("automations.schedule.weeklyOn", {
        weekday: getWeekdayLabel(selection.weekday, translate),
      })
    }
    return translate("automations.cadence.weekly")
  }
  return translate("automations.cadence.custom")
}

function getScheduleLabel(schedule: AgentAutomationSchedule, translate: Translate) {
  const selection = getScheduleSelection(schedule)
  if (selection.cadence !== "custom") return formatScheduleSelectionLabel(selection, translate)

  const match = SCHEDULE_OPTIONS.find((option) => option.type === schedule.type && option.expression === schedule.expression)
  if (match) return translate(match.labelKey)
  return translate("automations.cadence.custom")
}

function createScheduleFromCadence(
  cadence: Exclude<DetailCadenceKey, "custom">,
  timezone: string,
  options: { time?: string; weekday?: WeekdayKey } = {},
): AgentAutomationSchedule {
  if (cadence === "hourly") {
    return {
      type: "rrule",
      expression: "FREQ=HOURLY;INTERVAL=1",
      timezone,
    }
  }

  const parsedTime = parseScheduleTime(options.time ?? DEFAULT_SCHEDULE_TIME) ?? { hour: 9, minute: 0 }
  if (cadence === "daily") {
    return {
      type: "cron",
      expression: `${parsedTime.minute} ${parsedTime.hour} * * *`,
      timezone,
    }
  }

  if (cadence === "weekdays") {
    return {
      type: "cron",
      expression: `${parsedTime.minute} ${parsedTime.hour} * * 1-5`,
      timezone,
    }
  }

  const weekday = getWeekdayOption(options.weekday ?? DEFAULT_WEEKDAY)
  return {
    type: "cron",
    expression: `${parsedTime.minute} ${parsedTime.hour} * * ${weekday.cronValue}`,
    timezone,
  }
}

function formatDate(
  timestamp: number | undefined,
  locale: string,
  translate: Translate,
  fallbackKey: TranslationKey = "automations.date.notScheduled",
) {
  if (!timestamp) return translate(fallbackKey)
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp)
}

function formatProjectTarget(
  automation: AgentAutomationDefinition,
  projectsByID: Map<string, AutomationProjectOption>,
  translate: Translate,
) {
  const projectNames = (automation.scope.projectIDs ?? [])
    .map((projectID) => projectsByID.get(projectID)?.name ?? projectID)
    .filter(Boolean)
  if (projectNames.length > 0) return projectNames.join(", ")

  const directories = automation.scope.directories ?? []
  if (directories.length > 0) {
    return directories
      .map((directory) => directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory)
      .join(", ")
  }

  if (automation.scope.sessionID) return translate("automations.target.session", { sessionID: automation.scope.sessionID })
  return translate("automations.target.none")
}

function getStatusMarkerClassName(status: AgentAutomationStatus | AgentAutomationRun["status"]) {
  if (status === "active" || status === "completed") return "automations-status-dot is-success"
  if (status === "running" || status === "queued") return "automations-status-dot is-info"
  if (status === "failed" || status === "blocked") return "automations-status-dot is-danger"
  if (status === "cancelled" || status === "paused" || status === "skipped") return "automations-status-dot is-muted"
  return "automations-status-dot"
}

function getRunTitle(run: AgentAutomationRun, automationsByID: Map<string, AgentAutomationDefinition>) {
  return automationsByID.get(run.automationID)?.name ?? run.automationID
}

function getRunSummary(run: AgentAutomationRun, translate: Translate) {
  if (run.error) return run.error
  if (run.summary) return run.summary
  if (run.status === "queued") return translate("automations.runSummary.queued")
  if (run.status === "running") return translate("automations.runSummary.running")
  return translate("automations.runSummary.none")
}

function getRunTimestamp(run: AgentAutomationRun) {
  return run.startedAt ?? run.createdAt
}

function getFindingCountLabel(count: number, translate: Translate) {
  return count === 1
    ? translate("automations.findings.singular", { count })
    : translate("automations.findings.plural", { count })
}

function getRunTriggerLabel(trigger: AgentAutomationRun["trigger"], translate: Translate) {
  if (trigger === "manual") return translate("automations.trigger.manual")
  if (trigger === "schedule") return translate("automations.trigger.schedule")
  return trigger
}

function getStatusLabel(status: AgentAutomationStatus | AgentAutomationRun["status"], translate: Translate) {
  const key = `automations.status.${status}` as TranslationKey
  return translate(key)
}

function renderAutomationStatusValue(status: AgentAutomationStatus | AgentAutomationRun["status"], translate: Translate) {
  const label = getStatusLabel(status, translate)
  return (
    <span className="automation-status-value">
      <span className={getStatusMarkerClassName(status)} aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

function getPermissionModeLabel(permissionMode: string | undefined, translate: Translate) {
  if (!permissionMode || permissionMode === "default") return translate("automations.permission.default")
  if (permissionMode === "read-only") return translate("automations.permission.readOnly")
  if (permissionMode === "full-access" || permissionMode === "full_access") return translate("automations.permission.fullAccess")
  return permissionMode
}

function getEnvironmentLabel(environment: string, translate: Translate) {
  if (environment === "local") return translate("automations.environment.local")
  if (environment === "worktree") return translate("automations.environment.worktree")
  return environment
}

function getReasoningEffortLabel(reasoningEffort: string | undefined | null, translate: Translate) {
  if (!reasoningEffort) return translate("automations.value.default")
  if (reasoningEffort === "low") return translate("automations.reasoning.low")
  if (reasoningEffort === "medium") return translate("automations.reasoning.medium")
  if (reasoningEffort === "high") return translate("automations.reasoning.high")
  if (reasoningEffort === "max") return translate("automations.reasoning.max")
  return reasoningEffort
}

function getOutputPolicyLabel(automation: AgentAutomationDefinition, translate: Translate) {
  if (automation.outputPolicy.triage === "always") return translate("automations.output.always")
  if (automation.outputPolicy.triage === "never") return translate("automations.output.never")
  return automation.outputPolicy.autoArchiveNoFindings
    ? translate("automations.output.findingsOnly")
    : translate("automations.output.findingsReview")
}

function normalizeAutomationTargetPath(value: string | undefined) {
  const trimmed = value?.trim().replace(/\\/g, "/").replace(/\/+$/, "") ?? ""
  if (!trimmed) return ""
  if (trimmed.includes("://")) return trimmed

  const normalized = trimmed.replace(/\/+/g, "/")
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
}

function automationTargetPathEquals(left: string | undefined, right: string | undefined) {
  return normalizeAutomationTargetPath(left) === normalizeAutomationTargetPath(right)
}

function automationTargetPathContains(root: string | undefined, candidate: string | undefined) {
  const normalizedRoot = normalizeAutomationTargetPath(root)
  const normalizedCandidate = normalizeAutomationTargetPath(candidate)
  if (!normalizedRoot || !normalizedCandidate) return false
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
}

function isGitAutomationTarget(project: AutomationProjectOption) {
  return project.projectKind === "git" || project.vcs === "git"
}

function isLinkedWorktreeAutomationTarget(project: AutomationProjectOption) {
  if (!isGitAutomationTarget(project)) return false

  const primaryRoots = [project.worktree, project.repositoryRoot]
    .filter((root): root is string => Boolean(root?.trim()))
  if (primaryRoots.some((root) => automationTargetPathContains(root, project.directory))) return false

  const workspaceRoots = project.workspaceRoots ?? []
  const linkedRoot = workspaceRoots.find((root) => (
    !primaryRoots.some((primaryRoot) => automationTargetPathEquals(root, primaryRoot)) &&
    automationTargetPathContains(root, project.directory)
  ))
  if (linkedRoot) return true

  if (workspaceRoots.length > 0 || primaryRoots.length === 0) return false
  return true
}

function getAutomationTargetProjectID(project: AutomationProjectOption) {
  return project.projectID?.trim() || project.id.trim()
}

function getTargetModeLabel(targetMode: CreateTargetMode, translate: Translate) {
  return targetMode === "local"
    ? translate("automations.environment.local")
    : translate("automations.environment.worktree")
}

function createAutomationScopeForTarget(project: AutomationProjectOption): AgentAutomationCreateInput["scope"] {
  if (isLinkedWorktreeAutomationTarget(project)) {
    return { directories: [project.directory] }
  }

  const projectID = getAutomationTargetProjectID(project)
  return projectID ? { projectIDs: [projectID] } : { directories: [project.directory] }
}

export function AutomationsPage({ projects, windowControls, onOpenSession }: AutomationsPageProps) {
  const { locale, t } = useI18n()
  const defaultTemplate = AUTOMATION_TEMPLATES[0]
  const defaultTemplateDraft = defaultTemplate
    ? getTemplateDraft(defaultTemplate, t)
    : { name: "", prompt: "" }
  const [automations, setAutomations] = useState<AgentAutomationDefinition[]>([])
  const [runs, setRuns] = useState<AgentAutomationRun[]>([])
  const [selectedAutomationID, setSelectedAutomationID] = useState<string | null>(null)
  const [isCreatePanelOpen, setIsCreatePanelOpen] = useState(false)
  const [selectedProjectID, setSelectedProjectID] = useState("")
  const [draftTemplateID, setDraftTemplateID] = useState<string | null>(defaultTemplate?.id ?? null)
  const [draftName, setDraftName] = useState(defaultTemplateDraft.name)
  const [draftPrompt, setDraftPrompt] = useState(defaultTemplateDraft.prompt)
  const [detailDraft, setDetailDraft] = useState<AutomationDetailDraft | null>(null)
  const [cadence, setCadence] = useState<CadenceKey>(AUTOMATION_TEMPLATES[0]?.cadence ?? "daily")
  const [targetMode, setTargetMode] = useState<CreateTargetMode>("worktree")
  const [createPanelMode, setCreatePanelMode] = useState<CreatePanelMode>("manual")
  const [openCreateMenu, setOpenCreateMenu] = useState<CreateMenuKey | null>(null)
  const [openDetailMenu, setOpenDetailMenu] = useState<DetailMenuKey | null>(null)
  const [detailCadenceMenuPosition, setDetailCadenceMenuPosition] = useState<DetailCadenceMenuPosition | null>(null)
  const [detailCadenceMenuView, setDetailCadenceMenuView] = useState<DetailCadenceMenuView>({ step: "frequency" })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [savingDetailKey, setSavingDetailKey] = useState<DetailMenuKey | null>(null)
  const [runningAutomationID, setRunningAutomationID] = useState<string | null>(null)
  const [mutatingRunID, setMutatingRunID] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const detailCadenceTriggerRef = useRef<HTMLButtonElement | null>(null)
  const detailSaveTimeoutRef = useRef<number | null>(null)
  const pendingDetailSaveRef = useRef<{ automationID: string; patch: AutomationTextPatch } | null>(null)

  const selectableProjects = useMemo(
    () => targetMode === "worktree"
      ? projects
      : projects.filter((project) => !isLinkedWorktreeAutomationTarget(project)),
    [projects, targetMode],
  )
  const selectableProjectsByID = useMemo(
    () => new Map(selectableProjects.map((project) => [project.id, project])),
    [selectableProjects],
  )
  const projectsByID = useMemo(() => {
    const nextProjectsByID = new Map<string, AutomationProjectOption>()
    for (const project of projects) {
      const projectID = getAutomationTargetProjectID(project)
      if (!projectID) continue

      const existing = nextProjectsByID.get(projectID)
      if (!existing || (isLinkedWorktreeAutomationTarget(existing) && !isLinkedWorktreeAutomationTarget(project))) {
        nextProjectsByID.set(projectID, project)
      }
    }
    return nextProjectsByID
  }, [projects])
  const automationsByID = useMemo(
    () => new Map(automations.map((automation) => [automation.id, automation])),
    [automations],
  )
  const selectedAutomation = selectedAutomationID ? automationsByID.get(selectedAutomationID) ?? null : null
  const selectedAutomationRuns = selectedAutomationID
    ? runs.filter((run) => run.automationID === selectedAutomationID)
    : []
  const selectedAutomationDraft = selectedAutomation && detailDraft?.automationID === selectedAutomation.id
    ? detailDraft
    : selectedAutomation
      ? {
          automationID: selectedAutomation.id,
          name: selectedAutomation.name,
          prompt: selectedAutomation.prompt,
        }
      : null
  const selectedScheduleOption = SCHEDULE_OPTIONS.find((option) => option.key === cadence) ?? SCHEDULE_OPTIONS[0]
  const selectedScheduleLabel = selectedScheduleOption
    ? t(selectedScheduleOption.labelKey)
    : t("automations.schedule.label")
  const selectedTargetModeLabel = getTargetModeLabel(targetMode, t)
  const selectedProject = selectedProjectID ? selectableProjectsByID.get(selectedProjectID) : undefined
  const selectedTemplateID = draftTemplateID

  useEffect(() => {
    if (selectableProjects.length === 0) {
      if (selectedProjectID) setSelectedProjectID("")
      return
    }

    if (!selectedProjectID || !selectableProjectsByID.has(selectedProjectID)) {
      setSelectedProjectID(selectableProjects[0]?.id ?? "")
    }
  }, [selectableProjects, selectableProjectsByID, selectedProjectID])

  useEffect(() => {
    if (selectedAutomationID && !automationsByID.has(selectedAutomationID)) {
      setSelectedAutomationID(null)
    }
  }, [automationsByID, selectedAutomationID])

  useEffect(() => {
    if (!selectedAutomation) {
      setDetailDraft(null)
      return
    }

    setDetailDraft((current) => {
      if (current?.automationID === selectedAutomation.id) return current
      return {
        automationID: selectedAutomation.id,
        name: selectedAutomation.name,
        prompt: selectedAutomation.prompt,
      }
    })
  }, [selectedAutomation])

  useEffect(() => {
    return () => {
      if (detailSaveTimeoutRef.current !== null) {
        window.clearTimeout(detailSaveTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!draftTemplateID) return
    const template = AUTOMATION_TEMPLATES.find((item) => item.id === draftTemplateID)
    if (!template) return
    const templateDraft = getTemplateDraft(template, t)
    setDraftName(templateDraft.name)
    setDraftPrompt(templateDraft.prompt)
    setCadence(template.cadence)
  }, [draftTemplateID, t])

  useEffect(() => {
    if (!openCreateMenu) return

    function closeCreateMenu(event: MouseEvent) {
      const target = event.target
      if (target instanceof Element && target.closest(".automations-create-menu-anchor")) return
      setOpenCreateMenu(null)
    }

    function closeCreateMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenCreateMenu(null)
      }
    }

    document.addEventListener("mousedown", closeCreateMenu)
    document.addEventListener("keydown", closeCreateMenuOnEscape)
    return () => {
      document.removeEventListener("mousedown", closeCreateMenu)
      document.removeEventListener("keydown", closeCreateMenuOnEscape)
    }
  }, [openCreateMenu])

  useEffect(() => {
    if (!openDetailMenu) return

    function closeDetailMenu(event: MouseEvent) {
      const target = event.target
      if (target instanceof Element && target.closest(".automation-detail-menu-anchor, .automation-detail-menu-portal")) return
      setOpenDetailMenu(null)
    }

    function closeDetailMenuOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenDetailMenu(null)
      }
    }

    document.addEventListener("mousedown", closeDetailMenu)
    document.addEventListener("keydown", closeDetailMenuOnEscape)
    return () => {
      document.removeEventListener("mousedown", closeDetailMenu)
      document.removeEventListener("keydown", closeDetailMenuOnEscape)
    }
  }, [openDetailMenu])

  useEffect(() => {
    if (openDetailMenu !== "cadence") {
      setDetailCadenceMenuPosition(null)
      return
    }

    function updatePosition() {
      const trigger = detailCadenceTriggerRef.current
      if (!trigger) return
      setDetailCadenceMenuPosition(getDetailCadenceMenuPosition(trigger))
    }

    updatePosition()
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [openDetailMenu])

  async function refreshAutomations(options: { silent?: boolean } = {}) {
    if (!options.silent) setIsLoading(true)
    try {
      const desktop = requireDesktopApi(t)
      const [nextAutomations, nextRuns] = await Promise.all([
        desktop.listAutomations(),
        desktop.listAutomationRuns({ limit: 100 }),
      ])
      setAutomations(nextAutomations.filter((automation) => automation.status !== "deleted"))
      setRuns(nextRuns)
      setError(null)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError))
    } finally {
      if (!options.silent) setIsLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      await refreshAutomations()
      if (cancelled) return
    }

    void load()
    const intervalID = window.setInterval(() => {
      void refreshAutomations({ silent: true })
    }, 5000)

    return () => {
      cancelled = true
      window.clearInterval(intervalID)
    }
  }, [])

  function applyTemplate(templateID: string) {
    const template = AUTOMATION_TEMPLATES.find((item) => item.id === templateID)
    if (!template) return
    const templateDraft = getTemplateDraft(template, t)
    setDraftName(templateDraft.name)
    setDraftPrompt(templateDraft.prompt)
    setCadence(template.cadence)
    setDraftTemplateID(template.id)
    setOpenCreateMenu(null)
    setCreatePanelMode("manual")
  }

  function closeCreatePanel() {
    setOpenCreateMenu(null)
    setCreatePanelMode("manual")
    setIsCreatePanelOpen(false)
  }

  function normalizeAutomationTextPatch(patch: AutomationTextPatch): AutomationTextPatch {
    const normalized: AutomationTextPatch = {}
    if (typeof patch.name === "string" && patch.name.trim()) {
      normalized.name = patch.name
    }
    if (typeof patch.prompt === "string" && patch.prompt.trim()) {
      normalized.prompt = patch.prompt
    }
    return normalized
  }

  function updateAutomationInList(automationID: string, patch: Partial<AgentAutomationDefinition>) {
    setAutomations((current) => current.map((automation) => (
      automation.id === automationID
        ? {
            ...automation,
            ...patch,
            updatedAt: Date.now(),
          }
        : automation
    )))
  }

  async function flushAutomationTextSave() {
    if (detailSaveTimeoutRef.current !== null) {
      window.clearTimeout(detailSaveTimeoutRef.current)
      detailSaveTimeoutRef.current = null
    }

    const pending = pendingDetailSaveRef.current
    pendingDetailSaveRef.current = null
    if (!pending) return

    const patch = normalizeAutomationTextPatch(pending.patch)
    if (Object.keys(patch).length === 0) return

    try {
      const updatedAutomation = await requireDesktopApi(t).updateAutomation({
        automationID: pending.automationID,
        automation: patch,
      })
      setAutomations((current) => current.map((automation) => (
        automation.id === updatedAutomation.id ? updatedAutomation : automation
      )))
      setError(null)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError))
    }
  }

  function scheduleAutomationTextSave(automationID: string, patch: AutomationTextPatch) {
    pendingDetailSaveRef.current = {
      automationID,
      patch: {
        ...pendingDetailSaveRef.current?.patch,
        ...patch,
      },
    }

    if (detailSaveTimeoutRef.current !== null) {
      window.clearTimeout(detailSaveTimeoutRef.current)
    }
    detailSaveTimeoutRef.current = window.setTimeout(() => {
      void flushAutomationTextSave()
    }, 400)
  }

  function updateSelectedAutomationText(patch: AutomationTextPatch) {
    if (!selectedAutomation || !selectedAutomationDraft) return
    const nextDraft = {
      automationID: selectedAutomation.id,
      name: patch.name ?? selectedAutomationDraft.name,
      prompt: patch.prompt ?? selectedAutomationDraft.prompt,
    }
    setDetailDraft(nextDraft)
    updateAutomationInList(selectedAutomation.id, patch)
    scheduleAutomationTextSave(selectedAutomation.id, patch)
  }

  async function updateAutomationDetailConfiguration(
    automation: AgentAutomationDefinition,
    patch: AgentAutomationUpdateInput,
    optimisticPatch: Partial<AgentAutomationDefinition>,
    detailKey: DetailMenuKey,
  ) {
    setOpenDetailMenu(null)
    setSavingDetailKey(detailKey)
    updateAutomationInList(automation.id, optimisticPatch)

    try {
      const updatedAutomation = await requireDesktopApi(t).updateAutomation({
        automationID: automation.id,
        automation: patch,
      })
      setAutomations((current) => current.map((item) => (
        item.id === updatedAutomation.id ? updatedAutomation : item
      )))
      setError(null)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError))
      await refreshAutomations({ silent: true })
    } finally {
      setSavingDetailKey((current) => current === detailKey ? null : current)
    }
  }

  function openDetailCadenceMenu(automation: AgentAutomationDefinition) {
    if (openDetailMenu === "cadence") {
      setOpenDetailMenu(null)
      return
    }

    const trigger = detailCadenceTriggerRef.current
    if (trigger) {
      setDetailCadenceMenuPosition(getDetailCadenceMenuPosition(trigger))
    }
    setDetailCadenceMenuView({ step: "frequency" })
    setOpenDetailMenu("cadence")
  }

  function updateSelectedAutomationSchedule(automation: AgentAutomationDefinition, nextSchedule: AgentAutomationSchedule) {
    if (
      nextSchedule.type === automation.schedule.type &&
      nextSchedule.expression === automation.schedule.expression &&
      nextSchedule.timezone === automation.schedule.timezone
    ) {
      setOpenDetailMenu(null)
      return
    }

    void updateAutomationDetailConfiguration(
      automation,
      { schedule: nextSchedule },
      { schedule: nextSchedule },
      "cadence",
    )
  }

  function updateSelectedAutomationCadence(
    automation: AgentAutomationDefinition,
    cadence: Exclude<DetailCadenceKey, "custom">,
    options: { time?: string; weekday?: WeekdayKey } = {},
  ) {
    updateSelectedAutomationSchedule(
      automation,
      createScheduleFromCadence(cadence, automation.schedule.timezone || "UTC", options),
    )
  }

  function updateSelectedAutomationEnvironment(
    automation: AgentAutomationDefinition,
    environment: AutomationEnvironment,
  ) {
    if (environment === automation.execution.environment) {
      setOpenDetailMenu(null)
      return
    }

    const nextExecution = {
      ...automation.execution,
      environment,
    }
    void updateAutomationDetailConfiguration(
      automation,
      { execution: { environment } },
      { execution: nextExecution },
      "environment",
    )
  }

  async function handleCreateAutomation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const project = selectableProjectsByID.get(selectedProjectID)
    const name = draftName.trim()
    const prompt = draftPrompt.trim()
    if (!project) {
      setError(t("automations.error.selectProject"))
      return
    }
    if (!name || !prompt) {
      setError(t("automations.error.namePromptRequired"))
      return
    }

    const scheduleOption = SCHEDULE_OPTIONS.find((option) => option.key === cadence) ?? SCHEDULE_OPTIONS[0]
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    const input: AgentAutomationCreateInput = {
      name,
      kind: "project",
      status: "active",
      schedule: {
        type: scheduleOption.type,
        expression: scheduleOption.expression,
        timezone,
      },
      scope: createAutomationScopeForTarget(project),
      execution: {
        environment: "local",
        permissionMode: "default",
      },
      prompt,
      outputPolicy: {
        triage: "findings-only",
        autoArchiveNoFindings: true,
      },
    }

    setIsSaving(true)
    try {
      const createdAutomation = await requireDesktopApi(t).createAutomation(input)
      setError(null)
      closeCreatePanel()
      setSelectedAutomationID(createdAutomation.id)
      await refreshAutomations({ silent: true })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setIsSaving(false)
    }
  }

  async function updateAutomationStatus(automation: AgentAutomationDefinition, status: AgentAutomationStatus) {
    try {
      await requireDesktopApi(t).updateAutomation({
        automationID: automation.id,
        automation: { status },
      })
      await refreshAutomations({ silent: true })
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError))
    }
  }

  async function deleteAutomation(automation: AgentAutomationDefinition) {
    if (!window.confirm(t("automations.confirmDelete", { name: automation.name }))) return
    try {
      await requireDesktopApi(t).deleteAutomation({ automationID: automation.id })
      setSelectedAutomationID(null)
      await refreshAutomations({ silent: true })
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
    }
  }

  async function runAutomation(automationID: string) {
    setRunningAutomationID(automationID)
    try {
      await requireDesktopApi(t).runAutomation({ automationID })
      await refreshAutomations({ silent: true })
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError))
    } finally {
      setRunningAutomationID(null)
    }
  }

  async function setRunTriage(runID: string, triageStatus: AgentAutomationTriageStatus) {
    setMutatingRunID(runID)
    try {
      await requireDesktopApi(t).updateAutomationRunTriage({ runID, triageStatus })
      await refreshAutomations({ silent: true })
    } catch (triageError) {
      setError(triageError instanceof Error ? triageError.message : String(triageError))
    } finally {
      setMutatingRunID(null)
    }
  }

  async function cancelRun(runID: string) {
    setMutatingRunID(runID)
    try {
      await requireDesktopApi(t).cancelAutomationRun({ runID })
      await refreshAutomations({ silent: true })
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError))
    } finally {
      setMutatingRunID(null)
    }
  }

  function renderDetailCadenceMenu(automation: AgentAutomationDefinition) {
    if (openDetailMenu !== "cadence" || !detailCadenceMenuPosition) return null

    const scheduleSelection = getScheduleSelection(automation.schedule)
    const selectedTime = scheduleSelection.cadence === "daily" || scheduleSelection.cadence === "weekdays" || scheduleSelection.cadence === "weekly"
      ? scheduleSelection.time
      : undefined
    const selectedWeekday = scheduleSelection.cadence === "weekly" ? scheduleSelection.weekday : undefined
    const menuStyle = {
      left: detailCadenceMenuPosition.left,
      top: detailCadenceMenuPosition.top,
      "--automation-detail-cadence-menu-max-height": `${detailCadenceMenuPosition.maxHeight}px`,
    } as CSSProperties & Record<"--automation-detail-cadence-menu-max-height", string>
    const isSubView = detailCadenceMenuView.step !== "frequency"
    const title = detailCadenceMenuView.step === "time"
      ? t(detailCadenceMenuView.cadence === "daily" ? "automations.cadence.daily" : "automations.cadence.weekdays")
      : detailCadenceMenuView.step === "weekday"
        ? t("automations.cadence.weekly")
        : detailCadenceMenuView.step === "weekly-time"
          ? getWeekdayLabel(detailCadenceMenuView.weekday, t)
          : t("automations.cadence.menuLabel")
    const backView = detailCadenceMenuView.step === "weekly-time"
      ? { step: "weekday" } satisfies DetailCadenceMenuView
      : { step: "frequency" } satisfies DetailCadenceMenuView

    const cadenceMenu = (
      <div
        className="automations-create-menu automation-detail-menu automation-detail-menu-portal automation-detail-cadence-menu"
        role="menu"
        aria-label={t("automations.cadence.menuLabel")}
        style={menuStyle}
      >
        {isSubView ? (
          <div className="automation-cadence-menu-header">
            <button
              className="automation-cadence-menu-back"
              type="button"
              aria-label={t("automations.schedule.backToCadence")}
              title={t("automations.schedule.backToCadence")}
              onClick={() => setDetailCadenceMenuView(backView)}
            >
              <BackIcon />
            </button>
            <span>{title}</span>
          </div>
        ) : null}

        <div className="automation-cadence-menu-list">
          {detailCadenceMenuView.step === "frequency" ? DETAIL_CADENCE_OPTIONS.map((option) => {
            const hasSubmenu = option.key === "daily" || option.key === "weekdays" || option.key === "weekly"
            const isSelected = scheduleSelection.cadence === option.key
            const isCustomUnavailable = option.key === "custom" && !isSelected

            return (
              <button
                key={option.key}
                className={joinClassNames("automations-create-menu-option automation-cadence-menu-option", isSelected && "is-selected")}
                type="button"
                role={hasSubmenu ? "menuitem" : "menuitemradio"}
                aria-checked={hasSubmenu ? undefined : isSelected}
                aria-disabled={isCustomUnavailable ? true : undefined}
                aria-haspopup={hasSubmenu ? "menu" : undefined}
                title={option.key === "custom" ? t("automations.schedule.customUnavailable") : undefined}
                onClick={() => {
                  if (option.key === "hourly") {
                    updateSelectedAutomationCadence(automation, "hourly")
                    return
                  }
                  if (option.key === "custom") {
                    if (isCustomUnavailable) return
                    setOpenDetailMenu(null)
                    return
                  }
                  if (option.key === "weekly") {
                    setDetailCadenceMenuView({ step: "weekday" })
                    return
                  }
                  setDetailCadenceMenuView({ step: "time", cadence: option.key })
                }}
              >
                <span className="automation-cadence-menu-state" aria-hidden="true">
                  {isSelected ? <CheckIcon /> : null}
                </span>
                <span className="automation-cadence-menu-label">{t(option.labelKey)}</span>
                <span className="automation-cadence-menu-submenu-icon" aria-hidden="true">
                  {hasSubmenu ? <ChevronRightIcon /> : null}
                </span>
              </button>
            )
          }) : null}

          {detailCadenceMenuView.step === "time" ? SCHEDULE_TIME_OPTIONS.map((time) => {
            const isSelected = scheduleSelection.cadence === detailCadenceMenuView.cadence && selectedTime === time
            return (
              <button
                key={`${detailCadenceMenuView.cadence}-${time}`}
                className={joinClassNames("automations-create-menu-option automation-cadence-menu-option", isSelected && "is-selected")}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => updateSelectedAutomationCadence(automation, detailCadenceMenuView.cadence, { time })}
              >
                <span className="automation-cadence-menu-state" aria-hidden="true">
                  {isSelected ? <CheckIcon /> : null}
                </span>
                <span className="automation-cadence-menu-label">{time}</span>
                <span className="automation-cadence-menu-submenu-icon" aria-hidden="true" />
              </button>
            )
          }) : null}

          {detailCadenceMenuView.step === "weekday" ? WEEKDAY_OPTIONS.map((weekday) => {
            const isSelected = selectedWeekday === weekday.key
            return (
              <button
                key={weekday.key}
                className={joinClassNames("automations-create-menu-option automation-cadence-menu-option", isSelected && "is-selected")}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                onClick={() => setDetailCadenceMenuView({ step: "weekly-time", weekday: weekday.key })}
              >
                <span className="automation-cadence-menu-state" aria-hidden="true">
                  {isSelected ? <CheckIcon /> : null}
                </span>
                <span className="automation-cadence-menu-label">{t(weekday.labelKey)}</span>
                <span className="automation-cadence-menu-submenu-icon" aria-hidden="true">
                  <ChevronRightIcon />
                </span>
              </button>
            )
          }) : null}

          {detailCadenceMenuView.step === "weekly-time" ? SCHEDULE_TIME_OPTIONS.map((time) => {
            const isSelected = selectedWeekday === detailCadenceMenuView.weekday && selectedTime === time
            return (
              <button
                key={`weekly-${detailCadenceMenuView.weekday}-${time}`}
                className={joinClassNames("automations-create-menu-option automation-cadence-menu-option", isSelected && "is-selected")}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => updateSelectedAutomationCadence(automation, "weekly", { weekday: detailCadenceMenuView.weekday, time })}
              >
                <span className="automation-cadence-menu-state" aria-hidden="true">
                  {isSelected ? <CheckIcon /> : null}
                </span>
                <span className="automation-cadence-menu-label">{time}</span>
                <span className="automation-cadence-menu-submenu-icon" aria-hidden="true" />
              </button>
            )
          }) : null}
        </div>
      </div>
    )

    return createPortal(cadenceMenu, document.body)
  }

  const createPanel = isCreatePanelOpen ? (
    <div className="automations-create-overlay">
      <section className="automations-create-panel" role="dialog" aria-modal="true" aria-label={t("automations.create.dialogLabel")}>
        {createPanelMode === "templates" ? (
          <div className="automations-template-browser">
            <header className="automations-template-browser-header">
              <h2>{t("automations.templates.title")}</h2>
              <div className="automations-create-header-actions">
                <button
                  className="automations-create-control-button automations-template-manual-button"
                  type="button"
                  onClick={() => {
                    setOpenCreateMenu(null)
                    setCreatePanelMode("manual")
                  }}
                >
                  {t("automations.templates.manualSetup")}
                </button>
                <button
                  className="icon-button automations-create-close"
                  type="button"
                  aria-label={t("app.cancel")}
                  title={t("app.cancel")}
                  onClick={closeCreatePanel}
                >
                  <CloseIcon />
                </button>
              </div>
            </header>

            <div className="automations-template-browser-grid" aria-label={t("automations.templates.title")}>
              {AUTOMATION_TEMPLATES.map((template) => {
                const templateDraft = getTemplateDraft(template, t)
                const templateSchedule = SCHEDULE_OPTIONS.find((option) => option.key === template.cadence)
                return (
                  <button
                    key={template.id}
                    className={joinClassNames("automations-template-card", selectedTemplateID === template.id && "is-selected")}
                    type="button"
                    onClick={() => applyTemplate(template.id)}
                  >
                    <span className="automations-template-card-title">{templateDraft.name}</span>
                    <span className="automations-template-card-copy">{templateDraft.prompt}</span>
                    {templateSchedule ? (
                      <span className="automations-template-card-meta">{t(templateSchedule.labelKey)}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <form className="automations-create-composer" onSubmit={handleCreateAutomation}>
          <header className="automations-create-header">
            <input
              aria-label={t("automations.create.titleLabel")}
              className="automations-create-title-input"
              type="text"
              placeholder={t("automations.create.titlePlaceholder")}
              value={draftName}
              onChange={(event) => {
                setDraftName(event.target.value)
                setDraftTemplateID(null)
              }}
            />

            <div className="automations-create-header-actions">
              <div className="automations-create-menu-anchor">
                <button
                  className="automations-create-control-button"
                  type="button"
                  onClick={() => {
                    setOpenCreateMenu(null)
                    setCreatePanelMode("templates")
                  }}
                >
                  <span>{t("automations.create.useTemplate")}</span>
                </button>
              </div>

              <button
                className="icon-button automations-create-close"
                type="button"
                aria-label={t("app.cancel")}
                title={t("app.cancel")}
                onClick={closeCreatePanel}
              >
                <CloseIcon />
              </button>
            </div>
          </header>

          <textarea
            className="automations-create-prompt-input"
            aria-label={t("automations.create.promptLabel")}
            placeholder={t("automations.create.promptPlaceholder")}
            value={draftPrompt}
            onChange={(event) => {
              setDraftPrompt(event.target.value)
              setDraftTemplateID(null)
            }}
          />

          <div className="automations-create-footer">
            <div className="automations-create-controls" aria-label={t("automations.create.configurationLabel")}>
              <div className="automations-create-menu-anchor">
                <button
                  className={joinClassNames("automations-create-control-button", openCreateMenu === "environment" && "is-active")}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={openCreateMenu === "environment"}
                  title={t("automations.environment.menuLabel")}
                  onClick={() => setOpenCreateMenu((current) => current === "environment" ? null : "environment")}
                >
                  {targetMode === "local" ? <FolderIcon /> : <ForkIcon />}
                  <span>{selectedTargetModeLabel}</span>
                </button>

                {openCreateMenu === "environment" ? (
                  <div className="automations-create-menu automations-environment-menu" role="menu" aria-label={t("automations.environment.menuLabel")}>
                    {(["local", "worktree"] satisfies CreateTargetMode[]).map((mode) => (
                      <button
                        key={mode}
                        className={joinClassNames("automations-create-menu-option", targetMode === mode && "is-selected")}
                        type="button"
                        role="menuitemradio"
                        aria-checked={targetMode === mode}
                        onClick={() => {
                          setTargetMode(mode)
                          setOpenCreateMenu(null)
                        }}
                      >
                        <span className="automations-create-menu-copy">
                          <strong>{getTargetModeLabel(mode, t)}</strong>
                        </span>
                        {targetMode === mode ? <CheckIcon /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="automations-create-menu-anchor">
                <button
                  className={joinClassNames("automations-create-control-button", openCreateMenu === "project" && "is-active")}
                  type="button"
                  disabled={selectableProjects.length === 0}
                  aria-haspopup="menu"
                  aria-expanded={openCreateMenu === "project"}
                  onClick={() => setOpenCreateMenu((current) => current === "project" ? null : "project")}
                >
                  <span>{selectedProject?.name ?? t("automations.project.select")}</span>
                </button>

                {openCreateMenu === "project" ? (
                  <div className="automations-create-menu automations-project-menu" role="menu" aria-label={t("automations.project.menuLabel")}>
                    {selectableProjects.map((project) => (
                      <button
                        key={project.id}
                        className={joinClassNames("automations-create-menu-option", selectedProjectID === project.id && "is-selected")}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selectedProjectID === project.id}
                        onClick={() => {
                          setSelectedProjectID(project.id)
                          setOpenCreateMenu(null)
                        }}
                      >
                        <span className="automations-create-menu-copy">
                          <strong>{project.name}</strong>
                        </span>
                        {selectedProjectID === project.id ? <CheckIcon /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="automations-create-menu-anchor">
                <button
                  className={joinClassNames("automations-create-control-button", openCreateMenu === "cadence" && "is-active")}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={openCreateMenu === "cadence"}
                  onClick={() => setOpenCreateMenu((current) => current === "cadence" ? null : "cadence")}
                >
                  <span>{selectedScheduleLabel}</span>
                </button>

                {openCreateMenu === "cadence" ? (
                  <div className="automations-create-menu automations-cadence-menu" role="menu" aria-label={t("automations.cadence.menuLabel")}>
                    {SCHEDULE_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        className={joinClassNames("automations-create-menu-option", cadence === option.key && "is-selected")}
                        type="button"
                        role="menuitemradio"
                        aria-checked={cadence === option.key}
                        onClick={() => {
                          setCadence(option.key)
                          setDraftTemplateID(null)
                          setOpenCreateMenu(null)
                        }}
                      >
                        <span className="automations-create-menu-copy">
                          <strong>{t(option.labelKey)}</strong>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="automations-create-actions">
              <button
                className="secondary-button automations-create-cancel"
                type="button"
                onClick={closeCreatePanel}
              >
                {t("app.cancel")}
              </button>
              <button
                className="primary-button automations-create-button"
                type="submit"
                aria-label={t("automations.create.submit")}
                disabled={isSaving || selectableProjects.length === 0}
              >
                {isSaving ? t("automations.create.creating") : t("automations.create.create")}
              </button>
            </div>
          </div>
          </form>
        )}
      </section>
    </div>
  ) : null

  return (
    <section className="automations-page" aria-label={t("automations.title")}>
      <ShellTopMenu
        as="header"
        ariaLabel={t("automations.topMenu")}
        className="canvas-region-top-menu automations-top-menu"
        contentClassName="canvas-region-top-menu-tabs-shell"
        content={(
          <div className="automations-top-menu-label">
            <AutomationIcon />
            <span>{t("automations.title")}</span>
          </div>
        )}
        dragRegion
        layout="three-column"
        trailing={windowControls}
        trailingClassName="automations-top-menu-window-controls"
      />

      <div className="automations-page-main">
        {error ? (
          <div className="automations-banner is-error" role="alert">
            {error}
          </div>
        ) : null}

        {selectedAutomation ? (
          <section className="automation-detail" aria-label={t("automations.detail.ariaLabel", { name: selectedAutomation.name })}>
            <header className="automation-detail-header">
              <nav className="automation-detail-breadcrumb" aria-label={t("automations.detail.sidebarLabel")}>
                <button
                  className="automation-detail-breadcrumb-link"
                  type="button"
                  aria-label={t("automations.detail.back")}
                  title={t("automations.detail.back")}
                  onClick={() => setSelectedAutomationID(null)}
                >
                  {t("automations.title")}
                </button>
                <ChevronRightIcon />
                <span className="automation-detail-breadcrumb-current">{selectedAutomationDraft?.name ?? selectedAutomation.name}</span>
              </nav>
            </header>

            <div className="automation-detail-layout">
              <main className="automation-detail-main">
                <section className="automation-detail-section">
                  <h1 className="automation-detail-title-heading">
                    <input
                      className="automation-detail-title-input"
                      aria-label={t("automations.create.titleLabel")}
                      value={selectedAutomationDraft?.name ?? selectedAutomation.name}
                      onChange={(event) => updateSelectedAutomationText({ name: event.target.value })}
                      onBlur={() => void flushAutomationTextSave()}
                    />
                  </h1>
                  <textarea
                    className="automation-detail-prompt-input"
                    aria-label={t("automations.create.promptLabel")}
                    value={selectedAutomationDraft?.prompt ?? selectedAutomation.prompt}
                    rows={8}
                    onChange={(event) => updateSelectedAutomationText({ prompt: event.target.value })}
                    onBlur={() => void flushAutomationTextSave()}
                  />
                </section>
              </main>

              <aside className="automation-detail-sidebar" aria-label={t("automations.detail.sidebarLabel")}>
                <div className="automation-sidebar-actions">
                  {(() => {
                    const isRunning = runningAutomationID === selectedAutomation.id
                    const activeRun = runs.find((run) => run.automationID === selectedAutomation.id && ACTIVE_RUN_STATUSES.has(run.status))
                    const isActive = selectedAutomation.status === "active"
                    return (
                      <>
                        <button
                          className="secondary-button automations-run-now-button"
                          type="button"
                          disabled={isRunning || Boolean(activeRun)}
                          onClick={() => void runAutomation(selectedAutomation.id)}
                        >
                          {isRunning || activeRun ? t("automations.actions.running") : t("automations.actions.runNow")}
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={isActive
                            ? t("automations.actions.pauseNamed", { name: selectedAutomation.name })
                            : t("automations.actions.resumeNamed", { name: selectedAutomation.name })}
                          title={isActive
                            ? t("automations.actions.pauseNamed", { name: selectedAutomation.name })
                            : t("automations.actions.resumeNamed", { name: selectedAutomation.name })}
                          onClick={() => void updateAutomationStatus(selectedAutomation, isActive ? "paused" : "active")}
                        >
                          {isActive ? <PauseIcon /> : <PlayIcon />}
                        </button>
                        <button
                          className="icon-button is-danger"
                          type="button"
                          aria-label={t("automations.actions.deleteNamed", { name: selectedAutomation.name })}
                          title={t("automations.actions.deleteNamed", { name: selectedAutomation.name })}
                          onClick={() => void deleteAutomation(selectedAutomation)}
                        >
                          <DeleteIcon />
                        </button>
                      </>
                    )
                  })()}
                </div>

                <section className="automation-sidebar-section">
                  <h2>{t("automations.detail.status")}</h2>
                  <dl className="automation-detail-list">
                    <div>
                      <dt>{t("automations.detail.status")}</dt>
                      <dd>{renderAutomationStatusValue(selectedAutomation.status, t)}</dd>
                    </div>
                    <div>
                      <dt>{t("automations.detail.nextRun")}</dt>
                      <dd>{formatDate(selectedAutomation.nextRunAt, locale, t)}</dd>
                    </div>
                    <div>
                      <dt>{t("automations.detail.lastRun")}</dt>
                      <dd>{formatDate(selectedAutomation.lastRunAt, locale, t, "automations.date.never")}</dd>
                    </div>
                  </dl>
                </section>

                <section className="automation-sidebar-section">
                  <h2>{t("automations.detail.details")}</h2>
                  <dl className="automation-detail-list">
                    <div>
                      <dt>{t("automations.detail.target")}</dt>
                      <dd>{formatProjectTarget(selectedAutomation, projectsByID, t)}</dd>
                    </div>
                    <div>
                      <dt>{t("automations.detail.cadence")}</dt>
                      <dd className="automation-detail-select-cell">
                        <div className="automation-detail-menu-anchor">
                          <button
                            ref={detailCadenceTriggerRef}
                            className={joinClassNames("automation-detail-select-trigger", openDetailMenu === "cadence" && "is-active")}
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={openDetailMenu === "cadence"}
                            aria-label={t("automations.cadence.menuLabel")}
                            title={getScheduleLabel(selectedAutomation.schedule, t)}
                            disabled={savingDetailKey === "cadence"}
                            onClick={() => openDetailCadenceMenu(selectedAutomation)}
                          >
                            <span>{getScheduleLabel(selectedAutomation.schedule, t)}</span>
                            <ChevronDownIcon />
                          </button>

                          {renderDetailCadenceMenu(selectedAutomation)}
                        </div>
                      </dd>
                    </div>
                    <div>
                      <dt>{t("automations.detail.timezone")}</dt>
                      <dd>{selectedAutomation.schedule.timezone}</dd>
                    </div>
                    <div>
                      <dt>{t("automations.detail.environment")}</dt>
                      <dd className="automation-detail-select-cell">
                        <div className="automation-detail-menu-anchor">
                          <button
                            className={joinClassNames("automation-detail-select-trigger", openDetailMenu === "environment" && "is-active")}
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={openDetailMenu === "environment"}
                            aria-label={t("automations.environment.menuLabel")}
                            title={getEnvironmentLabel(selectedAutomation.execution.environment, t)}
                            disabled={savingDetailKey === "environment"}
                            onClick={() => setOpenDetailMenu((current) => current === "environment" ? null : "environment")}
                          >
                            <span>{getEnvironmentLabel(selectedAutomation.execution.environment, t)}</span>
                            <ChevronDownIcon />
                          </button>

                          {openDetailMenu === "environment" ? (
                            <div className="automations-create-menu automations-environment-menu automation-detail-menu automation-detail-environment-menu" role="menu" aria-label={t("automations.environment.menuLabel")}>
                              {AUTOMATION_ENVIRONMENT_OPTIONS.map((environment) => {
                                const isSelected = selectedAutomation.execution.environment === environment

                                return (
                                  <button
                                    key={environment}
                                    className={joinClassNames("automations-create-menu-option", isSelected && "is-selected")}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={isSelected}
                                    onClick={() => updateSelectedAutomationEnvironment(selectedAutomation, environment)}
                                  >
                                    <span className="automations-create-menu-copy">
                                      <strong>{getEnvironmentLabel(environment, t)}</strong>
                                    </span>
                                    {isSelected ? <CheckIcon /> : null}
                                  </button>
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      </dd>
                    </div>
                    <div>
                      <dt>{t("automations.detail.permission")}</dt>
                      <dd>{getPermissionModeLabel(selectedAutomation.execution.permissionMode, t)}</dd>
                    </div>
                    <div>
                      <dt>{t("automations.detail.model")}</dt>
                      <dd>{selectedAutomation.execution.model ?? t("automations.value.default")}</dd>
                    </div>
                    <div>
                      <dt>{t("automations.detail.reasoning")}</dt>
                      <dd>{getReasoningEffortLabel(selectedAutomation.execution.reasoning_effort, t)}</dd>
                    </div>
                    <div>
                      <dt>{t("automations.detail.output")}</dt>
                      <dd>{getOutputPolicyLabel(selectedAutomation, t)}</dd>
                    </div>
                  </dl>
                </section>

                <section className="automation-sidebar-section">
                  <div className="automation-section-title-row">
                    <h2>{t("automations.detail.runHistory")}</h2>
                    <button className="secondary-button" type="button" onClick={() => void refreshAutomations()}>
                      {t("app.refresh")}
                    </button>
                  </div>

                  {selectedAutomationRuns.length === 0 ? (
                    <article className="automations-empty-state">
                      <h3>{t("automations.runs.emptyTitle")}</h3>
                      <p>{t("automations.runs.emptyCopy")}</p>
                    </article>
                  ) : (
                    <div className="automations-run-list">
                      {selectedAutomationRuns.map((run) => {
                        const isActiveRun = ACTIVE_RUN_STATUSES.has(run.status)
                        const isMutating = mutatingRunID === run.id

                        return (
                          <article key={run.id} className={joinClassNames("automations-run-card", isActiveRun && "is-active")}>
                            <div className="automations-run-header">
                              <strong>{getRunTitle(run, automationsByID)}</strong>
                              {renderAutomationStatusValue(run.status, t)}
                            </div>
                            <p>{getRunSummary(run, t)}</p>
                            <div className="automations-run-meta">
                              <span>{getRunTriggerLabel(run.trigger, t)}</span>
                              <span>{getFindingCountLabel(run.findingCount, t)}</span>
                              <span>{formatDate(getRunTimestamp(run), locale, t, "automations.date.unknownTime")}</span>
                            </div>
                            <div className="automations-run-actions">
                              {run.sessionID ? (
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() => onOpenSession?.(run.sessionID!)}
                                >
                                  {t("automations.actions.open")}
                                </button>
                              ) : null}
                              {isActiveRun ? (
                                <button
                                  className="icon-button"
                                  type="button"
                                  aria-label={t("automations.actions.cancelRun")}
                                  title={t("automations.actions.cancelRun")}
                                  disabled={isMutating}
                                  onClick={() => void cancelRun(run.id)}
                                >
                                  <StopIcon />
                                </button>
                              ) : (
                                <>
                                  <button
                                    className="icon-button"
                                    type="button"
                                    aria-label={t("automations.actions.markRunRead")}
                                    title={t("automations.actions.markRunRead")}
                                    disabled={isMutating}
                                    onClick={() => void setRunTriage(run.id, "read")}
                                  >
                                    <CheckIcon />
                                  </button>
                                  <button
                                    className="icon-button"
                                    type="button"
                                    aria-label={t("automations.actions.archiveRun")}
                                    title={t("automations.actions.archiveRun")}
                                    disabled={isMutating}
                                    onClick={() => void setRunTriage(run.id, "archived")}
                                  >
                                    <ArchiveIcon />
                                  </button>
                                </>
                              )}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </section>
              </aside>
            </div>
          </section>
        ) : (
          <section className="automations-index" aria-label={t("automations.list.ariaLabel")}>
            <header className="automations-index-header">
              <div className="automations-index-title">
                <h1>{t("automations.title")}</h1>
              </div>

              <div className="automations-index-actions">
                <button
                  className="secondary-button automations-index-action-button"
                  type="button"
                  onClick={() => void refreshAutomations()}
                >
                  {t("app.refresh")}
                </button>
                <button
                  className="primary-button automations-index-action-button automations-index-primary-action"
                  type="button"
                  onClick={() => setIsCreatePanelOpen(true)}
                >
                  {t("automations.actions.newAutomation")}
                </button>
              </div>
            </header>

            {isLoading ? (
              <article className="automations-empty-state">
                <h3>{t("automations.loading.title")}</h3>
                <p>{t("automations.loading.copy")}</p>
              </article>
            ) : automations.length === 0 ? (
              <article className="automations-empty-state">
                <h3>{t("automations.empty.title")}</h3>
                <p>{t("automations.empty.copy")}</p>
              </article>
            ) : (
              <div className="automations-index-list" role="list">
                {automations.map((automation) => {
                  const activeRun = runs.find((run) => run.automationID === automation.id && ACTIVE_RUN_STATUSES.has(run.status))
                  const isRunning = runningAutomationID === automation.id
                  const isActive = automation.status === "active"
                  const effectiveStatus = activeRun?.status ?? automation.status
                  const effectiveStatusLabel = getStatusLabel(effectiveStatus, t)
                  const statusToggleLabel = isActive
                    ? t("automations.actions.pauseNamed", { name: automation.name })
                    : t("automations.actions.resumeNamed", { name: automation.name })

                  return (
                    <article
                      key={automation.id}
                      className="automations-index-row"
                      role="listitem"
                    >
                      <span
                        className={getStatusMarkerClassName(effectiveStatus)}
                        role="img"
                        aria-label={effectiveStatusLabel}
                        title={effectiveStatusLabel}
                      />
                      <button
                        className="automations-index-row-open"
                        type="button"
                        aria-label={t("automations.actions.openNamed", { name: automation.name })}
                        onClick={() => setSelectedAutomationID(automation.id)}
                      >
                        <span className="automations-index-row-main">
                          <span className="automations-index-row-title">
                            <strong>{automation.name}</strong>
                            <span>{formatProjectTarget(automation, projectsByID, t)}</span>
                          </span>
                        </span>
                        <span className="automations-index-row-meta">
                          <span>{getScheduleLabel(automation.schedule, t)}</span>
                          <span>{formatDate(automation.nextRunAt, locale, t)}</span>
                        </span>
                      </button>
                      <span className="automations-index-row-actions">
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={t("automations.actions.runNamed", { name: automation.name })}
                          title={t("automations.actions.runNamed", { name: automation.name })}
                          disabled={isRunning || Boolean(activeRun)}
                          onClick={() => void runAutomation(automation.id)}
                        >
                          {isRunning || activeRun ? <SessionRunningIcon /> : <AutomationIcon />}
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={statusToggleLabel}
                          title={statusToggleLabel}
                          onClick={() => void updateAutomationStatus(automation, isActive ? "paused" : "active")}
                        >
                          {isActive ? <PauseIcon /> : <PlayIcon />}
                        </button>
                        <button
                          className="icon-button is-danger"
                          type="button"
                          aria-label={t("automations.actions.deleteNamed", { name: automation.name })}
                          title={t("automations.actions.deleteNamed", { name: automation.name })}
                          onClick={() => void deleteAutomation(automation)}
                        >
                          <DeleteIcon />
                        </button>
                      </span>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {createPanel}
      </div>
    </section>
  )
}
