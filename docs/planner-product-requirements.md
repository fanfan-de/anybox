# Anybox 计划模块产品需求（PRD）

| 项目 | 内容 |
| --- | --- |
| 状态 | 已接受，作为实施基线 |
| 版本 | 1.0 |
| 决策日期 | 2026-08-01 |
| 实施进度 | 阶段 0–5 已完成；计划工作台、当前轮工具加载、Agent 单次委托与显式 Automation 联动均已落地；旧 Calendar MCP 插件已于 2026-08-04 退役 |
| 产品名称 | 计划（Planner） |
| 关联架构决策 | [原生 Tool Module 渐进式披露 ADR](./native-tool-module-architecture-decision.md) |
| 关联子系统 | [Automation 功能设计](./automation-feature-design.md) |

本文档是“计划”模块当前的产品权威入口。历史 Calendar-first 方案仅保留为决策背景，不再指导新功能实现。

## 1. 产品结论

Anybox 的“计划”不是一套以日历为中心的事件管理器，而是：

> 以待办事项为核心、以时间安排为可选属性、由 Agent 协助规划和执行的个人工作管理模块。

用户先回答“我要做什么”，再决定“什么时候做、是否交给 Agent、是否形成自动化”。日历是任务的排期视图，不是主数据源，也不是默认首页。

```text
计划
├─ 待办事项：工作的主对象
├─ 排期：待办事项的可选时间属性
├─ 日历：排期与外部事件的时间视图
├─ Agent：建议、拆解和执行
└─ Automation：经用户确认后的持续或定时执行
```

## 2. 产品目标

1. 让用户快速收集、组织、安排和完成待办事项。
2. 同时支持“还没决定什么时候做”和“已安排到具体时间”的工作。
3. 让 Agent 能读取任务上下文、生成计划、寻找空闲时间，并在授权后执行工作。
4. 通过渐进式披露加载计划工具，避免计划工具常驻所有对话的模型上下文。
5. 让 Anybox 内部能力使用原生工具直接访问同一领域服务，不再维护重复的 Calendar MCP 回环插件。
6. 与 Automation 建立清晰边界：计划管理“做什么与何时做”，Automation 管理“何时自动运行 Agent”。

## 3. 非目标

MVP 不包含以下能力：

- 企业级项目管理、Sprint、资源排班或复杂甘特图。
- 以外部日历同步为产品主线。
- Agent 未经确认自动改写大量任务或承诺用户时间。
- 根据用户文本在主 LLM 调用前运行额外的“意图解析器”。
- 将计划工具永久注册到每一次模型调用。
- 用插件选择状态表达一次性的对话工具加载。

## 4. 核心用户场景

### 4.1 快速收集

用户输入一个标题即可创建待办，其他属性均可稍后补充。

```text
修复 response 中途停止流式输出
```

新任务默认进入 Inbox；创建过程不要求用户先选择事件、提醒或日历源。

### 4.2 今日执行

用户进入“计划”后默认看到今天需要关注的事项：

- 安排在今天的任务。
- 今天截止但未完成的任务。
- 已逾期任务。
- 等待用户确认的 Agent 建议。

### 4.3 待安排工作

尚无 `scheduledStartAt` 的任务保留在“未安排”。用户可拖到日历、在详情中设置时间，或让 Agent 推荐时间。

### 4.4 对话中调用计划能力

用户可以显式输入：

```text
@计划 把这周未完成的高优先级任务安排到空闲时间
```

也可以直接表达需要：

```text
帮我看看今天还有哪些待办，并找一个两小时的空档
```

第二种路径由主 LLM 调用通用工具搜索来发现并加载计划工具；系统不在模型调用前增加意图分类步骤。

### 4.5 Agent 执行任务

对于可委托事项，用户可以让 Agent：

- 拆解任务。
- 准备资料或草稿。
- 启动一次有审计记录的执行。
- 将明确、重复的执行要求转为 Automation。

任务完成状态与 Agent 单次运行状态彼此独立，避免“Agent 运行结束”等同于“用户任务已完成”。

## 5. 产品信息架构

