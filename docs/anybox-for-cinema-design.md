# anybox for cinema 设计文档

版本：v0.1  
状态：初始产品设计 + Web Canvas V1 实现记录  
日期：2026-07-04

## 1. 产品定义

`anybox for cinema` 是一个由 AnyBox 驱动的本地影视项目 Web 工作台。

它面向 AI 影视创作场景，让用户以一个本地文件夹作为影视项目本体，通过两种方式共同推进项目：

- 在 AnyBox 中用 Agent 通过自然语言推进项目。
- 在独立 Web Canvas 中通过节点、素材、分镜、Prompt 和生成任务推进项目。

产品关系可以类比 Updream，但服务端角色不同：

```txt
Updream Web UI
  -> Updream 云端服务端
  -> 云端项目 / 模型调用 / 任务队列 / 云端存储

anybox for cinema Web UI
  -> AnyBox Local Runtime
  -> 本地项目文件夹 / 用户 API key / 模型 API / 本地任务 / 本地文件
```

因此，`anybox for cinema` 的核心不是一个独立 SaaS，而是一个 Local-Backend Web App：

- Web UI 是影视项目的可视化界面。
- AnyBox 是本地服务端、控制平面和 Agent 运行环境。
- 本地文件夹是项目真实状态。

## 2. 产品目标

第一阶段的目标是验证一个完整闭环：

> 用户可以在本地文件夹中，通过 AnyBox Agent 和 Web Canvas 共同推进一个 AI 影视项目，并把生成结果稳定保存回本地项目。

核心体验：

1. 用户在 AnyBox 中打开一个本地文件夹。
2. AnyBox 将该文件夹初始化为 Cinema Project。
3. 用户打开独立的 `anybox for cinema` Web UI。
4. 用户在 Canvas 中组织想法、参考图、Prompt、分镜和生成结果。
5. AnyBox 使用用户自己的 API key 调用视频生成模型。
6. 生成结果下载到本地项目文件夹。
7. AnyBox Agent 可以读取项目状态，并通过自然语言继续创建、修改和推进项目。

## 3. 核心原则

### 3.1 AnyBox 是控制者

AnyBox 负责：

- 项目文件夹识别和初始化。
- 本地 Film Runtime 服务。
- 用户 API key 管理。
- 模型 API 调用。
- 任务队列、轮询和结果下载。
- 本地文件读写。
- FFmpeg 等本地媒体处理能力。
- Agent 对项目的自然语言操作。

### 3.2 Web UI 只是 UI 客户端

Web UI 负责：

- Canvas 节点图。
- 分镜和素材关系展示。
- Prompt 编辑。
- 模型参数编辑。
- 任务状态展示。
- 轻量时间线或镜头顺序。

Web UI 不直接持有 API key，不直接随意访问本地文件，也不直接写项目状态文件。

### 3.3 本地文件夹是项目真相

项目状态必须可落地、可迁移、可读。

Agent 和 Web UI 都通过 AnyBox Film Runtime 修改项目，而不是各自维护一份状态。

## 4. 系统架构

```txt
anybox for cinema Web UI
  - Canvas
  - Node Inspector
  - Asset Browser
  - Prompt Panel
  - Task Queue
  - Shot / Timeline View

AnyBox Film Runtime
  - Local HTTP / WebSocket server
  - Project command executor
  - Project file writer
  - Provider adapter runtime
  - Task queue
  - Result downloader
  - Event broadcaster

AnyBox Agent
  - Reads project state
  - Generates project commands
  - Creates shots, prompts, tasks, summaries
  - Uses the same Film Runtime as Web UI

Local Film Project Folder
  - Project metadata
  - Canvas layout
  - Shots
  - Assets
  - Generated results
  - Task history
  - Event log
```

## 5. 本地项目结构

第一版建议使用透明的 JSON / JSONL 文件，方便调试，也方便 Agent 理解项目。

```txt
my-film-project/
  .anybox-cinema/
    project.json
    canvas.json
    shots.json
    timeline.json
    tasks.jsonl
    events.jsonl
    settings.json
  assets/
  references/
  prompts/
  generated/
  renders/
  exports/
```

### 5.1 目录说明

- `.anybox-cinema/project.json`：项目元信息。
- `.anybox-cinema/canvas.json`：Canvas 节点、位置、连线。
- `.anybox-cinema/shots.json`：分镜结构。
- `.anybox-cinema/timeline.json`：轻量时间线或镜头排序。
- `.anybox-cinema/tasks.jsonl`：模型调用任务记录。
- `.anybox-cinema/events.jsonl`：项目事件日志。
- `.anybox-cinema/settings.json`：项目级设置。
- `assets/`：用户导入的原始素材。
- `references/`：参考图、角色图、风格图、关键帧。
- `prompts/`：Prompt 文档。
- `generated/`：模型生成结果。
- `renders/`：预览渲染或中间产物。
- `exports/`：最终导出。

