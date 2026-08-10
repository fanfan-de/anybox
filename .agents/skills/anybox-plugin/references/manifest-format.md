# Anybox 插件 Manifest 格式

## 目录

1. 规范包结构
2. Manifest 查找顺序
3. Manifest 文档字段
4. Interface 元数据与本地化
5. Skills
6. 外部组件文件
7. 最小完整包示例

## 规范包结构

使用展开式插件包，把运行时内容放在隐藏 manifest 目录的同级：

```text
<plugin-source-root>/
  <plugin-id>/
    .anybox-plugin/
      plugin.json
    assets/
    connectors/
    docs/
    runtime/
    scripts/
    skills/
      <skill-directory>/
        SKILL.md
    web/
```

只有需要同时保存多个版本时才使用版本目录：

```text
<plugin-source-root>/
  <plugin-id>/
    <version>/
      .anybox-plugin/
        plugin.json
      skills/
```

同一来源根目录中，如果多个版本规范化后得到相同插件 ID，目录会选择 manifest 版本最高的一项。

## Manifest 查找顺序

运行时按以下顺序在插件包根目录中查找 manifest：

1. `.anybox-plugin/plugin.json`
2. `plugin.json`
3. `.codex-plugin/plugin.json`

新插件生成第一种形式。后两种仅作为导入兼容格式。不要生成 `.fanfande-plugin/plugin.json`。

包内相对路径从 `<plugin-root>` 解析，而不是从 `.anybox-plugin` 解析。

## Manifest 文档字段

插件包 manifest 的顶层字段采用严格校验。解析器先处理外部组件路径和文档层元数据，再校验最终运行时 manifest。

必填字段：

| 字段 | 结构 | 含义 |
|---|---|---|
| `name` | 非空字符串 | 规范化后作为插件 ID |
| `version` | 非空字符串 | 用于版本选择和已安装包匹配 |
| `description` | 非空字符串 | 目录描述的回退值 |

可选字段：

| 字段 | 结构 | 含义 |
|---|---|---|
| `author` | 字符串或包含 `name` 的对象 | 作者元数据 |
| `homepage` | 字符串 | 项目主页 |
| `repository` | 字符串 | 源码仓库 |
| `license` | 字符串 | 许可证元数据 |
| `keywords` | 字符串数组 | 目录标签 |
| `interface` | 对象 | Marketplace 和 UI 元数据 |
| `mcpServers` | 数组或包内相对 JSON 路径 | MCP 运行时声明 |
| `mcpRequirements` | 数组 | 对 Anybox 共享内置 MCP 的依赖 |
| `skills` | 字符串或字符串数组 | Skill 根目录；默认值为 `skills` |
| `connectorRequirements` | 数组 | 对共享平台 Connector 的依赖 |
| `connectors` | 数组或包内相对 JSON 路径 | 推荐的插件自有 Connector |
| `apps` | 数组或包内相对 JSON 路径 | 旧版 Connector 别名 |
| `commands` | 字符串或字符串数组 | 保留字段；接受但不执行 |
| `agents` | 字符串或字符串数组 | 保留字段；接受但不执行 |
| `platformArtifacts` | 数组 | 需要宿主安装的平台运行时 Artifact |
| `views` | 数组 | 插件包内 HTML App 入口；当前位置只支持 `right-sidebar` |
| `appRuntime` | 对象 | 可选的包内 Local HTTP App Runtime；独立于 MCP Runtime |
| `appPermissions` | 对象 | App 的 Workspace、网络与系统能力声明和安装审查元数据 |

本地包、仓库和远程 manifest 文档还可以包含：

| 字段 | 结构 | 含义 |
|---|---|---|
| `hooks` | 对象、数组或包内相对 JSON 路径 | 解析并校验，注册运行时前移除 |
| `id` | 非空字符串 | 可选目录 ID 覆盖；通常省略 |
| `skillPreviews` | 数组 | 目录预览元数据 |
| `package` | ZIP 或 GitHub Tree 下载元数据 | 远程安装来源 |

