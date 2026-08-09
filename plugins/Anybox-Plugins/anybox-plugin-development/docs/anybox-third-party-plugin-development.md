# Anybox 第三方插件开发指南

本文面向第一次接触 Anybox 插件系统的第三方开发者。你不需要了解 Anybox 内部实现，也不需要修改 Anybox 源码；你只需要准备一个符合约定的插件包，Anybox Agent 就可以发现、安装、连接并调用你的插件能力。

当前代码库统一使用 `Anybox` 命名，环境变量以 `ANYBOX_` 开头，例如 `ANYBOX_PLUGIN_LOCAL_DIR` 和 `ANYBOX_PLUGIN_INSTALL_DIR`。本文中的 Anybox 插件系统指的就是当前桌面端 Agent 使用的这套插件运行时。

## 插件是什么

Anybox 插件是一个能力包，不是新的执行引擎。

插件负责声明：

- 插件在市场或详情页上如何展示。
- 插件提供哪些 MCP 工具。
- 插件是否携带 Agent skill。
- 插件是否需要 API key 或 OAuth。
- 插件运行时是远程 MCP 服务，还是插件包内的本地 `stdio` MCP wrapper。

真正执行时，Anybox 仍使用现有的 MCP、Skill、Connector、Auth、权限和项目选择系统。

## 什么时候需要写插件

适合写插件的情况：

- 你有一个 SaaS、内部系统或本地工具，希望 Agent 能调用它。
- 你想把一组 MCP 工具、skill 和认证流程打包给用户安装。
- 你希望每个插件有自己的连接状态、诊断按钮和凭据生命周期。
- 你希望插件随项目显式启用，而不是默认暴露给所有对话。

不适合写插件的情况：

- 只是临时给自己加一个 MCP server，可以直接配置 MCP。
- 只是写一段提示词，不需要工具，可以只写 skill。
- 多个插件共享同一个平台能力，例如 GitHub、浏览器、workspace files，优先使用平台 connector requirement。

## 核心概念

### Plugin Package

插件包是一个目录。新建 Anybox 插件必须使用 canonical manifest 位置：

```text
<plugin-id>/.anybox-plugin/plugin.json
```

运行时仍可读取根目录 `plugin.json` 和 `.codex-plugin/plugin.json` 作为兼容输入，但 Anybox 内置仓库、转换脚本和新插件都不应生成这两种结构。

推荐 Codex-like 展开结构：

```text
my-anybox-plugins/
  my-plugin/
    .anybox-plugin/
      plugin.json
    skills/
    connectors/
    scripts/
    docs/
    assets/
```

`my-anybox-plugins` 是插件来源根目录。Anybox 会扫描它下面的每个 `<plugin-id>`。如果需要在同一个插件目录里保留多个版本，也可以使用 `<plugin-id>/<version>/.anybox-plugin/plugin.json`，Anybox 会选择最高版本。根目录 `plugin.json` 只用于向后兼容，不是新包的输出规范。

### Manifest

`plugin.json` 是插件清单。它是严格 JSON，未知顶层字段会被拒绝。仓库 manifest 可以包含 `skillPreviews`，但不应提交 `package`；Anybox 的本地 Catalog 打包器会在生成的正式目录中写入不可变下载元数据。

