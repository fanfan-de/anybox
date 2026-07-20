# Browser Client / Browser Host 迁移设计

## 目标

AnyboxAgent 只提供通用的持久 Node.js 环境。所有 Chrome 业务——Browser Client、
Browser Contract、策略、IPC Gateway、Extension Bridge、Native Host 与扩展——都由
Chrome 插件包拥有。

当前执行链：

```text
Agent
  → Anybox 通用 Node REPL
  → 动态导入插件 scripts/browser-client.mjs
  → 启动或复用插件 scripts/browser-host.mjs
  → 认证 runtime IPC
  → Browser Contract / Policy / Command Gateway
  → 认证 native-host IPC
  → Rust Native Messaging Host
  → Chrome Extension
```

Node REPL 不预加载 Chrome 模块，不包含 `requestHost`，也不认识 Browser Contract。
它只提供持久 JavaScript、动态模块导入、通用输出/图片能力与当前 tool call 的只读
`nodeRepl.requestMeta`。

## 所有权边界

| 组件 | 所有者 | 职责 |
| --- | --- | --- |
| `connectors/node-repl/server.js` | AnyboxAgent | 通用 Node 执行环境 |
| `browser-runtime` | Chrome 插件 | 模型侧 Browser API 与 Browser Host 客户端 |
| `browser-host` | Chrome 插件 | IPC、鉴权、策略、Contract 校验和 Extension Bridge |
| `shared` | Chrome 插件 | Browser Contract、Extension 与 IPC wire types |
| `browser-native-host` | Chrome 插件 | Native Messaging stdio 与本机 IPC 转发 |
| `browser-extension` | Chrome 插件 | Chrome API 命令执行 |

`packages/shared` 不再导出浏览器协议，`packages/anyboxagent/src` 不再包含 Browser
Gateway、Browser routes、Browser tools 或反向 MCP host-service。

## Browser Host 发现与启动

Browser Client 首次发起请求时读取当前用户私有的 runtime bootstrap。若文件缺失、
失效或 endpoint 不可连接，它用当前 Node 可执行文件启动同目录的
`browser-host.mjs`，等待新 bootstrap 并完成 challenge/HMAC 握手。

Browser Host 使用固定的用户级 Named Pipe（Windows）或 Unix Domain Socket
（macOS/Linux）。多个 Node 会话复用同一 Host；并发启动时只有一个进程取得 endpoint，
其余 Client 重新读取胜出进程的 bootstrap。

Browser Client 会把 AnyboxAgent 注入 Node REPL 的审批验签公钥加入 HMAC 保护的
runtime hello。Browser Host 按已认证连接保存公钥，challenge 与 receipt 都绑定该
连接密钥；Host 自身不从启动环境读取全局公钥，因此可安全跨 Agent/Node 会话复用。
Ed25519 私钥始终只驻留 AnyboxAgent。

runtime bootstrap 权限在 Unix 上为 `0600`，包含 Host 存活期间使用的 runtime proof。
Native Host 使用另一份短时、一次性 proof；认证成功后 Browser Host 删除它并在断线时
轮换。当前仍未验证对端 PID/SID/uid，因此 OS 用户边界和文件/endpoint ACL 是重要的
安全前提。

## 为什么 Browser Client 不承担全部业务

Browser Client 与 Browser Host 都在插件包内，但职责不同：

- Browser Client 在模型的持久 Node 会话中，负责易用 API、早期校验和上下文透传；
- Browser Host 是隔离进程，集中拥有共享的 Native Host endpoint、最终策略与状态；
- Chrome Extension 只接受经过 Host Contract/Policy 边界的命令；
- Host 崩溃或升级时，Client 可以重新发现并连接，不必重置整个 Node 会话。

因此业务所有权属于插件，同时最终鉴权与 Chrome 桥接不与模型执行上下文混在同一进程。

## 已删除的旧链路

- Chrome 专属 `node-repl-server.js`
- `nodeRepl.requestHost("browser", ...)`
- AnyboxAgent `mcp/host-service.ts`
- AnyboxAgent `src/browser-extension/*`
- AnyboxAgent Browser HTTP routes 与 `browser-tools.ts`
- `@anybox/shared/browser-*` exports

打包边界测试会阻止这些路径重新进入 Agent core，并要求最终插件同时携带
`browser-client.mjs`、`browser-host.mjs` 和本机 IPC listener。
