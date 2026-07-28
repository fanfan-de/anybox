# Anybox Mobile Client Design Plan

## 1. 背景与目标

当前 Anybox 的手机连接能力由桌面端 Electron 主进程启动一个局域网 HTTP bridge，并通过 `mobileAppHtml()` 返回一段内联 HTML/CSS/JS。手机浏览器访问 `http://<desktop-lan-ip>:4896/?token=...` 后，再通过 `/api/mobile/...` 调回桌面端 bridge，bridge 转发到本机 agent API。

这个实现适合验证“手机能否访问桌面端 agent”，但不适合长期产品化：

- 手机 UI 写在一个 TypeScript 字符串里，难维护、难测试、难复用组件。
- URL token 暴露在地址栏，适合调试，不适合长期设备授权。
- 当前连接依赖同 Wi-Fi、局域网可达、防火墙放行。
- 手机端能力边界不清晰，容易把桌面/agent 内部 API 暴露过多。
- 状态同步主要靠请求，不适合实时任务、权限审批、流式输出。

目标是开发一个专门的 Anybox 手机端，用于连接桌面端并进行远程控制。这里的“远程控制”优先定义为能力级控制，而不是屏幕共享。

核心目标：

- 手机端可以查看 workspace、session、消息、任务状态。
- 手机端可以继续已有对话、新建对话、发送 prompt、接收流式回复。
- 手机端可以审批权限请求、停止任务、查看关键文件或变更摘要。
- 手机端 UI 独立开发、可测试、可逐步演进为 PWA 或原生 App。
- 桌面端提供最小化、明确边界的 mobile API 和实时同步通道。
- 后续可以从局域网直连平滑升级到云端 relay。

非目标：

- 第一阶段不做完整远程桌面或屏幕共享。
- 第一阶段不复刻桌面端所有设置、插件管理、终端能力。
- 第一阶段不暴露完整 agent API 给手机端。

## 2. 当前实现概览

当前相关代码：

- `src/main/mobile-bridge-server.ts`
  - 启动 `0.0.0.0:4896` bridge。
  - 生成 `mobileAppHtml()`。
  - 提供 `/api/mobile/status`、`/api/mobile/workspaces`、`/api/mobile/projects` 等路由。
  - 校验 URL token 或 Bearer token。
  - 转发部分请求到 agent API。
- `src/renderer/src/app/connections/MobileConnectionPage.tsx`
  - 桌面端“手机连接”设置页。
  - 展示 LAN URL、token、刷新 token。

当前请求链路：

```text
Phone browser
  -> http://desktop-lan-ip:4896/?token=...
  -> desktop mobile bridge
  -> http://127.0.0.1:4096 agent API
```

当前 UI 状态：

- 首页显示 Workspaces 和 Recent Sessions。
- Workspace 点击后进入 Chats 列表。
- Chat 页面可以读取消息、发送 prompt。

当前问题：

- 手机 UI 仍是内联字符串。
- 没有独立构建、路由、状态管理、测试。
- 没有设备配对和设备管理。
- 没有可靠的实时事件订阅。
- 局域网连接体验受网络环境影响明显。

## 3. 推荐总体架构

推荐分成四层：

```text
Mobile UI
  PWA / Web app / future native app

Mobile Gateway
  desktop-hosted mobile API
  auth/session/device management
  realtime event stream

Desktop Bridge
  Electron main process
  talks to agent API and desktop-only services

Agent Runtime
  local agent HTTP/SSE APIs
  sessions, messages, tasks, workspace files
```

第一阶段仍由桌面端托管手机端静态资源：

```text
Phone browser
  -> http://desktop-lan-ip:4896/
  -> static mobile-web assets
  -> /api/mobile/*
```

第二阶段引入云端 relay：

```text
Desktop app
  -> outbound WebSocket to relay

Phone app / PWA
  -> HTTPS/WebSocket to relay

Relay
  -> authenticated message routing
  -> no direct LAN requirement
```

