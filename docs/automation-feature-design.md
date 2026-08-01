# Anybox 自动化功能设计方案

> [!NOTE]
> 本文继续定义后台 Automation 子系统。待办、排期、Agent 单次委托及其与 Automation 的边界，以 [Anybox 计划模块产品需求（PRD）](./planner-product-requirements.md) 为准；原生工具的当前轮加载机制见 [原生 Tool Module ADR](./native-tool-module-architecture-decision.md)。

## 目标

在 Anybox 中加入类似 Codex App Automations 的后台自动化能力：用户可以创建定时或持续跟进任务，让 agent 在指定项目、会话或多个项目上自动运行，并把有价值的结果收敛到一个可 triage 的收件箱中。

官方 Codex 自动化的关键行为包括：后台运行重复任务；项目自动化需要 App 运行且项目目录可用；Git 项目可选择本地目录或独立 worktree；结果进入 Triage；自动化沿用默认沙箱和权限策略；自动化可复用 skills/plugins；线程自动化用于保留当前线程上下文的心跳式跟进。Anybox 应复用这些产品原则，但实现上应贴合当前仓库架构。

## 当前架构判断

当前桌面包是 Electron/Vite/React 客户端，主要通过 `src/main/ipc.ts` 把 renderer 请求转发给 `packages/anyboxagent` HTTP API。已有能力包括：

- 项目与会话持久化：`packages/anyboxagent/src/project/project.ts`、`packages/anyboxagent/src/session/core/session.ts`
- 会话运行队列和并发限制：`packages/anyboxagent/src/session/runtime/session-runner.ts`
- SSE 事件流：`packages/anyboxagent/src/server/routes/session.ts`
- 权限与 full access/default 模式：`packages/anyboxagent/src/permission/permission.ts`
- 插件、skills、MCP、模型选择、全局配置：`packages/anyboxagent/src/config/config.ts`
- 轻量 interval 调度器：`packages/anyboxagent/src/scheduler/index.ts`

因此自动化的核心不应放在 Electron 主进程。建议：

- `anyboxagent` 负责自动化定义、持久化、调度、执行、运行记录和结果判定。
- `desktop` 负责列表页、创建/编辑表单、模板弹窗、Triage 收件箱、通知、IPC 转发。
- Electron 只在托管 agent 时负责随 App 生命周期启动/停止后端；不直接持有自动化状态。

## 功能边界

MVP 支持三类自动化：

1. 项目自动化
   - 每次运行创建独立 session。
   - 适合每日简报、最近提交 bug 扫描、CI 失败总结、项目健康检查。
   - 支持一个或多个项目目录。

2. 线程心跳自动化
   - 绑定已有 session，按周期 resume 或发送固定 follow-up 指令。
   - 适合等待长命令、跟进 PR 状态、持续研究。
   - 结果保留在原会话上下文，不进入新的项目 session。

3. 手动触发自动化
   - 同一份 automation 定义可以立即运行一次。
   - 用于测试 prompt、验证权限、调试 cadence。

非 MVP：

- 云端常驻调度。
- 跨设备同步。
- 复杂可视化流程编排。
- 自然语言直接创建自动化的完整 agent tool。MVP 可以先通过 UI 创建；后续再提供 tool。

## 产品体验

新增左侧主导航项：`自动化`。

页面结构：

- 顶部：标题、说明、`查看模板`、`手动设置`。
- 空状态：展示三个快捷模板：`每日简报`、`每周回顾`、`项目监控`。
- 列表状态：
  - 卡片显示名称、状态、类型、下次运行、最近运行结果、作用项目、模型/推理强度。
  - 行内操作：运行一次、暂停/恢复、编辑、复制、删除。
- Triage 区：
  - 默认只显示有 findings 的运行。
  - 支持 unread/all、automation、project、status 过滤。
  - 每条结果可打开对应 session、归档、标记已读、创建修复会话。

创建/编辑表单字段：

- 名称
- 类型：项目自动化 / 线程心跳
- 作用范围：
  - 项目自动化：一个或多个 projectID/directory
  - 线程心跳：sessionID
