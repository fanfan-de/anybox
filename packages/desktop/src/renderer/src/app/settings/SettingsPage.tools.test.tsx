import { fireEvent, render as testingLibraryRender, screen, waitFor, within } from "@testing-library/react"
import type { ComponentProps, ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { APPEARANCE_TOKEN_NAMES } from "../../../../shared/appearance"
import { parseAppearanceColorLiteral } from "../../../../shared/appearance-color"
import type { AppearanceTheme } from "../../../../shared/appearance-themes"
import type { DesktopAppUpdateState, DesktopStorageUsageSnapshot } from "../../../../shared/desktop-ipc-contract"
import { I18nProvider } from "../i18n/I18nProvider"
import { DEFAULT_HTML_BACKGROUND_CONFIG } from "../html-background/html-background-config"
import { DEFAULT_ASSISTANT_TRACE_VISIBILITY, type McpServerDraftState } from "../types"
import { ToastProvider } from "../toast"
import { SettingsPage } from "./SettingsPage"

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,SUBSCRIPTION_QR"),
  },
}))

function render(element: ReactElement) {
  return testingLibraryRender(element, {
    wrapper: ({ children }) => <ToastProvider>{children}</ToastProvider>,
  })
}

function setDesktopMock(value: unknown) {
  Object.defineProperty(window, "desktop", {
    configurable: true,
    writable: true,
    value,
  })
}

function createMcpDraft(): McpServerDraftState {
  return {
    id: "",
    name: "",
    transport: "stdio",
    command: "",
    args: "",
    env: "",
    cwd: "",
    serverUrl: "",
    connectorId: "",
    authorization: "",
    headers: "",
    allowedToolsMode: "all",
    allowedToolNames: "",
    toolPolicies: {},
    enabled: true,
    timeoutMs: "",
  }
}

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

function createAppearanceTokenValues(
  value = "#000000",
): ComponentProps<typeof SettingsPage>["appearanceTokenValues"] {
  return Object.fromEntries(APPEARANCE_TOKEN_NAMES.map((tokenName) => [tokenName, value])) as ComponentProps<
    typeof SettingsPage
  >["appearanceTokenValues"]
}

function colorLiteral(value: string) {
  const literal = parseAppearanceColorLiteral(value)
  if (!literal) throw new Error(`Invalid test color: ${value}`)
  return literal
}

function createAppearanceTheme(overrides: Partial<AppearanceTheme> = {}): AppearanceTheme {
  return {
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
    htmlBackgroundConfig: DEFAULT_HTML_BACKGROUND_CONFIG,
    overrides: {},
    foreignDtcg: {},
    ...overrides,
  }
}

function selectSettingsOption(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }))
  fireEvent.click(within(screen.getByRole("listbox", { name: label })).getByRole("option", { name: option }))
}

function openAccountSettingsTab(name: "Overview" | "Subscription & credits" | "Balance & recharge") {
  fireEvent.click(screen.getByRole("button", { name: "Account" }))
  fireEvent.click(screen.getByRole("tab", { name }))
}

function createSettingsPageProps(
  overrides: Partial<ComponentProps<typeof SettingsPage>> = {},
): ComponentProps<typeof SettingsPage> {
  return {
    activeMcpServerDiagnostic: null,
    activeMcpServerID: null,
    appearanceConfigError: null,
    appearanceConfigPath: null,
    appearanceConfigPreview: "{}",
    appearanceOverrides: {},
    appearanceTokenValues: createAppearanceTokenValues(),
    archivedSessions: [],
    archivedSessionsError: null,
    storageUsage: null,
    storageUsageError: null,
    storageOptimizeMessage: null,
    assistantTraceVisibility: DEFAULT_ASSISTANT_TRACE_VISIBILITY,
    catalog: [],
    cinemaVideoProviders: [],
    cinemaProviderWorkflowCatalogs: {},
    cinemaWorkflowCatalogError: null,
    colorMode: "system",
    fontFamily: "default",
    htmlBackgroundConfig: DEFAULT_HTML_BACKGROUND_CONFIG,
    deletingArchivedSessionID: null,
    deletingMcpServerID: null,
    deletingProviderID: null,
    isActivityRailVisible: true,
    isAgentDebugTraceEnabled: false,
    isDebugLineColorsEnabled: false,
    isDebugUiRegionsEnabled: false,
    isMobileConnectionAdvancedInfoEnabled: false,
    isDeletingAllArchivedSessions: false,
    isLoading: false,
    isLoadingArchivedSessions: false,
    isLoadingStorageUsage: false,
    isOptimizingStorage: false,
    isOpen: true,
    appUpdateState: createAppUpdateState(),
    appUpdateStatus: null,
    isCheckingAppUpdate: false,
    isSavingAutomaticUpdates: false,
    isRefreshingProviderCatalog: false,
    isRefreshingCinemaVideoProviderCatalog: false,
    refreshingCinemaWorkflowProviderID: null,
    loadError: null,
    mcpServerDraft: createMcpDraft(),
    mcpServers: [],
    modelCatalog: [],
    models: [],
    customProviderDraft: {
      apiBaseURL: "",
      apiKey: "",
      defaultModel: "",
      chatEndpoint: "/chat/completions",
    },
    onActivityRailVisibilityChange: vi.fn(),
    onAgentDebugTraceChange: vi.fn(),
    onAppearancePaletteReset: vi.fn(),
    onAppearanceTokenChange: vi.fn(),
    onAppearanceTokenReset: vi.fn(),
    onAutomaticUpdatesToggle: vi.fn(),
    onAssistantTraceVisibilityChange: vi.fn(),
    onCancelProviderAuthFlow: vi.fn(),
    onCustomProviderDraftChange: vi.fn(),
    onCustomProviderDraftReset: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onClose: vi.fn(),
    onColorModeChange: vi.fn(),
    onFontFamilyChange: vi.fn(),
    onHtmlBackgroundConfigChange: vi.fn(),
    onDebugLineColorsChange: vi.fn(),
    onDebugUiRegionsChange: vi.fn(),
    onMobileConnectionAdvancedInfoChange: vi.fn(),
    onDeleteAllArchivedSessions: vi.fn(),
    onDeleteArchivedSession: vi.fn(),
    onDeleteMcpServer: vi.fn(),
    onDeleteProvider: vi.fn(),
    onDeleteProviderAuthSession: vi.fn(),
    onCinemaVideoProviderDraftChange: vi.fn(),
    onMcpServerDraftChange: vi.fn(),
    onMcpToolPolicyChange: vi.fn(),
    onMcpServerSelect: vi.fn(),
    onLoadArchivedSessions: vi.fn(),
    onLoadStorageUsage: vi.fn(),
    onOptimizeStorage: vi.fn(),
    onOpenUpdateCenter: vi.fn(),
    onRefreshProviderCatalog: vi.fn(),
    onRefreshCinemaVideoProviderCatalog: vi.fn(),
    onRefreshCinemaProviderWorkflows: vi.fn(),
    onRestoreArchivedSession: vi.fn(),
    onSaveMcpServer: vi.fn(),
    onSaveCustomProvider: vi.fn(),
    onSaveCinemaVideoProviderApiKey: vi.fn(),
    onSaveProvider: vi.fn(),
    onSaveProviderApiKey: vi.fn(),
    onSelectionChange: vi.fn(),
    onStartNewMcpServer: vi.fn(),
    onStartProviderAuthFlow: vi.fn(),
    onTestCinemaVideoProviderConnection: vi.fn(),
    onTestCustomProviderConnection: vi.fn(),
    onTestProviderConnection: vi.fn(),
    providerDrafts: {},
    cinemaVideoProviderDrafts: {},
    restoringArchivedSessionID: null,
    savingMcpServerID: null,
    savingProviderID: null,
    savingCinemaVideoProviderID: null,
    selectionDraft: {
      model: null,
      smallModel: null,
      reasoningEffort: null,
      imageModel: null,
      imageDefaultSize: null,
      imageDefaultCount: null,
    },
    ...overrides,
  } as ComponentProps<typeof SettingsPage>
}

function createProvider(id: string, name: string): ComponentProps<typeof SettingsPage>["catalog"][number] {
  return {
    id,
    name,
    source: "config",
    env: [],
    configured: true,
    available: true,
    apiKeyConfigured: true,
    modelCount: 1,
    authCapabilities: [],
    authScope: "global",
    authState: {
      providerID: id,
      scope: "global",
      status: "connected",
      capabilities: [],
      credentials: [],
    },
  }
}

function createCinemaVideoProvider(
  id: string,
  name: string,
  connected = false,
): ComponentProps<typeof SettingsPage>["cinemaVideoProviders"][number] {
  return {
    manifest: {
      id,
      name,
      description: `${name} video provider`,
      credentialProviderID: `cinema-${id}`,
      requiresCredential: true,
      regions: [],
      connectionTest: {
        method: "GET",
        path: "/v1/models",
        auth: "bearer",
        headers: {},
        expectedStatus: [200],
        timeoutMs: 10000,
      },
      models: [
        {
          id: `${id}-model`,
          label: `${name} Model`,
          modes: ["text-to-video"],
          inputCombinations: [
            {
              mode: "text-to-video",
              label: "Text to video",
              requiredModalities: ["text"],
              optionalModalities: [],
              requirements: [],
              endpoint: {
                method: "POST",
                path: "/text-to-video/test",
              },
              inputs: [
                {
                  role: "prompt",
                  modality: "text",
                  required: true,
                  minCount: 1,
                  maxCount: 1,
                },
              ],
            },
          ],
          durations: [],
          aspectRatios: [],
          resolutions: [],
          pricing: [],
          formSpecs: [],
          parameterSchema: {},
        },
      ],
    },
    auth: {
      providerID: id,
      credentialProviderID: `cinema-${id}`,
      requiresCredential: true,
      connected,
      status: connected ? "connected" : "not_connected",
    },
    runtime: {
      baseURL: "https://api-singapore.klingai.com",
      baseURLSource: "default",
      adapterAvailable: true,
    },
  }
}

type SettingsProvider = ComponentProps<typeof SettingsPage>["catalog"][number]

type SettingsProviderOverrides = Omit<Partial<SettingsProvider>, "authCapabilities" | "authState"> & {
  authCapabilities?: SettingsProvider["authCapabilities"]
  authState?: Partial<SettingsProvider["authState"]>
}

function createAnyboxProvider(overrides: SettingsProviderOverrides = {}): SettingsProvider {
  const authCapabilities = overrides.authCapabilities ?? [
    {
      method: "anybox-browser",
      label: "Anybox",
      kind: "browser_oauth" as const,
      recommended: true,
      supportsDisconnect: true,
      supportsPolling: true,
    },
  ]
  const base = createProvider("anybox", "Anybox")

  return {
    ...base,
    ...overrides,
    apiKeyConfigured: false,
    authCapabilities,
    authState: {
      ...base.authState,
      activeMethod: "anybox-browser",
      capabilities: authCapabilities,
      credentials: [],
      status: "not_connected",
      ...overrides.authState,
    },
  }
}

