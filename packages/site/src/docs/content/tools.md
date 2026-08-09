# 工具系统

工具决定 Agent 能读取、搜索、执行或修改什么。桌面端“工具”页面只管理内置工具的全局可用性；实际执行仍受 Agent、会话和调用级权限限制。

> 可见工具会随操作系统、工作区类型、MCP 连接和 Agent 策略变化。

## 工具模块一览

“工具”页面按能力模块组织工具。常驻模块始终进入运行时目录，可在全局设置中启用或禁用；按需模块只在当前任务确实需要时加载。

| 模块 | 加载方式 | 工具数 | 主要用途 |
| --- | --- | ---: | --- |
| 人机交互 | 常驻 | 1 | 向用户提出结构化问题并等待回复 |
| 任务 | 常驻 | 4 | 跟踪当前 Agent 执行中的计划、依赖和进度 |
| 文件读写 | 常驻 | 4 | 读取、编辑、修补和查看工作区文件 |
| Shell | 常驻 | Windows 本地为 5 | 在明确的托管 Shell 中运行命令并操作后台进程 |
| 多 Agent | 常驻 | 4 | 创建、查看、等待和取消子 Agent |
| 渐进披露 | 常驻 | 7 | 按需发现工具、Skills、MCP 资源和工作区依赖 |
| 程序化编排 | 常驻 | 2 | 用 JavaScript 或安全并行调用组合多个工具 |
| 元认知工具 | 常驻 | 2 | 查看并回到较早的会话检查点 |
| 文件搜索 | 常驻 | 3 | 列出目录，按路径或内容查找文件 |
| 视觉生成 | 常驻 | 1 | 使用已配置的图像模型生成图片 |
| 网络 | 常驻 | 1 | 获取公开网页或 JSON 资源 |
| LSP 工具 | 常驻 | 4 | 通过语言服务器理解代码符号 |
| Planner | 按需 | 12 | 管理持久待办、排期、提案和 Agent 执行 |

“任务”模块服务于当前 Agent 会话的执行拆解；Planner 管理 Anybox 中可跨会话保留的待办和日程，两者不是同一套任务数据。

## 常驻工具模块

### 人机交互

`interaction.human` 让 Agent 在缺少关键条件时暂停并向用户确认。

| 工具 | 作用 |
| --- | --- |
| 向用户提问（`ask_user_question`） | 提出结构化的澄清问题，并等待用户回复后继续。 |

### 任务

`workflow.tasks` 用于拆分和跟踪当前 Agent 执行，不会创建 Planner 待办。

| 工具 | 作用 |
| --- | --- |
| 创建任务（`task_create`） | 创建一个或多个会话任务，并设置初始状态、负责人和依赖关系。 |
| 获取任务（`task_get`） | 按 ID 读取单个任务及其阻塞信息。 |
| 列出任务（`task_list`） | 查看当前会话的任务、进度、阻塞项和协作者活动。 |
| 更新任务（`task_update`） | 更新任务状态、负责人、详情或依赖关系。 |

### 文件读写

`workspace.file-io` 负责直接读取或修改工作区文件。

| 工具 | 作用 |
| --- | --- |
| 读取文件（`read_file`） | 读取文本文件的全部内容或指定行范围。 |
| 替换文本（`replace_text`） | 在一个文件中精确替换文本，也可创建新的文本文件。 |
| 应用补丁（`apply_patch`） | 一次应用一组结构化、便于审查的文件更改。 |
| 查看图像（`view_image`） | 加载本地图像，供 Agent 检查画面内容。 |

### Shell

`workspace.shell` 用于在明确的托管 Shell 中运行命令，并与持续运行的后台进程交互。它不连接桌面端的用户终端。Windows 本地工作区通常显示下列 5 个工具。

| 工具 | 作用 |
| --- | --- |
| 写入标准输入（`write_stdin`） | 轮询、继续输入或中断现有的托管 Shell 会话。 |
| Git Bash（`git_bash_command`） | 在项目边界内运行 Git Bash/MSYS Bash 命令。 |
| PowerShell（`powershell_command`） | 在项目边界内运行 PowerShell 7 命令。 |
| 命令提示符（`cmd_command`） | 在项目边界内运行 Windows Command Prompt 命令。 |
| WSL Bash（`wsl_bash_command`） | 在项目边界内运行 WSL Linux Bash 命令。 |

PowerShell 7 是可选的本机依赖。Anybox 不会捆绑或自动安装它，也不支持 Windows PowerShell 5.1。缺少 PowerShell 7 时，Anybox 以及命令提示符、Git Bash、WSL 等其他 Shell 仍可正常工作。

在 macOS 本地工作区中，平台 Shell 会替换为 `macos_shell_command`；在 SSH 工作区中则使用 `ssh_shell_command`。因此不同环境中的 Shell 工具数可能不同。

