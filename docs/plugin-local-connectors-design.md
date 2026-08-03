# Anybox 插件模块与本地 Connector 设计

> [!NOTE]
> 本文保留 Connector 的架构取舍与阶段记录，不作为插件包格式或发布流程的唯一规范。当前插件格式见[完整插件开发指南](../plugins/Anybox-Plugins/anybox-plugin-development/docs/anybox-third-party-plugin-development.md)，运行机制见[插件模块实现机制](./plugin-module-implementation.md)。

## 结论

插件模块可以借鉴 Codex 的包结构、manifest、catalog、安装态、MCP/Skill 绑定和项目级选择机制，但 connector 不建议照搬 Codex。

Codex 的 plugin app 更偏向 ChatGPT 远程 App Connector；Anybox 更适合把 connector 设计成桌面端本地能力：凭据、OAuth、运行时解析、诊断、本地进程启动都由本地桌面栈管理。只有当某个 connector 必须访问外部服务时，才把请求发到远程 API。

当前代码已经完成第一阶段迁移：

- manifest 公开语义以 `connectors` 为主，旧 `apps` 字段继续兼容。
- 插件自带 connector 生成 `transport: "connector"` 的 MCP server 绑定。
- connector runtime 在 MCP 连接前解析，结果可以是远程 MCP，也可以是插件包内本地 stdio MCP wrapper。
- 新 ID 使用 `plugin-connector:<pluginID>:<connectorID>` 和 `plugin.<pluginID>.connector.<connectorID>`，旧 `plugin-app:` 和 `.app.` ID 继续可解析。
- 内置 `gmail@0.1.0` 插件作为真实 OAuth 样例，验证 catalog、安装配置、Google OAuth 授权 URL、token 注入和本地 stdio MCP wrapper 诊断。
- 仍待完成的是独立 `connectors/<id>/connector.json` 扫描、系统凭据存储桥接、签名/信任确认和安装时本地命令审计 UI。

## 现有基础

当前项目已经有可复用的基础：

- `packages/anyboxagent/src/plugin/plugin.ts`：插件 manifest、catalog、安装态、生成 MCP 绑定、plugin connector 状态、plugin skill root。
- `packages/anyboxagent/src/connector/connector.ts`：平台 connector 定义、凭据、OAuth、运行时解析、诊断。
- `packages/anyboxagent/src/mcp/client.ts`：MCP 连接时按 `connectorId` 解析 connector runtime，并按解析结果启动 remote 或 stdio transport。
- `packages/desktop/src/renderer/src/app/plugins/PluginsPage.tsx`：插件管理页面。
- `packages/desktop/src/renderer/src/app/connectors/ConnectorsPage.tsx`：connector 管理页面。

当前概念拆分是合理的：

- `mcpServers`：插件自带 MCP server。
- `skills`：插件自带 Skill。
- `connectorRequirements`：插件依赖一个共享平台 connector。
- `connectors`：插件自带 connector 声明。
- `apps`：旧字段，继承自 Codex，当前仅作为 `connectors` 的兼容别名保留。

## 从 Codex 复用什么

保留这些设计：

1. 插件是能力包，不是新的执行引擎。
2. 安装插件只生成运行时绑定，不自动暴露给所有项目。
3. 一个插件可以同时提供 MCP、Skill、Connector 等能力。
4. 插件 ID 和生成的能力 ID 必须稳定可预测。
5. 普通 MCP 配置里不写入密钥。
6. catalog、安装态、项目选择分层管理。

不要照搬这些 Codex 细节：

1. `.app.json` 只保存远程 ChatGPT App ID。
2. connector 安装路径指向 `chatgpt.com/apps/...`。
3. connector 可用性主要依赖远程 App Directory 或远程 tool discovery。
4. 远程 marketplace mutation/sync 成为本地运行时核心依赖。

## 目标架构

```mermaid
flowchart LR
  PluginPackage["插件包"] --> PluginCatalog["插件 Catalog"]
  PluginCatalog --> InstallState["安装态"]
  InstallState --> RuntimeBindings["生成运行时绑定"]
  RuntimeBindings --> ProjectSelection["项目级插件选择"]
  ProjectSelection --> AgentPrompt["Agent Prompt 与工具清单"]

  PluginPackage --> Skills["Plugin Skills"]
  PluginPackage --> McpServers["Plugin MCP Servers"]
  PluginPackage --> ConnectorDecls["Plugin Connector 声明"]
  PluginPackage --> ConnectorReqs["Connector Requirements"]

  ConnectorDecls --> ConnectorManager["本地 Connector Manager"]
  ConnectorReqs --> ConnectorManager
  ConnectorManager --> DesktopBridge["Electron Main / Local Bridge"]
  DesktopBridge --> SecureStore["系统凭据存储"]
  DesktopBridge --> LocalHost["本地 MCP 进程或 Loopback Host"]
  LocalHost --> McpClient["MCP Client"]
```

