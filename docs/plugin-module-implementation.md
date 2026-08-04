# Anybox 插件模块实现机制技术介绍

> [!NOTE]
> 本文描述持久化安装的插件、Skill、Connector 与 MCP 能力，不定义 Anybox 原生 Tool Module。Planner 等内部工具的当前轮渐进式披露见 [原生 Tool Module ADR](./native-tool-module-architecture-decision.md)。

本文说明当前 Anybox 插件模块的实现机制，面向需要维护插件运行时、开发插件包、调试插件安装/启用链路的工程人员。代码实现以 `packages/anyboxagent/src/plugin/plugin.ts` 为准；当本文与旧文档不一致时，以运行时代码为准。

## 1. 模块定位

Anybox 插件不是新的执行引擎，而是一个能力包管理层。插件负责声明能力和展示信息，真正执行仍复用 Anybox 现有的几条基础链路：

- MCP：插件可以生成 MCP server 配置，最终由 MCP client 连接并暴露工具。
- Connector：插件可以依赖平台共享 connector，也可以声明插件自带 connector。
- Auth：插件自带 connector 的 API key、OAuth session、动态 OAuth client registration 均存入 credential store。
- Skill：插件可以携带 Agent skill，按项目选择结果参与当前会话的 skill 发现。
- Project config：安装插件不等于对所有项目生效，项目仍要显式选择插件。
- Desktop UI：桌面端插件页只负责展示和调用 API，不直接执行插件能力。

核心源码分布：

```text
packages/anyboxagent/src/plugin/plugin.ts              插件 manifest、catalog、安装、运行时绑定
packages/anyboxagent/src/connector/connector.ts        平台 connector 与 plugin connector runtime 解析
packages/anyboxagent/src/mcp/client.ts                 connector-backed MCP server 的实际连接
packages/anyboxagent/src/config/config.ts              项目 MCP server 解析和 selected_plugins
packages/anyboxagent/src/skill/skill.ts                插件 skill 发现
packages/anyboxagent/src/server/routes/settings.ts     插件/connector 设置 API
packages/desktop/src/main/ipc.ts                       桌面端到 Agent API 的桥接
plugins/Anybox-Plugins/                                仓库内插件包集合
```

## 2. 插件包布局

仓库内插件源码采用展开目录，规范 manifest 入口为：

```text
<plugin-id>/.anybox-plugin/plugin.json
```

只有同一来源需要并存多个版本时才使用版本目录：

```text
<plugin-id>/<version>/.anybox-plugin/plugin.json
```

推荐插件包结构：

```text
<plugin-id>/
  .anybox-plugin/
    plugin.json
  skills/
    <skill-name>/
      SKILL.md
  connectors/
    <connector-id>/
      server.js
  scripts/
    server.js
  docs/
  assets/
```

注意：

- 新插件使用 `.anybox-plugin/plugin.json`；根目录 `plugin.json` 和 `.codex-plugin/plugin.json` 仅作为兼容输入。
- `skills`、`connectors`、`scripts` 等放在插件包根目录下。
- `connectors`、`mcpServers` 和 `hooks` 可以内联，也可以指向插件包内的相对 JSON 文件；当前不会独立扫描 `connectors/<id>/connector.json`。
- 插件 ID 来自 manifest `name` 的 trim + lowercase 结果，目录名、manifest `name` 和 registry ID 应保持一致。
- 一个插件源里如果直接包没有 `.anybox-plugin/plugin.json`、但存在多个版本目录，catalog 会按 manifest `version` 选最高版本。
- 版本化 ZIP 只保存在仓库级 `.catalog/packages/`，不放进展开式插件源码目录。

## 3. Manifest Schema

`plugin.json` 使用 Zod 严格校验，未知顶层字段会被拒绝。核心字段：

