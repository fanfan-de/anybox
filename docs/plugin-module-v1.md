# Anybox 插件模块 v1

插件模块是 Agent 能力包管理层，不引入新的执行引擎。插件只声明能力，实际执行继续落在现有 MCP、Skill、Connector、Auth、Permission 和项目选择链路上。

当前架构变化是：插件自带 connector 从远程 App 声明，扩展为本地受管 runtime 声明。公开 manifest 以 `connectors` 为主，旧 `apps` 字段继续兼容。

## 插件包结构

插件源码推荐采用 Codex-like 的展开目录。推荐入口为：

```text
<plugin-id>/.anybox-plugin/plugin.json
```

版本化入口主要用于受管理安装目录或需要并存多个版本的场景：

```text
<plugin-id>/<version>/.anybox-plugin/plugin.json
```

一个完整插件包可以包含这些目录：

```text
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
  <plugin-id>-<version>.zip # 可选：远程 registry 安装包
```

`plugin.json` 是 Anybox 插件清单，必须放在插件包根目录下的 `.anybox-plugin/plugin.json`。`assets`、`docs`、`scripts`、`skills` 和 `connectors` 仍放在插件包根目录下。

当前实现从 `plugin.json` 读取 connector 声明。`connectors/<connector-id>/` 可用于放置本地 connector runtime 代码，但独立的 `connectors/<connector-id>/connector.json` 扫描仍是后续阶段。

当前实现会按顺序扫描这些插件包来源：

- 内置 curated catalog：仓库内置插件包放在 `packages/anyboxagent/plugins/builtin/<plugin-id>/<version>`，打包后复制到 Agent runtime 的 `plugins/builtin`。
- 仓库插件目录：开发仓库内的 `plugins/Anybox-Plugins/<plugin-id>`，也兼容 `plugins/Anybox-Plugins/<plugin-id>/<version>`。
- 固定本地插件仓库：`ANYBOX_PLUGIN_LOCAL_DIR` 指向的本地插件根目录；未设置时默认为 Agent data 目录下的 `plugins/local`。这个来源的定位等价于 GitHub 上的插件仓库，只提供 catalog 候选项；安装时会复制一份到受管理安装根目录，卸载插件时不会删除这里的仓库源包。
- 受管理安装根目录：`ANYBOX_PLUGIN_INSTALL_DIR` 指向的目录；未设置时默认为 Agent data 目录下的 `plugins/installed`。这个来源代表已经安装到本机的插件包，运行时使用这里的副本，卸载插件时可以删除对应插件包。

同一个插件来源下如果既有 `<plugin-id>/.anybox-plugin/plugin.json` 又有多个版本目录，前者会作为该插件源的直接包；如果只有多个版本目录，catalog 选择 manifest `version` 最高的版本。后面的插件来源仍会覆盖前面的同名插件来源。

插件包本身不放在 `src` 代码目录；`src/plugin` 只负责扫描、校验、安装和生成运行时绑定。

## Manifest 字段

`plugin.json` 是严格 JSON，未知顶层字段会被拒绝。当前支持的顶层字段：

- `name`、`version`、`description`、`author`
- `homepage`、`repository`、`license`、`keywords`
- `interface`：插件在市场和详情页中的展示信息。
- `mcpServers`：生成全局 MCP server 配置的模板。
- `skills`：插件包内 Skill 目录，默认是 `skills`。
- `connectorRequirements`：插件依赖的共享平台 connector。
- `connectors`：插件自带 connector 声明，支持远程或本地 stdio runtime。
- `apps`：旧字段，按 `connectors` 的兼容别名解析。
- `commands`、`agents`：v1 保留字段，不实现执行语义。

插件应至少提供 `mcpServers`、`skills`、`connectorRequirements` 或 `connectors` 中的一类真实能力。

## MCP Servers

`mcpServers` 适合声明不需要独立连接状态的 MCP 能力，例如无认证的本地工具、纯插件脚本，或只依赖插件安装 config 的服务。

```json
{
  "mcpServers": [
    {
      "id": "notes",
      "name": "Docs Notes",
      "risk": "low",
      "permissions": ["Starts a bundled MCP server"],
      "tools": [
        {
          "name": "list_notes",
          "description": "List notes.",
          "readOnly": true
        }
      ],
      "runtime": {
        "transport": "stdio",
        "command": "node",
        "args": ["${PLUGIN_ROOT}/scripts/notes-server.js"],
        "cwd": "${PLUGIN_ROOT}"
      }
    }
  ]
}
```

