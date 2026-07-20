# 节点 14：生命周期、安全限制与诊断

[上一节点：端到端时序](./13-end-to-end-walkthroughs.md) · [返回总览](./README.md)

## 生命周期

| 组件 | 启动 | 停止/恢复 |
| --- | --- | --- |
| 通用 Node REPL | Agent 首次调用 `js` | `js_reset` 只清全局状态 |
| Browser Client | LLM 循环动态导入 | 随 Node 会话；可重建 Host 连接 |
| Browser Host | Browser Client 按需启动 | 无连接空闲 15 分钟或收到信号 |
| Google Chrome | 显式 `ensureReady({ launch: true })` 按需启动 | 由用户和操作系统管理 |
| Rust Native Host | Extension `connectNative` | Chrome 关闭 Port |
| Extension | Chrome Service Worker 生命周期 | 自动重连 Native Host |

## 已实现的边界

- runtime 与 native-host 使用独立 endpoint、role 和 proof；
- challenge、broker instance、HMAC transcript 与 request ID 校验；
- runtime hello 对 Agent 的浏览器审批验签公钥做 HMAC 绑定；
- v2 命令使用短时、一次性、请求绑定的 Ed25519 审批 receipt；
- Unix 目录 `0700`、socket/bootstrap `0600`；
- Extension ID、Contract version、capability、params/result 校验；
- raw JavaScript 和 CDP 默认不可用；
- Agent core 不包含 Chrome Gateway、协议或 host service。

## 当前限制

- 尚未验证 IPC 对端 PID/SID/uid 或二进制签名；
- runtime proof 在 Browser Host 生命周期内有效，依赖同用户文件 ACL；
- Host 目前是用户级单实例，不是每项目独立实例。

`peerProcessIdentityVerified: false` 描述的是上面的 PID/SID/uid 限制，不是命令授权
开关；浏览器审批链路应查看 `authorizationVerificationAvailable`。

## 诊断顺序

1. 确认插件含 `scripts/browser-client.mjs` 与 `scripts/browser-host.mjs`；
2. 调用 `agent.browsers.readiness()` 获取只读结构化状态；
   `authorizationVerificationAvailable: false` 表示当前 Node REPL 没有把 Agent 公钥
   绑定到 runtime hello，应重载/升级 Chrome 插件运行时，而不是重连 Extension；
3. 在用户明确要求 Chrome 时调用一次
   `agent.browsers.ensureReady({ launch: true })`，先探测 Native Host 认证链路，再允许
   Chrome 冷启动并有限等待 Extension 握手；
4. `needs-extension`：Chrome 已打开，检查 Extension 是否安装或启用；
5. `needs-native-host-repair`：修复插件安装和 Native Host 注册；
6. `needs-extension-update`：升级插件与 Extension，不要绕过 Contract 版本校验；
7. `browser-not-installed`：安装 Chrome 或通过 `ANYBOX_CHROME_EXECUTABLE` 指定可执行文件；
8. `backend-unavailable`：检查 runtime bootstrap 与 Browser Host stderr。