最小清单：

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "My first Anybox plugin."
}
```

The canonical Anybox manifest entry point is `.anybox-plugin/plugin.json`. Root `plugin.json` and `.codex-plugin/plugin.json` are compatibility inputs only. Package-relative paths resolve from the plugin package root, not from the hidden manifest directory.

### External component JSON files

`apps`, `connectors`, `mcpServers`, and `hooks` may be written inline, or as package-relative JSON file paths:

```json
{
  "name": "external-component-demo",
  "version": "0.1.0",
  "description": "Plugin manifest with external component files.",
  "apps": "./.app.json",
  "mcpServers": "./.mcp.json",
  "hooks": "./.hooks.json"
}
```

Supported component file shapes:

```json
{
  "apps": {
    "docs": {
      "name": "Docs",
      "credential": {
        "key": "DOCS_API_KEY",
        "label": "Docs API key"
      },
      "runtime": {
        "transport": "remote",
        "serverUrl": "https://docs.example.test/mcp",
        "allowedTools": { "readOnly": true },
        "requireApproval": "never"
      }
    }
  }
}
```

```json
{
  "mcpServers": [
    {
      "id": "docs",
      "runtime": {
        "transport": "stdio",
        "command": "node",
        "args": ["${PLUGIN_ROOT}/scripts/server.js"]
      }
    }
  ]
}
```

Path rules:

- Component paths must be relative JSON paths inside the plugin package.
- Absolute paths, protocol URLs, query strings, fragments, and `..` paths that escape the plugin root are rejected.
- URL imports fetch component files only from the same origin and inside the same plugin root URL.
- `hooks` files are parsed and validated as JSON in this version, but hooks are not executed or registered.
- OpenAI App SDK entries whose only identifier is `asdk_app_*` are accepted as metadata but are not converted into Anybox connectors.

实际插件还应该声明 `interface`，并可通过 `mcpServers`、`skills`、`connectors`、`connectorRequirements` 或 `views` 提供真实能力。只有 `views` 的本地插件也是有效插件。

### Right Sidebar View

`views` 可以声明插件包自带的 HTML/React 页面。当前只支持 Right Sidebar：

```json
{
  "views": [
    {
      "id": "main",
      "title": "React Sidebar Proof",
      "location": "right-sidebar",
      "entry": "./web/index.html"
    }
  ]
}
```

- `id` 在插件内必须稳定且唯一，只能使用安全的可序列化 ID。
- `title`、`location`、`entry` 必填，View 内未知字段会被拒绝。
- `entry` 只能是包内相对 HTML 路径；绝对路径、URL、反斜杠、查询参数、fragment 和 `..` 都会被拒绝。
- 本地安装时入口必须存在，真实路径必须留在插件根目录内；符号链接不能逃逸。
- 将构建后的 HTML、JavaScript 和 CSS 一并提交到插件包（推荐 `web/`），不要依赖开发服务器。
- 只有已安装、已启用且本地包存在的 View 才会出现在 Right Sidebar；远程 catalog 元数据不会直接作为本地页面加载。

### MCP Server

`mcpServers` 适合不需要独立连接状态的工具，例如无认证的本地脚本。

安装后会生成 MCP server ID：

```text
plugin.<pluginID>.<serverID>
```

### Skill

`skills` 是插件自带的 Agent 使用说明。安装并在项目里启用插件后，Agent 可以加载这些 skill。

生成的 skill ID：

```text
plugin:<pluginID>:<skill-directory-name>
```

### Plugin-Owned Connector

`connectors` 是当前推荐的插件自带连接声明。它适合：

- 插件专属 API key。
- 插件专属 OAuth session。
- 插件包内自带的本地 MCP wrapper。
- 卸载插件时应该一起清理的连接状态。

安装后会生成：

```text
plugin-connector:<pluginID>:<connectorID>
plugin.<pluginID>.connector.<connectorID>
```

生成的 MCP 配置只保存 `connectorId`，不会保存 API key、access token、refresh token 或 OAuth client secret。

### Platform Connector Requirement

`connectorRequirements` 用于引用 Anybox 平台已有的共享 connector。例如 GitHub、browser、workspace files 等。它们独立于插件，适合多个插件复用。

## 建议的独立 Git 项目结构

如果你要把插件同步到 GitHub，建议把插件集合做成一个独立仓库：

```text
anybox-plugin-examples/
  README.md
  .gitignore
  hello-anybox/
    .anybox-plugin/
      plugin.json
    scripts/
      server.js
    skills/
      hello/
        SKILL.md
