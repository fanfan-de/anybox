# Anybox Calendar 模块设计方案

> [!WARNING]
> **状态：已废弃（Calendar-first 历史方案）。** 当前产品以待办事项为核心，权威规范见 [Anybox 计划模块产品需求（PRD）](./planner-product-requirements.md)；工具按需加载架构见 [原生 Tool Module ADR](./native-tool-module-architecture-decision.md)。本文仅保留为决策背景，不再指导新功能实现。

## 目标

在 Anybox 中新增一个和 `Workspace` 平级的顶层页面：`Calendar`。该页面参考 Notion Calendar 的产品思路，将日历事件、任务、项目、Workspace 页面和 Agent 计划统一显示在一个时间视图中。

新版设计不再把它定位成完整的项目管理中心，而是定位为：

```txt
把 Anybox 中有时间属性的内容，和用户真实日历放在一起管理。
```

核心体验是日历，不是 Todo 列表。任务、项目、Inbox、Workspace 页面都只是 Calendar 可以连接和显示的数据源。

## 参考产品

主要参考 Notion Calendar 的这些设计：

- 独立日历入口，但能连接 Notion workspace 和数据库。
- 日历网格是主界面，数据库条目可以直接显示在日历上。
- 左侧栏管理日历账户、日历源、数据库源和过滤。
- 右侧上下文面板编辑当前事件或数据库条目。
- 数据库条目需要有日期属性才能显示在日历中。
- 用户可以把数据库条目拖到日历网格上，从而给它设置日期或时间。
- 事件可以链接到 Notion 页面，日程和工作内容之间保持连接。

官方参考：

