import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { BuiltinToolSummary } from "../types"
import { BuiltinToolsPage } from "./BuiltinToolsPage"

const builtinTools: BuiltinToolSummary[] = [
  {
    id: "git_bash_command",
    title: "Git Bash",
    description: "Run a Git Bash/MSYS Bash command inside the current project boundary.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
        },
      },
      required: ["command"],
    },
    aliases: [],
    capabilities: {
      kind: "exec",
      readOnly: false,
      destructive: true,
      concurrency: "exclusive",
      needsShell: true,
    },
    enabled: true,
  },
  {
    id: "read_file",
    title: "Read File",
    description: "Read a text file or a line range from the current project.",
    aliases: ["read-file"],
    capabilities: {
      kind: "read",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
    enabled: false,
  },
  {
    id: "apply_patch",
    title: "Apply Patch",
    description: "Use for structured Git-style unified diffs.",
    aliases: ["apply-patch"],
    capabilities: {
      kind: "write",
      readOnly: false,
      destructive: true,
      concurrency: "exclusive",
    },
    enabled: false,
  },
  {
    id: "tool_search",
    title: "Tool Search",
    description:
      "Search currently registered deferred MCP tools. The runtime activates this tool only for turns that have eligible deferred candidates.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
        },
        limit: {
          type: "number",
        },
      },
      required: ["query"],
    },
    aliases: [],
    capabilities: {
      kind: "search",
      readOnly: true,
      destructive: false,
    },
    enabled: true,
  },
]

function createTool(
  id: string,
  title: string,
  kind: NonNullable<BuiltinToolSummary["capabilities"]["kind"]>,
): BuiltinToolSummary {
  return {
    id,
    title,
    description: `${title} description`,
    aliases: [],
    capabilities: {
      kind,
      readOnly: kind === "read" || kind === "search",
      destructive: kind === "write" || kind === "exec",
    },
    enabled: true,
  }
}

function renderBuiltinToolsPage(overrides: Partial<Parameters<typeof BuiltinToolsPage>[0]> = {}) {
  const props: Parameters<typeof BuiltinToolsPage>[0] = {
    builtinTools,
    builtinToolsError: null,
    isBuiltinToolSelectionDirty: true,
    isLoadingBuiltinTools: false,
    isSavingBuiltinTools: false,
    onBuiltinToolToggle: vi.fn(),
    onResetBuiltinTools: vi.fn(),
    onSaveBuiltinTools: vi.fn(),
    ...overrides,
  }

  const renderResult = render(<BuiltinToolsPage {...props} />)
  return { ...props, container: renderResult.container }
}