这样可以先快速改善产品体验，再逐步解决跨网络访问问题。

## 4. Mobile UI 形态选择

### 4.1 推荐：先做 PWA

优点：

- 开发速度快。
- 可继续由桌面端托管。
- 可以独立构建、独立测试。
- 手机浏览器即可使用。
- 后续可用同一套 API 迁移到原生 App。

建议目录：

```text
packages/mobile-web/
  package.json
  src/
    app/
    components/
    api/
    routes/
    state/
  vite.config.ts
```

桌面端构建时把 `packages/mobile-web/dist` 复制到 desktop app 的 build 资源中，由 bridge 提供静态文件服务。

### 4.2 后续：Expo / React Native

当 PWA 功能稳定后，再考虑 Expo：

- 更好的安全存储。
- 更好的系统通知。
- 更自然的后台能力。
- 可做 App Store / Play Store 分发。

但原生 App 会引入更多成本：

- 签名、证书、商店审核。
- 推送服务。
- 平台差异。
- 原生网络权限。

建议不要第一阶段直接上原生。

## 5. 连接模型设计

### 5.1 局域网直连 MVP

使用现有 bridge，但把 URL token 模式升级为配对模式。

流程：

1. 桌面端打开“手机连接”页。
2. 桌面端显示 QR code。
3. 手机扫描 QR code。
4. 手机访问一次性 pairing URL。
5. 桌面端确认或自动批准。
6. 手机获得 device token。
7. 后续请求使用 Bearer device token。

连接链路：

```text
Phone
  -> GET /pair?code=one-time-code
  -> POST /api/mobile/pair
  -> returns device token
  -> Authorization: Bearer <device-token>
```

### 5.2 云端 relay 版本

桌面端主动连接云端，手机端也连接云端，云端只负责转发和状态同步。

```text
Desktop app -> Relay WebSocket
Phone app   -> Relay WebSocket / HTTPS
```

优点：

- 不要求同 Wi-Fi。
- 不要求电脑开放 LAN 端口。
- 不受 NAT 和路由器客户端隔离影响。
- 可以统一账号登录、设备管理、审计。

建议 relay 能力：

- 设备注册。
- 桌面在线状态。
- 请求/响应转发。
- 事件广播。
- 限流与审计。
- 端到端加密的预留设计。

## 6. 认证与授权

### 6.1 当前 token 的问题

当前 `?token=...` 有这些问题：

- 出现在地址栏和浏览器历史里。
- 复制 URL 时 token 一起泄露。
- 难以区分不同设备。
- 难以撤销单个设备。
- 重启后 token 刷新，体验不稳定。

### 6.2 推荐设备授权模型

数据结构：

```ts
interface MobileDevice {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
  tokenHash: string
  revokedAt?: number
  capabilities: MobileCapability[]
}

type MobileCapability =
  | "workspace:read"
  | "session:read"
  | "session:create"
  | "message:send"
  | "task:cancel"
  | "approval:respond"
  | "workspace-file:read"
```

桌面端设备管理 UI：

- 已配对设备列表。
- 最近在线时间。
- 撤销设备。
- 重新生成配对码。
- 权限范围展示。

手机端存储：

- PWA 阶段：`IndexedDB` 或 `localStorage`，配合短期 refresh 策略。
- 原生阶段：系统安全存储。

## 7. Mobile API 设计

不要把 agent API 原样暴露给手机端。设计专用、窄口径 mobile API。

### 7.1 系统状态

```http
GET /api/mobile/status
```

返回：

```ts
interface MobileStatus {
  service: "anybox-mobile-bridge"
  desktopName: string
  appVersion: string
  online: boolean
  capabilities: string[]
}
```

### 7.2 Workspaces

```http
GET /api/mobile/workspaces
```

返回与桌面侧栏语义一致的 workspace 列表，而不是底层 project registry。