边界建议：

- Renderer 只展示状态和收集输入。
- Electron main 负责桌面原生能力：系统凭据存储、OAuth 浏览器窗口、本地进程监督。
- Agent 负责 catalog 归一化、项目选择、MCP tool inventory、工具调用编排。
- 密钥只在解析 connector runtime 时进入内存，不写入全局 MCP 配置。

## 插件包结构

源码插件默认使用不带版本目录的展开结构：

```text
<plugin-source-root>/
  <plugin-id>/
    .anybox-plugin/
      plugin.json
    assets/
    docs/
    scripts/
    skills/
      <skill-name>/
        SKILL.md
    connectors/
      <connector-id>/
        server.js
```

只有同一来源必须并存多个版本时，才使用 `<plugin-id>/<version>/.anybox-plugin/plugin.json`。`connectors/` 是可选目录。当前实现从 manifest 的 `connectors` 数组或其包内相对 JSON 文件读取声明；需要携带本地运行时代码时可以把代码放在 `connectors/<id>/`。独立扫描 `connectors/<id>/connector.json` 仍属于后续阶段。

## Manifest 设计

当前 manifest 以 `connectors` 为主，保留 `apps` 作为兼容别名：

```json
{
  "name": "docs-lab",
  "version": "0.2.0",
  "description": "Search local and remote docs from Anybox.",
  "interface": {
    "displayName": "Docs Lab",
    "category": "Docs"
  },
  "skills": "skills",
  "mcpServers": [
    {
      "id": "notes",
      "name": "Docs Notes",
      "runtime": {
        "transport": "stdio",
        "command": "node",
        "args": ["${PLUGIN_ROOT}/scripts/notes-server.js"],
        "cwd": "${PLUGIN_ROOT}"
      }
    }
  ],
  "connectorRequirements": [
    {
      "connector": "workspace-files",
      "tools": ["search_files"],
      "required": false,
      "reason": "Search local workspace documentation."
    }
  ],
  "connectors": [
    {
      "id": "docs-api",
      "name": "Docs API",
      "description": "Local connector wrapper for a docs API.",
      "credential": {
        "kind": "api_key",
        "key": "DOCS_API_KEY",
        "label": "Docs API key",
        "type": "password",
        "required": true,
        "secret": true
      },
      "runtime": {
        "transport": "stdio",
        "command": "node",
        "args": ["${PLUGIN_ROOT}/connectors/docs-api/server.js"],
        "cwd": "${PLUGIN_ROOT}",
        "env": {
          "DOCS_API_KEY": "${DOCS_API_KEY}"
        }
      },
      "tools": [
        {
          "name": "search_docs",
          "description": "Search docs.",
          "readOnly": true
        }
      ]
    }
  ]
}
```

兼容规则：

- 优先解析 `connectors`。
- `apps` 作为 `connectors` 的旧字段继续解析。
- UI 文案统一使用 “Connectors”。
- 已安装插件的旧 ID 继续可解析，等迁移完成后再隐藏。

## Connector 类型

### 平台 Connector

平台 connector 独立于某个插件，可以被多个插件复用。

适合：

- workspace files
- local browser
- GitHub
- database
- 桌面本地专属集成
- 用户预期只配置一次的能力

插件通过 `connectorRequirements` 引用：

```json
{
  "connectorRequirements": [
    {
      "connector": "github",
      "tools": ["search_issues", "create_issue"],
      "required": true,
      "reason": "Create implementation tickets from plugin output."
    }
  ]
}
```

### 插件自带 Connector

插件自带 connector 随插件安装、启用、卸载。

适合：

- 插件专属 API key
- 插件包内携带的本地 MCP wrapper
- 卸载插件时应该一起消失的工具
- 只服务于该插件的认证和诊断状态

推荐 ID：

```text
plugin-connector:<pluginID>:<connectorID>
```

### 普通 MCP Server

不需要连接状态和认证生命周期时，继续使用 `mcpServers`。

适合：

- 无认证的本地工具
- 纯插件包内脚本
- 配置只来自插件安装 config
- 不需要 “Connect” 按钮或账号状态

## Runtime 模型

当前 MCP config 支持 `stdio`、`remote` 和 `connector`。`connector` 是 connector-resolved runtime，配置只保存 `connectorId`，在真正连接 MCP 前由 connector manager 解析成 remote 或 stdio：

```json
{
  "name": "Docs API",
  "transport": "connector",
  "connectorId": "plugin-connector:docs-lab:docs-api",
  "enabled": true,
  "timeoutMs": 1000
}
```

MCP client 在真正连接前解析 connector：