`runtime` 支持 `stdio` 和 `remote`。`command`、`args`、`cwd`、`env`、`serverUrl`、`authorization` 和 `headers` 支持 `${PLUGIN_ROOT}` 以及插件安装 config 字段的 placeholder。

## Plugin Skills

`skills` 声明插件包内的 Skill 根目录。省略时默认扫描 `skills`：

```text
skills/
  review/
    SKILL.md
```

运行时只发现每个 skill root 下的直接子目录。生成的 Skill ID 为：

```text
plugin:<pluginID>:<skill-directory-name>
```

## Platform Connector Requirements

`connectorRequirements` 用于引用共享平台 connector。平台 connector 独立于插件，适合 GitHub、workspace files、browser、database 等用户预期只配置一次的能力。

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

当项目选择并启用该插件时，项目 MCP server 解析会自动把已安装插件的 connector requirement 对应平台 connector server 纳入候选集合。

## Plugin-Owned Connectors

`connectors` 用于声明随插件安装、启用、卸载的 connector。它适合插件专属 API key、OAuth session、插件包内携带的本地 MCP wrapper，以及只服务于该插件的诊断状态。

每个 connector 接受：

- `id`：推荐字段，插件内稳定 ID。
- `connectorID`：兼容字段，等价于 `id`。
- `appID`：旧字段，继续兼容。
- `name`、`description`、`icon`
- `risk`、`permissions`、`tools`、`installReview`
- `configFields`：connector 需要的安装配置，例如 OAuth client ID。
- `credential`：API key 或 OAuth 凭据声明。
- `runtime`：`stdio` 或 `remote` connector runtime。

OAuth remote connector 示例：

```json
{
  "connectors": [
    {
      "id": "docs-api",
      "name": "Docs API",
      "description": "Docs connector owned by this plugin.",
      "permissions": ["Sends requests to docs.example.test"],
      "configFields": [
        {
          "key": "DOCS_OAUTH_CLIENT_ID",
          "label": "Docs OAuth client ID",
          "type": "text",
          "required": true
        }
      ],
      "credential": {
        "kind": "oauth",
        "label": "Docs OAuth",
        "clientID": "${DOCS_OAUTH_CLIENT_ID}",
        "authorizationURL": "https://auth.example.test/authorize",
        "tokenURL": "https://auth.example.test/token",
        "scopes": ["docs.readonly"]
      },
      "runtime": {
        "transport": "remote",
        "serverUrl": "https://docs.example.test/mcp",
        "allowedTools": {
          "readOnly": true
        },
        "requireApproval": "always"
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

本地 stdio connector 示例：

```json
{
  "connectors": [
    {
      "id": "docs-local",
      "name": "Docs Local",
      "description": "Local MCP wrapper owned by this plugin.",
      "permissions": ["Starts a local MCP wrapper"],
      "credential": {
        "kind": "api_key",
        "key": "DOCS_API_KEY",
        "label": "Docs local key",
        "type": "password",
        "required": true,
        "secret": true
      },
      "runtime": {
        "transport": "stdio",
        "command": "node",
        "args": ["${PLUGIN_ROOT}/connectors/docs-local/server.js"],
        "cwd": "${PLUGIN_ROOT}",
        "env": {
          "DOCS_API_KEY": "${DOCS_API_KEY}"
        }
      }
    }
  ]
}
```

OAuth credential 的 `clientID`、`clientSecret`、`authorizationURL`、`tokenURL`、`revocationURL`、`scopes`、`authorizationParams`、`tokenParams` 和 `registration` 支持安装 config placeholder。API key credential 的 `key` 对应运行时 placeholder。

OAuth connector 也可以使用 RFC 7591 dynamic client registration。此时 `clientID` 可以省略，Anybox 会在用户点击连接时先向 `registration.registrationURL` 注册 client，注册请求会自动带上当前 loopback callback、`authorization_code`/`refresh_token` grant、`code` response type 和插件声明的 scope。注册返回的 `client_id`、可选 `client_secret` 和 `token_endpoint_auth_method` 会保存到 credential store，不会写入 MCP config。

```json
{
  "credential": {
    "kind": "oauth",
    "label": "Docs OAuth",
    "authorizationURL": "https://auth.example.test/authorize",
    "tokenURL": "https://auth.example.test/token",
    "scopes": ["docs.readonly"],
    "registration": {
      "registrationURL": "https://auth.example.test/register",
      "initialAccessToken": "${DOCS_REGISTRATION_TOKEN}",
      "metadata": {
        "client_name": "Anybox Docs",
        "application_type": "native",
        "token_endpoint_auth_method": "none"
      }
    }
  }
}
```

安装后生成的 MCP server 使用 `transport: "connector"`，配置里只保存 `connectorId`，不写入 `serverUrl`、headers、token 或 API key：

```json
{
  "name": "Docs Local",
  "transport": "connector",
  "connectorId": "plugin-connector:docs-lab:docs-local",
  "enabled": true
}
```

MCP client 连接前解析 connector runtime。解析结果可以是：

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

本地 stdio connector 的 `cwd`、绝对 command 和绝对 args 必须留在插件包内。普通命令名例如 `node` 可以由宿主环境解析。

## ID 规则

- `pluginID`：manifest `name` 小写化。
- MCP server：`plugin.<pluginID>` 或 `plugin.<pluginID>.<serverID>`。
- Platform connector instance：`connector:<connectorID>:default`。
- Platform connector MCP server：`connector.<connectorID>.default`。
- Plugin-owned connector：`plugin-connector:<pluginID>:<connectorID>`。
- Plugin-owned connector MCP server：`plugin.<pluginID>.connector.<connectorID>`。
- Plugin Skill：`plugin:<pluginID>:<skillName>`。

兼容旧 ID：

- `plugin-app:<pluginID>:<appID>`
- `plugin.<pluginID>.app.<appID>`

旧 ID 在迁移期继续可解析，安装或更新插件时会生成新的 `plugin-connector:` 和 `.connector.` ID。

## 安装行为

安装插件时只生成绑定：

- 写入 `installed_plugins`。
- 按 manifest 生成全局 MCP server 配置。
- 记录插件 Skill 根目录，供 Skill 发现流程读取。
- 为 plugin-owned connector 生成 connector ID 和 connector-backed MCP server。
- 记录 `connectorRequirementIDs`，用于项目选择时解析平台 connector。

安装不会自动把插件暴露给所有项目。项目仍通过现有 MCP picker 和 Skill selection 显式选择可用能力。

`critical` 风险插件禁止安装。其他风险等级的具体工具调用继续由 MCP tool policy、权限审批和工具 annotation 决定。

## 认证和密钥

Connector API key 和 OAuth session 存入 credential store。生成的 MCP 配置只保存 `connectorId`，运行时解析 connector 时才把密钥注入内存。

当前 agent 侧 JSON auth store 仍可作为开发回退；生产桌面版应由 Electron main 对接系统凭据存储，并保证 Renderer 保存后不再拿到原始密钥。

## Built-In Gmail 插件

仓库内置了 `gmail@0.1.0` 作为真实 OAuth 闭环样例：

```text
packages/anyboxagent/plugins/builtin/gmail/0.1.0/
  .anybox-plugin/plugin.json
  connectors/gmail/server.js
  skills/gmail/SKILL.md
