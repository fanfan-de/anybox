# Codex 当前会话可用工具清单

生成时间：2026-05-06  
工作目录：`C:\Projects\anybox\packages\desktop`

本文档列出当前会话中我可调用的工具及主要元信息。这里的“工具”指 Codex 运行环境暴露给我的内置工具、MCP 工具、插件工具和封装工具；`rg`、`git`、`npm`、`npx`、`node` 等是通过 shell 调用的外部命令，不属于 Codex 内置工具。

## 总览

| 类别 | 命名空间 | 工具数量 | 主要用途 | 通道 |
|---|---:|---:|---|---|
| Web | `web` | 1 个总入口，含多个子能力 | 联网搜索、打开网页、财经、天气、体育、时间、图片搜索 | `analysis` |
| 图片生成 | `image_gen` | 1 | 生成或编辑位图图片 | `commentary` |
| 本地开发工具 | `functions` | 19 | shell、补丁编辑、计划、子代理、MCP 资源、本地图像、依赖路径等 | `commentary` |
| Notion 插件 | `mcp__codex_apps__notion` | 19 | Notion 搜索、页面、数据库、评论、会议笔记等 | `commentary` |
| Node REPL | `mcp__node_repl__` | 2 | 持久 Node.js REPL、重置 REPL | `commentary` |
| Pencil 设计工具 | `mcp__pencil__` | 12 | `.pen` 设计文件读取、编辑、截图、导出、变量、布局检查 | `commentary` |
| Codex App | `codex_app` | 1 | 自动化、提醒、周期任务、线程 heartbeat | `commentary` |
| 并行工具封装 | `multi_tool_use` | 1 | 并行调用多个 developer 工具 | `commentary` |

## Web 工具

### `web.run`

| 元信息 | 内容 |
|---|---|
| 命名空间 | `web` |
| 目标通道 | `analysis` |
| 用途 | 访问互联网和实时信息源 |
| 典型使用场景 | 最新资讯、官网文档、价格、法规、体育赛程、天气、财经行情、网页内容核验 |
| 主要限制 | 当用户要求最新信息、精确来源、联网核验，或信息可能近期变化时必须使用；回答中需要提供使用过的链接 |

`web.run` 是一个总入口，支持这些子能力：

| 子能力 | 参数概览 | 用途 |
|---|---|---|
| `search_query` | `q`, `recency`, `domains` | 搜索网页 |
| `image_query` | `q`, `recency`, `domains` | 图片搜索 |
| `open` | `ref_id`, `lineno` | 打开网页或搜索结果 |
| `click` | `ref_id`, `id` | 点击已打开页面里的链接 |
| `find` | `ref_id`, `pattern` | 在网页中查找文本 |
| `screenshot` | `ref_id`, `pageno` | 对 PDF 页面截图 |
| `finance` | `ticker`, `type`, `market` | 股票、基金、指数、加密货币行情 |
| `weather` | `location`, `start`, `duration` | 天气预报 |
| `sports` | `fn`, `league`, `team`, `date_from`, `date_to` | 体育赛程和排名 |
| `time` | `utc_offset` | 查询指定 UTC 偏移的时间 |
| `response_length` | `short`, `medium`, `long` | 控制工具返回内容长度 |

## 图片工具

### `image_gen.imagegen`

| 元信息 | 内容 |
|---|---|
| 命名空间 | `image_gen` |
| 目标通道 | `commentary` |
| 用途 | 根据描述生成图片，或按指令编辑已提供图片 |
| 输入 | `prompt` |
| 主要限制 | 用户要求生成/编辑图片时直接调用；生成后不追加下载说明、总结或追问 |

## 本地开发工具

### `functions.shell_command`

| 元信息 | 内容 |
|---|---|
| 命名空间 | `functions` |
| 目标通道 | `commentary` |
| 用途 | 在当前机器的默认 shell 中执行命令；本会话默认是 PowerShell |
| 常用参数 | `command`, `workdir`, `timeout_ms`, `login` |
| 本会话权限 | `danger-full-access`，网络可用，审批策略为 `never` |
| 主要限制 | 不使用破坏性 git/文件命令；不申请提权；Windows 下删除/移动操作要避免跨 shell 拼接 |

说明：`rg`、`git grep`、`npm run typecheck`、`npx vitest` 都是通过这个工具调用的外部命令。

### `functions.apply_patch`