```ts
type ResolvedConnectorRuntime =
  | {
      transport: "stdio"
      command: string
      args?: string[]
      cwd?: string
      env?: Record<string, string>
    }
  | {
      transport: "remote"
      serverUrl: string
      authorization?: string
      headers?: Record<string, string>
    }
```

统一规则：

1. 配置里只保存 `connectorId`。
2. Connector manager 校验插件安装态和连接态。
3. Connector manager 从桌面本地凭据存储加载密钥。
4. Connector manager 在内存中替换 placeholder。
5. MCP client 根据解析结果启动 stdio 或 remote transport。

旧的 `remote + connectorId` 路径在迁移期仍可解析，但新增插件自带 connector 应生成 `transport: "connector"`。这样本地 stdio connector 和远程 connector 使用同一套连接状态、密钥注入和诊断模型。

## 桌面本地认证与密钥

生产桌面版建议：

- API key 和 OAuth session 存在系统凭据存储，由 Electron main 管理。
- Agent 数据库只保存非敏感元数据：provider ID、active method、label、expiresAt、lastError。
- Renderer 保存后不再拿到原始 API key。
- 生成的 MCP config 不包含 token 或 API key。
- OAuth callback 只监听 loopback，并使用 PKCE。
- Google Desktop OAuth client 在 token exchange 阶段可能仍要求 `client_secret`；开发样例可把它作为插件安装配置保存，但生成的 MCP config 不得包含它。生产形态应优先通过官方受管 OAuth client 或桌面 credential bridge 降低暴露面。

当前 agent 侧 JSON auth store 可以作为开发回退，但生产路径应抽象出 credential store interface：

```text
agent connector API
  -> desktop credential bridge
  -> OS Credential Manager / Keychain / libsecret
```

当前 Gmail 样例仍使用 agent JSON auth store 作为开发回退。真实桌面链路接入系统凭据存储后，不需要改插件包结构，只需要替换 credential store 实现。

## 安装与执行流程

### 安装

1. Catalog 默认读取稳定的远程 schema v3 Registry；显式开发模式也可以扫描本地 package roots。
2. 插件包复制到受控安装目录。
3. Manifest 归一化。
4. 写入安装态。
5. 生成绑定：
   - `plugin.<pluginID>.<serverID>`：普通 MCP server。
   - `plugin.<pluginID>.connector.<connectorID>`：插件自带 connector。
6. Skill roots 加入可发现范围。
7. 项目仍然显式选择插件。

### 连接

1. 用户在插件详情或 connector 页面发起连接。
2. UI 调本地 settings API。
3. API 启动 API-key 保存或 OAuth flow。
4. Electron main 写入本地凭据存储。
5. Connector 状态变为 connected、pending、expired、unavailable 或 error。

### 工具执行

1. 项目选择已安装插件。
2. Agent 加载选中插件的 skills 和 MCP tools。
3. MCP client 连接 connector-backed server 时解析 `connectorId`。
4. Connector manager 在内存中注入密钥并返回解析后的 runtime。
5. Tool call 继续走现有 MCP policy 和 approval。

### 卸载

1. 删除生成的 MCP bindings。
2. 从项目选择里移除 plugin skill 和 plugin ID。
3. 删除安装态。
4. 停止本地 connector 进程。
5. 插件自带 connector 的密钥默认删除；平台 connector 的密钥默认保留。

## API Surface

保留现有 settings API 形状，逐步统一命名：

```text
GET    /api/plugins/catalog
GET    /api/plugins/installed
PUT    /api/plugins/installed/:pluginID
PATCH  /api/plugins/installed/:pluginID
DELETE /api/plugins/installed/:pluginID
GET    /api/plugins/installed/:pluginID/diagnostic

GET    /api/connectors/catalog
GET    /api/connectors
GET    /api/connectors/:connectorID
PUT    /api/connectors/:connectorID/api-key
DELETE /api/connectors/:connectorID/api-key
POST   /api/connectors/:connectorID/auth/flows
GET    /api/connectors/:connectorID/auth/flows/:flowID
DELETE /api/connectors/:connectorID/auth/flows/:flowID
DELETE /api/connectors/:connectorID/auth/session
GET    /api/connectors/:connectorID/diagnostic

GET    /api/plugins/installed/:pluginID/connectors
PUT    /api/plugins/installed/:pluginID/connectors/:connectorID/api-key
DELETE /api/plugins/installed/:pluginID/connectors/:connectorID/api-key
POST   /api/plugins/installed/:pluginID/connectors/:connectorID/auth/flows
GET    /api/plugins/installed/:pluginID/connectors/:connectorID/auth/flows/:flowID
DELETE /api/plugins/installed/:pluginID/connectors/:connectorID/auth/flows/:flowID
DELETE /api/plugins/installed/:pluginID/connectors/:connectorID/auth/session
GET    /api/plugins/installed/:pluginID/connectors/:connectorID/diagnostic
```