原始文档解析器会解析外部组件文件、校验 hooks JSON，并在校验运行时 manifest 前移除文档层字段。当前不会执行或注册 hooks。

### 严格校验边界

- 未知的运行时顶层字段会导致校验失败。
- MCP Server、Connector、配置字段、工具预览、Package 和本地化文本对象均使用严格 schema。
- `interface` 有意允许扩展，当前采用 passthrough schema。
- 不要依赖 `interface` 的 passthrough 来实现运行时行为；新增字段必须有文档和测试。

## Interface 元数据与本地化

当前支持的 Interface 字段包括：

```json
{
  "interface": {
    "displayName": "示例插件",
    "shortDescription": "简短的 Marketplace 摘要。",
    "longDescription": "用于详情页的较长说明。",
    "developerName": "示例开发者",
    "category": "Docs",
    "capabilities": ["search", "review"],
    "websiteURL": "https://example.com",
    "privacyPolicyURL": "https://example.com/privacy",
    "termsOfServiceURL": "https://example.com/terms",
    "defaultPrompt": "搜索我的文档",
    "composerIcon": "./assets/icon.png",
    "logo": "./assets/logo.png",
    "iconUrl": "./assets/icon.png",
    "thumbnailUrl": "./assets/thumbnail.png",
    "heroImageUrl": "./assets/hero.png",
    "screenshots": ["./assets/screenshot.png"],
    "brandColor": "#2F6FED"
  }
}
```

`defaultPrompt` 可以是字符串或字符串数组。

`displayName`、`shortDescription` 和 `longDescription` 可以是字符串，也可以是本地化对象：

```json
{
  "interface": {
    "displayName": {
      "en-US": "Document Search",
      "zh-CN": "文档搜索"
    },
    "shortDescription": {
      "en-US": "Search connected documents.",
      "zh-CN": "搜索已连接的文档。"
    }
  }
}
```

支持以下 locale key：

```text
en-US, zh-CN, zh-TW, ja-JP, ko-KR, pt-BR, es-419,
de-DE, fr-FR, id-ID, it-IT, pl-PL, tr-TR, vi-VN
```

本地化对象必须至少包含一个受支持的 locale。

优先使用以下目录分类：

```text
Code, Browser, Git, Database, Docs, Automation, Design
```

目录会把 `engineering` 和 `coding` 映射为 `Code`，把 `productivity` 和 `documentation` 映射为 `Docs`。未知分类字符串目前会在目录规范化时回退；为了得到可预测的 UI，应使用上面的精确值。

展示资源可以使用 HTTPS URL、`data:image/` URL 或包内相对路径。受支持的本地资源会转换为可显示的 data URL。远程相对资源从 manifest URL 所代表的插件包根目录解析。

## Plugin View 与 Local App Runtime

完整 Web App 继续使用 `views` 作为用户入口。构建后的 HTML、JavaScript 和 CSS 必须随插件包发布，并使用包内相对资源路径：

