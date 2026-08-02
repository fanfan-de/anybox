import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n/I18nProvider"
import type { BuiltinToolModuleSummary, BuiltinToolSummary } from "../types"
import { BuiltinToolsPage } from "./BuiltinToolsPage"

function createModule(
  id: string,
  title: string,
  description: string,
  toolIDs: string[],
): BuiltinToolModuleSummary {
  return {
    id,
    title,
    description,
    provider: {
      kind: "builtin",
      id: "anybox",
      name: "Anybox",
    },
    activation: {
      mode: "always",
      scope: "global",
      discovery: "none",
    },
    toolIDs,
  }
}

const builtinToolModules: BuiltinToolModuleSummary[] = [
  createModule(
    "workspace.shell",
    "Shell",
    "Run shell commands and interact with persistent or managed terminal sessions.",
    ["git_bash_command"],
  ),
  createModule(
    "workspace.file-io",
    "File Read and Write",
    "Read, create, edit, patch, and inspect workspace files.",
    ["read_file", "apply_patch"],
  ),
  createModule(
    "runtime.progressive-disclosure",
    "Progressive Disclosure",
    "Discover optional tools, Skills, MCP resources, and bundled workspace runtimes only when needed.",
    ["tool_search"],
  ),
]

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
    moduleID: "workspace.shell",
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
    moduleID: "workspace.file-io",
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
    moduleID: "workspace.file-io",
    enabled: false,
  },
  {
    id: "tool_search",
    title: "Tool Search",
    description: "Search and load optional capability modules or deferred tools.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
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
    moduleID: "runtime.progressive-disclosure",
    enabled: true,
  },
]

function createTool(
  id: string,
  title: string,
  kind: NonNullable<BuiltinToolSummary["capabilities"]["kind"]>,
  moduleID: string,
  enabled = true,
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
    moduleID,
    enabled,
  }
}

function renderBuiltinToolsPage(
  overrides: Partial<Parameters<typeof BuiltinToolsPage>[0]> = {},
  locale?: "zh-CN" | "en-US",
) {
  const props: Parameters<typeof BuiltinToolsPage>[0] = {
    builtinToolModules,
    builtinTools,
    builtinToolsError: null,
    isBuiltinToolSelectionDirty: true,
    isLoadingBuiltinTools: false,
    isSavingBuiltinTools: false,
    onBuiltinToolModuleToggle: vi.fn(),
    onBuiltinToolToggle: vi.fn(),
    onResetBuiltinTools: vi.fn(),
    onSaveBuiltinTools: vi.fn(),
    ...overrides,
  }

  if (locale) {
    window.localStorage.setItem("desktop.locale", locale)
  }

  const page = <BuiltinToolsPage {...props} />
  const renderResult = render(locale ? <I18nProvider>{page}</I18nProvider> : page)
  return { ...props, container: renderResult.container }
}

afterEach(() => {
  window.localStorage.removeItem("desktop.locale")
})