桌面端“终端”是由用户直接操作的交互界面，不作为 Agent 工具暴露。Agent 无法读取其输出缓冲，也无法向其中发送命令或原始输入。

### 多 Agent

`agent.multiagent` 用于把边界清晰的子任务委派给独立子 Agent。

| 工具 | 作用 |
| --- | --- |
| 创建子 Agent（`spawn_subagent`） | 创建一个执行委派任务的子 Agent 会话。 |
| 读取子 Agent（`read_subagent`） | 查看子 Agent 的最新状态和结果摘要。 |
| 等待子 Agent（`wait_subagent`） | 等待子 Agent 完成；超时时返回当前状态。 |
| 取消子 Agent（`cancel_subagent`） | 取消仍在运行的子 Agent。 |

### 渐进披露

`runtime.progressive-disclosure` 只在需要时读取额外能力，减少无关定义占用上下文。

| 工具 | 作用 |
| --- | --- |
| 工具搜索（`tool_search`，模型调用名 `anybox_tool_search`） | 搜索并加载当前用户轮次需要的可选模块或延迟工具。 |
| 加载 Skill（`load_skill`） | 为当前轮加载某个 Skill 的 `SKILL.md` 指令。 |
| 读取 Skill 资源（`read_skill_resource`） | 读取已加载 Skill 引用的补充文件。 |
| 列出 MCP 资源（`list_mcp_resources`） | 列出当前项目已启用 MCP 服务器提供的资源。 |
| 列出 MCP 资源模板（`list_mcp_resource_templates`） | 列出 MCP 服务器提供的参数化资源入口。 |
| 读取 MCP 资源（`read_mcp_resource`） | 从指定 MCP 服务器读取一个资源 URI。 |
| 加载工作区依赖（`load_workspace_dependencies`） | 返回文档、PDF、图像等本地处理任务可用的内置运行时和依赖路径。 |

### 程序化编排

`runtime.programmatic-orchestration` 用于合并相互独立的工具调用，减少串行等待。

| 工具 | 作用 |
| --- | --- |
| 执行 JavaScript（`exec`） | 在隔离环境中用 JavaScript 编排受支持的只读工作区工具。 |
| 并行调用工具（`multi_tool_use_parallel`） | 并行执行相互独立且允许并发的读取或搜索调用。 |

### 元认知工具

`agent.metacognition` 帮助 Agent 检查较早状态并在出错后建立修正路径。

| 工具 | 作用 |
| --- | --- |
| 列出回滚检查点（`list_rollback_checkpoints`） | 查看当前会话可回滚的消息和文件快照。 |
| 回滚到检查点（`rollback_to_checkpoint`） | 从较早消息创建修正分支，并可选择恢复工作区文件。 |

### 文件搜索

`workspace.file-search` 用于先定位目录、文件或匹配内容，再进行读取或修改。

| 工具 | 作用 |
| --- | --- |
| 列出目录（`list_directory`） | 列出当前项目中的文件和文件夹。 |
| Glob 匹配（`glob`） | 使用 Glob 模式匹配文件和目录路径。 |
| Grep 搜索（`grep`） | 使用正则表达式或字面量搜索文件内容。 |

### 视觉生成

`media.visual-generation` 提供图像创建能力。

| 工具 | 作用 |
| --- | --- |
| 生成图像（`generate_image`） | 使用全局配置的图像模型生成图片。 |

### 网络

`network.web` 用于读取公开网络内容。

| 工具 | 作用 |
| --- | --- |
| 获取 Web 内容（`web_fetch`） | 获取公开网页或 JSON 端点，并返回规范化内容。 |

### LSP 工具

`workspace.lsp` 通过当前语言服务器提供比文本搜索更精确的代码语义信息。

| 工具 | 作用 |
| --- | --- |
| LSP 定义（`lsp_definition`） | 跳转到文件指定位置符号的定义。 |
| LSP 引用（`lsp_references`） | 查找指定位置符号的所有引用。 |
| LSP 悬停信息（`lsp_hover`） | 读取指定位置符号的类型、签名或说明。 |
| LSP 工作区符号（`lsp_workspace_symbols`） | 通过语言服务器按名称搜索工作区符号。 |

## 按需工具模块

### Planner

`planner.core` 管理 Anybox 的持久待办与排程。它不会因用户在“工具”页面中浏览详情而加载；可通过工具搜索、`@计划`、`/计划`、`/planner` 或 Planner 委派为当前用户轮次启用。