function createModel(
  providerID: string,
  id: string,
  name: string,
  input?: {
    family?: string
    imageOutput?: boolean
    reasoning?: boolean
  },
): ComponentProps<typeof SettingsPage>["models"][number] {
  return {
    id,
    providerID,
    name,
    family: input?.family,
    status: "active",
    available: true,
    capabilities: {
      temperature: true,
      reasoning: input?.reasoning ?? false,
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
        image: input?.imageOutput ?? false,
        video: false,
        pdf: false,
      },
    },
    limit: {
      context: 128000,
      output: 8192,
    },
  }
}

function createModelCatalogItem(
  providerID: string,
  modelID: string,
  name: string,
  providerName: string,
  overrides: Partial<ComponentProps<typeof SettingsPage>["modelCatalog"][number]> = {},
): ComponentProps<typeof SettingsPage>["modelCatalog"][number] {
  return {
    registryID: `${providerID}/${modelID}`,
    providerID,
    modelID,
    name,
    providerName,
    runtimeKind: "ai-sdk",
    selectable: false,
    available: false,
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
      taskModes: [],
    },
    status: "active",
    source: "provider",
    ...overrides,
  }
}

function createArchivedSession(
  overrides: Partial<ComponentProps<typeof SettingsPage>["archivedSessions"][number]> = {},
): ComponentProps<typeof SettingsPage>["archivedSessions"][number] {
  return {
    id: "session-archived-1",
    projectID: "project-1",
    projectName: "Project One",
    projectMissing: false,
    directory: "C:\\Projects\\project-one",
    title: "Project analysis",
    created: 1,
    updated: 2,
    archivedAt: 3,
    messageCount: 4,
    eventCount: 5,
    ...overrides,
  }
}

function createStorageUsageSnapshot(overrides: Partial<DesktopStorageUsageSnapshot> = {}): DesktopStorageUsageSnapshot {
  return {
    generatedAt: 2,
    database: {
      path: "C:\\Users\\tester\\AppData\\Roaming\\Anybox\\agent\\data\\database\\agent_local_data.db",
      totalBytes: 120 * 1024 * 1024,
      mainBytes: 90 * 1024 * 1024,
      walBytes: 28 * 1024 * 1024,
      shmBytes: 2 * 1024 * 1024,
      pageSize: 4096,
      pageCount: 30720,
      freelistBytes: 8 * 1024 * 1024,
    },
    categories: [
      {
        id: "archivedSessions",
        label: "Archived sessions",
        bytes: 12 * 1024 * 1024,
        approximate: true,
        count: 3,
      },
      {
        id: "activeSessions",
        label: "Active sessions",
        bytes: 20 * 1024 * 1024,
        approximate: true,
        count: 2,
      },
      {
        id: "otherDatabase",
        label: "Other database",
        bytes: 4 * 1024 * 1024,
        approximate: true,
        count: 12,
      },
      {
        id: "sqliteOverhead",
        label: "SQLite overhead",
        bytes: 84 * 1024 * 1024,
        approximate: true,
      },
    ],
    archivedSessions: [
      {
        id: "session-archived-large",
        title: "Large archived image thread",
        projectID: "project-1",
        projectName: "Project One",
        directory: "C:\\Projects\\project-one",
        updated: 1,
        archivedAt: 2,
        messageCount: 7,
        eventCount: 80,
        estimatedBytes: 10 * 1024 * 1024,
      },
    ],
    tables: [
      {
        name: "archived_sessions",
        category: "archivedSessions",
        rowCount: 3,
        estimatedBytes: 12 * 1024 * 1024,
      },
      {
        name: "session_events",
        category: "activeSessions",
        rowCount: 40,
        estimatedBytes: 8 * 1024 * 1024,
      },
    ],
    trace: {
      count: 40,
      estimatedBytes: 128 * 1024,
      earliestTimestamp: 1,
      retentionDays: 30,
    },
    toolArtifacts: {
      fileCount: 3,
      bytes: 6 * 1024 * 1024,
    },
    maintenance: {
      status: "idle",
      reclaimableBytes: 8 * 1024 * 1024,
    },
    ...overrides,
  }
}

