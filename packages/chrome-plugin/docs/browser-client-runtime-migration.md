# Browser Client Runtime 0.8.0 迁移说明

## 结论

Chrome 插件已经不再拥有 Node REPL。0.8.0 的结构改为：

```text
Agent 加载 Chrome Skill
  → 调用 Anybox 平台内置 connector.node-repl.default/js
  → Agent 在通用 Node 环境中动态导入插件 scripts/browser-client.mjs
  → Browser Client 调用 nodeRepl.requestHost("browser", request)
  → Anybox Agent 校验当前 tool call 的一次性 host token
  → Agent Browser Contract / Policy / Bridge
  → Rust Native Messaging Host
  → Chrome Extension
```

这与 Codex 的核心思路一致：Node REPL 是可复用的通用执行环境，浏览器业务由 Skill
指导 Agent 在需要时动态导入，而不是由 Chrome 专属 Node Server 预加载。

## 所有权边界

| 组件 | 当前所有者 | 职责 |
|---|---|---|
| `connectors/node-repl/server.js` | Anybox Agent | 持久 JavaScript、模块解析、图片输出、通用宿主请求 |
| `browser-client.mjs` | Chrome 插件 | Browser API、Contract 预检、Native Host bootstrap |
| `runtime-host.ts` | Anybox Agent | 解析 browser host request，绑定可信 tool context |
| `command-gateway.ts` | Anybox Agent | 权威参数、能力和策略校验 |
| `BrowserExtensionBridge` | Anybox Agent | 与已认证 Extension 连接交换命令与结果 |
| Rust Native Messaging Host | Chrome 插件 | Chrome native stdio 与 Agent Native Host IPC 的桥接 |
| Chrome Extension | Chrome 插件 | 标签页和页面动作的实际执行端 |

## 通用 Node REPL

平台定义为 `connector:node-repl:default`，生成的 MCP Server ID 是
`connector.node-repl.default`。它只公开：

- `js`
- `js_reset`
- `js_add_node_module_dir`

`nodeRepl` helper 包含通用目录、输出、图片和 `requestHost(service, request)`。它不包含：

- Chrome Gateway 或 Browser IPC Client；
- Native Host 安装逻辑；
- Browser IPC endpoint、proof 或 token；
- `getCapability()`；
- `anybox.browser-runtime`；
- 自动导入的 `browser-client`、`agent` 或 `setupBrowserRuntime`。

Node REPL 的 cwd 由当前项目决定，不再等于插件安装目录。Chrome Skill 必须从 Skill
加载结果中的绝对 `SKILL.md` 路径推导插件根目录，再通过绝对文件 URL 导入
`scripts/browser-client.mjs`。

## 宿主服务协议

`nodeRepl.requestHost()` 使用 MCP stdio 上的反向 JSON-RPC 请求：

```text
anybox/node-repl/host-request
```

Node Server 不理解 `browser` 的业务含义。Anybox MCP Client 只为平台持有的 Node REPL
安装该请求处理器，并为每次 `js` 调用生成一次性随机 token。Node Server 从 MCP `_meta`
中取得 token，但不会把 token 暴露到 `nodeRepl.requestMeta`。Agent 收到反向请求时必须：

1. 确认来源是 `connector.node-repl.default`；
2. 确认 token 仍属于正在执行的外层 tool call；
3. 使用 token 关联的可信 session/message/toolCall context；
4. 拒绝未注册的 service；
5. 把 browser 请求交给 Agent 内的 Browser Runtime Host。

模型或 Browser Client 传入的请求不能覆盖可信 context。

## Native Host

Native Host 仍由 Chrome 插件交付。Browser Client 第一次通过宿主 transport 发请求前，
动态加载同目录的 `native-host-bootstrap.js`。安装器会读取
`ANYBOX_AGENT_DATA_DIR`，确保其 bootstrap 路径和托管 Anybox Agent 的
`<data-dir>/state/browser-ipc` 一致。

通用 Node Connector 不执行 Native Host 注册，也不接收 Browser IPC 环境变量。

## 删除的 Chrome 专属运行时

以下文件已从源码包和生成包删除：

- `scripts/node-repl-server.js`
- `scripts/browser-gateway-worker.js`
- `scripts/browser-ipc-client.cjs`

打包校验会拒绝它们重新进入 Chrome 插件。

## 安全边界

- Browser Client 的本地 schema/capability 检查只用于早期报错。
- Anybox Agent 仍对每条命令执行权威 Browser Contract 与 policy 校验。
- Raw page JavaScript、selector click/fill adapter 和 full CDP 仍不可用。
- Browser IPC secrets 会从所有 MCP 子进程环境中剔除。
- Node REPL 本身属于高风险通用代码执行能力；插件依赖不会降低该风险等级。
- Native Host 仍通过一次性 bootstrap proof 和本机 ACL 认证到 Agent Gateway。

## 版本

| 组件 | 版本 |
|---|---:|
| Chrome 插件 | `0.8.0` |
| Browser Client Runtime | `0.5.0` |
| Anybox Node REPL Server | `0.1.0` |
| Browser Contract | `1` |
| Browser IPC | `1` |

## 回归范围

当前回归覆盖：

- 通用 Node REPL 的持久状态、reset、request metadata 和反向 host request；
- Browser IPC secret 不进入任何 MCP 子进程；
- Browser Client 通过 `requestHost("browser", …)` 工作；
- Agent context 被保留到 Extension command；
- Chrome 包不再包含三个旧运行时文件；
- legacy Chrome 插件升级到 0.8.0 后使用平台 Node REPL requirement；
- 插件卸载后平台 Node REPL 仍保留；
- Native Host 安装器兼容 `ANYBOX_AGENT_DATA_DIR`。
