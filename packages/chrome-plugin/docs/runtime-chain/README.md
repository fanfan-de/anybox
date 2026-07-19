# Anybox Chrome 0.8.0 当前运行链路

本文档描述已经落地的链路，不把未来设计当作当前能力。

```mermaid
flowchart LR
    S["Chrome Skill"] --> N["Anybox 通用 Node REPL"]
    N --> C["插件 Browser Client"]
    C --> H["MCP Host Service Bridge"]
    H --> P["Agent Contract / Policy / Command Gateway"]
    P --> B["Browser Extension Bridge"]
    B --> G["Native Host IPC Gateway"]
    G --> R["Rust Native Messaging Host"]
    R --> E["Chrome Extension"]
```

## 核心变化

- Chrome 插件不再声明或携带 MCP Server。
- `connector.node-repl.default` 由 Anybox Agent 平台提供。
- Agent 根据 Skill 在首次使用时动态导入插件的 `scripts/browser-client.mjs`。
- Browser Client 使用通用 `nodeRepl.requestHost("browser", request)`。
- 通用 Node 进程不接收 Browser IPC proof，不包含 Chrome Gateway、Native Host
  bootstrap 或 `anybox.browser-runtime` capability。
- Native Host bootstrap 属于 Browser Client；命令权威校验属于 Agent。

## 版本

| 组件 | 版本 |
|---|---:|
| Chrome 插件 | `0.8.0` |
| Browser Client | `0.5.0` |
| Anybox Node REPL | `0.1.0` |
| Browser Contract | `1` |
| Browser IPC | `1` |

## 节点

| 节点 | 文档 | 关注点 |
|---|---|---|
| 01 | [插件入口与 Connector requirement](./01-plugin-entry-and-agent-mcp.md) | 插件怎样获得平台 Node REPL |
| 02 | [通用 Node REPL](./02-node-repl-mcp-server.md) | 哪些能力属于 Anybox 平台 |
| 03 | [Browser Client Runtime](./03-browser-client-runtime.md) | Agent 怎样自主导入模块 |
| 04 | [Host Service Bridge](./04-transport-worker-and-runtime-ipc.md) | 如何替代 capability + Worker |
| 05 | [Agent IPC Gateway](./05-agent-ipc-listener-and-gateway.md) | Native Host 怎样认证到 Agent |
| 06 | [Contract、Policy 与 Command Gateway](./06-contract-policy-and-command-gateway.md) | 权威浏览器命令边界 |
| 07 | [Browser Extension Bridge](./07-browser-extension-bridge.md) | Agent 与 Extension 的命令关联 |
| 08 | [Native Host 注册与 bootstrap](./08-native-host-registration-and-bootstrap.md) | Browser Client 如何确保 Host 已注册 |
| 09 | [Rust Native Messaging Host](./09-rust-native-messaging-host.md) | IPC 与 Chrome stdio 桥接 |
| 10 | [Extension Service Worker](./10-extension-service-worker-and-client.md) | 扩展连接与重连 |
| 11 | [Extension Command Executor](./11-extension-command-executor.md) | 浏览器动作实现 |
| 12 | [Content、Overlay 与 Popup](./12-content-overlay-and-popup.md) | 页面辅助与状态 UI |
| 13 | [端到端示例](./13-end-to-end-walkthroughs.md) | 初始化、列表、截图 |
| 14 | [生命周期、安全与调试](./14-lifecycle-security-limits-and-debugging.md) | reset、断线与边界判断 |

## 已删除的旧链路

0.7.0 的以下插件文件不再存在：

```text
scripts/node-repl-server.js
scripts/browser-gateway-worker.js
scripts/browser-ipc-client.cjs
```

Agent 的 Browser IPC Gateway 仍服务 Native Host，并暂时保留 runtime role 兼容协议；
Browser Client 0.5.0 不再通过 runtime role 访问 Agent。