```

默认不需要版本目录。只有在同一个插件需要并存多个版本时，才使用 `<plugin-id>/<version>/.anybox-plugin/plugin.json`。

### 关于本地插件来源和安装根目录

开发时推荐把仓库根目录作为固定本地插件来源：

```powershell
$env:ANYBOX_PLUGIN_LOCAL_DIR = "C:\Projects\anybox-plugin-examples"
```

`ANYBOX_PLUGIN_LOCAL_DIR` 未设置时，默认指向 Agent data 目录下的 `plugins/local`。如果同时设置了 `ANYBOX_AGENT_DATA_DIR`，默认本地来源就是：

```text
<ANYBOX_AGENT_DATA_DIR>\data\plugins\local
```

这个来源的定位是本地插件仓库，逻辑上等价于 GitHub 上的插件仓库。用户在 UI 里安装插件时，Anybox 会把插件包复制到受管理安装根目录；卸载插件时只删除安装目录里的副本，不会删除这里的仓库源包。因此它适合放 Anybox 内部创建的新插件、手写开发插件，或从生成流程直接产出的可用插件。

`ANYBOX_PLUGIN_INSTALL_DIR` 是受管理安装根目录，未设置时默认是 Agent data 目录下的 `plugins/installed`。这个目录里的插件逻辑上属于已经安装到本机的插件；运行时使用这里的副本，用户卸载插件时，可能会删除该目录下对应插件包。

如果必须使用 `ANYBOX_PLUGIN_INSTALL_DIR` 做开发验证，更安全的方式是把源码和受管理安装目录分开：

```text
anybox-plugin-examples/       # Git 仓库，提交源码
  hello-anybox/
    .anybox-plugin/
      plugin.json
    ...
  dev-install/                # 构建或复制出来的安装目录，加入 .gitignore
```

然后把 `ANYBOX_PLUGIN_INSTALL_DIR` 指向 `dev-install`，而不是源码目录。日常开发仍优先使用 `ANYBOX_PLUGIN_LOCAL_DIR`。

## 从零开发第一个插件

下面做一个最小可用插件：`hello-anybox`。它提供一个本地 `stdio` MCP server，暴露一个 `hello_echo` 工具。

### 1. 创建目录

```text
anybox-plugin-examples/
  hello-anybox/
    .anybox-plugin/
      plugin.json
    scripts/
      server.js
    skills/
      hello/
        SKILL.md
```

### 2. 编写 plugin.json

路径：

```text
hello-anybox/.anybox-plugin/plugin.json
```

内容：

```json
{
  "name": "hello-anybox",
  "version": "0.1.0",
  "description": "A minimal Anybox plugin with one local MCP tool.",
  "author": {
    "name": "Your Name"
  },
  "interface": {
    "displayName": "Hello Anybox",
    "shortDescription": "A minimal plugin for learning Anybox plugin development.",
    "longDescription": "This plugin demonstrates a local stdio MCP server and a bundled Agent skill.",
    "developerName": "Your Name",
    "category": "Automation",
    "capabilities": ["demo", "mcp"],
    "logo": "HA",
    "brandColor": "#2563EB"
  },
  "skills": "skills",
  "mcpServers": [
    {
      "id": "hello",
      "name": "Hello Anybox",
      "description": "Local demo MCP server.",
      "risk": "low",
      "permissions": ["Starts a local Node.js MCP server bundled with this plugin."],
      "tools": [
        {
          "name": "hello_echo",
          "title": "Echo Text",
          "description": "Echo text back to the user.",
          "readOnly": true
        }
      ],
      "runtime": {
        "transport": "stdio",
        "command": "node",
        "args": ["${PLUGIN_ROOT}/scripts/server.js"],
        "cwd": "${PLUGIN_ROOT}",
        "timeoutMs": 10000
      },
      "installReview": [
        "Runs a local Node.js process.",
        "Does not require network access or credentials."
      ]
    }
  ]
}
```

### 3. 编写 MCP server

路径：

```text
hello-anybox/scripts/server.js
```

内容：

```js
#!/usr/bin/env node

const readline = require("node:readline")

const tools = [
  {
    name: "hello_echo",
    title: "Echo Text",
    description: "Echo text back to the user.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Text to echo."
        }
      },
      required: ["text"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  }
]

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function textResult(text) {
  return {
    content: [{ type: "text", text }],
    structuredContent: { text },
    isError: false
  }
}

async function callTool(name, args) {
  if (name === "hello_echo") {
    return textResult(String(args && args.text ? args.text : ""))
  }

  throw new Error(`Unknown tool: ${name}`)
}

const rl = readline.createInterface({ input: process.stdin })

