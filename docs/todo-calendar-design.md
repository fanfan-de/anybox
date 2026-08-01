# Todo Calendar Design

> [!NOTE]
> **状态：历史领域分析。** 本文保留 `Todo + optional time` 的核心判断，但不再作为完整产品规范。当前权威入口为 [Anybox 计划模块产品需求（PRD）](./planner-product-requirements.md)，工具架构见 [原生 Tool Module ADR](./native-tool-module-architecture-decision.md)。

## 背景

当前 Calendar 设计里存在多个看起来相似的分类：

- Work / Personal
- My Tasks
- Project dates
- Reminders
- Agent suggestions

这些分类在界面上都表现为日历里的时间块或时间点，容易让用户产生困惑：它们到底是不同类型的事件，还是不同保存位置，还是不同筛选条件。

经过重新分析，Calendar 的真实用户心智不是“创建一个 event、task、reminder 或 project date”，而是：

> 用户创建一个待办事项；当它被安排到具体时间后，才出现在日历时间面板上。

因此，Calendar 不应该过早暴露底层对象类型。产品核心应围绕 `Todo Item` 展开，时间只是 Todo 的可选属性。

## 设计目标

1. 以 Todo 为核心对象，而不是以 Calendar Event 为核心对象。
2. Todo 可以没有具体时间；没有时间的 Todo 留在待安排区域。
3. Todo 设置了计划时间后，才出现在中间日历面板。
4. Todo 支持自由配置属性，例如工作区、项目、优先级、状态、自定义字段。
5. Calendar 是 Todo 的时间视图，不是所有对象的主数据源。
6. 日历源只用于少量普通日程事件的分类、颜色和保存位置，不应和 Todo 分类混在同一层级。
7. Agent 只生成建议或辅助执行，不默认成为 Todo 的执行者。

## 核心模型

用户创建的是一个 Todo：

```txt
Todo Item
├─ title
├─ status
├─ workspaceId
├─ properties
├─ createdAt
└─ updatedAt
```

Todo 可以拥有可选时间属性：

```txt
Todo Schedule
├─ scheduledStartAt?
├─ scheduledEndAt?
├─ dueAt?
├─ reminderAt?
└─ timezone?
```

其中：

- `scheduledStartAt / scheduledEndAt` 表示用户计划在这段时间执行。
- `dueAt` 表示截止时间。
- `reminderAt` 表示提醒时间。

只有存在 `scheduledStartAt` 的 Todo，才作为时间块显示在 Calendar 主面板中。

## 用户心智

用户首先关心的是：

```txt
我要做什么？
```

之后才关心：

```txt
什么时候做？
属于哪个项目？
有什么状态、优先级、项目、标签？
是否需要提醒？
是否需要 Agent 帮忙？
```

因此创建流程不应要求用户先区分 event、task、reminder 或 project date。

推荐创建入口：

```txt
New Todo
├─ Title
├─ Project
├─ Properties
└─ Optional time
```

如果用户设置了时间，这个 Todo 进入 Calendar；如果没有设置时间，它留在 Unscheduled 列表。

## Calendar 展示规则

Calendar 主面板只展示带有时间属性的 Todo 或外部日历事件。

```txt
Scheduled Todo
  显示为可拖拽时间块

Deadline
  显示为截止日期标记

Reminder
  显示为提醒标记

External Event
  显示为外部日历事件

Agent Suggestion
  显示为待确认建议块
```

这些内容可以在同一个时间网格中展示，但它们不应该在数据模型和创建入口上被强行等同。

## 左侧导航建议

不建议继续使用一个大而全的 `Sources` 列表承载所有概念。

推荐拆成更清晰的区域：

```txt
Todos
├─ Inbox
├─ Unscheduled
└─ Scheduled

Projects
├─ Anybox
├─ Anybox Mobile
└─ Plugin Development

Event calendars
├─ Work
└─ Personal（仅在已有或用户启用多个事件日历时显示）

Overlays
├─ Deadlines
├─ Reminders
└─ Agent suggestions
```

说明：

