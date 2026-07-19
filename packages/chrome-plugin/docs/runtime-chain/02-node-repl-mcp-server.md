# 节点 02：通用 Node REPL

[上一节点：插件入口](./01-plugin-entry-and-agent-mcp.md) ·
[返回总览](./README.md) ·
[下一节点：Browser Client](./03-browser-client-runtime.md)

`packages/anyboxagent/connectors/node-repl/server.js` 是与业务无关的持久 Node 环境。它提供：

- `js`、`js_reset`、`js_add_node_module_dir`
- 动态 `import()` 与普通 Node 模块能力
- `nodeRepl.write()`、`emitImage()`、`setResponseMeta()`
- 当前 tool call 的只读 `nodeRepl.requestMeta`

它不提供 `requestHost`、Chrome capability、Browser IPC 凭据或 Native Host 逻辑。
`requestMeta` 只包含通用的 `sessionID`、`messageID`、`toolCallID`，供被导入模块在需要时
关联调用上下文。