路由已经使用 `connectors`，不要再新增公开 `apps` 路由。

## ID 规则

长期推荐：

```text
Plugin ID:
  <normalized manifest name>

Plugin MCP server:
  plugin.<pluginID>
  plugin.<pluginID>.<serverID>

Platform connector instance:
  connector:<connectorID>:default

Plugin-owned connector:
  plugin-connector:<pluginID>:<connectorID>

Plugin-owned connector MCP binding:
  plugin.<pluginID>.connector.<connectorID>

Plugin skill:
  plugin:<pluginID>:<skill-directory-name>
```

当前兼容 ID：

```text
plugin-app:<pluginID>:<appID>
plugin.<pluginID>.app.<appID>
```

在迁移完成前继续支持解析。

## 安全边界

本地 connector 的安全边界要比远程 App Connector 更严格：

- 插件包代码默认不可信，除非来自 curated source。
- 安装时展示本地命令、权限、连接器声明。
- Runtime placeholder 只能来自声明过的 config fields 和 credential fields。
- Stdio connector 的 `cwd`、绝对 command 和绝对 args 必须位于 `${PLUGIN_ROOT}` 内；`node` 这类普通命令名可由宿主环境解析。
- 插件包解压继续拒绝 symlink 和越界路径。
- 权限策略仍按 MCP tool 生效，不只按 plugin 生效。
- 诊断可以展示工具名和状态，不展示密钥材料。

## 实现路径

### Phase 1：命名和 schema 兼容

状态：已完成。

涉及文件：

- `packages/anyboxagent/src/plugin/plugin.ts`
- `packages/desktop/src/renderer/src/app/types.ts`
- `packages/desktop/src/renderer/src/app/plugins/PluginsPage.tsx`

已完成内容：

1. `PluginManifest` 新增 `connectors`。
2. `apps` 和 `connectors` 归一化为同一套插件自带 connector 模型。
3. API 暂时继续返回 `apps` 兼容字段，同时新增 `connectors`。
4. UI 文案改为 Plugin connector。
5. 旧 `apps` manifest 仍可安装、连接和解析。

### Phase 2：Connector-resolved MCP runtime

状态：已完成第一版。

涉及文件：

- `packages/anyboxagent/src/config/config.ts`
- `packages/anyboxagent/src/mcp/client.ts`
- `packages/anyboxagent/src/connector/connector.ts`
- `packages/anyboxagent/src/plugin/plugin.ts`

已完成内容：

1. 增加 `transport: "connector"` MCP server config。
2. 增加 `ResolvedConnectorRuntime`，支持 `stdio` 和 `remote`。
3. MCP 连接时解析 connector runtime。
4. 生成配置只保存 `connectorId`，密钥只在运行时进入内存。
5. 插件本地 stdio connector 已支持基础路径约束和断开态诊断。

### Phase 3：桌面凭据适配

状态：待实现。

涉及文件：

- `packages/desktop/src/main/ipc.ts`
- `packages/anyboxagent/src/auth/auth.ts`
- `packages/anyboxagent/src/auth/provider-auth.ts`

任务：

1. 抽象 credential store interface。
2. JSON store 保留为开发回退。
3. Electron main 实现系统凭据存储。
4. Renderer 不暴露已保存的原始密钥。

### Phase 4：本地 connector 包结构

状态：部分完成。

涉及文件：

- `packages/anyboxagent/src/plugin/plugin.ts`
- `packages/anyboxagent/Test/plugin.test.ts`
- `docs/plugin-module-implementation.md`
- `plugins/Anybox-Plugins/anybox-plugin-development/docs/anybox-third-party-plugin-development.md`

已完成内容：

1. `plugin.json` 内联 `connectors` 可声明本地 stdio runtime。
2. 安装时生成 connector-backed MCP binding。
3. 卸载时清理插件自带 connector 的新旧凭据和新旧 MCP server ID。
4. 本地 stdio runtime path 已有基础包内约束。

待实现任务：

1. 支持可选 `connectors/<id>/connector.json`。
2. 安装时审计和展示本地命令、权限、风险。
3. 更完整的本地 connector 进程生命周期管理。

## 下一步建议

短期优先级：

1. 实现系统凭据存储 bridge，把当前 JSON auth store 收敛为开发回退。
2. 增加 `connectors/<id>/connector.json` 扫描，支持大型 connector 从 `plugin.json` 拆出去。
3. 在安装/更新确认 UI 中展示本地 stdio command、cwd、env placeholder、权限和工具风险。
4. 补齐本地 connector 进程生命周期：启动、停止、重启、诊断日志和卸载清理。
5. 在迁移稳定后，逐步把内部变量和测试命名从 `appID` 收敛到 `connectorID`，保留外部兼容解析。
