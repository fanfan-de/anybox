# 制作插件

Anybox 插件是一个可安装的能力包。它可以只包含一组指导 Agent 工作的 Skill，也可以加入 MCP 工具、插件自己的 Connector，以及对平台 Connector 的依赖声明。

本页先带你制作一个能安装、能使用的最小插件，再介绍如何逐步增加工具和连接能力。

> 本页以当前 Anybox 运行时为准。新插件推荐把 `plugin.json` 放在插件根目录；`.anybox-plugin/plugin.json` 与 `.codex-plugin/plugin.json` 仍作为兼容入口。不要使用旧的 `.fanfande-plugin/plugin.json`、`plugin.meta.json`，也不要把 zip 文件提交到展开式插件目录。

## 先选择插件能力

| 能力 | 适合什么场景 | 放在哪里 |
| --- | --- | --- |
| Skill | 给 Agent 提供工作流程、领域知识和使用规则 | `skills/<skill-name>/SKILL.md` |
| MCP server | 提供可以实际执行的本地或远程工具 | `plugin.json` 的 `mcpServers` |
| Connector | 管理插件专属的 API key 或 OAuth 连接 | `plugin.json` 的 `connectors` |
| Connector requirement | 复用 Anybox 已有的 Gmail、GitHub 等平台连接 | `plugin.json` 的 `connectorRequirements` |

如果只是想教 Agent 按固定流程工作，从 Skill 开始即可。只有需要读写外部数据或执行程序时，才需要 MCP server 或 Connector。

## 五分钟完成第一个插件

下面创建一个名为 `hello-anybox` 的 Skill 插件。它不需要构建工具，也不依赖第三方包。

### 1. 创建目录

```text
anybox-plugins/
  hello-anybox/
    plugin.json
    skills/
      hello/
        SKILL.md
```

`anybox-plugins` 是可以容纳多个插件的来源目录，`hello-anybox` 才是这次的插件包。插件目录名、manifest 中的 `name` 和发布 URL 路径最好保持一致，并使用稳定的小写名称。

### 2. 编写 plugin.json

在 `hello-anybox/plugin.json` 写入：

```json
{
  "name": "hello-anybox",
  "version": "0.1.0",
  "description": "A small Anybox plugin for learning the plugin workflow.",
  "author": {
    "name": "Your Name"
  },
  "repository": "https://github.com/your-name/anybox-plugins",
  "interface": {
    "displayName": {
      "zh-CN": "Hello Anybox",
      "en-US": "Hello Anybox"
    },
    "shortDescription": {
      "zh-CN": "通过一个简单 Skill 学习 Anybox 插件。",
      "en-US": "Learn Anybox plugins with one simple Skill."
    },
    "longDescription": {
      "zh-CN": "安装后，Agent 会按照随包 Skill 生成清晰的项目启动清单。",
      "en-US": "After installation, the bundled Skill helps the agent create a clear project kickoff checklist."
    },
    "developerName": "Your Name",
    "category": "Docs",
    "capabilities": ["skill", "project-planning"],
    "logo": "HA",
    "brandColor": "#2563EB"
  },
  "skills": "skills",
  "skillPreviews": [
    {
      "name": "Hello Anybox",
      "description": "Create a concise project kickoff checklist.",
      "directory": "hello"
    }
  ]
}
```

`plugin.json` 必须是严格 JSON，不能写注释或尾随逗号。`name`、`version` 和 `description` 是必填字段；未知的顶层字段会导致插件无法加载。

`skillPreviews` 用于插件安装前的市场预览。它会在运行时校验 manifest 时被剥离，不会变成新的执行能力。

### 3. 编写 SKILL.md

在 `hello-anybox/skills/hello/SKILL.md` 写入：

```markdown
---
name: Hello Anybox
description: Use when the user wants a concise kickoff checklist for a new project.
---

# Hello Anybox

When the user asks to start or plan a project:

1. Restate the intended outcome in one sentence.
2. List the three most important unknowns.
3. Propose the smallest useful first milestone.
4. End with a checklist the user can verify.
```

每个声明的 Skill 根目录只扫描它的直接子目录，每个子目录都必须包含 `SKILL.md`。这个示例安装后会生成 Skill ID：

```text
plugin:hello-anybox:hello
```

### 4. 发布并安装

把 `anybox-plugins` 提交到一个公开 GitHub 仓库，然后复制直接指向 manifest 的 Raw URL：

```text
https://raw.githubusercontent.com/<account>/<repo>/<branch>/hello-anybox/plugin.json
```

在 Anybox 中打开「插件」页面：

