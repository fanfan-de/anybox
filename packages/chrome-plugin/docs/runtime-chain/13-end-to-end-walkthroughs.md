# 节点 13：端到端时序

[上一节点：Overlay 与 Popup](./12-content-overlay-and-popup.md) ·
[返回总览](./README.md) ·
[下一节点：生命周期与安全](./14-lifecycle-security-limits-and-debugging.md)

## 首次使用

```text
Agent 调用通用 Node REPL js
→ 动态 import 插件 browser-client.mjs
→ Browser Client 发现不到可用 Host
→ 启动同目录 browser-host.mjs
→ Browser Host 绑定两条本机 IPC endpoint 并发布 runtime bootstrap
→ Client 完成 runtime challenge/HMAC
→ Client 安装插件 Rust Native Host
→ Extension connectNative
→ Rust Host 完成 native-host challenge/HMAC
→ Extension hello / capability 协商
→ agent.browsers.getDefault() 返回 BrowserContext
```

## 一条命令

```text
tab.snapshot()
→ Browser Client 预检 params/capability
→ runtime.request(command + requestMeta)
→ Browser Host Contract / Policy / Command Gateway
→ Extension Bridge
→ Rust Host
→ Extension Service Worker
→ Chrome API
→ result 沿原链返回并再次通过 Contract 校验
```

Host 断线时 Client 丢弃连接和旧 bootstrap，重新发现或启动 Host；不需要重新创建通用
Node REPL。