```ts
interface MobileWorkspace {
  id: string
  name: string
  directory: string
  exists: boolean
  updated: number
  project: {
    id: string
    name: string
    repositoryRoot?: string
    worktree: string
    kind?: "directory" | "git"
  }
  sessionCount: number
  latestSession?: MobileSessionSummary
}
```

### 7.3 Workspace Sessions

```http
GET /api/mobile/workspaces/:workspaceID/sessions
POST /api/mobile/workspaces/:workspaceID/sessions
```

`GET` 返回某个 workspace 下已有对话。

`POST` 创建新对话。

```ts
interface MobileSessionSummary {
  id: string
  workspaceID: string
  projectID: string
  title: string
  directory: string
  created: number
  updated: number
  status?: "ready" | "running" | "blocked" | "stopped"
}
```

### 7.4 Messages

```http
GET /api/mobile/sessions/:sessionID/messages
POST /api/mobile/sessions/:sessionID/messages
POST /api/mobile/sessions/:sessionID/messages/stream
```

建议：

- `GET` 读取会话消息。
- `POST` 非流式发送。
- `/stream` 用 SSE 或 WebSocket 返回流式增量。

### 7.5 Events

```http
GET /api/mobile/events/stream
```

SSE 事件：

```ts
type MobileEvent =
  | { type: "workspace.updated"; workspace: MobileWorkspace }
  | { type: "session.created"; session: MobileSessionSummary }
  | { type: "session.updated"; session: MobileSessionSummary }
  | { type: "message.delta"; sessionID: string; text: string }
  | { type: "message.completed"; sessionID: string }
  | { type: "approval.requested"; approval: MobileApproval }
  | { type: "task.updated"; task: MobileTask }
```

### 7.6 Approvals

```http
GET /api/mobile/approvals
POST /api/mobile/approvals/:approvalID/approve
POST /api/mobile/approvals/:approvalID/deny
```

手机端远程控制最有价值的功能之一是权限审批：

- 查看命令。
- 查看目标文件/目录。
- 查看风险说明。
- 批准一次。
- 拒绝。
- 可选：批准本会话内同类操作。

### 7.7 Workspace Files

第一阶段只读：

```http
GET /api/mobile/workspaces/:workspaceID/files
GET /api/mobile/workspaces/:workspaceID/files/content?path=...
GET /api/mobile/workspaces/:workspaceID/files/search?q=...
```

手机端不要第一阶段开放任意写文件，除非有明确权限和审计。

## 8. UI 信息架构

推荐主导航：

```text
Home
  Workspaces
  Recent Sessions
  Approvals

Workspace Detail
  Chats
  Files
  New Chat

Session Detail
  Messages
  Composer
  Task status
  Stop / Resume

Approvals
  Pending
  History
```

### 8.1 Home

内容：

- Desktop connected 状态。
- Workspaces 列表。
- Recent Sessions 列表。
- Pending approvals 入口。

Workspaces 每行：

- workspace 名称。
- 路径或仓库名。
- session 数量。
- 最新更新时间。

Recent Sessions 每行：

- session 标题。
- 所属 workspace。
- 更新时间。
- 状态。

### 8.2 Workspace Detail

点击 workspace 后不直接进入 chat。

应先显示：

- workspace 标题。
- workspace 路径。
- 已有 chats 列表。
- 底部固定 `New chat` 按钮。

流程：

```text
Tap workspace
  -> Workspace Detail
  -> Tap existing chat
      -> Session Detail
  -> Tap New chat
      -> create session
      -> Session Detail
```

### 8.3 Session Detail

内容：

- 顶部：Back、session 标题、Refresh/Stop。
- 中间：消息列表。
- 底部：composer。
- 状态条：running / waiting approval / completed / cancelled。

消息展示：

- User / Assistant 分组。
- 流式输出逐步追加。
- tool call / reasoning 默认折叠。
- 文件变更用摘要卡片展示。

### 8.4 Approvals

内容：