rl.on("line", (line) => {
  void (async () => {
    if (!line.trim()) return
    const message = JSON.parse(line)

    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "hello-anybox", version: "0.1.0" }
        }
      })
      return
    }

    if (String(message.method || "").startsWith("notifications/")) return

    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools } })
      return
    }

    if (message.method === "tools/call") {
      try {
        const result = await callTool(
          message.params && message.params.name,
          message.params && message.params.arguments
        )
        send({ jsonrpc: "2.0", id: message.id, result })
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text }],
            structuredContent: { error: text },
            isError: true
          }
        })
      }
      return
    }

    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Unknown method: ${message.method}` }
    })
  })().catch((error) => {
    send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error)
      }
    })
  })
})
```

### 4. 编写 skill

路径：

```text
hello-anybox/skills/hello/SKILL.md
```

内容：

```markdown
---
name: Hello Anybox
description: Use when the user wants to test the Hello Anybox plugin.
---

# Hello Anybox

Use the `hello_echo` MCP tool when the user asks to echo or test plugin connectivity.
```

## 本地加载和验证

假设你的插件仓库是：

```text
C:\Projects\anybox-plugin-examples
```

在开发环境中设置：

```powershell
$env:ANYBOX_PLUGIN_LOCAL_DIR = "C:\Projects\anybox-plugin-examples"
$env:ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "off"
```

然后在 Anybox Agent 源码仓库里运行 catalog 检查：

```powershell
cd C:\Projects\anybox\packages\anyboxagent
bun -e "import * as Plugin from './src/plugin/plugin.ts'; console.log(JSON.stringify(await Plugin.listCatalog(), null, 2))"
```

如果成功，你应该能在输出里看到：

```text
hello-anybox
plugin.hello-anybox.hello
plugin:hello-anybox:hello
```

接着启动桌面端，在插件页安装 `Hello Anybox`，再执行诊断。诊断成功说明 MCP server 能启动，且工具发现成功。

## 开发需要凭据的插件

如果你的插件需要 API key 或 OAuth，不建议直接用 `mcpServers`。推荐使用 `connectors`，这样 Anybox 会为插件生成独立连接状态，并在运行时注入凭据。

### API Key Connector 示例

目录：

```text
weather-demo/
  .anybox-plugin/
    plugin.json
  connectors/
    weather/
      server.js
```

`plugin.json` 中的 connector：

```json
{
  "name": "weather-demo",
  "version": "0.1.0",
  "description": "Weather API plugin demo.",
  "interface": {
    "displayName": "Weather Demo",
    "shortDescription": "Query weather from a third-party API.",
    "developerName": "Your Name",
    "category": "Automation",
    "logo": "WD"
  },
  "connectors": [
    {
      "id": "weather",
      "name": "Weather",
      "description": "Weather API connector.",
      "risk": "medium",
      "permissions": ["Sends requests to api.weather.example."],
      "credential": {
        "kind": "api_key",
        "key": "WEATHER_API_KEY",
        "label": "Weather API key",
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
          "title": "Current Weather",
          "description": "Read current weather for a city.",
          "readOnly": true
        }
      ],
      "installReview": [
        "Requires a Weather API key.",
        "Runs a local MCP wrapper bundled with the plugin."
      ]
    }
  ]
}
```

安装后，生成的 MCP server 类似：

```json
{
  "name": "Weather Demo: Weather",
  "transport": "connector",
  "connectorId": "plugin-connector:weather-demo:weather",
  "enabled": true
}
```

真实 API key 不会写入 MCP 配置。Anybox 只会在启动 connector runtime 时把它注入到 `WEATHER_API_KEY` 环境变量。

### OAuth Connector 示例

如果你的服务使用 OAuth，使用 `credential.kind = "oauth"`：

```json
{
  "connectors": [
    {
      "id": "docs",
      "name": "Docs",
      "description": "Docs OAuth connector.",
      "configFields": [
        {
          "key": "DOCS_OAUTH_CLIENT_ID",
          "label": "Docs OAuth client ID",
          "type": "text",
          "required": true
        },
        {
          "key": "DOCS_OAUTH_CLIENT_SECRET",
          "label": "Docs OAuth client secret",
          "type": "password",
          "required": true,
          "secret": true
        }
      ],
      "credential": {
        "kind": "oauth",
        "label": "Docs OAuth",
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
      },
      "tools": [
        {
          "name": "docs_search",
          "description": "Search docs.",
          "readOnly": true
        }
      ]
    }
  ]
}
```

当前默认 OAuth callback：

```text
http://localhost:1455/auth/callback
```