```json
{
  "name": "filesystem",
  "version": "1.0.0",
  "description": "Expose a specific local directory to an MCP filesystem server.",
  "interface": {
    "displayName": "Filesystem",
    "shortDescription": "Expose a local directory to MCP.",
    "developerName": "Model Context Protocol",
    "category": "Code",
    "capabilities": ["Read", "Write"]
  },
  "mcpServers": [],
  "mcpRequirements": [],
  "skills": "skills",
  "connectorRequirements": [],
  "connectors": []
}
```

已支持的顶层字段：

- `name`、`version`、`description`：必需字段。
- `author`、`homepage`、`repository`、`license`、`keywords`：元数据。
- `interface`：市场和插件页展示信息，支持本地化文本对象。
- `mcpServers`：普通 MCP server 模板。
- `mcpRequirements`：对 Anybox 共享内置 MCP 的依赖。
- `skills`：插件内 skill 根目录，默认 `"skills"`，可为字符串或字符串数组。
- `connectorRequirements`：对平台共享 connector 的依赖。
- `connectors`：插件自带 connector 声明，支持 `stdio` 或 `remote` runtime。
- `apps`：旧字段，兼容别名；新插件应使用 `connectors`。
- `commands`、`agents`：保留字段，当前接受但不执行。

插件至少应提供一种真实能力：`mcpServers`、`mcpRequirements`、`skills`、`connectorRequirements` 或 `connectors`。

## 4. Catalog 加载和合并

插件 catalog 的输入是 `PluginManifestSource`，包含 manifest、可选本地包路径、可选下载信息和来源类型。

### 4.1 包扫描来源

`packageSearchRoots()` 始终包含：

1. 本地开发插件仓库：`ANYBOX_PLUGIN_LOCAL_DIR`，未设置时为 Agent data 下的 `plugins/local`。
2. 受管理安装目录：`ANYBOX_PLUGIN_INSTALL_DIR`，未设置时为 Agent data 下的 `plugins/installed`。

只有显式设置 `ANYBOX_PLUGIN_INCLUDE_SOURCE_PACKAGES=1` 时，才额外扫描 Agent 源码中的 `packages/anyboxagent/plugins/builtin` 和仓库源码中的 `plugins/Anybox-Plugins`。桌面开发版与正式版默认都将该变量设为 `0`，从而保持生产一致性。

前面的来源会先进入合并表，后面的同 ID 来源会覆盖前面的同 ID 来源。本地开发目录和显式启用的源码目录只作为候选来源；安装时会复制到受管理安装目录。

### 4.2 Registry 来源

除本地包外，还支持 registry：

- 本地 registry 文件：仓库内 `plugins/registry/plugin-registry.json` 及 `ANYBOX_PLUGIN_REGISTRY_FILES` 指定的文件。
- 远程 Registry：`ANYBOX_PLUGIN_REGISTRY_INDEX_URL`。桌面开发版、正式版和未覆盖配置的独立 Agent 默认都读取 `https://raw.githubusercontent.com/fanfan-de/anybox/master/plugins/Anybox-Plugins/.catalog/anybox-plugin-registry.json`。
- 默认文件是 schema v3 Catalog Registry，直接嵌入完整目录条目和版本化 ZIP 元数据；兼容的 manifest URL 列表与旧 v2 Release Registry 仍可作为显式输入。
- `plugins/Anybox-Plugins/index.json` 只是本地 Catalog 的源码清单输入，不是默认运行时目录。
- 成功的远程目录按 URL 和协议版本整体缓存；`ANYBOX_PLUGIN_REGISTRY_CACHE_DIR` 可以覆盖缓存目录。

正式 schema v3 条目必须携带 ZIP URL、SHA-256 和精确字节数。仓库源码仍以展开目录提交，版本化 ZIP 由本地命令写入 `.catalog/packages/`：

```json
{
  "schemaVersion": 3,
  "catalogID": "anybox-plugins",
  "sourceCommit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "pluginCount": 1,
  "plugins": [
    {
      "id": "remote-lab",
      "name": "remote-lab",
      "version": "1.2.3",
      "description": "Remote fixture plugin.",
      "package": {
        "type": "zip",
        "url": "https://raw.githubusercontent.com/fanfan-de/anybox/master/plugins/Anybox-Plugins/.catalog/packages/anybox-plugin-remote-lab-1.2.3.zip",
        "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "size": 12345
      }
    }
  ]
}
```