- 运行环境：
  - local：直接在项目目录运行
  - worktree：Git 项目中创建隔离 worktree
- 计划：
  - 快捷：每小时、每天、每周
  - 自定义 cron/RRULE
- prompt
- 模型与 reasoning effort：默认继承项目配置，可覆盖
- tools/skills/plugins：默认继承项目选择，可覆盖
- 权限模式：默认使用全局策略；允许选择 read-only / default / full_access 但 full_access 必须二次确认
- 输出策略：总是记录 / 仅 findings 进入 Triage / 无发现自动归档

### 快速创建 Composer

根据 Codex 创建截图补充，自动化首页应提供一个类似聊天输入框的快速创建入口，而不是只依赖传统表单。这个入口用于把“自动化标题 + 任务提示词 + 作用范围 + 计划”组合成一条 automation 草稿。

推荐布局：

- 首页中下部放置一个大尺寸创建 composer。
- 第一行是自动化标题，占位文案类似“自动化功能标题”。
- 主体是 prompt 输入区，占位文案类似“添加提示词，例如：在 $sentry 中查找崩溃”。
- 底部工具栏提供快捷选择：
  - 运行环境：`本地` / `工作树`
  - 项目选择：`选择项目`
  - 运行计划：例如 `每天 9:00`、`每周五 17:00`
  - 模型选择
  - 推理强度
  - skills/plugins/MCP 选择入口
- 右下角是 `取消` 和 `创建`。
- 右上角提供 `使用模板`，旁边放置信息提示图标。

创建流程：

1. 用户输入标题和 prompt。
2. 选择项目后自动推断默认运行环境：
   - Git 项目默认推荐 `工作树`。
   - 非 Git 项目只能使用 `本地`。
3. 选择计划后生成内部 RRULE。
4. 点击创建前做轻量校验：标题、prompt、项目、计划必填。
5. 创建成功后进入自动化详情页，而不是停留在首页。

安全提示：

- 信息提示应解释：自动化默认按当前沙盒/权限设置运行；如果任务需要修改工作空间外文件、访问网络或操作电脑应用，可能失败；可通过规则允许特定命令或能力。
- 当用户选择 `本地` 且 prompt 语义包含“修复、修改、提交、删除、运行脚本”等高风险词时，显示内联警告，建议改用 `工作树`。
- 当用户选择 full_access 时，创建按钮前必须出现二次确认。

### 自动化详情页

根据 Codex 界面补充，Anybox 自动化不应只有列表和创建弹窗，还需要一个可长期停留的详情页。详情页用于查看和编辑单个自动化的 prompt、状态、运行参数和历史记录。

推荐布局：

- 左侧仍使用全局应用导航，`自动化` 作为一级入口。
- 左侧项目列表中可以展示普通对话，也可以展示该项目下的自动化条目；自动化条目应与普通会话有图标或标签区分。
- 主内容顶部显示面包屑：`自动化功能 > 自动化名称`。
- 主内容区显示自动化名称和 prompt 正文。prompt 应支持直接编辑，但保存行为要明确，可以用自动保存状态或显式保存按钮。
- 右上角提供轻量操作：信息、删除、`立即运行`。
- 右侧属性检查器显示：
  - 状态：活跃/暂停/失败、下次运行、上次运行时间。
  - 详情：运行环境、本地/工作树、项目路径、重复次数/计划、模型、推理强度。
  - 运行历史记录：最近 runs，空状态显示“暂无对话/暂无运行记录”。

交互建议：

- `立即运行` 应复用同一份 automation 定义创建一条 run，并在按钮旁显示 running 状态。
- 状态切换应在右侧检查器中完成，不要隐藏在编辑弹窗里。
- 删除自动化前需要确认；删除不应默认删除历史 run 和关联 session，除非用户显式选择清理。
- prompt 修改后不会影响已经完成的 run，但会影响下一次运行；run 详情中应记录当时使用的 prompt snapshot。
- 右侧检查器中的 schedule、模型、推理强度可以就地编辑；复杂字段仍打开编辑弹窗。

