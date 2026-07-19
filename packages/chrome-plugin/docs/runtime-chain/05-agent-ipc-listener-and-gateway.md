# 节点 05：Agent Browser IPC Gateway

[上一节点](./04-transport-worker-and-runtime-ipc.md) ·
[下一节点：Contract 与 Policy](./06-contract-policy-and-command-gateway.md)

`BrowserIpcGateway` 仍由 Anybox Agent 启动。0.8.0 的主用途是认证插件自带的 Rust
Native Messaging Host，并把它注册到 `BrowserExtensionBridge`。

## Native Host role

Gateway 创建平台本机 endpoint：

- Windows Named Pipe；
- macOS/Linux Unix Domain Socket。

Agent 写入短期、一次性的 bootstrap proof。Rust Host 完成
challenge/hello/HMAC 后，Gateway 消费并删除 proof，然后把 `native.message`
与 Bridge 互转。

## Browser Client 不再连接 runtime role

Gateway 当前仍保留 `runtime` endpoint 和协议，以兼容已有测试与旧客户端；Chrome
Browser Client 0.5.0 不使用它。Node REPL status 不再对应 `runtimeConnections`，
而是通过 MCP host service 直接读取 Bridge 状态。

## 权威边界

无论请求来自兼容 runtime role 还是新的 MCP host service，真正的 browser command
最终都进入同一套：

```text
runtime-host / ipc-gateway
  → runBrowserRuntimeCommand()
  → Browser Contract parse
  → Browser Policy
  → BrowserExtensionBridge
```

Native Host 认证只证明本机传输符合当前 bootstrap；它不替代命令级策略。