### 4.3 Catalog normalizer

`normalizeCatalogItem()` 将 manifest source 转换成 UI 和 API 使用的 `PluginCatalogItem`：

- 从 `interface` 生成名称、短描述、长描述、分类、图标、截图、品牌色等展示字段。
- 从 `mcpServers`、`mcpRequirements`、`connectors`、`connectorRequirements`、`skills` 汇总权限、工具预览、配置字段和风险等级。
- 若本地包存在，会读取 `skills/<skill>/SKILL.md` 的 frontmatter 生成 skill preview。
- 风险等级取各能力最高风险；`critical` 插件会出现在 catalog 中，但安装会被拒绝。
- `installable` 由本地包存在或 Registry package 下载信息完整决定。

## 5. 安装、更新和卸载

安装入口是 `Plugin.install(pluginID, input)`。

### 5.1 安装步骤

1. `ensurePluginPackageAvailable(pluginID)` 确保插件包可用：
   - 已在受管理安装目录：直接使用。
   - 来自本地开发目录或显式启用的仓库源码目录：复制到受管理安装目录。
   - 来自 Registry：按目录中的固定 URL 下载 ZIP、校验并解压到受管理安装目录。
2. `assertPackagePlugin(pluginID)` 从本地包读取并规范化 catalog item。
3. 生成 `InstalledPlugin` 记录：
   - `pluginID`
   - `version`
   - `enabled`
   - `mcpServerID` / `mcpServerIDs`
   - `mcpServerEnabled`
   - `skillIDs`
   - `connectorIDs`
   - `connectorRequirementIDs`
   - `config`
   - `installedAt` / `updatedAt`
4. 写入 SQLite 表 `installed_plugins`。
5. 调用 `syncPluginRuntimeBindings()` 生成全局 MCP server 配置。普通 MCP 和 connector-backed MCP 都带有显式的 plugin owner、`pluginID` 与稳定 `bindingID`。

安装本身不把插件暴露给所有项目。用户还需要在项目里选择该插件。

### 5.2 下载包安全检查

Registry zip 安装会做以下校验：

- package URL 必须是 HTTPS。
- URL 不允许携带用户名或密码。
- 下载大小不能超过上限，且可校验声明的 `size`。
- SHA-256 必须匹配 registry metadata。
- 拒绝空包、重复路径、symlink、路径穿越和超限解压内容。
- zip 内必须有且仅有一个 manifest 匹配 registry 中声明的插件 ID 和版本。
- 先在临时目录完成复制和校验，再原子切换安装目录；失败时保留原有可用版本。

### 5.3 更新

`Plugin.update(pluginID, input)` 不重新下载包，只基于当前本地包重算绑定：

- 可更新 `enabled`。
- 可更新安装配置 `config`。
- 重新生成 `mcpServerIDs`、`skillIDs`、`connectorIDs`、`connectorRequirementIDs`。
- 保留仍存在 MCP 的 `mcpServerEnabled` 与 MCP 配置中的 `toolPolicies`；新 MCP 默认启用，已移除 MCP 的偏好会被清理。
- 写回全局 MCP server 配置，并移除已经不再存在的旧 server ID。

启动 reconcile 会为旧插件绑定补写 owner，依据旧 MCP 的有效启用状态惰性补齐 `mcpServerEnabled`，并清理已卸载插件遗留的 plugin-owned server。归属判断优先使用 owner；只对已安装记录中的精确 server ID 做旧数据兼容，不能仅凭 `plugin.*` 前缀认定归属。

### 5.4 卸载

`Plugin.remove(pluginID)` 会：

