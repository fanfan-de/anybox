import { fireEvent, render, screen, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { describe, expect, it, vi } from "vitest"
import type { McpServerDiagnostic, McpServerDraftState } from "../types"
import { McpServersPage } from "./McpServersPage"

function createDraft(overrides: Partial<McpServerDraftState> = {}): McpServerDraftState {
  return {
    id: "context7",
    name: "Context7",
    transport: "remote",
    command: "",
    args: "",
    env: "",
    cwd: "",
    serverUrl: "https://mcp.context7.com/mcp",
    connectorId: "",
    authorization: "",
    headers: "",
    allowedToolsMode: "all",
    allowedToolNames: "",
    toolPolicies: {},
    enabled: true,
    timeoutMs: "",
    ...overrides,
  }
}

function createDiagnostic(overrides: Partial<McpServerDiagnostic> = {}): McpServerDiagnostic {
  return {
    serverID: "context7",
    enabled: true,
    ok: true,
    toolCount: 2,
    toolNames: ["resolve-library-id", "get-library-docs"],
    tools: [
      {
        name: "resolve-library-id",
        title: "Resolve Library ID",
        displayName: "Resolve Library ID",
        description: "Resolve a package name to a Context7 library id.",
        inputSchema: {
          type: "object",
          properties: {
            libraryName: {
              type: "string",
            },
          },
        },
        annotations: {
          readOnlyHint: true,
        },
        riskHint: "read-only",
        recommendedPolicy: "auto",
      },
      {
        name: "get-library-docs",
        title: "Get Library Docs",
        displayName: "Get Library Docs",
        description: "Fetch documentation for a library.",
        inputSchema: {
          type: "object",
        },
        annotations: {},
        riskHint: "unknown",
        recommendedPolicy: "ask",
      },
    ],
    ...overrides,
  }
}

function createProps(
  overrides: Partial<ComponentProps<typeof McpServersPage>> = {},
): ComponentProps<typeof McpServersPage> {
  return {
    activeMcpServerID: "context7",
    activeMcpServerDiagnostic: createDiagnostic(),
    deletingMcpServerID: null,
    isLoading: false,
    loadError: null,
    mcpServerDraft: createDraft(),
    mcpServers: [
      {
        id: "context7",
        name: "Context7",
        transport: "remote",
        serverUrl: "https://mcp.context7.com/mcp",
        enabled: true,
      },
    ],
    savingMcpServerID: null,
    isImportingMcpConfigJson: false,
    onDeleteMcpServer: vi.fn(),
    onImportMcpConfigJson: vi.fn(),
    onMcpServerDraftChange: vi.fn(),
    onMcpToolPolicyChange: vi.fn(),
    onMcpServerSelect: vi.fn(),
    onSaveMcpServer: vi.fn(),
    onStartNewMcpServer: vi.fn(),
    ...overrides,
  }
}

function getToolPolicyCombobox(toolName: string) {
  return screen.getByRole("combobox", { name: `Policy for ${toolName}` })
}

function expectToolPolicyLabel(toolName: string, label: string) {
  expect(getToolPolicyCombobox(toolName)).toHaveTextContent(label)
}

function selectToolPolicy(toolName: string, label: string) {
  fireEvent.click(getToolPolicyCombobox(toolName))
  fireEvent.click(screen.getByRole("option", { name: label }))
}

describe("McpServersPage tool policies", () => {
  it("renders discovered tools and changes a per-tool policy", () => {
    const onMcpToolPolicyChange = vi.fn()

    render(<McpServersPage {...createProps({ onMcpToolPolicyChange })} />)

    expect(screen.getByText("Tool Permissions")).toBeInTheDocument()
    expect(screen.getByText("resolve-library-id")).toBeInTheDocument()
    expect(screen.getByText("get-library-docs")).toBeInTheDocument()
    expect(screen.getByText("read-only")).toBeInTheDocument()
    const policyPanel = screen.getByRole("region", { name: "MCP tool permissions" })
    expect(within(policyPanel).queryByText("Resolve a package name to a Context7 library id.")).not.toBeInTheDocument()
    expect(within(policyPanel).queryByText("Input schema")).not.toBeInTheDocument()

    expectToolPolicyLabel("get-library-docs", "Auto allow")

    selectToolPolicy("get-library-docs", "Disabled")

    expect(onMcpToolPolicyChange).toHaveBeenCalledWith("get-library-docs", "disabled")

    const resolveDetailsButton = screen.getByRole("button", { name: "Show details for resolve-library-id" })
    expect(resolveDetailsButton).toHaveAttribute("aria-expanded", "false")

    fireEvent.click(resolveDetailsButton)

    expect(resolveDetailsButton).toHaveAttribute("aria-expanded", "true")
    expect(within(policyPanel).getByText("Resolve a package name to a Context7 library id.")).toBeInTheDocument()
    expect(within(policyPanel).getByText("Input schema")).toBeInTheDocument()
    expect(within(policyPanel).getByText(/"libraryName"/)).toBeInTheDocument()
  })

  it("summarizes selected MCP capabilities before configuration details", () => {
    render(<McpServersPage {...createProps()} />)

    expect(screen.getByText("Documentation")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Context7" })).toBeInTheDocument()
    expect(screen.getByText("This MCP makes Resolve Library ID, Get Library Docs available to the assistant.")).toBeInTheDocument()
    expect(screen.queryByLabelText("MCP status")).not.toBeInTheDocument()
    expect(screen.queryByText("Reachable - 2 tools")).not.toBeInTheDocument()
  })

  it("labels MCP servers generated by installed plugins", () => {
    render(
      <McpServersPage
        {...createProps({
          activeMcpServerID: "plugin.build-web-apps",
          activeMcpServerDiagnostic: createDiagnostic({
            serverID: "plugin.build-web-apps",
          }),
          installedPlugins: [
            {
              pluginID: "build-web-apps",
              version: "1.0.0",
              enabled: true,
              mcpServerIDs: ["plugin.build-web-apps"],
              skillIDs: [],
              connectorIDs: [],
              connectorRequirementIDs: [],
              config: {},
              installedAt: 0,
              updatedAt: 0,
            },
          ],
          pluginCatalog: [
            {
              id: "build-web-apps",
              name: "Build Web Apps",
            },
          ] as ComponentProps<typeof McpServersPage>["pluginCatalog"],
          mcpServerDraft: createDraft({
            id: "plugin.build-web-apps",
            name: "Build Web Apps",
            transport: "stdio",
            command: "build-web-apps-mcp",
            serverUrl: "",
          }),
          mcpServers: [
            {
              id: "plugin.build-web-apps",
              name: "Build Web Apps",
              transport: "stdio",
              command: "build-web-apps-mcp",
              enabled: true,
            },
          ],
        })}
      />,
    )

    const list = screen.getByRole("list", { name: "MCP servers" })
    expect(within(list).getByRole("button", { name: "Build Web Apps from plugin Build Web Apps enabled" })).toBeInTheDocument()
    expect(within(list).getByText("Plugin")).toBeInTheDocument()
    expect(screen.getByText("From plugin: Build Web Apps")).toBeInTheDocument()
  })

  it("switches transport from the segmented control", () => {
    const onMcpServerDraftChange = vi.fn()

    render(<McpServersPage {...createProps({ onMcpServerDraftChange })} />)

    expect(screen.getByRole("radiogroup", { name: "MCP server transport" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "流式 HTTP" })).toHaveAttribute("aria-checked", "true")

    fireEvent.click(screen.getByRole("radio", { name: "STDIO" }))

    expect(onMcpServerDraftChange).toHaveBeenCalledWith("transport", "stdio")
  })

  it("shows connector MCP servers without treating them as HTTP servers", () => {
    render(
      <McpServersPage
        {...createProps({
          activeMcpServerID: "plugin.gmail.connector.gmail",
          activeMcpServerDiagnostic: createDiagnostic({
            serverID: "plugin.gmail.connector.gmail",
            ok: false,
            toolCount: 0,
            toolNames: [],
            tools: [],
            error: "Not connected",
          }),
          mcpServerDraft: createDraft({
            id: "plugin.gmail.connector.gmail",
            name: "Gmail: Gmail",
            transport: "connector",
            serverUrl: "",
            connectorId: "plugin-connector:gmail:gmail",
          }),
          mcpServers: [
            {
              id: "plugin.gmail.connector.gmail",
              name: "Gmail: Gmail",
              transport: "connector",
              connectorId: "plugin-connector:gmail:gmail",
              enabled: true,
            },
          ],
        })}
      />,
    )

    expect(screen.getByRole("radio", { name: "CONNECTOR" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByLabelText("MCP connector id")).toHaveValue("plugin-connector:gmail:gmail")
    expect(screen.queryByText("Remote MCP servers require a server URL.")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("MCP server URL")).not.toBeInTheDocument()
  })

  it("shows the tools policy section for stdio MCP servers", () => {
    render(
      <McpServersPage
        {...createProps({
          activeMcpServerDiagnostic: createDiagnostic({
            serverID: "pencil",
            toolCount: 1,
            toolNames: ["batch_design"],
            tools: [
              {
                name: "batch_design",
                displayName: "batch_design",
                description: "Execute design operations.",
                annotations: {},
                riskHint: "unknown",
                recommendedPolicy: "ask",
              },
            ],
          }),
          mcpServerDraft: createDraft({
            id: "pencil",
            name: "Pencil",
            transport: "stdio",
            command: "pencil-mcp.exe",
            serverUrl: "",
          }),
          mcpServers: [
            {
              id: "pencil",
              name: "Pencil",
              transport: "stdio",
              command: "pencil-mcp.exe",
              enabled: true,
            },
          ],
        })}
      />,
    )

    expect(screen.getByText("Tool Permissions")).toBeInTheDocument()
    expect(screen.getAllByText("batch_design")).toHaveLength(2)
    expectToolPolicyLabel("batch_design", "Auto allow")
  })

  it("edits stdio arguments and environment variables as rows", () => {
    const onMcpServerDraftChange = vi.fn()

    render(
      <McpServersPage
        {...createProps({
          activeMcpServerDiagnostic: createDiagnostic({
            serverID: "pencil",
            toolCount: 0,
            toolNames: [],
            tools: [],
          }),
          mcpServerDraft: createDraft({
            id: "pencil",
            name: "Pencil",
            transport: "stdio",
            command: "pencil-mcp.exe",
            args: "--app\ndesktop",
            env: "FOO=bar",
            serverUrl: "",
          }),
          mcpServers: [
            {
              id: "pencil",
              name: "Pencil",
              transport: "stdio",
              command: "pencil-mcp.exe",
              enabled: true,
            },
          ],
          onMcpServerDraftChange,
        })}
      />,
    )

    fireEvent.change(screen.getByLabelText("Arguments 2"), {
      target: {
        value: "server",
      },
    })
    expect(onMcpServerDraftChange).toHaveBeenCalledWith("args", "--app\nserver")

    fireEvent.change(screen.getByLabelText("Environment key 1"), {
      target: {
        value: "TOKEN",
      },
    })
    expect(onMcpServerDraftChange).toHaveBeenCalledWith("env", "TOKEN=bar")

    fireEvent.click(screen.getByRole("button", { name: "Add argument" }))
    expect(onMcpServerDraftChange).toHaveBeenCalledWith("args", "--app\ndesktop\n")
  })

  it("filters the MCP server list from the search field", () => {
    render(
      <McpServersPage
        {...createProps({
          mcpServers: [
            {
              id: "context7",
              name: "Context7",
              transport: "remote",
              serverUrl: "https://mcp.context7.com/mcp",
              enabled: true,
            },
            {
              id: "pencil",
              name: "Pencil",
              transport: "stdio",
              command: "pencil-mcp.exe",
              enabled: true,
            },
          ],
        })}
      />,
    )

    const list = screen.getByRole("list", { name: "MCP servers" })
    expect(within(list).getByRole("button", { name: "Context7 enabled" })).toBeInTheDocument()
    expect(within(list).getByRole("button", { name: "Pencil enabled" })).toBeInTheDocument()

    fireEvent.change(screen.getByRole("searchbox", { name: "Search MCP servers" }), {
      target: {
        value: "pencil",
      },
    })

    expect(within(list).queryByRole("button", { name: "Context7 enabled" })).not.toBeInTheDocument()
    expect(within(list).getByRole("button", { name: "Pencil enabled" })).toBeInTheDocument()
  })

  it("can be embedded with an external search field", () => {
    render(
      <McpServersPage
        {...createProps({
          hideTopMenu: true,
          searchQuery: "pencil",
          mcpServers: [
            {
              id: "context7",
              name: "Context7",
              transport: "remote",
              serverUrl: "https://mcp.context7.com/mcp",
              enabled: true,
            },
            {
              id: "pencil",
              name: "Pencil",
              transport: "stdio",
              command: "pencil-mcp.exe",
              enabled: true,
            },
          ],
        })}
      />,
    )

    const list = screen.getByRole("list", { name: "MCP servers" })
    expect(screen.queryByLabelText("MCP top menu")).not.toBeInTheDocument()
    expect(screen.queryByRole("searchbox", { name: "Search MCP servers" })).not.toBeInTheDocument()
    expect(within(list).queryByRole("button", { name: "Context7 enabled" })).not.toBeInTheDocument()
    expect(within(list).getByRole("button", { name: "Pencil enabled" })).toBeInTheDocument()
  })

  it("maps legacy remote read-only filters to understandable tool policy defaults", () => {
    render(
      <McpServersPage
        {...createProps({
          activeMcpServerDiagnostic: createDiagnostic({
            toolCount: 1,
            toolNames: ["resolve-library-id"],
            tools: [
              ...createDiagnostic().tools,
              {
                name: "write-docs",
                displayName: "write-docs",
                description: "Pretend to mutate documentation.",
                annotations: {},
                riskHint: "unknown",
                recommendedPolicy: "ask",
              },
            ],
          }),
          mcpServerDraft: createDraft({
            allowedToolsMode: "read-only",
          }),
        })}
      />,
    )

    expectToolPolicyLabel("resolve-library-id", "Auto allow")
    expectToolPolicyLabel("write-docs", "Disabled")
  })

  it("previews and submits imported MCP JSON", async () => {
    const onImportMcpConfigJson = vi.fn().mockResolvedValue(true)

    render(<McpServersPage {...createProps({ onImportMcpConfigJson })} />)

    fireEvent.click(screen.getByRole("button", { name: "Import JSON" }))
    fireEvent.change(screen.getByLabelText("MCP configuration JSON"), {
      target: {
        value: JSON.stringify({
          mcpServers: {
            filesystem: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem"],
            },
          },
        }),
      },
    })

    expect(screen.getByText(/Detected 1 MCP server/)).toBeInTheDocument()

    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Install from MCP JSON" })).getByRole("button", {
        name: "Import JSON",
      }),
    )

    expect(onImportMcpConfigJson).toHaveBeenCalledWith(expect.stringContaining("filesystem"))
  })
})
