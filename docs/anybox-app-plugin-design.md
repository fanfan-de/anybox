# Anybox App Plugin 设计框架

> 状态：目标设计草案 v0.2
> 日期：2026-08-10  
> 范围：定义“完整 Web App 安装到 Anybox，安装后出现在 Right Sidebar，并在 Tools Surface 中进入业务界面”的产品与技术边界。

> [!IMPORTANT]
> 本文描述的是 App Plugin 的目标架构，不是当前已经全部实现的 Manifest 格式。当前解析器只支持严格的 `views`、`mcpServers`、`skills`、`connectors` 等字段；本文出现的 `appRuntime`、`appPermissions` 等字段均为待实现的目标契约，在 Schema 落地前不能直接写入正式插件 Manifest。

## 1. 核心结论

App Plugin 是一个完整、可独立运行的 Web App 在 Anybox 中的安装与集成形态，而不是一组由 Anybox 业务 API 拼装出来的宿主扩展。

用户侧的核心体验是：

```text
下载并安装 App Plugin
  → Right Sidebar 自动出现 App 入口
  → 用户点击入口
  → Anybox 激活承载该入口的 Tools Surface
  → App 的完整业务界面在 Anybox 中打开
```

`right-sidebar` 是 Manifest 中稳定的逻辑 View 位置，不等于 App 只能显示在狭窄侧栏里。Anybox 可以通过布局模式把整个 Tools Surface 放到中间主区域；App 不需要因为布局切换而声明另一种 View，也不需要维护另一套业务 UI。

同一个 App 同时具有两种运行形态：

```text
独立运行
└── App Web
    └── App 自己的业务能力与后端

安装到 Anybox
└── Right Sidebar 中的 App 入口
    └── Tools Surface（Primary 或 Companion）
        └── 同一个 App Web
            └── App 自己的业务能力与后端
```

安装 App Plugin 到 Anybox，本质上是为这个独立 App 增加安装、入口、嵌入容器和可选宿主集成：

```text
Anybox
└── Right Sidebar 中的 App 入口
    └── 可切换到中间的 Tools Surface
        └── 完整 Web App
            ├── 自己的 Web UI
            ├── 自己的业务 API
            ├── 可选的本地或远程 Runtime
            ├── 自己的业务数据与迁移
            ├── 自己的 Provider 适配
            └── 可选的 MCP、Skill 和 Connector 集成
```

Anybox 是 App Plugin 的安装器、入口管理器、Web 容器和通用系统集成层。App Plugin 本身才是产品。

由此得到六条不可违背的原则：

1. App 在 Anybox 外可以通过自己的标准 Web 入口独立打开和使用。
2. 安装到 Anybox 后，App 必须通过 `right-sidebar` View 获得入口，并在同一个 Tools Surface 中打开完整业务界面。
3. App 的业务能力由 App 自己实现；App Web 调用 App 自己的 API，不把每个业务操作翻译成 Anybox Bridge 或 MCP Tool。
4. Anybox 只提供通用安装、入口、Web 容器、布局、启动、隔离、代理、权限和系统集成能力。
5. Anybox 核心不得包含 Cinema、Timeline、Storyboard、Render Job 等某个 App 专属的业务知识。
6. MCP、Skill 和 Connector 是 App 的可选 Agent 集成，不是 App Web 正常运行的前提。

## 2. App Plugin 与能力插件的区别

Anybox 插件系统可以同时承载两类插件，但不能混淆它们的运行模型。

| 类型 | 主要用途 | 核心入口 | 是否必须有独立 UI | 是否必须依赖 Agent |
|---|---|---|---|---|
| 能力插件 | 给 Agent 增加工具、Skill、Connector | MCP、Skill、Connector | 否 | 通常是 |
| App Plugin | 在 Anybox 中安装一个完整 Web 产品 | `right-sidebar` View / Tools Surface | 是 | 否 |

一个 App Plugin 可以同时声明 MCP、Skill 或 Connector。例如 Cinema 可以独立运行，同时向 Agent 暴露“创建分镜”“读取项目摘要”等工具。但即使用户关闭 Agent 功能，Cinema App 本身仍应能够正常打开和工作。

### 2.1 不采用的模型

下面的模型不应成为 App Plugin 的主架构：

```text
App Web
  → window.anyboxPlugin.call("cinema_start_generation")
  → Anybox 解释 Cinema 业务调用
  → MCP Runtime
```

这个模型会让 App 依赖 Anybox 的工具协议，并迫使宿主理解 App 的业务动作。它适合 Agent Tool，不适合作为完整 App 的前后端通信基础。