1. 点击「导入 URL」。
2. 粘贴上面的 HTTPS manifest URL 并导入。
3. 检查插件展示信息和能力，再点击安装。
4. 在项目中启用该插件，新建会话并让 Agent “为这个项目准备一份启动清单”。

从 GitHub Raw URL 导入时，Anybox 可以把 manifest 所在的 GitHub 目录作为插件包下载。使用其他文件托管服务时，需要提供真实可下载的 zip 包及 `package` 元数据，详见后文。

每次发布更新都应提高 `version`，例如从 `0.1.0` 改为 `0.1.1`。不要直接修改 Anybox 管理的已安装副本。

## Manifest 常用字段

| 字段 | 用途 |
| --- | --- |
| `name`、`version`、`description` | 插件身份、版本和基础说明，必填 |
| `author`、`homepage`、`repository`、`license`、`keywords` | 作者与项目元数据 |
| `interface` | 名称、长短说明、分类、图片和品牌色等展示信息 |
| `skills` | 一个 Skill 根目录，或多个根目录组成的数组；默认是 `skills` |
| `mcpServers` | 插件提供的 MCP server |
| `connectors` | 插件拥有并随卸载清理的连接 |
| `connectorRequirements` | 插件依赖的平台 Connector |
| `skillPreviews`、`package` | 远程目录和安装阶段使用的发布元数据 |

推荐的分类是 `Code`、`Browser`、`Git`、`Database`、`Docs`、`Automation` 和 `Design`。展示图片可以使用 HTTPS、`data:image/`，或插件包内的相对路径，例如 `./assets/icon.png`。

`apps` 是 `connectors` 的旧别名；新插件应使用 `connectors`。`commands` 和 `agents` 当前只是保留字段，不应把它们当作已执行能力。

当 manifest 变得很长时，`mcpServers` 和 `connectors` 也可以指向插件包内的相对 JSON 文件：

```json
{
  "mcpServers": "./mcp.json",
  "connectors": "./connectors.json"
}
```

这些路径必须留在插件包内，并且远程文件必须与 manifest 同源。

## 加入 MCP 工具

需要让 Agent 执行程序时，在插件包中加入一个 MCP server：

```text
hello-anybox/
  plugin.json
  scripts/
    server.js
  skills/
    hello/
      SKILL.md
```

在 `plugin.json` 中加入：

```json
{
  "mcpServers": [
    {
      "id": "hello",
      "name": "Hello Tools",
      "description": "Local tools bundled with Hello Anybox.",
      "risk": "low",
      "permissions": [
        "Starts a local Node.js process bundled with this plugin."
      ],
      "tools": [
        {
          "name": "hello_echo",
          "title": "Echo Text",
          "description": "Return the supplied text.",
          "readOnly": true,
          "destructive": false
        }
      ],
      "runtime": {
        "transport": "stdio",
        "command": "node",
        "args": ["${PLUGIN_ROOT}/scripts/server.js"],
        "cwd": "${PLUGIN_ROOT}",
        "timeoutMs": 10000
      }
    }
  ]
}
```

上面只是 server 声明；`scripts/server.js` 必须真正实现 MCP，并至少正确处理 `initialize`、`tools/list` 和 `tools/call`。本地 `stdio` server 的 stdout 只能输出 JSON-RPC 消息，普通日志应写到 stderr。

安装器不会执行任意依赖安装脚本。需要第三方依赖时，请把能够直接运行的构建产物或所需依赖包含在发布包中。所有 `${PLUGIN_ROOT}` 路径都必须留在插件目录内部。

安装后，这个 server 的 ID 是：

```text
plugin.hello-anybox.hello
```

## 加入需要凭据的 Connector

插件需要自己的 API key 或 OAuth 生命周期时，使用 `connectors`，不要把密钥直接写进 `mcpServers.env`。

下面的远程 Connector 会在用户连接时安全保存 API key，并只在运行时把它注入请求头：

```json
{
  "connectors": [
    {
      "id": "weather",
      "name": "Weather API",
      "description": "Read current weather from the example service.",
      "risk": "medium",
      "permissions": [
        "Sends requests to api.weather.example."
      ],
      "credential": {
        "kind": "api_key",
        "key": "WEATHER_API_KEY",
        "label": "Weather API key",
        "type": "password",
        "required": true,
        "secret": true
      },
      "runtime": {
        "transport": "remote",
        "serverUrl": "https://api.weather.example/mcp",
        "headers": {
          "x-api-key": "${WEATHER_API_KEY}"
        },
        "allowedTools": {
          "readOnly": true
        },
        "requireApproval": "always",
        "timeoutMs": 10000
      },
      "tools": [
        {
          "name": "weather_current",
          "title": "Current Weather",
          "description": "Read current weather for a city.",
          "readOnly": true
        }
      ]
    }
  ]
}
```