- 待审批数量 badge。
- 每个审批展示：
  - 操作类型。
  - 命令或文件。
  - 风险提示。
  - Allow / Deny。

审批是手机端远程控制的核心差异化能力，应优先级较高。

## 9. 实时同步设计

推荐第一阶段继续 SSE，后续切 WebSocket。

### 9.1 SSE

优点：

- 浏览器原生支持。
- 实现简单。
- 适合服务端推送事件。

缺点：

- 单向。
- 移动网络断线重连需要处理。

适用：

- 消息增量。
- session 状态。
- approvals。

### 9.2 WebSocket

后续用于：

- 云端 relay。
- 双向控制。
- 心跳。
- 多设备同步。

## 10. 桌面端职责

桌面端应负责：

- 启动 mobile gateway。
- 托管 mobile-web 静态资源。
- 管理配对设备。
- 校验权限。
- 调用 agent API。
- 转发实时事件。
- 提供桌面侧状态，例如当前 active workspace。

桌面端不应负责：

- 在 TypeScript 字符串里维护复杂 UI。
- 把 agent 内部 API 不加筛选地暴露给手机。
- 长期依赖单个全局 URL token。

## 11. 手机端职责

手机端应负责：

- 渲染移动端 UI。
- 管理设备登录态。
- 管理本地路由。
- 订阅事件流。
- 展示 workspace/session/message/approval。
- 发起用户操作。

手机端不应负责：

- 直接理解桌面端内部 IPC。
- 直接访问 agent 全量 API。
- 执行复杂文件系统逻辑。

## 12. 安全设计

### 12.1 风险

- 局域网中其他设备扫描端口。
- URL token 泄露。
- 手机丢失后仍可控制桌面。
- 恶意网页跨站请求。
- 远程执行敏感命令。

### 12.2 基础防护

- Bearer device token。
- token hash 存储。
- 设备可撤销。
- 配对码一次性、短有效期。
- 每台设备独立 token。
- CORS 严格限制，或者只接受 same-origin mobile UI。
- 所有敏感操作二次确认。
- 审计日志记录设备 ID、时间、操作。

### 12.3 权限分层

建议权限：

- Read only。
- Chat control。
- Approval control。
- File read。
- Task control。

默认新设备只开启：

- workspace:read
- session:read
- session:create
- message:send

审批和文件读取可以后续单独授权。

## 13. 数据与状态模型

手机端状态：

```ts
interface MobileAppState {
  auth: {
    deviceID: string | null
    token: string | null
    desktopName: string | null
    connected: boolean
  }
  workspaces: MobileWorkspace[]
  recentSessions: MobileSessionSummary[]
  activeWorkspaceID: string | null
  activeSessionID: string | null
  messagesBySessionID: Record<string, MobileMessage[]>
  pendingApprovals: MobileApproval[]
}
```

服务端状态：

- paired devices。
- live connections。
- pending approvals。
- session subscriptions。
- event cursors。

## 14. 项目结构建议

短期：

```text
packages/desktop/
  src/main/mobile-bridge-server.ts
  src/main/mobile-api/
    auth.ts
    devices.ts
    workspaces.ts
    sessions.ts
    events.ts

packages/mobile-web/
  src/
    api/
    app/
    components/
    routes/
    state/
```

当前 `mobile-bridge-server.ts` 应逐步拆分：

- HTTP server bootstrap。
- auth/token/device。
- mobile API handlers。
- static asset serving。
- legacy inline HTML fallback。

## 15. 分阶段实施计划

### Phase 0：整理当前 bridge

目标：

- 保留现有功能。
- 拆出 mobile API handler。
- 消除大型内联 HTML 的复杂度。

任务：

- 把 `/api/mobile/workspaces`、sessions、messages 路由整理成独立模块。
- 保留当前内联 HTML 作为临时 fallback。
- 增加 mobile API 单元测试。
- 增加手动调试说明。

验收：