### 2.2 采用的模型

App Web 应保持普通 Web App 的通信模型，直接调用 App 自己拥有的本地或远程 API。对于由 Anybox 管理的本地 Runtime，请求通过同源 Gateway 透明转发：

```text
独立运行
App Web
  → fetch(App 自己的 API)
  → App Backend

安装到 Anybox，且使用 Local App Runtime
App Web
  → fetch("/__anybox_runtime__/api/projects")
  → Anybox 内部透明代理
  → App 自带 Runtime
```

Anybox 只校验调用者身份、运行时归属、生命周期和安全策略，然后透明转发 HTTP 请求。Anybox 不解析 URL 中的业务含义，也不解析业务 JSON。

纯前端 App 不需要 `appRuntime`。使用开发者云端后端的 App 也不需要携带本地 Runtime，只需要遵守经过授权的网络访问策略。开放第三方 Web App 与允许第三方执行任意本机代码不是同一个产品能力。

## 3. 总体架构

```mermaid
flowchart LR
  subgraph Package["App Plugin 包"]
    Manifest[".anybox-plugin/plugin.json"]
    Web["web/ · App Web"]
    Runtime["runtime/ · 可选 Local Runtime"]
    AgentExt["可选 MCP / Skill / Connector"]
    AgentExt -. 可选调用 .-> Runtime
  end

  Remote["开发者自己的 Remote Backend"]

  subgraph Host["Anybox 宿主"]
    Installer["安装、更新、卸载"]
    ViewHost["Right Sidebar View Host"]
    Supervisor["通用 Runtime Supervisor"]
    Gateway["App Runtime Gateway"]
    Security["隔离、权限、数据目录、凭据"]
  end

  Installer --> Manifest
  Manifest --> ViewHost
  ViewHost -->|"Right Sidebar 入口 / Tools Surface"| Web
  Web -->|"普通 HTTP / Fetch"| Gateway
  Gateway -->|"不理解业务的透明代理"| Runtime
  Web -->|"授权的 HTTPS"| Remote
  Supervisor --> Runtime
  Security --> ViewHost
  Security --> Supervisor
```

### 3.1 关键边界

App Web 与它使用的本地或远程后端属于同一个产品。Anybox 嵌入的是 App 的 Web 入口；只有 App 携带 Local Runtime 时，Anybox 才位于 Web 与 Runtime 之间，提供内部寻址、进程监督和桌面集成。

因此，App Runtime 不等同于当前 `mcpServers[].runtime`：

- MCP Runtime 面向 Agent Tool Protocol。
- App Runtime 面向 App 自己的 HTTP API、媒体流、上传、SSE 或 WebSocket。
- 两者可以复用 App 内部业务模块，但生命周期和调用协议相互独立。

## 4. 所有权划分

### 4.1 App Plugin 自己拥有的内容

| 领域 | App Plugin 的责任 |
|---|---|
| 产品 UI | 页面、路由、Canvas、Timeline、表单、弹窗、错误状态和可访问性 |
| 业务 API | API 路径、请求和响应格式、版本兼容、错误码 |
| 领域模型 | 节点、时间线、任务、资产、项目等所有业务对象 |
| 业务规则 | 校验、状态机、撤销重做、任务恢复、重试和取消 |
| Provider | 第三方 API 请求、模型列表、轮询、结果归一化和错误映射 |
| 持久化 | 数据格式、索引、数据库、迁移和兼容策略 |
| 媒体处理 | 渲染图、编解码参数、字幕合成、导出预设和产物管理 |
| 产品日志 | App 专属日志字段、错误上下文和诊断语义 |
| 独立运行 | 在 Anybox 外通过标准 Web 入口启动，并完成同一套核心产品流程 |

### 4.2 Anybox 宿主拥有的内容

| 领域 | Anybox 的责任 |
|---|---|
| 安装 | Catalog、包校验、原子安装、更新、禁用和卸载 |
| UI 容器 | 安装后注册 Right Sidebar 入口、承载 Tools Surface、加载状态以及 Primary/Companion 布局切换 |
| Web 安全 | 独立 Session Partition、Sandbox、CSP、导航和权限控制 |
| Runtime 生命周期 | 仅对声明 Local Runtime 的 App 提供通用启动、健康检查、停止、崩溃重启、退避和日志收集 |
| 内部寻址 | 给 App Web 提供稳定、不可伪造的 Runtime 地址 |
| 内部代理 | 透明转发 HTTP、上传、下载、Range、SSE 和 WebSocket |
| 数据目录 | 提供稳定的 App Data 和 Cache 目录，不规定内部格式 |
| Workspace 授权 | 由用户选择并授权 App 可以访问的目录 |
| 系统能力 | 文件选择器、打开外部链接、通知、剪贴板等受控桌面能力 |
| 凭据保险箱 | 可选地提供系统级安全存储，但不定义 App 的登录业务 |
| 安装审查 | 展示本地命令、网络、文件、原生组件和高风险权限 |