| 元信息 | 内容 |
|---|---|
| 命名空间 | `functions` |
| 目标通道 | `commentary` |
| 输入类型 | Freeform patch |
| 用途 | 精确新增、修改、删除文件 |
| 主要限制 | 手工编辑文件时优先使用；不能并行调用；补丁必须符合 `*** Begin Patch` / `*** End Patch` 格式 |

### `functions.update_plan`

| 元信息 | 内容 |
|---|---|
| 命名空间 | `functions` |
| 目标通道 | `commentary` |
| 用途 | 维护任务计划和进度 |
| 输入 | `explanation`, `plan[{ step, status }]` |
| 主要限制 | 同一时间最多一个 `in_progress` 步骤 |

### `functions.request_user_input`

| 元信息 | 内容 |
|---|---|
| 命名空间 | `functions` |
| 目标通道 | `commentary` |
| 用途 | 在 Plan mode 中向用户提出 1 到 3 个短问题 |
| 当前模式 | Default mode |
| 主要限制 | 当前 Default mode 下通常不使用；只有 Plan mode 可用时才应使用 |

### `functions.tool_suggest`

| 元信息 | 内容 |
|---|---|
| 命名空间 | `functions` |
| 目标通道 | `commentary` |
| 用途 | 建议用户安装明确匹配的已知插件或连接器 |
| 输入 | `tool_type`, `tool_id`, `action_type`, `suggest_reason` |
| 主要限制 | 只能用于列表中已知可安装工具；不能并行调用；用户明确需要且当前不可用时才用 |

### `functions.view_image`

| 元信息 | 内容 |
|---|---|
| 命名空间 | `functions` |
| 目标通道 | `commentary` |
| 用途 | 查看本地图片文件 |
| 输入 | `path`, `detail` |
| 主要限制 | 只在用户给出完整本地路径且图片未作为上下文附件出现时使用 |

### MCP 资源工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `functions.list_mcp_resources` | 列出 MCP server 暴露的资源 | `server`, `cursor` |
| `functions.list_mcp_resource_templates` | 列出参数化 MCP 资源模板 | `server`, `cursor` |
| `functions.read_mcp_resource` | 读取指定 MCP 资源 | `server`, `uri` |

### 子代理工具

| 工具 | 用途 | 关键参数 | 主要限制 |
|---|---|---|---|
| `functions.spawn_agent` | 创建子代理 | `agent_type`, `message`, `items`, `model`, `reasoning_effort` | 只有用户明确要求子代理、并行代理或委派时使用 |
| `functions.send_input` | 向已有代理发送消息 | `target`, `message`, `items`, `interrupt` | 复用相关代理上下文 |
| `functions.wait_agent` | 等待代理完成 | `targets`, `timeout_ms` | 只在当前步骤需要结果时等待 |
| `functions.resume_agent` | 恢复已关闭代理 | `id` | 用于继续已有代理 |
| `functions.close_agent` | 关闭代理 | `target` | 不再需要时关闭 |

### 运行环境辅助工具

| 工具 | 用途 |
|---|---|
| `functions.read_thread_terminal` | 读取当前桌面线程终端输出 |
| `functions.load_workspace_dependencies` | 定位内置 Node.js、Python、文档/表格/幻灯片/PDF 处理依赖 |