```

它声明一个 plugin-owned connector：

- OAuth provider：Google。
- Scope：`openid email profile https://www.googleapis.com/auth/gmail.readonly`。
- Runtime：插件包内本地 stdio MCP wrapper。
- Tools：`gmail_profile`、`gmail_search_messages`、`gmail_read_message`。

安装时需要提供 `GOOGLE_OAUTH_CLIENT_ID` 和 `GOOGLE_OAUTH_CLIENT_SECRET`。Google Desktop OAuth client 虽然运行在桌面端，但 token exchange 当前仍需要提交 Cloud Console 生成的 client secret；这个 secret 不写入生成的 MCP config，只保存在插件安装配置/credential 路径中。默认本地 OAuth callback 是：

```text
http://localhost:1455/auth/callback
```

在 Google Cloud OAuth client 中应把这个 URL 加入 Authorized redirect URIs。连接成功后，生成的 MCP server 仍只保存：

```json
{
  "transport": "connector",
  "connectorId": "plugin-connector:gmail:gmail"
}
```

access token 在 MCP 连接前解析，并通过 `GMAIL_ACCESS_TOKEN` 环境变量注入本地 wrapper。

## Settings API

插件管理 API 挂载在 Agent Settings routes 下：

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

公开路由统一使用 `connectors`，不要再新增 `apps` 路由。

## 当前限制

- `connectors` 数组和旧 `apps` 数组已经支持；独立 `connectors/<id>/connector.json` 扫描尚未实现。
- 插件自带本地 stdio connector 已有基础路径约束；签名、信任确认、安装时审计 UI 仍未完成。
- 系统凭据存储桥接仍待实现，当前 JSON auth store 只适合作为开发回退。
- 远程 registry 和安装态继续使用现有插件机制，不要求远程 App Directory 或 marketplace mutation。
