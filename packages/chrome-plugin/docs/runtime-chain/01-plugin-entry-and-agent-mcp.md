# 节点 01：插件入口与 Anybox Connector requirement

[总览](./README.md) · [下一节点：通用 Node REPL](./02-node-repl-mcp-server.md)

Chrome 0.8.0 清单不再包含 `mcpServers`。它声明：

```json
{
  "connectorRequirements": [
    {
      "connector": "node-repl",
      "runtimeIDs": ["default"],
      "tools": ["js", "js_reset", "js_add_node_module_dir"],
      "required": true
    }
  ]
}
```

Anybox 安装插件时只记录该 requirement。项目选择 Chrome 插件后，
`resolveProjectMcpServers()` 把平台的 `connector.node-repl.default` 加入项目运行时。

该 MCP Server 的 owner 是：

```json
{
  "kind": "anybox",
  "bindingID": "connector.node-repl.default"
}
```

因此：

- 卸载 Chrome 插件不会删除 Node REPL；
- 其他 Skill 或插件可以复用同一类通用环境；
- Node REPL cwd 是当前项目或 worktree，而不是 Chrome 插件目录；
- Chrome 插件版本升级不再迁移一个插件私有 MCP 子进程。

Chrome Skill 加载结果包含绝对 `SKILL.md` 路径。Agent 从
`<plugin-root>/skills/chrome/SKILL.md` 向上两级得到插件根目录，再在 `js` 中导入
`<plugin-root>/scripts/browser-client.mjs`。

如果该文件不存在，问题是 Chrome 插件包不完整；不要改为导入同名 npm 包或内置库。
