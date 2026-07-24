# Anybox 插件分发与验证

## 目录

1. 本地与受管理插件来源
2. 生产目录与开发索引
3. 远程 URL 兼容行为
4. 远程安装模型
5. 插件包安全
6. 验证流程
7. 迁移检查清单

## 本地与受管理插件来源

开发插件按以下顺序发现：

1. 已设置时使用 `ANYBOX_PLUGIN_LOCAL_DIR`；
2. 否则使用 Agent 数据目录中的 `plugins/local`。

受管理安装按以下顺序保存：

1. 已设置时使用 `ANYBOX_PLUGIN_INSTALL_DIR`；
2. 否则使用 Agent 数据目录中的 `plugins/installed`。

让 `ANYBOX_PLUGIN_LOCAL_DIR` 指向一个来源根目录，其直接子目录是各插件包。不要让 `ANYBOX_PLUGIN_INSTALL_DIR` 指向必须保留的 Git 工作区；卸载受管理插件时可能删除其中的插件包。

复制本地插件包时，目前会忽略以下常见开发目录：

```text
.cache, .git, .turbo, .vite-temp, node_modules
```

## 生产目录与开发索引

桌面正式版启动 Agent 时，会传入当前桌面版本对应的 GitHub Release 目录 URL：

```text
https://github.com/fanfan-de/anybox/releases/download/v<desktopVersion>/anybox-plugin-registry-v2.json
```

打开插件页时，Agent 先用一次请求拉取这份目录，从 `pluginCount` 和 `plugins` 得到插件总数、完整清单及每个插件的 ZIP 下载信息。每个条目都必须使用同一个 Release 标签下的 ZIP，并包含 `sha256` 和精确 `size`。Agent 会原子解析整份文件；任一条目无效都会返回 `PLUGIN_REGISTRY_UNAVAILABLE`，不会静默过滤成部分目录。成功目录会按 URL 和协议版本整体缓存；首次启动且 GitHub 不可达时没有目录可展示，至少成功拉取过一次后才可离线使用已验证缓存。

`plugins/Anybox-Plugins/index.json` 只用于开发清单和兼容 URL 导入，不是正式桌面的生产目录来源。它由以下命令生成和校验：

```powershell
pnpm plugins:index
pnpm plugins:index:check
```

开发索引中的 URL 直接指向规范 manifest：

```json
[
  "https://raw.githubusercontent.com/fanfan-de/anybox/master/plugins/Anybox-Plugins/example/.anybox-plugin/plugin.json"
]
```

新增仓库插件时：

- 让 URL 以 `/.anybox-plugin/plugin.json` 结尾。
- 把展开式插件包保存在 `plugins/Anybox-Plugins/<plugin-id>/`。
- 不要添加 `plugin.meta.json`。
- 不要提交生成的 ZIP 文件。
- 源 manifest 不添加顶层 `package` 字段；Release 打包器会把不可变的 ZIP 元数据写入生成目录。

即使解析器接受更广泛的 GitHub URL 形式，也必须遵循这套仓库规范。

## 远程 URL 兼容行为

远程生产目录、开发索引和手动导入 URL 必须使用 HTTPS。索引条目不允许包含查询参数或 fragment。桌面正式版会把 `ANYBOX_PLUGIN_REGISTRY_INDEX_URL` 设置为版本固定的 Release 目录 URL；独立 Agent 未配置时使用 GitHub `latest/download` 目录。开发或测试可以显式覆盖，也可以设为 `off`。缓存按 URL 和协议版本隔离。

运行时接受：

- 直接 `.anybox-plugin/plugin.json`；
- 直接根目录 `plugin.json`；
- 直接 `.codex-plugin/plugin.json`；
- 受支持的 GitHub `blob`、`tree` 和 `raw.githubusercontent.com` 插件包路径。

当 Registry 条目不是以 `/plugin.json` 结尾时，只有能够识别的 GitHub 插件包 URL 才会被规范化成 `.anybox-plugin/plugin.json` raw URL。其他主机上的普通目录 URL 会被拒绝。

必须区分：

- **仓库规范：** 写入直接指向规范 manifest 的 URL；
- **运行时能力：** 规范化受支持的 GitHub 插件包目录 URL。

## 远程安装模型

### 显式 ZIP

```json
{
  "package": {
    "type": "zip",
    "url": "https://downloads.example.com/example-1.0.0.zip",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "size": 12345
  }
}
```

正式目录中的 ZIP 元数据必须提供固定 GitHub Release HTTPS URL、匹配的 SHA-256 和精确字节数。手动导入的旧兼容元数据仍可省略 `size`。

### 手动 GitHub Tree

```json
{
  "package": {
    "type": "github-tree",
    "url": "https://github.com/example/anybox-plugins/tree/main/example"
  }
}
```

解析器也接受能够解析出 Repository、Ref 和路径的 GitHub raw 插件包根 URL。

### 手动导入时推导 GitHub Tree

如果手动导入的 manifest 托管在可识别的 GitHub 仓库中，而且没有显式 `package`，运行时会根据 manifest 所在的插件包根目录推导 `github-tree` 下载信息。这只是开发兼容能力；正式 v2 目录禁止 `github-tree`。

如果非 GitHub 远程 manifest 没有可用 `package`，也没有匹配的本地展开式插件包，它只能用于目录展示，不能安装。

## 插件包安全

安装 ZIP 时：