如果你的 OAuth provider 要求配置 redirect URI，需要把这个地址加入允许列表。

OAuth token 返回 `scope` 时，Anybox 会校验插件声明的非身份类 scope 是否都被授予。缺少必需 scope 时，连接会失败并显示明确错误。

OAuth Credential 还支持：

- `tokenRequestFormat`: `form`（默认）或 `json`；
- `refreshURL`: Refresh Token 使用的独立端点，省略时使用 `tokenURL`；
- `dialect`: 默认 `standard`，当前还支持 `bilibili`。

`dialect: "bilibili"` 用于哔哩哔哩开放平台的非标准网页 OAuth：授权 URL 使用 `gourl` 而不是 `redirect_uri`，不发送 PKCE 参数，Token 响应的 `scopes` 是数组，`expires_in` 是绝对 Unix 秒时间戳。典型声明如下：

```json
{
  "credential": {
    "kind": "oauth",
    "label": "Bilibili OAuth",
    "clientID": "${BILIBILI_CLIENT_ID}",
    "clientSecret": "${BILIBILI_CLIENT_SECRET}",
    "authorizationURL": "https://account.bilibili.com/pc/account-pc/auth/oauth",
    "tokenURL": "https://api.bilibili.com/x/account-oauth2/v1/token",
    "refreshURL": "https://api.bilibili.com/x/account-oauth2/v1/refresh_token",
    "scopes": ["USER_INFO", "USER_DATA"],
    "tokenEndpointAuthMethod": "client_secret_post",
    "tokenRequestFormat": "form",
    "dialect": "bilibili"
  }
}
```

`dialect: "tiktok"` 用于 TikTok Desktop Login Kit。它使用 `client_key`、逗号分隔的 scope，以及 SHA-256 十六进制 PKCE challenge；授权码交换、刷新和撤销会按 TikTok 文档以表单字段发送 `client_key` 与 `client_secret`。插件仍应声明标准的 `clientID` 与 `clientSecret` 字段，运行时会为该方言映射参数名：

```json
{
  "kind": "oauth",
  "label": "TikTok OAuth",
  "clientID": "${TIKTOK_CLIENT_KEY}",
  "clientSecret": "${TIKTOK_CLIENT_SECRET}",
  "authorizationURL": "https://www.tiktok.com/v2/auth/authorize/",
  "tokenURL": "https://open.tiktokapis.com/v2/oauth/token/",
  "refreshURL": "https://open.tiktokapis.com/v2/oauth/token/",
  "revocationURL": "https://open.tiktokapis.com/v2/oauth/revoke/",
  "scopes": ["user.info.basic", "video.list"],
  "tokenRequestFormat": "form",
  "dialect": "tiktok"
}
```

非标准方言只应在 Provider 当前官方文档明确要求时使用，并应覆盖授权 URL、授权码交换、绝对过期时间和独立刷新端点的测试。

如果你的 OAuth provider 支持 RFC 7591 dynamic client registration，可以省略 `clientID`，改用 `registration`：

```json
{
  "credential": {
    "kind": "oauth",
    "label": "Docs OAuth",
    "authorizationURL": "https://auth.example.com/oauth/authorize",
    "tokenURL": "https://auth.example.com/oauth/token",
    "scopes": ["docs.readonly"],
    "registration": {
      "registrationURL": "https://auth.example.com/oauth/register",
      "metadata": {
        "client_name": "Anybox Docs",
        "application_type": "native",
        "token_endpoint_auth_method": "none"
      }
    }
  }
}
```

Anybox 会在用户连接时自动注册 client，并把返回的 `client_id`、可选 `client_secret` 和 `token_endpoint_auth_method` 保存到本地 credential store。生成的 MCP config 仍只保存 `connectorId`。

## 远程 MCP Connector

如果你的服务已经提供远程 MCP endpoint，可以让 connector runtime 指向远程地址：

```json
{
  "runtime": {
    "transport": "remote",
    "serverUrl": "https://api.example.com/mcp",
    "allowedTools": {
      "readOnly": true
    },
    "requireApproval": "always",
    "timeoutMs": 10000
  }
}
```

如果 connector 是 OAuth，且没有显式写 `authorization`，Anybox 会按 `tokenPlacement` 自动注入 access token。

## 项目中如何启用插件