## 数据模型

新增 `packages/anyboxagent/src/automation/automation.ts`，用 Zod 定义并同步 SQLite 表。

建议表：

```ts
AutomationDefinition {
  id: string
  name: string
  kind: "project" | "thread"
  status: "active" | "paused" | "deleted"
  schedule: {
    type: "rrule" | "cron"
    expression: string
    timezone: string
  }
  scope: {
    projectIDs?: string[]
    directories?: string[]
    sessionID?: string
  }
  execution: {
    environment: "local" | "worktree"
    model?: string
    small_model?: string
    reasoning_effort?: string
    permissionMode?: "read-only" | "default" | "full_access"
    selectedSkillIDs?: string[]
    selectedPluginIDs?: string[]
    selectedMcpServerIDs?: string[]
  }
  prompt: string
  promptVersion: number
  outputPolicy: {
    triage: "findings-only" | "always" | "never"
    autoArchiveNoFindings: boolean
  }
  createdAt: number
  updatedAt: number
  lastRunAt?: number
  nextRunAt?: number
}
```

```ts
AutomationRun {
  id: string
  automationID: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "skipped"
  projectID?: string
  directory?: string
  sessionID?: string
  turnID?: string
  promptSnapshot?: string
  promptVersion?: number
  startedAt?: number
  completedAt?: number
  summary?: string
  findingCount: number
  triageStatus: "inbox" | "read" | "archived" | "none"
  error?: string
  worktreePath?: string
  metadata?: Record<string, unknown>
}
```

索引：

- `idx_automations_status_next_run(status, nextRunAt)`
- `idx_automation_runs_automation_started(automationID, startedAt)`
- `idx_automation_runs_triage(triageStatus, completedAt)`
- `idx_automation_runs_session(sessionID)`

## 调度设计

现有 `Scheduler.register` 是 interval 任务，适合做轮询入口，但不适合直接表达用户计划。建议新增 `AutomationScheduler`：

- 启动时每 30 秒扫描 `active` 且 `nextRunAt <= now` 的 automation。
- 对每个 automation 使用数据库租约避免重复运行：
  - `leaseOwner`
  - `leaseExpiresAt`
  - `runningRunID`
- 成功领取后创建 `AutomationRun(status="queued")`。
- 根据 schedule 计算下一次 `nextRunAt`，即使本次失败也推进，避免失败后热循环。
- App/agent 重启时恢复：
  - `queued/running` 且超时的 run 标记为 `failed` 或 `cancelled`。
  - 重新计算所有 active automation 的 `nextRunAt`。

计划表达：

- 内部推荐存 `RRULE`，因为适合每日/每周/间隔场景。
- UI 可提供 cron 输入，但保存前转换或校验。
- MVP 可先只支持：
  - `FREQ=HOURLY;INTERVAL=n`
  - `FREQ=DAILY;BYHOUR=h;BYMINUTE=m`
  - `FREQ=WEEKLY;BYDAY=MO;BYHOUR=h;BYMINUTE=m`

## 执行设计

新增 `AutomationExecutor`：

1. 加载 automation 与目标 scope。
2. 对每个目标创建 run。
3. 根据 kind 分流：
   - project：创建新的 session，再调用现有 prompt execution。
   - thread：对已有 session 调用 resume 或发送自动化 prompt。
4. 订阅/读取 session runtime events，等待 turn 完成。
5. 生成 run summary 和 finding 判定。
6. 更新 Triage 状态。

项目自动化的执行路径：

```text
AutomationScheduler
  -> AutomationExecutor.runProjectAutomation
  -> Project.get(projectID)
  -> resolve execution directory
  -> maybe create isolated worktree
  -> Session.createSession({ directory, projectID, title })
  -> Prompt.promptExecution({ sessionID, parts, model, skills, reasoningEffort })
  -> SessionRunner existing queue/concurrency
  -> persist AutomationRun
```

线程心跳的执行路径：

