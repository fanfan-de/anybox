# 节点 10：Chrome Extension Service Worker 与连接客户端

[上一节点：Rust Native Host](./09-rust-native-messaging-host.md) ·
[返回总览](./README.md) ·
[下一节点：Extension Command Executor](./11-extension-command-executor.md)

## 1. Extension manifest 给了什么运行能力

当前 MV3 manifest：

[`browser-extension/public/manifest.json`](../../browser-extension/public/manifest.json)

核心配置：

```text
background service_worker = background.js
type                      = module
content script            = content.js at document_start
host_permissions          = <all_urls>
```

权限：

| 权限 | 当前用途 |
| --- | --- |
| `nativeMessaging` | 连接 `com.anybox.browser` Rust Host |
| `tabs` | 列出、创建、激活、查询 tab |
| `scripting` | 注入固定函数读取/操作页面 |
| `debugger` | 使用固定 CDP domain/method 做 DOM、AX、截图和输入 |
| `storage` | 保存 Extension instance ID 和连接状态 |

广泛权限来自浏览器自动化需求，但真正可从模型到达的 method 仍由 Browser Contract 和
Extension dispatcher 限定。

## 2. Service Worker 入口

[`background/index.ts`](../../browser-extension/src/background/index.ts) 在模块加载时立即：

```ts
connectAnybox()
```

并在：

```text
chrome.runtime.onInstalled
chrome.runtime.onStartup
```

再次调用。`connectAnybox()` 是幂等门：

```text
已有 activeTransport → 返回
正在 connecting       → 返回
否则                  → connectNativeTransport()
```

Popup 或其他扩展页面还能发：

```text
ANYBOX_GET_BRIDGE_STATUS
ANYBOX_RECONNECT_BRIDGE
```

两者都会顺便触发 `connectAnybox()`。

## 3. `connectNative` 的实际动作

连接客户端位于：

[`background/anybox-client.ts`](../../browser-extension/src/background/anybox-client.ts)

它调用：

```js
chrome.runtime.connectNative("com.anybox.browser")
```

Chrome 根据上一节点注册的 manifest 启动 Rust Host，建立 Port。

Extension 随后创建一个 `ActiveTransport`：

```text
kind = native
send(message) → port.postMessage(message)
close()       → port.disconnect()
```

并：

- 重置 reconnect attempt；
- 把 storage 状态写成 `connected`；
- 异步发送 Extension hello；
- 安装 `port.onMessage` 和 `port.onDisconnect`。

## 4. Popup 的 `connected` 不等于端到端 ready

当前状态写入时点是 `connectNative` 返回 Port 之后，而不是 Browser Host Bridge 对 Extension
hello 完成校验之后。Extension protocol 也没有一个 hello ack。

因此 Popup `Connected` 精确表示：

```text
Extension 当前持有一个 Native Messaging Port
```

它不严格证明：

- Rust Host 已完成 Browser Host IPC 认证；
- Browser Host Bridge 已接受 hello；
- Browser Contract 兼容；
- 下一条 command 一定成功。

Browser Client 的 `chrome.status().connected` 更接近端到端 backend 状态，因为它来自
Bridge 的 active compatible connection。

## 5. Extension hello

每次 Native Port 建立后，Extension 发送：

```json
{
  "type": "hello",
  "protocolVersion": 1,
  "extensionID": "<chrome.runtime.id>",
  "extensionInstanceID": "<persistent UUID>",
  "version": "<manifest version>",
  "capabilities": {
    "contractVersion": 1,
    "commands": ["15 canonical methods"]
  },
  "lastTransportError": "..."
}
```

`extensionInstanceID` 第一次生成 UUID 后保存在 `chrome.storage.local`，扩展 Service
Worker 重启后复用；Extension 重新安装或 storage 清除后会变化。

`extensionID` 使用运行时的 `chrome.runtime.id`，Browser Host 会与固定 ID 比较。

`capabilities.commands` 来自共享 `BROWSER_CONTRACT_COMMAND_METHODS`，不是手写第二份
列表。

## 6. 接收 Browser Host 消息

Port message 先经共享 `BrowserExtensionServerMessage` schema 解析，只允许：

```text
command
ping
```

### ping

立即回：

```json
{"type": "pong", "nonce": "..."}
```

### command

异步进入 `handleCommand(...)`：

1. 检查 message.contractVersion；
2. 调用下一节点 `handleBrowserCommand(method, params)`；
3. 成功发送 `result {ok:true,data}`；
4. 失败发送 `result {ok:false,error,code?,retryable?}`。

Contract version 在 Extension protocol v1 中是 optional，用于兼容旧 Host。当前 Browser Host
总是发送 v1。

如果 server message 无法解析，Extension 尝试发送：

```json
{
  "type": "event",
  "event": "client_error",
  "data": {"message": "..."}
}
```

## 7. 所有 outgoing message 也先过 schema

`sendClientMessage(...)` 调用：

```ts
BrowserExtensionClientMessage.parse(message)
```

之后才 `postMessage`。允许：

```text
hello
result
event
pong
```

因此 Extension 自己构造出错误结构时会在本地失败，不会把任意对象发给 Browser Host。

## 8. 断线与指数重连

`port.onDisconnect`：

- 仅当该 Port 仍是 active 时清除；
- 读取 `chrome.runtime.lastError?.message`；
- 写 storage `disconnected`；
- 安排重连。

退避：

```text
1s → 2s → 4s → 8s → 15s → 15s ...
```

同一时间只保留一个 reconnect timer。成功创建新 Port 时 attempt 归零。

如果 `connectNative` 同步抛错，也走相同断线状态和重连逻辑。

## 9. MV3 生命周期

Service Worker 可能被 Chrome 回收并重新启动。模块重载后：

- `activeTransport`、timer、attempt 等内存状态重置；
- storage 中的 instance ID 和最后 status 保留；
- 顶层 `connectAnybox()` 再尝试建立 Native Port。

长连接 Native Port 通常让后台保持活跃，但代码不能把内存永久存在作为协议保证，所以
hello 和 reconnect 都能在 Worker 重建后重新执行。

## 10. 当前没有的连接能力

- 没有同时选择多个 Browser Host；
- 没有用户选择 Chrome profile 到 Host connection 的映射；
- 没有 hello ack；
- 没有周期性 heartbeat；
- 没有 command cancel message；
- 没有 Extension 主动查询 Browser Host capability 后缩减自己广告集合。

当前 capability 协商由 Extension 广告、Browser Host 取 canonical 交集完成。

## 11. 本节点的输出

这个节点把 Browser Host `command` 交给 `handleBrowserCommand(...)`，并把下一节点返回的结构封装
成 `result`。下一节点才真正调用 `chrome.tabs`、`chrome.scripting` 和
`chrome.debugger`。
