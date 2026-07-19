# 节点 02：Anybox 通用 Node REPL MCP Server

[上一节点](./01-plugin-entry-and-agent-mcp.md) ·
[下一节点：Browser Client](./03-browser-client-runtime.md)

实现位于：

```text
packages/anyboxagent/connectors/node-repl/server.js
```

桌面 Agent 构建时会把它复制到：

```text
agent-runtime/connectors/node-repl/server.js
```

## 工具

- `js`：在持久 globals 中执行支持 top-level await 的 JavaScript。
- `js_reset`：重建 globals。
- `js_add_node_module_dir`：扩展 CommonJS `NODE_PATH`。

## 通用 helper

`nodeRepl` 提供 cwd、homeDir、tmpDir、模块路径、requestMeta、response meta、文本输出、
图片输出和：

```js
await nodeRepl.requestHost(service, request)
```

`requestHost` 只描述“向 Anybox 宿主请求一个已注册服务”。Node Server 不包含 service
实现，也不理解 `browser`。

## 不属于 Node REPL 的内容

- Browser Gateway Worker；
- Browser IPC Client；
- Native Host 注册；
- Chrome extension ID；
- Browser IPC endpoint、broker ID 或 proof；
- `getCapability()`；
- `anybox.browser-runtime`；
- 自动加载的 Browser Client 或 `agent`。

所有 `ANYBOX_BROWSER_*` secret 会在 MCP Client 创建任何子进程前被剔除。

## 调用上下文

Anybox MCP Client 为每次 Node `js` 调用生成随机 host token，并通过 MCP `_meta`
交给 Node Server。Node Server 把 token 保存在当前异步调用上下文中；
`nodeRepl.requestMeta` 只公开 session/message/toolCall ID，不公开 token。

`requestHost` 只能在仍在执行的外层 tool call 内使用。外层调用结束后，Agent 删除 token，
迟到或伪造的反向请求会被拒绝。