### 4.3 共同边界

有些能力需要双方配合，但业务所有权仍属于 App：

- App 定义项目文件格式；Anybox 只授予某个目录的访问权。
- App 定义 Provider 登录和调用流程；Anybox 可以提供安全凭据存储。
- App 定义任务进度和取消语义；Anybox 只保证 Runtime 进程可用。
- App 生成和组织媒体；Anybox 只提供安全、支持 Range 的资源传输。
- App 定义数据迁移；Anybox 只保证升级期间数据目录不会被替换。

## 5. 插件包结构

推荐的完整 App Plugin 包结构如下。只有需要本地后端的 App 才包含 `runtime/`：

```text
<plugin-id>/
├── .anybox-plugin/
│   └── plugin.json
├── web/
│   ├── index.html
│   └── assets/
├── runtime/                    # 可选 Local Runtime
│   ├── server.js
│   ├── api/
│   ├── domain/
│   ├── providers/
│   ├── storage/
│   └── migrations/
├── shared/
│   └── contracts/
├── assets/
├── docs/
├── skills/                 # 可选 Agent 集成
├── mcp/                    # 可选 Agent MCP Adapter
└── connectors/             # 可选凭据或外部服务集成
```

规则：

- `.anybox-plugin` 只是元数据目录，不是插件包根目录。
- `web/` 必须包含可离线加载的构建产物，不能依赖 Vite 开发服务器。
- `web/` 应使用包内相对资源路径，并能在 Anybox 自定义本地协议下加载，不能假设固定的站点根路径。
- 独立运行与 Anybox 内运行应复用同一套产品代码；环境差异通过 Base URL、运行配置或可选 Host SDK 适配。
- `runtime/` 属于 App，不属于 Anybox Agent；纯前端或远程后端 App 可以省略它。
- App 包安装目录视为只读代码目录，运行时数据不能写入 `${PLUGIN_ROOT}`。
- MCP Adapter 可以调用 App Runtime 或复用 `runtime/domain`，但不能反过来成为 Web UI 的必选依赖。

## 6. Runtime 模型

App Plugin 的产品定义是“可独立运行的完整 Web App”，并不要求每个 App 都携带本地进程。平台应支持以下三种运行与后端形态。

### 6.1 Static Web App

只有本地 Web 资源，所有逻辑都能在浏览器 Sandbox 中完成。

```text
web/index.html
```

适合计算器、可视化工具、离线编辑器等。当前 `react-sidebar-proof` 已经验证了这一形态的最小基础。

### 6.2 Local App Runtime

插件包携带本地 Runtime。Anybox 通用启动 Runtime，但不理解它的业务 API。

```text
web/index.html
runtime/server.js
```

推荐协议是受控的 Loopback HTTP：

1. Anybox 分配临时端口和一次性 Runtime Token。
2. Runtime 只能监听 `127.0.0.1` 或宿主提供的受控 IPC 端点。
3. Token 通过环境变量传给 Runtime，不暴露给 App Web。
4. App Web 请求 Anybox 的同源内部路径。
5. Anybox Gateway 为 Runtime 注入 Token 并透明转发请求。

这样既保留普通 Web App 的开发模型，也不向页面暴露随机端口、密钥或 Node.js 权限。

Local Runtime 是可选高级能力，不是开放第三方 App Plugin 的默认前提。携带本机可执行代码的 App 必须采用高于纯 Web App 的安装审查和发布者信任策略。

### 6.3 Web App + Remote Backend

插件包携带可在 Anybox 内加载的前端，产品后端由开发者自己的 HTTPS 服务提供。同一个 Web App 在 Anybox 外也调用该服务。

Anybox 可以有两种实现：

- 根据 Manifest 的 Origin Allowlist 允许 App Web 直接访问声明的 HTTPS Origin。
- 通过 Anybox Gateway 代理到声明的远程 Runtime。

第一种更接近普通 Web App；第二种更容易统一身份、CORS、审计和凭据保护。两者都不能默认开放任意网络访问。

### 6.4 独立模式与 Anybox 模式

App 应明确支持两个启动入口，但不维护两套产品实现：

