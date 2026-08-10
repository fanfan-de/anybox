# 制作插件

Anybox 插件可组合 Skill、MCP 工具和 Connector。新插件使用 `.anybox-plugin/plugin.json`；根目录 `plugin.json` 与 `.codex-plugin/plugin.json` 仅作兼容输入。

> 不要使用旧的 `.fanfande-plugin/plugin.json` 或 `plugin.meta.json`，也不要把生成的 ZIP 放入展开式源码目录。

## 选择能力

| 能力 | 用途 | Manifest 字段 |
| --- | --- | --- |
| Skill | 工作流、领域知识和规则 | `skills` |
| MCP server | 可执行的本地或远程工具 | `mcpServers` |
| Connector | 插件专属 API Key 或 OAuth | `connectors` |
| Connector requirement | 复用平台已有连接 | `connectorRequirements` |

只需指导 Agent 时，从 Skill 开始；需要执行程序或访问外部数据时再增加 MCP 或 Connector。

## 最小 Skill 插件

目录：

```text
anybox-plugins/
  hello-anybox/
    .anybox-plugin/
      plugin.json
    skills/
      hello/
        SKILL.md
```

`.anybox-plugin/plugin.json`：

```json
{
  "name": "hello-anybox",
  "version": "0.1.0",
  "description": "Create a concise project kickoff checklist.",
  "author": { "name": "Your Name" },
  "interface": {
    "displayName": {
      "zh-CN": "Hello Anybox",
      "en-US": "Hello Anybox"
    },
    "category": "Docs"
  },
  "skills": "skills"
}
```

Manifest 必须是严格 JSON。`name`、`version` 和 `description` 必填；未知顶层字段会导致加载失败。

`skills/hello/SKILL.md`：

```md
---
name: Hello Anybox
description: Use when the user needs a concise project kickoff checklist.
---

# Hello Anybox

1. 用一句话重述目标。
2. 列出三个关键未知项。
3. 提出最小可用里程碑。
4. 输出可核对清单。
```

每个 Skill 根目录只扫描直接子目录，且每个子目录必须含 `SKILL.md`。该示例生成 ID `plugin:hello-anybox:hello`。

## 安装与版本

将源码发布到公开 GitHub 仓库，并复制直达 Manifest 的 Raw URL：

```text
https://raw.githubusercontent.com/<account>/<repo>/<branch>/hello-anybox/.anybox-plugin/plugin.json
```

在 Anybox“插件”页选择“导入 URL”，检查能力后安装并为项目启用。每次发布都要提高 `version`；不要直接修改受管安装副本。

非 GitHub 托管的 Manifest 需提供真实 ZIP：

```json
{
  "package": {
    "type": "zip",
    "url": "https://downloads.example.com/hello-anybox-0.1.0.zip",
    "sha256": "<64-character-hex-digest>",
    "size": 12345
  }
}
```

ZIP 必须使用 HTTPS、匹配 SHA-256，且不得包含符号链接或越界路径。

## 添加 MCP 工具

把可直接运行的 MCP server 放入插件包，并在 Manifest 添加：

