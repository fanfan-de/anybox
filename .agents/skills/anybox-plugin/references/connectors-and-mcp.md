# Anybox MCP 与 Connector 声明

## 目录

1. 选择接入类型
2. MCP Server
3. 插件自有 Connector
4. API Key Connector 示例
5. OAuth Connector 示例
6. 平台 Connector 依赖
7. 生成 ID 与密钥处理

## 选择接入类型

按以下规则选择：

- 插件自己提供、且不需要独立用户连接生命周期的本地或远程 MCP Server 使用 `mcpServers`。
- 插件依赖 Anybox 已有的共享内置 MCP（例如 `node-repl`）时使用 `mcpRequirements`。
- 插件自有 API Key、OAuth Session，或需要随插件一起清理的连接状态使用 `connectors`。
- 插件依赖 Gmail、GitHub 等 Anybox 共享账号 Connector 时使用 `connectorRequirements`。
- 只有导入旧插件时才使用 `apps`。

## MCP Server

每个规范 MCP Server 条目支持：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 否 | 默认值为 `default` |
| `name` | 否 | 回退到插件显示名或 manifest 名称 |
| `description` | 否 | 回退到 manifest 的 `description` |
| `risk` | 否 | `low`、`medium`、`high` 或 `critical`；默认值为 `medium` |
| `permissions` | 否 | 面向用户的权限说明 |
| `tools` | 否 | 目录和策略预览，不是工具实现 |
| `configFields` | 否 | 安装时插件配置 |
| `runtime` | 是 | `stdio` 或 `remote` |
| `installReview` | 否 | 安装评审说明 |

Tool Preview 是严格对象，包含 `name`、`description`，以及可选的 `title`、`readOnly` 和 `destructive`。

Config Field 是严格对象，支持：

```text
key, label, type, required, secret, placeholder, defaultValue, description
```

有效的配置类型是 `text`、`password`、`url` 和 `path`。

### Stdio Runtime

```json
{
  "runtime": {
    "transport": "stdio",
    "command": "node",
    "args": ["${PLUGIN_ROOT}/scripts/server.js"],
    "cwd": "${PLUGIN_ROOT}",
    "env": {
      "SERVICE_URL": "${SERVICE_URL}"
    },
    "timeoutMs": 10000
  }
}
```

`command`、`args`、`cwd` 和 `env` 可以包含 `${UPPER_CASE_KEY}` placeholder。运行时会提供 `PLUGIN_ROOT`，其他 placeholder 必须来自已安装插件配置或 Connector Credential。

### Remote Runtime

```json
{
  "runtime": {
    "transport": "remote",
    "serverUrl": "https://mcp.example.com/mcp",
    "headers": {
      "x-tenant": "${TENANT_ID}"
    },
    "allowedTools": {
      "readOnly": true
    },
    "requireApproval": "always",
    "timeoutMs": 10000
  }
}
```

Remote Runtime 还支持实时配置类型 `Config.McpRemoteProvider`、`McpAllowedTools`、`McpRequireApproval` 和 `McpToolPolicies`。记录详细嵌套策略结构前，先检查 `packages/anyboxagent/src/config/config.ts`。

生成的 MCP Server ID：

```text
默认 Server：plugin.<pluginID>
具名 Server：plugin.<pluginID>.<serverID>
```

## 插件自有 Connector

规范 Connector 条目必须包含：

- `id`：新 manifest 使用的稳定 Connector ID；
- `name`；
- `credential`；
- `runtime`。

可选字段：

```text
description, icon, risk, permissions, tools, configFields, installReview
```

解析器还接受 `connectorID` 和旧版 `appID`，优先级如下：

```text
id -> connectorID -> appID
```

新 manifest 始终生成 `id`。

`configFields` 不能代替 `credential`。它适合保存 OAuth Client 配置、Tenant ID、服务 URL 或其他非 Credential 设置。

## API Key Connector 示例

```json
{
  "connectors": [
    {
      "id": "weather",
      "name": "天气服务",
      "description": "天气 API Connector。",
      "risk": "medium",
      "permissions": ["向 api.weather.example 发送请求。"],
      "credential": {
        "kind": "api_key",
        "key": "WEATHER_API_KEY",
        "label": "天气 API Key",
        "type": "password",
        "required": true,
        "secret": true
      },
      "runtime": {
        "transport": "stdio",
        "command": "node",
        "args": ["${PLUGIN_ROOT}/connectors/weather/server.js"],
        "cwd": "${PLUGIN_ROOT}",
        "env": {
          "WEATHER_API_KEY": "${WEATHER_API_KEY}"
        },
        "timeoutMs": 10000
      },
      "tools": [
        {
          "name": "weather_current",
          "title": "当前天气",
          "description": "读取指定城市的当前天气。",
          "readOnly": true
        }
      ]
    }
  ]
}
```

为了兼容旧格式，可以省略 `kind: "api_key"`；新 manifest 应显式写出。

## OAuth Connector 示例