## Notion 插件工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `mcp__codex_apps__notion._search` | 搜索 Notion workspace、连接源或用户 | `query`, `query_type`, `filters`, `page_size` |
| `mcp__codex_apps__notion._fetch` | 读取 Notion 页面、数据库或 data source | `id`, `include_discussions`, `include_transcript` |
| `mcp__codex_apps__notion._notion_create_pages` | 创建一个或多个页面 | `parent`, `pages` |
| `mcp__codex_apps__notion._notion_update_page` | 更新页面属性或内容 | `page_id`, `command`, `properties`, `content_updates`, `new_str` |
| `mcp__codex_apps__notion._notion_duplicate_page` | 复制页面 | `page_id` |
| `mcp__codex_apps__notion._notion_move_pages` | 移动页面或数据库 | `page_or_database_ids`, `new_parent` |
| `mcp__codex_apps__notion._notion_create_database` | 用 SQL DDL 创建数据库 | `parent`, `title`, `schema` |
| `mcp__codex_apps__notion._notion_update_data_source` | 更新 data source schema、标题、描述或归档状态 | `data_source_id`, `statements`, `title` |
| `mcp__codex_apps__notion._notion_query_data_sources` | SQL 或视图方式查询数据库数据 | `data` |
| `mcp__codex_apps__notion._notion_create_view` | 创建数据库视图或 linked view | `database_id` / `parent_page_id`, `data_source_id`, `type`, `configure` |
| `mcp__codex_apps__notion._notion_update_view` | 更新视图名、过滤、排序、展示配置 | `view_id`, `name`, `configure` |
| `mcp__codex_apps__notion._notion_create_comment` | 添加页面评论或回复 discussion | `page_id`, `rich_text`, `selection_with_ellipsis`, `discussion_id` |
| `mcp__codex_apps__notion._notion_get_comments` | 获取页面评论和 discussion | `page_id`, `include_all_blocks`, `include_resolved` |
| `mcp__codex_apps__notion._notion_get_users` | 查询 workspace 用户 | `query`, `user_id`, `page_size`, `start_cursor` |
| `mcp__codex_apps__notion._notion_get_teams` | 查询 teamspace | `query` |
| `mcp__codex_apps__notion._notion_query_meeting_notes` | 查询当前用户会议笔记 | `filter` |

Notion 工具的重要约束：

- 创建或更新 Notion 页面内容前，应先读取 `notion://docs/enhanced-markdown-spec` 规范。
- 针对数据库创建页面时，应先 `_fetch` 数据库以获取正确 data source 和属性 schema。
- 更新页面内容前，应先 `_fetch` 当前内容，使用精确 `old_str` 做替换。
- 删除可能包含子页面/数据库的内容时，需要先向用户确认。

## Node REPL 工具

### `mcp__node_repl__.js`

| 元信息 | 内容 |
|---|---|
| 命名空间 | `mcp__node_repl__` |
| 目标通道 | `commentary` |
| 用途 | 在当前 Anybox session 的持久 Node.js kernel 中执行 JavaScript，支持 top-level await |
| 输入 | `code`, `timeout_ms`, `title` |
| 特性 | 默认工作目录是活动项目；`globalThis` 在同一 session 的多次调用间保留；可动态 import；可用 `nodeRepl.write` 输出精确文本；可用 `nodeRepl.emitImage` 返回图片 |

代码按 async function body 执行，词法声明不会跨调用保留，需要显式 `return` JSON 结果。
`js` 具有普通 Node.js 文件、网络与子进程能力；session 切换会硬重置 kernel，完整大结果位于
`structuredContent`，文本只提供有限预览。`timeoutMs` 只接受 1～120000 的整数。

### `mcp__node_repl__.js_reset`

| 元信息 | 内容 |
|---|---|
| 命名空间 | `mcp__node_repl__` |
| 目标通道 | `commentary` |
| 用途 | 终止并重建 Node.js kernel，清除全局、新增模块搜索路径、模块缓存、timer 与后代进程 |

## Pencil 设计工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `mcp__pencil__.get_editor_state` | 获取当前画布、选区和 schema | `include_schema` |
| `mcp__pencil__.open_document` | 打开 `.pen` 文件或新建文档 | `filePathOrTemplate` |
| `mcp__pencil__.batch_get` | 批量读取或搜索节点 | `filePath`, `nodeIds`, `patterns`, `readDepth`, `searchDepth` |
| `mcp__pencil__.batch_design` | 批量插入、更新、替换、移动、删除、生成图片 | `filePath`, `operations` |
| `mcp__pencil__.get_screenshot` | 获取节点截图 | `filePath`, `nodeId` |
| `mcp__pencil__.export_nodes` | 导出节点为 PNG/JPEG/WEBP/PDF | `filePath`, `nodeIds`, `outputDir`, `format` |
| `mcp__pencil__.find_empty_space_on_canvas` | 在画布中查找空位 | `direction`, `width`, `height`, `padding`, `nodeId` |
| `mcp__pencil__.snapshot_layout` | 检查布局结构和问题 | `filePath`, `parentId`, `maxDepth`, `problemsOnly` |
| `mcp__pencil__.get_variables` | 获取设计变量和主题 | `filePath` |
| `mcp__pencil__.set_variables` | 设置设计变量和主题 | `filePath`, `variables`, `replace` |
| `mcp__pencil__.search_all_unique_properties` | 递归搜索唯一样式属性 | `parents`, `properties` |
| `mcp__pencil__.replace_all_matching_properties` | 批量替换匹配样式属性 | `parents`, `properties` |
| `mcp__pencil__.get_guidelines` | 加载 `.pen` 任务指南或样式指南 | `category`, `name`, `params` |