## 6. Canvas 产品设计

Canvas 是 `anybox for cinema` 的主要视觉界面，采用类似 Updream 的节点化工作台风格。

它不是传统文件列表，也不是完整剪辑时间线，而是一个影视项目关系图。素材、Prompt、分镜、Agent 任务、生成任务和结果视频都以节点形式存在，并通过连线表达依赖关系。

### 6.1 视觉方向

初始风格参考 Updream Canvas：

- 深色无限画布。
- 点阵网格背景。
- 可拖拽节点卡片。
- 节点标题带类型图标和名称。
- 节点主体显示预览、占位状态或任务状态。
- 底部悬浮工具栏，包括选择、拖拽、缩放、适配屏幕、撤销重做。
- 左下角小地图。
- 左侧或右键菜单快速添加节点。
- 节点之间可连线，表达生成依赖或创作关系。

### 6.2 Canvas 的意义

Canvas 表达的是创作过程：

```txt
参考图
  -> Prompt
  -> 生成任务
  -> 视频结果
  -> 分镜
  -> 时间线
```

它连接了两种工作方式：

- Agent 的自然语言推进。
- 创作者的视觉化掌控。

### 6.3 MVP 节点类型

第一版节点类型保持克制，先覆盖核心闭环。

#### Text Node

用于想法、备注、旁白、文案、世界观设定。

#### Prompt Node

用于保存可复用 Prompt。可以连接参考图、Shot Node 或 Generation Task Node。

#### Image Node

用于角色图、风格图、参考图、关键帧。

#### Video Node

用于本地视频、生成结果、镜头素材。

#### Audio Node

用于配音、BGM、音效。

#### Shot Node

表示一个镜头或分镜单位，包含：

- 镜头标题。
- 镜头描述。
- 时长。
- 画幅。
- 状态。
- 关联 Prompt。
- 关联参考素材。
- 关联生成结果。

#### Agent Node

表示一个 Agent 任务，例如：

- 拆分分镜。
- 优化 Prompt。
- 批量生成变体。
- 整理素材。
- 总结项目状态。

#### Generation Task Node

表示一次模型调用任务，展示：

- Provider。
- 模型。
- 输入参数。
- 状态。
- 进度。
- 错误信息。
- 生成结果。
- 估算成本。

#### Output Node

表示导出片段、预览片段或最终输出。

## 7. 命令模型

Web UI 和 Agent 都不直接修改项目文件，而是向 AnyBox Film Runtime 发命令。

初始命令包括：

```txt
create_project
add_asset
create_text_node
create_prompt_node
create_image_node
create_video_node
create_shot
update_shot
update_prompt
attach_reference
create_generation_task
refresh_generation_task
import_generation_result
move_canvas_node
link_nodes
unlink_nodes
update_timeline_clip
render_preview
export_video
```

AnyBox Film Runtime 负责：

1. 校验命令。
2. 执行文件读写或模型调用。
3. 写入项目状态。
4. 写入事件日志。
5. 通过 WebSocket 广播变更。

这种模型可以保证：

- UI 操作和 Agent 操作不会分裂。
- 项目变更可追踪。
- 未来可以实现 undo / redo。
- 浏览器不需要直接文件权限。
- API key 永远不返回给前端。

## 8. Provider 设计

`anybox for cinema` 是 BYOK 模式：用户自己准备模型 API key。

Provider adapter 统一封装各家视频模型 API：

```ts
interface VideoProviderAdapter {
  id: string
  name: string
  listModels(): Promise<VideoModelInfo[]>
  validateCredential(): Promise<ProviderCheckResult>
  createTask(input: VideoGenerateInput): Promise<VideoTaskRef>
  getTask(taskId: string): Promise<VideoTaskStatus>
  cancelTask?(taskId: string): Promise<void>
}
```

MVP 建议先接：

- fal.ai
- Replicate

第二阶段再接：

- Kling
- Runway
- Luma
- MiniMax / Hailuo
- Vidu
- Seedance / Wan

## 9. API Key 与安全

API key 由 AnyBox 管理，不进入 Web UI。

安全原则：

- Web UI 不读取 API key。
- Web UI 只发结构化任务命令。
- AnyBox 使用用户 API key 调用 provider。
- 日志中必须脱敏 token、key、authorization。
- 本地服务只监听 `127.0.0.1`。
- Web UI 连接需要一次性 token。
- WebSocket 会话有项目级权限。
- 文件读取必须通过 AnyBox 授权接口。