```json
{
  "connectors": [
    {
      "id": "docs",
      "name": "文档服务",
      "description": "文档服务 OAuth Connector。",
      "configFields": [
        {
          "key": "DOCS_OAUTH_CLIENT_ID",
          "label": "文档服务 OAuth Client ID",
          "type": "text",
          "required": true
        },
        {
          "key": "DOCS_OAUTH_CLIENT_SECRET",
          "label": "文档服务 OAuth Client Secret",
          "type": "password",
          "required": true,
          "secret": true
        }
      ],
      "credential": {
        "kind": "oauth",
        "label": "文档服务 OAuth",
        "clientID": "${DOCS_OAUTH_CLIENT_ID}",
        "authorizationURL": "https://auth.example.com/oauth/authorize",
        "tokenURL": "https://auth.example.com/oauth/token",
        "revocationURL": "https://auth.example.com/oauth/revoke",
        "scopes": ["docs.readonly"],
        "authorizationParams": {
          "access_type": "offline",
          "prompt": "consent"
        },
        "tokenParams": {
          "client_secret": "${DOCS_OAUTH_CLIENT_SECRET}"
        },
        "tokenPlacement": {
          "type": "authorization_bearer"
        }
      },
      "runtime": {
        "transport": "stdio",
        "command": "node",
        "args": ["${PLUGIN_ROOT}/connectors/docs/server.js"],
        "cwd": "${PLUGIN_ROOT}",
        "env": {
          "DOCS_ACCESS_TOKEN": "${OAUTH_ACCESS_TOKEN}",
          "DOCS_TOKEN_TYPE": "${OAUTH_TOKEN_TYPE}"
        }
      }
    }
  ]
}
```

OAuth Credential 支持以下字段：

```text
kind, label, clientID, clientSecret, authorizationURL, tokenURL, scopes,
revocationURL, tokenPlacement, authorizationParams, tokenParams,
tokenEndpointAuthMethod, registration, description
```

必须提供 `clientID` 或动态 `registration` 其中之一。

`tokenPlacement` 支持：

```json
{ "type": "authorization_bearer" }
```

或者：

```json
{
  "type": "header",
  "name": "x-access-token",
  "value": "Bearer ${OAUTH_ACCESS_TOKEN}"
}
```

支持的 Token Endpoint 认证方式为 `none`、`client_secret_post` 和 `client_secret_basic`。

使用 RFC 7591 风格的动态注册时：

```json
{
  "registration": {
    "registrationURL": "https://auth.example.com/oauth/register",
    "initialAccessToken": "${REGISTRATION_TOKEN}",
    "metadata": {
      "client_name": "Anybox 文档插件"
    }
  }
}
```

发布前检查 Provider 特有的 scope、Redirect URI、PKCE 和 Token 行为。不要把真实 Client Secret 或 Token 写入 manifest。

## 平台 Connector 依赖

如果连接需要被多个插件复用，应依赖共享 Connector Registry，而不是创建插件自有 Connector：

```json
{
  "connectorRequirements": [
    {
      "connector": "gmail",
      "runtimeIDs": ["default"],
      "tools": ["gmail_search_messages"],
      "permissions": ["在已连接的 Gmail 账号中搜索邮件。"],
      "required": true,
      "reason": "提供只读邮件搜索能力。"
    }
  ]
}
```

支持的字段为 `connector`、`runtimeIDs`、`tools`、`permissions`、`required` 和 `reason`。确认 Connector ID、Runtime ID 和工具名称确实存在于实时平台 Connector Registry 中。

## Anybox 内置 MCP 依赖

共享内置 MCP 没有账号、授权或连接生命周期，不得伪装成 Connector。插件通过 `mcpRequirements`
引用它，安装记录保存对应 MCP server ID，但不会取得该运行时的所有权：

```json
{
  "mcpRequirements": [
    {
      "mcp": "node-repl",
      "tools": ["js", "js_reset", "js_add_node_module_dir"],
      "required": true,
      "reason": "在 Anybox 通用 Node REPL 中加载插件客户端。"
    }
  ]
}
```

`node-repl` 的规范 MCP server ID 是 `anybox.node-repl`，owner 是
`{"kind":"anybox","bindingID":"node-repl"}`，transport 是 `stdio`。它不应出现在 Connector
catalog、Connector 状态或 `connectorRequirements` 中。

## 生成 ID 与密钥处理

```text
插件自有 Connector Credential：
plugin-connector:<pluginID>:<connectorID>

插件自有 Connector MCP Server：
plugin.<pluginID>.connector.<connectorID>

旧版 Credential：
plugin-app:<pluginID>:<appID>

旧版 MCP Server：
plugin.<pluginID>.app.<appID>
```

生成的全局 MCP 条目只保存 `connectorId`。Anybox 会在运行时解析 Server URL、Authorization、Header、环境变量、API Key 和 OAuth Token。

绝对不要提交：

- API Key；
- 应保密的 OAuth Client Secret；
- Access Token 或 Refresh Token；
- 已解析的 Authorization Header；
- 生成的 Credential Store 内容。
