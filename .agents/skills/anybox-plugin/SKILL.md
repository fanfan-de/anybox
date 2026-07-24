---
name: anybox-plugin
description: 构建、说明、迁移、评审或验证 Anybox 插件包及其 .anybox-plugin/plugin.json 清单。适用于 Codex 需要创建或更新插件目录、MCP Server、内置 Skill、插件自有 API Key 或 OAuth Connector、平台 Connector 依赖、外部组件 JSON、Registry 条目、ZIP 或 GitHub Tree 分发、生成 ID，或诊断 Anybox 插件目录与安装问题。
---

# Anybox 插件规范

使用当前 Anybox 运行时格式。不要把历史 Fanfande 格式或旧的 `fanfande-plugin-structure` Skill 当作权威规范。

## 确定事实来源

做出重要的插件格式判断前，按以下顺序检查目标仓库中的实时内容：

1. `packages/anyboxagent/src/plugin/plugin.ts`
2. `packages/anyboxagent/Test/plugin.test.ts`
3. `packages/anyboxagent/src/connector/connector.ts`
4. `plugins/Anybox-Plugins/index.json`
5. 当前内置插件的 `.anybox-plugin/plugin.json` 示例
6. `plugins/Anybox-Plugins/anybox-plugin-development/docs/anybox-third-party-plugin-development.md`
7. 本 Skill 的参考文档

运行代码优先于测试，测试优先于说明文档，目标仓库优先于既有假设。如果实时解析器与本 Skill 不一致，遵循解析器并报告规范漂移。除非用户明确要求修改插件格式本身，否则不要为了让某个插件通过而修改解析器。

## 按需读取参考文档

- 创建、迁移或完整评审插件时，读取 [manifest-format.md](references/manifest-format.md)。
- 插件声明 MCP Server、自有 Connector、OAuth、API Key 或平台 Connector 依赖时，读取 [connectors-and-mcp.md](references/connectors-and-mcp.md)。
- 处理本地来源、安装、Registry 条目、ZIP、GitHub URL、发布或验证时，读取 [distribution-and-validation.md](references/distribution-and-validation.md)。

面对范围很窄的问题时，不要加载无关参考文档。

## 执行流程

1. 判断任务属于包结构、清单编写、运行时接入、分发、迁移还是诊断。
2. 找到插件包根目录。把 `.anybox-plugin` 视为元数据目录，而不是包根目录。
3. 对每项高级能力检查实时 schema，并至少查看一个当前内置插件示例。
4. 在 `<plugin-root>/.anybox-plugin/plugin.json` 创建或更新规范清单。
5. 把 `scripts`、`skills`、`connectors`、`docs` 和 `assets` 放在 `.anybox-plugin` 同级。
6. 使用严格 JSON。遇到不支持的顶层字段时应报错，不要假设解析器会忽略。
7. 保证所有包内相对路径都留在插件包中。拒绝路径穿越、应使用相对路径处的绝对路径，以及分发包中的符号链接。
8. 不要把密钥写入源码。声明 placeholder 和 credential 元数据，由 Anybox 保存并注入真实密钥。
9. 按变更风险验证目录加载和安装行为。
10. 修改插件系统代码时，在同一项变更中同步更新测试、开发文档和本 Skill。

## 强制规则

- 为新 Anybox 插件生成 `.anybox-plugin/plugin.json`。
- 仅把根目录 `plugin.json` 和 `.codex-plugin/plugin.json` 当作兼容输入。
- 不要生成 `.fanfande-plugin/plugin.json` 或 `plugin.meta.json`。
- 根据规范化后的 manifest `name` 生成插件 ID，并让文件夹、manifest 名称和 Registry 路径保持一致。
- 新插件自有 Connector 使用 `connectors[].id`；把 `connectorID` 和 `appID` 视为兼容别名。
- 规范 Connector 条目必须同时包含 `credential` 和 `runtime`；`configFields` 只能作为额外配置。
- 优先使用 `connectors`，不要为新插件使用旧的 `apps` 字段。
- 把 `commands` 和 `agents` 视为保留兼容字段，不要声称当前运行时会执行它们。
- 开发 Registry 使用精确的 manifest URL；正式 Registry 从同版本 GitHub Release 动态拉取，条目只使用不可变 Release ZIP。
- 除非确实希望阻止安装，否则不要把风险标记为 `critical`。
- 迁移或验证期间保留用户文件和工作区中的无关改动。

## 输出评审结果

评审时把发现分为：

1. 阻止解析或安装的 schema 错误；
2. 导致执行失败的 runtime 或 credential 错误；
3. 安全与打包风险；
4. 应现代化的兼容结构；
5. 可选的 Marketplace 元数据改进。

为重要结论指出对应的实时来源。如果没有运行验证，必须明确说明。