安装插件不等于所有项目自动可用。用户仍需要在项目里显式选择插件。

典型流程：

1. 开发者把插件包放到固定本地插件来源，或通过插件市场安装到受管理安装根目录。
2. 用户打开插件页，安装插件。
3. 如果插件有 connector，用户连接 API key 或 OAuth。
4. 用户在项目里选择该插件。
5. Agent 加载插件 skill 和 MCP tools。
6. 用户发起对话，Agent 根据 skill 和工具列表调用插件工具。

## 命名规则

假设：

```text
pluginID = weather-demo
connectorID = weather
serverID = notes
skillName = review
```

生成 ID：

```text
普通 MCP server: plugin.weather-demo.notes
插件自带 connector: plugin-connector:weather-demo:weather
connector-backed MCP server: plugin.weather-demo.connector.weather
插件 skill: plugin:weather-demo:review
```

旧的 `apps`、`plugin-app:` 和 `.app.` ID 仍兼容，但新插件应该使用 `connectors`、`plugin-connector:` 和 `.connector.`。

## 安全规则

第三方插件应该遵守这些规则：

- 不要把 API key、OAuth client secret、access token、refresh token 提交到 GitHub。
- 不要把用户本地数据库、auth store、缓存目录提交到 GitHub。
- `plugin.json` 里只写 placeholder，例如 `${DOCS_OAUTH_CLIENT_ID}`。
- 真实密钥通过安装配置或 connector 连接流程保存。
- `permissions` 要写清楚插件会启动本地进程、访问哪些网络域名、读取哪些数据。
- 能只读就把工具标记为 `readOnly: true`。
- 有破坏性操作时，清楚标记 `destructive: true` 并提高 `risk`。
- 不要把 `risk` 设置为 `critical`，除非你希望安装被拦截。
- 本地 `stdio` connector 的绝对路径必须留在插件包内；普通命令名如 `node` 可以由宿主环境解析。

建议 `.gitignore`：

```gitignore
node_modules/
dist/
.cache/
dev-install/
*.log
.env
.env.*
*.db
*.sqlite
auth*
tokens*
secrets*
```

## 发布到 GitHub

最简单的发布方式是把整个插件集合仓库提交到 GitHub：

```text
anybox-plugin-examples/
  README.md
  hello-anybox/
    .anybox-plugin/
      plugin.json
    scripts/
    skills/
```

用户可以 clone 你的仓库，然后把仓库根目录设置为：

```powershell
$env:ANYBOX_PLUGIN_LOCAL_DIR = "C:\Projects\anybox-plugin-examples"
```

Anybox 开发版与正式版默认行为一致，都不自动扫描本地仓库源码插件。打开插件页时，它们从 `https://raw.githubusercontent.com/fanfan-de/anybox/master/plugins/Anybox-Plugins/.catalog/anybox-plugin-registry.json` 拉取同一份仓库目录。该目录不跟随 Anybox 桌面版本。目录中的每个插件包带插件自身版本、SHA-256 摘要和精确字节数；本地准备命令禁止用不同内容覆盖已有的同名 ZIP。首次启动离线时无法获得目录；至少成功拉取过一次后，才可使用按 URL 和协议隔离的已验证缓存。

仓库里的 `index.json` 是自动生成的源码清单索引，不是开发版或正式版的默认运行时目录。运行 `pnpm plugins:index` 更新，运行 `pnpm plugins:index:check` 校验。它使用规范 HTTPS manifest URL；根 `plugin.json`、`.codex-plugin/plugin.json` 和其他 GitHub Tree 形式仍只是兼容输入。

展开式插件源码不会整包内置进桌面安装器。Anybox 仓库自身的发布顺序是：先提交插件源码，再运行 `pnpm plugins:catalog:prepare` 和 `pnpm plugins:catalog:verify`，最后把生成的 `.catalog/` 作为普通 Git 变更提交并推送。整个过程不依赖 GitHub Actions、Release 或 API。第三方仓库可以继续通过 `ANYBOX_PLUGIN_LOCAL_DIR` 本地开发，或使用手动 URL 导入；开发 Anybox 仓库自身插件时必须显式设置 `ANYBOX_PLUGIN_INCLUDE_SOURCE_PACKAGES=1`。

## 常见问题

### 插件没有出现在 catalog