- `Todos` 是用户主要工作对象。
- `Projects` 是 Todo 的项目归属和属性上下文，绑定到 Open Workspace 中真实存在的 Project。
- `Event calendars` 只是普通 Calendar Event 的容器；默认只有 `Work`，有多个源时才在侧边栏紧凑显示。
- `Overlays` 是显示层开关，不是创建目标。

Calendar 中的 Project 字段不应是任意文本分类。新建和编辑时应从真实 Project 列表中选择，并保存 `project.id`。历史数据如果保存的是项目名或其他文本，可以在 UI 中兼容显示；用户重新选择后写回真实 Project ID。

## 自定义属性

Todo 的属性系统应该由 Project 配置。

不同 Project 可以定义不同字段：

```txt
Project: Anybox Mobile
├─ Status
├─ Priority
├─ Version
├─ Release Type
└─ Due Date
```

```txt
Project: Client Work
├─ Client
├─ Stage
├─ Budget
├─ Owner
└─ Review Date
```

Calendar 不需要理解所有自定义属性。Calendar 只需要识别标准时间字段：

- `scheduledStartAt`
- `scheduledEndAt`
- `dueAt`
- `reminderAt`

其他字段用于筛选、分组、详情展示和 Agent 上下文。

## Calendar Source 的定位

`Calendar Source` 不是 Todo 分类，而是普通 Calendar Event 的简单容器。

默认只需要一个 `Work` source。`Personal` 可以作为旧数据或用户后续启用的兼容 source 保留，但不应该成为主模型的一部分。

Calendar Source 适合承载少量非 Todo 事件，例如：

- 会议
- 约会
- 出行
- 节假日

这些事件的本体是 Calendar Event，而不是 Todo。

如果用户创建的是“我要完成的工作”，默认应创建 Todo；如果用户创建的是“某个会发生的日程”，才创建 Calendar Event。

Todo、Project、Deadline、Reminder 和 Agent suggestion 都不属于 Calendar Source。它们分别由 Todo 数据和 overlay 显示层表达。

## Agent 的定位

Agent 不默认执行所有 Todo。

Agent 的职责是：

1. 建议 Todo 应该安排到什么时间。
2. 帮用户拆解 Todo。
3. 准备资料、生成草稿或执行用户明确授权的动作。
4. 生成待确认时间块。
5. 用户确认后，把建议写回 Todo 的时间字段。

Agent 建议不应该作为普通 source 长期存在。它更适合作为 Calendar 上的 pending overlay：

```txt
Agent Suggestion
├─ targetTodoId
├─ suggestedStartAt
├─ suggestedEndAt
├─ reason
└─ status: pending | accepted | dismissed
```

接受建议后：

```txt
Todo.scheduledStartAt = suggestedStartAt
Todo.scheduledEndAt = suggestedEndAt
```

拒绝建议后，建议块消失，不影响 Todo 本身。

## MVP 范围

第一阶段建议只做：

1. Todo 创建、编辑、删除。
2. Todo 自定义属性基础能力。
3. Project 级属性配置。
4. Unscheduled Todo 列表。
5. 将 Todo 拖到 Calendar 后写入 `scheduledStartAt / scheduledEndAt`。
6. Calendar 展示已排期 Todo。
7. 默认保留一个 `Work` source 承载普通 Calendar Event；兼容已有 `Personal` source，但不主动强调多账户日历。
8. Agent 生成本地 pending suggestions，用户可接受或拒绝。

暂不建议做：

- 独立 Reminders source。
- 独立 Project dates source。
- 复杂外部日历双向同步。
- 多人资源排班。
- 复杂项目管理系统。

## 结论

Calendar 的核心不是 source，而是：

```txt
Todo + optional time
```

用户创建的是待办事项。待办事项可以没有时间，也可以被安排到具体时间。只有被安排的 Todo 才进入日历时间面板。

`Calendar Source` 只是普通 Event 容器；`Todo` 是用户要完成的工作；`Deadline`、`Reminder` 和 `Agent suggestions` 是叠加显示层。它们不应混在同一个 source 列表里。