```text
Standalone Mode
  Web App → 开发者自己的静态托管或开发服务器 → App Backend

Anybox Mode
  安装包 web/index.html → Anybox Tools Surface → 同一个 App Backend
```

App 可以检测可选的 `window.anyboxApp` 来增强桌面集成，但核心业务流程不得以该对象存在为前提。独立模式下不存在 Host SDK 时，App 应回退到自己的 Web 交互，例如浏览器文件选择器、站内通知或开发者自己的登录流程。

## 7. App Runtime 通用契约

Local App Runtime 应遵循最小、与业务无关的启动契约。

### 7.1 宿主注入的环境变量

建议提供：

```text
ANYBOX_APP_ID
ANYBOX_APP_VERSION
ANYBOX_APP_PORT
ANYBOX_APP_TOKEN
ANYBOX_APP_DATA_DIR
ANYBOX_APP_CACHE_DIR
ANYBOX_APP_LOG_DIR
ANYBOX_APP_LOCALE
```

其中：

- `PORT` 由宿主分配，Runtime 不自行选择固定端口。
- `TOKEN` 只用于宿主与 Runtime 的内部认证。
- `DATA_DIR` 跨启用、禁用和版本升级保留。
- `CACHE_DIR` 可以由宿主清理。
- App 不能假设任何绝对安装路径，只能使用宿主变量和包内相对路径。

### 7.2 健康检查

Runtime 必须提供不包含业务副作用的健康检查，例如：

```http
GET /health
```

响应至少包含 Runtime 版本和 Ready 状态。Anybox 只判断 Runtime 是否可用，不解释业务健康指标。

### 7.3 内部代理

建议为 App Web 保留同源路径前缀：

```text
/__anybox_runtime__/*
```

例如：

```ts
const response = await fetch("/__anybox_runtime__/api/projects")
```

Gateway 应支持：

- 常规 HTTP 方法和状态码；
- JSON、FormData 和流式上传；
- 文件下载和 `Range` 请求；
- SSE；
- WebSocket；
- 请求取消和合理超时；
- 对敏感响应头的过滤。

Gateway 不应：

- 将每个业务接口注册成 Anybox IPC；
- 解析 App 的 JSON Schema；
- 把 App API 自动暴露给 Agent；
- 允许一个 App 访问另一个 App 的 Runtime；
- 将 Runtime 的真实端口或 Token 暴露给 Web 页面。

## 8. 最小宿主 SDK

App 的业务请求使用普通 HTTP。只有真正属于宿主的动作才进入可选的 `window.anyboxApp` SDK。

允许的通用能力示例：

```ts
interface AnyboxAppHost {
  getContext(): Promise<{
    appID: string
    appVersion: string
    locale: string
    colorScheme: "light" | "dark"
    surfaceRole: "primary" | "companion"
  }>

  requestWorkspaceAccess(): Promise<{ grantID: string } | null>
  pickFiles(options?: { multiple?: boolean }): Promise<Array<{ handle: string; name: string }>>
  openExternal(url: string): Promise<void>
  notify(input: { title: string; body?: string }): Promise<void>
}
```

SDK 中不应出现下面的接口：

```text
startCinemaGeneration
createStoryboard
renderTimeline
listCinemaAssets
```

这些都是 App 自己的业务 API。

SDK 必须由 Anybox 自有 Preload 注入，插件不能声明或替换 Preload。

## 9. Manifest 目标形态

当前 `views` 继续作为 App Plugin 的唯一 UI 入口；不新增 `workbench`、`document-tab` 等 Surface。

`location: "right-sidebar"` 表示该 View 属于 Tools Surface。安装成功后，Anybox 根据它在 Right Sidebar 注册入口；用户点击入口后，宿主打开对应 View。Tools Surface 可以保持 Companion 布局，也可以通过现有布局模式进入中间 Primary 区域，Manifest 和 App Web 都不需要改变。

### 9.1 完整 Web App 的最小 Manifest

对于纯前端 App，或前端调用开发者远程后端的 App，现有 `views` 已经能够表达核心产品入口：

```json
{
  "name": "example-app",
  "version": "1.0.0",
  "description": "A complete standalone Web App available inside Anybox.",
  "views": [
    {
      "id": "main",
      "title": "Example App",
      "location": "right-sidebar",
      "entry": "./web/index.html"
    }
  ]
}
```

这个 Manifest 表达的是：