“计划”作为顶层模块，与 Workspace、Agents、Automations 等入口平级。

```text
计划
├─ 今天（默认）
├─ Inbox
├─ 即将到来
├─ 未安排
├─ 全部
├─ 待确认
├─ 已完成
├─ 项目
└─ 日历视图
```

### 5.1 左侧导航

- **今天**：当前执行面，默认入口。
- **Inbox**：尚未整理的任务。
- **即将到来**：未来有排期或截止日期的任务。
- **未安排**：没有计划时间的任务。
- **全部**：支持搜索、筛选和批量整理。
- **待确认**：Agent 计划建议与需要用户决定的变更。
- **已完成**：完成记录，可恢复。
- **项目**：真实 Project 下的任务集合。
- **日历视图**：按时间查看已排期任务与普通日程事件。

### 5.2 中央工作区

默认使用紧凑列表，优先展示标题、状态、排期、截止时间、项目和优先级。日历、按日程列表等视图是同一批数据的不同呈现，不建立第二套任务对象。

### 5.3 右侧检查器

选择任务后在右侧打开上下文检查器，保持用户留在当前列表或日历中。检查器按以下顺序组织：

1. 标题、状态与完成操作。
2. 项目、优先级、自定义属性。
3. 排期、截止时间、预计时长和提醒。
4. 描述、子任务、依赖和关联资源。
5. Agent 建议、委托与执行记录。
6. Automation 关联与活动记录。

### 5.4 视觉与交互约束

- 延续 Anybox 成熟、安静、克制的桌面生产力风格。
- 使用 Activity Rail、侧栏、主工作区、右侧检查器的既有工作台结构。
- 默认采用紧凑行、工具栏和面板，不把页面设计成营销式 Dashboard 或多层卡片集合。
- 各面板独立滚动，长标题、窄窗口和多语言文本不得破坏布局。
- 所有图标按钮使用真实 `button`、可见焦点态和 tooltip；图标统一使用现有 Lucide 体系。
- 关键操作支持键盘：快速新建、搜索、完成、打开详情、加载计划模块。
- 小窗口优先收起右侧检查器，再将左侧导航切换为抽屉；日历可降级为 Schedule 列表。

## 6. 领域模型

### 6.1 Todo

Todo 是计划模块的主对象。

```ts
type PlannerTodo = {
  id: string
  title: string
  description?: string
  status: 'inbox' | 'todo' | 'doing' | 'waiting' | 'done' | 'canceled'
  priority?: 'low' | 'medium' | 'high' | 'urgent'
  projectId?: string
  parentTodoId?: string
  estimateMinutes?: number
  scheduledStartAt?: number
  scheduledEndAt?: number
  dueAt?: number
  reminderAt?: number
  timezone?: string
  properties?: Record<string, unknown>
  createdAt: number
  updatedAt: number
  completedAt?: number
}
```

时间字段在领域层和本地 API 中统一使用 Unix epoch milliseconds；展示层负责时区格式化。

关键约束：

- `scheduledStartAt / scheduledEndAt` 表示用户计划执行的时间段。
- `dueAt` 表示最后期限，不因拖拽排期而被覆盖。
- 没有 `scheduledStartAt` 的 Todo 仍是完整任务，并显示在“未安排”。
- Calendar 只读取并修改 Todo 的时间属性，不复制 Todo。

### 6.2 CalendarEvent

CalendarEvent 用于会议、约会、出行等“将会发生的日程”，不是用户需要完成的工作。外部日历同步也落在该边界内。

### 6.3 PlanProposal

Agent 对任务时间、拆解或批量修改的建议，在用户接受前保存为提案：

```ts
type PlanProposal = {
  id: string
  changes: PlannerChange[]
  reason: string
  status: 'pending' | 'accepted' | 'dismissed' | 'expired'
  createdAt: number
  decidedAt?: number
}
```

接受后才写入 Todo；拒绝或过期不改变任务本体。

### 6.4 AgentTaskRun

AgentTaskRun 记录一次明确委托的执行，包括输入上下文、权限、工具调用、产物、结果和失败原因。它不替代 Todo，也不自动决定 Todo 是否完成。

