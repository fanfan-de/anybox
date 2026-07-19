# 节点 14：生命周期、安全限制与诊断

[上一节点：端到端时序](./13-end-to-end-walkthroughs.md) · [返回总览](./README.md)

## 生命周期

| 组件 | 启动 | 停止/恢复 |
| --- | --- | --- |
| 通用 Node REPL | Agent 首次调用 `js` | `js_reset` 只清全局状态 |
| Browser Client | LLM 循环动态导入 | 随 Node 会话；可重建 Host 连接 |
| Browser Host | Browser Client 按需启动 | 无连接空闲 15 分钟或收到信号 |
| Rust Native Host | Extension `connectNative` | Chrome 关闭 Port |
| Extension | Chrome Service Worker 生命周期 | 自动重连 Native Host |

## 已实现的边界

- runtime 与 native-host 使用独立 endpoint、role 和 proof；
- challenge、broker instance、HMAC transcript 与 request ID 校验；
- Unix 目录 `0700`、socket/bootstrap `0600`；
- Extension ID、Contract version、capability、params/result 校验；
- raw JavaScript 和 CDP 默认不可用；
- Agent core 不包含 Chrome Gateway、协议或 host service。

## 当前限制

- 尚未验证 IPC 对端 PID/SID/uid 或二进制签名；
- runtime proof 在 Browser Host 生命周期内有效，依赖同用户文件 ACL；
- ownership 与逐动作审批仍未完整实现；
- Host 目前是用户级单实例，不是每项目独立实例。

## 诊断顺序

1. 确认插件含 `scripts/browser-client.mjs` 与 `scripts/browser-host.mjs`；
2. 调用 `chrome.status()`；
3. 若 Host 不可用，检查 runtime bootstrap 与 Browser Host stderr；
4. 若 Host 可用但 Extension 未连接，检查 Native Host 安装、Chrome Extension popup 和
   Rust Host stderr；
5. Contract 不兼容时升级插件与 Extension，不要绕过版本校验。
