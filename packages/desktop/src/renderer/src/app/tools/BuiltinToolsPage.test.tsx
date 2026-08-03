import { fireEvent, render, screen, within } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "../i18n/I18nProvider"
import type { BuiltinToolModuleSummary, BuiltinToolSummary, OnDemandToolSummary } from "../types"
import { BuiltinToolsPage } from "./BuiltinToolsPage"

const toolsStyles = readFileSync(resolve(process.cwd(), "src/renderer/src/styles/tools.css"), "utf8")

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

const onDemandToolModules: BuiltinToolModuleSummary[] = [{
  id: "planner.core",
  title: "Planner",
  description: "Manage Anybox todos and schedules.",
  provider: {
    kind: "native",
    id: "anybox",
    name: "Anybox",
  },
  activation: {
    mode: "search-or-explicit",
    scope: "turn",
    discovery: "module",
  },
  toolIDs: ["planner_list_todos", "planner_create_todo"],
}]

const onDemandTools: OnDemandToolSummary[] = [
  {
    id: "planner_list_todos",
    title: "List Planner Todos",
    description: "List Anybox Planner todos.",
    inputSchema: { type: "object", properties: { status: { type: "string" } } },
    aliases: [],
    capabilities: {
      kind: "read",
      readOnly: true,
      destructive: false,
      concurrency: "safe",
    },
    moduleID: "planner.core",
  },
  {
    id: "planner_create_todo",
    title: "Create Planner Todo",
    description: "Create one Anybox Planner todo.",
    aliases: [],
    capabilities: {
      kind: "write",
      readOnly: false,
      destructive: false,
      concurrency: "exclusive",
    },
    moduleID: "planner.core",
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
    onDemandToolFailures: [],
    onDemandToolModules,
    onDemandTools,
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
  it("keeps long tool catalogs inside a themed detail-panel scroll region", () => {
    expect(toolsStyles).toMatch(
      /\.builtin-tools-page \.tools-page-main\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior-y:\s*contain;[^}]*scrollbar-gutter:\s*stable;[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*var\(--tools-scrollbar-thumb\) var\(--tools-scrollbar-track\);/s,
    )
    expect(toolsStyles).toMatch(
      /\.builtin-tools-page \.tools-detail-panel\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior-y:\s*contain;[^}]*scrollbar-gutter:\s*stable;[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*var\(--tools-scrollbar-thumb\) var\(--tools-scrollbar-track\);/s,
    )
    expect(toolsStyles).toMatch(
      /\.builtin-tools-page \.tools-page-main::-webkit-scrollbar-thumb,\s*\.builtin-tools-page \.tools-detail-panel::-webkit-scrollbar-thumb\s*\{[^}]*min-height:\s*32px;[^}]*background-color:\s*var\(--tools-scrollbar-thumb\);[^}]*background-clip:\s*content-box;/s,
    )
  })

  it("keeps availability controls in one compact row and wraps them on narrow screens", () => {
    expect(toolsStyles).toMatch(
      /\.builtin-tools-page \.tools-availability-toolbar\s*\{[^}]*min-height:\s*52px;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;[^}]*align-items:\s*center;/s,
    )
    expect(toolsStyles).toMatch(
      /@media \(max-width: 900px\)\s*\{[\s\S]*?\.builtin-tools-page \.tools-availability-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*align-items:\s*stretch;/s,
    )
  })

  it("renders server-defined Tool Modules and keeps per-tool controls", () => {
    const props = renderBuiltinToolsPage()

    expect(screen.getByLabelText("Tools top menu")).toBeInTheDocument()
    const availabilityToolbar = screen.getByRole("group", { name: "Availability" })
    expect(availabilityToolbar).toHaveClass("tools-availability-toolbar")
    expect(within(availabilityToolbar).getByText("Global 2/4")).toBeInTheDocument()
    expect(within(availabilityToolbar).getByText("This module 1/1")).toBeInTheDocument()
    expect(within(availabilityToolbar).getByText("Enable all")).toBeInTheDocument()

    expect(screen.getByRole("heading", { name: "Always-on Tool Modules" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "On-demand Tool Modules" })).toBeInTheDocument()
    const moduleList = screen.getByRole("list", { name: "Always-on Tool Modules" })
    expect(moduleList).toBeInTheDocument()
    expect(moduleList.querySelector(".skill-tree-role-icon")).toBeNull()
    expect(screen.getByRole("list", { name: "On-demand Tool Modules" })).toBeInTheDocument()

    const executionModule = screen.getByRole("button", {
      name: "Shell module, 1 of 1 tools enabled",
    })
    expect(executionModule).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", {
      name: "File Read and Write module, 0 of 2 tools enabled",
    })).toBeInTheDocument()
    expect(screen.getByText("workspace.shell")).toBeInTheDocument()
    expect(screen.getByText("Built-in · Anybox")).toBeInTheDocument()
    expect(screen.getByText("Activation: Always available")).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole("button", { name: "Reset all tools" }))
    expect(props.onResetBuiltinTools).toHaveBeenCalled()
  })

  it("uses the Module switch as a bulk availability control", () => {
    const props = renderBuiltinToolsPage()

    fireEvent.click(screen.getByRole("button", {
      name: "File Read and Write module, 0 of 2 tools enabled",
    }))
    const moduleSwitch = screen.getByRole("switch", { name: "Change availability for File Read and Write" })
    expect(moduleSwitch).toHaveAttribute("aria-checked", "false")
    expect(screen.getByText("This module 0/2")).toBeInTheDocument()

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
    expect(screen.getByText("This module 1/2")).toBeInTheDocument()
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

    const moduleList = screen.getByRole("list", { name: "Always-on Tool Modules" })
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

  it("shows Planner tools as read-only current-turn capabilities", () => {
    const props = renderBuiltinToolsPage()

    const plannerModule = screen.getByRole("button", {
      name: "Planner module, 2 tools, on demand",
    })
    fireEvent.click(plannerModule)

    expect(screen.getByText("planner.core")).toBeInTheDocument()
    expect(screen.getByText("Native · Anybox")).toBeInTheDocument()
    expect(screen.getByText("Activation: On demand")).toBeInTheDocument()
    expect(screen.getByText("On demand")).toBeInTheDocument()
    expect(screen.getByText("Current-turn scope")).toBeInTheDocument()
    const onDemandToolbar = screen.getByRole("note", { name: "On-demand tool catalog" })
    expect(within(onDemandToolbar).getByText("On-demand tool catalog")).toBeInTheDocument()
    expect(within(onDemandToolbar).getByText("2 tools")).toBeInTheDocument()
    expect(within(onDemandToolbar).getByText(
      "Browsing does not load tools; use Tool Search, @计划, /计划, /planner, or Planner delegation.",
    )).toBeInTheDocument()
    expect(props.container.querySelector(".tools-detail-header")).not.toBeInTheDocument()
    expect(props.container.querySelector(".tools-on-demand-notice")).not.toBeInTheDocument()
    expect(screen.getByText("List Planner Todos")).toBeInTheDocument()
    expect(screen.getByText("Create Planner Todo")).toBeInTheDocument()
    expect(screen.queryByRole("group", { name: "Availability" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reset all tools" })).not.toBeInTheDocument()
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Show details for List Planner Todos" }))
    expect(props.container.querySelector(".tools-card-input-schema pre")?.textContent).toContain('"status"')
    expect(props.onBuiltinToolToggle).not.toHaveBeenCalled()
    expect(props.onBuiltinToolModuleToggle).not.toHaveBeenCalled()
  })

  it("keeps always-on modules usable when on-demand inspection reports a failure", () => {
    renderBuiltinToolsPage({
      onDemandToolFailures: [{ moduleID: "planner.core", message: "Planner metadata unavailable" }],
      onDemandToolModules: [],
      onDemandTools: [],
    })

    expect(screen.getByText("Some on-demand modules could not be inspected.")).toBeInTheDocument()
    expect(screen.getByText("planner.core: Planner metadata unavailable")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Shell module, 1 of 1 tools enabled" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Change availability for Shell" })).toBeInTheDocument()
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
        onDemandToolFailures={[]}
        onDemandToolModules={[]}
        onDemandTools={[]}
        onBuiltinToolModuleToggle={vi.fn()}
        onBuiltinToolToggle={vi.fn()}
        onResetBuiltinTools={vi.fn()}
        onSaveBuiltinTools={vi.fn()}
      />,
    )

    expect(screen.getByText("Unable to read tools.")).toBeInTheDocument()
    expect(screen.getByText("No Tool Modules")).toBeInTheDocument()

    rerender(
      <BuiltinToolsPage
        builtinToolModules={[]}
        builtinTools={[]}
        builtinToolsError={null}
        isBuiltinToolSelectionDirty={false}
        isLoadingBuiltinTools
        isSavingBuiltinTools={false}
        onDemandToolFailures={[]}
        onDemandToolModules={[]}
        onDemandTools={[]}
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
    expect(screen.getByRole("list", { name: "常驻工具模块" })).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "按需工具模块" })).toBeInTheDocument()
    expect(screen.getByRole("button", {
      name: "Shell 模块，已启用 1/1 个工具",
    })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Shell" })).toBeInTheDocument()
    expect(screen.getByText("运行 Shell 命令，并与持久或托管终端会话交互。")).toBeInTheDocument()
    expect(screen.getByText("内置 · Anybox")).toBeInTheDocument()
    expect(screen.getByText("激活策略：始终可用")).toBeInTheDocument()
    expect(screen.getByText("全局作用域")).toBeInTheDocument()
    const availabilityToolbar = screen.getByRole("group", { name: "可用性" })
    expect(within(availabilityToolbar).getByText("全局 2/4")).toBeInTheDocument()
    expect(within(availabilityToolbar).getByText("本模块 1/1")).toBeInTheDocument()
    expect(within(availabilityToolbar).getByText("全部启用")).toBeInTheDocument()
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
    expect(screen.getByRole("button", { name: "重置全部工具" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", {
      name: "Planner 模块，共 2 个工具，按需加载",
    }))
    const onDemandToolbar = screen.getByRole("note", { name: "按需工具目录" })
    expect(within(onDemandToolbar).getByText("按需工具目录")).toBeInTheDocument()
    expect(within(onDemandToolbar).getByText("2 个工具")).toBeInTheDocument()
    expect(within(onDemandToolbar).getByText(
      "浏览不会加载工具；可通过工具搜索、@计划、/计划、/planner 或 Planner 委派使用。",
    )).toBeInTheDocument()
    expect(screen.getByText("列出 Planner 待办")).toBeInTheDocument()
    expect(screen.queryByText("仅为当前轮次加载")).not.toBeInTheDocument()
    expect(screen.queryByRole("switch")).not.toBeInTheDocument()
  })
})