- 删除 `installed_plugins` 中的安装记录。
- 删除该插件生成的全局 MCP server 配置。
- 清理插件自带 connector 的 credential store 记录，包括旧 `plugin-app:` 兼容 ID。
- 如果包位于受管理安装目录，则删除该包目录。
- 不会删除 `ANYBOX_PLUGIN_LOCAL_DIR` 或仓库插件目录里的源包。

## 6. ID 生成规则

插件运行时依赖稳定 ID 进行配置、凭据、工具注册和项目选择。

| 对象 | ID 格式 |
| --- | --- |
| 插件 ID | `<normalized manifest.name>` |
| 默认 MCP server | `plugin.<pluginID>` |
| 命名 MCP server | `plugin.<pluginID>.<serverID>` |
| 插件自带 connector | `plugin-connector:<pluginID>:<connectorID>` |
| 插件自带 connector MCP server | `plugin.<pluginID>.connector.<connectorID>` |
| 插件 skill | `plugin:<pluginID>:<skill-directory-name>` |
| 平台 connector instance | `connector:<connectorID>:default` |
| 平台 connector MCP server | `connector.<connectorID>.default` |

兼容旧 ID：

- `plugin-app:<pluginID>:<appID>`
- `plugin.<pluginID>.app.<appID>`

安装和更新会生成新 ID；运行时解析和卸载仍会兼容旧 ID。

## 7. MCP Server 能力

### 7.1 普通 mcpServers

`mcpServers` 适合声明不需要独立连接状态的 MCP 能力，例如本地脚本、无认证工具，或只依赖安装配置的远程服务。

```json
{
  "mcpServers": [
    {
      "name": "Filesystem",
      "risk": "high",
      "permissions": ["Read and potential write access inside the configured root path."],
      "tools": [
        {
          "name": "read_file",
          "description": "Read a file below the configured root.",
          "readOnly": true,
          "destructive": false
        }
      ],
      "configFields": [
        {
          "key": "ROOT_PATH",
          "label": "Root path",
          "type": "path",
          "required": true
        }
      ],
      "runtime": {
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "${ROOT_PATH}"],
        "timeoutMs": 30000
      }
    }
  ]
}
```

安装时会转换成全局 MCP server 配置：

```text
plugin.filesystem
```

`runtime.transport` 支持：

- `stdio`：启动本地命令，支持 `command`、`args`、`env`、`cwd`、`timeoutMs`。
- `remote`：连接远程 MCP endpoint，支持 `serverUrl`、`authorization`、`headers`、`allowedTools`、`requireApproval`、`provider` 等。

`tools` 字段只是预览和策略提示；真实工具列表仍来自 MCP server 的 `tools/list`。

### 7.2 占位符替换

普通 MCP runtime 会用安装配置替换 `${UPPER_CASE_KEY}`，并自动提供：

```text
PLUGIN_ROOT=<installed package root>
```

配置字段来源：

- `mcpServers[*].configFields`
- `connectors[*].configFields`

`normalizeConfig()` 会检查必填字段、填入 defaultValue，并保留用户传入的额外字段。缺少 required 字段时安装或更新会失败。

## 8. 插件自带 Connector

`connectors` 用于插件独占的连接能力，适合插件专属 API key、OAuth session、远程 MCP 服务，或插件包内自带的本地 MCP wrapper。

示意：