```text
AutomationScheduler
  -> AutomationExecutor.runThreadAutomation
  -> Session.require(sessionID)
  -> Prompt.promptExecution 或 Prompt.resumeExecution
  -> run result remains in same thread
  -> optionally create AutomationRun for audit/triage
```

重要约束：

- 自动化不得绕过 `SessionRunner`，必须复用现有并发限制。
- 自动化不得绕过 `Permission.evaluate`，必须走同一套工具权限。
- thread automation 对同一 session 如果已经 running，应排队或跳过，MVP 建议排队。
- project automation 对同一目录并发应受 `maxRunningPerDirectory` 限制。

## Worktree 与本地运行

MVP 先实现 local，第二阶段实现 worktree。

local 模式：

- 直接使用项目 `worktree` 或用户指定 directory。
- 适合只读报告。
- 如果 prompt 可能改文件，UI 显示风险提示。

worktree 模式：

- 仅 Git 项目可用。
- 新增 `AutomationWorktreeManager`：
  - 基于项目默认分支或当前 HEAD 创建 `automation/<automation-id>/<run-id>` 分支。
  - worktree 目录建议放在 agent data dir 下：`automation-worktrees/<project-id>/<run-id>`。
  - 记录 `worktreePath`。
  - run archived 后允许清理 worktree。
- 运行结束后的 diff 保留在对应 session，可由用户审查、提交或丢弃。

## Findings 判定

Codex 的关键体验是“有发现进收件箱，没发现自动归档”。Anybox 可以通过结构化结尾约定实现：

系统附加一段自动化后处理指令：

```text
At the end of this automation run, output a compact Automation Report with:
- findings: array of actionable findings, each with title, severity, evidence, suggested_next_action
- summary: one paragraph
- no_findings_reason: present only when findings is empty
Do not invent evidence. If nothing actionable was found, say so.
```

MVP 可以从 assistant 最后一条消息中解析轻量 JSON block；更稳妥的第二阶段是在 prompt pipeline 中增加 structured output step。

Triage 入箱规则：

- `findingCount > 0`：`triageStatus="inbox"`
- `findingCount == 0 && autoArchiveNoFindings`：`triageStatus="archived"` 或 `none`
- failed/cancelled：默认进 inbox，方便用户修复配置

## API 设计

后端新增路由 `packages/anyboxagent/src/server/routes/automations.ts`：

- `GET /api/automations`
- `POST /api/automations`
- `GET /api/automations/:id`
- `PATCH /api/automations/:id`
- `DELETE /api/automations/:id`
- `POST /api/automations/:id/run`
- `GET /api/automations/:id/runs`
- `GET /api/automation-runs`
- `GET /api/automation-runs/:id`
- `POST /api/automation-runs/:id/archive`
- `POST /api/automation-runs/:id/read`
- `POST /api/automation-runs/:id/cancel`

桌面 IPC 新增：

- `desktop:list-automations`
- `desktop:create-automation`
- `desktop:update-automation`
- `desktop:delete-automation`
- `desktop:run-automation`
- `desktop:list-automation-runs`
- `desktop:update-automation-run-triage`
- `desktop:cancel-automation-run`

renderer 类型应放入 `src/shared/desktop-ipc-contract.ts`，main 层在 `src/main/ipc.ts` 中只做薄转发。

## 前端状态与界面

新增 renderer 模块：

```text
src/renderer/src/app/automations/
  AutomationsPage.tsx
  AutomationQuickCreateComposer.tsx
  AutomationDetailPage.tsx
  AutomationInspector.tsx
  AutomationCreateDialog.tsx
  AutomationTemplateDialog.tsx
  AutomationList.tsx
  AutomationRunInbox.tsx
  automation-store.ts
  automation-api.ts
  templates.ts
```

设计原则：

- 使用现有设置页/插件页的安静工作台风格，不做营销页。
- 模板弹窗采用两列卡片；卡片内容是 prompt 摘要和适用场景。
- 列表密度要高，方便长期管理。
- Triage 是结果中心，不要把所有 run 噪音都推到主会话列表。

模板建议：