describe("BuiltinToolsPage", () => {
  it("renders built-in tools, toggles selection, saves, and resets", () => {
    const props = renderBuiltinToolsPage()

    expect(screen.getByLabelText("Tools top menu")).toBeInTheDocument()
    expect(screen.getByText("Global tool availability")).toBeInTheDocument()
    expect(screen.getByText("2 of 4 built-in tools enabled.")).toBeInTheDocument()
    const toolCategories = screen.getByRole("list", { name: "Tool categories" })
    expect(toolCategories).toBeInTheDocument()
    expect(toolCategories.querySelector(".skill-tree-role-icon")).toBeNull()

    const shellCategory = screen.getByRole("button", { name: "Shell tools, 1 of 1 enabled" })
    expect(shellCategory).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "File Tools, 0 of 2 enabled" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Write tools,/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Read tools,/ })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Plugin, Skill & MCP Tools, 1 of 1 enabled" })).toBeInTheDocument()
    expect(screen.getByText("Git Bash")).toBeInTheDocument()
    expect(screen.getByText("Shell access")).toBeInTheDocument()
    expect(props.container.querySelector("[class*='settings-']")).toBeNull()
    expect(screen.queryByText("Run a Git Bash/MSYS Bash command inside the current project boundary.")).not.toBeInTheDocument()
    expect(screen.queryByText("Read File")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Show details for Git Bash" }))
    expect(screen.getByText("Description")).toBeInTheDocument()
    expect(screen.getByText("Run a Git Bash/MSYS Bash command inside the current project boundary.")).toBeInTheDocument()
    expect(screen.getByText("Input schema")).toBeInTheDocument()
    expect(props.container.querySelector(".tools-card-input-schema pre")?.textContent).toContain('"command"')
    expect(screen.getByText("Concurrency")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Hide details for Git Bash" })).toHaveAttribute("aria-expanded", "true")

    fireEvent.click(screen.getByRole("button", { name: "File Tools, 0 of 2 enabled" }))
    expect(screen.getByText("Apply Patch")).toBeInTheDocument()
    expect(screen.getByText("Read File")).toBeInTheDocument()
    expect(screen.getByText("High risk")).toBeInTheDocument()
    expect(screen.getAllByText("1 aliases")).toHaveLength(2)
    expect(screen.queryByText("Git Bash")).not.toBeInTheDocument()

    const applyPatchSwitch = screen.getByRole("switch", { name: "Apply Patch" })
    expect(applyPatchSwitch).toHaveAttribute("aria-checked", "false")
    fireEvent.click(applyPatchSwitch)
    expect(props.onBuiltinToolToggle).toHaveBeenCalledWith("apply_patch", true)

    expect(screen.getByText("Read-only")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Plugin, Skill & MCP Tools, 1 of 1 enabled" }))
    expect(screen.getByText("Tool Search")).toBeInTheDocument()
    expect(screen.getByText("Read-only")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show details for Tool Search" }))
    expect(props.container.querySelector(".tools-card-input-schema pre")?.textContent).toContain('"query"')

    const toolSearchSwitch = screen.getByRole("switch", { name: "Tool Search" })
    expect(toolSearchSwitch).toHaveAttribute("aria-checked", "true")
    fireEvent.click(toolSearchSwitch)
    expect(props.onBuiltinToolToggle).toHaveBeenCalledWith("tool_search", false)

    fireEvent.click(shellCategory)
    const gitBashSwitch = screen.getByRole("switch", { name: "Git Bash" })
    expect(gitBashSwitch).toHaveAttribute("aria-checked", "true")
    fireEvent.click(gitBashSwitch)
    expect(props.onBuiltinToolToggle).toHaveBeenCalledWith("git_bash_command", false)

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(props.onSaveBuiltinTools).toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }))
    expect(props.onResetBuiltinTools).toHaveBeenCalled()
  })

  it("disables tool switches while availability changes are being saved", () => {
    renderBuiltinToolsPage({ isSavingBuiltinTools: true })

    expect(screen.getByRole("switch", { name: "Git Bash" })).toBeDisabled()
  })

  it("keeps platform shells and file operations in their dedicated categories", () => {
    const categorizedTools = [
      createTool("git_bash_command", "Git Bash", "exec"),
      createTool("powershell_command", "PowerShell", "exec"),
      createTool("cmd_command", "Command Prompt", "exec"),
      createTool("wsl_bash_command", "WSL Bash", "exec"),
      createTool("terminal_run_command", "Run Terminal Command", "exec"),
      createTool("terminal_write_input", "Write Terminal Input", "exec"),
      createTool("stop_background_task", "Stop Background Task", "exec"),
      createTool("read_file", "Read File", "read"),
      createTool("list_directory", "List Directory", "read"),
      createTool("replace_text", "Replace Text", "write"),
      createTool("apply_patch", "Apply Patch", "write"),
      createTool("view_image", "View Image", "read"),
      createTool("glob", "Glob", "search"),
      createTool("grep", "Grep", "search"),
    ]

    renderBuiltinToolsPage({ builtinTools: categorizedTools })

    const shellCategory = screen.getByRole("button", { name: "Shell tools, 4 of 4 enabled" })
    const fileCategory = screen.getByRole("button", { name: "File Tools, 7 of 7 enabled" })
    const otherCategory = screen.getByRole("button", { name: "Other tools, 3 of 3 enabled" })

    expect(screen.getByText("Git Bash")).toBeInTheDocument()
    expect(screen.getByText("PowerShell")).toBeInTheDocument()
    expect(screen.getByText("Command Prompt")).toBeInTheDocument()
    expect(screen.getByText("WSL Bash")).toBeInTheDocument()
    expect(screen.queryByText("Run Terminal Command")).not.toBeInTheDocument()

    fireEvent.click(fileCategory)
    expect(screen.getByText("Read File")).toBeInTheDocument()
    expect(screen.getByText("List Directory")).toBeInTheDocument()
    expect(screen.getByText("Replace Text")).toBeInTheDocument()
    expect(screen.getByText("Apply Patch")).toBeInTheDocument()
    expect(screen.getByText("View Image")).toBeInTheDocument()
    expect(screen.getByText("Glob")).toBeInTheDocument()
    expect(screen.getByText("Grep")).toBeInTheDocument()
    expect(screen.queryByText("Git Bash")).not.toBeInTheDocument()

    fireEvent.click(otherCategory)
    expect(screen.getByText("Run Terminal Command")).toBeInTheDocument()
    expect(screen.getByText("Write Terminal Input")).toBeInTheDocument()
    expect(screen.getByText("Stop Background Task")).toBeInTheDocument()
    expect(screen.queryByText("PowerShell")).not.toBeInTheDocument()

    fireEvent.click(shellCategory)
    expect(screen.getByText("Git Bash")).toBeInTheDocument()
  })

  it("labels delegation tools as the Multi-Agent Tools category", () => {
    renderBuiltinToolsPage({
      builtinTools: [
        createTool("spawn_subagent", "Spawn Subagent", "delegation"),
        createTool("read_subagent", "Read Subagent", "delegation"),
        createTool("wait_subagent", "Wait Subagent", "delegation"),
        createTool("cancel_subagent", "Cancel Subagent", "delegation"),
      ],
    })

    expect(screen.getByRole("button", { name: "Multi-Agent Tools, 4 of 4 enabled" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Delegation tools,/ })).not.toBeInTheDocument()
    expect(screen.getByText("Spawn Subagent")).toBeInTheDocument()
    expect(screen.getByText("Read Subagent")).toBeInTheDocument()
    expect(screen.getByText("Wait Subagent")).toBeInTheDocument()
    expect(screen.getByText("Cancel Subagent")).toBeInTheDocument()
  })

  it("groups user questions and task tools as Product Interaction Tools", () => {
    renderBuiltinToolsPage({
      builtinTools: [
        createTool("ask_user_question", "Ask User Question", "interaction"),
        createTool("task_create", "Create Tasks", "workflow"),
        createTool("task_get", "Get Task", "workflow"),
        createTool("task_list", "List Tasks", "workflow"),
        createTool("task_update", "Update Task", "workflow"),
      ],
    })

    expect(screen.getByRole("button", { name: "Product Interaction Tools, 5 of 5 enabled" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Interaction tools,/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Workflow tools,/ })).not.toBeInTheDocument()
    expect(screen.getByText("Ask User Question")).toBeInTheDocument()
    expect(screen.getByText("Create Tasks")).toBeInTheDocument()
    expect(screen.getByText("Get Task")).toBeInTheDocument()
    expect(screen.getByText("List Tasks")).toBeInTheDocument()
    expect(screen.getByText("Update Task")).toBeInTheDocument()
  })

  it("groups every LSP operation as Code Tools", () => {
    renderBuiltinToolsPage({
      builtinTools: [
        createTool("lsp_definition", "LSP Definition", "search"),
        createTool("lsp_references", "LSP References", "search"),
        createTool("lsp_hover", "LSP Hover", "read"),
        createTool("lsp_workspace_symbols", "LSP Workspace Symbols", "search"),
      ],
    })

    expect(screen.getByRole("button", { name: "Code Tools, 4 of 4 enabled" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Search tools,/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Read tools,/ })).not.toBeInTheDocument()
    expect(screen.getByText("LSP Definition")).toBeInTheDocument()
    expect(screen.getByText("LSP References")).toBeInTheDocument()
    expect(screen.getByText("LSP Hover")).toBeInTheDocument()
    expect(screen.getByText("LSP Workspace Symbols")).toBeInTheDocument()
  })

  it("groups Skill and MCP entry points as Plugin, Skill & MCP Tools", () => {
    renderBuiltinToolsPage({
      builtinTools: [
        createTool("load_skill", "Load Skill", "read"),
        createTool("read_skill_resource", "Read Skill Resource", "read"),
        createTool("list_mcp_resources", "List MCP Resources", "read"),
        createTool("list_mcp_resource_templates", "List MCP Resource Templates", "read"),
        createTool("read_mcp_resource", "Read MCP Resource", "read"),
        createTool("tool_search", "Tool Search", "search"),
      ],
    })

    expect(screen.getByRole("button", { name: "Plugin, Skill & MCP Tools, 6 of 6 enabled" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Search tools,/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Read tools,/ })).not.toBeInTheDocument()
    expect(screen.getByText("Load Skill")).toBeInTheDocument()
    expect(screen.getByText("Read Skill Resource")).toBeInTheDocument()
    expect(screen.getByText("List MCP Resources")).toBeInTheDocument()
    expect(screen.getByText("List MCP Resource Templates")).toBeInTheDocument()
    expect(screen.getByText("Read MCP Resource")).toBeInTheDocument()
    expect(screen.getByText("Tool Search")).toBeInTheDocument()
  })

  it("keeps the user-defined tool categories in the requested order", () => {
    renderBuiltinToolsPage({
      builtinTools: [
        createTool("git_bash_command", "Git Bash", "exec"),
        createTool("read_file", "Read File", "read"),
        createTool("spawn_subagent", "Spawn Subagent", "delegation"),
        createTool("ask_user_question", "Ask User Question", "interaction"),
        createTool("lsp_definition", "LSP Definition", "search"),
        createTool("load_skill", "Load Skill", "read"),
      ],
    })

    const categories = screen.getByRole("list", { name: "Tool categories" })
    const labels = Array.from(categories.querySelectorAll(".skill-tree-label")).map((element) => element.textContent)
    expect(labels).toEqual([
      "Shell",
      "File Tools",
      "Multi-Agent Tools",
      "Product Interaction Tools",
      "Code Tools",
      "Plugin, Skill & MCP Tools",
    ])
  })

  it("recognizes the macOS shell tool as the platform Shell category", () => {
    renderBuiltinToolsPage({
      builtinTools: [{
        id: "macos_shell_command",
        title: "macOS Shell",
        description: "Run a macOS shell command.",
        aliases: [],
        capabilities: {
          kind: "exec",
          readOnly: false,
          destructive: true,
          needsShell: true,
        },
        enabled: true,
      }],
    })

    expect(screen.getByRole("button", { name: "Shell tools, 1 of 1 enabled" })).toBeInTheDocument()
    expect(screen.getByText("macOS Shell")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Other tools,/ })).not.toBeInTheDocument()
  })

  it("renders load error, loading, and empty states", () => {
    const { rerender } = render(
      <BuiltinToolsPage
        builtinTools={[]}
        builtinToolsError="Unable to read tools."
        isBuiltinToolSelectionDirty={false}
        isLoadingBuiltinTools={false}
        isSavingBuiltinTools={false}
        onBuiltinToolToggle={vi.fn()}
        onResetBuiltinTools={vi.fn()}
        onSaveBuiltinTools={vi.fn()}
      />,
    )

    expect(screen.getByText("Unable to read tools.")).toBeInTheDocument()
    expect(screen.getByText("No built-in tools")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Dismiss tools message" })).not.toBeInTheDocument()

    rerender(
      <BuiltinToolsPage
        builtinTools={[]}
        builtinToolsError={null}
        isBuiltinToolSelectionDirty={false}
        isLoadingBuiltinTools
        isSavingBuiltinTools={false}
        onBuiltinToolToggle={vi.fn()}
        onResetBuiltinTools={vi.fn()}
        onSaveBuiltinTools={vi.fn()}
      />,
    )

    expect(screen.getByText("Fetching built-in tools")).toBeInTheDocument()
  })
})
