# 节点 03：Browser Client Runtime

[上一节点：通用 Node REPL](./02-node-repl-mcp-server.md) ·
[返回总览](./README.md) ·
[下一节点：Browser Client ↔ Host IPC](./04-transport-worker-and-runtime-ipc.md)

`browser-runtime/src/browser-client.ts` 构建为插件 `scripts/browser-client.mjs`。初始化只在
新的 Node 会话执行一次，并把 `agent.browsers` 安装到当前全局对象。

Browser Client 负责：

- Backend 发现和 `BrowserContext` / `BrowserTab` 易用 API；
- 使用插件私有 Contract 做参数和结果的早期校验；
- 根据 Host 广告的 capability 生成 API 与动态文档；
- 将 `nodeRepl.requestMeta` 附加到 command；
- 禁止 raw page JavaScript、selector click/fill adapter 和 CDP。

默认 transport 由 `browser-host-client.ts` 实现。测试仍可显式注入 transport，但生产
路径不会调用 AnyboxAgent host service。