```json
{
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

`entry` 必须是包内相对 HTML 路径；本地扫描与安装会检查真实文件，并拒绝绝对路径、URL、路径穿越和符号链接逃逸。每个插件内的 View ID 必须唯一。

只有需要 Anybox 启动本地 HTTP 后端的 App 才声明 `appRuntime`：

```json
{
  "appRuntime": {
    "type": "local-http",
    "command": "bun",
    "args": ["${PLUGIN_ROOT}/runtime/server.js"],
    "cwd": "${PLUGIN_ROOT}",
    "healthcheckPath": "/health",
    "startupTimeoutMs": 15000,
    "idleTimeoutMs": 300000
  },
  "appPermissions": {
    "workspace": "request",
    "network": ["https://api.example.com", "http://127.0.0.1:8181"],
    "system": ["file-picker"]
  }
}
```

规则：

- `type` 当前只能为 `local-http`；Runtime 必须在 `127.0.0.1` 上监听宿主注入的 `ANYBOX_APP_PORT`。
- Runtime 必须用 `ANYBOX_APP_TOKEN` 验证 `x-anybox-app-runtime-token`；App Web 不会得到端口或 Token，而是请求同源 `/__anybox_runtime__/...`。
- `healthcheckPath` 必须是无 query、fragment 和父目录段的绝对 URL path。
- `${PLUGIN_ROOT}` 是 `appRuntime` 唯一支持的 placeholder；被引用的本地文件或目录必须存在且留在包内。普通命令名如 `bun` 可由宿主解析。
- `startupTimeoutMs` 范围是 100–120000；`idleTimeoutMs` 范围是 0–86400000，0 表示不按空闲超时停止。
- `appPermissions.workspace` 当前是 `none` 或 `request`；网络条目必须是 HTTPS origin，只有显式 loopback origin 可使用 HTTP；系统能力只接受 `file-picker`、`notifications`、`open-external`、`clipboard`。
- 当前 Web 容器只为同源 Runtime Gateway 开放 `connect-src 'self'`；声明的 Remote Origin 和系统能力尚未形成完整授权执行层。Local Runtime 也尚无 OS 级进程 Sandbox，因此这些字段首先是严格声明和安装风险审查，不是强隔离承诺。
- 安装、更新、禁用、卸载和 Agent 退出会停止对应 Runtime；stdout/stderr 写入 App 隔离日志目录。当前 Gateway 支持普通 HTTP、流式响应与 Range headers，不支持 WebSocket。

## Skills

省略 `skills` 时，运行时扫描 `skills` 目录。声明值可以是一个根目录，也可以是多个包内相对根目录：

```json
{
  "skills": ["skills", "specialized-skills"]
}
```

对于每个已声明根目录：

- 保证根目录位于插件包内。
- 只发现它的直接子目录。
- 要求每个被发现的 Skill 目录包含 `SKILL.md`。
- 不同根目录下的直接子目录名称必须保持唯一。

生成的 Skill ID：

```text
plugin:<pluginID>:<skill-directory-name>
```

## 外部组件文件

`apps`、`connectors`、`mcpServers` 和 `hooks` 可以内联，也可以使用包内相对 JSON 文件路径：

```json
{
  "name": "external-components",
  "version": "0.1.0",
  "description": "使用外部组件声明。",
  "connectors": "./connectors.json",
  "mcpServers": "./mcp.json",
  "hooks": "./hooks.json"
}
```

规则：

- 必须使用插件包内的相对 JSON 路径。
- 拒绝绝对路径、协议 URL、查询参数、fragment，以及逃逸插件包的路径穿越。
- 对远程 manifest，只能从相同 origin 且位于同一插件包根 URL 内的位置获取组件文件。
- 兼容解析器允许时，可以使用直接组件数组，也可以使用包含对应组件 key 的对象。
- 为兼容性解析 hooks，但不要承诺会执行它们。

## 最小完整包示例

```text
plugin-source-root/
  notes-review/
    .anybox-plugin/
      plugin.json
    scripts/
      server.js
    skills/
      review/
        SKILL.md
```

```json
{
  "name": "notes-review",
  "version": "0.1.0",
  "description": "使用内置 MCP Server 评审本地笔记。",
  "author": {
    "name": "示例开发者"
  },
  "interface": {
    "displayName": "笔记评审",
    "shortDescription": "使用内置工具评审笔记。",
    "developerName": "示例开发者",
    "category": "Docs",
    "logo": "NR"
  },
  "mcpServers": [
    {
      "id": "notes",
      "name": "笔记评审",
      "risk": "low",
      "permissions": ["启动插件内置的本地 MCP Server。"],
      "runtime": {
        "transport": "stdio",
        "command": "node",
        "args": ["${PLUGIN_ROOT}/scripts/server.js"],
        "cwd": "${PLUGIN_ROOT}",
        "timeoutMs": 10000
      }
    }
  ],
  "skills": "skills"
}
```