1. 安装后出现一个名为 `Example App` 的入口；
2. 点击入口加载 `web/index.html`；
3. 该页面是完整 App 的 Web 构建产物，不是 MCP Tool 的操作面板；
4. App 是否使用远程后端，属于 App 自己的产品架构；
5. App 不声明 MCP、Skill 或 Connector 也可以成立。

纯前端 Static Web App 可以沿用当前能力直接运行。调用 Remote Backend 的 Web App 还需要 Phase 2 的精确网络授权；在该能力实现前，当前 `connect-src 'none'` 会阻止远程请求。

### 9.2 可选 Local Runtime Manifest

只有需要 Anybox 启动本地后端进程的 App，才需要在现有 View 之外增加一个与业务无关的 `appRuntime` 目标声明：

```json
{
  "name": "cinema",
  "version": "1.0.0",
  "description": "A complete AI filmmaking application.",
  "views": [
    {
      "id": "main",
      "title": "Cinema",
      "location": "right-sidebar",
      "entry": "./web/index.html"
    }
  ],
  "appRuntime": {
    "type": "local-http",
    "command": "node",
    "args": ["${PLUGIN_ROOT}/runtime/server.js"],
    "cwd": "${PLUGIN_ROOT}",
    "healthcheckPath": "/health",
    "startupTimeoutMs": 15000,
    "idleTimeoutMs": 300000
  },
  "appPermissions": {
    "workspace": "request",
    "network": [
      "https://api.example.com"
    ],
    "system": [
      "file-picker",
      "notifications"
    ]
  }
}
```

设计要求：

- `views` 始终定义用户可见入口；`appRuntime` 不能替代 View。
- `right-sidebar` 是 Tools Surface 的逻辑位置，不限制宿主把该 Surface 放在中间 Primary 区域。
- `appRuntime` 只描述如何启动和判断 Ready，不描述业务接口。
- `appPermissions` 用于 Web 网络和宿主能力授权，以及 Local Runtime 的安装风险披露，不作为普通展示元数据。
- `appRuntime` 与 `mcpServers` 相互独立。
- 没有 `appRuntime` 的 View 继续作为 Static Web App 或 Remote Backend Web App 加载。
- 未来若支持 Remote Runtime，应使用明确的 `type` 判别，不复用 MCP 的 `remote` 语义。
- Schema 必须继续严格校验；新增字段时同步 Parser、测试、开发指南和 Skill。

## 10. Web 安全模型

第三方 App Web 默认是不可信页面。Anybox 对嵌入式 Web 容器和所有宿主能力调用承担安全边界，应保持以下约束：

1. `nodeIntegration=false`。
2. `contextIsolation=true`。
3. `sandbox=true`。
4. 每个插件使用独立 Session Partition。
5. 禁止插件自带 Preload。
6. 默认禁止任意导航、新窗口、权限请求和未声明网络。
7. 静态资源只能来自安装后插件包的真实路径，拒绝路径穿越和符号链接逃逸。
8. Runtime Gateway 根据当前已安装且启用的 App 身份建立路由，不能信任页面提交的 `pluginID`。
9. CSP 根据 App 类型和已授予权限生成；Static App 默认只允许包内资源。
10. App Web 永远不能直接读取 Runtime Token、系统凭据或任意本地绝对路径。

当前 Plugin View 使用 `connect-src 'none'`。目标实现不能简单地把它改成 `connect-src *`，而应只增加当前 App 的内部 Runtime Origin 和明确授权的网络 Origin。

Web 权限与本机代码风险必须分开表达：

- Web 网络、导航、弹窗和 Host SDK 权限由 Anybox 实际执行。
- Remote Backend App 只能访问 Manifest 声明并经用户授权的 HTTPS Origin。
- Local Runtime Gateway 只能路由到当前 View 所属 App，不能接受页面自报的 App 身份。
- Local Runtime 自身的本机文件和网络能力，只有在存在 OS 级 Sandbox 时才能称为强制权限隔离。

### 10.1 Local Runtime 的风险级别

本地 Runtime 是真实本机代码，风险高于纯 HTML View。没有 OS 级进程 Sandbox 时，网络和文件权限声明只能提供审查与约束意图，不能被宣传为完整隔离。

因此安装本地 Runtime App 时至少需要：

- 展示将执行的 command、args、cwd；
- 展示网络、Workspace、原生组件和凭据权限；
- 验证所有包内可执行路径；
- 支持发布者签名和信任链；
- 记录安装、更新和 Runtime 启动审计；
- 对未知来源给出明确风险提示。

开放第三方 App 平台不等于默认允许所有 App 执行本机代码。Static Web App 和 Remote Backend Web App 可以作为普通开放安装类型；Local Runtime App 应作为更高信任级别的能力单独审查。

