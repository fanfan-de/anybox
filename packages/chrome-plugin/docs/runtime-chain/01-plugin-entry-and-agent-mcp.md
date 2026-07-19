# 节点 01：插件入口与通用 Connector

[返回总览](./README.md) · [下一节点：通用 Node REPL](./02-node-repl-mcp-server.md)

Chrome manifest 只声明对平台 `node-repl/default` 的依赖，不注册 Chrome 专属 MCP
Server。安装插件不会向 AnyboxAgent 注入 Browser tools 或 Browser routes。

模型使用 Chrome Skill 时，LLM 循环从已加载 Skill 的绝对路径推导插件根目录，然后通过
通用 `js` 工具导入：

```js
const { setupBrowserRuntime } = await import(
  "<absolute plugin root>/scripts/browser-client.mjs"
)
await setupBrowserRuntime({ globals: globalThis })
```

是否以及何时导入由 Agent 的工具循环决定，不是 AnyboxAgent 启动时写死的预加载环节。