```json
{
  "connectors": [
    {
      "id": "docs-local",
      "name": "Docs Local",
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

安装时不会把真实密钥写入 MCP server 配置，而是生成 connector-backed MCP server：

```json
{
  "transport": "connector",
  "connectorId": "plugin-connector:docs-lab:docs-local"
}
```

当 MCP client 连接该 server 时：

1. `mcp/client.ts` 发现 `transport: "connector"`。
2. 调用 `connector.resolveRuntime(connectorId)`。
3. `connector.ts` 根据 `plugin-connector:` 前缀转发给 `Plugin.resolveConnectorRuntime()`。
4. 插件模块读取安装记录、manifest、credential store。
5. 把安装 config、`PLUGIN_ROOT`、API key 或 OAuth token 组合成内存里的 runtime config。
6. 返回真实 `stdio` 或 `remote` runtime 给 MCP client。

这样 MCP 配置只保存 `connectorId`，真实 secret 只在运行时进入内存。

### 8.1 API Key connector

API key 保存路径：

```text
PUT /api/plugins/installed/:pluginID/connectors/:appID/api-key
```

内部使用 `Auth.setProviderCredential()` 存入 credential store。解析 runtime 时，插件模块把 API key 写入 credential 声明的 `key` 对应变量，例如 `DOCS_API_KEY`。

### 8.2 OAuth connector

OAuth connector 支持：

- 固定 `clientID` / `clientSecret`
- PKCE 授权码流程
- scope 校验
- refresh 过期 session
- token placement
- RFC 7591 风格 dynamic client registration

相关 API：

```text
POST   /api/plugins/installed/:pluginID/connectors/:appID/auth/flows
GET    /api/plugins/installed/:pluginID/connectors/:appID/auth/flows/:flowID
DELETE /api/plugins/installed/:pluginID/connectors/:appID/auth/flows/:flowID
DELETE /api/plugins/installed/:pluginID/connectors/:appID/auth/session
```

如果 remote runtime 未显式声明 `authorization`，OAuth token 会按 credential 的 `tokenPlacement` 自动注入：

- 默认 `Authorization: Bearer <access_token>`
- 或自定义 header 名和值模板

## 9. 平台 Connector Requirement

`connectorRequirements` 用于声明插件依赖已有的平台共享 connector。典型场景是 Gmail、GitHub 或数据库账号这类用户只授权一次、由多个插件复用的连接。

示意：

```json
{
  "connectorRequirements": [
    {
      "connector": "gmail",
      "tools": ["gmail_search_messages"],
      "required": true,
      "reason": "Search mail through the shared Anybox Gmail connector."
    }
  ]
}
```

安装这类插件时：

- 不生成 plugin-owned connector ID。
- 不保存插件私有 credential。
- 记录 `connectorRequirementIDs`，例如 `connector:gmail:default`。
- 调用 `Connector.syncConnectorRuntimeBindings()`，确保平台 connector 对应的全局 MCP server 存在。

项目选择插件后，`Config.resolveProjectMcpServers()` 会把该插件要求的平台 connector server 也纳入项目可用 MCP server 集合。

### 9.1 Anybox 内置 MCP Requirement

`mcpRequirements` 声明插件依赖 Anybox 已有、没有账号连接生命周期的共享内置 MCP。
安装记录保存 `mcpRequirementIDs`，项目选择插件后会合并这些 MCP，但插件不会取得运行时所有权。

Chrome 0.12.1 是这个边界的示例：插件不声明私有 `mcpServers`，
而是通过 `mcpRequirements` 依赖 Anybox 内置的 `node-repl` MCP。Agent 根据 Chrome Skill 在通用 Node
REPL 中动态导入插件的 `browser-client.mjs`；Chrome 业务运行时仍归插件所有。安装 Chrome
后不会生成 `plugin.chrome.node-repl`，项目解析使用
`anybox.node-repl`；卸载 Chrome 也不会删除这个 Anybox 内置 MCP。

## 10. Skill 集成

插件可以携带 skills：

```text
<plugin-root>/skills/<skill-name>/SKILL.md
```

发现规则：

- manifest `skills` 缺省为 `"skills"`。
- 可以声明多个 skill root。
- 每个 root 下只发现直接子目录。
- 子目录必须有 `SKILL.md`。
- 生成 ID：`plugin:<pluginID>:<skill-directory-name>`。

catalog 阶段会读取 `SKILL.md` frontmatter 生成预览。运行时 skill 发现由 `Skill.discoverPluginDocuments()` 调用 `Plugin.listInstalledPluginSkillRoots(pluginIDs)` 完成。

项目未选择某个插件时，该插件 skill 不进入当前会话可发现范围。`load_skill` 和 `read_skill_resource` 也会按当前项目的 selected plugin IDs 过滤。全局 Skill 页面和 `/api/skills/tree` 不展示插件 Skill；插件详情展示 Skill 名称、描述、ID、目录和随插件总开关变化的状态，并提供归属于插件页的只读目录浏览器。

Skill 浏览器遵循以下边界：

- Skill 行右键菜单提供“浏览 Skill 文件”，展开详情内同时保留一个可发现的同名按钮。
- 只有已安装且 package 可用的插件可以打开；插件总开关关闭不影响只读浏览。
- Agent 根据 `pluginID + skillID` 重新验证安装记录与 manifest 声明，不接受 Renderer 传入绝对目录。
- API 路径必须是使用 `/` 的规范相对路径，禁止绝对路径、盘符、反斜杠、空段、`.` 和 `..`。
- 真实路径必须始终留在 Skill 根目录及插件包内；符号链接不会出现在目录列表中，也不能作为读取路径。
- 子目录按需读取且文件夹优先排序；单目录最多返回 1000 项。
- 文本预览上限为 1 MiB，图片预览上限为 2 MiB；其他二进制文件只返回元信息。
- Renderer 默认打开 `SKILL.md`，Markdown 可切换阅读与源码模式，其他 UTF-8 文本、常见图片和不可预览文件分别使用对应只读状态。

## 11. 项目选择和工具暴露

安装插件只是写入全局安装记录和全局 MCP server 配置。项目级启用另走项目配置：

```text
selected_plugins = ["filesystem", "chrome"]
```

相关 API：

```text
GET /api/projects/:id/plugins
GET /api/projects/:id/plugins/selection
PUT /api/projects/:id/plugins/selection
```

项目选择时会经过 `Plugin.resolveEnabledInstalledPluginIDs()` 过滤：

- 插件必须已安装。
- 插件必须 enabled。
- 插件包不能 missing。
- ID 会 normalize 和去重。

项目只持久化独立 Skill/MCP 的选择和插件 ID。旧项目中残留的插件 Skill/MCP 子项选择在读取时忽略，并在下一次保存时自然清理。

解析项目能力时：

1. 读取项目自己的独立 Skill/MCP 选择。
2. 读取项目 `selected_plugins`。
3. 通过显式 plugin owner 与已安装 binding 映射找到插件 MCP，并同时应用插件总开关和 `mcpServerEnabled` 子开关。
4. 找到 selected plugins 的 `connectorRequirementIDs`，转换为平台 connector MCP server ID。
5. 将插件全部 Skill 与独立 Skill 选择合并；独立 Skill 选择不会抑制插件 Skill。
6. 返回项目独立 MCP + 当前有效的插件 MCP + 共享 connector requirement MCP。

最终工具注册阶段，MCP manager 会连接这些 server 并把工具暴露成模型工具 ID：

```text
mcp__plugin_filesystem__read_file
```

工具 ID 由 server ID 和 MCP tool name 规范化组合，避免与内置工具或其他 MCP server 工具冲突。

## 12. 设置 API 和桌面端桥接

Agent 设置 API：

```text
GET    /api/plugins/catalog
GET    /api/plugins/installed
PUT    /api/plugins/installed/:pluginID
PATCH  /api/plugins/installed/:pluginID
PATCH  /api/plugins/installed/:pluginID/mcp/:serverID
DELETE /api/plugins/installed/:pluginID
GET    /api/plugins/installed/:pluginID/diagnostic
GET    /api/plugins/installed/:pluginID/skills/:skillID/entries?path=<relative-directory>
GET    /api/plugins/installed/:pluginID/skills/:skillID/file?path=<relative-file>