```json
{
  "mcpServers": [
    {
      "id": "hello",
      "name": "Hello Tools",
      "risk": "low",
      "permissions": ["Starts the bundled local Node.js process."],
      "tools": [
        {
          "name": "hello_echo",
          "title": "Echo Text",
          "description": "Return supplied text.",
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

Server 至少实现 `initialize`、`tools/list` 和 `tools/call`。stdio 的 stdout 只能输出 JSON-RPC，日志写入 stderr。安装器不会运行任意依赖安装脚本，因此发布包必须包含可直接运行的产物；`${PLUGIN_ROOT}` 路径必须留在插件目录内。

## 添加 Connector

插件需要专属凭据时使用 `connectors`，不要把真实密钥写进 `mcpServers.env`：

```json
{
  "connectors": [
    {
      "id": "weather",
      "name": "Weather API",
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
        "transport": "remote",
        "serverUrl": "https://api.weather.example/mcp",
        "headers": { "x-api-key": "${WEATHER_API_KEY}" },
        "requireApproval": "always"
      }
    }
  ]
}
```

凭据 ID 为 `plugin-connector:hello-anybox:weather`，真实值不会写入生成的 MCP 配置。若只需复用 Gmail、GitHub 等平台连接，使用 `connectorRequirements`。

## 添加 Local App Runtime

完整 Web App 使用 `views` 提供入口，并可用独立于 MCP 的 `appRuntime` 启动本地 HTTP 后端：

```json
{
  "views": [{
    "id": "main",
    "title": "Example App",
    "location": "right-sidebar",
    "entry": "./web/index.html"
  }],
  "appRuntime": {
    "type": "local-http",
    "command": "bun",
    "args": ["${PLUGIN_ROOT}/runtime/server.js"],
    "cwd": "${PLUGIN_ROOT}",
    "healthcheckPath": "/health"
  },
  "appPermissions": {
    "workspace": "none",
    "network": [
      "https://api.example.com",
      {
        "kind": "user-configured-origin",
        "id": "custom-provider",
        "description": "用户配置的 Provider 地址。",
        "schemes": ["https"],
        "allowLoopbackHttp": true
      }
    ],
    "system": []
  },
  "installReview": ["运行本地 HTTP Runtime，并连接到上面披露的网络来源。"]
}
```

Runtime 必须监听宿主注入的 `127.0.0.1:ANYBOX_APP_PORT`，并用 `ANYBOX_APP_TOKEN` 验证 `x-anybox-app-runtime-token`。Web 页面只请求同源 `/__anybox_runtime__/...`，不会得到真实端口或 Token。宿主仅注入通用 `ANYBOX_APP_ID/VERSION/PORT/TOKEN/DATA_DIR/CACHE_DIR/LOG_DIR/LOCALE/ARTIFACTS_JSON` 和最小 OS 环境；不要依赖 Agent 私有变量或宿主共享工具路径。

动态 Provider 地址使用 `user-configured-origin`。权限声明用于安装审查，不是 OS 网络沙箱；Runtime 仍须实现 HTTPS/loopback、SSRF、DNS 重绑定、同源重定向与 Secret 不跨源防护。

需要系统钥匙串或原生选择器时，声明平台助手：

```json
{
  "platformArtifacts": [{
    "id": "example-helper",
    "type": "app-runtime-helper",
    "description": "系统钥匙串与用户主动选择文件的原生助手。",
    "executables": [{
      "platform": "win32",
      "architecture": "x64",
      "path": "native/win32-x64/example-helper.exe",
      "sha256": "<64-character-lowercase-hex>"
    }]
  }]
}
```

安装器只选择当前平台/架构，校验 SHA-256 后原子安装，并用 ownership receipt 安全升级和卸载。Runtime 从 `ANYBOX_APP_ARTIFACTS_JSON` 读取受管路径。生产发布还必须完成各平台签名/校验，并在 `installReview` 中明确披露原生代码、凭据和下载行为。

## 本地开发

让运行时扫描独立插件源码目录：

```powershell
$env:ANYBOX_PLUGIN_LOCAL_DIR = "C:\path\to\anybox-plugins"
$env:ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "off"
```

macOS / Linux：

```bash
export ANYBOX_PLUGIN_LOCAL_DIR="/path/to/anybox-plugins"
export ANYBOX_PLUGIN_REGISTRY_INDEX_URL="off"
```

`ANYBOX_PLUGIN_LOCAL_DIR` 指向包含多个插件目录的父目录。不要把源码目录设为 `ANYBOX_PLUGIN_INSTALL_DIR`，卸载可能删除其中的受管副本。完成后应在桌面端实际验证安装、连接、诊断和工具调用。

## 发布检查

提交官方目录时，依次运行：

```text
pnpm plugins:index
pnpm plugins:index:check
pnpm plugins:catalog:prepare
pnpm plugins:catalog:verify
```

发布前确认：

- 未提交密钥、Token、`.env`、本地数据库或认证缓存。
- `permissions` 准确描述进程、域名和数据影响。
- 只读与破坏性工具正确标记 `readOnly`、`destructive` 和审批策略。
- `risk` 仅用 `low`、`medium` 或 `high`；`critical` 会阻止安装。
- 相对路径均在包内，所有占位符都有明确来源，`version` 已更新。

## 排障

| 现象 | 检查 |
| --- | --- |
| URL 导入失败 | HTTPS 地址是否直达受支持的 Manifest 或 GitHub 包路径 |
| 插件可见但不能安装 | 非 GitHub 来源是否包含有效 `package` 元数据 |
| Skill 未发现 | 是否位于 Skill 根目录的直接子目录并包含 `SKILL.md` |
| MCP 没有工具 | 命令、`${PLUGIN_ROOT}`、`cwd`、协议方法及 stdout 日志 |
| `PLUGIN_CONFIG_INVALID` | 必填配置、API Key 字段或 OAuth client 配置 |
