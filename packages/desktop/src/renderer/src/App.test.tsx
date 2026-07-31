import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { DockviewApi } from "dockview-react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { DesktopAppUpdateState, MobileBridgeDesktopEvent } from "../../shared/desktop-ipc-contract"
import type { PermissionRequestPrompt, PermissionResolveResult } from "../../shared/permission"
import { App } from "./App"
import {
  DEFAULT_RIGHT_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_RIGHT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_RIGHT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  RIGHT_SIDEBAR_MIN_LEFT_EDGE_RATIO,
} from "./app/constants"
import type { LoadedFolderWorkspace, ProviderModel, SessionRuntimeDebugSnapshot } from "./app/types"

function readBundledStyles() {
  const stylesRoot = resolve(process.cwd(), "src/renderer/src")
  const entry = readFileSync(resolve(stylesRoot, "styles/index.css"), "utf8")
  const imports = Array.from(entry.matchAll(/@import\s+"(.+?)";/g), (match) => match[1])

  return imports
    .map((relativePath) => readFileSync(resolve(stylesRoot, "styles", relativePath.replace("./", "")), "utf8"))
    .join("\n")
}

const styles = readBundledStyles()

function createAppUpdateState(overrides: Partial<DesktopAppUpdateState> = {}): DesktopAppUpdateState {
  const baseState: DesktopAppUpdateState = {
    phase: "idle",
    version: "1.2.3",
    automaticUpdates: true,
    updateChecksSupported: true,
    latestVersion: null,
    downloadPercent: null,
    downloadTransferredBytes: null,
    downloadTotalBytes: null,
    downloadBytesPerSecond: null,
    error: null,
    lastCheckedAt: null,
    releaseNotes: null,
  }
  return { ...baseState, ...overrides }
}

declare global {
  interface Window {
    __anyboxWorkbenchDockviewApi?: DockviewApi | null
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, reject, resolve }
}

function getComposerSendButton() {
  return screen.getByRole("button", { name: /^(Send|Sending|Stop) task$|^Resolve approval first$/ })
}

function setElementScrollMetrics(
  node: HTMLElement,
  metrics: {
    clientHeight: number
    scrollHeight: number
    scrollTop?: number
  },
) {
  Object.defineProperty(node, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  })
  Object.defineProperty(node, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  })
  if (metrics.scrollTop !== undefined) {
    node.scrollTop = metrics.scrollTop
  }
}

async function openProviderSettingsSection() {
  fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
  const settingsDialog = await screen.findByRole("dialog", { name: "Settings" })
  fireEvent.click(screen.getByRole("button", { name: "Provider" }))
  return settingsDialog
}

function openActivityRailConfigurationView(label: string | RegExp) {
  if (label === "Open skills" || label === "Open prompts") {
    fireEvent.click(screen.getByRole("button", { name: "Open prompts and skills" }))
    if (label === "Open skills") {
      fireEvent.click(screen.getByRole("tab", { name: "Skills", hidden: true }))
    }
    return
  }
  fireEvent.click(screen.getByRole("button", { name: label }))
}

async function openLocalSkillEditor() {
  const detailTabs = await screen.findByRole("tablist", { name: "Skill detail sections" })
  fireEvent.click(within(detailTabs).getByRole("tab", { name: "Files" }))
  const viewMode = await screen.findByRole("group", { name: "Skill file view mode" })
  fireEvent.click(within(viewMode).getByRole("button", { name: "Edit" }))
  return screen.findByRole("textbox", { name: "Local skill editor" })
}

function expandSettingsDisclosure(label: string | RegExp) {
  const disclosureButton = screen.getByRole("button", { name: label })
  if (disclosureButton.getAttribute("aria-expanded") === "false") {
    fireEvent.click(disclosureButton)
  }
}

function setComposerDraftValue(input: HTMLElement, value: string) {
  if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
    fireEvent.change(input, {
      target: {
        value,
      },
    })
    return
  }

  act(() => {
    input.dispatchEvent(new CustomEvent("desktop-composer-change", {
      bubbles: true,
      detail: { value },
    }))
  })
}

function expectComposerDraftValue(input: HTMLElement, value: string) {
  if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
    expect(input).toHaveValue(value)
    return
  }

  expect(input.textContent ?? "").toBe(value)
}

type DesktopAgentSession = NonNullable<NonNullable<Window["desktop"]>["agentSession"]>
type DesktopAgentSessionEventListener = Parameters<DesktopAgentSession["onEvent"]>[0]
type DesktopAgentSessionEvent = Parameters<DesktopAgentSessionEventListener>[0]

let agentSessionEventListeners: DesktopAgentSessionEventListener[] = []


function createRequestStreamEvent(input: {
  backendSessionID: string
  clientTurnID: string
  id?: string
  event: string
  data: unknown
}): DesktopAgentSessionEvent {
  return {
    kind: "stream",
    source: "request",
    backendSessionID: input.backendSessionID,
    clientTurnID: input.clientTurnID,
    id: input.id,
    event: input.event,
    data: input.data,
    receivedAt: Date.now(),
  }
}

function createSubscriptionStreamEvent(input: {
  backendSessionID: string
  uiSessionID?: string
  id?: string
  event: string
  data: unknown
}): DesktopAgentSessionEvent {
  return {
    kind: "stream",
    source: "subscription",
    backendSessionID: input.backendSessionID,
    uiSessionID: input.uiSessionID,
    id: input.id,
    event: input.event,
    data: input.data,
    receivedAt: Date.now(),
  }
}

function createFocusSessionEvent(backendSessionID: string): DesktopAgentSessionEvent {
  return {
    kind: "focus-session",
    backendSessionID,
    receivedAt: Date.now(),
  }
}

function getCreateSessionProjectSelect() {
  return screen.getByRole("combobox", { name: "Session project" })
}

function expectCreateSessionProjectSelectLabel(label: string) {
  expect(getCreateSessionProjectSelect()).toHaveTextContent(label)
}

function selectCreateSessionProject(label: string) {
  fireEvent.click(getCreateSessionProjectSelect())
  fireEvent.click(screen.getByRole("option", { name: label }))
}

function getAppearanceThemeLibrary() {
  const themeLibrary = screen.getByRole("heading", { name: "Theme Library" }).closest("section")
  if (!themeLibrary) {
    throw new Error("Theme Library section not found.")
  }
  return themeLibrary
}

async function getWorkbenchDockviewApi() {
  await waitFor(() => {
    expect(window.__anyboxWorkbenchDockviewApi).toBeTruthy()
  })

  return window.__anyboxWorkbenchDockviewApi!
}

async function findDockviewPanel(panelIDPrefix: string) {
  const api = await getWorkbenchDockviewApi()
  await waitFor(() => {
    expect(api.panels.some((panel) => panel.id.startsWith(panelIDPrefix))).toBe(true)
  })

  const panel = api.panels.find((item) => item.id.startsWith(panelIDPrefix))
  if (!panel) {
    throw new Error(`Dockview panel not found for prefix ${panelIDPrefix}.`)
  }

  return { api, panel }
}

function getPaneID(pane: HTMLElement) {
  const paneID = pane.dataset.paneId
  if (!paneID) {
    throw new Error("Workbench pane is missing a data-pane-id attribute.")
  }

  return paneID
}

function sortPanesWithCreateSessionLast(panes: HTMLElement[]) {
  const createPane = panes.find((pane) => within(pane).queryByRole("combobox", { name: "Session project" }))
  if (!createPane) return panes

  return [
    ...panes.filter((pane) => pane !== createPane),
    createPane,
  ]
}

function getPaneCanvasTitle(pane: HTMLElement) {
  return pane.querySelector(".session-canvas-top-menu .label")?.textContent?.trim() ?? ""
}

async function getWorkbenchPanes(count: number) {
  await waitFor(() => {
    expect(document.querySelectorAll(".workbench-pane")).toHaveLength(count)
  })

  return Array.from(document.querySelectorAll(".workbench-pane")) as HTMLElement[]
}

async function moveDockviewPanelToNewGroup(panelIDPrefix: string, position: "right" | "bottom" = "right") {
  const { panel } = await findDockviewPanel(panelIDPrefix)
  act(() => {
    panel.api.moveTo({ group: panel.api.group, position } as Parameters<typeof panel.api.moveTo>[0])
    panel.api.setActive()
  })

  return getWorkbenchPanes(2)
}

async function moveDockviewPanelToPane(
  panelIDPrefix: string,
  targetPane: HTMLElement,
  position: "center" | "right" | "bottom" = "center",
) {
  const { api, panel } = await findDockviewPanel(panelIDPrefix)
  const group = api.getGroup(getPaneID(targetPane))
  if (!group) {
    throw new Error(`Dockview group not found for pane ${getPaneID(targetPane)}.`)
  }

  act(() => {
    panel.api.moveTo({ group, position } as Parameters<typeof panel.api.moveTo>[0])
    panel.api.setActive()
  })
}

function getAddSessionTabButton() {
  const button = screen.getAllByRole("button", { name: "Add session tab" })[0]
  if (!button) throw new Error("Add session tab button not found.")
  return button
}

async function createSiblingPaneFromCreateTab() {
  fireEvent.click(getAddSessionTabButton())
  await screen.findByRole("combobox", { name: "Session project" })

  const panes = await moveDockviewPanelToNewGroup("create-session:", "right")
  return sortPanesWithCreateSessionLast(panes)
}

async function createStackedPaneFromCreateTab() {
  fireEvent.click(getAddSessionTabButton())
  await screen.findByRole("combobox", { name: "Session project" })

  const panes = await moveDockviewPanelToNewGroup("create-session:", "bottom")
  return sortPanesWithCreateSessionLast(panes)
}

type PermissionRequestPromptOverrides = Omit<Partial<PermissionRequestPrompt>, "prompt" | "resolution"> & {
  prompt?: Omit<Partial<PermissionRequestPrompt["prompt"]>, "details"> & {
    details?: Partial<NonNullable<PermissionRequestPrompt["prompt"]["details"]>>
  }
  resolution?: Partial<NonNullable<PermissionRequestPrompt["resolution"]>>
}

function createPermissionRequest(overrides: PermissionRequestPromptOverrides = {}): PermissionRequestPrompt {
  const base: PermissionRequestPrompt = {
    id: "permission-1",
    approvalID: "approval-1",
    sessionID: "session-backend",
    messageID: "message-1",
    toolCallID: "toolcall-1",
    projectID: "project-backend",
    agent: "plan",
    status: "pending",
    createdAt: 1,
    prompt: {
      title: "Read repo config",
      summary: "Read README.md",
      rationale: "The agent needs your approval before it can continue this tool call.",
      risk: "medium",
      detailsAvailable: true,
      details: {
        paths: ["README.md"],
        workdir: "C:\\Projects\\anybox",
      },
      allowedDecisions: ["deny", "allow"],
      recommendedDecision: "allow",
    },
  }

  const prompt = Object.prototype.hasOwnProperty.call(overrides, "prompt")
    ? {
        title: overrides.prompt?.title ?? base.prompt.title,
        summary: overrides.prompt?.summary ?? base.prompt.summary,
        rationale: overrides.prompt?.rationale ?? base.prompt.rationale,
        risk: overrides.prompt?.risk ?? base.prompt.risk,
        detailsAvailable: overrides.prompt?.detailsAvailable ?? base.prompt.detailsAvailable,
        details: Object.prototype.hasOwnProperty.call(overrides.prompt ?? {}, "details")
          ? overrides.prompt?.details
            ? {
                ...(base.prompt.details ?? {}),
                ...overrides.prompt.details,
              }
            : overrides.prompt?.details
          : base.prompt.details,
        allowedDecisions: overrides.prompt?.allowedDecisions ?? base.prompt.allowedDecisions,
        recommendedDecision: overrides.prompt?.recommendedDecision ?? base.prompt.recommendedDecision,
      }
    : base.prompt

  const resolution = Object.prototype.hasOwnProperty.call(overrides, "resolution")
    ? overrides.resolution
      ? {
          decision: overrides.resolution.decision ?? "allow",
          note: overrides.resolution.note,
          approved: overrides.resolution.approved ?? true,
          resolvedAt: overrides.resolution.resolvedAt ?? 120,
        }
      : overrides.resolution
    : base.resolution

  return {
    ...base,
    ...overrides,
    prompt,
    resolution,
  }
}

function createPermissionResolveResult(overrides: PermissionRequestPromptOverrides = {}): PermissionResolveResult {
  return {
    request: createPermissionRequest({
      ...overrides,
      status: overrides.status ?? "approved",
      resolution: overrides.resolution ?? {
        decision: "allow",
        approved: true,
        resolvedAt: 120,
      },
    }),
  }
}

function createSessionRuntimeDebugSnapshot(): SessionRuntimeDebugSnapshot {
  return {
    generatedAt: 1,
    logging: {},
    session: {
      id: "session-chat-1",
      directory: "C:\\Projects\\Project 2",
      title: "Chat 1",
      created: 1,
      updated: 1,
      missing: false,
    },
    status: {
      type: "busy",
      phase: "executing_tool",
    },
    running: {
      sessionID: "session-chat-1",
      startedAt: 1,
      activeForMs: 4200,
      reason: "streaming",
    },
    activeTurnID: "turn-1",
    latestTurn: {
      turnID: "turn-1",
      startedAt: 1,
      lastEventAt: 4200,
      durationMs: 4200,
      status: "running",
      phase: "executing_tool",
      phaseUpdatedAt: 4000,
      agent: "plan",
      model: "openai/gpt-5.4",
      resume: false,
      llmCalls: [
        {
          id: "llm-1",
          messageID: "msg-1",
          providerID: "openai",
          modelID: "gpt-5.4",
          status: "completed",
          startedAt: 1,
          endedAt: 1200,
          durationMs: 1199,
          messageCount: 3,
          finishReason: "tool-calls",
        },
      ],
      tools: [
        {
          callID: "tool-1",
          tool: "shell",
          title: "Inspect repo",
          status: "running",
          startedAt: 1300,
          durationMs: 2900,
          inputPreview: "Get-ChildItem",
        },
      ],
      error: null,
      errorContext: null,
      message: null,
      recentEvents: [
        {
          eventID: "evt-1",
          type: "llm.call.completed",
          sessionID: "session-chat-1",
          turnID: "turn-1",
          seq: 1,
          timestamp: 1200,
          cursor: "1:1200",
          title: "LLM request completed",
          detail: "openai/gpt-5.4",
          tone: "success",
        },
        {
          eventID: "evt-2",
          type: "tool.call.started",
          sessionID: "session-chat-1",
          turnID: "turn-1",
          seq: 2,
          timestamp: 1300,
          cursor: "2:1300",
          title: "Tool started: shell",
          detail: "Inspect repo",
          tone: "info",
        },
      ],
    },
    turns: [],
    recentEvents: [
      {
        eventID: "evt-1",
        type: "llm.call.completed",
        sessionID: "session-chat-1",
        turnID: "turn-1",
        seq: 1,
        timestamp: 1200,
        cursor: "1:1200",
        title: "LLM request completed",
        detail: "openai/gpt-5.4",
        tone: "success",
      },
      {
        eventID: "evt-2",
        type: "tool.call.started",
        sessionID: "session-chat-1",
        turnID: "turn-1",
        seq: 2,
        timestamp: 1300,
        cursor: "2:1300",
        title: "Tool started: shell",
        detail: "Inspect repo",
        tone: "info",
      },
    ],
    diagnostics: {
      blockedOnApproval: false,
      activeToolCount: 1,
      failedToolCount: 0,
      llmFailureCount: 0,
    },
  }
}

const FRONTEND_WORKSPACE_DIRECTORY = "C:\\Projects\\Atlas\\frontend"
const BACKEND_WORKSPACE_DIRECTORY = "C:\\Projects\\Atlas\\backend"
const WORKSPACE_FILE_PATH = "src/focus-files.tsx"
const WORKSPACE_FILE_CONTENT = [
  "export const focusValue = 1",
  "const nextValue = focusValue + 1",
  "export const summary = nextValue",
].join("\n")

type PromptPresetFixture = {
  id: string
  label: string
  description: string
  source: "bundled" | "custom"
  hasOverride: boolean
  editable: boolean
  sourcePath?: string
}

const PROMPT_PRESET_FIXTURES: PromptPresetFixture[] = [
  {
    id: "system-default",
    label: "System prompt",
    description: "Base instructions applied to every session execution.",
    source: "bundled" as const,
    hasOverride: false,
    editable: false,
    sourcePath: "src/session/prompt/default.md",
  },
  {
    id: "plan-mode",
    label: "Plan mode prompt",
    description: "Additional instructions appended when the plan agent is active.",
    source: "bundled" as const,
    hasOverride: false,
    editable: false,
    sourcePath: "src/session/prompt/plan.md",
  },
  {
    id: "git-commit-message",
    label: "Git commit message prompt",
    description: "Instructions used when auto-generating Git commit subjects.",
    source: "bundled" as const,
    hasOverride: false,
    editable: false,
    sourcePath: "src/session/prompt/git-commit-message.md",
  },
  {
    id: "cinema-text-generation",
    label: "Cinema text generation prompt",
    description: "System instructions used when generating content for Cinema text nodes.",
    source: "bundled" as const,
    hasOverride: false,
    editable: false,
    sourcePath: "src/session/prompt/cinema-text-generation.md",
  },
  {
    id: "provider-gpt",
    label: "GPT Provider Prompt",
    description: "Reserved provider-specific prompt for GPT-family models.",
    source: "bundled" as const,
    hasOverride: false,
    editable: false,
    sourcePath: "src/session/prompt/gpt.md",
  },
]

const PROMPT_PRESET_SELECTION_FIXTURE = {
  systemPromptPresetID: "system-default",
  planModePromptPresetID: "plan-mode",
  gitCommitPromptPresetID: "git-commit-message",
  cinemaTextGenerationPromptPresetID: "cinema-text-generation",
}

function createPromptPresetSummary(
  presetID: string,
  overrides: Partial<PromptPresetFixture> = {},
) {
  const preset = PROMPT_PRESET_FIXTURES.find((item) => item.id === presetID)
  if (preset) {
    return {
      ...preset,
      ...overrides,
    }
  }

  return {
    id: presetID,
    label: "Untitled preset",
    description: "Custom prompt preset.",
    source: "custom" as const,
    hasOverride: false,
    editable: true,
    sourcePath: undefined,
    ...overrides,
  }
}

function createPromptPresetDocument(
  presetID: string,
  overrides: Partial<PromptPresetFixture> & { content?: string } = {},
) {
  const preset = createPromptPresetSummary(presetID, overrides)

  const defaultContent =
    presetID === "system-default"
      ? "You are Anybox, an interactive tool that helps users with software engineering tasks."
      : presetID === "plan-mode"
        ? "<system-reminder>\n# Plan Mode - System Reminder"
        : presetID === "git-commit-message"
            ? "You generate Git commit messages."
        : preset.source === "custom"
          ? ""
        : "GPT provider prompt placeholder. This preset is currently inactive."

  return {
    ...preset,
    ...overrides,
    content: overrides.content ?? defaultContent,
  }
}

function createProviderModelFixture(overrides: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: "gpt-5",
    providerID: "openai",
    providerName: "OpenAI",
    name: "GPT-5",
    status: "active",
    available: true,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
    },
    limit: {
      context: 128000,
      output: 8192,
    },
    ...overrides,
  }
}

function createWorkspaceFileReviewWorkspaces(): LoadedFolderWorkspace[] {
  return [
    {
      id: FRONTEND_WORKSPACE_DIRECTORY,
      directory: FRONTEND_WORKSPACE_DIRECTORY,
      name: "frontend",
      created: 1,
      updated: 30,
      project: {
        id: "project-atlas",
        name: "Atlas",
        worktree: "C:\\Projects\\Atlas",
      },
      sessions: [
        {
          id: "session-frontend-review",
          projectID: "project-atlas",
          directory: FRONTEND_WORKSPACE_DIRECTORY,
          title: "Frontend review",
          created: 1,
          updated: 30,
        },
      ],
    },
    {
      id: BACKEND_WORKSPACE_DIRECTORY,
      directory: BACKEND_WORKSPACE_DIRECTORY,
      name: "backend",
      created: 2,
      updated: 20,
      project: {
        id: "project-atlas",
        name: "Atlas",
        worktree: "C:\\Projects\\Atlas",
      },
      sessions: [
        {
          id: "session-backend-review",
          projectID: "project-atlas",
          directory: BACKEND_WORKSPACE_DIRECTORY,
          title: "Backend review",
          created: 2,
          updated: 20,
        },
      ],
    },
  ]
}

function createWorkspaceDirectoryFixture(path: string | null | undefined) {
  const normalizedPath = (path ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  if (!normalizedPath) {
    return [
      {
        name: "src",
        path: "src",
        kind: "directory" as const,
        extension: null,
        hasChildren: true,
      },
    ]
  }

  if (normalizedPath === "src") {
    return [
      {
        name: "focus-files.tsx",
        path: WORKSPACE_FILE_PATH,
        kind: "file" as const,
        extension: "tsx",
        hasChildren: false,
      },
    ]
  }

  return []
}

async function openWorkspaceFileFromTree(inspector: HTMLElement) {
  fireEvent.click(await within(inspector).findByRole("button", { name: /^Files/ }))
  fireEvent.click(await within(inspector).findByRole("button", { name: "src" }))
  fireEvent.click(await within(inspector).findByRole("button", { name: /focus-files\.tsx/i }))
}

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear()
    agentSessionEventListeners = []
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    window.desktop = {
      platform: "win32",
      versions: {
        node: "22.0.0",
        chrome: "130.0.0",
        electron: "39.0.0",
      } as NodeJS.ProcessVersions,
      getInfo: vi.fn().mockResolvedValue({
        platform: "win32",
        node: "22.0.0",
        chrome: "130.0.0",
        electron: "39.0.0",
      }),
      getRuntimeCapabilities: vi.fn().mockResolvedValue({
        developmentFeaturesEnabled: true,
        appearanceAuthoringEnabled: true,
      }),
      startSemanticTokenInspector: vi.fn().mockResolvedValue({ status: "active" }),
      inspectSemanticTokenAtPoint: vi.fn().mockResolvedValue({
        status: "unavailable",
        requestID: 0,
        reason: "target-not-found",
        message: "No target.",
      }),
      stopSemanticTokenInspector: vi.fn().mockResolvedValue({ status: "inactive" }),
      onSemanticTokenInspectorEvent: vi.fn().mockReturnValue(() => undefined),
      getAppUpdateState: vi.fn().mockResolvedValue(createAppUpdateState()),
      setAutomaticUpdatesEnabled: vi.fn().mockImplementation(
        ({ enabled }: { enabled: boolean }) => Promise.resolve({
          version: "1.2.3",
          automaticUpdates: enabled,
          updateChecksSupported: true,
        }),
      ),
      checkForAppUpdates: vi.fn().mockResolvedValue({
        ok: true,
        skipped: false,
        reason: "started",
        state: createAppUpdateState({ phase: "checking" }),
      }),
      installAppUpdate: vi.fn().mockResolvedValue({ ok: true }),
      getRunningSessionStatus: vi.fn().mockResolvedValue({
        running: false,
        count: 0,
        sessionIDs: [],
        checkedAt: 1,
      }),
      getWindowState: vi.fn().mockResolvedValue({
        isMaximized: false,
      }),
      getAppearanceConfig: vi.fn().mockResolvedValue({
        path: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\appearance-theme.json",
        exists: true,
        document: {
          version: 1,
          brandTheme: "terra",
          colorMode: "system",
          overrides: {},
          resolvedTokens: {},
          updatedAt: 1,
        },
      }),
      saveAppearanceConfig: vi.fn().mockImplementation(async ({ document }: { document: Record<string, unknown> }) => ({
        path: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\appearance-theme.json",
        exists: true,
        document: {
          ...document,
          updatedAt: typeof document.updatedAt === "number" ? document.updatedAt : 1,
        },
      })),
      getAppearanceThemes: vi.fn().mockResolvedValue({
        path: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\appearance-themes.json",
        exists: false,
        activeThemeID: "built-in:classic",
        document: {
          version: 1,
          activeThemeID: "built-in:classic",
          userThemes: [],
        },
        builtInThemes: [
          {
            id: "built-in:classic",
            name: "经典",
            source: "built-in",
            readonly: true,
            createdAt: 0,
            updatedAt: 0,
            colorMode: "light",
            brandTheme: "terra",
            fontFamily: "default",
            codeThemePreference: "auto",
            overrides: {},
          },
          {
            id: "built-in:sage-slate",
            name: "Sage Slate",
            source: "built-in",
            readonly: true,
            createdAt: 0,
            updatedAt: 0,
            colorMode: "system",
            brandTheme: "sage",
            fontFamily: "default",
            codeThemePreference: "auto",
            overrides: {},
          },
        ],
        themes: [
          {
            id: "built-in:classic",
            name: "经典",
            source: "built-in",
            readonly: true,
            createdAt: 0,
            updatedAt: 0,
            colorMode: "light",
            brandTheme: "terra",
            fontFamily: "default",
            codeThemePreference: "auto",
            overrides: {},
          },
          {
            id: "built-in:sage-slate",
            name: "Sage Slate",
            source: "built-in",
            readonly: true,
            createdAt: 0,
            updatedAt: 0,
            colorMode: "system",
            brandTheme: "sage",
            fontFamily: "default",
            codeThemePreference: "auto",
            overrides: {},
          },
        ],
      }),
      saveAppearanceTheme: vi.fn().mockImplementation(async ({ theme }: { theme: Record<string, unknown> }) => {
        const savedTheme = {
          id: "user:test-theme",
          source: "user",
          readonly: false,
          createdAt: 1,
          updatedAt: 2,
          ...theme,
        }
        return {
          theme: savedTheme,
          snapshot: {
            path: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\appearance-themes.json",
            exists: true,
            activeThemeID: savedTheme.id,
            document: {
              version: 1,
              activeThemeID: savedTheme.id,
              userThemes: [savedTheme],
            },
            builtInThemes: [],
            themes: [savedTheme],
          },
        }
      }),
      deleteAppearanceTheme: vi.fn().mockResolvedValue({
        path: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\appearance-themes.json",
        exists: true,
        activeThemeID: "built-in:classic",
        document: {
          version: 1,
          activeThemeID: "built-in:classic",
          userThemes: [],
        },
        builtInThemes: [],
        themes: [],
      }),
      setActiveAppearanceTheme: vi.fn().mockImplementation(async ({ themeID }: { themeID: string }) => ({
        path: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\appearance-themes.json",
        exists: true,
        activeThemeID: themeID,
        document: {
          version: 1,
          activeThemeID: themeID,
          userThemes: [],
        },
        builtInThemes: [],
        themes: [],
      })),
      duplicateAppearanceTheme: vi.fn().mockImplementation(async ({ themeID, name }: { themeID: string; name?: string }) => {
        const theme = {
          id: "user:copy-theme",
          name: name ?? "Copy",
          source: "user",
          readonly: false,
          createdAt: 1,
          updatedAt: 2,
          colorMode: themeID === "built-in:sage-slate" ? "system" : "light",
          brandTheme: themeID === "built-in:sage-slate" ? "sage" : "terra",
          fontFamily: "default",
          codeThemePreference: "auto",
          overrides: {},
        }
        return {
          theme,
          snapshot: {
            path: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\appearance-themes.json",
            exists: true,
            activeThemeID: "built-in:classic",
            document: {
              version: 1,
              activeThemeID: "built-in:classic",
              userThemes: [theme],
            },
            builtInThemes: [],
            themes: [theme],
          },
        }
      }),
      renameAppearanceTheme: vi.fn().mockImplementation(async ({ themeID, name }: { themeID: string; name: string }) => {
        const theme = {
          id: themeID,
          name,
          source: "user",
          readonly: false,
          createdAt: 1,
          updatedAt: 2,
          colorMode: "light",
          brandTheme: "terra",
          fontFamily: "default",
          codeThemePreference: "auto",
          overrides: {},
        }
        return {
          theme,
          snapshot: {
            path: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\appearance-themes.json",
            exists: true,
            activeThemeID: "built-in:classic",
            document: {
              version: 1,
              activeThemeID: "built-in:classic",
              userThemes: [theme],
            },
            builtInThemes: [],
            themes: [theme],
          },
        }
      }),
      getAgentConfig: vi.fn().mockResolvedValue({
        baseURL: "http://127.0.0.1:4096",
        defaultDirectory: "C:\\Projects\\anybox",
      }),
      getToolPermissionMode: vi.fn().mockResolvedValue({
        mode: "default",
      }),
      updateToolPermissionMode: vi.fn().mockResolvedValue({
        mode: "full_access",
      }),
      getAgentHealth: vi.fn().mockResolvedValue({
        ok: false,
        baseURL: "http://127.0.0.1:4096",
      }),
      createPtySession: vi.fn().mockResolvedValue({
        id: "pty-1",
        sessionID: "session-chat-1",
        title: "Terminal 1",
        cwd: "C:\\Projects\\anybox",
        shell: "powershell.exe",
        rows: 24,
        cols: 80,
        status: "running",
        exitCode: null,
        createdAt: 1,
        updatedAt: 1,
        cursor: 0,
      }),
      getPtySession: vi.fn().mockResolvedValue({
        id: "pty-1",
        sessionID: "session-chat-1",
        title: "Terminal 1",
        cwd: "C:\\Projects\\anybox",
        shell: "powershell.exe",
        rows: 24,
        cols: 80,
        status: "running",
        exitCode: null,
        createdAt: 1,
        updatedAt: 1,
        cursor: 0,
      }),
      updatePtySession: vi.fn().mockResolvedValue(undefined),
      deletePtySession: vi.fn().mockResolvedValue(undefined),
      attachPtySession: vi.fn().mockResolvedValue({
        id: "pty-1",
        sessionID: "session-chat-1",
        title: "Terminal 1",
        cwd: "C:\\Projects\\anybox",
        shell: "powershell.exe",
        rows: 24,
        cols: 80,
        status: "running",
        exitCode: null,
        createdAt: 1,
        updatedAt: 1,
        cursor: 0,
      }),
      detachPtySession: vi.fn().mockResolvedValue(true),
      writePtyInput: vi.fn().mockResolvedValue(undefined),
      pickProjectDirectory: vi.fn().mockResolvedValue(null),
      pickComposerAttachments: vi.fn().mockResolvedValue([]),
      capturePreviewScreenshot: vi.fn().mockResolvedValue({
        path: "C:\\Users\\codex\\preview-comment-screenshots\\marker.png",
      }),
      detectLocalPreviewServices: vi.fn().mockResolvedValue([]),
      resolvePreviewTarget: vi.fn().mockImplementation(({ value, workspaceRoot }: { value: string; workspaceRoot?: string | null }) => {
        if (value.toLowerCase().startsWith("agent://artifact/")) {
          const artifactID = value.replace(/^agent:\/\/artifact\//i, "")
          const artifactPath = `${workspaceRoot ?? "C:\\Projects\\Project 2"}\\artifacts\\${artifactID}\\artifact.md`
          return Promise.resolve({
            artifactID,
            artifactType: "markdown",
            entry: artifactPath,
            externalOpenTarget: {
              kind: "path",
              value: artifactPath,
            },
            input: value,
            kind: "artifact",
            mime: "text/markdown; charset=utf-8",
            normalizedInput: `agent://artifact/${artifactID}`,
            path: artifactPath,
            renderer: "markdown-preview",
            textReadable: true,
            title: artifactID,
            workspaceRoot: workspaceRoot ?? undefined,
          })
        }

        const normalizedUrl = value.match(/^https?:\/\//i)
          ? new URL(value).toString()
          : /^[\w.-]+(?::\d+)?(?:\/.*)?$/i.test(value)
            ? new URL(`http://${value}`).toString()
            : null
        if (!normalizedUrl) {
          return Promise.resolve({
            entry: value,
            externalOpenTarget: {
              kind: "path",
              value,
            },
            input: value,
            kind: "file",
            mime: "text/plain; charset=utf-8",
            normalizedInput: value,
            path: value,
            renderer: "code-viewer",
            textReadable: true,
            title: value.split(/[\\/]/).pop() || value,
            workspaceRoot: workspaceRoot ?? undefined,
          })
        }
        return Promise.resolve({
          externalOpenTarget: {
            kind: "url",
            value: normalizedUrl,
          },
          input: value,
          kind: "url",
          mime: "text/html",
          normalizedInput: normalizedUrl,
          renderer: "url-webview",
          safePreviewUrl: normalizedUrl,
          textReadable: false,
          title: new URL(normalizedUrl).host,
          workspaceRoot: workspaceRoot ?? undefined,
        })
      }),
      readPreviewText: vi.fn().mockResolvedValue({
        content: "",
        path: "C:\\Projects\\Project 2\\app\\README.md",
      }),
      gitGetCapabilities: vi.fn().mockResolvedValue({
        directory: "C:\\Projects\\Project 2",
        root: "C:\\Projects\\Project 2",
        branch: "main",
        defaultBranch: "main",
        isGitRepo: true,
        canCommit: {
          enabled: true,
        },
        canStageAllCommit: {
          enabled: true,
        },
        canPush: {
          enabled: true,
        },
        canCreatePullRequest: {
          enabled: false,
          reason: "Switch to a feature branch before creating a pull request.",
        },
        canCreateBranch: {
          enabled: true,
        },
      }),
      gitCommit: vi.fn().mockResolvedValue({
        directory: "C:\\Projects\\Project 2",
        root: "C:\\Projects\\Project 2",
        branch: "main",
        stdout: "",
        stderr: "",
        summary: "已提交到 main",
      }),
      gitGenerateCommitMessage: vi.fn().mockResolvedValue({
        message: "chore: update project",
      }),
      gitPush: vi.fn().mockResolvedValue({
        directory: "C:\\Projects\\Project 2",
        root: "C:\\Projects\\Project 2",
        branch: "main",
        stdout: "",
        stderr: "",
        summary: "已推送 main",
      }),
      listFolderWorkspaces: undefined as unknown as NonNullable<Window["desktop"]>["listFolderWorkspaces"],
      openFolderWorkspace: vi.fn(),
      createFolderSession: vi.fn(),
      deleteProjectWorkspace: vi.fn(),
      deleteAgentSession: vi.fn(),
      archiveAgentSession: vi.fn().mockResolvedValue({
        sessionID: "session-chat-1",
        projectID: "project-2",
        directory: "C:\\Projects\\Project 2",
        archivedAt: 1,
      }),
      listArchivedSessions: vi.fn().mockResolvedValue([]),
      restoreArchivedSession: vi.fn().mockResolvedValue({
        session: {
          id: "session-archived-1",
          projectID: "project-2",
          directory: "C:\\Projects\\Project 2",
          title: "Archived session",
          created: 1,
          updated: 1,
        },
      }),
      deleteArchivedSession: vi.fn().mockResolvedValue({
        sessionID: "session-archived-1",
      }),
      getSessionDiff: vi.fn().mockResolvedValue({
        diffs: [],
      }),
      restoreWorkspaceDiffFile: vi.fn().mockResolvedValue({
        directory: "C:\\Projects\\Project 2",
        file: "src/App.tsx",
      }),
      reverseApplyWorkspaceDiffPatches: vi.fn().mockResolvedValue({
        directory: "C:\\Projects\\Project 2",
        restored: [],
        failed: [],
      }),
      getSessionRuntimeDebug: vi.fn().mockResolvedValue(createSessionRuntimeDebugSnapshot()),
      getGlobalSkills: vi.fn().mockResolvedValue([]),
      getProjectSkills: vi.fn().mockResolvedValue([]),
      getProjectSkillSelection: vi.fn().mockResolvedValue({
        skillIDs: [],
      }),
      getProjectPlugins: vi.fn().mockResolvedValue([]),
      getProjectPluginSelection: vi.fn().mockResolvedValue({
        pluginIDs: [],
      }),
      getGlobalSkillsTree: vi.fn().mockResolvedValue({
        root: "C:\\Users\\19128\\.anybox\\skills",
        items: [],
      }),
      readGlobalSkillFile: vi.fn(),
      searchWorkspaceFiles: vi.fn().mockResolvedValue([]),
      listWorkspaceDirectory: vi.fn().mockImplementation(async ({ path }: { path?: string }) => (
        createWorkspaceDirectoryFixture(path)
      )),
      readWorkspaceFile: vi.fn().mockResolvedValue({
        path: WORKSPACE_FILE_PATH,
        name: "focus-files.tsx",
        extension: "tsx",
        kind: "text",
        content: WORKSPACE_FILE_CONTENT,
      }),
      updateGlobalSkillFile: vi.fn(),
      createGlobalSkill: vi.fn(),
      previewGlobalSkillGitInstall: vi.fn(),
      installGlobalSkillsFromGit: vi.fn(),
      installGlobalSkillFromLocalFile: vi.fn(),
      renameGlobalSkill: vi.fn(),
      deleteGlobalSkill: vi.fn(),
      createGlobalSkillFolder: vi.fn(),
      renameGlobalSkillFolder: vi.fn(),
      deleteGlobalSkillFolder: vi.fn(),
      moveGlobalSkillDirectory: vi.fn(),
      getGlobalProviderCatalog: vi.fn().mockResolvedValue([]),
      refreshGlobalProviderCatalog: vi.fn().mockResolvedValue([]),
      testGlobalProviderConnection: vi.fn().mockResolvedValue({
        providerID: "deepseek",
        ok: true,
        status: "working",
        checkedAt: 1,
        message: "连接测试成功。",
      }),
      getGlobalModels: vi.fn().mockResolvedValue({
        items: [],
        selection: {},
      }),
      getBuiltinTools: vi.fn().mockResolvedValue({
        items: [],
        selection: { tools: {} },
      }),
      updateBuiltinToolSelection: vi.fn().mockImplementation((selection) => Promise.resolve(selection)),
      getPluginCatalog: vi.fn().mockResolvedValue([]),
      getConnectorCatalog: vi.fn().mockResolvedValue([]),
      getConnectors: vi.fn().mockResolvedValue([]),
      getConnector: vi.fn(),
      saveConnectorApiKey: vi.fn(),
      deleteConnectorApiKey: vi.fn(),
      saveConnectorConfig: vi.fn(),
      deleteConnectorConfig: vi.fn(),
      startConnectorAuthFlow: vi.fn(),
      getConnectorAuthFlow: vi.fn(),
      cancelConnectorAuthFlow: vi.fn(),
      deleteConnectorAuthSession: vi.fn(),
      getConnectorDiagnostic: vi.fn().mockResolvedValue({
        serverID: "connector.mock.default",
        enabled: true,
        ok: true,
        toolCount: 0,
        toolNames: [],
      }),
      getGlobalMcpServers: vi.fn().mockResolvedValue([]),
      getGlobalMcpServerDiagnostic: vi.fn().mockResolvedValue({
        serverID: "mock",
        enabled: true,
        ok: true,
        toolCount: 0,
        toolNames: [],
      }),
      getPromptPresets: vi.fn().mockResolvedValue(PROMPT_PRESET_FIXTURES),
      getPromptPresetSelection: vi.fn().mockResolvedValue(PROMPT_PRESET_SELECTION_FIXTURE),
      readPromptPreset: vi.fn().mockImplementation(({ presetID }: { presetID: string }) =>
        Promise.resolve(createPromptPresetDocument(presetID)),
      ),
      createPromptPreset: vi.fn().mockResolvedValue(
        createPromptPresetDocument("custom-untitled-preset", {
          label: "Untitled preset",
          source: "custom",
        }),
      ),
      translatePromptPreset: vi.fn().mockResolvedValue(
        createPromptPresetDocument("custom-translated-system-prompt", {
          label: "System prompt - 简体中文",
          source: "custom",
          content: "translated prompt",
        }),
      ),
      previewPromptUrlInstall: vi.fn(),
      installPromptsFromUrl: vi.fn(),
      updatePromptPreset: vi.fn().mockImplementation(
        ({ presetID, label, content }: { presetID: string; label?: string; content: string }) =>
          Promise.resolve(createPromptPresetDocument(presetID, {
            label: label ?? createPromptPresetSummary(presetID).label,
            content,
            hasOverride: presetID.startsWith("custom-") ? false : true,
            source: presetID.startsWith("custom-") ? "custom" : "bundled",
          })),
      ),
      updatePromptPresetSelection: vi.fn().mockImplementation(
        (input: typeof PROMPT_PRESET_SELECTION_FIXTURE) => Promise.resolve(input),
      ),
      resetPromptPreset: vi.fn().mockImplementation(({ presetID }: { presetID: string }) =>
        Promise.resolve(createPromptPresetDocument(presetID, {
          hasOverride: false,
        })),
      ),
      deletePromptPreset: vi.fn().mockResolvedValue(PROMPT_PRESET_SELECTION_FIXTURE),
      getProjectProviderCatalog: vi.fn().mockResolvedValue([]),
      refreshProjectProviderCatalog: vi.fn().mockResolvedValue([]),
      getProjectModels: vi.fn().mockResolvedValue({
        items: [],
        selection: {},
      }),
      getProjectMcpSelection: vi.fn().mockResolvedValue({
        serverIDs: [],
      }),
      updateGlobalProvider: vi.fn().mockResolvedValue({
        provider: {
          id: "deepseek",
          name: "DeepSeek",
          available: true,
          apiKeyConfigured: true,
        },
        selection: {},
      }),
      deleteGlobalProvider: vi.fn().mockResolvedValue({
        providerID: "deepseek",
        selection: {},
      }),
      updateGlobalModelSelection: vi.fn().mockResolvedValue({
        model: "deepseek/deepseek-reasoner",
      }),
      updateGlobalMcpServer: vi.fn().mockResolvedValue({
        id: "filesystem",
        transport: "stdio",
        command: "npx",
        enabled: true,
      }),
      deleteGlobalMcpServer: vi.fn().mockResolvedValue({
        serverID: "filesystem",
        removed: true,
      }),
      updateProjectModelSelection: vi.fn().mockResolvedValue({}),
      updateProjectSkillSelection: vi.fn().mockResolvedValue({
        skillIDs: [],
      }),
      updateProjectPluginSelection: vi.fn().mockResolvedValue({
        pluginIDs: [],
      }),
      updateProjectMcpSelection: vi.fn().mockResolvedValue({
        serverIDs: [],
      }),
      createAgentSession: vi.fn().mockResolvedValue({
        session: {
          id: "session-backend",
          projectID: "project-backend",
          directory: "C:\\Projects\\anybox",
          title: "Backend session",
          created: 1,
          updated: 1,
        },
      }),
      agentSession: {
        loadHistory: vi.fn().mockResolvedValue([]),
        sendTurn: vi.fn().mockImplementation(async (input: { clientTurnID: string }) => ({
          clientTurnID: input.clientTurnID,
        })),
        resumeTurn: vi.fn().mockImplementation(async (input: { clientTurnID: string }) => ({
          clientTurnID: input.clientTurnID,
        })),
        cancelTurn: vi.fn().mockImplementation(async (input: { backendSessionID: string; clientTurnID: string }) => ({
          ...input,
          localRequestAborted: false,
          backendCancelled: false,
        })),
        interrupt: vi.fn().mockImplementation(async (input: { backendSessionID: string; clientTurnID?: string }) => ({
          ...input,
          localRequestsAborted: 0,
          backendCancelled: false,
        })),
        answerQuestion: vi.fn().mockImplementation(async (input: {
          backendSessionID: string
          questionID: string
          selectedOptions?: string[]
          freeformText?: string
        }) => ({
          sessionID: input.backendSessionID,
          questionID: input.questionID,
          selectedOptions: input.selectedOptions,
          freeformText: input.freeformText,
          answerText: input.freeformText ?? input.selectedOptions?.join(", ") ?? "",
          answeredAt: Date.now(),
        })),
        subscribe: vi.fn().mockResolvedValue({
          backendSessionID: "session-default",
        }),
        unsubscribe: vi.fn().mockResolvedValue({
          backendSessionID: "session-default",
          removed: true,
        }),
        loadPermissionRequests: vi.fn().mockResolvedValue([]),
        respondPermissionRequest: vi.fn().mockResolvedValue(createPermissionResolveResult()),
        onEvent: vi.fn((listener: DesktopAgentSessionEventListener) => {
          agentSessionEventListeners.push(listener)
          return vi.fn(() => {
            agentSessionEventListeners = agentSessionEventListeners.filter((item) => item !== listener)
          })
        }),
      },
      showMenu: vi.fn().mockResolvedValue(undefined),
      showExternalEditorMenu: vi.fn().mockResolvedValue(undefined),
      listExternalEditorsForTarget: vi.fn().mockResolvedValue([
        {
          id: "vscode",
          label: "VS Code",
          executablePath: "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd",
          iconDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8l7kQAAAAASUVORK5CYII=",
        },
        {
          id: "explorer",
          label: "File Explorer",
          executablePath: "C:\\Windows\\explorer.exe",
          iconDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8l7kQAAAAASUVORK5CYII=",
        },
      ]),
      openInExternalEditor: vi.fn().mockResolvedValue({
        ok: true,
        editor: {
          id: "vscode",
          label: "VS Code",
          executablePath: "C:\\Users\\demo\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd",
        },
        targetPath: "C:\\Projects\\Project 2\\app",
      }),
      openPath: vi.fn().mockResolvedValue({
        ok: true,
        targetPath: "C:\\Projects\\Project 2\\app",
      }),
      openExternalUrl: vi.fn().mockResolvedValue({
        ok: true,
        url: "http://localhost:3000/",
      }),
      windowAction: vi.fn().mockResolvedValue(undefined),
      onAppUpdateStateChange: vi.fn(() => vi.fn()),
      onMobileBridgeEvent: vi.fn(() => vi.fn()),
      onPtyEvent: vi.fn(() => vi.fn()),
      onWindowStateChange: vi.fn(() => vi.fn()),
    }
    const desktop = window.desktop!
    desktop.gitCommit = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Project 2",
      root: "C:\\Projects\\Project 2",
      branch: "main",
      stdout: "",
      stderr: "",
      summary: "Committed to main.",
    })
    desktop.gitPush = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Project 2",
      root: "C:\\Projects\\Project 2",
      branch: "main",
      stdout: "",
      stderr: "",
      summary: "Pushed main.",
    })
    desktop.gitCreateBranch = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Project 2",
      root: "C:\\Projects\\Project 2",
      branch: "feature/test",
      stdout: "",
      stderr: "",
      summary: "Created and switched to feature/test.",
    })
    desktop.gitListBranches = vi.fn().mockResolvedValue([
      {
        name: "main",
        kind: "local",
        current: true,
      },
      {
        name: "feature/test",
        kind: "local",
        current: false,
      },
    ])
    desktop.gitCheckoutBranch = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Project 2",
      root: "C:\\Projects\\Project 2",
      branch: "feature/test",
      stdout: "",
      stderr: "",
      summary: "Switched to feature/test.",
    })
    desktop.gitCreatePullRequest = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Project 2",
      root: "C:\\Projects\\Project 2",
      branch: "feature/test",
      stdout: "https://github.com/example/repo/pull/1",
      stderr: "",
      summary: "Created pull request https://github.com/example/repo/pull/1.",
      url: "https://github.com/example/repo/pull/1",
    })
  })

  it("renders the appearance monitor route without loading workbench context", async () => {
    window.history.pushState({}, "", "/?appWindow=appearance")
    const getWorkbenchWindowContext = vi.fn().mockResolvedValue(null)
    window.desktop!.getWorkbenchWindowContext = getWorkbenchWindowContext

    try {
      const { container } = render(<App />)

      expect(await screen.findByText("Theme Monitor")).toBeInTheDocument()
      expect(container.querySelector(".appearance-window-shell")).toBeInTheDocument()
      const monitorShell = container.querySelector(".appearance-window-app-shell")
      expect(monitorShell).toBeInTheDocument()
      expect(monitorShell).not.toHaveClass("app-shell")
      expect(screen.getByRole("region", { name: "Theme Monitor" })).toBeInTheDocument()
      expect(await screen.findByText("Theme Config File")).toBeInTheDocument()
      expect(getWorkbenchWindowContext).not.toHaveBeenCalled()
      expect(window.desktop!.getAgentConfig).not.toHaveBeenCalled()
      expect(window.desktop!.getAgentHealth).not.toHaveBeenCalled()
    } finally {
      window.history.replaceState({}, "", "/")
    }
  })

  it("renders the desktop shell with window controls in the right sidebar menu", async () => {
    const { container } = render(<App />)
    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    const topMenu = screen.getByLabelText("Session canvas top menu")
    const leftSidebarTopMenu = screen.getByLabelText("Left sidebar top menu")
    const rightSidebarTopMenu = screen.getByLabelText("Right sidebar top menu")

    const minimizeWindowButton = screen.getByRole("button", { name: "Minimize window" })
    expect(minimizeWindowButton).toBeInTheDocument()
    expect(minimizeWindowButton.closest(".window-controls")).not.toBeNull()
    expect(minimizeWindowButton.closest(".right-sidebar-top-menu")).toBe(rightSidebarTopMenu)
    expect(container.querySelector(".dockview-theme-anybox .dv-tabs-and-actions-container")).not.toBeNull()
    expect(container.querySelector(".session-canvas-top-menu.window-drag-region")).not.toBeNull()
    expect(leftSidebarTopMenu).toHaveClass("shell-top-menu")
    expect(topMenu).toHaveClass("shell-top-menu")
    expect(rightSidebarTopMenu).toHaveClass("shell-top-menu")
    expect(screen.queryByRole("button", { name: "File" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Collapse left sidebar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Collapse right sidebar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Collapse right sidebar" }).closest(".dv-tabs-and-actions-container")).not.toBeNull()
    expect(screen.getByRole("button", { name: "Collapse right sidebar" }).closest(".dockview-workbench-header-trailing")).not.toBeNull()
    expect(screen.getByRole("button", { name: "Open folder" })).toBeInTheDocument()
    expect(getAddSessionTabButton()).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "app" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "\u79FB\u9664 app" })).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByRole("button", { name: "app" }), {
      clientX: 120,
      clientY: 160,
    })
    expect(screen.getByRole("menuitem", { name: "\u79FB\u9664" })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.getByRole("button", { name: "Create session for app" })).toBeInTheDocument()
    expect(screen.getAllByText("C:\\Projects\\Project 2").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "Chat 1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Switch to session Chat 1" })).toBeInTheDocument()
    const addSessionTabButton = screen.getByRole("button", { name: "Add session tab" })
    expect(addSessionTabButton.closest(".dockview-workbench-header-actions")).not.toBeNull()
    expect(addSessionTabButton.closest(".dockview-workbench-header-trailing")).not.toBeNull()
    expect(screen.queryByRole("button", { name: "Split pane" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Switch to session Chat 1" }).closest(".dv-tabs-and-actions-container")).not.toBeNull()
    expect(await screen.findByRole("button", { name: "Git" })).toBeInTheDocument()
    expect(within(leftSidebarTopMenu).getByRole("button", { name: "Open folder" })).toBeInTheDocument()
    expect(within(leftSidebarTopMenu).queryByRole("button", { name: "Sort sessions" })).not.toBeInTheDocument()
    expect(within(leftSidebarTopMenu).queryByRole("button", { name: "Create session" })).not.toBeInTheDocument()
    expect(within(leftSidebarTopMenu).queryByRole("group", { name: "Workspace mode" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Code" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Chat" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Overview" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Artifacts" })).not.toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: /^Review/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Runtime" })).not.toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: /^Browser/ })).toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: /^Files/ })).toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: /^Terminal/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Changes" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Preview" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Console" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Deploy" })).not.toBeInTheDocument()
    expect(inspector).toBeInTheDocument()
    expect(within(topMenu).getByRole("group", { name: "Open current project" })).toBeInTheDocument()
    expect(within(inspector).queryByText("Workspace diff")).not.toBeInTheDocument()
    expect(within(inspector).queryByText("No changes in this session.")).not.toBeInTheDocument()
    expect(inspector.querySelector(".right-sidebar-view-host")).toHaveClass("is-launcher")
    expect(window.desktop?.getSessionRuntimeDebug).not.toHaveBeenCalled()
    expect(within(inspector).queryByText("Active Session")).not.toBeInTheDocument()
    expect(within(inspector).queryByText("Workspace")).not.toBeInTheDocument()
    expect(within(inspector).queryByText("Current execution state")).not.toBeInTheDocument()
    await waitFor(() => {
      expect(container.querySelector(".canvas-header")).not.toBeInTheDocument()
      expect(container.querySelector(".signal-row")).not.toBeInTheDocument()
    })
    expect(screen.getByRole("textbox", { name: "Task draft" }).closest("footer")).toHaveClass("prompt-input-shell")
    expect(screen.getByRole("button", { name: "Add attachments" })).not.toBeDisabled()
    expect(screen.getByRole("button", { name: "Add attachments" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("button", { name: /^Select model:/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Agent mode:/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Clear draft" })).not.toBeInTheDocument()
  })

  it("opens the paired conversation and continues the composer from an inspected branch node", async () => {
    const branchHistory = [
      {
        info: {
          id: "branch-user-1",
          sessionID: "session-chat-1",
          role: "user",
          created: 100,
          parentMessageID: null,
        },
        parts: [{ id: "branch-user-part-1", type: "text", text: "Inspect this prompt" }],
      },
      {
        info: {
          id: "branch-assistant-1",
          sessionID: "session-chat-1",
          role: "assistant",
          created: 101,
          parentMessageID: "branch-user-1",
        },
        parts: [{ id: "branch-assistant-part-1", type: "text", text: "Inspect this complete answer" }],
      },
    ]
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Project 2\\app",
        directory: "C:\\Projects\\Project 2\\app",
        name: "app",
        created: 1,
        updated: 2,
        project: {
          id: "project-2",
          name: "Project 2",
          worktree: "C:\\Projects\\Project 2",
        },
        sessions: [
          {
            id: "session-chat-1",
            projectID: "project-2",
            directory: "C:\\Projects\\Project 2\\app",
            title: "Chat 1",
            created: 1,
            updated: 2,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.subscribe = vi.fn().mockResolvedValue({
      backendSessionID: "session-chat-1",
    })
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue(branchHistory)
    window.desktop!.updateSessionActiveMessage = vi.fn()

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-chat-1",
        view: "all",
      })
    })
    const viewTabs = await screen.findByRole("tablist", { name: "Session view" })
    fireEvent.click(within(viewTabs).getByRole("tab", { name: "Branches" }))
    const branchView = await screen.findByRole("region", { name: "Session branch map" })
    const assistantNode = await within(branchView).findByRole("treeitem", { name: /Inspect this complete answer/ })

    fireEvent.click(screen.getByRole("button", { name: "Collapse right sidebar" }))
    expect(screen.queryByRole("complementary", { name: "Inspector sidebar" })).not.toBeInTheDocument()

    fireEvent.click(assistantNode)

    const inspector = await screen.findByRole("complementary", { name: "Inspector sidebar" })
    expect(within(inspector).getByRole("tab", { name: "Conversation" })).toHaveAttribute("aria-selected", "true")
    expect(within(inspector).getByText("Inspect this prompt")).toBeInTheDocument()
    expect(within(inspector).getAllByText("Inspect this complete answer")).not.toHaveLength(0)
    expect(assistantNode).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("Continuing from")).toBeInTheDocument()
    expect(window.desktop!.updateSessionActiveMessage).not.toHaveBeenCalled()

    setComposerDraftValue(
      screen.getByRole("textbox", { name: "Task draft" }),
      "Continue from the selected answer",
    )
    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          backendSessionID: "session-chat-1",
          parentMessageID: "branch-assistant-1",
          text: "Continue from the selected answer",
        }),
      )
      expect(screen.queryByText("Continuing from")).not.toBeInTheDocument()
    })
  })

  it("renders a native macOS window controls slot instead of custom window buttons", () => {
    window.desktop = {
      ...window.desktop!,
      platform: "darwin",
      getInfo: vi.fn().mockResolvedValue({
        platform: "darwin",
        node: "22.0.0",
        chrome: "130.0.0",
        electron: "39.0.0",
      }),
    }

    const { container } = render(<App />)

    expect(container.firstChild).toHaveClass("window-shell", "is-macos")
    expect(container.firstChild).not.toHaveClass("is-windows")
    expect(container.querySelector(".mac-titlebar")).not.toBeInTheDocument()
    expect(container.querySelector(".window-controls.is-native-macos")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Minimize window" })).not.toBeInTheDocument()
  })

  it("does not publish workbench snapshots for streaming response updates", async () => {
    let streamListener: DesktopAgentSessionEventListener | undefined
    const publishWorkbenchSnapshot = vi.fn().mockImplementation(async (input) => input)

    window.desktop!.publishWorkbenchSnapshot = publishWorkbenchSnapshot
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      streamListener = listener
      return vi.fn()
    })
    window.desktop!.agentSession!.sendTurn = vi.fn().mockImplementation(
      async (input: {
        clientTurnID: string
        backendSessionID: string
      }) => {
        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "started",
          data: { sessionID: input.backendSessionID },
        }))
        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "delta",
          data: { kind: "text", delta: "Snapshot stream update." },
        }))

        return {
          clientTurnID: input.clientTurnID,
        }
      },
    )

    render(<App />)

    await screen.findByRole("button", { name: "Switch to session Chat 1" })
    await waitFor(() => {
      expect(window.desktop!.getAgentHealth).toHaveBeenCalledTimes(1)
      expect(window.desktop!.agentSession!.onEvent).toHaveBeenCalledTimes(1)
      expect(publishWorkbenchSnapshot).toHaveBeenCalled()
    })
    await waitFor(() => {
      const latestSnapshot = publishWorkbenchSnapshot.mock.calls.at(-1)?.[0]
      expect(latestSnapshot.surfaces[0]?.layout?.panels?.["session:session-chat-1"]).toBeTruthy()
    })

    const initialSnapshot = publishWorkbenchSnapshot.mock.calls.at(-1)?.[0]
    expect(initialSnapshot.panels["session:session-chat-1"]).toEqual({
      panelID: "session:session-chat-1",
      reference: {
        kind: "session",
        sessionID: "session-chat-1",
      },
      title: "Chat 1",
    })
    expect(initialSnapshot.panels["session:session-chat-1"]).not.toHaveProperty("pane")
    expect(initialSnapshot.panels["session:session-chat-1"]).not.toHaveProperty("workspaces")

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    publishWorkbenchSnapshot.mockClear()

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Stream without republishing")
    await act(async () => {
      fireEvent.click(getComposerSendButton())
      await Promise.resolve()
    })

    expect(await screen.findByText("Snapshot stream update.")).toBeInTheDocument()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(publishWorkbenchSnapshot).not.toHaveBeenCalled()
  })

  it("reverts the global tool permission mode and shows the save error when saving fails", async () => {
    window.desktop!.updateToolPermissionMode = vi.fn().mockRejectedValue(new Error("Could not save mode"))

    render(<App />)

    const trigger = await screen.findByRole("button", { name: "工具权限：默认权限" })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("menuitemradio", { name: /完全访问权限/ }))

    await waitFor(() => {
      expect(window.desktop!.updateToolPermissionMode).toHaveBeenCalledWith({
        mode: "full_access",
      })
    })
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "工具权限：默认权限" })).toHaveAttribute(
        "title",
        expect.stringContaining("Could not save mode"),
      )
    })
  })

  it("renders the workspace shell without Chat and Code mode switching", async () => {
    render(<App />)

    const leftSidebarTopMenu = screen.getByLabelText("Left sidebar top menu")

    expect(within(leftSidebarTopMenu).getByRole("button", { name: "Open folder" })).toBeInTheDocument()
    expect(within(leftSidebarTopMenu).queryByRole("button", { name: "Sort sessions" })).not.toBeInTheDocument()
    expect(within(leftSidebarTopMenu).queryByRole("button", { name: "Create session" })).not.toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "Workspace mode" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Chat" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Code" })).not.toBeInTheDocument()
    expect(screen.getByLabelText("Session canvas top menu")).toBeInTheDocument()
    expect(screen.getByRole("complementary", { name: "Inspector sidebar" })).toBeInTheDocument()
    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    expect(within(inspector).getByRole("button", { name: /^Review/ })).toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: /^Terminal/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "app" })).toBeInTheDocument()
  })

  it("does not expose the removed runtime inspector even when runtime debug is enabled", async () => {
    window.localStorage.setItem("desktop.agentDebugTrace", "true")
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "workspace-runtime",
        directory: "C:\\Projects\\Project 2\\app",
        name: "app",
        created: 1,
        updated: 1,
        project: {
          id: "project-2",
          name: "Project 2",
          worktree: "C:\\Projects\\Project 2",
        },
        sessions: [
          {
            id: "session-chat-1",
            projectID: "project-2",
            directory: "C:\\Projects\\Project 2\\app",
            title: "Chat 1",
            created: 1,
            updated: 1,
          },
        ],
      },
    ])
    render(<App />)
    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })

    expect(await within(inspector).findByRole("button", { name: /^Review/ })).toBeInTheDocument()
    expect(within(inspector).queryByRole("button", { name: "Runtime" })).not.toBeInTheDocument()
    expect(within(inspector).queryByText("Agent Runtime")).not.toBeInTheDocument()
    expect(within(inspector).queryByText("Current execution state")).not.toBeInTheDocument()
  })

  it("copies the response content from the response action row", async () => {
    render(<App />)

    const responseText =
      "I am collapsing the information-heavy workspace cards into a project tree so the rail behaves like navigation, not like a second content surface."
    const responseRow = (await screen.findByText(responseText)).closest('[data-thread-row-kind="assistant-response-row"]') as HTMLElement | null
    const threadMessageID = responseRow?.dataset.threadMessageId
    const actionRow = threadMessageID
      ? document.querySelector(`.assistant-actions-row[data-thread-message-id="${threadMessageID}"]`) as HTMLElement | null
      : null

    expect(responseRow).not.toBeNull()
    expect(actionRow).not.toBeNull()

    fireEvent.click(within(actionRow as HTMLElement).getByRole("button", { name: "Copy assistant response" }))

    await waitFor(() => {
      expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(responseText)
    })

    expect(await screen.findByRole("button", { name: "Copied assistant response" })).toBeInTheDocument()
  })

  it("opens a local URL in the unified preview sidebar", async () => {
    render(<App />)

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    fireEvent.click(within(inspector).getByRole("button", { name: /^Browser/ }))

    const previewTargetInput = within(inspector).getByRole("textbox", { name: "Preview target" })
    fireEvent.change(previewTargetInput, {
      target: { value: "localhost:3000" },
    })
    fireEvent.submit(previewTargetInput.closest("form")!)

    expect(await within(inspector).findByTitle("Preview of localhost:3000")).toBeInTheDocument()
    expect(within(inspector).getByDisplayValue("http://localhost:3000/")).toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: "Comment" })).toBeInTheDocument()

    fireEvent.click(within(inspector).getByRole("button", { name: "Open externally" }))
    await waitFor(() => {
      expect(window.desktop!.openExternalUrl).toHaveBeenCalledWith({
        url: "http://localhost:3000/",
      })
    })
  })

  it("opens artifact links from assistant messages in the preview sidebar", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-assistant-artifact-1",
          sessionID: "session-frontend-review",
          role: "assistant",
          created: 2,
          completed: 3,
        },
        parts: [
          {
            id: "artifact-text",
            type: "text",
            text: "Open [Artifact](agent://artifact/report-1).",
          },
        ],
      },
    ])
    window.desktop!.resolvePreviewTarget = vi.fn().mockResolvedValue({
      artifactID: "report-1",
      artifactType: "markdown",
      entry: `${FRONTEND_WORKSPACE_DIRECTORY}\\artifacts\\report-1\\report.md`,
      externalOpenTarget: {
        kind: "path",
        value: `${FRONTEND_WORKSPACE_DIRECTORY}\\artifacts\\report-1\\report.md`,
      },
      input: "agent://artifact/report-1",
      kind: "artifact",
      mime: "text/markdown; charset=utf-8",
      normalizedInput: "agent://artifact/report-1",
      path: `${FRONTEND_WORKSPACE_DIRECTORY}\\artifacts\\report-1\\report.md`,
      renderer: "markdown-preview",
      textReadable: true,
      title: "Report",
      workspaceRoot: FRONTEND_WORKSPACE_DIRECTORY,
    })
    window.desktop!.readPreviewText = vi.fn().mockResolvedValue({
      content: "# Report\n\nArtifact body.",
      path: `${FRONTEND_WORKSPACE_DIRECTORY}\\artifacts\\report-1\\report.md`,
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-frontend-review",
      })
    })
    const artifactLink = await screen.findByRole("link", { name: "Artifact" })
    fireEvent.click(artifactLink)

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    await waitFor(() => {
      expect(window.desktop!.resolvePreviewTarget).toHaveBeenCalledWith({
        value: "agent://artifact/report-1",
        workspaceRoot: FRONTEND_WORKSPACE_DIRECTORY,
      })
    })
    expect(await within(inspector).findByRole("heading", { name: "Report" })).toBeInTheDocument()
    expect(within(inspector).getByText("Artifact body.")).toBeInTheDocument()
  })

  it("opens web links in the Anybox browser by default and offers the system browser from the context menu", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-assistant-web-link-1",
          sessionID: "session-frontend-review",
          role: "assistant",
          created: 2,
          completed: 3,
        },
        parts: [
          {
            id: "web-link-text",
            type: "text",
            text: "Open [Docs](https://example.com/docs).",
          },
        ],
      },
    ])

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-frontend-review",
      })
    })
    const link = await screen.findByRole("link", { name: "Docs" })
    vi.mocked(window.desktop!.openExternalUrl!).mockClear()
    fireEvent.click(link)

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    await waitFor(() => {
      expect(window.desktop!.resolvePreviewTarget).toHaveBeenCalledWith({
        value: "https://example.com/docs",
        workspaceRoot: FRONTEND_WORKSPACE_DIRECTORY,
      })
    })
    expect(await within(inspector).findByTitle("Preview of example.com")).toBeInTheDocument()
    expect(window.desktop!.openExternalUrl).not.toHaveBeenCalled()

    fireEvent.contextMenu(link, { clientX: 120, clientY: 80 })
    fireEvent.click(screen.getByRole("menuitem", { name: "在系统浏览器中打开" }))
    await waitFor(() => {
      expect(window.desktop!.openExternalUrl).toHaveBeenCalledWith({
        url: "https://example.com/docs",
      })
    })
  })

  it("uses Electron webview for URL previews when available", async () => {
    const userAgentSpy = vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 Electron/39.0.0",
    )
    window.desktop!.previewGuestPreloadPath = "file:///C:/Projects/anybox/packages/desktop/out/preload/preview-webview.mjs"

    render(<App />)

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    fireEvent.click(within(inspector).getByRole("button", { name: /^Browser/ }))

    const previewTargetInput = within(inspector).getByRole("textbox", { name: "Preview target" })
    fireEvent.change(previewTargetInput, {
      target: { value: "localhost:3000" },
    })
    fireEvent.submit(previewTargetInput.closest("form")!)

    await waitFor(() => {
      expect(document.querySelector("webview.preview-frame")).toBeInTheDocument()
    })
    expect(within(inspector).getByRole("button", { name: "Comment" })).toBeInTheDocument()

    userAgentSpy.mockRestore()
  })

  it("browses files in the focused workspace and loads text content in the files inspector", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.readWorkspaceFile = vi.fn().mockResolvedValue({
      path: WORKSPACE_FILE_PATH,
      name: "focus-files.tsx",
      extension: "tsx",
      kind: "text",
      content: WORKSPACE_FILE_CONTENT,
    })

    render(<App />)

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    expect(await within(inspector).findByRole("button", { name: /^Files/ })).toBeInTheDocument()

    await openWorkspaceFileFromTree(inspector)

    await waitFor(() => {
      expect(window.desktop!.readWorkspaceFile).toHaveBeenCalledWith({
        directory: FRONTEND_WORKSPACE_DIRECTORY,
        path: WORKSPACE_FILE_PATH,
      })
    })
    expect(window.desktop!.listWorkspaceDirectory).toHaveBeenCalledWith({
      directory: FRONTEND_WORKSPACE_DIRECTORY,
      path: "",
    })
    expect(window.desktop!.listWorkspaceDirectory).toHaveBeenCalledWith({
      directory: FRONTEND_WORKSPACE_DIRECTORY,
      path: "src",
    })
    expect(await screen.findByText("export const focusValue = 1")).toBeInTheDocument()
    expect(screen.getByText("const nextValue = focusValue + 1")).toBeInTheDocument()
  })

  it("opens response local file links inside the files inspector when the path is in the pane workspace", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-link-1",
          sessionID: "session-frontend-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-link-1", type: "text", text: "Open the file link" }],
      },
      {
        info: {
          id: "msg-assistant-link-1",
          sessionID: "session-frontend-review",
          role: "assistant",
          created: 101,
          completed: 102,
        },
        parts: [
          {
            id: "part-assistant-link-1",
            type: "text",
            text: "[focus-files.tsx](C:/Projects/Atlas/frontend/src/focus-files.tsx:2-3)",
          },
        ],
      },
    ])
    window.desktop!.readWorkspaceFile = vi.fn().mockResolvedValue({
      path: WORKSPACE_FILE_PATH,
      name: "focus-files.tsx",
      extension: "tsx",
      kind: "text",
      content: WORKSPACE_FILE_CONTENT,
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-frontend-review",
      })
    })
    await screen.findByRole("link", { name: "focus-files.tsx" })
    fireEvent.click(screen.getByRole("link", { name: "focus-files.tsx" }))

    await waitFor(() => {
      expect(window.desktop!.readWorkspaceFile).toHaveBeenCalledWith({
        directory: FRONTEND_WORKSPACE_DIRECTORY,
        path: WORKSPACE_FILE_PATH,
      })
    })
    expect(await screen.findByText("const nextValue = focusValue + 1")).toBeInTheDocument()
    expect(screen.getByTestId("workspace-file-line-2")).toHaveClass("is-linked")
    expect(screen.getByTestId("workspace-file-line-3")).toHaveClass("is-linked")
    expect(screen.queryByRole("textbox", { name: "File comment on lines 2-3" })).not.toBeInTheDocument()
  })

  it("opens relative response local file links inside the files inspector", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-relative-link-1",
          sessionID: "session-frontend-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-relative-link-1", type: "text", text: "Open the relative file link" }],
      },
      {
        info: {
          id: "msg-assistant-relative-link-1",
          sessionID: "session-frontend-review",
          role: "assistant",
          created: 101,
          completed: 102,
        },
        parts: [
          {
            id: "part-assistant-relative-link-1",
            type: "text",
            text: "[focus-files.tsx](src/focus-files.tsx:2)",
          },
        ],
      },
    ])
    window.desktop!.readWorkspaceFile = vi.fn().mockResolvedValue({
      path: WORKSPACE_FILE_PATH,
      name: "focus-files.tsx",
      extension: "tsx",
      kind: "text",
      content: WORKSPACE_FILE_CONTENT,
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-frontend-review",
      })
    })
    fireEvent.click(await screen.findByRole("link", { name: "focus-files.tsx" }))

    await waitFor(() => {
      expect(window.desktop!.readWorkspaceFile).toHaveBeenCalledWith({
        directory: FRONTEND_WORKSPACE_DIRECTORY,
        path: WORKSPACE_FILE_PATH,
      })
    })
    expect(screen.getByTestId("workspace-file-line-2")).toHaveClass("is-linked")
    expect(window.desktop!.openPath).not.toHaveBeenCalled()
  })

  it("opens previewable response local file links without line numbers in the preview sidebar", async () => {
    const absolutePath = "C:/Projects/Atlas/frontend/src/focus-files.tsx"
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-preview-link-1",
          sessionID: "session-frontend-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-preview-link-1", type: "text", text: "Open the previewable file link" }],
      },
      {
        info: {
          id: "msg-assistant-preview-link-1",
          sessionID: "session-frontend-review",
          role: "assistant",
          created: 101,
          completed: 102,
        },
        parts: [
          {
            id: "part-assistant-preview-link-1",
            type: "text",
            text: `[focus-files.tsx](${absolutePath})`,
          },
        ],
      },
    ])
    window.desktop!.resolvePreviewTarget = vi.fn().mockResolvedValue({
      entry: `${FRONTEND_WORKSPACE_DIRECTORY}\\src\\focus-files.tsx`,
      externalOpenTarget: {
        kind: "path",
        value: `${FRONTEND_WORKSPACE_DIRECTORY}\\src\\focus-files.tsx`,
      },
      input: absolutePath,
      kind: "file",
      mime: "text/typescript; charset=utf-8",
      normalizedInput: WORKSPACE_FILE_PATH,
      path: `${FRONTEND_WORKSPACE_DIRECTORY}\\src\\focus-files.tsx`,
      renderer: "code-viewer",
      textReadable: true,
      title: "focus-files.tsx",
      workspaceRoot: FRONTEND_WORKSPACE_DIRECTORY,
    })
    window.desktop!.readPreviewText = vi.fn().mockResolvedValue({
      content: WORKSPACE_FILE_CONTENT,
      path: `${FRONTEND_WORKSPACE_DIRECTORY}\\src\\focus-files.tsx`,
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-frontend-review",
      })
    })
    fireEvent.click(await screen.findByRole("link", { name: "focus-files.tsx" }))

    await waitFor(() => {
      expect(window.desktop!.resolvePreviewTarget).toHaveBeenCalledWith({
        value: absolutePath,
        workspaceRoot: FRONTEND_WORKSPACE_DIRECTORY,
      })
    })
    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    expect(await within(inspector).findByText(/export const focusValue = 1/)).toBeInTheDocument()
    expect(within(inspector).queryByRole("textbox", { name: "Filter workspace files" })).not.toBeInTheDocument()
  })

  it("opens root-relative response local file links from the pane workspace", async () => {
    const resolvedPath = `${FRONTEND_WORKSPACE_DIRECTORY}\\snake.html`
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-root-relative-link-1",
          sessionID: "session-frontend-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-root-relative-link-1", type: "text", text: "Open the root-relative file link" }],
      },
      {
        info: {
          id: "msg-assistant-root-relative-link-1",
          sessionID: "session-frontend-review",
          role: "assistant",
          created: 101,
          completed: 102,
        },
        parts: [
          {
            id: "part-assistant-root-relative-link-1",
            type: "text",
            text: "[snake.html](/snake.html)",
          },
        ],
      },
    ])
    window.desktop!.resolvePreviewTarget = vi.fn().mockResolvedValue({
      entry: resolvedPath,
      externalOpenTarget: {
        kind: "path",
        value: resolvedPath,
      },
      input: resolvedPath,
      kind: "file",
      mime: "text/html; charset=utf-8",
      normalizedInput: "snake.html",
      path: resolvedPath,
      renderer: "html-preview",
      textReadable: true,
      title: "snake.html",
      workspaceRoot: FRONTEND_WORKSPACE_DIRECTORY,
    })
    window.desktop!.readPreviewText = vi.fn().mockResolvedValue({
      content: "<!doctype html><title>Snake</title>",
      path: resolvedPath,
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-frontend-review",
      })
    })
    fireEvent.click(await screen.findByRole("link", { name: "snake.html" }))

    await waitFor(() => {
      expect(window.desktop!.resolvePreviewTarget).toHaveBeenCalledWith({
        value: resolvedPath,
        workspaceRoot: FRONTEND_WORKSPACE_DIRECTORY,
      })
    })
    expect(window.desktop!.openPath).not.toHaveBeenCalled()
  })

  it("does not duplicate the workspace for slash-prefixed Windows absolute response links", async () => {
    const resolvedPath = `${FRONTEND_WORKSPACE_DIRECTORY}\\snake-game.html`
    const slashPrefixedAbsolutePath = `/${FRONTEND_WORKSPACE_DIRECTORY.replace(/\\/g, "/")}/snake-game.html`
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-slash-drive-link-1",
          sessionID: "session-frontend-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-slash-drive-link-1", type: "text", text: "Open the slash-prefixed drive link" }],
      },
      {
        info: {
          id: "msg-assistant-slash-drive-link-1",
          sessionID: "session-frontend-review",
          role: "assistant",
          created: 101,
          completed: 102,
        },
        parts: [
          {
            id: "part-assistant-slash-drive-link-1",
            type: "text",
            text: `[snake-game.html](${slashPrefixedAbsolutePath})`,
          },
        ],
      },
    ])
    window.desktop!.resolvePreviewTarget = vi.fn().mockResolvedValue({
      entry: resolvedPath,
      externalOpenTarget: {
        kind: "path",
        value: resolvedPath,
      },
      input: resolvedPath,
      kind: "file",
      mime: "text/html; charset=utf-8",
      normalizedInput: "snake-game.html",
      path: resolvedPath,
      renderer: "html-preview",
      textReadable: true,
      title: "snake-game.html",
      workspaceRoot: FRONTEND_WORKSPACE_DIRECTORY,
    })
    window.desktop!.readPreviewText = vi.fn().mockResolvedValue({
      content: "<!doctype html><title>Snake</title>",
      path: resolvedPath,
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-frontend-review",
      })
    })
    fireEvent.click(await screen.findByRole("link", { name: "snake-game.html" }))

    await waitFor(() => {
      expect(window.desktop!.resolvePreviewTarget).toHaveBeenCalledWith({
        value: `${FRONTEND_WORKSPACE_DIRECTORY.replace(/\\/g, "/")}/snake-game.html`,
        workspaceRoot: FRONTEND_WORKSPACE_DIRECTORY,
      })
    })
    expect(window.desktop!.openPath).not.toHaveBeenCalled()
  })

  it("opens response markdown document links without line numbers in the files inspector", async () => {
    const absolutePath = "C:/Projects/Atlas/frontend/README.md"
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-md-link-1",
          sessionID: "session-frontend-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-md-link-1", type: "text", text: "Open the markdown file link" }],
      },
      {
        info: {
          id: "msg-assistant-md-link-1",
          sessionID: "session-frontend-review",
          role: "assistant",
          created: 101,
          completed: 102,
        },
        parts: [
          {
            id: "part-assistant-md-link-1",
            type: "text",
            text: `[README.md](${absolutePath})`,
          },
        ],
      },
    ])
    window.desktop!.resolvePreviewTarget = vi.fn()
    window.desktop!.readWorkspaceFile = vi.fn().mockResolvedValue({
      path: "readme.md",
      name: "README.md",
      extension: "md",
      kind: "text",
      content: "# Li Bai\n\nTang poet.",
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-frontend-review",
      })
    })
    fireEvent.click(await screen.findByRole("link", { name: "README.md" }))

    await waitFor(() => {
      expect(window.desktop!.readWorkspaceFile).toHaveBeenCalledWith({
        directory: FRONTEND_WORKSPACE_DIRECTORY,
        path: "readme.md",
      })
    })
    expect(window.desktop!.resolvePreviewTarget).not.toHaveBeenCalled()
    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    expect(within(inspector).getByRole("searchbox", { name: "Filter workspace files" })).toBeInTheDocument()
    expect(await within(inspector).findByRole("heading", { name: "Li Bai" })).toBeInTheDocument()
  })

  it("opens response local file links through the system when the path is outside the pane workspace", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-external-link-1",
          sessionID: "session-frontend-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-external-link-1", type: "text", text: "Open the external local file" }],
      },
      {
        info: {
          id: "msg-assistant-external-link-1",
          sessionID: "session-frontend-review",
          role: "assistant",
          created: 101,
          completed: 102,
        },
        parts: [
          {
            id: "part-assistant-external-link-1",
            type: "text",
            text: "[notes.txt](C:/Users/demo/notes.txt)",
          },
        ],
      },
    ])

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-frontend-review",
      })
    })
    await screen.findByRole("link", { name: "notes.txt" })
    fireEvent.click(screen.getByRole("link", { name: "notes.txt" }))

    await waitFor(() => {
      expect(window.desktop!.openPath).toHaveBeenCalledWith({
        targetPath: "C:/Users/demo/notes.txt",
      })
    })
  })

  it("opens loose Windows response local file links through the system", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-loose-link-1",
          sessionID: "session-frontend-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-loose-link-1", type: "text", text: "Open the loose local file" }],
      },
      {
        info: {
          id: "msg-assistant-loose-link-1",
          sessionID: "session-frontend-review",
          role: "assistant",
          created: 101,
          completed: 102,
        },
        parts: [
          {
            id: "part-assistant-loose-link-1",
            type: "text",
            text: String.raw`[index.html](C:\新建文件夹 (4)\index.html)`,
          },
        ],
      },
    ])

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-frontend-review",
      })
    })
    await screen.findByRole("link", { name: "index.html" })
    fireEvent.click(screen.getByRole("link", { name: "index.html" }))

    await waitFor(() => {
      expect(window.desktop!.openPath).toHaveBeenCalledWith({
        targetPath: String.raw`C:\新建文件夹 (4)\index.html`,
      })
    })
  })

  it("falls back to a file URL when opening a response local file path fails", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.openPath = vi.fn().mockRejectedValue(new Error("No application is associated with the specified file."))
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-file-url-fallback-1",
          sessionID: "session-frontend-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-file-url-fallback-1", type: "text", text: "Open the fallback local file" }],
      },
      {
        info: {
          id: "msg-assistant-file-url-fallback-1",
          sessionID: "session-frontend-review",
          role: "assistant",
          created: 101,
          completed: 102,
        },
        parts: [
          {
            id: "part-assistant-file-url-fallback-1",
            type: "text",
            text: String.raw`[index.html](C:\新建文件夹 (4)\index.html)`,
          },
        ],
      },
    ])

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-frontend-review",
      })
    })
    await screen.findByRole("link", { name: "index.html" })
    fireEvent.click(screen.getByRole("link", { name: "index.html" }))

    await waitFor(() => {
      expect(window.desktop!.openExternalUrl).toHaveBeenCalledWith({
        url: "file:///C:/%E6%96%B0%E5%BB%BA%E6%96%87%E4%BB%B6%E5%A4%B9%20(4)/index.html",
      })
    })
  })

  it("shows line comments on hover, confirms a comment, and discards a canceled draft", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.readWorkspaceFile = vi.fn().mockResolvedValue({
      path: WORKSPACE_FILE_PATH,
      name: "focus-files.tsx",
      extension: "tsx",
      kind: "text",
      content: WORKSPACE_FILE_CONTENT,
    })

    render(<App />)

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    await openWorkspaceFileFromTree(inspector)
    expect(await screen.findByText("const nextValue = focusValue + 1")).toBeInTheDocument()

    const secondLine = screen.getByTestId("workspace-file-line-2")
    fireEvent.click(within(secondLine).getByRole("button", { name: "Add comment on line 2" }))
    fireEvent.change(screen.getByRole("textbox", { name: "File comment on line 2" }), {
      target: { value: "Check the increment logic." },
    })
    expect(screen.queryByRole("button", { name: "Annotate" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "确认" }))

    expect(screen.getByText("Check the increment logic.")).toBeInTheDocument()

    const thirdLine = screen.getByTestId("workspace-file-line-3")
    fireEvent.click(within(thirdLine).getByRole("button", { name: "Add comment on line 3" }))
    fireEvent.change(screen.getByRole("textbox", { name: "File comment on line 3" }), {
      target: { value: "Drop this note." },
    })
    fireEvent.click(screen.getByRole("button", { name: "取消" }))

    expect(screen.queryByText("Drop this note.")).not.toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "File comment on line 3" })).not.toBeInTheDocument()
  })

  it("confirms a multi-line file comment into a composer reference chip and sends its compiled context", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.readWorkspaceFile = vi.fn().mockResolvedValue({
      path: WORKSPACE_FILE_PATH,
      name: "focus-files.tsx",
      extension: "tsx",
      kind: "text",
      content: WORKSPACE_FILE_CONTENT,
    })

    render(<App />)

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    await openWorkspaceFileFromTree(inspector)
    expect(await screen.findByText("const nextValue = focusValue + 1")).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId("workspace-file-line-gutter-2"), { button: 0 })
    fireEvent.mouseOver(screen.getByTestId("workspace-file-line-gutter-3"))
    fireEvent.mouseUp(screen.getByTestId("workspace-file-line-gutter-3"))

    const commentBox = await screen.findByRole("textbox", { name: "File comment on lines 2-3" })
    fireEvent.change(commentBox, {
      target: { value: "Check how these values flow through the summary." },
    })
    fireEvent.click(screen.getByRole("button", { name: "确认" }))

    await screen.findByText(/focus-files\.tsx:L2-L3/)
    expect(screen.getByRole("textbox", { name: "Task draft" }).textContent).toContain("@focus-files.tsx:L2-L3")
    expect(screen.getByText("Check how these values flow through the summary.")).toBeInTheDocument()

    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalled()
    })

    const sendAgentMessage = window.desktop!.agentSession!.sendTurn
    expect(sendAgentMessage).toBeDefined()
    if (!sendAgentMessage) throw new Error("Expected sendAgentMessage mock")

    const sendInput = vi.mocked(sendAgentMessage).mock.calls.at(-1)?.[0]
    expect(sendInput).toBeDefined()
    if (!sendInput) throw new Error("Expected sendAgentMessage payload")

    expect(sendInput.text).toContain("File feedback for src/focus-files.tsx (Lines 2-3)")
    expect(sendInput.text).toContain("2 | const nextValue = focusValue + 1")
    expect(sendInput.text).toContain("3 | export const summary = nextValue")
    expect(sendInput.text).toContain("Check how these values flow through the summary.")

    await waitFor(() => {
      expect(screen.queryByLabelText("Selected comment references")).not.toBeInTheDocument()
    })

    const threadReferenceChip = screen
      .getAllByText(/focus-files\.tsx:L2-L3/)
      .find((element) => element.classList.contains("composer-inline-tag"))
    expect(threadReferenceChip).toHaveClass("composer-inline-tag", "thread-inline-reference", "is-comment")
    expect(screen.getByText("Check how these values flow through the summary.")).toBeInTheDocument()
    expect(screen.queryByText("File feedback for src/focus-files.tsx (Lines 2-3)")).not.toBeInTheDocument()
  })

  it("keeps user reference chips after streamed history refresh replaces the conversation", async () => {
    let streamListener: DesktopAgentSessionEventListener | undefined
    let activeStreamID = ""
    let historyPhase: "initial" | "after-send" = "initial"

    const compiledReferencePrompt = [
      "File feedback for src/focus-files.tsx (Lines 2-3)",
      "",
      "```tsx",
      "2 | const nextValue = focusValue + 1",
      "3 | export const summary = nextValue",
      "```",
      "",
      "Comment:",
      "Check how these values flow through the summary.",
    ].join("\n")

    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.readWorkspaceFile = vi.fn().mockResolvedValue({
      path: WORKSPACE_FILE_PATH,
      name: "focus-files.tsx",
      extension: "tsx",
      kind: "text",
      content: WORKSPACE_FILE_CONTENT,
    })
    window.desktop!.agentSession!.loadHistory = vi.fn().mockImplementation(async ({ backendSessionID: sessionID }: { backendSessionID: string }) => {
      if (sessionID !== "session-frontend-review" || historyPhase !== "after-send") return []

      return [
        {
          info: {
            id: "msg-user-history",
            sessionID,
            role: "user",
            created: 10,
          },
          parts: [{ id: "part-user-history", type: "text", text: compiledReferencePrompt }],
        },
        {
          info: {
            id: "msg-assistant-history",
            sessionID,
            role: "assistant",
            created: 11,
            completed: 12,
          },
          parts: [{ id: "part-assistant-history", type: "text", text: "History refresh complete." }],
        },
      ]
    })
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      streamListener = listener
      return vi.fn()
    })
    window.desktop!.agentSession!.sendTurn = vi.fn().mockImplementation(async (input: { clientTurnID: string }) => {
      activeStreamID = input.clientTurnID
      return {
        clientTurnID: input.clientTurnID,
      }
    })

    render(<App />)

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    await openWorkspaceFileFromTree(inspector)
    expect(await screen.findByText("const nextValue = focusValue + 1")).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId("workspace-file-line-gutter-2"), { button: 0 })
    fireEvent.mouseOver(screen.getByTestId("workspace-file-line-gutter-3"))
    fireEvent.mouseUp(screen.getByTestId("workspace-file-line-gutter-3"))

    const commentBox = await screen.findByRole("textbox", { name: "File comment on lines 2-3" })
    fireEvent.change(commentBox, {
      target: { value: "Check how these values flow through the summary." },
    })
    fireEvent.click(screen.getByRole("button", { name: "确认" }))

    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(screen.queryByLabelText("Selected comment references")).not.toBeInTheDocument()
    })

    const initialReferenceChip = await screen.findByText("@focus-files.tsx:L2-L3")
    expect(initialReferenceChip).toHaveClass("composer-inline-tag", "thread-inline-reference", "is-comment")

    await act(async () => {
      historyPhase = "after-send"
      streamListener?.(createRequestStreamEvent({
        backendSessionID: "session-frontend-review",
        clientTurnID: activeStreamID,
        event: "done",
        data: {
          sessionID: "session-frontend-review",
          parts: [{ id: "part-assistant-history", type: "text", text: "History refresh complete." }],
        },
      }))
      await Promise.resolve()
    })

    const getSessionHistory = window.desktop!.agentSession!.loadHistory as ReturnType<typeof vi.fn>

    await waitFor(() => {
      expect(
        vi.mocked(getSessionHistory).mock.calls.some(
          ([input]) => input?.backendSessionID === "session-frontend-review",
        ),
      ).toBe(true)
    })

    const referenceChipAfterRefresh = await screen.findByText("@focus-files.tsx:L2-L3")
    expect(referenceChipAfterRefresh).toHaveClass("composer-inline-tag", "thread-inline-reference", "is-comment")
    expect(screen.getByText("Check how these values flow through the summary.")).toBeInTheDocument()
    expect(screen.getByText("History refresh complete.")).toBeInTheDocument()
    expect(screen.queryByText("File feedback for src/focus-files.tsx (Lines 2-3)")).not.toBeInTheDocument()
  })

  it("keeps file review state isolated when the focused workspace changes", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue(createWorkspaceFileReviewWorkspaces())
    window.desktop!.readWorkspaceFile = vi.fn().mockResolvedValue({
      path: WORKSPACE_FILE_PATH,
      name: "focus-files.tsx",
      extension: "tsx",
      kind: "text",
      content: WORKSPACE_FILE_CONTENT,
    })

    render(<App />)

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    await openWorkspaceFileFromTree(inspector)
    fireEvent.change(screen.getByLabelText("Filter workspace files"), {
      target: { value: "focus" },
    })
    expect(await screen.findByText("export const focusValue = 1")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "backend" }))

    expect(await screen.findByText("export const focusValue = 1")).toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: /focus-files\.tsx/i, pressed: true })).toBeInTheDocument()
    expect(screen.getByLabelText("Filter workspace files")).toHaveValue("focus")
  })

  it("renders planning state only below the composer", async () => {
    const workspace: LoadedFolderWorkspace = {
      id: "workspace-plan",
      directory: "C:\\Projects\\Planner\\app",
      name: "app",
      created: 1,
      updated: 30,
      project: {
        id: "project-plan",
        name: "Planner",
        worktree: "C:\\Projects\\Planner",
      },
      sessions: [
        {
          id: "session-plan-pending",
          projectID: "project-plan",
          directory: "C:\\Projects\\Planner\\app",
          title: "Plan review",
          created: 5,
          updated: 30,
          workflow: {
            mode: "planning",
            plan: {
              status: "pending-approval",
              updatedAt: 30,
            },
          },
        },
        {
          id: "session-plan-draft",
          projectID: "project-plan",
          directory: "C:\\Projects\\Planner\\app",
          title: "Research",
          created: 4,
          updated: 20,
          workflow: {
            mode: "planning",
            plan: {
              status: "draft",
              updatedAt: 20,
            },
          },
        },
        {
          id: "session-plan-approved",
          projectID: "project-plan",
          directory: "C:\\Projects\\Planner\\app",
          title: "Execute",
          created: 3,
          updated: 10,
          workflow: {
            mode: "execution",
            plan: {
              status: "approved",
              updatedAt: 10,
              approvedAt: 9,
            },
          },
        },
      ],
    }

    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([workspace])

    render(<App />)

    const topMenu = await screen.findByLabelText("Session canvas top menu")
    expect(within(topMenu).queryByText("Planning")).not.toBeInTheDocument()
    expect(screen.getAllByText("Planning")).toHaveLength(1)
    expect(screen.queryByText("Pending")).not.toBeInTheDocument()
    expect(screen.queryByText("Approved plan")).not.toBeInTheDocument()
  })

  it("opens the external editor selector from the session canvas top menu", async () => {
    render(<App />)
    const topMenu = screen.getByLabelText("Session canvas top menu")

    await waitFor(() => {
      expect(window.desktop!.listExternalEditorsForTarget).toHaveBeenCalledWith({
        targetPath: "C:\\Projects\\Project 2\\app",
      })
    })

    fireEvent.click(within(topMenu).getByRole("button", { name: "Choose editor for current project" }))

    const editorMenu = await screen.findByRole("menu", { name: "Open current project" })
    expect(editorMenu.querySelector(".external-editor-menu-option-icon-image")).not.toBeNull()
    fireEvent.click(within(editorMenu).getByRole("menuitem", { name: /VS Code/i }))

    await waitFor(() => {
      expect(window.desktop!.openInExternalEditor).toHaveBeenCalledWith({
        targetPath: "C:\\Projects\\Project 2\\app",
        editorID: "vscode",
      })
    })
    expect(window.localStorage.getItem("desktop.externalEditor.lastUsed.v1")).toBe("vscode")
  })

  it("opens the remembered external editor from the primary split button", async () => {
    window.localStorage.setItem("desktop.externalEditor.lastUsed.v1", "explorer")
    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.listExternalEditorsForTarget).toHaveBeenCalledWith({
        targetPath: "C:\\Projects\\Project 2\\app",
      })
    })

    const topMenu = screen.getByLabelText("Session canvas top menu")
    fireEvent.click(await within(topMenu).findByRole("button", { name: "Open current project in File Explorer" }))

    await waitFor(() => {
      expect(window.desktop!.openInExternalEditor).toHaveBeenCalledWith({
        targetPath: "C:\\Projects\\Project 2\\app",
        editorID: "explorer",
      })
    })
  })

  it("creates a global skill from the inline draft form", async () => {
    const root = "C:\\Users\\19128\\.anybox\\skills"
    const directoryPath = `${root}\\layout-review`
    const filePath = `${directoryPath}\\SKILL.md`
    const content = ["---", "name: layout-review", "description: Describe when this skill should be used.", "---", "", "# layout-review"].join("\n")

    window.desktop!.getGlobalSkillsTree = vi
      .fn()
      .mockResolvedValueOnce({
        root,
        items: [],
      })
      .mockResolvedValueOnce({
        root,
        items: [
          {
            name: "layout-review",
            path: directoryPath,
            kind: "directory",
            children: [
              {
                name: "SKILL.md",
                path: filePath,
                kind: "file",
              },
            ],
          },
        ],
      })
    window.desktop!.createGlobalSkill = vi.fn().mockResolvedValue({
      directory: directoryPath,
      file: {
        path: filePath,
        content,
      },
    })
    window.desktop!.readGlobalSkillFile = vi.fn().mockResolvedValue({
      path: filePath,
      content,
    })

    render(<App />)

    openActivityRailConfigurationView("Open skills")

    expect(await screen.findByLabelText("Prompts and skills top menu")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Skills", hidden: true })).toHaveAttribute("aria-selected", "true")
    expect(screen.queryByLabelText("Left sidebar top menu")).not.toBeInTheDocument()
    expect(document.querySelector("#app-sidebar")).not.toBeInTheDocument()
    expect(document.querySelector(".skills-workspace-list-panel")).toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "Inspector sidebar" })).not.toBeInTheDocument()

    await screen.findByText("No skills exist yet. Use + to create the first one.")

    fireEvent.click(screen.getByRole("button", { name: "Create global skill or folder" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "New skill" }))

    const nameInput = screen.getByRole("textbox", { name: "New global skill name" })
    fireEvent.change(nameInput, { target: { value: "layout-review" } })
    fireEvent.click(screen.getByRole("button", { name: "Create" }))

    await waitFor(() => {
      expect(window.desktop!.createGlobalSkill).toHaveBeenCalledWith({
        name: "layout-review",
        parentDirectory: null,
      })
    })

    await screen.findByRole("button", { name: "layout-review" })
    expect(screen.queryByRole("textbox", { name: "New global skill name" })).not.toBeInTheDocument()
    expect(await openLocalSkillEditor()).toHaveValue(content)
  })

  it("confirms before switching from dirty prompts to skills", async () => {
    render(<App />)

    openActivityRailConfigurationView("Open prompts")
    const promptEditor = await screen.findByRole("textbox", { name: "System prompt content" })
    fireEvent.change(promptEditor, {
      target: {
        value: "Edited system prompt",
      },
    })

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true)
    const modeGroup = screen.getByLabelText("Prompts and skills section")
    const promptsModeButton = within(modeGroup).getByRole("tab", { name: "Prompts", hidden: true })
    const skillsModeButton = within(modeGroup).getByRole("tab", { name: "Skills", hidden: true })

    fireEvent.click(skillsModeButton)
    expect(confirmSpy).toHaveBeenCalledWith("The current prompt has unsaved changes. Switch to Skills anyway?")
    expect(promptsModeButton).toHaveAttribute("aria-selected", "true")
    expect(skillsModeButton).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("textbox", { name: "System prompt content" })).toHaveValue("Edited system prompt")

    fireEvent.click(skillsModeButton)
    await screen.findByText("No skills exist yet. Use + to create the first one.")
    expect(within(screen.getByLabelText("Prompts and skills section")).getByRole("tab", { name: "Skills", hidden: true })).toHaveAttribute("aria-selected", "true")
    confirmSpy.mockRestore()
  })

  it("confirms before switching from dirty skills to prompts", async () => {
    const root = "C:\\Users\\19128\\.anybox\\skills"
    const directoryPath = `${root}\\layout-review`
    const filePath = `${directoryPath}\\SKILL.md`
    const content = ["---", "name: layout-review", "description: Describe when this skill should be used.", "---", "", "# layout-review"].join("\n")

    window.desktop!.getGlobalSkillsTree = vi.fn().mockResolvedValue({
      root,
      items: [
        {
          name: "layout-review",
          path: directoryPath,
          kind: "directory",
          children: [
            {
              name: "SKILL.md",
              path: filePath,
              kind: "file",
            },
          ],
        },
      ],
    })
    window.desktop!.readGlobalSkillFile = vi.fn().mockResolvedValue({
      path: filePath,
      content,
    })

    render(<App />)

    openActivityRailConfigurationView("Open skills")
    const skillEditor = await openLocalSkillEditor()
    fireEvent.change(skillEditor, {
      target: {
        value: `${content}\n\nExtra guidance.`,
      },
    })

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true)
    const modeGroup = screen.getByLabelText("Prompts and skills section")
    const promptsModeButton = within(modeGroup).getByRole("tab", { name: "Prompts", hidden: true })
    const skillsModeButton = within(modeGroup).getByRole("tab", { name: "Skills", hidden: true })

    fireEvent.click(promptsModeButton)
    expect(confirmSpy).toHaveBeenCalledWith("The current skill has unsaved changes. Switch to Prompts anyway?")
    expect(skillsModeButton).toHaveAttribute("aria-selected", "true")
    expect(promptsModeButton).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("textbox", { name: "Local skill editor" })).toHaveValue(`${content}\n\nExtra guidance.`)

    fireEvent.click(promptsModeButton)
    await screen.findByRole("list", { name: "Prompt presets" })
    expect(within(screen.getByLabelText("Prompts and skills section")).getByRole("tab", { name: "Prompts", hidden: true })).toHaveAttribute("aria-selected", "true")
    confirmSpy.mockRestore()
  })

  it("creates a global skill folder while keeping the local library skill-focused", async () => {
    const root = "C:\\Users\\19128\\.anybox\\skills"
    const folderPath = `${root}\\frontend`

    window.desktop!.getGlobalSkillsTree = vi
      .fn()
      .mockResolvedValueOnce({
        root,
        items: [],
      })
      .mockResolvedValueOnce({
        root,
        items: [
          {
            name: "frontend",
            path: folderPath,
            kind: "directory",
            role: "folder",
            children: [],
          },
        ],
      })
    window.desktop!.createGlobalSkillFolder = vi.fn().mockResolvedValue({
      directory: folderPath,
    })

    render(<App />)

    openActivityRailConfigurationView("Open skills")
    await screen.findByText("No skills exist yet. Use + to create the first one.")

    fireEvent.click(screen.getByRole("button", { name: "Create global skill or folder" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "New folder" }))
    fireEvent.change(screen.getByRole("textbox", { name: "New global skill name" }), {
      target: { value: "frontend" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create" }))

    await waitFor(() => {
      expect(window.desktop!.createGlobalSkillFolder).toHaveBeenCalledWith({
        name: "frontend",
        parentDirectory: null,
      })
    })
    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "New global skill name" })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: "frontend" })).not.toBeInTheDocument()
    expect(window.desktop!.createGlobalSkill).not.toHaveBeenCalled()
  })

  it("moves a global skill into a selected folder", async () => {
    const root = "C:\\Users\\19128\\.anybox\\skills"
    const folderPath = `${root}\\frontend`
    const oldDirectoryPath = `${root}\\review`
    const oldFilePath = `${oldDirectoryPath}\\SKILL.md`
    const nextDirectoryPath = `${folderPath}\\review`
    const nextFilePath = `${nextDirectoryPath}\\SKILL.md`
    const content = ["---", "name: review", "description: Move me.", "---", "", "# review"].join("\n")

    window.desktop!.getGlobalSkillsTree = vi
      .fn()
      .mockResolvedValueOnce({
        root,
        items: [
          {
            name: "frontend",
            path: folderPath,
            kind: "directory",
            role: "folder",
            children: [],
          },
          {
            name: "review",
            path: oldDirectoryPath,
            kind: "directory",
            role: "skill",
            children: [
              {
                name: "SKILL.md",
                path: oldFilePath,
                kind: "file",
                role: "resource",
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        root,
        items: [
          {
            name: "frontend",
            path: folderPath,
            kind: "directory",
            role: "folder",
            children: [
              {
                name: "review",
                path: nextDirectoryPath,
                kind: "directory",
                role: "skill",
                children: [
                  {
                    name: "SKILL.md",
                    path: nextFilePath,
                    kind: "file",
                    role: "resource",
                  },
                ],
              },
            ],
          },
        ],
      })
    window.desktop!.readGlobalSkillFile = vi.fn().mockImplementation(async ({ path }: { path: string }) => ({
      path,
      content,
    }))
    window.desktop!.moveGlobalSkillDirectory = vi.fn().mockResolvedValue({
      previousDirectory: oldDirectoryPath,
      directory: nextDirectoryPath,
      filePath: nextFilePath,
    })

    render(<App />)

    openActivityRailConfigurationView("Open skills")
    expect(await openLocalSkillEditor()).toHaveValue(content)

    fireEvent.click(screen.getByRole("button", { name: "Actions for review" }))
    expect(await screen.findByRole("menuitem", { name: "Rename" })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move to folder..." }))

    const dialog = await screen.findByRole("dialog", { name: "Move skill or folder" })
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Move destination" }), {
      target: { value: folderPath },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }))

    await waitFor(() => {
      expect(window.desktop!.moveGlobalSkillDirectory).toHaveBeenCalledWith({
        directory: oldDirectoryPath,
        parentDirectory: folderPath,
      })
    })
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Move skill or folder" })).not.toBeInTheDocument()
    })
    expect(await screen.findByRole("button", { name: "review" })).toBeInTheDocument()
    expect(window.desktop!.readGlobalSkillFile).toHaveBeenLastCalledWith({ path: nextFilePath })
    expect(await openLocalSkillEditor()).toHaveValue(content)
  })

  it("opens a local skill folder from its row menu", async () => {
    const root = "C:\\Users\\19128\\.anybox\\skills"
    const directoryPath = `${root}\\review`
    const filePath = `${directoryPath}\\SKILL.md`
    window.desktop!.getGlobalSkillsTree = vi.fn().mockResolvedValue({
      root,
      items: [{
        name: "review",
        path: directoryPath,
        kind: "directory",
        role: "skill",
        children: [{
          name: "SKILL.md",
          path: filePath,
          kind: "file",
          role: "resource",
        }],
      }],
    })
    window.desktop!.readGlobalSkillFile = vi.fn().mockResolvedValue({
      path: filePath,
      content: "# Review",
    })

    render(<App />)

    openActivityRailConfigurationView("Open skills")
    await screen.findByRole("button", { name: "review" })
    expect(screen.queryByText(root)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open file location" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Actions for review" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open file location" }))

    await waitFor(() => {
      expect(window.desktop!.openPath).toHaveBeenCalledWith({
        targetPath: directoryPath,
      })
    })
  })

  it("previews and installs global skills from a Git repository", async () => {
    const root = "C:\\Users\\19128\\.anybox\\skills"
    const directoryPath = `${root}\\layout-review`
    const filePath = `${directoryPath}\\SKILL.md`
    const content = ["---", "name: Layout Review", "description: Review layouts.", "---", "", "# Layout Review"].join("\n")

    window.desktop!.getGlobalSkillsTree = vi
      .fn()
      .mockResolvedValueOnce({
        root,
        items: [],
      })
      .mockResolvedValueOnce({
        root,
        items: [
          {
            name: "layout-review",
            path: directoryPath,
            kind: "directory",
            children: [
              {
                name: "SKILL.md",
                path: filePath,
                kind: "file",
              },
            ],
          },
        ],
      })
    window.desktop!.previewGlobalSkillGitInstall = vi.fn().mockResolvedValue({
      previewID: "preview-1",
      source: "owner/repo",
      cloneUrl: "https://github.com/owner/repo.git",
      skills: [
        {
          id: "skills/layout-review",
          name: "Layout Review",
          description: "Review layouts.",
          relativePath: "skills/layout-review",
          directoryName: "layout-review",
          targetDirectory: directoryPath,
          available: true,
          filePath,
        },
        {
          id: "skills/existing",
          name: "Existing",
          description: "Already installed.",
          relativePath: "skills/existing",
          directoryName: "existing",
          targetDirectory: `${root}\\existing`,
          available: false,
          reason: "Skill 'existing' already exists.",
          filePath: `${root}\\existing\\SKILL.md`,
        },
      ],
    })
    window.desktop!.installGlobalSkillsFromGit = vi.fn().mockResolvedValue({
      installed: [
        {
          id: "skills/layout-review",
          name: "Layout Review",
          directory: directoryPath,
          filePath,
        },
      ],
    })
    window.desktop!.readGlobalSkillFile = vi.fn().mockResolvedValue({
      path: filePath,
      content,
    })

    render(<App />)

    openActivityRailConfigurationView("Open skills")
    fireEvent.click(await screen.findByRole("button", { name: "Add Skill" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Install from URL" }))

    const dialog = await screen.findByRole("dialog", { name: "Install skills from Git" })
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Git skill repository" }), {
      target: { value: "owner/repo" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }))

    await waitFor(() => {
      expect(window.desktop!.previewGlobalSkillGitInstall).toHaveBeenCalledWith({
        source: "owner/repo",
        parentDirectory: null,
      })
    })

    expect(await within(dialog).findByRole("checkbox", { name: /Layout Review/ })).toBeChecked()
    expect(within(dialog).getByRole("checkbox", { name: /Existing/ })).toBeDisabled()

    fireEvent.click(within(dialog).getByRole("button", { name: "Install (1)" }))

    await waitFor(() => {
      expect(window.desktop!.installGlobalSkillsFromGit).toHaveBeenCalledWith({
        previewID: "preview-1",
        skillIDs: ["skills/layout-review"],
        parentDirectory: null,
      })
    })

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Install skills from Git" })).not.toBeInTheDocument()
    })
    expect(await screen.findByRole("button", { name: "layout-review" })).toBeInTheDocument()
    expect(window.desktop!.readGlobalSkillFile).toHaveBeenLastCalledWith({ path: filePath })
    expect(screen.getByRole("heading", { name: "Layout Review", level: 2 })).toBeInTheDocument()
  })

  it("installs a global skill from a local SKILL.md file", async () => {
    const root = "C:\\Users\\19128\\.anybox\\skills"
    const directoryPath = `${root}\\local-review`
    const filePath = `${directoryPath}\\SKILL.md`
    const content = ["---", "name: Local Review", "description: Review local layouts.", "---", "", "# Local Review"].join("\n")

    window.desktop!.getGlobalSkillsTree = vi
      .fn()
      .mockResolvedValueOnce({
        root,
        items: [],
      })
      .mockResolvedValueOnce({
        root,
        items: [
          {
            name: "local-review",
            path: directoryPath,
            kind: "directory",
            children: [
              {
                name: "SKILL.md",
                path: filePath,
                kind: "file",
              },
            ],
          },
        ],
      })
    window.desktop!.installGlobalSkillFromLocalFile = vi.fn().mockResolvedValue({
      installed: [
        {
          id: ".",
          name: "Local Review",
          directory: directoryPath,
          filePath,
        },
      ],
    })
    window.desktop!.readGlobalSkillFile = vi.fn().mockResolvedValue({
      path: filePath,
      content,
    })

    render(<App />)

    openActivityRailConfigurationView("Open skills")
    fireEvent.click(await screen.findByRole("button", { name: "Add Skill" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Import from local file" }))

    const dialog = await screen.findByRole("dialog", { name: "Install local skill" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose SKILL.md" }))

    await waitFor(() => {
      expect(window.desktop!.installGlobalSkillFromLocalFile).toHaveBeenCalledWith({
        parentDirectory: null,
      })
    })

    expect(await screen.findByRole("button", { name: "local-review" })).toBeInTheDocument()
    expect(window.desktop!.readGlobalSkillFile).toHaveBeenLastCalledWith({ path: filePath })
    expect(screen.getByRole("heading", { name: "Local Review", level: 2 })).toBeInTheDocument()
  })

  it("filters the global skills tree from the fixed search row", async () => {
    const root = "C:\\Users\\19128\\.anybox\\skills"
    const algorithmicDirectoryPath = `${root}\\algorithmic-art`
    const algorithmicFilePath = `${algorithmicDirectoryPath}\\SKILL.md`
    const frontendFolderPath = `${root}\\frontend`
    const reviewDirectoryPath = `${frontendFolderPath}\\review`
    const reviewFilePath = `${reviewDirectoryPath}\\SKILL.md`

    window.desktop!.getGlobalSkillsTree = vi.fn().mockResolvedValue({
      root,
      items: [
        {
          name: "algorithmic-art",
          path: algorithmicDirectoryPath,
          kind: "directory",
          children: [
            {
              name: "SKILL.md",
              path: algorithmicFilePath,
              kind: "file",
            },
          ],
        },
        {
          name: "frontend",
          path: frontendFolderPath,
          kind: "directory",
          role: "folder",
          children: [
            {
              name: "review",
              path: reviewDirectoryPath,
              kind: "directory",
              children: [
                {
                  name: "SKILL.md",
                  path: reviewFilePath,
                  kind: "file",
                },
              ],
            },
          ],
        },
      ],
    })
    window.desktop!.readGlobalSkillFile = vi.fn().mockResolvedValue({
      path: algorithmicFilePath,
      content: "# Algorithmic Art",
    })

    render(<App />)

    openActivityRailConfigurationView("Open skills")

    const search = await screen.findByRole("searchbox", { name: "Search skills" })
    expect(search.closest(".skills-workspace-search-field")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "algorithmic-art" })).toBeInTheDocument()
    const algorithmicSkillRow = screen.getByRole("button", { name: "algorithmic-art" })
    const reviewSkillRow = screen.getByRole("button", { name: "review" })
    const localSkillLabels = Array.from(
      document.querySelectorAll(".skills-workspace-local-skill-list .skill-library-result-name"),
    ).map((element) => element.textContent)
    expect(localSkillLabels).toEqual(["review", "algorithmic-art"])
    expect(algorithmicSkillRow).toHaveClass("skill-library-result-row", "is-local")
    expect(reviewSkillRow).toHaveClass("skill-library-result-row", "is-local")
    expect(screen.queryByRole("button", { name: "frontend" })).not.toBeInTheDocument()
    expect(reviewSkillRow).toHaveTextContent("frontend")

    fireEvent.change(search, { target: { value: "review" } })

    expect(screen.queryByRole("button", { name: "algorithmic-art" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "review" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "frontend" })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: "missing" } })

    expect(screen.getByText("No skills match your search.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "review" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Clear skills search" }))

    expect(search).toHaveValue("")
    expect(screen.getByRole("button", { name: "algorithmic-art" })).toBeInTheDocument()
  })

  it("switches the global skill editor between edit and markdown preview", async () => {
    const root = "C:\\Users\\19128\\.anybox\\skills"
    const directoryPath = `${root}\\layout-review`
    const filePath = `${directoryPath}\\SKILL.md`
    const content = ["# Preview Heading", "", "- First task", "- Second task"].join("\n")

    window.desktop!.getGlobalSkillsTree = vi.fn().mockResolvedValue({
      root,
      items: [
        {
          name: "layout-review",
          path: directoryPath,
          kind: "directory",
          children: [
            {
              name: "SKILL.md",
              path: filePath,
              kind: "file",
            },
          ],
        },
      ],
    })
    window.desktop!.readGlobalSkillFile = vi.fn().mockResolvedValue({
      path: filePath,
      content,
    })

    render(<App />)

    openActivityRailConfigurationView("Open skills")

    expect(await screen.findByRole("button", { name: "Delete" })).toHaveClass("secondary-button", "is-danger")
    const detailTabs = screen.getByRole("tablist", { name: "Skill detail sections" })
    fireEvent.click(within(detailTabs).getByRole("tab", { name: "Files" }))

    expect(screen.getByRole("heading", { name: "Preview Heading" })).toBeInTheDocument()
    expect(screen.getByText("First task")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Edit" }))

    const editor = await screen.findByRole("textbox", { name: "Local skill editor" })
    expect(editor).toHaveValue(content)
    await waitFor(() => {
      expect(editor).toHaveFocus()
    })

    fireEvent.click(screen.getByRole("button", { name: "Preview" }))

    expect(screen.queryByRole("textbox", { name: "Local skill editor" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Preview Heading" })).toBeInTheDocument()
    expect(screen.getByText("First task")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Edit" }))

    const reopenedEditor = screen.getByRole("textbox", { name: "Local skill editor" })
    expect(reopenedEditor).toHaveValue(content)
    await waitFor(() => {
      expect(reopenedEditor).toHaveFocus()
    })

    fireEvent.change(reopenedEditor, { target: { value: `${content}\n\nEditable note` } })

    expect(screen.getByRole("textbox", { name: "Local skill editor" })).toHaveValue(`${content}\n\nEditable note`)
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled()
  })

  it("renders global skill frontmatter as structured preview metadata", async () => {
    const root = "C:\\Users\\19128\\.anybox\\skills"
    const directoryPath = `${root}\\agent-browser`
    const filePath = `${directoryPath}\\SKILL.md`
    const content = [
      "---",
      "name: agent-browser",
      "description: Browser automation CLI for AI agents.",
      "allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*)",
      "hidden: true",
      "---",
      "",
      "# agent-browser",
      "",
      "Fast browser automation CLI for AI agents.",
    ].join("\n")

    window.desktop!.getGlobalSkillsTree = vi.fn().mockResolvedValue({
      root,
      items: [
        {
          name: "agent-browser",
          path: directoryPath,
          kind: "directory",
          children: [
            {
              name: "SKILL.md",
              path: filePath,
              kind: "file",
            },
          ],
        },
      ],
    })
    window.desktop!.readGlobalSkillFile = vi.fn().mockResolvedValue({
      path: filePath,
      content,
    })

    render(<App />)

    openActivityRailConfigurationView("Open skills")

    const agentBrowserRow = await screen.findByRole("button", { name: "agent-browser" })
    expect(agentBrowserRow).toHaveClass("is-selected")
    expect(document.querySelectorAll(".skill-library-result-row.is-selected")).toHaveLength(1)
    fireEvent.click(screen.getByRole("tab", { name: "Files" }))
    expect(screen.getByRole("button", { name: "SKILL.md" })).toBeInTheDocument()

    const metadata = screen.getByRole("region", { name: "Skill metadata" })
    expect(within(metadata).getByText("Skill Metadata")).toBeInTheDocument()
    expect(within(metadata).getByText("Browser automation CLI for AI agents.")).toBeInTheDocument()
    expect(within(metadata).getByText("Hidden")).toBeInTheDocument()
    expect(within(metadata).getByText("Bash(agent-browser:*)")).toBeInTheDocument()
    expect(within(metadata).getByText("Bash(npx agent-browser:*)")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "agent-browser", level: 1 })).toBeInTheDocument()
    expect(screen.queryByText(/name: agent-browser/)).not.toBeInTheDocument()
    expect(screen.queryByText(/allowed-tools:/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Edit" }))

    expect(screen.getByRole("textbox", { name: "Local skill editor" })).toHaveValue(content)
  })

  it("renames a global skill from the local library row actions", async () => {
    const root = "C:\\Users\\19128\\.anybox\\skills"
    const oldDirectoryPath = `${root}\\layout-review`
    const oldFilePath = `${oldDirectoryPath}\\SKILL.md`
    const nextDirectoryPath = `${root}\\layout-audit`
    const nextFilePath = `${nextDirectoryPath}\\SKILL.md`
    const oldContent = ["---", "name: layout-review", "description: Describe when this skill should be used.", "---", "", "# layout-review"].join("\n")
    const nextContent = ["---", "name: layout-audit", "description: Describe when this skill should be used.", "---", "", "# layout-audit"].join("\n")

    window.desktop!.getGlobalSkillsTree = vi
      .fn()
      .mockResolvedValueOnce({
        root,
        items: [
          {
            name: "layout-review",
            path: oldDirectoryPath,
            kind: "directory",
            children: [
              {
                name: "SKILL.md",
                path: oldFilePath,
                kind: "file",
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        root,
        items: [
          {
            name: "layout-audit",
            path: nextDirectoryPath,
            kind: "directory",
            children: [
              {
                name: "SKILL.md",
                path: nextFilePath,
                kind: "file",
              },
            ],
          },
        ],
      })
    window.desktop!.readGlobalSkillFile = vi
      .fn()
      .mockResolvedValueOnce({
        path: oldFilePath,
        content: oldContent,
      })
      .mockResolvedValueOnce({
        path: nextFilePath,
        content: nextContent,
      })
    window.desktop!.renameGlobalSkill = vi.fn().mockResolvedValue({
      previousDirectory: oldDirectoryPath,
      directory: nextDirectoryPath,
      filePath: nextFilePath,
    })

    render(<App />)

    openActivityRailConfigurationView("Open skills")

    const oldDirectoryButton = await screen.findByRole("button", { name: "layout-review" })
    fireEvent.doubleClick(oldDirectoryButton)
    expect(screen.queryByRole("textbox", { name: "Rename global skill layout-review" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Actions for layout-review" }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }))

    const renameInput = await screen.findByRole("textbox", { name: "Rename global skill layout-review" })
    fireEvent.change(renameInput, { target: { value: "layout-audit" } })
    fireEvent.keyDown(renameInput, { key: "Enter" })

    await waitFor(() => {
      expect(window.desktop!.renameGlobalSkill).toHaveBeenCalledWith({
        directory: oldDirectoryPath,
        name: "layout-audit",
      })
    })

    await screen.findByRole("button", { name: "layout-audit" })
    expect(screen.queryByRole("textbox", { name: "Rename global skill layout-review" })).not.toBeInTheDocument()
    expect(await openLocalSkillEditor()).toHaveValue(nextContent)
  })

  it("routes window control clicks through the desktop bridge", () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Minimize window" }))
    fireEvent.click(screen.getByRole("button", { name: "Maximize window" }))
    fireEvent.click(screen.getByRole("button", { name: "Close window" }))

    expect(window.desktop!.windowAction).toHaveBeenNthCalledWith(1, "minimize")
    expect(window.desktop!.windowAction).toHaveBeenNthCalledWith(2, "toggle-maximize")
    expect(window.desktop!.windowAction).toHaveBeenNthCalledWith(3, "close")
  })

  it("opens the git quick menu and triggers commit and push for the active workspace", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitCommit = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      stdout: "",
      stderr: "",
      summary: "Committed to main.",
    })
    window.desktop!.gitPush = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      stdout: "",
      stderr: "",
      summary: "Pushed main.",
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.listFolderWorkspaces).toHaveBeenCalledTimes(1)
    })
    await screen.findByRole("button", { name: "Atlas review" })
    await waitFor(() => {
      expect(window.desktop!.gitGetCapabilities).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
      })
    })

    fireEvent.click(await screen.findByRole("button", { name: "Git" }))
    let gitQuickMenu = await screen.findByRole("dialog", { name: "Git quick menu" })
    fireEvent.click(within(gitQuickMenu).getByRole("button", { name: /Changes/i }))

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    expect(await within(inspector).findByRole("tab", { name: /Review/ })).toBeInTheDocument()
    await waitFor(() => {
      expect(window.desktop!.getSessionDiff).toHaveBeenCalledWith({
        sessionID: "session-atlas-review",
      })
    })

    fireEvent.click(await screen.findByRole("button", { name: "Git" }))
    gitQuickMenu = await screen.findByRole("dialog", { name: "Git quick menu" })
    fireEvent.click(within(gitQuickMenu).getByRole("button", { name: "Commit or push" }))

    const commitPanel = await screen.findByRole("dialog", { name: "Commit or push" })
    expect(within(commitPanel).getByRole("textbox", { name: "Commit message" })).toBeInTheDocument()

    fireEvent.change(within(commitPanel).getByRole("textbox", { name: "Commit message" }), {
      target: {
        value: "chore: wire git quick menu",
      },
    })

    fireEvent.click(within(commitPanel).getByRole("button", { name: "Commit" }))

    await waitFor(() => {
      expect(window.desktop!.gitCommit).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
        message: "chore: wire git quick menu",
        stageAll: true,
      })
    })
    expect(window.desktop!.gitGenerateCommitMessage).not.toHaveBeenCalled()

    expect(await screen.findByText("Committed to main.")).toBeInTheDocument()
    expect(within(commitPanel).getByRole("textbox", { name: "Commit message" })).toBeInTheDocument()

    fireEvent.click(within(commitPanel).getByRole("button", { name: "Push" }))

    await waitFor(() => {
      expect(window.desktop!.gitPush).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
      })
    })

    expect(await screen.findByText("Pushed main.")).toBeInTheDocument()
  })

  it("runs stage all and commit from the git quick menu", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: {
        enabled: false,
        reason: "Stage changes before committing.",
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest: {
        enabled: false,
        reason: "Switch to a feature branch before creating a pull request.",
      },
      canCreateBranch: {
        enabled: true,
      },
    })

    render(<App />)

    await screen.findByRole("button", { name: "Atlas review" })

    fireEvent.click(await screen.findByRole("button", { name: "Git" }))
    fireEvent.click(screen.getByRole("button", { name: "Commit or push" }))

    const commitPanel = await screen.findByRole("dialog", { name: "Commit or push" })
    fireEvent.change(within(commitPanel).getByRole("textbox", { name: "Commit message" }), {
      target: {
        value: "chore: stage all from quick menu",
      },
    })

    fireEvent.click(within(commitPanel).getByRole("button", { name: "Commit" }))

    await waitFor(() => {
      expect(window.desktop!.gitCommit).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
        message: "chore: stage all from quick menu",
        stageAll: true,
      })
    })
  })

  it("auto-generates a commit message when committing with an empty message", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGenerateCommitMessage = vi.fn().mockResolvedValue({
      message: "feat: generate commit messages",
    })
    const commitResult = createDeferred<
      Awaited<ReturnType<NonNullable<NonNullable<Window["desktop"]>["gitCommit"]>>>
    >()
    window.desktop!.gitCommit = vi.fn().mockImplementation(() => commitResult.promise)

    render(<App />)

    await screen.findByRole("button", { name: "Atlas review" })

    fireEvent.click(await screen.findByRole("button", { name: "Git" }))
    fireEvent.click(screen.getByRole("button", { name: "Commit or push" }))

    const commitPanel = await screen.findByRole("dialog", { name: "Commit or push" })
    const messageInput = within(commitPanel).getByRole("textbox", { name: "Commit message" })
    expect(messageInput).toHaveAttribute("placeholder", "Commit message (leave blank to auto-generate)")

    fireEvent.click(within(commitPanel).getByRole("button", { name: "Commit" }))

    await waitFor(() => {
      expect(window.desktop!.gitGenerateCommitMessage).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
        stageAll: true,
      })
    })
    await waitFor(() => {
      expect(window.desktop!.gitCommit).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
        message: "feat: generate commit messages",
        stageAll: true,
      })
    })
    expect(messageInput).toHaveValue("feat: generate commit messages")

    await act(async () => {
      commitResult.resolve({
        directory: "C:\\Projects\\Atlas\\client",
        root: "C:\\Projects\\Atlas",
        branch: "main",
        stdout: "",
        stderr: "",
        summary: "Committed to main.",
      })
      await commitResult.promise
    })

    expect(await screen.findByText("Committed to main.")).toBeInTheDocument()
  })

  it("auto-generates a commit message before commit and push", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGenerateCommitMessage = vi.fn().mockResolvedValue({
      message: "fix: handle empty commit messages",
    })
    window.desktop!.gitCommit = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      stdout: "",
      stderr: "",
      summary: "Committed to main.",
    })
    window.desktop!.gitPush = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      stdout: "",
      stderr: "",
      summary: "Pushed main.",
    })

    render(<App />)

    await screen.findByRole("button", { name: "Atlas review" })

    fireEvent.click(await screen.findByRole("button", { name: "Git" }))
    fireEvent.click(screen.getByRole("button", { name: "Commit or push" }))

    const commitPanel = await screen.findByRole("dialog", { name: "Commit or push" })
    fireEvent.click(within(commitPanel).getByRole("button", { name: "Commit and push" }))

    await waitFor(() => {
      expect(window.desktop!.gitGenerateCommitMessage).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
        stageAll: true,
      })
    })
    await waitFor(() => {
      expect(window.desktop!.gitCommit).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
        message: "fix: handle empty commit messages",
        stageAll: true,
      })
    })
    await waitFor(() => {
      expect(window.desktop!.gitPush).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
      })
    })

    expect(await screen.findByText("Committed to main. Pushed main.")).toBeInTheDocument()
  })

  it("does not commit when empty-message generation fails", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGenerateCommitMessage = vi.fn().mockRejectedValue(new Error("Commit message generation failed"))
    window.desktop!.gitCommit = vi.fn()

    render(<App />)

    await screen.findByRole("button", { name: "Atlas review" })

    fireEvent.click(await screen.findByRole("button", { name: "Git" }))
    fireEvent.click(screen.getByRole("button", { name: "Commit or push" }))

    const commitPanel = await screen.findByRole("dialog", { name: "Commit or push" })
    fireEvent.click(within(commitPanel).getByRole("button", { name: "Commit" }))

    expect(await screen.findByText("Commit message generation failed")).toBeInTheDocument()
    expect(window.desktop!.gitCommit).not.toHaveBeenCalled()
  })

  it("refreshes git commit availability when the quick menu opens after staged changes", async () => {
    let canCommit = false
    const getCapabilities = () => ({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: canCommit
        ? {
            enabled: true,
          }
        : {
            enabled: false,
            reason: "Stage changes before committing.",
          },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest: {
        enabled: false,
        reason: "Switch to a feature branch before creating a pull request.",
      },
      canCreateBranch: {
        enabled: true,
      },
    })

    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockImplementation(async () => getCapabilities())

    render(<App />)

    await screen.findByRole("button", { name: "Atlas review" })

    const gitGetCapabilities = window.desktop!.gitGetCapabilities as ReturnType<typeof vi.fn>
    const menuRefresh = createDeferred<ReturnType<typeof getCapabilities>>()
    const unexpectedRefresh = createDeferred<ReturnType<typeof getCapabilities>>()
    gitGetCapabilities.mockReset()
    gitGetCapabilities.mockImplementationOnce(() => menuRefresh.promise)
    gitGetCapabilities.mockImplementation(() => unexpectedRefresh.promise)

    fireEvent.click(await screen.findByRole("button", { name: "Git" }))

    const commitButton = await screen.findByRole("button", { name: "Commit or push" })
    expect(commitButton).toBeEnabled()
    fireEvent.click(commitButton)
    const commitPanel = await screen.findByRole("dialog", { name: "Commit or push" })
    fireEvent.click(within(commitPanel).getByRole("checkbox", { name: "Include unstaged changes" }))
    expect(within(commitPanel).getByRole("button", { name: "Commit" })).toBeDisabled()
    await waitFor(() => {
      expect(gitGetCapabilities).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      menuRefresh.resolve(getCapabilities())
      await menuRefresh.promise
    })

    expect(gitGetCapabilities).toHaveBeenCalledTimes(1)

    gitGetCapabilities.mockReset()
    canCommit = true
    gitGetCapabilities.mockResolvedValue(getCapabilities())

    act(() => {
      window.dispatchEvent(new Event("focus"))
    })

    await waitFor(() => {
      expect(gitGetCapabilities).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(within(commitPanel).getByRole("button", { name: "Commit" })).toBeEnabled()
    })
  })

  it("does not poll git capabilities while the quick menu stays open", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: {
        enabled: true,
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest: {
        enabled: false,
        reason: "Switch to a feature branch before creating a pull request.",
      },
      canCreateBranch: {
        enabled: true,
      },
    })

    render(<App />)

    await screen.findByRole("button", { name: "Atlas review" })
    await screen.findByRole("button", { name: "Git" })

    const gitGetCapabilities = window.desktop!.gitGetCapabilities as ReturnType<typeof vi.fn>
    gitGetCapabilities.mockClear()

    fireEvent.click(screen.getByRole("button", { name: "Git" }))

    await waitFor(() => {
      expect(gitGetCapabilities).toHaveBeenCalledTimes(1)
    })

    vi.useFakeTimers()
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
    } finally {
      vi.useRealTimers()
    }

    expect(gitGetCapabilities).toHaveBeenCalledTimes(1)
  })

  it("keeps git quick menu diff stats visible when opening action panels", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: {
        enabled: true,
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest: {
        enabled: false,
        reason: "Switch to a feature branch before creating a pull request.",
      },
      canCreateBranch: {
        enabled: true,
      },
    })
    window.desktop!.getSessionDiff = vi.fn().mockImplementation(async ({ scope }: { scope?: string }) => {
      if (scope === "git:unstaged") {
        return {
          stats: {
            files: 1,
            additions: 33,
            deletions: 0,
          },
          diffs: [
            {
              file: "src/App.tsx",
              additions: 33,
              deletions: 0,
            },
          ],
        }
      }

      return {
        stats: {
          files: 0,
          additions: 0,
          deletions: 0,
        },
        diffs: [],
      }
    })

    render(<App />)

    await screen.findByRole("button", { name: "Atlas review" })
    fireEvent.click(await screen.findByRole("button", { name: "Git" }))

    const gitQuickMenu = await screen.findByRole("dialog", { name: "Git quick menu" })
    await within(gitQuickMenu).findByLabelText("33 additions, 0 deletions")

    const getSessionDiff = window.desktop!.getSessionDiff as ReturnType<typeof vi.fn>
    await waitFor(() => {
      expect(getSessionDiff.mock.calls.some(([input]) => input?.scope === "git:unstaged")).toBe(true)
      expect(getSessionDiff.mock.calls.some(([input]) => input?.scope === "git:staged")).toBe(true)
    })
    await act(async () => {
      await Promise.resolve()
    })
    getSessionDiff.mockClear()

    fireEvent.click(within(gitQuickMenu).getByRole("button", { name: "Commit or push" }))
    const commitPanel = await screen.findByRole("dialog", { name: "Commit or push" })

    expect(within(gitQuickMenu).getAllByLabelText("33 additions, 0 deletions").length).toBeGreaterThanOrEqual(2)
    expect(within(commitPanel).getByLabelText("33 additions, 0 deletions")).toBeInTheDocument()
    expect(within(gitQuickMenu).queryByText("...")).not.toBeInTheDocument()

    await act(async () => {
      await Promise.resolve()
    })
    expect(getSessionDiff).not.toHaveBeenCalled()
  })

  it("shares a git capability request between the quick menu and branch switcher", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: {
        enabled: true,
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest: {
        enabled: false,
        reason: "Switch to a feature branch before creating a pull request.",
      },
      canCreateBranch: {
        enabled: true,
      },
    })

    render(<App />)

    await screen.findByRole("button", { name: "Git" })
    const utilityBar = document.querySelector(".composer-utility-bar") as HTMLElement
    expect(utilityBar).not.toBeNull()
    expect(within(utilityBar).getByRole("button", { name: "main" })).toBeInTheDocument()
    expect(window.desktop!.gitGetCapabilities).toHaveBeenCalledTimes(1)
  })

  it("checks pull request remote state only when the pull request action runs", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockImplementation(async (input: { includePullRequestRemoteCheck?: boolean }) => ({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "feature/git-menu",
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: {
        enabled: true,
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest: input.includePullRequestRemoteCheck
        ? {
            enabled: true,
          }
        : {
            enabled: true,
          },
      canCreateBranch: {
        enabled: true,
      },
    }))

    render(<App />)

    await screen.findByRole("button", { name: "Git" })
    const gitGetCapabilities = window.desktop!.gitGetCapabilities as ReturnType<typeof vi.fn>
    expect(gitGetCapabilities).not.toHaveBeenCalledWith(expect.objectContaining({
      includePullRequestRemoteCheck: true,
    }))

    fireEvent.click(screen.getByRole("button", { name: "Git" }))
    const gitQuickMenu = await screen.findByRole("dialog", { name: "Git quick menu" })
    fireEvent.click(within(gitQuickMenu).getByRole("button", { name: /Create pull request/i }))

    await waitFor(() => {
      expect(gitGetCapabilities).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
        includePullRequestRemoteCheck: true,
      })
    })
    await waitFor(() => {
      expect(window.desktop!.gitCreatePullRequest).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
      })
    })
  })

  it("keeps the existing workspace while git capabilities load for a stable project id", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "prj_atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "prj_atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockImplementation(
      async () => ({
        directory: "C:\\Projects\\Atlas\\client",
        root: "C:\\Projects\\Atlas",
        branch: "main",
        defaultBranch: "main",
        isGitRepo: true,
        canCommit: {
          enabled: true,
        },
        canStageAllCommit: {
          enabled: true,
        },
        canPush: {
          enabled: true,
        },
        canCreatePullRequest: {
          enabled: false,
          reason: "Switch to a feature branch before creating a pull request.",
        },
        canCreateBranch: {
          enabled: true,
        },
      }),
    )

    render(<App />)

    expect(await screen.findByText("C:\\Projects\\Atlas")).toBeInTheDocument()

    await waitFor(() => {
      expect(window.desktop!.gitGetCapabilities).toHaveBeenCalledWith({
        projectID: "prj_atlas",
        directory: "C:\\Projects\\Atlas\\client",
      })
    })

    expect(window.desktop!.openFolderWorkspace).not.toHaveBeenCalled()
  })

  it("refreshes git state without reopening the workspace for index-only watcher events", async () => {
    const workspace: LoadedFolderWorkspace = {
      id: "C:\\Projects\\Atlas\\client",
      directory: "C:\\Projects\\Atlas\\client",
      name: "client",
      created: 1,
      updated: 20,
      project: {
        id: "prj_atlas",
        name: "Atlas",
        worktree: "C:\\Projects\\Atlas",
      },
      sessions: [
        {
          id: "session-atlas-review",
          projectID: "prj_atlas",
          directory: "C:\\Projects\\Atlas\\client",
          title: "Atlas review",
          created: 18,
          updated: 20,
        },
      ],
    }
    let workspaceFileChangeListener: ((event: { directory: string; paths: string[] }) => void) | null = null
    window.desktop!.onWorkspaceFileChange = vi.fn((listener) => {
      workspaceFileChangeListener = listener
      return vi.fn(() => {
        workspaceFileChangeListener = null
      })
    })
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([workspace])
    window.desktop!.openFolderWorkspace = vi.fn().mockResolvedValue(workspace)
    window.desktop!.gitGetCapabilities = vi.fn().mockResolvedValue({
      directory: workspace.directory,
      root: "C:\\Projects\\Atlas",
      branch: "main",
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: {
        enabled: true,
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest: {
        enabled: false,
        reason: "Switch to a feature branch before creating a pull request.",
      },
      canCreateBranch: {
        enabled: true,
      },
    })

    render(<App />)

    await screen.findByRole("button", { name: "Atlas review" })

    const gitGetCapabilities = window.desktop!.gitGetCapabilities as ReturnType<typeof vi.fn>
    const gitListBranches = window.desktop!.gitListBranches as ReturnType<typeof vi.fn>
    const openFolderWorkspace = window.desktop!.openFolderWorkspace as ReturnType<typeof vi.fn>
    const getSessionDiff = window.desktop!.getSessionDiff as ReturnType<typeof vi.fn>
    gitGetCapabilities.mockClear()
    gitListBranches.mockClear()
    openFolderWorkspace.mockClear()
    getSessionDiff.mockClear()

    act(() => {
      workspaceFileChangeListener?.({
        directory: workspace.directory,
        paths: ["C:\\Projects\\Atlas\\client\\.git\\index"],
      })
    })

    await waitFor(() => {
      expect(gitGetCapabilities).toHaveBeenCalled()
    })
    expect(openFolderWorkspace).not.toHaveBeenCalled()
    expect(getSessionDiff).not.toHaveBeenCalled()
    expect(gitListBranches).not.toHaveBeenCalled()
  })

  it("reopens the workspace when watcher events indicate repository structure changed", async () => {
    const workspace: LoadedFolderWorkspace = {
      id: "C:\\Projects\\Atlas\\client",
      directory: "C:\\Projects\\Atlas\\client",
      name: "client",
      created: 1,
      updated: 20,
      project: {
        id: "prj_atlas",
        name: "Atlas",
        worktree: "C:\\Projects\\Atlas",
      },
      sessions: [
        {
          id: "session-atlas-review",
          projectID: "prj_atlas",
          directory: "C:\\Projects\\Atlas\\client",
          title: "Atlas review",
          created: 18,
          updated: 20,
        },
      ],
    }
    let workspaceFileChangeListener: ((event: { directory: string; paths: string[] }) => void) | null = null
    window.desktop!.onWorkspaceFileChange = vi.fn((listener) => {
      workspaceFileChangeListener = listener
      return vi.fn(() => {
        workspaceFileChangeListener = null
      })
    })
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([workspace])
    window.desktop!.openFolderWorkspace = vi.fn().mockResolvedValue(workspace)
    window.desktop!.gitGetCapabilities = vi.fn().mockResolvedValue({
      directory: workspace.directory,
      root: "C:\\Projects\\Atlas",
      branch: "main",
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: {
        enabled: true,
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest: {
        enabled: false,
        reason: "Switch to a feature branch before creating a pull request.",
      },
      canCreateBranch: {
        enabled: true,
      },
    })

    render(<App />)

    await screen.findByRole("button", { name: "Atlas review" })

    const openFolderWorkspace = window.desktop!.openFolderWorkspace as ReturnType<typeof vi.fn>
    openFolderWorkspace.mockClear()

    act(() => {
      workspaceFileChangeListener?.({
        directory: workspace.directory,
        paths: ["C:\\Projects\\Atlas\\client\\.git\\config"],
      })
    })

    await waitFor(() => {
      expect(openFolderWorkspace).toHaveBeenCalledWith({
        directory: workspace.directory,
      })
    })
  })

  it("refreshes the desktop workspace when the mobile bridge reports a created session", async () => {
    const workspace: LoadedFolderWorkspace = {
      id: "C:\\Projects\\Atlas\\client",
      directory: "C:\\Projects\\Atlas\\client",
      name: "client",
      created: 1,
      updated: 20,
      project: {
        id: "prj_atlas",
        name: "Atlas",
        worktree: "C:\\Projects\\Atlas",
      },
      sessions: [
        {
          id: "session-atlas-review",
          projectID: "prj_atlas",
          directory: "C:\\Projects\\Atlas\\client",
          title: "Atlas review",
          created: 18,
          updated: 20,
        },
      ],
    }
    const updatedWorkspace: LoadedFolderWorkspace = {
      ...workspace,
      updated: 30,
      sessions: [
        {
          id: "session-mobile-new",
          projectID: "prj_atlas",
          directory: "C:\\Projects\\Atlas\\client",
          title: "Mobile Chat",
          created: 30,
          updated: 30,
        },
        ...workspace.sessions,
      ],
    }
    let mobileBridgeListener: ((event: MobileBridgeDesktopEvent) => void) | null = null
    window.desktop!.onMobileBridgeEvent = vi.fn((listener) => {
      mobileBridgeListener = listener
      return vi.fn(() => {
        mobileBridgeListener = null
      })
    })
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([workspace])
    window.desktop!.openFolderWorkspace = vi.fn().mockResolvedValue(updatedWorkspace)

    render(<App />)

    await screen.findByRole("button", { name: "Atlas review" })

    const openFolderWorkspace = window.desktop!.openFolderWorkspace as ReturnType<typeof vi.fn>
    openFolderWorkspace.mockClear()

    act(() => {
      mobileBridgeListener?.({
        type: "session.created",
        source: "mobile",
        generatedAt: Date.now(),
        workspaceID: workspace.id,
        directory: workspace.directory,
        sessionID: "session-mobile-new",
      })
    })

    expect(await screen.findByRole("button", { name: "Mobile Chat" })).toBeInTheDocument()
    expect(openFolderWorkspace).toHaveBeenCalledWith({
      directory: workspace.directory,
    })
  })

  it("refreshes the workspace diff when files change under the active session directory", async () => {
    const workspace: LoadedFolderWorkspace = {
      id: "C:\\Projects\\Atlas\\client",
      directory: "C:\\Projects\\Atlas\\client",
      name: "client",
      created: 1,
      updated: 20,
      project: {
        id: "prj_atlas",
        name: "Atlas",
        worktree: "C:\\Projects\\Atlas",
      },
      sessions: [
        {
          id: "session-atlas-review",
          projectID: "prj_atlas",
          directory: "C:\\Projects\\Atlas\\client",
          title: "Atlas review",
          created: 18,
          updated: 20,
        },
      ],
    }
    let workspaceFileChangeListener: ((event: { directory: string; paths: string[] }) => void) | null = null
    let diffRequestCount = 0
    const changedDiff = {
      title: "1 file change (+3 -1)",
      stats: {
        files: 1,
        additions: 3,
        deletions: 1,
      },
      diffs: [
        {
          file: "src/App.tsx",
          additions: 3,
          deletions: 1,
          patch: [
            "diff --git a/src/App.tsx b/src/App.tsx",
            "index 1111111..2222222 100644",
            "--- a/src/App.tsx",
            "+++ b/src/App.tsx",
            "@@ -1,2 +1,3 @@",
            " import { AppShell } from './shell'",
            "+import { WorkspaceDiff } from './WorkspaceDiff'",
            " export function App() {",
          ].join("\n"),
        },
      ],
    }

    window.desktop!.onWorkspaceFileChange = vi.fn((listener) => {
      workspaceFileChangeListener = listener
      return vi.fn(() => {
        workspaceFileChangeListener = null
      })
    })
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([workspace])
    window.desktop!.getSessionDiff = vi.fn().mockImplementation(async () => {
      diffRequestCount += 1
      return diffRequestCount === 1 ? { diffs: [] } : changedDiff
    })

    render(<App />)

    await screen.findByRole("button", { name: "Atlas review" })
    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    fireEvent.click(within(inspector).getByRole("button", { name: /^Review/ }))
    await waitFor(() => {
      expect(window.desktop!.getSessionDiff).toHaveBeenCalledWith({
        sessionID: "session-atlas-review",
      })
    })
    expect(within(inspector).getByText("No changes in this session.")).toBeInTheDocument()

    vi.useFakeTimers()
    try {
      act(() => {
        workspaceFileChangeListener?.({
          directory: workspace.directory,
          paths: ["C:\\Projects\\Atlas\\client\\src\\App.tsx"],
        })
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
    } finally {
      vi.useRealTimers()
    }

    await waitFor(() => {
      expect(window.desktop!.getSessionDiff).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByText("src/App.tsx")).toBeInTheDocument()
  })

  it("shows the current git branch in the composer utility bar and switches branches from the list", async () => {
    let currentBranch = "main"
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockImplementation(async () => ({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: currentBranch,
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: {
        enabled: true,
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest:
        currentBranch === "main"
          ? {
              enabled: false,
              reason: "Switch to a feature branch before creating a pull request.",
            }
          : {
              enabled: true,
            },
      canCreateBranch: {
        enabled: true,
      },
    }))
    window.desktop!.gitListBranches = vi.fn().mockImplementation(async () => [
      {
        name: "main",
        kind: "local",
        current: currentBranch === "main",
      },
      {
        name: "feature/ui-pass",
        kind: "local",
        current: currentBranch === "feature/ui-pass",
      },
      {
        name: "origin/release/hotfix",
        kind: "remote",
        current: false,
      },
    ])
    window.desktop!.gitCheckoutBranch = vi.fn().mockImplementation(async ({ name }: { name: string }) => {
      currentBranch = name === "origin/release/hotfix" ? "release/hotfix" : name

      return {
        directory: "C:\\Projects\\Atlas\\client",
        root: "C:\\Projects\\Atlas",
        branch: currentBranch,
        stdout: "",
        stderr: "",
        summary: `Switched to ${currentBranch}.`,
      }
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.gitGetCapabilities).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
      })
    })

    const utilityBar = document.querySelector(".composer-utility-bar") as HTMLElement
    expect(utilityBar).not.toBeNull()

    fireEvent.click(within(utilityBar).getByRole("button", { name: "main" }))

    const branchSwitcher = await screen.findByRole("dialog", { name: "Git branch switcher" })
    expect(within(branchSwitcher).getByRole("button", { name: /feature\/ui-pass/ })).toBeInTheDocument()
    expect(within(branchSwitcher).getByRole("button", { name: /origin\/release\/hotfix/ })).toBeInTheDocument()

    fireEvent.click(within(branchSwitcher).getByRole("button", { name: /feature\/ui-pass/ }))

    await waitFor(() => {
      expect(window.desktop!.gitCheckoutBranch).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
        name: "feature/ui-pass",
      })
    })

    await waitFor(() => {
      expect(within(utilityBar).getByRole("button", { name: "feature/ui-pass" })).toBeInTheDocument()
    })
  })

  it.skip("opens the create-and-checkout branch dialog from the composer utility bar", async () => {
    let currentBranch = "main"
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockImplementation(async () => ({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: currentBranch,
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: {
        enabled: true,
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest:
        currentBranch === "main"
          ? {
              enabled: false,
              reason: "Switch to a feature branch before creating a pull request.",
            }
          : {
              enabled: true,
            },
      canCreateBranch: {
        enabled: true,
      },
    }))
    window.desktop!.gitListBranches = vi.fn().mockImplementation(async () => [
      {
        name: "main",
        kind: "local",
        current: currentBranch === "main",
      },
      {
        name: "feature/test",
        kind: "local",
        current: currentBranch === "feature/test",
      },
    ])
    window.desktop!.gitCreateBranch = vi.fn().mockImplementation(async ({ name }: { name: string }) => {
      currentBranch = name

      return {
        directory: "C:\\Projects\\Atlas\\client",
        root: "C:\\Projects\\Atlas",
        branch: currentBranch,
        stdout: "",
        stderr: "",
        summary: `Created and switched to ${currentBranch}.`,
      }
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.gitGetCapabilities).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
      })
    })

    const utilityBar = document.querySelector(".composer-utility-bar") as HTMLElement
    expect(utilityBar).not.toBeNull()

    fireEvent.click(within(utilityBar).getByRole("button", { name: "main" }))

    const branchSwitcher = await screen.findByRole("dialog", { name: "Git branch switcher" })
    fireEvent.click(within(branchSwitcher).getByRole("button", { name: "创建并检出新分支" }))

    const createDialog = await screen.findByRole("dialog", { name: "Create and checkout branch" })
    expect(within(createDialog).getByRole("button", { name: "取消" })).toBeInTheDocument()
    expect(within(createDialog).getByRole("button", { name: "创建并检出" })).toBeInTheDocument()

    fireEvent.change(within(createDialog).getByRole("textbox", { name: "分支名称" }), {
      target: {
        value: "feature/new-flow",
      },
    })
    fireEvent.click(within(createDialog).getByRole("button", { name: "创建并检出" }))

    await waitFor(() => {
      expect(window.desktop!.gitCreateBranch).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
        name: "feature/new-flow",
      })
    })

    await waitFor(() => {
      expect(within(utilityBar).getByRole("button", { name: "feature/new-flow" })).toBeInTheDocument()
    })
  })

  it("opens the create-and-checkout branch dialog from the composer utility bar with the current branch labels", async () => {
    let currentBranch = "main"
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockImplementation(async () => ({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: currentBranch,
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: {
        enabled: true,
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest:
        currentBranch === "main"
          ? {
              enabled: false,
              reason: "Switch to a feature branch before creating a pull request.",
            }
          : {
              enabled: true,
            },
      canCreateBranch: {
        enabled: true,
      },
    }))
    window.desktop!.gitListBranches = vi.fn().mockImplementation(async () => [
      {
        name: "main",
        kind: "local",
        current: currentBranch === "main",
      },
      {
        name: "feature/test",
        kind: "local",
        current: currentBranch === "feature/test",
      },
    ])
    window.desktop!.gitCreateBranch = vi.fn().mockImplementation(async ({ name }: { name: string }) => {
      currentBranch = name

      return {
        directory: "C:\\Projects\\Atlas\\client",
        root: "C:\\Projects\\Atlas",
        branch: currentBranch,
        stdout: "",
        stderr: "",
        summary: `Created and switched to ${currentBranch}.`,
      }
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.gitGetCapabilities).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
      })
    })

    const utilityBar = document.querySelector(".composer-utility-bar") as HTMLElement
    expect(utilityBar).not.toBeNull()

    fireEvent.click(within(utilityBar).getByRole("button", { name: "main" }))

    const branchSwitcher = await screen.findByRole("dialog", { name: "Git branch switcher" })
    fireEvent.click(within(branchSwitcher).getByRole("button", { name: "Create and switch branch" }))

    const createDialog = await screen.findByRole("dialog", { name: "Create and checkout branch" })
    expect(within(createDialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument()
    expect(within(createDialog).getByRole("button", { name: "Create and switch" })).toBeInTheDocument()

    fireEvent.change(within(createDialog).getByRole("textbox", { name: "Branch name" }), {
      target: {
        value: "feature/new-flow",
      },
    })
    fireEvent.click(within(createDialog).getByRole("button", { name: "Create and switch" }))

    await waitFor(() => {
      expect(window.desktop!.gitCreateBranch).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
        name: "feature/new-flow",
      })
    })

    await waitFor(() => {
      expect(within(utilityBar).getByRole("button", { name: "feature/new-flow" })).toBeInTheDocument()
    })
  })

  it("keeps the branch switcher list in sync after creating a branch from the top git menu", async () => {
    let currentBranch = "main"
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockImplementation(async () => ({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: currentBranch,
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: {
        enabled: true,
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest:
        currentBranch === "main"
          ? {
              enabled: false,
              reason: "Switch to a feature branch before creating a pull request.",
            }
          : {
              enabled: true,
            },
      canCreateBranch: {
        enabled: true,
      },
    }))
    window.desktop!.gitListBranches = vi.fn().mockImplementation(async () => {
      const branches = [
        {
          name: "main",
          kind: "local" as const,
          current: currentBranch === "main",
        },
      ]

      if (currentBranch !== "main") {
        branches.push({
          name: currentBranch,
          kind: "local" as const,
          current: true,
        })
      }

      return branches
    })
    window.desktop!.gitCreateBranch = vi.fn().mockImplementation(async ({ name }: { name: string }) => {
      currentBranch = name

      return {
        directory: "C:\\Projects\\Atlas\\client",
        root: "C:\\Projects\\Atlas",
        branch: currentBranch,
        stdout: "",
        stderr: "",
        summary: `Created and switched to ${currentBranch}.`,
      }
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.gitGetCapabilities).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
      })
    })

    fireEvent.click(await screen.findByRole("button", { name: "Git" }))

    const gitQuickMenu = await screen.findByRole("dialog", { name: "Git quick menu" })
    fireEvent.click(within(gitQuickMenu).getByRole("button", { name: currentBranch }))
    const branchesPanel = await screen.findByRole("dialog", { name: "Git branches" })
    fireEvent.click(within(branchesPanel).getByRole("button", { name: "Create and checkout new branch" }))
    fireEvent.change(within(branchesPanel).getByRole("textbox", { name: "Branch name" }), {
      target: {
        value: "feature/top-menu-sync",
      },
    })
    fireEvent.click(within(branchesPanel).getByRole("button", { name: "Create branch" }))

    await waitFor(() => {
      expect(window.desktop!.gitCreateBranch).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
        name: "feature/top-menu-sync",
      })
    })

    await waitFor(() => {
      expect(window.desktop!.gitListBranches).toHaveBeenCalled()
    })

    const utilityBar = document.querySelector(".composer-utility-bar") as HTMLElement
    expect(utilityBar).not.toBeNull()

    await waitFor(() => {
      expect(within(utilityBar).getByRole("button", { name: "feature/top-menu-sync" })).toBeInTheDocument()
    })

    fireEvent.click(within(utilityBar).getByRole("button", { name: "feature/top-menu-sync" }))

    const branchSwitcher = await screen.findByRole("dialog", { name: "Git branch switcher" })
    expect(within(branchSwitcher).getByRole("button", { name: /feature\/top-menu-sync/ })).toBeInTheDocument()
  })

  it("hides the git button when the active workspace is not a git repository", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Plain\\client",
        directory: "C:\\Projects\\Plain\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-plain",
          name: "Plain",
          worktree: "C:\\Projects\\Plain",
        },
        sessions: [
          {
            id: "session-plain-review",
            projectID: "project-plain",
            directory: "C:\\Projects\\Plain\\client",
            title: "Plain review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Plain\\client",
      root: null,
      branch: null,
      defaultBranch: null,
      isGitRepo: false,
      canCommit: {
        enabled: false,
        reason: "Not a git repository.",
      },
      canStageAllCommit: {
        enabled: false,
        reason: "Not a git repository.",
      },
      canPush: {
        enabled: false,
        reason: "Not a git repository.",
      },
      canCreatePullRequest: {
        enabled: false,
        reason: "Not a git repository.",
      },
      canCreateBranch: {
        enabled: false,
        reason: "Not a git repository.",
      },
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.gitGetCapabilities).toHaveBeenCalledWith({
        projectID: "project-plain",
        directory: "C:\\Projects\\Plain\\client",
      })
    })

    expect(screen.queryByRole("button", { name: "Git" })).not.toBeInTheDocument()
    expect(document.querySelector(".composer-utility-git-branch-button")).toBeNull()
  })

  it("disables branch creation in the git quick menu before the first commit", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.gitGetCapabilities = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      defaultBranch: null,
      isGitRepo: true,
      canCommit: {
        enabled: false,
        reason: "Stage changes before committing.",
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: false,
        reason: "Create the first commit before pushing this branch.",
      },
      canCreatePullRequest: {
        enabled: false,
        reason: "Create the first commit before opening a pull request.",
      },
      canCreateBranch: {
        enabled: false,
        reason: "Create the first commit before creating a branch.",
      },
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.gitGetCapabilities).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
      })
    })

    fireEvent.click(await screen.findByRole("button", { name: "Git" }))

    const gitQuickMenu = await screen.findByRole("dialog", { name: "Git quick menu" })
    fireEvent.click(within(gitQuickMenu).getByRole("button", { name: "main" }))
    const branchesPanel = await screen.findByRole("dialog", { name: "Git branches" })
    const createBranchButton = within(branchesPanel).getByRole("button", { name: "Create and checkout new branch" })

    expect(createBranchButton).toBeDisabled()
    expect(createBranchButton).toHaveAttribute("title", "Create the first commit before creating a branch.")
    expect(createBranchButton).not.toHaveTextContent("Create the first commit before creating a branch.")
    expect(within(gitQuickMenu).getByText("Current branch: main")).toBeInTheDocument()
  })

  it("loads folder and session lists into the sidebar on startup", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
        ],
      },
      {
        id: "C:\\Projects\\Beacon\\server",
        directory: "C:\\Projects\\Beacon\\server",
        name: "server",
        created: 2,
        updated: 5,
        project: {
          id: "project-beacon",
          name: "Beacon",
          worktree: "C:\\Projects\\Beacon",
        },
        sessions: [
          {
            id: "session-beacon-ship",
            projectID: "project-beacon",
            directory: "C:\\Projects\\Beacon\\server",
            title: "Beacon ship",
            created: 3,
            updated: 5,
          },
        ],
      },
    ])

    render(<App />)

    expect(screen.queryByRole("button", { name: "app" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Chat 1" })).not.toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "client" })).toBeInTheDocument()
    expect(screen.getAllByText("C:\\Projects\\Atlas").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "Atlas review" })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "app" })).not.toBeInTheDocument()
    })
    expect(window.desktop!.listFolderWorkspaces).toHaveBeenCalledTimes(1)
  })

  it("marks missing startup folders as deleted and skips watching them", async () => {
    window.desktop!.updateWorkspaceWatchDirectories = vi.fn().mockResolvedValue({
      directories: ["C:\\Projects\\Atlas\\client"],
    })
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Ghost\\client",
        directory: "C:\\Projects\\Ghost\\client",
        name: "ghost-client",
        exists: false,
        created: 1,
        updated: 30,
        project: {
          id: "project-ghost",
          name: "Ghost",
          worktree: "C:\\Projects\\Ghost",
        },
        sessions: [
          {
            id: "session-ghost-review",
            projectID: "project-ghost",
            directory: "C:\\Projects\\Ghost\\client",
            title: "Ghost review",
            created: 10,
            updated: 30,
          },
        ],
      },
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        exists: true,
        created: 2,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 3,
            updated: 20,
          },
        ],
      },
    ])

    render(<App />)

    expect(await screen.findByText("已删除")).toBeInTheDocument()
    expect(screen.getAllByText("C:\\Projects\\Ghost").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "Create session for ghost-client" })).toBeDisabled()
    await waitFor(() => {
      expect(window.desktop!.updateWorkspaceWatchDirectories).toHaveBeenCalledWith({
        directories: ["C:\\Projects\\Atlas\\client"],
      })
    })
  })

  it("rebuilds the active session history from the server after startup", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-1",
          sessionID: "session-atlas-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-1", type: "text", text: "Recover the server session" }],
      },
      {
        info: {
          id: "msg-assistant-1",
          sessionID: "session-atlas-review",
          role: "assistant",
          created: 101,
        },
        parts: [{ id: "part-text-1", type: "text", text: "History restored from backend" }],
      },
    ])

    render(<App />)

    expect(await screen.findByText("Recover the server session")).toBeInTheDocument()
    expect(screen.getByText("History restored from backend")).toBeInTheDocument()
    expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
      backendSessionID: "session-atlas-review",
    })
  })

  it("loads session diff summaries into the inspector and renders patch trace items from history", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-1",
          sessionID: "session-atlas-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-1", type: "text", text: "Ship the toolbar update" }],
      },
      {
        info: {
          id: "msg-assistant-1",
          sessionID: "session-atlas-review",
          role: "assistant",
          created: 101,
          diffSummary: {
            stats: {
              files: 2,
              additions: 8,
              deletions: 3,
            },
            diffs: [
              {
                file: "src/App.tsx",
                additions: 5,
                deletions: 1,
              },
              {
                file: "src/styles.css",
                additions: 3,
                deletions: 2,
              },
            ],
          },
        },
        parts: [
          {
            id: "part-patch-1",
            type: "patch",
            hash: "snapshot-2",
            files: ["src/App.tsx", "src/styles.css"],
            summary: {
              files: 2,
              additions: 8,
              deletions: 3,
            },
            changes: [
              {
                file: "src/App.tsx",
                additions: 5,
                deletions: 1,
              },
              {
                file: "src/styles.css",
                additions: 3,
                deletions: 2,
              },
            ],
          },
        ],
      },
    ])
    window.desktop!.getSessionDiff = vi.fn().mockResolvedValue({
      title: "2 file changes (+8 -3)",
      stats: {
        files: 2,
        additions: 8,
        deletions: 3,
      },
      diffs: [
        {
          file: "src/App.tsx",
          additions: 5,
          deletions: 1,
          patch: [
            "diff --git a/src/App.tsx b/src/App.tsx",
            "index 1111111..2222222 100644",
            "--- a/src/App.tsx",
            "+++ b/src/App.tsx",
            "@@ -1,2 +1,2 @@",
            '-import { OldToolbar } from "./toolbar"',
            '+import { NewToolbar } from "./toolbar"',
            ' export function App() {',
          ].join("\n"),
        },
        {
          file: "src/styles.css",
          additions: 3,
          deletions: 2,
          patch: [
            "diff --git a/src/styles.css b/src/styles.css",
            "index 3333333..4444444 100644",
            "--- a/src/styles.css",
            "+++ b/src/styles.css",
            "@@ -12,2 +12,3 @@",
            "-.toolbar { display: flex; }",
            "+.toolbar {",
            "+  display: grid;",
            "+}",
          ].join("\n"),
        },
      ],
    })
    window.desktop!.restoreWorkspaceDiffFile = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      file: "src/App.tsx",
    })
    window.desktop!.reverseApplyWorkspaceDiffPatches = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      restored: [{ file: "src/App.tsx" }, { file: "src/styles.css" }],
      failed: [],
    })
    const confirmRestore = vi.spyOn(window, "confirm").mockReturnValue(true)

    const { container } = render(<App />)

    expect(await screen.findByText("Ship the toolbar update")).toBeInTheDocument()
    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    expect(within(inspector).queryByText("Workspace diff")).not.toBeInTheDocument()
    expect(within(inspector).queryByText("2 file changes (+8 -3)")).not.toBeInTheDocument()
    expect(within(inspector).queryByRole("searchbox", { name: "Search workspace diff files" })).not.toBeInTheDocument()
    expect(within(inspector).queryByRole("group", { name: "Workspace diff filters" })).not.toBeInTheDocument()
    expect(within(inspector).queryByRole("button", { name: "All" })).not.toBeInTheDocument()
    expect(within(inspector).queryByRole("button", { name: "Added" })).not.toBeInTheDocument()
    expect(within(inspector).queryByRole("button", { name: "Modified" })).not.toBeInTheDocument()
    expect(within(inspector).queryByRole("button", { name: "Deleted" })).not.toBeInTheDocument()
    expect(within(inspector).queryByRole("button", { name: "Renamed" })).not.toBeInTheDocument()

    fireEvent.click(within(inspector).getByRole("button", { name: /^Review/ }))
    expect(screen.getAllByText("src/App.tsx").length).toBeGreaterThan(0)
    expect(screen.getAllByText("src/styles.css").length).toBeGreaterThan(0)
    expect(within(inspector).getByText("+5")).toBeInTheDocument()
    expect(within(inspector).getByText("-1")).toBeInTheDocument()
    expect(within(inspector).getByRole("button", { name: "Restore src/App.tsx" })).toBeInTheDocument()
    expect(screen.queryByText("@@ -1,2 +1,2 @@")).not.toBeInTheDocument()
    expect(screen.queryByText("diff --git a/src/App.tsx b/src/App.tsx")).not.toBeInTheDocument()

    fireEvent.click(within(inspector).getByRole("button", { name: "src/App.tsx" }))

    expect(screen.queryByText("@@ -1,2 +1,2 @@")).not.toBeInTheDocument()
    expect(screen.getByText('import { OldToolbar } from "./toolbar"')).toBeInTheDocument()
    expect(screen.getByText('import { NewToolbar } from "./toolbar"')).toBeInTheDocument()
    expect(container.querySelectorAll(".right-sidebar-diff-row").length).toBeGreaterThan(0)
    expect(container.querySelectorAll(".right-sidebar-diff-row.is-add").length).toBeGreaterThan(0)
    expect(container.querySelectorAll(".right-sidebar-diff-row.is-remove").length).toBeGreaterThan(0)
    expect(window.desktop!.getSessionDiff).toHaveBeenCalledWith({
      sessionID: "session-atlas-review",
    })

    const getSessionDiff = window.desktop!.getSessionDiff as ReturnType<typeof vi.fn>
    const diffCallsBeforeTurnRestore = getSessionDiff.mock.calls.length
    fireEvent.click(screen.getByRole("button", { name: /撤销/i }))

    await waitFor(() => {
      expect(window.desktop!.reverseApplyWorkspaceDiffPatches).toHaveBeenCalledWith({
        directory: "C:\\Projects\\Atlas\\client",
        diffs: [
          expect.objectContaining({
            file: "src/App.tsx",
            patch: expect.stringContaining('import { NewToolbar } from "./toolbar"'),
          }),
          expect.objectContaining({
            file: "src/styles.css",
            patch: expect.stringContaining(".toolbar {"),
          }),
        ],
      })
    })
    expect(window.desktop!.restoreWorkspaceDiffFile).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(getSessionDiff.mock.calls.length).toBeGreaterThan(diffCallsBeforeTurnRestore)
    })

    const diffCallsBeforeRestore = getSessionDiff.mock.calls.length
    fireEvent.click(within(inspector).getByRole("button", { name: "Restore src/App.tsx" }))

    await waitFor(() => {
      expect(window.desktop!.restoreWorkspaceDiffFile).toHaveBeenCalledWith({
        directory: "C:\\Projects\\Atlas\\client",
        file: "src/App.tsx",
      })
    })
    await waitFor(() => {
      expect(getSessionDiff.mock.calls.length).toBeGreaterThan(diffCallsBeforeRestore)
    })
    confirmRestore.mockRestore()
  })

  it("keeps assistant process trace blocks in backend order", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-1",
          sessionID: "session-atlas-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-1", type: "text", text: "Audit the release flow" }],
      },
      {
        info: {
          id: "msg-assistant-1",
          sessionID: "session-atlas-review",
          role: "assistant",
          created: 101,
        },
        parts: [
          { id: "reasoning-1", type: "reasoning", text: "Inspecting workspace." },
          {
            id: "tool-1",
            type: "tool",
            tool: "npm test",
            state: {
              status: "completed",
              output: "ok",
            },
          },
          { id: "reasoning-2", type: "reasoning", text: "Evaluating test output." },
          {
            id: "tool-2",
            type: "tool",
            tool: "replace-text",
            state: {
              status: "completed",
              output: "README updated",
            },
          },
          {
            id: "patch-1",
            type: "patch",
            summary: {
              files: 1,
              additions: 2,
              deletions: 1,
            },
            changes: [
              {
                file: "src/App.tsx",
                additions: 2,
                deletions: 1,
              },
            ],
          },
          {
            id: "patch-2",
            type: "patch",
            summary: {
              files: 2,
              additions: 3,
              deletions: 1,
            },
            changes: [
              {
                file: "src/App.tsx",
                additions: 2,
                deletions: 1,
              },
              {
                file: "src/styles.css",
                additions: 1,
                deletions: 0,
              },
            ],
          },
          { id: "text-1", type: "text", text: "All checks passed." },
        ],
      },
    ])

    render(<App />)

    const finalResponseRow = (await screen.findByText("All checks passed.")).closest('[data-thread-row-kind="assistant-response-row"]') as HTMLElement | null

    expect(finalResponseRow).not.toBeNull()

    const threadColumn = (finalResponseRow as HTMLElement).closest(".thread-column") as HTMLElement
    const ownerMessageID = (finalResponseRow as HTMLElement).dataset.threadMessageId
    const executionSummary = within(threadColumn).getByRole("button", { name: /Expand processing details/ })
    expect(executionSummary).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(executionSummary)
    const traceRegions = Array.from(threadColumn.querySelectorAll(
      `.assistant-reasoning-row[data-thread-message-id="${ownerMessageID}"] .assistant-trace-lite, ` +
      `.assistant-tool-row[data-thread-message-id="${ownerMessageID}"] .assistant-trace-lite, ` +
      `.assistant-response-row[data-thread-message-id="${ownerMessageID}"] .assistant-section, ` +
      `.assistant-file-change-row[data-thread-message-id="${ownerMessageID}"] .assistant-section`,
    ))
    const sectionTitles = traceRegions.map((section) => section.getAttribute("aria-label"))

    expect(sectionTitles).toEqual([
      "Reasoning",
      "Tools",
      "Reasoning",
      "Tools",
      "File Changes",
      "File Changes",
      "Response",
    ])
    expect(threadColumn.querySelector(".assistant-section-header")).toBeNull()

    expect(within(traceRegions[0] as HTMLElement).getByText("Inspecting workspace.")).toBeInTheDocument()
    expect(within(traceRegions[0] as HTMLElement).queryByRole("button", { name: /npm test/i })).not.toBeInTheDocument()

    expect(within(traceRegions[1] as HTMLElement).getByRole("button", { name: /^npm test$/i })).toBeInTheDocument()
    expect(within(traceRegions[1] as HTMLElement).queryByText("Inspecting workspace.")).not.toBeInTheDocument()

    expect(within(traceRegions[2] as HTMLElement).getByText("Evaluating test output.")).toBeInTheDocument()
    expect(within(traceRegions[2] as HTMLElement).queryByRole("button", { name: /replace-text/i })).not.toBeInTheDocument()

    expect(within(traceRegions[3] as HTMLElement).getByRole("button", { name: /^replace-text$/i })).toBeInTheDocument()
    expect(within(traceRegions[3] as HTMLElement).queryByText("Evaluating test output.")).not.toBeInTheDocument()

    const firstFileChangeSummary = within(traceRegions[4] as HTMLElement).getByRole("button", { name: "已编辑 1 个文件" })
    expect(firstFileChangeSummary).toHaveAttribute("aria-expanded", "false")
    expect(within(traceRegions[4] as HTMLElement).queryByText("src/App.tsx")).not.toBeInTheDocument()

    const secondFileChangeSummary = within(traceRegions[5] as HTMLElement).getByRole("button", { name: "已编辑 2 个文件" })
    expect(secondFileChangeSummary).toHaveAttribute("aria-expanded", "false")
    expect(within(traceRegions[5] as HTMLElement).queryByText("1 file change (+2 -1)")).not.toBeInTheDocument()
    expect(within(traceRegions[5] as HTMLElement).queryByText("src/App.tsx")).not.toBeInTheDocument()
    fireEvent.click(secondFileChangeSummary)
    expect(within(traceRegions[5] as HTMLElement).getAllByText("src/App.tsx").length).toBeGreaterThan(0)
    expect(within(traceRegions[5] as HTMLElement).getByLabelText("2 additions, 1 deletions")).toBeInTheDocument()
    expect(within(traceRegions[5] as HTMLElement).getAllByText("src/styles.css").length).toBeGreaterThan(0)
    expect(within(traceRegions[5] as HTMLElement).getByLabelText("1 additions, 0 deletions")).toBeInTheDocument()
    expect(within(traceRegions[5] as HTMLElement).queryByText("All checks passed.")).not.toBeInTheDocument()

    expect(within(traceRegions[6] as HTMLElement).getByText("All checks passed.")).toBeInTheDocument()
    expect(within(traceRegions[6] as HTMLElement).queryByText("Inspecting workspace.")).not.toBeInTheDocument()
  })

  it("virtualizes large assistant trace row sets", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-long-trace",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas long trace",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-1",
          sessionID: "session-atlas-long-trace",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-1", type: "text", text: "Generate a long trace" }],
      },
      {
        info: {
          id: "msg-assistant-1",
          sessionID: "session-atlas-long-trace",
          role: "assistant",
          created: 101,
        },
        parts: [
          ...Array.from({ length: 500 }, (_, index) => ({
            id: `reasoning-${index}`,
            type: "reasoning" as const,
            text: `Trace reasoning ${index}`,
          })),
          { id: "text-1", type: "text", text: "Final answer." },
        ],
      },
    ])

    const { container } = render(<App />)

    const threadColumn = await waitFor(() => {
      const node = container.querySelector<HTMLElement>(".thread-column")
      expect(node).not.toBeNull()
      expect(node).toHaveClass("is-virtualized")
      return node!
    })

    await waitFor(() => {
      const renderedVirtualRows = threadColumn.querySelectorAll(".thread-virtual-row")
      expect(renderedVirtualRows.length).toBeGreaterThan(0)
      expect(renderedVirtualRows.length).toBeLessThan(80)
    })

    const executionSummary = screen.getByRole("button", { name: /Expand processing details/ })
    expect(executionSummary).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText("Final answer.")).toBeInTheDocument()
    expect(screen.queryByText("Trace reasoning 0")).not.toBeInTheDocument()

    fireEvent.click(executionSummary)

    await waitFor(() => {
      expect(screen.getByText("Trace reasoning 0")).toBeInTheDocument()
      expect(screen.queryByText("Final answer.")).not.toBeInTheDocument()
      expect(threadColumn.querySelectorAll(".thread-virtual-row").length).toBeLessThan(80)
    })
  })

  it("keeps folded file-change summaries scoped to their source assistant message", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-1",
          sessionID: "session-atlas-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-1", type: "text", text: "Complete the release checklist" }],
      },
      {
        info: {
          id: "msg-assistant-1",
          sessionID: "session-atlas-review",
          role: "assistant",
          created: 101,
        },
        parts: [
          { id: "reasoning-1", type: "reasoning", text: "Preparing the first change set." },
          { id: "text-1", type: "text", text: "Created the first draft of the release notes." },
          {
            id: "patch-1",
            type: "patch",
            summary: {
              files: 1,
              additions: 4,
              deletions: 0,
            },
            changes: [
              {
                file: "docs/release-notes.md",
                additions: 4,
                deletions: 0,
              },
            ],
          },
        ],
      },
      {
        info: {
          id: "msg-assistant-2",
          sessionID: "session-atlas-review",
          role: "assistant",
          created: 102,
        },
        parts: [
          { id: "reasoning-2", type: "reasoning", text: "Running the final verification pass." },
          {
            id: "tool-2",
            type: "tool",
            tool: "npm test",
            state: {
              status: "completed",
              output: "ok",
            },
          },
          { id: "text-2", type: "text", text: "Finished the cycle." },
          {
            id: "patch-2",
            type: "patch",
            summary: {
              files: 1,
              additions: 2,
              deletions: 1,
            },
            changes: [
              {
                file: "docs/release-checklist.md",
                additions: 2,
                deletions: 1,
              },
            ],
          },
        ],
      },
    ])

    render(<App />)

    const finalResponseRow = (await screen.findByText("Finished the cycle.")).closest('[data-thread-row-kind="assistant-response-row"]') as HTMLElement | null

    expect(finalResponseRow).not.toBeNull()
    expect(screen.getByText("Created the first draft of the release notes.")).toBeInTheDocument()

    const threadColumn = (finalResponseRow as HTMLElement).closest(".thread-column") as HTMLElement
    const ownerMessageID = (finalResponseRow as HTMLElement).dataset.threadMessageId

    const fileChangeRows = Array.from(threadColumn.querySelectorAll<HTMLElement>(".assistant-file-change-row"))
    expect(fileChangeRows.map((row) => row.dataset.threadMessageId)).toEqual([
      "msg-assistant-1",
      ownerMessageID,
    ])
    const fileChangeSections = fileChangeRows.map((row) =>
      row.querySelector<HTMLElement>(".assistant-section.is-file-change"),
    ).filter((section): section is HTMLElement => Boolean(section))
    expect(fileChangeSections).toHaveLength(2)

    const firstFileChangeSection = fileChangeSections[0] as HTMLElement
    const firstFileChangeSummary = within(firstFileChangeSection).getByRole("button", { name: "已编辑 1 个文件" })
    expect(firstFileChangeSummary).toHaveAttribute("aria-expanded", "false")
    expect(within(firstFileChangeSection).queryByText("docs/release-notes.md")).not.toBeInTheDocument()
    fireEvent.click(firstFileChangeSummary)
    expect(within(firstFileChangeSection).getAllByText("docs/release-notes.md").length).toBeGreaterThan(0)
    expect(within(firstFileChangeSection).getByLabelText("4 additions, 0 deletions")).toBeInTheDocument()
    expect(within(firstFileChangeSection).queryByText("docs/release-checklist.md")).not.toBeInTheDocument()

    const finalFileChangeSection = fileChangeSections[1] as HTMLElement
    const finalFileChangeSummary = within(finalFileChangeSection).getByRole("button", { name: "已编辑 1 个文件" })
    expect(finalFileChangeSummary).toHaveAttribute("aria-expanded", "false")
    expect(within(finalFileChangeSection).queryByText("docs/release-checklist.md")).not.toBeInTheDocument()
    fireEvent.click(finalFileChangeSummary)
    expect(within(finalFileChangeSection).getAllByText("docs/release-checklist.md").length).toBeGreaterThan(0)
    expect(within(finalFileChangeSection).getByLabelText("2 additions, 1 deletions")).toBeInTheDocument()
    expect(within(finalFileChangeSection).queryByText("docs/release-notes.md")).not.toBeInTheDocument()
    expect(fileChangeSections).toHaveLength(2)
  })

  it("replays detached backend turns from the session event stream", async () => {
    let sessionStreamListener: DesktopAgentSessionEventListener | undefined

    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    const detachedTurnHistory = [
      {
        info: {
          id: "msg-mobile-user-1",
          sessionID: "session-atlas-review",
          role: "user",
          created: 190,
          displayText: "Run the mobile repo config check",
        },
        parts: [
          {
            id: "part-mobile-user-1",
            type: "text",
            text: "Run the mobile repo config check",
          },
        ],
      },
      {
        info: {
          id: "msg-detached-1",
          sessionID: "session-atlas-review",
          role: "assistant",
          created: 200,
        },
        parts: [
          {
            id: "tool-detached",
            type: "tool",
            tool: "read-file",
            state: {
              status: "waiting-approval",
              title: "Read repo config",
            },
          },
        ],
      },
    ]
    window.desktop!.agentSession!.loadHistory = vi
      .fn()
      .mockResolvedValue(detachedTurnHistory)
      .mockResolvedValueOnce([])
    window.desktop!.agentSession!.loadPermissionRequests = vi.fn().mockResolvedValue([])
    window.desktop!.agentSession!.subscribe = vi.fn().mockResolvedValue({
      backendSessionID: "session-atlas-review",
    })
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      sessionStreamListener = listener
      return vi.fn()
    })

    window.desktop!.gitGetCapabilities = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      defaultBranch: "main",
      isGitRepo: true,
      canCommit: {
        enabled: true,
      },
      canStageAllCommit: {
        enabled: true,
      },
      canPush: {
        enabled: true,
      },
      canCreatePullRequest: {
        enabled: false,
        reason: "Switch to a feature branch before creating a pull request.",
      },
      canCreateBranch: {
        enabled: true,
      },
    })
    window.desktop!.gitCommit = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      stdout: "",
      stderr: "",
      summary: "Committed to main.",
    })
    window.desktop!.gitPush = vi.fn().mockResolvedValue({
      directory: "C:\\Projects\\Atlas\\client",
      root: "C:\\Projects\\Atlas",
      branch: "main",
      stdout: "",
      stderr: "",
      summary: "Pushed main.",
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.subscribe).toHaveBeenCalledWith({
        uiSessionID: "session-atlas-review",
        backendSessionID: "session-atlas-review",
      })
      expect(window.desktop!.agentSession!.onEvent).toHaveBeenCalled()
    })

    act(() => {
      sessionStreamListener?.(createSubscriptionStreamEvent({
        backendSessionID: "session-atlas-review",
        id: "200:turn-detached:1",
        event: "started",
        data: {
          sessionID: "session-atlas-review",
          turnID: "turn-detached",
          cursor: "200:turn-detached:1",
        },
      }))
    })

    expect(await screen.findByText("Run the mobile repo config check")).toBeInTheDocument()

    act(() => {
      sessionStreamListener?.(createSubscriptionStreamEvent({
        backendSessionID: "session-atlas-review",
        id: "201:turn-detached:2",
        event: "part",
        data: {
          sessionID: "session-atlas-review",
          turnID: "turn-detached",
          cursor: "201:turn-detached:2",
          part: {
            id: "tool-detached",
            type: "tool",
            tool: "read-file",
            state: {
              status: "waiting-approval",
              title: "Read repo config",
            },
          },
        },
      }))
      sessionStreamListener?.(createSubscriptionStreamEvent({
        backendSessionID: "session-atlas-review",
        id: "202:turn-detached:3",
        event: "done",
        data: {
          sessionID: "session-atlas-review",
          turnID: "turn-detached",
          cursor: "202:turn-detached:3",
          status: "blocked",
          parts: [
            {
              id: "tool-detached",
              type: "tool",
              tool: "read-file",
              state: {
                status: "waiting-approval",
                title: "Read repo config",
              },
            },
          ],
        },
      }))
    })

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-atlas-review",
      })
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenCalledWith({
        backendSessionID: "session-atlas-review",
        view: "all",
      })
    })

    await screen.findByRole("button", { name: /read-file.*等待确认/i })
  })

  it("subscribes to child sessions in the background when subagents are created", async () => {
    let sessionStreamListener: DesktopAgentSessionEventListener | undefined

    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-parent",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Parent session",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([])
    window.desktop!.agentSession!.loadPermissionRequests = vi.fn().mockResolvedValue([])
    window.desktop!.agentSession!.subscribe = vi.fn().mockImplementation(async ({ backendSessionID }: { backendSessionID: string }) => ({
      backendSessionID,
    }))
    window.desktop!.agentSession!.unsubscribe = vi.fn().mockImplementation(async ({ backendSessionID }: { backendSessionID: string }) => ({
      backendSessionID,
      removed: true,
    }))
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      sessionStreamListener = listener
      return vi.fn()
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.subscribe).toHaveBeenCalledWith({
        uiSessionID: "session-parent",
        backendSessionID: "session-parent",
      })
    })

    act(() => {
      sessionStreamListener?.(createSubscriptionStreamEvent({
        backendSessionID: "session-parent",
        id: "100:turn-parent:2",
        event: "runtime",
        data: {
          type: "subagent.created",
          eventID: "event-subagent-created",
          sessionID: "session-parent",
          turnID: "turn-parent",
          seq: 2,
          timestamp: 100,
          payload: {
            taskID: "task-child",
            childSessionID: "session-child",
            title: "Child session",
            agent: "default",
            status: "running",
            updatedAt: 100,
          },
        },
      }))
    })

    await waitFor(() => {
      expect(window.desktop!.agentSession!.subscribe).toHaveBeenCalledWith({
        uiSessionID: "session-child",
        backendSessionID: "session-child",
      })
    })
    expect(screen.queryByText("Child session")).not.toBeInTheDocument()

    act(() => {
      sessionStreamListener?.(createSubscriptionStreamEvent({
        backendSessionID: "session-child",
        id: "110:turn-child:3",
        event: "runtime",
        data: {
          type: "turn.completed",
          eventID: "event-child-completed",
          sessionID: "session-child",
          turnID: "turn-child",
          seq: 3,
          timestamp: 110,
          payload: {
            status: "completed",
            message: {
              id: "message-child",
              sessionID: "session-child",
              role: "assistant",
              created: 100,
            },
            parts: [],
          },
        },
      }))
    })

    await waitFor(() => {
      expect(window.desktop!.agentSession!.unsubscribe).toHaveBeenCalledWith({
        backendSessionID: "session-child",
      })
    })
  })

  it("streams the response immediately while keeping file changes hidden until completion", async () => {
    let streamListener: DesktopAgentSessionEventListener | undefined
    let activeStreamID = ""
    let activeSessionID = ""

    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      streamListener = listener
      return vi.fn()
    })
    window.desktop!.agentSession!.sendTurn = vi.fn().mockImplementation(
      async (input: {
        clientTurnID: string
        backendSessionID: string
        text: string
      }) => {
        activeStreamID = input.clientTurnID
        activeSessionID = input.backendSessionID

        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "started",
          data: { sessionID: input.backendSessionID },
        }))
        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "delta",
          data: { kind: "reasoning", delta: "Planning live update." },
        }))

        return {
          clientTurnID: input.clientTurnID,
        }
      },
    )

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.getAgentHealth).toHaveBeenCalledTimes(1)
      expect(window.desktop!.agentSession!.onEvent).toHaveBeenCalledTimes(1)
    })

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Show live output")
    fireEvent.click(getComposerSendButton())

    const reasoningText = await screen.findByText("Planning live update.")
    const reasoningRow = reasoningText.closest('[data-thread-row-kind="assistant-reasoning-row"]') as HTMLElement | null

    expect(reasoningRow).not.toBeNull()

    const threadColumn = (reasoningRow as HTMLElement).closest(".thread-column") as HTMLElement
    const ownerMessageID = (reasoningRow as HTMLElement).dataset.threadMessageId
    const ownerRowSelector = `[data-thread-message-id="${ownerMessageID}"]`
    const reasoningSection = within(reasoningRow as HTMLElement).getByRole("region", { name: "Reasoning" })
    expect(within(reasoningSection).getByText("Planning live update.")).toBeInTheDocument()
    expect(threadColumn.querySelector(`${ownerRowSelector} .assistant-section.is-response`)).toBeNull()
    expect(threadColumn.querySelector(`${ownerRowSelector} .assistant-section.is-file-change`)).toBeNull()

    act(() => {
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        event: "delta",
        data: { kind: "text", delta: "Streaming answer" },
      }))
    })

    expect(await screen.findByText("Streaming answer")).toBeInTheDocument()
    expect(threadColumn.querySelector(`${ownerRowSelector} .assistant-section.is-file-change`)).toBeNull()

    act(() => {
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        event: "part",
        data: {
          part: {
            id: "patch-1",
            type: "patch",
            summary: {
              files: 1,
              additions: 2,
              deletions: 1,
            },
            changes: [
              {
                file: "src/App.tsx",
                additions: 2,
                deletions: 1,
              },
            ],
          },
        },
      }))
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        event: "part",
        data: {
          part: {
            id: "patch-2",
            type: "patch",
            summary: {
              files: 2,
              additions: 3,
              deletions: 1,
            },
            changes: [
              {
                file: "src/App.tsx",
                additions: 2,
                deletions: 1,
              },
              {
                file: "src/styles.css",
                additions: 1,
                deletions: 0,
              },
            ],
          },
        },
      }))
    })

    expect(threadColumn.querySelector(`${ownerRowSelector} .assistant-section.is-file-change`)).toBeNull()
    expect(threadColumn.querySelector(`${ownerRowSelector} .assistant-section.is-response`)).not.toBeNull()

    act(() => {
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        event: "done",
        data: {
          sessionID: activeSessionID,
          parts: [
            { id: "reasoning-1", type: "reasoning", text: "Planning live update." },
            {
              id: "patch-1",
              type: "patch",
              summary: {
                files: 1,
                additions: 2,
                deletions: 1,
              },
              changes: [
                {
                  file: "src/App.tsx",
                  additions: 2,
                  deletions: 1,
                },
              ],
            },
            {
              id: "patch-2",
              type: "patch",
              summary: {
                files: 2,
                additions: 3,
                deletions: 1,
              },
              changes: [
                {
                  file: "src/App.tsx",
                  additions: 2,
                  deletions: 1,
                },
                {
                  file: "src/styles.css",
                  additions: 1,
                  deletions: 0,
                },
              ],
            },
            { id: "text-1", type: "text", text: "Streaming answer" },
          ],
        },
      }))
    })

    await waitFor(() => {
      expect(threadColumn.querySelector(`${ownerRowSelector} .assistant-section.is-response`)).not.toBeNull()
    })

    const responseSection = threadColumn.querySelector(`${ownerRowSelector} .assistant-section.is-response`) as HTMLElement
    expect(within(responseSection).getByText("Streaming answer")).toBeInTheDocument()

    const fileChangeSections = Array.from(
      threadColumn.querySelectorAll(`${ownerRowSelector} .assistant-section.is-file-change`),
    ) as HTMLElement[]
    expect(fileChangeSections).toHaveLength(2)

    const firstFileChangeSummary = within(fileChangeSections[0] as HTMLElement).getByRole("button", { name: "已编辑 1 个文件" })
    expect(firstFileChangeSummary).toHaveAttribute("aria-expanded", "false")

    const secondFileChangeSection = fileChangeSections[1] as HTMLElement
    const secondFileChangeSummary = within(secondFileChangeSection).getByRole("button", { name: "已编辑 2 个文件" })
    expect(secondFileChangeSummary).toHaveAttribute("aria-expanded", "false")
    expect(within(secondFileChangeSection).queryByText("1 file change (+2 -1)")).not.toBeInTheDocument()
    expect(within(secondFileChangeSection).queryByText("src/App.tsx")).not.toBeInTheDocument()
    fireEvent.click(secondFileChangeSummary)
    expect(within(secondFileChangeSection).getAllByText("src/App.tsx").length).toBeGreaterThan(0)
    expect(within(secondFileChangeSection).getByLabelText("2 additions, 1 deletions")).toBeInTheDocument()
    expect(within(secondFileChangeSection).getAllByText("src/styles.css").length).toBeGreaterThan(0)
    expect(within(secondFileChangeSection).getByLabelText("1 additions, 0 deletions")).toBeInTheDocument()

    const firstFileChangePosition = reasoningSection.compareDocumentPosition(fileChangeSections[0] as HTMLElement)
    const secondFileChangePosition = (fileChangeSections[0] as HTMLElement).compareDocumentPosition(secondFileChangeSection)
    const responsePosition = responseSection.compareDocumentPosition(fileChangeSections[0] as HTMLElement)
    expect(firstFileChangePosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(secondFileChangePosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(responsePosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("reloads session history from the server when switching sessions in the sidebar", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
          {
            id: "session-atlas-followup",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas followup",
            created: 11,
            updated: 19,
          },
        ],
      },
    ])
    const reviewHistory = [
      {
        info: {
          id: "msg-user-1",
          sessionID: "session-atlas-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-1", type: "text", text: "First session prompt" }],
      },
    ]
    const followupHistory = [
      {
        info: {
          id: "msg-user-2",
          sessionID: "session-atlas-followup",
          role: "user",
          created: 110,
        },
        parts: [{ id: "part-user-2", type: "text", text: "Second session prompt" }],
      },
      {
        info: {
          id: "msg-assistant-2",
          sessionID: "session-atlas-followup",
          role: "assistant",
          created: 111,
        },
        parts: [{ id: "part-text-2", type: "text", text: "Second session reply" }],
      },
    ]
    window.desktop!.agentSession!.loadHistory = vi.fn().mockImplementation(
      async ({ backendSessionID }: { backendSessionID: string }) =>
        backendSessionID === "session-atlas-followup" ? followupHistory : reviewHistory,
    )

    render(<App />)

    expect(await screen.findByText("First session prompt")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Atlas followup" }))

    expect(await screen.findByText("Second session prompt")).toBeInTheDocument()
    expect(screen.getByText("Second session reply")).toBeInTheDocument()
    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenNthCalledWith(1, {
        backendSessionID: "session-atlas-review",
      })
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenNthCalledWith(3, {
        backendSessionID: "session-atlas-followup",
      })
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenNthCalledWith(4, {
        backendSessionID: "session-atlas-followup",
        view: "all",
      })
    })
  })

  it("renders AskUserQuestion cards and sends quick replies without clearing the composer", async () => {
    const attachmentCapableModel = {
      id: "gpt-4o-mini",
      providerID: "openai",
      name: "GPT-4o mini",
      status: "active",
      available: true,
      capabilities: {
        temperature: true,
        reasoning: false,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: true,
          video: false,
          pdf: true,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
    }

    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.getProjectModels = vi.fn().mockResolvedValue({
      items: [attachmentCapableModel],
      selection: {},
      effectiveModel: attachmentCapableModel,
    })
    window.desktop!.pickComposerAttachments = vi.fn().mockResolvedValue(["C:\\Refs\\brief.pdf"])
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-1",
          sessionID: "session-atlas-review",
          role: "user",
          created: 100,
        },
        parts: [{ id: "part-user-1", type: "text", text: "Deploy the app" }],
      },
      {
        info: {
          id: "msg-assistant-1",
          sessionID: "session-atlas-review",
          role: "assistant",
          created: 101,
        },
        parts: [
          {
            id: "tool-question-1",
            type: "tool",
            tool: "AskUserQuestion",
            state: {
              status: "completed",
              output: "{\"status\":\"asked\"}",
              metadata: {
                kind: "ask-user-question",
                version: 1,
                questionID: "que_deploy_target",
                header: "Deployment target",
                question: "Where should I deploy this app?",
                options: [
                  {
                    label: "Vercel",
                    value: "vercel",
                    description: "Best fit for the current setup.",
                  },
                  {
                    label: "Cloudflare",
                    value: "cloudflare",
                  },
                ],
                allowFreeform: true,
                multiple: false,
                required: true,
              },
            },
          },
        ],
      },
    ])

    render(<App />)

    const questionCard = await screen.findByRole("region", { name: "Deployment target" })
    expect(within(questionCard).getByText("Where should I deploy this app?")).toBeInTheDocument()
    expect(within(questionCard).getByRole("button", { name: "Vercel" })).toBeInTheDocument()
    expect(within(questionCard).getByRole("button", { name: "Cloudflare" })).toBeInTheDocument()

    await waitFor(() => {
      expect(window.desktop!.getProjectModels).toHaveBeenCalledWith({
        projectID: "project-atlas",
      })
      expect(screen.getByRole("button", { name: "Add attachments" })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole("button", { name: "Add attachments" }))

    expect(await screen.findByText("brief.pdf")).toBeInTheDocument()

    const draftInput = screen.getByRole("textbox", { name: "Task draft" })
    setComposerDraftValue(draftInput, "keep this draft")
    expectComposerDraftValue(draftInput, "keep this draft")

    fireEvent.click(within(questionCard).getByRole("button", { name: "Vercel" }))

    await waitFor(() => {
      expect(window.desktop!.agentSession!.answerQuestion).toHaveBeenCalled()
    })

    const answerQuestion = window.desktop!.agentSession!.answerQuestion
    expect(answerQuestion).toBeDefined()
    if (!answerQuestion) throw new Error("Expected answerQuestion mock")

    const answerInput = vi.mocked(answerQuestion).mock.calls.at(-1)?.[0]
    expect(answerInput).toBeDefined()
    if (!answerInput) throw new Error("Expected answerQuestion payload")

    expect(answerInput).toEqual(expect.objectContaining({
      backendSessionID: "session-atlas-review",
      questionID: "que_deploy_target",
      selectedOptions: ["vercel"],
    }))
    expect(answerInput).not.toHaveProperty("attachments")
    expect(screen.getByText("brief.pdf")).toBeInTheDocument()
    expectComposerDraftValue(draftInput, "keep this draft")
    expect(screen.queryByText(/^vercel$/)).not.toBeInTheDocument()
    expect(within(questionCard).queryByText("Answered.")).not.toBeInTheDocument()
  })

  it("shows pending permission requests for the active session and blocks sending until resolved", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([])
    window.desktop!.agentSession!.loadPermissionRequests = vi.fn().mockResolvedValue([
      createPermissionRequest({
        id: "permission-atlas-1",
        approvalID: "approval-atlas-1",
        sessionID: "session-atlas-review",
        messageID: "message-atlas-1",
        toolCallID: "toolcall-atlas-1",
        projectID: "project-atlas",
        createdAt: 100,
        prompt: {
          details: {
            paths: ["README.md"],
            workdir: "C:\\Projects\\Atlas\\client",
          },
        },
      }),
    ])

    render(<App />)

    const approvalPanel = await screen.findByRole("article", { name: "Permission request: Read repo config" })
    expect(approvalPanel.closest(".thread-shell")).not.toBeNull()
    expect(within(approvalPanel).getByRole("heading", { name: "Read repo config" })).toBeInTheDocument()
    expect(within(approvalPanel).getByText("Read README.md")).toBeInTheDocument()
    expect(getComposerSendButton()).toBeDisabled()
    expect(within(approvalPanel).getByRole("button", { name: "Allow: Read repo config" })).toBeInTheDocument()
    expect(within(approvalPanel).getByRole("button", { name: "Deny: Read repo config" })).toBeInTheDocument()
    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadPermissionRequests).toHaveBeenCalledWith({
        backendSessionID: "session-atlas-review",
      })
    })
  })

  it("approves a pending permission request, resumes the session, and refreshes history", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    const resumedHistory = [
      {
        info: {
          id: "msg-assistant-2",
          sessionID: "session-atlas-review",
          role: "assistant",
          created: 111,
        },
        parts: [{ id: "part-text-2", type: "text", text: "Approval recorded and session resumed." }],
      },
    ]
    let historyLoadCount = 0
    window.desktop!.agentSession!.loadHistory = vi.fn().mockImplementation(async () => {
      historyLoadCount += 1
      return historyLoadCount <= 2 ? [] : resumedHistory
    })
    window.desktop!.agentSession!.loadPermissionRequests = vi
      .fn()
      .mockResolvedValueOnce([
        createPermissionRequest({
          id: "permission-atlas-1",
          approvalID: "approval-atlas-1",
          sessionID: "session-atlas-review",
          messageID: "message-atlas-1",
          toolCallID: "toolcall-atlas-1",
          projectID: "project-atlas",
          createdAt: 100,
          prompt: {
            details: {
              paths: ["README.md"],
              workdir: "C:\\Projects\\Atlas\\client",
            },
          },
        }),
      ])
      .mockResolvedValueOnce([])
    window.desktop!.agentSession!.respondPermissionRequest = vi.fn().mockResolvedValue(
      createPermissionResolveResult({
        id: "permission-atlas-1",
        approvalID: "approval-atlas-1",
        sessionID: "session-atlas-review",
        messageID: "message-atlas-1",
        toolCallID: "toolcall-atlas-1",
        projectID: "project-atlas",
        createdAt: 100,
      }),
    )

    render(<App />)

    const approvalPanel = await screen.findByRole("article", { name: "Permission request: Read repo config" })
    fireEvent.click(within(approvalPanel).getByRole("button", { name: "Allow: Read repo config" }))

    await waitFor(() => {
      expect(window.desktop!.agentSession!.respondPermissionRequest).toHaveBeenCalledWith({
        requestID: "permission-atlas-1",
        decision: "allow",
        note: undefined,
        resume: false,
      })
      expect(window.desktop!.agentSession!.resumeTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "session-atlas-review",
        clientTurnID: expect.any(String),
      }))
    })
    expect(await screen.findByText("Approval recorded and session resumed.")).toBeInTheDocument()
    expect(screen.queryByRole("article", { name: "Permission request: Read repo config" })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenNthCalledWith(3, {
        backendSessionID: "session-atlas-review",
      })
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenNthCalledWith(4, {
        backendSessionID: "session-atlas-review",
        view: "all",
      })
      expect(window.desktop!.agentSession!.loadPermissionRequests).toHaveBeenNthCalledWith(2, {
        backendSessionID: "session-atlas-review",
      })
    })
  })

  it("streams resumed output immediately after approval and clears the waiting tool state first", async () => {
    let streamListener: DesktopAgentSessionEventListener | undefined
    let finishResumeStream: (() => void) | undefined

    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.loadHistory = vi
      .fn()
      .mockResolvedValueOnce([
        {
          info: {
            id: "msg-assistant-1",
            sessionID: "session-atlas-review",
            role: "assistant",
            created: 100,
          },
          parts: [
            {
              id: "tool-part-1",
              type: "tool",
              tool: "read-file",
              state: {
                status: "waiting-approval",
                approvalID: "approval-atlas-1",
                input: {
                  path: "README.md",
                },
                title: "Read repo config",
                time: {
                  start: 90,
                },
              },
            },
          ],
        },
      ])
      .mockResolvedValueOnce([
        {
          info: {
            id: "msg-assistant-1",
            sessionID: "session-atlas-review",
            role: "assistant",
            created: 100,
          },
          parts: [
            {
              id: "tool-part-1",
              type: "tool",
              tool: "read-file",
              state: {
                status: "completed",
                input: {
                  path: "README.md",
                },
                output: "README loaded",
                title: "Read repo config",
                time: {
                  start: 90,
                  end: 120,
                },
              },
            },
          ],
        },
      ])
      .mockResolvedValueOnce([
        {
          info: {
            id: "msg-assistant-1",
            sessionID: "session-atlas-review",
            role: "assistant",
            created: 100,
          },
          parts: [
            {
              id: "tool-part-1",
              type: "tool",
              tool: "read-file",
              state: {
                status: "completed",
                input: {
                  path: "README.md",
                },
                output: "README loaded",
                title: "Read repo config",
                time: {
                  start: 90,
                  end: 120,
                },
              },
            },
          ],
        },
        {
          info: {
            id: "msg-assistant-2",
            sessionID: "session-atlas-review",
            role: "assistant",
            created: 121,
          },
          parts: [{ id: "part-text-2", type: "text", text: "Resumed answer" }],
        },
      ])
    window.desktop!.agentSession!.loadPermissionRequests = vi
      .fn()
      .mockResolvedValueOnce([
        createPermissionRequest({
          id: "permission-atlas-1",
          approvalID: "approval-atlas-1",
          sessionID: "session-atlas-review",
          messageID: "msg-assistant-1",
          toolCallID: "toolcall-atlas-1",
          projectID: "project-atlas",
          createdAt: 100,
          prompt: {
            details: {
              paths: ["README.md"],
              workdir: "C:\\Projects\\Atlas\\client",
            },
          },
        }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const approvalResponse = createDeferred<PermissionResolveResult>()
    const approvalResolveResult = createPermissionResolveResult({
      id: "permission-atlas-1",
      approvalID: "approval-atlas-1",
      sessionID: "session-atlas-review",
      messageID: "msg-assistant-1",
      toolCallID: "toolcall-atlas-1",
      projectID: "project-atlas",
      createdAt: 100,
    })
    window.desktop!.agentSession!.respondPermissionRequest = vi.fn().mockReturnValue(approvalResponse.promise)
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      streamListener = listener
      return vi.fn()
    })
    window.desktop!.agentSession!.resumeTurn = vi.fn().mockImplementation(
      async (input: {
        clientTurnID: string
        backendSessionID: string
      }) => {
        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "started",
          data: { sessionID: input.backendSessionID },
        }))
        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "delta",
          data: { kind: "text", delta: "Resumed answer" },
        }))

        await new Promise<void>((resolve) => {
          finishResumeStream = () => {
            streamListener?.(createRequestStreamEvent({
              backendSessionID: input.backendSessionID,
              clientTurnID: input.clientTurnID,
              event: "done",
              data: {
                sessionID: input.backendSessionID,
                parts: [{ id: "part-text-2", type: "text", text: "Resumed answer" }],
              },
            }))
            resolve()
          }
        })

        return {
          clientTurnID: input.clientTurnID,
        }
      },
    )

    render(<App />)

    const toolTraceToggle = await screen.findByRole("button", { name: /read-file.*等待确认/i })
    expect(toolTraceToggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Waiting for permission approval before the tool can continue.")).not.toBeInTheDocument()

    fireEvent.click(toolTraceToggle)

    expect(toolTraceToggle).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByText("Waiting for permission approval before the tool can continue.")).toBeInTheDocument()
    const approvalInputExpandButton = screen.getByRole("button", { name: /^Expand read-file input content$/i })
    expect(approvalInputExpandButton).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(approvalInputExpandButton)
    expect(approvalInputExpandButton).toHaveAttribute("aria-expanded", "true")

    const approvalPanel = await screen.findByRole("article", { name: "Permission request: Read repo config" })
    fireEvent.click(within(approvalPanel).getByRole("button", { name: "Allow: Read repo config" }))

    await waitFor(() => {
      expect(window.desktop!.agentSession!.respondPermissionRequest).toHaveBeenCalledWith({
        requestID: "permission-atlas-1",
        decision: "allow",
        note: undefined,
        resume: false,
      })
    })

    act(() => {
      streamListener?.(createSubscriptionStreamEvent({
        backendSessionID: "session-atlas-review",
        id: "111:turn-approval:3",
        event: "runtime",
        data: {
          type: "tool.call.started",
          eventID: "event-tool-started-after-approval",
          sessionID: "session-atlas-review",
          turnID: "turn-approval",
          seq: 3,
          timestamp: 111,
          payload: {
            part: {
              id: "tool-part-1",
              sessionID: "session-atlas-review",
              messageID: "msg-assistant-1",
              type: "tool",
              callID: "toolcall-atlas-1",
              tool: "read-file",
              state: {
                status: "running",
                input: {
                  path: "README.md",
                },
                title: "Read repo config",
                time: {
                  start: 90,
                },
              },
            },
          },
        },
      }))
    })

    await waitFor(() => {
      expect(document.querySelector(".trace-kind-tool.is-running .trace-log-row")).not.toBeNull()
      expect(document.querySelector(".trace-kind-tool.is-waiting-approval")).toBeNull()
    })

    act(() => {
      approvalResponse.resolve(approvalResolveResult)
    })

    await waitFor(() => {
      expect(window.desktop!.agentSession!.resumeTurn).toHaveBeenCalledTimes(1)
    })

    const readFileToolRows = await screen.findAllByRole("button", { name: /read-file/i })
    const readFileToolRow = readFileToolRows.find((button) => button.classList.contains("trace-log-row"))
    if (readFileToolRow?.getAttribute("aria-expanded") === "false") {
      fireEvent.click(readFileToolRow)
    }

    fireEvent.click(await screen.findByRole("button", { name: /^Expand read-file output content$/i }))
    expect(await screen.findByText("README loaded")).toBeInTheDocument()
    expect(screen.queryByText("Waiting for permission approval before the tool can continue.")).not.toBeInTheDocument()
    expect(screen.getAllByText("Resumed answer").length).toBeGreaterThan(0)
    expect(getComposerSendButton()).toBeEnabled()
    expect(getComposerSendButton()).toHaveAccessibleName("Stop task")

    act(() => {
      finishResumeStream?.()
    })

    await waitFor(() => {
      expect(screen.getAllByText("Resumed answer").length).toBeGreaterThan(0)
    })

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadHistory).toHaveBeenNthCalledWith(3, {
        backendSessionID: "session-atlas-review",
      })
      expect(getComposerSendButton()).toBeEnabled()
    })
  })

  it("hides the approval dialog immediately after a decision is chosen", async () => {
    const response = createDeferred<PermissionResolveResult>()

    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([])
    window.desktop!.agentSession!.loadPermissionRequests = vi
      .fn()
      .mockResolvedValueOnce([
        createPermissionRequest({
          id: "permission-atlas-1",
          approvalID: "approval-atlas-1",
          sessionID: "session-atlas-review",
          messageID: "message-atlas-1",
          toolCallID: "toolcall-atlas-1",
          projectID: "project-atlas",
          createdAt: 100,
          prompt: {
            details: {
              paths: ["README.md"],
              workdir: "C:\\Projects\\Atlas\\client",
            },
          },
        }),
      ])
      .mockResolvedValueOnce([])
    window.desktop!.agentSession!.respondPermissionRequest = vi.fn().mockReturnValue(response.promise)

    render(<App />)

    const approvalPanel = await screen.findByRole("article", { name: "Permission request: Read repo config" })
    fireEvent.click(within(approvalPanel).getByRole("button", { name: "Allow: Read repo config" }))

    await waitFor(() => {
      expect(screen.queryByRole("article", { name: "Permission request: Read repo config" })).not.toBeInTheDocument()
    })
    expect(getComposerSendButton()).toBeDisabled()

    response.resolve(
      createPermissionResolveResult({
        id: "permission-atlas-1",
        approvalID: "approval-atlas-1",
        sessionID: "session-atlas-review",
        messageID: "message-atlas-1",
        toolCallID: "toolcall-atlas-1",
        projectID: "project-atlas",
        createdAt: 100,
      }),
    )

    await waitFor(() => {
      expect(window.desktop!.agentSession!.loadPermissionRequests).toHaveBeenNthCalledWith(2, {
        backendSessionID: "session-atlas-review",
      })
    })
  })

  it("does not show seed workspaces when startup folder loading fails", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockRejectedValue(new Error("backend unavailable"))

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.listFolderWorkspaces).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole("button", { name: "app" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Chat 1" })).not.toBeInTheDocument()
  })

  it("opens a folder from a selected directory and appends it to the sidebar", async () => {
    window.desktop!.pickProjectDirectory = vi.fn().mockResolvedValue("C:\\Projects\\Orion\\client")
    window.desktop!.openFolderWorkspace = vi.fn().mockResolvedValue({
      id: "C:\\Projects\\Orion\\client",
      directory: "C:\\Projects\\Orion\\client",
      name: "client",
      created: 1,
      updated: 2,
      project: {
        id: "project-orion",
        name: "Orion",
        worktree: "C:\\Projects\\Orion",
      },
      sessions: [],
    })

    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open folder" }))

    await waitFor(() => {
      expect(window.desktop!.pickProjectDirectory).toHaveBeenCalledTimes(1)
      expect(window.desktop!.openFolderWorkspace).toHaveBeenCalledWith({
        directory: "C:\\Projects\\Orion\\client",
      })
    })
    expect(await screen.findByRole("button", { name: "client" })).toBeInTheDocument()
    expect(screen.getAllByText("C:\\Projects\\Orion").length).toBeGreaterThan(0)
  })

  it("reuses the existing create session tab when opening a folder without sessions", async () => {
    window.desktop!.pickProjectDirectory = vi.fn().mockResolvedValue("C:\\Projects\\Orion\\client")
    window.desktop!.openFolderWorkspace = vi.fn().mockResolvedValue({
      id: "C:\\Projects\\Orion\\client",
      directory: "C:\\Projects\\Orion\\client",
      name: "client",
      created: 1,
      updated: 2,
      project: {
        id: "project-orion",
        name: "Orion",
        worktree: "C:\\Projects\\Orion",
      },
      sessions: [],
    })

    render(<App />)

    fireEvent.click(getAddSessionTabButton())
    expect(await screen.findByRole("combobox", { name: "Session project" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open folder" }))

    await waitFor(() => {
      expect(window.desktop!.openFolderWorkspace).toHaveBeenCalledWith({
        directory: "C:\\Projects\\Orion\\client",
      })
    })

    expect(await screen.findByRole("button", { name: "client" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Switch to create session tab" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByRole("button", { name: "Switch to create session tab 2" })).toBeNull()
    expectCreateSessionProjectSelectLabel("Orion / client")
  })

  it("keeps a newly opened folder when startup folder loading resolves afterwards", async () => {
    const startupLoad = createDeferred<LoadedFolderWorkspace[]>()
    window.desktop!.listFolderWorkspaces = vi.fn().mockImplementation(() => startupLoad.promise)
    window.desktop!.pickProjectDirectory = vi.fn().mockResolvedValue("C:\\Projects\\Orion\\client")
    window.desktop!.openFolderWorkspace = vi.fn().mockResolvedValue({
      id: "C:\\Projects\\Orion\\client",
      directory: "C:\\Projects\\Orion\\client",
      name: "client",
      created: 1,
      updated: 2,
      project: {
        id: "project-orion",
        name: "Orion",
        worktree: "C:\\Projects\\Orion",
      },
      sessions: [],
    })

    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open folder" }))

    expect(await screen.findByRole("button", { name: "client" })).toBeInTheDocument()

    await act(async () => {
      startupLoad.resolve([])
      await startupLoad.promise
    })

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "client" })).toBeInTheDocument()
    })
    expect(screen.queryByRole("button", { name: "app" })).not.toBeInTheDocument()
  })

  it("waits for the initial workspace load before requesting project-specific composer data", async () => {
    const startupLoad = createDeferred<LoadedFolderWorkspace[]>()
    window.desktop!.listFolderWorkspaces = vi.fn().mockImplementation(() => startupLoad.promise)

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.listFolderWorkspaces).toHaveBeenCalledTimes(1)
    })

    expect(window.desktop!.getProjectModels).not.toHaveBeenCalled()
    expect(window.desktop!.getProjectSkills).not.toHaveBeenCalled()
    expect(window.desktop!.getProjectSkillSelection).not.toHaveBeenCalled()
    expect(window.desktop!.getProjectPlugins).not.toHaveBeenCalled()
    expect(window.desktop!.getProjectPluginSelection).not.toHaveBeenCalled()
    expect(window.desktop!.getGlobalMcpServers).not.toHaveBeenCalled()
    expect(window.desktop!.getProjectMcpSelection).not.toHaveBeenCalled()

    await act(async () => {
      startupLoad.resolve([
        {
          id: "C:\\Projects\\Atlas\\app",
          directory: "C:\\Projects\\Atlas\\app",
          name: "app",
          created: 1,
          updated: 2,
          project: {
            id: "project-atlas",
            name: "Atlas",
            worktree: "C:\\Projects\\Atlas",
          },
          sessions: [],
        },
      ])
      await startupLoad.promise
    })

    await waitFor(() => {
      expect(window.desktop!.getProjectModels).toHaveBeenCalledWith({
        projectID: "project-atlas",
      })
      expect(window.desktop!.getProjectSkills).toHaveBeenCalledWith({
        projectID: "project-atlas",
      })
      expect(window.desktop!.getProjectSkillSelection).toHaveBeenCalledWith({
        projectID: "project-atlas",
      })
      expect(window.desktop!.getProjectPlugins).toHaveBeenCalledWith({
        projectID: "project-atlas",
      })
      expect(window.desktop!.getProjectPluginSelection).toHaveBeenCalledWith({
        projectID: "project-atlas",
      })
      expect(window.desktop!.getProjectMcpSelection).toHaveBeenCalledWith({
        projectID: "project-atlas",
      })
    })

    expect(window.desktop!.getGlobalMcpServers).toHaveBeenCalledTimes(1)
  })

  it("waits for the initial workspace load before starting git and file watchers", async () => {
    const startupLoad = createDeferred<LoadedFolderWorkspace[]>()
    window.desktop!.listFolderWorkspaces = vi.fn().mockImplementation(() => startupLoad.promise)
    window.desktop!.updateWorkspaceWatchDirectories = vi.fn().mockResolvedValue({
      directories: [],
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.listFolderWorkspaces).toHaveBeenCalledTimes(1)
    })

    expect(window.desktop!.updateWorkspaceWatchDirectories).not.toHaveBeenCalled()
    expect(window.desktop!.gitGetCapabilities).not.toHaveBeenCalled()

    await act(async () => {
      startupLoad.resolve([
        {
          id: "C:\\Projects\\Atlas\\client",
          directory: "C:\\Projects\\Atlas\\client",
          name: "client",
          created: 1,
          updated: 2,
          project: {
            id: "project-atlas",
            name: "Atlas",
            worktree: "C:\\Projects\\Atlas",
          },
          sessions: [
            {
              id: "session-atlas-review",
              projectID: "project-atlas",
              directory: "C:\\Projects\\Atlas\\client",
              title: "Atlas review",
              created: 1,
              updated: 2,
            },
          ],
        },
      ])
      await startupLoad.promise
    })

    await screen.findByRole("button", { name: "Atlas review" })

    await waitFor(() => {
      expect(window.desktop!.updateWorkspaceWatchDirectories).toHaveBeenCalledWith({
        directories: ["C:\\Projects\\Atlas\\client"],
      })
    })
    await waitFor(() => {
      expect(window.desktop!.gitGetCapabilities).toHaveBeenCalledWith({
        projectID: "project-atlas",
        directory: "C:\\Projects\\Atlas\\client",
      })
    })
  })

  it("shows each newly opened folder and keeps only the latest one selected", async () => {
    window.desktop!.pickProjectDirectory = vi
      .fn()
      .mockResolvedValueOnce("C:\\Projects\\Orion\\client")
      .mockResolvedValueOnce("C:\\Projects\\Nova\\server")
    window.desktop!.openFolderWorkspace = vi
      .fn()
      .mockResolvedValueOnce({
        id: "C:\\Projects\\Orion\\client",
        directory: "C:\\Projects\\Orion\\client",
        name: "client",
        created: 1,
        updated: 2,
        project: {
          id: "project-orion",
          name: "Orion",
          worktree: "C:\\Projects\\Orion",
        },
        sessions: [],
      })
      .mockResolvedValueOnce({
        id: "C:\\Projects\\Nova\\server",
        directory: "C:\\Projects\\Nova\\server",
        name: "server",
        created: 3,
        updated: 4,
        project: {
          id: "project-nova",
          name: "Nova",
          worktree: "C:\\Projects\\Nova",
        },
        sessions: [],
      })

    render(<App />)

    const openFolder = screen.getByRole("button", { name: "Open folder" })
    fireEvent.click(openFolder)
    expect((await screen.findByRole("button", { name: "client" })).closest(".project-row")).toHaveClass("is-active")

    fireEvent.click(openFolder)

    await waitFor(() => {
      expect(window.desktop!.openFolderWorkspace).toHaveBeenCalledTimes(2)
      expect(window.desktop!.openFolderWorkspace).toHaveBeenNthCalledWith(2, {
        directory: "C:\\Projects\\Nova\\server",
      })
    })

    expect((await screen.findByRole("button", { name: "server" })).closest(".project-row")).toHaveClass("is-active")
    expect(screen.getByRole("button", { name: "client" }).closest(".project-row")).not.toHaveClass("is-active")
    expect(screen.getByRole("button", { name: "client" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "server" })).toHaveAttribute("aria-expanded", "true")
    expect(document.querySelectorAll(".project-row.is-active")).toHaveLength(1)
  })

  it("does not open a folder when directory selection is cancelled", async () => {
    window.desktop!.pickProjectDirectory = vi.fn().mockResolvedValue(null)
    window.desktop!.openFolderWorkspace = vi.fn()

    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open folder" }))

    await waitFor(() => {
      expect(window.desktop!.pickProjectDirectory).toHaveBeenCalledTimes(1)
    })
    expect(window.desktop!.openFolderWorkspace).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "app" })).toBeInTheDocument()
  })

  it("adds the selected sidebar session to the focused pane and activates it", async () => {
    render(<App />)

    expect(screen.getByRole("button", { name: "Switch to session Chat 1" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByRole("button", { name: "Switch to session Chat 2" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Chat 2" }))

    expect(await screen.findByRole("button", { name: "Switch to session Chat 2" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Switch to session Chat 1" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "Chat 2" }).closest(".session-row")).toHaveClass("is-active")
    expect(screen.getByRole("button", { name: "app" }).closest(".project-row")).toHaveClass("is-active")
  })

  it("focuses the target session when a notification focus event arrives", async () => {
    render(<App />)

    expect(screen.getByRole("button", { name: "Switch to session Chat 1" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByRole("button", { name: "Switch to session Chat 2" })).not.toBeInTheDocument()

    act(() => {
      for (const listener of agentSessionEventListeners) {
        listener(createFocusSessionEvent("session-chat-2"))
      }
    })

    expect(await screen.findByRole("button", { name: "Switch to session Chat 2" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Switch to session Chat 1" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "Chat 2" }).closest(".session-row")).toHaveClass("is-active")
  })

  it("reuses open session tabs while preserving create session tabs in the focused pane", async () => {
    render(<App />)

    fireEvent.click(getAddSessionTabButton())
    await screen.findByRole("combobox", { name: "Session project" })

    expect(screen.getByRole("button", { name: "Switch to create session tab" })).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(screen.getByRole("button", { name: "Chat 2" }))

    expect(await screen.findByRole("button", { name: "Switch to session Chat 2" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Switch to session Chat 1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Switch to create session tab" })).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(screen.getByRole("button", { name: "Chat 1" }))

    expect(screen.getByRole("button", { name: "Switch to session Chat 1" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Switch to session Chat 2" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Switch to create session tab" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Switch to session Chat 1" })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "Switch to session Chat 2" })).toHaveLength(1)
  })

  it("drags a tab out of the focused pane to create a sibling pane", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Chat 2" }))

    const chat2Tab = screen.getByRole("button", { name: "Switch to session Chat 2" })
    const chat2TabContent = chat2Tab.closest(".dockview-workbench-tab-content")
    const chat2TabContainer = chat2Tab.closest(".dv-tab")

    expect(chat2TabContent).not.toBeNull()
    expect(chat2TabContainer).not.toBeNull()
    expect(chat2TabContent).not.toHaveAttribute("draggable")
    expect(chat2TabContainer).toHaveAttribute("draggable", "true")
    expect(chat2Tab).not.toHaveAttribute("draggable")

    const panes = await moveDockviewPanelToNewGroup("session:session-chat-2", "right")

    expect(panes.map(getPaneCanvasTitle)).toEqual(expect.arrayContaining(["Chat 1", "Chat 2"]))
    expect(screen.getByRole("button", { name: "Switch to session Chat 2" })).toHaveAttribute("aria-pressed", "true")
  })

  it("drags a create-session tab out of the focused pane to create a sibling pane", async () => {
    render(<App />)

    fireEvent.click(getAddSessionTabButton())
    await screen.findByRole("combobox", { name: "Session project" })

    const createTab = screen.getByRole("button", { name: "Switch to create session tab" })
    const createTabContent = createTab.closest(".dockview-workbench-tab-content")
    const createTabContainer = createTab.closest(".dv-tab")

    expect(createTabContent).not.toBeNull()
    expect(createTabContainer).not.toBeNull()
    expect(createTabContent).not.toHaveAttribute("draggable")
    expect(createTabContainer).toHaveAttribute("draggable", "true")
    expect(createTab).not.toHaveAttribute("draggable")

    const panes = sortPanesWithCreateSessionLast(await moveDockviewPanelToNewGroup("create-session:", "right"))
    expect(within(panes[1]).getByRole("combobox", { name: "Session project" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Switch to create session tab" })).toHaveAttribute("aria-pressed", "true")
  })

  it("lets Dockview own split previews instead of rendering legacy pane split hints", async () => {
    render(<App />)

    fireEvent.click(getAddSessionTabButton())
    await screen.findByRole("combobox", { name: "Session project" })

    const sourcePane = document.querySelector(".workbench-pane") as HTMLElement
    expect(sourcePane.querySelector('[data-testid^="pane-drop-"]')).toBeNull()
    expect(sourcePane.querySelector(".pane-drop-preview")).toBeNull()
    expect(document.querySelector(".dockview-theme-anybox")).not.toBeNull()
    const dockviewShell = document.querySelector(".dv-shell.dockview-theme-anybox") as HTMLElement | null
    expect(dockviewShell).not.toBeNull()
    expect(dockviewShell?.style.getPropertyValue("--dv-drag-over-border")).toBe("1px solid var(--seg-accent)")
  })

  it("merges a tab into a sibling Dockview group and activates it there", async () => {
    render(<App />)

    const panes = await createSiblingPaneFromCreateTab()
    await moveDockviewPanelToPane("session:session-chat-1", panes[1], "center")

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch to session Chat 1" })).toHaveAttribute("aria-pressed", "true")
    })
    expect(screen.getByRole("button", { name: "Switch to create session tab" })).toBeInTheDocument()
  })

  it("splits a create-session panel into a sibling Dockview group", async () => {
    render(<App />)

    fireEvent.click(getAddSessionTabButton())
    await screen.findByRole("combobox", { name: "Session project" })

    await moveDockviewPanelToNewGroup("create-session:", "right")
    expect(document.querySelectorAll(".workbench-pane")).toHaveLength(2)
  })

  it("creates a vertical Dockview split from a create-session panel", async () => {
    render(<App />)

    fireEvent.click(getAddSessionTabButton())
    await screen.findByRole("combobox", { name: "Session project" })

    await moveDockviewPanelToNewGroup("create-session:", "bottom")
    expect(document.querySelectorAll(".workbench-pane")).toHaveLength(2)
  })

  it("keeps a vertical Dockview split after sending from the lower pane", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Chat 2" }))
    const panes = await moveDockviewPanelToNewGroup("session:session-chat-2", "bottom")
    const lowerPane = panes.find((pane) => getPaneCanvasTitle(pane) === "Chat 2")
    expect(lowerPane).toBeTruthy()

    const api = await getWorkbenchDockviewApi()
    const stackedGrid = api.toJSON().grid

    setComposerDraftValue(within(lowerPane!).getByRole("textbox", { name: "Task draft" }), "Keep the stacked split")
    await act(async () => {
      fireEvent.click(within(lowerPane!).getByRole("button", { name: /^(Send|Sending|Stop) task$|^Resolve approval first$/ }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(
      await within(lowerPane!).findByText("Keep the stacked split", {
        selector: ".user-bubble-text",
      }),
    ).toBeInTheDocument()
    expect(api.toJSON().grid).toEqual(stackedGrid)
  })

  it("drops a tab into another pane and activates it there", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Chat 2" }))
    let panes = await createSiblingPaneFromCreateTab()

    await moveDockviewPanelToPane("session:session-chat-2", panes[1], "center")

    await waitFor(() => {
      panes = Array.from(document.querySelectorAll(".workbench-pane")) as HTMLElement[]
      expect(screen.getByRole("button", { name: "Switch to session Chat 2" })).toHaveAttribute("aria-pressed", "true")
    })

    expect(screen.getByRole("button", { name: "Switch to create session tab" })).toBeInTheDocument()
    expect(panes.map(getPaneCanvasTitle)).toContain("Chat 1")
  })

  it("restores a single workbench pane without leaving the canvas shifted left", async () => {
    render(<App />)

    await createSiblingPaneFromCreateTab()

    expect(document.querySelectorAll(".workbench-pane")).toHaveLength(2)
    await waitFor(() => {
      expect(document.querySelector(".workbench-panes")).toHaveClass("has-multiple")
    })
    expect(document.querySelectorAll(".dockview-theme-anybox .window-controls")).toHaveLength(0)
    expect(document.querySelectorAll(".right-sidebar-top-menu .window-controls")).toHaveLength(1)

    fireEvent.click(screen.getByRole("button", { name: "Close create session tab" }))

    await waitFor(() => {
      expect(document.querySelectorAll(".workbench-pane")).toHaveLength(1)
    })

    expect(document.querySelector(".workbench-panes")).not.toHaveClass("has-multiple")
    expect(document.querySelector(".dv-tabs-and-actions-container")).not.toHaveClass("has-window-controls-clearance")
    expect(document.querySelectorAll(".dockview-theme-anybox .window-controls")).toHaveLength(0)
    expect(document.querySelectorAll(".right-sidebar-top-menu .window-controls")).toHaveLength(1)
  })

  it("uses Dockview tab bars for stacked panes without legacy pane tab bars", async () => {
    render(<App />)

    const panes = await createStackedPaneFromCreateTab()
    expect(panes).toHaveLength(2)

    expect(panes[0].closest(".dockview-theme-anybox")).not.toBeNull()
    expect(panes[1].closest(".dockview-theme-anybox")).not.toBeNull()
    expect(document.querySelector(".pane-tab-bar")).toBeNull()
  })

  it("keeps the right sidebar toggle in the top-right pane when panes are stacked", async () => {
    render(<App />)

    const panes = await createStackedPaneFromCreateTab()
    expect(panes).toHaveLength(2)

    const toggle = screen.getByRole("button", { name: "Collapse right sidebar" })
    expect(toggle.closest(".dockview-workbench-header-actions")).not.toBeNull()
    expect(screen.getAllByRole("button", { name: "Collapse right sidebar" })).toHaveLength(1)
  })

  it("keeps Dockview tab draggability outside the custom tab button", () => {
    render(<App />)

    const tab = screen.getByRole("button", { name: "Switch to session Chat 1" })
    const tabBar = tab.closest(".dv-tabs-and-actions-container")

    expect(tabBar).not.toBeNull()
    expect(tab).not.toHaveAttribute("draggable")
    expect(tab.closest(".dockview-workbench-tab-content")).not.toHaveAttribute("draggable")
  })

  it("uses Dockview active tab state without decorative inner tab curves", () => {
    render(<App />)

    const tabBar = document.querySelector(".dv-tabs-and-actions-container") as HTMLElement
    const activeTab = tabBar.querySelector(".dv-tab.dv-active-tab")
    const tabsContainer = tabBar.querySelector(".dv-tabs-container")

    expect(tabBar).not.toBeNull()
    expect(tabsContainer).not.toBeNull()
    expect(activeTab).not.toBeNull()
    expect(activeTab?.querySelector(".dockview-workbench-tab-content")).not.toBeNull()
    expect(tabBar.querySelectorAll(".session-tab-active-curve")).toHaveLength(0)
  })

  it("falls back to the create session tab when the last session tab closes", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Close session tab Chat 1" }))

    expect(await screen.findByRole("combobox", { name: "Session project" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Switch to create session tab" })).toHaveAttribute("aria-pressed", "true")
  })

  it("focuses the existing create session tab when the pane tab bar add button is clicked", async () => {
    render(<App />)

    fireEvent.click(getAddSessionTabButton())
    await screen.findByRole("combobox", { name: "Session project" })

    const { panel } = await findDockviewPanel("session:session-chat-1")
    act(() => {
      panel.api.setActive()
    })
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch to session Chat 1" })).toHaveAttribute("aria-pressed", "true")
    })

    const paneTabBar = document.querySelector(".dv-tabs-and-actions-container") as HTMLElement

    expect(paneTabBar).not.toBeNull()
    fireEvent.click(within(paneTabBar).getByRole("button", { name: "Add session tab" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch to create session tab" })).toHaveAttribute("aria-pressed", "true")
    })
    expect(screen.queryByRole("button", { name: "Switch to create session tab 2" })).toBeNull()
  })

  it("focuses the existing create session tab in another pane when the folder row action is clicked", async () => {
    render(<App />)

    await createSiblingPaneFromCreateTab()

    fireEvent.click(screen.getByRole("button", { name: "Switch to session Chat 1" }))
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch to session Chat 1" })).toHaveAttribute("aria-pressed", "true")
    })
    fireEvent.click(screen.getByRole("button", { name: "Create session for src" }))

    const updatedPanes = Array.from(document.querySelectorAll(".workbench-pane")) as HTMLElement[]
    const createPane = updatedPanes.find((pane) => within(pane).queryByRole("combobox", { name: "Session project" }))

    expect(createPane).not.toBeUndefined()
    expect(screen.getByRole("button", { name: "Switch to create session tab" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByRole("button", { name: "Switch to create session tab 2" })).toBeNull()
    expectCreateSessionProjectSelectLabel("Project 1 / src")
  })

  it("reuses the existing create session tab when the add tab button is clicked again", async () => {
    render(<App />)

    fireEvent.click(getAddSessionTabButton())
    await screen.findByRole("combobox", { name: "Session project" })
    expect(screen.queryByRole("textbox", { name: "Session title" })).not.toBeInTheDocument()

    selectCreateSessionProject("Project 1 / src")
    expectCreateSessionProjectSelectLabel("Project 1 / src")

    fireEvent.click(getAddSessionTabButton())

    expect(screen.getByRole("button", { name: "Switch to create session tab" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByRole("button", { name: "Switch to create session tab 2" })).toBeNull()
    expectCreateSessionProjectSelectLabel("Project 1 / src")
  })

  it("shows the session canvas top menu while a create session tab is active", async () => {
    render(<App />)

    fireEvent.click(getAddSessionTabButton())

    await screen.findByRole("combobox", { name: "Session project" })

    const topMenu = screen.getByLabelText("Session canvas top menu")
    expect(topMenu).toBeInTheDocument()
    expect(within(topMenu).queryByText("Create session")).not.toBeInTheDocument()
    expect(within(topMenu).getByRole("button", { name: "Select project skills: Skills" })).toBeInTheDocument()
    expect(within(topMenu).getByRole("button", { name: "Select project MCP servers: MCP" })).toBeInTheDocument()
  })

  it("creates a persisted session for the selected folder", async () => {
    window.desktop!.createFolderSession = vi.fn().mockResolvedValue({
      session: {
        id: "session-backend-new",
        projectID: "project-2",
        directory: "C:\\Projects\\Project 2\\app",
        title: "Backend chat",
        created: 1,
        updated: 2,
      },
    })

    render(<App />)

    fireEvent.click(getAddSessionTabButton())
    expect(await screen.findByRole("combobox", { name: "Session project" })).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "Session title" })).not.toBeInTheDocument()

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Create the backend session")
    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(window.desktop!.createFolderSession).toHaveBeenCalledWith({
        projectID: "project-2",
        directory: "C:\\Projects\\Project 2\\app",
      })
    })
    expect(await screen.findByRole("button", { name: "Backend chat" })).toBeInTheDocument()
    expect(within(screen.getByLabelText("Session canvas top menu")).getByText("Backend chat")).toBeInTheDocument()
  })

  it("creates a session only for the currently selected folder", async () => {
    window.desktop!.createFolderSession = vi.fn().mockResolvedValue({
      session: {
        id: "session-layout-next",
        projectID: "project-1",
        directory: "C:\\Projects\\Project 1\\src",
        title: "Layout follow-up",
        created: 1,
        updated: 2,
      },
    })

    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "src" }))

    expect(screen.getByRole("button", { name: "src" }).closest(".project-row")).toHaveClass("is-active")
    expect(screen.getByRole("button", { name: "app" }).closest(".project-row")).not.toHaveClass("is-active")
    expect(document.querySelectorAll(".project-row.is-active")).toHaveLength(1)

    fireEvent.click(getAddSessionTabButton())
    await screen.findByRole("combobox", { name: "Session project" })

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Create session for src")
    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(window.desktop!.createFolderSession).toHaveBeenCalledTimes(1)
      expect(window.desktop!.createFolderSession).toHaveBeenCalledWith({
        projectID: "project-1",
        directory: "C:\\Projects\\Project 1\\src",
      })
    })

    expect(await screen.findByRole("button", { name: "Layout follow-up" })).toBeInTheDocument()
    expect(document.querySelectorAll(".project-row.is-active")).toHaveLength(1)
  })

  it("does not open a create session tab when selecting an empty folder row", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "src" }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "src" }).closest(".project-row")).toHaveClass("is-active")
      expect(screen.getByRole("button", { name: "src" })).toHaveAttribute("aria-expanded", "true")
      expect(screen.queryByRole("button", { name: "Switch to create session tab" })).not.toBeInTheDocument()
      expect(screen.queryByRole("combobox", { name: "Session project" })).not.toBeInTheDocument()
    })
  })

  it("creates a session from the folder row action", async () => {
    window.desktop!.createFolderSession = vi.fn().mockResolvedValue({
      session: {
        id: "session-layout-scratch",
        projectID: "project-1",
        directory: "C:\\Projects\\Project 1\\src",
        title: "Layout scratch",
        created: 1,
        updated: 2,
      },
    })

    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Create session for src" }))
    await screen.findByRole("combobox", { name: "Session project" })

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Create scratch session")
    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(window.desktop!.createFolderSession).toHaveBeenCalledWith({
        projectID: "project-1",
        directory: "C:\\Projects\\Project 1\\src",
      })
    })

    expect(await screen.findByRole("button", { name: "Layout scratch" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "src" }).closest(".project-row")).toHaveClass("is-active")
  })

  it("keeps the composer visible on the create session canvas and sends after creating the session", async () => {
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.createFolderSession = vi.fn().mockResolvedValue({
      session: {
        id: "session-backend-new",
        projectID: "project-2",
        directory: "C:\\Projects\\Project 2\\app",
        title: "Backend chat",
        created: 1,
        updated: 2,
      },
    })

    render(<App />)

    fireEvent.click(getAddSessionTabButton())
    await screen.findByRole("combobox", { name: "Session project" })

    const createSessionLayout = document.querySelector(".create-session-layout")
    const createSessionDraft = screen.getByRole("textbox", { name: "Task draft" })

    expect(createSessionDraft).toBeInTheDocument()
    expect(createSessionLayout).toContainElement(createSessionDraft)
    expect(createSessionDraft.closest(".composer-stack")).toHaveClass("create-session-composer-stack")
    expect(getComposerSendButton()).toBeEnabled()

    setComposerDraftValue(createSessionDraft, "Ship the first session prompt")
    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(window.desktop!.createFolderSession).toHaveBeenCalledWith({
        projectID: "project-2",
        directory: "C:\\Projects\\Project 2\\app",
      })
    })
    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "session-backend-new",
        text: "Ship the first session prompt",
        skills: [],
      }))
    })

    expect(await screen.findByRole("button", { name: "Backend chat" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Session project" })).not.toBeInTheDocument()
  })

  it("shows the first optimistic user message while the new session model selection is still saving", async () => {
    const pendingModelSelection = createDeferred<{
      model: string
    }>()
    const model = createProviderModelFixture()
    const modelPayload = {
      items: [model],
      selection: {
        model: "openai/gpt-5",
      },
    }
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.getProjectModels = vi.fn().mockResolvedValue(modelPayload)
    window.desktop!.getSessionModels = vi.fn().mockResolvedValue(modelPayload)
    window.desktop!.updateSessionModelSelection = vi.fn(() => pendingModelSelection.promise)
    window.desktop!.createFolderSession = vi.fn().mockResolvedValue({
      session: {
        id: "session-backend-optimistic",
        projectID: "project-2",
        directory: "C:\\Projects\\Project 2\\app",
        title: "Optimistic backend chat",
        created: 1,
        updated: 2,
      },
    })

    render(<App />)

    fireEvent.click(getAddSessionTabButton())
    await screen.findByRole("combobox", { name: "Session project" })
    await screen.findByRole("button", { name: "Select model: GPT-5" })

    setComposerDraftValue(
      screen.getByRole("textbox", { name: "Task draft" }),
      "Show the first optimistic prompt",
    )
    fireEvent.click(getComposerSendButton())

    expect(await screen.findByRole("button", { name: "Optimistic backend chat" })).toBeInTheDocument()
    expect(
      await screen.findByText("Show the first optimistic prompt", {
        selector: ".user-bubble-text",
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole("status", { name: /Sending message|正在发送消息/ })).toBeInTheDocument()
    expect(window.desktop!.agentSession!.sendTurn).not.toHaveBeenCalled()

    await act(async () => {
      pendingModelSelection.resolve({
        model: "openai/gpt-5",
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "session-backend-optimistic",
        text: "Show the first optimistic prompt",
        model: {
          providerID: "openai",
          modelID: "gpt-5",
        },
      }))
    })
  })

  it("shows one usage tip without prompt examples on the create session canvas", async () => {
    render(<App />)

    fireEvent.click(getAddSessionTabButton())
    await screen.findByRole("combobox", { name: "Session project" })

    expect(screen.queryByText("What should we build in Anybox?")).not.toBeInTheDocument()
    expect(screen.getAllByTitle("Click to show another tip")).toHaveLength(1)
    expect(screen.queryByRole("heading", { name: "Start with a concrete task" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Prompt examples")).not.toBeInTheDocument()
  })

  it("creates a backend session in the active workspace directory for local sessions", async () => {
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.createAgentSession = vi.fn().mockResolvedValue({
      session: {
        id: "session-backend-local",
        projectID: "project-2",
        directory: "C:\\Projects\\Project 2\\app",
        title: "Seed backend session",
        created: 1,
        updated: 1,
      },
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.getAgentHealth).toHaveBeenCalledTimes(1)
    })

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Inspect the seeded workspace")
    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(window.desktop!.createAgentSession).toHaveBeenCalledWith({
        directory: "C:\\Projects\\Project 2\\app",
      })
    })
    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "session-backend-local",
        text: "Inspect the seeded workspace",
        skills: [],
      }))
    })
  })

  it("renders the first streamed response immediately after sending from the create session canvas", async () => {
    let streamListener: DesktopAgentSessionEventListener | undefined
    let releaseStream: (() => void) | undefined
    let activeStreamID = ""
    let activeSessionID = ""

    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.createFolderSession = vi.fn().mockResolvedValue({
      session: {
        id: "session-backend-streamed",
        projectID: "project-2",
        directory: "C:\\Projects\\Project 2\\app",
        title: "Streamed backend chat",
        created: 1,
        updated: 2,
      },
    })
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      streamListener = listener
      return vi.fn()
    })
    window.desktop!.agentSession!.sendTurn = vi.fn().mockImplementation(
      async (input: {
        clientTurnID: string
        backendSessionID: string
        text: string
      }) => {
        activeStreamID = input.clientTurnID
        activeSessionID = input.backendSessionID

        await new Promise<void>((resolve) => {
          releaseStream = resolve
        })

        return {
          clientTurnID: input.clientTurnID,
        }
      },
    )

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.onEvent).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(getAddSessionTabButton())
    await screen.findByRole("combobox", { name: "Session project" })

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Stream the first session prompt")
    await act(async () => {
      fireEvent.click(getComposerSendButton())
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        clientTurnID: expect.any(String),
        backendSessionID: "session-backend-streamed",
        text: "Stream the first session prompt",
        skills: [],
      }))
    })
    expect(await screen.findByRole("button", { name: "Streamed backend chat" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Session project" })).not.toBeInTheDocument()
    expect(screen.getByText("Preparing...")).toBeInTheDocument()

    await act(async () => {
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        event: "delta",
        data: {
          kind: "text",
          partID: "part-text-1",
          delta: "First token is visible.",
          text: "First token is visible.",
        },
      }))
      await Promise.resolve()
    })

    expect(await screen.findByText("First token is visible.")).toBeInTheDocument()

    await act(async () => {
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        event: "done",
        data: {
          sessionID: activeSessionID,
          parts: [{ id: "part-text-1", type: "text", text: "First token is visible." }],
        },
      }))
      releaseStream?.()
      await Promise.resolve()
    })
  })

  it("opens global provider settings", async () => {
    window.desktop!.getGlobalProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "openai",
        name: "OpenAI",
        source: "api",
        env: ["OPENAI_API_KEY"],
        configured: false,
        available: false,
        apiKeyConfigured: false,
        baseURL: "https://api.openai.com/v1",
        modelCount: 0,
      },
      {
        id: "deepseek",
        name: "DeepSeek",
        source: "config",
        env: ["DEEPSEEK_API_KEY"],
        configured: true,
        available: true,
        apiKeyConfigured: true,
        baseURL: "https://api.deepseek.com",
        modelCount: 1,
      },
    ])
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [
        {
          id: "deepseek-reasoner",
          providerID: "deepseek",
          name: "DeepSeek Reasoner",
          status: "active",
          available: true,
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: false,
            toolcall: true,
            input: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
          },
          limit: {
            context: 128000,
            output: 8192,
          },
        },
      ],
      selection: {
        model: "deepseek/deepseek-reasoner",
      },
    })

    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))

    const settingsDialog = await screen.findByRole("dialog", { name: "Settings" })

    expect(settingsDialog).toHaveClass("settings-page")
    expect(screen.getByRole("button", { name: "Close settings" })).toBeInTheDocument()
    expect(screen.queryByText("Global settings")).not.toBeInTheDocument()
    expect(screen.queryByText("Manage shared providers and models for the app.")).not.toBeInTheDocument()
    expect(Array.from(settingsDialog.querySelectorAll(".settings-primary-nav-label"), (node) => node.textContent)).toEqual([
      "General",
      "Account",
      "Provider",
      "Models",
      "Appearance",
      "Developer Mode",
      "Environments",
      "Storage",
      "Archived Sessions",
    ])
    expect(screen.getByText("Options")).toBeInTheDocument()
    const providerNavButton = screen.getByRole("button", { name: "Provider" })
    expect(providerNavButton).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Worktrees" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Updates" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Models" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Tools" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Archived Sessions" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Appearance" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Developer Mode" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "MCP" })).not.toBeInTheDocument()
    expect(screen.queryByText("Choose a provider on the left, then edit the shared credentials and endpoint used across the app.")).not.toBeInTheDocument()
    expect(screen.queryByText("Providers discovered from the catalog, environment, and saved config.")).not.toBeInTheDocument()
    expect(screen.queryByText("Search providers")).not.toBeInTheDocument()
    fireEvent.click(providerNavButton)
    expect(await screen.findByRole("button", { name: "Refresh provider catalog" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "Text" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Image" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Video" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Connected" })).toBeInTheDocument()
    expect(await screen.findByRole("searchbox", { name: "Search providers" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /DeepSeek.*Connected/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /OpenAI.*Not connected/ })).toBeInTheDocument()
    expect(screen.queryByText("Catalog")).not.toBeInTheDocument()
    expect(screen.queryByText("No known models yet")).not.toBeInTheDocument()
    expect(screen.queryByText("1 known models")).not.toBeInTheDocument()
    expect(await screen.findByRole("heading", { name: "DeepSeek" })).toBeInTheDocument()
    expect(screen.getByText("Connection method")).toBeInTheDocument()
    expect(screen.queryByText("Choose how this provider authenticates.")).not.toBeInTheDocument()
    expect(screen.getByText("Use environment variable DEEPSEEK_API_KEY")).toBeInTheDocument()
    expect(
      screen.queryByText("Current connection comes from environment variables. Update the local environment to change it."),
    ).not.toBeInTheDocument()
    expect(screen.getByText("Advanced settings")).toBeInTheDocument()
    expect(screen.queryByText("Override the provider default endpoint.")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Exposed models" })).toBeInTheDocument()
    expect(settingsDialog.querySelector(".settings-detail-hero")).toBeNull()
    expect(screen.queryByText("Provider ID")).not.toBeInTheDocument()
    expect(screen.queryByText("Environment")).not.toBeInTheDocument()
    expect(screen.queryByText("Save shared credentials and endpoint overrides for this provider.")).not.toBeInTheDocument()
    expect(screen.queryByText("Edit the shared credentials and endpoint the app should use when routing to DeepSeek.")).not.toBeInTheDocument()
    expect(screen.queryByText("Reset removes the saved provider configuration and falls back to environment or catalog defaults.")).not.toBeInTheDocument()
    expect(screen.getByLabelText("API key for DeepSeek")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Test connection" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save DeepSeek settings" })).toHaveTextContent("Save")

    const providerList = screen.getByRole("list", { name: "Provider list" })
    const providerButtons = within(providerList).getAllByRole("button")
    expect(providerButtons[0]).toHaveTextContent("DeepSeek")
    expect(providerButtons[1]).toHaveTextContent("OpenAI")
    expect(within(providerList).queryByText("Connected")).not.toBeInTheDocument()
    expect(within(providerList).queryByText("Not connected")).not.toBeInTheDocument()
    expect(providerList.querySelectorAll(".settings-status-indicator")).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: /^Models/ }))

    expect(screen.getByRole("button", { name: "Primary model: DeepSeek / DeepSeek Reasoner" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Unified Models" })).toBeInTheDocument()
    expect(screen.getByText("DeepSeek Reasoner")).toBeInTheDocument()

    await waitFor(() => {
      expect(window.desktop!.getGlobalProviderCatalog).toHaveBeenCalledTimes(1)
      expect(window.desktop!.getGlobalModels).toHaveBeenCalledTimes(1)
    })
  })

  it("opens the update center as a global app modal from settings", async () => {
    window.desktop!.getAppUpdateState = vi.fn().mockResolvedValue(createAppUpdateState({
      phase: "downloaded",
      latestVersion: "1.2.4",
      downloadPercent: 100,
      lastCheckedAt: 1,
      releaseNotes: "Improved update experience.",
    }))
    window.desktop!.installAppUpdate = vi.fn().mockResolvedValue({ ok: true })

    const { container } = render(<App />)

    const automaticUpdateDialog = await screen.findByRole("dialog", { name: "Update ready to install" })
    fireEvent.click(within(automaticUpdateDialog).getByRole("button", { name: "Later" }))
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Update ready to install" })).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })

    fireEvent.click(await screen.findByRole("button", { name: /Open update center/i }))

    const updateDialog = await screen.findByRole("dialog", { name: "Update ready to install" })
    expect(updateDialog.closest(".settings-page")).toBeNull()
    expect(container.querySelector(".app-shell > .update-center-overlay")).not.toBeNull()
    expect(screen.getAllByText(/Anybox 1\.2\.4/).length).toBeGreaterThan(0)
    expect(screen.getByText("Improved update experience.")).toBeInTheDocument()

    fireEvent.keyDown(window, { key: "Escape" })
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Update ready to install" })).not.toBeInTheDocument()
    })
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Open update center/i }))
    expect(await screen.findByRole("dialog", { name: "Update ready to install" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Restart to install/i }))
    await waitFor(() => expect(window.desktop!.installAppUpdate).toHaveBeenCalledTimes(1))
  })

  it("opens automatic update prompts while downloading and when ready", async () => {
    let appUpdateListener: ((state: DesktopAppUpdateState) => void) | null = null
    window.desktop!.onAppUpdateStateChange = vi.fn((listener: (state: DesktopAppUpdateState) => void) => {
      appUpdateListener = listener
      return vi.fn()
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.onAppUpdateStateChange).toHaveBeenCalledTimes(1)
    })

    act(() => {
      appUpdateListener?.(createAppUpdateState({
        phase: "downloading",
        latestVersion: "1.2.4",
        downloadPercent: 39.4,
        downloadTransferredBytes: 62_495_334,
        downloadTotalBytes: 158_544_691,
        downloadBytesPerSecond: 20_866_662,
      }))
    })

    const downloadDialog = await screen.findByRole("dialog", { name: "Downloading update" })
    expect(within(downloadDialog).getByText("59.6 MB / 151.2 MB")).toBeInTheDocument()
    expect(within(downloadDialog).getByText("19.9 MB/s")).toBeInTheDocument()

    fireEvent.click(within(downloadDialog).getByRole("button", { name: "Download in background" }))
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Downloading update" })).not.toBeInTheDocument()
    })

    act(() => {
      appUpdateListener?.(createAppUpdateState({
        phase: "downloaded",
        latestVersion: "1.2.4",
        downloadPercent: 100,
        downloadTransferredBytes: 158_544_691,
        downloadTotalBytes: 158_544_691,
        releaseNotes: "Improved update experience.",
      }))
    })

    const readyDialog = await screen.findByRole("dialog", { name: "Update ready to install" })
    expect(within(readyDialog).getAllByText(/Anybox 1\.2\.4/).length).toBeGreaterThan(0)
    expect(within(readyDialog).getByRole("button", { name: "Restart to install" })).toBeInTheDocument()
  })

  it("defers automatic update prompts while an agent session is running", async () => {
    let appUpdateListener: ((state: DesktopAppUpdateState) => void) | null = null
    window.desktop!.onAppUpdateStateChange = vi.fn((listener: (state: DesktopAppUpdateState) => void) => {
      appUpdateListener = listener
      return vi.fn()
    })
    window.desktop!.getRunningSessionStatus = vi.fn()
      .mockResolvedValueOnce({
        running: true,
        count: 1,
        sessionIDs: ["session-running"],
        checkedAt: 1,
      })
      .mockResolvedValue({
        running: false,
        count: 0,
        sessionIDs: [],
        checkedAt: 2,
      })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.onAppUpdateStateChange).toHaveBeenCalledTimes(1)
    })

    act(() => {
      appUpdateListener?.(createAppUpdateState({
        phase: "downloaded",
        latestVersion: "1.2.4",
        downloadPercent: 100,
        releaseNotes: "Improved update experience.",
      }))
    })

    await waitFor(() => {
      expect(window.desktop!.getRunningSessionStatus).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole("dialog", { name: "Update ready to install" })).not.toBeInTheDocument()

    act(() => {
      appUpdateListener?.(createAppUpdateState({
        phase: "downloaded",
        latestVersion: "1.2.4",
        downloadPercent: 100,
        lastCheckedAt: 2,
        releaseNotes: "Improved update experience.",
      }))
    })

    expect(await screen.findByRole("dialog", { name: "Update ready to install" })).toBeInTheDocument()
  })

  it("blocks restart-to-install while an agent session is running", async () => {
    window.desktop!.getAppUpdateState = vi.fn().mockResolvedValue(createAppUpdateState({
      phase: "downloaded",
      latestVersion: "1.2.4",
      downloadPercent: 100,
      lastCheckedAt: 1,
    }))
    window.desktop!.getRunningSessionStatus = vi.fn()
      .mockResolvedValueOnce({
        running: false,
        count: 0,
        sessionIDs: [],
        checkedAt: 1,
      })
      .mockResolvedValueOnce({
        running: true,
        count: 1,
        sessionIDs: ["session-running"],
        checkedAt: 2,
      })
    window.desktop!.installAppUpdate = vi.fn().mockResolvedValue({ ok: true })

    render(<App />)

    const updateDialog = await screen.findByRole("dialog", { name: "Update ready to install" })
    fireEvent.click(within(updateDialog).getByRole("button", { name: "Restart to install" }))

    await waitFor(() => {
      expect(window.desktop!.getRunningSessionStatus).toHaveBeenCalledTimes(2)
    })
    expect(window.desktop!.installAppUpdate).not.toHaveBeenCalled()
    expect(
      within(updateDialog).getByText("A session is running. Restart to install after the task finishes."),
    ).toBeInTheDocument()
  })

  it("edits prompt presets from the prompts page", async () => {
    let promptPresetSelection = { ...PROMPT_PRESET_SELECTION_FIXTURE }
    let promptPresetDocuments = [
      createPromptPresetDocument("system-default"),
      createPromptPresetDocument("plan-mode"),
      createPromptPresetDocument("git-commit-message"),
      createPromptPresetDocument("cinema-text-generation"),
      createPromptPresetDocument("provider-gpt"),
    ]

    function listPromptPresetSummaries() {
      return promptPresetDocuments.map(({ content, ...summary }) => summary)
    }

    function readPromptPresetDocumentForTest(presetID: string) {
      const preset = promptPresetDocuments.find((item) => item.id === presetID)
      if (!preset) {
        throw new Error(`Unknown prompt preset '${presetID}'`)
      }

      return preset
    }

    function upsertPromptPresetDocument(document: ReturnType<typeof createPromptPresetDocument>) {
      promptPresetDocuments = promptPresetDocuments.some((preset) => preset.id === document.id)
        ? promptPresetDocuments.map((preset) => (preset.id === document.id ? document : preset))
        : [...promptPresetDocuments, document]
    }

    window.desktop!.getPromptPresets = vi.fn().mockImplementation(() =>
      Promise.resolve(listPromptPresetSummaries()),
    )
    window.desktop!.getPromptPresetSelection = vi.fn().mockImplementation(() =>
      Promise.resolve({ ...promptPresetSelection }),
    )
    window.desktop!.readPromptPreset = vi.fn().mockImplementation(({ presetID }: { presetID: string }) =>
      Promise.resolve(readPromptPresetDocumentForTest(presetID)),
    )
    window.desktop!.createPromptPreset = vi.fn().mockImplementation((input: {
      label?: string
      content?: string
      description?: string
    }) => {
      const label = input.label ?? "Untitled preset"
      const presetID =
        label === "Untitled preset"
          ? "custom-untitled-preset"
          : `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`
      const document = createPromptPresetDocument(presetID, {
        label,
        source: "custom",
        description: input.description ?? "Custom prompt preset.",
        content: input.content ?? "",
      })
      upsertPromptPresetDocument(document)
      return Promise.resolve(document)
    })
    window.desktop!.updatePromptPresetSelection = vi.fn().mockImplementation((input: typeof PROMPT_PRESET_SELECTION_FIXTURE) => {
      promptPresetSelection = { ...input }
      return Promise.resolve(promptPresetSelection)
    })
    window.desktop!.updatePromptPreset = vi.fn().mockImplementation(
      ({ presetID, label, content }: { presetID: string; label?: string; content: string }) => {
        const current = readPromptPresetDocumentForTest(presetID)
        const nextDocument = {
          ...current,
          label: label ?? current.label,
          content,
          hasOverride: current.source === "bundled" ? true : false,
        }
        upsertPromptPresetDocument(nextDocument)
        return Promise.resolve(nextDocument)
      },
    )
    window.desktop!.resetPromptPreset = vi.fn().mockImplementation(({ presetID }: { presetID: string }) => {
      const nextDocument = createPromptPresetDocument(presetID, {
        hasOverride: false,
      })
      upsertPromptPresetDocument(nextDocument)
      return Promise.resolve(nextDocument)
    })
    window.desktop!.deletePromptPreset = vi.fn().mockImplementation(({ presetID }: { presetID: string }) => {
      promptPresetDocuments = promptPresetDocuments.filter((preset) => preset.id !== presetID)
      promptPresetSelection = {
        systemPromptPresetID:
          promptPresetSelection.systemPromptPresetID === presetID
            ? "system-default"
            : promptPresetSelection.systemPromptPresetID,
        planModePromptPresetID: promptPresetSelection.planModePromptPresetID,
        gitCommitPromptPresetID:
          promptPresetSelection.gitCommitPromptPresetID === presetID
            ? "git-commit-message"
            : promptPresetSelection.gitCommitPromptPresetID,
        cinemaTextGenerationPromptPresetID:
          promptPresetSelection.cinemaTextGenerationPromptPresetID === presetID
            ? "cinema-text-generation"
            : promptPresetSelection.cinemaTextGenerationPromptPresetID,
      }
      return Promise.resolve(promptPresetSelection)
    })
    window.desktop!.previewPromptUrlInstall = vi.fn().mockResolvedValue({
      previewID: "prompt-preview-1",
      source: "https://github.com/acme/prompts/tree/main/prompts",
      prompts: [
        {
          id: "remote-system-prompt",
          label: "Remote System Prompt",
          description: "Downloaded prompt.",
          sourcePath: "https://github.com/acme/prompts/blob/main/prompts/system.md",
          available: true,
        },
      ],
    })
    window.desktop!.installPromptsFromUrl = vi.fn().mockImplementation(() => {
      const document = createPromptPresetDocument("custom-remote-system-prompt", {
        label: "Remote System Prompt",
        source: "custom",
        description: "Downloaded prompt.",
        sourcePath: "https://github.com/acme/prompts/blob/main/prompts/system.md",
        content: "remote installed prompt",
      })
      upsertPromptPresetDocument(document)
      return Promise.resolve({
        installed: [document],
      })
    })

    render(<App />)

    openActivityRailConfigurationView("Open prompts")

    function getPromptPresetCombobox(name: string) {
      return screen.getByRole("combobox", { name })
    }

    async function choosePromptPreset(name: string, optionName: string) {
      fireEvent.click(getPromptPresetCombobox(name))
      fireEvent.click(await screen.findByRole("option", { name: optionName }))
    }

    expect(document.querySelector("#app-sidebar")).toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "Inspector sidebar" })).not.toBeInTheDocument()
    const promptTree = await screen.findByRole("list", { name: "Prompt presets" })
    const bundledPromptFolder = within(promptTree).getByRole("button", { name: "Bundled prompt folder" })
    expect(bundledPromptFolder.querySelector(".skill-tree-leading")).toBeNull()
    expect(bundledPromptFolder.firstElementChild).toHaveClass("skill-tree-role-icon", "is-folder")
    expect(promptTree.lastElementChild).toHaveClass("prompt-presets-new-menu-shell")
    expect(within(promptTree.lastElementChild as HTMLElement).getByRole("button", { name: "New" })).toBeInTheDocument()
    expect(
      Array.from(document.querySelectorAll(".settings-prompt-assignment-title"), (node) => node.textContent),
    ).toEqual([
      "System prompt",
      "Plan mode prompt",
      "Git commit message prompt",
      "Cinema text generation prompt",
    ])
    expect(screen.queryByText("Every execution")).not.toBeInTheDocument()
    expect(screen.queryByText("Plan only")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "System prompt" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Plan mode prompt" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Git commit message prompt" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cinema text generation prompt" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "GPT Provider Prompt" })).toBeInTheDocument()
    expect(getPromptPresetCombobox("System prompt preset")).toHaveTextContent("System prompt")
    expect(getPromptPresetCombobox("Plan mode prompt preset")).toHaveTextContent("Plan mode prompt")
    expect(getPromptPresetCombobox("Git commit message prompt preset")).toHaveTextContent("Git commit message prompt")
    expect(screen.queryByRole("button", { name: /Confirm .* prompt preset/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Plan mode prompt" }))

    await waitFor(() => {
      expect(window.desktop!.readPromptPreset).toHaveBeenCalledWith({
        presetID: "plan-mode",
      })
    })

    fireEvent.click(screen.getByRole("button", { name: "Preview" }))

    const planPreview = screen.getByRole("region", { name: "Plan mode prompt markdown preview" })
    expect(planPreview).toHaveTextContent("<system-reminder>")
    expect(within(planPreview).getByRole("heading", { name: "Plan Mode - System Reminder" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    expect(screen.getByRole("textbox", { name: "Plan mode prompt content" })).toHaveValue(
      "<system-reminder>\n# Plan Mode - System Reminder",
    )

    await choosePromptPreset("System prompt preset", "GPT Provider Prompt")

    await waitFor(() => {
      expect(window.desktop!.updatePromptPresetSelection).toHaveBeenCalledWith({
        systemPromptPresetID: "provider-gpt",
        planModePromptPresetID: "plan-mode",
        gitCommitPromptPresetID: "git-commit-message",
        cinemaTextGenerationPromptPresetID: "cinema-text-generation",
      })
    })

    fireEvent.click(screen.getByRole("button", { name: "New" }))

    expect(await screen.findByDisplayValue("Untitled preset")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Preset name"), {
      target: {
        value: "Focus preset",
      },
    })

    const customTextarea = screen.getByRole("textbox", { name: "Untitled preset content" })
    fireEvent.change(customTextarea, {
      target: {
        value: "custom system prompt",
      },
    })

    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(window.desktop!.updatePromptPreset).toHaveBeenCalledWith({
        presetID: "custom-untitled-preset",
        label: "Focus preset",
        content: "custom system prompt",
      })
    })

    await choosePromptPreset("System prompt preset", "Focus preset")

    await waitFor(() => {
      expect(window.desktop!.updatePromptPresetSelection).toHaveBeenLastCalledWith({
        systemPromptPresetID: "custom-untitled-preset",
        planModePromptPresetID: "plan-mode",
        gitCommitPromptPresetID: "git-commit-message",
        cinemaTextGenerationPromptPresetID: "cinema-text-generation",
      })
    })

    await choosePromptPreset("Git commit message prompt preset", "Focus preset")

    await waitFor(() => {
      expect(window.desktop!.updatePromptPresetSelection).toHaveBeenLastCalledWith({
        systemPromptPresetID: "custom-untitled-preset",
        planModePromptPresetID: "plan-mode",
        gitCommitPromptPresetID: "custom-untitled-preset",
        cinemaTextGenerationPromptPresetID: "cinema-text-generation",
      })
    })

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    await waitFor(() => {
      expect(window.desktop!.deletePromptPreset).toHaveBeenCalledWith({
        presetID: "custom-untitled-preset",
      })
    })

    expect(await screen.findByText("Prompt preset deleted.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Install prompt" }))
    fireEvent.click(screen.getByRole("menuitem", { name: "From URL" }))

    const promptUrlInstallDialog = await screen.findByRole("dialog", { name: "Install prompts from URL" })
    fireEvent.change(within(promptUrlInstallDialog).getByRole("textbox", { name: "Prompt resource URL" }), {
      target: {
        value: "https://github.com/acme/prompts/tree/main/prompts",
      },
    })
    fireEvent.click(within(promptUrlInstallDialog).getByRole("button", { name: "Preview" }))

    await waitFor(() => {
      expect(window.desktop!.previewPromptUrlInstall).toHaveBeenCalledWith({
        source: "https://github.com/acme/prompts/tree/main/prompts",
      })
    })
    expect(within(promptUrlInstallDialog).getByText("Remote System Prompt")).toBeInTheDocument()

    fireEvent.click(within(promptUrlInstallDialog).getByRole("button", { name: "Install (1)" }))

    await waitFor(() => {
      expect(window.desktop!.installPromptsFromUrl).toHaveBeenCalledWith({
        previewID: "prompt-preview-1",
        promptIDs: ["remote-system-prompt"],
      })
    })

    expect(await screen.findByText("Installed 1 prompt.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Remote System Prompt" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Remote System Prompt content" })).toHaveValue(
      "remote installed prompt",
    )

    await choosePromptPreset("System prompt preset", "GPT Provider Prompt")
    fireEvent.click(screen.getByRole("button", { name: "GPT Provider Prompt" }))

    await waitFor(() => {
      expect(window.desktop!.readPromptPreset).toHaveBeenCalledWith({
        presetID: "provider-gpt",
      })
    })

    const bundledTextarea = screen.getByRole("textbox", { name: "GPT Provider Prompt content" })
    expect(bundledTextarea).toHaveAttribute("readonly")
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Make custom copy" }))

    await waitFor(() => {
      expect(window.desktop!.createPromptPreset).toHaveBeenLastCalledWith({
        label: "GPT Provider Prompt (Custom)",
        content: "GPT provider prompt placeholder. This preset is currently inactive.",
        description: "Reserved provider-specific prompt for GPT-family models.",
      })
    })
    await waitFor(() => {
      expect(window.desktop!.updatePromptPresetSelection).toHaveBeenLastCalledWith({
        systemPromptPresetID: "custom-gpt-provider-prompt-custom",
        planModePromptPresetID: "plan-mode",
        gitCommitPromptPresetID: "git-commit-message",
        cinemaTextGenerationPromptPresetID: "cinema-text-generation",
      })
    })

    const customCopyTextarea = await screen.findByRole("textbox", {
      name: "GPT Provider Prompt (Custom) content",
    })
    expect(customCopyTextarea).not.toHaveAttribute("readonly")
    fireEvent.change(customCopyTextarea, {
      target: {
        value: "custom gpt provider prompt",
      },
    })

    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(window.desktop!.updatePromptPreset).toHaveBeenCalledWith({
        presetID: "custom-gpt-provider-prompt-custom",
        label: "GPT Provider Prompt (Custom)",
        content: "custom gpt provider prompt",
      })
    })

    expect(await screen.findByText("Prompt preset saved.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument()
  })

  it("translates prompt presets into a new custom prompt without changing the current selection", async () => {
    const simplifiedChineseLabel = "\u7b80\u4f53\u4e2d\u6587"
    const traditionalChineseLabel = "\u7e41\u9ad4\u4e2d\u6587"
    const translatedLabel = `System prompt - ${simplifiedChineseLabel}`
    const draftContent = "Draft source prompt with {{user_name}} and /absolute/path."
    let promptPresetDocuments = [
      createPromptPresetDocument("system-default"),
      createPromptPresetDocument("plan-mode"),
      createPromptPresetDocument("git-commit-message"),
      createPromptPresetDocument("cinema-text-generation"),
      createPromptPresetDocument("provider-gpt"),
    ]

    function listPromptPresetSummaries() {
      return promptPresetDocuments.map(({ content, ...summary }) => summary)
    }

    function readPromptPresetDocumentForTest(presetID: string) {
      const preset = promptPresetDocuments.find((item) => item.id === presetID)
      if (!preset) {
        throw new Error(`Unknown prompt preset '${presetID}'`)
      }

      return preset
    }

    function upsertPromptPresetDocument(document: ReturnType<typeof createPromptPresetDocument>) {
      promptPresetDocuments = promptPresetDocuments.some((preset) => preset.id === document.id)
        ? promptPresetDocuments.map((preset) => (preset.id === document.id ? document : preset))
        : [...promptPresetDocuments, document]
    }

    const textModel = createProviderModelFixture()
    const nonTextOutputModel = createProviderModelFixture({
      id: "image-only",
      name: "Image Only",
      capabilities: {
        ...textModel.capabilities,
        output: {
          ...textModel.capabilities.output,
          text: false,
          image: true,
        },
      },
    })
    const unavailableModel = createProviderModelFixture({
      id: "unavailable",
      name: "Unavailable Model",
      available: false,
    })

    window.desktop!.getPromptPresets = vi.fn().mockImplementation(() =>
      Promise.resolve(listPromptPresetSummaries()),
    )
    window.desktop!.getPromptPresetSelection = vi.fn().mockResolvedValue(PROMPT_PRESET_SELECTION_FIXTURE)
    window.desktop!.readPromptPreset = vi.fn().mockImplementation(({ presetID }: { presetID: string }) =>
      Promise.resolve(readPromptPresetDocumentForTest(presetID)),
    )
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [
        textModel,
        nonTextOutputModel,
        unavailableModel,
      ],
      selection: {},
    })
    window.desktop!.updatePromptPresetSelection = vi.fn().mockResolvedValue(PROMPT_PRESET_SELECTION_FIXTURE)
    window.desktop!.translatePromptPreset = vi.fn().mockImplementation(() => {
      const document = createPromptPresetDocument("custom-system-prompt-zh-hans", {
        label: translatedLabel,
        source: "custom",
        description: "Translated prompt.",
        content: "translated prompt",
      })
      upsertPromptPresetDocument(document)
      return Promise.resolve(document)
    })

    render(<App />)

    openActivityRailConfigurationView("Open prompts")

    const systemTextarea = await screen.findByRole("textbox", { name: "System prompt content" })
    fireEvent.change(systemTextarea, {
      target: {
        value: draftContent,
      },
    })

    await waitFor(() => {
      expect(window.desktop!.getGlobalModels).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole("button", { name: "Translate" }))

    const dialog = await screen.findByRole("dialog", { name: "Translate prompt" })
    const languageSelect = within(dialog).getByRole("combobox", { name: "Prompt translation language" })
    expect(languageSelect).toHaveTextContent(simplifiedChineseLabel)

    fireEvent.click(languageSelect)
    const languageListbox = screen.getByRole("listbox", { name: "Prompt translation language" })
    expect(within(languageListbox).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "English",
      simplifiedChineseLabel,
      traditionalChineseLabel,
      "Spanish",
      "French",
      "German",
      "Portuguese",
      "Italian",
      "Japanese",
      "Korean",
      "Dutch",
      "Russian",
    ])
    fireEvent.click(within(languageListbox).getByRole("option", { name: simplifiedChineseLabel }))

    const submitButton = within(dialog).getByRole("button", { name: "Translate" })
    const modelSelect = within(dialog).getByRole("combobox", { name: "Prompt translation model" })
    expect(modelSelect).toHaveTextContent("Select model")
    expect(submitButton).toBeDisabled()

    fireEvent.click(modelSelect)
    const modelListbox = screen.getByRole("listbox", { name: "Prompt translation model" })
    const gptModelOption = within(modelListbox).getByRole("option", { name: /GPT-5/ })
    expect(gptModelOption).toBeInTheDocument()
    expect(within(modelListbox).queryByRole("option", { name: /Image Only/ })).not.toBeInTheDocument()
    expect(within(modelListbox).queryByRole("option", { name: /Unavailable Model/ })).not.toBeInTheDocument()
    fireEvent.click(gptModelOption)

    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(window.desktop!.translatePromptPreset).toHaveBeenCalledWith({
        sourcePresetID: "system-default",
        sourceLabel: "System prompt",
        content: draftContent,
        languageID: "zh-Hans",
        model: "openai/gpt-5",
      })
    })

    expect(await screen.findByText(`Translated prompt saved as "${translatedLabel}".`)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: translatedLabel })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "System prompt content" })).toHaveValue(draftContent)
    expect(screen.getByRole("combobox", { name: "System prompt preset" })).toHaveTextContent("System prompt")
    expect(window.desktop!.updatePromptPresetSelection).not.toHaveBeenCalled()
  })

  it("refreshes the global provider catalog from settings", async () => {
    const refreshCatalog = createDeferred<
      {
        id: string
        name: string
        source: string
        env: string[]
        configured: boolean
        available: boolean
        apiKeyConfigured: boolean
        baseURL: string
        modelCount: number
      }[]
    >()

    window.desktop!.getGlobalProviderCatalog = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "deepseek",
          name: "DeepSeek",
          source: "api",
          env: ["DEEPSEEK_API_KEY"],
          configured: false,
          available: false,
          apiKeyConfigured: false,
          baseURL: "https://api.deepseek.com",
          modelCount: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "openai",
          name: "OpenAI",
          source: "api",
          env: ["OPENAI_API_KEY"],
          configured: false,
          available: false,
          apiKeyConfigured: false,
          baseURL: "https://api.openai.com/v1",
          modelCount: 2,
        },
        {
          id: "deepseek",
          name: "DeepSeek",
          source: "api",
          env: ["DEEPSEEK_API_KEY"],
          configured: false,
          available: false,
          apiKeyConfigured: false,
          baseURL: "https://api.deepseek.com",
          modelCount: 1,
        },
      ])
    window.desktop!.getGlobalModels = vi
      .fn()
      .mockResolvedValueOnce({
        items: [],
        selection: {},
      })
      .mockResolvedValueOnce({
        items: [],
        selection: {},
      })
    window.desktop!.refreshGlobalProviderCatalog = vi.fn().mockImplementation(() => refreshCatalog.promise)

    render(<App />)

    await openProviderSettingsSection()

    const refreshButton = screen.getByRole("button", { name: "Refresh provider catalog" })
    fireEvent.click(refreshButton)

    expect(refreshButton).toBeDisabled()
    expect(refreshButton).toHaveTextContent("Refreshing...")

    refreshCatalog.resolve([
      {
        id: "openai",
        name: "OpenAI",
        source: "api",
        env: ["OPENAI_API_KEY"],
        configured: false,
        available: false,
        apiKeyConfigured: false,
        baseURL: "https://api.openai.com/v1",
        modelCount: 2,
      },
      {
        id: "deepseek",
        name: "DeepSeek",
        source: "api",
        env: ["DEEPSEEK_API_KEY"],
        configured: false,
        available: false,
        apiKeyConfigured: false,
        baseURL: "https://api.deepseek.com",
        modelCount: 1,
      },
    ])

    await waitFor(() => {
      expect(window.desktop!.refreshGlobalProviderCatalog).toHaveBeenCalledTimes(1)
      expect(window.desktop!.getGlobalProviderCatalog).toHaveBeenCalledTimes(2)
      expect(window.desktop!.getGlobalModels).toHaveBeenCalledTimes(2)
    })

    expect(await screen.findByText("Provider catalog refreshed.")).toBeInTheDocument()
    const refreshedToast = screen.getByText("Provider catalog refreshed.").closest(".toast-card")
    expect(refreshedToast).not.toBeNull()
    fireEvent.click(within(refreshedToast as HTMLElement).getByRole("button", { name: "Dismiss notification" }))
    expect(screen.queryByText("Provider catalog refreshed.")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /OpenAI.*Not connected/ })).toBeInTheDocument()
  })

  it("opens built-in tools from the activity rail and loads tool availability", async () => {
    window.desktop!.getBuiltinTools = vi.fn().mockResolvedValue({
      items: [
        {
          id: "git_bash_command",
          title: "Git Bash",
          description: "Run a Git Bash/MSYS Bash command inside the current project boundary.",
          aliases: [],
          capabilities: {
            kind: "exec",
            readOnly: false,
            destructive: true,
            concurrency: "exclusive",
            needsShell: true,
          },
        },
        {
          id: "read-file",
          title: "Read File",
          description: "Read a text file or a line range from the current project.",
          aliases: [],
          capabilities: {
            kind: "read",
            readOnly: true,
            destructive: false,
            concurrency: "safe",
          },
        },
      ],
      selection: {
        tools: {
          "read-file": false,
        },
      },
    })

    render(<App />)

    openActivityRailConfigurationView("Open tools")

    expect(screen.getByLabelText("Tools top menu")).toBeInTheDocument()
    expect(document.querySelector("#app-sidebar")).toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "Inspector sidebar" })).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument()
    expect(screen.queryByText("Pick a project first")).not.toBeInTheDocument()
    expect(await screen.findByText("Global tool availability")).toBeInTheDocument()
    expect(screen.getByText("1 of 2 built-in tools enabled.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Shell tools, 1 of 1 enabled" })).toBeInTheDocument()
    expect(screen.getByText("Git Bash")).toBeInTheDocument()
    expect(screen.queryByText("Read File")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Read tools, 0 of 1 enabled" }))
    expect(screen.getByText("Read File")).toBeInTheDocument()

    await waitFor(() => {
      expect(window.desktop!.getBuiltinTools).toHaveBeenCalledTimes(1)
    })
  })

  it("opens platform connectors from the activity rail and runs diagnostics", async () => {
    const gmailDefinition = {
      id: "gmail",
      name: "Gmail",
      description: "Read and draft Gmail messages through a platform-managed connector.",
      category: "account_connector",
      publisher: "Anybox",
      risk: "medium",
      permissions: ["Read Gmail metadata"],
      tools: [
        {
          name: "search_email_ids",
          title: "Search email",
          description: "Search Gmail messages.",
          readOnly: true,
        },
      ],
      credential: {
        kind: "oauth",
        label: "Google account",
        clientID: "client",
        authorizationURL: "https://accounts.example.test/authorize",
        tokenURL: "https://accounts.example.test/token",
        scopes: ["gmail.readonly"],
      },
      runtime: {
        transport: "stdio",
        command: "node",
        args: ["gmail.js"],
        timeoutMs: 10_000,
      },
      mcpRuntimes: [{
        id: "default",
        name: "Gmail",
        available: true,
        transport: "stdio",
        command: "node",
        args: ["gmail.js"],
        timeoutMs: 10_000,
      }],
      installReview: ["Review Gmail OAuth scopes before connecting."],
      source: "platform",
      available: true,
    }
    const gmailStatus = {
      connectorID: "connector:gmail:default",
      definitionID: "gmail",
      name: "Gmail",
      connected: true,
      available: true,
      authStatus: "connected",
      credentialKind: "oauth",
      credentialLabel: "Google account",
      email: "person@example.test",
      mcpBindings: [{
        runtimeID: "default",
        serverID: "connector.gmail.default",
        name: "Gmail",
      }],
      generatedMcpServerID: "connector.gmail.default",
    }
    window.desktop!.getConnectorCatalog = vi.fn().mockResolvedValue([gmailDefinition])
    window.desktop!.getConnectors = vi.fn().mockResolvedValue([gmailStatus])
    window.desktop!.getConnector = vi.fn().mockResolvedValue(gmailStatus)
    window.desktop!.getGlobalMcpServers = vi.fn().mockResolvedValue([
      {
        id: "anybox.browser",
        name: "Browser",
        owner: {
          kind: "anybox",
          bindingID: "browser",
        },
        transport: "stdio",
        command: "node",
        enabled: true,
      },
      {
        id: "connector.gmail.default",
        name: "Gmail",
        owner: {
          kind: "connector",
          connectorId: "connector:gmail:default",
          runtimeID: "default",
        },
        transport: "connector",
        connectorId: "connector:gmail:default",
        connectorRuntimeId: "default",
        enabled: true,
      },
      {
        id: "anybox.node-repl",
        name: "Node REPL",
        owner: {
          kind: "anybox",
          bindingID: "node-repl",
        },
        transport: "stdio",
        command: "node",
        enabled: true,
      },
    ])
    window.desktop!.getConnectorDiagnostic = vi.fn().mockResolvedValue({
      serverID: "connector.gmail.default",
      enabled: true,
      ok: true,
      toolCount: 1,
      toolNames: ["search_email_ids"],
      tools: [],
    })

    render(<App />)

    openActivityRailConfigurationView("Open connections and extensions")

    expect(await screen.findByLabelText("Connections and extensions top menu")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "MCP 2" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "Connectors 1" }))
    expect(document.querySelector("#app-sidebar")).not.toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "Inspector sidebar" })).not.toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "Gmail Connected" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Browser Connected" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Node REPL Connected" })).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Gmail", level: 1 })).toBeInTheDocument()
    expect(screen.getByText("person@example.test")).toBeInTheDocument()

    const connectorTabs = screen.getByRole("tablist", { name: "Gmail connector settings" })
    fireEvent.click(within(connectorTabs).getByRole("tab", { name: "MCP" }))
    fireEvent.click(screen.getByRole("switch", { name: "Enable Gmail MCP runtime" }))
    await waitFor(() => {
      expect(window.desktop!.updateGlobalMcpServer).toHaveBeenCalledWith({
        serverID: "connector.gmail.default",
        server: expect.objectContaining({
          connectorId: "connector:gmail:default",
          enabled: false,
          transport: "connector",
        }),
      })
    })
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Diagnose" })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole("button", { name: "Diagnose" }))

    await waitFor(() => {
      expect(window.desktop!.getConnectorDiagnostic).toHaveBeenCalledWith({
        connectorID: "connector:gmail:default",
        runtimeID: "default",
      })
    })
    expect(await screen.findByLabelText("MCP tool permissions")).toBeInTheDocument()

    fireEvent.click(within(connectorTabs).getByRole("tab", { name: "Authentication" }))
    expect(within(connectorTabs).getByRole("tab", { name: "Authentication" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("person@example.test")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("tab", { name: "MCP 2" }))
    const mcpList = await screen.findByRole("list", { name: "MCP servers" })
    expect(within(mcpList).getByRole("button", { name: "Browser built into Anybox enabled" })).toBeInTheDocument()
    expect(within(mcpList).getByRole("button", { name: "Node REPL built into Anybox enabled" })).toBeInTheDocument()
    expect(within(mcpList).queryByRole("button", { name: /Gmail/ })).not.toBeInTheDocument()
  })

  it("edits global MCP servers from the activity rail and runs global diagnostics", async () => {
    window.desktop!.getGlobalProviderCatalog = vi.fn().mockResolvedValue([])
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [],
      selection: {},
    })
    window.desktop!.getGlobalMcpServers = vi.fn().mockResolvedValue([
      {
        id: "filesystem",
        name: "Filesystem",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        enabled: true,
      },
    ])
    window.desktop!.updateGlobalMcpServer = vi.fn().mockResolvedValue({
      id: "filesystem",
      name: "Filesystem Tools",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      enabled: true,
    })
    window.desktop!.getGlobalMcpServerDiagnostic = vi.fn().mockResolvedValue({
      serverID: "filesystem",
      enabled: true,
      ok: true,
      toolCount: 1,
      toolNames: ["read_file"],
    })

    render(<App />)

    openActivityRailConfigurationView("Open connections and extensions")

    expect(await screen.findByLabelText("Connections and extensions top menu")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("tab", { name: "MCP 1" }))
    expect(document.querySelector("#app-sidebar")).not.toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "Inspector sidebar" })).not.toBeInTheDocument()
    const filesystemButton = await screen.findByRole("button", { name: /Filesystem enabled/ })
    const newServerButton = screen.getByRole("button", { name: "New server" })
    const pageButtons = screen.getAllByRole("button")
    expect(pageButtons.indexOf(filesystemButton)).toBeLessThan(pageButtons.indexOf(newServerButton))
    expect(screen.queryByText("npx")).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument()
    expect(screen.queryByText("Pick a project first")).not.toBeInTheDocument()
    expect(screen.queryByText("Diagnostic context")).not.toBeInTheDocument()

    fireEvent.click(filesystemButton)
    fireEvent.change(screen.getByRole("textbox", { name: "MCP server name" }), {
      target: { value: "Filesystem Tools" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(window.desktop!.updateGlobalMcpServer).toHaveBeenCalledWith({
        serverID: "filesystem",
        server: {
          name: "Filesystem Tools",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem"],
          env: undefined,
          cwd: undefined,
          enabled: true,
          timeoutMs: undefined,
        },
      })
    })

    await waitFor(() => {
      expect(window.desktop!.getGlobalMcpServerDiagnostic).toHaveBeenCalledWith({
        serverID: "filesystem",
      })
    })
  })

  it("toggles the left rail from appearance settings", async () => {
    const { container } = render(<App />)
    const appShell = container.querySelector(".app-shell") as HTMLElement | null
    const getLeftActivityRail = () => container.querySelector(".activity-rail:not(.is-right)") as HTMLElement | null

    expect(appShell).not.toBeNull()
    expect(getLeftActivityRail()).not.toBeNull()
    const railCollapseButton = screen.getByRole("button", { name: "Collapse left sidebar" })
    const railTopMenu = railCollapseButton.closest(".activity-rail-top-menu")
    expect(railCollapseButton.closest(".activity-rail")).not.toBeNull()
    expect(railCollapseButton).toHaveClass("is-expanded")
    expect(railCollapseButton).not.toHaveClass("is-collapsed")
    expect(railTopMenu).not.toBeNull()
    expect(getLeftActivityRail()!.firstElementChild).toBe(railTopMenu)

    fireEvent.click(railCollapseButton)
    const railExpandButton = screen.getByRole("button", { name: "Expand left sidebar" })
    expect(railExpandButton).toHaveClass("is-collapsed")
    expect(railExpandButton).not.toHaveClass("is-expanded")

    fireEvent.click(railExpandButton)
    expect(screen.getByRole("button", { name: "Collapse left sidebar" })).toHaveClass("is-expanded")

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })

    fireEvent.click(screen.getByRole("button", { name: /^Appearance/ }))

    const railSwitch = screen.getByRole("switch", { name: "Show left rail" })
    expect(railSwitch).toHaveAttribute("aria-checked", "true")
    expect(getLeftActivityRail()).not.toBeNull()
    expect(appShell!.getAttribute("style")).toContain("--activity-rail-display-width: 54px")

    fireEvent.click(railSwitch)

    expect(railSwitch).toHaveAttribute("aria-checked", "false")
    expect(getLeftActivityRail()).toBeNull()
    expect(appShell!.getAttribute("style")).toContain("--activity-rail-display-width: 0px")
    expect(screen.getByRole("button", { name: "Collapse left sidebar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open folder" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Collapse left sidebar" }).closest(".left-sidebar-top-menu")).not.toBeNull()

    fireEvent.click(screen.getAllByRole("button", { name: "Close settings" })[0])
    fireEvent.click(screen.getByRole("button", { name: "Collapse left sidebar" }))

    expect(appShell!.getAttribute("style")).toContain("--sidebar-display-width: 0px")
    expect(screen.getByRole("button", { name: "Expand left sidebar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Expand left sidebar" }).closest(".dv-tabs-and-actions-container")).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Expand left sidebar" }))
    expect(screen.getByRole("button", { name: "Collapse left sidebar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Collapse left sidebar" }).closest(".left-sidebar-top-menu")).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Appearance/ }))
    fireEvent.click(screen.getByRole("switch", { name: "Show left rail" }))

    expect(screen.getByRole("switch", { name: "Show left rail" })).toHaveAttribute("aria-checked", "true")
    expect(getLeftActivityRail()).not.toBeNull()
    expect(appShell!.getAttribute("style")).toContain("--activity-rail-display-width: 54px")
    expect(screen.getByRole("button", { name: "Collapse left sidebar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Collapse left sidebar" }).closest(".activity-rail")).not.toBeNull()
  })

  it("opens mobile as a standalone primary rail view", async () => {
    const { container } = render(<App />)
    const leftActivityRail = container.querySelector(".activity-rail:not(.is-right)") as HTMLElement | null

    expect(leftActivityRail).not.toBeNull()
    const mobileButton = within(leftActivityRail!).getByRole("button", { name: "Open mobile" })
    expect(mobileButton).toBeInTheDocument()

    fireEvent.click(mobileButton)

    expect(await screen.findByLabelText("Mobile top menu")).toBeInTheDocument()
    expect(await screen.findByRole("heading", { name: "Scan to connect Anybox Mobile" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Connections and extensions top menu")).not.toBeInTheDocument()
    expect(screen.queryByRole("tab", { name: "Mobile 1" })).not.toBeInTheDocument()
    expect(document.querySelector("#app-sidebar")).not.toBeInTheDocument()
    expect(screen.queryByRole("complementary", { name: "Inspector sidebar" })).not.toBeInTheDocument()
  })

  it("keeps configuration rail entries permanently visible at the bottom", () => {
    const { container } = render(<App />)
    const leftActivityRail = container.querySelector(".activity-rail:not(.is-right)") as HTMLElement | null

    expect(leftActivityRail).not.toBeNull()
    expect(within(leftActivityRail!).getByRole("button", { name: "Open workspace" })).toBeInTheDocument()
    expect(within(leftActivityRail!).getByRole("button", { name: "Open connections and extensions" })).toBeInTheDocument()
    expect(within(leftActivityRail!).getByRole("button", { name: "Open mobile" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open skills" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open prompts" })).not.toBeInTheDocument()

    const configurationFooter = leftActivityRail!.querySelector(".activity-rail-footer")
    expect(configurationFooter).not.toBeNull()
    expect(leftActivityRail!.lastElementChild).toBe(configurationFooter)

    const configurationGroup = within(leftActivityRail!).getByLabelText("Configuration views")
    expect(within(configurationGroup).getByRole("button", { name: "Open prompts and skills" })).toBeInTheDocument()
    expect(within(configurationGroup).queryByRole("button", { name: "Open skills" })).not.toBeInTheDocument()
    expect(within(configurationGroup).queryByRole("button", { name: "Open prompts" })).not.toBeInTheDocument()
    expect(within(configurationGroup).queryByRole("button", { name: "Open connections and extensions" })).not.toBeInTheDocument()
    expect(within(configurationGroup).queryByRole("button", { name: "Open mobile" })).not.toBeInTheDocument()
    expect(within(configurationGroup).queryByRole("button", { name: "Open MCP" })).not.toBeInTheDocument()
    expect(within(configurationGroup).queryByRole("button", { name: "Open plugins" })).not.toBeInTheDocument()
    expect(within(configurationGroup).queryByRole("button", { name: "Open connectors" })).not.toBeInTheDocument()
    expect(within(configurationGroup).getByRole("button", { name: "Open tools" })).toBeInTheDocument()
    expect(within(leftActivityRail!).queryByRole("button", {
      name: "Show configuration shortcuts",
    })).not.toBeInTheDocument()
    expect(within(leftActivityRail!).queryByRole("button", {
      name: "Hide configuration shortcuts",
    })).not.toBeInTheDocument()

    fireEvent.click(within(configurationGroup).getByRole("button", { name: "Open prompts and skills" }))

    expect(within(configurationGroup).getByRole("button", { name: "Open prompts and skills" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })

  it("renders the Windows shell with token-driven surface defaults", () => {
    const { container } = render(<App />)
    const windowShell = container.querySelector(".window-shell") as HTMLElement | null

    expect(windowShell).not.toBeNull()
    expect(windowShell).not.toHaveAttribute("data-surface-profile")
    expect(windowShell).toHaveClass("is-windows")
    expect(windowShell!.style.getPropertyValue("--surface-profile-opacity")).toBe("")
    expect(windowShell!.style.getPropertyValue("--surface-profile-content-opacity")).toBe("")
  })

  it("toggles debug region colors from developer mode settings", async () => {
    const { container } = render(<App />)
    const windowShell = container.querySelector(".window-shell") as HTMLElement | null

    expect(windowShell).not.toBeNull()
    expect(windowShell).not.toHaveClass("debug-ui-regions")

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Developer Mode/ }))
    expandSettingsDisclosure(/Debug Overlays/)

    const debugRegionsSwitch = screen.getByRole("switch", { name: "Show debug region colors" })
    expect(debugRegionsSwitch).toHaveAttribute("aria-checked", "false")

    fireEvent.click(debugRegionsSwitch)

    expect(debugRegionsSwitch).toHaveAttribute("aria-checked", "true")
    expect(windowShell).toHaveClass("debug-ui-regions")
    expect(window.localStorage.getItem("desktop.debugUiRegions")).toBe("true")

    fireEvent.click(debugRegionsSwitch)

    expect(debugRegionsSwitch).toHaveAttribute("aria-checked", "false")
    expect(windowShell).not.toHaveClass("debug-ui-regions")
    expect(window.localStorage.getItem("desktop.debugUiRegions")).toBe("false")
  })

  it("toggles line debug colors from developer mode settings", async () => {
    const { container } = render(<App />)
    const windowShell = container.querySelector(".window-shell") as HTMLElement | null

    expect(windowShell).not.toBeNull()
    expect(windowShell).not.toHaveClass("debug-line-colors")

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Developer Mode/ }))
    expandSettingsDisclosure(/Debug Overlays/)

    const debugLineColorsSwitch = screen.getByRole("switch", { name: "Show line debug colors" })
    expect(debugLineColorsSwitch).toHaveAttribute("aria-checked", "false")

    fireEvent.click(debugLineColorsSwitch)

    expect(debugLineColorsSwitch).toHaveAttribute("aria-checked", "true")
    expect(windowShell).toHaveClass("debug-line-colors")
    expect(window.localStorage.getItem("desktop.debugLineColors")).toBe("true")

    fireEvent.click(debugLineColorsSwitch)

    expect(debugLineColorsSwitch).toHaveAttribute("aria-checked", "false")
    expect(windowShell).not.toHaveClass("debug-line-colors")
    expect(window.localStorage.getItem("desktop.debugLineColors")).toBe("false")
  })

  it("starts and stops Semantic Token Inspector from developer mode settings", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Developer Mode/ }))
    expandSettingsDisclosure(/Debug Overlays/)

    const inspectorSwitch = screen.getByRole("switch", { name: "Enable Semantic Token Inspector" })
    expect(inspectorSwitch).toHaveAttribute("aria-checked", "false")

    fireEvent.click(inspectorSwitch)

    expect(inspectorSwitch).toHaveAttribute("aria-checked", "true")
    expect(window.localStorage.getItem("desktop.semanticTokenInspector")).toBe("true")
    await waitFor(() => {
      expect(window.desktop?.startSemanticTokenInspector).toHaveBeenCalledTimes(1)
      expect(screen.getByTitle("Exit Semantic Token Inspector")).toBeInTheDocument()
      expect(document.querySelector(".semantic-token-inspector-overlay.is-active")).toBeInTheDocument()
    })

    fireEvent.keyDown(document.body, { key: "Escape" })

    await waitFor(() => {
      expect(inspectorSwitch).toHaveAttribute("aria-checked", "false")
      expect(window.localStorage.getItem("desktop.semanticTokenInspector")).toBe("false")
      expect(window.desktop?.stopSemanticTokenInspector).toHaveBeenCalledTimes(1)
    })
  })

  it("toggles trace debug metadata from developer mode settings", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Developer Mode/ }))
    expandSettingsDisclosure(/Trace Visibility/)

    const debugMetadataSwitch = screen.getByRole("switch", { name: "Show trace debug metadata" })
    expect(debugMetadataSwitch).toHaveAttribute("aria-checked", "false")

    fireEvent.click(debugMetadataSwitch)

    expect(debugMetadataSwitch).toHaveAttribute("aria-checked", "true")
    expect(window.localStorage.getItem("desktop.agentDebugTrace")).toBe("true")

    fireEvent.click(debugMetadataSwitch)

    expect(debugMetadataSwitch).toHaveAttribute("aria-checked", "false")
    expect(window.localStorage.getItem("desktop.agentDebugTrace")).toBe("false")
  })

  it("keeps theme editing and shell visibility under appearance while excluding developer toggles", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Appearance/ }))

    const themeLibrary = getAppearanceThemeLibrary()
    expect(within(themeLibrary).getByRole("option", { name: /经典/ })).toBeInTheDocument()
    expect(within(themeLibrary).getByRole("option", { name: /Sage Slate/ })).toBeInTheDocument()
    expect(within(themeLibrary).getByText("Color Mode")).toBeInTheDocument()
    expect(within(themeLibrary).getByText("Accent Theme")).toBeInTheDocument()
    expect(within(themeLibrary).getByText("Code Theme")).toBeInTheDocument()
    expect(screen.getByRole("radiogroup", { name: "Color Mode" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked()
    expect(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Accent Theme" })).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Code Theme" })).not.toBeInTheDocument()
    expect(screen.getByText("Theme Config File")).toBeInTheDocument()
    expect(screen.getByLabelText("Current appearance config JSON")).toBeInTheDocument()
    expect(screen.getByLabelText("Accent States Accent Base Light brand-primary")).toBeInTheDocument()
    expect(screen.getByLabelText("Accent States Accent Base Dark brand-primary-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Accent States Icon Rest Light semantic-accent-icon-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Accent States Icon Rest Dark semantic-accent-icon-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Accent States Icon Hover Light semantic-accent-icon-hover-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Accent States Icon Hover Dark semantic-accent-icon-hover-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Accent States Icon Active Light semantic-accent-icon-active-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Accent States Icon Active Dark semantic-accent-icon-active-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Shell Chrome Surface Light semantic-shell-chrome-surface-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Shell Chrome Surface Dark semantic-shell-chrome-surface-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Shell Chrome Selected Tab Surface Light semantic-shell-chrome-tab-surface-active-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Shell Chrome Selected Tab Surface Dark semantic-shell-chrome-tab-surface-active-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Shell Chrome Selected Tab Indicator Light semantic-shell-chrome-tab-indicator-active-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Shell Chrome Selected Tab Indicator Dark semantic-shell-chrome-tab-indicator-active-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Popup Panel Panel Surface Light semantic-popup-panel-surface-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Popup Panel Panel Surface Dark semantic-popup-panel-surface-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Switches Switch Track Light semantic-switch-track-surface-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Switches Switch Track Dark semantic-switch-track-surface-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Switches Switch Thumb Light semantic-switch-thumb-surface-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Switches Switch Thumb Dark semantic-switch-thumb-surface-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Segmented Controls Control Surface Light semantic-segmented-control-surface-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Segmented Controls Item Active Surface Dark semantic-segmented-control-item-surface-active-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Segmented Controls Item Active Text Light semantic-segmented-control-item-text-active-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Segmented Controls Item Meta Text Light semantic-segmented-control-item-meta-text-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Dropdown Select Menu Surface Light semantic-dropdown-menu-surface-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Dropdown Select Menu Surface Dark semantic-dropdown-menu-surface-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Thread View Response Text Light semantic-thread-response-text-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Thread View Response Text Dark semantic-thread-response-text-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Thread View Reasoning Text Light semantic-thread-reasoning-text-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Thread View Reasoning Text Dark semantic-thread-reasoning-text-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Thread View Divider Light semantic-thread-divider-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Thread View Divider Dark semantic-thread-divider-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Thread View Diff Card Surface Light semantic-thread-user-message-diff-card-surface-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Thread View Diff Card Surface Dark semantic-thread-user-message-diff-card-surface-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Markdown Inline Code Surface Light semantic-markdown-inline-code-surface-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Markdown Selection Background Light semantic-markdown-selection-background-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Markdown Selection Text Dark semantic-markdown-selection-text-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Markdown Code Block Surface Dark semantic-markdown-code-surface-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Composer Input Border Light semantic-composer-border-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Composer Input Border Dark semantic-composer-border-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Composer Button Surface Light semantic-composer-button-surface-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Composer Button Surface Dark semantic-composer-button-surface-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Buttons Icon Button Text Light semantic-icon-button-text-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Buttons Icon Button Text Hover Dark semantic-icon-button-text-hover-dark")).toBeInTheDocument()
    expect(screen.getByLabelText("Composer Icon Button Text Light semantic-composer-icon-button-text-light")).toBeInTheDocument()
    expect(screen.getByLabelText("Composer Icon Button Hover Surface Dark semantic-composer-icon-button-surface-hover-dark")).toBeInTheDocument()
    expect(screen.queryByLabelText("Composer Icon Button Disabled Text Light semantic-composer-icon-button-disabled-text-light")).not.toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Show left rail" })).toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "Show debug region colors" })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "Show line debug colors" })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "Show trace tool calls" })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "Show trace sources" })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "Show trace approvals" })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "Show trace debug metadata" })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "Show right rail" })).not.toBeInTheDocument()
    expect(screen.getByText("No rail")).toBeInTheDocument()
    expect(screen.queryByText("Line Colors")).not.toBeInTheDocument()
  })

  it("switches the color mode from appearance settings", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Appearance/ }))

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }))

    expect(document.documentElement).toHaveAttribute("data-theme", "dark")
    expect(window.localStorage.getItem("desktop.colorMode")).toBe("dark")

    fireEvent.click(screen.getByRole("radio", { name: "System" }))

    expect(document.documentElement).not.toHaveAttribute("data-theme")
    expect(window.localStorage.getItem("desktop.colorMode")).toBe("system")
  })

  it("applies the accent theme through the theme library", async () => {
    render(<App />)

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-brand-theme", "terra")
    })

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Appearance/ }))

    const themeLibrary = getAppearanceThemeLibrary()
    fireEvent.click(within(themeLibrary).getByRole("option", { name: /Sage Slate/ }))
    fireEvent.click(within(themeLibrary).getByRole("button", { name: "Apply" }))

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-brand-theme", "sage")
    })
    expect(window.localStorage.getItem("desktop.brandTheme")).toBe("sage")
  })

  it("normalizes invalid saved code themes to auto", async () => {
    window.localStorage.setItem("desktop.codeTheme", "unknown-theme")

    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Appearance/ }))

    expect(screen.queryByRole("combobox", { name: "Code Theme" })).not.toBeInTheDocument()
    expect(within(getAppearanceThemeLibrary()).getByText("Code Theme")).toBeInTheDocument()
    await waitFor(() => {
      expect(window.localStorage.getItem("desktop.codeTheme")).toBe("auto")
    })
  })

  it("saves semantic token overrides from appearance settings", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Appearance/ }))

    const accentBaseInput = screen.getByLabelText("Accent States Accent Base Light brand-primary color value") as HTMLInputElement
    const questionCardInput = screen.getByLabelText(
      "Question Card Surface Light semantic-question-card-surface-light color value",
    ) as HTMLInputElement
    const proposedPlanCardInput = screen.getByLabelText(
      "Proposed Plan Card Surface Light semantic-proposed-plan-card-surface-light color value",
    ) as HTMLInputElement
    const responseTextInput = screen.getByLabelText(
      "Thread View Response Text Light semantic-thread-response-text-light color value",
    ) as HTMLInputElement
    const diffCardSurfaceInput = screen.getByLabelText(
      "Thread View Diff Card Surface Light semantic-thread-user-message-diff-card-surface-light color value",
    ) as HTMLInputElement
    const markdownInlineCodeInput = screen.getByLabelText(
      "Markdown Inline Code Surface Light semantic-markdown-inline-code-surface-light color value",
    ) as HTMLInputElement
    const reasoningTextInput = screen.getByLabelText(
      "Thread View Reasoning Text Light semantic-thread-reasoning-text-light color value",
    ) as HTMLInputElement
    const threadDividerInput = screen.getByLabelText(
      "Thread View Divider Light semantic-thread-divider-light color value",
    ) as HTMLInputElement
    const preview = screen.getByLabelText("Current appearance config JSON") as HTMLTextAreaElement
    const saveAppearanceConfig = window.desktop!.saveAppearanceConfig as ReturnType<typeof vi.fn>

    fireEvent.change(accentBaseInput, { target: { value: "#ffffff" } })
    fireEvent.blur(accentBaseInput)
    fireEvent.change(questionCardInput, { target: { value: "#123456" } })
    fireEvent.blur(questionCardInput)
    fireEvent.change(proposedPlanCardInput, { target: { value: "#654321" } })
    fireEvent.blur(proposedPlanCardInput)
    fireEvent.change(responseTextInput, { target: { value: "#112233" } })
    fireEvent.blur(responseTextInput)
    fireEvent.change(diffCardSurfaceInput, { target: { value: "#334455" } })
    fireEvent.blur(diffCardSurfaceInput)
    fireEvent.change(markdownInlineCodeInput, { target: { value: "#ddeeff" } })
    fireEvent.blur(markdownInlineCodeInput)
    fireEvent.change(reasoningTextInput, { target: { value: "#445566" } })
    fireEvent.blur(reasoningTextInput)
    fireEvent.change(threadDividerInput, { target: { value: "#223344" } })
    fireEvent.blur(threadDividerInput)

    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--brand-primary")).toBe("#ffffff")
      expect(document.documentElement.style.getPropertyValue("--semantic-question-card-surface-light")).toBe("#123456")
      expect(document.documentElement.style.getPropertyValue("--semantic-proposed-plan-card-surface-light")).toBe("#654321")
      expect(document.documentElement.style.getPropertyValue("--semantic-thread-response-text-light")).toBe("#112233")
      expect(document.documentElement.style.getPropertyValue("--semantic-thread-user-message-diff-card-surface-light")).toBe("#334455")
      expect(document.documentElement.style.getPropertyValue("--semantic-markdown-inline-code-surface-light")).toBe("#ddeeff")
      expect(document.documentElement.style.getPropertyValue("--semantic-thread-reasoning-text-light")).toBe("#445566")
      expect(document.documentElement.style.getPropertyValue("--semantic-thread-divider-light")).toBe("#223344")
    })
    await waitFor(() => {
      expect(saveAppearanceConfig).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(preview.value).toContain("#ffffff")
      expect(preview.value).toContain("#123456")
      expect(preview.value).toContain("#654321")
      expect(preview.value).toContain("#112233")
      expect(preview.value).toContain("#334455")
      expect(preview.value).toContain("#ddeeff")
      expect(preview.value).toContain("#445566")
      expect(preview.value).toContain("#223344")
    })
  })

  it("groups debug overlays and trace visibility under developer mode", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Developer Mode/ }))

    expect(screen.getByRole("button", { name: /Agent Monitor/ })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("button", { name: /Debug Overlays/ })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("button", { name: /Trace Visibility/ })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("button", { name: /Storage Locations/ })).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("button", { name: /Developer State/ })).toHaveAttribute("aria-expanded", "true")

    expandSettingsDisclosure(/Debug Overlays/)
    expect(screen.getByRole("switch", { name: "Show debug region colors" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Show line debug colors" })).toBeInTheDocument()
    expandSettingsDisclosure(/Trace Visibility/)
    expect(screen.getByRole("switch", { name: "Show trace tool calls" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Show trace sources" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Show trace approvals" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Show trace debug metadata" })).toBeInTheDocument()
    expect(screen.getByText("Developer State")).toBeInTheDocument()
    expect(screen.getByText("Line Colors")).toBeInTheDocument()
  })

  it("reveals backend-only thread trace entries when workflow and debug metadata are enabled", async () => {
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-1",
          sessionID: "session-atlas-review",
          role: "user",
          created: 10,
        },
        parts: [
          {
            id: "part-user-1",
            sessionID: "session-atlas-review",
            messageID: "msg-user-1",
            type: "text",
            text: "Inspect the permission flow",
          },
        ],
      },
      {
        info: {
          id: "msg-assistant-1",
          sessionID: "session-atlas-review",
          role: "assistant",
          created: 11,
          completed: 12,
        },
        parts: [
          {
            id: "part-permission-1",
            sessionID: "session-atlas-review",
            messageID: "msg-assistant-1",
            type: "permission",
            approvalID: "approval-atlas-1",
            toolCallID: "toolcall-atlas-1",
            tool: "read-file",
            action: "ask",
            created: 12,
          },
          {
            id: "part-step-start-1",
            sessionID: "session-atlas-review",
            messageID: "msg-assistant-1",
            type: "step-start",
          },
          {
            id: "part-text-1",
            sessionID: "session-atlas-review",
            messageID: "msg-assistant-1",
            type: "text",
            text: "Done.",
          },
        ],
      },
    ])

    render(<App />)

    expect(await screen.findByRole("button", { name: "Atlas review" })).toBeInTheDocument()
    expect(await screen.findByText("Done.")).toBeInTheDocument()
    expect(screen.getByText("Permission requested")).toBeInTheDocument()
    expect(screen.queryByText("Model step started")).not.toBeInTheDocument()
    expect(screen.queryByText("approval.id")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Developer Mode/ }))
    expandSettingsDisclosure(/Trace Visibility/)
    fireEvent.click(screen.getByRole("switch", { name: "Show trace workflow events" }))
    fireEvent.click(screen.getByRole("switch", { name: "Show trace debug metadata" }))

    const executionSummary = screen.getByRole("button", { name: /Expand processing details/ })
    expect(executionSummary).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(executionSummary)
    expect(screen.getByText("Model step started")).toBeInTheDocument()
    expect(screen.getByText("approval.id")).toBeInTheDocument()
    expect(screen.getAllByText("part.id").length).toBeGreaterThan(0)
  })

  it("keeps long completed tool output collapsed until the user expands it", async () => {
    const tailMarker = "tail-marker-visible-after-expand"
    const inputMarker = "input-marker-visible-after-enabling-tool-inputs"
    const longOutput = `${"tool output line\n".repeat(80)}${tailMarker}`

    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([
      {
        info: {
          id: "msg-user-1",
          sessionID: "session-atlas-review",
          role: "user",
          created: 10,
        },
        parts: [
          {
            id: "part-user-1",
            sessionID: "session-atlas-review",
            messageID: "msg-user-1",
            type: "text",
            text: "Show me the full tool output",
          },
        ],
      },
      {
        info: {
          id: "msg-assistant-1",
          sessionID: "session-atlas-review",
          role: "assistant",
          created: 11,
          completed: 12,
        },
        parts: [
          {
            id: "part-tool-1",
            sessionID: "session-atlas-review",
            messageID: "msg-assistant-1",
            type: "tool",
            tool: "capture-long-output",
            state: {
              status: "completed",
              input: {
                path: "PROJECT_ANALYSIS.md",
                content: inputMarker,
              },
              output: longOutput,
            },
          },
        ],
      },
    ])

    render(<App />)

    expect(await screen.findByRole("button", { name: "Atlas review" })).toBeInTheDocument()
    const toolToggle = await screen.findByRole("button", { name: /capture-long-output/i })

    expect(screen.queryByText(new RegExp(tailMarker))).not.toBeInTheDocument()
    expect(screen.queryByText(new RegExp(inputMarker))).not.toBeInTheDocument()

    fireEvent.click(toolToggle)

    const outputPane = await screen.findByRole("region", { name: /capture-long-output output content/i })
    expect(outputPane).not.toHaveClass("is-expanded")
    const outputExpandButton = within(outputPane).getByRole("button", { name: /^Expand capture-long-output output content$/i })
    fireEvent.click(outputExpandButton)
    expect(outputPane).toHaveClass("is-expanded")
    expect(await screen.findByText(new RegExp(tailMarker))).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Developer Mode/ }))
    expandSettingsDisclosure(/Trace Visibility/)
    fireEvent.click(screen.getByRole("switch", { name: "Show trace tool inputs" }))

    const inputPane = await screen.findByRole("region", { name: /capture-long-output input content/i })
    expect(inputPane).not.toHaveClass("is-expanded")
    fireEvent.click(within(inputPane).getByRole("button", { name: /^Expand capture-long-output input content$/i }))
    expect(inputPane).toHaveClass("is-expanded")
    expect(await screen.findByText(new RegExp(inputMarker))).toBeInTheDocument()
  })

  it("keeps provider configuration focused on editable fields for environment-backed providers", async () => {
    window.desktop!.getGlobalProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "deepseek",
        name: "DeepSeek",
        source: "env",
        env: ["DEEPSEEK_API_KEY"],
        configured: true,
        available: true,
        apiKeyConfigured: true,
        baseURL: "https://api.deepseek.com",
        modelCount: 1,
      },
    ])
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [],
      selection: {},
    })

    render(<App />)

    const settingsDialog = await openProviderSettingsSection()
    await screen.findByRole("heading", { name: "DeepSeek" })

    const detailPanel = settingsDialog.querySelector(".settings-service-detail-panel")
    expect(detailPanel).not.toBeNull()
    expect((detailPanel as HTMLElement).querySelector(".settings-detail-meta-grid")).toBeNull()
    expect((detailPanel as HTMLElement).querySelector(".settings-detail-hero")).toBeNull()
    expect(
      within(detailPanel as HTMLElement).queryByText(
        "Edit the shared credentials and endpoint the app should use when routing to DeepSeek.",
      ),
    ).not.toBeInTheDocument()
    expect(
      within(detailPanel as HTMLElement).queryByText("This provider can also inherit credentials from the current environment."),
    ).not.toBeInTheDocument()
    expect(
      within(detailPanel as HTMLElement).queryByText(
        "Current connection comes from environment variables. Update the local environment to change it.",
      ),
    ).not.toBeInTheDocument()
    expect((detailPanel as HTMLElement).querySelector(".provider-advanced-settings")).not.toHaveAttribute("open")
    expect(
      within(detailPanel as HTMLElement).queryByText("保存全局 provider 的非敏感设置。连接凭据使用全应用共享连接。"),
    ).not.toBeInTheDocument()
    expect(within(detailPanel as HTMLElement).getByRole("button", { name: "Test connection" })).toBeInTheDocument()
  })

  it("keeps Anybox network settings product-level and does not send proxy fields", async () => {
    window.desktop!.getGlobalProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "anybox",
        name: "Anybox",
        source: "api",
        env: [],
        configured: true,
        available: false,
        apiKeyConfigured: false,
        baseURL: "https://anybox.test/v1",
        modelCount: 0,
        authCapabilities: [
          {
            method: "anybox-browser",
            label: "Anybox 账号（浏览器登录）",
            kind: "browser_oauth",
            supportsPolling: true,
          },
        ],
        authState: {
          providerID: "anybox",
          scope: "global",
          status: "not_connected",
          capabilities: [],
          credentials: [],
        },
      },
    ])
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [],
      selection: {},
    })
    window.desktop!.testGlobalProviderConnection = vi.fn().mockResolvedValue({
      providerID: "anybox",
      ok: true,
      status: "working",
      checkedAt: 1,
      message: "连接测试成功。",
    })
    window.desktop!.startGlobalProviderAuthFlow = vi.fn().mockResolvedValue({
      id: "flow_anybox",
      providerID: "anybox",
      method: "anybox-browser",
      kind: "browser_oauth",
      status: "waiting_user",
      startedAt: 1,
      updatedAt: 1,
      authorizationURL: "https://anybox.test/api/agent/oauth/authorize",
    })
    window.desktop!.openExternalUrl = vi.fn().mockResolvedValue(undefined)
    const testProviderConnection = vi.mocked(window.desktop!.testGlobalProviderConnection!)
    const startProviderAuthFlow = vi.mocked(window.desktop!.startGlobalProviderAuthFlow!)

    render(<App />)

    await openProviderSettingsSection()
    await screen.findByRole("heading", { name: "Anybox" })

    expect(screen.getByLabelText("Base URL for Anybox")).toHaveValue("https://anybox.test/v1")
    expect(screen.queryByText("代理模式")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Anybox proxy URL")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }))
    await waitFor(() => {
      const payload = testProviderConnection.mock.calls[0]?.[0]
      expect(payload).toMatchObject({
        providerID: "anybox",
        method: "anybox-browser",
        credentialMode: "active",
        baseURL: "https://anybox.test/v1",
      })
      expect(payload).not.toHaveProperty("proxyMode")
      expect(payload).not.toHaveProperty("proxyURL")
    })
    expect(await screen.findByText("连接测试成功。")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open Account" }))
    fireEvent.click(await screen.findByRole("button", { name: "Log in to Anybox" }))
    await waitFor(() => {
      const payload = startProviderAuthFlow.mock.calls[0]?.[0]
      expect(payload).toMatchObject({
        providerID: "anybox",
        method: "anybox-browser",
        baseURL: "https://anybox.test/v1",
        prompt: "select_account",
      })
      expect(payload).not.toHaveProperty("proxyMode")
      expect(payload).not.toHaveProperty("proxyURL")
    })
  })

  it("routes subscription and recharge through the unified Account entry", async () => {
    window.desktop!.getGlobalProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "anybox",
        name: "Anybox",
        source: "api",
        env: [],
        configured: true,
        available: true,
        apiKeyConfigured: false,
        baseURL: "https://anybox.test/v1",
        modelCount: 0,
        authCapabilities: [],
        authState: {
          providerID: "anybox",
          scope: "global",
          status: "connected",
          capabilities: [],
          credentials: [],
          account: {
            email: "user@anybox.test",
            workspaceName: "Personal",
          },
        },
      },
    ])
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [],
      selection: {},
    })
    window.desktop!.getAnyboxSubscriptionOverview = vi.fn().mockResolvedValue({
      connected: true,
      balanceMicrocents: 2_500_000_000,
      currency: "CNY",
      plans: [],
      subscription: null,
      limits: [],
      pendingOrder: null,
      pendingOrderPlanVersionId: null,
      pendingUpgrade: null,
    })

    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: "Account" }))

    const accountTabs = await screen.findByRole("tablist", { name: "Account sections" })
    const overviewTab = within(accountTabs).getByRole("tab", { name: "Overview" })
    const subscriptionTab = within(accountTabs).getByRole("tab", { name: "Subscription & credits" })
    const rechargeTab = within(accountTabs).getByRole("tab", { name: "Balance & recharge" })

    expect(overviewTab).toHaveAttribute("aria-selected", "true")
    expect(await screen.findByRole("heading", { name: "Current plan" })).toBeInTheDocument()

    fireEvent.click(subscriptionTab)
    expect(subscriptionTab).toHaveAttribute("aria-selected", "true")
    expect(await screen.findByRole("heading", { name: "Plans" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Add prepaid balance" })).not.toBeInTheDocument()

    fireEvent.click(rechargeTab)
    expect(rechargeTab).toHaveAttribute("aria-selected", "true")
    expect(await screen.findByRole("heading", { name: "Add prepaid balance" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Plans" })).not.toBeInTheDocument()
  })

  it("keeps the Anybox account available when the Cinema provider catalog fails", async () => {
    window.desktop!.getGlobalProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "anybox",
        name: "Anybox",
        source: "api",
        env: [],
        configured: false,
        available: false,
        apiKeyConfigured: false,
        baseURL: "https://anybox.test/v1",
        modelCount: 0,
        authCapabilities: [
          {
            method: "anybox-browser",
            label: "Anybox 账号（浏览器登录）",
            kind: "browser_oauth",
            supportsPolling: true,
          },
        ],
        authState: {
          providerID: "anybox",
          scope: "global",
          status: "not_connected",
          capabilities: [],
          credentials: [],
        },
      },
    ])
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [],
      selection: {},
    })
    window.desktop!.getCinemaVideoProviders = vi.fn().mockRejectedValue(
      new Error("Missing provider-manifests.json"),
    )
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      render(<App />)

      fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
      await screen.findByRole("dialog", { name: "Settings" })
      fireEvent.click(screen.getByRole("button", { name: "Account" }))

      const signInButton = await screen.findByRole("button", { name: "Log in to Anybox" })
      expect(signInButton).toBeEnabled()
      expect(screen.getByText("Not logged in")).toBeInTheDocument()
      expect(screen.queryByText("Anybox unavailable")).not.toBeInTheDocument()
      expect(consoleError).toHaveBeenCalledWith(
        "[desktop] loading Cinema video provider catalog failed:",
        expect.any(Error),
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it("tests provider connection from the provider detail page", async () => {
    window.desktop!.getGlobalProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "deepseek",
        name: "DeepSeek",
        source: "env",
        env: ["DEEPSEEK_API_KEY"],
        configured: true,
        available: true,
        apiKeyConfigured: true,
        baseURL: "https://api.deepseek.com",
        modelCount: 1,
      },
    ])
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [],
      selection: {},
    })
    window.desktop!.testGlobalProviderConnection = vi.fn().mockResolvedValue({
      providerID: "deepseek",
      ok: true,
      status: "working",
      checkedAt: 1,
      message: "连接测试成功。",
    })

    render(<App />)

    await openProviderSettingsSection()
    await screen.findByRole("heading", { name: "DeepSeek" })
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }))

    await waitFor(() => {
      expect(window.desktop!.testGlobalProviderConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          providerID: "deepseek",
          method: "api-key",
          credentialMode: "environment",
          baseURL: "https://api.deepseek.com",
        }),
      )
    })
    expect(await screen.findByText("连接测试成功。")).toBeInTheDocument()
  })

  it("keeps manual provider drafts after testing the connection", async () => {
    window.desktop!.getGlobalProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "deepseek",
        name: "DeepSeek",
        source: "api",
        env: ["DEEPSEEK_API_KEY"],
        configured: false,
        available: false,
        apiKeyConfigured: false,
        baseURL: "https://api.deepseek.com",
        modelCount: 1,
      },
    ])
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [],
      selection: {},
    })
    window.desktop!.testGlobalProviderConnection = vi.fn().mockResolvedValue({
      providerID: "deepseek",
      ok: true,
      status: "working",
      checkedAt: 1,
      message: "连接测试成功。",
    })

    render(<App />)

    await openProviderSettingsSection()
    await screen.findByRole("heading", { name: "DeepSeek" })

    const apiKeyInput = screen.getByLabelText("API key for DeepSeek")
    fireEvent.change(apiKeyInput, {
      target: {
        value: "sk-draft-deepseek",
      },
    })
    fireEvent.change(screen.getByLabelText("Base URL for DeepSeek"), {
      target: {
        value: "https://draft.deepseek.test/v1",
      },
    })
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }))

    await waitFor(() => {
      expect(window.desktop!.testGlobalProviderConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          providerID: "deepseek",
          method: "api-key",
          credentialMode: "manual",
          apiKey: "sk-draft-deepseek",
          baseURL: "https://draft.deepseek.test/v1",
        }),
      )
    })
    expect(await screen.findByText("连接测试成功。")).toBeInTheDocument()
    expect(screen.getByLabelText("API key for DeepSeek")).toHaveValue("sk-draft-deepseek")
    expect(screen.getByLabelText("Base URL for DeepSeek")).toHaveValue("https://draft.deepseek.test/v1")
  })

  it("shows every OpenAI connection method as direct radio choices", async () => {
    window.desktop!.getGlobalProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "openai",
        name: "OpenAI",
        source: "env",
        env: ["OPENAI_API_KEY"],
        configured: true,
        available: true,
        apiKeyConfigured: true,
        baseURL: "https://api.openai.com/v1",
        modelCount: 1,
        authCapabilities: [
          {
            method: "chatgpt-browser",
            label: "ChatGPT Pro/Plus (browser)",
            kind: "browser_oauth",
            recommended: true,
          },
          {
            method: "chatgpt-headless",
            label: "ChatGPT Pro/Plus (headless)",
            kind: "device_code",
          },
          {
            method: "api-key",
            label: "API key",
            kind: "api_key",
          },
        ],
        authState: {
          providerID: "openai",
          scope: "global",
          activeMethod: "chatgpt-browser",
          status: "connected",
          capabilities: [],
          credentials: [],
        },
      },
    ])
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [],
      selection: {},
    })

    render(<App />)

    await openProviderSettingsSection()
    await screen.findByRole("heading", { name: "OpenAI" })

    expect(screen.queryByLabelText("Authentication method for OpenAI")).not.toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "ChatGPT Pro/Plus (browser sign-in)" })).toBeChecked()
    expect(screen.getByRole("radio", { name: "ChatGPT Pro/Plus (device code sign-in)" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Use environment variable OPENAI_API_KEY" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Enter API key manually" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("radio", { name: "ChatGPT Pro/Plus (device code sign-in)" }))
    expect(screen.getByRole("button", { name: "开始设备登录" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("radio", { name: "Enter API key manually" }))
    expect(screen.getByLabelText("API key for OpenAI")).toBeInTheDocument()
  })

  it("saves provider overrides from the settings page", async () => {
    const refreshedCatalog = createDeferred<
      {
        id: string
        name: string
        source: string
        env: string[]
        configured: boolean
        available: boolean
        apiKeyConfigured: boolean
        baseURL: string
        modelCount: number
      }[]
    >()
    const refreshedModels = createDeferred<{
      items: {
        id: string
        providerID: string
        name: string
        status: string
        available: boolean
        capabilities: {
          temperature: boolean
          reasoning: boolean
          attachment: boolean
          toolcall: boolean
          input: {
            text: boolean
            audio: boolean
            image: boolean
            video: boolean
            pdf: boolean
          }
          output: {
            text: boolean
            audio: boolean
            image: boolean
            video: boolean
            pdf: boolean
          }
        }
        limit: {
          context: number
          output: number
        }
      }[]
      selection: {
        model?: string
        small_model?: string
      }
    }>()

    window.desktop!.getGlobalProviderCatalog = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "deepseek",
          name: "DeepSeek",
          source: "api",
          env: ["DEEPSEEK_API_KEY"],
          configured: false,
          available: false,
          apiKeyConfigured: false,
          baseURL: "https://api.deepseek.com",
          modelCount: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "deepseek",
          name: "DeepSeek",
          source: "config",
          env: ["DEEPSEEK_API_KEY"],
          configured: true,
          available: true,
          apiKeyConfigured: true,
          baseURL: "https://proxy.deepseek.test/v1",
          modelCount: 1,
        },
      ])
      .mockImplementationOnce(() => refreshedCatalog.promise)
    window.desktop!.getGlobalModels = vi
      .fn()
      .mockResolvedValueOnce({
        items: [],
        selection: {},
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: "deepseek-reasoner",
            providerID: "deepseek",
            name: "DeepSeek Reasoner",
            status: "active",
            available: true,
            capabilities: {
              temperature: true,
              reasoning: true,
              attachment: false,
              toolcall: true,
              input: {
                text: true,
                audio: false,
                image: false,
                video: false,
                pdf: false,
              },
              output: {
                text: true,
                audio: false,
                image: false,
                video: false,
                pdf: false,
              },
            },
            limit: {
              context: 128000,
              output: 8192,
            },
          },
        ],
        selection: {},
      })
      .mockImplementationOnce(() => refreshedModels.promise)

    render(<App />)

    await openProviderSettingsSection()
    await screen.findByRole("heading", { name: "DeepSeek" })
    fireEvent.change(screen.getByLabelText("Base URL for DeepSeek"), {
      target: {
        value: "https://proxy.deepseek.test/v1",
      },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save DeepSeek settings" }))

    await waitFor(() => {
      expect(window.desktop!.updateGlobalProvider).toHaveBeenCalledWith({
        providerID: "deepseek",
        provider: {
          name: "DeepSeek",
          env: ["DEEPSEEK_API_KEY"],
          options: {
            baseURL: "https://proxy.deepseek.test/v1",
          },
        },
      })
    })

    await waitFor(() => {
      expect(window.desktop!.getGlobalProviderCatalog).toHaveBeenCalledTimes(2)
      expect(window.desktop!.getGlobalModels).toHaveBeenCalledTimes(2)
    })

    expect(screen.getByRole("heading", { name: "DeepSeek" })).toBeInTheDocument()
    expect(screen.queryByText("Fetching provider catalog")).not.toBeInTheDocument()

    refreshedCatalog.resolve([
      {
        id: "deepseek",
        name: "DeepSeek",
        source: "config",
        env: ["DEEPSEEK_API_KEY"],
        configured: true,
        available: true,
        apiKeyConfigured: true,
        baseURL: "https://proxy.deepseek.test/v1",
        modelCount: 1,
      },
    ])
    refreshedModels.resolve({
      items: [
        {
          id: "deepseek-reasoner",
          providerID: "deepseek",
          name: "DeepSeek Reasoner",
          status: "active",
          available: true,
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: false,
            toolcall: true,
            input: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
          },
          limit: {
            context: 128000,
            output: 8192,
          },
        },
      ],
      selection: {},
    })

    expect(await screen.findByText("Provider settings saved.")).toBeInTheDocument()
    expect(window.desktop!.getGlobalProviderCatalog).toHaveBeenCalledTimes(2)
    expect(window.desktop!.getGlobalModels).toHaveBeenCalledTimes(2)
  })

  it("keeps settings open on escape and backdrop click until the close button is used", async () => {
    window.desktop!.getGlobalProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "deepseek",
        name: "DeepSeek",
        source: "config",
        env: ["DEEPSEEK_API_KEY"],
        configured: true,
        available: true,
        apiKeyConfigured: true,
        baseURL: "https://api.deepseek.com",
        modelCount: 1,
      },
    ])
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [],
      selection: {},
    })

    const { container } = render(<App />)
    const appShell = container.querySelector(".app-shell") as HTMLElement | null
    expect(appShell).not.toBeNull()
    expect(appShell).not.toHaveClass("is-settings-open")

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument()
    expect(appShell).toHaveClass("is-settings-open")

    const settingsOverlay = container.querySelector(".settings-page-overlay")
    expect(settingsOverlay).not.toBeNull()
    fireEvent.click(settingsOverlay!)

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument()
    expect(appShell).toHaveClass("is-settings-open")

    fireEvent.keyDown(window, { key: "Escape" })

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument()
    expect(appShell).toHaveClass("is-settings-open")

    fireEvent.click(screen.getByRole("button", { name: "Close settings" }))

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument()
    })
    expect(appShell).not.toHaveClass("is-settings-open")
  })

  it("drags settings within the main window", async () => {
    const { container } = render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    const dialog = await screen.findByRole("dialog", { name: "Settings" })
    const settingsPositioner = dialog.closest(".settings-page-positioner") as HTMLElement | null
    const settingsOverlay = container.querySelector(".settings-page-overlay")
    const settingsHeader = container.querySelector(".settings-page-header")
    expect(settingsPositioner).not.toBeNull()
    expect(settingsOverlay).not.toBeNull()
    expect(settingsHeader).not.toBeNull()

    Object.defineProperty(settingsOverlay!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 600,
        height: 600,
        left: 0,
        right: 800,
        top: 0,
        width: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    })
    Object.defineProperty(settingsPositioner!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 500,
        height: 400,
        left: 200,
        right: 600,
        top: 100,
        width: 400,
        x: 200,
        y: 100,
        toJSON: () => ({}),
      }),
    })

    fireEvent.pointerDown(settingsHeader!, {
      button: 0,
      clientX: 400,
      clientY: 120,
      pointerId: 7,
    })

    await waitFor(() => {
      expect(dialog).toHaveClass("is-dragging")
    })

    fireEvent.pointerMove(window, {
      clientX: 500,
      clientY: 170,
      pointerId: 7,
    })

    await waitFor(() => {
      expect(settingsPositioner).toHaveStyle({ transform: "translate3d(100px, 50px, 0)" })
    })

    fireEvent.pointerUp(window, {
      pointerId: 7,
    })

    await waitFor(() => {
      expect(dialog).not.toHaveClass("is-dragging")
    })
  })

  it("updates the global model selection from settings", async () => {
    window.desktop!.getGlobalProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "deepseek",
        name: "DeepSeek",
        source: "config",
        env: ["DEEPSEEK_API_KEY"],
        configured: true,
        available: true,
        apiKeyConfigured: true,
        baseURL: "https://api.deepseek.com",
        modelCount: 1,
      },
      {
        id: "openai",
        name: "OpenAI",
        source: "config",
        env: ["OPENAI_API_KEY"],
        configured: true,
        available: true,
        apiKeyConfigured: true,
        baseURL: "https://api.openai.com/v1",
        modelCount: 1,
      },
    ])
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [
        {
          id: "deepseek-reasoner",
          providerID: "deepseek",
          name: "DeepSeek Reasoner",
          status: "active",
          available: true,
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: false,
            toolcall: true,
            input: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
          },
          limit: {
            context: 128000,
            output: 8192,
          },
        },
        {
          id: "gpt-4o-mini",
          providerID: "openai",
          name: "GPT-4o mini",
          status: "active",
          available: true,
          capabilities: {
            temperature: true,
            reasoning: false,
            attachment: true,
            toolcall: true,
            input: {
              text: true,
              audio: false,
              image: true,
              video: false,
              pdf: false,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
          },
          limit: {
            context: 128000,
            output: 8192,
          },
        },
      ],
      selection: {
        model: "deepseek/deepseek-reasoner",
      },
    })

    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Models/ }))
    expect(await screen.findByText("GPT-4o mini")).toBeInTheDocument()

    fireEvent.click(await screen.findByRole("button", { name: "Primary model: DeepSeek / DeepSeek Reasoner" }))
    let modelPicker = screen.getByRole("dialog", { name: "Primary model model picker" })
    fireEvent.change(within(modelPicker).getByRole("searchbox", { name: "Search providers or models" }), {
      target: {
        value: "openai",
      },
    })
    fireEvent.click(within(modelPicker).getByRole("option", { name: "GPT-4o mini" }))

    fireEvent.click(screen.getByRole("button", { name: "Small model: Use server default" }))
    modelPicker = screen.getByRole("dialog", { name: "Small model model picker" })
    fireEvent.click(within(modelPicker).getByRole("option", { name: "DeepSeek Reasoner" }))

    await waitFor(() => {
      expect(window.desktop!.updateGlobalModelSelection).toHaveBeenNthCalledWith(1, {
        model: "openai/gpt-4o-mini",
      })
      expect(window.desktop!.updateGlobalModelSelection).toHaveBeenNthCalledWith(2, {
        small_model: "deepseek/deepseek-reasoner",
      })
    })

    expect(await screen.findByText("Model settings saved.")).toBeInTheDocument()
  })

  it("uses global provider settings APIs when a workspace is selected", async () => {
    window.desktop!.getGlobalProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "deepseek",
        name: "DeepSeek",
        source: "config",
        env: ["DEEPSEEK_API_KEY"],
        configured: true,
        available: true,
        apiKeyConfigured: true,
        baseURL: "https://api.deepseek.com",
        modelCount: 2,
      },
    ])
    window.desktop!.getGlobalModels = vi.fn().mockResolvedValue({
      items: [
        {
          id: "deepseek-reasoner",
          providerID: "deepseek",
          name: "DeepSeek Reasoner",
          status: "active",
          available: true,
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: false,
            toolcall: true,
            input: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
          },
          limit: {
            context: 128000,
            output: 8192,
          },
        },
      ],
      selection: {
        model: "deepseek/deepseek-reasoner",
      },
    })
    window.desktop!.getProjectProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "openai",
        name: "OpenAI",
        source: "config",
        env: ["OPENAI_API_KEY"],
        configured: true,
        available: true,
        apiKeyConfigured: true,
        baseURL: "https://api.openai.com/v1",
        modelCount: 1,
      },
    ])
    window.desktop!.getProjectModels = vi.fn().mockResolvedValue({
      items: [
        {
          id: "gpt-4o-mini",
          providerID: "openai",
          name: "GPT-4o mini",
          status: "active",
          available: true,
          capabilities: {
            temperature: true,
            reasoning: false,
            attachment: true,
            toolcall: true,
            input: {
              text: true,
              audio: false,
              image: true,
              video: false,
              pdf: false,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
          },
          limit: {
            context: 128000,
            output: 8192,
          },
        },
      ],
      selection: {
        model: "openai/gpt-4o-mini",
        small_model: "openai/gpt-4o-mini",
      },
    })
    window.desktop!.updateProjectProvider = vi.fn().mockResolvedValue({
      provider: {
        id: "openai",
        name: "OpenAI",
        available: true,
        apiKeyConfigured: true,
      },
      selection: {},
    })
    window.desktop!.deleteProjectProvider = vi.fn().mockResolvedValue({
      providerID: "openai",
      selection: {},
    })
    window.desktop!.updateProjectModelSelection = vi.fn().mockResolvedValue({
      model: "openai/gpt-4o-mini",
      small_model: "openai/gpt-4o-mini",
    })
    window.desktop!.refreshProjectProviderCatalog = vi.fn().mockResolvedValue([
      {
        id: "openai",
        name: "OpenAI",
        source: "config",
        env: ["OPENAI_API_KEY"],
        configured: true,
        available: true,
        apiKeyConfigured: true,
        baseURL: "https://api.openai.com/v1",
        modelCount: 1,
      },
    ])

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.getProjectModels).toHaveBeenCalledWith({
        projectID: "project-2",
      })
    })
    const projectModelCallCountBeforeSettings = vi.mocked(window.desktop!.getProjectModels).mock.calls.length

    const settingsDialog = await openProviderSettingsSection()

    await waitFor(() => {
      expect(window.desktop!.getGlobalProviderCatalog).toHaveBeenCalled()
      expect(window.desktop!.getGlobalModels).toHaveBeenCalled()
    })

    expect(window.desktop!.getProjectProviderCatalog).not.toHaveBeenCalled()
    expect(window.desktop!.getProjectModels).toHaveBeenCalledTimes(projectModelCallCountBeforeSettings)

    fireEvent.click(screen.getByRole("button", { name: "Refresh provider catalog" }))

    await waitFor(() => {
      expect(window.desktop!.refreshGlobalProviderCatalog).toHaveBeenCalledTimes(1)
    })

    expect(window.desktop!.refreshProjectProviderCatalog).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: /^Models/ }))

    expect((await within(settingsDialog).findAllByText("DeepSeek Reasoner")).length).toBeGreaterThan(0)
    expect(within(settingsDialog).queryByText("GPT-4o mini")).not.toBeInTheDocument()
  })

  it("updates the active session model selection from the composer menu", async () => {
    const modelPayload = {
      items: [
        {
          id: "deepseek-reasoner",
          providerID: "deepseek",
          name: "DeepSeek Reasoner",
          status: "active",
          available: true,
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: false,
            toolcall: true,
            input: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
          },
          limit: {
            context: 128000,
            output: 8192,
          },
        },
        {
          id: "gpt-4o-mini",
          providerID: "openai",
          name: "GPT-4o mini",
          status: "active",
          available: true,
          capabilities: {
            temperature: true,
            reasoning: false,
            attachment: true,
            toolcall: true,
            input: {
              text: true,
              audio: false,
              image: true,
              video: false,
              pdf: false,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
          },
          limit: {
            context: 128000,
            output: 8192,
          },
        },
      ],
      selection: {
        model: "deepseek/deepseek-reasoner",
        small_model: "deepseek/deepseek-reasoner",
      },
    }
    window.desktop!.getProjectModels = vi.fn().mockResolvedValue(modelPayload)
    window.desktop!.getSessionModels = vi.fn().mockResolvedValue(modelPayload)
    window.desktop!.updateSessionModelSelection = vi.fn().mockResolvedValue({
      model: "openai/gpt-4o-mini",
      small_model: "deepseek/deepseek-reasoner",
    })

    render(<App />)

    const attachmentButton = await screen.findByRole("button", { name: "Add attachments" })
    expect(attachmentButton).not.toBeDisabled()
    expect(attachmentButton).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(await screen.findByRole("button", { name: "Select model: DeepSeek Reasoner" }))
    const modelList = screen.getByRole("listbox", { name: "Model selection" })
    expect(within(modelList).queryByRole("option", { name: "Use server default" })).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole("searchbox", { name: "Search models" }), {
      target: {
        value: "gpt",
      },
    })
    expect(within(modelList).queryByRole("option", { name: /DeepSeek Reasoner/ })).not.toBeInTheDocument()
    fireEvent.click(within(modelList).getByRole("option", { name: "GPT-4o mini OpenAI" }))

    await waitFor(() => {
      expect(window.desktop!.updateSessionModelSelection).toHaveBeenCalledWith({
        sessionID: "session-chat-1",
        model: "openai/gpt-4o-mini",
      })
    })

    expect(await screen.findByRole("button", { name: "Select model: GPT-4o mini" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add attachments" })).toBeEnabled()
  })

  it("includes the selected OpenAI reasoning effort in composer sends", async () => {
    const gpt54Model = {
      id: "gpt-5.4",
      providerID: "openai",
      name: "GPT-5.4",
      status: "active",
      available: true,
      capabilities: {
        temperature: false,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
      },
      limit: {
        context: 272000,
        output: 8192,
      },
    }

    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.getProjectModels = vi.fn().mockResolvedValue({
      items: [gpt54Model],
      selection: {
        model: "openai/gpt-5.4",
        small_model: "openai/gpt-5.4",
      },
      effectiveModel: gpt54Model,
    })
    window.desktop!.getSessionModels = vi.fn().mockResolvedValue({
      items: [gpt54Model],
      selection: {
        model: "openai/gpt-5.4",
        small_model: "openai/gpt-5.4",
      },
      effectiveModel: gpt54Model,
    })

    render(<App />)

    fireEvent.click(await screen.findByRole("button", { name: "Select reasoning effort: Medium" }))
    expect(screen.queryByRole("option", { name: "Model default" })).not.toBeInTheDocument()
    expect(screen.queryByText("Spend more compute on harder or more ambiguous tasks.")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("option", { name: /^High/ }))

    expect(await screen.findByRole("button", { name: "Select model: GPT-5.4" })).toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "Select reasoning effort: High" })).toBeInTheDocument()

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Trace the new toolbar flow")
    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "session-backend",
        skills: [],
        text: "Trace the new toolbar flow",
        reasoningEffort: "high",
      }))
    })
  })

  it("renders the project skill selector in the session canvas top menu and still sends selected skills", async () => {
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.getProjectSkills = vi.fn().mockResolvedValue([
      {
        id: "skill-layout-review",
        name: "layout-review",
        description: "Review the current layout against the desktop shell spec.",
        path: "C:\\Users\\19128\\.anybox\\skills\\layout-review\\SKILL.md",
        scope: "user",
      },
    ])
    window.desktop!.getProjectSkillSelection = vi.fn().mockResolvedValue({
      skillIDs: [],
    })
    window.desktop!.updateProjectSkillSelection = vi.fn().mockResolvedValue({
      skillIDs: ["skill-layout-review"],
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.getAgentHealth).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(window.desktop!.getProjectSkills).toHaveBeenCalledWith({
        projectID: "project-2",
      })
      expect(window.desktop!.getProjectSkillSelection).toHaveBeenCalledWith({
        projectID: "project-2",
      })
    })

    const skillButton = await screen.findByRole("button", { name: "Select project skills: Skills" })
    expect(skillButton.closest(".session-canvas-top-menu")).not.toBeNull()

    const composer = document.querySelector(".composer")
    expect(composer).not.toBeNull()
    expect(within(composer as HTMLElement).queryByRole("button", { name: /^Select project skills:/ })).not.toBeInTheDocument()

    fireEvent.click(skillButton)

    const skillMenu = screen.getByRole("dialog", { name: "Project skill selection" })
    expect(within(skillMenu).getByRole("searchbox", { name: "Search skills" })).toBeInTheDocument()
    fireEvent.click(await within(skillMenu).findByRole("option", { name: "layout-review" }))

    await waitFor(() => {
      expect(window.desktop!.updateProjectSkillSelection).toHaveBeenCalledWith({
        projectID: "project-2",
        skillIDs: ["skill-layout-review"],
      })
    })

    expect(await screen.findByRole("button", { name: "Select project skills: layout-review" })).toBeInTheDocument()

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Use the project skill selection for this task")
    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "session-backend",
        skills: ["skill-layout-review"],
        text: "Use the project skill selection for this task",
      }))
    })

    expect(await screen.findByRole("button", { name: "Select project skills: layout-review" })).toBeInTheDocument()
  })

  it("renders the project plugin selector in the session canvas top menu", async () => {
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.getProjectPlugins = vi.fn().mockResolvedValue([
      {
        pluginID: "build-web-apps",
        version: "0.1.0",
        enabled: true,
        mcpServerIDs: ["plugin.build-web-apps"],
        skillIDs: ["plugin:build-web-apps:frontend-app-builder"],
        connectorIDs: [],
        mcpRequirementIDs: [],
        connectorRequirementIDs: [],
        config: {},
        installedAt: 1,
        updatedAt: 1,
      },
    ])
    window.desktop!.getPluginCatalog = vi.fn().mockResolvedValue([
      {
        id: "build-web-apps",
        name: "Build Web Apps",
        description: "Frontend app tools.",
        version: "0.1.0",
        publisher: "Anybox",
        category: "Code",
        risk: "medium",
        permissions: [],
        tools: [],
        configFields: [],
        mcpServers: [],
        mcpRequirements: [],
        skills: [],
        connectorRequirements: [],
        apps: [],
      },
    ])
    window.desktop!.getProjectPluginSelection = vi.fn().mockResolvedValue({
      pluginIDs: [],
    })
    window.desktop!.updateProjectPluginSelection = vi.fn().mockResolvedValue({
      pluginIDs: ["build-web-apps"],
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.getProjectPlugins).toHaveBeenCalledWith({
        projectID: "project-2",
      })
      expect(window.desktop!.getProjectPluginSelection).toHaveBeenCalledWith({
        projectID: "project-2",
      })
    })

    expect(screen.getByRole("button", { name: /^Select project plugins:/ })).toBeInTheDocument()
    expect(screen.queryByRole("menu", { name: "Project plugin selection" })).not.toBeInTheDocument()
    expect(window.desktop!.updateProjectPluginSelection).not.toHaveBeenCalled()
  })

  it("renders the project MCP selector in the session canvas top menu and persists selected servers", async () => {
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.getGlobalMcpServers = vi.fn().mockResolvedValue([
      {
        id: "filesystem",
        name: "Filesystem",
        transport: "stdio",
        command: "npx",
        enabled: true,
      },
    ])
    window.desktop!.getProjectMcpSelection = vi.fn().mockResolvedValue({
      serverIDs: [],
    })
    window.desktop!.updateProjectMcpSelection = vi.fn().mockResolvedValue({
      serverIDs: ["filesystem"],
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.getAgentHealth).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(window.desktop!.getGlobalMcpServers).toHaveBeenCalledTimes(1)
      expect(window.desktop!.getProjectMcpSelection).toHaveBeenCalledWith({
        projectID: "project-2",
      })
    })

    const mcpButton = await screen.findByRole("button", { name: "Select project MCP servers: MCP" })
    expect(mcpButton.closest(".session-canvas-top-menu")).not.toBeNull()

    fireEvent.click(mcpButton)

    const mcpMenu = screen.getByRole("menu", { name: "Project MCP server selection" })
    fireEvent.click(await within(mcpMenu).findByRole("menuitemcheckbox", { name: /Filesystem/i }))

    await waitFor(() => {
      expect(window.desktop!.updateProjectMcpSelection).toHaveBeenCalledWith({
        projectID: "project-2",
        serverIDs: ["filesystem"],
      })
    })

    expect(await screen.findByRole("button", { name: "Select project MCP servers: Filesystem" })).toBeInTheDocument()

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Keep the selected MCP servers on the project")
    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "session-backend",
        skills: [],
        text: "Keep the selected MCP servers on the project",
      }))
    })

    expect(await screen.findByRole("button", { name: "Select project MCP servers: Filesystem" })).toBeInTheDocument()
  })

  it("adds composer attachments and includes them in agent requests", async () => {
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.getProjectModels = vi.fn().mockResolvedValue({
      items: [
        {
          id: "gpt-4o-mini",
          providerID: "openai",
          name: "GPT-4o mini",
          status: "active",
          available: true,
          capabilities: {
            temperature: true,
            reasoning: false,
            attachment: true,
            toolcall: true,
            input: {
              text: true,
              audio: false,
              image: true,
              video: false,
              pdf: true,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
          },
          limit: {
            context: 128000,
            output: 8192,
          },
        },
      ],
      selection: {},
      effectiveModel: {
        id: "gpt-4o-mini",
        providerID: "openai",
        name: "GPT-4o mini",
        status: "active",
        available: true,
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: true,
          toolcall: true,
          input: {
            text: true,
            audio: false,
            image: true,
            video: false,
            pdf: true,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
        },
        limit: {
          context: 128000,
          output: 8192,
        },
      },
    })
    window.desktop!.pickComposerAttachments = vi.fn().mockResolvedValue([
      "C:\\Refs\\hero.png",
      "C:\\Refs\\brief.pdf",
    ])

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.getAgentHealth).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(window.desktop!.getProjectModels).toHaveBeenCalledWith({
        projectID: "project-2",
      })
      expect(screen.getByRole("button", { name: "Add attachments" })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole("button", { name: "Add attachments" }))

    await waitFor(() => {
      expect(window.desktop!.pickComposerAttachments).toHaveBeenCalledWith({
        allowImage: true,
        allowPdf: true,
      })
    })
    expect(await screen.findByRole("img", { name: "hero.png" })).toBeInTheDocument()
    expect(screen.getByText("brief.pdf")).toBeInTheDocument()

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Use the references to refine the layout")
    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "session-backend",
        attachments: [
          { path: "C:\\Refs\\hero.png", name: "hero.png" },
          { path: "C:\\Refs\\brief.pdf", name: "brief.pdf" },
        ],
        skills: [],
        text: "Use the references to refine the layout",
      }))
    })
  })

  it("submits composer prompts without an agent mode selector", async () => {
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.getAgentHealth).toHaveBeenCalledTimes(1)
    })

    expect(screen.queryByRole("button", { name: /^Agent mode:/ })).not.toBeInTheDocument()
    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Audit the toolbar changes")
    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "session-backend",
        skills: [],
        text: "Audit the toolbar changes",
      }))
    })
  })

  it("submits composer prompts with Enter and exposes the shortcut hint", async () => {
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.getAgentHealth).toHaveBeenCalledTimes(1)
    })

    const draftInput = screen.getByRole("textbox", { name: "Task draft" })
    const sendButton = getComposerSendButton()

    expect(sendButton).toHaveAttribute("title", "Send task. Press Enter to send. Press Shift+Enter for a newline.")
    expect(sendButton).toHaveAttribute("aria-description", "Press Enter to send. Press Shift+Enter for a newline.")
    expect(sendButton).toHaveAttribute("aria-keyshortcuts", "Enter")
    expect(draftInput).toHaveAttribute("aria-description", "Press Enter to send. Press Shift+Enter for a newline.")

    setComposerDraftValue(draftInput, "Submit from the keyboard")

    const enterEvent = createEvent.keyDown(draftInput, { key: "Enter", code: "Enter" })
    fireEvent(draftInput, enterEvent)

    expect(enterEvent.defaultPrevented).toBe(true)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "session-backend",
        skills: [],
        text: "Submit from the keyboard",
      }))
    })
  })

  it("keeps Shift+Enter available for newline insertion in the composer", () => {
    render(<App />)

    const draftInput = screen.getByRole("textbox", { name: "Task draft" })

    setComposerDraftValue(draftInput, "Keep editing this draft")

    const shiftEnterEvent = createEvent.keyDown(draftInput, {
      key: "Enter",
      code: "Enter",
      shiftKey: true,
    })
    fireEvent(draftInput, shiftEnterEvent)

    expect(shiftEnterEvent.defaultPrevented).toBe(false)
    expect(window.desktop!.agentSession!.sendTurn).not.toHaveBeenCalled()
  })

  it("does not submit composer prompts while IME composition is active", async () => {
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.getAgentHealth).toHaveBeenCalledTimes(1)
    })

    const draftInput = screen.getByRole("textbox", { name: "Task draft" })

    setComposerDraftValue(draftInput, "你好")

    fireEvent.compositionStart(draftInput)

    const composingEnterEvent = createEvent.keyDown(draftInput, {
      key: "Enter",
      code: "Enter",
      keyCode: 229,
    })
    fireEvent(draftInput, composingEnterEvent)

    expect(composingEnterEvent.defaultPrevented).toBe(false)
    expect(window.desktop!.agentSession!.sendTurn).not.toHaveBeenCalled()

    fireEvent.compositionEnd(draftInput)

    const enterEvent = createEvent.keyDown(draftInput, { key: "Enter", code: "Enter" })
    fireEvent(draftInput, enterEvent)

    expect(enterEvent.defaultPrevented).toBe(true)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalledWith(expect.objectContaining({
        backendSessionID: "session-backend",
        skills: [],
        text: "你好",
      }))
    })
  })

  it("archives a session from the sidebar", async () => {
    window.desktop!.archiveAgentSession = vi.fn().mockResolvedValue({
      sessionID: "session-chat-1",
      projectID: "project-2",
      directory: "C:\\Projects\\Project 2",
      archivedAt: 1,
    })

    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Archive session Chat 1" }))

    await waitFor(() => {
      expect(window.desktop!.archiveAgentSession).toHaveBeenCalledWith({
        sessionID: "session-chat-1",
      })
    })
    expect(screen.queryByRole("button", { name: "Chat 1" })).not.toBeInTheDocument()
  })

  it("unsubscribes a live session stream when archiving a session", async () => {
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Project 2",
        directory: "C:\\Projects\\Project 2",
        name: "Project 2",
        created: 1,
        updated: 20,
        project: {
          id: "project-2",
          name: "Project 2",
          worktree: "C:\\Projects\\Project 2",
        },
        sessions: [
          {
            id: "session-chat-1",
            projectID: "project-2",
            directory: "C:\\Projects\\Project 2",
            title: "Chat 1",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.subscribe = vi.fn().mockResolvedValue({
      backendSessionID: "session-chat-1",
    })
    window.desktop!.agentSession!.unsubscribe = vi.fn().mockResolvedValue({
      backendSessionID: "session-chat-1",
      removed: true,
    })
    window.desktop!.archiveAgentSession = vi.fn().mockResolvedValue({
      sessionID: "session-chat-1",
      projectID: "project-2",
      directory: "C:\\Projects\\Project 2",
      archivedAt: 1,
    })

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.subscribe).toHaveBeenCalledWith({
        uiSessionID: "session-chat-1",
        backendSessionID: "session-chat-1",
      })
    })

    fireEvent.click(screen.getByRole("button", { name: "Archive session Chat 1" }))

    await waitFor(() => {
      expect(window.desktop!.agentSession!.unsubscribe).toHaveBeenCalledWith({
        backendSessionID: "session-chat-1",
      })
    })
  })

  it("removes a folder from the sidebar without deleting it from the backend", () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "src" }))
    expect(screen.getByRole("button", { name: "src" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "app" })).toHaveAttribute("aria-expanded", "true")

    fireEvent.contextMenu(screen.getByRole("button", { name: "app" }), {
      clientX: 120,
      clientY: 160,
    })
    fireEvent.click(screen.getByRole("menuitem", { name: "\u79FB\u9664" }))

    expect(screen.queryByRole("button", { name: "app" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Chat 1" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "src" }).closest(".project-row")).toHaveClass("is-active")
    expect(screen.getByRole("button", { name: "src" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "Layout pass" })).toBeInTheDocument()
    expect(window.desktop!.deleteProjectWorkspace).not.toHaveBeenCalled()
  })

  it("applies maximized window styling when the window starts maximized", async () => {
    window.desktop!.getWindowState = vi.fn().mockResolvedValue({
      isMaximized: true,
    })

    const { container } = render(<App />)

    await waitFor(() => {
      expect(container.firstChild).toHaveClass("window-shell", "is-maximized")
    })
  })

  it("appends a prompt and clears the draft input", async () => {
    render(<App />)

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Ship custom titlebar")
    fireEvent.click(getComposerSendButton())

    await waitFor(() => {
      expect(screen.getAllByText("Ship custom titlebar").length).toBeGreaterThan(0)
      expectComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "")
    })
  })

  it("shows a minimal waiting hint before the first visible streamed output arrives", async () => {
    let streamListener: DesktopAgentSessionEventListener | undefined
    let releaseStream: (() => void) | undefined
    let activeStreamID = ""
    let activeSessionID = ""

    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      streamListener = listener
      return vi.fn()
    })
    window.desktop!.agentSession!.sendTurn = vi.fn().mockImplementation(
      async (input: {
        clientTurnID: string
        backendSessionID: string
        text: string
      }) => {
        activeStreamID = input.clientTurnID
        activeSessionID = input.backendSessionID

        await new Promise<void>((resolve) => {
          releaseStream = resolve
        })

        return {
          clientTurnID: input.clientTurnID,
        }
      },
    )

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.onEvent).toHaveBeenCalledTimes(1)
    })

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Wait for the first token")
    await act(async () => {
      fireEvent.click(getComposerSendButton())
      await Promise.resolve()
    })

    expect(screen.getByText("Preparing...")).toBeInTheDocument()
    expect(
      screen.getByText("Wait for the first token", {
        selector: ".user-bubble-text",
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole("status", { name: /Sending message|正在发送消息/ })).toBeInTheDocument()
    expect(getComposerSendButton()).toBeEnabled()

    await act(async () => {
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        event: "delta",
        data: {
          kind: "text",
          partID: "part-text-1",
          delta: "Ready now.",
          text: "Ready now.",
        },
      }))
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        event: "done",
        data: {
          sessionID: activeSessionID,
          parts: [{ id: "part-text-1", type: "text", text: "Ready now." }],
        },
      }))
      releaseStream?.()
      await Promise.resolve()
    })

    expect(await screen.findByText("Ready now.")).toBeInTheDocument()
    expect(screen.queryByText("Preparing...")).not.toBeInTheDocument()
  })

  it("ignores stale session stream events after the request stream settles a backend turn", async () => {
    let streamListener: DesktopAgentSessionEventListener | undefined
    let sessionStreamListener: DesktopAgentSessionEventListener | undefined
    let releaseStream: (() => void) | undefined
    let activeStreamID = ""
    let activeSessionID = ""

    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 10,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.agentSession!.loadHistory = vi.fn().mockResolvedValue([])
    window.desktop!.agentSession!.subscribe = vi.fn().mockResolvedValue({
      backendSessionID: "session-atlas-review",
    })
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      streamListener = listener
      sessionStreamListener = listener
      return vi.fn()
    })
    window.desktop!.agentSession!.sendTurn = vi.fn().mockImplementation(
      async (input: {
        clientTurnID: string
        backendSessionID: string
        text: string
      }) => {
        activeStreamID = input.clientTurnID
        activeSessionID = input.backendSessionID

        await new Promise<void>((resolve) => {
          releaseStream = resolve
        })

        return {
          clientTurnID: input.clientTurnID,
        }
      },
    )

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.subscribe).toHaveBeenCalledWith({
        uiSessionID: "session-atlas-review",
        backendSessionID: "session-atlas-review",
      })
    })

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Finish without stale placeholders")
    await act(async () => {
      fireEvent.click(getComposerSendButton())
      await Promise.resolve()
    })

    expect(screen.getByText("Preparing...")).toBeInTheDocument()

    await act(async () => {
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        id: "102:turn-runtime:3",
        event: "runtime",
        data: {
          eventID: "event-completed",
          sessionID: "session-atlas-review",
          turnID: "turn-runtime",
          seq: 3,
          timestamp: 102,
          type: "turn.completed",
          payload: {
            status: "completed",
            finishReason: "stop",
            parts: [{ id: "part-text", type: "text", text: "Done." }],
          },
        },
      }))
      releaseStream?.()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.queryByText("Preparing...")).not.toBeInTheDocument()
    })

    act(() => {
      sessionStreamListener?.(createSubscriptionStreamEvent({
        backendSessionID: "session-atlas-review",
        id: "100:turn-runtime:1",
        event: "runtime",
        data: {
          eventID: "event-started-late",
          sessionID: "session-atlas-review",
          turnID: "turn-runtime",
          seq: 1,
          timestamp: 100,
          type: "turn.started",
          payload: {},
        },
      }))
    })

    expect(screen.queryByText("Preparing...")).not.toBeInTheDocument()
  })

  it("keeps a subscription-first multi-segment turn under one processing summary", async () => {
    let streamListener: DesktopAgentSessionEventListener | undefined
    let releaseStream: (() => void) | undefined
    let activeStreamID = ""
    let activeSessionID = ""
    const firstReasoning = "First segment reasoning stays inside the canonical execution group. ".repeat(5)
    const secondReasoning = "Second segment reasoning continues the same backend turn after a tool boundary. ".repeat(5)

    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      streamListener = listener
      return vi.fn()
    })
    window.desktop!.agentSession!.sendTurn = vi.fn().mockImplementation(
      async (input: {
        clientTurnID: string
        backendSessionID: string
        text: string
      }) => {
        activeStreamID = input.clientTurnID
        activeSessionID = input.backendSessionID
        await new Promise<void>((resolve) => {
          releaseStream = resolve
        })
        return { clientTurnID: input.clientTurnID }
      },
    )

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.onEvent).toHaveBeenCalledTimes(1)
    })

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Run one multi-step turn")
    await act(async () => {
      fireEvent.click(getComposerSendButton())
      await Promise.resolve()
    })
    const submittedUserRow = (await screen.findByText("Run one multi-step turn")).closest<HTMLElement>(
      '[data-thread-message-id]',
    )
    expect(submittedUserRow).not.toBeNull()
    const pendingGroupID = `turn:pending:${submittedUserRow!.dataset.threadMessageId}`
    const executionSummaries = () => Array.from(
      document.querySelectorAll<HTMLElement>(".assistant-execution-summary-button"),
    ).filter((summary) => (
      summary.dataset.threadExecutionGroupId === pendingGroupID ||
      summary.dataset.threadExecutionGroupId === "turn:turn-one"
    ))

    act(() => {
      streamListener?.(createSubscriptionStreamEvent({
        backendSessionID: activeSessionID,
        id: "100:turn-one:1",
        event: "runtime",
        data: {
          eventID: "event-turn-started",
          sessionID: activeSessionID,
          turnID: "turn-one",
          seq: 1,
          timestamp: 100,
          type: "turn.started",
          payload: {
            userMessageID: "msg-user-backend",
          },
        },
      }))
    })

    act(() => {
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        id: "101:turn-one:2",
        event: "runtime",
        data: {
          eventID: "event-llm-first",
          sessionID: activeSessionID,
          turnID: "turn-one",
          seq: 2,
          timestamp: 101,
          type: "llm.call.started",
          payload: {
            iteration: 1,
            messageID: "msg-assistant-first",
          },
        },
      }))
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        id: "102:turn-one:3",
        event: "delta",
        data: {
          turnID: "turn-one",
          messageID: "msg-assistant-first",
          partID: "reasoning-first",
          kind: "reasoning",
          delta: firstReasoning,
          text: firstReasoning,
        },
      }))
    })

    await waitFor(() => {
      const summaries = executionSummaries()
      expect(summaries).toHaveLength(1)
      expect(summaries[0]).toHaveAttribute("data-thread-execution-group-id", "turn:turn-one")
    })

    act(() => {
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        id: "103:turn-one:4",
        event: "runtime",
        data: {
          eventID: "event-llm-second",
          sessionID: activeSessionID,
          turnID: "turn-one",
          seq: 4,
          timestamp: 103,
          type: "llm.call.started",
          payload: {
            iteration: 1,
            messageID: "msg-assistant-second",
          },
        },
      }))
      streamListener?.(createRequestStreamEvent({
        backendSessionID: activeSessionID,
        clientTurnID: activeStreamID,
        id: "104:turn-one:5",
        event: "delta",
        data: {
          turnID: "turn-one",
          messageID: "msg-assistant-second",
          partID: "reasoning-second",
          kind: "reasoning",
          delta: secondReasoning,
          text: secondReasoning,
        },
      }))
    })

    await waitFor(() => {
      expect(executionSummaries()).toHaveLength(1)
      expect(screen.getByText(firstReasoning.trim())).toBeInTheDocument()
      expect(screen.getByText(secondReasoning.trim())).toBeInTheDocument()
    })

    await act(async () => {
      releaseStream?.()
      await Promise.resolve()
    })
  })

  it("renders streamed reasoning and response before completion", async () => {
    let streamListener: DesktopAgentSessionEventListener | undefined
    let finishStream: (() => void) | undefined

    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      streamListener = listener
      return vi.fn()
    })
    window.desktop!.agentSession!.sendTurn = vi.fn().mockImplementation(
      async (input: {
        clientTurnID: string
        backendSessionID: string
        text: string
      }) => {
        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "started",
          data: { sessionID: input.backendSessionID },
        }))
        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "delta",
          data: { kind: "reasoning", delta: "Planning live update." },
        }))
        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "delta",
          data: { kind: "text", delta: "Streaming answer" },
        }))

        await new Promise<void>((resolve) => {
          finishStream = () => {
            streamListener?.(createRequestStreamEvent({
              backendSessionID: input.backendSessionID,
              clientTurnID: input.clientTurnID,
              event: "done",
              data: {
                sessionID: input.backendSessionID,
                parts: [{ id: "part-text", type: "text", text: "Streaming answer" }],
              },
            }))
            resolve()
          }
        })

        return {
          clientTurnID: input.clientTurnID,
        }
      },
    )

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.getAgentHealth).toHaveBeenCalledTimes(1)
      expect(window.desktop!.agentSession!.onEvent).toHaveBeenCalledTimes(1)
    })

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Show live output")
    await act(async () => {
      fireEvent.click(getComposerSendButton())
      await Promise.resolve()
    })

    const liveReasoning = await screen.findByText("Planning live update.")
    const reasoningItem = liveReasoning.closest(".trace-item")

    expect(liveReasoning).toBeInTheDocument()
    expect(reasoningItem).toHaveAttribute("data-kind", "reasoning")
    expect(reasoningItem).not.toBeNull()
    expect(reasoningItem?.querySelector(".trace-item-header")).toBeNull()
    expect(screen.getByText("Streaming answer")).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Streaming response" })).not.toBeInTheDocument()
    expect(screen.queryByText("Renderer subscribed to live backend updates.")).not.toBeInTheDocument()
    expect(screen.queryByText("Waiting for backend response.")).not.toBeInTheDocument()
    expect(getComposerSendButton()).toBeEnabled()

    act(() => {
      finishStream?.()
    })

    expect(await screen.findByText("Streaming answer")).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Backend response received" })).not.toBeInTheDocument()
      expect(screen.queryByText("Backend finished streaming this response.")).not.toBeInTheDocument()
      expect(getComposerSendButton()).toBeEnabled()
    })
  })

  it("refreshes the sidebar workspace metadata after a streamed session updates git metadata", async () => {
    let sessionStreamListener: DesktopAgentSessionEventListener | undefined

    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "prj_atlas",
          name: "client",
          worktree: "C:\\Projects\\Atlas\\client",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "prj_atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.openFolderWorkspace = vi.fn().mockResolvedValue({
      id: "C:\\Projects\\Atlas\\client",
      directory: "C:\\Projects\\Atlas\\client",
      name: "client",
      created: 1,
      updated: 21,
      project: {
        id: "prj_atlas",
        name: "Atlas",
        worktree: "C:\\Projects\\Atlas",
      },
      sessions: [
        {
          id: "session-atlas-review",
          projectID: "prj_atlas",
          directory: "C:\\Projects\\Atlas\\client",
          title: "Atlas review",
          created: 18,
          updated: 21,
        },
      ],
    } satisfies LoadedFolderWorkspace)
    window.desktop!.agentSession!.subscribe = vi.fn().mockResolvedValue({
      backendSessionID: "session-atlas-review",
    })
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      sessionStreamListener = listener
      return vi.fn()
    })

    render(<App />)

    expect((await screen.findAllByText("client")).length).toBeGreaterThan(0)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.subscribe).toHaveBeenCalledWith({
        uiSessionID: "session-atlas-review",
        backendSessionID: "session-atlas-review",
      })
      expect(window.desktop!.agentSession!.onEvent).toHaveBeenCalledTimes(1)
    })

    act(() => {
      sessionStreamListener?.(createSubscriptionStreamEvent({
        backendSessionID: "session-atlas-review",
        event: "done",
        data: {
          message: {
            role: "assistant",
            created: 20,
          },
        },
      }))
    })

    await waitFor(() => {
      expect(window.desktop!.openFolderWorkspace).toHaveBeenCalledWith({
        directory: "C:\\Projects\\Atlas\\client",
      })
    })

    expect(await screen.findByText("C:\\Projects\\Atlas")).toBeInTheDocument()
  })

  it("keeps consecutive streamed replies isolated to their own assistant cards", async () => {
    let streamListener: DesktopAgentSessionEventListener | undefined
    let callIndex = 0
    const streamedReplies = [
      {
        delta: "First reply",
        fullText: "First reply",
        finalText: "First reply",
      },
      {
        delta: "Second reply",
        fullText: "First replySecond reply",
        finalText: "Second reply",
      },
    ]

    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      streamListener = listener
      return vi.fn()
    })
    window.desktop!.agentSession!.sendTurn = vi.fn().mockImplementation(
      async (input: {
        clientTurnID: string
        backendSessionID: string
        text: string
      }) => {
        const reply = streamedReplies[callIndex++]
        if (!reply) {
          throw new Error("Unexpected extra streamed reply")
        }

        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "started",
          data: { sessionID: input.backendSessionID },
        }))
        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "delta",
          data: {
            kind: "text",
            delta: reply.delta,
            text: reply.fullText,
          },
        }))
        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "done",
          data: {
            sessionID: input.backendSessionID,
            parts: [{ id: `part-text-${callIndex}`, type: "text", text: reply.finalText }],
          },
        }))

        return {
          clientTurnID: input.clientTurnID,
        }
      },
    )

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.agentSession!.onEvent).toHaveBeenCalledTimes(1)
    })
    const threadColumn = document.querySelector(".thread-column") as HTMLElement | null
    expect(threadColumn).not.toBeNull()
    setElementScrollMetrics(threadColumn!, {
      clientHeight: 720,
      scrollHeight: 3200,
      scrollTop: 0,
    })

    const draftInput = screen.getByRole("textbox", { name: "Task draft" })
    const sendButton = getComposerSendButton()

    setComposerDraftValue(draftInput, "First prompt")
    fireEvent.click(sendButton)
    await waitFor(() => {
      expect(window.desktop!.agentSession!.sendTurn).toHaveBeenCalled()
    })

    const firstReplyText = await screen.findByText("First reply")
    const firstReplyMessage = firstReplyText.closest('[data-thread-row-kind="assistant-response-row"]')
    expect(firstReplyMessage).not.toBeNull()
    const firstReplyMessageID = firstReplyMessage?.getAttribute("data-thread-message-id")
    await waitFor(() => {
      expect(sendButton).toBeEnabled()
    })

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Second prompt")
    fireEvent.click(getComposerSendButton())

    expect(await screen.findByText("Second reply")).toBeInTheDocument()

    await waitFor(() => {
      const secondReplyMessage = screen.getByText("Second reply").closest('[data-thread-row-kind="assistant-response-row"]')

      expect(secondReplyMessage).not.toBeNull()
      expect(secondReplyMessage?.getAttribute("data-thread-message-id")).not.toBe(firstReplyMessageID)
      expect(secondReplyMessage).not.toHaveTextContent("First reply")
    })
  })

  it("toggles folder tree expansion when clicking the same folder", () => {
    render(<App />)

    const appFolder = screen.getByRole("button", { name: "app" })
    expect(appFolder).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "Chat 1" })).toBeInTheDocument()

    fireEvent.click(appFolder)

    expect(appFolder).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("button", { name: "Chat 1" })).not.toBeInTheDocument()

    fireEvent.click(appFolder)

    expect(appFolder).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "Chat 1" })).toBeInTheDocument()
  })

  it("keeps other folders expanded when selecting a different folder", () => {
    render(<App />)

    const appFolder = screen.getByRole("button", { name: "app" })
    const srcFolder = screen.getByRole("button", { name: "src" })

    expect(appFolder).toHaveAttribute("aria-expanded", "true")
    expect(srcFolder).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(srcFolder)

    expect(appFolder).toHaveAttribute("aria-expanded", "true")
    expect(srcFolder).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: "Chat 1" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Layout pass" })).toBeInTheDocument()
    expect(srcFolder.closest(".project-row")).toHaveClass("is-active")
    expect(appFolder.closest(".project-row")).not.toHaveClass("is-active")
    expect(document.querySelectorAll(".project-row.is-active")).toHaveLength(1)

    fireEvent.click(appFolder)

    expect(appFolder).toHaveAttribute("aria-expanded", "false")
    expect(srcFolder).toHaveAttribute("aria-expanded", "true")
    expect(screen.queryByRole("button", { name: "Chat 1" })).not.toBeInTheDocument()
    expect(appFolder.closest(".project-row")).toHaveClass("is-active")
    expect(srcFolder.closest(".project-row")).not.toHaveClass("is-active")
    expect(document.querySelectorAll(".project-row.is-active")).toHaveLength(1)
  })

  it("opens a terminal tab from the right sidebar launcher and keeps PTY close semantics internal", async () => {
    render(<App />)

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    const terminalLauncher = within(inspector).getByRole("button", { name: /^Terminal/ })
    expect(terminalLauncher.closest(".right-sidebar-launcher")).not.toBeNull()

    fireEvent.click(terminalLauncher)

    expect(within(inspector).getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true")
    const viewHost = inspector.querySelector(".right-sidebar-view-host")
    const terminalPanel = inspector.querySelector(".terminal-panel")
    expect(viewHost).not.toBeNull()
    expect(terminalPanel).not.toBeNull()
    expect(viewHost).toHaveClass("is-terminal")
    expect(terminalPanel).toHaveClass("is-fill")
    expect(inspector.querySelector(".terminal-panel-resizer")).toBeNull()
    expect(within(inspector).getByText("No terminal session is open.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Toggle terminal panel" })).not.toBeInTheDocument()

    fireEvent.click(within(inspector).getByRole("button", { name: "Create terminal" }))

    await waitFor(() => {
      expect(window.desktop!.createPtySession).toHaveBeenCalledTimes(1)
      expect(window.desktop!.attachPtySession).toHaveBeenCalledWith({
        id: "pty-1",
        cursor: 0,
      })
    })

    expect(within(inspector).getByRole("button", { name: /^Terminal 1,/ })).toBeInTheDocument()
    expect(screen.queryByText("New terminal")).not.toBeInTheDocument()
    expect(document.querySelector(".terminal-view-meta")).toBeNull()

    fireEvent.click(within(inspector).getByRole("button", { name: "Close Terminal" }))

    expect(within(inspector).getByLabelText("Right sidebar launcher")).toBeInTheDocument()
    expect(window.desktop!.deletePtySession).not.toHaveBeenCalled()
  })

  it("keeps the terminal launcher available when the left rail is hidden", async () => {
    render(<App />)

    fireEvent.click(screen.getByRole("button", { name: "Open settings" }))
    await screen.findByRole("dialog", { name: "Settings" })
    fireEvent.click(screen.getByRole("button", { name: /^Appearance/ }))
    fireEvent.click(screen.getByRole("switch", { name: "Show left rail" }))

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    const terminalLauncher = within(inspector).getByRole("button", { name: /^Terminal/ })
    expect(terminalLauncher.closest(".right-sidebar-launcher")).not.toBeNull()
  })

  it("shows real context pressure from streamed assistant usage against the selected model context window", async () => {
    let streamListener: DesktopAgentSessionEventListener | undefined

    window.desktop!.listFolderWorkspaces = vi.fn().mockResolvedValue([
      {
        id: "C:\\Projects\\Atlas\\client",
        directory: "C:\\Projects\\Atlas\\client",
        name: "client",
        created: 1,
        updated: 20,
        project: {
          id: "project-atlas",
          name: "Atlas",
          worktree: "C:\\Projects\\Atlas",
        },
        sessions: [
          {
            id: "session-atlas-review",
            projectID: "project-atlas",
            directory: "C:\\Projects\\Atlas\\client",
            title: "Atlas review",
            created: 18,
            updated: 20,
          },
        ],
      },
    ])
    window.desktop!.getProjectModels = vi.fn().mockResolvedValue({
      items: [
        {
          id: "deepseek-reasoner",
          providerID: "deepseek",
          name: "DeepSeek Reasoner",
          status: "active",
          available: true,
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: false,
            toolcall: true,
            input: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
          },
          limit: {
            context: 128000,
            output: 8192,
          },
        },
      ],
      selection: {},
      effectiveModel: {
        id: "deepseek-reasoner",
        providerID: "deepseek",
        name: "DeepSeek Reasoner",
        status: "active",
        available: true,
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: false,
          toolcall: true,
          input: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
        },
        limit: {
          context: 128000,
          output: 8192,
        },
      },
    })
    window.desktop!.getAgentHealth = vi.fn().mockResolvedValue({
      ok: true,
      baseURL: "http://127.0.0.1:4096",
    })
    window.desktop!.agentSession!.onEvent = vi.fn((listener) => {
      streamListener = listener
      return vi.fn()
    })
    window.desktop!.agentSession!.sendTurn = vi.fn().mockImplementation(
      async (input: {
        clientTurnID: string
        backendSessionID: string
        text: string
      }) => {
        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "started",
          data: {
            sessionID: input.backendSessionID,
          },
        }))
        streamListener?.(createRequestStreamEvent({
          backendSessionID: input.backendSessionID,
          clientTurnID: input.clientTurnID,
          event: "done",
          data: {
            sessionID: input.backendSessionID,
            message: {
              id: "message-assistant-1",
              sessionID: input.backendSessionID,
              role: "assistant",
              created: 100,
              completed: 120,
              tokens: {
                input: 64000,
                output: 3200,
                reasoning: 800,
                cache: {
                  read: 1600,
                  write: 0,
                },
              },
            },
            parts: [{ id: "part-text-1", type: "text", text: "Pressure tracked." }],
          },
        }))

        return {
          clientTurnID: input.clientTurnID,
        }
      },
    )

    render(<App />)

    await waitFor(() => {
      expect(window.desktop!.listFolderWorkspaces).toHaveBeenCalledTimes(1)
      expect(window.desktop!.getProjectModels).toHaveBeenCalledWith({
        projectID: "project-atlas",
      })
    })

    setComposerDraftValue(screen.getByRole("textbox", { name: "Task draft" }), "Measure current context pressure")

    await act(async () => {
      fireEvent.click(getComposerSendButton())
      await Promise.resolve()
    })

    const contextButton = await screen.findByRole("button", {
        name: "Context pressure 50% (64k / 128k input tokens)",
    })
    expect(contextButton).toHaveAttribute("aria-expanded", "false")
    expect(contextButton.closest(".composer")).not.toBeNull()
    expect(contextButton.closest(".composer-utility-bar")).toBeNull()

    fireEvent.click(contextButton)

    const contextDialog = screen.getByRole("dialog", { name: "Context details" })
    expect(contextButton).toHaveAttribute("aria-expanded", "true")
    expect(within(contextDialog).getByText("50%")).toBeInTheDocument()
    expect(within(contextDialog).getByText("Low")).toBeInTheDocument()
    expect(within(contextDialog).getByText("Input")).toBeInTheDocument()
    expect(within(contextDialog).getByText("Window")).toBeInTheDocument()
    expect(within(contextDialog).getByText("Remaining")).toBeInTheDocument()
    expect(within(contextDialog).getByText("Output")).toBeInTheDocument()
    expect(within(contextDialog).getByText("3,200 tokens")).toBeInTheDocument()
    expect(within(contextDialog).getByText("800 tokens")).toBeInTheDocument()
    expect(within(contextDialog).getByText("1,600 read / 0 write")).toBeInTheDocument()
  })

  it("appends live terminal output directly into the active terminal view", async () => {
    let ptyListener:
      | ((event: {
          ptyID: string
          type: string
          [key: string]: unknown
        }) => void)
      | undefined

    window.desktop!.onPtyEvent = vi.fn((listener) => {
      ptyListener = listener
      return vi.fn()
    })

    render(<App />)

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    fireEvent.click(within(inspector).getByRole("button", { name: /^Terminal/ }))
    fireEvent.click(await within(inspector).findByRole("button", { name: "Create terminal" }))

    await waitFor(() => {
      expect(window.desktop!.attachPtySession).toHaveBeenCalledWith({
        id: "pty-1",
        cursor: 0,
      })
    })

    act(() => {
      ptyListener?.({
        ptyID: "pty-1",
        type: "ready",
        session: {
          id: "pty-1",
          sessionID: "session-chat-1",
          title: "Terminal 1",
          cwd: "C:\\Projects\\anybox",
          shell: "powershell.exe",
          rows: 24,
          cols: 80,
          status: "running",
          exitCode: null,
          createdAt: 1,
          updatedAt: 1,
          cursor: 8,
        },
        replay: {
          mode: "reset",
          buffer: "prompt> ",
          cursor: 8,
          startCursor: 0,
        },
      })
    })

    expect(await screen.findByText(/prompt>/)).toBeInTheDocument()

    act(() => {
      ptyListener?.({
        ptyID: "pty-1",
        type: "output",
        id: "out-1",
        data: "dir",
        cursor: 11,
      })
    })

    expect(await screen.findByText(/prompt>\s*dir/)).toBeInTheDocument()
  })

  it("keeps terminal output in the session-bound terminal control", async () => {
    let ptyListener:
      | ((event: {
          ptyID: string
          type: string
          [key: string]: unknown
        }) => void)
      | undefined

    window.desktop!.onPtyEvent = vi.fn((listener) => {
      ptyListener = listener
      return vi.fn()
    })
    window.desktop!.createPtySession = vi
      .fn()
      .mockResolvedValueOnce({
        id: "pty-1",
        sessionID: "session-chat-1",
        title: "Terminal 1",
        cwd: "C:\\Projects\\anybox",
        shell: "powershell.exe",
        rows: 24,
        cols: 80,
        status: "running",
        exitCode: null,
        createdAt: 1,
        updatedAt: 1,
        cursor: 0,
      })
      .mockResolvedValueOnce({
        id: "pty-2",
        sessionID: "session-chat-1",
        title: "Terminal 2",
        cwd: "C:\\Projects\\anybox",
        shell: "powershell.exe",
        rows: 24,
        cols: 80,
        status: "running",
        exitCode: null,
        createdAt: 2,
        updatedAt: 2,
        cursor: 0,
      })
    window.desktop!.attachPtySession = vi.fn().mockImplementation(async ({ id }: { id: string }) => ({
      id,
      sessionID: "session-chat-1",
      title: id === "pty-1" ? "Terminal 1" : "Terminal 2",
      cwd: "C:\\Projects\\anybox",
      shell: "powershell.exe",
      rows: 24,
      cols: 80,
      status: "running",
      exitCode: null,
      createdAt: 1,
      updatedAt: 1,
      cursor: 0,
    }))

    render(<App />)

    const inspector = screen.getByRole("complementary", { name: "Inspector sidebar" })
    fireEvent.click(within(inspector).getByRole("button", { name: /^Terminal/ }))
    fireEvent.click(await within(inspector).findByRole("button", { name: "Create terminal" }))

    await waitFor(() => {
      expect(window.desktop!.createPtySession).toHaveBeenCalledTimes(1)
    })
    await screen.findByRole("button", { name: /^Terminal 1,/i })

    act(() => {
      ptyListener?.({
        ptyID: "pty-1",
        type: "ready",
        session: {
          id: "pty-1",
          sessionID: "session-chat-1",
          title: "Terminal 1",
          cwd: "C:\\Projects\\anybox",
          shell: "powershell.exe",
          rows: 24,
          cols: 80,
          status: "running",
          exitCode: null,
          createdAt: 1,
          updatedAt: 1,
          cursor: 12,
        },
        replay: {
          mode: "reset",
          buffer: "first output",
          cursor: 12,
          startCursor: 0,
        },
      })
    })

    expect(await screen.findByText("first output")).toBeInTheDocument()

    expect(screen.queryByRole("button", { name: "New terminal" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^Terminal 1,/i }))
    expect(window.desktop!.createPtySession).toHaveBeenCalledTimes(1)
    expect(await screen.findByText("first output")).toBeInTheDocument()
  })

  it("collapses the sidebar from the rail toggle and restores it on second click", () => {
    const { container } = render(<App />)
    const appShell = container.querySelector(".app-shell") as HTMLElement | null

    expect(appShell).not.toBeNull()
    expect(screen.getByRole("button", { name: "Open folder" })).toBeInTheDocument()
    expect(screen.getByTestId("sidebar-resizer")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Collapse left sidebar" }).closest(".activity-rail")).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Collapse left sidebar" }))

    expect(appShell!.getAttribute("style")).toContain("--sidebar-display-width: 0px")
    expect(screen.queryByRole("button", { name: "Open folder" })).not.toBeInTheDocument()
    expect(screen.queryByTestId("sidebar-resizer")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Expand left sidebar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Expand left sidebar" }).closest(".activity-rail")).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Expand left sidebar" }))

    expect(appShell!.getAttribute("style")).toContain(`--sidebar-display-width: ${DEFAULT_SIDEBAR_WIDTH}px`)
    expect(screen.getByRole("button", { name: "Open folder" })).toBeInTheDocument()
    expect(screen.getByTestId("sidebar-resizer")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Collapse left sidebar" }).closest(".activity-rail")).not.toBeNull()
  })

  it("collapses and restores the right sidebar from the canvas menu", () => {
    const { container } = render(<App />)
    const appShell = container.querySelector(".app-shell") as HTMLElement | null
    const rightSidebarTopMenu = screen.getByLabelText("Right sidebar top menu")

    expect(appShell).not.toBeNull()
    expect(appShell!.getAttribute("style")).toContain("--window-controls-right-sidebar-clearance: 0px")
    expect(appShell!.getAttribute("style")).toContain("--window-controls-canvas-clearance: 0px")
    expect(screen.getByRole("complementary", { name: "Inspector sidebar" })).toBeInTheDocument()
    expect(screen.getByTestId("right-sidebar-resizer")).toBeInTheDocument()
    expect(within(rightSidebarTopMenu).getByRole("button", { name: "Minimize window" })).toBeInTheDocument()
    expect(within(rightSidebarTopMenu).queryByRole("button", { name: "Collapse right sidebar" })).toBeNull()
    expect(screen.getByRole("button", { name: "Collapse right sidebar" }).closest(".dv-tabs-and-actions-container")).not.toBeNull()
    expect(screen.getByRole("button", { name: "Collapse right sidebar" }).closest(".dockview-workbench-header-trailing")).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Collapse right sidebar" }))

    expect(appShell!.getAttribute("style")).toContain("--right-sidebar-display-width: 0px")
    expect(appShell!.getAttribute("style")).toContain("--window-controls-right-sidebar-clearance: 0px")
    expect(appShell!.getAttribute("style")).toContain("--window-controls-canvas-clearance: 0px")
    expect(screen.queryByRole("complementary", { name: "Inspector sidebar" })).not.toBeInTheDocument()
    expect(screen.queryByTestId("right-sidebar-resizer")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Minimize window" }).closest(".dv-tabs-and-actions-container")).not.toBeNull()
    expect(screen.getByRole("button", { name: "Minimize window" }).closest(".dockview-workbench-header-trailing")).not.toBeNull()
    expect(screen.getByRole("button", { name: "Expand right sidebar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Expand right sidebar" }).closest(".dv-tabs-and-actions-container")).not.toBeNull()
    expect(screen.getByRole("button", { name: "Expand right sidebar" }).closest(".dockview-workbench-header-trailing")).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Expand right sidebar" }))

    expect(appShell!.getAttribute("style")).toContain(`--right-sidebar-display-width: ${DEFAULT_RIGHT_SIDEBAR_WIDTH}px`)
    expect(appShell!.getAttribute("style")).toContain("--window-controls-right-sidebar-clearance: 0px")
    expect(appShell!.getAttribute("style")).toContain("--window-controls-canvas-clearance: 0px")
    expect(screen.getByRole("complementary", { name: "Inspector sidebar" })).toBeInTheDocument()
    expect(screen.getByTestId("right-sidebar-resizer")).toBeInTheDocument()
    const restoredRightSidebarTopMenu = screen.getByLabelText("Right sidebar top menu")
    expect(within(restoredRightSidebarTopMenu).getByRole("button", { name: "Minimize window" })).toBeInTheDocument()
    expect(within(restoredRightSidebarTopMenu).queryByRole("button", { name: "Collapse right sidebar" })).toBeNull()
    expect(screen.getByRole("button", { name: "Collapse right sidebar" }).closest(".dv-tabs-and-actions-container")).not.toBeNull()
    expect(screen.getByRole("button", { name: "Collapse right sidebar" }).closest(".dockview-workbench-header-trailing")).not.toBeNull()
  })

  it("resizes the left sidebar when dragging the divider", async () => {
    const { container } = render(<App />)
    const appShell = container.querySelector(".app-shell") as HTMLElement | null

    expect(appShell).not.toBeNull()
    Object.defineProperty(appShell!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1200,
        bottom: 800,
        width: 1200,
        height: 800,
        toJSON: () => ({}),
      }),
    })

    fireEvent.click(screen.getByRole("button", { name: "Collapse right sidebar" }))

    expect(appShell!.getAttribute("style")).toContain(`--sidebar-width: ${DEFAULT_SIDEBAR_WIDTH}px`)

    fireEvent.pointerDown(screen.getByTestId("sidebar-resizer"), {
      button: 0,
      clientX: 290,
    })

    await waitFor(() => {
      expect(document.body).toHaveClass("is-resizing-sidebar")
    })

    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 374,
      pointerType: "mouse",
    })
    await waitFor(() => {
      expect(appShell!.getAttribute("style")).toContain("--sidebar-width: 320px")
    })

    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 640,
      pointerType: "mouse",
    })
    await waitFor(() => {
      expect(appShell!.getAttribute("style")).toContain(`--sidebar-width: ${MAX_SIDEBAR_WIDTH}px`)
    })

    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 120,
      pointerType: "mouse",
    })
    await waitFor(() => {
      expect(appShell!.getAttribute("style")).toContain(`--sidebar-width: ${MIN_SIDEBAR_WIDTH}px`)
    })

    fireEvent.pointerUp(window)

    await waitFor(() => {
      expect(document.body).not.toHaveClass("is-resizing-sidebar")
    })
  })

  it("resizes the right sidebar when dragging the divider", async () => {
    const { container } = render(<App />)
    const appShell = container.querySelector(".app-shell") as HTMLElement | null
    const expectedRightSidebarMaxWidth = Math.min(
      MAX_RIGHT_SIDEBAR_WIDTH,
      Math.round(1200 * (1 - RIGHT_SIDEBAR_MIN_LEFT_EDGE_RATIO)),
    )

    expect(appShell).not.toBeNull()
    Object.defineProperty(appShell!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1200,
        bottom: 800,
        width: 1200,
        height: 800,
        toJSON: () => ({}),
      }),
    })

    fireEvent.click(screen.getByRole("button", { name: "Collapse left sidebar" }))

    expect(appShell!.getAttribute("style")).toContain(`--right-sidebar-width: ${DEFAULT_RIGHT_SIDEBAR_WIDTH}px`)

    fireEvent.pointerDown(screen.getByTestId("right-sidebar-resizer"), {
      button: 0,
      clientX: 720,
    })

    await waitFor(() => {
      expect(document.body).toHaveClass("is-resizing-sidebar")
    })

    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 760,
      pointerType: "mouse",
    })
    await waitFor(() => {
      expect(appShell!.getAttribute("style")).toContain("--right-sidebar-width: 440px")
    })

    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 400,
      pointerType: "mouse",
    })
    await waitFor(() => {
      expect(appShell!.getAttribute("style")).toContain(`--right-sidebar-width: ${expectedRightSidebarMaxWidth}px`)
    })

    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 1100,
      pointerType: "mouse",
    })
    await waitFor(() => {
      expect(appShell!.getAttribute("style")).toContain(`--right-sidebar-width: ${MIN_RIGHT_SIDEBAR_WIDTH}px`)
    })

    fireEvent.pointerUp(window)

    await waitFor(() => {
      expect(document.body).not.toHaveClass("is-resizing-sidebar")
    })
  })

  it("stops resizing the right sidebar when the mouse button is no longer pressed", async () => {
    const { container } = render(<App />)
    const appShell = container.querySelector(".app-shell") as HTMLElement | null

    expect(appShell).not.toBeNull()
    Object.defineProperty(appShell!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1200,
        bottom: 800,
        width: 1200,
        height: 800,
        toJSON: () => ({}),
      }),
    })

    expect(appShell!.getAttribute("style")).toContain(`--right-sidebar-width: ${DEFAULT_RIGHT_SIDEBAR_WIDTH}px`)

    fireEvent.pointerDown(screen.getByTestId("right-sidebar-resizer"), {
      button: 0,
      clientX: 720,
      pointerType: "mouse",
    })

    await waitFor(() => {
      expect(document.body).toHaveClass("is-resizing-sidebar")
    })

    fireEvent.pointerMove(window, {
      buttons: 0,
      clientX: 760,
      pointerType: "mouse",
    })

    await waitFor(() => {
      expect(document.body).not.toHaveClass("is-resizing-sidebar")
    })
    expect(appShell!.getAttribute("style")).toContain(`--right-sidebar-width: ${DEFAULT_RIGHT_SIDEBAR_WIDTH}px`)

    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 760,
      pointerType: "mouse",
    })
    expect(appShell!.getAttribute("style")).toContain(`--right-sidebar-width: ${DEFAULT_RIGHT_SIDEBAR_WIDTH}px`)
  })

  it("limits the right sidebar to two thirds of the app width even when the left sidebar is expanded", async () => {
    const { container } = render(<App />)
    const appShell = container.querySelector(".app-shell") as HTMLElement | null
    const expectedRightSidebarMaxWidth = Math.min(
      MAX_RIGHT_SIDEBAR_WIDTH,
      Math.round(1200 * (1 - RIGHT_SIDEBAR_MIN_LEFT_EDGE_RATIO)),
    )

    expect(appShell).not.toBeNull()
    Object.defineProperty(appShell!, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 1200,
        bottom: 800,
        width: 1200,
        height: 800,
        toJSON: () => ({}),
      }),
    })

    expect(appShell!.getAttribute("style")).toContain(`--right-sidebar-width: ${DEFAULT_RIGHT_SIDEBAR_WIDTH}px`)

    fireEvent.pointerDown(screen.getByTestId("right-sidebar-resizer"), {
      button: 0,
      clientX: 720,
    })

    await waitFor(() => {
      expect(document.body).toHaveClass("is-resizing-sidebar")
    })

    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 300,
      pointerType: "mouse",
    })
    await waitFor(() => {
      expect(appShell!.getAttribute("style")).toContain(`--right-sidebar-width: ${expectedRightSidebarMaxWidth}px`)
    })

    fireEvent.pointerUp(window)

    await waitFor(() => {
      expect(document.body).not.toHaveClass("is-resizing-sidebar")
    })
  })

  it("delegates neighboring workbench pane resizing to Dockview", async () => {
    render(<App />)

    const panes = await createSiblingPaneFromCreateTab()
    expect(panes).toHaveLength(2)

    const api = await getWorkbenchDockviewApi()
    expect(document.querySelector(".dv-sash")).not.toBeNull()
    expect(screen.queryByTestId("workbench-pane-resizer-0")).toBeNull()
    expect(api.toJSON().grid.root.type).toBe("branch")
  })

  it("shows expand/collapse icon only while hovering a folder row", () => {
    render(<App />)

    const appFolder = screen.getByRole("button", { name: "app" })
    const appFolderLeading = appFolder.querySelector(".project-row-leading")
    const srcFolder = screen.getByRole("button", { name: "src" })
    const srcFolderLeading = srcFolder.querySelector(".project-row-leading")

    expect(appFolderLeading).toHaveAttribute("data-icon", "folder")
    expect(srcFolderLeading).toHaveAttribute("data-icon", "folder")

    fireEvent.mouseEnter(appFolder)
    expect(appFolderLeading).toHaveAttribute("data-icon", "expanded")

    fireEvent.mouseLeave(appFolder)
    expect(appFolderLeading).toHaveAttribute("data-icon", "folder")

    fireEvent.mouseEnter(srcFolder)
    expect(srcFolderLeading).toHaveAttribute("data-icon", "collapsed")

    fireEvent.mouseLeave(srcFolder)
    expect(srcFolderLeading).toHaveAttribute("data-icon", "folder")
  })

  it("routes every left-sidebar tree row state through dedicated semantic tokens", () => {
    expect(styles).toMatch(/\.session-tree\s*\{[^}]*padding-left:\s*0;/s)
    expect(styles).toMatch(/\.project-row\s*\{[^}]*border-radius:\s*8px;/s)
    expect(styles).toMatch(/\.session-row\s*\{[^}]*border-radius:\s*8px;/s)
    expect(styles).toMatch(
      /\.project-row,\s*\.session-row,\s*\.skill-tree-row\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-sidebar-tree-row-text\);/s,
    )
    expect(styles).toMatch(
      /\.project-row:hover,\s*\.project-row:focus-visible,\s*\.session-row:hover,\s*\.session-row:focus-visible,\s*\.skill-tree-row:hover,\s*\.skill-tree-row:focus-visible\s*\{[^}]*background:\s*var\(--semantic-sidebar-tree-row-surface-hover\);[^}]*color:\s*var\(--semantic-sidebar-tree-row-text-hover\);/s,
    )
    expect(styles).toMatch(
      /\.project-row\.is-active,\s*\.session-row\.is-active,\s*\.skill-tree-row\.is-active\s*\{[^}]*background:\s*var\(--semantic-sidebar-tree-row-surface-active\);[^}]*color:\s*var\(--semantic-sidebar-tree-row-text-active\);/s,
    )
    expect(styles).toMatch(
      /\.project-row\.is-active \.project-row-leading,\s*\.skill-tree-row\.is-active \.skill-tree-leading,\s*\.skill-tree-row\.is-active \.skill-tree-role-icon\s*\{[^}]*color:\s*var\(--semantic-sidebar-tree-row-leading-active\);/s,
    )
    expect(styles).toMatch(
      /\.mcp-server-sidebar-row:hover,\s*\.mcp-server-sidebar-row:focus-visible\s*\{[^}]*background:\s*var\(--semantic-sidebar-tree-row-surface-hover\);[^}]*color:\s*var\(--semantic-sidebar-tree-row-text-hover\);/s,
    )
    expect(styles).toMatch(
      /\.mcp-server-sidebar-row\.is-active\s*\{[^}]*background:\s*var\(--semantic-sidebar-tree-row-surface-active\);[^}]*color:\s*var\(--semantic-sidebar-tree-row-text-active\);/s,
    )
    expect(styles).toMatch(
      /\.sidebar-view-tools \.tools-category-item\.is-active\s*\{[^}]*background:\s*var\(--semantic-sidebar-tree-row-surface-active\);[^}]*color:\s*var\(--semantic-sidebar-tree-row-text-active\);/s,
    )
    expect(styles).not.toMatch(/\.session-row:not\(\.is-active\) \.session-row-label\s*\{[^}]*color:/s)
    expect(styles).not.toMatch(/\.project-row:focus-within/)
  })

  it("keeps left-sidebar row tokens out of unrelated component styles", () => {
    const stylesRoot = resolve(process.cwd(), "src/renderer/src/styles")
    const unrelatedStyles = [
      "automations.css",
      "calendar.css",
      "composer.css",
      "right-sidebar.css",
      "terminal.css",
      "thread.css",
      "workbench.css",
    ]
      .map((fileName) => readFileSync(resolve(stylesRoot, fileName), "utf8"))
      .join("\n")
    const settingsStyles = readFileSync(resolve(stylesRoot, "settings.css"), "utf8")
    const settingsRulesUsingSidebarTokens =
      settingsStyles.match(/[^{}]+\{[^{}]*var\(--semantic-sidebar-tree-row-[^{}]*\}/g) ?? []

    expect(unrelatedStyles).not.toContain("--semantic-sidebar-tree-row-")
    expect(settingsRulesUsingSidebarTokens.length).toBeGreaterThan(0)
    for (const rule of settingsRulesUsingSidebarTokens) {
      expect(rule).toContain(".mcp-server-sidebar-row")
    }
  })

  it("keeps the prompt input shell and canvas tab caps on the documented radii", () => {
    expect(styles).toMatch(/\.prompt-input-shell\s*\{[^}]*border-radius:\s*28px;/s)
    expect(styles).toMatch(
      /\.ui-context-menu\s*\{[^}]*--context-menu-radius:\s*var\(--semantic-dropdown-menu-radius,\s*var\(--seg-radius-md,/s,
    )
    expect(styles).toMatch(
      /\.ui-context-menu__item\s*\{[^}]*border-radius:\s*max\(4px,\s*calc\(var\(--context-menu-radius\) - 2px\)\);/s,
    )
    expect(styles).toMatch(
      /\.canvas-region-top-menu\s*\{[^}]*--canvas-region-tab-cap-radius:\s*8px;/s,
    )
    expect(styles).toMatch(
      /\.canvas-top-menu-selector-panel\s*\{[^}]*border-radius:\s*var\(--semantic-dropdown-menu-radius,\s*var\(--seg-radius-md\)\);/s,
    )
    expect(styles).not.toMatch(/\.canvas-top-menu-selector-panel\s*\{[^}]*scrollbar-gutter:\s*stable/s)
    expect(styles).toMatch(
      /\.canvas-top-menu-selector-panel\s+\.composer-menu-option:not\(:hover\):not\(:focus-visible\):not\(\.is-selected\)\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(/\.canvas-top-menu-context-panel\s*\{[^}]*--context-menu-hover:\s*var\(--surface-panel-muted\);/s)
    expect(styles).toMatch(
      /\.canvas-top-menu-context-option:hover,\s*\.canvas-top-menu-context-option:focus-visible,\s*\.canvas-top-menu-context-option\.is-selected,\s*\.canvas-top-menu-context-option\[aria-selected="true"\],\s*\.canvas-top-menu-context-option\[aria-checked="true"\]\s*\{[^}]*background:\s*var\(--context-menu-hover\);[^}]*color:\s*var\(--context-menu-hover-text\);/s,
    )
    const tracePanelRule = styles.match(/\.canvas-top-menu-trace-panel\s*\{[^}]*\}/s)?.[0] ?? ""
    expect(tracePanelRule).toContain("--context-menu-text: var(--semantic-dropdown-option-text);")
    expect(tracePanelRule).toContain("--context-menu-muted: var(--semantic-dropdown-option-meta-text);")
    expect(tracePanelRule).toContain("--context-menu-hover: var(--semantic-dropdown-option-surface-hover);")
    expect(tracePanelRule).toContain("--context-menu-hover-text: var(--semantic-dropdown-option-text-hover);")
    expect(tracePanelRule).not.toMatch(/var\(--(?:surface-panel-muted|text-primary|text-secondary)\)/)
    expect(styles).toMatch(/\.canvas-top-menu-searchable-panel\s+\.composer-menu-search-input\s*\{[^}]*border-radius:\s*max\(4px,\s*calc\(var\(--context-menu-radius\) - 2px\)\);/s)
    expect(styles).toMatch(/\.canvas-top-menu-searchable-panel\s+\.composer-menu-options\s*\{[^}]*overflow-y:\s*auto;[^}]*scrollbar-width:\s*none;/s)
    expect(styles).toMatch(/\.canvas-top-menu-searchable-panel\s+\.composer-menu-options::-webkit-scrollbar\s*\{[^}]*width:\s*0;/s)
    expect(styles).not.toMatch(/\.canvas-top-menu-searchable-panel\s+\.composer-menu-options\s*\{[^}]*scrollbar-gutter/s)
    expect(styles).toMatch(/\.canvas-top-menu-fit-panel\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*0;/s)
    expect(styles).toMatch(/\.canvas-top-menu-fit-panel\s+\.canvas-top-menu-context-option\s*\{[^}]*width:\s*100%;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s)
    expect(styles).toMatch(
      /\.canvas-top-menu-fit-panel\s+\.canvas-top-menu-trace-option\s*\{[^}]*grid-template-columns:\s*16px minmax\(0,\s*1fr\) auto;/s,
    )
    expect(styles).toMatch(/\.external-editor-menu-panel\s*\{[^}]*width:\s*max-content;/s)
    expect(styles).toMatch(/\.external-editor-menu-panel\s*\{[^}]*min-width:\s*0;/s)
    expect(styles).toMatch(/\.external-editor-menu-option\s*\{[^}]*border-radius:\s*var\(--seg-radius-sm\);/s)
    expect(styles).toMatch(
      /\.canvas-region-top-menu\s+\.session-tab\s*\{[^}]*border-radius:\s*var\(--canvas-region-tab-cap-radius\) var\(--canvas-region-tab-cap-radius\) 0 0;/s,
    )
  })

  it("routes top-menu selection pickers through dropdown and field semantic tokens", () => {
    expect(styles).toMatch(
      /\.canvas-top-menu-selection-panel\s*\{[^}]*background:\s*var\(--semantic-dropdown-menu-surface\);[^}]*color:\s*var\(--semantic-dropdown-option-text\);/s,
    )
    expect(styles).toMatch(
      /\.canvas-top-menu-selection-panel\s+\.canvas-top-menu-context-option\s*\{[^}]*color:\s*var\(--semantic-dropdown-option-text\);/s,
    )
    expect(styles).toMatch(
      /\.canvas-top-menu-selection-panel\s+\.canvas-top-menu-context-option:hover,\s*\.canvas-top-menu-selection-panel\s+\.canvas-top-menu-context-option:focus-visible\s*\{[^}]*background:\s*var\(--semantic-dropdown-option-surface-hover\);[^}]*color:\s*var\(--semantic-dropdown-option-text-hover\);[^}]*box-shadow:\s*none;/s,
    )
    expect(styles).toMatch(
      /\.canvas-top-menu-selection-panel\s+\.canvas-top-menu-context-option\.is-selected,\s*\.canvas-top-menu-selection-panel\s+\.canvas-top-menu-context-option\[aria-selected="true"\],\s*\.canvas-top-menu-selection-panel\s+\.canvas-top-menu-context-option\[aria-checked="true"\]\s*\{[^}]*background:\s*var\(--semantic-dropdown-option-surface-selected\);[^}]*color:\s*var\(--semantic-dropdown-option-text-selected\);/s,
    )
    expect(styles).toMatch(
      /\.canvas-top-menu-selection-panel\s+\.canvas-top-menu-context-option-status\s*\{[^}]*color:\s*var\(--semantic-dropdown-option-meta-text\);/s,
    )
    expect(styles).toMatch(
      /\.canvas-top-menu-selection-panel[\s\S]*?\.canvas-top-menu-context-option-status\s*\{[^}]*color:\s*var\(--semantic-dropdown-option-meta-text-selected\);/s,
    )
    expect(styles).toMatch(
      /\.canvas-top-menu-searchable-panel\s+\.composer-menu-search-input\s*\{[^}]*border-color:\s*var\(--semantic-field-border\);[^}]*background:\s*var\(--semantic-field-surface\);[^}]*color:\s*var\(--semantic-field-text\);/s,
    )
    expect(styles).toMatch(
      /\.canvas-top-menu-searchable-panel\s+\.composer-menu-search-input:focus\s*\{[^}]*border-color:\s*var\(--semantic-field-border-focus\);[^}]*background:\s*var\(--semantic-field-surface-focus\);[^}]*box-shadow:\s*none;/s,
    )

    const selectionRules = Array.from(
      styles.matchAll(/[^{}]*\.canvas-top-menu-selection-panel[^{}]*\{[^{}]*\}/g),
      (match) => match[0],
    ).join("\n")
    expect(selectionRules).not.toMatch(
      /var\(--context-menu-(?:hover|hover-text|text|muted|focus)\)/,
    )
  })

  it("routes top-menu selection triggers through secondary button semantic tokens", () => {
    const selectionTriggerRules = Array.from(
      styles.matchAll(/[^{}]*\.canvas-top-menu-selection-trigger[^{}]*\{[^{}]*\}/g),
      (match) => match[0],
    ).join("\n")

    expect(selectionTriggerRules).toMatch(
      /\.canvas-top-menu-button\.canvas-top-menu-selection-trigger\s*\{[^}]*border-color:\s*var\(--semantic-button-secondary-border\);[^}]*background:\s*var\(--semantic-button-secondary-surface\);[^}]*color:\s*var\(--semantic-button-secondary-text\);/s,
    )
    expect(selectionTriggerRules).toMatch(
      /\.canvas-top-menu-button\.canvas-top-menu-selection-trigger:not\(:disabled\):hover,[\s\S]*?\.canvas-top-menu-button\.canvas-top-menu-selection-trigger:not\(:disabled\)\[aria-expanded="true"\]\s*\{[^}]*border-color:\s*var\(--semantic-button-secondary-border-hover\);[^}]*background:\s*var\(--semantic-button-secondary-surface-hover\);[^}]*color:\s*var\(--semantic-button-secondary-text-hover\);/s,
    )
    expect(selectionTriggerRules).toMatch(
      /\.canvas-top-menu-button\.canvas-top-menu-selection-trigger:focus-visible\s*\{[^}]*outline:\s*none;[^}]*outline-offset:\s*0;/s,
    )
    expect(selectionTriggerRules).toMatch(
      /\.canvas-top-menu-button\.canvas-top-menu-selection-trigger:disabled\s*\{[^}]*border-color:\s*var\(--semantic-button-secondary-disabled-border\);[^}]*background:\s*var\(--semantic-button-secondary-disabled-surface\);[^}]*color:\s*var\(--semantic-button-secondary-disabled-text\);[^}]*opacity:\s*1;/s,
    )
    expect(selectionTriggerRules).not.toMatch(
      /var\(--(?:seg-composer-button|semantic-composer-button|semantic-icon-button|seg-text|border-subtle|focus-outline)/,
    )
  })

  it("wires switch controls through the shared semantic switch group", () => {
    const stylesRoot = resolve(process.cwd(), "src/renderer/src/styles")
    const switchConsumerStyles = ["settings.css", "tools.css", "workbench.css"]
      .map((fileName) => readFileSync(resolve(stylesRoot, fileName), "utf8"))
      .join("\n")
    const toolsStyles = readFileSync(resolve(stylesRoot, "tools.css"), "utf8")
    const toolSwitchRules = Array.from(
      toolsStyles.matchAll(
        /[^{}]*(?:\.tools-card-toggle-button|\.tools-toggle-control|\.tools-toggle-thumb)[^{}]*\{[^{}]*\}/g,
      ),
      (match) => match[0],
    ).join("\n")

    for (const tokenName of [
      "semantic-switch-track-surface",
      "semantic-switch-track-border",
      "semantic-switch-track-border-focus",
      "semantic-switch-track-surface-active",
      "semantic-switch-track-border-active",
      "semantic-switch-track-surface-disabled",
      "semantic-switch-track-border-disabled",
      "semantic-switch-thumb-surface",
      "semantic-switch-thumb-surface-disabled",
    ]) {
      expect(toolSwitchRules).toContain(`var(--${tokenName})`)
    }

    expect(switchConsumerStyles).not.toContain("--semantic-settings-switch-")
    expect(toolSwitchRules).not.toMatch(
      /var\(--(?:seg-|tools-obs-accent|semantic-button|semantic-icon-button)/,
    )
    expect(toolsStyles).not.toMatch(
      /:root\[data-theme="dark"\][^{]*\.tools-toggle-control\s*\{/,
    )
  })

  it("wires segmented controls through dedicated semantic tokens", () => {
    expect(styles).toMatch(
      /--semantic-segmented-control-surface-light:\s*var\(--surface-panel-muted-light\);/s,
    )
    expect(styles).toMatch(
      /--semantic-segmented-control-item-surface-active-dark:\s*color-mix\(in srgb,\s*var\(--brand-primary-soft-dark\) 84%,\s*rgba\(0,\s*0,\s*0,\s*0\) 16%\);/s,
    )
    expect(styles).toMatch(
      /--semantic-segmented-control-item-text-active:\s*var\(--semantic-segmented-control-item-text-active-light\);/s,
    )
    expect(styles).toMatch(
      /:root\[data-theme="dark"\]\s*\{[\s\S]*--semantic-segmented-control-item-text-active:\s*var\(--semantic-segmented-control-item-text-active-dark\);/s,
    )
    expect(styles).toMatch(
      /\.top-menu-segment:hover,\s*\.top-menu-segment:focus-visible\s*\{[^}]*background:\s*var\(--semantic-segmented-control-item-surface-hover\);[^}]*color:\s*var\(--semantic-segmented-control-item-text-hover\);/s,
    )
    expect(styles).toMatch(
      /\.top-menu-segment\.is-active,\s*\.top-menu-segment\[aria-selected="true"\],\s*\.top-menu-segment\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--semantic-segmented-control-item-surface-active\);[^}]*color:\s*var\(--semantic-segmented-control-item-text-active\);/s,
    )
    expect(styles).toMatch(
      /\.top-menu-segment small\s*\{[^}]*color:\s*var\(--semantic-segmented-control-item-meta-text\);/s,
    )
    expect(styles).toMatch(
      /\.top-menu-segment\.is-active small,[\s\S]*?\.top-menu-segment\[aria-pressed="true"\] small\s*\{[^}]*color:\s*var\(--semantic-segmented-control-item-meta-text-active\);/s,
    )
    expect(styles).toMatch(
      /\.global-skills-mode-toggle\s*\{[^}]*border:\s*1px solid var\(--semantic-segmented-control-border\);[^}]*background:\s*var\(--semantic-segmented-control-surface\);/s,
    )
    expect(styles).toMatch(
      /\.settings-prompt-editor-mode-switch\s*\{[^}]*min-height:\s*36px;[^}]*border:\s*1px solid var\(--semantic-segmented-control-border\);[^}]*background:\s*var\(--semantic-segmented-control-surface\);/s,
    )
    expect(styles).toMatch(
      /\.mcp-transport-segment\.is-active\s*\{[^}]*background:\s*var\(--semantic-segmented-control-item-surface-active\);[^}]*color:\s*var\(--semantic-segmented-control-item-text-active\);/s,
    )
    expect(styles).toMatch(
      /\.canvas-top-menu-segmented-option\.is-selected\s*\{[^}]*background:\s*var\(--semantic-segmented-control-item-surface-active\);[^}]*color:\s*var\(--semantic-segmented-control-item-text-active\);/s,
    )
  })

  it("keeps preview comment hover highlight connected to the active theme", () => {
    const hoverHighlightBlocks = Array.from(
      styles.matchAll(/\.preview-hover-highlight\s*\{([^}]*)\}/g),
      (match) => match[1],
    )
    expect(hoverHighlightBlocks.length).toBeGreaterThan(0)
    const finalHoverHighlightBlock = hoverHighlightBlocks[hoverHighlightBlocks.length - 1] ?? ""

    expect(finalHoverHighlightBlock).toContain("border-color: var(--focus-outline-color);")
    expect(finalHoverHighlightBlock).toContain("background: var(--brand-primary-soft-active);")
    expect(finalHoverHighlightBlock).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
  })

  it("keeps the canvas tabs separate from the session top menu", () => {
    expect(styles).toMatch(/--brand-primary:\s*#d46b63;/i)
    expect(styles).toMatch(/--brand-accent-highlight:\s*#fca5a5;/i)
    expect(styles).toMatch(/--semantic-accent-icon-light:\s*#78716c;/i)
    expect(styles).toMatch(/--semantic-accent-icon-hover-light:\s*#b9534c;/i)
    expect(styles).toMatch(/--semantic-accent-icon-active-light:\s*#fca5a5;/i)
    expect(styles).toMatch(/--semantic-error-light:\s*#9f1239;/i)
    expect(styles).toMatch(/--semantic-error:\s*var\(--semantic-error-light\);/s)
    expect(styles).toMatch(/--semantic-success-surface-light:\s*#f0f6e7;/i)
    expect(styles).toMatch(/--semantic-success-surface:\s*var\(--semantic-success-surface-light\);/s)
    expect(styles).toMatch(/--seg-danger-border:\s*var\(--semantic-error-border\);/s)
    expect(styles).toMatch(/--surface-app-dark:\s*#1c1917;/i)
    expect(styles).toMatch(/--brand-primary-dark:\s*#e17068;/i)
    expect(styles).toMatch(/:root\[data-brand-theme="sage"\]\s*\{[^}]*--brand-primary:\s*#0f766e;[^}]*--brand-accent-highlight:\s*#2dd4bf;[^}]*--semantic-accent-icon-light:\s*#475569;[^}]*--semantic-accent-icon-hover-light:\s*#115e59;[^}]*--semantic-accent-icon-active-light:\s*#2dd4bf;/is)
    expect(styles).toMatch(/\.canvas\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto auto;[^}]*gap:\s*14px;/s)
    expect(styles).toMatch(/\.canvas-top-stack\s*\{[^}]*display:\s*grid;[^}]*gap:\s*6px;/s)
    expect(styles).toMatch(/\.workbench-pane\s*\{[^}]*flex:\s*1 1 0;[^}]*position:\s*relative;[^}]*overflow:\s*hidden;/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.workbench-pane\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*min-height:\s*0;/s)
    expect(styles).toMatch(/\.canvas\.is-workbench\s*\{[^}]*background:\s*var\(--seg-shell\);/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dv-view,\s*\.dockview-theme-anybox\s+\.dv-groupview,\s*\.dockview-theme-anybox\s+\.dv-content-container\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*background:\s*transparent;/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dv-content-container,[\s\S]*?\.dockview-theme-anybox\s+\.workbench-pane-live-region\s*\{[^}]*-webkit-app-region:\s*no-drag;/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.workbench-pane\s+button,[\s\S]*?\.dockview-theme-anybox\s+\.workbench-pane\s+\[contenteditable="true"\]\s*\{[^}]*-webkit-app-region:\s*no-drag;/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.workbench-pane-live-region\.is-dockview-managed\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto auto;/s)
    expect(styles).toMatch(/\.dockview-workbench-panes\s*\{[^}]*--dv-drag-over-background-color:\s*var\(--brand-primary-soft-active\);[^}]*--dv-drag-over-border-color:\s*var\(--seg-accent\);[^}]*--dv-drag-over-border:\s*1px solid var\(--seg-accent\);/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s*\{[^}]*--dv-drag-over-background-color:\s*var\(--brand-primary-soft-active\);[^}]*--dv-drag-over-border-color:\s*var\(--seg-accent\);[^}]*--dv-drag-over-border:\s*1px solid var\(--seg-accent\);/s)
    expect(styles).toMatch(/\.dockview-workbench-panes\s+\.dv-drop-target-container\s*\{[^}]*--dv-transition-duration:\s*var\(--motion-base\);[^}]*-webkit-app-region:\s*no-drag;/s)
    expect(styles).toMatch(/\.dockview-workbench-panes\s+\.dv-drop-target > \.dv-drop-target-dropzone\s*\{[^}]*-webkit-app-region:\s*no-drag;/s)
    expect(styles).toMatch(/\.dockview-workbench-panes\s+\.dv-drop-target > \.dv-drop-target-dropzone > \.dv-drop-target-selection,\s*\.dockview-workbench-panes\s+\.dv-drop-target-container \.dv-drop-target-anchor\s*\{[^}]*background-color:\s*var\(--dv-drag-over-background-color\);[^}]*box-shadow:/s)
    expect(styles).toMatch(/@property --pane-drop-preview-sheen-x\s*\{[^}]*syntax:\s*"&lt;percentage&gt;"|@property --pane-drop-preview-sheen-x\s*\{[^}]*syntax:\s*"<percentage>";/s)
    expect(styles).toMatch(/@property --pane-drop-preview-sheen-y\s*\{[^}]*initial-value:\s*50%;/s)
    expect(styles).toMatch(/\.workbench-pane-stage\s*\{[^}]*--pane-drop-preview-motion-duration:\s*220ms;[^}]*--pane-drop-preview-fade-duration:\s*180ms;[^}]*--pane-drop-preview-motion-curve:\s*cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\);[^}]*--pane-drop-preview-sheen-x:\s*50%;[^}]*--pane-drop-preview-sheen-y:\s*50%;/s)
    expect(styles).toMatch(/\.workbench-pane-live-region\s*\{[^}]*position:\s*absolute;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto auto;/s)
    expect(styles).toMatch(/\.window-controls\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*flex-end;[^}]*gap:\s*4px;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*-webkit-app-region:\s*no-drag;/s)
    expect(styles).toMatch(/\.window-controls\.is-native-macos\s*\{[^}]*width:\s*88px;[^}]*min-width:\s*88px;[^}]*pointer-events:\s*none;/s)
    expect(styles).toMatch(/\.window-control,[\s\S]*?\{[^}]*color:\s*var\(--semantic-accent-icon\);/s)
    expect(styles).toMatch(/\.window-control svg\s*\{[^}]*width:\s*var\(--section-toolbar-icon-size\);[^}]*height:\s*var\(--section-toolbar-icon-size\);[^}]*stroke-width:\s*2;/s)
    expect(styles).toMatch(/\.window-control:hover,[\s\S]*?\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-accent-icon-hover\);[^}]*transform:\s*none;/s)
    expect(styles).toMatch(/\.window-control\.is-close:hover,[\s\S]*?\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-accent-icon-hover\);/s)
    expect(styles).toMatch(/\.panel-toolbar\s*\{[^}]*min-height:\s*var\(--section-toolbar-height\);[^}]*padding:\s*0;[^}]*-webkit-app-region:\s*no-drag;/s)
    expect(styles).toMatch(/\.panel-toolbar\.window-drag-region\s*\{[^}]*-webkit-app-region:\s*drag;/s)
    expect(styles).toMatch(/\.shell-top-menu\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;[^}]*align-items:\s*center;/s)
    expect(styles).not.toMatch(/\.shell-top-menu,\s*\.right-sidebar-section-header,\s*\.right-sidebar-list-row\s*\{[^}]*align-items:\s*flex-start;/s)
    expect(styles).toMatch(/\.shell-top-menu\.is-three-column\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto;/s)
    expect(styles).toMatch(/\.panel-toolbar-window-controls-spacer\s*\{[^}]*position:\s*absolute;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*-webkit-app-region:\s*no-drag;/s)
    expect(styles).toMatch(/\.panel-toolbar-window-controls-spacer\.is-canvas\s*\{[^}]*width:\s*var\(--window-controls-canvas-clearance\);/s)
    expect(styles).toMatch(/\.panel-toolbar-window-controls-spacer\.is-right-sidebar\s*\{[^}]*width:\s*var\(--window-controls-right-sidebar-clearance\);/s)
    expect(styles).toMatch(/--section-toolbar-baseline:\s*var\(--section-toolbar-height\);/s)
    expect(styles).toMatch(/--section-toolbar-icon-size:\s*18px;/s)
    expect(styles).toMatch(/--section-toolbar-aux-icon-size:\s*12px;/s)
    expect(styles).toMatch(/\.top-menu-view-button\s*\{[^}]*border-radius:\s*8px;[^}]*background:\s*transparent;/s)
    expect(styles).toMatch(/\.top-menu-view-button-icon\s*\{[^}]*width:\s*var\(--section-toolbar-icon-size\);[^}]*height:\s*var\(--section-toolbar-icon-size\);/s)
    expect(styles).toMatch(/\.sidebar-toggle-button\.is-rail svg\s*\{[^}]*width:\s*var\(--section-toolbar-icon-size\);[^}]*height:\s*var\(--section-toolbar-icon-size\);[^}]*stroke-width:\s*2;/s)
    expect(styles).toMatch(/\.sidebar-toggle-button\.is-top-menu svg\s*\{[^}]*width:\s*var\(--section-toolbar-icon-size\);[^}]*height:\s*var\(--section-toolbar-icon-size\);[^}]*stroke-width:\s*2;/s)
    expect(styles).toMatch(/\.session-tab-close svg\s*\{[^}]*width:\s*var\(--section-toolbar-aux-icon-size\);[^}]*height:\s*var\(--section-toolbar-aux-icon-size\);[^}]*stroke-width:\s*2;/s)
    expect(styles).toMatch(
      /\.dockview-theme-anybox\s+\.dv-tabs-and-actions-container\s*\{[^}]*--dockview-tab-bar-bg:\s*var\(--seg-shell-chrome-surface\);[^}]*--dockview-tab-active-bg:\s*var\(--semantic-shell-chrome-tab-surface-active\);[^}]*background:\s*var\(--dockview-tab-bar-bg\);[^}]*-webkit-app-region:\s*drag;/s,
    )
    expect(styles).toMatch(/--dockview-tab-hover-bg:\s*var\(--surface-panel-muted\);/s)
    expect(styles).toMatch(
      /\.dockview-theme-anybox\s+\.dv-tabs-and-actions-container::after\s*\{[^}]*bottom:\s*0;[^}]*height:\s*1px;[^}]*background:\s*var\(--dockview-tab-border\);/s,
    )
    expect(styles).toMatch(/\.sidebar-resizer\s*\{[^}]*--sidebar-resizer-top-surface:\s*var\(--seg-shell-chrome-surface\);[^}]*background-color:\s*transparent;[^}]*background-image:\s*linear-gradient\(var\(--sidebar-resizer-top-surface\),\s*var\(--sidebar-resizer-top-surface\)\);[^}]*background-position:\s*top;[^}]*background-size:\s*100%\s*var\(--section-toolbar-height\);[^}]*background-repeat:\s*no-repeat;/s)
    expect(styles).toMatch(/\.sidebar-resizer\s*\{[^}]*--sidebar-resizer-line-x:\s*100%;[^}]*justify-self:\s*stretch;[^}]*background-image:/s)
    const sidebarResizerBlocks = Array.from(styles.matchAll(/\.sidebar-resizer\s*\{([^}]*)\}/g), (match) => match[1])
    const topChromeSidebarResizerBlock = sidebarResizerBlocks.find((block) => block.includes("--sidebar-resizer-line-x: 100%")) ?? ""
    expect(topChromeSidebarResizerBlock).toContain("linear-gradient(var(--sidebar-resizer-line), var(--sidebar-resizer-line))")
    expect(topChromeSidebarResizerBlock).not.toContain("var(--seg-shell)")
    expect(styles).toMatch(/\.sidebar-resizer\.is-right\s*\{[^}]*--sidebar-resizer-line-x:\s*100%;[^}]*justify-self:\s*stretch;/s)
    expect(styles).toMatch(/\.sidebar-resizer::after\s*\{[^}]*top:\s*calc\(var\(--section-toolbar-height\)\s*-\s*1px\);[^}]*height:\s*1px;[^}]*background:\s*var\(--seg-border\);/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dv-tabs-container\s*\{[^}]*-webkit-app-region:\s*no-drag;/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dv-tabs-and-actions-container\s+\.dv-void-container\.dv-draggable\s*\{[^}]*-webkit-app-region:\s*drag;/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dockview-workbench-tab-content,[\s\S]*?\.dockview-theme-anybox\s+\.dockview-workbench-header-actions button\s*\{[^}]*-webkit-app-region:\s*no-drag;/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dockview-workbench-header-actions\s*\{[^}]*min-height:\s*40px;/s)
    expect(styles).toMatch(/\.right-sidebar-view-host\s*\{[^}]*overflow:\s*auto;[^}]*scrollbar-gutter:\s*stable;[^}]*padding-right:\s*2px;/s)
    expect(styles).toMatch(/\.pane-drop-targets\s*\{[^}]*grid-template-columns:\s*144px minmax\(0,\s*1fr\) 144px;[^}]*grid-template-rows:\s*10px minmax\(0,\s*1fr\) 108px;[^}]*grid-template-areas:\s*[\s\S]*"\.\s+top\s+\."[\s\S]*"left center right"[\s\S]*"\.\s+bottom\s+\.";/s)
    expect(styles).toMatch(/\.pane-drop-targets\.is-top-row\s*\{[^}]*grid-template-areas:\s*[\s\S]*"top top top"[\s\S]*"left center right"[\s\S]*"\.\s+bottom\s+\.";/s)
    expect(styles).toMatch(/\.pane-drop-target\s*\{[^}]*pointer-events:\s*auto;[^}]*background:\s*transparent;/s)
    expect(styles).toMatch(/\.pane-drop-preview\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*z-index:\s*6;[^}]*pointer-events:\s*none;/s)
    expect(styles).toMatch(/\.pane-drop-preview\.is-left\s*\{[^}]*--pane-drop-preview-sheen-x:\s*18%;[^}]*--pane-drop-preview-sheen-y:\s*50%;/s)
    expect(styles).toMatch(/\.pane-drop-preview\.is-top\s*\{[^}]*--pane-drop-preview-sheen-x:\s*50%;[^}]*--pane-drop-preview-sheen-y:\s*18%;/s)
    expect(styles).toMatch(/\.pane-drop-preview-current,\s*\.pane-drop-preview-incoming\s*\{[^}]*position:\s*absolute;[^}]*transition:[^}]*top var\(--pane-drop-preview-motion-duration\) var\(--pane-drop-preview-motion-curve\)[^}]*left var\(--pane-drop-preview-motion-duration\) var\(--pane-drop-preview-motion-curve\)[^}]*width var\(--pane-drop-preview-motion-duration\) var\(--pane-drop-preview-motion-curve\)[^}]*height var\(--pane-drop-preview-motion-duration\) var\(--pane-drop-preview-motion-curve\)/s)
    expect(styles).toMatch(/\.pane-drop-preview-incoming\s*\{[^}]*background:\s*var\(--brand-primary-soft-strong-active\);/s)
    expect(styles).toMatch(/\.pane-drop-preview-current\s*\{[^}]*background:\s*var\(--surface-panel-muted\);/s)
    expect(styles).toMatch(/\.canvas-top-menu-git-trigger svg\s*\{[^}]*width:\s*var\(--section-toolbar-aux-icon-size\);[^}]*height:\s*var\(--section-toolbar-aux-icon-size\);[^}]*stroke-width:\s*2;/s)
    expect(styles).toMatch(
      /\.top-menu-view-button:hover,\s*\.top-menu-view-button:focus-visible,[\s\S]*?\{[^}]*background:\s*var\(--semantic-icon-button-surface-hover\);[^}]*color:\s*var\(--semantic-icon-button-text-hover\);/s,
    )
    expect(styles).toMatch(
      /\.top-menu-view-button\.is-active,[\s\S]*?\.top-menu-view-button\.is-active:hover,\s*\.top-menu-view-button\.is-active:focus-visible\s*\{[^}]*background:\s*var\(--semantic-icon-button-surface-active\);[^}]*color:\s*var\(--semantic-icon-button-text-active\);/s,
    )
    expect(styles).toMatch(/\.sidebar-toggle-button\.is-rail\s*\{[^}]*border-radius:\s*8px;/s)
    expect(styles).toMatch(
      /\.sidebar-toggle-button\.is-rail:hover,[\s\S]*?\{[^}]*background:\s*var\(--semantic-icon-button-surface-hover\);[^}]*color:\s*var\(--semantic-icon-button-text-hover\);[^}]*transform:\s*none;/s,
    )
    expect(styles).toMatch(
      /\.sidebar-toggle-button\.is-rail\.is-active\s*\{[^}]*background:\s*var\(--semantic-icon-button-surface-active\);[^}]*color:\s*var\(--semantic-icon-button-text-active\);[^}]*transform:\s*none;/s,
    )
    expect(styles).toMatch(/\.sidebar-toggle-button\.is-rail\.is-collapsed\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-icon-button-text\);[^}]*transform:\s*none;/s)
    expect(styles).toMatch(/\.sidebar-toggle-button\.is-rail\.is-collapsed:hover,[\s\S]*?\.sidebar-toggle-button\.is-rail\.is-collapsed:focus-visible\s*\{[^}]*background:\s*var\(--semantic-icon-button-surface-hover\);[^}]*color:\s*var\(--semantic-icon-button-text-hover\);[^}]*transform:\s*none;/s)
    expect(styles).toMatch(/\.sidebar-toggle-button\.is-rail\.is-expanded\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-icon-button-text\);[^}]*transform:\s*none;/s)
    expect(styles).toMatch(/\.sidebar-toggle-button\.is-rail\.is-expanded:hover,[\s\S]*?\.sidebar-toggle-button\.is-rail\.is-expanded:focus-visible\s*\{[^}]*background:\s*var\(--semantic-icon-button-surface-hover\);[^}]*color:\s*var\(--semantic-icon-button-text-hover\);[^}]*transform:\s*none;/s)
    expect(styles).toMatch(/\.session-tab\s*\{[^}]*cursor:\s*default;/s)
    expect(styles).toMatch(/\.session-tab-trigger\s*\{[^}]*cursor:\s*default;/s)
    expect(styles).toMatch(/\.session-tab-close\s*\{[^}]*cursor:\s*default;/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dockview-workbench-tab-trigger\s*\{[^}]*cursor:\s*default;/s)
    expect(styles).toMatch(/\.session-tab-trigger,\s*\.session-tab-close,[\s\S]*?\.canvas-region-top-menu-add-button\s*\{[^}]*border-radius:\s*8px;/s)
    expect(styles).toMatch(
      /\.canvas-region-top-menu\s+\.session-tab-close,\s*\.right-sidebar-tab-close\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--top-chrome-icon\);[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*none;/s,
    )
    expect(styles).toMatch(
      /\.canvas-region-top-menu\s+\.sidebar-toggle-button\.is-top-menu:hover,[\s\S]*?\.canvas-region-top-menu-add-button:focus-visible,[\s\S]*?\.canvas-region-top-menu\s+\.session-tab-close:focus-visible\s*\{[^}]*background:\s*var\(--semantic-icon-button-surface-hover\);[^}]*border-color:\s*transparent;[^}]*color:\s*var\(--semantic-icon-button-text-hover\);/s,
    )
    expect(styles).toMatch(/\.right-sidebar-top-menu-tabs\s*\{[^}]*align-items:\s*stretch;[^}]*gap:\s*0;/s)
    expect(styles).toMatch(
      /\.left-sidebar-top-menu\s+\.top-menu-view-button,\s*\.right-sidebar-top-menu\s+\.top-menu-view-button\s*\{[^}]*align-self:\s*center;[^}]*border:\s*1px solid transparent;[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-accent-icon\);/s,
    )
    expect(styles).toMatch(
      /\.right-sidebar-top-menu\s+\.top-menu-view-button\s*\{[^}]*width:\s*var\(--section-toolbar-control-size\);[^}]*min-width:\s*var\(--section-toolbar-control-size\);[^}]*min-height:\s*var\(--section-toolbar-control-size\);[^}]*border-radius:\s*8px;/s,
    )
    expect(styles).toMatch(
      /\.left-sidebar-top-menu\s+\.top-menu-view-button:hover,\s*\.left-sidebar-top-menu\s+\.top-menu-view-button:focus-visible,\s*\.right-sidebar-top-menu\s+\.top-menu-view-button:hover,\s*\.right-sidebar-top-menu\s+\.top-menu-view-button:focus-visible\s*\{[^}]*background:\s*transparent;[^}]*border-color:\s*transparent;[^}]*color:\s*var\(--semantic-accent-icon-hover\);/s,
    )
    expect(styles).toMatch(
      /\.left-sidebar-top-menu\s+\.top-menu-view-button\.is-active,[\s\S]*?\.right-sidebar-top-menu\s+\.top-menu-view-button\.is-active:focus-visible\s*\{[^}]*background:\s*transparent;[^}]*border-color:\s*transparent;[^}]*color:\s*var\(--semantic-accent-icon-active\);/s,
    )
    expect(styles).toMatch(
      /\.left-sidebar-top-menu\s+\.sidebar-toggle-button\.is-top-menu,\s*\.right-sidebar-top-menu\s+\.sidebar-toggle-button\.is-top-menu\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*color:\s*var\(--semantic-accent-icon\);/s,
    )
    expect(styles).toMatch(
      /\.left-sidebar-top-menu\s+\.sidebar-toggle-button\.is-top-menu:hover,[\s\S]*?\.right-sidebar-top-menu\s+\.sidebar-toggle-button\.is-top-menu:focus-visible\s*\{[^}]*background:\s*transparent;[^}]*border-color:\s*transparent;[^}]*color:\s*var\(--semantic-accent-icon-hover\);/s,
    )
    expect(styles).not.toMatch(
      /\.left-sidebar-top-menu\s+\.sidebar-toggle-button\.is-top-menu\.is-active,\s*\.right-sidebar-top-menu\s+\.sidebar-toggle-button\.is-top-menu\.is-active\s*\{[^}]*color:\s*var\(--semantic-accent-icon-active\);/s,
    )
    expect(styles).toMatch(/--canvas-region-tab-inactive-bg:\s*var\(--semantic-shell-chrome-surface\);/s)
    expect(styles).toMatch(/--canvas-region-tab-focus:\s*var\(--semantic-icon-button-surface-hover\);/s)
    expect(styles).toMatch(/--dockview-tab-active-indicator:\s*var\(--semantic-shell-chrome-tab-indicator-active\);/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dv-tab\s*\{[^}]*position:\s*relative;[^}]*margin:\s*0 0 -1px;[^}]*background:\s*transparent;[^}]*overflow:\s*hidden;/s)
    expect(styles).toMatch(
      /\.dockview-theme-anybox\s+\.dv-groupview\.dv-active-group > \.dv-tabs-and-actions-container \.dv-tabs-container > \.dv-tab\.dv-active-tab,[\s\S]*?\.dv-tab\.dv-active-tab\s*\{[^}]*background:\s*var\(--dockview-tab-active-bg\);[^}]*box-shadow:\s*inset 0 1px 0 var\(--dockview-tab-border\),\s*inset 0 -1px 0 var\(--dockview-tab-border\);/s,
    )
    expect(styles).not.toMatch(/\.dockview-theme-anybox\s+\.dv-tab\.dv-active-tab,[\s\S]*?\{[^}]*box-shadow:\s*none;/s)
    expect(styles).toMatch(
      /\.dockview-theme-anybox\s+\.dv-groupview\.dv-active-group > \.dv-tabs-and-actions-container \.dv-tabs-container > \.dv-tab\.dv-active-tab::after\s*\{[^}]*content:\s*"";[^}]*top:\s*0;[^}]*width:\s*auto;[^}]*height:\s*4px;[^}]*background:\s*var\(--dockview-tab-active-indicator\);[^}]*outline:\s*0 !important;/s,
    )
    expect(styles).toMatch(
      /\.dockview-theme-anybox\s+\.dv-groupview\.dv-active-group > \.dv-tabs-and-actions-container \.dv-tabs-container > \.dv-tab\.dv-active-tab:first-child::after\s*\{[^}]*left:\s*-1px;/s,
    )
    expect(styles).toMatch(
      /\.dockview-theme-anybox\s+\.dv-groupview\.dv-active-group > \.dv-tabs-and-actions-container \.dv-tabs-container > \.dv-tab\.dv-inactive-tab,[\s\S]*?\.dv-tab\.dv-inactive-tab\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--seg-text-2\);/s,
    )
    expect(styles).toMatch(
      /\.dockview-theme-anybox\s+\.dv-tabs-container > \.dv-tab\.dv-inactive-tab:hover,[\s\S]*?\.dv-tabs-container > \.dv-tab\.dv-inactive-tab:focus-within\s*\{[^}]*background:\s*var\(--dockview-tab-hover-bg\);/s,
    )
    expect(styles).toMatch(
      /\.dockview-theme-anybox\s+\.dv-tabs-container > \.dv-tab:not\(:first-child\)::before\s*\{[^}]*content:\s*"";[^}]*position:\s*absolute;[^}]*top:\s*0;[^}]*bottom:\s*0;[^}]*left:\s*0;[^}]*z-index:\s*1;[^}]*width:\s*1px;[^}]*background:\s*var\(--dockview-tab-divider\);[^}]*pointer-events:\s*none;/s,
    )
    expect(styles).toMatch(
      /\.dockview-theme-anybox\s+\.dv-tabs-container > \.dv-tab:last-child::before\s*\{[^}]*right:\s*0;[^}]*left:\s*0;[^}]*width:\s*auto;[^}]*background:\s*linear-gradient\([^}]*var\(--dockview-tab-divider\)\s*calc\(100% - 1px\),[^}]*var\(--dockview-tab-divider\)\s*100%[^}]*pointer-events:\s*none;/s,
    )
    expect(styles).toMatch(
      /\.dockview-theme-anybox\s+\.dv-tabs-container > \.dv-tab:not\(:first-child\):last-child::before\s*\{[^}]*background:\s*linear-gradient\([^}]*var\(--dockview-tab-divider\)\s*0,[^}]*var\(--dockview-tab-divider\)\s*1px,[^}]*var\(--dockview-tab-divider\)\s*calc\(100% - 1px\),[^}]*var\(--dockview-tab-divider\)\s*100%/s,
    )
    expect(styles).not.toMatch(
      /\.dockview-theme-anybox\s+\.dv-tab\.dv-active-tab::after,\s*\.dockview-theme-anybox\s+\.dv-tab\.dv-active-tab \+ \.dv-tab::after\s*\{[^}]*display:\s*none;/s,
    )
    expect(styles).toMatch(
      /\.dockview-theme-anybox\s+\.dv-tab:focus-within::after,\s*\.dockview-theme-anybox\s+\.dv-tab:focus::after\s*\{[^}]*content:\s*none;[^}]*outline:\s*0;/s,
    )
    expect(styles).not.toMatch(
      /\.dockview-theme-anybox\s+\.dv-tab:not\(:first-child\)::after\s*\{[^}]*background:\s*var\(--dockview-tab-divider\);/s,
    )
    expect(styles).not.toMatch(
      /\.dockview-theme-anybox\s+\.dv-tab:not\(:first-child\)\s*\{[^}]*box-shadow:\s*inset 1px 0 0 var\(--dockview-tab-divider\);/s,
    )
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dockview-workbench-tab-content\s*\{[^}]*height:\s*100%;[^}]*padding:\s*0 8px 0 12px;/s)
    expect(styles).not.toMatch(/session-tab-active-curve/)
    expect(styles).toMatch(/--right-sidebar-tab-active-indicator:\s*var\(--semantic-shell-chrome-tab-indicator-active\);/s)
    expect(styles).toMatch(
      /\.right-sidebar-tab\.is-active\s*\{[^}]*box-shadow:\s*inset 0 1px 0 var\(--right-sidebar-tab-border\),\s*inset 0 -1px 0 var\(--right-sidebar-tab-border\);/s,
    )
    expect(styles).toMatch(
      /\.right-sidebar-tab\.is-active::before\s*\{[^}]*content:\s*"";[^}]*top:\s*0;[^}]*height:\s*4px;[^}]*background:\s*var\(--right-sidebar-tab-active-indicator\);/s,
    )
    expect(styles).not.toMatch(
      /--(?:dockview|right-sidebar)-tab-(?:focus-accent|active-indicator):\s*var\(--focus-outline-color\);/s,
    )
    expect(styles).toMatch(
      /\.canvas-region-top-menu\s+\.session-tab:hover,\s*\.canvas-region-top-menu\s+\.session-tab:focus-within\s*\{[^}]*background:\s*var\(--top-chrome-focus-surface\);[^}]*border-color:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.canvas-region-top-menu\s+\.session-tab\.is-active:hover,\s*\.canvas-region-top-menu\s+\.session-tab\.is-active:focus-within,[\s\S]*?\{[^}]*background:\s*var\(--top-chrome-active-surface\);/s,
    )
    expect(styles).toMatch(/\.canvas-region-top-menu\s*\{[^}]*padding-bottom:\s*0;/s)
    expect(styles).toMatch(/\.canvas-region-top-menu\s*\{[^}]*padding-right:\s*var\(--window-controls-canvas-clearance\);/s)
    expect(styles).toMatch(/\.canvas-region-top-menu-trailing\.is-right-sidebar-expanded\s*\{[^}]*margin-right:\s*calc\(-1 \* var\(--canvas-inline-padding\)\);/s)
    expect(styles).toMatch(/\.canvas-region-top-menu-trailing\.is-right-sidebar-collapsed\s*\{[^}]*margin-right:\s*8px;/s)
    expect(styles).toMatch(/\.canvas-region-top-menu-tabs-shell\s*\{[^}]*display:\s*flex;[^}]*gap:\s*6px;[^}]*max-width:\s*none;[^}]*justify-self:\s*stretch;/s)
    expect(styles).toMatch(/\.canvas-region-top-menu-tabs\s*\{[^}]*flex:\s*0 1 auto;[^}]*align-items:\s*center;[^}]*overflow-x:\s*auto;[^}]*padding-top:\s*0;/s)
    expect(styles).toMatch(/\.canvas-region-top-menu-add-button\s*\{[^}]*width:\s*28px;[^}]*min-width:\s*28px;[^}]*min-height:\s*28px;/s)
    expect(styles).toMatch(
      /\.right-sidebar-add-tab-button svg,\s*\.canvas-region-top-menu-add-button svg\s*\{[^}]*width:\s*var\(--section-toolbar-icon-size\);[^}]*height:\s*var\(--section-toolbar-icon-size\);[^}]*stroke-width:\s*2;/s,
    )
    expect(styles).toMatch(/\.canvas-region-top-menu\s+\.session-tab\s*\{[^}]*min-height:\s*var\(--canvas-region-tab-height\);[^}]*margin-top:\s*6px;[^}]*padding:\s*0 8px 0 10px;/s)
    expect(styles).toMatch(
      /\.canvas-region-top-menu\s+\.session-tab\.is-active\s*\{[^}]*min-height:\s*calc\(var\(--canvas-region-tab-height\) \+ 4px\);[^}]*background:\s*var\(--canvas-region-tab-active-bg\);[^}]*border:\s*0;[^}]*z-index:\s*auto;[^}]*box-shadow:\s*inset 0 1px 0 var\(--canvas-region-tab-border\),\s*inset 0 -1px 0 var\(--canvas-region-tab-border\);/s,
    )
    expect(styles).toMatch(
      /\.canvas-region-top-menu\s+\.session-tab\.is-active::before\s*\{[^}]*content:\s*none;/s,
    )
    expect(styles).toMatch(
      /\.canvas-region-top-menu\s+\.session-tab\.is-active,\s*\.right-sidebar-tab\.is-active\s*\{[^}]*box-shadow:\s*inset 0 1px 0 var\(--top-chrome-border\),\s*inset 0 -1px 0 var\(--top-chrome-border\);/s,
    )
    expect(styles).toMatch(
      /\.session-canvas-top-menu\s*\{[^}]*min-height:\s*var\(--section-toolbar-height\);[^}]*padding-right:\s*calc\(var\(--window-controls-canvas-clearance\) \+ 8px\);[^}]*padding-top:\s*0;[^}]*padding-bottom:\s*0;[^}]*background:\s*transparent;[^}]*border-bottom:\s*0;/s,
    )
    expect(styles).toMatch(
      /\.session-canvas-top-menu\s+\.shell-top-menu-trailing\s*\{[^}]*flex-wrap:\s*nowrap;/s,
    )
    expect(styles).toMatch(
      /\.session-canvas-top-menu-copy-main\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*10px;/s,
    )
    expect(styles).toMatch(
      /\.session-canvas-top-menu-copy\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s,
    )
    expect(styles).toMatch(
      /\.session-canvas-top-menu-copy\s+\.label\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;[^}]*font-size:\s*12px;[^}]*font-weight:\s*600;[^}]*line-height:\s*1\.2;[^}]*text-transform:\s*none;[^}]*color:\s*var\(--text-primary\);/s,
    )
    expect(styles).toMatch(
      /\.session-canvas-top-menu\s+\.canvas-top-menu-button\s*\{[^}]*min-height:\s*var\(--section-toolbar-pill-height\);[^}]*border-radius:\s*8px;[^}]*font-size:\s*12px;[^}]*line-height:\s*1\.2;/s,
    )
    expect(styles).toMatch(
      /\.canvas-top-menu-mcp-trigger,\s*\.canvas-top-menu-skill-trigger\s*\{[^}]*gap:\s*4px;[^}]*max-width:\s*min\(128px,\s*22vw\);/s,
    )
    expect(styles).toMatch(
      /\.canvas-top-menu-selector-panel\s*\{[^}]*top:\s*calc\(100%\s*\+\s*8px\);[^}]*right:\s*0;[^}]*min-width:\s*260px;[^}]*max-height:\s*min\(320px,\s*calc\(100dvh - 180px\)\);/s,
    )
  })

  it("styles shell chrome and composer controls with dedicated semantic surfaces", () => {
    expect(styles).toMatch(/--semantic-accent-icon-light:\s*#78716c;/i)
    expect(styles).toMatch(/--semantic-accent-icon-dark:\s*#d6d3d1;/i)
    expect(styles).toMatch(/--semantic-accent-icon-hover-light:\s*#b9534c;/i)
    expect(styles).toMatch(/--semantic-accent-icon-hover-dark:\s*#fca5a5;/i)
    expect(styles).toMatch(/--semantic-accent-icon-active-light:\s*#fca5a5;/i)
    expect(styles).toMatch(/--semantic-accent-icon-active-dark:\s*#fca5a5;/i)
    expect(styles).toMatch(/--semantic-accent-icon:\s*var\(--semantic-accent-icon-light\);/s)
    expect(styles).toMatch(/--semantic-accent-icon-hover:\s*var\(--semantic-accent-icon-hover-light\);/s)
    expect(styles).toMatch(/--semantic-accent-icon-active:\s*var\(--semantic-accent-icon-active-light\);/s)
    expect(styles).toMatch(/--semantic-accent-icon:\s*var\(--semantic-accent-icon-dark\);/s)
    expect(styles).toMatch(/--semantic-accent-icon-hover:\s*var\(--semantic-accent-icon-hover-dark\);/s)
    expect(styles).toMatch(/--semantic-accent-icon-active:\s*var\(--semantic-accent-icon-active-dark\);/s)
    expect(styles).toMatch(/--semantic-shell-chrome-surface-light:\s*#f5f2ee;/i)
    expect(styles).toMatch(/--semantic-shell-chrome-surface-dark:\s*#221d1a;/i)
    expect(styles).toMatch(/--semantic-shell-chrome-surface:\s*var\(--semantic-shell-chrome-surface-light\);/s)
    expect(styles).toMatch(/--semantic-shell-chrome-surface:\s*var\(--semantic-shell-chrome-surface-dark\);/s)
    expect(styles).toMatch(/--semantic-shell-chrome-tab-surface-active-light:\s*var\(--surface-panel-light\);/s)
    expect(styles).toMatch(/--semantic-shell-chrome-tab-surface-active-dark:\s*var\(--surface-panel-dark\);/s)
    expect(styles).toMatch(/--semantic-shell-chrome-tab-surface-active:\s*var\(--semantic-shell-chrome-tab-surface-active-light\);/s)
    expect(styles).toMatch(/--semantic-shell-chrome-tab-surface-active:\s*var\(--semantic-shell-chrome-tab-surface-active-dark\);/s)
    expect(styles).toMatch(/--semantic-popup-panel-surface-light:\s*var\(--surface-shell-light\);/s)
    expect(styles).toMatch(/--semantic-popup-panel-surface-dark:\s*var\(--surface-shell-dark\);/s)
    expect(styles).toMatch(/--semantic-popup-panel-surface:\s*var\(--semantic-popup-panel-surface-light\);/s)
    expect(styles).toMatch(/--semantic-popup-panel-surface:\s*var\(--semantic-popup-panel-surface-dark\);/s)
    expect(styles).toMatch(/--semantic-settings-page-surface-light:\s*var\(--semantic-popup-panel-surface-light\);/s)
    expect(styles).toMatch(/--semantic-settings-page-surface-dark:\s*var\(--semantic-popup-panel-surface-dark\);/s)
    expect(styles).toMatch(/--semantic-settings-page-surface:\s*var\(--semantic-settings-page-surface-light\);/s)
    expect(styles).toMatch(/--semantic-settings-page-surface:\s*var\(--semantic-settings-page-surface-dark\);/s)
    expect(styles).toMatch(/--semantic-switch-track-surface-light:\s*color-mix\(in srgb,\s*var\(--border-default-light\) 72%,\s*var\(--surface-panel-light\) 28%\);/s)
    expect(styles).toMatch(/--semantic-switch-track-surface-active-dark:\s*var\(--brand-primary-dark\);/s)
    expect(styles).toMatch(/--semantic-switch-thumb-surface-disabled-dark:\s*var\(--surface-panel-dark\);/s)
    expect(styles).toMatch(/--semantic-switch-track-surface:\s*var\(--semantic-switch-track-surface-light\);/s)
    expect(styles).toMatch(/--semantic-switch-track-surface:\s*var\(--semantic-switch-track-surface-dark\);/s)
    expect(styles).toMatch(/--semantic-settings-switch-track-surface:\s*var\(--semantic-switch-track-surface\);/s)
    expect(styles).toMatch(/--semantic-settings-switch-track-surface-light:\s*var\(--semantic-switch-track-surface-light\);/s)
    expect(styles).toMatch(/--semantic-settings-switch-track-surface-dark:\s*var\(--semantic-switch-track-surface-dark\);/s)
    expect(styles).toMatch(/--seg-shell-chrome-surface:\s*var\(--semantic-shell-chrome-surface\);/s)
    expect(styles).toMatch(/--seg-accent-icon:\s*var\(--semantic-accent-icon\);/s)
    expect(styles).toMatch(/--seg-accent-icon-hover:\s*var\(--semantic-accent-icon-hover\);/s)
    expect(styles).toMatch(/--seg-accent-icon-active:\s*var\(--semantic-accent-icon-active\);/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dv-tabs-and-actions-container\s*\{[^}]*--dockview-tab-icon-color:\s*var\(--semantic-accent-icon\);[^}]*--dockview-tab-icon-hover-color:\s*var\(--semantic-accent-icon-hover\);/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dockview-workbench-header-actions\s+\.sidebar-toggle-button\.is-top-menu,\s*\.dockview-theme-anybox\s+\.dockview-workbench-header-actions\s+\.canvas-region-top-menu-add-button\s*\{[^}]*color:\s*var\(--dockview-tab-icon-color\);/s)
    expect(styles).not.toMatch(/--dockview-tab-icon-active-color/)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dockview-workbench-tab-close\s*\{[^}]*color:\s*var\(--dockview-tab-icon-color\);/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dockview-workbench-tab-close:hover,\s*\.dockview-theme-anybox\s+\.dockview-workbench-tab-close:focus-visible\s*\{[^}]*background:\s*transparent;[^}]*border-color:\s*transparent;[^}]*color:\s*var\(--dockview-tab-icon-hover-color\);/s)
    expect(styles).toMatch(/\.canvas-region-top-menu\s+\.sidebar-toggle-button\.is-top-menu,[\s\S]*?\.canvas-region-top-menu-add-button,[\s\S]*?\{[^}]*color:\s*var\(--semantic-accent-icon\);/s)
    expect(styles).toMatch(/\.canvas-region-top-menu\s+\.sidebar-toggle-button\.is-top-menu:hover,[\s\S]*?\.canvas-region-top-menu-add-button:focus-visible,[\s\S]*?\{[^}]*background:\s*transparent;[^}]*border-color:\s*transparent;[^}]*color:\s*var\(--semantic-accent-icon-hover\);[^}]*transform:\s*none;/s)
    expect(styles).toMatch(/\.terminal-panel-toggle-button\.is-active,[\s\S]*?\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-accent-icon-active\);[^}]*transform:\s*none;/s)
    expect(styles).toMatch(/\.settings-page-close-button:hover\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-icon-button-text-hover\);/s)
    expect(styles).toMatch(/\.settings-page-close-button:focus-visible\s*\{[^}]*outline:\s*none;[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-icon-button-text-hover\);/s)
    expect(styles).toMatch(/\.session-canvas-top-menu\s+\.canvas-top-menu-editor-launch-button,\s*\.session-canvas-top-menu\s+\.canvas-top-menu-editor-menu-button\s*\{[^}]*color:\s*var\(--semantic-accent-icon\);/s)
    expect(styles).toMatch(/\.session-canvas-top-menu\s+\.canvas-top-menu-editor-menu-button\.is-active,[\s\S]*?\.session-canvas-top-menu\s+\.canvas-top-menu-editor-menu-button\.is-active:focus-visible\s*\{[^}]*color:\s*var\(--semantic-accent-icon-active\);[^}]*transform:\s*none;/s)
    expect(styles).toMatch(/\.dockview-theme-anybox\s+\.dv-tabs-and-actions-container\s*\{[^}]*--dockview-tab-bar-bg:\s*var\(--seg-shell-chrome-surface\);[^}]*background:\s*var\(--dockview-tab-bar-bg\);/s)
    expect(styles).toMatch(/\.left-sidebar-top-menu\s*\{[^}]*background:\s*var\(--seg-shell-chrome-surface\);/s)
    expect(styles).toMatch(/\.activity-rail\s*\{[^}]*padding:\s*0 0 14px;/s)
    expect(styles).toMatch(/\.activity-rail-top-menu\s*\{[^}]*min-height:\s*var\(--section-toolbar-height\);[^}]*background:\s*var\(--seg-shell-chrome-surface\);/s)
    expect(styles).toMatch(/\.activity-rail-top-menu::after\s*\{[^}]*bottom:\s*0;[^}]*height:\s*1px;[^}]*background:\s*var\(--border-subtle\);/s)
    expect(styles).toMatch(/\.right-sidebar-top-menu\s*\{[^}]*--right-sidebar-tab-bar-bg:\s*var\(--seg-right-sidebar\);[^}]*--right-sidebar-tab-active-bg:\s*var\(--semantic-shell-chrome-tab-surface-active\);[^}]*background:\s*var\(--right-sidebar-tab-bar-bg\);/s)
    expect(styles).toMatch(/--semantic-composer-surface-light:\s*#ffffff;/i)
    expect(styles).toMatch(/--semantic-composer-border-light:\s*var\(--border-default-light\);/s)
    expect(styles).toMatch(/--semantic-composer-surface:\s*var\(--semantic-composer-surface-light\);/s)
    expect(styles).toMatch(/--semantic-composer-surface:\s*var\(--semantic-composer-surface-dark\);/s)
    expect(styles).toMatch(/--semantic-composer-border:\s*var\(--semantic-composer-border-light\);/s)
    expect(styles).toMatch(/--semantic-composer-border:\s*var\(--semantic-composer-border-dark\);/s)
    expect(styles).not.toMatch(/--semantic-composer-surface:\s*var\(--surface-panel\);/s)
    expect(styles).toMatch(/--semantic-thread-response-text-light:\s*var\(--text-primary-light\);/s)
    expect(styles).toMatch(/--semantic-thread-reasoning-text-light:\s*var\(--text-secondary-light\);/s)
    expect(styles).toMatch(/--semantic-thread-response-text:\s*var\(--semantic-thread-response-text-light\);/s)
    expect(styles).toMatch(/--semantic-thread-response-text:\s*var\(--semantic-thread-response-text-dark\);/s)
    expect(styles).toMatch(/--semantic-thread-reasoning-text:\s*var\(--semantic-thread-reasoning-text-light\);/s)
    expect(styles).toMatch(/--semantic-thread-reasoning-text:\s*var\(--semantic-thread-reasoning-text-dark\);/s)
    expect(styles).toMatch(/--semantic-thread-divider-light:\s*color-mix\(in srgb,\s*var\(--border-subtle-light\) 80%,\s*rgba\(0,\s*0,\s*0,\s*0\) 20%\);/s)
    expect(styles).toMatch(/--semantic-thread-divider:\s*var\(--semantic-thread-divider-light\);/s)
    expect(styles).toMatch(/--semantic-thread-divider:\s*var\(--semantic-thread-divider-dark\);/s)
    expect(styles).toMatch(/--semantic-thread-user-message-diff-card-surface-light:\s*var\(--semantic-thread-panel-surface-light\);/s)
    expect(styles).toMatch(/--semantic-thread-user-message-diff-card-surface:\s*var\(--semantic-thread-user-message-diff-card-surface-light\);/s)
    expect(styles).toMatch(/--semantic-thread-user-message-diff-card-surface:\s*var\(--semantic-thread-user-message-diff-card-surface-dark\);/s)
    expect(styles).toMatch(/--semantic-thread-user-message-diff-row-surface-hover:\s*var\(--semantic-thread-user-message-diff-row-surface-hover-light\);/s)
    expect(styles).toMatch(/--semantic-thread-user-message-diff-row-surface-hover:\s*var\(--semantic-thread-user-message-diff-row-surface-hover-dark\);/s)
    expect(styles).toMatch(/--semantic-markdown-inline-code-surface-light:\s*color-mix\(in srgb,\s*var\(--brand-primary-soft\) 80%,\s*var\(--surface-panel-light\) 20%\);/s)
    expect(styles).toMatch(/--semantic-markdown-selection-background-light:\s*color-mix\(in srgb,\s*var\(--brand-primary-soft\) 84%,\s*rgba\(0,\s*0,\s*0,\s*0\) 16%\);/s)
    expect(styles).toMatch(/--semantic-markdown-selection-background:\s*var\(--semantic-markdown-selection-background-light\);/s)
    expect(styles).toMatch(/--semantic-markdown-selection-background:\s*var\(--semantic-markdown-selection-background-dark\);/s)
    expect(styles).toMatch(/--semantic-markdown-code-surface-light:\s*#27272a;/s)
    expect(styles).toMatch(/--semantic-markdown-inline-code-surface:\s*var\(--semantic-markdown-inline-code-surface-light\);/s)
    expect(styles).toMatch(/--semantic-markdown-inline-code-surface:\s*var\(--semantic-markdown-inline-code-surface-dark\);/s)
    expect(styles).toMatch(/--semantic-dropdown-menu-surface-light:\s*#ffffff;/i)
    expect(styles).toMatch(
      /--semantic-dropdown-menu-surface:\s*var\(--semantic-dropdown-menu-surface-light\);/s,
    )
    expect(styles).toMatch(
      /--semantic-dropdown-menu-surface:\s*var\(--semantic-dropdown-menu-surface-dark\);/s,
    )
    expect(styles).not.toMatch(/--semantic-dropdown-menu-surface:\s*var\(--surface-panel\);/s)
    expect(styles).toMatch(
      /--semantic-composer-button-surface:\s*var\(--semantic-composer-button-surface-light\);/s,
    )
    expect(styles).toMatch(
      /--semantic-composer-icon-button-text:\s*var\(--semantic-composer-icon-button-text-light\);/s,
    )
    expect(styles).toMatch(
      /--semantic-composer-icon-button-text:\s*var\(--semantic-composer-icon-button-text-dark\);/s,
    )
    expect(styles).toMatch(/--seg-composer-button-surface:\s*var\(--semantic-composer-button-surface\);/s)
    expect(styles).toMatch(/--seg-composer-surface:\s*var\(--semantic-composer-surface\);/s)
    expect(styles).toMatch(/--seg-composer-border:\s*var\(--semantic-composer-border\);/s)
    expect(styles).toMatch(/--seg-dropdown-menu-surface:\s*var\(--semantic-dropdown-menu-surface\);/s)
    expect(styles).toMatch(
      /\.composer\s*\{[^}]*border:\s*1px solid var\(--seg-composer-border\);[^}]*background:\s*var\(--seg-composer-surface\);/s,
    )
    expect(styles).toMatch(
      /\.composer-selector-button\s*\{[^}]*min-height:\s*34px;/s,
    )
    expect(styles).toMatch(
      /\.composer\s+\.composer-selector-button,\s*\.composer\s+\.composer-actions\s+\.primary-button,\s*\.composer\s+\.composer-actions\s+\.secondary-button,\s*\.composer\s+\.composer-menu-option\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.composer\s+\.composer-selector-button:not\(:disabled\):hover,\s*\.composer\s+\.composer-selector-button:not\(:disabled\):focus-visible,\s*\.composer\s+\.composer-actions\s+\.primary-button:not\(:disabled\):hover,\s*\.composer\s+\.composer-actions\s+\.primary-button:not\(:disabled\):focus-visible,\s*\.composer\s+\.composer-actions\s+\.secondary-button:not\(:disabled\):hover,\s*\.composer\s+\.composer-actions\s+\.secondary-button:not\(:disabled\):focus-visible,\s*\.composer\s+\.composer-menu-option:not\(:disabled\):hover,\s*\.composer\s+\.composer-menu-option:not\(:disabled\):focus-visible\s*\{[^}]*background:\s*var\(--seg-composer-button-surface\);[^}]*color:\s*var\(--seg-composer-button-text\);/s,
    )
    expect(styles).toMatch(
      /\.composer\s+\.composer-menu-option\.is-selected\s*\{[^}]*background:\s*var\(--seg-composer-button-surface-strong\);[^}]*color:\s*var\(--seg-composer-button-text-strong\);/s,
    )
    expect(styles).toMatch(
      /\.composer-menu-panel\s*\{[^}]*bottom:\s*calc\(100%\s*\+\s*8px\);[^}]*max-height:\s*min\(320px,\s*calc\(100dvh - 180px\)\);[^}]*overflow:\s*auto;[^}]*background:\s*var\(--seg-dropdown-menu-surface\);/s,
    )
    expect(styles).toMatch(
      /\.create-session-layout\s+\.create-session-shell:has\(\.create-session-select-panel\)\s*\{[^}]*z-index:\s*7;/s,
    )
    expect(styles).toMatch(
      /\.create-session-layout\s+\.create-session-shell\s*\{[^}]*overflow:\s*visible;[^}]*contain:\s*layout;/s,
    )
    expect(styles).toMatch(
      /\.create-session-card:has\(\.create-session-select-panel\)\s+\.create-session-tip\s*\{[^}]*visibility:\s*hidden;/s,
    )
    expect(styles).toMatch(
      /\.canvas-top-menu-selector-panel\s*\{[^}]*top:\s*calc\(100%\s*\+\s*8px\);[^}]*background:\s*var\(--semantic-dropdown-menu-surface\);/s,
    )
    expect(styles).toMatch(
      /select option,\s*select optgroup\s*\{[^}]*background:\s*var\(--seg-dropdown-menu-surface\);/s,
    )
    expect(styles).toMatch(
      /\.composer-selector-button\.is-icon-only,\s*\.composer-actions\s+\.primary-button\.is-icon-only\s*\{[^}]*width:\s*var\(--icon-button-size\);[^}]*min-width:\s*var\(--icon-button-size\);/s,
    )
    expect(styles).toMatch(/\.composer\s+\.composer-selector-button\.is-icon-only,\s*\.composer\s+\.composer-actions\s+\.primary-button\.is-icon-only,\s*\.composer\s+\.composer-actions\s+\.secondary-button\.is-icon-only\s*\{[^}]*background:\s*var\(--semantic-composer-icon-button-surface\);[^}]*color:\s*var\(--semantic-composer-icon-button-text\);/s)
    expect(styles).toMatch(/\.composer\s+\.composer-selector-button\.is-icon-only:not\(:disabled\):hover,[\s\S]*?\.composer\s+\.composer-actions\s+\.secondary-button\.is-icon-only:not\(:disabled\):focus-visible\s*\{[^}]*background:\s*var\(--semantic-composer-icon-button-surface-hover\);[^}]*color:\s*var\(--semantic-composer-icon-button-text-hover\);/s)
  })

  it("lets full-page right sidebar views reveal the sidebar surface", () => {
    expect(styles).toMatch(
      /\.right-sidebar-main-stack\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.unified-preview-panel\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.unified-preview-stack\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.preview-toolbar\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.preview-panel-section \.preview-empty-state\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.session-message-tree-panel\s*\{[^}]*background:\s*transparent;/s,
    )
  })

  it("routes right-sidebar launcher card borders through secondary button semantic tokens", () => {
    const stylesRoot = resolve(process.cwd(), "src/renderer/src/styles")
    const rightSidebarStyles = readFileSync(resolve(stylesRoot, "right-sidebar.css"), "utf8")
    const windowsTransparentStyles = readFileSync(resolve(stylesRoot, "windows-transparent.css"), "utf8")
    const launcherCardRules = Array.from(
      rightSidebarStyles.matchAll(/[^{}]*\.right-sidebar-launcher-card[^{}]*\{[^{}]*\}/g),
      (match) => match[0],
    ).join("\n")
    const windowsLauncherCardRules = Array.from(
      windowsTransparentStyles.matchAll(/[^{}]*\.right-sidebar-launcher-card[^{}]*\{[^{}]*\}/g),
      (match) => match[0],
    ).join("\n")

    expect(launcherCardRules).toMatch(
      /\.right-sidebar-launcher-card\s*\{[^}]*border:\s*1px solid var\(--semantic-button-secondary-border\);/s,
    )
    expect(launcherCardRules).toMatch(
      /\.right-sidebar-launcher-card:hover,\s*\.right-sidebar-launcher-card:focus-visible\s*\{[^}]*border-color:\s*var\(--semantic-button-secondary-border-hover\);/s,
    )
    expect(launcherCardRules).toMatch(
      /\.right-sidebar-launcher-card:disabled\s*\{[^}]*border-color:\s*var\(--semantic-button-secondary-disabled-border\);/s,
    )
    expect(launcherCardRules).not.toMatch(
      /(?:border|border-color|box-shadow):[^;}]*(?:var\(--border-default\)|var\(--focus-outline-color\)|var\(--seg-panel\))/,
    )
    expect(windowsLauncherCardRules).not.toMatch(/(?:^|[;{])\s*border(?:-color)?\s*:/)
  })

  it("routes the Branch Chat recent picker through button and dropdown semantic tokens", () => {
    const stylesRoot = resolve(process.cwd(), "src/renderer/src/styles")
    const rightSidebarStyles = readFileSync(resolve(stylesRoot, "right-sidebar.css"), "utf8")

    expect(rightSidebarStyles).toMatch(
      /\.branch-chat-recent-trigger\s*\{[^}]*border:\s*1px solid var\(--semantic-button-secondary-border\);[^}]*background:\s*var\(--semantic-button-secondary-surface\);[^}]*color:\s*var\(--semantic-button-secondary-text\);/s,
    )
    expect(rightSidebarStyles).toMatch(
      /\.branch-chat-recent-trigger:not\(:disabled\):hover,[\s\S]*?\.branch-chat-recent-trigger\.is-open\s*\{[^}]*border-color:\s*var\(--semantic-button-secondary-border-hover\);[^}]*background:\s*var\(--semantic-button-secondary-surface-hover\);[^}]*color:\s*var\(--semantic-button-secondary-text-hover\);/s,
    )
    expect(rightSidebarStyles).toMatch(
      /\.branch-chat-recent-trigger:disabled\s*\{[^}]*border-color:\s*var\(--semantic-button-secondary-disabled-border\);[^}]*background:\s*var\(--semantic-button-secondary-disabled-surface\);[^}]*color:\s*var\(--semantic-button-secondary-disabled-text\);/s,
    )
    expect(rightSidebarStyles).toMatch(
      /\.branch-chat-recent-popover\s*\{[^}]*background:\s*var\(--semantic-dropdown-menu-surface\);[^}]*color:\s*var\(--semantic-dropdown-option-text\);/s,
    )
    expect(rightSidebarStyles).toMatch(
      /\.branch-chat-recent-option:hover,\s*\.branch-chat-recent-option\.is-active\s*\{[^}]*background:\s*var\(--semantic-dropdown-option-surface-hover\);[^}]*color:\s*var\(--semantic-dropdown-option-text-hover\);/s,
    )
    expect(rightSidebarStyles).toMatch(
      /\.branch-chat-recent-option\.is-selected\s*\{[^}]*background:\s*var\(--semantic-dropdown-option-surface-selected\);[^}]*color:\s*var\(--semantic-dropdown-option-text-selected\);/s,
    )
    expect(rightSidebarStyles).not.toMatch(/--semantic-branch-chat-row-surface/)
  })

  it("lets the right sidebar launcher tile grid fill the available height", () => {
    const stylesRoot = resolve(process.cwd(), "src/renderer/src/styles")
    const rightSidebarStyles = readFileSync(resolve(stylesRoot, "right-sidebar.css"), "utf8")

    expect(rightSidebarStyles).toMatch(
      /\.right-sidebar-launcher-shell\s*\{[^}]*align-content:\s*stretch;[^}]*\}/s,
    )
    expect(rightSidebarStyles).toMatch(
      /\.right-sidebar-launcher-shell\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\);[^}]*\}/s,
    )
    expect(rightSidebarStyles).toMatch(
      /\.right-sidebar-launcher-tile-grid\s*\{[^}]*grid-template-rows:\s*repeat\(3,\s*minmax\(104px,\s*1fr\)\);[^}]*\}/s,
    )
  })

  it("routes left and right sidebar backgrounds through independent tokens", () => {
    expect(styles).toMatch(/--seg-left-sidebar:\s*var\(--surface-left-sidebar\);/)
    expect(styles).toMatch(/--seg-right-sidebar:\s*var\(--surface-right-sidebar\);/)
    expect(styles).not.toMatch(/--seg-sidebar:\s*var\(/)
    expect(styles).toMatch(/--top-chrome-active-surface:\s*var\(--semantic-shell-chrome-tab-surface-active\);/)
    expect(styles).toMatch(
      /\.canvas-region-top-menu\s*\{[^}]*--canvas-region-tab-active-bg:\s*var\(--top-chrome-active-surface\);/s,
    )
    expect(styles).toMatch(
      /\.sidebar\s*\{[^}]*background:\s*var\(--seg-left-sidebar\);/s,
    )
    expect(styles).toMatch(
      /\.sidebar\.is-right\s*\{[^}]*background:\s*var\(--seg-right-sidebar\);/s,
    )
    expect(styles).toMatch(
      /\.right-sidebar-launcher\s*\{[^}]*background:\s*var\(--seg-right-sidebar\);/s,
    )
    expect(styles).toMatch(
      /\.workspace-files-markdown-stage::-webkit-scrollbar-thumb\s*\{[^}]*border:\s*3px solid var\(--seg-right-sidebar\);/s,
    )
    expect(styles).toMatch(
      /\.right-sidebar-top-menu\s*\{[^}]*--right-sidebar-tab-bar-bg:\s*var\(--seg-right-sidebar\);[^}]*--right-sidebar-tab-active-bg:\s*var\(--semantic-shell-chrome-tab-surface-active\);[^}]*background:\s*var\(--right-sidebar-tab-bar-bg\);/s,
    )
    expect(styles).not.toMatch(
      /\.right-sidebar-top-menu\s*\{[^}]*--right-sidebar-tab-active-bg:\s*var\(--top-chrome-active-surface\);/s,
    )
    expect(styles).not.toMatch(
      /\.right-sidebar-top-menu\s*\{[^}]*--right-sidebar-tab-bar-bg:\s*var\(--seg-shell\);/s,
    )
  })

  it("wires Windows desktop backgrounds through token-driven surface profiles", () => {
    expect(styles).toMatch(/body\s*\{[^}]*background:\s*transparent;/s)
    expect(readFileSync(resolve(process.cwd(), "src/renderer/src/styles/index.css"), "utf8")).toMatch(
      /@import "\.\/top-chrome\.css";\s*@import "\.\/windows-transparent\.css";\s*@import "\.\/debug\.css";/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows,[\s\S]*?\.session-popout-shell\.is-windows\s*\{[^}]*--surface-profile-shell:\s*var\(--surface-shell\);[^}]*--surface-profile-content:\s*var\(--surface-panel\);[^}]*--surface-profile-left-sidebar:\s*var\(--surface-left-sidebar\);[^}]*--surface-profile-right-sidebar:\s*var\(--surface-right-sidebar\);[^}]*--surface-profile-tab-active:\s*var\(--semantic-shell-chrome-tab-surface-active\);[^}]*--surface-profile-composer:\s*var\(--semantic-composer-surface\);[^}]*--surface-profile-popup-panel:\s*var\(--semantic-popup-panel-surface\);[^}]*--surface-profile-popup-panel-nav:\s*var\(--semantic-popup-panel-surface\);[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.app-shell\s*\{[^}]*background:\s*var\(--surface-app\);/s,
    )
    expect(styles).toMatch(
      /\.session-popout-shell\.is-windows\s+\.session-popout-app\s*\{[^}]*background:\s*var\(--surface-profile-shell\);/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.sidebar\s*\{[^}]*background:\s*var\(--surface-profile-left-sidebar\);/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.canvas\.is-workbench\s*\{[^}]*background:\s*var\(--surface-profile-shell\);/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.canvas-region-top-menu\s*\{[^}]*background:\s*var\(--top-chrome-surface,\s*var\(--surface-profile-tab\)\);/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.dockview-workbench-panes,[\s\S]*?\.window-shell\.is-windows\s+\.dockview-theme-anybox \.dv-content-container\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.dockview-theme-anybox\s*\{[^}]*--dv-background-color:\s*transparent;[^}]*--dv-group-view-background-color:\s*transparent;[^}]*--dv-tabs-and-actions-container-background-color:\s*var\(--surface-profile-tab\);[^}]*--dv-activegroup-visiblepanel-tab-background-color:\s*var\(--surface-profile-tab-active\);/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.composer\s*\{[^}]*background:\s*var\(--surface-profile-composer\);/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.right-sidebar-launcher\s*\{[^}]*background:\s*var\(--surface-profile-right-sidebar\);/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.right-sidebar-launcher-card\s*\{[^}]*background:\s*var\(--surface-profile-button-secondary\);/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.right-sidebar-top-menu\s*\{[^}]*--right-sidebar-tab-bar-bg:\s*var\(--surface-profile-right-sidebar\);[^}]*--right-sidebar-tab-active-bg:\s*var\(--surface-profile-tab-active\);[^}]*background:\s*var\(--right-sidebar-tab-bar-bg\);/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.sidebar-view-host,[\s\S]*?\.window-shell\.is-windows\s+\.right-sidebar-view-host,[\s\S]*?\.window-shell\.is-windows\s+\.workbench-pane-live-region\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.right-sidebar-main-stack\s*\{[^}]*background:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.settings-page\s*\{[^}]*background:\s*var\(--surface-profile-popup-panel\);/s,
    )
    expect(styles).toMatch(
      /\.window-shell\.is-windows\s+\.settings-page-nav,\s*\.window-shell\.is-windows\s+\.settings-page-primary-nav\s*\{[^}]*background:\s*var\(--surface-profile-popup-panel-nav\);/s,
    )
  })

  it("keeps the appearance monitor on a single-column window grid", () => {
    expect(styles).toMatch(
      /\.appearance-window-app-shell\s*\{[^}]*--section-toolbar-height:\s*44px;[^}]*--section-toolbar-icon-size:\s*18px;[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*grid-template-rows:\s*44px minmax\(0,\s*1fr\);[^}]*overflow:\s*hidden;/s,
    )
    expect(styles).toMatch(
      /\.appearance-window-header\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1;[^}]*min-height:\s*44px;/s,
    )
    expect(styles).toMatch(
      /\.appearance-window-main\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s,
    )
  })

  it("aligns inline composer tags to the text bottom edge", () => {
    expect(styles).toMatch(
      /\.composer-inline-tag\s*\{[^}]*display:\s*inline-flex;[^}]*box-sizing:\s*border-box;[^}]*line-height:\s*1;[^}]*vertical-align:\s*text-bottom;/s,
    )
    expect(styles).toMatch(
      /\.thread-inline-reference\s*\{[^}]*white-space:\s*nowrap;[^}]*vertical-align:\s*text-bottom;/s,
    )
  })

  it("lets response markdown code blocks scroll horizontally", () => {
    expect(styles).toMatch(/\.thread-markdown pre\s*\{[^}]*overflow-x:\s*auto;[^}]*white-space:\s*pre;/s)
    expect(styles).toMatch(
      /\.thread-markdown pre code\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;[^}]*white-space:\s*pre;[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/s,
    )
  })

  it("uses TanStack virtual layout without content-visibility branches", () => {
    expect(styles).not.toMatch(/(?:^|\n)\.thread-message\s*\{[^}]*content-visibility:/s)
    expect(styles).not.toMatch(/(?:^|\n)\.thread-message\s*\{[^}]*contain-intrinsic-size:/s)
    expect(styles).toMatch(/\.thread-column\s*\{[^}]*--thread-composer-clearance:\s*52px;[^}]*overflow-anchor:\s*auto;[^}]*padding:\s*14px 0 var\(--thread-composer-clearance\);[^}]*scroll-padding-bottom:\s*var\(--thread-composer-clearance\);/s)
    expect(styles).toMatch(/\.thread-shell\s*>\s*\.thread-column\s*\{[^}]*padding-bottom:\s*var\(--thread-composer-clearance\);/s)
    expect(styles).toMatch(/\.thread-shell\s*\+\s*\.composer-stack\s*\{[^}]*padding-top:\s*12px;/s)
    expect(styles).not.toMatch(/\.thread-column\.is-content-visibility/)
    expect(styles).toMatch(/\.thread-column\.is-virtualized\s*\{[^}]*gap:\s*0;[^}]*overflow-anchor:\s*none;/s)
    expect(styles).toMatch(/\.thread-virtual-spacer\s*\{[^}]*box-sizing:\s*border-box;[^}]*position:\s*relative;[^}]*flex:\s*0 0 auto;[^}]*width:\s*100%;/s)
    expect(styles).toMatch(/\.thread-virtual-row\s*\{[^}]*position:\s*absolute;[^}]*top:\s*0;[^}]*left:\s*0;[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;/s)
    expect(styles).not.toMatch(/\.thread-virtual-row\s*\{[^}]*content-visibility:/s)
    expect(styles).not.toMatch(/content-visibility:\s*auto;/)
    expect(styles).not.toMatch(/contain-intrinsic-size:/)
  })

  it("gives composer and user body text a slightly larger size than tag text", () => {
    expect(styles).toMatch(
      /\.composer-editor-input\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*1\.65;/s,
    )
    expect(styles).toMatch(
      /\.composer-editor-placeholder\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*1\.65;/s,
    )
    expect(styles).toMatch(
      /\.user-bubble\s*\{[^}]*font-size:\s*16px;[^}]*line-height:\s*1\.6;/s,
    )
  })

  it("styles assistant messages as three stacked panels with call separators", () => {
    expect(styles).toMatch(/\.permission-request-card\s*\{[^}]*border-left-color:\s*var\(--seg-warning-strong\);[^}]*background:\s*var\(--semantic-warning-surface\);/s)
    expect(styles).toMatch(/\.ask-user-question-card\s*\{[^}]*border:\s*0;[^}]*background:\s*var\(--semantic-question-card-surface\);/s)
    expect(styles).toMatch(/\.assistant-section\.is-response\s+\.ask-user-question-card\s*\{[^}]*border:\s*0;[^}]*background:\s*var\(--semantic-question-card-surface\);/s)
    expect(styles).toMatch(/\.proposed-plan-card\s*\{[^}]*background:\s*var\(--semantic-proposed-plan-card-surface\);/s)
    expect(styles).toMatch(/\.assistant-section\.is-response \.trace-item-text,\s*\.assistant-section\.is-response \.trace-item-detail\s*\{[^}]*color:\s*var\(--semantic-thread-response-text\);/s)
    expect(styles).toMatch(/\.assistant-reasoning-row \.trace-item,[\s\S]*?\.assistant-trace-lite-row \.trace-item\s*\{[^}]*background:\s*transparent;/s)
    expect(styles).toMatch(/\.user-message-diff-card\s*\{[^}]*border:\s*1px solid var\(--semantic-thread-user-message-diff-card-border\);[^}]*background:\s*var\(--semantic-thread-user-message-diff-card-surface\);[^}]*box-shadow:\s*none;/s)
    expect(styles).toMatch(/\.user-message-diff-stats \.is-add\s*\{[^}]*color:\s*var\(--semantic-success-text\);/s)
    expect(styles).toMatch(/\.user-message-diff-stats \.is-remove\s*\{[^}]*color:\s*var\(--semantic-error-text\);/s)
    expect(styles).toMatch(/\.right-sidebar-diff-row\.is-add \.right-sidebar-diff-line-number\s*\{[^}]*background:\s*transparent;/s)
    expect(styles).toMatch(/\.right-sidebar-diff-row\.is-remove \.right-sidebar-diff-line-number\s*\{[^}]*background:\s*transparent;/s)
    expect(styles).not.toMatch(
      /\.right-sidebar-diff-row\.is-(?:add|remove) \.right-sidebar-diff-line-number\s*\{[^}]*background:\s*#(?:e8f5eb|feebe8);/s,
    )
    expect(styles).toMatch(/\.user-message-diff-action,[\s\S]*?\.user-message-diff-expand\s*\{[^}]*border:\s*1px solid var\(--semantic-button-secondary-border\);[^}]*background:\s*var\(--semantic-button-secondary-surface\);[^}]*color:\s*var\(--semantic-button-secondary-text\);/s)
    expect(styles).toMatch(/button\.user-message-diff-file-row:hover\s*\{[^}]*background:\s*var\(--semantic-thread-user-message-diff-row-surface-hover\);/s)
    expect(styles).toMatch(/button\.user-message-diff-file-row:focus-visible\s*\{[^}]*background:\s*var\(--semantic-thread-user-message-diff-row-surface-focus\);[^}]*outline:\s*none;/s)
    expect(styles).toMatch(/\.thread-markdown\s*\{[^}]*--md-text:\s*var\(--semantic-markdown-text,\s*var\(--seg-text-1\)\);/s)
    expect(styles).toMatch(/\.thread-markdown\s*\{[^}]*--md-selection-bg:\s*var\(--semantic-markdown-selection-background,\s*var\(--selection-background\)\);/s)
    expect(styles).toMatch(/\.thread-markdown::selection,\s*\.thread-markdown ::selection\s*\{[^}]*background:\s*var\(--md-selection-bg\);[^}]*color:\s*var\(--md-selection-text\);/s)
    expect(styles).toMatch(/\.thread-markdown\s*\{[^}]*--md-inline-code-bg:\s*var\(--semantic-markdown-inline-code-surface,\s*var\(--semantic-thread-panel-surface-muted\)\);/s)
    expect(styles).toMatch(/\.assistant-trace-lite\.is-reasoning \.trace-item-inline-title,[\s\S]*?\.assistant-trace-lite\.is-reasoning \.trace-item-plain-detail\s*\{[^}]*color:\s*var\(--semantic-thread-reasoning-text\);/s)
    expect(styles).toMatch(/\.assistant-shell\.is-sectioned\s*\{[^}]*border:\s*0;[^}]*padding:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s)
    expect(styles).toMatch(
      /\.assistant-section\.is-response\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*padding:\s*0;/s,
    )
    expect(styles).toMatch(/\.assistant-reasoning-separator::before,\s*\.assistant-reasoning-separator::after\s*\{[^}]*height:\s*1px;/s)
    expect(styles).toMatch(/\.assistant-section\.is-response\s+\.trace-item-header\s*\{[^}]*display:\s*none;/s)
    expect(styles).toMatch(/\.assistant-response-actions-row\s*\{[^}]*gap:\s*8px;[^}]*min-width:\s*0;/s)
    expect(styles).toMatch(
      /\.trace-item-collapsed-line\s*\{[^}]*--trace-collapsed-fade-width:\s*clamp\(104px,\s*28%,\s*160px\);[^}]*text-overflow:\s*clip;[^}]*white-space:\s*nowrap;[^}]*-webkit-mask-image:\s*linear-gradient\(to right,\s*var\(--functional-mask-opaque\) 0,\s*var\(--functional-mask-opaque\) calc\(100% - var\(--trace-collapsed-fade-width\)\),\s*transparent 100%\);[^}]*mask-image:\s*linear-gradient\(to right,\s*var\(--functional-mask-opaque\) 0,\s*var\(--functional-mask-opaque\) calc\(100% - var\(--trace-collapsed-fade-width\)\),\s*transparent 100%\);/s,
    )
    expect(styles).not.toMatch(/\.trace-item-collapsed-line::after/)
    expect(styles).toMatch(/\.trace-item-toggle\s*\{[^}]*background:\s*transparent;[^}]*text-align:\s*left;[^}]*cursor:\s*pointer;/s)
    expect(styles).toMatch(/\.trace-item-toggle-summary\s*\{[^}]*gap:\s*4px 6px;/s)
  })

  it("keeps settings surfaces constrained as centered dialogs", () => {
    expect(styles).toMatch(/\.settings-page-overlay\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*overflow:\s*auto;/s)
    expect(styles).toMatch(/\.settings-page-overlay\s*\{[^}]*z-index:\s*40;/s)
    expect(styles).toMatch(
      /\.app-shell\.is-settings-open\s+\.preview-webview\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/s,
    )
    expect(styles).toMatch(
      /\.settings-page\s*\{[^}]*width:\s*min\(100%,\s*1320px\);[^}]*height:\s*min\(calc\(100dvh - 64px\),\s*860px\);[^}]*max-height:\s*min\(calc\(100dvh - 64px\),\s*860px\);/s,
    )
    expect(styles).toMatch(
      /\.settings-page-body,\s*\.settings-page-shell\s*\{[^}]*grid-template-columns:\s*var\(--settings-nav-width\) minmax\(0,\s*1fr\);/s,
    )
    expect(styles).toMatch(/\.settings-services-layout\s*\{[^}]*grid-template-columns:\s*320px minmax\(0,\s*1fr\);/s)
  })

  it("keeps global skill row menus inside the list column", () => {
    expect(styles).toMatch(
      /\.global-skills-install-menu\.skill-tree-row-menu\s*\{[^}]*left:\s*auto;[^}]*right:\s*0;/s,
    )
  })

  it("keeps skills tree scrollbars themed in light mode", () => {
    expect(styles).toMatch(
      /\.skills-tree-root\s*\{[^}]*--skills-tree-scrollbar-size:\s*10px;[^}]*--skills-tree-scrollbar-thumb:\s*var\(--semantic-scrollbar-thumb-surface\);[^}]*--skills-tree-scrollbar-thumb-hover:\s*var\(--semantic-scrollbar-thumb-surface-hover\);[^}]*--skills-tree-scrollbar-thumb-active:\s*var\(--text-tertiary\);[^}]*--skills-tree-scrollbar-track:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.skills-tree-root\s*\{[^}]*overflow:\s*auto;[^}]*scrollbar-gutter:\s*stable;[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*var\(--skills-tree-scrollbar-thumb\) var\(--skills-tree-scrollbar-track\);/s,
    )
    expect(styles).toMatch(
      /\.skills-tree-root::-webkit-scrollbar\s*\{[^}]*width:\s*var\(--skills-tree-scrollbar-size\);[^}]*height:\s*var\(--skills-tree-scrollbar-size\);/s,
    )
    expect(styles).toMatch(
      /\.skills-tree-root::-webkit-scrollbar-thumb\s*\{[^}]*min-height:\s*32px;[^}]*border:\s*3px solid transparent;[^}]*border-radius:\s*999px;[^}]*background-color:\s*var\(--skills-tree-scrollbar-thumb\);[^}]*background-clip:\s*content-box;/s,
    )
    expect(styles).toMatch(
      /\.skills-tree-root::-webkit-scrollbar-thumb:active\s*\{[^}]*background-color:\s*var\(--skills-tree-scrollbar-thumb-active\);/s,
    )
    expect(styles).toMatch(
      /\.skills-tree-root::-webkit-scrollbar-corner\s*\{[^}]*background:\s*transparent;/s,
    )
  })

  it("keeps plugins marketplace scrollbars themed", () => {
    expect(styles).toMatch(
      /\.plugins-marketplace-content,\s*\.plugins-installed-list\s*\{[^}]*--plugins-scrollbar-size:\s*10px;[^}]*--plugins-scrollbar-thumb:\s*var\(--semantic-scrollbar-thumb-surface\);[^}]*--plugins-scrollbar-thumb-hover:\s*var\(--semantic-scrollbar-thumb-surface-hover\);[^}]*--plugins-scrollbar-thumb-active:\s*var\(--text-tertiary\);[^}]*--plugins-scrollbar-track:\s*transparent;[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*var\(--plugins-scrollbar-thumb\) var\(--plugins-scrollbar-track\);/s,
    )
    expect(styles).toMatch(
      /\.plugins-marketplace-content::-webkit-scrollbar,\s*\.plugins-installed-list::-webkit-scrollbar\s*\{[^}]*width:\s*var\(--plugins-scrollbar-size\);[^}]*height:\s*var\(--plugins-scrollbar-size\);/s,
    )
    expect(styles).toMatch(
      /\.plugins-marketplace-content::-webkit-scrollbar-thumb,\s*\.plugins-installed-list::-webkit-scrollbar-thumb\s*\{[^}]*min-height:\s*32px;[^}]*border:\s*3px solid transparent;[^}]*border-radius:\s*999px;[^}]*background-color:\s*var\(--plugins-scrollbar-thumb\);[^}]*background-clip:\s*content-box;/s,
    )
    expect(styles).toMatch(
      /\.plugins-marketplace-content::-webkit-scrollbar-thumb:active,\s*\.plugins-installed-list::-webkit-scrollbar-thumb:active\s*\{[^}]*background-color:\s*var\(--plugins-scrollbar-thumb-active\);/s,
    )
    expect(styles).toMatch(
      /\.plugins-marketplace-content::-webkit-scrollbar-corner,\s*\.plugins-installed-list::-webkit-scrollbar-corner\s*\{[^}]*background:\s*transparent;/s,
    )
  })

  it("wires plugin detail tags through plugin marketplace tokens", () => {
    expect(styles).toMatch(
      /\.plugins-tag-row \.settings-badge\s*\{[^}]*background:\s*var\(--semantic-plugin-market-tag-surface\);[^}]*color:\s*var\(--semantic-plugin-market-tag-text\);/s,
    )
  })

  it("wires the plugin URL import dialog through the popup panel semantic", () => {
    const dialogRule = styles.match(/\.plugins-import-url-dialog\s*\{[^}]*\}/s)?.[0] ?? ""

    expect(dialogRule).toContain("background: var(--semantic-popup-panel-surface);")
    expect(dialogRule).not.toContain("background: var(--seg-panel);")
    expect(dialogRule).not.toContain("background: var(--surface-panel);")
  })

  it("wires installed plugin row backgrounds through list-detail state tokens", () => {
    expect(styles).toMatch(
      /\.plugins-installed-item\s*\{[^}]*background:\s*var\(--semantic-list-detail-row-surface\);/s,
    )
    expect(styles).toMatch(
      /\.plugins-installed-item:hover,\s*\.plugins-installed-item:focus-visible\s*\{[^}]*background:\s*var\(--semantic-list-detail-row-surface-hover\);/s,
    )
    expect(styles).toMatch(
      /\.plugins-installed-item\.is-active\s*\{[^}]*background:\s*var\(--semantic-list-detail-row-surface-current\);/s,
    )
  })

  it("keeps calendar scrollbars aligned with the shared UI kit", () => {
    expect(styles).toMatch(
      /\.calendar-quick-add-dialog\s*\{[^}]*background:\s*var\(--semantic-popup-panel-surface\);/s,
    )
    expect(styles).toMatch(
      /\.calendar-page\s*\{[^}]*--calendar-scrollbar-size:\s*10px;[^}]*--calendar-scrollbar-thumb:\s*var\(--semantic-scrollbar-thumb-surface\);[^}]*--calendar-scrollbar-thumb-hover:\s*var\(--semantic-scrollbar-thumb-surface-hover\);[^}]*--calendar-scrollbar-thumb-active:\s*var\(--text-tertiary\);[^}]*--calendar-scrollbar-track:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.calendar-sources-panel,\s*\.calendar-detail-panel,\s*\.calendar-quick-add-overlay,\s*\.calendar-quick-add-dialog,\s*\.calendar-time-grid-wrap,\s*\.calendar-month-view,\s*\.calendar-month-day-items,\s*\.calendar-schedule-view\s*\{[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*var\(--calendar-scrollbar-thumb\) var\(--calendar-scrollbar-track\);/s,
    )
    expect(styles).toMatch(
      /\.calendar-sources-panel::-webkit-scrollbar-thumb,\s*\.calendar-detail-panel::-webkit-scrollbar-thumb,\s*\.calendar-quick-add-overlay::-webkit-scrollbar-thumb,\s*\.calendar-quick-add-dialog::-webkit-scrollbar-thumb,\s*\.calendar-time-grid-wrap::-webkit-scrollbar-thumb,\s*\.calendar-month-view::-webkit-scrollbar-thumb,\s*\.calendar-month-day-items::-webkit-scrollbar-thumb,\s*\.calendar-schedule-view::-webkit-scrollbar-thumb\s*\{[^}]*min-height:\s*32px;[^}]*border:\s*3px solid transparent;[^}]*border-radius:\s*999px;[^}]*background-color:\s*var\(--calendar-scrollbar-thumb\);[^}]*background-clip:\s*content-box;/s,
    )
    expect(styles).toMatch(
      /\.calendar-project-filter-menu\s*\{[^}]*overflow:\s*auto;[^}]*scrollbar-width:\s*none;/s,
    )
    expect(styles).toMatch(
      /\.calendar-project-filter-menu::-webkit-scrollbar\s*\{[^}]*width:\s*0;[^}]*height:\s*0;/s,
    )
  })

  it("lets the calendar top menu inherit the shell chrome surface", () => {
    expect(styles).toMatch(
      /\.calendar-page\s*\{[^}]*--calendar-top-surface:\s*var\(--top-chrome-surface,\s*var\(--seg-shell-chrome-surface,\s*var\(--surface-shell\)\)\);/s,
    )
    expect(styles).toMatch(/\.calendar-top-menu\s*\{[^}]*background:\s*var\(--calendar-top-surface\);/s)
  })

  it("lets the calendar structural regions inherit the shell surface", () => {
    expect(styles).toMatch(
      /\.calendar-page\s*\{[^}]*--calendar-shell-surface:\s*var\(--surface-shell\);[^}]*--calendar-grid-header-surface:\s*var\(--calendar-shell-surface\);/s,
    )
    expect(styles).toMatch(/\.calendar-toolbar\s*\{[^}]*background:\s*var\(--calendar-shell-surface\);/s)
    expect(styles).toMatch(
      /\.calendar-sources-panel,\s*\.calendar-detail-panel\s*\{[^}]*background:\s*var\(--calendar-shell-surface\);/s,
    )
    expect(styles).toMatch(
      /\.calendar-grid-corner,\s*\.calendar-day-header\s*\{[^}]*background:\s*var\(--calendar-grid-header-surface\);/s,
    )
  })

  it("lets the Skills workspace structural regions inherit the shell surface", () => {
    expect(styles).toMatch(
      /\.skills-workspace-page\s*\{[^}]*--skills-workspace-shell-surface:\s*var\(--surface-shell\);[^}]*background:\s*var\(--skills-workspace-shell-surface\);/s,
    )
    expect(styles).toMatch(
      /\.skills-workspace-toolbar\s*\{[^}]*background:\s*var\(--skills-workspace-shell-surface\);/s,
    )
    expect(styles).toMatch(
      /\.skills-workspace-content\s*\{[^}]*background:\s*var\(--skills-workspace-shell-surface\);/s,
    )
    expect(styles).toMatch(
      /\.skills-workspace-list-panel,\s*\.skills-workspace-detail-panel\s*\{[^}]*background:\s*var\(--skills-workspace-shell-surface\);/s,
    )
    expect(styles).toMatch(
      /\.global-skills-navigator\.is-unified\s*\{[^}]*background:\s*var\(--skills-workspace-shell-surface,\s*var\(--seg-shell\)\);/s,
    )
    expect(styles).toMatch(
      /\.global-skills-editor-shell\s*\{[^}]*background:\s*var\(--skills-workspace-shell-surface,\s*var\(--seg-panel\)\);/s,
    )
    expect(styles).toMatch(
      /\.global-skills-markdown-preview\s*\{[^}]*background:\s*var\(--skills-workspace-shell-surface,\s*var\(--seg-panel\)\);/s,
    )
  })

  it("lets sidebar-hosted skills and MCP pages use the full canvas width", () => {
    expect(styles).toMatch(
      /\.settings-page-main\.is-services\s+\.settings-services-layout\.global-skills-page-layout\.is-sidebar-hosted,\s*\.settings-page-main\.is-services\s+\.settings-services-layout\.mcp-servers-page-layout\.is-sidebar-hosted\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    )
  })

  it("keeps the global skills search row pinned to the top of the tree", () => {
    expect(styles).toMatch(/\.skills-tree-search-row\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s)
  })

  it("scopes provider scrolling to the column layout", () => {
    expect(styles).toMatch(/\.settings-page-main\.is-services\s*\{[^}]*overflow:\s*hidden;/s)
    expect(styles).toMatch(/\.settings-page-content,\s*\.settings-page-main\s*\{[^}]*scrollbar-gutter:\s*stable both-edges;/s)
    expect(styles).toMatch(
      /\.settings-page\s*\{[^}]*--settings-scrollbar-size:\s*10px;[^}]*--settings-scrollbar-thumb:\s*var\(--semantic-scrollbar-thumb-surface\);[^}]*--settings-scrollbar-thumb-hover:\s*var\(--semantic-scrollbar-thumb-surface-hover\);[^}]*--settings-scrollbar-thumb-active:\s*var\(--text-tertiary\);[^}]*--settings-scrollbar-track:\s*transparent;/s,
    )
    expect(styles).toMatch(
      /\.settings-page-overlay,\s*\.settings-page-nav,\s*\.settings-page-primary-nav,\s*\.settings-page-content,\s*\.settings-page-main,\s*\.settings-service-list,\s*\.settings-service-detail-panel\s*\{[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*var\(--settings-scrollbar-thumb\)\s+var\(--settings-scrollbar-track\);/s,
    )
    expect(styles).toMatch(
      /\.settings-page-overlay::-webkit-scrollbar-thumb,\s*\.settings-page-nav::-webkit-scrollbar-thumb,\s*\.settings-page-primary-nav::-webkit-scrollbar-thumb,\s*\.settings-page-content::-webkit-scrollbar-thumb,\s*\.settings-page-main::-webkit-scrollbar-thumb,\s*\.settings-service-list::-webkit-scrollbar-thumb,\s*\.settings-service-detail-panel::-webkit-scrollbar-thumb\s*\{[^}]*min-height:\s*32px;[^}]*border:\s*3px solid transparent;[^}]*border-radius:\s*999px;[^}]*background-color:\s*var\(--settings-scrollbar-thumb\);[^}]*background-clip:\s*content-box;/s,
    )
    expect(styles).toMatch(
      /\.settings-page-main\.is-services\s+\.settings-service-list\s*\{[^}]*scrollbar-color:\s*var\(--settings-scrollbar-thumb\)\s+var\(--settings-scrollbar-track\);/s,
    )
    expect(styles).not.toContain("#c9c9c9")
    expect(styles).toMatch(/\.toast-viewport\s*\{[^}]*position:\s*fixed;[^}]*top:\s*16px;[^}]*right:\s*48px;/s)
    expect(styles).not.toContain(".settings-toast-region")
    expect(styles).toMatch(/\.settings-service-list\s*\{[^}]*overflow:\s*auto;[^}]*scrollbar-gutter:\s*stable;/s)
    expect(styles).toMatch(/\.settings-service-detail-panel\s*\{[^}]*overflow:\s*auto;[^}]*scrollbar-gutter:\s*stable;/s)
    expect(styles).toMatch(/\.settings-page-main\.prompt-presets-page-main\s*\{[^}]*height:\s*100%;[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;/s)
    expect(styles).toMatch(/\.settings-page-main\.prompt-presets-page-main\s*>\s*\.settings-prompts-shell\s*\{[^}]*flex:\s*1 1 auto;[^}]*height:\s*auto;/s)
    expect(styles).toMatch(/\.settings-prompts-shell\s*\{[^}]*grid-template-columns:\s*320px\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*var\(--settings-document-width,\s*1120px\)\)\s*minmax\(0,\s*1fr\)\s*var\(--settings-document-side-panel-width,\s*clamp\(230px,\s*17vw,\s*300px\)\);[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\);[^}]*grid-template-areas:\s*"library \. detail \. slots";[^}]*gap:\s*18px 22px;/s)
    expect(styles).toMatch(/\.settings-prompts-shell\.is-sidebar-hosted\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*var\(--settings-document-width,\s*1120px\)\)\s*minmax\(0,\s*1fr\)\s*var\(--settings-document-side-panel-width,\s*clamp\(230px,\s*17vw,\s*300px\)\);[^}]*grid-template-areas:\s*"\. detail \. slots";/s)
    expect(styles).toMatch(/\.settings-prompt-assignment-select\s+\.settings-select-trigger\s*\{[^}]*min-height:\s*32px;[^}]*background:\s*transparent;/s)
    expect(styles).toMatch(/\.settings-prompt-assignment-select\s+\.settings-select-panel\s*\{[^}]*left:\s*0;[^}]*width:\s*max-content;[^}]*max-width:\s*calc\(100vw - 48px\);/s)
    expect(styles).toMatch(/\.settings-prompt-assignment-select\s+\.settings-select-option span\s*\{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-slots-panel\s*\{[^}]*align-self:\s*start;[^}]*padding:\s*4px 0 0;[^}]*border:\s*0;[^}]*border-bottom:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*gap:\s*12px;/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-list\s*\{[^}]*display:\s*grid;[^}]*gap:\s*10px;/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-row\s*\{[^}]*position:\s*relative;[^}]*padding:\s*10px 10px 11px 13px;[^}]*border:\s*1px solid var\(--semantic-settings-slot-card-list-item-border-default\);[^}]*background:\s*var\(--semantic-settings-slot-card-list-item-surface-default\);[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*gap:\s*8px;/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-row::before\s*\{[^}]*content:\s*"";[^}]*width:\s*2px;[^}]*background:\s*var\(--semantic-settings-slot-card-list-item-indicator-default\);/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-row:focus-within\s*\{[^}]*background:\s*var\(--semantic-settings-slot-card-list-item-surface-focus\);[^}]*box-shadow:\s*none;/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-row:focus-within::before\s*\{[^}]*background:\s*var\(--semantic-settings-slot-card-list-item-indicator-focus\);/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-row\s*\+\s*\.settings-prompt-assignment-row\s*\{[^}]*border:\s*1px solid var\(--semantic-settings-slot-card-list-item-border-default\);/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-control,\s*\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-actions,\s*\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-select\s*\{[^}]*width:\s*100%;/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main[\s\S]*?\.settings-prompt-assignment-select[\s\S]*?\.settings-select-trigger\s*\{[^}]*min-height:\s*20px;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-settings-slot-card-list-item-secondary-text-default\);/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main[\s\S]*?\.settings-prompt-assignment-select[\s\S]*?\.settings-select-trigger:focus-visible,[\s\S]*?\.settings-prompt-assignment-select\.is-open[\s\S]*?\.settings-select-trigger\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-settings-slot-card-list-action-text-focus\);[^}]*box-shadow:\s*none;/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-editor-header\s*\{[^}]*width:\s*min\(100%,\s*var\(--settings-document-width\)\);[^}]*justify-self:\s*center;/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-service-detail-panel\s*>\s*\.settings-prompt-editor-panel\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-editor,\s*\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-preview-surface\s*\{[^}]*width:\s*min\(100%,\s*var\(--settings-document-width\)\);[^}]*justify-self:\s*center;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-editor\s*\{[^}]*resize:\s*none;/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-editor:focus-visible\s*\{[^}]*background:\s*var\(--semantic-settings-slot-card-list-item-surface-focus\);[^}]*box-shadow:\s*none;[^}]*outline:\s*none;/s)
    expect(styles).toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-source-path\s*\{[^}]*width:\s*min\(100%,\s*var\(--settings-document-width\)\);[^}]*justify-self:\s*center;/s)
    expect(styles).not.toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-row\.is-open/)
    expect(styles).not.toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-row:focus-within\s*\{[^}]*border-color:\s*var\(--semantic-settings-slot-card-list-item-border-focus\)/s)
    expect(styles).not.toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-row:focus-within\s*\{[^}]*box-shadow:\s*inset/s)
    expect(styles).not.toMatch(/\.settings-page-main\.is-services\.prompt-presets-page-main\s+\.settings-prompt-assignment-row:focus-within\s*\{[^}]*outline:/s)
    expect(styles).not.toMatch(/\.settings-prompt-assignment-control select/)
  })

  it("keeps built-in tools as an open section instead of a framed panel", () => {
    expect(styles).toMatch(/\.builtin-tools-page\s*\{[^}]*--tools-obs-bg:\s*var\(--surface-shell\);/s)
    expect(styles).not.toMatch(/:root\[data-theme="dark"\]\s+\.builtin-tools-page\s*\{[^}]*--tools-obs-bg:/s)
    expect(styles).toMatch(/\.builtin-tools-page\s+\.tools-panel\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s)
    expect(styles).toMatch(/\.builtin-tools-page\s+\.tools-detail-header\s*\{[^}]*padding-top:\s*18px;[^}]*border-top:\s*1px solid var\(--tools-obs-border\);[^}]*border-bottom:\s*1px solid var\(--tools-obs-border\);/s)
    expect(styles).toMatch(/@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\.builtin-tools-page\s+\.tools-panel\s*\{[^}]*padding:\s*0;/s)
  })

  it("uses Obsidian-style grouped settings rows for standard settings pages", () => {
    expect(styles).toMatch(
      /\.settings-page-main:not\(\.is-services\):not\(\.prompt-presets-page-main\)\s*\{[^}]*justify-items:\s*start;[^}]*gap:\s*28px;/s,
    )
    expect(styles).toMatch(
      /\.settings-page-main:not\(\.is-services\):not\(\.prompt-presets-page-main\)\s+\.settings-field-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*gap:\s*0;/s,
    )
    expect(styles).toMatch(
      /\.settings-page-main:not\(\.is-services\):not\(\.prompt-presets-page-main\)\s+\.settings-field\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(220px,\s*320px\);[^}]*align-items:\s*center;/s,
    )
    expect(styles).toMatch(
      /\.settings-page-main:not\(\.is-services\):not\(\.prompt-presets-page-main\)\s+\.settings-actions-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;[^}]*align-items:\s*center;/s,
    )
    expect(styles).toMatch(
      /\.settings-page-main:not\(\.is-services\):not\(\.prompt-presets-page-main\)\s+\.provider-model-picker-panel\s*\{[^}]*right:\s*0;[^}]*left:\s*auto;[^}]*width:\s*min\(320px,\s*calc\(100vw - var\(--settings-nav-width\) - 112px\)\);/s,
    )
  })

  it("keeps the settings primary nav grouped and pill-led", () => {
    expect(styles).toMatch(/\.settings-page-close-button\s*\{[^}]*width:\s*32px;[^}]*min-width:\s*32px;[^}]*border:\s*1px solid transparent;[^}]*background:\s*transparent;[^}]*color:\s*var\(--semantic-icon-button-text\);/s)
    expect(styles).toMatch(/\.settings-page-close-button svg\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/s)
    expect(styles).toMatch(
      /\.settings-page-nav,\s*\.settings-page-primary-nav\s*\{[^}]*overflow:\s*auto;[^}]*scrollbar-gutter:\s*stable;[^}]*gap:\s*20px;/s,
    )
    expect(styles).toMatch(/\.settings-page\s*\{[^}]*background:\s*var\(--semantic-popup-panel-surface\);/s)
    expect(styles).toMatch(
      /\.settings-page-nav,\s*\.settings-page-primary-nav\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--seg-text-1\);/s,
    )
    expect(styles).toMatch(/\.settings-primary-nav-group-label,[\s\S]*?\.settings-helper-text,[\s\S]*?\.settings-page-copy,[\s\S]*?\.settings-section-header p,[\s\S]*?\.provider-row-copy,[\s\S]*?\.provider-model-empty,[\s\S]*?\.settings-toggle-copy small\s*\{[^}]*color:\s*var\(--seg-text-3\);/s)
    expect(styles).toMatch(
      /\.settings-primary-nav-item\s*\{[^}]*border:\s*1px solid transparent;[^}]*border-radius:\s*12px;[^}]*background:\s*var\(--semantic-list-detail-row-surface\);[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\);/s,
    )
    expect(styles).toMatch(
      /\.settings-primary-nav-item:hover,\s*\.settings-primary-nav-item:focus-visible\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--semantic-list-detail-row-surface-hover\);[^}]*color:\s*var\(--semantic-list-detail-row-primary-text\);/s,
    )
    expect(styles).toMatch(
      /\.settings-primary-nav-item\.is-active\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--semantic-list-detail-row-surface-current\);[^}]*color:\s*var\(--semantic-list-detail-row-current-text\);/s,
    )
  })
})