GET    /api/plugins/installed/:pluginID/connectors
PUT    /api/plugins/installed/:pluginID/connectors/:appID/api-key
DELETE /api/plugins/installed/:pluginID/connectors/:appID/api-key
POST   /api/plugins/installed/:pluginID/connectors/:appID/auth/flows
GET    /api/plugins/installed/:pluginID/connectors/:appID/auth/flows/:flowID
DELETE /api/plugins/installed/:pluginID/connectors/:appID/auth/flows/:flowID
DELETE /api/plugins/installed/:pluginID/connectors/:appID/auth/session
GET    /api/plugins/installed/:pluginID/connectors/:appID/diagnostic
```

桌面端链路：

```text
Renderer UI
  -> window.desktop.installPlugin(...)
  -> preload invokeDesktop(...)
  -> main ipc handleDesktopIpc(...)
  -> requestAgentJSON("/api/plugins/installed/:pluginID")
  -> anyboxagent settings route
  -> Plugin.install/update/remove/...
```

前端状态和交互主要在 `use-settings-page.ts` 和 `PluginsPage.tsx`。前端不会直接读取插件包、不会启动插件 runtime，也不会直接处理密钥；这些都由 Agent 端完成。

插件 MCP 控制接口只接受 `enabled` 和 `toolPolicies`。manifest 定义的 command、URL、环境变量、headers 等运行信息在插件详情只读；server 不属于路径中的插件时返回 `PLUGIN_MCP_NOT_FOUND`。

Skill 文件浏览通过 `listInstalledPluginSkillEntries` 和 `readInstalledPluginSkillFile` 两个桌面 IPC 方法桥接到上述只读 Agent API。响应只包含 Skill 内相对路径、文件元信息以及受大小限制的文本内容或图片 data URL，不返回本地绝对路径。

## 13. 诊断

插件诊断分两类：

- 普通 MCP server：复用 `GET /api/mcp/servers/:serverID/diagnostic`
- 插件自带 connector：`GET /api/plugins/installed/:pluginID/connectors/:appID/diagnostic`

诊断调用 `Mcp.diagnoseServer(server)`：

- 尝试连接 MCP server。
- 调用 `tools/list`。
- 返回工具数量、工具名、工具 annotation、风险提示、推荐 policy 和当前配置 policy。
- 诊断结果缓存到安装记录的 `lastDiagnostic` 或 `lastConnectorDiagnostics`。

## 14. Filesystem 插件示例

`filesystem` 插件是普通 `mcpServers` 模式的代表：

```text
plugins/Anybox-Plugins/filesystem/
  .anybox-plugin/plugin.json