- [Getting started with Notion Calendar](https://www.notion.com/help/guides/getting-started-with-notion-calendar)
- [Use Notion Calendar with Notion](https://www.notion.com/help/use-notion-calendar-with-notion)
- [Timeline view](https://www.notion.com/help/timelines)
- [Sub-items & dependencies](https://www.notion.com/help/tasks-and-dependencies)

## 顶层导航

建议主导航使用 `Calendar`，中文可以叫 `日历` 或 `计划日历`。

```txt
App
├─ Home
├─ Workspace
├─ Calendar
├─ Agents
├─ Files / Knowledge
└─ Settings
```

不建议继续命名为 `Planner`，因为这次目标已经明确是 Notion Calendar 式体验。`Planner` 容易让用户期待完整项目管理、Todo 看板和复盘中心。

如果希望中文更贴近 Agent 场景，可以使用：

```txt
Calendar / 日历
```

或：

```txt
Schedule / 日程
```

但首选仍是 `Calendar`。

## 产品定位

Anybox Calendar 负责三件事：

1. 显示真实日程：会议、个人事件、外部日历事件。
2. 显示 Anybox 中带时间属性的内容：任务、项目节点、提醒、Workspace 页面、Agent 计划。
3. 让 Agent 帮用户安排、解释和调整时间。

它不是：

- 完整项目管理系统
- 企业级甘特图
- Sprint 管理工具
- 独立 Todo 应用

项目和任务仍然可以存在，但它们在 Calendar 页面中的身份是“可显示在日历上的数据条目”。

## 核心设计原则

### 日历是主角

用户进入页面后，第一眼看到的应该是日历网格，而不是任务列表或项目卡片。

```txt
左侧数据源栏 | 中间日历网格 | 右侧详情面板
```

### 数据源连接，而不是复制

任务、项目、提醒、Workspace 页面都不应该被复制成独立日历事件。它们应该作为数据源条目显示在日历上。

例如，一个任务有 `scheduledAt` 或 `dueDate`，Calendar 读取这个日期并显示它。用户拖拽这个任务时，本质是修改任务的日期字段。

### 日期字段可配置

一个数据源可能有多个时间字段：

- `dueDate`
- `scheduledAt`
- `startAt`
- `endAt`
- `remindAt`
- `releaseDate`

Calendar 需要允许用户选择“用哪个日期字段显示到日历上”。

### 右侧面板编辑上下文

点击日历上的事件或任务，不应该跳走。右侧打开详情面板，用户可以直接编辑标题、时间、状态、Workspace 关联、提醒和 Agent 建议。

### Agent 是日历助手

Agent 不替代日历本身，而是在日历中提供：

- 找空闲时间
- 自动安排任务
- 解释冲突
- 生成今日计划
- 将对话里的待办放进日历
- 帮用户重排拖延或逾期事项

## 页面布局

### 整体结构

```txt
Calendar
├─ 顶部工具栏
├─ 左侧数据源栏
├─ 中间日历网格
└─ 右侧上下文面板
```

### 顶部工具栏

顶部工具栏提供时间导航和快捷创建。

```txt
<  Today  >     Jun 2026       Day | Week | Month | Schedule      + New      Ask Agent
```

功能：

- 回到今天
- 上一日 / 周 / 月
- 下一日 / 周 / 月
- 切换视图：Day、Week、Month、Schedule
- 搜索事件和任务
- 快速新建事件
- 快速收集待办
- Ask Agent

推荐快捷输入：

```txt
Add event or task...
```

用户可以输入：

```txt
明天下午 3 点和张三开会
下周五前完成移动端发布
周三上午安排 2 小时写发布说明
```

### 左侧数据源栏

左侧栏是 Notion Calendar 的关键设计。它不只是导航，而是控制“哪些时间数据出现在日历上”。

建议结构：

```txt
Left Sidebar
├─ Mini Calendar
├─ Calendar Accounts
│  ├─ Personal
│  ├─ Work
│  └─ Holidays
├─ Anybox Sources
│  ├─ My Tasks
│  ├─ Inbox Items
│  ├─ Projects
│  ├─ Reminders
│  └─ Agent Plans
├─ Workspace Sources
│  ├─ Anybox Desktop
│  ├─ Anybox Mobile
│  └─ Plugin Development
├─ Saved Views
│  ├─ This Week Focus
│  ├─ Release Work
│  └─ Personal
└─ Scheduling
```

每个数据源支持：

- 显示 / 隐藏
- 颜色
- 日期字段
- 状态过滤
- Workspace 过滤
- 只显示未完成
- 只显示 assigned to me
- 打开数据源列表面板

示例：

```txt
My Tasks
Color: Blue
Date field: scheduledAt
Status filter: not done
Workspace filter: all
```

### 中间日历网格

中间区域是主工作区。

视图类型：

- Day：适合精细安排当天时间。
- Week：默认视图，适合规划一周。
- Month：适合查看大范围截止日期和项目节点。
- Schedule：按时间列表显示事件，适合移动端或紧凑窗口。

日历上显示的内容分为三类：

```txt
External Event
Anybox Date Item
Agent Suggested Block
```

#### External Event

来自外部日历或本地日历，例如会议、个人事件、节假日。

#### Anybox Date Item

来自 Anybox 数据源的条目，例如任务、项目节点、提醒、Workspace 页面。

#### Agent Suggested Block

Agent 建议但尚未确认的时间块，例如：

```txt
Suggested: 写发布说明
```

这类块应该有明显的 pending 状态，用户确认后才写入任务的日期字段或创建正式时间块。

### 右侧上下文面板

点击任何日历项后，右侧打开详情面板。

不同类型显示不同内容。

#### 外部事件详情

```txt
Event Detail
├─ 标题
├─ 时间
├─ 日历账户
├─ 地点 / 会议链接
├─ 参与人
├─ 提醒
├─ 关联 Anybox 页面
└─ Agent 操作
```

Agent 操作：

- 生成会议议程
- 创建会议笔记
- 找相关 Workspace 内容
- 总结上次相关讨论

#### 任务详情

```txt
Task Detail
├─ 标题
├─ 状态
├─ 时间字段
├─ 优先级
├─ 所属 Workspace
├─ 所属 Project
├─ 子任务
├─ 依赖
├─ 关联资源
└─ Agent 操作
```

Agent 操作：

- 拆小任务
- 找空闲时间
- 重新安排
- 解释为什么安排在这里
- 生成执行步骤

#### 项目节点详情

```txt
Project Date Item
├─ 项目标题
├─ 节点类型
├─ 时间
├─ 项目状态
├─ 相关任务
├─ 进度
└─ Agent 操作
```

Agent 操作：

- 生成项目计划
- 查看风险
- 重排项目节点
- 创建后续任务

## 数据源模型

Notion Calendar 的重点是“把数据库连接到日历”。Anybox 可以抽象为 `CalendarSource`。

```ts
type CalendarSource = {
  id: string
  name: string
  type:
    | 'external_calendar'
    | 'task_database'
    | 'project_database'
    | 'reminder_database'
    | 'workspace_pages'
    | 'agent_plan'
  enabled: boolean
  color: string
  workspaceId?: string
  primaryDateField: string
  endDateField?: string
  statusField?: string
  titleField: string
  filters: CalendarSourceFilter[]
  createdAt: string
  updatedAt: string
}
```

### CalendarSourceFilter

```ts
type CalendarSourceFilter = {
  field: string
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'before'
    | 'after'
    | 'is_empty'
    | 'is_not_empty'
  value?: string | number | boolean
}
```

### CalendarItem

日历网格不直接关心原始对象是任务、项目还是事件。它只消费统一的 `CalendarItem`。

```ts
type CalendarItem = {
  id: string
  sourceId: string
  entityType:
    | 'event'
    | 'task'
    | 'project'
    | 'reminder'
    | 'workspace_page'
    | 'agent_suggestion'
  entityId: string
  title: string
  startAt: string
  endAt?: string
  allDay: boolean
  color: string
  status?: string
  isReadOnly: boolean
  isSuggestion: boolean
  workspaceId?: string
}
```

### DateFieldMapping

用于描述某个实体如何显示在日历上。

```ts
type DateFieldMapping = {
  sourceId: string
  entityType: string
  titleField: string
  startField: string
  endField?: string
  allDayField?: string
  statusField?: string
}
```

## 核心实体

### CalendarEvent

用于真实日程和外部日历事件。

```ts
type CalendarEvent = {
  id: string
  calendarAccountId?: string
  externalId?: string
  title: string
  description?: string
  startAt: string
  endAt: string
  allDay: boolean
  timezone: string
  location?: string
  meetingUrl?: string
  attendees: string[]
  recurrenceRule?: string
  reminderRuleIds: string[]
  linkedPageIds: string[]
  linkedWorkspaceId?: string
  createdAt: string
  updatedAt: string
}
```

### Task

任务不是日历事件，但可以通过日期字段显示在日历上。

```ts
type Task = {
  id: string
  title: string
  description?: string
  status: 'inbox' | 'todo' | 'doing' | 'waiting' | 'done' | 'canceled'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  dueDate?: string
  scheduledStartAt?: string
  scheduledEndAt?: string
  estimateMinutes?: number
  projectId?: string
  parentTaskId?: string
  workspaceId?: string
  dependsOnTaskIds: string[]
  linkedResourceIds: string[]
  createdAt: string
  updatedAt: string
}
```

### Project

项目可以显示关键节点，而不是把整个项目变成日历事件。

```ts
type Project = {
  id: string
  title: string
  description?: string
  status: 'active' | 'paused' | 'completed' | 'archived'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  startDate?: string
  targetDate?: string
  workspaceId?: string
  linkedResourceIds: string[]
  createdAt: string
  updatedAt: string
}
```

### AgentSuggestedBlock

Agent 建议的时间块在确认前不应直接写入正式日历。

```ts
type AgentSuggestedBlock = {
  id: string
  title: string
  reason: string
  targetEntityType: 'task' | 'project' | 'reminder'
  targetEntityId: string
  suggestedStartAt: string
  suggestedEndAt: string
  status: 'pending' | 'accepted' | 'dismissed'
  createdAt: string
  updatedAt: string
}
```

## 关键交互

### 添加 Anybox 数据源

入口在左侧栏：

```txt
Anybox Sources > + Add source
```

流程：

1. 选择数据源类型：Tasks、Projects、Reminders、Workspace Pages、Agent Plans。
2. 选择显示日期字段。
3. 选择标题字段。
4. 选择颜色。
5. 设置过滤条件。
6. 保存后显示在左侧栏。

### 拖拽任务到日历

用户从左侧数据源列表中拖一个任务到日历网格。

系统行为：

1. 根据落点生成 `scheduledStartAt`。
2. 根据 `estimateMinutes` 或默认时长生成 `scheduledEndAt`。
3. 检查冲突。
4. 显示确认或直接写入。
5. 日历上出现该任务块。

如果任务原本只有 `dueDate`，拖拽到具体时间后写入 `scheduledStartAt` 和 `scheduledEndAt`，不覆盖 `dueDate`。

### 点击日历项

点击任意日历项后：

1. 右侧打开详情面板。
2. 根据类型加载对应详情。
3. 用户可编辑标题、时间、状态、Workspace 关联。
4. 修改即时反映在原始数据源。

### 关联 Workspace 页面到事件

用户可以给事件关联 Anybox 页面、会话、文档或 Workspace。

例如：

```txt
会议事件：Anybox Mobile 发布讨论
关联：
- Workspace: Anybox Mobile
- Page: 发布检查表
- Session: 上次发布问题复盘
```

这样日历不只是时间表，也成为进入工作上下文的入口。

### Agent 安排任务

用户点击 `Ask Agent`：

```txt
帮我把这周未安排的发布任务排一下。
```

Agent 流程：

1. 查询未安排任务。
2. 查询本周外部事件和已安排任务。
3. 找到空闲时间。
4. 生成 `AgentSuggestedBlock`。
5. 在日历中以建议样式显示。
6. 用户确认后写入任务日期字段。

## Agent 工具边界

Calendar 页面需要给 Agent 暴露日历级工具，而不是项目管理级工具。

```ts
list_calendar_items(range, sourceIds)
find_free_slots(range, durationMinutes, constraints)
create_calendar_event(input)
update_calendar_event(id, patch)
link_page_to_event(eventId, pageId)
list_calendar_sources()
create_calendar_source(input)
update_calendar_source(id, patch)
schedule_entity(entityType, entityId, startAt, endAt)
create_agent_suggested_block(input)
accept_agent_suggested_block(id)
dismiss_agent_suggested_block(id)
explain_calendar_conflicts(range)
generate_daily_schedule(date)
generate_weekly_schedule(startDate)
```

任务和项目工具仍然存在，但 Calendar 页面优先通过 `schedule_entity` 这类抽象工具操作日期字段。

## 冲突处理

冲突不应该只弹错误。应该给用户可选动作。

冲突类型：

- 与外部会议冲突
- 与已安排任务冲突
- 跨工作时间
- 超出截止日期
- 依赖任务尚未完成
- 估算时长不足

处理方式：

```txt
This task conflicts with 14:00-15:00 Weekly Sync.

Options:
- Move to next free slot
- Shorten to 45 minutes
- Keep anyway
- Ask Agent to replan
```

## 视图设计

### Week 视图

默认视图。

适合展示：

- 工作会议
- 个人日程
- 任务时间块
- Agent 建议安排
- 项目截止节点

### Day 视图

适合精细执行。

可以强化：

- 当前时间线
- 即将开始的事件
- 下一项任务
- 空闲时间段
- Agent 今日建议

### Month 视图

适合查看：

- 项目节点
- 截止日期
- 发布日
- 旅行或长期安排

Month 中任务不应显示过多细节，应以数量、颜色和简短标题为主。

### Schedule 视图

适合：

- 小窗口
- 移动端
- 快速浏览未来安排

结构：

```txt
Today
  09:00 Weekly Sync
  10:30 Write release notes
Tomorrow
  14:00 Mobile release review
```

## 移动端适配

移动端不建议保留三栏结构。

推荐：

```txt
Mobile Calendar
├─ 顶部日期导航
├─ 日 / 周 / 列表切换
├─ 日历主体
├─ 底部 Add 按钮
└─ 详情 Bottom Sheet
```

左侧数据源栏改为筛选抽屉。

右侧详情面板改为底部弹层。

## MVP 范围

第一阶段只做 Notion Calendar 核心体验：

1. 顶层 `Calendar` 页面。
2. Week / Day / Month 基础视图。
3. 左侧数据源栏。
4. 本地 CalendarEvent。
5. Task 数据源显示在日历上。
6. 任务拖拽到日历并写入 scheduled 时间字段。
7. 右侧详情面板。
8. Agent 找空闲时间。
9. Agent 生成建议时间块。
10. 用户确认建议后写入任务时间字段。

暂不做：

- 完整 Projects 管理页
- Review 复盘页
- 复杂甘特图
- 团队资源排班
- 完整外部日历双向同步
- Scheduling link
- 多人可用性查询

## 第二阶段

第二阶段增强 Notion Calendar 风格能力：

- 外部日历接入
- Google Calendar 单向或双向同步
- Workspace 页面关联事件
- 多个 Anybox 数据源
- 数据源日期字段选择
- 数据源状态过滤
- Schedule 列表视图
- 重复事件
- 提醒
- 时区显示

## 第三阶段

第三阶段加入 Agent 差异化能力：

- 自动从会话提取日程和任务
- 从 Workspace 文档中提取待办
- 自动生成每日计划
- 自动解释冲突
- 自动重排逾期任务
- 会议前自动准备上下文
- 会议后自动创建任务

## 和旧 Planner 方案的区别

旧方案：

```txt
Planner
├─ Today
├─ Calendar
├─ Projects
├─ Inbox
└─ Review
```

新版方案：

```txt
Calendar
├─ Calendar Grid
├─ Sources
├─ Details Panel
└─ Agent Suggestions
```

关键变化：

- 不再把 Projects、Inbox、Review 做成同级主 Tab。
- 任务和项目不再是页面主角，而是可连接的数据源。
- 默认页面不是 Today，而是 Week Calendar。
- Agent 的核心职责从“项目规划”变成“日历调度”。
- 用户主要通过拖拽、右侧面板和 Ask Agent 操作。

## 推荐结论

建议将该功能重新定位为 `Anybox Calendar`，作为和 `Workspace` 平级的顶层页面。

它的核心不是做一个项目管理中心，而是模仿 Notion Calendar：把外部日历事件和 Anybox 中带日期的任务、项目、页面、提醒连接到同一个日历视图中。

MVP 应优先做三栏结构、数据源连接、任务拖拽排期、右侧详情面板和 Agent 找空闲时间。项目管理、复盘、复杂 Todo 工作流都应该后置。