- 最近提交 bug 扫描
- 每日项目简报
- 每周发布说明草稿
- CI 失败总结
- 待办/计划回顾
- 依赖更新风险检查

## 权限与安全

自动化是无人值守运行，安全边界必须比手动会话更保守：

- 默认 `permissionMode="default"`，read-only 模板默认只启用只读工具。
- full_access 自动化必须在 UI 中二次确认，并显示作用项目和 schedule。
- 自动化执行时不得弹出阻塞式权限对话；遇到 `ask`：
  - run 标记为 `blocked` 或 `failed`
  - Triage 显示需要用户调整权限或 prompt
  - 不自动批准
- 自动化 prompt 中如果要求执行 destructive 命令，仍由现有 permission evaluator 拦截。
- 所有 run 记录必须可审计：prompt、目标目录、模型、权限模式、工具失败、最终 summary。
- secrets 不进入 AutomationRun summary；日志只存 provider/model ID，不存 API key。

## 与 skills/plugins 的关系

自动化定义只保存“选择哪些 skill/plugin/MCP”，不复制其内容。运行时按当前项目选择解析：

- project automation 默认继承项目 skill/plugin/MCP selection。
- 用户可在 automation 上覆盖选择。
- prompt 中可以显式写 `$skill-name`，但 UI 也应提供 skills 选择器，避免用户记忆名字。

后续可增加 agent tool：

- `create_automation`
- `update_automation`
- `list_automations`
- `delete_automation`

用于支持“通过聊天创建自动化”。

## 分阶段落地

第一阶段：可用 MVP

- 数据模型与 SQLite 表。
- 后端 CRUD API。
- 轮询调度器。
- project automation local 模式。
- 手动运行。
- Triage run 列表。
- 3 个模板。
- 权限默认不自动批准。

第二阶段：产品完整性

- thread heartbeat automation。
- worktree 模式与清理。
- unread/all 过滤、归档、标记已读。
- 失败 run 的重试策略。
- desktop 通知。
- skills/plugins/MCP 覆盖选择。

第三阶段：智能创建与团队可维护性

- 聊天中创建/更新自动化的工具。
- 自动化 prompt 测试沙盒。
- structured output findings。
- 导入/导出模板。
- 针对插件 connector 的自动化模板，例如 GitHub PR、Gmail、飞书。

## 测试计划

后端测试：

- automation schema migration。
- CRUD 校验。
- schedule nextRunAt 计算。
- scheduler 领取租约，避免重复运行。
- run 失败不会热循环。
- local project automation 创建 session 并排队运行。
- permission ask 时 run 进入 blocked/failed，不自动执行。
- Triage 状态转换。

桌面测试：

- IPC contract 类型。
- main IPC 转发路径。
- AutomationsPage 空状态、列表、模板弹窗。
- 创建表单校验。
- run inbox unread/all 过滤。

手工验收：

1. 创建“每日简报”自动化，手动运行一次，生成 session 和 run 记录。
2. 无 findings 的 run 按配置自动归档。
3. 有 findings 的 run 出现在 Triage。
4. 暂停 automation 后不会被 scheduler 领取。
5. 权限需要审批的工具调用不会在后台自动批准。
6. App 重启后 nextRunAt 和未完成 run 状态恢复合理。

## 主要风险

- 后台运行误改用户正在编辑的文件：优先引入 read-only/default 权限和 worktree。
- 调度重复执行：必须有数据库租约。
- prompt 输出难以稳定判断 findings：MVP 用约定，后续改 structured output。
- run 太多导致 worktree 和 session 膨胀：需要归档和清理策略。
- UI 把 automation run 混入普通会话导致噪音：必须独立 Triage。

## 推荐实现顺序

1. 在 `anyboxagent` 增加 automation domain、schema、CRUD usecase 和 routes。
2. 在 `desktop` 增加 IPC contract 与薄转发。
3. 做 AutomationsPage 空状态、模板和创建表单。
4. 实现手动 run project automation local 模式。
5. 接入 scheduler 自动触发。
6. 接入 Triage inbox。
7. 加 worktree 与 thread heartbeat。