## 11. 数据和文件模型

本节主要适用于 Local Runtime，以及未来由 Anybox 托管持久数据的 Web App。仅使用开发者 Remote Backend 的 App，其云端业务数据仍由开发者自己的服务负责。

### 11.1 目录语义

```text
PLUGIN_ROOT          安装后的只读代码与静态资源
APP_DATA_DIR         持久化业务数据，跨版本保留
APP_CACHE_DIR        可重建缓存，可由用户或宿主清理
APP_LOG_DIR          Runtime 日志
WORKSPACE_GRANT      用户显式授权的项目目录
```

### 11.2 生命周期规则

- 禁用 App：保留 Data、Cache 和用户 Workspace 文件。
- 更新 App：保留 Data，由 App 自己执行数据迁移。
- 更新失败：Anybox 原子恢复旧代码包；App 必须保证数据迁移具备事务性、向后兼容或可恢复备份，宿主不承诺自动理解并回滚 App 私有数据格式。
- 卸载 App：停止 Runtime 并撤销权限；是否删除 App Data 必须由用户明确选择。
- 卸载永远不能删除用户 Workspace 中的项目文件。
- Cache 可以在卸载或用户清理时删除。

## 12. Local Runtime 生命周期

本节只适用于声明 `appRuntime` 的 App。推荐一个已安装 App 在同一用户配置中只运行一个 Runtime 实例，多个 View 或标签页共享它。

```mermaid
stateDiagram-v2
  [*] --> Stopped
  Stopped --> Starting: 首次打开 View 或后台任务需要
  Starting --> Ready: healthcheck 通过
  Starting --> Failed: 超时或启动失败
  Ready --> Idle: 所有 View 关闭且无后台任务
  Idle --> Ready: View 再次打开
  Idle --> Stopped: 达到 idleTimeout
  Ready --> Restarting: Runtime 崩溃
  Restarting --> Ready: 退避重启成功
  Restarting --> Failed: 超过重试上限
  Ready --> Stopped: 禁用、更新或卸载
  Failed --> Starting: 用户重试
```

关键规则：

- 关闭 View 不等于立即杀死 Runtime；长任务可以继续。
- 宿主不能通过解析业务任务判断是否可以空闲停止；若启用 `idleTimeout`，必须先有通用的后台 Lease 或等价保活契约。
- Runtime 自己负责恢复哪些业务任务，宿主只负责进程重启。
- 更新前先停止旧 Runtime，再原子替换包。
- Runtime 的 stderr/stdout 进入按 App 隔离的诊断日志。
- 崩溃循环必须有限流和用户可见的错误状态。

## 13. Cinema Web 的目标映射

### 13.1 当前状态

当前 Cinema 尚未形成独立 App Plugin：

- UI 位于 `packages/cinema-web`。
- 业务 Runtime 大量位于 `packages/anyboxagent/src/cinema`。
- HTTP 路由位于 `packages/anyboxagent/src/server/routes/cinema.ts`。
- Use Case 位于 `packages/anyboxagent/src/server/usecases/cinema.ts`。
- 当前 `plugins/Anybox-Plugins/cinema` 主要提供 Skill 和 MCP helper，Manifest 明确说明 Provider Runtime 仍在 AnyBox Agent。

这意味着当前 Anybox 宿主仍然理解大量 Cinema 业务知识。

### 13.2 完全插件化后的结构

```text
plugins/Anybox-Plugins/cinema/
├── .anybox-plugin/plugin.json
├── web/                         # 原 packages/cinema-web 构建产物
├── runtime/
│   ├── server.js
│   ├── canvas/
│   ├── timeline/
│   ├── assets/
│   ├── generation/
│   ├── providers/
│   ├── render/
│   └── storage/
├── shared/
├── skills/
├── mcp/                         # 可选 Agent Adapter
└── assets/
```

### 13.3 请求链路

Cinema Web 当前已经使用 `agentBaseURL + fetch()` 调用 `/api/cinema/*`。迁移时不需要把这些调用全部改造成 MCP Tool；可以把 `agentBaseURL` 改为 App Runtime Gateway 的 Base URL，并尽量保留现有 HTTP API：

```text
Cinema Web
  → /__anybox_runtime__/api/cinema/projects/:id
  → Cinema Runtime
  → Cinema 自己的 Canvas、Timeline、Provider、Render 和 Storage
```

Anybox Gateway 只转发请求，不知道 `/api/cinema/projects` 代表什么。

Cinema 迁移还需要满足通用 App Plugin 的产品入口：