describe("SettingsPage built-in tools", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    delete (window as typeof window & { desktop?: unknown }).desktop
  })

  it("renders about update controls and saves the automatic update setting", async () => {
    const onAutomaticUpdatesToggle = vi.fn()
    const onCheckForUpdates = vi.fn()

    render(<SettingsPage {...createSettingsPageProps({ onAutomaticUpdatesToggle, onCheckForUpdates })} />)

    expect(screen.getByText("Version 1.2.3")).toBeInTheDocument()
    expect(screen.queryByText("Installer version: 1.2.3")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Read release notes" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument()

    const automaticUpdatesSwitch = screen.getByRole("switch", { name: /Automatic updates/i })
    expect(automaticUpdatesSwitch).toHaveAttribute("aria-checked", "true")

    fireEvent.click(automaticUpdatesSwitch)
    expect(onAutomaticUpdatesToggle).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1)
  })

  it("does not expose a duplicate dedicated updates settings section", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    expect(screen.queryByRole("button", { name: "Updates" })).not.toBeInTheDocument()
    expect(screen.getByText("Version 1.2.3")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: /Automatic updates/i })).toBeInTheDocument()
  })

  it("routes downloaded update entry points to the global update center", () => {
    const onOpenUpdateCenter = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          appUpdateState: createAppUpdateState({
            phase: "downloaded",
            latestVersion: "1.2.4",
            downloadPercent: 100,
            lastCheckedAt: 1,
            releaseNotes: "Improved update experience.",
          }),
          onOpenUpdateCenter,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /Open update center/i }))
    expect(onOpenUpdateCenter).toHaveBeenCalledTimes(1)
  })

  it("scrolls the active settings section back to the top when its nav item is clicked again", () => {
    const { container } = render(<SettingsPage {...createSettingsPageProps()} />)
    const overlay = container.querySelector(".settings-page-overlay") as HTMLElement | null
    const mainPanel = container.querySelector(".settings-page-main") as HTMLDivElement | null
    expect(overlay).not.toBeNull()
    expect(mainPanel).not.toBeNull()

    overlay!.scrollTop = 80
    mainPanel!.scrollTop = 120
    fireEvent.click(screen.getByRole("button", { name: "General" }))

    expect(overlay!.scrollTop).toBe(0)
    expect(mainPanel!.scrollTop).toBe(0)
  })

  it("does not render a settings-local toast region", () => {
    const { container } = render(<SettingsPage {...createSettingsPageProps()} />)

    expect(container.querySelector(".settings-toast-region")).toBeNull()
    expect(screen.queryByRole("button", { name: "Dismiss settings message" })).not.toBeInTheDocument()
  })

  it("does not render built-in tools inside settings", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    expect(screen.queryByRole("button", { name: "Tools" })).not.toBeInTheDocument()
    expect(screen.queryByText("Global tool availability")).not.toBeInTheDocument()
  })

  it("does not render worktrees inside settings", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    expect(screen.queryByRole("button", { name: "Worktrees" })).not.toBeInTheDocument()
    expect(screen.queryByText("Tracked Worktrees")).not.toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Project worktrees" })).not.toBeInTheDocument()
  })

  it("shows all provider sources behind capability filters", () => {
    render(<SettingsPage {...createSettingsPageProps({ catalog: [createAnyboxProvider()] })} />)

    const nav = screen.getByLabelText("Settings sections")
    const labels = within(nav).getAllByRole("button").map((button) => button.textContent)

    expect(labels.slice(0, 5)).toEqual(["General", "Account", "Provider", "Models", "Appearance"])
    expect(screen.queryByRole("button", { name: "Generation Providers" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))
    const providerFilters = screen.getByRole("radiogroup", { name: "Filter providers" })
    expect(within(providerFilters).getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true")
    expect(within(providerFilters).getByRole("radio", { name: "Text" })).toBeInTheDocument()
    expect(within(providerFilters).getByRole("radio", { name: "Image" })).toBeInTheDocument()
    expect(within(providerFilters).getByRole("radio", { name: "Video" })).toBeInTheDocument()
    expect(within(providerFilters).getByRole("radio", { name: "Connected" })).toBeInTheDocument()
  })

  it("shows catalog models for an unconfigured provider as read-only", async () => {
    const provider = {
      ...createProvider("anyapi", "AnyAPI"),
      source: "api" as const,
      env: ["ANYAPI_API_KEY"],
      configured: false,
      available: false,
      apiKeyConfigured: false,
      modelCount: 1,
      authState: {
        providerID: "anyapi",
        scope: "global" as const,
        status: "not_connected" as const,
        capabilities: [],
        credentials: [],
      },
    }
    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [provider],
          models: [],
          modelCatalog: [
            createModelCatalogItem("anyapi", "anyapi-chat", "AnyAPI Chat", "AnyAPI"),
          ],
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))

    await waitFor(() => expect(screen.getByRole("heading", { name: "AnyAPI" })).toBeInTheDocument())
    expect(screen.getByRole("heading", { name: "AnyAPI Chat" })).toBeInTheDocument()
    expect(screen.getAllByText("Read only").length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole("radio", { name: "Text" }))
    expect(screen.getByRole("button", { name: /AnyAPI.*Not connected/ })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "AnyAPI Chat" })).toBeInTheDocument()
  })

  it("saves cinema video provider API keys from the video provider filter", async () => {
    const onCinemaVideoProviderDraftChange = vi.fn()
    const onSaveCinemaVideoProviderApiKey = vi.fn()
    const onTestCinemaVideoProviderConnection = vi.fn()
    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createProvider("deepseek", "DeepSeek")],
          cinemaVideoProviders: [createCinemaVideoProvider("kling", "Kling AI")],
          cinemaVideoProviderDrafts: {
            kling: { apiKey: "kling-test-key", baseURL: "" },
          },
          onCinemaVideoProviderDraftChange,
          onSaveCinemaVideoProviderApiKey,
          onTestCinemaVideoProviderConnection,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))
    fireEvent.click(screen.getByRole("radio", { name: "Video" }))

    expect(screen.getByRole("list", { name: "Provider list" })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("heading", { name: "Kling AI" })).toBeInTheDocument())
    expect(screen.getByText("Current endpoint")).toBeInTheDocument()
    expect(screen.getByText("https://api-singapore.klingai.com")).toBeInTheDocument()
    expect(screen.getByText("Default endpoint")).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Endpoint for Kling AI"), {
      target: { value: "https://kling-proxy.example.com" },
    })
    fireEvent.change(screen.getByLabelText("Credential for Kling AI"), {
      target: { value: "kling-updated-key" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }))
    fireEvent.click(screen.getByRole("button", { name: "Save Kling AI settings" }))

    expect(onCinemaVideoProviderDraftChange).toHaveBeenCalledWith("kling", "baseURL", "https://kling-proxy.example.com")
    expect(onCinemaVideoProviderDraftChange).toHaveBeenCalledWith("kling", "apiKey", "kling-updated-key")
    expect(onTestCinemaVideoProviderConnection).toHaveBeenCalledWith("kling")
    expect(onSaveCinemaVideoProviderApiKey).toHaveBeenCalledWith("kling")
  })

  it("discovers Local ComfyUI APP workflows and supports user selection and refresh", async () => {
    const onCinemaVideoProviderDraftChange = vi.fn()
    const onSaveCinemaVideoProviderApiKey = vi.fn()
    const onTestCinemaVideoProviderConnection = vi.fn()
    const onRefreshCinemaProviderWorkflows = vi.fn()
    const comfyUIProvider = createCinemaVideoProvider("comfyui-local", "Local ComfyUI", true)
    comfyUIProvider.manifest.authType = "none"
    comfyUIProvider.manifest.requiresCredential = false
    comfyUIProvider.manifest.capabilities = {
      workflowDiscovery: true,
      appMode: true,
    }
    comfyUIProvider.manifest.models = []
    comfyUIProvider.manifest.connectionTest = {
      ...comfyUIProvider.manifest.connectionTest!,
      path: "/system_stats",
      auth: "none",
    }
    comfyUIProvider.auth = {
      ...comfyUIProvider.auth,
      requiresCredential: false,
      connected: true,
      status: "connected",
    }
    comfyUIProvider.runtime = {
      ...comfyUIProvider.runtime,
      adapterAvailable: true,
      baseURL: "http://127.0.0.1:8188",
      baseURLSource: "default",
      userID: "alice",
    }

    render(
      <SettingsPage
        {...createSettingsPageProps({
          cinemaVideoProviders: [comfyUIProvider],
          cinemaVideoProviderDrafts: {
            "comfyui-local": { apiKey: "", baseURL: "http://localhost:8188", userID: "alice" },
          },
          cinemaVideoProviderConnectionResults: {
            "comfyui-local": {
              providerID: "comfyui-local",
              ok: true,
              status: "ready",
              checkedAt: Date.now(),
              message: "Local ComfyUI is reachable; discovered 2 workflows, 1 ready.",
              diagnostics: {
                service: "reachable",
                userData: "ready",
                nodes: "ready",
                workflowDiscovery: "ready",
              },
            },
          },
          cinemaProviderWorkflowCatalogs: {
            "comfyui-local": {
              providerID: "comfyui-local",
              status: "ready",
              userID: "alice",
              users: [
                { id: "alice", name: "Alice" },
                { id: "bob", name: "Bob" },
              ],
              workflows: [
                {
                  workflowID: "workflow-image",
                  revision: "sha256:0123456789abcdef",
                  name: "Product image",
                  status: "ready",
                  issues: [],
                  dependencies: [],
                  output: { kind: "image", nodeIDs: ["9"] },
                  formSpec: {
                    providerID: "comfyui-local",
                    target: {
                      kind: "workflow",
                      workflowID: "workflow-image",
                      revision: "sha256:0123456789abcdef",
                    },
                    mode: "text-to-image",
                    output: "image",
                    controls: [],
                  },
                  source: {
                    userID: "alice",
                    path: "workflows/products/image.json",
                    sizeBytes: 2048,
                    workflowFormat: "1.0",
                    converter: "builtin",
                  },
                  discoveredAt: "2026-07-24T08:00:00.000Z",
                },
                {
                  workflowID: "workflow-video",
                  revision: "sha256:fedcba9876543210",
                  name: "Campaign video",
                  status: "disabled",
                  issues: [{
                    code: "COMFYUI_MODEL_MISSING",
                    message: "Missing model: campaign-video.safetensors",
                    dependency: "campaign-video.safetensors",
                    severity: "error",
                  }],
                  dependencies: [{
                    kind: "model",
                    name: "campaign-video.safetensors",
                    available: false,
                    folder: "checkpoints",
                  }],
                  output: { kind: "video", nodeIDs: ["17"] },
                  source: {
                    userID: "alice",
                    path: "workflows/campaign/video.json",
                    sizeBytes: 4096,
                    workflowFormat: "0.4",
                    converter: "builtin",
                  },
                  discoveredAt: "2026-07-24T08:00:00.000Z",
                },
              ],
              issues: [],
              refreshedAt: "2026-07-24T08:00:00.000Z",
              lastSuccessfulRefreshAt: "2026-07-24T08:00:00.000Z",
              limits: {
                maxWorkflows: 500,
                maxFileBytes: 8 * 1024 * 1024,
                maxTotalBytes: 64 * 1024 * 1024,
                readConcurrency: 4,
              },
            },
          },
          initialCinemaVideoProviderID: "comfyui-local",
          onCinemaVideoProviderDraftChange,
          onRefreshCinemaProviderWorkflows,
          onSaveCinemaVideoProviderApiKey,
          onTestCinemaVideoProviderConnection,
        })}
      />,
    )

    await waitFor(() => expect(screen.getByRole("heading", { name: "Local ComfyUI" })).toBeInTheDocument())
    expect(screen.getAllByText(/No authentication required/).length).toBeGreaterThan(0)
    expect(screen.queryByLabelText("Credential for Local ComfyUI")).toBeNull()
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull()
    expect(screen.getByText("Service")).toBeInTheDocument()
    expect(screen.getByText("User data")).toBeInTheDocument()
    expect(screen.getByText("Nodes")).toBeInTheDocument()
    expect(screen.getByText("Workflow discovery")).toBeInTheDocument()
    expect(screen.getByText("Discovered workflows")).toBeInTheDocument()
    expect(screen.getByText("Product image")).toBeInTheDocument()
    expect(screen.getByText("Campaign video")).toBeInTheDocument()
    expect(screen.getByText(/workflows\/products\/image\.json/)).toBeInTheDocument()
    expect(screen.getByText("Missing model: campaign-video.safetensors")).toBeInTheDocument()

    fireEvent.change(screen.getByRole("combobox", { name: "ComfyUI user" }), {
      target: { value: "bob" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Refresh workflows" }))

    fireEvent.change(screen.getByLabelText("Endpoint for Local ComfyUI"), {
      target: { value: "http://localhost:8288" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }))
    fireEvent.click(screen.getByRole("button", { name: "Save Local ComfyUI settings" }))

    expect(onCinemaVideoProviderDraftChange).toHaveBeenCalledWith(
      "comfyui-local",
      "baseURL",
      "http://localhost:8288",
    )
    expect(onCinemaVideoProviderDraftChange).toHaveBeenCalledWith("comfyui-local", "userID", "bob")
    expect(onRefreshCinemaProviderWorkflows).toHaveBeenCalledWith("comfyui-local")
    expect(onTestCinemaVideoProviderConnection).toHaveBeenCalledWith("comfyui-local")
    expect(onSaveCinemaVideoProviderApiKey).toHaveBeenCalledWith("comfyui-local")
  })

  it("uses the Anybox account page as the browser OAuth login entry", () => {
    const onStartProviderAuthFlow = vi.fn()
    const { container } = render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createAnyboxProvider()],
          onStartProviderAuthFlow,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Account" }))

    expect(screen.getByText("Not logged in")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Log in to Anybox" })).toBeInTheDocument()
    expect(container.querySelector('input[type="password"]')).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Log in to Anybox" }))
    expect(onStartProviderAuthFlow).toHaveBeenCalledWith("anybox", { prompt: "select_account" })
  })

  it("shows a cancellable pending Anybox account flow", () => {
    const onCancelProviderAuthFlow = vi.fn()
    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [
            createAnyboxProvider({
              authState: {
                status: "pending",
                flow: {
                  id: "flow-1",
                  providerID: "anybox",
                  method: "anybox-browser",
                  kind: "browser_oauth",
                  status: "waiting_user",
                  startedAt: 1,
                  updatedAt: 2,
                  authorizationURL: "https://provider.example/oauth",
                },
              },
            }),
          ],
          onCancelProviderAuthFlow,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Account" }))

    expect(screen.getByText("Waiting for browser login")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onCancelProviderAuthFlow).toHaveBeenCalledWith("anybox")
  })

  it("shows connected Anybox account details and signs out from the account page", async () => {
    const onDeleteProviderAuthSession = vi.fn()
    const openExternalUrl = vi.fn().mockResolvedValue({ ok: true, url: "https://provider.example/billing" })
    setDesktopMock({
      openExternalUrl,
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue({
        connected: true,
        balanceMicrocents: 250000000,
        currency: "CNY",
        subscription: {
          status: "active",
          planCode: "pro",
          planName: "Pro",
        },
        limits: [],
        plans: [],
      }),
    })

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [
            createAnyboxProvider({
              authState: {
                status: "connected",
                account: {
                  email: "agent@example.com",
                  workspaceName: "Studio",
                  planType: "pro",
                  planLabel: "Pro",
                  subscription: {
                    planCode: "pro",
                    status: "active",
                    source: "system_migration",
                    cancelAtPeriodEnd: false,
                  },
                  entitlements: {
                    modelGatewayEnabled: true,
                    relayEnabled: true,
                    maxDesktopDevices: 3,
                    maxMobileDevices: 5,
                  },
                  balanceMicrocents: 250000000,
                  currency: "CNY",
                  rechargeUrl: "https://provider.example/billing",
                },
                credentials: [
                  {
                    method: "anybox-browser",
                    kind: "oauth_session",
                    source: "credential_store",
                    configured: true,
                  },
                ],
              },
            }),
          ],
          onDeleteProviderAuthSession,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Account" }))

    expect(screen.getByText("Logged in")).toBeInTheDocument()
    expect(screen.getByText("agent@example.com")).toBeInTheDocument()
    expect(screen.getByText("Studio")).toBeInTheDocument()
    expect(await screen.findByText("Pro")).toBeInTheDocument()
    expect(screen.getByText(/2\.50/, {
      selector: ".settings-subscription-overview-balance-copy strong",
    })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "provider.anybox.com.cn" }))
    expect(openExternalUrl).toHaveBeenCalledWith({ url: "https://provider.anybox.com.cn/app/dashboard" })

    fireEvent.click(screen.getByRole("button", { name: "www.anybox.com.cn" }))
    expect(openExternalUrl).toHaveBeenCalledWith({ url: "https://www.anybox.com.cn" })

    fireEvent.click(screen.getByRole("button", { name: "Recharge" }))
    expect(screen.getByRole("tab", { name: "Balance & recharge" })).toHaveAttribute("aria-selected", "true")
    expect(await screen.findByRole("heading", { name: "Add prepaid balance" })).toBeInTheDocument()
    expect(openExternalUrl).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    expect(onDeleteProviderAuthSession).toHaveBeenCalledWith("anybox")
  })

  it("keeps recharge inside the unified account page when the provider has no recharge URL", async () => {
    const openExternalUrl = vi.fn()
    setDesktopMock({
      openExternalUrl,
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue({
        connected: true,
        balanceMicrocents: 0,
        currency: "CNY",
        subscription: null,
        limits: [],
        plans: [],
      }),
    })

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [
            createAnyboxProvider({
              baseURL: "https://anybox.com.cn/v1",
              authState: {
                status: "connected",
                account: {
                  email: "agent@example.com",
                  workspaceName: "Studio",
                },
              },
            }),
          ],
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Account" }))
    fireEvent.click(screen.getByRole("button", { name: "Recharge" }))

    expect(screen.getByRole("tab", { name: "Balance & recharge" })).toHaveAttribute("aria-selected", "true")
    expect(await screen.findByRole("heading", { name: "Add prepaid balance" })).toBeInTheDocument()
    expect(openExternalUrl).not.toHaveBeenCalled()
  })

  it("moves Anybox provider browser login controls to the Account page", () => {
    const onStartProviderAuthFlow = vi.fn()
    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createAnyboxProvider()],
          onStartProviderAuthFlow,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))

    expect(screen.getByText("Anybox login is managed by the Account page. Provider keeps endpoint, model, and connection test settings here.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Log in to Anybox" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open Account" }))
    expect(screen.getByRole("button", { name: "Log in to Anybox" })).toBeInTheDocument()
    expect(onStartProviderAuthFlow).not.toHaveBeenCalled()
  })

  it("hides provider logo fallback text after the remote logo image loads", () => {
    const { container } = render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createProvider("deepseek", "DeepSeek")],
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))

    const logo = container.querySelector(".provider-logo")
    const fallback = logo?.querySelector(".provider-logo-fallback")
    const image = logo?.querySelector(".provider-logo-image")

    expect(fallback).not.toHaveAttribute("hidden")
    expect(image).not.toHaveAttribute("hidden")

    fireEvent.load(image!)

    expect(fallback).toHaveAttribute("hidden")
    expect(image).not.toHaveAttribute("hidden")
  })

  it("keeps provider logo fallback text when the remote logo image fails", () => {
    const { container } = render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createProvider("unknown-provider", "Unknown Provider")],
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))

    const logo = container.querySelector(".provider-logo")
    const fallback = logo?.querySelector(".provider-logo-fallback")
    const image = logo?.querySelector(".provider-logo-image")

    fireEvent.error(image!)

    expect(fallback).not.toHaveAttribute("hidden")
    expect(image).toHaveAttribute("hidden")
  })

  it("opens the custom provider dialog and edits its four fields", () => {
    const onCustomProviderDraftChange = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          onCustomProviderDraftChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))
    fireEvent.click(screen.getByRole("button", { name: "Add custom provider" }))

    expect(screen.getByRole("dialog", { name: "Custom Provider" })).toBeInTheDocument()

    const apiBaseURLInput = screen.getByRole("textbox", { name: "Custom provider API Base URL" })
    const defaultModelInput = screen.getByRole("textbox", { name: "Custom provider default model" })

    expect(apiBaseURLInput).toHaveAttribute("placeholder", "https://api.example.com/v1")
    expect(screen.getByLabelText("Custom provider API key")).toHaveAttribute("placeholder", "Enter API key")
    expect(defaultModelInput).toHaveAttribute("placeholder", "model-name")

    fireEvent.change(apiBaseURLInput, {
      target: { value: "https://api.example.com/v1" },
    })
    fireEvent.change(screen.getByLabelText("Custom provider API key"), {
      target: { value: "sk-test" },
    })
    fireEvent.change(defaultModelInput, {
      target: { value: "custom-chat-model" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Custom provider chat endpoint" }), {
      target: { value: "/compatible/chat" },
    })

    expect(onCustomProviderDraftChange).toHaveBeenCalledWith("apiBaseURL", "https://api.example.com/v1")
    expect(onCustomProviderDraftChange).toHaveBeenCalledWith("apiKey", "sk-test")
    expect(onCustomProviderDraftChange).toHaveBeenCalledWith("defaultModel", "custom-chat-model")
    expect(onCustomProviderDraftChange).toHaveBeenCalledWith("chatEndpoint", "/compatible/chat")
  })

  it("tests and saves a complete custom provider draft", async () => {
    const onSaveCustomProvider = vi.fn().mockResolvedValue(true)
    const onTestCustomProviderConnection = vi.fn().mockResolvedValue(true)

    render(
      <SettingsPage
        {...createSettingsPageProps({
          customProviderDraft: {
            apiBaseURL: "https://api.example.com/v1",
            apiKey: "sk-test",
            defaultModel: "custom-chat-model",
            chatEndpoint: "/chat/completions",
          },
          onSaveCustomProvider,
          onTestCustomProviderConnection,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))
    fireEvent.click(screen.getByRole("button", { name: "Add custom provider" }))
    fireEvent.click(screen.getByRole("button", { name: "Test" }))
    fireEvent.click(screen.getByRole("button", { name: "Save custom provider" }))

    await waitFor(() => {
      expect(onTestCustomProviderConnection).toHaveBeenCalledTimes(1)
      expect(onSaveCustomProvider).toHaveBeenCalledTimes(1)
    })
  })

  it("shows detail header edit and delete buttons for custom providers", () => {
    const onDeleteProvider = vi.fn()
    const onCustomProviderDraftReset = vi.fn()
    const customProvider = {
      ...createProvider("custom-example", "Custom · api.example.com"),
      source: "config" as const,
      isCustomProvider: true,
      baseURL: "https://api.example.com/v1",
      customChatEndpoint: "/chat/completions",
      customDefaultModel: "deepseek-v4-flash",
    }
    const catalogProvider = {
      ...createProvider("openai", "OpenAI"),
      source: "api" as const,
    }

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [customProvider, catalogProvider],
          models: [createModel("custom-example", "deepseek-v4-flash", "deepseek-v4-flash")],
          onDeleteProvider,
          onCustomProviderDraftReset,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))

    expect(screen.getByRole("button", { name: /Custom · api\.example\.com.*Connected/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Delete OpenAI" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Edit Custom · api.example.com" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Delete Custom · api.example.com" }))

    expect(onDeleteProvider).toHaveBeenCalledWith("custom-example")

    fireEvent.click(screen.getByRole("button", { name: "Edit Custom · api.example.com" }))

    expect(onCustomProviderDraftReset).toHaveBeenCalledWith({
      apiBaseURL: "https://api.example.com/v1",
      apiKey: "",
      defaultModel: "deepseek-v4-flash",
      chatEndpoint: "/chat/completions",
    })
    expect(screen.getByRole("dialog", { name: "Edit Custom Provider" })).toBeInTheDocument()
  })

  it("filters archived sessions by title, project, and path", () => {
    render(
      <SettingsPage
        {...createSettingsPageProps({
          archivedSessions: [
            createArchivedSession({
              id: "session-analysis",
              title: "Project analysis",
              projectName: "Research",
              directory: "C:\\Projects\\research",
            }),
            createArchivedSession({
              id: "session-git",
              title: "Git initialization",
              projectName: "Client App",
              directory: "C:\\Projects\\client-app",
            }),
          ],
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Archived Sessions" }))

    expect(screen.getByText("Project analysis")).toBeInTheDocument()
    expect(screen.getByText("Git initialization")).toBeInTheDocument()

    const searchBox = screen.getByRole("searchbox", { name: "Search archived sessions" })
    fireEvent.change(searchBox, { target: { value: "client" } })

    expect(screen.queryByText("Project analysis")).not.toBeInTheDocument()
    expect(screen.getByText("Git initialization")).toBeInTheDocument()

    fireEvent.change(searchBox, { target: { value: "missing" } })

    expect(screen.getByText("No matching sessions")).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Archived sessions" })).not.toBeInTheDocument()
  })

  it("deletes all archived sessions from the archived sessions page", () => {
    const confirmDeleteAll = vi.spyOn(window, "confirm").mockReturnValue(true)
    const onDeleteAllArchivedSessions = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          archivedSessions: [
            createArchivedSession({ id: "session-archived-1" }),
            createArchivedSession({ id: "session-archived-2" }),
          ],
          onDeleteAllArchivedSessions,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Archived Sessions" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }))

    expect(confirmDeleteAll).toHaveBeenCalledWith("Permanently delete archived sessions (2)?")
    expect(onDeleteAllArchivedSessions).toHaveBeenCalledWith(["session-archived-1", "session-archived-2"])
  })

  it("does not delete all archived sessions when confirmation is cancelled", () => {
    const confirmDeleteAll = vi.spyOn(window, "confirm").mockReturnValue(false)
    const onDeleteAllArchivedSessions = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          archivedSessions: [createArchivedSession()],
          onDeleteAllArchivedSessions,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Archived Sessions" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }))

    expect(confirmDeleteAll).toHaveBeenCalledWith("Permanently delete archived sessions (1)?")
    expect(onDeleteAllArchivedSessions).not.toHaveBeenCalled()
  })

  it("disables delete all when there are no archived sessions", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    fireEvent.click(screen.getByRole("button", { name: "Archived Sessions" }))

    expect(screen.getByRole("button", { name: "Delete all" })).toBeDisabled()
  })

  it("opens the monitor app from developer mode settings", async () => {
    const openMonitorWindow = vi.fn().mockResolvedValue({
      ok: true,
      reused: false,
      source: "file",
    })
    setDesktopMock({ openMonitorWindow })

    render(<SettingsPage {...createSettingsPageProps()} />)

    fireEvent.click(screen.getByRole("button", { name: "Developer Mode" }))
    fireEvent.click(screen.getByRole("button", { name: /Agent Monitor/ }))
    fireEvent.click(screen.getByRole("button", { name: "Open monitor" }))

    await waitFor(() => {
      expect(openMonitorWindow).toHaveBeenCalledTimes(1)
    })
  })

  it("toggles mobile connection advanced info from developer mode settings", () => {
    const onMobileConnectionAdvancedInfoChange = vi.fn()

    render(<SettingsPage {...createSettingsPageProps({ onMobileConnectionAdvancedInfoChange })} />)

    fireEvent.click(screen.getByRole("button", { name: "Developer Mode" }))
    fireEvent.click(screen.getByRole("button", { name: /Mobile Connection/ }))
    fireEvent.click(screen.getByRole("switch", { name: "Show mobile connection advanced info" }))

    expect(onMobileConnectionAdvancedInfoChange).toHaveBeenCalledWith(true)
  })

  it("keeps storage paths inside the developer mode storage disclosure", async () => {
    const getStoragePaths = vi.fn().mockResolvedValue({
      appData: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent",
      agentRoot: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\agent",
      agentData: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\agent\\data",
      installedPlugins: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\agent\\data\\plugins\\installed",
      pluginRegistryCache: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\agent\\data\\plugins\\registry-cache",
      agentCache: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\agent\\cache",
      pluginInstallTemp: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\agent\\cache\\plugin-installs",
    })
    setDesktopMock({ getStoragePaths })

    render(<SettingsPage {...createSettingsPageProps()} />)

    expect(screen.queryByText("Storage Locations")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Developer Mode" }))

    const storageDisclosure = screen.getByRole("button", { name: /Storage Locations/ })
    expect(storageDisclosure).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Application data")).not.toBeInTheDocument()

    await waitFor(() => {
      expect(getStoragePaths).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(storageDisclosure)

    expect(await screen.findByText("Application data")).toBeInTheDocument()
    expect(screen.getByText("Plugin install temp")).toBeInTheDocument()
    expect(screen.getByTitle("C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent")).toBeInTheDocument()
  })

  it("shows native subscription plans and creates a WeChat payment order", async () => {
    const getAnyboxSubscriptionOverview = vi.fn().mockResolvedValue({
      connected: true,
      balanceMicrocents: 250_000_000,
      currency: "CNY",
      subscription: null,
      limits: [],
      plans: [
        {
          planId: "plan-pro",
          code: "pro",
          name: "Pro",
          planVersionId: "plan-version-pro",
          version: 1,
          currency: "CNY",
          priceCents: 1_900,
          billingInterval: "month",
          weeklyLimitMicrocents: 900_000_000,
          terms: {},
        },
      ],
    })
    const createAnyboxSubscriptionOrder = vi.fn().mockResolvedValue({
      order: {
        id: "order-1",
        provider: "wechat_pay",
        codeUrl: "weixin://wxpay/example",
        amountCents: 1_900,
        status: "pending",
      },
    })
    setDesktopMock({
      getAnyboxSubscriptionOverview,
      createAnyboxSubscriptionOrder,
      getAnyboxSubscriptionOrder: vi.fn().mockResolvedValue({
        order: {
          id: "order-1",
          provider: "wechat_pay",
          codeUrl: "weixin://wxpay/example",
          amountCents: 1_900,
          status: "pending",
        },
      }),
    })

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createAnyboxProvider({ authState: { status: "connected" } })],
        })}
      />,
    )

    openAccountSettingsTab("Subscription & credits")
    expect(await screen.findByText("Subscription weekly credits")).toBeInTheDocument()
    expect(screen.getByText("Pro")).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: "WeChat Pay" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Subscribe now" }))
    const paymentDialog = screen.getByRole("dialog", { name: "Choose a payment method" })
    fireEvent.click(within(paymentDialog).getByRole("radio", { name: "WeChat Pay" }))
    fireEvent.click(within(paymentDialog).getByRole("button", { name: "Create payment order" }))

    await waitFor(() => {
      expect(createAnyboxSubscriptionOrder).toHaveBeenCalledWith({
        planVersionId: "plan-version-pro",
        provider: "wechat_pay",
      })
    })
    expect(await screen.findByRole("img", { name: "WeChat Pay QR code" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument()
  })

  it("shows only the current weekly subscription credits", async () => {
    const getAnyboxSubscriptionOverview = vi.fn().mockResolvedValue({
      connected: true,
      balanceMicrocents: 250_000_000,
      currency: "CNY",
      subscription: {
        id: "subscription-pro",
        status: "active",
        planCode: "pro",
        planName: "Pro",
        planVersion: 2,
        priceCents: 19_900,
        currency: "CNY",
        overageMode: "blocked",
        cancelAtPeriodEnd: false,
        currentPeriodStartsAt: "2026-07-13T00:00:00.000Z",
        currentPeriodEndsAt: "2026-08-13T00:00:00.000Z",
        upcomingPeriodStartsAt: null,
        upcomingPeriodEndsAt: null,
      },
      limits: [
        {
          type: "weekly",
          limitMicrocents: 10_000_000_000,
          adjustmentMicrocents: 0,
          usedMicrocents: 2_000_000_000,
          reservedMicrocents: 0,
          remainingMicrocents: 8_000_000_000,
          resetsAt: "2026-07-20T00:00:00.000Z",
        },
      ],
      plans: [],
    })
    setDesktopMock({ getAnyboxSubscriptionOverview })

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createAnyboxProvider({ authState: { status: "connected" } })],
        })}
      />,
    )

    openAccountSettingsTab("Subscription & credits")

    expect(await screen.findByText("Weekly remaining")).toBeInTheDocument()
    expect(screen.queryByText(/Monthly remaining/)).not.toBeInTheDocument()
    expect(screen.queryByText(/5-hour remaining/)).not.toBeInTheDocument()
    expect(screen.getByText(/80\.00/)).toBeInTheDocument()
    expect(screen.getByText("80% remaining")).toBeInTheDocument()
    expect(screen.getByText(/20\.00 used/)).toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
    expect(screen.getAllByRole("progressbar")).toHaveLength(1)
  })

  it("quotes and creates an immediate upgrade order for a higher-priced plan", async () => {
    const getAnyboxSubscriptionOverview = vi.fn().mockResolvedValue({
      connected: true,
      currency: "CNY",
      subscription: {
        id: "subscription-basic",
        status: "active",
        planCode: "basic",
        planName: "Basic",
        planVersion: 1,
        priceCents: 1_900,
        currency: "CNY",
        overageMode: "blocked",
        cancelAtPeriodEnd: false,
        currentPeriodStartsAt: "2026-07-01T00:00:00.000Z",
        currentPeriodEndsAt: "2026-08-01T00:00:00.000Z",
        upcomingPeriodStartsAt: null,
        upcomingPeriodEndsAt: null,
      },
      limits: [],
      plans: [
        {
          planId: "plan-basic",
          code: "basic",
          name: "Basic",
          planVersionId: "plan-version-basic",
          version: 1,
          currency: "CNY",
          priceCents: 1_900,
          billingInterval: "month",
          weeklyLimitMicrocents: 900_000_000,
          terms: {},
        },
        {
          planId: "plan-pro",
          code: "pro",
          name: "Pro",
          planVersionId: "plan-version-pro",
          version: 1,
          currency: "CNY",
          priceCents: 3_900,
          billingInterval: "month",
          weeklyLimitMicrocents: 1_900_000_000,
          terms: {},
        },
      ],
    })
    const quote = {
      id: "upgrade-quote-1",
      status: "quoted" as const,
      sourceSubscriptionPeriodId: "period-basic",
      sourcePlanVersionId: "plan-version-basic",
      targetPlanVersionId: "plan-version-pro",
      scheduledSubscriptionPeriodId: null,
      sourcePlanCode: "basic",
      sourcePlanName: "Basic",
      targetPlanCode: "pro",
      targetPlanName: "Pro",
      sourceGrossPriceCents: 1_900,
      targetGrossPriceCents: 3_900,
      unusedCreditCents: 1_500,
      amountCents: 2_400,
      currency: "CNY",
      targetWeeklyLimitMicrocents: 1_900_000_000,
      quotedAt: "2026-07-13T00:00:00.000Z",
      quoteExpiresAt: "2026-07-13T00:05:00.000Z",
      sourcePeriodStartsAt: "2026-07-01T00:00:00.000Z",
      sourcePeriodEndsAt: "2026-08-01T00:00:00.000Z",
      scheduledPeriodStartsAt: null,
      scheduledPeriodEndsAt: null,
    }
    const createAnyboxSubscriptionUpgradeQuote = vi.fn().mockResolvedValue({ quote })
    const createAnyboxSubscriptionUpgradeOrder = vi.fn().mockResolvedValue({
      order: {
        id: "upgrade-order-1",
        provider: "wechat_pay",
        purpose: "subscription_upgrade",
        codeUrl: "weixin://wxpay/upgrade-order-1",
        amountCents: 2_400,
        currency: "CNY",
        status: "pending",
      },
      upgrade: {
        ...quote,
        status: "pending",
        sourcePlan: { code: "basic", name: "Basic" },
        targetPlan: { code: "pro", name: "Pro", weeklyLimitMicrocents: 1_900_000_000 },
      },
    })
    setDesktopMock({
      getAnyboxSubscriptionOverview,
      createAnyboxSubscriptionUpgradeQuote,
      createAnyboxSubscriptionUpgradeOrder,
      getAnyboxSubscriptionOrder: vi.fn().mockResolvedValue({
        order: {
          id: "upgrade-order-1",
          provider: "wechat_pay",
          purpose: "subscription_upgrade",
          codeUrl: "weixin://wxpay/upgrade-order-1",
          amountCents: 2_400,
          currency: "CNY",
          status: "pending",
        },
      }),
    })

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createAnyboxProvider({ authState: { status: "connected" } })],
        })}
      />,
    )

    openAccountSettingsTab("Subscription & credits")
    fireEvent.click(await screen.findByRole("button", { name: "Upgrade now" }))

    expect(await screen.findByRole("dialog", { name: "Confirm immediate upgrade" })).toBeInTheDocument()
    expect(screen.getByText("Unused-time credit")).toBeInTheDocument()
    expect(createAnyboxSubscriptionUpgradeQuote).toHaveBeenCalledWith({ planVersionId: "plan-version-pro" })

    fireEvent.click(screen.getByRole("button", { name: /Pay .* and upgrade/ }))
    const paymentDialog = screen.getByRole("dialog", { name: "Choose a payment method" })
    fireEvent.click(within(paymentDialog).getByRole("radio", { name: "WeChat Pay" }))
    fireEvent.click(within(paymentDialog).getByRole("button", { name: "Create payment order" }))
    await waitFor(() => {
      expect(createAnyboxSubscriptionUpgradeOrder).toHaveBeenCalledWith({
        quoteId: "upgrade-quote-1",
        provider: "wechat_pay",
      })
    })
    expect(await screen.findByRole("img", { name: "WeChat Pay QR code" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument()
  })

  it("does not offer manual renewal or next-period switching for an expired subscription", async () => {
    const getAnyboxSubscriptionOverview = vi.fn().mockResolvedValue({
      connected: true,
      currency: "CNY",
      subscription: {
        id: "subscription-pro",
        status: "expired",
        planCode: "pro",
        planName: "Pro",
        planVersion: 2,
        priceCents: 19_900,
        currency: "CNY",
        overageMode: "blocked",
        cancelAtPeriodEnd: false,
        currentPeriodStartsAt: "2026-06-13T00:00:00.000Z",
        currentPeriodEndsAt: "2026-07-13T00:00:00.000Z",
        upcomingPeriodStartsAt: null,
        upcomingPeriodEndsAt: null,
      },
      limits: [],
      plans: [
        {
          planId: "plan-pro",
          code: "pro",
          name: "Pro",
          planVersionId: "plan-version-pro",
          version: 2,
          currency: "CNY",
          priceCents: 19_900,
          billingInterval: "month",
          weeklyLimitMicrocents: 9_000_000_000,
          terms: {},
        },
        {
          planId: "plan-ultra",
          code: "ultra",
          name: "Ultra",
          planVersionId: "plan-version-ultra",
          version: 1,
          currency: "CNY",
          priceCents: 39_900,
          billingInterval: "month",
          weeklyLimitMicrocents: 19_000_000_000,
          terms: {},
        },
      ],
    })
    setDesktopMock({ getAnyboxSubscriptionOverview })

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createAnyboxProvider({ authState: { status: "connected" } })],
        })}
      />,
    )

    openAccountSettingsTab("Subscription & credits")
    expect(await screen.findByText(/automatic renewal is not available yet/i)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Renew for one month" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Switch next month" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Subscribe now" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Upgrade now" })).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "Choose a payment method" })).not.toBeInTheDocument()
  })

  it("shows an existing paid-through date without offering another renewal", async () => {
    setDesktopMock({
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue({
        connected: true,
        currency: "CNY",
        subscription: {
          id: "subscription-pro",
          status: "active",
          planCode: "pro",
          planName: "Pro",
          planVersion: 2,
          priceCents: 19_900,
          currency: "CNY",
          overageMode: "blocked",
          cancelAtPeriodEnd: false,
          currentPeriodStartsAt: "2026-07-13T00:00:00.000Z",
          currentPeriodEndsAt: "2026-08-13T00:00:00.000Z",
          upcomingPeriodStartsAt: "2026-08-13T00:00:00.000Z",
          upcomingPeriodEndsAt: "2026-09-13T00:00:00.000Z",
        },
        limits: [
          {
            type: "weekly",
            limitMicrocents: 9_000_000_000,
            adjustmentMicrocents: 0,
            usedMicrocents: 0,
            reservedMicrocents: 0,
            remainingMicrocents: 9_000_000_000,
            resetsAt: "2026-07-20T00:00:00.000Z",
          },
        ],
        plans: [
          {
            planId: "plan-pro",
            code: "pro",
            name: "Pro",
            planVersionId: "plan-version-pro",
            version: 2,
            currency: "CNY",
            priceCents: 19_900,
            billingInterval: "month",
            weeklyLimitMicrocents: 9_000_000_000,
            terms: {},
          },
        ],
      }),
    })

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createAnyboxProvider({ authState: { status: "connected" } })],
        })}
      />,
    )

    openAccountSettingsTab("Subscription & credits")
    expect(await screen.findByText(/Renewed until/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Renew for one month" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Switch next month" })).not.toBeInTheDocument()
  })

  it("keeps the pending order visible and explicitly replaces it after choosing a new payment method", async () => {
    const pendingAlipayOrder = {
      id: "order-alipay",
      provider: "alipay" as const,
      codeUrl: "https://openapi.alipay.test/pay/order-alipay",
      amountCents: 1_900,
      status: "pending",
    }
    const getAnyboxSubscriptionOverview = vi.fn().mockResolvedValue({
      connected: true,
      balanceMicrocents: 0,
      currency: "CNY",
      subscription: null,
      limits: [],
      pendingOrder: pendingAlipayOrder,
      pendingOrderPlanVersionId: "plan-version-pro",
      plans: [
        {
          planId: "plan-pro",
          code: "pro",
          name: "Pro",
          planVersionId: "plan-version-pro",
          version: 1,
          currency: "CNY",
          priceCents: 1_900,
          billingInterval: "month",
          weeklyLimitMicrocents: 900_000_000,
          terms: {},
        },
      ],
    })
    const createAnyboxSubscriptionOrder = vi.fn().mockResolvedValue({
      order: {
        id: "order-wechat",
        provider: "wechat_pay",
        codeUrl: "weixin://wxpay/order-wechat",
        amountCents: 1_900,
        status: "pending",
      },
    })
    setDesktopMock({
      getAnyboxSubscriptionOverview,
      createAnyboxSubscriptionOrder,
      getAnyboxSubscriptionOrder: vi.fn().mockResolvedValue({ order: pendingAlipayOrder }),
    })

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createAnyboxProvider({ authState: { status: "connected" } })],
        })}
      />,
    )

    openAccountSettingsTab("Subscription & credits")
    expect(await screen.findByRole("button", { name: "Open Alipay" })).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: "Alipay" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Change payment method" }))
    const paymentDialog = screen.getByRole("dialog", { name: "Change payment method" })
    expect(within(paymentDialog).getByRole("radio", { name: "Alipay" })).toBeDisabled()
    const wechatRadio = within(paymentDialog).getByRole("radio", { name: "WeChat Pay" })
    expect(wechatRadio).toHaveAttribute("aria-checked", "false")
    expect(screen.getByRole("button", { name: "Open Alipay" })).toBeInTheDocument()
    expect(within(paymentDialog).getByText(/current Alipay order/)).toBeInTheDocument()
    fireEvent.click(wechatRadio)
    fireEvent.click(within(paymentDialog).getByRole("button", { name: "Create payment order" }))

    await waitFor(() => {
      expect(createAnyboxSubscriptionOrder).toHaveBeenCalledWith({
        planVersionId: "plan-version-pro",
        provider: "wechat_pay",
        replaceOrderId: "order-alipay",
      })
    })
    expect(await screen.findByRole("img", { name: "WeChat Pay QR code" })).toBeInTheDocument()
  })

  it("cancels a pending order, locks payment actions while waiting, and unlocks the plan", async () => {
    const pendingOrder = {
      id: "order-alipay-cancel",
      provider: "alipay" as const,
      purpose: "subscription_purchase",
      codeUrl: "https://openapi.alipay.test/pay/order-alipay-cancel",
      amountCents: 1_900,
      currency: "CNY",
      status: "pending" as const,
    }
    const plan = {
      planId: "plan-pro",
      code: "pro",
      name: "Pro",
      planVersionId: "plan-version-pro",
      version: 1,
      currency: "CNY",
      priceCents: 1_900,
      billingInterval: "month",
      weeklyLimitMicrocents: 900_000_000,
      terms: {},
    }
    const getAnyboxSubscriptionOverview = vi.fn()
      .mockResolvedValueOnce({
        connected: true,
        currency: "CNY",
        subscription: null,
        limits: [],
        pendingOrder,
        pendingOrderPlanVersionId: plan.planVersionId,
        plans: [plan],
      })
      .mockResolvedValue({
        connected: true,
        currency: "CNY",
        subscription: null,
        limits: [],
        pendingOrder: null,
        pendingOrderPlanVersionId: null,
        plans: [plan],
      })
    type CanceledOrder = Omit<typeof pendingOrder, "status"> & { status: "canceled" }
    let resolveCancel!: (value: { order: CanceledOrder }) => void
    const cancelAnyboxSubscriptionOrder = vi.fn(() => new Promise<{ order: CanceledOrder }>((resolve) => {
      resolveCancel = resolve
    }))
    setDesktopMock({
      getAnyboxSubscriptionOverview,
      cancelAnyboxSubscriptionOrder,
      getAnyboxSubscriptionOrder: vi.fn().mockResolvedValue({ order: pendingOrder }),
    })

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createAnyboxProvider({ authState: { status: "connected" } })],
        })}
      />,
    )

    openAccountSettingsTab("Subscription & credits")
    const cancelButton = await screen.findByRole("button", { name: "Cancel order" })
    fireEvent.click(cancelButton)

    expect(cancelAnyboxSubscriptionOrder).toHaveBeenCalledWith({ orderId: pendingOrder.id })
    expect(screen.getByRole("button", { name: "Canceling..." })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Open Alipay" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Change payment method" })).toBeDisabled()

    resolveCancel({ order: { ...pendingOrder, status: "canceled" } })

    expect(await screen.findByText("Payment order canceled.")).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Cancel order" })).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Subscribe now" })).toBeEnabled()
    })
  })

  it("keeps a pending order visible with an actionable error when safe cancellation fails", async () => {
    const pendingOrder = {
      id: "order-wechat-close-failed",
      provider: "wechat_pay" as const,
      purpose: "subscription_purchase",
      codeUrl: "weixin://wxpay/order-wechat-close-failed",
      amountCents: 1_900,
      currency: "CNY",
      status: "pending" as const,
    }
    const cancelAnyboxSubscriptionOrder = vi.fn().mockRejectedValue(new Error("Payment provider could not close this order."))
    setDesktopMock({
      getAnyboxSubscriptionOverview: vi.fn().mockResolvedValue({
        connected: true,
        currency: "CNY",
        subscription: null,
        limits: [],
        pendingOrder,
        pendingOrderPlanVersionId: "plan-version-pro",
        plans: [],
      }),
      cancelAnyboxSubscriptionOrder,
      getAnyboxSubscriptionOrder: vi.fn().mockResolvedValue({ order: pendingOrder }),
    })

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createAnyboxProvider({ authState: { status: "connected" } })],
        })}
      />,
    )

    openAccountSettingsTab("Subscription & credits")
    fireEvent.click(await screen.findByRole("button", { name: "Cancel order" }))

    expect(await screen.findByText("Payment provider could not close this order.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeEnabled()
    expect(screen.getByRole("img", { name: "WeChat Pay QR code" })).toBeInTheDocument()
  })

  it("loads and renders the dedicated storage usage section", async () => {
    const onLoadStorageUsage = vi.fn()
    const onOptimizeStorage = vi.fn()

    const { unmount } = render(<SettingsPage {...createSettingsPageProps({ onLoadStorageUsage, onOptimizeStorage })} />)

    fireEvent.click(screen.getByRole("button", { name: "Storage" }))

    await waitFor(() => {
      expect(onLoadStorageUsage).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(onLoadStorageUsage).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole("button", { name: "Optimize storage" }))
    expect(onOptimizeStorage).toHaveBeenCalledTimes(1)
    expect(screen.getByText("No storage snapshot yet")).toBeInTheDocument()
    unmount()

    const storageUsage = createStorageUsageSnapshot()
    render(<SettingsPage {...createSettingsPageProps({ storageUsage, onLoadStorageUsage: vi.fn() })} />)
    fireEvent.click(screen.getByRole("button", { name: "Storage" }))

    expect(screen.getAllByText("Database file").length).toBeGreaterThan(0)
    expect(screen.getByText("120 MB")).toBeInTheDocument()
    expect(screen.getAllByText("About 12.0 MB").length).toBeGreaterThan(0)
    expect(screen.getByText("Large archived image thread")).toBeInTheDocument()
    expect(screen.getByText("archived_sessions")).toBeInTheDocument()
    expect(screen.getByTitle(storageUsage.database.path)).toBeInTheDocument()
  })

  it("keeps the storage optimize action disabled and its error next to the action", () => {
    render(<SettingsPage {...createSettingsPageProps({
      isOptimizingStorage: true,
      storageOptimizeMessage: { tone: "error", text: "Storage maintenance is busy." },
    })} />)
    fireEvent.click(screen.getByRole("button", { name: "Storage" }))

    expect(screen.getByRole("button", { name: "Optimizing..." })).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent("Storage maintenance is busy.")
  })

  it("switches the display language from general settings", async () => {
    window.localStorage.setItem("desktop.locale", "en-US")
    const saveLocaleConfig = vi.fn().mockResolvedValue({
      path: "locale-settings.json",
      exists: true,
      document: {
        version: 1,
        locale: "zh-CN",
        updatedAt: 1,
      },
    })

    setDesktopMock({
      getLocaleConfig: vi.fn().mockResolvedValue({
        path: "locale-settings.json",
        exists: true,
        document: {
          version: 1,
          locale: "en-US",
          updatedAt: 1,
        },
      }),
      saveLocaleConfig,
    })

    render(
      <I18nProvider>
        <SettingsPage {...createSettingsPageProps()} />
      </I18nProvider>,
    )

    expect(await screen.findByRole("combobox", { name: "Display Language" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "General" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "About" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))
    expect(screen.queryByRole("combobox", { name: "Display Language" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "General" }))

    fireEvent.click(screen.getByRole("combobox", { name: "Display Language" }))
    const languageListbox = screen.getByRole("listbox", { name: "Display Language" })
    for (const language of [
      "简体中文", "繁體中文", "English", "日本語", "한국어", "Português (Brasil)",
      "Español (Latinoamérica)", "Deutsch", "Français", "Bahasa Indonesia", "Italiano", "Polski", "Türkçe", "Tiếng Việt",
    ]) {
      expect(within(languageListbox).getByRole("option", { name: language })).toBeInTheDocument()
    }
    fireEvent.click(within(languageListbox).getByRole("option", { name: "简体中文" }))

    await waitFor(() => {
      expect(saveLocaleConfig).toHaveBeenCalledWith({
        document: expect.objectContaining({
          locale: "zh-CN",
          version: 1,
        }),
      })
    })
    expect(await screen.findByText("显示语言")).toBeInTheDocument()
  })

  it("selects the interface font from appearance settings", () => {
    const onFontFamilyChange = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          fontFamily: "system",
          onFontFamilyChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))
    expect(screen.getByText("Interface Font")).toBeInTheDocument()

    selectSettingsOption("Interface Font", "微软雅黑")

    expect(onFontFamilyChange).toHaveBeenCalledWith("microsoft-yahei")
  })

  it("manages appearance themes from the appearance settings", async () => {
    const onAppearanceThemeApply = vi.fn().mockResolvedValue(undefined)
    const onAppearanceThemeSaveCurrent = vi.fn().mockResolvedValue(createAppearanceTheme({
      id: "user:saved",
      name: "Focused Work",
      source: "user",
      readonly: false,
    }))
    const onAppearanceThemeDuplicate = vi.fn().mockResolvedValue(createAppearanceTheme({
      id: "user:copy",
      name: "Sage Slate Copy",
      source: "user",
      readonly: false,
      brandTheme: "sage",
    }))
    const onAppearanceThemeRename = vi.fn().mockResolvedValue(createAppearanceTheme({
      id: "user:custom",
      name: "Renamed Custom",
      source: "user",
      readonly: false,
    }))
    const onAppearanceThemeDelete = vi.fn().mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)

    render(
      <SettingsPage
        {...createSettingsPageProps({
          activeAppearanceThemeID: "built-in:classic",
          appearanceThemes: [
            createAppearanceTheme(),
            createAppearanceTheme({
              id: "built-in:sage-slate",
              name: "Sage Slate",
              brandTheme: "sage",
              colorMode: "system",
            }),
            createAppearanceTheme({
              id: "user:custom",
              name: "My Custom",
              source: "user",
              readonly: false,
              overrides: {
                "surface-panel-light": colorLiteral("#fefefe"),
              },
            }),
          ],
          onAppearanceThemeApply,
          onAppearanceThemeDelete,
          onAppearanceThemeDuplicate,
          onAppearanceThemeRename,
          onAppearanceThemeSaveCurrent,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))

    const library = screen.getByRole("heading", { name: "Theme Library" }).closest("section")!
    expect(within(library).getByRole("option", { name: /经典/ })).toHaveAttribute("aria-selected", "true")
    expect(within(library).getByRole("button", { name: "Delete" })).toBeDisabled()

    fireEvent.click(within(library).getByRole("option", { name: /My Custom/ }))
    fireEvent.change(within(library).getByLabelText("Theme name"), {
      target: { value: "Renamed Custom" },
    })
    fireEvent.click(within(library).getByRole("button", { name: "Update Name" }))
    await waitFor(() => {
      expect(onAppearanceThemeRename).toHaveBeenCalledWith("user:custom", "Renamed Custom")
    })

    fireEvent.click(within(library).getByRole("button", { name: "Delete" }))
    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith("Delete theme \"My Custom\"?")
      expect(onAppearanceThemeDelete).toHaveBeenCalledWith("user:custom")
    })

    fireEvent.click(within(library).getByRole("option", { name: /Sage Slate/ }))
    fireEvent.click(within(library).getByRole("button", { name: "Apply" }))
    await waitFor(() => {
      expect(onAppearanceThemeApply).toHaveBeenCalledWith("built-in:sage-slate")
    })

    fireEvent.click(within(library).getByRole("button", { name: "Duplicate" }))
    await waitFor(() => {
      expect(onAppearanceThemeDuplicate).toHaveBeenCalledWith("built-in:sage-slate", "Sage Slate Copy")
    })

    fireEvent.change(within(library).getByLabelText("Theme name"), {
      target: { value: "Focused Work" },
    })
    fireEvent.click(within(library).getByRole("button", { name: "Save Current" }))
    await waitFor(() => {
      expect(onAppearanceThemeSaveCurrent).toHaveBeenCalledWith("Focused Work")
    })
  })

  it("imports and exports DTCG themes and shows contrast feedback", async () => {
    const importedTheme = createAppearanceTheme({
      id: "user:imported",
      name: "Imported",
      source: "imported",
      readonly: false,
    })
    const onAppearanceThemeImportDtcg = vi.fn().mockResolvedValue(importedTheme)
    const onAppearanceThemeExportDtcg = vi.fn().mockReturnValue({
      contents: "{\"$schema\":\"test\"}\n",
      fileName: "classic.tokens.json",
    })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    render(
      <SettingsPage
        {...createSettingsPageProps({
          activeAppearanceThemeID: "built-in:classic",
          appearanceThemes: [createAppearanceTheme()],
          appearanceContrastWarnings: [
            {
              contractID: "primary-text-on-app",
              kind: "text",
              mode: "light",
              foregroundToken: "text-primary-light",
              backgroundToken: "surface-app-light",
              contrast: 1,
              minimumContrast: 4.5,
            },
          ],
          appearanceThemeNotice: "Imported 2 Anybox tokens.",
          onAppearanceThemeExportDtcg,
          onAppearanceThemeImportDtcg,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))

    const file = new File(["{}"], "shared.tokens.json", {
      type: "application/json",
    })
    Object.defineProperty(file, "text", {
      configurable: true,
      value: vi.fn().mockResolvedValue("{}"),
    })
    fireEvent.change(
      screen.getByLabelText("Choose a DTCG token file to import"),
      { target: { files: [file] } },
    )

    await waitFor(() => {
      expect(onAppearanceThemeImportDtcg).toHaveBeenCalledWith(
        "{}",
        "shared",
      )
    })
    fireEvent.click(screen.getByRole("button", { name: "Export DTCG" }))
    expect(onAppearanceThemeExportDtcg).toHaveBeenCalledWith("built-in:classic")
    expect(anchorClick).toHaveBeenCalled()
    expect(screen.getByRole("heading", {
      name: "Contrast warnings (1)",
    })).toBeInTheDocument()
    expect(screen.getByText("Imported 2 Anybox tokens.")).toBeInTheDocument()
  })

  it("edits the static HTML background settings from appearance", () => {
    const onHtmlBackgroundConfigChange = vi.fn()

    const { rerender } = render(
      <SettingsPage
        {...createSettingsPageProps({
          onHtmlBackgroundConfigChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))

    const enableButton = screen.getByRole("switch", { name: "Enable HTML background" })
    expect(enableButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText("HTML source"), {
      target: {
        value: "<main>Custom background</main>",
      },
    })

    expect(onHtmlBackgroundConfigChange).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
      html: "<main>Custom background</main>",
    }))

    rerender(
      <SettingsPage
        {...createSettingsPageProps({
          htmlBackgroundConfig: {
            blurPx: 0,
            dim: 0.18,
            enabled: false,
            html: "<main>Custom background</main>",
            opacity: 0.78,
            paused: false,
            renderMode: "static",
            surfaceOpacity: 0.68,
          },
          onHtmlBackgroundConfigChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("switch", { name: "Enable HTML background" }))
    expect(onHtmlBackgroundConfigChange).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      html: "<main>Custom background</main>",
    }))

    expect(screen.queryByRole("slider", { name: /Surface opacity/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("switch", { name: "Dynamic script background" }))

    expect(onHtmlBackgroundConfigChange).toHaveBeenCalledWith(expect.objectContaining({
      renderMode: "dynamic",
    }))
  })

  it("filters appearance theme tokens by semantic token name", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))

    expect(screen.getByText("App Background")).toBeInTheDocument()

    const searchBox = screen.getByRole("searchbox", { name: "Search semantic tokens" })
    fireEvent.change(searchBox, {
      target: { value: "semantic-sidebar-tree-row-surface-active" },
    })

    expect(screen.getByText("Row Surface Active")).toBeInTheDocument()
    expect(screen.getByTitle(/^semantic-sidebar-tree-row-surface-active \//)).toBeInTheDocument()
    expect(screen.queryByText("App Background")).not.toBeInTheDocument()

    fireEvent.change(searchBox, {
      target: { value: "semantic-list-detail-row-surface-hover" },
    })

    expect(screen.getByText("List Detail Rows")).toBeInTheDocument()
    expect(screen.getByTitle(/^semantic-list-detail-row-surface-hover \//)).toBeInTheDocument()
    expect(screen.queryByText("App Background")).not.toBeInTheDocument()

    fireEvent.change(searchBox, {
      target: { value: "semantic-detail-icon-text" },
    })

    expect(screen.getByText("List Detail Rows")).toBeInTheDocument()
    expect(screen.getByText("Detail Icon Text")).toBeInTheDocument()
    expect(screen.getByTitle(/^semantic-detail-icon-text \//)).toBeInTheDocument()
    expect(screen.queryByText("App Background")).not.toBeInTheDocument()

    fireEvent.change(searchBox, {
      target: { value: "semantic-switch-track-surface" },
    })

    expect(screen.getByText("Switches")).toBeInTheDocument()
    expect(screen.getByText("Switch Track")).toBeInTheDocument()
    expect(screen.getByTitle(/^semantic-switch-track-surface \//)).toBeInTheDocument()
    expect(screen.queryByText("App Background")).not.toBeInTheDocument()

    fireEvent.change(searchBox, {
      target: { value: "semantic-button-primary-surface" },
    })

    expect(screen.getByText("Buttons")).toBeInTheDocument()
    expect(screen.getByText("Primary Surface")).toBeInTheDocument()
    expect(screen.getByTitle(/^semantic-button-primary-surface \//)).toBeInTheDocument()
    expect(screen.queryByText("App Background")).not.toBeInTheDocument()

    fireEvent.change(searchBox, {
      target: { value: "semantic-thread-tool-io-panel-surface" },
    })

    expect(screen.getByText("Thread View")).toBeInTheDocument()
    expect(screen.getByText("Tool IO Panel Surface")).toBeInTheDocument()
    expect(screen.getByTitle(/^semantic-thread-tool-io-panel-surface \//)).toBeInTheDocument()
    expect(screen.queryByText("App Background")).not.toBeInTheDocument()

    fireEvent.change(searchBox, {
      target: { value: "no-such-token" },
    })

    expect(screen.getByText("No matching tokens")).toBeInTheDocument()
  })

  it("filters appearance theme tokens by abstraction layer", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))

    fireEvent.click(screen.getByRole("combobox", { name: "Filter token layer" }))
    fireEvent.click(screen.getByRole("option", { name: "Components" }))

    expect(screen.getByText("Buttons")).toBeInTheDocument()
    expect(screen.getByText("Switches")).toBeInTheDocument()
    expect(screen.queryByText("App Background")).not.toBeInTheDocument()
    expect(screen.queryByText("Thread View")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("combobox", { name: "Filter token layer" }))
    fireEvent.click(screen.getByRole("option", { name: "Product areas" }))

    expect(screen.getByText("Thread View")).toBeInTheDocument()
    expect(screen.getByText("Popup Panel")).toBeInTheDocument()
    expect(screen.queryByText("Buttons")).not.toBeInTheDocument()
  })

  it("localizes appearance token metadata in Chinese", () => {
    window.localStorage.setItem("desktop.locale", "zh-CN")

    render(
      <I18nProvider>
        <SettingsPage {...createSettingsPageProps()} />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "\u5916\u89c2" }))

    expect(screen.getByText("\u5e94\u7528\u80cc\u666f")).toBeInTheDocument()
    expect(screen.getByText("\u6700\u5e95\u5c42\u7684\u753b\u5e03\u80cc\u666f\u3002")).toBeInTheDocument()
    expect(screen.getByText("\u8f93\u5165\u6846\u8fb9\u6846")).toBeInTheDocument()
    expect(screen.getByText("\u9009\u533a\u80cc\u666f")).toBeInTheDocument()
    expect(screen.getByText("Markdown \u6587\u672c\u88ab\u9f20\u6807\u9009\u4e2d\u65f6\u7684\u9ad8\u4eae\u80cc\u666f\u3002")).toBeInTheDocument()
    expect(screen.queryByText("The farthest canvas background.")).not.toBeInTheDocument()

    const searchBox = screen.getByRole("searchbox", { name: "\u641c\u7d22 semantic token" })
    fireEvent.change(searchBox, {
      target: { value: "\u5f00\u5173\u8f68\u9053" },
    })

    expect(screen.getByText("\u5f00\u5173")).toBeInTheDocument()
    expect(screen.getByText("\u5f00\u5173\u8f68\u9053")).toBeInTheDocument()
    expect(screen.getByText("\u5f00\u5173\u63a7\u4ef6\u7684\u9ed8\u8ba4\u8f68\u9053\u586b\u5145\u8272\u3002")).toBeInTheDocument()
    expect(screen.queryByText("\u5e94\u7528\u80cc\u666f")).not.toBeInTheDocument()
  })

  it("edits appearance token alpha values", () => {
    const appearanceTokenValues = createAppearanceTokenValues("#000000")
    appearanceTokenValues["border-default-light"] = "rgba(41, 37, 36, 0.08)"
    const onAppearanceTokenChange = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          appearanceTokenValues,
          onAppearanceTokenChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))
    fireEvent.click(screen.getByRole("button", {
      name: "Foundation / Content Default Border Light border-default-light",
    }))

    const alphaInput = screen.getByRole("slider", {
      name: "Foundation / Content Default Border Light border-default-light alpha",
    }) as HTMLInputElement
    expect(alphaInput.value).toBe("0.08")

    fireEvent.change(alphaInput, { target: { value: "0.42" } })
    expect(onAppearanceTokenChange).toHaveBeenCalledWith(
      "border-default-light",
      "rgba(41, 37, 36, 0.42)",
    )

    fireEvent.change(screen.getByRole("slider", {
      name: "Foundation / Content Default Border Light border-default-light hue",
    }), {
      target: { value: "180" },
    })
    expect(onAppearanceTokenChange).toHaveBeenCalledWith(
      "border-default-light",
      "rgba(36, 41, 41, 0.08)",
    )

    const colorInput = screen.getByLabelText(
      "Foundation / Content Default Border Light border-default-light color value",
    )
    fireEvent.change(colorInput, { target: { value: "rgba(1, 2, 3, 0.5)" } })
    fireEvent.blur(colorInput)
    expect(onAppearanceTokenChange).toHaveBeenCalledWith(
      "border-default-light",
      "rgba(1, 2, 3, 0.5)",
    )
  })

  it("filters appearance theme tokens by group", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))

    selectSettingsOption("Filter token group", "Foundation / Content")

    expect(screen.getAllByText("Foundation / Content").length).toBeGreaterThan(0)
    expect(screen.getByText("Primary Text")).toBeInTheDocument()
    expect(screen.queryByText("App Background")).not.toBeInTheDocument()
  })

  it("filters appearance theme tokens to customized rows", () => {
    render(
      <SettingsPage
        {...createSettingsPageProps({
          appearanceOverrides: {
            "surface-app-light": colorLiteral("#ffffff"),
          },
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))

    selectSettingsOption("Filter token status", "Customized only")

    expect(screen.getByText("App Background")).toBeInTheDocument()
    expect(screen.queryByText("Shell Background")).not.toBeInTheDocument()
  })

  it("uses localized appearance labels without helper descriptions in Chinese", () => {
    window.localStorage.setItem("desktop.locale", "zh-CN")

    render(
      <I18nProvider>
        <SettingsPage
          {...createSettingsPageProps({
            activeAppearanceThemeID: "built-in:classic",
            appearanceThemes: [createAppearanceTheme()],
            fontFamily: "microsoft-yahei",
          })}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "外观" }))

    const themeLibrary = screen.getByRole("heading", { name: "主题库" }).closest("section")!
    expect(within(themeLibrary).getByText("颜色模式")).toBeInTheDocument()
    expect(within(themeLibrary).getByText("强调主题")).toBeInTheDocument()
    expect(within(themeLibrary).getByText("代码主题")).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "颜色模式" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "强调主题" })).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "代码主题" })).not.toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "界面字体" })).toBeInTheDocument()
    expect(screen.getByText("行默认背景")).toBeInTheDocument()
    expect(screen.queryByText("选择亮色、暗色或跟随系统的配色方案。")).not.toBeInTheDocument()
    expect(screen.queryByText(/Choose the font used across the desktop interface/i)).not.toBeInTheDocument()
  })

  it("selects the primary model through the provider model picker", () => {
    const onSelectionChange = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createProvider("deepseek", "DeepSeek"), createProvider("openai", "OpenAI")],
          models: [
            createModel("deepseek", "deepseek-reasoner", "DeepSeek Reasoner", { reasoning: true }),
            createModel("openai", "gpt-4o-mini", "GPT-4o mini"),
          ],
          onSelectionChange,
          selectionDraft: {
            model: "deepseek/deepseek-reasoner",
            smallModel: null,
            reasoningEffort: null,
            imageModel: null,
            imageDefaultSize: null,
            imageDefaultCount: null,
          },
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Models" }))
    fireEvent.click(screen.getByRole("button", { name: "Primary model: DeepSeek / DeepSeek Reasoner" }))

    const picker = screen.getByRole("dialog", { name: "Primary model model picker" })
    const providerList = within(picker).getByRole("listbox", { name: "Primary model providers" })
    const modelList = within(picker).getByRole("listbox", { name: "Primary model models" })
    const deepSeekProvider = within(providerList).getByRole("option", { name: /DeepSeek/ })
    const openAIProvider = within(providerList).getByRole("option", { name: /OpenAI/ })
    expect(deepSeekProvider).toHaveAttribute("aria-selected", "true")
    expect(within(modelList).getByRole("option", { name: "DeepSeek Reasoner" })).toHaveAttribute(
      "aria-selected",
      "true",
    )

    deepSeekProvider.focus()
    fireEvent.keyDown(deepSeekProvider, { key: "ArrowDown" })
    expect(openAIProvider).toHaveFocus()
    fireEvent.keyDown(openAIProvider, { key: "Home" })
    expect(deepSeekProvider).toHaveFocus()

    fireEvent.change(within(picker).getByRole("searchbox", { name: "Search providers or models" }), {
      target: {
        value: "openai",
      },
    })

    expect(within(providerList).queryByRole("option", { name: /DeepSeek/ })).not.toBeInTheDocument()
    fireEvent.click(within(modelList).getByRole("option", { name: "GPT-4o mini" }))
    expect(onSelectionChange).toHaveBeenCalledWith("model", "openai/gpt-4o-mini")
  })

  it("uses the picker for small models and filters image generation models", () => {
    const onSelectionChange = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createProvider("deepseek", "DeepSeek"), createProvider("openai", "OpenAI")],
          models: [
            createModel("deepseek", "deepseek-reasoner", "DeepSeek Reasoner", { reasoning: true }),
            createModel("openai", "gpt-4o-mini", "GPT-4o mini"),
            createModel("openai", "gpt-image-1", "GPT Image", { imageOutput: true }),
          ],
          onSelectionChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Models" }))
    expect(screen.queryByRole("button", { name: "Save model selection" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Small model: Use server default" }))
    fireEvent.click(screen.getByRole("option", { name: "DeepSeek Reasoner" }))
    expect(onSelectionChange).toHaveBeenCalledWith("smallModel", "deepseek/deepseek-reasoner")
    expect(screen.queryByRole("dialog", { name: "Small model model picker" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Image generation model: Not configured" }))
    const picker = screen.getByRole("dialog", { name: "Image generation model model picker" })
    const modelList = within(picker).getByRole("listbox", { name: "Image generation model models" })

    expect(within(modelList).getByRole("option", { name: "GPT Image" })).toBeInTheDocument()
    expect(within(modelList).queryByRole("option", { name: "GPT-4o mini" })).not.toBeInTheDocument()

    fireEvent.click(within(modelList).getByRole("option", { name: "GPT Image" }))
    expect(onSelectionChange).toHaveBeenCalledWith("imageModel", "openai/gpt-image-1")
  })
})