### 6.5 Automation 关系

AutomationDefinition 是独立子系统的长期执行定义。Todo 可以引用 Automation，但不复制其调度和运行记录。

```text
Todo --可选关联--> AutomationDefinition --产生--> AutomationRun
Todo --可选委托--> AgentTaskRun
Todo --可选排期--> Calendar 时间块
```

## 7. Agent 与工具加载体验

计划工具不常驻模型上下文，只能通过以下两条路径在当前用户轮次激活。

### 7.1 渐进式披露

1. 首次模型调用只看到核心工具和通用 `anybox_tool_search`。
2. 主 LLM 根据用户原始表达判断是否需要外部能力。
3. 主 LLM 调用工具搜索，例如查询“待办、排期、空闲时间”。
4. 运行时命中并加载一个有边界的计划工具包。
5. 同一用户轮次的下一次模型调用获得该工具包。

这条路径不增加前置 LLM，也不把所有模块名称、工具名称或参数模式放入提示词。

### 7.2 用户主动加载

用户通过 `@计划`、`/计划` 或命令面板中的“为本轮加载计划工具”直接激活工具包。该路径在本轮第一次模型调用前完成，不需要先调用工具搜索。

### 7.3 生命周期

- 激活范围仅限当前用户轮次。
- 下一轮不会因为上一轮使用过计划工具而自动加载。
- 项目可以记住 UI 偏好，但不能将一次工具加载转化为项目级永久模型能力。
- UI 应在消息标签或工具活动区显示本轮已加载的模块，便于用户理解 Agent 能力来源。
- 不存在“根据文本自动持久化选中插件”的隐式行为。

具体运行时契约见[原生 Tool Module 渐进式披露 ADR](./native-tool-module-architecture-decision.md)。

## 8. 原生计划工具范围

MVP 原生工具包使用 `planner_*` 命名，避免与 Agent 内部用于会话工作流的 `task_create`、`task_list` 等工具冲突。

| 工具 | 作用 | 默认风险 |
| --- | --- | --- |
| `planner_list_todos` | 按视图、时间、状态、项目筛选任务 | 只读 |
| `planner_get_todo` | 读取单个任务及其上下文 | 只读 |
| `planner_create_todo` | 创建任务 | 可写 |
| `planner_update_todo` | 更新标题、属性、排期或截止时间 | 可写 |
| `planner_complete_todo` | 完成或恢复任务 | 可写 |
| `planner_schedule_todo` | 为任务设置、移动或清除计划时间 | 可写 |
| `planner_find_free_time` | 根据任务与日程寻找空闲时间 | 只读 |
| `planner_create_proposal` | 创建待审核、尚未应用的原子变更集 | 可写 |
| `planner_accept_proposal` | 经强制确认后原子应用提案 | 可写、强制确认 |
| `planner_dismiss_proposal` | 拒绝提案且不修改任务 | 可写 |

后续按产品需要增加：

- `planner_run_todo`
- `planner_link_automation`

工具只调用 Planner 领域服务；桌面 UI、HTTP API 和原生工具不得各自实现一套业务规则。

## 9. 权限与用户控制

- 读取任务与查找空闲时间可以按现有只读策略执行。
- 创建、修改、完成单个任务遵循当前工具权限策略，并生成可审计工具记录。
- 批量改期、批量完成、删除、创建 Automation、发起外部动作必须提供变更预览并按风险请求确认。
- Agent 生成的多项排期默认进入 PlanProposal；用户接受后一次性提交。
- 后台 Automation 不得绕过现有 Permission evaluator，也不得自动批准交互式确认。
- 日志不得写入密钥；运行记录应保留模块来源、工具名、参数摘要、结果与错误。

## 10. MVP 范围

### 10.1 必须完成