describe("BuiltinToolsPage", () => {
  it("renders server-defined Tool Modules and keeps per-tool controls", () => {
    const props = renderBuiltinToolsPage()

    expect(screen.getByLabelText("Tools top menu")).toBeInTheDocument()
    expect(screen.getByText("Global tool availability")).toBeInTheDocument()
    expect(screen.getByText("2 of 4 built-in tools enabled.")).toBeInTheDocument()

    const moduleList = screen.getByRole("list", { name: "Tool Modules" })
    expect(moduleList).toBeInTheDocument()
    expect(moduleList.querySelector(".skill-tree-role-icon")).toBeNull()

    const executionModule = screen.getByRole("button", {
      name: "Shell module, 1 of 1 tools enabled",
    })
    expect(executionModule).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", {
      name: "File Read and Write module, 0 of 2 tools enabled",
    })).toBeInTheDocument()
    expect(screen.getByText("workspace.shell")).toBeInTheDocument()
    expect(screen.getByText("Built-in · Anybox")).toBeInTheDocument()
    expect(screen.getByText("Always available")).toBeInTheDocument()
    expect(screen.getByText("Global scope")).toBeInTheDocument()
    expect(screen.getByText("Git Bash")).toBeInTheDocument()
    expect(screen.getByText("Shell access")).toBeInTheDocument()
    expect(props.container.querySelector("[class*='settings-']")).toBeNull()

    const moduleSwitch = screen.getByRole("switch", { name: "Change availability for Shell" })
    expect(moduleSwitch).toHaveAttribute("aria-checked", "true")

    fireEvent.click(screen.getByRole("button", { name: "Show details for Git Bash" }))
    expect(screen.getByText("Run a Git Bash/MSYS Bash command inside the current project boundary.")).toBeInTheDocument()
    expect(props.container.querySelector(".tools-card-input-schema pre")?.textContent).toContain('"command"')

    fireEvent.click(screen.getByRole("button", {
      name: "File Read and Write module, 0 of 2 tools enabled",
    }))
    expect(screen.getByText("workspace.file-io")).toBeInTheDocument()
    expect(screen.getByText("Apply Patch")).toBeInTheDocument()
    expect(screen.getByText("Read File")).toBeInTheDocument()
    expect(screen.queryByText("Git Bash")).not.toBeInTheDocument()

    const applyPatchSwitch = screen.getByRole("switch", { name: "Apply Patch" })
    expect(applyPatchSwitch).toHaveAttribute("aria-checked", "false")
    fireEvent.click(applyPatchSwitch)
    expect(props.onBuiltinToolToggle).toHaveBeenCalledWith("apply_patch", true)

    fireEvent.click(screen.getByRole("button", {
      name: "Progressive Disclosure module, 1 of 1 tools enabled",
    }))
    fireEvent.click(screen.getByRole("button", { name: "Show details for Tool Search" }))
    expect(props.container.querySelector(".tools-card-input-schema pre")?.textContent).toContain('"query"')

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(props.onSaveBuiltinTools).toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }))
    expect(props.onResetBuiltinTools).toHaveBeenCalled()
  })

  it("uses the Module switch as a bulk availability control", () => {
    const props = renderBuiltinToolsPage()

    fireEvent.click(screen.getByRole("button", {
      name: "File Read and Write module, 0 of 2 tools enabled",
    }))
    const moduleSwitch = screen.getByRole("switch", { name: "Change availability for File Read and Write" })
    expect(moduleSwitch).toHaveAttribute("aria-checked", "false")
    expect(screen.getByText("All module tools disabled")).toBeInTheDocument()

    fireEvent.click(moduleSwitch)
    expect(props.onBuiltinToolModuleToggle).toHaveBeenCalledWith(["read_file", "apply_patch"], true)
  })

  it("makes a partially enabled Module explicit and enables it as a unit", () => {
    const tools = builtinTools.map((tool) => (
      tool.id === "read_file" ? { ...tool, enabled: true } : tool
    ))
    const props = renderBuiltinToolsPage({ builtinTools: tools })

    fireEvent.click(screen.getByRole("button", {
      name: "File Read and Write module, 1 of 2 tools enabled",
    }))
    expect(screen.getByText("Some module tools available")).toBeInTheDocument()
    const moduleSwitch = screen.getByRole("switch", { name: "Change availability for File Read and Write" })
    expect(moduleSwitch).toHaveAttribute("aria-checked", "false")

    fireEvent.click(moduleSwitch)
    expect(props.onBuiltinToolModuleToggle).toHaveBeenCalledWith(["read_file", "apply_patch"], true)
  })

  it("follows Module Catalog order instead of inferring groups from tool kind", () => {
    const modules = [
      createModule("workspace.lsp", "LSP Tools", "Code navigation.", ["code_probe"]),
      createModule("workspace.shell", "Shell", "Command execution.", ["execution_probe"]),
    ]
    const tools = [
      createTool("execution_probe", "Execution Probe", "search", "workspace.shell"),
      createTool("code_probe", "Code Probe", "exec", "workspace.lsp"),
    ]

    renderBuiltinToolsPage({
      builtinToolModules: modules,
      builtinTools: tools,
    })

    const moduleList = screen.getByRole("list", { name: "Tool Modules" })
    const labels = Array.from(moduleList.querySelectorAll(".skill-tree-label")).map((element) => element.textContent)
    expect(labels).toEqual(["LSP Tools", "Shell"])
    expect(screen.getByText("Code Probe")).toBeInTheDocument()
    expect(screen.queryByText("Execution Probe")).not.toBeInTheDocument()
  })

  it("disables Module and tool switches while changes are being saved", () => {
    renderBuiltinToolsPage({ isSavingBuiltinTools: true })

    expect(screen.getByRole("switch", { name: "Change availability for Shell" })).toBeDisabled()
    expect(screen.getByRole("switch", { name: "Git Bash" })).toBeDisabled()
  })

  it("renders load error, loading, and empty states", () => {
    const { rerender } = render(
      <BuiltinToolsPage
        builtinToolModules={[]}
        builtinTools={[]}
        builtinToolsError="Unable to read tools."
        isBuiltinToolSelectionDirty={false}
        isLoadingBuiltinTools={false}
        isSavingBuiltinTools={false}
        onBuiltinToolModuleToggle={vi.fn()}
        onBuiltinToolToggle={vi.fn()}
        onResetBuiltinTools={vi.fn()}
        onSaveBuiltinTools={vi.fn()}
      />,
    )

    expect(screen.getByText("Unable to read tools.")).toBeInTheDocument()
    expect(screen.getByText("No built-in Tool Modules")).toBeInTheDocument()

    rerender(
      <BuiltinToolsPage
        builtinToolModules={[]}
        builtinTools={[]}
        builtinToolsError={null}
        isBuiltinToolSelectionDirty={false}
        isLoadingBuiltinTools
        isSavingBuiltinTools={false}
        onBuiltinToolModuleToggle={vi.fn()}
        onBuiltinToolToggle={vi.fn()}
        onResetBuiltinTools={vi.fn()}
        onSaveBuiltinTools={vi.fn()}
      />,
    )

    expect(screen.getByText("Fetching Tool Modules")).toBeInTheDocument()
  })

  it("localizes built-in Module and tool catalog copy from stable IDs", () => {
    renderBuiltinToolsPage({}, "zh-CN")

    expect(screen.getByLabelText("工具顶部菜单")).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "工具模块" })).toBeInTheDocument()
    expect(screen.getByRole("button", {
      name: "Shell 模块，已启用 1/1 个工具",
    })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Shell" })).toBeInTheDocument()
    expect(screen.getByText("运行 Shell 命令，并与持久或托管终端会话交互。")).toBeInTheDocument()
    expect(screen.getByText("内置 · Anybox")).toBeInTheDocument()
    expect(screen.getByText("始终可用")).toBeInTheDocument()
    expect(screen.getByText("全局作用域")).toBeInTheDocument()
    expect(screen.getByText("全局工具可用性")).toBeInTheDocument()
    expect(screen.getByText("模块内工具全部可用")).toBeInTheDocument()
    expect(screen.getByRole("switch", {
      name: "切换 Shell 模块内工具的可用性",
    })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "显示 Git Bash 的详情" }))
    expect(screen.getByText("在当前项目边界内运行 Git Bash/MSYS Bash 命令。")).toBeInTheDocument()
    expect(screen.getByText("说明")).toBeInTheDocument()
    expect(screen.getByText("输入 Schema")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", {
      name: "渐进披露 模块，已启用 1/1 个工具",
    }))
    expect(screen.getByRole("heading", { name: "渐进披露" })).toBeInTheDocument()
    expect(screen.getByText("工具搜索")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "保存更改" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "恢复默认" })).toBeInTheDocument()
  })
})
