import { fireEvent, render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"
import { ConnectorsPage } from "./ConnectorsPage"

const settingsStyles = readFileSync(resolve(process.cwd(), "src/renderer/src/styles/settings.css"), "utf8")

type ConnectorsPageProps = ComponentProps<typeof ConnectorsPage>
type ConnectorDefinition = ConnectorsPageProps["connectorCatalog"][number]
type ConnectorStatus = ConnectorsPageProps["connectorStatuses"][number]

function createConnector(overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition {
  const runtime = overrides.runtime ?? {
    transport: "stdio" as const,
    command: "node",
    args: ["gmail-connector.js"],
    timeoutMs: 10_000,
  }
  return {
    id: overrides.id ?? "gmail",
    name: overrides.name ?? "Gmail",
    description: overrides.description ?? "Read and draft Gmail messages through a platform connector.",
    category: overrides.category ?? "account_connector",
    publisher: overrides.publisher ?? "Anybox",
    icon: overrides.icon,
    risk: overrides.risk ?? "medium",
    permissions: overrides.permissions ?? ["Read Gmail metadata"],
    tools: overrides.tools ?? [
      {
        name: "search_email_ids",
        title: "Search email",
        description: "Search Gmail messages.",
        readOnly: true,
      },
    ],
    configFields: overrides.configFields ?? [],
    oauthCallbackURL: overrides.oauthCallbackURL,
    credential: overrides.credential ?? {
      kind: "oauth",
      label: "Google account",
      clientID: "client",
      authorizationURL: "https://accounts.example.test/authorize",
      tokenURL: "https://accounts.example.test/token",
      scopes: ["gmail.readonly"],
    },
    mcpRuntimes: overrides.mcpRuntimes ?? [{
      ...runtime,
      id: "default",
      name: overrides.name ?? "Gmail",
      available: overrides.available ?? true,
    }],
    runtime,
    installReview: overrides.installReview ?? ["Review requested OAuth scopes before connecting."],
    source: overrides.source ?? "platform",
    available: overrides.available ?? true,
    ...overrides,
  }
}

function createStatus(overrides: Partial<ConnectorStatus> = {}): ConnectorStatus {
  const generatedMcpServerID = overrides.generatedMcpServerID ?? "connector.gmail.default"
  return {
    connectorID: overrides.connectorID ?? "connector:gmail:default",
    definitionID: overrides.definitionID ?? "gmail",
    name: overrides.name ?? "Gmail",
    connected: overrides.connected ?? true,
    available: overrides.available ?? true,
    configured: overrides.configured,
    configurationLabel: overrides.configurationLabel,
    authStatus: overrides.authStatus ?? "connected",
    credentialKind: overrides.credentialKind ?? "oauth",
    credentialLabel: overrides.credentialLabel ?? "Google account",
    email: overrides.email ?? "person@example.test",
    mcpBindings: overrides.mcpBindings ?? [{
      runtimeID: "default",
      serverID: generatedMcpServerID,
      name: overrides.name ?? "Gmail",
    }],
    generatedMcpServerID,
    ...overrides,
  }
}

function createProps(overrides: Partial<ConnectorsPageProps> = {}): ConnectorsPageProps {
  return {
    activeConnectorID: "connector:gmail:default",
    connectorApiKeyDrafts: {},
    connectorCatalog: [createConnector()],
    connectorConfigDrafts: {},
    connectorStatuses: [createStatus()],
    connectorsError: null,
    diagnosingConnectorMcpServerID: null,
    isLoading: false,
    mcpDiagnostics: {},
    mcpServers: [
      {
        id: "connector.gmail.default",
        name: "Gmail",
        transport: "connector",
        connectorId: "connector:gmail:default",
        enabled: true,
        timeoutMs: 10_000,
      },
    ],
    savingConnectorID: null,
    savingConnectorMcpServerID: null,
    onCancelConnectorAuthFlow: vi.fn(),
    onConnectorApiKeyDraftChange: vi.fn(),
    onConnectorConfigDraftChange: vi.fn(),
    onConnectorSelect: vi.fn(),
    onDeleteConnectorApiKey: vi.fn(),
    onDeleteConnectorConfig: vi.fn(),
    onDeleteConnectorAuthSession: vi.fn(),
    onDiagnoseConnector: vi.fn(),
    onConnectorMcpEnabledChange: vi.fn(),
    onConnectorMcpToolPolicyChange: vi.fn(),
    onSaveConnectorApiKey: vi.fn(),
    onSaveConnectorConfig: vi.fn(),
    onStartConnectorAuthFlow: vi.fn(),
    ...overrides,
  }
}

describe("ConnectorsPage", () => {
  it("keeps connector and runtime segments frameless with stable selected surfaces", () => {
    expect(settingsStyles).toMatch(
      /\.connectors-detail-tab-list\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s,
    )
    expect(settingsStyles).toMatch(
      /\.connectors-detail-tab-list\s*>\s*\.top-menu-segment\[aria-selected="true"\]\s*\{[^}]*box-shadow:\s*none;/s,
    )
    expect(settingsStyles).toMatch(
      /\.connectors-runtime-segment-list\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    )
  })

  it("renders platform connector status and OAuth actions", () => {
    const onStartConnectorAuthFlow = vi.fn()
    const onDeleteConnectorAuthSession = vi.fn()
    const onDiagnoseConnector = vi.fn()
    const onConnectorMcpEnabledChange = vi.fn()

    render(
      <ConnectorsPage
        {...createProps({
          onStartConnectorAuthFlow,
          onDeleteConnectorAuthSession,
          onDiagnoseConnector,
          onConnectorMcpEnabledChange,
        })}
      />,
    )

    expect(screen.getByLabelText("Connectors top menu")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Gmail Connected" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Gmail", level: 1 })).toBeInTheDocument()
    expect(screen.getByText("person@example.test")).toBeInTheDocument()
    expect(screen.getByText("Managed by Anybox")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Authentication" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "MCP" })).toHaveAttribute("aria-selected", "false")

    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }))
    expect(onStartConnectorAuthFlow).toHaveBeenCalledWith("connector:gmail:default")

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
    expect(onDeleteConnectorAuthSession).toHaveBeenCalledWith("connector:gmail:default")

    fireEvent.click(screen.getByRole("tab", { name: "MCP" }))
    expect(screen.getByText("connector.gmail.default")).toBeInTheDocument()
    expect(screen.getByText("10000 ms")).toBeInTheDocument()
    expect(screen.queryByText("person@example.test")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("switch", { name: "Enable Gmail MCP runtime" }))
    expect(onConnectorMcpEnabledChange).toHaveBeenCalledWith("connector.gmail.default", false)

    fireEvent.click(screen.getByRole("button", { name: "Diagnose" }))
    expect(onDiagnoseConnector).toHaveBeenCalledWith(
      "connector:gmail:default",
      "default",
      "connector.gmail.default",
    )

    fireEvent.click(screen.getByRole("tab", { name: "Authentication" }))
    expect(screen.getByRole("tab", { name: "Authentication" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("person@example.test")).toBeInTheDocument()
  })

  it("edits API-key connector drafts and saves the selected connector", () => {
    const onConnectorApiKeyDraftChange = vi.fn()
    const onSaveConnectorApiKey = vi.fn()
    const docsConnector = createConnector({
      id: "docs",
      name: "Docs API",
      credential: {
        kind: "api_key",
        key: "DOCS_API_KEY",
        label: "Docs API key",
        type: "password",
        secret: true,
      },
    })

    render(
      <ConnectorsPage
        {...createProps({
          activeConnectorID: "connector:docs:default",
          connectorApiKeyDrafts: {
            "connector:docs:default": "sk-test",
          },
          connectorCatalog: [docsConnector],
          connectorStatuses: [
            createStatus({
              connectorID: "connector:docs:default",
              definitionID: "docs",
              name: "Docs API",
              connected: false,
              authStatus: "not_connected",
              credentialKind: "api_key",
              credentialLabel: "Docs API key",
              generatedMcpServerID: "connector.docs.default",
            }),
          ],
          onConnectorApiKeyDraftChange,
          onSaveConnectorApiKey,
        })}
      />,
    )

    fireEvent.change(screen.getByLabelText("Docs API key"), {
      target: {
        value: "sk-next",
      },
    })
    expect(onConnectorApiKeyDraftChange).toHaveBeenCalledWith("connector:docs:default", "sk-next")

    fireEvent.click(screen.getByRole("button", { name: "Update key" }))
    expect(onSaveConnectorApiKey).toHaveBeenCalledWith("connector:docs:default")
  })

  it("edits custom app connector credentials before OAuth sign-in", () => {
    const onConnectorConfigDraftChange = vi.fn()
    const onSaveConnectorConfig = vi.fn()
    const onStartConnectorAuthFlow = vi.fn()
    const feishuConnector = createConnector({
      id: "feishu",
      name: "Feishu",
      configFields: [
        {
          key: "FEISHU_APP_ID",
          label: "Feishu App ID",
          type: "text",
          required: true,
        },
        {
          key: "FEISHU_APP_SECRET",
          label: "Feishu App Secret",
          type: "password",
          required: true,
          secret: true,
        },
      ],
      oauthCallbackURL: "http://localhost:1455/auth/callback",
      credential: {
        kind: "oauth",
        label: "Feishu Custom App",
        clientIDConfigKey: "FEISHU_APP_ID",
        clientSecretConfigKey: "FEISHU_APP_SECRET",
        authorizationURL: "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
        tokenURL: "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
        scopes: ["offline_access"],
        tokenEndpointAuthMethod: "client_secret_post",
        tokenRequestFormat: "json",
      },
    })

    render(
      <ConnectorsPage
        {...createProps({
          activeConnectorID: "connector:feishu:default",
          connectorCatalog: [feishuConnector],
          connectorConfigDrafts: {
            "connector:feishu:default": {
              FEISHU_APP_ID: "cli_existing",
              FEISHU_APP_SECRET: "",
            },
          },
          connectorStatuses: [
            createStatus({
              connectorID: "connector:feishu:default",
              definitionID: "feishu",
              name: "Feishu",
              connected: false,
              configured: false,
              authStatus: "not_connected",
              credentialLabel: undefined,
              email: undefined,
              generatedMcpServerID: "connector.feishu.default",
            }),
          ],
          onConnectorConfigDraftChange,
          onSaveConnectorConfig,
          onStartConnectorAuthFlow,
        })}
      />,
    )

    expect(screen.getByText("http://localhost:1455/auth/callback")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Feishu App ID"), {
      target: {
        value: "cli_next",
      },
    })
    expect(onConnectorConfigDraftChange).toHaveBeenCalledWith("connector:feishu:default", "FEISHU_APP_ID", "cli_next")

    fireEvent.click(screen.getByRole("button", { name: "Save credentials" }))
    expect(onSaveConnectorConfig).toHaveBeenCalledWith("connector:feishu:default")

    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled()
    expect(onStartConnectorAuthFlow).not.toHaveBeenCalled()
  })

  it("can be embedded with an external search field", () => {
    const docsConnector = createConnector({
      id: "docs",
      name: "Docs API",
      publisher: "Anybox",
    })

    render(
      <ConnectorsPage
        {...createProps({
          activeConnectorID: "connector:gmail:default",
          connectorCatalog: [createConnector(), docsConnector],
          connectorStatuses: [
            createStatus(),
            createStatus({
              connectorID: "connector:docs:default",
              definitionID: "docs",
              name: "Docs API",
            }),
          ],
          hideTopMenu: true,
          searchQuery: "docs",
        })}
      />,
    )

    expect(screen.queryByLabelText("Connectors top menu")).not.toBeInTheDocument()
    expect(screen.queryByRole("searchbox", { name: "Search connectors" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Gmail Connected" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Docs API Connected" })).toBeInTheDocument()
  })

  it("shows an MCP empty state when an account connector has no runtimes", () => {
    render(
      <ConnectorsPage
        {...createProps({
          connectorCatalog: [createConnector({
            mcpRuntimes: [],
          })],
          connectorStatuses: [createStatus({
            mcpBindings: [],
            generatedMcpServerID: undefined,
          })],
          mcpServers: [],
        })}
      />,
    )

    fireEvent.click(screen.getByRole("tab", { name: "MCP" }))

    expect(screen.getByRole("heading", { name: "No MCP runtime" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Diagnose" })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  })

  it("selects and controls each MCP runtime independently", () => {
    const onConnectorMcpEnabledChange = vi.fn()
    const onDiagnoseConnector = vi.fn()
    const connector = createConnector({
      mcpRuntimes: [
        {
          id: "mail",
          name: "Mail",
          available: true,
          transport: "stdio",
          command: "node",
          args: ["mail.js"],
          timeoutMs: 10_000,
        },
        {
          id: "admin",
          name: "Admin",
          available: true,
          transport: "remote",
          serverUrl: "https://gmail.example.test/mcp",
          timeoutMs: 20_000,
        },
      ],
    })

    render(
      <ConnectorsPage
        {...createProps({
          connectorCatalog: [connector],
          connectorStatuses: [createStatus({
            mcpBindings: [
              {
                runtimeID: "mail",
                serverID: "connector.gmail.mail",
                name: "Mail",
              },
              {
                runtimeID: "admin",
                serverID: "connector.gmail.admin",
                name: "Admin",
              },
            ],
          })],
          mcpServers: [
            {
              id: "connector.gmail.mail",
              name: "Mail",
              owner: {
                kind: "connector",
                connectorId: "connector:gmail:default",
                runtimeID: "mail",
              },
              transport: "connector",
              connectorId: "connector:gmail:default",
              connectorRuntimeId: "mail",
              enabled: true,
            },
            {
              id: "connector.gmail.admin",
              name: "Admin",
              owner: {
                kind: "connector",
                connectorId: "connector:gmail:default",
                runtimeID: "admin",
              },
              transport: "connector",
              connectorId: "connector:gmail:default",
              connectorRuntimeId: "admin",
              enabled: false,
            },
          ],
          onConnectorMcpEnabledChange,
          onDiagnoseConnector,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("tab", { name: "MCP" }))

    const runtimes = screen.getByRole("radiogroup", { name: "Gmail MCP runtime" })
    expect(screen.getByRole("radio", { name: "Mail" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText("connector.gmail.mail")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("radio", { name: "Admin" }))

    expect(screen.getByRole("radio", { name: "Admin" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText("connector.gmail.admin")).toBeInTheDocument()
    expect(screen.getByText("Streamable HTTP")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("switch", { name: "Enable Admin MCP runtime" }))
    expect(onConnectorMcpEnabledChange).toHaveBeenCalledWith("connector.gmail.admin", true)

    fireEvent.click(screen.getByRole("button", { name: "Diagnose" }))
    expect(onDiagnoseConnector).toHaveBeenCalledWith(
      "connector:gmail:default",
      "admin",
      "connector.gmail.admin",
    )
    expect(runtimes).toBeInTheDocument()
  })

  it("keeps a credential-free account connector visible when its category is explicit", () => {
    const publicConnector = createConnector({
      id: "public-docs",
      name: "Public Docs",
      category: "account_connector",
      credential: undefined,
      mcpRuntimes: [],
    })

    render(
      <ConnectorsPage
        {...createProps({
          activeConnectorID: "connector:public-docs:default",
          connectorCatalog: [publicConnector],
          connectorStatuses: [createStatus({
            connectorID: "connector:public-docs:default",
            definitionID: "public-docs",
            name: "Public Docs",
            credentialKind: undefined,
            credentialLabel: undefined,
            email: undefined,
            mcpBindings: [],
            generatedMcpServerID: undefined,
          })],
          mcpServers: [],
        })}
      />,
    )

    expect(screen.getByRole("button", { name: "Public Docs Connected" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Public Docs", level: 1 })).toBeInTheDocument()
    expect(screen.getByText("No authentication required.")).toBeInTheDocument()
  })

  it("keeps credential-free runtimes out of the account connector module", () => {
    const browserConnector: ConnectorDefinition = {
      ...createConnector(),
      id: "browser",
      name: "Browser",
      description: "Control Chrome through the Anybox Chrome extension.",
      category: "builtin_mcp",
      credential: undefined,
    }
    const nodeReplConnector: ConnectorDefinition = {
      ...createConnector(),
      id: "node-repl",
      name: "Node REPL",
      description: "Run JavaScript in the Anybox Node runtime.",
      category: "builtin_mcp",
      credential: undefined,
    }

    render(
      <ConnectorsPage
        {...createProps({
          activeConnectorID: "connector:browser:default",
          connectorCatalog: [browserConnector, createConnector(), nodeReplConnector],
          connectorStatuses: [
            createStatus({
              connectorID: "connector:browser:default",
              definitionID: "browser",
              name: "Browser",
              credentialKind: undefined,
              credentialLabel: undefined,
              email: undefined,
              generatedMcpServerID: "connector.browser.default",
            }),
            createStatus(),
            createStatus({
              connectorID: "connector:node-repl:default",
              definitionID: "node-repl",
              name: "Node REPL",
              credentialKind: undefined,
              credentialLabel: undefined,
              email: undefined,
              generatedMcpServerID: "connector.node-repl.default",
            }),
          ],
        })}
      />,
    )

    expect(screen.queryByRole("button", { name: "Browser Connected" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Node REPL Connected" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Gmail Connected" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Gmail", level: 1 })).toBeInTheDocument()
  })

})