检查：

- `ANYBOX_PLUGIN_LOCAL_DIR` 是否指向插件集合根目录。只有在验证受管理安装目录时，才检查 `ANYBOX_PLUGIN_INSTALL_DIR`。
- 目录是否包含 `<plugin-id>/.anybox-plugin/plugin.json`，或版本化的 `<plugin-id>/<version>/.anybox-plugin/plugin.json`。
- `plugin.json` 是否是合法 JSON。
- 是否写了未知顶层字段。
- `name`、`version`、`description` 是否存在。

### 安装时报 `PLUGIN_CONFIG_INVALID`

通常是 `configFields` 里有必填字段，但安装时没有提供。OAuth 插件最常见的是缺少 client ID 或 client secret。

### 商店目录不完整或安装失败

- `PLUGIN_REGISTRY_UNAVAILABLE`：无法从远程仓库拉取目录、`.catalog` 文件尚未推送，或整份目录校验失败；检查仓库文件与网络后重试。
- `PLUGIN_PACKAGE_UNAVAILABLE`：目录条目无法推导或下载可用的 GitHub 插件包。
- `PLUGIN_PACKAGE_DOWNLOAD_FAILED`：GitHub 不可达或下载超时。
- `PLUGIN_PACKAGE_INVALID`：大小、SHA-256、ZIP 路径或清单 ID/版本校验失败。
- `PLUGIN_PLATFORM_ARTIFACT_FAILED`：插件已下载，但当前平台的原生组件安装失败。

安装采用临时目录校验和原子切换；失败不会留下半安装目录，也不会覆盖可用旧版本。

### 诊断失败，提示没有工具

检查：

- `runtime.command` 是否能执行。
- `runtime.args` 路径是否正确。
- `cwd` 是否正确。
- MCP server 是否正确响应 `initialize`、`tools/list`、`tools/call`。
- 本地脚本启动后是否向 stdout 输出了非 JSON 日志。`stdio` MCP server 的 stdout 应只输出 JSON-RPC 消息，普通日志应写 stderr。

### Connector 显示未连接

API key connector 需要用户保存 API key。OAuth connector 需要用户完成浏览器授权。

诊断按钮不会自动发起 OAuth；它只检查当前连接状态和 MCP tool discovery。

### OAuth 成功后工具仍然报权限不足

检查 OAuth provider 返回的 token 是否包含插件声明的 scope。Anybox 当前会在 token 返回 `scope` 时校验必需 scope；如果 provider 不返回 scope，仍可能需要你在工具调用错误里给出清晰提示。

### 卸载插件时源码被删

如果你把 Git 仓库根目录直接设置为 `ANYBOX_PLUGIN_INSTALL_DIR`，UI 卸载可能删除其中的插件包。长期开发建议使用 `ANYBOX_PLUGIN_LOCAL_DIR` 作为固定本地插件来源；如果必须验证受管理安装目录，则使用 `dev-install`，把源码目录和安装目录分开。

## 当前限制

当前实现已经支持真实插件闭环，但仍有一些边界：

- 独立 `connectors/<id>/connector.json` 扫描还未实现，connector 声明目前写在 `plugin.json`。
- `commands` 和 `agents` 是保留字段，v1 不执行。
- 生产级系统凭据存储仍在演进中，当前 agent 侧 JSON auth store 主要作为开发回退。
- 插件签名、信任链和安装时命令审计 UI 仍未完整落地。
- 新插件应使用 `connectors`，不要依赖旧的 `apps` 字段。

## 开发检查清单

发布前确认：

- 插件目录是版本化结构。
- `plugin.json` 只使用支持的字段。
- 至少声明一种真实能力：`mcpServers`、`skills`、`connectors`、`connectorRequirements` 或 `views`。
- 所有 `${PLACEHOLDER}` 都有来源：`PLUGIN_ROOT`、安装 config、API key 或 OAuth token。
- 本地 MCP server 能响应 `initialize`、`tools/list` 和 `tools/call`。
- `permissions`、`risk`、`readOnly`、`destructive` 写得准确。
- GitHub 仓库不包含任何真实凭据。
- 已用 `Plugin.listCatalog()` 验证 catalog 能加载。
- 已在桌面 UI 安装、连接、诊断并实际调用一次工具。