- 当前手机 URL 仍可使用。
- Workspaces、Chats、New chat、Messages 正常。

### Phase 1：独立 mobile-web PWA

目标：

- 手机 UI 独立项目化。
- 桌面端只托管静态资源。

任务：

- 新建 `packages/mobile-web`。
- 实现路由：
  - `/connect`
  - `/`
  - `/workspaces/:workspaceID`
  - `/sessions/:sessionID`
  - `/approvals`
- 实现 mobile API client。
- 实现基础状态管理。
- 桌面端托管 `mobile-web/dist`。

验收：

- 不再依赖 `mobileAppHtml()` 维护主要 UI。
- PWA 可以在手机浏览器独立运行。

### Phase 2：实时事件

目标：

- 手机端实时更新。

任务：

- 增加 `/api/mobile/events/stream`。
- 手机端订阅 SSE。
- session 消息流式更新。
- pending approvals 实时出现。
- 断线重连和 last event cursor。

验收：

- 桌面端新消息/状态变化能推送到手机。
- 手机端刷新不是主要同步手段。

### Phase 3：配对与设备管理

目标：

- 替换 URL token。

任务：

- 桌面端生成 QR code。
- pairing code 短期有效。
- 创建设备 token。
- 桌面端设备管理 UI。
- 撤销设备。

验收：

- 手机可扫码配对。
- 设备 token 持久化。
- 单设备可撤销。

### Phase 4：能力级远程控制

目标：

- 支持高价值远程操作。

任务：

- Approvals。
- Stop / Cancel task。
- Resume task。
- 查看文件变更摘要。
- 只读文件浏览。

验收：

- 用户可以在手机上完成“看进度、继续聊、审批、停止”的闭环。

### Phase 5：云端 relay

目标：

- 跨网络访问。

任务：

- 设计 relay 服务。
- 桌面端 outbound WebSocket。
- 手机端 relay 连接。
- 账号绑定。
- relay 权限和审计。

验收：

- 手机和电脑不在同 Wi-Fi 时仍可连接。
- 桌面端无需开放局域网端口。

### Phase 6：原生 App 可选

目标：

- 更好的长期体验。

任务：

- Expo App。
- 安全存储。
- 系统通知。
- 分享入口。
- 后台连接策略。

验收：

- 可作为正式 Anybox Mobile 分发。

## 16. 关键设计取舍

### PWA vs 原生

建议先 PWA，因为当前最重要的是验证产品流程和 API，而不是平台能力。

### 局域网直连 vs 云端 relay

建议先局域网直连，因为实现快；但 API 和 auth 要按未来 relay 设计，不要绑定 LAN 假设。

### 能力级控制 vs 屏幕共享

建议能力级控制。Anybox 的核心是 agent workflow，不是传统远程桌面。能力级控制更安全、更稳定、体验更轻。

### 复用桌面 UI vs 专门移动 UI

建议专门移动 UI。桌面 UI 信息密度太高，手机端需要不同的信息架构。

## 17. 待讨论问题

1. 手机端首屏应该更偏向 Workspaces，还是更偏向 Recent Sessions？
2. 是否允许手机端读取 workspace 文件？
3. 是否允许手机端批准命令执行？
4. 是否需要多用户/多设备同时连接？
5. 是否需要云端 relay，还是局域网已经满足第一版？
6. 是否需要手机推送通知？
7. 是否要显示 agent reasoning/tool calls？
8. 是否要支持语音输入？
9. 手机端是否需要管理模型、插件、MCP？

## 18. 建议下一步

建议下一步先做 Phase 0 和 Phase 1：

1. 把当前 mobile bridge API 拆模块。
2. 新建 `packages/mobile-web`。
3. 用 PWA 重做当前三个页面：
   - Home
   - Workspace Chats
   - Session Chat
4. 保留现有局域网连接方式。
5. 等 PWA 跑通后再做 pairing、events、approvals。

这样可以最快把当前验证性实现转成可持续开发的手机端产品。