```text
安装 Cinema App Plugin
  → Right Sidebar 出现 Cinema
  → 点击 Cinema
  → Tools Surface 打开 Cinema Web
  → 用户可把 Tools Surface 切换到中间 Primary 布局
```

Cinema Web 的独立启动入口继续保留。构建产物需要改为插件包兼容的相对资源路径；当前依赖 Anybox `projectID` 的路径解析应迁移为 Cinema 自己的项目上下文或通用 Workspace Grant，不能把 Anybox 项目注册表变成 App Plugin 的隐藏业务依赖。

### 13.4 Cinema 与宿主的最终边界

Cinema 插件拥有：

- Cinema Web；
- Canvas 和 Timeline；
- Asset Library；
- Generation Task；
- Kling、ComfyUI 等 Provider；
- Render Runtime；
- Cinema 项目和私有数据格式；
- Cinema 数据迁移；
- 可选 Cinema MCP 和 Skill。

Anybox 保留：

- 插件安装和更新；
- Right Sidebar 和居中布局；
- App Runtime Supervisor；
- Runtime Gateway；
- Webview Sandbox；
- 用户授权的 Workspace、文件选择器和安全资源传输；
- 通用凭据保险箱与安装权限审查。

## 14. 当前实现与目标设计的差距

| 能力 | 当前状态 | 目标 |
|---|---|---|
| 本地 HTML/React View | 已支持 | 保留 |
| 安装后注册 App 入口 | 已支持 View 基础链路 | 固化为 App Plugin 产品契约 |
| UI 逻辑位置 | 只支持 `right-sidebar` | 保持不变，作为 Tools Surface 入口 |
| Tools Surface 居中 | 已支持 | 保留，App 无需声明第二种 View |
| 完整 Web App 独立运行 | 各 App 自行实现 | 形成开发、构建和验收规范 |
| Webview Sandbox | 已支持 | 保留并扩展 |
| App Web 网络访问 | `connect-src 'none'` | 按内部 Runtime 和权限精确开放 |
| App Runtime Manifest | 未支持 | 新增独立于 MCP 的严格 Schema |
| App Runtime Supervisor | 未支持 | 新增通用生命周期管理 |
| App Runtime Gateway | 未支持 | 新增同源透明代理 |
| App Data/Cache 目录 | 未作为 App 契约提供 | 增加稳定目录和升级语义 |
| 大文件/媒体 Range | 仅包内 Preview 资源 | Gateway 支持 Runtime 动态媒体 |
| SSE/WebSocket | App View 未支持 | Gateway 支持长任务事件 |
| 最小宿主 SDK | 未支持 | 只提供通用桌面能力 |
| Cinema 独立 Runtime | 仍在 Anybox Agent | 移入 Cinema 插件 |

另有一处文档漂移：实时解析器和第三方开发指南已经支持 `views`，但 `.agents/skills/anybox-plugin/references/manifest-format.md` 的字段表尚未列出 `views`。实现 App Plugin Schema 时应一并修正。

## 15. 推荐实现顺序

### Phase 1：完成 App Plugin 产品闭环

先不依赖新的 Local Runtime Schema，使用现有 `views` 完成用户可感知的核心体验：

1. 创建一个完整的 `app-plugin-web-proof`，包含可独立启动的 React Web App。
2. 将同一套 Web 构建产物放入插件包 `web/`。
3. 安装插件后，Right Sidebar 自动出现 App 入口。
4. 点击入口后，在 Tools Surface 中打开完整业务界面。
5. 在 Companion 与中间 Primary 布局之间切换时，App 状态和业务功能保持正常。
6. 不声明 MCP、Skill 或 Connector，也能完成核心产品流程。
7. 在关闭源码扫描时，从正式安装包在 Anybox 内完整运行。

### Phase 2：开放第三方 Web App 契约

1. 定义 Static Web App 与 Remote Backend Web App 的发布规范。
2. 为声明的 HTTPS Origin 实现严格网络授权，不开放任意网络。
3. 实现最小、版本化的 `window.anyboxApp` Host SDK。
4. 建立稳定 App ID、发布者身份、包签名、更新连续性和权限变更确认。
5. 完成安装、启用、禁用、更新、卸载和入口同步测试。
6. 提供第三方 App 模板、开发指南和独立/Anybox 双模式验收工具。

### Phase 3：可选 Local App Runtime

仅为确实需要本地后端的 App 增加：