## 10. Web UI 入口

Web UI 可以由 AnyBox 本地服务提供：

```txt
http://127.0.0.1:<port>/cinema/projects/:projectId?token=<one-time-token>
```

也可以在未来部署为远程静态 Web App，但连接时仍通过 AnyBox Local Bridge 操作项目：

```txt
https://cinema.anybox.com
  -> paired AnyBox Local Runtime
  -> local project folder
```

第一版建议先由 AnyBox 本地服务提供 UI，减少跨 origin 和安全复杂度。

## 11. AnyBox 中的最小改动

AnyBox 不需要承载复杂 Canvas 页面，只需要成为控制者。

第一版需要：

- 当前文件夹识别为 Cinema Project。
- 初始化 `.anybox-cinema/`。
- 启动 Film Runtime。
- 打开 `anybox for cinema` Web UI。
- 管理视频 provider 的 API key。
- 给 Agent 暴露 Cinema Project 工具。
- 在 Agent 上下文中注入项目摘要。

## 12. Agent 能力

Agent 应该通过 Film Runtime 的命令模型操作项目。

MVP Agent 能力：

- 读取项目结构和素材摘要。
- 基于用户想法创建分镜。
- 为 Shot 生成 Prompt。
- 根据参考图优化 Prompt。
- 创建视频生成任务。
- 生成多个版本。
- 整理生成结果。
- 总结项目进度。

示例：

```txt
用户：把这个故事拆成 8 个镜头。
Agent：创建 8 个 Shot Node，并写入 shots.json。

用户：第 3 个镜头参考这张角色图，生成 3 个版本。
Agent：连接 Image Node -> Prompt Node -> Generation Task Node，任务完成后创建 Video Node。
```

## 13. MVP 范围

第一版只做从想法到生成素材的闭环。

必须支持：

- 创建/打开本地 Cinema Project。
- 打开独立 Web Canvas。
- 添加 Text / Prompt / Image / Video / Shot / Task 节点。
- 节点拖拽和连线。
- Canvas 布局保存。
- 配置至少一个 BYOK provider。
- 创建视频生成任务。
- 轮询任务状态。
- 下载结果到 `generated/`。
- 生成结果自动成为 Video Node。
- Agent 能读取项目并创建/修改节点。

## 14. 暂不做

第一版暂不做：

- 多人协作。
- 云端项目同步。
- 支付和额度系统。
- 完整剪辑时间线。
- 复杂特效。
- 模型市场。
- 移动端。
- 公网分享。
- 多项目云端 Dashboard。

## 15. 初始里程碑

### Milestone 1：本地项目与 Runtime

- 初始化 `.anybox-cinema/`。
- 启动本地 Film Runtime。
- Web UI 能连接 AnyBox。
- WebSocket 事件同步。

### Milestone 2：Canvas MVP

- 节点创建。
- 节点拖拽。
- 节点连线。
- 小地图。
- 缩放工具栏。
- 保存和恢复布局。

### Milestone 3：模型任务

- API key 配置。
- 接入 fal.ai 或 Replicate。
- 创建生成任务。
- 轮询任务状态。
- 下载结果。
- 创建结果节点。

### Milestone 4：Agent 集成

- Agent 读取项目摘要。
- Agent 创建 Shot Node。
- Agent 更新 Prompt。
- Agent 发起生成任务。
- Agent 总结项目进度。

### Milestone 5：可用闭环

- 用户从一句想法创建分镜。
- 在 Canvas 调整分镜和参考素材。
- 调用模型生成视频。
- 结果回写项目。
- Agent 继续推进下一步。

## 16. 风险与问题

### 16.1 Provider 输入格式不一致

许多视频 API 对输入格式要求不同，有的只接受公网 URL，有的支持文件上传，有的支持 base64。

解决方向：

- 优先接支持文件上传的 provider。
- 对只接受 URL 的 provider，支持用户配置自己的 R2 / S3 / OSS / COS。
- 后续提供可选 AnyBox 临时上传服务。

### 16.2 浏览器与本地权限边界

Web UI 不能获得过大本地权限。

解决方向：

- 一切本地能力通过 AnyBox Runtime。
- 使用 session token。
- 限制到当前项目目录。
- 不允许任意文件系统读写。

### 16.3 Agent 与 Canvas 状态冲突

Agent 和用户可能同时修改同一项目实体。

解决方向：

- 所有变更走命令模型。
- 所有变更写入 events.jsonl。
- 初期使用 last-write-wins。
- 后续引入版本号和冲突提示。

### 16.4 Canvas 复杂度失控