Pencil 工具的重要约束：

- `batch_design` 每次最多 25 个操作，且每个插入/复制/替换操作必须有绑定名。
- 图片不是单独节点类型，图片通过 `G(...)` 作为 frame/rectangle 的 fill。
- 修改设计后应使用截图或布局检查进行验证。

## Codex App 自动化工具

### `codex_app.automation_update`

| 元信息 | 内容 |
|---|---|
| 命名空间 | `codex_app` |
| 目标通道 | `commentary` |
| 用途 | 创建、查看、更新、删除提醒、周期任务、监控、heartbeat |
| 模式 | `view`, `create`, `update`, `delete`, `suggested_create`, `suggested_update` |
| 种类 | `cron`, `heartbeat` |
| 关键参数 | `id`, `name`, `prompt`, `rrule`, `status`, `cwds`, `destination`, `targetThreadId` |
| 主要限制 | 用户要求提醒、重复任务、稍后继续、监控时使用；不要手写 raw automation directive |

## 并行封装工具

### `multi_tool_use.parallel`

| 元信息 | 内容 |
|---|---|
| 命名空间 | `multi_tool_use` |
| 目标通道 | `commentary` |
| 用途 | 并行调用多个 developer 工具 |
| 输入 | `tool_uses[{ recipient_name, parameters }]` |
| 主要限制 | 只能并行调用 developer 工具；只能用于互不依赖的操作；不能并行调用需要串行的编辑工具 |

## 当前可用技能和插件

这些不是直接工具调用入口，但会影响我在相关任务中的工作流选择。

### 插件

| 插件 | 用途 |
|---|---|
| Browser Use | 浏览器自动化，尤其是 localhost、file URL、本地网页检查 |
| Build Web Apps | 构建前端应用、游戏、视觉 UI、组件和验证 |
| Documents | 创建、编辑、渲染、验证 `.docx` |
| Notion | Notion 知识管理、规格到实现、会议和研究工作流 |
| Presentations | 创建、编辑、渲染、验证 PowerPoint |
| Spreadsheets | 创建、编辑、分析、渲染表格文件 |
| Vercel | Web 应用、部署、Vercel 平台、AI SDK、Next.js 等 |

### 常见技能

| 技能 | 触发场景 |
|---|---|
| `imagegen` | 生成或编辑位图图片 |
| `openai-docs` | 查询 OpenAI 官方产品/API 文档 |
| `browser-use:browser` | 操作 Codex 内置浏览器 |
| `build-web-apps:frontend-app-builder` | 从头构建视觉前端应用 |
| `build-web-apps:react-best-practices` | React/Next.js 代码质量和性能 |
| `build-web-apps:shadcn` | shadcn/ui 项目和组件 |
| `documents:documents` | `.docx` 文档工作流 |
| `presentations:Presentations` | `.pptx` 幻灯片工作流 |
| `spreadsheets:Spreadsheets` | `.xlsx`/`.csv` 表格工作流 |
| `vercel:*` | Next.js、Vercel CLI/API、AI SDK、部署、存储、认证等 Vercel 相关任务 |
| `notion:*` | Notion 知识捕获、会议、研究、规格转实现 |

## 外部命令和内置工具的区别

| 类型 | 例子 | 调用方式 | 失败含义 |
|---|---|---|---|
| Codex 内置工具 | `apply_patch`, `web.run`, `image_gen.imagegen` | 由 Codex 运行环境直接调用 | 通常是参数、权限或工具约束问题 |
| MCP/插件工具 | Notion、Pencil、Node REPL | 通过 MCP/plugin 暴露 | 取决于插件连接、权限和输入 |
| Shell 外部命令 | `rg`, `git`, `npm`, `npx`, `node` | 通过 `functions.shell_command` 在 PowerShell 中执行 | 取决于本机 PATH、权限、依赖安装、命令本身 |

例如本次 `rg --files` 失败，是 Windows 拒绝运行外部程序 `rg.exe`，不是 Codex 内置工具失败。我随后改用的 `git grep` 也是外部命令，只是由 Git 提供，仍然通过 PowerShell 执行。