1. 固化 `appRuntime` 与本机代码风险披露 Schema。
2. 实现 Runtime Supervisor、端口分配、Token、Healthcheck 和进程日志。
3. 实现同源 Runtime Gateway，并验证上传、Range、SSE 和 WebSocket。
4. 定义 Data、Cache、Log、Workspace Grant 和后台 Lease 生命周期。
5. 创建 `app-plugin-local-runtime-proof`，验证持久任务、进度、取消和重启恢复。
6. 保持插件 Webview 无 Node 权限和无插件自定义 Preload。
7. 可选增加 MCP Adapter，证明 Agent 集成与 App 主链路解耦。

### Phase 4：Cinema 迁移

1. 让 Cinema Web 独立启动与插件内启动复用同一套产品代码。
2. 把 Cinema Web 构建产物改为包内相对资源并移入插件。
3. 把 Cinema HTTP API、业务 Runtime 和业务契约抽离 Anybox Core。
4. 将 Anybox `projectID` 隐式依赖改为 Cinema 项目上下文或通用 Workspace Grant。
5. 将 `agentBaseURL` 指向 App Runtime Gateway，并尽量保留现有 HTTP API。
6. 移出 Anybox Agent 中的 Cinema 专用 Route、Use Case 和 Runtime。
7. 保留必要的兼容迁移和项目数据升级。
8. 完成大媒体、渲染、Provider、重启和升级回归。

## 16. 验收标准

### 16.1 核心产品验收

App Plugin 产品闭环必须同时满足：

1. App 可以在 Anybox 外通过标准 Web 入口独立打开，并完成核心产品流程。
2. 用户安装 App Plugin 后，Right Sidebar 自动出现对应入口。
3. 用户点击入口后，Anybox 在 Tools Surface 中打开该 App 的完整业务界面。
4. Tools Surface 在 Companion 与中间 Primary 布局之间切换时，App 无需更换 View，功能和状态保持正常。
5. Anybox 内运行与独立运行复用同一套产品代码和业务 API。
6. App 不依赖 MCP、Skill、Connector 或 Agent 也能完成核心产品流程。
7. Anybox 不包含该 App 的业务 Route、类型或业务分支。
8. 禁用或卸载 App 后，入口同步消失；重新启用或安装后恢复。
9. 正式安装包在关闭源码扫描时仍能在 Anybox 内完整运行。

### 16.2 第三方 Web App 平台验收

1. 不同 App 的 Web Session、存储、导航和授权网络相互隔离。
2. App 只能使用已声明并获得授权的 Remote Origin 和 Host SDK 能力。
3. 页面不能自报或伪造 App 身份访问其他 App 的资源。
4. 安装与更新能够展示发布者、权限和权限变化。
5. 未声明 Local Runtime 的 Web App 不获得 Node.js 或任意本机文件访问能力。

### 16.3 Local Runtime 附加验收

只有实现 Local Runtime 能力时，才要求：

1. Runtime 端口和 Token 不暴露给 App Web 或其他插件。
2. 禁用、崩溃和卸载不破坏用户业务数据；更新失败按已声明的数据迁移、兼容或备份契约恢复。
3. 本机代码风险在安装时得到明确审查，并与普通 Web App 区分。
4. Gateway 支持该 App 声明需要的上传、Range、SSE 或 WebSocket 能力。
5. 后台任务通过通用 Lease 或恢复契约处理，不依赖宿主理解业务状态。

Cinema 完全迁移后的最终验收标准是：

> 删除 Cinema 插件后，Anybox 核心仍完整运行且不包含 Cinema 业务知识；重新安装 Cinema 插件后，Cinema 产品能力全部恢复。

## 17. 暂不阻塞架构的待定项

以下问题不阻塞 Phase 1 的“独立 Web App + Right Sidebar 入口 + Tools Surface 业务界面”产品闭环，但必须在对应高级能力实现前定稿：

- Local Runtime 是按 App、用户配置还是 Workspace 启动实例；默认建议按 App 和用户配置单例。
- Remote Backend 采用直接 Origin Allowlist 还是统一 Gateway；默认建议优先 Gateway。
- Runtime 空闲多久后停止，以及后台长任务如何声明保活。
- 卸载时 App Data 默认保留还是默认删除；无论默认值如何都必须明确提示。
- 原生二进制、GPU Runtime 和 FFmpeg 采用插件包、平台 Artifact 还是共享宿主依赖。
- 未签名第三方 Local Runtime 的安装确认级别和发布者信任策略。

这些决策应保持通用，不得因为 Cinema 的特殊需求在 Anybox 核心中增加 Cinema 专用协议，也不得让普通第三方 Web App 被迫采用 Local Runtime。