1. Planner Todo 领域模型、存储、查询与迁移。
2. 今天、Inbox、即将到来、未安排、全部、待确认、已完成和项目视图。
3. 任务快速创建、编辑、完成、筛选和删除/恢复策略。
4. 日历作为二级视图，支持排期任务拖拽和右侧详情编辑。
5. 原生 `planner.core` 工具包及两条本轮激活路径。
6. Agent 查任务、创建任务、更新任务、完成任务、排期和查找空闲时间。
7. PlanProposal 的接受与拒绝基础流程。
8. Calendar HTTP API 作为桌面排程视图的内部兼容面继续可用，并转发到同一 Planner 领域服务。
9. 工具调用的权限、审计、错误反馈和回归测试。

### 10.2 后置能力

- 复杂重复任务。
- 外部日历完整双向同步。
- 多人协作、分配和资源可用性。
- 高级依赖图、甘特图和项目组合管理。
- Agent 无确认的长期自主排程。
- 云端常驻 Automation。

## 11. 验收标准

### 11.1 产品验收

- 用户可以不设置时间创建任务，并在“未安排”中找到它。
- 设置计划时间后，同一任务出现在日历视图；移除时间后返回“未安排”。
- 修改排期不会覆盖截止时间。
- 用户可以从“今天”完成核心的查看、创建、完成和打开详情流程。
- Agent 建议在接受前不修改任务正式数据。
- Calendar Event 与 Todo 在创建入口、详情和视觉状态上可区分。

### 11.2 工具披露验收

- 普通对话的首次模型请求中不存在任何 `planner_*` 工具定义。
- `@计划` 或 `/计划` 后，本轮首次模型请求可直接看到计划工具。
- 未显式加载时，主 LLM 可以通过 `anybox_tool_search` 加载计划工具，并在同一用户轮次继续调用。
- 工具搜索描述不枚举全部原生模块或完整工具列表。
- 当前轮结束后，计划工具不自动出现在下一轮。
- 工具搜索被关闭或拒绝时，原生计划工具保持隐藏；不得回退为全部直接暴露。
- 模块未激活时，不初始化计划工具运行时，也不建立额外 MCP 进程或 HTTP 回环。

### 11.3 工程验收

- UI、HTTP API 和原生工具共享同一 Planner service。
- 原有 Calendar Todo 数据有确定性迁移或兼容读取路径，不双写两套主表。
- 工具权限、只读会话模式、恢复当前轮发现状态和不可用模块都有自动化测试。
- 窄窗口、长标题、键盘焦点、独立滚动和主题切换通过桌面端 UI 检查。

## 12. 设计开发计划

### 阶段 0：产品与架构契约

- 固化本 PRD 与 Tool Module ADR。
- 将 Calendar-first 文档标记为历史方案。
- 明确领域对象、工具边界、权限与验收标准。

交付判定：产品、运行时和 UI 使用同一术语与权威入口。

### 阶段 1：Tool Module 运行时基础

- 新增原生模块目录与懒加载 Registry。
- 扩展工具来源、当前轮请求字段和发现状态。
- 改造 `anybox_tool_search`，支持模块级命中和加载。
- 增加 `@计划`、`/计划` 或命令面板的结构化当前轮标签。
- 保证原生模块严格隐藏、按需初始化、轮次结束即失效。

交付判定：用测试证明两条加载路径成立，且无默认暴露与失败时全量回退。

### 阶段 2：Planner 领域层

- 从现有 Calendar Todo 能力抽取或迁移 Planner service。
- 建立 Todo、Schedule、PlanProposal 和 AgentTaskRun 边界。
- 实现查询、写入、事务、迁移与审计。
- 让 Calendar HTTP API 转发到 Planner service。

交付判定：UI、HTTP API 和原生工具对同一任务读写一致。

实施状态（2026-08-04 更新）：已完成。`planner_tasks` 原表原位迁移；Planner API、Calendar HTTP API 与原生工具共享 Planner service；Proposal 接受使用单事务和版本冲突保护；Todo、Proposal 与 AgentTaskRun 均写入审计记录。原用于回环访问这些 API 的 Calendar MCP 插件已在原生工具覆盖稳定后删除。

### 阶段 3：计划工作台 MVP