节点类型过多会让第一版变慢。

解决方向：

- MVP 只保留核心节点。
- 所有高级能力先映射为 Text / Prompt / Shot / Task。
- 节点扩展留给第二阶段。

## 17. 成功标准

v0 成功标准：

- 用户能在本地文件夹创建 Cinema Project。
- Web Canvas 能稳定打开并保存节点图。
- AnyBox Agent 能读取并修改同一个项目。
- 至少一个 provider 能完成视频生成任务。
- 生成结果能自动下载并回写到项目。

最终要验证的产品假设：

> AI 影视创作需要的不只是聊天，也不是单纯时间线，而是一个由 Agent 驱动、由 Canvas 可视化掌控、以本地文件夹为项目真相的创作工作台。

## 18. Web Canvas V1 实现选择

当前 V1 先验证“独立 Web UI + AnyBox 本地后端 + 本地项目文件夹”的最小闭环，不实现视频生成 provider、API key 配置、任务队列、Agent 节点执行、素材导入和完整时间线。

### 18.1 前端包

新增独立 package：

```txt
packages/cinema-web
```

技术栈：

- React 19
- TypeScript
- Vite
- `@xyflow/react`
- `@tanstack/react-query`
- Zustand
- `lucide-react`

Vite base 使用 `/cinema/`，开发端口默认是 `127.0.0.1:4175`。

页面从 URL query 读取：

- `projectID`：AnyBox 项目 ID。
- `agentBaseURL`：可选 AnyBox agent 地址。生产同源时默认使用 `window.location.origin`。

### 18.2 Canvas 形态

V1 采用类似 Updream 的深色节点画布：

- 深色点阵背景。
- XYFlow 节点和连线。
- 小地图。
- 画布 controls。
- 右键添加节点菜单。
- 右侧节点 Inspector。
- debounce 自动保存状态。

V1 支持节点类型：

```txt
text
prompt
image
video
audio
shot
agent
generation-task
output
```

所有节点先使用统一卡片 UI，不直接预览本地媒体；`generation-task` 只是结构占位，不调用模型 API。

### 18.3 AnyBox agent API

AnyBox agent 挂载：

```txt
/api/cinema
/cinema
```

V1 API：

```txt
GET  /api/cinema/projects/:projectID
GET  /api/cinema/projects/:projectID/canvas
PUT  /api/cinema/projects/:projectID/canvas
POST /api/cinema/projects/:projectID/open-link
```

实现原则：

- 只能通过 AnyBox `projectID` 解析项目根目录。
- 只读写该项目下的 `.anybox-cinema/*`。
- 浏览器不能传任意本地路径。
- 未初始化项目不自动创建 `.anybox-cinema`，只返回明确错误。
- `PUT canvas` 采用整文件原子写回，并追加 `events.jsonl` 的 `canvas.updated` 事件。

静态服务：

- 开发态优先使用 `ANYBOX_CINEMA_WEB_DIST` 或 `packages/cinema-web/dist`。
- 打包态使用 `packages/desktop/build/agent-runtime/cinema-web`。
- `/cinema/*` 对非 asset 页面 fallback 到 `index.html`。

### 18.4 数据格式

共享类型放在 `@anybox/shared/cinema`。

V1 继续兼容初始化 skill 生成的 `canvas.json`：

```json
{
  "schemaVersion": 1,
  "canvasType": "node-canvas",
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "nodes": [],
  "edges": [],
  "nodeTypes": []
}
```

Web UI 内部映射：

- 存储里的 `node.type` 是业务类型，例如 `text`、`agent`、`shot`。
- XYFlow 的 `node.type` 固定为 `cinemaNode`。
- 业务类型放入 `node.data.cinemaType`。
- 保存时转换回 `.anybox-cinema/canvas.json` 格式。

### 18.5 桌面入口

AnyBox 桌面端在项目右键菜单增加：

```txt
Open Cinema
```

点击后：

1. renderer 调用 `window.desktop.openCinemaProject({ projectID })`。
2. main 进程请求 agent 的 `/api/cinema/projects/:projectID/open-link`。
3. agent 返回 Cinema URL。
4. renderer 复用现有 `handlePreviewOpenUrl(url, workspace.id)`，在右侧 Preview 打开。

### 18.6 插件结构

Cinema 插件 manifest 使用当前推荐结构：

```txt
plugins/Anybox-Plugins/cinema/plugin.json
plugins/Anybox-Plugins/cinema/skills/initialize-cinema-project/SKILL.md
```

初始化仍然完全由 `Initialize Cinema Project` skill 描述，并使用通用文件创建工具与 Bash 执行，不写成 runtime 硬编码。