```

manifest 声明：

- 插件 ID：`filesystem`
- 未声明具名 server ID，因此生成全局 server ID：`plugin.filesystem`
- runtime：`stdio`
- command：`npx`
- args：`-y @modelcontextprotocol/server-filesystem ${ROOT_PATH}`
- 安装配置：必填目录字段 `ROOT_PATH`

插件本身不携带 `server.js`；MCP manager 按 manifest 启动上游 Filesystem MCP server，并通过 `tools/list` 获取真实工具定义。插件页中的 `read_file`、`write_file` 和 `list_directory` 只用于安装前能力与风险预览。

## 15. 测试覆盖

主要回归测试：

```text
packages/anyboxagent/Test/plugin.test.ts
```

覆盖范围包括：

- catalog 读取和风险过滤。
- 本地插件源安装后不删除源包。
- 远程 registry metadata 加载和缓存回退。
- schema v3 Catalog Registry 的整体验证、稳定 URL 和 ZIP 大小/SHA-256 校验。
- registry-only metadata 的不可安装状态。
- 普通 MCP 插件安装、禁用、诊断、卸载。
- critical 风险插件安装拒绝。
- 平台 connector 与插件 `connectorRequirements`。
- Anybox 内置 MCP 与插件 `mcpRequirements`，包括旧 Node REPL Connector 配置迁移。
- Browser/Gmail 内置插件通过平台 connector 工作。
- 插件 manifest 中 MCP、skills、connectors/apps 的解析。
- 插件 Skill 运行时发现，以及从全局 Skill 文件树中隐藏。
- 插件 Skill 目录的所有权校验、路径穿越拒绝、文本/图片预览，以及 Renderer 右键浏览、懒加载和不可用状态。
- MCP owner/binding 回填、子项偏好持久化、总开关暂停/恢复和 tool policy 保留。
- 项目选择插件后自动合并内部 Skill/MCP，并过滤旧的插件子能力选择。
- API key connector 的密钥外置存储和运行时注入。
- 本地 stdio connector 的包内路径约束。
- OAuth connector 的 PKCE、动态注册、scope 校验、token refresh。
- Calendar 插件的普通 MCP server 安装和 ToolRegistry 暴露。

## 16. 当前限制和注意事项

- 独立 `connectors/<id>/connector.json` 扫描尚未实现，connector 声明目前写在 `plugin.json`。
- 插件签名、信任链、安装时安全审计 UI 还未完整落地。
- `apps`、`plugin-app:`、`plugin.<id>.app.<appID>` 仍兼容，但新插件应使用 `connectors`、`plugin-connector:`、`plugin.<id>.connector.<connectorID>`。
- manifest 中的 `tools` 是展示和 policy hint，不是最终工具真相；真实工具来自 MCP `tools/list`。
- 插件安装后不会自动对所有项目生效，必须通过项目插件选择启用。
- 普通 `mcpServers` 的路径不会像 plugin-owned local connector 那样做同等强度的包内路径约束；插件包来源和安装审核仍需要补强。
- `critical` 风险插件可以进入 catalog 展示，但安装会被拒绝。
- 插件自带 connector 的 secret 不应写入 manifest，只能写 placeholder，并通过安装配置、API key 保存或 OAuth 流程进入 credential store。

## 17. 调试建议

使用独立本地插件来源列出 catalog：

```powershell
cd C:\Projects\Anybox\packages\anyboxagent
$env:ANYBOX_PLUGIN_LOCAL_DIR = "C:\path\to\plugin-source-root"
$env:ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "off"
bun -e "import * as Plugin from './src/plugin/plugin.ts'; console.log(JSON.stringify(await Plugin.listCatalog(), null, 2))"
```

直接调试 Anybox 仓库中的源码插件时，显式设置：

```powershell
$env:ANYBOX_PLUGIN_INCLUDE_SOURCE_PACKAGES = "1"
```

生产一致性验证必须保持该变量为 `0`，让开发版和正式版都读取稳定的远程 Registry。

运行插件系统测试：

```powershell
cd C:\Projects\Anybox
pnpm plugins:index:check
pnpm plugins:catalog:test

