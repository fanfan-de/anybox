---
name: anybox-plugin-development
description: 创建、审查或验证 Anybox 第三方插件包。Use when the user asks to make a plugin, convert an API/SaaS/local tool into an installable plugin, write plugin.json, add plugin MCP servers, add bundled plugin skills, define plugin-owned connectors with API key or OAuth credentials, package plugin metadata, or debug plugin catalog/install/diagnostic failures.
---

# Anybox 插件开发

使用这个 skill 来为当前仓库的插件运行时创建插件包。遇到文档和代码不一致时，以运行代码为准。

参考来源：

- 随包完整指南：`../../docs/anybox-third-party-plugin-development.md`
- 在源码仓库内调试时，以 `packages/anyboxagent/src/plugin/plugin.ts` 为运行时事实来源。
- 在源码仓库内修改插件系统代码后，参考 `packages/anyboxagent/Test/plugin.test.ts`。

## 工作流

1. 明确插件能力：MCP 工具、随包 skill、插件自带 connector，或平台 connector requirement。
2. 选择插件包结构。默认使用 Codex-like 展开目录。
3. 编写根目录 `plugin.json`，必须是严格 JSON，只使用运行时支持的顶层字段。
4. 在插件根目录添加运行文件，例如 `skills/`、`connectors/`、`scripts/`、`docs/` 和 `assets/`。
5. 使用 `Plugin.listCatalog()` 验证 catalog 能发现插件。
6. 如果修改了插件系统运行时代码，运行 `bun test Test/plugin.test.ts`。

## 插件包结构

新插件默认使用这个结构：

```text
<install-root>/
  <plugin-id>/
    plugin.json
    skills/
      <skill-name>/
        SKILL.md
    connectors/
    scripts/
    docs/
    assets/
```

注意：

- `<install-root>` 是包含一个或多个插件包目录的父目录；开发新插件时优先把它作为 `ANYBOX_PLUGIN_LOCAL_DIR`。
- 当前运行时用 `ANYBOX_PLUGIN_LOCAL_DIR` 发现固定本地插件仓库，未设置时默认是 Agent data 目录下的 `plugins/local`。这个目录逻辑上等价于 GitHub 插件仓库，只提供可安装候选项，不受卸载流程删除。
- `ANYBOX_PLUGIN_INSTALL_DIR` 是受管理安装根目录，用于网络下载或从本地仓库安装时复制出来的插件包。这里的插件逻辑上属于已安装插件，运行时使用这里的副本，卸载时可能删除对应插件包。
- 运行时优先读取根目录 `plugin.json`；旧的 `.anybox-plugin/plugin.json` 仍然兼容。
- `skills`、`connectors`、`scripts`、`docs` 和 `assets` 应放在插件根目录。
- 插件 ID 使用稳定的小写名称。目录名和 manifest `name` 尽量保持一致。
- 如果确实需要多个版本并存，也可以使用 `<plugin-id>/<version>/plugin.json`，运行时会选择最高版本。

## Manifest 规则

最小 manifest：

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "description": "My first Anybox plugin."
}
```

支持的顶层字段包括：

- `name`、`version`、`description`
- `author`、`homepage`、`repository`、`license`、`keywords`
- `interface`
- `mcpServers`
- `skills`
- `connectorRequirements`
- `connectors`
- `apps`，仅用于旧兼容
- `commands`、`agents`，当前是保留字段

未知顶层字段会被拒绝。

使用 `interface` 配置 catalog 展示信息：

```json
{
  "interface": {
    "displayName": "Hello Anybox",
    "shortDescription": "A minimal plugin for learning plugin development.",
    "longDescription": "This plugin demonstrates a local stdio MCP server and a bundled Agent skill.",
    "developerName": "Your Name",
    "category": "Automation",
    "capabilities": ["demo", "mcp"],
    "logo": "HA",
    "brandColor": "#2563EB"
  }
}
```

优先使用已知 catalog 分类：`Code`、`Browser`、`Git`、`Database`、`Docs`、`Automation` 和 `Design`。

## 能力模式

不需要独立连接状态或凭据生命周期的工具，使用 `mcpServers`：

```json
{
  "mcpServers": [
    {
      "id": "hello",
      "name": "Hello Anybox",
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
      }
    }
  ]
}
```

插件需要给 Agent 提供说明时，使用 `skills`：

```json
{
  "skills": "skills"
}
```

声明的 skill root 下，每个直接子目录都必须包含 `SKILL.md`。例如 `skills/review/SKILL.md` 会生成 `plugin:<plugin-id>:review`。

插件需要自带 API key 或 OAuth 状态时，使用 `connectors`：

```json
{
  "connectors": [
    {
      "id": "weather",
      "name": "Weather",
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
        }
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

插件要复用平台已有能力时，使用 `connectorRequirements`，例如 browser、GitHub 或 workspace files。

## Runtime 规则

- 所有 `${PLUGIN_ROOT}` 路径都必须留在插件包内部。
- `stdio` MCP server 的普通日志写 stderr。stdout 只能输出 JSON-RPC 消息。
- 本地 MCP server 必须响应 `initialize`、`tools/list` 和 `tools/call`。
- 只读工具标记 `readOnly: true`，破坏性操作标记 `destructive: true`。
- `risk` 使用 `low`、`medium` 或 `high`；不要使用 `critical`，除非插件安装应该被阻止。
- 不要提交 API key、OAuth client secret、access token、refresh token、本地 auth store、数据库或缓存目录。

## 验证

对候选插件来源根目录运行：

```powershell
cd C:\Projects\anybox\packages\anyboxagent
$env:ANYBOX_PLUGIN_LOCAL_DIR = "C:\path\to\plugin-source-root"
$env:ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "off"
bun -e "import * as Plugin from './src/plugin/plugin.ts'; console.log(JSON.stringify(await Plugin.listCatalog(), null, 2))"
```

确认输出里包含插件 ID、生成的 MCP server ID、connector-backed MCP server ID 和随包 skill ID。

修改插件系统运行时代码后运行：

```powershell
cd C:\Projects\anybox\packages\anyboxagent
bun test Test/plugin.test.ts
```

## 常见失败

- 插件没有出现在 catalog：检查 `ANYBOX_PLUGIN_LOCAL_DIR`、目录结构、JSON 合法性、支持的顶层字段，以及必填的 `name`、`version`、`description`。只有验证下载/安装根目录时才检查 `ANYBOX_PLUGIN_INSTALL_DIR`。
- `PLUGIN_CONFIG_INVALID`：检查必填 `configFields` 或 OAuth client 设置。
- 诊断没有发现工具：检查命令是否可执行、runtime 路径、`cwd`、JSON-RPC 方法处理，以及 stdout 是否混入普通日志。
- Connector 未连接：API key connector 需要保存 key；OAuth connector 需要完成浏览器授权。
- 卸载时源码被删：开发时使用 `ANYBOX_PLUGIN_LOCAL_DIR`。不要直接把 Git 源码根目录当成 `ANYBOX_PLUGIN_INSTALL_DIR`；如果必须验证受管理安装根，复制或构建到 `dev-install` 目录。
