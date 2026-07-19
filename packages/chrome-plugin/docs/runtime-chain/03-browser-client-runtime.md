# 节点 03：Browser Client Runtime

[上一节点](./02-node-repl-mcp-server.md) ·
[下一节点：Host Service Bridge](./04-transport-worker-and-runtime-ipc.md)

源码是 `browser-runtime/src/browser-client.ts`，发行构建是插件内的
`scripts/browser-client.mjs`。

Agent 首次使用时执行：

```js
if (globalThis.agent?.browsers == null) {
  const { pathToFileURL } = require("node:url")
  const { setupBrowserRuntime } = await import(
    pathToFileURL("<absolute-plugin-root>/scripts/browser-client.mjs").href
  )
  await setupBrowserRuntime({ globals: globalThis })
}
```

这是 LLM 循环内的自主模块导入，不是 Node Server 写死的预加载步骤。

## Transport

没有显式 test transport 时，Browser Client 检查：

```js
nodeRepl.requestHost
```

每个 Runtime request 都转换为：

```js
await nodeRepl.requestHost("browser", request)
```

请求形态只有 `status`、`getInfo` 和 `command`。Browser Client 不知道 Agent IPC
endpoint，也不持有 proof。

第一次发出 host request 前，Browser Client 动态加载同目录
`native-host-bootstrap.js`，确保插件自带的 Rust Host 已为当前用户注册。

## API 与校验

`getInfo` 返回 backend capability、API Manifest 和 Documentation Manifest。
Browser Client 只暴露 backend 真正声明的命令，并在本地解析参数和结果。Agent 会再次
执行权威校验。

Raw page evaluation、selector click/fill adapter 和 full CDP 仍在 Browser Client
本地直接拒绝。