- 实现顶层“计划”、默认“今天”和左侧视图。
- 实现紧凑任务列表、快速创建和右侧检查器。
- 将现有日历改为二级排期视图，并打通拖拽排期。
- 完成键盘、焦点、主题、滚动和窄窗口适配。

交付判定：用户不借助 Agent 也能完整管理任务和排期。

实施状态（2026-08-01）：已完成。桌面端 Activity Rail 已将原“日历”入口升级为顶层“计划”；默认“今天”，并提供收集箱、即将到来、未安排、全部、项目、Agent 提案、已完成与日历排程。列表支持搜索、快速新建、完成/恢复和项目上下文；右侧检查器支持状态、优先级、项目、排程、截止时间、预计时长、备注与删除。Agent Proposal 在独立确认面板逐项预览，只有显式接受才写入 Todo。原 Calendar 作为嵌入式二级排程视图继续复用同一 Planner 数据。桌面端采用现有语义令牌，并完成深色主题、高 DPI、紧凑窗口、键盘快捷键和独立滚动验收。

### 阶段 4：Agent 规划闭环

- 发布 `planner.core` 原生工具包。
- 支持查任务、创建、修改、完成、排期和找空闲时间。
- 实现 PlanProposal 预览、接受与拒绝。
- 在消息和任务详情中显示工具来源、执行状态与结果。

交付判定：自然语言与 `@计划` 两条路径均可完成可审计的任务规划。

实施状态（2026-08-01）：已完成。`planner.core` 作为原生 Tool Module 发布，不进入 `builtinTools()`；主 LLM 可通过通用工具搜索在后续模型调用中加载，用户也可通过 `@计划` 或 `/计划` 为当前轮直接加载。模块提供任务查询、创建、修改、完成、排期、空闲时间、Proposal、Agent 委托及 Automation 关联工具；高风险执行与 Automation 关联继续走显式授权。消息工具轨迹和任务详情均显示 `planner.core` 来源，来源元数据由运行时写入，前端不自行推断。模块发现、当前轮失效、搜索关闭时 fail-closed、Proposal 事务与工具来源均有自动化测试。

### 阶段 5：执行与 Automation 联动

- 支持从 Todo 发起 AgentTaskRun。
- 支持将重复工作显式转换为 AutomationDefinition。
- 关联运行结果、失败、重试和用户确认状态。

交付判定：一次性委托与长期自动化边界清晰，权限不被绕过。

实施状态（2026-08-01）：已完成。Todo 可在二次确认后创建独立 `AgentTaskRun` 和独立 Agent 会话，支持只读/默认权限、状态轮询、取消、失败重试、结果摘要及打开执行会话；执行结果不会自动修改 Todo 完成状态。重复工作通过单独确认表单创建现有 `AutomationDefinition` 并与 Todo 建立 ID 关联，不复制 Automation 的调度或运行状态，也不把一次性委托隐式升级为后台自动化。创建、运行、取消、重试和关联操作写入 Planner 审计记录；无有效项目/目录时拒绝启动，后台 Automation 默认只读并保留既有权限确认边界。

### 12.1 最终验证记录

- Agent 端 TypeScript 类型检查通过。
- 桌面端语义令牌检查与 TypeScript 类型检查通过。
- Planner、Calendar HTTP API、工具搜索、当前轮加载与权限选择跨层测试通过。
- Planner 工作台、Composer 标签、消息工具来源、客户端 API 与翻译测试通过。
- 桌面端生产构建通过；深色主题、高 DPI、紧凑窗口以及 Agent/Automation 二次确认界面已完成实机检查。

## 13. 历史文档关系

- [Todo Calendar Design](./todo-calendar-design.md) 保留“Todo + optional time”的早期领域分析，已不再是完整产品规范。
- [Anybox Calendar 模块设计方案](./planner-module-design.md) 是已废弃的 Calendar-first 方向，仅作决策历史。
- [Automation 功能设计](./automation-feature-design.md) 继续作为后台自动化子系统规范；与本模块通过显式关联集成。
- [插件模块实现](./plugin-module-implementation.md) 描述现有插件与 MCP 机制，不定义原生 Tool Module 的生命周期。