- 要求 SHA-256 匹配。
- 拒绝空包、超过 100 MiB 的包和超限解压内容。
- 拒绝重复路径、路径穿越、解压目录外路径和符号链接。
- 要求 ZIP 只有一个顶层插件目录，并且只有一个与预期插件 ID 和版本匹配的 manifest。
- 先复制并校验临时目录，再原子切换安装目录；失败时恢复旧版本。

安装 GitHub Tree 时：

- 分支名最多通过一次 GitHub Commit API 解析到 Commit SHA；已经是 SHA 时不访问 API。
- 从 `codeload.github.com` 一次下载固定 Commit 的仓库 ZIP，不再递归调用 Contents API。
- 拒绝符号链接、不安全路径、超限归档和不匹配的 manifest。
- 校验后原子切换安装目录。

长期规范中不要复制固定的数值上限；使用前先检查实时常量。

## 验证流程

### 1. 结构评审

确认：

- `.anybox-plugin/plugin.json` 存在；
- 插件包内容位于 `.anybox-plugin` 同级；
- JSON 可以解析；
- 所有必填字段存在；
- 没有不支持的顶层字段；
- 所有已声明路径都位于插件包内；
- 每个 Skill 根目录的直接子目录都包含 `SKILL.md`；
- 每个 Runtime Placeholder 都有明确来源；
- Connector 条目包含 `id`、`credential` 和 `runtime`；
- 源码中没有真实密钥；
- `critical` 风险是有意设置的。

### 2. 加载插件目录

在 `packages/anyboxagent` 中运行：

```powershell
$env:ANYBOX_PLUGIN_LOCAL_DIR = "C:\path\to\plugin-source-root"
$env:ANYBOX_PLUGIN_REGISTRY_INDEX_URL = "off"
bun -e "import * as Plugin from './src/plugin/plugin.ts'; console.log(JSON.stringify(await Plugin.listCatalog(), null, 2))"
```

确认目标插件出现，并检查：

- 规范化 ID 和版本正确；
- 名称、描述、分类和展示资源符合预期；
- MCP Server、Skill、Connector 和 Connector Requirement 符合预期；
- `installable` 状态正确。

在持久 Shell 中验证时，完成后恢复或隔离相关环境变量。

### 3. 安装与诊断

修改插件包或安装器时，验证：

- 安装或更新；
- 已安装路径中的 manifest 校验；
- 启用和禁用行为；
- 生成的 MCP Server ID；
- Connector 连接状态；
- MCP `initialize`、`tools/list` 和一个安全且有代表性的 `tools/call`；
- 卸载时清理运行状态，但不触碰来源插件包。

除非用户明确授权，不要仅为验证 manifest 而发起真实 OAuth 授权、使用生产密钥或调用破坏性工具。

### 4. 回归测试

修改插件系统代码后运行：

```powershell
Set-Location C:\Projects\Anybox
pnpm plugins:index:check
pnpm plugins:release:test

Set-Location C:\Projects\Anybox\packages\anyboxagent
bun test Test/plugin.test.ts
```

构建正式插件资产：

```powershell
node plugins/Anybox-Plugins/scripts/build-plugin-release.mjs `
  --desktop-version 0.1.34 `
  --commit <40-char-sha> `
  --out <output-directory>
```

输出必须恰好包含 59 个 `anybox-plugin-<id>-<version>.zip`、`anybox-plugin-registry-v2.json` 和 `anybox-plugin-release-manifest.json`。这些生成物不提交到 Git，也不塞进桌面安装器；目录和 ZIP 都作为同一 GitHub Release 的资产发布。

Internal RC 上传最终标签的 prerelease 后，发布工作流会从真实 Release URL 安装一个代表性 ZIP：

```powershell
bun run packages/anyboxagent/scripts/smoke-plugin-release-install.ts `
  <anybox-plugin-registry-v2.json> context7
```

该 smoke 必须读取完整 59 项目录、只下载一次不可变 ZIP，并拒绝访问 `api.github.com`。公开发布会在提升 prerelease 前后逐字节复核全部资产。

如果只修改插件包，优先执行有针对性的目录加载和安装验证。当插件包覆盖了新修改的解析器路径，或风险足以证明有必要时，再运行完整回归测试文件。

### 5. 文档漂移检查

Parser 或 Installer Schema 改变时，搜索并同步更新：

```text
.agents/skills/anybox-plugin/
plugins/Anybox-Plugins/anybox-plugin-development/docs/
plugins/Anybox-Plugins/index.json
具有代表性的内置插件 manifest
packages/anyboxagent/Test/plugin.test.ts
```

明确检查 Connector ID、Credential 要求、OAuth 字段、外部组件声明、Interface 本地化、Package 下载类型和 GitHub URL 规范化。

## 迁移检查清单

迁移旧 Fanfande、Codex 或仅含元数据的插件时：

1. 保留原始插件包，直到新格式通过验证。
2. 把 manifest 移动或生成到 `.anybox-plugin/plugin.json`。
3. 把运行时内容放在插件包根目录。
4. 把新的 Connector 声明从 `apps` 改为 `connectors`。
5. 把 Connector 的 `appID` 改为 `id`。
6. 添加必填的 `credential` 和 `runtime`。
7. 用受支持的 manifest 字段替换 `plugin.meta.json`。
8. 把相对于仓库根目录的路径假设改成相对于插件包根目录的路径。
9. 正式目录条目使用桌面 Release ZIP；本地展开式和 GitHub Tree 只用于开发或手动导入。
10. 验证目录、安装、生成 ID、密钥处理和卸载清理。
11. 确认没有消费者后再删除旧兼容文件。