cd packages\anyboxagent
bun test Test/plugin.test.ts
```

准备和复验正式仓库目录：

```powershell
cd C:\Projects\Anybox
pnpm plugins:catalog:prepare
pnpm plugins:catalog:verify
```

检查某个插件安装后生成的 MCP server：

```powershell
cd C:\Projects\Anybox\packages\anyboxagent
bun -e "import * as Config from './src/config/config.ts'; console.log(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, 'plugin.filesystem'))"
```

常见排查顺序：

1. `plugin.json` 是否是合法 JSON，且顶层字段被 schema 支持。
2. 新插件是否采用 `<plugin-id>/.anybox-plugin/plugin.json`；兼容输入或版本目录是否确有必要。
3. catalog 是否能看到插件，`installable` 是否为 `true`。
4. required `configFields` 是否已提供或有 defaultValue。
5. 安装记录里 `mcpServerIDs`、`connectorIDs`、`skillIDs` 是否符合预期。
6. 全局 MCP server 配置是否生成。
7. 项目 `selected_plugins` 是否包含该插件。
8. 对 plugin-owned connector，credential store 中是否已有 API key 或 OAuth session。
9. 对 stdio runtime，命令、工作目录、参数路径是否能在本机启动。
10. 运行诊断接口确认 MCP server 是否能返回 `tools/list`。
11. 正式目录是否通过 `plugins:catalog:verify`，且 `.catalog` 已作为普通 Git 文件提交。