| 工具 | 作用 |
| --- | --- |
| 列出 Planner 待办（`planner_list_todos`） | 列出待办，并按状态、日程、截止时间、项目或文本筛选。 |
| 获取 Planner 待办（`planner_get_todo`） | 按 ID 读取一个待办。 |
| 创建 Planner 待办（`planner_create_todo`） | 创建待办，并可同时设置属性和执行时间。 |
| 更新 Planner 待办（`planner_update_todo`） | 更新待办字段；完成状态和排期由专用工具处理。 |
| 完成 Planner 待办（`planner_complete_todo`） | 将待办标记为完成，或恢复为未完成。 |
| 安排 Planner 待办（`planner_schedule_todo`） | 设置、移动或清除执行时间，不改变截止时间。 |
| 查找 Planner 空闲时间（`planner_find_free_time`） | 在指定范围内，结合待办和本地日历查找候选空闲时段。 |
| 创建 Planner 提案（`planner_create_proposal`） | 创建一组可审查但尚未应用的待办更改。 |
| 接受 Planner 提案（`planner_accept_proposal`） | 经确认后，以原子方式应用提案中的全部更改。 |
| 忽略 Planner 提案（`planner_dismiss_proposal`） | 关闭待处理提案，不修改任何待办。 |
| 使用 Agent 运行待办（`planner_run_todo`） | 为明确委派的待办启动独立 Agent 执行，但不自动完成待办。 |
| 关联待办与自动化（`planner_link_automation`） | 关联或取消关联现有 Automation，不会创建或启用 Automation。 |

## 管理工具

常驻模块可以逐项或整组调整全局可用性；按需模块的工具目录只供查看，不能在这里常驻启用。每项工具会显示稳定 ID、风险标签、并发能力和输入 Schema。

- 修改工具或模块开关后，点击“保存更改”才会生效。
- “重置全部工具”会清除显式覆盖并采用注册表默认值；不会删除工具或更改 MCP 连接。
- `Concurrency: safe` 仅表示可并行调度，不代表免除权限检查。
- 输入 Schema 是参数名称和类型的最终依据。

## 可用性与权限

| 层级 | 作用 |
| --- | --- |
| 全局工具选择 | 决定内置工具是否提供给 Agent |
| Agent 策略 | 用允许、拒绝或只读规则继续缩小范围 |
| 会话策略 | 排除当前会话中的非只读工具 |
| 调用级权限 | 根据工具、参数、路径、命令和风险决定 |
| 工具守卫 | 校验 Schema、工作区边界和运行条件 |

“已启用”不等于“无需审批”。任一层拒绝或校验失败，调用都不会执行。

## 工具来源与渐进发现

运行时合并四类工具：

- **内置工具**：随 Anybox 提供，由工具页面管理。
- **原生按需模块**：由 Anybox 提供，仅在搜索或显式请求后为当前轮加载。
- **MCP 工具**：来自项目、插件或当前任务的 MCP 连接。
- **运行时自定义工具**：由宿主进程注册。

工具页面目前不管理 MCP；其认证、诊断和策略位于“连接”。

为避免大量 MCP 定义占满上下文，Anybox 会延迟部分工具。模型通过 `anybox_tool_search` 按名称、能力、来源或 Schema 搜索，匹配项从下一次模型调用开始可见。内部开关名为 `tool_search`；当它被禁用、拒绝或没有延迟候选时，运行时会回退为直接暴露可用工具。

## JavaScript Exec

`JavaScript Exec`（`exec`）用一次 JavaScript 调用编排多个只读检索，适合并行读取、筛选和汇总。

- 代码运行在全新的受限 QuickJS 环境中。
- 仅暴露 `tools.read_file`、`tools.list_directory`、`tools.glob` 和 `tools.grep`。
- 支持顶层 `await`、`Promise.all`、循环、条件和 `try/catch`；返回值必须可序列化为 JSON。
- 不提供 Node.js、网络、模块导入、DOM、主机文件 API、`process` 或定时器。
- 每个工具 Promise 都必须被等待或返回；需要用户审批的子调用会在 `exec` 内拒绝。

| 限制 | 当前值 |
| --- | ---: |
| JavaScript 源码 | 32,000 字符 |
| 墙钟时间 | 30 秒 |
| CPU 执行片段 | 250 毫秒 |
| 内存 / 栈 | 32 MiB / 512 KiB |
| 子工具调用 | 64 次 |
| 单次参数 / 结果 | 各 50,000 字符 |
| 累计子结果 / 最终输出 | 500,000 / 50,000 字符 |

## 排障

- 工具已启用但不可见：检查是否保存、Agent 策略、只读会话和当前平台的注册表。
- MCP 工具未出现：检查连接来源，或用 `anybox_tool_search` 搜索。
- `exec` 子工具不可用：确认它未被策略禁用；写入、Shell 和 MCP 工具不能放入 `exec`。
- 报告未消费调用：确保所有 `tools.*` Promise 都被 `await`、`return` 或纳入已等待的 `Promise.all`。