安装后会生成 Connector 凭据 ID `plugin-connector:hello-anybox:weather`，以及 MCP server ID `plugin.hello-anybox.connector.weather`。真实密钥不会写入生成的 MCP 配置。

如果插件只需要复用 Anybox 已有的 Gmail、GitHub 或其他平台连接，使用 `connectorRequirements`。这样多个插件可以共享同一个用户授权，而不必各自保存一份凭据。

## 本地开发与验证

从源码运行 Anybox 时，可以让运行时直接扫描本地插件来源：

```powershell
$env:ANYBOX_PLUGIN_LOCAL_DIR = "C:\path\to\anybox-plugins"
$env:ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "off"
```

macOS 或 Linux：

```bash
export ANYBOX_PLUGIN_LOCAL_DIR="/path/to/anybox-plugins"
export ANYBOX_PLUGIN_REGISTRY_INDEX_URL="off"
```

`ANYBOX_PLUGIN_LOCAL_DIR` 应指向包含一个或多个插件目录的父目录。开发时不要把源码仓库设为 `ANYBOX_PLUGIN_INSTALL_DIR`：后者是受管理的安装目录，卸载插件时可能删除其中的副本。

如果已经克隆 Anybox 源码，可以在 Agent 包中检查 catalog：

```powershell
cd packages/anyboxagent
bun -e "import * as Plugin from './src/plugin/plugin.ts'; console.log(JSON.stringify(await Plugin.listCatalog(), null, 2))"
```

除了 catalog 输出，还应在桌面端完成一次安装、连接、诊断和真实调用。

## 发布给其他用户

最简单的分发方式是公开 GitHub 仓库和一个直接指向 `plugin.json` 的 Raw URL。

如果 manifest 不托管在 GitHub，可为远程 manifest 增加真实的 zip 下载信息：

```json
{
  "package": {
    "type": "zip",
    "url": "https://downloads.example.com/hello-anybox-0.1.0.zip",
    "sha256": "64-character-lowercase-or-uppercase-hex-digest",
    "size": 12345
  }
}
```

zip 必须使用 HTTPS，SHA-256 必须与文件一致；归档中不能包含符号链接或逃出解压目录的路径，并且只能有一个 ID 和版本匹配的 manifest。

如果希望插件进入 Anybox 内置目录，可以向 Anybox 仓库提交 Pull Request：

1. 在 `plugins/Anybox-Plugins/<plugin-id>/` 提交展开后的插件源文件。
2. 在 `plugins/Anybox-Plugins/index.json` 中加入直接指向该 `plugin.json` 的 HTTPS URL。
3. 不要提交 `plugin.meta.json` 或构建出的 zip 文件。

目录 URL 不受支持；registry 中的每一项都必须直接指向 `plugin.json`。

## 安全与发布检查

发布前确认：

- 没有提交 API key、OAuth secret、access token、refresh token、`.env`、本地数据库或认证缓存。
- `permissions` 准确说明会启动什么进程、访问什么域名、读取或修改什么数据。
- 只读工具标记了 `readOnly: true`；破坏性操作标记了 `destructive: true`，并设置合适的审批策略。
- `risk` 使用 `low`、`medium` 或 `high`。`critical` 会阻止安装，不应作为普通高风险标签使用。
- 所有运行文件和相对路径都留在插件包内。
- 每个 `${PLACEHOLDER}` 都有明确来源，例如 `PLUGIN_ROOT`、安装配置或 Connector 凭据。
- `version` 已更新，manifest 是合法的严格 JSON。

## 常见问题

| 现象 | 检查 |
| --- | --- |
| 导入 URL 失败 | URL 必须是 HTTPS，并直接指向 `plugin.json`，不能指向 GitHub 网页或目录 |
| 插件出现但不能安装 | 非 GitHub 托管的 manifest 通常还需要有效的 `package` 下载信息 |
| 本地插件没有出现在 catalog | 检查来源根目录、manifest 入口、必填字段、未知顶层字段和 JSON 语法 |
| Skill 没有被发现 | Skill 必须位于声明根目录的直接子目录中，并包含 `SKILL.md` |
| MCP 诊断没有工具 | 检查命令、`${PLUGIN_ROOT}` 路径、`cwd`、协议方法，以及 stdout 是否混入普通日志 |
| 安装时报 `PLUGIN_CONFIG_INVALID` | 检查必填 `configFields`、API key 字段或 OAuth client 配置 |

