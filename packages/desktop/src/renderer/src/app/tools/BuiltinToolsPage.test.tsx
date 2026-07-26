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
    id: "read-file",
    title: "Read File",
    description: "Read a text file or a line range from the current project.",
    aliases: ["read_file"],
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
    expect(screen.getByRole("button", { name: "Write tools, 0 of 1 enabled" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Read tools, 0 of 1 enabled" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Search tools, 1 of 1 enabled" })).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole("button", { name: "Write tools, 0 of 1 enabled" }))
    expect(screen.getByText("Apply Patch")).toBeInTheDocument()
    expect(screen.getByText("High risk")).toBeInTheDocument()
    expect(screen.getByText("1 aliases")).toBeInTheDocument()
    expect(screen.queryByText("Git Bash")).not.toBeInTheDocument()

    const applyPatchSwitch = screen.getByRole("switch", { name: "Apply Patch" })
    expect(applyPatchSwitch).toHaveAttribute("aria-checked", "false")
    fireEvent.click(applyPatchSwitch)
    expect(props.onBuiltinToolToggle).toHaveBeenCalledWith("apply_patch", true)

    fireEvent.click(screen.getByRole("button", { name: "Read tools, 0 of 1 enabled" }))
    expect(screen.getByText("Read File")).toBeInTheDocument()
    expect(screen.getByText("Read-only")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Search tools, 1 of 1 enabled" }))
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
